// Zeus — les 1, 2, 3 prochains mois (pur, sauf la lecture). Deux systèmes du centre européen, servis par Open-Meteo :
//  - ECMWF SEAS5 (moyenne de 51 membres) : un écart à la normale par mois, 6 à 7 mois ;
//  - ECMWF EC46 : un écart à la normale par semaine, jusqu'à 46 jours (null ensuite).
// Les semaines d'EC46 sont regroupées par mois (celles qui COMMENCENT dans le mois) : moyenne pour la température,
// somme pour la pluie, au moins 2 semaines, sinon « EC46 ne prévoit pas si loin ». Ces deux systèmes viennent du même
// centre : ce ne sont pas deux sources indépendantes, et la page le dit. STRATA ne prévoit pas si loin.

import { MOT, PHRASE_VERT, TON, type Couleur, type Verdict } from './comparer.ts';
import { EC46, SEAS5 } from './sources.ts';
import { PAS_SI_LOIN } from './strata.ts';
import { murale } from '../../draupnir/rythme.ts';

export interface AnomalieMois { mois: string; t: number | null; pluie: number | null; vent: number | null }
export interface AnomalieSemaine { debut: string; t: number | null; pluie: number | null }
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
function serie(b: Record<string, unknown>, v: string, m: string): unknown[] {
  const a = b[`${v}_${m}`] ?? b[v]; return Array.isArray(a) ? a : [];
}
/** SEAS5 : un écart par mois (« 2026-11 »). */
export function lireSeas5(json: unknown): AnomalieMois[] {
  const b = (json as { monthly?: Record<string, unknown> } | null)?.monthly; if (!b || !Array.isArray(b.time)) return [];
  const t = serie(b, 'temperature_2m_anomaly', SEAS5), p = serie(b, 'precipitation_anomaly', SEAS5), w = serie(b, 'wind_speed_10m_anomaly', SEAS5);
  return (b.time as unknown[]).map((d, i) => ({ mois: String(d).slice(0, 7), t: num(t[i]), pluie: num(p[i]), vent: num(w[i]) }));
}
/** EC46 : un écart par semaine (date du début de la semaine). */
export function lireEc46(json: unknown): AnomalieSemaine[] {
  const b = (json as { weekly?: Record<string, unknown> } | null)?.weekly; if (!b || !Array.isArray(b.time)) return [];
  const t = serie(b, 'temperature_2m_anomaly', EC46), p = serie(b, 'precipitation_anomaly', EC46);
  return (b.time as unknown[]).map((d, i) => ({ debut: String(d).slice(0, 10), t: num(t[i]), pluie: num(p[i]) }));
}
/** Les semaines d'EC46 qui commencent dans le mois, regroupées (au moins 2, sinon rien). */
export function regrouperEc46(sem: AnomalieSemaine[], mois: string): { t: number; pluie: number | null; semaines: number } | undefined {
  const l = sem.filter((s) => s.debut.slice(0, 7) === mois && s.t !== null);
  if (l.length < 2) return undefined;
  const pl = l.filter((s) => s.pluie !== null);
  return { t: l.reduce((a, s) => a + (s.t as number), 0) / l.length, pluie: pl.length === l.length ? pl.reduce((a, s) => a + (s.pluie as number), 0) : null, semaines: l.length };
}

const fr = (x: number, n = 1) => String(Math.round(Math.abs(x) * 10 ** n) / 10 ** n).replace('.', ',');
const signe = (x: number) => (x < 0 ? '−' : '+');
/** « plus chaud que d'habitude de 1 °C », « plus frais que d'habitude de 0,6 °C », « proche de la normale ». */
export function texteTemperature(t: number | null): string {
  if (t === null) return '—';
  if (Math.abs(t) < 0.3) return `température proche de la normale (${signe(t)}${fr(t)} °C)`;
  return `${t > 0 ? 'plus chaud' : 'plus frais'} que d'habitude de ${fr(t)} °C`;
}
/** « plus sec que d'habitude (−10 mm sur le mois) », « plus pluvieux que d'habitude (+25 mm sur le mois) ». */
export function textePluie(p: number | null, sur = 'le mois'): string {
  if (p === null) return '—';
  if (Math.abs(p) < 5) return `pluie proche de la normale (${signe(p)}${fr(p, 0)} mm sur ${sur})`;
  return `${p < 0 ? 'plus sec' : 'plus pluvieux'} que d'habitude (${signe(p)}${fr(p, 0)} mm sur ${sur})`;
}

const v = (couleur: Couleur, phrase: string): Verdict => ({ couleur, mot: MOT[couleur], ton: TON[couleur], phrase });
/** SEAS5 face à EC46 : même signe et 1 °C d'écart ou moins = vert ; sinon jaune ; source en panne = rouge. */
export function verdictSaison(seas5: { t: number | null } | 'panne' | undefined, ec46: { t: number } | 'panne' | undefined): Verdict {
  if (seas5 === 'panne') return v('rouge', 'Souci : ECMWF SEAS5 ne répond pas');
  if (ec46 === 'panne') return v('rouge', 'Souci : ECMWF EC46 ne répond pas');
  if (!seas5 || seas5.t === null) return v('gris', 'ECMWF SEAS5 ne prévoit pas si loin');
  if (!ec46) return v('gris', 'EC46 ne prévoit pas si loin');
  const a = seas5.t, b = ec46.t, d = b - a;
  const memeSens = a * b >= 0 || (Math.abs(a) < 0.3 && Math.abs(b) < 0.3);
  if (memeSens && Math.abs(d) <= 1) return v('vert', `${PHRASE_VERT} (SEAS5 et EC46 d'accord)`);
  return v('jaune', `Prédiction diffère : EC46 annonce ${signe(b)}${fr(b)} °C, SEAS5 ${signe(a)}${fr(a)} °C (écart ${fr(d)} °C)`);
}

export interface LigneMois {
  mois: string; rang: number; nom: string;
  seas5: { t: number | null; pluie: number | null; vent: number | null } | 'panne' | undefined;
  ec46: { t: number; pluie: number | null; semaines: number } | 'panne' | undefined;
  texteSeas5: string; texteEc46: string; strata: string; verdict: Verdict;
}
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** Le mois en cours puis +1, +2, +3 (« 2026-11 »), à l'heure du lieu. */
export function moisAVenir(now: Date, fuseau: string, n = 3): string[] {
  const m = murale(now.getTime(), fuseau), out: string[] = [];
  for (let k = 0; k <= n; k++) { const d = new Date(Date.UTC(m.y, m.mo - 1 + k, 1)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  return out;
}
export const nomMois = (mois: string) => { const [y, m] = mois.split('-').map(Number); return `${NOMS_MOIS[m - 1] ?? mois} ${y}`; };

/** Les lignes du tableau « Mois » : SEAS5, EC46 regroupé, STRATA (toujours honnête), verdict. */
export function lignesMois(mois: string[], seas5: AnomalieMois[] | 'panne', ec46: AnomalieSemaine[] | 'panne'): LigneMois[] {
  return mois.map((m, rang) => {
    const s = seas5 === 'panne' ? 'panne' as const : seas5.find((x) => x.mois === m);
    const e = ec46 === 'panne' ? 'panne' as const : regrouperEc46(ec46, m);
    const ts = s === 'panne' ? 'ne répond pas' : !s || s.t === null ? 'ne prévoit pas si loin' : [texteTemperature(s.t), textePluie(s.pluie)].join(' ; ');
    const te = e === 'panne' ? 'ne répond pas' : !e ? 'EC46 ne prévoit pas si loin' : [texteTemperature(e.t), textePluie(e.pluie, `${e.semaines} semaines`)].join(' ; ');
    return { mois: m, rang, nom: nomMois(m), seas5: s && s !== 'panne' ? { t: s.t, pluie: s.pluie, vent: s.vent } : s, ec46: e, texteSeas5: ts, texteEc46: te, strata: PAS_SI_LOIN, verdict: verdictSaison(s, e) };
  });
}
