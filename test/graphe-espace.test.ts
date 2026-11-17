// Le « Graphe 3D » commun (src/web/pages/graphe-espace.js) : sa logique pure (placement stable, projection en
// perspective, point de devant sous le doigt, niveau de détail, repli), puis le dessin dans un faux navigateur :
// il reçoit les mêmes données que le 2D, un nom piégé reste du texte, le repli monte le graphe 2D, et le choix
// « Graphe | Graphe 3D » est retenu par endroit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';

const src = readFileSync(new URL('../src/web/pages/graphe-espace.js', import.meta.url), 'utf8');
/** Les objets venus du faux navigateur (autre « monde » de vm) ramenés à de simples valeurs pour les comparer. */
const brut = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type P3 = { x: number; y: number; z: number };
type Cam = { yaw: number; pitch: number; dist: number; cible: P3 };
type Pt = { id: string; sx: number; sy: number; prof: number; taille: number; visible?: boolean; prio?: number };
interface Logique {
  graine(t: string): number;
  normaliser(d: unknown): { noeuds: Array<{ id: string; label: string; deg: number; groupe: string; couleur: string; hub: boolean }>; liens: Array<{ a: string; b: string; i: number; j: number }>; legende: unknown[] };
  placer3D(n: unknown[], l: unknown[], o?: Record<string, unknown>): P3[];
  cameraDepart(): Cam;
  projeter(p: P3, c: Cam, l: number, h: number): { sx: number; sy: number; prof: number; echelle: number; visible: boolean };
  choisir(pts: Pt[], x: number, y: number, r?: number): string | null;
  niveauDetail(ms: number, n: number, b?: number): number;
  NIVEAUX: Array<{ etoiles: number; halo: boolean; etiquettes: number }>;
  doitReplier(o: Record<string, unknown>): boolean;
  vueInitiale(m: string | null, d?: string): string;
  etiquettes(pts: Pt[], l: Map<string, number>, max: number, larg: number, haut: number): string[];
  centresGroupes(pts: Array<Pt & { groupe?: string; couleur?: string }>): Array<{ groupe: string; x: number; y: number; n: number }>;
  rayonPoint(deg: number, hub: boolean): number;
  versRgb(c: string): { r: number; g: number; b: number } | null;
  lumineuse(c: string): string | null;
  camEntre(a: Cam, b: Cam, t: number): Cam;
  langueDe(c: string): string;
  texte(cle: string, l: string): string;
}
type Ctrl = { el: unknown; replie: boolean; update(d: unknown): void; detacher(): void; etat?: () => { niveau: number; points: number } };
interface API { mount(b: unknown, d: unknown, o?: unknown): Ctrl; choix(b: unknown, o: unknown): { vue(): string; basculer(v: string): void; update(d: unknown): void; el: unknown }; logique: Logique; TEXTES: Record<string, Record<string, string>> }

function charger(o: { stockage?: Map<string, string>; graph2D?: boolean } = {}) {
  const nav = fauxNavigateur();
  const sb = nav.sandbox as Record<string, unknown>;
  (sb.document as Record<string, unknown>).documentElement = { lang: 'fr' };
  const deux: Array<{ boite: unknown; data: unknown }> = [];
  if (o.graph2D) (nav.window as Record<string, unknown>).OdinGraph = { mount: (boite: unknown, data: unknown) => { deux.push({ boite, data }); return { el: boite, update() {}, redessiner() {} }; } };
  if (o.stockage) { const s = o.stockage; sb.localStorage = { getItem: (k: string) => (s.has(k) ? s.get(k)! : null), setItem: (k: string, v: string) => { s.set(k, v); } }; }
  const ctx = vm.createContext(sb);
  vm.runInContext(src, ctx);
  const G = (nav.window as { OdinGrapheEspace?: API }).OdinGrapheEspace;
  assert.ok(G, 'window.OdinGrapheEspace est posé');
  return { nav, G, L: G.logique, deux, ctx };
}

/** Une petite toile 2D qui note ce qu'on y écrit (le faux navigateur n'en a pas). */
function avecToile<T>(nav: ReturnType<typeof fauxNavigateur>, f: (ecrits: string[]) => T, o: { webgl?: () => unknown } = {}): T {
  const proto = Object.getPrototypeOf(nav.make('canvas')) as { getContext: (k: string) => unknown };
  const avant = proto.getContext;
  const ecrits: string[] = [];
  const rien = () => {};
  proto.getContext = (k: string) => (k === 'webgl' ? (o.webgl ? o.webgl() : {}) : k === 'experimental-webgl' ? (o.webgl ? null : {}) : k === '2d' ? new Proxy({ fillText: (t: string) => { ecrits.push(String(t)); }, measureText: (t: string) => ({ width: String(t).length * 6 }), createRadialGradient: () => ({ addColorStop: rien }) } as Record<string, unknown>, { get: (c, p: string) => (p in c ? c[p] : rien), set: (c, p: string, v) => { c[p] = v; return true; } }) : null);
  try { return f(ecrits); } finally { proto.getContext = avant; }
}

// Un graphe d'exemple : deux amas reliés, un point seul, un lien en double et une boucle (à ignorer).
const donnees = {
  label: 'Graphe d\'essai',
  legend: [['#57C98A', 'site qui répond'], ['#EE6A55', 'service en erreur']],
  nodes: [
    { id: 'odin', label: 'Odin', hub: true, color: '#4F9DDE' },
    { id: 'a', label: 'alpha', color: '#57C98A' }, { id: 'b', label: 'beta', color: '#57C98A' }, { id: 'c', label: 'gamma', color: '#57C98A' },
    { id: 'x', label: 'xi', color: '#EE6A55' }, { id: 'y', label: 'upsilon', color: '#EE6A55' },
    { id: 'seul', label: 'seul' },
  ],
  edges: [['odin', 'a'], ['odin', 'b'], ['a', 'b'], ['b', 'c'], ['odin', 'x'], ['x', 'y'], { a: 'a', b: 'odin' }, ['c', 'c'], ['a', 'inconnu']],
};

test('le composant se charge deux fois sans erreur ; textes complets dans chaque langue', () => {
  const { G, ctx } = charger();
  vm.runInContext(src, ctx);
  for (const f of ['mount', 'choix']) assert.equal(typeof (G as unknown as Record<string, unknown>)[f], 'function', f);
  const cles = Object.keys(G.TEXTES.fr);
  for (const [l, t] of Object.entries(G.TEXTES)) for (const k of cles) assert.ok(typeof t[k] === 'string' && t[k].length > 0, `${l}.${k}`);
  assert.equal(G.logique.langueDe('fr-FR'), 'fr');
  assert.equal(G.logique.langueDe('sw'), 'sw');
  assert.equal(G.logique.langueDe('xx-YY'), 'en', 'langue inconnue ici : l\'anglais, jamais le français supposé');
  assert.equal(G.logique.texte('graphe3d', 'fr'), 'Graphe 3D');
});

test('normaliser : mêmes données que le 2D, liens sans doublon ni boucle, degrés, groupes tirés de la légende', () => {
  const { L } = charger();
  const copie = JSON.parse(JSON.stringify(donnees));
  const g = L.normaliser(donnees);
  assert.deepEqual(donnees, copie, 'les données reçues ne sont pas modifiées');
  assert.equal(g.noeuds.length, 7);
  assert.equal(g.liens.length, 6, 'doublon, boucle et lien vers un inconnu retirés');
  const par = new Map(g.noeuds.map((n) => [n.id, n]));
  assert.equal(par.get('odin')!.deg, 3); assert.equal(par.get('seul')!.deg, 0);
  assert.equal(par.get('a')!.groupe, 'site qui répond'); assert.equal(par.get('x')!.groupe, 'service en erreur');
  assert.equal(par.get('seul')!.groupe, '');
  assert.match(par.get('seul')!.couleur, /^(#|rgb)/, 'un point sans couleur reçoit celle de son groupe');
  // Une couleur trop sombre pour l'espace est éclaircie ; une claire reste.
  const sombre = L.versRgb(L.lumineuse('#202020')!);
  assert.ok(sombre && sombre.r > 0x60, 'gris très sombre éclairci');
  assert.equal(L.lumineuse('#FFE45E'), 'rgb(255,228,94)');
  assert.equal(L.versRgb('rgb(1, 2, 3)')!.b, 3); assert.equal(L.versRgb('pas une couleur'), null);
  assert.ok(L.rayonPoint(9, false) > L.rayonPoint(1, false), 'plus de liens : plus gros');
  assert.ok(L.rayonPoint(1, true) > L.rayonPoint(1, false), 'un centre est plus gros');
});

test('placer3D : même graphe, même dessin ; dans la sphère ; les liés et les groupes se rapprochent ; une place donnée est gardée', () => {
  const { L } = charger();
  const g = L.normaliser(donnees);
  const a = L.placer3D(g.noeuds, g.liens), b = L.placer3D(L.normaliser(JSON.parse(JSON.stringify(donnees))).noeuds, g.liens);
  assert.deepEqual(a, b, 'graine fixe : deux fois la même place');
  for (const p of a) { assert.ok([p.x, p.y, p.z].every(Number.isFinite)); assert.ok(Math.hypot(p.x, p.y, p.z) <= 1 + 1e-6); }
  const i = (id: string) => g.noeuds.findIndex((n) => n.id === id), d = (u: string, v: string) => { const p = a[i(u)], q = a[i(v)]; return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); };
  assert.ok(d('x', 'y') < d('y', 'c'), 'deux points reliés (et du même groupe) sont plus près que deux points sans rapport');
  // Les places qui ont un sens (fraîcheur, usage…) ne bougent pas.
  const fixes = L.normaliser({ nodes: [{ id: 'p', pos: { x: 0.5, y: -0.25, z: 1 } }, { id: 'q', pos: { x: -1, y: 0, z: 0 } }], edges: [['p', 'q']] });
  assert.deepEqual(brut(L.placer3D(fixes.noeuds, fixes.liens)), [{ x: 0.5, y: -0.25, z: 1 }, { x: -1, y: 0, z: 0 }]);
  assert.equal(L.placer3D([], []).length, 0);
});

test('placer3D tient 300 points et 600 liens (sans rien de faux : nombres finis, rayon 1 au plus)', () => {
  const { L } = charger();
  const nodes = Array.from({ length: 300 }, (_, k) => ({ id: `n${k}`, label: `point ${k}`, groupe: `g${k % 7}` }));
  const edges = Array.from({ length: 600 }, (_, k) => [`n${k % 300}`, `n${(k * 37 + 11) % 300}`]);
  const g = L.normaliser({ nodes, edges });
  const t0 = Date.now(); const P = L.placer3D(g.noeuds, g.liens); const ms = Date.now() - t0;
  assert.equal(P.length, 300);
  assert.ok(P.every((p) => [p.x, p.y, p.z].every(Number.isFinite) && Math.hypot(p.x, p.y, p.z) <= 1 + 1e-6));
  assert.ok(ms < 20000, `placement en ${ms} ms (machine chargée : borne large, mesure non officielle)`);
});

test('projeter : perspective (devant = plus gros, plus grande profondeur), derrière la caméra invisible, rotation', () => {
  const { L } = charger();
  const cam = { yaw: 0, pitch: 0, dist: 3, cible: { x: 0, y: 0, z: 0 } };
  const c = L.projeter({ x: 0, y: 0, z: 0 }, cam, 400, 300);
  assert.equal(c.sx, 200); assert.equal(c.sy, 150);
  const devant = L.projeter({ x: 0.5, y: 0, z: 1 }, cam, 400, 300), fond = L.projeter({ x: 0.5, y: 0, z: -1 }, cam, 400, 300);
  assert.ok(devant.prof > fond.prof && devant.echelle > fond.echelle, 'le point de devant est plus près et plus gros');
  assert.ok(devant.sx - 200 > fond.sx - 200, 'et plus écarté du centre');
  assert.equal(L.projeter({ x: 0, y: 0, z: 5 }, cam, 400, 300).visible, false, 'derrière la caméra : caché');
  const haut = L.projeter({ x: 0, y: 1, z: 0 }, cam, 400, 300); assert.ok(haut.sy < 150, 'y vers le haut de l\'écran');
  const tourne = L.projeter({ x: 1, y: 0, z: 0 }, { ...cam, yaw: Math.PI / 2 }, 400, 300);
  assert.ok(Math.abs(tourne.sx - 200) < 1e-6, 'un quart de tour : le point passe devant, au centre');
  const vol = L.camEntre(L.cameraDepart(), { ...cam, cible: { x: 1, y: 1, z: 1 } }, 1);
  assert.deepEqual(brut(vol.cible), { x: 1, y: 1, z: 1 }, 'au bout du vol, la caméra vise le point');
});

test('choisir : deux points superposés → celui de devant ; à côté → le plus proche à portée (40 px au doigt) ; loin → rien', () => {
  const { L } = charger();
  const pts = [{ id: 'fond', sx: 100, sy: 100, prof: -4, taille: 8 }, { id: 'devant', sx: 102, sy: 100, prof: -2, taille: 8 }, { id: 'cache', sx: 300, sy: 300, prof: -1, taille: 8, visible: false }];
  assert.equal(L.choisir(pts, 101, 100), 'devant');
  assert.equal(L.choisir([{ id: 'petit', sx: 50, sy: 50, prof: -3, taille: 2 }], 64, 50, 20), 'petit', 'un petit point se touche à 20 px');
  assert.equal(L.choisir(pts, 160, 160), null);
  assert.equal(L.choisir(pts, 300, 300), null, 'un point caché ne se choisit pas');
});

test('niveau de détail : au-dessus du budget on simplifie, bien en dessous on rajoute du détail', () => {
  const { L } = charger();
  assert.equal(L.niveauDetail(20, 0), 1); assert.equal(L.niveauDetail(20, 3), 3, 'borne haute');
  assert.equal(L.niveauDetail(2, 2), 1); assert.equal(L.niveauDetail(2, 0), 0, 'borne basse');
  assert.equal(L.niveauDetail(8, 1), 1); assert.equal(L.niveauDetail(NaN, 2), 2);
  // Seuils écartés : une image à 3,5 ms (moins de pixels au niveau 1) ne renvoie pas au niveau 0, où elle repasserait
  // au-dessus du budget (aller-retour de netteté à chaque changement de niveau).
  assert.equal(L.niveauDetail(3.5, 1), 1); assert.equal(L.niveauDetail(2.5, 1), 0);
  const N = L.NIVEAUX; assert.ok(N[0].etoiles > N[1].etoiles && N[1].etoiles > N[2].etoiles && N[3].etoiles === 0, 'moins de poussière');
  assert.ok(N[0].halo && !N[3].halo, 'plus de halo au dernier niveau');
});

test('repli : pas de toile, moins de mouvement, pas de carte graphique, image trop lente ; « Graphe 3D » touché l\'emporte', () => {
  const { L } = charger();
  assert.equal(L.doitReplier({ ctx2d: false, force: true }), true, 'sans toile, rien à faire');
  assert.equal(L.doitReplier({ reducedMotion: true }), true);
  assert.equal(L.doitReplier({ webgl: false }), true);
  assert.equal(L.doitReplier({ premiereImageMs: 500 }), true);
  assert.equal(L.doitReplier({ premiereImageMs: 5, webgl: true }), false);
  assert.equal(L.doitReplier({ reducedMotion: true, webgl: false, force: true }), false, 'choisi à la main : on montre le 3D (sans animation)');
  assert.equal(L.vueInitiale(null, undefined), '2d'); assert.equal(L.vueInitiale(null, '3d'), '3d'); assert.equal(L.vueInitiale('3d', '2d'), '3d'); assert.equal(L.vueInitiale('n\'importe', '2d'), '2d');
});

test('étiquettes et groupes : aucun nom n\'en recouvre un autre ; le nom d\'un groupe se pose au-dessus de son amas', () => {
  const { L } = charger();
  const pts = [{ id: 'a', sx: 100, sy: 100, prof: -1, taille: 4, prio: 5 }, { id: 'b', sx: 104, sy: 102, prof: -2, taille: 4, prio: 1 }, { id: 'c', sx: 250, sy: 100, prof: -3, taille: 4 }];
  const l = new Map([['a', 60], ['b', 60], ['c', 60]]);
  assert.deepEqual(brut(L.etiquettes(pts, l, 10, 400, 300)), ['a', 'c'], 'b recouvrirait a : il est laissé');
  assert.deepEqual(brut(L.etiquettes(pts, l, 1, 400, 300)), ['a'], 'au plus max');
  const g = L.centresGroupes([{ ...pts[0], groupe: 'G' }, { ...pts[1], groupe: 'G' }, { ...pts[2], groupe: 'seul' }]);
  assert.equal(g.length, 1, 'un groupe d\'un seul point n\'a pas de titre'); assert.ok(g[0].y < 96);
});

test('mount sans toile : repli vers le graphe 2D, monté avec les MÊMES données', () => {
  const { G, nav, deux } = charger({ graph2D: true });
  const boite = nav.make('div');
  const c = G.mount(boite, donnees, { force: true });
  assert.equal(c.replie, true);
  assert.equal(deux.length, 1); assert.equal(deux[0].data, donnees, 'le 2D reçoit l\'objet tel quel');
  let motif = '';
  const c2 = G.mount(nav.make('div'), donnees, { force: true, onReplier: (_b: unknown, m: string) => { motif = m; } });
  assert.equal(c2.replie, true); assert.equal(motif, 'toile');
});

test('mount : le 3D reçoit les mêmes données, un nom piégé reste du texte, un bouton par point pour le clavier', () => {
  const { G, nav } = charger();
  const piege = '<img src=x onerror="window.__x=1">';
  const d = { ...donnees, nodes: [...donnees.nodes, { id: 'p', label: piege, sub: 'piège' }], edges: [...donnees.edges, ['p', 'odin']] };
  avecToile(nav, (ecrits) => {
    const boite = nav.make('div') as unknown as { textContent: string; querySelectorAll(s: string): Array<{ textContent: string; attributes: Record<string, string> }> };
    const c = G.mount(boite, d, { force: true });
    assert.equal(c.replie, false);
    const boutons = boite.querySelectorAll('button').map((b) => b.textContent);
    for (const n of d.nodes) assert.ok(boutons.some((t) => t.startsWith(n.label)), `bouton pour ${n.label}`);
    assert.ok(boutons.includes(`${piege} — piège`), 'le nom piégé est écrit tel quel, en texte');
    assert.ok(boite.textContent.includes('8 points · 7 liens'), 'le compteur');
    const toile = boite.querySelectorAll('canvas')[0];
    assert.match(toile.attributes['aria-label'], /^Graphe d'essai — Graphe 3D : 8 points, 7 liens\.$/);
    assert.ok(ecrits.length > 0, 'des noms sont écrits sur la toile');
    assert.ok(ecrits.some((t) => t === 'SITE QUI RÉPOND'), 'le nom d\'un groupe en capitales');
    c.update({ ...d, nodes: d.nodes.slice(0, 3), edges: [['odin', 'a']] });
    assert.ok(boite.textContent.includes('3 points · 1 liens'));
    c.detacher();
  });
});

test('choix « Graphe | Graphe 3D » : 2D par défaut, le 3D sur demande avec les mêmes données, retenu par endroit', () => {
  const stock = new Map<string, string>();
  const { G, nav, deux } = charger({ graph2D: true, stockage: stock });
  avecToile(nav, () => {
    const hote = nav.make('div') as unknown as { querySelectorAll(s: string): Array<{ textContent: string; attributes: Record<string, string>; click(): void }>; textContent: string };
    const v = G.choix(hote, { cle: 'appli:essai', donnees });
    assert.equal(v.vue(), '2d'); assert.equal(deux.length, 1); assert.equal(deux[0].data, donnees);
    const seg = hote.querySelectorAll('button').slice(0, 2);
    assert.deepEqual(brut(seg.map((b) => b.textContent)), ['Graphe', 'Graphe 3D']);
    assert.equal(seg[0].attributes['aria-pressed'], 'true');
    seg[1].click();
    assert.equal(v.vue(), '3d'); assert.equal(stock.get('odin.graphe.vue.appli:essai'), '3d', 'le choix est retenu pour cet endroit');
    assert.equal(seg[1].attributes['aria-pressed'], 'true');
    assert.ok(hote.querySelectorAll('canvas').length === 1, 'la toile du 3D est montée');
    // Un autre endroit garde son propre choix.
    const autre = G.choix(nav.make('div'), { cle: 'appli:autre', donnees });
    assert.equal(autre.vue(), '2d');
    const memeEndroit = G.choix(nav.make('div'), { cle: 'appli:essai', donnees });
    assert.equal(memeEndroit.vue(), '3d', 'revenir au même endroit rouvre le 3D');
  });
  // Sans stockage du navigateur, la page marche quand même.
  const sans = charger({ graph2D: true });
  const v2 = sans.G.choix(sans.nav.make('div'), { cle: 'x', donnees, defaut: '3d' });
  assert.equal(v2.vue(), '2d', 'faux navigateur sans toile : repli honnête vers le 2D');
});

test('le fichier : ni HTML brut, ni adresse extérieure, ni bibliothèque, ni nom d\'un produit tiers', () => {
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /https?:\/\//, 'rien d\'extérieur (ni CDN, ni police, ni image)');
  assert.doesNotMatch(src, /\bimport\s*\(|<script|require\(/);
  assert.doesNotMatch(src, /three\.js|THREE\.|d3\.|tiktok|obsidian/i);
  assert.match(src, /if \(window\.OdinGrapheEspace\) return;/);
});

test('la carte des applis : chaque appli porte sa famille comme groupe (le 3D en fait des amas colorés et nommés)', () => {
  const va = readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8');
  const dessin = va.slice(va.indexOf('function drawGraph('), va.indexOf('async function manips('));
  assert.match(dessin, /st\.modules\.map\(\(m\) => \(\{[^\n]*groupe: m\.family/, 'chaque appli : groupe = sa famille');
  assert.match(dessin, /title: `Famille \$\{f\}`, groupe: f/, 'chaque famille : son groupe');
  // Ce que le 3D en tire : deux familles → deux couleurs et deux noms de groupe (et non une seule couleur pour tous).
  const { L } = charger();
  const g = L.normaliser({ nodes: [{ id: 'odin', hub: true, color: '#E3AC3F' }, { id: 'fam:Réseau', hub: true, groupe: 'Réseau' }, { id: 'vordr', sub: 'Réseau', groupe: 'Réseau' }, { id: 'var', sub: 'Sécurité', groupe: 'Sécurité' }, { id: 'fam:Sécurité', hub: true, groupe: 'Sécurité' }], edges: [] });
  const par = new Map(g.noeuds.map((n) => [n.id, n]));
  assert.equal(par.get('vordr')!.groupe, 'Réseau'); assert.equal(par.get('var')!.groupe, 'Sécurité');
  assert.equal(par.get('vordr')!.couleur, par.get('fam:Réseau')!.couleur, 'une famille, une couleur');
  assert.notEqual(par.get('vordr')!.couleur, par.get('var')!.couleur, 'deux familles, deux couleurs');
});

test('« Graphe 3D » retenu : respecté à la réouverture, même avec « moins de mouvement » demandé et sans WebGL', () => {
  const stock = new Map<string, string>([['odin.graphe.vue.appli:essai', '3d']]);
  const { G, nav, deux } = charger({ graph2D: true, stockage: stock });
  const mm = () => ({ matches: true }); // moins de mouvement demandé
  (nav.sandbox as Record<string, unknown>).matchMedia = mm; (nav.window as Record<string, unknown>).matchMedia = mm;
  avecToile(nav, () => {
    const hote = nav.make('div') as unknown as { querySelectorAll(s: string): unknown[] };
    const v = G.choix(hote, { cle: 'appli:essai', donnees });
    assert.equal(v.vue(), '3d');
    assert.equal(hote.querySelectorAll('canvas').length, 1, 'la toile du 3D est montée, pas le 2D');
    assert.equal(deux.length, 0);
    // Sans choix retenu, le même appareil reste sur le 2D (rien n'est imposé).
    const autre = G.choix(nav.make('div'), { cle: 'appli:autre', donnees, defaut: '3d' });
    assert.equal(autre.vue(), '2d'); assert.equal(deux.length, 1);
  }, { webgl: () => null });
});

test('WebGL n\'est demandé qu\'une fois, et le contexte d\'essai est rendu aussitôt', () => {
  const { G, nav } = charger();
  let demandes = 0, rendus = 0;
  avecToile(nav, () => {
    const a = G.mount(nav.make('div'), donnees), b = G.mount(nav.make('div'), donnees), c = G.mount(nav.make('div'), donnees);
    assert.equal(a.replie || b.replie || c.replie, false);
    assert.equal(demandes, 1, 'un seul contexte WebGL créé pour trois graphes');
    assert.equal(rendus, 1, 'et il est rendu (WEBGL_lose_context)');
    a.detacher(); b.detacher(); c.detacher();
  }, { webgl: () => { demandes++; return { getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { rendus++; } } : null) }; } });
});

test('démontage : retiré de la page alors que la boucle est arrêtée, le graphe se débranche tout seul ; detacher() de choix aussi', () => {
  const { G, nav } = charger();
  const sb = nav.sandbox as Record<string, unknown>, doc = sb.document as Record<string, unknown>;
  const ecoutes = new Map<string, Set<unknown>>();
  doc.addEventListener = (t: string, f: unknown) => { if (!ecoutes.has(t)) ecoutes.set(t, new Set()); ecoutes.get(t)!.add(f); };
  doc.removeEventListener = (t: string, f: unknown) => { ecoutes.get(t)?.delete(f); };
  const observateurs: Array<{ cb: (es: unknown[]) => void; coupe: boolean }> = [];
  class Obs { o: { cb: (es: unknown[]) => void; coupe: boolean }; constructor(cb: (es: unknown[]) => void) { this.o = { cb, coupe: false }; observateurs.push(this.o); } observe() {} disconnect() { this.o.coupe = true; } }
  sb.IntersectionObserver = Obs; sb.ResizeObserver = Obs;
  avecToile(nav, () => {
    const c = G.mount(nav.make('div'), donnees, { force: true }) as Ctrl & { el: { isConnected?: boolean } };
    assert.equal(c.replie, false);
    assert.equal(ecoutes.get('visibilitychange')?.size, 1);
    const io = observateurs[1];
    // À l'écran, puis hors de l'écran : la boucle s'arrête.
    c.el.isConnected = true; io.cb([{ isIntersecting: true }]); io.cb([{ isIntersecting: false }]);
    assert.equal(io.coupe, false, 'encore dans la page : rien n\'est débranché');
    // La page se redessine : le graphe est retiré alors qu'il ne dessine plus.
    c.el.isConnected = false; io.cb([{ isIntersecting: false }]);
    assert.ok(observateurs.every((x) => x.coupe), 'observateurs de taille et de visibilité débranchés');
    assert.equal(ecoutes.get('visibilitychange')?.size, 0, 'plus d\'écoute de l\'onglet');
    // Le choix « Graphe | Graphe 3D » remplacé par l'appelant : detacher() débranche son 3D.
    const n0 = observateurs.length;
    const v = G.choix(nav.make('div'), { cle: 'x', donnees, defaut: '3d' });
    assert.equal(v.vue(), '3d');
    (v as unknown as { detacher(): void }).detacher();
    assert.ok(observateurs.slice(n0).length > 0 && observateurs.slice(n0).every((x) => x.coupe));
    assert.equal(ecoutes.get('visibilitychange')?.size, 0);
  });
  const va = readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8');
  assert.match(va, /const avant = graphesApplis\.get\(mod\); if \(avant && avant\.detacher\)/, 'le graphe d\'une appli : l\'ancien est débranché');
  assert.match(va, /if \(graphUi && graphUi\.detacher\) \{ try \{ graphUi\.detacher\(\);/, 'la carte des applis : l\'ancienne est débranchée');
  const pk = readFileSync(new URL('../src/web/packets.js', import.meta.url), 'utf8');
  assert.match(pk, /if \(graph && graph\.detacher\) \{ try \{ graph\.detacher\(\);/, 'la carte d\'Ariane : l\'ancienne est débranchée');
});

test('placer3D ne gèle pas la page sur un grand graphe : tours plafonnés (n² × tours borné), résultat juste', () => {
  const { L } = charger();
  const lm = L as unknown as { toursMax(n: number): number };
  for (const n of [300, 1000, 3000, 10000]) assert.ok(n * n * lm.toursMax(n) <= Math.max(1.2e7, 3 * n * n), `n=${n}`);
  assert.ok(lm.toursMax(300) >= 87, 'un graphe ordinaire garde ses tours (même dessin qu\'avant)');
  const n = 2000;
  const g = L.normaliser({ nodes: Array.from({ length: n }, (_, k) => ({ id: `n${k}`, groupe: `g${k % 9}` })), edges: Array.from({ length: n * 2 }, (_, k) => [`n${k % n}`, `n${(k * 37 + 11) % n}`]) });
  const P = L.placer3D(g.noeuds, g.liens, { tours: 500 });
  assert.equal(P.length, n);
  assert.ok(P.every((p) => [p.x, p.y, p.z].every(Number.isFinite) && Math.hypot(p.x, p.y, p.z) <= 1 + 1e-6));
});

// ---- Corrections d'affichage après le contrôle à l'écran (zoom, noms, cadrage, centre saturé)
type LogiqueAffichage = {
  pasMolette(dy: number, mode?: number): number;
  zoomVers(c: Cam, k: number, mx: number, my: number, l: number, h: number, r?: number): Cam;
  borneDist(d: number, r?: number): number;
  rayonGraphe(P: P3[]): number;
  cadrer(P: P3[], c: Cam, l: number, h: number, m?: number): number;
  poserEtiquettes(pts: Pt[], l: Map<string, number>, max: number, larg: number, haut: number, o?: { occupes?: unknown[]; places?: string[] }): Array<{ id: string; x: number; y: number }>;
  nombreNoms(l: number, h: number, p: number): number;
  poserTitres(c: Array<{ groupe: string; couleur?: string; x: number; y: number; n: number }>, w: (t: string) => number, l: number, h: number): Array<{ groupe: string; texte: string; x: number; y: number; x1: number; x2: number; y1: number; y2: number }>;
  nomCourt(t: string, max?: number): string;
  densiteHalo(t: number[], l: number, h: number): number;
};

test('molette : un cran = ×0,9 au plus (4 crans gardent tout le graphe), bornes liées au rayon, zoom vers le curseur', () => {
  const { L } = charger();
  const A = L as unknown as Logique & LogiqueAffichage;
  assert.ok(Math.abs(A.pasMolette(-100) - 0.9) < 1e-9, 'un cran vers soi : ×0,9');
  assert.ok(Math.abs(A.pasMolette(100) - 1 / 0.9) < 1e-9, 'un cran vers l\'arrière : ÷0,9');
  assert.ok(Math.abs(A.pasMolette(-300) - 0.9) < 1e-9, 'un delta énorme ne compte que pour un cran');
  assert.ok(Math.abs(A.pasMolette(-3, 1) - 0.9) < 2e-3, 'en lignes aussi (3 lignes ≈ un cran)');
  assert.ok(A.pasMolette(-10) > 0.98, 'un pavé tactile zoome en douceur');
  let cam = L.cameraDepart();
  for (let i = 0; i < 4; i++) cam = A.zoomVers(cam, A.pasMolette(-300), 400, 300, 800, 600, 1);
  assert.ok(cam.dist > 1.5, `après 4 crans la caméra reste hors de l'amas (distance ${cam.dist.toFixed(2)})`);
  assert.equal(A.borneDist(0.01, 1), 0.3); assert.equal(A.borneDist(99, 1), 7); assert.equal(A.borneDist(99, 0.5), 3.5, 'bornes au rayon du graphe');
  // Vers le curseur : le point du monde sous le curseur reste sous le curseur.
  const c0 = { yaw: 0.7, pitch: 0.3, dist: 3, cible: { x: 0, y: 0, z: 0 } };
  const mx = 600, my = 200, larg = 800, haut = 600;
  const s0 = Math.min(larg, haut) * 0.85 / c0.dist, ox = (mx - larg / 2) / s0, oy = -(my - haut / 2) / s0;
  const R = { x: Math.cos(0.7), y: 0, z: -Math.sin(0.7) }, U = { x: -Math.sin(0.7) * Math.sin(0.3), y: Math.cos(0.3), z: -Math.cos(0.7) * Math.sin(0.3) };
  const sous = { x: R.x * ox + U.x * oy, y: R.y * ox + U.y * oy, z: R.z * ox + U.z * oy };
  const c1 = A.zoomVers(c0, 0.9, mx, my, larg, haut, 5);
  const p = L.projeter(sous, c1, larg, haut);
  assert.ok(Math.abs(p.sx - mx) < 1 && Math.abs(p.sy - my) < 1, `le point sous le curseur y reste (${p.sx.toFixed(1)}, ${p.sy.toFixed(1)})`);
  const c2 = A.zoomVers(c0, 0.9, 400, 300, larg, haut, 1);
  assert.deepEqual(brut(c2.cible), { x: 0, y: 0, z: 0 }, 'au milieu : la cible ne bouge pas');
  const loin = A.zoomVers({ ...c0, cible: { x: 0.95, y: 0, z: 0 } }, 0.5, 790, 10, larg, haut, 1);
  assert.ok(Math.hypot(loin.cible.x, loin.cible.y, loin.cible.z) <= 1 + 1e-9, 'la cible ne sort pas de la sphère du graphe');
});

test('cadrage : tout le graphe tient dans la toile (à tous les angles de la rotation), plus près sur une toile large', () => {
  const { L } = charger();
  const A = L as unknown as Logique & LogiqueAffichage;
  const g = L.normaliser({ nodes: Array.from({ length: 80 }, (_, k) => ({ id: `n${k}`, groupe: `g${k % 5}` })), edges: Array.from({ length: 120 }, (_, k) => [`n${k % 80}`, `n${(k * 13 + 7) % 80}`]) });
  const P = L.placer3D(g.noeuds, g.liens);
  assert.ok(Math.abs(A.rayonGraphe(P) - 1) < 1e-6);
  for (const [larg, haut] of [[390, 520], [1280, 540], [770, 540]]) {
    const cam = L.cameraDepart(); cam.dist = A.cadrer(P, cam, larg, haut);
    for (let a = 0; a < 16; a++) {
      const c = { ...cam, yaw: cam.yaw + a * Math.PI / 8 };
      for (const p of P) { const q = L.projeter(p, c, larg, haut); assert.ok(q.visible && q.sx >= 0 && q.sx <= larg && q.sy >= 0 && q.sy <= haut, `${larg}×${haut} angle ${a}`); }
    }
  }
  const cam = L.cameraDepart();
  assert.ok(A.cadrer(P, cam, 390, 520) < 2.45, 'un téléphone : le graphe est plus grand qu\'avec la distance fixe d\'avant');
});

test('noms : groupes posés d\'abord (zone protégée), noms écartés, nombre selon la place, « … » et sans icône', () => {
  const { L } = charger();
  const A = L as unknown as Logique & LogiqueAffichage;
  // Un nom qui ne tient pas sous son point essaie au-dessus, à droite, à gauche.
  const pts = [{ id: 'a', sx: 100, sy: 100, prof: -1, taille: 4, prio: 5 }, { id: 'b', sx: 104, sy: 102, prof: -2, taille: 4, prio: 1 }];
  const l = new Map([['a', 60], ['b', 60]]);
  const poses = A.poserEtiquettes(pts, l, 10, 400, 300);
  assert.deepEqual(brut(poses.map((x) => x.id)), ['a', 'b'], 'le second nom trouve une autre place');
  assert.ok(poses[1].y < 100, 'au-dessus de son point');
  // Une zone protégée (le nom d'un groupe) n'est jamais recouverte.
  const zone = { x1: 0, x2: 400, y1: 0, y2: 300 };
  assert.equal(A.poserEtiquettes(pts, l, 10, 400, 300, { occupes: [zone] }).length, 0);
  assert.equal(A.nombreNoms(390, 520, 45), 16, 'un téléphone : une quinzaine de noms');
  assert.equal(A.nombreNoms(1280, 640, 45), 45, 'un grand écran : le plafond');
  // Deux groupes au même endroit : écartés (pas collés), et tous les deux posés.
  const t = A.poserTitres([{ groupe: 'Maison', x: 200, y: 100, n: 9 }, { groupe: 'Données', x: 205, y: 102, n: 8 }], (s) => s.length * 8, 400, 300);
  assert.equal(t.length, 2);
  assert.equal(t[0].texte, 'MAISON');
  assert.ok(t[0].y2 + 4 <= t[1].y1 || t[1].y2 + 4 <= t[0].y1 || t[0].x2 + 8 <= t[1].x1 || t[1].x2 + 8 <= t[0].x1, 'une marge entre les deux');
  assert.equal(A.nomCourt('Serveur de fichiers du bureau principal'), 'Serveur de fichiers du bure…');
  assert.equal(Array.from(A.nomCourt('Serveur de fichiers du bureau principal')).length, 28);
  assert.equal(A.nomCourt('📦 Données'), 'Données', 'l\'icône de la famille n\'est pas écrite sur la toile');
  assert.equal(A.nomCourt('🛡️ Sécurité'), 'Sécurité');
  assert.equal(A.nomCourt('Odin'), 'Odin'); assert.equal(A.nomCourt('📦'), '📦', 'une icône seule reste');
});

test('centre dense : l\'intensité des halos baisse quand ils couvrent beaucoup de la toile (pas de blanc saturé)', () => {
  const { L } = charger();
  const A = L as unknown as Logique & LogiqueAffichage;
  assert.equal(A.densiteHalo([3, 4, 5], 800, 600), 1, 'peu de halos : pleine intensité');
  const dense = A.densiteHalo(Array.from({ length: 300 }, () => 20), 800, 600);
  assert.ok(dense < 0.6 && dense >= 0.35, `beaucoup de gros halos : intensité ${dense.toFixed(2)}`);
});
