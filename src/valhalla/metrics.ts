// Les mesures d'Odin gardées dans le temps (façon Prometheus / Zabbix / Glances) : chaque appli range ses
// chiffres (processeur, mémoire, temps de réponse, débit…) sous un nom de série ; Hygie, Pulsar et les tableaux
// de bord de Zénith les relisent sur 1 h, 24 h, 7 j, 30 j, 1 an.
//   - une ligne par minute et par jour : mesures/AAAA-MM-JJ.jsonl (gardées 31 jours) ;
//   - une moyenne par heure, gardée pour toujours : mesures/heures-AAAA-MM.jsonl (petit).
//   Le ménage (une fois par jour, et peu après le démarrage) efface les minutes de plus de 31 jours, jamais avant
//   que toutes leurs heures soient dans le fichier des heures.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type Point = [number, number]; // [instant en ms, valeur]
export interface Agg { t: number; avg: number; min: number; max: number; last: number; n: number }
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const month = (t: number) => day(t).slice(0, 7);
/** Un nom de série acceptable : « eir.cpu », « vordr.temps.nas », « gjoll.debit.telephone ». */
export const okName = (s: string) => /^[a-z0-9][\w.:-]{0,120}$/i.test(s);
/**
 * Les séries réservées au propriétaire : ce que mesurent ses prises et ses capteurs (« appareils. ») dit quand la
 * maison est occupée. Aucune lecture ne les rend — ni leur nom, ni un point, ni une courbe, ni l'export — sans le
 * demander expressément (`{ prive: true }`), ce que seul un code réservé au propriétaire fait.
 */
const PREFIXES_PRIVES: readonly string[] = ['appareils.'];
export const seriePrivee = (name: string): boolean => { const n = String(name).toLowerCase(); return PREFIXES_PRIVES.some((p) => n.startsWith(p)); };
/** Ce qu'une lecture demande : `prive` pour lire aussi les séries réservées au propriétaire. */
export interface Lecture { prive?: boolean }
/**
 * Ce qu'un ménage a fait, en nombres (jamais un nom de série) : jours de minutes effacés, jours gardés faute d'avoir
 * pu ranger ou relire leurs heures (nouvel essai le lendemain), lignes d'heures ajoutées, lignes de minutes
 * illisibles laissées de côté ; `horloge` : la date de la machine paraît fausse, rien n'a été effacé.
 */
export interface BilanMenage { a: number; effaces: number; gardes: number; heures: number; illisibles: number; horloge?: 'reculee' | 'sautee' }
const FICHIER_MINUTES = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
/** Un vrai fichier (ni lien, ni dossier). */
const estFichier = (p: string): boolean => { try { return lstatSync(p).isFile(); } catch { return false; } };
type Minute = { t: number; v: Record<string, number> };
/** Les lignes lisibles d'un fichier de minutes, et le nombre de lignes illisibles (une ligne coupée en est une). */
function lireMinutes(f: string): { lignes: Minute[]; illisibles: number } {
  const lignes: Minute[] = []; let illisibles = 0;
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const x = JSON.parse(l) as { t?: unknown; v?: unknown };
      if (typeof x.t !== 'number' || !Number.isFinite(x.t) || !x.v || typeof x.v !== 'object' || Array.isArray(x.v)) { illisibles++; continue; }
      const v: Record<string, number> = {};
      for (const [k, n] of Object.entries(x.v as Record<string, unknown>)) if (okName(k) && typeof n === 'number' && Number.isFinite(n)) v[k] = n;
      lignes.push({ t: x.t, v });
    } catch { illisibles++; }
  }
  return { lignes, illisibles };
}
/** Les heures déjà rangées (« instant|série ») des mois donnés, et si chaque fichier finit bien par un saut de ligne. */
function lireHeures(dir: string, moisListe: Iterable<string>): { deja: Set<string>; finNette: Map<string, boolean> } {
  const deja = new Set<string>(), finNette = new Map<string, boolean>();
  for (const mo of moisListe) {
    const f = join(dir, `heures-${mo}.jsonl`); if (!existsSync(f)) continue;
    const texte = readFileSync(f, 'utf8'); finNette.set(mo, !texte || texte.endsWith('\n'));
    for (const l of texte.split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: unknown; v: Record<string, unknown> }; if (typeof x.t === 'number' && x.v && typeof x.v === 'object') for (const [k, v] of Object.entries(x.v)) if (Array.isArray(v)) deja.add(`${x.t}|${k}`); } catch { /* ligne coupée */ } }
  }
  return { deja, finNette };
}
type PlanMenage = { jours: string[]; limite: string; horloge?: 'reculee' | 'sautee' };

export class Metrics {
  readonly dir: string;
  private pending = new Map<string, number[]>(); private minute = 0;
  private hour = new Map<string, number[]>(); private hourAt = 0;
  private recent = new Map<string, Point[]>(); // les 2 dernières heures en mémoire (lecture rapide)
  private now: () => number;
  /** Le dernier ménage fait (des nombres seulement). */
  dernierMenage?: BilanMenage;
  private jourMenage = ''; private menageEnCours = false;
  constructor(dir: string, now: () => number = Date.now) { this.dir = dir; this.now = now; mkdirSync(dir, { recursive: true }); }

  /** Range des valeurs maintenant (plusieurs séries d'un coup). Les valeurs d'une même minute sont moyennées. */
  put(values: Record<string, number | undefined>, t = this.now()): void {
    const m = Math.floor(t / 60_000) * 60_000;
    if (this.minute && m !== this.minute) this.flush();
    this.minute = m;
    for (const [k, v] of Object.entries(values)) { if (v === undefined || !Number.isFinite(v) || !okName(k)) continue; const l = this.pending.get(k) ?? []; l.push(v); this.pending.set(k, l); }
  }
  /** Écrit la minute en cours (appelé tout seul au changement de minute). */
  flush(): void {
    if (!this.minute || !this.pending.size) return;
    const line: Record<string, number> = {};
    for (const [k, l] of this.pending) { const v = l.reduce((a, b) => a + b, 0) / l.length; line[k] = Math.round(v * 1000) / 1000; const r = this.recent.get(k) ?? []; r.push([this.minute, line[k]]); while (r.length && r[0][0] < this.minute - 2 * 3600_000) r.shift(); this.recent.set(k, r); }
    try { appendFileSync(join(this.dir, `${day(this.minute)}.jsonl`), `${JSON.stringify({ t: this.minute, v: line })}\n`); } catch { /* disque plein */ }
    // Moyenne de l'heure.
    const h = Math.floor(this.minute / 3600_000) * 3600_000;
    if (this.hourAt && h !== this.hourAt) this.flushHour();
    this.hourAt = h; for (const [k, v] of Object.entries(line)) { const l = this.hour.get(k) ?? []; l.push(v); this.hour.set(k, l); }
    this.pending.clear();
    this.lancerMenage();
  }
  private flushHour(): void {
    if (!this.hourAt || !this.hour.size) return;
    const line: Record<string, [number, number, number]> = {};
    for (const [k, l] of this.hour) line[k] = [Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 1000) / 1000, Math.min(...l), Math.max(...l)];
    try { appendFileSync(join(this.dir, `heures-${month(this.hourAt)}.jsonl`), `${JSON.stringify({ t: this.hourAt, v: line })}\n`); } catch { /* */ }
    this.hour.clear();
  }
  /** Efface les minutes de plus de `days` jours (les heures restent) : le ménage, tout de suite ; rend le nombre de jours effacés. */
  prune(days = 31): number { return this.menage(days).effaces; }
  /**
   * Le ménage : chaque jour de minutes de plus de `days` jours est effacé, une fois toutes ses heures dans le fichier
   * des heures (une heure coupée par un arrêt d'Odin y est calculée depuis ses minutes, puis relue). Le jour de la
   * limite garde ses minutes, mais ses heures sont rangées aussi (une courbe longue ne perd aucune heure). Rien n'est
   * effacé si l'écriture ou la relecture des heures échoue, ni si la date de la machine paraît fausse. Jamais une erreur.
   */
  menage(days = 31): BilanMenage {
    const b: BilanMenage = { a: this.now(), effaces: 0, gardes: 0, heures: 0, illisibles: 0 };
    try {
      const p = this.planMenage(days); if (p.horloge) b.horloge = p.horloge;
      for (const j of p.jours) { try { this.menageJour(j, p.limite, b); } catch { if (j < p.limite) b.gardes++; } }
    } catch { /* dossier illisible : rien n'est effacé */ }
    return (this.dernierMenage = b);
  }
  /** Lancé par le rangement : une fois par jour (et au premier rangement après le démarrage), après lui, un jour de minutes par tour de boucle. */
  private lancerMenage(): void {
    const j = day(this.now()); if (j === this.jourMenage || this.menageEnCours) return;
    this.jourMenage = j; this.menageEnCours = true;
    const b: BilanMenage = { a: this.now(), effaces: 0, gardes: 0, heures: 0, illisibles: 0 };
    const fin = (ok: boolean) => {
      this.menageEnCours = false; if (!ok) return; this.dernierMenage = b;
      try {
        if (b.horloge) console.error('[mesures] ménage remis à demain : la date de la machine paraît fausse, rien n\'est effacé');
        else if (b.effaces || b.gardes || b.illisibles) console.error(`[mesures] ménage : ${b.effaces} jour(s) de relevés à la minute effacé(s), ${b.heures} moyenne(s) par heure rangée(s) avant${b.illisibles ? `, ${b.illisibles} ligne(s) illisible(s) laissée(s) de côté` : ''}${b.gardes ? `, ${b.gardes} jour(s) gardé(s) (heures non rangées, nouvel essai demain)` : ''}`);
      } catch { /* rien */ }
    };
    setImmediate(() => {
      let p: PlanMenage;
      try { p = this.planMenage(31); } catch { fin(false); return; }
      if (p.horloge) b.horloge = p.horloge;
      const pas = () => {
        const jour = p.jours.shift();
        if (jour !== undefined) { try { this.menageJour(jour, p.limite, b); } catch { if (jour < p.limite) b.gardes++; } }
        if (p.jours.length) setImmediate(pas); else fin(true);
      };
      setImmediate(pas);
    });
  }
  /** Les jours de minutes à voir (les plus vieux d'abord), sauf si la date de la machine paraît fausse. */
  private planMenage(days: number): PlanMenage {
    const now = this.now(), auj = day(now);
    // La limite : `days` jours en arrière sur le calendrier, ou `days` fois 24 h si c'est plus tôt. Un passage à
    // l'heure d'hiver ne fait pas partir le jour qui a `days` jours pile, et un passage à l'heure d'été ne fait pas
    // partir un jour dont les lectures relisent encore les minutes.
    const cal = new Date(now); cal.setDate(cal.getDate() - days);
    const parCal = day(cal.getTime()), par24h = day(now - days * 864e5), limite = parCal < par24h ? parCal : par24h;
    const jours = readdirSync(this.dir).filter((f) => FICHIER_MINUTES.test(f) && estFichier(join(this.dir, f))).map((f) => f.slice(0, 10)).sort();
    // Un fichier de minutes plus récent qu'aujourd'hui : l'horloge a reculé.
    if (jours.length && jours[jours.length - 1] > auj) return { jours: [], limite, horloge: 'reculee' };
    // Plus d'un an sans aucun rangement, puis des rangements depuis moins de `days` jours (ou aujourd'hui) : la date
    // a sauté, peut-être à tort. Rien n'est effacé tant que ce saut n'a pas `days` jours (une date fausse qui dure
    // quelques jours ne fait partir aucun vrai jour récent).
    const suite = jours[jours.length - 1] === auj ? jours : [...jours, auj];
    for (let i = 1; i < suite.length; i++) if (suite[i] >= limite && Date.parse(suite[i]) - Date.parse(suite[i - 1]) > 366 * 864e5) return { jours: [], limite, horloge: 'sautee' };
    return { jours: jours.filter((x) => x <= limite), limite };
  }
  /** Un jour de minutes : ses heures rangées s'il en manque, relues, puis le fichier effacé s'il est plus vieux que la limite. */
  private menageJour(jour: string, limite: string, b: BilanMenage): void {
    const f = join(this.dir, `${jour}.jsonl`); if (!estFichier(f)) return;
    // Une heure encore en mémoire, finie depuis longtemps (l'horloge a avancé sans rangement) : rangée d'abord, une seule fois.
    if (this.hourAt && this.hour.size && day(this.hourAt) <= limite) this.flushHour();
    const { lignes, illisibles } = lireMinutes(f); b.illisibles += illisibles;
    const parHeure = new Map<number, Map<string, number[]>>();
    const ajouter = (x: Minute) => { const h = Math.floor(x.t / 3600_000) * 3600_000; const s = parHeure.get(h) ?? new Map<string, number[]>(); for (const [k, v] of Object.entries(x.v)) { const l = s.get(k) ?? []; l.push(v); s.set(k, l); } parHeure.set(h, s); };
    for (const x of lignes) ajouter(x);
    // Une heure à cheval sur deux jours (fuseau décalé d'une demi-heure) : ses minutes de l'autre jour comptent aussi.
    const d0 = new Date(`${jour}T00:00:00`), d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    const aCheval = [...parHeure.keys()].filter((h) => h < d0.getTime() || h + 3600_000 > d1.getTime());
    for (const autre of new Set(aCheval.flatMap((h) => [day(h), day(h + 3600_000 - 1)]).filter((x) => x !== jour))) {
      const fa = join(this.dir, `${autre}.jsonl`); if (!estFichier(fa)) continue;
      for (const x of lireMinutes(fa).lignes) if (aCheval.some((h) => x.t >= h && x.t < h + 3600_000)) ajouter(x);
    }
    // Ce que le fichier des heures n'a pas encore, série par série (rien en double), calculé comme l'heure rangée en marche.
    const moisListe = new Set([...parHeure.keys()].map(month));
    const { deja, finNette } = lireHeures(this.dir, moisListe);
    const aEcrire = new Map<string, string[]>(), attendu: string[] = [];
    for (const [h, s] of [...parHeure].sort((x, y) => x[0] - y[0])) {
      const v: Record<string, [number, number, number]> = {};
      for (const [k, l] of s) { attendu.push(`${h}|${k}`); if (!deja.has(`${h}|${k}`)) v[k] = [Math.round((l.reduce((x, y) => x + y, 0) / l.length) * 1000) / 1000, Math.min(...l), Math.max(...l)]; }
      if (Object.keys(v).length) { const mo = month(h), a = aEcrire.get(mo) ?? []; a.push(`${JSON.stringify({ t: h, v })}\n`); aEcrire.set(mo, a); }
    }
    for (const [mo, a] of aEcrire) {
      // Un fichier des heures qui finit par une ligne coupée : la nouvelle ligne commence à la ligne.
      try { appendFileSync(join(this.dir, `heures-${mo}.jsonl`), `${finNette.get(mo) === false ? '\n' : ''}${a.join('')}`); b.heures += a.length; } catch { /* relu juste après */ }
    }
    // Relu : toutes les heures de ce jour doivent y être ; sinon le jour est gardé (nouvel essai le lendemain).
    const relu = aEcrire.size ? lireHeures(this.dir, moisListe).deja : deja;
    if (!attendu.every((x) => relu.has(x))) { if (jour < limite) b.gardes++; return; }
    if (jour < limite && estFichier(f)) { unlinkSync(f); b.effaces++; }
  }
  /** Les noms de séries connus (avec un préfixe éventuel) ; les séries réservées au propriétaire : seulement si demandé. */
  names(prefix = '', o: Lecture = {}): string[] {
    const s = new Set<string>([...this.recent.keys(), ...this.pending.keys()]);
    const f = join(this.dir, `${day(this.now())}.jsonl`);
    if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').slice(-200)) { try { for (const k of Object.keys((JSON.parse(l) as { v: object }).v)) s.add(k); } catch { /* ligne coupée */ } }
    return [...s].filter((k) => k.startsWith(prefix) && (o.prive === true || !seriePrivee(k))).sort();
  }
  /** Les points bruts (une minute) d'une série entre deux instants. Au-delà de 31 jours : moyennes horaires. */
  points(name: string, from: number, to = this.now(), o: Lecture = {}): Point[] {
    // Une série réservée au propriétaire, lue sans le demander : rien (comme si elle n'existait pas).
    if (seriePrivee(name) && o.prive !== true) return [];
    const out: Point[] = [];
    if (to - from <= 2 * 3600_000 && this.recent.has(name)) { for (const p of this.recent.get(name)!) if (p[0] >= from && p[0] <= to) out.push(p); }
    else {
      const minutesFrom = Math.max(from, this.now() - 31 * 864e5);
      // Les heures pour ce qui est plus vieux que 31 jours.
      if (from < minutesFrom) for (let m = new Date(from).setDate(1); m <= minutesFrom; m = new Date(new Date(m).setMonth(new Date(m).getMonth() + 1)).getTime()) {
        const f = join(this.dir, `heures-${month(m)}.jsonl`); if (!existsSync(f)) continue;
        for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: number; v: Record<string, [number, number, number]> }; if (x.t >= from && x.t < minutesFrom && x.v[name]) out.push([x.t, x.v[name][0]]); } catch { /* */ } }
      }
      for (let t = new Date(minutesFrom).setHours(0, 0, 0, 0); t <= to; t += 864e5) {
        const f = join(this.dir, `${day(t)}.jsonl`); if (!existsSync(f)) continue;
        for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: number; v: Record<string, number> }; if (x.t >= minutesFrom && x.t <= to && x.v[name] !== undefined) out.push([x.t, x.v[name]]); } catch { /* */ } }
      }
    }
    // La minute en cours (pas encore écrite).
    const p = this.pending.get(name); if (p?.length && this.minute >= from && this.minute <= to) out.push([this.minute, p.reduce((a, b) => a + b, 0) / p.length]);
    return out.sort((a, b) => a[0] - b[0]);
  }
  /** La série regroupée en `buckets` paquets (pour une courbe lisible). */
  series(name: string, from: number, to = this.now(), buckets = 120, o: Lecture = {}): Agg[] {
    const pts = this.points(name, from, to, o); if (!pts.length) return [];
    const step = Math.max(60_000, Math.ceil((to - from) / buckets / 60_000) * 60_000), m = new Map<number, number[]>();
    for (const [t, v] of pts) { const b = Math.floor(t / step) * step; const l = m.get(b) ?? []; l.push(v); m.set(b, l); }
    return [...m].sort((a, b) => a[0] - b[0]).map(([t, l]) => ({ t, avg: l.reduce((a, b) => a + b, 0) / l.length, min: Math.min(...l), max: Math.max(...l), last: l[l.length - 1], n: l.length }));
  }
  /** Une fonction sur une fenêtre récente (pour les déclencheurs) : moyenne, min, max, dernière valeur, variation. */
  fn(name: string, f: 'avg' | 'min' | 'max' | 'last' | 'delta' | 'count', windowMs: number, o: Lecture = {}): number | undefined {
    const pts = this.points(name, this.now() - windowMs, this.now(), o); if (!pts.length) return undefined;
    const vals = pts.map((p) => p[1]);
    switch (f) { case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length; case 'min': return Math.min(...vals); case 'max': return Math.max(...vals); case 'last': return vals[vals.length - 1]; case 'delta': return vals[vals.length - 1] - vals[0]; default: return vals.length; }
  }
  /** Texte au format Prometheus (dernière valeur de chaque série), pour d'autres outils ; jamais une série réservée au propriétaire. */
  prometheus(): string {
    const out: string[] = [];
    for (const n of this.names()) { const p = this.points(n, this.now() - 10 * 60_000); if (!p.length) continue; const name = `odin_${n.replace(/[^a-zA-Z0-9_]/g, '_')}`; out.push(`# TYPE ${name} gauge`, `${name} ${p[p.length - 1][1]} ${p[p.length - 1][0]}`); }
    return `${out.join('\n')}\n`;
  }
}

let current: Metrics | undefined;
export const setMetrics = (m: Metrics | undefined) => { current = m; };
/** Le rangement des mesures d'Odin (absent : les applis ne rangent rien, sans erreur). */
export const metrics = () => current;
