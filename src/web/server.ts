// Interface web locale d'Odin : un canal Bifröst comme Telegram, servi par node:http.
//
// Sécurité :
// - écoute sur 127.0.0.1 uniquement (accès distant : tunnel SSH ou Tailscale) ;
// - jeton aléatoire stocké dans ~/.odin/web-token (droits 600), échangé contre un cookie
//   HttpOnly + SameSite=Strict ;
// - vérification de l'en-tête Host (contre le « DNS rebinding ») et en-tête x-odin
//   obligatoire sur chaque POST (contre les requêtes intersites) ;
// - CSP stricte : aucun script externe, script de la page autorisé par nonce.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Channel, Inbound } from '../bifrost/channel.ts';
import { setConfigValue, type OdinPaths } from '../config.ts';
import type { Autonomy } from '../heimdall/policy.ts';
import { deviceLabel, linksFor } from '../hlidskjalf/inventory.ts';
import type { Odin } from '../runtime.ts';
import type { AgentEvent } from '../types.ts';
import { applySettings, providerFor, settingsView, testProvider, type ModelPreset } from '../settings.ts';

export function ensureWebToken(paths: OdinPaths): string {
  const f = join(paths.home, 'web-token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const t = randomBytes(24).toString('hex');
  writeFileSync(f, t, { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows : droits gérés par le profil utilisateur */ }
  return t;
}

export interface WebHooks {
  scanNetwork(full: boolean): Promise<unknown>;
  /** Relance les services avec la nouvelle configuration (fourni par la passerelle). */
  reload?(): Promise<void>;
}

const UI = readFileSync(new URL('./ui.html', import.meta.url), 'utf8');
const MAX_BODY = 200_000;

export class WebChannel implements Channel {
  readonly name = 'web';
  readonly interactive = true;
  readonly defaultPeer = 'principal';
  private server?: Server;
  private clients = new Set<ServerResponse>();
  private odin: Odin;
  private hooks: WebHooks;
  private port: number;
  private host: string;
  private token: string;

  constructor(odin: Odin, hooks: WebHooks, opts: { port: number; host: string; token: string }) {
    this.odin = odin; this.hooks = hooks;
    this.port = opts.port; this.host = opts.host; this.token = opts.token;
  }

  get url(): string { return `http://${this.host === '::1' ? '[::1]' : this.host}:${this.port}/?token=${this.token}`; }

  private tokenOk(given: string | undefined): boolean {
    const a = Buffer.from(given ?? ''), b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private authed(req: IncomingMessage): boolean {
    const cookie = /(?:^|;\s*)odin_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return this.tokenOk(cookie) || this.tokenOk(bearer);
  }

  private hostOk(req: IncomingMessage): boolean {
    const h = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return ['127.0.0.1', 'localhost', '::1'].includes(h);
  }

  private push(data: unknown): void {
    const line = `data: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(line);
  }

  async send(peer: string, text: string): Promise<void> { this.push({ type: 'message', peer, role: 'assistant', text }); }
  event(peer: string, e: AgentEvent): void { this.push({ type: 'event', peer, event: e }); }
  notify(topic: string): void { this.push({ type: 'refresh', topic }); }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    this.server = createServer((req, res) => {
      void this.route(req, res, onMessage).catch((e) => json(res, 500, { error: (e as Error).message }));
    });
    await new Promise<void>((r, j) => { this.server!.once('error', j); this.server!.listen(this.port, this.host, r); });
    const ping = setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, 25_000);
    this.server.on('close', () => clearInterval(ping));
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.end();
    await new Promise((r) => this.server?.close(r));
  }

  private async route(req: IncomingMessage, res: ServerResponse, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!this.hostOk(req)) return json(res, 403, { error: 'hôte refusé' });

    if (req.method === 'GET' && url.pathname === '/') {
      const t = url.searchParams.get('token');
      if (t && this.tokenOk(t)) {
        res.writeHead(302, { location: '/', 'set-cookie': `odin_token=${this.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
        return void res.end();
      }
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
      });
      return void res.end(UI.replace('__NONCE__', nonce).replace('__AUTHED__', this.authed(req) ? 'true' : 'false'));
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
      return void res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0B0E14"/><path d="M16 5 23 12 16 19 9 12Z M9 12 7 27 M23 12 25 27 M16 19 9 27 M16 19 23 27" fill="none" stroke="#E2A93B" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>');
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'introuvable' });
    if (!this.authed(req)) return json(res, 401, { error: 'jeton requis' });

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, this.state());
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const peer = safePeer(url.searchParams.get('peer'));
      const msgs = this.odin.muninn.history(`web:${peer}`).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content).map((m) => ({ role: m.role, text: m.content }));
      return json(res, 200, { peer, messages: msgs.slice(-200) });
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'méthode refusée' });
    if (req.headers['x-odin'] !== '1') return json(res, 403, { error: 'en-tête x-odin manquant' });
    const body = await readJson(req);
    if (url.pathname === '/api/message') {
      const text = String(body.text ?? '').slice(0, 20_000);
      if (!text.trim()) return json(res, 400, { error: 'message vide' });
      const peer = safePeer(body.peer as string);
      void onMessage({ channel: 'web', peer, name: 'navigateur', text });
      return json(res, 202, { ok: true });
    }
    if (url.pathname === '/api/action') return json(res, 200, await this.action(body));
    return json(res, 404, { error: 'introuvable' });
  }

  private state(): unknown {
    const { muninn, skills, inventory, cfg } = this.odin;
    const auditFile = join(this.odin.paths.logs, 'audit.jsonl');
    const audit = existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').slice(-40).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    const day = muninn.usageSince(Date.now() - 86_400_000);
    return {
      name: cfg.name,
      conversations: muninn.listSessions(50).filter((s) => s.id.startsWith('web:')).map((s) => ({ peer: s.id.slice(4), title: s.title, updated: s.updated_at, tainted: s.tainted === 1 })),
      usage: day,
      network: { enabled: cfg.network.enabled, intervalMin: cfg.network.intervalMin, lastScan: inventory.lastScan() ?? null },
      devices: inventory.list({ status: 'all' }).map((d) => ({ ...d, label: deviceLabel(d), links: linksFor(d) })),
      deviceEvents: inventory.events(40).map((e) => ({ ...e, device: deviceLabel(inventory.get(e.device_id) ?? ({ ip: e.device_id } as never)) })),
      memories: muninn.listMemories(200),
      skills: skills.list().map((s) => ({ name: s.name, description: s.description, version: s.version, uses: muninn.skillStats().find((x) => x.name === s.name)?.uses ?? 0 })),
      drafts: skills.drafts().map((s) => ({ name: s.name, description: s.description, version: s.version, reason: s.meta.reason ?? '', warnings: s.meta.warnings ?? '', body: s.body })),
      jobs: muninn.listJobs(),
      grants: muninn.listGrants(),
      autonomy: cfg.mimir.enabled ? cfg.mimir.autonomy : 'prudent',
      judge: this.odin.mimir?.judgeName ?? null,
      settings: settingsView(cfg, Boolean(this.odin.demo)),
      audit,
    };
  }

  private async action(b: Record<string, unknown>): Promise<unknown> {
    const { muninn, skills, inventory } = this.odin;
    const name = String(b.name ?? ''), id = Number(b.id);
    switch (b.kind) {
      case 'skill_approve': skills.approve(name); break;
      case 'skill_reject': skills.reject(name); break;
      case 'memory_forget': muninn.forget(id); break;
      case 'memory_vouch': muninn.vouch(id); break;
      case 'memory_pin': muninn.pin(id, Boolean(b.on)); break;
      case 'device_label': inventory.setLabel(String(b.id), String(b.label ?? '')); break;
      case 'cron_remove': muninn.removeJob(String(b.id)); break;
      case 'grant_revoke': muninn.revokeGrant(Number(b.id)); break;
      case 'set_autonomy': {
        const a = String(b.autonomy) as Autonomy;
        if (!['prudent', 'equilibre', 'autonome'].includes(a)) return { ok: false, error: 'niveau inconnu' };
        setConfigValue(this.odin.paths, ['mimir', 'autonomy'], a);
        this.odin.cfg.mimir.autonomy = a;
        this.odin.heimdall.setAutonomy(a);
        break;
      }
      case 'settings_save': {
        let restart: boolean;
        try { restart = applySettings(this.odin.paths, this.odin.cfg, String(b.section), b); } catch (e) { return { ok: false, error: (e as Error).message }; }
        for (const v of [b.apiKey, b.token, b.value]) if (typeof v === 'string') this.odin.redactor.add(v.trim());
        if (restart && this.hooks.reload) {
          // On répond d'abord : la page se reconnecte toute seule au flux après le redémarrage.
          setTimeout(() => void this.hooks.reload!().catch((e) => console.error('[web] redémarrage :', (e as Error).message)), 200);
          return { ok: true, reloading: true };
        }
        this.notify('state');
        return { ok: true, reloading: false, restartNeeded: restart };
      }
      case 'settings_test': {
        try {
          const p = providerFor({ preset: String(b.preset) as ModelPreset, model: String(b.model ?? ''), baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : undefined });
          // Clé saisie mais pas encore enregistrée : on la teste sans l'écrire.
          const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
          const env = key && p.apiKeyEnv ? { ...process.env, [p.apiKeyEnv]: key } : process.env;
          return await testProvider(p, 20_000, env);
        } catch (e) { return { ok: false, message: (e as Error).message }; }
      }
      case 'conversation_reset': muninn.resetSession(`web:${safePeer(b.peer as string)}`); break;
      case 'net_scan': void this.hooks.scanNetwork(Boolean(b.full)); return { ok: true, started: true };
      default: return { ok: false, error: 'action inconnue' };
    }
    this.notify('state');
    return { ok: true };
  }
}

const safePeer = (p: string | null | undefined) => (p && /^[a-z0-9-]{1,40}$/i.test(p) ? p : 'principal');

function json(res: ServerResponse, code: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > MAX_BODY) throw new Error('requête trop grosse'); }
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { throw new Error('JSON invalide'); }
}
