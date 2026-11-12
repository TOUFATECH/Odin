// Les mesures d'Odin gardées dans le temps (façon Prometheus / Zabbix / Glances) : chaque appli range ses
// chiffres (processeur, mémoire, temps de réponse, débit…) sous un nom de série ; Eir, Vörðr et les tableaux
// de bord de Sýn les relisent sur 1 h, 24 h, 7 j, 30 j, 1 an.
//   - une ligne par minute et par jour : mesures/AAAA-MM-JJ.jsonl (gardées 31 jours) ;
//   - une moyenne par heure, gardée pour toujours : mesures/heures-AAAA-MM.jsonl (petit).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type Point = [number, number]; // [instant en ms, valeur]
export interface Agg { t: number; avg: number; min: number; max: number; last: number; n: number }
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const month = (t: number) => day(t).slice(0, 7);
/** Un nom de série acceptable : « eir.cpu », « vordr.temps.nas », « gjoll.debit.telephone ». */
export const okName = (s: string) => /^[a-z0-9][\w.:-]{0,120}$/i.test(s);

export class Metrics {
  readonly dir: string;
  private pending = new Map<string, number[]>(); private minute = 0;
  private hour = new Map<string, number[]>(); private hourAt = 0;
  private recent = new Map<string, Point[]>(); // les 2 dernières heures en mémoire (lecture rapide)
  private now: () => number;
  constructor(dir: string, now: () => number = Date.now) { this.dir = dir; this.now = now; mkdirSync(dir, { recursive: true }); }

  /** Range des valeurs maintenant (plusieurs séries d'un coup). Les valeurs d'une même minute sont moyennées. */
  put(values: Record<string, number | undefined>, t = this.now()): void {
    const m = Math.floor(t / 60_000) * 60_000;
    if (this.minute && m !== this.minute) this.flush();
    this.minute = m;
    for (const [k, v] of Object.entries(values)) { if (v === undefined || !Number.isFinite(v) || !okName(k)) continue; const l = this.pending.get(k) ?? []; l.push(v); this.pending.set(k, l); }
  }
  /** Écrit la minute en cours (appelé tout seul au changement de minute). */
  flush(): void {
    if (!this.minute || !this.pending.size) return;
    const line: Record<string, number> = {};
    for (const [k, l] of this.pending) { const v = l.reduce((a, b) => a + b, 0) / l.length; line[k] = Math.round(v * 1000) / 1000; const r = this.recent.get(k) ?? []; r.push([this.minute, line[k]]); while (r.length && r[0][0] < this.minute - 2 * 3600_000) r.shift(); this.recent.set(k, r); }
    try { appendFileSync(join(this.dir, `${day(this.minute)}.jsonl`), `${JSON.stringify({ t: this.minute, v: line })}\n`); } catch { /* disque plein */ }
    // Moyenne de l'heure.
    const h = Math.floor(this.minute / 3600_000) * 3600_000;
    if (this.hourAt && h !== this.hourAt) this.flushHour();
    this.hourAt = h; for (const [k, v] of Object.entries(line)) { const l = this.hour.get(k) ?? []; l.push(v); this.hour.set(k, l); }
    this.pending.clear();
  }
  private flushHour(): void {
    if (!this.hourAt || !this.hour.size) return;
    const line: Record<string, [number, number, number]> = {};
    for (const [k, l] of this.hour) line[k] = [Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 1000) / 1000, Math.min(...l), Math.max(...l)];
    try { appendFileSync(join(this.dir, `heures-${month(this.hourAt)}.jsonl`), `${JSON.stringify({ t: this.hourAt, v: line })}\n`); } catch { /* */ }
    this.hour.clear();
  }
  /** Efface les minutes de plus de `days` jours (les heures restent). */
  prune(days = 31): number {
    let n = 0; const limit = day(this.now() - days * 864e5);
    for (const f of readdirSync(this.dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < limit) { rmSync(join(this.dir, f), { force: true }); n++; }
    return n;
  }
  /** Les noms de séries connus (avec un préfixe éventuel). */
  names(prefix = ''): string[] {
    const s = new Set<string>([...this.recent.keys(), ...this.pending.keys()]);
    const f = join(this.dir, `${day(this.now())}.jsonl`);
    if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').slice(-200)) { try { for (const k of Object.keys((JSON.parse(l) as { v: object }).v)) s.add(k); } catch { /* ligne coupée */ } }
    return [...s].filter((k) => k.startsWith(prefix)).sort();
  }
  /** Les points bruts (une minute) d'une série entre deux instants. Au-delà de 31 jours : moyennes horaires. */
  points(name: string, from: number, to = this.now()): Point[] {
    const out: Point[] = [];
    if (to - from <= 2 * 3600_000 && this.recent.has(name)) { for (const p of this.recent.get(name)!) if (p[0] >= from && p[0] <= to) out.push(p); }
    else {
      const minutesFrom = Math.max(from, this.now() - 31 * 864e5);
      // Les heures pour ce qui est plus vieux que 31 jours.
      if (from < minutesFrom) for (let m = new Date(from).setDate(1); m <= minutesFrom; m = new Date(new Date(m).setMonth(new Date(m).getMonth() + 1)).getTime()) {
        const f = join(this.dir, `heures-${month(m)}.jsonl`); if (!existsSync(f)) continue;
        for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: number; v: Record<string, [number, number, number]> }; if (x.t >= from && x.t < minutesFrom && x.v[name]) out.push([x.t, x.v[name][0]]); } catch { /* */ } }
      }
      for (let t = new Date(minutesFrom).setHours(0, 0, 0, 0); t <= to; t += 864e5) {
        const f = join(this.dir, `${day(t)}.jsonl`); if (!existsSync(f)) continue;
        for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: number; v: Record<string, number> }; if (x.t >= minutesFrom && x.t <= to && x.v[name] !== undefined) out.push([x.t, x.v[name]]); } catch { /* */ } }
      }
    }
    // La minute en cours (pas encore écrite).
    const p = this.pending.get(name); if (p?.length && this.minute >= from && this.minute <= to) out.push([this.minute, p.reduce((a, b) => a + b, 0) / p.length]);
    return out.sort((a, b) => a[0] - b[0]);
  }
  /** La série regroupée en `buckets` paquets (pour une courbe lisible). */
  series(name: string, from: number, to = this.now(), buckets = 120): Agg[] {
    const pts = this.points(name, from, to); if (!pts.length) return [];
    const step = Math.max(60_000, Math.ceil((to - from) / buckets / 60_000) * 60_000), m = new Map<number, number[]>();
    for (const [t, v] of pts) { const b = Math.floor(t / step) * step; const l = m.get(b) ?? []; l.push(v); m.set(b, l); }
    return [...m].sort((a, b) => a[0] - b[0]).map(([t, l]) => ({ t, avg: l.reduce((a, b) => a + b, 0) / l.length, min: Math.min(...l), max: Math.max(...l), last: l[l.length - 1], n: l.length }));
  }
  /** Une fonction sur une fenêtre récente (pour les déclencheurs) : moyenne, min, max, dernière valeur, variation. */
  fn(name: string, f: 'avg' | 'min' | 'max' | 'last' | 'delta' | 'count', windowMs: number): number | undefined {
    const pts = this.points(name, this.now() - windowMs); if (!pts.length) return undefined;
    const vals = pts.map((p) => p[1]);
    switch (f) { case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length; case 'min': return Math.min(...vals); case 'max': return Math.max(...vals); case 'last': return vals[vals.length - 1]; case 'delta': return vals[vals.length - 1] - vals[0]; default: return vals.length; }
  }
  /** Texte au format Prometheus (dernière valeur de chaque série), pour d'autres outils. */
  prometheus(): string {
    const out: string[] = [];
    for (const n of this.names()) { const p = this.points(n, this.now() - 10 * 60_000); if (!p.length) continue; const name = `odin_${n.replace(/[^a-zA-Z0-9_]/g, '_')}`; out.push(`# TYPE ${name} gauge`, `${name} ${p[p.length - 1][1]} ${p[p.length - 1][0]}`); }
    return `${out.join('\n')}\n`;
  }
}

let current: Metrics | undefined;
export const setMetrics = (m: Metrics | undefined) => { current = m; };
/** Le rangement des mesures d'Odin (absent : les applis ne rangent rien, sans erreur). */
export const metrics = () => current;
