// Les 12 animations de déplacement des modules de l'accueil (lot 17 de la maquette validée « Accueil »).
// src/web/pages/accueil-animations.js est lu ici sans document : les 12 (celles de la maquette, dans son ordre), le
// mouvement de chacune qui finit le module à sa place exacte, « moins d'animations » (rien ne bouge, même ce que lance
// le script), un choix inconnu qui vaut « Classique ». Puis Hestia : le choix gardé et relu avec la fenêtre, refusé à
// un membre, à une tablette et à une clé d'API. Puis fenetre.js : l'animation jouée quand un module est déplacé.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ANIMATIONS, animationDe, resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';

type Image = [Array<Record<string, unknown>>, Record<string, unknown>];
interface Prise { incline: number; facteur: number; leve: number; prise: number; pose: number; poseEase: string; classe: string }
interface Animations {
  ORDRE: string[]; TEXTES: { noms: Record<string, string>; details: Record<string, string> } & Record<string, unknown>; CSS: string;
  choix: (id: unknown) => string; nom: (id: unknown) => string;
  image: (id: unknown, dx: number, dy: number, sx?: number, sy?: number, i?: number) => Image;
  prise: (id: unknown, base: Record<string, number>) => Prise; reduit: () => boolean;
  actuelle: () => string; regler: (id: unknown) => string; ecouter: (f: (id: string) => void) => () => void;
  jouer: (cartes: () => Iterable<Carte>, changer: () => unknown, o?: Record<string, unknown>) => number | Promise<number>;
  demo: (boite: unknown, id: string, o?: Record<string, unknown>) => number | Promise<number>;
  poser: (o?: Record<string, unknown>) => boolean;
}
const SRC = readFileSync(new URL('../src/web/pages/accueil-animations.js', import.meta.url), 'utf8');
const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const GE = readFileSync(new URL('../src/web/pages/accueil-gestes.js', import.meta.url), 'utf8');
/** Le fichier chargé dans un monde à part ; `matchMedia` dit ce que l'appareil demande. */
function charger(reduit = false): Animations {
  const win: Record<string, unknown> = { matchMedia: (q: string) => ({ matches: reduit && q.includes('prefers-reduced-motion: reduce') }) };
  vm.runInNewContext(SRC, { window: win, setTimeout, clearTimeout }); // ni document, ni fetch : rien ne doit s'exécuter d'autre à son chargement
  return win.OdinAnimations as Animations;
}
const A = charger();
const winG: { OdinGestes?: { mouvement: (r: boolean) => Record<string, number> } } = {};
vm.runInNewContext(GE, { window: winG });
const OG = winG.OdinGestes!;
/** Les objets du monde vm, rendus comparables. */
const ici = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------------------------------------------------------------- un faux module (sa place avant et après le changement)
type R = { left: number; top: number; width: number; height: number };
interface Carte { dataset: { id: string }; style: Record<string, string>; classList: { add: () => void; remove: () => void }; offsetWidth: number; mesures: number; jeux: Image[]; getBoundingClientRect: () => R; animate: (kf: Image[0], o: Image[1]) => Record<string, unknown> }
function carte(id: string, r: R): Carte & { place: R } {
  const c = {
    place: r, dataset: { id }, style: {} as Record<string, string>, classList: { add() { /* */ }, remove() { /* */ } }, offsetWidth: 0, mesures: 0, jeux: [] as Image[],
    getBoundingClientRect() { c.mesures++; return { ...c.place }; },
    animate(kf: Image[0], o: Image[1]) { c.jeux.push([kf, o]); return {}; },
  };
  return c;
}
/** Trois modules sur une rangée ; le premier passe en dernier (les deux autres reculent d'une place). */
function rangee() {
  const cs = [carte('a', { left: 0, top: 0, width: 100, height: 80 }), carte('b', { left: 120, top: 0, width: 100, height: 80 }), carte('c', { left: 240, top: 0, width: 100, height: 80 })];
  const changer = () => { cs[0].place = { left: 240, top: 0, width: 100, height: 80 }; cs[1].place = { left: 0, top: 0, width: 100, height: 80 }; cs[2].place = { left: 120, top: 0, width: 100, height: 80 }; };
  return { cs, changer };
}

// ---------------------------------------------------------------- les 12
test('animations : les 12 de la maquette, dans son ordre, avec leur nom et leur phrase', () => {
  assert.deepEqual(ici(A.ORDRE), ['classique', 'glace', 'miroir', 'ressort', 'aimant', 'flottant', 'fondu', 'domino', 'vague', 'zoom', 'elastique', 'cascade']);
  assert.deepEqual(ici(A.ORDRE.map((id) => A.nom(id))), ['Classique', 'Glace qui glisse', 'Miroirs', 'Ressort', 'Aimant', 'Flottant', 'Fondu', 'Domino', 'Vague', 'Zoom', 'Élastique', 'Cascade']);
  for (const id of A.ORDRE) assert.ok(String(A.TEXTES.details[id] ?? '').length > 20, `${id} : une phrase qui la décrit`);
  assert.deepEqual(ici(A.ORDRE), [...ANIMATIONS], 'les mêmes identifiants chez Hestia');
  // Douze mouvements différents (deux animations ne jouent pas la même chose).
  const sig = new Set(A.ORDRE.map((id) => JSON.stringify([A.image(id, 120, -40, 1, 1, 2), A.prise(id, OG.mouvement(false))])));
  assert.equal(sig.size, 12, 'douze animations distinctes');
});

test('animations : chacune finit le module à sa place exacte (rien de figé après)', () => {
  const cas: Array<[number, number, number, number, number]> = [[120, 0, 1, 1, 0], [-240, 0, 1, 1, 1], [0, 94, 1, 1, 3], [-37.5, -188, 1.5, 0.5, 20], [0, 0, 2, 1, 0], [3000, 2000, 1, 1, 7]];
  for (const id of A.ORDRE) {
    for (const [dx, dy, sx, sy, i] of cas) {
      const [kf, o] = A.image(id, dx, dy, sx, sy, i), fin = kf.at(-1)!, quoi = `${id} (${dx}, ${dy}, ${sx}, ${sy}, ${i})`;
      assert.ok(kf.length >= 2, `${quoi} : au moins un départ et une arrivée`);
      assert.equal(fin.transform, 'none', `${quoi} : arrivée sans aucun décalage`);
      assert.ok(fin.opacity === undefined || fin.opacity === 1, `${quoi} : arrivée pleinement visible`);
      assert.ok(fin.filter === undefined || fin.filter === 'none', `${quoi} : arrivée sans flou`);
      assert.ok(fin.offset === undefined || fin.offset === 1, `${quoi} : l'arrivée est la dernière image`);
      assert.ok(o.fill === undefined || o.fill === 'backwards' || o.fill === 'none', `${quoi} : rien n'est gardé après la fin (fill ${String(o.fill)})`);
      const d = Number(o.duration), retard = Number(o.delay ?? 0);
      assert.ok(Number.isFinite(d) && d > 0 && d <= 800, `${quoi} : une durée courte (${d} ms)`);
      assert.ok(Number.isFinite(retard) && retard >= 0 && retard + d <= 1400, `${quoi} : le dernier module est à sa place en moins d'1,4 s`);
      for (const k of kf) for (const v of Object.values(k)) assert.ok(!/NaN|Infinity|undefined/.test(String(v)), `${quoi} : aucune valeur fausse (${String(v)})`);
      // Le départ est bien l'ancienne place (sauf « Fondu », qui ne voyage pas : il disparaît et réapparaît).
      if (id !== 'fondu' && (dx || dy)) assert.match(String(kf[0].transform), new RegExp(`translate\\(${dx}px,${id === 'cascade' ? dy - 30 : dy}px\\)`), `${quoi} : départ à l'ancienne place`);
    }
  }
});

test('animations : jouées sur des modules qui changent de place, celui qu\'on tient laissé', () => {
  for (const id of A.ORDRE) {
    const { cs, changer } = rangee();
    const n = A.jouer(() => cs, changer, { id, reduit: false, sauf: 'a' });
    assert.equal(n, 2, `${id} : les deux autres modules glissent`);
    assert.equal(cs[0].jeux.length, 0, `${id} : celui qu'on tient n'est pas animé (il suit le pointeur)`);
    const [kf] = cs[1].jeux[0];
    if (id !== 'fondu') assert.match(String(kf[0].transform), /translate\(120px,/, `${id} : b part de son ancienne place, 120 px plus à droite`);
    for (const c of cs.slice(1)) assert.equal(c.jeux[0][0].at(-1)!.transform, 'none', `${id} : et finit à sa nouvelle place`);
  }
  // Un module qui ne bouge pas n'est pas animé ; un module nouveau (sans place d'avant) non plus.
  const seul = carte('x', { left: 0, top: 0, width: 10, height: 10 }), neuf = carte('y', { left: 50, top: 0, width: 10, height: 10 });
  assert.equal(A.jouer(() => [seul], () => undefined, { reduit: false }), 0);
  assert.equal(A.jouer(() => (neuf.mesures >= 0 ? [seul] : []), () => undefined, { reduit: false }), 0);
  // Un redessin (une promesse) : animé quand il est fini, avec les modules redessinés (même identifiant).
  const avant = carte('z', { left: 0, top: 0, width: 100, height: 80 }), apres = carte('z', { left: 0, top: 160, width: 100, height: 80 });
  let dessine = false;
  const p = A.jouer(() => (dessine ? [apres] : [avant]), async () => { dessine = true; }, { reduit: false, id: 'ressort' });
  assert.equal(typeof (p as unknown as Promise<number>).then, 'function', 'une promesse, rendue quand le redessin est fini');
  return (p as Promise<number>).then((n) => { assert.equal(n, 1); assert.match(String(apres.jeux[0][0][0].transform), /translate\(0px,-160px\)/); });
});

test('animations : « moins d\'animations » — rien ne bouge, même ce que lance le script', async () => {
  // Demandé par l'appareil : le fichier le lit lui-même.
  const R = charger(true);
  assert.equal(R.reduit(), true); assert.equal(A.reduit(), false);
  for (const id of R.ORDRE) {
    R.regler(id);
    const { cs, changer } = rangee();
    assert.equal(R.jouer(() => cs, changer), 0, `${id} : aucun module animé`);
    assert.ok(cs.every((c) => c.jeux.length === 0 && c.mesures === 0), `${id} : rien n'est même mesuré`);
    assert.equal(cs[0].place.left, 240, `${id} : le changement, lui, est fait (sans mouvement)`);
    // La copie tenue : ni pente, ni loupe, ni durée, ni habit.
    assert.deepEqual(ici(R.prise(id, OG.mouvement(true))), { incline: 0, leve: 1, prise: 0, pose: 0, facteur: 0, poseEase: 'ease-out', classe: '' }, `${id} : la copie tenue ne bouge pas toute seule`);
    // La démonstration des Réglages : ses carrés ne tournent pas.
    const boite = { children: [1, 2, 3, 4], firstElementChild: 1, append() { throw new Error('la démonstration a bougé'); } };
    assert.equal(R.demo(boite, id), 0, `${id} : démonstration immobile`);
  }
  // Sans « moins d'animations », la démonstration tourne d'un cran et ses carrés sont animés (ils ont un identifiant).
  const cs4 = [0, 1, 2, 3].map((k) => carte(String(k + 1), { left: k * 50, top: 0, width: 40, height: 40 }));
  const boite4 = { get children() { return cs4; }, get firstElementChild() { return cs4[0]; }, append(c: Carte & { place: R }) { cs4.splice(cs4.indexOf(c), 1); cs4.push(c); cs4.forEach((x, k) => { x.place = { left: k * 50, top: 0, width: 40, height: 40 }; }); } };
  assert.equal(A.demo(boite4, 'domino', { reduit: false }), 4, 'démonstration : les quatre carrés bougent');
  assert.match(SRC, /fait\('i', \{ 'data-id': k \}\)/, 'les carrés de la démonstration ont un identifiant');
  // Un redessin attendu : fait, rien d'animé.
  const { cs, changer } = rangee();
  assert.equal(await R.jouer(() => cs, async () => changer()), 0);
  assert.ok(cs.every((c) => c.jeux.length === 0));
  // Le style : les habits animés de la copie et le reflet s'arrêtent aussi.
  assert.match(A.CSS, /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.fe-ghost\.fe-g-flottant>\*\{animation:none\}/);
  assert.match(A.CSS, /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.fe-w\.fe-reflet::after[^\n]*animation:none/);
});

test('animations : un choix inconnu vaut « Classique »', () => {
  for (const faux of ['inconnue', '', 'CLASSIQUE', 'pluie', '__proto__', 'constructor', 'toString', null, undefined, 42, {}, ['ressort']]) {
    assert.equal(A.choix(faux), 'classique', `${String(faux)} : Classique`);
    assert.equal(animationDe(faux), 'classique', `${String(faux)} : Classique chez Hestia aussi`);
    assert.deepEqual(ici(A.image(faux, 50, 20)), ici(A.image('classique', 50, 20)), `${String(faux)} : le mouvement de Classique`);
    assert.deepEqual(ici(A.prise(faux, OG.mouvement(false))), ici(A.prise('classique', OG.mouvement(false))));
  }
  const W = charger();
  assert.equal(W.actuelle(), 'classique', 'rien de choisi : Classique');
  assert.equal(W.regler('nimporte'), 'classique');
  assert.equal(W.regler('vague'), 'vague'); assert.equal(W.actuelle(), 'vague');
  let vu = ''; W.ecouter((id) => { vu = id; }); W.regler('bidule'); assert.equal(vu, 'classique', 'un choix abîmé revient à Classique');
  for (const id of A.ORDRE) { assert.equal(A.choix(id), id); assert.equal(animationDe(id), id); }
});

// ---------------------------------------------------------------- Hestia garde le choix
function monde() {
  const home = mkdtempSync(join(tmpdir(), 'accueil-animations-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par l\'essai'); }) as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  return { v, fin: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const choisie = (v: Valhalla) => v.ctx('gladsheim').settings.animation;
const fenetre = async (v: Valhalla) => { const r = await v.act('gladsheim', 'fenetre'); assert.equal(r.ok, true, r.text); return r.data as { pages: unknown[]; animation?: string }; };

test('animations : le choix est gardé par Hestia et relu avec la fenêtre ; un choix inconnu est refusé', async () => {
  const w = monde();
  try {
    assert.equal('animation' in await fenetre(w.v), false, 'rien de choisi : la fenêtre ne change pas');
    const a = w.v.action('gladsheim', 'regler_animation')!.a;
    assert.equal(a.proprietaireSeul, true, 'réservé au propriétaire'); assert.notEqual(a.read, true, 'une action qui change quelque chose');
    for (const id of ANIMATIONS) {
      const r = await w.v.act('gladsheim', 'regler_animation', { animation: id });
      assert.equal(r.ok, true, r.text); assert.equal(choisie(w.v), id);
      assert.equal((await fenetre(w.v)).animation, id, `${id} : relu avec la fenêtre (le même sur tous ses appareils)`);
    }
    const rr = await w.v.act('gladsheim', 'regler_animation', { animation: 'ressort' });
    assert.equal(rr.ok, true);
    // Ranger la fenêtre ne touche pas au choix, et la réponse le rend (la même que la lecture).
    const f = await fenetre(w.v);
    const rf = await w.v.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ ...f, animation: 'zoom' }) });
    assert.equal(rf.ok, true, rf.text); assert.equal(choisie(w.v), 'ressort', 'une fenêtre envoyée ne change pas l\'animation');
    assert.deepEqual(rf.data, await fenetre(w.v), 'rangée et relue : la même');
    for (const faux of ['pluie', 'inconnue', '', '<script>']) {
      const r = await w.v.act('gladsheim', 'regler_animation', { animation: faux });
      assert.equal(r.ok, false, `${faux} : refusé`); assert.equal(choisie(w.v), 'ressort', `${faux} : le choix reste`);
    }
    // Un réglage abîmé (écrit à la main) : relu « classique ».
    w.v.ctx('gladsheim').saveSettings({ animation: 'abimee' });
    assert.equal((await fenetre(w.v)).animation, 'classique');
  } finally { w.fin(); }
});

test('animations : refusé à un membre, à une tablette, à une clé d\'API ; le choix ne bouge pas', async () => {
  const w = monde();
  const srv = createServer((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    assert.equal((await w.v.act('gladsheim', 'regler_animation', { animation: 'vague' })).ok, true);
    const refus = /seul le propriétaire/;
    assert.match((await w.v.act('gladsheim', 'regler_animation', { animation: 'zoom' }, { qui: 'member' })).text, refus, 'un membre');
    assert.match((await w.v.act('gladsheim', 'regler_animation', { animation: 'zoom' }, { auto: true, by: 'automatisation' } as never)).text, refus, 'une automatisation');
    const cle = await valhallaPost('/api/valhalla/act', { module: 'gladsheim', action: 'regler_animation', input: { animation: 'zoom' }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false, 'la clé d\'API'); assert.match(cle.text, /pas avec la clé d'API/);
    // Une tablette « maison » : même un bouton posé sur l'écran de la maison ne le change pas. (Une clé « complet » est,
    // par choix du propriétaire, « comme lui » : elle n'est pas essayée ici, comme pour le rangement de la fenêtre.)
    assert.notEqual((await w.v.act('gladsheim', 'bouton', { nom: 'Animation', appli: 'gladsheim', action: 'regler_animation', reglages: 'animation=zoom' })).ok, false);
    const tuile = (w.v.ctx('gladsheim').settings.tiles as Array<{ id: string; action: string }>).find((t) => t.action === 'regler_animation')!;
    await new Promise<void>((ok) => srv.listen(0, 'localhost', () => ok()));
    const base = `http://localhost:${(srv.address() as { port: number }).port}`;
    for (const droits of ['maison']) {
      const key = ((await w.v.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key;
      const r = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: { 'x-odin-maison': key, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: tuile.id, confirm: true }) })).json() as { ok: boolean };
      assert.equal(r.ok, false, `tablette « ${droits} »`);
    }
    assert.equal(choisie(w.v), 'vague', 'aucun refusé n\'a changé le choix');
  } finally { await new Promise<void>((ok) => { srv.close(() => ok()); }); w.fin(); }
});

// ---------------------------------------------------------------- fenetre.js s'en sert
test('animations : fenetre.js les joue quand un module est déplacé ou agrandi, et pose le choix dans les Réglages', () => {
  assert.match(FE, /const OA = window\.OdinAnimations;/);
  assert.match(FE, /css \+ OA\.CSS/, 'le style des copies habillées et du bloc');
  assert.match(FE, /OA\.jouer\(\(\) => grid\.querySelectorAll\(':scope > \.fe-w'\), \(\) => grid\.insertBefore\(box, reste\[to\] \?\? null\), \{ sauf: id \}\)/, 'au glisser, les autres glissent ; celui qu\'on tient reste un cadre');
  assert.match(FE, /if \(quoi === 'remettre'\) OA\.jouer\(/, 'Échap : les modules reviennent avec elle');
  assert.match(FE, /if \(memeVue\) OA\.jouer\(\(\) => h\.querySelectorAll\('#feGrid > \.fe-w'\), poserTout\); else poserTout\(\);/, 'flèches, tailles, retrait : le redessin de la même page anime');
  assert.match(FE, /dessin\.cur === cur && dessin\.edit === edit/, 'une autre page ou l\'ouverture du mode Modifier ne bougent pas tout');
  assert.match(FE, /P = OA\.prise\(OA\.actuelle\(\), M\)/, 'la copie tenue se lève à sa façon');
  assert.match(FE, /\{ duration: P\.pose, easing: P\.poseEase \}/, 'et se pose à sa façon');
  assert.match(FE, /if \('animation' in L\) OA\.regler\(L\.animation, true\)/, 'le choix gardé par Hestia est lu avec la fenêtre');
  assert.match(FE, /OA\.poser\(\{ act \}\)/, 'le bloc des Réglages est posé par l\'accueil');
  assert.doesNotMatch(SRC, /localStorage|sessionStorage/, 'le choix n\'est pas gardé dans le navigateur');
  assert.match(SRC, /await act\('gladsheim', 'regler_animation', \{ animation: c \}\)/, 'il est gardé par Hestia');
  // Le bloc : seulement à la place réservée par themes.js (sans elle, rien) ; chargé sans document, il ne fait rien.
  const W: Record<string, unknown> = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(SRC, { window: W, document: { querySelector: () => null } });
  assert.equal((W.OdinAnimations as Animations).poser({ act: () => { throw new Error('appelé'); } }), false, 'sans la place réservée : rien');
  assert.match(SRC, /document\.querySelector\('#themeAnims\[data-place="animations"\]'\)/);
  // Les textes sont dans le dictionnaire.
  for (const id of A.ORDRE) assert.ok(A.TEXTES.noms[id] && A.TEXTES.details[id]);
  for (const k of ['titre', 'aide', 'moins', 'gardee', 'refusee', 'horsLigne']) assert.ok(A.TEXTES[k], `texte « ${k} »`);
});

// ---------------------------------------------------------------- relecture : rien ne s'empile, le choix montré est le vrai
test('animations : un nouveau mouvement remplace celui qui joue encore (rien ne s\'empile, l\'origine reste)', () => {
  interface Jeu { annule: boolean; onfinish: null | (() => void); oncancel: null | (() => void); cancel: () => void }
  const jeux: Jeu[] = [];
  const c = carte('a', { left: 0, top: 0, width: 100, height: 80 });
  c.animate = (kf: Image[0], o: Image[1]) => { c.jeux.push([kf, o]); const j: Jeu = { annule: false, onfinish: null, oncancel: null, cancel() { j.annule = true; j.oncancel?.(); } }; jeux.push(j); return j as never; };
  // Un premier déplacement (il change aussi de largeur : l'origine « en haut à gauche » compte), puis un second avant la fin.
  A.jouer(() => [c], () => { c.place = { left: 200, top: 0, width: 200, height: 80 }; }, { id: 'domino', reduit: false });
  assert.equal(jeux.length, 1); assert.equal(c.style.transformOrigin, 'top left');
  A.jouer(() => [c], () => { c.place = { left: 0, top: 100, width: 100, height: 80 }; }, { id: 'domino', reduit: false });
  assert.equal(jeux.length, 2);
  assert.equal(jeux[0].annule, true, 'le premier mouvement est arrêté : il ne reprend pas la main quand le second finit');
  jeux[0].onfinish?.();
  assert.equal(c.style.transformOrigin, 'top left', 'la fin du premier ne retire pas l\'origine du second, qui joue encore');
  jeux[1].onfinish?.();
  assert.equal(c.style.transformOrigin, '', 'à la fin du dernier, plus rien sur le module');
});

/** Un tout petit document : juste ce que `poser` utilise. */
function petitDocument() {
  type N = { tag: string; attrs: Record<string, string>; kids: N[]; textContent: string; hidden: boolean; dataset: Record<string, string>; id?: string; ecoutes: Record<string, () => void>; setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | null; append: (...k: unknown[]) => void; replaceChildren: (...k: unknown[]) => void; addEventListener: (t: string, f: () => void) => void; readonly children: N[]; readonly firstElementChild: N | undefined };
  const noeud = (tag: string): N => {
    const n: N = { tag, attrs: {}, kids: [], textContent: '', hidden: false, dataset: {}, ecoutes: {},
      setAttribute(k, v) { n.attrs[k] = String(v); if (k.startsWith('data-')) n.dataset[k.slice(5)] = String(v); },
      getAttribute(k) { return n.attrs[k] ?? null; },
      append(...k) { for (const x of k) if (typeof x !== 'string') n.kids.push(x as N); },
      replaceChildren(...k) { n.kids = []; n.append(...k); },
      addEventListener(t, f) { n.ecoutes[t] = f; },
      get children() { return n.kids; }, get firstElementChild() { return n.kids[0]; } };
    return n;
  };
  const place = noeud('section'); place.dataset.place = 'animations'; place.hidden = true;
  const tous = (n: N): N[] => [n, ...n.kids.flatMap(tous)];
  const document = { head: noeud('head'), createElement: noeud, querySelector: (q: string) => (q.startsWith('#themeAnims') ? place : null), getElementById: () => null };
  const bouton = (id: string) => tous(place).find((n) => n.tag === 'button' && n.attrs['data-anim'] === id)!;
  const presse = () => tous(place).filter((n) => n.tag === 'button' && n.attrs['aria-pressed'] === 'true').map((n) => n.attrs['data-anim']).join(',');
  const dit = () => tous(place).find((n) => n.attrs.role === 'status')!.textContent;
  return { document, place, bouton, presse, dit };
}

test('animations : deux cartes touchées vite, Odin qui refuse ou ne répond pas — le choix montré est celui gardé', async () => {
  const essai = async (reponses: Array<'ok' | 'non' | 'coupe'>) => {
    const d = petitDocument(), W: Record<string, unknown> = { matchMedia: () => ({ matches: true }) };
    vm.runInNewContext(SRC, { window: W, document: d.document, setTimeout });
    const B = W.OdinAnimations as Animations;
    const appels: string[] = [], fins: Array<() => void> = [];
    const act = (_m: string, action: string, input?: { animation: string }) => {
      if (action === 'fenetre') return Promise.resolve({ ok: true, data: { pages: [], animation: 'classique' } });
      const k = appels.push(input!.animation) - 1;
      return new Promise((ok, non) => { fins[k] = () => (reponses[k] === 'ok' ? ok({ ok: true }) : reponses[k] === 'non' ? ok({ ok: false, text: 'seul le propriétaire' }) : non(new Error('coupé'))); });
    };
    assert.equal(B.poser({ act }), true);
    await new Promise((ok) => setTimeout(ok, 0));
    d.bouton('vague').ecoutes.click(); d.bouton('zoom').ecoutes.click();
    for (let k = 0; k < 20 && fins.filter(Boolean).length < 2; k++) { for (const f of fins) f?.(); await new Promise((ok) => setTimeout(ok, 0)); }
    for (const f of fins) f?.();
    await new Promise((ok) => setTimeout(ok, 5));
    return { actuelle: B.actuelle(), presse: d.presse(), dit: d.dit(), appels };
  };
  // Les deux coupées : rien n'est gardé, rien n'est montré comme choisi.
  let r = await essai(['coupe', 'coupe']);
  assert.equal(r.actuelle, 'classique', 'Odin ne répond pas : l\'animation reste celle gardée'); assert.equal(r.presse, 'classique');
  // Les deux refusées (un membre) : pareil.
  r = await essai(['non', 'non']);
  assert.equal(r.actuelle, 'classique'); assert.equal(r.presse, 'classique');
  // La première gardée, la seconde coupée : la première, qu'Odin garde.
  r = await essai(['ok', 'coupe']);
  assert.equal(r.actuelle, 'vague'); assert.equal(r.presse, 'vague'); assert.deepEqual(r.appels, ['vague', 'zoom']);
  // Les deux gardées : la dernière.
  r = await essai(['ok', 'ok']);
  assert.equal(r.actuelle, 'zoom'); assert.equal(r.presse, 'zoom');
});
