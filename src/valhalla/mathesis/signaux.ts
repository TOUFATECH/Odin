// Mathésis — la boîte aux manques : les autres parties d'Odin y déposent ce qu'il ne sait pas ou sait mal (une
// recherche vérifiée restée sans réponse sûre, un fait à une seule source, plus tard un duel perdu par Noûs), et
// Mathésis la vide dans sa liste de curiosité à chaque passage. Déposer ne fait RIEN d'autre : pas d'entrée/sortie,
// jamais bloquant, jamais une exception, rien en mode privé ; si Mathésis est coupée, la boîte reste bornée et ignorée.
import type { Signalement } from './curiosite.ts';

const MAX = 200;
const boite: Signalement[] = [];
/** Mathésis est-elle allumée ? Posé par le moteur (au démarrage et à chaque réglage). Faux tant qu'aucun moteur ne l'a dit. */
let allumee = false;
/** Le moteur dit si Mathésis est allumée ; coupée, la boîte est vidée et ne garde plus rien. */
export function poserEtatMathesis(actif: boolean): void { allumee = actif === true; if (!allumee) boite.length = 0; }

/** Dépose un manque (ignoré en mode privé, vide, ou si la boîte est pleine). Ne lève jamais. */
export function signalerManque(s: Signalement, o: { prive?: boolean } = {}): void {
  try {
    if (!allumee || o.prive || !s || !String(s.sujet ?? '').trim()) return; // coupée : rien n'est gardé
    if (s.origine === 'confie') return; // seule la page du propriétaire confie
    if (boite.length >= MAX) boite.shift();
    boite.push({ ...s, sujet: String(s.sujet).replace(/\s+/g, ' ').trim().slice(0, 300) });
  } catch { /* jamais bloquant */ }
}

/** Ce que la recherche vérifiée n'a pas pu établir devient un manque : pas de réponse sûre, ou une seule source. */
export function signalerVerdicts(question: string, claims: Array<{ claim: string; verdict: string }>, o: { prive?: boolean } = {}): void {
  try {
    if (!allumee || o.prive) return;
    const sures = claims.filter((c) => c.verdict === 'confirmé').length;
    if (!claims.length || !sures) signalerManque({ sujet: question, origine: 'question_sans_reponse' }, o);
    for (const c of claims.slice(0, 5)) if (c.verdict === 'probable') signalerManque({ sujet: c.claim, origine: 'a_verifier' }, o);
  } catch { /* jamais bloquant */ }
}

/** Vide la boîte (Mathésis). */
export function viderManques(): Signalement[] { return boite.splice(0, boite.length); }
/** (essais) combien de manques attendent. */
export const manquesEnAttente = (): number => boite.length;
