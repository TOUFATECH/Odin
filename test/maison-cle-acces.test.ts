// L'écran de la maison et la clé d'accès (clé d'API, Authorization: Bearer). Décision du propriétaire (26/11) : la
// clé d'accès n'y entre plus « comme lui ». Sur /api/maison/*, seules passent la session du propriétaire et une clé
// de tablette (en-tête x-odin-maison, un autre mécanisme, avec ses propres droits). OwnTracks garde ses identifiants.
// Un vrai Odin d'essai (serveur web + applis), par les mêmes chemins que la page. Le tunnel reste éteint (carte
// factice) : aucune commande réseau. Adresses d'exemple seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
const MARQUE = 'REPONSE-DU-FAUX-MODELE-4a9d', QR = 'b0000001', BLOQUER = 'b0000002';
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, cle: Record<string, string>, tuile = '', cleMaison = '', cleComplet = '', owntracks = '';
const reseau = () => JSON.stringify(valhallaOf()!.ctx('vidarr').settings);
const theme = () => String(valhallaOf()!.ctx('gladsheim').settings.theme ?? '');

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, script: () => ({ text: MARQUE }), modules: (o) => allModules(o).filter((m) => ['var', 'gladsheim', 'gjoll', 'vidarr'].includes(m.id)) });
  cle = { authorization: `Bearer ${v.token}` };
  const va = valhallaOf()!;
  va.ctx('gjoll').saveSettings({ server: { ...(va.ctx('gjoll').settings.server as object ?? {}), endpoint: '198.51.100.20', iface: 'wg-essai' } });
  assert.equal((await va.act('gjoll', 'ajouter', { nom: 'Téléphone 1', dns_odin: false, montrer: false })).ok, true);
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [
    { id: QR, kind: 'bouton', w: 1, module: 'gjoll', action: 'qr', label: 'QR', input: { nom: 'Téléphone 1' } },
    { id: BLOQUER, kind: 'bouton', w: 1, module: 'vidarr', action: 'bloquer', label: 'Bloquer', input: { domaine: 'cle.example.com' } },
  ] }] }) });
  assert.equal(f.ok, true, f.text);
  tuile = ((await va.act('gladsheim', 'bouton', { appli: 'vidarr', action: 'bloquer', reglages: 'domaine=tuile.example.com', nom: 'Bloquer tuile' })).data as { id: string }).id;
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette salon', droits: 'complet' })).data as { key: string }).key;
  const ot = await va.act('gladsheim', 'membre', { nom: 'Proche D', adresse: 'https://odin.example.org' });
  owntracks = `Basic ${Buffer.from(`${/Identifiant : (\S+)/.exec(ot.text)![1]}:${/Mot de passe : (\S+)/.exec(ot.text)![1]}`).toString('base64')}`;
  assert.ok(tuile && cleMaison && cleComplet);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('la clé d\'accès : refusée sur chaque route de l\'écran de la maison, rien n\'est lu, rien ne change', async () => {
  const avant = reseau(), themeAvant = theme(), passe: string[] = [];
  const essais: Array<[string, string, unknown?]> = [
    ['etat', '/api/maison/etat'], ['camera', '/api/maison/camera?nom=Entree'],
    ['fenetre (bloquer un nom)', '/api/maison/fenetre', { id: BLOQUER }], ['fenetre (QR code)', '/api/maison/fenetre', { id: QR, confirm: true }],
    ['bouton', '/api/maison/bouton', { id: tuile, confirm: true }], ['dire', '/api/maison/dire', { texte: 'raconte-moi ma journée' }],
    ['theme', '/api/maison/theme', { theme: 'clair' }], ['reseau', '/api/maison/reseau', { ip: '198.51.100.9', nom: 'Essai', couper: true }],
    ['video', '/api/maison/video', { ip: '198.51.100.9', nom: 'Essai', couper: true }],
    ['appareil', '/api/maison/appareil', { appareil: 'light.salon', valeur: 'on' }], ['scene', '/api/maison/scene', { scene: 'Soir' }],
  ];
  for (const [nom, chemin, corps] of essais) {
    const r = await v.json(chemin, corps, cle), t = JSON.stringify(r.body);
    if (r.status !== 401) passe.push(`${nom} → ${r.status} ${t.slice(0, 100)}`);
    if (/fenetre|rights|tiles|Téléphone 1|<svg|REPONSE-DU-FAUX/.test(t)) passe.push(`${nom} : une donnée est rendue`);
  }
  assert.deepEqual(passe, [], 'tout est refusé à la clé d\'accès');
  assert.equal(reseau(), avant, 'le réseau n\'a pas changé'); assert.equal(theme(), themeAvant, 'le thème n\'a pas changé');
});

test('la page et son script restent une coquille publique, sans donnée, avec ou sans la clé d\'accès', async () => {
  for (const p of ['/maison', '/maison.js']) for (const h of [cle, {}]) {
    const r = await fetch(v.url + p, { headers: h }), t = await r.text();
    assert.equal(r.status, 200, p); assert.ok(!t.includes(v.token) && !t.includes(cleComplet) && !t.includes('Téléphone 1'), `${p} : aucune donnée`);
  }
});

test('la clé d\'accès avec une clé de tablette « maison » : les droits de la tablette, pas ceux du propriétaire', async () => {
  const r = await v.json('/api/maison/etat', undefined, { ...cle, 'x-odin-maison': cleMaison });
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'maison');
  const b = await v.json('/api/maison/fenetre', { id: BLOQUER }, { ...cle, 'x-odin-maison': cleMaison });
  assert.notEqual(b.body.ok, true, JSON.stringify(b.body)); assert.doesNotMatch(reseau(), /cle\.example\.com/);
});

test('OwnTracks : ses identifiants marchent toujours, la clé d\'accès n\'y vaut rien', async () => {
  const pos = { _type: 'location', lat: 0.5, lon: 0.5, tst: Math.floor(Date.now() / 1000) };
  const ok = await fetch(`${v.url}/api/owntracks`, { method: 'POST', headers: { authorization: owntracks, 'content-type': 'application/json' }, body: JSON.stringify(pos) });
  assert.equal(ok.status, 200); assert.ok(Array.isArray(await ok.json()));
  assert.equal((await v.json('/api/owntracks', pos, cle)).status, 401);
});

test('contrôle : les tablettes gardent leur clé de tablette', async () => {
  const m = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(m.status, 200); assert.equal(m.body.rights, 'maison');
  const a = await v.json('/api/maison/appareil', { appareil: 'light.salon', valeur: 'on' }, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(a.status, 200); assert.equal(a.body.text, 'action inconnue'); // l'appli de la maison est absente ici : la demande est bien allée jusqu'à l'action
  const c = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleComplet });
  assert.equal(c.status, 200); assert.equal(c.body.rights, 'complet');
  const t = await v.json('/api/maison/theme', { theme: 'verre' }, { cookie: '', 'x-odin-maison': cleComplet });
  assert.equal(t.body.ok, true, JSON.stringify(t.body));
  assert.equal((await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': 'f'.repeat(48) })).status, 401, 'une fausse clé de tablette : refusée');
});

test('contrôle : la session du propriétaire garde tout, et la clé d\'accès marche toujours ailleurs', async () => {
  const e = await v.json('/api/maison/etat');
  assert.equal(e.status, 200); assert.equal(e.body.rights, 'complet');
  assert.equal((await v.json('/api/maison/dire', { texte: 'raconte-moi ma journée' })).body.text, MARQUE);
  const b = await v.json('/api/maison/fenetre', { id: BLOQUER });
  assert.equal(b.body.ok, true, JSON.stringify(b.body)); assert.match(reseau(), /cle\.example\.com/);
  assert.equal((await v.json('/api/valhalla/act', { module: 'vidarr', action: 'autoriser', input: { domaine: 'cle.example.com' } })).body.ok, true);
  assert.equal((await fetch(`${v.url}/api/state`, { headers: cle })).status, 200, 'la clé d\'accès lit toujours l\'état d\'Odin');
});
