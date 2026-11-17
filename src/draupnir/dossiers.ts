// Talos : les dossiers du propriétaire (onglets de la page), l'écriture atomique des fichiers et les règles
// de nom. Un dossier n'est qu'un identifiant et un nom : une automatisation garde l'identifiant dans son champ
// `dossier`, jamais le nom, donc renommer un dossier ne touche à aucune automatisation.
// Les comparaisons de noms ne dépendent d'aucune langue (NFKC puis minuscules).

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Identifiant d'un dossier du propriétaire. */
export const RE_DOSSIER = /^d-[a-z0-9]{4,24}$/;
/** Identifiant d'une automatisation (aussi le nom de son fichier) : jamais de chemin. */
export const RE_ID = /^[\w-]{1,64}$/;
/** Clé d'un élément de la corbeille (nom du fichier sans « .json »). */
export const RE_CLE = /^[\w-]{1,90}$/;
/** Onglets fixes de la page : leurs noms ne peuvent pas servir à un dossier. */
export const NOMS_RESERVES = ['Actives', 'Brouillons', 'Corbeille'] as const;
export const MAX_DOSSIERS = 50;
export const NOM_MAX = 40;

export interface Dossier { id: string; nom: string; cree: string }
/**
 * Caractères interdits dans un nom : contrôles et caractères de format invisibles, sauf l'antiliant et le liant sans
 * chasse (U+200C, U+200D), indispensables à l'écriture de plusieurs langues (persan, langues de l'Inde, émojis composés).
 */
export const RE_INTERDIT = /(?![‌‍])[\p{Cc}\p{Cf}]/u;
/** Combien d'identifiants de dossiers supprimés on garde en mémoire (voir `lireSupprimes`). */
const SUPPRIMES_MAX = 200;
/** Trace laissée dans un fichier de la corbeille. */
export interface TraceCorbeille { le: string; dossier?: string; etaitActive: boolean }

/**
 * Écrit un fichier JSON d'un coup : d'abord un fichier temporaire à côté, puis un renommage. Une coupure au milieu
 * laisse l'ancien fichier entier (le « .tmp » restant n'est jamais lu : seuls les « .json » le sont).
 */
export function ecrireJson(chemin: string, valeur: unknown): void {
  const tmp = `${chemin}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(valeur, null, 2));
  renameSync(tmp, chemin);
}

/** Blancs du début et de la fin enlevés, toute suite de blancs réduite à une espace. */
export const nettoyerNom = (nom: unknown): string => String(nom ?? '').replace(/\s+/gu, ' ').trim();
/** Forme de comparaison de deux noms (les accents comptent, la casse non). */
export const cleNom = (nom: string): string => nom.normalize('NFKC').toLowerCase();

/**
 * Vérifie un nom de dossier et le rend nettoyé. `sauf` : l'identifiant du dossier qu'on renomme (garder son propre
 * nom n'est pas un doublon). Lève l'erreur au texte exact attendu par la page.
 */
export function validerNomDossier(brut: unknown, dossiers: Dossier[], sauf?: string): string {
  const nom = nettoyerNom(brut);
  if (!nom) throw new Error('nom vide');
  if ([...nom].length > NOM_MAX) throw new Error(`nom trop long (${NOM_MAX} caractères au plus)`);
  if (RE_INTERDIT.test(nom) || /[/\\<>]/.test(nom)) throw new Error('caractère interdit dans le nom');
  const k = cleNom(nom);
  if (NOMS_RESERVES.some((r) => cleNom(r) === k)) throw new Error('nom réservé');
  if (dossiers.some((d) => d.id !== sauf && cleNom(d.nom) === k)) throw new Error('ce dossier existe déjà');
  return nom;
}

/** Une entrée lue de dossiers.json est-elle bien formée ? */
function entreeValide(x: unknown): x is Dossier {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  if (typeof d.id !== 'string' || !RE_DOSSIER.test(d.id) || typeof d.nom !== 'string') return false;
  const nom = nettoyerNom(d.nom);
  return Boolean(nom) && nom === d.nom && [...nom].length <= NOM_MAX && !RE_INTERDIT.test(nom) &&!/[/\\<>]/.test(nom);
}

/**
 * Lit dossiers.json. Absent : aucun dossier. Illisible ou mal formé : il est mis de côté (renommé, jamais effacé)
 * et on repart d'une liste vide, sans lever d'erreur. Les entrées invalides ou en double sont ignorées.
 */
export function lireDossiers(chemin: string, maintenant = Date.now()): Dossier[] {
  if (!existsSync(chemin)) return [];
  let brut: unknown;
  try { brut = JSON.parse(readFileSync(chemin, 'utf8')); } catch { brut = undefined; }
  const liste = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as { dossiers?: unknown }).dossiers : undefined;
  if (!Array.isArray(liste)) {
    try { renameSync(chemin, `${chemin}.illisible-${maintenant}`); } catch { /* laissé tel quel : on ne l'efface jamais */ }
    return [];
  }
  const vus = new Set<string>(), noms = new Set<string>(), out: Dossier[] = [];
  for (const x of liste) {
    if (!entreeValide(x) || vus.has(x.id) || noms.has(cleNom(x.nom))) continue;
    vus.add(x.id); noms.add(cleNom(x.nom));
    out.push({ id: x.id, nom: x.nom, cree: typeof x.cree === 'string' ? x.cree : '' });
  }
  return out;
}

/**
 * Écrit dossiers.json. `supprimes` : identifiants des dossiers supprimés, gardés (les 200 derniers) pour qu'un éditeur
 * resté ouvert sur une automatisation de ce dossier puisse encore l'enregistrer (elle revient alors « sans dossier »).
 */
export function ecrireDossiers(chemin: string, dossiers: Dossier[], supprimes = lireSupprimes(chemin)): void {
  const garde = [...new Set(supprimes.filter((x) => RE_DOSSIER.test(x) && !dossiers.some((d) => d.id === x)))].slice(-SUPPRIMES_MAX);
  ecrireJson(chemin, { version: 1, dossiers, ...(garde.length ? { supprimes: garde } : {}) });
}

/** Les identifiants des dossiers supprimés (liste vide si le fichier manque ou est abîmé). Ne renomme rien. */
export function lireSupprimes(chemin: string): string[] {
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8')) as { supprimes?: unknown };
    return Array.isArray(brut?.supprimes) ? brut.supprimes.filter((x): x is string => typeof x === 'string' && RE_DOSSIER.test(x)) : [];
  } catch { return []; }
}
