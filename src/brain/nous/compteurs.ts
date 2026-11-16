// Les compteurs 80-20, MESURÉS (jamais un poids forcé). Le « 80-20 » est une image inspirée du cerveau,
// pas une loi mesurée du cerveau humain : ici il devient une répartition réelle, affichée telle qu'elle est,
// avec 80-20 comme cible vers laquelle on tend. Tout est en nombres (le contrat range cet état dans la clé
// kv 'noos:etat' qui ne contient aucun texte).
//
// GARANTIE : l'arbitre du duel (src/brain/nous/duel.ts) ne reçoit jamais ces compteurs — un essai le prouve
// par la signature d'arbitrer. Le chiffre ne peut donc pas forcer le choix d'une réponse.
//
// Module pur : les fonctions prennent l'état, le modifient ou le lisent, et ne touchent ni disque ni horloge.

/** Une tranche de confiance pour la calibration : nombre de cas, nombre de cas justes, somme des confiances. */
export interface Tranche { n: number; justes: number; sommeConf: number }

/** L'état mesuré. SEULEMENT des nombres. */
export interface Compteurs {
  // (1) Part du travail : postes P1..P6 tenus, et ceux dont le résultat du profond a été GARDÉ.
  postesTenus: number;
  postesProfond: number;
  // (2) Duels.
  duelsJoues: number;
  duelsNoos: number;
  duelsEgalite: number;
  duelsApres: number;
  // (3) Niveaux (demandes et justesse observée).
  niv: [number, number, number];      // N1, N2, N3 : nombre de demandes
  nivJustes: [number, number, number]; // N1, N2, N3 : justes
  // (4) Calibration : 4 tranches (0–0,5 ; 0,5–0,7 ; 0,7–0,9 ; 0,9–1) + score de Brier.
  calib: [Tranche, Tranche, Tranche, Tranche];
  brierSomme: number;
  brierN: number;
  // (5) Coût : temps ajouté (anneau borné, ms) et temps de calcul du profond.
  tempsAjoute: number[];
  profondMs: number;
  profondN: number;
}

const MAX_TEMPS = 512; // anneau borné : on garde les 512 derniers temps pour médiane et p95.

function tr(): Tranche { return { n: 0, justes: 0, sommeConf: 0 }; }

export function compteursVides(): Compteurs {
  return {
    postesTenus: 0, postesProfond: 0,
    duelsJoues: 0, duelsNoos: 0, duelsEgalite: 0, duelsApres: 0,
    niv: [0, 0, 0], nivJustes: [0, 0, 0],
    calib: [tr(), tr(), tr(), tr()], brierSomme: 0, brierN: 0,
    tempsAjoute: [], profondMs: 0, profondN: 0,
  };
}

/** (1) Un poste P1..P6 a été tenu : `garde` = son résultat (celui du profond) a été gardé par la surface. */
export function noterPoste(c: Compteurs, garde: boolean): void {
  c.postesTenus += 1;
  if (garde) c.postesProfond += 1;
}

/** (2) Un duel a été joué. `gagneParNoos` ; `egalite` (doute) comptée à part ; `apresCoup` si rejoué en arrière-plan. */
export function noterDuel(c: Compteurs, gagneParNoos: boolean, egalite: boolean, apresCoup = false): void {
  c.duelsJoues += 1;
  if (apresCoup) c.duelsApres += 1;
  if (egalite) c.duelsEgalite += 1;
  else if (gagneParNoos) c.duelsNoos += 1;
}

/** (3) Une demande traitée à un niveau (1, 2 ou 3), et si elle s'est révélée juste. */
export function noterNiveau(c: Compteurs, niveau: 1 | 2 | 3, juste: boolean): void {
  const i = niveau - 1;
  c.niv[i] += 1;
  if (juste) c.nivJustes[i] += 1;
}

/** Tranche de calibration d'une confiance : 0 = [0;0,5[, 1 = [0,5;0,7[, 2 = [0,7;0,9[, 3 = [0,9;1]. */
export function trancheDe(conf: number): 0 | 1 | 2 | 3 {
  const x = Number.isFinite(conf) ? conf : 0;
  if (x < 0.5) return 0;
  if (x < 0.7) return 1;
  if (x < 0.9) return 2;
  return 3;
}

/** (4) Une prédiction notée : confiance annoncée et résultat (juste ou non). Met à jour tranches et Brier. */
export function noterCalibration(c: Compteurs, confiance: number, juste: boolean): void {
  const conf = Number.isFinite(confiance) ? Math.max(0, Math.min(1, confiance)) : 0;
  const t = c.calib[trancheDe(conf)];
  t.n += 1; t.sommeConf += conf; if (juste) t.justes += 1;
  const o = juste ? 1 : 0;
  c.brierSomme += (conf - o) * (conf - o);
  c.brierN += 1;
}

/** (5) Coût d'une réponse : temps ajouté perçu et temps de calcul du profond. */
export function noterCout(c: Compteurs, tempsAjouteMs: number, profondMs: number): void {
  if (Number.isFinite(tempsAjouteMs)) {
    c.tempsAjoute.push(Math.max(0, tempsAjouteMs));
    if (c.tempsAjoute.length > MAX_TEMPS) c.tempsAjoute.shift();
  }
  if (Number.isFinite(profondMs) && profondMs > 0) { c.profondMs += profondMs; c.profondN += 1; }
}

// ---------------------------------------------------------------------------------------------------
// Lectures (pour l'affichage). Rien n'est tiré au hasard.

/** Part du travail du profond, en pourcentages entiers { profond, surface } qui font 100. Affichée « réel X / Y ». */
export function partDuTravail(c: Compteurs): { profond: number; surface: number; tenus: number } {
  if (c.postesTenus <= 0) return { profond: 0, surface: 0, tenus: 0 };
  const p = Math.round((100 * c.postesProfond) / c.postesTenus);
  return { profond: p, surface: 100 - p, tenus: c.postesTenus };
}

/** Part des duels gagnés par Noûs (hors égalités) et le détail. */
export function partDuels(c: Compteurs): { part: number; joues: number; gagnes: number; egalites: number; apres: number } {
  const denom = Math.max(0, c.duelsJoues - c.duelsEgalite);
  const part = denom > 0 ? c.duelsNoos / denom : 0;
  return { part, joues: c.duelsJoues, gagnes: c.duelsNoos, egalites: c.duelsEgalite, apres: c.duelsApres };
}

/** Part des demandes traitées en réflexe (N1) et justesse par niveau. */
export function partNiveaux(c: Compteurs): { partN1: number; justesse: [number, number, number]; demandes: [number, number, number] } {
  const total = c.niv[0] + c.niv[1] + c.niv[2];
  const j = (i: number) => (c.niv[i] > 0 ? c.nivJustes[i] / c.niv[i] : 0);
  return { partN1: total > 0 ? c.niv[0] / total : 0, justesse: [j(0), j(1), j(2)], demandes: [...c.niv] };
}

/** Calibration : justesse par tranche, écart de calibration moyen (ECE) et score de Brier. */
export function calibration(c: Compteurs): { tranches: Array<{ conf: number; justesse: number; n: number }>; ece: number; brier: number } {
  const N = c.calib.reduce((s, t) => s + t.n, 0);
  let ece = 0;
  const tranches = c.calib.map((t) => {
    const conf = t.n > 0 ? t.sommeConf / t.n : 0;
    const justesse = t.n > 0 ? t.justes / t.n : 0;
    if (t.n > 0) ece += (t.n / N) * Math.abs(justesse - conf);
    return { conf, justesse, n: t.n };
  });
  return { tranches, ece: N > 0 ? ece : 0, brier: c.brierN > 0 ? c.brierSomme / c.brierN : 0 };
}

/** Coût : médiane et p95 du temps ajouté (ms), temps moyen du profond (ms). */
export function cout(c: Compteurs): { medianeMs: number; p95Ms: number; profondMoyenMs: number } {
  return {
    medianeMs: quantile(c.tempsAjoute, 0.5),
    p95Ms: quantile(c.tempsAjoute, 0.95),
    profondMoyenMs: c.profondN > 0 ? c.profondMs / c.profondN : 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Statistiques partagées (aussi utilisées par niveaux.ts).

/** Borne basse de l'intervalle de Wilson pour une proportion. z = 1,96 (95 %). Sûre et sans hasard. */
export function wilsonLow(succes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = succes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const marge = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - marge) / denom);
}

/** Quantile d'un échantillon (interpolation linéaire). Ne modifie pas le tableau d'entrée. */
export function quantile(xs: number[], q: number): number {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0];
  const pos = Math.max(0, Math.min(1, q)) * (a.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
