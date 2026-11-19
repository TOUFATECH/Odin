// Le journal des actions : chaque action engageante a un numéro (empreinte de l'outil, de ses paramètres exacts et du
// tour) ; elle est notée « lancée » avant d'agir et « faite » (ou « échouée ») après ; la refaire dans la même demande
// n'est jamais fait seul : la question est posée au propriétaire (sa décision du 19/11, « Me demander »), et sans
// personne pour répondre elle est refusée ; faite par le processus d'avant un redémarrage, elle n'est jamais refaite ;
// une action coupée en plein milieu est demandée au propriétaire ; ce qui est exécuté est la copie figée de ce qui a
// été validé ; un « oui » ne vaut que pour l'action exacte qu'il a vue.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Heimdall, type ApprovalAnswer, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { Approbations } from '../src/heimdall/approbations.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const FICHIER = 'tours-actions.jsonl';
const memoire = () => mkdtempSync(join(tmpdir(), 'odin-actions-'));
/** Le dossier d'Odin d'un essai : la mémoire en est un sous-dossier, comme dans un vrai Odin. */
const homeDe = (dir: string) => join(dir, '..', `${basename(dir)}-home`);
const contexte = (dir: string | null, privateMode = false) => ({ workspace: tmpdir(), ...(dir ? { home: homeDe(dir) } : {}), sessionId: 'web:p', channel: 'web', peer: 'p', isTainted: () => false, redactor: { redact: (t: string) => t.replace(/Zq9-secret-\w+/g, '[masqué]') }, muninn: { dir, privateMode } }) as never;
function heimdall(reponse: (r: ApprovalRequest) => ApprovalAnswer | Promise<ApprovalAnswer> = () => false) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 5 }, { approve: async (r) => { demandes.push(r); return reponse(r); } });
  return { h, demandes };
}
/** Un outil qui écrit (« write » : permis sans question par la politique de base), et compte ses exécutions. */
function outil(risk: 'write' | 'read' | 'external' = 'write', run?: (i: Record<string, unknown>) => unknown) {
  const recus: Array<Record<string, unknown>> = [];
  const t = { name: 'note_ecrire', description: 'essai', risk, schema: { type: 'object' }, summarize: (i: Record<string, unknown>) => `écrire ${String(i.titre ?? '')}`, async run(i: Record<string, unknown>) { recus.push(i); await run?.(i); return 'ok'; } };
  return { t: t as never, recus };
}
/** Attend qu'une condition soit vraie (machine chargée : pas de délai fixe), au plus 20 s. */
async function quand(ok: () => boolean, quoi: string): Promise<void> {
  const fin = Date.now() + 20_000;
  while (!ok()) { if (Date.now() > fin) assert.fail(`attendu en vain : ${quoi}`); await new Promise((r) => setTimeout(r, 5)); }
  // Laisse passer ce qui suivrait aussitôt (une question de trop se verrait ici).
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
const lignes = (dir: string) => existsSync(join(dir, FICHIER)) ? readFileSync(join(dir, FICHIER), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];

// Décision du propriétaire (19/11, demandes-du-17-11.md, section 90) : « Me demander » — si Odin veut refaire la même
// action dans la même demande, il pose la question (au lieu de refuser). Ici il répond non : rien n'est refait.
test('une action engageante n\'est jamais refaite seule dans le même tour (ordre des clés indifférent) : la question est posée ; un autre tour ou un autre paramètre, non', async () => {
  const dir = memoire(), ctx = contexte(dir), { h, demandes } = heimdall(), o = outil();
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-A' };
  const un = await deciderPuisLancer(h, o.t, { titre: 'courses', texte: 'lait' }, ctx, e);
  assert.equal(un.decision.allowed, true); await un.lancer!();
  assert.equal(demandes.length, 0, 'la première fois, rien n\'est demandé (une écriture permise)');
  const deux = await deciderPuisLancer(h, o.t, { texte: 'lait', titre: 'courses' }, ctx, e);
  if (deux.lancer) await deux.lancer().catch(() => undefined);
  assert.equal(o.recus.length, 1, 'la même action, dans le même tour, n\'est pas refaite sans le propriétaire');
  assert.equal(deux.decision.allowed, false);
  assert.equal(demandes.length, 1, 'la question lui est posée');
  assert.match(demandes[0].reason, /déjà fait cette action dans cette demande \(n° [0-9a-f]{12}/);
  assert.match(deux.decision.allowed ? '' : deux.decision.reason, /déjà fait cette action/);
  // Un autre paramètre, ou un autre tour : une autre action.
  await (await deciderPuisLancer(h, o.t, { titre: 'courses', texte: 'pain' }, ctx, e)).lancer!();
  await (await deciderPuisLancer(h, o.t, { titre: 'courses', texte: 'lait' }, ctx, { ...e, tour: 'tour-B' })).lancer!();
  assert.equal(o.recus.length, 3);
});

test('« lancée » est écrite sur le disque AVANT l\'action, « faite » après ; une action échouée refaite est demandée ; rien en clair', async () => {
  const dir = memoire(), ctx = contexte(dir), { h } = heimdall();
  let vuPendant: Array<Record<string, unknown>> = [];
  const o = outil('write', () => { vuPendant = lignes(dir); });
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-C' };
  await (await deciderPuisLancer(h, o.t, { titre: 'clé', texte: 'Zq9-secret-abc' }, ctx, e)).lancer!();
  assert.equal(vuPendant.length, 1, 'pendant l\'action, la ligne « lancée » est déjà sur le disque');
  assert.equal(vuPendant[0].etat, 'lancée');
  const apres = lignes(dir);
  assert.deepEqual(apres.map((l) => l.etat), ['lancée', 'faite']);
  assert.equal(apres[0].n, apres[1].n, 'le même numéro');
  assert.match(String(apres[0].n), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(readFileSync(join(dir, FICHIER), 'utf8'), /Zq9-secret/, 'les paramètres ne sont gardés qu\'en empreinte, le résumé est masqué');
  // Échouée : notée. Décision du lot (demandes-du-17-11.md, section 90, « Me demander ») : une action « échouée » refaite
  // dans la même demande est demandée au propriétaire (un outil peut échouer APRÈS avoir envoyé) ; il dit oui ici.
  let essais = 0;
  const casse = outil('write', () => { essais++; if (essais === 1) throw new Error('disque plein'); });
  const e2 = { ...e, tour: 'tour-D' };
  await assert.rejects((await deciderPuisLancer(h, casse.t, { titre: 'x' }, ctx, e2)).lancer!());
  assert.equal(lignes(dir).at(-1)?.etat, 'échouée');
  const { h: hOui, demandes } = heimdall(() => true);
  await (await deciderPuisLancer(hOui, casse.t, { titre: 'x' }, ctx, e2)).lancer!();
  assert.equal(casse.recus.length, 2);
  assert.equal(demandes.length, 1, 'refaire une action échouée : la question est posée');
  assert.match(demandes[0].reason, /échouée/);
});

test('les lectures ne sont pas notées ; sans tour, rien n\'est refusé (une tâche programmée refait son travail chaque jour)', async () => {
  const dir = memoire(), ctx = contexte(dir), { h } = heimdall(), lire = outil('read');
  for (let i = 0; i < 2; i++) await (await deciderPuisLancer(h, lire.t, { titre: 'a' }, ctx, { sessionId: 'web:p', tainted: false, tour: 'tour-L' })).lancer!();
  assert.equal(lire.recus.length, 2); assert.equal(lignes(dir).length, 0);
  const ecrire = outil();
  for (let i = 0; i < 2; i++) await (await deciderPuisLancer(h, ecrire.t, { titre: 'a' }, ctx, { sessionId: 'cron:1', tainted: false, unattended: true })).lancer!();
  assert.equal(ecrire.recus.length, 2);
});

test('une action coupée en plein milieu (panne) n\'est jamais rejouée seule : elle est demandée au propriétaire', async () => {
  const dir = memoire();
  // Un autre processus lance l'action et s'arrête net au milieu (comme une panne).
  const url = (p: string) => pathToFileURL(join(import.meta.dirname, '..', p)).href;
  const code = `const { deciderPuisLancer } = await import(${JSON.stringify(url('src/heimdall/executer.ts'))});
const { Heimdall } = await import(${JSON.stringify(url('src/heimdall/policy.ts'))});
const { DEFAULT_CONFIG } = await import(${JSON.stringify(url('src/config.ts'))});
const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => false });
const t = { name: 'note_ecrire', risk: 'write', schema: { type: 'object' }, async run() { process.exit(7); } };
const ctx = { workspace: '.', home: ${JSON.stringify(homeDe(dir))}, sessionId: 'web:p', isTainted: () => false, redactor: { redact: (x) => x }, muninn: { dir: ${JSON.stringify(dir)}, privateMode: false } };
const r = await deciderPuisLancer(h, t, { titre: 'virement' }, ctx, { sessionId: 'web:p', tainted: false, tour: 'tour-P' });
await r.lancer();
process.exit(0);`;
  const p = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 7, p.stderr);
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-P' }, ctx = contexte(dir);
  // Personne pour répondre (tâche sans surveillance) : refusée, sans rien demander.
  const { h: h0, demandes: d0 } = heimdall(() => true), o0 = outil();
  const sans = await deciderPuisLancer(h0, o0.t, { titre: 'virement' }, ctx, { ...e, unattended: true });
  assert.equal(sans.decision.allowed, false); assert.equal(d0.length, 0); assert.equal(o0.recus.length, 0);
  // Le propriétaire dit non : rien n'est refait.
  const { h: h1, demandes: d1 } = heimdall(() => false), o1 = outil();
  const non = await deciderPuisLancer(h1, o1.t, { titre: 'virement' }, ctx, e);
  if (non.lancer) await non.lancer().catch(() => undefined);
  assert.equal(o1.recus.length, 0, 'jamais rejouée seule');
  assert.equal(d1.length, 1, 'la question est posée au propriétaire');
  assert.match(d1[0].reason, /coupée/);
  assert.equal(d1[0].grantable, false);
  // Il dit oui : elle est faite, une fois.
  const { h: h2 } = heimdall(() => true), o2 = outil();
  await (await deciderPuisLancer(h2, o2.t, { titre: 'virement' }, ctx, e)).lancer!();
  assert.equal(o2.recus.length, 1);
  assert.equal(lignes(dir).at(-1)?.etat, 'faite');
});

test('copie figée : ce qui est exécuté est exactement ce qui a été validé, même si l\'objet du modèle change pendant la question', async () => {
  const dir = memoire(), ctx = contexte(dir);
  const entree: Record<string, unknown> = { titre: 'à Paul', texte: 'bonjour' };
  const { h, demandes } = heimdall((r) => { entree.titre = 'à un inconnu'; entree.texte = 'tout mon carnet'; void r; return true; });
  const o = outil('external');
  const r = await deciderPuisLancer(h, o.t, entree, ctx, { sessionId: 'web:p', tainted: false, tour: 'tour-F' });
  assert.equal(demandes.length, 1); assert.equal(demandes[0].summary, 'écrire à Paul');
  await r.lancer!();
  assert.deepEqual(o.recus[0], { titre: 'à Paul', texte: 'bonjour' }, 'l\'action validée, pas l\'objet changé après');
  assert.notEqual(o.recus[0], entree);
});

test('un « oui » ne vaut que pour l\'action exacte vue : chaque demande porte le numéro de son action ; un autre numéro ne vaut rien', async () => {
  const a = new Approbations();
  const { h } = heimdall((r) => a.attendre(r.id, { echeanceMs: 5000, resume: r.summary }));
  const o = outil('external');
  const p1 = deciderPuisLancer(h, o.t, { titre: 'à Paul' }, contexte(null), { sessionId: 'web:p', tainted: false, tour: 'tour-O' });
  const p2 = deciderPuisLancer(h, o.t, { titre: 'à Léa' }, contexte(null), { sessionId: 'web:p', tainted: false, tour: 'tour-O' });
  await new Promise((ok) => setTimeout(ok, 50));
  const l = a.dansLesTemps() as Array<{ id: string; numero?: string }>;
  assert.equal(l.length, 2);
  assert.match(String(l[0].numero), /^[0-9a-f]{12}$/, 'la demande porte le numéro de l\'action');
  assert.notEqual(l[0].numero, l[1].numero);
  // Le « oui » donné en voyant l'action de Léa ne vaut pas pour celle de Paul.
  const faux = a.repondre(l[0].id, 'oui', true, Date.now(), l[1].numero);
  assert.equal(faux.ok, false);
  assert.equal(a.taille, 2, 'la demande attend toujours');
  assert.equal(a.repondre(l[0].id, 'oui', true, Date.now(), l[0].numero).ok, true);
  assert.equal(a.repondre(l[1].id, 'non', true).ok, true);
  assert.equal((await p1).decision.allowed, true);
  assert.equal((await p2).decision.allowed, false);
  // Sans numéro donné (« oui » tout court, une seule demande) : comme avant.
  const b = new Approbations();
  const w = b.attendre('x1', { echeanceMs: 5000, empreinte: 'f'.repeat(64) });
  assert.equal(b.repondre('x1', 'oui', true).ok, true); assert.equal(await w, true);
});

test('mode privé : rien n\'est écrit, mais l\'action n\'est toujours pas refaite dans le tour', async () => {
  const dir = memoire(), ctx = contexte(dir, true), { h } = heimdall(), o = outil();
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-Pv' };
  await (await deciderPuisLancer(h, o.t, { titre: 'secret' }, ctx, e)).lancer!();
  const deux = await deciderPuisLancer(h, o.t, { titre: 'secret' }, ctx, e);
  if (deux.lancer) await deux.lancer().catch(() => undefined);
  assert.equal(o.recus.length, 1);
  assert.equal(existsSync(join(dir, FICHIER)), false, 'rien écrit');
  assert.equal(existsSync(join(homeDe(dir), 'tours-actions.cle')), false, 'pas même la clé des numéros');
});

test('un code court (PIN, code d\'alarme) ne se retrouve pas à partir du journal : le numéro est une empreinte à clé, la clé est hors de la mémoire', async () => {
  const { canonique } = await import('../src/heimdall/actions-journal.ts');
  const dir = memoire(), ctx = contexte(dir), { h } = heimdall(() => true), o = outil();
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-K' };
  await (await deciderPuisLancer(h, o.t, { cible: 'alarme', code: '4821' }, ctx, e)).lancer!();
  const brut = readFileSync(join(dir, FICHIER), 'utf8');
  assert.doesNotMatch(brut, /4821/);
  const l = lignes(dir)[0];
  // Celui qui n'a que la ligne du journal essaie les 10 000 codes possibles.
  const trouve: string[] = [];
  for (let i = 0; i < 10_000; i++) {
    const code = String(i).padStart(4, '0');
    const essai = createHash('sha256').update(canonique({ outil: String(l.outil), entree: { cible: 'alarme', code }, tour: String(l.tour) })).digest('hex');
    if (essai === l.n) trouve.push(code);
  }
  assert.deepEqual(trouve, [], 'le code ne se retrouve pas à partir du journal seul');
  // La clé n'est pas dans la mémoire : elle est dans le dossier d'Odin, chiffrée par la clé de la machine.
  const cle = join(homeDe(dir), 'tours-actions.cle');
  assert.equal(existsSync(cle), true);
  assert.match(readFileSync(cle, 'utf8'), /^odc1:/);
});

test('une consultation faite par un outil qui peut aussi agir (risque « exec » ou « write », lookup vrai) n\'est pas notée et peut se refaire', async () => {
  const dir = memoire(), ctx = contexte(dir), { h } = heimdall(() => true);
  const recus: Array<Record<string, unknown>> = [];
  const t = { name: 'valhalla', description: 'essai', risk: 'exec', schema: { type: 'object' }, lookup: (i: Record<string, unknown>) => i.action === 'etat', async run(i: Record<string, unknown>) { recus.push(i); return 'ok'; } } as never;
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-V' };
  for (let i = 0; i < 2; i++) {
    const r = await deciderPuisLancer(h, t, { action: 'etat' }, ctx, e);
    assert.equal(r.decision.allowed, true, r.decision.allowed ? '' : r.decision.reason);
    await r.lancer!();
  }
  assert.equal(recus.length, 2, 'une lecture se refait');
  assert.equal(lignes(dir).length, 0, 'une lecture n\'est pas notée');
  // Le même outil, quand il agit : noté, et pas refait dans le tour sans le propriétaire (décision du 19/11, « Me
  // demander », demandes-du-17-11.md section 90 : la question est posée ; ici il dit non).
  await (await deciderPuisLancer(h, t, { action: 'redemarrer' }, ctx, e)).lancer!();
  const { h: hNon } = heimdall(() => false);
  const deux = await deciderPuisLancer(hNon, t, { action: 'redemarrer' }, ctx, e);
  assert.equal(deux.decision.allowed, false);
  assert.equal(recus.length, 3);
  assert.deepEqual(lignes(dir).map((x) => x.etat), ['lancée', 'faite']);
});

// ——— Suite : décision du propriétaire du 19/11 (demandes-du-17-11.md, section 90) : « Me demander » — si Odin veut
// refaire la même action dans la même demande, il pose la question ; après une coupure, une action déjà faite n'est
// jamais refaite et une action coupée est demandée.

test('refaire la même action dans la même demande : question grave, sans « toujours » ; un oui vaut pour CE numéro et une seule fois', async () => {
  const dir = memoire(), ctx = contexte(dir), o = outil();
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-R' };
  await (await deciderPuisLancer(heimdall().h, o.t, { titre: 'rappel' }, ctx, e)).lancer!();
  const { h, demandes } = heimdall(() => 'always');
  const deux = await deciderPuisLancer(h, o.t, { titre: 'rappel' }, ctx, e);
  assert.equal(deux.decision.allowed, true);
  assert.equal(demandes.length, 1);
  assert.equal(demandes[0].severity, 'grave');
  assert.equal(demandes[0].grantable, false, 'jamais « toujours » pour une action refaite');
  await deux.lancer!();
  assert.equal(o.recus.length, 2, 'avec son oui, elle est refaite une fois');
  // Le même oui ne sert pas deux fois.
  await assert.rejects(deux.lancer!(), /une fois|déjà servi/);
  assert.equal(o.recus.length, 2);
  // Une troisième fois : la question est reposée (« toujours » n'a rien retenu).
  const trois = await deciderPuisLancer(h, o.t, { titre: 'rappel' }, ctx, e);
  assert.equal(demandes.length, 2);
  await trois.lancer!();
  assert.equal(o.recus.length, 3);
});

test('sans surveillance (personne pour répondre) : refaire la même action dans la même demande est refusé, sans question', async () => {
  const dir = memoire(), ctx = contexte(dir), o = outil();
  const e = { sessionId: 'tache:1', tainted: false, tour: 'tour-U', unattended: true };
  await (await deciderPuisLancer(heimdall().h, o.t, { titre: 'u' }, ctx, e)).lancer!();
  const { h, demandes } = heimdall(() => true);
  const deux = await deciderPuisLancer(h, o.t, { titre: 'u' }, ctx, e);
  assert.equal(deux.decision.allowed, false);
  assert.equal(demandes.length, 0);
  assert.match(deux.decision.allowed ? '' : deux.decision.reason, /personne/);
  assert.equal(o.recus.length, 1);
});

/** Un autre processus fait l'action jusqu'au bout (« faite » ou « échouée »), puis s'arrête (comme un redémarrage). */
function processusAvant(dir: string, tour: string, issue: 'faite' | 'échouée'): void {
  const url = (p: string) => pathToFileURL(join(import.meta.dirname, '..', p)).href;
  const code = `const { deciderPuisLancer } = await import(${JSON.stringify(url('src/heimdall/executer.ts'))});
const { Heimdall } = await import(${JSON.stringify(url('src/heimdall/policy.ts'))});
const { DEFAULT_CONFIG } = await import(${JSON.stringify(url('src/config.ts'))});
const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => false });
const t = { name: 'note_ecrire', risk: 'write', schema: { type: 'object' }, async run() { ${issue === 'faite' ? "return 'ok';" : "throw new Error('délai dépassé');"} } };
const ctx = { workspace: '.', home: ${JSON.stringify(homeDe(dir))}, sessionId: 'web:p', isTainted: () => false, redactor: { redact: (x) => x }, muninn: { dir: ${JSON.stringify(dir)}, privateMode: false } };
const r = await deciderPuisLancer(h, t, { titre: 'virement' }, ctx, { sessionId: 'web:p', tainted: false, tour: ${JSON.stringify(tour)} });
await r.lancer().catch(() => undefined);
process.exit(0);`;
  const p = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 0, p.stderr);
}

test('à la reprise : une action « faite » par le processus d\'avant n\'est jamais refaite (même avec un oui) ; une « échouée » est demandée', async () => {
  const dir = memoire();
  processusAvant(dir, 'tour-Q', 'faite');
  const ctx = contexte(dir), e = { sessionId: 'web:p', tainted: false, tour: 'tour-Q' };
  const { h, demandes } = heimdall(() => true), o = outil();
  const r = await deciderPuisLancer(h, o.t, { titre: 'virement' }, ctx, e);
  assert.equal(r.decision.allowed, false);
  assert.equal(demandes.length, 0, 'rien n\'est demandé : jamais refaite après une coupure');
  assert.match(r.decision.allowed ? '' : r.decision.reason, /jamais/);
  assert.equal(o.recus.length, 0);
  // Échouée avant la coupure : peut-être partie quand même → demandée.
  const dir2 = memoire();
  processusAvant(dir2, 'tour-Q2', 'échouée');
  const { h: h2, demandes: d2 } = heimdall(() => false), o2 = outil();
  const r2 = await deciderPuisLancer(h2, o2.t, { titre: 'virement' }, contexte(dir2), { ...e, tour: 'tour-Q2' });
  assert.equal(r2.decision.allowed, false);
  assert.equal(d2.length, 1);
  assert.match(d2[0].reason, /échouée/);
  assert.equal(o2.recus.length, 0);
});

test('deux appels identiques en même temps : une seule question ; le second attend la réponse de la première', async () => {
  const dir = memoire(), ctx = contexte(dir);
  const e = { sessionId: 'web:p', tainted: false, tour: 'tour-M' };
  const reponses: Array<(a: ApprovalAnswer) => void> = [];
  const { h, demandes } = heimdall(() => new Promise<ApprovalAnswer>((ok) => reponses.push(ok)));
  const o = outil('external');
  const p1 = deciderPuisLancer(h, o.t, { titre: 'à Paul' }, ctx, e);
  const p2 = deciderPuisLancer(h, o.t, { titre: 'à Paul' }, ctx, e);
  await quand(() => demandes.length >= 1, 'la première question');
  assert.equal(demandes.length, 1, 'une seule question pour deux appels identiques');
  // Il dit non : le second ne repose pas la même question, il est refusé lui aussi.
  reponses[0](false);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.decision.allowed, false); assert.equal(r2.decision.allowed, false);
  assert.equal(demandes.length, 1);
  assert.equal(o.recus.length, 0);
  // Il dit oui : la première part ; la seconde, qui la referait, est demandée APRÈS (« Me demander »).
  const q1 = deciderPuisLancer(h, o.t, { titre: 'à Léa' }, ctx, e);
  const q2 = deciderPuisLancer(h, o.t, { titre: 'à Léa' }, ctx, e);
  await quand(() => demandes.length >= 2, 'la question pour Léa');
  assert.equal(demandes.length, 2);
  reponses[1](true);
  const s1 = await q1; await s1.lancer!();
  await quand(() => demandes.length >= 3, 'la question de la seconde, une fois la première faite');
  assert.equal(demandes.length, 3, 'la seconde est demandée une fois la première faite');
  assert.match(demandes[2].reason, /déjà fait cette action/);
  reponses[2](false);
  const s2 = await q2;
  assert.equal(s2.decision.allowed, false);
  assert.equal(o.recus.length, 1);
});

test('la passerelle transmet à la réponse le numéro de l\'action que le propriétaire a vue', async () => {
  const { makeOdin } = await import('./helpers.ts');
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { actionEnCours } = await import('../src/heimdall/actions-journal.ts');
  const o = makeOdin([]);
  try {
    const envoyes: string[] = [];
    const ch = { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p: string, t: string) => { envoyes.push(t); } };
    const gw = new Gateway(o as never, { owners: { web: ['*'] } });
    gw.add(ch as never);
    const vus: Array<string | undefined> = [];
    const avant = Approbations.prototype.repondre;
    Approbations.prototype.repondre = function (this: Approbations, ...a: Parameters<Approbations['repondre']>) { vus.push(a[4]); return avant.apply(this, a); };
    try {
      const empreinte = 'ab'.repeat(32);
      const req = { id: 'a-essai-1', tool: 'note_ecrire', risk: 'external', summary: 'écrire à Paul', reason: 'GRAVE : essai', sessionId: 'web:principal', severity: 'grave', grantable: false } as ApprovalRequest;
      const reponse = actionEnCours.run({ empreinte }, () => gw.approver.approve(req));
      await new Promise((ok) => setTimeout(ok, 30));
      assert.equal(envoyes.length, 1, 'la demande est montrée');
      await gw.handle({ channel: 'web', peer: 'principal', text: '/yes a-essai-1' } as never);
      assert.equal(await reponse, true);
      assert.deepEqual(vus, [empreinte.slice(0, 12)], 'le « oui » porte le numéro de l\'action montrée');
    } finally { Approbations.prototype.repondre = avant; }
  } finally { o.cleanup(); }
});

test('une action qui dure plus de 10 minutes garde sa réservation jusqu\'à sa fin : l\'appel identique attend, puis est demandé', async () => {
  // Horloge simulée : seule la garde des 10 minutes (setTimeout) est avancée ; la question est répondue tout de suite.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const dir = memoire(), ctx = contexte(dir);
    const e = { sessionId: 'web:p', tainted: false, tour: 'tour-L' };
    let finir!: () => void;
    const fin = new Promise<void>((ok) => { finir = ok; });
    const { h, demandes } = heimdall(() => false), o = outil('write', () => fin);
    const un = await deciderPuisLancer(h, o.t, { titre: 'longue' }, ctx, e);
    const enCours = un.lancer!();
    mock.timers.tick(10 * 60_000 + 1);
    const deux = deciderPuisLancer(h, o.t, { titre: 'longue' }, ctx, e);
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
    assert.equal(demandes.length, 0, 'tant que la première tourne, l\'appel identique attend (pas de question « encore en cours »)');
    finir(); await enCours;
    const r2 = await deux;
    assert.equal(r2.decision.allowed, false);
    assert.equal(demandes.length, 1, 'une fois la première faite, la seconde est demandée');
    assert.match(demandes[0].reason, /déjà fait cette action dans cette demande \(n° [0-9a-f]{12}, faite /);
    assert.equal(o.recus.length, 1);
  } finally { mock.timers.reset(); }
});
