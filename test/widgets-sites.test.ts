// Les widgets « Alertes » (la liste) et « Sites web » de l'accueil (maquette validée « Accueil ») : la famille
// « veille » (src/valhalla/widgets/veille.ts, src/web/pages/widgets-veille.js).
// - Les sites sont ceux d'Arachné (sa réponse à la question 14 : « Mes sites ») ; Pulsar reste à côté.
// - Rien n'est montré tant qu'Odin n'a pas la vraie donnée (question 13) : zéro site → « vide » avec « Ajouter un
//   site » ; aucun site vérifié → pas de chiffre ; une veille qui ne vérifie plus → « ancien », avec son heure.
// - Le bord rouge n'est mis que s'il y a une panne ; « Vérifier », « Essayer », « Relancer » passent par l'action
//   d'Arachné, au propriétaire seul : un membre sans droit ou une tablette sont refusés par le serveur.
// - « Vu » passe par la route d'aujourd'hui (POST /api/valhalla/ack) : le compte baisse, l'alerte ne revient pas.
// - Un nom de site piégé (du HTML, un texte très long) reste du texte et ne déborde pas ; 1280 et 390 px, clair et sombre.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { cleOuverture, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import type { SiteVeille } from '../src/valhalla/widgets/sorte.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), VEILLE = lire('src/web/pages/widgets-veille.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'c5e00000', kind, w: 1, c: 4, r: 5, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[], ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set(ouverts) });
const MAINT = 10_000_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; appli?: string };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

/** Une fausse source : les sites d'Arachné (null : Arachné absente), les alertes pas encore vues. */
function fausse(o: { sites?: SiteVeille[] | null; alertes?: Array<{ id: string; appli: string; titre: string; niveau: string; at: number }> } = {}): SourceWidget {
  const applis: Record<string, { name: string; family: string }> = { idunn: { name: 'Appli des sites', family: 'Machines' }, forseti: { name: 'Appli des alertes', family: 'Sécurité' } };
  return {
    appli: (id) => (applis[id] && !(id === 'idunn' && o.sites === null) ? { id, ...applis[id] } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => MAINT,
    alertesNonVues: () => (o.alertes ?? []).map((a) => ({ appli: a.appli })),
    alertesAVoir: () => (o.alertes ?? []).map((a) => ({ ...a, nomAppli: `Nom ${a.appli}` })),
    sitesVeille: () => (o.sites === null ? undefined : o.sites ?? []),
  };
}
const site = (nom: string, o: Partial<SiteVeille> = {}): SiteVeille => ({ nom, lent: false, relancer: false, toutesLes: 5, ...o });

// ------------------------------------------------------------------ le serveur, sans Odin

test('les trois sortes : famille « veille », tailles de la maquette, public « membre » (jamais une tablette), posables', () => {
  for (const [id, mini, r, applis] of [['alertes_liste', [3, 2], 3, ['forseti']], ['sites', [3, 2], 5, ['idunn']], ['sites_petit', [2, 1], 1, ['idunn']]] as const) {
    const s = sorteDe(id);
    assert.ok(s, `${id} déclarée`); assert.equal(s.famille, 'veille'); assert.equal(s.posable, true); assert.equal(publicDe(s), 'membre');
    assert.deepEqual([[...s.taille.mini], s.taille.r, s.applis], [[...mini], r, applis], id);
    assert.deepEqual((TAILLE_SORTE as Record<string, unknown>)[id], { mini: [...mini], r }, `${id} : la taille gardée par Hestia`);
  }
  assert.deepEqual(sorteDe('sites')!.styles, ['apercus'], 'le style de départ de la maquette');
  assert.equal(sorteDe('site')!.applis, 'choisie', 'le widget « site » de Pulsar ne change pas');
});

test('zéro site → « vide » (aucun_site), pour le grand widget et le petit chiffre ; Arachné absente → « source_absente »', async () => {
  const src = fausse({ sites: [] });
  for (const k of ['sites', 'sites_petit']) assert.deepEqual(await etat(W(k), LUI, src), { etat: 'vide', raison: 'aucun_site' }, k);
  for (const k of ['sites', 'sites_petit']) assert.deepEqual(await etat(W(k), LUI, fausse({ sites: null })), { etat: 'source_absente', raison: 'appli_absente' }, k);
});

test('les sites : les pannes d\'abord ; « Relancer » et « agir » au propriétaire seul ; un membre sans droit ou une tablette : refusé, sans un nom', async () => {
  const src = fausse({ sites: [
    site('site-a.test', { enLigne: true, ms: 182, verifieA: MAINT - 60_000, relancer: true }),
    site('site-b.test', { enLigne: false, verifieA: MAINT - 60_000, enPanneDepuis: MAINT - 3_600_000, relancer: true, ms: 9 }),
    site('site-c.test', { enLigne: true, lent: true, ms: 5200, verifieA: MAINT - 120_000 }),
    site('site-d.test'),
  ] });
  const e = await etat(W('sites'), LUI, src);
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT - 60_000, 'l\'heure de la vérification la plus récente');
  const d = e.donnee as { sites: Array<Record<string, unknown>>; total: number; enLigne: number; panne: number; lents: number; agir: boolean };
  assert.deepEqual(d.sites.map((x) => `${x.nom}:${x.etat}`), ['site-b.test:panne', 'site-c.test:lent', 'site-d.test:inconnu', 'site-a.test:ok']);
  assert.deepEqual(d.sites[0], { nom: 'site-b.test', etat: 'panne', verifie: MAINT - 60_000, depuis: MAINT - 3_600_000, relancer: true }, 'en panne : depuis quand, sans temps de réponse');
  assert.deepEqual(d.sites[3], { nom: 'site-a.test', etat: 'ok', ms: 182, verifie: MAINT - 60_000, relancer: true });
  assert.equal('relancer' in d.sites[1], false, 'pas relié à Vercel : pas de « Relancer »');
  assert.deepEqual([d.total, d.enLigne, d.panne, d.lents, d.agir], [4, 2, 1, 1, true]);
  // Un membre qui a le droit sur Arachné : les noms et les états, ni « Relancer », ni « agir ».
  const m = await etat(W('sites'), membre(['idunn']), src);
  assert.equal(m.etat, 'ok'); assert.equal((m.donnee as { agir: boolean }).agir, false);
  assert.ok(!JSON.stringify(m.donnee).includes('relancer'), 'aucune action pour un membre');
  // Sans le droit : refusé avant toute lecture ; une tablette : jamais.
  for (const [qui, l] of [['membre sans droit', membre(['forseti'])], ['tablette', TABLETTE]] as const) {
    for (const k of ['sites', 'sites_petit']) { const r = await etat(W(k), l, src); assert.equal(r.etat, 'refuse', `${qui} ${k}`); assert.ok(!JSON.stringify(r).includes('site-'), `${qui} : aucun nom de site`); }
  }
  // Le petit chiffre : combien répondent, sur combien.
  assert.deepEqual(await etat(W('sites_petit'), LUI, src), { etat: 'ok', at: MAINT - 60_000, donnee: { enLigne: 2, total: 4, panne: 1 } });
});

test('aucun site vérifié : pas de chiffre ; une veille arrêtée : « ancien », avec l\'heure de sa dernière vérification', async () => {
  const neuf = fausse({ sites: [site('site-a.test'), site('site-b.test')] });
  assert.deepEqual(await etat(W('sites_petit'), LUI, neuf), { etat: 'vide', raison: 'sites_pas_verifies' });
  const g = await etat(W('sites'), LUI, neuf);
  assert.deepEqual([g.etat, (g.donnee as { sites: Array<{ etat: string }> }).sites.map((x) => x.etat)], ['ok', ['inconnu', 'inconnu']], 'à vérifier, sans chiffre inventé');
  // Aucun site vérifié : la donnée le dit (verifies 0) ; la page n'écrit alors pas « vérifié il y a … » (essai de la page).
  assert.equal((g.donnee as { verifies: number }).verifies, 0);
  const vieux = MAINT - 3_600_000, arrete = fausse({ sites: [site('site-a.test', { enLigne: true, ms: 100, verifieA: vieux })] });
  for (const k of ['sites', 'sites_petit']) { const r = await etat(W(k), LUI, arrete); assert.deepEqual([r.etat, r.at, (r as { motif?: string }).motif], ['ancien', vieux, 'veille_arretee'], k); }
  // Vérifié toutes les heures : une lecture d'il y a une heure n'est pas ancienne.
  assert.equal((await etat(W('sites'), LUI, fausse({ sites: [site('site-a.test', { enLigne: true, ms: 100, verifieA: vieux, toutesLes: 60 })] }))).etat, 'ok');
});

test('la liste des alertes : zéro → calme ; les plus récentes d\'abord ; vie privée pour un membre ; ouverte : ses applis, sans identifiant ; jamais une tablette', async () => {
  assert.deepEqual(await etat(W('alertes_liste'), LUI, fausse()), { etat: 'vide', raison: 'aucune_alerte' });
  const alertes = [
    { id: 'a1', appli: 'midgard', titre: 'Essai A', niveau: 'haute', at: 1000 },
    { id: 'a2', appli: 'vordr', titre: 'Essai B', niveau: 'info', at: 3000 },
    { id: 'a3', appli: 'midgard', titre: 'Essai C', niveau: 'moyenne', at: 2000 },
  ], src = fausse({ alertes });
  const e = await etat(W('alertes_liste'), LUI, src), d = e.donnee as { alertes: Array<Record<string, unknown>>; total: number; agir: boolean };
  assert.deepEqual(d.alertes.map((a) => a.id), ['a2', 'a3', 'a1'], 'les plus récentes d\'abord');
  assert.deepEqual(d.alertes[0], { id: 'a2', appli: 'vordr', nomAppli: 'Nom vordr', titre: 'Essai B', niveau: 'info', at: 3000 });
  assert.deepEqual([d.total, d.agir], [3, true]);
  // Les comptes par gravité de la maquette (sa barre et « 1 grave · 1 à surveiller »), sur toutes les alertes à voir.
  const parGravite = (x: unknown) => { const o = x as { graves?: number; aSurveiller?: number }; return [o.graves, o.aSurveiller]; };
  assert.deepEqual(parGravite(d), [1, 1]);
  const w = W('alertes_liste');
  assert.deepEqual(await etat(w, membre(['forseti', 'midgard']), src), { etat: 'refuse', raison: 'vie_privee', appli: 'forseti' });
  const ouvert = await etat(w, membre(['forseti', 'midgard'], [cleOuverture(w, 'forseti')]), src), od = ouvert.donnee as { alertes: Array<Record<string, unknown>>; total: number; agir: boolean };
  assert.deepEqual(od.alertes.map((a) => a.titre), ['Essai C', 'Essai A'], 'ses applis seulement');
  assert.ok(od.alertes.every((a) => !('id' in a)), 'sans identifiant (« vu » reste au propriétaire)'); assert.deepEqual([od.total, od.agir], [2, false]);
  assert.deepEqual(parGravite(od), [1, 1], 'ses applis seulement, dans les comptes aussi');
  assert.equal((await etat(w, TABLETTE, src)).etat, 'refuse');
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare au registre (trois sortes, tailles de la maquette) ; la grille connaît leurs tailles', () => {
  const win: Record<string, any> = {};
  for (const src of [VEILLE, RENDU, GRILLE]) vm.runInNewContext(src, { window: win });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  const vus = ['alertes_liste', 'sites', 'sites_petit'].map((k) => R.rendu(k));
  assert.deepEqual(ici(vus.map((x: any) => [x?.sorte, x?.appli, x?.petit, x?.vides])), [['alertes_liste', 'forseti', false, ['aucune_alerte']], ['sites', 'idunn', false, ['aucun_site']], ['sites_petit', 'idunn', true, ['aucun_site', 'sites_pas_verifies']]]);
  assert.deepEqual(ici(vus.map((x: any) => [x.w.c, x.w.r])), [[4, 3], [4, 5], [2, 1]]);
  // Le tiroir : au propriétaire, les trois ; à un membre, seulement celles dont il a l'appli.
  assert.deepEqual(ici(R.posables({ proprio: true, aDroit: () => true }).filter((x: any) => x.famille === 'veille').map((x: any) => x.nom)), ['Alertes et erreurs', 'Sites web', 'Sites en ligne']);
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: (a: string) => a === 'forseti' }).filter((x: any) => x.famille === 'veille').map((x: any) => x.sorte)), ['alertes_liste']);
  for (const k of ['alertes_liste', 'sites', 'sites_petit']) assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  // Ses calculs : le nombre de sites montrés selon la hauteur.
  assert.deepEqual(ici([2, 3, 5, 7].map(win.OdinWidgetsVeille.combienDeSites)), [1, 2, 4, 6]);
  // Le sous-titre « vérifié il y a … » : seulement si au moins un site a été vérifié (jamais l'heure de la lecture).
  const sous = vus[1].sous as (e: unknown) => string;
  assert.equal(sous({ etat: 'ok', at: Date.now(), donnee: { sites: [{ nom: 'site-a.test', etat: 'inconnu' }], verifies: 0 } }), '', 'aucun site vérifié : rien d\'affirmé');
  assert.match(sous({ etat: 'ok', at: Date.now() - 60_000, donnee: { sites: [{ nom: 'site-a.test', etat: 'ok' }], verifies: 1 } }), /\S/, 'vérifié : le sous-titre');
  // Les alertes montrées tiennent dans la hauteur (la maquette : une de moins que la hauteur en lignes, une au moins).
  assert.deepEqual(ici([1, 2, 3, 5].map(win.OdinWidgetsVeille.combienDAlertes)), [1, 1, 2, 4]);
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...VEILLE.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, sansDroit = '', cleMaison = '';
const MDP = 'une-voile-sur-le-lagon-bleu';
const IDS = ['gladsheim', 'idunn', 'forseti', 'var', 'midgard'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b5e00001', ID = { sites: 'c5e00001', petit: 'c5e00002', alertes: 'c5e00003', sitesOk: 'c5e00004', sitesVides: 'c5e00005', compte: 'c5e00006' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Veille', widgets: [
  { id: ID.petit, kind: 'sites_petit', w: 1, c: 2, r: 1, pr: 1 }, { id: ID.compte, kind: 'alertes', w: 1, c: 2, r: 1, pr: 1 },
  { id: ID.sites, kind: 'sites', w: 1, c: 4, r: 5 }, { id: ID.alertes, kind: 'alertes_liste', w: 1, c: 4, r: 3 },
  { id: ID.sitesOk, kind: 'sites', w: 1, c: 4, r: 3 }, { id: ID.sitesVides, kind: 'sites', w: 1, c: 4, r: 3 },
] }] });
// Un nom piégé : du HTML, et un texte très long sans espace.
const PIEGE = `<img src=x onerror="window.__piege=1">${'x'.repeat(150)}.test`;
const idunn = () => valhallaOf()!.ctx('idunn');
const poserSites = () => {
  const vu = new Date(Date.now() - 60_000).toISOString();
  idunn().saveSettings({
    sites: [{ name: 'site-a.test', url: 'https://site-a.test', pages: [], vercel: 'projet-a' }, { name: PIEGE, url: 'https://site-b.test', pages: [] }],
    state: { 'site-a.test': { up: true, status: 200, ms: 120, checkedAt: vu }, [PIEGE]: { up: false, status: 502, checkedAt: vu, fails: 2 } },
  });
};
const toutVoir = () => { const va = valhallaOf()!; va.ack(va.alerts({ limit: 5000 }).map((a) => a.id)); };
const leverAlertes = () => { const va = valhallaOf()!, n = Date.now().toString(36); return [va.alert('midgard', { level: 'haute', title: 'Essai A', key: `a-${n}` }), va.alert('midgard', { level: 'info', title: 'Essai B', key: `b-${n}` }), va.alert('idunn', { level: 'moyenne', title: '<b>Essai C</b>', key: `c-${n}` })].map((a) => a!.id); };
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin, sans le droit sur Arachné.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-s', nom: 'Membre S', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'forseti']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-s' })).ok, true);
  lierProprietaire(persona()!);
  sansDroit = await entrer('membre-s', MDP); assert.ok(sansDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : zéro site → « vide » ; puis les sites d\'Arachné, la panne d\'abord ; le membre sans droit n\'en voit aucun nom', async () => {
  idunn().saveSettings({ sites: [], state: {} });
  let d = await donnees();
  assert.equal(d.status, 200);
  for (const id of [ID.sites, ID.petit]) assert.deepEqual([d.de(id)!.etat, d.de(id)!.raison], ['vide', 'aucun_site'], id);
  poserSites();
  d = await donnees();
  const s = d.de(ID.sites)!, sd = s.donnee as { sites: Array<Record<string, unknown>>; agir: boolean };
  assert.equal(s.etat, 'ok'); assert.deepEqual(sd.sites.map((x) => [x.nom, x.etat, x.relancer ?? false]), [[PIEGE, 'panne', false], ['site-a.test', 'ok', true]]);
  assert.equal(sd.sites[1].ms, 120); assert.equal(sd.agir, true);
  assert.ok(!d.corps.includes('https://site-'), 'jamais l\'adresse d\'un site');
  assert.deepEqual(d.de(ID.petit)!.donnee, { enLigne: 1, total: 2, panne: 1 });
  const m = await donnees({ cookie: sansDroit });
  assert.equal(m.status, 200);
  for (const id of [ID.sites, ID.petit]) assert.deepEqual([m.de(id)!.etat, m.de(id)!.raison, m.de(id)!.appli], ['refuse', 'appli_fermee', 'idunn'], id);
  assert.ok(!m.corps.includes('site-a.test') && !m.corps.includes('onerror'), 'aucun nom de site pour le membre sans droit');
});

test('vrai Odin : « Relancer » passe par l\'action d\'Arachné ; un membre sans droit et une tablette sont refusés par le serveur', async () => {
  poserSites();
  const corps = { module: 'idunn', action: 'relancer', input: { site: 'site-a.test' } };
  // Le propriétaire : l'action d'Arachné répond elle-même (sans jeton Vercel, elle ne peut rien relancer, et le dit).
  const lui = await v.json('/api/valhalla/act', corps);
  assert.equal(lui.status, 200); assert.equal(lui.body.code, undefined, 'ni refusée, ni réservée'); assert.equal(typeof lui.body.text, 'string');
  const m = await v.json('/api/valhalla/act', corps, { cookie: sansDroit });
  assert.equal(m.status, 403); assert.equal(m.body.code, 'refuse', 'un membre sans le droit sur Arachné');
  const t = await v.json('/api/valhalla/act', corps, { cookie: '', 'x-odin-maison': cleMaison });
  assert.ok([401, 403].includes(t.status), `une tablette « maison » (${t.status})`);
  assert.equal(t.body.text, undefined, 'rien d\'Arachné ne lui est rendu');
});

test('vrai Odin : « Vu » fait baisser le compte, dans la liste et dans le petit chiffre ; une alerte vue ne revient pas', async () => {
  toutVoir();
  assert.deepEqual([(await donnees()).de(ID.alertes)!.etat, (await donnees()).de(ID.alertes)!.raison], ['vide', 'aucune_alerte'], 'zéro : un état calme');
  const ids = leverAlertes();
  let d = await donnees();
  const l = d.de(ID.alertes)!.donnee as { alertes: Array<{ id: string; titre: string; nomAppli: string }>; total: number };
  assert.equal(l.total, 3); assert.deepEqual(new Set(l.alertes.map((a) => a.id)), new Set(ids));
  assert.ok(l.alertes.every((a) => a.nomAppli && !a.nomAppli.includes('<')), 'le nom de l\'appli');
  assert.deepEqual(d.de(ID.compte)!.donnee, { nombre: 3 });
  assert.equal((await v.json('/api/valhalla/ack', { ids: [ids[0]] })).body.ok, true);
  d = await donnees();
  assert.equal((d.de(ID.alertes)!.donnee as { total: number }).total, 2); assert.deepEqual(d.de(ID.compte)!.donnee, { nombre: 2 });
  assert.ok(!(d.de(ID.alertes)!.donnee as { alertes: Array<{ id: string }> }).alertes.some((a) => a.id === ids[0]), 'vue : elle ne revient pas');
  // Le membre (droit sur l'appli des alertes) : vie privée, fermé.
  assert.deepEqual([(await donnees({ cookie: sansDroit })).de(ID.alertes)!.raison], ['vie_privee']);
  toutVoir();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any;
interface Route { request(): { postDataJSON(): any }; fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; continue(): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: Error) => void): void; waitForTimeout(ms: number): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** L'accueil sur la page d'essai ; « Sites web » tout en ligne et sans site : leurs états forcés (le reste vient du serveur). */
async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500, envois: any[] = [];
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    const ok = { etat: 'ok', at: Date.now() - 60_000, donnee: { sites: [{ nom: 'site-a.test', etat: 'ok', ms: 120 }, { nom: 'site-c.test', etat: 'lent', ms: 5200 }], total: 2, enLigne: 2, panne: 0, lents: 1, agir: true } };
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.id === ID.sitesOk ? { id: w.id, kind: w.kind, page: w.page, ...ok } : w.id === ID.sitesVides ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucun_site' } : w));
    await r.fulfill({ response: rep, json: j });
  });
  // « Relancer » : ce que la page envoie est noté ; la réponse est celle d'une action réussie (aucun site réel ici).
  await p.route(/\/api\/valhalla\/act$/, async (r) => { const b = r.request().postDataJSON(); if (b?.module !== 'idunn') { await r.continue(); return; } envois.push(b); await r.fulfill({ json: { ok: true, text: 'Relance en cours.' } }); });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.sites}"] .wv-sites`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, document.querySelector('#fenetre')?.textContent?.slice(0, 300) ?? 'pas de fenêtre', ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs, envois };
}
/** Ce que la page montre de chaque carte. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  const sonde = document.createElement('i'); document.body.append(sonde); sonde.style.color = 'color-mix(in srgb, var(--bad) 70%, transparent)'; out.bad = getComputedStyle(sonde).color; sonde.remove();
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1); };
    out[nom] = {
      bord: getComputedStyle(c).borderTopColor, panne: Boolean(c.querySelector('.wv-panne')), texte: txt(c), noms: [...c.querySelectorAll('.wv-nom b')].map(txt),
      ajouter: txt(c.querySelector('.wv-calme ~ .wv-btn')), dedans: [...c.querySelectorAll('*')].every(dans), petits: [...c.querySelectorAll('button')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map(txt),
      lignes: c.querySelectorAll('.wv-al').length, compte: txt(c.querySelector('.wv-compte b')), valeur: txt(c.querySelector('.wv-v')),
      haut: Math.round(b.height), plus: txt(c.querySelector('.wv-plus')), sev: c.querySelectorAll('.wv-sev > i').length,
      ageDabord: [...c.querySelectorAll('.wv-al-t small')].every((s: any) => s.firstElementChild?.tagName === 'TIME'),
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : bord rouge seulement sur une panne, nom piégé en texte, « Ajouter un site », « Relancer » et « Vu »`, { skip: sansNav }, async () => {
    poserSites(); toutVoir(); const ids = leverAlertes();
    const { ctx, page: p, erreurs, envois } = await ouvrir(largeur, sombre);
    try {
      await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.alertes}"] .wv-al`, { timeout: 30000 });
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.piege, false, 'le nom piégé n\'est jamais du code');
      assert.equal(a.sites.panne, true); assert.equal(a.sites.bord, a.bad, 'un site en panne : le bord rouge (la couleur d\'alarme du thème)');
      assert.equal(a.sitesOk.panne, false); assert.notEqual(a.sitesOk.bord, a.sites.bord, 'tout répond : pas de bord rouge');
      assert.equal(a.sites.noms[0], PIEGE, 'le nom piégé, tel quel, en texte'); assert.equal(a.sites.dedans, true, 'le nom très long reste dans sa carte');
      assert.match(a.sitesVides.texte, /Aucun site surveillé/); assert.equal(a.sitesVides.ajouter, 'Ajouter un site');
      assert.equal(a.petit.valeur, '1 / 2');
      // 3 alertes dans 3 lignes de grille : 2 montrées et « et 1 de plus » ; la barre de gravité ; l'âge en tête de ligne.
      assert.equal(a.alertes.lignes, 2); assert.equal(a.alertes.compte, '3'); assert.equal(a.alertes.dedans, true); assert.match(a.alertes.plus, /1/);
      assert.equal(a.alertes.sev, 3, 'la barre de gravité, trois parts'); assert.equal(a.alertes.ageDabord, true, 'l\'âge en tête de chaque ligne');
      if (largeur > 700) {
        // Ordinateur : chaque carte garde la hauteur de ses lignes ; la liste ne l'étire pas, ni sa voisine.
        assert.ok(Math.abs(a.alertes.haut - 250) <= 2, `alertes : ${a.alertes.haut} px pour 3 lignes`);
        assert.ok(Math.abs(a.sites.haut - 426) <= 2, `sites : ${a.sites.haut} px pour 5 lignes`);
      }
      for (const k of ['sites', 'sitesOk', 'sitesVides', 'alertes']) assert.deepEqual(a[k].petits, [], `${k} : des cibles de 44 px`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/veille-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // « Relancer » : choisir le site, puis le bouton ; la page envoie l'action d'Arachné, pour CE site.
      await p.click(`#feGrid .fe-w[data-id="${ID.sites}"] .wv-site.wv-ok`);
      if (largeur > 700) assert.ok(Math.abs((await vu(p)).sites.haut - a.sites.haut) <= 1, 'ouvrir les actions d\'un site ne fait pas grandir la carte');
      await p.click(`#feGrid .fe-w[data-id="${ID.sites}"] .wv-actions button[data-action="relancer"]`);
      await p.waitForFunction((s: string) => document.querySelector(s)?.textContent === 'Relance en cours.', `#feGrid .fe-w[data-id="${ID.sites}"] .wv-dit`, { timeout: 10000 });
      assert.deepEqual(envois, [{ module: 'idunn', action: 'relancer', input: { site: 'site-a.test' } }]);
      // Le site piégé n'est pas relié à Vercel : pas de « Relancer ».
      await p.click(`#feGrid .fe-w[data-id="${ID.sites}"] .wv-site.wv-panne`);
      assert.deepEqual(await p.evaluate((s: string) => [...document.querySelectorAll(s)].map((b: any) => b.dataset.action), `#feGrid .fe-w[data-id="${ID.sites}"] .wv-actions button`), ['etat', 'tester']);
      // « Vu » : la ligne part, le compte baisse, et le serveur ne la rend plus.
      await p.click(`#feGrid .fe-w[data-id="${ID.alertes}"] .wv-al .wv-btn`);
      await p.waitForFunction((s: string) => document.querySelector(s)?.textContent === '2', `#feGrid .fe-w[data-id="${ID.alertes}"] .wv-compte b`, { timeout: 10000 });
      const apres = (await vu(p)).alertes;
      assert.deepEqual([apres.compte, apres.lignes, apres.plus], ['2', 2, ''], 'la suivante prend la place ; plus rien en réserve');
      assert.equal(((await donnees()).de(ID.alertes)!.donnee as { total: number }).total, 2);
      // « Ajouter un site » ouvre Arachné.
      await p.click(`#feGrid .fe-w[data-id="${ID.sitesVides}"] .wv-btn`);
      assert.equal(await p.evaluate(() => location.hash), '#app=idunn');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
      void ids;
    } finally { await ctx.close(); toutVoir(); }
  });
}
