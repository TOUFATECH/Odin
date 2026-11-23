// Genèse · Réseau → « Menu PXE », lot S9 (la page) : les deux sous-onglets de Réseau (au clavier), la liste des systèmes
// dans l'ordre du menu (Monter / Descendre, et Alt + ↑ / ↓ sur une ligne : le focus suit), cacher un système, la ★ par
// défaut (éteinte pour une entrée qui installe), le délai, la disposition, l'aperçu écrit par Odin, Enregistrer / Annuler.
// La page de Genèse entière est montée dans un document minimal et parle au VRAI Odin (Valhalla, dossiers temporaires
// neufs, ISO d'essai) ; aucun port ouvert, aucun vrai réseau, aucun vrai PC.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGES = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-cle-suivi.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle.js', 'thjalfi-deployer.js', 'thjalfi-logiciels.js', 'thjalfi-menu-pxe.js', 'thjalfi-reseau.js', 'thjalfi-suivi.js', 'thjalfi-systemes.js', 'thjalfi.js'];
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const UB = 'ubuntu-24-04-3-live-server-amd64', MEM = 'memtest86plus-7-20';

// ------------------------------------------------------------------ un document minimal (le même que pour la page Réseau)
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


/** La page de Genèse montée, reliée au vrai Odin ; ses demandes notées. */
async function page() {
  const home = mkdtempSync(join(tmpdir(), 'odin-s9p-')); dossiers.push(home);
  const iso = join(home, 'iso'); mkdirSync(iso, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(iso, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date() } as never);
  await v.act('eitri', 'dossier', { chemin: iso });
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 6767, pxe: 0, client: 6868 }, ip: '127.0.0.1', mode: 'aucun' });
  const mod = v.modules().find((m) => m.id === 'thjalfi')!;
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, unknown> }> = [];
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'thjalfi') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action); const why = a?.grave?.(b.input, v.ctx('thjalfi'));
    if (why && !b.confirm) return { ok: false, text: why, confirm: why };
    return v.act('thjalfi', b.action, b.input);
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = { OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, location: { hash: '' }, Node: Noeud, Intl, Date, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}, fetch, createImageBitmap: undefined };
  for (const js of PAGES.map(src)) if (js) vm.runInNewContext(js, ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.thjalfi({ host, generic: [] });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const ouvrir = async () => {
    const n = qa('[role="tab"]').find((b) => b.textContent === 'Réseau')!; assert.ok(n, 'l\'onglet « Réseau »'); await n.emettre('click'); await calme();
    const m = q('[data-sous="menu"]'); assert.ok(m, 'le sous-onglet « Menu PXE »'); await m!.emettre('click'); await calme(); await calme();
  };
  const clic = async (s: string, dans?: Noeud) => { const n = (dans ?? corps).querySelector(s); assert.ok(n, `élément ${s}`); assert.ok(!n!.disabled, `${s} actif`); await n!.emettre('click'); await calme(); await calme(); };
  const ordre = () => qa('[data-f="entree"]').map((e) => e.getAttribute('data-id'));
  const fin = () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; };
  return { v, q, qa, ouvrir, clic, ordre, appels, fin, actif: () => actif, reglages: () => v.ctx('thjalfi').settings };
}
const ecrit = (P: Awaited<ReturnType<typeof page>>) => P.appels.filter((a) => !['reseau', 'tableau', 'systemes', 'postes_vus', 'profils_logiciels', 'isos', 'menu_pxe'].includes(a.action));
const ligneDe = (P: Awaited<ReturnType<typeof page>>, id: string) => P.qa('[data-f="entree"]').find((e) => e.getAttribute('data-id') === id)!;

test('S9 · page : Réseau a deux sous-onglets ; « Menu PXE » montre les systèmes dans l\'ordre, le disque du PC en dernier, et l\'aperçu écrit par Odin', async () => {
  assert.ok(src('thjalfi-menu-pxe.js'), 'src/web/pages/thjalfi-menu-pxe.js existe');
  const P = await page();
  try {
    await P.ouvrir();
    const sous = P.qa('[data-sous]');
    assert.deepEqual(sous.map((b) => b.textContent), ['Serveur de démarrage (DHCP)', 'Menu PXE']);
    assert.equal(sous[1].getAttribute('aria-selected'), 'true'); assert.equal(sous[1].getAttribute('role'), 'tab');
    assert.equal(P.q('[data-f="reseau"]'), null, 'le serveur n\'est plus dessiné (sa relecture s\'arrête)');
    const ids = P.ordre();
    assert.ok(ids.includes(UB) && ids.includes(MEM), `systèmes : ${ids.join(', ')}`);
    const lignes = P.q('[data-f="mp-liste"]')!.children;
    assert.equal(lignes.at(-1)!.getAttribute('data-id'), 'disque', 'le disque du PC, en dernier');
    assert.equal(lignes[0].getAttribute('data-id'), 'ecran', 'l\'écran d\'Odin, en premier comme au menu');
    assert.equal(P.q('[data-f="fixe-disque"] [data-f="etoile"]')!.getAttribute('aria-pressed'), 'true', '★ conseillée : le disque');
    // Une entrée qui installe : ★ éteinte, la raison écrite.
    const ub = ligneDe(P, UB);
    assert.equal(ub.querySelector('[data-f="etoile"]')!.disabled, true); assert.match(ub.textContent, /jamais par défaut/);
    assert.ok(P.q('[data-f="mp-note-installe"]'));
    // L'aperçu : les lignes du vrai script (le défaut surligné : le disque du PC).
    const ap = P.qa('[data-f="mp-lignes"] li[data-id]').map((l) => l.getAttribute('data-id'));
    assert.equal(ap.at(-2), 'local'); assert.equal(P.q('[data-f="mp-lignes"] li[data-defaut="1"]')!.getAttribute('data-id'), 'local');
    assert.match(P.q('[data-f="mp-pied"]')!.textContent, /Disque du PC démarre dans 10 s/);
    assert.equal(ecrit(P).length, 0, 'ouvrir n\'écrit rien');
    // Au clavier : ← sur les sous-onglets revient au serveur, le focus suit.
    await P.qa('[data-sous]')[1].emettre('keydown', { key: 'ArrowLeft' }); await calme(); await calme();
    assert.equal(P.qa('[data-sous]')[0].getAttribute('aria-selected'), 'true'); assert.equal(P.actif(), P.qa('[data-sous]')[0]);
    assert.ok(P.q('[data-f="reseau"]'), 'le serveur de démarrage revient');
  } finally { P.fin(); }
});

test('S9 · page : ranger au clavier (Alt + ↓, le focus suit) et aux flèches, cacher, délai ; Enregistrer change le vrai menu ; Annuler reprend', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    const avant = P.ordre(), premier = avant[0];
    // Alt + ↓ sur la flèche « Monter » du premier : il descend d'un cran, et le focus reste sur une de SES flèches.
    const fl = ligneDe(P, premier).querySelector('[data-f="descendre"]')!;
    await fl.emettre('keydown', { key: 'ArrowDown', altKey: true }); await calme();
    assert.deepEqual(P.ordre().slice(0, 2), [avant[1], premier]);
    assert.equal(P.actif()!.parent!.parent!.getAttribute('data-id'), premier, 'le focus suit le système déplacé');
    assert.match(P.q('[data-f="mp-annonce"]')!.textContent, /2 sur/);
    assert.ok(P.q('[data-f="mp-modifie"]'), 'pas encore enregistré');
    // Une touche sans Alt ne déplace rien.
    await ligneDe(P, premier).querySelector('[data-f="monter"]')!.emettre('keydown', { key: 'ArrowUp' }); await calme();
    assert.deepEqual(P.ordre().slice(0, 2), [avant[1], premier]);
    // Le bouton « Monter » le remet en tête ; en tête, « Monter » est éteint et le focus passe sur « Descendre ».
    await P.clic('[data-f="monter"]', ligneDe(P, premier));
    assert.deepEqual(P.ordre(), avant);
    assert.equal(ligneDe(P, premier).querySelector('[data-f="monter"]')!.disabled, true);
    assert.equal(P.actif()!.getAttribute('data-f'), 'descendre');
    // Ranger MEM en tête, cacher Ubuntu Server, délai 30 s, disposition Liste.
    while (P.ordre()[0] !== MEM) await P.clic('[data-f="monter"]', ligneDe(P, MEM));
    await P.clic('[data-f="proposer"]', ligneDe(P, UB));
    assert.equal(ligneDe(P, UB).querySelector('[data-f="proposer"]')!.getAttribute('aria-checked'), 'false'); assert.match(ligneDe(P, UB).textContent, /Caché du menu/);
    const sel = P.q('[data-f="delai"]')!; sel.value = '30'; await sel.emettre('change', { target: sel }); await calme(); await calme();
    await P.clic('[data-disp="liste"]');
    // L'aperçu du brouillon vient d'Odin : MEM en tête, Ubuntu Server absent, « dans 30 s ».
    const ap = P.qa('[data-f="mp-lignes"] li[data-id]').map((l) => l.getAttribute('data-id')).filter((x) => x !== 'ecran');
    assert.equal(ap[0], MEM); assert.ok(!ap.includes(UB)); assert.match(P.q('[data-f="mp-pied"]')!.textContent, /dans 30 s/);
    assert.equal(ecrit(P).length, 0, 'rien n\'est enregistré avant « Enregistrer »');
    await P.clic('[data-f="enregistrer"]');
    const w = ecrit(P); assert.equal(w.length, 1); assert.equal(w[0].action, 'menu_pxe_regler');
    const r = P.reglages();
    assert.equal((r.menuPxe as { ordre: string[] }).ordre[0], MEM); assert.deepEqual((r.menuPxe as { caches: string[] }).caches, [UB]);
    assert.equal(r.delai, 30); assert.equal((r.ecran as { disposition: string }).disposition, 'liste');
    assert.match(P.q('[data-f="mp-msg"]')!.textContent, /Menu PXE enregistré/);
    assert.equal(P.q('[data-f="mp-modifie"]'), null);
    // Annuler : un brouillon défait, rien n'est envoyé.
    await P.clic('[data-f="descendre"]', ligneDe(P, MEM));
    assert.notEqual(P.ordre()[0], MEM);
    await P.clic('[data-f="annuler"]');
    assert.equal(P.ordre()[0], MEM); assert.equal(ecrit(P).length, 1);
  } finally { P.fin(); }
});

test('S9 · page : la ★ sur l\'écran d\'Odin puis sur le disque ; un nom est toujours écrit comme du texte', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    await P.clic('[data-f="fixe-ecran"] [data-f="etoile"]');
    assert.equal(P.q('[data-f="fixe-ecran"] [data-f="etoile"]')!.getAttribute('aria-pressed'), 'true');
    assert.equal(P.q('[data-f="mp-lignes"] li[data-defaut="1"]')!.getAttribute('data-id'), 'ecran', 'l\'aperçu suit le brouillon');
    await P.clic('[data-f="enregistrer"]');
    assert.equal((P.reglages().ecran as { parDefaut: boolean }).parDefaut, true);
    await P.clic('[data-f="fixe-disque"] [data-f="etoile"]'); await P.clic('[data-f="enregistrer"]');
    assert.equal((P.reglages().ecran as { parDefaut: boolean }).parDefaut, false); assert.equal(P.reglages().defaut, 'local');
    for (const b of P.qa('[data-f="entree"] .mp-nm b')) assert.equal(b.enfants[0].nodeType, 3, 'texte, jamais du code');
  } finally { P.fin(); }
});

// ------------------------------------------------------------------ relecture du lot S9
test('S9 · page : un réglage fait ailleurs pendant que la page est ouverte n\'est pas écrasé par « Enregistrer »', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    // Ailleurs (Odin, une autre fenêtre) : l'écran d'Odin par défaut, un délai de 60 s, la disposition « Affiches ».
    assert.notEqual((await P.v.act('thjalfi', 'menu_pxe_regler', { defaut: 'ecran', delai: 60, disposition: 'affiches' })).ok, false);
    // Ici : on ne fait que ranger un système, puis « Enregistrer ».
    const avant = P.ordre();
    await P.clic('[data-f="descendre"]', ligneDe(P, avant[0]));
    await P.clic('[data-f="enregistrer"]');
    const r = P.reglages();
    assert.equal((r.menuPxe as { ordre: string[] }).ordre[1], avant[0], 'le rangement est enregistré');
    assert.equal(r.delai, 60, 'le délai réglé ailleurs reste');
    assert.equal((r.ecran as { parDefaut: boolean }).parDefaut, true, 'l\'écran d\'Odin par défaut, réglé ailleurs, reste');
    assert.equal((r.ecran as { disposition: string }).disposition, 'affiches', 'la disposition réglée ailleurs reste');
    // Cacher seulement : l'ordre « par famille » n'est pas figé pour autant.
    const P2 = await page();
    try {
      await P2.ouvrir();
      await P2.clic('[data-f="proposer"]', ligneDe(P2, UB)); await P2.clic('[data-f="enregistrer"]');
      assert.deepEqual((P2.reglages().menuPxe as { ordre: string[]; caches: string[] }).ordre, [], 'aucun ordre figé sans rangement');
      assert.deepEqual((P2.reglages().menuPxe as { caches: string[] }).caches, [UB]);
    } finally { P2.fin(); }
  } finally { P.fin(); }
});

test('S9 · page : un ancien défaut refusé est dit, et après « Enregistrer » ou « Annuler » le focus va au message', async () => {
  const P = await page();
  try {
    P.v.ctx('thjalfi').saveSettings({ defaut: UB });
    await P.ouvrir();
    const n = P.q('[data-f="mp-defaut-refuse"]'); assert.ok(n, 'la raison est écrite'); assert.match(n!.textContent, /installe/);
    await P.clic('[data-f="descendre"]', P.qa('[data-f="entree"]')[0]);
    await P.clic('[data-f="annuler"]');
    assert.equal(P.actif()?.getAttribute('data-f'), 'mp-msg', 'Annuler : le focus ne se perd pas');
    await P.clic('[data-f="descendre"]', P.qa('[data-f="entree"]')[0]);
    await P.clic('[data-f="enregistrer"]');
    assert.equal(P.actif()?.getAttribute('data-f'), 'mp-msg', 'Enregistrer : le focus va au message');
  } finally { P.fin(); }
});
