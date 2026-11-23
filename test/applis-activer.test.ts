// Activer ou désactiver une appli (demande du propriétaire, 23/11) : une appli désactivée est grisée mais visible et
// réactivable ; plus aucune notification, alerte, tâche, automatisation, lien entre applis, ni choix par la parole ;
// ses données sont gardées. Installation neuve : toutes désactivées sauf les indispensables. Installation déjà là :
// rien ne change à la mise à jour. Seul le propriétaire change ce réglage (ni un membre, ni une tablette, ni une clé).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module } from '../src/valhalla/types.ts';
import { odinPaths } from '../src/config.ts';
import { ACTIVES_AU_DEPART, ESSENTIELLES, fichierActivation, initOdin } from '../src/valhalla/activation.ts';
import { allModules, moduleDep, setValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { valhallaGet, valhallaPost } from '../src/web/valhalla-api.ts';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const dossiers: string[] = [];
const neuf = () => { const d = mkdtempSync(join(tmpdir(), 'odin-activer-')); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Une appli d'essai : surveillance, tâche, action, et un compteur de ce qu'elle fait. */
function radar(compte: { start: number; stop: number; watch: number; act: number }): Module {
  return {
    id: 'radar', name: 'Radar', family: 'Machines', what: 'Appli d\'essai', does: [], from: [], upstream: [], words: ['radar'],
    actions: [{ id: 'mesurer', label: 'Mesurer', what: 'Une mesure', words: ['mesure le radar'], run: (c) => { compte.act++; c.saveSettings({ mesures: Number(c.settings.mesures ?? 0) + 1 }); return { text: 'mesuré' }; } }],
    view: () => ({ sections: [] }),
    start: () => { compte.start++; }, stop: () => { compte.stop++; },
    watch: { every: 3600, run: () => { compte.watch++; } },
    taches: () => [{ id: 'nuit', nom: 'Mesure de nuit', quoi: 'mesure', rythme: () => ({ genre: 'jour', heure: '03:00' }), lancer: { action: 'mesurer' } }] as never,
  };
}
const voisin: Module = { id: 'voisin', name: 'Voisin', family: 'Données', what: 'L\'autre appli', does: [], from: [], upstream: [], words: ['voisin'], actions: [{ id: 'appeler', label: 'Appeler le radar', what: 'lien', run: async (c) => ({ text: (await c.call('radar', 'mesurer', {}, 'lien d\'essai')).text }) }], view: () => ({ sections: [] }) };

// ---------------------------------------------------------------- Qui peut changer le réglage (un vrai Odin d'essai)
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let o: VraiOdin, membre = '', cleTablette = '';
const MDP = 'un-sentier-de-sable-sous-les-pins-31';
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  o = await vraiOdin(tt, { compte: true, modules: (x) => allModules(x).filter((m) => ['var', 'gladsheim', 'eir'].includes(m.id)) });
  const va = valhallaOf()!;
  const { lierProprietaire, persona } = await import('../src/valhalla/sso/etat.ts');
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'eir']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-a' })).ok, true);
  lierProprietaire(persona()!);
  let r = await fetch(`${o.url}/sso/odin`, { redirect: 'manual' });
  r = await fetch(new URL(r.headers.get('location')!, o.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${o.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: o.url }, body: new URLSearchParams({ demande, identifiant: 'membre-a', motdepasse: MDP }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' });
  membre = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
  cleTablette = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette', droits: 'maison' })).data as { key: string }).key;
  assert.ok(membre && cleTablette);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('membre, tablette et clé d\'API refusés ; le propriétaire (sa session) active et désactive', async () => {
  const va = valhallaOf()!;
  const m = await o.json('/api/valhalla/activer', { module: 'eir', actif: false }, { cookie: membre });
  assert.notEqual(m.body.ok, true, 'un membre est refusé'); assert.equal(va.estActive('eir'), true);
  const cm = await o.json('/api/valhalla/catalog', undefined, { cookie: membre });
  assert.equal(cm.body.peutActiver, false, `un membre ne voit pas le bouton (${cm.status} ${JSON.stringify(cm.body).slice(0, 200)})`);
  const t = await o.json('/api/valhalla/activer', { module: 'eir', actif: false }, { cookie: '', 'x-odin-maison': cleTablette });
  assert.notEqual(t.body.ok, true, 'une tablette est refusée'); assert.equal(va.estActive('eir'), true);
  const k = await o.json('/api/valhalla/activer', { module: 'eir', actif: false }, { authorization: `Bearer ${o.token}` });
  assert.notEqual(k.body.ok, true, 'une clé d\'API est refusée'); assert.equal(va.estActive('eir'), true);
  assert.equal(((await valhallaPost('/api/valhalla/activer', { module: 'eir', actif: false })) as { ok: boolean }).ok, false, 'sans la session du propriétaire');

  const p = await o.json('/api/valhalla/activer', { module: 'eir', actif: false });
  assert.equal(p.body.ok, true, String(p.body.text)); assert.equal(va.estActive('eir'), false);
  const vu = await o.json('/api/valhalla/catalog');
  assert.equal(vu.body.peutActiver, true);
  assert.equal((vu.body.modules as Array<{ id: string; active: boolean }>).find((x) => x.id === 'eir')?.active, false);
  const ess = await o.json('/api/valhalla/activer', { module: 'var', actif: false });
  assert.equal(ess.body.ok, false, 'Persona est indispensable');
  assert.equal((await o.json('/api/valhalla/activer', { module: 'eir', actif: true })).body.ok, true); assert.equal(va.estActive('eir'), true);
});

test('désactiver : grisée, plus de notification, d\'alerte, de tâche, d\'automatisation, de lien ni de choix par la parole ; données intactes ; réactiver : tout revient', async () => {
  const home = neuf(), compte = { start: 0, stop: 0, watch: 0, act: 0 }, messages: string[] = [], evenements: string[] = [];
  const v = new Valhalla(home, [radar(compte), voisin], { notify: async (t) => { messages.push(t); } });
  v.events.on('event', (e: { module: string }) => evenements.push(e.module));
  const avant = valhallaOf(); setValhalla(v);
  try {
    await v.start();
    assert.equal(compte.start, 1, 'active par défaut : elle démarre');
    assert.equal((await v.act('radar', 'mesurer')).ok, true);
    const donnees = join(v.ctx('radar').dir, 'mes-donnees.txt'); writeFileSync(donnees, 'gardé');

    const r = await v.activer('radar', false);
    assert.equal(r.ok, true); assert.equal(v.estActive('radar'), false);
    assert.equal(compte.stop, 1, 'désactivée : elle est arrêtée');
    const cat = await valhallaGet('/api/valhalla/catalog', new URLSearchParams()) as { modules: Array<{ id: string; active: boolean }> };
    assert.equal(cat.modules.find((m) => m.id === 'radar')?.active, false, 'grisée dans le catalogue');
    assert.equal(cat.modules.find((m) => m.id === 'voisin')?.active, true);

    const ctx = v.ctx('radar'); messages.length = 0;
    await ctx.notify('bonjour'); ctx.alert({ level: 'critique', title: 'Panne' }); ctx.emit('mesure', {});
    assert.deepEqual(messages, [], 'aucune notification, même critique');
    assert.equal(v.alerts({ module: 'radar' }).length, 0, 'aucune alerte rangée');
    assert.deepEqual(evenements, [], 'aucun événement (ni lien, ni automatisation)');
    const parPage = await v.act('radar', 'mesurer');
    assert.equal(parPage.ok, false); assert.match(parPage.text, /désactivée.*Activer/s);
    assert.equal(compte.act, 1, 'son action ne part pas');
    assert.equal((await moduleDep('radar', 'mesurer', {})).ok, false, 'une automatisation de Talos ne la lance pas');
    assert.match((await v.act('voisin', 'appeler')).text, /désactivée/, 'un lien entre applis ne l\'atteint pas');
    assert.equal(await v.automatismes.passageAuto('veille:radar'), 'pause', 'sa surveillance ne passe pas');
    assert.equal(await v.automatismes.passageAuto('tache:radar:nuit'), 'pause', 'sa tâche planifiée ne passe pas');
    assert.equal(compte.watch, 0);
    const parole = await v.order('mesure le radar');
    assert.equal(parole.ok, false); assert.match(parole.text, /Radar est désactivée.*Activer/s, 'Odin dit qu\'elle est désactivée et propose de l\'activer');
    assert.equal(compte.act, 1);
    assert.equal(readFileSync(donnees, 'utf8'), 'gardé', 'ses fichiers restent');
    assert.equal(v.ctx('radar').settings.mesures, 1, 'ses réglages restent');

    // Relue au redémarrage : le réglage est gardé par Odin, pas par le navigateur.
    assert.equal(new Valhalla(home, [radar(compte), voisin]).estActive('radar'), false);

    assert.equal((await v.activer('radar', true)).ok, true);
    assert.equal(compte.start, 2, 'réactivée : elle redémarre');
    await ctx.notify('de retour'); assert.deepEqual(messages, ['de retour']);
    assert.equal((await v.act('radar', 'mesurer')).ok, true); assert.equal(compte.act, 2);
    ctx.emit('mesure', {}); assert.deepEqual(evenements, ['radar']);
    assert.notEqual(await v.automatismes.passageAuto('veille:radar'), 'pause'); assert.equal(compte.watch, 1);
    assert.equal(v.ctx('radar').settings.mesures, 2, 'les données d\'avant sont là, la nouvelle mesure s\'ajoute');
  } finally { v.stop(); setValhalla(avant); }
});

test('une appli indispensable ne se désactive pas', async () => {
  const v = new Valhalla(neuf(), [{ ...voisin, id: 'var', name: 'Persona' }]);
  const r = await v.activer('var', false);
  assert.equal(r.ok, false); assert.match(r.text, /indispensable/); assert.equal(v.estActive('var'), true);
  v.stop();
});

test("base neuve (« odin init » sur un dossier vide) : tout est désactivé sauf les indispensables, l'antivirus et les sauvegardes", () => {
  const home = neuf(), paths = odinPaths(home);
  initOdin(paths);
  assert.ok(existsSync(fichierActivation(home)));
  const mods = allModules({ paths, cfg: { web: { port: 1, tls: { enabled: false } }, journal: {}, voice: {} } } as never);
  for (const id of ESSENTIELLES) assert.ok(mods.some((m) => m.id === id), `l'appli indispensable ${id} existe`);
  const v = new Valhalla(home, mods);
  const actives = mods.filter((m) => v.estActive(m.id)).map((m) => m.id).sort();
  assert.deepEqual(actives, [...ESSENTIELLES, ...ACTIVES_AU_DEPART].sort());
  // L'antivirus et les sauvegardes sont actifs au départ, mais désactivables (pas indispensables).
  for (const id of ACTIVES_AU_DEPART) assert.equal(v.estEssentielle(id), false, `${id} reste désactivable`);
  // « init » relancé (mise à jour par l'installateur) : rien ne change.
  initOdin(paths); assert.equal(new Valhalla(home, mods).estActive('eir'), false);
  v.stop();
});

test('base existante mise à jour : toutes les applis restent actives', () => {
  const home = neuf(), paths = odinPaths(home);
  mkdirSync(home, { recursive: true }); writeFileSync(paths.config, '{}'); // un Odin déjà installé, d'avant ce réglage
  initOdin(paths);
  assert.equal(existsSync(fichierActivation(home)), false, 'aucune marque écrite');
  const mods = allModules({ paths, cfg: { web: { port: 1, tls: { enabled: false } }, journal: {}, voice: {} } } as never);
  const v = new Valhalla(home, mods);
  assert.deepEqual(mods.filter((m) => !v.estActive(m.id)).map((m) => m.id), []);
  v.stop();
});

// ---------------------------------------------------------------- Relecture (sûreté) : courses, alerte critique, Kéryx
test('course au démarrage : activée pendant que les autres démarrent, elle ne démarre qu\'une fois', async () => {
  const home = neuf(); mkdirSync(join(home, 'valhalla'), { recursive: true });
  writeFileSync(fichierActivation(home), JSON.stringify({ version: 1, defaut: 'desactive', exceptions: ['lent'] }));
  let lacher!: () => void; const attente = new Promise<void>((r) => { lacher = r; });
  const lent: Module = { ...voisin, id: 'lent', name: 'Lent', start: () => attente };
  const compte = { start: 0, stop: 0, watch: 0, act: 0 };
  const v = new Valhalla(home, [lent, radar(compte)]);
  try {
    const demarrage = v.start();
    await new Promise((r) => setImmediate(r));
    assert.equal((await v.activer('radar', true)).ok, true); // pendant que « Lent » démarre encore
    lacher(); await demarrage;
    assert.equal(compte.start, 1, 'un seul démarrage (pas deux serveurs, pas deux minuteries)');
  } finally { v.stop(); }
});

test('course au démarrage : désactivée pendant son propre démarrage, elle est arrêtée une fois démarrée', async () => {
  const home = neuf(), suite: string[] = [];
  let lacher!: () => void; const attente = new Promise<void>((r) => { lacher = r; });
  const lent: Module = { ...voisin, id: 'lent', name: 'Lent', start: async () => { suite.push('debut'); await attente; suite.push('fin'); }, stop: () => { suite.push('stop'); } };
  const v = new Valhalla(home, [lent]);
  try {
    const demarrage = v.start();
    await new Promise((r) => setImmediate(r));
    assert.equal((await v.activer('lent', false)).ok, true);
    lacher(); await demarrage;
    assert.equal(suite.at(-1), 'stop', `rien ne reste allumé après son démarrage (${suite.join(' → ')})`);
  } finally { v.stop(); }
});

test('règle prudente : l\'alerte CRITIQUE d\'une appli désactivée passe par Forseti ; les autres se taisent', async () => {
  const home = neuf(), messages: string[] = [], compte = { start: 0, stop: 0, watch: 0, act: 0 };
  const v = new Valhalla(home, [radar(compte), { ...voisin, id: 'forseti', name: 'Forseti' }], { notify: async (t) => { messages.push(t); } });
  try {
    assert.equal((await v.activer('radar', false)).ok, true);
    const ctx = v.ctx('radar');
    ctx.alert({ level: 'haute', title: 'Pas grave' }); ctx.alert({ level: 'info', title: 'Info' }); await ctx.notify('bonjour');
    assert.deepEqual(messages, [], 'non critique : rien');
    ctx.alert({ level: 'critique', title: 'Fichier dangereux TOUJOURS EN PLACE', fix: { action: 'mesurer', label: 'Mesurer' } });
    assert.equal(v.alerts({ module: 'radar' }).length, 0, 'rien au nom de l\'appli désactivée');
    const f = v.alerts({ module: 'forseti' });
    assert.equal(f.length, 1, 'Forseti la porte'); assert.match(f[0].title, /Radar \(désactivée\).*TOUJOURS EN PLACE/);
    assert.equal(f[0].fix, undefined, 'pas de bouton qui viserait l\'appli désactivée');
    await new Promise((r) => setImmediate(r));
    assert.equal(messages.length, 1); assert.match(messages[0], /Forseti.*Radar \(désactivée\)/s);
  } finally { v.stop(); }
});

test('Kéryx désactivée : plus de rappel de rendez-vous', async () => {
  const { Proactif } = await import('../src/valhalla/keryx/proactif.ts');
  let lu = 0; const envois: string[] = [];
  const p = new Proactif({ notifyOwner: async (t: string) => { envois.push(t); }, quietNow: () => undefined, actif: () => false }, () => { lu++; return { surveillances: [{ id: 'r', quoi: 'rappel_rdv', reglage: '30', actif: true }] } as never; });
  assert.equal(await p.passer(), 0); assert.equal(lu, 0, 'rien n\'est regardé'); assert.deepEqual(envois, []);
});

test('Hestia désactivée : plus aucune position de la famille n\'est reçue ni renvoyée (OwnTracks)', async () => {
  const va = valhallaOf()!;
  const nour = await va.act('gladsheim', 'membre', { nom: 'Nour' }); const pass = /Mot de passe : (\S+)/.exec(nour.text)![1];
  const ot = (body: unknown) => fetch(`${o.url}/api/owntracks`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`nour:${pass}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await va.activer('gladsheim', false)).ok, true);
  try {
    const r = await ot({ _type: 'location', lat: -12.7891234, lon: 45.2312, tst: Math.floor(Date.now() / 1000) });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), []);
    const { familyNow } = await import('../src/valhalla/modules/gladsheim.ts');
    assert.deepEqual(familyNow(va.ctx('gladsheim')), [], 'la position n\'est pas gardée');
  } finally { assert.equal((await va.activer('gladsheim', true)).ok, true); }
});
