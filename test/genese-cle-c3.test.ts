// Genèse · Clés USB, lot C3 de la maquette validée : l'étape 4 « Logiciels et scripts » et l'étape 5 « Options Windows ».
// - Un onglet par Windows ou Linux choisi à l'étape 3 ; les logiciels déjà téléchargés, filtrés par OS (la VRAIE action
//   cle_logiciels, sur une bibliothèque fausse) ; le script créé tout seul suit les choix (la VRAIE action
//   cle_apercu_script) ; tes scripts : ajouter, ordonner, retirer, refusés par l'antivirus d'Odin quand ils sont dangereux.
// - L'étape 5 n'existe que si un Windows est choisi ; la clé d'activation n'est jamais montrée en entier (4 derniers
//   caractères) ; clavier ; seules des lectures partent.
// Aucun navigateur, aucun réseau, aucun vrai disque, aucune vraie clé : tout est faux, dans des dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { cleUsb } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { deposerCle } from '../src/valhalla/thjalfi/cles-windows.ts';
import { thjalfi } from '../src/valhalla/modules/thjalfi.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const src = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const ETAPES_JS = src('thjalfi-cle-etapes.js'), CLE_JS = src('thjalfi-cle.js'), COMP_JS = src('thjalfi-cle-composer.js'), SYS_JS = src('thjalfi-cle-systemes.js');
let LOG_JS = '';
try { LOG_JS = src('thjalfi-cle-logiciels.js'); } catch { /* avant le lot C3 : le fichier n'existe pas */ }
const G = 1024 ** 3;
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ données fausses
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const SSD = { id: 'faux-ssd', chemin: 'faux-0', modele: 'SSD interne 512 Go', serie: 'SSD0000FAUX1', tailleOctets: 512 * G, genre: 'interne', externe: false, bus: 'nvme', amovible: false, systemeEnCours: true, partitions: [] };
const DISQUES = () => ({ externes: ici([CLE64]), internes: ici([SSD]) });
const iso = (id: string, name: string, go: number, recipe: Record<string, unknown>) => ({ id, name, path: `faux/${name}.iso`, size: Math.round(go * G), mtime: 1, recipe });
const ISOS = () => ici([
  iso('ubuntu', 'ubuntu-24.04-desktop-amd64', 5.8, { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' }),
  iso('win11', 'Win11_Pro_24H2_faux_x64', 5.4, { kind: 'windows', label: 'Windows', auto: true, os: 'windows' }),
  iso('gparted', 'gparted-live-1.6.0-amd64', 0.6, { kind: 'casper', label: 'GParted', auto: false, os: 'outil' }),
]);
// La bibliothèque d'Hermès, FAUSSE : des installateurs Windows et Linux, et un logiciel pour un autre système.
const FICHES = [
  { source: 'firefox', nom: 'Firefox', fichier: 'Firefox-Setup-faux.exe' },
  { source: 'vlc', nom: 'VLC', fichier: 'vlc-faux.exe' },
  { id: 'pilote', nom: 'Pilote imprimante', fichier: 'pilote-faux-setup.exe' },
  { nom: 'GIMP', fichier: 'gimp-faux.deb' },
  { nom: 'Outil portable', fichier: 'outil-faux.AppImage' },
  { nom: 'Pour Mac', fichier: 'mac-faux.dmg' },
];
// Une clé d'activation manifestement FAUSSE (format seulement) : jamais une vraie.
const CLE_FAUSSE = 'FAUX0-FAUX1-FAUX2-FAUX3-ZQ7K9';

// Les VRAIES actions du serveur, sur des données fausses.
const actionsCle = cleUsb().actions;
const placeServeur = actionsCle.find((a) => a.id === 'cle_place')!;
const logServeur = actionsCle.find((a) => a.id === 'cle_logiciels')!;
const module = thjalfi();
const apercuServeur = module.actions.find((a) => a.id === 'cle_apercu_script');
const home = mkdtempSync(join(tmpdir(), 'odin-c3-home-')), dir = mkdtempSync(join(tmpdir(), 'odin-c3-dir-'));
const ctxServeur = {
  home, dir, settings: { cleDisquesTest: [...DISQUES().externes, ...DISQUES().internes] },
  run: async () => { throw new Error('aucune commande dans l\'essai'); },
  call: async (m: string, a: string) => { if (m === 'fjalar' && a === 'etat') return { ok: true, text: '', data: { fichiers: ici(FICHES) } }; throw new Error('aucun autre appel dans l\'essai'); },
} as unknown as ModCtx;
/** Les actions qui ne font que LIRE (leur définition dit read: true). */
const lectures = new Set([...module.actions, ...actionsCle].filter((a) => a.read === true).map((a) => a.id));

// ------------------------------------------------------------------ un document minimal (comme genese-cle-c2)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; html = ''; value?: string; files?: unknown[];
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
  set textContent(t: string) { this.replaceChildren(new Texte(String(t))); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  private ajouter(k: Noeud | string) { const n = typeof k === 'object' ? k : new Texte(String(k)); n.parent?.retirer(n); n.parent = this; this.enfants.push(n); }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | string>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string>) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.append(...ks); }
  get childNodes() { return [...this.enfants]; }
  remove() { this.parent?.retirer(this); }
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
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
const calme = async () => { for (let k = 0; k < 10; k++) await attendre(); };

/** La page de Genèse montée avec les cinq fichiers, sur des données fausses. */
async function page() {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, get activeElement() { return actif; }, hidden: false,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, unknown> }> = [];
  const reponses: Array<{ data?: unknown }> = [];
  const post = async (action: string, input: Record<string, unknown> = {}) => {
    appels.push({ action, input: ici(input) });
    if (action === 'cle_disques') return { ok: true, data: DISQUES() };
    if (action === 'isos') return { ok: true, data: ISOS() };
    if (action === 'cle_vms') return { ok: true, data: [] };
    if (action === 'cle_place') return ici(await placeServeur.run(ctxServeur, ici(input)));
    if (action === 'cle_logiciels') return ici(await logServeur.run(ctxServeur, ici(input)));
    if (action === 'cle_apercu_script' && apercuServeur) { const r = ici(await apercuServeur.run(ctxServeur, ici(input))); reponses.push(r); return r; }
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => false, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, Node: Noeud, Intl, TextEncoder, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout, fetch: async () => { throw new Error('aucun réseau dans l\'essai'); } };
  for (const js of [COMP_JS, ETAPES_JS, CLE_JS, SYS_JS, LOG_JS]) if (js) vm.runInNewContext(js, ctx);
  const n0 = new Noeud('div');
  await (window.OdinGeneseCle as { dessiner: (r: Noeud, t: string, h: unknown) => Promise<void> }).dessiner(n0, 'cle', { post, act: post });
  corps.append(...n0.childNodes);
  const L = window.OdinGeneseCleLogiciels as { MOTS: Record<string, string>; etat: { scripts: Array<{ nom: string; etat: string }> } } | undefined;
  const E = window.OdinGeneseCleEtapes as { etat: { etape: number } };
  const M: Record<string, string> = { ...(L ? L.MOTS : {}) };
  const q = (s: string) => corps.querySelector(s);
  const etape = (k: number) => q(`[data-etape="${k}"]`)!;
  const continuer = () => q('[data-f="continuer"]')!;
  const onglets = () => corps.querySelectorAll('[role="tablist"] [role="tab"]').filter((b) => b.getAttribute('data-ong'));
  const logiciels = () => corps.querySelectorAll('[data-sw]').map((b) => b.getAttribute('data-sw'));
  const apercu = () => q('[data-apercu]');
  /** Choisit la clé, des systèmes à l'étape 3, puis va à l'étape 4. */
  const aller = async (systemes: string[]) => {
    await q('[data-cle="faux-cle-64"]')!.emettre('click');
    await etape(2).emettre('click');
    await continuer().emettre('click'); await calme();
    for (const id of systemes) { await q(`[data-sys="${id}"]`)!.emettre('click'); await calme(); }
    await continuer().emettre('click'); await calme();
  };
  /** Ajoute un script comme si on l'avait choisi dans un fichier. */
  const ajouter = async (nom: string, contenu: string) => {
    const f = q('[data-f="scr-fichier"]');
    assert.ok(f, 'le choix d\'un fichier de script existe');
    f!.files = [{ name: nom, size: Buffer.byteLength(contenu), text: async () => contenu }];
    await f!.emettre('change'); await calme();
  };
  return { corps, appels, reponses, M, L, E, q, etape, continuer, onglets, logiciels, apercu, aller, ajouter, actif: () => actif };
}

// ------------------------------------------------------------------ étape 4
test('C3 : un onglet par Windows ou Linux choisi (pas pour un outil), au clavier', async () => {
  const p = await page();
  await p.aller(['iso:ubuntu', 'iso:win11', 'iso:gparted']);
  assert.equal(p.E.etat.etape, 4);
  assert.equal(p.etape(4).getAttribute('aria-current'), 'step');
  assert.ok(p.q('[role="tablist"][aria-label]'), 'les onglets des systèmes forment une liste d\'onglets');
  const t = p.onglets();
  assert.deepEqual(t.map((b) => b.getAttribute('data-ong')), ['iso:ubuntu', 'iso:win11'], 'GParted (un outil) n\'a pas d\'onglet');
  assert.deepEqual(t.map((b) => b.getAttribute('aria-selected')), ['true', 'false']);
  assert.match(p.corps.textContent, new RegExp(p.M['log.titre']));
  // Flèche à droite : l'onglet suivant est pris et garde le focus ; Fin / Début.
  await t[0].emettre('keydown', { key: 'ArrowRight' }); await calme();
  assert.deepEqual(p.onglets().map((b) => b.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(p.actif()?.getAttribute('data-ong'), 'iso:win11');
  await p.onglets()[1].emettre('keydown', { key: 'Home' }); await calme();
  assert.equal(p.actif()?.getAttribute('data-ong'), 'iso:ubuntu');
  assert.equal(p.onglets()[0].getAttribute('tabindex'), '0'); assert.equal(p.onglets()[1].getAttribute('tabindex'), '-1');
});

test('C3 : les logiciels sont filtrés par OS, chacun marqué « tout seul » ou « te posera des questions »', async () => {
  const p = await page();
  await p.aller(['iso:ubuntu', 'iso:win11']);
  assert.deepEqual(p.logiciels(), ['gimp-faux.deb', 'outil-faux.AppImage'], 'Linux : seulement les paquets Linux');
  await p.q('[data-ong="iso:win11"]')!.emettre('click'); await calme();
  assert.deepEqual(p.logiciels(), ['Firefox-Setup-faux.exe', 'vlc-faux.exe', 'pilote-faux-setup.exe'], 'Windows : seulement les installateurs Windows');
  assert.ok(!p.corps.textContent.includes('mac-faux.dmg'), 'un logiciel pour un autre système n\'est jamais proposé');
  const ligne = (f: string) => p.q(`[data-sw="${f}"]`)!;
  assert.match(ligne('Firefox-Setup-faux.exe').textContent, new RegExp(p.M['log.seul']));
  assert.match(ligne('pilote-faux-setup.exe').textContent, new RegExp(p.M['log.questions']));
  assert.equal(ligne('vlc-faux.exe').getAttribute('role'), 'checkbox');
  const demandes = p.appels.filter((a) => a.action === 'cle_logiciels').map((a) => a.input.os);
  assert.deepEqual([...new Set(demandes)].sort(), ['linux', 'windows'], 'la liste est demandée pour l\'OS de l\'onglet');
});

test('C3 : le script créé tout seul suit les choix, en direct', async () => {
  const p = await page();
  await p.aller(['iso:ubuntu', 'iso:win11']);
  await p.q('[data-ong="iso:win11"]')!.emettre('click'); await calme();
  assert.equal(p.apercu()?.getAttribute('data-apercu'), 'apres.ps1', 'Windows : le script de fin est montré d\'abord');
  assert.ok(!p.apercu()!.textContent.includes('Firefox-Setup-faux.exe'));
  await p.q('[data-sw="Firefox-Setup-faux.exe"]')!.emettre('click'); await calme();
  assert.equal(p.q('[data-sw="Firefox-Setup-faux.exe"]')!.getAttribute('aria-checked'), 'true');
  assert.match(p.apercu()!.textContent, /Firefox-Setup-faux\.exe/, 'coché : il entre dans le script');
  assert.match(p.apercu()!.textContent, /-ms/, 'avec son option silencieuse connue');
  await p.q('[data-sw="pilote-faux-setup.exe"]')!.emettre('click'); await calme();
  assert.ok(!p.apercu()!.textContent.includes('pilote-faux-setup.exe'), 'sans mode silencieux connu : copié, jamais lancé en silencieux');
  await p.q('[data-sw="Firefox-Setup-faux.exe"]')!.emettre('click'); await calme();
  assert.ok(!p.apercu()!.textContent.includes('Firefox-Setup-faux.exe'), 'décoché : il sort du script');
  // Le fichier de réponses Windows (et ses noms de composants) est montré à l'étape « Vérifier », pas ici.
  assert.equal(p.q('[data-fic="autounattend.xml"]'), null);
  assert.ok(!/Microsoft|Rufus|Ventoy/.test(p.corps.textContent), 'aucun nom copié à l\'écran');
  // Linux : user-data, avec le paquet coché.
  await p.q('[data-ong="iso:ubuntu"]')!.emettre('click'); await calme();
  await p.q('[data-sw="gimp-faux.deb"]')!.emettre('click'); await calme();
  assert.equal(p.apercu()?.getAttribute('data-apercu'), 'user-data');
  // Lot C4 (point 5) : le paquet est lu dans l'archive d'injection (/odin), pas dans /cdrom (l'ISO elle-même).
  assert.match(p.apercu()!.textContent, /\/odin\/logiciels\/gimp-faux\.deb/);
  assert.ok(!/\$6\$/.test(p.apercu()!.textContent), 'aucune empreinte de mot de passe dans l\'aperçu');
});

test('C3 : tes scripts — ajouter, ordonner, retirer ; l\'antivirus d\'Odin refuse un script dangereux ; montrés comme du texte', async () => {
  const p = await page();
  await p.aller(['iso:win11']);
  await p.ajouter('reseau.ps1', 'Write-Host "réseau"');
  await p.ajouter('heure.cmd', 'echo <b>heure</b>');
  const noms = () => p.corps.querySelectorAll('[data-scr]').map((x) => x.getAttribute('data-scr'));
  assert.deepEqual(noms(), ['reseau.ps1', 'heure.cmd']);
  assert.deepEqual(ici(p.L!.etat.scripts.map((x) => x.etat)), ['ok', 'ok'], 'vérifiés par l\'antivirus d\'Odin, acceptés');
  const ordre = () => (p.apercu()!.textContent.match(/\d\d-[\w.]+\.(ps1|cmd)/g) ?? []);
  assert.deepEqual(ordre(), ['01-reseau.ps1', '02-heure.cmd'], 'lancés dans l\'ordre, après les logiciels');
  // Descendre le premier : l'ordre change dans la page et dans le script.
  const premier = p.corps.querySelectorAll('[data-scr]')[0];
  const bas = premier.querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-down-'))!;
  assert.equal(premier.querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-up-'))!.disabled, true, 'le premier ne monte pas');
  await bas.emettre('click'); await calme();
  assert.deepEqual(noms(), ['heure.cmd', 'reseau.ps1']);
  assert.deepEqual(ordre(), ['01-heure.cmd', '02-reseau.ps1']);
  assert.equal(p.actif()?.getAttribute('data-f'), bas.getAttribute('data-f'), 'le focus reste sur le bouton');
  // Voir : le contenu est du texte, jamais du code de page.
  const voir = p.corps.querySelectorAll('[data-scr]')[0].querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-voir-'))!;
  await voir.emettre('click'); await calme();
  const montre = p.corps.querySelectorAll('[data-scr]')[0].querySelector('pre')!;
  assert.equal(montre.textContent, 'echo <b>heure</b>');
  assert.equal(montre.querySelector('b'), null); assert.equal(montre.html, '');
  // Un script dangereux : refusé par l'antivirus, avec la raison ; il n'entre pas dans le script.
  await p.ajouter('menage.cmd', 'vssadmin delete shadows /all /quiet');
  const refus = p.L!.etat.scripts.find((x) => x.nom === 'menage.cmd')!;
  assert.equal(refus.etat, 'refuse');
  // Refusé par le filtre des commandes qui effacent un disque (avant même l'antivirus d'Odin), avec la raison.
  assert.match(p.corps.textContent, /antivirus d'Odin l'a refusé|effacer un disque entier/);
  assert.ok(!ordre().some((x) => x.includes('menage')), 'refusé : jamais lancé');
  // Un script pour un autre système, ou trop gros : refusé avant même d'être envoyé.
  const avant = p.appels.length;
  await p.ajouter('linux.sh', 'echo linux');
  assert.match(p.corps.textContent, /n'est pas un script pour Windows/);
  await p.ajouter('gros.ps1', 'x'.repeat(70 * 1024));
  assert.match(p.corps.textContent, /trop gros/);
  assert.ok(!p.appels.slice(avant).some((a) => JSON.stringify(a.input).includes('echo linux')), 'rien n\'est envoyé pour un mauvais fichier');
  // Retirer.
  const rm = p.corps.querySelectorAll('[data-scr]').find((x) => x.getAttribute('data-scr') === 'reseau.ps1')!.querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-rm-'))!;
  await rm.emettre('click'); await calme();
  assert.deepEqual(noms(), ['heure.cmd', 'menage.cmd']);
  assert.deepEqual(ordre(), ['01-heure.cmd']);
});

// ------------------------------------------------------------------ étape 5
test('C3 : sans Windows, l\'étape « Options Windows » n\'existe pas (grisée, sautée)', async () => {
  const p = await page();
  await p.aller(['iso:ubuntu']);
  assert.equal(p.E.etat.etape, 4);
  assert.equal(p.etape(5).disabled, true, 'grisée sans Windows');
  await p.etape(5).emettre('click');
  assert.equal(p.E.etat.etape, 4, 'un clic ne l\'ouvre pas');
  await p.continuer().emettre('click'); await calme();
  assert.equal(p.E.etat.etape, 6, 'de 4 on passe directement à 6');
  assert.ok(!p.corps.textContent.includes(p.M['win.titre']));
  // Avec un Windows, elle s'ouvre.
  const q = await page();
  await q.aller(['iso:win11']);
  assert.equal(q.etape(5).disabled, false);
  await q.continuer().emettre('click'); await calme();
  assert.equal(q.E.etat.etape, 5);
  assert.match(q.corps.textContent, new RegExp(q.M['win.titre']));
  const sw = q.corps.querySelectorAll('[role="switch"][data-win]').map((b) => [b.getAttribute('data-win'), b.getAttribute('aria-checked')]);
  assert.deepEqual(sw, [['exigences', 'true'], ['local', 'true'], ['viePrivee', 'true'], ['langue', 'true']]);
  assert.equal(q.q('[data-dsq="vide"]'), null, 'aucun disque n\'est effacé tout seul : cette voie n\'est pas proposée, même grisée');
  assert.equal(q.q('[data-dsq="choisir"]')!.getAttribute('aria-pressed'), 'true');
});

test('C3 · relecture : un script d\'un système retiré ne bloque plus l\'étape 4 ; pas de « font » invalide', async () => {
  const p = await page();
  await p.aller(['iso:win11']);
  // Un script Linux resté « en vérification » (l'aperçu Linux n'a jamais répondu) alors qu'aucun Linux n'est plus choisi.
  (p.L!.etat.scripts as unknown as Array<Record<string, unknown>>).push({ uid: 'sX', nom: 'l.sh', contenu: 'echo l', os: 'linux', etat: 'verif', raison: '' });
  await p.etape(4).emettre('click'); await calme();
  assert.equal(p.continuer().disabled, false, 'rien n\'attend un Linux qui n\'est plus choisi');
  const LG = p.L as unknown as { pourComposeur: (c: unknown[]) => { scripts: unknown[] } };
  (p.L!.etat.scripts as unknown as Array<Record<string, unknown>>).at(-1)!.etat = 'ok';
  assert.equal(LG.pourComposeur([]).scripts.length, 0, 'un script Linux ne part pas sans Linux');
  assert.ok(LOG_JS.includes('.ckl-tab{'));
  assert.doesNotMatch(LOG_JS, /font:[^;}'`]*\S\s+inherit/, '« font: … inherit » est invalide : la règle entière serait ignorée');
});

test('C3 : la clé d\'activation du coffre n\'est jamais montrée en entier (4 derniers caractères)', async () => {
  deposerCle(home, dir, 'windows-11-pro', CLE_FAUSSE);
  const p = await page();
  await p.aller(['iso:win11']);
  await p.continuer().emettre('click'); await calme();
  const bouton = p.q('[data-act="windows-11-pro"]');
  assert.ok(bouton, 'la clé du coffre reconnue pour l\'image est proposée');
  assert.equal(bouton!.getAttribute('aria-pressed'), 'true', 'prise par défaut');
  assert.match(bouton!.textContent, /••••Q7K9/);
  assert.ok(bouton!.textContent.includes('Q7K9'), '4 derniers caractères');
  assert.ok(!bouton!.textContent.includes('ZQ7K9'), 'pas 5');
  const tout = JSON.stringify(p.appels) + p.corps.textContent;
  for (const morceau of ['FAUX0', 'FAUX1', 'FAUX2', 'FAUX3', 'ZQ7K9', CLE_FAUSSE]) assert.ok(!tout.includes(morceau), `jamais « ${morceau} » dans la page ni dans les échanges`);
  // Le fichier de réponses reçu par la page porte la clé masquée ; « Aucune » la retire.
  const xml = () => String((p.reponses.at(-1)?.data as { fichiers?: Record<string, string> } | undefined)?.fichiers?.['autounattend.xml'] ?? '');
  assert.match(xml(), /<Key>•••••-•••••-•••••-•••••-•Q7K9<\/Key>/);
  assert.ok(!JSON.stringify(p.reponses).includes('ZQ7K9'), 'jamais la clé entière dans une réponse');
  await p.q('[data-act="aucune"]')!.emettre('click'); await calme();
  assert.equal(p.q('[data-act="aucune"]')!.getAttribute('aria-pressed'), 'true');
  assert.match(xml(), /<Key><\/Key>/);
});

test('C3 : options Windows au clavier, nom de compte vérifié, choix passés au composeur', async () => {
  const p = await page();
  await p.aller(['iso:win11']);
  await p.q('[data-sw="vlc-faux.exe"]')!.emettre('click'); await calme();
  await p.ajouter('reglage.ps1', 'Write-Host ok');
  await p.continuer().emettre('click'); await calme();
  // Un interrupteur est un vrai bouton (Entrée et Espace le basculent) qui garde le focus.
  const vie = p.q('[data-win="viePrivee"]')!;
  assert.equal(vie.tagName, 'BUTTON');
  await vie.emettre('click'); await calme();
  assert.equal(p.q('[data-win="viePrivee"]')!.getAttribute('aria-checked'), 'false');
  assert.equal(p.actif()?.getAttribute('data-f'), 'win-viePrivee');
  // Un nom de compte invalide ferme « Continuer » ; un nom valable le rouvre.
  const champ = p.q('[data-f="win-compte"]')!;
  champ.value = 'mauvais/nom'; await champ.emettre('input'); await calme();
  assert.equal(p.continuer().disabled, true);
  champ.value = 'Famille'; await champ.emettre('input'); await calme();
  assert.equal(p.continuer().disabled, false);
  // Les choix des étapes 4 et 5 partent avec les systèmes vers le composeur (aucune clé, seulement l'édition voulue).
  const LG = (p.L as unknown as { pourComposeur: (c: unknown[]) => { systemes: Array<{ logiciels?: Array<{ fichier: string }> }>; scripts: Array<{ nom: string }>; windows: Record<string, unknown> } });
  const sortie = LG.pourComposeur([{ nom: 'Windows 11 24H2', fichier: 'Win11_Pro_24H2_faux_x64.iso', famille: 'windows', choix: 'iso', mode: 'demarrer' }]);
  assert.deepEqual(ici(sortie.systemes[0].logiciels!.map((l) => l.fichier)), ['vlc-faux.exe']);
  assert.deepEqual(ici(sortie.scripts.map((x) => x.nom)), ['reglage.ps1']);
  assert.equal(sortie.windows.viePrivee, false); assert.equal(sortie.windows.compte, 'Famille');
  assert.ok(!JSON.stringify(sortie).includes('ZQ7K9'));
});

test('C3 : seules des lectures partent vers Odin (rien n\'écrit sur un disque)', async () => {
  const p = await page();
  await p.aller(['iso:ubuntu', 'iso:win11']);
  await p.q('[data-sw="gimp-faux.deb"]')!.emettre('click'); await calme();
  await p.q('[data-ong="iso:win11"]')!.emettre('click'); await calme();
  await p.q('[data-sw="vlc-faux.exe"]')!.emettre('click'); await calme();
  await p.ajouter('a.ps1', 'Write-Host a');
  await p.continuer().emettre('click'); await calme();
  await p.q('[data-win="exigences"]')!.emettre('click'); await calme();
  const parties = [...new Set(p.appels.map((a) => a.action))];
  assert.ok(parties.includes('cle_apercu_script') && parties.includes('cle_logiciels'));
  for (const a of parties) assert.ok(lectures.has(a), `« ${a} » est une lecture`);
  assert.ok(!parties.includes('cle_preparer'));
});
