// Retrait des modèles d'autrui, tranche 3 : « sans modèle » n'est plus « démo ».
//
// Un Odin sans modèle de langue est un vrai Odin : la passerelle démarre sans fournisseur (aucun écho de démonstration),
// Soul apprend, les mises à jour, les alertes et les prix tournent, et l'accès suit la même règle qu'un Odin configuré
// (la fenêtre d'une heure se ferme aussi sans modèle). Ce qui demandait un modèle de langue le teste par la porte
// (`odin.modele.pret()`). Aucune adresse extérieure n'est appelée : un faux `fetch` note tout ce qui sortirait.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOdin } from '../src/runtime.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { depsNousOdin, viderVersCorpus } from '../src/brain/nous/file-odin.ts';
import { fileBornee } from '../src/brain/nous/deps.ts';
import { nourrir } from '../src/brain/nous/entree.ts';
import { Notices, noticeBus, type Notice } from '../src/valhalla/notices.ts';
import { MARQUE_JUGE_LOCAL } from '../src/migrations/aucun-modele-externe.ts';
import { selfTest } from '../src/selftest.ts';
import { modeleDe } from '../src/web/conversation-api.ts';
import { settingsView } from '../src/settings.ts';
import { optionsOdin as mathesisOdin } from '../src/valhalla/mathesis/branchement.ts';
import { ModelePasEntraine } from '../src/langue/pas-entraine.ts';
import { appVersions } from '../src/tools/self.ts';
import { makeOdin } from './helpers.ts';

// ---------- Aucune sortie : chaque adresse demandée est notée ; seul 127.0.0.1 (le serveur de l'essai) passe.
const vraiFetch = globalThis.fetch;
const sorties: string[] = [];
globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
  const url = typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
  if (/^https?:\/\/127\.0\.0\.1[:/]/.test(url)) return vraiFetch(u, init);
  sorties.push(url);
  throw new Error('aucune sortie pendant cet essai');
}) as typeof fetch;
const dossiers: string[] = [];
after(() => { globalThis.fetch = vraiFetch; for (const d of dossiers) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); });

/** Les clés des services de modèles retirées le temps de l'essai (une machine de développement peut en avoir). */
const CLES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'CUSTOM_API_KEY'];
function sansCles<T>(f: () => T): T {
  const avant = Object.fromEntries(CLES.map((k) => [k, process.env[k]]));
  for (const k of CLES) delete process.env[k];
  const local = process.env.ODIN_NO_LOCAL_BRAIN; process.env.ODIN_NO_LOCAL_BRAIN = '1';
  try { return f(); } finally {
    for (const [k, v] of Object.entries(avant)) if (v !== undefined) process.env[k] = v;
    if (local === undefined) delete process.env.ODIN_NO_LOCAL_BRAIN; else process.env.ODIN_NO_LOCAL_BRAIN = local;
  }
}
function odinSansModele() {
  const home = mkdtempSync(join(tmpdir(), 'odin-sans-modele-')); dossiers.push(home);
  return sansCles(() => createOdin({ home }));
}
const port = () => 21000 + Math.floor(Math.random() * 20000);

test('la passerelle démarre sans fournisseur : pas de démo, pas d\'écho, la porte du modèle est vide, rien ne sort', async () => {
  const odin = odinSansModele();
  try {
    assert.equal('demo' in odin, false, 'plus de drapeau « démo »');
    assert.equal(odin.modele.pret(), false, 'aucun modèle de langue prêt');
    assert.equal(odin.agent.deps.offlineOnly, true, 'Odin répond par ses actions directes et sa mémoire');
    const r = await odin.agent.run('bonjour Odin', { sessionId: 'essai:sans-modele', trusted: true });
    assert.doesNotMatch(r.text, /mode démo|Tu as dit/, 'aucun écho de démonstration');
    // Un appel direct au modèle (ce que font encore certaines tâches) répond « pas encore », sans rien envoyer.
    // L'erreur arrive telle quelle (pas emballée par le routeur) : son type reste, aucun nom interne ni « Tous les fournisseurs ».
    const telleQuelle = (e: unknown) => e instanceof ModelePasEntraine && /rédiger une réponse libre/.test(e.message) && !/Tous les fournisseurs|aucun-modele|essai 1/.test(e.message);
    for (let i = 0; i < 2; i++) await assert.rejects(odin.agent.deps.router.complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: 10 }), telleQuelle);
    await assert.rejects(odin.agent.ask('s', 'u', 50), telleQuelle);
    assert.deepEqual(sorties, [], 'aucune adresse extérieure appelée');
  } finally { odin.close(); }
});

test('sans modèle, Soul apprend : ce qu\'Odin lui donne est rangé dans le corpus', () => {
  const odin = odinSansModele();
  try {
    const file = fileBornee(100);
    nourrir({ ...depsNousOdin(odin), essai: false, file }, { sorte: 'note', texte: 'Le compost se retourne chaque mois, à l\'ombre.', source: 'mathesis:page', fiable: true });
    assert.equal(file.taille(), 1, 'nourri');
    const b = viderVersCorpus(odin, { file });
    assert.equal(b.raison, undefined, b.raison);
    assert.equal(b.ecrits, 1, 'rangé dans le corpus');
    // Un ancien drapeau « démo » n'arrête plus rien (il n'existe plus).
    const f2 = fileBornee(10);
    nourrir({ cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => false, demo: true, essai: false, file: f2 } as never, { sorte: 'note', texte: 'Une phrase de plus pour Soul.', source: 'x', fiable: true });
    assert.equal(f2.taille(), 1);
  } finally { odin.close(); }
});

test('sans modèle, les mises à jour, les alertes, les prix et Mathésis ne sont plus arrêtés', () => {
  const src = readFileSync(new URL('../src/bifrost/gateway.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.demo\b/, 'la passerelle ne connaît plus la démo');
  const corps = (nom: string) => { const i = src.indexOf(`  async ${nom}(`); assert.ok(i > 0, nom); return src.slice(i, src.indexOf('\n  }\n', i)); };
  for (const nom of ['updateLoop', 'updateNow', 'applyUpdate']) assert.doesNotMatch(corps(nom), /modele|demo/i, `${nom} ne dépend pas du modèle`);
  const alertes = src.split('\n').find((l) => l.includes("getKv('alerts-tick')"))!, prix = src.split('\n').findIndex((l) => l.includes('checkPrices(kv, now)'));
  assert.doesNotMatch(alertes, /modele|demo/i, 'alertes locales');
  assert.doesNotMatch(src.split('\n').slice(prix - 2, prix + 1).join('\n'), /modele|demo/i, 'prix suivis et prélèvements');
  // Mathésis cherche sur le web comme d'habitude (seuls les essais et les bancs restent sans réseau).
  const m = mathesisOdin({ cfg: {}, demo: true } as never, { env: {} });
  assert.equal(m.transport, undefined, 'le réseau de Mathésis n\'est plus coupé par une démo');
  // L'interface du runtime et la ligne de commande n'ont plus de démo.
  assert.doesNotMatch(readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8'), /\bdemo\??:/);
  const cli = readFileSync(new URL('../src/cli/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /--demo|demoProvider/, 'option --demo retirée');
  assert.doesNotMatch(readFileSync(new URL('../src/providers/mock.ts', import.meta.url), 'utf8'), /demoProvider/, 'plus d\'écho de démonstration');
});

test('accès : sans modèle, la première connexion sans jeton se ferme après une heure ; avec un modèle, rien n\'est assoupli', async () => {
  const H = { 'x-odin': '1', 'content-type': 'application/json' };
  const corps = JSON.stringify({ prenom: 'Awa', nom: 'Saïd', email: 'awa@exemple.yt', password: 'un-cheval-bleu-traverse-mamoudzou' });
  // 1. Sans modèle, démarré il y a 5 h : refusé (avant : ouvert sans limite de temps).
  {
    const o = makeOdin([]); o.modele = { pret: () => false };
    const p = port(), token = ensureWebToken(o.paths);
    const web = new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, scryptN: 1024 });
    (web as unknown as { startedAt: number }).startedAt = Date.now() - 5 * 3600_000;
    const gw = new Gateway(o, { owners: { web: ['*'] } }); gw.add(web); await gw.start();
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: H, body: corps });
      assert.equal(r.status, 403, 'plus d\'une heure après le démarrage : il faut le lien ou une demande d\'accès');
      assert.match((await r.json() as { error: string }).error, /plus d'une heure/);
    } finally { await gw.stop(); o.cleanup(); }
  }
  // 2. Sans modèle, dans l'heure, ancienne trace de connexion (réinstallation) : la création reste possible.
  {
    const o = makeOdin([]); o.modele = { pret: () => false };
    writeFileSync(join(o.paths.home, 'web-claimed'), 'ancienne installation\n');
    const p = port(), token = ensureWebToken(o.paths);
    const gw = new Gateway(o, { owners: { web: ['*'] } }); gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, scryptN: 1024 })); await gw.start();
    try {
      assert.equal((await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: H, body: corps })).status, 200);
      // La fenêtre se ferme après la première connexion : une seconde création, même dans l'heure, est refusée.
      const r2 = await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: H, body: JSON.stringify({ prenom: 'Intrus', nom: 'X', email: 'intrus@exemple.yt', password: 'un-autre-cheval-vert-traverse-dzaoudzi' }) });
      assert.equal(r2.status, 409, 'un seul compte par la fenêtre de première connexion');
      assert.match((await r2.json() as { error: string }).error, /existe déjà/);
    } finally { await gw.stop(); o.cleanup(); }
  }
  // 3. Avec un modèle prêt et une ancienne trace : toujours refusé (la règle d'avant, inchangée).
  {
    const o = makeOdin([]);
    assert.equal(o.modele.pret(), true);
    writeFileSync(join(o.paths.home, 'web-claimed'), 'ancienne installation\n');
    const p = port(), token = ensureWebToken(o.paths);
    const gw = new Gateway(o, { owners: { web: ['*'] } }); gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, scryptN: 1024 })); await gw.start();
    try { assert.equal((await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: H, body: corps })).status, 403); } finally { await gw.stop(); o.cleanup(); }
  }
});

/** Un canal de messagerie d'essai : interactif, il garde ce qu'il reçoit. */
function canal(nom = 'essai'): Channel & { recus: string[] } {
  const recus: string[] = [];
  return { name: nom, interactive: true, recus, start: async () => {}, stop: async () => {}, send: async (_p: string, t: string) => { recus.push(t); } };
}

test('rapport du matin : la file des messages gardés n\'est vidée que si le propriétaire les reçoit', async () => {
  const o = makeOdin([]); o.modele = { pret: () => false };
  try {
    o.muninn.setKv('deferred', JSON.stringify(['MESSAGE-GARDE pendant la nuit']));
    // Personne de joignable : la file reste (avant : vidée, le message était perdu).
    await new Gateway(o, { owners: {} }).morning(Date.now(), true);
    assert.match(o.muninn.getKv('deferred') ?? '', /MESSAGE-GARDE/, 'gardé tant que personne ne l\'a reçu');
    // Le propriétaire est joignable : il le reçoit, et la file est vidée.
    const c = canal(), gw = new Gateway(o, { owners: { essai: ['moi'] } }); gw.add(c);
    await gw.morning(Date.now(), true);
    assert.ok(c.recus.some((t) => t.includes('MESSAGE-GARDE')), 'remis avec le rapport');
    assert.equal(o.muninn.getKv('deferred') || '', '', 'vidée une fois remise');
    // (le briefing vérifie seulement la connexion à Internet : aucun service de modèle n'est appelé)
    assert.deepEqual(sorties.filter((u) => /anthropic|openai|openrouter|deepseek|moonshot|typesafe|elevenlabs|huggingface/i.test(u)), []);
  } finally { o.cleanup(); }
});

test('rapport du matin : un message gardé qui n\'entre pas dans le rapport reste dans la file, et part au rapport suivant', async () => {
  const o = makeOdin([]); o.modele = { pret: () => false };
  try {
    const msgs = [1, 2, 3, 4, 5].map((i) => `MSG${i}-` + 'x'.repeat(900));
    o.muninn.setKv('deferred', JSON.stringify(msgs));
    const c = canal(), gw = new Gateway(o, { owners: { essai: ['moi'] } }); gw.add(c);
    await gw.morning(Date.now(), true);
    const file = () => JSON.parse(o.muninn.getKv('deferred') || '[]') as string[];
    // Chaque message est soit remis EN ENTIER, soit encore dans la file : aucun n'est perdu, aucun n'est coupé.
    for (const m of msgs) assert.ok(c.recus.join('\n').includes(m) !== file().includes(m), `${m.slice(0, 4)} : remis en entier ou gardé`);
    assert.ok(file().length > 0, 'trop long pour un seul rapport : le reste attend');
    // Le rapport suivant remet le reste.
    for (let n = 0; n < 5 && file().length; n++) await gw.morning(Date.now(), true);
    assert.deepEqual(file(), [], 'tout finit par être remis');
    for (const m of msgs) assert.ok(c.recus.join('\n').includes(m), `${m.slice(0, 4)} remis`);
  } finally { o.cleanup(); }
});

test('sans modèle, la boucle des mises à jour tourne : l\'annonce « Odin est à jour » part', async () => {
  const o = makeOdin([]); o.modele = { pret: () => false };
  try {
    (o.cfg as { update?: unknown }).update = { auto: 'off', everyHours: 6 }; // pas de récupération sur GitHub pendant l'essai
    o.muninn.setKv('updated-to', `0.0.0→${appVersions().running}`);
    const c = canal(), gw = new Gateway(o, { owners: { essai: ['moi'] } }); gw.add(c);
    await gw.updateLoop(Date.now(), true);
    assert.ok(c.recus.some((t) => /Odin est à jour/.test(t)), 'annoncé au propriétaire sans modèle de langue');
    assert.equal(o.muninn.getKv('updated-to') ?? '', '', 'annonce faite une fois');
  } finally { o.cleanup(); }
});

test('plafond du juge : au démarrage de la passerelle, une bulle dit le message une fois (marque « dit »)', async () => {
  const o = makeOdin([]);
  const dir = mkdtempSync(join(tmpdir(), 'odin-bulles-')); dossiers.push(dir);
  const notices = new Notices({ dir, modules: () => [], module: () => undefined, events: new EventEmitter() });
  const vues: Notice[] = []; const ecoute = (n: Notice) => vues.push(n); noticeBus.on('notice', ecoute);
  try {
    o.muninn.setKv(MARQUE_JUGE_LOCAL, JSON.stringify({ at: new Date().toISOString(), pose: true, avant: 'autonome', raisons: ['Jev'], message: 'MESSAGE-PLAFOND : autonomie ramenée à prudent.', dit: false }));
    const gw1 = new Gateway(o, { owners: {} }); gw1.add(canal()); await gw1.start(); await gw1.stop();
    assert.equal(vues.filter((n) => `${n.title} ${n.detail}`.includes('MESSAGE-PLAFOND')).length, 1, 'une bulle');
    assert.equal(JSON.parse(o.muninn.getKv(MARQUE_JUGE_LOCAL)!).dit, true, 'la marque note qu\'elle est dite');
    const gw2 = new Gateway(o, { owners: {} }); gw2.add(canal()); await gw2.start(); await gw2.stop();
    assert.equal(vues.filter((n) => `${n.title} ${n.detail}`.includes('MESSAGE-PLAFOND')).length, 1, 'jamais deux fois');
    // Pas de plafond posé : aucune bulle.
    o.muninn.setKv(MARQUE_JUGE_LOCAL, JSON.stringify({ at: new Date().toISOString(), pose: false, avant: 'prudent', raisons: [] }));
    const gw3 = new Gateway(o, { owners: {} }); gw3.add(canal()); await gw3.start(); await gw3.stop();
    assert.equal(vues.length, 1);
  } finally { noticeBus.off('notice', ecoute); notices.stop(); o.cleanup(); }
});

test('plafond du juge : sans bulles (applis pas démarrées), la marque reste « à dire »', async () => {
  const o = makeOdin([]);
  try {
    o.muninn.setKv(MARQUE_JUGE_LOCAL, JSON.stringify({ at: new Date().toISOString(), pose: true, avant: 'autonome', raisons: ['Jev'], message: 'M', dit: false }));
    const gw = new Gateway(o, { owners: {} }); gw.add(canal()); await gw.start(); await gw.stop();
    assert.equal(JSON.parse(o.muninn.getKv(MARQUE_JUGE_LOCAL)!).dit, false, 'redit au prochain démarrage');
  } finally { o.cleanup(); }
});

test('« Tout tester », Écho Conversation et Réglages : sans modèle, rien n\'est appelé et c\'est dit sans erreur', async () => {
  const o = makeOdin([]);
  try {
    let appels = 0;
    const router = { complete: async () => { appels++; return { text: 'OK', providerName: 'x' }; } } as never;
    const t = await selfTest({ cfg: o.cfg, paths: o.paths, router, modelePret: false, only: 'Modèle' });
    assert.equal(appels, 0, 'aucun appel au modèle');
    assert.equal(t.length, 1); assert.equal(t[0].ok, null, 'ni rouge ni erreur');
    assert.match(t[0].detail, /pas encore entraîné/);
    const faux = (pret: boolean) => ({ modele: { pret: () => pret }, cfg: { providers: [{ model: 'x' }] }, agent: { ask: async () => 'non' }, paths: {} }) as never;
    assert.equal(modeleDe(faux(false)), undefined, 'Écho : aucun modèle à appeler');
    assert.ok(modeleDe(faux(true)), 'avec un modèle prêt : il sert');
    const v = settingsView(o.cfg, false, {}, o.paths) as Record<string, unknown>;
    assert.equal(v.modelePret, false); assert.equal('demo' in v, false);
  } finally { o.cleanup(); }
});
