// L'agenda en iCalendar (RFC 5545), écrit pour Pégase : lecture d'un fichier .ics (VEVENT : SUMMARY, DTSTART,
// DTEND / DURATION, LOCATION, DESCRIPTION, CATEGORIES, UID, VALARM) et écriture (lignes CRLF pliées à 75 octets,
// caractères spéciaux échappés). Les rendez-vous suivent la forme du contrat Pégase ↔ Odin (§ 6).

export interface RendezVousIcs { id: string; titre: string; debut: string; fin: string; lieu?: string; agenda?: string; rappel?: number; couleur?: string; notes?: string }

const echapper = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const desechapper = (t: string) => t.replace(/\\([\\;,nN])/g, (_m, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** Plie une ligne à 75 octets (UTF-8) sans couper un caractère. */
function plier(ligne: string): string {
  const out: string[] = []; let cur = ''; let n = 0;
  for (const ch of ligne) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const estJour = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Écrit l'agenda en iCalendar. */
export function versIcs(l: RendezVousIcs[], nom = 'Agenda Pégase', maintenant = new Date()): string {
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TOUFATECH//Pegase//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${echapper(nom)}`];
  for (const r of l) {
    lignes.push('BEGIN:VEVENT', `UID:${r.id}@pegase.odin`, `DTSTAMP:${utc(maintenant)}`);
    if (estJour(r.debut)) { lignes.push(`DTSTART;VALUE=DATE:${r.debut.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${(estJour(r.fin) ? r.fin : r.debut).replace(/-/g, '')}`); }
    else { lignes.push(`DTSTART:${utc(new Date(r.debut))}`, `DTEND:${utc(new Date(r.fin))}`); }
    lignes.push(`SUMMARY:${echapper(r.titre || 'Rendez-vous')}`);
    if (r.lieu) lignes.push(`LOCATION:${echapper(r.lieu)}`);
    if (r.notes) lignes.push(`DESCRIPTION:${echapper(r.notes)}`);
    if (r.agenda) lignes.push(`CATEGORIES:${echapper(r.agenda)}`);
    if (r.couleur) lignes.push(`COLOR:${echapper(r.couleur)}`);
    if (typeof r.rappel === 'number' && r.rappel >= 0) lignes.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${echapper(r.titre || 'Rappel')}`, `TRIGGER:-PT${Math.round(r.rappel)}M`, 'END:VALARM');
    lignes.push('END:VEVENT');
  }
  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Une date iCalendar → ISO 8601 (avec décalage) ; journée entière → « AAAA-MM-JJ ». */
function lireDate(valeur: string, params: Record<string, string>): string | null {
  const v = valeur.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || params.VALUE === 'DATE') { m = m ?? /^(\d{4})(\d{2})(\d{2})/.exec(v); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v); if (!m) return null;
  const [, a, mo, j, h, mi, s, z] = m;
  if (z) return new Date(Date.UTC(+a, +mo - 1, +j, +h, +mi, +s)).toISOString();
  // Heure « flottante » ou avec TZID : lue comme l'heure locale de ce PC (les fuseaux nommés ne sont pas convertis).
  const d = new Date(+a, +mo - 1, +j, +h, +mi, +s);
  return isoLocal(d);
}
export function isoLocal(d: Date): string {
  const o = -d.getTimezoneOffset(); const sg = o >= 0 ? '+' : '-'; const ao = Math.abs(o);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sg}${pad(Math.floor(ao / 60))}:${pad(ao % 60)}`;
}
/** Une durée iCalendar (P1DT2H30M) en millisecondes. */
function duree(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim()); if (!m) return 0;
  const [, sg, w, d, h, mi, s] = m;
  const ms = (((+(w ?? 0) * 7 + +(d ?? 0)) * 24 + +(h ?? 0)) * 60 + +(mi ?? 0)) * 60_000 + +(s ?? 0) * 1000;
  return sg === '-' ? -ms : ms;
}

/** Lit un fichier .ics ; rend les rendez-vous (identifiants tirés de l'UID). */
export function depuisIcs(texte: string): RendezVousIcs[] {
  const brutes = texte.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: RendezVousIcs[] = [];
  let ev: Record<string, { v: string; p: Record<string, string> }> | null = null; let alarme: string | null = null; let dansAlarme = false;
  for (const l of brutes) {
    if (!l) continue;
    if (l === 'BEGIN:VEVENT') { ev = {}; alarme = null; continue; }
    if (l === 'BEGIN:VALARM') { dansAlarme = true; continue; }
    if (l === 'END:VALARM') { dansAlarme = false; continue; }
    if (l === 'END:VEVENT' && ev) {
      const p = ev.DTSTART ? lireDate(ev.DTSTART.v, ev.DTSTART.p) : null;
      if (p) {
        let f = ev.DTEND ? lireDate(ev.DTEND.v, ev.DTEND.p) : null;
        if (!f && ev.DURATION && !estJour(p)) f = new Date(new Date(p).getTime() + duree(ev.DURATION.v)).toISOString();
        if (!f) f = estJour(p) ? p : new Date(new Date(p).getTime() + 3600_000).toISOString();
        const uid = (ev.UID?.v ?? '').replace(/@pegase\.odin$/, '');
        const id = /^[A-Za-z0-9._:@-]{1,200}$/.test(uid) && uid ? uid : `ics-${Buffer.from(uid || `${p}|${ev.SUMMARY?.v ?? ''}`).toString('base64url').slice(0, 60)}`;
        out.push({ id, titre: desechapper(ev.SUMMARY?.v ?? 'Rendez-vous').slice(0, 300), debut: p, fin: f,
          ...(ev.LOCATION ? { lieu: desechapper(ev.LOCATION.v).slice(0, 300) } : {}),
          ...(ev.DESCRIPTION ? { notes: desechapper(ev.DESCRIPTION.v).slice(0, 4000) } : {}),
          ...(ev.CATEGORIES ? { agenda: desechapper(ev.CATEGORIES.v.split(',')[0]).slice(0, 60) } : {}),
          ...(alarme ? { rappel: Math.max(0, Math.round(-duree(alarme) / 60_000)) } : {}) });
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = l.indexOf(':'); if (i < 0) continue;
    const [nom, ...ps] = l.slice(0, i).split(';');
    const params: Record<string, string> = {}; for (const x of ps) { const [k, v] = x.split('='); if (k) params[k.toUpperCase()] = (v ?? '').replace(/^"|"$/g, ''); }
    const n = nom.toUpperCase(), v = l.slice(i + 1);
    if (dansAlarme) { if (n === 'TRIGGER' && !alarme && !params.VALUE) alarme = v; continue; }
    if (!ev[n]) ev[n] = { v, p: params };
  }
  return out;
}
