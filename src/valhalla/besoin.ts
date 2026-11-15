// Quelle appli pour ta demande ? Les mots des applis (Logos, `v.find`) ET les usages connus du Cerveau
// (« pour ce besoin, prends celle-ci, puis celle-là ») : « sauvegarde mes photos » mène à Hélios et
// Phénix, pas à la photo d'une caméra. Sert au conseil (valhalla conseiller, /api/valhalla/advise) et au
// Cerveau consulté avant chaque réponse.

import { USAGES } from './links.ts';
import type { Action, Module } from './types.ts';

/** Ce dont on a besoin d'une Valhalla (les essais peuvent en donner une plus petite). */
export interface AppFinder { find(need: string): Array<{ m: Module; score: number; action?: Action }>; module(id: string): Module | undefined }

/** Minuscules, sans accents. */
export const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Petits mots qui ne disent rien du besoin. */
const STOP = new Set('les des une est mes tes ses mon ton son nos vos leur leurs pour avec sans dans sur par que qui quoi quel quelle comment est-ce fais faire peux veux voudrais besoin aide moi toi lui elle nous vous ils elles cette ces cet aux tout tous toute plus moins tres bien aussi alors donc mais ou et je tu il on ne pas'.split(' '));

/** Les mots qui portent le sens d'une demande (sans accents, au moins 3 lettres, sans les petits mots). */
export function keywords(text: string): string[] {
  return [...new Set(fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}
/** Même racine (les 5 premières lettres suffisent : « sauvegarde » ≈ « sauvegarder », « photo » ≈ « photos »). */
const sameRoot = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)) || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** L'usage connu qui correspond le mieux à la demande (au moins deux mots en commun quand la demande en a deux). */
export function usageFor(need: string): (typeof USAGES)[number] | undefined {
  const words = keywords(need); if (!words.length) return undefined;
  let best: (typeof USAGES)[number] | undefined, top = 0;
  for (const u of USAGES) {
    const uw = keywords(u.need), hits = words.filter((w) => uw.some((x) => sameRoot(w, x))).length;
    if (hits > top) { top = hits; best = u; }
  }
  return top >= Math.min(2, words.length) ? best : undefined;
}

/**
 * Les applis qui répondent à la demande, les mieux placées d'abord : les mots de chaque appli, plus un
 * bonus pour celles de l'usage connu (dans l'ordre de la chaîne).
 */
export function appsFor(v: AppFinder, need: string, limit = 3): Array<{ m: Module; score: number; action?: Action; usage?: string }> {
  const out = new Map<string, { m: Module; score: number; action?: Action; usage?: string }>();
  for (const f of v.find(need)) out.set(f.m.id, { ...f });
  const u = usageFor(need);
  if (u) u.chain.forEach((id, k) => {
    const m = v.module(id); if (!m) return;
    const x = out.get(id) ?? { m, score: 0 };
    x.score += 3 + (k === 0 ? 1 : 0); x.usage = u.need; out.set(id, x);
  });
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
