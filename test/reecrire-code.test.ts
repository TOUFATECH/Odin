// S1 — Réécrire son code (note « Réécrire son code ») : le réglage code.validation appliqué par Heimdall, le noyau
// toujours validé, toutes les portes d'écriture sous la même règle, l'intégrité avant chaque action engageante, les
// réponses aux validations réservées au propriétaire, les essais avant activation et le retour arrière automatique.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heimdall, toolPath, type ApprovalRequest, type GateInput } from '../src/heimdall/policy.ts';
import { cheminsCodeDe, deciderPuisLancer } from '../src/heimdall/executer.ts';
import { Approbations } from '../src/heimdall/approbations.ts';
import { calculerEmpreintes, ecrireReference, estNoyau, FICHIER_EMPREINTES, RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { SETTINGS, parseValue } from '../src/tools/reglages.ts';
import { selfEdit, marquerActivation, verifierActivation, backupFile, essaisDuLot } from '../src/tools/self.ts';
import { buildSystemPrompt } from '../src/core/prompt.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };

function heimdall(o: { validation?: string; reponse?: boolean | 'rien' } = {}) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return o.reponse === undefined || o.reponse === 'rien' ? new Promise(() => { /* pas de réponse */ }) : Promise.resolve(o.reponse); } });
  h.setAutonomy('breaker');
  if (o.validation) h.setValidationCode(() => o.validation);
  return { h, demandes };
}
const appel = (cheminsCode: string[], extra: Partial<GateInput> = {}): GateInput => ({ tool: 'self_edit', risk: 'exec', summary: 'modifier mon code', sessionId: 's', tainted: false, cheminsCode, ...extra });

test('par défaut (« chaque-fois »), même en Breaker : une réécriture hors noyau demande ta validation ; sans réponse, rien', async () => {
  const { h, demandes } = heimdall();
  const d = await h.gate(appel(['src/web/pages/nous.js']));
  assert.equal(d.allowed, false); assert.equal(demandes.length, 1);
  assert.equal(demandes[0].severity, 'grave'); assert.equal(demandes[0].grantable, false);
  assert.match(demandes[0].reason, /réécrire mon code \(src\/web\/pages\/nous\.js\)/);
});

test('« jamais » : hors noyau, propriétaire, conversation propre → sans question ; le noyau, l\'extérieur, une tâche automatique → validation ; un membre → refus', async () => {
  const { h, demandes } = heimdall({ validation: 'jamais' });
  assert.equal((await h.gate(appel(['src/web/pages/nous.js']))).allowed, true);
  assert.equal(demandes.length, 0);
  assert.equal((await h.gate(appel(['src/heimdall/policy.ts']))).allowed, false, 'noyau : validation demandée, sans réponse → rien');
  assert.match(demandes.at(-1)!.reason, /garde-fou d'Odin/);
  const auto = await h.gate(appel(['src/web/pages/nous.js'], { unattended: true }));
  assert.equal(auto.allowed, false); assert.match(String((auto as { reason?: string }).reason), /tâche automatique.*sans surveillance/, 'personne pour répondre : refus');
  const avant = demandes.length;
  const t = await h.gate(appel(['src/web/pages/nous.js'], { tainted: true }));
  assert.equal(t.allowed, false); assert.equal(demandes.length, avant + 1, 'une page lue : la validation est demandée');
  const m = await h.gate(appel(['src/web/pages/nous.js'], { maxAutonomy: 'prudent' }));
  assert.equal(m.allowed, false); assert.match(String((m as { reason?: string }).reason), /seul le propriétaire/);
  // le noyau après un contenu extérieur : refus immédiat, sans même demander
  const n = demandes.length;
  assert.equal((await h.gate(appel(['src/vault.ts'], { tainted: true }))).allowed, false); assert.equal(demandes.length, n);
});

test('toutes les portes : self_edit, fs_write et fs_edit en chemin absolu dans le dossier d\'Odin passent par la même règle', async () => {
  const ctx = { workspace: tmpdir(), fullAccess: true };
  assert.deepEqual(cheminsCodeDe('self_edit', { path: 'src/heimdall/../heimdall/policy.ts' }, ctx).map((x) => x.replace(/\\/g, '/')), ['src/heimdall/policy.ts']);
  assert.deepEqual(cheminsCodeDe('fs_write', { path: join(RACINE_APPLI, 'src', 'vault.ts') }, ctx).map((x) => x.replace(/\\/g, '/')), ['src/vault.ts']);
  assert.deepEqual(cheminsCodeDe('fs_edit', { path: join(tmpdir(), 'notes.txt') }, ctx), [], 'hors du dossier d\'Odin : pas une réécriture');
  // de bout en bout : fs_write sur le noyau, même avec « jamais » → validation ; l'outil n'est pas lancé
  const { h, demandes } = heimdall({ validation: 'jamais' });
  let lance = false;
  const outil = { name: 'fs_write', description: '', risk: 'write' as const, schema: { type: 'object', properties: {} }, async run() { lance = true; return 'écrit'; } };
  const r = await deciderPuisLancer(h, outil as never, { path: join(RACINE_APPLI, 'src', 'heimdall', 'policy.ts'), content: 'x' }, { ...ctx, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never, { sessionId: 's', tainted: false });
  assert.equal(r.decision.allowed, false); assert.equal(r.lancer, undefined); assert.equal(lance, false); assert.equal(demandes.length, 1);
  // les données du noyau ne s'écrivent pas par fs_write
  assert.throws(() => toolPath(ctx, join(tmpdir(), '.odin', 'config.json'), { ecriture: true }), /Donnée des garde-fous/);
  assert.throws(() => toolPath(ctx, join(tmpdir(), '.odin', 'logs', 'audit.jsonl'), { ecriture: true }), /Donnée des garde-fous/);
});

test('le réglage : « ne plus demander » est grave (ton bouton), « redemande à chaque fois » est immédiat ; le prompt dit la valeur', () => {
  const r = SETTINGS.code_validation;
  assert.equal(parseValue(r, 'à chaque fois'), 'chaque-fois'); assert.equal(parseValue(r, 'jamais'), 'jamais');
  assert.match(r.grave!('jamais', 'chaque-fois') ?? '', /ne plus te demander de validation pour réécrire mon code/);
  assert.equal(r.grave!('chaque-fois', 'jamais'), undefined);
  assert.equal(r.get(DEFAULT_CONFIG), 'chaque-fois');
  const p = buildSystemPrompt({ persona: '# Odin', name: 'Odin', now: new Date(), channel: 'web', workspace: '/w', summary: '', pinned: [], recalled: [], skillsIndex: '', tainted: false, codeValidation: 'chaque-fois' } as never);
  assert.match(p, /Réécrire ton code : tu demandes une validation à chaque fois/);
});

test('le noyau délimité au plus juste (note § 2.2 B)', () => {
  for (const f of ['src/heimdall/policy.ts', 'src/heimdall/injection.ts', 'src/heimdall/redact.ts', 'src/heimdall/executer.ts', 'src/heimdall/approbations.ts', 'src/heimdall/noyau-empreintes.json', 'src/mimir/decisions.ts', 'src/mimir/questions.ts', 'src/tools/self.ts', 'src/tools/reglages.ts', 'src/vault.ts']) assert.ok(estNoyau(f), f);
  for (const f of ['src/core/agent.ts', 'src/config.ts', 'src/runtime.ts', 'src/web/ui.html', 'src/brain/nous/calcul.ts']) assert.ok(!estNoyau(f), f);
  // l'appel à Heimdall n'est plus dans la boucle : agent.ts ne lance aucun outil directement
  const agent = readFileSync(join(RACINE_APPLI, 'src', 'core', 'agent.ts'), 'utf8');
  assert.doesNotMatch(agent, /tool\.run\(/); assert.match(agent, /deciderPuisLancer/);
});

test('intégrité : un garde-fou changé hors référence bloque toute action engageante (pas la lecture) jusqu\'à ta décision', async () => {
  const racine = tmp('integ-');
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true });
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\n'); writeFileSync(join(racine, 'src', 'heimdall', 'policy.ts'), 'règles\n');
  ecrireReference(racine);
  const { h } = heimdall({ validation: 'jamais', reponse: true });
  h.verifierIntegrite(racine);
  const ecrire: GateInput = { tool: 'fs_write', risk: 'write', summary: 'écrire', sessionId: 's', tainted: false };
  assert.equal((await h.gate(ecrire)).allowed, true);
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffrf\n');
  const d = await h.gate(ecrire);
  assert.equal(d.allowed, false); assert.match(String((d as { reason?: string }).reason), /restaurer le noyau.*accepter cette version/);
  assert.equal((await h.gate({ ...ecrire, tool: 'fs_read', risk: 'read' })).allowed, true, 'Odin reste joignable et lit');
  assert.equal((await h.gate({ ...ecrire, tool: 'self_accept_core', risk: 'exec', grave: 'accepter' })).allowed, true, 'ta décision (bouton) passe');
  ecrireReference(racine);
  assert.equal((await h.gate(ecrire)).allowed, true, 'version acceptée : débloqué');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(racine, FICHIER_EMPREINTES), 'utf8')).fichiers).sort(), Object.keys(calculerEmpreintes(racine)).sort());
});

test('les réponses aux validations : seul le propriétaire répond ; une demande inconnue ne vaut rien', async () => {
  const a = new Approbations();
  const p = a.attendre('a1', 60_000);
  assert.deepEqual(a.repondre('a1', 'oui', false), { ok: false, raison: 'Seul le propriétaire peut valider une action.' });
  assert.deepEqual(a.repondre('zz', 'oui', true), { ok: false, raison: 'Demande inconnue ou expirée.' });
  assert.equal(a.derniere(), 'a1');
  assert.deepEqual(a.repondre('a1', 'toujours', true), { ok: true, reponse: 'always' });
  assert.equal(await p, 'always'); assert.equal(a.taille, 0);
});

test('activation : un essai cassé bloque ; une réécriture qui ne tient pas est défaite au 2e démarrage ; la trace est écrite', async () => {
  const racine = tmp('act-'), home = tmp('act-home-');
  mkdirSync(join(racine, 'src'), { recursive: true }); mkdirSync(join(racine, 'test'), { recursive: true });
  writeFileSync(join(racine, 'src', 'page.ts'), 'export const v = 1;\n');
  writeFileSync(join(racine, 'test', 'page.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { v } from '../src/page.ts'; test('v', () => assert.equal(v, 1));\n");
  assert.equal(essaisDuLot(racine, ['src/page.ts']).ok, true);
  backupFile(home, racine, 'src/page.ts', 'lot-1');
  writeFileSync(join(racine, 'src', 'page.ts'), 'export const v = 2;\n');
  const e = essaisDuLot(racine, ['src/page.ts']);
  assert.equal(e.ok, false, 'un essai cassé : pas activé'); assert.deepEqual(e.essais, ['page.test.ts']);
  marquerActivation(home, 'lot-1');
  assert.equal(verifierActivation(home, racine, { confirmerApresMs: 60_000 }).etat, 'en-attente');
  const r = verifierActivation(home, racine);
  assert.equal(r.etat, 'defait'); assert.equal(readFileSync(join(racine, 'src', 'page.ts'), 'utf8'), 'export const v = 1;\n', 'retour arrière automatique');
  assert.equal(verifierActivation(home, racine).etat, 'rien');
  // trace d'une réécriture (self_edit) dans le journal d'audit
  const ws = tmp('act-ws-');
  const sortie = await selfEdit.run({ path: 'test/__essai-trace__.txt', content: 'x', reason: 'essai de trace' }, { home: ws, sessionId: 'web:p', channel: 'web', peer: 'p', isTainted: () => false } as never);
  try {
    assert.match(String(sortie), /^Modifié/);
    const journal = readFileSync(join(ws, 'logs', 'audit.jsonl'), 'utf8');
    assert.match(journal, /"evenement":"reecriture-code".*"fichier":"test[\\/]+__essai-trace__\.txt".*"pourquoi":"essai de trace"/);
  } finally { rmSync(join(RACINE_APPLI, 'test', '__essai-trace__.txt'), { force: true }); }
  assert.ok(!existsSync(join(RACINE_APPLI, 'test', '__essai-trace__.txt')));
});
