// Canal WhatsApp, par l'API officielle WhatsApp Cloud (Meta) : aucune application tierce, aucun
// contournement. Il faut un compte Meta for Developers, un numéro WhatsApp Business et une adresse
// publique pour Odin (Accès → tunnel) : Meta envoie les messages à https://<adresse>/hook/whatsapp.
// Jetons : WHATSAPP_TOKEN (accès permanent), WHATSAPP_APP_SECRET (signature des messages reçus),
// WHATSAPP_VERIFY_TOKEN (phrase choisie, à recopier dans la console Meta).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { buttonsFor, buttonText, chunk, dropFile, type Channel, type Inbound, type MessagingOptions } from '../channel.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Signature Meta (X-Hub-Signature-256) d'un corps reçu. Pur. */
export function validSignature(raw: Uint8Array, header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Markdown → mise en forme WhatsApp (*gras*, liens en clair). Pur. */
export const waText = (md: string) => md.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

export class WhatsAppChannel implements Channel {
  readonly name = 'whatsapp';
  readonly interactive = true;
  private onMessage?: (m: Inbound) => Promise<void>;
  private token: string; private phoneId: string; private verify: string; private secret: string; private opts: MessagingOptions; private fetchFn: typeof fetch;
  constructor(cfg: { token: string; phoneId: string; verifyToken: string; appSecret: string }, opts: MessagingOptions = {}, fetchFn: typeof fetch = fetch) {
    this.token = cfg.token; this.phoneId = cfg.phoneId; this.verify = cfg.verifyToken; this.secret = cfg.appSecret; this.opts = opts; this.fetchFn = fetchFn;
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    if (!this.secret) throw new Error('WHATSAPP_APP_SECRET manquant : sans lui, n\'importe qui pourrait se faire passer pour Meta');
    this.onMessage = onMessage;
    console.log('[bifrost] WhatsApp prêt : messages reçus sur /hook/whatsapp');
  }

  /** Appelé par le serveur web pour /hook/whatsapp (sans jeton Odin : Meta signe chaque envoi). */
  async webhook(method: string, query: URLSearchParams, raw: Uint8Array, signature: string | undefined): Promise<{ status: number; body: string }> {
    if (method === 'GET') {
      // Vérification de l'abonnement par Meta
      const ok = query.get('hub.mode') === 'subscribe' && this.verify && query.get('hub.verify_token') === this.verify;
      return ok ? { status: 200, body: query.get('hub.challenge') ?? '' } : { status: 403, body: 'refusé' };
    }
    if (!validSignature(raw, signature, this.secret)) return { status: 401, body: 'signature invalide' };
    const data = JSON.parse(Buffer.from(raw).toString('utf8')) as { entry?: Array<{ changes?: Array<{ value?: { contacts?: Array<{ wa_id: string; profile?: { name?: string } }>; messages?: Array<Record<string, unknown>> } }> }> };
    for (const ch of (data.entry ?? []).flatMap((e) => e.changes ?? [])) {
      const names = new Map((ch.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? c.wa_id]));
      for (const m of ch.value?.messages ?? []) void this.onMsg(m, names).catch((e) => console.error('[whatsapp]', (e as Error).message));
    }
    return { status: 200, body: 'ok' };
  }

  private async media(id: string): Promise<{ data: Uint8Array; mime: string }> {
    const info = await (await this.fetchFn(`${GRAPH}/${id}`, { headers: { authorization: `Bearer ${this.token}` } })).json() as { url: string; mime_type: string; file_size?: number };
    if ((info.file_size ?? 0) > 50 * 1024 * 1024) throw new Error('fichier trop gros');
    const r = await this.fetchFn(info.url, { headers: { authorization: `Bearer ${this.token}` } });
    return { data: new Uint8Array(await r.arrayBuffer()), mime: info.mime_type };
  }

  private async onMsg(m: Record<string, unknown>, names: Map<string, string>): Promise<void> {
    const from = String(m.from ?? ''), type = String(m.type ?? '');
    if (!from || !this.onMessage) return;
    const name = names.get(from) ?? from;
    let text = '', voice = false;
    if (type === 'text') text = String((m.text as { body?: string })?.body ?? '');
    else if (type === 'interactive' || type === 'button') {
      const i = m.interactive as { button_reply?: { id: string } } | undefined;
      text = buttonText(i?.button_reply?.id ?? String((m.button as { payload?: string })?.payload ?? '')) ?? '';
    } else if (['audio', 'voice', 'image', 'document', 'video'].includes(type)) {
      const md = m[type] as { id: string; filename?: string; caption?: string };
      const f = await this.media(md.id);
      if (type === 'audio' && this.opts.transcribe) { text = await this.opts.transcribe(f.data, f.mime); voice = true; await this.send(from, `🎙 _${text.slice(0, 600)}_`); }
      else text = `${md.caption ? `${md.caption}\n\n` : ''}${await dropFile(this.opts.inbox, md.filename ?? `${type}.${f.mime.split('/')[1]?.split(';')[0] ?? 'bin'}`, f.mime, f.data)}`;
    }
    if (text.trim()) await this.onMessage({ channel: this.name, peer: from, name, text: text.trim(), voice });
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    const r = await this.fetchFn(`${GRAPH}/${this.phoneId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...body }) });
    if (!r.ok) throw new Error(`WhatsApp : envoi impossible (HTTP ${r.status} ${(await r.text()).slice(0, 200)})`);
  }

  async send(peer: string, text: string, opts: Parameters<Channel['send']>[2] = {}): Promise<void> {
    const parts = chunk(waText(text), 3800), btn = buttonsFor(opts ?? {}).slice(0, 3);
    for (const [k, part] of parts.entries()) {
      const last = k === parts.length - 1;
      if (last && btn.length && part.length <= 1024) {
        await this.post({ to: peer, type: 'interactive', interactive: { type: 'button', body: { text: part }, action: { buttons: btn.map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.label.slice(0, 20) } })) } } });
      } else await this.post({ to: peer, type: 'text', text: { body: part + (last && btn.length ? '\n\nRéponds « oui » ou « non ».' : ''), preview_url: false } });
    }
  }

  async sendVoice(peer: string, audio: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp'); form.append('type', 'audio/ogg');
    form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'odin.ogg');
    const up = await (await this.fetchFn(`${GRAPH}/${this.phoneId}/media`, { method: 'POST', headers: { authorization: `Bearer ${this.token}` }, body: form })).json() as { id?: string };
    if (up.id) await this.post({ to: peer, type: 'audio', audio: { id: up.id } });
  }

  async stop(): Promise<void> { this.onMessage = undefined; }
}
