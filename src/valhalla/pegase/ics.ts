// Pégase : l'agenda en iCalendar (RFC 5545), écrit ici sans bibliothèque. Lignes en CRLF, pliées à 75 octets,
// textes échappés (\\ ; , et retours à la ligne), dates en UTC ou « VALUE=DATE » pour une journée entière.

import type { Rec } from './store.ts';

const esc = (t: unknown) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
/** Plie une ligne à 75 octets (sans couper un caractère UTF-8 en deux). */
export function plier(ligne: string): string {
  const out: string[] = []; let cur = '', n = 0, max = 75;
  for (const ch of ligne) {
    const b = Buffer.byteLength(ch);
    if (n + b > max) { out.push(cur); cur = ''; n = 0; max = 74; } // les lignes suivantes commencent par une espace
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Une date de rendez-vous : « 2026-11-20 » (journée entière) ou ISO 8601 avec heure. */
function quand(v: unknown): { date?: string; ms?: number } | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return { ms: v };
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { date: t.replace(/-/g, '') };
  const ms = Date.parse(t); return Number.isFinite(ms) ? { ms } : undefined;
}

export function agendaIcs(recs: Rec[], o: { nom: string; maintenant: number }): string {
  const l: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TOUFATECH//Odin Pegase//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(o.nom)}`];
  for (const r of recs) {
    if (r.suppr) continue;
    const d = r.data, deb = quand(d.debut); if (!deb) continue;
    let fin = quand(d.fin);
    if (deb.date && (!fin || !fin.date)) { const x = new Date(`${String(d.debut)}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); fin = { date: x.toISOString().slice(0, 10).replace(/-/g, '') }; }
    if (deb.ms !== undefined && (!fin || fin.ms === undefined || fin.ms < deb.ms)) fin = { ms: deb.ms + 3600_000 };
    l.push('BEGIN:VEVENT', `UID:${esc(r.id)}@pegase.odin`, `DTSTAMP:${utc(Math.min(r.maj, o.maintenant))}`, `LAST-MODIFIED:${utc(Math.min(r.maj, o.maintenant))}`);
    l.push(deb.date ? `DTSTART;VALUE=DATE:${deb.date}` : `DTSTART:${utc(deb.ms!)}`, fin!.date ? `DTEND;VALUE=DATE:${fin!.date}` : `DTEND:${utc(fin!.ms!)}`);
    l.push(`SUMMARY:${esc(d.titre || 'Rendez-vous')}`);
    if (d.lieu) l.push(`LOCATION:${esc(d.lieu)}`);
    if (d.notes) l.push(`DESCRIPTION:${esc(d.notes)}`);
    if (d.agenda) l.push(`CATEGORIES:${esc(d.agenda)}`);
    if (typeof d.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(d.couleur)) l.push(`X-APPLE-CALENDAR-COLOR:${d.couleur}`);
    const rap = Number(d.rappel);
    if (Number.isFinite(rap) && rap >= 0 && rap <= 40_320) l.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.titre || 'Rendez-vous')}`, `TRIGGER:-PT${Math.round(rap)}M`, 'END:VALARM');
    l.push('END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.map(plier).join('\r\n') + '\r\n';
}
