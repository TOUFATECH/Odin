// La vie privée, widget par widget et personne par personne (sa question 15, réponse b, validée le 26/11) : un widget
// qui lit une appli de la vie privée reste fermé à un membre, même s'il a le droit sur l'appli, tant que le
// propriétaire ne le lui a pas ouvert, à LUI, pour CE widget. Un vrai Odin d'essai (serveur web + applis), par le même
// chemin que la page d'un membre : sa session, la route /api/widgets/donnees.
//  - sans ouverture : rien d'une appli de la vie privée ne lui est rendu par la route des widgets ;
//  - ouvert pour lui : CE widget seulement (pas l'autre widget de la même appli, pas un autre membre) ;
//  - ouverture retirée : refermé ; widget pointé sur une autre appli : refermé, et il le reste si on le repointe ;
//  - seul le propriétaire ouvre et ferme (ni un membre, ni une automatisation), et c'est noté dans « qui a fait quoi » ;
//  - une ouverture ne donne aucun droit sur l'appli ; la garde ne laisse passer que cette route-là, en lecture.
// Les adresses sont des adresses d'exemple (192.0.2.x).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona, personnes } from '../src/valhalla/sso/etat.ts';
import { applisPrivees, ouverturesDe, ouverturesGardees } from '../src/valhalla/widgets/ouvertures.ts';
import { lecteurMaison } from '../src/web/widgets-api.ts';
import type { Layout, Widget } from '../src/valhalla/modules/gladsheim.ts';

const MDP = 'un-manguier-au-bord-de-la-piste-73';
// Persona (var), Hestia (gladsheim), Cyclope (himinbjorg : vie privée), Chronos (frigg : vie privée), Midgard (pas vie privée).
const IDS = ['var', 'gladsheim', 'himinbjorg', 'frigg', 'midgard'];
const W = { cyclope: 'a0000001', cyclope2: 'a0000002', midgard: 'a0000003', chronos: 'a0000004' };
const PAGE = 'b0000001';
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
let v: VraiOdin, a = '', b = '', c = '';
type Etat = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const fenetre = (cyclope: string = 'himinbjorg') => ({ pages: [{ id: PAGE, name: 'Essai', widgets: [
  { id: W.cyclope, kind: 'section', w: 1, module: cyclope, section: cyclope === 'himinbjorg' ? 'Caméras' : 'À venir', label: 'Les caméras' },
  { id: W.cyclope2, kind: 'chiffres', w: 1, module: 'himinbjorg' },
  { id: W.midgard, kind: 'chiffres', w: 1, module: 'midgard' },
  { id: W.chronos, kind: 'chiffres', w: 1, module: 'frigg' },
] }] });
const ranger = async (f: unknown) => { const r = await valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text); };
/** Ce que la route des widgets rend à cette session. */
async function widgets(cookie?: string): Promise<{ status: number; qui: unknown; texte: string; de: (id: string) => Etat }> {
  const r = await v.json('/api/widgets/donnees', undefined, cookie ? { cookie } : {}), l = (r.body.widgets ?? []) as Etat[];
  return { status: r.status, qui: r.body.qui, texte: JSON.stringify(r.body), de: (id) => l.find((x) => x.id === id)! };
}
const ouvrir = (widget: string, personne: string, ouvert: 'oui' | 'non', cookie?: string) => v.json('/api/valhalla/act', { module: 'gladsheim', action: 'ouvrir_widget', input: { widget, personne, ouvert } }, cookie ? { cookie } : {});

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  for (const [login, nom] of [['membre-a', 'Membre A'], ['membre-b', 'Membre B'], ['membre-c', 'Membre C']]) assert.equal((await va.act('var', 'ajouter', { login, nom, groupes: 'invite', mot_de_passe: MDP })).ok, true);
  // A et B entrent dans Odin et ont le droit sur Hestia, Cyclope, Chronos et Midgard ; C entre dans Odin, sans droit sur Cyclope.
  for (const qui of ['@membre-a', '@membre-b']) for (const appli of ['odin', 'gladsheim', 'himinbjorg', 'frigg', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui })).ok, true);
  for (const appli of ['odin', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-c' })).ok, true);
  lierProprietaire(persona()!);
  assert.equal((await va.act('himinbjorg', 'ajouter', { nom: 'Chambre-des-enfants', adresse: 'rtsp://192.0.2.9/flux', mouvement: false })).ok, true);
  await ranger(fenetre());
  a = await entrer(v, 'membre-a', MDP); b = await entrer(v, 'membre-b', MDP); c = await entrer(v, 'membre-c', MDP);
  assert.ok(a && b && c, 'les trois membres ont une session');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('contrôle : le propriétaire lit le widget de Cyclope, et la caméra y est nommée', async () => {
  const p = await widgets();
  assert.equal(p.status, 200); assert.equal(p.qui, 'proprietaire');
  assert.equal(p.de(W.cyclope).etat, 'ok', JSON.stringify(p.de(W.cyclope)));
  assert.ok(p.texte.includes('Chambre-des-enfants'), 'la donnée de Cyclope porte le nom de la caméra');
});

test('un membre sans ouverture : la route lui répond, mais rien d\'une appli de la vie privée', async () => {
  const m = await widgets(a);
  assert.equal(m.status, 200, m.texte); assert.equal(m.qui, 'membre');
  for (const id of [W.cyclope, W.cyclope2]) assert.deepEqual({ ...m.de(id), kind: undefined }, { id, kind: undefined, page: PAGE, etat: 'refuse', raison: 'vie_privee', appli: 'himinbjorg' });
  assert.deepEqual({ ...m.de(W.chronos), kind: undefined }, { id: W.chronos, kind: undefined, page: PAGE, etat: 'refuse', raison: 'vie_privee', appli: 'frigg' });
  assert.ok(!m.texte.includes('Chambre-des-enfants') && !m.texte.includes('192.0.2.9'), 'rien de Cyclope dans la réponse');
  // Une appli à lui, hors vie privée : lue pour lui (un des états sans refus).
  assert.notEqual(m.de(W.midgard).etat, 'refuse', JSON.stringify(m.de(W.midgard)));
  // Sans droit sur l'appli (C) : fermé pour cette raison-là, avant la vie privée.
  const mc = await widgets(c);
  assert.equal(mc.status, 200); assert.equal(mc.de(W.cyclope).raison, 'appli_fermee'); assert.equal(mc.de(W.midgard).raison, 'appli_fermee');
});

test('ouvert pour lui : CE widget seulement ; pas l\'autre widget de la même appli, pas un autre membre', async () => {
  const r = await ouvrir(W.cyclope, 'membre-a', 'oui');
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(String(r.body.text), /« Les caméras » \(Cyclope\) est ouvert à Membre A\./);
  const m = await widgets(a);
  assert.equal(m.de(W.cyclope).etat, 'ok', JSON.stringify(m.de(W.cyclope)));
  assert.ok(m.texte.includes('Chambre-des-enfants'), 'il lit maintenant CE widget');
  assert.deepEqual([m.de(W.cyclope2).etat, m.de(W.cyclope2).raison], ['refuse', 'vie_privee'], 'l\'autre widget de Cyclope reste fermé');
  assert.deepEqual([m.de(W.chronos).etat, m.de(W.chronos).raison], ['refuse', 'vie_privee'], 'Chronos reste fermé');
  const autre = await widgets(b);
  assert.deepEqual([autre.de(W.cyclope).etat, autre.de(W.cyclope).raison], ['refuse', 'vie_privee'], 'un autre membre : toujours fermé');
  assert.ok(!autre.texte.includes('Chambre-des-enfants'));
  // Gardé dans les réglages de Hestia, par la fiche Persona de la personne et par « widget@appli ».
  const g = valhallaOf()!.ctx('gladsheim'), pa = personnes(persona()!).find((x) => x.login === 'membre-a')!, pb = personnes(persona()!).find((x) => x.login === 'membre-b')!;
  assert.deepEqual(ouverturesDe(g, pa.id), [`${W.cyclope}@himinbjorg`]); assert.deepEqual(ouverturesDe(g, pb.id), []);
  // La liste que lit l'écran « Ouvrir à… ».
  const l = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'ouvertures_widget', input: { widget: W.cyclope } });
  assert.deepEqual((l.body.data as { personnes: Array<{ login: string; ouvert: boolean; droit: boolean }> }).personnes.map((x) => `${x.login} ${x.ouvert} ${x.droit}`).sort(), ['membre-a true true', 'membre-b false true', 'membre-c false false']);
});

test('une ouverture ne donne aucun droit sur l\'appli', async () => {
  assert.equal((await ouvrir(W.cyclope, 'membre-c', 'oui')).body.ok, true);
  const mc = await widgets(c);
  assert.deepEqual([mc.de(W.cyclope).etat, mc.de(W.cyclope).raison], ['refuse', 'appli_fermee'], 'sans le droit sur Cyclope : toujours fermé');
  assert.ok(!mc.texte.includes('Chambre-des-enfants'));
  assert.equal((await ouvrir(W.cyclope, 'membre-c', 'non')).body.ok, true);
});

test('seul le propriétaire ouvre et ferme ; c\'est noté dans « qui a fait quoi »', async () => {
  // Un membre (il a le droit sur Hestia) : refusé, pour lui comme pour un autre ; la liste aussi.
  for (const [widget, personne] of [[W.cyclope2, 'membre-b'], [W.cyclope, 'membre-a'], [W.chronos, 'membre-a']]) {
    const r = await ouvrir(widget, personne, 'oui', b);
    assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(r.body.code, 'reserve');
  }
  assert.equal((await ouvrir(W.cyclope, 'membre-a', 'non', b)).status, 403, 'ni refermer');
  assert.equal((await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'ouvertures_widget', input: { widget: W.cyclope } }, { cookie: b })).status, 403);
  assert.equal((await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'qui_a_fait', input: {} }, { cookie: b })).status, 403);
  // Une automatisation, Odin de lui-même, une conversation marquée : refusés aussi.
  const va = valhallaOf()!;
  for (const o of [{ by: 'automatisation' as const }, { auto: true }, { marque: true }, { qui: 'member' as const }]) assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: W.cyclope2, personne: 'membre-b', ouvert: 'oui' }, o)).ok, false, JSON.stringify(o));
  // Rien n'a changé.
  assert.deepEqual([(await widgets(b)).de(W.cyclope2).raison, (await widgets(a)).de(W.cyclope).etat], ['vie_privee', 'ok']);
  // Ce qui est refusé d'avance : un widget inconnu, un widget sans vie privée, une personne inconnue, le propriétaire.
  for (const [widget, personne] of [['ffffffff', 'membre-a'], [W.midgard, 'membre-a'], [W.cyclope, 'personne'], [W.cyclope, '__proto__']]) assert.equal((await ouvrir(widget, personne, 'oui')).body.ok, false, `${widget} ${personne}`);
  assert.equal((await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'ouvrir_widget', input: { widget: W.cyclope, personne: 'membre-a', ouvert: 'peut-être' } })).body.ok, false);
  // « Qui a fait quoi » de Hestia : les ouvertures du propriétaire y sont, avec le widget et la personne.
  const j = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'qui_a_fait', input: {} });
  const actes = (j.body.data as { actes: Array<{ qui: string; action: string; quoi: string; ok: boolean }> }).actes;
  assert.ok(actes.some((x) => x.qui === 'propriétaire' && x.ok && x.action === 'Ouvrir un widget à une personne' && x.quoi.includes(W.cyclope) && x.quoi.includes('membre-a') && x.quoi.includes('ouvert : oui')), JSON.stringify(actes));
  assert.ok(actes.some((x) => !x.ok && x.quoi.includes('ffffffff')), 'un refus est noté aussi');
});

test('ouverture retirée : refermé', async () => {
  assert.equal((await ouvrir(W.cyclope, 'membre-a', 'non')).body.ok, true);
  const m = await widgets(a);
  assert.deepEqual([m.de(W.cyclope).etat, m.de(W.cyclope).raison], ['refuse', 'vie_privee']);
  assert.ok(!m.texte.includes('Chambre-des-enfants'));
});

test('widget pointé sur une autre appli : refermé, et il le reste quand on le repointe', async () => {
  assert.equal((await ouvrir(W.cyclope, 'membre-a', 'oui')).body.ok, true);
  assert.equal((await widgets(a)).de(W.cyclope).etat, 'ok');
  const g = valhallaOf()!.ctx('gladsheim'), pa = personnes(persona()!).find((x) => x.login === 'membre-a')!;
  // Le même identifiant, maintenant sur Chronos (une autre appli de la vie privée, à laquelle il a droit).
  await ranger(fenetre('frigg'));
  const m = await widgets(a);
  assert.deepEqual([m.de(W.cyclope).etat, m.de(W.cyclope).raison, m.de(W.cyclope).appli], ['refuse', 'vie_privee', 'frigg']);
  assert.deepEqual(ouverturesDe(g, pa.id), [], 'ranger la fenêtre a retiré l\'ouverture qui ne vaut plus');
  // Repointé sur Cyclope : il ne se rouvre pas tout seul.
  await ranger(fenetre());
  assert.deepEqual([(await widgets(a)).de(W.cyclope).etat, (await widgets(a)).de(W.cyclope).raison], ['refuse', 'vie_privee']);
  // Même sans le rangement (un réglage resté là) : la clé « widget@appli » ne vaut que pour l'appli d'alors. Pur.
  const l = fenetre('frigg') as unknown as Layout, w = l.pages[0].widgets[0] as Widget;
  assert.deepEqual(applisPrivees(w), ['frigg']);
  assert.deepEqual({ ...ouverturesGardees({ settings: { ouvertures: { [pa.id]: [`${W.cyclope}@himinbjorg`, `${W.cyclope2}@himinbjorg`, 'pas-une-cle', 7], '__proto__': ['a0000001@frigg'], 'pas une fiche': [`${W.cyclope2}@himinbjorg`] } } }, l) }, { [pa.id]: [`${W.cyclope2}@himinbjorg`] });
  // Le widget retiré de la fenêtre : son ouverture part avec lui.
  assert.equal((await ouvrir(W.cyclope2, 'membre-a', 'oui')).body.ok, true);
  const sans = fenetre(); sans.pages[0].widgets = sans.pages[0].widgets.filter((x) => x.id !== W.cyclope2);
  await ranger(sans); assert.deepEqual(ouverturesDe(g, pa.id), []);
  await ranger(fenetre());
  assert.equal((await widgets(a)).de(W.cyclope2).raison, 'vie_privee', 'reposé avec le même identifiant : fermé');
});

test('le widget montre autre chose de la même appli : refermé ; son titre seul change : il reste ouvert', async () => {
  const g = valhallaOf()!.ctx('gladsheim'), pa = personnes(persona()!).find((x) => x.login === 'membre-a')!;
  assert.equal((await ouvrir(W.cyclope, 'membre-a', 'oui')).body.ok, true);
  assert.equal((await ouvrir(W.cyclope2, 'membre-a', 'oui')).body.ok, true);
  // Le titre seul change : c'est toujours ce que le propriétaire a ouvert.
  const f = fenetre(); f.pages[0].widgets[0].label = 'Mes caméras';
  await ranger(f);
  assert.equal((await widgets(a)).de(W.cyclope).etat, 'ok');
  // Les chiffres de Cyclope deviennent une partie de sa page (même identifiant, même appli) : ce n'est plus ce qu'il a ouvert.
  f.pages[0].widgets[1] = { id: W.cyclope2, kind: 'section', w: 1, module: 'himinbjorg', section: 'Caméras', label: 'Autre chose' };
  await ranger(f);
  const m = await widgets(a);
  assert.deepEqual([m.de(W.cyclope2).etat, m.de(W.cyclope2).raison], ['refuse', 'vie_privee'], JSON.stringify(m.de(W.cyclope2)));
  assert.deepEqual(ouverturesDe(g, pa.id), [`${W.cyclope}@himinbjorg`], 'le widget inchangé reste ouvert');
  // Remis comme avant : il ne se rouvre pas tout seul.
  await ranger(fenetre());
  assert.equal((await widgets(a)).de(W.cyclope2).raison, 'vie_privee');
  assert.equal((await ouvrir(W.cyclope, 'membre-a', 'non')).body.ok, true);
});

test('une personne retirée de Persona : ce qui lui était ouvert part avec elle', async () => {
  const va = valhallaOf()!, g = va.ctx('gladsheim');
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-d', nom: 'Membre D', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  const pd = personnes(persona()!).find((x) => x.login === 'membre-d')!;
  assert.equal((await ouvrir(W.cyclope, 'membre-d', 'oui')).body.ok, true);
  assert.deepEqual(ouverturesDe(g, pd.id), [`${W.cyclope}@himinbjorg`]);
  assert.equal((await va.act('var', 'retirer', { login: 'membre-d' })).ok, true);
  // Au prochain changement d'ouverture, la fiche qui n'existe plus est retirée du réglage.
  assert.equal((await ouvrir(W.chronos, 'membre-a', 'oui')).body.ok, true);
  assert.ok(!(pd.id in (g.settings.ouvertures as Record<string, unknown>)), JSON.stringify(g.settings.ouvertures));
  assert.equal((await ouvrir(W.chronos, 'membre-a', 'non')).body.ok, true);
  // Une autre personne créée avec le même nom de connexion : une autre fiche, rien d'hérité.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-d', nom: 'Autre D', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  const pd2 = personnes(persona()!).find((x) => x.login === 'membre-d')!;
  assert.notEqual(pd2.id, pd.id); assert.deepEqual(ouverturesDe(g, pd2.id), []);
});

test('la garde ne laisse passer que cette route, en lecture ; un membre sans le droit d\'entrer dans Odin : rien', async () => {
  assert.equal((await v.json('/api/widgets/donnees', { x: 1 }, { cookie: a })).status, 403, 'écrire : fermé');
  assert.equal((await v.json('/api/widgets/autre', undefined, { cookie: a })).status, 403, 'une autre route des widgets : fermée');
  assert.equal((await v.json('/api/widgets/donnees/', undefined, { cookie: a })).status, 403);
  assert.equal((await fetch(`${v.url}/api/widgets/donnees`)).status, 401, 'sans session : rien');
  // Le droit d'entrer dans Odin retiré : sa session ne lit plus rien.
  assert.equal((await valhallaOf()!.act('var', 'retirer_acces', { appli: 'odin', qui: '@membre-b' })).ok, true);
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: b });
  assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(r.body.widgets, undefined);
  // Sans le droit sur Hestia (la fenêtre est la sienne) : rien de la fenêtre ne lui est dit, pas même quelle appli lit quel widget.
  assert.equal((await widgets(c)).status, 200);
  assert.equal((await valhallaOf()!.act('var', 'retirer_acces', { appli: 'gladsheim', qui: '@membre-c' })).ok, true);
  const rc = await v.json('/api/widgets/donnees', undefined, { cookie: c });
  assert.equal(rc.status, 403, JSON.stringify(rc.body)); assert.equal(rc.body.widgets, undefined); assert.ok(!JSON.stringify(rc.body).includes('himinbjorg'));
  // Une clé d'API n'est pas une session : ni la route, ni les deux actions.
  const cle = { authorization: `Bearer ${v.token}` };
  assert.equal((await v.json('/api/widgets/donnees', undefined, cle)).status, 401);
  for (const [action, input] of [['ouvrir_widget', { widget: W.cyclope, personne: 'membre-a', ouvert: 'oui' }], ['ouvertures_widget', { widget: W.cyclope }]] as const) {
    const k = await v.json('/api/valhalla/act', { module: 'gladsheim', action, input }, cle);
    // Depuis le 24/11, la clé d'accès lit et parle seulement : le refus vient plus tôt (403, « ce geste demande ta session »).
    assert.equal(k.status, 403); assert.equal(k.body.ok, false, JSON.stringify(k.body)); assert.equal(k.body.code, 'session');
  }
  assert.equal((await widgets(a)).de(W.cyclope).raison, 'vie_privee', 'rien ouvert par la clé');
});

test('une tablette « maison » : inchangée, rien ne lui est ouvert', () => {
  const l = lecteurMaison(false);
  assert.equal(l.qui, 'maison'); assert.equal(l.ouverts?.size, 0);
});
