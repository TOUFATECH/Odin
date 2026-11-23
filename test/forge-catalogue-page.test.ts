// Genèse · Systèmes, lot S2 (la page) : « Ajouter un système » — le catalogue d'Andromède rangé par familles, la version
// à choisir sur chaque carte, « Toutes les versions », PC ou ARM 64, la file de téléchargement (un à la fois), « à
// déposer » avec la page officielle et le dossier. L'onglet seul est monté dans un document minimal ; Andromède répond
// avec les VRAIES entrées du Store (catalogue réel). Aucun réseau, aucun disque, rien d'écrit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { ISO } from '../src/valhalla/forge/sources.ts';
import { entrees } from '../src/valhalla/forge/store.ts';

const src = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const G = 1024 ** 3;
const ici = <V>(x: V): V => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ un document minimal (le même que pour le lot S1)
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

/** L'onglet « Systèmes » seul, monté dans un document minimal ; Andromède répond avec le VRAI catalogue (entrées du Store). */
async function page(o: { confirmer?: boolean; minuteurs?: boolean } = {}) {
  racine = new Noeud('html'); actif = null;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ module: string; action: string; input: Record<string, unknown> }> = [];
  const etat = { file: [] as Array<{ source: string; nom: string; version: string }>, enCours: undefined as undefined | Record<string, unknown> };
  const lus: Record<string, unknown[]> = {};
  const repondre = (module: string, action: string, input: Record<string, unknown> = {}): unknown => {
    if (module === 'thjalfi' && action === 'systemes') return { ok: true, data: { cartes: [], chiffres: { prets: 0, enCours: 0, majs: 0 }, place: {}, dossier: 'E:/ISO', lu: { bibliotheque: true } } };
    if (module !== 'eitri') return { ok: false, text: 'refusé par l\'essai' };
    if (action === 'store') {
      const enFile = new Map<string, string[]>(); for (const y of etat.file) enFile.set(y.source, [...(enFile.get(y.source) ?? []), y.version]);
      const l = entrees({ sources: ISO, presents: new Map([['ubuntu', ['22.04.5']]]), suivis: new Set(), vues: { ubuntu: { version: '24.04.3', at: 1, taille: 6 * G }, debian: { version: '13.2.0', at: 1 } }, enCours: new Set(), versions: lus as never, enFile, telecharge: etat.enCours ? { [String(etat.enCours.source)]: String(etat.enCours.version) } : {} });
      return { ok: true, data: { entrees: l, total: l.length, dossier: 'E:/ISO' } };
    }
    if (action === 'file') return { ok: true, data: { ...(etat.enCours ? { enCours: etat.enCours } : {}), file: etat.file } };
    if (action === 'versions') { lus[String(input.nom)] = [{ version: '24.04.3', canal: 'LTS', defaut: true, taille: 6 * G }, { version: '22.04.5', canal: 'ancienne', defaut: true }, { version: '20.04.6', canal: 'ancienne', defaut: false }]; return { ok: true, data: { versions: lus[String(input.nom)], presents: ['22.04.5'] } }; }
    if (action === 'mettre_en_file') { const v = String(input.version); if (!etat.enCours) etat.enCours = { source: input.nom, nom: 'Ubuntu (bureau, LTS)', version: v, recu: 10, total: 100, pct: 10 }; else etat.file.push({ source: String(input.nom), nom: 'Ubuntu (bureau, LTS)', version: v }); return { ok: true, text: `Ubuntu ${v} attend son tour` }; }
    if (action === 'retirer_de_la_file') { etat.file = etat.file.filter((y) => y.version !== input.version); return { ok: true, text: 'retiré de la file.' }; }
    if (action === 'annuler') { etat.enCours = undefined; return { ok: true, text: 'Arrêté' }; }
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const fetch = async (_u: string, b0: { body: string }) => { const b = JSON.parse(b0.body); appels.push({ module: b.module, action: b.action, input: b.input }); return { json: async () => ici(repondre(b.module, b.action, b.input)) }; };
  const dialogues: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return o.confirmer === true; }, alert: async (t: string) => { dialogues.push(t); }, prompt: async () => null } };
  const location = { hash: '' };
  const minuteurs = new Map<number, () => unknown>(); let nm = 0;
  const ctx = { window, document, location, Node: Noeud, Intl, Date, setTimeout: (f: () => unknown) => { if (!o.minuteurs) return 0; minuteurs.set(++nm, f); return nm; }, clearTimeout: (i: number) => { minuteurs.delete(i); }, fetch };
  vm.runInNewContext(src('thjalfi-systemes.js'), ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinGeneseSystemes.dessiner(host, 'systemes', { aller: () => {}, post: async (a: string, i: Record<string, unknown>) => (await (await fetch('', { body: JSON.stringify({ module: 'thjalfi', action: a, input: i }) })).json()) });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const carte = (id: string) => qa('[data-ccarte]').find((c) => c.getAttribute('data-ccarte') === id)!;
  const pills = (c: Noeud) => c.querySelectorAll('[data-f="c-pill"]');
  const tic = async () => { const l = [...minuteurs]; minuteurs.clear(); for (const [, f] of l) await f(); await calme(); };
  return { corps, q, qa, carte, pills, appels, dialogues, window, location, etat, tic, minuteurs, actif: () => actif };
}

test('S2 · page : « Ajouter un système » ouvre le catalogue rangé par familles, avec leur nombre ; retour à la bibliothèque', async () => {
  const P = await page();
  assert.ok(P.q('[data-f="ajouter"]'), 'le Store complet d\'Andromède reste joignable');
  await P.q('[data-f="catalogue"]')!.emettre('click'); await calme();
  assert.equal(P.q('#sy-c-titre')!.textContent, 'Ajouter un système');
  assert.equal(P.actif()?.getAttribute('data-f'), 'retour', 'le focus va sur « Ma bibliothèque »');
  const groupes = P.qa('[data-groupe]').map((g) => [g.getAttribute('data-groupe'), Number(g.querySelector('.n')!.textContent)] as const);
  assert.deepEqual(groupes.map((x) => x[0]), ['windows', 'linux', 'serveur', 'outil', 'autre']);
  const vrai = entrees({ sources: ISO, presents: new Map(), suivis: new Set(), vues: {}, enCours: new Set() }).filter((e) => e.arch !== 'arm64');
  for (const [g, n] of groupes) assert.equal(n, vrai.filter((e) => e.groupe === g).length, g);
  // Filtre de famille, recherche sans accents, ARM 64.
  await P.q('[data-cfiltre="windows"]')!.emettre('click'); await calme();
  assert.deepEqual(P.qa('[data-groupe]').map((g) => g.getAttribute('data-groupe')), ['windows']);
  assert.equal(P.q('[data-cfiltre="windows"]')!.getAttribute('aria-pressed'), 'true');
  await P.q('[data-cfiltre="tout"]')!.emettre('click');
  const i = P.q('[data-f="c-recherche"]')!; i.value = 'PARE feu'; await i.emettre('input'); await calme();
  assert.deepEqual(P.qa('[data-ccarte]').map((c) => c.getAttribute('data-ccarte')).sort(), ['ipfire', 'opnsense', 'pfsense']);
  i.value = ''; await i.emettre('input');
  const a = P.q('[data-f="c-arch"]')!; a.value = 'arm'; await a.emettre('change'); await calme();
  assert.deepEqual(P.qa('[data-ccarte]').map((c) => c.getAttribute('data-ccarte')).sort(), vrai.length ? entrees({ sources: ISO, presents: new Map(), suivis: new Set(), vues: {}, enCours: new Set() }).filter((e) => e.arch === 'arm64').map((e) => e.id).sort() : []);
  a.value = 'x86_64'; await a.emettre('change'); await calme();
  await P.q('[data-f="retour"]')!.emettre('click'); await calme();
  assert.ok(P.q('[data-f="grille"]'), 'retour à la bibliothèque');
  assert.equal(P.actif()?.getAttribute('data-f'), 'catalogue', 'le focus revient sur « Ajouter un système »');
});

test('S2 · page : choisir la version, « Toutes les versions », télécharger (après ton accord), la file un à la fois, retirer, arrêter', async () => {
  const P = await page({ confirmer: true });
  await P.q('[data-f="catalogue"]')!.emettre('click'); await calme();
  let u = P.carte('ubuntu');
  // Avant lecture : la dernière version vue ; « Toutes les versions » propose de lire les autres sur le site officiel.
  assert.deepEqual(P.pills(u).map((b) => b.textContent), ['24.04.3']);
  assert.match(u.querySelector('[data-f="c-tel"]')!.textContent, /Télécharger · 6,0\s*Go/);
  assert.equal(u.querySelector('[data-f="c-versions"]'), null);
  await P.q('[data-f="c-toutes"]')!.emettre('click'); await calme();
  assert.equal(P.q('[data-f="c-toutes"]')!.getAttribute('aria-checked'), 'true');
  assert.equal(P.q('[data-f="c-toutes"]')!.getAttribute('role'), 'switch');
  u = P.carte('ubuntu'); await u.querySelector('[data-f="c-versions"]')!.emettre('click'); await calme();
  assert.ok(P.appels.some((x) => x.module === 'eitri' && x.action === 'versions' && x.input.nom === 'ubuntu'));
  u = P.carte('ubuntu');
  assert.deepEqual(P.pills(u).map((b) => b.textContent), ['24.04.3 · LTS', '22.04.5 · ancienne', '20.04.6 · ancienne']);
  assert.equal(u.querySelector('[role="group"]')!.getAttribute('aria-label'), 'Version de Ubuntu (bureau, LTS)');
  // Sans « Toutes les versions » : la dernière et la LTS d'avant.
  await P.q('[data-f="c-toutes"]')!.emettre('click'); await calme(); u = P.carte('ubuntu');
  assert.deepEqual(P.pills(u).map((b) => b.getAttribute('data-v')), ['24.04.3', '22.04.5']);
  // 22.04.5 est déjà dans la bibliothèque ; le focus reste sur la version choisie.
  await P.pills(u)[1].emettre('click'); await calme(); u = P.carte('ubuntu');
  assert.equal(P.pills(u)[1].getAttribute('aria-pressed'), 'true');
  assert.equal(P.actif()?.getAttribute('data-v'), '22.04.5');
  assert.match(u.textContent, /Dans ta bibliothèque/);
  // 24.04.3 : télécharger, après ton accord.
  await P.pills(u)[0].emettre('click'); await calme(); u = P.carte('ubuntu');
  await u.querySelector('[data-f="c-tel"]')!.emettre('click'); await calme();
  assert.match(P.dialogues.at(-1)!, /Télécharger Ubuntu \(bureau, LTS\) 24\.04\.3 depuis le site officiel \? \(6,0\s*Go\)/);
  assert.deepEqual(P.appels.filter((x) => x.action === 'mettre_en_file').map((x) => x.input), [{ nom: 'ubuntu', version: '24.04.3' }]);
  u = P.carte('ubuntu');
  assert.match(u.querySelector('[data-f="c-cours"]')!.textContent, /Téléchargement · 10\s*%/);
  assert.match(P.q('[data-f="c-barre"]')!.textContent, /24\.04\.3 se télécharge/);
  // Une autre version attend son tour ; on la retire de la file (rien n'est effacé).
  await P.q('[data-f="c-toutes"]')!.emettre('click'); await calme(); u = P.carte('ubuntu');
  await P.pills(u)[2].emettre('click'); await calme(); u = P.carte('ubuntu');
  await u.querySelector('[data-f="c-tel"]')!.emettre('click'); await calme(); u = P.carte('ubuntu');
  assert.match(u.querySelector('[data-f="c-enfile"]')!.textContent, /En file · après Ubuntu \(bureau, LTS\) 24\.04\.3/);
  assert.match(P.q('[data-f="c-barre"]')!.textContent, /1 en attente/);
  await u.querySelector('[data-f="c-retirer"]')!.emettre('click'); await calme();
  assert.match(P.dialogues.at(-1)!, /Rien n'est effacé/);
  assert.deepEqual(P.appels.filter((x) => x.action === 'retirer_de_la_file').map((x) => x.input), [{ nom: 'ubuntu', version: '20.04.6' }]);
  // Arrêter celui qui se télécharge.
  u = P.carte('ubuntu'); await P.pills(u)[0].emettre('click'); await calme(); u = P.carte('ubuntu');
  await u.querySelector('[data-f="c-arreter"]')!.emettre('click'); await calme();
  assert.match(P.dialogues.at(-1)!, /reprendra/);
  assert.ok(P.appels.some((x) => x.action === 'annuler' && x.input.nom === 'ubuntu'));
});

test('S2 · page : refusé dans la boîte d\'accord, rien ne part ; « à déposer » dit la page officielle et le dossier', async () => {
  const P = await page({ confirmer: false });
  await P.q('[data-f="catalogue"]')!.emettre('click'); await calme();
  await P.carte('debian').querySelector('[data-f="c-tel"]')!.emettre('click'); await calme();
  const ws = P.carte('windows-server');
  assert.match(ws.querySelector('[data-f="c-deposer"]')!.textContent, /à déposer/);
  assert.equal(ws.querySelector('[data-f="c-tel"]'), null, 'pas de bouton Télécharger');
  const lien = ws.querySelector('[data-f="c-page"]')!;
  assert.equal(lien.getAttribute('href'), 'https://www.microsoft.com/fr-fr/evalcenter'); assert.equal(lien.getAttribute('rel'), 'noopener noreferrer');
  await ws.querySelector('[data-f="c-ou"]')!.emettre('click'); await calme();
  assert.match(P.dialogues.at(-1)!, /formulaire[\s\S]*E:\/ISO[\s\S]*empreinte/);
  // « Relire les versions » : une lecture des sites officiels, rien n'est téléchargé.
  await P.q('[data-f="c-relire"]')!.emettre('click'); await calme();
  assert.ok(P.appels.some((x) => x.module === 'eitri' && x.action === 'store' && x.input.actualiser === true));
  // Seules des lectures sont parties (la bibliothèque, le catalogue, la file).
  for (const a of P.appels) assert.ok(['thjalfi.systemes', 'eitri.store', 'eitri.file'].includes(`${a.module}.${a.action}`), `${a.module}.${a.action}`);
});

test('S2 · page : la file se relit toutes les 3 s tant qu\'elle vit, plus quand l\'onglet est quitté ; logique pure', async () => {
  const P = await page({ confirmer: true, minuteurs: true });
  await P.q('[data-f="catalogue"]')!.emettre('click'); await calme();
  P.minuteurs.clear();
  await P.carte('debian').querySelector('[data-f="c-tel"]')!.emettre('click'); await calme();
  assert.equal(P.minuteurs.size, 1, 'un seul minuteur');
  const n = P.appels.length; await P.tic();
  assert.ok(P.appels.slice(n).some((x) => x.action === 'file'), 'relue');
  P.etat.enCours = undefined; await P.tic();
  assert.equal(P.minuteurs.size, 0, 'plus rien en cours : le minuteur s\'arrête');
  // Quitter le catalogue : le minuteur d'avant ne relit plus rien.
  P.etat.enCours = { source: 'debian', nom: 'Debian', version: '13.2.0', recu: 1 };
  await P.q('[data-f="c-toutes"]')!.emettre('click'); await calme();
  await P.carte('debian').querySelector('[data-f="c-tel"]')!.emettre('click'); await calme();
  await P.q('[data-f="retour"]')!.emettre('click'); await calme();
  const m = P.appels.length; await P.tic();
  assert.ok(!P.appels.slice(m).some((x) => x.module === 'eitri'), 'le catalogue quitté ne se relit plus');
  const L = P.window.OdinGeneseSystemes.logique;
  assert.deepEqual(L.versionsMontrees({ versions: [{ version: '3', defaut: true }, { version: '2', defaut: false }], enFile: ['2'] }, false).map((v: { version: string }) => v.version), ['3', '2'], 'une version en file reste montrée');
  assert.equal(L.etatCarte({ manuel: 'x' }, null, null), 'deposer');
  assert.equal(L.etatCarte({ presents: ['42-1.1'] }, { version: '42' }, null), 'biblio');
  assert.equal(L.etatCarte({ presents: ['4.2'] }, { version: '42' }, null), 'telecharger');
  assert.equal(L.avantDansFile({ enCours: { nom: 'A', version: '1' }, file: [{ source: 's', nom: 'B', version: '2' }, { source: 's', nom: 'B', version: '3' }] }, 's', '3'), 'B 2');
  assert.equal(L.avantDansFile({ enCours: { nom: 'A', version: '1' }, file: [{ source: 's', nom: 'B', version: '2' }] }, 's', '2'), 'A 1');
});
