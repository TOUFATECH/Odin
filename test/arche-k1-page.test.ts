// Arche, lot K1 (la page) : le tableau de bord, la fiche (journal, terminal, réglages, ressources), le garde-fou de
// suppression et la carte « Ce PC » sans moteur, dessinés par src/web/pages/naglfar.js dans un document minimal.
// Les réponses sont celles des VRAIES actions d'Arche sur un faux moteur (aucun conteneur, aucun navigateur, aucun réseau).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { systemeArche, useEngine, type EngineLike } from '../src/valhalla/modules/naglfar.ts';
import type { Ctr } from '../src/valhalla/hringhorni/engine.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { ...systemeArche };
after(() => { Object.assign(systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const SOURCE = readFileSync(new URL('../src/web/pages/naglfar.js', import.meta.url), 'utf8');

// ------------------------------------------------------------------ un document minimal
class N {
  tagName: string; children: N[] = []; parent?: N; attrs: Record<string, string> = {}; listeners: Record<string, Array<(e: unknown) => void>> = {};
  text = ''; value = ''; disabled = false; scrollTop = 0; scrollHeight = 0; style = { cssText: '' }; root = false;
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

// ------------------------------------------------------------------ un Odin d'essai, des actions vraies
function ctr(nom: string, etat: Ctr['state']['status'], o: Partial<Ctr['spec']> = {}): Ctr {
  const id = `${'ab'.repeat(6)}${nom.length}${'c'.repeat(51)}`;
  return { id, spec: { id, name: nom, image: `registre.example.org/${nom}:1.0`, imageId: 'sha256:img', cmd: [], env: { FUSEAU: 'UTC', MOT_DE_PASSE: 'tres-secret-123' }, workdir: '/', user: '', ports: [{ host: 2342, inner: 2342, proto: 'tcp' }], mounts: [], restart: 'sauf-arret', memory: '1g', cpus: '1', hostname: nom, network: 'pont', autoRemove: false, created: '2026-11-20T10:00:00.000Z', labels: {}, ...o }, state: { status: etat, startedAt: new Date(Date.now() - 3_600_000).toISOString(), ip: '10.89.0.12' } };
}
function odin(plateforme = 'linux') {
  const home = neuf('arche-k1-page-'), d = join(neuf('arche-k1-page-donnees-'), 'apps', 'galerie', 'donnees'); mkdirSync(d, { recursive: true });
  const cts = [ctr('galerie-photos', 'en marche', { mounts: [{ host: d, inner: '/donnees', ro: false }] }), ctr('jeu-monde', 'arrêté')];
  const faux = {
    ps: (all = false) => (all ? cts : cts.filter((c) => c.state.status === 'en marche')), find: (n: string) => { const c = cts.find((x) => x.spec.name === n); if (!c) throw new Error(`conteneur inconnu : ${n}`); return c; },
    logs: () => [{ at: '2026-11-23T10:41:02.000Z', stream: 'o' as const, text: 'démarrage de la galerie' }, { at: '2026-11-23T10:41:03.000Z', stream: 'e' as const, text: '<img src=x onerror=alert(1)> mot de passe tres-secret-123' }],
    images: () => [{ id: 'sha256:img', names: ['registre.example.org/galerie-photos:1.0'], size: 3.4 * 1024 ** 3, created: '' }], jobs: () => [],
  };
  useEngine(() => faux as unknown as EngineLike);
  Object.assign(systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => join(home, 'moteur'), disque: () => ({ libre: 80 * 1024 ** 3, total: 200 * 1024 ** 3 }), stat: () => ({ usageUsec: 1, memCurrent: 410 * 1024 ** 2, memMax: 1024 ** 3, cpuQuota: 1, throttled: 0, at: 1 }) });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  return v;
}
/** Charge la page, avec un fetch qui passe par les VRAIES actions (lectures seulement : un geste est noté, pas lancé). */
function charger(v: Valhalla) {
  const { document, body } = documentMinimal(), gestes: Array<{ action: string; input: Record<string, unknown> }> = [];
  const fetch = async (_u: string, o: { body: string }) => {
    const b = JSON.parse(o.body) as { module: string; action: string; input: Record<string, unknown> };
    const a = v.action(b.module, b.action)?.a;
    if (!a?.read && !['services', 'tableau', 'fiche', 'journal_direct'].includes(b.action)) { gestes.push({ action: b.action, input: b.input }); return { json: async () => ({ ok: true, text: 'noté' }) }; }
    const r = await v.act(b.module, b.action, b.input); return { json: async () => r };
  };
  const window: Record<string, unknown> = { OdinPages: {}, OdinDialog: { confirm: async () => true } };
  const ctx = vm.createContext({ window, document, fetch, Node: N, location: { hostname: 'odin.maison' }, setTimeout: (f: () => void, ms: number) => (ms >= 1000 ? 0 : setTimeout(f, ms)), clearTimeout, URL, Blob, console });
  vm.runInContext(SOURCE, ctx);
  const page = (window.OdinPages as Record<string, (o: unknown) => Promise<boolean>>).naglfar;
  const A = window.OdinArche as { MOTS: Record<string, string>; logique: Record<string, (...a: unknown[]) => unknown>; etat: Record<string, unknown> };
  const dessiner = async (nom = 'Arche') => { const host = new N('div'); body.append(host); const fait = await page({ host, generic: [], reload: () => {}, info: { name: nom } }); await new Promise((ok) => setTimeout(ok, 20)); return { host, fait }; };
  return { dessiner, A, gestes };
}

test('les mots de la page : en français simple, dans MOTS, sans nom de produit ; la logique du garde-fou', () => {
  const { A } = charger(odin());
  for (const [k, t] of Object.entries(A.MOTS)) assert.doesNotMatch(t, /docker|podman|portainer|kubernetes/i, k);
  assert.equal(A.MOTS.nom, 'Arche');
  const L = A.logique;
  assert.equal(L.peutEffacer('galerie-photos', 'galerie-photos'), true);
  for (const x of ['', 'Galerie-photos', 'galerie', 'galerie-photos2']) assert.equal(L.peutEffacer(x, 'galerie-photos'), false, x);
  assert.equal(L.peutEffacer('  galerie-photos ', 'galerie-photos'), true, 'les espaces autour ne comptent pas');
  assert.equal(L.octets(410 * 1024 ** 2), '410 Mo'); assert.equal(L.memTexte('1g'), '1 Go');
});

test('tableau de bord : le nom de l\'appli, les chiffres, ce qui tourne, les arrêtés, « Ouvrir » ; un nom ou une ligne est du texte', async () => {
  const v = odin();
  try {
    const { dessiner, A } = charger(v);
    const { host, fait } = await dessiner('Arche');
    assert.equal(fait, true);
    const t = host.textContent;
    for (const x of ['En marche', '1 / 2', 'Mémoire', 'Disque', '3,4 Go', 'Ce qui tourne', 'Arrêtés', 'galerie-photos', 'jeu-monde', 'Mises à jour connues']) assert.ok(t.includes(x), x);
    assert.equal(boutons(host, /^Ouvrir$/).length, 2); assert.equal(boutons(host, /^Démarrer$/).length, 1);
    // Ouvrir la fiche : le journal en direct, ses lignes comme du texte, le secret masqué.
    boutons(host, /^Ouvrir$/)[0].click();
    const f = await dessiner('Arche');
    const ft = f.host.textContent;
    for (const x of ['Journal en direct', 'Terminal', 'Réglages', 'Ressources', 'Redémarrer', 'Arrêter', 'Supprimer', 'http://odin.maison:2342', 'démarrage de la galerie']) assert.ok(ft.includes(x), x);
    assert.ok(ft.includes('<img src=x onerror=alert(1)>'), 'la ligne est écrite comme du texte');
    assert.equal(trouver(f.host, (n) => n.tagName === 'IMG').length, 0, 'aucune balise créée depuis une ligne du journal');
    assert.doesNotMatch(ft, /tres-secret-123/, 'secret masqué');
    // Réglages : la variable secrète masquée, l'autre lisible.
    A.etat.ftab = 'reglages';
    const r = (await dessiner()).host.textContent;
    assert.ok(r.includes('FUSEAU = UTC')); assert.ok(r.includes('MOT_DE_PASSE = ••••••')); assert.doesNotMatch(r, /tres-secret-123/);
  } finally { v.stop(); }
});

test('garde-fou : données gardées par défaut ; « Les supprimer aussi » demande le nom exact avant d\'activer le bouton', async () => {
  const v = odin();
  try {
    const { dessiner, A, gestes } = charger(v);
    Object.assign(A.etat, { fiche: 'galerie-photos', ftab: 'journal', supp: 'galerie-photos', suppData: false, suppTxt: '' });
    let { host } = await dessiner();
    assert.ok(host.textContent.includes('Supprimer le conteneur « galerie-photos » ?'));
    const garder = boutons(host, /Les garder \(conseillé\)/)[0];
    assert.equal(garder.getAttribute('aria-checked'), 'true', 'garder est choisi d\'office');
    boutons(host, /^Supprimer$/).find((b) => b.className.includes('danger-fill'))!.click();
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_fiche', input: { conteneur: 'galerie-photos', donnees: 'garder', nom_tape: '' } });
    // Les supprimer aussi : le bouton reste inactif tant que le nom n'est pas tapé à l'identique.
    Object.assign(A.etat, { fiche: 'galerie-photos', supp: 'galerie-photos', suppData: true, suppTxt: '' });
    ({ host } = await dessiner());
    const ok = boutons(host, /Supprimer avec ses données/)[0], champ = trouver(host, (n) => n.tagName === 'INPUT' && n.id === 'arkNom')[0];
    assert.ok(host.textContent.includes('Écris « galerie-photos » pour confirmer'));
    assert.equal(ok.disabled, true);
    for (const x of ['galerie', 'Galerie-photos']) { champ.value = x; for (const f of champ.listeners.input) f({}); assert.equal(ok.disabled, true, x); }
    const avant = gestes.length; ok.click(); await new Promise((r) => setTimeout(r, 20)); assert.equal(gestes.length, avant, 'rien envoyé sans le nom');
    champ.value = 'galerie-photos'; for (const f of champ.listeners.input) f({});
    assert.equal(ok.disabled, false);
    ok.click(); await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(gestes.at(-1), { action: 'supprimer_fiche', input: { conteneur: 'galerie-photos', donnees: 'effacer', nom_tape: 'galerie-photos' } });
  } finally { v.stop(); }
});

test('terminal : l\'avertissement, une commande à la fois par l\'action d\'Arche (avec confirmation)', async () => {
  const v = odin();
  try {
    const { dessiner, A, gestes } = charger(v);
    Object.assign(A.etat, { fiche: 'galerie-photos', ftab: 'terminal', supp: '' });
    const { host } = await dessiner();
    assert.ok(host.textContent.includes('Pas encore de terminal interactif : une commande à la fois'));
    const champ = trouver(host, (n) => n.tagName === 'INPUT' && /Commande à lancer/.test(n.getAttribute('aria-label') ?? ''))[0];
    champ.value = 'df -h'; boutons(host, /^Lancer$/)[0].click(); await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(gestes.at(-1), { action: 'terminal', input: { conteneur: 'galerie-photos', commande: 'df -h' } });
  } finally { v.stop(); }
});

test('Windows : la page dit clairement qu\'il n\'y a pas de moteur aujourd\'hui, et ce qui viendra (WSL2), sans planter', async () => {
  const v = odin('win32');
  try {
    const { dessiner, A } = charger(v);
    Object.assign(A.etat, { fiche: '', supp: '' });
    const { host, fait } = await dessiner();
    assert.equal(fait, true);
    const t = host.textContent;
    assert.ok(t.includes('Ce PC : Windows')); assert.ok(t.includes('ne marche que sous Linux')); assert.ok(t.includes('WSL2')); assert.ok(t.includes('rien ne plante'));
    assert.doesNotMatch(t, /docker|podman|portainer/i);
    assert.equal(boutons(host, /Ouvrir|Démarrer|Arrêter|Supprimer/).length, 0, 'aucun geste proposé sans moteur');
  } finally { v.stop(); }
});
