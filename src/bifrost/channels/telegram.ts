// Canal Telegram en API HTTP brute (long polling) : aucune dépendance.
import { type Channel, chunk, type Inbound } from '../channel.ts';

export class TelegramChannel implements Channel {
  readonly name = 'telegram';
  readonly interactive = true;
  private running = false;
  private offset = 0;
  private ctrl = new AbortController();

  private token: string;
  private api: string;
  constructor(token: string, api = 'https://api.telegram.org') {
    this.token = token; this.api = api;
  }

  private url(method: string): string { return `${this.api}/bot${this.token}/${method}`; }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const me = await (await fetch(this.url('getMe'))).json() as { ok: boolean; result?: { username: string } };
    if (!me.ok) throw new Error('Jeton Telegram invalide (getMe a échoué)');
    console.log(`[bifrost] Telegram connecté : @${me.result?.username}`);
    this.running = true;
    void this.loop(onMessage);
  }

  private async loop(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        const res = await fetch(`${this.url('getUpdates')}?timeout=30&offset=${this.offset}&allowed_updates=["message"]`, { signal: this.ctrl.signal });
        const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; from?: { id: number; username?: string; first_name?: string }; text?: string } }> };
        backoff = 1000;
        for (const u of data.result ?? []) {
          this.offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text) continue;
          // Pas d'await : chaque conversation a sa propre file dans la passerelle.
          void onMessage({ channel: this.name, peer: String(m.chat.id), name: m.from?.username ?? m.from?.first_name ?? '?', text: m.text })
            .catch((e) => console.error('[bifrost] erreur de traitement :', (e as Error).message));
        }
      } catch (e) {
        if (!this.running) return;
        console.error(`[bifrost] Telegram indisponible, nouvel essai dans ${backoff / 1000}s :`, (e as Error).message);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async send(peer: string, text: string): Promise<void> {
    for (const part of chunk(text)) {
      await fetch(this.url('sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: peer, text: part }),
      });
    }
  }

  async stop(): Promise<void> { this.running = false; this.ctrl.abort(); }
}
