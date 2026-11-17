// Prónoia — le bilan « prévu contre arrivé ». Le taux de réussite est le VRAI : réalisées ÷ (réalisées + ratées), sur
// les prévisions jugées seulement ; les périmées (qu'on ne pouvait pas vérifier) sont comptées à part et n'entrent pas
// dans le taux (ni pour l'embellir, ni pour l'abaisser) ; celles en attente non plus. Aucun arrondi vers le haut.
// La calibration compare, par tranche de confiance, la confiance ANNONCÉE à la fréquence OBSERVÉE : une prévision dite
// à 80 % doit se réaliser environ 8 fois sur 10 ; l'écart est affiché tel quel.
import type { Prevision, Sorte } from './types.ts';
import type { MesuresPreparation } from './magasin.ts';

export interface Tranche {
  /** bornes [de, a[ de la confiance annoncée */
  de: number; a: number;
  jugees: number; realisees: number;
  /** confiance moyenne annoncée dans la tranche */
  annoncee: number;
  /** fréquence observée (undefined si aucune jugée) */
  observee?: number;
  /** observée − annoncée (négatif = trop sûr de lui) */
  ecart?: number;
}

export interface Bilan {
  total: number; enAttente: number; realisees: number; ratees: number; perimees: number;
  /** réalisées ÷ jugées ; undefined s'il n'y a rien de jugé (on n'invente pas un taux) */
  taux?: number;
  parSorte: Record<Sorte, { realisees: number; ratees: number; taux?: number }>;
  tranches: Tranche[];
  /** écart absolu moyen prévu/arrivé (minutes) sur les événements réalisés */
  ecartMoyenMin?: number;
  preparation: MesuresPreparation;
  /** le texte honnête à afficher */
  texte: string;
}

const taux = (r: number, j: number): number | undefined => (j > 0 ? r / j : undefined);
const pc = (x: number) => `${Math.floor(x * 1000) / 10} %`;

/** Le bilan d'une liste de prévisions (pur). `largeur` = taille d'une tranche de confiance (0.1 par défaut). */
export function bilan(previsions: Prevision[], preparation: MesuresPreparation, largeur = 0.1): Bilan {
  const realisees = previsions.filter((p) => p.etat === 'realisee').length;
  const ratees = previsions.filter((p) => p.etat === 'ratee').length;
  const perimees = previsions.filter((p) => p.etat === 'perimee').length;
  const enAttente = previsions.filter((p) => p.etat === 'en_attente').length;
  const parSorte = {} as Bilan['parSorte'];
  for (const s of ['demande', 'suite', 'evenement'] as Sorte[]) {
    const l = previsions.filter((p) => p.sorte === s);
    const r = l.filter((p) => p.etat === 'realisee').length, ra = l.filter((p) => p.etat === 'ratee').length;
    parSorte[s] = { realisees: r, ratees: ra, taux: taux(r, r + ra) };
  }
  const n = Math.max(1, Math.round(1 / largeur));
  const tranches: Tranche[] = [];
  for (let i = 0; i < n; i++) {
    const de = i / n, a = (i + 1) / n;
    const l = previsions.filter((p) => (p.etat === 'realisee' || p.etat === 'ratee') && p.confiance >= de && (i === n - 1 ? p.confiance <= a : p.confiance < a));
    if (!l.length) continue;
    const r = l.filter((p) => p.etat === 'realisee').length;
    const annoncee = l.reduce((s, p) => s + p.confiance, 0) / l.length;
    const observee = r / l.length;
    tranches.push({ de, a, jugees: l.length, realisees: r, annoncee, observee, ecart: observee - annoncee });
  }
  const ecarts = previsions.filter((p) => p.etat === 'realisee' && typeof p.ecartMin === 'number').map((p) => Math.abs(p.ecartMin!));
  const t = taux(realisees, realisees + ratees);
  const lignes = [
    t === undefined ? 'Aucune prévision encore jugée : pas de taux de réussite à montrer.' : `Taux de réussite mesuré : ${pc(t)} (${realisees} réalisée(s) sur ${realisees + ratees} jugée(s)).`,
    perimees ? `${perimees} prévision(s) périmée(s) sans pouvoir être vérifiée(s) — hors du taux.` : '',
    enAttente ? `${enAttente} en attente.` : '',
    ...tranches.map((x) => `Dites à ${Math.floor(x.annoncee * 100)} % en moyenne : réalisées ${x.realisees} fois sur ${x.jugees} (${pc(x.observee!)}).`),
    preparation.servies + preparation.manquees ? `Réponses préparées d'avance servies : ${preparation.servies} sur ${preparation.servies + preparation.manquees} demandes ; temps de préparation évité (estimation) : ${Math.round(preparation.gagneMs)} ms au total.` : '',
  ].filter(Boolean);
  return {
    total: previsions.length, enAttente, realisees, ratees, perimees, taux: t, parSorte, tranches,
    ecartMoyenMin: ecarts.length ? ecarts.reduce((s, x) => s + x, 0) / ecarts.length : undefined,
    preparation: { ...preparation }, texte: lignes.join('\n'),
  };
}
