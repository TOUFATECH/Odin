// Le pays d'une adresse IP, sans rien demander à personne : une table gardée sur la machine d'Odin (DB-IP « IP to
// Country Lite », licence CC BY 4.0, mise à jour chaque mois), lue en mémoire et cherchée par dichotomie.
// Aucune adresse de ton réseau ne sort : seule la table est téléchargée.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const ATTRIBUTION = 'Pays : DB-IP (db-ip.com), licence CC BY 4.0';
const FILE = 'ip-pays.csv';
let cache: { file: string; mtime: number; starts: Uint32Array; ends: Uint32Array; cc: string[] } | null = null;

export const ip4 = (ip: string): number | null => { const p = ip.split('.'); if (p.length !== 4) return null; let n = 0; for (const x of p) { const v = Number(x); if (!/^\d{1,3}$/.test(x) || v > 255) return null; n = n * 256 + v; } return n >>> 0; };
/** Lit une table (lignes « début,fin,pays », IPv4 seulement), triée. Pur. */
export function parseTable(csv: string): { starts: Uint32Array; ends: Uint32Array; cc: string[] } {
  const rows: Array<[number, number, string]> = [];
  for (const line of csv.split('\n')) {
    const [a, b, c] = line.replace(/"/g, '').split(','); if (!c) continue;
    const s = ip4(a.trim()), e = ip4(b.trim()), cc = c.trim().toUpperCase(); if (s === null || e === null || !/^[A-Z]{2}$/.test(cc)) continue;
    rows.push([s, e, cc]);
  }
  rows.sort((x, y) => x[0] - y[0]);
  return { starts: Uint32Array.from(rows.map((r) => r[0])), ends: Uint32Array.from(rows.map((r) => r[1])), cc: rows.map((r) => r[2]) };
}
export function lookupIn(t: { starts: Uint32Array; ends: Uint32Array; cc: string[] }, ip: string): string | undefined {
  const n = ip4(ip); if (n === null) return undefined;
  let lo = 0, hi = t.starts.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.starts[mid] <= n) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at >= 0 && n <= t.ends[at] ? t.cc[at] : undefined;
}
/** Le code pays (FR, US…) d'une adresse, ou rien si la table manque. */
export function country(home: string, ip: string): string | undefined {
  const f = join(home, FILE); if (!existsSync(f)) return undefined;
  const m = statSync(f).mtimeMs;
  if (!cache || cache.file !== f || cache.mtime !== m) cache = { file: f, mtime: m, ...parseTable(readFileSync(f, 'utf8')) };
  return lookupIn(cache, ip);
}
export const hasTable = (home: string) => existsSync(join(home, FILE));
const names = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
export const countryName = (cc: string) => { try { return names?.of(cc) ?? cc; } catch { return cc; } };
export const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');

/** Télécharge la table du mois (ou du mois d'avant) chez DB-IP et la garde (IPv4 seulement). */
export async function updateTable(home: string, f: typeof fetch = fetch, now = new Date()): Promise<{ rows: number; month: string }> {
  let last = '';
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)), month = d.toISOString().slice(0, 7);
    const r = await f(`https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
    if (!r.ok) { last = `${r.status} ${r.statusText}`; continue; }
    const csv = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8').split('\n').filter((l) => /^"?\d+\.\d+\.\d+\.\d+"?,/.test(l)).join('\n');
    const t = parseTable(csv); if (t.cc.length < 1000) throw new Error('table des pays incomplète');
    writeFileSync(join(home, FILE), csv); cache = null;
    return { rows: t.cc.length, month };
  }
  throw new Error(`table des pays introuvable (${last})`);
}
