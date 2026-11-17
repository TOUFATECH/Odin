// Soul plus rapide sur le processeur : le calcul accéléré de Noûs (src/brain/nous/calcul.ts + wasm.ts) donne les MÊMES
// résultats que l'ancien calcul, au bruit des nombres à virgule près.
//
// La référence est une copie figée du calcul d'avant le chantier (test/rapidite/reference/, commit eeea63e7 : produits
// ligne à ligne, attention en boucles, perte à deux passes d'exponentielles, poids recopiés à chaque produit). On
// compare, sur plusieurs graines et deux gabarits (petit et moyen, contexte 128, vocabulaire 4096), pour CHAQUE noyau
// que la machine sait faire (« fma » : blocs avec multiplication-addition fusionnée ; « bloc » : sans fusion ;
// « ancien » : le noyau ligne à ligne d'origine) : la perte, tous les gradients, les poids après des pas d'AdamW, les
// logits de la génération (voie complète et voie à mémoire des clés/valeurs), les morceaux générés, les plongements,
// et la courbe d'un entraînement court. Un point de reprise écrit par l'ancien calcul est relu par le nouveau.
//
// TOLÉRANCE (écart relatif, tenseur par tenseur : ‖x − réf‖₂ / ‖réf‖₂) :
//   - un Float32 a une précision relative u = 2⁻²⁴ ≈ 6·10⁻⁸. Une somme de K produits changée d'ordre ou d'arrondi
//     (fusion, sommes en Float32 au lieu de double dans l'attention) s'écarte typiquement de √K·u et au pire de K·u ;
//     K va jusqu'à 4096 (la tête) : √K·u ≈ 4·10⁻⁶, K·u ≈ 2,4·10⁻⁴. Huit couches aller-retour gardent cet ordre
//     (normalisations de couche, softmax : aucune n'amplifie fortement). On retient TOL = 1·10⁻⁴ pour la perte, les
//     gradients, les logits et les plongements : au-dessus du bruit mesuré (voir les diagnostics), bien en dessous
//     de toute vraie erreur (un mauvais indice, un oubli de mise à l'échelle donnent 10⁻¹ à 1).
//   - les poids après AdamW : on compare la MISE À JOUR (poids après − poids avant). AdamW normalise chaque gradient
//     (m / √v) : un gradient presque nul, de l'ordre de son propre bruit d'arrondi, peut changer de signe et sa mise à
//     jour aussi (± lr). On retient TOL_ADAM = 1·10⁻² sur la mise à jour d'un tenseur entier : quelques éléments
//     de gradient presque nul au plus ; une vraie erreur de gradient donne un écart d'ordre 1.
//   - la courbe d'un entraînement court : même TOL que la perte, pas par pas.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Reseau, choisirCalcul, MESSAGE_CARTE_GRAPHIQUE } from '../src/brain/nous/calcul.ts';
import { fabriquerNoyaux, MODES_NOYAU, noyaux, type ModeNoyau, type Noyaux } from '../src/brain/nous/wasm.ts';
import { hyperDe } from '../src/brain/nous/tailles.ts';
import { Reseau as ReseauAncien } from './rapidite/reference/calcul-ancien.ts';

const TOL = 1e-4;
const TOL_ADAM = 1e-2;

type Hy = ReturnType<typeof hyperDe>;
/** Les modes testés : ceux que la machine sait faire (le mode « js » n'est qu'un repli de secours, testé à part). */
const MODES: Array<{ mode: ModeNoyau; k: Noyaux }> = (['fma', 'bloc', 'ancien'] as ModeNoyau[]).flatMap((mode) => { const k = fabriquerNoyaux(mode); return k ? [{ mode, k }] : []; });

function suite(n: number, V: number, graine: number): Int32Array {
  let a = graine >>> 0; const s = new Int32Array(n);
  for (let i = 0; i < n; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; s[i] = a % V; }
  return s;
}
/** ‖x − réf‖₂ / ‖réf‖₂ (0 si les deux sont nuls). */
function ecartRel(x: ArrayLike<number>, ref: ArrayLike<number>, debut = 0, fin = ref.length): number {
  let num = 0, den = 0;
  for (let i = debut; i < fin; i++) { const d = x[i] - ref[i]; num += d * d; den += ref[i] * ref[i]; }
  if (!Number.isFinite(num)) return Infinity;
  return den === 0 ? (num === 0 ? 0 : Infinity) : Math.sqrt(num / den);
}
/** Les tenseurs de la disposition (nom, début, fin), pour comparer tenseur par tenseur. */
function tenseurs(r: Reseau): Array<[string, number, number]> {
  const d = r.disp, C = d.C, C4 = d.C4, out: Array<[string, number, number]> = [['wte', d.wte, d.wte + d.V * C], ['wpe', d.wpe, d.wpe + d.T * C]];
  d.couches.forEach((c, l) => {
    const t: Array<[string, number, number]> = [['ln1g', c.ln1g, C], ['ln1b', c.ln1b, C], ['wq', c.wq, C * C], ['wk', c.wk, C * C], ['wv', c.wv, C * C], ['wo', c.wo, C * C], ['ln2g', c.ln2g, C], ['ln2b', c.ln2b, C], ['w1', c.w1, C * C4], ['b1', c.b1, C4], ['w2', c.w2, C4 * C], ['b2', c.b2, C]];
    for (const [n, o, len] of t) out.push([`${n}${l}`, o, o + len]);
  });
  out.push(['lnfg', d.lnfg, d.lnfg + C], ['lnfb', d.lnfb, d.lnfb + C]);
  return out;
}
function pireParTenseur(r: Reseau, x: ArrayLike<number>, ref: ArrayLike<number>): { nom: string; ecart: number } {
  let pire = { nom: '', ecart: 0 };
  for (const [nom, a, b] of tenseurs(r)) { const e = ecartRel(x, ref, a, b); if (!(e <= pire.ecart)) pire = { nom, ecart: e }; }
  return pire;
}

interface Mesures { perte: number; grads: { nom: string; ecart: number }; adam: { nom: string; ecart: number }; logits: number; logitsCache: number; logitsGen: number; idsEgaux: boolean; plongement: number; courbe: number }

/** Compare le calcul actuel (noyau `k`) à la référence, pour un gabarit et une graine. */
function comparer(h: Hy, graine: number, k: Noyaux, nPas: number): Mesures {
  const ref = new ReseauAncien(h); ref.initialiser(graine);
  const r = new Reseau(h, undefined, k); r.initialiser(graine);
  assert.deepEqual(Array.from(r.poids.subarray(0, 64)), Array.from(ref.poids.subarray(0, 64)), 'même départ');
  const V = h.vocab, T = h.contexte;
  // Deux suites : une pleine (128 morceaux), une de longueur impaire avec un masque de rôles (bords des noyaux).
  const s1 = suite(T, V, graine * 7 + 1), s2 = suite(61, V, graine * 7 + 2);
  const roles = new Int32Array(61); for (let i = 20; i < 61; i++) roles[i] = 1;
  ref.jeterGrad(); r.jeterGrad();
  const pRef = ref.perteEtGrad(s1) + ref.perteEtGrad(s2, 0.7, roles);
  const p = r.perteEtGrad(s1) + r.perteEtGrad(s2, 0.7, roles);
  const grads = pireParTenseur(r, r.grads, ref.grads);
  // Pas d'AdamW (sur les gradients ci-dessus, puis sur d'autres suites) : on compare la mise à jour totale.
  const avant = Float32Array.from(ref.poids);
  const courbeRef: number[] = [], courbe: number[] = [];
  for (let pas = 0; pas < nPas; pas++) {
    if (pas > 0) {
      const a = suite(T, V, graine * 31 + pas), b = suite(97, V, graine * 37 + pas);
      courbeRef.push(ref.perteEtGrad(a) + ref.perteEtGrad(b)); courbe.push(r.perteEtGrad(a) + r.perteEtGrad(b));
    }
    ref.pasAdamW(3e-3); r.pasAdamW(3e-3);
  }
  const dRef = ref.poids.map((x, i) => x - avant[i]), dNew = r.poids.map((x, i) => x - avant[i]);
  const adam = pireParTenseur(r, dNew, dRef);
  // À partir d'ici, les deux réseaux sont remis sur les MÊMES poids (ceux de la référence) : on compare l'inférence.
  r.importerPoids(ref.poids);
  const amorce = suite(40, V, graine * 11 + 3);
  const logits = ecartRel(r.avant(s1, true).logits!, ref.avant(s1, true).logits!);
  const logitsCache = ecartRel(r.logitsCache(amorce), ref.logitsCache(amorce));
  const logitsGen = ecartRel(r.logitsDerniere(amorce), ref.logitsDerniere(amorce));
  const gRef = ref.generer(amorce, 12, { graine: 5 }), g = r.generer(amorce, 12, { graine: 5 });
  const idsEgaux = JSON.stringify(gRef.ids) === JSON.stringify(g.ids);
  const texteLong = suite(300, V, graine * 13 + 4); // plus long que le contexte : plusieurs fenêtres
  const plongement = ecartRel(r.plonger(texteLong), ref.plonger(texteLong));
  const courbeEcart = Math.max(Math.abs(p - pRef) / Math.abs(pRef), ...courbe.map((x, i) => Math.abs(x - courbeRef[i]) / Math.abs(courbeRef[i])));
  return { perte: Math.abs(p - pRef) / Math.abs(pRef), grads, adam, logits, logitsCache, logitsGen, idsEgaux, plongement, courbe: courbeEcart };
}

function verifier(t: { diagnostic(m: string): void }, nom: string, m: Mesures): void {
  t.diagnostic(`${nom} : perte ${m.perte.toExponential(1)}, gradients ${m.grads.ecart.toExponential(1)} (${m.grads.nom}), AdamW ${m.adam.ecart.toExponential(1)} (${m.adam.nom}), logits ${m.logits.toExponential(1)}, cache ${m.logitsCache.toExponential(1)}, génération ${m.logitsGen.toExponential(1)}, plongement ${m.plongement.toExponential(1)}, courbe ${m.courbe.toExponential(1)}, mêmes morceaux : ${m.idsEgaux}`);
  assert.ok(m.perte <= TOL, `${nom} : perte ${m.perte}`);
  assert.ok(m.grads.ecart <= TOL, `${nom} : gradient ${m.grads.nom} ${m.grads.ecart}`);
  assert.ok(m.adam.ecart <= TOL_ADAM, `${nom} : mise à jour AdamW ${m.adam.nom} ${m.adam.ecart}`);
  assert.ok(m.logits <= TOL && m.logitsCache <= TOL && m.logitsGen <= TOL, `${nom} : logits ${m.logits} / ${m.logitsCache} / ${m.logitsGen}`);
  assert.ok(m.plongement <= TOL, `${nom} : plongement ${m.plongement}`);
  assert.ok(m.courbe <= TOL, `${nom} : courbe ${m.courbe}`);
  assert.ok(m.idsEgaux, `${nom} : la génération gloutonne rend les mêmes morceaux`);
}

test('la machine a au moins un noyau WebAssembly, choisi une fois ; les replis existent', (t) => {
  const k = noyaux();
  t.diagnostic(`noyau choisi : ${k.mode} ; disponibles : ${MODES.map((m) => m.mode).join(', ')}`);
  assert.ok(MODES_NOYAU.includes(k.mode));
  assert.equal(noyaux(), k, 'choisi une seule fois');
  assert.ok(fabriquerNoyaux('js'), 'le repli JavaScript existe toujours');
  assert.equal(new Reseau(hyperDe('petit')).modeNoyau, k.mode);
});

test('« carte graphique » : message franc, le calcul reste sur le processeur', () => {
  const c = choisirCalcul('carte-graphique');
  assert.equal(c.voie, 'processeur'); assert.equal(c.message, MESSAGE_CARTE_GRAPHIQUE); assert.ok(c.noyaux);
  assert.equal(choisirCalcul().message, undefined);
});

for (const { mode, k } of MODES) {
  test(`gabarit petit, noyau « ${mode} » : mêmes résultats que l'ancien calcul (3 graines)`, (t) => {
    for (const graine of [1, 2, 3]) verifier(t, `petit/${mode}/graine ${graine}`, comparer(hyperDe('petit'), graine, k, 4));
  });
  test(`gabarit moyen, noyau « ${mode} » : mêmes résultats que l'ancien calcul (2 graines)`, (t) => {
    for (const graine of [4, 5]) verifier(t, `moyen/${mode}/graine ${graine}`, comparer(hyperDe('moyen'), graine, k, 3));
  });
}

test('le repli JavaScript pur rend aussi les mêmes résultats (gabarit petit)', (t) => {
  verifier(t, 'petit/js', comparer(hyperDe('petit'), 6, fabriquerNoyaux('js')!, 2));
});

test('un point de reprise écrit par l\'ancien calcul se relit et donne les mêmes sorties', async () => {
  const { ecrireReprise, lireReprise } = await import('../src/brain/nous/reprise.ts');
  const { apprendreDecoupage, serialiserDecoupage } = await import('../src/brain/nous/decoupage.ts');
  const h = hyperDe('petit'), home = mkdtempSync(join(tmpdir(), 'noos-vitesse-'));
  const ref = new ReseauAncien(h); ref.initialiser(9);
  const s = suite(h.contexte, h.vocab, 99);
  for (let i = 0; i < 2; i++) { ref.jeterGrad(); ref.perteEtGrad(s); ref.pasAdamW(1e-3); }
  const mm = ref.exporterMoments();
  await ecrireReprise(home, 0, { hyper: h, decoupage: serialiserDecoupage(apprendreDecoupage(['bonjour le monde '.repeat(10)], 300, 1)), poids: ref.exporterPoids(), m: mm.m, v: mm.v, pas: mm.pas, graine: 9, courbe: [] });
  const lu = await lireReprise(home, 0);
  assert.ok(lu, 'relu');
  const r = new Reseau(lu.hyper); r.importerPoids(lu.poids); r.importerMoments(lu.m, lu.v, lu.pas);
  assert.equal(r.pas, 2);
  const amorce = suite(30, h.vocab, 7);
  assert.ok(ecartRel(r.logitsCache(amorce), ref.logitsCache(amorce)) <= TOL);
  assert.deepEqual(r.generer(amorce, 8).ids, ref.generer(amorce, 8).ids);
  // Un pas de plus sur les deux : mêmes poids à la tolérance d'AdamW (les moments relus servent bien).
  const avant = Float32Array.from(ref.poids);
  ref.jeterGrad(); r.jeterGrad(); ref.perteEtGrad(s); r.perteEtGrad(s); ref.pasAdamW(1e-3); r.pasAdamW(1e-3);
  assert.ok(ecartRel(r.poids.map((x, i) => x - avant[i]), ref.poids.map((x, i) => x - avant[i])) <= TOL_ADAM);
});

test('séance sur 3 fils : le pas réparti entre les fils donne les mêmes poids, bit à bit, que le pas fait par un seul fil', async () => {
  const { lancerAides, arreterAides, seanceParallele } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit');
  const entrees = Array.from({ length: 12 }, (_, i) => suite(i % 3 === 0 ? 61 : h.contexte, h.vocab, 50 + i));
  const faire = async (repartir: boolean): Promise<{ poids: Float32Array; m: Float32Array; pas: number; perte: number }> => {
    const sab = new SharedArrayBuffer(h.poids * 4), r = new Reseau(h, new Float32Array(sab)); r.initialiser(8);
    const aides = lancerAides(h, sab, undefined, 2);
    try {
      const av = await seanceParallele(r, [{ entrees }], { dureeMs: 120_000, graine: 2, tailleLot: 6, lr: 3e-3 }, repartir ? aides : { ...aides, reparti: undefined });
      return { poids: Float32Array.from(r.poids), m: r.exporterMoments().m, pas: av.pas, perte: av.perte };
    } finally { await arreterAides(aides); }
  };
  const a = await faire(true), b = await faire(false);
  assert.equal(a.pas, 2); assert.equal(a.pas, b.pas); assert.equal(a.perte, b.perte);
  assert.ok(a.poids.every((x, i) => Object.is(x, b.poids[i])), 'mêmes poids, bit à bit');
  assert.ok(a.m.every((x, i) => Object.is(x, b.m[i])), 'mêmes moments, bit à bit');
  // Et proche de l'ancien calcul sur un seul fil (l'ordre des additions de gradients diffère : tolérance d'AdamW).
  const ref = new ReseauAncien(h); ref.initialiser(8);
  const { seance: seanceAncienne } = await import('./rapidite/reference/calcul-ancien.ts');
  const avant = Float32Array.from(ref.poids);
  seanceAncienne(ref, [{ entrees }], { dureeMs: 120_000, graine: 2, tailleLot: 6, lr: 3e-3 });
  assert.ok(ecartRel(a.poids.map((x, i) => x - avant[i]), ref.poids.map((x, i) => x - avant[i])) <= TOL_ADAM);
});

test('poids changés à la main hors séance : le calcul suivant les voit (pas de copie périmée)', () => {
  const h = hyperDe('petit'), r = new Reseau(h); r.initialiser(4);
  const s = suite(64, h.vocab, 3);
  const a = r.logitsDerniere(s);
  const d = r.disp; for (let i = 0; i < d.C * d.C; i++) r.poids[d.couches[0].w1 + i] *= 1.5; // écrit sans passer par le réseau
  const b = r.logitsDerniere(s);
  const ref = new ReseauAncien(h); ref.importerPoids(r.poids);
  assert.ok(ecartRel(a, b) > 1e-3, 'les logits ont changé');
  assert.ok(ecartRel(b, ref.logitsDerniere(s)) <= TOL, 'et valent ceux de la référence sur les nouveaux poids');
});

// ----------------------------------------------------------------------------------------------------------------
// Constats de la relecture (séances enchaînées, aides perdues, mémoire du réseau qui n'est pas celle des aides).
// ----------------------------------------------------------------------------------------------------------------

test('séances enchaînées sur 6 aides : aucun poids ne change entre deux séances, aucune aide ne reste coincée', async () => {
  const { lancerAides, arreterAides, seanceParallele, reglerDelaiAide } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit'), sab = new SharedArrayBuffer(h.poids * 4), r = new Reseau(h, new Float32Array(sab)); r.initialiser(8);
  const nA = 6, aides = lancerAides(h, sab, undefined, nA);
  reglerDelaiAide(5_000);
  const entrees = Array.from({ length: 2 * (nA + 1) }, (_, i) => suite(40, h.vocab, 50 + i));
  try {
    for (let t = 0; t < 30; t++) {
      await seanceParallele(r, [{ entrees }], { dureeMs: 60_000, graine: t, tailleLot: nA + 1, lr: 3e-3, maxPas: 1 }, aides);
      // La fin de séance ne laisse aucun ordre « pas » en place.
      assert.equal(Atomics.load(aides.reparti!.ordre, 0), 0, `tour ${t} : ordre remis à zéro`);
      const photo = Float32Array.from(r.poids);
      // Une 2e séance tout de suite (comme deux ordres « séance » à la file), sans aucun pas.
      const p2 = seanceParallele(r, [{ entrees }], { dureeMs: 0, graine: t, tailleLot: nA + 1, lr: 3e-3 }, aides);
      await new Promise((ok) => setTimeout(ok, 20));
      assert.ok(photo.every((x, i) => Object.is(x, r.poids[i])), `tour ${t} : aucun poids changé hors d'un pas`);
      const av = await p2;
      assert.equal(av.pas, 0);
    }
  } finally { reglerDelaiAide(30_000); await arreterAides(aides); }
});

test('une aide qui n\'a pas encore quitté la séance précédente : la suivante ne démarre pas sans elle', async () => {
  const { lancerAides, arreterAides, seanceParallele, reglerDelaiAide } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit'), sab = new SharedArrayBuffer(h.poids * 4), r = new Reseau(h, new Float32Array(sab)); r.initialiser(3);
  const aides = lancerAides(h, sab, undefined, 2);
  const entrees = Array.from({ length: 6 }, (_, i) => suite(40, h.vocab, 10 + i));
  reglerDelaiAide(300);
  try {
    await seanceParallele(r, [{ entrees }], { dureeMs: 60_000, graine: 1, tailleLot: 3, lr: 3e-3, maxPas: 1 }, aides);
    await new Promise((ok) => setTimeout(ok, 200)); // les aides ont quitté la séance
    Atomics.store(aides.sync, 2 + 4 * 1 + 3, 1); // l'aide 1 « encore dans la séance précédente » (simulé)
    const photo = Float32Array.from(r.poids);
    await assert.rejects(seanceParallele(r, [{ entrees }], { dureeMs: 60_000, graine: 2, tailleLot: 3, lr: 3e-3 }, aides), /aide/);
    assert.equal(aides.cassees, true, 'les aides sont marquées à relancer');
    assert.equal(Atomics.load(aides.sync, 1), 1, 'la fin de séance reste posée : aucune aide ne repart');
    assert.ok(photo.every((x, i) => Object.is(x, r.poids[i])), 'poids intacts');
  } finally { reglerDelaiAide(30_000); await arreterAides(aides); }
});

test('pas réparti abandonné (une aide ne fait pas sa tranche) : erreur franche, aucun gradient ni compte laissé à moitié', async () => {
  const { lancerAides, arreterAides, seanceParallele, reglerDelaiAide } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit'), sab = new SharedArrayBuffer(h.poids * 4), r = new Reseau(h, new Float32Array(sab)); r.initialiser(5);
  const aides = lancerAides(h, sab, undefined, 2);
  const entrees = Array.from({ length: 6 }, (_, i) => suite(40, h.vocab, 30 + i));
  // Un ordre « pas » que les aides ne voient pas : elles ne font jamais leur tranche.
  const sourd = { ...aides, reparti: { ...aides.reparti!, ordre: new Int32Array(new SharedArrayBuffer(4 * 3)) } };
  reglerDelaiAide(300);
  try {
    await assert.rejects(seanceParallele(r, [{ entrees }], { dureeMs: 60_000, graine: 1, tailleLot: 3, lr: 3e-3 }, sourd), /pas/);
    assert.equal(sourd.cassees, true);
    assert.equal(r.accumulees, 0, 'plus aucune séquence comptée');
    assert.ok(r.grads.every((x) => x === 0), 'gradients remis à zéro');
    // Les copies de travail suivent les poids (en partie changés) : le calcul suivant est celui de la référence.
    const s = suite(50, h.vocab, 1), ref = new ReseauAncien(h); ref.importerPoids(r.poids);
    assert.ok(ecartRel(r.logitsDerniere(s), ref.logitsDerniere(s)) <= TOL);
  } finally { reglerDelaiAide(30_000); await arreterAides(aides); }
});

test('réseau qui ne tient pas ses poids dans la mémoire des aides : le pas reste fait par le fil de Noûs (rien de perdu)', async () => {
  const { lancerAides, arreterAides, seanceParallele } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit');
  const entrees = Array.from({ length: 9 }, (_, i) => suite(40, h.vocab, 70 + i));
  const faire = async (repartir: boolean): Promise<Float32Array> => {
    const r = new Reseau(h); r.initialiser(6); // poids dans sa propre mémoire
    const sab = new SharedArrayBuffer(h.poids * 4); new Float32Array(sab).set(r.poids);
    const aides = lancerAides(h, sab, undefined, 2);
    try {
      await seanceParallele(r, [{ entrees }], { dureeMs: 60_000, graine: 3, tailleLot: 3, lr: 3e-3 }, repartir ? aides : { ...aides, reparti: undefined });
      return Float32Array.from(r.poids);
    } finally { await arreterAides(aides); }
  };
  const a = await faire(true), b = await faire(false);
  assert.ok(a.every((x, i) => Object.is(x, b[i])), 'mêmes poids que le pas fait par le seul fil de Noûs');
});

test('plongement d\'un long texte et perte sur un jeu : les poids ne sont recopiés qu\'une fois par appel', async () => {
  const { perteSur } = await import('../src/brain/nous/calcul.ts');
  const base = fabriquerNoyaux('bloc') ?? fabriquerNoyaux('fma');
  if (!base?.resident) return; // pas de noyau à résidents sur cette machine
  const versions = new Set<number>();
  const k: Noyaux = { ...base, resident: (p, n, v, l, remplir) => { versions.add(v); return base.resident!(p, n, v, l, remplir); } };
  const h = hyperDe('petit'), r = new Reseau(h, undefined, k); r.initialiser(2);
  r.plonger(suite(300, h.vocab, 9)); // trois fenêtres
  assert.equal(versions.size, 1, 'plonger : une seule version des copies');
  versions.clear();
  perteSur(r, [suite(60, h.vocab, 1), suite(80, h.vocab, 2), suite(90, h.vocab, 3)]);
  assert.equal(versions.size, 1, 'perteSur : une seule version des copies');
  // Et le calcul suivant revoit bien les poids (hors séance, chaque appel public refait les copies).
  r.plonger(suite(10, h.vocab, 9)); assert.equal(versions.size, 2);
});

// ----------------------------------------------------------------------------------------------------------------
// Mémoire vive au service du calcul (noyau-tampons.ts) : les tableaux intérieurs d'une suite resservent à la suivante.
// C'est un pur gain de vitesse : le calcul doit être IDENTIQUE, bit à bit, à celui qui alloue des tableaux neufs
// (mêmes opérations, dans le même ordre, sur des tableaux remis à zéro). Rien de périmé d'une suite, d'une séance ou
// d'un réseau à l'autre ; mémoire bornée par le comptable et rendue sous pression.
// ----------------------------------------------------------------------------------------------------------------

const memesBits = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => Object.is(x, b[i]));
/** Le même travail sur deux réseaux (tampons gardés / tableaux neufs) : pertes, tous les gradients, poids et moments
 *  après des pas, logits de la génération et morceaux générés, plongements, perte sur un jeu. Longueurs mélangées
 *  (longue, courte, longue…), masques de rôles et poids d'exemple : les tampons sont pris, agrandis, repris. */
async function memeCalcul(h: Hy, graine: number): Promise<{ suites: number; tenus: number }> {
  const { perteSur } = await import('../src/brain/nous/calcul.ts');
  const a = new Reseau(h, undefined, undefined, { tampons: true }), b = new Reseau(h, undefined, undefined, { tampons: false });
  a.initialiser(graine); b.initialiser(graine);
  const V = h.vocab, T = h.contexte;
  const longueurs = [T, 9, 61, T, 2, 97, 33, T + 40, 5, T];
  let n = 0;
  for (let pas = 0; pas < 3; pas++) {
    for (const [i, L] of longueurs.entries()) {
      const s = suite(L, V, graine * 100 + pas * 10 + i);
      const roles = i % 3 === 1 ? Int32Array.from({ length: L }, (_, t) => (t >= L / 3 ? 1 : 0)) : undefined;
      const pa = a.perteEtGrad(s, 0.5 + i / 10, roles), pb = b.perteEtGrad(s, 0.5 + i / 10, roles);
      assert.ok(Object.is(pa, pb), `graine ${graine}, pas ${pas}, suite ${i} (${L}) : perte ${pa} / ${pb}`);
      n++;
    }
    assert.ok(memesBits(a.grads, b.grads), `graine ${graine}, pas ${pas} : tous les gradients, bit à bit`);
    a.pasAdamW(3e-3); b.pasAdamW(3e-3);
    assert.ok(memesBits(a.poids, b.poids), `graine ${graine}, pas ${pas} : poids après AdamW`);
  }
  const ma = a.exporterMoments(), mb = b.exporterMoments();
  assert.ok(memesBits(ma.m, mb.m) && memesBits(ma.v, mb.v), 'moments AdamW');
  const amorce = suite(40, V, graine + 7);
  assert.ok(memesBits(a.logitsDerniere(amorce), b.logitsDerniere(amorce)), 'logits (voie complète)');
  assert.ok(memesBits(a.logitsCache(amorce), b.logitsCache(amorce)), 'logits (mémoire des clés et valeurs)');
  assert.deepEqual(a.generer(amorce, 10, { graine: 3 }).ids, b.generer(amorce, 10, { graine: 3 }).ids, 'morceaux générés');
  for (const L of [300, 7, T]) { const s = suite(L, V, graine + L); assert.ok(memesBits(a.plonger(s), b.plonger(s)), `plongement de ${L} morceaux`); }
  const jeu = [suite(T, V, 1), suite(20, V, 2), suite(1, V, 3), suite(77, V, 4)];
  assert.ok(Object.is(perteSur(a, jeu), perteSur(b, jeu)), 'perte sur un jeu');
  assert.equal(b.etatTampons.tenus, 0, 'le réseau sans tampons ne garde rien');
  return { suites: n, tenus: a.etatTampons.tenus };
}

test('tampons gardés, gabarits petit (3 graines) et moyen (2 graines) : calcul identique bit à bit à des tableaux neufs', async (t) => {
  for (const [taille, graines] of [['petit', [1, 2, 3]], ['moyen', [4, 5]]] as Array<['petit' | 'moyen', number[]]>) {
    for (const g of graines) {
      const m = await memeCalcul(hyperDe(taille), g);
      t.diagnostic(`${taille}/graine ${g} : ${m.suites} suites, ${(m.tenus / 1e6).toFixed(1)} Mo de tampons gardés`);
      assert.ok(m.tenus > 0, 'des tampons ont bien servi');
    }
  }
});

test('deux réseaux dans le même fil, entrelacés : chacun ses tampons, rien de partagé à tort', () => {
  const hp = hyperDe('petit'), hm = hyperDe('moyen');
  const a = new Reseau(hp), b = new Reseau(hm), ra = new Reseau(hp, undefined, undefined, { tampons: false }), rb = new Reseau(hm, undefined, undefined, { tampons: false });
  a.initialiser(1); ra.initialiser(1); b.initialiser(2); rb.initialiser(2);
  for (let i = 0; i < 6; i++) {
    const s1 = suite(20 + 17 * i, hp.vocab, i), s2 = suite(128 - 11 * i, hm.vocab, 50 + i);
    assert.ok(Object.is(a.perteEtGrad(s1), ra.perteEtGrad(s1)));
    assert.ok(Object.is(b.perteEtGrad(s2), rb.perteEtGrad(s2)));
  }
  assert.ok(memesBits(a.grads, ra.grads) && memesBits(b.grads, rb.grads));
  // Les états rendus par un calcul public (hors portée) ne sont jamais des tampons : ils restent valables après.
  const s = suite(50, hp.vocab, 9), e1 = a.avant(s, true), copie = Float32Array.from(e1.logits!);
  a.perteEtGrad(suite(128, hp.vocab, 3)); a.plonger(suite(90, hp.vocab, 4));
  assert.ok(memesBits(e1.logits!, copie), 'un état tenu par l\'appelant n\'est pas réécrit');
});

test('séances enchaînées sur 4 aides, AVEC les tampons gardés dans chaque fil : mêmes poids, bit à bit, que sans tampons', async () => {
  const { lancerAides, arreterAides, seanceParallele, seance } = await import('../src/brain/nous/calcul.ts');
  const h = hyperDe('petit');
  // Des séances aux longueurs différentes l'une de l'autre (les tampons des aides servent, grandissent, resservent).
  const jeux = [0, 1, 2, 3, 4].map((k) => Array.from({ length: 15 }, (_, i) => suite(Math.max(2, [128, 12, 70, 128, 5][k] - (i % 4) * (k + 1)), h.vocab, 100 * k + i)));
  const faire = async (tampons: boolean, fils: boolean): Promise<{ poids: Float32Array; m: Float32Array; pertes: number[] }> => {
    const ancien = process.env.ODIN_SOUL_TAMPONS;
    if (tampons) delete process.env.ODIN_SOUL_TAMPONS; else process.env.ODIN_SOUL_TAMPONS = 'non'; // lu à la création des réseaux (aides comprises)
    try {
      const sab = new SharedArrayBuffer(h.poids * 4), r = new Reseau(h, new Float32Array(sab)); r.initialiser(12);
      const aides = fils ? lancerAides(h, sab, undefined, 4) : undefined;
      const pertes: number[] = [];
      try {
        for (const [k, entrees] of jeux.entries()) {
          const o = { dureeMs: 120_000, graine: k, tailleLot: 5, lr: 3e-3 };
          const av = aides ? await seanceParallele(r, [{ entrees }], o, aides) : seance(r, [{ entrees }], o);
          pertes.push(av.perte);
        }
      } finally { await arreterAides(aides); }
      assert.equal(r.etatTampons.tenus > 0, tampons, 'tampons gardés seulement quand ils sont permis');
      return { poids: Float32Array.from(r.poids), m: r.exporterMoments().m, pertes };
    } finally { if (ancien === undefined) delete process.env.ODIN_SOUL_TAMPONS; else process.env.ODIN_SOUL_TAMPONS = ancien; }
  };
  const avec = await faire(true, true), sans = await faire(false, true);
  assert.deepEqual(avec.pertes, sans.pertes);
  assert.ok(memesBits(avec.poids, sans.poids), 'mêmes poids, bit à bit, après 5 séances enchaînées sur 5 fils');
  assert.ok(memesBits(avec.m, sans.m), 'mêmes moments');
  // Et la même chose sur un seul fil.
  const un = await faire(true, false), unSans = await faire(false, false);
  assert.ok(memesBits(un.poids, unSans.poids));
});

test('mémoire des tampons : demandée au comptable, refusée sans dommage, bornée, rendue sous pression', async () => {
  const bm = await import('../src/brain/budget-memoire.ts');
  const { sourceComptable, Tampons } = await import('../src/brain/nous/noyau-tampons.ts');
  for (let i = 0; i < 100 && sourceComptable() !== 'comptable'; i++) await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(sourceComptable(), 'comptable', 'le comptable de la mémoire est bien celui qui compte');
  const env = (v: Record<string, string | undefined>): void => { for (const [k, x] of Object.entries(v)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; } };
  const h = hyperDe('moyen'), s = suite(128, h.vocab, 1);
  try {
    // Machine presque pleine : rien n'est gardé, le calcul reste le même.
    env({ ODIN_MEMOIRE_LIBRE_MO: '520', ODIN_MEMOIRE_MARGE_MO: '512', ODIN_MEMOIRE_PLAFOND_MO: '4096' });
    const a = new Reseau(h), b = new Reseau(h, undefined, undefined, { tampons: false }); a.initialiser(3); b.initialiser(3);
    assert.ok(Object.is(a.perteEtGrad(s), b.perteEtGrad(s)));
    assert.equal(a.etatTampons.tenus, 0, 'budget refusé : rien de gardé');
    // De la place : les tampons sont gardés, et leur part est retirée du budget de tous.
    env({ ODIN_MEMOIRE_LIBRE_MO: '20000' });
    const budget0 = bm.budgetLibreMo();
    a.jeterGrad(); b.jeterGrad();
    assert.ok(Object.is(a.perteEtGrad(s), b.perteEtGrad(s)));
    const e = a.etatTampons;
    assert.ok(e.tenus > 0 && e.tenus <= e.reserves, `tenus ${e.tenus} ≤ réservés ${e.reserves}`);
    assert.equal(bm.budgetLibreMo(), budget0 - e.reserves / 1_048_576, 'la part des tampons est comptée');
    // Pression (la mémoire libre passe sous la marge) : tout est rendu ; le calcul suivant reste juste.
    env({ ODIN_MEMOIRE_LIBRE_MO: '100' });
    bm.budgetLibreMo(); // le comptable voit la pression et prévient chacun
    assert.equal(a.etatTampons.tenus, 0, 'rendu sous pression');
    env({ ODIN_MEMOIRE_LIBRE_MO: '20000' });
    assert.equal(bm.budgetLibreMo(), 4096, 'plus rien de réservé, par personne (la pression vide tout le monde)');
    a.jeterGrad(); b.jeterGrad();
    assert.ok(Object.is(a.perteEtGrad(s), b.perteEtGrad(s)) && memesBits(a.grads, b.grads));
    assert.ok(a.etatTampons.reserves > 0, 'repris au calcul suivant');
    a.rendreTampons(); assert.equal(bm.budgetLibreMo(), 4096, 'rendu à la demande');
    // Plafond propre : une portée qui en voudrait plus prend des tableaux neufs au-delà.
    const t = new Tampons({ actif: true, maxMo: 1 });
    t.dans(() => { const x = t.prendre(200_000); const y = t.prendre(200_000); x[0] = 1; y[0] = 2; assert.equal(x[0], 1); });
    assert.ok(t.etat.tenus <= 1_048_576, 'jamais plus que le plafond');
    t.vider();
  } finally { env({ ODIN_MEMOIRE_LIBRE_MO: undefined, ODIN_MEMOIRE_MARGE_MO: undefined, ODIN_MEMOIRE_PLAFOND_MO: undefined }); }
});

test('un réseau disparu rend sa part au comptable', async () => {
  const v8 = await import('node:v8'), vm = await import('node:vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const bm = await import('../src/brain/budget-memoire.ts');
  process.env.ODIN_MEMOIRE_LIBRE_MO = '20000';
  try {
    const budget0 = bm.budgetLibreMo();
    (() => { const r = new Reseau(hyperDe('petit')); r.initialiser(1); r.perteEtGrad(suite(128, 4096, 2)); assert.ok(r.etatTampons.reserves > 0); })();
    assert.ok(bm.budgetLibreMo() < budget0, 'part prise');
    for (let i = 0; i < 50 && bm.budgetLibreMo() < budget0; i++) { gc(); await new Promise((ok) => setTimeout(ok, 20)); }
    assert.ok(bm.budgetLibreMo() >= budget0, 'part rendue après la disparition du réseau');
  } finally { delete process.env.ODIN_MEMOIRE_LIBRE_MO; }
});

test('beaucoup de réseaux créés puis disparus : le suivi des tampons ne grossit pas sans fin', async () => {
  const v8 = await import('node:v8'), vm = await import('node:vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const { Tampons, suivis } = await import('../src/brain/nous/noyau-tampons.ts');
  for (let i = 0; i < 20; i++) { gc(); await new Promise((ok) => setTimeout(ok, 10)); }
  const depart = suivis();
  (() => { for (let i = 0; i < 500; i++) new Tampons({ actif: true }); })();
  assert.ok(suivis() >= depart + 500);
  // Aucun calcul, aucune pression entre-temps : seul le ramasse-miettes passe.
  for (let i = 0; i < 100 && suivis() > depart; i++) { gc(); await new Promise((ok) => setTimeout(ok, 10)); }
  assert.ok(suivis() <= depart, `suivis : ${suivis()} (départ ${depart})`);
});

test('tampons et poids figés du moteur : deux réglages séparés (chaque gain se mesure seul)', async () => {
  const { gelActif, tamponsActifs } = await import('../src/brain/nous/noyau-tampons.ts');
  const env = (v: Record<string, string | undefined>): void => { for (const [k, x] of Object.entries(v)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; } };
  const avant = { ODIN_SOUL_TAMPONS: process.env.ODIN_SOUL_TAMPONS, ODIN_SOUL_GEL: process.env.ODIN_SOUL_GEL };
  try {
    env({ ODIN_SOUL_TAMPONS: 'non', ODIN_SOUL_GEL: undefined });
    assert.equal(tamponsActifs(), false); assert.equal(gelActif(), true, 'couper les tampons ne coupe pas les poids figés');
    env({ ODIN_SOUL_TAMPONS: undefined, ODIN_SOUL_GEL: 'non' });
    assert.equal(tamponsActifs(), true); assert.equal(gelActif(), false);
  } finally { env(avant); }
});

test('tampons des fils d\'aide : comptés par le comptable du fil principal, bornés, rendus quand les aides s\'arrêtent', async () => {
  // Les aides (et le fil du moteur) sont d'autres fils : leurs tampons doivent être vus par LE comptable d'Odin, celui
  // du fil principal (défaut relevé à la relecture : chaque fil avait sa propre table et ne voyait que lui).
  const { lancerAides, arreterAides, seanceParallele } = await import('../src/brain/nous/calcul.ts');
  const bm = await import('../src/brain/budget-memoire.ts');
  const dormir = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
  process.env.ODIN_MEMOIRE_LIBRE_MO = '20000';
  try {
    const h = hyperDe('petit'), sab = new SharedArrayBuffer(h.poids * 4);
    const r = new Reseau(h, new Float32Array(sab), undefined, { tampons: false }); r.initialiser(4); // le fil principal ne garde rien
    const budget0 = bm.budgetLibreMo();
    const aides = lancerAides(h, sab, undefined, 3);
    let pris = 0;
    try {
      const entrees = Array.from({ length: 16 }, (_, i) => suite(128, h.vocab, 300 + i));
      for (let k = 0; k < 8 && pris <= 0; k++) {
        await seanceParallele(r, [{ entrees }], { dureeMs: 120_000, graine: k, tailleLot: 4, lr: 1e-3 }, aides);
        await dormir(50);
        pris = budget0 - bm.budgetLibreMo();
      }
      assert.ok(pris > 0, `les tampons des aides sont comptés dans le fil principal (budget ${budget0} → ${bm.budgetLibreMo()} Mo)`);
      assert.ok(pris <= 3 * 256, `et bornés (${pris} Mo pour 3 aides)`);
      // Pression vue par le comptable du fil principal : les aides vident leurs tampons à leur portée suivante, et
      // aucune nouvelle part ne leur est accordée tant qu'elle dure ; la séance reste juste.
      process.env.ODIN_MEMOIRE_LIBRE_MO = '100';
      bm.budgetLibreMo();
      const av = await seanceParallele(r, [{ entrees }], { dureeMs: 120_000, graine: 99, tailleLot: 4, lr: 1e-3 }, aides);
      assert.ok(av.pas > 0 && Number.isFinite(av.perte), 'séance faite sous pression');
      await dormir(50);
      process.env.ODIN_MEMOIRE_LIBRE_MO = '20000';
      assert.equal(bm.budgetLibreMo(), budget0, 'sous pression, les aides ont tout rendu');
    } finally { await arreterAides(aides); }
    for (let i = 0; i < 100 && bm.budgetLibreMo() < budget0; i++) await dormir(20);
    assert.equal(bm.budgetLibreMo(), budget0, 'part des aides rendue quand elles s\'arrêtent');
  } finally { delete process.env.ODIN_MEMOIRE_LIBRE_MO; }
});

test('poids figés comme dans le fil du moteur : les copies de travail servent d\'un appel à l\'autre et suivent chaque changement', () => {
  // Le fil du moteur fige ses poids (ils n'y changent que par le réseau) : une réponse, un plongement, un score ne
  // recopient plus les poids. Vérifié sur le réseau lui-même, comme le fait le fil : après un pas, un retour à un
  // point (importerPoids) ou 'poidsModifies', les sorties sont celles de la référence sur les nouveaux poids.
  const h = hyperDe('petit'), r = new Reseau(h); r.initialiser(5); r.figerPoids();
  const ref = (): InstanceType<typeof ReseauAncien> => { const x = new ReseauAncien(h); x.importerPoids(r.poids); return x; };
  const am = suite(30, h.vocab, 1);
  assert.deepEqual(r.generer(am, 6).ids, ref().generer(am, 6).ids);
  r.perteEtGrad(suite(100, h.vocab, 2)); r.pasAdamW(1e-2);
  assert.ok(ecartRel(r.logitsDerniere(am), ref().logitsDerniere(am)) <= TOL, 'après un pas');
  const autre = new Reseau(h); autre.initialiser(77); r.importerPoids(autre.poids);
  assert.ok(ecartRel(r.logitsDerniere(am), ref().logitsDerniere(am)) <= TOL, 'après importerPoids');
  for (let i = 0; i < r.poids.length; i++) r.poids[i] *= 0.9;
  r.poidsModifies();
  assert.ok(ecartRel(r.plonger(am), ref().plonger(am)) <= TOL, 'après poidsModifies');
});
