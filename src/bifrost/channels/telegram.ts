// Canal Telegram en API HTTP brute (long polling) : aucune dépendance.
// Texte, notes vocales (transcrites par Whisper) et fichiers (déposés dans l'espace de travail).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Channel, chunk, type Inbound } from '../channel.ts';
import { isMood, MOOD_EMOJI, MOOD_IDS, type Mood } from '../../mood/mood.ts';

export interface TelegramOptions {
  /** Transcrit une note vocale (Whisper) ; absent = les vocaux sont refusés poliment. */
  transcribe?(audio: Uint8Array, mime: string): Promise<string>;
  /** Dossier où déposer les fichiers reçus (PDF, Word, Excel, photos, vidéos…). */
  inbox?: string;
  /** Dossier d'Odin : on y retient les émojis de son visage (pack créé une fois). */
  home?: string;
  /** Propriétaire (identifiant Telegram) : le pack d'émojis est créé à son nom. */
  owner?: string;
}

/** Image 100×100 du visage d'Odin pour une humeur (émoji personnalisé). */
export function moodEmojiImage(mood: Mood): Uint8Array | undefined {
  const f = new URL(`../../mood/emoji/${mood}.webp`, import.meta.url);
  return existsSync(f) ? new Uint8Array(readFileSync(f)) : undefined;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * Markdown du modèle → HTML Telegram (gras, italique, code, blocs de code, liens, titres), pour ne
 * plus voir de « **…** » bruts. Pur, testable.
 */
export function tgHtml(md: string): string {
  const blocks: string[] = [];
  let s = md.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_m, code: string) => { blocks.push(`<pre>${esc(code.replace(/\n$/, ''))}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => { blocks.push(`<code>${esc(code)}</code>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, l: string, u: string) => `<a href="${u.replace(/"/g, '&quot;')}">${l}</a>`)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+?)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s.,;:!?)]|$)/gm, '$1<i>$2</i>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/^(\s*)[*-]\s+/gm, '$1• ');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, k: string) => blocks[Number(k)]);
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
  private username = '';
  /** Émoji personnalisé (visage d'Odin) par humeur, une fois le pack créé. */
  private faces: Partial<Record<Mood, string>> = {};
  private facesOff = 0;
  private facesPending?: Promise<void>;
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
    this.username = me.result?.username ?? '';
    try { if (this.opts.home) this.faces = JSON.parse(readFileSync(join(this.opts.home, 'telegram-faces.json'), 'utf8')) as Partial<Record<Mood, string>>; } catch { /* pas encore créé */ }
    this.running = true;
    void this.loop(onMessage);
  }

  private async loop(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        const res = await fetch(`${this.url('getUpdates')}?timeout=30&offset=${this.offset}&allowed_updates=["message"]`, { signal: this.ctrl.signal });
        const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: unknown }>; description?: string };
        if (!data.ok) throw new Error(`getUpdates : ${data.description ?? `HTTP ${res.status}`}`); // 401, 409… : on attend avant de réessayer
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

  private async call(method: string, body: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const r = await fetch(this.url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json() as { ok: boolean; result?: unknown; description?: string };
  }

  /** « Odin écrit… » en haut de la conversation (dure 5 s ; la passerelle le renouvelle). */
  async typing(peer: string): Promise<void> { await this.call('sendChatAction', { chat_id: peer, action: 'typing' }).catch(() => undefined); }

  /**
   * Pack d'émojis personnalisés « visage d'Odin » (une image 100×100 par humeur), créé une seule fois
   * au nom du propriétaire. Telegram n'affiche ces émojis dans les messages d'un bot que si son
   * propriétaire a Telegram Premium ; sinon on garde l'émoji classique.
   */
  private async ensureFaces(owner: string): Promise<void> {
    if (Object.keys(this.faces).length || !this.username || !/^\d+$/.test(owner)) return;
    const name = `odin_visage_by_${this.username}`.slice(0, 64);
    let set = await this.call('getStickerSet', { name });
    if (!set.ok) {
      const form = new FormData(), stickers: unknown[] = [];
      form.append('user_id', owner); form.append('name', name); form.append('title', 'Odin — humeurs'); form.append('sticker_type', 'custom_emoji');
      MOOD_IDS.forEach((m, k) => { const img = moodEmojiImage(m); if (img) { form.append(`f${k}`, new Blob([img], { type: 'image/webp' }), `${m}.webp`); stickers.push({ sticker: `attach://f${k}`, format: 'static', emoji_list: [MOOD_EMOJI[m]], keywords: [m] }); } });
      form.append('stickers', JSON.stringify(stickers));
      const r = await (await fetch(this.url('createNewStickerSet'), { method: 'POST', body: form })).json() as { ok: boolean; description?: string };
      if (!r.ok) throw new Error(`pack d'émojis : ${r.description}`);
      set = await this.call('getStickerSet', { name });
    }
    const list = (set.result as { stickers?: Array<{ custom_emoji_id?: string }> } | undefined)?.stickers ?? [];
    const withImg = MOOD_IDS.filter((m) => moodEmojiImage(m));
    withImg.forEach((m, k) => { const id = list[k]?.custom_emoji_id; if (id) this.faces[m] = id; });
    if (this.opts.home && Object.keys(this.faces).length) writeFileSync(join(this.opts.home, 'telegram-faces.json'), JSON.stringify(this.faces));
  }

  async send(peer: string, text: string, opts: { mood?: string } = {}): Promise<void> {
    const mood = isMood(opts.mood) ? opts.mood : undefined;
    // Son visage à la fin du texte, à la taille d'un émoji.
    if (mood && !Object.keys(this.faces).length && Date.now() > this.facesOff) {
      this.facesPending ??= this.ensureFaces(this.opts.owner ?? peer).catch((e) => { console.error('[telegram]', (e as Error).message); this.facesOff = Date.now() + 6 * 3600_000; }).finally(() => { this.facesPending = undefined; });
      await this.facesPending;
    }
    const parts = chunk(text);
    for (const [k, part] of parts.entries()) {
      const last = k === parts.length - 1;
      const face = last && mood ? (this.faces[mood] && Date.now() > this.facesOff ? ` <tg-emoji emoji-id="${this.faces[mood]}">${MOOD_EMOJI[mood]}</tg-emoji>` : ` ${MOOD_EMOJI[mood]}`) : '';
      let r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(part) + face, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => ({ ok: false, description: 'réseau' }));
      if (!r.ok && face.includes('tg-emoji')) {
        // Émoji personnalisé refusé (propriétaire sans Telegram Premium) : émoji classique, nouvel essai plus tard.
        this.facesOff = Date.now() + 6 * 3600_000;
        r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(part) + ` ${MOOD_EMOJI[mood!]}`, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => ({ ok: false }));
      }
      if (!r.ok) await this.call('sendMessage', { chat_id: peer, text: part + (last && mood ? ` ${MOOD_EMOJI[mood]}` : '') }).catch(() => undefined); // HTML refusé : texte brut
    }
  }

  /** Note vocale (Ogg/Opus, produite par ElevenLabs). */
  async sendVoice(peer: string, audio: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append('chat_id', peer);
    form.append('voice', new Blob([audio], { type: 'audio/ogg' }), 'odin.ogg');
    await fetch(this.url('sendVoice'), { method: 'POST', body: form });
  }

  /** Autocollant : le visage d'Odin selon son humeur. */
  async sendSticker(peer: string, webp: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append('chat_id', peer);
    form.append('sticker', new Blob([webp], { type: 'image/webp' }), 'odin.webp');
    await fetch(this.url('sendSticker'), { method: 'POST', body: form });
  }

  async stop(): Promise<void> { this.running = false; this.ctrl.abort(); }
}

const safeName = (n: string) => n.replace(/[^\w.\-À-ÿ ]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'fichier';
