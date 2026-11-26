// La maison d'un coup d'œil (maquette validée « Accueil ») : trois sortes de plus dans la famille « maison », rangées dans
// leur propre fichier (src/valhalla/widgets/maison-ensemble.ts, src/web/pages/widgets-maison-ensemble.js).
// - « Scènes » : SES scènes (Midgard), chacune par son nom ; un appui la lance par la route qui existe
//   (POST /api/maison/scene) ; une scène qui ouvre la maison (serrure, portail) redemande son accord à chaque fois, et
//   sans accord rien ne part ; ce que fait une scène est dit par l'interface (la donnée ne porte que des comptes) ;
//   aucune scène : « vide ». Ni scène « active », ni icône : Odin ne les garde pas.
// - « Bandeau d'état » : seulement des faits vrais, comptés sur les appareils que l'écran de la maison reçoit déjà ; un
//   fait sans source n'a pas de puce ; ni alarme, ni musique ; rien de vrai à dire : « vide », jamais un bandeau vide.
// - « Ma maison » : les compteurs vrais (pièces, appareils, sans nouvelles), et les comptes des petits chiffres (les
//   mêmes fonctions, pas une copie) ; sans appareil : « vide ».
// - Qui voit quoi : comme les petits chiffres (le propriétaire ; une tablette « maison » ; jamais un membre) ; lancer
//   seulement pour le propriétaire, sur l'accueil ; rien de plus pour un membre, une tablette, une clé ou sans session.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), PAGE_JS = lire('src/web/pages/widgets-maison-ensemble.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const SORTES = ['maison_scenes', 'maison_bandeau', 'ma_maison'] as const;
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'd3900000', kind, w: 2, c: 4, r: 3, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, LUI_MAISON: Lecteur = { qui: 'proprietaire', ecran: 'maison' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000, MIN = 60_000, H = 3_600_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

type Ap = { ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; enLigne?: boolean; vuA?: number; liens?: string[] };
const ap = (sorte: string, etat: string, o: Partial<Ap> = {}): Ap => ({ ids: `zb_${sorte}`, piece: 'Pièce A', sorte, etat, unite: '', marche: '', arret: '', vuA: MAINT - 2 * MIN, ...o });
type Sc = { nom: string; etapes: number; ouvre: boolean };
function fausse(appareils: Ap[] | undefined, scenes?: Sc[] | null, o: { sansMidgard?: boolean; espions?: string[] } = {}): SourceWidget {
  return {
    appli: (id) => (id === 'midgard' && !o.sansMidgard ? { id, name: 'Appli maison', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    appareilsMaison: async () => { o.espions?.push('appareils'); return appareils ? { unites: 'metrique', appareils } : undefined; },
    ...(scenes === null ? {} : { scenesMaison: () => { o.espions?.push('scenes'); return scenes; } }),
  } as SourceWidget;
}

// ------------------------------------------------------------------ le serveur, avec une fausse source

test('les trois sortes : famille « maison », Midgard lue, public « maison », posables, tailles de la maquette, admises à l\'écran de la maison', () => {
  const tailles: Record<string, [number[], number]> = { maison_scenes: [[3, 2], 3], maison_bandeau: [[4, 1], 1], ma_maison: [[4, 3], 4] };
  for (const k of SORTES) {
    const s = sorteDe(k)!;
    assert.ok(s, k); assert.equal(s.famille, 'maison', k); assert.deepEqual(s.applis, ['midgard'], k); assert.equal(publicDe(s), 'maison', k);
    assert.equal(s.posable, true, k); assert.deepEqual([[...s.taille.mini], s.taille.r], tailles[k], k);
    assert.deepEqual(TAILLE_SORTE[k as keyof typeof TAILLE_SORTE], { mini: tailles[k][0], r: tailles[k][1] }, k);
    assert.equal(admiseALaMaison(k), true, k); assert.notEqual(s.jamaisALaMaison, true, k); assert.notEqual(s.accueilSeul, true, k);
  }
});

test('scènes : ses scènes par leur nom ; celle qui ouvre la maison est marquée ; la donnée ne porte aucune phrase ; lancer : le propriétaire sur l\'accueil seulement', async () => {
  const sc: Sc[] = [{ nom: 'Soir A', etapes: 3, ouvre: false }, { nom: 'Départ B', etapes: 2, ouvre: true }];
  const e = await etat(W('maison_scenes'), LUI, fausse([], sc));
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT);
  assert.deepEqual(e.donnee, { scenes: [{ nom: 'Soir A', etapes: 3, ouvre: false }, { nom: 'Départ B', etapes: 2, ouvre: true }], total: 2, lancer: true });
  // Aucune phrase dans la donnée : seulement des noms (les siens) et des comptes.
  const tout = JSON.stringify(e.donnee);
  for (const mot of ['étape', 'ouvre la', 'accord', 'déverrouill', 'GRAVE', 'scène «']) assert.ok(!tout.includes(mot), `aucune phrase : ${mot}`);
  // Ni scène « active », ni icône.
  assert.ok(!/actif|active|icone|icon|symbole/.test(tout));
  // Sur l'écran de la maison, même pour lui : rien ne se lance depuis ce widget. Une tablette : les noms (comme
  // etat.scenes), jamais « lancer ».
  assert.equal((await etat(W('maison_scenes'), LUI_MAISON, fausse([], sc))).donnee!.lancer, false);
  const t = await etat(W('maison_scenes'), TABLETTE, fausse([], sc));
  assert.equal(t.etat, 'ok'); assert.equal(t.donnee!.lancer, false);
});

test('scènes : zéro scène → « vide » ; Midgard absente ou muette : rien d\'inventé ; un membre : refusé sans rien lire', async () => {
  assert.deepEqual(await etat(W('maison_scenes'), LUI, fausse([], [])), { etat: 'vide', raison: 'aucune_scene' });
  assert.deepEqual(await etat(W('maison_scenes'), LUI, fausse([], undefined)), { etat: 'source_absente', raison: 'appli_muette' });
  assert.deepEqual(await etat(W('maison_scenes'), LUI, fausse([], null)), { etat: 'source_absente', raison: 'pas_encore_lu' });
  assert.equal((await etat(W('maison_scenes'), LUI, fausse([], [], { sansMidgard: true }))).etat, 'source_absente');
  const lus: string[] = [];
  for (const k of SORTES) {
    const e = await etat(W(k), membre(['midgard', 'gladsheim', 'odin']), fausse([ap('lumière', 'on')], [{ nom: 'X', etapes: 1, ouvre: false }], { espions: lus }));
    assert.deepEqual(e, { etat: 'refuse', raison: 'proprietaire_seul' }, k);
  }
  assert.deepEqual(lus, [], 'rien n\'est lu pour un membre');
});

test('bandeau : seulement du vrai, chaque puce comptée sur de faux appareils ; ni alarme, ni musique', async () => {
  const b = async (l: Ap[]) => etat(W('maison_bandeau'), LUI, fausse(l, []));
  // Rien d'allumé, tout en ligne : « tout est éteint » (sur 3 appareils qui s'allument) et les lumières éteintes.
  let e = await b([ap('lumière', 'off'), ap('lumière', 'OFF', { marche: 'ON', arret: 'OFF' }), ap('prise', 'off'), ap('capteur', '21', { unite: '°C' })]);
  assert.equal(e.etat, 'ok');
  assert.deepEqual(e.donnee!.puces, [{ fait: 'tout_eteint', sur: 3 }]);
  // Deux lumières allumées sur trois, une clim en marche, une serrure ouverte, un appareil hors ligne, un muet depuis 25 h.
  e = await b([ap('lumière', 'on'), ap('lumière', 'on'), ap('lumière', 'off'), ap('clim', 'cool'), ap('serrure', 'unlocked'), ap('serrure', 'locked'),
    ap('prise', 'on', { enLigne: false }), ap('capteur', '20', { unite: '°C', vuA: MAINT - 25 * H }), ap('lecteur', 'playing')]);
  assert.deepEqual(e.donnee!.puces, [
    { fait: 'serrures_ouvertes', n: 1, sur: 2 },
    { fait: 'sans_nouvelles', n: 2, sur: 9 },
    { fait: 'lumieres_allumees', n: 2, sur: 3 },
    { fait: 'clims_allumees', n: 1, sur: 1 },
  ]);
  const tout = JSON.stringify(e.donnee);
  assert.ok(!/alarme|musique|apollon|aegir|playing|lecteur/i.test(tout), 'ni alarme, ni musique : rien dans Odin ne les dit');
  // Toutes les serrures verrouillées : dit ; une serrure sans nouvelles : pas « toutes verrouillées ».
  e = await b([ap('serrure', 'locked'), ap('serrure', 'LOCKED')]);
  assert.deepEqual(e.donnee!.puces, [{ fait: 'serrures_verrouillees', n: 2, sur: 2 }]);
  e = await b([ap('serrure', 'locked'), ap('serrure', 'locked', { enLigne: false })]);
  assert.deepEqual(e.donnee!.puces, [{ fait: 'sans_nouvelles', n: 1, sur: 2 }]);
  // Une lumière hors ligne : jamais « tout est éteint » (on ne le sait pas).
  e = await b([ap('lumière', 'off'), ap('lumière', 'on', { enLigne: false })]);
  assert.deepEqual(e.donnee!.puces, [{ fait: 'sans_nouvelles', n: 1, sur: 2 }]);
  // Rien de vrai à dire (que des capteurs frais) : « vide », jamais un bandeau vide ; aucun appareil : « vide ».
  assert.deepEqual(await b([ap('capteur', '21', { unite: '°C' })]), { etat: 'vide', raison: 'rien_a_dire' });
  assert.deepEqual(await b([]), { etat: 'vide', raison: 'aucun_appareil' });
});

test('sans nouvelles : la même règle que les « muets » des petits chiffres (hors ligne, muet depuis plus d\'un jour, ou en ligne sans état lu)', async () => {
  // Une lumière en ligne et fraîche dont l'état n'est pas lu : « muette » dans « Allumés », donc « sans nouvelles » ici aussi.
  const l = [ap('lumière', ''), ap('lumière', 'off'), ap('prise', 'on', { enLigne: false })];
  const allumes = await etat(W('maison_allumes'), LUI, fausse(l, []));
  assert.equal(allumes.donnee!.muets, 2);
  const m = await etat(W('ma_maison'), LUI, fausse(l, []));
  assert.equal(m.donnee!.sansNouvelles, 2, 'le même compte que les muets des petits chiffres');
  const b = await etat(W('maison_bandeau'), LUI, fausse(l, []));
  assert.deepEqual(b.donnee!.puces[0], { fait: 'sans_nouvelles', n: 2, sur: 3 });
});

test('ma maison : les compteurs vrais, et les comptes des petits chiffres (les mêmes, pas une copie) ; sans appareil : « vide »', async () => {
  const l = [ap('lumière', 'on', { piece: 'Salon' }), ap('lumière', 'off', { piece: 'Salon' }), ap('prise', 'on', { piece: 'Cuisine', enLigne: false }), ap('serrure', 'locked', { piece: '' }),
    ap('capteur', '21.5', { unite: '°C', piece: 'Salon', ids: 'zb_salon_temperature' }), ap('capteur', '23.5', { unite: '°C', piece: 'Chambre', ids: 'zb_ch_temperature' })];
  const e = await etat(W('ma_maison'), LUI, fausse(l, []));
  assert.equal(e.etat, 'ok');
  // Les mêmes comptes que les petits chiffres, lus sur la même source.
  const petit = async (k: string) => { const x = await etat(W(k), LUI, fausse(l, [])); return x.etat === 'ok' ? { ...x.donnee, ...(k === 'maison_temperature' ? { at: x.at } : {}) } : undefined; };
  assert.deepEqual(e.donnee, {
    pieces: 3, appareils: 6, sansNouvelles: 1,
    allumes: await petit('maison_allumes'), lumieres: await petit('maison_lumieres'), serrures: await petit('maison_serrures'), temperature: await petit('maison_temperature'),
  });
  assert.deepEqual(e.donnee!.allumes, { n: 1, sur: 3, muets: 1 });
  assert.deepEqual(e.donnee!.temperature, { valeur: 22.5, unite: 'C', n: 2, ecartes: 0, at: MAINT - 2 * MIN });
  // Rien d'alarme : la donnée ne dit rien de tel.
  assert.ok(!/alarme|etage|étage/i.test(JSON.stringify(e.donnee)));
  // Sans lumière, sans serrure, sans capteur : la ligne n'existe pas (jamais un 0 à la place d'une absence).
  const p = await etat(W('ma_maison'), LUI, fausse([ap('prise', 'off')], []));
  assert.deepEqual(p.donnee, { pieces: 1, appareils: 1, sansNouvelles: 0, allumes: { n: 0, sur: 1, muets: 0 } });
  assert.deepEqual(await etat(W('ma_maison'), LUI, fausse([], [])), { etat: 'vide', raison: 'aucun_appareil' });
  assert.deepEqual(await etat(W('ma_maison'), LUI, fausse(undefined, [])), { etat: 'source_absente', raison: 'appli_muette' });
});

// ------------------------------------------------------------------ la page, sans document

const fenetre = () => {
  const win: Record<string, any> = { document: undefined };
  win.window = win; vm.createContext(win);
  vm.runInContext(GRILLE, win); vm.runInContext(RENDU, win); vm.runInContext(PAGE_JS, win);
  return win;
};

test('page : déclarée dans la famille « maison », Midgard, les tailles de la maquette ; les deux tables de la grille suivent le serveur', () => {
  const win = fenetre();
  assert.ok(PAGE_JS.length > 0, 'le fichier de la page existe');
  const R = win.OdinWidgetsRendu;
  for (const k of SORTES) {
    const d = R.rendu(k); assert.ok(d, `${k} déclarée`);
    assert.equal(d.famille, 'maison'); assert.equal(d.appli, 'midgard'); assert.equal(d.jamaisALaMaison, false, `${k} : la même marque que le serveur`); assert.equal(d.groupe, '', `${k} : rangée avec l'appli de la maison`);
    assert.deepEqual([...win.OdinGrille.MINI[k]], TAILLE_SORTE[k as keyof typeof TAILLE_SORTE].mini, k); assert.equal(win.OdinGrille.HAUTEUR[k], TAILLE_SORTE[k as keyof typeof TAILLE_SORTE].r, k);
  }
  assert.equal(R.rendu('maison_bandeau').petit, true, 'le bandeau : sans en-tête, comme la maquette');
  assert.deepEqual([...R.rendu('maison_scenes').vides], ['aucune_scene']);
  // Ni alarme, ni musique, ni les exemples de la maquette dans le fichier.
  for (const mot of ['Alarme', 'alarme prête', 'Musique', 'Apollon', 'Cinéma', 'Soirée', 'Fraîcheur', '2 étages', '63 appareils', 'Portail fermé', 'Lave-linge']) assert.ok(!PAGE_JS.includes(mot), mot);
});

test('page : la phrase d\'une scène est faite par l\'interface, à partir de ses comptes', () => {
  const E = fenetre().OdinWidgetsMaisonEnsemble;
  assert.equal(E.TEXTES.scenes.etapes(1), '1 étape'); assert.equal(E.TEXTES.scenes.etapes(3), '3 étapes');
  assert.match(E.ditScene({ nom: 'Départ B', etapes: 2, ouvre: true }), /^Départ B : 2 étapes\. Ouvre la maison : ton accord est demandé à chaque fois\.$/);
  assert.equal(E.ditScene({ nom: 'Soir A', etapes: 3, ouvre: false }), 'Soir A : 3 étapes.');
});

/** Un faux serveur : il note chaque appel, et répond comme la route d'aujourd'hui (maison-api.ts, run). */
function serveur(ouvre: boolean, oui: boolean | 'jette') {
  const win = fenetre(), appels: Array<Record<string, unknown>> = [], dialogues: string[] = [];
  win.fetch = async (chemin: string, o: { method: string; headers: Record<string, string>; body: string }) => {
    const corps = JSON.parse(o.body); appels.push({ chemin, methode: o.method, x: o.headers['x-odin'], ...corps });
    const r = ouvre && corps.confirm !== true ? { ok: false, confirm: 'Confirmer : scène « Départ B » : ouvrir la maison ?' } : { ok: true, text: `🎬 ${corps.scene}\n✓ a → on\n✗ b : non relié` };
    return { json: async () => r };
  };
  win.OdinDialog = { confirm: async (t: string) => { dialogues.push(t); if (oui === 'jette') throw new Error('fermé'); return oui; } };
  return { E: win.OdinWidgetsMaisonEnsemble, appels, dialogues };
}

test('page : une scène qui ouvre redemande l\'accord à chaque fois ; sans accord, rien ne part', async () => {
  for (const non of [false, 'jette'] as const) {
    const { E, appels, dialogues } = serveur(true, non);
    const r = await E.lancerScene('Départ B');
    assert.equal(appels.length, 1, 'un seul appel, sans accord');
    assert.deepEqual(appels[0], { chemin: '/api/maison/scene', methode: 'POST', x: '1', scene: 'Départ B' }, 'jamais « confirm » sans son accord');
    assert.equal(dialogues.length, 1); assert.match(dialogues[0], /ouvrir la maison/);
    assert.equal(r, E.TEXTES.scenes.annule);
  }
  const { E, appels, dialogues } = serveur(true, true);
  assert.match(await E.lancerScene('Départ B'), /« Départ B » lancée/);
  assert.deepEqual(appels.map((a) => a.confirm), [undefined, true]);
  // Une seconde fois : l'accord est redemandé (rien n'est gardé).
  await E.lancerScene('Départ B');
  assert.equal(dialogues.length, 2); assert.deepEqual(appels.map((a) => a.confirm), [undefined, true, undefined, true]);
});

test('page : une scène simple part par la route qui existe, une seule fois ; le résultat et l\'échec sont dits', async () => {
  const { E, appels, dialogues } = serveur(false, false);
  const r = await E.lancerScene('Soir A');
  assert.deepEqual(appels, [{ chemin: '/api/maison/scene', methode: 'POST', x: '1', scene: 'Soir A' }]); assert.deepEqual(dialogues, []);
  assert.equal(r, '« Soir A » lancée ; 1 étape n\'a pas abouti.');
  assert.equal(E.resultat('Soir A', { ok: true, text: '🎬 Soir A\n✓ a\n✓ b' }), '« Soir A » lancée.');
  assert.equal(E.resultat('Soir A', { ok: false, text: 'scène inconnue : Soir A' }), '« Soir A » n\'est pas partie.');
  assert.equal(E.resultat('Soir A', undefined), 'Odin ne répond pas : rien n\'est parti.');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme-48';
const PAGE = 'b3900001', PAGE_MAISON = 'b3900002', PIEGE = '<img src=x onerror="window.__pirate=1">';
const ID = { scenes: 'd3900001', bandeau: 'd3900002', maison: 'd3900003' };
// `mini` : chacun à la plus petite taille que la grille lui permet (4 × 1, 3 × 2, 4 × 3).
const FENETRE = (avec: boolean, mini = false) => ({ pages: [
  { id: PAGE, name: 'Maison', widgets: avec ? (mini
    ? [{ id: ID.bandeau, kind: 'maison_bandeau', w: 1, c: 4, r: 1, pc: 4, pr: 1 }, { id: ID.scenes, kind: 'maison_scenes', w: 1, c: 3, r: 2, pc: 4 }, { id: ID.maison, kind: 'ma_maison', w: 1, c: 4, r: 3, pc: 4 }]
    : [{ id: ID.bandeau, kind: 'maison_bandeau', w: 3, c: 12, r: 1, pc: 4, pr: 1 }, { id: ID.scenes, kind: 'maison_scenes', w: 1, c: 4, r: 3, pc: 4 }, { id: ID.maison, kind: 'ma_maison', w: 2, c: 6, r: 4, pc: 4 }]) : [] },
  { id: PAGE_MAISON, name: 'Au mur', maison: true, widgets: avec ? [{ id: 'd3900010', kind: 'maison_scenes', w: 1, c: 4, r: 3 }, { id: 'd3900011', kind: 'maison_bandeau', w: 3, c: 12, r: 1 }] : [] },
] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((w) => w.id === id) }; };
const ecranMaison = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); const { at: _a, mascotte: _m, ...reste } = r.body; return { status: r.status, reste }; };
const regler = async (avec: boolean, mini = false) => { const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined }); const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE(avec, mini)) }); assert.equal(r.ok, true, r.text); };
const QUI = () => ({ tablette: { cookie: '', 'x-odin-maison': cleMaison }, membre: { cookie: avecDroit }, cle: { cookie: '', authorization: `Bearer ${v.token}` }, sans: { cookie: '' } });

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-m', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  // Ses scènes : une simple (une box non reliée : l'étape échoue, rien ne s'ouvre), une qui ouvre la maison, une au nom piégé.
  for (const [nom, etapes] of [['Soir A', 'ha:light.salon = off\nha:light.cuisine = off'], ['Départ B', 'ha:lock.entree = ouvrir'], [PIEGE, 'ha:light.salon = on']]) {
    assert.equal((await va.act('midgard', 'creer_scene', { nom, etapes })).ok, true, nom);
  }
  await regler(true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : ses scènes (noms, comptes, celle qui ouvre) ; lancer par la route d\'aujourd\'hui ; celle qui ouvre ne part pas sans accord', async () => {
  const lui = await donnees();
  assert.equal(lui.status, 200);
  const s = lui.de(ID.scenes)!; assert.equal(s.etat, 'ok', JSON.stringify(s));
  assert.deepEqual(s.donnee, { scenes: [{ nom: 'Soir A', etapes: 2, ouvre: false }, { nom: 'Départ B', etapes: 1, ouvre: true }, { nom: PIEGE, etapes: 1, ouvre: false }], total: 3, lancer: true });
  assert.ok(!lui.corps.includes('ha:light') && !lui.corps.includes('ha:lock'), 'aucune étape brute (aucun identifiant d\'appareil)');
  // Sans appareil : le bandeau et « ma maison » disent « vide », jamais un 0.
  assert.deepEqual([lui.de(ID.bandeau)!.etat, lui.de(ID.bandeau)!.raison], ['vide', 'aucun_appareil']);
  assert.deepEqual([lui.de(ID.maison)!.etat, lui.de(ID.maison)!.raison], ['vide', 'aucun_appareil']);
  // La route qui existe, telle quelle : la scène qui ouvre demande l'accord, et sans lui rien ne part.
  const avant = await v.json('/api/maison/scene', { scene: 'Départ B' });
  assert.equal(avant.status, 200); assert.equal(avant.body.ok, false); assert.match(String(avant.body.confirm), /^Confirmer : /);
  const simple = await v.json('/api/maison/scene', { scene: 'Soir A' });
  assert.equal(simple.body.ok, true); assert.match(String(simple.body.text), /^🎬 Soir A/);
});

test('vrai Odin : un membre (même avec le droit sur Midgard), une tablette, une clé d\'accès, sans session : rien de plus qu\'avant', async () => {
  const m = await donnees({ cookie: avecDroit });
  assert.equal(m.status, 200);
  for (const id of Object.values(ID)) { const e = m.de(id)!; assert.deepEqual([e.etat, e.raison, 'donnee' in e], ['refuse', 'proprietaire_seul', false], id); }
  assert.ok(!m.corps.includes('Soir A') && !m.corps.includes('Départ B'), 'aucun nom de scène pour un membre');
  for (const [qui, h] of Object.entries(QUI()).filter(([k]) => k !== 'membre')) { const r = await donnees(h); assert.equal(r.status, 401, qui); assert.ok(!r.corps.includes('Soir A'), qui); }
  // L'écran de la maison, avec et sans ces widgets posés sur la page « au mur » : exactement la même chose pour chacun.
  const apres: Record<string, unknown> = {}; for (const [k, h] of Object.entries(QUI())) apres[k] = await ecranMaison(h);
  await regler(false);
  try { for (const [k, h] of Object.entries(QUI())) assert.deepEqual(apres[k], await ecranMaison(h), `${k} : l'écran de la maison ne change pas`); }
  finally { await regler(true); }
  // Les scènes, rejouées comme aujourd'hui : la tablette ne lance jamais celle qui ouvre (même avec « confirm ») ; le
  // membre, la clé et sans session : refusés.
  const t = await v.json('/api/maison/scene', { scene: 'Départ B', confirm: true }, QUI().tablette);
  assert.equal(t.body.ok, false); assert.match(String(t.body.text), /action grave/);
  for (const k of ['membre', 'cle', 'sans'] as const) assert.equal((await v.json('/api/maison/scene', { scene: 'Soir A' }, QUI()[k])).status, 401, k);
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, requestAnimationFrame: (f: () => void) => number;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
const FORCES: Record<string, () => Record<string, unknown>> = {
  [ID.bandeau]: () => ({ etat: 'ok', at: Date.now(), donnee: { puces: [{ fait: 'serrures_ouvertes', n: 1, sur: 2 }, { fait: 'sans_nouvelles', n: 2, sur: 9 }, { fait: 'lumieres_allumees', n: 2, sur: 3 }, { fait: 'clims_allumees', n: 1, sur: 1 }, { fait: 'inconnu_du_dessin', n: 9 }] } }),
  [ID.maison]: () => ({ etat: 'ok', at: Date.now(), donnee: { pieces: 3, appareils: 6, sansNouvelles: 1, allumes: { n: 1, sur: 3, muets: 1 }, lumieres: { n: 1, sur: 2, muets: 0 }, serrures: { n: 1, sur: 1, ouvertes: 0, muets: 0 }, temperature: { valeur: 22.5, unite: 'C', n: 2, ecartes: 0, at: Date.now() - 4 * MIN } } }),
};
async function ouvrir(largeur: number, sombre: boolean, forces: Record<string, () => Record<string, unknown>> = FORCES) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (Object.hasOwn(forces, w.id) ? { id: w.id, kind: w.kind, page: w.page, ...forces[w.id]() } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  for (const id of Object.values(ID)) await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wme`, { timeout: 45000 });
  return { ctx, page: p, erreurs };
}
// Mesuré quand la page est posée : les polices arrivées, deux images dessinées (ce qui tient a été recompté).
const pose = (p: Page) => p.evaluate(() => document.fonts.ready.then(() => new Promise<void>((f) => requestAnimationFrame(() => requestAnimationFrame(() => f())))));
const vu = async (p: Page) => { await pose(p); return mesure(p); };
const mesure = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, pirate: Boolean(window.__pirate) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), vis = (n: any) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width <= 0 || r.height <= 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
    out[nom] = {
      texte: (c.textContent ?? '').replace(/\s+/g, ' '),
      dehors: [...c.querySelectorAll('*')].filter(vis).filter((n: any) => !dans(n)).map((n: any) => `${n.tagName}.${n.className?.baseVal ?? n.className}`),
      petits: [...c.querySelectorAll('button, a')].filter(vis).filter((n: any) => { const r = n.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((n: any) => n.textContent),
      coupesSansBulle: [...c.querySelectorAll('.wme *')].filter((n: any) => vis(n) && n.children.length === 0 && n.scrollWidth > n.clientWidth + 1 && !n.closest('[title]')).map((n: any) => n.textContent),
      boutons: [...c.querySelectorAll('.wme button')].filter(vis).map((n: any) => n.textContent),
      plus: (c.querySelector('.wme-plus:not([hidden])')?.textContent ?? ''),
      images: c.querySelectorAll('.wme img').length,
      // Ce qui se voit vraiment (textContent compte aussi ce qui est caché).
      vues: [...c.querySelectorAll('.wme [data-item]')].filter(vis).length,
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [390, true], [768, false]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : scènes, bandeau et « ma maison » dans leur carte, cibles de 44 px, un nom piégé reste du texte`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.pirate, false, 'aucun script injecté');
      for (const k of Object.keys(ID)) {
        assert.ok(a[k], `${k} affichée`); assert.deepEqual(a[k].dehors, [], `${k} reste dans sa carte`); assert.deepEqual(a[k].petits, [], `${k} : cibles de 44 px`);
        assert.deepEqual(a[k].coupesSansBulle, [], `${k} : un texte coupé a son entier en info-bulle`); assert.equal(a[k].images, 0, `${k} : aucune image dessinée`);
      }
      assert.ok(a.scenes.texte.includes('Soir A')); assert.ok(a.scenes.texte.includes('<img') || a.scenes.plus, 'le nom piégé : du texte');
      assert.match(a.bandeau.texte, /1 serrure ouverte/); assert.doesNotMatch(a.bandeau.texte, /inconnu_du_dessin|alarme|musique/i);
      assert.match(a.maison.texte, /3\s*pièces/);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-ensemble-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, la plus petite taille de chacun, de 320 à 1920 px (768 compris), et un thème de verre : rien ne sort de sa carte, « et N de plus » dit le reste', { skip: sansNav }, async () => {
  const va = valhallaOf()!;
  await regler(true, true);
  try {
    for (const [largeur, verre] of [[320, false], [768, false], [1280, false], [1920, false], [1280, true]] as const) {
      if (verre && !(await va.act('apparence', 'theme', { theme: 'glace' })).ok) continue;
      const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
      try {
        const a = await vu(p);
        assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
        for (const k of Object.keys(ID)) {
          assert.deepEqual(a[k].dehors, [], `${largeur} : ${k} reste dans sa carte`); assert.deepEqual(a[k].petits, [], `${largeur} : ${k}, cibles de 44 px`);
          assert.deepEqual(a[k].coupesSansBulle, [], `${largeur} : ${k}, un texte coupé a son entier en info-bulle`);
        }
        // Le bandeau montre toujours au moins une puce (la plus pressante, coupée avec son entier en info-bulle s'il le faut) ; le reste est compté.
        assert.match(a.bandeau.texte, /1 serrure ouverte/); assert.ok(a.bandeau.vues >= 1, `${largeur} : au moins une puce se voit (${a.bandeau.plus})`);
        if (largeur >= 1280) assert.ok(a.maison.vues >= 1, `${largeur} : « ma maison » montre au moins une étiquette (${a.maison.plus})`);
        if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-ensemble-mini-${largeur}${verre ? '-verre' : ''}.png`, fullPage: true });
        assert.deepEqual(erreurs, []);
      } finally { await ctx.close(); if (verre) await va.act('apparence', 'theme', { theme: 'valhalla' }); }
    }
  } finally { await regler(true); }
});

const SCENES_8 = () => ({ etat: 'ok', at: Date.now(), donnee: { scenes: ['Soir A', 'Départ B', 'Matin C', 'Nuit D', 'Repas E', 'Lecture F', 'Ménage G', 'Retour H'].map((nom, i) => ({ nom, etapes: i + 1, ouvre: i === 1 })), total: 8, lancer: true } });
test('navigateur, 1280 px, huit scènes à la taille de départ : les six qu\'elle montre (comme la maquette, 4 × 3), sans rangée perdue', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false, { ...FORCES, [ID.scenes]: SCENES_8 });
  try {
    const a = await vu(p);
    assert.deepEqual(a.scenes.dehors, []); assert.equal(a.scenes.vues, 6, `six scènes se voient (${a.scenes.vues} vues, ${a.scenes.plus})`);
    assert.equal(a.scenes.plus, 'et 2 de plus'); assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, la plus petite taille, sans scène et sans appareil : le bouton tient dans la carte ou n\'est pas montré, la phrase dit où les créer', { skip: sansNav }, async () => {
  await regler(true, true);
  try {
    for (const [largeur, sombre] of [[768, true], [768, false], [320, false], [1280, false]] as const) {
      const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre, { [ID.scenes]: () => ({ etat: 'vide', raison: 'aucune_scene' }), [ID.maison]: () => ({ etat: 'vide', raison: 'aucun_appareil' }), [ID.bandeau]: FORCES[ID.bandeau] });
      try {
        const a = await vu(p);
        for (const k of ['scenes', 'maison'] as const) { assert.deepEqual(a[k].dehors, [], `${largeur} : ${k} reste dans sa carte`); assert.deepEqual(a[k].petits, [], `${largeur} : ${k}, cibles de 44 px`); }
        assert.match(a.scenes.texte, /Aucune scène\. Crée-les dans Odin/);
        assert.deepEqual(erreurs, []);
      } finally { await ctx.close(); }
    }
  } finally { await regler(true); }
});

test('navigateur, mode « Modifier » : un appui sur une scène n\'envoie rien ; hors de ce mode, il part', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  const envois: string[] = [];
  try {
    await p.route(/\/api\/maison\/scene/, async (r: any) => { envois.push(r.request().postData() ?? ''); await r.fulfill({ json: { ok: true, text: '🎬 Soir A\n✓ a' } }); });
    const appui = () => p.evaluate((id: string) => { const b = [...document.querySelectorAll(`#feGrid .fe-w[data-id="${id}"] button.wme-sc`)].find((x: any) => x.textContent.includes('Soir A')); b.click(); }, ID.scenes);
    await p.evaluate(() => document.querySelector('#fenetre').classList.add('fe-edit'));
    await appui(); await new Promise((f) => setTimeout(f, 600));
    assert.deepEqual(envois, [], 'en mode « Modifier », rien ne part');
    await p.evaluate(() => document.querySelector('#fenetre').classList.remove('fe-edit'));
    await appui(); await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.scenes}"] .wme-dit:has-text("lancée")`, { timeout: 10000 });
    assert.equal(envois.length, 1, 'hors de ce mode, un envoi'); assert.deepEqual(JSON.parse(envois[0]), { scene: 'Soir A' });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
