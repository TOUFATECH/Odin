// Genèse · Clés USB, lot C1 de la maquette validée : le cadre (quatre onglets, barre des 6 étapes) et l'étape « Clé »
// (garde-fou sous la clé choisie, disques internes verrouillés, clé déjà ODIN, « Vérifier en la débranchant »).
// - Logique (sans document) : vueDisques, choisir, garde, queue, la vérification en la débranchant.
// - Page : un petit document simulé (aucun navigateur). Les disques sont FAUX partout : la liste vient d'une fausse
//   réponse de cle_disques ; aucun vrai disque n'est lu, aucune commande n'est lancée, rien n'est écrit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ETAPES_JS = readFileSync(new URL('../src/web/pages/thjalfi-cle-etapes.js', import.meta.url), 'utf8');
const CLE_JS = readFileSync(new URL('../src/web/pages/thjalfi-cle.js', import.meta.url), 'utf8');
const G = 1024 ** 3;

// ------------------------------------------------------------------ des disques faux (aucune donnée réelle)
type Partition = { nom: string; label?: string; tailleOctets: number; utiliseOctets?: number; systeme?: string; montage?: string };
type Disque = { id: string; chemin: string; modele?: string; serie?: string; tailleOctets: number; genre: string; externe: boolean; bus?: string; amovible: boolean; systemeEnCours?: boolean; estOdin?: boolean; partitions: Partition[] };
const CLE64: Disque = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [{ nom: 'p1', label: 'DONNEES', tailleOctets: 64 * G, utiliseOctets: 41 * G, systeme: 'donnees' }] };
const DISQ1T: Disque = { id: 'faux-disque-1t', chemin: 'faux-8', modele: 'Disque externe 1 To', serie: 'CC33DD440C19', tailleOctets: 1000 * G, genre: 'disque-externe', externe: true, bus: 'usb', amovible: true, estOdin: true, partitions: [{ nom: 'p1', label: 'ODIN', tailleOctets: 900 * G, utiliseOctets: 312 * G, systeme: 'odin' }, { nom: 'p2', label: 'VTOYEFI', tailleOctets: 0.03 * G, systeme: 'efi' }] };
const CLE16: Disque = { id: 'faux-cle-16', chemin: 'faux-7', modele: 'Clé USB 16 Go', serie: 'EE55FF66A410', tailleOctets: 16 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const SSD: Disque = { id: 'faux-ssd', chemin: 'faux-0', modele: 'SSD interne 512 Go', serie: 'SSD0000FAUX1', tailleOctets: 512 * G, genre: 'interne', externe: false, bus: 'nvme', amovible: false, systemeEnCours: true, partitions: [{ nom: 'p1', label: 'EFI', tailleOctets: 0.1 * G, systeme: 'efi' }, { nom: 'p2', tailleOctets: 400 * G, systeme: 'windows', montage: 'C:' }] };
const HDD: Disque = { id: 'faux-hdd', chemin: 'faux-1', modele: 'Disque interne 2 To', tailleOctets: 2000 * G, genre: 'interne', externe: false, bus: 'sata', amovible: false, partitions: [{ nom: 'p1', tailleOctets: 2000 * G, systeme: 'donnees' }] };
// Un système qui tourne depuis un disque branché en USB : jamais proposé non plus.
const USB_SYS: Disque = { id: 'faux-usb-sys', chemin: 'faux-6', modele: 'Disque USB du système', serie: 'GG77HH889999', tailleOctets: 256 * G, genre: 'disque-externe', externe: true, bus: 'usb', amovible: true, systemeEnCours: true, partitions: [{ nom: 'p1', tailleOctets: 256 * G, systeme: 'windows' }] };
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const LISTE = () => ({ externes: ici([CLE64, DISQ1T, CLE16, USB_SYS]), internes: ici([SSD, HDD]) });

interface Logique {
  MOTS: Record<string, string>; mot: (k: string, v?: Record<string, unknown>) => string;
  queue: (s: string, autres: string[]) => string;
  choisissable: (d: unknown) => boolean;
  vueDisques: (data: unknown) => { cles: Array<{ id: string; serie: string; serieCourte: string; etat: string; contenu: string }>; verrous: Array<{ id: string; systeme: boolean }> };
  choisir: (vue: unknown, id: string) => { ok: boolean; cle?: string; raison?: string };
  garde: (c: unknown) => { genre: string; titre: string; texte: string; points: string[]; verifier: boolean } | null;
  debutVerif: (c: unknown, data: unknown, t: number) => { phase: string; id: string; autre?: string } & Record<string, unknown>;
  suivreVerif: (v: unknown, data: unknown, t: number) => { phase: string; id: string; autre?: string } & Record<string, unknown>;
  texteVerif: (v: unknown) => string;
  etapeOuverte: (n: number, cle: string | null) => boolean;
  suivant: (i: number, n: number, touche: string, ouvert?: (j: number) => boolean) => number;
  VERIF_MAX_MS: number; COPIE_POSSIBLE: boolean;
}
function logique(): Logique {
  const win: { OdinGeneseCleEtapes?: { logique: Logique } } = {};
  vm.runInNewContext(ETAPES_JS, { window: win, Intl });
  return win.OdinGeneseCleEtapes!.logique;
}

// ------------------------------------------------------------------ logique
test('logique : seuls les disques branchés de l\'extérieur sont proposés ; internes et disque du système verrouillés', () => {
  const L = logique();
  const v = L.vueDisques(LISTE());
  assert.deepEqual(ici(v.cles.map((c) => c.id)), ['faux-cle-64', 'faux-disque-1t', 'faux-cle-16']);
  assert.deepEqual(ici(v.verrous.map((x) => x.id)).sort(), ['faux-hdd', 'faux-ssd', 'faux-usb-sys']);
  for (const id of ['faux-ssd', 'faux-hdd', 'faux-usb-sys', 'inconnu']) {
    const r = L.choisir(v, id);
    assert.equal(r.ok, false, `${id} ne peut pas être choisi`); assert.equal(r.raison, L.MOTS['cle.refus']);
  }
  assert.equal(L.choisir(v, 'faux-cle-64').ok, true);
  assert.equal(L.choisissable(SSD), false); assert.equal(L.choisissable(USB_SYS), false); assert.equal(L.choisissable(CLE64), true);
});

test('logique : le garde-fou dit « sera entièrement effacée » avec le bon numéro de série ; vert pour une clé ODIN ou vide', () => {
  const L = logique(), v = L.vueDisques(LISTE());
  const c64 = v.cles.find((c) => c.id === 'faux-cle-64')!;
  const g = L.garde(c64)!;
  assert.equal(g.genre, 'efface'); assert.equal(g.titre, L.MOTS['garde.efface.titre']);
  assert.match(g.texte, /…7F2A/); assert.doesNotMatch(g.texte, /0C19|A410/);
  assert.ok(g.points.includes(L.MOTS['garde.efface.serie'])); assert.ok(g.points.includes(L.MOTS['garde.efface.internes']));
  assert.equal(g.verifier, true);
  const odin = L.garde(v.cles.find((c) => c.id === 'faux-disque-1t'))!;
  assert.equal(odin.genre, 'odin'); assert.equal(odin.titre, L.MOTS['garde.odin.titre']); assert.equal(odin.verifier, false);
  assert.equal(L.garde(v.cles.find((c) => c.id === 'faux-cle-16'))!.genre, 'vide');
  // Sans numéro de série : pas de promesse sur le numéro, pas de vérification possible.
  const sans = L.vueDisques({ externes: [{ ...ici(CLE64), serie: undefined }], internes: [] }).cles[0];
  const gs = L.garde(sans)!;
  assert.equal(gs.verifier, false); assert.ok(gs.points.includes(L.MOTS['garde.efface.sansSerie'])); assert.ok(!gs.points.includes(L.MOTS['garde.efface.serie']));
  // Pas d'action qui copie le contenu : le bouton n'existe pas.
  assert.equal(L.COPIE_POSSIBLE, false);
});

test('logique : la fin du numéro de série s\'allonge si deux clés finissent pareil', () => {
  const L = logique();
  assert.equal(L.queue('AA11BB227F2A', ['AA11BB227F2A', 'CC33DD440C19']), '…7F2A');
  assert.equal(L.queue('AA11BB227F2A', ['AA11BB227F2A', 'ZZ99XX227F2A']), '…B227F2A');
});

test('logique : « vérifier en la débranchant » reconnaît le retour du même numéro de série et refuse une autre clé', () => {
  const L = logique();
  const data0 = LISTE(), c = L.vueDisques(data0).cles[0];
  let v = L.debutVerif(c, data0, 0);
  assert.equal(v.phase, 'depart');
  v = L.suivreVerif(v, data0, 1000); assert.equal(v.phase, 'depart', 'toujours branchée : on attend');
  const sans = { externes: ici([DISQ1T, CLE16]), internes: ici([SSD]) };
  v = L.suivreVerif(v, sans, 2000); assert.equal(v.phase, 'retour', 'elle a disparu');
  const autre = { externes: ici([DISQ1T, CLE16, { ...CLE64, id: 'faux-autre', serie: 'QQ12RR34B7C8' }]), internes: ici([SSD]) };
  v = L.suivreVerif(v, autre, 3000); assert.equal(v.phase, 'autre', 'une autre clé est refusée'); assert.equal(v.autre, '…B7C8');
  // La même clé revient (son identifiant peut changer) : reconnue par son numéro de série.
  const retour = { externes: ici([DISQ1T, CLE16, { ...CLE64, id: 'faux-cle-64-bis' }]), internes: ici([SSD]) };
  v = L.suivreVerif(v, retour, 4000); assert.equal(v.phase, 'ok'); assert.equal(v.id, 'faux-cle-64-bis');
  // Le même numéro sur un disque qui ne peut pas être choisi ne vaut pas « c'est bien elle ».
  let w = L.suivreVerif(L.debutVerif(c, data0, 0), sans, 1);
  w = L.suivreVerif(w, { externes: [], internes: ici([{ ...SSD, serie: CLE64.serie }]) }, 2);
  assert.notEqual(w.phase, 'ok');
  // Au bout du délai, la vérification s'arrête seule.
  assert.equal(L.suivreVerif(L.debutVerif(c, data0, 0), data0, L.VERIF_MAX_MS + 1).phase, 'delai');
});

test('logique : les étapes 2 à 6 restent fermées tant qu\'aucune clé n\'est choisie ; flèches, Début et Fin', () => {
  const L = logique();
  assert.equal(L.etapeOuverte(1, null), true);
  for (let n = 2; n <= 6; n++) { assert.equal(L.etapeOuverte(n, null), false); assert.equal(L.etapeOuverte(n, 'x'), true); }
  assert.equal(L.suivant(0, 4, 'ArrowRight'), 1); assert.equal(L.suivant(0, 4, 'ArrowLeft'), 3);
  assert.equal(L.suivant(2, 4, 'Home'), 0); assert.equal(L.suivant(0, 4, 'End'), 3);
  assert.equal(L.suivant(0, 6, 'ArrowRight', (j) => j === 0), -1, 'rien d\'ouvert : on ne bouge pas');
  assert.equal(L.suivant(0, 4, 'a'), -1);
});

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; html = '';
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

/** La page montée par la greffe de Genèse (thjalfi-cle.js → thjalfi-cle-etapes.js), sur une liste FAUSSE modifiable. */
async function page(o: { liste?: () => unknown; attente?: () => Promise<unknown> } = {}) {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, get activeElement() { return actif; }, hidden: false,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  let disques: unknown = (o.liste ?? LISTE)();
  const appels: string[] = [];
  let enVol = 0, enVolMax = 0;
  const post = async (action: string) => {
    appels.push(action);
    if (action === 'cle_disques') { enVol++; enVolMax = Math.max(enVolMax, enVol); try { if (o.attente) await o.attente(); return { ok: true, data: ici(disques) }; } finally { enVol--; } }
    return { ok: false, text: 'refusé par l\'essai' };
  };
  // Les minuteurs sont tenus à la main : on fait avancer le temps quand on veut.
  const minuteurs = new Map<number, () => unknown>(); let n = 0, maintenant = 1_000_000;
  const DateFaux = class extends Date { static now() { return maintenant; } };
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => false, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, Intl, Date: DateFaux, setInterval: (f: () => unknown) => { minuteurs.set(++n, f); return n; }, clearInterval: (i: number) => { minuteurs.delete(i); }, fetch: async () => { throw new Error('aucun réseau dans l\'essai'); } };
  vm.runInNewContext(ETAPES_JS, ctx); vm.runInNewContext(CLE_JS, ctx);
  // Comme Genèse : on dessine dans un nœud à part, puis on déplace ses enfants dans le corps de la page.
  const n0 = new Noeud('div');
  await (window.OdinGeneseCle as { dessiner: (r: Noeud, t: string, h: unknown) => Promise<void> }).dessiner(n0, 'cle', { post, act: post });
  corps.append(...n0.childNodes);
  const E = window.OdinGeneseCleEtapes as { MOTS: Record<string, string>; logique: Logique; choisir: (id: string) => { ok: boolean }; etat: { cle: string | null; etape: number; onglet: string; verif: { phase: string } | null } };
  const tic = async (ms = 1000) => { maintenant += ms; for (const f of [...minuteurs.values()]) await f(); await attendre(); };
  const radios = () => corps.querySelectorAll('.ck-disk').filter((x) => x.getAttribute('role') === 'radio');
  const carte = (id: string) => corps.querySelector(`[data-cle="${id}"]`);
  const onglet = (id: string) => corps.querySelector(`#ck-tab-${id}`)!;
  const etape = (k: number) => corps.querySelector(`[data-etape="${k}"]`)!;
  const bouton = (texte: string) => corps.querySelectorAll('button').find((b) => b.textContent.trim() === texte);
  const garde = () => corps.querySelector('.ck-guard');
  return { corps, E, M: E.MOTS, L: E.logique, appels, post, tic, enVolMax: () => enVolMax, minuteurs: () => minuteurs.size, n0, dessiner: (window.OdinGeneseCle as { dessiner: (r: Noeud, t: string, h: unknown) => Promise<void> }).dessiner, radios, carte, onglet, etape, bouton, garde, changer: (d: unknown) => { disques = d; }, actif: () => actif };
}

test('page : quatre onglets au clavier (flèches, Début, Fin), un seul choisi, tout est un vrai bouton', async () => {
  const p = await page();
  const tabs = p.corps.querySelectorAll('[role="tablist"] button');
  assert.deepEqual(tabs.map((t) => t.textContent), [p.M['onglet.deployer'], p.M['onglet.mescles'], p.M['onglet.demarrage'], p.M['onglet.parole']]);
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['true', 'false', 'false', 'false']);
  assert.deepEqual(tabs.map((t) => t.getAttribute('tabindex')), ['0', '-1', '-1', '-1'], 'un seul arrêt de Tab');
  assert.equal(await p.onglet('deployer').emettre('keydown', { key: 'ArrowRight' }), true);
  assert.equal(p.onglet('mescles').getAttribute('aria-selected'), 'true'); assert.equal(p.actif(), p.onglet('mescles'), 'le focus suit');
  await p.onglet('mescles').emettre('keydown', { key: 'End' });
  assert.equal(p.onglet('parole').getAttribute('aria-selected'), 'true');
  assert.equal(p.corps.querySelector('#ck-panneau')!.getAttribute('aria-labelledby'), 'ck-tab-parole');
  await p.onglet('parole').emettre('keydown', { key: 'ArrowRight' });
  assert.equal(p.onglet('deployer').getAttribute('aria-selected'), 'true', 'la fin revient au début');
  await p.onglet('deployer').emettre('keydown', { key: 'ArrowLeft' }); await p.onglet('parole').emettre('keydown', { key: 'Home' });
  assert.equal(p.onglet('deployer').getAttribute('aria-selected'), 'true');
});

test('page : ce que l\'appli sait déjà faire reste joignable sous « Mes clés » (les disques comme avant, « Préparer », double démarrage)', async () => {
  const p = await page();
  await p.onglet('mescles').emettre('click'); await attendre();
  const t = p.corps.textContent;
  assert.match(t, /Disques externes/); assert.match(t, /Disques internes/);
  assert.ok(p.bouton('Préparer la clé ODIN'), 'Préparer'); assert.ok(p.bouton('Voir le plan de double démarrage'), 'plan de double démarrage');
  assert.doesNotMatch(t, /Rufus|Ventoy|Microsoft/, 'aucun nom d\'outil copié à l\'écran');
  assert.equal(p.bouton('Préparer la clé ODIN') && p.corps.querySelectorAll('button').filter((b) => /Préparer/.test(b.textContent)).length, 3, 'jamais « Préparer » sur le disque du système, même en USB');
});

test('page : la barre des 6 étapes, fermée sans clé, puis au clavier ; aria-current sur l\'étape en cours', async () => {
  const p = await page();
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((k) => p.etape(k).disabled), [false, true, true, true, true, true]);
  assert.equal(p.etape(1).getAttribute('aria-current'), 'step');
  assert.equal(p.bouton(`${p.M['pied.continuer']}`)!.disabled, true, 'Continuer éteint sans clé');
  assert.equal(await p.etape(1).emettre('keydown', { key: 'ArrowRight' }), false, 'aucune étape ouverte : la flèche ne fait rien');
  await p.carte('faux-cle-64')!.emettre('click');
  assert.equal(p.etape(2).disabled, false);
  p.etape(1).focus();
  await p.etape(1).emettre('keydown', { key: 'ArrowRight' });
  assert.equal(p.actif(), p.etape(2), 'la flèche déplace le focus sur l\'étape suivante');
  await p.etape(2).emettre('click'); // Entrée sur un bouton
  assert.equal(p.etape(2).getAttribute('aria-current'), 'step'); assert.equal(p.etape(1).getAttribute('aria-current'), null);
  assert.ok(p.etape(1).classList.contains('fait'));
  await p.etape(2).emettre('keydown', { key: 'End' }); assert.equal(p.actif(), p.etape(6));
  await p.bouton(p.M['pied.retour'])!.emettre('click');
  assert.equal(p.etape(1).getAttribute('aria-current'), 'step');
});

test('page : un disque interne (ou le disque du système) n\'est jamais proposé, ni accepté par un appel direct', async () => {
  const p = await page();
  assert.deepEqual(p.radios().map((r) => r.getAttribute('data-cle')), ['faux-cle-64', 'faux-disque-1t', 'faux-cle-16']);
  const verrous = p.corps.querySelectorAll('.ck-disk.lock');
  assert.deepEqual(verrous.map((x) => x.getAttribute('data-verrou')).sort(), ['faux-hdd', 'faux-ssd', 'faux-usb-sys']);
  for (const v of verrous) { assert.equal(v.tagName, 'DIV', 'pas un bouton'); assert.equal(v.getAttribute('aria-disabled'), 'true'); assert.equal(v.getAttribute('tabindex'), null); }
  for (const id of ['faux-ssd', 'faux-hdd', 'faux-usb-sys']) {
    const r = p.E.choisir(id);
    assert.equal(r.ok, false); assert.equal(p.E.etat.cle, null, `${id} refusé`);
  }
  assert.match(p.corps.textContent, new RegExp(p.M['cle.refus'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(p.garde(), null, 'aucun garde-fou : rien n\'est choisi');
  assert.deepEqual(p.appels.filter((a) => a !== 'cle_disques'), [], 'rien d\'autre que la lecture de la liste');
});

test('page : le garde-fou rouge est juste sous la clé choisie et montre SON numéro de série ; les flèches changent de clé', async () => {
  const p = await page();
  await p.carte('faux-cle-64')!.emettre('click');
  const g = p.garde()!;
  assert.equal(g.getAttribute('role'), 'alert');
  const groupe = p.corps.querySelector('[role="radiogroup"]')!;
  assert.equal(groupe.children[groupe.children.indexOf(p.carte('faux-cle-64')!) + 1], g, 'juste sous la clé choisie');
  assert.match(g.textContent, new RegExp(p.M['garde.efface.titre']));
  assert.match(g.textContent, /Clé USB 64 Go/); assert.match(g.textContent, /…7F2A/); assert.doesNotMatch(g.textContent, /0C19|A410/);
  assert.match(g.textContent, /41/, 'ce qu\'elle contient');
  assert.ok(p.bouton(p.M['verif.bouton']), 'Vérifier en la débranchant');
  assert.equal(p.corps.querySelectorAll('button').filter((b) => /Copier/.test(b.textContent)).length, 0, 'pas de bouton de copie tant que l\'action n\'existe pas');
  assert.equal(p.carte('faux-cle-64')!.getAttribute('aria-checked'), 'true');
  await p.carte('faux-cle-64')!.emettre('keydown', { key: 'ArrowDown' });
  assert.equal(p.E.etat.cle, 'faux-disque-1t'); assert.equal(p.actif(), p.carte('faux-disque-1t'));
  assert.equal(p.carte('faux-cle-64')!.getAttribute('aria-checked'), 'false');
  assert.deepEqual(p.radios().map((r) => r.getAttribute('tabindex')), ['-1', '0', '-1']);
  assert.deepEqual(p.appels.filter((a) => a !== 'cle_disques'), [], 'choisir une clé n\'écrit rien');
});

test('page : une clé déjà ODIN est signalée, et son garde-fou dit que rien ne sera effacé', async () => {
  const p = await page();
  assert.match(p.carte('faux-disque-1t')!.querySelector('.ck-tag.ok')!.textContent, new RegExp(p.M['cle.tag.odin']));
  assert.equal(p.carte('faux-cle-64')!.querySelector('.ck-tag.ok'), null);
  await p.carte('faux-disque-1t')!.emettre('click');
  const g = p.garde()!;
  assert.ok(g.classList.contains('calm'));
  assert.match(g.textContent, new RegExp(p.M['garde.odin.titre']));
  assert.doesNotMatch(g.textContent, new RegExp(p.M['garde.efface.titre']));
  assert.equal(p.bouton(p.M['verif.bouton']), undefined);
});

test('page : « Vérifier en la débranchant » attend la disparition, refuse une autre clé, reconnaît le même numéro de série', async () => {
  const p = await page();
  await p.carte('faux-cle-64')!.emettre('click');
  await p.bouton(p.M['verif.bouton'])!.emettre('click');
  const statut = () => p.corps.querySelector('.ck-verif span')!.textContent;
  assert.match(statut(), /Débranche maintenant « Clé USB 64 Go » \(n° …7F2A\)/);
  await p.tic(); assert.equal(p.E.etat.verif!.phase, 'depart');
  p.changer({ externes: ici([DISQ1T, CLE16]), internes: ici([SSD]) });
  await p.tic();
  assert.equal(statut(), p.M['verif.retour']);
  assert.ok(p.garde(), 'le garde-fou reste pendant qu\'elle est débranchée'); assert.equal(p.E.etat.cle, 'faux-cle-64');
  p.changer({ externes: ici([DISQ1T, CLE16, { ...CLE64, id: 'faux-intrus', modele: 'Autre clé', serie: 'QQ12RR34B7C8' }]), internes: ici([SSD]) });
  await p.tic();
  assert.match(statut(), /Ce n'est pas la même clé \(n° …B7C8\)/); assert.equal(p.E.etat.cle, 'faux-cle-64', 'l\'autre clé n\'est pas prise');
  p.changer({ externes: ici([DISQ1T, CLE16, { ...CLE64, id: 'faux-cle-64-rebranchee' }]), internes: ici([SSD]) });
  await p.tic();
  assert.match(statut(), /C'est bien elle : même numéro de série \(…7F2A\)/);
  assert.equal(p.E.etat.cle, 'faux-cle-64-rebranchee', 'la clé reste choisie sous son nouvel identifiant');
  assert.equal(p.carte('faux-cle-64-rebranchee')!.getAttribute('aria-checked'), 'true');
  assert.deepEqual(p.appels.filter((a) => a !== 'cle_disques'), [], 'rien d\'écrit, seulement des lectures de la liste');
});

test('page : un disque externe branché (SSD externe, carte mémoire) est proposé avec la même carte et le même garde-fou rouge ; un interne jamais', async () => {
  const SSD_EXT: Disque = { id: 'faux-ssd-ext', chemin: 'faux-5', modele: 'SSD externe 500 Go', serie: 'SX55SX66D3E4', tailleOctets: 500 * G, genre: 'disque-externe', externe: true, bus: 'usb', amovible: true, partitions: [{ nom: 'p1', label: 'SAUVEGARDES', tailleOctets: 500 * G, utiliseOctets: 120 * G, systeme: 'donnees' }] };
  const CARTE: Disque = { id: 'faux-carte', chemin: 'faux-4', modele: 'Carte mémoire 32 Go', serie: 'SD12SD34F5A6', tailleOctets: 32 * G, genre: 'carte', externe: true, bus: 'sd', amovible: true, partitions: [{ nom: 'p1', label: 'PHOTOS', tailleOctets: 32 * G, utiliseOctets: 9 * G }] };
  const p = await page({ liste: () => ({ externes: ici([SSD_EXT, CARTE]), internes: ici([SSD, HDD]) }) });
  assert.ok(p.corps.textContent.includes(p.M['cle.titre']), 'Quelle clé ou quel disque ?');
  assert.deepEqual(p.radios().map((r) => r.getAttribute('data-cle')), ['faux-ssd-ext', 'faux-carte']);
  await p.carte('faux-ssd-ext')!.emettre('click');
  let g = p.garde()!;
  assert.equal(g.getAttribute('role'), 'alert');
  assert.ok(g.textContent.includes(p.M['garde.efface.titre.disque']));
  assert.ok(g.textContent.includes('SSD externe 500 Go')); assert.ok(g.textContent.includes('…D3E4')); assert.ok(!g.textContent.includes('F5A6'));
  assert.equal(p.M['verif.bouton.disque'], 'Vérifier en le débranchant');
  assert.ok(p.bouton(p.M['verif.bouton.disque']), 'Vérifier en le débranchant (un disque)'); assert.equal(p.bouton(p.M['verif.bouton']), undefined);
  await p.carte('faux-carte')!.emettre('click');
  g = p.garde()!;
  assert.ok(g.textContent.includes('…F5A6')); assert.ok(g.textContent.includes(p.M['bus.sd']));
  for (const id of ['faux-ssd', 'faux-hdd']) { assert.equal(p.E.choisir(id).ok, false); assert.equal(p.carte(id), null); }
  assert.equal(p.E.etat.cle, 'faux-carte');
  assert.deepEqual(p.appels.filter((a) => a !== 'cle_disques'), [], 'rien d\'écrit');
});

test('page : une clé choisie qui disparaît hors vérification n\'est plus choisie, et c\'est dit', async () => {
  const p = await page();
  await p.carte('faux-cle-64')!.emettre('click');
  p.changer({ externes: ici([DISQ1T]), internes: ici([SSD]) });
  await p.tic(3000);
  assert.equal(p.E.etat.cle, null); assert.equal(p.garde(), null);
  assert.match(p.corps.textContent, new RegExp(p.M['cle.partie'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ------------------------------------------------------------------ relecture adverse (disques FAUX, rien n'est écrit)
test('relecture : un AUTRE disque qui prend l\'identifiant de la clé choisie (/dev/sdb réutilisé) ne devient pas la clé choisie', async () => {
  const p = await page();
  await p.carte('faux-cle-64')!.emettre('click');
  assert.equal(p.E.etat.cle, 'faux-cle-64');
  // La clé est débranchée et une autre arrive sous le même identifiant, entre deux relectures.
  const intrus = { ...ici(CLE64), modele: 'Disque photos', serie: 'ZZ98YY76X5W4', tailleOctets: 128 * G, partitions: [{ nom: 'p1', label: 'PHOTOS', tailleOctets: 128 * G, utiliseOctets: 90 * G }] };
  p.changer({ externes: [intrus, ici(DISQ1T), ici(CLE16)], internes: ici([SSD, HDD]) });
  await p.tic(3000);
  assert.equal(p.E.etat.cle, null, 'le choix n\'a pas glissé sur un autre disque');
  assert.equal(p.garde(), null);
  assert.ok(p.corps.textContent.includes(p.M['cle.partie']));
  // Sans numéro de série, le nom ou la taille qui change suffit aussi.
  const q = await page({ liste: () => ({ externes: [{ ...ici(CLE64), serie: undefined }], internes: [] }) });
  await q.carte('faux-cle-64')!.emettre('click');
  q.changer({ externes: [{ ...ici(CLE64), serie: undefined, modele: 'Autre clé', tailleOctets: 32 * G }], internes: [] });
  await q.tic(3000);
  assert.equal(q.E.etat.cle, null);
});

test('relecture : la liste relue toutes les 3 s ne lance jamais une lecture tant que la précédente n\'est pas finie', async () => {
  let liberer: () => void = () => {};
  let lent = false;
  const p = await page({ attente: () => (lent ? new Promise<void>((ok) => { liberer = ok; }) : Promise.resolve()) });
  lent = true;
  for (let i = 0; i < 5; i++) await p.tic(3000);
  assert.equal(p.enVolMax(), 1, 'une seule lecture à la fois (pas de PowerShell empilés)');
  liberer(); await attendre();
  // Pendant « Vérifier en la débranchant » (relue chaque seconde) : pareil.
  lent = false; await p.tic(3000);
  await p.carte('faux-cle-64')!.emettre('click');
  await p.bouton(p.M['verif.bouton'])!.emettre('click');
  lent = true;
  for (let i = 0; i < 5; i++) await p.tic(1000);
  assert.equal(p.enVolMax(), 1);
  liberer(); await attendre();
});

test('relecture : une lecture ratée (liste vide d\'un coup) n\'est pas « elle a disparu » : pas de faux « c\'est bien elle »', () => {
  const L = logique();
  const data0 = LISTE(), c = L.vueDisques(data0).cles[0];
  let v = L.debutVerif(c, data0, 0);
  v = L.suivreVerif(v, { externes: [], internes: [] }, 1000);
  assert.equal(v.phase, 'depart', 'tous les disques disparus d\'un coup : lecture ratée, on attend encore');
  v = L.suivreVerif(v, data0, 2000);
  assert.notEqual(v.phase, 'ok', 'jamais débranchée : rien n\'est vérifié');
});

test('relecture : deux clés au même numéro de série : pas de vérification par ce numéro, et jamais « c\'est bien elle » sur l\'autre', () => {
  const L = logique();
  const jumelle = { ...ici(CLE64), id: 'faux-jumelle', chemin: 'faux-5', modele: 'Clé jumelle' };
  const data0 = { externes: [ici(CLE64), jumelle], internes: ici([SSD]) };
  const v0 = L.vueDisques(data0);
  for (const c of v0.cles) { assert.equal(c.serie, '', 'numéro partagé : il ne prouve rien'); assert.equal(L.garde(c)!.verifier, false); }
  // Même si une vérification était déjà en cours : la même série revenue avec une autre taille n'est pas elle.
  const c = L.vueDisques(LISTE()).cles[0];
  let v = L.debutVerif(c, LISTE(), 0);
  v = L.suivreVerif(v, { externes: ici([DISQ1T, CLE16]), internes: ici([SSD]) }, 1);
  assert.equal(v.phase, 'retour');
  v = L.suivreVerif(v, { externes: ici([DISQ1T, CLE16, { ...CLE64, id: 'faux-clone', tailleOctets: 8 * G }]), internes: ici([SSD]) }, 2);
  assert.notEqual(v.phase, 'ok', 'même numéro, autre taille : pas elle');
});

test('relecture : un disque dont « amovible » est absent n\'est pas choisissable (même règle que le serveur)', () => {
  const L = logique();
  assert.equal(L.choisissable({ externe: true }), false);
  assert.equal(L.choisissable({ externe: true, amovible: true }), true);
});

test('relecture : Genèse qui redessine l\'onglet deux fois de suite ne laisse tourner qu\'une seule relecture', async () => {
  const p = await page();
  const avant = p.minuteurs();
  const a = new Noeud('div'), b = new Noeud('div');
  const deux = [p.dessiner(a, 'cle', { post: p.post, act: p.post }), p.dessiner(b, 'cle', { post: p.post, act: p.post })];
  await Promise.all(deux);
  p.corps.append(...b.childNodes);
  assert.equal(p.minuteurs(), avant, 'un seul minuteur de relecture vivant');
});

test('relecture : les mots du disque (« le ») et de la clé (« la ») viennent du dictionnaire', () => {
  const L = logique();
  const SSD_EXT = { ...ici(CLE64), id: 'faux-ssd-ext', genre: 'disque-externe', modele: 'SSD externe', tailleOctets: 500 * G };
  const d = L.vueDisques({ externes: [SSD_EXT], internes: [] }).cles[0];
  const sans = L.vueDisques({ externes: [{ ...SSD_EXT, serie: undefined }], internes: [] }).cles[0];
  assert.ok(L.garde(sans)!.points.includes(L.MOTS['garde.efface.sansSerie.disque']));
  let v = L.debutVerif(d, { externes: [SSD_EXT], internes: ici([SSD]) }, 0);
  assert.equal(L.texteVerif(v), L.mot('verif.depart', { nom: 'SSD externe', serie: '…7F2A' }));
  v = L.suivreVerif(v, { externes: [], internes: ici([SSD]) }, 1);
  assert.equal(L.texteVerif(v), L.MOTS['verif.retour.disque']);
  for (const k of ['verif.bouton', 'verif.bouton.disque', 'verif.retour', 'verif.retour.disque', 'verif.ok', 'verif.ok.disque', 'verif.autre', 'verif.autre.disque', 'garde.efface.sansSerie', 'garde.efface.sansSerie.disque', 'verrou.sous', 'cle.partie.disque']) assert.ok(L.MOTS[k], k);
});
