// L'historique du réseau, gardé pour toujours en petit : un résumé par jour (qui a demandé quoi, combien de
// fois, ce qui a été bloqué), rangé par année et par mois. Le mois et l'année se recomposent en additionnant
// les jours. Le journal détaillé (chaque requête) reste quelques jours seulement, à côté.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry } from './server.ts';

export interface DomainStat { n: number; b: number; list?: string; threat?: boolean }
export interface ClientStat { name?: string; n: number; b: number; threats: number; first: number; last: number; domains: Record<string, DomainStat> }
export interface Summary { from: string; to: string; total: number; blocked: number; threats: number; clients: Record<string, ClientStat>; hours: number[] }

/** La date locale d'un instant, en AAAA-MM-JJ (le jour de Mayotte, pas celui de Greenwich). */
export const localDay = (t: number | Date): string => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const empty = (from = '', to = from): Summary => ({ from, to, total: 0, blocked: 0, threats: 0, clients: {}, hours: Array(24).fill(0) });

/** Résume des requêtes. `isThreat` dit si un blocage vient d'une liste de sites dangereux. Pur. */
export function summarize(entries: LogEntry[], isThreat: (e: LogEntry) => boolean = () => false, from = '', to = from): Summary {
  const s = empty(from, to);
  for (const e of entries) {
    const ip = e.client.replace(/^::ffff:/, ''), blocked = e.status === 'bloqué', threat = blocked && isThreat(e);
    const c = (s.clients[ip] ??= { n: 0, b: 0, threats: 0, first: e.t, last: e.t, domains: {} });
    if (e.clientName) c.name = e.clientName;
    c.n++; c.first = Math.min(c.first, e.t); c.last = Math.max(c.last, e.t);
    const d = (c.domains[e.name] ??= { n: 0, b: 0 });
    d.n++;
    if (blocked) { c.b++; d.b++; if (e.list) d.list = e.list; s.blocked++; }
    if (threat) { c.threats++; d.threat = true; s.threats++; }
    s.total++; s.hours[new Date(e.t).getHours()]++;
  }
  return s;
}
/** Additionne deux résumés (deux jours → une période). Pur. */
export function merge(a: Summary, b: Summary): Summary {
  const out: Summary = { from: [a.from, b.from].filter(Boolean).sort()[0] ?? '', to: [a.to, b.to].filter(Boolean).sort().at(-1) ?? '', total: a.total + b.total, blocked: a.blocked + b.blocked, threats: a.threats + b.threats, clients: structuredClone(a.clients), hours: a.hours.map((x, i) => x + (b.hours[i] ?? 0)) };
  for (const [ip, c] of Object.entries(b.clients)) {
    const o = out.clients[ip];
    if (!o) { out.clients[ip] = structuredClone(c); continue; }
    o.n += c.n; o.b += c.b; o.threats += c.threats; o.first = Math.min(o.first, c.first); o.last = Math.max(o.last, c.last); o.name = c.name ?? o.name;
    for (const [d, x] of Object.entries(c.domains)) { const y = (o.domains[d] ??= { n: 0, b: 0 }); y.n += x.n; y.b += x.b; y.list = x.list ?? y.list; y.threat = y.threat || x.threat; }
  }
  return out;
}
/** Garde les domaines utiles de chaque appareil : les dangereux, puis les plus demandés (le fichier d'un jour reste petit). Pur. */
export function trim(s: Summary, perClient = 80): Summary {
  const out = structuredClone(s);
  for (const c of Object.values(out.clients)) {
    const list = Object.entries(c.domains).sort((x, y) => Number(Boolean(y[1].threat)) - Number(Boolean(x[1].threat)) || y[1].n - x[1].n);
    if (list.length > perClient) c.domains = Object.fromEntries(list.slice(0, perClient));
  }
  return out;
}

const dayPath = (dir: string, d: string) => join(dir, 'historique', d.slice(0, 4), d.slice(5, 7), `${d.slice(8, 10)}.json`);
export function saveDay(dir: string, d: string, s: Summary): void { const p = dayPath(dir, d); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(trim(s))); }
export function readDay(dir: string, d: string): Summary | undefined { try { return JSON.parse(readFileSync(dayPath(dir, d), 'utf8')) as Summary; } catch { return undefined; } }
/** Les requêtes d'un jour, lues dans le journal détaillé (s'il est encore gardé). */
export function journalDay(dir: string, d: string): LogEntry[] {
  const f = join(dir, 'journal', `${d}.jsonl`); if (!existsSync(f)) return [];
  const out: LogEntry[] = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) if (line) try { out.push(JSON.parse(line) as LogEntry); } catch { /* ligne coupée */ }
  return out;
}
/** Résume les jours passés du journal qui ne l'ont pas encore été (rend leur nombre). */
export function catchUp(dir: string, today: string, isThreat: (e: LogEntry) => boolean): number {
  const jd = join(dir, 'journal'); if (!existsSync(jd)) return 0;
  let n = 0;
  for (const f of readdirSync(jd)) {
    const d = f.slice(0, 10); if (!f.endsWith('.jsonl') || d >= today || readDay(dir, d)) continue;
    saveDay(dir, d, summarize(journalDay(dir, d), isThreat, d)); n++;
  }
  return n;
}
/** Les jours gardés d'un mois (« 2026-11 ») ou d'une année (« 2026 »). */
export function daysIn(dir: string, prefix: string): string[] {
  const root = join(dir, 'historique'), out: string[] = [];
  const years = prefix.length >= 4 ? [prefix.slice(0, 4)] : [];
  for (const y of years) { const yd = join(root, y); if (!existsSync(yd)) continue;
    for (const m of readdirSync(yd)) { if (prefix.length === 7 && m !== prefix.slice(5, 7)) continue; const md = join(yd, m); for (const f of readdirSync(md)) if (f.endsWith('.json')) out.push(`${y}-${m}-${f.slice(0, 2)}`); } }
  return out.sort();
}
export type Period = 'direct' | 'jour' | 'mois' | 'annee';
/**
 * Le résumé d'une période : « direct » = les 15 dernières minutes (en mémoire), « jour » = le jour choisi,
 * « mois » et « annee » = tous les jours gardés de la période (aujourd'hui compris, en direct).
 */
export function period(dir: string, p: Period, at: Date, live: LogEntry[], isThreat: (e: LogEntry) => boolean, now = Date.now()): Summary {
  const today = localDay(now), d = localDay(at);
  if (p === 'direct') return summarize(live.filter((e) => now - e.t < 15 * 60_000), isThreat, today);
  // Aujourd'hui : le journal du jour (complet même après un redémarrage), sinon ce qui est en mémoire.
  const dayOf = (x: string) => { if (x !== today) return readDay(dir, x) ?? summarize(journalDay(dir, x), isThreat, x); const j = journalDay(dir, x); return summarize(j.length ? j : live.filter((e) => localDay(e.t) === today), isThreat, x); };
  if (p === 'jour') return dayOf(d);
  const prefix = p === 'mois' ? d.slice(0, 7) : d.slice(0, 4);
  const days = new Set(daysIn(dir, prefix)); if (today.startsWith(prefix)) days.add(today);
  return [...days].sort().reduce((acc, x) => merge(acc, dayOf(x)), empty(prefix));
}
