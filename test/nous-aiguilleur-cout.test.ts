// L'aiguilleur, tour 6 : le second temps (src/brain/nous/reclasse.ts) rendu moins coûteux SANS changer un seul nombre.
// Chaque nombre du calcul rapide est comparé (Object.is : signe du zéro compris) à celui du calcul du tour 6 tel qu'il a
// été figé, recopié ici comme référence (calculTour6, plus bas) : modèle local appris pour chaque demande, parcours de
// listes inversées entières, tables d'association. Applis d'essai, sans la matière du dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORS_CHAMP, IndexNgrammes, PREFERENCES, REGLAGES, exempleReclasse, exemplesReclasse, matiere, validationCroisee, type ModuleMatiere, type Paire,
} from '../src/brain/nous/aiguilleur.ts';
import { NB_TRAITS, Reclasseur, type TotauxReclasse } from '../src/brain/nous/reclasse.ts';

const MODULES: ModuleMatiere[] = [
  { id: 'lyre_c', name: 'Lyre', what: 'écouter de la musique', does: ['joue la musique que tu aimes', 'plays the music you like'], words: ['musique', 'chanson', 'music', 'song', '音楽', '音乐', 'музыка', 'موسيقى', 'संगीत'],
    actions: [{ id: 'jouer', label: 'Jouer', what: 'joue un morceau', words: ['joue', 'play', '再生', '播放', 'включи'] }, { id: 'pause', label: 'Pause', what: 'met la musique en pause', words: ['pause', 'stop the music'] }] },
  { id: 'rempart_c', name: 'Rempart', what: 'le pare-feu qui bloque ou autorise des sites', does: ['bloque les sites dangereux', 'blocks dangerous websites'], words: ['pare-feu', 'firewall', 'bloquer un site', 'ファイアウォール', '防火墙'],
    actions: [{ id: 'bloquer', label: 'Bloquer', what: 'bloque un site', words: ['bloque', 'block', 'ブロック', '封锁'] }, { id: 'ouvrir', label: 'Autoriser', what: 'autorise un site', words: ['autorise', 'allow', 'разреши'] }] },
  { id: 'carnet_c', name: 'Carnet', what: 'tes notes', does: ['garde tes notes et tes idées', 'keeps your notes and ideas'], words: ['note', 'notes', 'memo', 'メモ', '笔记', 'заметка'],
    actions: [{ id: 'noter', label: 'Noter', what: 'écrit une note', words: ['note ça', 'write down', 'メモして', '记下'] }] },
  { id: 'ciel_c', name: 'Ciel', what: 'la météo et les prévisions', does: ['dit quel temps il fera demain', 'tells what the weather will be like'], words: ['météo', 'weather', '天気', '天气', 'погода', 'الطقس', 'मौसम'],
    actions: [{ id: 'prevoir', label: 'Prévisions', what: 'les prévisions des jours qui viennent', words: ['prévisions', 'forecast', '天気予報', '天气预报'] }] },
  { id: 'voile_c', name: 'Voile', what: 'les trajets et les cartes', does: ['trouve le chemin le plus court', 'finds the shortest way'], words: ['trajet', 'carte', 'route', 'map', '地図', '地图', 'маршрут'],
    actions: [{ id: 'aller', label: 'Itinéraire', what: 'un itinéraire jusqu\'à un lieu', words: ['aller à', 'go to', '行く', '去'] }] },
];

/** La matière d'essai : les définitions des applis, et des demandes faites de leurs mots (plusieurs écritures), « pas encore » compris. */
function paires(): Paire[] {
  const out = matiere(MODULES);
  // Des poids différents et sans écriture binaire exacte (1, 1,13, 1,26… 1,78) : une somme faite dans un autre ordre (par
  // exemple une liste parcourue à l'envers) change au dernier chiffre, et l'essai le voit.
  let n = 0;
  for (const m of MODULES) for (const a of m.actions) for (const v of a.words ?? []) for (const w of m.words ?? []) out.push({ texte: `${v} ${w}`, appli: m.id, action: a.id, source: `essai:${m.id}`, poids: 1 + (n++ % 7) * 0.13, demande: true });
  for (const t of ['commande une pizza', 'order a taxi', 'ピザを注文して', '订一张机票', 'закажи такси', 'réserve une table au restaurant']) out.push({ texte: t, appli: null, action: null, source: 'essai:pas-encore', poids: 1, demande: true });
  return out;
}

/**
 * Le calcul du second temps tel que le tour 6 l'a figé (avant ce lot) : recopié de reclasse.ts, sur les mêmes données que
 * le Reclasseur (rien de privé : tout est refait à partir de l'index). C'est la référence des nombres.
 */
function calculTour6(rc: Reclasseur, texte: string, S: string[], parts: number[], tot: TotauxReclasse, exclu?: Uint8Array): number[][] {
  const ix = rc.ix, o = rc.o, c = ix.coeur, N = ix.paires.length, vocab = c.vocab, debut = c.debut, postDoc = c.postDoc, postPoids = c.postPoids;
  const dDebut = new Int32Array(N + 1);
  for (let p = 0; p < postDoc.length; p++) dDebut[postDoc[p] + 1]++;
  for (let d = 0; d < N; d++) dDebut[d + 1] += dDebut[d];
  const dIds = new Int32Array(postDoc.length), dW = new Float32Array(postDoc.length), place = dDebut.slice(0, N);
  for (let g = 0; g + 1 < debut.length; g++) for (let p = debut[g]; p < debut[g + 1]; p++) { const d = postDoc[p], k = place[d]++; dIds[k] = g; dW[k] = postPoids[p]; }
  const docsDe = rc.cles.map(() => [] as number[]);
  for (let d = 0; d < N; d++) docsDe[rc.rangDe[d]].push(d);
  const inserer = (t: number[], s: number): void => { if (s > t[2]) { if (s > t[1]) { t[2] = t[1]; if (s > t[0]) { t[1] = t[0]; t[0] = s; } else t[1] = s; } else t[2] = s; } };
  const local = (q: Map<string, number>, sA: number[]): number[] => {
    const nS = sA.length, W = sA.map(() => new Float64Array(rc.V)), b = new Float64Array(nS);
    const docs: Array<[number, number]> = [];
    sA.forEach((a, k) => { for (const d of docsDe[a]) if (!(exclu && exclu[d])) docs.push([d, k]); });
    const nC = new Float64Array(nS); for (const [, k] of docs) nC[k]++;
    const moyen = docs.length / nS;
    docs.sort((x, y) => x[0] - y[0]);
    const lr = o.pasLocal, z = new Float64Array(nS);
    for (let t = 0; t < o.tours; t++) for (const [d, y] of docs) {
      const w = moyen / nC[y] * rc.pd[d];
      for (let k = 0; k < nS; k++) { let s = b[k]; const Wc = W[k]; for (let j = dDebut[d]; j < dDebut[d + 1]; j++) s += Wc[dIds[j]] * dW[j]; z[k] = s; }
      let mx = -Infinity; for (let k = 0; k < nS; k++) if (z[k] > mx) mx = z[k];
      let se = 0; for (let k = 0; k < nS; k++) { z[k] = Math.exp(z[k] - mx); se += z[k]; }
      for (let k = 0; k < nS; k++) {
        const e = (z[k] / se - (k === y ? 1 : 0)) * w * lr; if (e === 0) continue;
        b[k] -= e * 0.1; const Wc = W[k];
        for (let j = dDebut[d]; j < dDebut[d + 1]; j++) Wc[dIds[j]] -= e * dW[j];
      }
    }
    const out = new Array<number>(nS).fill(0);
    for (const [g, wq] of q) { const id = vocab.get(g); if (id === undefined) continue; for (let k = 0; k < nS; k++) out[k] += W[k][id] * wq; }
    for (let k = 0; k < nS; k++) out[k] += b[k];
    return out;
  };
  const q = ix.vecteur(texte);
  const sA = S.map((a) => rc.rang.get(a) ?? -1);
  if (sA.some((a) => a < 0)) return [];
  const pos = new Map(sA.map((a, i) => [a, i])), nS = S.length;
  const acts = sA.map((a) => rc.actsDeAppli[a]);
  const posAct = new Map<number, [number, number]>(); acts.forEach((l, i) => l.forEach((k, j) => posAct.set(k, [i, j])));
  let W = 0;
  const LmA = new Float64Array(nS), LbA = new Float64Array(nS);
  const LmK = acts.map((l) => new Float64Array(l.length)), LbK = acts.map((l) => new Float64Array(l.length));
  const mG = new Float64Array(nS), cG = new Float64Array(nS);
  const mGK = acts.map((l) => new Float64Array(l.length)), cGK = acts.map((l) => new Float64Array(l.length));
  const touchesK: Array<[number, number]> = [], touchesD: number[] = [], sim = new Float64Array(N);
  const { alpha, beta } = o;
  for (const [g, wq] of q) {
    const id = vocab.get(g); if (id === undefined) continue;
    W += wq;
    for (let p = debut[id], fin = debut[id + 1]; p < fin; p++) {
      const d = postDoc[p]; if (exclu && exclu[d]) continue;
      const i = pos.get(rc.rangDe[d]); if (i === undefined) continue;
      const w = postPoids[p], pdd = rc.pd[d];
      if (sim[d] === 0) touchesD.push(d);
      sim[d] += wq * w;
      mG[i] += pdd * w; cG[i] += pdd;
      const k = rc.actDe[d];
      if (k >= 0) { const [ii, j] = posAct.get(k)!; if (mGK[ii][j] === 0 && cGK[ii][j] === 0) touchesK.push([ii, j]); mGK[ii][j] += pdd * w; cGK[ii][j] += pdd; }
    }
    for (let i = 0; i < nS; i++) if (cG[i] > 0) { LmA[i] += wq * (Math.log(mG[i] + alpha) - Math.log(alpha)); LbA[i] += wq * (Math.log(cG[i] + beta) - Math.log(beta)); mG[i] = 0; cG[i] = 0; }
    for (const [i, j] of touchesK) { LmK[i][j] += wq * (Math.log(mGK[i][j] + alpha) - Math.log(alpha)); LbK[i][j] += wq * (Math.log(cGK[i][j] + beta) - Math.log(beta)); mGK[i][j] = 0; cGK[i][j] = 0; }
    touchesK.length = 0;
  }
  const V = rc.V, Wn = W > 0 ? W : 1;
  for (let i = 0; i < nS; i++) {
    const a = sA[i];
    LmA[i] = (LmA[i] + W * Math.log(alpha / (tot.mA[a] + alpha * V))) / Wn;
    LbA[i] = (LbA[i] + W * Math.log(beta / (tot.nA[a] + 2 * beta))) / Wn;
    acts[i].forEach((k, j) => {
      LmK[i][j] = tot.mK[k] > 0 ? (LmK[i][j] + W * Math.log(alpha / (tot.mK[k] + alpha * V))) / Wn : -Infinity;
      LbK[i][j] = tot.nK[k] > 0 ? (LbK[i][j] + W * Math.log(beta / (tot.nK[k] + 2 * beta))) / Wn : -Infinity;
    });
  }
  const top = sA.map(() => [0, 0, 0]);
  const topK = acts.map((l) => l.map(() => [0, 0, 0]));
  for (const d of touchesD) {
    const s = sim[d]; if (s <= 0) continue;
    const i = pos.get(rc.rangDe[d])!; inserer(top[i], s);
    const k = rc.actDe[d]; if (k >= 0) { const [ii, j] = posAct.get(k)!; inserer(topK[ii][j], s); }
  }
  const loc = o.tours === 0 ? sA.map(() => 0) : local(q, sA);
  const X: number[][] = [];
  for (let i = 0; i < nS; i++) {
    let bm = -Infinity, bb = -Infinity, bv = 0;
    acts[i].forEach((k, j) => { if (LmK[i][j] > bm) bm = LmK[i][j]; if (LbK[i][j] > bb) bb = LbK[i][j]; const v = topK[i][j].reduce((u, x) => u + x * x, 0); if (v > bv) bv = v; });
    if (bm === -Infinity) bm = LmA[i]; if (bb === -Infinity) bb = LbA[i];
    X.push([parts[i], i === 0 ? 1 : 0, LmA[i], LbA[i], bm, bb, top[i][0], top[i].reduce((u, x) => u + x * x, 0), bv, loc[i]]);
  }
  for (let j = 0; j < NB_TRAITS; j++) { let m = 0; for (const x of X) m += x[j]; m /= nS; for (const x of X) x[j] -= m; }
  return X;
}

/** Les mêmes nombres, au dernier chiffre près (Object.is : NaN, −0 et +0 compris). */
function memesNombres(a: number[][], b: number[][], quoi: string): void {
  assert.equal(a.length, b.length, `${quoi} : nombre de candidates`);
  a.forEach((x, i) => { assert.equal(x.length, b[i].length, quoi); x.forEach((v, j) => assert.ok(Object.is(v, b[i][j]), `${quoi} : candidate ${i}, trait ${j} : ${v} ≠ ${b[i][j]}`)); });
}

const R = { ...REGLAGES, poidsMots: 0 };
const options = (tours: number) => ({ alpha: R.reclasseAlpha, beta: R.reclasseBeta, tours, pasLocal: 1, poidsDemande: R.poidsDemande });
const DEMANDES = ['joue une chanson', 'bloque ce site', 'note ça pour demain', 'quel temps demain', '播放音乐', 'погода завтра', 'go to the map', 'autorise ce site dangereux',
  'メモして 天気', 'stop the music and write down', 'الطقس موسيقى', 'trajet météo musique', 'zzz inconnu'];

test('second temps rapide : chaque trait, modèle local compris, est exactement celui du calcul figé du tour 6', () => {
  const ps = paires(), ix = new IndexNgrammes(ps, R);
  for (const tours of [R.reclasseTours, 0]) {
    const rc = new Reclasseur(ix, options(tours));
    const applis = rc.cles.filter((a) => a !== HORS_CHAMP);
    // Des phrases retirées (comme un pli de la validation croisée), ou aucune.
    for (const exclu of [undefined, Uint8Array.from(ps, (_, i) => (i % 3 === 1 ? 1 : 0)), Uint8Array.from(ps, (p) => (p.demande ? 1 : 0))]) {
      const tot = rc.totaux(exclu);
      let n = 0;
      // Deux, trois et quatre candidates (le chemin général), dans plusieurs ordres.
      for (let k = 0; k < applis.length; k++) for (const nS of [2, 3, 4]) {
        const S = Array.from({ length: nS }, (_, j) => applis[(k + j * 2) % applis.length]);
        if (new Set(S).size < nS) continue;
        const parts = S.map((_, j) => 1 / (j + 2));
        const lot = DEMANDES.map((texte) => ({ texte, S, parts }));
        const rapides = rc.traitsLot(lot, tot, exclu);
        DEMANDES.forEach((texte, i) => {
          const ref = calculTour6(rc, texte, S, parts, tot, exclu);
          memesNombres(rc.traits(texte, S, parts, tot, exclu), ref, `${texte} [${S}] seule`);
          memesNombres(rapides[i], ref, `${texte} [${S}] en lot`);
          n++;
        });
      }
      assert.ok(n >= 100, `${n} demandes comparées`);
    }
    // Une candidate inconnue : rien, comme avant.
    assert.deepEqual(rc.traits('joue une chanson', ['lyre_c', 'inconnue_c'], [0.6, 0.4], rc.totaux()), []);
  }
});

test('second temps rapide : les exemples d\'un pli (en lot, et repris d\'un partage) sont ceux que l\'on tire un par un', () => {
  const ps = paires(), ix = new IndexNgrammes(ps, R), rc = new Reclasseur(ix, options(R.reclasseTours));
  const parAppli = new Map<string, number[]>();
  ps.forEach((p, i) => { const k = p.appli ?? HORS_CHAMP; (parAppli.get(k) ?? parAppli.set(k, []).get(k)!).push(i); });
  const table = new Map<string, number[][]>();
  let plis = 0, exemples = 0;
  validationCroisee(ix, parAppli, undefined, 5, undefined, PREFERENCES, (exclu, l) => {
    const tot = rc.totaux(exclu), cas = l.map(({ i, cas: c }) => ({ p: ix.paires[i], vote: c.vote }));
    const unParUn = cas.map((c) => exempleReclasse(rc, c.p, c.vote, tot, exclu)).filter((e) => e !== undefined);
    const enLot = exemplesReclasse(rc, cas, tot, exclu);
    // Le partage (essais) : la première fois tout est calculé, la seconde tout est repris ; les mêmes nombres.
    const cle = `pli ${plis}`;
    const partage1 = exemplesReclasse(rc, cas, tot, exclu, { cle, table }), taille = table.size;
    const partage2 = exemplesReclasse(rc, cas, tot, exclu, { cle, table });
    assert.equal(table.size, taille, 'rien de recalculé pour les mêmes entrées');
    for (const x of [enLot, partage1, partage2]) {
      assert.equal(x.length, unParUn.length);
      x.forEach((e, j) => { assert.equal(e.y, unParUn[j].y); memesNombres(e.X, unParUn[j].X, `pli ${plis}, exemple ${j}`); });
    }
    // Et chacun est celui du calcul figé du tour 6.
    unParUn.forEach((e, j) => { const c = cas.filter((y) => exempleReclasse(rc, y.p, y.vote, tot, exclu))[j]; const S = c.vote.candidats.slice(0, 3).filter((y) => y.appli !== HORS_CHAMP); memesNombres(e.X, calculTour6(rc, c.p.texte, S.map((y) => y.appli), S.map((y) => y.part), tot, exclu), `pli ${plis}, exemple ${j} (tour 6)`); });
    exemples += unParUn.length; plis++;
  });
  assert.equal(plis, 5);
  assert.ok(exemples >= 20, `${exemples} exemples comparés`);
});
