// Arche, lot K5 (la page) : « Mises à jour » et « Limites ». Le tableau de bord ouvre les deux onglets (« Voir les mises à
// jour », « Total et limites ») ; « Mises à jour » se montre aussi tout seul dès qu'il y a une proposition ou une copie
// gardée. Une proposition dit les étapes AVANT le geste (copie des volumes, nouvelle image, mêmes réglages, vérification,
// retour tout seul) ; « Choisir une version » refuse « latest » et une version vide ; les copies gardées se retirent par
// un geste. « Limites » : le total de tous les conteneurs, chacun, et « grandit ». Dessinés par src/web/pages/naglfar.js
// dans un document minimal ; les lectures passent par les VRAIES actions d'Arche (moteur jetable, aucun conteneur
// lancé, aucune commande, aucun téléchargement) ; un geste de la page est seulement noté, pas lancé.
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
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k5p-baux-');
const SOURCE = readFileSync(new URL('../src/web/pages/naglfar.js', import.meta.url), 'utf8');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let S: typeof import('../src/valhalla/service.ts');
let M: typeof import('../src/valhalla/odin.ts');
let C: typeof import('../src/config.ts');
let J: typeof import('../src/valhalla/hringhorni/majs.ts');
let origine: Record<string, unknown> = {}, sante0: Record<string, number> = {};
before(async () => {
  J = await import('../src/valhalla/hringhorni/majs.ts'); sante0 = { ...J.SANTE }; Object.assign(J.SANTE, { secondes: 0.05, pasMs: 10 });
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts');
  S = await import('../src/valhalla/service.ts'); M = await import('../src/valhalla/odin.ts'); C = await import('../src/config.ts');
  origine = { ...A.systemeArche };
});
after(() => { Object.assign(A.systemeArche, origine); Object.assign(J.SANTE, sante0); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

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
  const home = neuf('arche-k5p-'), dir = neuf('arche-k5p-moteur-');
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
  }
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never });
  const img = (n: string, id: string): Image => ({ id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/a'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() });
  e.store.saveImages([img('neosmemo/memos:0.22.5', 'a'.repeat(64)), img('neosmemo/memos:0.22.4', 'b'.repeat(64))]);
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison'), disque: () => ({ libre: 80 * 1024 ** 3, total: 200 * 1024 ** 3 }) });
  const v = new S.Valhalla(home, M.allModules({ paths: { home, workspace: home }, cfg: C.DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  return { v, e };
}
function charger(v: TValhalla) {
  const { document, body } = documentMinimal(), gestes: Array<{ action: string; input: Record<string, unknown> }> = [];
  const lectures = ['services', 'tableau', 'fiche', 'journal_direct', 'volumes', 'reseaux', 'piles', 'fichier_pile', 'verifier_pile', 'catalogue', 'mises_a_jour', 'limites'];
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

const sections = (host: N) => trouver(host, (n) => n.tagName === 'SECTION');
const majCartes = (host: N) => trouver(host, (n) => n.tagName === 'DIV' && /(^| )ark-maj( |$)/.test(n.className));
async function finir(e: { jobs(): Array<{ ended?: string }> }) { for (let k = 0; k < 300 && !e.jobs().every((j) => j.ended); k++) await attendre(); }

test('les mots de K5 : dans MOTS, en français simple, sans nom de produit', async () => {
  const { v } = odin();
  try {
    const { Q } = charger(v);
    for (const k of ['pc.k5', 'v.majs', 'v.limites', 'l.majs', 'l.limites', 'mj.titre', 'mj.lead', 'mj.e1', 'mj.e2', 'mj.e3', 'mj.e4', 'mj.maintenant', 'mj.pasMaintenant', 'mj.choisir', 'mj.choisir.lead', 'mj.copies', 'mj.retirer', 'mj.jamais', 'li.titre', 'li.lead', 'li.grandit', 'li.changer']) assert.ok(Q.MOTS[k], k);
    const produits = [...new Set(CATALOGUE.flatMap((e) => e.alternativeA))];
    for (const [k, t] of Object.entries(Q.MOTS)) {
      assert.doesNotMatch(t, /docker|podman|portainer|watchtower|kubernetes|compose\b/i, k);
      for (const p of produits) assert.ok(!t.toLowerCase().includes(p.toLowerCase()), `${k} : ${p}`);
    }
    assert.match(Q.MOTS['mj.jamais'], /Jamais : je décide/);
    // une version écrite à la main : précise, jamais « latest »
    const vp = Q.logique.versionPrecise as (x: string) => boolean;
    assert.deepEqual(['a/b:1.2', 'a/b', 'a/b:', 'a/b:latest', 'a/b:LATEST', `a/b@sha256:${'c'.repeat(64)}`, 'a b:1'].map(vp), [true, false, false, false, false, true, false]);
  } finally { v.stop(); }
});

test('onglets : « Total et limites » et « Voir les mises à jour » les ouvrent ; sans rien à proposer, les onglets restent les mêmes', async () => {
  const { v } = odin();
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'tableau', fiche: '' });
    let { host } = await dessiner();
    assert.deepEqual(onglets(host).map((t) => t.textContent), ['Tableau de bord', 'Volumes', 'Réseaux']);
    boutons(host, /^Total et limites$/)[0].click(); assert.equal(Q.etat.vue, 'limites'); assert.equal(Q.etat.focus, 'ark-v-limites');
    ({ host } = await dessiner());
    assert.deepEqual(onglets(host).map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['Tableau de bord', 'false'], ['Volumes', 'false'], ['Réseaux', 'false'], ['Limites', 'true']]);
    Object.assign(Q.etat, { vue: 'tableau' });
    ({ host } = await dessiner());
    boutons(host, /^Voir les mises à jour$/)[0].click(); assert.equal(Q.etat.vue, 'majs');
    ({ host } = await dessiner());
    const t = onglets(host);
    assert.deepEqual(t.map((x) => x.textContent), ['Tableau de bord', 'Volumes', 'Réseaux', 'Mises à jour']);
    t[3].fire('keydown', { key: 'ArrowRight' }); assert.equal(Q.etat.vue, 'tableau', 'au clavier, les flèches font le tour');
    assert.ok(host.textContent.includes('Rien à proposer pour l\'instant.'));
    assert.ok(host.textContent.includes('Jamais : je décide (ton choix)'));
  } finally { v.stop(); }
});

test('une proposition du catalogue d\'Odin : les étapes AVANT le geste, puis « Mettre à jour maintenant » envoie la pile ; « Pas maintenant » referme', async () => {
  const w = odin();
  try {
    const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: 'notes', ports: 'web:20300' }); assert.equal(r.ok, true, r.text); await finir(w.e);
    const r2 = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'notes-serveur', image: 'neosmemo/memos:0.22.4' }); assert.equal(r2.ok, true, r2.text); await finir(w.e);
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'tableau', fiche: '', majOuv: '', msg: '' });
    let { host } = await dessiner();
    // l'onglet se montre tout seul (une proposition, une copie gardée) ; le tableau compte la proposition du catalogue
    assert.deepEqual(onglets(host).map((t) => t.textContent), ['Tableau de bord', 'Piles', 'Volumes', 'Réseaux', 'Mises à jour']);
    assert.ok(boutons(host, /^Voir les mises à jour$/).length);
    Object.assign(Q.etat, { vue: 'majs' });
    ({ host } = await dessiner());
    const c = majCartes(host).find((x) => x.textContent.includes('pile notes'))!;
    assert.ok(c.textContent.includes('neosmemo/memos:0.22.4 → neosmemo/memos:0.22.5')); assert.ok(c.textContent.includes('version du catalogue d\'Odin'));
    const b = boutons(c, /^Mettre à jour$/)[0];
    assert.equal(b.getAttribute('aria-expanded'), 'false'); assert.equal(b.getAttribute('aria-label'), 'Mettre à jour notes');
    b.click(); assert.equal(Q.etat.majOuv, 'pile:notes'); assert.equal(Q.etat.focus, 'ark-mo-pile:notes');
    ({ host } = await dessiner());
    const c2 = majCartes(host).find((x) => x.textContent.includes('pile notes'))!;
    const etapes = trouver(c2, (n) => n.tagName === 'LI').map((n) => n.textContent);
    assert.deepEqual(etapes, ['Copie de ses volumes, dans le dossier du moteur (place vérifiée avant)', 'Nouvelle image récupérée et vérifiée (antivirus)', 'Conteneur recréé avec les mêmes réglages', 'Il doit tenir debout 0,05 secondes ; sinon, retour tout seul à l\'ancienne version et aux volumes copiés']);
    boutons(c2, /^Mettre à jour maintenant$/)[0].click(); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'mettre_a_jour_pile', input: { pile: 'notes' } });
    Object.assign(Q.etat, { majOuv: 'pile:notes' });
    ({ host } = await dessiner());
    boutons(host, /^Pas maintenant$/)[0].click(); assert.equal(Q.etat.majOuv, '');
    // les copies gardées : la mise à jour faite plus haut, réussie, et « Retirer » (un geste)
    ({ host } = await dessiner());
    const copies = sections(host).find((s) => s.textContent.startsWith('Copies gardées'))!;
    assert.ok(copies.textContent.includes('réussie')); assert.ok(copies.textContent.includes('rien n\'est effacé sans toi'));
    const ret = boutons(copies, /^Retirer$/)[0]; assert.match(String(ret.getAttribute('aria-label')), /^Retirer la copie du /);
    ret.click(); await attendre();
    assert.equal(gestes.at(-1)!.action, 'retirer_copie'); assert.match(String(gestes.at(-1)!.input.copie), /^[a-f0-9]{12}$/);
  } finally { w.v.stop(); }
});

test('choisir une version : le champ part de la version d\'aujourd\'hui ; « latest », vide ou la même : bouton fermé ; sinon le geste part', async () => {
  const w = odin();
  try {
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'notes-a-part', network: 'pont' }); await w.e.start('notes-a-part');
    const { dessiner, Q, gestes } = charger(w.v);
    Object.assign(Q.etat, { vue: 'majs', fiche: '', majCt: '', majImg: '' });
    const { host } = await dessiner();
    const champ = trouver(host, (n) => n.id === 'arkMajImg')[0];
    assert.equal(champ.value, 'neosmemo/memos:0.22.5');
    assert.match(trouver(host, (n) => n.id === 'arkMajConnu')[0].textContent, /ne connaît pas d'autre version/);
    const ok = boutons(host, /^Mettre à jour vers cette version$/)[0];
    assert.equal(ok.disabled, true, 'la même version');
    for (const [val, ferme] of [['neosmemo/memos:latest', true], ['neosmemo/memos', true], ['neosmemo/memos:0.22.4', false]] as const) { champ.value = val; champ.fire('input'); assert.equal(ok.disabled, ferme, val); }
    const form = trouver(host, (n) => n.tagName === 'FORM')[0];
    form.fire('submit'); await attendre();
    assert.deepEqual(gestes.at(-1), { action: 'mettre_a_jour_version', input: { conteneur: 'notes-a-part', image: 'neosmemo/memos:0.22.4' } });
    // le label du champ et la liste des conteneurs, au clavier
    assert.ok(trouver(host, (n) => n.tagName === 'LABEL' && n.textContent.startsWith('Version voulue')).length);
    assert.deepEqual(trouver(host, (n) => n.tagName === 'OPTION').map((n) => n.textContent), ['notes-a-part']);
  } finally { w.v.stop(); }
});

test('Limites : le total (processeur, mémoire, disque), chacun avec « Changer » vers sa fiche, et un volume qui « grandit »', async () => {
  const w = odin(), memoire = A.systemeArche.memoireMachine, stat = A.systemeArche.stat;
  try {
    Object.assign(A.systemeArche, { memoireMachine: () => 4 * 1024 ** 3, stat: () => ({ at: Date.now(), usageUsec: 0, memCurrent: 300 * 1024 ** 2, memMax: 0 }) });
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'gros', memory: '6g', network: 'pont', mounts: 'gros-donnees:/data' }); await w.e.start('gros');
    const now = Date.now(); w.v.ctx('naglfar').saveSettings({ tailles: { 'gros-donnees': [{ at: now - 2 * 3600_000, o: 0 }, { at: now - 1000, o: 2 * 1024 ** 3 }] } });
    const { dessiner, Q } = charger(w.v);
    Object.assign(Q.etat, { vue: 'limites', fiche: '' });
    const { host } = await dessiner();
    const t = host.textContent;
    for (const x of ['Tous les conteneurs ensemble', 'Processeur', 'de 4 cœurs', 'Mémoire', '300 Mo', 'utilisés sur 4 Go de la machine', 'plus que les 4 Go de la machine', 'Disque', '80 Go libres sur 200 Go', 'Chacun', 'utilise 300 Mo · au plus 6 Go · tous les cœurs', 'Volumes', 'gros-donnees', 'grandit', 'par jour']) assert.ok(t.includes(x), x);
    const ch = boutons(host, /^Changer$/)[0];
    assert.equal(ch.getAttribute('aria-label'), 'Changer les limites de gros');
    ch.click(); assert.deepEqual([Q.etat.vue, Q.etat.fiche, Q.etat.ftab], ['tableau', 'gros', 'ressources']);
  } finally { Object.assign(A.systemeArche, { memoireMachine: memoire, stat }); w.v.stop(); }
});

test('Windows : la carte « Ce PC » dit que les mises à jour sûres viendront avec le moteur ; aucun geste', async () => {
  const { v } = odin('win32');
  try {
    const { dessiner, Q } = charger(v);
    Object.assign(Q.etat, { vue: 'majs', fiche: '' });
    const { host, fait } = await dessiner();
    assert.equal(fait, true);
    assert.ok(host.textContent.includes('Les mises à jour sûres (copie des volumes, retour tout seul) et les limites sont prêtes aussi'));
    assert.equal(boutons(host, /Mettre à jour|Retirer|Changer/).length, 0);
  } finally { v.stop(); }
});
