// Noûs — LE SECOND TEMPS DE L'AIGUILLEUR (Soul v3, tour 6).
//
// Le vote de l'aiguilleur (aiguilleur.ts) donne ses trois premières applis. Ce second temps les départage avec des traits
// qui les OPPOSENT entre elles, tirés de la seule matière d'Odin :
//   - un bayésien naïf (multinomial sur les poids des n-grammes, et « présence » sur le nombre de phrases) restreint aux
//     candidates : ce que deux applis ont en commun s'annule dans la différence, il ne reste que ce qui les sépare ;
//   - le même calcul par ACTION : une appli vaut par sa meilleure action ;
//   - le plus proche voisin et la somme des trois plus proches dans chaque candidate (appli et action) ;
//   - un modèle LOCAL appris sur-le-champ : une régression logistique entre ces seules candidates, sur leurs phrases de
//     la matière (classes équilibrées, quelques passes dans l'ordre des phrases : déterministe) ;
//   - la part de vote d'aujourd'hui et le rang.
// Les poids de ces traits sont appris par validation croisée SUR LA MATIÈRE (mêmes plis que la calibration : voir
// creerAiguilleurSync), jamais sur un banc. Aucune liste de mots, aucune langue privilégiée : seuls des n-grammes de
// caractères. Aucun poids n'est gardé dans le dépôt : tout se refait à partir de la matière, sur la machine.
import type { IndexNgrammes, Paire } from './aiguilleur.ts';

const HC = '∅';
/** Les réglages du second temps (lissages du bayésien naïf, passes et pas du modèle local, poids d'une demande). */
export interface OptionsReclasse { alpha: number; beta: number; tours: number; pasLocal: number; poidsDemande: number }
export const NOMS_TRAITS = ['part', 'premier', 'nbMulti', 'nbPresence', 'actMulti', 'actPresence', 'voisin1', 'voisins3', 'actVoisins3', 'local'] as const;
export const NB_TRAITS = NOMS_TRAITS.length;
/** Au plus ce nombre de candidates (les trois premières du vote). */
const CANDIDATES_MAX = 3;
/** Les poids appris (un par trait), avec la moyenne et l'écart des traits (mise à l'échelle). */
export interface ModeleReclasse { w: number[]; moy: number[]; ec: number[] }
export type TotauxReclasse = { nA: Float64Array; mA: Float64Array; nK: Float64Array; mK: Float64Array };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function inserer(t: number[], s: number): void { if (s > t[2]) { if (s > t[1]) { t[2] = t[1]; if (s > t[0]) { t[1] = t[0]; t[0] = s; } else t[1] = s; } else t[2] = s; } }

/** Ce qui ne dépend que de la matière (fait une fois par index, puis gardé). */
export class Reclasseur {
  readonly cles: string[]; readonly rang: Map<string, number>; readonly rangDe: Int32Array; readonly actDe: Int32Array; readonly actions: string[];
  readonly appliDeAct: Int32Array; readonly pd: Float64Array; readonly masseDoc: Float64Array; readonly actsDeAppli: number[][];
  readonly V: number;
  readonly ix: IndexNgrammes; readonly o: OptionsReclasse;
  private vocab: Map<string, number>; private debut: Int32Array; private postDoc: Int32Array | Uint16Array; private postPoids: Float32Array;
  private sim: Float64Array;
  /** Index direct (phrase → ses n-grammes) pour le modèle local, et les phrases de chaque appli. */
  private dDebut: Int32Array; private dIds: Int32Array; private dW: Float32Array; private docsDe: number[][];
  /** Rang de chaque appli parmi les candidates d'une demande (−1 : pas candidate), remis à −1 après usage. */
  private posA: Int32Array;
  /** Pour chaque action : candidate (−1 : aucune) et place dans ses actions, remis à −1 après usage. */
  private posKi: Int32Array; private posKj: Int32Array;
  /** Numéro local de chaque n-gramme pendant l'apprentissage du modèle local (−1 : hors de ses phrases), remis à −1 après. */
  private numLocal: Int32Array;

  constructor(ix: IndexNgrammes, o: OptionsReclasse) {
    this.ix = ix; this.o = o;
    const paires = ix.paires, N = paires.length;
    this.cles = [...new Set(paires.map((p) => p.appli ?? HC))].sort(cmp);
    this.rang = new Map(this.cles.map((a, i) => [a, i]));
    this.rangDe = Int32Array.from(paires.map((p) => this.rang.get(p.appli ?? HC)!));
    const actId = new Map<string, number>(); this.actions = [];
    this.actDe = Int32Array.from(paires.map((p) => {
      if (!p.appli || !p.action) return -1;
      const k = `${p.appli}.${p.action}`; let id = actId.get(k);
      if (id === undefined) { id = this.actions.length; actId.set(k, id); this.actions.push(k); }
      return id;
    }));
    this.appliDeAct = Int32Array.from(this.actions.map((k) => this.rang.get(k.slice(0, k.indexOf('.')))!));
    this.actsDeAppli = this.cles.map(() => []);
    this.actions.forEach((_, k) => this.actsDeAppli[this.appliDeAct[k]].push(k));
    this.pd = Float64Array.from(paires.map((p: Paire) => (p.poids ?? 1) * (p.demande ? o.poidsDemande : 1)));
    const c = ix.coeur; this.vocab = c.vocab; this.debut = c.debut; this.postDoc = c.postDoc; this.postPoids = c.postPoids; this.V = c.vocab.size;
    this.masseDoc = new Float64Array(N);
    for (let p = 0; p < this.postDoc.length; p++) this.masseDoc[this.postDoc[p]] += this.postPoids[p];
    this.sim = new Float64Array(N);
    this.dDebut = new Int32Array(N + 1);
    for (let p = 0; p < this.postDoc.length; p++) this.dDebut[this.postDoc[p] + 1]++;
    for (let d = 0; d < N; d++) this.dDebut[d + 1] += this.dDebut[d];
    this.dIds = new Int32Array(this.postDoc.length); this.dW = new Float32Array(this.postDoc.length);
    const pos = this.dDebut.slice(0, N);
    for (let g = 0; g + 1 < this.debut.length; g++) for (let p = this.debut[g]; p < this.debut[g + 1]; p++) { const d = this.postDoc[p], k = pos[d]++; this.dIds[k] = g; this.dW[k] = this.postPoids[p]; }
    this.docsDe = this.cles.map(() => [] as number[]);
    for (let d = 0; d < N; d++) this.docsDe[this.rangDe[d]].push(d);
    this.posA = new Int32Array(this.cles.length).fill(-1);
    this.posKi = new Int32Array(this.actions.length).fill(-1); this.posKj = new Int32Array(this.actions.length).fill(-1);
    this.numLocal = new Int32Array(this.V).fill(-1);
    // Chaque liste inversée vue rangée par appli (puis par phrase, l'ordre d'origine) : place de chaque entrée dans sa
    // liste. Le bayésien naïf ne parcourt plus que les phrases des candidates (mêmes sommes, dans le même ordre).
    const P = this.postDoc.length, nA = this.cles.length, compte = new Int32Array(nA + 1);
    this.parAppliPos = N <= 0xffff ? new Uint16Array(P) : new Int32Array(P);
    for (let g = 0; g + 1 < this.debut.length; g++) {
      const p0 = this.debut[g], p1 = this.debut[g + 1];
      compte.fill(0);
      for (let p = p0; p < p1; p++) compte[this.rangDe[this.postDoc[p]] + 1]++;
      for (let a = 0; a < nA; a++) compte[a + 1] += compte[a];
      for (let p = p0; p < p1; p++) this.parAppliPos[p0 + compte[this.rangDe[this.postDoc[p]]]++] = p - p0;
    }
  }
  /** Pour chaque liste inversée : ses entrées rangées par appli puis par phrase (place de l'entrée dans la liste d'origine). */
  private parAppliPos: Uint16Array | Int32Array;
  /** Première place (entre `lo` et `hi`, dans la liste rangée par appli qui commence à `p0`) dont l'appli a un rang ≥ `a`. */
  private borne(p0: number, lo: number, hi: number, a: number): number {
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.rangDe[this.postDoc[p0 + this.parAppliPos[m]]] < a) lo = m + 1; else hi = m; }
    return lo;
  }

  /**
   * Le modèle LOCAL : une régression logistique à plusieurs classes apprise sur-le-champ entre les seules candidates
   * (leurs phrases de la matière, classes équilibrées, descente de gradient dans l'ordre des phrases : déterministe). Ses
   * poids ne retiennent que ce qui sépare ces applis-là. Rend le score de chaque candidate pour la demande.
   */
  local(q: Map<string, number>, sA: number[], exclu?: Uint8Array): number[] {
    return this.localPour([q], sA, exclu)[0];
  }

  /**
   * Le modèle local, appris UNE fois pour ces candidates (dans cet ordre) et ces phrases retirées, puis noté pour chaque
   * demande de `qs`. Il ne dépend que des candidates et des phrases retirées, jamais de la demande : chaque note est
   * exactement celle que `local` rendrait pour cette demande seule (mêmes opérations, dans le même ordre).
   * Les poids sont rangés par n-gramme (ceux des candidates côte à côte) et seuls les n-grammes de leurs phrases ont une
   * place : même calcul, moins de mémoire parcourue.
   */
  localPour(qs: Array<Map<string, number>>, sA: number[], exclu?: Uint8Array): number[][] {
    const nS = sA.length, b = new Float64Array(nS);
    // Les phrases des candidates (sans les retirées), dans l'ordre des phrases : les listes de chaque appli sont déjà dans
    // cet ordre, on les fusionne.
    const listes = sA.map((a) => this.docsDe[a]), curs = new Int32Array(nS);
    const nC = new Float64Array(nS);
    let total = 0; for (const l of listes) total += l.length;
    const docD = new Int32Array(total), docY = new Int32Array(total);
    let nD = 0;
    for (;;) {
      let c = -1, dm = Infinity;
      for (let j = 0; j < nS; j++) if (curs[j] < listes[j].length && listes[j][curs[j]] < dm) { dm = listes[j][curs[j]]; c = j; }
      if (c < 0) break;
      curs[c]++;
      if (exclu && exclu[dm]) continue;
      docD[nD] = dm; docY[nD] = c; nD++; nC[c]++;
    }
    const moyen = nD / nS;
    // Le poids de chaque phrase (le même à chaque passe : même expression, mêmes nombres).
    const wD = new Float64Array(nD);
    for (let i = 0; i < nD; i++) wD[i] = moyen / nC[docY[i]] * this.pd[docD[i]];
    // Numéros locaux des n-grammes des phrases apprises, et leurs listes (début de chaque phrase dans `nums`).
    const num = this.numLocal, grammes: number[] = [];
    const debutD = new Int32Array(nD + 1);
    for (let i = 0; i < nD; i++) { const d = docD[i]; debutD[i + 1] = debutD[i] + this.dDebut[d + 1] - this.dDebut[d]; }
    const nums = new Int32Array(debutD[nD]), poids = new Float64Array(debutD[nD]);
    for (let i = 0, p = 0; i < nD; i++) {
      const d = docD[i];
      for (let k = this.dDebut[d]; k < this.dDebut[d + 1]; k++, p++) {
        const g = this.dIds[k]; let l = num[g];
        if (l < 0) { l = num[g] = grammes.length; grammes.push(g); }
        // (un float32 tient exactement dans un double : mêmes valeurs que dW)
        nums[p] = l * nS; poids[p] = this.dW[k];
      }
    }
    const W = new Float64Array(grammes.length * nS);
    const lr = this.o.pasLocal, z = new Float64Array(nS), e = new Float64Array(nS);
    for (let t = 0; t < this.o.tours; t++) for (let i = 0; i < nD; i++) {
      const y = docY[i], w = wD[i];
      const k0 = debutD[i], k1 = debutD[i + 1];
      // Chaque z[c] est la même somme, dans le même ordre des n-grammes, que dans le calcul classe par classe.
      if (nS === 3) { let z0 = b[0], z1 = b[1], z2 = b[2]; for (let k = k0; k < k1; k++) { const o = nums[k], x = poids[k]; z0 += W[o] * x; z1 += W[o + 1] * x; z2 += W[o + 2] * x; } z[0] = z0; z[1] = z1; z[2] = z2; }
      else if (nS === 2) { let z0 = b[0], z1 = b[1]; for (let k = k0; k < k1; k++) { const o = nums[k], x = poids[k]; z0 += W[o] * x; z1 += W[o + 1] * x; } z[0] = z0; z[1] = z1; }
      else { for (let c = 0; c < nS; c++) z[c] = b[c]; for (let k = k0; k < k1; k++) { const o = nums[k], x = poids[k]; for (let c = 0; c < nS; c++) z[c] += W[o + c] * x; } }
      let mx = -Infinity; for (let c = 0; c < nS; c++) if (z[c] > mx) mx = z[c];
      let se = 0; for (let c = 0; c < nS; c++) { z[c] = Math.exp(z[c] - mx); se += z[c]; }
      let actifs = 0;
      for (let c = 0; c < nS; c++) {
        e[c] = (z[c] / se - (c === y ? 1 : 0)) * w * lr;
        if (e[c] === 0) continue;
        b[c] -= e[c] * 0.1; actifs++;
      }
      if (!actifs) continue;
      // Chaque poids ne reçoit qu'une mise à jour par phrase et par candidate : l'ordre des boucles ne change rien.
      // Une candidate dont l'écart est nul n'est pas touchée (comme avant : un zéro signé ne change jamais de signe).
      if (nS === 3 && e[0] !== 0 && e[1] !== 0 && e[2] !== 0) { const e0 = e[0], e1 = e[1], e2 = e[2]; for (let k = k0; k < k1; k++) { const o = nums[k], x = poids[k]; W[o] -= e0 * x; W[o + 1] -= e1 * x; W[o + 2] -= e2 * x; } }
      else if (nS === 2 && e[0] !== 0 && e[1] !== 0) { const e0 = e[0], e1 = e[1]; for (let k = k0; k < k1; k++) { const o = nums[k], x = poids[k]; W[o] -= e0 * x; W[o + 1] -= e1 * x; } }
      else for (let c = 0; c < nS; c++) { const ec = e[c]; if (ec === 0) continue; for (let k = k0; k < k1; k++) W[nums[k] + c] -= ec * poids[k]; }
    }
    const outs = qs.map((q) => {
      const out = new Array<number>(nS).fill(0);
      // Un n-gramme hors des phrases apprises a un poids nul : l'ajouter ne changerait rien (0 + 0 reste 0, x + 0 reste x).
      for (const [g, wq] of q) { const id = this.vocab.get(g); if (id === undefined) continue; const l = num[id]; if (l < 0) continue; for (let c = 0; c < nS; c++) out[c] += W[l * nS + c] * wq; }
      for (let c = 0; c < nS; c++) out[c] += b[c];
      return out;
    });
    for (const g of grammes) num[g] = -1;
    return outs;
  }

  /** Tailles (nombre de phrases pondéré) et masses par appli et par action, sans les phrases exclues. */
  totaux(exclu?: Uint8Array): TotauxReclasse {
    const nA = new Float64Array(this.cles.length), mA = new Float64Array(this.cles.length), nK = new Float64Array(this.actions.length), mK = new Float64Array(this.actions.length);
    for (let d = 0; d < this.rangDe.length; d++) {
      if (exclu && exclu[d]) continue;
      const a = this.rangDe[d], w = this.pd[d];
      nA[a] += w; mA[a] += w * this.masseDoc[d];
      const k = this.actDe[d]; if (k >= 0) { nK[k] += w; mK[k] += w * this.masseDoc[d]; }
    }
    return { nA, mA, nK, mK };
  }

  /**
   * Les traits de chaque candidate (applis du champ, dans l'ordre du vote) pour une demande. `parts` : la part de vote de
   * chaque candidate. Traits relatifs : chacun moins la moyenne des candidates (seul compte ce qui les oppose).
   */
  traits(texte: string, S: string[], parts: number[], tot: TotauxReclasse, exclu?: Uint8Array): number[][] {
    return this.traitsLot([{ texte, S, parts }], tot, exclu)[0];
  }

  /**
   * Les traits de plusieurs demandes, avec les MÊMES phrases retirées (un pli de la validation croisée) : exactement ce
   * que `traits` rend pour chacune, dans l'ordre. Le modèle local, qui ne dépend que des candidates (dans leur ordre) et
   * des phrases retirées, n'est appris qu'une fois pour toutes les demandes qui ont les mêmes candidates.
   */
  traitsLot(lot: Array<{ texte: string; S: string[]; parts: number[] }>, tot: TotauxReclasse, exclu?: Uint8Array): number[][][] {
    const prets = lot.map((x) => this.sansLocal(x.texte, x.S, x.parts, tot, exclu));
    const locaux: Array<number[] | undefined> = prets.map(() => undefined);
    if (this.o.tours !== 0) {
      // Les demandes groupées par candidates (ordre de première apparition : le résultat n'en dépend pas).
      const groupes = new Map<string, number[]>();
      prets.forEach((p, i) => { if (!p) return; const k = p.sA.join(','); const g = groupes.get(k); if (g) g.push(i); else groupes.set(k, [i]); });
      for (const ids of groupes.values()) {
        const notes = this.localPour(ids.map((i) => prets[i]!.q), prets[ids[0]]!.sA, exclu);
        ids.forEach((i, j) => { locaux[i] = notes[j]; });
      }
    }
    return prets.map((p, i) => (p ? p.finir(locaux[i] ?? p.sA.map(() => 0)) : []));
  }

  /** Tout le calcul des traits d'une demande sauf le modèle local ; `finir` y ajoute ses notes et centre les traits. */
  private sansLocal(texte: string, S: string[], parts: number[], tot: TotauxReclasse, exclu?: Uint8Array): { q: Map<string, number>; sA: number[]; finir(loc: number[]): number[][] } | undefined {
    const o = this.o, q = this.ix.vecteur(texte);
    const sA = S.map((a) => this.rang.get(a) ?? -1);
    if (sA.some((a) => a < 0)) return undefined;
    const nS = S.length;
    const acts = sA.map((a) => this.actsDeAppli[a]);
    // Place de chaque candidate et de chacune de ses actions (tableaux remis à −1 à la fin : mêmes réponses qu'une table).
    const posA = this.posA, posKi = this.posKi, posKj = this.posKj;
    sA.forEach((a, i) => { posA[a] = i; });
    acts.forEach((l, i) => l.forEach((k, j) => { posKi[k] = i; posKj[k] = j; }));
    // Bayésien naïf : L = Σ_g wq·log((m(g)+α)/(M+αV)) = W·log(α/(M+αV)) + Σ_{m(g)>0} wq·(log(m(g)+α) − log α).
    let W = 0;
    const LmA = new Float64Array(nS), LbA = new Float64Array(nS);
    const LmK = acts.map((l) => new Float64Array(l.length)), LbK = acts.map((l) => new Float64Array(l.length));
    const mG = new Float64Array(nS), cG = new Float64Array(nS);
    const mGK = acts.map((l) => new Float64Array(l.length)), cGK = acts.map((l) => new Float64Array(l.length));
    const touchesK: Array<[number, number]> = [], touchesD: number[] = [];
    const { alpha, beta } = o;
    for (const [g, wq] of q) {
      const id = this.vocab.get(g); if (id === undefined) continue;
      W += wq;
      // Seules les entrées des candidates, chacune dans l'ordre des phrases : chaque somme reçoit les mêmes termes dans
      // le même ordre que dans un parcours de toute la liste (l'ordre des lots touchés, lui, ne compte pas).
      const p0 = this.debut[id], p1 = this.debut[id + 1];
      for (let i = 0; i < nS; i++) {
        const lo = this.borne(p0, p0, p1, sA[i]), hi = this.borne(p0, lo, p1, sA[i] + 1);
        for (let x = lo; x < hi; x++) {
          const p = p0 + this.parAppliPos[x], d = this.postDoc[p]; if (exclu && exclu[d]) continue;
          const w = this.postPoids[p], pdd = this.pd[d];
          if (this.sim[d] === 0) touchesD.push(d);
          this.sim[d] += wq * w;
          mG[i] += pdd * w; cG[i] += pdd;
          const k = this.actDe[d];
          if (k >= 0) { const ii = posKi[k], j = posKj[k]; if (mGK[ii][j] === 0 && cGK[ii][j] === 0) touchesK.push([ii, j]); mGK[ii][j] += pdd * w; cGK[ii][j] += pdd; }
        }
      }
      for (let i = 0; i < nS; i++) if (cG[i] > 0) { LmA[i] += wq * (Math.log(mG[i] + alpha) - Math.log(alpha)); LbA[i] += wq * (Math.log(cG[i] + beta) - Math.log(beta)); mG[i] = 0; cG[i] = 0; }
      for (const [i, j] of touchesK) { LmK[i][j] += wq * (Math.log(mGK[i][j] + alpha) - Math.log(alpha)); LbK[i][j] += wq * (Math.log(cGK[i][j] + beta) - Math.log(beta)); mGK[i][j] = 0; cGK[i][j] = 0; }
      touchesK.length = 0;
    }
    const V = this.V, Wn = W > 0 ? W : 1;
    for (let i = 0; i < nS; i++) {
      const a = sA[i];
      LmA[i] = (LmA[i] + W * Math.log(alpha / (tot.mA[a] + alpha * V))) / Wn;
      LbA[i] = (LbA[i] + W * Math.log(beta / (tot.nA[a] + 2 * beta))) / Wn;
      acts[i].forEach((k, j) => {
        LmK[i][j] = tot.mK[k] > 0 ? (LmK[i][j] + W * Math.log(alpha / (tot.mK[k] + alpha * V))) / Wn : -Infinity;
        LbK[i][j] = tot.nK[k] > 0 ? (LbK[i][j] + W * Math.log(beta / (tot.nK[k] + 2 * beta))) / Wn : -Infinity;
      });
    }
    // Voisins : le plus proche, la somme des carrés des trois plus proches (appli), et par action.
    const top = sA.map(() => [0, 0, 0]);
    const topK = acts.map((l) => l.map(() => [0, 0, 0]));
    for (const d of touchesD) {
      const s = this.sim[d]; this.sim[d] = 0; if (s <= 0) continue;
      const i = posA[this.rangDe[d]]; inserer(top[i], s);
      const k = this.actDe[d]; if (k >= 0) inserer(topK[posKi[k]][posKj[k]], s);
    }
    sA.forEach((a) => { posA[a] = -1; });
    acts.forEach((l) => l.forEach((k) => { posKi[k] = -1; posKj[k] = -1; }));
    const finir = (loc: number[]): number[][] => {
      const X: number[][] = [];
      for (let i = 0; i < nS; i++) {
        let bm = -Infinity, bb = -Infinity, bv = 0;
        acts[i].forEach((k, j) => { if (LmK[i][j] > bm) bm = LmK[i][j]; if (LbK[i][j] > bb) bb = LbK[i][j]; const v = topK[i][j].reduce((u, x) => u + x * x, 0); if (v > bv) bv = v; });
        if (bm === -Infinity) bm = LmA[i]; if (bb === -Infinity) bb = LbA[i];
        X.push([parts[i], i === 0 ? 1 : 0, LmA[i], LbA[i], bm, bb, top[i][0], top[i].reduce((u, x) => u + x * x, 0), bv, loc[i]]);
      }
      for (let j = 0; j < NB_TRAITS; j++) { let m = 0; for (const x of X) m += x[j]; m /= nS; for (const x of X) x[j] -= m; }
      return X;
    };
    return { q, sA, finir };
  }
}

/**
 * Logit conditionnel sur les candidates : P(i) ∝ exp(w·x_i), traits mis à l'échelle (moyenne, écart). Descente de
 * gradient déterministe (toujours le même ordre des cas), petite pénalité L2. `y` : rang de la bonne appli parmi les
 * candidates.
 */
export function ajusterReclasse(cas: Array<{ X: number[][]; y: number }>, tours = 600, pas = 0.5, l2 = 1e-3): ModeleReclasse {
  const d = NB_TRAITS, moy = new Array<number>(d).fill(0), ec = new Array<number>(d).fill(0); let n = 0;
  for (const c of cas) for (const x of c.X) { n++; for (let j = 0; j < d; j++) moy[j] += x[j]; }
  for (let j = 0; j < d; j++) moy[j] /= Math.max(1, n);
  for (const c of cas) for (const x of c.X) for (let j = 0; j < d; j++) ec[j] += (x[j] - moy[j]) ** 2;
  for (let j = 0; j < d; j++) ec[j] = Math.sqrt(ec[j] / Math.max(1, n)) || 1;
  const Z = cas.map((c) => c.X.map((x) => x.map((v, j) => (v - moy[j]) / ec[j])));
  const w = new Array<number>(d).fill(0);
  for (let t = 0; t < tours; t++) {
    const g = new Array<number>(d).fill(0); let sp = 0;
    for (let c = 0; c < cas.length; c++) {
      sp += 1;
      const z = Z[c], s = z.map((x) => x.reduce((u, v, j) => u + v * w[j], 0)), mx = Math.max(...s), e = s.map((v) => Math.exp(v - mx)), se = e.reduce((u, v) => u + v, 0);
      for (let i = 0; i < z.length; i++) { const p = e[i] / se - (i === cas[c].y ? 1 : 0); for (let j = 0; j < d; j++) g[j] += p * z[i][j]; }
    }
    for (let j = 0; j < d; j++) w[j] -= pas * (g[j] / Math.max(1, sp) + l2 * w[j]);
  }
  return { w, moy, ec };
}

/** La note de chaque candidate (plus haute : meilleure). */
export function noterReclasse(m: ModeleReclasse, X: number[][]): number[] {
  return X.map((x) => x.reduce((u, v, j) => u + ((v - m.moy[j]) / m.ec[j]) * m.w[j], 0));
}

/**
 * Le nouvel ordre des candidates : la meilleure note passe en tête seulement si elle dépasse celle de la première d'au
 * moins `marge` ; les suivantes sont rangées par note (à égalité, l'ordre du vote). Rend les rangs, dans l'ordre.
 */
export function ordreReclasse(notes: number[], marge: number): number[] {
  const o = notes.map((_, i) => i).sort((a, b) => notes[b] - notes[a] || a - b);
  if (o[0] !== 0 && notes[o[0]] - notes[0] < marge) return notes.map((_, i) => i);
  return o;
}

/** Le texte du code du second temps (pour l'empreinte de la calibration : un changement la refait). */
export function codeDuReclasse(): string {
  return [Reclasseur.toString(), ajusterReclasse.toString(), noterReclasse.toString(), ordreReclasse.toString(), inserer.toString(), JSON.stringify(NOMS_TRAITS), CANDIDATES_MAX].join('\n\u0001\n');
}
