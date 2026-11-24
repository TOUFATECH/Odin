// Genèse · Clés USB, lot C5 « Mes clés » (la page) : la liste des clés ODIN, reconnaître une clé, ranger le menu (flèches et
// Alt + ↑ / ↓, le focus suit), la ★ (éteinte pour une entrée qui installe), retirer / garder, ajouter depuis la bibliothèque,
// le bandeau des changements en attente, appliquer (branchée) ou « dès qu'elle est branchée » (appliqué au branchement de
// CETTE clé), les mises à jour proposées, relire. La page parle aux VRAIES actions de « Mes clés » ; les disques sont faux,
// la clé est un dossier temporaire ; aucune commande lancée, aucun vrai disque.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import * as G from '../src/valhalla/thjalfi/cle-gerer.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c5p-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ un document minimal (le même que pour le menu PXE)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud;
let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; html = ''; value = '';
  classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; }
  get id() { return this.attrs.id ?? ''; }
  get parentNode() { return this.parent; }
  get disabled() { return 'disabled' in this.attrs; }
  set disabled(v: boolean) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  set innerHTML(h: string) { this.html = h; }
  set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get hidden() { return 'hidden' in this.attrs; }
  get children() { return this.enfants.filter((x) => x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => x.textContent).join(''); }
  set textContent(t: string) { this.replaceChildren(new Texte(String(t))); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  private ajouter(k: Noeud | string) { const n = typeof k === 'object' ? k : new Texte(String(k)); n.parent?.retirer(n); n.parent = this; this.enfants.push(n); }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | string>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string>) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.append(...ks); }
  get childNodes() { return [...this.enfants]; }
  remove() { this.parent?.retirer(this); }
  replaceWith(n: Noeud) { const p = this.parent; if (!p) return; const i = p.enfants.indexOf(this); n.parent?.retirer(n); p.enfants.splice(i, 1, n); n.parent = p; this.parent = null; }
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else if (k === 'value') this.value = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...plus };
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; }
  correspond(s: string): boolean {
    if (this.nodeType !== 1) return false;
    const m = /^([a-z0-9]*)((?:[#.][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(s.trim()); if (!m) return false;
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const p of m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
      if (p[0] === '[') { const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p)!; if (v === undefined ? !(k in this.attrs) : this.getAttribute(k) !== v) return false; }
      else if (p[0] === '#' ? this.id !== p.slice(1) : !this.classList.contains(p.slice(1))) return false;
    }
    return true;
  }
  tous(): Noeud[] { return this.children.flatMap((c) => [c, ...c.tous()]); }
  querySelectorAll(s: string): Noeud[] {
    const listes = s.split(',').map((x) => x.trim().split(/\s+/));
    const prend = (n: Noeud, parts: string[]) => { if (!n.correspond(parts[parts.length - 1])) return false; let i = parts.length - 2, p = n.parent; while (i >= 0 && p) { if (p.correspond(parts[i])) i--; p = p.parent; } return i < 0; };
    return this.tous().filter((n) => listes.some((parts) => prend(n, parts)));
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
const calme = async () => { for (let k = 0; k < 20; k++) await new Promise((ok) => setTimeout(ok, 4)); };

const Go = 1024 ** 3;
const rUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };
const rLive: Recipe = { kind: 'casper', label: 'Live', auto: false, os: 'linux' };
const U = 'ubuntu-24.04-desktop-amd64.iso', GP = 'gparted-live-1.6.0-amd64.iso', MINT = 'linuxmint-22-cinnamon-64bit.iso', TAILS = 'tails-6.0.iso';
const A: Disque = { id: 'cle-a', chemin: 'faux-a', modele: 'Clé USB 64 Go (fausse)', serie: 'AA11BB227F2A', tailleOctets: 58 * Go, genre: 'cle', externe: true, amovible: true, bus: 'usb', estOdin: true, partitions: [{ nom: 'p1', label: 'ODIN', tailleOctets: 57 * Go, utiliseOctets: 10 * Go }] };
const f = (dir: string, rel: string, c: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), c); };
/** Une clé ODIN écrite avant ce lot : Ubuntu (s'installe tout seul), Tails (live) et GParted. */
function cleEcrite(dir: string) {
  f(dir, `ISO/${U}`, 'ISO-UBUNTU'); f(dir, `ISO/${TAILS}`, 'ISO-TAILS'); f(dir, `ISO/${GP}`, 'ISO-GPARTED');
  f(dir, 'logiciels/windows/firefox.exe', 'EXE'); f(dir, 'ecran-odin/systemes.json', '{}');
  f(dir, 'ventoy/ventoy.json', JSON.stringify({ control: [{ VTOY_DEFAULT_MENU_MODE: '0' }], menu_alias: [{ image: `/ISO/${U}`, alias: 'Ubuntu 24.04' }, { image: `/ISO/${TAILS}`, alias: 'Tails 6' }, { image: `/ISO/${GP}`, alias: 'GParted 1.6' }], auto_install: [{ image: `/ISO/${U}`, template: '/odin/user-data' }] }));
}

/** La page « Mes clés » montée, reliée aux vraies actions ; ses demandes notées. */
async function page(o: { branchees?: () => Disque[]; biblioLive?: boolean } = {}) {
  const srcD = neuf('src'), home = neuf('home'), dir = neuf('dir'), cleD = neuf('cle');
  cleEcrite(cleD);
  const iso = (n: string, c: string) => { const p = join(srcD, n); writeFileSync(p, c); return p; };
  const biblio = [
    { id: 'mint', nom: 'linuxmint-22-cinnamon-64bit', chemin: iso('mint.iso', 'ISO-MINT'), recipe: rLive },
    { id: 'ubuntu2', nom: 'ubuntu-24.04.2-desktop-amd64', chemin: iso('u2.iso', 'ISO-UBUNTU-2'), recipe: rUbuntu },
    // Tails est un système live : reconnu par la bibliothèque (une ISO inconnue ne démarrerait jamais seule).
    { id: 'tails', nom: 'tails-6.0', chemin: iso('tails.iso', 'ISO-TAILS'), recipe: rLive },
  ];
  const branchees = o.branchees ?? (() => [A]);
  const appels = { run: 0 };
  /** l'heure d'Odin (0 : l'heure vraie) */
  const horloge = { t: 0 };
  const ctx = { home, dir, settings: { get cleDisquesTest() { return branchees(); } }, now: () => new Date(horloge.t || Date.now()), run: async () => { appels.run++; throw new Error('aucune commande'); }, call: async () => { throw new Error('absent'); } } as unknown as ModCtx;
  const actions = G.cleGerer({ bibliotheque: async () => biblio, io: () => G.ioGererDossier(cleD) }).actions;
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const demandes: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  // Comme la porte d'Odin (POST /api/valhalla/act) : une action grave sans « confirm » n'est PAS lancée, sa question revient.
  const post = async (action: string, input: Record<string, unknown> = {}, confirm = false) => {
    demandes.push({ action, input, confirm: confirm === true });
    const a = actions.find((x) => x.id === action);
    if (!a) return { ok: false, text: 'inconnue' };
    const pourquoi = a.grave?.(JSON.parse(JSON.stringify(input)), ctx);
    if (pourquoi && confirm !== true) return { ok: false, confirm: `Confirmer : ${pourquoi} ?` };
    const r = await a.run(ctx, JSON.parse(JSON.stringify(input)));
    if (action === 'cle_appliquer' || action === 'cle_relire') await G.attendreTravail(String(input.cle));
    return JSON.parse(JSON.stringify(r));
  };
  const confirmes: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { confirmes.push(t); return true; }, alert: async () => {}, prompt: async () => null } };
  const vmctx = { window, document, Node: Noeud, Intl, Date, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}, encodeURIComponent, JSON };
  vm.runInNewContext(src('thjalfi-cle-gerer.js'), vmctx);
  const host = new Noeud('div'); corps.append(host);
  let deploye = 0;
  const monter = async () => { await window.OdinGeneseCleGerer.monter(host, { post, act: post, deployer: () => { deploye++; } }); await calme(); };
  await monter();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const clic = async (s: string) => { const n = q(s); assert.ok(n, `élément ${s}`); assert.ok(!n!.disabled, `${s} actif`); await n!.emettre('click'); await calme(); };
  const ligne = (fichier: string) => qa('[data-f="entree"]').find((x) => x.getAttribute('data-id') === fichier)!;
  const ordre = () => qa('[data-f="entree"]').map((x) => x.getAttribute('data-id'));
  const ecrites = () => demandes.filter((d) => ['cle_reconnaitre', 'cle_appliquer'].includes(d.action));
  return { q, qa, clic, ligne, ordre, monter, demandes, ecrites, confirmes, cleD, actif: () => actif, appels, deploye: () => deploye, logique: window.OdinGeneseCleGerer.logique, horloge, post, MOTS: window.OdinGeneseCleGerer.MOTS };
}
const e = (s: string) => `[data-f="${s}"]`;
const id = (fichier: string) => encodeURIComponent(fichier);

test('C5 · page : une clé ODIN pas encore connue se reconnaît ; le menu dans l\'ordre, la ★ éteinte pour ce qui installe', async () => {
  assert.ok(src('thjalfi-cle-gerer.js'), 'src/web/pages/thjalfi-cle-gerer.js existe');
  const P = await page();
  assert.match(P.q('.cg-liste')!.textContent, /Mes clés ODIN0/);
  assert.match(P.q(e('carte'))!.textContent, /Clé ODIN pas encore connue/);
  assert.equal(P.ecrites().length, 0, 'ouvrir n\'écrit rien');
  await P.clic(e('reconnaitre'));
  assert.ok(existsSync(join(P.cleD, 'odin', 'cle-odin.json')));
  assert.deepEqual(P.ordre(), [U, TAILS, GP]);
  assert.match(P.q('.cg-liste')!.textContent, /Branchée · 3 entrée\(s\)/);
  const ub = P.ligne(U);
  assert.equal(ub.querySelector(e(`star-${id(U)}`))!.disabled, true, 'Ubuntu s\'installe : jamais par défaut');
  assert.match(ub.textContent, /jamais par défaut/);
  assert.equal(P.ligne(TAILS).querySelector(e(`star-${id(TAILS)}`))!.disabled, false, 'un live peut démarrer seul');
  assert.equal(P.ligne(U).querySelector(e(`up-${id(U)}`))!.disabled, true, 'le premier ne monte pas');
  // Les sous-onglets, au clavier.
  const sous = P.qa('[role="tab"]');
  assert.deepEqual(sous.map((s) => s.textContent), ['Contenu et ordre', 'Mises à jour']);
  await sous[0].emettre('keydown', { key: 'ArrowRight' }); await calme();
  assert.equal(P.q(e('sous-maj'))!.getAttribute('aria-selected'), 'true'); assert.equal(P.actif(), P.q(e('sous-maj')), 'le focus suit');
  assert.match(P.q('#cg-sous-panneau')!.textContent, /Ubuntu 24\.04 → ubuntu-24\.04\.2-desktop-amd64/);
  assert.equal(P.appels.run, 0);
});

test('C5 · page : ranger (bouton et Alt + ↓, le focus suit), ★, retirer puis garder, ajouter ; rien n\'est écrit avant « Appliquer » ; Annuler reprend', async () => {
  const P = await page();
  await P.clic(e('reconnaitre'));
  const avant = readFileSync(join(P.cleD, 'ventoy', 'ventoy.json'), 'utf8');
  await P.clic(e(`down-${id(U)}`));
  assert.deepEqual(P.ordre(), [TAILS, U, GP]);
  const fl = P.ligne(U).querySelector(e(`down-${id(U)}`))!;
  await fl.emettre('keydown', { key: 'ArrowDown', altKey: true }); await calme();
  assert.deepEqual(P.ordre(), [TAILS, GP, U]);
  assert.equal(P.actif()?.getAttribute('data-f'), `up-${id(U)}`, 'en bas, le focus passe sur « Monter » de la même ligne');
  await P.clic(e(`star-${id(TAILS)}`));
  assert.equal(P.ligne(TAILS).querySelector(e(`star-${id(TAILS)}`))!.getAttribute('aria-pressed'), 'true');
  assert.match(P.ligne(TAILS).textContent, /démarre seul après 10 s/);
  await P.clic(e(`rm-${id(GP)}`));
  assert.ok(P.ligne(GP).classList.contains('retire')); assert.match(P.ligne(GP).textContent, /Sera retiré/);
  await P.clic(e(`rm-${id(GP)}`));
  assert.ok(!P.ligne(GP).classList.contains('retire'), 'gardé de nouveau');
  await P.clic(e('ajouter'));
  await P.clic(e('add-mint'));
  assert.ok(P.ligne(MINT).classList.contains('ajoute'));
  assert.match(P.q(e('attente'))!.textContent, /3 changement\(s\) en attente · la clé n'est pas effacée/);
  assert.equal(readFileSync(join(P.cleD, 'ventoy', 'ventoy.json'), 'utf8'), avant, 'rien n\'est écrit sur la clé');
  assert.ok(!existsSync(join(P.cleD, 'ISO', MINT)));
  await P.clic(e('annuler'));
  assert.equal(P.q(e('attente')), null);
  assert.deepEqual(P.ordre(), [U, TAILS, GP], 'tout reprend');
});

test('C5 · page : appliquer à la clé branchée (retrait confirmé dans la page) ; ses seuls fichiers changent', async () => {
  const P = await page();
  await P.clic(e('reconnaitre'));
  await P.clic(e(`rm-${id(GP)}`));
  await P.clic(e('ajouter')); await P.clic(e('add-mint'));
  await P.clic(e(`star-${id(MINT)}`));
  assert.match(P.q(e('attente'))!.textContent, /seuls les fichiers des systèmes retirés seront effacés/);
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 1); assert.match(P.confirmes[0], /GParted 1\.6/);
  assert.match(P.q(e('resultat'))!.textContent, /mise à jour sans rien effacer d'autre/);
  assert.equal(P.q(e('attente')), null);
  assert.ok(existsSync(join(P.cleD, 'ISO', MINT)) && !existsSync(join(P.cleD, 'ISO', GP)));
  assert.equal(readFileSync(join(P.cleD, 'ISO', U), 'utf8'), 'ISO-UBUNTU');
  assert.deepEqual(P.ordre(), [U, TAILS, MINT]);
  assert.equal(P.ligne(MINT).querySelector(e(`star-${id(MINT)}`))!.getAttribute('aria-pressed'), 'true');
  // Relire.
  await P.clic(e('sous-maj'));
  await P.clic(e('relire'));
  assert.match(P.q(e('resultat'))!.textContent, /aucune erreur/);
});

test('C5 · page : une clé pas branchée garde ses changements ; « dès qu\'elle est branchée » les applique au branchement de CETTE clé', async () => {
  let liste: Disque[] = [A];
  const P = await page({ branchees: () => liste });
  await P.clic(e('reconnaitre'));
  liste = [];
  await P.monter();
  assert.match(P.q('.cg-liste')!.textContent, /Vue à l'instant/);
  assert.match(P.q(e('carte'))!.textContent, /Pas branchée/);
  await P.clic(e(`rm-${id(TAILS)}`));
  assert.equal(P.q(e('appliquer'))!.textContent, 'Appliquer dès qu\'elle est branchée');
  await P.clic(e('appliquer'));
  assert.match(P.q(e('attente'))!.textContent, /dès que cette clé sera branchée/);
  assert.equal(P.q(e('appliquer'))!.disabled, true);
  assert.ok(existsSync(join(P.cleD, 'ISO', TAILS)), 'rien d\'écrit : elle n\'est pas branchée');
  assert.equal(P.ecrites().filter((d) => d.action === 'cle_appliquer').length, 0);
  // Une AUTRE clé, même modèle, numéro différent, est branchée : rien ne part.
  liste = [{ ...A, id: 'cle-b', serie: 'BB99CC887766' }];
  await P.monter();
  assert.ok(existsSync(join(P.cleD, 'ISO', TAILS)));
  // CETTE clé revient : appliqué tout seul, une fois.
  liste = [A];
  await P.monter();
  assert.equal(P.ecrites().filter((d) => d.action === 'cle_appliquer').length, 1);
  assert.ok(!existsSync(join(P.cleD, 'ISO', TAILS)), 'appliqué à son branchement');
  assert.equal(P.q(e('attente')), null);
});

test('C5 · page : « Préparer une nouvelle clé » ramène à Déployer ; aucune clé : le dire ; logique pure', async () => {
  const P = await page({ branchees: () => [] });
  assert.match(P.q('.cg-vide')!.textContent, /Aucune clé ODIN connue/);
  await P.clic(e('nouvelle'));
  assert.equal(P.deploye(), 1);
  const L = P.logique;
  const cle = { id: 'x', contenu: { systemes: [{ fichier: 'a.iso', nom: 'A', defautPermis: true }, { fichier: 'b.iso', nom: 'B', defautPermis: false }] }, attente: null };
  assert.deepEqual([...L.ordreFinal(cle)], ['a.iso', 'b.iso']);
  assert.equal(L.deplacer(cle, 'a.iso', -1), null, 'le premier ne monte pas');
  assert.deepEqual([...L.deplacer(cle, 'a.iso', 1).ordre], ['b.iso', 'a.iso']);
  assert.equal(L.etoile(cle, 'b.iso'), null, 'jamais par défaut ce qui installe');
  assert.deepEqual(JSON.parse(JSON.stringify(L.pourServeur(L.basculer(cle, 'b.iso')))), { retirer: ['b.iso'], ajouter: [], remplacer: [] }, 'seulement les changements : l\'accord « au branchement » est un geste à part');
});

// ================================================================================================ relecture du lot C5
test('relecture C5 · page : l\'accord « dès qu\'elle est branchée » tombe au moindre changement, ne vaut que 24 heures, et la page n\'applique alors rien toute seule', async () => {
  let liste: Disque[] = [A];
  const P = await page({ branchees: () => liste });
  await P.clic(e('reconnaitre'));
  liste = [];
  await P.monter();
  await P.clic(e(`rm-${id(TAILS)}`));
  await P.clic(e('appliquer'));
  assert.match(P.q(e('arme'))!.textContent, /dans les 24 heures/);
  assert.equal(P.confirmes.length, 1, 'le retrait a été confirmé une fois, pour CE retrait');
  // Un autre retrait ajouté après l'accord : l'accord ne vaut pas pour lui.
  await P.clic(e(`rm-${id(GP)}`));
  assert.equal(P.q(e('arme')), null, 'plus de « sera appliqué dès que… »');
  assert.equal(P.q(e('appliquer'))!.disabled, false, 'il faut le redemander');
  const envois = P.demandes.filter((d) => d.action === 'cle_changer');
  assert.deepEqual(envois.map((d) => d.input.armer), [false, true, false], 'seul « Appliquer dès qu\'elle est branchée » donne l\'accord');
  assert.ok(envois.every((d) => !('arme' in (d.input.attente as object))), 'l\'accord n\'est jamais glissé dans les changements');
  liste = [A];
  await P.monter();
  assert.equal(P.ecrites().filter((d) => d.action === 'cle_appliquer').length, 0, 'la clé revient : rien ne part tout seul');
  assert.ok(existsSync(join(P.cleD, 'ISO', TAILS))); assert.ok(existsSync(join(P.cleD, 'ISO', GP)));
  // L'accord redonné pour les deux retraits, puis la clé oubliée 25 heures : rien ne part par surprise.
  liste = [];
  await P.monter();
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 2); assert.match(P.confirmes[1], /Tails/); assert.match(P.confirmes[1], /GParted/);
  P.horloge.t = Date.now() + 25 * 3600 * 1000;
  liste = [A];
  await P.monter();
  assert.equal(P.ecrites().filter((d) => d.action === 'cle_appliquer').length, 0, 'accord trop ancien : pas appliqué tout seul');
  assert.match(P.q(e('arme'))!.textContent, /plus de 24 heures/);
  assert.ok(existsSync(join(P.cleD, 'ISO', TAILS)));
  // En personne : « Appliquer à la clé », avec sa confirmation.
  assert.equal(P.q(e('appliquer'))!.textContent, 'Appliquer à la clé');
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 3);
  assert.ok(!existsSync(join(P.cleD, 'ISO', TAILS))); assert.ok(!existsSync(join(P.cleD, 'ISO', GP)));
  // La confirmation dit quand la mémoire d'un système part avec lui.
  const partis = P.logique.retraits({ contenu: { systemes: [{ fichier: 'a.iso', nom: 'Ubuntu', choix: 'persistance' }, { fichier: 'b.iso', nom: 'GParted', choix: 'iso' }] }, attente: { retirer: ['a.iso', 'b.iso'], ajouter: [], remplacer: [] } });
  assert.match(partis[0], /Ubuntu \(avec sa mémoire/); assert.equal(partis[1], 'GParted');
});

// ================================================================================ décisions du propriétaire (26/11)
test('décision du 26/11 · page : UNE question pour un retrait, passée à Odin avec la demande ; hors de la page, Odin pose sa question et ne retire rien', async () => {
  const P = await page();
  await P.clic(e('reconnaitre'));
  const cle = String(P.demandes.find((d) => d.action === 'cle_changer' || d.action === 'cle_mises_a_jour')?.input.cle ?? '');
  await P.clic(e(`rm-${id(GP)}`));
  const idCle = String(P.demandes.filter((d) => d.action === 'cle_changer').at(-1)!.input.cle || cle);
  // 1) Une demande venue d'ailleurs que la page (pas d'accord) : Odin pose SA question, qui nomme la clé et le système.
  let r = await P.post('cle_appliquer', { cle: idCle });
  assert.equal(r.ok, false); assert.match(r.confirm, /^Confirmer : retirer de la clé « [^»]+ » : GParted 1\.6/);
  assert.ok(existsSync(join(P.cleD, 'ISO', GP)), 'rien n\'est retiré');
  // … et un « oui » général, sans nommer ces retraits-là, ne suffit pas non plus.
  r = await P.post('cle_appliquer', { cle: idCle }, true);
  assert.equal(r.ok, false); assert.match(r.text, /demande ton accord pour ces retraits-là/);
  assert.ok(existsSync(join(P.cleD, 'ISO', GP)));
  // 2) Dans la page : une seule question (la sienne), et sa réponse part avec la demande.
  const n = P.demandes.length;
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 1, 'une seule question'); assert.match(P.confirmes[0], /GParted 1\.6/);
  const envois = P.demandes.slice(n).filter((d) => d.action === 'cle_appliquer');
  assert.equal(envois.length, 1, 'une seule demande');
  assert.deepEqual([...(envois[0].input.retraits as string[])], [GP], 'les retraits acceptés sont nommés'); assert.equal(envois[0].confirm, true);
  assert.ok(!existsSync(join(P.cleD, 'ISO', GP)), 'retiré, avec l\'accord');
  assert.equal(readFileSync(join(P.cleD, 'ISO', TAILS), 'utf8'), 'ISO-TAILS');
  // 3) Sans retrait : aucune question, aucun accord envoyé.
  await P.clic(e('ajouter')); await P.clic(e('add-mint'));
  const n2 = P.demandes.length;
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 1, 'pas de question pour un ajout');
  const ajout = P.demandes.slice(n2).find((d) => d.action === 'cle_appliquer')!;
  assert.equal(ajout.confirm, false); assert.equal('retraits' in ajout.input, false);
  assert.ok(existsSync(join(P.cleD, 'ISO', MINT)));
  // 4) Les changements bougent derrière la page après la question (un autre onglet ajoute un retrait) : rien ne part.
  await P.clic(e(`rm-${id(MINT)}`));
  await P.post('cle_changer', { cle: idCle, attente: { retirer: [MINT, TAILS] } });
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 2); assert.doesNotMatch(P.confirmes[1], /Tails/, 'la page n\'avait montré que Mint');
  assert.ok(existsSync(join(P.cleD, 'ISO', MINT)) && existsSync(join(P.cleD, 'ISO', TAILS)), 'l\'accord ne valait pas pour Tails : rien n\'est retiré');
  assert.match(P.q(e('attente'))!.textContent, /2 changement/, 'la page se relit : les deux retraits sont montrés');
  // 5) Pas branchée : la même question, et l'accord part avec « dès qu'elle est branchée ».
  assert.equal(P.logique.fichiersRetires({ contenu: { systemes: [{ fichier: 'a.iso', nom: 'A' }, { fichier: 'b.iso', nom: 'B' }, { fichier: 'c.iso', nom: 'C' }] }, attente: { retirer: ['b.iso'], ajouter: [], remplacer: [{ ancien: 'c.iso', iso: 'c2', fichier: 'c2.iso', nom: 'C2' }] } }).join(','), 'b.iso,c.iso');
  assert.match(P.MOTS.arme, /24 heures/); assert.match(P.MOTS.armePerime, /24 heures/); assert.doesNotMatch(JSON.stringify(P.MOTS), /7 jours/);
});

test('décision du 26/11 · page : « dès qu\'elle est branchée » avec un retrait : l\'accord part avec la demande, Odin le note ; au branchement il s\'applique, sans deuxième question', async () => {
  let liste: Disque[] = [A];
  const P = await page({ branchees: () => liste });
  await P.clic(e('reconnaitre'));
  liste = [];
  await P.monter();
  await P.clic(e(`rm-${id(TAILS)}`));
  await P.clic(e('appliquer'));
  assert.equal(P.confirmes.length, 1); assert.match(P.confirmes[0], /Tails/);
  const arme = P.demandes.filter((d) => d.action === 'cle_changer').at(-1)!;
  assert.equal(arme.input.armer, true); assert.deepEqual([...(arme.input.retraits as string[])], [TAILS]); assert.equal(arme.confirm, true);
  // Hors de la page : armer un retrait sans accord → la question d'Odin, rien de gardé en plus.
  const r = await P.post('cle_changer', { cle: arme.input.cle, attente: { retirer: [TAILS, GP] }, armer: true });
  assert.equal(r.ok, false); assert.match(r.confirm, /dès que la clé sera branchée, retirer de la clé/); assert.match(r.confirm, /GParted 1\.6/);
  liste = [A];
  await P.monter();
  assert.equal(P.confirmes.length, 1, 'pas de deuxième question au branchement');
  assert.ok(!existsSync(join(P.cleD, 'ISO', TAILS)), 'le retrait accepté est appliqué');
  assert.ok(existsSync(join(P.cleD, 'ISO', GP)), 'GParted, jamais accepté, reste');
});
