// Canal Slack en « Socket Mode » : aucune adresse publique nécessaire, aucune dépendance.
// Application Slack avec Socket Mode activé : jeton d'application (xapp-…, scope connections:write)
// dans SLACK_APP_TOKEN, jeton du bot (xoxb-…, scopes chat:write, im:history, app_mentions:read,
// files:read) dans SLACK_BOT_TOKEN. Messages privés au bot et mentions ; boutons interactifs.

import { buttonsFor, buttonText, chunk, dropFile, type Channel, type Inbound, type MessagingOptions } from '../channel.ts';

/** Markdown du modèle → mrkdwn Slack (gras, liens, titres). Pur. */
export function slackText(md: string): string {
  return md.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<$2|$1>').replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}

export class SlackChannel implements Channel {
  readonly name = 'slack';
  readonly interactive = true;
  private ws?: WebSocket;
  private running = false;
  private me = '';
  private where = new Map<string, string>();
  private botToken: string; private appToken: string; private opts: MessagingOptions; private fetchFn: typeof fetch;
  constructor(botToken: string, appToken: string, opts: MessagingOptions = {}, fetchFn: typeof fetch = fetch) { this.botToken = botToken; this.appToken = appToken; this.opts = opts; this.fetchFn = fetchFn; }

  private async api(method: string, body: Record<string, unknown>, token = this.botToken): Promise<Record<string, unknown>> {
    const r = await this.fetchFn(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    const j = await r.json() as Record<string, unknown>;
    if (!j.ok) throw new Error(`Slack ${method} : ${String(j.error ?? r.status)}`);
    return j;
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const me = await this.api('auth.test', {});
    this.me = String(me.user_id ?? ''); this.running = true;
    console.log(`[bifrost] Slack connecté : ${String(me.user ?? '')} (${String(me.team ?? '')})`);
    await this.connect(onMessage);
  }

  private async connect(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    if (!this.running) return;
    let url: string;
    try { url = String((await this.api('apps.connections.open', {}, this.appToken)).url); } catch (e) { console.error('[slack]', (e as Error).message); setTimeout(() => void this.connect(onMessage), 15_000); return; }
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      const env = JSON.parse(String(ev.data)) as { envelope_id?: string; type: string; payload?: Record<string, unknown> };
      if (env.envelope_id) ws.send(JSON.stringify({ envelope_id: env.envelope_id })); // accusé de réception immédiat
      if (env.type === 'disconnect') { ws.close(); return; }
      if (env.type === 'events_api') void this.onEvent((env.payload?.event ?? {}) as Record<string, unknown>, onMessage).catch((e) => console.error('[slack]', (e as Error).message));
      if (env.type === 'interactive') void this.onButton(env.payload ?? {}, onMessage).catch((e) => console.error('[slack] bouton :', (e as Error).message));
    };
    ws.onclose = () => { if (this.running) setTimeout(() => void this.connect(onMessage), 3000); };
    ws.onerror = () => { /* onclose suit */ };
  }

  private async onEvent(e: Record<string, unknown>, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const type = String(e.type), user = String(e.user ?? '');
    if (e.bot_id || !user || user === this.me || e.subtype && e.subtype !== 'file_share') return;
    if (type === 'message' && e.channel_type !== 'im') return; // en salon, on attend une mention (app_mention)
    if (type !== 'message' && type !== 'app_mention') return;
    this.where.set(user, String(e.channel));
    let text = String(e.text ?? '').replace(new RegExp(`<@${this.me}>`, 'g'), '').trim();
    let voice = false;
    for (const f of (e.files ?? []) as Array<{ name: string; mimetype: string; url_private: string; size: number }>) {
      if (f.size > 50 * 1024 * 1024) continue;
      const data = new Uint8Array(await (await this.fetchFn(f.url_private, { headers: { authorization: `Bearer ${this.botToken}` } })).arrayBuffer());
      if (/^audio\//.test(f.mimetype) && this.opts.transcribe && !text) { text = await this.opts.transcribe(data, f.mimetype); voice = true; await this.send(user, `🎙 _${text.slice(0, 600)}_`); }
      else text += `${text ? '\n\n' : ''}${await dropFile(this.opts.inbox, f.name, f.mimetype, data)}`;
    }
    if (text) await onMessage({ channel: this.name, peer: user, name: user, text, voice });
  }

  private async onButton(p: Record<string, unknown>, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const a = ((p.actions ?? []) as Array<{ value?: string }>)[0];
    const user = (p.user as { id: string; name?: string } | undefined);
    const text = buttonText(a?.value ?? '');
    const respUrl = String(p.response_url ?? '');
    const msg = p.message as { text?: string } | undefined;
    if (respUrl) await this.fetchFn(respUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ replace_original: true, text: `${msg?.text ?? ''}\n${/no|non/.test(a?.value ?? '') ? '❌ Noté' : '✅ Noté'}` }) }).catch(() => undefined);
    if (text && user) await onMessage({ channel: this.name, peer: user.id, name: user.name ?? user.id, text });
  }

  private async channelFor(peer: string): Promise<string> {
    const c = this.where.get(peer); if (c) return c;
    const r = await this.api('conversations.open', { users: peer });
    const id = String((r.channel as { id: string }).id); this.where.set(peer, id); return id;
  }

  async send(peer: string, text: string, opts: Parameters<Channel['send']>[2] = {}): Promise<void> {
    const channel = await this.channelFor(peer);
    const btn = buttonsFor(opts ?? {}), parts = chunk(slackText(text), 3500);
    for (const [k, part] of parts.entries()) {
      const last = k === parts.length - 1;
      const body: Record<string, unknown> = { channel, text: part, unfurl_links: false };
      if (last && btn.length) body.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: part } }, { type: 'actions', elements: btn.map((b) => ({ type: 'button', text: { type: 'plain_text', text: b.label }, value: b.id, action_id: b.id.slice(0, 250), ...(b.id.startsWith('ok:no') ? { style: 'danger' } : b.id.startsWith('ok:yes') || b.id.startsWith('rm:done') || b.id === 'hb:oui' ? { style: 'primary' } : {}) })) }];
      const r = await this.api('chat.postMessage', body);
      if (opts?.secret) setTimeout(() => { void this.api('chat.delete', { channel, ts: r.ts }).catch(() => undefined); }, 600_000).unref?.();
    }
  }

  async stop(): Promise<void> { this.running = false; this.ws?.close(); }
}
