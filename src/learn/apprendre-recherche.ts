// Ce qu'Odin cherche POUR le propriétaire est appris aussi (étape 6 du plan de branchement, première moitié) : après une
// recherche vérifiée (src/research/research.ts), chaque affirmation qui a des preuves passe par l'ENTRÉE COMMUNE
// d'apprentissage (apprendre-de-tout.ts) : un souvenir avec son niveau (« confirmé », « à vérifier », « contesté »), sa
// source (les sites des preuves) et sa date, sans doublon (l'empreinte), et Noûs est nourri selon ce niveau.
// Une affirmation sans aucune preuve (« insuffisant ») n'est PAS rangée : ce n'est qu'une hypothèse du plan de recherche.
// Une affirmation « contredite » non plus : les sources la démentent, ce n'est pas un fait (ni souvenir, ni pour Noûs).
// Ne lève jamais ; rien en mode privé (apprendreDeTout le vérifie aussi). L'appelant (tools/research.ts) n'appelle ceci
// que pour une recherche demandée par le propriétaire dans une conversation non marquée.
import { apprendreDeTout, type DepsApprentissage, type MemoireApprentissage, type ResultatApprentissage } from './apprendre-de-tout.ts';
import type { FileApprentissage, NoosDeps } from '../brain/nous/deps.ts';
import { depsNousOdin, fileNousOdin, type OdinPourNous } from '../brain/nous/file-odin.ts';
import type { VerdictBrut } from './confiance.ts';

/** Ce que la recherche vérifiée rend (la partie utile ici). */
export interface RechercheVerifiee {
  question: string;
  claims: Array<{ claim: string; verdict: VerdictBrut['verdict']; independent: number; evidence: Array<{ source: number; stance: string }> }>;
  sources: Array<{ n: number; site: string }>;
}

/** Les affirmations à apprendre : une par affirmation prouvée, avec la source faite de ses sites (triés, 3 au plus). */
export function apportsDeRecherche(r: RechercheVerifiee, maintenant: number): Array<{ source: string; texte: string; sujet: string; verdict: VerdictBrut }> {
  const sujet = String(r.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const out: Array<{ source: string; texte: string; sujet: string; verdict: VerdictBrut }> = [];
  for (const c of r.claims ?? []) {
    if (!c || c.verdict === 'insuffisant' || c.verdict === 'contredit' || !c.evidence?.length) continue;
    const sites = [...new Set(c.evidence.map((e) => r.sources.find((s) => s.n === e.source)?.site).filter((x): x is string => Boolean(x)))].sort().slice(0, 3);
    if (!sites.length) continue;
    out.push({ source: `web:${sites.join('+')}`, texte: String(c.claim).slice(0, 600), sujet, verdict: { verdict: c.verdict, independent: c.independent } });
  }
  void maintenant;
  return out;
}

/**
 * La file d'apprentissage de Noûs remplie par la recherche vérifiée : c'est LA file unique d'Odin (celle de Mathésis, de
 * Prónoia et d'Archytas), que la passerelle vide vers le corpus. Une file à part ne serait lue par personne.
 */
export const fileNousRecherche: FileApprentissage = fileNousOdin;

/**
 * Les dépendances de l'entrée commune pour la recherche de l'outil : la mémoire d'Odin, et Noûs par la file unique avec
 * la VRAIE garde d'Odin (coupé, privé, démonstration : depsNousOdin). Sans la configuration d'Odin, Noûs reste coupé.
 */
export function depsRecherche(memoire: MemoireApprentissage & { privateMode?: boolean }, odin?: OdinPourNous): DepsApprentissage {
  const base = depsNousOdin(odin ?? { cfg: { nous: { actif: false } }, paths: { home: '' } });
  const nous: NoosDeps = { ...base, privateMode: () => memoire.privateMode === true || base.privateMode() };
  return { memoire, nous };
}

/** Qui a demandé la recherche, et dans quelle conversation (pris AVANT la recherche, qui marque la conversation). */
export interface DemandeRecherche {
  /** Le propriétaire (accès complet), pas un invité d'une messagerie. */
  proprietaire: boolean;
  /** La conversation avait déjà lu un contenu extérieur (une page peut y avoir glissé « cherche… »). */
  marquee: boolean;
  prive: boolean;
}

/**
 * Apprendre d'une recherche vérifiée seulement si le PROPRIÉTAIRE l'a demandée, dans une conversation NON marquée, hors
 * mode privé. Sinon rien n'est rangé : un invité, ou une page lue qui dit « cherche… », ne fait rien entrer dans la
 * mémoire du propriétaire. Pur.
 */
export const peutApprendreDeLaRecherche = (d: DemandeRecherche): boolean => d.proprietaire === true && d.marquee !== true && d.prive !== true;

/** Range les affirmations prouvées d'une recherche vérifiée par l'entrée commune. Ne lève jamais. */
export function apprendreDeLaRecherche(deps: DepsApprentissage, r: RechercheVerifiee, o: { prive?: boolean; maintenant?: number } = {}): ResultatApprentissage[] {
  try {
    if (o.prive) return [];
    const now = o.maintenant ?? deps.maintenant?.() ?? Date.now();
    return apportsDeRecherche(r, now).map((a) => apprendreDeTout(deps, { sorte: 'lecture', source: a.source, date: now, maintenant: now, faits: [{ texte: a.texte, sujet: a.sujet, verdict: a.verdict }] }));
  } catch { return []; }
}
