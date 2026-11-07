// Alertes locales : météo dangereuse des prochaines 48 h (pluie forte, vent violent, orages) d'après
// Open-Meteo, et actualités de ta région (cyclone, vigilance, coupure d'eau ou d'électricité,
// inondation, séisme…) d'après les moteurs d'actualités. Vérifié toutes les 2 heures, sans doublon.
// Les titres d'actualité sont donnés tels quels avec leur lien : jamais lus comme des consignes.

import { webSearch } from '../tools/search.ts';

type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void };

export interface Daily { time: string[]; weather_code?: number[]; precipitation_sum?: number[]; wind_gusts_10m_max?: number[] }

/** Jours dangereux dans la prévision (pur). */
export function severeWeather(d: Daily, place: string): Array<{ key: string; text: string; urgent: boolean }> {
  const out: Array<{ key: string; text: string; urgent: boolean }> = [];
  d.time.slice(0, 3).forEach((day, k) => {
    const rain = d.precipitation_sum?.[k] ?? 0, gust = d.wind_gusts_10m_max?.[k] ?? 0, code = d.weather_code?.[k] ?? 0;
    const when = k === 0 ? 'Aujourd\'hui' : k === 1 ? 'Demain' : new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
    const what: string[] = [];
    if (rain >= 50) what.push(`très fortes pluies (${Math.round(rain)} mm)`); else if (rain >= 30) what.push(`fortes pluies (${Math.round(rain)} mm)`);
    if (gust >= 100) what.push(`vent violent (rafales à ${Math.round(gust)} km/h)`); else if (gust >= 70) what.push(`vent fort (rafales à ${Math.round(gust)} km/h)`);
    if (code >= 95) what.push('orages');
    if (what.length) out.push({ key: `meteo:${day}:${what.join()}`, text: `⚠️ ${when} à ${place} : ${what.join(', ')}.`, urgent: rain >= 50 || gust >= 100 });
  });
  return out;
}

const DANGER = /cyclone|temp[eê]te tropicale|d[ée]pression tropicale|vigilance|alerte (rouge|orange|cyclonique)|coupure d'?eau|coupures? d'?(eau|[ée]lectricit[ée]|courant)|tours d'?eau|d[ée]lestage|panne (g[ée]n[ée]rale|d'?[ée]lectricit[ée])|inondation|crue|s[ée]isme|tremblement de terre|tsunami|[ée]vacuation|confinement|eau (non )?potable|route coup[ée]e|barrage/i;
const URGENT = /cyclone|alerte rouge|tsunami|s[ée]isme|tremblement|[ée]vacuation|confinement/i;

/** Garde les actualités qui annoncent un danger ou une coupure, récentes, pas déjà envoyées (pur). */
export function pickNews(items: Array<{ title: string; url: string; snippet: string }>, seen: string[], now = new Date()): Array<{ key: string; text: string; urgent: boolean }> {
  const fresh = (snip: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(snip); if (!m) return true; const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); return now.getTime() - d.getTime() < 2 * 86_400_000; };
  return items.filter((x) => DANGER.test(x.title) && fresh(x.snippet) && !seen.includes(x.url))
    .slice(0, 4).map((x) => ({ key: x.url, text: `${URGENT.test(x.title) ? '🚨' : '📰'} ${x.title.replace(/\s+/g, ' ').slice(0, 160)}\n${x.url}`, urgent: URGENT.test(x.title) }));
}

/** Tour de vérification. place = ville (Réglages → Journal), region = département/territoire (Mayotte…). */
export async function checkLocalAlerts(kv: Kv, place: string, region: string, now = new Date(), fetchFn: typeof fetch = fetch): Promise<Array<{ text: string; urgent: boolean }>> {
  if (!place && !region) return [];
  const seen = (kv.getKv('alerts-seen') ?? '').split('\n').filter(Boolean);
  const out: Array<{ key: string; text: string; urgent: boolean }> = [];
  // Météo
  if (place) {
    try {
      const k = `weather-geo:${place.toLowerCase()}`;
      let geo = JSON.parse(kv.getKv(k) ?? 'null') as { lat: number; lon: number; name: string } | null;
      if (!geo) {
        const g = (await (await fetchFn(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=fr`, { signal: AbortSignal.timeout(10_000) })).json() as { results?: Array<{ latitude: number; longitude: number; name: string }> }).results?.[0];
        if (g) { geo = { lat: g.latitude, lon: g.longitude, name: g.name }; kv.setKv(k, JSON.stringify(geo)); }
      }
      if (geo) {
        const f = await (await fetchFn(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,precipitation_sum,wind_gusts_10m_max&timezone=auto&forecast_days=3`, { signal: AbortSignal.timeout(10_000) })).json() as { daily?: Daily };
        if (f.daily) out.push(...severeWeather(f.daily, geo.name));
      }
    } catch { /* météo indisponible */ }
  }
  // Actualités de la région
  const where = region || place;
  try {
    const q = `${where} (cyclone OR vigilance OR "coupure d'eau" OR "coupure d'électricité" OR inondation OR séisme OR alerte)`;
    const r = await webSearch(q, 15, { provider: 'news', fetcher: fetchFn });
    out.push(...pickNews(r.results, seen, now));
  } catch { /* actualités indisponibles */ }
  const fresh = out.filter((x) => !seen.includes(x.key));
  kv.setKv('alerts-seen', [...seen, ...fresh.map((x) => x.key)].slice(-300).join('\n'));
  return fresh.map(({ text, urgent }) => ({ text, urgent }));
}
