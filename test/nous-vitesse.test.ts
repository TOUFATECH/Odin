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
