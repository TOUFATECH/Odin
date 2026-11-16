// Le duel : à chaque réponse, deux propositions sont préparées en même temps — celle d'ODIN (le Cerveau
// de surface : réflexe, mémoire, Cerveau, grand modèle) et celle de NOÛS (le réseau profond). Un arbitre
// choisit « la plus logique » par des critères écrits et mesurables (a → e), dans l'ordre. Il regarde le
// RAISONNEMENT derrière chaque proposition, pas seulement la réponse finale : une réponse sans appui ne
// gagne jamais contre une réponse bien étayée.
//
// Deux garanties tenues et vérifiées par des essais :
//  - l'arbitre NE REÇOIT JAMAIS les compteurs 80-20 (sa signature ne les mentionne pas) : le chiffre ne
//    peut donc pas forcer le choix ;
//  - l'arbitre ne tire JAMAIS au sort ; en cas de doute, la proposition d'Odin passe (« cerveau »).
//
// Module pur : aucune lecture ni écriture, aucun hasard. Le juge (src/mimir/) est injecté par le contexte.

/** D'où vient une proposition. 'noos' et non 'nous' pour ne pas se confondre avec le fournisseur NousResearch. */
export type Origine2 = 'cerveau' | 'noos';

/** Un pas de raisonnement : son texte, les faits sur lesquels il s'appuie, et s'il est prouvé. */
export interface Etape { texte: string; faits: string[]; prouve: boolean }

/** Une proposition en lice : son origine, son texte, sa confiance (0–1), ses faits d'appui, son raisonnement. */
export interface Candidat { origine: Origine2; texte: string; confiance: number; faits: string[]; raisonnement?: Etape[] }

/**
 * Ce que l'arbitre a le droit de regarder : ce que le propriétaire a donné, ce qui est confirmé en
 * mémoire, et un juge (Mímir, ou un grand modèle si réglé) qui note une proposition de 0 à 1.
 * AUCUN compteur 80-20 ici : un essai vérifie que cette interface ne les contient pas.
 */
export interface ContexteArbitre {
  donneProprietaire: string[];
  faitsConfirmes: string[];
  juge: (c: Candidat, ctx: ContexteArbitre) => Promise<number>;
}

/** Le résultat : qui gagne et par quel critère. 'doute' => Odin passe ; jamais de tirage au sort. */
export interface Verdict { gagnant: Origine2; critere: 'a' | 'b' | 'c' | 'd' | 'e' | 'doute' }

// Écart de juge sous lequel on considère les deux propositions à égalité (doute).
const EPS_JUGE = 0.05;
// Écart de longueur (en fraction) au-dessous duquel les deux se valent sur la clarté.
const EPS_LONG = 0.15;

const plie = (t: string) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Nombres et dates d'un texte (jj/mm/aaaa, aaaa, nombres). Pour repérer dates et chiffres qui se contredisent. */
export function chiffres(texte: string): string[] {
  const t = texte || '';
  const dates = t.match(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g) ?? [];
  const nums = (t.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).filter((n) => !dates.some((d) => d.includes(n)));
  return [...dates, ...nums];
}

/** Paires « clé: valeur » / « clé = valeur » d'une liste de faits (clé repliée → valeur repliée). */
export function clesValeurs(faits: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of faits) {
    const mm = /^\s*([^:=]{2,40}?)\s*[:=]\s*(.+?)\s*$/.exec(f || '');
    if (mm) m.set(plie(mm[1]), plie(mm[2]));
  }
  return m;
}

/**
 * Le texte contredit-il un fait donné ou confirmé ? Conservateur : on ne signale qu'un conflit net —
 * une même clé avec une autre valeur. Sans conflit détecté, on ne bloque pas (on n'invente pas de contradiction).
 */
export function contredit(texte: string, faits: string[]): boolean {
  const t = plie(texte);
  for (const [k, v] of clesValeurs(faits)) {
    if (!k || !v) continue;
    const i = t.indexOf(k);
    if (i < 0) continue;
    // La clé est citée dans le texte : la valeur confirmée doit s'y retrouver à proximité, sinon conflit
    // seulement si le texte affirme une AUTRE valeur numérique pour cette clé.
    const apres = t.slice(i + k.length, i + k.length + 60);
    if (apres.includes(v)) continue;
    const valNum = v.match(/\d+(?:[.,]\d+)?/)?.[0];
    const autreNum = apres.match(/\d+(?:[.,]\d+)?/)?.[0];
    if (valNum && autreNum && valNum !== autreNum) return true;
  }
  return false;
}

/** Un pas de raisonnement contredit-il les faits, ou reste-t-il non prouvé en affirmant quelque chose ? */
function raisonnementContredit(c: Candidat, faits: string[]): boolean {
  for (const e of c.raisonnement ?? []) if (contredit(e.texte, faits)) return true;
  return false;
}

/** La proposition répond-elle vraiment (texte non vide et pas une simple esquive) ? */
export function repond(texte: string): boolean {
  const t = plie(texte).trim();
  return t.length > 0;
}

/** La proposition avoue-t-elle ne pas savoir (honnête quand rien ne l'appuie) ? */
export function avoue(texte: string): boolean {
  return /\bje ne sais pas\b|\bj'?ignore\b|\bpas s[uû]r\b|\baucune information\b/.test(plie(texte));
}

/** Appui (critère c) : 2 = bien étayée (faits ou raisonnement tout prouvé) ; 1 = aveu honnête ;
 *  0 = affirmation sans appui (jamais récompensée). */
export function appui(c: Candidat): 0 | 1 | 2 {
  const steps = c.raisonnement ?? [];
  const etayee = c.faits.length > 0 || (steps.length > 0 && steps.every((s) => s.prouve && s.faits.length > 0));
  if (etayee) return 2;
  if (avoue(c.texte)) return 1;
  return 0;
}

/** Cohérence interne (critère d) : pas deux dates/chiffres incompatibles pour un même repère, raisonnement enchaîné. */
export function coherente(c: Candidat): boolean {
  const steps = c.raisonnement ?? [];
  // Un pas non prouvé qui affirme (a des faits annoncés mais prouve=false) casse l'enchaînement.
  for (const e of steps) if (!e.prouve && e.faits.length > 0) return false;
  return true;
}

/** Longueur « utile » : plus court, mieux (à qualité égale). Mots du texte. */
function longueur(c: Candidat): number {
  return plie(c.texte).split(/\s+/).filter(Boolean).length;
}

/**
 * Arbitre le duel. Critères a → e dans l'ordre ; le premier qui sépare tranche. Le juge (Mímir) ne sert
 * qu'en dernier, pour départager une égalité de clarté. Jamais de hasard ; en cas de doute, Odin passe.
 */
export async function arbitrer(odin: Candidat, noos: Candidat, ctx: ContexteArbitre): Promise<Verdict> {
  const confirmes = [...(ctx.donneProprietaire ?? []), ...(ctx.faitsConfirmes ?? [])];

  // (a) ne pas contredire le propriétaire ni ce qui est confirmé.
  const aO = !contredit(odin.texte, confirmes) && !raisonnementContredit(odin, confirmes);
  const aN = !contredit(noos.texte, confirmes) && !raisonnementContredit(noos, confirmes);
  if (aO !== aN) return { gagnant: aO ? 'cerveau' : 'noos', critere: 'a' };
  if (!aO && !aN) return { gagnant: 'cerveau', critere: 'doute' };

  // (b) répondre à la question posée.
  const bO = repond(odin.texte), bN = repond(noos.texte);
  if (bO !== bN) return { gagnant: bO ? 'cerveau' : 'noos', critere: 'b' };
  if (!bO && !bN) return { gagnant: 'cerveau', critere: 'doute' };

  // (c) s'appuyer sur des faits (sinon avouer). L'affirmation sans appui ne gagne jamais.
  const cO = appui(odin), cN = appui(noos);
  if (cO !== cN) return { gagnant: cO > cN ? 'cerveau' : 'noos', critere: 'c' };

  // (d) cohérence interne (dates, chiffres, enchaînement du raisonnement).
  const dO = coherente(odin), dN = coherente(noos);
  if (dO !== dN) return { gagnant: dO ? 'cerveau' : 'noos', critere: 'd' };

  // (e) à égalité, la plus courte et la plus claire ; puis le juge ; puis doute → Odin.
  const lO = longueur(odin), lN = longueur(noos), max = Math.max(lO, lN, 1);
  if (Math.abs(lO - lN) / max > EPS_LONG) return { gagnant: lO < lN ? 'cerveau' : 'noos', critere: 'e' };

  const jO = clamp01(await ctx.juge(odin, ctx)), jN = clamp01(await ctx.juge(noos, ctx));
  if (Math.abs(jO - jN) > EPS_JUGE) return { gagnant: jO > jN ? 'cerveau' : 'noos', critere: 'e' };

  return { gagnant: 'cerveau', critere: 'doute' };
}

function clamp01(x: number): number { return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

/** La paire de préférence tirée d'un duel, prête pour l'alignement de Noûs (la gagnante doit devenir plus
 *  probable que la perdante). `parMerite` est faux quand Odin ne l'emporte que par défaut (doute). */
export interface Preference { gagnante: Candidat; perdante: Candidat; origineGagnante: Origine2; parMerite: boolean }

/** Construit la préférence à partir du verdict. Sert d'exemple d'alignement ; si Noûs a perdu par mérite,
 *  la gagnante devient aussi un exemple d'ajustement (à l'appelant de le faire). */
export function preferenceDuDuel(odin: Candidat, noos: Candidat, v: Verdict): Preference {
  const gagnante = v.gagnant === 'cerveau' ? odin : noos;
  const perdante = v.gagnant === 'cerveau' ? noos : odin;
  return { gagnante, perdante, origineGagnante: v.gagnant, parMerite: v.critere !== 'doute' };
}
