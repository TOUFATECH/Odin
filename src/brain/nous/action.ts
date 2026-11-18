// Noûs — LE CHOIX DE L'ACTION DANS UNE APPLI (tour 7 de Soul v3).
//
// Constat (moitié A du jeu de travail, calcul du tour 6) : l'appli est juste 220 fois sur 245, appli + action 152 fois ;
// les erreurs d'ACTION avec la bonne appli pèsent presque trois fois les erreurs d'appli. Jusqu'au tour 6, l'action est
// choisie par les plus proches voisins dans l'appli (somme des carrés des trois plus proches phrases de chaque action) :
// dans une appli, toutes les actions parlent du même objet (« wifi », « rendez-vous », « mot de passe ») et le voisin le
// plus proche est celui qui partage l'OBJET, pas l'intention (« enlève », « remets », « crée »).
//
// Deux remèdes, appris ici sur la matière seule (aucun poids venu d'ailleurs, aucun poids gardé dans le dépôt) :
//   1. les voisins RE-PONDÉRÉS : dans une appli, chaque n-gramme pèse selon sa rareté parmi les actions de l'appli,
//      f(g) = (ln((A + 1) / (a(g) + 1)) + 1)^γ, où A est le nombre d'actions de l'appli et a(g) le nombre d'actions dont
//      une phrase contient g. Ce que toutes les actions partagent (l'objet) pèse peu, la tournure d'une action pèse ;
//   2. un MODÈLE par appli : une régression logistique à plusieurs classes (ses actions), apprise sur ses seules phrases
//      à action, sur les mêmes n-grammes TF-IDF que l'index. Ce qui est commun à toutes les actions n'y sépare rien.
// La note de chaque action mélange les deux : (1 − μ)·voisins + μ·modèle.
//
// Rien ne suppose une langue : seuls des n-grammes de caractères, sans liste de mots. Déterministe : l'ordre des
// phrases de l'apprentissage est une permutation tirée d'une graine fixe. Les index et les modèles sont faits à la
// demande (une appli à la fois, la première fois qu'elle est candidate) et gardés en tableaux typés ; en validation
// croisée, ceux d'un pli (phrases du pli retirées) remplacent ceux du pli d'avant.
import type { IndexNgrammes } from './aiguilleur.ts';

/** Réglages du modèle d'une appli : passes, pas de départ, pénalité L2 (par phrase), poids d'une demande apprise. */
export interface OptionsAction { tours: number; pas: number; l2: number; poidsDemande: number }

/** Le modèle d'une appli : ses actions (rangées), les n-grammes vus (numéro local) et les poids. */
interface ModeleAction { actions: string[]; num: Map<number, number>; W: Float64Array; b: Float64Array }

/** Index direct de l'index d'une matière (phrase → ses n-grammes et leurs poids), fait une fois par cœur. */
interface Direct { debut: Int32Array; ids: Int32Array; w: Float32Array }
const DIRECTS = new WeakMap<object, Direct>();
function direct(ix: IndexNgrammes): Direct {
  const c = ix.coeur; let d = DIRECTS.get(c); if (d) return d;
  const N = ix.paires.length, P = c.postDoc.length, debut = new Int32Array(N + 1);
  for (let p = 0; p < P; p++) debut[c.postDoc[p] + 1]++;
  for (let i = 0; i < N; i++) debut[i + 1] += debut[i];
  const ids = new Int32Array(P), w = new Float32Array(P), pos = debut.slice(0, N);
  for (let g = 0; g + 1 < c.debut.length; g++) for (let p = c.debut[g]; p < c.debut[g + 1]; p++) { const k = pos[c.postDoc[p]]++; ids[k] = g; w[k] = c.postPoids[p]; }
  d = { debut, ids, w }; DIRECTS.set(c, d); return d;
}

/** Permutation des phrases à graine fixe (l'ordre de la matière groupe les actions). */
function melange(n: number, graine: number): Int32Array {
  const o = new Int32Array(n); for (let i = 0; i < n; i++) o[i] = i;
  let s = graine >>> 0;
  for (let i = n - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); const t = o[i]; o[i] = o[j]; o[j] = t; }
  return o;
}

/** Apprend le modèle d'une appli sur ses phrases de base qui ont une action (sans les phrases `exclu`). */
function apprendre(ix: IndexNgrammes, docs: number[], o: OptionsAction, exclu?: Uint8Array): ModeleAction | undefined {
  const garde = docs.filter((d) => d < ix.paires.length && ix.vivante(d) && ix.paires[d].action && !(exclu && exclu[d]));
  const actions = [...new Set(garde.map((d) => ix.paires[d].action!))].sort();
  if (actions.length < 2) return actions.length ? { actions, num: new Map(), W: new Float64Array(0), b: new Float64Array(1) } : undefined;
  const rangAct = new Map(actions.map((a, i) => [a, i]));
  const y = Array.from(garde, (d) => rangAct.get(ix.paires[d].action!)!);
  const wBase = garde.map((d) => { const p = ix.paires[d]; return (p.poids ?? 1) * (p.demande ? o.poidsDemande : 1); });
  const dr = direct(ix), K = actions.length;
  // Classes équilibrées : chaque action pèse autant, quel que soit son nombre de phrases.
  const nC = new Float64Array(K); for (let i = 0; i < y.length; i++) nC[y[i]] += wBase[i];
  let somme = 0; for (const x of wBase) somme += x;
  const n = garde.length, wD = new Float64Array(n);
  for (let i = 0; i < n; i++) wD[i] = wBase[i] * (somme / K / nC[y[i]]);
  const num = new Map<number, number>();
  for (const d of garde) for (let k = dr.debut[d]; k < dr.debut[d + 1]; k++) if (!num.has(dr.ids[k])) num.set(dr.ids[k], num.size);
  const W = new Float64Array(num.size * K), b = new Float64Array(K), z = new Float64Array(K);
  const loc = garde.map((d) => { const a = new Int32Array(dr.debut[d + 1] - dr.debut[d]); for (let k = dr.debut[d], j = 0; k < dr.debut[d + 1]; k++, j++) a[j] = num.get(dr.ids[k])! * K; return a; });
  const ordre = melange(n, 0x5eed + n);
  let pas = o.pas;
  // Descente de gradient phrase par phrase ; pénalité L2 une fois par passe ; le pas décroît.
  for (let t = 0; t < o.tours; t++) {
    for (let r = 0; r < n; r++) {
      const i = ordre[r], d = garde[i], L = loc[i], k0 = dr.debut[d];
      for (let c = 0; c < K; c++) z[c] = b[c];
      for (let j = 0; j < L.length; j++) { const x = dr.w[k0 + j], o2 = L[j]; for (let c = 0; c < K; c++) z[c] += W[o2 + c] * x; }
      let mx = -Infinity; for (let c = 0; c < K; c++) if (z[c] > mx) mx = z[c];
      let se = 0; for (let c = 0; c < K; c++) { z[c] = Math.exp(z[c] - mx); se += z[c]; }
      for (let c = 0; c < K; c++) {
        const e = (z[c] / se - (c === y[i] ? 1 : 0)) * wD[i] * pas;
        if (e === 0) continue;
        b[c] -= e * 0.1;
        for (let j = 0; j < L.length; j++) W[L[j] + c] -= e * dr.w[k0 + j];
      }
    }
    if (o.l2 > 0) { const f = 1 - o.l2 * n * pas; if (f > 0) for (let j = 0; j < W.length; j++) W[j] *= f; }
    pas *= 0.7;
  }
  return { actions, num, W, b };
}

/** Probabilité de chaque action de l'appli pour la requête `q` (n-grammes de la requête, poids normés). */
function probas(m: ModeleAction, q: Map<string, number>, vocab: Map<string, number>): Map<string, number> {
  const K = m.actions.length, z = Float64Array.from(m.b);
  if (K === 1) return new Map([[m.actions[0], 1]]);
  for (const [g, wq] of q) { const id = vocab.get(g); if (id === undefined) continue; const l = m.num.get(id); if (l === undefined) continue; for (let c = 0; c < K; c++) z[c] += m.W[l * K + c] * wq; }
  let mx = -Infinity; for (let c = 0; c < K; c++) if (z[c] > mx) mx = z[c];
  let se = 0; for (let c = 0; c < K; c++) { z[c] = Math.exp(z[c] - mx); se += z[c]; }
  return new Map(m.actions.map((a, c) => [a, z[c] / se]));
}

/**
 * L'index re-pondéré d'une appli (ses phrases de base à action), en tableaux : pour chaque n-gramme local, la liste de
 * ses phrases (numéro local) et le poids re-pondéré ; la norme de chaque phrase ; la rareté de chaque n-gramme local.
 */
interface IndexAppli { local: Map<number, number>; f: Float64Array; debut: Int32Array; doc: Int32Array; w: Float64Array; garde: Int32Array; norme: Float64Array }
function indexAppli(ix: IndexNgrammes, docs: number[], gamma: number, exclu?: Uint8Array): IndexAppli {
  const dr = direct(ix), garde: number[] = [], acts = new Map<string, number>();
  const local = new Map<number, number>(), lAct: number[][] = [];
  for (const d of docs) {
    if (d >= ix.paires.length || !ix.vivante(d) || (exclu && exclu[d])) continue;
    const p = ix.paires[d]; if (!p.action) continue;
    let ia = acts.get(p.action); if (ia === undefined) acts.set(p.action, ia = acts.size);
    garde.push(d);
    for (let j = dr.debut[d]; j < dr.debut[d + 1]; j++) {
      let l = local.get(dr.ids[j]); if (l === undefined) { local.set(dr.ids[j], l = local.size); lAct.push([]); }
      const v = lAct[l]; if (!v.includes(ia)) v.push(ia);
    }
  }
  const G = local.size, f = new Float64Array(G);
  for (let l = 0; l < G; l++) f[l] = Math.pow(Math.log((acts.size + 1) / (lAct[l].length + 1)) + 1, gamma);
  const debut = new Int32Array(G + 1);
  for (const d of garde) for (let j = dr.debut[d]; j < dr.debut[d + 1]; j++) debut[local.get(dr.ids[j])! + 1]++;
  for (let l = 0; l < G; l++) debut[l + 1] += debut[l];
  const doc = new Int32Array(debut[G]), w = new Float64Array(debut[G]), pos = debut.slice(0, G), norme = new Float64Array(garde.length);
  garde.forEach((d, i) => {
    let nd = 0;
    for (let j = dr.debut[d]; j < dr.debut[d + 1]; j++) { const l = local.get(dr.ids[j])!, x = dr.w[j] * f[l]; nd += x * x; const k = pos[l]++; doc[k] = i; w[k] = x; }
    norme[i] = Math.sqrt(nd);
  });
  return { local, f, debut, doc, w, garde: Int32Array.from(garde), norme };
}

/**
 * Ce qui est gardé : par cœur d'index, pour un jeu de phrases retirées (un pli, ou aucun) et des réglages, l'index
 * re-pondéré et le modèle de chaque appli déjà candidate. Un autre pli remplace celui d'avant (la validation croisée les
 * parcourt l'un après l'autre) ; le jeu « aucune phrase retirée » reste.
 */
interface Garde { cle: string; exclu: Uint8Array | undefined; parAppli: Map<string, { sig: string; ia?: IndexAppli; m?: ModeleAction | null }> }

/**
 * Signature des paires de base vivantes de l'appli (relecture du tour 7, constat 1) : une correction refaite retire
 * l'ancienne paire ; ce qui a été fait avec elle (index, modèle) ne vaut plus et est refait sans elle, tout de suite.
 */
function signature(ix: IndexNgrammes, docs: number[]): string {
  let n = 0, h = 0x811c9dc5;
  for (const d of docs) if (d < ix.paires.length && ix.vivante(d)) { n++; h = Math.imul(h ^ d, 0x01000193) >>> 0; }
  return `${n}:${h}`;
}
const GARDES = new WeakMap<object, Garde[]>();
function gardeDe(ix: IndexNgrammes, cle: string, exclu: Uint8Array | undefined): Garde {
  let l = GARDES.get(ix.coeur); if (!l) GARDES.set(ix.coeur, l = []);
  let g = l.find((x) => x.cle === cle && x.exclu === exclu);
  if (!g) {
    g = { cle, exclu, parAppli: new Map() };
    // Garder le jeu « tout » et le pli courant seulement.
    const reste = l.filter((x) => x.exclu === undefined && x.cle === cle && exclu !== undefined);
    l.length = 0; l.push(...reste, g);
  }
  return g;
}

/**
 * L'action dans l'appli `appli` pour la requête `q` : la meilleure action et sa part, ou rien. `docs` : les paires de
 * l'appli (indices dans l'index, ajouts compris) ; `simAjout(d)` : la ressemblance d'une paire ajoutée après coup (une
 * correction du propriétaire), qui garde sa ressemblance simple et ne pèse pas dans le modèle avant une reconstruction.
 * `gamma` 0 : les voisins sans re-pondération ; `mu` 0 : sans modèle.
 */
export function choisirAction(
  ix: IndexNgrammes, appli: string, docs: number[], q: Map<string, number>, gamma: number, mu: number, o: OptionsAction,
  exclu: Uint8Array | undefined, simAjout: (d: number) => number, voisinsSimples: () => Map<string, number>,
): { action: string; part: number } | undefined {
  const g = gardeDe(ix, JSON.stringify([gamma, mu, o]), exclu);
  const sig = signature(ix, docs);
  let e = g.parAppli.get(appli); if (!e || e.sig !== sig) g.parAppli.set(appli, e = { sig });
  let vs: Map<string, number>;
  if (gamma > 0) {
    e.ia ??= indexAppli(ix, docs, gamma, exclu);
    vs = voisins(ix, e.ia, docs, q, simAjout);
  } else vs = voisinsSimples();
  let tv = 0; for (const x of vs.values()) tv += x;
  if (mu > 0 && e.m === undefined) e.m = apprendre(ix, docs, o, exclu) ?? null;
  const ps = mu > 0 && e.m ? probas(e.m, q, ix.coeur.vocab) : undefined;
  const noms = [...new Set([...vs.keys(), ...(ps?.keys() ?? [])])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  let best: string | null = null, s = 0, t = 0;
  for (const k of noms) { const x = (1 - (ps ? mu : 0)) * (tv > 0 ? (vs.get(k) ?? 0) / tv : 0) + (ps ? mu * (ps.get(k) ?? 0) : 0); t += x; if (x > s) { s = x; best = k; } }
  return best ? { action: best, part: t > 0 ? s / t : 0 } : undefined;
}

let ACC = new Float64Array(0);
/** Les voisins de la demande dans l'appli sur l'index re-pondéré : la somme des carrés des trois plus proches de chaque action. */
function voisins(ix: IndexNgrammes, X: IndexAppli, docs: number[], q: Map<string, number>, simAjout: (d: number) => number): Map<string, number> {
  const vocab = ix.coeur.vocab, nb = ix.paires.length;
  let nq = 0;
  if (ACC.length < X.garde.length) ACC = new Float64Array(X.garde.length);
  const acc = ACC, touches: number[] = [];
  for (const [g, wq] of q) {
    const id = vocab.get(g); const l = id === undefined ? undefined : X.local.get(id);
    const y = wq * (l === undefined ? 1 : X.f[l]); nq += y * y;
    if (l === undefined) continue;
    for (let k = X.debut[l]; k < X.debut[l + 1]; k++) { const i = X.doc[k]; if (acc[i] === 0) touches.push(i); acc[i] += X.w[k] * y; }
  }
  const rq = Math.sqrt(nq), parAction = new Map<string, number[]>();
  const pousser = (d: number, s: number) => { const p = ix.paire(d); const v = s * (p.poids ?? 1); const l = parAction.get(p.action!); if (l) l.push(v); else parAction.set(p.action!, [v]); };
  for (const i of touches) { const s = acc[i]; acc[i] = 0; if (s > 0) pousser(X.garde[i], s / (rq * X.norme[i])); }
  for (const d of docs) if (d >= nb && ix.paire(d).action) { const s = simAjout(d); if (s > 0) pousser(d, s); }
  const out = new Map<string, number>();
  for (const [act, l] of [...parAction.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) out.set(act, l.sort((x, y) => y - x).slice(0, 3).reduce((u, v) => u + v * v, 0));
  return out;
}

/** Ce qui doit entrer dans l'empreinte de la calibration : le code de ce calcul. */
export function codeDeAction(): string {
  return [direct, melange, apprendre, probas, indexAppli, signature, gardeDe, choisirAction, voisins].map((f) => f.toString()).join('\n');
}
