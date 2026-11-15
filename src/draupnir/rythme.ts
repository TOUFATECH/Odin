// Le rythme d'une automatisation, en clair : « Tous les jours à 7 h 30 », « Chaque mois, le 1er à 3 h »…
// Fonctions pures : lire et vérifier un rythme, l'écrire en une phrase, le traduire en cron (et retour), trouver
// la prochaine exécution À L'HEURE DU LIEU D'ODIN (fuseau du lieu, sinon celui de la machine), changement d'heure compris :
// une heure qui n'existe pas (2 h 30 au printemps) part à la première minute qui existe (3 h 00) ; une heure qui existe
// deux fois (automne) ne part qu'une fois, à la première.
// Rien ici ne lit l'heure locale du serveur : la conversion passe toujours par Intl.DateTimeFormat({ timeZone }).

import { parseCron } from '../cron/cron.ts';
import { lieuCourant } from '../valhalla/lieu.ts';

export type Rythme =
  | { genre: 'minutes'; n: number }
  | { genre: 'heures'; n: number; minute?: number }
  | { genre: 'jour'; heure: string }
  | { genre: 'semaine'; jours: number[]; heure: string }
  | { genre: 'mois'; jour: number; heure: string }
  | { genre: 'une_fois'; date: string; heure: string }
  | { genre: 'cron'; cron: string }
  | { genre: 'secondes'; n: number }
  | { genre: 'libre'; texte: string };
export type GenreRythme = Rythme['genre'];
export const GENRES: GenreRythme[] = ['minutes', 'heures', 'jour', 'semaine', 'mois', 'une_fois', 'cron', 'secondes', 'libre'];

/** Le plan de vérification des ISO et des logiciels (forge/bibliotheque.ts). */
export interface PlanVerifLike { frequence: 'jour' | 'semaine' | 'mois'; jour: number; heure: string; derniere?: number }

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const ALIAS: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };

// ---------------------------------------------------------------- Lire et vérifier

const entier = (v: unknown): number | undefined => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isInteger(n) ? n : undefined; };
/** « 7:30 », « 07:30 », « 7h30 », « 7 h », « 15h » → « 07:30 » ; sinon undefined. */
export function lireHeure(v: unknown): string | undefined {
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*$/i.exec(String(v ?? ''));
  if (!m) return undefined;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
const dateValide = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };

/** Vérifie un rythme et le remet en forme ; sinon la raison, en une phrase. Un texte seul est lu comme un planning cron. */
export function verifierRythme(x: unknown): { ok: true; rythme: Rythme } | { ok: false; error: string } {
  if (typeof x === 'string') x = { genre: 'cron', cron: x };
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, error: 'Rythme manquant.' };
  const o = x as Record<string, unknown>, g = String(o.genre ?? '');
  const ko = (error: string) => ({ ok: false as const, error });
  const heure = () => lireHeure(o.heure);
  switch (g) {
    case 'minutes': { const n = entier(o.n); return n !== undefined && n >= 1 && n <= 1440 ? { ok: true, rythme: { genre: 'minutes', n } } : ko('Le nombre de minutes va de 1 à 1440.'); }
    case 'heures': {
      const n = entier(o.n), mi = o.minute === undefined || o.minute === '' ? 0 : entier(o.minute);
      if (n === undefined || n < 1 || n > 24) return ko('Le nombre d\'heures va de 1 à 24.');
      if (mi === undefined || mi < 0 || mi > 59) return ko('La minute va de 0 à 59.');
      return { ok: true, rythme: { genre: 'heures', n, minute: mi } };
    }
    case 'jour': { const h = heure(); return h ? { ok: true, rythme: { genre: 'jour', heure: h } } : ko('Heure invalide (ex. 07:30).'); }
    case 'semaine': {
      const h = heure(); if (!h) return ko('Heure invalide (ex. 07:30).');
      const l = Array.isArray(o.jours) ? o.jours.map(entier) : [];
      if (!l.length || l.some((j) => j === undefined || j < 0 || j > 7)) return ko('Choisis au moins un jour de la semaine.');
      const jours = [...new Set(l.map((j) => (j === 7 ? 0 : j!)))].sort((a, b) => a - b);
      return { ok: true, rythme: { genre: 'semaine', jours, heure: h } };
    }
    case 'mois': {
      const h = heure(); if (!h) return ko('Heure invalide (ex. 07:30).');
      const j = entier(o.jour); if (j === undefined || j < 1 || j > 31) return ko('Le jour du mois va de 1 à 31.');
      return { ok: true, rythme: { genre: 'mois', jour: j, heure: h } };
    }
    case 'une_fois': {
      const h = heure(); if (!h) return ko('Heure invalide (ex. 15:00).');
      const d = String(o.date ?? '').trim(); if (!dateValide(d)) return ko('Date invalide (AAAA-MM-JJ).');
      return { ok: true, rythme: { genre: 'une_fois', date: d, heure: h } };
    }
    case 'cron': {
      const c = String(o.cron ?? '').trim().replace(/\s+/g, ' ');
      try { parseCron(c); } catch (e) { return ko(`Planning invalide : ${(e as Error).message}`); }
      return { ok: true, rythme: { genre: 'cron', cron: c } };
    }
    case 'secondes': { const n = entier(o.n); return n !== undefined && n >= 1 ? { ok: true, rythme: { genre: 'secondes', n } } : ko('Nombre de secondes invalide.'); }
    case 'libre': { const t = String(o.texte ?? '').trim().slice(0, 200); return t ? { ok: true, rythme: { genre: 'libre', texte: t } } : ko('Texte du rythme manquant.'); }
    default: return ko('Genre de rythme inconnu.');
  }
}
/** Le rythme vérifié et remis en forme, ou undefined. */
export function lireRythme(x: unknown): Rythme | undefined { const r = verifierRythme(x); return r.ok ? r.rythme : undefined; }

// ---------------------------------------------------------------- La phrase

/** « 7 h 30 », « 15 h », « minuit », « midi ». */
export function heureTexte(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 0 && m === 0) return 'minuit';
  if (h === 12 && m === 0) return 'midi';
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
const a = (hhmm: string) => `à ${heureTexte(hhmm)}`;
const liste = (l: string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} et ${l.at(-1)}`);
const ordreSemaine = (j: number) => (j === 0 ? 7 : j);
/** Une durée en clair : « 5 minutes », « 2 heures », « jour », « semaine ». */
function intervalle(sec: number): string {
  if (sec % (7 * 86400) === 0) { const n = sec / (7 * 86400); return n === 1 ? 'Chaque semaine' : `Toutes les ${n} semaines`; }
  if (sec % 86400 === 0) { const n = sec / 86400; return n === 1 ? 'Tous les jours' : `Tous les ${n} jours`; }
  if (sec % 3600 === 0) { const n = sec / 3600; return n === 1 ? 'Toutes les heures' : `Toutes les ${n} heures`; }
  const n = Math.round(sec / 60); return n === 1 ? 'Chaque minute' : `Toutes les ${n} minutes`;
}
const dateLongue = (date: string) => { const [y, m, d] = date.split('-').map(Number); const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${JOURS[wd]} ${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`; };

/** Le rythme en une phrase : « Chaque mois, le 1er à 3 h ». */
export function phrase(r: Rythme): string {
  switch (r.genre) {
    case 'minutes': return r.n === 1 ? 'Chaque minute' : `Toutes les ${r.n} minutes`;
    case 'heures': { const mi = r.minute ?? 0; return `${r.n === 1 ? 'Toutes les heures' : `Toutes les ${r.n} heures`}${mi ? `, à la minute ${mi}` : ''}`; }
    case 'jour': return `Tous les jours ${a(r.heure)}`;
    case 'semaine': {
      const j = [...r.jours].sort((x, y) => ordreSemaine(x) - ordreSemaine(y));
      if (j.length === 7) return `Tous les jours ${a(r.heure)}`;
      if (j.join(',') === '1,2,3,4,5') return `Du lundi au vendredi ${a(r.heure)}`;
      return `Chaque semaine, ${liste(j.map((x) => `le ${JOURS[x]}`))} ${a(r.heure)}`;
    }
    case 'mois': return `Chaque mois, le ${r.jour === 1 ? '1er' : r.jour}${r.jour >= 29 ? ' (ou le dernier jour)' : ''} ${a(r.heure)}`;
    case 'une_fois': return `Une seule fois, le ${dateLongue(r.date)} ${a(r.heure)}`;
    case 'cron': { const s = depuisCron(r.cron); return s.genre === 'cron' ? `Planning expert : ${r.cron}` : phrase(s); }
    case 'secondes': {
      if (r.n < 60) return `En continu, toutes les ${r.n} secondes`;
      if (r.n === 60) return 'En continu, chaque minute';
      if (r.n < 300) return r.n % 60 === 0 ? `En continu, toutes les ${r.n / 60} minutes` : `En continu, toutes les ${r.n} secondes`;
      return intervalle(r.n);
    }
    case 'libre': return r.texte.charAt(0).toUpperCase() + r.texte.slice(1);
  }
}

// ---------------------------------------------------------------- Cron, aller et retour

/** Le planning cron équivalent (5 champs), s'il existe. */
export function versCron(r: Rythme): string | undefined {
  const hm = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${m} ${h}`; };
  switch (r.genre) {
    case 'minutes':
      if (r.n === 1) return '* * * * *';
      if (r.n < 60 && 60 % r.n === 0) return `*/${r.n} * * * *`;
      if (r.n === 1440) return '0 0 * * *';
      if (r.n % 60 === 0 && 24 % (r.n / 60) === 0) return r.n === 60 ? '0 * * * *' : `0 */${r.n / 60} * * *`;
      return undefined;
    case 'heures': { const mi = r.minute ?? 0; return r.n === 1 ? `${mi} * * * *` : r.n === 24 ? `${mi} 0 * * *` : `${mi} */${r.n} * * *`; }
    case 'jour': return `${hm(r.heure)} * * *`;
    case 'semaine': return r.jours.length === 7 ? `${hm(r.heure)} * * *` : `${hm(r.heure)} * * ${[...r.jours].sort((x, y) => x - y).join(',')}`;
    case 'mois': return r.jour <= 28 ? `${hm(r.heure)} ${r.jour} * *` : undefined;
    case 'cron': return r.cron;
    default: return undefined;
  }
}

/** Joursde semaine d'un champ cron (« 1-5 », « 1,3 », « 7 ») ; undefined si autre chose. */
function joursCron(f: string): number[] | undefined {
  if (!/^[\d,-]+$/.test(f)) return undefined;
  const out = new Set<number>();
  for (const p of f.split(',')) {
    const [x, y] = p.split('-').map(Number);
    const fin = y ?? x;
    if (!Number.isInteger(x) || !Number.isInteger(fin) || x < 0 || fin > 7 || x > fin) return undefined;
    for (let j = x; j <= fin; j++) out.add(j === 7 ? 0 : j);
  }
  return [...out].sort((a2, b) => a2 - b);
}
/** La forme simple d'un planning cron quand elle existe (« 30 7 * * 1-5 » → du lundi au vendredi), sinon { genre: 'cron' }. */
export function depuisCron(expr: string): Rythme {
  const e = (ALIAS[expr.trim()] ?? expr.trim()).replace(/\s+/g, ' ');
  const brut: Rythme = { genre: 'cron', cron: expr.trim().replace(/\s+/g, ' ') };
  const p = e.split(' ');
  if (p.length !== 5) return brut;
  try { parseCron(e); } catch { return brut; }
  const [mi, h, dom, mon, dow] = p;
  const num = (s: string, max: number) => (/^\d{1,2}$/.test(s) && Number(s) <= max ? Number(s) : undefined);
  const hh = (H: number, M: number) => `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
  if (mon !== '*') return brut;
  if (h === '*' && dom === '*' && dow === '*') {
    if (mi === '*') return { genre: 'minutes', n: 1 };
    const pas = /^\*\/(\d{1,2})$/.exec(mi); if (pas && Number(pas[1]) >= 1 && Number(pas[1]) < 60) return { genre: 'minutes', n: Number(pas[1]) };
    const M = num(mi, 59); if (M !== undefined) return { genre: 'heures', n: 1, minute: M };
    return brut;
  }
  const M = num(mi, 59); if (M === undefined) return brut;
  const pasH = /^\*\/(\d{1,2})$/.exec(h);
  if (pasH && dom === '*' && dow === '*') { const n = Number(pasH[1]); return n >= 1 && n <= 23 ? { genre: 'heures', n, minute: M } : brut; }
  const H = num(h, 23); if (H === undefined) return brut;
  if (dom === '*' && dow === '*') return { genre: 'jour', heure: hh(H, M) };
  if (dom === '*') { const j = joursCron(dow); if (!j) return brut; return j.length === 7 ? { genre: 'jour', heure: hh(H, M) } : { genre: 'semaine', jours: j, heure: hh(H, M) }; }
  if (dow === '*') { const D = num(dom, 31); if (D !== undefined && D >= 1) return { genre: 'mois', jour: D, heure: hh(H, M) }; }
  return brut;
}

// ---------------------------------------------------------------- Heure du lieu ↔ instant

/** Le fuseau du lieu d'Odin, sinon celui de la machine. */
export function fuseauOdin(fuseau?: string): string {
  const f = fuseau || lieuCourant()?.fuseau;
  if (f) { try { new Intl.DateTimeFormat('en-US', { timeZone: f }); return f; } catch { /* fuseau inconnu : celui de la machine */ } }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); formats.set(tz, f); }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** L'heure murale d'un instant dans un fuseau. */
export function murale(t: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number } {
  const o: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(t))) o[p.type] = p.value;
  return { y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute), s: Number(o.second), wd: WD[o.weekday] ?? 0 };
}
const decalage = (t: number, tz: string) => { const m = murale(t, tz); return Date.UTC(m.y, m.mo - 1, m.d, m.h, m.mi, m.s) - Math.floor(t / 1000) * 1000; };
/**
 * L'instant d'une heure murale (y, mois 1-12, jour, h, mi) dans le fuseau. Heure inexistante : la première minute qui
 * existe après ; heure double : la première des deux.
 */
export function instant(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  for (let k = 0; k <= 180; k++) {
    const base = Date.UTC(y, mo - 1, d, h, mi + k);
    const w = new Date(base);
    const vus = [...new Set([decalage(base - 6 * 3600_000, tz), decalage(base + 6 * 3600_000, tz), decalage(base, tz)])]
      .map((off) => base - off)
      .filter((t) => { const m = murale(t, tz); return m.y === w.getUTCFullYear() && m.mo === w.getUTCMonth() + 1 && m.d === w.getUTCDate() && m.h === w.getUTCHours() && m.mi === w.getUTCMinutes(); });
    if (vus.length) return new Date(Math.min(...vus));
  }
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

// ---------------------------------------------------------------- La prochaine exécution

const jourSuivant = (y: number, mo: number, d: number, k: number) => { const x = new Date(Date.UTC(y, mo - 1, d + k)); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() }; };
const dernierJour = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
/**
 * Parcourt les jours (heure du lieu) à partir de celui de `apres`, et rend le premier instant strictement après `apres`
 * parmi les heures murales que `heures(jour)` propose (dans l'ordre).
 */
function chercher(apres: Date, tz: string, jours: number, heures: (j: { y: number; mo: number; d: number; wd: number }) => Array<[number, number]>): Date | undefined {
  const m0 = murale(apres.getTime(), tz);
  for (let k = 0; k <= jours; k++) {
    const j = jourSuivant(m0.y, m0.mo, m0.d, k);
    for (const [h, mi] of heures(j)) {
      // Le jour même, inutile de convertir les heures déjà loin derrière (marge de 3 h pour les changements d'heure).
      if (k === 0 && h * 60 + mi < m0.h * 60 + m0.mi - 180) continue;
      // Heure inexistante (printemps) : instant() rend la première minute qui existe ; heure double (automne) : la
      // première des deux, et si elle est passée, la seconde n'est pas rejouée.
      const t = instant(j.y, j.mo, j.d, h, mi, tz);
      if (t.getTime() > apres.getTime()) return t;
    }
  }
  return undefined;
}
const hm = (hhmm: string): [number, number] => { const [h, m] = hhmm.split(':').map(Number); return [h, m]; };

/** La prochaine exécution strictement après `apres` (heure du lieu). undefined : une seule fois déjà passée, veille, rythme libre. */
export function prochaine(r: Rythme, apres: Date, fuseau?: string): Date | undefined {
  const tz = fuseauOdin(fuseau);
  switch (r.genre) {
    case 'minutes': {
      const pas: Array<[number, number]> = []; for (let x = 0; x < 1440; x += r.n) pas.push([Math.floor(x / 60), x % 60]);
      return chercher(apres, tz, 2, () => pas);
    }
    case 'heures': { const l: Array<[number, number]> = []; for (let h = 0; h < 24; h += r.n) l.push([h, r.minute ?? 0]); return chercher(apres, tz, 2, () => l); }
    case 'jour': return chercher(apres, tz, 3, () => [hm(r.heure)]);
    case 'semaine': return chercher(apres, tz, 8, (j) => (r.jours.includes(j.wd) ? [hm(r.heure)] : []));
    case 'mois': return chercher(apres, tz, 63, (j) => (j.d === Math.min(r.jour, dernierJour(j.y, j.mo)) ? [hm(r.heure)] : []));
    case 'une_fois': { const [y, mo, d] = r.date.split('-').map(Number), [h, mi] = hm(r.heure); const t = instant(y, mo, d, h, mi, tz); return t.getTime() > apres.getTime() ? t : undefined; }
    case 'cron': return prochaineCron(r.cron, apres, tz);
    default: return undefined;
  }
}
/** Les `n` prochaines exécutions. */
export function prochaines(r: Rythme, apres: Date, n: number, fuseau?: string): Date[] {
  const out: Date[] = []; let t = apres;
  for (let k = 0; k < n; k++) { const x = prochaine(r, t, fuseau); if (!x) break; out.push(x); t = x; }
  return out;
}
/** La prochaine exécution d'un planning cron, compté à l'heure du lieu (5 ans au plus). */
export function prochaineCron(expr: string, apres: Date, fuseau?: string): Date | undefined {
  const tz = fuseauOdin(fuseau);
  let spec; try { spec = parseCron(ALIAS[expr.trim()] ?? expr); } catch { return undefined; }
  const { fields: [mi, h, dom, mon, dow], domStar, dowStar } = spec;
  const hs = [...h].sort((x, y) => x - y), ms = [...mi].sort((x, y) => x - y);
  const toutes: Array<[number, number]> = []; for (const H of hs) for (const M of ms) toutes.push([H, M]);
  return chercher(apres, tz, 366 * 5, (j) => {
    if (!mon.has(j.mo)) return [];
    const ok = domStar && dowStar ? true : domStar ? dow.has(j.wd) : dowStar ? dom.has(j.d) : dom.has(j.d) || dow.has(j.wd);
    return ok ? toutes : [];
  });
}

// ---------------------------------------------------------------- Dates en clair

/** « aujourd'hui à 7 h 30 », « demain à 7 h 30 », « lundi 24 novembre à 4 h » (l'année si ce n'est pas la même). */
export function texteDate(d: Date, fuseau?: string, maintenant: Date = new Date()): string {
  const tz = fuseauOdin(fuseau);
  const w = murale(d.getTime(), tz), n = murale(maintenant.getTime(), tz);
  const heure = `à ${heureTexte(`${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`)}`;
  const ecart = Math.round((Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86_400_000);
  if (ecart === 0) return `aujourd'hui ${heure}`;
  if (ecart === 1) return `demain ${heure}`;
  if (ecart === -1) return `hier ${heure}`;
  return `${JOURS[w.wd]} ${w.d === 1 ? '1er' : w.d} ${MOIS[w.mo - 1]}${w.y !== n.y ? ` ${w.y}` : ''} ${heure}`;
}
/** La date murale du lieu (« AAAA-MM-JJ ») et l'heure (« HH:MM ») d'un instant. */
export function dateMurale(d: Date, fuseau?: string): { date: string; heure: string } {
  const w = murale(d.getTime(), fuseauOdin(fuseau)), p = (x: number) => String(x).padStart(2, '0');
  return { date: `${w.y}-${p(w.mo)}-${p(w.d)}`, heure: `${p(w.h)}:${p(w.mi)}` };
}

// ---------------------------------------------------------------- Plan de vérification des ISO et des logiciels

export function depuisPlanVerif(p: PlanVerifLike): Rythme {
  const heure = lireHeure(p.heure) ?? '04:00';
  if (p.frequence === 'jour') return { genre: 'jour', heure };
  if (p.frequence === 'semaine') return { genre: 'semaine', jours: [Math.max(0, Math.min(6, Math.trunc(p.jour) || 0))], heure };
  return { genre: 'mois', jour: Math.max(1, Math.min(28, Math.trunc(p.jour) || 1)), heure };
}
/** Le plan d'un rythme (jour ; semaine avec un seul jour ; mois du 1 au 28), sinon undefined. */
export function versPlanVerif(r: Rythme): PlanVerifLike | undefined {
  if (r.genre === 'jour') return { frequence: 'jour', jour: 1, heure: r.heure };
  if (r.genre === 'semaine' && r.jours.length === 1) return { frequence: 'semaine', jour: r.jours[0], heure: r.heure };
  if (r.genre === 'mois' && r.jour >= 1 && r.jour <= 28) return { frequence: 'mois', jour: r.jour, heure: r.heure };
  return undefined;
}
