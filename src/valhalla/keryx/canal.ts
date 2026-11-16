// Les canaux de Kéryx : la porte par laquelle on le joint de dehors. La classe abstraite CanalBase porte la couche
// commune AUTH + TRACE ; CanalKeryx s'appuie sur une messagerie déjà native d'Odin (Telegram, Signal) comme transport,
// pour que « l'assistant qu'on texte » marche tout de suite, même sans ligne téléphonique.
//
// Deux crans avant d'agir : le numéro doit être CONNU (liste blanche), puis le CODE SECRET doit être prouvé (envoyé
// « code <xxx> »). Tant que les deux ne sont pas réunis, rien n'est transmis à Odin : on accueille, on demande le code,
// c'est tout. Chaque échange et chaque action sont tracés (chiffrés au repos).

import type { AgentEvent } from '../../types.ts';
import type { Channel, Inbound } from '../../bifrost/channel.ts';
import { entrer, type PasserelleKeryx } from './actions.ts';
import { estConnu, prouverSecret, secretValide, session, sessionEphemere, type Session, tropVite, verrouillee } from './auth.ts';
import { majAction, tracer } from './trace.ts';
import type { ReglagesKeryx } from './types.ts';

const ACCUEIL_INCONNU =
  'Bonjour. Je ne reconnais pas ce contact, donc je ne peux rien faire ici. Si tu es le propriétaire, ajoute ce ' +
  'numéro à la liste blanche dans la page Kéryx d\'Odin. (Je ne prends aucune capture d\'écran et je ne piste pas ta position.)';

/** Repère un code secret envoyé par message : « code 1234 », « secret: 1234 », « /code 1234 ». Rend le code, ou rien. */
export function extraireCode(texte: string): string | undefined {
  const m = /^\/?(?:code|secret)\s*:?\s*(\S.{0,62})$/i.exec(texte.trim());
  return m ? m[1].trim() : undefined;
}

export interface DecisionEntrant { repondre?: string; session: Session; transmettre: boolean; code: boolean }

/**
 * La porte d'authentification, pure et testable : à partir d'un message entrant et des réglages, dit quoi répondre et
 * s'il faut transmettre à Odin. Ne transmet jamais tant que le numéro n'est pas connu ET le secret prouvé.
 */
export function gererEntrant(home: string, reglages: ReglagesKeryx, inb: Inbound): DecisionEntrant {
  // Un pair inconnu n'obtient jamais rien : on ne matérialise aucune session durable pour lui (anti-fuite mémoire).
  const connu = estConnu(reglages.numeros, inb.peer);
  const s = connu ? session(inb.channel, inb.peer) : sessionEphemere(inb.channel, inb.peer);
  s.connu = connu;
  const code = extraireCode(inb.text);
  if (code !== undefined) {
    if (!s.connu) return { repondre: ACCUEIL_INCONNU, session: s, transmettre: false, code: true };
    const v = verrouillee(s);
    if (v) return { repondre: `⏳ Trop d'essais. Réessaie dans ${Math.ceil(v / 1000)} s.`, session: s, transmettre: false, code: true };
    const ok = prouverSecret(home, s, code);
    return {
      repondre: ok ? '✅ Code reconnu. Dis-moi ce dont tu as besoin (mails, agenda…) ; je te demande confirmation avant d\'envoyer.' : '❌ Code incorrect.',
      session: s, transmettre: false, code: true,
    };
  }
  if (!s.connu) return { repondre: ACCUEIL_INCONNU, session: s, transmettre: false, code: false };
  // On bloque la transmission UNIQUEMENT quand le secret n'est pas (ou plus) prouvé — pas parce que l'autonomie réglée
  // vaut 'prudent'. Un réglage 'prudent' laisse passer le message : c'est entrer() qui ajoute alors la consigne prudente.
  if (!secretValide(s)) return { repondre: 'Avant d\'agir, prouve ton code secret : envoie « code <ton code> ».', session: s, transmettre: false, code: false };
  return { session: s, transmettre: true, code: false };
}

/** Socle commun des canaux de Kéryx : l'enregistrement (Channel) et la couche auth/trace. */
export abstract class CanalBase implements Channel {
  abstract readonly name: string;
  readonly interactive = true;
  protected readonly home: string;
  protected readonly reglages: () => ReglagesKeryx;
  /** Les actions tracées « en attente », par (pair, outil), pour les mettre à jour à leur résolution (faite/refusée). */
  private readonly enCours = new Map<string, string>();
  protected constructor(home: string, reglages: () => ReglagesKeryx) { this.home = home; this.reglages = reglages; }

  /** Traite un message entrant du transport : débit, auth, trace, puis remise à Odin si les deux crans sont passés. */
  protected async traiter(inb: Inbound, repondre: (texte: string) => Promise<void>, gw: PasserelleKeryx): Promise<void> {
    // Anti-inondation : au-delà du débit permis par pair, on laisse tomber calmement (ni trace, ni réponse, ni session).
    if (tropVite(inb.channel, inb.peer)) return;
    const r = this.reglages();
    // Les données viennent de dehors : on borne la taille du texte avant toute trace ou transmission.
    const m: Inbound = inb.text.length > 4_000 ? { ...inb, text: inb.text.slice(0, 4_000) } : inb;
    const d = gererEntrant(this.home, r, m);
    const texteTrace = d.code ? '[code secret]' : m.text;
    if (d.transmettre) {
      await tracer({ quand: new Date().toISOString(), canal: this.name, pair: m.peer, sens: 'entrant', texte: texteTrace }).catch(() => {});
      await entrer(gw, m, d.session, r.autonomieApresSecret);
    } else {
      await tracer({ quand: new Date().toISOString(), canal: this.name, pair: m.peer, sens: 'entrant', texte: texteTrace }).catch(() => {});
      if (d.repondre) { await repondre(d.repondre).catch(() => {}); await tracer({ quand: new Date().toISOString(), canal: this.name, pair: m.peer, sens: 'sortant', texte: d.repondre }).catch(() => {}); }
    }
  }

  /**
   * Trace les actions (outils mail et calendar) qu'Odin lance depuis un message de Kéryx, et SUIT leur sort : l'entrée
   * part « en attente », puis passe à « faite » (tool_end ok) ou « refusée » (tool_end en échec, ou action bloquée).
   */
  protected tracerAction(peer: string, e: AgentEvent): void {
    const estAction = (n: string): boolean => /^(mail_|calendar_|agenda)/.test(n);
    if (e.type === 'tool_start' && estAction(e.name)) {
      const k = `${peer}\u0000${e.name}`;
      void tracer({ quand: new Date().toISOString(), canal: this.name, pair: peer, sens: 'action', texte: '', action: { outil: e.name, resume: resumeOutil(e.name, e.input), confirmee: false, gravite: 'important' }, resultat: 'en_attente' })
        .then((id) => { this.enCours.set(k, id); }).catch(() => {});
    } else if (e.type === 'tool_end' && estAction(e.name)) {
      const k = `${peer}\u0000${e.name}`; const id = this.enCours.get(k); this.enCours.delete(k);
      if (id) void majAction(id, { confirmee: e.ok, resultat: e.ok ? 'faite' : 'refusee' }).catch(() => {});
    } else if (e.type === 'blocked' && estAction(e.name)) {
      // Une action refusée avant même d'être lancée (pas de tool_start) : on la consigne quand même, « refusée ».
      void tracer({ quand: new Date().toISOString(), canal: this.name, pair: peer, sens: 'action', texte: '', action: { outil: e.name, resume: resumeOutil(e.name, {}), confirmee: false, gravite: 'important' }, resultat: 'refusee' }).catch(() => {});
    }
  }

  abstract start(onMessage: (m: Inbound) => Promise<void>): Promise<void>;
  abstract send(peer: string, text: string, opts?: Parameters<Channel['send']>[2]): Promise<void>;
  abstract stop(): Promise<void>;
}

/** Un résumé court et sans donnée privée d'une action d'outil. */
function resumeOutil(outil: string, input: Record<string, unknown>): string {
  const n = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).slice(0, 40) : '');
  if (outil === 'mail_send') return `écrire un mail à ${n('to') || '…'}`;
  if (outil === 'calendar_add' || outil === 'agenda') return `poser un rendez-vous (${n('title') || n('titre') || '…'})`;
  if (outil.startsWith('mail_')) return outil.replace('mail_', 'courrier : ');
  return outil;
}

/**
 * Le canal messagerie de Kéryx : il s'appuie sur un transport déjà natif d'Odin (une instance de Channel, ex. un bot
 * Telegram dédié) et y ajoute la couche auth/trace. Enregistré via gw.add(new CanalKeryx(...)).
 */
export class CanalKeryx extends CanalBase {
  readonly name = 'keryx';
  private readonly transport: Channel;
  constructor(home: string, transport: Channel, reglages: () => ReglagesKeryx) { super(home, reglages); this.transport = transport; }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    const gw: PasserelleKeryx = { handle: onMessage };
    await this.transport.start(async (m) => {
      const inb: Inbound = { ...m, channel: this.name };
      await this.traiter(inb, (t) => this.transport.send(inb.peer, t), gw);
    });
  }
  async send(peer: string, text: string, opts?: Parameters<Channel['send']>[2]): Promise<void> {
    await this.transport.send(peer, text, opts);
    void tracer({ quand: new Date().toISOString(), canal: this.name, pair: peer, sens: 'sortant', texte: text }).catch(() => {});
  }
  async typing(peer: string): Promise<void> { await this.transport.typing?.(peer); }
  async sendVoice(peer: string, audio: Uint8Array): Promise<void> { await this.transport.sendVoice?.(peer, audio); }
  event(peer: string, e: AgentEvent): void { this.transport.event?.(peer, e); this.tracerAction(peer, e); }
  get defaultPeer(): string | undefined { return this.transport.defaultPeer; }
  async stop(): Promise<void> { await this.transport.stop(); }
}
