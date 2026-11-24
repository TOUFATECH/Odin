// L'écran de la maison (/maison, /api/maison/*) vu par un membre de la famille connecté par Persona.
// Filet posé AVANT qu'un menu de l'interface mène un membre à cet écran : il dit ce qu'une session de membre reçoit
// et peut faire. L'attendu écrit est le plus sûr : un membre n'a jamais plus qu'une tablette « maison ».
// Depuis le lot 24b, une session de membre n'a aucun droit sur /api/maison/* (refusée comme une visite sans session) ;
// seul le propriétaire range la fenêtre. Un vrai Odin d'essai (serveur web + applis), par le même chemin que la page.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { COMPTE, vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona, personnes } from '../src/valhalla/sso/etat.ts';

const MDP_A = 'un-sentier-de-sable-sous-les-pins-31';
const MDP_B = 'une-barque-lente-au-bord-du-lac-62';
// Persona (var) et Hestia (gladsheim) seulement. Les autres applis lues par /api/maison/etat (midgard, himinbjorg,
// vidarr, askr, apparence) sont absentes : la route doit répondre sans elles.
const IDS = ['var', 'gladsheim'];
// Ce que répond le faux modèle d'Odin : s'il revient à un membre, le membre a parlé à l'IA d'Odin.
const MARQUE = 'REPONSE-DU-FAUX-MODELE-7c1e';
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
let v: VraiOdin, sansDroit = '', avecDroit = '', boutonGrave = '', cleMaison = '', cleComplet = '';
const PAGE_MAISON = 'a1b2c3d4', WIDGET_GRAVE = 'e5f6a7b8';
const pagesDe = () => ((valhallaOf()!.ctx('gladsheim').settings.fenetre as { pages: Array<{ name: string }> } | undefined)?.pages ?? []).map((p) => p.name);
const membreA = (chemin: string, corps?: unknown) => v.json(chemin, corps, { cookie: sansDroit });
const membreB = (chemin: string, corps?: unknown) => v.json(chemin, corps, { cookie: avecDroit });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, script: () => ({ text: MARQUE }), modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  // Deux membres, aucun dans le groupe « admin » : l'un entre dans Odin seulement, l'autre a aussi le droit sur Hestia.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP_A })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-b', nom: 'Membre B', groupes: 'invite', mot_de_passe: MDP_B })).ok, true);
  // Une troisième personne, cible du bouton grave (son compte disparaît si le bouton part).
  assert.equal((await va.act('var', 'ajouter', { login: 'cible-c', nom: 'Cible C', groupes: 'invite', mot_de_passe: MDP_A })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-a' })).ok, true);
  for (const appli of ['odin', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-b' })).ok, true);
  lierProprietaire(persona()!);
  sansDroit = await entrer(v, 'membre-a', MDP_A); avecDroit = await entrer(v, 'membre-b', MDP_B);
  assert.ok(sansDroit && avecDroit, 'les deux membres ont une session');

  // Des données que seul le propriétaire doit voir : un appareil du réseau (inventaire d'Atlas) et une position de la famille.
  // Écrit dans les réglages d'Atlas sans l'appli chargée : la route les lit de la même façon (ctx('askr'), sans v.module).
  // Si l'une ou l'autre change, l'essai de contrôle ne voit plus 198.51.100.7 et échoue : rien ne passe en silence.
  va.ctx('askr').saveSettings({ assets: [{ ip: '198.51.100.7', name: 'Imprimante essai', kind: 'imprimante' }] });
  const ot = await va.act('gladsheim', 'membre', { nom: 'Proche D', adresse: 'https://odin.example.org' });
  const pass = /Mot de passe : (\S+)/.exec(ot.text)![1], user = /Identifiant : (\S+)/.exec(ot.text)![1];
  const r = await fetch(`${v.url}/api/owntracks`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ _type: 'location', lat: 0.5, lon: 0.5, tst: Math.floor(Date.now() / 1000) }) });
  assert.equal(r.status, 200, 'position enregistrée');
  // Un bouton grave de l'écran de la maison : retirer le compte « cible-c » (sans danger : Odin d'essai).
  const b = await va.act('gladsheim', 'bouton', { appli: 'var', action: 'retirer', reglages: 'login=cible-c', nom: 'Retirer C' });
  boutonGrave = (b.data as { id: string }).id; assert.ok(boutonGrave, 'bouton grave ajouté');
  const st = await v.json('/api/maison/etat');
  assert.ok((st.body.tiles as Array<{ id: string; grave: boolean }>).find((t) => t.id === boutonGrave)?.grave, 'le bouton est bien grave');
  // Une page « écran de la maison » de la fenêtre, avec un bouton grave : retirer le compte « cible-e ».
  assert.equal((await va.act('var', 'ajouter', { login: 'cible-e', nom: 'Cible E', groupes: 'invite', mot_de_passe: MDP_B })).ok, true);
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: PAGE_MAISON, name: 'Maison', maison: true, widgets: [{ id: WIDGET_GRAVE, kind: 'bouton', w: 1, module: 'var', action: 'retirer', label: 'Retirer E', input: { login: 'cible-e' } }] }] }) });
  assert.equal(f.ok, true, f.text);
  // Deux vraies clés de tablette : « maison » et « complet ».
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  assert.ok(cleMaison && cleComplet, 'clés de tablette créées');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('membre sans le droit sur Hestia : /maison et /api/maison/etat refusés', async () => {
  const page = await fetch(`${v.url}/maison`, { headers: { cookie: sansDroit }, redirect: 'manual' });
  assert.equal(page.status, 403, 'la page /maison');
  await page.text();
  assert.equal((await membreA('/api/maison/etat')).status, 403, 'l\'état de la maison');
});

// Refusé : 401 (aucun droit reconnu) ou 403 (droit insuffisant). La correction du lot 24b peut donner l'un ou l'autre.
const refuse = (code: number) => code === 401 || code === 403;
const etatB = () => membreB('/api/maison/etat');

test("membre avec le droit : l'état de la maison est refusé ou ne donne pas les droits « complet »", async () => {
  const r = await etatB();
  if (!refuse(r.status)) { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.notEqual(r.body.rights, 'complet'); }
});
test("membre avec le droit : ni applis, ni famille, ni réseau, ni caméras, ni avis", async () => {
  const r = await etatB(); if (refuse(r.status)) return;
  assert.equal(r.status, 200, JSON.stringify(r.body)); const b = r.body;
  assert.deepEqual(b.apps, [], 'applis'); assert.deepEqual(b.people, [], 'positions de la famille'); assert.deepEqual(b.network, [], 'appareils du réseau');
  assert.deepEqual(b.cameras, [], 'caméras'); assert.deepEqual(b.notices, [], 'avis');
});
// maison-api.ts rend name: d.name (le prénom du propriétaire) à tout demandeur, tablette « maison » comprise :
// il passe parce que l'état est refusé au membre.
test("membre avec le droit : le prénom affiché n'est pas celui du propriétaire", async () => {
  const r = await etatB(); if (refuse(r.status)) return;
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.notEqual(r.body.name, COMPTE.prenom);
});
test("membre avec le droit : l'aperçu d'une caméra est refusé", async () => {
  const r = await membreB('/api/maison/camera?nom=Entree');
  assert.ok(refuse(r.status), `réponse ${r.status}`);
});
test("membre avec le droit : couper Internet d'un appareil est refusé", async () => {
  const r = await membreB('/api/maison/reseau', { ip: '198.51.100.7', couper: true, nom: 'Imprimante essai' });
  assert.ok(refuse(r.status), `réponse ${r.status} : ${JSON.stringify(r.body)}`);
});
test("membre avec le droit : changer le thème de l'écran est refusé", async () => {
  const avant = valhallaOf()!.ctx('gladsheim').settings.theme;
  const r = await membreB('/api/maison/theme', { theme: 'nuit' });
  assert.equal(valhallaOf()!.ctx('gladsheim').settings.theme, avant, 'thème inchangé');
  assert.ok(refuse(r.status), `réponse ${r.status}`);
});
test("membre avec le droit : ce qu'il dit à l'écran ne parle pas à l'IA d'Odin", async () => {
  const r = await membreB('/api/maison/dire', { texte: 'raconte-moi ma journée' });
  assert.ok(!String(r.body.text ?? '').includes(MARQUE), `réponse du faux modèle : ${JSON.stringify(r.body)}`);
});
test("membre avec le droit : un bouton grave, même confirmé, est refusé", async () => {
  const r = await membreB('/api/maison/bouton', { id: boutonGrave, confirm: true });
  assert.ok(personnes(persona()!).some((p) => p.login === 'cible-c'), `le compte cible existe encore (réponse : ${JSON.stringify(r.body)})`);
  assert.notEqual(r.body.ok, true);
});

// Les autres routes de /api/maison/* (lot 24b) : sans midgard ni vidarr chargés, la route va jusqu'à l'action et
// répond 200 « action inconnue » si rien ne refuse le membre avant ; le refus attendu vient avant.
test("membre avec le droit : commander un appareil est refusé", async () => {
  const r = await membreB('/api/maison/appareil', { appareil: 'light.salon', valeur: 'on' });
  assert.ok(refuse(r.status), `réponse ${r.status} : ${JSON.stringify(r.body)}`);
});
test("membre avec le droit : lancer une scène est refusé", async () => {
  const r = await membreB('/api/maison/scene', { scene: 'Soir' });
  assert.ok(refuse(r.status), `réponse ${r.status} : ${JSON.stringify(r.body)}`);
});
test("membre avec le droit : couper la vidéo d'un appareil est refusé", async () => {
  const r = await membreB('/api/maison/video', { ip: '198.51.100.7', couper: true, nom: 'Imprimante essai' });
  assert.ok(refuse(r.status), `réponse ${r.status} : ${JSON.stringify(r.body)}`);
});
test("membre avec le droit : un bouton grave de la fenêtre, même confirmé, est refusé", async () => {
  const r = await membreB('/api/maison/fenetre', { id: WIDGET_GRAVE, confirm: true });
  assert.ok(personnes(persona()!).some((p) => p.login === 'cible-e'), `le compte cible existe encore (réponse : ${JSON.stringify(r.body)})`);
  assert.ok(refuse(r.status), `réponse ${r.status}`);
});
test("membre avec le droit : « où est la famille » ne rend pas les positions", async () => {
  const r = await membreB('/api/maison/dire', { texte: 'où est la famille ?' });
  assert.ok(!String(r.body.text ?? '').includes('Proche D'), `positions rendues : ${JSON.stringify(r.body)}`);
  assert.ok(refuse(r.status), `réponse ${r.status}`);
});
test('membre avec le droit : il ne range pas la fenêtre', async () => {
  const avant = pagesDe();
  const r = await membreB('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ name: 'Page membre', widgets: [{ kind: 'heure' }] }] }) } });
  assert.deepEqual(pagesDe(), avant, `fenêtre inchangée (réponse ${r.status} : ${JSON.stringify(r.body)})`);
  assert.notEqual(r.body.ok, true);
});

// Une clé de tablette « complet » ouvre /maison avec les droits du propriétaire : un membre ne s'en crée pas
// (sinon il retrouve, par la clé, tout ce que sa session n'a plus sur /maison).
const clesDe = () => ((valhallaOf()!.ctx('gladsheim').settings.keys as Array<{ name: string }> | undefined) ?? []).map((k) => k.name);
for (const droits of ['complet', 'maison'] as const) {
  test(`membre avec le droit : il ne crée pas de clé de tablette « ${droits} », même confirmée`, async () => {
    const avant = clesDe();
    const r = await membreB('/api/valhalla/act', { module: 'gladsheim', action: 'cle_tablette', input: { nom: `Cle membre ${droits}`, droits }, confirm: true });
    assert.deepEqual(clesDe(), avant, `aucune clé ajoutée (réponse ${r.status} : ${JSON.stringify(r.body)})`);
    assert.equal((r.body.data as { key?: string } | undefined)?.key, undefined, 'aucune clé rendue');
    assert.notEqual(r.body.ok, true);
  });
}
test('contrôle : le propriétaire crée toujours une clé de tablette, avec sa confirmation', async () => {
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'cle_tablette', input: { nom: 'Tablette proprio', droits: 'maison' }, confirm: true });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(String((r.body.data as { key?: string } | undefined)?.key), /^gk_/);
  assert.ok(clesDe().includes('Tablette proprio'));
});

test('contrôle : le propriétaire range la fenêtre', async () => {
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ id: PAGE_MAISON, name: 'Maison', maison: true, widgets: [{ kind: 'heure' }] }, { name: 'Page proprio', widgets: [{ kind: 'meteo' }] }] }) } });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual(pagesDe(), ['Maison', 'Page proprio']);
});
test('contrôle : une tablette « maison » garde ses droits « maison »', async () => {
  const K = { 'x-odin-maison': cleMaison };
  const r = await v.json('/api/maison/etat', undefined, { ...K, cookie: '' });
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'maison');
  // Comme avant le lot 24b : le prénom du propriétaire reste rendu à une tablette « maison » (maison-api.ts, name: d.name).
  assert.equal(r.body.name, COMPTE.prenom);
  assert.deepEqual(r.body.apps, []); assert.deepEqual(r.body.people, []); assert.deepEqual(r.body.network, []);
  assert.equal((await v.json('/api/maison/camera?nom=Entree', undefined, { ...K, cookie: '' })).status, 403);
  assert.equal((await v.json('/api/maison/reseau', { ip: '198.51.100.7', couper: true }, { ...K, cookie: '' })).status, 403);
  assert.equal((await v.json('/api/maison/theme', { theme: 'nuit' }, { ...K, cookie: '' })).status, 403);
  // Un bouton grave : refusé à la tablette (200 avec le refus, comme avant).
  const b = await v.json('/api/maison/bouton', { id: boutonGrave, confirm: true }, { ...K, cookie: '' });
  assert.equal(b.status, 200); assert.notEqual(b.body.ok, true); assert.match(String(b.body.text), /action grave/);
  // Une commande de la maison passe toujours jusqu'à l'action (midgard absent ici : « action inconnue »).
  const a = await v.json('/api/maison/appareil', { appareil: 'light.salon', valeur: 'on' }, { ...K, cookie: '' });
  assert.equal(a.status, 200); assert.equal(a.body.text, 'action inconnue');
});
test('contrôle : une tablette « complet » garde ses droits « complet »', async () => {
  const r = await v.json('/api/maison/etat', undefined, { 'x-odin-maison': cleComplet, cookie: '' });
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'complet'); assert.equal(r.body.name, COMPTE.prenom);
  assert.ok((r.body.apps as Array<{ id: string }>).some((a) => a.id === 'var'), 'elle voit les applis');
  assert.ok((r.body.network as Array<{ ip: string }>).some((n) => n.ip === '198.51.100.7'), 'elle voit le réseau');
});
test('la clé d\'API (Bearer) n\'entre plus sur l\'écran de la maison (décision du propriétaire, 26/11 ; détail dans maison-cle-acces.test.ts)', async () => {
  const r = await v.json('/api/maison/etat', undefined, { authorization: `Bearer ${v.token}` });
  assert.equal(r.status, 401); assert.equal(r.body.rights, undefined);
});

test('contrôle : le propriétaire reçoit toujours « complet »', async () => {
  const r = await v.json('/api/maison/etat');
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'complet'); assert.equal(r.body.name, COMPTE.prenom);
  assert.ok((r.body.apps as Array<{ id: string }>).some((a) => a.id === 'var'), 'il voit les applis');
  assert.ok((r.body.network as Array<{ ip: string }>).some((n) => n.ip === '198.51.100.7'), 'il voit le réseau');
  assert.ok((r.body.people as Array<{ name: string }>).some((p) => p.name === 'Proche D'), 'il voit la famille');
});
