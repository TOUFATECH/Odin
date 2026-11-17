// La recherche par le SENS gardée prête en mémoire vive, et répartie sur les cœurs du processeur.
//
// Avant (src/muninn/store.ts, nearest) : à chaque question, on parcourt la table des vecteurs (une Map), on va chercher
// chaque vecteur décodé dans un cache, on calcule le cosinus un par un sur UN seul cœur, puis on trie TOUS les candidats.
// Ici : un vecteur par souvenir rangé bout à bout dans UN tableau compact (mémoire partagée entre les fils), sa norme à
// côté ; la question est comparée à TOUS les souvenirs ; quand il y en a assez pour que cela vaille la peine (seuil
// mesuré par test/rapidite/sens-vif.ts), le calcul est coupé en tranches, une par cœur disponible ; on ne garde que les
// meilleurs au fil du parcours (pas de tri de toute la liste).
//
// Mêmes réponses, dans le même ordre, que l'ancien chemin : le cosinus est calculé avec exactement les mêmes opérations
// (produit scalaire accumulé en double, divisé par le produit des normes), le même seuil (0,45), et à score égal c'est
// l'ordre de rangement qui départage, comme le tri stable de l'ancien chemin (test/sens-vif.test.ts le vérifie).
//
// La mémoire prise est demandée au comptable unique (src/brain/budget-memoire.ts). S'il refuse, ou si la machine manque
// de mémoire, rien n'est gardé : chercher() rend `null` et l'appelant reprend l'ancien chemin — juste, seulement plus
// lent. Un souvenir oublié est retiré tout de suite : la mémoire prévient (surOubliSouvenir) et l'index l'enlève, avec
// tout ce qu'il en gardait ; synchroniser() remet l'index d'accord avec la mémoire telle qu'elle est (souvenirs ajoutés,
// changés ou retirés entre-temps). Le filtre `vivant` est OBLIGATOIRE à chaque recherche : il écarte au dernier moment
// ce que l'ancien chemin écarte (souvenir remplacé, venu du dehors, oublié entre deux synchronisations).

import { availableParallelism } from 'node:os';
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import { rendre, reserver, surPression } from '../budget-memoire.ts';
import { surOubliSouvenir } from '../../muninn/store.ts';

export type Cle = number | string;
export interface Trouve { id: Cle; score: number }

/** Le seuil de l'ancien chemin (store.nearest) : en dessous, un souvenir n'est pas « proche ». */
export const SEUIL_SENS = 0.45;
/**
 * En dessous de ce nombre de nombres comparés (souvenirs × largeur du vecteur), un seul fil : réveiller les autres coûte
 * à peu près ce qu'ils font gagner. Mesuré (test/rapidite/sens-vif.ts, machine partagée chargée de 20 à 60 %) : à 300
 * souvenirs de 128 nombres, répartir ne gagne rien et allonge le 95e centile ; à 1 000, 0,32 → 0,21 ms ; à 2 000,
 * 0,47 → 0,31 ms. Le seuil est pris à 2 000 souvenirs de 128 nombres, avec de la marge. Réglable par l'option.
 */
export const SEUIL_PARALLELE = 256_000;
/** Mémoire comptée par fil de calcul (sa pile, son tas) : demandée au comptable avec le reste. */
const MO_PAR_FIL = 8;
/** Octets comptés en plus par souvenir gardé : son identifiant, sa place dans la table, son empreinte. */
const OCTETS_TABLES_PAR_SOUVENIR = 96;
/**
 * Attente maximale des fils de calcul par le fil principal, en ms : une base, plus le temps qu'un seul fil mettrait
 * largement (≈ 4 ns par nombre comparé). Au-delà (fil privé de processeur sur une machine chargée), on reprend sur un
 * seul fil et on laisse les fils de côté un moment, au lieu de bloquer Odin.
 */
const ATTENTE_FILS_BASE_MS = 50;
const ATTENTE_FILS_MS_PAR_NOMBRE = 1 / 250_000;
/** Après une attente dépassée, les fils sont laissés de côté pendant ce temps (ms), puis on réessaie. */
const PAUSE_FILS_MS = 10_000;
/** Démarrage des fils, attendu une seule fois à leur création (ms). */
const DEMARRAGE_FILS_MS = 500;

/**
 * La limite telle que l'ancien chemin la comprend (`slice(0, limite)`) : partie entière, NaN → 0, et une limite négative
 * retire autant de résultats à la fin. Rend le nombre à garder pendant le parcours et la coupe à appliquer ensuite.
 */
function commeSlice(limite: number): { garder: number; couper: number | undefined } {
  const k = Number.isNaN(limite) ? 0 : Math.trunc(limite);
  return k >= 0 ? { garder: k, couper: undefined } : { garder: Infinity, couper: k };
}

// Les index ouverts : UN seul abonnement au comptable (pression) et à la mémoire (oublis) pour tous. Un index fermé est
// retiré de la liste, donc rien ne le retient plus.
const ouverts = new Set<SensVif>();
let abonne = false;
function inscrire(sv: SensVif): void {
  ouverts.add(sv);
  if (abonne) return;
  abonne = true;
  surPression(() => { for (const x of [...ouverts]) x.surPression(); });
  surOubliSouvenir.add((m) => { for (const x of [...ouverts]) x.oublier(m.id); });
}
let numero = 0;

/** Norme euclidienne, exactement comme src/muninn/vecteurs-ram.ts (un vecteur nul rend 1). Pur. */
export function normeSens(f: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s) || 1;
}

// ------------------------------------------------------------------------------------------------ les meilleurs
// Garde les `k` meilleurs (score décroissant, puis ordre de rangement croissant) sans trier toute la liste : un tas où la
// racine est le PIRE des gardés. Rend la même suite qu'un tri stable de tout puis slice(0, k).
class Meilleurs {
  readonly s: number[] = []; readonly o: number[] = []; readonly x: number[] = [];
  private readonly k: number;
  constructor(k: number) { this.k = k; }
  /** a est-il moins bon que b ? */
  private pire(i: number, j: number): boolean { return this.s[i] < this.s[j] || (this.s[i] === this.s[j] && this.o[i] > this.o[j]); }
  private echanger(i: number, j: number): void {
    const { s, o, x } = this;
    [s[i], s[j]] = [s[j], s[i]]; [o[i], o[j]] = [o[j], o[i]]; [x[i], x[j]] = [x[j], x[i]];
  }
  proposer(score: number, ordre: number, place: number): void {
    if (this.k <= 0) return;
    const n = this.s.length;
    if (n < this.k) {
      this.s.push(score); this.o.push(ordre); this.x.push(place);
      let i = n;
      while (i > 0) { const p = (i - 1) >> 1; if (this.pire(i, p)) { this.echanger(i, p); i = p; } else break; }
      return;
    }
    // Meilleur que le pire gardé ?
    if (score < this.s[0] || (score === this.s[0] && ordre > this.o[0])) return;
    this.s[0] = score; this.o[0] = ordre; this.x[0] = place;
    let i = 0;
    for (;;) {
      const g = 2 * i + 1, d = g + 1;
      let m = i;
      if (g < n && this.pire(g, m)) m = g;
      if (d < n && this.pire(d, m)) m = d;
      if (m === i) break;
      this.echanger(i, m); i = m;
    }
  }
  /** Les gardés, du meilleur au moins bon. */
  enOrdre(): Array<{ score: number; ordre: number; place: number }> {
    return this.s.map((score, i) => ({ score, ordre: this.o[i], place: this.x[i] }))
      .sort((a, b) => b.score - a.score || a.ordre - b.ordre);
  }
}

// ------------------------------------------------------------------------------------------------ classer une liste
/**
 * Classe PAR LE SENS une liste de souvenirs qu'on lui donne (la fonction promise au Cerveau) : chacun avec son vecteur
 * (ou, à défaut, celui que l'index `depuis` garde pour son identifiant — seulement si l'index est bien celui du `modele`
 * de la question). Cosinus de l'ancien chemin, seuil 0,45 par défaut ; à score égal, l'ordre de la liste donnée. Les
 * souvenirs sans vecteur sont laissés de côté.
 */
export function classerParLeSens<T extends { id: Cle; vec?: Float32Array }>(
  q: Float32Array, souvenirs: readonly T[], o: { limite?: number; seuil?: number; depuis?: SensVif; modele?: string } = {},
): Array<{ souvenir: T; score: number }> {
  const qn = normeSens(q), seuil = o.seuil ?? SEUIL_SENS, lim = commeSlice(o.limite ?? souvenirs.length), top = new Meilleurs(lim.garder);
  // Un index d'un autre modèle (ou sans modèle annoncé) ne note rien : ses vecteurs ne se comparent pas à la question.
  const depuis = o.depuis && o.modele !== undefined && o.depuis.modele === o.modele ? o.depuis : undefined;
  for (let i = 0; i < souvenirs.length; i++) {
    const s = souvenirs[i];
    let sc: number | undefined;
    if (s.vec) {
      const f = s.vec, n = Math.min(f.length, q.length);
      let d = 0;
      for (let k = 0; k < n; k++) d += f[k] * q[k];
      sc = d / (normeSens(f) * qn);
    } else sc = depuis?.scoreDe(s.id, q, qn);
    if (sc !== undefined && sc > seuil) top.proposer(sc, i, i);
  }
  return top.enOrdre().slice(0, lim.couper).map((x) => ({ souvenir: souvenirs[x.place], score: x.score }));
}

// ------------------------------------------------------------------------------------------------ les fils de calcul
// Chaque fil attend sur un mot partagé (Atomics.wait) ; réveillé, il calcule les scores de sa tranche dans le tableau
// partagé des scores, puis le signale. Les tampons partagés lui sont envoyés par un port lu sans attendre la boucle
// d'événements (receiveMessageOnPort) quand ils changent (l'index a grandi).
// Mots de contrôle (Int32) : [0] commande (compteur de tâches), [1] génération des tampons, [2] fils qui ont fini,
// [3] nombre de souvenirs, [4] largeur, [5] longueur de la question, [6] fils démarrés ; par fil f : [8 + 2f] début,
// [9 + 2f] fin.
const CODE_FIL = `
const { workerData, receiveMessageOnPort } = require('node:worker_threads');
const ctl = new Int32Array(workerData.ctl), qn = new Float64Array(workerData.qn), port = workerData.port;
let gen = -1, mat, nor, sco, q;
let vu = 0;
Atomics.add(ctl, 6, 1);
Atomics.notify(ctl, 6);
for (;;) {
  Atomics.wait(ctl, 0, vu);
  vu = Atomics.load(ctl, 0);
  if (vu < 0) break;
  const g = Atomics.load(ctl, 1);
  while (gen !== g) {
    const m = receiveMessageOnPort(port);
    if (!m) { Atomics.wait(ctl, 7, 0, 1); continue; }
    gen = m.message.gen; mat = new Float32Array(m.message.mat); nor = new Float64Array(m.message.nor);
    sco = new Float64Array(m.message.sco); q = new Float32Array(m.message.q);
  }
  const f = workerData.f, de = ctl[8 + 2 * f], a = ctl[9 + 2 * f], dim = ctl[4], n = Math.min(dim, ctl[5]), nq = qn[0];
  for (let i = de; i < a; i++) {
    const o = i * dim;
    let d = 0;
    for (let k = 0; k < n; k++) d += mat[o + k] * q[k];
    sco[i] = d / (nor[i] * nq);
  }
  Atomics.add(ctl, 2, 1);
  Atomics.notify(ctl, 2);
}
`;

interface Fil { w: Worker; port: MessagePort }

// ------------------------------------------------------------------------------------------------ l'index
export interface OptionsSensVif {
  /** Nom auprès du comptable de mémoire (un par index). */
  nom?: string;
  /** Fils de calcul en plus du fil principal (défaut : les cœurs disponibles moins un, au plus 15 ; 0 = un seul fil). */
  fils?: number;
  /** Nombres comparés (souvenirs × largeur) à partir desquels on répartit (défaut SEUIL_PARALLELE). */
  seuilParallele?: number;
  /** Plafond propre à cet index, en Mo (en plus de ce que le comptable accorde). */
  plafondMo?: number;
}

/**
 * Les vecteurs d'UN modèle (étiquette « noos-v<n>-p<k> »), gardés prêts : un tableau compact (largeur × capacité), les
 * normes, l'ordre de rangement. Retrait en O(largeur) : le dernier prend la place du retiré.
 */
export class SensVif {
  readonly nom: string;
  private model: string | undefined;
  private dim = 0;
  private n = 0;
  private cap = 0;
  private mat: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private nor: Float64Array<ArrayBufferLike> = new Float64Array(0);
  private sco: Float64Array<ArrayBufferLike> = new Float64Array(0);
  private ordre = new Float64Array(0);
  private ids: Cle[] = [];
  private readonly place = new Map<Cle, number>();
  private compteur = 0;
  private complet = false;
  private raisonIncomplet = 'vide';
  private moReserves = 0;
  private readonly filsVoulus: number;
  private readonly seuilPar: number;
  private readonly plafondMo: number;
  // Fils de calcul (créés au premier besoin).
  private fils: Fil[] = [];
  private ctl: Int32Array | undefined;
  private qnPartage: Float64Array | undefined;
  private qPartage: Float32Array | undefined;
  private gen = 0;
  private genEnvoyee = -1;
  private tache = 0;
  /** Un fil a planté : plus de répartition pour cet index (le chemin à un fil reste juste). */
  private filsCasses = false;
  /** Après une attente dépassée : pas de répartition avant ce moment (performance.now()). */
  private filsEnPauseJusqua = 0;
  /** Compteurs (essais et banc) : recherches faites, sur combien de fils la dernière, combien de souvenirs comparés. */
  readonly compte = { recherches: 0, enParallele: 0, derniersFils: 1, derniersCompares: 0, videsSousPression: 0, refus: 0, attentesDepassees: 0, sansVivant: 0 };

  constructor(o: OptionsSensVif = {}) {
    // Un nom UNIQUE auprès du comptable : deux index ne partagent jamais une ligne (fermer l'un ne rend pas la part de l'autre).
    this.nom = `${o.nom ?? 'sens-vif'}#${++numero}`;
    this.filsVoulus = Math.max(0, Math.min(15, o.fils ?? availableParallelism() - 1));
    this.seuilPar = o.seuilParallele ?? SEUIL_PARALLELE;
    this.plafondMo = o.plafondMo ?? Infinity;
    inscrire(this);
  }

  /** Appelé par le comptable quand la machine manque de mémoire : tout est vidé et rendu. */
  surPression(): void {
    if (this.cap || this.fils.length || this.moReserves) { this.compte.videsSousPression++; this.vider('la machine manque de mémoire'); }
  }

  get taille(): number { return this.n; }
  get largeur(): number { return this.dim; }
  get modele(): string | undefined { return this.model; }
  /** Tous les vecteurs du modèle sont-ils là ? Sinon chercher() rend null (l'appelant prend l'ancien chemin). */
  get pret(): boolean { return this.complet; }
  get pourquoiPasPret(): string | undefined { return this.complet ? undefined : this.raisonIncomplet; }
  /** Ce que l'index a demandé au comptable (Mo). */
  get memoireMo(): number { return this.moReserves; }
  a(id: Cle): boolean { return this.place.has(id); }

  /** Vide tout et rend la mémoire (oubli de tout, changement de modèle, pression). Les fils sont arrêtés. */
  vider(raison = 'vidé'): void {
    this.arreterFils(false);
    this.mat = new Float32Array(0); this.nor = new Float64Array(0); this.sco = new Float64Array(0); this.ordre = new Float64Array(0);
    this.ids = []; this.place.clear(); this.empreintes.clear(); this.n = 0; this.cap = 0; this.dim = 0; this.gen++;
    this.complet = false; this.raisonIncomplet = raison;
    if (this.moReserves) { rendre(this.nom); this.moReserves = 0; }
  }

  // Tableaux (vecteurs, normes, scores, ordre) + tables (identifiants, places, empreintes).
  private octetsPour(cap: number, dim: number): number { return cap * (dim * 4 + 8 + 8 + 8) + cap * OCTETS_TABLES_PAR_SOUVENIR; }

  /** Agrandit les tableaux (doublement). Rend false si le comptable refuse : l'index est alors vidé. */
  private grandir(besoin: number): boolean {
    if (besoin <= this.cap) return true;
    const cap = Math.max(64, this.cap * 2, besoin);
    const mo = Math.ceil(this.octetsPour(cap, this.dim) / 1_048_576) + this.fils.length * MO_PAR_FIL;
    inscrire(this); // rouvert après fermer() : de nouveau prévenu de la pression et des oublis
    if (mo > this.plafondMo || !reserver(this.nom, mo)) {
      this.compte.refus++;
      this.vider(`mémoire refusée par le comptable (${mo} Mo demandés)`);
      return false;
    }
    this.moReserves = mo;
    const mat = new Float32Array(new SharedArrayBuffer(cap * this.dim * 4));
    mat.set(this.mat.subarray(0, this.n * this.dim));
    const nor = new Float64Array(new SharedArrayBuffer(cap * 8)); nor.set(this.nor.subarray(0, this.n));
    const ordre = new Float64Array(cap); ordre.set(this.ordre.subarray(0, this.n));
    this.mat = mat; this.nor = nor; this.ordre = ordre;
    this.sco = new Float64Array(new SharedArrayBuffer(cap * 8));
    this.cap = cap; this.gen++;
    return true;
  }

  /**
   * Range (ou remplace) le vecteur d'un souvenir. Un autre modèle que celui de l'index, ou une autre largeur, rend
   * l'index incomplet (chercher rend null) plutôt que de mélanger. Rend true si le vecteur est gardé.
   */
  ajouter(id: Cle, model: string, vec: Float32Array): boolean {
    if (this.model !== undefined && model !== this.model) { this.retirerSiPresent(id); this.complet = false; this.raisonIncomplet = `un vecteur d'un autre modèle (${model})`; return false; }
    if (this.n === 0 && this.dim === 0) { this.dim = vec.length; this.model = model; }
    if (vec.length !== this.dim || this.dim === 0) { this.retirerSiPresent(id); this.complet = false; this.raisonIncomplet = 'un vecteur d\'une autre largeur'; return false; }
    let p = this.place.get(id);
    if (p === undefined) {
      if (!this.grandir(this.n + 1)) return false;
      p = this.n++;
      this.place.set(id, p); this.ids[p] = id; this.ordre[p] = ++this.compteur;
    }
    this.mat.set(vec, p * this.dim);
    this.nor[p] = normeSens(vec);
    return true;
  }

  private retirerSiPresent(id: Cle): void { if (this.place.has(id)) this.oublier(id); }

  /**
   * Retire un souvenir TOUT DE SUITE (oublié par le propriétaire, effacé, son vecteur retiré) : son vecteur, sa norme,
   * son empreinte. Appelé aussi par la mémoire elle-même à chaque oubli (surOubliSouvenir).
   */
  oublier(id: Cle): boolean {
    this.empreintes.delete(id);
    const p = this.place.get(id);
    if (p === undefined) return false;
    const der = this.n - 1;
    if (p !== der) {
      this.mat.copyWithin(p * this.dim, der * this.dim, (der + 1) * this.dim);
      this.nor[p] = this.nor[der]; this.ordre[p] = this.ordre[der];
      const idDer = this.ids[der]; this.ids[p] = idDer; this.place.set(idDer, p);
    }
    // Le vecteur retiré ne reste pas dans le tableau (rien d'un souvenir oublié n'est gardé en mémoire).
    this.mat.fill(0, der * this.dim, (der + 1) * this.dim);
    this.nor[der] = 0; this.ordre[der] = 0; this.ids.length = der;
    this.place.delete(id); this.n = der;
    return true;
  }

  /**
   * Remet l'index d'accord avec la mémoire telle qu'elle est maintenant (ce qui a changé sur le disque est vu) : les
   * vecteurs du `model` donnés dans l'ordre de la mémoire ; ceux qui manquent sont retirés ; l'ordre de rangement est
   * celui de `lignes` (il départage les scores égaux, comme le parcours de l'ancien chemin). `vec` : le vecteur, ou une
   * fonction qui le décode (appelée seulement si `cle` a changé depuis la dernière fois).
   */
  synchroniser(model: string, lignes: Iterable<{ id: Cle; cle?: unknown; vec: Float32Array | (() => Float32Array) }>): boolean {
    if (this.model !== model) { this.vider('changement de modèle'); this.model = model; this.empreintes.clear(); }
    const vus = new Set<Cle>();
    let rang = 0;
    this.complet = true;
    for (const l of lignes) {
      vus.add(l.id);
      const deja = this.place.get(l.id);
      if (deja === undefined || l.cle === undefined || this.empreintes.get(l.id) !== l.cle) {
        const v = typeof l.vec === 'function' ? l.vec() : l.vec;
        if (!this.ajouter(l.id, model, v)) { this.complet = false; if (!this.cap) { this.empreintes.clear(); return false; } continue; }
        if (l.cle !== undefined) this.empreintes.set(l.id, l.cle); else this.empreintes.delete(l.id);
      }
      this.ordre[this.place.get(l.id)!] = ++rang;
    }
    for (const id of [...this.place.keys()]) if (!vus.has(id)) { this.oublier(id); this.empreintes.delete(id); }
    this.compteur = rang;
    if (this.complet) this.raisonIncomplet = '';
    return this.complet;
  }
  private readonly empreintes = new Map<Cle, unknown>();

  /** Le cosinus d'un souvenir gardé avec la question (undefined s'il n'est pas gardé). */
  scoreDe(id: Cle, q: Float32Array, qn = normeSens(q)): number | undefined {
    const p = this.place.get(id);
    if (p === undefined) return undefined;
    const o = p * this.dim, n = Math.min(this.dim, q.length);
    let d = 0;
    for (let k = 0; k < n; k++) d += this.mat[o + k] * q[k];
    return d / (this.nor[p] * qn);
  }

  /**
   * Les souvenirs les plus proches de `q`, comparée à TOUS les souvenirs gardés. Mêmes réponses et même ordre que
   * store.nearest. `vivant` (obligatoire) écarte au dernier moment ceux qui ne doivent plus sortir (remplacés, oubliés,
   * venus du dehors), comme l'ancien chemin. Rend null si l'index n'est pas prêt pour ce modèle, s'il a été vidé pendant
   * la recherche (la machine manque de mémoire), ou sans `vivant` : l'appelant prend alors l'ancien chemin.
   */
  chercher(model: string, q: Float32Array, limite: number, o: { seuil?: number; vivant: (id: Cle) => boolean }): Trouve[] | null {
    if (typeof o?.vivant !== 'function') { this.compte.sansVivant++; return null; }
    if (!this.complet || model !== this.model) return null;
    const N = this.n, vivant = o.vivant;
    this.compte.recherches++; this.compte.derniersCompares = N;
    const lim = commeSlice(limite);
    if (N === 0) { this.compte.derniersFils = 1; return []; }
    const qn = normeSens(q), seuil = o.seuil ?? SEUIL_SENS;
    const top = new Meilleurs(lim.garder);
    const garder = (i: number, s: number) => { if (s > seuil && vivant(this.ids[i])) top.proposer(s, this.ordre[i], i); };
    const rendu = () => top.enOrdre().slice(0, lim.couper).map((x) => ({ id: this.ids[x.place], score: x.score }));
    if (this.filsVoulus > 0 && !this.filsCasses && performance.now() >= this.filsEnPauseJusqua && N * this.dim >= this.seuilPar && this.preparerFils()) {
      // La demande au comptable (préparer les fils) a pu voir la machine à court de mémoire et vider l'index.
      if (!this.complet || this.n !== N || model !== this.model) return null;
      if (this.calculerEnParallele(q, qn, N)) {
        this.compte.enParallele++;
        const sco = this.sco;
        for (let i = 0; i < N; i++) garder(i, sco[i]);
        return rendu();
      }
    }
    // Même chose après l'arrêt des fils (attente dépassée) : rien de gardé → ancien chemin, jamais « rien trouvé ».
    if (!this.complet || this.n !== N || model !== this.model) return null;
    this.compte.derniersFils = 1;
    const dim = this.dim, n = Math.min(dim, q.length), mat = this.mat, nor = this.nor;
    for (let i = 0; i < N; i++) {
      const off = i * dim;
      let d = 0;
      for (let k = 0; k < n; k++) d += mat[off + k] * q[k];
      garder(i, d / (nor[i] * qn));
    }
    return rendu();
  }

  // ---------------------------------------------------------------------------------------------- fils
  private preparerFils(): boolean {
    if (this.fils.length) return true;
    // Les fils comptent aussi : demandés au comptable avec les tableaux.
    const mo = this.moReserves + this.filsVoulus * MO_PAR_FIL;
    if (mo > this.plafondMo || !reserver(this.nom, mo)) { this.compte.refus++; return false; }
    this.moReserves = mo;
    const ctl = new Int32Array(new SharedArrayBuffer(4 * (8 + 2 * 16)));
    this.ctl = ctl; this.qnPartage = new Float64Array(new SharedArrayBuffer(8));
    for (let f = 0; f < this.filsVoulus; f++) {
      const { port1, port2 } = new MessageChannel();
      const w = new Worker(CODE_FIL, { eval: true, workerData: { ctl: ctl.buffer, qn: this.qnPartage.buffer, port: port2, f }, transferList: [port2] });
      w.unref(); port1.unref?.();
      // Seul un fil ACTUEL qui plante ou s'arrête casse la répartition : la fin des anciens fils (arrêtés par un vidage,
      // un changement de modèle) arrive plus tard, quand de nouveaux tournent déjà, et ne doit pas les condamner.
      const actuel = () => this.fils.some((x) => x.w === w);
      w.on('error', () => { if (actuel()) this.filsCasses = true; });
      w.on('exit', () => { if (actuel()) this.filsCasses = true; });
      this.fils.push({ w, port: port1 });
    }
    this.genEnvoyee = -1;
    // Démarrage des fils : attendu UNE fois, borné ; ceux qui ne sont pas prêts à temps le seront pour une prochaine
    // recherche (en attendant, le calcul se fait sur un fil).
    const fin = performance.now() + DEMARRAGE_FILS_MS;
    for (;;) {
      const prets = Atomics.load(ctl, 6), reste = fin - performance.now();
      if (prets >= this.filsVoulus || reste <= 0) break;
      Atomics.wait(ctl, 6, prets, reste);
    }
    return true;
  }

  /** Arrête les fils. `garderTableaux` : l'index reste plein, sa réservation est ramenée aux seuls tableaux. */
  private arreterFils(garderTableaux = true): void {
    const fils = this.fils; this.fils = [];
    if (this.ctl && fils.length) { Atomics.store(this.ctl, 0, -1); Atomics.notify(this.ctl, 0); }
    for (const f of fils) { try { f.port.close(); } catch { /* rien */ } void f.w.terminate().catch(() => undefined); }
    this.ctl = undefined; this.qPartage = undefined; this.genEnvoyee = -1; this.tache = 0;
    if (!fils.length || !garderTableaux || !this.cap) return;
    // Un ancien fil en train de finir écrit encore dans l'ancien tableau des scores : les prochains en ont un neuf.
    this.sco = new Float64Array(new SharedArrayBuffer(this.cap * 8)); this.gen++;
    if (this.moReserves) { const mo = Math.ceil(this.octetsPour(this.cap, this.dim) / 1_048_576); if (reserver(this.nom, mo)) this.moReserves = mo; }
  }

  /** Répartit le calcul des scores sur les fils et le fil principal. Rend false si un fil ne répond pas (repli). */
  private calculerEnParallele(q: Float32Array, qn: number, N: number): boolean {
    const ctl = this.ctl!, F = this.fils.length;
    if (Atomics.load(ctl, 6) < F) return false; // pas encore tous démarrés : un fil cette fois-ci, sans pénalité
    if (!this.qPartage || this.qPartage.length < this.dim) { this.qPartage = new Float32Array(new SharedArrayBuffer(Math.max(this.dim, 1) * 4)); this.gen++; }
    if (this.genEnvoyee !== this.gen) {
      for (const f of this.fils) f.port.postMessage({ gen: this.gen, mat: this.mat.buffer, nor: this.nor.buffer, sco: this.sco.buffer, q: this.qPartage.buffer });
      this.genEnvoyee = this.gen;
    }
    const nq = Math.min(q.length, this.dim);
    this.qPartage.fill(0); this.qPartage.set(q.subarray(0, nq));
    this.qnPartage![0] = qn;
    // Tranches égales : F fils + le fil principal.
    const parts = F + 1, pas = Math.ceil(N / parts);
    for (let f = 0; f < F; f++) { ctl[8 + 2 * f] = Math.min(N, f * pas); ctl[9 + 2 * f] = Math.min(N, (f + 1) * pas); }
    ctl[3] = N; ctl[4] = this.dim; ctl[5] = nq;
    Atomics.store(ctl, 1, this.gen);
    Atomics.store(ctl, 2, 0);
    this.tache = (this.tache + 1) & 0x3fffffff;
    Atomics.store(ctl, 0, this.tache);
    Atomics.notify(ctl, 0);
    // Le fil principal fait la dernière tranche.
    const dim = this.dim, mat = this.mat, nor = this.nor, sco = this.sco, qp = this.qPartage;
    for (let i = Math.min(N, F * pas); i < N; i++) {
      const off = i * dim;
      let d = 0;
      for (let k = 0; k < nq; k++) d += mat[off + k] * qp[k];
      sco[i] = d / (nor[i] * qn);
    }
    // Attente bornée : un fil privé de processeur ne bloque pas Odin (le serveur ne répondrait plus pendant ce temps).
    const limite = performance.now() + ATTENTE_FILS_BASE_MS + N * this.dim * ATTENTE_FILS_MS_PAR_NOMBRE;
    for (;;) {
      const fait = Atomics.load(ctl, 2);
      if (fait >= F) break;
      const reste = limite - performance.now();
      if (reste <= 0) {
        this.compte.attentesDepassees++;
        this.filsEnPauseJusqua = performance.now() + PAUSE_FILS_MS;
        this.arreterFils();
        return false;
      }
      Atomics.wait(ctl, 2, fait, reste);
    }
    this.compte.derniersFils = parts;
    return true;
  }

  /** Arrête les fils et rend la mémoire (fin d'Odin, essais). */
  fermer(): void { this.vider('fermé'); ouverts.delete(this); }
  /** Pour les essais : cet index est-il encore suivi (pression, oublis) ? */
  get suivi(): boolean { return ouverts.has(this); }
}
