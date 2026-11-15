// Les liens du Cerveau comme des synapses, côté carte (src/web/pages/neurones.js) : épaisseur et éclat selon la force,
// texte au survol, influx rejoué par le moteur des échanges de graph.js, neurone allumé puis au repos, mises à jour en
// direct. Chargés hors navigateur, avec une horloge et un minuteur fournis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Fn = (...a: any[]) => any;
type Ech = { recevoir: Fn; actifs: Fn; dessiner: Fn };
const src = (p: string) => readFileSync(new URL(`../src/web/${p}`, import.meta.url), 'utf8');

/** graph.js puis neurones.js dans un même `window`, comme dans la page. */
function charger() {
  const window: Record<string, any> = {};
  runInNewContext(src('graph.js'), { window });
  runInNewContext(src('pages/neurones.js'), { window });
  return { G: window.OdinGraph as { moteurEchanges: (now: () => number) => Ech; echanges: Ech }, N: window.OdinNeurones as Record<string, any> };
}
/** Un faux canevas qui note les appels et les réglages. */
function faux() {
  const appels: Array<[string, any[]]> = [];
  const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : (...args: unknown[]) => { appels.push([k, args]); return { addColorStop: () => {} }; }), set: (o, k: string, v) => { o[k] = v; appels.push([`=${k}`, [v]]); return true; } });
  return { ctx, appels };
}
/** Un minuteur qu'on fait avancer à la main. */
function horloge() {
  let t = 0; const file: Array<{ at: number; fn: Fn }> = [];
  return {
    now: () => t,
    plusTard: (fn: Fn, ms: number) => { file.push({ at: t + ms, fn }); },
    avancer(ms: number) { const fin = t + ms; for (;;) { file.sort((a, b) => a.at - b.at); const x = file[0]; if (!x || x.at > fin) break; file.shift(); t = x.at; x.fn(); } t = fin; },
    get t() { return t; },
    file,
  };
}

test('neurones : épaisseur et éclat (monotones, base écrite = largeur 1, 4 groupes, arrondi à 0,05)', () => {
  const { N } = charger();
  assert.equal(N.BASE.ecrit, 0.30); assert.equal(N.BASE.usage, 0.35); assert.equal(N.BASE.appris, 0);
  assert.equal(N.APPRIS_VISIBLE, 0.15); assert.equal(N.REPOS_MS, 60000);
  assert.ok(Math.abs(N.style(0.30, 'ecrit').largeur - 1) < 1e-9);
  let avant = N.style(0, 'ecrit');
  for (let f = 0.01; f <= 1; f += 0.01) { const s = N.style(f, 'ecrit'); assert.ok(s.largeur >= avant.largeur && s.alpha >= avant.alpha && s.groupe >= avant.groupe, `monotone en ${f}`); avant = s; }
  assert.deepEqual([0.05, 0.25, 0.5, 0.9].map((f) => N.style(f).groupe), [0, 1, 2, 3]);
  assert.equal(N.style(0.32).largeur, N.style(0.30).largeur, 'arrondi à 0,05 : pas de scintillement');
  assert.equal(N.style(1).alpha, 1);
  assert.equal(N.style(0.4, 'appris').tiret, true); assert.equal(N.style(0.4, 'ecrit').tiret, false);
});

test('neurones : dessin des liens en peu de traits, pointillé seulement pour les appris, sans f comme avant', () => {
  const { N } = charger();
  const pt = (i: number) => ({ id: `n${i}`, x: i, y: i * 2 });
  const edges = Array.from({ length: 1000 }, (_, i) => {
    const appris = i % 3 === 0;
    return { from: `n${i}`, to: `n${i + 1}`, kind: appris ? 'appris' : 'lien', o: appris ? 'appris' : i % 2 ? 'usage' : 'ecrit', f: ((i * 37) % 100) / 100, n: 0, vu: 0, a: pt(i), b: pt(i + 1) };
  });
  const { ctx, appels } = faux();
  N.dessinerLiens(ctx, edges, { k: 1, lw: 0.7, link: 'rgba(170,174,182,.22)', linkHi: '#4CC38A' });
  assert.ok(appels.filter(([k]) => k === 'stroke').length <= 8, 'un trait par groupe et par style');
  assert.ok(appels.some(([k, a]) => k === 'setLineDash' && a[0].length === 2), 'pointillé des liens appris');
  assert.ok(appels.some(([k, a]) => k === '=strokeStyle' && a[0] === '#A78BFA'), 'violet');

  // Seulement des liens écrits : jamais de pointillé.
  const f2 = faux();
  N.dessinerLiens(f2.ctx, edges.filter((e) => e.kind === 'lien'), { k: 1, lw: 0.7, link: 'x' });
  assert.ok(!f2.appels.some(([k, a]) => k === 'setLineDash' && a[0].length === 2));

  // Une arête sans f (mention, dossier…) : la largeur et la couleur d'aujourd'hui.
  const f3 = faux();
  N.dessinerLiens(f3.ctx, [{ from: 'a', to: 'b', kind: 'mention', a: pt(0), b: pt(1) }], { k: 2, lw: 0.35, alpha: 1, link: 'rgba(170,174,182,.22)' });
  assert.deepEqual(f3.appels.filter(([k]) => k === 'stroke').length, 1);
  assert.ok(f3.appels.some(([k, a]) => k === '=lineWidth' && a[0] === 0.35));
  assert.ok(f3.appels.some(([k, a]) => k === '=strokeStyle' && a[0] === 'rgba(170,174,182,.22)'));
  assert.ok(!f3.appels.some(([k]) => k === 'setLineDash'));

  // Tous les styles à la fois (freins, sans f, survol) : le nombre de traits ne dépend pas du nombre d'arêtes.
  const tous = [...edges, { from: 'n1', to: 'n2', kind: 'frein', fr: 'remplace', a: pt(1), b: pt(2) }, { from: 'n1', to: 'n3', kind: 'mention', a: pt(1), b: pt(3) }];
  const f4 = faux();
  N.dessinerLiens(f4.ctx, tous, { k: 1, lw: 0.7, link: 'x', linkHi: 'y', hover: edges[5].a });
  assert.ok(f4.appels.filter(([k]) => k === 'stroke').length <= 11);
  assert.ok(f4.appels.some(([k, a]) => k === '=strokeStyle' && a[0] === '#C0504D'), 'frein rouge');
});

test('neurones : texte au survol d\'un lien (chaînes exactes)', () => {
  const { N } = charger();
  const J = 24 * 3600e3, now = 100 * J;
  const noms = new Map([['Projets/Maison.md', 'Maison'], ['Notes/Toit.md', 'Toit'], ['Odin/Applis/Arche.md', 'Arche'], ['Odin/Applis/Phénix.md', 'Phénix']]);
  assert.equal(N.texteLien({ from: 'Projets/Maison.md', to: 'Notes/Toit.md', kind: 'lien', f: 0.30, o: 'ecrit', n: 0, vu: 0 }, noms, now),
    'Lien écrit par toi dans [[Maison]] · force 0,30 (de base) · jamais servi');
  assert.equal(N.texteLien({ from: 'Projets/Maison.md', to: 'Notes/Toit.md', kind: 'appris', f: 0.45, o: 'appris', n: 4, vu: now - 20 * J }, noms, now),
    'Lien appris par Odin : utilisés ensemble dans 4 réponses · force 0,45 · servi 4 fois, dernière il y a 20 j, s\'efface');
  assert.equal(N.texteLien({ from: 'Notes/Toit.md', to: 'Projets/Maison.md', kind: 'frein', fr: 'remplace' }, noms, now),
    'Freine : [[Toit]] remplace [[Maison]]');
  assert.equal(N.texteLien({ from: 'Odin/Applis/Phénix.md', to: 'Odin/Applis/Arche.md', kind: 'lien', f: 0.52, o: 'usage', n: 3, vu: now - 2 * 3600e3 }, noms, now),
    'Lien entre applis, déclaré dans Odin · force 0,52 · servi 3 fois, dernière il y a 2 h, se renforce');
  assert.equal(N.texteLien({ from: 'a', to: 'b', kind: 'appris', f: 0.2, o: 'appris', n: 1, vu: now - 60e3 }, (id: string) => id.toUpperCase(), now),
    'Lien appris par Odin : utilisés ensemble dans 1 réponse · force 0,20 · servi 1 fois, dernière il y a moins d\'une heure, se renforce');
});

test('neurones : l\'influx rejoue seulement les paires absentes des étapes, avec ses délais et son intensité', () => {
  const { G, N } = charger();
  const h = horloge(), ech = G.moteurEchanges(h.now), recus: any[] = [];
  const espion = { ...ech, recevoir: (e: any) => { recus.push({ e, t: h.t }); ech.recevoir(e); } };
  const M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: espion, reduit: false });
  const etapes = [{ de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', libelle: 'note' }];
  const influx = [
    { de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', a: 1, saut: 0, f: 0, o: 'odin', entre: true },
    { de: 'odin', vers: 'sindri', deNom: 'Odin', versNom: 'Phénix', a: 0.8, saut: 0, f: 0, o: 'odin', entre: true },
    { de: 'Notes/A.md', vers: 'Notes/B.md', deNom: 'A', versNom: 'B', a: 0.4, saut: 1, f: 0.5, o: 'ecrit', entre: true },
    { de: 'Notes/A.md', vers: 'Notes/C.md', deNom: 'A', versNom: 'C', a: 0.3, saut: 1, f: 0.4, o: 'appris', entre: false },
    { de: 'm:toit', vers: 'Notes/D.md', deNom: 'toit', versNom: 'D', a: 0.5, saut: 1, f: 0.5, o: 'appris', entre: false },
    { de: 'odin', vers: 's:42', deNom: 'Odin', versNom: 'souvenir', a: 0.9, saut: 0, f: 0, o: 'odin', entre: true },
  ];
  assert.equal(M.influx(influx, etapes), 3);
  h.avancer(5000);
  assert.deepEqual(recus.map((x) => [x.e.de, x.e.vers, x.t, x.e.a]), [
    ['odin', 'sindri', 600 + 120, 0.8], // saut 0, rang 1 (A est rang 0, déjà une étape)
    ['Notes/A.md', 'Notes/B.md', 600 + 450, 0.4],
    ['Notes/A.md', 'Notes/C.md', 600 + 450 + 120, 0.3],
  ]);
  for (const { e } of recus) { assert.equal(e.libelle, 'influx'); assert.equal(e.action, 'propager'); assert.equal(e.phase, 'demande'); assert.equal(e.ok, true); }
  assert.ok(!JSON.stringify(recus).includes('m:') && !JSON.stringify(recus).includes('s:42'), 'jamais de mot ni de souvenir');
  assert.equal(M.etatPoint('Notes/D.md', h.t).repos, false);

  // 40 entrées au plus ; délai plafonné à 3 s.
  const h2 = horloge(), recus2: number[] = [];
  const M2 = N.moteurNeurones({ now: h2.now, plusTard: h2.plusTard, echanges: { recevoir: () => recus2.push(h2.t) }, reduit: false });
  const beaucoup = Array.from({ length: 60 }, (_, i) => ({ de: 'Notes/A.md', vers: `Notes/x${String(i).padStart(2, '0')}.md`, deNom: 'A', versNom: `x${i}`, a: 0.5, saut: 2, f: 0.3, o: 'ecrit', entre: false }));
  assert.equal(M2.influx(beaucoup, []), 40);
  h2.avancer(10_000);
  assert.equal(recus2.length, 40); assert.equal(Math.max(...recus2), 3000);
  assert.equal(M2.influx(undefined, []), 0, 'influx absent : rien');

  // Dans graph.js, l'intensité est gardée (au plus fort) et rendue par actifs().
  const h3 = horloge(), e3 = G.moteurEchanges(h3.now);
  e3.recevoir({ de: 'odin', vers: 'x', phase: 'demande', a: 0.25 });
  assert.equal(e3.actifs()[0].a, 0.25);
  e3.recevoir({ de: 'odin', vers: 'x', phase: 'demande', a: 0.1 });
  assert.equal(e3.actifs()[0].a, 0.25);
  e3.recevoir({ de: 'odin', vers: 'y', phase: 'demande' });
  assert.equal(e3.actifs().find((l: any) => l.vers === 'y').a, 1, 'sans a : pleine intensité');
});

test('neurones : un point s\'allume puis se repose (et en mouvement réduit, halo fixe)', () => {
  const { N } = charger();
  for (const reduit of [false, true]) {
    const h = horloge(), M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit });
    M.influx([{ de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', a: 0.7, saut: 0, f: 0, o: 'odin', entre: true }], []);
    h.avancer(600); const t0 = h.t;
    assert.equal(M.etatPoint('Notes/A.md', t0).halo, 0.7);
    assert.deepEqual({ ...M.etatPoint('odin', t0) }, { halo: 0, repos: false }, 'Odin n\'est pas un point du Cerveau : ni halo ni repos');
    if (!reduit) {
      assert.ok(Math.abs(M.etatPoint('Notes/A.md', t0 + 600).halo - 0.35) < 1e-9);
      assert.equal(M.etatPoint('Notes/A.md', t0 + 1200).halo, 0);
    } else {
      assert.equal(M.etatPoint('Notes/A.md', t0 + 3400).halo, 0.7, 'fixe, sans fondu');
      assert.equal(M.etatPoint('Notes/A.md', t0 + 3500).halo, 0);
    }
    assert.equal(M.etatPoint('Notes/A.md', t0 + 30_000).repos, true);
    assert.equal(M.etatPoint('Notes/A.md', t0 + 59_999).repos, true);
    assert.equal(M.etatPoint('Notes/A.md', t0 + 60_000).repos, false);
    assert.deepEqual({ ...M.etatPoint('inconnu', t0) }, { halo: 0, repos: false });
  }
  // Dessin : halo d'abord (vert d'accent), puis anneau gris au repos ; une carte branchée est redessinée, puis plus.
  const h = horloge(), M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit: false });
  let dessins = 0; M.brancher(() => { dessins++; }, () => true);
  M.influx([{ de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', a: 1, saut: 0, f: 0, o: 'odin', entre: true }], []);
  h.avancer(600 + 1200);
  assert.ok(dessins >= 10 && dessins <= Math.ceil(1200 / 33) + 3, `30 images par seconde au plus pendant le halo (${dessins})`);
  const pendant = dessins; h.avancer(30_000); assert.ok(dessins - pendant <= 1, 'rien pendant le repos (au plus l\'image qui efface le halo)');
  const milieu = dessins; h.avancer(31_000); assert.equal(dessins - milieu, 1, 'une fois à la fin du repos');
  h.avancer(120_000); assert.equal(dessins - milieu, 1, 'puis plus rien');
  const { ctx, appels } = faux();
  const M2 = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit: false });
  M2.influx([{ de: 'odin', vers: 'Notes/A.md', deNom: 'Odin', versNom: 'A', a: 1, saut: 0, f: 0, o: 'odin', entre: true }], []);
  h.avancer(600);
  M2.dessinerPoints(ctx, { k: 1, noeud: (id: string) => (id === 'Notes/A.md' ? { x: 5, y: 5, r: 3 } : null) });
  assert.ok(appels.some(([k, a]) => k === '=fillStyle' && a[0] === '#4CC38A') && appels.some(([k]) => k === 'fill'));
  appels.length = 0;
  M2.dessinerPoints(ctx, { k: 1, t: h.t + 5000, noeud: (id: string) => (id === 'Notes/A.md' ? { x: 5, y: 5, r: 3 } : null) });
  assert.ok(appels.some(([k]) => k === 'stroke') && !appels.some(([k]) => k === 'fill'), 'anneau de repos seulement');
});

test('neurones : mises à jour en direct des liens, et lien sous le pointeur', () => {
  const { N } = charger();
  const h = horloge(), M = N.moteurNeurones({ now: h.now, plusTard: h.plusTard, echanges: { recevoir: () => {} }, reduit: false });
  const A = { id: 'Notes/A.md', title: 'A', x: 0, y: 0 }, B = { id: 'Notes/B.md', title: 'B', x: 100, y: 0 }, C = { id: 'Odin/Applis/Phénix.md', title: 'Phénix', x: 0, y: 100 };
  const byId = new Map([[A.id, A], [B.id, B], [C.id, C]]), fiches = new Map([['Phénix', C]]);
  const edges: any[] = [{ from: A.id, to: B.id, kind: 'lien', f: 0.3, o: 'ecrit', n: 0, vu: 0, a: A, b: B }];
  let dessins = 0;
  M.brancher(() => { dessins++; }, () => true, { edges, noeud: (id: string, nom: string) => fiches.get(nom) || byId.get(id), actif: () => true });
  const n = M.liens([
    { de: B.id, vers: A.id, deNom: 'B', versNom: 'A', f: 0.42, o: 'ecrit', n: 2, vu: 1234 }, // sens inverse : même lien
    { de: 'sindri', vers: A.id, deNom: 'Phénix', versNom: 'A', f: 0.1, o: 'appris', n: 1, vu: 5 }, // trop faible : pas d'arête
    { de: 'sindri', vers: B.id, deNom: 'Phénix', versNom: 'B', f: 0.2, o: 'appris', n: 3, vu: 6 }, // nouvelle arête apprise
    { de: 'Notes/Absente.md', vers: B.id, deNom: 'X', versNom: 'B', f: 0.9, o: 'appris', n: 3, vu: 6 }, // nœud absent
    { de: 'm:toit', vers: B.id, deNom: 'toit', versNom: 'B', f: 0.9, o: 'appris', n: 3, vu: 6 }, // jamais un mot
  ]);
  assert.equal(n, 2);
  assert.equal(edges[0].f, 0.42); assert.equal(edges[0].n, 2); assert.equal(edges[0].vu, 1234);
  assert.equal(edges.length, 2);
  assert.equal(edges[1].kind, 'appris'); assert.equal(edges[1].from, C.id); assert.equal(edges[1].to, B.id); assert.equal(edges[1].a, C);
  assert.equal(dessins, 1, 'redessiné une fois');
  assert.equal(M.liens(null), 0);

  // Le lien sous le pointeur : à moins de 5/k, et rien au-delà.
  assert.equal(N.pickLien(edges, { x: 50, y: 4 }, 1), edges[0]);
  assert.equal(N.pickLien(edges, { x: 50, y: 6 }, 1), null);
  assert.equal(N.pickLien(edges, { x: 50, y: 2 }, 2), edges[0]);
  assert.equal(N.pickLien(edges, { x: 50, y: 3 }, 2), null);
  assert.equal(N.pickLien([{ from: 'a', to: 'b', kind: 'mention', a: A, b: B }], { x: 50, y: 0 }, 1), null, 'un lien sans force n\'a pas de survol');
});

test('graph.js : sans `a`, le trait blanc garde sa largeur ; avec a = 0,25 il est plus fin', () => {
  const { G } = charger();
  const pos: Record<string, { id: string; x: number; y: number; r: number }> = { sindri: { id: 'sindri', x: 0, y: 0, r: 10 }, arche: { id: 'arche', x: 200, y: 0, r: 10 } };
  const largeurs = (a?: number, k = 2) => {
    let t = 0; const m = G.moteurEchanges(() => t), { ctx, appels } = faux();
    m.recevoir({ de: 'sindri', vers: 'arche', phase: 'demande', ...(a === undefined ? {} : { a }) }); t = 300;
    m.dessiner(ctx, { k, noeud: (id: string) => pos[id], relies: () => true });
    return { lw: appels.filter(([c]) => c === '=lineWidth').map(([, v]) => v[0]), arcs: appels.filter(([c]) => c === 'arc').map(([, v]) => v[2]) };
  };
  const sans = largeurs();
  assert.deepEqual(sans.lw, [4.4 / 2, 2.2 / 2, 2 / 2, 4 / 2], 'exactement comme avant');
  assert.ok(sans.arcs.includes(4.2 / 2), 'tête de comète d\'avant');
  const faible = largeurs(0.25);
  assert.ok(faible.lw.includes(2.2 * 0.7 / 2));
  assert.ok(faible.arcs.includes(4.2 * 0.7 / 2));
});

test('neurones : lecture des sources (pas de hasard, pas de fenêtre native, chaînes figées, valhalla.js intact)', () => {
  const neu = src('pages/neurones.js'), ui = src('ui.html'), brain = src('brain.js');
  assert.ok(!/Math\.random/.test(neu));
  assert.ok(!/(^|[^.\w])confirm\(/.test(neu), 'OdinDialog.confirm, jamais confirm()');
  assert.ok(!/(^|[^.\w])confirm\(/.test(brain.split('\n').filter((l) => /oublier|Oublier/.test(l)).join('\n')));
  assert.ok(!/Math\.random/.test(brain.split('\n').filter((l) => /NEU/.test(l)).join('\n')));
  // Chaînes que test/reponses-odin.test.ts fige.
  assert.match(ui, /d\.event\.type === 'consulte'\) consulte\(d\.event\.etapes\)/);
  assert.match(ui, /E\.recevoir\(\{ \.\.\.e, action: 'consulter', phase: 'demande'/);
  assert.match(brain, /if \(id === 'odin'\) return \{ id: 'odin', x: 0, y: 0, r: 0 \}/);
  assert.match(brain, /fichesApplis\.get\(nom\) \|\| byId\.get\(id\)/);
  // Branchements.
  assert.match(ui, /window\.OdinNeurones\?\.influx\(d\.event\.influx, d\.event\.etapes\)/);
  assert.match(ui, /window\.OdinNeurones\?\.liens\(d\.event\.changes\)/);
  assert.match(brain, /api\('\/api\/brain\/graph\?forces=1'\)/);
  assert.match(brain, /tog\('forces', 'Montrer la force des liens'\)/);
  assert.ok(!/OdinNeurones|neurones/.test(src('valhalla.js')), 'le graphe des applis ne change pas');
  // Chargé seul, sans document ni matchMedia au chargement.
  assert.doesNotThrow(() => runInNewContext(neu, { window: {} }));
});
