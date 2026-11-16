// La chronologie de Kéryx : chaque échange (message entrant/sortant) et chaque action est horodaté et gardé. Les champs
// qui touchent à la vie privée (le texte, le numéro du pair, le résumé d'une action) sont CHIFFRÉS au repos (clé de la
// machine, via chiffrerChamp du coffre) ; rien n'est jamais en clair sur le disque ni dans le dépôt. Repli FICHIER
// chiffré (c'est le cas en développement : PostgreSQL / la base KERYX_ODIN n'est pas là). L'effacement est RÉEL : la
// ligne retirée est d'abord écrasée, puis le fichier réécrit sans elle.
//
// Le contrat donne tracer/lire/effacer sans « home » : il est fixé une fois par configurerTrace() (au démarrage et dans
// les tests), à défaut d'un paramètre dédié.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import type { EntreeTrace } from './types.ts';

let home: string | undefined;
/** Fixe le dossier d'Odin où Kéryx garde sa chronologie (repli fichier chiffré). */
export function configurerTrace(h: string): void { home = h; }

function fichier(): string {
  if (!home) throw new Error('trace Kéryx non configurée (configurerTrace)');
  const d = join(home, 'valhalla', 'keryx');
  mkdirSync(d, { recursive: true });
  return join(d, 'journal.jsonl');
}

/** Chiffre un champ privé ; si la clé manque, on ne met JAMAIS le clair, on met un marqueur. */
function protege(texte: string): string {
  try { return chiffrerChamp(home!, texte); } catch { return 'odc1:[indisponible]'; }
}
function ouvre(v: string | undefined): string {
  if (!v) return '';
  try { return dechiffrerChamp(home!, v); } catch { return v === 'odc1:[indisponible]' ? '[chiffrement indisponible]' : '[illisible]'; }
}

// Sur le disque, les champs sensibles sont déjà chiffrés : on range la forme « stockée ».
interface Stockee { id: string; quand: string; canal: string; pair: string; sens: EntreeTrace['sens']; texte: string; action?: EntreeTrace['action']; resultat?: EntreeTrace['resultat'] }

/** Écrit une entrée dans la chronologie, champs privés chiffrés. Rend son identifiant. */
export async function tracer(e: Omit<EntreeTrace, 'id'>): Promise<string> {
  const id = randomBytes(9).toString('hex');
  const s: Stockee = {
    id, quand: e.quand, canal: e.canal, sens: e.sens,
    pair: protege(e.pair), texte: protege(e.texte), resultat: e.resultat,
    action: e.action ? { ...e.action, resume: protege(e.action.resume) } : undefined,
  };
  const f = fichier();
  const ligne = JSON.stringify(s) + '\n';
  // append atomique simple (un seul écrivain : la file par conversation sérialise déjà les tours)
  writeFileSync(f, ligne, { flag: 'a', mode: 0o600 });
  return id;
}

// Le journal est écrit en append (ordre chronologique croissant) : les plus récents sont à la fin. On ne parse que la
// queue du fichier pour l'affichage (coût borné, pas proportionnel à toute la taille) ; l'effacement, lui, lit tout.
function toutLire(max = Infinity): Stockee[] {
  const f = fichier();
  if (!existsSync(f)) return [];
  const lignes = readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const tranche = Number.isFinite(max) && lignes.length > max ? lignes.slice(-(max as number)) : lignes;
  return tranche.map((l) => { try { return JSON.parse(l) as Stockee; } catch { return undefined; } }).filter((x): x is Stockee => !!x);
}

/** Lit la chronologie, de la plus récente à la plus ancienne ; `avant` (ISO) et `n` (≤ 200) la bornent. Champs déchiffrés. */
export async function lire(filtre: { avant?: string; n?: number } = {}): Promise<EntreeTrace[]> {
  const n = Math.min(Math.max(1, filtre.n ?? 50), 200);
  // Les horodatages ISO se trient déjà par ordre de chaîne : une comparaison simple, pas localeCompare (bien plus lent).
  let l = toutLire(20_000).sort((a, b) => (a.quand < b.quand ? 1 : a.quand > b.quand ? -1 : 0));
  if (filtre.avant) l = l.filter((x) => x.quand < filtre.avant!);
  return l.slice(0, n).map((s) => ({
    id: s.id, quand: s.quand, canal: s.canal, sens: s.sens,
    pair: ouvre(s.pair), texte: ouvre(s.texte), resultat: s.resultat,
    action: s.action ? { ...s.action, resume: ouvre(s.action.resume) } : undefined,
  }));
}

/**
 * Met à jour l'état d'une entrée d'ACTION déjà tracée, après coup (quand l'outil a fini) : confirmée ou non, et son
 * résultat (faite / refusée / en attente). Rend vrai si l'entrée a été trouvée et réécrite. Seuls des champs non
 * sensibles changent (les champs chiffrés restent tels quels).
 */
export async function majAction(id: string, patch: { confirmee?: boolean; resultat?: EntreeTrace['resultat'] }): Promise<boolean> {
  const f = fichier();
  if (!existsSync(f)) return false;
  const tout = toutLire();
  const s = tout.find((x) => x.id === id);
  if (!s) return false;
  if (patch.resultat !== undefined) s.resultat = patch.resultat;
  if (patch.confirmee !== undefined && s.action) s.action = { ...s.action, confirmee: patch.confirmee };
  writeFileSync(f, tout.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
  return true;
}

/** Efface une entrée (id) ou toute la chronologie (tout). Effacement RÉEL : le fichier est écrasé puis réécrit. Rend le nombre d'entrées retirées. */
export async function effacer(filtre: { id?: string; tout?: boolean }): Promise<number> {
  const f = fichier();
  if (!existsSync(f)) return 0;
  const avant = toutLire();
  const garde = filtre.tout ? [] : avant.filter((x) => x.id !== filtre.id);
  const retire = avant.length - garde.length;
  if (!retire) return 0;
  // Écrase l'ancien contenu (shred), puis réécrit ce qui reste.
  try { writeFileSync(f, Buffer.alloc(statSync(f).size), { mode: 0o600 }); } catch { /* best effort */ }
  if (garde.length) writeFileSync(f, garde.map((s) => JSON.stringify(s)).join('\n') + '\n', { mode: 0o600 });
  else rmSync(f, { force: true });
  return retire;
}
