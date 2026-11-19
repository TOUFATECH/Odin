// Le journal des actions : chaque action ENGAGEANTE (écrire, exécuter, envoyer) reçoit un numéro, l'empreinte À CLÉ
// (HMAC-SHA-256) de l'outil, de ses paramètres exacts (mis en forme canonique : clés triées, sans espaces) et du tour. Elle est notée
// « lancée » sur le disque (écrite puis forcée) AVANT d'agir, puis « faite » ou « échouée » après. Ainsi :
//   - une action déjà faite (ou échouée, ou en cours) dans un tour n'y est jamais refaite seule : la question est posée
//     au propriétaire (sa décision du 19/11 : « Me demander ») ; sans personne pour répondre, refusée ;
//   - après un redémarrage, une action « faite » par le processus d'avant n'est jamais refaite ; une action « lancée »
//     sans suite (coupée en plein milieu par une panne) est « à confirmer » : jamais rejouée seule, la question est
//     posée au propriétaire (src/heimdall/executer.ts) ;
//   - deux appels identiques en même temps : un seul est décidé à la fois, l'autre attend son issue ;
//   - un « oui » porte le numéro de l'action qu'il a vue (src/heimdall/approbations.ts).
// Les paramètres ne sont gardés qu'en empreinte (jamais en clair : ils peuvent porter un secret), avec un résumé masqué.
// L'empreinte est à clé : sans clé, un code court (PIN, code d'alarme, code reçu par SMS) se retrouverait en essayant
// toutes les valeurs. La clé est rangée dans le dossier d'Odin (<dossier d'Odin>/tours-actions.cle), hors de la mémoire,
// chiffrée par la clé de la machine (src/vault.ts, rangée à part) ; elle reste la même d'un démarrage à l'autre, pour
// reconnaître une action coupée par une panne.
// Les lectures ne sont pas notées. En mode privé (ou sans mémoire sur le disque), rien n'est écrit : le journal ne vit
// qu'en mémoire vive, et l'action n'est toujours pas refaite dans le tour.
//
// Rangement : <mémoire>/tours-actions.jsonl, une ligne JSON par changement, en ajout seul (rien n'est réécrit).
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../vault.ts';

export const FICHIER_ACTIONS = 'tours-actions.jsonl';
/** Les niveaux de risque engageants (les mêmes que ENGAGEANT dans policy.ts) : seuls ceux-là sont notés. */
export const RISQUES_ENGAGEANTS: ReadonlySet<string> = new Set(['write', 'exec', 'external']);

export type EtatAction = 'lancée' | 'faite' | 'échouée';
/** L'état lu : « en cours » (lancée par ce processus), « à confirmer » (lancée avant une panne, jamais finie). */
export type EtatLu = 'en cours' | 'à confirmer' | 'faite' | 'échouée';

export interface LigneAction { n: string; tour: string; outil: string; etat: EtatAction; t: number; resume?: string }

/** Mise en forme canonique d'une valeur JSON : clés triées à chaque niveau, aucun espace ajouté. Pur. */
export function canonique(v: unknown, vus: WeakSet<object> = new WeakSet()): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (vus.has(v)) throw new Error('entrée circulaire');
  vus.add(v);
  try {
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonique(x, vus))).join(',')}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined && typeof o[k] !== 'function').map((k) => `${JSON.stringify(k)}:${canonique(o[k], vus)}`).join(',')}}`;
  } finally { vus.delete(v); }
}

/** Copie profonde, gelée à tous les niveaux : personne ne peut plus la changer. */
export function figer<T>(v: T): T {
  const c = structuredClone(v);
  const geler = (x: unknown): void => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const k of Object.keys(x)) geler((x as Record<string, unknown>)[k]); } };
  geler(c);
  return c;
}

/** Le numéro d'une action : HMAC-SHA-256 (clé : cleNumeros) de l'outil, de ses paramètres exacts (forme canonique) et du tour. */
export function empreinteAction(outil: string, entree: unknown, tour: string, cle: Buffer): string {
  if (cle.length < 32) throw new Error('clé du journal des actions trop courte');
  return createHmac('sha256', cle).update(canonique({ outil, entree, tour })).digest('hex');
}

export const FICHIER_CLE = 'tours-actions.cle';
const cles = new Map<string, Buffer>();
/** La clé de ce processus quand rien ne peut être rangé (mode privé, pas de dossier d'Odin) : jamais écrite. */
let cleVive: Buffer | undefined;
/**
 * La clé des numéros. `home` : le dossier d'Odin, où elle est rangée chiffrée par la clé de la machine. `creer` faux
 * (mode privé : rien n'est écrit) : la clé rangée est lue si elle existe, sinon une clé de ce processus seulement.
 * Une clé rangée mais illisible (clé de la machine perdue) est mise de côté (jamais effacée) et une autre est créée :
 * les actions notées avant ne sont plus reconnues par leur numéro, mais restent listées « à confirmer ».
 */
export function cleNumeros(home: string | null | undefined, creer: boolean): Buffer {
  if (!home) return (cleVive ??= randomBytes(32));
  const deja = cles.get(home); if (deja) return deja;
  const f = join(home, FICHIER_CLE);
  if (existsSync(f)) {
    try {
      const k = Buffer.from(dechiffrerChamp(home, readFileSync(f, 'utf8').trim()), 'hex');
      if (k.length !== 32) throw new Error('longueur inattendue');
      cles.set(home, k); return k;
    } catch (e) {
      if (!creer) return (cleVive ??= randomBytes(32));
      let c = `${f}.illisible`; for (let i = 2; existsSync(c); i++) c = `${f}.illisible-${i}`;
      renameSync(f, c);
      console.error(`[actions] clé du journal des actions illisible (${(e as Error).message.slice(0, 80)}) : mise de côté, une autre est créée`);
    }
  } else if (!creer) return (cleVive ??= randomBytes(32));
  const k = randomBytes(32);
  const texte = chiffrerChamp(home, k.toString('hex'));
  let fd: number;
  try { fd = openSync(f, 'wx', 0o600); } catch (e) {
    // Créée entre-temps (deux appels du même processus ne passent pas ici : la clé est gardée) : celle-là est relue.
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return cleNumeros(home, creer);
    throw e;
  }
  try { writeSync(fd, texte); fsyncSync(fd); } finally { closeSync(fd); }
  cles.set(home, k);
  return k;
}
/** Le numéro court, montré (12 caractères). */
export const numeroCourt = (empreinte: string): string => empreinte.slice(0, 12);

/** L'action dont Heimdall décide en ce moment (pour qu'une demande de validation porte son numéro). */
export const actionEnCours = new AsyncLocalStorage<{ empreinte: string }>();
export const empreinteEnCours = (): string | undefined => actionEnCours.getStore()?.empreinte;

/** Les lignes lisibles du journal, dans l'ordre. Une ligne coupée par une panne est ignorée. */
export function lireLignesActions(fichier: string): LigneAction[] {
  if (!existsSync(fichier)) return [];
  const out: LigneAction[] = [];
  for (const l of readFileSync(fichier, 'utf8').split('\n')) {
    if (!l) continue;
    try { const v = JSON.parse(l) as LigneAction; if (v && typeof v.n === 'string' && typeof v.tour === 'string' && typeof v.etat === 'string') out.push(v); } catch { /* ligne coupée : ignorée */ }
  }
  return out;
}

/** Ajoute une ligne, de façon synchrone et durable (écrite puis forcée sur le disque). Une ligne coupée est d'abord refermée. */
function ajouter(fichier: string, l: LigneAction): void {
  mkdirSync(dirname(fichier), { recursive: true, mode: 0o700 });
  const fd = openSync(fichier, 'a+', 0o600);
  try {
    const taille = fstatSync(fd).size;
    if (taille > 0) { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, taille - 1); if (b[0] !== 0x0a) writeSync(fd, '\n'); }
    writeSync(fd, `${JSON.stringify(l)}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

const cle = (tour: string, n: string): string => `${tour}\u0000${n}`;

/** L'issue d'une action réservée : refusée (rien n'est parti) ou finie (faite, échouée, ou abandonnée avant d'agir). */
export type IssueReservee = 'refusée' | 'finie';

export class JournalActions {
  /** `avant` : lu dans le fichier, écrit par un processus d'avant (la reprise après un redémarrage). */
  private etats = new Map<string, { etat: EtatLu; t: number; avant?: true }>();
  /** Les actions en décision ou en cours, par tour et numéro : la file de ceux qui attendent leur issue. */
  private files = new Map<string, Promise<IssueReservee>>();
  /** null → mémoire vive seulement. */
  readonly fichier: string | null;
  constructor(fichier: string | null) {
    this.fichier = fichier;
    // Relu une fois : une action « lancée » par un processus d'avant, jamais finie, a été coupée → « à confirmer ».
    if (fichier) for (const l of lireLignesActions(fichier)) this.etats.set(cle(l.tour, l.n), { etat: l.etat === 'lancée' ? 'à confirmer' : l.etat, t: l.t, avant: true });
  }
  /** L'état d'une action dans un tour (rien : jamais lancée). */
  etat(tour: string, n: string): { etat: EtatLu; t: number; avant?: true } | undefined { return this.etats.get(cle(tour, n)); }
  /**
   * Réserve une action (tour + numéro) le temps de sa décision et de son exécution : un appel identique qui arrive
   * pendant ce temps attend son issue (« refusée » ou « finie ») au lieu de poser la même question une deuxième fois.
   * `issue` : celle de l'appel identique précédent quand il a fallu l'attendre. `liberer` doit être appelé une fois.
   */
  async reserver(tour: string, n: string): Promise<{ issue?: IssueReservee; liberer: (issue: IssueReservee) => void }> {
    const k = cle(tour, n);
    const avant = this.files.get(k);
    let ouvrir!: (issue: IssueReservee) => void;
    const ici = new Promise<IssueReservee>((ok) => { ouvrir = ok; });
    this.files.set(k, ici);
    const issue = avant ? await avant : undefined;
    let libre = false;
    return { ...(issue ? { issue } : {}), liberer: (x) => { if (libre) return; libre = true; if (this.files.get(k) === ici) this.files.delete(k); ouvrir(x); } };
  }
  /** Note « lancée » AVANT d'agir. Lève si l'écriture échoue (l'action ne doit alors pas partir). */
  lancer(l: Omit<LigneAction, 'etat' | 't'>, ecrire: boolean, t = Date.now()): void {
    if (ecrire && this.fichier) ajouter(this.fichier, { ...l, etat: 'lancée', t });
    this.etats.set(cle(l.tour, l.n), { etat: 'en cours', t });
  }
  /** Note « faite » ou « échouée » après. Une écriture ratée est dite, sans lever : l'action est déjà partie. */
  finir(l: Pick<LigneAction, 'n' | 'tour' | 'outil'>, etat: 'faite' | 'échouée', ecrire: boolean, t = Date.now()): void {
    this.etats.set(cle(l.tour, l.n), { etat, t });
    if (ecrire && this.fichier) { try { ajouter(this.fichier, { ...l, etat, t }); } catch (e) { console.error('[actions]', (e as Error).message); } }
  }
  /** Les actions coupées en plein milieu (lancées avant une panne, jamais finies). */
  aConfirmer(): Array<{ tour: string; n: string; t: number }> {
    return [...this.etats].filter(([, v]) => v.etat === 'à confirmer').map(([k, v]) => { const [tour, n] = k.split('\u0000'); return { tour, n, t: v.t }; });
  }
}

const journaux = new Map<string, JournalActions>();
/** Le journal d'une mémoire (un seul par dossier et par processus) ; null → mémoire vive. */
export function journalDe(memoire: string | null | undefined): JournalActions {
  const f = memoire ? join(memoire, FICHIER_ACTIONS) : '';
  let j = journaux.get(f);
  if (!j) { j = new JournalActions(f || null); journaux.set(f, j); }
  return j;
}
