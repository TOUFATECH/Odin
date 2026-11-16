// OCR — reconnaissance de texte CALCULÉE par Odin (réseau convolutif + récurrent + décodage CTC), à partir d'un poids
// ouvert téléchargé une fois. Aucune dépendance externe (ni tesseract, ni service).
//
// HONNÊTE AVANT TOUT : s'il n'y a pas de poids d'OCR, chargerOcr renvoie undefined, et l'œil répond « page non lue »
// (lue=false). Rien n'est inventé. Quand un vrai poids est présent, on détecte les lignes, on reconnaît chaque ligne,
// et on n'affirme un texte que si la confiance dépasse un seuil ; sinon la ligne reste « non lue ».

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { CapaciteMachine } from '../brain/metis/types.ts';
import { peutCharger } from '../brain/metis/mesure.ts';
import type { ImageDecodee, LectureImage, SignalArret } from './index.ts';
import { lirePoids, type Poids } from './poids.ts';

const FICHIER_OCR = 'ocr.safetensors';

/** Un lecteur de texte prêt. */
export interface Ocr {
  readonly modele: string;
  lire(img: ImageDecodee, langues: string, signal?: SignalArret): Promise<LectureImage>;
}

interface Conv { poids: Float32Array; biais: Float32Array; sortieC: number; entreeC: number; k: number }
interface Gru { wz: Float32Array; wr: Float32Array; wh: Float32Array; uz: Float32Array; ur: Float32Array; uh: Float32Array; bz: Float32Array; br: Float32Array; bh: Float32Array; cache: number }
interface ModeleOcr {
  hauteur: number; alphabet: string[];
  conv1: Conv; conv2: Conv; cache: number;
  gruAvant: Gru; gruArriere: Gru;
  sortieP: Float32Array; sortieB: Float32Array; nbClasses: number; dimRnn: number;
}

/** Niveau de gris 0..1. */
function grisNorm(img: ImageDecodee): Float32Array {
  const { largeur, hauteur, rgba } = img;
  const out = new Float32Array(largeur * hauteur);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) / 255;
  return out;
}

/** Détecte les bandes de lignes de texte : seuillage par la moyenne, projection horizontale, regroupement des rangées
 *  « encrées ». Renvoie des boîtes [x, y, largeur, hauteur] couvrant toute la largeur. */
function detecterLignes(gris: Float32Array, largeur: number, hauteur: number): Array<[number, number, number, number]> {
  let moy = 0; for (let i = 0; i < gris.length; i++) moy += gris[i]; moy /= gris.length;
  // Texte sombre sur fond clair OU l'inverse : on prend l'écart à la moyenne comme « encre ».
  const encreParRangee = new Float32Array(hauteur);
  for (let y = 0; y < hauteur; y++) {
    let s = 0;
    for (let x = 0; x < largeur; x++) s += Math.abs(gris[y * largeur + x] - moy);
    encreParRangee[y] = s / largeur;
  }
  let maxEncre = 0; for (let y = 0; y < hauteur; y++) if (encreParRangee[y] > maxEncre) maxEncre = encreParRangee[y];
  if (maxEncre < 0.02) return []; // page quasi vide.
  const seuil = maxEncre * 0.25;
  const lignes: Array<[number, number, number, number]> = [];
  let debut = -1;
  for (let y = 0; y <= hauteur; y++) {
    const actif = y < hauteur && encreParRangee[y] >= seuil;
    if (actif && debut < 0) debut = y;
    else if (!actif && debut >= 0) {
      const h = y - debut;
      if (h >= 4) lignes.push([0, debut, largeur, h]);
      debut = -1;
    }
  }
  return lignes;
}

/** Convolution 2D « même taille » (pas 1, remplissage 1), noyau k×k, relu en option. Entrée [C,H,W]. */
function conv2d(entree: Float32Array, C: number, H: number, W: number, conv: Conv, relu: boolean): Float32Array {
  const { poids, biais, sortieC, k } = conv;
  const pad = (k - 1) >> 1;
  const out = new Float32Array(sortieC * H * W);
  for (let oc = 0; oc < sortieC; oc++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = biais[oc];
        for (let ic = 0; ic < C; ic++) {
          for (let ky = 0; ky < k; ky++) {
            const iy = y + ky - pad; if (iy < 0 || iy >= H) continue;
            for (let kx = 0; kx < k; kx++) {
              const ix = x + kx - pad; if (ix < 0 || ix >= W) continue;
              s += entree[ic * H * W + iy * W + ix] * poids[((oc * C + ic) * k + ky) * k + kx];
            }
          }
        }
        out[oc * H * W + y * W + x] = relu ? Math.max(0, s) : s;
      }
    }
  }
  return out;
}

/** Sous-échantillonnage max 2×2 (pas 2). Entrée [C,H,W] → [C, H/2, W/2]. */
function maxpool(entree: Float32Array, C: number, H: number, W: number): { data: Float32Array; H: number; W: number } {
  const nh = H >> 1, nw = W >> 1;
  const out = new Float32Array(C * nh * nw);
  for (let c = 0; c < C; c++) for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const b = c * H * W + (y * 2) * W + (x * 2);
    out[c * nh * nw + y * nw + x] = Math.max(entree[b], entree[b + 1], entree[b + W], entree[b + W + 1]);
  }
  return { data: out, H: nh, W: nw };
}

function sigmoide(v: number): number { return 1 / (1 + Math.exp(-v)); }

/** Une passe GRU sur une séquence [T, entree] → [T, cache]. `inverse` lit la séquence de la fin au début. */
function passeGru(x: Float32Array, T: number, entree: number, g: Gru, inverse: boolean): Float32Array {
  const c = g.cache;
  const sortie = new Float32Array(T * c);
  const h = new Float32Array(c);
  for (let pas = 0; pas < T; pas++) {
    const t = inverse ? T - 1 - pas : pas;
    const xt = x.subarray(t * entree, t * entree + entree);
    for (let i = 0; i < c; i++) {
      let z = g.bz[i], r = g.br[i];
      for (let j = 0; j < entree; j++) { z += g.wz[i * entree + j] * xt[j]; r += g.wr[i * entree + j] * xt[j]; }
      for (let j = 0; j < c; j++) { z += g.uz[i * c + j] * h[j]; r += g.ur[i * c + j] * h[j]; }
      const zi = sigmoide(z), ri = sigmoide(r);
      let hc = g.bh[i];
      for (let j = 0; j < entree; j++) hc += g.wh[i * entree + j] * xt[j];
      let uh = 0; for (let j = 0; j < c; j++) uh += g.uh[i * c + j] * h[j];
      hc += ri * uh;
      const hcand = Math.tanh(hc);
      sortie[t * c + i] = (1 - zi) * h[i] + zi * hcand;
    }
    for (let i = 0; i < c; i++) h[i] = sortie[t * c + i];
  }
  return sortie;
}

/** Reconnaît une ligne déjà découpée (image RGBA) → texte + confiance moyenne. */
function reconnaitreLigne(m: ModeleOcr, ligne: ImageDecodee): { texte: string; conf: number } {
  // Mise à l'échelle sur la hauteur du modèle (plus proche voisin sur la hauteur, largeur proportionnelle).
  const H = m.hauteur;
  const ratio = H / ligne.hauteur;
  const W = Math.max(8, Math.min(1024, Math.round(ligne.largeur * ratio)));
  const g = new Float32Array(H * W);
  const src = grisNorm(ligne);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(ligne.hauteur - 1, Math.floor(y / ratio));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(ligne.largeur - 1, Math.floor(x / ratio));
      g[y * W + x] = src[sy * ligne.largeur + sx];
    }
  }
  // Dos convolutif.
  let feat = conv2d(g, 1, H, W, m.conv1, true);
  let p = maxpool(feat, m.conv1.sortieC, H, W);
  feat = conv2d(p.data, m.conv1.sortieC, p.H, p.W, m.conv2, true);
  const p2 = maxpool(feat, m.conv2.sortieC, p.H, p.W);
  // Effondrement de la hauteur : moyenne sur les rangées → séquence [Tc, canaux].
  const Tc = p2.W, canaux = m.conv2.sortieC;
  const seq = new Float32Array(Tc * canaux);
  for (let x = 0; x < Tc; x++) for (let cc = 0; cc < canaux; cc++) {
    let s = 0; for (let y = 0; y < p2.H; y++) s += p2.data[cc * p2.H * p2.W + y * p2.W + x];
    seq[x * canaux + cc] = s / p2.H;
  }
  // RNN bidirectionnel puis couche de sortie.
  const avant = passeGru(seq, Tc, canaux, m.gruAvant, false);
  const arriere = passeGru(seq, Tc, canaux, m.gruArriere, true);
  const dim2 = m.dimRnn * 2;
  const logits = new Float32Array(Tc * m.nbClasses);
  for (let t = 0; t < Tc; t++) {
    for (let cl = 0; cl < m.nbClasses; cl++) {
      let s = m.sortieB[cl];
      for (let j = 0; j < m.dimRnn; j++) s += m.sortieP[cl * dim2 + j] * avant[t * m.dimRnn + j];
      for (let j = 0; j < m.dimRnn; j++) s += m.sortieP[cl * dim2 + m.dimRnn + j] * arriere[t * m.dimRnn + j];
      logits[t * m.nbClasses + cl] = s;
    }
  }
  // Décodage CTC glouton (classe 0 = blanc), avec confiance = moyenne des maxima softmax des pas retenus.
  let texte = '', precedent = -1, sommeConf = 0, nConf = 0;
  for (let t = 0; t < Tc; t++) {
    let maxi = 0, maxv = -Infinity, somme = 0;
    for (let cl = 0; cl < m.nbClasses; cl++) { const e = Math.exp(logits[t * m.nbClasses + cl]); somme += e; if (logits[t * m.nbClasses + cl] > maxv) { maxv = logits[t * m.nbClasses + cl]; maxi = cl; } }
    const prob = Math.exp(maxv) / (somme || 1);
    if (maxi !== 0 && maxi !== precedent) {
      const ch = m.alphabet[maxi] ?? '';
      texte += ch; sommeConf += prob; nConf++;
    }
    precedent = maxi;
  }
  return { texte, conf: nConf > 0 ? sommeConf / nConf : 0 };
}

function lireConv(p: Poids, prefixe: string): Conv {
  const w = p.tenseur(`${prefixe}.poids`); // [sortieC, entreeC, k, k]
  if (w.dims.length !== 4 || w.dims[2] !== w.dims[3]) throw new Error(`${prefixe} : noyau de convolution invalide`);
  const biais = p.a(`${prefixe}.biais`) ? p.tenseur(`${prefixe}.biais`).data : new Float32Array(w.dims[0]);
  return { poids: w.data, biais, sortieC: w.dims[0], entreeC: w.dims[1], k: w.dims[2] };
}

function lireGru(p: Poids, prefixe: string): Gru {
  const t = (n: string) => p.tenseur(`${prefixe}.${n}`).data;
  const cache = p.tenseur(`${prefixe}.uz`).dims[0];
  return { wz: t('wz'), wr: t('wr'), wh: t('wh'), uz: t('uz'), ur: t('ur'), uh: t('uh'), bz: t('bz'), br: t('br'), bh: t('bh'), cache };
}

function construireModeleOcr(p: Poids): ModeleOcr {
  const hauteur = p.nombre('hauteur', 32);
  const alphabetBrut = p.meta['alphabet'];
  if (!alphabetBrut) throw new Error('poids OCR : alphabet absent');
  const alphabet = ['', ...Array.from(alphabetBrut)]; // index 0 = blanc CTC
  const conv1 = lireConv(p, 'conv1'), conv2 = lireConv(p, 'conv2');
  const gruAvant = lireGru(p, 'gru_avant'), gruArriere = lireGru(p, 'gru_arriere');
  const sortie = p.tenseur('sortie.poids'); // [nbClasses, 2*dimRnn]
  const dimRnn = gruAvant.cache;
  if (sortie.dims.length !== 2 || sortie.dims[1] !== 2 * dimRnn) throw new Error('poids OCR : couche de sortie incohérente');
  return {
    hauteur, alphabet, conv1, conv2, cache: dimRnn, gruAvant, gruArriere,
    sortieP: sortie.data, sortieB: p.a('sortie.biais') ? p.tenseur('sortie.biais').data : new Float32Array(sortie.dims[0]),
    nbClasses: sortie.dims[0], dimRnn,
  };
}

/** Découpe une bande [x,y,w,h] de l'image en une sous-image RGBA indépendante. */
function sousImage(img: ImageDecodee, x: number, y: number, w: number, h: number): ImageDecodee {
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const srcDeb = ((y + j) * img.largeur + x) * 4;
    out.set(img.rgba.subarray(srcDeb, srcDeb + w * 4), j * w * 4);
  }
  return { largeur: w, hauteur: h, rgba: out };
}

/** Charge l'OCR si un poids est présent et tient en mémoire ; sinon undefined (l'œil répondra « page non lue »). */
export async function chargerOcr(cache: string, cap: CapaciteMachine): Promise<Ocr | undefined> {
  if (!cache) return undefined;
  const chemin = join(cache, FICHIER_OCR);
  let taille = 0;
  try { const s = await stat(chemin); taille = s.isFile() ? s.size : 0; } catch { return undefined; }
  if (taille <= 0 || !peutCharger(taille, cap)) return undefined;
  let modele: ModeleOcr;
  let nom: string;
  try { const p = await lirePoids(chemin); modele = construireModeleOcr(p); nom = p.meta['nom'] ?? FICHIER_OCR; }
  catch { return undefined; }

  const SEUIL = 0.5; // en dessous, la ligne est jugée illisible : on ne l'invente pas.
  return {
    modele: nom,
    async lire(img, _langues, signal) {
      const t0 = performance.now();
      if (signal?.aborted) return { texte: '', confiance: 0, tempsMs: 0, lignes: [], lue: false };
      const gris = grisNorm(img);
      const bandes = detecterLignes(gris, img.largeur, img.hauteur);
      const lignes: LectureImage['lignes'] = [];
      let sommeConf = 0, nLues = 0;
      for (const [x, y, w, h] of bandes) {
        if (signal?.aborted) break;
        if (w < 4 || h < 4) continue;
        const r = reconnaitreLigne(modele, sousImage(img, x, y, w, h));
        if (r.conf >= SEUIL && r.texte.trim()) { lignes.push({ texte: r.texte, boite: [x, y, w, h] }); sommeConf += r.conf; nLues++; }
      }
      const tempsMs = Math.round(performance.now() - t0);
      if (nLues === 0) return { texte: '', confiance: 0, tempsMs, lignes: [], lue: false };
      return { texte: lignes.map((l) => l.texte).join('\n'), confiance: sommeConf / nLues, tempsMs, lignes, lue: true };
    },
  };
}
