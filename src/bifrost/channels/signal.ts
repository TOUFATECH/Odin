// Canal Signal, via signal-cli-rest-api (conteneur Docker bbernhard/signal-cli-rest-api, mode « normal »
// ou « native ») : Odin lit les messages reçus toutes les 2 secondes et répond par l'API.
// Aucun service en ligne : le numéro Signal d'Odin est relié sur ta machine.

import { chunk, dropFile, type Channel, type Inbound, type MessagingOptions } from '../channel.ts';

interface Envelope { envelope?: { source?: string; sourceNumber?: string; sourceUuid?: string; sourceName?: string; dataMessage?: { message?: string | null; attachments?: Array<{ id: string; contentType?: string; filename?: string | null; size?: number }> } } }

export class SignalChannel implements Channel {
  readonly name = 'signal';
  readonly interactive = true;
  private running = false;
  private timer?: NodeJS.Timeout;
  private url: string; private number: string; private opts: MessagingOptions; private fetchFn: typeof fetch;
  constructor(url: string, number: string, opts: MessagingOptions = {}, fetchFn: typeof fetch = fetch) { this.url = url.replace(/\/$/, ''); this.number = number; this.opts = opts; this.fetchFn = fetchFn; }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const r = await this.fetchFn(`${this.url}/v1/about`).catch(() => undefined);
    if (!r?.ok) throw new Error(`signal-cli-rest-api injoignable à ${this.url}`);
    console.log(`[bifrost] Signal connecté : ${this.number}`);
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try { await this.poll(onMessage); } catch (e) { console.error('[signal]', (e as Error).message); }
      this.timer = setTimeout(loop, 2000);
    };
    void loop();
  }

  /** Un tour de lecture (exposé pour les tests). */
  async poll(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const r = await this.fetchFn(`${this.url}/v1/receive/${encodeURIComponent(this.number)}?timeout=1`);
    if (!r.ok) throw new Error(`réception : HTTP ${r.status}`);
    for (const e of await r.json() as Envelope[]) {
      const env = e.envelope, dm = env?.dataMessage;
      const peer = env?.sourceNumber || env?.source || env?.sourceUuid;
      if (!env || !dm || !peer) continue;
      let text = (dm.message ?? '').trim(), voice = false;
      for (const a of dm.attachments ?? []) {
        if ((a.size ?? 0) > 50 * 1024 * 1024) continue;
        const data = new Uint8Array(await (await this.fetchFn(`${this.url}/v1/attachments/${encodeURIComponent(a.id)}`)).arrayBuffer());
        if (/^audio\//.test(a.contentType ?? '') && this.opts.transcribe && !text) { text = await this.opts.transcribe(data, a.contentType ?? 'audio/aac'); voice = true; await this.send(peer, `🎙 « ${text.slice(0, 600)} »`); }
        else text += `${text ? '\n\n' : ''}${await dropFile(this.opts.inbox, a.filename || `${a.id}.${(a.contentType ?? 'bin').split('/')[1]}`, a.contentType ?? '', data)}`;
      }
      if (text) void onMessage({ channel: this.name, peer, name: env.sourceName || peer, text, voice }).catch((x) => console.error('[signal]', (x as Error).message));
    }
  }

  async send(peer: string, text: string, opts: Parameters<Channel['send']>[2] = {}): Promise<void> {
    const plain = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
    const tail = opts?.approval ? '\n\nRéponds « oui » ou « non ».' : opts?.reminder ? '\n\nRéponds « fait » ou « plus tard ».' : opts?.habit ? '\n\nRéponds « oui » ou « non ».' : '';
    for (const part of chunk(plain + tail, 3500)) {
      const r = await this.fetchFn(`${this.url}/v2/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: part, number: this.number, recipients: [peer], ...(opts?.secret ? { view_once: true } : {}) }) });
      if (!r.ok) throw new Error(`Signal : envoi impossible (HTTP ${r.status})`);
    }
  }

  async sendVoice(peer: string, audio: Uint8Array): Promise<void> {
    await this.fetchFn(`${this.url}/v2/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '', number: this.number, recipients: [peer], base64_attachments: [`data:audio/ogg;filename=odin.ogg;base64,${Buffer.from(audio).toString('base64')}`] }) });
  }

  async typing(peer: string): Promise<void> {
    await this.fetchFn(`${this.url}/v1/typing-indicator/${encodeURIComponent(this.number)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipient: peer }) }).catch(() => undefined);
  }

  async stop(): Promise<void> { this.running = false; clearTimeout(this.timer); }
}
