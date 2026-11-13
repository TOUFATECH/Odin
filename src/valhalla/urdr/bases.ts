// Alexandrie — la liste de tes bases (partagée avec Arche). Les mots de passe sont à part, dans un fichier protégé
// (lecture par Odin seul, jamais affiché) et dans le coffre (Thésauros).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDriver, type Driver } from './db.ts';

export type Kind = 'postgres' | 'mysql' | 'mongodb';
export interface Base {
  id: string; nom: string; type: Kind;
  hote?: string; port?: number; utilisateur?: string; base?: string; ssl?: 'non' | 'si-possible' | 'obligatoire';
  /** base hébergée par Odin : le conteneur Hringhorni qui la fait tourner */
  conteneur?: string; version?: string;
  ajoutee: string;
}
export const dirOf = (home: string) => join(home, 'valhalla', 'urdr');
const read = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } };
const write = (f: string, v: unknown, mode = 0o600) => { mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1), { mode }); renameSync(t, f); chmodSync(f, mode); };

/** Zéro SQLite : une ancienne entrée SQLite éventuelle n'est plus lue. */
export const bases = (home: string): Base[] => read<Base[]>(join(dirOf(home), 'bases.json'), []).filter((b) => (b.type as string) !== 'sqlite');
export const saveBases = (home: string, l: Base[]) => write(join(dirOf(home), 'bases.json'), l);
export function findBase(home: string, q: string): Base {
  const k = String(q ?? '').trim().toLowerCase(), l = bases(home);
  const b = l.find((x) => x.id === k) ?? l.find((x) => x.nom.toLowerCase() === k); if (!b) throw new Error(`base inconnue : ${q}${l.length ? ` (tes bases : ${l.map((x) => x.nom).join(', ')})` : ''}`);
  return b;
}
const secretsFile = (home: string) => join(dirOf(home), 'secrets.json');
export const password = (home: string, id: string): string | undefined => read<Record<string, string>>(secretsFile(home), {})[id];
export function setPassword(home: string, id: string, pw: string | undefined) { const s = read<Record<string, string>>(secretsFile(home), {}); if (pw) s[id] = pw; else delete s[id]; write(secretsFile(home), s); }
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'base';

/** Adresse réelle d'une base hébergée par Odin (l'IP du conteneur sur le pont odin0, jamais publiée dehors). */
export type HostOf = (b: Base) => { host: string; port: number } | undefined;
let hostOf: HostOf = () => undefined;
export function useHostOf(f: HostOf) { hostOf = f; }

/** Pour les essais : une autre façon d'ouvrir une base (une fausse base en mémoire). */
let opener: ((b: Base) => Driver | undefined) | undefined;
export function useOpener(f: typeof opener) { opener = f; }
/** Ouvre la base PostgreSQL ; MySQL et MongoDB : sauvegardes seulement (Arche). Zéro SQLite dans Odin. */
export async function open(home: string, b: Base): Promise<Driver> {
  const o = opener?.(b); if (o) return o;
  if (b.type === 'postgres') {
    const at = b.conteneur ? hostOf(b) : undefined;
    if (b.conteneur && !at) throw new Error(`la base ${b.nom} ne tourne pas (conteneur ${b.conteneur} arrêté ?)`);
    return PgDriver.open({ host: at?.host ?? b.hote ?? '127.0.0.1', port: at?.port ?? b.port ?? 5432, user: b.utilisateur ?? 'postgres', password: password(home, b.id), database: b.base ?? 'postgres', ssl: b.ssl });
  }
  throw new Error(`${b.type === 'mysql' ? 'MySQL / MariaDB' : 'MongoDB'} : Alexandrie Studio ne l'ouvre pas encore ; Arche la sauvegarde déjà`);
}
