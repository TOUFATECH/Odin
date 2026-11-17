// Médias reçus : les écritures (systèmes d'écriture) d'un texte, caractère par caractère. Sert à couper les
// sous-titres (largeur et vitesse de lecture propres à chaque écriture), à repérer le sens droite à gauche, à compter
// les mots là où il n'y a pas d'espaces, et à dire dans quelle écriture un texte lu est écrit. Aucune langue n'est
// supposée : les motifs ne s'appliquent qu'à UN caractère à la fois (pas de quantificateur, pas de recul possible).

/** Écritures repérées, avec leur nom en clair. L'ordre ne compte pas : un caractère n'appartient qu'à une écriture. */
const ECRITURES: Array<[RegExp, string]> = [
  [/\p{Script=Latin}/u, 'latine'], [/\p{Script=Cyrillic}/u, 'cyrillique'], [/\p{Script=Greek}/u, 'grecque'],
  [/\p{Script=Arabic}/u, 'arabe'], [/\p{Script=Hebrew}/u, 'hébraïque'], [/\p{Script=Syriac}/u, 'syriaque'],
  [/\p{Script=Thaana}/u, 'thâna'], [/\p{Script=Nko}/u, 'n\'ko'], [/\p{Script=Han}/u, 'idéogrammes (han)'],
  [/\p{Script=Hiragana}/u, 'japonaise (hiragana)'], [/\p{Script=Katakana}/u, 'japonaise (katakana)'], [/\p{Script=Hangul}/u, 'coréenne (hangeul)'],
  [/\p{Script=Thai}/u, 'thaïe'], [/\p{Script=Lao}/u, 'lao'], [/\p{Script=Khmer}/u, 'khmère'], [/\p{Script=Myanmar}/u, 'birmane'],
  [/\p{Script=Devanagari}/u, 'devanagari'], [/\p{Script=Bengali}/u, 'bengalie'], [/\p{Script=Gurmukhi}/u, 'gurmukhi'],
  [/\p{Script=Gujarati}/u, 'gujarati'], [/\p{Script=Oriya}/u, 'oriya'], [/\p{Script=Tamil}/u, 'tamoule'], [/\p{Script=Telugu}/u, 'télougou'],
  [/\p{Script=Kannada}/u, 'kannada'], [/\p{Script=Malayalam}/u, 'malayalam'], [/\p{Script=Sinhala}/u, 'cingalaise'],
  [/\p{Script=Tibetan}/u, 'tibétaine'], [/\p{Script=Georgian}/u, 'géorgienne'], [/\p{Script=Armenian}/u, 'arménienne'],
  [/\p{Script=Ethiopic}/u, 'éthiopienne (guèze)'], [/\p{Script=Mongolian}/u, 'mongole'], [/\p{Script=Tifinagh}/u, 'tifinagh'],
  [/\p{Script=Cherokee}/u, 'cherokee'], [/\p{Script=Canadian_Aboriginal}/u, 'syllabaire autochtone canadien'], [/\p{Script=Vai}/u, 'vaï'],
  [/\p{Script=Adlam}/u, 'adlam'], [/\p{Script=Bopomofo}/u, 'bopomofo'], [/\p{Script=Yi}/u, 'yi'], [/\p{Script=Javanese}/u, 'javanaise'],
  [/\p{Script=Balinese}/u, 'balinaise'], [/\p{Script=Sundanese}/u, 'soundanaise'], [/\p{Script=Ol_Chiki}/u, 'ol chiki'],
];
const LETTRE = /\p{L}/u;
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ASIE_SE = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const SANS_ESPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;

export const estLettre = (ch: string): boolean => LETTRE.test(ch);

/** Nombre de lettres (au sens Unicode) d'un texte, en s'arrêtant à `max`. */
export function compterLettres(t: string, max = Infinity): number {
  let n = 0;
  for (const ch of t) { if (LETTRE.test(ch)) { n++; if (n >= max) break; } }
  return n;
}

/** L'écriture dominante des lettres d'un texte (sur les 4 096 premières lettres) ; « inconnue » sans lettre. */
export function ecritureDominante(t: string): string {
  const compte = new Map<string, number>();
  let vues = 0;
  for (const ch of t) {
    if (!LETTRE.test(ch)) continue;
    if (++vues > 4096) break;
    let nom = 'autre';
    for (const [re, n] of ECRITURES) if (re.test(ch)) { nom = n; break; }
    compte.set(nom, (compte.get(nom) ?? 0) + 1);
  }
  let meilleur = 'inconnue', n = 0;
  for (const [k, v] of compte) if (v > n) { meilleur = k; n = v; }
  // Le japonais mêle kanji et kana : on le dit comme une seule écriture.
  if (meilleur.startsWith('idéogrammes') && ((compte.get('japonaise (hiragana)') ?? 0) + (compte.get('japonaise (katakana)') ?? 0)) > 0) return 'japonaise (kanji et kana)';
  if (meilleur.startsWith('japonaise')) return 'japonaise (kanji et kana)';
  return meilleur;
}

/** Le premier caractère « fort » (une lettre) est-il d'une écriture de droite à gauche ? */
export function droiteAGauche(t: string): boolean {
  for (const ch of t) if (LETTRE.test(ch)) return RTL.test(ch);
  return false;
}

/** Classe de lecture d'un texte pour les sous-titres : largeur d'une ligne (graphèmes) et vitesse (graphèmes par seconde). */
export function classeLecture(t: string): { parLigne: number; parSeconde: number; sansEspaces: boolean } {
  let cjk = 0, se = 0, autres = 0, vues = 0;
  for (const ch of t) {
    if (!LETTRE.test(ch)) continue;
    if (++vues > 2048) break;
    if (CJK.test(ch)) cjk++; else if (ASIE_SE.test(ch)) se++; else autres++;
  }
  if (cjk > 0 && cjk >= se && cjk >= autres) return { parLigne: 16, parSeconde: 7, sansEspaces: true };
  if (se > 0 && se >= autres) return { parLigne: 35, parSeconde: 17, sansEspaces: true };
  return { parLigne: 42, parSeconde: 17, sansEspaces: false };
}

/** Le caractère appartient-il à une écriture qui ne sépare pas ses mots par des espaces ? */
export const sansEspaces = (ch: string): boolean => SANS_ESPACES.test(ch);

let segMots: Intl.Segmenter | undefined;
let segGraph: Intl.Segmenter | undefined;
/** Les mots d'un texte (Intl.Segmenter, `isWordLike`) : juste en japonais, chinois, thaï, sans espaces. */
export function mots(t: string, langue?: string): Array<{ index: number; texte: string }> {
  let seg: Intl.Segmenter;
  try { seg = langue ? new Intl.Segmenter(langue, { granularity: 'word' }) : (segMots ??= new Intl.Segmenter(undefined, { granularity: 'word' })); }
  catch { seg = (segMots ??= new Intl.Segmenter(undefined, { granularity: 'word' })); }
  const r: Array<{ index: number; texte: string }> = [];
  for (const s of seg.segment(t)) if (s.isWordLike) r.push({ index: s.index, texte: s.segment });
  return r;
}
/** Nombre de mots (borné). */
export function compterMots(t: string, max = 10_000_000): number {
  let n = 0;
  const seg = (segMots ??= new Intl.Segmenter(undefined, { granularity: 'word' }));
  for (const s of seg.segment(t)) if (s.isWordLike && ++n >= max) break;
  return n;
}
/** Les graphèmes d'un texte (index en unités UTF-16). */
export function graphemes(t: string): Array<{ index: number; texte: string }> {
  const seg = (segGraph ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' }));
  const r: Array<{ index: number; texte: string }> = [];
  for (const s of seg.segment(t)) r.push({ index: s.index, texte: s.segment });
  return r;
}
export function compterGraphemes(t: string): number {
  let n = 0;
  for (const _ of (segGraph ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })).segment(t)) n++;
  return n;
}
