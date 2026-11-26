// Le tiroir « Ajouter un widget » de l'accueil (lot 18 de la maquette validée « Accueil »).
// D'abord les calculs de src/web/pages/accueil-tiroir.js, lus sans document : les familles viennent du catalogue (une
// appli ajoutée demain y paraît sans rien coder), la recherche (sans accents, « Rien trouvé. »), l'appli désactivée
// (grisée, jamais posée), le focus gardé dans le tiroir. Puis la lecture de fenetre.js (aucune liste d'applis écrite
// en dur, le tiroir rempli par /api/valhalla/catalog). Enfin, dans un vrai navigateur et un vrai Odin d'essai : la
// tuile en fin de grille, le tiroir de 440 px (tout l'écran à 390 px), Échap qui ferme et rend le focus, Tab qui reste
// dedans, l'appli désactivée grisée, le widget posé à la fin avec le focus sur lui.
// Sans Playwright sur la machine, la partie navigateur est ignorée (elle le dit).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { NAMES } from '../src/valhalla/names.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

type Ligne = { nom: string; quoi?: string; famille: string; groupe?: string; active?: boolean; module?: string };
interface Tiroir {
  MESURES: { largeur: number; cible: number }; TEXTES: Record<string, unknown> & { rien: string; titre: string; tuile: string }; TOUT: string; INFOS: string; CSS: string;
  sansAccents: (t: unknown) => string; active: (m: unknown) => boolean; poser: (modules: unknown, id: unknown) => string;
  familles: (modules: unknown) => string[]; famille: (choisie: string, connues: unknown) => string;
  trouver: (lignes: unknown, terme: string, choisie?: string) => Array<{ titre: string; lignes: Ligne[] }>; boucle: (n: number, i: number, arriere: boolean) => number;
}
const SRC = readFileSync(new URL('../src/web/pages/accueil-tiroir.js', import.meta.url), 'utf8');
const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const win: { OdinTiroir?: unknown } = {};
vm.runInNewContext(SRC, { window: win }); // ni document, ni fetch : rien ne doit s'exécuter d'autre à son chargement
const brut = win.OdinTiroir as Record<string, unknown>;
assert.ok(brut, 'window.OdinTiroir est posé');
const ici = (x: unknown) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);
const O = Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, typeof v === 'function' ? (...a: unknown[]) => ici((v as (...b: unknown[]) => unknown)(...a)) : v])) as unknown as Tiroir;

/** Un catalogue comme /api/valhalla/catalog le rend (forme seule ; des noms inventés, pas ceux d'Odin). */
const CATALOGUE = [
  { id: 'alpha', name: 'Alpha', family: 'Réseau', what: 'Surveille la météo du réseau', active: true, essentielle: false },
  { id: 'beta', name: 'Bêta', family: 'Données', what: 'Range les fichiers', active: false, essentielle: false },
  { id: 'gamma', name: 'Gamma', family: 'Réseau', what: 'Compte les appareils', active: true, essentielle: false },
  { id: 'delta', name: 'Delta', family: 'Cœur', what: 'Garde les comptes', active: false, essentielle: true },
];
const lignesDe = (mods: typeof CATALOGUE): Ligne[] => [
  { nom: 'Heure et lieu', quoi: 'la date et l\'heure', famille: O.INFOS }, { nom: 'Météo', quoi: 'le temps', famille: O.INFOS },
  ...mods.map((m) => ({ nom: m.name, quoi: m.what, famille: m.family, module: m.id, active: O.active(m) })),
];
const noms = (g: Array<{ lignes: Ligne[] }>) => g.flatMap((x) => x.lignes.map((l) => l.nom));

/** Le texte entier de la fonction `nom` de fenetre.js (définie une seule fois ; chaînes et commentaires sautés). */
function fonction(nom: string): string {
  const m = [...FE.matchAll(new RegExp(`(?:async\\s+)?function\\s+${nom}\\s*\\(`, 'g'))];
  assert.equal(m.length, 1, `fenetre.js : la fonction ${nom} existe, une seule fois`);
  const i = m[0].index ?? 0, corps = FE.indexOf('{', fermer(FE, FE.indexOf('(', i)));
  return FE.slice(i, fermer(FE, corps) + 1);
}
function fermer(s: string, i: number): number {
  const ouvre = s[i], ferme = ({ '(': ')', '{': '}', '[': ']' } as Record<string, string>)[ouvre];
  let n = 0;
  for (let j = i; j < s.length;) {
    const c = s[j];
    if (c === '\'' || c === '"' || c === '`') { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } j++; continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); continue; }
    if (c === ouvre) n++; else if (c === ferme && --n === 0) return j;
    j++;
  }
  throw new Error(`« ${ouvre} » jamais fermé`);
}

test('tiroir : chargé sans document, rien ne s\'exécute ; les mesures de la maquette', () => {
  assert.equal(O.MESURES.largeur, 440, 'un tiroir de 440 px (C403)');
  assert.equal(O.MESURES.cible, 44, 'chaque contrôle se touche sur 44 px');
  assert.doesNotMatch(SRC, /document\.|addEventListener|setTimeout|fetch\(/, 'aucun accès au document, aucun minuteur : des calculs seuls');
  assert.match(O.CSS, /width:min\(440px,100vw\)/, 'à 390 px, il prend tout l\'écran');
  assert.match(O.CSS, /\.fe-tiroir\{[^}]*visibility:hidden/, 'fermé, il est caché au clavier et aux lecteurs d\'écran');
  assert.match(O.CSS, /prefers-reduced-motion:reduce\)\{\.fe-tiroir,\.fe-tiroir\.open\{transition:none\}/, '« moins d\'animations » : il apparaît sans glisser');
  assert.equal(O.TEXTES.rien, 'Rien trouvé.', 'le texte de la maquette (L739)');
  assert.equal(O.TEXTES.titre, 'Ajouter un widget'); assert.equal(O.TEXTES.tuile, 'Ajouter un widget');
});

test('tiroir : les familles viennent du catalogue, dans son ordre, sans double ni vide', () => {
  assert.deepEqual(O.familles(CATALOGUE), ['Réseau', 'Données', 'Cœur']);
  assert.deepEqual(O.familles([{ id: 'x', family: '  ' }, { id: 'y' }, null, { id: 'z', family: 'A' }]), ['A']);
  assert.deepEqual(O.familles(undefined), [], 'pas de catalogue : aucune famille');
  assert.equal(O.famille('Données', ['Réseau', 'Données']), 'Données');
  assert.equal(O.famille('Disparue', ['Réseau']), O.TOUT, 'une famille disparue du catalogue : « Tout »');
  assert.equal(O.famille(O.INFOS, []), O.INFOS, '« Infos » existe toujours');
});

test('tiroir : une appli ajoutée demain y paraît, dans sa famille, sans rien coder', () => {
  const demain = [...CATALOGUE, { id: 'epsilon', name: 'Epsilon', family: 'Famille de demain', what: 'Une appli toute neuve', active: true, essentielle: false }];
  assert.ok(O.familles(demain).includes('Famille de demain'), 'sa famille a sa puce');
  const g = O.trouver(lignesDe(demain), '', 'Famille de demain');
  assert.deepEqual(g.map((x) => x.titre), ['Famille de demain']);
  assert.deepEqual(noms(g), ['Epsilon']);
  assert.ok(noms(O.trouver(lignesDe(demain), 'neuve', O.TOUT)).includes('Epsilon'), 'et la recherche la trouve');
});

test('tiroir : la recherche (sans accents ni majuscules, plusieurs mots), les puces, « Rien trouvé. »', () => {
  const l = lignesDe(CATALOGUE);
  const tout = O.trouver(l, '', O.TOUT);
  assert.deepEqual(tout.map((x) => x.titre), ['Infos et repères', 'Réseau', 'Données', 'Cœur'], 'les infos d\'abord, puis les familles du catalogue');
  assert.deepEqual(noms(O.trouver(l, 'METEO', O.TOUT)), ['Météo', 'Alpha'], '« METEO » trouve « Météo » et « la météo du réseau »');
  assert.deepEqual(noms(O.trouver(l, 'meteo reseau', O.TOUT)), ['Alpha'], 'tous les mots doivent y être');
  assert.deepEqual(noms(O.trouver(l, 'beta', O.TOUT)), ['Bêta'], 'une appli désactivée se trouve aussi (grisée)');
  assert.deepEqual(noms(O.trouver(l, '', 'Réseau')), ['Alpha', 'Gamma'], 'la puce d\'une famille');
  assert.deepEqual(noms(O.trouver(l, '', O.INFOS)), ['Heure et lieu', 'Météo'], 'la puce « Infos »');
  assert.deepEqual(noms(O.trouver(l, 'reseau', O.TOUT)), ['Alpha', 'Gamma'], 'la famille compte dans la recherche');
  assert.deepEqual(O.trouver(l, 'zzzz introuvable', O.TOUT), [], 'rien : une liste vide');
  assert.deepEqual(O.trouver(l, 'alpha', 'Données'), [], 'rien dans cette famille');
  assert.deepEqual(O.trouver(undefined, 'x', O.TOUT), []);
  // fenetre.js écrit « Rien trouvé. » quand la liste est vide, et le dit aux lecteurs d'écran.
  const c = fonction('catalogue');
  assert.match(c, /n \? groupes\.flatMap[\s\S]*?: \[el\('p', \{ class: 'fe-tiroir-rien' \}, T\.rien\)\]/, 'la liste vide montre « Rien trouvé. »');
  assert.match(c, /statut\.textContent = n \? T\.trouves\(n\) : T\.rien/, 'et le nombre trouvé est dit');
  assert.match(c, /role: 'status', 'aria-live': 'polite'/, 'dans une zone lue par les lecteurs d\'écran');
});

test('tiroir : une appli désactivée est grisée, avec « désactivée », et jamais posée', () => {
  assert.equal(O.active(CATALOGUE[0]), true); assert.equal(O.active(CATALOGUE[1]), false);
  assert.equal(O.active(CATALOGUE[3]), true, 'une essentielle est toujours active');
  assert.equal(O.active({ id: 'ancien' }), true, 'un catalogue sans « active » (ancien Odin) : active');
  assert.equal(O.poser(CATALOGUE, 'alpha'), 'ok');
  assert.equal(O.poser(CATALOGUE, 'beta'), 'desactivee');
  assert.equal(O.poser(CATALOGUE, 'inconnue'), 'inconnue', 'absente du catalogue de qui regarde : refusée');
  assert.equal(O.poser(undefined, 'alpha'), 'inconnue', 'catalogue illisible : refusée');
  assert.equal(O.poser(CATALOGUE, undefined), 'ok', 'heure et météo n\'ont pas d\'appli');
  const c = fonction('catalogue');
  assert.match(c, /if \(x\.active === false\) return el\('div', \{ class: 'fe-it off' \}, ic, texte, el\('span', \{ class: 'fe-off' \}, T\.desactivee\)\);/, 'grisée, « désactivée », sans bouton ni glisser');
  assert.match(c, /active: OT\.active\(m\)/, 'l\'état vient du catalogue');
  assert.match(c, /active: OT\.active\(vordr\)/, 'le site surveillé aussi, si Pulsar est désactivée');
  const a = fonction('add');
  assert.match(a, /ok = OT\.poser\(cat\?\.modules, n\.module\);\s*if \(ok !== 'ok'\) \{ page\(\)\.widgets\.pop\(\);/, 'même glissée d\'ailleurs, elle n\'est pas posée');
});

test('relecture : un glisser venu d\'ailleurs ne pose qu\'une ligne du tiroir, refaite (jamais un bouton d\'action)', () => {
  const g = (O as unknown as { glisse: (t: unknown) => unknown }).glisse;
  assert.equal(typeof g, 'function', 'OdinTiroir.glisse existe');
  assert.deepEqual(g(JSON.stringify({ kind: 'heure', module: 'x', label: 'y' })), { kind: 'heure' });
  // La ligne « Météo » pose la grande météo de la maquette (« Complète », 4 × 5) : glissée, le même objet, refait en
  // entier (test/widgets-meteo.test.ts) ; rien de ce qui vient du glisser n'est recopié.
  assert.deepEqual(g(JSON.stringify({ kind: 'meteo', label: 'y', style: 'scene', c: 12 })), { kind: 'meteo', style: 'complete', w: 1, c: 4, r: 5 });
  assert.deepEqual(g(JSON.stringify({ kind: 'chiffres', module: 'alpha', action: 'retirer' })), { kind: 'chiffres', module: 'alpha' }, 'rien d\'autre n\'est gardé');
  assert.equal(g(JSON.stringify({ kind: 'bouton', module: 'alpha', action: 'retirer', input: { login: 'x' } })), null, 'un bouton d\'action glissé d\'une autre page : refusé');
  assert.equal(g(JSON.stringify({ kind: 'site', module: 'vordr', label: 'x' })), null);
  assert.equal(g(JSON.stringify({ kind: 'chiffres', module: '../x' })), null);
  assert.equal(g('{pas du json'), null, 'illisible : rien, sans erreur');
  assert.equal(g(''), null); assert.equal(g(undefined), null); assert.equal(g('[1]'), null);
  // Le widget d'une appli glissé (sa ligne pose le widget « appli ») est refait à la taille déclarée par sa famille,
  // comme « Ajouter » (test/widgets-generique.test.ts) ; le reste passe tel que glisse l'a refait.
  assert.match(fonction('draw'), /const w = OT\.glisse\(e\.dataTransfer\.getData\('text\/odin-module'\)\); if \(w\) add\(w\.kind === 'appli' \? widgetDeLAppli\(w\.module\) : w\);/, 'la grille passe par lui');
  assert.deepEqual(g(JSON.stringify({ kind: 'appli', module: 'alpha', action: 'retirer', c: 12 })), { kind: 'appli', module: 'alpha' }, 'le widget d\'une appli : rien d\'autre n\'est gardé');
  assert.equal(g(JSON.stringify({ kind: 'appli', module: '../x' })), null);
});

test('relecture : bouton sur mesure sans appli désactivée ; refusé, le dialogue reste ouvert ; une autre vue ferme le tiroir', () => {
  assert.match(fonction('ownButton'), /const mods = \(cat\?\.modules \?\? \[\]\)\.filter\(OT\.active\)/, 'seules les applis actives sont proposées');
  assert.match(fonction('ownButton'), /return add\(\{ kind: 'bouton'/, 'refusé : Valider ne ferme pas le dialogue');
  assert.match(fonction('add'), /return false; \}[\s\S]*return true; \}$/, 'add dit si c\'est posé');
  assert.match(FE, /document\.addEventListener\('odin:vue', \(e\) => \{ if \(e\.detail\?\.vue !== 'home'\) fermerTiroir\(false\); \}\);/, 'une autre vue ferme le tiroir');
  assert.doesNotMatch(O.CSS, /\.fe-it\.off\{opacity/, 'le texte d\'une appli désactivée garde son contraste (seule l\'icône pâlit)');
});

test('tiroir : le focus reste dedans (Tab, Maj + Tab)', () => {
  assert.equal(O.boucle(5, 4, false), 0, 'Tab sur le dernier : le premier');
  assert.equal(O.boucle(5, 0, true), 4, 'Maj + Tab sur le premier : le dernier');
  assert.equal(O.boucle(5, 2, false), -1, 'au milieu : le navigateur fait');
  assert.equal(O.boucle(5, -1, false), 0, 'le focus est ailleurs : ramené dedans');
  assert.equal(O.boucle(5, -1, true), 4);
  assert.equal(O.boucle(0, -1, false), -1, 'rien à atteindre');
  const t = fonction('toucheTiroir');
  assert.match(t, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); fermerTiroir\(\); return; \}/, 'Échap ferme');
  assert.match(t, /OT\.boucle\(l\.length, l\.indexOf\(document\.activeElement\), e\.shiftKey\)/, 'Tab tourne dans le tiroir');
  assert.match(fonction('fermerTiroir'), /if \(rendre && o\?\.isConnected\) o\.focus\(\);/, 'et le focus revient à ce qui l\'a ouvert');
});

test('fenetre.js : le tiroir est rempli par le catalogue d\'Odin, aucune liste d\'applis n\'y est écrite', () => {
  const c = fonction('catalogue');
  assert.match(FE, /api\('\/api\/valhalla\/catalog'\)/, 'le vrai catalogue (déjà filtré par les droits)');
  assert.match(c, /\.\.\.\(cat\?\.modules \?\? \[\]\)\.map\(\(m\) =>/, 'une ligne par appli du catalogue');
  assert.match(c, /OT\.familles\(cat\?\.modules\)/, 'les puces viennent du catalogue');
  // Aucun nom ni identifiant d'appli dans le tiroir (sauf Pulsar, l'appli du site surveillé).
  const permis = new Set(['vordr', 'Pulsar']);
  for (const [id, nom] of Object.entries(NAMES)) {
    for (const mot of [id, nom]) {
      if (permis.has(mot) || mot.length < 4) continue;
      const re = new RegExp(`['"\`][^'"\`\\n]*\\b${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'u');
      assert.doesNotMatch(SRC, re, `accueil-tiroir.js n'écrit pas « ${mot} »`);
      assert.doesNotMatch(c, re, `le tiroir de fenetre.js n'écrit pas « ${mot} »`);
    }
  }
  // Ce qui reste d'avant : heure et lieu, météo, site surveillé, bouton sur mesure, une partie de la page (⚙).
  // La ligne « Météo » pose désormais « Complète » en 4 × 5 (maquette validée ; test/widgets-meteo.test.ts).
  assert.match(c, /item\(\{ kind: 'heure' \}/); assert.match(c, /item\(\{ kind: 'meteo', style: 'complete', w: 1, c: 4, r: 5 \}/);
  assert.match(c, /onclick: siteSurveille/); assert.match(c, /onclick: ownButton/);
  assert.match(String((O.TEXTES as Record<string, unknown>).aide), /⚙/, 'l\'aide rappelle « une partie de la page d\'une appli » (⚙)');
});

test('fenetre.js : la tuile en fin de grille en mode Modifier, et le widget posé à la fin, l\'écran qui défile jusqu\'à lui', () => {
  const d = fonction('draw');
  assert.match(d, /const tuile = edit \? el\('button', \{ class: 'fe-ajout', type: 'button', 'aria-haspopup': 'dialog', onclick: ouvrirTiroir \}/, 'la tuile, en mode Modifier seulement');
  assert.match(d, /class: 'fe-wrap' \}, grid, tuile, edit \? catalogue\(\) : null/, 'juste après la grille');
  assert.match(d, /'aria-haspopup': 'dialog', onclick: ouvrirTiroir \}, OT\.TEXTES\.bouton\)/, 'et « ＋ Ajouter » dans la barre du mode Modifier');
  const a = fonction('add');
  assert.match(a, /page\(\)\.widgets\.push\(/, 'à la fin de la page');
  assert.match(a, /fermerTiroir\(false\);[\s\S]*fetchViews\(\)\.then\(draw\)\.then\(\(\) => montrerAjout\(n\.id\)\)/, 'le tiroir se ferme, puis on montre le widget');
  const m = fonction('montrerAjout');
  assert.match(m, /scrollIntoView\(\{ behavior: reduit\(\) \? 'auto' : 'smooth', block: 'center' \}\)/, 'l\'écran défile jusqu\'à lui (sans glisser avec « moins d\'animations »)');
  assert.match(m, /\.focus\(\{ preventScroll: true \}\)/, 'le focus va sur lui');
  assert.match(m, /dire\(T\.pose\(/, 'et c\'est dit aux lecteurs d\'écran');
  const o = fonction('ouvrirTiroir');
  assert.match(o, /querySelector\('input\[type=search\]'\)\?\.focus/, 'à l\'ouverture, le focus va dans la recherche');
  assert.match(fonction('catalogue'), /role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feTiroirTitre'/, 'un dialogue nommé pour les lecteurs d\'écran');
});

// ------------------------------------------------------------------ dans un vrai navigateur
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, window: any;
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | (() => R)): Promise<R>;
  keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
  on(e: string, f: (x: Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur, eteinte = '';
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  // Une appli désactivée par le propriétaire (la première qui n'est pas indispensable).
  const cat = (await od.json('/api/valhalla/catalog')).body as { modules: Array<{ id: string; essentielle: boolean }> };
  eteinte = cat.modules.find((m) => !m.essentielle && m.id !== 'vordr')?.id ?? '';
  const r = await od.json('/api/valhalla/activer', { module: eteinte, actif: false });
  assert.equal(r.body.ok, true, `l'appli ${eteinte} est désactivée pour l'essai`);
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

async function ouvrir(largeur: number) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 800 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(od.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('#feGrid', { timeout: 30000 });
  return { ctx, page, erreurs };
}
const modifier = async (p: Page) => { await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-ajout'); };
const ouvert = (p: Page) => p.evaluate(() => Boolean(document.querySelector('#feTiroir.open')) && getComputedStyle(document.querySelector('#feTiroir')).visibility === 'visible');
declare function getComputedStyle(n: unknown): { visibility: string };

test('navigateur, 1280 px : la tuile, le tiroir de 440 px, la recherche, Échap qui rend le focus, Tab qui reste dedans', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    assert.equal(await page.evaluate(() => document.querySelector('#fenetre .fe-ajout')), null, 'hors du mode Modifier : pas de tuile');
    await modifier(page);
    assert.equal(await page.evaluate(() => { const t = document.querySelector('#fenetre .fe-ajout'), g = document.querySelector('#feGrid'); return t.previousElementSibling === g; }), true, 'la tuile suit la grille');
    assert.equal(await ouvert(page), false, 'le tiroir est fermé');
    await page.evaluate(() => document.querySelector('#fenetre .fe-ajout').focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.matches?.('#feTiroir input[type=search]'));
    assert.equal(await ouvert(page), true, 'au clavier, la tuile ouvre le tiroir, focus dans la recherche');
    assert.equal(await page.evaluate(() => document.querySelector('#feTiroir').parentNode === document.body), true, 'posé à la racine : rien ne passe par-dessus');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#feTiroir').length), 1, 'un seul tiroir');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const b = document.querySelector('#feTiroir').getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), vh: window.innerHeight }; });
    assert.equal(r.w, 440, 'il fait 440 px'); assert.equal(r.l, 1280 - 440, 'à droite'); assert.equal(r.h, r.vh, 'de haut en bas');
    // Les puces : « Tout », « Infos », puis les familles du catalogue.
    const cat = (await od.json('/api/valhalla/catalog')).body as { modules: Array<{ id: string; name: string; family: string; active: boolean }> };
    const fams = [...new Set(cat.modules.map((m) => m.family))];
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-chips button')].map((b: any) => b.textContent)), ['Tout', 'Infos', ...fams]);
    // Toutes les applis du catalogue, une ligne chacune, les quatre lignes d'infos d'avant, et les quatre widgets « Infos »
    // de la maquette, déclarés par le fichier de leur famille (l'heure, l'horloge, la météo en petit, les alertes). Les
    // styles de la grande météo n'y ont pas de ligne : ils se choisissent dans « Régler ». Puis les trois widgets de la
    // famille « veille » (les alertes en liste, les sites surveillés, le petit chiffre des sites). Puis les deux widgets
    // de la famille « listes », proposés au propriétaire (l'agenda de Chronos, les recherches de Pythie), et les deux de
    // sa seconde part (les sauvegardes de Phénix, les pubs bloquées par Sphinx). Puis les deux de la famille
    // « automatisations », proposés au propriétaire (ses automatisations de Talos, les tâches planifiées). Puis les
    // raccourcis d'applis (famille « applis » : les applis épinglées de qui regarde).
    assert.equal(await page.evaluate(() => document.querySelectorAll('#feTiroir .fe-it').length), cat.modules.length + 4 + 4 + 3 + 2 + 2 + 2 + 1);
    // L'appli désactivée : grisée, « désactivée », aucun bouton.
    const nomEteinte = cat.modules.find((m) => m.id === eteinte)!.name;
    const off = await page.evaluate(`(() => { const l = [...document.querySelectorAll('#feTiroir .fe-it')].find((x) => x.querySelector('b')?.textContent === ${JSON.stringify(nomEteinte)}); return l ? { off: l.classList.contains('off'), bouton: Boolean(l.querySelector('button')), texte: l.textContent } : null; })()`) as { off: boolean; bouton: boolean; texte: string } | null;
    assert.ok(off, 'l\'appli désactivée est dans le tiroir'); assert.equal(off.off, true, 'grisée'); assert.equal(off.bouton, false, 'sans bouton'); assert.match(off.texte, /désactivée/);
    // Les contrôles font au moins 44 px.
    const petits = await page.evaluate(() => [...document.querySelectorAll('#feTiroir button, #feTiroir input')].filter((n: any) => { const b = n.getBoundingClientRect(); return b.width && (b.height < 44 || b.width < 44); }).map((n: any) => n.textContent || n.placeholder));
    assert.deepEqual(petits, [], 'aucun contrôle de moins de 44 px');
    // Recherche sans résultat.
    await page.keyboard.type('zzzz rien de rien');
    assert.equal(await page.evaluate(() => document.querySelector('#feTiroir .fe-tiroir-rien')?.textContent), 'Rien trouvé.');
    assert.equal(await page.evaluate(() => document.querySelector('#feTiroir [role=status]')?.textContent), 'Rien trouvé.', 'dit aux lecteurs d\'écran');
    // Tab reste dans le tiroir : sur le dernier contrôle, il revient au premier ; Maj + Tab sur le premier, au dernier.
    await page.evaluate(() => { const l = [...document.querySelectorAll('#feTiroir button, #feTiroir input')].filter((n: any) => n.getClientRects().length); l[l.length - 1].focus(); });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('#feTiroir') !== null && document.activeElement === [...document.querySelectorAll('#feTiroir button, #feTiroir input')][0]), true, 'Tab sur le dernier : le premier');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#feTiroir'))), true, 'Maj + Tab : toujours dedans');
    // Échap ferme et rend le focus à la tuile.
    await page.keyboard.press('Escape');
    assert.equal(await ouvert(page), false, 'Échap ferme');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('fe-ajout')), true, 'le focus revient à la tuile');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#fenetre.fe-edit'))), true, 'le mode Modifier reste ouvert');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px : le tiroir prend tout l\'écran ; « Ajouter » pose le widget à la fin, l\'écran va jusqu\'à lui', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await modifier(page);
    const avant = await page.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((n: any) => n.dataset.id));
    await page.click('#fenetre .fe-ajout');
    await page.waitForFunction(() => document.querySelector('#feTiroir.open'));
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const b = document.querySelector('#feTiroir').getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), vw: window.innerWidth }; });
    assert.equal(r.l, 0); assert.equal(r.w, r.vw, 'tout l\'écran');
    // La puce « Infos », puis « Ajouter » sur « Heure et lieu ».
    await page.click('#feTiroir .fe-chips button[data-f="infos"]');
    // Les quatre infos d'avant, et entre elles les quatre widgets « Infos » de la maquette (déclarés par leur famille) ;
    // les styles de la grande météo n'y ont pas de ligne (ils se choisissent dans « Régler »).
    // Les raccourcis d'applis (famille « applis ») ne lisent aucune appli fixe : le tiroir les range donc ici, avec les
    // lignes sans appli (fenetre.js), déclarés avant les widgets « Infos » (pages/widgets-applis.js est chargé avant).
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent)), ['Heure et lieu', 'Météo', 'Raccourcis d\'applis', 'Heure', 'Horloge', 'Météo (petite)', 'Alertes', 'Site surveillé', 'Bouton sur mesure'], 'les huit infos et les raccourcis');
    await page.click('#feTiroir button[aria-label="Ajouter Heure et lieu"]');
    await page.waitForFunction((n: number) => document.querySelectorAll('#feGrid > .fe-w').length === n + 1, avant.length, { timeout: 15000 });
    await page.waitForFunction(() => document.activeElement?.classList.contains('fe-grip'), undefined, { timeout: 5000 });
    const apres = await page.evaluate(() => { const l = [...document.querySelectorAll('#feGrid > .fe-w')], d = l[l.length - 1] as any, b = d.getBoundingClientRect(); return { ids: l.map((n: any) => n.dataset.id), focus: document.activeElement.closest('.fe-w')?.dataset.id, haut: b.top, bas: b.bottom, vh: window.innerHeight, ouvert: Boolean(document.querySelector('#feTiroir.open')) }; });
    assert.deepEqual(apres.ids.slice(0, -1), avant, 'les autres n\'ont pas bougé');
    assert.equal(apres.focus, apres.ids[apres.ids.length - 1], 'le focus est sur le widget posé, le dernier');
    assert.equal(apres.ouvert, false, 'le tiroir est fermé');
    await page.waitForTimeout(800);
    const vu = await page.evaluate(() => { const l = [...document.querySelectorAll('#feGrid > .fe-w')], b = (l[l.length - 1] as any).getBoundingClientRect(); return b.top < window.innerHeight && b.bottom > 0; });
    assert.equal(vu, true, 'l\'écran a défilé jusqu\'à lui');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, relecture : une autre vue ferme le tiroir ; un glisser étranger ne pose rien ; « Bouton sur mesure » sans l\'appli désactivée', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await modifier(page);
    await page.click('#fenetre .fe-ajout'); await page.waitForFunction(() => document.querySelector('#feTiroir.open'));
    await page.evaluate(() => window.OdinShow('chat')); await page.waitForTimeout(500);
    assert.equal(await ouvert(page), false, 'la discussion ouverte, le tiroir n\'est plus par-dessus');
    await page.evaluate(() => window.OdinShow('home')); await page.waitForTimeout(300);
    const n0 = await page.evaluate(() => document.querySelectorAll('#feGrid > .fe-w').length);
    for (const d of [JSON.stringify({ kind: 'bouton', module: 'gladsheim', action: 'meteo', label: 'Piège' }), '{pas du json']) {
      await page.evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/odin-module', ${JSON.stringify(d)}); document.querySelector('#feGrid').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    }
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#feGrid > .fe-w').length), n0, 'rien n\'est posé');
    await page.click('#fenetre .fe-ajout'); await page.waitForFunction(() => document.querySelector('#feTiroir.open'));
    await page.click('#feTiroir button[aria-label^="Créer"]'); await page.waitForSelector('dialog[open] #feM');
    const opts = await page.evaluate(() => [...document.querySelectorAll('#feM option')].map((o: any) => o.value));
    assert.ok(opts.length > 0, 'des applis sont proposées');
    assert.equal(opts.includes(eteinte), false, 'l\'appli désactivée n\'est pas proposée');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});
