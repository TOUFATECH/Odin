// Le modèle de raisonnement de la SURFACE (le « 20 ») : savoir raisonner PAS À PAS, pas seulement rappeler
// une réponse toute faite. Coûteux, donc réservé aux questions difficiles, nouvelles ou incertaines ; une
// question simple ou un réflexe sûr répond tout de suite. Honnête : pas de faux enchaînement écrit après
// coup ; si une étape manque de preuve, on le dit ; « je ne sais pas » reste permis.
//
// Qui le porte : « Métis » (le moteur d'Odin qui fait tourner des modèles ouverts, y compris entraînés à
// raisonner) quand le propriétaire en a réglé un ; sinon le raisonnement à règles ici, complété par Noûs.
// Aucun appel payant de plus sans réglage : Métis est injecté, il n'est utilisé que s'il est fourni.
//
// Module pur : les faits sont cherchés par une fonction injectée (le Cerveau et la mémoire), jamais inventés.

import { contredit, type Etape } from './duel.ts';

/** Signaux pour décider s'il faut raisonner. */
export interface SignauxRaisonnement {
  etapesProbables: number;             // nombre d'étapes estimé
  chiffresDatesAEnchainer: boolean;    // des chiffres ou des dates à enchaîner
  propositionsSeContredisent: boolean; // les deux propositions du duel se contredisent
  confiance: number;                   // confiance de la meilleure proposition (faible => raisonner)
}

const CONF_RAISON = 0.60; // sous cette confiance, on raisonne.

/**
 * Faut-il raisonner ? Oui si plusieurs étapes sont nécessaires, si des chiffres/dates s'enchaînent, si les
 * propositions du duel se contredisent, ou si la confiance est faible. Non pour une question simple et sûre.
 */
export function fautIlRaisonner(s: SignauxRaisonnement): boolean {
  return (
    s.etapesProbables >= 2 ||
    s.chiffresDatesAEnchainer ||
    s.propositionsSeContredisent ||
    s.confiance < CONF_RAISON
  );
}

const CONNECTEURS = /\b(?:puis|ensuite|apr[eè]s|donc|alors|alors que|combien|pourquoi|comment|et ensuite)\b/gi;

/** Estime le nombre d'étapes d'une question et si elle enchaîne des chiffres/dates. Heuristique, pure. */
export function estimerEtapes(question: string): { etapes: number; chiffresDates: boolean } {
  const q = question || '';
  const sousQuestions = q.split(/[?]/).filter((x) => x.trim().length > 2).length;
  const connecteurs = (q.match(CONNECTEURS) ?? []).length;
  const nombres = (q.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
  const dates = (q.match(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g) ?? []).length;
  const chiffresDates = nombres + dates >= 2;
  const etapes = Math.max(1, sousQuestions, connecteurs + 1, chiffresDates ? 2 : 1);
  return { etapes, chiffresDates };
}

/** Découpe une question en sous-questions selon les connecteurs et la ponctuation. Pur. */
export function decouper(question: string): string[] {
  const parts = (question || '')
    .split(/[?]|\b(?:puis|ensuite|apr[eè]s|donc|alors que|et ensuite)\b/gi)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);
  return parts.length ? parts : [(question || '').trim()].filter(Boolean);
}

/** Vérifie un calcul « a + b = c », « a - b = c », « a * b = c » dans un texte. Rend vrai/faux, ou undefined si aucun. */
export function verifierCalcul(texte: string): boolean | undefined {
  const m = /(-?\d+(?:[.,]\d+)?)\s*([+\-*x×])\s*(-?\d+(?:[.,]\d+)?)\s*=\s*(-?\d+(?:[.,]\d+)?)/.exec(texte || '');
  if (!m) return undefined;
  const a = num(m[1]), b = num(m[3]), c = num(m[4]);
  const r = m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b;
  return Math.abs(r - c) < 1e-9;
}

function num(s: string): number { return parseFloat(s.replace(',', '.')); }

/** Ce qu'il faut pour raisonner : chercher des faits (Cerveau/mémoire) et, si réglé, appeler Métis. */
export interface RaisonnementDeps {
  /** Rend les faits trouvés pour un sujet, tels quels (jamais inventés). Vide si rien n'appuie. */
  faits: (sujet: string) => string[];
  /** Ce que le propriétaire a donné et ce qui est confirmé, pour vérifier qu'aucune étape ne les contredit. */
  confirmes?: string[];
  /** Métis : un modèle ouvert qui raisonne, s'il est réglé. Sinon on reste sur les règles. */
  metis?: (question: string) => Promise<Etape[]>;
}

/** Le résultat : les étapes gardées à part, une conclusion, et si l'on est sûr (toutes les étapes prouvées). */
export interface Raisonnement { etapes: Etape[]; conclusion: string; sur: boolean }

/**
 * Raisonne pas à pas. Pour chaque sous-question : cherche les faits, vérifie (pas de contradiction avec ce qui
 * est confirmé, calcul juste si présent) et marque l'étape prouvée ou non. Si Métis est réglé, on part de ses
 * étapes et on les vérifie de la même façon. Honnête : une étape sans preuve est marquée telle quelle.
 */
export async function raisonner(question: string, deps: RaisonnementDeps): Promise<Raisonnement> {
  const confirmes = deps.confirmes ?? [];
  let brutes: Etape[];
  if (deps.metis) {
    try { brutes = await deps.metis(question); } catch { brutes = regles(question, deps); }
  } else {
    brutes = regles(question, deps);
  }
  const etapes = brutes.map((e) => {
    const calcul = verifierCalcul(e.texte);
    const prouve = e.faits.length > 0 && !contredit(e.texte, confirmes) && calcul !== false;
    return { texte: e.texte, faits: e.faits, prouve };
  });
  const sur = etapes.length > 0 && etapes.every((e) => e.prouve);
  const conclusion = sur
    ? (etapes[etapes.length - 1]?.texte ?? '')
    : 'Je ne suis pas sûr : une étape manque de preuve.';
  return { etapes, conclusion, sur };
}

/** Raisonnement à règles : une étape par sous-question, appuyée sur les faits trouvés. */
function regles(question: string, deps: RaisonnementDeps): Etape[] {
  return decouper(question).map((sq) => {
    const faits = deps.faits(sq) ?? [];
    return { texte: faits.length ? `${sq} → ${faits[0]}` : sq, faits, prouve: false };
  });
}
