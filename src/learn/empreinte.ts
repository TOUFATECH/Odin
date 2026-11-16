// Empreinte d'une information apprise : une signature courte et stable de ce qu'Odin a lu, pour ne
// « reprendre que ce qui a changé » (point 2 de la demande du propriétaire). Deux apports de MÊME source
// au MÊME contenu portent la même empreinte : Odin ne les range alors qu'une fois, jamais deux.
//
// On réutilise l'idée d'empreinte() de src/brain/nous/corpus.ts (FNV-1a) : pas un nouveau hachage, le même,
// mais sur une chaîne (source + contenu) plutôt que sur des morceaux. Le contenu est « replié » (minuscules,
// sans accents, espaces simples) pour qu'une simple mise en forme ne change pas l'empreinte.

/** Replie un texte : minuscules, sans accents, espaces simples, sans espace de début/fin. */
function replier(t: string): string {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** FNV-1a sur une chaîne (même esprit que corpus.ts), rendu en base 36. */
function fnv1a(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h ^= c & 0xff; h = Math.imul(h, 16777619);
    h ^= (c >>> 8) & 0xff; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Empreinte d'un fait appris, sur sa source et son contenu (sans la date) : c'est l'IDENTITÉ du fait.
 * Même source + même contenu => même empreinte => pas de ré-absorption. Un contenu qui change => empreinte
 * différente => Odin reprend la nouveauté.
 */
export function empreinteDe(source: string, contenu: string): string {
  const c = replier(contenu);
  return `${c.length}:${fnv1a(`${replier(source)}\u0001${c}`)}`;
}

/**
 * Empreinte qui tient compte de la date (version d'un fait à un instant donné) : utile pour savoir si l'on a
 * déjà vu exactement cette version-là, quand la date fait partie de ce qui distingue deux apports.
 */
export function empreinteAvecDate(source: string, date: string | number | undefined, contenu: string): string {
  const d = date == null ? '' : typeof date === 'number' ? String(date) : date;
  return `${empreinteDe(source, contenu)}:${fnv1a(d)}`;
}
