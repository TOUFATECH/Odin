// Banc de Soul : les MESURES (fonctions pures, sans rien lire ni écrire). Prouvées par test/soul-banc.test.ts.
//
// Ce qu'on mesure (note de logique, § 3.3) :
//   - justesse au 1er rang et dans les 3 premiers, pour l'appli seule et pour appli + action, chaque fois avec son
//     intervalle de Wilson à 95 % ;
//   - le même relevé par langue, par écriture, par sorte de demande et par appli ;
//   - la courbe risque-couverture (à chaque seuil de confiance : la part des demandes où la méthode répond, et le taux
//     d'erreur parmi ces réponses) ;
//   - l'écart de calibration (confiance annoncée contre justesse observée) ;
//   - les fausses actions sur les demandes hors du champ d'Odin ;
//   - le temps par demande (médiane et 95e centile).
//
// Règles de justesse (écrites une fois ici, appliquées partout) :
//   - demande DANS le champ (appli non nulle) : l'appli est juste si c'est l'appli attendue ou l'une de `aussi` ;
//     appli + action est juste si l'appli attendue ET l'action attendue sont données (si l'action attendue est nulle,
//     l'appli suffit), ou si le choix est l'un de `aussi` : une entrée « appli.action » exige cette action, une entrée
//     « appli » seule accepte n'importe quelle action (on ne connaît pas l'action attendue chez elle) ; le compte
//     STRICT (sans `aussi`) est publié à côté ;
//   - demande HORS du champ (appli nulle) : la bonne réponse est « pas encore ». Au 1er rang, c'est juste si la méthode
//     ne propose aucune appli (liste vide, ou premier choix sans appli) ou passe la main. Dans les 3 premiers : juste si
//     l'un des trois choix est « pas encore » (sans appli) ou si la méthode passe la main. Comme une méthode qui passe
//     toujours la main y aurait tout juste, le rapport met en tête la justesse FORCÉE hors champ (premier choix sans
//     appli, qu'elle passe la main ou non) et la justesse dans le champ.
//   - relance : le contexte d'un jeu peut être un objet { precedent, appli, actionPrecedente } ou un texte (le tour
//     précédent) ; `contexteDe` ramène les deux à l'objet. Une relance est aussi jouée SANS l'appli active : si l'appli
//     active du jeu est la réponse attendue, le premier chiffre ne mesure pas la compréhension.

export type Decision = 'seul' | 'trois' | 'main';
export interface Choix { appli: string | null; action: string | null; score: number }
export interface Reponse { choix: Choix[]; decision: Decision; confiance: number }
export type Sorte = 'directe' | 'piege' | 'hors-champ' | 'relance';
export interface Contexte { precedent?: string; appli?: string; actionPrecedente?: string; [cle: string]: unknown }
export interface Demande {
  id: string; langue: string; ecriture: string; phrase: string;
  appli: string | null; action: string | null; aussi?: string[]; sorte: Sorte | string; contexte?: Contexte; aRelire?: boolean;
}
export interface Jeu { version: string | number; origine: string; demandes: Demande[]; [cle: string]: unknown }
/** `reponseSansAppli` : pour une relance, la réponse avec le seul tour précédent (sans appli active ni action précédente). */
export interface Resultat { demande: Demande; reponse: Reponse; ms: number; reponseSansAppli?: Reponse }

export const Z95 = 1.959963984540054;

/** Le contexte d'une relance ramené à l'objet attendu : un texte est le tour précédent ; vide ou autre forme : aucun. */
export function contexteDe(c: unknown): Contexte | undefined {
  if (typeof c === 'string') return c.trim() ? { precedent: c } : undefined;
  if (c && typeof c === 'object' && !Array.isArray(c)) return { ...(c as Contexte) };
  return undefined;
}

// ------------------------------------------------------------------------------------------------ justesse
const horsChamp = (d: Demande) => d.appli === null || d.appli === 'aucune';
/** Les entrées de `aussi` : « appli » ou « appli.action ». */
const aussiDe = (d: Demande) => (d.aussi ?? []).map((x) => { const i = String(x).indexOf('.'); return i > 0 ? { appli: x.slice(0, i), action: x.slice(i + 1) as string | null } : { appli: String(x), action: null }; });
const appliJuste = (d: Demande, c: Choix | undefined) => Boolean(c && c.appli !== null && (c.appli === d.appli || aussiDe(d).some((a) => a.appli === c.appli)));
const actionJuste = (d: Demande, c: Choix | undefined) => Boolean(c && c.appli !== null && ((c.appli === d.appli && (d.action === null || c.action === d.action)) || aussiDe(d).some((a) => a.appli === c.appli && (a.action === null || a.action === c.action))));
const passe = (r: Reponse) => r.decision === 'main';

export function juste(d: Demande, r: Reponse, niveau: 'appli' | 'action', rang: 1 | 3): boolean {
  if (horsChamp(d)) {
    if (passe(r) || r.choix.length === 0) return true;
    return rang === 1 ? r.choix[0].appli === null : r.choix.slice(0, 3).some((c) => c.appli === null);
  }
  const f = niveau === 'appli' ? appliJuste : actionJuste;
  return rang === 1 ? f(d, r.choix[0]) : r.choix.slice(0, 3).some((c) => f(d, c));
}

// ------------------------------------------------------------------------------------------------ Wilson
export interface Proportion { k: number; n: number; p: number; bas: number; haut: number }
/** Intervalle de score de Wilson (95 % par défaut). n = 0 : p = 0, intervalle [0, 1]. */
export function wilson(k: number, n: number, z = Z95): Proportion {
  if (!(n > 0)) return { k: 0, n: 0, p: 0, bas: 0, haut: 1 };
  if (k < 0 || k > n) throw new Error(`proportion impossible : ${k}/${n}`);
  const p = k / n, z2 = z * z, den = 1 + z2 / n, centre = (p + z2 / (2 * n)) / den;
  const demi = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  // Aux bords (0 ou n réussites), la borne vaut exactement 0 ou 1 (le calcul flottant donnerait 0,9999…).
  return { k, n, p, bas: k === 0 ? 0 : Math.max(0, centre - demi), haut: k === n ? 1 : Math.min(1, centre + demi) };
}

// ------------------------------------------------------------------------------------------------ relevés
export interface Releve { n: number; appli1: Proportion; appli3: Proportion; action1: Proportion; action3: Proportion }
export function releve(rs: Resultat[]): Releve {
  const compte = (niv: 'appli' | 'action', rang: 1 | 3) => wilson(rs.filter((x) => juste(x.demande, x.reponse, niv, rang)).length, rs.length);
  return { n: rs.length, appli1: compte('appli', 1), appli3: compte('appli', 3), action1: compte('action', 1), action3: compte('action', 3) };
}
/** Le relevé par groupe ; `tous` force la présence de groupes sans demande (les 75 applis, par exemple). */
export function relevePar(rs: Resultat[], cle: (d: Demande) => string, tous: string[] = []): Record<string, Releve> {
  const g = new Map<string, Resultat[]>();
  for (const t of tous) g.set(t, []);
  for (const r of rs) { const k = cle(r.demande); if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
  return Object.fromEntries([...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, releve(v)]));
}
export const HORS_CHAMP = '(hors champ)';
export const cleAppli = (d: Demande) => (horsChamp(d) ? HORS_CHAMP : d.appli!);

// ------------------------------------------------------------------------------------------------ risque-couverture
export interface PointRC { seuil: number; repond: number; couverture: number; erreurs: number; risque: number }
/**
 * À chaque seuil t (chaque confiance distincte observée, de la plus haute à la plus basse) : la méthode « répond seule »
 * aux demandes de confiance ≥ t. couverture = part de ces demandes ; risque = part d'erreurs (1er rang, appli + action
 * par défaut) parmi elles. Une demande hors champ « répondue » est une erreur si la méthode y propose une appli.
 */
export function risqueCouverture(rs: Resultat[], niveau: 'appli' | 'action' = 'action'): PointRC[] {
  const N = rs.length; if (!N) return [];
  const tri = [...rs].sort((a, b) => b.reponse.confiance - a.reponse.confiance);
  const out: PointRC[] = [];
  let repond = 0, erreurs = 0;
  for (let i = 0; i < tri.length; i++) {
    const r = tri[i];
    repond++;
    if (!justeForce(r, niveau)) erreurs++;
    const c = r.reponse.confiance;
    if (i + 1 < tri.length && tri[i + 1].reponse.confiance === c) continue; // même seuil : on prend tout le palier
    out.push({ seuil: c, repond, couverture: repond / N, erreurs, risque: erreurs / repond });
  }
  return out;
}
/** Justesse « au 1er rang si la méthode était forcée de répondre seule » : passer la main ne compte pas comme juste. */
function justeForce(r: Resultat, niveau: 'appli' | 'action'): boolean {
  const d = r.demande, c = r.reponse.choix[0];
  if (horsChamp(d)) return !c || c.appli === null;
  return niveau === 'appli' ? appliJuste(d, c) : actionJuste(d, c);
}
/** Aire sous la courbe risque-couverture (plus petit = mieux), par paliers. */
export function aireRC(points: PointRC[]): number {
  let aire = 0, prec = 0;
  for (const p of points) { aire += (p.couverture - prec) * p.risque; prec = p.couverture; }
  return aire;
}
/** La plus grande couverture dont le risque reste au plus `risqueMax` (0 si aucune). */
export function couvertureA(points: PointRC[], risqueMax: number): { seuil: number | null; couverture: number; risque: number } {
  let best: PointRC | undefined;
  for (const p of points) if (p.risque <= risqueMax && (!best || p.couverture > best.couverture)) best = p;
  return best ? { seuil: best.seuil, couverture: best.couverture, risque: best.risque } : { seuil: null, couverture: 0, risque: 0 };
}

// ------------------------------------------------------------------------------------------------ calibration
export interface Calibration { ece: number; mce: number; cases: Array<{ de: number; a: number; n: number; confiance: number; justesse: number }> }
/** Écart de calibration attendu (ECE, cases de largeur égale) et écart maximal, au 1er rang (appli + action par défaut). */
export function calibration(rs: Resultat[], cases = 10, niveau: 'appli' | 'action' = 'action'): Calibration {
  const b = Array.from({ length: cases }, (_, i) => ({ de: i / cases, a: (i + 1) / cases, n: 0, s: 0, j: 0 }));
  for (const r of rs) {
    const c = Math.min(1, Math.max(0, Number.isFinite(r.reponse.confiance) ? r.reponse.confiance : 0));
    const i = Math.min(cases - 1, Math.floor(c * cases));
    b[i].n++; b[i].s += c; b[i].j += justeForce(r, niveau) ? 1 : 0;
  }
  const N = rs.length || 1;
  let ece = 0, mce = 0;
  const out = b.map((x) => {
    const conf = x.n ? x.s / x.n : 0, just = x.n ? x.j / x.n : 0, e = Math.abs(conf - just);
    if (x.n) { ece += (x.n / N) * e; mce = Math.max(mce, e); }
    return { de: x.de, a: x.a, n: x.n, confiance: conf, justesse: just };
  });
  return { ece: rs.length ? ece : 0, mce, cases: out };
}

// ------------------------------------------------------------------------------------------------ décisions, hors champ, temps
export interface Decisions { seul: number; trois: number; main: number; justesSeul: Proportion; dansTrois: Proportion }
export function decisions(rs: Resultat[]): Decisions {
  const seul = rs.filter((r) => r.reponse.decision === 'seul'), trois = rs.filter((r) => r.reponse.decision === 'trois');
  return {
    seul: seul.length, trois: trois.length, main: rs.filter((r) => r.reponse.decision === 'main').length,
    justesSeul: wilson(seul.filter((r) => justeForce(r, 'action')).length, seul.length),
    dansTrois: wilson(trois.filter((r) => juste(r.demande, r.reponse, 'action', 3)).length, trois.length),
  };
}
/** Hors champ : la méthode agit seule sur une appli (faute grave), ou propose une appli en premier choix. */
export function faussesActions(rs: Resultat[]): { n: number; agitSeule: Proportion; proposeAppli: Proportion } {
  const h = rs.filter((r) => horsChamp(r.demande));
  const premier = (r: Resultat) => r.reponse.choix[0]?.appli ?? null;
  return {
    n: h.length,
    agitSeule: wilson(h.filter((r) => r.reponse.decision === 'seul' && premier(r) !== null).length, h.length),
    proposeAppli: wilson(h.filter((r) => r.reponse.decision !== 'main' && premier(r) !== null).length, h.length),
  };
}
/** Centile au rang le plus proche (p dans [0, 1]). */
export function centile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.max(0, Math.ceil(p * t.length) - 1))];
}
export function temps(rs: Resultat[]): { mediane: number; p95: number; max: number } {
  const ms = rs.map((r) => r.ms);
  return { mediane: centile(ms, 0.5), p95: centile(ms, 0.95), max: ms.length ? Math.max(...ms) : 0 };
}

// ------------------------------------------------------------------------------------------------ rapport complet
/** Dans le champ, appli au 1er rang, par langue : la moyenne des langues (chaque langue pèse autant), la pire, le français contre les autres. */
export interface Langues { moyenne: number; langues: number; pire: { langue: string; p: number; n: number } | null; francais: Proportion; autres: Proportion; parLangue: Record<string, Proportion> }
export function langues(rs: Resultat[]): Langues {
  const champ = rs.filter((r) => !horsChamp(r.demande));
  const ok = (r: Resultat) => juste(r.demande, r.reponse, 'appli', 1);
  const g = new Map<string, Resultat[]>();
  for (const r of champ) { const k = r.demande.langue || '?'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
  const parLangue = Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, wilson(v.filter(ok).length, v.length)]));
  const ps = Object.entries(parLangue);
  let pire: Langues['pire'] = null;
  for (const [langue, p] of ps) if (!pire || p.p < pire.p) pire = { langue, p: p.p, n: p.n };
  const fr = champ.filter((r) => r.demande.langue === 'fr'), autres = champ.filter((r) => r.demande.langue !== 'fr');
  return {
    moyenne: ps.length ? ps.reduce((s, [, p]) => s + p.p, 0) / ps.length : 0, langues: ps.length, pire,
    francais: wilson(fr.filter(ok).length, fr.length), autres: wilson(autres.filter(ok).length, autres.length), parLangue,
  };
}
/** Relances : justesse (appli, 1er rang) avec le contexte du jeu, puis sans l'appli active ; combien de fois l'appli active du jeu EST la réponse. */
export interface Relances { n: number; appliActiveEstLaReponse: number; avecContexte: Proportion; sansAppliActive: Proportion }
export function relances(rs: Resultat[]): Relances {
  const rel = rs.filter((r) => r.demande.sorte === 'relance');
  const sans = rel.filter((r) => r.reponseSansAppli);
  return {
    n: rel.length,
    appliActiveEstLaReponse: rel.filter((r) => typeof r.demande.contexte?.appli === 'string' && r.demande.contexte.appli === r.demande.appli).length,
    avecContexte: wilson(rel.filter((r) => juste(r.demande, r.reponse, 'appli', 1)).length, rel.length),
    sansAppliActive: wilson(sans.filter((r) => juste(r.demande, r.reponseSansAppli!, 'appli', 1)).length, sans.length),
  };
}

export interface Rapport {
  global: Releve; dansLeChamp: Releve;
  /** Dans le champ, sans `aussi` (relecture P3). */
  dansLeChampStrict: Releve;
  /** Dans le champ, sans les demandes déjà vues par l'apprentissage ou présentes dans un autre jeu (relecture M1). */
  sansFuites: Releve; fuites: number;
  /** Hors du champ, forcée à répondre : premier choix sans appli (relecture G2). */
  horsChampForce: Proportion;
  /** Vrai si la méthode n'agit jamais seule : ses chiffres hors champ ne disent alors rien de sa sûreté. */
  decisionInerte: boolean;
  langues: Langues; relances: Relances;
  parLangue: Record<string, Releve>; parEcriture: Record<string, Releve>; parSorte: Record<string, Releve>; parAppli: Record<string, Releve>;
  risqueCouverture: PointRC[]; aireRC: number; couverture90: ReturnType<typeof couvertureA>; couverture95: ReturnType<typeof couvertureA>;
  calibration: Calibration; decisions: Decisions; horsChamp: ReturnType<typeof faussesActions>; temps: ReturnType<typeof temps>;
}
export function rapport(rs: Resultat[], applis: string[] = [], o: { fuites?: Set<string> } = {}): Rapport {
  const rc = risqueCouverture(rs);
  const champ = rs.filter((r) => !horsChamp(r.demande)), hc = rs.filter((r) => horsChamp(r.demande));
  const fuites = o.fuites ?? new Set<string>();
  const dec = decisions(rs);
  return {
    global: releve(rs), dansLeChamp: releve(champ),
    dansLeChampStrict: releve(champ.map((r) => ({ ...r, demande: { ...r.demande, aussi: [] } }))),
    sansFuites: releve(champ.filter((r) => !fuites.has(r.demande.id))), fuites: rs.filter((r) => fuites.has(r.demande.id)).length,
    horsChampForce: wilson(hc.filter((r) => justeForce(r, 'appli')).length, hc.length),
    decisionInerte: dec.seul === 0,
    langues: langues(rs), relances: relances(rs),
    parLangue: relevePar(rs, (d) => d.langue || '?'), parEcriture: relevePar(rs, (d) => d.ecriture || '?'), parSorte: relevePar(rs, (d) => String(d.sorte || '?')),
    parAppli: relevePar(rs, cleAppli, applis),
    risqueCouverture: rc, aireRC: aireRC(rc), couverture90: couvertureA(rc, 0.10), couverture95: couvertureA(rc, 0.05),
    calibration: calibration(rs), decisions: dec, horsChamp: faussesActions(rs), temps: temps(rs),
  };
}

/** Contrôle de forme d'un jeu (rend la liste des défauts, vide si tout va bien). */
export function defautsDuJeu(j: unknown): string[] {
  const out: string[] = [];
  const o = j as Jeu;
  if (!o || typeof o !== 'object' || !Array.isArray(o.demandes)) return ['le jeu n\'a pas de liste « demandes »'];
  const ids = new Set<string>();
  o.demandes.forEach((d, i) => {
    const ou = `demande ${i} (${d?.id ?? 'sans id'})`;
    if (!d || typeof d !== 'object') { out.push(`${ou} : pas un objet`); return; }
    if (typeof d.id !== 'string' || !d.id) out.push(`${ou} : id manquant`); else if (ids.has(d.id)) out.push(`${ou} : id en double`); else ids.add(d.id);
    if (typeof d.phrase !== 'string' || !d.phrase.trim()) out.push(`${ou} : phrase vide`);
    if (d.appli !== null && typeof d.appli !== 'string') out.push(`${ou} : appli ni texte ni null`);
    if (d.action !== null && d.action !== undefined && typeof d.action !== 'string') out.push(`${ou} : action ni texte ni null`);
    if (!['directe', 'piege', 'hors-champ', 'relance'].includes(String(d.sorte))) out.push(`${ou} : sorte inconnue « ${d.sorte} »`);
    if (d.aussi !== undefined && (!Array.isArray(d.aussi) || d.aussi.some((x) => typeof x !== 'string' || !x))) out.push(`${ou} : aussi n'est pas une liste de textes (« appli » ou « appli.action »)`);
    // Relance : un contexte objet ou texte (relecture G1) ; toute autre forme serait ignorée en silence.
    const c = (d as { contexte?: unknown }).contexte;
    if (c !== undefined && typeof c !== 'string' && !(c && typeof c === 'object' && !Array.isArray(c))) out.push(`${ou} : contexte ni objet ni texte`);
    else if (d.sorte === 'relance' && !contexteDe(c)) out.push(`${ou} : relance sans contexte`);
  });
  return out;
}
