// Canal HTTP : API locale protégée par jeton, pour brancher Odin à n'importe quoi
// (raccourcis iOS, n8n, une page web…). Écoute sur 127.0.0.1 uniquement par défaut.
//   POST /v1/message   { "peer": "moi", "text": "…" }   → { "reply": "…" }
//   GET  /health
import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Channel, Inbound } from '../channel.ts';

export class HttpChannel implements Channel {
  readonly name = 'http';
  readonly interactive = false;
  private server?: Server;
  private waiting = new Map<string, (text: string) => void>();

  private port: number;
  private token: string;
  private host: string;
  constructor(port: number, token: string, host = '127.0.0.1') {
    this.port = port; this.token = token; this.host = host;
  }

  private authorized(header: string | undefined): boolean {
    const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(this.token);
    return given.length === want.length && timingSafeEqual(given, want);
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    this.server = createServer(async (req, res) => {
      const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, name: 'odin' });
      if (req.method !== 'POST' || req.url !== '/v1/message') return reply(404, { error: 'introuvable' });
      if (!this.authorized(req.headers.authorization)) return reply(401, { error: 'jeton invalide' });
      const parts: Buffer[] = []; let n = 0;
      for await (const c of req) { n += (c as Buffer).length; if (n > 1_000_000) return reply(413, { error: 'trop gros' }); parts.push(c as Buffer); }
      const raw = Buffer.concat(parts).toString('utf8');
      let body: { peer?: string; text?: string };
      try { body = JSON.parse(raw); } catch { return reply(400, { error: 'JSON invalide' }); }
      if (!body.text) return reply(400, { error: 'champ text requis' });
      const peer = String(body.peer ?? 'http');
      if (this.waiting.has(peer)) return reply(409, { error: 'une demande est déjà en cours pour ce correspondant' });
      // La réponse arrive par send() ; au-delà de 10 minutes, ou si le traitement échoue, on libère le client.
      const done = new Promise<string>((r) => this.waiting.set(peer, r));
      const timer = setTimeout(() => this.send(peer, 'Délai dépassé : Odin n\'a pas répondu en 10 minutes.'), 10 * 60_000);
      onMessage({ channel: this.name, peer, name: peer, text: body.text }).catch((e) => this.send(peer, `Erreur : ${(e as Error).message}`));
      const answer = await done;
      clearTimeout(timer);
      reply(200, { reply: answer });
    });
    await new Promise<void>((r) => this.server!.listen(this.port, this.host, r));
    console.log(`[bifrost] API HTTP sur http://${this.host}:${this.port}`);
  }

  async send(peer: string, text: string): Promise<void> {
    const w = this.waiting.get(peer);
    if (w) { this.waiting.delete(peer); w(text); }
  }

  async stop(): Promise<void> { await new Promise((r) => this.server?.close(r)); }
}
