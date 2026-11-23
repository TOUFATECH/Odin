// Arche, lot K2 (la page) : les onglets Tableau de bord / Volumes / Réseaux, l'écran Volumes (taille, qui s'en sert,
// « sauvegardé chaque nuit », supprimer un volume sans conteneur avec son nom tapé) et l'écran Réseaux (celui de tous,
// les réseaux à part, « aucun », créer, retirer un réseau vide), dessinés par src/web/pages/naglfar.js dans un document
// minimal. Les lectures passent par les VRAIES actions d'Arche, sur le vrai moteur rangé dans un dossier jetable (aucun
// conteneur lancé, aucune commande) ; un geste est seulement noté, pas lancé.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import type { Valhalla as TValhalla } from '../src/valhalla/service.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k2p-baux-');
const SOURCE = readFileSync(new URL('../src/web/pages/naglfar.js', import.meta.url), 'utf8');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let S: typeof import('../src/valhalla/service.ts');
let M: typeof import('../src/valhalla/odin.ts');
let C: typeof import('../src/config.ts');
let origine: Record<string, unknown> = {};
// Phénix chiffre ses sauvegardes : un mot de passe d'essai, rendu à la fin.
const motAvant = process.env.SINDRI_PASSWORD;
process.env.SINDRI_PASSWORD = 'essai-k2-page-jetable';
before(async () => {
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts');
  S = await import('../src/valhalla/service.ts'); M = await import('../src/valhalla/odin.ts'); C = await import('../src/config.ts');
  origine = { ...A.systemeArche };
});
after(() => { if (motAvant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = motAvant; Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ un document minimal (comme l'essai de la page K1)
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

// ------------------------------------------------------------------ un Odin d'essai
function odin(plateforme = 'linux') {
  const home = neuf('arche-k2p-'), dir = neuf('arche-k2p-moteur-');
  const e = new H.Engine(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never });
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, disque: () => ({ libre: 80 * 1024 ** 3, total: 200 * 1024 ** 3 }) });
  if (plateforme === 'linux') {
    e.createVolume('photos-donnees'); e.createVolume('ancien-essai');
    writeFileSync(join(e.store.volumeData('ancien-essai'), 'f'), 'x'.repeat(35 * 1024 * 1024 / 1024));
    const id = `${'ab'.repeat(6)}${'c'.repeat(52)}`;
    e.store.saveSpec({ id, name: 'galerie-photos', image: 'r.example.org/g:1', imageId: 'i', cmd: ['/a'], env: {}, workdir: '/', user: '', ports: [], mounts: [{ host: e.store.volumeData('photos-donnees'), inner: '/p', ro: false, volume: 'photos-donnees' }], restart: 'non', hostname: 'g', network: 'pont', reseau: 'serveur-de-jeux', autoRemove: false, created: new Date().toISOString(), labels: {} });
    e.store.saveState(id, { status: 'arrêté' });
    e.createReseau('serveur-de-jeux'); e.createReseau('cage', { internet: false });
  }
  const v = new S.Valhalla(home, M.allModules({ paths: { home, workspace: home }, cfg: C.DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  return v;
}
function charger(v: TValhalla) {
  const { document, body } = documentMinimal(), gestes: Array<{ action: string; input: Record<string, unknown> }> = [];
  const fetch = async (_u: string, o: { body: string }) => {
    const b = JSON.parse(o.body) as { module: string; action: string; input: Record<string, unknown> };
    const a = v.action(b.module, b.action)?.a;
    if (!a?.read && !['services', 'tableau', 'fiche', 'journal_direct', 'volumes', 'reseaux'].includes(b.action)) { gestes.push({ action: b.action, input: b.input }); return { json: async () => ({ ok: true, text: 'noté' }) }; }
    const r = await v.act(b.module, b.action, b.input); return { json: async () => r };
  };
  const window: Record<string, unknown> = { OdinPages: {}, OdinDialog: { confirm: async () => true } };
  const ctx = vm.createContext({ window, document, fetch, Node: N, location: { hostname: 'odin.maison' }, setTimeout: (f: () => void, ms: number) => (ms >= 1000 ? 0 : setTimeout(f, ms)), clearTimeout, URL, Blob, console });
  vm.runInContext(SOURCE, ctx);
  const page = (window.OdinPages as Record<string, (o: unknown) => Promise<boolean>>).naglfar;
  const P = window.OdinArche as { MOTS: Record<string, string>; logique: Record<string, (...a: unknown[]) => unknown>; etat: Record<string, unknown> };
  const dessiner = async () => { const host = new N('div'); body.append(host); const fait = await page({ host, generic: [], reload: () => {}, info: { name: 'Arche' } }); await attendre(); return { host, fait }; };
  return { dessiner, P, gestes };
}

test('les mots de K2 : dans MOTS, en français simple, sans nom de produit', () => {
  const v = odin();
  try {
    const { P } = charger(v);
    for (const k of ['v.volumes', 'v.reseaux', 'vo.titre', 'vo.sauve', 'vo.s.confirmer', 're.tous', 're.aucun', 're.creer']) assert.ok(P.MOTS[k], k);
    for (const [k, t] of Object.entries(P.MOTS)) assert.doesNotMatch(t, /docker|podman|portainer|kubernetes/i, k);
  } finally { v.stop(); }
});

test('onglets : Tableau de bord, Volumes, Réseaux ; au clavier (flèches) on passe de l\'un à l\'autre', async () => {
  const v = odin();
  try {
    const { dessiner, P } = charger(v);
    Object.assign(P.etat, { vue: 'tableau', fiche: '' });
    const { host } = await dessiner();
    const tabs = trouver(host, (n) => n.getAttribute('role') === 'tab' && /^ark-v-/.test(n.id));
    assert.deepEqual(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected'), t.getAttribute('tabindex')]), [['Tableau de bord', 'true', '0'], ['Volumes', 'false', '-1'], ['Réseaux', 'false', '-1']]);
    tabs[0].fire('keydown', { key: 'ArrowRight' }); assert.equal(P.etat.vue, 'volumes');
    tabs[0].fire('keydown', { key: 'End' }); assert.equal(P.etat.vue, 'reseaux');
    tabs[0].fire('keydown', { key: 'ArrowLeft' }); assert.equal(P.etat.vue, 'reseaux', 'depuis le premier : le dernier');
  } finally { v.stop(); }
});

test('Volumes : taille, qui s\'en sert, « sans conteneur », l\'interrupteur de sauvegarde ; supprimer seulement un volume sans conteneur, avec son nom tapé', async () => {
  const v = odin();
  try {
    const { dessiner, P, gestes } = charger(v);
    Object.assign(P.etat, { vue: 'volumes', fiche: '', vsupp: '', vsuppTxt: '' });
    let { host } = await dessiner();
    const t = host.textContent;
    for (const x of ['Volumes', 'photos-donnees', 'utilisé par galerie-photos', 'ancien-essai', 'sans conteneur', 'plus aucun conteneur ne s\'en sert', '35 Ko', 'sauvegardé chaque nuit', 'Créer un volume']) assert.ok(t.includes(x), x);
    const sw = trouver(host, (n) => n.getAttribute('role') === 'switch');
    assert.equal(sw.length, 2); assert.ok(sw.every((s) => s.getAttribute('aria-checked') === 'false' && !s.disabled));
    assert.ok(t.includes('Sauvegarde par Phénix : plan « Volumes d\'Arche », chaque nuit à 02:15 · dernière : jamais.'));
    assert.equal(sw[0].getAttribute('aria-label'), 'Sauvegarder ancien-essai chaque nuit (Phénix)');
    sw[0].click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'sauvegarde_volume', input: { volume: 'ancien-essai', sauver: 'oui' } });
    // Supprimer : un seul bouton, pour le volume sans conteneur.
    const supp = boutons(host, /^Supprimer$/);
    assert.equal(supp.length, 1); assert.equal(supp[0].getAttribute('aria-label'), 'Supprimer le volume ancien-essai');
    supp[0].click(); assert.equal(P.etat.vsupp, 'ancien-essai');
    ({ host } = await dessiner());
    assert.ok(host.textContent.includes('Supprimer le volume « ancien-essai » (35 Ko) ?'));
    assert.ok(host.textContent.includes('Il n\'a jamais été sauvegardé : ses données ne pourront pas revenir.'));
    const garde = trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0];
    const ok = boutons(garde, /^Supprimer$/)[0], champ = trouver(garde, (n) => n.tagName === 'INPUT' && n.id === 'arkVolNom')[0];
    assert.equal(ok.disabled, true);
    for (const x of ['ancien', 'Ancien-essai']) { champ.value = x; champ.fire('input'); assert.equal(ok.disabled, true, x); }
    const avant = gestes.length; ok.click(); await attendre(); assert.equal(gestes.length, avant, 'rien envoyé sans le nom');
    champ.value = 'ancien-essai'; champ.fire('input'); assert.equal(ok.disabled, false);
    ok.click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_volume', input: { volume: 'ancien-essai', nom_tape: 'ancien-essai' } });
    // Échap : on garde
    Object.assign(P.etat, { vsupp: 'ancien-essai' });
    ({ host } = await dessiner());
    trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0].fire('keydown', { key: 'Escape' });
    assert.equal(P.etat.vsupp, '');
    // Créer un volume
    const form = trouver(host, (n) => n.tagName === 'FORM')[0], nom = trouver(form, (n) => n.tagName === 'INPUT')[0];
    nom.value = 'wiki-pages'; form.fire('submit'); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'creer_volume', input: { nom: 'wiki-pages' } });
  } finally { v.stop(); }
});

test('Réseaux : celui de tous, les réseaux à part (isolés), « aucun » ; « Retirer » seulement pour un réseau vide ; créer sans Internet', async () => {
  const v = odin();
  try {
    const { dessiner, P, gestes } = charger(v);
    Object.assign(P.etat, { vue: 'reseaux', fiche: '' });
    const { host } = await dessiner();
    const t = host.textContent;
    for (const x of ['Réseau des conteneurs', '10.89.0.0/24 · tous les conteneurs par défaut', 'Réseau « serveur-de-jeux »', '10.89.1.0/24 · à part', 'Internet : oui · les autres conteneurs : non', 'Réseau « cage »', 'Internet : non · les autres conteneurs : non', 'Aucun réseau', 'ni Internet ni la maison', 'galerie-photos', 'Créer un réseau à part']) assert.ok(t.includes(x), x);
    const r = boutons(host, /^Retirer$/);
    assert.equal(r.length, 1); assert.equal(r[0].getAttribute('aria-label'), 'Retirer le réseau cage');
    r[0].click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_reseau', input: { reseau: 'cage' } });
    const non = trouver(host, (n) => n.getAttribute('role') === 'radio' && /non$/.test(n.textContent))[0];
    non.click(); assert.equal(P.etat.rInternet, false);
    const form = trouver(host, (n) => n.tagName === 'FORM')[0], nom = trouver(form, (n) => n.tagName === 'INPUT')[0];
    nom.value = 'essais'; form.fire('submit'); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'creer_reseau', input: { nom: 'essais', internet: 'non' } });
  } finally { v.stop(); }
});

test('Windows : la carte « Ce PC » dit aussi que volumes et réseaux viendront avec le moteur ; aucun onglet, aucun geste', async () => {
  const v = odin('win32');
  try {
    const { dessiner, P } = charger(v);
    Object.assign(P.etat, { vue: 'volumes', fiche: '' });
    const { host, fait } = await dessiner();
    assert.equal(fait, true);
    assert.ok(host.textContent.includes('Les volumes et les réseaux sont prêts aussi : ils viendront avec le moteur.'));
    assert.ok(host.textContent.includes('WSL2'));
    assert.equal(trouver(host, (n) => n.getAttribute('role') === 'tab').length, 0);
    assert.equal(boutons(host, /Supprimer|Retirer|Créer/).length, 0);
  } finally { v.stop(); }
});
