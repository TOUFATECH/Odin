// Le fond qui vit derrière l'accueil (maquette validée « Accueil et écran de la maison ») : l'ambiance animée de chaque
// thème. Le choix du propriétaire du 23/11 (réponse à une question à choix) : le verre et le fond sur l'accueil et l'écran
// de la maison seulement, fond uni ailleurs ; sa décision du 25/11 (« Décor derrière, verre plus opaque ») : des cartes
// assez opaques pour que chaque texte reste lisible. La couche de fond derrière l'accueil, le réglage « fond animé :
// oui / non » gardé par Odin, et les seize ambiances de la maquette : d'abord celles des thèmes faits main (ice, swoosh,
// icenight, neon, stars, none), puis les dix autres (aurora, waves, rain, storm, snow, leaves, petals, bubbles, sunset,
// orbs) ; « none » ne dessine rien.
// Garde-fous essayés ici : rien d'animé si l'appareil demande moins de mouvement ; arrêt quand la page est cachée ; le
// fond ne passe jamais devant un texte ni un bouton et ne prend aucun clic ; le verre ne bouge pas et chaque texte des
// cartes reste lisible au pire moment de l'ambiance ; peu d'éléments animés, des transformations et de l'opacité
// seulement. La fluidité (images par seconde, accueil avec et sans fond) se mesure dans un vrai navigateur.
// Les scripts sont chargés tels quels dans un bac à sable, avec une page factice (comme test/themes-verre.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { apparence } from '../src/valhalla/modules/apparence.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { freePort } from './banc/lib.ts';
import { createServer } from 'node:http';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const THEMES_JS = lire('src/web/themes.js');
const CATALOGUE_JS = lire('src/web/pages/themes-catalogue.js');
const SCENES_JS = lire('src/web/pages/themes-scenes.js');

const NEUF = ['ice', 'swoosh', 'icenight', 'neon', 'stars', 'none'];
const DIX = ['aurora', 'waves', 'rain', 'storm', 'snow', 'leaves', 'petals', 'bubbles', 'sunset', 'orbs'];

// ------------------------------------------------------------------ une page factice, avec la vue d'accueil

interface Noeud { id?: string; tag: string; textContent: string; innerHTML: string; style: Record<string, string>; dataset: Record<string, string>; attrs: Record<string, string>; classes: Set<string>; enfants: Noeud[]; parent?: Noeud }
function noeud(tag: string): Noeud & Record<string, unknown> {
  const n: Noeud & Record<string, unknown> = { tag, textContent: '', innerHTML: '', style: {}, dataset: {}, attrs: {}, classes: new Set(), enfants: [] };
  Object.assign(n, {
    setAttribute(k: string, v: string) { n.attrs[k] = String(v); }, getAttribute(k: string) { return n.attrs[k] ?? null; }, removeAttribute(k: string) { delete n.attrs[k]; },
    append(...e: Noeud[]) { for (const x of e) { x.parent = n; n.enfants.push(x); } }, prepend(...e: Noeud[]) { for (const x of e) x.parent = n; n.enfants.unshift(...e); },
    remove() { if (n.parent) { n.parent.enfants = n.parent.enfants.filter((x) => x !== n); n.parent = undefined; } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    classList: { add: (c: string) => n.classes.add(c), remove: (c: string) => n.classes.delete(c), contains: (c: string) => n.classes.has(c), toggle: (c: string, oui?: boolean) => { const v = oui === undefined ? !n.classes.has(c) : oui; if (v) n.classes.add(c); else n.classes.delete(c); return v; } },
  });
  return n;
}
interface Charge {
  O: { apply(id: string): void; THEMES: Record<string, { sky?: string[] }>; reglerFond?(oui: boolean): Promise<void>; sync(): Promise<boolean>; verre(id: string): { valeur: number; choisie: boolean; limite: number; pleine?: boolean } | undefined };
  // (`t` : le thème, dont « orbs » prend les couleurs, comme la maquette)
  S: { NOMS: string[]; ambianceDe(id: string): string; dessinee(n: string): boolean; html(n: string, t?: unknown): string; couleurs(n: string, t?: unknown): Array<[string, number, number?]>; CSS: string };
  accueil: Noeud; styles: Array<{ id?: string; textContent: string }>; doc: { hidden: boolean }; visibilite(): void; envoyes: unknown[];
}
// `sansScenes` : la page sans le fichier des ambiances (comme avant le fond qui vit) ; `themesJs` : un autre themes.js.
function charger(garde: unknown = null, o: { sansAccueil?: boolean; mascotte?: Record<string, unknown>; sansScenes?: boolean; themesJs?: string } = {}): Charge {
  const styles: Array<{ id?: string; textContent: string }> = [];
  const accueil = noeud('section'); accueil.id = 'v-home';
  const ecouteurs: Record<string, Array<() => void>> = {};
  const trouver = (id: string): Noeud | null => { const pile: Noeud[] = [accueil]; while (pile.length) { const x = pile.pop()!; if (x.id === id) return x; pile.push(...x.enfants); } return null; };
  const doc = {
    readyState: 'complete', hidden: false, documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { id?: string; textContent: string }) => styles.push(s) }, createElement: (t: string) => noeud(t),
    querySelector: () => null, querySelectorAll: () => [], addEventListener: (e: string, f: () => void) => { (ecouteurs[e] ??= []).push(f); },
    getElementById: (id: string) => (o.sansAccueil ? null : trouver(id)),
  };
  const envoyes: unknown[] = [];
  const window: Record<string, unknown> = { addEventListener() {} };
  window.window = window;
  const repondre = async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { action: string; input: unknown }; envoyes.push(b);
    if (b.action === 'mascotte' && o.mascotte) return { ok: true, json: async () => ({ ok: true, data: o.mascotte }) };
    throw new Error('hors ligne');
  };
  const ctx = vm.createContext({ window, document: doc, localStorage: { getItem: () => JSON.stringify(garde), setItem() {} }, fetch: repondre, CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, console });
  vm.runInContext(CATALOGUE_JS, ctx);
  if (!o.sansScenes) vm.runInContext(SCENES_JS, ctx);
  vm.runInContext(o.themesJs ?? THEMES_JS, ctx);
  return { O: window.OdinThemes as Charge['O'], S: window.OdinScenes as Charge['S'], accueil, styles, doc, visibilite: () => { for (const f of ecouteurs.visibilitychange ?? []) f(); }, envoyes };
}
// La page avec le réglage « fond animé : oui » gardé (sa décision du 26/11 : le fond animé est éteint au départ ; les
// essais du fond lui-même le chargent allumé, comme quand il l'allume dans Réglages → Apparence).
const allume = (garde: Record<string, unknown> | null = null, o: Parameters<typeof charger>[1] = {}) => charger({ mode: 'auto', theme: 'valhalla', ...(garde ?? {}), fondAnime: true }, o);
const couche = (c: Charge) => c.accueil.enfants.find((x) => x.id === 'odinFond');
const cssTheme = (c: Charge) => c.styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? '';
const cssFond = (c: Charge) => c.styles.find((s) => s.id === 'odinFondStyle')?.textContent ?? '';
/** Les thèmes dont l'ambiance est dessinée et dessine quelque chose. */
const avecFond = (c: Charge) => Object.keys(c.O.THEMES).filter((id) => c.O.THEMES[id].sky && c.S.dessinee(c.S.ambianceDe(id)) && c.S.html(c.S.ambianceDe(id), c.O.THEMES[id]) !== '');
// Un thème de chaque ambiance (pour « orbs » : un thème d'Odin clair, dont l'ambiance prend les couleurs).
const UN_THEME: Record<string, string> = { ice: 'glace', swoosh: 'vitre', icenight: 'glacenuit', neon: 'neon', stars: 'nuit', aurora: 'aurore', waves: 'ocean', rain: 'pluie', storm: 'orage', snow: 'neige', leaves: 'foret', petals: 'printemps', bubbles: 'h-abysses', sunset: 'coucher', orbs: 'chaud', none: 'ha' };

// ------------------------------------------------------------------ les ambiances

// (Avant : seules les six des thèmes faits main étaient dessinées, les dix autres « attendaient leur tour ». Désormais
//  les seize le sont : chacune dessine quelque chose et déclare ses couleurs, sauf « none ».)
test('chaque thème a une ambiance connue (l\'une des seize de la maquette) ; les seize sont dessinées, et chacune, sauf « none », dessine quelque chose', () => {
  const c = charger();
  assert.deepEqual([...c.S.NOMS].sort(), [...NEUF, ...DIX].sort(), 'les seize ambiances de la maquette');
  for (const id of Object.keys(c.O.THEMES)) assert.ok(c.S.NOMS.includes(c.S.ambianceDe(id)), `thème ${id} : ambiance ${c.S.ambianceDe(id)}`);
  for (const n of [...NEUF, ...DIX]) assert.equal(c.S.dessinee(n), true, `${n} est dessinée`);
  for (const n of DIX) { const t = c.O.THEMES[UN_THEME[n]]; assert.notEqual(c.S.html(n, t), '', `${n} : son dessin`); assert.ok(c.S.couleurs(n, t).length > 0, `${n} : ses couleurs`); }
  // Celles de la maquette, thème par thème (le catalogue pour les thèmes faits main et ceux de Hestia).
  assert.deepEqual(['glace', 'vitre', 'glacenuit', 'neon', 'ha', 'clair'].map((x) => c.S.ambianceDe(x)), ['ice', 'swoosh', 'icenight', 'neon', 'none', 'none']);
  assert.deepEqual(['nuit', 'espace', 'ev-nouvelan', 'ev-musique', 'h-etoiles', 'h-neon', 'pluie', 'ev-noel', 'h-ocean', 'chaud'].map((x) => c.S.ambianceDe(x)), ['stars', 'stars', 'stars', 'neon', 'stars', 'neon', 'rain', 'snow', 'waves', 'orbs']);
});

// (Avant : Pluie, Noël, Chaud et h-ocean n'avaient pas encore de fond. Désormais chaque thème à verre dont l'ambiance
//  n'est pas « none » a sa couche ; « none » et Valhalla, aucune.)
test('« aucune » ne crée aucun élément ; chaque autre thème à verre a sa couche, celle de son ambiance', () => {
  const c = allume(); // (le fond allumé : il est éteint au départ depuis le 26/11)
  assert.equal(c.S.html('none'), ''); assert.equal(c.S.html('none', c.O.THEMES.ha), '');
  for (const id of ['ha', 'clair', 'h-blanc', 'valhalla']) { c.O.apply(id); assert.equal(couche(c), undefined, `thème ${id} : aucune couche`); }
  for (const [id, nom] of [['pluie', 'rain'], ['orage', 'storm'], ['ev-noel', 'snow'], ['chaud', 'orbs'], ['h-ocean', 'waves'], ['aurore', 'aurora'], ['foret', 'leaves'], ['printemps', 'petals'], ['h-abysses', 'bubbles'], ['coucher', 'sunset']]) {
    c.O.apply(id); assert.equal(couche(c)?.dataset.ambiance, nom, `${id} : sa couche ${nom}`);
  }
  c.O.apply('ha');
  assert.equal(couche(c), undefined, 'en passant à un thème sans ambiance, la couche part');
  for (const id of Object.keys(c.O.THEMES).filter((x) => c.O.THEMES[x].sky)) { c.O.apply(id); assert.equal(!!couche(c), c.S.ambianceDe(id) !== 'none', id); }
});

// (Avant : deux taches, l'accent et la mascotte. La maquette en a trois : blob1, blob2 et var(--c3), la troisième
//  couleur de la palette du thème (logique.js:173 et :387), #a35bff pour chaque thème « orbs » (fromOdin, Hestia).)
test('« orbs » prend les couleurs du thème (son accent, sa mascotte et la troisième couleur de sa palette, comme la maquette), et la couche se redessine d\'un thème « orbs » à l\'autre', () => {
  const c = allume(); // (le fond allumé : il est éteint au départ depuis le 26/11)
  const t1 = c.O.THEMES.chaud as { accent: string; mascot: string }, t2 = c.O.THEMES.paysage as { accent: string; mascot: string };
  assert.deepEqual(Array.from(c.S.couleurs('orbs', t1), ([x]) => x.toLowerCase()).sort(), [t1.accent, t1.mascot, '#a35bff'].map((x) => x.toLowerCase()).sort());
  assert.ok(c.S.html('orbs', t1).includes(t1.accent) && c.S.html('orbs', t1).includes(t1.mascot) && c.S.html('orbs', t1).includes('#a35bff'));
  assert.equal((c.S.html('orbs', t1).match(/class="fv-orb"/g) ?? []).length, 3, 'trois taches, comme la maquette');
  // Les thèmes de Hestia en « orbs » : les trois taches de la maquette (blob1, blob2, pal[2]), lues dans le catalogue.
  const w: Record<string, unknown> = {}; w.window = w; vm.runInContext(CATALOGUE_JS, vm.createContext({ window: w, console }));
  const CT = (w.OdinCatalogueThemes as { THEMES: Record<string, { scene?: string; blob1?: string; blob2?: string; pal?: string[] }> }).THEMES;
  let vus = 0;
  for (const [id, v] of Object.entries(CT)) {
    if (!id.startsWith('h-') || v.scene !== 'orbs' || !c.O.THEMES[id]) continue;
    assert.deepEqual(Array.from(c.S.couleurs('orbs', c.O.THEMES[id]), ([x]) => x.toLowerCase()).sort(), [v.blob1, v.blob2, v.pal?.[2]].map((x) => String(x).toLowerCase()).sort(), id);
    vus++;
  }
  assert.ok(vus >= 5, `des thèmes de Hestia en « orbs » (${vus})`);
  assert.equal(c.S.html('orbs'), '', 'sans thème, rien'); assert.equal(c.S.couleurs('orbs').length, 0);
  c.O.apply('chaud'); assert.ok(couche(c)!.innerHTML.includes(t1.accent), 'Chaud : ses couleurs');
  c.O.apply('paysage'); assert.ok(couche(c)!.innerHTML.includes(t2.accent) && !couche(c)!.innerHTML.includes(t1.accent), 'Paysage : les siennes, pas celles de Chaud');
});

test('l\'orage : un éclair doux, jamais plus de trois par seconde, sans à-coup vif', () => {
  const c = charger();
  const css = c.S.CSS, html = c.S.html('storm');
  const cls = /class="(fv-[\w-]*eclair[\w-]*)"/.exec(html)?.[1];
  assert.ok(cls, 'un éclair dans l\'orage');
  const regle = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const [, nom, duree] = /animation:([\w-]+) ([\d.]+)s/.exec(regle) ?? [];
  assert.ok(nom && duree, regle);
  const d = Number(duree);
  // (Avant : 9 s. Un orage toutes les 7 s, comme la maquette (style.css:492) ; c'est chaque lueur qui est douce.)
  assert.equal(d, 7, 'un orage toutes les 7 s, comme la maquette');
  const corps = new RegExp(`@keyframes ${nom}\\{((?:[^{}]*\\{[^}]*\\})*)\\}`).exec(css)?.[1] ?? '';
  // Les étapes (instant en s, opacité), dans l'ordre.
  const etapes = [...corps.matchAll(/([\d.%,]+)\{opacity:([\d.]+)\}/g)].flatMap(([, ou, o]) => ou.split(',').map((x) => [parseFloat(x) / 100 * d, Number(o)] as [number, number])).sort((a, b) => a[0] - b[0]);
  assert.ok(etapes.length >= 3, corps);
  assert.ok(Math.max(...etapes.map((e) => e[1])) <= 0.22, 'pas plus fort que la maquette (0,22)');
  // Un éclair : une montée puis une descente ; les sommets, comptés dans toute fenêtre d'une seconde (la boucle comprise).
  const sommets = etapes.filter((e, i) => i > 0 && i < etapes.length - 1 && e[1] > etapes[i - 1][1] && e[1] > etapes[i + 1][1]).map((e) => e[0]);
  assert.ok(sommets.length >= 1);
  for (const s of sommets) assert.ok(sommets.filter((x) => (x - s + d) % d < 1).length <= 3, `au plus trois éclairs par seconde (${sommets})`);
  // Doux : chaque montée et chaque descente prend au moins 150 ms.
  for (let i = 1; i < etapes.length; i++) if (etapes[i][1] !== etapes[i - 1][1]) assert.ok(etapes[i][0] - etapes[i - 1][0] >= 0.15, `de ${etapes[i - 1][0].toFixed(2)} s à ${etapes[i][0].toFixed(2)} s : trop vif`);
});

test('pluie, orage, neige, feuilles, pétales, bulles : quelques nappes qui bougent d\'un bloc, chacune portant ses gouttes deux fois (la boucle ne se voit pas)', () => {
  const c = charger();
  for (const n of ['rain', 'storm', 'snow', 'leaves', 'petals', 'bubbles']) {
    const nappes = [...c.S.html(n).matchAll(/<div class="fv-nappe ([\w-]+)"[^>]*>(.*?)<\/div>/g)];
    assert.ok(nappes.length >= 2 && nappes.length <= 5, `${n} : ${nappes.length} nappes`);
    for (const [, , dedans] of nappes) {
      const tops = [...dedans.matchAll(/top:([\d.]+)%/g)].map((m) => Number(m[1]));
      assert.ok(tops.length >= 4 && tops.length % 2 === 0, `${n} : ${tops.length} gouttes`);
      const bas = tops.filter((x) => x >= 50).sort(), haut = tops.filter((x) => x < 50).map((x) => +(x + 50).toFixed(3)).sort();
      assert.deepEqual(haut, bas, `${n} : chaque goutte a sa copie, un écran plus loin`);
    }
  }
  // La pluie part jusqu'à 103 % de la largeur, comme la maquette (R(i, 104), logique.js:166-167) : elle penche vers la
  // gauche, le bord droit n'en est pas privé.
  for (const n of ['rain', 'storm']) assert.ok([...c.S.html(n).matchAll(/left:([\d.]+)%/g)].some((m) => Number(m[1]) >= 100), `${n} : jusqu'au bord droit`);
});

test('la couche est derrière l\'accueil seulement : premier élément de la vue, cachée aux lecteurs d\'écran, sans clic, sous les cartes', () => {
  const c = allume(); // (le fond allumé : il est éteint au départ depuis le 26/11)
  // (Nuit : son ambiance, ses étoiles ; chaque ambiance dessinée a désormais sa couche, à pleine force.)
  c.O.apply('nuit');
  const k = couche(c)!;
  assert.ok(k, 'la couche est posée');
  assert.equal(c.accueil.enfants[0], k, 'premier élément de #v-home');
  assert.equal(k.attrs['aria-hidden'], 'true'); assert.ok('inert' in k.attrs, 'inerte');
  const css = cssFond(c);
  const regle = /#v-home>#odinFond\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(regle, /position:absolute/); assert.match(regle, /inset:0/); assert.match(regle, /z-index:-1/); assert.match(regle, /pointer-events:none/); assert.match(regle, /overflow:hidden/);
  assert.match(css, /#odinFond \*\{pointer-events:none\}/, 'aucun de ses éléments ne prend un clic');
  // Sans vue d'accueil (une autre page), rien n'est posé.
  const sans = allume(null, { sansAccueil: true }); sans.O.apply('nuit');
  assert.equal(sans.styles.some((s) => s.id === 'odinFondStyle' && /fv-/.test(s.textContent) && sans.accueil.enfants.length), false);
});

test('mouvement réduit : aucun élément animé ; page cachée : tout s\'arrête', () => {
  const c = allume(); // (le fond allumé : il est éteint au départ depuis le 26/11)
  c.O.apply('neon');
  const css = cssFond(c);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{#odinFond,#odinFond \*\{animation:none!important;transition:none!important\}\}/);
  assert.match(css, /#odinFond\.fige,#odinFond\.fige \*\{animation-play-state:paused!important\}/);
  assert.equal(couche(c)!.classes.has('fige'), false);
  c.doc.hidden = true; c.visibilite();
  assert.equal(couche(c)!.classes.has('fige'), true, 'page cachée : figée');
  c.doc.hidden = false; c.visibilite();
  assert.equal(couche(c)!.classes.has('fige'), false, 'page revue : elle repart');
});

test('peu d\'éléments animés, seulement des transformations et de l\'opacité ; aucune image, aucune adresse extérieure', () => {
  const c = charger();
  const tout = c.S.CSS;
  for (const [, nom, corps] of tout.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^}]*\})*)\}/g)) {
    for (const [, prop] of corps.matchAll(/([a-z-]+):/g)) assert.ok(['transform', 'opacity'].includes(prop), `@keyframes ${nom} : ${prop}`);
  }
  // Les classes qui portent une animation, et combien d'éléments les portent dans chaque ambiance.
  const animees = [...tout.matchAll(/([^{}]+)\{[^}]*animation:[^}]*\}/g)].flatMap((m) => [...m[1].matchAll(/\.(fv-[\w-]+)(?![\w-])(?!\s*i\b)/g)].map((x) => x[1]));
  // (Avant : les six premières, au plus 10. Désormais les seize, au plus 9, comme la première part l'a tenu.)
  for (const n of [...NEUF, ...DIX]) {
    const html = c.S.html(n, c.O.THEMES[UN_THEME[n]]);
    let compte = 0;
    for (const [, classes] of html.matchAll(/class="([^"]*)"/g)) if (classes.split(/\s+/).some((k) => animees.includes(k))) compte++;
    assert.ok(compte <= 9, `${n} : ${compte} éléments animés`);
    if (n !== 'none') assert.ok(compte >= 1, `${n} : quelque chose bouge`);
    assert.doesNotMatch(html, /<img|<image|href|https?:|url\((?!#fv-)/i, `${n} : rien de dehors`);
  }
  assert.doesNotMatch(SCENES_JS, /https?:\/\/|<img|xlink|@import|url\((?!#|\$)/i, 'aucune adresse, aucune image');
  assert.doesNotMatch(tout, /url\(/, 'le style n\'appelle rien');
});

test('chaque couleur peinte par une ambiance est déclarée avec son opacité (le calcul de lisibilité les lit toutes)', () => {
  const c = charger();
  // (Avant : les six premières. Désormais les seize ; et les dix nouvelles ne peignent qu'en « #rrggbb », pour que rien
  //  n'échappe au calcul.)
  for (const n of [...NEUF, ...DIX]) {
    const t = c.O.THEMES[UN_THEME[n]], html = c.S.html(n, t);
    const dites = new Set(c.S.couleurs(n, t).map(([x]) => x.toLowerCase()));
    const peintes = new Set([...html.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase()));
    for (const p of peintes) assert.ok(dites.has(p), `${n} : ${p} déclarée`);
    for (const [x, a] of c.S.couleurs(n, t)) { assert.match(x, /^#[0-9a-f]{6}$/i); assert.ok(a > 0 && a <= 1, `${n} : ${x} ${a}`); }
    if (DIX.includes(n)) assert.doesNotMatch(html, /rgba?\(|hsla?\(|var\(|#[0-9a-f]{3}\b(?![0-9a-f])/i, `${n} : une couleur non déclarée`);
  }
  // Les couleurs rgba du style : du blanc seulement ; et chaque ambiance nouvelle qui peint du blanc par son style le déclare.
  for (const m of c.S.CSS.matchAll(/rgba\((\d+),(\d+),(\d+)/g)) assert.deepEqual([m[1], m[2], m[3]], ['255', '255', '255'], m[0]);
  for (const n of ['storm', 'snow']) assert.ok(c.S.couleurs(n).some(([x]) => x === '#ffffff'), `${n} : son blanc déclaré`);
  // Les couleurs écrites dans le style des ambiances (hors celles d'Odin) : blanc seulement, déclaré là où il sert.
  for (const m of c.S.CSS.matchAll(/#[0-9a-f]{6}\b/gi)) assert.ok(['#ffffff', '#34d399', '#22d3ee', '#7c5cff', '#5dffb0'].includes(m[0].toLowerCase()), m[0]);
});

// ------------------------------------------------------------------ le réglage « fond animé »

// (Avant : « le verre ne change pas » avec ou sans fond. Désormais, fond sur « oui », c'est la carte qui devient plus
//  opaque sous l'ambiance s'il le faut ; sur « non », elle est exactement celle d'avant le fond : essai suivant.)
// (Avant : « par défaut, le fond vit ». Sa décision du 26/11 : éteint au départ ; un « oui » gardé l'allume.)
test('réglage sur « non » : aucun élément ; réglage « oui » gardé : la couche', () => {
  const oui = allume({ mode: 'fixe', theme: 'nuit' }), non = charger({ mode: 'fixe', theme: 'nuit', fondAnime: false });
  oui.O.apply('nuit'); non.O.apply('nuit');
  assert.ok(couche(oui), 'réglage « oui » gardé : le fond vit');
  assert.equal(couche(non), undefined, 'réglage sur « non » : rien');
  // « oui » relu dans Odin : la couche vient.
  const lu = charger({ mode: 'fixe', theme: 'nuit' }, { mascotte: { mode: 'fixe', theme: 'nuit', fondAnime: true } });
  return lu.O.sync().then((r) => { assert.equal(r, true); assert.ok(couche(lu), 'Odin dit « oui » : la couche'); });
});

// Sa décision du 26/11 : « Éteint au départ » (ses thèmes gardent le verre qu'il a validé).
test('éteint au départ : sans réglage (rien de gardé, Odin muet, ou Odin sans réglage), aucune couche', async () => {
  for (const garde of [null, { mode: 'fixe', theme: 'nuit' }]) {
    const c = charger(garde); c.O.apply('nuit');
    assert.equal(couche(c), undefined, `rien de gardé (${JSON.stringify(garde)}), Odin injoignable : aucune couche`);
  }
  // Odin répond sans réglage, ou avec autre chose qu'un vrai oui : éteint.
  for (const fondAnime of [undefined, 'oui', 1, null]) {
    const c = charger({ mode: 'fixe', theme: 'nuit' }, { mascotte: { mode: 'fixe', theme: 'nuit', ...(fondAnime === undefined ? {} : { fondAnime }) } });
    assert.equal(await c.O.sync(), true); c.O.apply('nuit');
    assert.equal(couche(c), undefined, `Odin dit ${JSON.stringify(fondAnime)} : aucune couche`);
  }
});

test('sans réglage : pour les 85 thèmes, les cartes et la limite du curseur sont exactement celles de « fond animé : non »', () => {
  const ids = Object.keys(charger().O.THEMES);
  assert.equal(ids.length, 85, '85 thèmes');
  for (const id of ids) {
    for (const verre of [undefined, 100]) {
      const garde = { mode: 'fixe', theme: id, ...(verre === undefined ? {} : { verre: { [id]: verre } }) };
      const sans = charger(garde), non = charger({ ...garde, fondAnime: false });
      sans.O.apply(id); non.O.apply(id);
      assert.equal(cssTheme(sans), cssTheme(non), `${id} (verre ${verre ?? 'de départ'}) : la même carte`);
      assert.equal(JSON.stringify(sans.O.verre(id)), JSON.stringify(non.O.verre(id)), `${id} : le même curseur (limite comprise)`);
      assert.equal(couche(sans), undefined, `${id} : aucune couche`);
    }
  }
});

// Le themes.js d'avant le fond qui vit, s'il est encore celui du dernier enregistrement (sinon : la page sans le fichier
// des ambiances, qui suit le même chemin).
function themesAvantLeFond(): string | undefined {
  try {
    const x = execFileSync('git', ['show', 'HEAD:src/web/themes.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /odinFond/.test(x) ? undefined : x;
  } catch { return undefined; }
}

test('fond animé sur « non » : pour les 85 thèmes, les cartes et la limite du curseur sont exactement celles d\'avant le fond', (tt) => {
  const ids = Object.keys(charger().O.THEMES);
  assert.equal(ids.length, 85, '85 thèmes');
  const avant = themesAvantLeFond();
  tt.diagnostic(avant ? 'comparé au themes.js du dernier enregistrement (avant le fond)' : 'comparé à la page sans le fichier des ambiances');
  for (const id of ids) {
    for (const verre of [undefined, 100]) {
      const garde = { mode: 'fixe', theme: id, ...(verre === undefined ? {} : { verre: { [id]: verre } }) };
      const non = charger({ ...garde, fondAnime: false });
      non.O.apply(id);
      const refs = [charger(garde, { sansScenes: true }), ...(avant ? [charger(garde, { themesJs: avant })] : [])];
      for (const ref of refs) {
        ref.O.apply(id);
        assert.equal(cssTheme(non), cssTheme(ref), `${id} (verre ${verre ?? 'de départ'}) : la même carte`);
        assert.equal(JSON.stringify(non.O.verre(id)), JSON.stringify(ref.O.verre(id)), `${id} : le même curseur (limite comprise)`);
      }
      assert.equal(couche(non), undefined);
    }
  }
});

test('réglage dans la page : « non » retire la couche tout de suite, « oui » la remet ; le choix part vers Odin', async () => {
  const c = allume({ mode: 'fixe', theme: 'espace' }); // (« oui » gardé : éteint au départ depuis le 26/11)
  assert.ok(couche(c), 'le thème gardé, avec son fond');
  assert.equal(typeof c.O.reglerFond, 'function');
  const fait = c.O.reglerFond!(false);
  assert.equal(couche(c), undefined, 'tout de suite, avant la réponse d\'Odin');
  await fait;
  const parti = c.envoyes.find((b) => (b as { action: string }).action === 'regler_mascotte') as { input: { reglages: string } } | undefined;
  assert.deepEqual(JSON.parse(parti!.input.reglages), { fondAnime: false });
  // Odin injoignable : la page remet ce qu'Odin a vraiment (le dernier état connu : oui).
  assert.ok(couche(c), 'hors ligne : le choix n\'est pas gardé, la page remet le fond');
  const lu = allume({ mode: 'fixe', theme: 'espace' }, { mascotte: { mode: 'fixe', theme: 'espace', fondAnime: false } });
  assert.ok(couche(lu), 'avant la relecture');
  assert.equal(await lu.O.sync(), true);
  assert.equal(couche(lu), undefined, 'Odin dit « non » : la couche part');
});

function odinDEssai() {
  const home = mkdtempSync(join(tmpdir(), 'odin-scenes-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  return { v, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const regler = (v: Valhalla, j: Record<string, unknown>, o: Record<string, unknown> = {}) => v.act('apparence', 'regler_mascotte', { reglages: JSON.stringify(j) }, o as never);
const fondDOdin = async (v: Valhalla) => ((await v.act('apparence', 'mascotte', {})).data as { fondAnime?: unknown }).fondAnime;

// (Avant : « oui » par défaut. Sa décision du 26/11 : « non » au départ ; un vrai oui ou non gardé est respecté.)
test('fond animé gardé par Odin : non par défaut, « oui » et « non » gardés ; seul un vrai oui / non compte', async () => {
  const { v, fin } = odinDEssai();
  try {
    assert.equal(await fondDOdin(v), false, 'sans réglage : non');
    // Un réglage gardé qui n'est pas un vrai oui (abîmé à la main) : non.
    v.ctx('apparence').saveSettings({ fondAnime: 'oui' });
    assert.equal(await fondDOdin(v), false, 'un « oui » écrit en mots : non');
    assert.equal((await regler(v, { fondAnime: true })).ok, true);
    assert.equal(await fondDOdin(v), true, '« oui » gardé');
    const rien = await regler(v, { fondAnime: 'non' });
    assert.equal(rien.ok, false); assert.match(rien.text, /rien à enregistrer/);
    assert.equal(await fondDOdin(v), true);
    // Un autre réglage de la même page ne le change pas.
    await regler(v, { humeurTheme: false }); await regler(v, { verre: { glace: 40 } });
    assert.equal(await fondDOdin(v), true);
    assert.equal((await regler(v, { fondAnime: false })).ok, true);
    assert.equal(await fondDOdin(v), false, '« non » gardé');
  } finally { fin(); }
});

test('fond animé : réservé au propriétaire, comme le verre (ni une automatisation, ni un membre, ni après un contenu extérieur)', async () => {
  const { v, fin } = odinDEssai();
  try {
    const a = v.action('apparence', 'regler_mascotte')!.a as { proprietaireSeul?: unknown };
    assert.equal(typeof a.proprietaireSeul, 'function');
    for (const [qui, o] of [['une automatisation', { auto: true, by: 'automatisation' }], ['un membre', { qui: 'member' }], ['un contenu extérieur', { marque: true }]] as const) {
      const r = await regler(v, { fondAnime: true }, o);
      assert.equal(r.ok, false, qui); assert.match(r.text, /seul le propriétaire/, qui);
    }
    assert.equal(await fondDOdin(v), false, 'rien n\'a été gardé (éteint au départ, et le « oui » refusé)');
    assert.equal((await regler(v, { humeurTheme: false }, { qui: 'member' })).ok, true, 'le reste ne change pas');
  } finally { fin(); }
});

test('fond animé : refusé aussi à la clé d\'API et à une tablette « maison » ; la valeur ne bouge pas', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-scenes-entrees-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par l\'essai'); }) as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  const srv = createServer((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    assert.equal(await fondDOdin(v), false); // (éteint au départ ; les refusés essaient de l'allumer)
    const reglages = JSON.stringify({ fondAnime: true });
    // La clé d'API (pas la session du propriétaire).
    const cle = await valhallaPost('/api/valhalla/act', { module: 'apparence', action: 'regler_mascotte', input: { reglages }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false, 'la clé d\'API'); assert.match(cle.text, /pas avec la clé d'API/);
    // Une tablette « maison » : même par un bouton posé sur l'écran de la maison.
    assert.notEqual((await v.act('gladsheim', 'bouton', { nom: 'Fond', appli: 'apparence', action: 'regler_mascotte', reglages: `reglages=${reglages}` })).ok, false);
    const tuile = (v.ctx('gladsheim').settings.tiles as Array<{ id: string; action: string }>).find((x) => x.action === 'regler_mascotte')!;
    await new Promise<void>((ok) => srv.listen(0, 'localhost', () => ok()));
    const base = `http://localhost:${(srv.address() as { port: number }).port}`;
    const key = ((await v.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    const r = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: { 'x-odin-maison': key, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: tuile.id, confirm: true }) })).json() as { ok: boolean; text: string };
    assert.equal(r.ok, false, 'tablette « maison »'); assert.match(r.text, /seul le propriétaire/);
    assert.equal(await fondDOdin(v), false, 'aucun refusé n\'a changé la valeur');
  } finally { await new Promise<void>((ok) => { srv.close(() => ok()); }); setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ jamais illisible

// Le pire point derrière une carte, recalculé ici sans le code de themes.js : le dégradé et le dessin du décor sous le
// voile, puis l'ambiance (jusqu'à trois de ses couleurs l'une sur l'autre), à l'intensité posée par la page ; la
// saturation du verre ; la carte à ses deux bouts et le reflet en haut. L'ambiance bouge : chaque élément passe par
// toutes les opacités entre 0 et sa plus forte ; un mélange de deux couleurs à mi-opacité peut être plus sombre que
// chacune (le rouge et le vert font un brun) : chaque couleur est aussi comptée à la moitié de son opacité.
const hexRGB = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const sur = (d: number[], c: number[], a: number) => d.map((v, i) => v * (1 - a) + c[i] * a);
const lumi = (c: number[]) => { const [r, g, b] = c.map((v) => { v = Math.max(0, Math.min(255, Math.round(v))) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const saturer = ([r, g, b]: number[], s: number) => [(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b].map((v) => Math.max(0, Math.min(255, v)));
const variable = (texte: string, nom: string) => new RegExp(`${nom}:([^;}]*)`).exec(texte)?.[1]?.trim() ?? '';
// La fonction d'erreur, par la somme de sa série (indépendante de celle de la page).
const erf = (x: number) => { let s = 0, terme = x; for (let n = 0; n < 60; n++) { s += terme / (2 * n + 1); terme *= -x * x / (n + 1); } return 2 / Math.sqrt(Math.PI) * s; };
function pire(t: string, scene: Array<[string, number, number?]>, force: number): number {
  const racine = /:root\[data-odin-theme\]\{([^}]*)\}/.exec(t)?.[1] ?? '', cartes = /:not\(\.dragging\)\{([^}]*)\}/.exec(t)?.[1] ?? '';
  const page = /:root\[data-odin-theme\] body\{([^}]*)\}/.exec(t)?.[1] ?? '';
  const ciel = (/linear-gradient\(180deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i.exec(page) ?? []).slice(1).map(hexRGB);
  const svg = /url\("data:image\/svg\+xml;utf8,([^"]*)"\)/.exec(page)?.[1];
  // Chaque forme du décor avec son opacité (l'attribut opacity de sa balise ; sans lui, pleine). (Avant : chaque forme
  // comptait pleine, même dessinée à 5 % : un décor presque invisible, comme le trait clair de « Océan profond », passait
  // pour opaque, et le modèle jugeait illisible ce que la page affiche lisible. Une forme pleine compte comme avant.)
  const formes = svg ? [...decodeURIComponent(svg).matchAll(/<[a-z]+\s([^>]*)>/gi)].flatMap(([, at]) => { const op = Math.min(1, Number(/(?:^|\s)opacity="([\d.]+)"/.exec(at)?.[1] ?? 1)); return [...at.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((m) => ({ c: hexRGB(m[1]), op })); }) : [];
  const voile = /body::before\{[^}]*background:rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(t)!;
  const v = (x: number[]) => sur(x, [+voile[1], +voile[2], +voile[3]], +voile[4]);
  // Le fond sous le voile : le dégradé, et le décor sur le dégradé (à son opacité, et à sa moitié : le bord d'une forme),
  // deux formes translucides l'une sur l'autre comprises.
  const surCiel = ciel.flatMap((c) => formes.flatMap((f) => [sur(c, f.c, f.op), sur(c, f.c, f.op / 2)]));
  const deux = ciel.flatMap((c) => formes.flatMap((f, i) => formes.filter((g, j) => j !== i && g.op < 1).map((g) => sur(sur(c, f.c, f.op), g.c, g.op))));
  const fond = [...ciel, ...surCiel, ...deux].map(v);
  // Un point ou un trait fin (largeur w) derrière le verre est étalé par son flou (écart type --v-flou).
  const sigma = parseFloat(variable(racine, '--v-flou')) || 0;
  const sc = scene.flatMap(([c, a, w], i) => [1, 0.5].map((f) => ({ i, c: hexRGB(c), a: f * a * force * (w && sigma ? erf(w / (2 * Math.SQRT2 * sigma)) : 1) })));
  // Jusqu'à trois couleurs de l'ambiance l'une sur l'autre (une étoile sur deux taches), dans tous les ordres, couche
  // après couche (avant : deux seulement ; à trois, Glace de nuit perdait de sa lisibilité à 10 %).
  const dessous: number[][] = [...fond];
  let etage = fond.map((c) => ({ c, pris: [] as number[] }));
  for (let k = 0; k < 3; k++) {
    const suivant: typeof etage = [];
    for (const d of etage) for (const x of sc) { if (d.pris.includes(x.i)) continue; const y = { c: sur(d.c, x.c, x.a), pris: [...d.pris, x.i] }; dessous.push(y.c); suivant.push(y); }
    etage = suivant;
  }
  const sat = Number(variable(racine, '--v-sat'));
  const bouts = [...variable(racine, '--v-carte').matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => ({ c: [+m[1], +m[2], +m[3]], a: +m[4] }));
  const reflet = Number(variable(racine, '--v-reflet'));
  // Les luminances de tout ce qui se voit à travers la carte, triées : le pire contraste d'un texte est avec l'une des
  // deux voisines de la sienne.
  const lums = new Float64Array(dessous.length * (bouts.length + 1)); let n = 0;
  for (const d of dessous) { const s = saturer(d, sat); bouts.forEach((b, i) => { const x = sur(s, b.c, b.a); lums[n++] = lumi(x); if (i === 0) lums[n++] = lumi(sur(x, [255, 255, 255], reflet)); }); }
  const tri = lums.subarray(0, n).sort();
  let p = 21;
  for (const nom of ['--ink', '--muted', '--dim', '--accent-texte', '--good', '--warn', '--bad']) {
    const c = variable(cartes, nom) || variable(racine, nom);
    if (!/^#[0-9a-f]{6}$/i.test(c)) continue;
    const a = lumi(hexRGB(c)); let bas = 0, haut = tri.length;
    while (bas < haut) { const m = (bas + haut) >> 1; if (tri[m] < a) bas = m + 1; else haut = m; }
    for (const b of [tri[bas - 1], tri[bas]]) if (b !== undefined) p = Math.min(p, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  }
  return p;
}

// Fond sur « oui » : l'ambiance s'affiche comme dans la maquette, à pleine force (avant : effacée sur Glace, Vitre,
// Glace de nuit et h-neon, à 0,25 sur Néon) ; c'est la carte qui devient plus opaque s'il le faut (sa décision du 25/11,
// « Décor derrière, verre plus opaque »). (Chargé fond allumé : il est éteint au départ depuis le 26/11.)
test('à pleine force : sur chaque thème dont l\'ambiance est dessinée, la couche est posée en entier ; au pire moment de l\'ambiance (trois couleurs l\'une sur l\'autre), chaque texte des cartes garde 4,5:1, à la transparence de départ comme à la limite', (tt) => {
  const ids = avecFond(charger());
  assert.ok(ids.length >= 10, `des thèmes à fond animé (${ids.length})`);
  for (const n of ['glace', 'vitre', 'glacenuit', 'neon', 'h-neon', 'nuit']) assert.ok(ids.includes(n), n);
  const notes: string[] = [];
  for (const garde of [null, 'limite']) {
    for (const id of ids) {
      const c = allume(garde ? { mode: 'fixe', theme: id, verre: { [id]: 100 } } : null);
      c.O.apply(id);
      const t = cssTheme(c), k = couche(c), nom = c.S.ambianceDe(id);
      assert.ok(k, `${id} (${nom}, ${garde ?? 'départ'}) : la couche est posée`);
      assert.equal(k.style.opacity || '1', '1', `${id} (${nom}) : l'ambiance à pleine force`);
      const avec = pire(t, c.S.couleurs(nom, c.O.THEMES[id]), 1);
      assert.ok(avec >= 4.5, `${id} (${nom}, ${garde ?? 'départ'}) : ${avec.toFixed(2)} au pire moment de l'ambiance`);
      if (!garde) notes.push(`${id}:${nom}:${avec.toFixed(2)}`);
    }
  }
  tt.diagnostic(`pire contraste au départ : ${notes.join(' ')}`);
});

// Le curseur « Transparence du verre » : sa limite (au-delà, la carte ne devient pas plus transparente) compte l'ambiance
// quand le fond vit ; sans fond, c'est celle d'avant (essai « fond animé sur non » ci-dessus). (« oui » chargé allumé : il est éteint au départ depuis le 26/11.)
test('le curseur du verre : avec le fond, sa limite compte l\'ambiance (jamais au-dessus de celle sans fond, plus basse là où l\'ambiance l\'exige) ; à la limite, tout texte se lit au pire moment', (tt) => {
  const ids = avecFond(charger());
  const notes: string[] = []; let plusBasses = 0;
  for (const id of ids) {
    const oui = allume({ mode: 'fixe', theme: id }), non = charger({ mode: 'fixe', theme: id, fondAnime: false });
    const lo = oui.O.verre(id)!.limite, ln = non.O.verre(id)!.limite;
    assert.ok(lo <= ln, `${id} : limite ${lo} avec le fond, ${ln} sans`);
    if (lo < ln) plusBasses++;
    // Réglée juste à la limite, et au-delà : la même carte, lisible au pire moment de l'ambiance.
    const a = allume({ mode: 'fixe', theme: id, verre: { [id]: lo } }), b = allume({ mode: 'fixe', theme: id, verre: { [id]: Math.min(100, lo + 1) } });
    a.O.apply(id); b.O.apply(id);
    assert.equal(cssTheme(b), cssTheme(a), `${id} : au-delà de ${lo} %, la carte ne change plus`);
    assert.ok(pire(cssTheme(a), a.S.couleurs(a.S.ambianceDe(id), a.O.THEMES[id]), 1) >= 4.5, `${id} : lisible à la limite`);
    notes.push(`${id}:${ln}->${lo}`);
  }
  tt.diagnostic(`limites sans -> avec le fond : ${notes.join(' ')}`);
  assert.ok(plusBasses >= 1, 'au moins un thème dont l\'ambiance abaisse la limite');
});

// Le curseur sans effet : fond allumé, la carte de certains thèmes est pleine quelle que soit la transparence choisie ;
// le curseur le sait (`pleine`), et Réglages → Apparence le dit (essai du navigateur). Fond éteint : rien de nouveau.
test('le curseur sans effet : fond allumé, un thème dont la carte est pleine à toute valeur le sait ; les autres non', (tt) => {
  const alphas = (c: Charge) => [...variable(/:root\[data-odin-theme\]\{([^}]*)\}/.exec(cssTheme(c))?.[1] ?? '', '--v-carte').matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\)/g)].map((m) => Number(m[1]));
  const pleine = (id: string, v: number) => { const c = allume({ mode: 'fixe', theme: id, verre: { [id]: v } }); c.O.apply(id); const a = alphas(c); return a.length > 0 && a.every((x) => x === 1); };
  const pleines: string[] = [];
  for (const id of avecFond(charger())) {
    const c = allume({ mode: 'fixe', theme: id }); c.O.apply(id);
    const k = c.O.verre(id)!;
    assert.equal(typeof k.pleine, 'boolean', `${id} : fond allumé, le curseur sait si la carte est pleine`);
    // Vérifié sur la carte posée, sans le calcul de la page : pleine à 0 %, à la limite et à 100 %, ou non.
    const toutes = [0, k.limite, 100].map((v) => pleine(id, v));
    if (k.pleine) assert.deepEqual(toutes, [true, true, true], `${id} : dite pleine, elle l'est à toute valeur`);
    else assert.ok(toutes.includes(false), `${id} : pas dite pleine, une valeur au moins la laisse en verre`);
    if (k.pleine) pleines.push(id);
    // Fond éteint : le curseur est celui d'avant (rien de plus).
    const non = charger({ mode: 'fixe', theme: id, fondAnime: false }); non.O.apply(id);
    assert.equal(non.O.verre(id)!.pleine, undefined, `${id} : fond éteint, rien de nouveau`);
  }
  tt.diagnostic(`pleines avec le fond : ${pleines.join(' ')}`);
  for (const id of ['h-rubis', 'h-foret', 'h-acier']) assert.ok(pleines.includes(id), `${id} : pleine avec le fond`);
  assert.ok(!pleines.includes('glace'), 'Glace : le curseur agit');
});

// ------------------------------------------------------------------ dans un vrai navigateur : à l'écran, et la fluidité

type Page = { goto(u: string, o?: object): Promise<unknown>; waitForFunction(js: string, a?: unknown, o?: object): Promise<unknown>; evaluate<R>(js: string): Promise<R>; waitForTimeout(ms: number): Promise<void>; emulateMedia(o: object): Promise<void>; screenshot(o: object): Promise<unknown>; setViewportSize(o: object): Promise<void> };
let pw: { chromium: { launch(): Promise<{ newContext(o?: object): Promise<{ newPage(): Promise<Page>; addCookies(c: object[]): Promise<void>; newCDPSession(p: Page): Promise<{ send(m: string, p?: object): Promise<unknown> }> }>; close(): Promise<void> }> } } | undefined;
try { pw = createRequire(import.meta.url)('playwright'); } catch { pw = undefined; }

test('dans un vrai navigateur : la couche sous les cartes, sans clic, figée en mouvement réduit et page cachée, absente hors de l\'accueil ; la fluidité notée', { skip: pw ? false : 'Playwright absent' }, async (t) => {
  process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1'; process.env.ODIN_NO_LOCAL_BRAIN = '1';
  const { createOdin } = await import('../src/runtime.ts');
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import('../src/web/server.ts');
  const { MockProvider } = await import('../src/providers/mock.ts');
  const home = mkdtempSync(join(tmpdir(), 'odin-scenes-nav-'));
  const o = createOdin({ home, provider: new MockProvider([{ text: 'ok' }]), approver: { approve: async () => false }, configOverride: (c) => ({ ...c, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, journal: { ...c.journal, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, web: { ...c.web, portsParAppli: false } }) });
  const port = await freePort(), token = ensureWebToken(o.paths);
  const web = new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: 'localhost', token, access: 'local', scryptN: 1024 });
  const gw = new Gateway(o, { owners: { web: ['*'] } }); gw.add(web); await gw.start();
  const url = `http://localhost:${port}`;
  const browser = await pw!.chromium.launch();
  const captures = process.env.SCENES_CAPTURES;
  if (captures) mkdirSync(captures, { recursive: true });
  try {
    const r = await fetch(`${url}/api/account/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie: `odin_token=${token}` }, body: JSON.stringify({ prenom: 'Essai', nom: 'Fond', email: 'essai@exemple.test', password: 'un-cheval-bleu-traverse-la-riviere' }) });
    const session = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0].split('=') ?? [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: session[0], value: session[1], url }]);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.OdinThemes && window.OdinScenes && document.querySelector("#v-home.on")', undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    // Sa décision du 26/11 : éteint au départ. Un Odin neuf : l'interrupteur éteint et aucune couche, à 390 comme à
    // 1280 px, même sur un thème qui a une ambiance (Nuit). Puis il allume l'interrupteur de Réglages → Apparence : la
    // couche vient, aux deux largeurs. (Avant : le fond vivait dès l'ouverture ; la suite de cet essai le veut allumé.)
    const etatNeuf = () => page.evaluate<{ couche: boolean; coche: boolean | null }>('(window.OdinThemes.apply("nuit"), { couche: !!document.getElementById("odinFond"), coche: document.getElementById("themeFond") ? document.getElementById("themeFond").checked : null })');
    for (const w of [390, 1280]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await page.waitForTimeout(300);
      assert.deepEqual(await etatNeuf(), { couche: false, coche: false }, `Odin neuf, ${w} px : fond éteint, aucune couche`);
    }
    await page.evaluate('document.getElementById("themeFond").click()'); await page.waitForTimeout(800);
    for (const w of [390, 1280]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await page.waitForTimeout(300);
      assert.deepEqual(await etatNeuf(), { couche: true, coche: true }, `interrupteur allumé, ${w} px : la couche`);
    }
    // (Ce que garde Odin est vérifié plus haut, avec un Odin d'essai : ici, les applis d'Odin ne sont pas démarrées.)
    // Le thème posé dans la page seulement (Odin n'est pas relu entre-temps : le choix vaut pour la mesure).
    const poser = (id: string) => page.evaluate(`(window.OdinThemes.apply(${JSON.stringify(id)}), true)`);
    // La durée des images pendant 2 s : médiane, 95e centile, images par seconde.
    const mesurer = () => page.evaluate<{ fps: number; med: number; p95: number }>(`new Promise((ok) => { const d = []; let a = performance.now(); const t0 = a; const f = (n) => { d.push(n - a); a = n; if (n - t0 < 2000) requestAnimationFrame(f); else { d.sort((x, y) => x - y); ok({ fps: Math.round(d.length / ((n - t0) / 1000)), med: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * .95)].toFixed(1) }); } }; requestAnimationFrame(f); })`);
    // La même mesure, avec le travail du fil principal de la page (Performance.getMetrics, en ms par seconde : tout, les
    // scripts, les styles, la mise en page), et le processeur ralenti (Emulation.setCPUThrottlingRate) : à 60 images/s,
    // un navigateur sans écran plafonne, la durée des images seule ne départage pas avec et sans fond.
    const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
    const metriques = async () => Object.fromEntries(((await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }).metrics.map((x) => [x.name, x.value]));
    const mesures: Array<Record<string, unknown>> = [];
    const mesurerTout = async (id: string, fond: boolean, ralenti: number) => {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: ralenti });
      try {
        const a = await metriques(), m = await mesurer(), b = await metriques();
        const duree = b.Timestamp - a.Timestamp || 2, par = (k: string) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000 / duree);
        const x = { id, fond, ralenti, ...m, fil: par('TaskDuration'), scripts: par('ScriptDuration'), styles: par('RecalcStyleDuration'), miseEnPage: par('LayoutDuration') };
        mesures.push(x); return x;
      } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
    };
    const ligne = (x: Record<string, unknown>) => `${x.id} ${x.fond ? 'avec' : 'sans'} fond, processeur ${x.ralenti === 1 ? 'normal' : `ralenti ${x.ralenti} fois`} : ${x.fps} images/s, médiane ${x.med} ms, 95e centile ${x.p95} ms ; fil principal ${x.fil} ms/s (scripts ${x.scripts}, styles ${x.styles}, mise en page ${x.miseEnPage})`;
    const lignes: string[] = [];
    // (Avant : Glace, Vitre et Glace de nuit sans couche, leur ambiance effacée pour la lecture. Désormais chaque ambiance
    //  dessinée se voit à pleine force ; c'est la carte qui devient plus opaque s'il le faut.)
    // (Et, depuis les dix autres ambiances, un thème de chacune : aurore, vagues, pluie, orage, neige, feuilles, pétales,
    //  bulles, coucher de soleil, taches aux couleurs du thème.)
    const DIX_NAV = [['aurore', 'aurora'], ['ocean', 'waves'], ['pluie', 'rain'], ['orage', 'storm'], ['neige', 'snow'], ['foret', 'leaves'], ['printemps', 'petals'], ['h-abysses', 'bubbles'], ['coucher', 'sunset'], ['chaud', 'orbs']] as const;
    for (const [id, nom, attendue] of [['ha', 'none', false], ['glace', 'ice', true], ['vitre', 'swoosh', true], ['glacenuit', 'icenight', true], ['neon', 'neon', true], ['h-neon', 'neon', true], ['ev-musique', 'neon', true], ['nuit', 'stars', true], ...DIX_NAV.map(([i, n]) => [i, n, true] as const)] as const) {
      await poser(id); await page.waitForTimeout(400);
      const etat = await page.evaluate<{ couche: boolean; premier: boolean; ambiance: string; anim: number; props: string[]; sousCarte: boolean; opacite: string }>(`(() => {
        const k = document.getElementById('odinFond');
        const anims = k ? k.getAnimations({ subtree: true }) : [];
        const props = [...new Set(anims.flatMap((a) => a.effect.getKeyframes().flatMap((f) => Object.keys(f).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))))];
        // Le fond ne passe devant aucun texte ni bouton de l'accueil : en leur centre, c'est eux qu'on touche.
        let sousCarte = true;
        for (const e of document.querySelectorAll('#v-home button, #v-home h1, #v-home h2, #v-home h3, #v-home .fe-w, #v-home .hcard, #v-home .hpanel')) {
          const b = e.getBoundingClientRect(); if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight) continue;
          const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (x && k && k.contains(x)) sousCarte = false;
        }
        return { couche: !!k, premier: !!k && k.parentElement.id === 'v-home', ambiance: k ? k.dataset.ambiance : '', anim: new Set(anims.map((a) => a.effect.target)).size, props, sousCarte, opacite: k ? getComputedStyle(k).opacity : '' };
      })()`);
      assert.equal(etat.couche, attendue, `${id} : couche ${nom}`);
      if (etat.couche) {
        assert.equal(etat.premier, true); assert.equal(etat.ambiance, nom);
        assert.equal(etat.opacite, '1', `${id} : l'ambiance à pleine force`);
        // (Avant : au plus 10. Désormais au plus 9, comme la première part l'a tenu, pour les seize.)
        assert.ok(etat.anim > 0 && etat.anim <= 9, `${id} : ${etat.anim} éléments animés`);
        for (const p of etat.props) assert.ok(['transform', 'opacity'].includes(p), `${id} : anime ${p}`);
      }
      assert.equal(etat.sousCarte, true, `${id} : le fond ne passe devant rien`);
      if (captures) for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await page.waitForTimeout(300); await page.screenshot({ path: join(captures, `${id}-${w}.png`) }); }
      await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200);
      const m = await mesurerTout(id, etat.couche, 1);
      lignes.push(`${id} (${nom}${etat.opacite && etat.opacite !== '1' ? `, intensité ${etat.opacite}` : ''}) : ${ligne(m)}`);
      if (['nuit', 'ev-musique', 'glace', 'pluie', 'neige', 'orage'].includes(id)) lignes.push(ligne(await mesurerTout(id, etat.couche, 4)));
    }
    // À 390 et 1280 px, l'appareil en clair puis en sombre : la couche à pleine force, rien ne déborde de la largeur.
    for (const sch of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: sch });
      for (const id of ['glace', 'vitre', 'glacenuit', 'neon', 'nuit', ...DIX_NAV.map(([i]) => i)]) {
        await poser(id);
        for (const w of [390, 1280]) {
          await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await page.waitForTimeout(250);
          const x = await page.evaluate<{ opacite: string; deborde: boolean }>('(() => { const k = document.getElementById("odinFond"); return { opacite: k ? getComputedStyle(k).opacity : "", deborde: document.documentElement.scrollWidth > innerWidth + 1 }; })()');
          assert.deepEqual(x, { opacite: '1', deborde: false }, `${id} à ${w} px (${sch})`);
          if (captures) await page.screenshot({ path: join(captures, `${id}-${w}-${sch}.png`) });
        }
      }
    }
    await page.emulateMedia({ colorScheme: 'no-preference' }); await page.setViewportSize({ width: 1280, height: 900 });
    // Le même thème, réglage sur « non » (accueil sans fond) : la comparaison.
    await page.evaluate('window.OdinThemes.reglerFond(false)'); await page.waitForTimeout(300);
    for (const id of ['neon', 'ev-musique', 'nuit', 'pluie', 'neige', 'orage']) {
      await poser(id); await page.waitForTimeout(300);
      assert.equal(await page.evaluate<boolean>('!!document.getElementById("odinFond")'), false, `${id} : réglage « non », aucun élément`);
      lignes.push(ligne(await mesurerTout(id, false, 1)));
      if (id !== 'neon') lignes.push(ligne(await mesurerTout(id, false, 4)));
    }
    await poser('glace'); await page.waitForTimeout(300);
    lignes.push(ligne(await mesurerTout('glace', false, 4)));
    // La mesure, rangée avec les bancs de rapidité (SCENES_MESURES : un dossier hors du dépôt).
    const rangement = process.env.SCENES_MESURES;
    // (Avant : toujours fond-anime.json et .txt, qu'une nouvelle mesure écrasait. Désormais une mesure déjà rangée n'est
    //  jamais remplacée : la suivante prend le premier nom libre, fond-anime-2, fond-anime-3…)
    if (rangement) {
      mkdirSync(rangement, { recursive: true });
      let base = 'fond-anime';
      for (let k = 2; existsSync(join(rangement, `${base}.json`)) || existsSync(join(rangement, `${base}.txt`)); k++) base = `fond-anime-${k}`;
      writeFileSync(join(rangement, `${base}.json`), JSON.stringify(mesures, null, 2)); writeFileSync(join(rangement, `${base}.txt`), lignes.join('\n') + '\n');
    }
    await page.evaluate('window.OdinThemes.reglerFond(true)'); await page.waitForTimeout(300);
    // Page cachée : tout s'arrête. Mouvement réduit : aucun élément animé. (Avant : Nuit seulement ; désormais aussi un
    // thème de chacune des dix autres ambiances.)
    for (const id of ['nuit', ...DIX_NAV.map(([i]) => i)]) {
      await poser(id); await page.waitForTimeout(300);
      const fige = await page.evaluate<number>(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); const k = document.getElementById('odinFond'); const n = k.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return n; })()`);
      assert.equal(fige, 0, `${id} : page cachée, aucune animation ne tourne`);
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(250);
      assert.equal(await page.evaluate<number>('document.getElementById("odinFond").getAnimations({ subtree: true }).length'), 0, `${id} : mouvement réduit, rien d'animé`);
      if (captures) for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await page.waitForTimeout(200); await page.screenshot({ path: join(captures, `${id}-moins-animations-${w}.png`) }); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(250);
    }
    await poser('nuit'); await page.waitForTimeout(300);
    // Une autre vue : rien ne tourne derrière elle.
    await page.evaluate('document.querySelector(\'button.tab[data-view="chat"]\').click()'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate<number>('document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#odinFond")).length'), 0, 'hors de l\'accueil : aucune animation du fond');
    // (et avec l'orage, posé pendant qu'une autre vue est ouverte)
    await poser('orage'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate<number>('document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#odinFond")).length'), 0, 'hors de l\'accueil, l\'orage : aucune animation du fond');
    // L'interrupteur de Réglages → Apparence : une vraie case (rôle d'interrupteur), 44 px.
    const inter = await page.evaluate<{ role: string; coche: boolean; haut: string }>('(() => { const x = document.getElementById("themeFond"); return x ? { role: x.getAttribute("role"), coche: x.checked, haut: getComputedStyle(x.closest("label")).minHeight } : { role: "", coche: false, haut: "" }; })()');
    assert.deepEqual(inter, { role: 'switch', coche: true, haut: '44px' });
    // L'interrupteur ne dit « l'ambiance reste cachée » (ou baissée) que si elle l'est vraiment : chaque ambiance dessinée se
    // voit en entier, il ne dit rien (avant : Glace, Vitre et Glace de nuit le disaient).
    const dit = async (id: string) => { await page.evaluate(`window.OdinThemes.choose(${JSON.stringify(id)})`); await page.waitForTimeout(600); return page.evaluate<{ texte: string; cache: boolean }>('(() => { const x = document.getElementById("themeFondSans"); return { texte: x ? x.textContent : "", cache: !x || x.hidden }; })()'); };
    // (Avant : les six premières ; désormais un thème de chacune des dix autres aussi, qui disaient « pas d'ambiance ».)
    for (const id of ['glace', 'vitre', 'glacenuit', 'neon', 'nuit', ...DIX_NAV.map(([i]) => i)]) assert.deepEqual(await dit(id), { texte: '', cache: true }, `${id} : son ambiance se voit, rien à dire`);
    // Le curseur du verre : sa phrase « Au-delà de N % » dit la limite qui compte l'ambiance ; fond sur « non », celle d'avant.
    await page.evaluate('window.OdinThemes.choose("glace")'); await page.waitForTimeout(600);
    const phrase = async (v: number) => { await page.evaluate(`window.OdinThemes.reglerVerre(${v}, false)`); await page.waitForTimeout(200); return page.evaluate<{ texte: string; limite: number }>('({ texte: document.getElementById("themeVerreLimite").textContent, limite: window.OdinThemes.verre("glace").limite })'); };
    const avecFond = await phrase(100);
    assert.ok(avecFond.limite < 100, `Glace : limite ${avecFond.limite} avec le fond`);
    assert.match(avecFond.texte, new RegExp(`Au-delà de ${avecFond.limite} %`), 'la phrase dit la limite avec le fond');
    await page.evaluate('window.OdinThemes.reglerFond(false)'); await page.waitForTimeout(400);
    const sansFond = await phrase(100);
    assert.ok(sansFond.limite >= avecFond.limite, `sans le fond : ${sansFond.limite}`);
    if (sansFond.limite < 100) assert.match(sansFond.texte, new RegExp(`Au-delà de ${sansFond.limite} %`), 'sans le fond, la phrase d\'avant');
    else assert.equal(sansFond.texte, '', 'sans le fond, aucune limite : aucune phrase');
    await page.evaluate('window.OdinThemes.reglerFond(true)'); await page.waitForTimeout(300);
    // Le curseur sans effet : fond allumé, une carte pleine à toute valeur (h-rubis) ; le curseur le dit, à toute valeur,
    // sans parler d'une limite. Fond éteint : la phrase s'en va.
    await page.evaluate('window.OdinThemes.choose("h-rubis")'); await page.waitForTimeout(600);
    const dite = async (v: number) => { await page.evaluate(`window.OdinThemes.reglerVerre(${v}, false)`); await page.waitForTimeout(200); return page.evaluate<{ texte: string; cache: boolean; pleine: boolean }>('(() => { const x = document.getElementById("themeVerreLimite"); return { texte: x.textContent, cache: x.hidden, pleine: window.OdinThemes.verre("h-rubis").pleine === true }; })()'); };
    for (const v of [0, 40, 100]) {
      const x = await dite(v);
      assert.equal(x.pleine, true, `h-rubis à ${v} % : carte pleine`);
      assert.equal(x.cache, false, `h-rubis à ${v} % : la phrase se voit`);
      assert.match(x.texte, /Avec le fond animé, les cartes de ce thème restent pleines/, `h-rubis à ${v} %`);
      assert.doesNotMatch(x.texte, /Au-delà de/, `h-rubis à ${v} % : pas de limite dite`);
    }
    await page.evaluate('window.OdinThemes.reglerFond(false)'); await page.waitForTimeout(400);
    assert.doesNotMatch((await dite(40)).texte, /fond animé/, 'fond éteint : la phrase s\'en va');
    await page.evaluate('window.OdinThemes.reglerFond(true)'); await page.waitForTimeout(300);
    for (const l of lignes) t.diagnostic(l);
  } finally {
    await browser.close().catch(() => undefined); await gw.stop().catch(() => undefined); o.close();
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ }
  }
});
