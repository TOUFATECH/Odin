// Genèse · Suivi et fin d'un déploiement (maquette « Genèse · Systèmes », lot S7, la page) : l'onglet Installations refait.
// La page de Genèse entière est montée dans un document minimal (le même que pour les lots S5 et S6) ; les réponses du
// serveur sont fabriquées par le VRAI calcul (lotsDeDeploiement) sur des PC simulés ; le temps est piloté par l'essai pour
// l'appui long de 3 s. Aucun réseau, aucun disque, aucun PC : on vérifie ce que la page montre, et qu'elle ne demande
// « recommencer » QUE si la phrase est juste ET l'appui a duré 3 s.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as SV from '../src/valhalla/thjalfi/suivi.ts';

const X = SV as unknown as Record<string, any>;
const src = (n: string) => { try { return readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGES = ['thjalfi-cle-composer.js', 'thjalfi-cle-etapes.js', 'thjalfi-cle-logiciels.js', 'thjalfi-cle-suivi.js', 'thjalfi-cle-systemes.js', 'thjalfi-cle.js', 'thjalfi-deployer.js', 'thjalfi-logiciels.js', 'thjalfi-suivi.js', 'thjalfi-systemes.js', 'thjalfi.js'];
const ici = <V>(x: V): V => JSON.parse(JSON.stringify(x));

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
  set id(v: string) { this.attrs.id = String(v); }
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

// ------------------------------------------------------------------ ce que le serveur répondrait (fabriqué par le vrai calcul)
const NOW = Date.now(), MIN = 60_000;
const A = '52:54:00:3a:91:0c', B = '52:54:00:7e:12:a4', C = '52:54:00:c1:5b:77';
const PIEGE = '<img src=x onerror=alert(1)>';
const aut = (id: string, mac: string, nom: string, o: Record<string, unknown> = {}) => ({ id, lot: 'l1', mac, iso: 'ubuntu', isoNom: 'Ubuntu 24.04.1 LTS', facon: 'auto', nom, cree: NOW - 30 * MIN, expire: NOW + 90 * MIN, ...o });
const etapes = (l: string[], t0: number) => l.map((step, k) => ({ at: t0 + k * MIN, step, ...(step === 'installation' ? { detail: 'fichier de réponses lu (user-data)' } : {}) }));
/** En cours : A s'installe (disque déjà écrit), B attend son démarrage, C reçoit le système. */
const EN_COURS = () => X.lotsDeDeploiement([
  aut('a1', A, 'pc-01', { consommee: { at: NOW - 20 * MIN, mac: A, token: 'TA' } }),
  aut('b1', B, 'pc-02'),
  aut('c1', C, 'pc-03', { consommee: { at: NOW - 6 * MIN, mac: C, token: 'TC' } }),
], { now: NOW, hist: [], live: {
  [A]: { mac: A, token: 'TA', step: 'installation', steps: etapes(['menu', 'chargement', 'installation'], NOW - 20 * MIN), started: NOW - 20 * MIN, updated: NOW - MIN, mode: 'auto', host: PIEGE },
  [C]: { mac: C, token: 'TC', step: 'chargement', steps: etapes(['menu', 'chargement'], NOW - 6 * MIN), started: NOW - 6 * MIN, updated: NOW - MIN, mode: 'auto', octets: 2 * 1024 ** 3, taille: 5 * 1024 ** 3 },
} });
/** Fini : A prêt, B annulé avant d'avoir démarré, C abandonné (Recommencer). */
const FINI = () => X.lotsDeDeploiement([
  aut('a1', A, 'pc-01', { consommee: { at: NOW - 50 * MIN, mac: A, token: 'TA' } }),
  aut('b1', B, 'pc-02', { annulee: { at: NOW - 40 * MIN, raison: 'annulée depuis le suivi du déploiement' } }),
  aut('c1', C, 'pc-03', { consommee: { at: NOW - 50 * MIN, mac: C, token: 'TC' } }),
], { now: NOW, live: {}, hist: [
  { at: NOW - 10 * MIN, mac: A, host: 'pc-01', ip: '192.168.1.41', iso: 'ubuntu', isoName: 'Ubuntu', ms: 40 * MIN, result: 'fini', debut: NOW - 50 * MIN, jeton: X.empreinteJeton('TA'), etapes: [{ at: NOW - 50 * MIN, etape: 'menu' }, { at: NOW - 30 * MIN, etape: 'installation' }, { at: NOW - 10 * MIN, etape: 'fini' }], logiciels: [{ nom: 'firefox', ok: true }, { nom: 'vlc', ok: true }] },
  { at: NOW - 5 * MIN, mac: C, iso: 'ubuntu', isoName: 'Ubuntu', ms: 45 * MIN, result: 'sans nouvelles', debut: NOW - 50 * MIN, jeton: X.empreinteJeton('TC'), raison: 'plus de signe de vie depuis 30 min (dernière étape : installation)', etapes: [{ at: NOW - 50 * MIN, etape: 'menu' }, { at: NOW - 35 * MIN, etape: 'installation' }] },
] });

async function page(o: { lots?: () => unknown[]; refuse?: boolean; recommencer?: (i: Record<string, any>) => unknown } = {}) {
  racine = new Noeud('html');
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = {
    head: tete, body: corps, documentElement: racine, hidden: false, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
  };
  const appels: Array<{ action: string; input: Record<string, any>; confirm: boolean }> = [];
  const repondre = (action: string, input: Record<string, any>): unknown => {
    if (action === 'deploiement_suivi') return o.refuse ? { ok: false, text: 'Réservé au propriétaire.' } : { ok: true, text: 'x', data: { maintenant: NOW, suspendu: null, etapes: [], lots: (o.lots ?? EN_COURS)() } };
    if (action === 'suivi') return { ok: true, text: 'x', data: { postes: [{ mac: A, nom: 'pc-01', etat: 'en cours', enCours: true, lancee: true, pct: 50, etape: 'installation', etapes: [], debut: NOW, maj: NOW }], chiffres: { enCours: 1, reussies: 0, rates: 0, bloques: 0 }, protection: {}, bloques: [] } };
    if (action === 'deploiement_annuler') return { ok: true, text: '✋ arrêté' };
    if (action === 'recommencer') return o.recommencer ? o.recommencer(input) : { ok: true, text: 'Autorisé.' };
    if (action === 'tableau') return { ok: true, data: {} };
    return { ok: false, text: 'refusé par l\'essai' };
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); if (b.module === 'thjalfi') appels.push({ action: b.action, input: b.input, confirm: b.confirm === true }); return { json: async () => ici(b.module === 'thjalfi' ? repondre(b.action, b.input) : { ok: false }) }; };
  const dialogues: string[] = [];
  const window: Record<string, any> = { OdinDialog: { confirm: async (t: string) => { dialogues.push(t); return false; }, alert: async () => {}, prompt: async () => null } };
  let maintenant = Date.now();
  class FDate extends Date { constructor(...a: unknown[]) { if (a.length) super(...(a as [])); else super(maintenant); } static now() { return maintenant; } }
  const intervalles = new Map<number, () => unknown>(); let ni = 0;
  const ctx = { window, document, location: { hash: '' }, Node: Noeud, Intl, Date: FDate, setInterval: (f: () => unknown) => { intervalles.set(++ni, f); return ni; }, clearInterval: (i: number) => { intervalles.delete(i); }, setTimeout: () => 0, clearTimeout: () => {}, fetch, createImageBitmap: undefined };
  for (const js of PAGES.map(src)) if (js) vm.runInNewContext(js, ctx);
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.thjalfi({ host, generic: [] });
  await calme();
  const q = (s: string) => corps.querySelector(s), qa = (s: string) => corps.querySelectorAll(s);
  const onglet = async (t: string) => { const n = qa('[role="tab"]').find((b) => b.textContent === t); assert.ok(n, `onglet ${t}`); await n!.emettre('click'); await calme(); };
  const clic = async (s: string) => { const n = q(s); assert.ok(n, `élément ${s}`); await n!.emettre('click'); await calme(); };
  const tenir = async (ms: number) => { for (let k = 0; k < ms; k += 50) { maintenant += 50; for (const f of [...intervalles.values()]) await f(); } await calme(); };
  return { corps, q, qa, onglet, clic, appels, dialogues, tenir };
}

test('S7 · page : le déploiement en cours, PC par PC, six étapes nommées, la ligne du moment, en direct', async () => {
  const P = await page(); await P.onglet('Installations');
  const t = P.corps.textContent;
  assert.match(t, /Ubuntu 24\.04\.1 LTS sur 3 PC/); assert.match(t, /en direct/); assert.match(t, /Tu peux fermer la page/);
  const pcs = P.qa('[data-pc]'); assert.equal(pcs.length, 3);
  for (const n of pcs) assert.deepEqual(n.querySelectorAll('.tjd-segs li').map((li) => li.querySelector('span')!.textContent), ['Réseau', 'Chargeur', 'Système', 'Installation', 'Logiciels', 'Fini']);
  const a = P.q('[data-pc="a1"]')!, b = P.q('[data-pc="b1"]')!, c = P.q('[data-pc="c1"]')!;
  assert.equal(a.querySelector('[aria-current="step"]')!.querySelector('span')!.textContent, 'Installation');
  assert.equal(c.querySelector('[aria-current="step"]')!.querySelector('span')!.textContent, 'Système');
  assert.match(c.textContent, /Système envoyé · 2,0 Go sur 5,0 Go/);
  assert.equal(b.querySelector('[aria-current="step"]'), null, 'B n\'a pas démarré'); assert.match(b.textContent, /allume-le/); assert.match(b.textContent, /en attente/);
  assert.match(t, /1 en attente/);
  // Les PC du déploiement ne sont pas répétés dans « Autres postes ».
  assert.match(t, /Autres postes du démarrage réseau/); assert.match(t, /Aucune autre installation en cours/);
  assert.equal(P.appels.filter((x) => x.action === 'recommencer' || x.action === 'deploiement_annuler').length, 0, 'lire ne déclenche rien');
  for (const n of [racine, ...racine.tous()]) assert.ok(!n.html.includes('onerror'), 'aucun texte du PC n\'est lu comme du code');
});

test('S7 · page : « Annuler » dit si le disque a déjà été touché ; « Continuer » ne fait rien ; « Arrêter » demande au serveur', async () => {
  const P = await page(); await P.onglet('Installations');
  await P.clic('[data-f="annuler-a1"]');
  let g = P.q('[data-pc="a1"] .tjd-garde')!; assert.ok(g, 'le garde-fou dans la page'); assert.match(g.textContent, /déjà effacé/); assert.ok(!g.classList.contains('calme'), 'rouge : le disque est touché');
  await P.clic('[data-f="annuler-non-a1"]');
  assert.equal(P.q('.tjd-garde'), null); assert.equal(P.appels.filter((x) => x.action === 'deploiement_annuler').length, 0, '« Continuer » : rien d\'envoyé');
  await P.clic('[data-f="annuler-b1"]');
  g = P.q('[data-pc="b1"] .tjd-garde')!; assert.match(g.textContent, /pas encore démarré : son disque n'est pas touché/); assert.ok(g.classList.contains('calme'));
  await P.clic('[data-f="annuler-c1"]');
  assert.match(P.q('[data-pc="c1"] .tjd-garde')!.textContent, /pas encore touché : il redémarrera sur son système/, 'système envoyé, réponses pas lues : disque intact');
  await P.clic('[data-f="annuler-oui-c1"]');
  const x = P.appels.filter((y) => y.action === 'deploiement_annuler');
  assert.equal(x.length, 1); assert.equal(x[0].input.autorisation, 'c1'); assert.equal(x[0].confirm, true, 'la confirmation a été donnée dans la page');
});

test('S7 · page : la fin — « 1 PC prêt sur 3 », le tableau, la raison, Recommencer seulement pour les PC pas prêts', async () => {
  const P = await page({ lots: FINI }); await P.onglet('Installations');
  const t = P.corps.textContent;
  assert.match(t, /1 PC prêt sur 3/); assert.match(t, /est installé/); assert.match(t, /mot de passe de chaque PC est dans le coffre/);
  const lignes = P.qa('.tjd-res tbody tr'); assert.equal(lignes.length, 3);
  assert.match(lignes[0].textContent, /pc-01.*prêt.*pc-01 · 192\.168\.1\.41.*2 installés/);
  assert.match(lignes[1].textContent, /pc-02.*annulée/);
  assert.match(lignes[2].textContent, /pc-03.*abandonnée.*plus de signe de vie/);
  assert.deepEqual(P.qa('button').map((b) => b.getAttribute('data-f') ?? '').filter((f) => /^recommencer-/.test(f)), ['recommencer-b1', 'recommencer-c1'], 'le PC prêt n\'a pas de « Recommencer »');
  assert.ok(t.includes('Déployer encore') && t.includes('Voir l\'historique') && t.includes('Mes systèmes'));
  await P.clic('[data-f="deroulement-a1"]');
  assert.match(P.q('.tjd-res tr.dt')!.textContent, /Installation.*Fini/, 'le déroulement nomme les étapes');
});

test('S7 · page : Recommencer — la phrase « effacer 1 pc » ET 3 s d\'appui ; l\'un sans l\'autre n\'envoie rien', async () => {
  let recu: Record<string, any> | undefined;
  const P = await page({ lots: FINI, recommencer: (i) => { recu = i; return { ok: true, text: '🛠 1 PC autorisé pour Ubuntu : pc-03.' }; } }); await P.onglet('Installations');
  await P.clic('[data-f="recommencer-c1"]');
  const dlg = racine.querySelector('#tjdRec')!; assert.ok(dlg, 'la fenêtre est posée sur la page'); assert.equal(dlg.querySelector('[role="dialog"]')!.getAttribute('aria-modal'), 'true');
  assert.match(dlg.textContent, /Recommencer sur pc-03/); assert.match(dlg.textContent, /effacer 1 pc/); assert.match(dlg.textContent, /nouvelle autorisation/);
  const bouton = dlg.querySelector('[data-f="rec-appui"]')!, champ = dlg.querySelector('[data-f="rec-phrase"]')!;
  assert.equal(bouton.disabled, true, 'sans la phrase, le bouton est éteint');
  await bouton.emettre('pointerdown'); await P.tenir(3500);
  assert.equal(P.appels.filter((x) => x.action === 'recommencer').length, 0, 'bouton éteint : rien');
  champ.value = 'effacer 2 pc'; await champ.emettre('input'); assert.equal(bouton.disabled, true, 'mauvaise phrase');
  champ.value = ' Effacer 1 PC '; await champ.emettre('input'); assert.equal(bouton.disabled, false, 'la phrase juste (majuscules et espaces ne comptent pas)');
  await bouton.emettre('pointerdown'); await P.tenir(1500); await bouton.emettre('pointerup'); await P.tenir(3000);
  assert.equal(P.appels.filter((x) => x.action === 'recommencer').length, 0, 'relâché trop tôt : rien');
  assert.match(dlg.textContent, /Relâché trop tôt/);
  await bouton.emettre('pointerdown'); await P.tenir(3100);
  const r = P.appels.filter((x) => x.action === 'recommencer');
  assert.equal(r.length, 1, 'phrase ET appui : une seule demande'); assert.equal(r[0].confirm, true);
  assert.equal(recu!.autorisation, 'c1'); assert.equal(recu!.phrase, ' Effacer 1 PC ', 'la phrase part au serveur, qui la revérifie');
  assert.match(dlg.textContent, /Autorisé/);
});

test('S7 · page : Recommencer refusé par le serveur — la raison est dite, rien n\'est autorisé', async () => {
  const P = await page({ lots: FINI, recommencer: () => ({ ok: false, text: 'Deux appareils différents ont démarré avec l\'adresse 52:54:00:c1:5b:77. Rien n\'est autorisé, rien n\'est effacé.' }) }); await P.onglet('Installations');
  await P.clic('[data-f="recommencer-c1"]');
  const dlg = racine.querySelector('#tjdRec')!, champ = dlg.querySelector('[data-f="rec-phrase"]')!, bouton = dlg.querySelector('[data-f="rec-appui"]')!;
  champ.value = 'effacer 1 pc'; await champ.emettre('input'); await bouton.emettre('pointerdown'); await P.tenir(3100);
  assert.match(dlg.textContent, /Rien n'est autorisé : Deux appareils différents/);
});

test('S7 · page : sans déploiement, Odin dort (z z z) ; refusé (pas le propriétaire) : l\'onglet reste celui d\'avant', async () => {
  let P = await page({ lots: () => [] }); await P.onglet('Installations');
  assert.match(P.corps.textContent, /Rien en cours/); assert.match(P.corps.textContent, /z z z/);
  P = await page({ refuse: true }); await P.onglet('Installations');
  assert.doesNotMatch(P.corps.textContent, /PC par PC|Rien en cours/); assert.match(P.corps.textContent, /Installations en cours/);
});

test('S7 · page (relecture) : quitter la page de Genèse ferme la fenêtre « Recommencer » ; rien n\'est envoyé', async () => {
  const P = await page({ lots: FINI }); await P.onglet('Installations');
  await P.clic('[data-f="recommencer-c1"]');
  const dlg = racine.querySelector('#tjdRec')!; assert.ok(dlg);
  const champ = dlg.querySelector('[data-f="rec-phrase"]')!; champ.value = 'effacer 1 pc'; await champ.emettre('input');
  // Une autre page d'Odin remplace celle de Genèse : la fenêtre ne reste pas posée par-dessus.
  for (const n of P.qa('.tj')) n.remove();
  await P.tenir(600);
  assert.equal(racine.querySelector('#tjdRec'), null, 'la fenêtre est fermée');
  assert.equal(P.appels.filter((x) => x.action === 'recommencer').length, 0, 'rien n\'est envoyé');
});

test('S7 · page (relecture) : un PC en attente qui a lancé un système à la main : « Annuler » ne dit pas « pas touché »', async () => {
  const lots = () => X.lotsDeDeploiement([aut('b1', B, 'pc-02')], { now: NOW, hist: [], live: {
    [B]: { mac: B, step: 'chargement', steps: etapes(['menu', 'chargement'], NOW - 10 * MIN), started: NOW - 10 * MIN, updated: NOW - MIN, mode: 'manuelle' },
  } });
  const P = await page({ lots }); await P.onglet('Installations');
  await P.clic('[data-f="annuler-b1"]');
  const g = P.q('[data-pc="b1"] .tjd-garde')!;
  assert.doesNotMatch(g.textContent, /n'est pas touché/); assert.match(g.textContent, /peut-être été écrit/); assert.ok(!g.classList.contains('calme'));
});
