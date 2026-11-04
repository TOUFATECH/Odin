// Canal Telegram en API HTTP brute (long polling) : aucune dépendance.
// Texte, notes vocales (transcrites par Whisper) et fichiers (déposés dans l'espace de travail).
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Channel, chunk, type Inbound } from '../channel.ts';

export interface TelegramOptions {
  /** Transcrit une note vocale (Whisper) ; absent = les vocaux sont refusés poliment. */
  transcribe?(audio: Uint8Array, mime: string): Promise<string>;
  /** Dossier où déposer les fichiers reçus (PDF, Word, Excel, photos, vidéos…). */
  inbox?: string;
}

type TgFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TgMessage = {
  chat: { id: number }; from?: { id: number; username?: string; first_name?: string };
  text?: string; caption?: string;
  voice?: TgFile; audio?: TgFile; video_note?: TgFile;
  document?: TgFile; video?: TgFile; photo?: TgFile[];
};

export class TelegramChannel implements Channel {
  readonly name = 'telegram';
  readonly interactive = true;
  private running = false;
  private offset = 0;
  private ctrl = new AbortController();

  private token: string;
  private api: string;
  private opts: TelegramOptions;
  constructor(token: string, api = 'https://api.telegram.org', opts: TelegramOptions = {}) {
    this.token = token; this.api = api; this.opts = opts;
  }

  /** Télécharge un fichier Telegram (20 Mo au plus, limite de l'API des bots). */
  private async download(f: TgFile): Promise<{ data: Uint8Array; path: string }> {
    const info = await (await fetch(`${this.url('getFile')}?file_id=${encodeURIComponent(f.file_id)}`)).json() as { ok: boolean; result?: { file_path: string } };
    if (!info.ok || !info.result) throw new Error('fichier introuvable (plus de 20 Mo ?)');
    const res = await fetch(`${this.api}/file/bot${this.token}/${info.result.file_path}`);
    if (!res.ok) throw new Error(`téléchargement impossible (HTTP ${res.status})`);
    return { data: new Uint8Array(await res.arrayBuffer()), path: info.result.file_path };
  }

  /** Transforme un message Telegram en texte pour Odin (transcription, fichier déposé…). */
  private async toInbound(m: TgMessage): Promise<Inbound | undefined> {
    const base = { channel: this.name, peer: String(m.chat.id), name: m.from?.username ?? m.from?.first_name ?? '?' };
    if (m.text) return { ...base, text: m.text };
    const vocal = m.voice ?? m.video_note;
    if (vocal) {
      if (!this.opts.transcribe) { await this.send(base.peer, '🎙 Les messages vocaux ne sont pas encore activés (Réglages → Voix).'); return undefined; }
      const { data } = await this.download(vocal);
      const text = await this.opts.transcribe(data, vocal.mime_type ?? 'audio/ogg');
      if (!text) { await this.send(base.peer, '🎙 Je n\'ai rien compris dans ce message vocal.'); return undefined; }
      return { ...base, text, voice: true };
    }
    const file = m.document ?? m.audio ?? m.video ?? (m.photo?.length ? m.photo[m.photo.length - 1] : undefined);
    if (file && this.opts.inbox) {
      const { data, path } = await this.download(file);
      const name = safeName(file.file_name ?? basename(path));
      mkdirSync(this.opts.inbox, { recursive: true });
      const dest = join(this.opts.inbox, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${name}`);
      writeFileSync(dest, data);
      const rel = `inbox/${basename(dest)}`;
      return { ...base, text: `${m.caption ? m.caption + '\n\n' : ''}[Fichier reçu : ${rel} (${file.mime_type ?? 'type inconnu'}, ${Math.round(data.byteLength / 1024)} Ko)]` };
    }
    return undefined;
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
        const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: unknown }> };
        backoff = 1000;
        for (const u of data.result ?? []) {
          this.offset = u.update_id + 1;
          const m = u.message as TgMessage | undefined;
          if (!m) continue;
          // Pas d'await : chaque conversation a sa propre file dans la passerelle.
          void this.toInbound(m).then((inb) => (inb ? onMessage(inb) : undefined))
            .catch((e) => { console.error('[bifrost] erreur de traitement :', (e as Error).message); void this.send(String(m.chat.id), `⚠️ ${(e as Error).message}`).catch(() => {}); });
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

  /** Note vocale (Ogg/Opus, produite par ElevenLabs). */
  async sendVoice(peer: string, audio: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append('chat_id', peer);
    form.append('voice', new Blob([audio], { type: 'audio/ogg' }), 'odin.ogg');
    await fetch(this.url('sendVoice'), { method: 'POST', body: form });
  }

  async stop(): Promise<void> { this.running = false; this.ctrl.abort(); }
}

const safeName = (n: string) => n.replace(/[^\w.\-À-ÿ ]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'fichier';
