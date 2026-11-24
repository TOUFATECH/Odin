// Genèse · Systèmes, lot S1 (la page) : l'onglet « Systèmes » de Genèse — les quatre chiffres, les filtres et la
// recherche, une carte par état (prêt, mise à jour, téléchargement, vérification, empreinte fausse), et « Déployer »
// qui ouvre la clé USB avec ce système déjà choisi pour l'étape 3 (réseau et machine virtuelle : « bientôt »).
// La page de Genèse entière est montée (thjalfi.js et ses greffes) dans un document minimal ; ses demandes reçoivent
// les données du VRAI assembleur du serveur sur des fiches fausses. Aucun réseau, aucun disque, rien d'écrit.
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
  async emettre(t: string) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {} };
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

test('S1 · page : l\'onglet « Systèmes » est greffé dans Genèse, ce qu\'elle savait faire reste joignable', async () => {
  assert.ok(src('thjalfi-systemes.js'), 'src/web/pages/thjalfi-systemes.js existe');
  const P = await page();
  for (const t of ['Odin te prévient', 'Systèmes', 'Clé USB', 'Écran de démarrage', 'Tout']) assert.ok(P.onglet(t), `onglet « ${t} »`);
  await P.ouvrir();
  assert.equal(P.onglet('Systèmes').getAttribute('aria-selected'), 'true');
  assert.ok(P.q('[data-f="systemes"]'), 'l\'onglet est dessiné');
});

test('S1 · page : les quatre chiffres et chaque état de carte, avec ses boutons', async () => {
  const P = await page(); await P.ouvrir();
  const k = (n: string) => P.q(`[data-k="${n}"]`)!.parent!.textContent;
  assert.match(k('prets'), /^3\s*systèmes prêts à déployer/);
  assert.match(k('cours'), /^2\s*en cours · Debian 62\s*%/);
  assert.match(k('place'), /Go\s*sur 1 To · dossier des ISO/);
  assert.match(k('majs'), /^1\s*mise à jour disponible/);
  const boutons = (c: Noeud) => c.querySelectorAll('button').map((b) => b.textContent.trim());
  // Prêt, empreinte de l'éditeur, antivirus propre, mise à jour disponible.
  const u = P.carte(/^Ubuntu 24\.04\.1$/);
  assert.equal(u.getAttribute('data-etat'), 'pret');
  assert.match(u.textContent, /Linux · Bureau · 5,8\s*Go/);
  assert.match(u.textContent, /Empreinte vérifiée/); assert.match(u.textContent, /Antivirus : propre/); assert.match(u.textContent, /24\.04\.2 disponible/);
  assert.deepEqual(boutons(u), ['Déployer', 'Détail', 'Mettre à jour']);
  // Téléchargement en cours : progression, « Arrêter ».
  const d = P.carte(/^Debian/);
  assert.equal(d.getAttribute('data-etat'), 'telechargement');
  assert.equal(d.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), '62');
  assert.match(d.querySelector('[data-f="progres"]')!.textContent, /62\s*% · 2,3\s*Go sur 3,7\s*Go/);
  assert.deepEqual(boutons(d), ['Arrêter']);
  // Vérification en cours.
  const f = P.carte(/^Fedora/);
  assert.equal(f.getAttribute('data-etat'), 'verification');
  assert.match(f.textContent, /empreinte et antivirus en cours/);
  assert.deepEqual(boutons(f), ['Détail']);
  // Empreinte fausse : fichier jeté.
  const m = P.carte(/^Linux Mint/);
  assert.equal(m.getAttribute('data-etat'), 'empreinte_fausse');
  assert.match(m.textContent, /Empreinte fausse : fichier jeté/); assert.match(m.textContent, /Rien n'a été gardé/);
  assert.deepEqual(boutons(m), ['Retélécharger', 'Détail']);
  // Une image qu'Odin ne sait pas démarrer : « Déployer » éteint, avec la raison.
  const g = P.carte(/^GParted/);
  assert.match(g.textContent, /Empreinte notée/);
  const dg = g.querySelector('[data-f="deployer"]')!;
  assert.equal(dg.disabled, true); assert.match(String(dg.getAttribute('title')), /ne sait pas encore démarrer/);
  // Aucune fin de support inventée.
  assert.doesNotMatch(P.corps.textContent, /fin du support/);
});

test('S1 · page : filtres Windows / Linux / Outils / Serveurs et recherche (sans accents ni majuscules)', async () => {
  const P = await page(); await P.ouvrir();
  assert.equal(P.visibles().length, 7, 'Tout');
  const filtre = async (f: string) => { await P.q(`[data-filtre="${f}"]`)!.emettre('click'); await calme(); };
  await filtre('windows'); assert.deepEqual(P.visibles(), ['Windows 11 24H2']);
  assert.equal(P.q('[data-filtre="windows"]')!.getAttribute('aria-pressed'), 'true');
  await filtre('serveur'); assert.deepEqual(P.visibles(), ['Ubuntu Server 24.04.1']);
  await filtre('outil'); assert.deepEqual(P.visibles(), ['GParted Live 1.6.0']);
  await filtre('linux'); assert.deepEqual(P.visibles().sort(), ['Debian 12.8.0', 'Fedora Workstation 41', 'Linux Mint 22', 'Ubuntu 24.04.1']);
  await filtre('tout');
  const chercher = async (t: string) => { const i = P.q('[data-f="recherche"]')!; i.value = t; await i.emettre('input'); await calme(); };
  await chercher('MINT'); assert.deepEqual(P.visibles(), ['Linux Mint 22']);
  await chercher('fédora'); assert.deepEqual(P.visibles(), ['Fedora Workstation 41']);
  await chercher('rien-de-tel'); assert.deepEqual(P.visibles(), []); assert.match(P.corps.textContent, /Aucun système ne correspond/);
  await chercher('');
  await filtre('windows'); await chercher('ubuntu'); assert.deepEqual(P.visibles(), [], 'filtre ET recherche');
});

test('S1 · page : « Déployer » ouvre la clé USB avec ce système déjà choisi (réseau et machine virtuelle : bientôt)', async () => {
  const P = await page(); await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  const vers = P.q('[data-f="vers-cle"]')!;
  assert.ok(vers, '« Vers quoi ? »');
  for (const f of ['vers-reseau', 'vers-vm']) { const b = P.q(`[data-f="${f}"]`)!; assert.equal(b.disabled, true, f); assert.match(b.textContent, /bientôt/); }
  await vers.emettre('click'); await calme();
  assert.equal(P.onglet('Clé USB').getAttribute('aria-selected'), 'true', 'l\'onglet « Clé USB » est ouvert');
  assert.ok(P.window.OdinGeneseCleSystemes.etat.choisis['iso:ubuntu'], 'Ubuntu choisi pour l\'étape 3');
  assert.equal(P.window.OdinGeneseCleEtapes.etat.etape, 1, 'pas de clé choisie : on commence par la clé');
  // La clé choisie, puis retour aux systèmes : « Déployer » Windows mène droit à l'étape 3, Windows et Ubuntu cochés.
  await P.q('[data-cle="faux-cle-64"]')!.emettre('click'); await calme();
  await P.ouvrir();
  await P.carte(/^Windows 11/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  await P.q('[data-f="vers-cle"]')!.emettre('click'); await calme();
  assert.equal(P.window.OdinGeneseCleEtapes.etat.etape, 3, 'droit à l\'étape 3');
  assert.equal(P.q('[data-etape="3"]')!.getAttribute('aria-current'), 'step');
  for (const id of ['iso:ubuntu', 'iso:win11']) assert.equal(P.q(`[data-sys="${id}"]`)!.getAttribute('aria-pressed'), 'true', `${id} coché à l'étape 3`);
});

test('S1 · page : rien n\'est écrit — seules des lectures partent (afficher, filtrer, chercher, déployer, refuser une confirmation)', async () => {
  const P = await page(); await P.ouvrir();
  await P.q('[data-filtre="linux"]')!.emettre('click');
  const i = P.q('[data-f="recherche"]')!; i.value = 'deb'; await i.emettre('input'); await calme();
  await P.q('[data-filtre="tout"]')!.emettre('click'); i.value = ''; await i.emettre('input'); await calme();
  // Les boutons qui lancent Andromède demandent d'abord ton accord ; refusé, rien ne part.
  await P.carte(/^Debian/).querySelector('[data-f="arreter"]')!.emettre('click'); await calme();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="mettre-a-jour"]')!.emettre('click'); await calme();
  await P.carte(/^Linux Mint/).querySelector('[data-f="retel"]')!.emettre('click'); await calme();
  assert.equal(P.dialogues.length, 3, 'trois accords demandés');
  assert.match(P.dialogues[0], /reprendra/); assert.match(P.dialogues[1], /24\.04\.2/);
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  await P.q('[data-f="vers-cle"]')!.emettre('click'); await calme();
  const LECTURES = new Set(['thjalfi.tableau', 'thjalfi.systemes', 'thjalfi.cle_disques', 'thjalfi.isos', 'thjalfi.cle_vms', 'thjalfi.cle_place', 'thjalfi.preparation_dite']);
  for (const a of P.appels) assert.ok(LECTURES.has(`${a.module}.${a.action}`), `lecture seulement : ${a.module}.${a.action}`);
  assert.ok(P.appels.some((a) => a.action === 'systemes'));
  // « Détail » lit la fiche d'Hydre (lecture), « Ajouter un système » ouvre Andromède.
  await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="detail"]')!.emettre('click'); await calme();
  assert.deepEqual(P.appels.at(-1), { module: 'ymir', action: 'fiche_iso', input: { iso: 'ubuntu-24.04.1-desktop-amd64.iso' } });
  await P.q('[data-f="ajouter"]')!.emettre('click');
  assert.equal(P.location.hash, '#app=eitri');
});

test('S1 · page : logique pure — vitesse et temps restant, tailles selon la langue', () => {
  const ctx: Record<string, any> = { window: {}, Intl }; vm.runInNewContext(src('thjalfi-systemes.js'), ctx);
  const L = ctx.window.OdinGeneseSystemes?.logique;
  assert.ok(L, 'thjalfi-systemes.js expose sa logique');
  const v = L.vitesse({ recu: 1 * G, t: 0 }, { recu: 1 * G + 110 * 1024 ** 2, total: 2 * G, t: 10_000 });
  assert.equal(Math.round(v.v / 1024 ** 2), 11, '11 Mo/s');
  assert.ok(v.resteMs > 80_000 && v.resteMs < 90_000);
  assert.equal(L.vitesse({ recu: 5, t: 10 }, { recu: 4, t: 20 }), undefined, 'un téléchargement repris de zéro : pas de vitesse');
  assert.match(L.taille(5.8 * G), /^5,8 Go$/, 'taille lisible, en fran\u00e7ais');
  assert.match(L.taille(1024 * G), /^1 To$/);
});

// ------------------------------------------------------------------ relecture du lot S1 (essais rouges avant, verts après)
/** Une touche du clavier sur un nœud : remonte comme un vrai événement. */
async function touche(n: Noeud, key: string) {
  const e = { type: 'keydown', key, target: n, preventDefault() {}, stopPropagation() {} };
  for (let x: Noeud | null = n; x; x = x.parent) for (const f of [...(x.ecoutes.keydown ?? [])]) await f({ ...e, currentTarget: x });
  await calme();
}

test('relecture S1 · à l\'ouverture de Genèse, l\'onglet « Systèmes » d\'abord (comme la maquette)', async () => {
  const P = await page();
  const tabs = P.qa('[role="tab"]');
  assert.equal(tabs[0].textContent, 'Systèmes', 'premier onglet');
  assert.equal(P.onglet('Systèmes').getAttribute('aria-selected'), 'true', 'ouvert d\'emblée');
  assert.ok(P.q('[data-f="systemes"]'), 'la bibliothèque est dessinée sans clic');
  assert.ok(P.onglet('Odin te prévient'), '« Odin te prévient » reste joignable');
});

test('relecture S1 · le minuteur de 3 s s\'arrête quand on quitte l\'onglet (« Tout ») et ne relit rien quand la page est cachée', async () => {
  const P = await page({ minuteurs: true }); await P.ouvrir();
  const lectures = () => P.appels.filter((a) => a.action === 'systemes').length;
  assert.ok(P.minuteurs.size >= 1, 'un téléchargement en cours : relecture prévue');
  // Onglet « Tout » : la page de Genèse cache le corps sans le retirer.
  await P.onglet('Tout').emettre('click'); await calme();
  const n0 = lectures();
  for (let k = 0; k < 3; k++) await P.tic();
  assert.equal(lectures(), n0, 'aucune relecture sur l\'onglet « Tout »');
  assert.equal(P.minuteurs.size, 0, 'plus aucun minuteur');
  // Retour sur « Systèmes » puis page cachée (autre onglet du navigateur) : pas de relecture, mais le minuteur veille.
  await P.ouvrir(); await P.ouvrir(); await P.ouvrir();
  (P.document as { hidden: boolean }).hidden = true;
  const n1 = lectures();
  for (let k = 0; k < 3; k++) await P.tic();
  assert.equal(lectures(), n1, 'page cachée : rien n\'est relu');
  assert.ok(P.minuteurs.size <= 1, `un seul minuteur, pas plusieurs (${P.minuteurs.size})`);
  (P.document as { hidden: boolean }).hidden = false;
  await P.tic();
  assert.equal(lectures(), n1 + 1, 'page de nouveau visible : une seule relecture');
});

test('relecture S1 · « Mettre à jour » dit ce qu\'Andromède répond vraiment (pas « C\'est parti » si rien ne part)', async () => {
  const P = await page({ confirmer: true, repondre: (m, a) => (m === 'eitri' && a === 'telecharger' ? { ok: true, text: 'Un passage est déjà en cours.' } : undefined) });
  await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="mettre-a-jour"]')!.emettre('click'); await calme();
  assert.ok(P.appels.some((a) => a.module === 'eitri' && a.action === 'telecharger' && a.input.nom === 'ubuntu-desktop'), 'la demande part après ton accord');
  const note = P.q('[data-f="systemes"] p[role="status"]')!.textContent;
  assert.match(note, /Un passage est déjà en cours/);
  assert.doesNotMatch(note, /C'est parti/);
});

test('relecture S1 · « Vers quoi ? » au clavier : Échap le ferme et rend la main à « Déployer » ; le focus survit aux relectures et aux filtres', async () => {
  const P = await page({ minuteurs: true }); await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  assert.equal(P.actif()?.getAttribute('data-f'), 'vers-cle', 'le focus va sur « Sur une clé USB »');
  // La relecture de 3 s (Debian se télécharge) redessine les cartes : le focus reste sur le même bouton.
  await P.tic();
  assert.equal(P.actif()?.isConnected, true, 'le focus n\'est pas perdu par la relecture');
  assert.equal(P.actif()?.getAttribute('data-f'), 'vers-cle');
  await touche(P.actif()!, 'Escape');
  assert.equal(P.q('[data-vers]'), null, 'Échap ferme « Vers quoi ? »');
  assert.equal(P.actif()?.isConnected, true);
  assert.equal(P.actif()?.getAttribute('data-f'), 'deployer', 'le focus revient sur « Déployer »');
  assert.match(String(P.actif()?.getAttribute('aria-label')), /Ubuntu 24\.04\.1/);
  // Un filtre choisi au clavier garde le focus.
  const chip = P.q('[data-filtre="linux"]')!; chip.focus(); await chip.emettre('click'); await calme();
  assert.equal(P.actif()?.isConnected, true, 'le filtre garde le focus');
  assert.equal(P.actif()?.getAttribute('data-filtre'), 'linux');
});

test('relecture S1 · « Déployer » : une ISO arrivée après la première visite de la clé est bien choisie à l\'étape 3, et un choix fait à la main est gardé', async () => {
  let isos = [ISOS[0]];
  const P = await page({ isos: () => isos });
  // La clé USB visitée d'abord : clé choisie, étape 3 (elle lit la bibliothèque : seulement Ubuntu).
  await P.onglet('Clé USB').emettre('click'); await calme();
  await P.q('[data-cle="faux-cle-64"]')!.emettre('click'); await calme();
  await P.q('[data-etape="3"]')!.emettre('click'); await calme();
  assert.ok(P.q('[data-sys="iso:ubuntu"]'), 'Ubuntu à l\'étape 3');
  assert.equal(P.q('[data-sys="iso:win11"]'), null, 'Windows pas encore téléchargé');
  // Ubuntu choisi à la main « installé ».
  P.window.OdinGeneseCleSystemes.etat.choisis = { 'iso:ubuntu': { choix: 'installe', main: true } };
  // Windows arrive dans la bibliothèque ; « Déployer » depuis Systèmes.
  isos = ISOS;
  await P.ouvrir();
  await P.carte(/^Windows 11/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  await P.q('[data-f="vers-cle"]')!.emettre('click'); await calme(); await calme();
  assert.equal(P.window.OdinGeneseCleEtapes.etat.etape, 3);
  assert.ok(P.q('[data-sys="iso:win11"]'), 'Windows relu dans la bibliothèque de la clé');
  assert.equal(P.q('[data-sys="iso:win11"]')!.getAttribute('aria-pressed'), 'true', 'Windows choisi à l\'étape 3');
  // « Déployer » Ubuntu ne remplace pas le choix fait à la main.
  await P.ouvrir();
  await P.carte(/^Ubuntu 24\.04\.1$/).querySelector('[data-f="deployer"]')!.emettre('click'); await calme();
  await P.q('[data-f="vers-cle"]')!.emettre('click'); await calme();
  assert.deepEqual(ici(P.window.OdinGeneseCleSystemes.etat.choisis['iso:ubuntu']), { choix: 'installe', main: true });
});
