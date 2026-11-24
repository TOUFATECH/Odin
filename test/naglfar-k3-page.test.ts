// Arche, lot K3 (la page) : l'onglet Piles (il se montre dès qu'une pile existe, ou depuis « Nouvelle pile depuis un
// fichier »), chaque pile (état, Tout démarrer / Tout arrêter, Détails : ordre, conteneurs, fichier aux secrets
// masqués), le garde-fou de suppression (volumes gardés par défaut, son nom tapé pour les effacer), et « Nouvelle pile » :
// coller un fichier, « Vérifier seulement » (ce qu'Odin a compris : accepté, à savoir, refusé), « Déployer la pile »
// grisé tant qu'une ligne est refusée ou que le fichier a changé. Dessinés par src/web/pages/naglfar.js dans un document
// minimal ; les lectures et la vérification passent par les VRAIES actions d'Arche, sur le vrai moteur rangé dans un
// dossier jetable (aucun conteneur lancé, aucune commande) ; un geste est seulement noté, pas lancé.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import type { Valhalla as TValhalla } from '../src/valhalla/service.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k3p-baux-');
const SOURCE = readFileSync(new URL('../src/web/pages/naglfar.js', import.meta.url), 'utf8');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let P: typeof import('../src/valhalla/hringhorni/composition.ts');
let S: typeof import('../src/valhalla/service.ts');
let M: typeof import('../src/valhalla/odin.ts');
let C: typeof import('../src/config.ts');
let origine: Record<string, unknown> = {};
before(async () => {
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); P = await import('../src/valhalla/hringhorni/composition.ts');
  S = await import('../src/valhalla/service.ts'); M = await import('../src/valhalla/odin.ts'); C = await import('../src/config.ts');
  origine = { ...A.systemeArche };
});
after(() => { Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const JEUX = `services:
  monde:
    image: registre.example.org/serveur-jeu:1.21.4
    ports: ["25565:25565"]
    volumes: ["jeu-monde:/monde"]
    environment:
      MOT_DE_PASSE: "tres-secret-42"
  carte:
    image: registre.example.org/carte-web:3.0.2
    ports: ["8123:80"]
    volumes: ["jeu-monde:/monde:ro"]
    depends_on: [monde]
volumes:
  jeu-monde: {}
`;
const MAQUETTE = JEUX.replace('volumes: ["jeu-monde:/monde:ro"]', 'volumes: ["jeu-monde:/monde:ro", "/:/hote"]').replace('depends_on: [monde]', 'depends_on: [monde]\n    privileged: true');

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

// ------------------------------------------------------------------ un Odin d'essai (moteur jetable, aucun conteneur lancé)
function odin(plateforme = 'linux', avecPile = true) {
  const home = neuf('arche-k3p-'), dir = neuf('arche-k3p-moteur-');
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
  }
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never });
  const img = (n: string, id: string): Image => ({ id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/a'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() });
  e.store.saveImages([img('registre.example.org/serveur-jeu:1.21.4', 'a'.repeat(64)), img('registre.example.org/carte-web:3.0.2', 'b'.repeat(64))]);
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison'), disque: () => ({ libre: 80 * 1024 ** 3, total: 200 * 1024 ** 3 }) });
  const v = new S.Valhalla(home, M.allModules({ paths: { home, workspace: home }, cfg: C.DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  return { v, e, pret: plateforme === 'linux' && avecPile ? P.deployerPile(e as never, P.analyserComposition(JEUX, { nom: 'serveur-de-jeux' }), JEUX).then(() => e.stop('serveur-de-jeux-carte')) : Promise.resolve() };
}
function charger(v: TValhalla) {
  const { document, body } = documentMinimal(), gestes: Array<{ action: string; input: Record<string, unknown> }> = [];
  const lectures = ['services', 'tableau', 'fiche', 'journal_direct', 'volumes', 'reseaux', 'piles', 'fichier_pile', 'verifier_pile'];
  const fetch = async (_u: string, o: { body: string }) => {
    const b = JSON.parse(o.body) as { module: string; action: string; input: Record<string, unknown> };
    const a = v.action(b.module, b.action)?.a;
    if (!a?.read && !lectures.includes(b.action)) { gestes.push({ action: b.action, input: b.input }); return { json: async () => ({ ok: true, text: 'noté', data: b.action === 'deployer_pile' ? { pile: String(b.input.nom) } : undefined }) }; }
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
const onglets = (host: N) => trouver(host, (n) => n.getAttribute('role') === 'tab' && /^ark-v-/.test(n.id));

test('les mots de K3 : dans MOTS, en français simple, sans nom de produit', async () => {
  const { v } = odin('linux', false);
  try {
    const { Q } = charger(v);
    for (const k of ['v.piles', 'pi.titre', 'pi.demarrer', 'pi.arreter', 'pn.verifier', 'pn.deployer', 'pn.compris', 'pn.bloque', 'ps.garder', 'ps.confirmer', 'pc.k3', 'l.nouvellePile']) assert.ok(Q.MOTS[k], k);
    for (const [k, t] of Object.entries(Q.MOTS)) assert.doesNotMatch(t, /docker|podman|portainer|kubernetes|compose\b/i, k);
  } finally { v.stop(); }
});

test('onglets : « Piles » n\'apparaît que s\'il y a une pile (ou depuis « Nouvelle pile ») ; au clavier, les flèches passent les quatre', async () => {
  // sans pile : les trois onglets d'avant, et le bouton « Nouvelle pile depuis un fichier » sur le tableau
  const vide = odin('linux', false);
  try {
    const { dessiner, Q } = charger(vide.v);
    Object.assign(Q.etat, { vue: 'tableau', fiche: '' });
    let { host } = await dessiner();
    assert.deepEqual(onglets(host).map((t) => t.textContent), ['Tableau de bord', 'Volumes', 'Réseaux']);
    boutons(host, /^Nouvelle pile depuis un fichier$/)[0].click();
    assert.equal(Q.etat.vue, 'piles');
    ({ host } = await dessiner());
    assert.deepEqual(onglets(host).map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['Tableau de bord', 'false'], ['Piles', 'true'], ['Volumes', 'false'], ['Réseaux', 'false']]);
    assert.ok(host.textContent.includes('Aucune pile pour l\'instant.'));
  } finally { vide.v.stop(); }
  // avec une pile : quatre onglets tout de suite
  const w = odin();
  try {
    await w.pret;
    const { dessiner, Q } = charger(w.v);
    Object.assign(Q.etat, { vue: 'tableau', fiche: '' });
    const { host } = await dessiner();
    const t = onglets(host);
    assert.deepEqual(t.map((x) => x.textContent), ['Tableau de bord', 'Piles', 'Volumes', 'Réseaux']);
    t[0].fire('keydown', { key: 'ArrowRight' }); assert.equal(Q.etat.vue, 'piles');
    t[0].fire('keydown', { key: 'End' }); assert.equal(Q.etat.vue, 'reseaux');
    // la pile de chaque conteneur est écrite sur sa ligne
    assert.ok(host.textContent.includes('pile serveur-de-jeux'));
  } finally { w.v.stop(); }
});

test('Piles : l\'état, Tout démarrer / Tout arrêter, Détails (ordre, conteneurs, fichier aux secrets masqués)', async () => {
  const w = odin();
  try {
    await w.pret;
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'piles', fiche: '', pouv: '' });
    let { host } = await dessiner();
    let t = host.textContent;
    for (const x of ['Piles', 'serveur-de-jeux', 'en partie', '2 conteneur(s) · fichier de composition déposé le', 'Nouvelle pile depuis un fichier', 'Vérifier seulement']) assert.ok(t.includes(x), x);
    const dem = boutons(host, /^Tout démarrer$/), arr = boutons(host, /^Tout arrêter$/);
    assert.equal(dem[0].getAttribute('aria-label'), 'Démarrer toute la pile serveur-de-jeux');
    dem[0].click(); await attendre(); assert.deepEqual(gestes.at(-1), { action: 'demarrer_pile', input: { pile: 'serveur-de-jeux' } });
    arr[0].click(); await attendre(); assert.deepEqual(gestes.at(-1), { action: 'arreter_pile', input: { pile: 'serveur-de-jeux' } });
    const det = boutons(host, /^Détails$/)[0];
    assert.equal(det.getAttribute('aria-expanded'), 'false');
    det.click(); assert.equal(Q.etat.pouv, 'serveur-de-jeux');
    ({ host } = await dessiner()); t = host.textContent;
    assert.equal(boutons(host, /^Replier$/)[0].getAttribute('aria-expanded'), 'true');
    assert.ok(t.includes('monde, puis carte ; à l\'arrêt, l\'inverse.'));
    assert.ok(t.includes('serveur-de-jeux-monde') && t.includes('serveur-de-jeux-carte'));
    assert.ok(t.includes('Ses volumes : serveur-de-jeux_jeu-monde'));
    const code = trouver(host, (n) => n.tagName === 'PRE')[0].textContent;
    assert.match(code, /MOT_DE_PASSE: ••••••/); assert.doesNotMatch(t, /tres-secret-42/);
    // « Ouvrir » d'un conteneur de la pile mène à sa fiche
    boutons(host, /^Ouvrir$/)[0].click(); assert.equal(Q.etat.fiche, 'serveur-de-jeux-monde');
  } finally { w.v.stop(); }
});

test('Supprimer une pile : volumes gardés par défaut ; les effacer exige son nom tapé ; Échap garde', async () => {
  const w = odin();
  try {
    await w.pret;
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'piles', fiche: '', psupp: '', psuppVol: false, psuppTxt: '' });
    let { host } = await dessiner();
    const s = boutons(host, /^Supprimer$/)[0];
    assert.equal(s.getAttribute('aria-label'), 'Supprimer la pile serveur-de-jeux');
    s.click(); assert.equal(Q.etat.psupp, 'serveur-de-jeux');
    ({ host } = await dessiner());
    let garde = trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0];
    assert.ok(garde.textContent.includes('Supprimer la pile « serveur-de-jeux » ?'));
    assert.ok(garde.textContent.includes('serveur-de-jeux-monde, serveur-de-jeux-carte'));
    assert.ok(garde.textContent.includes('Seuls ses dossiers à elle peuvent partir'));
    const radios = trouver(garde, (n) => n.getAttribute('role') === 'radio');
    assert.deepEqual(radios.map((r) => [r.textContent, r.getAttribute('aria-checked'), r.getAttribute('tabindex')]), [['Garder ses volumes (conseillé)', 'true', '0'], ['Effacer ses volumes', 'false', '-1']]);
    boutons(garde, /^Supprimer$/)[0].click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_pile', input: { pile: 'serveur-de-jeux', volumes: 'garder', nom_tape: '' } });
    // effacer : au clavier (flèche), puis le nom
    Object.assign(Q.etat, { psupp: 'serveur-de-jeux', psuppVol: false, psuppTxt: '' });
    ({ host } = await dessiner());
    garde = trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0];
    trouver(garde, (n) => n.getAttribute('role') === 'radio')[0].fire('keydown', { key: 'ArrowRight' });
    assert.equal(Q.etat.psuppVol, true);
    ({ host } = await dessiner());
    garde = trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0];
    const ok = boutons(garde, /^Supprimer avec ses volumes$/)[0], champ = trouver(garde, (n) => n.tagName === 'INPUT' && n.id === 'arkPileNom')[0];
    assert.equal(ok.disabled, true);
    const avant = gestes.length;
    for (const x of ['serveur', 'Serveur-de-jeux']) { champ.value = x; champ.fire('input'); assert.equal(ok.disabled, true, x); }
    ok.click(); await attendre(); assert.equal(gestes.length, avant, 'rien envoyé sans le nom');
    champ.value = 'serveur-de-jeux'; champ.fire('input'); assert.equal(ok.disabled, false);
    ok.click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_pile', input: { pile: 'serveur-de-jeux', volumes: 'effacer', nom_tape: 'serveur-de-jeux' } });
    Object.assign(Q.etat, { psupp: 'serveur-de-jeux' });
    ({ host } = await dessiner());
    trouver(host, (n) => n.getAttribute('role') === 'alertdialog')[0].fire('keydown', { key: 'Escape' });
    assert.equal(Q.etat.psupp, '');
  } finally { w.v.stop(); }
});

test('Nouvelle pile : vérifier montre ce qu\'Odin a compris ; « Déployer » grisé tant qu\'une ligne est refusée ou que le fichier a changé', async () => {
  const w = odin('linux', false);
  try {
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'piles', fiche: '', compo: '', compoNom: '', analyse: null, analyseDe: '' });
    let { host } = await dessiner();
    const ta = trouver(host, (n) => n.tagName === 'TEXTAREA')[0], nom = trouver(host, (n) => n.id === 'arkCompoNom')[0];
    assert.equal(boutons(host, /^Déployer la pile$/)[0].disabled, true);
    assert.ok(host.textContent.includes('Vérifie le fichier avant de déployer.'));
    // le fichier de la maquette : deux lignes refusées
    ta.value = MAQUETTE; ta.fire('input'); nom.value = 'serveur-de-jeux'; nom.fire('input');
    boutons(host, /^Vérifier seulement$/)[0].click(); await attendre(); await attendre();
    assert.equal((Q.etat.analyse as { ok: boolean }).ok, false);
    ({ host } = await dessiner());
    let t = host.textContent;
    for (const x of ['Ce qu\'Odin a compris', '2 conteneurs', 'monde, puis carte (attend monde)', 'Ports 25565, 8123', 'privileged: true', 'le disque entier du PC n\'est jamais monté', 'Rien n\'est déployé tant qu\'une ligne est refusée']) assert.ok(t.includes(x), x);
    const items = trouver(host, (n) => n.tagName === 'LI' && ['ok', 'refus', 'change'].includes(n.className));
    assert.deepEqual([...new Set(items.map((n) => n.className))].sort(), ['change', 'ok', 'refus']);
    assert.ok(items.filter((n) => n.className === 'refus').every((n) => n.textContent.startsWith('✗refusé : ')), 'le refus est dit aussi en mots (lecteur d\'écran)');
    assert.equal(boutons(host, /^Déployer la pile$/)[0].disabled, true);
    // corrigé : vérifié à nouveau, « Déployer » s'allume
    const ta2 = trouver(host, (n) => n.tagName === 'TEXTAREA')[0];
    assert.equal(ta2.value, MAQUETTE, 'le texte collé reste');
    ta2.value = JEUX; ta2.fire('input');
    boutons(host, /^Vérifier seulement$/)[0].click(); await attendre(); await attendre();
    ({ host } = await dessiner()); t = host.textContent;
    assert.ok(t.includes('Pile « serveur-de-jeux » · 2 conteneur(s) · réseau à part pour la pile'));
    const dep = boutons(host, /^Déployer la pile$/)[0];
    assert.equal(dep.disabled, false);
    // une lettre changée : grisé à nouveau, il faut revérifier
    const ta3 = trouver(host, (n) => n.tagName === 'TEXTAREA')[0];
    ta3.value = `${JEUX}# changé`; ta3.fire('input');
    assert.equal(dep.disabled, true);
    ta3.value = JEUX; ta3.fire('input'); assert.equal(dep.disabled, false);
    dep.click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'deployer_pile', input: { compose: JEUX, nom: 'serveur-de-jeux' } });
    assert.equal(Q.etat.compo, '', 'le champ est vidé une fois lancé');
    // rien n'a été créé par la vérification
    assert.deepEqual([w.e.store.volumes(), w.e.store.reseaux(), w.e.ps(true)], [[], [], []]);
  } finally { w.v.stop(); }
});

test('Windows : la carte « Ce PC » dit aussi que les piles viendront avec le moteur ; aucun onglet, aucun geste', async () => {
  const w = odin('win32');
  try {
    const { dessiner, Q } = charger(w.v);
    Object.assign(Q.etat, { vue: 'piles', fiche: '' });
    const { host, fait } = await dessiner();
    assert.equal(fait, true);
    assert.ok(host.textContent.includes('Les piles (plusieurs conteneurs décrits dans un fichier de composition) sont prêtes aussi : elles viendront avec le moteur.'));
    assert.equal(trouver(host, (n) => n.getAttribute('role') === 'tab').length, 0);
    assert.equal(boutons(host, /Déployer|Supprimer|Tout démarrer|Vérifier/).length, 0);
  } finally { w.v.stop(); }
});

test('logique de la page : déployer seulement après une vérification sans refus, du texte tel qu\'il est', async () => {
  const { v } = odin('linux', false);
  try {
    const { Q } = charger(v);
    const d = Q.logique.peutDeployer;
    assert.equal(d({ ok: true }, 'p\nA', 'A', 'p'), true);
    assert.equal(d({ ok: false }, 'p\nA', 'A', 'p'), false);
    assert.equal(d({ ok: true }, 'p\nA', 'B', 'p'), false);
    assert.equal(d({ ok: true }, 'p\nA', 'A', 'q'), false, 'le nom changé aussi');
    assert.equal(d(null, '', '', ''), false);
  } finally { v.stop(); }
});
