// Odin se surveille lui-même (chaque heure) : place sur le disque, taille de sa base et de ses journaux,
// erreurs imprévues, tâches qui échouent, budget du mois. Il répare seul ce qui est sans risque
// (journaux trop gros, base à compacter) et te prévient du reste, une fois par jour au plus.

import { existsSync, readdirSync, readFileSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SelfState { diskFreePct: number; diskFreeGb: number; dbMb: number; errorsLastHour: number; failedMissions: number; monthCost: number; budget: number }

/** Compteur des erreurs imprévues (rempli par le filet de sécurité du processus). */
const g = globalThis as { __odinErrors?: number[] };
export function noteError(now = Date.now()): void { (g.__odinErrors ??= []).push(now); g.__odinErrors = g.__odinErrors.filter((t) => now - t < 86_400_000); }
export const errorsSince = (since: number) => (g.__odinErrors ?? []).filter((t) => t >= since).length;

/** Ce qui ne va pas (pur) : clé (pour ne prévenir qu'une fois par jour) et message. */
export function diagnose(s: SelfState): Array<{ key: string; text: string; fix?: 'vacuum' }> {
  const out: Array<{ key: string; text: string; fix?: 'vacuum' }> = [];
  if (s.diskFreePct < 5 || s.diskFreeGb < 1) out.push({ key: 'disk', text: `💽 Il reste peu de place sur mon disque : ${s.diskFreeGb.toFixed(1)} Go (${s.diskFreePct.toFixed(0)} %). Je peux faire le ménage dans mes sauvegardes et fichiers temporaires si tu veux.` });
  if (s.dbMb > 500) out.push({ key: 'db', text: `🗄 Ma mémoire fait ${Math.round(s.dbMb)} Mo : je la range cette nuit.`, fix: 'vacuum' });
  if (s.errorsLastHour >= 5) out.push({ key: 'errors', text: `⚠️ ${s.errorsLastHour} erreurs imprévues dans la dernière heure (je continue de fonctionner). Regarde le journal ou demande-moi « qu'est-ce qui ne va pas ? ».` });
  if (s.failedMissions >= 3) out.push({ key: 'missions', text: `⚠️ ${s.failedMissions} tâches ont échoué dans les dernières 24 h : souvent le modèle injoignable ou une machine éteinte. Je regarde les causes si tu veux.` });
  if (s.budget > 0 && s.monthCost >= s.budget * 0.8) out.push({ key: `budget-${s.monthCost >= s.budget ? 'full' : '80'}`, text: s.monthCost >= s.budget ? `💸 Budget du mois atteint (${s.monthCost.toFixed(2)} $ / ${s.budget} $) : je passe sur les modèles gratuits ou locaux.` : `💸 80 % du budget du mois utilisé (${s.monthCost.toFixed(2)} $ / ${s.budget} $).` });
  return out;
}

/** Journaux trop gros : on garde la fin (réparation sans risque). Renvoie le nombre de fichiers raccourcis. */
export function trimLogs(dir: string, maxMb = 20): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try { const st = statSync(p); if (st.isFile() && st.size > maxMb * 1024 * 1024 && /\.(md|log|txt|jsonl)$/.test(f)) { const t = readFileSync(p, 'utf8'); writeFileSync(p, `[… début coupé par Odin le ${new Date().toLocaleString('fr-FR')}]\n${t.slice(-Math.floor(maxMb * 1024 * 1024 / 4))}`); n++; } } catch { /* on passe */ }
  }
  return n;
}

/** `memoryBytes` : taille de la mémoire d'Odin (ses fichiers), en octets. */
export function measure(home: string, memoryBytes: number): Pick<SelfState, 'diskFreePct' | 'diskFreeGb' | 'dbMb'> {
  let diskFreePct = 100, diskFreeGb = 999;
  try { const f = statfsSync(home); diskFreeGb = (f.bavail * f.bsize) / 1e9; diskFreePct = (f.bavail / f.blocks) * 100; } catch { /* inconnu */ }
  const dbMb = memoryBytes / 1048576;
  return { diskFreePct, diskFreeGb, dbMb };
}
