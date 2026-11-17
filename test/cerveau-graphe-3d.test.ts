// Le « Graphe 3D » du Cerveau (src/web/brain.js, avec le composant commun src/web/pages/graphe-espace.js) :
// mêmes notes et mêmes liens que le 2D, groupes = types de notes, un toucher ouvre la note comme le 2D,
// un grand Cerveau montre ses notes les plus liées et le dit, un titre piégé reste du texte, et le repli
// (pas de toile 3D) remonte le dessin 2D d'ici.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';

const BRAIN = readFileSync(new URL('../src/web/brain.js', import.meta.url), 'utf8');
const ESPACE = readFileSync(new URL('../src/web/pages/graphe-espace.js', import.meta.url), 'utf8');
const brut = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type Noeud = { id: string; title: string; type: string; folder?: string; tags?: string[]; degree?: number };
type Lien = { from: string; to: string; kind: string };
type Espace = { label: string; nodes: Array<{ id: string; label: string; groupe: string; color: string; sub: string }>; edges: string[][]; legend: string[][]; counter(n: unknown[], e: unknown[]): string; onOpen(id: string): void };
type G3 = {
  versEspace(d: unknown, max?: number): Espace;
  donneesGraphe(d: unknown): { nodes: Noeud[]; edges: Lien[] };
  choixGraphe(h: unknown, d: unknown, m: (b: unknown) => unknown): { vue(): string } | null;
  ESPACE_MAX: number;
};

function charger(o: { espace?: boolean; stockage?: Map<string, string> } = {}) {
  const nav = fauxNavigateur();
  const sb = nav.sandbox as Record<string, unknown>;
  (sb.document as Record<string, unknown>).documentElement = { lang: 'fr' };
  sb.cancelAnimationFrame = () => {};
  if (o.stockage) { const s = o.stockage; sb.localStorage = { getItem: (k: string) => (s.has(k) ? s.get(k)! : null), setItem: (k: string, v: string) => { s.set(k, v); } }; }
  const demandes: string[] = [];
  nav.brancherServeur((u: string) => { demandes.push(u); return Promise.resolve({ status: 200, json: async () => ({ ok: false }) }); });
  const ctx = vm.createContext(sb);
  if (o.espace) vm.runInContext(ESPACE, ctx);
  vm.runInContext(BRAIN, ctx);
  const B = (nav.window as { OdinBrain?: { graphe3D?: G3 } }).OdinBrain;
  assert.ok(B && B.graphe3D, 'window.OdinBrain.graphe3D est posé');
  return { nav, G3: B.graphe3D, demandes, win: nav.window as Record<string, unknown> };
}

/** Un petit Cerveau : des notes de plusieurs types, deux dans un même dossier, un connecteur, un lien deviné. */
const cerveau = {
  nodes: [
    { id: 'Projets/alpha.md', title: 'Alpha', type: 'projet', folder: 'Projets', tags: [], degree: 0 },
    { id: 'Projets/beta.md', title: 'Bêta', type: 'projet', folder: 'Projets', tags: [], degree: 0 },
    { id: 'Gens/kemi.md', title: 'Kemi', type: 'personne', folder: 'Gens', tags: [], degree: 0 },
    { id: 'Idees/x.md', title: 'Une idée', type: 'idée', folder: 'Idees', tags: [], degree: 0 },
    { id: 'Seule.md', title: 'Seule', type: 'note', folder: '', tags: [], degree: 0 },
    { id: 'connecteur:mail', title: 'Courriel', type: 'connecteur', tags: [], degree: 0 },
  ],
  edges: [
    { from: 'Projets/alpha.md', to: 'Gens/kemi.md', kind: 'lien' },
    { from: 'Projets/beta.md', to: 'Projets/alpha.md', kind: 'lien' },
    { from: 'Idees/x.md', to: 'Projets/alpha.md', kind: 'mention' },
    { from: 'connecteur:mail', to: 'Gens/kemi.md', kind: 'source' },
  ],
};

const paire = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

test('3D du Cerveau : les MÊMES notes et les MÊMES liens que le 2D ; groupe = type de note, légende des types montrés', () => {
  const { G3 } = charger();
  const deux = brut(G3.donneesGraphe(cerveau));
  const vrai = G3.versEspace(cerveau), trois = { ...brut(vrai), counter: vrai.counter };
  assert.deepEqual(trois.nodes.map((n) => n.id).sort(), deux.nodes.map((n) => n.id).sort(), 'mêmes points');
  assert.deepEqual(trois.edges.map(([a, b]) => paire(a, b)).sort(), deux.edges.map((e) => paire(e.from, e.to)).sort(), 'mêmes liens');
  // Le dossier « Projets » (deux notes) est un point, relié à ses notes, comme dans le 2D ; le lien deviné est là.
  assert.ok(trois.nodes.some((n) => n.id === 'dossier:Projets'));
  assert.ok(trois.edges.some(([a, b]) => paire(a, b) === paire('Idees/x.md', 'Projets/alpha.md')));
  const par = new Map(trois.nodes.map((n) => [n.id, n]));
  assert.equal(par.get('Projets/alpha.md')!.groupe, 'Projet');
  assert.equal(par.get('Gens/kemi.md')!.groupe, 'Personne');
  assert.equal(par.get('dossier:Projets')!.groupe, 'Dossier');
  assert.equal(par.get('Projets/alpha.md')!.color, '#E3833F', 'la couleur du type, la même que « Par type de note » du 2D');
  const leg = new Map(trois.legend.map(([c, n]) => [n, c]));
  for (const g of ['Projet', 'Personne', 'Idée', 'Note', 'Dossier', 'Connecteur']) assert.ok(leg.has(g), `légende : ${g}`);
  assert.equal(trois.counter(trois.nodes, trois.edges), `${trois.nodes.length} éléments · ${trois.edges.length} liens`, "les dossiers et le connecteur sont comptés : « éléments », pas « notes »");
});

test('3D du Cerveau : un grand Cerveau montre ses notes les plus liées, et le dit à l\'écran', () => {
  const { G3 } = charger();
  const n = 2000;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}.md`, title: `Note ${i}`, type: 'note', folder: '', tags: [], degree: 0 }));
  // n0 … n9 sont des centres : chaque note est reliée à l'un d'eux.
  const edges = nodes.slice(10).map((x, i) => ({ from: x.id, to: `n${i % 10}.md`, kind: 'lien' }));
  for (let i = 10; i < 300; i++) edges.push({ from: `n${i}.md`, to: `n${i + 1}.md`, kind: 'lien' });
  const e = G3.versEspace({ nodes, edges });
  assert.equal(e.nodes.length, G3.ESPACE_MAX, 'plafonné');
  assert.ok(G3.ESPACE_MAX <= 800, 'assez peu pour que le placement 3D garde sa forme (voir toursMax de graphe-espace.js)');
  const ids = new Set(e.nodes.map((x) => x.id));
  for (let i = 0; i < 10; i++) assert.ok(ids.has(`n${i}.md`), 'les centres sont gardés');
  for (const [a, b] of e.edges) assert.ok(ids.has(a) && ids.has(b), 'aucun lien vers un point absent');
  assert.equal(e.counter(e.nodes, e.edges), `${G3.ESPACE_MAX} éléments les plus liés sur ${n} · ${e.edges.length} liens`);
});

test('3D du Cerveau : toucher une note l\'ouvre (comme le 2D) ; un connecteur ne fait rien', async () => {
  const { G3, demandes } = charger();
  const e = G3.versEspace(cerveau);
  e.onOpen('Gens/kemi.md');
  e.onOpen('connecteur:mail');
  e.onOpen('inconnu');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(demandes, [`/api/brain/note?path=${encodeURIComponent('Gens/kemi.md')}`]);
});

test('3D du Cerveau : un titre piégé reste du texte (liste du clavier et toile)', () => {
  const { G3, nav, win } = charger({ espace: true });
  const piege = '<img src=x onerror="window.__x=1">';
  const d = { nodes: [...cerveau.nodes, { id: 'p.md', title: piege, type: 'note', folder: '', tags: [], degree: 0 }], edges: [...cerveau.edges, { from: 'p.md', to: 'Gens/kemi.md', kind: 'lien' }] };
  const e = G3.versEspace(d);
  assert.equal(e.nodes.find((x) => x.id === 'p.md')!.label, piege, 'donné tel quel au composant (qui l\'écrit en texte)');
  const proto = Object.getPrototypeOf(nav.make('canvas')) as { getContext: (k: string) => unknown };
  const avant = proto.getContext;
  const ecrits: string[] = []; const rien = () => {};
  proto.getContext = (k: string) => (k === '2d' ? new Proxy({ fillText: (t: string) => { ecrits.push(String(t)); }, measureText: (t: string) => ({ width: String(t).length * 6 }), createRadialGradient: () => ({ addColorStop: rien }) } as Record<string, unknown>, { get: (c, p: string) => (p in c ? c[p] : rien), set: (c, p: string, v) => { c[p] = v; return true; } }) : k === 'webgl' ? {} : null);
  try {
    const E = win.OdinGrapheEspace as { mount(b: unknown, d: unknown, o: unknown): { replie: boolean; detacher(): void } };
    const boite = nav.make('div') as unknown as { textContent: string; querySelectorAll(s: string): Array<{ textContent: string }> };
    const c = E.mount(boite, e, { force: true });
    assert.equal(c.replie, false);
    assert.ok(boite.querySelectorAll('button').some((b) => b.textContent.startsWith(piege)), 'le bouton porte le titre en texte');
    assert.equal(boite.querySelectorAll('img').length, 0, 'aucune image créée par le titre');
    assert.equal(win.__x, undefined);
    assert.ok(boite.textContent.includes(`${e.nodes.length} éléments · ${e.edges.length} liens`), "le compteur du Cerveau");
    assert.ok(ecrits.includes('PROJET'), 'le nom du groupe (type) en capitales sur la toile');
    c.detacher();
  } finally { proto.getContext = avant; }
});

test('« Graphe | Graphe 3D » du Cerveau : retenu sous « cerveau » ; repli vers le dessin 2D d\'ici quand le 3D ne peut pas', () => {
  const stock = new Map<string, string>([['odin.graphe.vue.cerveau', '3d']]);
  const { G3, nav } = charger({ espace: true, stockage: stock });
  const montes: unknown[] = [];
  const hote = nav.make('div') as unknown as { textContent: string; querySelectorAll(s: string): Array<{ textContent: string; attributes: Record<string, string> }> };
  // Le faux navigateur n'a pas de toile : le 3D choisi se replie, et c'est le 2D d'ici qui est monté.
  const v = G3.choixGraphe(hote, cerveau, (b) => { montes.push(b); return { detacher() {} }; });
  assert.ok(v);
  assert.equal(montes.length, 1, 'le dessin 2D du Cerveau est monté');
  assert.equal(v!.vue(), '2d');
  assert.match(hote.textContent, /Vue 3D indisponible ici/, 'le repli est dit');
  assert.deepEqual(brut(hote.querySelectorAll('button').slice(0, 2).map((b) => b.textContent)), ['Graphe', 'Graphe 3D']);
  // Sans le composant commun : rien (renderGraph garde l'affichage d'avant).
  assert.equal(charger().G3.choixGraphe(nav.make('div'), cerveau, () => ({})), null);
});

test('Retour au « Graphe » sur la même toile : le dessin 2D se détache avant d\'être remonté (rien ne s\'empile)', () => {
  const { G3, nav, win } = charger();
  const sb = nav.sandbox as Record<string, unknown>;
  sb.requestAnimationFrame = () => 1;
  let ro = 0, clav = 0;
  sb.ResizeObserver = class { observe() { ro++; } disconnect() { ro--; } };
  win.OdinPleinEcran = { clavier: () => { clav++; return () => { clav--; }; } };
  // Les échanges en direct (graph.js) : leur branchement redessine tant que la toile est là ; il doit se débrancher aussi.
  let ech = 0;
  win.OdinGraph = { echanges: { brancher: () => { ech++; return () => { ech--; }; }, dessiner: () => [], survolEchange: () => '' } };
  const cv = nav.make('canvas') as unknown as Record<string, unknown> & { addEventListener(t: string, f: unknown): void };
  const rien = () => {};
  cv.getContext = () => new Proxy({ measureText: (t: string) => ({ width: String(t).length * 6 }), createRadialGradient: () => ({ addColorStop: rien }) } as Record<string, unknown>, { get: (c, p: string) => (p in c ? c[p] : rien), set: (c, p: string, v) => { c[p] = v; return true; } });
  const mv = new Set<unknown>();
  cv.addEventListener = (t: string, f: unknown) => { if (t === 'pointermove') mv.add(f); };
  cv.removeEventListener = (t: string, f: unknown) => { if (t === 'pointermove') mv.delete(f); };
  const wrap = nav.make('div'); wrap.append(cv); cv.parentElement = wrap; // le faux navigateur n'a pas parentElement
  const draw = (G3 as unknown as { drawGraph(c: unknown, d: unknown): { detacher?: () => void } }).drawGraph;
  const g1 = draw(cv, brut(cerveau));
  assert.equal(typeof g1.detacher, 'function', 'le dessin 2D rend de quoi se détacher');
  g1.detacher!();
  assert.deepEqual([ro, clav, ech, mv.size], [0, 0, 0, 0], 'tout est détaché');
  draw(cv, brut(cerveau));
  assert.deepEqual([ro, clav, ech, mv.size], [1, 1, 1, 1], 'un seul observateur, un seul clavier, un seul branchement, un seul survol après remontage');
  // Et le détacheur de monter2D l'appelle bien.
  assert.match(BRAIN, /return \{ detacher\(\) \{ cancelAnimationFrame\(raf\); raf = 0; G\?\.detacher\?\.\(\); \}/);
});

test('brain.js : renderGraph passe par le choix commun et garde son dessin 2D ; démonté en quittant le graphe', () => {
  assert.match(BRAIN, /choixGraphe\(hote, r, \(boite\) => \{ boite\.replaceChildren\(wrap\); dessiner2D\(\)/);
  assert.match(BRAIN, /function stopGraph\(\) \{[^\n]*g\.detacher\(\)/);
  assert.match(BRAIN, /let \{ nodes, edges \} = donneesGraphe\(data\);/, 'le 2D part du même calcul que le 3D');
});
