// Genèse · Clés USB, lot C2 de la maquette validée : l'étape 2 « Façon » et l'étape 3 « Systèmes ».
// - Façon par défaut : la clé de démarrage avec plusieurs ISO (conseillée) ; changer de façon change les choix proposés.
// - La barre de place suit l'action cle_place (la VRAIE action du serveur, sur des disques FAUX) et bloque « Continuer »
//   quand ça ne tient pas ; filtres et recherche ; clavier.
// Aucun navigateur, aucun réseau, aucun vrai disque : la liste des disques, la bibliothèque et les VM sont fausses ;
// cle_place calcule avec cleDisquesTest (aucune commande lancée). Rien n'est écrit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { cleUsb } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const src = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const ETAPES_JS = src('thjalfi-cle-etapes.js'), CLE_JS = src('thjalfi-cle.js'), COMP_JS = src('thjalfi-cle-composer.js'), SYS_JS = src('thjalfi-cle-systemes.js');
const G = 1024 ** 3;
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ données fausses
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [{ nom: 'p1', label: 'DONNEES', tailleOctets: 64 * G, utiliseOctets: 41 * G, systeme: 'donnees' }] };
const CLE16 = { id: 'faux-cle-16', chemin: 'faux-7', modele: 'Clé USB 16 Go', serie: 'EE55FF66A410', tailleOctets: 16 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const SSD = { id: 'faux-ssd', chemin: 'faux-0', modele: 'SSD interne 512 Go', serie: 'SSD0000FAUX1', tailleOctets: 512 * G, genre: 'interne', externe: false, bus: 'nvme', amovible: false, systemeEnCours: true, partitions: [{ nom: 'p2', tailleOctets: 400 * G, systeme: 'windows', montage: 'C:' }] };
const DISQUES = () => ({ externes: ici([CLE64, CLE16]), internes: ici([SSD]) });
const iso = (id: string, name: string, go: number, recipe: Record<string, unknown> | undefined, etat?: string) => ({ id, name, path: `faux/${name}.iso`, size: Math.round(go * G), mtime: 1, ...(recipe ? { recipe } : {}), ...(etat ? { etat } : {}) });
const ISOS = () => ici([
  iso('ubuntu', 'ubuntu-24.04-desktop-amd64', 5.8, { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' }),
  iso('debian', 'debian-12.5.0-amd64-netinst', 3.7, { kind: 'debian', label: 'Debian', auto: true, os: 'linux' }),
  iso('fedora', 'Fedora-Workstation-Live-x86_64-40', 2.3, { kind: 'fedora-live', label: 'Fedora', auto: false, os: 'linux' }),
  iso('alpine', 'alpine-standard-3.20.0-x86_64', 0.2, { kind: 'alpine', label: 'Alpine', auto: false, os: 'linux' }),
  iso('win11', 'Win11_24H2_French_x64', 5.4, { kind: 'windows', label: 'Windows', auto: true, os: 'windows' }),
  iso('gparted', 'gparted-live-1.6.0-amd64', 0.6, { kind: 'casper', label: 'GParted', auto: false, os: 'outil' }),
  iso('kali', 'kali-linux-2024.2-live-amd64', 4, { kind: 'debian-live', label: 'Kali', auto: false, os: 'linux' }, 'scannée'),
  iso('casse', 'illisible', 1, undefined),
]);
const VMS = () => ici([
  { origine: 'hydre-locale', vmid: 101, nom: 'Serveur maison', famille: 'linux', disque: 'faux/vm-101.qcow2', tailleGo: 12 },
  { origine: 'hydre-locale', vmid: 102, nom: 'Poste qui tourne', famille: 'windows', disque: 'faux/vm-102.qcow2', tailleGo: 40, enMarche: true },
  { origine: 'proxmox', vmid: 300, serveur: 'pve-faux', nom: 'Proxmox lointaine', famille: 'linux', tailleGo: 8 },
]);
// La VRAIE action cle_place, sur la liste fausse (cleDisquesTest : aucune commande, aucun disque réel).
const placeServeur = cleUsb().actions.find((a) => a.id === 'cle_place')!;
const ctxServeur = { settings: { cleDisquesTest: [...DISQUES().externes, ...DISQUES().internes] }, run: async () => { throw new Error('aucune commande dans l\'essai'); } } as unknown as ModCtx;

// ------------------------------------------------------------------ un document minimal (comme genese-cle-etapes)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; html = ''; value?: string;
  classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; }
  get id() { return this.attrs.id ?? ''; }
  get disabled() { return 'disabled' in this.attrs; }
  set innerHTML(h: string) { this.html = h; }
  get children() { return this.enfants.filter((x) => x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => x.textContent).join(''); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  private ajouter(k: Noeud | string) { const n = typeof k === 'object' ? k : new Texte(String(k)); n.parent?.retirer(n); n.parent = this; this.enfants.push(n); }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | string>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string>) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.append(...ks); }
  get childNodes() { return [...this.enfants]; }
  remove() { this.parent?.retirer(this); }
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    let empeche = false;
    const e = { type: t, target: this, preventDefault() { empeche = true; }, stopPropagation() {}, ...plus };
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
    return empeche;
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
const attendre = () => new Promise((ok) => setTimeout(ok, 5));

interface Sys {
  MOTS: Record<string, string>;
  logique: {
    FACON_DEFAUT: string; FACONS: string[];
    entrees: (isos: unknown, vms: unknown, avecVms: boolean) => Array<{ id: string; famille: string; nom: string; choix: Array<{ id: string; dispo: boolean }> }>;
    defautPour: (f: string, e: unknown) => string;
    filtrer: (l: unknown[], f: string, q: string) => Array<{ id: string }>;
    place: (plan: unknown, choisis: unknown, l: unknown[], total: number) => { etat: string; prisOctets: number; n: number };
    choisisValides: (choisis: unknown, l: unknown[]) => unknown[];
  };
  pret: (cle?: unknown) => boolean; composes: () => Array<Record<string, unknown>>;
  etat: { facon: string; vms: boolean; choisis: Record<string, { choix: string }> };
}

/** La page de Genèse montée avec les quatre fichiers, sur des données fausses ; cle_place peut être retenu. */
async function page(o: { retenir?: boolean; disques?: () => unknown } = {}) {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, get activeElement() { return actif; }, hidden: false,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, unknown> }> = [];
  const retenus: Array<() => void> = [];
  const post = async (action: string, input: Record<string, unknown> = {}) => {
    appels.push({ action, input: ici(input) });
    if (action === 'cle_disques') return { ok: true, data: o.disques ? o.disques() : DISQUES() };
    if (action === 'isos') return { ok: true, data: ISOS() };
    if (action === 'cle_vms') return { ok: true, data: VMS() };
    if (action === 'cle_place') {
      if (o.retenir) await new Promise<void>((ok) => retenus.push(ok));
      return ici(await placeServeur.run(ctxServeur, ici(input)));
    }
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const minuteurs = new Map<number, () => unknown>(); let n = 0;
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => false, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, Node: Noeud, Intl, setInterval: (f: () => unknown) => { minuteurs.set(++n, f); return n; }, clearInterval: (i: number) => { minuteurs.delete(i); }, setTimeout, clearTimeout, fetch: async () => { throw new Error('aucun réseau dans l\'essai'); } };
  for (const js of [COMP_JS, ETAPES_JS, CLE_JS, SYS_JS]) vm.runInNewContext(js, ctx);
  const n0 = new Noeud('div');
  await (window.OdinGeneseCle as { dessiner: (r: Noeud, t: string, h: unknown) => Promise<void> }).dessiner(n0, 'cle', { post, act: post });
  corps.append(...n0.childNodes);
  const E = window.OdinGeneseCleEtapes as { MOTS: Record<string, string>; logique: { taille: (o: number) => string; choisir: unknown }; choisir: (id: string) => { ok: boolean; raison?: string }; etat: { cle: string | null; etape: number } };
  const S = window.OdinGeneseCleSystemes as Sys;
  const M = { ...E.MOTS, ...S.MOTS };
  const etape = (k: number) => corps.querySelector(`[data-etape="${k}"]`)!;
  const bouton = (texte: string) => corps.querySelectorAll('button').find((b) => b.textContent.trim() === texte);
  const continuer = () => corps.querySelector('[data-f="continuer"]')!;
  const facon = (f: string) => corps.querySelector(`[data-facon="${f}"]`)!;
  const carte = (id: string) => corps.querySelector(`[data-carte="${id}"]`);
  const ajouter = (id: string) => corps.querySelector(`[data-sys="${id}"]`)!;
  const choix = (id: string, c: string) => corps.querySelector(`[data-how="${id}:${c}"]`);
  const presse = (id: string) => corps.querySelectorAll(`[data-carte="${id}"] button`).filter((b) => b.getAttribute('data-how') && b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-how')!.split(':').pop());
  const placeEtat = () => corps.querySelector('.cks-place')?.getAttribute('data-place');
  const cartes = () => corps.querySelectorAll('.cks-sys').map((c) => c.getAttribute('data-carte'));
  const lacher = async () => { for (let k = 0; k < 8; k++) { while (retenus.length) retenus.shift()!(); await attendre(); } };
  /** Choisit la clé puis va jusqu'à l'étape voulue (2 ou 3). */
  const aller = async (cle: string, k: number) => {
    await corps.querySelector(`[data-cle="${cle}"]`)!.emettre('click');
    await etape(2).emettre('click');
    if (k === 3) { await continuer().emettre('click'); await attendre(); await attendre(); }
  };
  const tic = async () => { for (const f of [...minuteurs.values()]) await f(); await attendre(); await attendre(); };
  return { fenetre: window, corps, E, S, M, appels, tic, etape, bouton, continuer, facon, carte, ajouter, choix, presse, placeEtat, cartes, aller, lacher, actif: () => actif, retenus };
}

// ------------------------------------------------------------------ façon
test('C2 : la façon par défaut est la clé de démarrage avec plusieurs ISO, marquée « Conseillé »', async () => {
  const p = await page();
  assert.equal(p.S.logique.FACON_DEFAUT, 'iso');
  await p.aller('faux-cle-64', 2);
  assert.equal(p.etape(2).getAttribute('aria-current'), 'step');
  const radios = p.corps.querySelectorAll('[role="radiogroup"] .cks-choice');
  assert.deepEqual(radios.map((r) => r.getAttribute('data-facon')), ['iso', 'installes', 'deux']);
  assert.deepEqual(radios.map((r) => r.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.match(p.facon('iso').textContent, new RegExp(p.M['facon.conseil']));
  assert.match(p.facon('iso').textContent, new RegExp(p.M['facon.iso']));
  // L'interrupteur des machines virtuelles : un vrai interrupteur, mis par défaut.
  const sw = p.corps.querySelector('[role="switch"]')!;
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.equal(p.continuer().disabled, false, 'la façon a toujours une valeur : Continuer est ouvert');
  // Sur l'étape 3, le défaut dit « ISO qui démarre », et un système ajouté part en « ISO qui démarre ».
  await p.continuer().emettre('click'); await attendre(); await attendre();
  await p.ajouter('iso:ubuntu').emettre('click'); await attendre(); await attendre();
  assert.deepEqual(p.presse('iso:ubuntu'), ['iso']);
});

test('C2 : changer de façon change les choix proposés (le défaut de chaque système, et les machines virtuelles)', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 2);
  await p.facon('installes').emettre('click');
  assert.equal(p.facon('installes').getAttribute('aria-checked'), 'true');
  await p.continuer().emettre('click'); await attendre(); await attendre();
  assert.match(p.corps.textContent, new RegExp(`Par défaut : ${p.M['choix.installe']}`));
  for (const id of ['iso:ubuntu', 'iso:win11', 'iso:gparted', 'iso:alpine']) { await p.ajouter(id).emettre('click'); await attendre(); }
  assert.deepEqual(p.presse('iso:ubuntu'), ['installe']);
  assert.deepEqual(p.presse('iso:win11'), ['installe']);
  assert.deepEqual(p.presse('iso:gparted'), ['iso'], 'un outil ne s\'installe pas : il reste en ISO');
  assert.deepEqual(p.presse('iso:alpine'), ['iso'], 'sans installation automatique : ISO, « Installé » est grisé');
  assert.equal(p.choix('iso:alpine', 'installe')!.disabled, true);
  assert.match(p.choix('iso:alpine', 'installe')!.textContent, /bientôt/);
  // Un choix changé à la main reste ; les autres suivent la nouvelle façon.
  await p.choix('iso:win11', 'iso')!.emettre('click'); await attendre();
  await p.etape(2).emettre('click');
  await p.facon('iso').emettre('click');
  await p.etape(3).emettre('click'); await attendre(); await attendre();
  assert.deepEqual(p.presse('iso:ubuntu'), ['iso'], 'Ubuntu suit la façon « plusieurs ISO »');
  assert.deepEqual(p.presse('iso:win11'), ['iso'], 'Windows garde le choix fait à la main');
  // Les machines virtuelles : présentes avec l'interrupteur, retirées sans lui (et le filtre disparaît).
  assert.ok(p.corps.querySelector('[data-fil="vm"]'));
  assert.ok(p.cartes().includes('vm:hydre-locale::101'));
  await p.ajouter('vm:hydre-locale::101').emettre('click'); await attendre();
  assert.deepEqual(p.presse('vm:hydre-locale::101'), ['vm']);
  await p.etape(2).emettre('click');
  await p.corps.querySelector('[role="switch"]')!.emettre('click');
  assert.equal(p.corps.querySelector('[role="switch"]')!.getAttribute('aria-checked'), 'false');
  assert.match(p.corps.textContent, /1 machine virtuelle retirée/);
  await p.etape(3).emettre('click'); await attendre(); await attendre();
  assert.equal(p.corps.querySelector('[data-fil="vm"]'), null);
  assert.ok(!p.cartes().some((c) => String(c).startsWith('vm:')));
  assert.ok(!p.S.composes().some((s) => s.choix === 'vm'));
});

test('C2 : ce que l\'appli ne sait pas faire est grisé « bientôt », jamais proposé', () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(SYS_JS, { window: win, Intl });
  const L = (win.OdinGeneseCleSystemes as Sys).logique;
  const l = L.entrees(ISOS(), VMS(), true);
  const par = (id: string) => l.find((e) => e.id === id)!;
  const ch = (id: string) => Object.fromEntries(par(id).choix.map((c) => [c.id, c.dispo]));
  assert.deepEqual(ch('iso:ubuntu'), { iso: true, persistance: true, installe: true });
  assert.deepEqual(ch('iso:win11'), { iso: true, installe: true });
  assert.deepEqual(ch('iso:gparted'), { iso: true });
  assert.deepEqual(ch('iso:alpine'), { iso: true, persistance: false, installe: false });
  assert.deepEqual(ch('vm:hydre-locale::101'), { vm: true });
  assert.deepEqual(ch('vm:hydre-locale::102'), { vm: false }, 'une VM qui tourne : aucune action n\'arrête une VM d\'ici');
  assert.deepEqual(ch('vm:proxmox:pve-faux:300'), { vm: false }, 'disque non lisible d\'ici');
  assert.equal(l.find((e) => e.id === 'iso:casse'), undefined, 'une ISO illisible n\'est pas montrée');
  assert.equal(L.entrees(ISOS(), VMS(), false).some((e) => e.famille === 'vm'), false);
  // Les noms : l'architecture n'est jamais prise pour la version.
  assert.equal(par('iso:fedora').nom, 'Fedora Workstation 40');
  assert.equal(par('iso:win11').nom, 'Windows 11 24H2');
});

// ------------------------------------------------------------------ la place
test('C2 : la barre de place suit cle_place (le vrai calcul), et « Continuer » reste éteint tant qu\'elle n\'est pas là', async () => {
  const p = await page({ retenir: true });
  await p.aller('faux-cle-64', 3);
  assert.equal(p.placeEtat(), 'vide'); assert.match(p.corps.querySelector('.cks-place')!.textContent, new RegExp(p.M['place.vide']));
  assert.equal(p.continuer().disabled, true, 'rien de choisi');
  assert.equal(p.etape(4).disabled, true, 'les étapes suivantes restent fermées');
  await p.ajouter('iso:ubuntu').emettre('click'); await attendre();
  assert.equal(p.placeEtat(), 'calcul'); assert.equal(p.continuer().disabled, true, 'pas avant la réponse de cle_place');
  const demande = p.appels.filter((a) => a.action === 'cle_place').at(-1)!;
  assert.equal((demande.input.cible as { id: string }).id, 'faux-cle-64');
  // Lot C4 (point 2) : l'identifiant de l'ISO dans la bibliothèque part aussi ; le serveur retrouve l'image par lui.
  assert.deepEqual(demande.input.systemes, [{ nom: 'Ubuntu Desktop 24.04', famille: 'linux', choix: 'iso', mode: 'demarrer', fichier: 'ubuntu-24.04-desktop-amd64.iso', iso: 'iso:ubuntu' }]);
  await p.lacher();
  assert.equal(p.placeEtat(), 'ok'); assert.equal(p.continuer().disabled, false); assert.equal(p.etape(4).disabled, false);
  const t = p.corps.querySelector('.cks-place')!.textContent;
  assert.ok(t.includes(p.E.logique.taille(Math.round(5.8 * G))), t); assert.ok(t.includes(p.E.logique.taille(64 * G)), t);
  // Windows installé (32 Go réservés par le plan) : le plan du serveur compte la partition.
  await p.ajouter('iso:win11').emettre('click'); await attendre();
  await p.choix('iso:win11', 'installe')!.emettre('click'); await attendre();
  assert.equal(p.placeEtat(), 'calcul'); assert.equal(p.continuer().disabled, true);
  await p.lacher();
  assert.equal(p.placeEtat(), 'ok');
  assert.ok(p.corps.querySelector('.cks-place')!.textContent.includes(p.E.logique.taille(32 * G + Math.round(5.4 * G) + Math.round(5.8 * G))), 'Windows installé garde aussi son ISO sur la clé');
  // Ubuntu installé en plus : 32 + 20 + 8 (minimum des ISO) > 64 → le serveur refuse, la barre est rouge.
  await p.choix('iso:ubuntu', 'installe')!.emettre('click'); await attendre();
  await p.ajouter('iso:debian').emettre('click'); await attendre();
  await p.choix('iso:debian', 'installe')!.emettre('click'); await attendre();
  await p.lacher();
  assert.equal(p.placeEtat(), 'trop');
  assert.ok(p.corps.querySelector('.cks-place')!.classList.contains('trop'));
  assert.match(p.corps.textContent, new RegExp(p.M['place.trop'])); assert.match(p.corps.textContent, new RegExp(p.M['aide.trop']));
  // Plan refusé : la barre dit ce qui est demandé (32 + 20 + 20 Go installés, et leurs ISO), pas seulement les fichiers.
  assert.ok(p.corps.querySelector('.cks-place')!.textContent.includes(p.E.logique.taille(72 * G + Math.round(5.4 * G) + Math.round(5.8 * G) + Math.round(3.7 * G))), p.corps.querySelector('.cks-place')!.textContent);
  assert.equal(p.continuer().disabled, true); assert.equal(p.etape(4).disabled, true);
  await p.continuer().emettre('click');
  assert.equal(p.E.etat.etape, 3, 'Continuer ne passe pas quand ça ne tient pas');
  // Une seule demande à la fois : les changements pendant le calcul sont regroupés.
  assert.ok(p.appels.filter((a) => a.action === 'cle_place').length < 7);
});

test('C2 : sur une clé de 16 Go, des ISO qui ne tiennent pas dans la partition des ISO bloquent aussi « Continuer »', async () => {
  const p = await page();
  await p.aller('faux-cle-16', 3);
  for (const id of ['iso:ubuntu', 'iso:debian', 'iso:win11']) { await p.ajouter(id).emettre('click'); await attendre(); await attendre(); }
  assert.equal(p.placeEtat(), 'ok', '5,8 + 3,7 + 5,4 Go tiennent');
  assert.equal(p.continuer().disabled, false);
  await p.ajouter('iso:fedora').emettre('click'); await attendre(); await attendre();
  assert.equal(p.placeEtat(), 'trop', '+ 2,3 Go : le plan est possible, mais les fichiers dépassent la partition');
  assert.equal(p.continuer().disabled, true);
  await p.ajouter('iso:fedora').emettre('click'); await attendre(); await attendre();
  assert.equal(p.placeEtat(), 'ok', 'retirer un système rouvre « Continuer »');
});

test('C2 : la place ne se calcule pas sans réponse juste du serveur (erreur = bloqué)', () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(SYS_JS, { window: win, Intl });
  const L = (win.OdinGeneseCleSystemes as Sys).logique;
  const l = L.entrees(ISOS(), [], false), ch = { 'iso:ubuntu': { choix: 'iso' } };
  assert.equal(L.place(null, ch, l, 64 * G).etat, 'calcul');
  assert.equal(L.place({ etat: 'erreur' }, ch, l, 64 * G).etat, 'erreur');
  assert.equal(L.place({ etat: 'pret', data: { cibles: [] } }, ch, l, 64 * G).etat, 'erreur', 'cible introuvable côté serveur');
  assert.equal(L.place({ etat: 'pret', data: { possible: false, partitions: [] } }, ch, l, 64 * G).etat, 'trop');
  assert.equal(L.place({ etat: 'pret', data: { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 56 }] } }, ch, l, 64 * G).etat, 'ok');
  assert.equal(L.place({ etat: 'pret', data: { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 5 }] } }, ch, l, 64 * G).etat, 'trop');
  assert.equal(L.place({ etat: 'pret', data: { possible: true, partitions: [] } }, {}, l, 64 * G).etat, 'vide');
});

// ------------------------------------------------------------------ filtres et recherche
test('C2 : filtres (Linux, Windows, Outils, Machines virtuelles) et recherche sans accents ni majuscules', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 3);
  const tous = p.cartes();
  assert.ok(tous.includes('iso:ubuntu') && tous.includes('iso:win11') && tous.includes('iso:gparted') && tous.includes('vm:hydre-locale::101'));
  assert.deepEqual(p.corps.querySelectorAll('[data-fil]').map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false']);
  await p.corps.querySelector('[data-fil="windows"]')!.emettre('click');
  assert.deepEqual(p.cartes(), ['iso:win11']);
  assert.equal(p.corps.querySelector('[data-fil="windows"]')!.getAttribute('aria-pressed'), 'true');
  await p.corps.querySelector('[data-fil="outil"]')!.emettre('click');
  assert.deepEqual(p.cartes(), ['iso:gparted']);
  await p.corps.querySelector('[data-fil="vm"]')!.emettre('click');
  assert.deepEqual(p.cartes(), ['vm:hydre-locale::101', 'vm:hydre-locale::102', 'vm:proxmox:pve-faux:300']);
  await p.corps.querySelector('[data-fil="linux"]')!.emettre('click');
  assert.ok(p.cartes().every((c) => ['iso:ubuntu', 'iso:debian', 'iso:fedora', 'iso:alpine', 'iso:kali'].includes(String(c))));
  await p.corps.querySelector('[data-fil="tout"]')!.emettre('click');
  const q = p.corps.querySelector('[data-f="q"]')!;
  assert.equal(q.getAttribute('aria-label'), p.M['recherche.nom']);
  q.value = 'DÉBI'; await q.emettre('input');
  assert.deepEqual(p.cartes(), ['iso:debian']);
  assert.equal(p.actif()?.getAttribute('data-f'), 'q', 'le curseur reste dans la recherche');
  const q2 = p.corps.querySelector('[data-f="q"]')!; q2.value = 'zzz'; await q2.emettre('input');
  assert.deepEqual(p.cartes(), []); assert.match(p.corps.textContent, new RegExp(p.M['rien']));
  // Pure : filtre et recherche ensemble.
  const L = p.S.logique, l = L.entrees(ISOS(), VMS(), true);
  assert.deepEqual(ici(L.filtrer(l, 'linux', 'fedo').map((e) => e.id)), ['iso:fedora']);
  assert.equal(L.filtrer(l, 'windows', 'ubuntu').length, 0);
});

// ------------------------------------------------------------------ clavier
test('C2 : au clavier — la façon aux flèches (un seul arrêt de Tab), l\'interrupteur, les + et les choix sont de vrais boutons', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 2);
  const tab = () => p.corps.querySelectorAll('.cks-choice').map((r) => r.getAttribute('tabindex'));
  assert.deepEqual(tab(), ['0', '-1', '-1']);
  p.facon('iso').focus();
  assert.equal(await p.facon('iso').emettre('keydown', { key: 'ArrowRight' }), true);
  assert.equal(p.facon('installes').getAttribute('aria-checked'), 'true'); assert.equal(p.actif(), p.facon('installes'), 'le focus suit');
  assert.deepEqual(tab(), ['-1', '0', '-1']);
  await p.facon('installes').emettre('keydown', { key: 'End' });
  assert.equal(p.facon('deux').getAttribute('aria-checked'), 'true');
  await p.facon('deux').emettre('keydown', { key: 'ArrowRight' });
  assert.equal(p.facon('iso').getAttribute('aria-checked'), 'true', 'la fin revient au début');
  assert.equal(await p.facon('iso').emettre('keydown', { key: 'a' }), false);
  const sw = p.corps.querySelector('[role="switch"]')!;
  assert.equal(sw.tagName, 'BUTTON');
  await sw.emettre('click'); assert.equal(p.corps.querySelector('[role="switch"]')!.getAttribute('aria-checked'), 'false');
  assert.equal(p.actif()?.getAttribute('data-f'), 'vms', 'le focus reste sur l\'interrupteur');
  await p.corps.querySelector('[role="switch"]')!.emettre('click');
  await p.continuer().emettre('click'); await attendre(); await attendre();
  const plus = p.ajouter('iso:ubuntu');
  assert.equal(plus.tagName, 'BUTTON'); assert.equal(plus.getAttribute('aria-pressed'), 'false');
  assert.equal(plus.getAttribute('aria-label'), 'Ajouter Ubuntu Desktop 24.04');
  await plus.emettre('click'); await attendre();
  assert.equal(p.ajouter('iso:ubuntu').getAttribute('aria-pressed'), 'true'); assert.equal(p.actif(), p.ajouter('iso:ubuntu'), 'le focus reste sur le +');
  const groupe = p.corps.querySelector('[data-carte="iso:ubuntu"] [role="group"]')!;
  assert.equal(groupe.getAttribute('aria-label'), 'Façon pour Ubuntu Desktop 24.04');
  assert.deepEqual(groupe.children.map((b) => b.tagName), ['BUTTON', 'BUTTON', 'BUTTON']);
  await p.choix('iso:ubuntu', 'persistance')!.emettre('click'); await attendre();
  assert.deepEqual(p.presse('iso:ubuntu'), ['persistance']); assert.equal(p.actif(), p.choix('iso:ubuntu', 'persistance'));
  // Une ISO pas encore vérifiée ne peut pas être ajoutée.
  assert.equal(p.ajouter('iso:kali').disabled, true);
  assert.equal(p.ajouter('vm:hydre-locale::102').disabled, true);
});

// ------------------------------------------------------------------ sûreté
test('C2 : rien n\'est écrit — seules des lectures partent ; l\'étape 1 et ses verrous restent ; aucun nom d\'outil copié', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 3);
  await p.ajouter('iso:ubuntu').emettre('click'); await attendre(); await attendre();
  await p.ajouter('iso:win11').emettre('click'); await attendre(); await attendre();
  await p.choix('iso:win11', 'installe')!.emettre('click'); await attendre(); await attendre();
  const actions = new Set(p.appels.map((a) => a.action));
  assert.deepEqual([...actions].sort(), ['cle_disques', 'cle_place', 'cle_vms', 'isos']);
  assert.equal(p.E.choisir('faux-ssd').ok, false, 'un disque interne reste refusé');
  assert.equal(p.E.etat.cle, 'faux-cle-64');
  const texte = p.corps.textContent;
  assert.doesNotMatch(texte, /Rufus|Ventoy|Microsoft/);
  await p.etape(2).emettre('click');
  assert.doesNotMatch(p.corps.textContent, /Rufus|Ventoy|Microsoft/);
  // Le dépôt d'un fichier n'existe pas encore : montré, éteint.
  await p.etape(3).emettre('click'); await attendre();
  assert.equal(p.corps.querySelector('.cks-drop')!.getAttribute('aria-disabled'), 'true');
});

test('C2 : les étapes suivantes reprennent les systèmes choisis (le composeur les reçoit)', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 3);
  await p.ajouter('iso:ubuntu').emettre('click'); await attendre(); await attendre();
  await p.ajouter('vm:hydre-locale::101').emettre('click'); await attendre(); await attendre();
  await p.continuer().emettre('click');
  assert.equal(p.E.etat.etape, 4);
  // L'ouverture du composeur est remplacée par un témoin : aucun panneau réel n'est ouvert dans l'essai.
  const recu: Array<{ disque: { id: string }; systemes: Array<Record<string, unknown>> }> = [];
  (p.fenetre.OdinGeneseCleComposer as { ouvrir: unknown }).ouvrir = async (disque: { id: string }, t: { systemes: Array<Record<string, unknown>> }) => { recu.push({ disque, systemes: t.systemes }); };
  await p.corps.querySelector('[data-f="composeur"]')!.emettre('click'); await attendre();
  assert.equal(recu.length, 1);
  assert.equal(recu[0].disque.id, 'faux-cle-64');
  assert.deepEqual(ici(recu[0].systemes).map((s) => [s.nom, s.choix, s.fichier ?? null]), [['Ubuntu Desktop 24.04', 'iso', 'ubuntu-24.04-desktop-amd64.iso'], ['Serveur maison', 'vm', null]]);
  assert.equal((recu[0].systemes[1].vmSource as { disque: string }).disque, 'faux/vm-101.qcow2');
});

// ------------------------------------------------------------------ relecture : ce qui ouvrait « Continuer » à tort
test('C2 relecture : une VM dont la taille du disque n\'est pas connue (ce que rend vraiment cle_vms) ne compte jamais pour 0', () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(SYS_JS, { window: win, Intl });
  const L = (win.OdinGeneseCleSystemes as Sys).logique;
  // listerVms (cle-vm.ts) ne donne ni tailleGo ni enMarche pour une VM locale d'Hydre.
  const vraie = [{ origine: 'hydre-locale', vmid: 'v1', nom: 'Grosse VM', famille: 'windows', disque: 'Grosse VM/disque.qcow2', instantaneFait: false }];
  const l = L.entrees([], vraie, true);
  assert.deepEqual(ici(l[0].choix), [{ id: 'vm', dispo: false }], 'taille inconnue : la copie est grisée, pas comptée 0 Go');
  const ch = { [l[0].id]: { choix: 'vm' } };
  const plan = { etat: 'pret', data: { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 16 }] } };
  assert.notEqual(L.place(plan, ch, l, 16 * G).etat, 'ok');
});

test('C2 relecture : un système « Installé » garde son ISO sur la clé (cle-ecrire la copie) et Odin garde une marge pour lui', () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(SYS_JS, { window: win, Intl });
  const L = (win.OdinGeneseCleSystemes as Sys).logique;
  const l = L.entrees(ISOS(), [], false);
  // 40 Go : Windows installé (32 Go) + son ISO 5,4 Go + Ubuntu 5,8 Go en ISO = 43,2 Go : ne tient pas.
  const ch = { 'iso:win11': { choix: 'installe' }, 'iso:ubuntu': { choix: 'iso' } };
  const plan = { etat: 'pret', data: { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 8 }, { role: 'WinToGo', tailleGo: 32 }] } };
  assert.equal(L.place(plan, ch, l, 40 * G).etat, 'trop');
  // Des ISO qui remplissent la clé à l'octet près : il ne reste rien pour le chargeur et les fichiers d'Odin.
  const pile = [{ id: 'p', name: 'ubuntu-pile', size: 16 * G, mtime: 1, recipe: { kind: 'ubuntu', os: 'linux' } }];
  const lp = L.entrees(pile, [], false);
  assert.equal(L.place({ etat: 'pret', data: { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 16 }] } }, { 'iso:p': { choix: 'iso' } }, lp, 16 * G).etat, 'trop');
});

test('C2 relecture : changer de clé à l\'étape 1 n\'ouvre pas l\'étape 4 avec le plan de l\'ancienne clé', async () => {
  const p = await page();
  await p.aller('faux-cle-64', 3);
  await p.ajouter('iso:alpine').emettre('click'); await attendre(); await attendre();
  assert.equal(p.placeEtat(), 'ok'); assert.equal(p.etape(4).disabled, false);
  await p.etape(1).emettre('click');
  await p.corps.querySelector('[data-cle="faux-cle-16"]')!.emettre('click');
  assert.equal(p.E.etat.cle, 'faux-cle-16');
  assert.equal(p.etape(4).disabled, true, 'aucun plan pour la clé de 16 Go : l\'étape 4 reste fermée');
});

test('C2 relecture : une réponse de cle_place pour l\'ancienne clé n\'est jamais prise pour la nouvelle', async () => {
  const p = await page({ retenir: true });
  await p.aller('faux-cle-64', 3);
  await p.ajouter('iso:alpine').emettre('click'); await attendre();
  assert.equal(p.placeEtat(), 'calcul');
  // Pendant le calcul pour la 64 Go : retour à l'étape 1, choix de la 16 Go, étape 2.
  await p.etape(1).emettre('click');
  await p.corps.querySelector('[data-cle="faux-cle-16"]')!.emettre('click');
  await p.etape(2).emettre('click');
  await p.lacher();
  await p.continuer().emettre('click'); await attendre();
  const avant = p.appels.filter((a) => a.action === 'cle_place').length;
  assert.notEqual(p.placeEtat(), 'ok', 'la place de la 64 Go n\'est pas celle de la 16 Go');
  assert.equal(p.continuer().disabled, true);
  await p.lacher();
  const dernieres = p.appels.filter((a) => a.action === 'cle_place');
  assert.ok(dernieres.length > avant || (dernieres.at(-1)!.input.cible as { id: string }).id === 'faux-cle-16');
  assert.equal((dernieres.at(-1)!.input.cible as { id: string }).id, 'faux-cle-16');
  assert.equal(p.placeEtat(), 'ok');
});

test('C2 relecture : la clé débranchée pendant l\'étape 3 est vue, et « Continuer » ne reste pas ouvert', async () => {
  let branchee = true;
  const p = await page({ disques: () => ({ externes: ici(branchee ? [CLE64, CLE16] : [CLE16]), internes: ici([SSD]) }) });
  await p.aller('faux-cle-64', 3);
  await p.ajouter('iso:alpine').emettre('click'); await attendre(); await attendre();
  assert.equal(p.continuer().disabled, false);
  branchee = false;
  await p.tic();
  assert.equal(p.E.etat.cle, null, 'la clé partie n\'est plus choisie');
  assert.equal(p.E.etat.etape, 1);
  assert.equal(p.etape(4).disabled, true);
});

test('C2 relecture : un nom de fichier piégé n\'est jamais envoyé, un nom d\'ISO piégé reste du texte', async () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(COMP_JS, { window: win });
  const ser = (win.OdinGeneseCleComposer as { logique: { serialiser: (s: Record<string, unknown>) => Record<string, unknown> } }).logique.serialiser;
  for (const f of ['../../etc/passwd', '..\\..\\Windows\\x.iso', '/etc/x.iso', 'C:\\x.iso', 'C:x.iso', '..', 'a/b.iso']) assert.equal(ser({ nom: 'x', famille: 'linux', choix: 'iso', fichier: f }).fichier, undefined, f);
  assert.equal(ser({ nom: 'x', famille: 'linux', choix: 'iso', fichier: 'ubuntu-24.04.iso' }).fichier, 'ubuntu-24.04.iso');
  // Un nom d'ISO qui ressemble à du code de page : écrit comme du texte, jamais comme du HTML.
  const p = await page();
  const piege = '<img src=x onerror=alert(1)>';
  (p.S.etat as unknown as { biblio: { etat: string; liste: unknown[] } }).biblio = { etat: 'pret', liste: [{ id: 'piege', name: piege, size: G, mtime: 1, recipe: { kind: 'ubuntu', os: 'linux' } }] };
  await p.aller('faux-cle-64', 3);
  assert.ok(p.corps.textContent.includes('<img'), 'le nom est montré tel quel');
  assert.ok(!p.corps.tous().some((n) => n.html.includes('onerror')), 'aucun innerHTML ne reçoit le nom');
});

test('C2 relecture : sur un disque, l\'étape fermée parle du disque', async () => {
  const win: Record<string, unknown> = {};
  vm.runInNewContext(SYS_JS, { window: win, Intl });
  assert.match((win.OdinGeneseCleSystemes as Sys).MOTS['etape.fermee.disque'] ?? '', /disque/);
});
