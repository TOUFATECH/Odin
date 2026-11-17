// La carte du réseau de la maison (src/web/ui.html, #netGraph) reçoit le choix « Graphe | Graphe 3D » avec le
// composant commun (src/web/pages/graphe-espace.js) : « Graphe » reste le dessin d'avant ; « Graphe 3D » montre les
// MÊMES appareils et les MÊMES liens, rangés par sorte d'appareil (les familles de la carte) ; un toucher ouvre la
// fiche de l'appareil ; le choix est retenu ; le retour au « Graphe » ne laisse rien du 3D branché ; un nom piégé
// reste du texte ; quand le 3D ne peut pas, le dessin d'avant est monté. Appareils inventés, rien de réel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const ESPACE = readFileSync(new URL('../src/web/pages/graphe-espace.js', import.meta.url), 'utf8');
const brut = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Le morceau de ui.html qui fait la carte (de son titre à celui de la fiche d'un appareil), et ce qu'il utilise. */
function morceau(debut: string, fin: string) {
  const a = UI.indexOf(debut), b = UI.indexOf(fin, a);
  assert.ok(a > 0 && b > a, `morceau introuvable : ${debut}`);
  return UI.slice(a, b);
}
const CARTE = morceau('// ---------- Carte du réseau : une carte par sous-réseau', "// ---------- Fiche d'un appareil");
const NET_CATS = UI.match(/const NET_CATS = \[[\s\S]*?\]\];/)![0];
const EL = UI.match(/const el = \(tag, attrs = \{\}, \.\.\.kids\) => \{[\s\S]*?\n {2}\};/)![0];

type Donnees = { nodes: Array<{ id: string; label: string; groupe?: string; hub?: boolean }>; edges: string[][]; onOpen(id: string): void };
type Fx = { childNodes: Fx[]; textContent: string; attributes: Record<string, string>; localName: string; click(): void; querySelectorAll(s: string): Fx[]; append(...k: unknown[]): void };

/** Des appareils inventés : une box, un serveur, deux téléphones, un appareil à identifier (hors ligne, avec un souci). */
const appareils = () => [
  { id: 'd1', label: 'Box (routeur)', ip: '10.0.0.1', kind: 'routeur', status: 'online', network: 'maison' },
  { id: 'd2', label: 'Atlas', ip: '10.0.0.10', kind: 'serveur', status: 'online', network: 'maison' },
  { id: 'd3', label: 'Téléphone de Lina', ip: '10.0.0.21', kind: 'téléphone / tablette', status: 'online', network: 'maison' },
  { id: 'd4', label: 'Tablette du salon', ip: '10.0.0.22', kind: 'téléphone / tablette', status: 'offline', network: 'maison' },
  { id: 'd5', label: '10.0.0.40', ip: '10.0.0.40', kind: 'inconnu', status: 'online', network: 'maison', hostname: 'capteur.local' },
];

function charger(o: { espace?: boolean; stockage?: Map<string, string>; toile?: boolean } = {}) {
  const nav = fauxNavigateur();
  const sb = nav.sandbox as Record<string, unknown>;
  const doc = sb.document as Record<string, unknown>;
  doc.documentElement = { lang: 'fr' };
  // Ce qui reste branché : observateurs, écoute de la page, images demandées.
  const branche = { ro: 0, io: 0, vis: 0 };
  sb.ResizeObserver = class { on = false; observe() { if (!this.on) { this.on = true; branche.ro++; } } disconnect() { if (this.on) { this.on = false; branche.ro--; } } };
  sb.IntersectionObserver = class { on = false; observe() { if (!this.on) { this.on = true; branche.io++; } } disconnect() { if (this.on) { this.on = false; branche.io--; } } };
  doc.addEventListener = (t: string) => { if (t === 'visibilitychange') branche.vis++; };
  doc.removeEventListener = (t: string) => { if (t === 'visibilitychange') branche.vis--; };
  sb.requestAnimationFrame = () => 1; sb.cancelAnimationFrame = () => {};
  const s = o.stockage || new Map<string, string>();
  sb.localStorage = { getItem: (k: string) => (s.has(k) ? s.get(k)! : null), setItem: (k: string, v: string) => { s.set(k, v); } };
  const proto = Object.getPrototypeOf(nav.make('div')) as Record<string, unknown>;
  // Le faux navigateur n'a ni contains ni toile : on les lui donne (la toile seulement si demandé).
  proto.contains = function (this: Fx, x: unknown): boolean { return this === x || this.childNodes.some((c) => (c as unknown as { contains?: (y: unknown) => boolean }).contains?.call(c, x)); };
  const ecrits: string[] = []; const rien = () => {};
  proto.getContext = o.toile ? (k: string) => (k === '2d' ? new Proxy({ fillText: (t: string) => { ecrits.push(String(t)); }, measureText: (t: string) => ({ width: String(t).length * 6 }), createRadialGradient: () => ({ addColorStop: rien }) } as Record<string, unknown>, { get: (c, p: string) => (p in c ? c[p] : rien), set: (c, p: string, v) => { c[p] = v; return true; } }) : k === 'webgl' ? {} : null) : () => null;
  // Le dessin 2D d'avant (graph.js) : remplacé par un faux qui note ce qu'il reçoit.
  const montes2D: Donnees[] = [], majs2D: Donnees[] = [];
  const win = nav.window as Record<string, unknown>;
  win.OdinGraph = { mount: (h: Fx, d: Donnees) => { const box = nav.make('div') as unknown as Fx; box.append('graphe 2D'); (h as unknown as { replaceChildren(...k: unknown[]): void }).replaceChildren(box); montes2D.push(d); return { el: box, update: (x: Donnees) => { majs2D.push(x); } }; } };
  const host = nav.make('div') as unknown as Fx;
  const ouverts: string[] = [];
  Object.assign(sb, { $: (q: string) => (q === '#netGraph' ? host : null), state: { devices: appareils(), watch: { findings: [{ ip: '10.0.0.40', level: 'grave', title: 'Port ouvert' }], cfg: { devices: [] } } }, openDevice: (id: string) => { ouverts.push(id); } });
  const ctx = vm.createContext(sb);
  if (o.espace !== false) vm.runInContext(ESPACE, ctx);
  // Le choix monté : les données qu'il donne au 3D, notées pour les comparer à celles du 2D.
  const donnees3D: Donnees[] = [];
  const E = win.OdinGrapheEspace as { choix: (h: unknown, x: { donnees: Donnees }) => unknown } | undefined;
  if (E) { const c = E.choix; E.choix = (h, x) => { donnees3D.push(x.donnees); return c(h, x); }; }
  vm.runInContext(`${EL}\n${NET_CATS}\nconst isWatched = (x) => (state.watch?.cfg?.devices || []).includes(x.id);\n${CARTE}\nwindow.__carte = { renderMap, get mapGraph() { return mapGraph; } };`, ctx);
  const carte = win.__carte as { renderMap(): void; mapGraph: { vue?: () => string; el: unknown } | null };
  const boutons = () => host.querySelectorAll('button');
  const bouton = (v: string) => boutons().find((b) => b.attributes['data-vue'] === v);
  return { nav, sb, win, host, carte, montes2D, majs2D, donnees3D, ouverts, branche, stock: s, bouton, ecrits };
}

const paire = (e: string[]) => (e[0] < e[1] ? `${e[0]}|${e[1]}` : `${e[1]}|${e[0]}`);

test('Carte du réseau : « Graphe | Graphe 3D » à côté d\'elle ; « Graphe » reste le dessin d\'avant (par défaut)', () => {
  const { carte, host, montes2D, donnees3D, bouton } = charger({ toile: true });
  carte.renderMap();
  assert.ok(bouton('2d') && bouton('3d'), 'les deux boutons sont là');
  assert.deepEqual([bouton('2d')!.textContent, bouton('3d')!.textContent], ['Graphe', 'Graphe 3D']);
  assert.equal(bouton('2d')!.attributes['aria-pressed'], 'true', 'sans choix retenu : le dessin d\'avant');
  assert.equal(montes2D.length, 1); assert.equal(donnees3D.length, 1, 'un seul choix monté');
  assert.match(host.textContent, /graphe 2D/);
});

test('Graphe 3D : les MÊMES appareils et les MÊMES liens que le 2D ; groupe = la famille d\'appareils de la carte', () => {
  const a = charger({ toile: true }); a.carte.renderMap();
  const b = charger({ toile: true, stockage: new Map([['odin.graphe.vue.reseau', '3d']]) }); b.carte.renderMap();
  assert.equal(b.donnees3D.length, 1); assert.equal(b.montes2D.length, 0, 'le 3D retenu est monté, pas le 2D'); assert.equal(b.branche.io, 1);
  const deux = a.montes2D[0], trois = b.donnees3D[0];
  assert.deepEqual(brut(trois.nodes).map((n) => n.id).sort(), brut(deux.nodes).map((n) => n.id).sort(), 'mêmes points');
  assert.deepEqual(brut(trois.edges).map(paire).sort(), brut(deux.edges).map(paire).sort(), 'mêmes liens');
  assert.deepEqual(brut(trois.nodes), brut(deux.nodes), 'les mêmes données, champ pour champ');
  const g = new Map(brut(trois.nodes).map((n) => [n.id, n.groupe]));
  assert.equal(g.get('d2'), 'Serveurs'); assert.equal(g.get('d3'), 'Téléphones et tablettes'); assert.equal(g.get('d4'), 'Téléphones et tablettes');
  assert.equal(g.get('d5'), 'À identifier'); assert.equal(g.get('d1'), 'Box et routeurs');
  assert.equal(g.get('cat:maison:Téléphones et tablettes'), 'Téléphones et tablettes', 'la famille est dans son amas');
  assert.equal(g.get('net:maison'), undefined, 'le réseau lui-même est un centre, sans groupe');
  // Le 3D les montre bien : un bouton par point dans la liste du clavier.
  const liste = b.host.querySelectorAll('div').filter((d) => d.attributes.role === 'list')[0];
  assert.ok(liste, 'la liste des points du 3D'); assert.equal(liste.querySelectorAll('button').length, trois.nodes.length);
  assert.ok(b.ecrits.includes('TÉLÉPHONES ET TABLETTES'), 'le nom du groupe en capitales sur la toile');
});

test('Graphe 3D : toucher un appareil ouvre sa fiche (comme le 2D) ; un réseau ou une famille ne fait rien', () => {
  const b = charger({ toile: true, stockage: new Map([['odin.graphe.vue.reseau', '3d']]) }); b.carte.renderMap();
  const liste = b.host.querySelectorAll('div').filter((d) => d.attributes.role === 'list')[0];
  for (const x of liste.querySelectorAll('button')) x.click();
  assert.deepEqual(b.ouverts.sort(), ['d1', 'd2', 'd3', 'd4', 'd5']);
});

test('Graphe 3D : un nom d\'appareil piégé reste du texte', () => {
  const piege = '<img src=x onerror="window.__x=1">';
  const b = charger({ toile: true, stockage: new Map([['odin.graphe.vue.reseau', '3d']]) });
  (b.sb.state as { devices: Array<Record<string, unknown>> }).devices.push({ id: 'd9', label: piege, ip: '10.0.0.99', kind: 'caméra', status: 'online', network: 'maison' });
  b.carte.renderMap();
  assert.equal(b.host.querySelectorAll('img').length, 0, 'aucune image créée par le nom');
  assert.ok(b.host.querySelectorAll('button').some((x) => x.textContent.includes('<img src=x')), 'le nom est écrit tel quel, en texte');
  assert.equal(b.win.__x, undefined);
});

test('Choix retenu pour la carte ; retour au « Graphe » : rien du 3D ne reste branché, et le rafraîchissement ne remonte rien', () => {
  const b = charger({ toile: true }); b.carte.renderMap();
  b.bouton('3d')!.click();
  assert.equal(b.stock.get('odin.graphe.vue.reseau'), '3d', 'retenu sous « reseau »');
  assert.equal(b.donnees3D.length, 1);
  assert.ok(b.branche.ro >= 1 && b.branche.vis >= 1, 'le 3D s\'est branché');
  // Un appareil arrive : le même 3D suit (pas de nouveau montage).
  (b.sb.state as { devices: Array<Record<string, unknown>> }).devices.push({ id: 'd6', label: 'Imprimante', ip: '10.0.0.50', kind: 'imprimante', status: 'online', network: 'maison' });
  const racine = b.carte.mapGraph!.el;
  b.carte.renderMap();
  assert.equal(b.donnees3D.length, 1, 'pas remonté'); assert.equal(b.branche.io, 1, 'un seul 3D branché'); assert.equal(b.carte.mapGraph!.el, racine);
  const liste = b.host.querySelectorAll('div').filter((d) => d.attributes.role === 'list')[0];
  assert.ok(liste.querySelectorAll('button').some((x) => x.textContent.startsWith('Imprimante')), 'le nouvel appareil est dans le 3D');
  // Retour au « Graphe ».
  b.bouton('2d')!.click();
  assert.equal(b.stock.get('odin.graphe.vue.reseau'), '2d');
  assert.deepEqual(b.branche, { ro: 0, io: 0, vis: 0 }, 'observateurs et écoute de la page du 3D débranchés');
  assert.equal(b.montes2D.length, 2, 'le dessin d\'avant est remonté une fois');
  assert.ok(b.montes2D[1].nodes.some((n) => n.id === 'd6'), 'avec les appareils du moment');
  b.carte.renderMap();
  assert.equal(b.montes2D.length, 2, 'un rafraîchissement met à jour, il ne remonte pas');
  assert.equal(b.majs2D.length, 1);
  // Et la carte vidée (plus aucun appareil) débranche le 3D monté.
  b.bouton('3d')!.click(); assert.ok(b.branche.ro >= 1);
  (b.sb.state as { devices: unknown[] }).devices = [];
  b.carte.renderMap();
  assert.deepEqual(b.branche, { ro: 0, io: 0, vis: 0 }, 'la carte vidée débranche le 3D');
  assert.match(b.host.textContent, /Aucun appareil/);
});

test('Repli : 3D retenu mais pas de toile → le dessin d\'avant, et c\'est dit ; sans le composant → comme avant', () => {
  const b = charger({ toile: false, stockage: new Map([['odin.graphe.vue.reseau', '3d']]) }); b.carte.renderMap();
  assert.equal(b.montes2D.length, 1, 'le dessin d\'avant est monté');
  assert.match(b.host.textContent, /Vue 3D indisponible ici/);
  const c = charger({ espace: false }); c.carte.renderMap();
  assert.equal(c.montes2D.length, 1); assert.equal(c.host.querySelectorAll('button').length, 0, 'pas de choix sans le composant');
});
