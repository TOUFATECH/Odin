// VLM — un petit modèle image→texte (décrire une image, répondre à une question dessus), CALCULÉ par Odin à partir d'un
// poids ouvert. Architecture « préfixe » (type Fuyu) : les jetons visuels (patchs projetés) sont mis en tête de la
// séquence, puis un transformeur CAUSAL génère le texte. Aucune dépendance externe.
//
// HONNÊTE : on ne le charge QUE si le poids est présent, qu'il tient en mémoire (peutCharger) et que le temps par image
// MESURÉ reste tenable. Sinon chargerVlm renvoie undefined, et l'œil reste aux étiquettes + OCR (decrire essaye=false).
// Rien n'affirme « comprend » tant qu'un vrai poids n'a pas tourné et été mesuré ; le temps mesuré est renvoyé.

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { noyaux } from '../brain/nous/wasm.ts';
import type { CapaciteMachine } from '../brain/metis/types.ts';
import { peutCharger, memoireNecessaireOctets } from '../brain/metis/mesure.ts';
import type { ImageDecodee, SignalArret } from './index.ts';
import { redimensionner, normaliser } from './image.ts';
import { lirePoids, type Poids } from './poids.ts';

const FICHIER_VLM = 'vlm.safetensors';
/** Plafond honnête : au-delà de ce temps par image MESURÉ, on juge le modèle trop lourd pour cette machine. */
const PLAFOND_MS = 60_000;
/** Nombre maximal de jetons générés pour une description. */
const MAX_JETONS = 48;
const EPS = 1e-5;

/** Un modèle image→texte prêt, avec le temps par image mesuré. */
export interface Vlm {
  readonly modele: string;
  readonly tempsMesureMs: number;
  decrire(img: ImageDecodee, question: string, signal?: SignalArret): Promise<{ texte: string; confiance: number }>;
}

interface Lineaire { poids: Float32Array; biais: Float32Array; entree: number; sortie: number }
interface Bloc { ln1g: Float32Array; ln1b: Float32Array; q: Lineaire; k: Lineaire; v: Lineaire; sortie: Lineaire; ln2g: Float32Array; ln2b: Float32Array; ff1: Lineaire; ff2: Lineaire }
interface ModeleVlm {
  dim: number; tetes: number; image: number; patch: number; maxSeq: number;
  moy: [number, number, number]; ec: [number, number, number];
  projPatch: Lineaire; posVisuel: Float32Array;
  embed: Float32Array; posTexte: Float32Array; blocs: Bloc[];
  lnFg: Float32Array; lnFb: Float32Array; tete: Lineaire;
  vocab: Map<string, number>; inverse: string[]; bos: number; eos: number;
}

// ---------- Petites opérations (locales à ce module) ----------

function lineaire(x: Float32Array, T: number, lin: Lineaire): Float32Array {
  const y = new Float32Array(T * lin.sortie);
  noyaux().mm(y, x, lin.poids, T, lin.entree, lin.sortie);
  for (let t = 0; t < T; t++) for (let s = 0; s < lin.sortie; s++) y[t * lin.sortie + s] += lin.biais[s];
  return y;
}
function normCouche(x: Float32Array, T: number, dim: number, g: Float32Array, b: Float32Array): void {
  for (let t = 0; t < T; t++) {
    const o = t * dim; let moy = 0; for (let i = 0; i < dim; i++) moy += x[o + i]; moy /= dim;
    let v = 0; for (let i = 0; i < dim; i++) { const d = x[o + i] - moy; v += d * d; } v /= dim;
    const inv = 1 / Math.sqrt(v + EPS);
    for (let i = 0; i < dim; i++) x[o + i] = (x[o + i] - moy) * inv * g[i] + b[i];
  }
}
function gelu(v: number): number { return 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v))); }

/** Attention multi-têtes CAUSALE (i ne regarde que j ≤ i) sur x[T,dim]. */
function attentionCausale(x: Float32Array, T: number, dim: number, tetes: number, bloc: Bloc): Float32Array {
  const q = lineaire(x, T, bloc.q), k = lineaire(x, T, bloc.k), v = lineaire(x, T, bloc.v);
  const dh = dim / tetes, echelle = 1 / Math.sqrt(dh);
  const ctx = new Float32Array(T * dim), scores = new Float32Array(T);
  for (let h = 0; h < tetes; h++) {
    const base = h * dh;
    for (let i = 0; i < T; i++) {
      let maxS = -Infinity;
      for (let j = 0; j <= i; j++) { let s = 0; for (let d = 0; d < dh; d++) s += q[i * dim + base + d] * k[j * dim + base + d]; s *= echelle; scores[j] = s; if (s > maxS) maxS = s; }
      let somme = 0; for (let j = 0; j <= i; j++) { scores[j] = Math.exp(scores[j] - maxS); somme += scores[j]; }
      const inv = somme > 0 ? 1 / somme : 0;
      for (let j = 0; j <= i; j++) { const a = scores[j] * inv; for (let d = 0; d < dh; d++) ctx[i * dim + base + d] += a * v[j * dim + base + d]; }
    }
  }
  return lineaire(ctx, T, bloc.sortie);
}
function passeBlocCausal(x: Float32Array, T: number, dim: number, tetes: number, bloc: Bloc): void {
  const n1 = x.slice(); normCouche(n1, T, dim, bloc.ln1g, bloc.ln1b);
  const a = attentionCausale(n1, T, dim, tetes, bloc); for (let i = 0; i < x.length; i++) x[i] += a[i];
  const n2 = x.slice(); normCouche(n2, T, dim, bloc.ln2g, bloc.ln2b);
  const hh = lineaire(n2, T, bloc.ff1); for (let i = 0; i < hh.length; i++) hh[i] = gelu(hh[i]);
  const o = lineaire(hh, T, bloc.ff2); for (let i = 0; i < x.length; i++) x[i] += o[i];
}

// ---------- Construction du modèle ----------

function lireLineaire(p: Poids, prefixe: string): Lineaire {
  const w = p.tenseur(`${prefixe}.poids`);
  const [sortie, entree] = w.dims;
  const t = new Float32Array(entree * sortie);
  for (let r = 0; r < sortie; r++) for (let c = 0; c < entree; c++) t[c * sortie + r] = w.data[r * entree + c];
  const biais = p.a(`${prefixe}.biais`) ? p.tenseur(`${prefixe}.biais`).data : new Float32Array(sortie);
  return { poids: t, biais, entree, sortie };
}
function lireVec(p: Poids, nom: string): Float32Array { return p.tenseur(nom).data; }
function lireBlocs(p: Poids, prof: number): Bloc[] {
  const blocs: Bloc[] = [];
  for (let l = 0; l < prof; l++) {
    const b = `bloc.${l}`;
    blocs.push({
      ln1g: lireVec(p, `${b}.ln1.poids`), ln1b: lireVec(p, `${b}.ln1.biais`),
      q: lireLineaire(p, `${b}.q`), k: lireLineaire(p, `${b}.k`), v: lireLineaire(p, `${b}.v`), sortie: lireLineaire(p, `${b}.sortie`),
      ln2g: lireVec(p, `${b}.ln2.poids`), ln2b: lireVec(p, `${b}.ln2.biais`),
      ff1: lireLineaire(p, `${b}.ff1`), ff2: lireLineaire(p, `${b}.ff2`),
    });
  }
  return blocs;
}
function lire3(p: Poids, cle: string): [number, number, number] {
  const parts = (p.meta[cle] ?? '').split(',').map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) throw new Error(`VLM : « ${cle} » manquant ou invalide`);
  return [parts[0], parts[1], parts[2]];
}

function construireModeleVlm(p: Poids): ModeleVlm {
  const dim = p.nombre('dim', 0), prof = p.nombre('profondeur', 0), tetes = p.nombre('tetes', 0);
  const image = p.nombre('image', 0), patch = p.nombre('patch', 0), maxSeq = p.nombre('max_seq', 256);
  if (dim <= 0 || prof <= 0 || tetes <= 0 || image <= 0 || patch <= 0 || image % patch !== 0 || dim % tetes !== 0) throw new Error('VLM : configuration incomplète');
  const ec = lire3(p, 'ec'); if (ec.some((x) => x === 0)) throw new Error('VLM : « ec » nul');
  const vocab = new Map<string, number>(); const inverse: string[] = [];
  const brut = p.meta['vocab']; if (!brut) throw new Error('VLM : vocabulaire absent');
  const o = JSON.parse(brut) as Record<string, number>;
  for (const [k, v] of Object.entries(o)) { vocab.set(k, v); inverse[v] = k; }
  const bos = p.nombre('bos', 1), eos = p.nombre('eos', 2);
  return {
    dim, tetes, image, patch, maxSeq, moy: lire3(p, 'moy'), ec,
    projPatch: lireLineaire(p, 'proj_patch'), posVisuel: lireVec(p, 'pos_visuel'),
    embed: lireVec(p, 'embed'), posTexte: lireVec(p, 'pos_texte'), blocs: lireBlocs(p, prof),
    lnFg: lireVec(p, 'ln_final.poids'), lnFb: lireVec(p, 'ln_final.biais'), tete: lireLineaire(p, 'tete'),
    vocab, inverse, bos, eos,
  };
}

// ---------- Génération ----------

function jetonsVisuels(m: ModeleVlm, img: ImageDecodee): Float32Array {
  const prep = redimensionner(img, m.image);
  const chw = normaliser(prep, m.moy, m.ec);
  const grille = m.image / m.patch, nb = grille * grille, taillePatch = 3 * m.patch * m.patch;
  const pats = new Float32Array(nb * taillePatch), plan = m.image * m.image;
  let idx = 0;
  for (let gy = 0; gy < grille; gy++) for (let gx = 0; gx < grille; gx++) {
    let o = idx * taillePatch;
    for (let c = 0; c < 3; c++) for (let py = 0; py < m.patch; py++) for (let px = 0; px < m.patch; px++) pats[o++] = chw[c * plan + (gy * m.patch + py) * m.image + (gx * m.patch + px)];
    idx++;
  }
  const emb = lineaire(pats, nb, m.projPatch); // [nb, dim]
  const nPos = Math.min(nb, m.posVisuel.length / m.dim);
  for (let t = 0; t < nPos; t++) for (let i = 0; i < m.dim; i++) emb[t * m.dim + i] += m.posVisuel[t * m.dim + i];
  return emb;
}

function jetonniserTexte(m: ModeleVlm, phrase: string): number[] {
  const mots = phrase.toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean);
  const ids: number[] = [];
  for (const mot of mots) { const id = m.vocab.get(mot); if (id !== undefined) ids.push(id); }
  return ids;
}

/** Une passe complète sur la séquence [jetons visuels ; jetons texte] → logits du dernier pas + dim. */
function passeComplete(m: ModeleVlm, visuel: Float32Array, nbVis: number, idsTexte: number[]): { logits: Float32Array; conf: number } {
  const Tt = idsTexte.length, T = nbVis + Tt, dim = m.dim;
  if (T > m.maxSeq) throw new Error('VLM : séquence trop longue');
  const x = new Float32Array(T * dim);
  x.set(visuel.subarray(0, nbVis * dim), 0);
  const nPosT = m.posTexte.length / dim;
  for (let t = 0; t < Tt; t++) {
    const base = idsTexte[t] * dim;
    for (let i = 0; i < dim; i++) x[(nbVis + t) * dim + i] = m.embed[base + i] + m.posTexte[(t % nPosT) * dim + i];
  }
  for (const bloc of m.blocs) passeBlocCausal(x, T, dim, m.tetes, bloc);
  normCouche(x, T, dim, m.lnFg, m.lnFb);
  const dernier = x.subarray((T - 1) * dim, T * dim);
  const logits = lineaire(dernier, 1, m.tete);
  // Confiance = probabilité softmax du jeton choisi.
  let maxv = -Infinity; for (let i = 0; i < logits.length; i++) if (logits[i] > maxv) maxv = logits[i];
  let somme = 0; for (let i = 0; i < logits.length; i++) somme += Math.exp(logits[i] - maxv);
  return { logits, conf: 1 / (somme || 1) };
}

function argmax(v: Float32Array): number { let m = 0, mv = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > mv) { mv = v[i]; m = i; } return m; }

function generer(m: ModeleVlm, img: ImageDecodee, question: string, signal?: SignalArret): { texte: string; confiance: number } {
  const visuel = jetonsVisuels(m, img);
  const nbVis = visuel.length / m.dim;
  const ids: number[] = [m.bos, ...jetonniserTexte(m, question)];
  const produits: string[] = [];
  let sommeConf = 0, n = 0;
  for (let pas = 0; pas < MAX_JETONS; pas++) {
    if (signal?.aborted) break;
    const { logits, conf } = passeComplete(m, visuel, nbVis, ids);
    const suivant = argmax(logits);
    if (suivant === m.eos) break;
    ids.push(suivant);
    const mot = m.inverse[suivant]; if (mot) produits.push(mot);
    sommeConf += conf; n++;
    if (ids.length >= m.maxSeq) break;
  }
  return { texte: produits.join(' ').trim(), confiance: n > 0 ? sommeConf / n : 0 };
}

/** Charge le VLM si présent, s'il tient en mémoire et si le temps par image mesuré reste tenable ; sinon undefined. */
export async function chargerVlm(cache: string, cap: CapaciteMachine): Promise<Vlm | undefined> {
  if (!cache) return undefined;
  const chemin = join(cache, FICHIER_VLM);
  let taille = 0;
  try { const s = await stat(chemin); taille = s.isFile() ? s.size : 0; } catch { return undefined; }
  if (taille <= 0 || !peutCharger(taille, cap)) return undefined;
  let m: ModeleVlm; let nom: string;
  try { const p = await lirePoids(chemin); m = construireModeleVlm(p); nom = p.meta['nom'] ?? FICHIER_VLM; }
  catch { return undefined; }
  // Refus honnête par la GÉOMÉTRIE : poids matérialisés + mémoire d'attention estimée.
  const params = m.embed.length + m.tete.poids.length + m.blocs.length * (4 * m.dim * m.dim + 2 * m.dim * m.projPatch.sortie);
  if (memoireNecessaireOctets(params, m.blocs.length, m.maxSeq, m.dim) > cap.octetsMax) return undefined;
  // MESURE réelle : une image blanche minuscule, un pas de génération, temps extrapolé à MAX_JETONS pas.
  let tempsMesureMs: number;
  try {
    const blanche: ImageDecodee = { largeur: m.image, hauteur: m.image, rgba: new Uint8Array(m.image * m.image * 4).fill(127) };
    const t0 = performance.now();
    const visuel = jetonsVisuels(m, blanche);
    passeComplete(m, visuel, visuel.length / m.dim, [m.bos]);
    tempsMesureMs = Math.round((performance.now() - t0) * MAX_JETONS);
  } catch { return undefined; }
  if (tempsMesureMs > PLAFOND_MS) return undefined; // trop lourd : on le dit en restant à l'étape 3.
  return {
    modele: nom,
    tempsMesureMs,
    async decrire(img, question, signal) { return generer(m, img, question, signal); },
  };
}
