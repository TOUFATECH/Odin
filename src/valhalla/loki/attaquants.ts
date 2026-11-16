// La liste locale « attaquants vus par mes pièges » : chaque adresse prise par un piège de Sirènes (Loki) est
// gardée ici, avec son origine (pays) et son nombre de prises. Elle sert à deux choses, sans doublon :
//   - l'origine géo des attaquants (statistiques, carte) ;
//   - partager ces adresses à l'anti-malware Méduse (geri) : Méduse lit `reseauxAttaquants(home)` en plus de ses
//     propres listes publiques, pour que TOUT appareil de la maison qui tenterait de joindre cette adresse soit
//     signalé (pas seulement les services d'Odin, déjà protégés par le bannissement de Cerbère).
// Tout reste LOCAL à Odin : rien n'est envoyé dehors.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Attaquant { ip: string; n: number; premier: string; dernier: string; pays?: string; dernierPiege?: string }
const MAX = 20000;

/** Le dossier de Sirènes à partir du dossier d'Odin (même plan que le service : valhalla/<appli>). */
export const lokiDir = (home: string): string => join(home, 'valhalla', 'loki');
const fichier = (dir: string): string => join(dir, 'attaquants.json');
const toInt = (ip: string): number => ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);

/** Lit la liste des attaquants (dossier de Sirènes). */
export function lireAttaquants(dir: string): Record<string, Attaquant> {
  try { return JSON.parse(readFileSync(fichier(dir), 'utf8')) as Record<string, Attaquant>; } catch { return {}; }
}
/** Note une adresse prise par un piège (dossier de Sirènes). Garde au plus MAX adresses (les plus récentes). */
export function voirAttaquant(dir: string, ip: string, o: { at: string; pays?: string; piege?: string }): void {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
  const liste = lireAttaquants(dir);
  const a = liste[ip] ?? { ip, n: 0, premier: o.at, dernier: o.at };
  a.n++; a.dernier = o.at; if (o.pays) a.pays = o.pays; if (o.piege) a.dernierPiege = o.piege;
  liste[ip] = a;
  const cles = Object.keys(liste);
  if (cles.length > MAX) for (const k of cles.sort((x, y) => liste[x].dernier.localeCompare(liste[y].dernier)).slice(0, cles.length - MAX)) delete liste[k];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(fichier(dir), JSON.stringify(liste), { mode: 0o600 });
}

// Lecture par Méduse : gardée en cache et relue seulement quand le fichier change (comme la table des pays).
let cache: { file: string; mtime: number; reseaux: Array<[number, number]> } | undefined;
/**
 * Les adresses des attaquants, en réseaux (adresse /32), pour l'anti-malware Méduse. Lues depuis le dossier de
 * Sirènes, sans rien envoyer dehors. Vide si Sirènes n'a encore rien pris (aucun effet sur Méduse).
 */
export function reseauxAttaquants(home: string): Array<[number, number]> {
  if (!home) return [];
  const f = fichier(lokiDir(home));
  if (!existsSync(f)) return [];
  const mtime = statSync(f).mtimeMs;
  if (!cache || cache.file !== f || cache.mtime !== mtime) {
    const liste = lireAttaquants(lokiDir(home));
    cache = { file: f, mtime, reseaux: Object.keys(liste).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)).map((ip) => [toInt(ip), 0xffffffff] as [number, number]) };
  }
  return cache.reseaux;
}
