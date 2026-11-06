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
  send(peer: string, text: string, opts?: { mood?: string; final?: boolean; approval?: { id: string; grantable?: boolean }; secret?: boolean }): Promise<void>;
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
