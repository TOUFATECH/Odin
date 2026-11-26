// Le cadre de l'écran de la maison (/maison), troisième part : le téléphone et le plein écran (maquette validée).
// Sa réponse pour la barre du bas du téléphone : « Quatre, Odin au centre » — dont « Plus », qui ouvre le reste, comme la
// barre de l'accueil. La maquette : au téléphone, pas de barre de côté ; une barre flottante en bas, la mascotte au centre ;
// en plein écran, le menu, le bandeau et les onglets disparaissent.
// - Au téléphone (820 px et moins) : Accueil, Mes applis, Odin au centre, Thèmes, Plus. « Plus » ouvre une feuille avec
//   toutes les autres sections permises et le retour vers Odin : rien n'est caché. Une tablette « maison » (trois
//   sections) : ses trois sections autour d'Odin, sans « Plus ».
// - Au centre, le nid d'Odin (sa rune) : un appui ouvre la petite fenêtre pour lui parler ; la mascotte reste en liberté
//   et n'y rentre que quand elle n'a plus de place.
// - La feuille se ferme par Échap, un appui ailleurs et le choix d'une entrée ; le focus revient sur « Plus ».
// - Le plein écran : un bouton du bandeau ; le menu, le bandeau et les onglets disparaissent ; on sort par le même bouton
//   (resté seul, en haut à droite) ou par Échap ; le choix et le focus tiennent au redessin ; un refus du navigateur ne
//   casse rien.
// - Toute cible fait 44 px au moins (lu dans la feuille de style, puis mesuré dans un vrai navigateur).
// Le script de la page (src/web/maison.js) est lu comme du texte ; ses fonctions tournent dans un bac à sable avec un
// faux document (comme test/maison-cadre.test.ts). Les derniers essais ouvrent un vrai Odin d'essai dans un vrai
// navigateur (ignorés, en le disant, sans Playwright sur la machine).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');

function ligne(debut: string): string {
  const l = MAISON.split('\n').find((x) => x.trimStart().startsWith(debut));
  assert.ok(l, `maison.js : « ${debut} » introuvable`);
  return l;
}
function bloc(debut: string): string {
  const i = MAISON.indexOf(`  ${debut}`); assert.ok(i >= 0, `maison.js : « ${debut} » introuvable`);
  const f = MAISON.indexOf('\n  }', i); assert.ok(f > i, `maison.js : fin de « ${debut} » introuvable`);
  const fin = MAISON.indexOf('\n', f + 1);
  return MAISON.slice(i, fin < 0 ? undefined : fin);
}

// ---------- Un faux document : de quoi dessiner, chercher (sélecteurs simples) et suivre le focus ----------
type Texte = { nodeType: 3; text: string };
// Une partie de sélecteur : « balise.classe[attr=valeur][attr] » (chaque morceau facultatif).
function partieOk(n: Noeud, p: string): boolean {
  const m = /^([a-z]+)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:=[^\]]+)?\])*)$/.exec(p); assert.ok(m, `sélecteur « ${p} »`);
  if (m[1] && n.tag !== m[1]) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!classes(n).includes(c)) return false;
  for (const a of m[3].matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)) { if (!(a[1] in n.attrs)) return false; if (a[2] !== undefined && n.attrs[a[1]] !== a[2].replace(/^["']|["']$/g, '')) return false; }
  return true;
}
const correspond = (n: Noeud, sel: string) => sel.split(',').some((s) => {
  const ps = s.trim().split(/\s+/); if (!partieOk(n, ps[ps.length - 1])) return false;
  let i = ps.length - 2, a = n.parent; while (i >= 0 && a) { if (partieOk(a, ps[i])) i--; a = a.parent; }
  return i < 0;
});
class Noeud {
  nodeType = 1; attrs: Record<string, string> = {}; kids: Array<Noeud | Texte> = []; ls: Record<string, Array<(e: unknown) => unknown>> = {}; style: Record<string, string> = {}; value = ''; textContent = '';
  tag: string; parent: Noeud | null = null;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: unknown) => unknown) { (this.ls[t] ??= []).push(f); }
  append(...c: Array<Noeud | Texte>) { for (const k of c) if (estNoeud(k)) k.parent = this; this.kids.push(...c); }
  replaceChildren(...c: Array<Noeud | Texte>) { for (const k of this.kids) if (estNoeud(k)) k.parent = null; this.kids = []; this.append(...c); }
  focus() { actif.n = this; }
  querySelector(sel: string): Noeud | null { return tous(this, (x) => x !== this && correspond(x, sel))[0] ?? null; }
  querySelectorAll(sel: string): Noeud[] { return tous(this, (x) => x !== this && correspond(x, sel)); }
  contains(n: unknown) { return tous(this, (x) => x === n).length > 0; }
  closest(sel: string): Noeud | null { let n: Noeud | null = this; while (n) { if (correspond(n, sel)) return n; n = n.parent; } return null; }
}
const actif: { n: Noeud | null } = { n: null };
const estNoeud = (x: unknown): x is Noeud => x instanceof Noeud;
function tous(n: Noeud | Texte | undefined, ok: (x: Noeud) => boolean): Noeud[] {
  if (!n || !estNoeud(n)) return [];
  return [...(ok(n) ? [n] : []), ...n.kids.flatMap((k) => tous(k, ok))];
}
const texte = (n: Noeud): string => n.kids.map((k) => (estNoeud(k) ? texte(k) : k.text)).join('');
const lancer = (n: Noeud, t: string, e: Record<string, unknown> = {}) => { for (const f of n.ls[t] ?? []) f({ target: n, currentTarget: n, ...e }); };
const icone = (k: string) => { const n = new Noeud('svg'); n.attrs['data-icone'] = k; return n; };
const classes = (n: Noeud) => (n.attrs.class ?? '').split(/\s+/);

// ---------- L'écran (draw, la barre du bas, le plein écran) dans son bac à sable ----------
type Plein = 'accepte' | 'refuse' | 'jette' | 'absent';
function ecran(o: { plein?: Plein } = {}) {
  const marque = (nom: string) => { const n = new Noeud('vue'); n.attrs['data-vue'] = nom; return n; };
  const fenetre: { top: unknown } = { top: undefined }; fenetre.top = fenetre;
  const racine = new Noeud('div'), corps = new Noeud('body'), ecoutes: Record<string, Array<(e: unknown) => unknown>> = {};
  corps.append(racine); actif.n = null;
  // Le vrai plein écran du navigateur : accepté, refusé (promesse rejetée), une erreur jetée, ou absent.
  const fs = { demandes: 0, sorties: 0, element: null as unknown, rejets: [] as Promise<unknown>[] };
  const documentElement = o.plein === 'absent' ? {} : { requestFullscreen: () => {
    fs.demandes++;
    if (o.plein === 'jette') throw new Error('refusé');
    if (o.plein === 'refuse') { const p = Promise.reject(new Error('refusé')); fs.rejets.push(p); return p; }
    fs.element = documentElement; return Promise.resolve();
  } };
  const document = {
    createElement: (t: string) => new Noeud(t), createElementNS: (_: string, t: string) => new Noeud(t), createTextNode: (t: string): Texte => ({ nodeType: 3, text: String(t) }),
    body: corps, documentElement, get activeElement() { return actif.n ?? corps; }, get fullscreenElement() { return fs.element; },
    exitFullscreen: () => { fs.sorties++; fs.element = null; return Promise.resolve(); },
    querySelector: (sel: string) => corps.querySelector(sel), querySelectorAll: (sel: string) => corps.querySelectorAll(sel),
    addEventListener: (t: string, f: (e: unknown) => unknown) => { (ecoutes[t] ??= []).push(f); },
  };
  // La mascotte : ce que la barre lui demande (parler depuis le rond, fermer, est-elle en conversation).
  const pet = { appels: [] as unknown[], parle: false, nid: false, chat(a: unknown) { this.appels.push(['chat', a]); this.parle = true; this.nid = typeof a === 'string'; }, enChat() { return this.parle; }, depuisNid() { return this.parle && this.nid; }, fermer() { this.appels.push(['fermer']); this.parle = false; this.nid = false; }, ranger() { this.appels.push(['ranger']); }, news() {}, say() {} };
  const src = [
    'let D = null, view = \'accueil\', q = \'\', voice = false, key = \'\';',
    ligne('const MOTS = '), bloc('const el = ('), ligne('let barre = '), ligne('let plusOuvert = '), ligne('const retourVisible = '), ligne('function nav('), bloc('function bandeau('),
    bloc('function ouvrirBarre('), bloc('function ecouterBarre('),
    ligne('const BAS = '), bloc('function placesBas('), ligne('function focusPlace('), ligne('const classeRacine = '), bloc('function barreBas('), bloc('function ouvrirPlus('),
    bloc('function boutonPlein('), bloc('function basculerPlein('), bloc('function ecouterTelephone('), bloc('function draw() {'),
    'ecouterBarre(); ecouterTelephone();',
    '({ draw, regler(d, k) { D = d; key = k; }, vue: () => view, plein: () => plein, plus: () => plusOuvert });',
  ].join('\n');
  const e = vm.runInNewContext(src, {
    document, window: fenetre, root: racine, icon: icone, hello: () => '', week: () => 1, drawSoon: () => {}, startCams: () => {},
    dansOdin: false, secs: () => null, toast: () => {}, setTimeout: (f: () => void) => { f(); return 0; }, clearTimeout: () => {},
    pet, localStorage: { getItem: () => null, setItem: () => {} },
    home: () => [marque('accueil')], appsView: () => [marque('applis')], peopleGrid: () => marque('famille'), camGrid: (grand: boolean) => marque(grand ? 'cameras' : 'cameras-accueil'),
    netView: () => [marque('reseau')], tilesView: (grand: boolean) => [marque(grand ? 'boutons' : 'boutons-accueil')], themesView: () => [marque('themes')], autosView: () => [marque('automatisations')],
  }) as { draw: () => void; regler: (d: unknown, k: string) => void; vue: () => string; plein: () => boolean; plus: () => boolean };
  const enfant = (c: string) => racine.kids.find((x): x is Noeud => estNoeud(x) && classes(x).includes(c)) ?? null;
  return {
    dessiner(rights = 'complet', cle = '', cadre = false) { fenetre.top = cadre ? {} : fenetre; e.regler({ rights, notices: [], name: '' }, cle); e.draw(); },
    redessiner: () => e.draw(),
    bas: () => { const n = enfant('bnav'); assert.ok(n, 'la barre du bas'); return n; },
    feuille: () => enfant('feuille'), voile: () => enfant('voile'), racine, pet, fs, e,
    // Les places de la barre du bas, dans l'ordre (data-place).
    places: () => enfant('bnav')!.kids.filter(estNoeud).map((x) => x.attrs['data-place']),
    place: (id: string) => { const n = tous(racine, (x) => x.attrs['data-place'] === id)[0]; assert.ok(n, `la place « ${id} »`); return n; },
    vues: () => tous(racine.kids.find((x): x is Noeud => estNoeud(x) && x.tag === 'main'), (x) => x.tag === 'vue').map((x) => x.attrs['data-vue']),
    plein: () => racine.querySelector('.plein'),
    // Un évènement reçu par toute la page (Échap, le focus qui bouge, la sortie du plein écran du navigateur).
    page: (t: string, ev: Record<string, unknown> = {}) => { for (const f of ecoutes[t] ?? []) f({ defaultPrevented: false, ...ev }); },
  };
}
// (suivi : la page « Automatisations » existe ; son entrée, pour la session seulement, va entre « Réseau » et « Mes applis » — test/maison-automatisations.test.ts)
const SEPT = ['accueil', 'famille', 'cameras', 'reseau', 'automatisations', 'applis', 'boutons', 'themes'];
const CLE = `gk_${'c'.repeat(40)}`;
const ouverteF = (e: ReturnType<typeof ecran>) => e.feuille() !== null && !('hidden' in e.feuille()!.attrs);

test('téléphone : quatre places et Odin au centre (Accueil, Mes applis, Odin, Thèmes, Plus) ; « Plus » liste toutes les autres sections permises et le retour vers Odin', () => {
  const e = ecran(); e.dessiner('complet');
  assert.deepEqual(e.places(), ['accueil', 'applis', 'odin', 'themes', 'plus']);
  assert.deepEqual(['accueil', 'applis', 'themes', 'plus'].map((p) => texte(e.place(p))), ['Accueil', 'Mes applis', 'Thèmes', 'Plus'], 'chaque place a son nom écrit');
  const f = e.feuille(); assert.ok(f, 'la feuille « Plus »');
  assert.equal(f.attrs.id, 'maison-plus'); assert.equal(e.place('plus').attrs['aria-controls'], 'maison-plus');
  assert.equal(f.attrs.role, 'dialog'); assert.equal(f.attrs['aria-label'], 'Plus');
  const dansFeuille = f.kids.filter(estNoeud).map((x) => x.attrs['data-place']);
  assert.deepEqual(dansFeuille, ['famille', 'cameras', 'reseau', 'automatisations', 'boutons', 'retour']);
  // Rien n'est caché : la barre et la feuille ensemble ont les sept sections, chacune une seule fois.
  const toutes = [...e.places(), ...dansFeuille].filter((x) => SEPT.includes(x));
  assert.deepEqual([...toutes].sort(), [...SEPT].sort());
  assert.equal(tous(f, (x) => x.tag === 'a')[0].attrs.href, '/');
  assert.ok(!ouverteF(e) && 'hidden' in e.voile()!.attrs, 'fermée au départ');
  assert.equal(e.place('plus').attrs['aria-expanded'], 'false');
  // Rien d'autre que des éléments posés dans la page (un « null » s'écrirait tel quel à l'écran).
  assert.ok(e.racine.kids.every(estNoeud), 'aucun « null » écrit dans la page');
});

test('téléphone, tablette « maison » (trois sections) et tout compte limité : ses trois sections autour d\'Odin, sans « Plus » ni feuille', () => {
  for (const [droits, cle] of [['maison', CLE], ['membre', '']]) {
    const e = ecran(); e.dessiner(droits, cle);
    assert.deepEqual(e.places(), ['accueil', 'boutons', 'odin', 'themes'], droits);
    assert.equal(e.feuille(), null); assert.equal(e.voile(), null);
  }
});

test('téléphone : le retour vers Odin de la feuille suit la règle du bandeau (absent dans un cadre)', () => {
  const e = ecran(); e.dessiner('complet', '', true);
  assert.deepEqual(e.feuille()!.kids.filter(estNoeud).map((x) => x.attrs['data-place']), ['famille', 'cameras', 'reseau', 'automatisations', 'boutons']);
});

test('téléphone : « Plus » ouvre la feuille (le focus y entre) ; Échap la ferme et le focus revient sur « Plus »', () => {
  const e = ecran(); e.dessiner('complet');
  e.place('plus').focus(); lancer(e.place('plus'), 'click');
  assert.ok(ouverteF(e) && !('hidden' in e.voile()!.attrs));
  assert.equal(e.place('plus').attrs['aria-expanded'], 'true');
  assert.deepEqual(e.pet.appels, [['ranger']], 'la mascotte posée sous la feuille rentre dans son nid');
  assert.ok(classes(e.racine).includes('plus-ouvert'), 'le retour du bandeau se cache pendant ce temps');
  assert.equal(actif.n, e.place('famille'), 'le focus va sur la première entrée');
  e.page('keydown', { key: 'Escape' });
  assert.ok(!ouverteF(e)); assert.equal(e.place('plus').attrs['aria-expanded'], 'false');
  assert.ok(!classes(e.racine).includes('plus-ouvert'));
  assert.equal(actif.n, e.place('plus'));
});

test('téléphone : un appui ailleurs (le voile) ferme la feuille, le focus revient sur « Plus » ; « Plus » une seconde fois aussi', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.place('plus'), 'click'); lancer(e.voile()!, 'click');
  assert.ok(!ouverteF(e)); assert.equal(actif.n, e.place('plus'));
  lancer(e.place('plus'), 'click'); lancer(e.place('plus'), 'click');
  assert.ok(!ouverteF(e)); assert.equal(actif.n, e.place('plus'));
  // Le focus qui sort de la feuille (Tab) la ferme aussi, sans le déplacer.
  lancer(e.place('plus'), 'click'); const ailleurs = new Noeud('button'); e.page('focusin', { target: ailleurs });
  assert.ok(!ouverteF(e));
});

test('téléphone : choisir une entrée de la feuille ouvre sa section, ferme la feuille, le focus revient sur « Plus » ; « Plus » dit la section ouverte', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.place('plus'), 'click'); lancer(e.place('cameras'), 'click');
  assert.deepEqual(e.vues(), ['cameras']); assert.ok(!ouverteF(e));
  assert.equal(actif.n, e.place('plus'));
  assert.equal(e.place('cameras').attrs['aria-current'], 'page', 'dit aux lecteurs d\'écran');
  assert.equal(e.place('plus').attrs['aria-label'], 'Plus · Caméras'); assert.ok(classes(e.place('plus')).includes('cur'));
  // Rouverte, le focus va sur la section ouverte.
  lancer(e.place('plus'), 'click'); assert.equal(actif.n, e.place('cameras'));
  // Le redessin automatique (toutes les 15 s) : la feuille reste ouverte et le focus reste sur la même entrée.
  e.redessiner(); assert.ok(ouverteF(e)); assert.equal(actif.n, e.place('cameras'));
});

test('téléphone : choisir une place de la barre ouvre sa section, le focus reste sur elle, même après le redessin ; la section ouverte est dite', () => {
  const e = ecran(); e.dessiner('complet');
  assert.equal(e.place('accueil').attrs['aria-current'], 'page');
  lancer(e.place('themes'), 'click');
  assert.deepEqual(e.vues(), ['themes']); assert.equal(e.place('themes').attrs['aria-current'], 'page'); assert.equal(e.place('accueil').attrs['aria-current'], undefined);
  assert.equal(actif.n, e.place('themes'));
  e.redessiner(); assert.equal(actif.n, e.place('themes'));
  assert.equal(e.place('plus').attrs['aria-label'], 'Plus'); assert.ok(!classes(e.place('plus')).includes('cur'));
});

test('téléphone : au centre, le nid d\'Odin (sa rune, aucun dessin) ; un appui ouvre la petite fenêtre pour lui parler, un second la ferme', () => {
  const e = ecran(); e.dessiner('complet');
  const n = e.place('odin');
  assert.equal(n.tag, 'button'); assert.equal(n.attrs['aria-label'], 'Parler à Odin'); assert.equal(n.attrs['aria-expanded'], 'false');
  assert.equal(texte(n), 'ᛟ'); assert.equal(tous(n, (x) => x.tag === 'svg').length, 0, 'aucune mascotte dessinée ici : elle reste en liberté');
  lancer(n, 'click'); assert.deepEqual(e.pet.appels, [['chat', '.bnav .nid']]);
  e.redessiner(); assert.equal(e.place('odin').attrs['aria-expanded'], 'true');
  lancer(e.place('odin'), 'click'); assert.deepEqual(e.pet.appels[1], ['fermer']);
  // Échap ferme la petite fenêtre ouverte par le rond (la mascotte rend le focus au rond).
  lancer(e.place('odin'), 'click'); e.page('keydown', { key: 'Escape' }); assert.deepEqual(e.pet.appels[3], ['fermer']);
});

test('plein écran : le bouton du bandeau l\'ouvre ; le menu, le bandeau et les onglets disparaissent ; le même bouton, resté seul, le ferme ; le focus le suit', () => {
  const e = ecran({ plein: 'accepte' }); e.dessiner('complet');
  const b = e.plein()!; assert.ok(b, 'le bouton');
  assert.ok(b.parent && classes(b.parent).includes('tools'), 'dans le bandeau');
  assert.equal(b.attrs['aria-label'], 'Plein écran'); assert.equal(b.attrs['aria-pressed'], 'false');
  lancer(b, 'click');
  assert.ok(e.e.plein() && classes(e.racine).includes('plein-ecran')); assert.equal(e.fs.demandes, 1);
  const s = e.plein()!; assert.equal(s.parent, e.racine, 'resté seul, hors du bandeau');
  assert.equal(s.attrs['aria-pressed'], 'true'); assert.equal(s.attrs['aria-label'], 'Plein écran'); assert.equal(s.attrs.title, 'Quitter le plein écran (Échap)');
  assert.equal(actif.n, s);
  // Le redessin automatique : le choix et le focus tiennent.
  e.redessiner(); assert.ok(classes(e.racine).includes('plein-ecran')); assert.equal(actif.n, e.plein()); assert.equal(e.plein()!.parent, e.racine);
  lancer(e.plein()!, 'click');
  assert.ok(!e.e.plein() && !classes(e.racine).includes('plein-ecran')); assert.equal(e.fs.sorties, 1);
  assert.equal(actif.n, e.plein()); assert.ok(classes(e.plein()!.parent!).includes('tools'));
});

test('plein écran : le nid flottant d\'Odin (la maquette), en bas à droite, seulement en plein écran ; un simple rond, sans dessin, que ni le doigt ni les lecteurs d\'écran ne prennent', () => {
  const e = ecran({ plein: 'accepte' }); e.dessiner('complet');
  const nidF = () => e.racine.querySelector('.nid-flottant');
  assert.equal(nidF(), null, 'hors du plein écran : pas de nid flottant (la barre du bas a le sien)');
  lancer(e.plein()!, 'click');
  const n = nidF(); assert.ok(n, 'en plein écran : le nid flottant');
  assert.equal(n.parent, e.racine); assert.equal(n.attrs['aria-hidden'], 'true'); assert.equal(n.tag, 'span');
  assert.equal(tous(n, (x) => x.tag === 'svg').length, 0, 'aucune mascotte dessinée ici : elle reste en liberté');
  e.redessiner(); assert.ok(nidF(), 'il tient au redessin');
  lancer(e.plein()!, 'click'); assert.equal(nidF(), null);
});

test('plein écran : on en sort au clavier (Échap), le focus revient au bouton ; la sortie par le navigateur fait sortir la page', () => {
  const e = ecran({ plein: 'accepte' }); e.dessiner('complet');
  lancer(e.plein()!, 'click'); e.page('keydown', { key: 'Escape' });
  assert.ok(!e.e.plein()); assert.equal(actif.n, e.plein()); assert.equal(e.fs.sorties, 1);
  lancer(e.plein()!, 'click'); e.fs.element = null; e.page('fullscreenchange');
  assert.ok(!e.e.plein()); assert.equal(actif.n, e.plein());
  // Échap déjà pris (une fenêtre qui le garde), ou une boîte de dialogue ouverte : le plein écran reste.
  lancer(e.plein()!, 'click'); e.page('keydown', { key: 'Escape', defaultPrevented: true }); assert.ok(e.e.plein());
  const d = new Noeud('dialog'); d.attrs.open = ''; e.racine.append(d); e.page('keydown', { key: 'Escape' }); assert.ok(e.e.plein());
});

test('plein écran : Échap ferme d\'abord la feuille « Plus », puis la fenêtre du rond, puis le plein écran', () => {
  const e = ecran({ plein: 'accepte' }); e.dessiner('complet');
  // La fenêtre du rond et la feuille ouvertes : Échap ferme la feuille seule, puis la fenêtre du rond.
  lancer(e.place('odin'), 'click'); lancer(e.place('plus'), 'click');
  e.page('keydown', { key: 'Escape' }); assert.ok(!e.e.plus() && e.pet.parle, 'la feuille d\'abord');
  e.page('keydown', { key: 'Escape' }); assert.ok(!e.pet.parle, 'puis la fenêtre du rond');
  // Entrer en plein écran ferme la feuille ; la fenêtre du rond ouverte prend le premier Échap, le plein écran le second.
  lancer(e.place('plus'), 'click'); lancer(e.plein()!, 'click');
  assert.ok(!e.e.plus() && e.e.plein(), 'entrer en plein écran ferme la feuille');
  e.pet.chat('.bnav .nid');
  e.page('keydown', { key: 'Escape' }); assert.ok(e.e.plein() && !e.pet.parle, 'la fenêtre du rond d\'abord');
  e.page('keydown', { key: 'Escape' }); assert.ok(!e.e.plein());
  // La fenêtre ouverte en touchant la mascotte elle-même (pas le rond) : Échap la ferme aussi d'abord, comme sur l'accueil.
  lancer(e.plein()!, 'click'); e.pet.chat(undefined);
  e.page('keydown', { key: 'Escape' }); assert.ok(e.e.plein() && !e.pet.parle, 'la fenêtre de la mascotte d\'abord');
  e.page('keydown', { key: 'Escape' }); assert.ok(!e.e.plein());
});

test('plein écran : si le navigateur refuse (promesse rejetée, erreur, ou rien), la page fait de son mieux, sans erreur', async () => {
  for (const p of ['refuse', 'jette', 'absent'] as const) {
    const e = ecran({ plein: p }); e.dessiner('complet');
    lancer(e.plein()!, 'click');
    assert.ok(e.e.plein() && classes(e.racine).includes('plein-ecran'), p);
    for (const r of e.fs.rejets) await r.catch(() => {}); // le rejet est déjà pris par la page (sinon : rejet non traité)
    e.page('fullscreenchange'); assert.ok(e.e.plein(), `${p} : aucun vrai plein écran, rien ne fait sortir la page tout seul`);
    e.page('keydown', { key: 'Escape' }); assert.ok(!e.e.plein()); assert.equal(e.fs.sorties, 0, 'rien à quitter');
  }
});

// ---------- La feuille de style ----------
const BASE = (() => { const b = MAISON.indexOf('const BASE = `'); const f = MAISON.indexOf('`;\n', b + 14); assert.ok(b > 0 && f > b, 'le style commun'); return MAISON.slice(b, f); })();
const regle = (sel: string, ou = BASE) => { const i = ou.indexOf(`${sel}{`); assert.ok(i >= 0, `règle « ${sel} » introuvable`); return ou.slice(i, ou.indexOf('}', i) + 1); };
const px = (r: string, k: string) => Number(new RegExp(`(?:^|[;{])${k}:(\\d+)px`).exec(r)?.[1] ?? NaN);

test('feuille de style : cibles de 44 px au moins (places, rond d\'Odin, entrées de la feuille, bouton du plein écran) ; la barre ne garde plus de place vide', () => {
  const nav = regle('.bnav .nav');
  assert.ok(px(nav, 'min-width') >= 44 && px(nav, 'min-height') >= 44, nav);
  const nid = regle('.bnav .nid'); assert.ok(px(nid, 'width') >= 44 && px(nid, 'height') >= 44, nid);
  assert.ok(px(regle('.feuille .nav'), 'min-height') >= 44);
  const b = regle('.round.plein'); assert.ok(px(b, 'width') >= 44 && px(b, 'height') >= 44, b);
  assert.doesNotMatch(regle('.bnav'), /padding-right:84px/, 'plus de place réservée à droite : la mascotte a son nid');
});

test('feuille de style : les mots de la barre du bas sont dans la couleur du texte du thème (lisibles dans tous les thèmes) ; la place choisie et « Plus » ouvert se voient par le fond, le gras et un trait', () => {
  assert.match(regle('.bnav .nav'), /color:var\(--text\)/);
  const c = regle('.bnav .nav[aria-current=page],.bnav .plus.cur,.bnav .plus[aria-expanded=true]');
  for (const r of [/color:var\(--text\)/, /font-weight:700/, /background:var\(--card\)/, /inset 0 -3px 0 var\(--text\)/]) assert.match(c, r);
  assert.doesNotMatch(c, /var\(--accent\)/, 'pas de mot en couleur d\'accent (trop pâle sur un thème clair)');
  // À 320 px, un nom sur deux lignes : toutes les places gardent la même hauteur et leurs icônes restent alignées.
  assert.match(regle('.bnav'), /align-items:stretch/);
  assert.match(regle('.bnav .nav'), /justify-content:flex-start/);
  // Le message en bas (« Thème … ») passe au-dessus de la barre du bas au téléphone ; dans Odin et en plein écran, il reste en bas.
  assert.match(BASE, /\.toast\{bottom:calc\(86px \+ env\(safe-area-inset-bottom\)\)\}html\.dans-odin \.toast,\.app\.plein-ecran~\.toast\{bottom:24px\}/);
});

test('feuille de style : la barre ne recouvre pas le bas du contenu ; feuille et voile seulement au téléphone, jamais dans Odin ; fermés, ils ne se voient pas', () => {
  assert.match(BASE, /main\{padding:16px 14px calc\(110px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.match(regle('.bnav'), /bottom:calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(BASE, /\.bnav,\.feuille,\.voile\{display:none\}/);
  assert.match(BASE, /\.feuille\[hidden\],\.voile\[hidden\]\{display:none\}/);
  assert.match(BASE, /html\.dans-odin \.feuille,html\.dans-odin \.voile\{display:none\}/);
  assert.match(BASE, /\.app\.plus-ouvert \.top \.retour\{visibility:hidden\}/, 'un seul retour vers Odin visible à la fois');
  // Le voile passe sous la barre (elle reste utilisable), la feuille au-dessus.
  assert.ok(Number(/z-index:(\d+)/.exec(regle('\n.voile'))?.[1]) < Number(/z-index:(\d+)/.exec(regle('.bnav'))?.[1]));
  assert.ok(Number(/z-index:(\d+)/.exec(regle('.feuille'))?.[1]) > Number(/z-index:(\d+)/.exec(regle('.bnav'))?.[1]));
  // La feuille passe aussi devant la mascotte et sa bulle (une bulle ne couvre jamais une entrée).
  for (const d of ['.pet', '.bubble']) assert.ok(Number(/z-index:(\d+)/.exec(regle('.feuille'))?.[1]) > Number(/z-index:(\d+)/.exec(regle(d))?.[1]), d);
});

test('feuille de style, plein écran : le menu, le bandeau et les onglets disparaissent ; le bouton reste, en haut à droite', () => {
  const cache = /\.app\.plein-ecran \.side,\.app\.plein-ecran \.poignee,\.app\.plein-ecran \.bord,\.app\.plein-ecran \.bnav,\.app\.plein-ecran \.feuille,\.app\.plein-ecran \.voile,\.app\.plein-ecran \.secs,\.app\.plein-ecran \.top,\.app\.plein-ecran \.tabs\{display:none!important\}/;
  assert.match(BASE, cache);
  // Le contenu commence sous le bouton (10 px + 44 px) : il ne couvre aucune carte ; il garde 90 px en bas (la maquette :
  // « padding:14px 14px 90px »), la place du nid flottant, pour que la dernière carte puisse passer au-dessus de lui.
  const m = /padding:(\d+)px \d+px (\d+)px\}/.exec(regle('.app.plein-ecran main')); assert.ok(m, regle('.app.plein-ecran main'));
  assert.ok(Number(m[1]) >= 54 && Number(m[2]) >= 90, regle('.app.plein-ecran main'));
  // Le nid flottant : 54 px en bas à droite (la maquette, .nfloat), sous la mascotte, et ni le doigt ni la souris ne le prennent.
  const nf = regle('.nid-flottant');
  for (const r of [/position:fixed/, /right:18px/, /bottom:calc\(18px \+ env\(safe-area-inset-bottom\)\)/, /width:54px/, /height:54px/, /pointer-events:none/]) assert.match(nf, r);
  assert.ok(Number(/z-index:(\d+)/.exec(nf)?.[1]) < Number(/z-index:(\d+)/.exec(regle('.pet'))?.[1]), 'sous la mascotte');
  const s = regle('.app.plein-ecran>.plein'); for (const r of [/position:fixed/, /right:10px/, /top:calc\(10px \+ env\(safe-area-inset-top\)\)/]) assert.match(s, r);
  assert.match(BASE, /@media \(prefers-reduced-motion:reduce\)\{\.app\.plein-ecran>\.plein\{transition:none\}\}/);
});

test('la mascotte reste en liberté ; son nid s\'ajoute : elle n\'y rentre que sans place libre, et la barre n\'est pas une place libre', () => {
  // Feuille « Plus » ouverte, son voile non plus : elle rentre dans son nid au lieu de passer devant la feuille.
  // Les onglets de pièces et le menu des sections ne sont pas des places libres non plus (un appui sur un onglet ne tombe
  // jamais sur elle) ; ni le nid flottant du plein écran.
  assert.match(MAISON, /const WIDGET = '[^']*,\.bnav,\.feuille,\.voile,\.tabs,\.secs,\.nid-flottant';/);
  assert.match(MAISON, /const spots = freeSpots\(\), n = spots\.length \? null : nid\(\);/);
  // Son nid : le rond de la barre du bas s'il se voit, sinon (plein écran) le nid flottant.
  assert.match(MAISON, /const nid = \(\) => \{ const n = document\.querySelector\('\.bnav \.nid'\), f = document\.querySelector\('\.nid-flottant'\); return vu\(n\) \? n : vu\(f\) \? f : null; \};/);
  // Dans le rond de la barre, elle se cache derrière lui (comme sur l'accueil) : c'est le rond qui prend l'appui ; sur le nid
  // flottant (un simple rond), elle reste visible et prend l'appui elle-même.
  assert.match(BASE, /\.pet\.au-nid\{visibility:hidden;pointer-events:none\}/);
  // Toujours un seul dessin d'Odin : la rune dans le rond, la mascotte d'aujourd'hui (son modèle #mascotte) en liberté.
  assert.equal((MAISON.match(/getElementById\('mascotte'\)/g) ?? []).length, 1);
  assert.match(MAISON, /return \{ say, news, chat, visit, enChat: /);
});

test('les textes du téléphone et du plein écran sont à un seul endroit du fichier', () => {
  const mots = ligne('const MOTS = ');
  for (const m of ["plus: 'Plus'", "odin: 'Parler à Odin'", "plein: 'Plein écran'", "pleinSortir: 'Quitter le plein écran (Échap)'"]) assert.ok(mots.includes(m), m);
  for (const b of ['function barreBas(', 'function boutonPlein(']) for (const m of ["'Plus'", "'Parler à Odin'", "'Plein écran'"]) assert.ok(!bloc(b).includes(m), `${b} : ${m} écrit en dur`);
});

// ---------- Dans un vrai navigateur, avec un vrai Odin d'essai ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any, getComputedStyle: any, innerWidth: number, innerHeight: number;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | ((a: any) => R), a?: unknown): Promise<R>;
  focus(s: string): Promise<void>; tap(s: string): Promise<void>; click(s: string): Promise<void>; keyboard: { press(k: string): Promise<void> }; mouse: { click(x: number, y: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>; route(u: string, f: (r: any) => Promise<void>): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/${nom}.png` }); };

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur;
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

// « pieces » : la réponse d'Odin reçoit cinq pièces inventées (l'Odin d'essai n'en a pas), pour avoir des onglets.
const PIECES = ['Pièce A', 'Pièce B', 'Pièce C', 'Pièce D', 'Pièce E'];
async function ouvrir(largeur: number, o: { cle?: string; hauteur?: number; pieces?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: o.hauteur ?? (doigt ? 760 : 860) }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  if (!o.cle) { const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]); }
  const page = await ctx.newPage(), erreurs: string[] = [];
  if (o.pieces) await page.route('**/api/maison/etat', async (r: any) => { const rep = await r.fetch(); const j = await rep.json(); j.rooms = PIECES.map((nom, i) => ({ name: nom, devices: [{ id: `e${i}`, name: `Appareil ${i + 1}`, kind: 'prise', state: 'off' }] })); await r.fulfill({ response: rep, json: j }); });
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${od.url}/maison${o.cle ? `#cle=${o.cle}` : ''}`);
  await page.waitForSelector('.app main .top', { timeout: 20000 });
  return { ctx, page, erreurs };
}
// Les places visibles de la barre du bas : leur nom, leur taille ; la barre dans l'écran ; la page déborde-t-elle.
const barreVue = (p: Page) => p.evaluate(() => {
  const b = document.querySelector('.bnav'), r = b.getBoundingClientRect();
  return {
    affichee: getComputedStyle(b).display, places: [...b.children].map((x: any) => x.getAttribute('data-place')),
    tailles: [...b.children].map((x: any) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }),
    dedans: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, deborde: document.documentElement.scrollWidth > innerWidth,
    cote: getComputedStyle(document.querySelector('.side')).display, focus: document.activeElement?.getAttribute?.('data-place') ?? null,
  };
});
const feuilleVue = (p: Page) => p.evaluate(() => { const f = document.querySelector('.feuille'); return f && getComputedStyle(f).display !== 'none' ? [...f.children].map((x: any) => [x.getAttribute('data-place'), Math.round(x.getBoundingClientRect().height)]) : null; });
const visible = (p: Page, s: string) => p.evaluate((x: string) => { const n = document.querySelector(x); return Boolean(n) && getComputedStyle(n).display !== 'none' && n.getClientRects().length > 0; }, s);
// Le redessin automatique (toutes les 15 s) sans attendre : la page relit son état quand elle redevient visible.
const redessin = async (p: Page) => { await p.evaluate(() => { window.__avant = document.querySelector('main'); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForFunction(() => document.querySelector('main') !== window.__avant, undefined, { timeout: 10000 }); };

test('navigateur, 390 px, avec sa session : la barre du bas à quatre places et Odin au centre, 44 px chacune ; « Plus » au doigt et au clavier', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    let b = await barreVue(page);
    assert.equal(b.affichee, 'flex'); assert.equal(b.cote, 'none');
    assert.deepEqual(b.places, ['accueil', 'applis', 'odin', 'themes', 'plus']);
    for (const [l, h] of b.tailles) assert.ok(l >= 44 && h >= 44, JSON.stringify(b.tailles));
    assert.ok(b.dedans && !b.deborde, JSON.stringify(b));
    await capture(page, 'telephone-390');
    await page.tap('.bnav .plus');
    const f = await feuilleVue(page);
    // La mascotte ne couvre pas la feuille (elle rentre dans son nid, sous le voile la barre reste à elle).
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => { const p = document.querySelector('.pet').getBoundingClientRect(), q = document.querySelector('.feuille').getBoundingClientRect(); return p.right <= q.left || p.left >= q.right || p.bottom <= q.top || p.top >= q.bottom; }), true, 'la mascotte ne couvre pas la feuille');
    assert.deepEqual(f?.map((x) => x[0]), ['famille', 'cameras', 'reseau', 'automatisations', 'boutons', 'retour']);
    for (const [, h] of f!) assert.ok(h >= 44, JSON.stringify(f));
    assert.equal(await visible(page, '.top .retour'), true, 'le retour du bandeau garde sa place…');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top .retour')).visibility), 'hidden', '…mais ne se voit pas : un seul retour vers Odin');
    await capture(page, 'telephone-390-plus');
    // Un appui ailleurs (en haut de l'écran, sur le voile) : fermée, le focus sur « Plus ».
    await page.mouse.click(200, 120);
    assert.equal(await feuilleVue(page), null); b = await barreVue(page); assert.equal(b.focus, 'plus');
    // Au clavier : Entrée ouvre (le focus entre), Échap ferme (le focus revient).
    await page.focus('.bnav .plus'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-place')), 'famille');
    await page.keyboard.press('Escape');
    assert.equal(await feuilleVue(page), null); assert.equal((await barreVue(page)).focus, 'plus');
    // Choisir une entrée : sa section, la feuille fermée, le focus sur « Plus », qui dit la section.
    await page.tap('.bnav .plus'); await page.tap('.feuille [data-place=cameras]');
    assert.equal(await feuilleVue(page), null);
    assert.equal(await page.evaluate(() => document.querySelector('main h2')?.textContent), 'Caméras');
    assert.deepEqual(await page.evaluate(() => [document.activeElement?.getAttribute('data-place'), document.querySelector('.bnav .plus').getAttribute('aria-label')]), ['plus', 'Plus · Caméras']);
    // Le redessin automatique ne perd pas le focus.
    await redessin(page); assert.equal((await barreVue(page)).focus, 'plus');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 320 px : rien ne déborde, chaque place garde 44 px ; la barre ne recouvre pas le bas du contenu', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(320, { hauteur: 640 });
  try {
    const b = await barreVue(page);
    assert.ok(!b.deborde && b.dedans, JSON.stringify(b));
    for (const [l, h] of b.tailles) assert.ok(l >= 44 && h >= 44, JSON.stringify(b.tailles));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const bas = await page.evaluate(() => { const m = document.querySelector('main'), d = [...m.children].pop().getBoundingClientRect(); return { fin: Math.round(d.bottom), barre: Math.round(document.querySelector('.bnav').getBoundingClientRect().top) }; });
    assert.ok(bas.fin <= bas.barre, `le dernier bloc finit au-dessus de la barre : ${JSON.stringify(bas)}`);
    await page.tap('.bnav .plus');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'feuille ouverte, rien ne déborde');
    await capture(page, 'telephone-320-plus');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 390 px : le rond d\'Odin ouvre la petite fenêtre juste au-dessus de lui ; Échap la ferme et le focus revient au rond', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    assert.equal(await page.evaluate(() => document.querySelector('.bnav .nid').textContent), 'ᛟ');
    await page.focus('.bnav .nid'); await page.keyboard.press('Enter');
    await page.waitForSelector('.bubble input', { timeout: 5000 });
    const o = await page.evaluate(() => { const b = document.querySelector('.bubble').getBoundingClientRect(), n = document.querySelector('.bnav .nid').getBoundingClientRect(); return { dessus: b.bottom <= n.top, ouvert: document.querySelector('.bnav .nid').getAttribute('aria-expanded') }; });
    assert.deepEqual(o, { dessus: true, ouvert: 'true' });
    await page.waitForTimeout(120); // la saisie prend le focus
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [Boolean(document.querySelector('.bubble')), document.activeElement?.getAttribute('data-place'), document.querySelector('.bnav .nid').getAttribute('aria-expanded')]), [false, 'odin', 'false']);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 390 px : sans place libre, la mascotte rentre dans son nid ; elle en ressort quand une place se libère', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  // Le centre de la mascotte est-il sur celui du rond (3 px près) ?
  const ecart = () => page.evaluate(() => { const p = document.querySelector('.pet').getBoundingClientRect(), n = document.querySelector('.bnav .nid').getBoundingClientRect(); return Math.max(Math.abs(p.left + p.width / 2 - (n.left + n.width / 2)), Math.abs(p.top + p.height / 2 - (n.top + n.height / 2))); });
  const attendre = async (dedans: boolean) => { const fin = Date.now() + 25000; while (Date.now() < fin) { const d = await ecart(); if (dedans ? d < 3 : d > 20) return true; await page.waitForTimeout(250); } return false; };
  try {
    // Des places libres (le contenu caché, sa place gardée) : elle est hors du nid.
    await page.evaluate(() => { document.querySelector('main').style.visibility = 'hidden'; });
    assert.equal(await attendre(false), true, 'des places libres : hors du nid');
    // Une carte qui couvre tout l'écran au-dessus de la barre : plus aucune place libre, elle rentre dans son nid.
    await page.evaluate(() => { const c = document.createElement('div'); c.className = 'card'; c.id = 'couvre'; c.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:84px;z-index:1;border-radius:0'; document.body.append(c); });
    assert.equal(await attendre(true), true, 'aucune place libre : dans le nid');
    // Dans le rond, elle se cache derrière lui (comme sur l'accueil) : c'est le rond qui prend l'appui, et non elle.
    assert.deepEqual(await page.evaluate(() => { const n = document.querySelector('.bnav .nid').getBoundingClientRect(), h = document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2); return [getComputedStyle(document.querySelector('.pet')).visibility, Boolean(h?.closest('.bnav .nid'))]; }), ['hidden', true]);
    // La place se libère : elle en ressort.
    await page.evaluate(() => document.getElementById('couvre').remove());
    assert.equal(await attendre(false), true, 'une place libre : elle ressort');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pet')).visibility), 'visible', 'sortie du nid, elle se voit');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pet').length), 1, 'jamais deux mascottes');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, tablette « maison » à 390 px : ses trois sections autour d\'Odin, sans « Plus »', { skip: sans }, async () => {
  const k = await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${Date.now()}`, droits: 'maison' });
  const cle = (k.data as { key?: string } | undefined)?.key ?? '';
  assert.match(cle, /^gk_/);
  const { ctx, page, erreurs } = await ouvrir(390, { cle });
  try {
    const b = await barreVue(page);
    assert.deepEqual(b.places, ['accueil', 'boutons', 'odin', 'themes']);
    for (const [l, h] of b.tailles) assert.ok(l >= 44 && h >= 44);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.feuille').length), 0);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// Les rectangles se croisent-ils (4 px de marge, comme ses places libres) ?
const croise = '(a, b) => !(a.right - 4 <= b.left || a.left + 4 >= b.right || a.bottom - 4 <= b.top || a.top + 4 >= b.bottom)';

test('navigateur, 390 px : la mascotte ne se pose ni sur les onglets de pièces ni sur le bandeau ; un appui sur un onglet tombe sur l\'onglet', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390, { pieces: true });
  try {
    assert.ok(await page.evaluate(() => document.querySelectorAll('.tabs button').length > 1), 'des onglets de pièces');
    // Elle part vers sa place de repos 0,6 s après le chargement ; sa marche dure au plus 1,1 s.
    await page.waitForTimeout(2500);
    const r = await page.evaluate(`(() => { const x = ${croise}, p = document.querySelector('.pet').getBoundingClientRect();
      return { onglets: x(p, document.querySelector('.tabs').getBoundingClientRect()), bandeau: x(p, document.querySelector('.top').getBoundingClientRect()),
        // Chaque onglet dont le milieu se voit dans la rangée (les autres sont hors de la rangée, à faire défiler) : ce qui
        // est sous ce milieu est l'onglet lui-même ; sinon, son nom et ce qui le couvre.
        appuis: (() => { const t = document.querySelector('.tabs').getBoundingClientRect(); return [...document.querySelectorAll('.tabs button')].map((b) => { const q = b.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2; if (cx <= t.left || cx >= t.right) return null; const h = document.elementFromPoint(cx, cy); return h === b || b.contains(h) ? null : b.textContent + ' : ' + (h ? h.tagName + '.' + h.className : 'rien'); }).filter(Boolean); })() }; })()`);
    await capture(page, 'telephone-390-onglets');
    assert.deepEqual(r, { onglets: false, bandeau: false, appuis: [] });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, plein écran : la mascotte ne reste sur aucune carte : sans place libre, dans le nid flottant en bas à droite ; au bout de la page, la dernière carte passe au-dessus du nid, et elle n\'est sur aucune carte', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  const etat = () => page.evaluate(`(() => { const x = ${croise}, p = document.querySelector('.pet').getBoundingClientRect(), n = document.querySelector('.nid-flottant')?.getBoundingClientRect();
    return { carte: [...document.querySelectorAll('main .card')].some((c) => x(p, c.getBoundingClientRect())), nid: Boolean(n) && Math.max(Math.abs(p.left + p.width / 2 - (n.left + n.width / 2)), Math.abs(p.top + p.height / 2 - (n.top + n.height / 2))) < 3 }; })()`) as Promise<{ carte: boolean; nid: boolean }>;
  const attendre = async (ok: (e: { carte: boolean; nid: boolean }) => boolean) => { const fin = Date.now() + 20000; let e = await etat(); while (Date.now() < fin && !ok(e)) { await page.waitForTimeout(250); e = await etat(); } return e; };
  try {
    await page.click('.top .plein');
    await page.waitForSelector('.nid-flottant', { timeout: 5000 });
    // En haut de la page : soit une place libre (sur aucune carte), soit son nid flottant.
    const haut = await attendre((e) => !e.carte || e.nid);
    assert.ok(!haut.carte || haut.nid, JSON.stringify(haut));
    await capture(page, 'plein-390-mascotte');
    // Au bout de la page : la dernière carte finit au-dessus du nid ; elle sort du nid vers la place libre, sur aucune carte.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const fin = await page.evaluate(() => { const c = [...document.querySelectorAll('main .card')].pop().getBoundingClientRect(), n = document.querySelector('.nid-flottant').getBoundingClientRect(); return [Math.round(c.bottom), Math.round(n.top)]; });
    assert.ok(fin[0] <= fin[1], `la dernière carte finit au-dessus du nid : ${JSON.stringify(fin)}`);
    const bas = await attendre((e) => !e.carte);
    assert.equal(bas.carte, false, JSON.stringify(bas));
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, tous les thèmes : les mots de la barre du bas se lisent (4,5 pour 1 au moins), choisis ou non ; le message en bas passe au-dessus de la barre', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.tap('.bnav [data-place=themes]');
    const n = await page.evaluate(() => document.querySelectorAll('.th').length);
    assert.ok(n > 1, 'des thèmes');
    const faibles: string[] = [];
    for (let i = 0; i < n; i++) {
      await page.evaluate((k: number) => document.querySelectorAll('.th')[k].click(), i);
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        // Une couleur lue (rgb, rgba ou color(srgb …)) en [r, g, b, a] de 0 à 1.
        const lire = (c: string): any => { let m = /^rgba?\(([^)]+)\)$/.exec(c); if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0] / 255, v[1] / 255, v[2] / 255, v[3] ?? 1]; } m = /^color\(srgb ([^)]+)\)$/.exec(c); if (m) { const v = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; } return null; };
        const sur = (h: number[], b: number[]) => [0, 1, 2].map((k) => h[k] * h[3] + b[k] * (1 - h[3])).concat(1);
        const lum = (c: number[]) => { const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        // Le fond derrière la barre : la couleur de la page si elle est pleine, sinon la couleur --bg du thème.
        const base = lire(getComputedStyle(document.body).backgroundColor), tmp = document.createElement('i');
        tmp.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); document.body.append(tmp); const bg = lire(getComputedStyle(tmp).color); tmp.remove();
        const fond0 = base && base[3] === 1 ? base : bg;
        return [...document.querySelectorAll('.bnav .nav span')].map((s: any) => {
          const chaine: any[] = []; for (let e = s; e && e !== document.body; e = e.parentElement) chaine.unshift(e);
          let f = fond0; for (const e of chaine) { const c = lire(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) f = sur(c, f); }
          const t = sur(lire(getComputedStyle(s).color), f), a = lum(t), b = lum(f);
          return [s.textContent, Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100];
        });
      });
      const nom = await page.evaluate((k: number) => document.querySelectorAll('.th')[k].textContent, i);
      for (const [mot, ratio] of r as [string, number][]) if (ratio < 4.5) faibles.push(`${nom} · ${mot} : ${ratio}`);
      if (i === 0) {
        // Le message (« Thème … ») : au-dessus de la barre du bas, il ne la couvre pas.
        await page.waitForSelector('.toast', { timeout: 5000 });
        const t = await page.evaluate(() => [Math.round(document.querySelector('.toast').getBoundingClientRect().bottom), Math.round(document.querySelector('.bnav').getBoundingClientRect().top)]);
        assert.ok(t[0] <= t[1], `le message au-dessus de la barre : ${JSON.stringify(t)}`);
      }
    }
    assert.deepEqual(faibles, []);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

for (const largeur of [1280, 390]) {
  test(`navigateur, ${largeur} px : le plein écran cache le menu, le bandeau et les onglets ; le même bouton (44 px) et Échap en font sortir ; il tient au redessin`, { skip: sans }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      await page.click('.top .plein');
      const vu = async () => ({ cote: await visible(page, '.side'), poignee: await visible(page, '.poignee'), bas: await visible(page, '.bnav'), bandeau: await visible(page, '.top'), onglets: await visible(page, '.tabs'), bouton: await visible(page, '.plein') });
      assert.deepEqual(await vu(), { cote: false, poignee: false, bas: false, bandeau: false, onglets: false, bouton: true });
      const b = await page.evaluate(() => { const n = document.querySelector('.plein'), r = n.getBoundingClientRect(); return { l: Math.round(r.width), h: Math.round(r.height), droite: Math.round(innerWidth - r.right), focus: document.activeElement === n, presse: n.getAttribute('aria-pressed') }; });
      assert.ok(b.l >= 44 && b.h >= 44 && b.droite <= 12 && b.focus && b.presse === 'true', JSON.stringify(b));
      // Le bouton ne couvre aucune carte : le contenu commence sous lui.
      assert.equal(await page.evaluate(() => { const r = document.querySelector('.app > .plein').getBoundingClientRect(); return [...document.querySelectorAll('main .card')].every((c: any) => { const q = c.getBoundingClientRect(); return q.top >= r.bottom || q.right <= r.left || q.left >= r.right; }); }), true, 'le bouton ne couvre aucune carte');
      await capture(page, `plein-${largeur}`);
      await redessin(page);
      assert.equal((await vu()).bandeau, false, 'le choix tient au redessin');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.app > .plein')), true, 'le focus aussi');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.app').classList.contains('plein-ecran'), undefined, { timeout: 5000 });
      assert.equal((await vu()).bandeau, true);
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.top .plein')), true, 'le focus revient au bouton du bandeau');
      // Le même bouton fait sortir.
      await page.click('.top .plein'); await page.click('.app > .plein');
      await page.waitForFunction(() => !document.querySelector('.app').classList.contains('plein-ecran'), undefined, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}
