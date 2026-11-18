// La différence ligne à ligne entre deux textes : COMPLÈTE (chaque ligne, gardée, retirée ou ajoutée, rien de coupé),
// NUMÉROTÉE (numéro d'avant, numéro d'après). Pure. Fins de ligne « \r\n » ramenées à « \n » (comme les empreintes).
//
// Méthode : début et fin communs retirés, puis lignes présentes une seule fois de chaque côté prises comme repères
// (plus longue suite croissante), puis plus longue sous-suite commune sur les petits morceaux restants. Un morceau trop
// grand pour cette dernière est montré « tout retiré puis tout ajouté » : moins court à lire, mais toujours complet et exact.

export type GenreLigne = ' ' | '-' | '+';
export interface LigneDiff {
  genre: GenreLigne;
  /** Numéro dans le texte d'avant (lignes gardées et retirées), à partir de 1. */
  avant?: number;
  /** Numéro dans le texte d'après (lignes gardées et ajoutées), à partir de 1. */
  apres?: number;
  texte: string;
}

/** Au-delà de ce produit (lignes d'avant × lignes d'après) un morceau n'est pas comparé finement (mémoire). */
export const PRODUIT_MAX = 4_000_000;

const lignesDe = (t: string): string[] => t.replace(/\r\n/g, '\n').split('\n');

type Op = { g: GenreLigne; i?: number; j?: number };

/** Plus longue sous-suite commune sur a[a0..a1) × b[b0..b1) (petits morceaux). */
function lcs(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number, out: Op[]): void {
  const n = a1 - a0, m = b1 - b0;
  if (!n || !m || n * m > PRODUIT_MAX) { for (let i = a0; i < a1; i++) out.push({ g: '-', i }); for (let j = b0; j < b1; j++) out.push({ g: '+', j }); return; }
  const L = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i * (m + 1) + j] = a[a0 + i] === b[b0 + j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) { out.push({ g: ' ', i: a0 + i, j: b0 + j }); i++; j++; }
    else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) { out.push({ g: '-', i: a0 + i }); i++; }
    else { out.push({ g: '+', j: b0 + j }); j++; }
  }
  for (; i < n; i++) out.push({ g: '-', i: a0 + i });
  for (; j < m; j++) out.push({ g: '+', j: b0 + j });
}

/** Repères : lignes uniques des deux côtés, dans l'ordre (plus longue suite croissante). */
function reperes(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number): Array<[number, number]> {
  const compte = new Map<string, { na: number; nb: number; ia: number; ib: number }>();
  for (let i = a0; i < a1; i++) { const c = compte.get(a[i]) ?? { na: 0, nb: 0, ia: -1, ib: -1 }; c.na++; c.ia = i; compte.set(a[i], c); }
  for (let j = b0; j < b1; j++) { const c = compte.get(b[j]); if (c) { c.nb++; c.ib = j; } }
  const paires: Array<[number, number]> = [];
  for (const c of compte.values()) if (c.na === 1 && c.nb === 1) paires.push([c.ia, c.ib]);
  paires.sort((x, y) => x[0] - y[0]);
  // plus longue suite croissante sur les indices d'après (tri par patience)
  const piles: number[] = [], prec: number[] = new Array(paires.length).fill(-1);
  for (let k = 0; k < paires.length; k++) {
    let bas = 0, haut = piles.length;
    while (bas < haut) { const mi = (bas + haut) >> 1; if (paires[piles[mi]][1] < paires[k][1]) bas = mi + 1; else haut = mi; }
    if (bas > 0) prec[k] = piles[bas - 1];
    piles[bas] = k;
  }
  const suite: Array<[number, number]> = [];
  for (let k = piles.length ? piles[piles.length - 1] : -1; k >= 0; k = prec[k]) suite.push(paires[k]);
  return suite.reverse();
}

function comparer(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number, out: Op[]): void {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out.push({ g: ' ', i: a0, j: b0 }); a0++; b0++; }
  const fin: Op[] = [];
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) { a1--; b1--; fin.push({ g: ' ', i: a1, j: b1 }); }
  if ((a1 - a0) * (b1 - b0) <= 40_000) lcs(a, a0, a1, b, b0, b1, out);
  else {
    const r = reperes(a, a0, a1, b, b0, b1);
    if (!r.length) lcs(a, a0, a1, b, b0, b1, out);
    else {
      let pa = a0, pb = b0;
      for (const [ia, ib] of r) { comparer(a, pa, ia, b, pb, ib, out); out.push({ g: ' ', i: ia, j: ib }); pa = ia + 1; pb = ib + 1; }
      comparer(a, pa, a1, b, pb, b1, out);
    }
  }
  for (let k = fin.length - 1; k >= 0; k--) out.push(fin[k]);
}

/** La différence complète et numérotée de `avant` à `apres`. Pure. */
export function difference(avant: string, apres: string): LigneDiff[] {
  const a = lignesDe(avant), b = lignesDe(apres);
  const ops: Op[] = [];
  comparer(a, 0, a.length, b, 0, b.length, ops);
  return ops.map((o) => o.g === ' ' ? { genre: ' ', avant: o.i! + 1, apres: o.j! + 1, texte: a[o.i!] }
    : o.g === '-' ? { genre: '-', avant: o.i! + 1, texte: a[o.i!] } : { genre: '+', apres: o.j! + 1, texte: b[o.j!] });
}

/** Combien de lignes retirées et ajoutées. Pur. */
export function compteDifference(d: LigneDiff[]): { retirees: number; ajoutees: number } {
  let retirees = 0, ajoutees = 0;
  for (const l of d) { if (l.genre === '-') retirees++; else if (l.genre === '+') ajoutees++; }
  return { retirees, ajoutees };
}

/** Le texte d'après, refait depuis la différence (preuve que rien n'est coupé). Pur. */
export function texteApres(d: LigneDiff[]): string { return d.filter((l) => l.genre !== '-').map((l) => l.texte).join('\n'); }
/** Le texte d'avant, refait depuis la différence. Pur. */
export function texteAvant(d: LigneDiff[]): string { return d.filter((l) => l.genre !== '+').map((l) => l.texte).join('\n'); }

/**
 * Ce qui ne se voit pas dans un texte affiché : caractères de contrôle (sauf la tabulation, dont un « \r » isolé), ceux
 * qui changent le sens d'écriture (U+061C, U+200E-200F, U+202A-202E, U+2066-2069), les largeurs nulles (U+200B-200D,
 * U+2060, U+FEFF) et les séparateurs de ligne Unicode (U+2028-2029). Ils peuvent faire lire autre chose que le code réel.
 */
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/g;
/** Le texte d'une ligne avec chacun de ces caractères écrit en clair, « ⟦U+202E⟧ ». Les lettres de toutes les langues restent telles quelles. Pur. */
export const rendreVisible = (t: string): string => t.replace(INVISIBLE, (c) => `⟦U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`);

/**
 * La différence à lire : une ligne par ligne, « numéro d'avant, numéro d'après, signe, texte » (« − » retirée,
 * « + » ajoutée, espace gardée). Toutes les lignes, sans coupure ; ce qui ne se voit pas est écrit en clair. Pur.
 */
export function texteDifference(d: LigneDiff[]): string {
  const larg = String(d.reduce((m, l) => Math.max(m, l.avant ?? 0, l.apres ?? 0), 0)).length;
  const num = (n?: number) => (n === undefined ? '' : String(n)).padStart(larg);
  return d.map((l) => `${num(l.avant)} ${num(l.apres)} ${l.genre === '-' ? '−' : l.genre} ${rendreVisible(l.texte)}`).join('\n');
}

/** Les fins de ligne d'un texte : aucune, toutes « \n », toutes « \r\n », ou mélangées. Pur. */
export function finsDeLigne(t: string): 'aucune' | 'lf' | 'crlf' | 'mixte' {
  const n = (t.match(/\n/g) ?? []).length, rn = (t.match(/\r\n/g) ?? []).length;
  return n === 0 ? 'aucune' : rn === 0 ? 'lf' : rn === n ? 'crlf' : 'mixte';
}
/**
 * Les fins de ligne changent-elles (la différence ligne à ligne les ramène à « \n », donc ne le montre pas) ? Vrai aussi
 * quand les deux textes ne diffèrent que par elles. Pur.
 */
export function finsDeLigneChangees(avant: string, apres: string): boolean {
  const a = finsDeLigne(avant), b = finsDeLigne(apres);
  if (a !== 'aucune' && b !== 'aucune' && a !== b) return true;
  return avant !== apres && lignesDe(avant).join('\n') === lignesDe(apres).join('\n');
}
