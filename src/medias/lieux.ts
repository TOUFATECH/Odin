// Médias reçus : la position (donnée sensible : elle reste sur la machine). Rationnels GPS de l'EXIF, chaînes ISO 6709
// (vidéos des téléphones), chaînes XMP « DD,MM.mmmK ». Rend aussi l'URI geo: (RFC 5870), un point GeoJSON (RFC 7946)
// pour la carte d'Odin et un texte en clair. Analyse caractère par caractère ; une position impossible est rejetée.

import type { Fiabilite, Position } from './contrat.ts';

export interface PositionBrute {
  lat: number; lon: number; altitudeM?: number; altitudeRef?: 'mer' | 'ellipsoïde';
  directionDeg?: number; directionRef?: 'vrai' | 'magnétique'; precisionM?: number; quandUtc?: string;
  source: string; fiabilite?: Fiabilite;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const virgule = (x: number, n: number) => x.toFixed(n).replace('.', ',').replace('-', '−');

function dms(x: number, pos: string, neg: string): string {
  const a = Math.abs(x);
  let d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 600) / 10;
  if (s >= 60) { s = 0; m++; }
  if (m >= 60) { m = 0; d++; }
  return `${d}° ${m}′ ${s.toFixed(1).replace('.', ',')}″ ${x < 0 ? neg : pos}`;
}

/** Construit une position, ou rend la raison du rejet. */
export function creerPosition(b: PositionBrute): Position | string {
  const { lat, lon } = b;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'coordonnées illisibles';
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'coordonnées hors du globe';
  if (lat === 0 && lon === 0) return 'position absente (0 ; 0)';
  const p: Position = {
    lat: r6(lat), lon: r6(lon), source: b.source, fiabilite: b.fiabilite ?? 'probable', geo: '',
    geojson: { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { source: b.source, fiabilite: b.fiabilite ?? 'probable' } }, enClair: '',
  };
  if (b.altitudeM !== undefined && Number.isFinite(b.altitudeM) && Math.abs(b.altitudeM) < 100_000) { p.altitudeM = Math.round(b.altitudeM * 10) / 10; p.altitudeRef = b.altitudeRef ?? 'mer'; }
  if (b.directionDeg !== undefined && Number.isFinite(b.directionDeg) && b.directionDeg >= 0 && b.directionDeg <= 360) { p.directionDeg = Math.round(b.directionDeg * 10) / 10; p.directionRef = b.directionRef; }
  if (b.precisionM !== undefined && Number.isFinite(b.precisionM) && b.precisionM >= 0) p.precisionM = Math.round(b.precisionM * 10) / 10;
  if (b.quandUtc) { p.quandUtc = b.quandUtc; p.geojson.properties.quandUtc = b.quandUtc; }
  p.geo = `geo:${p.lat.toFixed(6)},${p.lon.toFixed(6)}${p.altitudeM !== undefined ? `,${p.altitudeM}` : ''}${p.precisionM !== undefined ? `;u=${p.precisionM}` : ''}`;
  p.geojson.geometry.coordinates = p.altitudeM !== undefined ? [p.lon, p.lat, p.altitudeM] : [p.lon, p.lat];
  p.enClair = `${dms(p.lat, 'N', 'S')}, ${dms(p.lon, 'E', 'O')} (${virgule(p.lat, 6)} ; ${virgule(p.lon, 6)})`
    + (p.altitudeM !== undefined ? `, altitude ${String(p.altitudeM).replace('.', ',').replace('-', '−')} m` : '')
    + (p.directionDeg !== undefined ? `, direction ${String(p.directionDeg).replace('.', ',')}°` : '')
    + (p.precisionM !== undefined ? `, à ${String(p.precisionM).replace('.', ',')} m près` : '');
  return p;
}

/** Degrés, minutes, secondes (rationnels déjà divisés) → degrés décimaux ; undefined si impossible. */
export function degresDepuisDms(d: number, m: number, s: number, ref: string): number | undefined {
  if (![d, m, s].every(Number.isFinite) || d < 0 || m < 0 || s < 0) return undefined;
  if (m >= 60 || s >= 60) return undefined;
  const v = d + m / 60 + s / 3600;
  const r = ref.trim().toUpperCase();
  return r === 'S' || r === 'W' || r === 'O' ? -v : v;
}

/** Nombre décimal signé à partir de i (« +048.8584 ») ; sans exposant. */
function nombre(s: string, i: number): { v: number; fin: number; entiers: number } | undefined {
  let j = i;
  if (s[j] !== '+' && s[j] !== '-') return undefined;
  j++;
  let entiers = 0, txt = s[i];
  while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) { txt += s[j++]; entiers++; }
  if (!entiers) return undefined;
  if (s[j] === '.') {
    txt += '.'; j++;
    let dec = 0;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) { txt += s[j++]; dec++; }
    if (!dec) return undefined;
  }
  return { v: Number(txt), fin: j, entiers };
}

/** Partie ISO 6709 : ±DD.D, ±DDMM.M, ±DDMMSS.S (lat : 2 chiffres de degrés ; lon : 3). */
function partie6709(n: { v: number; entiers: number }, degres: number): number | undefined {
  const a = Math.abs(n.v), sg = n.v < 0 ? -1 : 1;
  if (n.entiers === degres) return n.v;
  if (n.entiers === degres + 2) { const d = Math.floor(a / 100), m = a - d * 100; return m >= 60 ? undefined : sg * (d + m / 60); }
  if (n.entiers === degres + 4) { const d = Math.floor(a / 10000), m = Math.floor((a - d * 10000) / 100), s = a - d * 10000 - m * 100; return m >= 60 || s >= 60 ? undefined : sg * (d + m / 60 + s / 3600); }
  return undefined;
}

/** ISO 6709 : « +48.8584+002.2945+035.0/ », « -12.7806+045.2275/ », « +48.8584+002.2945+35.0CRSWGS_84/ ». */
export function lireIso6709(entree: string, source: string, fiabilite: Fiabilite = 'probable'): Position | string {
  const s = entree.trim().slice(0, 128);
  const la = nombre(s, 0); if (!la) return 'ISO 6709 illisible';
  const lo = nombre(s, la.fin); if (!lo) return 'ISO 6709 illisible';
  let i = lo.fin, alt: number | undefined;
  const al = nombre(s, i);
  if (al) { alt = al.v; i = al.fin; }
  if (s.startsWith('CRS', i)) { const k = s.indexOf('/', i); if (k < 0) return 'ISO 6709 tronqué'; i = k; }
  if (s[i] !== '/') return 'ISO 6709 tronqué';
  const lat = partie6709(la, 2), lon = partie6709(lo, 3);
  if (lat === undefined || lon === undefined) return 'ISO 6709 illisible';
  return creerPosition({ lat, lon, altitudeM: alt, altitudeRef: alt !== undefined ? 'ellipsoïde' : undefined, source, fiabilite });
}

/** XMP exif:GPSLatitude « 12,46.836S » ou « 12,46,50.16S » → degrés décimaux. */
export function lireGpsXmp(entree: string): number | undefined {
  const s = entree.trim().slice(0, 64);
  if (s.length < 3) return undefined;
  const ref = s[s.length - 1].toUpperCase();
  if (!'NSEW'.includes(ref)) return undefined;
  const corps = s.slice(0, -1).split(',');
  if (corps.length < 2 || corps.length > 3) return undefined;
  const nums = corps.map((x) => { const t = x.trim(); for (const c of t) if (!((c >= '0' && c <= '9') || c === '.')) return NaN; return t ? Number(t) : NaN; });
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return degresDepuisDms(nums[0], nums[1], nums[2] ?? 0, ref);
}

/** Distance entre deux positions (km). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
