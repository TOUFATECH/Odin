// Bifröst — le pont entre Odin et les messageries. Un canal = une petite classe.
import type { AgentEvent } from '../types.ts';

export interface Inbound {
  channel: string;
  peer: string;
  name: string;
  text: string;
  /** Le message est arrivé en vocal (et a été transcrit). */
  voice?: boolean;
}

export interface Channel {
  readonly name: string;
  /** Le canal permet-il de répondre « /yes id » pour valider une action ? */
  readonly interactive: boolean;
  start(onMessage: (m: Inbound) => Promise<void>): Promise<void>;
  /** mood : l'humeur d'Odin, montrée à la fin du texte quand le canal sait le faire (son visage en émoji sur Telegram). */
  send(peer: string, text: string, opts?: { mood?: string; final?: boolean; approval?: { id: string; grantable?: boolean }; secret?: boolean; /** Rappel : boutons « C'est fait » / « Plus tard ». */ reminder?: { id: string }; /** Proposition d'habitude : boutons Oui / Non. */ habit?: { key: string } }): Promise<void>;
  /** « Odin écrit… » pendant qu'il travaille. */
  typing?(peer: string): Promise<void>;
  stop(): Promise<void>;
  /** Destinataire par défaut quand tout détenteur du jeton est propriétaire (interface web). */
  readonly defaultPeer?: string;
  /** Progression d'un tour (outils en cours…), pour les canaux qui savent l'afficher. */
  event?(peer: string, e: AgentEvent): void;
  /** Envoie une note vocale (Telegram). */
  sendVoice?(peer: string, audio: Uint8Array): Promise<void>;
  /** Autocollant (WEBP 512×512) : le visage d'Odin selon son humeur. */
  sendSticker?(peer: string, webp: Uint8Array): Promise<void>;
  /** Signale qu'une donnée a changé (inventaire, compétences…), pour rafraîchir l'affichage. */
  notify?(topic: string): void;
}

/** Découpe un long texte en morceaux sans couper au milieu d'une ligne si possible. */
export function chunk(text: string, size = 3900): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) out.push(rest);
  return out;
}

/** Bouton touché (Discord, Slack, WhatsApp) → commande texte comprise par la passerelle. Pur. */
export function buttonText(data: string): string | undefined {
  const ok = /^ok:(yes|no|always):(\S+)$/.exec(data); if (ok) return `/${ok[1]} ${ok[2]}`;
  const rm = /^rm:(done|10|60|tmw):(\S+)$/.exec(data); if (rm) return rm[1] === 'done' ? `/rappel done ${rm[2]}` : `/rappel later ${rm[2]} ${rm[1] === 'tmw' ? 0 : rm[1]}`;
  const hb = /^hb:(oui|non)$/.exec(data); if (hb) return `/habitude ${hb[1]}`;
  return undefined;
}

/** Boutons à montrer sous un message, selon ses options (validation, rappel, habitude). Pur. */
export function buttonsFor(opts: { approval?: { id: string; grantable?: boolean }; reminder?: { id: string }; habit?: { key: string } } = {}): Array<{ id: string; label: string }> {
  if (opts.approval) return [{ id: `ok:yes:${opts.approval.id}`, label: '✅ Oui' }, { id: `ok:no:${opts.approval.id}`, label: '❌ Non' }, ...(opts.approval.grantable ? [{ id: `ok:always:${opts.approval.id}`, label: 'Toujours' }] : [])];
  if (opts.reminder) { const id = opts.reminder.id.slice(0, 50); return [{ id: `rm:done:${id}`, label: '✅ C\'est fait' }, { id: `rm:60:${id}`, label: '⏰ Dans 1 h' }, { id: `rm:tmw:${id}`, label: '🌅 Demain' }]; }
  if (opts.habit) return [{ id: 'hb:oui', label: '✅ Oui' }, { id: 'hb:non', label: '❌ Non merci' }];
  return [];
}

/** Options communes aux canaux de messagerie (vocaux transcrits, fichiers déposés). */
export interface MessagingOptions {
  transcribe?(audio: Uint8Array, mime: string): Promise<string>;
  inbox?: string;
}

/** Dépose un fichier reçu dans la boîte d'Odin et renvoie la ligne à lui transmettre. */
export async function dropFile(inbox: string | undefined, name: string, mime: string, data: Uint8Array): Promise<string> {
  if (!inbox) return `[Fichier reçu mais non enregistré : ${name}]`;
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join, basename } = await import('node:path');
  mkdirSync(inbox, { recursive: true });
  const safe = basename(name).replace(/[^\w.\-À-ÿ ]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'fichier';
  const dest = join(inbox, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${safe}`);
  writeFileSync(dest, data);
  return `[Fichier reçu : inbox/${basename(dest)} (${mime || 'type inconnu'}, ${Math.round(data.byteLength / 1024)} Ko)]`;
}
