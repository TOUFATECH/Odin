// Les petits chiffres de la maison (maquette validée « Accueil ») : six sortes de plus dans la famille « maison »
// (src/valhalla/widgets/maison.ts, src/web/pages/widgets-maison.js), lues sur les appareils que l'écran de la maison
// reçoit déjà (etat.rooms de /api/maison/etat : les appareils de Constellation et des box reliées, par Midgard).
// - Les appareils allumés, les lumières allumées (sur le vrai nombre de lumières), les serrures verrouillées (seulement
//   les serrures : un capteur de porte n'est pas compté), la température et l'humidité (une moyenne, dite « moyenne de
//   N capteurs », ou la pièce de l'unique capteur), et les watts : ce que mesurent les prises, rien d'autre.
// - Une mesure n'est jamais inventée : un appareil hors ligne ou muet depuis plus de 24 h n'entre pas dans le chiffre, et
//   le widget le dit ; sans appareil : l'état « vide » (jamais un 0 à la place d'une absence) ; un vrai zéro s'affiche.
// - Qui voit quoi : le propriétaire ; une tablette « maison » (elle reçoit déjà ces appareils de l'écran de la maison) ;
//   jamais un membre (l'écran de la maison ne lui donne rien), ni une clé d'accès, ni une requête sans session.
// - Le navigateur : 1280 px clair, 390 px sombre, puis 320, 768 et 1920 px et un thème de verre : rien ne déborde.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import * as A from '../src/valhalla/modules/appareils.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { admiseALaMaison, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), MAISON = lire('src/web/pages/widgets-maison.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const SORTES = ['maison_allumes', 'maison_lumieres', 'maison_serrures', 'maison_temperature', 'maison_humidite', 'maison_watts'] as const;
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'd3700000', kind, w: 1, c: 2, r: 1, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, LUI_MAISON: Lecteur = { qui: 'proprietaire', ecran: 'maison' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000, MIN = 60_000, H = 3_600_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number; appli?: string };
/**
 * L'état d'un widget. Le propriétaire sur l'accueil reçoit en plus, pour « Température » et « Humidité », la liste des
 * choix de « Régler » (vérifiée à part : « la liste des choix », plus bas) ; ici, elle n'est admise que là, puis retirée
 * pour comparer l'état lui-même.
 */
const etat = async (w: Widget, l: Lecteur, src: SourceWidget): Promise<Etat> => {
  const e = (await donneeWidget(w, l, src)) as Etat & { choix?: unknown };
  if (!('choix' in e)) return e;
  assert.ok(l.qui === 'proprietaire' && l.ecran === 'accueil' && ['maison_temperature', 'maison_humidite'].includes(w.kind) && Array.isArray(e.choix), `liste des choix servie à ${l.qui} sur ${l.ecran} pour ${w.kind}`);
  const { choix: _c, ...reste } = e; return reste as Etat;
};

/** Un appareil tel que la source le rend (ce que l'écran de la maison reçoit, plus son état en ligne et sa dernière nouvelle). */
type Ap = { ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; enLigne?: boolean; vuA?: number; liens?: string[] };
const ap = (sorte: string, etat: string, o: Partial<Ap> = {}): Ap => ({ ids: `zb_${sorte}`, piece: 'Pièce A', sorte, etat, unite: '', marche: '', arret: '', vuA: MAINT - 2 * MIN, ...o });
/** Une fausse source : Midgard (l'appli lue), les appareils, les unités d'Odin ; `espions` note chaque lecture. */
function fausse(appareils: Ap[] | undefined, o: { unites?: 'metrique' | 'imperial'; sansMidgard?: boolean; espions?: string[] } = {}): SourceWidget {
  return {
    appli: (id) => (id === 'midgard' && !o.sansMidgard ? { id, name: 'Appli maison', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    appareilsMaison: async () => { o.espions?.push('appareils'); return appareils ? { unites: o.unites ?? 'metrique', appareils } : undefined; },
  } as SourceWidget;
}
/** Le jeu d'essai, compté à la main dans chaque essai. */
const JEU = (): Ap[] => [
  ap('lumière', 'ON', { marche: 'ON', arret: 'OFF' }), ap('lumière', 'OFF', { marche: 'ON', arret: 'OFF' }), ap('lumière', 'on'),
  ap('lumière', 'ON', { enLigne: false }), // hors ligne : pas comptée allumée, dite « sans nouvelles »
  ap('prise', 'ON', { liens: ['m/b'] }), ap('prise', 'off', { liens: ['m/four'] }), ap('prise', 'ON', { vuA: MAINT - 25 * H, liens: ['m/seche'] }), // muette depuis plus de 24 h
  ap('clim', 'cool'), ap('lecteur', 'idle'), ap('volet', 'open'), ap('détecteur', 'ON'), ap('bouton', 'ON'),
  ap('clim', '21'), // une clim qui publie un nombre : en ligne, d'état inconnu (pas « sans nouvelles »)
  ap('serrure', 'LOCKED'), ap('serrure', 'unlocked'), ap('serrure', ''), ap('serrure', 'locked', { enLigne: false }), ap('serrure', 'jammed'),
  ap('capteur', '21.5', { unite: '°C', piece: 'Salon', ids: 'zb_salon_temperature' }), ap('capteur', '23.5', { unite: '°C', ids: 'zb_chambre_temperature', vuA: MAINT - 30 * MIN }),
  ap('capteur', '68', { unite: '°F', ids: 'zb_bureau_temperature' }), ap('capteur', '40', { unite: '°C', ids: 'zb_vieux_temperature', vuA: MAINT - 25 * H }),
  ap('capteur', '30', { unite: '°C', ids: 'zb_hors_temperature', enLigne: false }), ap('capteur', 'unavailable', { unite: '°C', ids: 'zb_muet_temperature' }),
  ap('capteur', '47', { unite: '°C', ids: 'tasmota_0C_ESP32_Temperature ESP32.Temperature' }), // la puce d'un module, pas la maison : jamais comptée
  ap('capteur', '55', { unite: '%', ids: 'zb_salon_humidity' }), ap('capteur', '61', { unite: '%', ids: 'tasmota_0A_AM2301_Humidity' }), ap('capteur', '90', { unite: '%', ids: 'zb_salon_battery' }),
  ap('capteur', '100.4', { unite: 'W', ids: 'tasmota_0B_ENERGY_Power', liens: ['m/b'] }), ap('capteur', '0.2', { unite: 'kW', ids: 'zb_four_power', liens: ['m/four'] }), ap('capteur', '3.2', { unite: 'kWh', ids: 'tasmota_0B_ENERGY_Today', liens: ['m/b'] }),
  ap('capteur', '900', { unite: 'W', ids: 'zb_seche_power', enLigne: false, liens: ['m/seche'] }), ap('lumière', '', { unite: 'W' }),
  // Un compteur de toute la maison (une box reliée) et un capteur en W relié à aucune prise : jamais additionnés.
  ap('capteur', '5000', { unite: 'W', ids: 'compteur_maison_power' }), ap('capteur', '700', { unite: 'W', ids: 'zb_autre_power', liens: ['m/sans-prise'] }),
];

// ------------------------------------------------------------------ le serveur, avec une fausse source

test('les six sortes : famille « maison », Midgard lue, public « maison », petit chiffre 2 × 1, posables', () => {
  for (const k of SORTES) {
    const s = sorteDe(k)!;
    assert.ok(s, k); assert.equal(s.famille, 'maison', k); assert.deepEqual(s.applis, ['midgard'], k); assert.equal(publicDe(s), 'maison', k);
    assert.deepEqual([[...s.taille.mini], s.taille.r], [[2, 1], 1], k); assert.equal(s.posable, true, k); assert.deepEqual(TAILLE_SORTE[k as keyof typeof TAILLE_SORTE], { mini: [2, 1], r: 1 }, k);
    assert.equal(admiseALaMaison(k), true, `${k} : admise à l'écran de la maison (comme le bouton)`);
  }
});

test('chaque chiffre est le bon (compté à la main) ; hors ligne et muet n\'entrent pas ; plusieurs capteurs : « moyenne de N »', async () => {
  const src = fausse(JEU()), d = async (k: string) => { const e = await etat(W(k), LUI, src); assert.equal(e.etat, 'ok', `${k} : ${JSON.stringify(e)}`); return e; };
  // Allumables : 4 lumières, 3 prises, 2 clims, le lecteur, la lumière sans état (11). En marche : 2 lumières, 1 prise, la clim (4).
  // Sans nouvelles : la lumière hors ligne, la prise muette, la lumière sans état (3). En ligne mais d'un état qu'Odin ne lit
  // pas : la clim qui dit « 21 » (1, « inconnus », jamais « sans nouvelles »). Le volet, le détecteur, le bouton : pas comptés.
  assert.deepEqual((await d('maison_allumes')).donnee, { n: 4, sur: 11, muets: 3, inconnus: 1 });
  // Lumières : 5 en tout (dont celle sans état), 2 allumées, 2 sans nouvelles.
  assert.deepEqual((await d('maison_lumieres')).donnee, { n: 2, sur: 5, muets: 2 });
  // Serrures : 5 ; 1 verrouillée, 1 ouverte, 2 sans nouvelles (vide ; hors ligne), 1 d'état inconnu (« jammed » : bloquée).
  assert.deepEqual((await d('maison_serrures')).donnee, { n: 1, sur: 5, ouvertes: 1, muets: 2, inconnus: 1 });
  // Température : 21,5 °C, 23,5 °C et 68 °F (20 °C) ; écartés : la vieille, la hors ligne, l'illisible. Moyenne 21,7.
  const t = await d('maison_temperature');
  assert.deepEqual(t.donnee, { valeur: 21.7, unite: 'C', n: 3, ecartes: 3 }); assert.equal(t.at, MAINT - 30 * MIN, 'l\'âge vrai : la plus vieille mesure comptée');
  // Humidité : 55 et 61 (le niveau de pile en % n'est pas une humidité). Moyenne 58.
  assert.deepEqual((await d('maison_humidite')).donnee, { valeur: 58, n: 2, ecartes: 0 });
  // Watts : 100,4 W + 0,2 kW = 300 W ; ni l'énergie (kWh), ni la prise hors ligne (écartée), ni une lumière qui dit « W »,
  // ni le compteur de toute la maison, ni un capteur en W relié à aucune prise : seulement ce que mesurent les prises.
  assert.deepEqual((await d('maison_watts')).donnee, { valeur: 300, n: 2, ecartes: 1 });
  // Sans prise : un capteur en W n'est pas « ce que mesurent les prises » ; rien n'est montré.
  assert.deepEqual(await etat(W('maison_watts'), LUI, fausse([ap('capteur', '5000', { unite: 'W', ids: 'compteur_maison_power' })])), { etat: 'vide', raison: 'aucun_appareil' });
  // La puce d'un module (ESP32) seule : pas une température de la maison.
  assert.deepEqual(await etat(W('maison_temperature'), LUI, fausse([ap('capteur', '47', { unite: '°C', ids: 'tasmota_0C_ESP32_Temperature ESP32.Temperature' })])), { etat: 'vide', raison: 'aucun_appareil' });
});

test('un seul capteur : sa pièce (jamais un nom d\'appareil) ; degrés Fahrenheit si Odin est réglé ainsi', async () => {
  const un = [ap('capteur', '22', { unite: '°C', piece: '<img src=x onerror=alert(1)>', ids: 'zb_t' })];
  assert.deepEqual((await etat(W('maison_temperature'), LUI, fausse(un))).donnee, { valeur: 22, unite: 'C', n: 1, ecartes: 0, piece: '<img src=x onerror=alert(1)>' });
  assert.deepEqual((await etat(W('maison_temperature'), LUI, fausse(un, { unites: 'imperial' }))).donnee, { valeur: 71.6, unite: 'F', n: 1, ecartes: 0, piece: '<img src=x onerror=alert(1)>' });
  // Une mesure sans heure (l'entité d'une box reliée) : son âge n'est pas inventé (« ageInconnu »), jamais « à l'instant ».
  const sansHeure = await etat(W('maison_temperature'), LUI, fausse([ap('capteur', '22', { unite: '°C', ids: 'zb_t', vuA: undefined }), ap('capteur', '20', { unite: '°C', ids: 'zb_u' })]));
  assert.deepEqual(sansHeure.donnee, { valeur: 21, unite: 'C', n: 2, ecartes: 0, ageInconnu: true });
  // Sans pièce : rien d'inventé.
  assert.deepEqual((await etat(W('maison_humidite'), LUI, fausse([ap('capteur', '47', { unite: '%', piece: '', ids: 'zb_humidity' })]))).donnee, { valeur: 47, n: 1, ecartes: 0 });
});

test('zéro appareil : « vide », sans un chiffre ; un vrai zéro s\'affiche ; tout muet : pas de chiffre', async () => {
  for (const k of SORTES) {
    const e = await etat(W(k), LUI, fausse([]));
    assert.deepEqual(e, { etat: 'vide', raison: 'aucun_appareil' }, k);
    // Des appareils, mais aucun de cette sorte : « vide » aussi.
    const autre = await etat(W(k), LUI, fausse([ap('bouton', 'ON')]));
    assert.deepEqual(autre, { etat: 'vide', raison: 'aucun_appareil' }, `${k}, seulement un bouton`);
  }
  // 0 lumière allumée sur 6 : un vrai zéro, rendu.
  const nuit = Array.from({ length: 6 }, () => ap('lumière', 'OFF'));
  assert.deepEqual((await etat(W('maison_lumieres'), LUI, fausse(nuit))).donnee, { n: 0, sur: 6, muets: 0 });
  assert.deepEqual((await etat(W('maison_allumes'), LUI, fausse(nuit))).donnee, { n: 0, sur: 6, muets: 0 });
  // 0 W mesuré par une prise : un vrai zéro (la pièce de l'unique prise, que l'écran de la maison reçoit déjà).
  assert.deepEqual((await etat(W('maison_watts'), LUI, fausse([ap('prise', 'OFF', { liens: ['m/p'] }), ap('capteur', '0', { unite: 'W', liens: ['m/p'] })]))).donnee, { valeur: 0, n: 1, ecartes: 0, piece: 'Pièce A' });
  // Tous les capteurs hors ligne ou muets : aucun chiffre (jamais la dernière valeur, jamais 0).
  for (const [k, u, ids] of [['maison_temperature', '°C', 'zb_temperature'], ['maison_humidite', '%', 'zb_humidity'], ['maison_watts', 'W', 'zb_power']]) {
    const e = await etat(W(k), LUI, fausse([ap('prise', 'ON', { liens: ['m/p'] }), ap('capteur', '20', { unite: u, ids, enLigne: false, liens: ['m/p'] }), ap('capteur', '21', { unite: u, ids, vuA: MAINT - 2 * 24 * H, liens: ['m/p'] })]));
    assert.deepEqual(e, { etat: 'vide', raison: 'mesures_muettes' }, k);
  }
  // Une valeur invraisemblable n'est pas une mesure.
  assert.deepEqual(await etat(W('maison_humidite'), LUI, fausse([ap('capteur', '140', { unite: '%', ids: 'zb_humidity' })])), { etat: 'vide', raison: 'mesures_muettes' });
});

test('Midgard absente ou muette : rien n\'est lu, aucun chiffre', async () => {
  const espions: string[] = [];
  for (const k of SORTES) {
    assert.deepEqual(await etat(W(k), LUI, fausse(JEU(), { sansMidgard: true, espions })), { etat: 'source_absente', raison: 'appli_absente' }, k);
    assert.deepEqual(await etat(W(k), LUI, fausse(undefined)), { etat: 'source_absente', raison: 'appli_muette' }, k);
  }
  assert.deepEqual(espions, [], 'Midgard absente : aucune lecture');
});

test('qui voit quoi : lui et une tablette « maison » oui ; un membre jamais (même avec le droit sur Midgard), sans une lecture', async () => {
  for (const k of SORTES) {
    const espions: string[] = [], src = fausse(JEU(), { espions });
    for (const l of [LUI, LUI_MAISON, TABLETTE]) assert.equal((await etat(W(k), l, src)).etat, 'ok', `${k} : ${l.qui} sur ${l.ecran}`);
    espions.length = 0;
    assert.deepEqual(await etat(W(k), membre(['midgard', 'gladsheim']), src), { etat: 'refuse', raison: 'proprietaire_seul' }, `${k} : un membre avec le droit`);
    assert.deepEqual(await etat(W(k), membre(['gladsheim']), src), { etat: 'refuse', raison: 'appli_fermee', appli: 'midgard' }, `${k} : un membre sans le droit`);
    assert.deepEqual(espions, [], `${k} : rien n'est lu pour un membre`);
  }
});

test('« Température » et « Humidité », la liste des choix de « Régler » : les pièces et les capteurs de CETTE mesure, au propriétaire sur l\'accueil seul ; une pièce choisie n\'est plus la moyenne', async () => {
  type AvecChoix = { etat: string; donnee?: Record<string, unknown>; choix?: Array<Record<string, unknown>> };
  const a = (id: string, piece: string, etatLu: string, unite: string, ids: string, o: Partial<Ap> = {}) => ({ ...ap('capteur', etatLu, { unite, ids, piece, ...o }), id, nom: `Sonde ${id}` });
  const jeu = [a('t1', 'Salon', '21.5', '°C', 'zb_salon_temperature'), a('t2', 'Chambre', '19.5', '°C', 'zb_chambre_temperature'), a('t3', 'Chambre', '30', '°C', 'zb_vieux_temperature', { enLigne: false }),
    a('puce', 'Salon', '47', '°C', 'tasmota_0C_ESP32_Temperature ESP32.Temperature'), a('h1', 'Salon', '40', '%', 'zb_salon_humidity'), a('b1', 'Salon', '90', '%', 'zb_salon_battery'),
    { ...ap('lumière', 'ON', { piece: 'Bureau' }), id: 'l1', nom: 'Lampe' }];
  const src = fausse(jeu as Ap[]), brut = async (k: string, l: Lecteur, cible?: string) => (await donneeWidget(W(k, cible ? { cible } : {}), l, src)) as unknown as AvecChoix;
  const t = await brut('maison_temperature', LUI);
  assert.deepEqual(t.choix, [{ cible: 'piece:Salon', nom: 'Salon' }, { cible: 'piece:Chambre', nom: 'Chambre' },
    { cible: 'appareil:t1', nom: 'Sonde t1', piece: 'Salon', sorte: 'capteur' }, { cible: 'appareil:t2', nom: 'Sonde t2', piece: 'Chambre', sorte: 'capteur' }, { cible: 'appareil:t3', nom: 'Sonde t3', piece: 'Chambre', sorte: 'capteur', horsLigne: true }],
  'les pièces qui ont un capteur de température, puis ces capteurs (hors ligne compris et dit) ; ni la puce d\'un module, ni une lumière, ni une humidité');
  assert.deepEqual((await brut('maison_humidite', LUI)).choix, [{ cible: 'piece:Salon', nom: 'Salon' }, { cible: 'appareil:h1', nom: 'Sonde h1', piece: 'Salon', sorte: 'capteur' }], 'humidité : jamais le niveau d\'une pile');
  // Le chiffre suit le choix : la moyenne de tous, puis la pièce, puis un capteur.
  assert.deepEqual([t.donnee!.valeur, t.donnee!.n], [20.5, 2]);
  assert.deepEqual([(await brut('maison_temperature', LUI, 'piece:Salon')).donnee!.valeur, (await brut('maison_temperature', LUI, 'piece:Chambre')).donnee!.valeur, (await brut('maison_temperature', LUI, 'appareil:t2')).donnee!.valeur], [21.5, 19.5, 19.5]);
  assert.ok((await brut('maison_temperature', LUI, 'piece:Salon')).choix!.length === 5, 'choisi : la liste reste, pour changer');
  // À personne d'autre ; et jamais pour les autres petits chiffres.
  for (const k of ['maison_temperature', 'maison_humidite']) for (const l of [LUI_MAISON, TABLETTE, membre(['midgard', 'gladsheim'])]) assert.ok(!('choix' in await brut(k, l)), `${k} : ${l.qui} sur ${l.ecran}`);
  for (const k of ['maison_allumes', 'maison_lumieres', 'maison_serrures', 'maison_watts']) assert.ok(!('choix' in await brut(k, LUI)), k);
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare (six petits chiffres, Midgard, 2 × 1) ; la grille connaît leurs tailles ; les mots', () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [MAISON, RENDU, GRILLE]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, M = win.OdinWidgetsMaison, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  assert.ok(M, 'window.OdinWidgetsMaison');
  for (const k of SORTES) {
    const x = R.rendu(k);
    assert.ok(x, k); assert.deepEqual([x.famille, x.appli, x.petit, x.proprio, x.w.c, x.w.r], ['maison', 'midgard', true, false, 2, 1], k);
    assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
    assert.ok(x.vides.includes('aucun_appareil'), `${k} dessine lui-même « aucun appareil »`);
  }
  // Le capteur ou la pièce choisis dans « Régler », retirés d'Odin : la carte le dit elle-même, jamais « aucun capteur ».
  for (const k of ['maison_temperature', 'maison_humidite']) for (const r of ['appareil_absent', 'piece_absente']) assert.ok(R.rendu(k).vides.includes(r), `${k} : ${r}`);
  assert.match(M.TEXTES.mesure.parti, /n'existe plus/); assert.match(M.TEXTES.mesure.partie, /pièce/);
  assert.deepEqual(ici(R.posables({ proprio: true, aDroit: () => true }).filter((x: any) => x.famille === 'maison' && x.sorte !== 'bouton').map((x: any) => x.nom)),
    ['Appareils allumés', 'Lumières allumées', 'Serrures', 'Température', 'Humidité', 'Watts des prises']);
  // Les mots : les watts disent qu'ils sont ceux des prises ; une moyenne est dite ; les serrures disent ce qui est compté.
  const T = M.TEXTES;
  assert.match(T.watts.qui(2), /2 prises/); assert.match(T.watts.qui(1), /1 prise\b/); assert.match(T.watts.quoi, /prises/);
  assert.match(T.mesure.moyenne(3), /[Mm]oyenne de 3 capteurs/); assert.match(T.serrures.quoi, /serrures/); assert.match(T.serrures.quoi, /porte/);
  assert.match(T.lumieres.dit(0, 6), /^0 .* 6/);
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont) ; ni langue ni fuseau écrits.
  assert.deepEqual([...MAISON.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(o.icone)']);
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone`).test(MAISON), 'aucune langue ni aucun fuseau écrits');
  // Les nombres dans la langue de la page.
  assert.equal(M.nombre(21.7, 'fr'), '21,7'); assert.equal(M.nombre(21.7, 'en'), '21.7'); assert.equal(M.nombre(1234, 'fr').replace(/\s/g, ' '), '1 234');
});

// ------------------------------------------------------------------ un vrai Odin d'essai, de faux appareils sur le relais

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme-48';
const IDS = ['gladsheim', 'midgard', 'var'];
const PAGE = 'b3700001', PAGE_MAISON = 'b3700002', PIEGE = '<img src=x onerror="window.__pirate=1">';
const ID = { allumes: 'd3700001', lumieres: 'd3700002', serrures: 'd3700003', temperature: 'd3700004', humidite: 'd3700005', watts: 'd3700006',
  // Forcés dans la réponse pour le navigateur : un vrai zéro, aucun appareil, tout muet, un capteur dans une pièce piégée, des serrures ouvertes.
  zero: 'd3700007', vide: 'd3700008', muet: 'd3700009', piece: 'd370000a', ouverte: 'd370000b', ecartes: 'd370000c' };
const KIND: Record<string, string> = { allumes: 'maison_allumes', lumieres: 'maison_lumieres', serrures: 'maison_serrures', temperature: 'maison_temperature', humidite: 'maison_humidite', watts: 'maison_watts',
  zero: 'maison_lumieres', vide: 'maison_temperature', muet: 'maison_humidite', piece: 'maison_temperature', ouverte: 'maison_serrures', ecartes: 'maison_watts' };
const FENETRE = (avecLesMiens: boolean) => ({ pages: [
  // Posés comme le tiroir les pose (2 × 1, une ligne au téléphone aussi).
  { id: PAGE, name: 'Maison', widgets: avecLesMiens ? Object.entries(ID).map(([k, id]) => ({ id, kind: KIND[k], w: 1, c: 2, r: 1, pr: 1 })) : [] },
  { id: PAGE_MAISON, name: 'Au mur', maison: true, widgets: avecLesMiens ? [{ id: 'd3700010', kind: 'maison_lumieres', w: 1, c: 2, r: 1 }, { id: 'd3700011', kind: 'maison_temperature', w: 1, c: 2, r: 1 }] : [] },
] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; at?: number; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
/** Ce que l'écran de la maison reçoit (sans son heure, ni Odin du jour, qui changent d'une lecture à l'autre). */
const ecranMaison = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); const { at: _a, mascotte: _m, ...reste } = r.body; return { status: r.status, reste }; };
const regler = async (avec: boolean) => { const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined }); const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE(avec)) }); assert.equal(r.ok, true, r.text); };

// Le relais d'essai (Constellation), avec son horloge : de faux appareils s'y annoncent et y publient leur état.
const horloge = { t: Date.now() }, reglages: Record<string, unknown> = { port: 0 };
const ctxRelais = { home: '', dir: '', settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), alert: () => {}, emit: () => {}, now: () => new Date(horloge.t) } as unknown as ModCtx;
const annonce = (type: string, obj: string, c: Record<string, unknown>) => A.brokerOf()!.publish(`decouverte/${type}/essai/${obj}/config`, JSON.stringify({ unique_id: `essai_${obj}`, name: `Appareil ${obj}`, state_topic: `essai/${obj}/etat`, ...c }));
const etatDe = (obj: string, x: string) => A.brokerOf()!.publish(`essai/${obj}/etat`, x);

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin, AVEC le droit sur Midgard.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-m', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  // Le relais et ses faux appareils (comptés à la main dans les essais).
  process.env.MQTT_PASSWORD = 'relais-de-test';
  await A.appareils.start!(ctxRelais);
  const dispo = (obj: string) => ({ availability_topic: `essai/${obj}/dispo`, payload_available: 'online' });
  annonce('light', 'l1', { device: { suggested_area: 'Salon' } }); annonce('light', 'l2', {}); annonce('light', 'l3', { device: { suggested_area: PIEGE } }); annonce('light', 'l4', dispo('l4'));
  // Deux prises qui mesurent (comme un module Zigbee : la prise et sa puissance sur le même sujet, des clés à part).
  const json = (k: string) => ({ value_template: `{{ value_json.${k} }}` });
  annonce('switch', 'p1', json('state')); annonce('switch', 'p2', json('state'));
  annonce('lock', 'k1', {}); annonce('lock', 'k2', {}); annonce('lock', 'k3', {});
  annonce('binary_sensor', 'd1', {});
  for (const [obj, u] of [['t1', '°C'], ['t2', '°C'], ['t3', '°F'], ['t4', '°C']]) annonce('sensor', `${obj}_temperature`, { unit_of_measurement: u, device: { suggested_area: PIEGE } });
  annonce('sensor', 't5_temperature', { unit_of_measurement: '°C', ...dispo('t5') });
  annonce('sensor', 'h1_humidity', { unit_of_measurement: '%' }); annonce('sensor', 'h2_battery', { unit_of_measurement: '%' }); annonce('sensor', 'h3_humidity', { unit_of_measurement: '%' });
  const surPrise = (p: string, k: string) => ({ state_topic: `essai/${p}/etat`, ...json(k) });
  annonce('sensor', 'w1_power', { unit_of_measurement: 'W', ...surPrise('p1', 'power') }); annonce('sensor', 'w2_power', { unit_of_measurement: 'kW', ...surPrise('p2', 'power_kw') });
  annonce('sensor', 'w3_energy', { unit_of_measurement: 'kWh', ...surPrise('p1', 'energy') }); annonce('sensor', 'w4_power', { unit_of_measurement: 'W', ...surPrise('p2', 'power2'), ...dispo('w4') });
  // Un compteur de toute la maison, en W, sur son propre sujet : il n'est pas une prise, jamais additionné aux prises.
  annonce('sensor', 'w5_power', { unit_of_measurement: 'W' });
  // Une mesure vieille de 25 h (l'horloge du relais recule le temps de la publier).
  horloge.t = Date.now() - 25 * H; etatDe('t4_temperature', '40'); horloge.t = Date.now();
  etatDe('l1', 'ON'); etatDe('l2', 'OFF'); etatDe('l3', 'ON'); etatDe('l4', 'ON'); A.brokerOf()!.publish('essai/l4/dispo', 'offline');
  etatDe('p1', JSON.stringify({ state: 'ON', power: 100.4, energy: 3.2 })); etatDe('p2', JSON.stringify({ state: 'OFF', power_kw: 0.2, power2: 900 })); etatDe('w5_power', '5000');
  etatDe('k1', 'LOCKED'); etatDe('k2', 'UNLOCKED'); etatDe('d1', 'ON');
  etatDe('t1_temperature', '21.5'); etatDe('t2_temperature', '23.5'); etatDe('t3_temperature', '68'); etatDe('t5_temperature', '30'); A.brokerOf()!.publish('essai/t5/dispo', 'offline');
  etatDe('h1_humidity', '55'); etatDe('h2_battery', '90'); etatDe('h3_humidity', '61');
  A.brokerOf()!.publish('essai/w4/dispo', 'offline');
  await regler(true);
});
after(async () => { A.appareils.stop!(); delete process.env.MQTT_PASSWORD; await tt.end(); Object.assign(console, orig); });

test('vrai Odin, faux appareils sur le relais : chaque chiffre est le bon ; rien d\'un nom ni d\'une pièce, hors la pièce d\'un capteur seul', async () => {
  const brut = await donnees();
  // La liste des choix de « Régler » (« Température », « Humidité ») est au propriétaire seul, à part du chiffre : elle
  // est vérifiée dans « la liste des choix », plus bas, puis retirée ici pour vérifier que le chiffre ne dit ni nom ni pièce.
  const sans = JSON.parse(brut.corps) as { widgets: Array<Rendue & { kind: string; choix?: unknown }> };
  for (const w of sans.widgets) if ('choix' in w) { assert.ok(['maison_temperature', 'maison_humidite'].includes(w.kind), w.kind); delete w.choix; }
  const lui = { ...brut, corps: JSON.stringify(sans) };
  assert.equal(lui.status, 200);
  const d = (k: keyof typeof ID) => { const e = lui.de(ID[k])!; assert.equal(e.etat, 'ok', `${k} : ${JSON.stringify(e)}`); return e.donnee; };
  // Allumables : 4 lumières et 2 prises. En marche : l1, l3, p1. Sans nouvelles : l4 (hors ligne).
  assert.deepEqual(d('allumes'), { n: 3, sur: 6, muets: 1 });
  assert.deepEqual(d('lumieres'), { n: 2, sur: 4, muets: 1 });
  // Serrures : k1 verrouillée, k2 ouverte, k3 sans état. Le détecteur de porte n'est pas compté.
  assert.deepEqual(d('serrures'), { n: 1, sur: 3, ouvertes: 1, muets: 1 });
  // 21,5 ; 23,5 ; 68 °F = 20 → 21,7 °C ; écartés : t4 (25 h) et t5 (hors ligne).
  assert.deepEqual(d('temperature'), { valeur: 21.7, unite: 'C', n: 3, ecartes: 2 });
  assert.deepEqual(d('humidite'), { valeur: 58, n: 2, ecartes: 0 });
  assert.deepEqual(d('watts'), { valeur: 300, n: 2, ecartes: 1 });
  for (const mot of ['Appareil ', 'Salon', 'essai_', 'onerror']) assert.ok(!lui.corps.includes(mot), `ni nom, ni pièce, ni identifiant : ${mot}`);
});

test('vrai Odin : un membre (même avec le droit sur Midgard), une tablette, une clé d\'accès, sans session : rien de plus qu\'avant', async () => {
  // Le membre : chaque petit chiffre refusé, sans une valeur.
  const m = await donnees({ cookie: avecDroit });
  assert.equal(m.status, 200);
  for (const id of Object.values(ID)) { const e = m.de(id)!; assert.deepEqual([e.etat, e.raison, 'donnee' in e], ['refuse', 'proprietaire_seul', false], id); }
  assert.ok(!/"n":|"valeur":|"sur":/.test(m.corps), 'aucun chiffre de la maison');
  // Par les widgets : la tablette, la clé d'accès, sans session, refusées comme avant.
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h); assert.equal(r.status, 401, qui); assert.ok(!/"valeur"|"sur"/.test(r.corps), qui);
  }
  // L'écran de la maison, avant et après (les mêmes appareils ; avec et sans ces widgets posés sur la page « au mur ») :
  // la tablette, le membre, la clé d'accès et sans session reçoivent exactement la même chose.
  const qui = { tablette: { cookie: '', 'x-odin-maison': cleMaison }, membre: { cookie: avecDroit }, cle: { cookie: '', authorization: `Bearer ${v.token}` }, sans: { cookie: '' } };
  const apres: Record<string, unknown> = {}; for (const [k, h] of Object.entries(qui)) apres[k] = await ecranMaison(h);
  await regler(false);
  try { for (const [k, h] of Object.entries(qui)) assert.deepEqual(apres[k], await ecranMaison(h), `${k} : l'écran de la maison ne change pas`); }
  finally { await regler(true); }
  assert.equal((apres.tablette as { status: number }).status, 200); assert.equal((apres.membre as { status: number }).status, 401);
  assert.equal((apres.sans as { status: number }).status, 401);
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>;
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
  [ID.zero]: () => ({ etat: 'ok', at: Date.now(), donnee: { n: 0, sur: 6, muets: 0 } }),
  [ID.vide]: () => ({ etat: 'vide', raison: 'aucun_appareil' }),
  [ID.muet]: () => ({ etat: 'vide', raison: 'mesures_muettes' }),
  [ID.piece]: () => ({ etat: 'ok', at: Date.now() - 12 * MIN, donnee: { valeur: 22, unite: 'C', n: 1, ecartes: 0, piece: PIEGE } }),
  [ID.ouverte]: () => ({ etat: 'ok', at: Date.now(), donnee: { n: 0, sur: 3, ouvertes: 2, muets: 0, inconnus: 1 } }),
  [ID.ecartes]: () => ({ etat: 'ok', at: Date.now(), donnee: { valeur: 12345, n: 7, ecartes: 2, ageInconnu: true } }),
};
async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (Object.hasOwn(FORCES, w.id) ? { id: w.id, kind: w.kind, page: w.page, ...FORCES[w.id]() } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { for (const id of Object.values(ID)) await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wmc`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs };
}
/** Ce que la page montre de chaque carte : la valeur, le libellé, sa taille, et ce qui serait coupé ou dehors. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), out: Record<string, any> = { deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, pirate: Boolean(window.__pirate) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    // Ce qui se VOIT d'un élément : son cadre coupé par chaque parent qui cache ce qui dépasse (jusqu'à la carte). Un
    // élément entièrement caché par un parent ne compte pas ; une partie visible doit rester dans la carte.
    const b = c.getBoundingClientRect(), vu = (n: any) => {
      let r = { l: n.getBoundingClientRect().left, t: n.getBoundingClientRect().top, rr: n.getBoundingClientRect().right, bb: n.getBoundingClientRect().bottom };
      for (let p = n.parentElement; p && p !== c.parentElement; p = p.parentElement) {
        const s = getComputedStyle(p); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect(); r = { l: Math.max(r.l, q.left), t: Math.max(r.t, q.top), rr: Math.min(r.rr, q.right), bb: Math.min(r.bb, q.bottom) };
      }
      return r;
    }, dans = (n: any) => { const r = vu(n); return r.rr - r.l <= 0 || r.bb - r.t <= 0 || (r.l >= b.left - 1 && r.rr <= b.right + 1 && r.bb <= b.bottom + 1 && r.t >= b.top - 1); };
    const vis = (n: any) => n.getClientRects().length > 0, w = c.querySelector('.wmc');
    out[nom] = {
      valeur: txt(c.querySelector('.wmc-v')),
      // La valeur se voit en entier : ni cachée par la carte, ni coupée (« 21,… »).
      valeurEntiere: (() => { const v = c.querySelector('.wmc-v'); if (!v) return true; const r = v.getBoundingClientRect(), x = vu(v); return x.bb - x.t >= r.height - 1 && x.rr - x.l >= r.width - 1 && v.scrollWidth <= v.clientWidth + 1; })(), libelle: txt(c.querySelector('.wmc-l')), titre: w?.title ?? '', dit: txt(c.querySelector('.wmc .wr-sr')), haut: Math.round(b.height),
      dedans: [...c.querySelectorAll('*')].filter(vis).every(dans), dehors: [...c.querySelectorAll('*')].filter(vis).filter((n: any) => !dans(n)).map((n: any) => { const r = n.getBoundingClientRect(); return `${n.tagName}.${n.className?.baseVal ?? n.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} / carte ${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`; }), images: c.querySelectorAll('img').length, boutons: c.querySelectorAll('button:not(.fe-chrome button):not(.fe-grip)').length,
      lien: c.querySelector('a.wmc')?.getAttribute('href') ?? '', ton: w?.dataset.ton ?? '', enTete: Boolean(c.querySelector('.wr-h')),
      // Ce que compte le chiffre (« Lumières », « 2 prises », « Moyenne de 3 capteurs ») se lit en entier, avant toute marque.
      quoi: txt(c.querySelector('.wmc-q')),
      quoiEntier: (() => { const q = c.querySelector('.wmc-q'), l = c.querySelector('.wmc-l'); if (!q || !l) return true; const x = vu(l), rg = document.createRange(); rg.selectNodeContents(q); return [...rg.getClientRects()].every((r: any) => r.width <= 0 || (r.left >= x.l - 1 && r.right <= x.rr + 1 && r.top >= x.t - 1 && r.bottom <= x.bb + 1)); })(),
      // Une phrase seule (« vide ») se lit en entier, et la carte montre qu'elle mène quelque part.
      phraseEntiere: (() => { const f = c.querySelector('.wmc-phrase'); return !f || f.scrollHeight <= f.clientHeight + 1 || `« ${txt(f)} » : ${f.scrollHeight} px de haut pour ${f.clientHeight}, ${Math.round(f.getBoundingClientRect().width)} px de large`; })(),
      aller: (() => { const g = c.querySelector('a.wmc .wmc-go'); return Boolean(g && vis(g) && g.getBoundingClientRect().width > 0); })(),
      // Aucun coin arrondi d'un parent qui cache ce qui dépasse ne rogne une ligne de texte (« 3 » entamé, « ouvelles »).
      coinsRognes: (() => {
        const out: string[] = [];
        for (const n of c.querySelectorAll('.wmc-v, .wmc-l')) {
          if (!vis(n)) continue; const rg = document.createRange(); rg.selectNodeContents(n);
          for (let p = n.parentElement; p && p !== c.parentElement; p = p.parentElement) {
            const s = getComputedStyle(p), r = parseFloat(s.borderTopLeftRadius) || 0; if (!r || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue;
            const q = p.getBoundingClientRect();
            const z = vu(n);
            for (const b0 of rg.getClientRects()) {
              // La part de la ligne qui se voit (un texte coupé par « … » dépasse de son bloc sans se voir).
              const l = { left: Math.max(b0.left, z.l), right: Math.min(b0.right, z.rr), top: Math.max(b0.top, z.t), bottom: Math.min(b0.bottom, z.bb) };
              if (l.right - l.left <= 0 || l.bottom - l.top <= 0) continue;
              // Un coin de la ligne dans le carré d'un coin arrondi, mais hors de son cercle : rogné.
              const hors = (x: number, y: number) => { const dx = Math.max(0, Math.max(q.left + r - x, x - (q.right - r))), dy = Math.max(0, Math.max(q.top + r - y, y - (q.bottom - r))); return dx > 0 && dy > 0 && dx * dx + dy * dy > r * r + 1; };
              if ([[l.left, l.top], [l.left, l.bottom], [l.right, l.top], [l.right, l.bottom]].some(([x, y]) => hors(x, y))) out.push(`${txt(n).slice(0, 30)} par ${p.className}`);
            }
          }
        }
        return out;
      })(),
      coupesSansBulle: [...c.querySelectorAll('.wmc-v, .wmc-l')].filter((n: any) => vis(n) && n.scrollWidth > n.clientWidth + 1 && !n.title && !n.closest('[title]')).map(txt),
      couleur: w ? getComputedStyle(w.querySelector('.wmc-v') ?? w).color : '',
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : les six chiffres, leur petite taille dans chaque état, un vrai zéro, « vide » qui mène à Midgard, une pièce piégée reste du texte`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.pirate, false, 'aucun script injecté');
      const hauteurs = new Set<number>();
      for (const k of Object.keys(ID)) {
        assert.ok(a[k], `${k} affichée`); assert.equal(a[k].dedans, true, `${k} reste dans sa carte : ${a[k].dehors.join(' | ')}`); assert.equal(a[k].enTete, false, `${k} : ni en-tête`);
        assert.equal(a[k].boutons, 0, `${k} : ni bouton`); assert.equal(a[k].images, 0, `${k} : aucune image`); assert.deepEqual(a[k].coupesSansBulle, [], `${k} : un texte coupé a son entier en info-bulle`); assert.equal(a[k].valeurEntiere, true, `${k} : la valeur se voit en entier`);
        // (Le nom d'une pièce, choisi par lui, peut être de toute longueur : il garde son info-bulle, il n'est pas mesuré ici.)
        if (k !== 'piece') assert.equal(a[k].quoiEntier, true, `${k} : ce que compte le chiffre se lit en entier (« ${a[k].quoi} »)`); assert.equal(a[k].phraseEntiere, true, `${k} : la phrase se lit en entier`);
        assert.deepEqual(a[k].coinsRognes, [], `${k} : aucun coin arrondi ne rogne un texte`);
        hauteurs.add(a[k].haut);
      }
      // Le libellé d'abord, la marque ensuite : on lit toujours ce que compte le chiffre.
      assert.equal(a.lumieres.quoi, 'Lumières'); assert.match(a.lumieres.libelle, /^Lumières · 1 sans nouvelles/); assert.equal(a.serrures.quoi, 'Verrouillées'); assert.match(a.serrures.libelle, /^Verrouillées · 1 ouverte/);
      assert.equal(a.watts.quoi, '2 prises'); assert.equal(a.temperature.quoi, 'Moyenne de 3 capteurs');
      // « vide » montre qu'il mène quelque part.
      assert.equal(a.vide.aller, true, '« vide » : un signe montre que la carte mène à l\'endroit où l\'on ajoute un appareil');
      assert.equal(hauteurs.size, 1, `la même petite taille dans chaque état : ${[...hauteurs]}`);
      // Les vrais chiffres (le relais d'essai), dans la langue de la page.
      assert.equal(a.allumes.valeur.replace(/\s/g, ''), '3/6'); assert.equal(a.lumieres.valeur.replace(/\s/g, ''), '2/4'); assert.equal(a.serrures.valeur.replace(/\s/g, ''), '1/3');
      assert.equal(a.temperature.valeur.replace(/\s/g, ''), '21,7°C'); assert.equal(a.humidite.valeur.replace(/\s/g, ''), '58%'); assert.equal(a.watts.valeur.replace(/\s/g, ''), '300W');
      assert.match(a.temperature.titre, /[Mm]oyenne de 3 capteurs/); assert.match(a.temperature.titre, /2 capteurs écartés/); assert.match(a.watts.titre, /2 prises/); assert.match(a.watts.libelle, /prises/);
      assert.match(a.lumieres.titre, /1 sans nouvelles/); assert.match(a.serrures.titre, /1 ouverte/); assert.equal(a.serrures.ton, 'alarme');
      // Un vrai zéro s'affiche ; « vide » le dit en une phrase et mène à l'appli des appareils ; tout muet : aucun chiffre.
      assert.equal(a.zero.valeur.replace(/\s/g, ''), '0/6'); assert.equal(a.zero.ton, 'calme');
      assert.equal(a.vide.valeur, ''); assert.match(a.vide.titre, /Aucun capteur de température/); assert.equal(a.vide.lien, '#app=midgard'); assert.doesNotMatch(a.vide.libelle + a.vide.valeur, /\d/);
      assert.equal(a.muet.valeur, ''); assert.match(a.muet.titre, /plus de nouvelles/); assert.doesNotMatch(a.muet.libelle, /\d/);
      // La pièce piégée : du texte, jamais une balise ; l'âge vrai de la mesure.
      assert.ok(a.piece.titre.includes('<img'), a.piece.titre); assert.match(a.piece.titre, /il y a 12 min/);
      assert.equal(a.ouverte.ton, 'alarme'); assert.match(a.ouverte.titre, /2 ouvertes/); assert.match(a.ouverte.titre, /1 d'état inconnu/); assert.doesNotMatch(a.ouverte.titre, /sans nouvelles/);
      assert.match(a.ecartes.valeur.replace(/\s/g, ' '), /^12 345 W$/); assert.match(a.ecartes.titre, /2 prises écartées/);
      // Une mesure dont l'heure n'est pas connue : aucun âge affirmé (jamais « lue il y a moins d'1 min »).
      assert.doesNotMatch(a.ecartes.titre, /lue /); assert.match(a.temperature.titre, /lue il y a/);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-chiffres-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // Le lien de « vide » mène à Midgard.
      await p.click(`#feGrid .fe-w[data-id="${ID.vide}"] a.wmc`); assert.equal(await p.evaluate(() => location.hash), '#app=midgard');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320, 768 et 1920 px, et un thème de verre : les petits chiffres restent dans leur cadre, rien ne déborde', { skip: sansNav }, async () => {
  const va = valhallaOf()!;
  for (const [largeur, verre] of [[320, false], [768, false], [1920, false], [1280, true]] as const) {
    if (verre && !(await va.act('apparence', 'theme', { theme: 'glace' })).ok) continue;
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of Object.keys(ID)) {
        if (k !== 'piece') assert.equal(a[k].quoiEntier, true, `${largeur} : ${k}, ce que compte le chiffre se lit en entier (« ${a[k].quoi} »)`); assert.equal(a[k].phraseEntiere, true, `${largeur} : ${k}, la phrase se lit en entier`);
        assert.deepEqual(a[k].coinsRognes, [], `${largeur} : ${k}, aucun coin arrondi ne rogne un texte`);
        assert.equal(a[k].dedans, true, `${largeur} : ${k} reste dans sa carte : ${a[k].dehors.join(' | ')}`); assert.deepEqual(a[k].coupesSansBulle, [], `${largeur} : ${k}, aucun texte coupé sans info-bulle`); assert.equal(a[k].valeurEntiere, true, `${largeur} : ${k}, la valeur se voit en entier`); }
      assert.equal(a.watts.valeur.replace(/\s/g, ''), '300W', `${largeur} : la valeur reste entière`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-chiffres-${largeur}${verre ? '-verre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); if (verre) await va.act('apparence', 'theme', { theme: 'valhalla' }); }
  }
});
