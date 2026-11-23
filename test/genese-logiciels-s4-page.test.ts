// Genèse · Systèmes, lot S4 (la page) : l'onglet « Logiciels » — un sous-onglet par système, le catalogue filtré par OS
// (la VRAIE action cle_logiciels sur une bibliothèque fausse), l'ordre d'installation, le script créé en direct (la
// VRAIE action cle_apercu_script, demandée par la MÊME logique que la clé), tes scripts (antivirus), les profils gardés
// par Odin (les VRAIES actions profils_logiciels / profil_logiciels) ; et, à l'étape 4 de la clé, « Partir d'un profil ».
// Aucun navigateur, aucun réseau, aucun disque réel : un document minimal, des dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { cleUsb } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { thjalfi } from '../src/valhalla/modules/thjalfi.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const G = 1024 ** 3;
const ici = <V>(x: V): V => JSON.parse(JSON.stringify(x));
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s4p-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ données fausses, actions vraies
const FICHES = [
  { source: 'firefox', nom: 'Firefox', fichier: 'Firefox-Setup-faux.exe' },
  { source: 'vlc', nom: 'VLC', fichier: 'vlc-faux.exe' },
  { id: 'pilote', nom: 'Pilote imprimante', fichier: 'pilote-faux-setup.exe' },
  { nom: 'GIMP', fichier: 'gimp-faux.deb' },
  { nom: 'Htop', fichier: 'htop-faux.rpm' },
  { nom: 'Outil portable', fichier: 'outil-faux.AppImage' },
  { nom: 'Pour Mac', fichier: 'mac-faux.dmg' },
];
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const iso = (id: string, name: string, go: number, recipe: Record<string, unknown>) => ({ id, name, path: `faux/${name}.iso`, size: Math.round(go * G), mtime: 1, recipe });
const ISOS = () => ici([
  iso('ubuntu', 'ubuntu-24.04-desktop-amd64', 5.8, { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' }),
  iso('win11', 'Win11_Pro_24H2_faux_x64', 5.4, { kind: 'windows', label: 'Windows', auto: true, os: 'windows' }),
]);
const actionsCle = cleUsb().actions, module = thjalfi();
const A = (id: string) => [...module.actions, ...actionsCle].find((a) => a.id === id)!;
function serveur() {
  const home = neuf('home'), dir = neuf('dir');
  return {
    home, dir, settings: { cleDisquesTest: [CLE64] }, now: () => new Date(),
    run: async () => { throw new Error('aucune commande dans l\'essai'); },
    call: async (m: string, a: string) => { if (m === 'fjalar' && a === 'etat') return { ok: true, text: '', data: { fichiers: ici(FICHES) } }; throw new Error('aucun autre appel dans l\'essai'); },
  } as unknown as ModCtx;
}

// ------------------------------------------------------------------ un document minimal
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
const calme = async () => { for (let k = 0; k < 12; k++) await new Promise((ok) => setTimeout(ok, 5)); };

/** Les pages chargées dans un même « navigateur » (la clé, puis l'onglet Logiciels), les demandes servies par les vraies actions. */
function monter(ctxS: ModCtx, o: { prompt?: string | null; confirmer?: boolean } = {}) {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, get activeElement() { return actif; }, hidden: false,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, unknown> }> = [];
  const post = async (action: string, input: Record<string, unknown> = {}) => {
    appels.push({ action, input: ici(input) });
    if (action === 'cle_disques') return { ok: true, data: { externes: [ici(CLE64)], internes: [] } };
    if (action === 'isos') return { ok: true, data: ISOS() };
    if (action === 'cle_vms') return { ok: true, data: [] };
    if (['cle_place', 'cle_logiciels', 'cle_apercu_script', 'profils_logiciels', 'profil_logiciels'].includes(action)) return ici(await A(action).run(ctxS, ici(input)));
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const dialogues: string[] = [];
  // Comme la page de Genèse : une action grave demande la confirmation (ici, la boîte répond selon l'essai).
  const act = async (action: string, input: Record<string, unknown> = {}) => {
    const g = A(action).grave?.(input, ctxS);
    if (g) { dialogues.push(g); if (!o.confirmer) return { ok: false, text: 'Annulé.' }; }
    return post(action, input);
  };
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return o.confirmer === true; }, alert: async () => {}, prompt: async () => (o.prompt === undefined ? null : o.prompt) } };
  const ctx = { window, document, Node: Noeud, Intl, TextEncoder, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout, fetch: async () => { throw new Error('aucun réseau dans l\'essai'); } };
  for (const n of ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-logiciels.js']) { const js = src(n); if (js) vm.runInNewContext(js, ctx); }
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const parF = (v: string) => qa('[data-f]').find((n) => n.getAttribute('data-f') === v);
  return { corps, q, qa, parF, appels, dialogues, window, post, act };
}
async function ongletLogiciels(ctxS: ModCtx, o: { prompt?: string | null; confirmer?: boolean } = {}) {
  const m = monter(ctxS, o);
  const LG = m.window.OdinGeneseLogiciels;
  assert.ok(LG, 'thjalfi-logiciels.js expose window.OdinGeneseLogiciels');
  const n0 = new Noeud('div');
  await LG.dessiner(n0, 'logiciels', { post: m.post, act: m.act });
  m.corps.append(...n0.childNodes);
  await calme();
  const catalogue = () => m.qa('[data-sw]').map((b) => b.getAttribute('data-sw'));
  const ordre = () => m.qa('[data-ordre]').map((b) => b.getAttribute('data-ordre'));
  const apercu = () => m.q('[data-apercu]');
  const clic = async (n: Noeud | undefined | null) => { assert.ok(n, 'le contrôle existe'); await n!.emettre('click'); await calme(); };
  const ajouter = async (nom: string, contenu: string) => { const f = m.parF('scr-fichier')!; f.files = [{ name: nom, size: Buffer.byteLength(contenu), text: async () => contenu }]; await f.emettre('change'); await calme(); };
  return { ...m, LG, catalogue, ordre, apercu, clic, ajouter };
}

// ------------------------------------------------------------------ l'onglet
test('S4 · page : l\'onglet « Logiciels » est greffé dans Genèse, après « Systèmes »', () => {
  const g = src('thjalfi.js');
  assert.match(g, /window\.OdinGeneseSystemes\?\.onglets \?\? \[\]\), \.\.\.\(window\.OdinGeneseLogiciels\?\.onglets \?\? \[\]\)/);
  assert.match(g, /\[window\.OdinGeneseSystemes, window\.OdinGeneseLogiciels\]/);
});

test('S4 · page : un sous-onglet par système, le catalogue filtré par OS (même source que la clé)', async () => {
  const p = await ongletLogiciels(serveur());
  const os = p.qa('[role="tablist"] [role="tab"]').map((b) => [b.getAttribute('data-os'), b.getAttribute('aria-selected')]);
  assert.deepEqual(os, [['windows', 'true'], ['debian', 'false'], ['fedora', 'false']]);
  assert.deepEqual(p.catalogue(), ['Firefox-Setup-faux.exe', 'vlc-faux.exe', 'pilote-faux-setup.exe'], 'Windows : les installateurs Windows');
  assert.match(p.q('[data-sw="Firefox-Setup-faux.exe"]')!.textContent, /tout seul/);
  assert.match(p.q('[data-sw="pilote-faux-setup.exe"]')!.textContent, /te posera des questions/);
  await p.clic(p.parF('os-debian'));
  assert.deepEqual(p.catalogue(), ['gimp-faux.deb', 'outil-faux.AppImage'], 'Ubuntu et Debian : .deb et portables, jamais .rpm');
  await p.clic(p.parF('os-fedora'));
  assert.deepEqual(p.catalogue(), ['htop-faux.rpm', 'outil-faux.AppImage'], 'Fedora : .rpm et portables, jamais .deb');
  assert.ok(!p.corps.textContent.includes('mac-faux.dmg'));
  assert.deepEqual([...new Set(p.appels.filter((a) => a.action === 'cle_logiciels').map((a) => a.input.os))].sort(), ['linux', 'windows']);
  // Recherche et filtre « Avec questions ».
  await p.clic(p.parF('os-windows'));
  const r = p.parF('recherche')!; r.value = 'VL'; await r.emettre('input'); await calme();
  assert.deepEqual(p.catalogue(), ['vlc-faux.exe']);
  r.value = ''; await r.emettre('input'); await calme();
  await p.clic(p.parF('filtre-questions'));
  assert.deepEqual(p.catalogue(), ['pilote-faux-setup.exe']);
});

test('S4 · page : l\'ordre d\'installation se règle, le script en direct le suit ; profil gardé et relu', async () => {
  const ctxS = serveur();
  const p = await ongletLogiciels(ctxS);
  assert.match(p.corps.textContent, /Standard/, 'sans profil : un brouillon « Standard »');
  await p.clic(p.q('[data-sw="Firefox-Setup-faux.exe"]'));
  await p.clic(p.q('[data-sw="vlc-faux.exe"]'));
  assert.deepEqual(p.ordre(), ['Firefox-Setup-faux.exe', 'vlc-faux.exe']);
  const lignes = () => String(p.apercu()?.textContent ?? '').split(/\r?\n/).filter((l) => /Start-Process "/.test(l)).map((l) => /(Firefox|vlc)/.exec(l)?.[1]);
  assert.equal(p.apercu()?.getAttribute('data-apercu'), 'apres.ps1');
  assert.deepEqual(lignes(), ['Firefox', 'vlc']);
  await p.clic(p.parF('ord-down-0'));
  assert.deepEqual(p.ordre(), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
  assert.deepEqual(lignes(), ['vlc', 'Firefox'], 'le script suit l\'ordre');
  assert.match(p.corps.textContent, /1er installé/); assert.match(p.corps.textContent, /2e installé/);
  // Enregistrer : le profil « Standard » est créé côté serveur, dans cet ordre.
  await p.clic(p.parF('enregistrer'));
  const lu = await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ nom: string; systemes: Record<string, { logiciels: Array<{ fichier: string }> }> }> } };
  assert.deepEqual(lu.data.profils.map((x) => x.nom), ['Standard']);
  assert.deepEqual(lu.data.profils[0].systemes.windows.logiciels.map((l) => l.fichier), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
  assert.equal(p.parF('changement'), undefined, 'plus rien en attente');
  // Une autre page (un autre jour) relit le même profil.
  const p2 = await ongletLogiciels(ctxS);
  p2.LG.etat.brouillons = {}; p2.LG.etat.profil = '';
  const n0 = new Noeud('div'); await p2.LG.dessiner(n0, 'logiciels', { post: p2.post, act: p2.act }); p2.corps.replaceChildren(...n0.childNodes); await calme();
  assert.deepEqual(p2.ordre(), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
  // Un changement non voulu : « Annuler » le défait.
  await p2.clic(p2.parF('ord-rm-0'));
  assert.ok(p2.parF('changement'));
  await p2.clic(p2.parF('annuler'));
  assert.deepEqual(p2.ordre(), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
});

test('S4 · page : l\'aperçu est IDENTIQUE à celui de la clé pour les mêmes choix', async () => {
  const ctxS = serveur();
  const p = await ongletLogiciels(ctxS);
  const CL = p.window.OdinGeneseCleLogiciels.logique;
  const choix = [{ id: 'vlc', fichier: 'vlc-faux.exe', nom: 'VLC', silencieux: true }, { id: 'firefox', fichier: 'Firefox-Setup-faux.exe', nom: 'Firefox', silencieux: true }];
  const scripts = [{ uid: 'a', nom: 'heure.cmd', contenu: 'echo %TIME%', etat: 'ok', raison: '' }];
  // La demande de l'onglet Logiciels et celle de la clé (un vrai Windows de l'étape 3, options de départ de l'étape 5).
  const dP = p.LG.logique.demandeProfil('windows', { logiciels: choix, scripts });
  const dC = CL.demande({ famille: 'windows', nom: 'Win11_Pro_24H2_faux_x64', fichier: 'faux/Win11_Pro_24H2_faux_x64.iso' }, choix, scripts.map((s) => ({ ...s, os: 'windows' })), { ...p.window.OdinGeneseCleLogiciels.etat.win });
  assert.deepEqual(dP.logiciels, dC.logiciels); assert.deepEqual(dP.scripts, dC.scripts); assert.deepEqual(dP.windows, dC.windows);
  const rP = await A('cle_apercu_script').run(ctxS, ici(dP)) as { data: { fichiers: Record<string, string> } };
  const rC = await A('cle_apercu_script').run(ctxS, ici(dC)) as { data: { fichiers: Record<string, string> } };
  assert.equal(rP.data.fichiers['apres.ps1'], rC.data.fichiers['apres.ps1'], 'le même script de fin');
  assert.equal(rP.data.fichiers['scripts/01-heure.cmd'], rC.data.fichiers['scripts/01-heure.cmd']);
  // Linux (Ubuntu) : les mêmes réponses d'installation.
  const deb = [{ id: 'gimp-faux.deb', fichier: 'gimp-faux.deb', nom: 'GIMP', silencieux: true }];
  const lP = p.LG.logique.demandeProfil('debian', { logiciels: deb, scripts: [] });
  const lC = CL.demande({ famille: 'linux', nom: 'ubuntu-24.04-desktop-amd64', fichier: 'faux/ubuntu-24.04-desktop-amd64.iso' }, deb, [], { ...p.window.OdinGeneseCleLogiciels.etat.win });
  const uP = await A('cle_apercu_script').run(ctxS, ici(lP)) as { data: { fichiers: Record<string, string> } };
  const uC = await A('cle_apercu_script').run(ctxS, ici(lC)) as { data: { fichiers: Record<string, string> } };
  assert.equal(uP.data.fichiers['user-data'], uC.data.fichiers['user-data']);
  // Et ce que montre la page est bien ce que rend le serveur pour sa demande.
  await p.clic(p.q('[data-sw="vlc-faux.exe"]'));
  const envoye = p.appels.filter((a) => a.action === 'cle_apercu_script').at(-1)!.input;
  const attendu = await A('cle_apercu_script').run(ctxS, ici(envoye)) as { data: { fichiers: Record<string, string> } };
  assert.equal(p.apercu()!.textContent, attendu.data.fichiers['apres.ps1']);
});

test('S4 · page : tes scripts — un script dangereux est refusé (antivirus), il ne s\'enregistre pas ; montré comme du texte', async () => {
  const ctxS = serveur();
  const p = await ongletLogiciels(ctxS);
  await p.ajouter('heure.cmd', 'echo <b>heure</b>');
  assert.equal(p.LG.etat.brouillons[''].windows.scripts[0].etat, 'ok');
  await p.ajouter('menage.cmd', 'vssadmin delete shadows /all /quiet');
  const scr = ici(p.LG.etat.brouillons[''].windows.scripts);
  assert.deepEqual(scr.map((x: { nom: string; etat: string }) => [x.nom, x.etat]), [['heure.cmd', 'ok'], ['menage.cmd', 'refuse']]);
  assert.match(p.corps.textContent, /effacer un disque|antivirus d'Odin l'a refusé/);
  assert.ok(!String(p.apercu()?.textContent).includes('menage'), 'refusé : jamais dans le script');
  assert.equal(p.parF('enregistrer')!.disabled, true, 'Enregistrer attend que le script refusé soit retiré');
  // Un script pour un autre système : refusé avant d'être envoyé.
  await p.ajouter('linux.sh', 'echo a');
  assert.match(p.corps.textContent, /n'est pas un script pour Windows/);
  // Voir : du texte, jamais du code de page.
  const voir = p.qa('[data-scr]')[0].querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-voir-'))!;
  await p.clic(voir);
  const pre = p.qa('[data-scr]')[0].querySelector('pre')!;
  assert.equal(pre.textContent, 'echo <b>heure</b>'); assert.equal(pre.querySelector('b'), null);
  // Retirer le refusé : on peut enregistrer, et le serveur garde seulement l'autre.
  const rm = p.qa('[data-scr]').find((x) => x.getAttribute('data-scr') === 'menage.cmd')!.querySelectorAll('button').find((b) => b.getAttribute('data-f')?.startsWith('scr-rm-'))!;
  await p.clic(rm);
  assert.equal(p.parF('enregistrer')!.disabled, false);
  await p.clic(p.parF('enregistrer'));
  const lu = await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ systemes: Record<string, { scripts: Array<{ nom: string }> }> }> } };
  assert.deepEqual(lu.data.profils[0].systemes.windows.scripts.map((x) => x.nom), ['heure.cmd']);
  // Même si la page était trafiquée : le serveur refuse le script dangereux.
  const r = await p.post('profil_logiciels', { op: 'creer', nom: 'Piège', systemes: { windows: { logiciels: [], scripts: [{ nom: 'menage.cmd', contenu: 'vssadmin delete shadows /all /quiet' }] } } }) as { ok: boolean };
  assert.equal(r.ok, false);
});

test('S4 · page : nouveau, renommer, dupliquer, supprimer (avec confirmation) ; noms montrés comme du texte', async () => {
  const ctxS = serveur();
  await A('profil_logiciels').run(ctxS, { op: 'creer', nom: '<img src=x onerror=alert(1)>' });
  const p = await ongletLogiciels(ctxS, { prompt: 'Bureau' });
  assert.ok(p.qa('img').length === 0, 'un nom de profil n\'est jamais du code de page');
  assert.match(p.corps.textContent, /<img src=x onerror=alert\(1\)>/);
  await p.clic(p.parF('prof-nouveau'));
  const noms = () => p.qa('[data-prof]').map((b) => b.textContent.replace(/\d+$/, ''));
  assert.deepEqual(noms(), ['<img src=x onerror=alert(1)>', 'Bureau']);
  assert.equal(p.qa('[data-prof]')[1].getAttribute('aria-pressed'), 'true', 'le nouveau est choisi');
  await p.clic(p.parF('prof-dupliquer'));
  assert.deepEqual(noms(), ['<img src=x onerror=alert(1)>', 'Bureau', 'Bureau (copie)']);
  p.window.OdinDialog.prompt = async () => 'Développeur';
  await p.clic(p.parF('prof-renommer'));
  assert.deepEqual(noms(), ['<img src=x onerror=alert(1)>', 'Bureau', 'Développeur']);
  // Supprimer : la confirmation est demandée ; refusée, rien ne part.
  await p.clic(p.parF('prof-supprimer'));
  assert.match(p.dialogues.at(-1)!, /supprimer le profil de logiciels « Développeur »/);
  assert.deepEqual(noms(), ['<img src=x onerror=alert(1)>', 'Bureau', 'Développeur']);
  const q = await ongletLogiciels(ctxS, { confirmer: true });
  q.LG.etat.profil = (await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ id: string; nom: string }> } }).data.profils.find((x) => x.nom === 'Développeur')!.id;
  const n0 = new Noeud('div'); await q.LG.dessiner(n0, 'logiciels', { post: q.post, act: q.act }); q.corps.replaceChildren(...n0.childNodes); await calme();
  await q.clic(q.parF('prof-supprimer'));
  const reste = (await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ nom: string }> } }).data.profils.map((x) => x.nom);
  assert.deepEqual(reste, ['<img src=x onerror=alert(1)>', 'Bureau']);
});

// ------------------------------------------------------------------ « Partir d'un profil » à l'étape 4 de la clé
test('S4 · clé, étape 4 : « Partir d\'un profil » préremplit les logiciels (déjà téléchargés, dans l\'ordre) et les scripts', async () => {
  const ctxS = serveur();
  const cree = await A('profil_logiciels').run(ctxS, { op: 'creer', nom: 'Bureau', systemes: {
    windows: { logiciels: [{ id: 'vlc', fichier: 'vlc-faux.exe', nom: 'VLC' }, { id: 'absent', fichier: 'absent-faux.msi', nom: 'Absent' }, { id: 'firefox', fichier: 'Firefox-Setup-faux.exe', nom: 'Firefox' }], scripts: [{ nom: 'heure.cmd', contenu: 'echo %TIME%' }] },
    debian: { logiciels: [{ id: 'gimp', fichier: 'gimp-faux.deb', nom: 'GIMP' }], scripts: [{ nom: 'bonjour.sh', contenu: 'echo bonjour' }] },
  } }) as { ok: boolean; text: string };
  assert.equal(cree.ok, true, cree.text);
  const m = monter(ctxS);
  const n0 = new Noeud('div');
  await m.window.OdinGeneseCle.dessiner(n0, 'cle', { post: m.post, act: m.act });
  m.corps.append(...n0.childNodes);
  await calme();
  const continuer = () => m.q('[data-f="continuer"]')!;
  await m.q('[data-cle="faux-cle-64"]')!.emettre('click');
  await m.q('[data-etape="2"]')!.emettre('click');
  await continuer().emettre('click'); await calme();
  for (const id of ['iso:ubuntu', 'iso:win11']) { await m.q(`[data-sys="${id}"]`)!.emettre('click'); await calme(); }
  await continuer().emettre('click'); await calme();
  assert.equal(m.window.OdinGeneseCleEtapes.etat.etape, 4);
  // Le bloc « Partir d'un profil » ; ce qui était déjà là (onglets, logiciels) reste.
  assert.match(m.corps.textContent, /Partir d'un profil/);
  assert.ok(m.q('[data-ong="iso:ubuntu"]') && m.q('[data-ong="iso:win11"]'));
  const bouton = m.qa('[data-profil]');
  assert.deepEqual(bouton.map((b) => b.textContent), ['Bureau']);
  await bouton[0].emettre('click'); await calme(); await calme();
  const E = ici(m.window.OdinGeneseCleLogiciels.etat);
  assert.deepEqual(E.coches['iso:win11'].map((x: { fichier: string }) => x.fichier), ['vlc-faux.exe', 'Firefox-Setup-faux.exe'], 'dans l\'ordre du profil, seulement les déjà téléchargés');
  assert.deepEqual(E.coches['iso:ubuntu'].map((x: { fichier: string }) => x.fichier), ['gimp-faux.deb']);
  assert.deepEqual(E.scripts.map((x: { nom: string; os: string; etat: string }) => [x.nom, x.os, x.etat]), [['heure.cmd', 'windows', 'ok'], ['bonjour.sh', 'linux', 'ok']]);
  assert.match(m.corps.textContent, /1 logiciel\(s\) du profil pas encore téléchargé/);
  assert.equal(m.qa('[data-profil]')[0].getAttribute('aria-pressed'), 'true');
  // Ce qui part vers l'écriture de la clé : les logiciels et les scripts du profil (revérifiés de nouveau à l'écriture).
  const pc = ici(m.window.OdinGeneseCleLogiciels.pourComposeur([{ fichier: 'faux/Win11_Pro_24H2_faux_x64.iso', nom: 'Win11_Pro_24H2_faux_x64' }]));
  assert.deepEqual(pc.scripts.map((x: { nom: string }) => x.nom), ['heure.cmd', 'bonjour.sh']);
  // Le script de la clé (même aperçu) contient les logiciels du profil.
  await m.q('[data-ong="iso:win11"]')!.emettre('click'); await calme(); await calme();
  const ap = String(m.q('[data-apercu]')?.textContent ?? '');
  assert.ok(ap.indexOf('vlc-faux.exe') > 0 && ap.indexOf('vlc-faux.exe') < ap.indexOf('Firefox-Setup-faux.exe'), 'dans l\'ordre du profil');
  // Seules des lectures sont parties (rien n'est écrit par l'étape 4).
  const lectures = new Set([...module.actions, ...actionsCle].filter((a) => a.read === true).map((a) => a.id));
  for (const a of new Set(m.appels.map((x) => x.action))) assert.ok(lectures.has(a), `« ${a} » est une lecture`);
});

test('S4 · clé, étape 4 : un script refusé depuis (relu par l\'antivirus) arrive refusé, jamais accepté', async () => {
  const ctxS = serveur();
  const r = await A('profil_logiciels').run(ctxS, { op: 'creer', nom: 'Bureau', systemes: { windows: { logiciels: [], scripts: [{ nom: 'heure.cmd', contenu: 'echo %TIME%' }] } } }) as { ok: boolean };
  assert.equal(r.ok, true);
  const { readFileSync: lire, writeFileSync: ecrire } = await import('node:fs');
  const f = join((ctxS as unknown as { dir: string }).dir, 'profils-logiciels.json'), brut = JSON.parse(lire(f, 'utf8'));
  brut.profils[0].systemes.windows.scripts[0].contenu = 'vssadmin delete shadows /all /quiet';
  ecrire(f, JSON.stringify(brut));
  const m = monter(ctxS);
  const n0 = new Noeud('div');
  await m.window.OdinGeneseCle.dessiner(n0, 'cle', { post: m.post, act: m.act });
  m.corps.append(...n0.childNodes); await calme();
  await m.q('[data-cle="faux-cle-64"]')!.emettre('click');
  await m.q('[data-etape="2"]')!.emettre('click');
  await m.q('[data-f="continuer"]')!.emettre('click'); await calme();
  await m.q('[data-sys="iso:win11"]')!.emettre('click'); await calme();
  await m.q('[data-f="continuer"]')!.emettre('click'); await calme();
  await m.qa('[data-profil]')[0].emettre('click'); await calme(); await calme();
  const E = ici(m.window.OdinGeneseCleLogiciels.etat);
  assert.deepEqual(E.scripts.map((x: { nom: string; etat: string }) => [x.nom, x.etat]), [['heure.cmd', 'refuse']]);
  assert.deepEqual(ici(m.window.OdinGeneseCleLogiciels.pourComposeur([]).scripts), [], 'jamais vers l\'écriture');
});

// ------------------------------------------------------------------ relecture S4 (brouillons, Debian, clé, onglet Démarrage)
test('S4 relecture · page : renommer un profil GARDE ses changements pas encore enregistrés', async () => {
  const ctxS = serveur();
  await A('profil_logiciels').run(ctxS, { op: 'creer', nom: 'Bureau', systemes: { windows: { logiciels: [{ id: 'vlc', fichier: 'vlc-faux.exe', nom: 'VLC' }], scripts: [] } } });
  const p = await ongletLogiciels(ctxS, { prompt: 'Atelier' });
  await p.clic(p.q('[data-sw="Firefox-Setup-faux.exe"]'));
  assert.deepEqual(p.ordre(), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
  assert.ok(p.parF('changement'), 'un changement en attente');
  await p.clic(p.parF('prof-renommer'));
  assert.match(p.corps.textContent, /Atelier/);
  assert.deepEqual(p.ordre(), ['vlc-faux.exe', 'Firefox-Setup-faux.exe'], 'le brouillon est toujours là');
  assert.ok(p.parF('changement'), 'toujours à enregistrer');
  const lu = await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ systemes: Record<string, { logiciels: unknown[] }> }> } };
  assert.equal(lu.data.profils[0].systemes.windows.logiciels.length, 1, 'rien n\'a été enregistré sans le vouloir');
});

test('S4 relecture · page : « Nouveau profil » depuis le brouillon « Standard » rempli le garde (jamais jeté)', async () => {
  const ctxS = serveur();
  const p = await ongletLogiciels(ctxS, { prompt: 'Atelier' });
  await p.clic(p.q('[data-sw="vlc-faux.exe"]'));
  await p.clic(p.parF('prof-nouveau'));
  const lu = await A('profils_logiciels').run(ctxS, {}) as { data: { profils: Array<{ nom: string; systemes: Record<string, { logiciels: Array<{ fichier: string }> }> }> } };
  assert.deepEqual(lu.data.profils.map((x) => x.nom), ['Atelier']);
  assert.deepEqual(lu.data.profils[0].systemes.windows.logiciels.map((l) => l.fichier), ['vlc-faux.exe'], 'le brouillon est devenu ce profil');
  assert.deepEqual(p.ordre(), ['vlc-faux.exe']);
});

test('S4 relecture · page : « Ubuntu et Debian » montre aussi l\'aperçu de Debian, le même que la clé', async () => {
  const ctxS = serveur();
  const p = await ongletLogiciels(ctxS);
  await p.clic(p.parF('os-debian'));
  await p.clic(p.q('[data-sw="gimp-faux.deb"]'));
  assert.ok(p.parF('var-ubuntu') && p.parF('var-debian'), 'deux aperçus au choix');
  await p.clic(p.parF('var-debian'));
  const envoye = p.appels.filter((a) => a.action === 'cle_apercu_script').at(-1)!.input as { systeme: { nom: string } };
  assert.equal(envoye.systeme.nom, 'Debian');
  const CL = p.window.OdinGeneseCleLogiciels.logique;
  const deb = [{ id: 'gimp-faux.deb', fichier: 'gimp-faux.deb', nom: 'GIMP', silencieux: true }];
  const dC = CL.demande({ famille: 'linux', nom: 'debian-12.8.0-amd64-netinst', fichier: 'faux/debian-12.8.0-amd64-netinst.iso' }, deb, [], { ...p.window.OdinGeneseCleLogiciels.etat.win });
  const rC = await A('cle_apercu_script').run(ctxS, ici(dC)) as { data: { fichiers: Record<string, string> } };
  const rP = await A('cle_apercu_script').run(ctxS, ici(envoye)) as { data: { fichiers: Record<string, string> } };
  assert.deepEqual(Object.keys(rP.data.fichiers).sort(), Object.keys(rC.data.fichiers).sort(), 'les mêmes fichiers que pour une clé Debian');
  for (const k of Object.keys(rC.data.fichiers)) assert.equal(rP.data.fichiers[k], rC.data.fichiers[k], k);
  assert.ok(!('user-data' in rC.data.fichiers), 'Debian n\'a pas les réponses d\'Ubuntu');
});

test('S4 relecture · clé, étape 4 : les scripts d\'un profil sont REVÉRIFIÉS (antivirus de l\'aperçu), même hors de l\'onglet ouvert', async () => {
  const ctxS = serveur();
  await A('profil_logiciels').run(ctxS, { op: 'creer', nom: 'Bureau', systemes: { windows: { logiciels: [], scripts: [{ nom: 'heure.cmd', contenu: 'echo %TIME%' }] }, debian: { logiciels: [], scripts: [{ nom: 'bonjour.sh', contenu: 'echo bonjour' }] } } });
  const m = monter(ctxS);
  const n0 = new Noeud('div');
  await m.window.OdinGeneseCle.dessiner(n0, 'cle', { post: m.post, act: m.act });
  m.corps.append(...n0.childNodes); await calme();
  await m.q('[data-cle="faux-cle-64"]')!.emettre('click');
  await m.q('[data-etape="2"]')!.emettre('click');
  await m.q('[data-f="continuer"]')!.emettre('click'); await calme();
  for (const id of ['iso:ubuntu', 'iso:win11']) { await m.q(`[data-sys="${id}"]`)!.emettre('click'); await calme(); }
  await m.q('[data-f="continuer"]')!.emettre('click'); await calme();
  const avant = m.appels.length;
  await m.qa('[data-profil]')[0].emettre('click'); await calme(); await calme();
  const envoyes = m.appels.slice(avant).filter((a) => a.action === 'cle_apercu_script').flatMap((a) => (a.input.scripts as Array<{ nom: string }>).map((x) => x.nom));
  assert.ok(envoyes.includes('heure.cmd') && envoyes.includes('bonjour.sh'), `chaque script repasse par l'antivirus (${envoyes.join(', ')})`);
  assert.deepEqual(ici(m.window.OdinGeneseCleLogiciels.etat.scripts).map((x: { nom: string; etat: string }) => [x.nom, x.etat]), [['heure.cmd', 'ok'], ['bonjour.sh', 'ok']]);
});

test('S4 relecture · clés : l\'onglet « Démarrage » monte l\'aperçu (source clé) ; mode, délai et langue partent à cle_preparer', async () => {
  const ctxS = serveur();
  const m = monter(ctxS);
  const montes: Array<Record<string, unknown>> = [];
  m.window.OdinGeneseCleMenu = { monterApercu: (zone: Noeud, o: Record<string, unknown>) => { montes.push(o); zone.replaceChildren(new Noeud('div')); return { arreter() {} }; } };
  (racine as unknown as { lang: string }).lang = 'fr-FR';
  const n0 = new Noeud('div');
  await m.window.OdinGeneseCle.dessiner(n0, 'cle', { post: m.post, act: m.act });
  m.corps.append(...n0.childNodes); await calme();
  await m.parF('tab-demarrage')!.emettre('click'); await calme();
  assert.ok(!/Bientôt/.test(m.corps.textContent), 'plus de « Bientôt »');
  assert.equal(montes.length, 1); assert.equal(montes[0].source, 'cle'); assert.equal(montes[0].delai, 10);
  const E = m.window.OdinGeneseCleEtapes;
  assert.deepEqual(ici(E.demarrage()), { modeDefaut: 'graphique', delai: 10, langue: 'fr' });
  await m.parF('dem-mode-texte')!.emettre('click'); await calme();
  await m.parF('dem-delai-30')!.emettre('click'); await calme();
  assert.equal(m.parF('dem-mode-texte')!.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ici(E.demarrage()), { modeDefaut: 'texte', delai: 30, langue: 'fr' });
  assert.equal(montes.at(-1)!.vue, 'texte'); assert.equal(montes.at(-1)!.delai, 30);
  for (const b of m.qa('button').filter((x) => /^dem-/.test(x.getAttribute('data-f') ?? ''))) assert.match(b.className, /ck-btn/, '44 px (ck-btn)');
  // Pur : bornes et langue (jamais un texte libre).
  assert.deepEqual(ici(E.reglagesDemarrage({ mode: 'x', delai: 9999 }, '<b>')), { modeDefaut: 'graphique', delai: 300 });
  // Les deux portes d'écriture envoient ces réglages (étape 6 et composeur).
  assert.match(src('thjalfi-cle-suivi.js'), /O\.post\('cle_preparer', \{[^}]*\.\.\.dem, phrase/);
  assert.match(src('thjalfi-cle-composer.js'), /act\('cle_preparer', \{[^}]*racine: etat\.racine, \.\.\.dem \}\)/);
});
