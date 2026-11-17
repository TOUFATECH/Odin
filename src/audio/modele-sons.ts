// Le modèle de sons ouvert, calculé par Odin : on lit ses poids (téléchargés une fois, empreinte vérifiée, licence
// notée) et on écrit ICI sa passe avant, sur les noyaux de calcul de Noûs. Rien n'est entraîné de zéro.
//
// Forme du réseau (déduite des formes des tenseurs, vérifiée nom par nom) : normalisation des 64 bandes mel, découpe
// en carrés 16×16 (jetons, fréquence d'abord), positions de fréquence et de temps ajoutées, blocs d'attention
// pré-normés, normalisation finale, moyenne des jetons, tête (normalisation puis couche linéaire), sigmoïdes
// indépendantes (plusieurs sons à la fois). Un manque ou un écart donne pret:false avec la raison, jamais une erreur.

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lirePoids, type Poids } from '../vision/poids.ts';
import { empreinteFichier } from '../brain/metis/gguf.ts';
import { noyaux } from '../brain/nous/wasm.ts';
import { ceder, verifierArret } from './bornes.ts';
import { BANDES } from './spectre.ts';
import { CATALOGUE_SONS, FICHIER_ETAT, MAX_CONFIG } from './catalogue.ts';
import type { Famille, ModeleSons, MomentSon, SortieModele } from './contrat.ts';

const FENETRE = 1012;   // trames par fenêtre (≈ 10 s)
const CARRE = 16;
const ZONE_F32 = (16 * 1024 * 1024) / 4; // zone de travail des noyaux : 16 Mio

// ---------------------------------------------------------------------------------------------------------------
// Étiquettes en français (données) et familles.
// ---------------------------------------------------------------------------------------------------------------

interface FicheEtiquette { fr: string; famille: Famille; seuil: number }
const FAMILLES = new Set<Famille>(['maison', 'alerte', 'parole', 'musique', 'instrument', 'genre', 'ambiance', 'autre']);
let tableFr: Map<string, FicheEtiquette> | undefined;

function etiquettesFr(): Map<string, FicheEtiquette> {
  if (tableFr) return tableFr;
  const t = new Map<string, FicheEtiquette>();
  try {
    const brut = JSON.parse(readFileSync(new URL('./etiquettes-fr.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;
    for (const [cle, v] of Object.entries(brut)) {
      const famille = String(v?.famille ?? '') as Famille;
      const seuil = Number(v?.seuil);
      if (typeof v?.fr !== 'string' || !FAMILLES.has(famille) || !(seuil > 0 && seuil < 1)) continue;
      t.set(cle, { fr: v.fr.slice(0, 80), famille, seuil });
    }
  } catch { /* table absente : tout sera « autre son » */ }
  return (tableFr = t);
}

/** La fiche française d'un libellé public (forme exacte, sinon la partie avant la première virgule). */
export function ficheEtiquette(libelle: string): FicheEtiquette & { cle: string } {
  const t = etiquettesFr();
  const exact = t.get(libelle);
  if (exact) return { ...exact, cle: libelle };
  const court = libelle.split(',')[0].trim();
  const c = t.get(court);
  if (c) return { ...c, cle: libelle };
  return { fr: 'autre son', famille: 'autre', seuil: 0.5, cle: libelle };
}

// ---------------------------------------------------------------------------------------------------------------
// Moments : médiane sur 3 pas, puis hystérésis (on entre au seuil, on sort sous seuil × 0,7).
// ---------------------------------------------------------------------------------------------------------------

export class Momenteur {
  private readonly C: number;
  private readonly fiches: Array<FicheEtiquette & { cle: string }>;
  private prec: Float32Array[] = []; // deux derniers pas (pour la médiane)
  private pasVus = 0;
  private ouverts = new Map<number, { debut: number; pMax: number; pas: number }>();
  readonly moments: MomentSon[] = [];
  private readonly pasS: number;
  private readonly max: number;

  constructor(libelles: string[], pasS: number, max = 500) {
    this.C = libelles.length;
    this.fiches = libelles.map(ficheEtiquette);
    this.pasS = pasS;
    this.max = max;
  }

  /** Pousse des pas (rangés pas par pas, C valeurs chacun), le premier commençant à `t0` secondes. */
  pousser(parPas: Float32Array, nbPas: number, t0: number): void {
    for (let s = 0; s < nbPas; s++) {
      const ligne = parPas.subarray(s * this.C, (s + 1) * this.C);
      this.prec.push(ligne);
      if (this.prec.length > 3) this.prec.shift();
      // La médiane de trois pas est rendue à l'instant du pas du milieu.
      this.traiter(t0 + s * this.pasS - (this.prec.length === 3 ? this.pasS : 0));
      this.pasVus++;
    }
  }

  private traiter(t: number): void {
    const [a, b, c] = this.prec.length === 3 ? this.prec : [this.prec[this.prec.length - 1], this.prec[this.prec.length - 1], this.prec[this.prec.length - 1]];
    for (let k = 0; k < this.C; k++) {
      const f = this.fiches[k];
      if (f.famille === 'autre') continue;
      const x = a[k], y = b[k], z = c[k];
      const med = Math.max(Math.min(x, y), Math.min(Math.max(x, y), z));
      const o = this.ouverts.get(k);
      if (!o && med >= f.seuil) this.ouverts.set(k, { debut: t, pMax: med, pas: 1 });
      else if (o && med >= f.seuil * 0.7) { o.pas++; if (med > o.pMax) o.pMax = med; }
      else if (o) { this.fermer(k, o, t); }
    }
  }

  private fermer(k: number, o: { debut: number; pMax: number; pas: number }, fin: number): void {
    this.ouverts.delete(k);
    if (this.moments.length >= this.max) return;
    const f = this.fiches[k];
    this.moments.push({ debut: arr(o.debut), fin: arr(fin), indice: k, cle: f.cle, libelle: f.fr, famille: f.famille, pMax: arr(o.pMax), pas: o.pas });
  }

  /** Ferme les moments encore ouverts à l'instant `fin`. */
  finir(fin: number): MomentSon[] {
    for (const [k, o] of [...this.ouverts]) this.fermer(k, o, fin);
    return this.moments.sort((x, y) => x.debut - y.debut);
  }
}

const arr = (x: number): number => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------------------------------------------
// Petites opérations.
// ---------------------------------------------------------------------------------------------------------------

/** erf (approximation d'Abramowitz et Stegun 7.1.26, erreur < 1,5e-7). */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const gelu = (x: number): number => 0.5 * x * (1 + erf(x / Math.SQRT2));
const sigmoide = (x: number): number => 1 / (1 + Math.exp(-x));

/** Normalisation par ligne (N lignes de D), en place dans `out`. */
function normaliser(out: Float32Array, x: Float32Array, N: number, D: number, g: Float32Array, b: Float32Array, eps: number): void {
  for (let i = 0; i < N; i++) {
    let m = 0; for (let d = 0; d < D; d++) m += x[i * D + d];
    m /= D;
    let v = 0; for (let d = 0; d < D; d++) { const e = x[i * D + d] - m; v += e * e; }
    const inv = 1 / Math.sqrt(v / D + eps);
    for (let d = 0; d < D; d++) out[i * D + d] = (x[i * D + d] - m) * inv * g[d] + b[d];
  }
}

/** Transposée d'une matrice (lignes × colonnes). */
function transposer(w: Float32Array, lignes: number, colonnes: number): Float32Array {
  const t = new Float32Array(w.length);
  for (let r = 0; r < lignes; r++) for (let c = 0; c < colonnes; c++) t[c * lignes + r] = w[r * colonnes + c];
  return t;
}

interface Lineaire { wt: Float32Array; b: Float32Array; entree: number; sortie: number }
interface Bloc { n1g: Float32Array; n1b: Float32Array; qkv: Lineaire; proj: Lineaire; n2g: Float32Array; n2b: Float32Array; fc1: Lineaire; fc2: Lineaire }

/** y (N × sortie) = x (N × entree) · W + b. */
function appliquer(l: Lineaire, x: Float32Array, N: number): Float32Array {
  const y = new Float32Array(N * l.sortie);
  noyaux().mm(y, x, l.wt, N, l.entree, l.sortie);
  for (let i = 0; i < N; i++) for (let o = 0; o < l.sortie; o++) y[i * l.sortie + o] += l.b[o];
  return y;
}

// ---------------------------------------------------------------------------------------------------------------
// Ouverture.
// ---------------------------------------------------------------------------------------------------------------

/** Modèle pas prêt, avec sa raison. */
function pasPret(raison: string): ModeleSons {
  return {
    pret: false, raison, classes: 0, libelles: [],
    classer: () => Promise.reject(new Error(raison)),
  };
}

/** Modèle prêt, avec les notes de calcul (par exemple un repli en JavaScript). */
export interface ModeleSonsOuvert extends ModeleSons { readonly notes: string[]; readonly dimension: number; readonly blocs: number; readonly tetes: number }

/** Lit la configuration (1 Mo au plus, JSON strict) : les étiquettes et, si elle est là, le nombre de têtes. */
function lireConfig(chemin: string): { libelles: string[]; tetes?: number } | string {
  try {
    if (statSync(chemin).size > MAX_CONFIG) return 'configuration démesurée';
    const j = JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;
    const id2 = j.id2label;
    if (!id2 || typeof id2 !== 'object') return 'configuration sans étiquettes';
    const e = Object.entries(id2 as Record<string, unknown>);
    if (e.length < 1 || e.length > 10_000) return 'nombre d\'étiquettes anormal';
    const libelles = new Array<string>(e.length);
    for (const [k, v] of e) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= e.length || typeof v !== 'string' || v.length > 200) return 'étiquette invalide dans la configuration';
      libelles[i] = v;
    }
    for (let i = 0; i < libelles.length; i++) if (libelles[i] === undefined) return 'étiquettes trouées dans la configuration';
    const t = Number(j.num_heads ?? j.num_attention_heads ?? j.heads);
    return { libelles, ...(Number.isInteger(t) && t > 0 && t <= 64 ? { tetes: t } : {}) };
  } catch {
    return 'configuration illisible';
  }
}

/** Ouvre le modèle de sons du dossier. Ne lève jamais : s'il manque quelque chose, pret:false avec la raison. */
export async function ouvrirModeleSons(o: { dossier: string; attendu?: { sha256?: string } }): Promise<ModeleSons> {
  try {
    const f = CATALOGUE_SONS;
    const chemin = join(o.dossier, f.fichier);
    if (!existsSync(chemin)) return pasPret(`modèle de sons : pas téléchargé (${Math.round(f.taille / 1e6)} Mo, ${f.licence})`);
    const attendu = (o.attendu?.sha256 ?? f.sha256).toLowerCase();
    // L'empreinte est vérifiée AVANT toute lecture des tenseurs.
    const emp = await empreinteFichier(chemin);
    if (emp.toLowerCase() !== attendu) return pasPret('modèle de sons : empreinte non conforme, fichier refusé');
    const cheminConfig = join(o.dossier, f.config);
    if (!existsSync(cheminConfig)) return pasPret('modèle de sons : configuration absente (étiquettes)');
    const cfg = lireConfig(cheminConfig);
    if (typeof cfg === 'string') return pasPret(`modèle de sons : ${cfg}`);
    let poids: Poids;
    try {
      poids = await lirePoids(chemin, { sha256: attendu, licence: f.licence, source: f.urlPoids });
    } catch (e) {
      return pasPret(`modèle de sons illisible : ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }
    return construire(poids, cfg, o.dossier);
  } catch (e) {
    return pasPret(`modèle de sons : ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

class Ecart extends Error {}

function construire(poids: Poids, cfg: { libelles: string[]; tetes?: number }, dossier: string): ModeleSons {
  try {
    return new Reseau(poids, cfg, dossier);
  } catch (e) {
    if (e instanceof Ecart) return pasPret(`modèle de sons : ${e.message}`);
    return pasPret(`modèle de sons : ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

class Reseau implements ModeleSonsOuvert {
  readonly pret = true;
  readonly classes: number;
  readonly empreinte: string;
  readonly licence: string;
  readonly libelles: string[];
  readonly notes: string[] = [];
  readonly dimension: number;
  readonly blocs: number;
  readonly tetes: number;
  private readonly dossier: string;
  private aEcritEtat = false;
  // Tenseurs.
  private readonly bnMoy: Float32Array; private readonly bnVar: Float32Array; private readonly bnG: Float32Array; private readonly bnB: Float32Array;
  private readonly carreWt: Float32Array; private readonly carreB: Float32Array;
  private readonly posF: Float32Array; private readonly posT: Float32Array;
  private readonly nbF: number; private readonly nbT: number;
  private readonly lesBlocs: Bloc[] = [];
  private readonly normG: Float32Array; private readonly normB: Float32Array;
  private readonly teteNG: Float32Array; private readonly teteNB: Float32Array;
  private readonly tete: Lineaire;

  constructor(p: Poids, cfg: { libelles: string[]; tetes?: number }, dossier: string) {
    this.dossier = dossier;
    this.empreinte = p.empreinte;
    this.licence = CATALOGUE_SONS.licence;
    this.libelles = cfg.libelles;
    this.classes = cfg.libelles.length;
    const noms = p.noms();
    // Préfixes lus dans l'en-tête : celui du corps et celui de la tête.
    let pre = '', bnIn = '';
    const mBn = noms.map((n) => /^(.*?)init_bn\.(\d+\.)?running_mean$/.exec(n)).find((m) => m);
    if (!mBn) throw new Ecart('tenseur « init_bn.running_mean » absent');
    pre = mBn[1]; bnIn = mBn[2] ?? '';
    const nTete = noms.find((n) => n.endsWith('outputlayer.0.weight'));
    if (!nTete) throw new Ecart('tenseur « outputlayer.0.weight » absent');
    const preTete = nTete.slice(0, -'outputlayer.0.weight'.length);
    const t = (nom: string, forme: number[]): Float32Array => {
      if (!p.a(nom)) throw new Ecart(`tenseur « ${nom} » absent`);
      const x = p.tenseur(nom);
      const ok = x.dims.length === forme.length && x.dims.every((d, i) => forme[i] < 0 || d === forme[i]);
      if (!ok) throw new Ecart(`forme de « ${nom} » : [${x.dims.join(',')}] au lieu de [${forme.map((d) => (d < 0 ? '?' : d)).join(',')}]`);
      return x.data;
    };
    const forme = (nom: string): number[] => { if (!p.a(nom)) throw new Ecart(`tenseur « ${nom} » absent`); return p.tenseur(nom).dims; };
    this.bnMoy = t(`${pre}init_bn.${bnIn}running_mean`, [BANDES]);
    this.bnVar = t(`${pre}init_bn.${bnIn}running_var`, [BANDES]);
    this.bnG = t(`${pre}init_bn.${bnIn}weight`, [BANDES]);
    this.bnB = t(`${pre}init_bn.${bnIn}bias`, [BANDES]);
    const fc = forme(`${pre}patch_embed.proj.weight`);
    if (fc.length !== 4 || fc[1] !== 1 || fc[2] !== CARRE || fc[3] !== CARRE) throw new Ecart(`forme de « patch_embed.proj.weight » : [${fc.join(',')}]`);
    const D = fc[0];
    if (D < 2 || D > 4096) throw new Ecart('dimension anormale');
    this.dimension = D;
    const wc = t(`${pre}patch_embed.proj.weight`, [D, 1, CARRE, CARRE]);
    this.carreWt = transposer(wc, D, CARRE * CARRE);
    this.carreB = t(`${pre}patch_embed.proj.bias`, [D]);
    const ff = forme(`${pre}freq_pos_embed`), ft = forme(`${pre}time_pos_embed`);
    this.nbF = BANDES / CARRE;
    if (ff.length !== 4 || ff[0] !== 1 || ff[1] !== D || ff[2] !== this.nbF || ff[3] !== 1) throw new Ecart(`forme de « freq_pos_embed » : [${ff.join(',')}]`);
    if (ft.length !== 4 || ft[0] !== 1 || ft[1] !== D || ft[2] !== 1 || ft[3] < 1 || ft[3] > 4096) throw new Ecart(`forme de « time_pos_embed » : [${ft.join(',')}]`);
    this.nbT = ft[3];
    this.posF = t(`${pre}freq_pos_embed`, ff);
    this.posT = t(`${pre}time_pos_embed`, ft);
    // Blocs : comptés depuis 0, sans trou.
    let nb = 0;
    while (p.a(`${pre}blocks.${nb}.norm1.weight`)) nb++;
    if (nb < 1 || nb > 64) throw new Ecart('aucun bloc d\'attention');
    if (noms.some((n) => n.startsWith(`${pre}blocks.${nb}.`))) throw new Ecart('blocs troués');
    this.blocs = nb;
    const H = cfg.tetes ?? (D % 64 === 0 ? D / 64 : 1);
    if (D % H !== 0) throw new Ecart(`${H} têtes ne divisent pas la dimension ${D}`);
    this.tetes = H;
    const lin = (nom: string, sortie: number, entree: number): Lineaire => {
      const w = t(`${nom}.weight`, [sortie, entree]);
      return { wt: transposer(w, sortie, entree), b: t(`${nom}.bias`, [sortie]), entree, sortie };
    };
    const cache = forme(`${pre}blocks.0.mlp.fc1.weight`)[0];
    if (!(cache > 0 && cache <= 16 * D)) throw new Ecart('couche cachée anormale');
    for (let i = 0; i < nb; i++) {
      const b = `${pre}blocks.${i}`;
      this.lesBlocs.push({
        n1g: t(`${b}.norm1.weight`, [D]), n1b: t(`${b}.norm1.bias`, [D]),
        qkv: lin(`${b}.attn.qkv`, 3 * D, D), proj: lin(`${b}.attn.proj`, D, D),
        n2g: t(`${b}.norm2.weight`, [D]), n2b: t(`${b}.norm2.bias`, [D]),
        fc1: lin(`${b}.mlp.fc1`, cache, D), fc2: lin(`${b}.mlp.fc2`, D, cache),
      });
    }
    this.normG = t(`${pre}norm.weight`, [D]);
    this.normB = t(`${pre}norm.bias`, [D]);
    this.teteNG = t(`${preTete}outputlayer.0.weight`, [D]);
    this.teteNB = t(`${preTete}outputlayer.0.bias`, [D]);
    this.tete = lin(`${preTete}outputlayer.1`, this.classes, D);
    // Taille des produits : ils doivent tenir dans la zone de 16 Mio des noyaux, sinon repli en JavaScript.
    const N = this.nbF * this.nbT, hd = D / H;
    const plusGros = Math.max(N * D + D * 3 * D + N * 3 * D, N * D + D * cache + N * cache, N * hd + hd * N + N * N, N * 256 + 256 * D + N * D);
    if (!noyaux().simd) this.notes.push('calcul du modèle de sons en JavaScript (pas de calcul vectoriel ici) : plus lent');
    else if (plusGros > ZONE_F32) this.notes.push(`produits trop grands pour la zone de calcul (${plusGros} flottants) : repli en JavaScript, plus lent`);
  }

  async classer(logmel: Float32Array, trames: number, signal?: AbortSignal): Promise<SortieModele> {
    if (!Number.isInteger(trames) || trames < 1 || logmel.length !== BANDES * trames) throw new Error('entrée du modèle de sons : forme incorrecte');
    const t0 = performance.now();
    const D = this.dimension, C = this.classes;
    // 1. Normalisation des bandes mel.
    const x = new Float32Array(logmel.length);
    for (let m = 0; m < BANDES; m++) {
      const a = this.bnG[m] / Math.sqrt(this.bnVar[m] + 1e-5), c = this.bnB[m] - this.bnMoy[m] * a;
      for (let t = 0; t < trames; t++) x[m * trames + t] = logmel[m * trames + t] * a + c;
    }
    // 2. Fenêtres de 1012 trames ; la dernière est complétée par des zéros (après la normalisation) s'il y en a plusieurs.
    const fenetres: Array<{ debut: number; long: number }> = [];
    if (trames <= FENETRE) fenetres.push({ debut: 0, long: Math.max(trames, CARRE) });
    else for (let d = 0; d < trames; d += FENETRE) fenetres.push({ debut: d, long: FENETRE });
    const probas = new Float64Array(C);
    const plong = new Float64Array(D);
    const lignes: Float32Array[] = [];
    let poidsTotal = 0;
    for (const f of fenetres) {
      verifierArret(signal);
      const r = await this.passe(x, trames, f.debut, f.long, signal);
      const w = r.jetons;
      for (let k = 0; k < C; k++) probas[k] += r.probas[k] * w;
      for (let d = 0; d < D; d++) plong[d] += r.plongement[d] * w;
      poidsTotal += w;
      // On ne garde que les pas qui correspondent à du vrai son (pas au remplissage).
      const utiles = Math.min(r.pas, Math.max(1, Math.floor((Math.min(trames, f.debut + f.long) - f.debut) / CARRE)));
      lignes.push(r.parPas.subarray(0, utiles * C));
      if (fenetres.length > 1) await ceder();
    }
    const nbPas = lignes.reduce((a, l) => a + l.length / C, 0);
    const parPas = new Float32Array(nbPas * C);
    let off = 0;
    for (const l of lignes) { parPas.set(l, off); off += l.length; }
    const sortie: SortieModele = {
      probas: Float32Array.from(probas, (v) => v / Math.max(1e-9, poidsTotal)),
      parPas, pas: nbPas,
      plongement: Float32Array.from(plong, (v) => v / Math.max(1e-9, poidsTotal)),
    };
    const ms = performance.now() - t0;
    if (!this.aEcritEtat) {
      this.aEcritEtat = true;
      const duree = trames * 0.01;
      const mesure = { etape: 'modele_sons' as const, ms: Math.round(ms * 10) / 10, xTempsReel: Math.round((duree / Math.max(ms, 1e-3)) * 1000 * 10) / 10 };
      try { writeFileSync(join(this.dossier, FICHIER_ETAT), JSON.stringify({ aTourne: true, quand: new Date().toISOString(), mesure }), { mode: 0o600 }); } catch { /* état non bloquant */ }
    }
    return sortie;
  }

  /** Une fenêtre : jetons, blocs, tête. La main est rendue au serveur après chaque bloc (une passe ne fige jamais Odin d'un trait). */
  private async passe(x: Float32Array, trames: number, debut: number, long: number, signal?: AbortSignal): Promise<{ probas: Float32Array; parPas: Float32Array; pas: number; plongement: Float32Array; jetons: number }> {
    const D = this.dimension, F = this.nbF, H = this.tetes, hd = D / H;
    const Tp = Math.min(Math.floor(long / CARRE), this.nbT);
    const N = F * Tp;
    // 3. Carrés 16×16 → jetons (fréquence d'abord : jeton = f·Tp + t).
    const P = new Float32Array(N * CARRE * CARRE);
    for (let f = 0; f < F; f++) for (let t = 0; t < Tp; t++) {
      const ligne = (f * Tp + t) * CARRE * CARRE;
      for (let i = 0; i < CARRE; i++) {
        const m = f * CARRE + i;
        for (let j = 0; j < CARRE; j++) {
          const tt = debut + t * CARRE + j;
          P[ligne + i * CARRE + j] = tt < trames ? x[m * trames + tt] : 0;
        }
      }
    }
    let h = new Float32Array(N * D);
    noyaux().mm(h, P, this.carreWt, N, CARRE * CARRE, D);
    // 4. Positions (celles du temps tronquées à la fenêtre).
    for (let f = 0; f < F; f++) for (let t = 0; t < Tp; t++) {
      const r = (f * Tp + t) * D;
      for (let d = 0; d < D; d++) h[r + d] += this.carreB[d] + this.posF[d * F + f] + this.posT[d * this.nbT + t];
    }
    // 5. Blocs pré-normés.
    const n = new Float32Array(N * D);
    const echelle = 1 / Math.sqrt(hd);
    const Q = new Float32Array(N * hd), Kt = new Float32Array(hd * N), V = new Float32Array(N * hd);
    const S = new Float32Array(N * N), Oh = new Float32Array(N * hd), O = new Float32Array(N * D);
    for (const b of this.lesBlocs) {
      normaliser(n, h, N, D, b.n1g, b.n1b, 1e-6);
      const qkv = appliquer(b.qkv, n, N);
      for (let tete = 0; tete < H; tete++) {
        for (let i = 0; i < N; i++) for (let d = 0; d < hd; d++) {
          const base = i * 3 * D + tete * hd + d;
          Q[i * hd + d] = qkv[base] * echelle;
          Kt[d * N + i] = qkv[base + D];
          V[i * hd + d] = qkv[base + 2 * D];
        }
        noyaux().mm(S, Q, Kt, N, hd, N);
        for (let i = 0; i < N; i++) {
          let max = -Infinity;
          for (let j = 0; j < N; j++) if (S[i * N + j] > max) max = S[i * N + j];
          let s = 0;
          for (let j = 0; j < N; j++) { const e = Math.exp(S[i * N + j] - max); S[i * N + j] = e; s += e; }
          const inv = 1 / s;
          for (let j = 0; j < N; j++) S[i * N + j] *= inv;
        }
        noyaux().mm(Oh, S, V, N, N, hd);
        for (let i = 0; i < N; i++) for (let d = 0; d < hd; d++) O[i * D + tete * hd + d] = Oh[i * hd + d];
      }
      const a = appliquer(b.proj, O, N);
      for (let i = 0; i < h.length; i++) h[i] += a[i];
      normaliser(n, h, N, D, b.n2g, b.n2b, 1e-6);
      const m1 = appliquer(b.fc1, n, N);
      for (let i = 0; i < m1.length; i++) m1[i] = gelu(m1[i]);
      const m2 = appliquer(b.fc2, m1, N);
      for (let i = 0; i < h.length; i++) h[i] += m2[i];
      await ceder();
      verifierArret(signal);
    }
    // 6. Normalisation finale ; moyenne des jetons ; tête.
    const fin = new Float32Array(N * D);
    normaliser(fin, h, N, D, this.normG, this.normB, 1e-6);
    h = fin;
    const moy = new Float32Array(D);
    for (let i = 0; i < N; i++) for (let d = 0; d < D; d++) moy[d] += h[i * D + d] / N;
    const probas = this.teteSur(moy, 1);
    // Par pas de temps : moyenne des jetons de fréquence du même instant.
    const parT = new Float32Array(Tp * D);
    for (let f = 0; f < F; f++) for (let t = 0; t < Tp; t++) for (let d = 0; d < D; d++) parT[t * D + d] += h[(f * Tp + t) * D + d] / F;
    const parPas = this.teteSur(parT, Tp);
    return { probas, parPas, pas: Tp, plongement: moy, jetons: N };
  }

  /** Tête : normalisation (1e-5), couche linéaire, sigmoïde. */
  private teteSur(v: Float32Array, lignes: number): Float32Array {
    const D = this.dimension;
    const n = new Float32Array(lignes * D);
    normaliser(n, v, lignes, D, this.teteNG, this.teteNB, 1e-5);
    const y = appliquer(this.tete, n, lignes);
    for (let i = 0; i < y.length; i++) y[i] = sigmoide(y[i]);
    return y;
  }
}
