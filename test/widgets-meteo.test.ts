// La grande météo de l'accueil (maquette validée « Accueil ») : le widget « Météo » aux trois styles de la maquette
// (« Complète », « Compacte », « Scène »), avec la vraie météo du lieu d'Odin, lue par l'action « meteo » de Hestia :
// maintenant, les 7 jours, les 24 heures, le lever et le coucher du soleil.
// Prouvé ici :
// - ce sont des STYLES de la sorte « meteo » (pas une sorte jumelle) ; un widget « Météo » d'hier, sans style, se relit
//   tel quel (même forme, même donnée, même dessin) ;
// - le serveur ne rend que ce que la source donne et que le widget montre : ni position, ni humidité, ni vent ; aucune
//   ligne sans source à l'écran, et pas de ligne vide à sa place (sa réponse à la question 13) ;
// - lieu non choisi : l'état « vide », sa raison et son bouton ; sans Internet : la dernière valeur, marquée ancienne
//   avec l'heure de sa lecture ; jamais la météo d'un lieu supposé ;
// - les heures et les jours suivent la langue de la page et le format 12 ou 24 h d'Odin, jamais le fuseau de l'appareil ;
// - dans un vrai navigateur (s'il y en a un) : 1280 px en clair, 390 px en sombre, un thème de verre ; « Régler ».
// Aucun fuseau, aucun lieu réel n'est écrit ici : les fuseaux sont pris dans la liste du moteur.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { cleanLayout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { donneeWidget, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), INFOS = lire('src/web/pages/widgets-infos.js'), FAMILLE_TS = lire('src/valhalla/widgets/infos.ts');
const FENETRE_JS = lire('src/web/fenetre.js'), TIROIR_JS = lire('src/web/pages/accueil-tiroir.js'), GRILLE_JS = lire('src/web/pages/accueil-grille.js');
const GRANDS = ['complete', 'compacte', 'scene'] as const;
/**
 * La référence des heures attendues : un fuseau sans décalage, pris dans la liste du moteur (aucun n'est écrit ici). Les
 * heures de la source sont celles de là-bas ; lues dans ce fuseau, elles ressortent telles quelles.
 */
const ZONES_MOTEUR: string[] = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
const decalageA = (z: string, t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }).formatToParts(t).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour) - t; };
const SANS_DECALAGE = ZONES_MOTEUR.find((z) => [Date.UTC(2001, 0, 1, 12), Date.UTC(2001, 6, 1, 12), Date.UTC(2031, 2, 3, 12)].every((t) => decalageA(z, t) === 0))!;
/** Ce qui n'a pas de source (ou n'est pas demandé à la source) : jamais une ligne, ni à l'écran ni dans la donnée. */
const SANS_SOURCE = /mar[ée]e|\bUV\b|ultraviolet|pluie par heure|ciel par heure|\btide\b/i;

// ------------------------------------------------------------------ une fausse source (aucun Odin, aucun réseau)

/** Huit jours et vingt-six heures inventés (plus que ce que le widget montre), à partir d'un jour quelconque. */
const JOURS = Array.from({ length: 8 }, (_, i) => ({ day: `2031-03-${String(3 + i).padStart(2, '0')}`, code: [0, 2, 3, 61, 95, 71, 45, 1][i], hi: 20 + i, lo: 12 + i }));
const HEURES = Array.from({ length: 26 }, (_, i) => ({ t: `${String((13 + i) % 24).padStart(2, '0')}:00`, temp: 18 - (i % 5) }));
const BRUT = () => ({ place: 'Lieu A', lat: 1.5, lon: 2.5, unites: 'metrique', temp: 17.6, feels: 15, code: 3, humidity: 80, wind: 20, rain: 0.4, hi: 21, lo: 11, sunrise: '06:12', sunset: '18:47', days: JOURS, hours: HEURES, at: 1000 } as Record<string, unknown>);
function fausse(o: { lieu?: boolean; heure12?: boolean; meteo?: 'ok' | 'ancien' | 'rien'; donnee?: Record<string, unknown> } = {}) {
  const lus: string[] = [];
  const src = {
    appli: (id: string) => (id === 'gladsheim' ? { id, name: 'Appli du lieu', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined,
    meteo: async () => { lus.push('meteo'); return o.meteo === 'rien' ? undefined : { donnee: o.donnee ?? BRUT(), at: 1000, ancien: o.meteo === 'ancien', motif: o.meteo === 'ancien' ? 'coupé' : '' }; },
    lieu: () => ({ choisi: o.lieu !== false, nom: 'Lieu A', fuseau: '', heure12: o.heure12 === true }),
    maintenant: () => 2000,
  } as unknown as SourceWidget;
  return { src, lus };
}
const W = (o: Record<string, unknown> = {}): Widget => ({ id: 'c2900000', kind: 'meteo', w: 1, c: 4, r: 5, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' };
const etat = async (w: Widget, src: SourceWidget, l: Lecteur = LUI) => (await donneeWidget(w, l, src)) as EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; motif?: string };

/** Ce que la grande météo doit rendre de BRUT (unités métriques, 24 h). */
const ATTENDU = {
  lieu: 'Lieu A', temp: 18, code: 3, max: 21, min: 11, heure12: false,
  jours: JOURS.slice(0, 7).map((j) => ({ jour: j.day, code: j.code, max: j.hi, min: j.lo })),
  heures: HEURES.slice(0, 24).map((h) => ({ h: h.t, temp: h.temp })),
  lever: '06:12', coucher: '18:47',
};

// ------------------------------------------------------------------ les scripts de la page, sans navigateur

interface Declaration { sorte: string; style: string; titre: string; nom: string; appli: string; petit: boolean; tiroir: boolean; w: Record<string, unknown> }
interface Rendu { STYLES: Record<string, Array<[string, string]>>; rendu(kind: unknown, style?: unknown): Declaration | undefined; posables(o?: unknown): Declaration[] }
interface Infos { TEXTES: Record<string, unknown>; heureCourte(h: unknown, heure12: unknown, langue?: string): string; jourCourt(j: unknown, langue?: string): string }
function page(fichiers: string[]): { OdinWidgetsRendu?: Rendu; OdinWidgetsInfos?: Infos } {
  const win: Record<string, unknown> = {};
  for (const src of fichiers) vm.runInNewContext(src, { window: win });
  return win;
}

// ------------------------------------------------------------------ la sorte et ses styles

test('trois styles de la sorte « meteo » (pas de jumeau) : « Complète », « Compacte », « Scène » ; « simple », celui d\'hier, reste le premier', () => {
  const s = sorteDe('meteo')!;
  assert.deepEqual([...s.styles], ['simple', ...GRANDS], 'le style de départ ne change pas');
  assert.deepEqual([s.taille.mini, s.taille.r], [[3, 2], 3], 'la taille de la sorte ne change pas');
  assert.equal(sorteDe('meteo_grande'), undefined); assert.equal(sorteDe('grande_meteo'), undefined);
  const R = page([RENDU, INFOS]).OdinWidgetsRendu!;
  assert.deepEqual(JSON.parse(JSON.stringify(R.STYLES.meteo)), [['simple', 'Simple'], ['complete', 'Complète'], ['compacte', 'Compacte'], ['scene', 'Scène']], 'leurs noms dans « Régler », ceux de la maquette');
  // Le dessin : déclaré par la famille pour les trois styles ; le style d'hier garde le dessin d'aujourd'hui.
  assert.equal(R.rendu('meteo'), undefined, 'sans style : le dessin d\'hier');
  for (const st of GRANDS) {
    const d = R.rendu('meteo', st);
    assert.ok(d, `${st} : déclaré`);
    assert.deepEqual([d!.sorte, d!.style, d!.titre, d!.appli, d!.petit], ['meteo', st, 'Météo', 'gladsheim', false]);
    // Ce sont des styles : ils se choisissent dans « Régler », sans taille à eux (la maquette ne
    // change pas la taille quand on change de style).
    assert.deepEqual([d!.w.c, d!.w.r, d!.tiroir], [undefined, undefined, false], `${st} : aucune taille inventée, pas de ligne au tiroir`);
  }
  // Le tiroir : une seule ligne « Météo » dans la maquette ; aucune ligne de plus pour ses styles.
  const lignes = R.posables({ proprio: true, aDroit: () => true }).filter((d) => d.sorte === 'meteo');
  assert.equal(lignes.length, 0, `aucune ligne « grande météo » ajoutée au tiroir (${lignes.map((d) => d.style).join(', ')})`);
  // Une déclaration sans « tiroir » reste proposée, comme avant (les autres familles ne changent pas).
  assert.equal(R.rendu('heure', 'horloge')!.tiroir, true);
  // Les mots : un libellé juste aussi pour une lecture ancienne ; « Max » et « min » restent collés à leur valeur.
  const G = page([RENDU, INFOS]).OdinWidgetsInfos!.TEXTES.grande as { heures: string; maxMin: (a: string, b: string) => string };
  assert.equal(G.heures, 'Heure par heure', 'ni « prochaines » ni « 24 » : une lecture ancienne garde ses heures d\'alors');
  assert.equal(G.maxMin('21°', '11°'), 'Max\u00a021° · min\u00a011°', 'une espace insécable : « 11° » ne reste pas seul à la ligne');
});

test('le serveur : seulement ce que la source donne et que le widget montre (maintenant, 7 jours, 24 heures, lever et coucher)', async () => {
  for (const st of GRANDS) {
    const e = await etat(W({ style: st }), fausse().src);
    assert.deepEqual(e, { etat: 'ok', at: 1000, donnee: ATTENDU }, st);
    assert.doesNotMatch(JSON.stringify(e), /lat|lon|humid|wind|rain|feels|place/, `${st} : ni position, ni ce que le widget ne montre pas`);
  }
  // 12 h comme Odin est réglé ; unités impériales : chaque température convertie, comme la météo en petit.
  const im = await etat(W({ style: 'complete' }), fausse({ heure12: true, donnee: { ...BRUT(), unites: 'imperial' } }).src);
  assert.equal(im.donnee!.heure12, true);
  assert.deepEqual([im.donnee!.temp, im.donnee!.max, im.donnee!.min, (im.donnee!.jours as Array<{ max: number }>)[0].max, (im.donnee!.heures as Array<{ temp: number }>)[0].temp], [64, 70, 52, 68, 64]);
  // Une donnée abîmée : ce qui n'est pas lisible est laissé, jamais remplacé par un chiffre inventé.
  const ab = await etat(W({ style: 'complete' }), fausse({ donnee: { ...BRUT(), hi: 'x', sunrise: '6h', sunset: undefined, days: [{ day: 'hier', code: 0, hi: 1, lo: 0 }, JOURS[0], { day: '2031-03-04', code: 1, hi: Number.NaN, lo: 2 }], hours: [{ t: '25:00', temp: 3 }, HEURES[0], { t: '14:00', temp: '4' }, null] } }).src);
  assert.deepEqual(ab.donnee, { lieu: 'Lieu A', temp: 18, code: 3, heure12: false, jours: [ATTENDU.jours[0]], heures: [ATTENDU.heures[0]] });
  for (const temp of [undefined, null, '21', Number.NaN]) assert.deepEqual(await etat(W({ style: 'scene' }), fausse({ donnee: { ...BRUT(), temp } }).src), { etat: 'vide', raison: 'meteo_pas_lue' }, String(temp));
});

test('lieu non choisi : « vide », sa raison, rien de lu ; sans Internet : la dernière valeur, marquée ancienne avec l\'heure de sa lecture', async () => {
  for (const st of GRANDS) {
    const f = fausse({ lieu: false });
    assert.deepEqual(await etat(W({ style: st }), f.src), { etat: 'vide', raison: 'lieu_non_choisi' }, st);
    assert.deepEqual(f.lus, [], `${st} : jamais la météo d'un lieu supposé`);
    assert.deepEqual(await etat(W({ style: st }), fausse({ meteo: 'rien' }).src), { etat: 'vide', raison: 'meteo_pas_lue' });
    assert.deepEqual(await etat(W({ style: st }), fausse({ meteo: 'ancien' }).src), { etat: 'ancien', at: 1000, donnee: ATTENDU, motif: 'coupé' });
  }
});

test('un widget « Météo » d\'hier (sans style) se relit tel quel : la même donnée qu\'avant ce lot, le même dessin', async () => {
  const brut = BRUT();
  assert.deepEqual(await etat(W(), fausse({ donnee: brut }).src), { etat: 'ok', at: 1000, donnee: brut });
  assert.deepEqual(await etat(W({ style: 'simple' }), fausse({ donnee: brut }).src), { etat: 'ok', at: 1000, donnee: brut });
  assert.deepEqual(await etat(W(), fausse({ meteo: 'ancien', donnee: brut }).src), { etat: 'ancien', at: 1000, donnee: brut, motif: 'coupé' });
  assert.equal(page([RENDU, INFOS]).OdinWidgetsRendu!.rendu('meteo', ''), undefined);
});

// ------------------------------------------------------------------ la ligne « Météo » du tiroir « Ajouter un widget »

/** La maquette (« Ajouter un widget ») : une seule ligne « Météo », qui pose la grande météo (« Complète ») en 4 × 5. */
const POSEE = { kind: 'meteo', style: 'complete', w: 1, c: 4, r: 5 };
const nu = (x: unknown) => JSON.parse(JSON.stringify(x ?? null));
/** Les objets que les lignes du tiroir de fenetre.js posent pour la sorte « meteo » (relus du code, jamais exécutés). */
const lignesMeteo = () => [...FENETRE_JS.matchAll(/item\((\{ kind: 'meteo'[^}]*\})/g)].map((m) => nu(vm.runInNewContext(`(${m[1]})`)));
/** Le glisser de la page (OdinTiroir.glisse) et la grille de la page (OdinGrille.taille), chargés sans navigateur. */
const glisse = (t: unknown) => { const win: Record<string, any> = {}; vm.runInNewContext(TIROIR_JS, { window: win }); return nu(win.OdinTiroir.glisse(t)); };
const tailleGrille = (w: unknown) => { const win: Record<string, any> = {}; vm.runInNewContext(GRILLE_JS, { window: win }); return nu(win.OdinGrille.taille(w)); };
const IDS_APPLIS = ['gladsheim'];

test('la ligne « Météo » du tiroir pose la grande météo de la maquette : « Complète », 4 colonnes sur 5 lignes ; « Ajouter » et « glisser » posent la même chose', () => {
  assert.deepEqual(lignesMeteo(), [POSEE], 'la ligne « Météo » pose « Complète » en 4 × 5');
  // Glissée sur la page : le même objet, refait en entier (rien de ce qui vient du glisser n'est recopié).
  assert.deepEqual(glisse(JSON.stringify(POSEE)), POSEE, 'glissée : la même chose qu\'« Ajouter »');
  assert.deepEqual(glisse(JSON.stringify({ kind: 'meteo' })), POSEE, 'un glisser « meteo » d\'avant : refait en « Complète » 4 × 5');
  assert.deepEqual(glisse(JSON.stringify({ kind: 'meteo', style: 'scene', w: 3, c: 12, r: 7, pc: 2, label: 'x', module: 'y', toucher: { a: 1 } })), POSEE, 'rien du glisser n\'est recopié');
  // Hestia la range telle quelle, et la grille de la page la dessine à cette taille.
  const rangee = cleanLayout({ pages: [{ id: 'b2900101', name: 'P', widgets: [{ ...POSEE, id: 'c2900101' }] }] }, IDS_APPLIS).pages[0].widgets[0];
  assert.deepEqual(nu(rangee), { id: 'c2900101', ...POSEE }, 'gardée : sorte, style, taille');
  assert.deepEqual(tailleGrille(POSEE), { c: 4, r: 5 });
  // Son dessin : celui déclaré pour « Complète ».
  assert.equal(page([RENDU, INFOS]).OdinWidgetsRendu!.rendu(POSEE.kind, POSEE.style)?.style, 'complete');
});

test('un widget « Météo » d\'hier (sans style ni taille rangés) reste « Simple » à sa taille d\'aujourd\'hui, à côté d\'une neuve', () => {
  const R = page([RENDU, INFOS]).OdinWidgetsRendu!;
  const l = cleanLayout({ pages: [{ id: 'b2900102', name: 'P', widgets: [{ id: 'c2900102', kind: 'meteo' }, { id: 'c2900103', kind: 'meteo', w: 2 }, { id: 'c2900104', kind: 'meteo', w: 1, c: 4, r: 3 }, { ...lignesMeteo()[0], id: 'c2900105' }] }] }, IDS_APPLIS).pages[0].widgets.map(nu);
  assert.deepEqual(l.slice(0, 3), [
    { id: 'c2900102', kind: 'meteo', w: 1, c: 4, r: 3 }, { id: 'c2900103', kind: 'meteo', w: 2, c: 8, r: 3 }, { id: 'c2900104', kind: 'meteo', w: 1, c: 4, r: 3 },
  ], 'd\'hier : aucun style écrit, la hauteur de départ de la sorte (3), sa largeur');
  for (const w of l.slice(0, 3)) assert.equal(R.rendu(w.kind, w.style), undefined, `${w.id} : le dessin d'hier (« Simple »)`);
  assert.deepEqual(tailleGrille({ kind: 'meteo', w: 1 }), { c: 4, r: 3 }, 'la page aussi : sans taille rangée, 4 × 3 comme hier');
  // La neuve, posée par le tiroir, à côté : « Complète » en 4 × 5.
  assert.deepEqual(l[3], { id: 'c2900105', ...POSEE });
});

test('le tiroir n\'a toujours qu\'une ligne « Météo » : celle qui pose « Complète » ; les styles n\'en ajoutent pas', () => {
  const lignes = lignesMeteo();
  assert.equal(lignes.length, 1, 'une seule ligne « Météo » écrite dans le tiroir');
  assert.equal(lignes[0].style, 'complete', 'et c\'est elle qui pose la grande météo');
  assert.equal((FENETRE_JS.match(/T\.meteo, T\.meteoQuoi/g) ?? []).length, 1, 'un seul nom « Météo » dans le tiroir');
  const R = page([RENDU, INFOS]).OdinWidgetsRendu!;
  assert.deepEqual(nu(R.posables({ proprio: true, aDroit: () => true }).filter((d) => d.sorte === 'meteo').map((d) => d.style)), [], 'aucune ligne de plus pour ses styles');
});

test('rien sans source : aucune ligne de marée, d\'UV, de ciel ou de pluie par heure, ni dans le code de la famille ni dans la donnée', async () => {
  assert.doesNotMatch(INFOS, SANS_SOURCE); assert.doesNotMatch(FAMILLE_TS, SANS_SOURCE);
  const e = await etat(W({ style: 'complete' }), fausse().src);
  for (const h of e.donnee!.heures as Array<Record<string, unknown>>) assert.deepEqual(Object.keys(h).sort(), ['h', 'temp'], 'une heure : son heure et sa température, pas de ciel ni de pluie');
});

test('les heures et les jours suivent la langue de la page et 12 ou 24 h d\'Odin ; jamais le fuseau de l\'appareil', () => {
  const I = page([RENDU, INFOS]).OdinWidgetsInfos!;
  const attenduH = (h: number, m: number, langue: string, h12: boolean) => new Intl.DateTimeFormat(langue, { timeZone: SANS_DECALAGE, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).format(Date.UTC(2001, 0, 1, h, m));
  const attenduJ = (a: number, mo: number, j: number, langue: string) => new Intl.DateTimeFormat(langue, { timeZone: SANS_DECALAGE, weekday: 'short' }).format(Date.UTC(a, mo - 1, j));
  for (const langue of ['fr', 'en', 'de', 'es', 'ar', 'ja', 'sw']) {
    for (const h12 of [false, true]) assert.equal(I.heureCourte('19:05', h12, langue), attenduH(19, 5, langue, h12), `${langue} ${h12 ? '12 h' : '24 h'}`);
    assert.equal(I.jourCourt('2031-03-03', langue), attenduJ(2031, 3, 3, langue), langue);
  }
  assert.notEqual(I.heureCourte('19:05', true, 'en'), I.heureCourte('19:05', false, 'en'), '12 h et 24 h diffèrent');
  assert.notEqual(I.jourCourt('2031-03-03', 'en'), I.jourCourt('2031-03-03', 'de'), 'la langue compte');
  // Le fuseau de l'appareil n'y entre pas : l'heure lue là-bas reste celle de là-bas, la machine fût-elle aux deux bouts
  // du monde (les deux fuseaux extrêmes de la liste du moteur ; le navigateur, plus bas, est réglé sur un autre encore).
  assert.ok(SANS_DECALAGE, 'un fuseau sans décalage, dans la liste du moteur');
  const off = (z: string) => decalageA(z, Date.UTC(2001, 0, 1, 12));
  const bouts = [...ZONES_MOTEUR].sort((x, y) => off(x) - off(y)), avantTZ = process.env.TZ;
  try {
    for (const z of [bouts[0], bouts[bouts.length - 1]]) {
      process.env.TZ = z;
      const J = page([RENDU, INFOS]).OdinWidgetsInfos!;
      for (const [h, m] of [[0, 0], [19, 5], [23, 59]]) assert.equal(J.heureCourte(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, false, 'en'), attenduH(h, m, 'en', false), `${z} ${h}:${m}`);
      assert.equal(J.jourCourt('2031-03-03', 'en'), attenduJ(2031, 3, 3, 'en'), z);
    }
  } finally { if (avantTZ === undefined) delete process.env.TZ; else process.env.TZ = avantTZ; }
  for (const x of ['', '7:05', '24:00', '19:60', 1905, null, '2031-03-03']) assert.equal(I.heureCourte(x, false, 'en'), '', `illisible : rien (${String(x)})`);
  for (const x of ['', '2031-13-01', '03/03/2031', null, 20310303]) assert.equal(I.jourCourt(x, 'en'), '', `illisible : rien (${String(x)})`);
});

// ------------------------------------------------------------------ un vrai Odin d'essai, dans un vrai navigateur

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
const g = () => valhallaOf()!.ctx('gladsheim');
const PAGE = 'b2900001', ID = { complete: 'c2900001', compacte: 'c2900002', scene: 'c2900003', hier: 'c2900004' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Météo', widgets: [
  { id: ID.complete, kind: 'meteo', style: 'complete', w: 1, c: 4, r: 5 }, { id: ID.compacte, kind: 'meteo', style: 'compacte', w: 1, c: 4, r: 2 },
  { id: ID.scene, kind: 'meteo', style: 'scene', w: 1, c: 4, r: 3 }, { id: ID.hier, kind: 'meteo', w: 1, c: 4, r: 3 },
] }] });
const ranger = async (f: unknown) => { g().saveSettings({ fenetre: undefined }); const r = await valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text); };

declare const document: any, window: any, getComputedStyle: any, DataTransfer: any, DragEvent: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; keyboard: { press(k: string): Promise<void> };
  on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };

/** Un fuseau de la liste du moteur à quatre heures au moins de celui de la machine : l'appareil est « ailleurs ». */
const ZONES: string[] = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
const decalage = (z: string) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour) - Math.floor(Date.now() / 3600_000) * 3600_000) / 60_000; };
const ICI = Intl.DateTimeFormat().resolvedOptions().timeZone, APPAREIL = ZONES.find((z) => Math.abs(decalage(z) - decalage(ICI)) >= 240)!;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'apparence'].includes(m.id)) });
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  // Un lieu « choisi » sans position lisible : la lecture du serveur ne sort jamais (l'état vient du détournement).
  g().saveSettings({ ville: 'Lieu A', villeNom: 'Lieu A', fuseau: '', lat: '', lon: '', heure: '24h', suppose: '' });
  await ranger(FENETRE());
  if (pw) nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

/** Les états montrés, par identifiant : la donnée rendue par la VRAIE sorte, sur une fausse source. */
async function etatsDe(o: Parameters<typeof fausse>[0] = {}): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const st of GRANDS) out[ID[st]] = { ...(await etat(W({ style: st }), fausse(o).src)) };
  out[ID.hier] = { ...(await etat(W(), fausse(o).src)) };
  return out;
}
async function ouvrirPage(largeur: number, forces: () => Record<string, Record<string, unknown> | undefined>, o: { sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, timezoneId: APPAREIL, colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${o.sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json(), f = forces();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: Record<string, unknown>) => (f[w.id as string] ? { id: w.id, kind: w.kind, page: w.page, ...f[w.id as string] } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.complete}"]`, { timeout: 45000 });
  return { ctx, page: p, erreurs };
}
const posee = (p: Page) => p.waitForFunction(() => { const w = window as any, t = [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); }).join(';'), avant = w.__posee; w.__posee = { t, n: avant && avant.t === t ? avant.n + 1 : 0 }; return w.__posee.n >= 5; }, undefined, { timeout: 15000, polling: 100 });
/** Ce que la page montre de chaque carte. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), r = (n: any) => n.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, vw, langue: document.documentElement.lang || '' };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = r(c), sonde = document.createElement('i'); c.append(sonde);
    const couleur = (x: string) => { sonde.style.color = `var(${x})`; return getComputedStyle(sonde).color; };
    const t = c.querySelector('.wm-t'), bande = c.querySelector('.wm-heures');
    out[nom] = {
      h: Math.round(b.height), l: Math.round(b.width), dedans: b.left >= 0 && b.right <= vw + 1, texte: txt(c), titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')),
      pastille: txt(c.querySelector('.wr-pastille')), ligne: txt(c.querySelector('.wr-ligne')), bouton: txt(c.querySelector('.wr-btn')),
      temp: txt(t), ciel: txt(c.querySelector('.wm-ciel')), maxmin: txt(c.querySelector('.wm-mm')), style: c.querySelector('.wm')?.dataset.style ?? '',
      heures: [...c.querySelectorAll('.wm-h')].map((n: any) => [txt(n.querySelector('.wm-hh')), txt(n.querySelector('.wm-ht'))]), iconesHeures: c.querySelectorAll('.wm-h svg').length,
      jours: [...c.querySelectorAll('.wm-j')].map((n: any) => txt(n.querySelector('.wm-jn'))), soleil: txt(c.querySelector('.wm-soleil')),
      vides: [...c.querySelectorAll('.wm *')].filter((n: any) => !n.children.length && !txt(n) && n.tagName !== 'I' && n.tagName !== 'svg' && !n.closest('svg')).length,
      basScene: c.querySelector('.wm-scene') ? Math.round(b.bottom - parseFloat(getComputedStyle(c).paddingBottom) - parseFloat(getComputedStyle(c).borderBottomWidth) - r(c.querySelector('.wm-scene')).bottom) : null,
      bande: bande ? { focus: bande.tabIndex === 0, nom: bande.getAttribute('aria-label') ?? '', h: Math.round(r(bande).height), dedans: r(bande).left >= b.left - 1 && r(bande).right <= b.right + 1 } : null,
      dansCarte: [...c.querySelectorAll('.wm, .wm *')].filter((n: any) => !n.closest('.wm-heures') || n.classList.contains('wm-heures')).every((n: any) => r(n).width === 0 || (r(n).right <= b.right + 1 && r(n).bottom <= b.bottom + 1 && r(n).left >= b.left - 1)),
      couleurTemp: t ? getComputedStyle(t).color : '', ink: couleur('--ink'), muted: couleur('--muted'), couleurCiel: c.querySelector('.wm-ciel') ? getComputedStyle(c.querySelector('.wm-ciel')).color : '',
    };
    sonde.remove();
  }
  return out;
}, ID);

/** Les étiquettes attendues, calculées comme la page (langue de la page, 24 h), loin du fuseau de l'appareil. */
const heureAttendue = (hhmm: string, langue: string) => new Intl.DateTimeFormat(langue || undefined, { timeZone: SANS_DECALAGE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.UTC(2001, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))));
const jourAttendu = (j: string, langue: string) => new Intl.DateTimeFormat(langue || undefined, { timeZone: SANS_DECALAGE, weekday: 'short' }).format(Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8))));

test('navigateur, 1280 px, clair : les trois styles aux tailles posées, sans ligne vide ni sans source ; le widget d\'hier inchangé ; ancien marqué', { skip: sansNav }, async () => {
  const montre: { e: Record<string, Record<string, unknown>> } = { e: await etatsDe() };
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, () => montre.e);
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.scene}"] .wm-t`, { timeout: 30000 }); await posee(p);
    const a = await vu(p);
    assert.equal(a.deborde, false, 'la page ne déborde pas');
    for (const st of GRANDS) {
      const c = a[st];
      assert.equal(c.style, st); assert.equal(c.titre, 'Météo'); assert.match(c.sous, /Lieu A/, `${st} : le lieu d'Odin`);
      assert.equal(c.temp, '18°', `${st} : la température d'Odin`); assert.equal(c.dedans, true); assert.equal(c.dansCarte, true, `${st} : rien ne sort de la carte`);
      assert.doesNotMatch(c.texte, /Mar[ée]e|\bUV\b|—|\bundefined\b|NaN/, `${st} : aucune ligne sans source, aucun tiret à leur place (${c.texte})`);
      assert.equal(c.vides, 0, `${st} : aucune ligne vide`); assert.equal(c.couleurTemp, c.ink, `${st} : la couleur du texte du thème`);
      assert.equal(c.pastille, '', `${st} : à jour, pas de pastille`);
    }
    // Les tailles posées : 5, 2 et 3 lignes de la grille (74 px, écart 14 px) ; la carte ne grandit pas.
    assert.deepEqual([a.complete.h, a.compacte.h, a.scene.h], [5 * 74 + 4 * 14, 2 * 74 + 14, 3 * 74 + 2 * 14]);
    // « Complète » : maintenant, les 24 heures (heure et température, sans ciel), le lever et le coucher, les jours.
    const c = a.complete;
    assert.match(c.maxmin, /21°/); assert.match(c.maxmin, /11°/); assert.ok(c.ciel, 'le ciel de maintenant, en mots');
    assert.equal(c.heures.length, 24, 'les 24 heures'); assert.equal(c.iconesHeures, 0, 'pas de ciel par heure');
    assert.deepEqual(c.heures.map((h: string[]) => h[0]), HEURES.slice(0, 24).map((h) => heureAttendue(h.t, a.langue)), 'les heures de là-bas, pas celles de l\'appareil');
    assert.deepEqual(c.heures[0][1], '18°');
    assert.equal(c.jours.length, 7, 'les 7 jours, à la taille de la maquette (5 lignes)'); assert.deepEqual(c.jours, JOURS.slice(0, c.jours.length).map((j) => jourAttendu(j.day, a.langue)));
    assert.match(c.soleil, new RegExp(heureAttendue('06:12', a.langue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.match(c.soleil, new RegExp(heureAttendue('18:47', a.langue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual([c.bande?.focus, c.bande?.dedans], [true, true], 'la bande des heures se parcourt au clavier, dans la carte'); assert.ok(c.bande?.nom, 'elle a un nom');
    // « Scène » : son pavé teinté remplit la carte jusqu'en bas (la maquette : la scène couvre la carte).
    assert.ok(Math.abs(a.scene.basScene) <= 2, `la scène descend jusqu'au bas de la carte (reste ${a.scene.basScene} px)`);
    // « Compacte » et « Scène » : maintenant seulement.
    for (const st of ['compacte', 'scene']) { assert.deepEqual([a[st].heures.length, a[st].jours.length, a[st].soleil], [0, 0, ''], st); }
    // Le widget d'hier : son dessin d'aujourd'hui, aucun des trois.
    assert.equal(a.hier.style, ''); assert.equal(a.hier.titre, 'Météo');
    await capture(p, 'meteo-1280-clair');
    // Sans Internet : la dernière valeur reste, marquée ancienne avec l'heure de sa lecture (jamais une heure inventée).
    const lu = Date.now() - 3 * 3600_000;
    montre.e = Object.fromEntries(Object.entries(await etatsDe({ meteo: 'ancien' })).map(([k, e]) => [k, { ...e, at: lu }]));
    await p.click('#fenetre .fe-tab[aria-pressed="true"]');
    await p.waitForFunction((s: string) => Boolean(document.querySelector(s)?.textContent), `#feGrid .fe-w[data-id="${ID.complete}"] .wr-pastille`, { timeout: 20000 });
    await posee(p);
    const b = await vu(p);
    for (const st of GRANDS) { assert.equal(b[st].pastille, 'Donnée ancienne, lue il y a 3 h', `${st} : marquée (dite ainsi à qui ne voit pas la pastille)`); assert.equal(b[st].temp, '18°', `${st} : la dernière valeur`); assert.equal(b[st].dansCarte, true); }
    // Lieu non choisi : la ligne commune et son bouton, jamais un chiffre.
    montre.e = Object.fromEntries(Object.values(ID).map((id) => [id, { etat: 'vide', raison: 'lieu_non_choisi' }]));
    await p.click('#fenetre .fe-tab[aria-pressed="true"]');
    await p.waitForFunction((s: string) => Boolean(document.querySelector(s)), `#feGrid .fe-w[data-id="${ID.scene}"] .wr-ligne`, { timeout: 20000 });
    const d = await vu(p);
    for (const st of GRANDS) { assert.deepEqual([d[st].ligne, d[st].bouton, d[st].temp], ['Rien à montrer : choisis ton lieu.', 'Choisir le lieu', ''], st); }
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, sombre : rien ne déborde, la couleur du thème, « ⋯ » et la bande des heures de 44 px', { skip: sansNav }, async () => {
  const e = await etatsDe();
  const { ctx, page: p, erreurs } = await ouvrirPage(390, () => e, { sombre: true });
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.scene}"] .wm-t`, { timeout: 30000 }); await posee(p);
    const a = await vu(p);
    assert.equal(a.deborde, false, 'la page ne déborde pas');
    for (const st of GRANDS) {
      const c = a[st];
      assert.equal(c.dedans, true, st); assert.equal(c.dansCarte, true, `${st} : rien ne sort de la carte`); assert.ok(c.l > a.vw * 0.8, `${st} : toute la largeur`);
      assert.equal(c.couleurTemp, c.ink, `${st} : la couleur du texte du thème sombre`); assert.equal(c.temp, '18°');
      assert.ok(await p.evaluate((s: string) => { const b = document.querySelector(s).getBoundingClientRect(); return b.width >= 44 && b.height >= 44; }, `#feGrid .fe-w[data-id="${ID[st]}"] .wr-plus`), `${st} : « ⋯ » de 44 px`);
    }
    assert.ok(a.complete.bande.h >= 44, 'la bande des heures : 44 px au moins');
    assert.equal(a.complete.heures.length, 24);
    // Le focus se voit sur la bande des heures.
    const focus = await p.evaluate((s: string) => { const n = document.querySelector(s); n.focus(); const st = getComputedStyle(n); return document.activeElement === n && (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0); }, `#feGrid .fe-w[data-id="${ID.complete}"] .wm-heures`);
    assert.equal(focus, true, 'un focus visible');
    await capture(p, 'meteo-390-sombre');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur : « Régler » propose les quatre styles ; le widget d\'hier passe à « Scène », Hestia le garde', { skip: sansNav }, async () => {
  const hier = await etatsDe(), scene = (await etatsDe())[ID.scene];
  const montre = { e: hier };
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, () => montre.e);
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.hier}"] .wr-plus`, { timeout: 30000 });
    await p.evaluate(() => window.OdinFenetre.edit(true));
    await p.waitForSelector(`#fenetre.fe-edit #feGrid .fe-w[data-id="${ID.hier}"] .wr-plus`, { timeout: 15000 });
    await p.click(`#feGrid .fe-w[data-id="${ID.hier}"] .wr-plus`); await p.waitForSelector('dialog.wr-regler[open]');
    const styles = await p.evaluate(() => [...document.querySelectorAll('dialog.wr-regler input[name="wrStyle"]')].map((i: any) => [i.value, i.checked, i.closest('label').textContent]));
    assert.deepEqual(styles, [['simple', true, 'Simple'], ['complete', false, 'Complète'], ['compacte', false, 'Compacte'], ['scene', false, 'Scène']]);
    await p.evaluate(() => { (document.querySelector('dialog.wr-regler input[name="wrStyle"][value="scene"]') as any).click(); ([...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent === 'Valider') as any).click(); });
    montre.e = { ...hier, [ID.hier]: scene };
    await p.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé') as any).click(); });
    await p.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const garde = ((g().settings.fenetre as { pages: Array<{ id: string; widgets: Array<Record<string, unknown>> }> }).pages.find((x) => x.id === PAGE)!.widgets).find((w) => w.id === ID.hier)!;
    assert.deepEqual([garde.kind, garde.style], ['meteo', 'scene'], 'Hestia garde la sorte et le style');
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.hier}"] .wm[data-style="scene"] .wm-t`, { timeout: 20000 });
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await ranger(FENETRE()); }
});

test('navigateur, un thème de verre : les trois styles gardent les couleurs que le thème donne à la carte', { skip: sansNav }, async (t) => {
  const va = valhallaOf()!, verre = await va.act('apparence', 'theme', { theme: 'glace' });
  if (!verre.ok) { t.skip('le thème de verre ne se pose pas sur cet Odin'); return; }
  const e = await etatsDe();
  const { ctx, page: p, erreurs } = await ouvrirPage(1280, () => e);
  try {
    await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.scene}"] .wm-t`, { timeout: 30000 }); await posee(p);
    const a = await vu(p);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.odinTheme), 'glace');
    for (const st of GRANDS) { assert.equal(a[st].couleurTemp, a[st].ink, `${st} : la couleur du texte de la carte`); assert.equal(a[st].couleurCiel, a[st].muted, `${st} : le ciel, en couleur douce`); assert.equal(a[st].dansCarte, true); }
    assert.equal(a.deborde, false);
    await capture(p, 'meteo-1280-verre');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await va.act('apparence', 'theme', { theme: 'valhalla' }); }
});

/**
 * Dans la page : « Ajouter » (ou le glisser) de la ligne « Météo » du tiroir, puis « Terminé ». Rend l'identifiant du
 * widget posé et ce que Hestia a rangé. Le serveur ne lit pas la météo ici : chaque widget reçoit l'état de son style.
 */
async function poserMeteo(largeur: number, geste: 'ajouter' | 'glisser') {
  const e = await etatsDe(), complete = e[ID.complete];
  const forces = new Proxy({}, { get: (_x, id) => (typeof id === 'string' && e[id] ? e[id] : complete) }) as Record<string, Record<string, unknown>>;
  const o = await ouvrirPage(largeur, () => forces), p = o.page;
  await p.evaluate(() => window.OdinFenetre.edit(true));
  await p.waitForSelector('#fenetre.fe-edit .fe-ajout', { timeout: 15000 });
  const avant: string[] = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((n: any) => n.dataset.id));
  await p.click('#fenetre .fe-ajout'); await p.waitForFunction(() => document.querySelector('#feTiroir.open'));
  await p.click('#feTiroir .fe-chips button[data-f="infos"]');
  const noms: string[] = await p.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
  if (geste === 'ajouter') await p.click('#feTiroir button[aria-label="Ajouter Météo"]');
  else {
    // Le vrai glisser de la ligne : son « dragstart » remplit le transfert, le « drop » sur la grille le relit.
    await p.evaluate(() => {
      const it = [...document.querySelectorAll('#feTiroir .fe-it')].find((n: any) => n.querySelector('b')?.textContent === 'Météo') as any, dt = new DataTransfer();
      it.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      document.querySelector('#feGrid').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
  }
  await p.waitForFunction((n: number) => document.querySelectorAll('#feGrid > .fe-w').length === n + 1, avant.length, { timeout: 15000 });
  const id: string = await p.evaluate((a: string[]) => [...document.querySelectorAll('#feGrid > .fe-w')].map((n: any) => n.dataset.id).find((x: string) => !a.includes(x)), avant);
  await p.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé') as any).click(); });
  await p.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
  const rangee = ((g().settings.fenetre as { pages: Array<{ id: string; widgets: Array<Record<string, unknown>> }> }).pages.find((x) => x.id === PAGE)!.widgets).find((w) => w.id === id);
  await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wm[data-style="complete"] .wm-t`, { timeout: 30000 }); await posee(p);
  const vue = await p.evaluate((i: string) => {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${i}"]`), b = c.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    const dansCarte = [...c.querySelectorAll('.wm, .wm *')].filter((n: any) => !n.closest('.wm-heures') || n.classList.contains('wm-heures')).every((n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.right <= b.right + 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1); });
    return { deborde: document.documentElement.scrollWidth > vw + 1, vw, h: Math.round(b.height), l: Math.round(b.width), dedans: b.left >= 0 && b.right <= vw + 1, dansCarte,
      heures: c.querySelectorAll('.wm-h').length, jours: c.querySelectorAll('.wm-j').length, temp: (c.querySelector('.wm-t')?.textContent ?? '').trim() };
  }, id);
  return { ...o, noms, id, rangee, vue };
}

for (const [largeur, geste] of [[1280, 'ajouter'], [1280, 'glisser'], [390, 'ajouter'], [390, 'glisser']] as const) {
  test(`navigateur, ${largeur} px : « Météo » du tiroir (${geste === 'ajouter' ? '« Ajouter »' : 'glissée sur la page'}) pose la grande météo, sans débordement`, { skip: sansNav }, async () => {
    let ctx: Contexte | undefined;
    try {
      const r = await poserMeteo(largeur, geste); ctx = r.ctx;
      assert.equal(r.noms.filter((n) => n === 'Météo').length, 1, 'une seule ligne « Météo » dans le tiroir');
      assert.deepEqual(r.rangee, { id: r.id, ...POSEE }, 'Hestia garde « Complète » en 4 × 5');
      assert.equal(r.vue.deborde, false, 'la page ne déborde pas'); assert.equal(r.vue.dedans, true); assert.equal(r.vue.dansCarte, true, 'rien ne sort de la carte');
      assert.equal(r.vue.temp, '18°'); assert.equal(r.vue.heures, 24, 'les 24 heures');
      if (largeur === 1280) {
        assert.equal(r.vue.h, 5 * 74 + 4 * 14, '5 lignes de la grille'); assert.equal(r.vue.jours, 7, 'les 7 jours, à la taille de la maquette');
      } else assert.ok(r.vue.l > r.vue.vw * 0.8, 'toute la largeur au téléphone');
      await capture(r.page, `meteo-tiroir-${largeur}-${geste}`);
      assert.deepEqual(r.erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx?.close(); await ranger(FENETRE()); }
  });
}
