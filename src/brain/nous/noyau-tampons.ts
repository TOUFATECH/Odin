// Les tampons de calcul de Noûs, gardés en mémoire vive d'une suite à l'autre.
//
// Pourquoi : une suite d'entraînement (perte + gradients) du gabarit « moyen » demande près de 390 tableaux, environ
// 40 Mo en tout, que le calcul d'avant allouait (et faisait remettre à zéro par le système) à chaque suite, puis
// laissait au ramasse-miettes. Mesuré sur une maquette : environ 12 % du temps d'une suite. Ici, ces tableaux sont
// gardés et resservent à la suite suivante, remis à zéro comme des neufs : le calcul est exactement le même.
//
// Comment : à l'intérieur d'une « portée » (ouvrir … fermer), le i-ième tableau demandé est toujours le i-ième tampon
// gardé (le calcul d'une suite demande ses tableaux toujours dans le même ordre ; une suite plus courte prend le début
// des mêmes tampons). Chaque tableau rendu est une vue de la bonne longueur, remise à zéro. Deux tableaux vivants
// d'une même portée n'ont jamais le même tampon ; rien de ce qui sort d'une portée n'y est pris (le réseau ne passe
// par ici que pour ses calculs intérieurs : poids, gradients, logits rendus à l'appelant restent des tableaux neufs).
// Hors portée : un tableau neuf, comme avant.
//
// Mémoire : chaque agrandissement est demandé au comptable de la mémoire d'Odin (src/brain/budget-memoire.ts), par
// paliers ; refusé, le calcul continue avec des tableaux neufs (juste, seulement plus lent). Sous pression, tout est
// rendu. Quand le réseau disparaît, sa part est rendue. Plafond par réseau : TAMPONS_MAX_MO.
//
// UN SEUL compte pour tous les fils. Le comptable vit dans le fil principal d'Odin (c'est là que les autres caches
// réservent). Les fils de calcul (le fil du moteur, les fils d'aide) ne l'importent pas : ils tiennent leur part dans
// un petit registre en mémoire partagée, créé par le fil principal :
//   - R[UTILISE] : ce que tous les fils de calcul tiennent ensemble (Mo) ; R[PERMIS] : ce que le fil principal a
//     réservé pour eux auprès du comptable, sous le nom NOM_FILS ; R[PRESSION] : monte à chaque pression.
//   - chaque fil a sa case : ce qu'il tient, ce qu'il voudrait tenir, son numéro. Un fil prend sa part sans attendre
//     (opération atomique) tant que UTILISE + part ≤ PERMIS. Sinon la portée continue avec des tableaux neufs, note ce
//     qu'il lui aurait fallu, et le dit en se fermant (message sur un canal de diffusion) : le fil principal redemande
//     au comptable la somme de ce que les fils tiennent ou voudraient ; la portée suivante en profite s'il a dit oui.
//   - ce qu'un fil rend fait redescendre la réservation ; sous pression, le permis tombe à 0 et chaque fil vide ses
//     tampons à sa prochaine portée (ou au coup d'œil suivant, s'il est au repos).
//   - un fil d'aide reçoit sa case de celui qui le lance, qui la relit et rend ce qu'elle tient quand il l'arrête (un
//     fil arrêté de force ne rend rien de lui-même). Le fil du moteur rend tout à l'ordre d'arrêt.
// Le registre arrive au fil du moteur par le canal, aux fils d'aide par leurs données de départ. Sans registre (fil
// principal qui n'a pas chargé ce fichier) ou sans comptable (fichier absent, interface changée), un REPLI local
// tient le compte : jamais plus de REPLI_MAX_MO pour tous les tampons de son fil, refus quand la mémoire libre de la
// machine passe sous la marge. Dans le fil principal, le repli porte aussi la réservation des autres fils : tout
// ensemble reste alors sous REPLI_MAX_MO.
// ODIN_SOUL_TAMPONS=non coupe tout (chemin d'avant : tableaux neufs). ODIN_SOUL_GEL=non coupe, à part, les copies de
// travail des poids gardées dans le fil du moteur (calcul.ts) : chacun des deux gains se mesure seul.

import { freemem } from 'node:os';
import { BroadcastChannel, isMainThread, threadId, workerData } from 'node:worker_threads';

/** Plafond des tampons d'un réseau (Mo). Gabarits petit, moyen : environ 16 et 40 Mo ; « grand » : de 80 à plus de
 *  200 Mo selon le contexte (mesuré : 218 Mo au contexte de 384). Au-delà du plafond : tableaux neufs. */
export const TAMPONS_MAX_MO = 256;
/** Repli sans comptable : plafond de tous les tampons de ce fil ensemble (Mo), et marge de mémoire libre. */
export const REPLI_MAX_MO = 256;
const REPLI_MARGE_MO = 512;
/** Palier de réservation (Mo) : on ne redemande pas au comptable à chaque tableau. */
const PALIER_MO = 8;
const MO = 1_048_576;
/** Nom de la réservation que le fil principal fait pour les tampons de tous les fils de calcul. */
export const NOM_FILS = 'soul-tampons-fils';
const CANAL = 'odin-soul-tampons';
const UTILISE = 0, PERMIS = 1, PRESSION = 2;
/** La case d'un fil de calcul : ce qu'il tient, ce qu'il voudrait tenir (Mo), son numéro de fil. */
const TIENT = 0, VEUT = 1, ID = 2;

interface Comptable {
  reserver(nom: string, mo: number): boolean; rendre(nom: string): void; surPression(fn: () => void): void;
  /** (registre seulement) Ce qu'une portée refusée aurait voulu : demandé au fil principal pour la suivante. */
  prevoir?(nom: string, mo: number): void;
}

// --- Le repli local (sans comptable ou sans registre). ---
const repliReserves = new Map<string, number>();
const repli: Comptable = {
  reserver(nom, mo) {
    let autres = 0; for (const [k, v] of repliReserves) if (k !== nom) autres += v;
    const avant = repliReserves.get(nom) ?? 0;
    if (mo > avant && (autres + mo > REPLI_MAX_MO || freemem() / MO - (mo - avant) < REPLI_MARGE_MO)) return false;
    repliReserves.set(nom, mo); return true;
  },
  rendre(nom) { repliReserves.delete(nom); },
  surPression() { /* le repli refuse sous la marge ; rien à prévenir */ },
};
let comptable: Comptable = repli;
let source: 'repli' | 'comptable' | 'registre' = 'repli';

/** D'où vient le compte (essais, banc) : le comptable (fil principal), le registre partagé (fils de calcul), le repli. */
export function sourceComptable(): 'repli' | 'comptable' | 'registre' { return source; }

// --- Les tampons vivants de ce fil (tenus faiblement : un réseau disparu n'est pas retenu, ni suivi). ---
const tous = new Set<WeakRef<Tampons>>();
function* vivants(): Generator<Tampons> { for (const w of tous) { const t = w.deref(); if (t) yield t; else tous.delete(w); } }
const disparus = typeof FinalizationRegistry === 'function'
  ? new FinalizationRegistry<{ nom: string; ref: WeakRef<Tampons> }>(({ nom, ref }) => { tous.delete(ref); comptable.rendre(nom); repli.rendre(nom); })
  : undefined;
let prochain = 1;
/** Nombre de réseaux suivis dans ce fil (essais : un réseau disparu n'y reste pas). */
export function suivis(): number { return tous.size; }

/** Le comptable change (il arrive, ou le registre arrive) : les réservations passent chez lui, ou sont rendues. */
function adopter(c: Comptable, s: 'comptable' | 'registre'): void {
  for (const t of vivants()) t.changerDeComptable(c);
  comptable = c; source = s;
  c.surPression(() => { for (const t of vivants()) t.vider(); });
}

// ================================================================================================================
// Fil principal : le comptable d'Odin, et le registre des fils de calcul.
// ================================================================================================================
let registreSab: SharedArrayBuffer | undefined;
let R: Int32Array | undefined;
let canal: BroadcastChannel | undefined;
/** (fil principal) Recompte ce que veulent les fils de calcul et ajuste leur réservation auprès du comptable. */
let recompterFils: (() => void) | undefined;
/** (fil principal) Les cases des fils de calcul connus, par numéro de fil. */
const cases = new Map<number, Int32Array>();
function inscrire(part: unknown): void {
  if (!(part instanceof SharedArrayBuffer) || part.byteLength < 12) return;
  const c = new Int32Array(part, 0, 3), id = Atomics.load(c, ID);
  if (id > 0 && !cases.has(id)) cases.set(id, c);
}

if (isMainThread) {
  registreSab = new SharedArrayBuffer(16); R = new Int32Array(registreSab);
  const Rm = R;
  // La réservation des fils = pour chacun, le plus grand de ce qu'il tient et de ce qu'il voudrait tenir ; jamais moins
  // que ce qu'ils tiennent ensemble. Plus grande : redemandée au comptable (refusée : les fils attendront, avec des
  // tableaux neufs) ; plus petite : la différence est rendue.
  const recompter = recompterFils = (): void => {
    let total = 0;
    for (const [id, c] of cases) {
      const t = Atomics.load(c, TIENT), v = Atomics.load(c, VEUT);
      if (t <= 0 && v <= 0) { cases.delete(id); continue; } // fil arrêté ou vide : il se réinscrira s'il revient
      total += Math.max(t, v);
    }
    const voulu = Math.max(total, Atomics.load(Rm, UTILISE)), permis = Atomics.load(Rm, PERMIS);
    if (voulu === permis) return;
    if (voulu === 0) { Atomics.store(Rm, PERMIS, 0); comptable.rendre(NOM_FILS); return; }
    if (comptable.reserver(NOM_FILS, voulu)) Atomics.store(Rm, PERMIS, voulu);
  };
  const pression = (): void => { Atomics.store(Rm, PERMIS, 0); Atomics.add(Rm, PRESSION, 1); comptable.rendre(NOM_FILS); };
  canal = new BroadcastChannel(CANAL);
  canal.unref();
  canal.onmessage = (e: unknown): void => {
    const m = (e as { data?: { type?: string; part?: unknown } }).data;
    if (m?.type === 'registre?') canal?.postMessage({ type: 'registre', sab: registreSab });
    else if (m?.type === 'besoin') { inscrire(m.part); recompter(); }
  };
  // Le comptable : chargé sans l'exiger (il peut manquer ou changer) ; le repli compte en attendant ou à défaut.
  // (Chemin calculé : le comptable n'est exigé ni au chargement ni à la vérification des types.)
  const CHEMIN_COMPTABLE = new URL('../budget-memoire.ts', import.meta.url).href;
  void import(CHEMIN_COMPTABLE).then((m: Partial<Record<keyof Comptable, unknown>>) => {
    if (typeof m.reserver !== 'function' || typeof m.rendre !== 'function' || typeof m.surPression !== 'function') return;
    const c = m as unknown as Comptable;
    // Le permis des fils, tenu par le repli en attendant, passe au comptable (ou tombe à 0 s'il refuse).
    const permis = Atomics.load(Rm, PERMIS);
    repli.rendre(NOM_FILS);
    if (permis > 0 && !c.reserver(NOM_FILS, permis)) pression();
    adopter(c, 'comptable');
    c.surPression(pression);
  }, () => { /* comptable absent : le repli reste */ });
}

// ================================================================================================================
// Fils de calcul : le registre (reçu du fil principal), et la case de ce fil.
// ================================================================================================================
let caseSab: SharedArrayBuffer | undefined;
const mesParts = new Map<string, number>();
const mesVoulus = new Map<string, number>();
let presVue = 0;
const avertisFil = new Set<() => void>();

/** Le comptable d'un fil de calcul : la part de chacun, prise et rendue dans le registre partagé. */
function clientRegistre(Rf: Int32Array, c: Int32Array): Comptable {
  // VEUT = pour chaque réseau de ce fil, le plus grand de ce qu'il tient et de ce qu'il a demandé.
  const majVeut = (): void => {
    let v = 0;
    for (const [n, p] of mesParts) v += Math.max(p, mesVoulus.get(n) ?? 0);
    for (const [n, w] of mesVoulus) if (!mesParts.has(n)) v += w;
    Atomics.store(c, VEUT, v);
  };
  const signaler = (): void => { canal?.postMessage({ type: 'besoin', part: caseSab }); };
  return {
    reserver(nom, mo) {
      const avant = mesParts.get(nom) ?? 0, delta = mo - avant;
      if (delta > 0) {
        for (;;) {
          const u = Atomics.load(Rf, UTILISE);
          if (u + delta > Atomics.load(Rf, PERMIS)) return false; // pas assez de permis : la portée dira ce qu'il lui faut
          if (Atomics.compareExchange(Rf, UTILISE, u, u + delta) === u) break;
        }
      } else if (delta < 0) Atomics.sub(Rf, UTILISE, -delta);
      Atomics.add(c, TIENT, delta);
      mesParts.set(nom, mo); majVeut();
      if (delta < 0) signaler();
      return true;
    },
    prevoir(nom, mo) {
      // Déjà demandé (ou tenu) : on redit seulement le besoin si le permis est tombé (pression passée, fil réinscrit).
      if (mo <= Math.max(mesParts.get(nom) ?? 0, mesVoulus.get(nom) ?? 0)) { if (Atomics.load(Rf, PERMIS) < Atomics.load(c, VEUT)) signaler(); return; }
      mesVoulus.set(nom, mo); majVeut(); signaler();
    },
    rendre(nom) {
      const avant = mesParts.get(nom) ?? 0;
      const voulait = mesVoulus.delete(nom);
      mesParts.delete(nom);
      if (avant > 0) { Atomics.sub(Rf, UTILISE, avant); Atomics.sub(c, TIENT, avant); }
      majVeut();
      if (avant > 0 || voulait) signaler();
    },
    surPression(fn) { avertisFil.add(fn); },
  };
}

/** Une pression vue par le fil principal depuis le dernier coup d'œil : ce fil vide ses tampons. */
function verifierPression(): void {
  if (!R || isMainThread) return;
  const p = Atomics.load(R, PRESSION);
  if (p === presVue) return;
  presVue = p;
  for (const fn of [...avertisFil]) { try { fn(); } catch { /* un réseau qui échoue à se vider n'empêche pas les autres */ } }
}

function adopterRegistre(sab: SharedArrayBuffer): void {
  if (R || isMainThread) return;
  registreSab = sab; R = new Int32Array(sab); presVue = Atomics.load(R, PRESSION);
  caseSab ??= nouvellePart();
  const c = new Int32Array(caseSab, 0, 3);
  Atomics.store(c, ID, threadId);
  adopter(clientRegistre(R, c), 'registre');
  // Un fil au repos (aucune portée) voit aussi la pression : coup d'œil régulier, qui ne retient pas le fil ouvert.
  setInterval(verifierPression, 2000).unref();
}

let registreArrive: (() => void) | undefined;
const registrePret = new Promise<void>((ok) => { registreArrive = ok; });

if (!isMainThread) {
  const wd = workerData as { registreTampons?: unknown; partTampons?: unknown } | undefined;
  if (wd?.partTampons instanceof SharedArrayBuffer && wd.partTampons.byteLength >= 12) caseSab = wd.partTampons;
  canal = new BroadcastChannel(CANAL);
  canal.unref();
  if (wd?.registreTampons instanceof SharedArrayBuffer) { adopterRegistre(wd.registreTampons); registreArrive?.(); }
  else {
    canal.onmessage = (e: unknown): void => {
      const m = (e as { data?: { type?: string; sab?: unknown } }).data;
      if (m?.type === 'registre' && m.sab instanceof SharedArrayBuffer) { adopterRegistre(m.sab); registreArrive?.(); }
    };
    canal.postMessage({ type: 'registre?' });
  }
}

/** Ce que les fils de calcul tiennent ensemble et ce que le fil principal a réservé pour eux (Mo) ; banc, essais. */
export function etatRegistre(): { utiliseMo: number; permisMo: number } | undefined {
  return R ? { utiliseMo: Atomics.load(R, UTILISE), permisMo: Atomics.load(R, PERMIS) } : undefined;
}

/** Le registre de ce fil (pour le donner aux fils d'aide qu'il lance), s'il l'a. */
export function registreTampons(): SharedArrayBuffer | undefined { return registreSab; }

/** Attend le registre (fil du moteur, au démarrage), au plus `ms` : rend true s'il est là. */
export async function attendreRegistre(ms: number): Promise<boolean> {
  if (R) return true;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([registrePret, new Promise<void>((ok) => { minuterie = setTimeout(ok, ms); })]);
  if (minuterie) clearTimeout(minuterie);
  return R !== undefined;
}

/** Une case pour un fil de calcul (lancée avant lui, pour un fil d'aide) : [ce qu'il tient, ce qu'il veut, son numéro]. */
export function nouvellePart(): SharedArrayBuffer { return new SharedArrayBuffer(12); }

/** Le fil d'aide est arrêté : ce qu'il tenait encore est rendu au registre (il ne peut plus le faire lui-même). */
export function rendrePart(part: SharedArrayBuffer | undefined): void {
  if (!part || part.byteLength < 12 || !R) return;
  const c = new Int32Array(part, 0, 3);
  const mo = Atomics.exchange(c, TIENT, 0);
  Atomics.store(c, VEUT, 0);
  if (mo > 0) Atomics.sub(R, UTILISE, mo);
  if (isMainThread) { inscrire(part); recompterFils?.(); } else canal?.postMessage({ type: 'besoin', part });
}

/** Le fil s'arrête (ordre d'arrêt du moteur) : tous ses tampons sont rendus. */
export function rendreTout(): void { for (const t of vivants()) t.vider(); }

/** Coupé par ODIN_SOUL_TAMPONS=non (lu à la création de chaque réseau). */
export function tamponsActifs(): boolean { return process.env.ODIN_SOUL_TAMPONS !== 'non'; }
/** Les copies de travail des poids gardées d'un appel à l'autre dans le fil du moteur (calcul.ts, ordre 'init').
 *  Coupé par ODIN_SOUL_GEL=non, à part des tampons : chacun des deux gains se mesure seul. */
export function gelActif(): boolean { return process.env.ODIN_SOUL_GEL !== 'non'; }

export class Tampons {
  readonly nom: string;
  private bufs: Float32Array[] = [];
  private curseur = 0;
  private profondeur = 0;
  /** Octets tenus par les tampons ; octets réservés auprès du comptable (palier au-dessus). */
  private tenus = 0;
  private reserves = 0;
  /** Refus du comptable (ou pression) pendant la portée en cours : la suite de la portée prend des tableaux neufs. */
  private refus = false;
  /** Refus venu du compte (pas du plafond) : ce que la portée aurait voulu tenir, demandé en la fermant. */
  private refusCompte = false;
  private besoin = 0;
  private readonly actif: boolean;
  private readonly maxOctets: number;

  constructor(o: { actif?: boolean; maxMo?: number } = {}) {
    this.nom = `soul-tampons#${threadId}.${prochain++}`;
    this.actif = o.actif ?? tamponsActifs();
    this.maxOctets = Math.max(0, o.maxMo ?? TAMPONS_MAX_MO) * MO;
    if (this.actif) { const ref = new WeakRef(this); tous.add(ref); disparus?.register(this, { nom: this.nom, ref }); }
  }

  /** Ouvre une portée (imbriquable : seule la plus extérieure remet le curseur au début en se fermant). */
  ouvrir(): void { if (this.profondeur++ === 0 && this.actif) verifierPression(); }
  fermer(): void {
    if (this.profondeur > 0 && --this.profondeur === 0) {
      if (this.refusCompte && this.besoin > this.reserves) comptable.prevoir?.(this.nom, Math.ceil(Math.min(this.besoin, this.maxOctets) / (PALIER_MO * MO)) * PALIER_MO);
      this.curseur = 0; this.refus = false; this.refusCompte = false; this.besoin = 0;
    }
  }
  /** f() dans une portée. */
  dans<T>(f: () => T): T { this.ouvrir(); try { return f(); } finally { this.fermer(); } }

  /** Un Float32Array de `n` zéros : un tampon gardé dans une portée, un tableau neuf sinon. */
  prendre(n: number): Float32Array {
    if (!this.actif || this.profondeur === 0) return new Float32Array(n);
    if (this.refus) {
      // Refusé par le compte : on note ce que la portée aurait tenu (tampons déjà là et assez grands : rien de plus).
      if (this.refusCompte) { const b = this.bufs[this.curseur++]; this.besoin += 4 * n - (b ? Math.min(b.byteLength, 4 * n) : 0); }
      return new Float32Array(n);
    }
    const i = this.curseur;
    const b = this.bufs[i];
    if (b && b.length >= n) { this.curseur++; const v = b.subarray(0, n); v.fill(0); return v; }
    // Tampon neuf ou trop petit : la place de plus est demandée d'abord (au palier au-dessus). Refusée : le reste de
    // la portée prend des tableaux neufs. (Les tampons se suivent sans trou : i ≤ nombre de tampons, toujours.)
    const apres = this.tenus - (b ? b.byteLength : 0) + 4 * n;
    if (i > this.bufs.length || apres > this.maxOctets) { this.refus = true; return new Float32Array(n); }
    if (!this.assurer(apres)) { this.refus = true; this.refusCompte = true; this.besoin = apres; this.curseur++; return new Float32Array(n); }
    if (this.refus) return new Float32Array(n); // vidé pendant la demande (pression)
    const nb = new Float32Array(n);
    this.bufs[i] = nb; this.tenus = apres; this.curseur++;
    return nb;
  }

  private assurer(octets: number): boolean {
    if (octets <= this.reserves) return true;
    const palier = Math.ceil(octets / (PALIER_MO * MO)) * PALIER_MO;
    if (!comptable.reserver(this.nom, palier)) return false;
    this.reserves = palier * MO;
    return true;
  }

  /** Rend tout (pression, réseau qui n'en a plus besoin) ; une portée en cours continue avec des tableaux neufs. */
  vider(): void {
    this.bufs = []; this.tenus = 0; this.reserves = 0;
    if (this.profondeur > 0) this.refus = true; else this.curseur = 0;
    comptable.rendre(this.nom);
  }

  /** Le comptable change (il était absent au départ) : la réservation passe chez lui, ou tout est rendu. */
  changerDeComptable(c: Comptable): void {
    const mo = this.reserves / MO;
    repli.rendre(this.nom);
    if (mo > 0 && !c.reserver(this.nom, mo)) { this.bufs = []; this.tenus = 0; this.reserves = 0; if (this.profondeur > 0) this.refus = true; }
  }

  /** Octets tenus / réservés, et nombre de tampons (essais, banc). */
  get etat(): { tenus: number; reserves: number; tampons: number } { return { tenus: this.tenus, reserves: this.reserves, tampons: this.bufs.length }; }
}
