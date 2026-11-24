// Genèse · Déployer, lot S5 (la page) : l'onglet « Déployer » de Genèse — la barre des étapes au clavier, « Vers quoi »,
// le pont vers « Clés USB · Déployer » (système, façon et profil déjà choisis), les PC vus en direct (source simulée),
// plusieurs à la fois, PC bloqué grisé, le prochain PC, l'ajout par adresse MAC, le garde-fou qui nomme chaque PC dont le
// disque sera effacé, la machine virtuelle (ou « bientôt »), le système depuis la bibliothèque. Rien n'est écrit : seules
// des lectures partent. La page de Genèse entière est montée dans un document minimal ; les réponses viennent du VRAI
// assembleur du serveur (postesVus, assemblerSystemes) sur des données fausses. Aucun réseau, aucun disque.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as T from '../src/valhalla/modules/thjalfi.ts';

const X = T as unknown as Record<string, any>;
const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGES = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-cle-suivi.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle.js', 'thjalfi-deployer.js', 'thjalfi-logiciels.js', 'thjalfi-suivi.js', 'thjalfi-systemes.js', 'thjalfi.js'];
const G = 1024 ** 3;
const ici = <V>(x: V): V => JSON.parse(JSON.stringify(x));
const NOW = Date.now();

// ------------------------------------------------------------------ données fausses (le serveur assemble pour de vrai)
const fiche = (nom: string, o: Record<string, unknown> = {}) => ({ id: nom, nom, chemin: `E:/ISO/${nom}`, taille: 5 * G, ajoute: 1, origine: 'andromede', antivirus: { at: 1, verdict: 'sain', texte: '' }, sha256: 'a'.repeat(64), editeur: true, ...o });
const FICHES = [
  fiche('ubuntu-24.04.1-desktop-amd64.iso', { systeme: 'Linux', detail: 'Ubuntu 24.04.1', version: '24.04.1', edition: 'bureau', taille: 5.8 * G }),
  fiche('Win11_24H2_French_x64.iso', { systeme: 'Windows', detail: 'Windows 11 24H2', edition: 'Pro', taille: 5.4 * G }),
  fiche('Fedora-Workstation-Live-x86_64-41.iso', { systeme: 'Linux', detail: 'Fedora Workstation 41', antivirus: { at: 1, verdict: 'non analysé', texte: '' }, taille: 2.2 * G }),
  fiche('gparted-live-1.6.0-amd64.iso', { systeme: 'Autre', detail: 'GParted Live 1.6.0', editeur: false, taille: 0.6 * G }),
];
const IMAGES = [
  { id: 'ubuntu', chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', demarre: true, prete: true, auto: true },
  { id: 'win11', chemin: 'E:/ISO/Win11_24H2_French_x64.iso', demarre: true, prete: true, auto: true },
  { id: 'gparted', chemin: 'E:/ISO/gparted-live-1.6.0-amd64.iso', demarre: true, prete: true },
];
const SURV = [{ id: 'debian', nom: 'Debian', derniere: '12.8.0', enCours: { recu: 2.3 * G, total: 3.7 * G, pct: 63 } }];
const SYSTEMES = () => ({ ok: true, text: 'x', data: { ...X.assemblerSystemes({ fiches: FICHES, images: IMAGES, disponibles: [], surveilles: SURV, historique: '', place: { total: 1024 * G }, now: NOW }), dossier: 'E:/ISO', lu: { bibliotheque: true, telechargements: true } } });
const ISOS = [
  { id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64', path: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', size: 5.8 * G, mtime: 1, recipe: { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' } },
  { id: 'win11', name: 'Win11_24H2_French_x64', path: 'E:/ISO/Win11_24H2_French_x64.iso', size: 5.4 * G, mtime: 1, recipe: { kind: 'windows', label: 'Windows', auto: true, os: 'windows' } },
];
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const PROFILS = [{ id: 'p-std', nom: 'Standard', systemes: { windows: { logiciels: [], scripts: [] }, debian: { logiciels: [], scripts: [] }, fedora: { logiciels: [], scripts: [] } } }, { id: 'p-bur', nom: 'Bureau', systemes: { windows: { logiciels: [], scripts: [] }, debian: { logiciels: [], scripts: [] }, fedora: { logiciels: [], scripts: [] } } }];
// Ce que le serveur de démarrage sait (une source simulée que l'essai change pour voir le « en direct »).
const sourceDepart = () => ({
  live: {
    '52:54:00:3a:91:0c': { mac: '52:54:00:3a:91:0c', fw: 'uefi', step: 'menu', updated: NOW - 5000, started: NOW - 9000, steps: [], marque: 'Mini', modele: 'PC 8 Go' },
    '52:54:00:7e:12:a4': { mac: '52:54:00:7e:12:a4', fw: 'uefi', step: 'menu', updated: NOW - 4 * 60_000, started: NOW - 5 * 60_000, steps: [], host: '<img src=x onerror=alert(1)>' },
  },
  historique: [{ at: NOW - 2 * 3600_000, mac: '52:54:00:c1:5b:77', host: 'Portable-03', isoName: 'ubuntu-22.04', result: 'fini', ms: 1, fw: 'bios' }],
  regles: [{ mac: '52:54:00:08:e2:3d', nom: 'PC-04', auto: false, ajoute: 1 }],
  bloques: { '52:54:00:08:e2:3d': { at: NOW - 3600_000 } },
});
let SOURCE = sourceDepart();
const POSTES = (vmDispo = true) => ({ ok: true, text: 'x', data: { allume: true, mode: 'proxy', postes: X.postesVus({ ...SOURCE, now: NOW }), vm: vmDispo } });

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

const LECTURES = new Set(['thjalfi.tableau', 'thjalfi.systemes', 'thjalfi.postes_vus', 'thjalfi.profils_logiciels', 'thjalfi.isos', 'thjalfi.cle_disques', 'thjalfi.cle_vms', 'thjalfi.cle_place', 'thjalfi.cle_logiciels', 'thjalfi.cle_apercu_script', 'thjalfi.deployer_apercu', 'thjalfi.preparation_dite']);

/** La page de Genèse montée, ses demandes notées. */
async function page(o: { vm?: boolean; postesKo?: boolean } = {}) {
  SOURCE = sourceDepart();
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ module: string; action: string; input: Record<string, unknown> }> = [];
  let ko = Boolean(o.postesKo);
  const repondre = (module: string, action: string): unknown => {
    if (module !== 'thjalfi') return { ok: false, text: 'refusé par l\'essai' };
    if (action === 'systemes') return SYSTEMES();
    if (action === 'postes_vus') return ko ? { ok: false, text: 'Réservé au propriétaire.' } : POSTES(o.vm !== false);
    if (action === 'profils_logiciels') return { ok: true, data: { profils: PROFILS, abimes: 0 } };
    if (action === 'tableau') return { ok: true, data: {} };
    if (action === 'cle_disques') return { ok: true, data: { externes: [ici(CLE64)], internes: [] } };
    if (action === 'isos') return { ok: true, data: ici(ISOS) };
    if (action === 'cle_vms') return { ok: true, data: [] };
    if (action === 'cle_place') return { ok: true, data: { possible: true, autresGo: 0 } };
    if (action === 'cle_logiciels') return { ok: true, data: { logiciels: [] } };
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ module: b.module, action: b.action, input: b.input }); return { json: async () => ici(repondre(b.module, b.action)) }; };
  const dialogues: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return false; }, alert: async (t: string) => { dialogues.push(t); }, prompt: async () => null } };
  const location = { hash: '' };
  const minuteurs = new Map<number, () => unknown>(); let nm = 0;
  const ctx = { window, document, location, Node: Noeud, Intl, Date, setInterval: () => 0, clearInterval: () => {}, setTimeout: (f: () => unknown) => { minuteurs.set(++nm, f); return nm; }, clearTimeout: (i: number) => { minuteurs.delete(i); }, fetch, createImageBitmap: undefined };
  for (const js of PAGES.map(src)) if (js) vm.runInNewContext(js, ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.thjalfi({ host, generic: [] });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const onglet = (t: string) => qa('[role="tab"]').find((b) => b.textContent === t)!;
  const ouvrir = async () => { const n = onglet('Déployer'); assert.ok(n, 'l\'onglet « Déployer » est dans Genèse'); await n.emettre('click'); await calme(); };
  const clic = async (s: string) => { const n = q(s); assert.ok(n, `élément ${s}`); await n.emettre('click'); await calme(); };
  const touche = async (s: string, key: string) => { const n = q(s); assert.ok(n, `élément ${s}`); await n.emettre('keydown', { key }); await calme(); };
  const etape = (n: number) => q(`[data-dp-etape="${n}"]`)!;
  /** Les minuteurs « en direct » : l'essai les déclenche lui-même. */
  const tic = async () => { const l = [...minuteurs]; minuteurs.clear(); for (const [, f] of l) await f(); await calme(); };
  return { corps, q, qa, onglet, ouvrir, clic, touche, etape, appels, dialogues, window, tic, actif: () => actif, nbMinuteurs: () => minuteurs.size, minuteurs, panne: (v: boolean) => { ko = v; } };
}
type Page = Awaited<ReturnType<typeof page>>;
/** Par le réseau jusqu'à l'étape « Postes ». */
async function versPostes(P: Page) { await P.ouvrir(); await P.clic('[data-cible="reseau"]'); await P.clic('[data-f="continuer"]'); assert.equal(P.etape(2).getAttribute('aria-current'), 'step'); }

test('S5 · page : l\'onglet « Déployer » est greffé après Logiciels, avec la barre des 6 étapes', async () => {
  assert.ok(src('thjalfi-deployer.js'), 'src/web/pages/thjalfi-deployer.js existe');
  const P = await page();
  const noms = P.qa('[role="tab"]').map((b) => b.textContent);
  assert.ok(noms.indexOf('Déployer') === noms.indexOf('Logiciels') + 1, `ordre des onglets : ${noms.join(', ')}`);
  for (const t of ['Systèmes', 'Logiciels', 'Odin te prévient', 'Clé USB', 'Tout']) assert.ok(P.onglet(t), `onglet « ${t} » toujours là`);
  await P.ouvrir();
  assert.equal(P.onglet('Déployer').getAttribute('aria-selected'), 'true');
  const barre = P.q('[data-f="dp-etapes"]')!;
  assert.equal(barre.querySelectorAll('button').length, 6);
  assert.deepEqual(barre.querySelectorAll('b').map((b) => b.textContent), ['Vers quoi', 'Postes', 'Système', 'Logiciels', 'Windows', 'Vérifier']);
  assert.equal(P.etape(1).getAttribute('aria-current'), 'step');
  assert.equal(P.etape(3).disabled, true, 'pas de PC : l\'étape Système est fermée');
});

test('S5 · page : étapes au clavier (flèches, Début, Fin ; une étape fermée est sautée) et « Vers quoi » au clavier', async () => {
  const P = await page(); await P.ouvrir();
  await P.touche('[data-dp-etape="1"]', 'ArrowRight');
  assert.equal(P.actif()?.getAttribute('data-dp-etape'), '2', 'flèche droite : étape 2');
  await P.touche('[data-dp-etape="2"]', 'ArrowRight');
  assert.equal(P.actif()?.getAttribute('data-dp-etape'), '1', 'les étapes 3 à 6 sont fermées : on revient à la 1');
  await P.touche('[data-dp-etape="1"]', 'End');
  assert.equal(P.actif()?.getAttribute('data-dp-etape'), '2', 'Fin : la dernière ouverte');
  await P.touche('[data-dp-etape="2"]', 'Home');
  assert.equal(P.actif()?.getAttribute('data-dp-etape'), '1');
  // « Vers quoi » : un groupe de boutons radio ; la flèche change le choix, le focus suit.
  assert.equal(P.q('[data-cible="reseau"]')!.getAttribute('aria-checked'), 'true', 'par le réseau choisi au départ (conseillé)');
  assert.equal(P.q('[data-cible="reseau"]')!.getAttribute('tabindex'), '0');
  await P.touche('[data-cible="reseau"]', 'ArrowRight');
  assert.equal(P.q('[data-cible="vm"]')!.getAttribute('aria-checked'), 'true');
  assert.equal(P.actif()?.getAttribute('data-cible'), 'vm');
  assert.equal(P.etape(2).querySelector('b')!.textContent, 'Machine', 'machine virtuelle : l\'étape 2 devient « Machine »');
  await P.touche('[data-cible="vm"]', 'ArrowRight');
  assert.equal(P.q('[data-cible="cle"]')!.getAttribute('aria-checked'), 'true', 'après la dernière, la première');
});

test('S5 · page : « Vers quoi » — trois cartes ; une clé USB ou un disque ferme les étapes suivantes et montre les façons et le pont', async () => {
  const P = await page(); await P.ouvrir();
  assert.equal(P.qa('[role="radiogroup"] [data-cible]').length, 3);
  assert.match(P.q('[data-cible="reseau"]')!.textContent, /Conseillé pour plusieurs PC/);
  assert.match(P.q('[data-cible="cle"]')!.textContent, /Disques internes jamais proposés/);
  assert.match(P.q('[data-cible="vm"]')!.textContent, /Rien n'est effacé/);
  await P.clic('[data-cible="cle"]');
  for (let n = 2; n <= 6; n++) { assert.equal(P.etape(n).disabled, true, `étape ${n} fermée`); assert.match(String(P.etape(n).getAttribute('title')), /Clés USB/); }
  assert.deepEqual(P.qa('[data-cle-facon]').map((b) => b.getAttribute('data-cle-facon')), ['iso', 'double', 'vm']);
  assert.ok(P.q('[data-f="pont"]'), 'le pont');
  assert.ok(P.q('[data-f="pont-pied"]'), 'Ouvrir Clés USB');
  assert.match(P.q('[data-f="pont-texte"]')!.textContent, /profil « Standard »/, 'le premier profil proposé');
  assert.equal(P.q('[data-f="continuer"]'), null, 'pas de « Continuer » vers l\'étape 2');
});

test('S5 · page : le pont ouvre « Clés USB · Déployer » avec le système, la façon et le profil déjà choisis', async () => {
  const P = await page(); await P.ouvrir();
  // Le système choisi d'abord (étape 3, par la machine virtuelle), puis retour à « Vers quoi ».
  await P.clic('[data-cible="vm"]'); await P.clic('[data-f="continuer"]'); await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(3).getAttribute('aria-current'), 'step');
  const ubuntu = P.qa('[data-sys]').find((b) => /^Ubuntu 24\.04\.1$/.test(b.querySelector('b')!.textContent))!;
  await ubuntu.emettre('click'); await calme();
  await P.clic('[data-dp-etape="1"]');
  await P.clic('[data-cible="cle"]');
  assert.match(P.q('h4')!.textContent, /Où déployer Ubuntu 24\.04\.1 \?/);
  await P.clic('[data-cle-facon="double"]');
  await P.clic('[data-profil="p-bur"]');
  assert.match(P.q('[data-f="pont-texte"]')!.textContent, /Ubuntu 24\.04\.1 y sera déjà coché à l'étape Systèmes, en « Installé », avec les logiciels du profil « Bureau »/);
  // Une partie de partirDuProfil est remplacée par un espion : le profil doit lui être donné à l'étape 4 de la clé.
  const LOG = P.window.OdinGeneseCleLogiciels, pris: string[] = [];
  LOG.partirDuProfil = async (p: { id: string }) => { pris.push(p.id); };
  await P.clic('[data-f="pont"]');
  assert.equal(P.onglet('Clé USB').getAttribute('aria-selected'), 'true', 'l\'onglet « Clé USB » est ouvert');
  const E = P.window.OdinGeneseCleSystemes.etat;
  assert.equal(E.facon, 'installes', 'double démarrage = systèmes installés sur la clé');
  assert.deepEqual(ici(E.choisis['iso:ubuntu']), { choix: 'installe', main: false }, 'Ubuntu coché, installé');
  assert.equal(P.window.OdinGeneseCleEtapes.etat.onglet, 'deployer');
  assert.equal(P.window.OdinGeneseCleEtapes.etat.etape, 1, 'pas de clé choisie : on commence par la clé');
  // L'étape 4 de la clé s'affiche : le profil « Bureau » est repris, une seule fois.
  const outils = { cle: CLE64, sorte: 'cle', post: async () => ({ ok: false, text: 'essai' }), redessiner() {}, pied: () => new Noeud('div'), wrap: new Noeud('div') };
  LOG.rendre(4, outils); await calme();
  LOG.rendre(4, outils); await calme();
  assert.deepEqual(pris, ['p-bur'], 'profil repris à l\'étape 4, une fois');
  // « ISO qui démarre » et « Machines virtuelles » : la façon de la clé suit.
  await P.ouvrir(); await P.clic('[data-cle-facon="vm"]'); await P.clic('[data-f="pont-pied"]');
  assert.equal(E.facon, 'iso'); assert.equal(E.vms, true, 'les machines virtuelles à copier se choisissent à l\'étape Systèmes');
});

test('S5 · page : les PC vus au démarrage réseau, en direct (source simulée), bloqué grisé, nom écrit comme du texte', async () => {
  const P = await page(); await versPostes(P);
  const cartes = () => P.qa('[data-poste]').map((c) => c.getAttribute('data-poste'));
  assert.deepEqual(cartes(), ['52:54:00:3a:91:0c', '52:54:00:7e:12:a4', '52:54:00:c1:5b:77', '52:54:00:08:e2:3d'], 'au menu d\'abord, le bloqué en dernier');
  const a = P.q('[data-poste="52:54:00:3a:91:0c"]')!;
  assert.equal(a.getAttribute('role'), 'checkbox'); assert.equal(a.getAttribute('aria-checked'), 'false');
  assert.match(a.textContent, /au menu/); assert.match(a.textContent, /52:54:00:3a:91:0c · UEFI/); assert.match(a.textContent, /Mini PC 8 Go/); assert.match(a.textContent, /Vu en ce moment/);
  const c = P.q('[data-poste="52:54:00:c1:5b:77"]')!;
  assert.match(c.textContent, /Installé par Odin : ubuntu-22\.04 \(il y a 2 h\)/); assert.match(c.textContent, /BIOS/);
  const b = P.q('[data-poste="52:54:00:08:e2:3d"]')!;
  assert.equal(b.getAttribute('aria-disabled'), 'true'); assert.equal(b.getAttribute('role'), null, 'pas une case à cocher');
  assert.match(b.textContent, /bloqué/); assert.match(b.textContent, /Débloque-le dans Protection/);
  // Le nom pris sur le réseau est écrit comme du texte : aucune image créée.
  assert.match(P.q('[data-poste="52:54:00:7e:12:a4"]')!.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(P.qa('img').length, 0);
  assert.match(P.q('[data-f="serveur"]')!.textContent, /allumé.*à côté de la box/);
  // En direct : un PC démarre par le réseau, il apparaît au tour suivant (relu toutes les 3 s).
  (SOURCE.live as Record<string, unknown>)['52:54:00:12:34:56'] = { mac: '52:54:00:12:34:56', fw: 'bios', step: 'démarrage réseau', updated: NOW - 1000, started: NOW - 1000, steps: [] } as never;
  await P.tic();
  assert.ok(cartes().includes('52:54:00:12:34:56'), 'le nouveau PC est là');
  assert.ok(P.appels.filter((x) => x.action === 'postes_vus').length >= 2, 'relu');
  // Bloqué pendant qu'il était choisi : il n'est plus choisi.
  await P.clic('[data-poste="52:54:00:12:34:56"]');
  assert.equal(P.q('[data-poste="52:54:00:12:34:56"]')!.getAttribute('aria-checked'), 'true');
  (SOURCE.bloques as Record<string, unknown>)['52:54:00:12:34:56'] = { at: NOW };
  await P.tic();
  assert.equal(P.q('[data-poste="52:54:00:12:34:56"]')!.getAttribute('aria-disabled'), 'true');
  assert.match(P.q('[data-f="pied-aide"]')!.textContent, /Choisis au moins un PC/);
  // Quitter l'étape arrête la relecture.
  await P.clic('[data-f="retour"]');
  const n = P.appels.length; await P.tic(); assert.equal(P.appels.length, n, 'plus de relecture hors de l\'étape');
});

test('S5 · page : plusieurs PC à la fois, le prochain PC, et le garde-fou rouge qui nomme chaque PC dont le disque sera effacé', async () => {
  const P = await page(); await versPostes(P);
  assert.equal(P.q('[data-f="continuer"]')!.disabled, true, 'aucun PC : Continuer éteint');
  assert.equal(P.q('[role="alert"]'), null, 'pas de garde-fou sans PC');
  await P.clic('[data-poste="52:54:00:3a:91:0c"]');
  await P.clic('[data-poste="52:54:00:c1:5b:77"]');
  await P.clic('[data-poste="52:54:00:08:e2:3d"]');
  assert.equal(P.q('[data-poste="52:54:00:3a:91:0c"]')!.getAttribute('aria-checked'), 'true');
  assert.equal(P.q('[data-poste="52:54:00:c1:5b:77"]')!.getAttribute('aria-checked'), 'true');
  assert.match(P.q('[data-f="pied-aide"]')!.textContent, /^2 PC choisis$/, 'le PC bloqué ne se choisit pas');
  assert.equal(P.q('[data-f="continuer"]')!.disabled, false);
  const garde = P.q('[role="alert"]')!;
  assert.match(garde.textContent, /Le disque de 2 PC sera entièrement effacé/);
  assert.deepEqual(garde.querySelectorAll('[data-efface]').map((x) => x.getAttribute('data-efface')), ['52:54:00:3a:91:0c', '52:54:00:c1:5b:77']);
  assert.match(garde.textContent, /Portable-03 \(52:54:00:c1:5b:77\)/);
  assert.match(garde.textContent, /tu taperas une phrase et tu appuieras longuement/);
  await P.clic('[data-f="prochain"]');
  assert.equal(P.q('[data-f="prochain"]')!.getAttribute('aria-pressed'), 'true');
  assert.match(P.q('[role="alert"]')!.textContent, /Le disque de 3 PC sera entièrement effacé.*le prochain PC qui démarre par le réseau dans les 30 minutes/);
  assert.match(P.q('[data-f="pied-aide"]')!.textContent, /2 PC choisis \+ le prochain/);
  // Le proposer au menu, sans effacer : garde-fou vert, plus rien en rouge.
  await P.clic('[data-facon="menu"]');
  assert.equal(P.q('[role="alert"]'), null);
  assert.match(P.q('[data-f="garde-calme"]')!.textContent, /Rien n'est effacé sans quelqu'un devant le PC/);
  // Le prochain PC seul suffit pour continuer.
  await P.clic('[data-facon="auto"]');
  await P.clic('[data-poste="52:54:00:3a:91:0c"]'); await P.clic('[data-poste="52:54:00:c1:5b:77"]');
  assert.equal(P.q('[data-f="continuer"]')!.disabled, false, 'le prochain PC seul');
  assert.deepEqual(P.q('[role="alert"]')!.querySelectorAll('[data-efface]').map((x) => x.getAttribute('data-efface')), ['prochain']);
});

test('S5 · page : ajout d\'un PC par son adresse MAC, vérifiée (ni diffusion, ni groupe, ni nulle, ni bloqué)', async () => {
  const P = await page(); await versPostes(P);
  const ajouter = async (t: string) => { const i = P.q('[data-f="mac"]')!; i.value = t; await i.emettre('input'); await P.clic('[data-f="mac-ajouter"]'); return P.q('[data-f="mac-msg"]')!.textContent; };
  assert.match(await ajouter(''), /Écris l'adresse MAC/);
  assert.match(await ajouter('52:54:00:12:34'), /pas valable/);
  assert.equal(P.q('[data-f="mac"]')!.getAttribute('aria-invalid'), 'true');
  assert.match(await ajouter('<script>alert(1)</script>'), /pas valable/);
  assert.match(await ajouter('FF:FF:FF:FF:FF:FF'), /diffusion/);
  assert.match(await ajouter('01:00:5e:00:00:fb'), /groupe/);
  assert.match(await ajouter('00-00-00-00-00-00'), /que des zéros/);
  assert.match(await ajouter('52:54:00:08:E2:3D'), /bloqué/);
  assert.equal(P.qa('[data-poste]').length, 4, 'rien d\'ajouté');
  assert.match(await ajouter('52-54-00-AB-CD-EF'), /PC ajouté et choisi/);
  const n = P.q('[data-poste="52:54:00:ab:cd:ef"]')!;
  assert.ok(n, 'la carte du PC ajouté'); assert.equal(n.getAttribute('aria-checked'), 'true');
  assert.match(n.textContent, /ajouté/); assert.match(n.textContent, /Pas encore vu au démarrage réseau/);
  assert.equal(P.q('[data-f="mac"]')!.value, '', 'le champ est vidé');
  assert.match(P.q('[role="alert"]')!.textContent, /\(52:54:00:ab:cd:ef\)/, 'dans le garde-fou');
  // Une adresse déjà vue : elle est choisie, pas dupliquée.
  assert.match(await ajouter('52:54:00:3a:91:0c'), /déjà dans la liste/);
  assert.equal(P.q('[data-poste="52:54:00:3a:91:0c"]')!.getAttribute('aria-checked'), 'true');
  assert.equal(P.qa('[data-poste="52:54:00:3a:91:0c"]').length, 1);
  // Retirer le PC ajouté.
  await P.clic('[data-f="retirer-52:54:00:ab:cd:ef"]');
  assert.equal(P.q('[data-poste="52:54:00:ab:cd:ef"]'), null);
  // La logique pure : la même règle que le serveur.
  const L = P.window.OdinGeneseDeployer.logique;
  for (const m of ['52:54:00:12:34:56', '52-54-00-12-34-56', '525400123456', 'ff:ff:ff:ff:ff:ff', '33:33:00:00:00:01', '00:00:00:00:00:00', '52:54:00:12:34:5g', '52:54:00-12:34:56', '52:54:00:12:34:56\n'])
    assert.equal(L.verifMac(m).ok ? L.verifMac(m).mac : '', X.macPoste(m), `même verdict que le serveur : ${JSON.stringify(m)}`);
});

test('S5 · page : la machine virtuelle — nom, où, processeurs, mémoire, disque ; sans Hydre, « bientôt »', async () => {
  const P = await page(); await P.ouvrir();
  await P.clic('[data-cible="vm"]'); await P.clic('[data-f="continuer"]');
  assert.equal(P.q('h4')!.textContent, 'La machine virtuelle');
  assert.equal(P.q('[data-f="vm-nom"]')!.value, 'vm-systeme-1');
  assert.equal(P.q('[data-f="vm-ce"]')!.getAttribute('aria-pressed'), 'true');
  const srv = P.q('[data-f="vm-srv"]')!; assert.equal(srv.disabled, true); assert.match(srv.textContent, /bientôt/);
  for (const [k, v] of [['cpu', '2'], ['mem', '4'], ['disk', '64']]) assert.equal(P.q(`[data-f="vm-${k}-${v}"]`)!.getAttribute('aria-pressed'), 'true', `${k} ${v} au départ`);
  await P.clic('[data-f="vm-disk-128"]');
  assert.match(P.q('[data-f="garde-calme"]')!.textContent, /Rien n'est effacé.*128\s*Go au plus/);
  const nom = P.q('[data-f="vm-nom"]')!;
  nom.value = 'mauvais nom !'; await nom.emettre('input');
  assert.equal(P.q('[data-f="continuer"]')!.disabled, true, 'nom refusé');
  nom.value = 'vm-essai-2'; await nom.emettre('input');
  assert.equal(P.q('[data-f="continuer"]')!.disabled, false);
  await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(3).getAttribute('aria-current'), 'step');
  // Aucune machine n'est créée dans ce lot.
  assert.ok(!P.appels.some((a) => a.action === 'creer_machine' || a.module === 'ymir'), 'Hydre n\'est jamais appelée');
  // Sans Hydre : « bientôt », on ne continue pas.
  const S = await page({ vm: false }); await S.ouvrir();
  await S.clic('[data-cible="vm"]'); await S.clic('[data-f="continuer"]');
  assert.match(S.q('[data-f="vm-sans"]')!.textContent, /Hydre n'est pas là : la machine virtuelle arrive bientôt/);
  assert.equal(S.q('[data-f="continuer"]')!.disabled, true);
});

test('S5 · page : le système depuis la bibliothèque — prêts au choix, les autres grisés avec leur raison ; Windows ouvre l\'étape 5', async () => {
  const P = await page(); await versPostes(P);
  await P.clic('[data-poste="52:54:00:3a:91:0c"]'); await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(3).getAttribute('aria-current'), 'step');
  const carte = (re: RegExp) => P.qa('[data-sys]').find((b) => re.test(b.querySelector('b')!.textContent))!;
  const u = carte(/^Ubuntu 24\.04\.1$/);
  assert.equal(u.disabled, false); assert.match(u.textContent, /s'installe tout seul/); assert.match(u.textContent, /Linux · 5,8\s*Go/);
  assert.match(carte(/^GParted/).textContent, /démarre seulement/);
  const d = carte(/^Debian/); assert.equal(d.disabled, true); assert.match(d.textContent, /63\s*% · en téléchargement/);
  const f = carte(/^Fedora/); assert.equal(f.disabled, true); assert.match(f.textContent, /vérification en cours/);
  assert.equal(P.q('[data-f="continuer"]')!.disabled, true, 'pas de système : Continuer éteint');
  await u.emettre('click'); await calme();
  assert.equal(carte(/^Ubuntu 24\.04\.1$/).getAttribute('aria-checked'), 'true');
  assert.equal(P.etape(5).disabled, true); assert.match(P.etape(5).textContent, /Pas de Windows/);
  // Au clavier : flèche droite → le système suivant qu'on peut choisir.
  await carte(/^Ubuntu 24\.04\.1$/).emettre('keydown', { key: 'ArrowRight' }); await calme();
  const w = carte(/^Windows 11/);
  assert.equal(w.getAttribute('aria-checked'), 'true');
  assert.equal(P.etape(5).disabled, false, 'un Windows : l\'étape 5 s\'ouvre');
  // Filtre Outils : seulement GParted.
  await P.clic('[data-filtre="outil"]');
  assert.deepEqual(P.qa('[data-sys]').map((b) => b.querySelector('b')!.textContent), ['GParted Live 1.6.0']);
  await P.clic('[data-filtre="tout"]');
  // Les étapes 4 à 6 (construites au lot S6, voir genese-deployer-s6-page) : rien n'est lancé en les ouvrant.
  await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(4).getAttribute('aria-current'), 'step');
  await P.clic('[data-dp-etape="6"]');
  assert.match(P.q('[data-f="rc-sys"]')!.textContent, /Windows 11 24H2/);
  assert.match(P.q('[data-f="danger"]')!.textContent, /effacer 1 pc/);
  // Pour une machine virtuelle, un outil ne se choisit pas.
  const V = await page(); await V.ouvrir();
  await V.clic('[data-cible="vm"]'); await V.clic('[data-f="continuer"]'); await V.clic('[data-f="continuer"]');
  const g = V.qa('[data-sys]').find((b) => /^GParted/.test(b.querySelector('b')!.textContent))!;
  assert.equal(g.disabled, true); assert.match(g.textContent, /pas pour une machine virtuelle/);
});

test('S5 · page : rien n\'écrit — seules des lectures partent, tout le parcours compris (pont et étapes « bientôt »)', async () => {
  const P = await page(); await versPostes(P);
  await P.clic('[data-poste="52:54:00:3a:91:0c"]'); await P.clic('[data-f="prochain"]');
  const i = P.q('[data-f="mac"]')!; i.value = '52:54:00:ab:cd:ef'; await i.emettre('input'); await P.clic('[data-f="mac-ajouter"]');
  await P.tic();
  await P.clic('[data-f="continuer"]');
  const u = P.qa('[data-sys]').find((b) => /^Ubuntu/.test(b.querySelector('b')!.textContent))!; await u.emettre('click'); await calme();
  await P.clic('[data-f="continuer"]'); await P.clic('[data-dp-etape="6"]');
  await P.clic('[data-dp-etape="1"]'); await P.clic('[data-cible="vm"]'); await P.clic('[data-f="continuer"]');
  await P.clic('[data-dp-etape="1"]'); await P.clic('[data-cible="cle"]'); await P.clic('[data-f="pont"]');
  for (const a of P.appels) assert.ok(LECTURES.has(`${a.module}.${a.action}`), `lecture seulement : ${a.module}.${a.action}`);
  assert.ok(P.appels.some((a) => a.action === 'postes_vus') && P.appels.some((a) => a.action === 'systemes'));
  assert.equal(P.dialogues.length, 0, 'aucune confirmation demandée : rien de grave n\'est proposé');
});

test('S5 · page : refusé par le serveur (pas le propriétaire) — rien n\'est montré, la raison est dite', async () => {
  const P = await page({ postesKo: true }); await versPostes(P);
  assert.equal(P.qa('[data-poste]').length, 0);
  assert.match(P.corps.textContent, /Odin ne peut pas lire les PC du réseau : Réservé au propriétaire\./);
});

test('S5 · page : logique pure — étapes ouvertes, PC à effacer, nom de la machine virtuelle', () => {
  const ctx: Record<string, any> = { window: {}, Intl }; vm.runInNewContext(src('thjalfi-deployer.js'), ctx);
  const L = ctx.window.OdinGeneseDeployer.logique;
  const Z = (o: Record<string, unknown> = {}) => ({ cible: 'reseau', pcs: [], ajoutes: [], prochain: false, facon: 'auto', vm: { nom: 'vm-1' }, vmDispo: true, sys: '', sysCarte: null, postes: { data: { postes: [{ mac: 'a', bloque: false }, { mac: 'b', bloque: true }] } }, systemes: { data: { cartes: [{ id: 'w', famille: 'windows', deployable: true }, { id: 'l', famille: 'linux', deployable: true }, { id: 'o', famille: 'outil', deployable: true }] } }, ...o });
  assert.equal(L.etapeOuverte(2, Z()), true); assert.equal(L.etapeOuverte(3, Z()), false);
  assert.equal(L.etapeOuverte(3, Z({ pcs: ['b'] })), false, 'un PC bloqué ne compte pas');
  assert.equal(L.etapeOuverte(3, Z({ pcs: ['a'] })), true); assert.equal(L.etapeOuverte(3, Z({ prochain: true })), true);
  assert.equal(L.etapeOuverte(4, Z({ pcs: ['a'] })), false, 'pas de système');
  assert.equal(L.etapeOuverte(5, Z({ pcs: ['a'], sys: 'l' })), false); assert.equal(L.etapeOuverte(5, Z({ pcs: ['a'], sys: 'w' })), true);
  assert.equal(L.etapeOuverte(2, Z({ cible: 'cle' })), false);
  assert.equal(L.etapeOuverte(3, Z({ cible: 'vm', vmDispo: false })), false); assert.equal(L.etapeOuverte(3, Z({ cible: 'vm', vm: { nom: '-x' } })), false);
  assert.equal(L.etapeOuverte(4, Z({ cible: 'vm', sys: 'o' })), false, 'un outil ne va pas dans une machine virtuelle');
  assert.deepEqual(ici(L.aEffacer(Z({ pcs: ['a', 'b'], prochain: true })).pcs.map((p: { mac: string }) => p.mac)), ['a']);
  assert.equal(L.aEffacer(Z({ pcs: ['a'], facon: 'menu' })).pcs.length, 0);
  assert.equal(L.nomVmPour({ nom: 'Ubuntu Server' }), 'vm-ubuntu-1'); assert.equal(L.nomVmPour({ nom: 'Fédora' }), 'vm-fedora-1');
  for (const n of ['vm-1', 'a', 'VM-Ubuntu-24']) assert.equal(L.nomVmValide(n), true, n);
  for (const n of ['', '-a', 'a-', 'a b', 'é', 'a'.repeat(41), '<b>']) assert.equal(L.nomVmValide(n), false, n);
});

// ------------------------------------------------------------------ relecture S5 (constats corrigés)
test('relecture S5 · le minuteur de 3 s ne se multiplie pas quand on clique pendant une relecture', async () => {
  const P = await page(); await versPostes(P);
  for (let k = 0; k < 4; k++) {
    const l = [...P.minuteurs]; P.minuteurs.clear();
    // La relecture part (sans attendre sa fin), et un clic redessine pendant qu'elle est en vol.
    const enVol = Promise.all(l.map(([, f]) => f()));
    await P.q('[data-f="prochain"]')!.emettre('click');
    await enVol; await calme();
    assert.equal(P.nbMinuteurs(), 1, `un seul minuteur (tour ${k + 1})`);
  }
});

test('relecture S5 · une adresse MAC locale (souvent aléatoire) est acceptée mais signalée', async () => {
  const P = await page(); await versPostes(P);
  const i = P.q('[data-f="mac"]')!; i.value = '02:1a:2b:3c:4d:5e'; await i.emettre('input'); await P.clic('[data-f="mac-ajouter"]');
  assert.ok(P.q('[data-poste="02:1a:2b:3c:4d:5e"]'), 'ajoutée');
  assert.match(P.q('[data-f="mac-msg"]')!.textContent, /peut changer/);
  const L = P.window.OdinGeneseDeployer.logique;
  assert.equal(L.verifMac('02:1a:2b:3c:4d:5e').locale, true);
  assert.equal(L.verifMac('00:1a:2b:3c:4d:5e').locale, undefined);
});

test('relecture S5 · le garde-fou n\'oublie jamais un PC choisi (PC qui disparaît de la liste, relecture en panne)', async () => {
  const P = await page(); await versPostes(P);
  await P.clic('[data-poste="52:54:00:3a:91:0c"]');
  assert.match(P.q('[data-f="garde-liste"]')!.textContent, /52:54:00:3a:91:0c/);
  // Le PC disparaît de ce que sait le serveur : il reste choisi, donc il reste nommé.
  SOURCE = { ...SOURCE, live: { '52:54:00:7e:12:a4': SOURCE.live['52:54:00:7e:12:a4'] } as never };
  await P.tic();
  assert.match(P.q('[data-f="garde-liste"]')!.textContent, /52:54:00:3a:91:0c/, 'toujours nommé après sa disparition');
  // La relecture tombe en panne : rien n'est oublié non plus.
  P.panne(true); await P.tic();
  assert.match(P.q('[data-f="garde-liste"]')!.textContent, /52:54:00:3a:91:0c/, 'toujours nommé quand la relecture échoue');
  const E = P.window.OdinGeneseDeployer;
  assert.deepEqual(ici(E.logique.aEffacer(E.etat).pcs.map((p: { mac: string }) => p.mac)), ici(E.etat.pcs), 'ce qui est choisi = ce qui est nommé');
});

test('relecture S5 · le pont ne mélange pas les systèmes, et le profil passe par un vrai crochet (rendre non enveloppé)', async () => {
  const P = await page(); await P.ouvrir();
  const LOG = P.window.OdinGeneseCleLogiciels, rendre = LOG.rendre, pris: string[] = [];
  LOG.partirDuProfil = async (p: { id: string }) => { pris.push(p.id); };
  const choisir = async (re: RegExp) => {
    await P.clic('[data-cible="vm"]'); await P.clic('[data-f="continuer"]'); await P.clic('[data-f="continuer"]');
    await P.qa('[data-sys]').find((b) => re.test(b.querySelector('b')!.textContent))!.emettre('click'); await calme();
    await P.clic('[data-dp-etape="1"]'); await P.clic('[data-cible="cle"]');
  };
  await choisir(/^Ubuntu 24\.04\.1$/);
  await P.clic('[data-profil="p-bur"]');
  await P.clic('[data-f="pont"]');
  assert.equal(LOG.rendre, rendre, 'rendre n\'est pas enveloppé');
  const E = P.window.OdinGeneseCleSystemes.etat;
  assert.ok(E.choisis['iso:ubuntu']);
  await P.ouvrir(); await choisir(/^Windows 11/);
  await P.clic('[data-f="pont"]');
  assert.ok(E.choisis['iso:win11'], 'Windows coché');
  assert.equal(E.choisis['iso:ubuntu'], undefined, 'Ubuntu, venu du pont d\'avant, n\'est plus coché');
  const outils = { cle: CLE64, sorte: 'cle', post: async () => ({ ok: false, text: 'essai' }), redessiner() {}, pied: () => new Noeud('div'), wrap: new Noeud('div') };
  LOG.rendre(4, outils); await calme(); LOG.rendre(4, outils); await calme();
  assert.deepEqual(pris, ['p-bur'], 'profil repris à l\'étape 4, une fois');
  // Un choix fait à la main dans la clé n'est jamais retiré par le pont.
  E.choisis = { ...E.choisis, 'iso:win11': { choix: 'iso', main: true } };
  await P.ouvrir(); await choisir(/^Ubuntu 24\.04\.1$/); await P.clic('[data-f="pont"]');
  assert.deepEqual(ici(E.choisis['iso:win11']), { choix: 'iso', main: true });
});

test('relecture S5 · « Déployer » sur une carte de Systèmes ouvre Déployer à « Vers quoi », le système déjà choisi', async () => {
  const P = await page();
  await P.onglet('Systèmes').emettre('click'); await calme();
  const b = P.qa('button[data-f="deployer"]').find((x) => x.getAttribute('aria-label') === 'Déployer Ubuntu 24.04.1')!;
  assert.ok(b, 'bouton Déployer de la carte');
  await b.emettre('click'); await calme();
  assert.equal(P.onglet('Déployer').getAttribute('aria-selected'), 'true', 'onglet Déployer ouvert');
  assert.equal(P.etape(1).getAttribute('aria-current'), 'step');
  assert.match(P.q('h4')!.textContent, /Où déployer Ubuntu 24\.04\.1 \?/);
  for (const c of ['cle', 'reseau', 'vm']) assert.ok(P.q(`[data-cible="${c}"]`), `cible ${c}`);
  await P.clic('[data-cible="reseau"]'); await P.clic('[data-f="continuer"]');
  await P.clic('[data-poste="52:54:00:3a:91:0c"]'); await P.clic('[data-f="continuer"]');
  assert.equal(P.q('[data-sys][aria-checked="true"]')!.querySelector('b')!.textContent, 'Ubuntu 24.04.1');
});

test('relecture S5 · cibles d\'au moins 44 px et police héritée valable', () => {
  const css = src('thjalfi-deployer.js');
  assert.doesNotMatch(css, /min-height:(?:[0-3]?\d|4[0-3])px/, 'pas de bouton sous 44 px');
  assert.doesNotMatch(css, /\.rm\{[^}]*width:(?:[0-3]?\d|4[0-3])px/);
  assert.doesNotMatch(css, /font:[^;}]*\binherit\b(?!\s*[;}])|font:[^;}]+\s+inherit/, 'pas de « font: 600 14px inherit » (déclaration invalide)');
});
