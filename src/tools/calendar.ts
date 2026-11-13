// Agenda : lire tes rendez-vous (adresse iCal / ICS, par ex. « adresse secrète au format iCal » de
// Google Agenda, dans CALENDAR_ICS_URL) et en ajouter (CalDAV : Nextcloud, iCloud, Fastmail… ;
// adresse du calendrier dans Réglages, mot de passe d'application dans CALDAV_PASSWORD).

import { lanRequest } from './lan.ts';
import { num, obj, str, type Tool, type ToolContext } from './registry.ts';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { isPrivateHost } from '../heimdall/policy.ts';

const s = (v: unknown) => String(v ?? '');
export interface CalEvent { start: Date; end?: Date; allDay: boolean; title: string; location: string; rrule?: string }

const unfold = (ics: string) => ics.replace(/\r?\n[ \t]/g, '');
const icsText = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function icsDate(v: string, params: string): { d: Date; allDay: boolean } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return undefined;
  if (!m[4]) return { d: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true };
  const args = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])] as const;
  return { d: m[7] ? new Date(Date.UTC(...args)) : new Date(...args), allDay: /VALUE=DATE(;|$)/.test(params) };
}

/** Évènements d'un fichier ICS, avec les répétitions simples (quotidiennes, hebdomadaires, mensuelles, annuelles) dans la fenêtre (pur, testable). */
export function parseIcs(ics: string, from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  for (const block of unfold(ics).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const prop = (name: string) => { const m = new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*)$`, 'm').exec(body); return m ? { params: m[1], value: m[2].trim() } : undefined; };
    const st = prop('DTSTART'), en = prop('DTEND');
    const start = st && icsDate(st.value, st.params);
    if (!start) continue;
    const end = en ? icsDate(en.value, en.params)?.d : undefined;
    const ev: CalEvent = { start: start.d, end, allDay: start.allDay, title: icsText(prop('SUMMARY')?.value ?? '(sans titre)'), location: icsText(prop('LOCATION')?.value ?? ''), rrule: prop('RRULE')?.value };
    if (!ev.rrule) { if (ev.start <= to && (ev.end ?? ev.start) >= from) out.push(ev); continue; }
    const r = Object.fromEntries(ev.rrule.split(';').map((p) => p.split('=') as [string, string]));
    const step = { DAILY: 1, WEEKLY: 7 }[r.FREQ as 'DAILY' | 'WEEKLY'], interval = Number(r.INTERVAL ?? 1);
    const until = r.UNTIL ? icsDate(r.UNTIL, '')?.d : undefined, count = r.COUNT ? Number(r.COUNT) : Infinity;
    const dur = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;
    let cur = new Date(ev.start), k = 0;
    while (cur <= to && k < count && k < 2000 && (!until || cur <= until)) {
      if (cur >= from || cur.getTime() + dur >= from.getTime()) out.push({ ...ev, start: new Date(cur), end: dur ? new Date(cur.getTime() + dur) : undefined });
      k++;
      if (step) cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + step * interval, cur.getHours(), cur.getMinutes());
      else if (r.FREQ === 'MONTHLY') cur = new Date(cur.getFullYear(), cur.getMonth() + interval, cur.getDate(), cur.getHours(), cur.getMinutes());
      else if (r.FREQ === 'YEARLY') cur = new Date(cur.getFullYear() + interval, cur.getMonth(), cur.getDate(), cur.getHours(), cur.getMinutes());
      else break;
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const formatEvents = (evs: CalEvent[]) => evs.map((e) => `${e.start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}${e.allDay ? ' (journée)' : ` ${e.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${e.end ? `–${e.end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`} · ${e.title}${e.location ? ` · ${e.location}` : ''}`).join('\n') || 'Aucun rendez-vous sur cette période.';

/** Évènements de l'agenda relié entre deux dates (lève une erreur si l'agenda ne répond pas). */
export async function fetchEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const url = process.env.CALENDAR_ICS_URL ?? '';
  if (!url) return [];
  const u = url.replace(/^webcal:/, 'https:');
  const r = isPrivateHost(new URL(u).hostname) ? await lanRequest(u) : await fetch(u, { signal: AbortSignal.timeout(20_000) }).then(async (x) => ({ status: x.status, text: await x.text() }));
  if (r.status >= 400) throw new Error(`Agenda : HTTP ${r.status}`);
  return parseIcs(r.text, from, to);
}

export const calendarList: Tool = {
  name: 'calendar_list',
  description: 'Tes rendez-vous à venir (agenda relié dans Réglages → Agenda). Par défaut les 7 prochains jours.',
  risk: 'network',
  taints: true,
  // Lire TON agenda : une consultation (le point du matin doit pouvoir le lire même après la météo ou une recherche).
  lookup: () => true,
  schema: obj({ days: num('nombre de jours à venir (7 par défaut, 90 max)'), search: str('mot à chercher (facultatif)') }),
  async run(i) {
    const url = process.env.CALENDAR_ICS_URL ?? '';
    if (!url) return 'L\'agenda n\'est pas relié : Réglages → Agenda (adresse iCal).';
    const u = url.replace(/^webcal:/, 'https:');
    // Agenda sur Internet (Google, iCloud…) : vérification normale du certificat ; sur ton réseau : certificat maison accepté.
    const r = isPrivateHost(new URL(u).hostname) ? await lanRequest(u) : await fetch(u, { signal: AbortSignal.timeout(20_000) }).then(async (x) => ({ status: x.status, text: await x.text() }));
    if (r.status >= 400) return `Agenda : HTTP ${r.status}`;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + Math.min(90, Math.max(1, Number(i.days ?? 7))) * 86_400_000);
    const q = s(i.search).toLowerCase();
    const evs = parseIcs(r.text, from, to).filter((e) => !q || `${e.title} ${e.location}`.toLowerCase().includes(q));
    return { output: wrapUntrusted('agenda', formatEvents(evs)), tainted: true };
  },
};

/** Évènement iCalendar à déposer par CalDAV (pur, testable). */
export function buildIcs(uid: string, title: string, start: Date, end: Date, location = '', now = new Date()): string {
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Odin//FR', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${z(now)}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(title)}`, ...(location ? [`LOCATION:${esc(location)}`] : []), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

export const calendarAdd: Tool = {
  name: 'calendar_add',
  description: 'Ajoute un rendez-vous à ton agenda (CalDAV). Dates au format AAAA-MM-JJTHH:MM (heure locale).',
  risk: 'external',
  schema: obj({ title: str('titre'), start: str('début (AAAA-MM-JJTHH:MM)'), end: str('fin (facultatif, 1 h par défaut)'), location: str('lieu (facultatif)') }, ['title', 'start']),
  summarize: (i) => `agenda : ajouter « ${s(i.title)} » le ${s(i.start)}`,
  async run(i, ctx: ToolContext) {
    const cal = ctx.calendar?.caldavUrl ?? '', user = ctx.calendar?.caldavUser ?? '', pw = process.env.CALDAV_PASSWORD ?? '';
    if (!cal || !user || !pw) return 'L\'ajout n\'est pas configuré : Réglages → Agenda (adresse CalDAV du calendrier, identifiant, mot de passe d\'application).';
    const start = new Date(s(i.start));
    if (Number.isNaN(start.getTime())) return 'Date de début invalide (AAAA-MM-JJTHH:MM).';
    const end = s(i.end) ? new Date(s(i.end)) : new Date(start.getTime() + 3600_000);
    const uid = `odin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const target = `${cal.replace(/\/?$/, '/')}${uid}.ics`;
    const req = { method: 'PUT', headers: { authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`, 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' }, body: buildIcs(uid, s(i.title), start, end, s(i.location)) };
    const r = isPrivateHost(new URL(target).hostname) ? await lanRequest(target, req) : await fetch(target, { ...req, signal: AbortSignal.timeout(20_000) }).then(async (x) => ({ status: x.status, text: await x.text() }));
    if (r.status >= 400) return `Agenda : refusé (HTTP ${r.status}) ${r.text.slice(0, 160)}`;
    return `Rendez-vous ajouté : « ${s(i.title)} » le ${start.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}.`;
  },
};

export const CALENDAR_TOOLS: Tool[] = [calendarList, calendarAdd];
