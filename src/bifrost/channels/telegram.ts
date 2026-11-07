// Canal Telegram en API HTTP brute (long polling) : aucune dépendance.
// Texte, notes vocales (transcrites par Whisper) et fichiers (déposés dans l'espace de travail).
import { extractSecret } from '../../machines/onboard.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Channel, chunk, type Inbound } from '../channel.ts';
import type { AgentEvent } from '../../types.ts';
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
  /** Montrer le travail en cours (compétences lues, commandes, scripts, recherches) dans un message qui se met à jour. Oui par défaut. */
  progress?: boolean;
}

/** Une ligne de progression lisible pour un outil (HTML Telegram). Pur, testable. */
export function progressLine(name: string, input: Record<string, unknown>): { key: string; html: string } {
  const v = (k: string) => String(input[k] ?? '');
  const short = (x: string, n = 70) => esc(x.replace(/\s+/g, ' ').trim().slice(0, n)) + (x.length > n ? '…' : '');
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.slice(0, 40); } };
  switch (name) {
    case 'skill_read': return { key: `skill:${v('name')}`, html: `📚 Compétence <b>${esc(v('name'))}</b>` };
    case 'shell': case 'machine_exec': { const cmd = v('command'), where = v('machine') || v('name'); return { key: `term:${cmd.slice(0, 40)}`, html: `💻 terminal${where ? ` · ${esc(where)}` : ''}\n<pre>${esc(cmd.split('\n').slice(0, 2).join('\n').slice(0, 140))}${cmd.length > 140 || cmd.split('\n').length > 2 ? ' …' : ''}</pre>` }; }
    case 'script_run': return { key: `script:${v('name')}`, html: `🐍 script <b>${esc(v('name'))}</b>${v('args') ? ` ${short(v('args'), 50)}` : ''}${v('where') && v('where') !== 'local' ? ` · ${esc(v('where'))}` : ''}` };
    case 'script_save': return { key: `save:${v('name')}`, html: `📝 script <b>${esc(v('name'))}</b> ${v('change') ? `amélioré : ${short(v('change'), 50)}` : 'écrit'}` };
    case 'web_search': return { key: `q:${v('query')}`, html: `🔎 ${short(v('query'))}` };
    case 'web_research': return { key: 'research', html: `🧪 recherche vérifiée : ${short(v('question'))}` };
    case 'web_fetch': case 'browser_open': return { key: `w:${host(v('url'))}`, html: `🌐 ${esc(host(v('url')))}` };
    case 'memory_search': case 'memory_profile': return { key: 'mem', html: `🧠 mémoire : ${short(v('query') || v('subject'), 50)}` };
    case 'memory_save': return { key: 'memsave', html: '🧠 je retiens' };
    case 'fs_write': case 'fs_edit': return { key: `fw:${v('path')}`, html: `✏️ ${esc(v('path').slice(-60))}` };
    case 'fs_read': case 'fs_list': return { key: `fr:${v('path')}`, html: `📄 ${esc(v('path').slice(-60) || '.')}` };
    case 'delegate': return { key: 'delegate', html: `👥 ${Array.isArray(input.tasks) ? input.tasks.length : ''} sous-agent(s) en parallèle` };
    case 'video_analyze': return { key: 'video', html: `🎬 vidéo : ${short(v('source'), 50)}` };
    case 'net_identify': case 'net_scan': case 'net_inventory': case 'net_security': return { key: `net:${name}:${v('ip')}`, html: `📡 ${esc(name.replace('net_', 'réseau '))}${v('ip') ? ` ${esc(v('ip'))}` : ''}` };
    case 'proxmox_list': case 'proxmox_action': return { key: `pve:${v('action')}:${v('vmid')}`, html: `🖥️ Proxmox ${esc(v('action'))} ${esc(v('vmid'))}` };
    case 'schedule_task': return { key: 'cron', html: `⏰ tâche planifiée : ${short(v('cron'), 30)}` };
    default: return { key: name, html: `⚙️ ${esc(name)}` };
  }
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

type TgCallback = { id: string; data?: string; from?: { id: number; first_name?: string }; message?: { message_id: number; chat: { id: number } } };
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
  /** Message de progression par conversation (comme Hermes : ce qu'Odin est en train de faire). */
  private prog = new Map<string, { id?: number; lines: Array<{ key: string; html: string; n: number }>; timer?: ReturnType<typeof setTimeout>; sending?: Promise<void> }>();
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
    if (m.text) {
      // Un mot de passe tapé dans Telegram : on efface aussi ton message de la conversation.
      if (extractSecret(m.text).secret && (m as { message_id?: number }).message_id) void this.call('deleteMessage', { chat_id: m.chat.id, message_id: (m as { message_id?: number }).message_id }).catch(() => undefined);
      return { ...base, text: m.text };
    }
    const vocal = m.voice ?? m.video_note;
    if (vocal) {
      if (!this.opts.transcribe) { await this.send(base.peer, '🎙 Les messages vocaux ne sont pas encore activés (Réglages → Voix).'); return undefined; }
      const { data } = await this.download(vocal);
      const text = await this.opts.transcribe(data, vocal.mime_type ?? 'audio/ogg');
      if (!text) { await this.send(base.peer, '🎙 Je n\'ai rien compris dans ce message vocal.'); return undefined; }
      // Ce qu'Odin a compris, en petit : tu vois tout de suite s'il t'a mal entendu.
      void this.call('sendMessage', { chat_id: m.chat.id, text: `🎙 <i>${esc(text.slice(0, 600))}</i>`, parse_mode: 'HTML', disable_notification: true, reply_to_message_id: (m as { message_id?: number }).message_id }).catch(() => undefined);
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
        const res = await fetch(`${this.url('getUpdates')}?timeout=30&offset=${this.offset}&allowed_updates=["message","callback_query"]`, { signal: this.ctrl.signal });
        const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: unknown; callback_query?: TgCallback }>; description?: string };
        if (!data.ok) throw new Error(`getUpdates : ${data.description ?? `HTTP ${res.status}`}`); // 401, 409… : on attend avant de réessayer
        backoff = 1000;
        for (const u of data.result ?? []) {
          this.offset = u.update_id + 1;
          if (u.callback_query) { void this.onButton(u.callback_query, onMessage).catch((e) => console.error('[telegram] bouton :', (e as Error).message)); continue; }
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

  /** Bouton Oui / Non / Toujours touché : on répond à la demande comme « /yes id ». */
  private async onButton(q: TgCallback, onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    if (/^up:(go|later)$/.test(q.data ?? '') && q.message) {
      const go = q.data === 'up:go';
      await this.call('answerCallbackQuery', { callback_query_id: q.id, text: go ? 'Mise à jour lancée' : 'D\'accord' }).catch(() => undefined);
      await this.call('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: go ? '⬆️ Mise à jour en cours…' : '⏸ Plus tard', callback_data: 'ok:done' }]] } }).catch(() => undefined);
      await onMessage({ channel: this.name, peer: String(q.from?.id ?? q.message.chat.id), name: q.from?.first_name ?? 'propriétaire', text: go ? '/update' : '/update plus tard' });
      return;
    }
    const hb = /^hb:(oui|non)$/.exec(q.data ?? '');
    if (hb && q.message) {
      await this.call('answerCallbackQuery', { callback_query_id: q.id, text: hb[1] === 'oui' ? 'C\'est noté' : 'Compris' }).catch(() => undefined);
      await this.call('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: hb[1] === 'oui' ? '✅ Je m\'en occupe' : '❌ Pas de routine', callback_data: 'ok:done' }]] } }).catch(() => undefined);
      await onMessage({ channel: this.name, peer: String(q.from?.id ?? q.message.chat.id), name: q.from?.first_name ?? 'propriétaire', text: `/habitude ${hb[1]}` });
      return;
    }
    // Rappel : « C'est fait » ou « Plus tard » (10 min, 1 h, demain matin)
    const r = /^rm:(done|10|60|tmw):(\S+)$/.exec(q.data ?? '');
    if (r && q.message) {
      const label = r[1] === 'done' ? '✅ Fait' : r[1] === 'tmw' ? '⏰ Demain matin' : `⏰ Dans ${r[1] === '10' ? '10 min' : '1 h'}`;
      await this.call('answerCallbackQuery', { callback_query_id: q.id, text: label }).catch(() => undefined);
      await this.call('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'ok:done' }]] } }).catch(() => undefined);
      await onMessage({ channel: this.name, peer: String(q.from?.id ?? q.message.chat.id), name: q.from?.first_name ?? 'propriétaire', text: r[1] === 'done' ? `/rappel done ${r[2]}` : `/rappel later ${r[2]} ${r[1] === 'tmw' ? 0 : r[1]}` });
      return;
    }
    const m = /^ok:(yes|no|always):(\S+)$/.exec(q.data ?? '');
    await this.call('answerCallbackQuery', { callback_query_id: q.id, text: m ? (m[1] === 'no' ? 'Refusé' : 'Autorisé') : '' }).catch(() => undefined);
    if (!m || !q.message) return;
    const label = m[1] === 'no' ? '❌ Refusé' : m[1] === 'always' ? '✅ Autorisé (et pour la suite)' : '✅ Autorisé';
    await this.call('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'ok:done' }]] } }).catch(() => undefined);
    await onMessage({ channel: this.name, peer: String(q.from?.id ?? q.message.chat.id), name: q.from?.first_name ?? 'propriétaire', text: `/${m[1]} ${m[2]}` });
  }

  private async call(method: string, body: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const r = await fetch(this.url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json() as { ok: boolean; result?: unknown; description?: string };
  }

  event(peer: string, e: AgentEvent): void {
    if (this.opts.progress === false || e.type !== 'tool_start') return;
    const p = this.prog.get(peer) ?? { lines: [] };
    this.prog.set(peer, p);
    const l = progressLine(e.name, e.input), last = p.lines.at(-1);
    if (last && last.key === l.key) last.n++; else p.lines.push({ ...l, n: 1 });
    if (p.lines.length > 25) p.lines.splice(0, p.lines.length - 25);
    if (!p.timer) p.timer = setTimeout(() => { p.timer = undefined; void this.flushProgress(peer); }, p.id ? 1200 : 400);
  }
  private async flushProgress(peer: string): Promise<void> {
    const p = this.prog.get(peer); if (!p || !p.lines.length) return;
    await p.sending;
    const text = p.lines.map((l) => `${l.html}${l.n > 1 ? ` (×${l.n})` : ''}`).join('\n');
    p.sending = (async () => {
      if (!p.id) { const r = await this.call('sendMessage', { chat_id: peer, text, parse_mode: 'HTML', disable_notification: true, link_preview_options: { is_disabled: true } }).catch(() => undefined); p.id = (r?.result as { message_id?: number } | undefined)?.message_id; }
      else await this.call('editMessageText', { chat_id: peer, message_id: p.id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => undefined);
    })();
    await p.sending;
  }
  /** Fin du travail : dernière mise à jour du message de progression, puis on repart à zéro. */
  private async endProgress(peer: string): Promise<void> {
    const p = this.prog.get(peer); if (!p) return;
    if (p.timer) { clearTimeout(p.timer); p.timer = undefined; await this.flushProgress(peer); }
    await p.sending;
    this.prog.delete(peer);
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

  async send(peer: string, text: string, opts: { mood?: string; final?: boolean; approval?: { id: string; grantable?: boolean }; secret?: boolean; reminder?: { id: string }; habit?: { key: string }; update?: { version: string } } = {}): Promise<void> {
    const mood = isMood(opts.mood) ? opts.mood : undefined;
    if (opts.final || mood) await this.endProgress(peer); // réponse finale : le message de progression est terminé
    // Son visage à la fin du texte, à la taille d'un émoji.
    if (mood && !Object.keys(this.faces).length && Date.now() > this.facesOff) {
      this.facesPending ??= this.ensureFaces(this.opts.owner ?? peer).catch((e) => { console.error('[telegram]', (e as Error).message); this.facesOff = Date.now() + 6 * 3600_000; }).finally(() => { this.facesPending = undefined; });
      await this.facesPending;
    }
    // Message secret (nouveau mot de passe) : masqué sous un voile, non transférable, effacé au bout de 10 minutes.
    if (opts.secret) {
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const lines = text.split('\n'), html = lines.map((l, k) => k === 1 ? `<tg-spoiler><code>${esc(l)}</code></tg-spoiler>` : esc(l)).join('\n');
      const r = await this.call('sendMessage', { chat_id: peer, text: html, parse_mode: 'HTML', protect_content: true }) as { ok: boolean; result?: { message_id: number } };
      if (r.ok && r.result) { const id = r.result.message_id; setTimeout(() => { void this.call('deleteMessage', { chat_id: peer, message_id: id }).catch(() => undefined); }, 600_000).unref?.(); }
      return;
    }
    // Nouvelle version : bouton « Mettre à jour ».
    if (opts.update) {
      const r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(text), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬆️ Mettre à jour', callback_data: 'up:go' }, { text: 'Plus tard', callback_data: 'up:later' }]] } }).catch(() => ({ ok: false }));
      if (r.ok) return;
    }
    // Habitude repérée : Oui / Non sous la proposition.
    if (opts.habit) {
      const kb = [[{ text: '✅ Oui, fais-le tout seul', callback_data: 'hb:oui' }, { text: '❌ Non merci', callback_data: 'hb:non' }]];
      const r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(text), parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => ({ ok: false }));
      if (r.ok) return;
    }
    // Rappel : boutons sous le message, pour le régler ou le repousser d'un geste.
    if (opts.reminder) {
      const id = opts.reminder.id.slice(0, 50);
      const kb = [[{ text: '✅ C\'est fait', callback_data: `rm:done:${id}` }], [{ text: '⏰ 10 min', callback_data: `rm:10:${id}` }, { text: '⏰ 1 h', callback_data: `rm:60:${id}` }, { text: '🌅 Demain', callback_data: `rm:tmw:${id}` }]];
      const r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(text), parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => ({ ok: false }));
      if (r.ok) return;
    }
    // Demande de validation : boutons Oui / Non (et « Toujours ») sous le message, sans rien taper.
    if (opts.approval) {
      const id = opts.approval.id, body = text.replace(/\s*Réf\. \/yes \S+/, '').replace(/^Réponds oui ou non/m, 'Touche un bouton, ou réponds oui ou non');
      const kb = [[{ text: '✅ Oui', callback_data: `ok:yes:${id}` }, { text: '❌ Non', callback_data: `ok:no:${id}` }], ...(opts.approval.grantable ? [[{ text: 'Toujours autoriser', callback_data: `ok:always:${id}` }]] : [])];
      const r = await this.call('sendMessage', { chat_id: peer, text: tgHtml(body), parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => ({ ok: false }));
      if (r.ok) return;
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
