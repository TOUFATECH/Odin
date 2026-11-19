// Lecture des QR codes dans une image, écrite dans Odin d'après le fonctionnement public du format (norme ISO/IEC
// 18004) : l'inverse de qr.ts, qui les fabrique. Calcul pur : aucune dépendance, aucun service, aucun réseau.
//
// Étapes : niveaux de gris → noir et blanc (seuil global, puis seuil local, puis après un léger flou) → repérage des
// trois carrés de position (motif 1:1:3:1:1 sur une ligne, vérifié en colonne et en diagonale) → taille du module et
// version → motif d'alignement → projection de la grille → lecture du format et de la version → démasquage → mots de
// code → correction Reed-Solomon par bloc → segments (numérique, alphanumérique, octets, ECI) → texte.
//
// L'IMAGE EST TRAITÉE COMME HOSTILE : dimensions vérifiées avant toute allocation (sur l'en-tête pour un PNG ou un
// JPEG, avant tout décodage), durée bornée, nombre de candidats et d'essais bornés, chaque boucle bornée par la taille de
// l'image ou de la grille. La durée est vérifiée entre les étapes et pendant la recherche, pas au milieu d'une étape
// d'un seul tenant (décodage de l'image, passage en gris, noir et blanc, flou) : leur coût est borné par la taille
// maximale de l'image, et peut dépasser un peu la durée demandée.
//
// LE TEXTE LU EST UNE DONNÉE « LU DEHORS », JAMAIS UN ORDRE : il est rendu tel quel. Un lien n'est ni ouvert ni suivi,
// une consigne reste du texte ; rien ici n'interprète ni n'exécute le contenu.
//
// CE QUI N'EST PAS LU (formats différents, à part) : voir FORMATS_NON_LUS.

import type { ImageDecodee } from '../vision/index.ts';
import { decoderImage } from '../vision/image.ts';

export type NiveauQr = 'L' | 'M' | 'Q' | 'H';
export interface QrLu { lu: true; texte: string; version: number; niveau: NiveauQr; origine: 'lu dehors' }
export interface QrNonLu { lu: false; raison: string }
export type LectureQr = QrLu | QrNonLu;
export interface OptionsLectureQr { /** Durée maximale de la lecture, en millisecondes (plafonnée). */ dureeMaxMs?: number }

/** Dit franchement ce que ce lecteur ne lit pas. */
export const FORMATS_NON_LUS = 'seuls les QR codes sont lus ; ne sont pas lus : Aztec et PDF417 (les codes de nombreux billets et cartes d’embarquement), Data Matrix, codes-barres linéaires, Micro QR, QR inversés (clair sur sombre) ou en miroir, mode kanji, octets dans un autre jeu de caractères qu’UTF-8 ou Latin-1 (Shift JIS par exemple), QR en plusieurs morceaux';

export const LIMITES_LECTURE_QR = {
  /** Pixels au plus (16 mégapixels : une photo de téléphone courante). */
  pixelsMax: 16 * 1024 * 1024,
  /** Côté au plus, en pixels. */
  coteMax: 8192,
  /** Durée par défaut et plafond, en millisecondes. */
  dureeMaxMs: 3000,
  dureePlafondMs: 20000,
  /** Carrés de position candidats gardés, puis essayés en triplets. */
  candidatsMax: 200,
  candidatsEssayes: 10,
  tripletsMax: 12,
} as const;

// --- Corps de Galois GF(256), polynôme 0x11d (celui de la norme, comme qr.ts) ---------------------------------------

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a: number, b: number) => (a ? EXP[LOG[a] + 255 - LOG[b]] : 0); // b ≠ 0
/** Valeur d'un polynôme (coefficients du degré 0 au plus haut) en x. */
function evaluer(p: number[], x: number): number { let y = 0; for (let i = p.length - 1; i >= 0; i--) y = mul(y, x) ^ p[i]; return y; }

/** Corrige un bloc (données puis correction, le premier octet au plus haut degré). Rend le nombre d'octets corrigés,
 *  ou null si le bloc a plus d'erreurs que la correction n'en répare. Racines du générateur : α^0 … α^(n-1). */
function corrigerBloc(r: number[], nEc: number, maxErreurs: number): number | null {
  const N = r.length, S: number[] = new Array(nEc);
  let nul = true;
  for (let i = 0; i < nEc; i++) { const x = EXP[i]; let y = 0; for (let k = 0; k < N; k++) y = mul(y, x) ^ r[k]; S[i] = y; if (y) nul = false; }
  if (nul) return 0;
  // Berlekamp-Massey : polynôme localisateur C de degré L.
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let n = 0; n < nEc; n++) {
    let d = S[n];
    for (let i = 1; i <= L; i++) d ^= mul(C[i] ?? 0, S[n - i]);
    if (d === 0) { m++; continue; }
    const coef = div(d, b), T = C.slice();
    while (T.length < B.length + m) T.push(0);
    for (let i = 0; i < B.length; i++) T[i + m] ^= mul(coef, B[i]);
    if (2 * L <= n) { B = C; L = n + 1 - L; b = d; m = 1; } else m++;
    C = T;
  }
  if (2 * L > nEc || L > maxErreurs) return null;
  // Chien : les positions (degrés) où C(α^-p) = 0.
  const positions: number[] = [];
  for (let p = 0; p < N; p++) if (evaluer(C, EXP[(255 - p) % 255]) === 0) positions.push(p);
  if (positions.length !== L) return null;
  // Forney (première racine α^0) : e = X · Ω(X⁻¹) / C'(X⁻¹), Ω = S·C mod x^nEc.
  const omega: number[] = new Array(nEc).fill(0);
  for (let k = 0; k < nEc; k++) for (let i = 0; i <= k && i < C.length; i++) omega[k] ^= mul(C[i], S[k - i]);
  const derivee: number[] = []; for (let i = 1; i < C.length; i++) derivee.push(i % 2 ? C[i] : 0);
  for (const p of positions) {
    const xinv = EXP[(255 - p) % 255], den = evaluer(derivee, xinv);
    if (den === 0) return null;
    r[N - 1 - p] ^= mul(EXP[p], div(evaluer(omega, xinv), den));
  }
  for (let i = 0; i < nEc; i++) { const x = EXP[i]; let y = 0; for (let k = 0; k < N; k++) y = mul(y, x) ^ r[k]; if (y) return null; }
  return L;
}

// --- Table de la norme : [correction par bloc, blocs groupe 1, données par bloc g1, blocs groupe 2, données g2] ------

const NIVEAUX: NiveauQr[] = ['L', 'M', 'Q', 'H'];
const BLOCS: number[][][] = [
  [[7, 1, 19], [10, 1, 16], [13, 1, 13], [17, 1, 9]],
  [[10, 1, 34], [16, 1, 28], [22, 1, 22], [28, 1, 16]],
  [[15, 1, 55], [26, 1, 44], [18, 2, 17], [22, 2, 13]],
  [[20, 1, 80], [18, 2, 32], [26, 2, 24], [16, 4, 9]],
  [[26, 1, 108], [24, 2, 43], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
  [[18, 2, 68], [16, 4, 27], [24, 4, 19], [28, 4, 15]],
  [[20, 2, 78], [18, 4, 31], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
  [[24, 2, 97], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
  [[30, 2, 116], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
  [[20, 4, 81], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]],
  [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]],
  [[26, 4, 107], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]],
  [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]],
  [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]],
  [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]],
  [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]],
  [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]],
  [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]],
  [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]],
  [[28, 4, 116, 4, 117], [26, 17, 42], [28, 17, 22, 6, 23], [30, 19, 16, 6, 17]],
  [[28, 2, 111, 7, 112], [28, 17, 46], [30, 7, 24, 16, 25], [24, 34, 13]],
  [[30, 4, 121, 5, 122], [28, 4, 47, 14, 48], [30, 11, 24, 14, 25], [30, 16, 15, 14, 16]],
  [[30, 6, 117, 4, 118], [28, 6, 45, 14, 46], [30, 11, 24, 16, 25], [30, 30, 16, 2, 17]],
  [[26, 8, 106, 4, 107], [28, 8, 47, 13, 48], [30, 7, 24, 22, 25], [30, 22, 15, 13, 16]],
  [[28, 10, 114, 2, 115], [28, 19, 46, 4, 47], [28, 28, 22, 6, 23], [30, 33, 16, 4, 17]],
  [[30, 8, 122, 4, 123], [28, 22, 45, 3, 46], [30, 8, 23, 26, 24], [30, 12, 15, 28, 16]],
  [[30, 3, 117, 10, 118], [28, 3, 45, 23, 46], [30, 4, 24, 31, 25], [30, 11, 15, 31, 16]],
  [[30, 7, 116, 7, 117], [28, 21, 45, 7, 46], [30, 1, 23, 37, 24], [30, 19, 15, 26, 16]],
  [[30, 5, 115, 10, 116], [28, 19, 47, 10, 48], [30, 15, 24, 25, 25], [30, 23, 15, 25, 16]],
  [[30, 13, 115, 3, 116], [28, 2, 46, 29, 47], [30, 42, 24, 1, 25], [30, 23, 15, 28, 16]],
  [[30, 17, 115], [28, 10, 46, 23, 47], [30, 10, 24, 35, 25], [30, 19, 15, 35, 16]],
  [[30, 17, 115, 1, 116], [28, 14, 46, 21, 47], [30, 29, 24, 19, 25], [30, 11, 15, 46, 16]],
  [[30, 13, 115, 6, 116], [28, 14, 46, 23, 47], [30, 44, 24, 7, 25], [30, 59, 16, 1, 17]],
  [[30, 12, 121, 7, 122], [28, 12, 47, 26, 48], [30, 39, 24, 14, 25], [30, 22, 15, 41, 16]],
  [[30, 6, 121, 14, 122], [28, 6, 47, 34, 48], [30, 46, 24, 10, 25], [30, 2, 15, 64, 16]],
  [[30, 17, 122, 4, 123], [28, 29, 46, 14, 47], [30, 49, 24, 10, 25], [30, 24, 15, 46, 16]],
  [[30, 4, 122, 18, 123], [28, 13, 46, 32, 47], [30, 48, 24, 14, 25], [30, 42, 15, 32, 16]],
  [[30, 20, 117, 4, 118], [28, 40, 47, 7, 48], [30, 43, 24, 22, 25], [30, 10, 15, 67, 16]],
  [[30, 19, 118, 6, 119], [28, 18, 47, 31, 48], [30, 34, 24, 34, 25], [30, 20, 15, 61, 16]],
];

/** Mots de correction que la norme garde pour DÉTECTER les fausses lectures, sans s'en servir pour corriger (petits
 *  QR seulement ; ailleurs 0, ou 1 quand le nombre de mots est impair, ce que l'arrondi fait déjà). */
const MOTS_GARDES: Record<string, number> = { '1-L': 3, '1-M': 2, '2-L': 2 };
/** Erreurs corrigées au plus par bloc : la moitié des mots de correction, moins les mots gardés. */
function erreursCorrigeesMax(version: number, niveau: NiveauQr, ec: number): number {
  return Math.floor((ec - (MOTS_GARDES[`${version}-${niveau}`] ?? 0)) / 2);
}

/** [correction par bloc, blocs g1, données g1, blocs g2, données g2] d'une version et d'un niveau. */
export function blocsQr(version: number, niveau: NiveauQr): [number, number, number, number, number] {
  const s = BLOCS[version - 1][NIVEAUX.indexOf(niveau)];
  return [s[0], s[1], s[2], s[3] ?? 0, s[4] ?? 0];
}

/** Centres des motifs d'alignement (règle publique de la norme : espacement pair et régulier depuis le bas). */
function alignements(v: number): number[] {
  if (v === 1) return [];
  const taille = 17 + 4 * v, n = Math.floor(v / 7) + 2;
  const pas = v === 32 ? 26 : Math.ceil((taille - 13) / (2 * n - 2)) * 2;
  const out = [6];
  for (let i = n - 2, p = taille - 7; i >= 0; i--, p -= pas) out.splice(1, 0, p);
  return out;
}

/** Les zones réservées (motifs fixes, format, version) d'une version : 1 = réservé. */
const RESERVES = new Map<number, Uint8Array>();
function reserves(v: number): Uint8Array {
  const deja = RESERVES.get(v); if (deja) return deja;
  const t = 17 + 4 * v, z = new Uint8Array(t * t);
  const remplir = (r0: number, c0: number, h: number, l: number) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + l; c++) z[r * t + c] = 1; };
  remplir(0, 0, 9, 9); remplir(0, t - 8, 9, 8); remplir(t - 8, 0, 8, 9);
  remplir(6, 0, 1, t); remplir(0, 6, t, 1);
  const al = alignements(v);
  for (const r of al) for (const c of al) { if ((r < 9 && c < 9) || (r < 9 && c > t - 10) || (r > t - 10 && c < 9)) continue; remplir(r - 2, c - 2, 5, 5); }
  if (v >= 7) { remplir(0, t - 11, 6, 3); remplir(t - 11, 0, 3, 6); }
  RESERVES.set(v, z);
  return z;
}

/** Nombre de mots de code d'une version (modules libres / 8). */
export function motsQr(version: number): number {
  const z = reserves(version); let libres = 0;
  for (const x of z) if (!x) libres++;
  return Math.floor(libres / 8);
}

// --- Format et version ----------------------------------------------------------------------------------------------

function bch(valeur: number, poly: number, bits: number): number {
  let v = valeur << bits; const haut = 31 - Math.clz32(poly);
  while (v && 31 - Math.clz32(v) >= haut) v ^= poly << (31 - Math.clz32(v) - haut);
  return (valeur << bits) | v;
}
const BITS_NIVEAU: Record<NiveauQr, number> = { L: 1, M: 0, Q: 3, H: 2 };
const FORMATS: Array<{ code: number; niveau: NiveauQr; masque: number }> = [];
for (const n of NIVEAUX) for (let k = 0; k < 8; k++) FORMATS.push({ code: bch((BITS_NIVEAU[n] << 3) | k, 0x537, 10) ^ 0x5412, niveau: n, masque: k });
const VERSIONS: number[] = []; for (let v = 7; v <= 40; v++) VERSIONS[v] = bch(v, 0x1f25, 12);
const distance = (a: number, b: number) => { let x = a ^ b, n = 0; while (x) { x &= x - 1; n++; } return n; };

type Grille = { t: number; g: Uint8Array }; // 1 = module sombre
const lire = (G: Grille, r: number, c: number) => G.g[r * G.t + c];

function lireFormat(G: Grille): { niveau: NiveauQr; masque: number } | null {
  const t = G.t; let a = 0, b = 0;
  for (let i = 0; i < 15; i++) {
    const ba = i < 6 ? lire(G, i, 8) : i < 8 ? lire(G, i + 1, 8) : lire(G, t - 15 + i, 8);
    const bb = i < 8 ? lire(G, 8, t - 1 - i) : i < 9 ? lire(G, 8, 7) : lire(G, 8, 14 - i);
    a |= ba << i; b |= bb << i;
  }
  let meilleur: (typeof FORMATS)[number] | null = null, d = 99;
  for (const f of FORMATS) { const x = Math.min(distance(f.code, a), distance(f.code, b)); if (x < d) { d = x; meilleur = f; } }
  return d <= 3 && meilleur ? { niveau: meilleur.niveau, masque: meilleur.masque } : null;
}

function lireVersion(G: Grille): number | null {
  const t = G.t; let a = 0, b = 0;
  for (let i = 0; i < 18; i++) { a |= lire(G, Math.floor(i / 3), t - 11 + (i % 3)) << i; b |= lire(G, t - 11 + (i % 3), Math.floor(i / 3)) << i; }
  let meilleur = 0, d = 99;
  for (let v = 7; v <= 40; v++) { const x = Math.min(distance(VERSIONS[v], a), distance(VERSIONS[v], b)); if (x < d) { d = x; meilleur = v; } }
  return d <= 3 ? meilleur : null;
}

const MASQUES: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Les mots de code d'une grille, dans l'ordre de placement (zigzag de droite à gauche), démasqués. */
function lireMots(G: Grille, v: number, masque: number): number[] {
  const t = G.t, z = reserves(v), total = motsQr(v), mots = new Array<number>(total).fill(0), f = MASQUES[masque];
  let k = 0;
  for (let col = t - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    const monte = ((t - 1 - col) >> 1) % 2 === 0;
    for (let n = 0; n < t; n++) {
      const r = monte ? t - 1 - n : n;
      for (const c of [col, col - 1]) {
        if (z[r * t + c]) continue;
        if (k < total * 8) { const bit = lire(G, r, c) ^ (f(r, c) ? 1 : 0); mots[k >> 3] |= bit << (7 - (k & 7)); }
        k++;
      }
    }
  }
  return mots;
}

// --- Des mots de code au texte --------------------------------------------------------------------------------------

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Octets → texte : Latin-1 si l'ECI le dit (1 ou 3) ; UTF-8 si l'ECI le dit (26), et seulement s'il est valable ; tout
 *  autre ECI est refusé (jeu de caractères non pris en charge). Sans ECI : UTF-8 s'il est valable (c'est ce que mettent
 *  la plupart des générateurs, dont celui d'Odin), à défaut Latin-1 (le jeu par défaut de la norme) — sauf si des
 *  octets 0x80 à 0x9F s'y trouvent : ce sont des caractères de contrôle en Latin-1, le signe d'un autre encodage (Shift
 *  JIS par exemple). Un texte mal décodé n'est jamais rendu comme sûr : on refuse, avec la raison. */
function texteOctets(o: number[], eci: number | null): { texte: string } | { raison: string } {
  const buf = Buffer.from(o);
  if (eci === 1 || eci === 3) return { texte: buf.toString('latin1') };
  if (eci !== null && eci !== 26) return { raison: `ECI ${eci} : jeu de caractères non pris en charge` };
  try { return { texte: new TextDecoder('utf-8', { fatal: true }).decode(buf) }; } catch { /* pas de l'UTF-8 */ }
  if (eci === 26) return { raison: 'octets annoncés en UTF-8 (ECI 26) mais invalides' };
  if (o.some((x) => x >= 0x80 && x <= 0x9f)) return { raison: 'encodage des octets non reconnu (ni UTF-8, ni Latin-1 lisible ; peut-être Shift JIS)' };
  return { texte: buf.toString('latin1') };
}

/** Décode des mots de code entrelacés (tels que lus dans la grille) : correction par bloc, puis segments. */
export function decoderMotsQr(mots: number[], version: number, niveau: NiveauQr): LectureQr {
  if (!Number.isInteger(version) || version < 1 || version > 40 || !NIVEAUX.includes(niveau)) return { lu: false, raison: 'version ou niveau invalide' };
  const [ec, b1, d1, b2, d2] = blocsQr(version, niveau), nb = b1 + b2;
  if (mots.length < b1 * (d1 + ec) + b2 * (d2 + ec)) return { lu: false, raison: 'mots de code incomplets' };
  const blocs: number[][] = [], maxErreurs = erreursCorrigeesMax(version, niveau, ec);
  for (let i = 0; i < nb; i++) blocs.push([]);
  let k = 0;
  for (let i = 0; i < Math.max(d1, d2); i++) for (let j = 0; j < nb; j++) if (i < (j < b1 ? d1 : d2)) blocs[j].push(mots[k++] & 0xff);
  for (let i = 0; i < ec; i++) for (let j = 0; j < nb; j++) blocs[j].push(mots[k++] & 0xff);
  const donnees: number[] = [];
  for (let j = 0; j < nb; j++) {
    if (corrigerBloc(blocs[j], ec, maxErreurs) === null) return { lu: false, raison: `trop d’erreurs pour la correction (bloc ${j + 1} sur ${nb})` };
    donnees.push(...blocs[j].slice(0, j < b1 ? d1 : d2));
  }
  // Lecture des segments, bit par bit (chaque tour consomme au moins 4 bits : la boucle finit toujours).
  const total = donnees.length * 8; let pos = 0;
  const reste = () => total - pos;
  const bits = (n: number) => { let v = 0; for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((donnees[pos >> 3] >> (7 - (pos & 7))) & 1); return v; };
  const rang = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  let texte = '', octets: number[] = [], eci: number | null = null, echec = '';
  const vider = () => {
    if (!octets.length) return;
    const t = texteOctets(octets, eci); octets = [];
    if ('raison' in t) echec ||= t.raison; else texte += t.texte;
  };
  while (reste() >= 4) {
    if (echec) return { lu: false, raison: echec };
    const mode = bits(4);
    if (mode === 0) break;
    if (mode === 1) {
      const nbits = [10, 12, 14][rang]; if (reste() < nbits) return { lu: false, raison: 'segment numérique tronqué' };
      let n = bits(nbits); vider();
      while (n > 0) {
        const g = Math.min(3, n), lb = g === 3 ? 10 : g === 2 ? 7 : 4;
        if (reste() < lb) return { lu: false, raison: 'segment numérique tronqué' };
        const v = bits(lb); if (v >= 10 ** g) return { lu: false, raison: 'chiffres invalides' };
        texte += String(v).padStart(g, '0'); n -= g;
      }
    } else if (mode === 2) {
      const nbits = [9, 11, 13][rang]; if (reste() < nbits) return { lu: false, raison: 'segment alphanumérique tronqué' };
      let n = bits(nbits); vider();
      while (n > 0) {
        if (n >= 2) { if (reste() < 11) return { lu: false, raison: 'segment alphanumérique tronqué' }; const v = bits(11); if (v >= 45 * 45) return { lu: false, raison: 'caractères invalides' }; texte += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        else { if (reste() < 6) return { lu: false, raison: 'segment alphanumérique tronqué' }; const v = bits(6); if (v >= 45) return { lu: false, raison: 'caractère invalide' }; texte += ALNUM[v]; n -= 1; }
      }
    } else if (mode === 4) {
      const nbits = [8, 16, 16][rang]; if (reste() < nbits) return { lu: false, raison: 'segment d’octets tronqué' };
      const n = bits(nbits); if (reste() < n * 8) return { lu: false, raison: 'segment d’octets tronqué' };
      for (let i = 0; i < n; i++) octets.push(bits(8));
    } else if (mode === 7) {
      if (reste() < 8) return { lu: false, raison: 'ECI tronqué' };
      let v = bits(8);
      if ((v & 0x80) === 0) v &= 0x7f;
      else if ((v & 0xc0) === 0x80) { if (reste() < 8) return { lu: false, raison: 'ECI tronqué' }; v = ((v & 0x3f) << 8) | bits(8); }
      else if ((v & 0xe0) === 0xc0) { if (reste() < 16) return { lu: false, raison: 'ECI tronqué' }; v = ((v & 0x1f) << 16) | bits(16); }
      else return { lu: false, raison: 'ECI invalide' };
      vider(); eci = v;
    } else if (mode === 8) return { lu: false, raison: 'mode kanji non lu' };
    else if (mode === 3) return { lu: false, raison: 'QR en plusieurs morceaux (ajout structuré) : non assemblé' };
    else if (mode === 5 || mode === 9) return { lu: false, raison: 'mode FNC1 (GS1) non lu' };
    else return { lu: false, raison: `mode ${mode} inconnu` };
  }
  vider();
  if (echec) return { lu: false, raison: echec };
  return { lu: true, texte, version, niveau, origine: 'lu dehors' };
}

function lireGrille(G: Grille): LectureQr & { versionLue?: number } {
  const v = (G.t - 17) / 4;
  const format = lireFormat(G);
  if (!format) return { lu: false, raison: 'format illisible' };
  if (v >= 7) {
    const lue = lireVersion(G);
    if (lue === null) return { lu: false, raison: 'version illisible' };
    if (lue !== v) return { lu: false, raison: `version lue ${lue}, grille de ${v}`, versionLue: lue };
  }
  return decoderMotsQr(lireMots(G, v, format.masque), v, format.niveau);
}

/** Lit un QR déjà en matrice (true = module sombre, sans marge). */
export function lireMatriceQr(m: boolean[][]): LectureQr {
  const t = Array.isArray(m) ? m.length : 0;
  if (t < 21 || t > 177 || (t - 17) % 4 !== 0 || !m.every((l) => Array.isArray(l) && l.length === t)) return { lu: false, raison: 'matrice invalide (carré de 21 à 177 modules attendu)' };
  const g = new Uint8Array(t * t);
  for (let r = 0; r < t; r++) for (let c = 0; c < t; c++) g[r * t + c] = m[r][c] ? 1 : 0;
  const r = lireGrille({ t, g });
  return r.lu ? r : { lu: false, raison: r.raison };
}

// --- De l'image à la grille -----------------------------------------------------------------------------------------

class Delai extends Error {}

type Bin = { w: number; h: number; d: Uint8Array }; // 1 = sombre
type Point = { x: number; y: number };
type Candidat = Point & { module: number; n: number };

function enGris(img: ImageDecodee): Uint8Array {
  const n = img.largeur * img.hauteur, g = new Uint8Array(n), p = img.rgba;
  for (let i = 0; i < n; i++) {
    const a = p[i * 4 + 3], l = (p[i * 4] * 77 + p[i * 4 + 1] * 150 + p[i * 4 + 2] * 29) >> 8;
    g[i] = Math.round((l * a + 255 * (255 - a)) / 255); // transparent = fond blanc
  }
  return g;
}

function seuilOtsu(g: Uint8Array): number {
  const hist = new Float64Array(256); for (const v of g) hist[v]++;
  let somme = 0; for (let i = 0; i < 256; i++) somme += i * hist[i];
  let sB = 0, wB = 0, meilleur = 0, seuil = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (somme - sB) / wF, entre = wB * wF * (mB - mF) ** 2;
    if (entre > meilleur) { meilleur = entre; seuil = i + 1; }
  }
  return seuil;
}

function flouter(g: Uint8Array, w: number, h: number): Uint8Array {
  const t = new Uint16Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = g[i] * 2 + (x > 0 ? g[i - 1] : g[i]) + (x < w - 1 ? g[i + 1] : g[i]); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; out[i] = Math.round((t[i] * 2 + (y > 0 ? t[i - w] : t[i]) + (y < h - 1 ? t[i + w] : t[i])) / 16); }
  return out;
}

function binariserGlobal(g: Uint8Array, w: number, h: number): Bin {
  const s = seuilOtsu(g), d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = g[i] < s ? 1 : 0;
  return { w, h, d };
}

/** Seuil local : moyenne des blocs voisins ; une zone sans contraste prend le seuil global. */
function binariserLocal(g: Uint8Array, w: number, h: number): Bin {
  const global = seuilOtsu(g), B = Math.max(8, Math.ceil(Math.min(w, h) / 40)), bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const moy = new Float32Array(bw * bh), mini = new Uint8Array(bw * bh), maxi = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0, lo = 255, hi = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { const v = g[y * w + x]; s += v; n++; if (v < lo) lo = v; if (v > hi) hi = v; }
    const i = by * bw + bx; moy[i] = s / n; mini[i] = lo; maxi[i] = hi;
  }
  const d = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0, lo = 255, hi = 0;
    for (let yy = Math.max(0, by - 2); yy <= Math.min(bh - 1, by + 2); yy++) for (let xx = Math.max(0, bx - 2); xx <= Math.min(bw - 1, bx + 2); xx++) { const i = yy * bw + xx; s += moy[i]; n++; if (mini[i] < lo) lo = mini[i]; if (maxi[i] > hi) hi = maxi[i]; }
    const seuil = hi - lo < 40 ? global : s / n;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) d[y * w + x] = g[y * w + x] < seuil ? 1 : 0;
  }
  return { w, h, d };
}

const px = (b: Bin, x: number, y: number) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? 0 : b.d[Math.floor(y) * b.w + Math.floor(x)]);

/** Rapports 1:1:3:1:1 d'un carré de position, avec tolérance. */
function rapportOk(l: number[]): boolean {
  const total = l[0] + l[1] + l[2] + l[3] + l[4]; if (total < 7) return false;
  const m = total / 7, tol = m * 0.7;
  return Math.abs(l[0] - m) < tol && Math.abs(l[1] - m) < tol && Math.abs(l[2] - 3 * m) < 3 * tol && Math.abs(l[3] - m) < tol && Math.abs(l[4] - m) < tol;
}

/** Les cinq plages autour de (x0, y0) selon (dx, dy) ; rend le centre corrigé (en pas depuis x0, y0) et le total. */
function croiser(b: Bin, x0: number, y0: number, dx: number, dy: number, plafond: number): { decalage: number; total: number } | null {
  if (!px(b, x0, y0)) return null;
  const compter = (s: number) => {
    const runs = [0, 0, 0]; let x = x0 + s * dx, y = y0 + s * dy;
    for (let etat = 0; etat < 3; etat++) {
      const voulu = etat === 1 ? 0 : 1;
      while (x >= 0 && y >= 0 && x < b.w && y < b.h && px(b, x, y) === voulu) { runs[etat]++; if (runs[etat] > plafond) return null; x += s * dx; y += s * dy; }
      if (etat < 2 && (x < 0 || y < 0 || x >= b.w || y >= b.h)) return null;
    }
    return runs;
  };
  const av = compter(1), ar = compter(-1);
  if (!av || !ar || !ar[1] || !ar[2] || !av[1] || !av[2]) return null;
  const l = [ar[2], ar[1], ar[0] + av[0] + 1, av[1], av[2]];
  if (!rapportOk(l)) return null;
  return { decalage: 0.5 + (av[0] - ar[0]) / 2, total: l.reduce((a, c) => a + c, 0) };
}

function chercherCarres(b: Bin, fin: number): Candidat[] {
  const cands: Candidat[] = [];
  const longueurs: number[] = [], fins: number[] = [];
  for (let y = 0; y < b.h; y++) {
    if ((y & 31) === 0 && Date.now() > fin) throw new Delai();
    longueurs.length = 0; fins.length = 0;
    const base = y * b.w; let premier = b.d[base], couleur = premier, n = 0;
    for (let x = 0; x <= b.w; x++) {
      const c = x < b.w ? b.d[base + x] : -1;
      if (c === couleur) { n++; continue; }
      longueurs.push(n); fins.push(x); couleur = c; n = 1;
    }
    for (let i = premier === 1 ? 0 : 1; i + 4 < longueurs.length; i += 2) {
      const l = [longueurs[i], longueurs[i + 1], longueurs[i + 2], longueurs[i + 3], longueurs[i + 4]];
      if (!rapportOk(l)) continue;
      const tH = l[0] + l[1] + l[2] + l[3] + l[4], cx = fins[i + 2] - l[2] / 2, plafond = Math.ceil(tH * 2) + 2;
      const v = croiser(b, Math.floor(cx), y, 0, 1, plafond); if (!v || Math.abs(v.total - tH) > 0.7 * tH) continue;
      const cy = y + v.decalage;
      const hz = croiser(b, Math.floor(cx), Math.floor(cy), 1, 0, plafond); if (!hz || Math.abs(hz.total - tH) > 0.7 * tH) continue;
      const cx2 = Math.floor(cx) + hz.decalage;
      if (!croiser(b, Math.floor(cx2), Math.floor(cy), 1, 1, plafond)) continue;
      const module = (hz.total + v.total) / 14;
      const proche = cands.find((c) => Math.abs(c.x - cx2) <= c.module * 2 && Math.abs(c.y - cy) <= c.module * 2 && module < c.module * 2 && module > c.module / 2);
      if (proche) { const k = proche.n; proche.x = (proche.x * k + cx2) / (k + 1); proche.y = (proche.y * k + cy) / (k + 1); proche.module = (proche.module * k + module) / (k + 1); proche.n++; }
      else if (cands.length < LIMITES_LECTURE_QR.candidatsMax) cands.push({ x: cx2, y: cy, module, n: 1 });
    }
  }
  return cands;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Triplets plausibles (angle droit, côtés proches, modules proches), les meilleurs d'abord, coin en haut à gauche en tête. */
function triplets(cands: Candidat[]): Array<[Candidat, Candidat, Candidat]> {
  const c = cands.slice().sort((a, b) => b.n - a.n).slice(0, LIMITES_LECTURE_QR.candidatsEssayes);
  const out: Array<{ t: [Candidat, Candidat, Candidat]; score: number }> = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
    const p = [c[i], c[j], c[k]], ms = p.map((q) => q.module);
    if (Math.max(...ms) / Math.min(...ms) > 1.8) continue;
    const d = [dist(p[1], p[2]), dist(p[0], p[2]), dist(p[0], p[1])];
    const h = d.indexOf(Math.max(...d)), coin = p[h], a = p[(h + 1) % 3], b = p[(h + 2) % 3];
    const la = dist(coin, a), lb = dist(coin, b);
    if (!la || !lb || Math.max(la, lb) / Math.min(la, lb) > 1.5) continue;
    const cos = ((a.x - coin.x) * (b.x - coin.x) + (a.y - coin.y) * (b.y - coin.y)) / (la * lb);
    if (Math.abs(cos) > 0.35) continue;
    const mm = (ms[0] + ms[1] + ms[2]) / 3, cote = (la + lb) / 2 / mm;
    if (cote < 8 || cote > 240) continue;
    // Sens : en haut à droite, puis en bas à gauche (produit vectoriel positif, y vers le bas).
    const pv = (a.x - coin.x) * (b.y - coin.y) - (a.y - coin.y) * (b.x - coin.x);
    out.push({ t: pv > 0 ? [coin, a, b] : [coin, b, a], score: Math.abs(cos) + Math.abs(la / lb - 1) + Math.max(...ms) / Math.min(...ms) - 1 });
  }
  return out.sort((x, y) => x.score - y.score).slice(0, LIMITES_LECTURE_QR.tripletsMax).map((x) => x.t);
}

/** Distance du centre d'un carré de position à son bord extérieur dans une direction (3,5 modules), ou null. */
function versBord(b: Bin, o: Point, ux: number, uy: number, max: number): number | null {
  let etat = 0, suite = 0, debut = 0;
  for (let t = 0; t <= max; t += 0.5) {
    const x = o.x + ux * t, y = o.y + uy * t;
    const v = x < 0 || y < 0 || x >= b.w || y >= b.h ? 0 : px(b, x, y);
    const voulu = etat % 2 === 0 ? 0 : 1; // on attend la couleur suivante : clair, sombre, clair
    if (v === voulu) { if (!suite) debut = t; if (++suite >= 2) { etat++; suite = 0; if (etat === 3) return debut; } }
    else suite = 0;
  }
  return null;
}

function tailleModule(b: Bin, a: Candidat, c: Candidat): number {
  const d = dist(a, c), ux = (c.x - a.x) / d, uy = (c.y - a.y) / d, max = Math.min(d / 2, a.module * 8);
  const d1 = versBord(b, a, ux, uy, max), d2 = versBord(b, a, -ux, -uy, max);
  const m = d1 !== null && d2 !== null ? (d1 + d2) / 7 : d1 !== null ? d1 / 3.5 : d2 !== null ? d2 / 3.5 : null;
  return m !== null && m > a.module * 0.5 && m < a.module * 1.5 ? m : a.module;
}

/** Homographie (8 inconnues, 4 correspondances) : des coordonnées de grille vers l'image. */
function homographie(src: Point[], dst: Point[]): number[] | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = src[i], { x, y } = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return [...A.map((l, i) => l[8] / l[i]), 1];
}
const projeter = (H: number[], u: number, v: number): Point => { const z = H[6] * u + H[7] * v + H[8]; return { x: (H[0] * u + H[1] * v + H[2]) / z, y: (H[3] * u + H[4] * v + H[5]) / z }; };

/** Cherche le motif d'alignement en bas à droite près de sa place prévue ; rend son centre, ou null. */
function chercherAlignement(b: Bin, tl: Point, tr: Point, bl: Point, t: number, fin: number): Point | null {
  const ex = { x: (tr.x - tl.x) / (t - 7), y: (tr.y - tl.y) / (t - 7) }, ey = { x: (bl.x - tl.x) / (t - 7), y: (bl.y - tl.y) / (t - 7) };
  const u = t - 6.5 - 3.5, prevu = { x: tl.x + (ex.x + ey.x) * u, y: tl.y + (ex.y + ey.y) * u };
  const mod = (Math.hypot(ex.x, ex.y) + Math.hypot(ey.x, ey.y)) / 2, rayon = Math.max(4, Math.round(t / 8)) * mod, pas = Math.max(1, Math.floor(mod / 3));
  const score = (cx: number, cy: number) => {
    let s = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const voulu = Math.max(Math.abs(i), Math.abs(j)) === 1 ? 0 : 1; if (px(b, cx + ex.x * i + ey.x * j, cy + ex.y * i + ey.y * j) === voulu) s++; }
    return s;
  };
  let meilleur = -1, pos: Point[] = [];
  const essayer = (x: number, y: number) => { const s = score(x, y); if (s > meilleur) { meilleur = s; pos = [{ x, y }]; } else if (s === meilleur) pos.push({ x, y }); };
  for (let dy = -rayon; dy <= rayon; dy += pas) {
    if (Date.now() > fin) throw new Delai();
    for (let dx = -rayon; dx <= rayon; dx += pas) essayer(prevu.x + dx, prevu.y + dy);
  }
  if (meilleur < 21) return null;
  // Affinage au pixel autour du meilleur le plus proche de la place prévue, puis centre des meilleurs voisins.
  const proche = pos.reduce((a, c) => (dist(c, prevu) < dist(a, prevu) ? c : a));
  meilleur = -1; pos = [];
  for (let dy = -pas; dy <= pas; dy++) for (let dx = -pas; dx <= pas; dx++) essayer(proche.x + dx, proche.y + dy);
  const voisins = pos.filter((p) => dist(p, proche) <= mod);
  const liste = voisins.length ? voisins : pos;
  return { x: liste.reduce((a, p) => a + p.x, 0) / liste.length, y: liste.reduce((a, p) => a + p.y, 0) / liste.length };
}

/** Échantillonne la grille : cinq points par module, vote à la majorité. */
function echantillonner(b: Bin, H: number[], t: number): Grille {
  const g = new Uint8Array(t * t), o = 0.22;
  for (let r = 0; r < t; r++) for (let c = 0; c < t; c++) {
    let n = 0;
    for (const [du, dv] of [[0, 0], [-o, -o], [o, -o], [-o, o], [o, o]]) { const p = projeter(H, c + 0.5 + du, r + 0.5 + dv); n += px(b, p.x, p.y); }
    g[r * t + c] = n >= 3 ? 1 : 0;
  }
  return { t, g };
}

function lireTriplet(b: Bin, [tl, tr, bl]: [Candidat, Candidat, Candidat], fin: number): LectureQr {
  const ms = (tailleModule(b, tl, tr) + tailleModule(b, tl, bl)) / 2;
  const t0 = (dist(tl, tr) + dist(tl, bl)) / 2 / ms + 7;
  const v0 = Math.max(1, Math.min(40, Math.round((t0 - 17) / 4)));
  const essais = [v0, v0 - 1, v0 + 1].filter((v) => v >= 1 && v <= 40);
  let derniere: LectureQr = { lu: false, raison: 'grille illisible' };
  const vues = new Set<number>();
  for (let i = 0; i < essais.length && i < 5; i++) {
    const v = essais[i]; if (vues.has(v)) continue; vues.add(v);
    if (Date.now() > fin) throw new Delai();
    const t = 17 + 4 * v, src = [{ x: 3.5, y: 3.5 }, { x: t - 3.5, y: 3.5 }, { x: 3.5, y: t - 3.5 }];
    const quatriemes: Array<[Point, Point]> = [];
    if (v >= 2) { const al = chercherAlignement(b, tl, tr, bl, t, fin); if (al) quatriemes.push([{ x: t - 6.5, y: t - 6.5 }, al]); }
    quatriemes.push([{ x: t - 3.5, y: t - 3.5 }, { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y }]);
    for (const [s4, d4] of quatriemes) {
      const H = homographie([...src, s4], [tl, tr, bl, d4]); if (!H) continue;
      const r = lireGrille(echantillonner(b, H, t));
      if (r.lu) return r;
      if (r.versionLue && !vues.has(r.versionLue)) essais.splice(i + 1, 0, r.versionLue);
      derniere = { lu: false, raison: r.raison };
    }
  }
  return derniere;
}

const tropGrand = (w: number, h: number) => w > LIMITES_LECTURE_QR.coteMax || h > LIMITES_LECTURE_QR.coteMax || w * h > LIMITES_LECTURE_QR.pixelsMax;

/** Dimensions annoncées par l'en-tête, AVANT tout décodage : PNG (IHDR) ou JPEG (chaque en-tête d'image SOFn jusqu'au
 *  début du scan, parcouru segment par segment comme le fait le décodeur d'Odin, qui garde le dernier). Vrai si l'une
 *  dépasse les bornes. Un en-tête abîmé rend faux : c'est le décodeur qui le refusera. Coût : un passage sur les octets. */
function enteteTropGrand(buf: Buffer): boolean {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf.toString('latin1', 12, 16) === 'IHDR') return tropGrand(buf.readUInt32BE(16), buf.readUInt32BE(20));
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return false;
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1]; p += 2;
    if (m === 0xd9 || m === 0xda) return false; // fin, ou début du scan : plus d'en-tête d'image ensuite
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) continue;
    const longueur = buf.readUInt16BE(p);
    if (longueur < 2 || p + longueur > buf.length) return false;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && longueur >= 7 && tropGrand(buf.readUInt16BE(p + 5), buf.readUInt16BE(p + 3))) return true;
    p += longueur;
  }
  return false;
}

/**
 * Lit un QR code dans une image (déjà décodée, ou PNG / JPEG en octets). Rend le texte TEL QUEL, marqué « lu dehors »,
 * avec la version et le niveau de correction ; sinon rien, avec la raison. Fonction pure : ni fichier, ni réseau.
 */
export function lireQr(image: ImageDecodee | Buffer, options: OptionsLectureQr = {}): LectureQr {
  const L = LIMITES_LECTURE_QR, debut = Date.now();
  const duree = Math.max(0, Math.min(L.dureePlafondMs, Number.isFinite(options.dureeMaxMs) ? (options.dureeMaxMs as number) : L.dureeMaxMs));
  const fin = debut + duree;
  let img: ImageDecodee;
  if (Buffer.isBuffer(image)) {
    if (enteteTropGrand(image)) return { lu: false, raison: `image trop grande (au plus ${L.coteMax} pixels de côté et ${L.pixelsMax} pixels)` };
    try { img = decoderImage(image, 'image'); } catch (e) { return { lu: false, raison: `image illisible : ${(e as Error).message}` }; }
  } else img = image;
  const { largeur: w, hauteur: h } = img ?? ({} as ImageDecodee);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return { lu: false, raison: 'image incohérente (dimensions)' };
  if (w > L.coteMax || h > L.coteMax || w * h > L.pixelsMax) return { lu: false, raison: `image trop grande (au plus ${L.coteMax} pixels de côté et ${L.pixelsMax} pixels)` };
  if (!(img.rgba instanceof Uint8Array) || img.rgba.length !== w * h * 4) return { lu: false, raison: 'image incohérente (pixels)' };
  if (w < 21 || h < 21) return { lu: false, raison: `image trop petite pour un QR code ; ${FORMATS_NON_LUS}` };
  try {
    if (Date.now() >= fin) throw new Delai();
    const gris = enGris(img);
    let flou: Uint8Array | null = null;
    const tentatives: Array<() => Bin> = [
      () => binariserGlobal(gris, w, h),
      () => binariserLocal(gris, w, h),
      () => binariserGlobal((flou ??= flouter(gris, w, h)), w, h),
      () => binariserLocal((flou ??= flouter(gris, w, h)), w, h),
    ];
    let raison = '';
    for (const faire of tentatives) {
      if (Date.now() > fin) throw new Delai();
      const b = faire();
      for (const tri of triplets(chercherCarres(b, fin))) {
        const r = lireTriplet(b, tri, fin);
        if (r.lu) return r;
        raison ||= r.raison;
      }
    }
    return { lu: false, raison: raison ? `QR repéré mais illisible (${raison}) ; ${FORMATS_NON_LUS}` : `aucun QR code trouvé ; ${FORMATS_NON_LUS}` };
  } catch (e) {
    if (e instanceof Delai) return { lu: false, raison: `durée maximale atteinte (${duree} ms) : lecture abandonnée` };
    throw e;
  }
}
