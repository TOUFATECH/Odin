// Le fil d'une personne, lu par pages (GET /api/fil) : toutes ses conversations assemblées dans l'ordre des dates, le
// titre de chacune en séparateur, du plus récent au plus ancien avec un curseur stable. Le serveur choisit la personne
// d'après le compte connecté (jamais un paramètre envoyé par la page) ; la compaction n'efface rien de ce qui est rendu
// (lecture de tous les messages, pas de l'historique actif) ; le texte reste du texte. Rien ne change à l'écran.
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { assembler, lirePage, sessionDuMembre, sessionsDuFil, type ElementFil } from '../src/muninn/fil.ts';
import { filDe, filRoute } from '../src/web/fil-api.ts';

const MDP = 'une-lanterne-verte-au-bout-du-quai-41';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

/** Ajoute un message à une date choisie (la mémoire date chaque message à l'instant de l'écriture). */
function ecrire(mu: Mnemosyne, session: string, role: 'user' | 'assistant', texte: string, date: number): number {
  const vrai = Date.now; Date.now = () => date;
  try { return mu.addMessage(session, { role, content: texte }); } finally { Date.now = vrai; }
}
const messages = (l: ElementFil[]) => l.filter((x) => x.type === 'message') as Array<Extract<ElementFil, { type: 'message' }>>;
const separateurs = (l: ElementFil[]) => l.filter((x) => x.type === 'separateur') as Array<Extract<ElementFil, { type: 'separateur' }>>;

// ---------------------------------------------------------------- l'assemblage, sans serveur

test('les sessions d\'une personne : le propriétaire a ses conversations de la Discussion, un membre la sienne seulement', () => {
  const s = (id: string, channel = 'web') => ({ id, channel, title: '' });
  // « web:raccourci » (POST /api/ask) : dans le fil, marqué « depuis le téléphone » (sa réponse du 19/11 : « Oui, avec une étiquette »).
  const toutes = [s('web:principal'), s('web:c-mabc12'), s('web:maison'), s('web:venus'), s('web:voix'), s('web:cerveau'), s('web:reglages'),
    s('web:raccourci'), s('web:membre-camille'), s('web:principal:sub:1'), s('web:c-mabc12:sub:2'), s('telegram:42', 'telegram'), s('cron:j1', 'cron')];
  assert.deepEqual(sessionsDuFil({ proprio: true }, toutes).sort(), ['web:c-mabc12', 'web:principal', 'web:raccourci'], 'ni les écrans techniques, ni un membre, ni un sous-agent, ni une messagerie');
  // Les messageries du propriétaire : un paramètre prévu pour plus tard, que la route ne passe pas.
  assert.deepEqual(sessionsDuFil({ proprio: true }, toutes, { messageries: ['telegram:42', 'web:membre-camille', 'telegram:inconnu'] }).sort(), ['telegram:42', 'web:c-mabc12', 'web:principal', 'web:raccourci']);
  assert.deepEqual(sessionsDuFil({ login: 'camille' }, toutes), ['web:membre-camille'], 'un membre : la sienne seulement');
  assert.deepEqual(sessionsDuFil({ login: 'camille' }, toutes, { messageries: ['telegram:42'] }), ['web:membre-camille'], 'jamais les messageries du propriétaire');
  assert.deepEqual(sessionsDuFil({ login: 'sacha' }, toutes), [], 'un membre sans conversation : rien');
  assert.equal(sessionDuMembre('cam.ille'), undefined, 'un identifiant que le nom de session raccourcirait : rien plutôt que celle d\'un autre');
  assert.equal(sessionDuMembre('camille'), 'web:membre-camille');
});

test('l\'assemblage : ordre des dates, un séparateur au début de chaque conversation (et à chaque reprise), pages sans doublon ni trou', () => {
  const mu = new Mnemosyne(':memory:');
  mu.ensureSession('web:principal', 'web', 'principal'); mu.ensureSession('web:c-ancienne', 'web', 'c-ancienne');
  const t0 = 1_800_000_000_000;
  ecrire(mu, 'web:c-ancienne', 'user', 'a1', t0 + 1); ecrire(mu, 'web:c-ancienne', 'assistant', 'a2', t0 + 2);
  ecrire(mu, 'web:principal', 'user', 'p1', t0 + 3); ecrire(mu, 'web:c-ancienne', 'user', 'a3', t0 + 4);
  ecrire(mu, 'web:principal', 'assistant', 'p2', t0 + 5); ecrire(mu, 'web:principal', 'user', 'p3', t0 + 5);
  mu.addMessage('web:principal', { role: 'tool', content: 'sortie d\'outil', toolName: 'shell' });
  const sess = [{ id: 'web:principal', channel: 'web', title: '' }, { id: 'web:c-ancienne', channel: 'web', title: 'Réseau du salon' }];
  const bulles = assembler(sess, (id) => mu.allMessages(id));
  assert.deepEqual(bulles.map((b) => b.texte), ['a1', 'a2', 'p1', 'a3', 'p2', 'p3'], 'par date, puis par numéro ; les sorties d\'outils ne sont pas des bulles');
  const tout = lirePage(bulles, { n: 100 });
  assert.deepEqual(tout.elements.map((e) => (e.type === 'separateur' ? `[${e.titre}]` : e.texte)), ['[Réseau du salon]', 'a1', 'a2', '[]', 'p1', '[Réseau du salon]', 'a3', '[]', 'p2', 'p3']);
  assert.equal(separateurs(tout.elements)[0].debut, t0 + 1, 'la date du séparateur : le premier message de la conversation');
  assert.equal(tout.suite, null);
  // Par pages de deux, du plus récent au plus ancien.
  const vus: string[] = []; let avant: string | undefined; let tours = 0;
  do { const p = lirePage(bulles, { n: 2, avant }); vus.unshift(...messages(p.elements).map((m) => m.texte)); avant = p.suite ?? undefined; tours++; } while (avant && tours < 10);
  assert.deepEqual(vus, ['a1', 'a2', 'p1', 'a3', 'p2', 'p3']); assert.equal(tours, 3);
  assert.throws(() => lirePage(bulles, { n: 2, avant: 'n-importe-quoi' }), /curseur/);
});

test('un membre ne lit que sa conversation, le propriétaire jamais celle d\'un membre', () => {
  const mu = new Mnemosyne(':memory:');
  for (const id of ['web:principal', 'web:membre-camille', 'web:membre-sacha']) mu.ensureSession(id, 'web', id.slice(4));
  mu.addMessage('web:principal', { role: 'user', content: 'texte du propriétaire' });
  mu.addMessage('web:membre-camille', { role: 'user', content: 'texte de camille' });
  mu.addMessage('web:membre-sacha', { role: 'user', content: 'texte de sacha' });
  const textes = (q: Parameters<typeof filDe>[1]) => messages(filDe(mu, q, {}).elements).map((m) => m.texte);
  assert.deepEqual(textes({ login: 'camille' }), ['texte de camille']);
  assert.deepEqual(textes({ login: 'sacha' }), ['texte de sacha']);
  assert.deepEqual(textes({ proprio: true }), ['texte du propriétaire']);
  assert.deepEqual(textes({ login: 'personne' }), []);
});

test('la route seule : le port direct d\'une appli ne lit pas le fil, même avec la session du propriétaire ; chaque refus a un code stable', async () => {
  const mu = new Mnemosyne(':memory:');
  mu.ensureSession('web:principal', 'web', 'principal'); mu.addMessage('web:principal', { role: 'user', content: 'texte du propriétaire' });
  const appeler = async (chemin: string, direct?: string) => {
    let statut = 0, corps = '';
    const res = { writeHead: (c: number) => { statut = c; return res; }, end: (b?: string) => { corps = b ?? ''; } };
    const vu = await filRoute({ method: 'GET' } as never, res as never, new URL(chemin, 'http://odin.example.org'), { qui: () => ({ proprio: true }), direct, mu });
    return { vu, statut, corps: (corps ? JSON.parse(corps) : {}) as { ok?: boolean; code?: string; elements?: unknown[] } };
  };
  const d = await appeler('/api/fil', 'var');
  assert.equal(d.statut, 403, 'le port direct d\'une appli'); assert.equal(d.corps.code, 'refuse'); assert.ok(!JSON.stringify(d.corps).includes('texte du propriétaire'));
  const ok = await appeler('/api/fil'); assert.equal(ok.statut, 200); assert.equal(messages(ok.corps.elements as ElementFil[]).length, 1);
  assert.equal((await appeler('/api/fil?n=0')).corps.code, 'invalide');
  assert.equal((await appeler('/api/fil?avant=abc')).corps.code, 'curseur');
  assert.equal((await appeler('/api/autre')).vu, false, 'une autre adresse n\'est pas la sienne');
});

// ---------------------------------------------------------------- la route, dans un vrai Odin d'essai

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const T0 = 1_800_000_000_000;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-f', nom: 'Membre F', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-f' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-f', MDP); assert.ok(membre);
  const mu = v.o.muninn;
  for (const [id, peer] of [['web:principal', 'principal'], ['web:c-ancienne', 'c-ancienne'], ['web:maison', 'maison'], ['web:membre-membre-f', 'membre-membre-f']]) mu.ensureSession(id, 'web', peer);
  mu.setKv('title:c-ancienne', 'Box Internet');
  ecrire(mu, 'web:c-ancienne', 'user', 'ancienne question', T0 + 10);
  ecrire(mu, 'web:c-ancienne', 'assistant', 'ancienne réponse', T0 + 20);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0 + 30);
  ecrire(mu, 'web:principal', 'assistant', '<img src=x onerror=alert(1)> **gras**', T0 + 40);
  ecrire(mu, 'web:maison', 'user', 'question de l\'écran de la maison', T0 + 45);
  ecrire(mu, 'web:membre-membre-f', 'user', 'question du membre', T0 + 46);
  ecrire(mu, 'web:c-ancienne', 'user', 'retour dans l\'ancienne', T0 + 50);
  ecrire(mu, 'web:principal', 'user', 'dernière question', T0 + 60);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('GET /api/fil : le propriétaire lit toutes ses conversations dans l\'ordre des dates, avec les titres en séparateurs', async () => {
  const r = await v.json('/api/fil');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.headers.get('content-type') ?? '', /^application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const el = r.body.elements as ElementFil[];
  assert.deepEqual(el.map((e) => (e.type === 'separateur' ? `[${e.titre}]` : e.texte)),
    ['[Box Internet]', 'ancienne question', 'ancienne réponse', '[]', 'bonjour', '<img src=x onerror=alert(1)> **gras**', 'question de l\'écran de la maison', '[Box Internet]', 'retour dans l\'ancienne', '[]', 'dernière question']);
  // Les écrans techniques sont dans le fil, étiquetés (sa réponse du 19/11 : « Dans le fil, étiquetés »).
  assert.ok(!JSON.stringify(r.body).includes('membre'), 'rien d\'un membre'); assert.equal(messages(el).find((m) => m.session === 'web:maison')?.origine, 'maison', 'l\'écran de la maison, étiqueté');
  assert.equal(r.body.suite, null);
  // La page ne choisit pas la personne : ses paramètres sont ignorés.
  const force = await v.json('/api/fil?peer=membre-membre-f&session=web:membre-membre-f&qui=membre-f');
  assert.deepEqual(force.body.elements, r.body.elements);
});

test('la compaction n\'efface rien de ce que /api/fil rend (l\'historique actif, lui, ne garde que la suite)', async () => {
  const mu = v.o.muninn, avant = (await v.json('/api/fil')).body.elements as ElementFil[];
  assert.equal(messages(avant ?? []).length, 7, 'le fil avant la compaction (écran de la maison compris)');
  const dernier = Math.max(...mu.allMessages('web:principal').map((m) => m.id));
  mu.compact('web:principal', dernier, 'résumé'); mu.resetSession('web:c-ancienne');
  assert.deepEqual(((await v.json('/api/history?peer=principal')).body.messages as unknown[]), [], 'l\'historique actif est vide après la compaction');
  assert.deepEqual((await v.json('/api/fil')).body.elements, avant, 'le fil, lui, n\'a rien perdu');
});

test('par pages, du plus récent au plus ancien : un message arrivé pendant la lecture ne crée ni doublon ni trou', async () => {
  const lus: string[] = [];
  const p1 = await v.json('/api/fil?n=2'); assert.equal(p1.status, 200);
  lus.unshift(...messages(p1.body.elements as ElementFil[]).map((m) => m.texte));
  assert.deepEqual(lus, ['retour dans l\'ancienne', 'dernière question']);
  ecrire(v.o.muninn, 'web:principal', 'user', 'arrivé pendant la lecture', T0 + 70);
  let suite = p1.body.suite as string | null, tours = 0;
  while (suite && tours++ < 10) {
    const p = await v.json(`/api/fil?n=2&avant=${encodeURIComponent(suite)}`); assert.equal(p.status, 200);
    lus.unshift(...messages(p.body.elements as ElementFil[]).map((m) => m.texte)); suite = p.body.suite as string | null;
  }
  assert.deepEqual(lus, ['ancienne question', 'ancienne réponse', 'bonjour', '<img src=x onerror=alert(1)> **gras**', 'question de l\'écran de la maison', 'retour dans l\'ancienne', 'dernière question']);
  const neuf = await v.json('/api/fil?n=1');
  assert.deepEqual(messages(neuf.body.elements as ElementFil[]).map((m) => m.texte), ['arrivé pendant la lecture'], 'le nouveau message est en tête de la première page');
  assert.equal((await v.json('/api/fil?avant=abc')).status, 400);
  assert.equal((await v.json('/api/fil?n=-3')).status, 400);
});

test('un membre, une clé de tablette, une visite : rien du fil du propriétaire', async () => {
  const m = await v.json('/api/fil', undefined, { cookie: membre });
  assert.equal(m.status, 403, 'un membre n\'a pas encore sa conversation dans l\'interface');
  for (const t of ['bonjour', 'Box Internet', 'ancienne']) assert.ok(!JSON.stringify(m.body).includes(t));
  assert.equal((await v.json('/api/fil', undefined, { cookie: '' })).status, 401, 'une visite sans session');
  assert.equal((await v.json('/api/fil', undefined, { authorization: 'Bearer cle-de-tablette-inconnue' })).status, 401, 'une clé qui n\'est pas celle d\'Odin');
  const cle = await v.json('/api/fil', undefined, { authorization: `Bearer ${v.token}` });
  assert.equal(cle.status, 403, 'la clé d\'API n\'est pas une personne : le serveur ne sait pas à qui est le fil'); assert.equal(cle.body.code, 'refuse');
  assert.ok(!JSON.stringify(cle.body).includes('bonjour'));
  assert.equal((await v.json('/api/fil', {})).status, 405, 'lecture seule');
});
