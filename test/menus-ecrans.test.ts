// L'entrée « Home Assistant » du menu (depuis le 24/11 : la vue #maison, l'écran de la maison DANS Odin — voir
// test/menus-maison-vue*.test.ts) et le retour vers Odin depuis la page /maison seule. Lu sans navigateur, comme test/menu-replie.test.ts : on lit la source de la page, on rejoue ses lignes sur un
// faux document, et src/web/pages/menu-ecrans.js est chargé sans document (rien ne touche la page à son chargement).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const lireEcrans = () => readFileSync(new URL('../src/web/pages/menu-ecrans.js', import.meta.url), 'utf8');

/** Le bloc du menu de gauche (de <nav … id="sideNav"> à sa fermeture). */
function menuGauche(): string {
  const d = UI.indexOf('id="sideNav"');
  assert.ok(d > 0, 'menu de gauche trouvé');
  return UI.slice(d, UI.indexOf('</nav>', d));
}
const texte = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** Le lien de l'écran de la maison dans le menu (balise ouvrante, contenu). */
function lienMaison() {
  const m = /<a class="tab"([^>]*)>([\s\S]*?)<\/a>/.exec(menuGauche());
  assert.ok(m, 'un lien a.tab dans le menu de gauche');
  return { attrs: m[1], corps: m[2], index: m.index };
}

test('menu : l\'entrée de l\'écran de la maison est un lien caché au départ, sous la première entrée', () => {
  const { attrs, corps, index } = lienMaison();
  assert.match(attrs, / href="#maison"/, 'href="#maison" : la vue dans Odin, plus la page /maison');
  assert.match(attrs, / id="navMaison"/);
  assert.match(attrs, / hidden(\s|$)/, 'caché au départ');
  assert.match(attrs, / data-view="maison"/, 'une vue d\'Odin');
  assert.match(corps, /<svg class="ic"[^>]*aria-hidden="true"/, 'une icône .ic');
  assert.equal(texte(/<span class="lbl">([\s\S]*?)<\/span>/.exec(corps)?.[1] ?? ''), 'Home Assistant');
  assert.doesNotMatch(corps, /class="badge"/, 'aucune pastille');
  const menu = menuGauche(), accueil = menu.indexOf('data-view="home"'), suivant = menu.indexOf('data-view="chat"');
  assert.ok(accueil > 0 && accueil < index && index < suivant, 'juste sous la première entrée, avant la Discussion');
  assert.ok(index < menu.indexOf('id="navMore"'), 'pas dans le bloc « Plus » replié');
  assert.match(UI, /a\.tab\{[^}]*text-decoration:none/, 'le lien garde l\'habillage des onglets, sans soulignement');
});

test('menu : aucun libellé en double (boutons et liens)', () => {
  const L = [...menuGauche().matchAll(/<(?:button|a) class="tab[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/g)]
    .map((m) => texte(/<span class="lbl">([\s\S]*?)<\/span>/.exec(m[1])?.[1] ?? ''));
  assert.ok(L.length >= 14, `${L.length} entrées`);
  assert.ok(L.every(Boolean), 'chaque entrée a son libellé');
  assert.deepEqual(L.filter((l, i) => L.indexOf(l) !== i), [], 'libellés en double');
});

// ---------- Faux document : les onglets, les vues, la barre du haut ----------
interface Faux { classes: Set<string>; dataset: Record<string, string>; attrs: Map<string, string>; ecoute: Array<() => void>; id: string; lbl: string }
function faux(id: string, classes: string[], dataset: Record<string, string> = {}, lbl = ''): Faux {
  return { classes: new Set(classes), dataset, attrs: new Map(), ecoute: [], id, lbl };
}
function elementDe(f: Faux) {
  return {
    id: f.id, dataset: f.dataset, textContent: f.lbl,
    classList: { toggle: (c: string, on?: boolean) => { const v = on ?? !f.classes.has(c); if (v) f.classes.add(c); else f.classes.delete(c); return v; }, contains: (c: string) => f.classes.has(c), add: (c: string) => f.classes.add(c), remove: (c: string) => f.classes.delete(c) },
    setAttribute: (k: string, v: string) => f.attrs.set(k, v), removeAttribute: (k: string) => f.attrs.delete(k), getAttribute: (k: string) => f.attrs.get(k) ?? null,
    addEventListener: (t: string, fn: () => void) => { if (t === 'click') f.ecoute.push(fn); },
    querySelector: () => ({ textContent: f.lbl }),
    click: () => { for (const fn of f.ecoute) fn(); },
  };
}
/** Le menu tel que la page le pose : onglets de vue, le lien de la maison, le bouton « Plus » du téléphone (classe tab, sans vue). */
function fauxDocument() {
  const tabs = [faux('', ['tab'], { view: 'home' }, 'Accueil'), faux('navMaison', ['tab'], { view: 'maison' }, 'Home Assistant'), faux('', ['tab'], { view: 'chat' }, 'Discussion'), faux('moreBtn', ['tab', 'bt'])];
  const vues = ['home', 'chat'].map((v) => faux('v-' + v, ['view']));
  const autres = new Map([['mcur', faux('mcur', [])], ['moreBtn', tabs[3]]]);
  const els = new Map<Faux, ReturnType<typeof elementDe>>();
  const E = (f: Faux) => { if (!els.has(f)) els.set(f, elementDe(f)); return els.get(f)!; };
  const document = {
    querySelectorAll: (sel: string) => {
      if (sel === '.tab') return tabs.map(E);
      if (sel === '.tab[data-view]') return tabs.filter((t) => t.dataset.view).map(E);
      if (sel === '.view') return vues.map(E);
      throw new Error(`sélecteur inattendu : ${sel}`);
    },
    querySelector: () => null,
    dispatchEvent: () => true,
  };
  const $ = (s: string) => { const f = autres.get(s.replace(/^#/, '')); if (!f) throw new Error(`élément inattendu : ${s}`); return E(f); };
  return { tabs, vues, document, $, E };
}
/** Les lignes de la page : le branchement des onglets et show(), rejoués tels quels. */
function lignesNavigation() {
  const branche = /^ {2}for \(const b of document\.querySelectorAll\('\.tab[^']*'\)\) b\.addEventListener\('click', \(\) => show\(b\.dataset\.view\)\);$/m.exec(UI);
  assert.ok(branche, 'la ligne qui branche les onglets');
  const d = UI.indexOf('  function show(v) {'), f = UI.indexOf('\n  }\n', d);
  assert.ok(d > 0 && f > d, 'la fonction show()');
  return { branche: branche[0], show: UI.slice(d, f + 4) };
}
function rejouer(espionner: boolean) {
  const doc = fauxDocument(), appels: unknown[] = [];
  const { branche, show } = lignesNavigation();
  const ctx = {
    document: doc.document, $: doc.$, appels, window: {}, localStorage: { setItem() {} }, CustomEvent: function CustomEvent(this: { type: string }, type: string) { this.type = type; },
    toggleNav() {}, navMore() {}, SECONDARY: ['flows'], grow() {}, placeTip() {}, setTimeout() {},
  };
  vm.runInNewContext(`${show}\n${espionner ? 'const vraie = show; show = (v) => { appels.push(v); };' : ''}\n${branche}\nthis.show = show;`, ctx);
  return { ...doc, appels, show: (ctx as unknown as { show: (v: string) => void }).show };
}

test('menu : la ligne qui branche les onglets ne prend que les onglets de vue', () => {
  assert.match(lignesNavigation().branche, /querySelectorAll\('\.tab\[data-view\]'\)/);
});

test('menu : un appui sur l\'entrée de la maison ouvre la vue « maison » d\'Odin', () => {
  const r = rejouer(true);
  r.E(r.tabs[1]).click();
  assert.deepEqual(r.appels, ['maison'], 'la vue s\'ouvre dans la page');
  r.appels.length = 0;
  r.E(r.tabs[2]).click();
  assert.deepEqual(r.appels, ['chat'], 'un onglet de vue ouvre toujours sa vue');
});

test('téléphone : après un appui sur « Plus », la vue ouverte reste affichée', () => {
  const r = rejouer(false);
  r.show('home');
  assert.ok(r.vues[0].classes.has('on'), 'l\'accueil est affiché');
  r.E(r.tabs[3]).click(); // « Plus » (classe tab, sans data-view)
  assert.ok(r.vues[0].classes.has('on'), 'l\'accueil reste affiché');
  assert.equal(r.vues.filter((v) => v.classes.has('on')).length, 1, 'une vue affichée, pas zéro');
  assert.equal(r.tabs[0].attrs.get('aria-current'), 'page', 'l\'accueil reste marqué');
});

// ---------- Qui voit l'entrée (src/web/pages/menu-ecrans.js) ----------
interface Ecrans { logique: { montrer: (etat: unknown, applis: unknown) => boolean } }
function charger(env: Record<string, unknown> = {}) {
  const ecoutes = new Map<string, Array<(e: unknown) => void>>();
  const win: { OdinMenuEcrans?: Ecrans; addEventListener: (t: string, fn: (e: unknown) => void) => void } = {
    addEventListener: (t, fn) => { ecoutes.set(t, [...(ecoutes.get(t) ?? []), fn]); },
  };
  vm.runInNewContext(lireEcrans(), { window: win, ...env });
  assert.ok(win.OdinMenuEcrans, 'window.OdinMenuEcrans est posé');
  return { E: win.OdinMenuEcrans, ecoutes };
}

test('qui voit l\'entrée : le propriétaire si les applis comptent Hestia ; jamais un membre', () => {
  const { montrer } = charger().E.logique;
  const proprio = { name: 'Odin' };
  assert.equal(montrer(proprio, ['midgard', 'gladsheim']), true, 'propriétaire, Hestia présente');
  assert.equal(montrer(proprio, [{ id: 'gladsheim' }]), true, 'liste du catalogue');
  assert.equal(montrer(proprio, ['midgard']), false, 'sans Hestia');
  assert.equal(montrer(proprio, []), false, 'liste vide');
  assert.equal(montrer(proprio, undefined), false, 'sans liste');
  assert.equal(montrer(proprio, null), false, 'sans liste');
  assert.equal(montrer(null, ['gladsheim']), false, 'sans état');
  assert.equal(montrer({ membre: { login: 'camille', name: 'Camille', groups: ['gladsheim'] } }, ['gladsheim']), false, 'un membre, même avec le droit sur Hestia');
  assert.equal(montrer({ membre: { login: 'camille', name: 'Camille', groups: [] } }, ['gladsheim']), false, 'un membre sans le droit');
});

test('qui voit l\'entrée : branché sur l\'état de la page, la liste des applis lue une fois, jamais pour un membre', async () => {
  const lien = { hidden: true }, demandes: string[] = [];
  const fetch = async (url: string) => { demandes.push(url); return { ok: true, json: async () => ({ ok: true, modules: [{ id: 'gladsheim' }, { id: 'midgard' }] }) }; };
  const { ecoutes } = charger({ document: { getElementById: (id: string) => (id === 'navMaison' ? lien : null) }, fetch });
  const etat = ecoutes.get('odin:etat');
  assert.ok(etat?.length, 'écoute odin:etat');
  const envoyer = async (detail: unknown) => { for (const fn of etat!) await fn({ detail }); await new Promise((r) => setImmediate(r)); };
  await envoyer({ membre: { login: 'camille', name: 'Camille', groups: ['gladsheim'] } });
  assert.equal(lien.hidden, true, 'un membre ne voit pas l\'entrée');
  assert.deepEqual(demandes, [], 'la liste des applis n\'est pas demandée pour un membre');
  await envoyer({ name: 'Odin' });
  assert.equal(lien.hidden, false, 'le propriétaire la voit');
  await envoyer({ name: 'Odin' });
  assert.deepEqual(demandes, ['/api/valhalla/catalog'], 'la liste est lue une seule fois');
  await envoyer({ membre: { login: 'camille', name: 'Camille', groups: ['gladsheim'] } });
  assert.equal(lien.hidden, true, 'redevient cachée si la page parle à un membre');
});

test('qui voit l\'entrée : sans état reçu, la page chargée demande qui regarde', async () => {
  for (const [me, attendu, demandesAttendues] of [
    [{ ok: true, profile: {} }, false, ['/api/account/me', '/api/valhalla/catalog']],
    [{ ok: true, profile: {}, membre: { login: 'camille', name: 'Camille', groups: ['gladsheim'] } }, true, ['/api/account/me']],
  ] as const) {
    const lien = { hidden: true }, demandes: string[] = [];
    const fetch = async (url: string) => { demandes.push(url); return { ok: true, json: async () => (url === '/api/account/me' ? me : { ok: true, modules: [{ id: 'gladsheim' }] }) }; };
    const { ecoutes } = charger({ document: { getElementById: () => lien }, fetch });
    for (const fn of ecoutes.get('load')!) fn({});
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(lien.hidden, attendu, me.membre ? 'membre' : 'propriétaire');
    assert.deepEqual(demandes, demandesAttendues);
  }
});

test('qui voit l\'entrée : liste illisible, l\'entrée reste cachée', async () => {
  const lien = { hidden: true };
  const { ecoutes } = charger({ document: { getElementById: () => lien }, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  for (const fn of ecoutes.get('odin:etat')!) await fn({ detail: { name: 'Odin' } });
  await new Promise((r) => setImmediate(r));
  assert.equal(lien.hidden, true);
});

test('qui voit l\'entrée : une lecture ratée de la liste n\'est retentée qu\'après 30 s, pas à chaque état', async () => {
  const lien = { hidden: true }, demandes: string[] = [];
  let maintenant = 1_000_000, reponse = false;
  const fetch = async (url: string) => { demandes.push(url); return reponse ? { ok: true, json: async () => ({ ok: true, modules: [{ id: 'gladsheim' }] }) } : { ok: false, json: async () => ({}) }; };
  const FauxDate = { now: () => maintenant };
  const { ecoutes } = charger({ document: { getElementById: () => lien }, fetch, Date: FauxDate });
  const envoyer = async () => { for (const fn of ecoutes.get('odin:etat')!) await fn({ detail: { name: 'Odin' } }); await new Promise((r) => setImmediate(r)); };
  await envoyer();
  await envoyer();
  maintenant += 29_000;
  await envoyer();
  assert.deepEqual(demandes, ['/api/valhalla/catalog'], 'une seule lecture tant que les 30 s ne sont pas passées');
  assert.equal(lien.hidden, true, 'l\'entrée reste cachée');
  maintenant += 2_000; reponse = true;
  await envoyer();
  assert.equal(demandes.length, 2, 'retentée après 30 s');
  assert.equal(lien.hidden, false, 'puis montrée');
});

test('palette : l\'écran de la maison s\'y trouve seulement quand l\'entrée du menu est visible', () => {
  const src = UI.slice(UI.indexOf('function palSource()'), UI.indexOf('function palRender()'));
  assert.match(src, /\$\('#navMaison'\)/, 'la palette lit l\'entrée du menu');
  assert.match(src, /!\w+\.hidden/, 'seulement si elle est visible');
  assert.doesNotMatch(src, /'Home Assistant'/, 'aucun libellé de plus : celui du menu');
});

// ---------- Le retour vers Odin, sur l'écran de la maison ----------
test('écran de la maison : le retour vers Odin n\'existe ni avec une clé de tablette ni dans un cadre', () => {
  const def = /const retourVisible = \(cle, encadre\) => [^;\n]+;/.exec(MAISON);
  assert.ok(def, 'la règle du retour');
  const retourVisible = vm.runInNewContext(`${def[0]}; retourVisible`) as (cle: string, encadre: boolean) => boolean;
  assert.equal(retourVisible('', false), true, 'une session, la page seule');
  assert.equal(retourVisible('gk_' + 'x'.repeat(40), false), false, 'clé de tablette');
  assert.equal(retourVisible('', true), false, 'dans un cadre');
  assert.equal(retourVisible('gk_' + 'x'.repeat(40), true), false);
  const draw = MAISON.slice(MAISON.indexOf('function draw()'), MAISON.indexOf('let soon = 0'));
  assert.match(draw, /retourVisible\(key, window\.top !== window\)/, 'draw() applique la règle');
  assert.match(draw, /el\('a', \{ class: 'btn retour', href: '\/'/, 'un lien vers Odin');
  assert.match(draw, /minHeight: '44px'/, 'cible de 44 px');
  // Un lien prend la couleur de lien du navigateur : le retour garde le texte des autres boutons de la barre (.round).
  assert.match(draw, /class: 'btn retour'[^\n]*style: \{[^}]*color: 'var\(--text\)'/, 'couleur du texte de l\'écran, pas celle d\'un lien');
  assert.match(MAISON, /const MOTS = \{[^}]*retour:/, 'ses mots dans un dictionnaire en tête');
});
