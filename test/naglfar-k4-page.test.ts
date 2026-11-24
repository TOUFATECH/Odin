// Arche, lot K4 (la page) : le catalogue. « Ajouter depuis le catalogue » sur le tableau ouvre l'onglet Catalogue
// (catégories, recherche, une carte par appli : ce qu'elle fait, sa mémoire, « version épinglée », « déjà
// installée » ; « Détails » : images et étiquettes, ports libres, volumes, mémoire, « Alternative à »). « Déployer »
// envoie l'appli, son nom de pile et les ports montés à l'écran (la confirmation d'Odin redit images, ports, volumes) ;
// un déploiement en cours se lit sur la carte. Dessinés par src/web/pages/naglfar.js dans un document minimal ; les
// lectures passent par les VRAIES actions d'Arche, sur le vrai moteur rangé dans un dossier jetable (aucun conteneur
// lancé, aucune commande, aucun téléchargement) ; un geste est seulement noté, pas lancé.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import type { Valhalla as TValhalla } from '../src/valhalla/service.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';
import { CATALOGUE } from '../src/valhalla/hringhorni/catalogue.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k4p-baux-');
const SOURCE = readFileSync(new URL('../src/web/pages/naglfar.js', import.meta.url), 'utf8');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let S: typeof import('../src/valhalla/service.ts');
let M: typeof import('../src/valhalla/odin.ts');
let C: typeof import('../src/config.ts');
let origine: Record<string, unknown> = {};
before(async () => {
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts');
  S = await import('../src/valhalla/service.ts'); M = await import('../src/valhalla/odin.ts'); C = await import('../src/config.ts');
  origine = { ...A.systemeArche };
});
after(() => { Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ un document minimal (comme les essais des pages K1 et K2)
class N {
  tagName: string; children: N[] = []; parent?: N; attrs: Record<string, string> = {}; listeners: Record<string, Array<(e: unknown) => void>> = {};
  text = ''; value = ''; disabled = false; scrollTop = 0; scrollHeight = 0; style = { cssText: '' }; root = false; innerHTML = '';
  constructor(tag: string, text?: string) { this.tagName = tag.toUpperCase(); if (text !== undefined) this.text = text; }
  get className() { return this.attrs.class ?? ''; } set className(v: string) { this.attrs.class = v; }
  get classList() { const self = this; return { toggle: (c: string, on?: boolean) => { const l = new Set(self.className.split(/\s+/).filter(Boolean)); if (on ?? !l.has(c)) l.add(c); else l.delete(c); self.className = [...l].join(' '); }, add: (c: string) => { self.className = `${self.className} ${c}`.trim(); } }; }
  get id() { return this.attrs.id ?? ''; }
  get isConnected(): boolean { let n: N | undefined = this; while (n) { if (n.root) return true; n = n.parent; } return false; }
  get lastChild() { return this.children.at(-1); }
  get textContent(): string { return this.tagName === '#TEXT' ? this.text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.children = [new N('#text', v)]; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(k: string, f: (e: unknown) => void) { (this.listeners[k] ??= []).push(f); }
  append(...k: Array<N | string>) { for (const c of k) { const n = typeof c === 'string' ? new N('#text', c) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k: N[]) { this.children = []; this.append(...k); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  focus() {} click() { for (const f of this.listeners.click ?? []) f({ currentTarget: this, target: this, preventDefault() {} }); }
  fire(k: string, e: Record<string, unknown> = {}) { for (const f of this.listeners[k] ?? []) f({ currentTarget: this, target: this, preventDefault() {}, ...e }); }
  querySelector() { return null; } querySelectorAll() { return []; }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
function documentMinimal() {
  const head = new N('head'), body = new N('body'); head.root = true; body.root = true;
  const document = {
    head, body, visibilityState: 'visible', activeElement: null,
    createElement: (t: string) => new N(t), createTextNode: (t: string) => new N('#text', t), createElementNS: (_n: string, t: string) => new N(t),
    getElementById: (id: string) => [...head.all(), ...body.all()].find((n) => n.id === id) ?? null,
    querySelector: () => null,
  };
  return { document, body };
}
const trouver = (racine: N, f: (n: N) => boolean) => racine.all().filter(f);
const boutons = (racine: N, texte: RegExp) => trouver(racine, (n) => n.tagName === 'BUTTON' && texte.test(n.textContent));
const attendre = () => new Promise((ok) => setTimeout(ok, 20));
const onglets = (host: N) => trouver(host, (n) => n.getAttribute('role') === 'tab' && /^ark-v-/.test(n.id));
const cartes = (host: N) => trouver(host, (n) => n.tagName === 'DIV' && /(^| )ark-app( |$)/.test(n.className));
const titre = (c: N) => trouver(c, (n) => n.tagName === 'B')[0].textContent;

// ------------------------------------------------------------------ un Odin d'essai (moteur jetable, aucun conteneur lancé)
function odin(plateforme = 'linux') {
  const home = neuf('arche-k4p-'), dir = neuf('arche-k4p-moteur-');
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
  }
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never });
  const img = (n: string, id: string): Image => ({ id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/a'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() });
  e.store.saveImages([img('neosmemo/memos:0.22.5', 'a'.repeat(64))]);
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison'), disque: () => ({ libre: 80 * 1024 ** 3, total: 200 * 1024 ** 3 }) });
  const v = new S.Valhalla(home, M.allModules({ paths: { home, workspace: home }, cfg: C.DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  return { v, e };
}
function charger(v: TValhalla) {
  const { document, body } = documentMinimal(), gestes: Array<{ action: string; input: Record<string, unknown> }> = [];
  const lectures = ['services', 'tableau', 'fiche', 'journal_direct', 'volumes', 'reseaux', 'piles', 'fichier_pile', 'verifier_pile', 'catalogue'];
  const fetch = async (_u: string, o: { body: string }) => {
    const b = JSON.parse(o.body) as { module: string; action: string; input: Record<string, unknown> };
    const a = v.action(b.module, b.action)?.a;
    if (!a?.read && !lectures.includes(b.action)) { gestes.push({ action: b.action, input: b.input }); return { json: async () => ({ ok: true, text: 'noté' }) }; }
    const r = await v.act(b.module, b.action, b.input); return { json: async () => r };
  };
  const window: Record<string, unknown> = { OdinPages: {}, OdinDialog: { confirm: async () => true } };
  const ctx = vm.createContext({ window, document, fetch, Node: N, location: { hostname: 'odin.maison' }, setTimeout: (f: () => void, ms: number) => (ms >= 1000 ? 0 : setTimeout(f, ms)), clearTimeout, URL, Blob, console });
  vm.runInContext(SOURCE, ctx);
  const page = (window.OdinPages as Record<string, (o: unknown) => Promise<boolean>>).naglfar;
  const Q = window.OdinArche as { MOTS: Record<string, string>; logique: Record<string, (...a: unknown[]) => unknown>; etat: Record<string, unknown> };
  const dessiner = async () => { const host = new N('div'); body.append(host); const fait = await page({ host, generic: [], reload: () => {}, info: { name: 'Arche' } }); await attendre(); return { host, fait }; };
  return { dessiner, Q, gestes };
}

test('les mots de K4 : dans MOTS, en français simple, sans nom de produit', async () => {
  const { v } = odin();
  try {
    const { Q } = charger(v);
    for (const k of ['v.catalogue', 'l.catalogue', 'ca.titre', 'ca.lead', 'ca.deployer', 'ca.copie', 'ca.details', 'ca.images', 'ca.ports', 'ca.volumes', 'ca.memoire', 'ca.alternative', 'ca.note', 'pc.k4']) assert.ok(Q.MOTS[k], k);
    const produits = [...new Set(CATALOGUE.flatMap((e) => e.alternativeA))];
    for (const [k, t] of Object.entries(Q.MOTS)) {
      assert.doesNotMatch(t, /docker|podman|portainer|kubernetes|compose\b/i, k);
      for (const p of produits) assert.ok(!t.toLowerCase().includes(p.toLowerCase()), `${k} : ${p}`);
    }
  } finally { v.stop(); }
});

test('onglets : « Catalogue » s\'ouvre depuis « Ajouter depuis le catalogue » ; les autres onglets restent dans leur ordre', async () => {
  const { v } = odin();
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'tableau', fiche: '' });
    let { host } = await dessiner();
    assert.deepEqual(onglets(host).map((t) => t.textContent), ['Tableau de bord', 'Volumes', 'Réseaux']);
    const b = boutons(host, /^Ajouter depuis le catalogue$/)[0];
    assert.match(b.className, /primary/);
    b.click(); assert.equal(Q.etat.vue, 'catalogue'); assert.equal(Q.etat.focus, 'ark-v-catalogue');
    ({ host } = await dessiner());
    const t = onglets(host);
    assert.deepEqual(t.map((x) => [x.textContent, x.getAttribute('aria-selected'), x.getAttribute('tabindex')]), [['Tableau de bord', 'false', '-1'], ['Catalogue', 'true', '0'], ['Volumes', 'false', '-1'], ['Réseaux', 'false', '-1']]);
    t[1].fire('keydown', { key: 'ArrowRight' }); assert.equal(Q.etat.vue, 'volumes');
  } finally { v.stop(); }
});

test('Catalogue : une carte par appli ; catégories et recherche (aussi sur « Alternative à ») ; aucun nom de produit tant que les détails sont fermés', async () => {
  const { v } = odin();
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'catalogue', fiche: '', catF: 'tout', catQ: '', catOuv: '' });
    let { host } = await dessiner();
    assert.equal(cartes(host).length, CATALOGUE.length);
    const t = host.textContent;
    for (const x of ['Catalogue', 'Galerie de photos', 'Bloc-notes', 'version épinglée', '3 conteneurs', 'Photos · 3,3 Go de mémoire au plus', 'aucun site n\'est consulté']) assert.ok(t.includes(x), x);
    for (const p of CATALOGUE.flatMap((e) => e.alternativeA)) assert.ok(!t.includes(p), p);
    const chips = trouver(host, (n) => n.tagName === 'BUTTON' && n.className === 'ark-chip');
    assert.equal(chips[0].textContent, 'Tout'); assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
    chips.find((c) => c.textContent === 'Médias')!.click(); assert.equal(Q.etat.catF, 'Médias');
    ({ host } = await dessiner());
    assert.deepEqual(cartes(host).map(titre), ['Serveur de médias', 'Bibliothèque musicale']);
    // la recherche : sans redessiner la page (le clavier reste dans le champ)
    Object.assign(Q.etat, { catF: 'tout' });
    ({ host } = await dessiner());
    const q = trouver(host, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'search')[0];
    q.value = 'immich'; q.fire('input');
    assert.deepEqual(cartes(host).map(titre), ['Galerie de photos']);
    q.value = 'zzz'; q.fire('input'); assert.ok(host.textContent.includes('Aucune appli ne correspond.'));
  } finally { v.stop(); }
});

test('Détails : images et étiquettes, ports sur ce PC, volumes, mémoire, « Alternative à » (seule ligne aux noms de produits)', async () => {
  const { v } = odin();
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'catalogue', fiche: '', catF: 'tout', catQ: '', catOuv: '' });
    let { host } = await dessiner();
    const d = boutons(host, /^Détails$/).find((b) => b.getAttribute('aria-label') === 'Ce qu\'installe Galerie de photos')!;
    assert.equal(d.getAttribute('aria-expanded'), 'false');
    d.click(); assert.equal(Q.etat.catOuv, 'photos'); assert.equal(Q.etat.focus, 'ark-cx-photos');
    ({ host } = await dessiner());
    const carte = cartes(host).find((c) => c.textContent.includes('Galerie de photos'))!;
    const t = carte.textContent;
    for (const x of ['Images', 'ghcr.io/immich-app/immich-server:v1.123.0', 'redis:6.2.16-alpine', 'tensorchord/pgvecto-rs:pg14-v0.2.0', 'Ports sur ce PC', '20070 → 2283 · la galerie', 'photos_bibliotheque, photos_base', 'Mémoire au plus', '3,3 Go', 'Alternative à', 'Immich, Google Photos, iCloud Photos', 'Sa pile : « photos »', 'Le premier compte créé devient l\'administrateur', 'Sans la reconnaissance des visages']) assert.ok(t.includes(x), x);
    assert.equal(boutons(carte, /^Replier$/)[0].getAttribute('aria-expanded'), 'true');
    // hors de la ligne « Alternative à » et des noms d'images (techniques), aucun nom de produit
    const alt = trouver(carte, (n) => n.tagName === 'DD' && n.textContent.startsWith('Immich'))[0];
    const dedans = new Set(alt.all());
    const horsAlt = carte.all().filter((n) => n.tagName === '#TEXT' && !dedans.has(n) && n.parent?.tagName !== 'CODE').map((n) => n.text).join(' ');
    for (const p of ['Immich', 'Google Photos', 'iCloud']) assert.ok(!horsAlt.includes(p), p);
  } finally { v.stop(); }
});

test('Déployer : envoie l\'appli, son nom de pile et les ports montés ; « Une autre copie » quand elle est là ; la progression se lit sur la carte', async () => {
  const w = odin();
  try {
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'catalogue', fiche: '', catF: 'tout', catQ: '', catOuv: '', msg: '' });
    let { host } = await dessiner();
    const b = boutons(host, /^Déployer$/).find((x) => x.getAttribute('aria-label') === 'Déployer Bloc-notes')!;
    assert.equal(b.disabled, false);
    b.click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'deployer_catalogue', input: { app: 'notes', nom: 'notes', ports: 'web:20300' } });
    assert.equal(Q.logique.portsDe({ ports: [{ cle: 'web', hote: 20301 }, { cle: 'admin', hote: 20400 }] }), 'web:20301,admin:20400');
    // un vrai déploiement (moteur jetable, image déjà là) : la carte dit « déjà installée », « Une autre copie », « Ouvrir »
    const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: 'notes', ports: 'web:20300' });
    assert.equal(r.ok, true, r.text);
    for (let k = 0; k < 200 && !w.e.jobs().every((j) => j.ended); k++) await attendre();
    ({ host } = await dessiner());
    const carte = cartes(host).find((c) => c.textContent.includes('Bloc-notes'))!;
    assert.ok(carte.textContent.includes('déjà installée'));
    assert.ok(carte.textContent.includes('En marche'));
    const barre = trouver(carte, (n) => n.getAttribute('role') === 'progressbar')[0];
    assert.equal(barre.getAttribute('aria-valuemax'), '100');
    const copie = boutons(carte, /^Une autre copie$/)[0];
    assert.equal(copie.getAttribute('aria-label'), 'Déployer une autre copie de Bloc-notes');
    const lien = trouver(carte, (n) => n.tagName === 'A')[0];
    assert.equal(lien.getAttribute('href'), 'http://odin.maison:20300'); assert.equal(lien.getAttribute('rel'), 'noopener noreferrer');
    copie.click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'deployer_catalogue', input: { app: 'notes', nom: 'notes-2', ports: 'web:20301' } });
    boutons(carte, /^Voir ses piles$/)[0].click(); assert.equal(Q.etat.vue, 'piles'); assert.equal(Q.etat.pouv, 'notes');
  } finally { w.v.stop(); }
});

test('Windows : la carte « Ce PC » dit que le catalogue viendra avec le moteur ; aucun onglet, aucun geste', async () => {
  const { v } = odin('win32');
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'catalogue', fiche: '' });
    const { host, fait } = await dessiner();
    assert.equal(fait, true);
    assert.ok(host.textContent.includes('Le catalogue (des applis à déployer en un geste) est prêt aussi : il viendra avec le moteur.'));
    assert.equal(trouver(host, (n) => n.getAttribute('role') === 'tab').length, 0);
    assert.equal(boutons(host, /Déployer|copie/).length, 0);
  } finally { v.stop(); }
});

test('relecture : la carte dit qui peut l\'ouvrir (détails) et la mémoire qui dépasse la machine (toujours visible)', async () => {
  const { v, e } = odin(), memoire = A.systemeArche.memoireMachine;
  try {
    Object.assign(A.systemeArche, { memoireMachine: () => 4 * 1024 ** 3 });
    await e.create({ image: 'neosmemo/memos:0.22.5', name: 'gros', memory: '2g', network: 'pont' }); await e.start('gros');
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'catalogue', fiche: '', catF: 'tout', catQ: '', catOuv: 'photos' });
    const { host } = await dessiner();
    const carte = cartes(host).find((c) => c.textContent.includes('Galerie de photos'))!;
    assert.match(carte.textContent, /attention à la mémoire : .*plus que les 4 Go de cette machine/);
    assert.match(carte.textContent, /Qui peut l'ouvrir.*n'importe qui sur le réseau de la maison peut le créer avant toi/s);
    const site = cartes(host).find((c) => c.textContent.includes('Site web simple'))!;
    assert.doesNotMatch(site.textContent, /attention à la mémoire/);
  } finally { Object.assign(A.systemeArche, { memoireMachine: memoire }); v.stop(); }
});
