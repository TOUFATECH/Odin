// Les courbes de la maison en widgets (maquette validée « Accueil ») : la courbe du widget « Capteur », « Consommation du
// jour » et « Énergie de la semaine » (src/valhalla/widgets/maison-courbes.ts, src/web/pages/widgets-maison-courbes.js),
// d'après les relevés gardés dans le magasin de mesures (appareils.ts, garderReleve). Sa réponse : pas de page Énergie,
// les courbes vont dans les widgets ; rien n'est montré tant qu'Odin n'a pas la vraie donnée.
// - La courbe suit ses points ; un point seul : pas de courbe ; un trou reste un trou ; l'unité est celle de la valeur.
// - Le total du jour est celui du fuseau d'Odin (energieDuJour), pas celui de la machine.
// - Un jour sans relevé n'a pas de barre ; moins de 7 jours : dit ; aucune part « par usage », aucune comparaison.
// - Au propriétaire seul, sur son accueil : un membre, une tablette « maison », une clé d'accès, une requête sans session
//   ne reçoivent ni point ni total, et le magasin n'est pas lu pour eux (requêtes rejouées sur un vrai Odin).
// - Le coût : une lecture par série et par demande ; dix widgets ne relisent pas dix fois ; un mois de relevés mesuré.
// - Au-delà de 31 jours, les moyennes par heure suffisent.
// - Le navigateur : 390, 768 et 1280 px, clair et sombre.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { Metrics, type Point } from '../src/valhalla/metrics.ts';
import * as A from '../src/valhalla/modules/appareils.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { homeDevices } from '../src/valhalla/modules/midgard.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { admiseALaMaison, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { lectureReleves, localDe, jourPlus } from '../src/valhalla/widgets/maison-courbes.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGE_JS = lire('src/web/pages/widgets-maison-courbes.js'), APP_JS = lire('src/web/pages/widgets-maison-appareils.js'), RENDU = lire('src/web/pages/widgets-rendu.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const SERVEUR_TS = lire('src/valhalla/widgets/maison-courbes.ts');
const NOUVELLES = ['maison_conso_jour', 'maison_energie_semaine'] as const;
const MIN = 60_000, H = 3_600_000, J = 86_400_000;
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'd5100000', kind, w: 1, c: 4, r: 3, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' }, CLE: Lecteur = { qui: 'proprietaire', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };

// Un fuseau d'Odin différent de celui de la machine (le jour d'Odin n'est pas celui de la machine).
const MAINT = Date.UTC(2026, 10, 20, 3, 0); // 12:00 à Tokyo
const machine = -new Date(MAINT).getTimezoneOffset();
const FZ = machine === 9 * 60 ? 'America/New_York' : 'Asia/Tokyo';
const ICI = localDe(MAINT, FZ)!;
/** L'instant d'une heure locale du fuseau d'Odin (« AAAA-MM-JJ », heures, minutes). */
function aLHeure(jour: string, h: number, m = 0): number {
  let t = Date.parse(`${jour}T00:00:00Z`) + (h * 60 + m) * MIN;
  for (let i = 0; i < 3; i++) { const l = localDe(t, FZ)!; const ecart = (Date.parse(`${l.jour}T00:00:00Z`) + l.minute * MIN) - (Date.parse(`${jour}T00:00:00Z`) + (h * 60 + m) * MIN); t -= ecart; }
  return t;
}

type Ap = { id: string; nom: string; commandable: boolean; ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; vuA: number; liens?: string[] };
const ap = (id: string, sorte: string, etat: string, o: Partial<Ap> = {}): Ap => ({ id, nom: `Appareil ${id}`, commandable: sorte !== 'capteur', ids: id, piece: 'Pièce A', sorte, etat, unite: '', marche: '', arret: '', vuA: MAINT - 2 * MIN, ...o });
/** Deux prises qui mesurent (énergie et puissance), un compteur général (pas une prise), un capteur de température. */
const JEU = (): Ap[] => [
  ap('pr1', 'prise', 'on', { liens: ['tasmota:0a'] }), ap('e1', 'capteur', '2.5', { unite: 'kWh', liens: ['tasmota:0a'] }), ap('w1', 'capteur', '120', { unite: 'W', liens: ['tasmota:0a'] }),
  ap('pr2', 'prise', 'on', { liens: ['tasmota:0b'] }), ap('e2', 'capteur', '900', { unite: 'Wh', liens: ['tasmota:0b'] }), ap('w2', 'capteur', '0.05', { unite: 'kW', liens: ['tasmota:0b'] }),
  ap('g1', 'capteur', '5000', { unite: 'kWh' }), ap('t1', 'capteur', '21.5', { unite: '°C', piece: 'Salon' }), ap('k1', 'capteur', '1.2', { unite: 'kW' }),
];
const serie = (id: string, m: A.MesureReleve) => A.nomSerie(id, m)!;
/** Un faux magasin : les points de chaque série ; il note chaque lecture (son nom de série, s'il a demandé `prive`). */
function magasin(series: Record<string, Point[]>) {
  const appels: Array<{ n: string; prive: boolean }> = [];
  return { appels, points: (n: string, de: number, a = MAINT, o: { prive?: boolean } = {}) => { appels.push({ n, prive: o.prive === true }); return o.prive === true ? (series[n] ?? []).filter((p) => p[0] >= de && p[0] <= a) : []; } };
}
function fausse(appareils: Ap[] | undefined, series: Record<string, Point[]>, espions: string[] = [], t = MAINT) {
  const m = magasin(series);
  const src = {
    appli: (id: string) => (id === 'midgard' ? { id, name: 'Appli maison', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: FZ, heure12: false }), maintenant: () => t,
    appareilsMaison: async () => { espions.push('appareils'); return appareils ? { unites: 'metrique', appareils } : undefined; },
    relevesMaison: (() => { let r: ReturnType<typeof lectureReleves> | undefined; return () => { espions.push('releves'); return (r ??= lectureReleves(m, FZ, () => t)); }; })(),
  } as unknown as SourceWidget;
  return { src, m, espions };
}
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

/** Des relevés de démonstration : le compteur d'énergie de e1 (kWh) et de e2 (rangé en kWh : Wh × 0,001), les watts. */
function releves(): Record<string, Point[]> {
  const hier = jourPlus(ICI.jour, -1), s: Record<string, Point[]> = {};
  // e1 : la veille à 23 h et 23 h 30 (1,0 puis 1,4), le jour à 0 h 30 et 1 h (1,9 puis 2,5) : 0,6 kWh aujourd'hui.
  s[serie('e1', 'energie')] = [[aLHeure(hier, 23, 0), 1.0], [aLHeure(hier, 23, 30), 1.4], [aLHeure(ICI.jour, 0, 30), 1.9], [aLHeure(ICI.jour, 1, 0), 2.5]];
  // e2 : un seul relevé aujourd'hui : pas de total (jamais un zéro).
  s[serie('e2', 'energie')] = [[aLHeure(ICI.jour, 2, 0), 0.9]];
  // w1 : toutes les 10 minutes de 0 h à 11 h 50, sauf de 6 h à 7 h (un trou) ; w2 (kW rangés en W) : toutes les 10 minutes.
  const w1: Point[] = [], w2: Point[] = [];
  for (let m = 0; m < 12 * 60; m += 10) { if (m < 6 * 60 || m >= 7 * 60) w1.push([aLHeure(ICI.jour, 0, m), 100 + m / 10]); w2.push([aLHeure(ICI.jour, 0, m), 50]); }
  s[serie('w1', 'puissance')] = w1; s[serie('w2', 'puissance')] = w2;
  // le compteur général : des relevés, jamais comptés (pas une prise)
  s[serie('g1', 'energie')] = [[aLHeure(ICI.jour, 0, 30), 5000], [aLHeure(ICI.jour, 1, 0), 5010]];
  return s;
}

// ------------------------------------------------------------------ le serveur, avec une fausse source

test('les deux sortes : famille « maison », Midgard lue, propriétaire seul, jamais sur l\'écran de la maison, leurs tailles, posables', () => {
  const tailles: Record<string, [number[], number]> = { maison_conso_jour: [[3, 2], 3], maison_energie_semaine: [[4, 3], 3] };
  for (const k of NOUVELLES) {
    const s = sorteDe(k)!; assert.ok(s, k);
    assert.equal(s.famille, 'maison'); assert.deepEqual(s.applis, ['midgard']); assert.equal(publicDe(s), 'proprietaire', `${k} : propriétaire seul`);
    assert.equal(s.jamaisALaMaison, true, `${k} : la marque`); assert.equal(admiseALaMaison(k), false); assert.equal(s.posable, true);
    assert.deepEqual([[...s.taille.mini], s.taille.r], tailles[k]); assert.deepEqual(TAILLE_SORTE[k as keyof typeof TAILLE_SORTE], { mini: tailles[k][0], r: tailles[k][1] });
    // Les deux tables de la grille de la page suivent celles du serveur.
    assert.match(GRILLE, new RegExp(`${k}: \\[${tailles[k][0][0]}, ${tailles[k][0][1]}\\]`)); assert.match(GRILLE, new RegExp(`${k}: ${tailles[k][1]}[,\\s}]`));
  }
});

test('« Consommation du jour » : le total est celui du jour d\'Odin (son fuseau, pas celui de la machine), par energieDuJour ; la courbe des watts a ses trous', async () => {
  const { src } = fausse(JEU(), releves());
  const e = await etat(W('maison_conso_jour'), LUI, src);
  assert.equal(e.etat, 'ok', JSON.stringify(e));
  const d = e.donnee!;
  assert.equal(d.jour, ICI.jour);
  // e1 : 0,6 kWh (la paire de 0 h 30 à 1 h) ; e2 : un seul relevé, pas compté ; le compteur général : pas une prise.
  // Le jour n'est relevé qu'à partir de 0 h 30 (une heure sans relevé avant, plus que les 15 minutes du pont de minuit) :
  // son total est la vraie valeur relevée, et il est dit incomplet (jamais présenté comme la journée entière).
  assert.deepEqual(d.total, { kwh: 0.6, prises: 1, incomplet: true });
  assert.equal(d.total.kwh, A.energieDuJour(releves()[serie('e1', 'energie')], ICI.jour, FZ), 'la fonction qui existe');
  // Au fuseau de la machine, ce jour n'aurait pas cette valeur (sinon l'essai ne prouverait rien).
  const fzMachine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.notEqual(A.energieDuJour(releves()[serie('e1', 'energie')], ICI.jour, fzMachine), 0.6, 'le fuseau de la machine donnerait autre chose');
  // La courbe : 48 demi-heures ; avant midi, la somme des deux prises (w2 en kW est rangée en W : 50) ; de 6 h à 7 h,
  // w1 n'a rien dit : un trou (jamais une somme partielle) ; la demi-heure en cours et la suite : rien.
  const v = d.courbe.valeurs as Array<number | null>;
  assert.equal(v.length, 48); assert.equal(d.courbe.prises, 2); assert.equal(d.courbe.pas, 30);
  assert.equal(v[0], 100 + 1 + 50); // (100 + 101 + 102) / 3 + 50
  assert.deepEqual([v[12], v[13]], [null, null], 'un trou reste un trou');
  assert.ok(typeof v[11] === 'number' && typeof v[14] === 'number');
  assert.ok(v.slice(ICI.minute / 30).every((x) => x === null), 'rien pour la demi-heure en cours ni après');
  // Aucune part « par usage », aucune comparaison avec la veille.
  assert.doesNotMatch(JSON.stringify(e), /usage|hier|veille|vs|%|part/i);
});

test('« Consommation du jour » : sans prise qui mesure, « vide » ; des prises sans relevé gardé : « vide » ; jamais un zéro', async () => {
  for (const [jeu, raison] of [[[ap('t1', 'capteur', '21', { unite: '°C' }), ap('g1', 'capteur', '5000', { unite: 'kWh' })], 'aucune_prise'], [JEU(), 'pas_encore_de_releve']] as const) {
    const { src } = fausse([...jeu], {});
    for (const k of NOUVELLES) { const e = await etat(W(k), LUI, src); assert.deepEqual(e, { etat: 'vide', raison }, `${k} ${raison}`); }
  }
  // Midgard muette : « source_absente » ; sans magasin : « source_absente ».
  assert.equal((await etat(W('maison_conso_jour'), LUI, fausse(undefined, {}).src)).etat, 'source_absente');
  const sans = fausse(JEU(), {}).src; (sans as { relevesMaison?: unknown }).relevesMaison = () => undefined;
  assert.deepEqual(await etat(W('maison_energie_semaine'), LUI, sans), { etat: 'source_absente', raison: 'magasin_absent' });
  // Un seul point de puissance par prise : pas de courbe (moins de deux valeurs) ; pas de total : « vide ».
  const un = { [serie('w1', 'puissance')]: [[aLHeure(ICI.jour, 1, 0), 10]] as Point[] };
  assert.deepEqual(await etat(W('maison_conso_jour'), LUI, fausse(JEU(), un).src), { etat: 'vide', raison: 'pas_encore_de_releve' });
});

test('« Énergie de la semaine » : un jour sans relevé n\'a pas de valeur (ni zéro) ; seulement les jours connus ; moins de 7 jours : dit', async () => {
  const s: Record<string, Point[]> = {}, e1: Point[] = [], e2: Point[] = [];
  // e1 : un compteur « du jour » (reparti de zéro à minuit) ; des relevés de J-4, J-2, J-1 et aujourd'hui (pas J-3, ni avant).
  for (const k of [-4, -2, -1, 0]) { const j = jourPlus(ICI.jour, k); for (let m = 0; m <= (k ? 23 * 60 : 11 * 60); m += 30) e1.push([aLHeure(j, 0, m), m / 600]); }
  // e2 : seulement J-1 (rangée en kWh).
  for (let m = 0; m <= 23 * 60; m += 30) e2.push([aLHeure(jourPlus(ICI.jour, -1), 0, m), m / 1200]);
  s[serie('e1', 'energie')] = e1; s[serie('e2', 'energie')] = e2;
  const { src } = fausse(JEU(), s);
  const e = await etat(W('maison_energie_semaine'), LUI, src);
  assert.equal(e.etat, 'ok', JSON.stringify(e));
  const d = e.donnee!, jours = d.jours as Array<{ jour: string; kwh?: number }>;
  assert.deepEqual(jours.map((x) => x.jour), [-4, -3, -2, -1, 0].map((k) => jourPlus(ICI.jour, k)), 'à partir du premier jour connu');
  assert.equal('kwh' in jours[1], false, 'J-3 : aucune valeur, ni zéro');
  assert.equal(jours[0].kwh, A.energieDuJour(e1, jourPlus(ICI.jour, -4), FZ));
  assert.equal(jours[3].kwh, Math.round((A.energieDuJour(e1, jourPlus(ICI.jour, -1), FZ)! + A.energieDuJour(e2, jourPlus(ICI.jour, -1), FZ)!) * 1000) / 1000);
  assert.equal(d.complet, false); assert.equal(d.prises, 2);
  assert.doesNotMatch(JSON.stringify(e), /usage|hier|veille|vs|%|part/i);
  // La page : J-3 sans barre ; « pas encore 7 jours ».
  const M = page().OdinWidgetsMaisonCourbes, b = M.barres(d);
  assert.equal(b.jours.length, 5); assert.equal('h' in b.jours[1], false); assert.equal('kwh' in b.jours[1], false); assert.ok(b.jours[0].h > 0);
  assert.equal(b.pasEncore, true); assert.equal(b.sans, 1);
  // Sept jours connus : complet, rien à dire.
  const plein: Point[] = []; for (let k = -6; k <= 0; k++) { const j = jourPlus(ICI.jour, k); for (let m = 0; m <= 11 * 60; m += 60) plein.push([aLHeure(j, 0, m), m / 100]); }
  const p = (await etat(W('maison_energie_semaine'), LUI, fausse(JEU(), { [serie('e1', 'energie')]: plein }).src)).donnee!;
  assert.equal(p.jours.length, 7); assert.equal(p.complet, true); assert.equal(M.barres(p).pasEncore, false);
  assert.ok(p.jours.every((x: Record<string, unknown>) => !('incomplet' in x)), 'des jours relevés dès minuit sont entiers');
  // Un premier jour commencé en cours de journée (le premier relevé à 14 h) : sa valeur, dite incomplète, jamais un jour entier.
  const tard: Point[] = []; for (let m = 14 * 60; m <= 23 * 60; m += 30) tard.push([aLHeure(jourPlus(ICI.jour, -2), 0, m), m / 1000]);
  for (let m = 0; m <= 11 * 60; m += 30) tard.push([aLHeure(jourPlus(ICI.jour, -1), 0, m), 1 + m / 1000]);
  const q = (await etat(W('maison_energie_semaine'), LUI, fausse(JEU(), { [serie('e1', 'energie')]: tard }).src)).donnee!;
  assert.deepEqual(q.jours.map((x: Record<string, unknown>) => x.incomplet === true), [true, false, false], 'J-2 commencé à 14 h : incomplet ; J-1, relié à minuit : entier');
  assert.equal(q.jours[0].kwh, A.energieDuJour(tard, jourPlus(ICI.jour, -2), FZ), 'sa valeur reste la vraie');
  const bq = M.barres(q); assert.equal(bq.jours[0].incomplet, true); assert.equal(bq.incomplets, 1); assert.ok(bq.jours[0].h > 0);
  assert.match(M.TEXTES.semaine.incomplets(1), /1 jour incomplet/);
  // La page : un jour sans relevé n'a ni trait ni bordure à la place de sa barre (il se lirait comme un zéro).
  assert.doesNotMatch(M.CSS, /data-sans\][^{]*\{[^}]*(border|background|outline)/, 'aucun trait pour un jour sans relevé');
});

test('la courbe du capteur : elle suit ses points ; un point seul : pas de courbe ; un trou reste un trou ; l\'unité de sa valeur', async () => {
  const pts: Point[] = []; for (let i = 0; i < 10; i++) pts.push([MAINT - (10 - i) * 5 * MIN, 20 + i / 10]);
  const trou: Point[] = [[MAINT - 10 * H, 18], [MAINT - 10 * H + 5 * MIN, 18.5], [MAINT - 10 * H + 10 * MIN, 19], ...pts];
  const cap = (s: Record<string, Point[]>, l: Lecteur = LUI, cible = 'appareil:t1') => etat(W('maison_capteur', { c: 3, r: 2, cible }), l, fausse(JEU(), s).src);
  const c = (await cap({ [serie('t1', 'valeur')]: pts })).donnee!.courbe;
  assert.deepEqual(c.morceaux, [pts], 'les points eux-mêmes');
  assert.deepEqual([c.min, c.max, c.derniere], [20, 20.9, pts[9]]); assert.equal(c.a - c.de, 24 * H);
  assert.equal('courbe' in (await cap({ [serie('t1', 'valeur')]: [pts[0]] })).donnee!, false, 'un point seul : pas de courbe');
  assert.equal('courbe' in (await cap({})).donnee!, false, 'aucun relevé : pas de courbe');
  assert.equal((await cap({ [serie('t1', 'valeur')]: trou })).donnee!.courbe.morceaux.length, 2, 'la coupure de près de 10 h n\'est pas reliée');
  // Un capteur en kW : la série est rangée en W, la courbe est dans l'unité de sa valeur (kW).
  const kw = (await cap({ [serie('k1', 'puissance')]: [[MAINT - 20 * MIN, 1200], [MAINT - 10 * MIN, 900]] }, LUI, 'appareil:k1')).donnee!;
  assert.equal(kw.unite, 'kW'); assert.deepEqual(kw.courbe.morceaux, [[[MAINT - 20 * MIN, 1.2], [MAINT - 10 * MIN, 0.9]]]);
  // Plus de 96 points : une moyenne par quart d'heure, jamais plus de points servis.
  const dense: Point[] = []; for (let m = 0; m < 24 * 60; m++) dense.push([MAINT - 24 * H + m * MIN + 1, 10 + (m % 7)]);
  const d = (await cap({ [serie('t1', 'valeur')]: dense })).donnee!.courbe;
  assert.ok(d.morceaux.flat().length <= 97, `points servis : ${d.morceaux.flat().length}`); assert.deepEqual([d.min, d.max], [10, 16]);
  // La page : le texte de remplacement dit le minimum, le maximum, la dernière valeur.
  const M = page().OdinWidgetsMaisonCourbes, b = M.morceauxLus(c.morceaux, c.de, c.a);
  assert.equal(b.morceaux.length, 1); assert.equal(M.trace(b).length, 1);
  assert.equal(M.morceauxLus([[pts[0]]], c.de, c.a), null, 'un point seul : rien à dessiner');
  assert.equal(M.trace(M.morceauxLus([[pts[0], pts[1]], [pts[5]]], c.de, c.a)).length, 2, 'deux morceaux : deux traits');
  assert.match(M.TEXTES.capteur.courbe('20 °C', '21 °C', '20,9 °C', ''), /minimum 20 °C, maximum 21 °C, dernière valeur 20,9 °C/);
  // Des valeurs très petites : assez de chiffres pour les distinguer, et jamais « -0 ».
  assert.equal(M.chiffres(0.001, 0.005), 3); assert.equal(M.chiffres(20, 21), 1); assert.equal(M.chiffres(5, 5), 1);
  assert.equal(M.nombre(-0.0004, 1), '0', 'pas de « -0 »'); assert.match(M.nombre(-0.4, 1), /^[-−]0,4$/);
  // Un morceau court (deux points, après un trou) : son trait seul, sans aire (elle se lirait comme une barre).
  const court = M.trace(M.morceauxLus([[pts[0], pts[1]], [pts[4], pts[5], pts[6]]], c.de, c.a));
  assert.equal(court[0].aire, '', 'deux points : pas d\'aire'); assert.ok(court[1].aire, 'trois points : son aire');
});

test('qui voit : un membre, une tablette « maison », une clé « complet », un lecteur inconnu ne reçoivent ni point ni total ; le magasin n\'est pas lu pour eux ; le capteur leur reste tel qu\'aujourd\'hui', async () => {
  const s = releves(); s[serie('t1', 'valeur')] = [[MAINT - 20 * MIN, 21], [MAINT - 10 * MIN, 21.5]];
  for (const l of [membre(['midgard', 'gladsheim']), TABLETTE, CLE, { qui: 'maison', ecran: 'accueil' } as Lecteur]) {
    const { src, m, espions } = fausse(JEU(), s);
    for (const k of NOUVELLES) { const e = await etat(W(k), l, src); assert.equal(e.etat, 'refuse', `${k} pour ${l.qui}/${l.ecran}`); assert.equal('donnee' in e, false); }
    const cap = await etat(W('maison_capteur', { c: 3, r: 2, cible: 'appareil:t1' }), l, src);
    assert.equal(JSON.stringify(cap).includes('courbe'), false, `${l.qui}/${l.ecran} : pas de courbe`);
    // EXACTEMENT ce qu'il reçoit sans la lecture des relevés (la source d'avant ce lot).
    const avant = fausse(JEU(), s).src; delete (avant as { relevesMaison?: unknown }).relevesMaison;
    assert.deepEqual(cap, await etat(W('maison_capteur', { c: 3, r: 2, cible: 'appareil:t1' }), l, avant), `${l.qui}/${l.ecran} : rien ne change pour lui`);
    assert.deepEqual(m.appels, [], `${l.qui}/${l.ecran} : le magasin n'est pas lu`); assert.ok(!espions.includes('releves'), 'la lecture des relevés n\'est pas demandée');
  }
  // Lui, sur son accueil : la courbe, lue en le demandant expressément (prive).
  const { src, m } = fausse(JEU(), s);
  assert.ok((await etat(W('maison_capteur', { c: 3, r: 2, cible: 'appareil:t1' }), LUI, src)).donnee!.courbe);
  assert.ok(m.appels.length && m.appels.every((x) => x.prive), 'chaque lecture demande prive');
  // Ni le nom d'une série ni l'empreinte d'un identifiant dans une réponse.
  for (const k of [...NOUVELLES, 'maison_capteur']) assert.doesNotMatch(JSON.stringify(await etat(W(k, { cible: 'appareil:t1' }), LUI, src)), /appareils\.|[0-9a-f]{16}/);
});

test('le coût : dix widgets posés lisent chaque série une fois par demande ; les jours finis de la semaine sont gardés d\'une demande à l\'autre', async () => {
  const s = releves(), espions: string[] = [];
  const { src, m } = fausse(JEU(), s, espions);
  for (let i = 0; i < 10; i++) await etat(W('maison_conso_jour', { id: `d51000${i}0` }), LUI, src);
  const parSerie = (l: typeof m.appels) => { const c = new Map<string, number>(); for (const x of l) c.set(x.n, (c.get(x.n) ?? 0) + 1); return [...c.values()]; };
  assert.deepEqual(parSerie(m.appels), [1, 1, 1, 1], 'e1, e2, w1, w2 : une lecture chacune pour dix widgets');
  // La semaine, deux demandes de suite : la seconde ne relit que la fenêtre du jour (les jours finis sont gardés).
  const store = magasin(s), r1 = lectureReleves(store, FZ, () => MAINT), jours = Array.from({ length: 7 }, (_, i) => jourPlus(ICI.jour, i - 6));
  const avant = r1.energies('e1', jours);
  const de1 = store.appels.length; const r2 = lectureReleves(store, FZ, () => MAINT); assert.deepEqual(r2.energies('e1', jours), avant);
  assert.equal(store.appels.length - de1, 1, 'une lecture : celle du jour seulement');
});

test('le coût, avec une horloge qui avance (comme Date.now dans le vrai Odin) : l\'instant est figé une fois par demande, dix widgets ne relisent pas', async () => {
  // L'horloge avance d'une milliseconde à chaque appel : entre deux widgets, « maintenant » n'est plus le même.
  let tic = MAINT - 10 * 1000; const avance = () => (tic += 1);
  const s = releves(); s[serie('t1', 'valeur')] = [[MAINT - 20 * MIN, 21], [MAINT - 10 * MIN, 21.5]];
  const m = magasin(s);
  const src = { ...fausse(JEU(), s).src, maintenant: avance, relevesMaison: (() => { let r: ReturnType<typeof lectureReleves> | undefined; return () => (r ??= lectureReleves(m, FZ, avance)); })() } as SourceWidget;
  const parSerie = () => { const c = new Map<string, number>(); for (const x of m.appels) c.set(x.n, (c.get(x.n) ?? 0) + 1); return Object.fromEntries(c); };
  for (let i = 0; i < 10; i++) await etat(W('maison_conso_jour', { id: `d51200${i}0` }), LUI, src);
  assert.ok(Object.values(parSerie()).every((n) => n === 1), `dix « Consommation du jour » : une lecture par série (${JSON.stringify(Object.values(parSerie()))})`);
  m.appels.length = 0;
  for (let i = 0; i < 10; i++) assert.ok((await etat(W('maison_capteur', { id: `d51300${i}0`, c: 3, r: 2, cible: 'appareil:t1' }), LUI, src)).donnee!.courbe);
  assert.deepEqual(Object.values(parSerie()), [1], 'dix « Capteur » sur le même capteur : une lecture');
  // L'instant figé est celui que la lecture rend, et les calculs datent leur état de lui.
  const r = src.relevesMaison!()!; assert.equal(typeof r.instant, 'number'); assert.ok(r.instant < tic);
  assert.equal((await etat(W('maison_conso_jour'), LUI, src)).at, r.instant);
});

test('le coût mesuré : un mois de relevés pour dix appareils (magasin réel, sur le disque) ; au-delà de 31 jours, les moyennes par heure suffisent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'courbes-cout-')), now = Date.UTC(2026, 10, 20, 9, 0), mesures = join(dir, 'mesures'); mkdirSync(mesures);
  try {
    const ids = Array.from({ length: 10 }, (_, i) => `prise${i}`), noms = ids.flatMap((id) => [serie(`${id}_e`, 'energie'), serie(`${id}_w`, 'puissance'), serie(`${id}_t`, 'valeur')]);
    // 31 jours de minutes (le format du magasin : une ligne par minute, toutes les séries), écrits tels quels.
    const jour = (t0: number) => { const d = new Date(t0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const fichiers = new Map<string, string[]>();
    for (let t0 = Math.floor((now - 31 * J) / MIN) * MIN; t0 <= now; t0 += MIN) {
      const v: Record<string, number> = {}; const k = (t0 - (now - 31 * J)) / MIN;
      ids.forEach((id, i) => { v[serie(`${id}_e`, 'energie')] = Math.round(k * 0.001 * (i + 1) * 1000) / 1000; v[serie(`${id}_w`, 'puissance')] = 50 + i; v[serie(`${id}_t`, 'valeur')] = 20 + (k % 60) / 60; });
      const f = jour(t0); const l = fichiers.get(f) ?? []; l.push(JSON.stringify({ t: t0, v })); fichiers.set(f, l);
    }
    for (const [f, l] of fichiers) writeFileSync(join(mesures, `${f}.jsonl`), `${l.join('\n')}\n`);
    const mag = new Metrics(mesures, () => now);
    let appels = 0; const orig = mag.points.bind(mag); mag.points = ((...a: Parameters<Metrics['points']>) => { appels++; return orig(...a); }) as Metrics['points'];
    const app = ids.flatMap((id, i) => [ap(id, 'prise', 'on', { liens: [`m:${i}`] }), ap(`${id}_e`, 'capteur', '1', { unite: 'kWh', liens: [`m:${i}`] }), ap(`${id}_w`, 'capteur', '50', { unite: 'W', liens: [`m:${i}`] }), ap(`${id}_t`, 'capteur', '20', { unite: '°C', vuA: now - MIN })]);
    const demande = async () => {
      const src = { ...fausse(app, {}, [], now).src, relevesMaison: (() => { let r: ReturnType<typeof lectureReleves> | undefined; return () => (r ??= lectureReleves(mag, 'UTC', () => now)); })() } as SourceWidget;
      const ws = [...ids.map((id, i) => W('maison_capteur', { id: `d5110${i}00`, c: 3, r: 2, cible: `appareil:${id}_t` })), W('maison_conso_jour'), W('maison_energie_semaine')];
      const t0 = performance.now(), out = await Promise.all(ws.map((w) => etat(w, LUI, src)));
      return { ms: Math.round(performance.now() - t0), out };
    };
    appels = 0; const a = await demande(), lus1 = appels;
    appels = 0; const b = await demande(), lus2 = appels;
    t.diagnostic(`un mois, dix appareils (30 séries) : première demande ${a.ms} ms, ${lus1} lectures ; suivante ${b.ms} ms, ${lus2} lectures`);
    assert.ok(a.out.every((e) => e.etat === 'ok'), JSON.stringify(a.out.map((e) => e.etat)));
    // 10 capteurs + 10 puissances + 10 énergies (jour) + 10 énergies (semaine) au plus ; ensuite, plus de lecture de la semaine.
    assert.ok(lus1 <= 40, `lectures : ${lus1}`); assert.ok(lus2 <= 30, `lectures : ${lus2}`);
    assert.ok(a.out[0].donnee!.courbe.morceaux.flat().length <= 97, 'une courbe bornée');
    // Au-delà de 31 jours : seules les moyennes par heure restent ; elles suffisent à un jour de la semaine (et du mois).
    const vieux = new Metrics(join(dir, 'vieux'), () => Date.UTC(2026, 11, 30, 12, 0)), hfile: string[] = [];
    for (let h = 0; h < 24; h++) hfile.push(JSON.stringify({ t: Date.UTC(2026, 10, 10, h), v: { [serie('prise0_e', 'energie')]: [h * 0.5, h * 0.5, h * 0.5] } }));
    writeFileSync(join(vieux.dir, 'heures-2026-11.jsonl'), `${hfile.join('\n')}\n`);
    const r = lectureReleves(vieux, 'UTC', () => Date.UTC(2026, 11, 30, 12, 0));
    assert.deepEqual(r.energies('prise0_e', ['2026-11-10']), [11.5], 'les moyennes par heure donnent le jour');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la page : sa déclaration (propriétaire seul, jamais sur l\'écran de la maison, Midgard, ses tailles), son dictionnaire, ni valeur de la maquette ni comparaison', () => {
  const w = page(), R = w.OdinWidgetsRendu;
  for (const k of NOUVELLES) {
    const d = R.rendu(k); assert.ok(d, k);
    assert.equal(d.proprio, true); assert.equal(d.jamaisALaMaison, true); assert.equal(d.appli, 'midgard'); assert.deepEqual([...d.vides].sort(), ['aucune_prise', 'pas_encore_de_releve']);
    assert.equal(R.groupeTiroir(d, 'Maison'), 'Maison', 'rangée avec la maison dans le tiroir');
  }
  assert.deepEqual(JSON.parse(JSON.stringify([R.rendu('maison_conso_jour').w, R.rendu('maison_energie_semaine').w])), [{ kind: 'maison_conso_jour', w: 1, c: 4, r: 3, pc: 4 }, { kind: 'maison_energie_semaine', w: 2, c: 5, r: 3, pc: 4 }]);
  for (const src of [PAGE_JS, SERVEUR_TS]) {
    assert.doesNotMatch(src, /vs hier|−\s?\d+\s?%|Clim|Cuisine|Multimédia|Novembre|tous les appareils|anneau/i, 'ni comparaison, ni part par usage, ni texte de la maquette');
    assert.doesNotMatch(src, /\b(26,5|842|119|12,4|32\.7|612)\b/, 'aucune valeur de la maquette');
    assert.doesNotMatch(src, /[\u200b-\u200f\u2028\u2029\ufeff\u00a0]/, 'aucun caractère invisible');
  }
  assert.doesNotMatch(PAGE_JS, /(animation|transition)\s*:\s*(?!none)/, 'aucun mouvement');
  // Les repères d'heure de la courbe du jour, dans la langue de la page.
  assert.deepEqual([w.OdinWidgetsMaisonCourbes.heure(0, 0), w.OdinWidgetsMaisonCourbes.heure(12, 0), w.OdinWidgetsMaisonCourbes.heure(23, 59)], ['00:00', '12:00', '23:59']);
  // Le widget « Capteur » pose la courbe rendue (la page de la famille la dessine).
  assert.match(APP_JS, /OdinWidgetsMaisonCourbes/);
});

function page(): Record<string, any> {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const s of [PAGE_JS, RENDU]) vm.runInNewContext(s, { window: win, document: win.document, Intl });
  return win;
}

// ------------------------------------------------------------------ sur un vrai Odin : les requêtes rejouées

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '', lusPrives = 0;
const MDP = 'une-pirogue-sur-le-lagon-calme-51';
const PAGE = 'b5100001';
const ID = { capteur: 'd5100001', jour: 'd5100002', semaine: 'd5100003', jourGrand: 'd5100004', capteurGrand: 'd5100005' };
const MAC = '0A0B0C0D0E51', CAP = `tasmota_0A0B0C0D0E52_AM2301_Temperature`, EN = `tasmota_${MAC}_ENERGY_Today`, PU = `tasmota_${MAC}_ENERGY_Power`;
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Maison', widgets: [
  { id: ID.capteur, kind: 'maison_capteur', w: 1, c: 3, r: 2, cible: `appareil:${CAP}` },
  { id: ID.jour, kind: 'maison_conso_jour', w: 1, c: 3, r: 2 },
  { id: ID.semaine, kind: 'maison_energie_semaine', w: 1, c: 4, r: 3 },
  { id: ID.jourGrand, kind: 'maison_conso_jour', w: 1, c: 4, r: 3 },
  { id: ID.capteurGrand, kind: 'maison_capteur', w: 2, c: 6, r: 2, cible: `appareil:${CAP}` },
] }] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
const reglages: Record<string, unknown> = { port: 0 };
const ctxRelais = { home: '', dir: '', settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), alert: () => {}, emit: () => {}, now: () => new Date() } as unknown as ModCtx;
const connus = async (ids: string[]) => { for (let i = 0; i < 200; i++) { const l = (await homeDevices(valhallaOf()!.ctx('midgard')).catch(() => [])).map((x) => x.id); if (ids.every((id) => l.includes(id))) return; await new Promise((ok) => setTimeout(ok, 50)); } throw new Error(`appareils inconnus de Midgard : ${ids.join(', ')}`); };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-m', MDP); assert.ok(avecDroit);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  process.env.MQTT_PASSWORD = 'relais-de-test';
  await A.appareils.start!(ctxRelais);
  const b = A.brokerOf()!;
  b.publish(`tasmota/discovery/${MAC}/config`, JSON.stringify({ mac: MAC, t: 'prise_courbes', ft: '%prefix%/%topic%/', tp: ['cmnd', 'stat', 'tele'], rl: [1], dn: 'Prise A', onln: 'Online', ofln: 'Offline' }));
  b.publish(`tasmota/discovery/${MAC}/sensors`, JSON.stringify({ sn: { ENERGY: { Power: 0, Today: 0 } } }));
  b.publish('tasmota/discovery/0A0B0C0D0E52/config', JSON.stringify({ mac: '0A0B0C0D0E52', t: 'sonde_courbes', ft: '%prefix%/%topic%/', tp: ['cmnd', 'stat', 'tele'], rl: [], dn: 'Sonde A', onln: 'Online', ofln: 'Offline' }));
  b.publish('tasmota/discovery/0A0B0C0D0E52/sensors', JSON.stringify({ sn: { AM2301: { Temperature: 0 }, TempUnit: 'C' } }));
  await connus([`tasmota_${MAC}_1`, EN, PU, CAP]);
  b.publish('tele/sonde_courbes/SENSOR', JSON.stringify({ AM2301: { Temperature: 21.5 } }));
  b.publish('tele/prise_courbes/SENSOR', JSON.stringify({ ENERGY: { Power: 120, Today: 1.5 } }));
  // Les relevés des trois dernières heures, une minute sur deux (rangés comme le relais les range), puis écrits.
  const m = va.metrics, t1 = Math.floor(Date.now() / MIN) * MIN - MIN;
  for (let k = 180; k >= 1; k -= 2) { const t = t1 - k * MIN; m.put({ [serie(EN, 'energie')]: 1.5 - k * 0.005, [serie(PU, 'puissance')]: 100 + (k % 30), [serie(CAP, 'valeur')]: 20 + (k % 20) / 10 }, t); }
  m.flush();
  // Chaque lecture d'une série « appareils. » est comptée.
  const lu = m.points.bind(m); m.points = ((n: string, ...r: unknown[]) => { if (String(n).startsWith('appareils.')) lusPrives++; return (lu as (...x: unknown[]) => ReturnType<Metrics['points']>)(n, ...r); }) as Metrics['points'];
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { A.appareils.stop!(); delete process.env.MQTT_PASSWORD; await tt.end(); Object.assign(console, orig); });

test('vrai Odin : lui reçoit la courbe, le total et les barres ; un membre (avec le droit), une tablette, une clé d\'accès, sans session : ni point ni total, et le magasin n\'est pas lu', async () => {
  // Les essais d'avant (un mois de relevés) durent plus que l'attente du serveur entre deux requêtes : une connexion gardée
  // ouverte a pu être fermée par lui. Une première requête la renouvelle (son résultat n'est pas regardé).
  await fetch(`${v.url}/`).then((r) => r.arrayBuffer()).catch(() => undefined);
  lusPrives = 0;
  const lui = await donnees(); assert.equal(lui.status, 200);
  assert.ok(lusPrives > 0, 'lu pour lui');
  const cap = lui.de(ID.capteur)!; assert.equal(cap.etat, 'ok', JSON.stringify(cap)); assert.ok(cap.donnee!.courbe.morceaux.flat().length >= 2);
  const j = lui.de(ID.jour)!; assert.equal(j.etat, 'ok', JSON.stringify(j));
  const s = lui.de(ID.semaine)!; assert.equal(s.etat, 'ok', JSON.stringify(s)); assert.equal(s.donnee!.prises, 1);
  assert.doesNotMatch(lui.corps, /appareils\./, 'aucun nom de série');
  for (const [qui, h, code] of [['membre', { cookie: avecDroit }, 200], ['tablette', { cookie: '', 'x-odin-maison': cleMaison }, 401], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }, 401], ['sans session', { cookie: '' }, 401]] as const) {
    lusPrives = 0;
    const r = await donnees(h); assert.equal(r.status, code, qui);
    if (code === 200) for (const id of [ID.jour, ID.semaine, ID.capteur]) { const e = r.de(id)!; assert.equal(e.etat, 'refuse', `${qui} ${id}`); assert.equal('donnee' in e, false); }
    assert.doesNotMatch(r.corps, /courbe|kwh|morceaux|valeurs/i, `${qui} : rien des relevés`);
    assert.equal(lusPrives, 0, `${qui} : le magasin n'est pas lu`);
  }
  // L'écran de la maison, par la tablette et par une clé d'accès : la lecture des widgets ne lit aucun relevé.
  // (la tablette y entre ; la clé d'accès, comme aujourd'hui, est refusée à l'entrée)
  for (const [h, code] of [[{ cookie: '', 'x-odin-maison': cleMaison }, 200], [{ cookie: '', authorization: `Bearer ${v.token}` }, 401]] as const) {
    lusPrives = 0; const r = await v.json('/api/maison/etat', undefined, h); assert.equal(r.status, code);
    // (l'unité « kWh » d'une prise y est déjà, avec sa valeur du moment, comme avant : seuls les relevés gardés sont cherchés)
    assert.doesNotMatch(JSON.stringify(r.body), /courbe|morceaux|valeurs/i); assert.equal(lusPrives, 0, 'le magasin n\'est pas lu');
  }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; keyboard: { press(k: string): Promise<void> } }
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

for (const [largeur, sombre] of [[1280, false], [390, true], [768, false], [1280, true], [390, false], [768, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : la courbe, le total et les barres tiennent dans leur carte ; un texte de remplacement ; aucun mouvement`, { skip: sansNav }, async () => {
    const doigt = largeur < 500;
    const ctx = await nav!.newContext({ viewport: { width: largeur, height: 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light', reducedMotion: 'reduce' });
    try {
      const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
      await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
      const p = await ctx.newPage(), erreurs: string[] = [];
      p.on('pageerror', (e) => erreurs.push(String(e)));
      await p.goto(v.url + '/');
      await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
      for (const id of Object.values(ID)) await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wmc-g, #feGrid .fe-w[data-id="${id}"] .wmc-b`, { timeout: 45000 });
      const a = await p.evaluate((ids: Record<string, string>) => {
        const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, animations: document.getAnimations().filter((x: any) => x.effect?.target?.closest?.('.wmc,.wma')).map((x: any) => `${x.animationName || x.transitionProperty || '?'} ${x.effect.target.tagName}.${x.effect.target.getAttribute('class')}`) };
        for (const [k, id] of Object.entries(ids)) {
          const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`), b = c.getBoundingClientRect(), vis = (n: any) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
          const corps = c.querySelector('.wmc, .wma'), g = c.querySelector('.wmc-g');
          out[k] = {
            dehors: [...corps.querySelectorAll('*')].filter(vis).filter((n: any) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1); }).map((n: any) => `${n.tagName}.${n.getAttribute('class')}`),
            image: g ? { role: g.getAttribute('role'), dit: g.getAttribute('aria-label'), l: Math.round(g.getBoundingClientRect().width), h: Math.round(g.getBoundingClientRect().height), traits: g.querySelectorAll('path.ln').length } : null,
            barres: [...c.querySelectorAll('.wmc-b > div')].map((d: any) => ({ dit: d.getAttribute('aria-label'), barre: Boolean(d.querySelector('i')), h: Math.round(d.querySelector('i')?.getBoundingClientRect().height ?? 0) })),
            zone: Math.round(c.querySelector('.wmc-b')?.getBoundingClientRect().height ?? 0),
            // Les noms des jours et les repères d'heure : entiers (rien n'est coupé en « … »).
            coupes: [...c.querySelectorAll('.wmc-b small, .wmc-x span')].filter(vis).filter((n: any) => n.scrollWidth > n.clientWidth + 1).map((n: any) => n.textContent),
            reperes: [...c.querySelectorAll('.wmc-x span')].filter(vis).map((n: any) => n.textContent),
            haut: Math.round(b.height),
            entete: (c.querySelector('.fe-h')?.textContent ?? '').replace(/\s+/g, ' ').trim(), enteteHaut: Math.round(c.querySelector('.fe-h')?.getBoundingClientRect().height ?? 0),
            texte: (corps.textContent ?? '').replace(/\s+/g, ' ').trim(),
          };
        }
        return out;
      }, ID);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.deepEqual(a.animations, [], 'aucun mouvement');
      for (const k of Object.keys(ID)) assert.deepEqual(a[k].dehors, [], `${k} : tout tient dans la carte`);
      for (const k of ['capteur', 'capteurGrand', 'jour', 'jourGrand']) {
        assert.equal(a[k].image?.role, 'img', k); assert.match(a[k].image.dit, /minimum .+ maximum .+ dernière valeur/, k);
        assert.ok(a[k].image.l >= 40 && a[k].image.h >= 30, `${k} : une courbe lisible (${a[k].image.l}×${a[k].image.h})`); assert.ok(a[k].image.traits >= 1, k);
      }
      assert.match(a.capteur.texte, /21,5\s*°C/); assert.match(a.jour.texte, /kWh/);
      assert.ok(a.semaine.barres.length >= 1 && a.semaine.barres.length <= 7); assert.ok(a.semaine.barres.some((x: any) => x.barre));
      // Les barres se voient : la zone a une vraie hauteur, la plus haute barre en prend au moins 40 %.
      const haute = Math.max(...a.semaine.barres.map((x: any) => x.h));
      assert.ok(a.semaine.zone >= 60 && haute >= 0.4 * a.semaine.zone, `semaine : barres visibles (plus haute ${haute} px, zone ${a.semaine.zone} px)`);
      // Dans une carte de 3 lignes, la courbe du jour prend la place sous le total (pas une bande de 36 px), avec ses repères d'heure.
      assert.ok(a.jourGrand.image.h >= 70, `jour (3 lignes) : la courbe prend la hauteur (${a.jourGrand.image.h} px)`);
      assert.equal(a.jourGrand.reperes.length, 3, 'trois repères d\'heure');
      for (const k of ['semaine', 'jour', 'jourGrand']) assert.deepEqual(a[k].coupes, [], `${k} : rien de coupé`);
      assert.match(a.semaine.texte, /Pas encore 7 jours/);
      for (const x of a.semaine.barres) assert.match(String(x.dit), x.barre ? /kWh/ : /sans relevé/);
      for (const k of ['jour', 'semaine', 'capteur']) assert.ok(a[k].enteteHaut <= 48, `${k} : l'en-tête tient sur une ligne (${a[k].enteteHaut} px)`);
      // La carte garde la hauteur de ses lignes (r × 74 px + les écarts) : son corps ne la fait pas grandir (hors téléphone, où elle suit son contenu).
      if (largeur > 700) for (const [k, r] of [['capteur', 2], ['jour', 2], ['semaine', 3], ['jourGrand', 3], ['capteurGrand', 2]] as const) assert.ok(a[k].haut <= r * 74 + (r - 1) * 14 + 1, `${k} : ${a[k].haut} px pour ${r} lignes`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-courbes-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}
