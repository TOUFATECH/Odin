// Banc de rapidité : les outils communs (statistiques, temps processeur, charge de la machine, compteur de lectures et
// d'écritures disque, profil processeur, sortie JSON et texte). Rien ici ne modifie Odin : les fonctions de `node:fs`
// sont seulement ENVELOPPÉES pour compter (puis rendues telles quelles par `arreterCompteur`).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { cpus, loadavg, freemem, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

// ------------------------------------------------------------------------------------------------ statistiques
export interface Stat { n: number; mediane: number; p95: number; min: number; max: number; moyenne: number }
export function stat(valeurs: number[]): Stat {
  const v = valeurs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mediane: NaN, p95: NaN, min: NaN, max: NaN, moyenne: NaN };
  const q = (p: number) => { const i = (v.length - 1) * p, a = Math.floor(i), b = Math.ceil(i); return v[a] + (v[b] - v[a]) * (i - a); };
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: v.length, mediane: r(q(0.5)), p95: r(q(0.95)), min: r(v[0]), max: r(v[v.length - 1]), moyenne: r(v.reduce((s, x) => s + x, 0) / v.length) };
}
export const ms = (x: number) => (Number.isFinite(x) ? (x >= 100 ? `${Math.round(x)} ms` : `${Math.round(x * 100) / 100} ms`) : '—');

// ------------------------------------------------------------------------------------------------ chrono + processeur
/** Mesure une fonction : temps écoulé et temps processeur (utilisateur + système, tout le processus). */
export async function chrono<T>(f: () => T | Promise<T>): Promise<{ r: T; ms: number; cpu: number }> {
  const c0 = process.cpuUsage(), t0 = performance.now();
  const r = await f();
  const t = performance.now() - t0, c = process.cpuUsage(c0);
  return { r, ms: t, cpu: (c.user + c.system) / 1000 };
}
/** Répète une mesure (après `chauffe` passages non comptés) : médiane et 95e centile du temps et du processeur. */
export async function repeter(n: number, f: (i: number) => unknown | Promise<unknown>, chauffe = 3): Promise<{ temps: Stat; cpu: Stat }> {
  for (let i = 0; i < chauffe; i++) await f(-1 - i);
  const t: number[] = [], c: number[] = [];
  for (let i = 0; i < n; i++) { const m = await chrono(() => f(i)); t.push(m.ms); c.push(m.cpu); }
  return { temps: stat(t), cpu: stat(c) };
}

// ------------------------------------------------------------------------------------------------ charge de la machine
/** Échantillonne l'occupation des 8 fils de la machine pendant `dureeMs` (os.loadavg vaut 0 sous Windows). */
export async function chargeMachine(dureeMs = 1000): Promise<{ occupation: number; fils: number; memoireLibreGo: number; memoireTotaleGo: number; loadavg: number[] }> {
  const a = cpus(); await new Promise((r) => setTimeout(r, dureeMs)); const b = cpus();
  let occupe = 0, total = 0;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i].times, tb = b[i].times;
    const tot = (tb.user - ta.user) + (tb.nice - ta.nice) + (tb.sys - ta.sys) + (tb.irq - ta.irq) + (tb.idle - ta.idle);
    occupe += tot - (tb.idle - ta.idle); total += tot;
  }
  return { occupation: total ? Math.round((occupe / total) * 1000) / 10 : NaN, fils: a.length, memoireLibreGo: Math.round(freemem() / 1e8) / 10, memoireTotaleGo: Math.round(totalmem() / 1e8) / 10, loadavg: loadavg() };
}
/** Suit l'occupation de la machine en continu (un échantillon par seconde) ; `fin()` rend la moyenne et le maximum. */
export function suivreCharge(): { fin(): { moyenne: number; max: number; echantillons: number } } {
  const vals: number[] = []; let prev = cpus();
  const t = setInterval(() => {
    const cur = cpus(); let occ = 0, tot = 0;
    for (let i = 0; i < cur.length; i++) { const a = prev[i].times, b = cur[i].times; const s = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + (b.idle - a.idle); occ += s - (b.idle - a.idle); tot += s; }
    if (tot) vals.push((occ / tot) * 100); prev = cur;
  }, 1000); t.unref();
  return { fin() { clearInterval(t); const s = stat(vals); return { moyenne: s.moyenne, max: s.max, echantillons: vals.length }; } };
}

// ------------------------------------------------------------------------------------------------ boucle d'événements
/** Mesure le retard de la boucle d'événements (le fil d'Odin bloqué) pendant une fonction. */
export async function retardBoucle<T>(f: () => Promise<T>): Promise<{ r: T; maxMs: number; p99Ms: number; moyMs: number }> {
  const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
  try { const r = await f(); h.disable(); return { r, maxMs: h.max / 1e6, p99Ms: h.percentile(99) / 1e6, moyMs: h.mean / 1e6 }; } finally { h.disable(); }
}

// ------------------------------------------------------------------------------------------------ compteur d'E/S
export interface CompteES { lectures: number; ecritures: number; octetsEcrits: number; parDossier: Record<string, { l: number; e: number }>; parFonction: Record<string, number> }
const LECTURES = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'readSync', 'accessSync'];
const ECRITURES = ['writeFileSync', 'appendFileSync', 'renameSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'copyFileSync', 'writeSync'];
const LECTURES_P = ['readFile', 'readdir', 'stat', 'lstat', 'access', 'open'];
const ECRITURES_P = ['writeFile', 'appendFile', 'rename', 'mkdir', 'rm', 'unlink', 'copyFile'];
let compte: CompteES | undefined;
let racine = '';
const originaux = new Map<string, unknown>();
function dossierDe(p: unknown): string {
  const s = typeof p === 'string' ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : '';
  if (!s) return '(descripteur)';
  const n = s.replace(/\\/g, '/');
  const r = racine.replace(/\\/g, '/');
  if (r && n.startsWith(r)) { const rel = n.slice(r.length + 1); return rel.split('/')[0] || '(racine)'; }
  if (/node_modules|\/src\/|\/test\//.test(n)) return '(code)';
  return '(ailleurs)';
}
function envelopper(obj: Record<string, unknown>, nom: string, sorte: 'l' | 'e', cle: string): void {
  const f = obj[nom]; if (typeof f !== 'function' || originaux.has(cle)) return;
  originaux.set(cle, f);
  obj[nom] = function (this: unknown, ...args: unknown[]) {
    if (compte) {
      const d = dossierDe(args[0]); const x = (compte.parDossier[d] ??= { l: 0, e: 0 });
      if (sorte === 'l') { compte.lectures++; x.l++; } else { compte.ecritures++; x.e++; if (typeof args[1] === 'string') compte.octetsEcrits += Buffer.byteLength(args[1]); else if (Buffer.isBuffer(args[1])) compte.octetsEcrits += args[1].length; }
      compte.parFonction[nom] = (compte.parFonction[nom] ?? 0) + 1;
    }
    return (f as (...a: unknown[]) => unknown).apply(this, args);
  };
}
/** Pose le compteur une fois pour tout le processus (`racineOdin` : le dossier jetable, pour classer par sous-dossier). */
export function poserCompteur(racineOdin: string): void {
  racine = racineOdin;
  for (const n of LECTURES) envelopper(fs as unknown as Record<string, unknown>, n, 'l', `fs.${n}`);
  for (const n of ECRITURES) envelopper(fs as unknown as Record<string, unknown>, n, 'e', `fs.${n}`);
  for (const n of LECTURES_P) envelopper(fsp as unknown as Record<string, unknown>, n, 'l', `fsp.${n}`);
  for (const n of ECRITURES_P) envelopper(fsp as unknown as Record<string, unknown>, n, 'e', `fsp.${n}`);
  syncBuiltinESMExports();
}
export function changerRacine(r: string): void { racine = r; }
/** Compte les E/S pendant une fonction. */
export async function compterES<T>(f: () => Promise<T> | T): Promise<{ r: T; es: CompteES }> {
  const avant = compte;
  const c: CompteES = { lectures: 0, ecritures: 0, octetsEcrits: 0, parDossier: {}, parFonction: {} };
  compte = c;
  try { return { r: await f(), es: c }; } finally { compte = avant; }
}
export function ouvrirCompte(): CompteES { compte = { lectures: 0, ecritures: 0, octetsEcrits: 0, parDossier: {}, parFonction: {} }; return compte; }
export function fermerCompte(): void { compte = undefined; }

// ------------------------------------------------------------------------------------------------ chronomètre de méthodes
/** Temps cumulé (inclusif) passé dans des méthodes d'objets ou de prototypes, par nom. */
export class Methodes {
  readonly cumul = new Map<string, { ms: number; n: number }>();
  private readonly defaits: Array<() => void> = [];
  actif = true;
  /** Enveloppe `obj[nom]` (synchrone ou asynchrone). */
  suivre(obj: object, nom: string, etiquette: string): void {
    const o = obj as Record<string, unknown>; const f = o[nom];
    if (typeof f !== 'function') return;
    const self = this;
    const ajouter = (t: number) => { if (!self.actif) return; const c = self.cumul.get(etiquette) ?? { ms: 0, n: 0 }; c.ms += performance.now() - t; c.n++; self.cumul.set(etiquette, c); };
    o[nom] = function (this: unknown, ...args: unknown[]) {
      const t = performance.now();
      let r: unknown;
      try { r = (f as (...a: unknown[]) => unknown).apply(this, args); } catch (e) { ajouter(t); throw e; }
      if (r && typeof (r as Promise<unknown>).then === 'function') return (r as Promise<unknown>).finally(() => ajouter(t));
      ajouter(t); return r;
    };
    this.defaits.push(() => { o[nom] = f; });
  }
  vider(): Record<string, { ms: number; n: number }> { const o: Record<string, { ms: number; n: number }> = {}; for (const [k, v] of this.cumul) o[k] = { ms: Math.round(v.ms * 100) / 100, n: v.n }; this.cumul.clear(); return o; }
  defaire(): void { for (const d of this.defaits.reverse()) d(); this.defaits.length = 0; }
}

// ------------------------------------------------------------------------------------------------ profil processeur
/** Profil processeur (échantillons toutes les 100 µs) pendant une fonction ; rend le temps inclusif par fonction nommée. */
export async function profiler<T>(f: () => Promise<T>, noms: string[]): Promise<{ r: T; inclusif: Record<string, number>; propre: Array<{ nom: string; url: string; ms: number }>; totalMs: number }> {
  const { Session } = await import('node:inspector/promises');
  const s = new Session(); s.connect();
  await s.post('Profiler.enable'); await s.post('Profiler.setSamplingInterval', { interval: 100 }); await s.post('Profiler.start');
  let r: T;
  try { r = await f(); } finally { /* rien */ }
  const { profile } = await s.post('Profiler.stop') as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string }; children?: number[] }>; samples: number[]; timeDeltas: number[] } };
  s.disconnect();
  // temps propre par nœud
  const propreN = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) propreN.set(profile.samples[i], (propreN.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  const parId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  // inclusif : pour chaque échantillon, chaque nom distinct de la pile reçoit le temps (une fois par pile)
  const inclusif: Record<string, number> = Object.fromEntries(noms.map((n) => [n, 0]));
  const voulus = new Set(noms);
  for (const [id, t] of propreN) {
    const vus = new Set<string>();
    for (let x: number | undefined = id; x !== undefined; x = parent.get(x)) { const nom = parId.get(x)!.callFrame.functionName; if (voulus.has(nom) && !vus.has(nom)) { vus.add(nom); inclusif[nom] += t; } }
  }
  const parNom = new Map<string, { nom: string; url: string; ms: number }>();
  for (const [id, t] of propreN) { const cf = parId.get(id)!.callFrame; const k = `${cf.functionName}|${cf.url}`; const e = parNom.get(k) ?? { nom: cf.functionName || '(anonyme)', url: cf.url.replace(/^.*\/(src|test|node:)/, '$1'), ms: 0 }; e.ms += t; parNom.set(k, e); }
  const totalMs = [...propreN.values()].reduce((s, x) => s + x, 0);
  for (const k of Object.keys(inclusif)) inclusif[k] = Math.round(inclusif[k] * 100) / 100;
  return { r: r!, inclusif, propre: [...parNom.values()].filter((x) => !/^\((idle|program|garbage collector)\)$/.test(x.nom)).sort((a, b) => b.ms - a.ms).slice(0, 40).map((x) => ({ ...x, ms: Math.round(x.ms * 100) / 100 })), totalMs: Math.round(totalMs) };
}

// ------------------------------------------------------------------------------------------------ sortie
export const SORTIE = process.env.RAPIDITE_SORTIE ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.claude', 'projects', 'V--Work-ODIN', 'file-attente', 'rapidite');
export function ecrireResultat(nom: string, donnees: unknown, texte: string): void {
  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(join(SORTIE, `${nom}.json`), JSON.stringify(donnees, null, 2));
  writeFileSync(join(SORTIE, `${nom}.txt`), texte);
}
/** Un tableau de texte aligné. */
export function tableau(entetes: string[], lignes: Array<Array<string | number>>): string {
  const cell = (x: string | number) => String(x);
  const larg = entetes.map((h, i) => Math.max(h.length, ...lignes.map((l) => cell(l[i] ?? '').length)));
  const fmt = (l: Array<string | number>) => l.map((x, i) => cell(x).padEnd(larg[i])).join(' | ');
  return [fmt(entetes), larg.map((w) => '-'.repeat(w)).join('-|-'), ...lignes.map(fmt)].join('\n');
}
