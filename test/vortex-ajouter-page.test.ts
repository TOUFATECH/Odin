// Vortex · « Ajouter un appareil » et son QR code, lot R8 (la page) : les 3 étapes (nom et sorte ; accès et fin ; QR code
// ou fichier), le QR code CACHÉ puis montré sur un geste et masqué de nouveau (bouton, écran quitté, page à l'arrière-plan,
// 2 minutes), le fichier remis une fois par geste, « QR code ou fichier » depuis la carte d'un appareil avec sa
// confirmation, au clavier. La page est montée dans un document minimal et parle au VRAI Vortex et au vrai coffre
// (Valhalla, dossiers temporaires) ; le moteur du tunnel, la box, les commandes et Internet sont SIMULÉS : aucune commande,
// aucun paquet. Les fichiers de la page sont chargés dans l'ordre du serveur (ordre des noms : vortex-ajouter.js d'abord).
// Adresses d'exemple : 203.0.113.x ; maison en 10.0.0.x.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { BOX, VU, gjoll, keypair, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import { brisingamen } from '../src/valhalla/modules/brisingamen.ts';
import type { EnDirect } from '../src/valhalla/gjoll/vue.ts';
import { encode } from '../src/valhalla/qr.ts';
import { lireMatriceQr } from '../src/valhalla/qr-lecture.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { origineDemande } from '../src/valhalla/vidarr/appareils.ts';

const SOURCES = ['vortex-ajouter.js', 'vortex.js'].map((n) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8'));
const T0 = new Date(2026, 10, 24, 14, 0, 0).getTime(), MAISON = '10.0.0.50';
const ORIGINE = { ...VU }, BOITE = { ...BOX }, CLE0 = process.env.BRISINGAMEN_KEY, dossiers: string[] = [];
after(() => { Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); if (CLE0 === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = CLE0; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const SECRET = /PrivateKey|PresharedKey|\[Interface\]/, CLE = /[A-Za-z0-9+/]{43}=/;

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud;
let actif: Noeud | null = null;
const cliques: Noeud[] = [];
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; value = '';
  classList = { contains: (c: string) => this.className.split(/\s+/).includes(c) };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; }
  get id() { return this.attrs.id ?? ''; }
  get disabled() { return 'disabled' in this.attrs; }
  set innerHTML(_h: string) { throw new Error('la page ne pose jamais de HTML'); }
  set outerHTML(_h: string) { throw new Error('la page ne pose jamais de HTML'); }
  insertAdjacentHTML() { throw new Error('la page ne pose jamais de HTML'); }
  set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get hidden() { return 'hidden' in this.attrs; }
  get children() { return this.enfants.filter((x) => x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => x.textContent).join(''); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  get visible() { for (let n: Noeud | null = this; n; n = n.parent) if (n.hidden) return false; return this.isConnected; }
  private ajouter(k: Noeud | string) { const n = typeof k === 'object' ? k : new Texte(String(k)); n.parent?.retirer(n); n.parent = this; this.enfants.push(n); }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  remove() { this.parent?.retirer(this); }
  click() { cliques.push(this); }
  append(...ks: Array<Noeud | string>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string>) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.append(...ks); }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else if (k === 'value') this.value = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...plus };
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; }
  tous(): Noeud[] { return this.children.flatMap((c) => [c, ...c.tous()]); }
  querySelectorAll(s: string): Noeud[] {
    const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(s.trim()); if (!m) throw new Error(`sélecteur non prévu : ${s}`);
    return this.tous().filter((n) => (!m[1] || m[1].toUpperCase() === n.tagName) && (!m[2] || n.id === m[2]) && (!m[3] || n.classList.contains(m[3])) && (!m[4] || (m[5] === undefined ? m[4] in n.attrs : n.getAttribute(m[4]) === m[5])));
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
  /** Tout ce que le document porte : textes, attributs, valeurs des champs (pour chercher une clé qui traînerait). */
  toutEcrit(): string { return [this.texte, this.value, this.className, ...Object.entries(this.attrs).flat(), ...this.enfants.map((x) => x.toutEcrit())].join('\u0001'); }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
const calme = async () => { for (let k = 0; k < 30; k++) await new Promise((ok) => setTimeout(ok, 3)); };

/** La page de Vortex montée (les deux fichiers), reliée au vrai Vortex et au vrai coffre ; ses demandes notées. */
async function page(o: { membre?: boolean; adresse?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'vortex-r8p-')); dossiers.push(home);
  process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  const S = { now: T0, direct: new Map<string, EnDirect>(), sorties: [] as string[], commandes: [] as string[], fauxDessin: null as unknown, /** Odin ne répond plus à la relecture de la page */ muet: false, /** la réponse de « qr » attend ce signal */ retenirQr: null as Promise<void> | null };
  VU.allume = () => true; VU.direct = () => S.direct; VU.flux = () => [];
  BOX.passerelle = async () => '10.0.0.1';
  BOX.adresse = (async () => { throw new Error('pas dans cet essai'); }) as never; BOX.ouvrir = (async () => { throw new Error('pas dans cet essai'); }) as never; BOX.fermer = (async () => { throw new Error('pas dans cet essai'); }) as never;
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [gjoll, brisingamen], {
    run: async (c: string, a: string[]) => { S.commandes.push(`${c} ${a.join(' ')}`); return { code: 1, out: '', err: '' }; },
    fetch: (async (u: unknown) => { S.sorties.push(String(u)); throw new Error('aucun réseau dans les essais'); }) as never,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now),
  } as never);
  const g = v.ctx('gjoll');
  g.saveSettings({ on: false, server: { ...keypair(), net: '10.8.0', port: 51820, endpoint: o.adresse ?? '203.0.113.7', dns: '10.0.0.2', iface: 'wg-essai', lan: ['10.0.0.0/24'], nat: 'aucun' }, adresseSource: 'box' });
  const pairs = () => (g.settings.peers as Peer[] | undefined) ?? [], pair = (nom: string) => pairs().find((p) => p.name === nom)!;
  assert.equal((await v.act('gjoll', 'ajouter', { nom: 'Téléphone 1', dns_odin: false, montrer: false })).ok, true);
  if (o.membre) g.saveSettings({ peers: pairs().map((p) => ({ ...p, compte: 'nour' })) });
  const mod = v.module('gjoll')!;
  racine = new Noeud('html'); actif = null; cliques.length = 0;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const ecoutesDoc: Record<string, Array<() => unknown>> = {};
  const document = { head: tete, body: corps, hidden: false, get activeElement() { return actif; }, createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener: (t: string, f: () => unknown) => { (ecoutesDoc[t] ??= []).push(f); }, removeEventListener: (t: string, f: () => unknown) => { ecoutesDoc[t] = (ecoutesDoc[t] ?? []).filter((x) => x !== f); } };
  const appels: Array<{ url: string; action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'gjoll') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action);
    // Comme la porte web : d'où vient la demande, la règle « propriétaire seul », puis la confirmation des actions graves.
    const lancer = () => origineDemande.run(MAISON, async () => {
      const regle = a?.proprietaireSeul, seul = typeof regle === 'function' ? regle(b.input, v.ctx('gjoll')) : regle === true;
      if (o.membre && seul) return { ok: false, text: `${mod.name} · ${a?.label} : seul le propriétaire le règle lui-même.` };
      const why = a?.grave?.(b.input, v.ctx('gjoll')); if (why && !b.confirm) return { ok: false, confirm: `Confirmer : ${why} ?` };
      const r = await v.act('gjoll', b.action, b.input);
      // Un Odin qui répondrait autre chose qu'un tracé de cases (l'essai le force) : la page ne doit rien dessiner.
      return b.action === 'qr' && S.fauxDessin ? { ...r, data: { ...(r.data as object), dessin: S.fauxDessin } } : r;
    });
    return o.membre ? auNomDe(nour, lancer) : lancer();
  };
  const fetch = async (u: string, op: { body: string; method: string }) => { const b = JSON.parse(op.body); appels.push({ url: `${op.method} ${u}`, action: b.action, input: b.input, confirm: Boolean(b.confirm) }); if (S.muet && b.action === 'appareils_vus') await new Promise(() => {}); const r = await repondre(b); if (b.action === 'qr' && S.retenirQr) await S.retenirQr; return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const remis: Array<{ texte: string; type: string }> = [], liberes: string[] = [];
  class FauxBlob { texte: string; type: string; constructor(parts: string[], op: { type: string }) { this.texte = parts.join(''); this.type = op.type; } }
  const FauxURL = { createObjectURL: (b: FauxBlob) => { remis.push({ texte: b.texte, type: b.type }); return `blob:essai/${remis.length}`; }, revokeObjectURL: (u: string) => { liberes.push(u); } };
  class Horloge extends Date { constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(S.now); } static now() { return S.now; } }
  const window: Record<string, any> = {}; const rythmes: Array<() => unknown> = [];
  const ctx = { window, document, Date: Horloge, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch, URL: FauxURL, Blob: FauxBlob };
  vm.createContext(ctx); for (const s of SOURCES) vm.runInContext(s, ctx);
  // L'écran « Ajouter » tel que la page le monte (pour regarder ce qu'il garde en mémoire).
  let ecran: { etat: Record<string, unknown> } | null = null;
  const E = window.OdinVortex.ecrans.find((e: { id: string }) => e.id === 'ajouter'), dessiner = E.dessiner;
  E.dessiner = (n: unknown, quoi: unknown) => (ecran = dessiner(n, quoi));
  const host = new Noeud('div'); corps.append(host);
  await window.OdinPages.gjoll({ host, generic: [new Noeud('section')] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; assert.ok(n, `champ « ${cle} »`); n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const onglet = async (id: string) => { const n = q(`#vx-tab-${id}`); assert.ok(n, `onglet ${id}`); await n.emettre('click'); await calme(); };
  const battre = async () => { for (const r of rythmes) await r(); await calme(); };
  const ecrit = () => appels.filter((a) => a.action !== 'appareils_vus').map((a) => `${a.action}${a.confirm ? ' (accord)' : ''}`);
  const code = () => q('svg.code');
  return { v, g, S, host, Noeud, pairs, pair, appels, ecrit, corps, q, qa, f, clic, saisir, onglet, battre, rythmes, code, remis, liberes, document, ecoutesDoc, window, texte: () => corps.textContent, etat: () => ecran!.etat, focus: () => actif?.getAttribute('data-f') ?? '', fin: () => { v.stop(); Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); } };
}
/** Rien de la page (texte, attributs, champs, mémoire de l'écran) ne porte une clé. */
function sansCle(P: Awaited<ReturnType<typeof page>>, quand: string) {
  const tout = P.corps.toutEcrit() + JSON.stringify(P.etat());
  assert.doesNotMatch(tout, SECRET, quand); assert.doesNotMatch(tout, CLE, quand);
}

test('R8 · page : pur — le nom tapé, les adresses tapées, la fin choisie, le tracé d\'un QR code', async () => {
  const P = await page();
  try {
    const A = P.window.OdinVortexAjout;
    assert.deepEqual(['', '   ', 'Téléphone 3', ' PC  du bureau ', 'x'.repeat(41), '<b>', 'a/b', '...', 'Tel\nx'].map(A.nomTape), ['vide', 'vide', 'bon', 'bon', 'long', 'faux', 'faux', 'faux', 'bon']);
    assert.deepEqual(['', '10.0.0.10', '10.0.0.10, 10.0.0.16/28', '10.0.0.999', '10.0.0.0/8', 'maison', Array.from({ length: 13 }, (_x, k) => `10.0.0.${k}`).join(',')].map(A.adressesTapees), ['vide', 'bon', 'bon', 'faux', 'faux', 'faux', 'faux']);
    assert.deepEqual([A.finChoisie('jamais', '', T0), A.finChoisie('1j', '', T0), A.finChoisie('7j', '', T0), A.finChoisie('30j', '', T0), A.finChoisie('date', '2026-12-31', T0), A.finChoisie('date', '2026-11-24', T0), A.finChoisie('date', '2026-11-23', T0), A.finChoisie('date', '', T0)], ['', '2026-11-25', '2026-12-01', '2026-12-24', '2026-12-31', '2026-11-24', '?', '?']);
    assert.deepEqual([{ n: 25, d: 'M4 4h1v1h-1z' }, { n: 25, d: '' }, { n: 25, d: 'M4 4h1v1h-1z<script>' }, { n: 25, d: 'M4 4L9 9z' }, { n: 9999, d: 'M4 4h1v1h-1z' }, { n: 25.5, d: 'M4 4h1v1h-1z' }, null, { n: 25 }].map(A.dessinValide), [true, false, false, false, false, false, false, false]);
    // Les écrans dans l'ordre : Appareils, Ajouter, Tunnel, Tout (le fichier chargé en premier a bien attendu la page).
    assert.deepEqual(P.qa('[role="tab"]').map((n) => n.textContent), ['Appareils', 'Ajouter', 'Tunnel', 'Tout']);
    // La page n'utilise ni le stockage du navigateur, ni l'adresse de la page, ni du HTML reçu.
    for (const mot of ['localStorage', 'sessionStorage', 'indexedDB', 'location', 'history', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.cookie', 'console.']) assert.equal(SOURCES[0].includes(mot), false, mot);
    assert.equal(new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`).test(SOURCES.join('')), false, 'aucun séparateur de ligne Unicode dans la page');
  } finally { P.fin(); }
});

test('R8 · page : les 3 étapes — rien n\'est créé avant la confirmation ; le QR code est caché, montré sur un geste, masqué de nouveau', async () => {
  const P = await page();
  try {
    // Depuis « Appareils », le bouton mène à l'écran.
    await P.clic('ajouter');
    assert.equal(P.q('#vx-tab-ajouter')!.getAttribute('aria-selected'), 'true'); assert.equal(P.focus(), 'nom');
    assert.deepEqual(P.qa('li[aria-current="step"]').map((n) => n.textContent), ['1L\'appareilNom et sorte']);
    // Étape 1 : le nom est vérifié pendant la frappe ; « Continuer » reste grisé tant qu'il n'est pas bon.
    assert.equal(P.f('suite')!.disabled, true);
    for (const [val, dit, grise] of [['<b>Tel</b>', /Seulement des lettres/, true], ['Téléphone 1', /porte déjà ce nom/, true], ['x'.repeat(41), /40 caractères au plus/, true], ['Invité  du soir', /Ce nom est libre/, false]] as Array<[string, RegExp, boolean]>) {
      await P.saisir('nom', val); assert.match(P.q('#vxa-nom-v')!.textContent, dit); assert.equal(P.f('suite')!.disabled, grise, val);
    }
    assert.deepEqual(P.qa('[role="radio"]').map((n) => [n.getAttribute('data-f'), n.getAttribute('aria-checked')]), [['sorte:tel', 'true'], ['sorte:pc', 'false']]);
    await P.f('sorte:tel')!.emettre('keydown', { key: 'ArrowRight' }); await calme();
    assert.equal(P.f('sorte:pc')!.getAttribute('aria-checked'), 'true'); assert.equal(P.focus(), 'sorte:pc');
    await P.f('sorte:pc')!.emettre('keydown', { key: 'ArrowLeft' }); await calme();
    assert.equal(P.f('sorte:tel')!.getAttribute('aria-checked'), 'true');
    await P.clic('suite');
    // Étape 2 : trois accès ; « seulement certaines adresses » demande des adresses bien écrites ; une fin possible.
    assert.deepEqual(P.qa('[role="radio"]').map((n) => [n.getAttribute('data-f'), n.getAttribute('aria-checked')]), [['acces:internet', 'true'], ['acces:maison', 'false'], ['acces:adresses', 'false']]);
    assert.match(P.texte(), /Internet par la maisonConseillé/); assert.match(P.texte(), /Odin ne filtre pas encore ce qu'un appareil connecté peut joindre dans la maison/);
    await P.clic('acces:adresses');
    assert.equal(P.f('creer')!.disabled, true, 'aucune adresse : grisé');
    await P.saisir('adresses', '10.0.0.999'); assert.match(P.q('#vxa-adr-v')!.textContent, /Des adresses comme 10\.0\.0\.10/); assert.equal(P.f('creer')!.disabled, true);
    await P.saisir('adresses', '10.0.0.10, 10.0.0.16/28'); assert.equal(P.f('creer')!.disabled, false);
    await P.clic('fin:date'); assert.equal(P.f('creer')!.disabled, true, 'une date à choisir'); assert.equal(P.focus(), 'date');
    await P.saisir('date', '2026-11-01'); assert.match(P.q('#vxa-date-v')!.textContent, /à partir d'aujourd'hui/); assert.equal(P.f('creer')!.disabled, true);
    await P.clic('fin:7j'); assert.match(P.texte(), /Dernier jour : 01\/12\/2026\./); assert.equal(P.f('creer')!.disabled, false);
    assert.deepEqual(P.ecrit(), [], 'jusqu\'ici, rien n\'a été demandé à Odin');
    // « Créer » : Odin redemande d'abord (rien n'est créé), il nomme l'appareil et dit ce qu'il ouvre.
    await P.clic('creer');
    assert.deepEqual(P.ecrit(), ['ajouter']); assert.deepEqual(P.pairs().map((p) => p.name), ['Téléphone 1']);
    assert.match(P.q('[role="alert"]')!.textContent, /Créer « Invité du soir » \?Ce qu'Odin va faireOuvrir l'accès VPN à « Invité du soir » \(seulement ces adresses de la maison : 10\.0\.0\.10, 10\.0\.0\.16\/28, jusqu'au 2026-12-01\)\./);
    assert.equal(P.focus(), 'q-non');
    await P.q('[role="alert"]')!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.q('[role="alert"]'), null); assert.deepEqual(P.pairs().map((p) => p.name), ['Téléphone 1'], 'Échap : rien n\'est créé');
    await P.clic('creer'); await P.clic('q-ok');
    assert.deepEqual(P.ecrit(), ['ajouter', 'ajouter', 'ajouter (accord)']);
    assert.deepEqual(P.appels.at(-2)!.input, { nom: 'Invité du soir', acces: 'adresses', adresses: '10.0.0.10, 10.0.0.16/28', fin: '2026-12-01', montrer: false });
    const p = P.pair('Invité du soir'); assert.deepEqual([p.full, p.seules, p.expires, p.priv], [false, ['10.0.0.10/32', '10.0.0.16/28'], '2026-12-01', undefined]);
    // Étape 3 : le QR code est CACHÉ, et il n'est même pas dans la page.
    assert.deepEqual(P.qa('li[aria-current="step"]').map((n) => n.textContent), ['3Le QR codeÀ scanner ou à ouvrir']);
    assert.match(P.texte(), /« Invité du soir » · adresse 10\.8\.0\.3 · seulement certaines adresses · fin : 01\/12\/2026/);
    assert.match(P.texte(), /QR code caché/); assert.match(P.texte(), /Odin le garde chiffré dans le coffre/); assert.match(P.texte(), /En attente de la première connexion de « Invité du soir »…/);
    assert.equal(P.code(), null); assert.equal(P.focus(), 'montrer'); sansCle(P, 'étape 3, QR caché');
    // Le geste : « Montrer le QR code ». Odin relit le coffre ; la page dessine des cases, noir sur blanc, avec la marge.
    await P.clic('montrer');
    assert.deepEqual(P.ecrit().slice(-1), ['qr (accord)']); assert.deepEqual(P.appels.at(-1)!.input, { nom: 'Invité du soir' });
    const svg = P.code()!; assert.ok(svg, 'le QR code est montré');
    const [fond, cases] = svg.children;
    assert.deepEqual([fond.tagName, fond.attrs.fill, cases.tagName, cases.attrs.fill, svg.attrs.role], ['RECT', '#fff', 'PATH', '#000', 'img']);
    assert.match(svg.attrs['aria-label'], /QR code de « Invité du soir »/); assert.match(cases.attrs.d, /^(M\d+ \d+h1v1h-1z)+$/);
    // Ce tracé est bien la configuration de l'appareil : relu case par case par le lecteur d'Odin (marge de 4 cases comprise).
    const n = Number(svg.attrs.viewBox.split(' ')[2]), grille = Array.from({ length: n - 8 }, () => new Array<boolean>(n - 8).fill(false));
    for (const m of cases.attrs.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) { const x = Number(m[1]), y = Number(m[2]); assert.ok(x >= 4 && y >= 4 && x < n - 4 && y < n - 4, 'marge blanche respectée'); grille[y - 4][x - 4] = true; }
    const lu = lireMatriceQr(grille); assert.equal(lu.lu, true);
    if (lu.lu) { assert.match(lu.texte, /^\[Interface\]\nPrivateKey = .+\nAddress = 10\.8\.0\.3\/32\n/); assert.match(lu.texte, /Endpoint = 203\.0\.113\.7:51820\nAllowedIPs = 10\.8\.0\.1\/32, 10\.0\.0\.10\/32, 10\.0\.0\.16\/28\n/); assert.deepEqual(encode(lu.texte, 'L'), grille); }
    assert.doesNotMatch(P.corps.toutEcrit(), SECRET, 'la configuration en texte n\'est nulle part dans la page'); assert.equal(P.focus(), 'masquer');
    // Masqué de nouveau : le bouton…
    await P.clic('masquer'); assert.equal(P.code(), null); assert.match(P.texte(), /QR code masqué\./); sansCle(P, 'après « Masquer »'); assert.equal(P.focus(), 'montrer');
    // … la page à l'arrière-plan…
    await P.clic('montrer'); assert.ok(P.code());
    P.document.hidden = true; for (const g of P.ecoutesDoc.visibilitychange ?? []) g(); await calme();
    assert.equal(P.code(), null, 'page à l\'arrière-plan : masqué'); sansCle(P, 'arrière-plan'); P.document.hidden = false;
    // … 2 minutes…
    await P.clic('montrer'); assert.ok(P.code()); P.S.now += 119_000; await P.battre(); assert.ok(P.code(), 'encore là avant 2 minutes');
    P.S.now += 2000; await P.battre(); assert.equal(P.code(), null, '2 minutes : masqué'); sansCle(P, '2 minutes');
    // … et en quittant l'écran.
    await P.clic('montrer'); assert.ok(P.code()); const avant = P.etat();
    await P.onglet('tunnel');
    assert.equal(P.code(), null); assert.equal(avant.dessin, null, 'l\'écran quitté ne garde pas le tracé'); assert.doesNotMatch(P.corps.toutEcrit() + JSON.stringify(avant), SECRET);
    assert.deepEqual(P.ecoutesDoc.visibilitychange, [], 'plus rien n\'écoute après l\'écran');
    // Chaque geste est noté « qui a fait quoi » : l'ajout, et chaque fois que le QR code a été montré.
    const j = (await P.v.act('gjoll', 'qui_a_fait', {})).data as { actes: Array<{ action: string; quoi: string; ok: boolean }> };
    assert.equal(j.actes.filter((x) => x.action === 'QR code' && x.quoi === 'nom : Invité du soir' && x.ok).length, 4);
    assert.doesNotMatch(JSON.stringify(j), SECRET);
    // Toutes les demandes sont parties en POST vers la porte des actions : rien dans une adresse.
    assert.deepEqual([...new Set(P.appels.map((a) => a.url))], ['POST /api/valhalla/act']);
    assert.deepEqual([P.S.sorties, P.S.commandes.filter((c) => !/^(ip route|sh -c command -v)/.test(c))], [[], []]);
  } finally { P.fin(); }
});

test('R8 · page : la première connexion se voit ; un ordinateur reçoit un fichier, remis une fois par geste et jamais gardé', async () => {
  const P = await page();
  try {
    await P.onglet('ajouter'); await P.saisir('nom', 'PC du bureau'); await P.clic('sorte:pc'); await P.clic('suite');
    await P.clic('acces:maison'); await P.clic('creer'); await P.clic('q-ok');
    assert.deepEqual(P.appels.filter((a) => a.action === 'ajouter').at(-1)!.input, { nom: 'PC du bureau', acces: 'maison', fin: '', montrer: false });
    assert.deepEqual(P.qa('li[aria-current="step"]').map((n) => n.textContent), ['3Le fichierÀ scanner ou à ouvrir']);
    assert.match(P.texte(), /Ouvre ce fichier sur l'ordinateur/); assert.match(P.texte(), /« PC du bureau » · adresse 10\.8\.0\.3 · la maison seulement · fin : jamais/);
    assert.equal(P.f('montrer'), null, 'pas de QR code pour un ordinateur'); assert.equal(P.focus(), 'fichier'); sansCle(P, 'étape 3, fichier');
    // « Télécharger » : demandé à Odin à chaque geste, remis une fois, libéré, jamais gardé par la page.
    await P.clic('fichier');
    assert.deepEqual(P.ecrit().slice(-1), ['telecharger (accord)']);
    assert.equal(P.remis.length, 1); assert.match(P.remis[0].texte, /^\[Interface\]\nPrivateKey = .+\nAddress = 10\.8\.0\.3\/32\n/); assert.match(P.remis[0].texte, /AllowedIPs = 10\.8\.0\.0\/24, 10\.0\.0\.0\/24\n/);
    assert.equal(P.remis[0].type, 'application/octet-stream');
    assert.deepEqual(cliques.map((a) => [a.tagName, a.attrs.download, a.attrs.href, a.isConnected]), [['A', 'maison-PC-du-bureau.conf', 'blob:essai/1', false]]);
    assert.deepEqual(P.liberes, ['blob:essai/1']); assert.match(P.texte(), /Fichier « maison-PC-du-bureau\.conf » remis\. La page ne le garde pas/);
    sansCle(P, 'après le téléchargement');
    await P.clic('fichier');
    assert.equal(P.remis.length, 2, 'un second geste : une seconde demande'); assert.deepEqual(P.ecrit().slice(-2), ['telecharger (accord)', 'telecharger (accord)']);
    // La première connexion : le moteur la voit, la page le dit au passage suivant.
    P.S.direct.set(P.pair('PC du bureau').pub, { handshake: P.S.now - 5000, rx: 1, tx: 1, endpoint: '198.51.100.23:40123' });
    await P.battre();
    assert.match(P.texte(), /« PC du bureau » est connecté\./);
    // « Plutôt le QR code » : possible, toujours caché d'abord.
    await P.clic('plutot'); assert.ok(P.f('montrer')); assert.equal(P.code(), null);
    await P.clic('termine');
    assert.equal(P.q('#vx-tab-appareils')!.getAttribute('aria-selected'), 'true'); sansCle(P, 'terminé');
  } finally { P.fin(); }
});

test('R8 · page : « QR code ou fichier » sur la carte d\'un appareil — la page fait confirmer avant de demander, puis montre', async () => {
  const P = await page();
  try {
    const ip = P.pair('Téléphone 1').ip;
    assert.ok(P.f(`qr:${ip}`), 'le bouton est sur la carte'); assert.equal(P.f(`qr:${ip}`)!.getAttribute('aria-label'), 'QR code ou fichier : Téléphone 1');
    await P.clic(`qr:${ip}`);
    // La question nomme l'appareil ; rien n'a encore été demandé à Odin.
    assert.match(P.q('[role="alert"]')!.textContent, /Montrer la configuration de « Téléphone 1 » \?Elle contient la clé secrète de cet appareil : ne la montre qu'à lui\. Odin la relit dans le coffre, et note ce geste/);
    assert.deepEqual(P.ecrit(), []); assert.equal(P.code(), null); assert.equal(P.focus(), 'q-non');
    // « Annuler » (ou Échap) : retour aux appareils, toujours rien de demandé.
    await P.q('[role="alert"]')!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.q('#vx-tab-appareils')!.getAttribute('aria-selected'), 'true'); assert.deepEqual(P.ecrit(), []);
    // Confirmé : le QR code.
    await P.clic(`qr:${ip}`); await P.clic('montrer');
    assert.deepEqual(P.ecrit(), ['qr (accord)']); assert.deepEqual(P.appels.at(-1)!.input, { nom: 'Téléphone 1' });
    assert.ok(P.code()); assert.match(P.code()!.attrs['aria-label'], /« Téléphone 1 »/); assert.doesNotMatch(P.corps.toutEcrit(), SECRET);
    // Un appareil coupé : son QR code se montre, avec l'avertissement d'Odin.
    await P.clic('masquer'); await P.v.act('gjoll', 'activer', { nom: 'Téléphone 1', actif: false });
    await P.clic('montrer'); assert.ok(P.code()); assert.match(P.texte(), /⚠ Son accès est coupé/);
    // Un Odin qui répondrait autre chose qu'un tracé de cases : rien n'est dessiné.
    await P.clic('masquer'); P.S.fauxDessin = { n: 33, d: 'M4 4h1v1h-1z"/><script>alert(1)</script>' };
    await P.clic('montrer'); assert.equal(P.code(), null); assert.match(P.texte(), /sans QR code lisible\. Rien n'est montré\./); assert.equal(P.qa('script').length, 0);
    P.S.fauxDessin = null;
    // Le coffre se ferme : Odin le dit, la page le répète, rien n'est montré.
    delete process.env.BRISINGAMEN_KEY;
    await P.clic('montrer'); assert.equal(P.code(), null); assert.match(P.texte(), /Le coffre est fermé : la configuration de « Téléphone 1 » y est gardée chiffrée/);
    process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
    // L'appareil retiré entre-temps : l'écran le dit.
    await P.v.act('gjoll', 'revoquer', { nom: 'Téléphone 1', le_mien: true });
    await P.battre(); assert.match(P.texte(), /Cet appareil n'est plus dans le VPN\./); assert.equal(P.code(), null);
  } finally { P.fin(); process.env.BRISINGAMEN_KEY = 'cd'.repeat(32); }
});

test('R8 · page : l\'adresse de la maison pas encore connue — l\'appareil est créé, aucun QR code, et la page mène à « Tunnel »', async () => {
  const P = await page({ adresse: '[ADRESSE PUBLIQUE OU DOMAINE]' });
  try {
    await P.onglet('ajouter'); await P.saisir('nom', 'Téléphone 3'); await P.clic('suite'); await P.clic('creer'); await P.clic('q-ok');
    assert.match(P.texte(), /L'adresse de la maison n'est pas encore connue : sans elle, pas de QR code ni de fichier/);
    await P.clic('montrer');
    assert.equal(P.code(), null); assert.match(P.texte(), /Fais d'abord l'étape « Adresse de la maison »/); assert.equal(P.focus(), 'tunnel');
    await P.clic('tunnel'); assert.equal(P.q('#vx-tab-tunnel')!.getAttribute('aria-selected'), 'true');
  } finally { P.fin(); }
});

test('R8 · page : un membre de la famille ne voit ni l\'ajout, ni le QR code, ni le fichier', async () => {
  const P = await page({ membre: true });
  try {
    assert.equal(P.qa('[data-f]').some((n) => String(n.getAttribute('data-f')).startsWith('qr:')), false, 'pas de bouton « QR code ou fichier » sur ses cartes');
    await P.onglet('ajouter');
    assert.match(P.texte(), /Réservé au propriétaireAjouter un appareil au VPN, montrer son QR code ou son fichier : le propriétaire seul\./);
    assert.deepEqual(P.qa('input'), []); assert.equal(P.f('montrer'), null); assert.equal(P.f('creer'), null);
    // Même en forçant l'écran d'un appareil : Odin refuse, rien n'est montré.
    await P.window.OdinVortex.aller('ajouter', { remontrer: 'Téléphone 1' }); await calme();
    assert.equal(P.f('montrer'), null); assert.equal(P.code(), null); assert.deepEqual(P.ecrit(), []);
    assert.doesNotMatch(P.corps.toutEcrit(), SECRET);
  } finally { P.fin(); }
});

test("R8 · page : Vortex quitté ou remonté pendant qu'un QR code est montré — il est oublié, plus rien n'écoute", async () => {
  const P = await page();
  try {
    const ip = P.pair('Téléphone 1').ip;
    // La page entière est retirée (on passe à une autre appli) : au battement suivant, l'écran a tout oublié.
    await P.clic(`qr:${ip}`); await P.clic('montrer'); assert.ok(P.code());
    const e1 = P.etat(); assert.ok(e1.dessin);
    P.host.remove(); await P.battre();
    assert.equal(e1.dessin, null); assert.deepEqual(P.ecoutesDoc.visibilitychange, []);
    // La page est montée de nouveau pendant qu'un QR code est montré : l'écran d'avant l'oublie aussi.
    const h2 = new P.Noeud('div'); P.corps.append(h2);
    await P.window.OdinPages.gjoll({ host: h2, generic: [] }); await calme();
    await P.clic(`qr:${ip}`); await P.clic('montrer'); assert.ok(P.code());
    const e2 = P.etat(); assert.ok(e2.dessin);
    const h3 = new P.Noeud('div'); P.corps.append(h3);
    await P.window.OdinPages.gjoll({ host: h3, generic: [] }); await calme();
    assert.equal(e2.dessin, null, "l'écran d'avant a oublié le tracé");
    assert.doesNotMatch(JSON.stringify(e1) + JSON.stringify(e2), SECRET);
  } finally { P.fin(); }
});

// ------------------------------------------------------------------ relecture du lot R8
test('R8 · page (relecture) : Odin ne répond plus — le QR code est quand même masqué au bout de 2 minutes, et le focus revient sur « Montrer »', async () => {
  const P = await page();
  try {
    const ip = P.pair('Téléphone 1').ip;
    await P.clic(`qr:${ip}`); await P.clic('montrer'); assert.ok(P.code(), 'le QR code est montré'); assert.equal(P.focus(), 'masquer');
    // Odin se tait (coupé, réseau perdu) : la relecture de la page ne revient jamais.
    P.S.muet = true; P.S.now += 121_000;
    for (const r of P.rythmes) void r();
    await calme();
    assert.equal(P.code(), null, 'masqué sans attendre la réponse d\'Odin'); assert.equal(P.etat().dessin, null); sansCle(P, 'Odin muet');
    assert.match(P.texte(), /QR code masqué\./); assert.equal(P.focus(), 'montrer', 'le focus ne se perd pas');
  } finally { P.fin(); }
});

test('R8 · page (relecture) : l\'écran est quitté pendant qu\'Odin répond — la réponse (elle porte la clé) est jetée, rien n\'est gardé', async () => {
  const P = await page();
  try {
    const ip = P.pair('Téléphone 1').ip;
    let lacher: () => void = () => {}; P.S.retenirQr = new Promise<void>((ok) => { lacher = ok; });
    await P.clic(`qr:${ip}`);
    const bouton = P.f('montrer')!; void bouton.emettre('click'); await calme();
    const e = P.etat();
    await P.onglet('tunnel');
    lacher(); await calme();
    assert.equal(e.dessin, null, 'le tracé arrivé trop tard n\'est pas gardé'); assert.equal(P.code(), null);
    assert.doesNotMatch(P.corps.toutEcrit() + JSON.stringify(e), SECRET);
  } finally { P.fin(); }
});

test('R8 · page (relecture) : un nom d\'appareil dans une écriture à signes (thaï, hindi, arabe) est accepté ; un caractère caché ne l\'est pas', async () => {
  const P = await page();
  try {
    const A = P.window.OdinVortexAjout;
    assert.deepEqual(['โทรศัพท์ 1', 'फ़ोन 2', 'هاتف ٣', 'Tel​', 'Tel‮', '́x'].map(A.nomTape), ['bon', 'bon', 'bon', 'faux', 'faux', 'faux']);
  } finally { P.fin(); }
});
