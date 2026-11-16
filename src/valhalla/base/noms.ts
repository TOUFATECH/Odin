// Alexandrie — le nom de la base de chaque appli : le nom affiché de l'appli, sans accents ni espaces, en
// majuscules, puis « _ODIN » (Phénix → PHENIX_ODIN, Persona → PERSONA_ODIN). Le compte PostgreSQL de l'appli porte le
// même nom. PostgreSQL met en minuscules un nom qui n'est pas entre guillemets : ces noms sont donc TOUJOURS
// écrits entre guillemets dans le SQL (`ident`), et passés tels quels aux programmes (pg_dump, createdb).
import { NAMES } from '../names.ts';

/** Les applis dont le nom affiché n'est pas dans NAMES (elles gardent leur nom), et les parties d'Odin qui ont une base. */
export const AUTRES_NOMS: Record<string, string> = {
  forseti: 'Forseti', midgard: 'Midgard', valgrind: 'Valgrind',
  // le fil des bulles de la mascotte (les messages d'Odin sur tous les écrans)
  mascotte: 'Mascotte',
  // journaux dont l'appli n'est pas connue (essais, anciens noms)
  journaux: 'Journaux',
  // Odin lui-même : ses réglages et ceux des applis (base ODIN_ODIN, reglages-base.ts)
  odin: 'Odin',
};

/** Le nom affiché d'une appli (ou son identifiant s'il n'est connu nulle part). */
export const nomAffiche = (id: string): string => NAMES[id] ?? AUTRES_NOMS[id] ?? id;

/** Majuscules sans accents ni signes : « Bifröst » → « BIFROST », « Þjálfi » → « THJALFI ». */
export function majuscules(t: string): string {
  return t.replace(/[ðÐ]/g, 'd').replace(/[þÞ]/g, 'th').replace(/[æÆ]/g, 'ae').replace(/[œŒ]/g, 'oe').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Le nom de la base (et du compte) d'une appli : NOM_ODIN (63 caractères au plus, la limite de PostgreSQL). */
export function nomBase(id: string, affiche = nomAffiche(id)): string {
  const n = majuscules(affiche) || majuscules(id) || 'APPLI';
  return `${n.slice(0, 58)}_ODIN`;
}
/** Le nom suit-il la règle ? (majuscules, chiffres, « _ », fini par « _ODIN ») */
export const nomConforme = (n: string): boolean => /^[A-Z][A-Z0-9_]{0,57}_ODIN$/.test(n);

/** Un nom PostgreSQL entre guillemets (les guillemets du nom doublés) : la casse est gardée. */
export const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** À quelle appli appartient un journal (sa base) : `forge_<appli>` → l'appli ; les autres sont nommés ici. */
const JOURNAL_APPLI: Record<string, string> = {
  alertes: 'forseti', bulles: 'mascotte', connexions: 'var', arche: 'skuld', requetes: 'urdr', liens_bases: 'urdr', thjalfi_etapes: 'thjalfi', dodone_envois: 'dodone',
};
export function proprietaireJournal(nom: string): string {
  if (JOURNAL_APPLI[nom]) return JOURNAL_APPLI[nom];
  const f = /^forge_([a-z0-9_]+)$/.exec(nom); if (f && (NAMES[f[1]] || AUTRES_NOMS[f[1]])) return f[1];
  if (NAMES[nom] || AUTRES_NOMS[nom]) return nom;
  return 'journaux';
}

const plat = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** L'appli désignée par un texte : son nom affiché (« Phénix », « phenix »), son identifiant, ou le nom de sa base. */
export function appliDeNom(texte: string): string | undefined {
  const t = plat(texte); if (!t) return undefined;
  const ids = [...Object.keys(NAMES), ...Object.keys(AUTRES_NOMS)];
  const exact = ids.find((id) => plat(nomAffiche(id)) === t || id === t || plat(nomBase(id)) === t);
  if (exact) return exact;
  // « la base de Phénix », « Phénix ? » : le nom d'une appli comme mot entier dans le texte (le plus long d'abord)
  const mots = ` ${t} `;
  return ids.filter((id) => mots.includes(` ${plat(nomAffiche(id))} `)).sort((a, b) => plat(nomAffiche(b)).length - plat(nomAffiche(a)).length)[0];
}
