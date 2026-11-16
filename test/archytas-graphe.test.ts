// Le graphe 3D léger des scripts (src/web/pages/archytas-graphe.js) : placement déterministe, choix du point de
// devant quand deux se superposent, et repli vers la vue 2D quand il n'y a pas de carte graphique (WebGL absent).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxNavigateur } from './archytas-fixtures.ts';

const src = readFileSync(new URL('../src/web/pages/archytas-graphe.js', import.meta.url), 'utf8');
function charger() {
  const nav = fauxNavigateur();
  vm.runInContext(src, vm.createContext(nav.sandbox));
  const win = nav.window as unknown as { OdinGraphe3D: { mount: (b: unknown, d: unknown, o?: unknown) => { replie: boolean; detacher: () => void }; logique: {
    placer: (n: unknown) => { x: number; y: number; z: number };
    projeter: (p: { x: number; y: number; z: number }, l: number, h: number, r?: number) => { sx: number; sy: number; prof: number; taille: number };
    choisir: (pts: Array<{ id: string; sx: number; sy: number; prof: number; taille: number }>, x: number, y: number, r?: number) => string | null;
    doitReplier: (o: Record<string, unknown>) => boolean;
  } } };
  assert.ok(win.OdinGraphe3D, 'window.OdinGraphe3D est posé');
  return { nav, G: win.OdinGraphe3D };
}

test('graphe : le repli est décidé honnêtement (pas de WebGL, mouvement réduit, image lente)', () => {
  const { G } = charger();
  const R = G.logique.doitReplier;
  assert.equal(R({ webgl: false }), true, 'pas de carte graphique → vue 2D');
  assert.equal(R({ reducedMotion: true }), true, 'mouvement réduit → vue 2D');
  assert.equal(R({ ctx2d: false }), true, 'aucun contexte 2D → vue 2D');
  assert.equal(R({ webgl: true, premiereImageMs: 30 }), true, 'première image trop lente → vue 2D');
  assert.equal(R({ webgl: true, premiereImageMs: 5 }), false, 'machine correcte → on garde le 3D');
});

test('graphe : le placement est déterministe (angle=mission, hauteur=usage, profondeur=fraîcheur)', () => {
  const { G } = charger();
  const n = { id: 's', label: 's', sub: 'arroser', usage: 0.5, frais: 0.25 };
  const a = G.logique.placer(n), b = G.logique.placer({ ...n });
  assert.deepEqual(a, b, 'deux fois le même script → la même place');
  assert.ok(Math.abs(a.y - 0) < 1e-9, 'usage 0.5 → hauteur au milieu');
  assert.ok(Math.abs(a.z - (-0.5)) < 1e-9, 'fraîcheur 0.25 → profondeur -0.5');
  const haut = G.logique.placer({ ...n, usage: 1 });
  assert.ok(haut.y > a.y, 'plus d\'usage → plus haut');
});

test('graphe : projeter grandit les points de devant ; le pickage choisit celui du dessus', () => {
  const { G } = charger();
  const devant = G.logique.projeter({ x: 0, y: 0, z: 1 }, 300, 300, 0);
  const fond = G.logique.projeter({ x: 0, y: 0, z: -1 }, 300, 300, 0);
  assert.ok(devant.taille > fond.taille, 'un point de devant est plus gros');
  assert.ok(devant.prof > fond.prof, 'un point de devant a une plus grande profondeur');

  const points = [{ id: 'fond', sx: 150, sy: 150, prof: 0.1, taille: 10 }, { id: 'dessus', sx: 150, sy: 150, prof: 0.9, taille: 10 }];
  assert.equal(G.logique.choisir(points, 150, 150), 'dessus', 'deux points superposés : c\'est celui de devant qui s\'ouvre');
  assert.equal(G.logique.choisir(points, 150, 150, 10), 'dessus');
  assert.equal(G.logique.choisir(points, 400, 400), null, 'rien sous un clic loin des points');
});

test('graphe : sans WebGL, mount bascule vers la vue 2D (onReplier appelé)', () => {
  const { nav, G } = charger();
  let replie = false;
  const boite = nav.make('div');
  const pilote = G.mount(boite, { nodes: [{ id: 'a', label: 'a', sub: 'm', usage: 0.2, frais: 0.5 }], edges: [] }, { onReplier: () => { replie = true; }, onOpen: () => {} });
  assert.equal(replie, true, 'le faux navigateur n\'a pas de WebGL → repli demandé');
  assert.equal(pilote.replie, true);
});
