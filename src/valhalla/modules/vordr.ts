// Vörðr — la surveillance d'Odin (télésurveillance des services) : sites, machines, ports, DNS, certificats,
// battements envoyés par d'autres programmes, et les applis d'Odin elles-mêmes. Chaque sonde a son rythme,
// ses essais avant d'alerter, ses heures de maintenance ; l'historique (disponibilité, temps de réponse,
// pannes) est gardé jour par jour pour toujours ; une page publique d'état peut être partagée.
// Fonctions reprises (réécrites) d'Uptime Kuma, Gatus et Statping.
// (Vörðr : l'esprit gardien qui veille sur chaque maison et chaque personne.)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export type Kind = 'http' | 'tcp' | 'ping' | 'dns' | 'push' | 'odin';
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
  if (inMaint) { if (l.status !== 'maintenance') { l.status = 'maintenance'; l.since = now; } recordBeat(ctx, m, b); return b; }
  if (b.ok) {
    if (l.status === 'en panne') {
      const mins = Math.max(1, Math.round((now - (l.downAt ?? now)) / 60_000));
      ctx.alert({ level: 'info', title: `✅ ${m.name} répond de nouveau`, detail: `Après ${mins} min de panne. ${b.msg}.`, key: `vordr-retour-${m.id}-${now}` });
      ctx.emit('retour', { nom: m.name, cible: m.target, minutes: mins });
      recordBeat(ctx, m, b, 'retour');
    } else recordBeat(ctx, m, b, l.status === 'en attente' ? 'en ligne' : undefined);
    if (l.status !== 'en ligne') { l.status = 'en ligne'; l.since = now; }
    l.fails = 0;
  } else {
    l.fails++;
    if (l.fails >= Math.max(1, m.retries) && l.status !== 'en panne') {
      l.status = 'en panne'; l.since = now; l.downAt = now;
      recordBeat(ctx, m, b, 'panne');
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
  { key: 'genre', label: 'Genre', kind: 'select', options: ['http', 'tcp', 'ping', 'dns', 'push', 'odin'], default: 'http', help: 'http : un site ; tcp : un port (192.168.1.10:22) ; ping : une machine ; dns : un nom ; push : un programme envoie un signe de vie ; odin : une appli d\'Odin (vidarr, gjoll…)' },
  { key: 'cible', label: 'Cible (adresse, site, machine:port, nom, appli)', kind: 'text', default: '' },
  { key: 'groupe', label: 'Groupe', kind: 'text', default: '' },
  { key: 'secondes', label: 'Vérifier toutes les (secondes)', kind: 'number', default: 60 },
  { key: 'essais', label: 'Échecs avant d\'alerter', kind: 'number', default: 2 },
  { key: 'mot', label: 'Mot attendu dans la page (« !mot » : ne doit pas y être)', kind: 'text', default: '' },
  { key: 'codes', label: 'Codes HTTP acceptés', kind: 'text', default: '200-399' },
  { key: 'attendu', label: 'DNS : réponse attendue (facultatif)', kind: 'text', default: '' },
  { key: 'public', label: 'Sur la page publique d\'état', kind: 'boolean', default: false },
];

export const vordr: Module = {
  id: 'vordr', name: 'Vörðr', family: 'Machines',
  what: 'La télésurveillance : sites, machines, ports, DNS, certificats, programmes et applis d\'Odin vérifiés en continu, avec l\'historique et une page d\'état à partager.',
  does: ['sondes HTTP(S) (codes acceptés, mot attendu ou interdit), port TCP, ping, DNS (réponse attendue), signe de vie (push) et applis d\'Odin', 'rythme, nombre d\'échecs avant d\'alerter, délai, heures de maintenance, pause', 'certificats HTTPS : alerte avant l\'expiration', 'alerte de panne et de retour, avec la cause probable (box, Internet, autres pannes) expliquée par Odin', 'disponibilité sur 24 h, 30 jours et un an, temps de réponse, journal des pannes, gardés jour par jour', 'graphe : Odin, les groupes, les machines et leurs sondes, une fiche par point', 'page publique d\'état à partager (sans les adresses)', 'sondes ajoutées toutes seules : la box, Internet, le DNS et le VPN d\'Odin, les sites suivis par Iðunn'],
  from: ['Uptime Kuma', 'Gatus', 'Statping-ng'], upstream: ['louislam/uptime-kuma', 'TwiN/gatus', 'statping-ng/statping-ng'],
  words: ['télésurveillance', 'telesurveillance', 'uptime', 'est-ce que le site marche', 'service en panne', 'serveur en panne', 'site en panne', 'sonde', 'sondes', 'disponibilité des services', 'page d\'état', 'status page'],
  actions: [
    { id: 'ajouter', label: 'Ajouter une sonde', what: 'Surveiller un site, une machine, un port, un nom, un programme ou une appli d\'Odin', params: ADD, words: ['surveille', 'ajoute une sonde'], run: async (ctx, i) => {
      const kind = (['http', 'tcp', 'ping', 'dns', 'push', 'odin'].includes(s(i.genre)) ? s(i.genre) : 'http') as Kind, name = s(i.nom).trim().slice(0, 60);
      let target = s(i.cible).trim();
      if (!name) throw new Error('donne un nom');
      if (list(ctx).some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error('une sonde porte déjà ce nom');
      if (kind === 'http') { if (!/^https?:\/\//i.test(target)) target = `https://${target}`; try { new URL(target); } catch { throw new Error('adresse de site invalide'); } }
      if (kind === 'tcp') splitHostPort(target);
      if ((kind === 'ping' || kind === 'dns') && !/^[\w.:-]+$/.test(target)) throw new Error('machine ou nom invalide');
      if (kind === 'odin' && !ctx.modules().some((m) => m.id === target)) throw new Error(`appli d'Odin inconnue : ${target}`);
      const every = Math.max(20, Math.min(86400, Number(i.secondes) || 60)), retries = Math.max(1, Math.min(10, Number(i.essais) || 2));
      const m = newMonitor({ name, kind, target: kind === 'push' ? '' : target, every, retries, group: s(i.groupe).trim() || undefined, keyword: s(i.mot).trim() || undefined, status: s(i.codes).trim() || undefined, expect: s(i.attendu).trim() || undefined, public: i.public === true });
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
    { id: 'page_publique', label: 'Page publique d\'état', what: 'Une adresse à partager qui montre l\'état des sondes choisies (sans leurs adresses)', quick: false, params: [{ key: 'titre', label: 'Titre', kind: 'text', default: 'État des services' }, { key: 'active', label: 'Active', kind: 'boolean', default: true }], run: (ctx, i) => {
      if (i.active === false) { ctx.saveSettings({ publicSlug: '' }); return { text: '⚪ Page publique coupée.' }; }
      const slug = s(ctx.settings.publicSlug) || randomBytes(9).toString('hex'); ctx.saveSettings({ publicSlug: slug, publicTitle: s(i.titre).slice(0, 80) || 'État des services' });
      return { text: `🌐 Page publique : /etat/${slug} (sur l'adresse de l'interface d'Odin). Elle montre ${list(ctx).filter((m) => m.public).length} sonde(s) cochées « page publique ».` };
    } },
  ],
  async view(ctx) {
    const ms = list(ctx), now = Date.now(), down = ms.filter((m) => liveOf(m.id).status === 'en panne');
    const u30 = ms.map((m) => uptime(ctx.dir, m.id, 30, now).pct).filter((x): x is number => x !== undefined);
    return {
      subtitle: ms.length ? `${ms.length} sonde(s) · ${down.length ? `${down.length} en panne` : ms.every((m) => liveOf(m.id).status === 'en ligne' || m.paused) ? 'tout répond' : `${ms.filter((m) => liveOf(m.id).status === 'en attente').length} en attente de confirmation`}` : 'Aucune sonde : « Sondes automatiques » ajoute la box, Internet, le DNS et le VPN d\'Odin, et tes sites.',
      kpis: [
        { label: 'En ligne', value: `${ms.filter((m) => liveOf(m.id).status === 'en ligne').length} / ${ms.length}`, tone: down.length ? 'mauvais' : 'bon' },
        { label: 'En panne', value: String(down.length), tone: down.length ? 'mauvais' : 'bon' },
        { label: 'Disponibilité (30 j)', value: u30.length ? `${(Math.round(u30.reduce((a, b) => a + b, 0) / u30.length * 100) / 100).toLocaleString('fr-FR')} %` : '—' },
        { label: 'Page publique', value: s(ctx.settings.publicSlug) ? 'active' : 'coupée' },
      ],
      sections: [
        { kind: 'graph', title: 'Graphe de la surveillance', ...monitorGraph(ctx, ms, now), empty: 'Aucune sonde : clique « Sondes automatiques », ou ajoute un site à droite.', legend: [['#57C98A', 'en ligne'], ['#EE6A55', 'en panne'], ['#F0A040', 'en attente'], ['#4F9DDE', 'maintenance / Odin'], ['#7d8791', 'en pause']] },
        { kind: 'table', title: 'Sondes', columns: ['Sonde', 'Genre', 'Cible', 'État', '24 h', '30 j', 'Temps'], empty: 'Aucune sonde.', rows: ms.map((m) => { const l = liveOf(m.id), a = uptime(ctx.dir, m.id, 1, now), b = uptime(ctx.dir, m.id, 30, now); return { cells: [m.name, m.kind, m.kind === 'push' ? '(secrète)' : m.target, l.status, a.pct !== undefined ? `${a.pct} %` : '—', b.pct !== undefined ? `${b.pct} %` : '—', l.last?.ok ? `${l.last.ms} ms` : '—'], tone: TONE[l.status] === 'mauvais' ? 'mauvais' : TONE[l.status] === 'bon' ? 'bon' : undefined, actions: [{ action: 'verifier', label: 'Vérifier', input: { nom: m.name } }, { action: m.paused ? 'reprendre' : 'pause', label: m.paused ? 'Reprendre' : 'Pause', input: { nom: m.name } }] }; }) },
      ],
      side: [{ kind: 'form', title: 'Ajouter une sonde', action: 'ajouter', submit: 'Surveiller', params: ADD }],
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
  } },
};
// Pour les essais : remise à zéro de la mémoire.
export function resetVordr(): void { beats.clear(); live.clear(); running.clear(); dayCache.clear(); }
