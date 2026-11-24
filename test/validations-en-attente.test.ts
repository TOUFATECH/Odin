// Une validation en attente n'est plus perdue : quand le propriétaire ouvre Odin (ou change de conversation), il voit
// toutes les demandes qui attendent encore sa réponse — celles d'Odin comme celles d'un membre de la famille — avec
// Autoriser / Refuser. Avant : la carte n'arrivait que par l'évènement en direct ; une page fermée au moment de la
// demande ne la voyait jamais (pas de carte, badge à 0, rien dans « À faire ») et elle expirait sans avoir été vue.
// Ne changent pas : le délai, l'expiration (rien ne part), la carte en direct, la façon de répondre (« /yes id »,
// « /no id », les mêmes boutons). Seul le propriétaire voit la liste : ni un membre, ni une personne sans session.
// Le membre ne lit plus « ✗ » devant « Demande envoyée » ; l'action d'un membre dit « à la demande de <nom> ».
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { AgentEvent } from '../src/types.ts';
import type { GateDecision } from '../src/heimdall/policy.ts';

const MDP = 'une-barque-rouge-sous-le-pont-de-pierre-63';
const IDS = ['var', 'frigg'];
const DELAI = 3;
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '', n = 0;
const RDV = Array.from({ length: 12 }, (_, i) => `rdv-att-${i.toString(36).padStart(2, '0')}`);
const rdv = (): string => RDV[n++];
const statut = (id: string) => ((valhallaOf()!.ctx('frigg').settings.bookings as Array<{ id: string; status: string }> | undefined) ?? []).find((b) => b.id === id)?.status;
/** Les demandes parties vers l'interface web (l'évènement que la page reçoit quand elle est ouverte). */
const parties: Array<{ peer: string; id: string }> = [];
const dorm = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(f: () => boolean, ms = 8000): Promise<boolean> { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await dorm(40); } return true; }
const repondre = (id: string, oui: boolean) => v.json('/api/message', { text: `/${oui ? 'yes' : 'no'} ${id}` });
type Attente = { id: string; peer: string; summary: string; reason: string; severity?: string; grantable: boolean; depuis: number; resteSec: number };
/** Ce que la page du propriétaire lit en s'ouvrant. */
const enAttente = async (cookie?: string) => { const r = await v.json('/api/validations/attente', undefined, cookie === undefined ? {} : { cookie }); return { status: r.status, list: (r.body.list ?? []) as Attente[] }; };
async function poster(chemin: string, corps: unknown, cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(v.url + chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie }, body: JSON.stringify(corps), redirect: 'manual' });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  v.o.cfg.web.portsParAppli = false;
  v.o.cfg.policy.approvalTimeoutSec = DELAI;
  const ev = v.web.event.bind(v.web);
  v.web.event = (peer: string, e: AgentEvent) => { if (e.type === 'approval') parties.push({ peer, id: (e as unknown as { id: string }).id }); ev(peer, e); };
  const va = valhallaOf()!;
  va.ctx('frigg').saveSettings({ bookings: RDV.map((id, i) => ({ id, service: 'Coupe', name: `Client ${i + 1}`, contact: 'client@example.org', start: '2031-03-04T10:00', end: '2031-03-04T10:30', status: 'confirmé' })) });
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-c', nom: 'Membre C', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'frigg']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-c' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-c', MDP); assert.ok(membre);
});
after(async () => {
  for (const x of parties) await repondre(x.id, false).catch(() => undefined);
  await tt.end(); Object.assign(console, orig);
});

// ---------------------------------------------------------------- la page fermée au moment de la demande
test('la demande d\'un membre, partie quand aucune page n\'est ouverte : le propriétaire la trouve en ouvrant Odin, et y répond', async () => {
  const id = rdv(), avant = parties.length;
  const r = await poster('/api/valhalla/act', { module: 'frigg', action: 'annuler', input: { id }, confirm: true }, membre);
  assert.equal(r.body.demande, true, JSON.stringify(r.body));
  assert.ok(await attendre(() => parties.length === avant + 1), 'la demande est partie vers l\'interface web');
  const q = parties.at(-1)!;
  // Le propriétaire ouvre Odin maintenant : la page lit les demandes encore en attente.
  const a = await enAttente();
  assert.equal(a.status, 200, 'la page du propriétaire peut lire ce qui l\'attend');
  const x = a.list.find((y) => y.id === q.id);
  assert.ok(x, `la demande du membre est là : ${JSON.stringify(a.list)}`);
  assert.match(x.summary, /Membre C/); assert.match(x.summary, /Chronos/); assert.match(x.summary, new RegExp(id));
  assert.equal(x.severity, 'grave'); assert.equal(x.grantable, false); assert.equal(x.peer, q.peer);
  assert.ok(x.depuis <= Date.now() && x.depuis > Date.now() - 10_000, 'depuis quand');
  assert.ok(x.resteSec > 0 && x.resteSec <= DELAI, `le temps qui reste : ${x.resteSec}`);
  // Même façon de répondre qu'avant (les boutons envoient « /yes id ») ; tranchée : elle quitte la liste.
  assert.equal((await repondre(q.id, true)).status, 202);
  assert.ok(await attendre(() => statut(id) === 'annulé'), 'son oui fait partir l\'action');
  assert.equal((await enAttente()).list.some((y) => y.id === q.id), false, 'une demande tranchée disparaît');
});

test('une validation d\'Odin, dans une autre conversation que « principal » : listée ; sans réponse elle expire, rien ne part, elle disparaît', async () => {
  const avant = parties.length;
  const g: Promise<GateDecision> = v.o.heimdall.gate({ tool: 'shell', risk: 'exec', summary: 'supprimer le dossier essai-a', sessionId: 'web:c-autre', tainted: false, grave: 'supprimer des fichiers' });
  assert.ok(await attendre(() => parties.length === avant + 1));
  const q = parties.at(-1)!; assert.equal(q.peer, 'c-autre');
  const x = (await enAttente()).list.find((y) => y.id === q.id);
  assert.ok(x, 'listée'); assert.equal(x.peer, 'c-autre'); assert.match(x.summary, /essai-a/); assert.match(x.reason, /GRAVE/);
  // Le délai ne change pas : sans réponse, Heimdall dit non ; la liste ne la montre plus.
  const d = await g;
  assert.equal(d.allowed, false, 'rien ne part');
  assert.equal((await enAttente()).list.some((y) => y.id === q.id), false, 'une demande expirée disparaît');
  // Répondre trop tard ne fait rien partir non plus.
  await repondre(q.id, true).catch(() => undefined);
});

test('seul le propriétaire lit les demandes en attente : ni un membre, ni une personne sans session', async () => {
  const avant = parties.length;
  const g = v.o.heimdall.gate({ tool: 'shell', risk: 'exec', summary: 'supprimer le dossier essai-b', sessionId: 'web:principal', tainted: false, grave: 'supprimer des fichiers' });
  assert.ok(await attendre(() => parties.length === avant + 1));
  const lui = await fetch(`${v.url}/api/validations/attente`, { headers: { cookie: membre } });
  const t = await lui.text();
  assert.ok(lui.status === 401 || lui.status === 403, `membre : ${lui.status}`); assert.doesNotMatch(t, /essai-b/);
  const nul = await fetch(`${v.url}/api/validations/attente`);
  const t2 = await nul.text();
  assert.equal(nul.status, 401); assert.doesNotMatch(t2, /essai-b/);
  assert.ok((await enAttente()).list.some((y) => /essai-b/.test(y.summary)), 'le propriétaire, lui, la voit');
  await repondre(parties.at(-1)!.id, false);
  assert.equal((await g).allowed, false);
});

// ---------------------------------------------------------------- la page (ui.html) : lue comme du texte, la fonction exécutée seule
/** Le texte d'une fonction nommée (`async function nom(` ou `function nom(`) : accolades comptées hors des chaînes et des commentaires. */
function fonction(src: string, nom: string): string {
  const i = src.search(new RegExp(`(async )?function ${nom}\\(`)); assert.ok(i >= 0, `${nom} introuvable`);
  let k = src.indexOf('{', src.indexOf(')', i)), prof = 0;
  for (let j = k; j < src.length; j++) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue; }
    if (c === '\'' || c === '"') { for (j++; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++; continue; }
    if (c === '{') prof++; else if (c === '}' && --prof === 0) return src.slice(i, j + 1);
  }
  throw new Error(`${nom} : fin introuvable`);
}
const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const VA = readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8');

/** Une page minimale autour de la fonction de la page qui rejoue les demandes en attente. */
function page(list: Array<Partial<Attente>>) {
  type Noeud = { isConnected: boolean; classList: Set<string> & { contains(c: string): boolean }; enfants: unknown[]; append(...x: unknown[]): void; querySelector(): { remove(): void } | null; texte?: string };
  const noeud = (texte?: string): Noeud => { const cl = new Set<string>() as Noeud['classList']; cl.contains = (c) => cl.has(c); return { isConnected: false, classList: cl, enfants: [], texte, append(...x) { this.enfants.push(...x); }, querySelector: () => ({ remove() {} }) }; };
  const cards = new Map<string, Noeud>(), pending = new Set<string>(), answered = new Set<string>(), crees: Array<Record<string, unknown>> = [];
  const msgs = { ajoutes: [] as Noeud[], append(b: Noeud) { b.isConnected = true; this.ajoutes.push(b); } };
  const compte = { badges: 0, home: 0 };
  const approvalCard = (e: Record<string, unknown>) => { if (cards.has(String(e.id))) return; crees.push(e); const b = noeud(); cards.set(String(e.id), b); pending.add(String(e.id)); msgs.append(b); };
  const el = (_t: string, _a: unknown, texte?: string) => noeud(texte);
  const src = fonction(UI, 'validationsEnAttente');
  const f = new Function('api', 'cards', 'pending', 'answered', 'msgs', 'approvalCard', 'el', 'badges', 'renderHome', 'setTimeout', 'clearTimeout',
    `let minuteurAttente, attenteLue = false; const ouvrirSurAFaire = () => {}; ${src}; return validationsEnAttente;`)(
    async (u: string) => (u === '/api/validations/attente' ? { ok: true, list } : {}), cards, pending, answered, msgs, approvalCard, el,
    () => { compte.badges++; }, () => { compte.home++; }, () => 0, () => {}) as () => Promise<void>;
  return { f, cards, pending, answered, msgs, crees, compte, noeud };
}

test('la page : chaque demande en attente a sa carte, une seule fois ; une carte déjà là (en direct) n\'est pas refaite ; le badge et l\'accueil sont recomptés', async () => {
  const p = page([{ id: 'a1', peer: 'principal', summary: 'Membre C (membre de la famille) demande, dans Chronos : annuler', reason: 'GRAVE : …', severity: 'grave', grantable: false, depuis: Date.now() - 20_000, resteSec: 200 },
    { id: 'a2', peer: 'c-autre', summary: 'supprimer le dossier essai-a', reason: 'GRAVE : …', severity: 'grave', grantable: false, depuis: Date.now() - 5_000, resteSec: 280 }]);
  // a2 est déjà arrivée en direct, dans cette page.
  const b2 = p.noeud(); b2.isConnected = true; p.cards.set('a2', b2); p.pending.add('a2');
  await p.f();
  assert.deepEqual(p.crees.map((e) => e.id), ['a1'], 'seule la demande absente est ajoutée');
  assert.match(String(p.crees[0].quand ?? ''), /\d/, 'depuis quand et jusqu\'à quand, sur la carte');
  assert.deepEqual([...p.pending].sort(), ['a1', 'a2']);
  assert.ok(p.compte.badges >= 1 && p.compte.home >= 1, 'badge et « À faire » recomptés');
  // Une seconde lecture (changement de conversation) ne double rien.
  await p.f(); assert.equal(p.crees.length, 1);
});

test('la page : en changeant de conversation, une carte en attente qui n\'est plus affichée revient (la même, pas une copie)', async () => {
  const p = page([{ id: 'a3', peer: 'principal', summary: 's', reason: 'r', severity: 'grave', grantable: false, depuis: Date.now(), resteSec: 100 }]);
  const b = p.noeud(); b.isConnected = false; p.cards.set('a3', b); p.pending.add('a3');
  await p.f();
  assert.equal(p.crees.length, 0); assert.equal(p.msgs.ajoutes[0], b, 'la même carte, remise dans la conversation ouverte');
});

test('la page : une demande expirée ou tranchée ailleurs perd ses boutons et n\'est plus comptée ; une carte à laquelle il vient de répondre n\'est pas refaite', async () => {
  const p = page([{ id: 'a5', peer: 'principal', summary: 's', reason: 'r', severity: 'grave', grantable: false, depuis: Date.now(), resteSec: 100 }]);
  const b4 = p.noeud(); b4.isConnected = true; p.cards.set('a4', b4); p.pending.add('a4');
  // a5 : il vient de toucher « Autoriser » ici ; le serveur ne l'a pas encore retirée.
  const b5 = p.noeud(); b5.isConnected = true; b5.classList.add('done'); p.cards.set('a5', b5); p.answered.add('a5');
  await p.f();
  assert.equal(p.pending.has('a4'), false, 'a4 n\'est plus comptée'); assert.ok(b4.classList.has('done'), 'a4 perd ses boutons');
  assert.equal(p.pending.has('a5'), false); assert.equal(p.crees.length, 0, 'rien de refait');
});

test('la page : une carte arrivée en direct pendant la lecture n\'est pas marquée « plus en attente »', async () => {
  const p = page([]);
  const b6 = p.noeud(); b6.isConnected = true;
  // L'évènement en direct arrive pendant que la lecture est en route (la liste lue ne la contient pas encore).
  const f = p.f(); p.cards.set('a6', b6); p.pending.add('a6'); await f;
  assert.equal(p.pending.has('a6'), true); assert.equal(b6.classList.has('done'), false);
});

test('la page lit les demandes en attente au chargement et à chaque changement de conversation (loadHistory)', () => {
  assert.match(fonction(UI, 'loadHistory'), /validationsEnAttente\(\)/);
  // La carte en direct ne change pas : toujours filtrée sur la conversation ouverte.
  assert.match(UI, /d\.type === 'event' && d\.event\.type === 'approval' && d\.peer === peer\) \{ notifyOwner\('Odin a besoin de toi'/);
});

// ---------------------------------------------------------------- valhalla.js : ce que lit le membre, ce que lit le propriétaire
test('le membre ne lit pas « ✗ » devant « Demande envoyée » ; un vrai refus garde son « ✗ »', async () => {
  for (const nom of ['runOther', 'runFull']) {
    const src = fonction(VA, nom);
    const run = (rep: Record<string, unknown>) => new Function('api', 'window', 'openApp', 'cur', 'pagePostes', 'viewQ', 'actParams', 'show', 'setTimeout',
      `${fonction(VA, 'rateOuDemande')}; ${src}; return ${nom};`)(async () => rep, { OdinDialog: { confirm: async () => false } }, () => {}, null, false, {}, {}, () => {}, () => 0) as (m: string, a: string, i: unknown) => Promise<string | { text: string }>;
    const t = async (rep: Record<string, unknown>) => { const x = await run(rep)('frigg', 'annuler', { id: 'x' }); return typeof x === 'string' ? x : x.text; };
    const envoyee = await t({ ok: false, code: 'reserve', demande: true, text: 'Demande envoyée à Awa : elle ne part qu\'avec son accord.' });
    assert.doesNotMatch(envoyee, /✗/, `${nom} : ${envoyee}`); assert.match(envoyee, /Demande envoyée/);
    assert.match(await t({ ok: false, code: 'refuse', text: 'Tu n\'as pas accès à Chronos.' }), /^✗ /, `${nom} : un refus reste un refus`);
  }
});

test('« Ce qu\'Odin a fait » : l\'action d\'un membre dit « à la demande de <nom> (membre de la famille) », et cinq actions de membres ne chassent pas ce qu\'Odin a fait lui-même', () => {
  const parQui = new Function(`${fonction(VA, 'parQui')}; return parQui;`)() as (m: Record<string, unknown>) => string;
  assert.equal(parQui({ by: 'membre', par: { login: 'membre-c', name: 'Membre C' } }), 'à la demande de Membre C (membre de la famille)');
  assert.doesNotMatch(parQui({ by: 'membre', par: { login: 'membre-c', name: 'Membre C' } }), /assistant/);
  assert.equal(parQui({ by: 'odin' }), 'Odin, de lui-même');
  const tri = new Function(`${fonction(VA, 'manipsMontrees')}; return manipsMontrees;`)() as (l: Array<Record<string, unknown>>) => { todo: unknown[]; odin: Array<{ id: string }>; membres: Array<{ id: string }> };
  const l = [...Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, by: 'membre', par: { login: 'membre-c', name: 'Membre C' }, state: 'gardée' })),
    { id: 'o1', by: 'odin', state: 'gardée' }, { id: 'o2', by: 'automatisation', state: 'gardée' }, { id: 'o3', by: 'odin', state: 'à décider' }];
  const t = tri(l);
  assert.deepEqual(t.odin.map((m) => m.id), ['o1', 'o2'], 'ce qu\'Odin a fait reste visible');
  assert.equal(t.membres.length, 5, 'cinq actions de membres au plus, à part'); assert.deepEqual(t.todo.map((m) => (m as { id: string }).id), ['o3']);
});

// ---------------------------------------------------------------- après relecture : les cas où la liste n'était pas relue
test('le flux qui se reconnecte (téléphone sorti de veille, appli reprise) relit les demandes en attente', () => {
  const onopen = /es\.onopen = \(\) => \{[^\n]*\};/.exec(UI)?.[0] ?? '';
  assert.match(onopen, /if \(everOpened\) \{[^}]*validationsEnAttente\(\)[^}]*\}/, onopen);
});

test('une demande arrivée en direct dans une autre conversation que celle ouverte relit la liste (carte et badge), sans changer la carte en direct', () => {
  assert.match(UI, /d\.type === 'event' && d\.event\.type === 'approval' && d\.peer !== peer\) void validationsEnAttente\(\);/);
  // La carte en direct reste filtrée sur la conversation ouverte.
  assert.match(UI, /else if \(d\.type === 'event' && d\.event\.type === 'approval' && d\.peer === peer\) \{ notifyOwner\('Odin a besoin de toi', d\.event\.summary \|\| 'Une validation est demandée\.'\); approvalCard\(d\.event\); moodFlash\('inquiet', 4000\); \}/);
});

test('après une réponse (ici ou ailleurs), « À faire » de l\'accueil est recompté, pas seulement le badge', async () => {
  const compte = { badges: 0, home: 0 }, noeud = () => ({ classList: new Set<string>(), querySelector: () => ({ remove() {} }), append() {} });
  for (const nom of ['approvalDone', 'answer']) {
    const cards = new Map([['z1', noeud()]]), pending = new Set(['z1']), answered = new Set<string>();
    const f = new Function('cards', 'pending', 'answered', 'el', 'badges', 'renderHome', 'api', 'peer', `${fonction(UI, nom)}; return ${nom};`)(
      cards, pending, answered, () => noeud(), () => { compte.badges++; }, () => { compte.home++; }, async () => ({ ok: true }), 'principal') as (...a: unknown[]) => Promise<void> | void;
    const avant = compte.home;
    await (nom === 'answer' ? f('z1', true, cards.get('z1')) : f({ id: 'z1', answer: 'yes' }));
    assert.equal(pending.has('z1'), false, nom); assert.ok(compte.home > avant, `${nom} : l'accueil est recompté`);
  }
});

test('« Demande envoyée » n\'est pas compté comme une réussite (les fichiers et l\'écran restent), et un texte réussi qui commence par ⏳ reste une réussite', async () => {
  const run = new Function('api', 'window', 'openApp', 'cur', 'pagePostes', 'viewQ', 'actParams', 'show', 'setTimeout',
    `${fonction(VA, 'rateOuDemande')}; ${fonction(VA, 'runFull')}; return runFull;`);
  const lance = (rep: Record<string, unknown>) => run(async () => rep, {}, () => {}, null, false, {}, {}, () => {}, () => 0)('frigg', 'annuler', { id: 'x' }) as Promise<{ text: string; demande?: boolean }>;
  const pasFait = new Function(`${fonction(VA, 'pasFait')}; return pasFait;`)() as (r: { text: string; demande?: boolean }) => boolean;
  assert.equal(pasFait(await lance({ ok: false, demande: true, text: 'Demande envoyée à Awa.' })), true, 'une demande envoyée n\'est pas faite');
  assert.equal(pasFait(await lance({ ok: false, text: 'Tu n\'as pas accès à Chronos.' })), true);
  assert.equal(pasFait(await lance({ ok: true, text: '⏳ Noté : réponse attendue avant le 3 mars.' })), false, 'un texte réussi en ⏳ reste réussi');
  assert.equal(pasFait({ text: 'Annulé.' }), true);
  // Les trois endroits qui décidaient « réussi » sur le seul « ✗ » passent par la même règle.
  assert.equal((VA.match(/startsWith\('✗'\)/g) ?? []).length, 1, 'un seul test du « ✗ », dans pasFait');
  assert.equal((VA.match(/pasFait\(/g) ?? []).length, 4, 'pasFait défini, et utilisé aux trois endroits');
});

test('« À voir » : l\'action d\'un membre ne dit pas son nom deux fois ; sa demande validée par toi reste dite', () => {
  const raison = new Function(`${fonction(VA, 'raisonMontree')}; return raisonMontree;`)() as (m: Record<string, unknown>) => string;
  const par = { login: 'membre-b', name: 'Membre B' };
  assert.equal(raison({ by: 'membre', par, why: 'fait par Membre B (membre de la famille), sa demande validée par toi' }), 'sa demande validée par toi');
  assert.equal(raison({ by: 'membre', par, why: 'fait par Membre B (membre de la famille)' }), '');
  assert.equal(raison({ by: 'membre', par, why: 'autre raison' }), 'autre raison', 'une autre raison est gardée telle quelle');
  assert.equal(raison({ by: 'odin', why: 'fait par Membre B (membre de la famille)' }), 'fait par Membre B (membre de la famille)', 'hors membre : rien ne change');
  assert.equal(raison({ by: 'réflexe' }), '');
});
