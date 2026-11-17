// Profil, lot 3 — ce qu'Odin MESURE de la façon de parler et des habitudes d'une personne. Calcul pur : les données
// arrivent en paramètre (les demandes de son historique, lot 1, déjà résolues par src/muninn/personnes.ts), rien n'est
// lu ni écrit ici. Des mesures avec leur nombre d'observations, jamais un trait psychologique ni un jugement ; aucune
// liste de mots, aucune langue supposée (la langue vient du reconnaisseur d'Odin, passé en paramètre). Aucun texte à
// afficher ici : des codes, que l'écran traduira dans la langue de la personne. Une seule chaîne de ce fichier n'est
// pas un code : aucune (un essai le vérifie).
//
// D'où vient chaque donnée (l'historique ne recopie aucun texte : des renvois, src/muninn/store.ts:103) :
// - `t` : l'heure de la demande, notée par la passerelle (src/muninn/personnes.ts:72, :79).
// - `resultat` : l'issue du tour lancé par la demande (renvoi `mission`, posé au départ du tour, personnes.ts:57 ;
//   résolu par personnes.ts:107-112) ; « sans_tour » pour une commande traitée par la passerelle.
// - `texte` : le message de la personne, retrouvé par le renvoi `message` (personnes.ts:58) dans les conversations
//   (store.ts:254) ; absent pour une commande sans tour ou un message effacé depuis. Lu le temps du calcul, jamais gardé.
// - L'appli qui a servi la demande N'EST PAS notée par le lot 1 : « applis » est rendu « non mesuré ».

/** Sous ce nombre d'observations, une mesure est marquée « trop peu » (décision du propriétaire, 17/11). */
export const SEUIL_TROP_PEU = 20;

export type CleMesure = 'langues' | 'longueur' | 'heures' | 'applis' | 'abouties';
export const CLES_MESURES: readonly CleMesure[] = ['langues', 'longueur', 'heures', 'applis', 'abouties'];

/** Une demande de la personne, telle que l'historique permet de la voir. */
export interface Observation { t: number; resultat?: string; texte?: string }

export interface Mesure {
  cle: CleMesure;
  /** « mesure » : calculée ; « non-mesure » : la donnée n'est pas notée aujourd'hui (voir `aNoter`). */
  etat: 'mesure' | 'non-mesure';
  /** Le nombre d'observations sur lequel elle repose. */
  n: number;
  /** Moins de SEUIL_TROP_PEU observations. */
  tropPeu: boolean;
  /** null quand il n'y a rien à mesurer. Formes : voir mesurer(). */
  valeur: unknown;
  /** Pour une mesure non mesurée : ce qu'il faudrait noter à l'arrivée d'une demande. */
  aNoter?: string;
}

/** Ce que le propriétaire a décidé pour une mesure d'une personne : la cacher, ou la corriger (sa valeur remplace celle d'Odin). */
export interface ReglageMesure { cache?: boolean; valeur?: unknown; t: number }
export type ReglagesMesures = Partial<Record<CleMesure, ReglageMesure>>;

export interface MesureRendue extends Mesure {
  /** Cachée par le propriétaire (seul le propriétaire la reçoit encore, pour pouvoir la remettre). */
  cache: boolean;
  /** La valeur est celle du propriétaire, pas celle d'Odin. */
  corrigeParProprietaire: boolean;
  /** Pour le propriétaire seulement : la mesure d'Odin quand il l'a corrigée. */
  valeurMesuree?: unknown;
}

const arrondi = (x: number) => Math.round(x * 1000) / 1000;
const mesure = (cle: CleMesure, n: number, valeur: unknown): Mesure => ({ cle, etat: 'mesure', n, tropPeu: n < SEUIL_TROP_PEU, valeur });

let segmenteur: Intl.Segmenter | undefined;
/** La longueur d'un texte en caractères tels qu'on les voit (graphèmes), dans toutes les écritures. */
function graphemes(s: string): number {
  segmenteur ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0; for (const _ of segmenteur.segment(s)) n++;
  return n;
}
function mediane(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Les issues d'un tour fini (réussi, échoué, arrêté, ou fini en attente) : la base de la part des abouties. */
const FINIES = new Set(['reussi', 'echoue', 'arrete', 'en_attente']);

/**
 * Les mesures d'une personne sur ses demandes. Pur.
 * - langues : `{ parts: [{code, n, part}], nonReconnues: {n, part} }`, sur les demandes dont le texte est retrouvé ;
 *   une langue que le reconnaisseur ne donne pas pour sûre reste « non reconnue » (jamais devinée).
 * - longueur : `{ mediane, unite: 'grapheme' }`, médiane des longueurs des mêmes textes.
 * - heures : `{ cases: number[24] }`, toutes les demandes (commandes comprises), à l'heure donnée par `heureDe`.
 * - abouties : `{ part, abouties }` ; APPROXIMATION du lot 1 (personnes.ts:207) : « réussi » = le tour s'est terminé,
 *   pas encore « la bonne chose faite, vérifiée ». Base : les tours finis (ni les commandes, ni un tour en cours).
 * - applis : non mesuré (la donnée n'est pas notée).
 */
export function mesurer(obs: ReadonlyArray<Observation>, o: { langueDe: (texte: string) => string | undefined; heureDe?: (t: number) => number }): Mesure[] {
  const heureDe = o.heureDe ?? ((t: number) => new Date(t).getHours());
  const textes = obs.map((x) => x.texte).filter((x): x is string => typeof x === 'string');
  // Langues.
  const parCode = new Map<string, number>(); let inconnues = 0;
  for (const s of textes) { const c = o.langueDe(s); if (c) parCode.set(c, (parCode.get(c) ?? 0) + 1); else inconnues++; }
  const nt = textes.length;
  const langues = nt ? {
    parts: [...parCode].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([code, n]) => ({ code, n, part: arrondi(n / nt) })),
    nonReconnues: { n: inconnues, part: arrondi(inconnues / nt) },
  } : null;
  // Heures.
  const cases = Array<number>(24).fill(0);
  for (const x of obs) { const h = heureDe(x.t); if (Number.isInteger(h) && h >= 0 && h < 24) cases[h]++; }
  // Abouties.
  const finies = obs.filter((x) => FINIES.has(String(x.resultat)));
  const abouties = finies.filter((x) => x.resultat === 'reussi').length;
  return [
    mesure('langues', nt, langues),
    mesure('longueur', nt, nt ? { mediane: mediane(textes.map(graphemes)), unite: 'grapheme' } : null),
    mesure('heures', obs.length, { cases }),
    { cle: 'applis', etat: 'non-mesure', n: 0, tropPeu: true, valeur: null, aNoter: 'appli-du-tour' },
    mesure('abouties', finies.length, finies.length ? { part: arrondi(abouties / finies.length), abouties } : null),
  ];
}

const CODE_LANGUE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const CODE_APPLI = /^[a-z0-9_-]{1,40}$/;
const nombre = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;

/** Une correction du propriétaire, vérifiée et remise en forme ; undefined si elle est mal formée. Même forme que la mesure. */
export function validerCorrection(cle: CleMesure, v: unknown): unknown {
  const x = (v ?? {}) as Record<string, unknown>;
  if (cle === 'langues') {
    const parts = x.parts;
    if (!Array.isArray(parts) || !parts.length || parts.length > 20) return undefined;
    const out = parts.map((p) => ({ code: String((p as Record<string, unknown>)?.code ?? ''), part: (p as Record<string, unknown>)?.part }));
    if (!out.every((p) => CODE_LANGUE.test(p.code) && nombre(p.part, 0, 1))) return undefined;
    if (new Set(out.map((p) => p.code.toLowerCase())).size !== out.length) return undefined;
    if (out.reduce((s, p) => s + (p.part as number), 0) > 1.0001) return undefined;
    return { parts: out.map((p) => ({ code: p.code.toLowerCase(), part: arrondi(p.part as number) })) };
  }
  if (cle === 'longueur') return nombre(x.mediane, 0, 100_000) ? { mediane: x.mediane, unite: 'grapheme' } : undefined;
  if (cle === 'heures') {
    const c = x.cases;
    return Array.isArray(c) && c.length === 24 && c.every((h) => nombre(h, 0, 1e9)) ? { cases: [...c] } : undefined;
  }
  if (cle === 'abouties') return nombre(x.part, 0, 1) ? { part: arrondi(x.part as number) } : undefined;
  if (cle === 'applis') {
    const ids = x.ids;
    return Array.isArray(ids) && ids.length <= 20 && ids.every((i) => typeof i === 'string' && CODE_APPLI.test(i)) ? { ids: [...new Set(ids)] } : undefined;
  }
  return undefined;
}

/**
 * Les mesures telles qu'on les rend, avec ce que le propriétaire a décidé. Pur. `pourProprietaire` : il reçoit aussi
 * les mesures cachées (marquées) et, à côté de sa correction, la mesure d'Odin ; les autres ne reçoivent ni l'un ni
 * l'autre.
 */
export function rendreMesures(mesures: ReadonlyArray<Mesure>, reglages: ReglagesMesures, pourProprietaire: boolean): MesureRendue[] {
  const out: MesureRendue[] = [];
  for (const m of mesures) {
    const r = reglages[m.cle];
    const cache = r?.cache === true;
    if (cache && !pourProprietaire) continue;
    const corrige = r?.valeur !== undefined;
    out.push({
      ...m, cache, corrigeParProprietaire: corrige,
      ...(corrige ? { valeur: r!.valeur } : {}),
      ...(corrige && pourProprietaire ? { valeurMesuree: m.valeur } : {}),
    });
  }
  return out;
}
