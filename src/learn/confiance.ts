// Juger ce qu'Odin apprend AVANT de s'en servir (point 5 de la demande du propriétaire).
//
// Chaque fait appris porte un NIVEAU DE CONFIANCE clair :
//  - « à vérifier »  : une seule source (ou preuves insuffisantes) ;
//  - « confirmé »    : au moins deux groupes de sources INDÉPENDANTS qui concordent (ou une source officielle
//                      primaire), sans contradiction sérieuse ;
//  - « contesté »    : les sources se contredisent — Odin garde les deux versions et le dit ;
//  - « donné par toi »: le propriétaire — prime sur tout.
//
// Le jugement se fait AU MOMENT D'APPRENDRE (et la nuit), jamais au moment de répondre : à la réponse, le
// niveau est déjà calculé et seulement lu. Ce module est PUR (aucun accès au disque, aucun modèle) : il mappe
// le verdict de la recherche vérifiée (verdictOf/clusterSources de research.ts) vers un niveau, vérifie la
// COHÉRENCE interne (dates impossibles, chiffres absurdes) et l'INTÉRÊT (pub, hors-sujet, vide), et donne la
// FRAÎCHEUR attendue (un prix ou une actualité se périment vite, une définition non).

/** Le niveau de confiance d'un fait appris. */
export type Niveau = 'à vérifier' | 'confirmé' | 'contesté' | 'donné par toi';

/** Le verdict d'une affirmation tel que le rend verdictOf() de src/research/research.ts. */
export interface VerdictBrut {
  verdict: 'confirmé' | 'probable' | 'contredit' | 'incertain' | 'insuffisant';
  /** Nombre de groupes de sources indépendants qui soutiennent l'affirmation. */
  independent: number;
}

/** Le jugement d'un fait : son niveau, une confiance 0–1 (déjà calculée), sa fraîcheur, s'il faut le garder. */
export interface Jugement {
  niveau: Niveau;
  confiance: number;
  /** Durée au bout de laquelle le fait est « vieux » et à revérifier (ms). */
  fraicheurMs: number;
  /** Faux = à ne pas retenir (publicité, hors-sujet, vide). */
  garder: boolean;
  raisons: string[];
}

const JOUR = 86_400_000;
/** Fraîcheur : courte (prix, actualité), moyenne (le reste), longue (définition, fait stable). */
export const FRAICHEUR = { COURTE: 2 * JOUR, MOYENNE: 30 * JOUR, LONGUE: 365 * JOUR } as const;

const CONFIANCE: Record<Niveau, number> = { 'donné par toi': 1, 'confirmé': 0.85, 'à vérifier': 0.4, 'contesté': 0.3 };

/** Replie un texte : minuscules, sans accents (pour des repères simples et sûrs). */
const plie = (t: string): string => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Mappe le verdict de la recherche vérifiée vers un niveau de confiance. */
export function niveauDeVerdict(v: VerdictBrut): Niveau {
  switch (v.verdict) {
    case 'confirmé': return 'confirmé';
    case 'contredit': return 'contesté';
    case 'incertain': return 'contesté';
    case 'probable': return 'à vérifier';
    default: return 'à vérifier'; // insuffisant
  }
}

// ---------------------------------------------------------------------------------------------------
// Cohérence interne : un fait qui se contredit lui-même (date impossible, chiffre absurde) est mis en doute.

const MOIS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
// Jours maximum par mois (février toléré à 29 pour ne pas dépendre de l'année).
const JOURS_MAX = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Une date écrite en toutes lettres qui ne peut pas exister (« 30 février », « 31 avril »). Pur. */
export function dateImpossible(texte: string): boolean {
  const t = plie(texte);
  const re = /\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g;
  for (const m of t.matchAll(re)) {
    const jour = Number(m[1]), mois = MOIS[m[2]];
    if (jour < 1 || (mois >= 1 && jour > JOURS_MAX[mois - 1])) return true;
  }
  return false;
}

/** Un chiffre manifestement absurde : une part de plus de 100 %, ou un âge de plus de 150 ans. Pur. */
export function chiffreAbsurde(texte: string): boolean {
  const t = plie(texte);
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*%\s+(?:de|des|du)\b/g)) {
    if (Number(m[1].replace(',', '.')) > 100) return true;
  }
  for (const m of t.matchAll(/\b(?:age|ages?|agee?)\s+de\s+(\d+)\s*ans\b/g)) {
    if (Number(m[1]) > 150) return true;
  }
  return false;
}

const PUB = /cliquez ici|abonnez-?vous|inscrivez-?vous|offre (speciale|limitee)|\bpromo\b|soldes|publicit|sponsoris|\bcookies?\b|newsletter|acceptez (les|nos) (conditions|cookies)|page introuvable|404 not found/;

/** Un contenu sans intérêt (publicité, bandeau, hors-sujet, vide) : à ne pas retenir. Pur. */
export function sansInteret(texte: string): boolean {
  const t = String(texte ?? '').trim();
  if (t.length < 8) return true;
  if (!/[a-zA-ZÀ-ÿ]/.test(t)) return true; // aucune lettre : code, chiffres isolés, bruit
  return PUB.test(plie(t));
}

const ACTU = /\bprix\b|tarif|\bcout|coute|euros?\b|dollars?\b|cours de|\bbourse\b|meteo|temperature|actualite|aujourd'hui|ce matin|ce soir|\bpromo\b|derniere version|mise a jour|\bnews\b|\bscore\b|\bmatch\b|resultat|classement|en direct/;
const DEF = /definition|\bse definit|signifie|\bdesigne\b|histoire de|\binvente|capitale de|\bformule\b|theoreme|\bloi de\b|\bne en \d|fonde en \d|situe dans|situee dans/;

/** La fraîcheur attendue d'un fait selon ce qu'il dit : courte pour un prix ou une actualité, longue pour une
 *  définition ou un fait stable, moyenne sinon. Pur. */
export function fraicheurDe(texte: string): number {
  const t = plie(texte);
  if (ACTU.test(t)) return FRAICHEUR.COURTE;
  if (DEF.test(t)) return FRAICHEUR.LONGUE;
  return FRAICHEUR.MOYENNE;
}

// ---------------------------------------------------------------------------------------------------

/** Ce qu'on donne à juger : le texte du fait, le verdict de la recherche (s'il y en a un), et si c'est le
 *  propriétaire qui parle (il prime sur tout). */
export interface OptionsJugement {
  texte: string;
  verdict?: VerdictBrut;
  proprietaire?: boolean;
}

/**
 * Juge un fait : niveau de confiance, cohérence, intérêt, fraîcheur. Rapide et pur (fait AU MOMENT d'apprendre).
 *  - le propriétaire prime : « donné par toi », toujours gardé ;
 *  - un contenu sans intérêt n'est pas retenu (garder = faux) ;
 *  - une date impossible ou un chiffre absurde met le fait EN DOUTE (jamais avalé tel quel) : il redescend à
 *    « à vérifier » et porte la raison.
 */
export function juger(o: OptionsJugement): Jugement {
  if (o.proprietaire) {
    return { niveau: 'donné par toi', confiance: 1, fraicheurMs: FRAICHEUR.LONGUE, garder: true, raisons: ['donné par toi'] };
  }
  if (sansInteret(o.texte)) {
    return { niveau: 'à vérifier', confiance: 0, fraicheurMs: FRAICHEUR.COURTE, garder: false, raisons: ['sans intérêt (publicité, hors-sujet ou vide)'] };
  }
  const raisons: string[] = [];
  let niveau: Niveau = o.verdict ? niveauDeVerdict(o.verdict) : 'à vérifier';
  let douteux = false;
  if (dateImpossible(o.texte)) { raisons.push('date impossible'); douteux = true; }
  if (chiffreAbsurde(o.texte)) { raisons.push('chiffre absurde'); douteux = true; }
  if (douteux && niveau === 'confirmé') niveau = 'à vérifier';
  if (!raisons.length) raisons.push(niveau);
  const confiance = douteux ? Math.min(0.3, CONFIANCE[niveau]) : CONFIANCE[niveau];
  return { niveau, confiance, fraicheurMs: fraicheurDe(o.texte), garder: true, raisons };
}
