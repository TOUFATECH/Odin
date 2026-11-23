// Les échanges entre applis, en direct : quand une appli demande quelque chose à une autre (et quand la réponse
// revient), un petit événement part vers les pages ouvertes pour faire briller le lien entre les deux dans les graphes.
// L'événement ne porte JAMAIS les données de l'appel : seulement qui demande, à qui, le nom de l'action et si ça a marché.
// Un court historique (les dernières secondes) est gardé pour la page qui s'ouvre à ce moment-là.

import { EventEmitter } from 'node:events';

export interface Echange {
  /** numéro de l'échange : la demande et sa réponse portent le même */ id: number;
  /** l'appli qui demande */ de: string;
  /** l'appli à qui on demande */ vers: string;
  /** l'action demandée (son identifiant) */ action: string;
  phase: 'demande' | 'reponse';
  /** la réponse est bonne (toujours vrai pour une demande) */ ok: boolean;
  at: string;
  /** noms affichés, pour l'étiquette du lien (« Phénix demande à Amphore : vérifier le 2e site ») */
  deNom: string; versNom: string; libelle: string;
}

/** Les pages ouvertes s'abonnent ici (serveur web, fil des membres). */
export const echangeBus = new EventEmitter();
echangeBus.setMaxListeners(100);

const GARDE_MS = 10_000, MAX = 120, SERRE_MS = 200;
const recents: Echange[] = [];
const derniers = new Map<string, number>();
let suivant = 0;

/** Un nouveau numéro d'échange. */
export const numeroEchange = (): number => ++suivant;

/**
 * Note un échange et le relaie. Beaucoup d'échanges identiques d'un coup (même paire, même action, même phase,
 * moins de 200 ms d'écart) : un seul part, pour que les pages restent fluides.
 */
export function noterEchange(e: Echange, now = Date.now()): boolean {
  const cle = `${e.de}>${e.vers}:${e.action}:${e.phase}`, avant = derniers.get(cle);
  if (avant !== undefined && now - avant < SERRE_MS) return false;
  derniers.set(cle, now);
  if (derniers.size > 500) for (const [k, t] of derniers) if (now - t > GARDE_MS) derniers.delete(k);
  recents.push(e);
  while (recents.length > MAX || (recents.length && now - Date.parse(recents[0].at) > GARDE_MS)) recents.shift();
  echangeBus.emit('echange', e);
  return true;
}

/** Les échanges des dernières secondes (pour une page qui s'ouvre), filtrés selon ce que la personne a le droit de voir. */
export function echangesRecents(voit: (appli: string) => boolean = () => true, now = Date.now()): Echange[] {
  return recents.filter((e) => now - Date.parse(e.at) <= GARDE_MS && voit(e.de) && voit(e.vers));
}

/** Vide l'historique (essais). */
export function viderEchanges(): void { recents.length = 0; derniers.clear(); }
