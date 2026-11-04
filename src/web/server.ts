// Interface web locale d'Odin : un canal Bifröst comme Telegram, servi par node:http.
//
// Sécurité :
// - accès au choix (web.access, voir access.ts) : cette machine seulement (par défaut),
//   réseau local (adresses privées uniquement) ou Internet (HTTPS obligatoire) ;
// - jeton aléatoire stocké dans ~/.odin/web-token (droits 600), échangé contre un cookie
//   HttpOnly + SameSite=Strict (+ Secure en HTTPS), exigé pour chaque appel /api ;
// - essais de jeton ratés limités par adresse (10 en 10 min, puis 15 min de blocage) ;
// - en mode local, vérification de l'en-tête Host (contre le « DNS rebinding ») ;
// - en-tête x-odin obligatoire sur chaque POST (contre les requêtes intersites) ;
// - CSP stricte : aucun script externe, script de la page autorisé par nonce.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { isPrivateHost } from '../heimdall/policy.ts';
import { accessUrls, allowedNetworks, AuthThrottle, remoteAllowed, type TlsMaterial, type WebAccess } from './access.ts';
import { join } from 'node:path';
import type { Channel, Inbound } from '../bifrost/channel.ts';
import { createBackup, restoreBackup } from '../backup.ts';
import { finishCodexLogin, listenCodexCallback, removeCodexAuth, startCodexLogin, type CodexLogin } from '../providers/codex.ts';
import { setConfigValue, type OdinPaths } from '../config.ts';
import type { Autonomy } from '../heimdall/policy.ts';
import { deviceLabel, linksFor } from '../hlidskjalf/inventory.ts';
import type { Odin } from '../runtime.ts';
import type { AgentEvent } from '../types.ts';
import { applySettings, providerFor, settingsView, testProvider, type ModelPreset } from '../settings.ts';
import { TTS_DEFAULTS, cloneVoice, listVoices, speak, speakAudio, sttReady, transcribe, ttsIsLocal, ttsReady } from '../voice/voice.ts';

export function ensureWebToken(paths: OdinPaths, rotate = false): string {
  const f = join(paths.home, 'web-token');
  if (!rotate && existsSync(f)) return readFileSync(f, 'utf8').trim();
  const t = randomBytes(24).toString('hex');
  writeFileSync(f, t, { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows : droits gérés par le profil utilisateur */ }
  return t;
}

export interface WebHooks {
  scanNetwork(full: boolean): Promise<unknown>;
  /** Canaux qui n'ont pas pu démarrer (nom → raison). */
  failedChannels?(): Record<string, string>;
  /** Missions : arrêter le tour d'une session, reprendre une mission. */
  abortSession?(sessionId: string): boolean;
  resume?(sessionId: string): Promise<void>;
  /** Relance les services avec la nouvelle configuration (fourni par la passerelle). */
  reload?(): Promise<void>;
}

const UI = readFileSync(new URL('./ui.html', import.meta.url), 'utf8');
const FACE = readFileSync(new URL('./face.js', import.meta.url), 'utf8');
const MAX_BODY = 200_000;

export class WebChannel implements Channel {
  readonly name = 'web';
  readonly interactive = true;
  readonly defaultPeer = 'principal';
  private server?: Server;
  private clients = new Set<ServerResponse>();
  /** Connexion ChatGPT (Codex) en cours : secret PKCE gardé en mémoire, jamais envoyé à la page. */
  private codexLogin?: CodexLogin;
  private codexServer?: Server;
  private odin: Odin;
  private hooks: WebHooks;
  private port: number;
  private host: string;
  private token: string;
  private access: WebAccess;
  private tls?: TlsMaterial;
  private throttle = new AuthThrottle();
  /** Jeton précédent après rotation : refusé, mais pas compté comme une attaque. */
  private lastToken = '';

  constructor(odin: Odin, hooks: WebHooks, opts: { port: number; host: string; token: string; access?: WebAccess; tls?: TlsMaterial }) {
    this.odin = odin; this.hooks = hooks;
    this.port = opts.port; this.host = opts.host; this.token = opts.token;
    this.access = opts.access ?? 'local'; this.tls = opts.tls;
  }

  /** Lien à ouvrir sur cette machine. */
  get url(): string {
    const h = this.host === '::1' ? '[::1]' : this.host === '::' || this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
    return `${this.tls ? 'https' : 'http'}://${h}:${this.port}/?token=${this.token}`;
  }
  /** Tous les liens utiles (cette machine, réseau local, adresse publique). */
  get urls(): string[] { return accessUrls(this.odin.cfg.web, this.token, { access: this.access, https: Boolean(this.tls) }); }

  private tokenOk(given: string | undefined): boolean {
    const a = Buffer.from(given ?? ''), b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---- Première connexion (comme l'accueil de Home Assistant) ----
  // Tant qu'aucun appareil ne s'est jamais connecté, le premier navigateur du réseau LOCAL qui ouvre
  // Odin reçoit l'accès, sans jeton, pendant la première heure après le démarrage. Ensuite, le jeton
  // redevient obligatoire. Utile quand Odin tourne en service (LXC, serveur) et que personne n'a vu le lien.
  private readonly startedAt = Date.now();
  private claimedFile(): string { return join(this.odin.paths.home, 'web-claimed'); }
  private markClaimed(by: string): void {
    if (existsSync(this.claimedFile())) return;
    try { writeFileSync(this.claimedFile(), `${new Date().toISOString()} ${by}\n`, { mode: 0o600 }); } catch { /* lecture seule : sans effet */ }
  }
  /** La première connexion sans jeton est-elle encore possible pour cette requête ? */
  private claimable(req: IncomingMessage): boolean {
    if (existsSync(this.claimedFile())) return false;
    if (Date.now() - this.startedAt > 60 * 60_000) return false;
    if (this.odin.muninn.listSessions(500).some((s) => s.id.startsWith('web:'))) { this.markClaimed('déjà utilisé'); return false; }
    const ip = this.clientIp(req).replace(/^fwd:/, '');
    return isPrivateHost(ip); // jamais depuis Internet
  }

  private authed(req: IncomingMessage): boolean {
    const cookie = /(?:^|;\s*)odin_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const ok = this.tokenOk(cookie) || this.tokenOk(bearer);
    if (ok) { this.throttle.success(this.clientIp(req)); if (cookie) this.markClaimed('jeton'); }
    else if (bearer || (cookie && cookie !== this.lastToken)) this.throttle.fail(this.clientIp(req)); // un jeton faux = un essai raté (sauf l'ancien jeton juste remplacé)
    return ok;
  }

  // Réseaux autorisés (recalculés toutes les minutes : le Wi-Fi peut changer).
  private nets?: { at: number; list: string[] };
  private networks(): string[] {
    if (!this.nets || Date.now() - this.nets.at > 60_000) this.nets = { at: Date.now(), list: allowedNetworks(this.odin.cfg.web) };
    return this.nets.list;
  }

  private clientIp(req: IncomingMessage): string {
    const sock = remoteOf(req);
    if (this.access === 'wan' && this.odin.cfg.web.behindProxy) {
      // Le proxy AJOUTE l'adresse réelle en fin de liste ; le début peut être forgé par le client.
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).at(-1) ?? '';
      if (fwd) return `fwd:${fwd}`; // préfixe : jamais confondu avec la machine elle-même
    }
    return sock;
  }

  private hostOk(req: IncomingMessage): boolean {
    // Réseau local ou Internet : le nom utilisé varie (IP, nom.local, domaine) ; le jeton protège.
    if (this.access !== 'local') return true;
    const h = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return ['127.0.0.1', 'localhost', '::1'].includes(h);
  }

  private cookie(token: string): string {
    return `odin_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${this.tls ? '; Secure' : ''}`;
  }

  private push(data: unknown): void {
    const line = `data: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(line);
  }

  async send(peer: string, text: string): Promise<void> { this.push({ type: 'message', peer, role: 'assistant', text }); }
  event(peer: string, e: AgentEvent): void { this.push({ type: 'event', peer, event: e }); }
  notify(topic: string): void { this.push({ type: 'refresh', topic }); }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      void this.route(req, res, onMessage).catch((e) => json(res, 500, { error: (e as Error).message }));
    };
    this.server = this.tls ? createHttpsServer({ key: this.tls.key, cert: this.tls.cert }, handler) : createServer(handler);
    const listen = (host: string) => new Promise<void>((r, j) => { this.server!.once('error', j); this.server!.listen(this.port, host, () => { this.server!.removeListener('error', j); r(); }); });
    try { await listen(this.host); } catch (e) {
      // Machine sans IPv6 : « :: » est refusé, on écoute alors sur toutes les adresses IPv4.
      if (this.host !== '::' || !['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
      this.host = '0.0.0.0'; await listen(this.host);
    }
    const ping = setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, 25_000);
    this.server.on('close', () => clearInterval(ping));
  }

  async stop(): Promise<void> {
    this.codexServer?.close();
    for (const c of this.clients) c.end();
    await new Promise((r) => this.server?.close(r));
  }

  private async route(req: IncomingMessage, res: ServerResponse, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Derrière un proxy HTTPS, seul le proxy (sur la machine ou le réseau local) peut se connecter ;
    // l'adresse réelle du visiteur vient alors de X-Forwarded-For (pour la limite d'essais).
    const proxied = this.access === 'wan' && this.odin.cfg.web.behindProxy;
    if (!remoteAllowed(proxied ? 'lan' : this.access, remoteOf(req), this.networks())) { req.socket.destroy(); return; } // hors du périmètre choisi : on ne répond pas
    const ip = this.clientIp(req);
    if (this.throttle.blocked(ip)) return json(res, 429, { error: 'trop d\'essais de jeton : réessaie dans 15 minutes' });
    if (!this.hostOk(req)) return json(res, 403, { error: 'hôte refusé' });

    if (req.method === 'GET' && url.pathname === '/') {
      const t = url.searchParams.get('token');
      if (t && this.tokenOk(t)) {
        this.throttle.success(ip);
        res.writeHead(302, { location: '/', 'set-cookie': this.cookie(this.token) });
        return void res.end();
      }
      if (t) this.throttle.fail(ip);
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-frame-options': 'DENY',
        ...(this.tls && !this.tls.selfSigned ? { 'strict-transport-security': 'max-age=31536000' } : {}),
      });
      const authed = this.authed(req);
      return void res.end(UI.replaceAll('__NONCE__', nonce).replace('__AUTHED__', authed ? 'true' : 'false').replace('__CLAIMABLE__', !authed && this.claimable(req) ? 'true' : 'false'));
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname === '/face.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff' }); return void res.end(FACE); }
    if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
      return void res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0B0E14"/><path d="M16 5 23 12 16 19 9 12Z M9 12 7 27 M23 12 25 27 M16 19 9 27 M16 19 23 27" fill="none" stroke="#E2A93B" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>');
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'introuvable' });
    if (req.method === 'POST' && url.pathname === '/api/claim') {
      if (req.headers['x-odin'] !== '1') return json(res, 403, { error: 'en-tête x-odin manquant' });
      if (!this.claimable(req)) return json(res, 403, { error: 'la première connexion est déjà faite : utilise le lien avec jeton (odin web link)' });
      this.markClaimed(this.clientIp(req));
      console.log(`[web] première connexion : accès donné au navigateur ${this.clientIp(req)}`);
      res.setHeader('set-cookie', this.cookie(this.token));
      return json(res, 200, { ok: true });
    }
    if (!this.authed(req)) {
      // Cookie périmé (nouveau jeton) : on le fait oublier au navigateur, pour qu'il n'insiste pas en boucle.
      if (/odin_token=/.test(req.headers.cookie ?? '')) res.setHeader('set-cookie', 'odin_token=; Max-Age=0; Path=/');
      return json(res, 401, { error: 'jeton requis' });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, this.state());
    if (req.method === 'GET' && url.pathname === '/api/voice/voices') {
      try { return json(res, 200, { ok: true, voices: await listVoices(this.odin.cfg.voice) }); } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const peer = safePeer(url.searchParams.get('peer'));
      const msgs = this.odin.muninn.history(`web:${peer}`).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content).map((m) => ({ role: m.role, text: m.content }));
      return json(res, 200, { peer, messages: msgs.slice(-200) });
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'méthode refusée' });
    if (req.headers['x-odin'] !== '1') return json(res, 403, { error: 'en-tête x-odin manquant' });
    const v = this.odin.cfg.voice;
    if (url.pathname === '/api/backup') {
      // Sauvegarde chiffrée : le mot de passe ne quitte pas la requête, le fichier part tel quel au navigateur.
      try {
        const b = await readJson(req);
        const data = createBackup(this.odin.paths, String(b.password ?? ''), { workspace: b.workspace !== false });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="odin-sauvegarde-${new Date().toISOString().slice(0, 10)}.odinbk"`, 'cache-control': 'no-store' });
        return void res.end(data);
      } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    if (url.pathname === '/api/restore') {
      // Restauration : fichier brut + mot de passe en en-tête ; les services redémarrent juste après.
      try {
        const data = await readRaw(req, 1024 * 1024 * 1024);
        const r = restoreBackup(this.odin.paths, Buffer.from(data), decodeURIComponent(String(req.headers['x-odin-password'] ?? '')));
        if (this.hooks.reload) setTimeout(() => void this.hooks.reload!().catch((e) => console.error('[web] redémarrage :', (e as Error).message)), 300);
        return json(res, 200, { ok: true, files: r.files, replaced: r.replaced.length, reloading: Boolean(this.hooks.reload) });
      } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    if (url.pathname === '/api/voice/transcribe') {
      // Micro de l'interface : l'audio arrive brut, Whisper le transforme en texte.
      if (!sttReady(v)) return json(res, 200, { ok: false, error: 'Whisper n\'est pas configuré (Réglages → Voix)' });
      try { const audio = await readRaw(req, 25 * 1024 * 1024); return json(res, 200, { ok: true, text: await transcribe(audio, String(req.headers['content-type'] ?? 'audio/webm'), v) }); }
      catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    if (url.pathname === '/api/voice/clone') {
      // Copie d'une voix : un enregistrement d'une à quelques minutes, avec consentement explicite.
      try {
        const audio = await readRaw(req, 25 * 1024 * 1024);
        const name = url.searchParams.get('name') ?? '';
        const id = await cloneVoice(name, [{ data: audio, mime: String(req.headers['content-type'] ?? 'audio/mpeg'), filename: url.searchParams.get('file') ?? 'echantillon.mp3' }], url.searchParams.get('consent') === '1', v);
        setConfigValue(this.odin.paths, ['voice', 'tts'], { ...v.tts, voiceId: id, voiceName: name.trim().slice(0, 60) });
        v.tts.voiceId = id; v.tts.voiceName = name.trim().slice(0, 60);
        this.notify('state');
        return json(res, 200, { ok: true, voiceId: id });
      } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    const body = await readJson(req);
    if (url.pathname === '/api/voice/speak') {
      if (!ttsReady(v)) return json(res, 200, { ok: false, error: 'La synthèse vocale n\'est pas configurée (Réglages → Voix)' });
      try {
        const audio = await speakAudio(String(body.text ?? '').slice(0, 5000), v);
        res.writeHead(200, { 'content-type': audio.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return void res.end(audio.data);
      } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
    if (url.pathname === '/api/photo') {
      // Les yeux d'Odin : une photo de la caméra (téléphone) ou une image, déposée dans inbox/ puis montrée à Odin.
      try {
        const data = await readRaw(req, 20 * 1024 * 1024);
        const type = String(req.headers['content-type'] ?? '');
        const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
        if (!/^image\//.test(type) || !data.byteLength) return json(res, 200, { ok: false, error: 'image attendue' });
        const dir = join(this.odin.paths.workspace, 'inbox'); mkdirSync(dir, { recursive: true });
        const name = `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
        writeFileSync(join(dir, name), data);
        const peer = safePeer(url.searchParams.get('peer') ?? undefined);
        const said = (url.searchParams.get('text') ?? '').slice(0, 4000).trim();
        void onMessage({ channel: 'web', peer, name: 'navigateur', text: `${said || 'Regarde ce que je te montre et dis-moi ce que tu vois.'}\n\n[Photo prise par la caméra : inbox/${name} (${type}, ${Math.round(data.byteLength / 1024)} Ko)]` });
        return json(res, 202, { ok: true, file: `inbox/${name}` });
      } catch (e) { return json(res, 200, { ok: false, error: (e as Error).message }); }
    }
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
      autonomy: cfg.mimir.autonomy,
      autonomyNow: this.odin.heimdall.effectiveAutonomy(),
      breaker: cfg.mimir.breaker,
      judge: this.odin.mimir?.judgeName ?? null,
      settings: settingsView(cfg, Boolean(this.odin.demo), process.env, this.odin.paths),
      voice: { stt: sttReady(cfg.voice), tts: ttsReady(cfg.voice), local: ttsIsLocal(cfg.voice), provider: cfg.voice.tts.provider, speakReplies: cfg.voice.speakReplies, ttsDefaults: TTS_DEFAULTS },
      failedChannels: this.hooks.failedChannels?.() ?? {},
      missions: muninn.listMissions(60),
      people: { users: muninn.listUsers(), pending: muninn.listPairings().filter((p) => p.status === 'pending') },
      budget: { monthlyUsd: cfg.routing.monthlyBudgetUsd, spentUsd: muninn.monthCost(), breakdown: muninn.usageBreakdown(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()) },
      access: { mode: this.access, networks: this.access === 'lan' ? this.networks() : [], https: Boolean(this.tls), selfSigned: Boolean(this.tls?.selfSigned), fingerprint: this.tls?.fingerprint ?? null, links: this.urls.map((u) => u.replace(/\/\?token=.*$/, '/')) },
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
        if (!['prudent', 'equilibre', 'autonome', 'breaker'].includes(a)) return { ok: false, error: 'niveau inconnu' };
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
          return await testProvider(p, 20_000, env, this.odin.paths);
        } catch (e) { return { ok: false, message: (e as Error).message }; }
      }
      case 'codex_login_start': {
        // Connexion ChatGPT : lien à ouvrir ; si le navigateur est sur cette machine, le retour est capté tout seul.
        this.codexLogin = startCodexLogin();
        this.codexServer?.close();
        this.codexServer = listenCodexCallback(this.odin.paths, this.codexLogin, (r) => {
          this.codexLogin = undefined;
          this.notify('state');
          if (r.ok && this.hooks.reload) setTimeout(() => void this.hooks.reload!().catch(() => {}), 300);
        });
        return { ok: true, url: this.codexLogin.url };
      }
      case 'codex_login_finish': {
        if (!this.codexLogin) return { ok: false, error: 'aucune connexion en cours : clique d\'abord « Se connecter avec ChatGPT »' };
        try {
          const a = await finishCodexLogin(this.odin.paths, this.codexLogin, String(b.callback ?? ''));
          this.codexLogin = undefined; this.codexServer?.close();
          if (this.hooks.reload) setTimeout(() => void this.hooks.reload!().catch(() => {}), 300);
          return { ok: true, email: a.email, plan: a.plan };
        } catch (e) { return { ok: false, error: (e as Error).message }; }
      }
      case 'codex_logout': removeCodexAuth(this.odin.paths); if (this.hooks.reload) setTimeout(() => void this.hooks.reload!().catch(() => {}), 300); break;
      case 'breaker_save': {
        // Réglages d'Odin Breaker : appliqués tout de suite, sans redémarrer.
        const cur = this.odin.cfg.mimir.breaker;
        const next = {
          schedule: b.schedule === 'night' ? 'night' : 'always',
          from: String(b.from ?? cur.from), to: String(b.to ?? cur.to),
          fallback: ['prudent', 'equilibre', 'autonome'].includes(String(b.fallback)) ? String(b.fallback) : cur.fallback,
          reportAt: String(b.reportAt ?? cur.reportAt),
          maxSteps: Math.round(Number(b.maxSteps ?? cur.maxSteps)),
          maxCostPerTurnUsd: Number(b.maxCostPerTurnUsd ?? cur.maxCostPerTurnUsd),
          proactive: b.proactive === undefined ? cur.proactive : Boolean(b.proactive),
        } as typeof cur;
        try { setConfigValue(this.odin.paths, ['mimir', 'breaker'], next); } catch (e) { return { ok: false, error: (e as Error).message }; }
        this.odin.cfg.mimir.breaker = next;
        this.odin.heimdall.setBreaker(next);
        break;
      }
      case 'mission_stop': { const m = muninn.getMission(String(b.id)); if (!m) return { ok: false, error: 'mission inconnue' }; const stopped = this.hooks.abortSession?.(m.session_id) ?? false; if (!stopped) muninn.endMission(m.id, 'arrêtée', 'Arrêtée depuis l\'onglet Missions.'); break; }
      case 'mission_resume': { const m = muninn.getMission(String(b.id)); if (!m) return { ok: false, error: 'mission inconnue' }; if (!this.hooks.resume) return { ok: false, error: 'reprise indisponible' }; void this.hooks.resume(m.session_id).catch((e) => console.error('[missions]', (e as Error).message)); return { ok: true, started: true }; }
      case 'user_save': { try { const u = muninn.saveUser({ id: b.id ? String(b.id) : undefined, name: String(b.name ?? ''), role: String(b.role ?? 'member') as 'member', autonomy: b.autonomy ? String(b.autonomy) as 'prudent' : undefined }); return { ok: true, id: u.id }; } catch (e) { return { ok: false, error: (e as Error).message }; } }
      case 'user_delete': muninn.deleteUser(String(b.id)); break;
      case 'user_link': { try { muninn.linkIdentity(String(b.channel), String(b.peer), String(b.id)); } catch (e) { return { ok: false, error: (e as Error).message }; } break; }
      case 'user_unlink': muninn.unlinkIdentity(String(b.channel), String(b.peer)); break;
      case 'pairing_approve': {
        const r = muninn.approvePairing(String(b.channel), String(b.code));
        if (!r) return { ok: false, error: 'code inconnu ou expiré' };
        if (b.role === 'member') { const u = muninn.saveUser({ name: String(b.name || r.name || 'membre'), role: 'member', autonomy: b.autonomy ? String(b.autonomy) as 'prudent' : undefined }); muninn.linkIdentity(String(b.channel), r.peer, u.id); }
        break;
      }
      case 'pairing_reject': muninn.unlinkIdentity(String(b.channel), String(b.peer)); break;
      case 'access_links': return { ok: true, links: this.urls }; // avec le jeton, pour ouvrir sur un autre appareil
      case 'token_rotate': {
        // Nouveau jeton : tous les liens et navigateurs déjà connectés sont déconnectés.
        this.lastToken = this.token;
        this.token = ensureWebToken(this.odin.paths, true);
        setTimeout(() => { for (const c of this.clients) c.end(); this.clients.clear(); }, 100);
        return { ok: true, token: this.token };
      }
      case 'conversation_reset': muninn.resetSession(`web:${safePeer(b.peer as string)}`); break;
      case 'net_scan': void this.hooks.scanNetwork(Boolean(b.full)); return { ok: true, started: true };
      default: return { ok: false, error: 'action inconnue' };
    }
    this.notify('state');
    return { ok: true };
  }
}

const remoteOf = (req: IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

const safePeer = (p: string | null | undefined) => (p && /^[a-z0-9-]{1,40}$/i.test(p) ? p : 'principal');

function json(res: ServerResponse, code: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage, max: number): Promise<Uint8Array> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Error('fichier trop gros'); parts.push(c as Buffer); }
  return new Uint8Array(Buffer.concat(parts));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > MAX_BODY) throw new Error('requête trop grosse'); parts.push(c as Buffer); }
  const raw = Buffer.concat(parts).toString('utf8');
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { throw new Error('JSON invalide'); }
}
