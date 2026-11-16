// L'interface publique de Noûs (le contrat A↔B) et la façade qui parle au worker de calcul.
//
// Noûs est le cerveau PROFOND d'Odin : un petit Transformer entraîné sur cette machine. Ce fichier est la frontière
// du lot « moteur » : le lot « vie » (entraînement, duel, pages) consomme UNIQUEMENT ce qui est exporté ici. Le
// calcul lourd tourne dans un worker (src/brain/nous/calcul.ts) : il ne gêne JAMAIS le fil principal d'Odin ; il
// s'arrête dès qu'on le lui demande (drapeau en mémoire partagée) ; une panne du worker arrête Noûs, jamais Odin.

import { Worker } from 'node:worker_threads';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Embedder } from '../../muninn/embed.ts';
import { avecPoids, hyperDe, mesurerEtChoisir, TAILLES, type Hyper, type TailleNom } from './tailles.ts';
import { apprendreDecoupage, serialiserDecoupage, type DecoupageConcret, type DecoupageSerialise } from './decoupage.ts';
import { lireReprise } from './reprise.ts';
import { embedderNoos } from './plongement.ts';

export { TAILLES, mesurerEtChoisir, apprendreDecoupage, embedderNoos };
export type { Hyper, TailleNom };

// ----------------------------------------------------------------------------------------------------------------
// §1 — Interface du moteur (lot A écrit, lot B consomme).
// ----------------------------------------------------------------------------------------------------------------

export interface Decoupage { readonly vocab: number; readonly version: number; encoder(texte: string): Int32Array; decoder(ids: ArrayLike<number>): string }
export interface Demande { texte: string; maxMorceaux?: number; delaiMs?: number; signal?: AbortSignal; graine?: number }
export interface Proposition { texte: string; confiance: number; logprob: number; morceaux: number; tempsMs: number; pret: boolean }

export interface Moteur {
  readonly hyper: Hyper;
  readonly version: number;
  readonly modeleEmbedding: string; // 'noos-v<n>'
  readonly pret: boolean; // false tant qu'aucun point de reprise valable n'est en service
  proposer(d: Demande): Promise<Proposition>;
  completer(amorce: string, n: number, o?: { delaiMs?: number; signal?: AbortSignal; graine?: number }): Promise<string>;
  plonger(texte: string, signal?: AbortSignal): Promise<Float32Array>;
  scoreDe(demande: string, reponse: string): Promise<number>;
  arreter(): Promise<void>;
}

// ----------------------------------------------------------------------------------------------------------------
// §2 — Interface d'entraînement (lot A écrit, lot B pilote).
// ----------------------------------------------------------------------------------------------------------------

export interface Lot { entrees: Int32Array[]; roles?: Int32Array[]; poidsExemple?: Float32Array }
export interface SeanceOpts { dureeMs: number; fils: number; signal: AbortSignal; graine: number }
export interface Avancee { pas: number; morceauxVus: number; perte: number; tempsMs: number; interrompue: boolean }

export interface Entraineur extends Pick<Moteur, 'hyper' | 'proposer' | 'completer' | 'plonger' | 'scoreDe'> {
  seance(lots: Iterable<Lot> | AsyncIterable<Lot>, o: SeanceOpts): Promise<Avancee>;
  perteSur(jeu: Int32Array[]): Promise<number>;
  ecrire(n: number): Promise<string>;
  revenirA(n: number): Promise<void>;
}

// ----------------------------------------------------------------------------------------------------------------
// La façade (côté fil principal) : traduit les appels en messages, gère l'arrêt par signal, garde l'état « prêt ».
// ----------------------------------------------------------------------------------------------------------------

const homeDefaut = (): string => process.env.ODIN_HOME ?? join(homedir(), '.odin');

interface InitArgs {
  hyper: Hyper;
  decoupage: DecoupageSerialise;
  graine: number;
  home: string;
  fresh?: number; // graine d'initialisation si réseau neuf
  poidsInit?: Float32Array; // poids à charger (point de reprise)
  moments?: { m: Float32Array; v: Float32Array; pas: number };
  courbe?: Array<{ pas: number; perte: number }>;
  modeleVersion: number;
  pretInit: boolean;
}

class Facade implements Moteur, Entraineur {
  readonly hyper: Hyper;
  readonly home: string;
  private worker: Worker;
  private sabCtrl = new SharedArrayBuffer(16);
  private ctrl = new Int32Array(this.sabCtrl);
  private sabPoids: SharedArrayBuffer;
  private attentes = new Map<number, { ok: (v: unknown) => void; ko: (e: unknown) => void }>();
  private prochainId = 1;
  private mort = false;
  private modeleVersion: number;
  private _pret: boolean;
  private initFait: Promise<void>;

  constructor(a: InitArgs) {
    this.hyper = a.hyper;
    this.home = a.home;
    this.modeleVersion = a.modeleVersion;
    this._pret = a.pretInit;
    this.sabPoids = new SharedArrayBuffer(a.hyper.poids * 4);
    if (a.poidsInit) new Float32Array(this.sabPoids).set(a.poidsInit);
    this.worker = new Worker(new URL('./calcul.ts', import.meta.url), {
      name: 'noos',
      resourceLimits: { maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 128 },
    });
    this.worker.on('message', (m: { type: string; id?: number; valeur?: unknown; message?: string }) => {
      if (m.type === 'reponse' || m.type === 'erreur') {
        const id = m.id ?? 0, att = this.attentes.get(id);
        if (!att) return;
        this.attentes.delete(id); this.ajusterRef();
        if (m.type === 'erreur') att.ko(new Error(m.message ?? 'erreur de Noûs')); else att.ok(m.valeur);
      }
    });
    this.worker.on('error', (e) => this.tomber(e));
    this.worker.on('messageerror', (e) => this.tomber(e));
    this.worker.unref();
    this.initFait = this.envoyer('init', {
      hyper: a.hyper, sab: this.sabPoids, ctrl: this.sabCtrl, decoupage: a.decoupage,
      fresh: a.fresh, moments: a.moments, graine: a.graine, courbe: a.courbe,
    }).then(() => undefined);
  }

  get version(): number { return this.modeleVersion; }
  get modeleEmbedding(): string { return `noos-v${this.modeleVersion}`; }
  get pret(): boolean { return this._pret; }

  private tomber(e: unknown): void {
    if (this.mort) return;
    this.mort = true;
    console.error(`[noos] le worker de calcul s'est arrêté : ${String((e as Error)?.message ?? e)} — Noûs est mis en pause, Odin continue.`);
    for (const att of this.attentes.values()) att.ko(new Error('Noûs arrêté'));
    this.attentes.clear();
    try { void this.worker.terminate(); } catch { /* déjà terminé */ }
  }

  private ajusterRef(): void {
    if (this.mort) return;
    if (this.attentes.size > 0) this.worker.ref(); else this.worker.unref();
  }

  /** Envoie un ordre au worker et attend sa réponse. `signal` arrête l'opération via le drapeau partagé. */
  private envoyer(type: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.mort) return Promise.reject(new Error('Noûs arrêté'));
    const id = this.prochainId++;
    // Drapeau d'arrêt PAR OPÉRATION : ctrl[0] porte l'identifiant de l'opération à abandonner (jamais un simple
    // 0/1). Ainsi, mettre une opération en file (ex. proposer) n'efface pas l'abandon d'une opération encore en
    // cours (ex. une séance) : le worker ne s'arrête que si ctrl[0] vaut l'identifiant de l'opération qu'il exécute.
    return new Promise<unknown>((ok, ko) => {
      const onAbort = (): void => { Atomics.store(this.ctrl, 0, id); };
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      const fini = (f: () => void): void => { if (signal) signal.removeEventListener('abort', onAbort); f(); };
      this.attentes.set(id, { ok: (v) => fini(() => ok(v)), ko: (e) => fini(() => ko(e)) });
      this.ajusterRef();
      try { this.worker.postMessage({ type, id, ...payload }); } catch (e) { this.attentes.delete(id); this.ajusterRef(); fini(() => ko(e)); }
    });
  }

  // --- Moteur ---
  async proposer(d: Demande): Promise<Proposition> {
    await this.initFait;
    const v = await this.envoyer('proposer', { demande: { texte: d.texte, maxMorceaux: d.maxMorceaux, delaiMs: d.delaiMs, graine: d.graine } }, d.signal);
    return v as Proposition;
  }
  async completer(amorce: string, n: number, o?: { delaiMs?: number; signal?: AbortSignal; graine?: number }): Promise<string> {
    await this.initFait;
    return (await this.envoyer('completer', { amorce, n, delaiMs: o?.delaiMs, graine: o?.graine }, o?.signal)) as string;
  }
  async plonger(texte: string, signal?: AbortSignal): Promise<Float32Array> {
    await this.initFait;
    return (await this.envoyer('plonger', { texte }, signal)) as Float32Array;
  }
  async scoreDe(demande: string, reponse: string): Promise<number> {
    await this.initFait;
    return (await this.envoyer('score', { demande, reponse })) as number;
  }
  async arreter(): Promise<void> {
    if (this.mort) return;
    try { await this.envoyer('arreter', {}); } catch { /* peu importe */ }
    this.mort = true;
    try { await this.worker.terminate(); } catch { /* déjà terminé */ }
  }

  // --- Entraineur ---
  async seance(lots: Iterable<Lot> | AsyncIterable<Lot>, o: SeanceOpts): Promise<Avancee> {
    await this.initFait;
    const liste: Lot[] = [];
    if (Symbol.asyncIterator in (lots as object)) { for await (const l of lots as AsyncIterable<Lot>) liste.push(l); }
    else for (const l of lots as Iterable<Lot>) liste.push(l);
    // o.fils est accepté (contrat), mais l'entraînement tourne aujourd'hui sur UN seul worker (les poids sont déjà en
    // mémoire partagée pour permettre d'ajouter plus tard un petit pool de fils qui se partagent les gradients).
    const v = await this.envoyer('seance', { lots: liste, reglages: { dureeMs: o.dureeMs, graine: o.graine } }, o.signal);
    return v as Avancee;
  }
  async perteSur(jeu: Int32Array[]): Promise<number> {
    await this.initFait;
    return (await this.envoyer('perteSur', { jeu })) as number;
  }
  async ecrire(n: number): Promise<string> {
    await this.initFait;
    const chemin = (await this.envoyer('ecrire', { home: this.home, n })) as string;
    this._pret = true; // un point de reprise valable est désormais en service
    return chemin;
  }
  async revenirA(n: number): Promise<void> {
    await this.initFait;
    await this.envoyer('revenirA', { home: this.home, n });
    this._pret = true;
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Fabriques.
// ----------------------------------------------------------------------------------------------------------------

/** Un entraîneur tout neuf (réseau initialisé au hasard à la graine). Les poids se rangeront dans home (défaut ~/.odin). */
export function nouvelEntraineur(hyper: Hyper, decoupage: Decoupage, graine: number, home: string = homeDefaut()): Entraineur {
  const h = avecPoids(hyper);
  return new Facade({
    hyper: h, home, graine, fresh: graine, modeleVersion: 1, pretInit: false,
    decoupage: serialiserDecoupage(decoupage as DecoupageConcret),
  });
}

/** Le moteur à partir du dernier point de reprise valable, ou undefined si aucun n'existe. */
export async function chargerMoteur(home: string): Promise<Moteur | undefined> {
  const ck = await lireReprise(home);
  if (!ck) return undefined;
  return new Facade({
    hyper: ck.hyper, home, graine: ck.graine, modeleVersion: ck.modeleVersion, pretInit: true,
    decoupage: serialiserDecoupage(ck.decoupage), poidsInit: ck.poids, moments: { m: ck.m, v: ck.v, pas: ck.pas }, courbe: ck.courbe,
  });
}

/** Un entraîneur qui REPREND le dernier point de reprise ; s'il n'y en a pas, un réseau neuf (taille mesurée). */
export async function chargerEntraineur(home: string): Promise<Entraineur> {
  const ck = await lireReprise(home);
  if (ck) {
    return new Facade({
      hyper: ck.hyper, home, graine: ck.graine, modeleVersion: ck.modeleVersion, pretInit: true,
      decoupage: serialiserDecoupage(ck.decoupage), poidsInit: ck.poids, moments: { m: ck.m, v: ck.v, pas: ck.pas }, courbe: ck.courbe,
    });
  }
  const hyper = await mesurerEtChoisir();
  const decoupage = apprendreDecoupage([], hyper.vocab, 0x0d1a); // découpage de base (octets) ; le lot « vie » apprendra le vrai
  return nouvelEntraineur(hyper, decoupage, 0x0d1a, home);
}

/** Un gabarit nommé, poids compris (utile aux essais et au lot « vie »). */
export function gabarit(taille: TailleNom): Hyper { return hyperDe(taille); }
