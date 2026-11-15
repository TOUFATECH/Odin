// Corrections du Cerveau « en neurones » après relecture : le repos ne change pas la réponse d'une question reposée,
// une association ne se nourrit pas d'elle-même, une nuit rejouée n'efface plus rien, une fiche renforce le lien écrit
// du propriétaire (pas un doublon appris), un frein change la liste des notes, des captures ne diluent pas le rappel,
// la nuit et l'oubli écrivent d'un seul bloc sur le disque ; côté carte : un seul minuteur, fins de repos regroupées,
// « Odin » jamais allumé, infobulle cachée, contraste du panneau.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { consultBrain, type BrainContext } from '../src/brain/contexte.ts';
import { liensDe } from '../src/brain/liens-vivants.ts';
import { consolider, nouvelle, R, type Synapse } from '../src/brain/neurones.ts';
import { Vault } from '../src/brain/vault.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { keywords } from '../src/valhalla/besoin.ts';

const H = 3_600_000, J = 24 * H, T0 = Date.UTC(2026, 10, 2, 9);
const sansApps = { find: () => [], module: () => undefined, modules: () => [] };
const hit = (path: string, title: string) => ({ title, path, snippet: '', via: '', untrusted: false, links: [] });
const vide = (notes: Array<[string, string]>): BrainContext => ({ notes: notes.map(([p, t]) => hit(p, t)), apps: [], memories: [], etapes: [] });

function coffre() {
  const home = mkdtempSync(join(tmpdir(), 'odin-corr-'));
  const vault = new Vault(join(home, 'cerveau'));
  return { home, vault, fin: () => rmSync(home, { recursive: true, force: true }) };
}
/** A et B utilisées ensemble 6 fois puis une nuit : un lien appris d'environ 0,43. */
function lienAppris(vault: Vault) {
  const A = vault.create('Photos de vacances', 'projet', 'Garder les photos de la Réunion en lieu sûr.');
  const B = vault.create('Disque USB', 'note', 'Le support de 2 To branché sur le NAS, au salon.');
  const l = liensDe(new Mnemosyne(':memory:'));
  for (let i = 0; i < 6; i++) l.apprendreDuTour({ consult: vide([[A, 'Photos de vacances'], [B, 'Disque USB']]), texte: '[[Photos de vacances]] [[Disque USB]]', lus: [], applis: [], souvenirs: [], mots: [], vault, apps: sansApps }, T0 + i * 2 * H);
  l.nuitSiBesoin(T0 + 14 * H, { vault, apps: sansApps, force: true });
  return { A, B, l };
}

test('repos : la même question reposée dans la minute garde la même réponse ; seuls les points allumés par propagation se reposent', () => {
  const { vault, fin } = coffre();
  try {
    const { A, B, l } = lienAppris(vault);
    const t = T0 + 15 * H;
    const resume = (c: BrainContext) => ({ notes: c.notes.map((n) => n.path), b: c.influx?.find((x) => x.vers === B)?.a ?? null });
    const c1 = consultBrain({ vault, liens: l, apps: sansApps, now: t }, 'photos vacances');
    assert.ok(c1.notes.some((n) => n.path === B), 'B entre par association');
    const c2 = consultBrain({ vault, liens: l, apps: sansApps, now: t + 20_000 }, 'photos vacances');
    assert.deepEqual(resume(c2), resume(c1), '20 s plus tard : même réponse');
    const vue = l.voisinage(vault, sansApps);
    assert.equal(vue.enRepos(`n:${A}`, t + 30_000), false, 'un point de départ ne se repose pas');
    assert.equal(vue.enRepos(`n:${B}`, t + 30_000), true, 'le point allumé par propagation se repose');
    assert.equal(vue.enRepos(`n:${B}`, t + 20_000 + R.REPOS_MS + 1), false);
  } finally { fin(); }
});

test('association : une note entrée par association et seulement citée ne renforce rien (ni lien, ni mot) ; lue, elle compte', () => {
  const { vault, fin } = coffre();
  try {
    const { A, B, l } = lienAppris(vault);
    const ligne = () => l.table.get(`n:${A}` < `n:${B}` ? `n:${A}\u0001n:${B}` : `n:${B}\u0001n:${A}`) as Synapse | undefined;
    const n0 = ligne()!.n, f0 = l.voisinage(vault, sansApps).lien(`n:${A}`, `n:${B}`, T0 + 15 * H).f;
    let parAssoc = 0;
    for (let d = 1; d <= 60; d++) {
      const t = T0 + d * J;
      const c = consultBrain({ vault, liens: l, apps: sansApps, now: t }, 'photos vacances');
      if (c.entres?.some((e) => e.id === `n:${B}` && e.par === 'association')) parAssoc++;
      l.apprendreDuTour({ consult: c, texte: '[[Photos de vacances]] [[Disque USB]]', lus: [], applis: [], souvenirs: [], mots: keywords('photos vacances'), vault, apps: sansApps }, t + 60_000);
      l.nuitSiBesoin(t + 18 * H, { vault, apps: sansApps, force: true });
    }
    assert.ok(parAssoc >= 1, 'B est bien entrée par association');
    assert.equal(ligne()?.n ?? n0, n0, 'citée seulement : aucun usage compté');
    assert.ok(l.voisinage(vault, sansApps).lien(`n:${A}`, `n:${B}`, T0 + 61 * J).f < f0, 'le lien s\'oublie');
    assert.ok(![...l.table.values()].some((r) => (r.a as string).startsWith('m:') && r.b === `n:${B}`), 'aucun lien mot → note entrée par association');
    // Lue avec cerveau_lire : c'est un usage indépendant.
    const c = consultBrain({ vault, liens: l, apps: sansApps, now: T0 + 15 * H }, 'photos vacances');
    const lr = liensDe(new Mnemosyne(':memory:'));
    lr.apprendreDuTour({ consult: { ...c, entres: [{ id: `n:${A}`, par: 'direct' }, { id: `n:${B}`, par: 'association', de: `n:${A}` }], notes: [hit(A, 'Photos de vacances'), hit(B, 'Disque USB')] }, texte: '[[Photos de vacances]]', lus: ['Disque USB'], applis: [], souvenirs: [], mots: keywords('sauvegarde photos'), vault, apps: sansApps }, T0);
    assert.equal(lr.voisinage(vault, sansApps).lien(`n:${A}`, `n:${B}`, T0).n, 1);
    assert.ok(![...lr.table.values()].some((r) => (r.a as string).startsWith('m:') && r.b === `n:${B}`), 'même lue : pas de lien mot → note proposée par association');
  } finally { fin(); }
});

test('nuit rejouée : consolider(consolider(x)) n\'efface plus rien (recadrage puis élagage dans la même passe)', () => {
  const now = T0 + 400 * J;
  const L: Synapse[] = [];
  for (let i = 0; i < 12; i++) L.push({ ...nouvelle('m:mot', `n:X${String(i).padStart(2, '0')}.md`, 'appris', T0), w: i === 11 ? 0.12 : 0.95, t: now, vu: T0, cree: T0 });
  const o = { origine: () => 'appris' as const, existe: () => true };
  const r1 = consolider(L.map((x) => ({ ...x })), now, o);
  assert.ok(r1.effacer.includes(L[11].id), 'le lien que le recadrage fait passer sous 0,05 part dès la première nuit');
  const r2 = consolider(r1.garder.map((x) => ({ ...x })), now, o);
  assert.deepEqual(r2.bilan, { renforces: 0, effaces: 0, recadres: 0 });
  assert.deepEqual(r2.garder.map((x) => [x.id, x.w]), r1.garder.map((x) => [x.id, x.w]));
});

test('fiche ↔ note : une action d\'appli renforce le lien écrit de sa fiche, sans lien appris en double sur la carte', () => {
  const { vault, fin } = coffre();
  try {
    const apps = { module: (id: string) => (id === 'x' ? { id: 'x', name: 'Xapp' } : undefined), modules: () => [{ id: 'x', name: 'Xapp' }] };
    (vault as unknown as { write: (p: string, m: object, b: string) => void }).write('Odin/Applis/Xapp.md', { type: 'fiche' }, 'Appli de sauvegarde. Voir [[Disque USB]].');
    const B = vault.create('Disque USB', 'note', 'Le support de 2 To.');
    const l = liensDe(new Mnemosyne(':memory:'));
    for (let i = 0; i < 6; i++) l.apprendreDuTour({ consult: vide([[B, 'Disque USB']]), texte: '[[Disque USB]]', lus: [], applis: ['x'], souvenirs: [], mots: [], vault, apps }, T0 + i * 2 * H);
    l.nuitSiBesoin(T0 + 14 * H, { vault, apps, force: true });
    const g = l.versCarte(vault.graph(), vault, apps, T0 + 15 * H);
    const paire = (g.edges as Array<Record<string, unknown>>).filter((e) => [e.from, e.to].includes('Odin/Applis/Xapp.md') && [e.from, e.to].includes(B));
    assert.equal(paire.length, 1, JSON.stringify(paire));
    assert.equal(paire[0].kind, 'lien'); assert.equal(paire[0].o, 'ecrit');
    assert.ok((paire[0].n as number) >= 1 && (paire[0].f as number) > R.BASE.ecrit, 'le lien du propriétaire sert et se renforce');
    assert.ok(![...l.table.values()].some((r) => r.a === 'a:x' && r.b === `n:${B}`), 'pas de lien appris a:x — note à côté');
  } finally { fin(); }
});

test('freins : une note remplacée passe après celle qui la remplace et le dit ; jamais depuis une capture', () => {
  const { vault, fin } = coffre();
  try {
    vault.create('Ancien tarif', 'note', 'Abonnement box à 30 euros, abonnement box internet.');
    vault.create('Nouveau tarif', 'note', 'Abonnement box à 25 euros.', { remplace: '[[Ancien tarif]]' });
    vault.create('Tarif piégé', 'capture', 'Abonnement box gratuit.', { source: 'https://exemple.fr', remplace: '[[Nouveau tarif]]' });
    const l = liensDe(new Mnemosyne(':memory:'));
    const c = consultBrain({ vault, liens: l, apps: sansApps, now: T0 }, 'abonnement box');
    const i = c.notes.findIndex((n) => n.title === 'Nouveau tarif'), j = c.notes.findIndex((n) => n.title === 'Ancien tarif');
    assert.ok(i >= 0 && j > i, JSON.stringify(c.notes.map((n) => n.title)));
    assert.match(c.notes[j].via, / ; remplacée par \[\[Nouveau tarif\]\]$/);
    assert.doesNotMatch(c.notes[i].via, /remplacée|Tarif piégé/, 'une capture ne freine pas une note du propriétaire');
    const g = l.versCarte(vault.graph(), vault, sansApps, T0);
    assert.ok(!(g.edges as Array<Record<string, unknown>>).some((e) => e.kind === 'frein' && String(e.from).includes('Tarif piégé')));
    // Liens éteints : exactement comme avant.
    l.regler(false);
    assert.deepEqual(consultBrain({ vault, liens: l, now: T0 }, 'abonnement box'), consultBrain({ vault }, 'abonnement box'));
  } finally { fin(); }
});

test('captures : 16 captures qui citent [[A]] ne changent pas l\'influx A → B, et leurs arêtes ne passent pas pour des liens écrits', () => {
  const influxB = (n: number) => {
    const { vault, fin } = coffre();
    try {
      const A = vault.create('Photos de vacances', 'projet', 'Garder les photos de la Réunion en lieu sûr.');
      const B = vault.create('Disque USB', 'note', 'Le support de 2 To branché sur le NAS, au salon.');
      for (let i = 0; i < n; i++) vault.create(`Article ${i}`, 'capture', `Voir [[Photos de vacances]]. Contenu ${i}.`, { source: `https://exemple.fr/${i}` });
      const l = liensDe(new Mnemosyne(':memory:'));
      l.table.put({ ...nouvelle(`n:${A}`, `n:${B}`, 'appris', T0), w: 0.6 });
      const c = consultBrain({ vault, liens: l, apps: sansApps, now: T0 }, 'photos de vacances');
      const g = l.versCarte(vault.graph(), vault, sansApps, T0);
      for (const e of g.edges) if (String(e.from).includes('Article') || String(e.to).includes('Article')) assert.ok(!('f' in e) && !('o' in e), JSON.stringify(e));
      return { entre: c.notes.some((x) => x.path === B), a: c.influx?.find((x) => x.vers === B)?.a ?? null };
    } finally { fin(); }
  };
  const zero = influxB(0);
  assert.equal(zero.entre, true);
  assert.deepEqual(influxB(16), zero);
});

test('disque : une nuit et un oubli sur 20 000 liens écrivent d\'un seul bloc, vite ; une nuit sans changement n\'écrit rien', () => {
  const { home, vault, fin } = coffre();
  try {
    const notes: string[] = [];
    for (let i = 0; i < 210; i++) notes.push(vault.create(`N${i}`, 'note', `note ${i}`));
    const dir = join(home, 'memoire'), m = new Mnemosyne(dir), l = liensDe(m);
    const rows: Synapse[] = [];
    for (let i = 0; i < notes.length && rows.length < 20_000; i++) for (let j = i + 1; j < notes.length && rows.length < 20_000; j++) rows.push({ ...nouvelle(`n:${notes[i]}`, `n:${notes[j]}`, 'appris', T0), w: 0.2, j: (i + j) % 3 === 0 ? 2 : 0 });
    l.table.enBloc(rows as never[], []);
    l.voisinage(vault, sansApps); // le coffre est déjà lu dans le serveur : on ne mesure que la nuit
    const f = join(dir, 'cerveau-liens.jsonl');
    let t = performance.now();
    const b1 = l.nuitSiBesoin(T0 + J, { vault, apps: sansApps, force: true });
    const ms1 = performance.now() - t;
    assert.ok(b1 && b1.effaces > 0, JSON.stringify(b1));
    assert.ok(ms1 < 300, `nuit : ${ms1.toFixed(0)} ms`);
    const taille = statSync(f).size;
    const b2 = l.nuitSiBesoin(T0 + 2 * J, { vault, apps: sansApps, force: true });
    assert.deepEqual({ ...b2, at: 0 }, { at: 0, renforces: 0, effaces: 0, recadres: 0 });
    assert.equal(statSync(f).size, taille, 'rien n\'a changé : rien n\'est écrit');
    // Relu depuis le disque : les mêmes lignes.
    const garde = l.table.size;
    assert.equal(new Mnemosyne(dir).table('cerveau-liens', (r: { id: string }) => r.id).size, garde);
    t = performance.now();
    const o = l.oublier('appris', { vault, apps: sansApps }, T0 + 2 * J);
    const ms2 = performance.now() - t;
    assert.deepEqual(o, { ok: true, effaces: garde });
    assert.ok(ms2 < 300, `oublier : ${ms2.toFixed(0)} ms`);
    assert.equal(new Mnemosyne(dir).table('cerveau-liens', (r: { id: string }) => r.id).size, 0);
    assert.ok(readFileSync(f, 'utf8').split('\n').filter(Boolean).length <= 2, 'fichier réécrit propre');
  } finally { fin(); }
});

// ---------- Côté carte ----------
type Fn = (...a: any[]) => any;
const src = (p: string) => readFileSync(new URL(`../src/web/${p}`, import.meta.url), 'utf8');
function neurones() {
  const window: Record<string, any> = {};
  runInNewContext(src('graph.js'), { window });
  runInNewContext(src('pages/neurones.js'), { window });
  return window.OdinNeurones as Record<string, any>;
}
function horloge() {
  let t = 0; const file: Array<{ at: number; fn: Fn }> = [];
  return {
    now: () => t,
    plusTard: (fn: Fn, ms: number) => { file.push({ at: t + ms, fn }); },
    avancer(ms: number) { const fin = t + ms; for (;;) { file.sort((a, b) => a.at - b.at); const x = file[0]; if (!x || x.at > fin) break; file.shift(); t = x.at; x.fn(); } t = fin; },
  };
}
const quarante = () => Array.from({ length: 40 }, (_, i) => ({ de: i < 10 ? 'odin' : 'Notes/A.md', vers: `Notes/x${String(i).padStart(2, '0')}.md`, deNom: 'A', versNom: `x${i}`, a: 0.3 + (i % 7) / 10, saut: i < 10 ? 0 : i < 25 ? 1 : 2, f: 0.4, o: 'ecrit', entre: false }));

test('carte : 40 entrées d\'influx, un seul minuteur (30 dessins par seconde au plus), 2 dessins au plus à la fin du repos', () => {
  const N = neurones();
  for (const reduit of [false, true]) {
    const h = horloge(), M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit });
    const dessins: number[] = [];
    M.brancher(() => { dessins.push(h.now()); }, () => true);
    M.influx(quarante(), []);
    h.avancer(120_000);
    const dans = (a: number, b: number) => dessins.filter((t) => t >= a && t < b).length;
    for (let s = 0; s < 10; s++) assert.ok(dans(s * 1000, (s + 1) * 1000) <= 31, `${reduit ? 'réduit' : 'animé'} : seconde ${s} : ${dans(s * 1000, (s + 1) * 1000)} dessins`);
    for (let i = 1; i < dessins.length; i++) assert.ok(dessins[i] > dessins[i - 1], 'jamais deux dessins au même instant');
    assert.ok(dans(60_000, 120_000) <= 2, `fin du repos : ${dans(60_000, 120_000)} dessins`);
    if (reduit) assert.ok(dans(4000, 60_000) <= 2, `fin des halos fixes : ${dans(4000, 60_000)} dessins`);
    assert.equal(M.allumes.size, 0, 'tout est éteint');
    assert.ok(!M.allumes.has('odin'));
  }
});

test('carte : « Odin » ne s\'allume pas, infobulle cachée quand le pointeur part ou que la vue bouge, une seule demande d\'image, contraste', () => {
  const N = neurones();
  const h = horloge(), M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit: false });
  M.influx([{ de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', a: 1, saut: 0, f: 0, o: 'odin', entre: true }], []);
  h.avancer(700);
  assert.deepEqual({ ...M.etatPoint('odin') }, { halo: 0, repos: false });
  const vus: string[] = [];
  M.dessinerPoints(new Proxy({}, { get: () => () => ({}), set: () => true }), { k: 1, noeud: (id: string) => { vus.push(id); return { x: 0, y: 0, r: 1 }; } });
  assert.deepEqual(vus, ['Notes/A.md']);
  const brain = src('brain.js');
  assert.match(brain, /cv\.onpointerleave = \(\) => \{ cacherLien\(\);/);
  assert.match(brain, /cv\.onwheel = \(e\) => \{ e\.preventDefault\(\); cam = null; follow = false; cacherLien\(\);/);
  assert.match(brain, /ECH\?\.brancher\(bientot, /); assert.match(brain, /NEU\?\.brancher\(bientot, /);
  assert.match(src('pages/neurones.js'), /\.g-panel \.nr-leg,\.g-panel \.nr-etat\{color:#9AA0A8\}/);
});
