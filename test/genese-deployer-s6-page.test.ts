// Genèse · Déployer, lot S6 (la page) : étapes 4 « Logiciels et scripts », 5 « Options Windows », 6 « Vérifier ».
// La page de Genèse entière est montée dans un document minimal (le même que pour le lot S5), les réponses du serveur sont
// simulées ; le temps (Date.now, setInterval) est piloté par l'essai pour l'appui long de 3 s. Aucun réseau, aucun disque,
// aucun PC : on vérifie que la page ne demande « deployer » QUE si la phrase est juste ET l'appui a duré 3 s.
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

const LECTURES = new Set(['thjalfi.deployer_apercu', 'thjalfi.tableau', 'thjalfi.systemes', 'thjalfi.postes_vus', 'thjalfi.profils_logiciels', 'thjalfi.isos', 'thjalfi.cle_disques', 'thjalfi.cle_vms', 'thjalfi.cle_place', 'thjalfi.cle_logiciels', 'thjalfi.cle_apercu_script', 'thjalfi.deployer_apercu']);

/** La page de Genèse montée, ses demandes notées. */
async function page(o: { vm?: boolean; postesKo?: boolean; oui?: boolean; /** lot S11 : ce que la parole a préparé (rendu par « preparation_dite ») */ preparation?: unknown; /** lot C8 : le plan de place rendu par « cle_place » */ place?: unknown } = {}) {
  SOURCE = sourceDepart();
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ module: string; action: string; input: Record<string, any>; confirm?: boolean }> = [];
  let ko = Boolean(o.postesKo);
  const repondre = (module: string, action: string): unknown => {
    if (module === 'ymir' && action === 'creer_machine') return { ok: true, text: 'Machine vm-ubuntu-1 créée.' };
    if (module !== 'thjalfi') return { ok: false, text: 'refusé par l\'essai' };
    if (action === 'preparation_dite') return { ok: true, text: 'x', data: { preparation: o.preparation ?? null } };
    if (action === 'preparation_oublier') return { ok: true, text: 'oubliée' };
    if (action === 'deployer_apercu') return APERCU(appels.at(-1)!.input);
    if (action === 'deployer') return REPONSE_DEPLOYER(appels.at(-1)!.input);
    if (action === 'systemes') return SYSTEMES();
    if (action === 'postes_vus') return ko ? { ok: false, text: 'Réservé au propriétaire.' } : POSTES(o.vm !== false);
    if (action === 'profils_logiciels') return { ok: true, data: { profils: PROFILS, abimes: 0 } };
    if (action === 'tableau') return { ok: true, data: {} };
    if (action === 'cle_disques') return { ok: true, data: { externes: [ici(CLE64)], internes: [] } };
    if (action === 'isos') return { ok: true, data: ici(ISOS) };
    if (action === 'cle_vms') return { ok: true, data: [] };
    if (action === 'cle_place') return { ok: true, data: o.place ?? { possible: true, autresGo: 0 } };
    if (action === 'cle_logiciels') return { ok: true, data: { logiciels: [] } };
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ module: b.module, action: b.action, input: b.input, confirm: b.confirm === true }); return { json: async () => ici(repondre(b.module, b.action)) }; };
  const dialogues: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return Boolean(o.oui); }, alert: async (t: string) => { dialogues.push(t); }, prompt: async () => null } };
  const location = { hash: '' };
  const minuteurs = new Map<number, () => unknown>(); let nm = 0;
  let maintenant = Date.now();
  class FDate extends Date { constructor(...a: unknown[]) { if (a.length) super(...(a as [])); else super(maintenant); } static now() { return maintenant; } }
  const intervalles = new Map<number, () => unknown>(); let ni = 0;
  const ctx = { window, document, location, Node: Noeud, Intl, Date: FDate, setInterval: (f: () => unknown) => { intervalles.set(++ni, f); return ni; }, clearInterval: (i: number) => { intervalles.delete(i); }, setTimeout: (f: () => unknown) => { minuteurs.set(++nm, f); return nm; }, clearTimeout: (i: number) => { minuteurs.delete(i); }, fetch, createImageBitmap: undefined };
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
  /** Le temps passe (appui long) : les intervalles tournent toutes les 50 ms. */
  const tenir = async (ms: number) => { for (let k = 0; k < ms; k += 50) { maintenant += 50; for (const f of [...intervalles.values()]) await f(); } await calme(); };
  return { corps, q, qa, onglet, ouvrir, clic, touche, etape, appels, dialogues, window, tic, tenir, intervalles, actif: () => actif, nbMinuteurs: () => minuteurs.size, minuteurs, panne: (v: boolean) => { ko = v; } };
}
type Page = Awaited<ReturnType<typeof page>>;
/** Par le réseau jusqu'à l'étape « Postes ». */
async function versPostes(P: Page) { await P.ouvrir(); await P.clic('[data-cible="reseau"]'); await P.clic('[data-f="continuer"]'); assert.equal(P.etape(2).getAttribute('aria-current'), 'step'); }

// ------------------------------------------------------------------ ce que le serveur répondrait (lot S6)
const SCRIPT_PIEGE = '<img src=x onerror=alert(1)>';
const APERCU = (i: Record<string, any>) => {
  const win = i.iso === 'win11';
  return { ok: true, text: 'x', data: { os: win ? 'windows' : 'debian', systeme: win ? 'Win11_24H2_French_x64' : 'ubuntu', auto: true, profil: i.profil ? { id: i.profil, nom: 'Bureau' } : null,
    logiciels: i.profil ? [{ id: 'firefox', nom: 'Firefox', fichier: win ? 'Firefox Setup 140.exe' : 'firefox.deb', toutSeul: true }, { id: 'x', nom: 'Outil inconnu', fichier: win ? 'outil.exe' : 'outil.deb', toutSeul: false }] : [],
    scripts: i.profil ? [{ nom: 'reglage.ps1', ok: true }, { nom: 'piege.ps1', ok: false, raison: 'efface un disque' }] : [],
    script: `# installer-logiciels.ps1 ${SCRIPT_PIEGE}\nStart-Process firefox`, edition: win ? { id: 'pro', label: 'Windows 11 Pro' } : null, activation: win ? { edition: 'Windows 11 Pro', fin: '7F2A' } : null } };
};
let REPONSE_DEPLOYER = (i: Record<string, any>): unknown => ({ ok: true, text: 'Autorisé.', data: { lot: 'l1', facon: i.facon, iso: i.iso, pcs: (i.pcs as string[]).map((mac, k) => ({ mac, nom: `pc-0${k + 1}`, expire: 1, prochain: false })) } });

/** Par le réseau : deux PC, le système choisi, jusqu'à l'étape 4. */
async function versLogiciels(P: Page, sys = /^Ubuntu 24\.04\.1$/) {
  await versPostes(P);
  await P.clic('[data-poste="52:54:00:3a:91:0c"]'); await P.clic('[data-poste="52:54:00:7e:12:a4"]');
  await P.clic('[data-f="continuer"]');
  const c = P.qa('[data-sys]').find((b) => sys.test(b.querySelector('b')!.textContent))!; await c.emettre('click'); await calme();
  await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(4).getAttribute('aria-current'), 'step');
}

test('S6 · page : étape 4 — profil, liste pour ce système, script créé tout seul (du texte), tes scripts revérifiés', async () => {
  const P = await page(); await versLogiciels(P);
  assert.match(P.corps.textContent, /Installés tout seuls à la fin, sur chaque PC/);
  assert.equal(P.q('[data-profil="p-std"]')!.getAttribute('aria-pressed'), 'true', 'le premier profil proposé');
  assert.ok(P.appels.some((a) => a.action === 'deployer_apercu' && a.input.profil === 'p-std' && a.input.iso === 'ubuntu'), 'l\'aperçu est demandé au serveur');
  const logs = P.qa('[data-logiciel]');
  assert.equal(logs.length, 2); assert.match(logs[0].textContent, /Firefox.*tout seul/); assert.match(logs[1].textContent, /pas par le réseau/);
  const pre = P.q('[data-f="script"]')!;
  assert.match(pre.textContent, /<img src=x onerror=alert\(1\)>/, 'le script est montré comme du texte');
  assert.equal(P.corps.querySelectorAll('img').length, 0, 'aucune image créée par le texte du script');
  assert.equal(P.q('[data-script="piege.ps1"]')!.getAttribute('data-ok'), 'false'); assert.match(P.q('[data-script="piege.ps1"]')!.textContent, /refusé : efface un disque/);
  await P.clic('[data-profil="p-bur"]');
  assert.ok(P.appels.some((a) => a.action === 'deployer_apercu' && a.input.profil === 'p-bur'), 'changer de profil refait l\'aperçu');
  await P.clic('[data-f="profil-aucun"]');
  assert.match(P.corps.textContent, /Sans profil : seul le système s'installe/);
  // Ubuntu : pas d'étape Windows ; le nom de chaque PC se choisit ici.
  assert.ok(P.q('[data-f="noms-auto"]'), 'nom de chaque PC');
  await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(6).getAttribute('aria-current'), 'step', 'Linux : on saute l\'étape Windows');
  await P.clic('[data-f="rc-fin-changer"]'); await P.clic('[data-f="changer-logiciels"]');
  assert.equal(P.onglet('Logiciels').getAttribute('aria-selected'), 'true', '« Changer dans Logiciels »');
});

test('S6 · page : étape 5 — interrupteurs, nom du compte vérifié, mot de passe jamais montré, clé d\'activation masquée', async () => {
  const P = await page(); await versLogiciels(P, /^Windows 11/);
  await P.clic('[data-f="continuer"]');
  assert.equal(P.etape(5).getAttribute('aria-current'), 'step');
  for (const k of ['exigences', 'local', 'viePrivee', 'langue']) assert.equal(P.q(`[data-f="w-${k}"]`)!.getAttribute('aria-checked'), 'true', k);
  assert.equal(P.q('[data-f="w-local"]')!.getAttribute('role'), 'switch');
  assert.match(P.corps.textContent, /Le mot de passe est créé par Odin et rangé dans son coffre, un par PC/);
  assert.match(P.q('[data-f="act-auto"]')!.textContent, /Windows 11 Pro \(••••7F2A\)/, '4 derniers caractères seulement');
  const champ = P.q('[data-f="compte"]')!;
  champ.value = 'Awa/Admin'; await champ.emettre('input'); await calme();
  assert.equal(champ.getAttribute('aria-invalid'), 'true'); assert.equal(P.q('[data-f="continuer"]')!.disabled, true);
  champ.value = 'Awa'; await champ.emettre('input'); await calme();
  assert.equal(P.q('[data-f="continuer"]')!.disabled, false);
  await P.clic('[data-f="w-exigences"]');
  assert.equal(P.q('[data-f="w-exigences"]')!.getAttribute('aria-checked'), 'false');
  await P.clic('[data-f="act-aucune"]');
  await P.clic('[data-f="continuer"]');
  const w = P.q('[data-f="rc-win"]')!.textContent;
  assert.match(w, /Awa · mot de passe au coffre, un par PC/); assert.match(w, /gardées/); assert.match(w, /Activationaucune/);
});

test('S6 · page : étape 6 — PC par PC en rouge ; la phrase SEULE ne lance rien ; l\'appui SEUL non plus ; relâché tôt non plus', async () => {
  const P = await page(); await versLogiciels(P);
  await P.clic('[data-dp-etape="6"]');
  const pcs = P.q('[data-f="rc-pcs"]')!;
  assert.match(pcs.textContent, /Les PC · 2/);
  assert.deepEqual(pcs.querySelectorAll('[data-efface]').map((x) => x.getAttribute('data-efface')), ['52:54:00:3a:91:0c', '52:54:00:7e:12:a4']);
  assert.match(pcs.textContent, /pc-01 \(52:54:00:3a:91:0c\)disque effacé/);
  assert.equal(P.q('[data-phrase]')!.getAttribute('data-phrase'), 'effacer 2 pc');
  const bouton = () => P.q('[data-f="effacer"]')!;
  const deploie = () => P.appels.filter((a) => a.action === 'deployer');
  assert.equal(bouton().disabled, true, 'sans phrase : éteint');
  // L'appui SEUL (phrase pas tapée) : rien.
  await bouton().emettre('pointerdown'); await P.tenir(4000); await bouton().emettre('pointerup');
  assert.equal(deploie().length, 0, 'appui sans phrase : rien');
  // La phrase SEULE (un simple clic, Entrée relâchée tout de suite) : rien.
  const champ = P.q('[data-f="phrase"]')!; champ.value = 'effacer 2 PC'; await champ.emettre('input'); await calme();
  assert.equal(bouton().disabled, false);
  await bouton().emettre('click'); await P.tenir(200);
  await bouton().emettre('keydown', { key: 'Enter' }); await P.tenir(500); await bouton().emettre('keyup', { key: 'Enter' }); await P.tenir(3000);
  assert.equal(deploie().length, 0, 'phrase sans appui long : rien');
  // Relâché avant 3 s : rien, et la page le dit.
  await bouton().emettre('pointerdown'); await P.tenir(2500); await bouton().emettre('pointerleave'); await P.tenir(1000);
  assert.equal(deploie().length, 0); assert.match(P.q('[data-f="annonce"]')!.textContent, /Relâché trop tôt : rien n'est lancé/);
  // Une autre phrase : éteint.
  champ.value = 'effacer 3 pc'; await champ.emettre('input'); await calme();
  assert.equal(bouton().disabled, true);
  // La phrase juste ET 3 s d'appui : UNE demande, avec la confirmation, la phrase tapée et les réglages.
  champ.value = 'effacer 2 pc'; await champ.emettre('input'); await calme();
  await bouton().emettre('pointerdown'); await P.tenir(3100);
  assert.equal(deploie().length, 1);
  const d = deploie()[0];
  assert.equal(d.confirm, true); assert.equal(d.input.phrase, 'effacer 2 pc'); assert.deepEqual(d.input.pcs, ['52:54:00:3a:91:0c', '52:54:00:7e:12:a4']);
  assert.equal(d.input.facon, 'auto'); assert.equal(d.input.iso, 'ubuntu'); assert.equal(d.input.profil, 'p-std'); assert.equal(d.input.noms, 'auto');
  assert.match(P.q('[data-f="fait"]')!.textContent, /C'est autorisé/);
  P.window.OdinGeneseSuivi.dessiner = async () => {}; // l'onglet Suivi lui-même n'est pas l'objet de cet essai
  await P.clic('[data-f="suivi"]');
  assert.equal(P.onglet('Installations').getAttribute('aria-selected'), 'true', 'le lien « Suivi »');
});

test('S6 · page : refus du serveur montré ; « le proposer au menu » sans phrase ; le prochain PC compte dans la phrase', async () => {
  const P = await page(); await versLogiciels(P);
  REPONSE_DEPLOYER = () => ({ ok: false, text: 'Phrase incorrecte : il faut taper exactement « effacer 3 pc ».' });
  try {
    await P.clic('[data-dp-etape="2"]'); await P.clic('[data-f="prochain"]'); await P.clic('[data-dp-etape="6"]');
    assert.equal(P.q('[data-phrase]')!.getAttribute('data-phrase'), 'effacer 3 pc', 'deux PC + le prochain');
    assert.match(P.q('[data-f="rc-pcs"]')!.textContent, /Le prochain PC qui démarre \(30 min\)disque effacé/);
    const champ = P.q('[data-f="phrase"]')!; champ.value = 'effacer 3 pc'; await champ.emettre('input'); await calme();
    await P.q('[data-f="effacer"]')!.emettre('pointerdown'); await P.tenir(3100);
    assert.match(P.q('[data-f="annonce"]')!.textContent, /Refusé : Phrase incorrecte/);
    assert.equal(P.q('[data-f="fait"]'), null);
  } finally { REPONSE_DEPLOYER = (i) => ({ ok: true, text: 'Autorisé.', data: { pcs: (i.pcs as string[]).map((mac, k) => ({ mac, nom: `pc-0${k + 1}` })) } }); }
  const M = await page(); await versLogiciels(M);
  await M.clic('[data-dp-etape="2"]'); await M.clic('[data-facon="menu"]'); await M.clic('[data-dp-etape="6"]');
  assert.equal(M.q('[data-f="danger"]'), null, 'rien à effacer : pas de phrase');
  assert.match(M.q('[data-f="rc-pcs"]')!.textContent, /proposé au menu/);
  await M.clic('[data-f="proposer-menu"]');
  const d = M.appels.filter((a) => a.action === 'deployer');
  assert.equal(d.length, 1); assert.equal(d[0].input.facon, 'menu'); assert.equal(d[0].input.phrase, undefined);
});

test('S6 · page : machine virtuelle — « Créer la machine » par Hydre, seulement après ta confirmation', async () => {
  for (const oui of [false, true]) {
    const P = await page({ oui }); await P.ouvrir();
    await P.clic('[data-cible="vm"]'); await P.clic('[data-f="continuer"]'); await P.clic('[data-f="continuer"]');
    const u = P.qa('[data-sys]').find((b) => /^Ubuntu/.test(b.querySelector('b')!.textContent))!; await u.emettre('click'); await calme();
    await P.clic('[data-dp-etape="6"]');
    assert.match(P.corps.textContent, /Avant de créer/); assert.equal(P.q('[data-f="danger"]'), null, 'rien n\'est effacé : pas de phrase');
    await P.clic('[data-f="creer-vm"]');
    assert.equal(P.dialogues.length, 1); assert.match(P.dialogues[0], /Créer la machine virtuelle « vm-ubuntu-1 »/);
    const c = P.appels.filter((a) => a.module === 'ymir');
    if (!oui) { assert.equal(c.length, 0, 'refusé : rien n\'est créé'); assert.match(P.q('[data-f="annonce"]')!.textContent, /Annulé/); continue; }
    assert.equal(c.length, 1); assert.equal(c[0].action, 'creer_machine'); assert.equal(c[0].input.genre, 'vm'); assert.equal(c[0].input.nom, 'vm-ubuntu-1'); assert.equal(c[0].confirm, true);
    assert.match(P.q('[data-f="annonce"]')!.textContent, /créée/);
  }
});

test('S6 · page : logique pure — phrase, appui, compte, noms (les mêmes règles que le serveur)', async () => {
  const P = await page();
  const L = P.window.OdinGeneseDeployer.logique;
  assert.equal(L.phrasePour(2), 'effacer 2 pc');
  assert.equal(L.phraseOk(' Effacer  2  PC ', 'effacer 2 pc'), true); assert.equal(L.phraseOk('effacer 2 pc', ''), false);
  assert.equal(L.peutLancer({ phraseOk: true, appuiMs: 2999 }), false); assert.equal(L.peutLancer({ phraseOk: false, appuiMs: 9000 }), false); assert.equal(L.peutLancer({ phraseOk: true, appuiMs: 3000 }), true);
  assert.equal(L.nomCompteOk('Awa'), true); assert.equal(L.nomCompteOk('a/b'), false); assert.equal(L.nomCompteOk('x'.repeat(21)), false); assert.equal(L.nomCompteOk('Awa.'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(L.nomsPcs([{ mac: 'a' }, { mac: 'b' }], 'auto'))), ['pc-01', 'pc-02']);
  const { nomsDesPcs } = await import('../src/valhalla/thjalfi/recipes.ts');
  const cas = [{ mac: '52:54:00:3a:91:0c', vu: 'Bureau Été' }, { mac: '52:54:00:7e:12:a4', vu: 'bureau-ete' }, { mac: '52:54:00:c1:5b:77' }, { mac: '', vu: '' }];
  for (const f of ['auto', 'vu'] as const) assert.deepEqual(JSON.parse(JSON.stringify(L.nomsPcs(cas, f))), nomsDesPcs(cas, f), `mêmes noms que le serveur (${f})`);
});

// ------------------------------------------------------------------ lots S11 et C8 : ce que la parole a préparé
test('S11 · page : une préparation dite ouvre « Vérifier » pré-rempli ; la phrase et l\'appui long restent à faire ici', async () => {
  const prep = { sorte: 'reseau', at: Date.now() - 60_000, expire: Date.now() + 20 * 60_000, systemes: [{ iso: 'ubuntu', nom: 'Ubuntu' }], pcs: [{ mac: '52:54:00:3a:91:0c' }, { mac: '52:54:00:7e:12:a4' }], facon: 'auto', phrase: 'effacer 2 pc', appui: true };
  const P = await page({ preparation: prep }); await P.ouvrir();
  assert.equal(P.etape(6).getAttribute('aria-current'), 'step', 'la page s\'ouvre sur « Vérifier »');
  assert.match(P.q('[data-f="parole-note"]')!.textContent, /Préparé par la parole .* la phrase à taper et l'appui long restent à faire ici/);
  assert.deepEqual(P.q('[data-f="rc-pcs"]')!.querySelectorAll('[data-efface]').map((x) => x.getAttribute('data-efface')), ['52:54:00:3a:91:0c', '52:54:00:7e:12:a4']);
  assert.equal(P.q('[data-phrase]')!.getAttribute('data-phrase'), 'effacer 2 pc');
  // la préparation est reprise une seule fois (Odin l'oublie), et RIEN n'est parti
  assert.equal(P.appels.filter((a) => a.action === 'preparation_oublier').length, 1);
  const deploie = () => P.appels.filter((a) => a.action === 'deployer');
  assert.equal(deploie().length, 0);
  // la phrase n'est PAS pré-remplie, le bouton est éteint ; l'appui seul ne lance rien
  const champ = P.q('[data-f="phrase"]')!, bouton = () => P.q('[data-f="effacer"]')!;
  assert.equal(champ.value, '', 'la phrase n\'est jamais reprise'); assert.equal(bouton().disabled, true);
  await bouton().emettre('pointerdown'); await P.tenir(4000); await bouton().emettre('pointerup');
  assert.equal(deploie().length, 0, 'appui sans phrase : rien');
  // la phrase tapée seule : rien non plus
  champ.value = 'effacer 2 pc'; await champ.emettre('input'); await calme();
  await bouton().emettre('click'); await P.tenir(500);
  assert.equal(deploie().length, 0, 'phrase sans appui long : rien');
  // la phrase ET l'appui de 3 s, faits ici : une demande, avec ce qui était préparé
  await bouton().emettre('pointerdown'); await P.tenir(3100);
  assert.equal(deploie().length, 1);
  const d = deploie()[0];
  assert.equal(d.confirm, true); assert.equal(d.input.phrase, 'effacer 2 pc'); assert.deepEqual(d.input.pcs, ['52:54:00:3a:91:0c', '52:54:00:7e:12:a4']); assert.equal(d.input.iso, 'ubuntu'); assert.equal(d.input.facon, 'auto'); assert.equal(d.input.prochain, false);
});

test('S11 · page : une préparation qui ne colle pas à ce que la page voit n\'est pas reprise (ni à moitié)', async () => {
  const base = { sorte: 'reseau', at: Date.now() - 60_000, expire: Date.now() + 20 * 60_000, systemes: [{ iso: 'ubuntu', nom: 'Ubuntu' }], pcs: [{ mac: '52:54:00:3a:91:0c' }], facon: 'auto' };
  const refusees: Array<[string, unknown]> = [
    ['un PC bloqué', { ...base, pcs: [{ mac: '52:54:00:3a:91:0c' }, { mac: '52:54:00:08:e2:3d' }] }],
    ['un PC jamais vu', { ...base, pcs: [{ mac: '52:54:00:99:99:99' }] }],
    ['une adresse mal écrite', { ...base, pcs: [{ mac: 'ff:ff:ff:ff:ff:ff' }] }],
    ['un système qui n\'est pas déployable', { ...base, systemes: [{ iso: 'fedora', nom: 'Fedora' }] }],
    ['deux systèmes', { ...base, systemes: [{ iso: 'ubuntu', nom: 'a' }, { iso: 'win11', nom: 'b' }] }],
    ['périmée', { ...base, expire: Date.now() - 1 }],
    ['trop longue', { ...base, expire: Date.now() + 24 * 3600_000 }],
    ['datée du futur', { ...base, at: Date.now() + 3600_000, expire: Date.now() + 3700_000 }],
    ['pour une clé', { ...base, sorte: 'cle', cle: { id: 'x', tailleOctets: 1, modele: 'x' } }],
  ];
  for (const [quoi, prep] of refusees) {
    const P = await page({ preparation: prep }); await P.ouvrir();
    assert.equal(P.etape(1).getAttribute('aria-current'), 'step', quoi); assert.equal(P.q('[data-f="parole-note"]'), null, quoi);
    assert.equal(P.appels.filter((a) => a.action === 'preparation_oublier' || a.action === 'deployer').length, 0, quoi);
    assert.equal(P.window.OdinGeneseDeployer.etat.pcs.length, 0, quoi); assert.equal(P.window.OdinGeneseDeployer.etat.sys, '', quoi);
  }
  // « le proposer au menu » : repris tel quel (aucun disque effacé), la confirmation reste à donner
  const M = await page({ preparation: { ...base, facon: 'menu' } }); await M.ouvrir();
  assert.equal(M.etape(6).getAttribute('aria-current'), 'step'); assert.equal(M.window.OdinGeneseDeployer.etat.facon, 'menu');
  assert.equal(M.appels.filter((a) => a.action === 'deployer').length, 0);
  // revenir changer un choix : la mention « par la parole » s'efface (les choix sont maintenant les tiens)
  await M.clic('[data-dp-etape="2"]'); await M.clic('[data-dp-etape="6"]');
  assert.equal(M.q('[data-f="parole-note"]'), null);
});

const PLACE_OK = { possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 60 }, { role: 'EFI', tailleGo: 0.03 }] };
test('C8 · page : une préparation dite pour une clé reprend la clé et le système, puis ouvre « Vérifier » ; la phrase reste à taper', async () => {
  const prep = { sorte: 'cle', at: Date.now() - 60_000, expire: Date.now() + 20 * 60_000, systemes: [{ iso: 'ubuntu', nom: 'Ubuntu' }], cle: { id: CLE64.id, tailleOctets: CLE64.tailleOctets, modele: CLE64.modele }, phrase: 'x' };
  const P = await page({ preparation: prep, place: PLACE_OK });
  const cles = P.onglet('Clé USB'); assert.ok(cles, 'l\'onglet « Clés USB »'); await cles.emettre('click'); await calme(); await P.tic(); await calme();
  const ET = P.window.OdinGeneseCleEtapes.etat, SY = P.window.OdinGeneseCleSystemes.etat;
  assert.equal(ET.cle, CLE64.id, 'la clé préparée est choisie'); assert.equal(Object.keys(SY.choisis).join(','), 'iso:ubuntu', 'un seul système : celui préparé');
  assert.equal(ET.etape, 6, 'la page est passée à « Vérifier » une fois la place calculée');
  assert.match(P.q('[data-f="parole-note"]')!.textContent, /Préparé par la parole .* la phrase à taper reste à donner ici/);
  assert.equal(P.appels.filter((a) => a.action === 'preparation_oublier').length, 1);
  const champ = P.q('[data-f="phrase"]'), bouton = P.q('[data-f="ecrire"]');
  assert.ok(champ && bouton, 'l\'étape « Vérifier » de la clé est affichée'); assert.equal(champ!.value, '', 'la phrase n\'est jamais reprise'); assert.equal(bouton!.disabled, true, 'sans la phrase tapée ici : le bouton est éteint');
  assert.equal(P.appels.filter((a) => a.action === 'cle_preparer' || a.action === 'cle_appliquer' || a.action === 'cle_changer').length, 0, 'rien n\'est écrit');
  // une autre clé à sa place (autre taille), ou une préparation pour des PC : pas reprise
  for (const autre of [{ ...prep, cle: { ...prep.cle, tailleOctets: 32 * G } }, { ...prep, cle: { ...prep.cle, id: 'faux-interne' } }, { ...prep, sorte: 'reseau', pcs: [{ mac: '52:54:00:3a:91:0c' }] }, { ...prep, expire: Date.now() - 1 }]) {
    const Q = await page({ preparation: autre, place: PLACE_OK });
    await Q.onglet('Clé USB').emettre('click'); await calme(); await Q.tic(); await calme();
    assert.equal(Q.window.OdinGeneseCleEtapes.etat.cle, null); assert.equal(Q.window.OdinGeneseCleEtapes.etat.etape, 1);
    assert.equal(Q.appels.filter((a) => a.action === 'preparation_oublier').length, 0);
  }
});
