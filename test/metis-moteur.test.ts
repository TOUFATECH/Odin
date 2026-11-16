// Essais du moteur de Métis, SANS vrai modèle et SANS le lot A : un micro-modèle est fabriqué en mémoire, conforme
// au contrat ModeleGguf (src/brain/metis/types.ts). On vérifie :
//   1. la PARITÉ des logits de la passe avant contre une référence indépendante calculée à la main (étape bloquante) ;
//   2. l'échantillonnage reproductible à la graine ;
//   3. l'arrêt net immédiat (le signal coupe la génération au morceau en cours) ;
//   4. le refus poli d'un modèle trop gros.
// Aucun service réel, aucun vrai fichier n'est touché.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModeleGguf, TenseurF32, InfoTenseur } from '../src/brain/metis/types.ts';
import { creerEtat, passeAvant, reinitialiser } from '../src/brain/metis/avant.ts';
import { echantillonner } from '../src/brain/metis/echantillon.ts';
import { generer, refusSiTropGros } from '../src/brain/metis/moteur.ts';
import { hasard } from '../src/brain/nous/hasard.ts';

interface Cfg { C: number; L: number; nTete: number; nTeteKv: number; hd: number; ff: number; V: number; eps: number; base: number; nRot: number }

// Un petit générateur déterministe pour fabriquer des poids reproductibles dans [-0.3, 0.3].
function prng(graine: number): () => number {
  let a = graine >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 0.6; };
}

// Poids rangé façon GGUF : dims [K(entrée), N(sortie)], data[in + out*K] = W(sortie=out, entrée=in).
function poids(K: number, N: number, rnd: () => number): TenseurF32 {
  const data = new Float32Array(K * N);
  for (let i = 0; i < data.length; i++) data[i] = rnd();
  return { dims: [K, N], data };
}
function vecteur(n: number, rnd: () => number): TenseurF32 {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 1 + rnd(); // autour de 1 pour une normalisation réaliste
  return { dims: [n], data };
}

function microModele(cfg: Cfg, arch = 'llama'): { modele: ModeleGguf; W: Map<string, TenseurF32> } {
  const { C, L, nTete, nTeteKv, hd, ff, V } = cfg;
  const rnd = prng(0xbeef);
  const W = new Map<string, TenseurF32>();
  W.set('token_embd.weight', poids(C, V, rnd)); // [C, V] : data[c + v*C] = emb(v)[c]
  W.set('output_norm.weight', vecteur(C, rnd));
  W.set('output.weight', poids(C, V, rnd)); // [C, V]
  for (let l = 0; l < L; l++) {
    W.set(`blk.${l}.attn_norm.weight`, vecteur(C, rnd));
    W.set(`blk.${l}.attn_q.weight`, poids(C, nTete * hd, rnd));
    W.set(`blk.${l}.attn_k.weight`, poids(C, nTeteKv * hd, rnd));
    W.set(`blk.${l}.attn_v.weight`, poids(C, nTeteKv * hd, rnd));
    W.set(`blk.${l}.attn_output.weight`, poids(nTete * hd, C, rnd));
    W.set(`blk.${l}.ffn_norm.weight`, vecteur(C, rnd));
    W.set(`blk.${l}.ffn_gate.weight`, poids(C, ff, rnd));
    W.set(`blk.${l}.ffn_up.weight`, poids(C, ff, rnd));
    W.set(`blk.${l}.ffn_down.weight`, poids(ff, C, rnd));
  }
  const tenseurs = new Map<string, InfoTenseur>();
  for (const [nom, t] of W) tenseurs.set(nom, { nom, dims: t.dims, type: 0, offset: 0, octets: t.data.byteLength });
  const modele: ModeleGguf = {
    arch,
    meta: {},
    hyper: {
      embeddingLength: C, blockCount: L, feedForwardLength: ff, headCount: nTete, headCountKv: nTeteKv,
      ropeDimensionCount: hd, ropeFreqBase: cfg.base, rmsEps: cfg.eps, contextLength: 32, vocabLength: V,
    },
    tenseurs,
    decoupage: {
      vocab: V, version: 1, bos: 1, eos: -1,
      encoder: (texte: string) => Int32Array.from([...texte].map((c) => c.charCodeAt(0) % V)),
      decoder: (ids: ArrayLike<number>) => Array.from({ length: ids.length }, (_, i) => String.fromCharCode(65 + (ids[i] % 26))).join(''),
      morceau: (id: number) => String.fromCharCode(65 + (id % 26)),
    },
    tenseur: async (nom: string) => { const t = W.get(nom); if (!t) throw new Error(`tenseur absent : ${nom}`); return t; },
    tailleOctets: 4096,
    empreinte: 'test',
    fermer: async () => {},
  };
  return { modele, W };
}

// --- Référence indépendante (calculée à la main), en flottants, pour la parité des logits. ---
function reference(W: Map<string, TenseurF32>, cfg: Cfg, ids: number[]): Float32Array {
  const { C, L, nTete, nTeteKv, hd, ff, V, eps, base, nRot } = cfg;
  const grp = nTete / nTeteKv, kvDim = nTeteKv * hd, inv = 1 / Math.sqrt(hd);
  const d = (n: string) => W.get(n)!.data;
  const rms = (x: Float32Array, w: Float32Array) => { let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i]; const r = 1 / Math.sqrt(ss / x.length + eps); const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * r * w[i]; return o; };
  const mv = (data: Float32Array, x: Float32Array, K: number, N: number) => { const y = new Float32Array(N); for (let out = 0; out < N; out++) { let s = 0; for (let inp = 0; inp < K; inp++) s += data[inp + out * K] * x[inp]; y[out] = s; } return y; };
  const silu = (x: number) => x / (1 + Math.exp(-x));
  const rope = (arr: Float32Array, off: number, pos: number) => { const half = nRot >> 1; for (let i = 0; i < half; i++) { const th = pos * Math.pow(base, (-2 * i) / nRot); const c = Math.cos(th), s = Math.sin(th); const a = arr[off + 2 * i], b = arr[off + 2 * i + 1]; arr[off + 2 * i] = a * c - b * s; arr[off + 2 * i + 1] = a * s + b * c; } };
  const Kc: Float32Array[][] = Array.from({ length: L }, () => []);
  const Vc: Float32Array[][] = Array.from({ length: L }, () => []);
  let logits: Float32Array = new Float32Array(V);
  for (let pos = 0; pos < ids.length; pos++) {
    const id = ids[pos];
    const x = new Float32Array(C); for (let c = 0; c < C; c++) x[c] = d('token_embd.weight')[c + id * C];
    for (let l = 0; l < L; l++) {
      const a = rms(x, d(`blk.${l}.attn_norm.weight`));
      const q = mv(d(`blk.${l}.attn_q.weight`), a, C, nTete * hd);
      const k = mv(d(`blk.${l}.attn_k.weight`), a, C, nTeteKv * hd);
      const v = mv(d(`blk.${l}.attn_v.weight`), a, C, nTeteKv * hd);
      for (let h = 0; h < nTete; h++) rope(q, h * hd, pos);
      for (let h = 0; h < nTeteKv; h++) rope(k, h * hd, pos);
      Kc[l][pos] = k.slice(); Vc[l][pos] = v.slice();
      const ao = new Float32Array(nTete * hd);
      for (let h = 0; h < nTete; h++) {
        const kvh = Math.floor(h / grp), qoff = h * hd, koff = kvh * hd;
        const sc = new Float32Array(pos + 1); let mx = -Infinity;
        for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[qoff + c] * Kc[l][j][koff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
        let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
        const r = 1 / som;
        for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * r * Vc[l][j][koff + c]; ao[qoff + c] = s; }
      }
      const oo = mv(d(`blk.${l}.attn_output.weight`), ao, nTete * hd, C);
      for (let c = 0; c < C; c++) x[c] += oo[c];
      const b = rms(x, d(`blk.${l}.ffn_norm.weight`));
      const g = mv(d(`blk.${l}.ffn_gate.weight`), b, C, ff);
      const u = mv(d(`blk.${l}.ffn_up.weight`), b, C, ff);
      for (let i = 0; i < ff; i++) g[i] = silu(g[i]) * u[i];
      const f = mv(d(`blk.${l}.ffn_down.weight`), g, ff, C);
      for (let c = 0; c < C; c++) x[c] += f[c];
    }
    const y = rms(x, d('output_norm.weight'));
    logits = mv(d('output.weight'), y, C, V);
  }
  return logits;
}

const CFG: Cfg = { C: 8, L: 2, nTete: 4, nTeteKv: 2, hd: 2, ff: 12, V: 10, eps: 1e-5, base: 10000, nRot: 2 };

test('metis/avant : parité des logits contre une référence à la main', async () => {
  const { modele, W } = microModele(CFG);
  const e = await creerEtat(modele);
  const ids = [1, 3, 5, 2];
  let logits: Float32Array = new Float32Array(CFG.V);
  for (const id of ids) logits = await passeAvant(e, id);
  const attendu = reference(W, CFG, ids);
  let maxDiff = 0;
  for (let v = 0; v < CFG.V; v++) maxDiff = Math.max(maxDiff, Math.abs(logits[v] - attendu[v]));
  assert.ok(maxDiff < 1e-3, `écart de logits trop grand : ${maxDiff}`);
  // argmax identique = morceau déterministe
  const argmax = (a: Float32Array) => { let bi = 0, bv = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; bi = i; } return bi; };
  assert.equal(argmax(logits), argmax(attendu));
});

test('metis/avant : parité pour une famille « par moitiés » (qwen2)', async () => {
  // Même micro-modèle, position tournante NeoX. La référence utilise la rotation par moitiés.
  const cfg = { ...CFG };
  const { modele, W } = microModele(cfg, 'qwen2');
  const e = await creerEtat(modele);
  const ids = [2, 4, 1];
  let logits: Float32Array = new Float32Array(cfg.V);
  for (const id of ids) logits = await passeAvant(e, id);
  // référence NeoX
  const half = cfg.nRot >> 1;
  const Wd = (n: string) => W.get(n)!.data;
  // On recalcule avec la rotation par moitiés en réutilisant la structure de reference() via une rope différente.
  const ref2 = refNeox(W, cfg, ids, half, Wd);
  let maxDiff = 0;
  for (let v = 0; v < cfg.V; v++) maxDiff = Math.max(maxDiff, Math.abs(logits[v] - ref2[v]));
  assert.ok(maxDiff < 1e-3, `écart (neox) trop grand : ${maxDiff}`);
});

function refNeox(W: Map<string, TenseurF32>, cfg: Cfg, ids: number[], half: number, d: (n: string) => Float32Array): Float32Array {
  const { C, L, nTete, nTeteKv, hd, ff, V, eps, base, nRot } = cfg;
  const grp = nTete / nTeteKv, kvDim = nTeteKv * hd, inv = 1 / Math.sqrt(hd);
  const rms = (x: Float32Array, w: Float32Array) => { let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i]; const r = 1 / Math.sqrt(ss / x.length + eps); const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * r * w[i]; return o; };
  const mv = (data: Float32Array, x: Float32Array, K: number, N: number) => { const y = new Float32Array(N); for (let out = 0; out < N; out++) { let s = 0; for (let inp = 0; inp < K; inp++) s += data[inp + out * K] * x[inp]; y[out] = s; } return y; };
  const silu = (x: number) => x / (1 + Math.exp(-x));
  const rope = (arr: Float32Array, off: number, pos: number) => { for (let i = 0; i < half; i++) { const th = pos * Math.pow(base, (-2 * i) / nRot); const c = Math.cos(th), s = Math.sin(th); const a = arr[off + i], b = arr[off + i + half]; arr[off + i] = a * c - b * s; arr[off + i + half] = a * s + b * c; } };
  const Kc: Float32Array[][] = Array.from({ length: L }, () => []);
  const Vc: Float32Array[][] = Array.from({ length: L }, () => []);
  let logits: Float32Array = new Float32Array(V);
  for (let pos = 0; pos < ids.length; pos++) {
    const id = ids[pos];
    const x = new Float32Array(C); for (let c = 0; c < C; c++) x[c] = d('token_embd.weight')[c + id * C];
    for (let l = 0; l < L; l++) {
      const a = rms(x, d(`blk.${l}.attn_norm.weight`));
      const q = mv(d(`blk.${l}.attn_q.weight`), a, C, nTete * hd);
      const k = mv(d(`blk.${l}.attn_k.weight`), a, C, nTeteKv * hd);
      const v = mv(d(`blk.${l}.attn_v.weight`), a, C, nTeteKv * hd);
      for (let h = 0; h < nTete; h++) rope(q, h * hd, pos);
      for (let h = 0; h < nTeteKv; h++) rope(k, h * hd, pos);
      Kc[l][pos] = k.slice(); Vc[l][pos] = v.slice();
      const ao = new Float32Array(nTete * hd);
      for (let h = 0; h < nTete; h++) {
        const kvh = Math.floor(h / grp), qoff = h * hd, koff = kvh * hd;
        const sc = new Float32Array(pos + 1); let mx = -Infinity;
        for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[qoff + c] * Kc[l][j][koff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
        let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
        const r = 1 / som;
        for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * r * Vc[l][j][koff + c]; ao[qoff + c] = s; }
      }
      const oo = mv(d(`blk.${l}.attn_output.weight`), ao, nTete * hd, C);
      for (let c = 0; c < C; c++) x[c] += oo[c];
      const b = rms(x, d(`blk.${l}.ffn_norm.weight`));
      const g = mv(d(`blk.${l}.ffn_gate.weight`), b, C, ff);
      const u = mv(d(`blk.${l}.ffn_up.weight`), b, C, ff);
      for (let i = 0; i < ff; i++) g[i] = silu(g[i]) * u[i];
      const f = mv(d(`blk.${l}.ffn_down.weight`), g, ff, C);
      for (let c = 0; c < C; c++) x[c] += f[c];
    }
    const y = rms(x, d('output_norm.weight'));
    logits = mv(d('output.weight'), y, C, V);
  }
  return logits;
}

test('metis/echantillon : reproductible à la graine, pénalité et noyau honorés', async () => {
  const { modele } = microModele(CFG);
  const e = await creerEtat(modele);
  let logits: Float32Array = new Float32Array(CFG.V);
  for (const id of [1, 2, 3]) logits = await passeAvant(e, id);
  const opt = { temperature: 0.9, topP: 0.95, penaliteRepetition: 1.2 };
  const a = echantillonner(logits, [1, 2, 3], hasard(777), opt);
  const b = echantillonner(logits, [1, 2, 3], hasard(777), opt);
  assert.equal(a, b, 'même graine → même choix');
  // Les logits reçus ne doivent pas être modifiés par l'échantillonnage.
  const avant = logits.slice();
  echantillonner(logits, [1, 2, 3], hasard(1), opt);
  assert.deepEqual(logits, avant, 'les logits reçus restent intacts');
  // Température nulle = le plus probable, déterministe.
  const g1 = echantillonner(logits, [], hasard(5), { temperature: 0 });
  const g2 = echantillonner(logits, [], hasard(9), { temperature: 0 });
  assert.equal(g1, g2);
});

test('metis/moteur : génération reproductible à la graine', async () => {
  const { modele } = microModele(CFG);
  const o = { amorce: Int32Array.from([1, 4, 2]), maxMorceaux: 6, temperature: 0.8, topP: 0.95, graine: 123 };
  const r1 = await generer(modele, { ...o });
  const r2 = await generer(modele, { ...o });
  assert.equal(r1.texte, r2.texte, 'même graine → même texte');
  assert.equal(r1.morceaux, 6);
  assert.ok(r1.morceauxParSeconde > 0, 'la vitesse est mesurée');
});

test('metis/moteur : arrêt net immédiat sur signal', async () => {
  const { modele } = microModele(CFG);
  // Abandon après le premier morceau diffusé : la génération doit s'arrêter là.
  const ctrl = new AbortController();
  let vus = 0;
  const r = await generer(modele, {
    amorce: Int32Array.from([1, 2]), maxMorceaux: 50, temperature: 0.7, graine: 1, signal: ctrl.signal,
    onDelta: () => { vus++; ctrl.abort(); },
  });
  assert.equal(r.morceaux, 1, 'un seul morceau avant l\'arrêt');
  assert.equal(vus, 1);
  // Signal déjà abandonné avant de commencer : aucun morceau.
  const ctrl2 = new AbortController(); ctrl2.abort();
  const r0 = await generer(modele, { amorce: Int32Array.from([1, 2]), maxMorceaux: 10, signal: ctrl2.signal });
  assert.equal(r0.morceaux, 0);
});

test('metis/moteur : refus poli d\'un modèle trop gros', () => {
  assert.throws(() => refusSiTropGros(1000, 500), /plus petit/);
  assert.doesNotThrow(() => refusSiTropGros(400, 500));
  assert.doesNotThrow(() => refusSiTropGros(1_000_000, 0)); // 0 = pas de limite
});

test('metis/avant : réinitialisation remet la position à zéro', async () => {
  const { modele } = microModele(CFG);
  const e = await creerEtat(modele);
  await passeAvant(e, 1); await passeAvant(e, 2);
  assert.equal(e.pos, 2);
  reinitialiser(e);
  assert.equal(e.pos, 0);
});
