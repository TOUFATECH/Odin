// Genèse · Clés USB, lot C4 (la page) : l'étape 6 « Vérifier » (récapitulatif avec « Changer », le fichier de réponses
// Windows résumé puis replié derrière « Voir le fichier exact »), la confirmation (la phrase tapée ET l'appui long de
// 3 s : l'un sans l'autre ne suffit jamais), l'écran d'écriture (étapes nommées, « Annuler » qui dit si la clé est déjà
// touchée), l'écran de fin (éjecter, touches de démarrage). La page parle aux VRAIES actions du serveur, sur une
// liste de disques fausse et un faux disque (dossier temporaire) : aucun vrai disque, aucune commande, aucun réseau.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { attendreEcriture, cleUsb } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { apercuScriptCle } from '../src/valhalla/modules/thjalfi.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const src = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const JS = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle-logiciels.js'].map(src);
let SUIVI_JS = '';
try { SUIVI_JS = src('thjalfi-cle-suivi.js'); } catch { /* avant le lot C4 : le fichier n'existe pas */ }
const G = 1024 ** 3;
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c4p-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ données fausses, serveur vrai
const CLE64 = { id: 'faux-cle-64', chemin: 'faux-9', modele: 'Clé USB 64 Go', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle', externe: true, bus: 'usb', amovible: true, partitions: [] };
const SSD = { id: 'faux-ssd', chemin: 'faux-0', modele: 'SSD interne 512 Go', serie: 'SSD0000FAUX1', tailleOctets: 512 * G, genre: 'interne', externe: false, bus: 'nvme', amovible: false, systemeEnCours: true, partitions: [] };
const iso = (id: string, name: string, go: number, recipe: Record<string, unknown>) => ({ id, name, path: `faux/${name}.iso`, size: Math.round(go * G), mtime: 1, recipe });
const ISOS = () => ici([
  iso('ubuntu', 'ubuntu-24.04-desktop-amd64', 5.8, { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' }),
  iso('win11', 'Win11_Pro_24H2_faux_x64', 5.4, { kind: 'windows', label: 'Windows', auto: true, os: 'windows' }),
]);
function serveur() {
  const srcd = neuf('src'), img = neuf('img'), home = neuf('home'), dir = neuf('dir');
  const f = (n: string, c: string) => { const p = join(srcd, n); writeFileSync(p, c); return p; };
  const biblio = ISOS().map((i) => ({ id: i.id, nom: i.name, chemin: f(`${i.id}.iso`, `ISO-${i.id}`), recipe: i.recipe as never }));
  const fiches = [{ source: 'firefox', nom: 'Firefox', fichier: 'Firefox-Setup-faux.exe', chemin: f('ff.exe', 'EXE') }];
  const commandes = { n: 0 };
  const ctx = {
    home, dir, settings: { cleDisquesTest: [CLE64, SSD], cleImageTest: img }, now: () => new Date(),
    run: async () => { commandes.n++; throw new Error('aucune commande dans l\'essai'); },
    call: async (m: string) => { if (m === 'fjalar') return { ok: true, text: '', data: { fichiers: ici(fiches) } }; throw new Error('absent'); },
  } as unknown as ModCtx;
  const actions = [...cleUsb({ bibliotheque: async () => biblio, antivirus: () => undefined, profil: () => ({ utilisateur: 'famille', langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }) }).actions,
    apercuScriptCle(() => [{ id: 'p', nom: 'p', utilisateur: 'famille', paquets: [], logiciels: [], langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }])];
  return { ctx, img, commandes, action: (id: string) => actions.find((a) => a.id === id) };
}

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
  set disabled(v: boolean) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
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
const calme = async () => { for (let k = 0; k < 12; k++) await attendre(); };

/** La page de Genèse montée avec ses six fichiers ; une horloge et des minuteurs à la main (l'appui long). */
async function page(o: { confirmer?: boolean } = {}) {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, get activeElement() { return actif; }, hidden: false,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const S = serveur();
  const appels: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  const post = async (action: string, input: Record<string, unknown> = {}, confirm = false) => {
    appels.push({ action, input: ici(input), confirm });
    if (action === 'cle_disques') return { ok: true, data: { externes: [ici(CLE64)], internes: [ici(SSD)] } };
    if (action === 'isos') return { ok: true, data: ISOS() };
    if (action === 'cle_vms') return { ok: true, data: [] };
    const a = S.action(action);
    // L'écriture passe par la porte : elle exige la confirmation (action grave), comme /api/valhalla/act.
    if (a?.grave && a.grave(input) && !confirm) return { ok: false, confirm: 'Confirmer ?' };
    if (a) return ici(await a.run(S.ctx, ici(input)));
    return { ok: false, text: 'refusé par l\'essai' };
  };
  let horloge = 1_000_000;
  const minuteurs = new Map<number, () => void>(); let nm = 0;
  const FauxDate = class extends Date { static now() { return horloge; } };
  const dialogues: string[] = [];
  const window: Record<string, unknown> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return o.confirmer ?? false; }, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, Node: Noeud, Intl, TextEncoder, Date: FauxDate, setInterval: (f: () => void) => { minuteurs.set(++nm, f); return nm; }, clearInterval: (k: number) => { minuteurs.delete(k); }, setTimeout, clearTimeout, fetch: async () => { throw new Error('aucun réseau dans l\'essai'); } };
  for (const js of [...JS, SUIVI_JS]) if (js) vm.runInNewContext(js, ctx);
  const n0 = new Noeud('div');
  await (window.OdinGeneseCle as { dessiner: (r: Noeud, t: string, h: unknown) => Promise<void> }).dessiner(n0, 'cle', { post, act: post });
  corps.append(...n0.childNodes);
  const q = (s: string) => corps.querySelector(s);
  const etape = (k: number) => q(`[data-etape="${k}"]`)!;
  const continuer = () => q('[data-f="continuer"]')!;
  /** Avance l'horloge et fait tourner les minuteurs (par pas de 50 ms, comme la page). */
  const temps = async (ms: number) => { for (let t = 0; t < ms; t += 50) { horloge += 50; for (const f of [...minuteurs.values()]) f(); } await calme(); };
  /** Clé 64 Go, Ubuntu et Windows, jusqu'à l'étape 6. */
  const aller6 = async () => {
    await q('[data-cle="faux-cle-64"]')!.emettre('click');
    await etape(2).emettre('click'); await continuer().emettre('click'); await calme();
    for (const id of ['iso:ubuntu', 'iso:win11']) { await q(`[data-sys="${id}"]`)!.emettre('click'); await calme(); }
    await continuer().emettre('click'); await calme();
    await continuer().emettre('click'); await calme();
    await continuer().emettre('click'); await calme();
  };
  const taper = async (t: string) => { const c = q('[data-f="phrase"]')!; c.value = t; await c.emettre('input'); await calme(); };
  const E = window.OdinGeneseCleEtapes as { etat: { etape: number } };
  const V = window.OdinGeneseCleSuivi as { MOTS: Record<string, string>; logique: Record<string, any>; etat: Record<string, any> } | undefined;
  return { corps, appels, dialogues, q, etape, continuer, temps, aller6, taper, E, V, S, ecrire: () => appels.filter((a) => a.action === 'cle_preparer') };
}

// ------------------------------------------------------------------ la logique
test('C4 · page : la phrase seule ou l\'appui long seul ne suffisent jamais', () => {
  const ctx: Record<string, any> = { window: {}, Intl }; vm.runInNewContext(SUIVI_JS, ctx);
  const L = ctx.window.OdinGeneseCleSuivi?.logique;
  assert.ok(L, 'thjalfi-cle-suivi.js expose sa logique');
  assert.equal(L.peutEcrire({ phraseOk: true, appuiMs: 0 }), false, 'la phrase seule');
  assert.equal(L.peutEcrire({ phraseOk: true, appuiMs: 2999 }), false, 'appui trop court');
  assert.equal(L.peutEcrire({ phraseOk: false, appuiMs: 60_000 }), false, 'l\'appui long seul');
  assert.equal(L.peutEcrire({ phraseOk: true, appuiMs: 3000 }), true, 'les deux');
  assert.equal(L.phraseOk('Effacer la CLE  64 Go', 'effacer la clé 64 go'), true);
  assert.equal(L.phraseOk('effacer la clé 32 go', 'effacer la clé 64 go'), false);
  assert.equal(L.phraseOk('', ''), false, 'sans phrase du serveur, rien n\'est juste');
  assert.deepEqual(ici([L.resteAppui(0), L.resteAppui(1200), L.resteAppui(3000)]), [3, 2, 0]);
  assert.match(L.texteAnnuler(false), /Rien n'est encore écrit/);
  assert.match(L.texteAnnuler(true), /déjà en partie écrite/);
  const ph = L.etatsPhases({ phase: 'systemes', phases: L.PHASES, fini: false });
  assert.deepEqual(ici(ph.slice(0, 4).map((x: { etat: string }) => x.etat)), ['fait', 'fait', 'encours', 'attente']);
  assert.ok(L.etatsPhases({ phase: 'controle', phases: L.PHASES, fini: true, reussi: true }).every((x: { etat: string }) => x.etat === 'fait'));
  assert.deepEqual(ici(L.cibleDe({ id: 'a', serie: 'S1234', tailleOctets: 9, modele: 'M', chemin: '/dev/sdz', partitions: [] })), { id: 'a', serie: 'S1234', tailleOctets: 9, modele: 'M' }, 'seuls l\'identifiant, le numéro, la taille et le modèle partent');
  const texte = Object.values(ctx.window.OdinGeneseCleSuivi.MOTS).join(' ');
  assert.ok(!/Rufus|Ventoy|Microsoft/.test(texte), 'aucun nom copié dans les mots');
});

// ------------------------------------------------------------------ l'étape 6
test('C4 · page : « Vérifier » montre le récapitulatif avec « Changer », le plan du serveur, les réponses Windows repliées', async () => {
  const p = await page();
  await p.aller6();
  assert.equal(p.E.etat.etape, 6);
  assert.ok(p.V, 'l\'étape 6 est chargée');
  const t = p.corps.textContent;
  assert.match(t, /Vérifier avant d'écrire/);
  for (const k of [1, 2, 3, 4, 5]) assert.ok(p.q(`[data-f="changer-${k}"]`), `« Changer » vers l'étape ${k}`);
  assert.match(t, /Ubuntu/); assert.match(t, /Windows 11/);
  assert.match(t, /Tout ce qui est sur la clé sera effacé/);
  assert.equal(p.q('[data-phrase]')?.getAttribute('data-phrase'), 'effacer la clé 64 go', 'la phrase vient du serveur');
  assert.match(t, /compte local « Utilisateur »/i, 'le résumé en clair, au-dessus');
  const voir = p.q('[data-f="voir-xml"]')!;
  assert.equal(voir.tagName, 'DETAILS'); assert.equal(voir.getAttribute('open'), null, 'replié');
  assert.match(String(p.q('[data-xml="autounattend.xml"]')?.textContent), /<unattend/, 'le fichier exact, tel quel');
  // « Changer » ramène à l'étape choisie.
  await p.q('[data-f="changer-3"]')!.emettre('click'); await calme();
  assert.equal(p.E.etat.etape, 3);
  assert.equal(p.ecrire().length, 0, 'rien n\'est écrit');
});

test('C4 · page : sans la phrase, ou en relâchant avant 3 s, rien ne part ; les deux ensemble lancent l\'écriture confirmée', async () => {
  const p = await p0();
  async function p0() { const x = await page(); await x.aller6(); return x; }
  const bouton = () => p.q('[data-f="ecrire"]')!;
  assert.equal(bouton().disabled, true, 'éteint sans la phrase');
  await bouton().emettre('pointerdown'); await p.temps(4000);
  assert.equal(p.ecrire().length, 0, 'l\'appui long seul ne fait rien');
  await p.taper('effacer la clé 32 go');
  assert.equal(bouton().disabled, true, 'une phrase fausse');
  await p.taper('Effacer la clé 64 Go');
  assert.equal(bouton().disabled, false);
  await bouton().emettre('pointerdown'); await p.temps(2000); await bouton().emettre('pointerup'); await p.temps(2000);
  assert.equal(p.ecrire().length, 0, 'relâché à 2 s : rien');
  assert.match(p.corps.textContent, /Relâché trop tôt/);
  await bouton().emettre('keydown', { key: ' ' }); await p.temps(3100);
  const e = p.ecrire();
  assert.equal(e.length, 1, 'la phrase ET 3 s d\'appui');
  assert.equal(e[0].confirm, true, 'confirmée à la porte');
  assert.equal(e[0].input.phrase, 'Effacer la clé 64 Go');
  assert.deepEqual(e[0].input.cible, { id: 'faux-cle-64', serie: 'AA11BB227F2A', tailleOctets: 64 * G, modele: 'Clé USB 64 Go' });
  assert.deepEqual((e[0].input.systemes as Array<{ iso: string }>).map((s) => s.iso), ['iso:ubuntu', 'iso:win11'], 'les ISO par leur identifiant');
  await attendreEcriture('faux-cle-64');
  assert.equal(p.S.commandes.n, 0, 'aucune commande');
});

test('C4 · page : écran d\'écriture (étapes nommées), puis la fin (Odin content, éjecter, touches de démarrage)', async () => {
  const p = await page();
  await p.aller6();
  await p.taper('effacer la clé 64 go');
  await p.q('[data-f="ecrire"]')!.emettre('pointerdown'); await p.temps(3100);
  assert.ok(p.q('.ckv-phases'), 'l\'écran d\'écriture');
  for (const n of ['Revérifier la clé', 'Copier les systèmes', 'Tout relire']) assert.match(p.corps.textContent, new RegExp(n));
  assert.ok(p.etape(1).disabled, 'pendant l\'écriture, on ne change pas d\'étape');
  await attendreEcriture('faux-cle-64');
  await p.temps(800);
  assert.match(p.corps.textContent, /Ta clé ODIN est prête/);
  assert.match(p.corps.textContent, /F12/); assert.match(p.corps.textContent, /Lenovo/);
  assert.ok(existsSync(join(p.S.img, 'ISO/ubuntu-24.04-desktop-amd64.iso')), 'le faux disque est écrit');
  await p.q('[data-f="ejecter"]')!.emettre('click'); await calme();
  assert.match(p.corps.textContent, /Clé éjectée/);
  assert.equal(p.appels.filter((a) => a.action === 'cle_ejecter').length, 1);
  assert.equal(p.S.commandes.n, 0, 'aucune commande lancée');
});

test('C4 · page : « Annuler » demande confirmation, et dit si la clé est déjà touchée', async () => {
  const p = await page({ confirmer: false });
  await p.aller6();
  await p.taper('effacer la clé 64 go');
  await p.q('[data-f="ecrire"]')!.emettre('pointerdown'); await p.temps(3100);
  // Avant la première réponse du suivi : « rien n'est encore écrit ».
  p.V!.etat.progres = { pct: 0, phase: 'verifier', phases: p.V!.logique.PHASES, touchee: false, fini: false };
  await p.q('[data-f="annuler"]')!.emettre('click'); await calme();
  assert.match(p.dialogues.at(-1)!, /Rien n'est encore écrit/);
  p.V!.etat.progres = { pct: 40, phase: 'systemes', phases: p.V!.logique.PHASES, touchee: true, fini: false };
  await p.q('[data-f="annuler"]')!.emettre('click'); await calme();
  assert.match(p.dialogues.at(-1)!, /déjà en partie écrite/);
  assert.equal(p.appels.filter((a) => a.action === 'cle_annuler').length, 0, 'refusé dans la boîte : rien n\'est arrêté');
  await attendreEcriture('faux-cle-64');
});
