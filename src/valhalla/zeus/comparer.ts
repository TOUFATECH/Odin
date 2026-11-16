// Zeus — comparer des prévisions (pur). La référence est « l'information récupérée » (Open-Meteo, meilleur modèle pour
// ce lieu) ; chaque prédiction (un autre modèle, STRATA, ou le saisonnier) lui est comparée, grandeur par grandeur.
// Chaque verdict a sa couleur ET son mot (OK, Diffère, Souci, —) : jamais la couleur seule.
//
// Les seuils :
//  - température max ou min : écart de 2 °C ou moins = vert ; 5 °C ou moins = jaune ; au-delà = rouge « écart très grand » ;
//  - pluie : catégories sec (moins de 1 mm), faible (1 à 10 mm), forte (10 mm ou plus). Vert si l'écart est d'au plus
//    le plus grand de 2 mm et 50 % de l'information récupérée (même entre deux catégories voisines : 0,9 contre 1,1 mm
//    est la même bruine) ; jaune sinon ; rouge si sec contre forte ;
//  - vent max : 15 km/h ou moins = vert ; 30 km/h ou moins = jaune ; au-delà = rouge ;
//  - valeur impossible (température hors de −90 à 60 °C, min > max + 0,5, pluie hors de 0 à 500 mm, vent hors de 0 à
//    400 km/h) = rouge « valeur impossible » ; source en panne = rouge « ne répond pas » ;
//  - valeur absente (au-delà de la portée du modèle) = gris « ne prévoit pas si loin », non comptée.

import type { Tone } from '../types.ts';
import type { Valeurs } from './sources.ts';

export type Couleur = 'vert' | 'jaune' | 'rouge' | 'gris';
export type Mot = 'OK' | 'Diffère' | 'Souci' | '—';
export type Grandeur = keyof Valeurs;
export const GRANDEURS: Grandeur[] = ['tmax', 'tmin', 'pluie', 'vent'];
export const NOM_GRANDEUR: Record<Grandeur, string> = { tmax: 'Température max', tmin: 'Température min', pluie: 'Pluie', vent: 'Vent max' };
export const COURT_GRANDEUR: Record<Grandeur, string> = { tmax: 'T max', tmin: 'T min', pluie: 'Pluie', vent: 'Vent' };
export const MOT: Record<Couleur, Mot> = { vert: 'OK', jaune: 'Diffère', rouge: 'Souci', gris: '—' };
export const TON: Record<Couleur, Tone> = { vert: 'bon', jaune: 'attention', rouge: 'mauvais', gris: 'neutre' };
const RANG: Record<Couleur, number> = { gris: 0, vert: 1, jaune: 2, rouge: 3 };
/** La pire des couleurs (le gris ne compte pas). */
export const pire = (l: Couleur[]): Couleur => l.reduce<Couleur>((a, c) => (RANG[c] > RANG[a] ? c : a), 'gris');

export const PHRASE_VERT = 'Prédiction et information récupérée correctes';
export const NE_PREVOIT_PAS = 'ne prévoit pas si loin';

export const SEUILS = {
  temperature: { vert: 2, jaune: 5 },
  pluie: { sec: 1, forte: 10, ecartMm: 2, ecartPart: 0.5 },
  vent: { vert: 15, jaune: 30 },
  bornes: { tmin: -90, tmax: 60, pluieMax: 500, ventMax: 400, minSurMax: 0.5 },
} as const;

const un = (x: number) => Math.round(x * 10) / 10;
const fr = (x: number) => String(un(x)).replace('.', ',');
/** Une valeur avec son unité : « 21 °C », « 3,2 mm », « 28 km/h ». */
export function valeurTexte(g: Grandeur, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return g === 'pluie' ? `${fr(v)} mm` : g === 'vent' ? `${Math.round(v)} km/h` : `${fr(v)} °C`;
}

/** Pourquoi ces valeurs sont impossibles (ou rien). */
export function valeurImpossible(v: Partial<Valeurs>): string | undefined {
  const B = SEUILS.bornes;
  for (const g of ['tmax', 'tmin'] as const) { const x = v[g]; if (typeof x === 'number' && (!Number.isFinite(x) || x < B.tmin || x > B.tmax)) return `${NOM_GRANDEUR[g].toLowerCase()} de ${valeurTexte(g, x)}`; }
  if (typeof v.tmax === 'number' && typeof v.tmin === 'number' && v.tmin > v.tmax + B.minSurMax) return `minimum (${valeurTexte('tmin', v.tmin)}) au-dessus du maximum (${valeurTexte('tmax', v.tmax)})`;
  if (typeof v.pluie === 'number' && (!Number.isFinite(v.pluie) || v.pluie < 0 || v.pluie > B.pluieMax)) return `pluie de ${valeurTexte('pluie', v.pluie)}`;
  if (typeof v.vent === 'number' && (!Number.isFinite(v.vent) || v.vent < 0 || v.vent > B.ventMax)) return `vent de ${valeurTexte('vent', v.vent)}`;
  return undefined;
}

export type CategoriePluie = 'sec' | 'faible' | 'forte';
export const categoriePluie = (mm: number): CategoriePluie => (mm < SEUILS.pluie.sec ? 'sec' : mm < SEUILS.pluie.forte ? 'faible' : 'forte');

export interface Ecart { couleur: Couleur; /** écart signé (prédiction − récupérée) */ ecart?: number; /** l'écart rapporté au seuil du vert (pour trouver le plus grand) */ poids?: number; raison?: string }
/** Compare une grandeur : la prédiction face à l'information récupérée. */
export function comparerGrandeur(g: Grandeur, ref: number | null | undefined, pred: number | null | undefined): Ecart {
  if (pred === null || pred === undefined || ref === null || ref === undefined) return { couleur: 'gris', raison: NE_PREVOIT_PAS };
  const d = pred - ref, a = Math.abs(d);
  if (g === 'tmax' || g === 'tmin') {
    const S = SEUILS.temperature;
    return { couleur: a <= S.vert ? 'vert' : a <= S.jaune ? 'jaune' : 'rouge', ecart: d, poids: a / S.vert, ...(a > S.jaune ? { raison: 'écart très grand' } : {}) };
  }
  if (g === 'pluie') {
    const S = SEUILS.pluie, cr = categoriePluie(ref), cp = categoriePluie(pred), tol = Math.max(S.ecartMm, S.ecartPart * ref);
    const oppose = (cr === 'sec' && cp === 'forte') || (cr === 'forte' && cp === 'sec');
    // L'écart toléré suffit pour le vert, même entre deux catégories voisines (0,9 contre 1,1 mm : la même bruine).
    return { couleur: oppose ? 'rouge' : a <= tol ? 'vert' : 'jaune', ecart: d, poids: a / tol, ...(oppose ? { raison: cp === 'sec' ? 'annonce du sec quand l\'information récupérée annonce de fortes pluies' : 'annonce de fortes pluies quand l\'information récupérée annonce du sec' } : {}) };
  }
  const S = SEUILS.vent;
  return { couleur: a <= S.vert ? 'vert' : a <= S.jaune ? 'jaune' : 'rouge', ecart: d, poids: a / S.vert, ...(a > S.jaune ? { raison: 'écart très grand' } : {}) };
}
/** L'écart avec son unité et son signe (« +3 °C », « −12 km/h »). */
export function ecartTexte(g: Grandeur, d: number): string {
  const s = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${s}${valeurTexte(g, Math.abs(d))}`;
}

export interface Verdict { couleur: Couleur; mot: Mot; ton: Tone; phrase: string }
const verdict = (couleur: Couleur, phrase: string): Verdict => ({ couleur, mot: MOT[couleur], ton: TON[couleur], phrase });

/** Une prédiction d'un jour : `panne` = la source n'a pas répondu ; `valeurs` absentes = rien pour ce jour. */
export interface Prediction { source: string; valeurs?: Partial<Valeurs> | null; panne?: boolean;
  /** les grandeurs montrées mais non comptées (le vent « approché » de STRATA) */ nonComptees?: Grandeur[] }
export interface DetailGrandeur { source: string; grandeur: Grandeur; couleur: Couleur; ecart?: number }

/**
 * Le verdict d'un jour, le pire de toutes les comparaisons, avec la phrase exacte :
 *  - vert : « Prédiction et information récupérée correctes » ;
 *  - jaune : « Prédiction diffère : <source> annonce <valeur>, l'information récupérée <valeur> (écart <x>) » (le plus grand écart) ;
 *  - rouge : « Souci : <source> <raison> » ;
 *  - gris : rien à comparer (aucune source ne prévoit si loin).
 * `ref` : l'information récupérée de ce jour (`null` = la référence est en panne).
 */
export function verdictDuJour(ref: Partial<Valeurs> | null, preds: Prediction[], o: { grandeurs?: Grandeur[]; nomReference?: string } = {}): Verdict & { details: DetailGrandeur[] } {
  const grandeurs = o.grandeurs ?? GRANDEURS, details: DetailGrandeur[] = [];
  if (ref === null) return { ...verdict('rouge', `Souci : ${o.nomReference ?? 'l\'information récupérée'} ne répond pas`), details };
  const impRef = valeurImpossible(ref);
  if (impRef) return { ...verdict('rouge', `Souci : ${o.nomReference ?? 'l\'information récupérée'} donne une valeur impossible (${impRef})`), details };
  const rouges: string[] = []; let jaune: { poids: number; texte: string } | undefined; let vu = false;
  for (const p of preds) {
    if (p.panne) { rouges.push(`Souci : ${p.source} ne répond pas`); continue; }
    if (!p.valeurs) continue;
    const imp = valeurImpossible(p.valeurs);
    if (imp) { rouges.push(`Souci : ${p.source} valeur impossible (${imp})`); continue; }
    for (const g of grandeurs) {
      if (p.nonComptees?.includes(g)) continue;
      const e = comparerGrandeur(g, ref[g], p.valeurs[g]);
      details.push({ source: p.source, grandeur: g, couleur: e.couleur, ...(e.ecart !== undefined ? { ecart: e.ecart } : {}) });
      if (e.couleur === 'gris') continue;
      vu = true;
      if (e.couleur === 'rouge') rouges.push(`Souci : ${p.source} ${e.raison ?? 'écart très grand'} (${NOM_GRANDEUR[g].toLowerCase()} : ${valeurTexte(g, p.valeurs[g])} contre ${valeurTexte(g, ref[g])})`);
      else if (e.couleur === 'jaune' && (!jaune || (e.poids ?? 0) > jaune.poids)) jaune = { poids: e.poids ?? 0, texte: `Prédiction diffère : ${p.source} annonce ${valeurTexte(g, p.valeurs[g])}, l'information récupérée ${valeurTexte(g, ref[g])} (écart ${ecartTexte(g, e.ecart ?? 0)})` };
    }
  }
  if (rouges.length) return { ...verdict('rouge', rouges[0]), details };
  if (jaune) return { ...verdict('jaune', jaune.texte), details };
  if (vu) return { ...verdict('vert', PHRASE_VERT), details };
  return { ...verdict('gris', `Aucune prédiction à comparer : les sources ${NE_PREVOIT_PAS}`), details };
}
/** Le verdict d'une seule grandeur entre la référence et une prédiction (une case de tableau). */
export function verdictGrandeur(g: Grandeur, ref: number | null | undefined, pred: number | null | undefined, source: string): Verdict {
  const e = comparerGrandeur(g, ref, pred);
  if (e.couleur === 'gris') return verdict('gris', `${source} ${NE_PREVOIT_PAS}`);
  if (e.couleur === 'vert') return verdict('vert', PHRASE_VERT);
  if (e.couleur === 'jaune') return verdict('jaune', `Prédiction diffère : ${source} annonce ${valeurTexte(g, pred)}, l'information récupérée ${valeurTexte(g, ref)} (écart ${ecartTexte(g, e.ecart ?? 0)})`);
  return verdict('rouge', `Souci : ${source} ${e.raison ?? 'écart très grand'}`);
}
