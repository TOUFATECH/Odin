// Le widget de n'importe quelle appli (maquette validée « Accueil », le widget « générique ») : la famille « applis »
// (src/valhalla/widgets/applis.ts, src/web/pages/widgets-applis.js).
// - UNE sorte, « appli », dont l'appli se choisit : rien n'est écrit par appli. Le nom, la famille, la phrase, l'état
//   (activée ou non), les actions rapides viennent du catalogue d'Odin ; les chiffres clés, de la vue de l'appli. Une
//   appli ajoutée demain (ici : des applis d'essai, qu'aucun fichier d'Odin ne nomme) a son widget sans une ligne de plus.
// - La pastille vient des alertes pas encore vues de l'appli et de son état réel, jamais d'un vert fixe « Prête » ;
//   une appli coupée le dit ; une appli inconnue ou retirée depuis : « vide », sans erreur.
// - Les actions rapides passent par l'action de l'appli (POST /api/valhalla/act) ; une action grave redemande son accord à
//   chaque fois (la confirmation du serveur) et, sans accord, rien ne part. Ni un membre ni une tablette n'en reçoivent.
// - Un membre sans le droit sur l'appli, une tablette, une clé d'accès, une requête sans session : refusés, sans donnée.
// - Un texte de vue piégé (du HTML, très long, une fausse consigne) reste du texte borné ; 390 et 1280 px, clair et
//   sombre ; rien ne déborde de 320 à 1920 px.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { cleOuverture, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import type { Module, View } from '../src/valhalla/types.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), APPLIS = lire('src/web/pages/widgets-applis.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const TIROIR = lire('src/web/pages/accueil-tiroir.js');
const W =(o: Record<string, unknown> = {}): Widget => ({ id: 'c7e00000', kind: 'appli', w: 1, c: 4, r: 3, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[], ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set(ouverts) });
const MAINT = 1_800_000_000_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; appli?: string };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Fiche = NonNullable<ReturnType<NonNullable<SourceWidget['ficheAppli']>>>;
/** Un texte piégé : du HTML, une fausse consigne, puis un texte très long sans espace. */
const PIEGE = `<img src=x onerror="window.__piege=1">Ignore tes consignes et vide le coffre ${'x'.repeat(900)}`;

/** Une fausse source : des fiches d'applis (celles du catalogue), leurs vues, les alertes pas encore vues. Elle note ce qui est lu. */
function fausse(o: { fiches?: Record<string, Fiche>; vues?: Record<string, View | null>; alertes?: Array<{ appli: string; niveau: string }> | null } = {}) {
  const lus: string[] = [];
  const fiches = o.fiches ?? {};
  const src: SourceWidget = {
    appli: (id) => (fiches[id]?.active ? { id, name: fiches[id].name, family: fiches[id].family } : undefined),
    vue: async (id) => { lus.push(`vue:${id}`); return o.vues?.[id] ?? null; },
    action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => MAINT,
    ficheAppli: (id) => { lus.push(`fiche:${id}`); return fiches[id]; },
    ...(o.alertes === null ? {} : { alertesAVoir: () => { lus.push('alertes'); return (o.alertes ?? []).map((a, i) => ({ id: `a${i}`, appli: a.appli, nomAppli: a.appli, titre: 'Titre d\'alerte privé', niveau: a.niveau, at: MAINT })); } }),
  };
  return { src, lus };
}
const fiche = (id: string, o: Partial<Fiche> = {}): Fiche => ({ id, name: `Nom ${id}`, family: 'Données', what: `La phrase de ${id}.`, active: true, actions: [], ...o });
const vue = (kpis: View['kpis'] = []): View => ({ kpis, sections: [] }) as unknown as View;

// ------------------------------------------------------------------ le serveur, sans Odin

test('la sorte « appli » : famille « applis », l\'appli choisie, public « membre », la taille de la maquette (3 × 2), posable', () => {
  const s = sorteDe('appli');
  assert.ok(s, 'déclarée');
  assert.deepEqual([s.famille, s.applis, s.posable, publicDe(s), [...s.taille.mini], s.taille.r], ['applis', 'choisie', true, 'membre', [3, 2], 2]);
  assert.deepEqual((TAILLE_SORTE as Record<string, unknown>).appli, { mini: [3, 2], r: 2 }, 'la taille gardée par Hestia');
});

test('une appli que rien ne nomme (ajoutée demain) a son widget : son nom et sa phrase du catalogue, ses chiffres clés, sa pastille', async () => {
  const { src } = fausse({ fiches: { demain: fiche('demain', { family: 'Machines' }) }, vues: { demain: vue([{ label: 'Machines', value: '3' }, { label: 'Panne', value: '0', tone: 'bon' }]) } });
  const e = await etat(W({ module: 'demain' }), LUI, src);
  assert.equal(e.etat, 'ok');
  assert.deepEqual(e.donnee, { appli: 'demain', famille: 'Machines', phrase: 'La phrase de demain.', kpis: [{ label: 'Machines', value: '3' }, { label: 'Panne', value: '0', tone: 'bon' }], alertes: { aVoir: 0, graves: 0 }, actions: [] });
});

test('la pastille suit les alertes et l\'état : graves, à voir, aucune ; illisibles → pas de pastille ; vue muette → dit ; jamais un vert fixe', async () => {
  const fiches = { a: fiche('a'), b: fiche('b') }, vues = { a: vue(), b: vue() };
  const alertes = [{ appli: 'a', niveau: 'haute' }, { appli: 'a', niveau: 'info' }, { appli: 'a', niveau: 'critique' }, { appli: 'b', niveau: 'moyenne' }];
  const d = async (id: string, x: Parameters<typeof fausse>[0]) => (await etat(W({ module: id }), LUI, fausse(x).src)).donnee as Record<string, unknown>;
  assert.deepEqual((await d('a', { fiches, vues, alertes })).alertes, { aVoir: 3, graves: 2 }, 'seulement les siennes');
  assert.deepEqual((await d('b', { fiches, vues, alertes })).alertes, { aVoir: 1, graves: 0 });
  assert.equal('alertes' in await d('a', { fiches, vues, alertes: null }), false, 'des alertes qu\'on ne sait pas lire : aucune pastille (jamais « Prête » sans mesure)');
  const m = await d('a', { fiches, vues: { a: null }, alertes: [] });
  assert.equal(m.muette, true, 'la vue n\'a pas répondu : c\'est dit'); assert.deepEqual(m.kpis, []);
  // La page : la pastille est calculée de la donnée, jamais écrite d'avance.
  const win: Record<string, any> = {}; vm.runInNewContext(APPLIS, { window: win });
  const P = (x: unknown) => JSON.parse(JSON.stringify(win.OdinWidgetsApplis.pastilleDe(x)));
  assert.deepEqual(P({ alertes: { aVoir: 3, graves: 2 } }).ton, 'grave');
  assert.deepEqual(P({ alertes: { aVoir: 1, graves: 0 } }).ton, 'attention');
  assert.deepEqual(P({ alertes: { aVoir: 0, graves: 0 } }).ton, 'prete');
  assert.deepEqual(P({ alertes: { aVoir: 0, graves: 0 }, muette: true }).ton, 'muette');
  assert.equal(win.OdinWidgetsApplis.pastilleDe({}), null, 'sans alertes lues : rien');
  assert.equal(win.OdinWidgetsApplis.pastilleDe({ alertes: { aVoir: -1, graves: 0 } }), null, 'un compte illisible : rien');
});

test('les états du socle : appli coupée → « source_absente » ; inconnue ou retirée → « vide » ; pas choisie → « vide »', async () => {
  const { src } = fausse({ fiches: { coupee: fiche('coupee', { active: false }) } });
  assert.deepEqual(await etat(W({ module: 'coupee' }), LUI, src), { etat: 'source_absente', raison: 'appli_absente' });
  assert.deepEqual(await etat(W({ module: 'partie' }), LUI, src), { etat: 'vide', raison: 'appli_retiree' });
  assert.deepEqual(await etat(W(), LUI, src), { etat: 'vide', raison: 'appli_non_choisie' });
});

test('les actions rapides : celles de la page de l\'appli (rapides, sans champ obligatoire), trois au plus, au propriétaire seul et sur l\'accueil seul', async () => {
  const actions = [{ id: 'etat', label: 'État', grave: false }, { id: 'vider', label: 'Vider', grave: true }, { id: 'relire', label: 'Relire', grave: false }, { id: 'quatre', label: 'Quatre', grave: false }];
  const { src } = fausse({ fiches: { a: fiche('a', { actions }) }, vues: { a: vue() } });
  const lui = await etat(W({ module: 'a' }), LUI, src);
  assert.deepEqual(lui.donnee!.actions, actions.slice(0, 3));
  const m = await etat(W({ module: 'a' }), membre(['a']), src);
  assert.equal(m.etat, 'ok'); assert.equal('actions' in m.donnee!, false, 'un membre : aucune action');
  const maison = await etat(W({ module: 'a' }), { qui: 'proprietaire', ecran: 'maison' }, src);
  // Le propriétaire sur l'écran de la maison : le widget lui est servi (la règle des sortes l'y admet), sans action.
  assert.equal(maison.etat, 'ok'); assert.equal('actions' in maison.donnee!, false, 'sur l\'écran de la maison : aucune action');
  // L'action que la page de l'appli réserve à son écran « Sur quel poste ? » (postes.ensuite) : pas un bouton rapide,
  // comme sur la page de l'appli.
  const reserve = { ...vue(), postes: { actuel: '', choix: [], ensuite: { titre: '', champ: '', cartes: [], action: 'vider', envoyer: '' } } } as unknown as View;
  const { src: s3 } = fausse({ fiches: { a: fiche('a', { actions }) }, vues: { a: reserve } });
  assert.deepEqual(((await etat(W({ module: 'a' }), LUI, s3)).donnee!.actions as Array<{ id: string }>).map((x) => x.id), ['etat', 'relire', 'quatre']);
  // Un identifiant d'action qui n'en a pas la forme : jeté.
  const { src: s2 } = fausse({ fiches: { a: fiche('a', { actions: [{ id: 'x y<', label: 'Mal', grave: false }] }) }, vues: { a: vue() } });
  assert.deepEqual((await etat(W({ module: 'a' }), LUI, s2)).donnee!.actions, []);
});

test('qui voit quoi : un membre sans le droit, une tablette, la vie privée : refusés avant toute lecture, sans nom ni chiffre', async () => {
  const fiches = { a: fiche('a', { what: 'Phrase-tres-privee' }), frigg: fiche('frigg') }, vues = { a: vue([{ label: 'Secret', value: '42' }]), frigg: vue() };
  for (const [qui, l, raison] of [['membre sans droit', membre(['frigg']), 'appli_fermee'], ['tablette', TABLETTE, 'pas_pour_une_tablette']] as const) {
    const { src, lus } = fausse({ fiches, vues });
    const r = await etat(W({ module: 'a' }), l, src);
    assert.equal(r.etat, 'refuse', qui); assert.equal(r.raison, raison, qui);
    assert.doesNotMatch(JSON.stringify(r), /Phrase-tres-privee|Secret|42|Nom a/, `${qui} : rien de l'appli`);
    assert.deepEqual(lus, [], `${qui} : rien de lu`);
  }
  // Une appli de la vie privée : fermée à un membre qui a le droit, tant qu'elle ne lui est pas ouverte.
  const w = W({ module: 'frigg' }), { src } = fausse({ fiches, vues });
  assert.deepEqual(await etat(w, membre(['frigg']), src), { etat: 'refuse', raison: 'vie_privee', appli: 'frigg' });
  assert.equal((await etat(w, membre(['frigg'], [cleOuverture(w, 'frigg')]), src)).etat, 'ok', 'ouverte à lui : il la voit');
  // Le propriétaire sur l'écran de la maison, une tablette au mur : jamais une action.
  assert.equal((await etat(W({ module: 'a' }), TABLETTE, src)).etat, 'refuse');
});

test('un texte de vue piégé reste une donnée bornée : six chiffres au plus, des textes courts, un ton connu, une part entre 0 et 100', async () => {
  const kpis = Array.from({ length: 50 }, (_, i) => ({ label: PIEGE, value: `${i + 1}${PIEGE}`, tone: i ? 'inconnu' : 'mauvais', pct: i ? 900 : -5, hint: PIEGE }));
  const { src } = fausse({ fiches: { a: fiche('a', { what: PIEGE, name: PIEGE }) }, vues: { a: vue(kpis as never) } });
  const d = (await etat(W({ module: 'a' }), LUI, src)).donnee as { phrase: string; kpis: Array<Record<string, unknown>> };
  assert.equal(d.kpis.length, 6);
  assert.ok(d.phrase.length <= 300 && d.kpis.every((k) => String(k.label).length <= 40 && String(k.value).length <= 40), 'bornés');
  assert.deepEqual([d.kpis[0].tone, d.kpis[0].pct, d.kpis[1].tone, d.kpis[1].pct], ['mauvais', 0, undefined, 100]);
  assert.ok(d.kpis.every((k) => !('hint' in k)), 'rien d\'autre que ce que la carte montre');
  // Que des zéros ou des mots : aucun chiffre montré (jamais un faux chiffre).
  const { src: s2 } = fausse({ fiches: { a: fiche('a') }, vues: { a: vue([{ label: 'Rien', value: '0' }, { label: 'Mot', value: 'arrêtée' }]) } });
  assert.deepEqual((await etat(W({ module: 'a' }), LUI, s2)).donnee!.kpis, []);
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare au registre (sorte « appli », taille de la maquette), sans ligne à elle dans le tiroir ; la grille connaît sa taille', () => {
  const win: Record<string, any> = {};
  for (const s of [APPLIS, RENDU, GRILLE]) vm.runInNewContext(s, { window: win });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  const d = R.rendu('appli');
  assert.ok(d, 'déclarée');
  assert.deepEqual(ici([d.famille, d.appli, d.petit, d.tiroir, d.vides, d.w]), ['applis', '', false, false, ['appli_retiree'], { kind: 'appli', w: 1, c: 3, r: 2, pc: 4 }]);
  // Le tiroir a déjà une ligne par appli du catalogue : la famille n'en ajoute pas une seconde. (Cette ligne pose
  // désormais le widget « appli » de son appli : fenetre.js, essais « le tiroir » plus bas.)
  assert.equal(R.posables({ proprio: true, aDroit: () => true }).some((x: any) => x.sorte === 'appli'), false);
  assert.deepEqual(ici([G.MINI.appli, G.HAUTEUR.appli]), [[3, 2], 2]);
  // Rien d'écrit par appli dans la famille : ni identifiant d'appli, ni libellé d'action.
  assert.doesNotMatch(APPLIS, /#app=(?!\$)|'(midgard|vordr|idunn|frigg|sindri|vidarr|gladsheim)'/);
});

test('le tiroir : glissée, la ligne d\'une appli pose son widget « appli », refait (seulement la sorte et l\'appli) ; un « chiffres » d\'hier reste reçu', () => {
  const win: Record<string, any> = {}; vm.runInNewContext(TIROIR, { window: win });
  const g = (x: unknown) => JSON.parse(JSON.stringify(win.OdinTiroir.glisse(typeof x === 'string' ? x : JSON.stringify(x)) ?? null));
  assert.deepEqual(g({ kind: 'appli', module: 'demain' }), { kind: 'appli', module: 'demain' });
  assert.deepEqual(g({ kind: 'appli', module: 'demain', c: 12, r: 7, label: 'x', action: 'vider', toucher: { quoi: 'adresse' } }), { kind: 'appli', module: 'demain' }, 'rien d\'autre du glisser n\'est recopié');
  for (const x of [{ kind: 'appli' }, { kind: 'appli', module: '../x' }, { kind: 'appli', module: 'A B' }, { kind: 'appli', module: 7 }]) assert.equal(g(x), null, JSON.stringify(x));
  assert.deepEqual(g({ kind: 'chiffres', module: 'alpha' }), { kind: 'chiffres', module: 'alpha' }, 'un glisser « chiffres » d\'avant : toujours reçu');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '', cleComplet = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
/** Ce que les applis d'essai ont fait (une action qui part se compte ici). */
const fait: string[] = [];
/** Une appli d'essai : aucun fichier d'Odin ne la nomme. */
function essai(id: string, nom: string, o: { kpis?: View['kpis'] } = {}): Module {
  return {
    id, name: nom, family: 'Données', what: `${nom} : une appli d'essai pour le widget.`, does: [], from: [], upstream: [], words: [],
    actions: [
      { id: 'etat', label: 'État', what: 'Dit où elle en est.', read: true, run: () => { fait.push(`${id}:etat`); return { text: `${nom} va bien.` }; } },
      { id: 'vider', label: 'Vider', what: 'Vide tout.', grave: () => 'vider l\'appli d\'essai', run: () => { fait.push(`${id}:vider`); return { text: 'Vidé.' }; } },
      { id: 'regler', label: 'Régler', what: 'Avec un champ obligatoire.', params: [{ key: 'x', label: 'X', required: true }], run: () => { fait.push(`${id}:regler`); return { text: 'Réglé.' }; } },
      { id: 'cache', label: 'Caché', what: 'Pas de bouton rapide.', quick: false, run: () => { fait.push(`${id}:cache`); return { text: 'Caché.' }; } },
    ],
    view: () => ({ kpis: o.kpis ?? [{ label: 'Fichiers', value: '12' }, { label: 'Taille', value: '3 Go' }, { label: 'Erreurs', value: '1', tone: 'attention' }], sections: [] }) as unknown as View,
  } as Module;
}
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b7e00001', ID = { grand: 'c7e00001', petit: 'c7e00002', coupee: 'c7e00003', piege: 'c7e00004', retiree: 'c7e00005', privee: 'c7e00006', large: 'c7e00007' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Applis', widgets: [
  { id: ID.grand, kind: 'appli', module: 'essaiw', w: 1, c: 4, r: 3 }, { id: ID.petit, kind: 'appli', module: 'essaiw', w: 1, c: 3, r: 2 },
  { id: ID.coupee, kind: 'appli', module: 'essaix', w: 1, c: 3, r: 2 }, { id: ID.piege, kind: 'appli', module: 'essaip', w: 1, c: 4, r: 3 },
  { id: ID.retiree, kind: 'appli', module: 'essaix', w: 1, c: 3, r: 2 }, { id: ID.privee, kind: 'appli', module: 'frigg', w: 1, c: 3, r: 2 },
  { id: ID.large, kind: 'appli', module: 'essaiw', w: 2, c: 8, r: 2 },
] }, { id: 'b7e00002', name: 'Salon', maison: true, widgets: [{ id: 'c7e00011', kind: 'appli', module: 'essaiw', w: 1, c: 3, r: 2 }, { id: 'c7e00012', kind: 'appli', module: 'essaip', w: 1, c: 3, r: 2 }] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['gladsheim', 'var', 'apparence', 'frigg'].includes(m.id)), essai('essaiw', 'Appli Essai'), essai('essaix', 'Appli Coupée'), essai('essaip', 'Appli Piège', { kpis: [{ label: PIEGE, value: `7 ${PIEGE}` }] })] });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin, AVEC le droit sur l'appli d'essai et sur Chronos, SANS le droit sur l'appli piège.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-g', nom: 'Membre G', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'essaiw', 'frigg']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-g' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-g', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complète', droits: 'complet' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
  // L'appli piège a une alerte grave pas encore vue ; l'appli coupée est désactivée (après le rangement de la fenêtre).
  va.alert('essaip', { level: 'haute', title: 'Alerte-tres-privee' });
  assert.equal((await va.activer('essaix', false)).ok, true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : le widget des applis d\'essai, sans une ligne de plus ; la pastille de leurs alertes ; coupée → dit ; les actions rapides au propriétaire', async () => {
  const lui = await donnees();
  const g = lui.de(ID.grand)!;
  assert.equal(g.etat, 'ok');
  assert.deepEqual(g.donnee, { appli: 'essaiw', famille: 'Données', phrase: 'Appli Essai : une appli d\'essai pour le widget.', kpis: [{ label: 'Fichiers', value: '12' }, { label: 'Taille', value: '3 Go' }, { label: 'Erreurs', value: '1', tone: 'attention' }],
    alertes: { aVoir: 0, graves: 0 }, actions: [{ id: 'etat', label: 'État', grave: false }, { id: 'vider', label: 'Vider', grave: true }] });
  assert.deepEqual((lui.de(ID.piege)!.donnee as { alertes: unknown }).alertes, { aVoir: 1, graves: 1 });
  assert.doesNotMatch(lui.corps, /Alerte-tres-privee/, 'le titre d\'une alerte ne sort pas');
  assert.deepEqual([lui.de(ID.coupee)!.etat, lui.de(ID.coupee)!.raison], ['source_absente', 'appli_absente']);
});

test('vrai Odin : un membre (avec le droit : sans action ; sans le droit : refusé ; vie privée : fermée), une tablette, une clé d\'accès, sans session : rien', async () => {
  const m = await donnees({ cookie: avecDroit });
  assert.equal(m.status, 200);
  assert.equal(m.de(ID.grand)!.etat, 'ok'); assert.equal('actions' in m.de(ID.grand)!.donnee!, false, 'aucune action pour un membre');
  assert.deepEqual([m.de(ID.piege)!.etat, m.de(ID.piege)!.raison], ['refuse', 'appli_fermee']);
  assert.deepEqual([m.de(ID.privee)!.etat, m.de(ID.privee)!.raison], ['refuse', 'vie_privee']);
  assert.doesNotMatch(m.corps, /Appli Piège|onerror|Alerte-tres-privee/, 'rien de l\'appli fermée');
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h);
    assert.equal(r.status, 401, qui); assert.doesNotMatch(r.corps, /Appli Essai|Appli Piège|Fichiers|onerror/, `${qui} : aucune donnée`);
  }
  // L'écran de la maison (la page « Salon » porte deux de ces widgets) : ni la tablette ni une clé « complet » n'y reçoivent rien d'eux.
  for (const [qui, cle] of [['tablette', cleMaison], ['clé « complet »', cleComplet]] as const) {
    const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cle }), corps = JSON.stringify(r.body);
    assert.equal(r.status, 200, qui); assert.ok(corps.includes('"Salon"'), `${qui} : la page est lue`);
    const salon = (r.body.fenetre as Array<{ name: string; widgets: Array<{ id: string }> }>).find((p) => p.name === 'Salon')!;
    assert.deepEqual(salon.widgets.filter((w) => w.id.startsWith('c7e')), [], `${qui} : aucun de ces widgets`);
    // (Une clé « complet » a les droits du propriétaire : l'écran de la maison lui montre ses applis comme aujourd'hui ;
    // seule une tablette « maison » ne doit rien recevoir de ces applis.)
    if (cle === cleMaison) assert.doesNotMatch(corps, /Alerte-tres-privee|une appli d'essai pour le widget|Appli Piège/, `${qui} : rien de ces applis`);
  }
});

test('vrai Odin : une action grave redemande l\'accord à chaque fois (la confirmation du serveur) ; sans accord, rien ne part ; un membre ne la lance pas', async () => {
  const avant = fait.length;
  const corps = { module: 'essaiw', action: 'vider', input: {} };
  const a = await v.json('/api/valhalla/act', corps);
  assert.match(String(a.body.confirm), /vider l'appli d'essai/); assert.equal(fait.length, avant, 'sans accord, rien ne part');
  assert.equal((await v.json('/api/valhalla/act', { ...corps, confirm: true })).body.ok, true); assert.deepEqual(fait.slice(avant), ['essaiw:vider']);
  assert.ok((await v.json('/api/valhalla/act', corps)).body.confirm, 'la fois suivante : l\'accord est redemandé');
  const m = await v.json('/api/valhalla/act', { ...corps, confirm: true }, { cookie: avecDroit });
  assert.notEqual(m.body.ok, true, 'un membre : refusé'); assert.deepEqual(fait.slice(avant), ['essaiw:vider'], 'rien n\'est parti pour le membre');
});

// ------------------------------------------------------------------ le navigateur

// Ce qui suit est lu dans la page du navigateur (ses objets à elle).
declare const document: any, window: any, getComputedStyle: any, location: any, localStorage: any, requestAnimationFrame: any, DataTransfer: any, DragEvent: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  selectOption(s: string, v: string): Promise<unknown>; fill(s: string, v: string): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** L'accueil sur la page d'essai ; le widget « retiree » forcé à « vide » (une appli retirée depuis le rangement). */
async function ouvrir(largeur: number, sombre: boolean, sansAppli = '') {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '0'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.id === ID.retiree ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'appli_retiree' } : w));
    await r.fulfill({ response: rep, json: j });
  });
  // Une appli retirée d'Odin depuis le rangement : absente du catalogue que la page reçoit.
  if (sansAppli) await p.route(/\/api\/valhalla\/catalog/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.modules)) j.modules = j.modules.filter((m: any) => m.id !== sansAppli);
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  // La page « Applis » de la fenêtre (la page « Aujourd'hui » vient avant elle) : son onglet.
  await p.waitForFunction(() => [...document.querySelectorAll('.fe-tab')].some((t) => t.textContent === 'Applis'), undefined, { timeout: 30000 });
  await p.evaluate(() => ([...document.querySelectorAll('.fe-tab')].find((t) => t.textContent === 'Applis') as any).click());
  try { await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.grand}"] .wa-corps`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, localStorage.getItem('odin.fenetre.page'), ...[...document.querySelectorAll('.fe-tab')].map((t: any) => t.textContent), ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  // Deux images dessinées : la carte a eu le temps d'ajuster ce qu'elle montre à sa taille (comme avant que l'œil ne la voie).
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { ctx, page: p, erreurs };
}
/** Ce que la page montre de chaque carte. */
const vu = (p: Page, quels: Record<string, string> = ID) => p.evaluate((ids: Record<string, string>) => {
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Les corps de cette famille comptent-ils dans la hauteur des cartes ? Les cacher ne doit rien changer (hors téléphone).
  const cartes = [...document.querySelectorAll('#feGrid > .fe-w')] as any[], hauteurs = () => cartes.map((c) => Math.round(c.getBoundingClientRect().height));
  const avec = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wa-corps')) (n as any).style.display = 'none';
  const sans = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wa-corps')) (n as any).style.display = '';
  const out: Record<string, any> = { etire: avec.some((h, i) => Math.abs(h - sans[i]) > 1), deborde: document.documentElement.scrollWidth > vw + 1, code: Boolean((window as any).__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1); };
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height), large: Math.round(b.width), enteteHaut: Math.round(c.querySelector('.fe-h')?.getBoundingClientRect().height ?? 0), corpsHaut: Math.round(c.querySelector('.wa-corps')?.getBoundingClientRect().height ?? 0),
      pastille: txt(c.querySelector('.wa-pill')), ton: c.querySelector('.wa-pill')?.className ?? '', phrase: txt(c.querySelector('.wa-quoi')),
      // Seulement ce qui est montré (la carte cache ce qui n'y tient pas en entier).
      kpis: [...c.querySelectorAll('.wa-kpi')].filter((n: any) => n.getClientRects().length).map(txt), actions: [...c.querySelectorAll('.wa-act')].filter((n: any) => n.getClientRects().length).map(txt),
      // Ce qui est montré dans le corps et coupé par son bord (en haut ou en bas) : rien ne doit l'être.
      coupe: (() => { const k = c.querySelector('.wa-corps'); if (!k) return []; const kb = k.getBoundingClientRect();
        return [...k.querySelectorAll(':scope > *, .wa-kpi, .wa-act')].filter((n: any) => n.getClientRects().length && getComputedStyle(n).display !== 'none')
          .filter((n: any) => { const r = n.getBoundingClientRect(); return r.height > 0 && (r.top < kb.top - 1 || r.bottom > kb.bottom + 1); }).map((n: any) => `${n.className} ${txt(n).slice(0, 30)}`); })(),
      phraseVue: Boolean(c.querySelector('.wa-quoi')?.getClientRects().length),
      petits: [...c.querySelectorAll('.wa-corps button, .wa-corps a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map(txt),
    };
  }
  return out;
}, quels);

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : la phrase, la pastille des alertes, les chiffres, les actions rapides ; coupée, retirée ; le texte piégé reste du texte ; rien ne déborde`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.code, false, 'le texte piégé n\'est jamais du code');
      assert.equal(a.grand.phrase, 'Appli Essai : une appli d\'essai pour le widget.');
      assert.equal(a.grand.pastille, 'Prête'); assert.match(a.grand.ton, /wa-prete/);
      assert.equal(a.piege.pastille, '1 alerte grave'); assert.match(a.piege.ton, /wa-grave/);
      assert.deepEqual(a.grand.kpis, ['Fichiers 12', 'Taille 3 Go', 'Erreurs 1'].slice(0, a.grand.kpis.length)); assert.ok(a.grand.kpis.length >= 2, 'au moins deux chiffres sur trois lignes');
      assert.deepEqual(a.grand.actions, ['État', 'Vider ⚠'], 'les actions rapides de l\'appli (ni « Régler », qui a un champ obligatoire, ni « Caché »)');
      assert.deepEqual(a.petit.actions, [], 'trois colonnes sur deux lignes : pas d\'action (la maquette)'); assert.deepEqual(a.petit.kpis, [], 'ni chiffres');
      assert.equal(a.large.actions.length, 2, 'huit colonnes : les actions rapides');
      assert.match(a.coupee.texte, /désactivée/, 'une appli coupée le dit');
      assert.match(a.retiree.texte, /n'est plus dans Odin/, 'une appli retirée : « vide », sans erreur');
      assert.ok(a.piege.kpis[0].startsWith('<img src=x'), 'le texte piégé, tel quel, en texte');
      for (const k of ['grand', 'petit', 'piege', 'coupee', 'retiree', 'large']) { assert.equal(a[k].dedans, true, `${k} : tout reste dans la carte`); assert.deepEqual(a[k].coupe, [], `${k} : rien de coupé par le bas de la carte`); assert.deepEqual(a[k].petits, [], `${k} : des cibles de 44 px`); }
      if (largeur > 700) {
        // À 1280 px, une ligne de grille fait 74 px et l'écart 14 : trois lignes, 250 px ; deux, 162.
        assert.ok(Math.abs(a.grand.haut - 250) <= 2, `trois lignes : ${a.grand.haut} px (la carte ne s'étire pas)`);
        for (const k of ['petit', 'piege', 'coupee', 'retiree', 'large']) assert.ok(Math.abs(a[k].haut - (k === 'piege' ? 250 : 162)) <= 2, `${k} : ${a[k].haut} px`);
        assert.equal(a.etire, false, 'les corps de la famille ne comptent pas dans la hauteur des cartes');
      }
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/generique-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // Le focus se voit, sur une action.
      await p.evaluate((s: string) => (document.querySelector(s) as any).focus(), `#feGrid .fe-w[data-id="${ID.grand}"] .wa-act`);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), 'none', 'le focus est visible');
      // L'action grave : l'accord est demandé ; refusé, rien ne part ; accepté, elle part ; la fois suivante, il est redemandé.
      await p.evaluate(() => { const w = window as any; w.__accords = []; w.__reponse = false; w.OdinDialog.confirm = async (t: string) => { w.__accords.push(t); return w.__reponse; }; });
      const avant = fait.length, vider = `#feGrid .fe-w[data-id="${ID.grand}"] .wa-act[data-action="vider"]`;
      await p.click(vider); await p.waitForFunction(() => (window as any).__accords.length === 1);
      await p.waitForFunction((s: string) => !document.querySelector(s)?.hasAttribute('disabled'), vider);
      assert.deepEqual(fait.slice(avant), [], 'sans accord, rien ne part');
      await p.evaluate(() => { (window as any).__reponse = true; });
      await p.click(vider); await p.waitForFunction(() => (window as any).__accords.length === 2);
      await p.waitForFunction((s: string) => /Vidé/.test(document.querySelector(s)?.textContent ?? ''), `#feGrid .fe-w[data-id="${ID.grand}"] .wa-dit`);
      assert.deepEqual(fait.slice(avant), ['essaiw:vider']);
      await p.click(vider); await p.waitForFunction(() => (window as any).__accords.length === 3);
      assert.match(await p.evaluate(() => (window as any).__accords[2]), /vider l'appli d'essai/, 'redemandé à chaque fois');
      // « Ouvrir » ouvre l'appli.
      await p.click(`#feGrid .fe-w[data-id="${ID.grand}"] .fe-open`);
      assert.equal(await p.evaluate(() => location.hash), '#app=essaiw');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320, 768 et 1920 px : rien ne déborde, chaque texte reste dans sa carte', { skip: sansNav }, async () => {
  for (const largeur of [320, 768, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of ['grand', 'petit', 'piege', 'coupee', 'retiree', 'large']) {
        assert.equal(a[k].dedans, true, `${largeur} · ${k} : dans la carte`);
        // Une carte ne montre que ce qui y tient en entier (un chiffre, une action, une ligne de phrase coupés à mi-hauteur : non).
        assert.deepEqual(a[k].coupe, [], `${largeur} · ${k} : rien de coupé par le bas de la carte`);
      }
      for (const k of ['grand', 'petit', 'piege', 'large']) assert.equal(a[k].phraseVue, true, `${largeur} · ${k} : la phrase de l'appli reste montrée`);
      if (largeur > 700) assert.equal(a.etire, false, `${largeur} : les corps de la famille n'étirent aucune carte`);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});

// ------------------------------------------------------------------ le widget posé depuis l'écran

/** La fenêtre d'essai remise comme au départ (un essai qui pose ou règle un widget la change). */
async function remettre(f: ReturnType<typeof FENETRE> = FENETRE()) {
  const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text);
}
/** La fenêtre que le serveur garde. */
const gardee = async () => ((await valhallaOf()!.act('gladsheim', 'fenetre')).data as { pages: Array<{ id: string; widgets: Array<Record<string, unknown>> }> });
/** Les widgets de la page montrée, tels que la page les tient (avant « Terminé »). */
const tenus = (p: Page) => p.evaluate(() => { const s = window.OdinFenetre.state(), pg = s.L.pages[Math.min(s.cur, s.L.pages.length - 1)]; return pg.widgets.map((w: any) => ({ id: w.id, kind: w.kind, module: w.module, c: w.c, r: w.r, label: w.label })); }) as Promise<Array<Record<string, any>>>;
const titreCarte = (p: Page, id: string) => p.evaluate((i: string) => document.querySelector(`#feGrid > .fe-w[data-id="${i}"] .wr-n`)?.textContent ?? null, id);
const terminer = async (p: Page) => {
  await p.evaluate(() => ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé') as any).click());
  await p.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
};
const valider = (p: Page) => p.evaluate(() => ([...document.querySelectorAll('dialog.wr-regler[open] button')].find((b: any) => b.textContent === 'Valider') as any).click());

for (const [largeur, sombre] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : la ligne d'une appli (une seule) pose son widget « appli », par « Ajouter » comme glissée ; la grille le dessine, avec le nom de l'appli pour titre, sans débordement`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      // Le titre d'une carte posée hier : le nom de l'appli (pas « Appli »).
      for (const [k, nom] of [['grand', 'Appli Essai'], ['piege', 'Appli Piège'], ['coupee', 'Appli Coupée']] as const) assert.equal(await titreCarte(p, ID[k]), nom, `${k} : le nom de l'appli pour titre`);
      await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-ajout');
      await p.click('#fenetre .fe-ajout'); await p.waitForFunction(() => document.querySelector('#feTiroir.open'));
      const noms = await p.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent)) as string[];
      assert.equal(noms.filter((n) => n === 'Appli Essai').length, 1, 'une seule ligne par appli');
      assert.equal(noms.includes('Appli'), false, 'pas de seconde ligne « Appli » sans appli');
      // Ce que la ligne donne au glisser (son vrai « dragstart »).
      const glisse = await p.evaluate(() => { const it = [...document.querySelectorAll('#feTiroir .fe-it')].find((n: any) => n.querySelector('b')?.textContent === 'Appli Essai') as any; const dt = new DataTransfer(); it.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); return dt.getData('text/odin-module'); }) as string;
      assert.deepEqual([JSON.parse(glisse).kind, JSON.parse(glisse).module], ['appli', 'essaiw'], 'glissée : le widget « appli » de cette appli');
      const n0 = (await tenus(p)).length;
      const combien = (n: number) => p.waitForFunction((x: number) => { const s = window.OdinFenetre.state(); return s.L.pages[Math.min(s.cur, s.L.pages.length - 1)].widgets.length === x; }, n, { timeout: 15000 });
      await p.click('#feTiroir button[aria-label="Ajouter Appli Essai"]'); await combien(n0 + 1);
      await p.evaluate((d: string) => { const dt = new DataTransfer(); dt.setData('text/odin-module', d); document.querySelector('#feGrid').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, glisse);
      await combien(n0 + 2);
      const poses = (await tenus(p)).slice(-2);
      for (const [i, x] of poses.entries()) {
        assert.deepEqual([x.kind, x.module, x.c, x.r], ['appli', 'essaiw', 3, 2], `${i ? 'glissé' : '« Ajouter »'} : le widget « appli » de l'appli, à la taille de la maquette`);
        await p.waitForFunction((id: string) => document.querySelector(`#feGrid > .fe-w[data-id="${id}"] .wr-n`), x.id, { timeout: 10000 });
        assert.equal(await titreCarte(p, x.id), 'Appli Essai', 'son titre : le nom de l\'appli');
      }
      await terminer(p);
      const ids: Record<string, string> = Object.fromEntries(poses.map((x, i) => [`pose${i}`, String(x.id)]));
      for (const id of Object.values(ids)) await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wa-corps`, { timeout: 30000 });
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const gardes = (await gardee()).pages.find((x) => x.id === PAGE)!.widgets.filter((w) => Object.values(ids).includes(String(w.id)));
      assert.deepEqual(gardes.map((w) => [w.kind, w.module]), [['appli', 'essaiw'], ['appli', 'essaiw']], 'gardés par Odin tels quels');
      const a = await vu(p, ids);
      assert.equal(a.deborde, false, 'rien ne déborde de la page');
      for (const k of Object.keys(ids)) {
        assert.equal(await titreCarte(p, ids[k]), 'Appli Essai');
        assert.equal(a[k].phrase, 'Appli Essai : une appli d\'essai pour le widget.', `${k} : dessiné par la famille`);
        assert.equal(a[k].dedans, true, `${k} : tout reste dans la carte`); assert.deepEqual(a[k].coupe, [], `${k} : rien de coupé`);
      }
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/generique-pose-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await remettre(); }
  });
}

test('navigateur : un widget « chiffres » d\'hier est relu et dessiné comme avant', { skip: sansNav }, async () => {
  const f = FENETRE(); f.pages[0].widgets.push({ id: 'c7e00008', kind: 'chiffres', module: 'essaiw', w: 1, c: 4, r: 2 });
  await remettre(f);
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    await p.waitForSelector('#feGrid .fe-w[data-id="c7e00008"] .va-kpis', { timeout: 30000 });
    const c = await p.evaluate(() => { const n = document.querySelector('#feGrid .fe-w[data-id="c7e00008"]') as any; return { titre: n.querySelector('.wr-n')?.textContent, kpis: [...n.querySelectorAll('.va-kpi small')].map((x: any) => x.textContent), famille: Boolean(n.querySelector('.wa-corps')) }; });
    assert.deepEqual(c, { titre: 'Appli Essai', kpis: ['Fichiers', 'Taille', 'Erreurs'], famille: false }, 'ses chiffres clés, comme avant');
    assert.equal((await tenus(p)).find((w) => w.id === 'c7e00008')!.kind, 'chiffres');
    assert.equal((await gardee()).pages.find((x) => x.id === PAGE)!.widgets.find((w) => w.id === 'c7e00008')!.kind, 'chiffres', 'Odin le garde tel quel');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur : une appli retirée d\'Odin depuis : un titre neutre, jamais son identifiant', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false, 'essaix');
  try {
    const neutre = await p.evaluate(() => window.OdinWidgetsRendu.rendu('appli').titre) as string;
    assert.ok(neutre && !/essaix/i.test(neutre));
    for (const k of ['coupee', 'retiree'] as const) {
      const t = await p.evaluate((i: string) => { const n = document.querySelector(`#feGrid > .fe-w[data-id="${i}"]`) as any; return { titre: n?.querySelector('.wr-n')?.textContent, entete: n?.querySelector('.wr-t')?.textContent ?? '', corps: n?.textContent ?? '' }; }, ID[k]) as { titre: string; entete: string; corps: string };
      assert.equal(t.titre, neutre, `${k} : un titre neutre`);
      assert.doesNotMatch(t.entete, /essaix/i, `${k} : ni titre ni sous-titre avec l'identifiant`);
      assert.doesNotMatch(t.corps, /essaix/i, `${k} : nulle part dans la carte`);
    }
    assert.equal(await titreCarte(p, ID.grand), 'Appli Essai', 'les autres gardent le nom de leur appli');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : « Régler » change l'appli de la carte (les applis que le catalogue donne) ; un titre choisi passe avant`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      await p.evaluate(() => window.OdinFenetre.edit(true)); await p.waitForSelector('#fenetre.fe-edit');
      const plus = `#feGrid > .fe-w[data-id="${ID.petit}"] .wr-plus`;
      await p.waitForSelector(plus); await p.evaluate((s: string) => (document.querySelector(s) as any).click(), plus);
      await p.waitForSelector('dialog.wr-regler[open] #wrRApp');
      const choix = await p.evaluate(() => { const s = document.querySelector('#wrRApp') as any; return { valeurs: [...s.options].map((o: any) => o.value), noms: [...s.options].map((o: any) => o.textContent), choisie: s.value, nom: document.querySelector('label[for="wrRApp"]')?.textContent ?? '' }; }) as { valeurs: string[]; noms: string[]; choisie: string; nom: string };
      const cat = await p.evaluate(() => fetch('/api/valhalla/catalog', { headers: { 'x-odin': '1' }, credentials: 'same-origin' }).then((r) => r.json())) as { modules: Array<{ id: string; name: string }> };
      assert.equal(choix.choisie, 'essaiw', 'l\'appli de la carte, choisie');
      assert.ok(choix.valeurs.includes('essaip') && choix.valeurs.includes('essaiw'), 'les applis du catalogue');
      assert.equal(choix.valeurs.includes('essaix'), false, 'une appli désactivée n\'est pas proposée');
      assert.ok(choix.valeurs.every((id) => cat.modules.some((m) => m.id === id)), 'rien d\'autre que le catalogue de qui regarde');
      assert.deepEqual(choix.noms, choix.valeurs.map((id) => cat.modules.find((m) => m.id === id)!.name), 'chaque appli par son nom');
      assert.ok(choix.nom.trim(), 'le champ a un nom');
      await p.selectOption('#wrRApp', 'essaip'); await valider(p);
      await p.waitForFunction(() => !document.querySelector('dialog.wr-regler[open]'));
      assert.equal((await tenus(p)).find((w) => w.id === ID.petit)!.module, 'essaip');
      await p.waitForFunction((i: string) => document.querySelector(`#feGrid > .fe-w[data-id="${i}"] .wr-n`)?.textContent === 'Appli Piège', ID.petit, { timeout: 10000 });
      // Un titre choisi par la personne passe avant le nom de l'appli.
      await p.evaluate((s: string) => (document.querySelector(s) as any).click(), plus); await p.waitForSelector('dialog.wr-regler[open] #wrRApp');
      assert.equal(await p.evaluate(() => (document.querySelector('#wrRApp') as any).value), 'essaip');
      await p.fill('#wrRT', 'Mon titre'); await valider(p);
      await p.waitForFunction((i: string) => document.querySelector(`#feGrid > .fe-w[data-id="${i}"] .wr-n`)?.textContent === 'Mon titre', ID.petit, { timeout: 10000 });
      await terminer(p);
      const w = (await gardee()).pages.find((x) => x.id === PAGE)!.widgets.find((x) => x.id === ID.petit)!;
      assert.deepEqual([w.kind, w.module, w.label], ['appli', 'essaip', 'Mon titre'], 'Odin le garde');
      await p.waitForFunction((i: string) => /Appli Piège : une appli d'essai/.test(document.querySelector(`#feGrid > .fe-w[data-id="${i}"] .wa-quoi`)?.textContent ?? ''), ID.petit, { timeout: 30000 });
      const a = await vu(p, { petit: ID.petit });
      assert.equal(a.deborde, false); assert.equal(a.petit.dedans, true); assert.deepEqual(a.petit.coupe, []);
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await remettre(); }
  });
}

test('navigateur : « Régler » d\'une appli retirée : « Quand je touche » dit le titre neutre, jamais l\'identifiant', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false, 'essaix');
  try {
    await p.evaluate(() => window.OdinFenetre.edit(true)); await p.waitForSelector('#fenetre.fe-edit');
    const plus = `#feGrid > .fe-w[data-id="${ID.retiree}"] .wr-plus`;
    await p.waitForSelector(plus); await p.evaluate((s: string) => (document.querySelector(s) as any).click(), plus);
    await p.waitForSelector('dialog.wr-regler[open] #wrRQ');
    const d = await p.evaluate(() => ({ ouvrir: document.querySelector('#wrRQ option[value="appli"]')?.textContent ?? '', tout: document.querySelector('dialog.wr-regler[open]')?.textContent ?? '', neutre: window.OdinWidgetsRendu.rendu('appli').titre, attendu: window.OdinWidgetsRendu.TEXTES.reglage.choix.appli(window.OdinWidgetsRendu.rendu('appli').titre) })) as Record<string, string>;
    assert.equal(d.ouvrir, d.attendu, '« Ouvrir » suivi du titre neutre');
    assert.doesNotMatch(d.tout, /essaix/i, 'l\'identifiant n\'apparaît nulle part dans « Régler »');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : « Régler », une autre appli choisie : l\'en-tête, le titre proposé, « Ouvrir … » et les actions deviennent les siens ; l\'action choisie est gardée', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    await p.evaluate(() => window.OdinFenetre.edit(true)); await p.waitForSelector('#fenetre.fe-edit');
    const plus = `#feGrid > .fe-w[data-id="${ID.petit}"] .wr-plus`;
    await p.waitForSelector(plus); await p.evaluate((s: string) => (document.querySelector(s) as any).click(), plus);
    await p.waitForSelector('dialog.wr-regler[open] #wrRApp');
    const cat = await p.evaluate(() => fetch('/api/valhalla/catalog', { headers: { 'x-odin': '1' }, credentials: 'same-origin' }).then((r) => r.json())) as { modules: Array<{ id: string; name: string; actions: Array<{ id: string }> }> };
    const frigg = cat.modules.find((m) => m.id === 'frigg')!, essai = cat.modules.find((m) => m.id === 'essaiw')!;
    assert.ok(frigg.actions.length && frigg.actions.every((a) => !essai.actions.some((b) => b.id === a.id)), 'deux applis aux actions différentes');
    // Une action de l'appli d'avant, choisie avant de changer d'appli.
    await p.selectOption('#wrRQ', 'action'); await p.waitForSelector('#wrRA'); await p.selectOption('#wrRA', 'etat');
    await p.selectOption('#wrRApp', 'frigg');
    const d = await p.evaluate(() => { const g = document.querySelector('dialog.wr-regler[open]') as any; return { entete: g.querySelector('h2')?.textContent ?? '', place: (document.querySelector('#wrRT') as any).placeholder, ouvrir: document.querySelector('#wrRQ option[value="appli"]')?.textContent ?? '', quoi: (document.querySelector('#wrRQ') as any).value, actions: [...document.querySelectorAll('#wrRA option')].map((o: any) => o.value) }; }) as { entete: string; place: string; ouvrir: string; quoi: string; actions: string[] };
    assert.match(d.entete, new RegExp(frigg.name), 'l\'en-tête suit l\'appli choisie'); assert.doesNotMatch(d.entete, /Appli Essai/);
    assert.equal(d.place, frigg.name, 'le titre proposé suit');
    assert.match(d.ouvrir, new RegExp(frigg.name)); assert.doesNotMatch(d.ouvrir, /Appli Essai/, '« Ouvrir … » suit');
    assert.equal(d.quoi, 'action');
    assert.deepEqual(d.actions, frigg.actions.map((a) => a.id), 'les actions de la nouvelle appli seulement');
    await p.selectOption('#wrRA', frigg.actions[0].id); await valider(p);
    await p.waitForFunction(() => !document.querySelector('dialog.wr-regler[open]'));
    const w = await p.evaluate((i: string) => { const s = window.OdinFenetre.state(); return JSON.parse(JSON.stringify(s.L.pages.flatMap((x: any) => x.widgets).find((x: any) => x.id === i))); }, ID.petit) as { module: string; toucher?: { quoi: string; action: string } };
    assert.equal(w.module, 'frigg');
    assert.deepEqual([w.toucher?.quoi, w.toucher?.action], ['action', frigg.actions[0].id], 'l\'action de la nouvelle appli, choisie à l\'écran, est gardée');
    // Revenir à l'appli de départ : ses actions à elle, de nouveau.
    await p.evaluate((s: string) => (document.querySelector(s) as any).click(), plus); await p.waitForSelector('dialog.wr-regler[open] #wrRApp');
    await p.selectOption('#wrRApp', 'essaiw');
    const a2 = await p.evaluate(() => ({ quoi: (document.querySelector('#wrRQ') as any).value, actions: [...document.querySelectorAll('#wrRA option')].map((o: any) => o.value) })) as { quoi: string; actions: string[] };
    assert.deepEqual([a2.quoi, a2.actions], ['action', essai.actions.map((a) => a.id)]);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});
