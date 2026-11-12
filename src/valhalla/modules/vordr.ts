// Vörðr — la surveillance d'Odin (télésurveillance des services) : sites, machines, ports, DNS, certificats,
// battements envoyés par d'autres programmes, et les applis d'Odin elles-mêmes. Chaque sonde a son rythme,
// ses essais avant d'alerter, ses heures de maintenance ; l'historique (disponibilité, temps de réponse,
// pannes) est gardé jour par jour pour toujours ; une page publique d'état peut être partagée.
// Fonctions reprises (réécrites) d'Uptime Kuma, Gatus et Statping.
// (Vörðr : l'esprit gardien qui veille sur chaque maison et chaque personne.)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { Resolver } from 'node:dns/promises';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module, Param, Tone } from '../types.ts';
import { inSchedule, type Schedule } from '../vidarr/server.ts';
import { localDay } from '../vidarr/history.ts';
import { dnsServer } from './vidarr.ts';
import { engine } from './gjoll.ts';
import { metrics } from '../metrics.ts';
import { SEV, describe as describeTrigger, evaluate, sla, toEscalate, type Fn, type Op, type Problem, type Severity, type Trigger } from '../vordr/problems.ts';
import { OIDS, snmpGet } from '../vordr/snmp.ts';

export type Kind = 'http' | 'tcp' | 'ping' | 'dns' | 'push' | 'odin' | 'snmp' | 'scenario' | 'commande';
export interface Step { url: string; method?: string; body?: string; status?: string; contains?: string }
export interface Monitor {
  id: string; name: string; kind: Kind; target: string;
  /** secondes entre deux vérifications */
  every: number;
  /** échecs d'affilée avant de déclarer la panne */
  retries: number; timeoutMs: number;
  /** http : codes acceptés (« 200-399 ») ; mot attendu (« !mot » = ne doit pas apparaître) ; dns : réponse attendue */
  status?: string; keyword?: string; expect?: string;
  /** dns : type (A, AAAA, CNAME, MX, TXT, NS) et serveur à interroger (vide : celui de la machine) */
  record?: string; server?: string;
  /** http : alerte quand le certificat expire dans moins de N jours */
  certDays?: number;
  /** push : jeton secret de l'adresse à appeler */
  token?: string;
  group: string; paused?: boolean; maintenance?: Schedule;
  /** niveau de l'alerte en cas de panne */
  level?: 'critique' | 'haute' | 'moyenne';
  /** créée toute seule par un lien (Iðunn, Víðarr, Gjöll…) */
  source?: string;
  /** sur la page publique d'état */
  public?: boolean;
  /** snmp : OID à lire (ou un nom connu), communauté ; valeur attendue facultative (« expect ») */
  oid?: string; community?: string;
  /** scénario web : les pages à enchaîner (avec cookies) */
  steps?: Step[];
  /** commande : un contrôle compatible Nagios (dossier des greffons), avec ses arguments */
  command?: string; args?: string[];
  /** sondes dont celle-ci dépend (si elles sont en panne, celle-ci n'alerte pas : symptôme) */
  dependsOn?: string[];
}
export interface Beat { t: number; ok: boolean; ms: number; msg: string }
interface Live { status: 'en ligne' | 'en panne' | 'en attente' | 'maintenance' | 'en pause'; fails: number; since: number; last?: Beat; cert?: number; certAt?: number; lastPush?: number; downAt?: number }
interface DayStat { up: number; down: number; ms: number; n: number; events: Array<{ t: number; status: string; msg: string }> }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
let appCtx: ModCtx | undefined;
const beats = new Map<string, Beat[]>(), live = new Map<string, Live>(), running = new Set<string>();
// La dernière appli vue sert aux adresses publiques (signe de vie, page d'état), qui n'ont pas de contexte.
const list = (ctx: ModCtx): Monitor[] => { appCtx = ctx; return (ctx.settings.monitors as Monitor[] | undefined) ?? []; };
const save = (ctx: ModCtx, m: Monitor[]) => ctx.saveSettings({ monitors: m });
const liveOf = (id: string): Live => { let l = live.get(id); if (!l) { l = { status: 'en attente', fails: 0, since: Date.now() }; live.set(id, l); } return l; };

// ---------------- Les vérifications ----------------
/** Codes HTTP acceptés : « 200-399 », « 200,204 », « 2xx ». Pur. */
export function statusOk(code: number, spec = '200-399'): boolean {
  return spec.split(',').map((x) => x.trim()).filter(Boolean).some((p) => { if (/^\dxx$/i.test(p)) return Math.floor(code / 100) === Number(p[0]); const m = /^(\d{3})(?:-(\d{3}))?$/.exec(p); return m ? code >= Number(m[1]) && code <= Number(m[2] ?? m[1]) : false; });
}
/** Jours restants du certificat d'un site (HTTPS). */
export function certDaysLeft(host: string, port = 443, timeoutMs = 8000): Promise<number> {
  return new Promise((ok, ko) => {
    const sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs }, () => { const c = sock.getPeerCertificate(); sock.end(); if (!c?.valid_to) return ko(new Error('pas de certificat')); ok(Math.floor((Date.parse(c.valid_to) - Date.now()) / 86400_000)); });
    sock.on('timeout', () => { sock.destroy(); ko(new Error('pas de réponse')); }); sock.on('error', ko);
  });
}
export async function check(ctx: ModCtx, m: Monitor, now = Date.now()): Promise<Beat> {
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  try {
    if (m.kind === 'http') {
      const r = await ctx.fetch(m.target, { signal: AbortSignal.timeout(m.timeoutMs), redirect: 'follow', headers: { 'user-agent': 'Odin-Vordr/1' } });
      const body = m.keyword ? await r.text() : (await r.body?.cancel(), '');
      if (!statusOk(r.status, m.status)) return { t: now, ok: false, ms: ms(), msg: `code ${r.status}` };
      if (m.keyword) { const neg = m.keyword.startsWith('!'), w = neg ? m.keyword.slice(1) : m.keyword, has = body.includes(w); if (neg ? has : !has) return { t: now, ok: false, ms: ms(), msg: neg ? `« ${w} » est apparu dans la page` : `« ${w} » absent de la page` }; }
      return { t: now, ok: true, ms: ms(), msg: `code ${r.status}` };
    }
    if (m.kind === 'tcp') {
      const [host, port] = splitHostPort(m.target);
      await new Promise<void>((ok, ko) => { const c = net.connect({ host, port, timeout: m.timeoutMs }, () => { c.end(); ok(); }); c.on('timeout', () => { c.destroy(); ko(new Error('pas de réponse')); }); c.on('error', ko); });
      return { t: now, ok: true, ms: ms(), msg: `port ${port} ouvert` };
    }
    if (m.kind === 'ping') {
      const r = await ctx.run('ping', ['-c', '1', '-W', String(Math.max(1, Math.round(m.timeoutMs / 1000))), m.target], { timeoutMs: m.timeoutMs + 2000 });
      const tm = /time[=<]([\d.]+)\s*ms/.exec(r.out);
      return r.code === 0 ? { t: now, ok: true, ms: tm ? Math.round(Number(tm[1])) : ms(), msg: 'répond au ping' } : { t: now, ok: false, ms: ms(), msg: 'ne répond pas au ping' };
    }
    if (m.kind === 'dns') {
      const res = new Resolver({ timeout: m.timeoutMs, tries: 1 });
      if (m.server) { const [h, p] = splitHostPort(m.server, 53); res.setServers([`${h}:${p}`]); }
      const type = (m.record || 'A').toUpperCase();
      const raw = await res.resolve(m.target, type as 'A');
      const vals = (raw as unknown[]).map((x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.join('') : (x as { exchange?: string }).exchange ?? JSON.stringify(x)));
      if (m.expect && !vals.some((v) => v === m.expect)) return { t: now, ok: false, ms: ms(), msg: `répond ${vals.join(', ') || 'rien'} au lieu de ${m.expect}` };
      return { t: now, ok: true, ms: ms(), msg: vals.join(', ').slice(0, 120) || 'répond' };
    }
    if (m.kind === 'push') {
      const l = liveOf(m.id), last = l.lastPush ?? 0, limit = m.every * 1000 * Math.max(1, m.retries);
      return last && now - last <= limit ? { t: now, ok: true, ms: 0, msg: `signe de vie il y a ${Math.round((now - last) / 1000)} s` } : { t: now, ok: false, ms: 0, msg: last ? `plus de signe de vie depuis ${Math.round((now - last) / 60_000)} min` : 'jamais reçu de signe de vie' };
    }
    if (m.kind === 'snmp') {
      const oid = OIDS[m.oid ?? ''] ?? m.oid ?? OIDS.allume, [host, port] = splitHostPort(m.target.includes(':') ? m.target : `${m.target}:161`);
      const [v] = await snmpGet(host, [oid], { community: m.community || 'public', port, timeoutMs: m.timeoutMs });
      if (v.value === null) return { t: now, ok: false, ms: ms(), msg: `OID ${oid} inconnu de l'appareil` };
      if (typeof v.value === 'number') metrics()?.put({ [`vordr.snmp.${m.id}`]: v.value });
      if (m.expect && String(v.value) !== m.expect) return { t: now, ok: false, ms: ms(), msg: `vaut ${v.value} au lieu de ${m.expect}` };
      return { t: now, ok: true, ms: ms(), msg: `${m.oid && OIDS[m.oid] ? m.oid : oid} = ${String(v.value).slice(0, 80)}` };
    }
    if (m.kind === 'scenario') {
      // Enchaîne les pages comme un visiteur (cookies gardés d'une page à l'autre).
      let cookie = '';
      for (const [i, st] of (m.steps ?? []).entries()) {
        const r = await ctx.fetch(st.url, { method: st.method ?? (st.body ? 'POST' : 'GET'), body: st.body, redirect: 'manual', signal: AbortSignal.timeout(m.timeoutMs), headers: { 'user-agent': 'Odin-Vordr/1', ...(cookie ? { cookie } : {}), ...(st.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) } });
        const sc = r.headers.get('set-cookie'); if (sc) cookie = [cookie, ...sc.split(/,(?=[^;]+=)/).map((c) => c.split(';')[0].trim())].filter(Boolean).join('; ');
        const body = st.contains ? await r.text() : (await r.body?.cancel(), '');
        if (!statusOk(r.status, st.status ?? '200-399')) return { t: now, ok: false, ms: ms(), msg: `étape ${i + 1} : code ${r.status}` };
        if (st.contains && !body.includes(st.contains)) return { t: now, ok: false, ms: ms(), msg: `étape ${i + 1} : « ${st.contains} » absent` };
      }
      return { t: now, ok: true, ms: ms(), msg: `${(m.steps ?? []).length} étape(s) réussie(s)` };
    }
    if (m.kind === 'commande') {
      // Greffons compatibles Nagios / Centreon : 0 = OK, 1 = avertissement, 2 = critique. Seulement ceux du dossier des greffons.
      if (!/^check_[\w-]+$/.test(m.command ?? '')) throw new Error('greffon invalide (check_…)');
      const dir = ['/usr/lib/nagios/plugins', '/usr/lib64/nagios/plugins', '/usr/lib/monitoring-plugins'].find((d) => existsSync(join(d, m.command!)));
      if (!dir) throw new Error(`greffon ${m.command} introuvable (paquet monitoring-plugins)`);
      const r = await ctx.run(join(dir, m.command!), m.args ?? [], { timeoutMs: m.timeoutMs });
      const out = r.out.split('|')[0].trim().slice(0, 160);
      return { t: now, ok: r.code === 0, ms: ms(), msg: out || `code ${r.code}` };
    }
    // Les applis d'Odin elles-mêmes.
    if (m.target === 'vidarr') { const d = dnsServer(); return d ? { t: now, ok: true, ms: ms(), msg: `DNS d'Odin en marche (port ${d.port})` } : { t: now, ok: false, ms: ms(), msg: 'le DNS d\'Odin est arrêté' }; }
    if (m.target === 'gjoll') { const e = engine(); return e ? { t: now, ok: true, ms: ms(), msg: `tunnel allumé, ${e.stats().length} appareil(s)` } : { t: now, ok: false, ms: ms(), msg: 'le tunnel VPN est éteint' }; }
    const mod = ctx.modules().find((x) => x.id === m.target);
    return mod ? { t: now, ok: true, ms: ms(), msg: `${mod.name} présent` } : { t: now, ok: false, ms: ms(), msg: `appli ${m.target} introuvable` };
  } catch (e) {
    const err = e as Error & { code?: string; cause?: { code?: string } };
    const why = err.name === 'TimeoutError' || /timeout|pas de réponse/i.test(err.message) ? `pas de réponse en ${m.timeoutMs / 1000} s` : err.cause?.code ?? err.code ?? err.message;
    return { t: now, ok: false, ms: ms(), msg: String(why).slice(0, 160) };
  }
}
function splitHostPort(x: string, def = 0): [string, number] {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(x.trim()); if (m) return [m[1], Number(m[2])];
  if (!def) throw new Error('adresse:port attendu (ex. 192.168.1.10:22)'); return [x.trim(), def];
}

// ---------------- Historique ----------------
const dayFile = (dir: string, d: string) => join(dir, 'historique', d.slice(0, 4), d.slice(5, 7), `${d.slice(8, 10)}.json`);
function readDay(dir: string, d: string): Record<string, DayStat> { try { return JSON.parse(readFileSync(dayFile(dir, d), 'utf8')); } catch { return {}; } }
const dayCache = new Map<string, Record<string, DayStat>>();
function recordBeat(ctx: ModCtx, m: Monitor, b: Beat, event?: string): void {
  const arr = beats.get(m.id) ?? []; arr.push(b); if (arr.length > 240) arr.splice(0, arr.length - 240); beats.set(m.id, arr);
  const d = localDay(b.t), key = `${ctx.dir}|${d}`, all = dayCache.get(key) ?? readDay(ctx.dir, d);
  const x = (all[m.id] ??= { up: 0, down: 0, ms: 0, n: 0, events: [] });
  if (b.ok) { x.up++; x.ms += b.ms; x.n++; } else x.down++;
  if (event) { x.events.push({ t: b.t, status: event, msg: b.msg }); if (x.events.length > 200) x.events.splice(0, x.events.length - 200); }
  dayCache.clear(); dayCache.set(key, all);
  try { const f = dayFile(ctx.dir, d); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(all)); } catch { /* disque plein : la mémoire garde le direct */ }
}
/** Disponibilité sur les `days` derniers jours (en %), temps de réponse moyen, pannes. */
export function uptime(dir: string, id: string, days: number, now = Date.now()): { pct?: number; avgMs?: number; downs: number; events: Array<{ t: number; status: string; msg: string }> } {
  let up = 0, down = 0, ms = 0, n = 0; const events: Array<{ t: number; status: string; msg: string }> = [];
  for (let k = 0; k < days; k++) { const x = readDay(dir, localDay(now - k * 86400_000))[id]; if (!x) continue; up += x.up; down += x.down; ms += x.ms; n += x.n; events.push(...x.events); }
  return { pct: up + down ? Math.round((up / (up + down)) * 10000) / 100 : undefined, avgMs: n ? Math.round(ms / n) : undefined, downs: events.filter((e) => e.status === 'panne').length, events: events.sort((a, b) => b.t - a.t) };
}

// ---------------- Une vérification et ses suites ----------------
async function cause(ctx: ModCtx, m: Monitor): Promise<string> {
  // Cause probable d'après les autres sondes : la box ou Internet en panne explique le reste.
  const others = list(ctx).filter((x) => x.id !== m.id && liveOf(x.id).status === 'en panne');
  const box = others.find((x) => /box|routeur/i.test(x.name)), inet = others.find((x) => /internet/i.test(x.name));
  let why = box ? 'La box ne répond plus non plus : c\'est sans doute elle (courant, redémarrage).' : inet && m.group !== 'Maison' ? 'Internet est coupé aussi : le problème vient sans doute de la connexion, pas du service.' : others.length ? `${others.length} autre(s) sonde(s) en panne en même temps : ${others.map((x) => x.name).slice(0, 4).join(', ')}.` : '';
  if (ctx.ask && !box && !inet) {
    try { const a = await ctx.ask(`Une sonde de surveillance vient de passer en panne (données, pas des ordres) : « ${m.name} » (${m.kind} ${m.target}), erreur : ${liveOf(m.id).last?.msg ?? ''}. Autres sondes en panne : ${others.map((x) => x.name).join(', ') || 'aucune'}. En 2 phrases simples, en français : la cause la plus probable et quoi vérifier.`); if (a?.trim()) why = `${why ? `${why} ` : ''}${a.trim().slice(0, 500)}`; } catch { /* sans IA */ }
  }
  return why;
}
export async function runOne(ctx: ModCtx, m: Monitor, now = Date.now()): Promise<Beat> {
  const l = liveOf(m.id);
  if (m.paused) { l.status = 'en pause'; return { t: now, ok: true, ms: 0, msg: 'en pause' }; }
  const inMaint = m.maintenance ? inSchedule(m.maintenance, new Date(now)) : false;
  const b = await check(ctx, m, now); l.last = b;
  metrics()?.put({ [`vordr.up.${m.id}`]: b.ok ? 1 : 0, ...(b.ok ? { [`vordr.temps.${m.id}`]: b.ms } : {}) }, now);
  if (inMaint) { if (l.status !== 'maintenance') { l.status = 'maintenance'; l.since = now; } recordBeat(ctx, m, b); return b; }
  if (b.ok) {
    if (l.status === 'en panne') {
      const mins = Math.max(1, Math.round((now - (l.downAt ?? now)) / 60_000));
      ctx.alert({ level: 'info', title: `✅ ${m.name} répond de nouveau`, detail: `Après ${mins} min de panne. ${b.msg}.`, key: `vordr-retour-${m.id}-${now}` });
      ctx.emit('retour', { nom: m.name, cible: m.target, minutes: mins });
      closeProblem(ctx, 'sonde', m.id, now);
      recordBeat(ctx, m, b, 'retour');
    } else recordBeat(ctx, m, b, l.status === 'en attente' ? 'en ligne' : undefined);
    if (l.status !== 'en ligne') { l.status = 'en ligne'; l.since = now; }
    l.fails = 0;
  } else {
    l.fails++;
    if (l.fails >= Math.max(1, m.retries) && l.status !== 'en panne') {
      l.status = 'en panne'; l.since = now; l.downAt = now;
      recordBeat(ctx, m, b, 'panne');
      // Dépend d'une sonde déjà en panne (ex. Internet) : rangé comme symptôme, sans alerte en double.
      const dep = (m.dependsOn ?? []).map((d) => list(ctx).find((x) => x.id === d || x.name === d)).find((x) => x && liveOf(x.id).status === 'en panne');
      openProblem(ctx, { source: 'sonde', ref: m.id, name: `${m.name} est en panne`, severity: m.level === 'critique' ? 'desastre' : m.level === 'moyenne' ? 'moyen' : 'haut', start: now, comments: [], escalated: 0 }, dep ? problems(ctx).find((p) => p.source === 'sonde' && p.ref === dep.id && !p.end)?.id : undefined);
      if (dep) { ctx.emit('panne', { nom: m.name, cible: m.target, genre: m.kind, erreur: b.msg, groupe: m.group, symptome: dep.name }); return b; }
      const why = await cause(ctx, m);
      ctx.alert({ level: m.level ?? 'haute', title: `❌ ${m.name} est en panne`, detail: `${b.msg} (${l.fails} essai(s) d'affilée).${why ? `\n${why}` : ''}`, key: `vordr-${m.id}`, data: { cible: m.target } });
      ctx.emit('panne', { nom: m.name, cible: m.target, genre: m.kind, erreur: b.msg, groupe: m.group });
    } else recordBeat(ctx, m, b);
  }
  // Certificat d'un site HTTPS : vérifié toutes les 6 heures.
  if (m.kind === 'http' && /^https:/i.test(m.target) && (!l.certAt || now - l.certAt > 6 * 3600_000)) {
    l.certAt = now;
    try { const u = new URL(m.target); l.cert = await certDaysLeft(u.hostname, Number(u.port) || 443, m.timeoutMs);
      if (l.cert < (m.certDays ?? 14)) ctx.alert({ level: l.cert < 3 ? 'critique' : 'haute', title: `🔐 Le certificat de ${m.name} expire dans ${l.cert} jour(s)`, detail: 'Renouvelle-le (Let\'s Encrypt, ton hébergeur) avant que les visiteurs voient une erreur.', key: `vordr-cert-${m.id}` });
    } catch { /* certificat illisible : la vérification HTTP dit déjà s'il y a un souci */ }
  }
  return b;
}

// ---------------- Problèmes et déclencheurs ----------------
export const problems = (ctx: ModCtx): Problem[] => (ctx.settings.problems as Problem[] | undefined) ?? [];
const triggers = (ctx: ModCtx): Trigger[] => (ctx.settings.triggers as Trigger[] | undefined) ?? [];
function saveProblems(ctx: ModCtx, l: Problem[]): void { const open = l.filter((p) => !p.end), closed = l.filter((p) => p.end).slice(-300); ctx.saveSettings({ problems: [...closed, ...open] }); }
function openProblem(ctx: ModCtx, p: Omit<Problem, 'id'>, symptomOf?: string): Problem {
  const l = problems(ctx), cur = l.find((x) => x.source === p.source && x.ref === p.ref && !x.end); if (cur) return cur;
  const x: Problem = { ...p, id: `${p.start.toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...(symptomOf ? { symptomOf } : {}) };
  saveProblems(ctx, [...l, x]); return x;
}
function closeProblem(ctx: ModCtx, source: Problem['source'], ref: string, now: number): void {
  const l = problems(ctx); let ch = false; for (const p of l) if (p.source === source && p.ref === ref && !p.end) { p.end = now; ch = true; } if (ch) saveProblems(ctx, l);
}
function slaRows(ctx: ModCtx, target: number, days: number, now = Date.now()) {
  return list(ctx).map((m) => { const d: Array<{ up: number; down: number }> = []; for (let k = 0; k < days; k++) { const x = readDay(ctx.dir, localDay(now - k * 86400_000))[m.id]; if (x) d.push({ up: x.up, down: x.down }); } return { name: m.name, ...sla(d, target) }; });
}
const dur = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} j`; };
/** Évalue les déclencheurs et l'escalade (chaque minute). */
export function evalTriggers(ctx: ModCtx, now = Date.now()): { opened: number; closed: number } {
  const mx = metrics(); if (!mx) return { opened: 0, closed: 0 };
  const all = problems(ctx), r = evaluate(mx, triggers(ctx), all.filter((p) => !p.end), now);
  for (const c of r.closed) { c.p.end = now; const t = triggers(ctx).find((x) => x.id === c.p.ref); if (!c.p.symptomOf) ctx.alert({ level: 'info', title: `✅ Résolu : ${c.p.name}`, detail: `Après ${dur(now - c.p.start)}${c.value !== undefined ? ` (valeur ${Math.round(c.value * 100) / 100})` : ''}.`, key: `vordr-res-${c.p.id}` }); void t; }
  for (const p of r.opened) { all.push(p); const t = triggers(ctx).find((x) => x.id === p.ref); if (!p.symptomOf) ctx.alert({ level: SEV[p.severity].level, title: p.name, detail: `${t ? describeTrigger(t) : ''}${p.value !== undefined ? ` Valeur : ${p.value}.` : ''}`, key: `vordr-trig-${p.ref}`, ...(t?.steps?.length ? { steps: t.steps } : {}), fix: { action: 'prendre_en_main', input: { id: p.id }, label: 'Je m\'en occupe' } }); ctx.emit('probleme', { nom: p.name, gravite: p.severity, valeur: p.value ?? '' }); }
  // Escalade : pas pris en main → on prévient encore, plus fort (la dernière étape passe « Ne pas déranger »).
  const steps = (ctx.settings.escalade as number[] | undefined) ?? [15, 60];
  for (const e of toEscalate(all.filter((p) => !p.end), now, steps)) { e.p.escalated = e.step; ctx.alert({ level: e.step >= steps.length ? 'critique' : 'haute', title: `⏫ Toujours pas pris en main : ${e.p.name}`, detail: `Ouvert depuis ${dur(now - e.p.start)} (gravité ${SEV[e.p.severity].label}).`, key: `vordr-esc-${e.p.id}-${e.step}`, fix: { action: 'prendre_en_main', input: { id: e.p.id }, label: 'Je m\'en occupe' } }); }
  saveProblems(ctx, all);
  return { opened: r.opened.length, closed: r.closed.length };
}

// ---------------- Page publique et battements ----------------
/** Un programme envoie un signe de vie : /v/<jeton>. Rend le nom de la sonde, ou rien si le jeton est inconnu. */
export function push(token: string, now = Date.now()): string | undefined {
  const ctx = appCtx; if (!ctx || !/^[a-f0-9]{24,64}$/.test(token)) return undefined;
  const m = list(ctx).find((x) => x.kind === 'push' && x.token === token); if (!m) return undefined;
  liveOf(m.id).lastPush = now; void runOne(ctx, m, now); return m.name;
}
const esc = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** La page publique d'état : seulement les sondes choisies, avec leur nom (jamais leur adresse). */
export function statusPage(slug: string, now = Date.now()): string | undefined {
  const ctx = appCtx; if (!ctx || !slug || slug !== s(ctx.settings.publicSlug)) return undefined;
  const ms = list(ctx).filter((m) => m.public);
  const rows = ms.map((m) => { const l = liveOf(m.id), u = uptime(ctx.dir, m.id, 30, now); const ok = l.status === 'en ligne', down = l.status === 'en panne'; return `<li><span class="d ${down ? 'ko' : ok ? 'ok' : 'wa'}" aria-hidden="true"></span><b>${esc(m.name)}</b><span>${down ? 'En panne' : ok ? 'En ligne' : l.status === 'maintenance' ? 'Maintenance' : 'En attente'}</span><small>${u.pct !== undefined ? `${u.pct.toLocaleString('fr-FR')} % sur 30 jours` : ''}</small></li>`; }).join('');
  const allOk = ms.every((m) => liveOf(m.id).status !== 'en panne');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s(ctx.settings.publicTitle) || 'État des services')}</title><meta http-equiv="refresh" content="60"><style>body{margin:0;font-family:system-ui,sans-serif;background:#f4f5f7;color:#1c1f24}main{max-width:720px;margin:0 auto;padding:32px 16px}h1{font-size:24px}.b{padding:14px 16px;border-radius:12px;font-weight:600;background:${allOk ? '#dcfce7;color:#166534' : '#fee2e2;color:#991b1b'}}ul{list-style:none;padding:0;margin:20px 0}li{display:grid;grid-template-columns:14px 1fr auto;gap:4px 12px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:0 0 10px}li small{grid-column:2/4;color:#4b5563}.d{width:12px;height:12px;border-radius:50%}.ok{background:#16a34a}.ko{background:#dc2626}.wa{background:#d97706}footer{color:#4b5563;font-size:13px}</style></head><body><main><h1>${esc(s(ctx.settings.publicTitle) || 'État des services')}</h1><p class="b">${allOk ? 'Tout fonctionne.' : 'Un ou plusieurs services sont en panne.'}</p><ul>${rows || '<li>Aucun service affiché.</li>'}</ul><footer>Mis à jour ${new Date(now).toLocaleString('fr-FR')} · surveillé par Odin</footer></main></body></html>`;
}

// ---------------- Le graphe ----------------
const COLOR: Record<string, string> = { 'en ligne': '#57C98A', 'en panne': '#EE6A55', 'en attente': '#F0A040', maintenance: '#4F9DDE', 'en pause': '#7d8791' };
const TONE: Record<string, Tone> = { 'en ligne': 'bon', 'en panne': 'mauvais', 'en attente': 'attention', maintenance: 'neutre', 'en pause': 'neutre' };
export function monitorGraph(ctx: ModCtx, ms: Monitor[], now = Date.now()): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'odin', label: 'Odin · Vörðr', sub: `${ms.length} sonde(s)`, square: true, size: 18, color: '#4F9DDE', hub: true }], edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  const st = (k: string) => ms.filter((m) => liveOf(m.id).status === k).length;
  details.odin = { kind: 'Vörðr', title: 'La surveillance d\'Odin', subtitle: `${ms.length} sonde(s)`, chips: [{ label: `${st('en ligne')} en ligne`, tone: 'bon' }, ...(st('en panne') ? [{ label: `${st('en panne')} en panne`, tone: 'mauvais' as Tone }] : []), ...(st('en attente') ? [{ label: `${st('en attente')} en attente`, tone: 'attention' as Tone }] : [])], rows: ms.slice(0, 20).map((m) => ({ k: m.name, v: liveOf(m.id).status, src: liveOf(m.id).last?.msg ?? '' })), actions: [{ action: 'verifier', label: 'Tout vérifier maintenant', input: { nom: '' }, primary: true }, { action: 'liens', label: 'Sondes automatiques', input: {} }] };
  const groups = [...new Set(ms.map((m) => m.group))];
  for (const g of groups) { const inG = ms.filter((m) => m.group === g), bad = inG.filter((m) => liveOf(m.id).status === 'en panne').length; nodes.push({ id: `g:${g}`, label: g, sub: bad ? `${bad} en panne` : 'tout va bien', square: true, size: 12, color: bad ? '#EE6A55' : '#7FB3E6', hub: true }); edges.push({ a: 'odin', b: `g:${g}`, w: 2, color: '#7FB3E6' }); details[`g:${g}`] = { kind: 'Groupe', title: g, subtitle: `${inG.length} sonde(s)`, rows: inG.map((m) => ({ k: m.name, v: liveOf(m.id).status, src: liveOf(m.id).last?.msg ?? '' })) }; }
  // Une même machine surveillée de plusieurs façons (ping, port, site) : un point pour elle, relié à ses sondes.
  const hostOf = (m: Monitor) => { try { return m.kind === 'http' ? new URL(m.target).hostname : m.kind === 'tcp' ? splitHostPort(m.target)[0] : m.kind === 'ping' || m.kind === 'dns' ? m.target : ''; } catch { return ''; } };
  const hosts = new Map<string, Monitor[]>(); for (const m of ms) { const h = hostOf(m); if (h) hosts.set(h, [...(hosts.get(h) ?? []), m]); }
  for (const [h, hm] of hosts) if (hm.length > 1) { nodes.push({ id: `h:${h}`, label: h, sub: 'machine', size: 6, color: '#8E959D' }); details[`h:${h}`] = { kind: 'Machine', title: h, rows: hm.map((m) => ({ k: m.name, v: liveOf(m.id).status, src: m.kind })), actions: [{ action: 'lire', label: 'Voir ses paquets (Rán)', input: { ip: h }, module: 'ran' }] }; }
  const day = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  for (const m of ms) {
    const l = liveOf(m.id), id = `m:${m.id}`, u1 = uptime(ctx.dir, m.id, 1, now), u30 = uptime(ctx.dir, m.id, 30, now), u365 = uptime(ctx.dir, m.id, 365, now);
    nodes.push({ id, label: m.name, sub: `${m.kind} · ${l.status}`, size: 9, color: COLOR[l.status], off: l.status === 'en pause', ring: l.status === 'en panne' ? '#EE6A55' : undefined, alert: l.status === 'en panne' ? { n: 1, level: 'grave' } : undefined, search: `${m.target} ${m.group}` });
    edges.push({ a: id, b: `g:${m.group}`, w: l.status === 'en ligne' ? 1 : 0, color: l.status === 'en panne' ? '#EE6A55' : undefined, dash: l.status !== 'en ligne' });
    const h = hostOf(m); if (h && (hosts.get(h)?.length ?? 0) > 1) edges.push({ a: id, b: `h:${h}` });
    const recent = (beats.get(m.id) ?? []).slice(-30);
    details[id] = {
      kind: `Sonde ${m.kind.toUpperCase()}`, title: m.name, subtitle: `${m.kind === 'push' ? 'adresse de battement (secrète)' : m.target} · toutes les ${m.every} s`,
      chips: [{ label: l.status, tone: TONE[l.status] }, ...(m.maintenance ? [{ label: `Maintenance ${m.maintenance.from} → ${m.maintenance.to}` }] : []), ...(l.cert !== undefined ? [{ label: `Certificat : ${l.cert} j`, tone: (l.cert < (m.certDays ?? 14) ? 'attention' : 'bon') as Tone }] : []), ...(m.source ? [{ label: `ajoutée par ${m.source}` }] : [])],
      rows: [
        { k: 'Dernière vérif.', v: l.last ? `${day(l.last.t)} · ${l.last.ok ? 'OK' : 'échec'} · ${l.last.ms} ms` : 'jamais', src: l.last?.msg ?? 'pas encore vérifiée' },
        { k: 'Depuis', v: day(l.since), src: `état « ${l.status} »` },
        { k: 'Disponibilité', v: [u1, u30, u365].map((u, k) => `${['24 h', '30 j', '1 an'][k]} : ${u.pct !== undefined ? `${u.pct.toLocaleString('fr-FR')} %` : '—'}`).join(' · '), src: 'historique gardé jour par jour' },
        { k: 'Temps de réponse', v: u1.avgMs !== undefined ? `${u1.avgMs} ms en moyenne (24 h)` : '—', src: recent.length ? `derniers : ${recent.slice(-8).map((b) => (b.ok ? b.ms : '✗')).join(' · ')}` : '' },
        { k: 'Pannes', v: `${u30.downs} sur 30 jours`, src: `alerte après ${m.retries} échec(s) d'affilée` },
      ],
      list: { title: 'Derniers événements', items: u30.events.slice(0, 10).map((e) => ({ text: `${e.status === 'panne' ? '❌ panne' : e.status === 'retour' ? '✅ retour' : e.status} · ${e.msg}`, meta: day(e.t), tone: e.status === 'panne' ? 'mauvais' as const : e.status === 'retour' ? 'bon' as const : undefined })) },
      actions: [{ action: 'verifier', label: 'Vérifier maintenant', input: { nom: m.name }, primary: true }, { action: m.paused ? 'reprendre' : 'pause', label: m.paused ? 'Reprendre' : 'Mettre en pause', input: { nom: m.name } }, { action: 'retirer', label: 'Retirer', input: { nom: m.name } }],
    };
  }
  return { nodes, edges, details };
}

// ---------------- Liens automatiques : ce que les autres applis apportent ----------------
/** Les sondes qu'Odin propose tout seul : la box, Internet, son DNS, son VPN, les sites suivis par Iðunn. */
async function autoMonitors(ctx: ModCtx): Promise<Array<Partial<Monitor> & { name: string; kind: Kind; target: string; source: string }>> {
  const out: Array<Partial<Monitor> & { name: string; kind: Kind; target: string; source: string }> = [];
  const gw = /default via (\d+\.\d+\.\d+\.\d+)/.exec((await ctx.run('ip', ['route', 'show', 'default'], { timeoutMs: 3000 }).catch(() => ({ out: '' }))).out)?.[1];
  if (gw) out.push({ name: 'Box', kind: 'ping', target: gw, group: 'Maison', source: 'Odin', level: 'critique' });
  out.push({ name: 'Internet', kind: 'http', target: 'https://www.google.com/generate_204', status: '204', group: 'Internet', source: 'Odin' });
  if (ctx.modules().some((m) => m.id === 'vidarr')) out.push({ name: 'DNS d\'Odin', kind: 'odin', target: 'vidarr', group: 'Odin', source: 'Víðarr' });
  if (ctx.modules().some((m) => m.id === 'gjoll')) out.push({ name: 'VPN d\'Odin', kind: 'odin', target: 'gjoll', group: 'Odin', source: 'Gjöll' });
  const r = await ctx.call('idunn', 'sites', {}, 'surveiller les sites suivis').catch(() => undefined);
  for (const x of ((r?.data as Array<{ name: string; url: string }> | undefined) ?? [])) out.push({ name: `Site ${x.name}`, kind: 'http', target: x.url, group: 'Sites', source: 'Iðunn', public: true });
  return out;
}
function newMonitor(p: Partial<Monitor> & { name: string; kind: Kind; target: string }): Monitor {
  return { id: randomBytes(6).toString('hex'), every: p.kind === 'push' ? 300 : 60, retries: 2, timeoutMs: 10_000, group: p.kind === 'http' ? 'Sites' : 'Maison', ...p, ...(p.kind === 'push' ? { token: p.token ?? randomBytes(16).toString('hex') } : {}) };
}

const byName = (ctx: ModCtx, n: unknown): Monitor => { const x = s(n).trim().toLowerCase(), m = list(ctx).find((y) => y.name.toLowerCase() === x) ?? list(ctx).find((y) => y.name.toLowerCase().includes(x)); if (!m) throw new Error(`sonde « ${s(n)} » introuvable`); return m; };
const ADD: Param[] = [
  { key: 'nom', label: 'Nom', kind: 'text', required: true },
  { key: 'genre', label: 'Genre', kind: 'select', options: ['http', 'tcp', 'ping', 'dns', 'push', 'odin', 'snmp', 'scenario', 'commande'], default: 'http', help: 'http : un site ; tcp : un port (192.168.1.10:22) ; ping : une machine ; dns : un nom ; push : un programme envoie un signe de vie ; odin : une appli d\'Odin (vidarr, gjoll…)' },
  { key: 'cible', label: 'Cible (adresse, site, machine:port, nom, appli)', kind: 'text', default: '' },
  { key: 'groupe', label: 'Groupe', kind: 'text', default: '' },
  { key: 'secondes', label: 'Vérifier toutes les (secondes)', kind: 'number', default: 60 },
  { key: 'essais', label: 'Échecs avant d\'alerter', kind: 'number', default: 2 },
  { key: 'mot', label: 'Mot attendu dans la page (« !mot » : ne doit pas y être)', kind: 'text', default: '' },
  { key: 'codes', label: 'Codes HTTP acceptés', kind: 'text', default: '200-399' },
  { key: 'attendu', label: 'DNS : réponse attendue (facultatif)', kind: 'text', default: '' },
  { key: 'public', label: 'Sur la page publique d\'état', kind: 'boolean', default: false },
  { key: 'oid', label: 'SNMP : OID ou nom (allume, nom, onduleur.batterie…)', kind: 'text', default: '' },
  { key: 'communaute', label: 'SNMP : communauté', kind: 'text', default: 'public' },
  { key: 'etapes', label: 'Scénario : une page par ligne (adresse | mot attendu | données POST)', kind: 'textarea', default: '' },
  { key: 'depend_de', label: 'Dépend de (sondes, séparées par des virgules)', kind: 'text', default: '' },
];

export const vordr: Module = {
  id: 'vordr', name: 'Vörðr', family: 'Machines',
  what: 'La télésurveillance : sites, machines, ports, DNS, certificats, programmes et applis d\'Odin vérifiés en continu, avec l\'historique et une page d\'état à partager.',
  does: ['sondes HTTP(S) (codes acceptés, mot attendu ou interdit), port TCP, ping, DNS (réponse attendue), signe de vie (push) et applis d\'Odin', 'rythme, nombre d\'échecs avant d\'alerter, délai, heures de maintenance, pause', 'certificats HTTPS : alerte avant l\'expiration', 'alerte de panne et de retour, avec la cause probable (box, Internet, autres pannes) expliquée par Odin', 'disponibilité sur 24 h, 30 jours et un an, temps de réponse, journal des pannes, gardés jour par jour', 'graphe : Odin, les groupes, les machines et leurs sondes, une fiche par point', 'page publique d\'état à partager (sans les adresses)', 'sondes ajoutées toutes seules : la box, Internet, le DNS et le VPN d\'Odin, les sites suivis par Iðunn', 'SNMP (box, switch, imprimante, onduleur, NAS), scénarios web en plusieurs pages, greffons Nagios / Centreon', 'déclencheurs sur toutes les mesures d\'Odin (moyenne, min, max, variation, pas de données), 5 gravités', 'problèmes : prise en main, commentaires, escalade si personne ne s\'en occupe, dépendances (symptômes sans alerte en double)', 'engagement de disponibilité (SLA) : objectif, temps de panne permis'],
  from: ['Uptime Kuma', 'Gatus', 'Statping-ng', 'Zabbix', 'Centreon', 'Nagios'], upstream: ['louislam/uptime-kuma', 'TwiN/gatus', 'statping-ng/statping-ng', 'zabbix/zabbix', 'centreon/centreon', 'NagiosEnterprises/nagioscore'],
  words: ['télésurveillance', 'telesurveillance', 'uptime', 'est-ce que le site marche', 'service en panne', 'serveur en panne', 'site en panne', 'sonde', 'sondes', 'disponibilité des services', 'page d\'état', 'status page'],
  actions: [
    { id: 'ajouter', label: 'Ajouter une sonde', what: 'Surveiller un site, une machine, un port, un nom, un programme ou une appli d\'Odin', params: ADD, words: ['surveille', 'ajoute une sonde'], run: async (ctx, i) => {
      const kind = (['http', 'tcp', 'ping', 'dns', 'push', 'odin', 'snmp', 'scenario', 'commande'].includes(s(i.genre)) ? s(i.genre) : 'http') as Kind, name = s(i.nom).trim().slice(0, 60);
      let target = s(i.cible).trim();
      if (!name) throw new Error('donne un nom');
      if (list(ctx).some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error('une sonde porte déjà ce nom');
      if (kind === 'http') { if (!/^https?:\/\//i.test(target)) target = `https://${target}`; try { new URL(target); } catch { throw new Error('adresse de site invalide'); } }
      if (kind === 'tcp') splitHostPort(target);
      if ((kind === 'ping' || kind === 'dns') && !/^[\w.:-]+$/.test(target)) throw new Error('machine ou nom invalide');
      if (kind === 'odin' && !ctx.modules().some((m) => m.id === target)) throw new Error(`appli d'Odin inconnue : ${target}`);
      if (kind === 'snmp' && !/^[\w.:-]+$/.test(target)) throw new Error('appareil invalide (adresse ou nom)');
      const steps: Step[] = kind === 'scenario' ? s(i.etapes).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([url, contains, body]) => { if (!/^https?:\/\//.test(url)) throw new Error(`adresse invalide : ${url}`); return { url, ...(contains ? { contains } : {}), ...(body ? { body } : {}) }; }) : [];
      if (kind === 'scenario' && !steps.length) throw new Error('donne au moins une page (une par ligne)');
      if (kind === 'scenario') target = steps[0].url;
      const cmd = kind === 'commande' ? target.split(/\s+/) : [];
      if (kind === 'commande' && !/^check_[\w-]+$/.test(cmd[0] ?? '')) throw new Error('greffon Nagios attendu (ex. check_disk -w 20% -c 10% -p /)');
      const deps = s(i.depend_de).split(',').map((x) => x.trim()).filter(Boolean).map((n) => { const d = list(ctx).find((y) => y.name.toLowerCase() === n.toLowerCase()); if (!d) throw new Error(`sonde « ${n} » introuvable (dépendance)`); return d.id; });
      const every = Math.max(20, Math.min(86400, Number(i.secondes) || 60)), retries = Math.max(1, Math.min(10, Number(i.essais) || 2));
      const m = newMonitor({ name, kind, target: kind === 'push' ? '' : target, every, retries, group: s(i.groupe).trim() || undefined, keyword: s(i.mot).trim() || undefined, status: s(i.codes).trim() || undefined, expect: s(i.attendu).trim() || undefined, public: i.public === true, ...(kind === 'snmp' ? { oid: s(i.oid).trim() || 'allume', community: s(i.communaute).trim() || 'public' } : {}), ...(steps.length ? { steps } : {}), ...(kind === 'commande' ? { command: cmd[0], args: cmd.slice(1) } : {}), ...(deps.length ? { dependsOn: deps } : {}) });
      if (!m.group) m.group = kind === 'http' ? 'Sites' : kind === 'odin' ? 'Odin' : 'Maison';
      save(ctx, [...list(ctx), m]);
      const b = kind === 'push' ? undefined : await runOne(ctx, m);
      return { text: `👁 ${name} surveillé (${kind}${m.target ? ` ${m.target}` : ''}, toutes les ${every} s, alerte après ${retries} échec(s)).${b ? ` Premier essai : ${b.ok ? 'OK' : 'échec'} — ${b.msg}.` : `\nAdresse à appeler par le programme (garde-la secrète) : /v/${m.token}`}`, data: { id: m.id, token: m.token } };
    }, undo: (i) => ({ action: 'retirer', input: { nom: i.nom }, label: 'Retirer la sonde' }) },
    { id: 'retirer', label: 'Retirer une sonde', what: 'Ne plus surveiller (l\'historique est gardé)', quick: false, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }], run: (ctx, i) => { const m = byName(ctx, i.nom); save(ctx, list(ctx).filter((x) => x.id !== m.id)); live.delete(m.id); return { text: `🗑 ${m.name} n'est plus surveillé.` }; } },
    { id: 'verifier', label: 'Vérifier maintenant', what: 'Une sonde, ou toutes', params: [{ key: 'nom', label: 'Sonde (vide : toutes)', kind: 'text', default: '' }], read: true, run: async (ctx, i) => {
      const ms = s(i.nom).trim() ? [byName(ctx, i.nom)] : list(ctx);
      const res = await Promise.all(ms.map(async (m) => ({ m, b: await runOne(ctx, m) })));
      return { text: res.map(({ m, b }) => `${b.ok ? '✅' : '❌'} ${m.name} : ${b.msg}${b.ok && b.ms ? ` (${b.ms} ms)` : ''}`).join('\n') || 'Aucune sonde.' };
    } },
    { id: 'pause', label: 'Mettre en pause', what: 'Plus de vérification ni d\'alerte', quick: false, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }], run: (ctx, i) => { const m = byName(ctx, i.nom); save(ctx, list(ctx).map((x) => (x.id === m.id ? { ...x, paused: true } : x))); liveOf(m.id).status = 'en pause'; return { text: `⏸ ${m.name} en pause.` }; }, undo: (i) => ({ action: 'reprendre', input: { nom: i.nom }, label: 'Reprendre' }) },
    { id: 'reprendre', label: 'Reprendre', what: 'La sonde repart', quick: false, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }], run: async (ctx, i) => { const m = byName(ctx, i.nom); const n = { ...m, paused: false }; save(ctx, list(ctx).map((x) => (x.id === m.id ? n : x))); const l = liveOf(m.id); l.status = 'en attente'; l.fails = 0; const b = await runOne(ctx, n); return { text: `▶ ${m.name} reprend : ${b.ok ? 'OK' : 'échec'} — ${b.msg}.` }; } },
    { id: 'maintenance', label: 'Heures de maintenance', what: 'Pas d\'alerte pendant ces heures (ex. sauvegarde la nuit)', quick: false, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }, { key: 'jours', label: 'Jours (lun, mar… ou « tous »)', kind: 'text', default: 'tous' }, { key: 'de', label: 'De (HH:MM)', kind: 'text', default: '02:00' }, { key: 'a', label: 'À (HH:MM)', kind: 'text', default: '04:00' }, { key: 'aucune', label: 'Retirer la maintenance', kind: 'boolean', default: false }], run: (ctx, i) => {
      const m = byName(ctx, i.nom), J = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
      if (i.aucune === true) { save(ctx, list(ctx).map((x) => (x.id === m.id ? { ...x, maintenance: undefined } : x))); return { text: `🛠 ${m.name} : plus de maintenance.` }; }
      const days = !s(i.jours).trim() || s(i.jours).trim() === 'tous' ? [0, 1, 2, 3, 4, 5, 6] : s(i.jours).split(/[,\s]+/).filter(Boolean).map((x) => J.indexOf(x.slice(0, 3).toLowerCase()));
      const hm = (x: string) => { const r = /^(\d{1,2}):(\d{2})$/.exec(x.trim()); if (!r || Number(r[1]) > 23 || Number(r[2]) > 59) throw new Error('heures sous la forme 02:00'); return `${r[1].padStart(2, '0')}:${r[2]}`; };
      if (days.some((x) => x < 0)) throw new Error('jours : lun, mar, mer, jeu, ven, sam, dim');
      const mt = { days, from: hm(s(i.de)), to: hm(s(i.a)) };
      save(ctx, list(ctx).map((x) => (x.id === m.id ? { ...x, maintenance: mt } : x)));
      return { text: `🛠 ${m.name} : maintenance ${mt.from} → ${mt.to} (pas d'alerte pendant ces heures).` };
    } },
    { id: 'historique', label: 'Historique', what: 'Disponibilité et pannes d\'une sonde sur 24 h, 30 jours, un an', read: true, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }], run: (ctx, i) => {
      const m = byName(ctx, i.nom), u = [1, 30, 365].map((d) => uptime(ctx.dir, m.id, d));
      return { text: `${m.name} : ${u.map((x, k) => `${['24 h', '30 j', '1 an'][k]} ${x.pct ?? '—'} %`).join(' · ')}${u[0].avgMs !== undefined ? ` · ${u[0].avgMs} ms` : ''}\n${u[2].events.slice(0, 15).map((e) => `- ${new Date(e.t).toLocaleString('fr-FR')} ${e.status} : ${e.msg}`).join('\n') || 'Aucune panne.'}` };
    } },
    { id: 'liens', label: 'Sondes automatiques', what: 'Ajoute ce que les autres applis apportent : box, Internet, DNS et VPN d\'Odin, sites d\'Iðunn', run: async (ctx) => {
      const have = list(ctx), add = (await autoMonitors(ctx)).filter((a) => !have.some((m) => m.name === a.name || (m.kind === a.kind && m.target === a.target)));
      const made = add.map((a) => newMonitor(a)); save(ctx, [...have, ...made]);
      await Promise.all(made.map((m) => runOne(ctx, m)));
      return { text: made.length ? `🔗 ${made.length} sonde(s) ajoutée(s) : ${made.map((m) => `${m.name} (${m.source})`).join(', ')}.` : 'Rien de nouveau : tout ce que les autres applis apportent est déjà surveillé.' };
    } },
    { id: 'declencheur', label: 'Ajouter un déclencheur', what: 'Un problème quand une mesure d\'Odin passe un seuil (mémoire, disque, temps de réponse, température…)', quick: false, words: ['déclencheur', 'seuil d\'alerte', 'alerte si'], params: [
      { key: 'nom', label: 'Nom du problème', kind: 'text', required: true },
      { key: 'serie', label: 'Mesure (ex. eir.mem, vordr.temps.<id>, eir.fs./)', kind: 'text', required: true },
      { key: 'fonction', label: 'Calcul', kind: 'select', options: ['avg', 'min', 'max', 'last', 'delta', 'count'], default: 'avg' },
      { key: 'minutes', label: 'Sur (minutes)', kind: 'number', default: 5 },
      { key: 'operateur', label: 'Comparaison', kind: 'select', options: ['>', '>=', '<', '<=', '==', '!='], default: '>' },
      { key: 'valeur', label: 'Seuil', kind: 'number', required: true },
      { key: 'retour', label: 'Fini quand elle repasse (vide : même seuil)', kind: 'text', default: '' },
      { key: 'gravite', label: 'Gravité', kind: 'select', options: ['info', 'avertissement', 'moyen', 'haut', 'desastre'], default: 'moyen' },
      { key: 'sans_donnees', label: 'Problème aussi si plus aucune valeur', kind: 'boolean', default: false },
      { key: 'depend_de', label: 'Dépend de (déclencheurs ou sondes, virgules)', kind: 'text', default: '' },
      { key: 'conseils', label: 'Quoi faire (une étape par ligne)', kind: 'textarea', default: '' },
    ], run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 80), serie = s(i.serie).trim(), value = Number(i.valeur), mins = Math.max(1, Math.min(1440, Number(i.minutes) || 5));
      if (!name) throw new Error('donne un nom'); if (!/^[a-z0-9][\w.:/-]{0,120}$/i.test(serie)) throw new Error('mesure invalide');
      if (!Number.isFinite(value)) throw new Error('seuil invalide');
      const fn = (['avg', 'min', 'max', 'last', 'delta', 'count'].includes(s(i.fonction)) ? s(i.fonction) : 'avg') as Fn, op = (['>', '>=', '<', '<=', '==', '!='].includes(s(i.operateur)) ? s(i.operateur) : '>') as Op;
      const sev = (Object.keys(SEV).includes(s(i.gravite)) ? s(i.gravite) : 'moyen') as Severity, rec = s(i.retour).trim() === '' ? undefined : Number(String(i.retour).replace(',', '.'));
      if (rec !== undefined && !Number.isFinite(rec)) throw new Error('valeur de retour invalide');
      const deps = s(i.depend_de).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).map((n) => { const d = triggers(ctx).find((x) => x.name.toLowerCase() === n)?.id ?? list(ctx).find((x) => x.name.toLowerCase() === n)?.id; if (!d) throw new Error(`« ${n} » introuvable (dépendance)`); return d; });
      if (triggers(ctx).some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error('un déclencheur porte déjà ce nom');
      const tr: Trigger = { id: randomBytes(5).toString('hex'), name, serie, fn, windowMin: mins, op, value, ...(rec !== undefined ? { recovery: rec } : {}), severity: sev, enabled: true, ...(deps.length ? { dependsOn: deps } : {}), ...(i.sans_donnees === true ? { nodata: 1 } : {}), ...(s(i.conseils).trim() ? { steps: s(i.conseils).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8) } : {}) };
      ctx.saveSettings({ triggers: [...triggers(ctx), tr] });
      const known = metrics()?.names().includes(serie);
      return { text: `⚡ ${describeTrigger(tr)}${known === false ? `\n⚠ Aucune valeur de « ${serie} » pour l'instant : vérifie le nom (Eir → « mesures » liste les séries).` : ''}`, data: { id: tr.id } };
    }, undo: (i) => ({ action: 'retirer_declencheur', input: { nom: i.nom }, label: 'Retirer le déclencheur' }) },
    { id: 'retirer_declencheur', label: 'Retirer un déclencheur', what: 'Ses problèmes ouverts sont fermés', quick: false, params: [{ key: 'nom', label: 'Déclencheur', kind: 'text', required: true }], run: (ctx, i) => {
      const t = triggers(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!t) throw new Error('déclencheur introuvable');
      ctx.saveSettings({ triggers: triggers(ctx).filter((x) => x.id !== t.id) }); closeProblem(ctx, 'declencheur', t.id, Date.now());
      return { text: `🗑 Déclencheur « ${t.name} » retiré.` };
    } },
    { id: 'activer_declencheur', label: 'Activer / couper un déclencheur', what: 'Sans le retirer', quick: false, params: [{ key: 'nom', label: 'Déclencheur', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
      const t = triggers(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!t) throw new Error('déclencheur introuvable');
      ctx.saveSettings({ triggers: triggers(ctx).map((x) => (x.id === t.id ? { ...x, enabled: i.actif !== false } : x)) }); if (i.actif === false) closeProblem(ctx, 'declencheur', t.id, Date.now());
      return { text: `${i.actif === false ? '⚪ coupé' : '⚡ actif'} : ${t.name}.` };
    } },
    { id: 'problemes', label: 'Problèmes', what: 'Les problèmes ouverts (et les derniers résolus), du plus grave au moins grave', read: true, words: ['problèmes en cours', 'quels problèmes', 'incidents'], params: [{ key: 'resolus', label: 'Montrer aussi les résolus', kind: 'boolean', default: false }], run: (ctx, i) => {
      const now = Date.now(), all = problems(ctx), open = all.filter((p) => !p.end).sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.start - b.start), done = i.resolus === true ? all.filter((p) => p.end).slice(-15).reverse() : [];
      const line = (p: Problem) => `- [${SEV[p.severity].label}] ${p.name}${p.value !== undefined ? ` (${p.value})` : ''} · ${p.end ? `résolu après ${dur(p.end - p.start)}` : `depuis ${dur(now - p.start)}`}${p.ack ? ` · pris en main par ${p.ack.by}` : ''}${p.symptomOf ? ' · symptôme' : ''}${p.comments.length ? ` · ${p.comments.length} commentaire(s)` : ''}`;
      return { text: `${open.length ? `${open.length} problème(s) ouvert(s) :\n${open.map(line).join('\n')}` : '✅ Aucun problème ouvert.'}${done.length ? `\nRésolus :\n${done.map(line).join('\n')}` : ''}`, data: { open: open.map((p) => ({ id: p.id, name: p.name, severity: p.severity })) } };
    } },
    { id: 'prendre_en_main', label: 'Je m\'en occupe', what: 'Prendre un problème en main (plus d\'escalade), avec un mot', quick: false, params: [{ key: 'id', label: 'Problème (numéro ou nom)', kind: 'text', required: true }, { key: 'mot', label: 'Commentaire', kind: 'text', default: '' }], run: (ctx, i) => {
      const l = problems(ctx), q = s(i.id).trim().toLowerCase(), p = l.find((x) => !x.end && (x.id === q || x.name.toLowerCase().includes(q))); if (!p) throw new Error('problème ouvert introuvable');
      p.ack = { by: s(i.par).trim().slice(0, 40) || 'toi', at: Date.now(), ...(s(i.mot).trim() ? { comment: s(i.mot).trim().slice(0, 300) } : {}) };
      if (p.ack.comment) p.comments.push({ by: p.ack.by, at: p.ack.at, text: p.ack.comment });
      saveProblems(ctx, l); return { text: `🙋 « ${p.name} » pris en main.` };
    } },
    { id: 'commenter', label: 'Commenter un problème', what: 'Garder une trace de ce qui a été fait', quick: false, params: [{ key: 'id', label: 'Problème (numéro ou nom)', kind: 'text', required: true }, { key: 'texte', label: 'Commentaire', kind: 'textarea', required: true }], run: (ctx, i) => {
      const l = problems(ctx), q = s(i.id).trim().toLowerCase(), p = l.find((x) => x.id === q || x.name.toLowerCase().includes(q)); if (!p) throw new Error('problème introuvable');
      const text = s(i.texte).trim().slice(0, 1000); if (!text) throw new Error('commentaire vide');
      p.comments.push({ by: s(i.par).trim().slice(0, 40) || 'toi', at: Date.now(), text }); saveProblems(ctx, l); return { text: `💬 Commentaire ajouté à « ${p.name} ».` };
    } },
    { id: 'dependance', label: 'Dépendance entre sondes', what: 'Si la première est en panne, la seconde n\'alerte pas (rangée comme symptôme)', quick: false, params: [{ key: 'nom', label: 'Sonde', kind: 'text', required: true }, { key: 'depend_de', label: 'Dépend de (sondes, virgules ; vide : aucune)', kind: 'text', default: '' }], run: (ctx, i) => {
      const m = byName(ctx, i.nom), deps = s(i.depend_de).split(',').map((x) => x.trim()).filter(Boolean).map((n) => byName(ctx, n));
      if (deps.some((d) => d.id === m.id)) throw new Error('une sonde ne peut pas dépendre d\'elle-même');
      save(ctx, list(ctx).map((x) => (x.id === m.id ? { ...x, dependsOn: deps.length ? deps.map((d) => d.id) : undefined } : x)));
      return { text: deps.length ? `🔗 ${m.name} dépend de ${deps.map((d) => d.name).join(', ')}.` : `🔗 ${m.name} : plus de dépendance.` };
    } },
    { id: 'sla', label: 'Engagement de disponibilité (SLA)', what: 'Disponibilité du mois de chaque sonde comparée à l\'objectif, avec le temps de panne encore permis', read: true, words: ['sla', 'engagement de disponibilité', 'objectif de disponibilité'], params: [{ key: 'objectif', label: 'Objectif (%)', kind: 'number', default: 99.9 }, { key: 'jours', label: 'Sur (jours)', kind: 'number', default: 30 }], run: (ctx, i) => {
      const target = Math.max(50, Math.min(100, Number(i.objectif) || 99.9)), days = Math.max(1, Math.min(365, Number(i.jours) || 30)), r = slaRows(ctx, target, days);
      if (i.objectif !== undefined) ctx.saveSettings({ slaTarget: target });
      return { text: r.length ? `Objectif ${target} % sur ${days} j :\n${r.map((x) => `${x.ok === false ? '❌' : x.ok ? '✅' : '·'} ${x.name} : ${x.pct ?? '—'} %${x.budgetMin !== undefined ? ` · panne ${x.downMin} min / ${x.budgetMin} min permises` : ''}`).join('\n')}` : 'Aucune sonde.' };
    } },
    { id: 'page_publique', label: 'Page publique d\'état', what: 'Une adresse à partager qui montre l\'état des sondes choisies (sans leurs adresses)', quick: false, params: [{ key: 'titre', label: 'Titre', kind: 'text', default: 'État des services' }, { key: 'active', label: 'Active', kind: 'boolean', default: true }], run: (ctx, i) => {
      if (i.active === false) { ctx.saveSettings({ publicSlug: '' }); return { text: '⚪ Page publique coupée.' }; }
      const slug = s(ctx.settings.publicSlug) || randomBytes(9).toString('hex'); ctx.saveSettings({ publicSlug: slug, publicTitle: s(i.titre).slice(0, 80) || 'État des services' });
      return { text: `🌐 Page publique : /etat/${slug} (sur l'adresse de l'interface d'Odin). Elle montre ${list(ctx).filter((m) => m.public).length} sonde(s) cochées « page publique ».` };
    } },
  ],
  async view(ctx) {
    const ms = list(ctx), now = Date.now(), down = ms.filter((m) => liveOf(m.id).status === 'en panne');
    const u30 = ms.map((m) => uptime(ctx.dir, m.id, 30, now).pct).filter((x): x is number => x !== undefined);
    const openP = problems(ctx).filter((p) => !p.end).sort((a, b) => SEV[b.severity].rank - SEV[a.severity].rank || a.start - b.start), trs = triggers(ctx), slaT = Number(ctx.settings.slaTarget) || 99.9;
    return {
      subtitle: ms.length ? `${ms.length} sonde(s) · ${down.length ? `${down.length} en panne` : ms.every((m) => liveOf(m.id).status === 'en ligne' || m.paused) ? 'tout répond' : `${ms.filter((m) => liveOf(m.id).status === 'en attente').length} en attente de confirmation`}` : 'Aucune sonde : « Sondes automatiques » ajoute la box, Internet, le DNS et le VPN d\'Odin, et tes sites.',
      kpis: [
        { label: 'En ligne', value: `${ms.filter((m) => liveOf(m.id).status === 'en ligne').length} / ${ms.length}`, tone: down.length ? 'mauvais' : 'bon' },
        { label: 'En panne', value: String(down.length), tone: down.length ? 'mauvais' : 'bon' },
        { label: 'Disponibilité (30 j)', value: u30.length ? `${(Math.round(u30.reduce((a, b) => a + b, 0) / u30.length * 100) / 100).toLocaleString('fr-FR')} %` : '—' },
        { label: 'Problèmes', value: String(openP.filter((p) => !p.symptomOf).length), tone: openP.some((p) => SEV[p.severity].rank >= 3) ? 'mauvais' : openP.length ? 'attention' : 'bon' },
        { label: 'Page publique', value: s(ctx.settings.publicSlug) ? 'active' : 'coupée' },
      ],
      sections: [
        ...(openP.length || trs.length ? [{ kind: 'table' as const, title: 'Problèmes', columns: ['Gravité', 'Problème', 'Depuis', 'Valeur', 'Suivi'], empty: '✅ Aucun problème ouvert.', rows: openP.map((p) => ({ cells: [SEV[p.severity].label, `${p.name}${p.symptomOf ? ' (symptôme)' : ''}`, dur(now - p.start), p.value !== undefined ? String(p.value) : '—', p.ack ? `pris en main (${p.ack.by})${p.comments.length ? ` · ${p.comments.length} mot(s)` : ''}` : 'personne'], tone: (SEV[p.severity].rank >= 3 ? 'mauvais' : SEV[p.severity].rank >= 1 ? 'attention' : undefined) as Tone | undefined, actions: p.ack ? [{ action: 'commenter', label: 'Commenter', input: { id: p.id } }] : [{ action: 'prendre_en_main', label: 'Je m\'en occupe', input: { id: p.id } }, { action: 'commenter', label: 'Commenter', input: { id: p.id } }] })) }] : []),
        { kind: 'graph', title: 'Graphe de la surveillance', ...monitorGraph(ctx, ms, now), empty: 'Aucune sonde : clique « Sondes automatiques », ou ajoute un site à droite.', legend: [['#57C98A', 'en ligne'], ['#EE6A55', 'en panne'], ['#F0A040', 'en attente'], ['#4F9DDE', 'maintenance / Odin'], ['#7d8791', 'en pause']] },
        { kind: 'table', title: 'Sondes', columns: ['Sonde', 'Genre', 'Cible', 'État', '24 h', '30 j', 'Temps'], empty: 'Aucune sonde.', rows: ms.map((m) => { const l = liveOf(m.id), a = uptime(ctx.dir, m.id, 1, now), b = uptime(ctx.dir, m.id, 30, now); return { cells: [m.name, m.kind, m.kind === 'push' ? '(secrète)' : m.target, l.status, a.pct !== undefined ? `${a.pct} %` : '—', b.pct !== undefined ? `${b.pct} %` : '—', l.last?.ok ? `${l.last.ms} ms` : '—'], tone: TONE[l.status] === 'mauvais' ? 'mauvais' : TONE[l.status] === 'bon' ? 'bon' : undefined, actions: [{ action: 'verifier', label: 'Vérifier', input: { nom: m.name } }, { action: m.paused ? 'reprendre' : 'pause', label: m.paused ? 'Reprendre' : 'Pause', input: { nom: m.name } }] }; }) },
        ...(trs.length ? [{ kind: 'table' as const, title: 'Déclencheurs', columns: ['Nom', 'Règle', 'Gravité', 'Valeur', 'État'], empty: '', rows: trs.map((t) => { const v = metrics()?.fn(t.serie, t.fn, t.windowMin * 60_000), on = openP.some((p) => p.source === 'declencheur' && p.ref === t.id); return { cells: [t.name, describeTrigger(t), SEV[t.severity].label, v === undefined ? '—' : String(Math.round(v * 100) / 100), !t.enabled ? 'coupé' : on ? 'en problème' : 'ok'], tone: (on ? 'mauvais' : t.enabled ? 'bon' : undefined) as Tone | undefined, actions: [{ action: 'activer_declencheur', label: t.enabled ? 'Couper' : 'Activer', input: { nom: t.name, actif: !t.enabled } }, { action: 'retirer_declencheur', label: 'Retirer', input: { nom: t.name } }] }; }) }] : []),
        ...(ms.length ? [{ kind: 'table' as const, title: `Engagement de disponibilité (objectif ${slaT} %, 30 j)`, columns: ['Sonde', 'Disponibilité', 'Panne', 'Permis', 'Tenu'], empty: '', rows: slaRows(ctx, slaT, 30, now).filter((x) => x.pct !== undefined).map((x) => ({ cells: [x.name, `${x.pct} %`, `${x.downMin} min`, `${x.budgetMin ?? '—'} min`, x.ok ? 'oui' : 'non'], tone: (x.ok ? 'bon' : 'mauvais') as Tone })) }] : []),
      ],
      side: [{ kind: 'form', title: 'Ajouter une sonde', action: 'ajouter', submit: 'Surveiller', params: ADD }, { kind: 'form', title: 'Ajouter un déclencheur', action: 'declencheur', submit: 'Créer', params: vordr.actions.find((a) => a.id === 'declencheur')!.params! }],
    };
  },
  start(ctx) {
    appCtx = ctx;
    // Première fois : les sondes que les autres applis apportent (liens automatiques).
    if (ctx.settings.monitors === undefined) void vordr.actions.find((a) => a.id === 'liens')!.run(ctx, {});
  },
  stop() { appCtx = undefined; },
  // Toutes les 20 s : chaque sonde dont le tour est venu est vérifiée (jamais deux fois en même temps).
  watch: { every: 20, async run(ctx) {
    appCtx = ctx; const now = Date.now();
    await Promise.all(list(ctx).filter((m) => !m.paused && !running.has(m.id) && now - (liveOf(m.id).last?.t ?? 0) >= m.every * 1000 - 1000).map(async (m) => { running.add(m.id); try { await runOne(ctx, m, now); } finally { running.delete(m.id); } }));
    // Chaque minute : les déclencheurs sur les mesures et l'escalade des problèmes.
    if (now - lastEval >= 59_000) { lastEval = now; try { evalTriggers(ctx, now); } catch { /* mesures illisibles */ } }
  } },
};
// Pour les essais : remise à zéro de la mémoire.
let lastEval = 0;
export function resetVordr(): void { beats.clear(); live.clear(); running.clear(); dayCache.clear(); lastEval = 0; }
