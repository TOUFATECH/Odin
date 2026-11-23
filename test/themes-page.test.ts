// Réglages → Apparence, la page des thèmes de la maquette validée : une carte par thème (aperçu de 120 px, puis une
// bande avec le petit Odin à la couleur du thème, le nom, « clair » ou « sombre »), rangées par familles avec leur
// nombre ; un seul thème marqué choisi ; « Automatique » et sa raison (celle que calcule Odin) ; la place, vide, du
// choix de l'animation de déplacement ; au clavier, Tab puis Entrée choisit un thème ; à l'écran étroit, deux colonnes
// et des familles qui se replient.
// face.js, le catalogue de la maquette et themes.js sont chargés tels quels, dans l'ordre de la page, sur une page
// factice (quelques éléments, juste ce que themes.js utilise) : aucun paquet, aucun navigateur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const THEMES_JS = lire('src/web/themes.js');

// ------------------------------------------------------------------ une page factice
type Noeud = El | Texte;
class Texte { parent: El | null = null; textContent: string; constructor(t: string) { this.textContent = t; } }
class El {
  parent: El | null = null; enfants: Noeud[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  ecoutes: Record<string, Array<(e: unknown) => void>> = {};
  dataset: Record<string, string>;
  tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
    const soi = this;
    this.dataset = new Proxy({}, {
      get: (_c, k) => soi.attrs[`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`],
      set: (_c, k, v) => { soi.attrs[`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] = String(v); return true; },
    });
  }
  get id() { return this.attrs.id ?? ''; } set id(v: string) { this.attrs.id = v; }
  get className() { return this.attrs.class ?? ''; } set className(v: string) { this.attrs.class = v; }
  get type() { return this.attrs.type ?? ''; } set type(v: string) { this.attrs.type = v; }
  get title() { return this.attrs.title ?? ''; } set title(v: string) { this.attrs.title = v; }
  get hidden() { return 'hidden' in this.attrs; } set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get classList() {
    const lst = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => lst().includes(c),
      add: (...cs: string[]) => { this.className = [...new Set([...lst(), ...cs])].join(' '); },
      remove: (...cs: string[]) => { this.className = lst().filter((x) => !cs.includes(x)).join(' '); },
      toggle: (c: string, force?: boolean) => { const oui = force ?? !lst().includes(c); if (oui) this.classList.add(c); else this.classList.remove(c); return oui; },
    };
  }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  get textContent(): string { return this.enfants.map((e) => e.textContent).join(''); }
  set textContent(v: string) { this.enfants = []; if (v !== '') this.append(String(v)); }
  set innerHTML(html: string) { this.enfants = []; analyser(html, this); }
  get innerHTML() { return ''; }
  append(...xs: Array<Noeud | string>) { for (const x of xs) { const n = typeof x === 'string' ? new Texte(x) : x; n.parent = this; this.enfants.push(n); } }
  after(x: El) { const p = this.parent!; x.parent = p; p.enfants.splice(p.enfants.indexOf(this) + 1, 0, x); }
  addEventListener(t: string, f: (e: unknown) => void) { (this.ecoutes[t] ||= []).push(f); }
  click() { for (const f of this.ecoutes.click ?? []) f({ type: 'click', target: this }); }
  /** Les éléments descendants, dans l'ordre du document. */
  *tous(): Generator<El> { for (const e of this.enfants) if (e instanceof El) { yield e; yield* e.tous(); } }
  querySelectorAll(sel: string) { const ms = sel.split(',').map((s) => s.trim()); return [...this.tous()].filter((e) => ms.some((m) => correspond(e, m))); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
}
/** Un sélecteur simple : balise, #id, .classe, [attribut] ou [attribut="valeur"] (sans espace). */
function correspond(e: El, sel: string): boolean {
  const m = /^([a-z0-9]*)((?:[#.][\w-]+|\[[^\]]+\])*)$/i.exec(sel); if (!m) throw new Error(`sélecteur non pris : ${sel}`);
  if (m[1] && e.tagName !== m[1].toLowerCase()) return false;
  for (const p of m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (p[0] === '#' && e.id !== p.slice(1)) return false;
    if (p[0] === '.' && !e.classList.contains(p.slice(1))) return false;
    if (p[0] === '[') { const a = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]$/.exec(p)!; const v = e.getAttribute(a[1]); if (v === null) return false; const voulu = a[2] ?? a[3]; if (voulu !== undefined && v !== voulu) return false; }
  }
  return true;
}
/** Un petit lecteur de HTML (balises simples, attributs entre guillemets doubles ou sans valeur). */
function analyser(html: string, dans: El) {
  let ici = dans;
  for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    if (m[1]) { ici = ici.parent ?? dans; continue; }
    if (m[5] !== undefined) { ici.append(m[5]); continue; }
    const e = new El(m[2]);
    for (const a of (m[3] ?? '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) e.attrs[a[1]] = a[2] ?? '';
    ici.append(e);
    if (!m[4] && !/^(br|img|input|meta|link)$/i.test(m[2])) ici = e;
  }
}

interface Serveur { mode: string; theme: string; why?: string; odin?: { why: string }; appels: Array<{ action: string; input: Record<string, unknown> }>; panne?: boolean; retard?: (action: string, input: Record<string, unknown>) => number }
/** La page de Réglages, avec la carte Apparence telle que ui.html la sert ; `garde` : l'apparence gardée dans le navigateur. */
function page(garde: { mode: string; theme: string; why?: string; odin?: { why: string } }) {
  const corps = new El('body');
  corps.innerHTML = '<article class="card" data-sec="apparence"><h2>Apparence</h2><p class="sub">-</p><div class="skins"></div><div class="seg" id="modeSeg"></div></article>';
  const styles: El[] = [];
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {}, style: { setProperty() {} } },
    head: { append: (s: El) => styles.push(s) }, hidden: false,
    createElement: (t: string) => new El(t),
    querySelector: (s: string) => corps.querySelector(s), querySelectorAll: (s: string) => corps.querySelectorAll(s),
    getElementById: (id: string) => corps.querySelector(`#${id}`), addEventListener() {},
  };
  const serveur: Serveur = { ...garde, appels: [] };
  const fetch = async (_url: string, o: { body: string }) => {
    const { action, input } = JSON.parse(o.body) as { action: string; input: Record<string, unknown> };
    // Odin injoignable : la requête échoue, comme un fetch hors ligne. Un retard : la requête arrive plus tard.
    if (serveur.panne) throw new TypeError('Failed to fetch');
    const ms = serveur.retard?.(action, input) ?? 0; if (ms) await new Promise((r) => setTimeout(r, ms));
    serveur.appels.push({ action, input });
    if (action === 'theme') { const t = String(input.theme); if (t === 'automatique') serveur.mode = 'auto'; else { serveur.mode = 'fixe'; serveur.theme = t === 'au hasard' ? 'desert' : t; } }
    return { ok: true, json: async () => ({ data: { mode: serveur.mode, theme: serveur.theme, why: serveur.mode === 'auto' ? serveur.why : undefined, odin: serveur.mode === 'auto' ? serveur.odin : undefined } }) };
  };
  const window: Record<string, unknown> = { addEventListener() {} };
  window.window = window;
  // face.js d'abord, sans page (il ne fait que se publier : window.OdinFace), puis le catalogue et themes.js.
  vm.runInContext(lire('src/web/face.js'), vm.createContext({ window, setTimeout, clearTimeout }));
  const ctx = vm.createContext({
    window, document, fetch, localStorage: { getItem: () => JSON.stringify(garde), setItem() {} },
    CustomEvent: class { type: string; constructor(type: string) { this.type = type; } }, setTimeout, clearTimeout, setInterval: () => 0,
  });
  vm.runInContext(lire('src/web/pages/themes-catalogue.js'), ctx);
  vm.runInContext(THEMES_JS, ctx);
  const carte = corps.querySelector('article.card')!;
  const O = window.OdinThemes as { choose(id: string): Promise<void>; THEMES: Record<string, { name: string; dark: boolean; sky: string[] | null; mascot: string | null }>; familles(): Array<{ id: string; titre: string; ids: string[] }> };
  return { corps, carte, styles, serveur, O, racine: document.documentElement, cartes: () => carte.querySelectorAll('button.thc'), marques: () => carte.querySelectorAll('button.thc').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.theme) };
}
const attendre = () => new Promise((r) => setTimeout(r, 20));

/** L'ordre de Tab : les boutons (et ce qui a tabindex ≥ 0) visibles, dans l'ordre du document. */
function ordreTab(racine: El, etroit: boolean): El[] {
  const cache = (e: El) => {
    for (let x: El | null = e; x; x = x.parent) {
      if (x.hidden) return true;
      // (la règle de la page : à l'écran large, le bouton qui replie est caché ; à l'écran étroit, la grille d'une famille repliée)
      if (!etroit && x.classList.contains('tfold')) return true;
      if (etroit && x.classList.contains('tgrid') && x.parent?.classList.contains('ferme')) return true;
    }
    return false;
  };
  return [...racine.tous()].filter((e) => (e.tagName === 'button' && !e.hasAttribute('disabled') && e.getAttribute('tabindex') !== '-1') || (e.hasAttribute('tabindex') && Number(e.getAttribute('tabindex')) >= 0)).filter((e) => !cache(e));
}

// ------------------------------------------------------------------ les essais

test('page des thèmes : les familles, dans l\'ordre, avec leur titre et leur nombre ; une carte par thème', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  const secs = p.carte.querySelectorAll('section.tfam');
  const attendu = [['Mis en avant', 6], ['Les thèmes d\'Odin', 32], ['Thèmes de Hestia', 31], ['Événements de l\'année', 16]] as const;
  assert.deepEqual(secs.map((s) => { const h = s.querySelector('h3')!; return [h.textContent.replace(/\s*\d+$/, ''), Number(h.querySelector('small')!.textContent)]; }), attendu.map((x) => [...x]));
  assert.equal(p.cartes().length, 85, 'les 85 thèmes, chacun sa carte');
  for (const s of secs) {
    const h = s.querySelector('h3')!, g = s.querySelector('.tgrid')!;
    assert.equal(g.getAttribute('role'), 'group'); assert.equal(g.getAttribute('aria-labelledby'), h.id, 'chaque groupe est nommé par le titre de sa famille');
    assert.equal(g.querySelectorAll('button.thc').length, Number(h.querySelector('small')!.textContent), `${h.textContent} : autant de cartes que son nombre`);
  }
  // Chaque carte : l'aperçu (fond du thème, barre de côté, trois cartes, un bloc allumé), puis la bande.
  for (const b of p.cartes()) {
    const id = b.dataset.theme, t = p.O.THEMES[id];
    assert.equal(b.type, 'button');
    const pv = b.querySelector('.pv')!;
    assert.equal(pv.getAttribute('aria-hidden'), 'true');
    assert.equal(pv.querySelectorAll('i').length, 5, `${id} : côté, trois cartes, un bloc allumé`);
    assert.ok(pv.style.background, `${id} : le fond du thème`);
    const nm = b.querySelector('.nm')!;
    assert.equal(nm.querySelector('.tnom')!.textContent, t.name);
    assert.equal(nm.querySelector('small')!.textContent, !t.sky ? 'clair ou sombre' : t.dark ? 'sombre' : 'clair', `${id} : clair ou sombre`);
  }
  // L'aperçu fait 120 px de haut, la bande 44 px au moins ; colonnes de 210 px au moins à l'écran large.
  const css = p.styles.map((s) => s.textContent).join('');
  assert.match(css, /\.thc \.pv\{height:120px;/); assert.match(css, /\.thc \.nm\{[^}]*min-height:44px/);
  assert.match(css, /\.tgrid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(210px,1fr\)\)/);
});

test('page des thèmes : le petit Odin de chaque carte est celui de face.js (deux pastilles blanches, sans bouche), à la couleur du thème', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  const window: { OdinFace?: { dessin(id: string, o: Record<string, unknown>): { yeux: string[] } } } = {};
  vm.runInNewContext(lire('src/web/face.js'), { window, setTimeout, clearTimeout });
  const yeuxFace = window.OdinFace!.dessin('neutre', { taille: 'mini', fige: true }).yeux.join('');
  const ids = new Set<string>();
  assert.equal(p.carte.querySelectorAll('.tmasc').length, 85, 'un petit Odin par carte');
  for (const b of p.cartes()) {
    const id = b.dataset.theme, t = p.O.THEMES[id];
    const m = b.querySelector('.tmasc')!;
    assert.equal(m.getAttribute('aria-hidden'), 'true');
    assert.ok(!m.classList.contains('odin'), 'pas la classe « odin » : face.js ne le repeint pas avec le thème affiché');
    const yeux = m.querySelectorAll('.eye');
    assert.equal(yeux.length, 2, `${id} : deux yeux`);
    for (const y of yeux) { assert.equal(y.getAttribute('fill'), '#fff', `${id} : yeux blancs`); assert.equal(y.getAttribute('rx'), '4.5', `${id} : en pastille`); }
    assert.equal(m.querySelectorAll('.mouth, .brows, .cheeks').length, 0, `${id} : ni bouche, ni sourcils, ni joues`);
    // Les mêmes yeux que face.js (taille « mini », au repos).
    const g = m.querySelector('g')!;
    assert.equal(g.querySelectorAll('rect').map((r) => `x=${r.getAttribute('x')} y=${r.getAttribute('y')} w=${r.getAttribute('width')} h=${r.getAttribute('height')}`).join('|'),
      [...yeuxFace.matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((x) => `x=${x[1]} y=${x[2]} w=${x[3]} h=${x[4]}`).join('|'));
    // Le corps prend la couleur du thème au repos (Valhalla : la couleur d'origine d'Odin).
    const stops = m.querySelectorAll('stop').map((s) => s.getAttribute('stop-color'));
    assert.equal(stops[1], t.mascot ?? '#3F82F0', `${id} : couleur du thème`);
    // Des dégradés à lui, jamais partagés avec une autre carte.
    for (const d of m.querySelectorAll('radialGradient')) { assert.ok(!ids.has(d.id), `identifiant en double : ${d.id}`); ids.add(d.id); }
  }
  // Rien de la maquette : ni son dessin d'Odin, ni sa couleur selon la météo, ni sa phrase qui nomme une ville.
  for (const interdit of ['odinSVG', 'odinColor', 'ce serait maintenant', 'class="brow', 'data-tint']) assert.ok(!THEMES_JS.includes(interdit), `themes.js : « ${interdit} »`);
});

test('page des thèmes : un seul thème marqué choisi ; en automatique, c\'est « Automatique » qui l\'est, avec la raison d\'Odin', async () => {
  for (const theme of ['glace', 'h-desert', 'desert', 'ev-noel', 'valhalla']) {
    const p = page({ mode: 'fixe', theme });
    await attendre();
    const choisis = p.cartes().filter((b) => b.getAttribute('aria-pressed') === 'true');
    assert.deepEqual(choisis.map((b) => b.dataset.theme), [theme], `un seul choisi (${theme})`);
    assert.ok(p.cartes().every((b) => ['true', 'false'].includes(b.getAttribute('aria-pressed')!)), 'chaque carte dit si elle est choisie');
    const auto = p.carte.querySelector('#themeAuto')!;
    assert.equal(auto.tagName, 'button'); assert.equal(auto.textContent, 'Automatique'); assert.equal(auto.getAttribute('aria-pressed'), 'false');
  }
  const p = page({ mode: 'auto', theme: 'coucher', why: 'soir' });
  await attendre();
  assert.equal(p.cartes().filter((b) => b.getAttribute('aria-pressed') === 'true').length, 0, 'en automatique, aucune carte choisie');
  const auto = p.carte.querySelector('#themeAuto')!;
  assert.equal(auto.getAttribute('aria-pressed'), 'true'); assert.ok(auto.classList.contains('primary'));
  // La raison : celle que calcule Odin (rendue par l'appli Apparence), jamais une phrase écrite d'avance.
  assert.equal(p.carte.querySelector('#themeWhy')!.textContent, `Automatique : ${p.O.THEMES.coucher.name} (soir).`);
});

test('page des thèmes : la place du choix de l\'animation existe, nommée, et reste vide', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  const place = p.carte.querySelector('#themeAnims')!;
  assert.ok(place, 'la place existe');
  assert.equal(place.tagName, 'section');
  assert.equal(place.getAttribute('aria-label'), 'Animations quand je déplace ou agrandis un widget', 'elle est nommée');
  assert.equal(place.dataset.place, 'animations');
  assert.equal(place.enfants.length, 0, 'elle reste vide'); assert.equal(place.textContent, '');
  assert.ok(place.hidden, 'vide, elle ne se voit pas');
  // En tête, avant « Automatique » et les familles (comme dans la maquette).
  const ordre = [...p.carte.tous()].map((e) => e.id).filter((id) => ['themeAnims', 'themeAuto', 'themeGrid'].includes(id));
  assert.deepEqual(ordre, ['themeAnims', 'themeAuto', 'themeGrid']);
});

test('page des thèmes : au clavier, Tab mène aux cartes et Entrée choisit un thème', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  const tab = ordreTab(p.carte, false);
  assert.equal(tab[0].id, 'themeAuto', 'Tab : d\'abord « Automatique »');
  assert.deepEqual(tab.slice(1).map((b) => b.dataset.theme), [...p.carte.querySelectorAll('button.thc')].map((b) => b.dataset.theme), 'puis chaque carte, dans l\'ordre');
  assert.ok(tab.slice(1).every((b) => b.type === 'button' && b.classList.contains('thc')), 'des boutons : Entrée et Espace les choisissent');
  // Tab jusqu'à « Néon » (dans « Mis en avant »), puis Entrée (un bouton reçoit alors un clic).
  let focus = 0; while (tab[focus].dataset.theme !== 'neon') focus++;
  tab[focus].click();
  assert.deepEqual(p.cartes().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.theme), ['neon'], 'choisi tout de suite');
  await attendre();
  assert.deepEqual(p.serveur.appels.filter((a) => a.action === 'theme').map((a) => a.input.theme), ['neon'], 'Odin le garde');
  assert.equal(p.carte.querySelector('#themeWhy')!.textContent, 'Choisi : Néon.');
  // Entrée sur « Automatique » : retour à la règle d'Odin ; aucune carte choisie.
  tab[0].click(); await attendre();
  assert.deepEqual(p.serveur.appels.filter((a) => a.action === 'theme').map((a) => a.input.theme), ['neon', 'automatique']);
  assert.equal(p.cartes().filter((b) => b.getAttribute('aria-pressed') === 'true').length, 0);
});

test('page des thèmes : à l\'écran étroit, deux colonnes et des familles qui se replient (au doigt et au clavier)', async () => {
  const p = page({ mode: 'fixe', theme: 'h-desert' });
  await attendre();
  const css = p.styles.map((s) => s.textContent).join('');
  const etroit = /@media \(max-width:600px\)\{(.*?\})\}/.exec(css)?.[1] ?? '';
  assert.match(etroit, /\.tgrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'deux colonnes');
  assert.match(etroit, /\.tfold\{display:inline-flex\}/, 'le bouton qui replie ne se montre qu\'à l\'écran étroit');
  assert.match(etroit, /\.tfam\.ferme \.tgrid\{display:none\}/);
  assert.match(css, /\.tfold\{display:none;[^}]*width:44px;height:44px/, 'une cible de 44 px');
  // Au départ, seule la famille du thème choisi est ouverte.
  const secs = p.carte.querySelectorAll('section.tfam');
  assert.deepEqual(secs.map((s) => !s.classList.contains('ferme')), [false, false, true, false]);
  for (const s of secs) {
    const b = s.querySelector('button.tfold')!, g = s.querySelector('.tgrid')!, h = s.querySelector('h3')!;
    assert.equal(b.getAttribute('aria-controls'), g.id); assert.equal(b.getAttribute('aria-labelledby'), h.id);
    assert.equal(b.getAttribute('aria-expanded'), String(!s.classList.contains('ferme')));
  }
  // Tab ne passe que par les cartes des familles ouvertes ; Entrée sur le bouton d'une famille l'ouvre.
  let tab = ordreTab(p.carte, true);
  assert.equal(tab.filter((b) => b.classList.contains('thc')).length, 31, 'les 31 thèmes de Hestia');
  const evenements = secs[3].querySelector('button.tfold')!;
  evenements.click();
  assert.equal(evenements.getAttribute('aria-expanded'), 'true'); assert.ok(!secs[3].classList.contains('ferme'));
  tab = ordreTab(p.carte, true);
  assert.equal(tab.filter((b) => b.classList.contains('thc')).length, 31 + 16);
  evenements.click(); assert.equal(evenements.getAttribute('aria-expanded'), 'false');
  // Mouvement réduit : rien ne glisse.
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*button\.thc[^}]*transition:none/);
});

// ------------------------------------------------------------------ relecture : quand Odin ne suit pas

test('page des thèmes : Odin injoignable, le choix marqué tout de suite est retiré (cartes, ligne d\'état et thème affiché)', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  p.serveur.panne = true;
  p.cartes().find((b) => b.dataset.theme === 'foret')!.click();
  assert.deepEqual(p.marques(), ['foret'], 'marqué tout de suite');
  await attendre();
  assert.equal(p.serveur.theme, 'glace', 'Odin n\'a rien reçu');
  assert.deepEqual(p.marques(), ['glace'], 'la carte d\'Odin est de nouveau marquée');
  assert.equal(p.carte.querySelector('#themeWhy')!.textContent, 'Choisi : Glace.');
  assert.equal(p.racine.dataset.odinTheme, 'glace', 'le thème affiché redevient celui d\'Odin');
  // « Automatique » aussi : rien ne reste pressé à tort.
  p.carte.querySelector('#themeAuto')!.click(); await attendre();
  assert.equal(p.carte.querySelector('#themeAuto')!.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(p.marques(), ['glace']);
  // Odin revient : le choix suivant passe.
  p.serveur.panne = false;
  p.cartes().find((b) => b.dataset.theme === 'foret')!.click(); await attendre();
  assert.equal(p.serveur.theme, 'foret'); assert.deepEqual(p.marques(), ['foret']);
});

test('page des thèmes : deux clics rapides, c\'est le dernier qui reste (chez Odin et sur la page)', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  // Le premier choix met du temps à arriver chez Odin.
  let premier = true;
  p.serveur.retard = (action) => { if (action === 'theme' && premier) { premier = false; return 60; } return 0; };
  p.cartes().find((b) => b.dataset.theme === 'desert')!.click();
  p.cartes().find((b) => b.dataset.theme === 'neige')!.click();
  assert.deepEqual(p.marques(), ['neige']);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(p.serveur.appels.filter((a) => a.action === 'theme').map((a) => a.input.theme), ['desert', 'neige'], 'les choix arrivent dans l\'ordre des clics');
  assert.equal(p.serveur.theme, 'neige');
  assert.deepEqual(p.marques(), ['neige']);
  assert.equal(p.carte.querySelector('#themeWhy')!.textContent, 'Choisi : Neige.');
});

test('page des thèmes : « au hasard » (clics sur Odin) ne fait pas passer la page par Valhalla avant la réponse', async () => {
  const p = page({ mode: 'fixe', theme: 'glace' });
  await attendre();
  const fini = p.O.choose('au hasard');
  assert.equal(p.racine.dataset.odinTheme, 'glace', 'rien ne change avant la réponse d\'Odin');
  assert.deepEqual(p.marques(), ['glace']);
  await fini;
  assert.equal(p.racine.dataset.odinTheme, 'desert'); assert.deepEqual(p.marques(), ['desert']);
});

test('page des thèmes : la raison d\'Odin passe par le dictionnaire, et l\'aperçu n\'écrit que des couleurs « #rrggbb »', async () => {
  const p = page({ mode: 'auto', theme: 'coucher', why: 'soir', odin: { why: 'a chaud' } });
  p.serveur.odin = { why: 'a chaud' };
  await attendre();
  assert.equal(p.carte.querySelector('#themeWhy')!.textContent, `Automatique : ${p.O.THEMES.coucher.name} (soir) · Odin a chaud.`);
  assert.ok(!/` · Odin \$\{/.test(THEMES_JS) && !/` \(\$\{state\.why\}\)`/.test(THEMES_JS), 'pas de phrase écrite hors de TEXTES');
  for (const b of p.cartes()) for (const i of b.querySelector('.pv')!.querySelectorAll('i')) {
    const st = i.getAttribute('style') ?? '';
    for (const c of st.matchAll(/(?:background:|solid )([^;]*)/g)) assert.match(c[1], /^#[0-9a-f]{6}$/i, `${b.dataset.theme} : ${st}`);
  }
});
