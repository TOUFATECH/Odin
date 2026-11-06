// Canal Discord : passerelle WebSocket officielle (aucune dépendance), messages privés au bot ou
// mentions dans un salon ; vocaux transcrits, fichiers déposés, boutons Oui / Non.
// Bot à créer sur discord.com/developers (activer « Message Content Intent »), jeton dans DISCORD_BOT_TOKEN.

import { buttonsFor, buttonText, chunk, dropFile, type Channel, type Inbound, type MessagingOptions } from '../channel.ts';

const API = 'https://discord.com/api/v10';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15); // GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT

interface DMsg { id: string; channel_id: string; guild_id?: string; content: string; author: { id: string; username: string; bot?: boolean }; mentions?: Array<{ id: string }>; attachments?: Array<{ url: string; filename: string; content_type?: string; size: number }> }

export class DiscordChannel implements Channel {
  readonly name = 'discord';
  readonly interactive = true;
  private ws?: WebSocket;
  private beat?: NodeJS.Timeout;
  private seq: number | null = null;
  private me = '';
  private running = false;
  /** Utilisateur → salon où lui répondre (message privé ou salon où il a mentionné le bot). */
  private where = new Map<string, string>();
  private token: string; private opts: MessagingOptions; private fetchFn: typeof fetch;
  constructor(token: string, opts: MessagingOptions = {}, fetchFn: typeof fetch = fetch) { this.token = token; this.opts = opts; this.fetchFn = fetchFn; }

  private async rest(method: string, path: string, body?: unknown): Promise<unknown> {
    const r = await this.fetchFn(`${API}${path}`, { method, headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { const w = Number((await r.json() as { retry_after?: number }).retry_after ?? 1); await new Promise((x) => setTimeout(x, w * 1000)); return this.rest(method, path, body); }
    if (!r.ok) throw new Error(`Discord ${path} : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? undefined : r.json();
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const me = await this.rest('GET', '/users/@me') as { id: string; username: string };
    this.me = me.id; this.running = true;
    console.log(`[bifrost] Discord connecté : ${me.username}`);
    this.connect(onMessage);
  }

  private connect(onMessage: (m: Inbound) => Promise<void>, delay = 0): void {
    if (!this.running) return;
    setTimeout(() => {
      const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      this.ws = ws;
      ws.onmessage = (ev) => {
        const p = JSON.parse(String(ev.data)) as { op: number; d: unknown; s: number | null; t: string | null };
        if (p.s != null) this.seq = p.s;
        if (p.op === 10) {
          const every = (p.d as { heartbeat_interval: number }).heartbeat_interval;
          clearInterval(this.beat);
          this.beat = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 1, d: this.seq })), every);
          ws.send(JSON.stringify({ op: 2, d: { token: this.token, intents: INTENTS, properties: { os: process.platform, browser: 'odin', device: 'odin' } } }));
        } else if (p.op === 7 || p.op === 9) ws.close();
        else if (p.op === 0 && p.t === 'MESSAGE_CREATE') void this.onMsg(p.d as DMsg, onMessage).catch((e) => console.error('[discord]', (e as Error).message));
        else if (p.op === 0 && p.t === 'INTERACTION_CREATE') void this.onButton(p.d as Record<string, unknown>, onMessage).catch((e) => console.error('[discord] bouton :', (e as Error).message));
      };
      ws.onclose = () => { clearInterval(this.beat); if (this.running) { console.error('[discord] connexion perdue, reconnexion…'); this.connect(onMessage, 5000); } };
      ws.onerror = () => { /* onclose suit */ };
    }, delay);
  }

  private async onMsg(m: DMsg, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    if (m.author.bot || m.author.id === this.me) return;
    // En salon : seulement quand on mentionne le bot. En privé : toujours.
    if (m.guild_id && !m.mentions?.some((x) => x.id === this.me)) return;
    this.where.set(m.author.id, m.channel_id);
    let text = m.content.replace(new RegExp(`<@!?${this.me}>`, 'g'), '').trim();
    let voice = false;
    for (const a of m.attachments ?? []) {
      if (a.size > 50 * 1024 * 1024) continue;
      const data = new Uint8Array(await (await this.fetchFn(a.url)).arrayBuffer());
      if (/^audio\//.test(a.content_type ?? '') && this.opts.transcribe && !text) { text = await this.opts.transcribe(data, a.content_type ?? 'audio/ogg'); voice = true; await this.send(m.author.id, `🎙 *${text.slice(0, 600)}*`); }
      else text += `${text ? '\n\n' : ''}${await dropFile(this.opts.inbox, a.filename, a.content_type ?? '', data)}`;
    }
    if (text) await onMessage({ channel: this.name, peer: m.author.id, name: m.author.username, text, voice });
  }

  private async onButton(d: Record<string, unknown>, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const data = (d.data as { custom_id?: string } | undefined)?.custom_id ?? '';
    const user = (d.user ?? (d.member as { user?: unknown } | undefined)?.user) as { id: string; username: string } | undefined;
    const text = buttonText(data);
    const label = data.startsWith('ok:no') || data === 'hb:non' ? '❌ Noté' : '✅ Noté';
    await this.rest('POST', `/interactions/${d.id}/${d.token}/callback`, { type: 7, data: { components: [{ type: 1, components: [{ type: 2, style: 2, label, custom_id: 'done', disabled: true }] }] } }).catch(() => undefined);
    if (text && user) { this.where.set(user.id, String(d.channel_id)); await onMessage({ channel: this.name, peer: user.id, name: user.username, text }); }
  }

  private async channelFor(peer: string): Promise<string> {
    const c = this.where.get(peer);
    if (c) return c;
    const dm = await this.rest('POST', '/users/@me/channels', { recipient_id: peer }) as { id: string };
    this.where.set(peer, dm.id);
    return dm.id;
  }

  async send(peer: string, text: string, opts: Parameters<Channel['send']>[2] = {}): Promise<void> {
    const ch = await this.channelFor(peer);
    if (opts?.secret) { const lines = text.split('\n'); text = lines.map((l, k) => (k === 1 ? `||${l}||` : l)).join('\n'); }
    const parts = chunk(text, 1900), btn = buttonsFor(opts ?? {});
    for (const [k, part] of parts.entries()) {
      const last = k === parts.length - 1;
      const body: Record<string, unknown> = { content: part, allowed_mentions: { parse: [] } };
      if (last && btn.length) body.components = [{ type: 1, components: btn.map((b) => ({ type: 2, style: b.id.startsWith('ok:no') || b.id === 'hb:non' ? 4 : b.id.startsWith('ok:yes') || b.id.startsWith('rm:done') || b.id === 'hb:oui' ? 3 : 2, label: b.label, custom_id: b.id })) }];
      const sent = await this.rest('POST', `/channels/${ch}/messages`, body) as { id: string };
      if (opts?.secret) setTimeout(() => { void this.rest('DELETE', `/channels/${ch}/messages/${sent.id}`).catch(() => undefined); }, 600_000).unref?.();
    }
  }

  async typing(peer: string): Promise<void> { const ch = this.where.get(peer); if (ch) await this.rest('POST', `/channels/${ch}/typing`).catch(() => undefined); }

  async sendVoice(peer: string, audio: Uint8Array): Promise<void> {
    const ch = await this.channelFor(peer);
    const form = new FormData();
    form.append('files[0]', new Blob([audio], { type: 'audio/ogg' }), 'odin.ogg');
    form.append('payload_json', JSON.stringify({ content: '' }));
    await this.fetchFn(`${API}/channels/${ch}/messages`, { method: 'POST', headers: { authorization: `Bot ${this.token}` }, body: form });
  }

  async stop(): Promise<void> { this.running = false; clearInterval(this.beat); this.ws?.close(); }
}
