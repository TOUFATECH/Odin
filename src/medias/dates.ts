// Médias reçus : les dates. EXIF (« 2026:08:14 17:32:05 »), ISO 8601 partiel, secondes depuis 1904 (MP4), nanosecondes
// depuis 2001 (Matroska), IPTC (CCYYMMDD + HHMMSS±HHMM), AVI IDIT (« Mon Jul 14 18:22:05 2024 »). Analyse caractère
// par caractère (aucune expression régulière sur le contenu). Une date vide ou impossible est absente, jamais inventée.

import type { DateLue } from './contrat.ts';

type Role = DateLue['role'];
type Precision = DateLue['precision'];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const d2 = (n: number) => String(n).padStart(2, '0');

export interface Parties { a: number; mo?: number; j?: number; h?: number; mi?: number; s?: number; ms?: number; fuseauMin?: number }

/** « +03:00 » pour 180 minutes. */
export function fuseauTexte(min: number): string {
  const s = min < 0 ? '-' : '+', m = Math.abs(min);
  return `${s}${d2(Math.floor(m / 60))}:${d2(m % 60)}`;
}

/** Construit une date à partir de ses parties ; undefined si vide ou impossible. */
export function dateDepuisParties(p: Parties, role: Role, maintenant: number, fuseauSource: DateLue['fuseauSource'] = p.fuseauMin !== undefined ? 'fichier' : 'inconnu'): DateLue | undefined {
  const anneeMax = new Date(maintenant).getUTCFullYear() + 1;
  if (!Number.isInteger(p.a) || p.a < 1800 || p.a > anneeMax) return undefined;
  if (p.mo !== undefined && (!Number.isInteger(p.mo) || p.mo < 1 || p.mo > 12)) return undefined;
  if (p.j !== undefined) {
    if (p.mo === undefined || !Number.isInteger(p.j) || p.j < 1) return undefined;
    const jours = new Date(Date.UTC(p.a, p.mo, 0)).getUTCDate();
    if (p.j > jours) return undefined;
  }
  if (p.h !== undefined && (p.j === undefined || !Number.isInteger(p.h) || p.h < 0 || p.h > 23)) return undefined;
  if (p.mi !== undefined && (p.h === undefined || !Number.isInteger(p.mi) || p.mi < 0 || p.mi > 59)) return undefined;
  if (p.s !== undefined && (p.mi === undefined || !Number.isInteger(p.s) || p.s < 0 || p.s > 60)) return undefined;
  if (p.ms !== undefined && (p.s === undefined || !Number.isInteger(p.ms) || p.ms < 0 || p.ms > 999)) return undefined;
  if (p.fuseauMin !== undefined && (p.fuseauMin < -14 * 60 || p.fuseauMin > 14 * 60)) return undefined;
  const precision: Precision = p.ms !== undefined ? 'milliseconde' : p.s !== undefined ? 'seconde' : p.mi !== undefined ? 'minute'
    : p.j !== undefined ? 'jour' : p.mo !== undefined ? 'mois' : 'année';
  let iso = String(p.a).padStart(4, '0');
  if (p.mo !== undefined) iso += `-${d2(p.mo)}`;
  if (p.j !== undefined) iso += `-${d2(p.j)}`;
  if (p.h !== undefined) iso += `T${d2(p.h)}:${d2(p.mi ?? 0)}`;
  if (p.s !== undefined) iso += `:${d2(Math.min(59, p.s))}`;
  if (p.ms !== undefined) iso += `.${String(p.ms).padStart(3, '0')}`;
  const fuseau = p.fuseauMin !== undefined ? fuseauTexte(p.fuseauMin) : undefined;
  let utc: string | undefined;
  if (p.h !== undefined && p.fuseauMin !== undefined) {
    const t = Date.UTC(p.a, p.mo! - 1, p.j!, p.h, p.mi ?? 0, Math.min(59, p.s ?? 0), p.ms ?? 0) - p.fuseauMin * 60_000;
    const x = new Date(t).toISOString();
    utc = precision === 'milliseconde' ? x : `${x.slice(0, 19)}Z`;
  }
  if (fuseau && p.h !== undefined) iso += fuseauSource === 'UTC par définition' && p.fuseauMin === 0 ? 'Z' : fuseau;
  let texte: string;
  if (precision === 'année') texte = String(p.a);
  else if (precision === 'mois') texte = `${MOIS[p.mo! - 1]} ${p.a}`;
  else if (precision === 'jour') texte = `${d2(p.j!)}/${d2(p.mo!)}/${p.a}`;
  else texte = `${d2(p.j!)}/${d2(p.mo!)}/${p.a} à ${d2(p.h!)}:${d2(p.mi ?? 0)}`;
  if (fuseau && p.h !== undefined) texte += fuseauSource === 'UTC par définition' ? ' (UTC)' : ` (UTC${fuseau})`;
  return { texte, iso, utc, fuseau, fuseauSource: fuseau || fuseauSource === 'UTC par définition' ? fuseauSource : 'inconnu', precision, role };
}

/** Lit des chiffres consécutifs à partir de i. */
function chiffres(s: string, i: number, n: number): number | undefined {
  if (i + n > s.length) return undefined;
  let v = 0;
  for (let k = 0; k < n; k++) { const c = s.charCodeAt(i + k) - 48; if (c < 0 || c > 9) return undefined; v = v * 10 + c; }
  return v;
}

/** Fuseau « Z », « +03:00 », « +0300 », « +03 » à partir de i ; undefined si absent ou invalide. */
export function lireFuseau(s: string, i: number): { min: number; fin: number } | undefined {
  const c = s[i];
  if (c === 'Z' || c === 'z') return { min: 0, fin: i + 1 };
  if (c !== '+' && c !== '-' && c !== '−') return undefined;
  const sg = c === '+' ? 1 : -1;
  const h = chiffres(s, i + 1, 2); if (h === undefined) return undefined;
  let j = i + 3, m = 0;
  if (s[j] === ':') j++;
  const mm = chiffres(s, j, 2);
  if (mm !== undefined) { m = mm; j += 2; } else if (s[i + 3] === ':') return undefined;
  if (h > 14 || m > 59) return undefined;
  return { min: sg * (h * 60 + m), fin: j };
}

/**
 * ISO 8601 (et formes voisines) : « 2024 », « 2024-08 », « 2024-08-14 », « 2024-08-14T17:32:05+03:00 »,
 * « 2024-08-14 17:32 », « 2026-08-14T17:32:05+0300 », « 2024:08:14 17:32:05 » (séparateurs EXIF admis).
 */
export function lireDateIso(entree: string, role: Role, maintenant: number, o: { utcSiSansFuseau?: boolean } = {}): DateLue | undefined {
  const s = entree.trim().slice(0, 64);
  const a = chiffres(s, 0, 4); if (a === undefined || a === 0) return undefined;
  const p: Parties = { a };
  let i = 4;
  const sep = (k: number) => s[k] === '-' || s[k] === ':' || s[k] === '/' || s[k] === '.';
  if (sep(i)) {
    const mo = chiffres(s, i + 1, 2); if (mo === undefined) return undefined;
    if (mo === 0) return undefined;
    p.mo = mo; i += 3;
    if (sep(i)) {
      const j = chiffres(s, i + 1, 2); if (j === undefined) return undefined;
      if (j === 0) return undefined;
      p.j = j; i += 3;
      if (s[i] === 'T' || s[i] === ' ' || s[i] === 't') {
        const h = chiffres(s, i + 1, 2), mi = s[i + 3] === ':' ? chiffres(s, i + 4, 2) : undefined;
        if (h !== undefined && mi !== undefined) {
          p.h = h; p.mi = mi; i += 6;
          if (s[i] === ':') { const sec = chiffres(s, i + 1, 2); if (sec !== undefined) { p.s = sec; i += 3; } }
          if ((s[i] === '.' || s[i] === ',') && p.s !== undefined) {
            let k = i + 1, frac = '';
            while (k < s.length && k < i + 10 && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) frac += s[k++];
            if (frac.length) { p.ms = Math.min(999, Math.round(Number(`0.${frac}`) * 1000)); i = k; }
          }
          const f = lireFuseau(s, i);
          if (f) { p.fuseauMin = f.min; i = f.fin; }
        }
      }
    }
  } else if (s.length >= 8 && chiffres(s, 4, 4) !== undefined) {
    // AAAAMMJJ (IPTC, ID3 TDAT…)
    const mo = chiffres(s, 4, 2)!, j = chiffres(s, 6, 2)!;
    if (mo === 0 || j === 0) return undefined;
    p.mo = mo; p.j = j;
  }
  if (p.fuseauMin === undefined && o.utcSiSansFuseau && p.h !== undefined) { p.fuseauMin = 0; return dateDepuisParties(p, role, maintenant, 'UTC par définition'); }
  return dateDepuisParties(p, role, maintenant, p.fuseauMin === 0 && (s.endsWith('Z') || s.endsWith('z')) ? 'UTC par définition' : undefined);
}

/** Date EXIF « AAAA:MM:JJ HH:MM:SS » + sous-secondes et fuseau éventuels (« +03:00 »). */
export function lireDateExif(s: string, role: Role, maintenant: number, o: { sousSec?: string; fuseau?: string } = {}): DateLue | undefined {
  const t = s.trim();
  if (!t || t.startsWith('0000') || t.startsWith('    ')) return undefined;
  let d = lireDateIso(t.slice(0, 19), role, maintenant);
  if (!d) return undefined;
  const f = o.fuseau ? lireFuseau(o.fuseau.trim(), 0) : undefined;
  if (f || (o.sousSec && d.precision === 'seconde')) {
    const p = partiesDe(d);
    if (o.sousSec && d.precision === 'seconde') {
      const frac = o.sousSec.trim();
      let ok = frac.length > 0 && frac.length <= 9;
      for (let k = 0; k < frac.length && ok; k++) if (frac.charCodeAt(k) < 48 || frac.charCodeAt(k) > 57) ok = false;
      if (ok) p.ms = Math.min(999, Math.round(Number(`0.${frac}`) * 1000));
    }
    if (f) p.fuseauMin = f.min;
    d = dateDepuisParties(p, role, maintenant) ?? d;
  }
  return d;
}

/** Retrouve les parties d'une date lue (depuis son ISO). */
export function partiesDe(d: DateLue): Parties {
  const s = d.iso;
  const p: Parties = { a: chiffres(s, 0, 4)! };
  if (s[4] === '-') p.mo = chiffres(s, 5, 2);
  if (s[7] === '-') p.j = chiffres(s, 8, 2);
  if (s[10] === 'T') { p.h = chiffres(s, 11, 2); p.mi = chiffres(s, 14, 2); }
  if (s[16] === ':') p.s = chiffres(s, 17, 2);
  if (s[19] === '.') p.ms = chiffres(s, 20, 3);
  if (d.fuseau) { const f = lireFuseau(d.fuseau, 0); if (f) p.fuseauMin = f.min; }
  return p;
}

/** Instant « naïf » (heure lue comme si elle était UTC) d'une date au moins à la minute. */
export function instantNaif(d: DateLue): number | undefined {
  const p = partiesDe(d);
  if (p.h === undefined || p.mo === undefined || p.j === undefined) return undefined;
  return Date.UTC(p.a, p.mo - 1, p.j, p.h, p.mi ?? 0, p.s ?? 0);
}

/** Un instant UTC (ms) en date lue. */
export function dateDepuisInstant(ms: number, role: Role, maintenant: number, precision: 'seconde' | 'milliseconde' = 'seconde'): DateLue | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const x = new Date(ms);
  if (Number.isNaN(x.getTime())) return undefined;
  return dateDepuisParties({ a: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, j: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes(), s: x.getUTCSeconds(), ms: precision === 'milliseconde' ? x.getUTCMilliseconds() : undefined, fuseauMin: 0 }, role, maintenant, 'UTC par définition');
}

/** Secondes depuis le 1er janvier 1904 (MP4, QuickTime, AIFF). 0 → absente. */
export function dateDepuis1904(sec: number, role: Role, maintenant: number): DateLue | undefined {
  if (!Number.isFinite(sec) || sec <= 0) return undefined;
  return dateDepuisInstant((sec - 2_082_844_800) * 1000, role, maintenant);
}

/** Nanosecondes depuis le 1er janvier 2001 (Matroska DateUTC). */
export function dateDepuis2001(ns: bigint, role: Role, maintenant: number): DateLue | undefined {
  const ms = Number(ns / 1_000_000n) + 978_307_200_000;
  return dateDepuisInstant(ms, role, maintenant);
}

/** IPTC : date « CCYYMMDD » et heure « HHMMSS±HHMM ». */
export function lireDateIptc(date: string, heure: string | undefined, role: Role, maintenant: number): DateLue | undefined {
  const a = chiffres(date, 0, 4), mo = chiffres(date, 4, 2), j = chiffres(date, 6, 2);
  if (a === undefined || mo === undefined || j === undefined || !a || !mo || !j) return undefined;
  const p: Parties = { a, mo, j };
  if (heure) {
    const h = chiffres(heure, 0, 2), mi = chiffres(heure, 2, 2), s = chiffres(heure, 4, 2);
    if (h !== undefined && mi !== undefined) {
      p.h = h; p.mi = mi; if (s !== undefined) p.s = s;
      const f = lireFuseau(heure, s !== undefined ? 6 : 4);
      if (f) p.fuseauMin = f.min;
    }
  }
  return dateDepuisParties(p, role, maintenant);
}

/** AVI IDIT : « Mon Jul 14 18:22:05 2024 » ou « 2024:07:14 18:22:05 ». undefined si illisible. */
export function lireDateAvi(s: string, role: Role, maintenant: number): DateLue | undefined {
  const t = s.trim().slice(0, 64);
  const iso = lireDateIso(t, role, maintenant);
  if (iso) return iso;
  const mots: string[] = [];
  let cur = '';
  for (const c of t) { if (c === ' ' || c === '\t') { if (cur) { mots.push(cur); cur = ''; } } else cur += c; }
  if (cur) mots.push(cur);
  if (mots.length < 5) return undefined;
  const mo = MOIS_EN.indexOf(mots[1].slice(0, 3).toLowerCase()) + 1;
  const j = Number(mots[2]), a = Number(mots[4]);
  const h = chiffres(mots[3], 0, 2), mi = chiffres(mots[3], 3, 2), sec = chiffres(mots[3], 6, 2);
  if (!mo || !Number.isInteger(j) || !Number.isInteger(a) || h === undefined || mi === undefined) return undefined;
  return dateDepuisParties({ a, mo, j, h, mi, s: sec }, role, maintenant);
}

/** Pour l'affichage masqué : le jour seulement. */
export function jourSeulement(d: DateLue): string {
  const p = partiesDe(d);
  if (p.j !== undefined && p.mo !== undefined) return `${d2(p.j)}/${d2(p.mo)}/${p.a}`;
  return d.texte;
}
