// L'œil : un encodeur d'images de la famille des transformeurs de vision (ViT), et son encodeur de texte jumeau (type
// CLIP), CALCULÉS par Odin à partir de poids OUVERTS téléchargés une fois. La passe avant est écrite ici ; elle réutilise
// SEULEMENT les noyaux de calcul de Noûs (produit de matrices WebAssembly). L'attention est BIDIRECTIONNELLE (chaque
// position regarde toutes les autres), pas causale : on n'emprunte donc pas la passe avant du décodeur de texte.
//
// HONNÊTE : ouvrirOeil() ne lève jamais. Sans poids, l'œil renvoyé a pret=false et dégrade (listes vides, essaye=false,
// lue=false). Rien n'affirme « comprend » tant qu'un vrai poids n'a pas tourné et été mesuré.

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { noyaux } from '../brain/nous/wasm.ts';
import { capaciteMachine, peutCharger } from '../brain/metis/mesure.ts';
import type {
  Description, Etiquette, ImageDecodee, LectureImage, Oeil, SignalArret,
} from './index.ts';
import { redimensionner, normaliser } from './image.ts';
import { lirePoids, type Poids, type TenseurVision } from './poids.ts';
import { chargerOcr, type Ocr } from './ocr.ts';
import { chargerVlm, type Vlm } from './vlm.ts';

/** Une couche linéaire, poids déjà transposés en [entrée, sortie] pour le produit de matrices des noyaux. */
interface Lineaire { poids: Float32Array; biais: Float32Array; entree: number; sortie: number }

interface Bloc {
  ln1g: Float32Array; ln1b: Float32Array;
  q: Lineaire; k: Lineaire; v: Lineaire; sortie: Lineaire;
  ln2g: Float32Array; ln2b: Float32Array;
  ff1: Lineaire; ff2: Lineaire;
}

interface ModeleImage {
  dim: number; dimSortie: number; image: number; patch: number; tetes: number;
  moy: [number, number, number]; ec: [number, number, number];
  projPatch: Lineaire; jetonClasse: Float32Array; pos: Float32Array; blocs: Bloc[];
  lnFg: Float32Array; lnFb: Float32Array; projSortie?: Float32Array; // [dimSortie, dim]
}

interface ModeleTexte {
  dim: number; dimSortie: number; tetes: number; maxLong: number;
  vocab: Map<string, number>; embed: Float32Array; pos: Float32Array; blocs: Bloc[];
  lnFg: Float32Array; lnFb: Float32Array; projSortie?: Float32Array;
}

const EPS = 1e-5;

// ---------- Petites opérations (lisibles ; les gros produits passent par les noyaux) ----------

/** Produit X[T,entree] · W[entree,sortie] + biais → [T,sortie], via les noyaux de calcul. */
function lineaire(x: Float32Array, T: number, lin: Lineaire): Float32Array {
  const y = new Float32Array(T * lin.sortie);
  noyaux().mm(y, x, lin.poids, T, lin.entree, lin.sortie);
  for (let t = 0; t < T; t++) for (let s = 0; s < lin.sortie; s++) y[t * lin.sortie + s] += lin.biais[s];
  return y;
}

/** Normalisation de couche sur la dernière dimension (dim), en place. */
function normCouche(x: Float32Array, T: number, dim: number, g: Float32Array, b: Float32Array): void {
  for (let t = 0; t < T; t++) {
    const o = t * dim;
    let moy = 0; for (let i = 0; i < dim; i++) moy += x[o + i]; moy /= dim;
    let v = 0; for (let i = 0; i < dim; i++) { const d = x[o + i] - moy; v += d * d; } v /= dim;
    const inv = 1 / Math.sqrt(v + EPS);
    for (let i = 0; i < dim; i++) x[o + i] = (x[o + i] - moy) * inv * g[i] + b[i];
  }
}

function gelu(v: number): number {
  return 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v)));
}

/** Attention multi-têtes BIDIRECTIONNELLE sur une séquence x[T,dim], en place (résidu + pré-LN gérés par l'appelant). */
function attention(x: Float32Array, T: number, dim: number, tetes: number, bloc: Bloc): Float32Array {
  const q = lineaire(x, T, bloc.q), k = lineaire(x, T, bloc.k), v = lineaire(x, T, bloc.v);
  const dh = dim / tetes;
  const echelle = 1 / Math.sqrt(dh);
  const ctx = new Float32Array(T * dim);
  const scores = new Float32Array(T);
  for (let h = 0; h < tetes; h++) {
    const base = h * dh;
    for (let i = 0; i < T; i++) {
      let maxS = -Infinity;
      for (let j = 0; j < T; j++) { // j sur TOUTES les positions : bidirectionnel.
        let s = 0;
        for (let d = 0; d < dh; d++) s += q[i * dim + base + d] * k[j * dim + base + d];
        s *= echelle; scores[j] = s; if (s > maxS) maxS = s;
      }
      let somme = 0;
      for (let j = 0; j < T; j++) { scores[j] = Math.exp(scores[j] - maxS); somme += scores[j]; }
      const inv = somme > 0 ? 1 / somme : 0;
      for (let j = 0; j < T; j++) {
        const a = scores[j] * inv;
        for (let d = 0; d < dh; d++) ctx[i * dim + base + d] += a * v[j * dim + base + d];
      }
    }
  }
  return lineaire(ctx, T, bloc.sortie);
}

/** Un bloc transformeur pré-LN : x += attn(ln1(x)) ; x += ff(ln2(x)). */
function passeBloc(x: Float32Array, T: number, dim: number, tetes: number, bloc: Bloc): void {
  const n1 = x.slice();
  normCouche(n1, T, dim, bloc.ln1g, bloc.ln1b);
  const a = attention(n1, T, dim, tetes, bloc);
  for (let i = 0; i < x.length; i++) x[i] += a[i];
  const n2 = x.slice();
  normCouche(n2, T, dim, bloc.ln2g, bloc.ln2b);
  const h = lineaire(n2, T, bloc.ff1);
  for (let i = 0; i < h.length; i++) h[i] = gelu(h[i]);
  const o = lineaire(h, T, bloc.ff2);
  for (let i = 0; i < x.length; i++) x[i] += o[i];
}

/** Normalise un vecteur en L2 (norme 1). */
function l2(v: Float32Array): Float32Array {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

// ---------- Construction d'un modèle depuis les poids ----------

/** Transpose un tenseur linéaire [sortie, entree] en [entree, sortie] pour les noyaux ; lit le biais. */
function lireLineaire(p: Poids, prefixe: string): Lineaire {
  const w = p.tenseur(`${prefixe}.poids`);
  if (w.dims.length !== 2) throw new Error(`${prefixe}.poids n'est pas une matrice`);
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

function lireMoyEc(p: Poids): { moy: [number, number, number]; ec: [number, number, number] } {
  // moy/ec LUS avec les poids, jamais devinés : absents ⇒ on refuse ce modèle (il dégradera).
  const lire3 = (cle: string): [number, number, number] => {
    const parts = (p.meta[cle] ?? '').split(',').map((x) => Number(x.trim()));
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) throw new Error(`poids de vision : « ${cle} » manquant ou invalide`);
    return [parts[0], parts[1], parts[2]];
  };
  const ec = lire3('ec');
  if (ec.some((x) => x === 0)) throw new Error('poids de vision : « ec » contient un écart-type nul');
  return { moy: lire3('moy'), ec };
}

// HONNÊTE : ce chargeur attend un poids au SCHÉMA MAISON d'Odin (tenseurs nommés en français — proj_patch, jeton_classe,
// pos, bloc.N.q… — et la config/vocabulaire rangés dans __metadata__). Un .safetensors d'un modèle ouvert publié (CLIP,
// SigLIP, TrOCR…) n'a PAS ces noms ni cette config intégrée : il faut d'abord le PRÉ-CONVERTIR (remappage des noms,
// extraction de la config et du vocabulaire). Tant que ce convertisseur n'est pas livré, un .safetensors d'origine fait
// dégrader ouvrirOeil à pret=false, et la page le dit (« codé, pas encore essayé sur du vrai modèle »).
function construireModeleImage(p: Poids): ModeleImage {
  const dim = p.nombre('dim', 0), prof = p.nombre('profondeur', 0), tetes = p.nombre('tetes', 0);
  const image = p.nombre('image', 0), patch = p.nombre('patch', 0);
  if (dim <= 0 || prof <= 0 || tetes <= 0 || image <= 0 || patch <= 0) throw new Error('poids de vision : configuration incomplète');
  if (image % patch !== 0) throw new Error('poids de vision : la taille d\'image n\'est pas un multiple du patch');
  if (dim % tetes !== 0) throw new Error('poids de vision : dim non divisible par le nombre de têtes');
  const { moy, ec } = lireMoyEc(p);
  const projSortie = p.a('proj_sortie.poids') ? p.tenseur('proj_sortie.poids') : undefined;
  const dimSortie = projSortie ? projSortie.dims[0] : dim;
  return {
    dim, dimSortie, image, patch, tetes, moy, ec,
    projPatch: lireLineaire(p, 'proj_patch'),
    jetonClasse: lireVec(p, 'jeton_classe'),
    pos: lireVec(p, 'pos'),
    blocs: lireBlocs(p, prof),
    lnFg: lireVec(p, 'ln_final.poids'), lnFb: lireVec(p, 'ln_final.biais'),
    projSortie: projSortie ? applatProj(projSortie) : undefined,
  };
}

/** La projection finale [dimSortie, dim] : on la garde telle quelle (produit vecteur appliqué à la main). */
function applatProj(t: TenseurVision): Float32Array { return t.data; }

/** Applique une projection finale W[dimSortie, dim] à un vecteur x[dim] → y[dimSortie]. */
function projeter(x: Float32Array, W: Float32Array, dim: number, dimSortie: number): Float32Array {
  const y = new Float32Array(dimSortie);
  for (let r = 0; r < dimSortie; r++) { let s = 0; for (let c = 0; c < dim; c++) s += W[r * dim + c] * x[c]; y[r] = s; }
  return y;
}

// ---------- Passe avant image ----------

/** Découpe l'image normalisée CHW en patchs aplatis (c, py, px) dans l'ordre du poids de projection. */
function patchs(chw: Float32Array, image: number, patch: number): { data: Float32Array; nb: number; taillePatch: number } {
  const grille = image / patch;
  const nb = grille * grille;
  const taillePatch = 3 * patch * patch;
  const out = new Float32Array(nb * taillePatch);
  const planH = image, planW = image, plan = planH * planW;
  let idx = 0;
  for (let gy = 0; gy < grille; gy++) {
    for (let gx = 0; gx < grille; gx++) {
      let o = idx * taillePatch;
      for (let c = 0; c < 3; c++) {
        for (let py = 0; py < patch; py++) {
          for (let px = 0; px < patch; px++) {
            out[o++] = chw[c * plan + (gy * patch + py) * planW + (gx * patch + px)];
          }
        }
      }
      idx++;
    }
  }
  return { data: out, nb, taillePatch };
}

function encoderImage(m: ModeleImage, img: ImageDecodee): Float32Array {
  const prep = redimensionner(img, m.image);
  const chw = normaliser(prep, m.moy, m.ec);
  const { data: pats, nb } = patchs(chw, m.image, m.patch);
  const emb = lineaire(pats, nb, m.projPatch); // [nb, dim]
  const T = nb + 1;
  const x = new Float32Array(T * m.dim);
  for (let i = 0; i < m.dim; i++) x[i] = m.jetonClasse[i]; // jeton de classe en position 0
  x.set(emb, m.dim);
  const nPos = Math.min(T, m.pos.length / m.dim);
  for (let t = 0; t < nPos; t++) for (let i = 0; i < m.dim; i++) x[t * m.dim + i] += m.pos[t * m.dim + i];
  for (const bloc of m.blocs) passeBloc(x, T, m.dim, m.tetes, bloc);
  normCouche(x, T, m.dim, m.lnFg, m.lnFb);
  let vec: Float32Array = x.slice(0, m.dim); // sortie du jeton de classe
  if (m.projSortie) vec = projeter(vec, m.projSortie, m.dim, m.dimSortie);
  return l2(vec);
}

// ---------- Passe avant texte ----------

/** Découpe une phrase en jetons connus du vocabulaire (sinon ignorés), en minuscules. */
function jetonniser(phrase: string, vocab: Map<string, number>, maxLong: number): number[] {
  const mots = phrase.toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean);
  const ids: number[] = [];
  for (const mot of mots) {
    const id = vocab.get(mot);
    if (id !== undefined) ids.push(id);
    if (ids.length >= maxLong) break;
  }
  return ids;
}

function encoderTexte(m: ModeleTexte, phrase: string): Float32Array | undefined {
  const ids = jetonniser(phrase, m.vocab, m.maxLong);
  if (ids.length === 0) return undefined; // honnête : aucun mot connu → pas de plongement inventé.
  const T = ids.length, dim = m.dim;
  const x = new Float32Array(T * dim);
  for (let t = 0; t < T; t++) {
    const base = ids[t] * dim;
    for (let i = 0; i < dim; i++) x[t * dim + i] = m.embed[base + i] + m.pos[(t % (m.pos.length / dim)) * dim + i];
  }
  for (const bloc of m.blocs) passeBloc(x, T, dim, m.tetes, bloc);
  normCouche(x, T, dim, m.lnFg, m.lnFb);
  // Moyenne des positions (regroupement stable, sans dépendre d'un jeton de fin particulier).
  const moy = new Float32Array(dim);
  for (let t = 0; t < T; t++) for (let i = 0; i < dim; i++) moy[i] += x[t * dim + i];
  for (let i = 0; i < dim; i++) moy[i] /= T;
  let vec: Float32Array = moy;
  if (m.projSortie) vec = projeter(vec, m.projSortie, dim, m.dimSortie);
  return l2(vec);
}

function construireModeleTexte(p: Poids): ModeleTexte {
  const dim = p.nombre('dim', 0), prof = p.nombre('profondeur', 0), tetes = p.nombre('tetes', 0);
  const maxLong = p.nombre('max_long', 64);
  if (dim <= 0 || prof <= 0 || tetes <= 0) throw new Error('poids de texte : configuration incomplète');
  if (dim % tetes !== 0) throw new Error('poids de texte : dim non divisible par le nombre de têtes');
  const vocab = new Map<string, number>();
  const brut = p.meta['vocab'];
  if (brut) { try { const o = JSON.parse(brut) as Record<string, number>; for (const [k, v] of Object.entries(o)) vocab.set(k, v); } catch { /* vocab absent */ } }
  if (vocab.size === 0) throw new Error('poids de texte : vocabulaire absent');
  const projSortie = p.a('proj_sortie.poids') ? p.tenseur('proj_sortie.poids') : undefined;
  return {
    dim, dimSortie: projSortie ? projSortie.dims[0] : dim, tetes, maxLong, vocab,
    embed: lireVec(p, 'embed'), pos: lireVec(p, 'pos'), blocs: lireBlocs(p, prof),
    lnFg: lireVec(p, 'ln_final.poids'), lnFb: lireVec(p, 'ln_final.biais'),
    projSortie: projSortie ? projSortie.data : undefined,
  };
}

// ---------- Ouverture de l'œil ----------

const FICHIER_IMAGE = 'oeil-image.safetensors';
const FICHIER_TEXTE = 'oeil-texte.safetensors';

function arrete(signal?: SignalArret): boolean { return signal ? signal.aborted : false; }

async function tailleSiPresent(chemin: string): Promise<number> {
  try { const s = await stat(chemin); return s.isFile() ? s.size : 0; } catch { return 0; }
}

/** Œil dégradé : rien n'est chargé. Toutes les méthodes répondent honnêtement « rien vu ». */
function oeilVide(ocr: Ocr | undefined, vlm: Vlm | undefined): Oeil {
  return construireOeil(undefined, undefined, undefined, ocr, vlm);
}

function construireOeil(mImage: ModeleImage | undefined, mTexte: ModeleTexte | undefined, modeleNom: string | undefined, ocr: Ocr | undefined, vlm: Vlm | undefined): Oeil {
  const dim = mImage ? mImage.dimSortie : 0;
  const repliDescription = async (img: ImageDecodee, question: string, signal?: SignalArret): Promise<Description> => {
    const t0 = performance.now();
    const bouts: string[] = [];
    let conf = 0;
    const lecture = await lireTexteInterne(img, 'fra+eng', signal);
    if (lecture.lue && lecture.texte.trim()) { bouts.push(`texte lu : « ${lecture.texte.trim().slice(0, 400)} »`); conf = Math.max(conf, lecture.confiance); }
    if (bouts.length === 0) bouts.push('aucun modèle image→texte chargé : description indisponible');
    return { texte: bouts.join(' ; '), confiance: conf, tempsMs: Math.round(performance.now() - t0), modele: modeleNom ?? '', essaye: false };
  };
  const lireTexteInterne = async (img: ImageDecodee, langues: string | undefined, signal?: SignalArret): Promise<LectureImage> => {
    const t0 = performance.now();
    if (!ocr || arrete(signal)) return { texte: '', confiance: 0, tempsMs: Math.round(performance.now() - t0), lignes: [], lue: false };
    try { return await ocr.lire(img, langues ?? 'fra+eng', signal); }
    catch { return { texte: '', confiance: 0, tempsMs: Math.round(performance.now() - t0), lignes: [], lue: false }; }
  };
  // Cache des plongements de mots/notions : la liste de notions est « extensible » (des centaines de mots) et reclassée à
  // chaque image. Sans cache, chaque étiquetage repayait N passes transformeur texte. Avec, c'est 1 encodeur image + N
  // produits scalaires. Clé = mot (déjà en minuscules par le jetoniseur). Valeur `null` = mot sans aucun jeton connu.
  const cacheTexte = new Map<string, Float32Array | null>();
  const encoderTexteCache = (phrase: string): Float32Array | undefined => {
    if (!mTexte) return undefined;
    const cle = phrase.toLowerCase().normalize('NFC');
    if (cacheTexte.has(cle)) return cacheTexte.get(cle) ?? undefined;
    const vt = encoderTexte(mTexte, phrase) ?? null;
    cacheTexte.set(cle, vt);
    return vt ?? undefined;
  };
  return {
    pret: !!mImage,
    modele: mImage ? (modeleNom ?? '') : '',
    aVLM: !!vlm,
    dim,
    async etiquettes(img, mots, signal) {
      if (!mImage || !mTexte || mots.length === 0 || arrete(signal)) return [];
      const vi = encoderImage(mImage, img);
      const out: Etiquette[] = [];
      for (const mot of mots) {
        if (arrete(signal)) break;
        const vt = encoderTexteCache(mot); // mis en cache : une notion déjà vue n'est pas réencodée.
        if (!vt || vt.length !== vi.length) continue;
        let s = 0; for (let i = 0; i < vi.length; i++) s += vi[i] * vt[i];
        out.push({ mot, score: s });
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    },
    async plongementImage(img, signal) {
      if (!mImage || arrete(signal)) return new Float32Array(0);
      return encoderImage(mImage, img);
    },
    async plongementTexte(phrase, signal) {
      if (!mTexte || arrete(signal)) return new Float32Array(0);
      return encoderTexteCache(phrase) ?? new Float32Array(0);
    },
    async decrire(img, question, signal) {
      if (vlm && !arrete(signal)) {
        const t0 = performance.now();
        try {
          const r = await vlm.decrire(img, question, signal);
          return { texte: r.texte, confiance: r.confiance, tempsMs: Math.round(performance.now() - t0), modele: vlm.modele, essaye: true };
        } catch { /* repli ci-dessous */ }
      }
      return repliDescription(img, question, signal);
    },
    lireTexte(img, langues, signal) { return lireTexteInterne(img, langues, signal); },
  };
}

/** Ouvre l'œil : charge les poids présents dans `o.cache`, mesure ce qui tient, dégrade sinon. Ne lève JAMAIS. */
export async function ouvrirOeil(o?: { cache?: string; signal?: SignalArret }): Promise<Oeil> {
  const cache = o?.cache ?? '';
  let cap;
  try { cap = await capaciteMachine(); } catch { cap = { gflops: 0.01, ramLibreMo: 0, octetsMax: 0 }; }

  // OCR et VLM se chargent séparément (couches tardives) ; ils ne bloquent pas l'œil.
  let ocr: Ocr | undefined;
  let vlm: Vlm | undefined;
  try { ocr = await chargerOcr(cache, cap); } catch { ocr = undefined; }
  try { vlm = await chargerVlm(cache, cap); } catch { vlm = undefined; }

  if (!cache) return oeilVide(ocr, vlm);

  // Encodeur d'images.
  let mImage: ModeleImage | undefined;
  let nom = '';
  try {
    const chemin = join(cache, FICHIER_IMAGE);
    const taille = await tailleSiPresent(chemin);
    if (taille > 0 && peutCharger(taille, cap)) {
      const p = await lirePoids(chemin);
      mImage = construireModeleImage(p);
      nom = p.meta['nom'] ?? FICHIER_IMAGE;
    }
  } catch { mImage = undefined; }

  // Encodeur de texte (jumeau).
  let mTexte: ModeleTexte | undefined;
  try {
    const chemin = join(cache, FICHIER_TEXTE);
    const taille = await tailleSiPresent(chemin);
    if (taille > 0 && peutCharger(taille, cap)) {
      const p = await lirePoids(chemin);
      mTexte = construireModeleTexte(p);
    }
  } catch { mTexte = undefined; }

  return construireOeil(mImage, mTexte, nom, ocr, vlm);
}
