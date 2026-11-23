// Genèse · Réseau, lot S8 (la page) : l'onglet « Réseau » de Genèse — l'interrupteur (avec ton accord), les cartes
// réseau, « À côté de la box » / « Odin distribue les adresses » / « Ma box s'en charge », le garde-fou rouge quand la box
// répond sur la carte (et « Rester à côté de la box »), le vert quand le réseau à part est libre, les PC autorisés (ajout
// par adresse MAC, retrait), et les PC qui démarrent EN DIRECT (un inconnu → « Autoriser »), au clavier.
// La page de Genèse entière est montée dans un document minimal et parle au VRAI Odin (Valhalla, dossiers temporaires) :
// les cartes, la recherche d'un autre serveur et l'écoute du réseau à part sont SIMULÉES (RESEAU remplacé). Les actions
// graves passent par la même règle que l'interface (pas d'accord : rien ne part). Aucun vrai réseau, aucun vrai PC.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import * as R from '../src/valhalla/thjalfi/reseau.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGES = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-cle-suivi.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle.js', 'thjalfi-deployer.js', 'thjalfi-logiciels.js', 'thjalfi-reseau.js', 'thjalfi-suivi.js', 'thjalfi-systemes.js', 'thjalfi.js'];
const dossiers: string[] = [];
const ORIGINE = { ...R.RESEAU };
after(() => { Object.assign(R.RESEAU, ORIGINE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const ETH: R.CarteReseau = { nom: 'Ethernet', ip: '192.168.1.20', masque: '255.255.255.0', prefixe: 24, genre: 'cable' };
const WIFI: R.CarteReseau = { nom: 'Wi-Fi', ip: '192.168.1.23', masque: '255.255.255.0', prefixe: 24, genre: 'wifi' };
// (Le petit document de l'essai ne lit pas un sélecteur avec une espace : la carte s'appelle ici « Ethernet-2 ».)
const APART: R.CarteReseau = { nom: 'Ethernet-2', ip: '10.10.0.1', masque: '255.255.255.0', prefixe: 24, genre: 'cable' };
const PIEGE: R.CarteReseau = { nom: '<img src=x onerror=alert(1)>', ip: '10.20.0.1', masque: '255.255.255.0', prefixe: 24, genre: 'virtuelle' };

// ------------------------------------------------------------------ un document minimal
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

/** La page de Genèse montée, reliée au vrai Odin ; ses demandes et les accords demandés notés. */
async function page(o: { accord?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'odin-s8p-')); dossiers.push(home);
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const ecoutes: Array<{ host: string }> = [], box = new Set(['Ethernet', 'Wi-Fi']);
  R.RESEAU.cartes = () => [ETH, APART, WIFI, PIEGE];
  R.RESEAU.plateforme = () => 'win32';
  R.RESEAU.chercher = async (c) => (box.has(c.nom) ? { serveurs: ['192.168.1.1'] } : { serveurs: [] });
  R.RESEAU.ecouter = async (srv, _p, _c, host) => { ecoutes.push({ host }); (srv as unknown as { sock: unknown }).sock = { send: () => {}, close: () => {} }; };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date() } as never);
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 6767, pxe: 0, client: 6868 } });
  const mod = v.modules().find((m) => m.id === 'thjalfi')!;
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [], dialogues: string[] = [];
  // La même règle que l'interface d'Odin : une action grave sans accord ne part pas, la réponse dit quoi accepter.
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'thjalfi') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action); const why = a?.grave?.(b.input, v.ctx('thjalfi'));
    if (why && !b.confirm) return { ok: false, text: why, confirm: why };
    return v.act('thjalfi', b.action, b.input);
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input, confirm: Boolean(b.confirm) }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return o.accord !== false; }, alert: async (t: string) => { dialogues.push(t); }, prompt: async () => null } };
  const minuteurs = new Map<number, () => unknown>(); let nm = 0;
  const ctx = { window, document, location: { hash: '' }, Node: Noeud, Intl, Date, setInterval: () => 0, clearInterval: () => {}, setTimeout: (f: () => unknown) => { minuteurs.set(++nm, f); return nm; }, clearTimeout: (i: number) => { minuteurs.delete(i); }, fetch, createImageBitmap: undefined };
  for (const js of PAGES.map(src)) if (js) vm.runInNewContext(js, ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.thjalfi({ host, generic: [] });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const onglet = (t: string) => qa('[role="tab"]').find((b) => b.textContent === t)!;
  const ouvrir = async () => { const n = onglet('Réseau'); assert.ok(n, 'l\'onglet « Réseau » est dans Genèse'); await n.emettre('click'); await calme(); };
  const clic = async (s: string) => { const n = q(s); assert.ok(n, `élément ${s}`); await n.emettre('click'); await calme(); await calme(); };
  const touche = async (s: string, key: string) => { const n = q(s); assert.ok(n, `élément ${s}`); await n.emettre('keydown', { key }); await calme(); };
  const saisir = async (s: string, val: string) => { const n = q(s)!; n.value = val; await n.emettre('input', { target: n }); };
  const tic = async () => { const l = [...minuteurs]; minuteurs.clear(); for (const [, f] of l) await f(); await calme(); };
  const pc = (mac: string) => (mod as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<unknown> } }).serveurSimule(v.ctx('thjalfi')).simuler('GET', `/menu.ipxe?mac=${mac}&fw=efi`, '10.10.0.100');
  const fin = () => { v.stop(); Object.assign(R.RESEAU, ORIGINE); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; };
  return { v, q, qa, onglet, ouvrir, clic, touche, saisir, tic, pc, appels, dialogues, ecoutes, box, fin, actif: () => actif, reglages: () => v.ctx('thjalfi').settings };
}
const ecrit = (P: Awaited<ReturnType<typeof page>>) => P.appels.filter((a) => !['reseau', 'tableau', 'systemes', 'postes_vus', 'profils_logiciels', 'isos'].includes(a.action));

test('S8 · page : l\'onglet « Réseau » est greffé dans Genèse ; à l\'ouverture, éteint, à côté de la box, le réseau de la maison pas touché', async () => {
  assert.ok(src('thjalfi-reseau.js'), 'src/web/pages/thjalfi-reseau.js existe');
  const P = await page();
  try {
    const noms = P.qa('[role="tab"]').map((b) => b.textContent);
    assert.ok(noms.includes('Réseau'), `onglets : ${noms.join(', ')}`);
    assert.ok(noms.indexOf('Réseau') > noms.indexOf('Odin te prévient') && noms.indexOf('Réseau') < noms.indexOf('Clé USB'), `ordre : ${noms.join(', ')}`);
    await P.ouvrir();
    assert.equal(P.onglet('Réseau').getAttribute('aria-selected'), 'true');
    assert.deepEqual(P.appels.map((a) => a.action).filter((a) => a === 'reseau').length, 1, 'une seule lecture à l\'ouverture');
    const sw = P.q('[data-f="interrupteur"]')!;
    assert.equal(sw.getAttribute('role'), 'switch'); assert.equal(sw.getAttribute('aria-checked'), 'false'); assert.equal(P.q('[data-f="etat"]')!.textContent, 'éteint');
    const cartes = P.qa('[data-carte]');
    assert.deepEqual(cartes.map((c) => c.getAttribute('data-carte')), ['Ethernet', 'Ethernet-2', 'Wi-Fi', '<img src=x onerror=alert(1)>']);
    assert.match(cartes[0].textContent, /conseillée/); assert.match(cartes[2].textContent, /déconseillée/); assert.match(cartes[3].textContent, /réseau à part/);
    assert.equal(cartes[3].querySelector('b')!.enfants[0].nodeType, 3, 'un nom de carte est écrit comme du texte, jamais comme du code');
    assert.equal(P.q('[data-dmode="proxy"]')!.getAttribute('aria-checked'), 'true');
    assert.match(P.q('[data-dmode="proxy"]')!.textContent, /Conseillé/);
    assert.match(P.q('[data-f="garde-ok"]')!.textContent, /Le réseau de la maison n'est pas touché/);
    assert.equal(P.q('[data-f="garde-refus"]'), null);
    assert.match(P.q('[data-f="rz-direct"]')!.textContent, /Aucun PC n'a demandé à démarrer/);
    assert.equal(ecrit(P).length, 0, 'ouvrir n\'écrit rien');
  } finally { P.fin(); }
});

test('S8 · page : « Odin distribue » sur la carte de la box → accord, puis REFUSÉ en rouge ; « Rester à côté de la box » revient au vert', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    await P.clic('[data-carte="Ethernet"]');
    assert.equal(P.reglages().carte, 'Ethernet');
    await P.clic('[data-dmode="complet"]');
    assert.equal(P.q('[data-dmode="complet"]')!.getAttribute('aria-checked'), 'true');
    assert.equal(ecrit(P).length, 1, 'choisir la carte : une demande ; choisir « Odin distribue » montre la plage, rien n\'est envoyé');
    assert.equal((P.q('[data-f="p-debut"]') as unknown as { value: string }).value, '192.168.1.100');
    await P.clic('[data-f="distribuer"]');
    assert.equal(P.dialogues.length, 1); assert.match(P.dialogues[0], /distribuer des adresses sur la carte Ethernet.*vérifie d'abord/);
    const r = P.q('[data-f="garde-refus"]')!;
    assert.ok(r, 'le garde-fou rouge'); assert.equal(r.getAttribute('role'), 'alert');
    assert.match(r.textContent, /Refusé : ça casserait le réseau de la maison/); assert.match(r.textContent, /192\.168\.1\.1/);
    assert.equal(P.q('[data-f="distribuer"]'), null, 'refusé : plus de bouton pour distribuer ici');
    assert.notEqual(P.reglages().mode, 'complet'); assert.equal(P.ecoutes.length, 0);
    await P.clic('[data-f="rester-box"]');
    assert.equal(P.reglages().mode, 'proxy');
    assert.equal(P.q('[data-dmode="proxy"]')!.getAttribute('aria-checked'), 'true');
    assert.match(P.q('[data-f="garde-ok"]')!.textContent, /pas touché/);
    // Une autre carte : la plage proposée suit la carte (jamais celle de la carte d'avant).
    await P.clic('[data-dmode="complet"]');
    assert.equal((P.q('[data-f="p-debut"]') as unknown as { value: string }).value, '192.168.1.100');
    await P.clic('[data-carte="Ethernet-2"]');
    assert.equal((P.q('[data-f="p-debut"]') as unknown as { value: string }).value, '10.10.0.100');
    assert.equal((P.q('[data-f="p-passerelle"]') as unknown as { value: string }).value, '10.10.0.1');
  } finally { P.fin(); }
});

test('S8 · page : un réseau à part libre → vert ; allumer demande ton accord et n\'écoute que la carte ; sans accord, rien', async () => {
  const P = await page({ accord: false });
  try {
    await P.ouvrir();
    await P.clic('[data-carte="Ethernet-2"]'); await P.clic('[data-dmode="complet"]');
    await P.saisir('[data-f="p-fin"]', '10.10.0.150');
    await P.clic('[data-f="distribuer"]');
    assert.equal(P.dialogues.length, 1); assert.notEqual(P.reglages().mode, 'complet', 'pas d\'accord : rien ne change');
    assert.match(P.q('[data-f="rz-msg"]')!.textContent, /Annulé/);
  } finally { P.fin(); }
  const Q = await page();
  try {
    await Q.ouvrir();
    await Q.clic('[data-carte="Ethernet-2"]'); await Q.clic('[data-dmode="complet"]');
    await Q.saisir('[data-f="p-fin"]', '10.10.0.150');
    await Q.clic('[data-f="distribuer"]');
    const env = Q.appels.filter((a) => a.action === 'mode' && a.confirm).pop()!;
    assert.deepEqual([env.input.mode, env.input.carte, env.input.debut, env.input.fin], ['complet', 'Ethernet-2', '10.10.0.100', '10.10.0.150']);
    assert.equal(Q.reglages().mode, 'complet');
    assert.match(Q.q('[data-f="garde-ok"]')!.textContent, /Aucun autre serveur d'adresses sur ce réseau à part/);
    await Q.clic('[data-f="interrupteur"]');
    assert.match(Q.dialogues.pop()!, /distribuer des adresses sur le réseau à part \(carte Ethernet-2, de 10\.10\.0\.100 à 10\.10\.0\.150\)/);
    assert.equal(Q.q('[data-f="interrupteur"]')!.getAttribute('aria-checked'), 'true'); assert.equal(Q.q('[data-f="etat"]')!.textContent, 'allumé');
    assert.deepEqual(Q.ecoutes, [{ host: '10.10.0.1' }], 'seulement la carte du réseau à part');
    assert.match(Q.q('[data-f="garde-ok"]')!.textContent, /revérifie toutes les minutes/);
    await Q.clic('[data-f="interrupteur"]');
    assert.equal(Q.q('[data-f="interrupteur"]')!.getAttribute('aria-checked'), 'false');
  } finally { Q.fin(); }
});

test('S8 · page : « Ma box s\'en charge » montre les lignes exactes (option 93) ; le Wi-Fi ne peut pas distribuer', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    await P.clic('[data-dmode="aucun"]');
    assert.equal(P.reglages().mode, 'aucun');
    assert.match(P.q('[data-f="rz-box"]')!.textContent, /Option 66/);
    assert.match(P.q('[data-f="box-dhcpd"]')!.textContent, /option arch = 7 or option arch = 9/);
    assert.match(P.q('[data-f="box-dnsmasq"]')!.textContent, /dhcp-match=set:efi64,option:client-arch,7/);
    await P.clic('[data-carte="Wi-Fi"]'); await P.clic('[data-dmode="complet"]');
    assert.match(P.q('[data-f="garde-refus"]')!.textContent, /Wi-Fi/);
    assert.equal(P.q('[data-f="distribuer"]'), null);
  } finally { P.fin(); }
});

test('S8 · page : PC autorisés (MAC vérifiée, retrait avec confirmation) et PC en direct (un inconnu → Autoriser)', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    await P.saisir('[data-f="mac"]', 'pas-une-mac'); await P.clic('[data-f="autoriser"]');
    assert.equal(P.q('[data-f="mac"]')!.getAttribute('aria-invalid'), 'true'); assert.match(P.q('[data-f="rz-msg"]')!.textContent, /Adresse MAC refusée/);
    assert.equal(ecrit(P).length, 0);
    await P.saisir('[data-f="mac"]', '52-54-00-3A-91-0C'); await P.clic('[data-f="autoriser"]');
    assert.deepEqual(ecrit(P).pop()!.input, { mac: '52:54:00:3a:91:0c' });
    assert.match(P.q('[data-f="autorises"]')!.textContent, /52:54:00:3a:91:0c/);
    await P.clic('[data-filtre="liste"]'); assert.equal(P.reglages().filtre, 'liste');
    assert.equal(P.q('[data-filtre="liste"]')!.getAttribute('aria-pressed'), 'true');
    // Un PC inconnu démarre par le réseau : il paraît en direct au tour suivant, avec « Autoriser ».
    await P.pc('52:54:00:9b:44:e1');
    await P.tic();
    const li = P.q('[data-autoriser="52:54:00:9b:44:e1"]');
    assert.ok(li, 'un inconnu en direct a son bouton « Autoriser »');
    assert.match(P.q('[data-f="rz-direct"]')!.textContent, /Inconnu.*52:54:00:9b:44:e1/);
    await P.clic('[data-autoriser="52:54:00:9b:44:e1"]');
    assert.ok((P.reglages().machines as Array<{ mac: string }>).some((r) => r.mac === '52:54:00:9b:44:e1'));
    // Retirer : une question d'abord, puis il ne démarre plus par le réseau d'Odin.
    await P.clic('[data-retirer="52:54:00:3a:91:0c"]');
    assert.match(P.dialogues.pop()!, /Retirer 52:54:00:3a:91:0c.*ne démarrera plus par le réseau d'Odin.*Rien n'est effacé/);
    assert.ok(!(P.reglages().machines as Array<{ mac: string }>).some((r) => r.mac === '52:54:00:3a:91:0c'));
  } finally { P.fin(); }
});

test('S8 · page : au clavier (flèches dans les cartes et les façons, le focus suit), cibles de 44 px, sans couleur en dur hors thème', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    const c0 = P.q('[data-carte="Ethernet"]')!;
    assert.equal(c0.getAttribute('tabindex'), '0'); assert.equal(P.q('[data-carte="Wi-Fi"]')!.getAttribute('tabindex'), '-1');
    await P.touche('[data-carte="Ethernet"]', 'ArrowRight');
    assert.equal(P.actif()?.getAttribute('data-carte'), 'Ethernet-2');
    await P.touche('[data-carte="Ethernet-2"]', 'End');
    assert.equal(P.actif()?.getAttribute('data-carte'), '<img src=x onerror=alert(1)>');
    await P.touche('[data-dmode="proxy"]', 'ArrowRight');
    assert.equal(P.actif()?.getAttribute('data-dmode'), 'complet');
    assert.equal(ecrit(P).length, 0, 'les flèches ne changent rien sur le serveur : Entrée ou un clic choisit');
    const css = src('thjalfi-reseau.js');
    assert.match(css, /min-height:44px/);
    assert.match(css, /prefers-reduced-motion/);
    const couleurs = (css.match(/#[0-9a-f]{3,6}\b/gi) ?? []).filter((x) => !/^#fff$/i.test(x) && !/^#b45309$/i.test(x));
    assert.deepEqual(couleurs, [], 'les couleurs viennent du thème d\'Odin (clair et sombre)');
  } finally { P.fin(); }
});

test('S8 relecture · page : après une coupure du garde-fou, rechoisir « Odin distribue » remontre la plage et le bouton (avec ton accord)', async () => {
  const P = await page();
  try {
    await P.ouvrir();
    await P.clic('[data-carte="Ethernet-2"]'); await P.clic('[data-dmode="complet"]'); await P.clic('[data-f="distribuer"]');
    await P.clic('[data-f="interrupteur"]'); assert.equal(P.ecoutes.length, 1);
    // La box apparaît sur la carte : la veille coupe.
    P.box.add('Ethernet-2');
    const m = P.v.modules().find((x) => x.id === 'thjalfi') as unknown as { watch: { run: (c: unknown) => Promise<void> } };
    await m.watch.run(P.v.ctx('thjalfi')); P.box.delete('Ethernet-2');
    // Le tour « en direct » suivant montre la coupure, sans attendre un geste.
    await P.tic();
    assert.match(P.q('[data-f="garde-refus"]')!.textContent, /arrêté de distribuer/);
    assert.equal(P.q('[data-f="distribuer"]'), null);
    await P.clic('[data-dmode="complet"]');
    assert.match(P.q('[data-f="garde-refus"]')!.textContent, /arrêté de distribuer/);
    assert.ok(P.q('[data-f="distribuer"]'), 'le bouton pour redistribuer (qui revérifie) est là');
    await P.clic('[data-f="distribuer"]');
    assert.equal(P.ecoutes.length, 2, 'revérifié, puis redistribué');
  } finally { P.fin(); }
});
