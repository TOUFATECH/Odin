// Mathésis — la liste de curiosité : « ce qu'Odin ne sait pas ou sait mal », avec une priorité et la raison.
//  - un manque signalé deux fois est FUSIONNÉ (même sujet replié) et sa priorité monte ;
//  - ce que le propriétaire CONFIE passe en tête, avant tout le reste — sans lever aucune limite (budgets,
//    interdits, lecture seule : le moteur les applique de la même façon) ;
//  - un sujet interdit n'entre pas ; la liste est bornée (les moins prioritaires non confiés tombent en premier).
import type { Magasin } from './magasin.ts';
import type { EtatManque, GenreManque, Interdits, Manque, OrigineManque } from './types.ts';
import { GENRES_TRAITES } from './types.ts';
import { siteInterdit, sujetInterdit } from './interdits.ts';
import { nouvelId, plier } from './outils.ts';
import { controlerForme } from './adresses.ts';

/** Priorité de départ selon l'origine (0–100). */
export const PRIORITE: Record<OrigineManque, number> = {
  confie: 100, question_sans_reponse: 70, duel_perdu: 60, a_verifier: 50, perime: 40, sujet_recurrent: 30, nouveaute_appli: 20,
};
const RAISON: Record<OrigineManque, string> = {
  confie: 'confié par toi', question_sans_reponse: 'une question est restée sans réponse sûre', duel_perdu: 'Noûs a perdu un duel sur ce sujet',
  a_verifier: 'un fait n\'a qu\'une source : à confirmer', perime: 'un fait est périmé : à rafraîchir', sujet_recurrent: 'un sujet qui revient souvent chez toi',
  nouveaute_appli: 'une nouveauté d\'une de tes applis',
};
export const TAILLE_MAX = 500;
export const ESSAIS_MAX = 5;
/** Délai avant de réessayer un manque déjà traité (ms) : un jour après un succès, six heures après un échec. */
export const REESSAI = { fait: 7 * 86_400_000, echec: 6 * 3_600_000, attente: 3_600_000 } as const;

export interface Signalement {
  sujet: string;
  origine: OrigineManque;
  genre?: GenreManque;
  raison?: string;
  adresses?: string[];
  memoire?: { sujet?: string; cle?: string };
}

/** Les adresses d'un texte confié : celles qui passent le contrôle de forme du robot, et celles refusées (avec la raison). */
export function trierAdresses(t: string): { urls: string[]; acceptees: string[]; refusees: Array<{ url: string; raison: string }> } {
  const urls = String(t ?? '').split(/[\s,]+/).filter((x) => /^https?:\/\//i.test(x));
  const acceptees: string[] = [], refusees: Array<{ url: string; raison: string }> = [];
  for (const u of urls) { const c = controlerForme(u); if (c.ok) acceptees.push(c.url.toString()); else refusees.push({ url: u, raison: c.raison }); }
  return { urls, acceptees, refusees };
}

const cleDe = (genre: GenreManque, sujet: string): string => `${genre}:${plier(sujet).replace(/[^a-z0-9:/._-]+/g, ' ').trim()}`;

/** Trie : confiés d'abord, puis priorité, puis le plus ancien. */
export function ordre(a: Manque, b: Manque): number {
  if (a.confie !== b.confie) return a.confie ? -1 : 1;
  if (a.priorite !== b.priorite) return b.priorite - a.priorite;
  return a.ajoute - b.ajoute;
}

export class Curiosite {
  private readonly magasin: Magasin;
  private readonly maintenant: () => number;
  private readonly interdits: () => Interdits;
  constructor(magasin: Magasin, maintenant: () => number, interdits: () => Interdits) {
    this.magasin = magasin; this.maintenant = maintenant; this.interdits = interdits;
  }
  liste(): Manque[] { return [...this.magasin.lire<Manque[]>('curiosite', [])].sort(ordre); }
  private ranger(l: Manque[]): void {
    l.sort(ordre);
    // Bornée : on garde tous les confiés (jusqu'à la taille), puis les plus prioritaires.
    this.magasin.ecrire('curiosite', l.slice(0, TAILLE_MAX));
  }

  /**
   * Signale un manque. Rend le manque (nouveau ou fusionné), ou undefined s'il est refusé (vide, interdit).
   * Un texte venu d'une page ne passe JAMAIS par ici avec l'origine « confie » : seule la page du propriétaire le fait.
   */
  signaler(s: Signalement): Manque | undefined {
    const genre: GenreManque = s.genre ?? 'sujet';
    const sujet = String(s.sujet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!sujet) return undefined;
    const i = this.interdits();
    if (sujetInterdit(i, sujet)) return undefined;
    const adresses = (s.adresses ?? []).filter((u) => !siteInterdit(i, u)).slice(0, 20);
    if (genre === 'page' && !adresses.length) return undefined;
    const now = this.maintenant();
    const l = this.magasin.lire<Manque[]>('curiosite', []).map((m) => ({ ...m }));
    const cle = cleDe(genre, sujet);
    const confie = s.origine === 'confie';
    const ex = l.find((m) => m.cle === cle);
    if (ex) {
      ex.vu += 1;
      ex.priorite = Math.min(100, Math.max(ex.priorite, PRIORITE[s.origine]) + 5);
      if (confie && !ex.confie) { ex.confie = true; ex.origine = 'confie'; ex.raison = RAISON.confie; }
      if (adresses.length) ex.adresses = [...new Set([...(ex.adresses ?? []), ...adresses])].slice(0, 20);
      if (s.memoire) ex.memoire = s.memoire;
      // Un manque fait ou en échec redevient d'actualité quand il est signalé à nouveau (après son délai de réessai).
      if (ex.etat === 'fait' || ex.etat === 'echec') ex.etat = 'en_attente';
      if (confie) ex.prochainEssai = undefined;
      this.ranger(l);
      return ex;
    }
    const m: Manque = {
      id: nouvelId(), sujet, cle, genre, origine: s.origine, priorite: PRIORITE[s.origine], raison: String(s.raison ?? '').trim().slice(0, 300) || RAISON[s.origine],
      confie, ajoute: now, vu: 1, essais: 0, etat: GENRES_TRAITES.includes(genre) ? 'en_attente' : 'pas_encore_traite',
      ...(adresses.length ? { adresses } : {}), ...(s.memoire ? { memoire: s.memoire } : {}),
    };
    l.push(m);
    this.ranger(l);
    return m;
  }

  /** Le propriétaire confie un sujet ou des adresses publiques : en tête de liste. */
  confier(sujetOuAdresses: string, genre?: GenreManque): Manque | undefined {
    const t = String(sujetOuAdresses ?? '').trim();
    const { urls, acceptees } = trierAdresses(t);
    if (urls.length && (genre === undefined || genre === 'page')) {
      // Chaque adresse passe le même contrôle de forme que le robot ; si aucune n'est publique, rien n'est confié.
      if (!acceptees.length) return undefined;
      return this.signaler({ sujet: acceptees[0], origine: 'confie', genre: 'page', adresses: acceptees });
    }
    return this.signaler({ sujet: t, origine: 'confie', genre: genre ?? 'sujet' });
  }

  /** Les prochains manques à traiter maintenant (genres traités à ce passage, pas interdits, délai de réessai passé). */
  prochains(n: number): Manque[] {
    const now = this.maintenant();
    const i = this.interdits();
    // Un manque en échec est réessayé après son délai, cinq fois au plus (ensuite il attend d'être signalé à nouveau).
    return this.liste().filter((m) => (m.etat === 'en_attente' || (m.etat === 'echec' && m.essais < ESSAIS_MAX)) && GENRES_TRAITES.includes(m.genre) && (m.prochainEssai ?? 0) <= now && !sujetInterdit(i, m.sujet)).slice(0, Math.max(0, n));
  }

  /** Note le résultat d'un essai. */
  noter(id: string, etat: EtatManque, bilan: string): void {
    const now = this.maintenant();
    const l = this.magasin.lire<Manque[]>('curiosite', []).map((m) => ({ ...m }));
    const m = l.find((x) => x.id === id);
    if (!m) return;
    m.essais += 1; m.dernierEssai = now; m.bilan = bilan.slice(0, 300);
    m.etat = etat;
    m.prochainEssai = now + (etat === 'fait' ? REESSAI.fait : etat === 'echec' ? REESSAI.echec : REESSAI.attente);
    // Un manque confié qui a été traité redescend au rang ordinaire (il a eu sa priorité).
    if (etat === 'fait' && m.confie) { m.confie = false; m.priorite = PRIORITE.question_sans_reponse; }
    this.ranger(l);
  }

  retirer(id: string): boolean {
    const l = this.magasin.lire<Manque[]>('curiosite', []);
    const r = l.filter((m) => m.id !== id);
    if (r.length === l.length) return false;
    this.ranger(r);
    return true;
  }
}
