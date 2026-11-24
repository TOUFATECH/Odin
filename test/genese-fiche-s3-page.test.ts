// Genèse · Systèmes, lot S3 (la page) : « Détail » ouvre la fiche d'un système dans l'onglet (faits, « où il sert »,
// versions gardées) ; « Retirer » : un garde-fou dans la page qui nomme chaque usage, refuse tant qu'un déploiement ou une
// VM allumée s'en sert, et demande son nom tapé. La page de Genèse entière est montée dans un document minimal (le même
// que pour le lot S1) ; Hydre répond par des données fausses. Aucun réseau, aucun disque, rien d'écrit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as T from '../src/valhalla/modules/thjalfi.ts';

const X = T as unknown as Record<string, any>;
const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGES = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-cle-suivi.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle.js', 'thjalfi-suivi.js', 'thjalfi-systemes.js', 'thjalfi.js'];
const G = 1024 ** 3;
const ici = <V>(x: V): V => JSON.parse(JSON.stringify(x));
const NOW = Date.now();

// ------------------------------------------------------------------ données fausses (le serveur assemble pour de vrai)
const fiche = (nom: string, o: Record<string, unknown> = {}) => ({ id: nom, nom, chemin: `E:/ISO/${nom}`, taille: 5 * G, ajoute: 1, origine: 'andromede', antivirus: { at: 1, verdict: 'sain', texte: '' }, sha256: 'a'.repeat(64), editeur: true, ...o });
const FICHES = [
  fiche('ubuntu-24.04.1-desktop-amd64.iso', { systeme: 'Linux', detail: 'Ubuntu 24.04.1', version: '24.04.1', edition: 'bureau', taille: 5.8 * G }),
  fiche('Win11_24H2_French_x64.iso', { systeme: 'Windows', detail: 'Windows 11 24H2', edition: 'Pro', taille: 5.4 * G }),
  fiche('ubuntu-24.04.1-live-server-amd64.iso', { systeme: 'Linux', detail: 'Ubuntu Server 24.04.1', edition: 'serveur', taille: 2.6 * G }),
  fiche('Fedora-Workstation-Live-x86_64-41.iso', { systeme: 'Linux', detail: 'Fedora Workstation 41', antivirus: { at: 1, verdict: 'non analysé', texte: '' }, taille: 2.2 * G }),
  fiche('gparted-live-1.6.0-amd64.iso', { systeme: 'Autre', detail: 'GParted Live 1.6.0', editeur: false, taille: 0.6 * G }),
];
const IMAGES = [
  { id: 'ubuntu', chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', demarre: true, prete: true },
  { id: 'win11', chemin: 'E:/ISO/Win11_24H2_French_x64.iso', demarre: true, prete: true },
  { id: 'ubuntu-server', chemin: 'E:/ISO/ubuntu-24.04.1-live-server-amd64.iso', demarre: true, prete: true },
  { id: 'gparted', chemin: 'E:/ISO/gparted-live-1.6.0-amd64.iso', demarre: false, prete: true },
];
const SURV = [{ id: 'debian', nom: 'Debian', derniere: '12.8.0', enCours: { recu: 2.3 * G, total: 3.7 * G, pct: 62 } }, { id: 'linux-mint', nom: 'Linux Mint', derniere: '22' }];
const jour = new Date(NOW - 3600_000), hh = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
const HIST = `- ${hh(jour)} · empreinte fausse · Linux Mint 22 · l'empreinte ne correspond pas`;
const SYSTEMES = () => ({ ok: true, text: 'x', data: { ...X.assemblerSystemes({ fiches: FICHES, images: IMAGES, disponibles: [{ chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', etat: 'nouvelle version', derniere: '24.04.2', source: 'ubuntu-desktop' }], surveilles: SURV, historique: HIST, place: { total: 1024 * G }, now: NOW }), dossier: 'E:/ISO', lu: { bibliotheque: true, telechargements: true } } });
// Ce que la clé USB lit (étapes 1 à 3) : une clé de 64 Go, et les mêmes images démarrables.
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const ISOS = [
  { id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64', path: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', size: 5.8 * G, mtime: 1, recipe: { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' } },
  { id: 'win11', name: 'Win11_24H2_French_x64', path: 'E:/ISO/Win11_24H2_French_x64.iso', size: 5.4 * G, mtime: 1, recipe: { kind: 'windows', label: 'Windows', auto: true, os: 'windows' } },
];

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
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else if (k === 'value') this.value = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, x: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...x };
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
const calme = async () => { for (let k = 0; k < 15; k++) await new Promise((ok) => setTimeout(ok, 4)); };

/** La page de Genèse montée, ses demandes notées. */
async function page(o: { minuteurs?: boolean; isos?: () => unknown[]; repondre?: (module: string, action: string, input: Record<string, unknown>) => unknown; confirmer?: boolean } = {}) {
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ module: string; action: string; input: Record<string, unknown> }> = [];
  const repondre = (module: string, action: string, input: Record<string, unknown> = {}): unknown => {
    const autre = o.repondre?.(module, action, input); if (autre !== undefined) return autre;
    if (module !== 'thjalfi') return { ok: false, text: 'refusé par l\'essai' };
    if (action === 'systemes') return SYSTEMES();
    if (action === 'tableau') return { ok: true, data: {} };
    if (action === 'cle_disques') return { ok: true, data: { externes: [ici(CLE64)], internes: [] } };
    if (action === 'isos') return { ok: true, data: ici(o.isos ? o.isos() : ISOS) };
    if (action === 'cle_vms') return { ok: true, data: [] };
    if (action === 'cle_place') return { ok: true, data: { possible: true, autresGo: 0 } };
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const fetch = async (_u: string, o: { body: string }) => { const b = JSON.parse(o.body); appels.push({ module: b.module, action: b.action, input: b.input }); return { json: async () => ici(repondre(b.module, b.action, b.input)) }; };
  const dialogues: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return o.confirmer === true; }, alert: async (t: string) => { dialogues.push(t); }, prompt: async () => null } };
  const location = { hash: '' };
  // Les minuteurs notés (o.minuteurs) : l'essai les déclenche lui-même.
  const minuteurs = new Map<number, () => unknown>(); let nm = 0;
  const poser = (f: () => unknown) => { if (!o.minuteurs) return 0; minuteurs.set(++nm, f); return nm; };
  const ctx = { window, document, location, Node: Noeud, Intl, Date, setInterval: () => 0, clearInterval: () => {}, setTimeout: (f: () => unknown) => poser(f), clearTimeout: (i: number) => { minuteurs.delete(i); }, fetch, createImageBitmap: undefined };
  for (const js of PAGES.map(src)) if (js) vm.runInNewContext(js, ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.thjalfi({ host, generic: [] });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const onglet = (t: string) => qa('[role="tab"]').find((b) => b.textContent === t)!;
  const ouvrir = async () => { const o = onglet('Systèmes'); assert.ok(o, 'l\'onglet « Systèmes » est dans Genèse'); await o.emettre('click'); await calme(); };
  const carte = (re: RegExp) => qa('[data-carte]').find((c) => re.test(c.querySelector('b')!.textContent))!;
  const visibles = () => qa('[data-carte]').map((c) => c.querySelector('b')!.textContent);
  const tic = async () => { const l = [...minuteurs]; minuteurs.clear(); for (const [, f] of l) await f(); await calme(); };
  return { corps, q, qa, onglet, ouvrir, carte, visibles, appels, dialogues, window, location, document, minuteurs, tic, actif: () => actif };
}

// ------------------------------------------------------------------ lot S3 : la fiche, « où il sert », retirer
const CHEMIN = 'e:/iso/ubuntu-24.04.1-desktop-amd64.iso';
const USAGES = (o: Record<string, unknown> = {}) => ({ chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', nom: 'ubuntu-24.04.1-desktop-amd64.iso', taille: 5.8 * G, aTaper: 'Ubuntu 24.04.1',
  genese: { id: 'ubuntu', auto: true, label: 'Ubuntu' }, lu: { genese: true, cles: true, vms: true }, bloquants: [],
  usages: [
    { genre: 'cle', nom: 'usb-Kingston-64', bloque: false, at: new Date(2026, 10, 12).getTime() },
    { genre: 'menu', nom: 'Ubuntu 24.04.1', bloque: false, position: 1, defaut: true },
    { genre: 'pc', nom: 'PC-01', mac: '52:54:00:aa:bb:01', bloque: false, auto: true },
    { genre: 'vm', nom: 'vm-ubuntu-1', bloque: false },
  ], ...o });
const FICHE = () => ({ ...FICHES[0], arch: 'x86_64', efi: true, ajoute: new Date(2026, 10, 12).getTime(), source: 'https://releases.ubuntu.com/24.04.1/ubuntu-24.04.1-desktop-amd64.iso', antivirus: { at: new Date(2026, 10, 12).getTime(), verdict: 'sain', texte: '' },
  versions: [{ nom: 'ubuntu-24.04.1-desktop-amd64.iso', chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', taille: 5.8 * G, version: '24.04.1', ancienne: false, enService: true }, { nom: 'ubuntu-22.04.5-desktop-amd64.iso', chemin: 'E:/ISO/old/ubuntu-22.04.5-desktop-amd64.iso', taille: 4.7 * G, version: '22.04.5', ancienne: true, enService: false }],
  nouvelle: { version: '24.04.2', source: 'ubuntu-desktop' }, surveille: true });
/** Hydre répond : « où il sert », la fiche, et le retrait (noté, avec sa confirmation). */
function hydre(o: { usages?: () => unknown; retrait?: (i: Record<string, unknown>) => unknown } = {}) {
  const retraits: Array<Record<string, unknown>> = [];
  const repondre = (module: string, action: string, input: Record<string, unknown>) => {
    if (module !== 'ymir') return undefined;
    if (action === 'iso_usages') return { ok: true, text: 'x', data: o.usages ? o.usages() : USAGES() };
    if (action === 'fiche_iso') return { ok: true, text: 'x', data: FICHE() };
    if (action === 'retirer_systeme') { retraits.push(input); return o.retrait ? o.retrait(input) : { ok: true, text: '🗑 ubuntu-24.04.1-desktop-amd64.iso retirée de la bibliothèque (5,8 Go libérés).' }; }
    return undefined;
  };
  return { repondre, retraits };
}
const ouvrirFiche = async (P: Awaited<ReturnType<typeof page>>) => {
  await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="detail"]')!.emettre('click'); await calme();
};

test('S3 · page : « Détail » ouvre la fiche dans l\'onglet — faits, où il sert, versions gardées ; seules deux lectures partent', async () => {
  const H = hydre(), P = await page({ repondre: H.repondre });
  await ouvrirFiche(P);
  assert.equal(P.q('[data-f="vue-biblio"]')!.hidden, true, 'la bibliothèque est derrière');
  assert.equal(P.q('[data-f="vue-detail"]')!.hidden, false);
  const f = P.q('[data-f="fiche"]')!;
  assert.equal(f.querySelector('h4')!.textContent, 'Ubuntu 24.04.1');
  const faits = P.q('[data-f="d-faits"]')!.textContent;
  for (const re of [/Fichierubuntu-24\.04\.1-desktop-amd64\.iso/, /ArchitecturePC 64 bits \(x86_64\)/, /Démarrage UEFIOui/, /S'installe tout seulOui : compte, langue, clavier, logiciels/,
    /Empreinteaaaa aaaa … aaaa aaaa · identique à l'éditeur/, /AntivirusPropre · le 12 novembre 2026/, /Arrivé.*site officiel de l'éditeur \(releases\.ubuntu\.com\)/, /Gardé à jourOui : Andromède le surveille/]) assert.match(faits, re);
  const u = P.q('[data-f="d-usages"]')!;
  assert.deepEqual(u.querySelectorAll('[data-usage]').map((x) => x.getAttribute('data-usage')), ['cle', 'menu', 'pc', 'vm']);
  assert.match(u.textContent, /Clé ODIN usb-Kingston-64Copié dessus le 12 novembre 2026/);
  assert.match(u.textContent, /Menu du démarrage par le réseauEntrée 1, système par défaut/);
  assert.match(u.textContent, /PC PC-01Installation automatique prévue · 52:54:00:aa:bb:01/);
  assert.match(u.textContent, /Machine virtuelle vm-ubuntu-1Installée depuis cette ISO/);
  const v = P.q('[data-f="d-versions"]')!;
  assert.deepEqual(v.querySelectorAll('[data-version]').map((x) => x.getAttribute('data-version')), ['24.04.1', '22.04.5', '24.04.2']);
  assert.match(v.textContent, /En service · 5,8\s*Go/); assert.match(v.textContent, /Dans « old » · 4,7\s*Go/); assert.match(v.textContent, /Disponible chez l'éditeur/);
  // Seulement des lectures : « où il sert » (par son chemin) puis la fiche.
  const ymir = P.appels.filter((a) => a.module === 'ymir');
  assert.deepEqual(ymir, [{ module: 'ymir', action: 'iso_usages', input: { iso: CHEMIN } }, { module: 'ymir', action: 'fiche_iso', input: { iso: 'ubuntu-24.04.1-desktop-amd64.iso' } }]);
  assert.equal(H.retraits.length, 0);
  // « Ma bibliothèque » : la bibliothèque revient, le focus sur le « Détail » de la carte.
  await P.q('[data-f="d-retour"]')!.emettre('click'); await calme();
  assert.equal(P.q('[data-f="vue-biblio"]')!.hidden, false); assert.equal(P.q('[data-f="vue-detail"]')!.hidden, true);
  assert.equal(P.actif()?.getAttribute('data-f'), 'detail');
});

test('S3 · page : « Retirer » — le garde-fou nomme chaque usage ; le bouton reste éteint tant que le nom tapé n\'est pas le bon', async () => {
  const H = hydre(), P = await page({ repondre: H.repondre });
  await ouvrirFiche(P);
  const retirer = P.q('[data-f="d-retirer"]')!;
  assert.equal(retirer.getAttribute('aria-expanded'), 'false');
  await retirer.emettre('click'); await calme();
  assert.equal(P.q('[data-f="d-retirer"]')!.getAttribute('aria-expanded'), 'true');
  const g = P.q('[data-f="d-garde"]')!;
  assert.match(g.textContent, /Retirer Ubuntu 24\.04\.1 de la bibliothèque \?/);
  const lignes = g.querySelectorAll('li').map((x) => x.textContent);
  assert.deepEqual(lignes, [
    'Le fichier (5,8 Go) est effacé du dossier des ISO, et rien d\'autre.',
    'La clé ODIN usb-Kingston-64 garde sa copie.',
    'Le menu du démarrage par le réseau perd cette entrée ; par défaut, ce sera le disque du PC.',
    'PC-01 retombe sur le menu normal : rien ne s\'installe tout seul.',
    'La machine virtuelle vm-ubuntu-1 garde son disque.',
    'Tu pourras le retélécharger depuis le catalogue.',
  ]);
  assert.equal(P.actif()?.getAttribute('data-f'), 'd-nom', 'le focus va au champ du nom');
  const champ = P.q('[data-f="d-nom"]')!, ok = () => P.q('[data-f="d-confirmer"]')!;
  assert.equal(champ.getAttribute('aria-label'), 'Tape « Ubuntu 24.04.1 » pour confirmer');
  assert.equal(ok().disabled, true);
  champ.value = 'Ubuntu 24.04'; await champ.emettre('input'); assert.equal(ok().disabled, true, 'presque : non');
  // Cliquer quand même (bouton éteint) : rien ne part.
  await ok().emettre('click'); await calme(); assert.equal(H.retraits.length, 0);
  champ.value = '  ubuntu 24.04.1 '; await champ.emettre('input'); assert.equal(ok().disabled, false, 'sans majuscules ni espaces en trop : oui');
  await ok().emettre('click'); await calme();
  assert.deepEqual(H.retraits, [{ iso: CHEMIN, nom: '  ubuntu 24.04.1 ' }], 'le nom tapé part tel quel : le serveur le revérifie');
  const envoi = P.appels.find((a) => a.action === 'retirer_systeme')!;
  assert.ok(envoi);
  // Fait : retour à la bibliothèque, relue, avec ce qu'Hydre a dit.
  assert.equal(P.q('[data-f="vue-biblio"]')!.hidden, false);
  assert.match(P.q('[data-f="vue-biblio"] .sy-msg')!.textContent, /retirée de la bibliothèque/);
});

test('S3 · page : un usage qui bloque (déploiement, VM allumée) — pas de champ, pas de bouton rouge ; « Garder » et Échap referment', async () => {
  const H = hydre({ usages: () => USAGES({ bloquants: ['un déploiement par le réseau est en cours sur 1 PC (PC-02) : attends la fin ou annule-le dans Suivi'], usages: [{ genre: 'deploiement', nom: 'Ubuntu', bloque: true, pcs: ['PC-02'] }] }) });
  const P = await page({ repondre: H.repondre });
  await ouvrirFiche(P);
  const dep = P.q('[data-usage="deploiement"]')!;
  assert.match(dep.textContent, /Déploiement en coursSur 1 PC : PC-02/); assert.match(dep.textContent, /empêche de retirer/);
  await P.q('[data-f="d-retirer"]')!.emettre('click'); await calme();
  const g = P.q('[data-f="d-garde"]')!;
  assert.equal(g.getAttribute('data-bloque'), '1');
  assert.match(g.textContent, /Impossible de retirer Ubuntu 24\.04\.1 pour l'instant/); assert.match(g.textContent, /PC-02.*Suivi/);
  assert.equal(P.q('[data-f="d-nom"]'), null); assert.equal(P.q('[data-f="d-confirmer"]'), null);
  assert.equal(P.actif()?.getAttribute('data-f'), 'd-garder');
  await P.q('[data-f="d-garder"]')!.emettre('click'); await calme();
  assert.equal(P.q('[data-f="d-garde"]'), null); assert.equal(P.actif()?.getAttribute('data-f'), 'd-retirer');
  await P.q('[data-f="d-retirer"]')!.emettre('click'); await calme();
  await P.q('[data-f="d-garde"]')!.emettre('keydown', { key: 'Escape' }); await calme();
  assert.equal(P.q('[data-f="d-garde"]'), null, 'Échap referme'); assert.equal(P.actif()?.getAttribute('data-f'), 'd-retirer');
  assert.equal(H.retraits.length, 0);
});

test('S3 · page : refusé par le serveur (un déploiement vient de commencer) — dit tel quel, « où il sert » relu, rien d\'effacé', async () => {
  let n = 0;
  const H = hydre({ usages: () => (++n > 2 ? USAGES({ bloquants: ['un déploiement par le réseau est en cours sur 1 PC (PC-08) : attends la fin ou annule-le dans Suivi'] }) : USAGES()), retrait: () => ({ ok: false, text: 'Refusé, rien n\'est effacé : un déploiement par le réseau est en cours sur 1 PC (PC-08).' }) });
  const P = await page({ repondre: H.repondre });
  await ouvrirFiche(P);
  await P.q('[data-f="d-retirer"]')!.emettre('click'); await calme();
  const champ = P.q('[data-f="d-nom"]')!; champ.value = 'Ubuntu 24.04.1'; await champ.emettre('input');
  await champ.emettre('keydown', { key: 'Enter' }); await calme();
  assert.equal(H.retraits.length, 1, 'Entrée confirme');
  assert.equal(P.q('[data-f="vue-detail"]')!.hidden, false, 'la fiche reste');
  const g = P.q('[data-f="d-garde"]')!;
  assert.equal(g.getAttribute('data-bloque'), '1', '« où il sert » relu : maintenant bloqué');
  assert.match(g.textContent, /PC-08/);
});

test('S3 · page : logique pure — empreinte courte, nom tapé, lignes du garde-fou', async () => {
  const P = await page();
  const L = P.window.OdinGeneseSystemes.logique;
  assert.equal(L.empreinteCourte('3f9a51c0' + '0'.repeat(48) + '8d2ec21e'), '3f9a 51c0 … 8d2e c21e');
  assert.equal(L.empreinteCourte('pas une empreinte'), '');
  assert.ok(L.nomJuste(' windows  11 24h2', 'Windows 11 24H2')); assert.ok(!L.nomJuste('', '')); assert.ok(!L.nomJuste('Windows 11', 'Windows 11 24H2'));
  assert.deepEqual(ici(L.phrasesRetrait({ usages: [{ genre: 'vm', nom: 'a', bloque: true }, { genre: 'menu', defaut: false }], lu: { cles: false } })), ['Le menu du démarrage par le réseau perd cette entrée.', 'Une clé ODIN où il a été copié garde sa copie.']);
  // Aucun mot écrit en dur hors de MOTS pour la fiche.
  for (const k of ['r.titre', 'r.ok', 'r.garder', 'u.titre', 'v.titre', 'd.f.empreinte']) assert.ok(L.MOTS[k], k);
});
