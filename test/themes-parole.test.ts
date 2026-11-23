// Les thèmes en parlant (lot 11 de la maquette validée) : un nom porté par deux thèmes (« Neige » d'Odin et de
// Hestia) ne choisit rien au hasard — Odin cite chaque thème avec sa famille et demande lequel ; un identifiant exact
// (ce qu'envoient les cartes et les listes) ne pose pas de question. Et l'interrupteur « Odin change de thème selon
// son humeur » (Réglages → Apparence), branché sur la règle d'aujourd'hui : mis, l'humeur joue sur le thème
// automatique comme avant (au plus une fois par heure) ; coupé, elle ne joue plus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as A from '../src/valhalla/modules/apparence.ts';
const { THEME_NAMES, autoTheme, apparence } = A;
// (lu ainsi pour que chaque essai échoue seul sur un Odin d'avant ce lot, au lieu d'empêcher tout le fichier de charger)
const TEXTES = (A as { TEXTES?: typeof A.TEXTES }).TEXTES ?? { familles: { odin: '?odin', hestia: '?hestia' }, court: { odin: '?', hestia: '?' }, humeurCoupee: '?', humeurMise: '?' } as unknown as typeof A.TEXTES;
import { Valhalla } from '../src/valhalla/service.ts';
import { setCurrentMood } from '../src/mood/mood.ts';

function odinDEssai() {
  const home = mkdtempSync(join(tmpdir(), 'odin-themes-parole-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  return { v, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
interface Question { question?: boolean; nom?: string; choix?: Array<{ id: string; famille: string; titreFamille: string }>; theme?: string; mode?: string }
const dire = async (v: Valhalla, t: string) => { const r = await v.act('apparence', 'theme', { theme: t }); return { text: r.text, data: r.data as Question }; };
const etat = async (v: Valhalla) => (await v.act('apparence', 'etat', {})).data as { mode: string; theme: string };
const regler = (v: Valhalla, j: Record<string, unknown>) => v.act('apparence', 'regler_mascotte', { reglages: JSON.stringify(j) });

// ------------------------------------------------------------------ un nom en double : Odin demande

test('nom en double : « Neige » ne choisit rien, Odin cite les deux thèmes avec leur famille et demande lequel', async () => {
  const { v, fin } = odinDEssai();
  try {
    await dire(v, 'glace');
    for (const nom of ['Neige', 'NEIGE', 'NeIGe']) {
      const r = await dire(v, nom);
      assert.equal(r.data.question, true, `${nom} : une question`);
      assert.deepEqual(r.data.choix?.map((c) => c.id), ['neige', 'h-neige']);
      assert.deepEqual(r.data.choix?.map((c) => c.titreFamille), [TEXTES.familles.odin, TEXTES.familles.hestia]);
      assert.ok(r.text.includes(TEXTES.familles.odin) && r.text.includes(TEXTES.familles.hestia), `la question cite les deux familles : ${r.text}`);
      assert.equal(r.data.theme, undefined, 'aucun thème choisi');
      assert.equal((await etat(v)).theme, 'glace', 'le thème n\'a pas bougé');
    }
    // Les autres noms en double, sans accents ni casse : jamais un choix au hasard.
    for (const [nom, ids] of [['Désert', ['desert', 'h-desert']], ['DESERT', ['desert', 'h-desert']], ['néon', ['neon', 'h-neon']], ['Coucher de soleil', ['coucher', 'h-coucher']], ['aurore boreale', ['aurore', 'h-boreale']], ['Espace', ['espace', 'h-espace']]] as const) {
      assert.deepEqual((await dire(v, nom)).data.choix?.map((c) => c.id), ids, nom);
    }
    assert.equal((await etat(v)).theme, 'glace');
    // Le début d'un nom porté par plusieurs thèmes : la même question, pas le premier venu.
    assert.deepEqual((await dire(v, 'Bleu')).data.choix?.map((c) => c.id), ['h-nuit', 'h-ocean']);
  } finally { fin(); }
});

test('nom en double, en le disant : « mets le thème neige » → la question ; « … neige hestia » (l\'exemple donné) → le thème de Hestia', async () => {
  const { v, fin } = odinDEssai();
  try {
    await dire(v, 'glace');
    const q = await v.order('mets le thème neige');
    assert.equal((q.data as Question)?.question, true, q.text);
    assert.match(q.text, new RegExp(`Neige \\(${TEXTES.familles.odin}\\).*Neige \\(${TEXTES.familles.hestia}\\)`));
    assert.equal((await etat(v)).theme, 'glace');
    // L'exemple de la question se dit tel quel et ne laisse pas de doute.
    const exemple = /« mets le thème ([^»]+) »/.exec(q.text)?.[1]?.trim();
    assert.equal(exemple, `Neige ${TEXTES.court.hestia}`);
    await v.order(`mets le thème ${exemple}`);
    assert.equal((await etat(v)).theme, 'h-neige');
    await v.order(`mets le thème neige ${TEXTES.court.odin}`);
    assert.equal((await etat(v)).theme, 'neige');
    // Le nom avec un mot de sa famille, écrit librement.
    assert.equal((await dire(v, 'Neige de la maison')).data.theme, 'h-neige');
    assert.equal((await dire(v, 'Néon mis en avant')).data.theme, 'neon');
  } finally { fin(); }
});

test('chaque nom de thème, dit dans une phrase (« mets le thème … »), donne ce thème — ou la question s\'il est porté par deux', async () => {
  const { v, fin } = odinDEssai();
  const plat = (x: string) => x.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const compte = new Map<string, number>(); for (const n of Object.values(THEME_NAMES)) compte.set(plat(n), (compte.get(plat(n)) ?? 0) + 1);
  try {
    const faux: string[] = [];
    for (const [id, nom] of Object.entries(THEME_NAMES)) {
      const avant = id === 'glace' ? 'vacances' : 'glace'; await dire(v, avant);
      // Le nom tel qu'il s'écrit, et tel qu'il se dit (sans parenthèses ni traits d'union).
      for (const phrase of new Set([nom, nom.replace(/[()]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()])) {
        const r = await v.order(`mets le thème ${phrase}`), t = (await etat(v)).theme;
        const vu = (r.data as Question | undefined)?.question ? 'question' : t, attendu = (compte.get(plat(nom)) ?? 0) > 1 ? 'question' : id;
        if (vu !== attendu) faux.push(`« ${phrase} » : ${vu} au lieu de ${attendu}`);
        await dire(v, avant);
      }
    }
    assert.deepEqual(faux, [], 'aucun nom ne donne un autre thème (« Bleu océan » n\'est pas l\'Océan d\'Odin)');
    // Le premier mot de plusieurs noms : la question, jamais l'un d'eux au hasard.
    for (const [mot, ids] of [['bleu', ['h-nuit', 'h-ocean']], ['aïd', ['ev-aidfitr', 'ev-aidkebir']], ['saint', ['ev-valentin', 'ev-patrick']]] as const) {
      await dire(v, 'glace');
      const r = await v.order(`mets le thème ${mot}`);
      assert.deepEqual((r.data as Question | undefined)?.choix?.map((c) => c.id), ids, mot);
      assert.equal((await etat(v)).theme, 'glace', `${mot} : rien n'a changé`);
    }
  } finally { fin(); }
});

test('une valeur qui ne se ramène à aucun mot (« 🌙 », « ??? ») : thème inconnu, rien ne change (ce n\'est pas « sans précision »)', async () => {
  const { v, fin } = odinDEssai();
  try {
    await dire(v, 'glace');
    for (const x of ['🌙', '???', '—']) {
      assert.match((await dire(v, x)).text, /inconnu/, x);
      assert.equal((await etat(v)).theme, 'glace', x);
    }
    // Ce qui est redit dans la question ne dépasse pas la longueur d'un nom.
    const r = await dire(v, `Neige${'!'.repeat(5000)}`);
    assert.equal(r.data.question, true); assert.ok(r.text.length < 400, `${r.text.length} caractères`);
  } finally { fin(); }
});

// ------------------------------------------------------------------ un identifiant exact : pas de question

test('identifiant exact : aucune question, pour chacun des thèmes (dont neige, desert, espace, neon, clair)', async () => {
  const { v, fin } = odinDEssai();
  try {
    for (const id of Object.keys(THEME_NAMES)) {
      const r = await dire(v, id);
      assert.equal(r.data.question, undefined, `${id} : pas de question`);
      assert.equal(r.data.theme, id, id);
    }
    // Un nom porté par un seul thème non plus.
    assert.equal((await dire(v, 'Maison claire')).data.theme, 'clair');
    assert.equal((await dire(v, 'Clair')).data.theme, 'h-clair');
    assert.equal((await dire(v, 'Automne')).data.theme, 'automne', '« automne » n\'est pas « automatique »');
  } finally { fin(); }
});

// ------------------------------------------------------------------ l'interrupteur « selon son humeur »

/** L'heure du thème automatique (fuseau d'Odin par défaut, comme apparence.ts sans lieu ni réglage). */
const heure = () => Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: A.FUSEAU_PAR_DEFAUT ?? 'UTC' }).format(new Date()));
const HUMEURS = ['neutre', 'joie', 'rire', 'amour', 'excite', 'triste', 'fatigue', 'inquiet', 'concentration', 'reflexion'] as const;

test('humeur coupée : le même thème automatique pour toutes les humeurs, tout de suite', async () => {
  const { v, fin } = odinDEssai();
  try {
    setCurrentMood('joie');
    const avant = (await etat(v)).theme;
    assert.equal(avant, autoTheme(heure(), undefined, 'joie').id, 'mise par défaut : l\'humeur joue');
    const r = await regler(v, { humeurTheme: false });
    assert.match(r.text, new RegExp(TEXTES.humeurCoupee.replace(/[.()]/g, '\\$&')));
    assert.equal(((await v.act('apparence', 'mascotte', {})).data as { humeurTheme: boolean }).humeurTheme, false);
    const vus = new Set<string>();
    for (const h of HUMEURS) { setCurrentMood(h); vus.add((await etat(v)).theme); }
    assert.deepEqual([...vus], [autoTheme(heure(), undefined, 'neutre').id], 'un seul thème, celui de l\'humeur neutre, sans attendre l\'heure');
    // « change ton thème » (sans précision) ne regarde pas l'humeur non plus.
    await dire(v, 'glace'); setCurrentMood('joie'); const r1 = (await dire(v, '')).data.theme;
    await dire(v, 'glace'); setCurrentMood('triste'); const r2 = (await dire(v, '')).data.theme;
    assert.equal(r1, autoTheme(heure(), undefined, 'neutre').id); assert.equal(r2, r1);
  } finally { setCurrentMood('neutre'); fin(); }
});

test('humeur mise : le thème automatique suit l\'humeur comme aujourd\'hui (règle inchangée)', async () => {
  for (const h of HUMEURS) {
    const { v, fin } = odinDEssai();
    try {
      setCurrentMood(h);
      await regler(v, { humeurTheme: false });
      const r = await regler(v, { humeurTheme: true });
      assert.match(r.text, new RegExp(TEXTES.humeurMise.replace(/[.()]/g, '\\$&')));
      assert.equal(((await v.act('apparence', 'mascotte', {})).data as { humeurTheme: boolean }).humeurTheme, true);
      assert.equal((await etat(v)).theme, autoTheme(heure(), undefined, h).id, h);
    } finally { setCurrentMood('neutre'); fin(); }
  }
  // Au plus une fois par heure : l'humeur qui change aussitôt après ne change pas le thème.
  const { v, fin } = odinDEssai();
  try {
    await regler(v, { humeurTheme: true });
    setCurrentMood('neutre'); const t1 = (await etat(v)).theme;
    setCurrentMood('joie'); assert.equal((await etat(v)).theme, t1, 'pas avant une heure');
  } finally { setCurrentMood('neutre'); fin(); }
});

// ------------------------------------------------------------------ l'interrupteur à l'écran, au clavier

type Noeud = El | Texte;
class Texte { parent: El | null = null; textContent: string; constructor(t: string) { this.textContent = t; } }
class El {
  parent: El | null = null; enfants: Noeud[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  ecoutes: Record<string, Array<(e: unknown) => void>> = {}; checked = false; dataset: Record<string, string> = {}; tagName: string;
  constructor(t: string) { this.tagName = t.toLowerCase(); }
  get id() { return this.attrs.id ?? ''; } set id(v: string) { this.attrs.id = v; }
  get className() { return this.attrs.class ?? ''; } set className(v: string) { this.attrs.class = v; }
  get type() { return this.attrs.type ?? ''; } set type(v: string) { this.attrs.type = v; }
  get title() { return this.attrs.title ?? ''; } set title(v: string) { this.attrs.title = v; }
  get hidden() { return 'hidden' in this.attrs; } set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get classList() {
    const l = () => this.className.split(/\s+/).filter(Boolean);
    return { contains: (c: string) => l().includes(c), add: (...c: string[]) => { this.className = [...new Set([...l(), ...c])].join(' '); }, remove: (...c: string[]) => { this.className = l().filter((x) => !c.includes(x)).join(' '); }, toggle: (c: string, f?: boolean) => { const o = f ?? !l().includes(c); if (o) this.classList.add(c); else this.classList.remove(c); return o; } };
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
  emettre(t: string) { for (const f of this.ecoutes[t] ?? []) f({ type: t, target: this }); }
  *tous(): Generator<El> { for (const e of this.enfants) if (e instanceof El) { yield e; yield* e.tous(); } }
  querySelectorAll(sel: string) { const ms = sel.split(',').map((x) => x.trim()); return [...this.tous()].filter((e) => ms.some((m) => correspond(e, m))); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
}
function correspond(e: El, sel: string): boolean {
  const m = /^([a-z0-9]*)((?:[#.][\w-]+|\[[^\]]+\])*)$/i.exec(sel); if (!m) return false;
  if (m[1] && e.tagName !== m[1].toLowerCase()) return false;
  for (const p of m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (p[0] === '#' && e.id !== p.slice(1)) return false;
    if (p[0] === '.' && !e.classList.contains(p.slice(1))) return false;
    if (p[0] === '[') { const a = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]$/.exec(p)!; const v = e.getAttribute(a[1]); if (v === null) return false; const w = a[2] ?? a[3]; if (w !== undefined && v !== w) return false; }
  }
  return true;
}
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
const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

/** Réglages → Apparence sur une page factice ; `serveur` répond comme Odin (thème, humeur, panne). */
function page(humeurTheme: boolean) {
  const corps = new El('body');
  corps.innerHTML = '<article class="card" data-sec="apparence"><h2>Apparence</h2><p class="sub">-</p></article>';
  const styles: El[] = [];
  const serveur = { humeurTheme, panne: false, appels: [] as Array<{ action: string; input: Record<string, unknown> }> };
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {}, style: { setProperty() {} } },
    head: { append: (s: El) => styles.push(s) }, hidden: false, createElement: (t: string) => new El(t),
    querySelector: (s: string) => corps.querySelector(s), querySelectorAll: (s: string) => corps.querySelectorAll(s), getElementById: (id: string) => corps.querySelector(`#${id}`), addEventListener() {},
  };
  const fetch = async (_u: string, o: { body: string }) => {
    if (serveur.panne) throw new TypeError('Failed to fetch');
    const { action, input } = JSON.parse(o.body) as { action: string; input: Record<string, unknown> };
    serveur.appels.push({ action, input });
    if (action === 'regler_mascotte') { const j = JSON.parse(String(input.reglages)) as { humeurTheme?: boolean }; if (typeof j.humeurTheme === 'boolean') serveur.humeurTheme = j.humeurTheme; }
    return { ok: true, json: async () => ({ data: { mode: 'auto', theme: 'ciel', why: 'c\'est le jour', humeurTheme: serveur.humeurTheme } }) };
  };
  const window: Record<string, unknown> = { addEventListener() {} }; window.window = window;
  vm.runInContext(lire('src/web/face.js'), vm.createContext({ window, setTimeout, clearTimeout }));
  const ctx = vm.createContext({ window, document, fetch, localStorage: { getItem: () => null, setItem() {} }, CustomEvent: class { type: string; constructor(t: string) { this.type = t; } }, setTimeout, clearTimeout, setInterval: () => 0 });
  vm.runInContext(lire('src/web/pages/themes-catalogue.js'), ctx);
  vm.runInContext(lire('src/web/themes.js'), ctx);
  return { carte: corps.querySelector('article.card')!, styles, serveur, window: window as unknown as { OdinThemes: { current: () => string; choose: (id: string) => Promise<void> } } };
}
const attendre = () => new Promise((r) => setTimeout(r, 20));

test('l\'interrupteur au clavier : une vraie case « interrupteur », nommée, de 44 px, que Espace bascule ; Odin garde le choix', async () => {
  const p = page(false);
  await attendre();
  const hum = p.carte.querySelector('#themeHumeur');
  assert.ok(hum, 'l\'interrupteur est dans Réglages → Apparence');
  assert.equal(hum.tagName, 'input'); assert.equal(hum.type, 'checkbox', 'une case : Tab l\'atteint, Espace la bascule');
  assert.equal(hum.getAttribute('role'), 'switch');
  assert.notEqual(hum.getAttribute('tabindex'), '-1'); assert.ok(!hum.hasAttribute('disabled'));
  const etiquette = hum.parent!;
  assert.equal(etiquette.tagName, 'label'); assert.equal(etiquette.getAttribute('for'), 'themeHumeur');
  assert.equal(etiquette.textContent, 'Odin change de thème selon son humeur', 'nommé par son texte');
  assert.ok(p.carte.querySelector(`#${hum.getAttribute('aria-describedby')}`)?.textContent, 'avec une aide');
  // Avant la grille des thèmes, après « Automatique » (comme dans la maquette).
  const ordre = [...p.carte.tous()].map((e) => e.id).filter((id) => ['themeAuto', 'themeHumeur', 'themeGrid'].includes(id));
  assert.deepEqual(ordre, ['themeAuto', 'themeHumeur', 'themeGrid']);
  const css = p.styles.map((s) => s.textContent).join('');
  assert.match(css, /\.thum\{[^}]*min-height:44px/, 'toute la ligne fait 44 px');
  assert.match(css, /#themeHumeur:focus-visible\{outline:3px/, 'le focus se voit');
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^@]*#themeHumeur[^}]*transition:none/);
  assert.equal(hum.checked, false, 'coupé chez Odin : coupé à l\'écran');
  // Espace sur la case : le navigateur la coche et prévient (« change »).
  hum.checked = true; hum.emettre('change'); await attendre();
  assert.deepEqual(p.serveur.appels.filter((a) => a.action === 'regler_mascotte').map((a) => JSON.parse(String(a.input.reglages))), [{ humeurTheme: true }]);
  assert.equal(p.serveur.humeurTheme, true); assert.equal(hum.checked, true);
  hum.checked = false; hum.emettre('change'); await attendre();
  assert.equal(p.serveur.humeurTheme, false); assert.equal(hum.checked, false);
  // Odin injoignable : la case revient à ce qu'Odin a vraiment.
  p.serveur.panne = true;
  hum.checked = true; hum.emettre('change'); await attendre();
  assert.equal(hum.checked, false, 'rien n\'est parti : la case est décochée de nouveau');
});

test('Odin injoignable : un thème choisi puis l\'interrupteur touché aussitôt — la page remet aussi le thème qu\'Odin a vraiment', async () => {
  const p = page(false);
  await attendre();
  const hum = p.carte.querySelector('#themeHumeur')!;
  assert.equal(p.window.OdinThemes.current(), 'ciel', 'le thème relu chez Odin');
  p.serveur.panne = true;
  void p.window.OdinThemes.choose('neige');
  assert.equal(p.window.OdinThemes.current(), 'neige', 'le choix se voit tout de suite');
  hum.checked = true; hum.emettre('change'); await attendre(); await attendre();
  assert.equal(hum.checked, false, 'la case revient à ce qu\'Odin a');
  assert.equal(p.window.OdinThemes.current(), 'ciel', 'le thème affiché aussi : rien n\'est parti');
  assert.equal(p.carte.querySelector('button.thc[aria-pressed=true]'), null, 'en automatique chez Odin : aucune carte marquée choisie');
});
