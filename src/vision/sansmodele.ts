// Voir sans modèle : ce qu'Odin peut dire d'une image par le seul calcul, sans aucun poids. Rapide et testable.
//   - empreinte perceptuelle (dHash 64 bits) pour reconnaître des images quasi identiques et les changements de plan ;
//   - luminosité moyenne ;
//   - couleurs dominantes (k-moyennes) ;
//   - mouvement entre deux images successives ;
//   - zones de texte (contours de Sobel + composantes connexes).
// Aucune dépendance externe.

import type { ImageDecodee, StatsPlan } from './index.ts';

/** Niveau de gris perçu (coefficients Rec. 601). */
function gris(r: number, g: number, b: number): number { return (r * 0.299 + g * 0.587 + b * 0.114); }

/** Échantillonne l'image en une grille `lw`×`lh` de niveaux de gris (plus proche voisin, assez pour ces mesures). */
function grilleGris(img: ImageDecodee, lw: number, lh: number): Float32Array {
  const out = new Float32Array(lw * lh);
  const { largeur, hauteur, rgba } = img;
  for (let y = 0; y < lh; y++) {
    const sy = Math.min(hauteur - 1, Math.floor((y + 0.5) * hauteur / lh));
    for (let x = 0; x < lw; x++) {
      const sx = Math.min(largeur - 1, Math.floor((x + 0.5) * largeur / lw));
      const i = (sy * largeur + sx) * 4;
      out[y * lw + x] = gris(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }
  return out;
}

/** Empreinte dHash : grille 9×8 en gris, comparaison horizontale de voisins → 64 bits. Deux images identiques → même
 *  empreinte (distance 0). Robuste aux petits changements de taille, de luminosité et de compression. */
function empreinteDHash(img: ImageDecodee): bigint {
  const g = grilleGris(img, 9, 8);
  let e = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (g[y * 9 + x] < g[y * 9 + x + 1]) e |= (1n << bit);
      bit++;
    }
  }
  return e;
}

/** Luminosité moyenne de l'image, ramenée dans 0..1. */
function luminositeMoyenne(img: ImageDecodee): number {
  const { rgba } = img;
  const n = rgba.length / 4;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < rgba.length; i += 4) s += gris(rgba[i], rgba[i + 1], rgba[i + 2]);
  return (s / n) / 255;
}

/** Couleurs dominantes par k-moyennes sur une version réduite de l'image (au plus `k` couleurs, triées par part). */
function couleursDominantes(img: ImageDecodee, k: number): Array<{ r: number; g: number; b: number; part: number }> {
  // Réduction à ~32×32 points pour un calcul rapide et stable.
  const lw = 32, lh = 32;
  const pts: number[] = [];
  const { largeur, hauteur, rgba } = img;
  for (let y = 0; y < lh; y++) {
    const sy = Math.min(hauteur - 1, Math.floor((y + 0.5) * hauteur / lh));
    for (let x = 0; x < lw; x++) {
      const sx = Math.min(largeur - 1, Math.floor((x + 0.5) * largeur / lw));
      const i = (sy * largeur + sx) * 4;
      pts.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }
  const nPts = pts.length / 3;
  // Graines déterministes réparties sur les points (pas d'aléa : résultats reproductibles pour les tests).
  const centres: number[] = [];
  for (let c = 0; c < k; c++) {
    const j = Math.floor((c + 0.5) * nPts / k) * 3;
    centres.push(pts[j], pts[j + 1], pts[j + 2]);
  }
  const attribution = new Int32Array(nPts);
  for (let iter = 0; iter < 8; iter++) {
    // Attribution.
    for (let p = 0; p < nPts; p++) {
      let meilleur = 0, dmin = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pts[p * 3] - centres[c * 3], dg = pts[p * 3 + 1] - centres[c * 3 + 1], db = pts[p * 3 + 2] - centres[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < dmin) { dmin = d; meilleur = c; }
      }
      attribution[p] = meilleur;
    }
    // Mise à jour.
    const somme = new Float64Array(k * 3), compte = new Int32Array(k);
    for (let p = 0; p < nPts; p++) {
      const c = attribution[p];
      somme[c * 3] += pts[p * 3]; somme[c * 3 + 1] += pts[p * 3 + 1]; somme[c * 3 + 2] += pts[p * 3 + 2];
      compte[c]++;
    }
    for (let c = 0; c < k; c++) if (compte[c] > 0) {
      centres[c * 3] = somme[c * 3] / compte[c];
      centres[c * 3 + 1] = somme[c * 3 + 1] / compte[c];
      centres[c * 3 + 2] = somme[c * 3 + 2] / compte[c];
    }
  }
  const compte = new Int32Array(k);
  for (let p = 0; p < nPts; p++) compte[attribution[p]]++;
  const out: Array<{ r: number; g: number; b: number; part: number }> = [];
  for (let c = 0; c < k; c++) if (compte[c] > 0) {
    out.push({ r: Math.round(centres[c * 3]), g: Math.round(centres[c * 3 + 1]), b: Math.round(centres[c * 3 + 2]), part: compte[c] / nPts });
  }
  out.sort((a, b) => b.part - a.part);
  return out;
}

/** Mouvement entre deux images : différence moyenne absolue des niveaux de gris (grille 32×32), ramenée dans 0..1. */
function mouvementEntre(a: ImageDecodee, b: ImageDecodee): number {
  const lw = 32, lh = 32;
  const ga = grilleGris(a, lw, lh), gb = grilleGris(b, lw, lh);
  let s = 0;
  for (let i = 0; i < ga.length; i++) s += Math.abs(ga[i] - gb[i]);
  return (s / ga.length) / 255;
}

/** Estime le nombre de zones de texte : contours de Sobel sur une grille réduite, seuillage, puis comptage des
 *  composantes connexes de taille raisonnable. C'est une ESTIMATION (pas une lecture) : > 0 signale « il y a sans
 *  doute du texte ou des contours marqués là ». */
function zonesTexte(img: ImageDecodee): number {
  const lw = 128, lh = Math.max(16, Math.min(128, Math.round(128 * img.hauteur / Math.max(1, img.largeur))));
  const g = grilleGris(img, lw, lh);
  const mag = new Float32Array(lw * lh);
  let maxMag = 0;
  for (let y = 1; y < lh - 1; y++) {
    for (let x = 1; x < lw - 1; x++) {
      const i = y * lw + x;
      const gx = -g[i - lw - 1] - 2 * g[i - 1] - g[i + lw - 1] + g[i - lw + 1] + 2 * g[i + 1] + g[i + lw + 1];
      const gy = -g[i - lw - 1] - 2 * g[i - lw] - g[i - lw + 1] + g[i + lw - 1] + 2 * g[i + lw] + g[i + lw + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag < 24) return 0; // image plate : aucun contour marqué.
  const seuil = maxMag * 0.35;
  const bord = new Uint8Array(lw * lh);
  for (let i = 0; i < mag.length; i++) bord[i] = mag[i] >= seuil ? 1 : 0;
  // Composantes connexes (4-voisinage) par pile ; on compte celles d'une taille minimale.
  const vu = new Uint8Array(lw * lh);
  const pile: number[] = [];
  let zones = 0;
  for (let i = 0; i < bord.length; i++) {
    if (bord[i] !== 1 || vu[i]) continue;
    pile.length = 0; pile.push(i); vu[i] = 1;
    let taille = 0;
    while (pile.length) {
      const j = pile.pop() as number;
      taille++;
      const x = j % lw, y = (j - x) / lw;
      if (x > 0 && bord[j - 1] && !vu[j - 1]) { vu[j - 1] = 1; pile.push(j - 1); }
      if (x < lw - 1 && bord[j + 1] && !vu[j + 1]) { vu[j + 1] = 1; pile.push(j + 1); }
      if (y > 0 && bord[j - lw] && !vu[j - lw]) { vu[j - lw] = 1; pile.push(j - lw); }
      if (y < lh - 1 && bord[j + lw] && !vu[j + lw]) { vu[j + lw] = 1; pile.push(j + lw); }
    }
    if (taille >= 6) zones++;
  }
  return zones;
}

/** Calcule les StatsPlan d'une image ; avec `precedente`, estime aussi le mouvement. */
export function voirSansModele(img: ImageDecodee, precedente?: ImageDecodee): StatsPlan {
  if (!img || img.largeur <= 0 || img.hauteur <= 0 || img.rgba.length < img.largeur * img.hauteur * 4) {
    throw new Error('image invalide pour voirSansModele');
  }
  const stats: StatsPlan = {
    empreinte: empreinteDHash(img),
    luminosite: luminositeMoyenne(img),
    couleurs: couleursDominantes(img, 5),
    zonesTexte: zonesTexte(img),
  };
  if (precedente && precedente.largeur > 0 && precedente.hauteur > 0) {
    stats.mouvement = mouvementEntre(img, precedente);
  }
  return stats;
}

/** Distance de Hamming entre deux empreintes 64 bits (0..64). ≤ 6 : images quasi identiques. */
export function distanceEmpreinte(a: bigint, b: bigint): number {
  let x = (a ^ b) & 0xffffffffffffffffn;
  let n = 0;
  while (x) { x &= (x - 1n); n++; }
  return n;
}
