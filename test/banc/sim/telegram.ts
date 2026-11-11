// Faux serveur « Bot API » de Telegram : parle le même protocole HTTP que api.telegram.org pour les
// méthodes dont Odin se sert (getMe, getUpdates en attente longue, sendMessage, sendPhoto en
// multipart, sendVoice, boutons…). Il sert à vérifier ce qu'Odin envoie VRAIMENT sur le réseau et à
// lui faire recevoir des messages, sans compte ni jeton réel. Rien ne part vers Telegram.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TgSent { method: string; chat_id: string; text?: string; caption?: string; parse_mode?: string; reply_markup?: unknown; disable_notification?: boolean; file?: { name: string; type: string; data: Buffer } }
export interface TgSim {
  /** Adresse à donner à Odin à la place de https://api.telegram.org */
  url: string; token: string;
  /** Tout ce qu'Odin a envoyé (messages, photos, vocaux), dans l'ordre. */
  sent: TgSent[];
  /** Tous les appels reçus (méthode + corps), pour les vérifications fines. */
  calls: Array<{ method: string; body: Record<string, unknown> }>;
  /** Quelqu'un écrit au bot. */
  say(chatId: number, text: string, from?: { id?: number; username?: string; first_name?: string }): void;
  /** Quelqu'un appuie sur un bouton sous un message. */
  press(chatId: number, data: string): void;
  close(): Promise<void>;
}

/** Découpe un corps multipart/form-data (champs et fichiers). */
export function parseMultipart(body: Buffer, contentType: string): Record<string, string | { name: string; type: string; data: Buffer }> {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType); if (!b) return {};
  const boundary = Buffer.from(`--${b[1] ?? b[2]}`), out: Record<string, string | { name: string; type: string; data: Buffer }> = {};
  let at = body.indexOf(boundary);
  while (at >= 0) {
    const next = body.indexOf(boundary, at + boundary.length); if (next < 0) break;
    const part = body.subarray(at + boundary.length + 2, next - 2), sep = part.indexOf('\r\n\r\n');
    if (sep > 0) {
      const head = part.subarray(0, sep).toString('utf8'), data = part.subarray(sep + 4);
      const name = /name="([^"]+)"/.exec(head)?.[1], file = /filename="([^"]*)"/.exec(head)?.[1];
      if (name) out[name] = file !== undefined ? { name: file, type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? '', data: Buffer.from(data) } : data.toString('utf8');
    }
    at = next;
  }
  return out;
}

export async function telegramSim(o: { token?: string; username?: string; hold?: number } = {}): Promise<TgSim> {
  const token = o.token ?? '123456:BANC-jeton-factice', sent: TgSent[] = [], calls: TgSim['calls'] = [];
  const queue: Array<Record<string, unknown>> = []; let updateId = 1000, messageId = 1;
  const waiters = new Set<() => void>();
  const srv: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x'), m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
      const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (!m) return json(404, { ok: false, error_code: 404, description: 'Not Found' });
      if (m[1] !== token) return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      const method = m[2], raw = Buffer.concat(parts), ct = String(req.headers['content-type'] ?? '');
      let body: Record<string, unknown> = Object.fromEntries(u.searchParams);
      let file: TgSent['file'];
      if (/multipart/.test(ct)) { for (const [k, v] of Object.entries(parseMultipart(raw, ct))) { if (typeof v === 'string') body[k] = v; else file = v; } }
      else if (raw.length) { try { body = { ...body, ...(JSON.parse(raw.toString('utf8')) as Record<string, unknown>) }; } catch { /* corps illisible */ } }
      calls.push({ method, body });
      const ok = (result: unknown) => json(200, { ok: true, result });
      switch (method) {
        case 'getMe': return ok({ id: 777, is_bot: true, first_name: 'Odin', username: o.username ?? 'odin_banc_bot' });
        case 'getUpdates': {
          const offset = Number(body.offset ?? 0);
          const take = () => { while (queue.length && Number(queue[0].update_id) < offset) queue.shift(); return [...queue]; };
          if (take().length) return ok(take());
          // Attente longue, écourtée pour que les essais restent vifs.
          const done = () => { clearTimeout(timer); waiters.delete(done); ok(take()); };
          const timer = setTimeout(done, o.hold ?? 1500); waiters.add(done);
          // Client parti avant la réponse (arrêt d'Odin) : on n'attend plus.
          res.on('close', () => { if (!res.writableEnded) { clearTimeout(timer); waiters.delete(done); } });
          return;
        }
        case 'sendMessage': case 'sendPhoto': case 'sendVoice': case 'sendSticker': case 'sendDocument': case 'sendAudio': {
          if (method === 'sendMessage' && !String(body.text ?? '').trim()) return json(400, { ok: false, error_code: 400, description: 'Bad Request: message text is empty' });
          if (method === 'sendPhoto' && String(body.caption ?? '').length > 1024) return json(400, { ok: false, error_code: 400, description: 'Bad Request: message caption is too long' });
          if (method === 'sendMessage' && String(body.text ?? '').length > 4096) return json(400, { ok: false, error_code: 400, description: 'Bad Request: message is too long' });
          sent.push({ method, chat_id: String(body.chat_id), text: body.text as string | undefined, caption: body.caption as string | undefined, parse_mode: body.parse_mode as string | undefined, reply_markup: body.reply_markup, disable_notification: body.disable_notification as boolean | undefined, file });
          return ok({ message_id: messageId++, chat: { id: Number(body.chat_id) }, date: Math.floor(Date.now() / 1000) });
        }
        case 'getStickerSet': return json(400, { ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' });
        case 'getFile': return json(400, { ok: false, error_code: 400, description: 'Bad Request: file not found' });
        default: return ok(true);
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const push = (u: Record<string, unknown>) => { queue.push({ update_id: updateId++, ...u }); for (const w of [...waiters]) w(); };
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, token, sent, calls,
    say: (chatId, text, from = {}) => push({ message: { message_id: messageId++, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: 'private' }, from: { id: from.id ?? chatId, is_bot: false, first_name: from.first_name ?? 'Propriétaire', username: from.username }, text } }),
    press: (chatId, data) => push({ callback_query: { id: String(updateId), data, from: { id: chatId, first_name: 'Propriétaire' }, message: { message_id: messageId - 1, chat: { id: chatId } } } }),
    close: () => new Promise<void>((r) => { for (const w of [...waiters]) w(); srv.closeAllConnections?.(); srv.close(() => r()); }),
  };
}
