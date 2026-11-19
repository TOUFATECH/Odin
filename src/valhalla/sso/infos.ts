// Les informations d'une personne de Persona (en plus de son nom affiché) : l'année de naissance et la langue, toutes
// deux facultatives. Seule l'année est gardée, jamais la date complète : l'âge est connu à un an près, et il n'est
// jamais rangé (il serait faux l'an prochain) : il est recalculé à chaque lecture.
// Ces informations sont chiffrées dans le fichier de Persona (src/prive.ts) ; la personne et le propriétaire seuls les
// voient ; elles ne partent jamais vers un logiciel relié (les jetons de oidc.ts ne les contiennent pas).

/** Les champs d'informations d'une personne (rien d'autre). */
export const CHAMPS_INFOS = ['naissance', 'langue'] as const;
export interface Infos { /** année de naissance (quatre chiffres) */ naissance?: number; /** langue, telle que la personne l'écrit */ langue?: string }
export const ANNEE_MIN = 1900;

/** L'âge atteint dans l'année de `maintenant` (la personne a cet âge, ou un an de moins si son anniversaire n'est pas passé). */
export function ageDe(annee: number, maintenant: Date): number { return maintenant.getFullYear() - annee; }

/** L'âge à montrer : « 36 ans cette année ». */
export const texteAge = (annee: number, maintenant: Date): string => { const a = ageDe(annee, maintenant); return `${a} an${a > 1 ? 's' : ''} cette année`; };

/** L'année de naissance saisie ; vide : undefined ; impossible (avenir, avant 1900, autre chose qu'une année) : erreur claire. */
export function lireAnnee(v: unknown, maintenant: Date): number | undefined {
  const x = (v === undefined || v === null ? '' : String(v)).trim(); if (!x) return undefined;
  const max = maintenant.getFullYear(), n = Number(x);
  if (!/^\d{4}$/.test(x) || n < ANNEE_MIN || n > max) throw new Error(`année de naissance : quatre chiffres, entre ${ANNEE_MIN} et ${max} (ex. 1990), ou rien`);
  return n;
}

/** La langue saisie (lettres de toute écriture, espaces, apostrophes, traits d'union ; 40 caractères au plus) ; vide : undefined. */
export function lireLangue(v: unknown): string | undefined {
  const x = (v === undefined || v === null ? '' : String(v)).trim().normalize('NFC'); if (!x) return undefined;
  if (x.length > 40 || !/^\p{L}[\p{L}\p{M} '’-]*$/u.test(x)) throw new Error('langue : son nom en lettres (40 caractères au plus), ou rien');
  return x;
}

/** Les informations saisies dans un formulaire, vérifiées ; seules celles qui sont données (une erreur claire sinon). */
export function lireInfos(i: Record<string, unknown>, maintenant: Date): Infos {
  const n = lireAnnee(i.naissance, maintenant), l = lireLangue(i.langue);
  return { ...(n !== undefined ? { naissance: n } : {}), ...(l !== undefined ? { langue: l } : {}) };
}

/** Une copie de la personne sans ses informations (pour quelqu'un qui n'a pas à les voir). */
export function sansInfos<P extends object>(p: P): P {
  const c = { ...p } as Record<string, unknown>; for (const k of CHAMPS_INFOS) delete c[k]; return c as P;
}
