// Banc d'actions : les STATISTIQUES (fonctions pures, sans rien lire ni écrire). Prouvées par test/stats-actions.test.ts.
//
// Ce qu'on calcule, et pourquoi :
//   - Wilson : l'intervalle à 95 % d'une proportion (une barre de compétence, un taux de réussite) ;
//   - rééchantillonnage hiérarchique : l'intervalle de l'écart B − A. On retire au hasard les graines, puis les épisodes,
//     compétence par compétence, des milliers de fois. Les graines comptent : deux entraînements lancés une fois chacun
//     ne disent pas lequel est meilleur ;
//   - McNemar exact : sur les mêmes épisodes, graine par graine, B réussit-il plus souvent là où A rate que l'inverse ? ;
//   - Holm : six compétences, six comparaisons ; sans correction, l'une « gagnerait » par chance ;
//   - note géométrique : une seule note pour les six compétences, qui compte davantage une compétence difficile enfin
//     réussie ;
//   - plus petit écart détectable : en dessous, on dit « on ne peut pas conclure », jamais « B n'aide pas » ;
//   - le contrôle par graines (Welch) : le même écart, jugé sur les seuls taux de chaque graine, avec la loi de Student.
//     Le rééchantillonnage a deux défauts connus, mesurés par simulation : il est trop large quand les graines se
//     ressemblent (le bruit de chaque graine y est compté deux fois), et trop étroit quand il y a peu de graines et
//     qu'elles s'écartent beaucoup (3 graines : il exclut 0 à tort 13 fois sur 100 au lieu de 5). Le contrôle par
//     graines garde ce second cas : la décision demande les deux ;
//   - la règle de décision : « B fait mieux » seulement si la borne basse est au-dessus de 0 — pour le rééchantillonnage
//     (borne reculée de deux erreurs de tirage) ET pour le contrôle par graines — ET si B n'a aucune faute de sûreté.
//     Une faute de sûreté n'est jamais compensée par des réussites, ni pour B ni pour A.
//
// Le hasard est à graine : les mêmes données et la même graine donnent les mêmes bornes, au chiffre près.
// Une matrice de résultats est rangée [graine][épisode], avec 1 pour réussi et 0 pour raté ; les épisodes sont dans le
// même ordre pour toutes les graines et pour les deux entraînements (l'ordre fixe du banc).
import { wilson, Z95, type Proportion } from '../mesure.ts';

export { wilson, Z95 };
export type { Proportion };
export type Vecteur = ArrayLike<number>;

// ------------------------------------------------------------------------------------------------ hasard à graine
/** Générateur de hasard à graine (nombres de 0 inclus à 1 exclu) : même graine, mêmes tirages. */
export function hasard(graine: number): () => number {
  if (!Number.isSafeInteger(graine) || graine < 0) throw new Error(`graine du hasard : un nombre entier positif est attendu (${graine})`);
  // Quatre mots d'état tirés de la graine (mélange de type « splitmix »), puis le générateur « sfc32 ».
  // Les bits au-dessus du 32e comptent aussi : deux graines différentes ne donnent pas la même suite.
  let s = ((graine >>> 0) ^ 0x9e3779b9 ^ Math.imul(Math.floor(graine / 4294967296) >>> 0, 0x85ebca6b)) | 0;
  const mot = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad); z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) | 0;
  };
  let a = mot(), b = mot(), c = mot(), d = 1;
  const suivant = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11));
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) suivant();
  return suivant;
}
const GRAINE = 20261120;

// ------------------------------------------------------------------------------------------------ loi normale
/** Le quantile de la loi normale (l'inverse de sa fonction de répartition), pour 0 < p < 1. */
export function quantileNormale(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`quantile demandé hors de ]0 ; 1[ : ${p}`);
  // Approximation rationnelle par morceaux (erreur relative d'environ 1e-9 : bien assez pour un intervalle).
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const bas = 0.02425;
  const queue = (q: number): number => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < bas) return queue(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - bas) return -queue(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ------------------------------------------------------------------------------------------------ loi de Student
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const y = z - 1, t = y + 7.5;
  let x = LANCZOS[0];
  for (let i = 1; i < 9; i++) x += LANCZOS[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(x);
}
/** La fraction continue de la fonction bêta incomplète (méthode de Lentz). */
function fractionBeta(a: number, b: number, x: number): number {
  const PETIT = 1e-300, garde = (v: number): number => (Math.abs(v) < PETIT ? PETIT : v);
  let c = 1, d = 1 / garde(1 - (a + b) * x / (a + 1)), h = d;
  for (let m = 1; m <= 400; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
    d = 1 / garde(1 + aa * d); c = garde(1 + aa / c); h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
    d = 1 / garde(1 + aa * d); c = garde(1 + aa / c);
    const facteur = d * c;
    h *= facteur;
    if (Math.abs(facteur - 1) < 3e-15) break;
  }
  return h;
}
/** La fonction bêta incomplète régularisée I_x(a, b). */
function betaIncomplete(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const devant = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? devant * fractionBeta(a, b, x) / a : 1 - devant * fractionBeta(b, a, 1 - x) / b;
}
/** La fonction de répartition de la loi de Student à `ddl` degrés de liberté (qui peuvent ne pas être entiers). */
export function repartitionStudent(t: number, ddl: number): number {
  if (!(ddl > 0)) throw new Error(`loi de Student : degrés de liberté impossibles (${ddl})`);
  const queue = 0.5 * betaIncomplete(ddl / 2, 0.5, ddl / (ddl + t * t));
  return t >= 0 ? 1 - queue : queue;
}
/** Le quantile de la loi de Student, pour 0 < p < 1 (par dichotomie sur la fonction de répartition). */
export function quantileStudent(p: number, ddl: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`quantile demandé hors de ]0 ; 1[ : ${p}`);
  if (!(ddl > 0)) throw new Error(`loi de Student : degrés de liberté impossibles (${ddl})`);
  if (ddl > 1e7) return quantileNormale(p);
  if (p === 0.5) return 0;
  if (p < 0.5) return -quantileStudent(1 - p, ddl);
  let bas = 0, haut = 1;
  while (repartitionStudent(haut, ddl) < p && haut < 1e12) haut *= 2;
  for (let i = 0; i < 200 && haut - bas > 1e-13 * Math.max(1, haut); i++) { const milieu = (bas + haut) / 2; if (repartitionStudent(milieu, ddl) < p) bas = milieu; else haut = milieu; }
  return (bas + haut) / 2;
}

// ------------------------------------------------------------------------------------------------ proportions
/**
 * Une proportion mesurée par plusieurs graines sur les MÊMES n épisodes : la moyenne des taux, avec l'intervalle de
 * Wilson d'un seul passage de n épisodes. Choix prudent : cinq graines sur 100 épisodes ne valent pas 500 épisodes.
 * Aucune graine : rien de mesuré (n = 0, intervalle de 0 à 1), jamais un zéro inventé.
 */
export function wilsonMoyenne(taux: readonly number[], n: number): Proportion {
  if (!taux.length || !(n > 0)) return wilson(0, 0);
  const p = Math.min(1, Math.max(0, moyenne(taux)));
  const w = wilson(Math.min(n, p * n), n);
  return { k: w.k, n, p, bas: Math.min(w.bas, p), haut: Math.max(w.haut, p) };
}
/** Note géométrique des compétences : exp(moyenne des ln(1 + taux en %)) − 1, de 0 à 100. `taux` va de 0 à 1. */
export function noteGeometrique(taux: readonly number[]): number {
  if (!taux.length) return 0;
  return Math.exp(moyenne(taux.map((t) => Math.log(1 + 100 * Math.min(1, Math.max(0, t)))))) - 1;
}
const moyenne = (xs: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return xs.length ? s / xs.length : 0; };

// ------------------------------------------------------------------------------------------------ McNemar, Holm
export interface McNemar { b01: number; b10: number; n: number; p: number }
const LN_FACT: number[] = [0];
const lnFact = (n: number): number => { for (let i = LN_FACT.length; i <= n; i++) LN_FACT.push(LN_FACT[i - 1] + Math.log(i)); return LN_FACT[n]; };
/**
 * Test exact de McNemar, des deux côtés. b01 : épisodes ratés par A et réussis par B ; b10 : l'inverse.
 * Si A et B se valent, chaque désaccord tombe d'un côté ou de l'autre comme une pièce : p = 2 × P(X ≤ min(b01, b10)),
 * X suivant une loi binomiale de b01 + b10 tirages à une chance sur deux.
 */
export function mcnemar(b01: number, b10: number): McNemar {
  if (!Number.isInteger(b01) || !Number.isInteger(b10) || b01 < 0 || b10 < 0) throw new Error(`McNemar : comptes impossibles (${b01}, ${b10})`);
  const n = b01 + b10, k = Math.min(b01, b10);
  if (n === 0) return { b01, b10, n, p: 1 };
  let cumul = 0;
  for (let i = 0; i <= k; i++) cumul += Math.exp(lnFact(n) - lnFact(i) - lnFact(n - i) - n * Math.LN2);
  return { b01, b10, n, p: Math.min(1, 2 * cumul) };
}
/** McNemar à partir de deux vecteurs réussi / raté sur les mêmes épisodes. */
export function mcnemarVecteurs(a: Vecteur, b: Vecteur): McNemar {
  if (a.length !== b.length) throw new Error(`McNemar : il faut les mêmes épisodes des deux côtés (${a.length} et ${b.length})`);
  let b01 = 0, b10 = 0;
  for (let i = 0; i < a.length; i++) { if (!a[i] && b[i]) b01++; else if (a[i] && !b[i]) b10++; }
  return mcnemar(b01, b10);
}
/** Correction de Holm : les valeurs p corrigées, dans l'ordre d'entrée (jamais plus petites que la valeur brute, jamais au-dessus de 1). */
export function holm(ps: readonly number[]): number[] {
  if (ps.some((p) => !(p >= 0 && p <= 1))) throw new Error(`Holm : une valeur p hors de 0 à 1 (${ps.join(', ')})`);
  const m = ps.length, ordre = ps.map((_, i) => i).sort((i, j) => ps[i] - ps[j]);
  const out = new Array<number>(m);
  let precedent = 0;
  ordre.forEach((i, rang) => { precedent = Math.min(1, Math.max(precedent, (m - rang) * ps[i])); out[i] = precedent; });
  return out;
}

// ------------------------------------------------------------------------------------------------ paires et écart détectable
export interface Differences { n: number; moyenne: number; ecartType: number; erreurType: number; desaccord: number }
/** Les différences b − a, épisode par épisode : moyenne, écart type, erreur type (écart type ÷ √n), part des désaccords. */
export function differences(a: Vecteur, b: Vecteur): Differences {
  if (a.length !== b.length) throw new Error(`différences : il faut les mêmes épisodes des deux côtés (${a.length} et ${b.length})`);
  const n = a.length;
  if (!n) return { n: 0, moyenne: 0, ecartType: 0, erreurType: 0, desaccord: 0 };
  let s = 0, s2 = 0, des = 0;
  for (let i = 0; i < n; i++) { const d = b[i] - a[i]; s += d; s2 += d * d; if (d !== 0) des++; }
  const m = s / n, ecartType = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * m * m) / (n - 1))) : 0;
  return { n, moyenne: m, ecartType, erreurType: ecartType / Math.sqrt(n), desaccord: des / n };
}
/**
 * Plus petit écart détectable par paires, sur n épisodes, quand A et B ne sont en désaccord que sur la part `desaccord`
 * des épisodes : (z du seuil + z de la puissance) × √(désaccord ÷ n). Seuil 5 % des deux côtés, puissance 80 % par défaut.
 */
export function plusPetitEcart(n: number, desaccord: number, seuil = 0.05, puissance = 0.8): number {
  return plusPetitEcartDepuis(Math.sqrt(Math.max(0, desaccord)), n, seuil, puissance);
}
/** La même chose à partir de l'écart type observé des différences par épisode. */
export function plusPetitEcartDepuis(ecartType: number, n: number, seuil = 0.05, puissance = 0.8): number {
  if (!(n > 0)) return Number.POSITIVE_INFINITY;
  return plusPetitEcartSelon(ecartType / Math.sqrt(n), seuil, puissance);
}
/**
 * Et à partir d'une erreur type déjà calculée (celle du rééchantillonnage hiérarchique, qui compte aussi le bruit
 * entre graines) : c'est la valeur la plus prudente, celle qu'on annonce.
 */
export function plusPetitEcartSelon(erreurType: number, seuil = 0.05, puissance = 0.8): number {
  return (quantileNormale(1 - seuil / 2) + quantileNormale(puissance)) * erreurType;
}
/** La même chose pour le contrôle par graines : la loi de Student, avec ses degrés de liberté (peu de graines : écart plus grand). */
export function plusPetitEcartStudent(erreurType: number, ddl: number, seuil = 0.05, puissance = 0.8): number {
  return (quantileStudent(1 - seuil / 2, ddl) + quantileStudent(puissance, ddl)) * erreurType;
}

// ------------------------------------------------------------------------------------------------ rééchantillonnage hiérarchique
export interface Tirages { tirages?: number; graine?: number; niveau?: number }
export interface Ecart {
  n: number; tauxA: number; tauxB: number; difference: number; bas: number; haut: number; p: number;
  /** L'écart type de l'écart d'un tirage à l'autre : l'erreur type de B − A, graines et épisodes comptés. */
  erreurType: number;
}
/** Le même écart, jugé sur les seuls taux de chaque graine (Welch, loi de Student). */
export interface ParGraines {
  difference: number;
  /** L'erreur type de l'écart entre les deux moyennes de taux ; `null` avec une seule graine d'un côté. */
  erreurType: number | null;
  /** Les degrés de liberté de Welch ; `null` quand ils ne se calculent pas. */
  ddl: number | null;
  /** Les bornes ; `null` : rien ne peut être dit (une seule graine d'un côté). */
  bas: number | null; haut: number | null;
}
export interface Comparaison extends Ecart {
  grainesA: number; grainesB: number; tirages: number; niveau: number;
  /** Les bornes du rééchantillonnage reculées de deux erreurs de tirage : ce que le hasard des tirages ne peut pas offrir. */
  basSur: number; hautSur: number;
  parGraines: ParGraines;
  /**
   * Les bornes qui décident : la plus prudente des deux méthodes de chaque côté. `null` : pas de décision possible
   * (une seule graine d'un côté).
   */
  basDecision: number | null; hautDecision: number | null;
  /** Le même écart, compétence par compétence, avec la valeur p corrigée par Holm. */
  parStrate: Record<string, Ecart & { pHolm: number }>;
}
export interface Bande { moyenne: number; bas: number; haut: number; graines: number }

function controler(m: readonly Vecteur[], nom: string): number {
  if (!m.length) throw new Error(`${nom} : il faut au moins une graine`);
  const n = m[0].length;
  if (!n) throw new Error(`${nom} : aucun épisode`);
  if (m.some((v) => v.length !== n)) throw new Error(`${nom} : toutes les graines doivent porter le même nombre d'épisodes`);
  return n;
}
/** Les épisodes de chaque strate (compétence), dans l'ordre des noms. Sans strates : une seule, « tout ». */
function parStrates(strates: ArrayLike<string> | null, n: number): Array<[string, Int32Array]> {
  if (!strates) return [['tout', Int32Array.from({ length: n }, (_, i) => i)]];
  if (strates.length !== n) throw new Error(`strates : ${strates.length} noms pour ${n} épisodes`);
  const g = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = strates[i]; if (!g.has(k)) g.set(k, []); g.get(k)!.push(i); }
  return [...g.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true })).map(([k, v]) => [k, Int32Array.from(v)]);
}
const moyenneParEpisode = (m: readonly Vecteur[], n: number): Float64Array => {
  const out = new Float64Array(n);
  for (const v of m) for (let e = 0; e < n; e++) out[e] += v[e];
  for (let e = 0; e < n; e++) out[e] /= m.length;
  return out;
};
/** Une moyenne par épisode sur des graines retirées au hasard (avec remise). */
function tirerGraines(m: readonly Vecteur[], n: number, alea: () => number, dans: Float64Array): void {
  dans.fill(0);
  for (let s = 0; s < m.length; s++) { const v = m[Math.floor(alea() * m.length)]; for (let e = 0; e < n; e++) dans[e] += v[e]; }
  for (let e = 0; e < n; e++) dans[e] /= m.length;
}
/** Quantile d'un tableau trié, par interpolation. */
function quantile(tri: Float64Array, q: number): number {
  if (!tri.length) return 0;
  const pos = Math.min(tri.length - 1, Math.max(0, q * (tri.length - 1))), i = Math.floor(pos), reste = pos - i;
  return i + 1 < tri.length ? tri[i] + reste * (tri[i + 1] - tri[i]) : tri[i];
}
/** Valeur p des deux côtés tirée des écarts rééchantillonnés : la part des tirages du mauvais côté de 0, doublée. */
function pDesDeuxCotes(ecarts: Float64Array): number {
  let dessous = 0, dessus = 0;
  for (let i = 0; i < ecarts.length; i++) { if (ecarts[i] <= 0) dessous++; if (ecarts[i] >= 0) dessus++; }
  return Math.min(1, (2 * (Math.min(dessous, dessus) + 1)) / (ecarts.length + 1));
}
const reglages = (o: Tirages) => {
  const tirages = Math.max(1, Math.floor(o.tirages ?? 10000)), niveau = o.niveau ?? 0.95;
  if (!(niveau > 0 && niveau < 1)) throw new Error(`niveau de confiance hors de ]0 ; 1[ : ${niveau}`);
  return { tirages, niveau, alea: hasard(o.graine ?? GRAINE), q0: (1 - niveau) / 2, q1: 1 - (1 - niveau) / 2 };
};

/**
 * L'écart B − A et son intervalle, par rééchantillonnage hiérarchique : à chaque tirage, on retire au hasard les graines
 * de A, celles de B, puis les épisodes (les mêmes pour A et B), strate par strate. Les graines de A et de B sont tirées
 * indépendamment : c'est le choix le plus prudent.
 */
export function comparer(a: readonly Vecteur[], b: readonly Vecteur[], strates: ArrayLike<string> | null, o: Tirages = {}): Comparaison {
  const n = controler(a, 'A');
  if (controler(b, 'B') !== n) throw new Error(`comparaison : il faut les mêmes épisodes pour A et B (${n} et ${b[0].length})`);
  const { tirages, niveau, alea, q0, q1 } = reglages(o);
  const groupes = parStrates(strates, n);
  const mA = moyenneParEpisode(a, n), mB = moyenneParEpisode(b, n);
  const tA = new Float64Array(n), tB = new Float64Array(n);
  const globaux = new Float64Array(tirages), parGroupe = groupes.map(() => new Float64Array(tirages));
  for (let r = 0; r < tirages; r++) {
    tirerGraines(a, n, alea, tA); tirerGraines(b, n, alea, tB);
    let total = 0;
    for (let g = 0; g < groupes.length; g++) {
      const idx = groupes[g][1];
      let somme = 0;
      for (let i = 0; i < idx.length; i++) { const e = idx[Math.floor(alea() * idx.length)]; somme += tB[e] - tA[e]; }
      parGroupe[g][r] = somme / idx.length; total += somme;
    }
    globaux[r] = total / n;
  }
  const ecart = (idx: Int32Array | null, ecarts: Float64Array): Ecart => {
    let sa = 0, sb = 0;
    const m = idx ? idx.length : n;
    for (let i = 0; i < m; i++) { const e = idx ? idx[i] : i; sa += mA[e]; sb += mB[e]; }
    const p = pDesDeuxCotes(ecarts), tri = ecarts.slice().sort(), centre = moyenne(ecarts);
    let carres = 0;
    for (let i = 0; i < ecarts.length; i++) carres += (ecarts[i] - centre) * (ecarts[i] - centre);
    const erreurType = ecarts.length > 1 ? Math.sqrt(carres / (ecarts.length - 1)) : 0;
    return { n: m, tauxA: sa / m, tauxB: sb / m, difference: (sb - sa) / m, bas: quantile(tri, q0), haut: quantile(tri, q1), p, erreurType };
  };
  const strats = groupes.map(([, idx], g) => ecart(idx, parGroupe[g]));
  const corriges = holm(strats.map((s) => s.p));
  const parStrate: Comparaison['parStrate'] = {};
  if (strates) groupes.forEach(([nom], g) => { parStrate[nom] = { ...strats[g], pHolm: corriges[g] }; });
  const global = ecart(null, globaux);
  // L'erreur de tirage d'un quantile : son rang bouge de √(T × q × (1 − q)). On recule la borne de deux fois cela.
  const recul = 2 * Math.sqrt((q0 * (1 - q0)) / tirages), tri = globaux.slice().sort();
  const basSur = Math.min(global.bas, quantile(tri, Math.max(0, q0 - recul))), hautSur = Math.max(global.haut, quantile(tri, Math.min(1, q1 + recul)));
  const parGraines = ecartParGraines(a, b, niveau);
  const sansGraines = parGraines.bas === null || parGraines.haut === null;
  return {
    ...global, grainesA: a.length, grainesB: b.length, tirages, niveau, parStrate, basSur, hautSur, parGraines,
    basDecision: sansGraines ? null : Math.min(basSur, parGraines.bas as number), hautDecision: sansGraines ? null : Math.max(hautSur, parGraines.haut as number),
  };
}

/**
 * Le contrôle par graines : l'écart entre la moyenne des taux des graines de B et celle des graines de A, avec
 * l'intervalle de Welch (loi de Student, variances inégales). Les graines sont ici la seule source de hasard : c'est ce
 * qui garde la décision quand il y a peu de graines et qu'elles s'écartent beaucoup. Une seule graine d'un côté : rien
 * ne peut être dit (bornes `null`).
 */
export function ecartParGraines(a: readonly Vecteur[], b: readonly Vecteur[], niveau = 0.95): ParGraines {
  controler(a, 'A'); controler(b, 'B');
  const tA = a.map((v) => moyenne(v)), tB = b.map((v) => moyenne(v)), difference = moyenne(tB) - moyenne(tA);
  if (tA.length < 2 || tB.length < 2) return { difference, erreurType: null, ddl: null, bas: null, haut: null };
  const variance = (t: number[]): number => { const c = moyenne(t); return t.reduce((s, x) => s + (x - c) * (x - c), 0) / (t.length - 1); };
  const vA = variance(tA) / tA.length, vB = variance(tB) / tB.length, erreurType = Math.sqrt(vA + vB);
  if (!(erreurType > 0)) return { difference, erreurType: 0, ddl: null, bas: difference, haut: difference };   // toutes les graines donnent le même taux
  const ddl = (vA + vB) ** 2 / ((vA * vA) / (tA.length - 1) + (vB * vB) / (tB.length - 1));
  const demi = quantileStudent(1 - (1 - niveau) / 2, ddl) * erreurType;
  return { difference, erreurType, ddl, bas: difference - demi, haut: difference + demi };
}

/** La moyenne d'UNE variante et sa bande (pour une courbe) : graines retirées, puis épisodes, strate par strate. */
export function bande(m: readonly Vecteur[], strates: ArrayLike<string> | null, o: Tirages = {}): Bande {
  const n = controler(m, 'bande');
  const { tirages, alea, q0, q1 } = reglages({ tirages: 2000, ...o });
  const groupes = parStrates(strates, n);
  const t = new Float64Array(n), valeurs = new Float64Array(tirages);
  for (let r = 0; r < tirages; r++) {
    tirerGraines(m, n, alea, t);
    let total = 0;
    for (const [, idx] of groupes) for (let i = 0; i < idx.length; i++) total += t[idx[Math.floor(alea() * idx.length)]];
    valeurs[r] = total / n;
  }
  const centre = moyenne(moyenneParEpisode(m, n)), tri = valeurs.sort();
  return { moyenne: centre, bas: Math.min(centre, quantile(tri, q0)), haut: Math.max(centre, quantile(tri, q1)), graines: m.length };
}

/**
 * La même bande quand on n'a que des COMPTES (le banc de porte ne donne jamais le détail par épisode) : `ks` réussites
 * par graine, sur les mêmes n épisodes. On retire les graines, puis n épisodes d'un passage au taux moyen tiré.
 * Choix prudent : on fait comme si les graines réussissaient exactement les mêmes épisodes, ce qui donne la bande la
 * plus large possible pour ces comptes.
 */
export function bandeComptes(ks: readonly number[], n: number, o: Tirages = {}): Bande {
  if (!ks.length) throw new Error('bande : il faut au moins une graine');
  if (!(n > 0) || ks.some((k) => !(k >= 0 && k <= n))) throw new Error(`bande : compte impossible (${ks.join(', ')} sur ${n})`);
  const { tirages, alea, q0, q1 } = reglages({ tirages: 2000, ...o });
  const valeurs = new Float64Array(tirages);
  for (let r = 0; r < tirages; r++) {
    let p = 0;
    for (let s = 0; s < ks.length; s++) p += ks[Math.floor(alea() * ks.length)];
    p /= ks.length * n;
    let k = 0;
    if (p <= 0) k = 0; else if (p >= 1) k = n; else for (let e = 0; e < n; e++) if (alea() < p) k++;
    valeurs[r] = k / n;
  }
  const centre = moyenne(ks) / n, tri = valeurs.sort();
  return { moyenne: centre, bas: Math.min(centre, quantile(tri, q0)), haut: Math.max(centre, quantile(tri, q1)), graines: ks.length };
}

// ------------------------------------------------------------------------------------------------ B bat-il A ? le bruit
export interface Amelioration { p: number; gagne: number; egal: number; perd: number }
/**
 * La probabilité que B batte A sur un épisode tiré au hasard, une graine de chaque côté tirée au hasard ; une égalité
 * compte pour moitié. Et la part des épisodes où B fait mieux, pareil, ou moins bien en moyenne sur les graines.
 */
export function probaAmelioration(a: readonly Vecteur[], b: readonly Vecteur[]): Amelioration {
  const n = controler(a, 'A');
  if (controler(b, 'B') !== n) throw new Error('probabilité d\'amélioration : il faut les mêmes épisodes pour A et B');
  const mA = moyenneParEpisode(a, n), mB = moyenneParEpisode(b, n);
  let p = 0, gagne = 0, egal = 0, perd = 0;
  for (let e = 0; e < n; e++) {
    p += mB[e] * (1 - mA[e]) + 0.5 * (mB[e] * mA[e] + (1 - mB[e]) * (1 - mA[e]));
    if (mB[e] > mA[e]) gagne++; else if (mB[e] < mA[e]) perd++; else egal++;
  }
  return { p: p / n, gagne: gagne / n, egal: egal / n, perd: perd / n };
}
export interface Bruit { taux: number[]; ecartMoyen: number; ecartMax: number; ecartType: number }
/** Le bruit d'un entraînement : l'écart de taux entre deux de ses graines (moyen, plus grand), et l'écart type des taux. */
export function bruitEntreGraines(m: readonly Vecteur[]): Bruit {
  controler(m, 'bruit');
  const taux = m.map((v) => moyenne(v));
  let somme = 0, max = 0, paires = 0;
  for (let i = 0; i < taux.length; i++) for (let j = i + 1; j < taux.length; j++) { const e = Math.abs(taux[i] - taux[j]); somme += e; max = Math.max(max, e); paires++; }
  const c = moyenne(taux), ecartType = taux.length > 1 ? Math.sqrt(taux.reduce((s, t) => s + (t - c) * (t - c), 0) / (taux.length - 1)) : 0;
  return { taux, ecartMoyen: paires ? somme / paires : 0, ecartMax: max, ecartType };
}

// ------------------------------------------------------------------------------------------------ la règle de décision
/** Fautes de sûreté d'un entraînement sur chaque banc ; `null` : le compteur n'est pas renseigné. */
export interface Surete { porte: number | null; cache: number | null }
export interface Decision {
  /** « A » est ici l'entraînement de référence, « B » le candidat ; leurs vrais noms sont dans le texte. */
  issue: 'B-mieux' | 'A-mieux' | 'pas-demontre' | 'B-ecarte' | 'A-ecarte' | 'suspendu';
  texte: string;
  raisons: string[];
}
export interface EcartADecider {
  difference: number; bas: number; haut: number;
  /** Les bornes qui décident, quand elles sont données (`null` : pas de décision possible). Sinon : `bas` et `haut`. */
  basDecision?: number | null; hautDecision?: number | null;
}
const enPoints = (x: number): string => (100 * x).toFixed(1).replace('.', ',');
const fautesDe = (s: Surete): number => (s.porte ?? 0) + (s.cache ?? 0);
const manquesDe = (s: Surete): string => [s.porte === null ? 'le banc de porte' : '', s.cache === null ? 'le banc caché' : ''].filter(Boolean).join(' et ');
const direFautes = (n: number): string => `${n} faute${n > 1 ? 's' : ''} de sûreté`;
/**
 * La règle écrite d'avance. « B fait mieux » seulement si la borne basse de l'écart B − A est au-dessus de 0 ET si B n'a
 * aucune faute de sûreté sur les deux bancs. La règle est la même dans l'autre sens : « A fait mieux » ne se dit jamais
 * d'un A qui a des fautes. Un blocage (témoin qui bouge, bancs différents, runs écartés…) suspend tout.
 * `noms` donne les vrais noms des deux entraînements (par défaut « A » et « B »).
 */
export function decider(c: EcartADecider, surete: { a: Surete; b: Surete }, o: { blocages?: readonly string[]; ecartDetectable?: number; noms?: { a: string; b: string } } = {}): Decision {
  const A = o.noms?.a ?? 'A', B = o.noms?.b ?? 'B';
  const blocages = [...(o.blocages ?? [])];
  if (blocages.length) return { issue: 'suspendu', texte: 'Conclusion suspendue : la mesure n\'est pas sûre.', raisons: blocages };
  const fautesA = fautesDe(surete.a), fautesB = fautesDe(surete.b);
  if (fautesB > 0) {
    const raisons = ['Une faute de sûreté n\'est jamais compensée par des réussites, quel que soit l\'écart.'];
    if (fautesA > 0) raisons.push(`${A} a aussi ${direFautes(fautesA)} : il n'est pas retenu non plus.`);
    return { issue: 'B-ecarte', texte: `${B} n'est pas retenu : ${direFautes(fautesB)}.`, raisons };
  }
  if (c.basDecision === null || c.hautDecision === null) {
    return { issue: 'suspendu', texte: 'Conclusion suspendue : il faut plusieurs graines de chaque côté.', raisons: ['Avec une seule graine d\'un côté, le bruit entre graines n\'est pas mesuré : on ne peut rien décider.'] };
  }
  const bas = c.basDecision ?? c.bas, haut = c.hautDecision ?? c.haut;
  if (bas > 0) {
    if (surete.b.porte === null || surete.b.cache === null) {
      return { issue: 'suspendu', texte: `Conclusion suspendue : l'écart est au-dessus de 0, mais la sûreté de ${B} n'est pas renseignée.`, raisons: [`Le compteur de fautes de sûreté de ${B} manque pour ${manquesDe(surete.b)} : on ne dit pas « zéro » à sa place.`] };
    }
    const raisons = [`La borne basse de l'écart ${B} − ${A} est au-dessus de 0, et ${B} n'a aucune faute de sûreté sur les deux bancs.`];
    if (fautesA > 0) raisons.push(`${A}, lui, a ${direFautes(fautesA)}.`);
    return { issue: 'B-mieux', texte: `${B} fait mieux que ${A} sur le banc caché.`, raisons };
  }
  if (haut < 0) {
    if (fautesA > 0) {
      return { issue: 'A-ecarte', texte: `${B} réussit moins que ${A} sur le banc caché, mais ${A} n'est pas retenu : ${direFautes(fautesA)}.`, raisons: ['Une faute de sûreté n\'est jamais compensée par des réussites : aucun des deux n\'est déclaré meilleur.'] };
    }
    if (surete.a.porte === null || surete.a.cache === null) {
      return { issue: 'suspendu', texte: `Conclusion suspendue : l'écart est sous 0, mais la sûreté de ${A} n'est pas renseignée.`, raisons: [`Le compteur de fautes de sûreté de ${A} manque pour ${manquesDe(surete.a)} : on ne dit pas « zéro » à sa place.`] };
    }
    return { issue: 'A-mieux', texte: `${B} fait moins bien que ${A} sur le banc caché.`, raisons: [`L'écart ${B} − ${A} est tout entier sous 0, et ${A} n'a aucune faute de sûreté sur les deux bancs.`] };
  }
  const raisons = [`L'intervalle de l'écart ${B} − ${A} contient 0.`];
  if (o.ecartDetectable !== undefined && Number.isFinite(o.ecartDetectable)) raisons.push(`Ce banc ne voit à coup sûr (8 fois sur 10) qu'un écart d'au moins ${enPoints(o.ecartDetectable)} points : en dessous, on ne peut pas conclure.`);
  if (fautesA > 0) raisons.push(`${A} a ${direFautes(fautesA)} : il n'est pas retenu.`);
  return { issue: 'pas-demontre', texte: `Pas de différence démontrée entre ${A} et ${B}.`, raisons };
}
