// Pulsar — problèmes et déclencheurs (façon Zabbix / Centreon) :
//   - un déclencheur lit une mesure d'Odin (« eir.mem », « vordr.temps.nas »…) sur une fenêtre et la compare
//     à un seuil : « si la moyenne de la mémoire sur 10 min dépasse 80 %, problème Moyen ; fini sous 70 % » ;
//   - un problème a une gravité (5 niveaux), une date de début, une prise en main, des commentaires ;
//   - dépendances : si la cause est déjà en problème (« Internet coupé »), les suites (« le site ne répond
//     pas ») sont rangées comme symptômes, sans alerte en double ;
//   - escalade : pas pris en main après N minutes → on prévient encore, plus fort ;
//   - SLA : disponibilité du mois comparée à l'objectif.
import type { Metrics } from '../metrics.ts';

export type Severity = 'info' | 'avertissement' | 'moyen' | 'haut' | 'desastre';
export const SEV: Record<Severity, { label: string; rank: number; level: 'info' | 'moyenne' | 'haute' | 'critique' }> = {
  info: { label: 'Information', rank: 0, level: 'info' }, avertissement: { label: 'Avertissement', rank: 1, level: 'moyenne' }, moyen: { label: 'Moyen', rank: 2, level: 'moyenne' }, haut: { label: 'Haut', rank: 3, level: 'haute' }, desastre: { label: 'Désastre', rank: 4, level: 'critique' },
};
export type Fn = 'avg' | 'min' | 'max' | 'last' | 'delta' | 'count';
export type Op = '>' | '>=' | '<' | '<=' | '==' | '!=';
export interface Trigger { id: string; name: string; serie: string; fn: Fn; windowMin: number; op: Op; value: number; recovery?: number; severity: Severity; dependsOn?: string[]; enabled: boolean; steps?: string[]; nodata?: number }
export interface Problem { id: string; source: 'declencheur' | 'sonde'; ref: string; name: string; severity: Severity; value?: number; start: number; end?: number; ack?: { by: string; at: number; comment?: string }; comments: Array<{ by: string; at: number; text: string }>; symptomOf?: string; escalated: number }

const FN: Record<Fn, string> = { avg: 'la moyenne', min: 'le minimum', max: 'le maximum', last: 'la dernière valeur', delta: 'la variation', count: 'le nombre de valeurs' };
const OPW: Record<Op, string> = { '>': 'dépasse', '>=': 'atteint ou dépasse', '<': 'passe sous', '<=': 'passe sous ou atteint', '==': 'vaut', '!=': 'ne vaut pas' };
/** Le déclencheur en phrase lisible. Pur. */
export function describe(t: Trigger): string {
  return `Si ${FN[t.fn]} de « ${t.serie} » sur ${t.windowMin} min ${OPW[t.op]} ${t.value}, problème ${SEV[t.severity].label}${t.recovery !== undefined ? ` ; fini quand elle repasse ${t.op.startsWith('>') ? 'sous' : 'au-dessus de'} ${t.recovery}` : ''}.`;
}
export const cmp = (a: number, op: Op, b: number) => (op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : op === '==' ? a === b : a !== b);

/** Évalue les déclencheurs : problèmes à ouvrir et à fermer. Pur (hors lecture des mesures). */
export function evaluate(m: Pick<Metrics, 'fn'>, triggers: Trigger[], open: Problem[], now: number): { opened: Problem[]; closed: Array<{ p: Problem; value?: number }> } {
  const opened: Problem[] = [], closed: Array<{ p: Problem; value?: number }> = [];
  for (const t of triggers.filter((x) => x.enabled)) {
    const v = m.fn(t.serie, t.fn, t.windowMin * 60_000), cur = open.find((p) => p.source === 'declencheur' && p.ref === t.id && !p.end);
    // Plus de valeur du tout : problème seulement si « pas de données » est demandé.
    if (v === undefined) { if (t.nodata && !cur) opened.push(mk(t, now, undefined, `Plus aucune valeur de ${t.serie} depuis ${t.windowMin} min`)); continue; }
    const bad = cmp(v, t.op, t.value);
    if (!cur && bad) { const cause = (t.dependsOn ?? []).map((d) => open.find((p) => p.source === 'declencheur' && p.ref === d && !p.end) ?? open.find((p) => p.source === 'sonde' && p.ref === d && !p.end)).find(Boolean); opened.push({ ...mk(t, now, v), ...(cause ? { symptomOf: cause.id } : {}) }); }
    else if (cur) { const back = t.recovery !== undefined ? !cmp(v, t.op, t.recovery) : !bad; if (back) closed.push({ p: cur, value: v }); }
  }
  return { opened, closed };
}
function mk(t: Trigger, now: number, value?: number, name?: string): Problem {
  return { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, source: 'declencheur', ref: t.id, name: name ?? t.name, severity: t.severity, ...(value !== undefined ? { value: Math.round(value * 100) / 100 } : {}), start: now, comments: [], escalated: 0 };
}

/** Les problèmes à escalader : pas pris en main, assez graves, ouverts depuis longtemps. Pur. */
export function toEscalate(open: Problem[], now: number, steps: number[] = [15, 60]): Array<{ p: Problem; step: number }> {
  const out: Array<{ p: Problem; step: number }> = [];
  for (const p of open) { if (p.end || p.ack || p.symptomOf || SEV[p.severity].rank < 2) continue; const next = steps[p.escalated]; if (next !== undefined && now - p.start >= next * 60_000) out.push({ p, step: p.escalated + 1 }); }
  return out;
}

/** Disponibilité du mois d'une liste de jours (en minutes en ligne / en panne). Pur. */
export function sla(days: Array<{ up: number; down: number }>, target: number): { pct?: number; ok?: boolean; downMin: number; budgetMin?: number } {
  const up = days.reduce((a, d) => a + d.up, 0), down = days.reduce((a, d) => a + d.down, 0);
  if (!up && !down) return { downMin: 0 };
  const pct = Math.round((up / (up + down)) * 10000) / 100, budget = Math.round(((up + down) * (100 - target)) / 100);
  return { pct, ok: pct >= target, downMin: down, budgetMin: budget };
}
