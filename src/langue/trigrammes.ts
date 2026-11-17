// Les trigrammes de caractères d'un texte, tels que les profils de langue les comptent (même découpage partout : à la
// fabrication des profils et à la reconnaissance). Pur.
//   « Bonjour Odin » → « ␣bo », « bon », « onj », …, « in␣ » (espace autour de chaque mot ; chiffres et ponctuation retirés).

/** Le texte préparé : minuscules, NFC, lettres et marques seulement, un espace entre les mots. */
export function preparer(texte: string): string {
  return texte.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}]+/gu, ' ').trim();
}

/** Les trigrammes d'un texte (avec répétitions), mots bordés d'espaces. */
export function trigrammes(texte: string): string[] {
  const out: string[] = [];
  for (const mot of preparer(texte).split(' ')) {
    if (!mot) continue;
    const c = [' ', ...mot, ' '];
    if (c.length < 3) continue;
    for (let k = 0; k + 2 < c.length; k++) out.push(c[k] + c[k + 1] + c[k + 2]);
  }
  return out;
}
