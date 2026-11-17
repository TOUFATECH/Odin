// Aides des essais de Prónoia : dossier temporaire, fausse horloge, faux historique, hasard reproductible, faux Noûs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pronoia, type DepsPronoia } from '../src/valhalla/pronoia/moteur.ts';

export const MIN = 60_000, HEURE = 3_600_000, JOUR = 86_400_000;
/** Un lundi, 0 h, heure locale. */
export const LUNDI = new Date(2026, 10, 2, 0, 0).getTime();
export const a = (jour: number, h: number, m = 0) => { const d = new Date(LUNDI); d.setDate(d.getDate() + jour); d.setHours(h, m, 0, 0); return d.getTime(); };

/** Hasard reproductible (mulberry32). */
export function hasard(graine: number): () => number {
  let s = graine >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Banc { home: string; horloge: { t: number }; notes: Array<{ texte: string; source: string }>; p: Pronoia; fermer(): void }

/** Un moteur sur un dossier temporaire, avec une fausse horloge et un faux Noûs qui note ce qu'on lui donne. */
export function banc(o: Partial<DepsPronoia> = {}, t0 = LUNDI): Banc {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-'));
  const horloge = { t: t0 };
  const notes: Banc['notes'] = [];
  const p = new Pronoia({ home, maintenant: () => horloge.t, nourrir: (n) => notes.push({ texte: n.texte, source: n.source }), ...o });
  return { home, horloge, notes, p, fermer: () => rmSync(home, { recursive: true, force: true }) };
}

export const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
