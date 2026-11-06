// Briefing du matin : météo, agenda du jour, mails non lus, rappels du jour, état des machines,
// puis ce qu'Odin a fait cette nuit. Assemblé par le code : le contenu des mails (non fiable) ne
// passe jamais par le modèle. Chaque partie est facultative : ce qui n'est pas réglé est sauté.

import type { Odin } from '../runtime.ts';
import { fetchEvents } from '../tools/calendar.ts';
import { unreadSummary } from '../tools/mail.ts';
import { isReminderJob, reminderText } from '../cron/reminders.ts';

/** Code météo WMO → mots et émoji (pur). */
export function weatherWords(code: number): [string, string] {
  if (code === 0) return ['☀️', 'grand soleil'];
  if (code <= 2) return ['🌤', 'quelques nuages'];
  if (code === 3) return ['☁️', 'couvert'];
  if (code === 45 || code === 48) return ['🌫', 'brouillard'];
  if (code >= 51 && code <= 57) return ['🌦', 'bruine'];
  if (code >= 61 && code <= 67) return ['🌧', code >= 65 ? 'forte pluie' : 'pluie'];
  if (code >= 71 && code <= 77) return ['🌨', 'neige'];
  if (code >= 80 && code <= 82) return ['🌦', code === 82 ? 'grosses averses' : 'averses'];
  if (code >= 95) return ['⛈', 'orages'];
  return ['🌡', 'temps variable'];
}

/** Ligne météo à partir de la réponse Open-Meteo (pur, testable). */
export function weatherLine(city: string, d: { daily?: { weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; wind_speed_10m_max?: number[] } }): string | undefined {
  const x = d.daily; if (!x?.temperature_2m_max?.length) return undefined;
  const [emo, words] = weatherWords(x.weather_code?.[0] ?? -1);
  const rain = x.precipitation_probability_max?.[0], wind = x.wind_speed_10m_max?.[0];
  return `${emo} Météo à ${city} : ${words}, ${Math.round(x.temperature_2m_min![0])}° → ${Math.round(x.temperature_2m_max[0])}°${rain != null && rain >= 30 ? `, pluie ${rain} %` : ''}${wind != null && wind >= 40 ? `, vent fort (${Math.round(wind)} km/h)` : ''}.`;
}

async function weather(odin: Odin): Promise<string | undefined> {
  const city = (odin.cfg.journal.city ?? '').trim();
  if (!city) return undefined;
  const k = `weather-geo:${city.toLowerCase()}`;
  let geo = JSON.parse(odin.muninn.getKv(k) ?? 'null') as { lat: number; lon: number; name: string } | null;
  if (!geo) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr`, { signal: AbortSignal.timeout(10_000) });
    const g = (await r.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> }).results?.[0];
    if (!g) return `🌡 Météo : je ne trouve pas la ville « ${city} » (Réglages → Journal).`;
    geo = { lat: g.latitude, lon: g.longitude, name: g.name };
    odin.muninn.setKv(k, JSON.stringify(geo));
  }
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(10_000) });
  return weatherLine(geo.name, await r.json() as Parameters<typeof weatherLine>[1]);
}

const hm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const clip = (s: string, n: number) => { const t = s.replace(/[\r\n<>]+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export async function morningBriefing(odin: Odin, night: string, now = Date.now()): Promise<{ text: string; speech: string }> {
  const d = new Date(now), start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const parts: string[] = [], said: string[] = [];
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  parts.push(`☀️ Bonjour ! Nous sommes ${day}.`);
  said.push(`Bonjour ! Nous sommes ${day}.`);

  // Météo
  const w = await weather(odin).catch(() => undefined);
  if (w) { parts.push(w); said.push(w.replace(/^\S+ /, '').replace(/→/, 'à').replace(/°/g, ' degrés')); }

  // Agenda
  const evs = await fetchEvents(start, end).catch(() => undefined);
  if (evs) {
    if (evs.length) {
      parts.push(`📅 Agenda :\n${evs.slice(0, 8).map((e) => `• ${e.allDay ? 'Journée' : hm(e.start)} — ${clip(e.title, 80)}${e.location ? ` (${clip(e.location, 40)})` : ''}`).join('\n')}`);
      said.push(`Dans ton agenda : ${evs.slice(0, 5).map((e) => `${e.allDay ? '' : `à ${hm(e.start)}, `}${clip(e.title, 60)}`).join(' ; ')}.`);
    } else if (process.env.CALENDAR_ICS_URL) { parts.push('📅 Agenda : rien de prévu aujourd\'hui.'); said.push('Rien dans ton agenda aujourd\'hui.'); }
  }

  // Mails non lus (seulement l'expéditeur et le sujet, coupés court)
  if (odin.cfg.mail.imapHost) {
    const m = await unreadSummary(odin.cfg.mail, 5).catch(() => undefined);
    if (m) {
      parts.push(m.count ? `✉️ ${m.count} mail${m.count > 1 ? 's' : ''} non lu${m.count > 1 ? 's' : ''} :\n${m.latest.map((x) => `• ${clip(x.from.replace(/\s*<[^>]*>/, ''), 30)} — ${clip(x.subject || '(sans sujet)', 70)}`).join('\n')}` : '✉️ Aucun mail non lu.');
      said.push(m.count ? `Tu as ${m.count} mail${m.count > 1 ? 's' : ''} non lu${m.count > 1 ? 's' : ''}.` : 'Aucun mail non lu.');
    }
  }

  // Rappels et tâches du jour
  const today = odin.muninn.listJobs().filter((j) => j.enabled && j.next_run >= now - 60_000 && j.next_run < end.getTime());
  const rem = today.filter(isReminderJob);
  if (rem.length) {
    parts.push(`🔔 Rappels d'aujourd'hui :\n${rem.map((j) => `• ${hm(new Date(j.next_run))} — ${clip(reminderText(j), 90)}`).join('\n')}`);
    said.push(`Tes rappels du jour : ${rem.map((j) => `à ${hm(new Date(j.next_run))}, ${clip(reminderText(j), 60)}`).join(' ; ')}.`);
  }

  // Machines : appareils surveillés hors ligne, nouveaux appareils de la nuit
  const devices = odin.inventory.list({ status: 'all' });
  const watched = odin.cfg.watch.devices.map((x) => devices.find((dv) => [String(dv.id), dv.ip, dv.label, dv.name, dv.hostname, dv.mac].some((v) => v && v.toLowerCase() === x.toLowerCase()))).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const down = watched.filter((dv) => dv.status !== 'online');
  const fresh = devices.filter((dv) => dv.first_seen >= now - 12 * 3600_000);
  const online = devices.filter((dv) => dv.status === 'online').length;
  if (devices.length) {
    const name = (dv: (typeof devices)[number]) => dv.label || dv.name || dv.hostname || dv.ip;
    parts.push(`🖥 Machines : ${online} appareil${online > 1 ? 's' : ''} en ligne${watched.length ? `, ${down.length ? `⚠️ hors ligne : ${down.map(name).join(', ')}` : 'tous les appareils surveillés vont bien'}` : ''}${fresh.length ? ` · ${fresh.length} nouveau${fresh.length > 1 ? 'x' : ''} cette nuit : ${fresh.slice(0, 4).map(name).join(', ')}` : ''}.`);
    said.push(down.length ? `Attention, ${down.map(name).join(', ')} ${down.length > 1 ? 'sont' : 'est'} hors ligne.` : 'Tes machines vont bien.');
  }

  // La nuit d'Odin
  if (night.trim()) { parts.push(`🌙 Cette nuit :\n${night.trim()}`); said.push(night.trim().replace(/^[-•]\s*/gm, '').replace(/\n+/g, ' ')); }
  if (!odin.cfg.journal.city) parts.push('📍 Dis-moi ta ville (« ma ville est … ») pour avoir la météo chaque matin.');
  return { text: parts.join('\n\n'), speech: said.join(' ').slice(0, 1800) };
}
