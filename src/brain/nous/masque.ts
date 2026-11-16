// Masquage propre à Noûs, appliqué AVANT qu'un texte n'entre dans le corpus du réseau profond.
// Il complète Heimdall (src/heimdall/redact.ts, qu'il ne remplace pas) : Heimdall masque les clés
// techniques (sk-ant…, « password: », Bearer…) ; ici on masque ce qu'un texte français écrit à la
// main laisse passer et qui ne doit jamais être appris : « mot de passe »/« mdp », e-mail, téléphone,
// IBAN. Le corpus et les poids retenant ce qu'Odin lit, ce masquage protège la vie privée à la source.
// Module pur : aucune lecture ni écriture, rien de tiré au hasard.

/** Le remplaçant. Le label (« mot de passe ») reste, seule la valeur disparaît : le réseau apprend la
 *  forme de la phrase sans jamais garder le secret. */
export const MASQUE = '[masqué]';

// Chaque motif masque une catégorie. L'ordre compte : on retire d'abord les valeurs rattachées à un
// label (mot de passe), puis les formes autonomes (e-mail, téléphone, IBAN).
const MOT_DE_PASSE = /\b(mot\s+de\s+passe|mdp)\b(\s*(?:est|:|=|c['’]est|vaut|->)?\s*)("[^"]+"|'[^']+'|\S+)/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Téléphone FR : 0X XX XX XX XX ou +33 X XX XX XX XX, séparateurs espace, point ou tiret.
const TELEPHONE = /(?<![\d.])(?:(?:\+33|0033)\s?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}\b/g;
// IBAN : 2 lettres pays, 2 chiffres de contrôle, puis 11 à 30 caractères (espaces tolérés).
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}\b/g;
// Carte bancaire écrite par un humain : 16 chiffres d'affilée, ou 4 groupes de 4 séparés par espace ou tiret.
const CARTE = /\b(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}|\d{16})\b/g;
// NIR (sécurité sociale FR) : sexe (1/2) puis 14 chiffres (éventuellement espacés 1 2 2 2 3 3 2).
const NIR = /\b[12][ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b/g;

/**
 * Masque les secrets « à la française » d'un texte. Idempotent : repasser sur un texte déjà masqué ne
 * change rien. Ne lève jamais ; une entrée vide ou non-texte rend une chaîne vide.
 */
export function masquer(texte: string): string {
  if (typeof texte !== 'string' || texte.length === 0) return '';
  let t = texte;
  t = t.replace(MOT_DE_PASSE, (_m, label: string, lien: string) => `${label}${lien || ' '}${MASQUE}`);
  t = t.replace(EMAIL, MASQUE);
  t = t.replace(IBAN, MASQUE);
  t = t.replace(CARTE, MASQUE);
  t = t.replace(NIR, MASQUE);
  t = t.replace(TELEPHONE, MASQUE);
  return t;
}

/** Vrai si le texte contient encore un secret « à la française » après masquage (filet de sécurité).
 *  On repart de motifs neufs pour ne pas dépendre de l'état (lastIndex) des motifs globaux. */
export function contientSecret(texte: string): boolean {
  if (typeof texte !== 'string') return false;
  return new RegExp(EMAIL.source).test(texte)
    || new RegExp(IBAN.source).test(texte)
    || new RegExp(CARTE.source).test(texte)
    || new RegExp(NIR.source).test(texte)
    || new RegExp(TELEPHONE.source).test(texte);
}
