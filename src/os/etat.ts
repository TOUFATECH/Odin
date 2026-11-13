// Odin OS — l'état du bureau (thème, applis d'Odin installées, épingles du dock…), gardé dans ~/.odin/os/etat.json.
// Le bureau n'écrit que les clés connues, avec des valeurs du bon type et de taille raisonnable.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OdinPaths } from '../config.ts';

export interface EtatOS { theme: string; fond: string; apparence: string; accent: string; mobile: string; applis: string[]; epingles: string[]; accueilFait: boolean; concentration: boolean }
const fichier = (paths: OdinPaths): string => join(paths.home, 'os', 'etat.json');
const mot = (v: unknown, max = 40): v is string => typeof v === 'string' && v.length <= max && /^[\w:#.@+-]*$/.test(v);
const liste = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 300 && v.every((x) => mot(x, 80));
const REGLES: Record<keyof EtatOS, (v: unknown) => boolean> = {
  theme: (v) => mot(v), fond: (v) => mot(v), apparence: (v) => v === 'clair' || v === 'sombre' || v === 'auto', accent: (v) => v === '' || (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)),
  mobile: (v) => mot(v), applis: liste, epingles: liste, accueilFait: (v) => typeof v === 'boolean', concentration: (v) => typeof v === 'boolean',
};

export function lireEtat(paths: OdinPaths): Partial<EtatOS> {
  try { const e = JSON.parse(readFileSync(fichier(paths), 'utf8')) as Record<string, unknown>; return filtrer(e); } catch { return {}; }
}
/** Ne garde que les clés connues et valides. */
export function filtrer(e: Record<string, unknown>): Partial<EtatOS> {
  const propre: Record<string, unknown> = {};
  for (const [k, ok] of Object.entries(REGLES)) if (k in e && ok(e[k])) propre[k] = e[k];
  return propre as Partial<EtatOS>;
}
export function ecrireEtat(paths: OdinPaths, patch: Record<string, unknown>): Partial<EtatOS> {
  const suivant = { ...lireEtat(paths), ...filtrer(patch) }, f = fichier(paths);
  if (!existsSync(dirname(f))) mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(`${f}.tmp`, `${JSON.stringify(suivant, null, 1)}\n`, { mode: 0o600 }); renameSync(`${f}.tmp`, f);
  return suivant;
}
