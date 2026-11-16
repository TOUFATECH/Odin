// Partage du temps d'une réponse et fraîcheur d'un souvenir (lot B « répondre vite »), pour l'afficher.
//
// « mémoire X ms · Cerveau Y ms · modèle Z ms » : le propriétaire voit où part le temps. Et quand une réponse
// est tirée de la mémoire, on dit d'où elle vient, de quand, et son niveau de confiance (DÉJÀ calculé à
// l'apprentissage ou la nuit — jamais recalculé ici). Rien que de l'affichage : pur, sans I/O.

import { ETAPE } from '../core/jalons.ts';

/** Les étapes regroupées en trois temps lisibles. */
const GROUPES: Record<string, string[]> = {
  mémoire: [ETAPE.chargement, ETAPE.direct, ETAPE.rappel, ETAPE.fts, ETAPE.embed, ETAPE.voisins],
  Cerveau: [ETAPE.cerveau],
  modèle: [ETAPE.modele, ETAPE.relecture],
};

const ms = (x: number) => `${Math.round(x)} ms`;

/**
 * « mémoire 12 ms · Cerveau 34 ms · modèle 820 ms » à partir du découpage des jalons. Les groupes à zéro
 * (ou absents) sont tus. Rend une chaîne vide s'il n'y a rien à montrer.
 */
export function ligneTemps(decoupage: Record<string, number> | undefined): string {
  if (!decoupage) return '';
  const parts: string[] = [];
  for (const [nom, etapes] of Object.entries(GROUPES)) {
    const t = etapes.reduce((s, e) => s + (decoupage[e] ?? 0), 0);
    if (t >= 0.5) parts.push(`${nom} ${ms(t)}`);
  }
  return parts.join(' · ');
}

/** « il y a 3 jours », « il y a 2 h », « à l'instant ». Pur. */
export function ilYA(at: number, maintenant = Date.now()): string {
  const d = Math.max(0, maintenant - at), min = Math.round(d / 60_000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j < 31) return `il y a ${j} jour${j > 1 ? 's' : ''}`;
  const mois = Math.round(j / 30);
  if (mois < 12) return `il y a ${mois} mois`;
  return `il y a ${Math.round(mois / 12)} an${mois >= 24 ? 's' : ''}`;
}

/** Nom lisible d'un niveau de confiance (déjà calculé ailleurs). */
export function libelleConfiance(niveau: string | undefined): string {
  switch (niveau) {
    case 'confirme': case 'confirmé': return 'confirmé';
    case 'conteste': case 'contesté': return 'contesté';
    case 'proprietaire': case 'donné par toi': case 'owner': return 'donné par toi';
    case 'a-verifier': case 'à vérifier': return 'à vérifier';
    default: return '';
  }
}

export interface Souvenir { source?: string; at?: number; niveau?: string }

/**
 * « d'après <source> (il y a 3 jours) · confirmé » pour un souvenir tiré de la mémoire. Le niveau de confiance
 * est LU, jamais recalculé. Rend une chaîne vide si on ne sait rien dire.
 */
export function fraicheurSouvenir(s: Souvenir | undefined, maintenant = Date.now()): string {
  if (!s) return '';
  const bouts: string[] = [];
  const src = (s.source ?? '').trim();
  if (src) bouts.push(`d'après ${src}`);
  if (typeof s.at === 'number' && s.at > 0) bouts.push(`(${ilYA(s.at, maintenant)})`);
  const niv = libelleConfiance(s.niveau);
  let base = bouts.join(' ');
  if (niv) base = base ? `${base} · ${niv}` : niv;
  return base;
}

/**
 * La petite ligne d'info sous une réponse : le partage du temps, puis la fraîcheur du souvenir principal si la
 * réponse vient de la mémoire. Les deux sont facultatifs.
 */
export function infoReponse(o: { decoupage?: Record<string, number>; souvenir?: Souvenir }, maintenant = Date.now()): string {
  const parts = [ligneTemps(o.decoupage), fraicheurSouvenir(o.souvenir, maintenant)].filter(Boolean);
  return parts.join(' — ');
}
