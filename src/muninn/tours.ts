// Les tours : chaque message qui arrive à Odin (interface, appli, messageries) devient un « tour », écrit TOUT DE SUITE,
// avant tout traitement, dans un journal en ajout seul (une ligne JSON par changement). On y lit qui a demandé, par quel
// canal, dans quel fil, dans quel but, l'état (en file, en cours, réussi, échec, en attente, arrêté), le début et la fin.
// Une panne fait perdre au pire la ligne en cours d'écriture : elle est ignorée à la lecture, le reste est gardé.
//
// Rangement : <mémoire>/tours/AAAA-MM-JJ.NNN.jsonl (date UTC du jour d'écriture ; un nouveau numéro quand le fichier du
// jour dépasse sa taille). Rien n'est jamais réécrit ni effacé ici. Ce fichier est la source de vérité ; une copie dans
// une base d'Alexandrie pourra s'y brancher plus tard (accroche : `surLigneTour`), sans rien changer à l'écriture.

import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export type EtatTour = 'en file' | 'en cours' | 'réussi' | 'échec' | 'en attente' | 'arrêté';
/** Les états qui terminent un tour. */
export const ETATS_FINAUX: ReadonlySet<EtatTour> = new Set(['réussi', 'échec', 'en attente', 'arrêté']);

export interface Tour {
  id: string;
  /** Le compte : « propriétaire », « membre:<id> », « invite:<canal>:<pair> », ou « odin » (relance d'Odin). */
  qui: string;
  /** Qui a envoyé le message : un humain, ou Odin lui-même (relance, page d'Odin qui demande). */
  role: 'humain' | 'agent';
  canal: string;
  /** Le fil : aujourd'hui la conversation `<canal>:<pair>`. */
  fil: string;
  /** La tâche, quand il y en a une (rien aujourd'hui). */
  tache?: string;
  /** Le tour qui l'a lancé (sous-agent, tâche), s'il y en a un. */
  parent?: string;
  /** La demande, coupée à 300 caractères, secrets masqués (vide pour un inconnu pas encore appairé). */
  but: string;
  /** La parole humaine d'origine (identifiant dans le journal des paroles), ou rien. */
  message?: string;
  /** Pourquoi il n'y a pas de parole (courriel, page d'Odin, relance…). */
  sansParole?: string;
  etat: EtatTour;
  /** Ce qu'il attend, s'il est « en attente ». */
  attente?: string;
  /** Qui a fait le tour (agent), quand on le sait. */
  agent?: string;
  /** La mission liée (onglet Missions), quand il y en a une. */
  mission?: string;
  /** Traité tout de suite (commande, validation…), sans passer par la file de la conversation. */
  immediat?: boolean;
  debut: number;
  fin?: number;
  /** Dernier changement. */
  maj: number;
}

/** Taille d'un fichier de journal avant d'en ouvrir un nouveau le même jour. */
export const TAILLE_MAX_FICHIER = 8 * 1024 * 1024;
/** Taille d'une ligne : au-delà, les champs de texte sont coupés (et marqués) par l'appelant. */
export const TAILLE_MAX_LIGNE = 256 * 1024;

const jourDe = (t: number): string => new Date(t).toISOString().slice(0, 10);
const NOM = /^(\d{4}-\d{2}-\d{2})\.(\d{3})\.jsonl$/;
/** Fichier courant par dossier et par jour. */
const courants = new Map<string, string>();

/** Identifiant neuf : préfixe, heure en base 36, hasard. */
export const nouvelId = (prefixe: string, now = Date.now()): string => `${prefixe}-${now.toString(36)}-${randomBytes(5).toString('hex')}`;

function fichierCourant(dir: string, now: number, octets: number, max: number): string {
  const jour = jourDe(now), cle = `${dir}|${jour}`;
  let f = courants.get(cle);
  if (!f) {
    const n = existsSync(dir) ? readdirSync(dir).map((x) => NOM.exec(x)).filter((x): x is RegExpExecArray => Boolean(x) && x![1] === jour).map((x) => Number(x[2])) : [];
    f = join(dir, `${jour}.${String(n.length ? Math.max(...n) : 1).padStart(3, '0')}.jsonl`);
  }
  // Le fichier du jour est plein : le suivant (rien n'est perdu, chaque fichier reste de taille bornée).
  let taille = 0; try { if (existsSync(f)) { const fd = openSync(f, 'r'); try { taille = fstatSync(fd).size; } finally { closeSync(fd); } } } catch { taille = 0; }
  if (taille > 0 && taille + octets > max) {
    const m = NOM.exec(f.slice(dir.length + 1));
    f = join(dir, `${jour}.${String(Number(m?.[2] ?? 1) + 1).padStart(3, '0')}.jsonl`);
  }
  courants.set(cle, f);
  return f;
}

/**
 * Ajoute une ligne à un journal du jour, de façon synchrone et durable (écrite puis forcée sur le disque) avant de
 * rendre la main. Une ligne restée coupée par une panne est d'abord refermée, pour ne pas abîmer la suivante.
 */
export function ajouterLigne(dir: string, objet: object, o: { now?: number; max?: number } = {}): string {
  const now = o.now ?? Date.now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ligne = Buffer.from(`${JSON.stringify(objet)}\n`, 'utf8');
  const f = fichierCourant(dir, now, ligne.length, o.max ?? TAILLE_MAX_FICHIER);
  const fd = openSync(f, 'a+', 0o600);
  try {
    // Vérifié à chaque fois (un octet) : une ligne coupée par une panne est refermée avant d'écrire la suivante.
    const taille = fstatSync(fd).size;
    if (taille > 0) {
      const dernier = Buffer.alloc(1);
      readSync(fd, dernier, 0, 1, taille - 1);
      if (dernier[0] !== 0x0a) writeSync(fd, '\n');
    }
    writeSync(fd, ligne);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return f;
}

/** Toutes les lignes lisibles d'un journal, dans l'ordre d'écriture (fichiers par date puis numéro). Une ligne abîmée est ignorée. */
export function lireLignes<T = Record<string, unknown>>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const nom of readdirSync(dir).filter((x) => NOM.test(x)).sort()) {
    let texte = '';
    try { texte = readFileSync(join(dir, nom), 'utf8'); } catch { continue; }
    for (const l of texte.split('\n')) {
      if (!l) continue;
      try { const v = JSON.parse(l) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as T); } catch { /* ligne coupée par une panne : ignorée */ }
    }
  }
  return out;
}

/** Le dossier des tours, dans la mémoire d'Odin. */
export const dossierTours = (memoire: string): string => join(memoire, 'tours');

/** Accroche pour une copie ailleurs (base d'Alexandrie, plus tard) : appelée après chaque ligne écrite ; ne bloque jamais. */
export const surLigneTour: Array<(ligne: Partial<Tour> & { id: string }) => void> = [];
function signaler(ligne: Partial<Tour> & { id: string }): void { for (const f of surLigneTour) { try { f(ligne); } catch { /* jamais bloquant */ } } }

/** Ouvre un tour « en file » et l'écrit tout de suite. */
export function ouvrirTour(memoire: string, t: Omit<Tour, 'id' | 'etat' | 'debut' | 'maj'> & { id?: string }, now = Date.now()): Tour {
  const tour: Tour = { ...t, id: t.id ?? nouvelId('t', now), but: t.but.slice(0, 300), etat: 'en file', debut: now, maj: now };
  ajouterLigne(dossierTours(memoire), tour, { now });
  signaler(tour);
  return tour;
}

/** Change l'état d'un tour (une ligne de plus : rien n'est réécrit). Un état final porte l'heure de fin. */
export function changerTour(memoire: string, id: string, etat: EtatTour, extra: Partial<Pick<Tour, 'attente' | 'agent' | 'mission' | 'immediat'>> = {}, now = Date.now()): void {
  const ligne: Partial<Tour> & { id: string } = { id, etat, maj: now, ...extra, ...(ETATS_FINAUX.has(etat) ? { fin: now } : {}) };
  ajouterLigne(dossierTours(memoire), ligne, { now });
  signaler(ligne);
}

/** Les tours relus du disque : chaque ligne complète la précédente du même tour. Dans l'ordre de leur ouverture. */
export function lireTours(memoire: string): Tour[] {
  const parId = new Map<string, Tour>();
  for (const l of lireLignes<Partial<Tour> & { id?: unknown }>(dossierTours(memoire))) {
    if (typeof l.id !== 'string') continue;
    const avant = parId.get(l.id);
    if (!avant && typeof l.debut !== 'number') continue; // un changement sans son ouverture (fichier perdu) : ignoré
    parId.set(l.id, { ...(avant ?? {}), ...l } as Tour);
  }
  return [...parId.values()];
}

/** L'état final d'un tour d'après sa mission (onglet Missions), quand elle existe. Pur. */
export function etatDeMission(statut: string | undefined): EtatTour | undefined {
  return statut === 'terminée' ? 'réussi' : statut === 'échouée' ? 'échec' : statut === 'arrêtée' ? 'arrêté' : statut === 'en attente' ? 'en attente' : undefined;
}
