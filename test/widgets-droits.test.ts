// Qui voit quoi, widget par widget (maquette validée « Accueil », lot 24c) : le filet de sûreté du serveur.
// Un vrai Odin d'essai (serveur web + applis), par le même chemin que les pages : la session du propriétaire, celle
// d'un membre, une clé de tablette « maison » et une clé « complet ».
// - un membre n'a jamais la donnée d'un widget (la garde ferme /api/widgets/ ; donneeWidget lui rend `refuse`) ;
// - une tablette « maison » ne reçoit que les sortes des familles « infos » et « maison » permises (la vie privée
//   reste fermée tant qu'il ne l'a pas ouverte, sa réponse b à la question 15) ;
// - « À faire » (et les trois autres sortes de l'accueil) n'est rendu à PERSONNE par /api/maison/etat ;
// - un bouton qui lance une action grave n'est jamais servi à une tablette « maison » ;
// - (relecture) la route des widgets n'ouvre qu'à la session du propriétaire, pas à la clé d'API ; à une tablette,
//   jamais un widget d'une appli désactivée (ni lu, ni servi) ; le bouton qu'une tablette demande de lancer doit être
//   l'un de ceux qu'on lui sert (boutonMaison).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona, personnes } from '../src/valhalla/sso/etat.ts';
import { boutonMaison, lecteurMaison, pagesPermises } from '../src/web/widgets-api.ts';
import { donneeWidget, droitDeVoir, sorteDe } from '../src/valhalla/widgets/index.ts';
import { sourceOdin } from '../src/valhalla/widgets/source.ts';
import type { FPage, Widget } from '../src/valhalla/modules/gladsheim.ts';

const MDP = 'un-sentier-de-sable-sous-les-pins-31';
// Persona (var), Hestia (gladsheim), Cyclope (himinbjorg : famille Maison ET vie privée), Midgard (famille Maison, pas
// vie privée).
const IDS = ['var', 'gladsheim', 'himinbjorg', 'midgard', 'vordr'];
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
let v: VraiOdin, membre = '', cleMaison = '', cleComplet = '';
// Les widgets de la page « écran de la maison ».
const W = { heure: 'a0000001', meteo: 'a0000002', cyclope: 'a0000003', midgard: 'a0000004', grave: 'a0000005', seul: 'a0000006', theme: 'a0000007' };
const PAGE = 'b0000001', PAGE2 = 'b0000002';
// Une deuxième page « écran de la maison » : un bouton de Cyclope (vie privée, ni grave ni « propriétaire seul ») et
// un site de Pulsar (famille infos).
const W2 = { cameras: 'e0000001', oublier: 'e0000002', site: 'e0000003' };
type Servi = { id: string; kind: string };
const fenetreDe = (body: Record<string, unknown>) => ((body.fenetre as Array<{ id: string; widgets: Servi[] }> | undefined) ?? []).find((p) => p.id === PAGE)?.widgets ?? [];

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin et a même le droit sur Hestia et Cyclope.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'himinbjorg']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-a' })).ok, true);
  // La cible du bouton grave (son compte disparaîtrait si le bouton partait).
  assert.equal((await va.act('var', 'ajouter', { login: 'cible-c', nom: 'Cible C', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-a', MDP); assert.ok(membre, 'le membre a une session');
  // Une page « écran de la maison » avec une sorte de chaque public, plus « À faire » (que cleanLayout jette déjà).
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: PAGE, name: 'Maison', maison: true, widgets: [
    { id: W.heure, kind: 'heure', w: 1 },
    { id: W.meteo, kind: 'meteo', w: 1 },
    { id: W.cyclope, kind: 'chiffres', w: 1, module: 'himinbjorg' },
    { id: W.midgard, kind: 'chiffres', w: 1, module: 'midgard' },
    { id: W.grave, kind: 'bouton', w: 1, module: 'var', action: 'retirer', label: 'Retirer C', input: { login: 'cible-c' } },
    { id: W.seul, kind: 'bouton', w: 1, module: 'gladsheim', action: 'regler_animation', label: 'Animation', input: { animation: 'aucune' } },
    { id: W.theme, kind: 'bouton', w: 1, module: 'gladsheim', action: 'theme', label: 'Thème', input: { theme: 'verre' } },
    { id: 'a0000008', kind: 'a_faire', w: 1 },
  ] }, { id: PAGE2, name: 'Maison 2', maison: true, widgets: [
    { id: W2.cameras, kind: 'bouton', w: 1, module: 'himinbjorg', action: 'cameras', label: 'Caméras' },
    { id: W2.oublier, kind: 'bouton', w: 1, module: 'himinbjorg', action: 'retirer', label: 'Oublier', input: { camera: 'Chambre' } },
    { id: W2.site, kind: 'site', w: 1, module: 'vordr', label: 'Site' },
  ] }] }) });
  assert.equal((await va.act('himinbjorg', 'ajouter', { nom: 'Chambre', adresse: 'rtsp://192.0.2.9/flux', mouvement: false })).ok, true);
  assert.equal(f.ok, true, f.text);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  assert.ok(cleMaison && cleComplet, 'clés de tablette créées');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('un membre n\'a jamais la donnée d\'un widget fermé : la route et donneeWidget lui rendent « refuse »', async () => {
  // Depuis le 26/11 (sa question 15, réponse b) la route répond aussi à un membre, avec SES droits : un widget de la vie
  // privée (Cyclope) lui reste fermé tant que le propriétaire ne le lui a pas ouvert (test/widgets-ouvertures.test.ts) ;
  // un widget d'une appli qui n'est pas à lui (Midgard) aussi. Les autres routes de /api/widgets/ lui restent fermées.
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.qui, 'membre');
  const servis = r.body.widgets as Array<{ id: string; etat: string; raison?: string; donnee?: unknown }>;
  assert.deepEqual(servis.filter((x) => x.id === W.cyclope || x.id === W.midgard).map((x) => `${x.etat} ${x.raison} ${x.donnee === undefined}`), ['refuse vie_privee true', 'refuse appli_fermee true']);
  assert.ok(!JSON.stringify(r.body).includes('192.0.2.9'), 'rien de Cyclope');
  const autre = await v.json('/api/widgets/autre', undefined, { cookie: membre });
  assert.equal(autre.status, 403, 'la garde ferme le reste de /api/widgets/ aux membres'); assert.equal(autre.body.code, 'reserve');
  // Sans droit sur l'appli lue : refusé, avant toute lecture.
  const va = valhallaOf()!, src = sourceOdin(va);
  const w = { id: 'c0000001', kind: 'chiffres', module: 'midgard' } as Widget;
  const e = await donneeWidget(w, { qui: 'membre', ecran: 'accueil', peutLire: () => false }, src);
  assert.equal(e.etat, 'refuse');
  // Même avec le droit sur Cyclope : la vie privée reste fermée tant qu'il ne l'a pas ouverte à cette personne.
  const cy = await donneeWidget({ ...w, module: 'himinbjorg' }, { qui: 'membre', ecran: 'accueil', peutLire: () => true }, src);
  assert.deepEqual(cy, { etat: 'refuse', raison: 'vie_privee', appli: 'himinbjorg' });
  // Un widget réservé au propriétaire : refusé à un membre, même avec tous les droits.
  assert.equal((await donneeWidget({ id: 'c0000002', kind: 'a_faire' } as unknown as Widget, { qui: 'membre', ecran: 'accueil', peutLire: () => true }, src)).etat, 'refuse');
});

test('la donnée des widgets : au propriétaire seul (sans session, ou avec une clé de tablette : refusée)', async () => {
  const sans = await fetch(`${v.url}/api/widgets/donnees`);
  assert.equal(sans.status, 401);
  const tablette = await fetch(`${v.url}/api/widgets/donnees`, { headers: { 'x-odin-maison': cleComplet } });
  assert.equal(tablette.status, 401, 'une clé de tablette n\'ouvre pas cette route');
  const r = await v.json('/api/widgets/donnees');
  assert.equal(r.status, 200);
  const ws = r.body.widgets as Array<{ id: string; etat: string }>;
  assert.ok(ws.length >= 7, 'chaque widget de la fenêtre a sa donnée');
  for (const x of ws) assert.ok(['ok', 'vide', 'source_absente', 'refuse', 'ancien'].includes(x.etat), `${x.id} : un des cinq états`);
  assert.ok(!ws.some((x) => x.id === 'a0000008'), '« À faire » n\'est pas dans la fenêtre rangée');
  assert.equal((await v.json('/api/widgets/donnees', { x: 1 })).status, 405);
});

test('une clé « maison » ne reçoit que les sortes infos et maison permises', async () => {
  const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'maison');
  const ids = fenetreDe(r.body).map((x) => x.id).sort();
  assert.deepEqual(ids, [W.heure, W.meteo, W.midgard, W.theme].sort());
  // Chaque sorte servie : famille infos ou maison (les chiffres d'une appli de la famille Maison d'Odin comptent pour « maison »).
  for (const x of fenetreDe(r.body)) assert.ok(['infos', 'maison'].includes(sorteDe(x.kind)!.famille) || x.id === W.midgard, `${x.kind} servi à une tablette`);
});

test('ta session et une clé « complet » : les droits du propriétaire, sauf les quatre sortes de l\'accueil', async () => {
  const attendu = Object.values(W).sort();
  for (const h of [{}, { cookie: '', 'x-odin-maison': cleComplet }] as Array<Record<string, string>>) {
    const r = await v.json('/api/maison/etat', undefined, h);
    assert.equal(r.status, 200);
    assert.deepEqual(fenetreDe(r.body).map((x) => x.id).sort(), attendu);
  }
});

test('« À faire » sur une page « Écran de la maison » : /api/maison/etat ne le rend à personne', async () => {
  for (const h of [{}, { cookie: '', 'x-odin-maison': cleComplet }, { cookie: '', 'x-odin-maison': cleMaison }] as Array<Record<string, string>>) {
    const r = await v.json('/api/maison/etat', undefined, h);
    assert.ok(!fenetreDe(r.body).some((x) => ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement'].includes(x.kind)));
  }
  // Même si un jour la fenêtre gardait « À faire » (sorte posable), le filet le retire pour tous sur l'écran de la maison.
  const va = valhallaOf()!, src = sourceOdin(va);
  const pages: FPage[] = [{ id: PAGE, name: 'Maison', maison: true, widgets: ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement'].map((kind, i) => ({ id: `d000000${i}`, kind, w: 1, c: 3, r: 3 }) as unknown as Widget) }];
  for (const full of [true, false]) assert.deepEqual((await pagesPermises(va, pages, lecteurMaison(full), src))[0].widgets, []);
  assert.equal(droitDeVoir(pages[0].widgets[0], { qui: 'proprietaire', ecran: 'maison' }, src)?.etat, 'refuse');
  assert.equal(droitDeVoir(pages[0].widgets[0], { qui: 'proprietaire', ecran: 'accueil' }, src), undefined, 'sur son accueil, oui');
});

test('un bouton qui lance une action grave n\'est jamais servi à une tablette « maison », ni lancé par elle', async () => {
  const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
  assert.ok(!fenetreDe(r.body).some((x) => x.id === W.grave), 'bouton grave non servi');
  assert.ok(!fenetreDe(r.body).some((x) => x.id === W.seul), 'bouton « propriétaire seul » non servi');
  const t = await v.json('/api/maison/fenetre', { id: W.grave, confirm: true }, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(t.body.ok, false);
  assert.ok(personnes(persona()!).some((p) => p.login === 'cible-c'), 'le compte cible existe encore');
  const va = valhallaOf()!, src = sourceOdin(va);
  const w = { id: W.grave, kind: 'bouton', w: 1, c: 3, r: 1, module: 'var', action: 'retirer', input: { login: 'cible-c' } } as Widget;
  assert.deepEqual((await pagesPermises(va, [{ id: PAGE, name: 'Maison', maison: true, widgets: [w] }], lecteurMaison(false), src))[0].widgets, []);
  assert.equal((await pagesPermises(va, [{ id: PAGE, name: 'Maison', maison: true, widgets: [w] }], lecteurMaison(true), src))[0].widgets.length, 1, 'à ta session, oui (avec sa confirmation)');
});

const servis = (body: Record<string, unknown>, page: string) => ((body.fenetre as Array<{ id: string; widgets: Servi[] }> | undefined) ?? []).find((p) => p.id === page)?.widgets.map((x) => x.id) ?? [];

test('la donnée des widgets : la session du propriétaire seule, pas la clé d\'API', async () => {
  const r = await fetch(`${v.url}/api/widgets/donnees`, { headers: { authorization: `Bearer ${v.token}` } });
  assert.equal(r.status, 401, 'la clé d\'API n\'ouvre pas cette route');
  assert.equal(((await r.json()) as { widgets?: unknown }).widgets, undefined);
});

test('une appli désactivée : son widget n\'est ni lu ni servi à une tablette (ta session le garde, comme aujourd\'hui)', async () => {
  const va = valhallaOf()!, m = va.module('vordr')!, vue = m.view; let lu = 0;
  assert.ok(servis((await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison })).body, PAGE2).includes(W2.site), 'Pulsar active : le site est servi');
  await va.activer('vordr', false);
  (m as { view: typeof vue }).view = (...a) => { lu++; return vue.apply(m, a); };
  try {
    const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
    assert.equal(r.status, 200);
    assert.equal(lu, 0, 'Pulsar désactivée n\'est pas lue pour la tablette');
    assert.ok(!servis(r.body, PAGE2).includes(W2.site), 'son site n\'est pas servi');
    assert.ok(servis((await v.json('/api/maison/etat')).body, PAGE2).includes(W2.site), 'à ta session, rien ne change');
  } finally { (m as { view: typeof vue }).view = vue; await va.activer('vordr', true); }
});

test('un bouton de la vie privée : ni servi à une tablette, ni trouvé pour elle par boutonMaison', async () => {
  const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
  assert.ok(!servis(r.body, PAGE2).includes(W2.cameras) && !servis(r.body, PAGE2).includes(W2.oublier), 'pas servis');
  const va = valhallaOf()!, pages = (await va.act('gladsheim', 'fenetre', {})).data as { pages: FPage[] } | undefined;
  const ps = pages?.pages ?? [];
  assert.ok(ps.length, 'la fenêtre rangée');
  for (const id of [W2.cameras, W2.oublier, W.grave, W.seul, 'a0000008', 'zzz']) assert.equal(await boutonMaison(va, ps, id, false), undefined, `${id} : pas pour une tablette`);
  assert.equal((await boutonMaison(va, ps, W.theme, false))?.id, W.theme, 'un bouton servi à la tablette reste lançable');
  for (const id of [W2.cameras, W2.oublier, W.grave, W.seul, W.theme]) assert.equal((await boutonMaison(va, ps, id, true))?.id, id, `${id} : à ta session (ou une clé « complet »), comme aujourd'hui`);
});

// Le trou reste ouvert tant que /api/maison/fenetre ne passe pas par boutonMaison (une ligne de maison-api.ts, code
// sensible : à montrer). Marqué « à faire » : il est lancé, son échec ne casse pas la liste.
test('une tablette ne lance pas un bouton qu\'on ne lui sert pas (Cyclope : la liste des caméras, oublier une caméra)', async () => {
  const r = await v.json('/api/maison/fenetre', { id: W2.cameras }, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(r.body.ok, false, `lancé : ${JSON.stringify(r.body)}`);
  assert.ok(!JSON.stringify(r.body).includes('rtsp://'), 'l\'adresse de la caméra n\'est pas rendue');
});
