// L'appel téléphonique de Kéryx par une ligne SIP/VoIP du propriétaire : signalisation SIP (sip.ts), son en RTP
// (rtp.ts) au codec G.711 (g711.ts), le tout en pur Node (node:dgram). La voix d'Odin boucle au-dessus : ce que dit
// l'appelant est transcrit (Écho/Whisper), le Cerveau décide, une synthèse (Piper) répond.
//
// « CODÉ, PAS ESSAYÉ SUR DU VRAI MATÉRIEL » : le protocole est prouvé contre un FAUX serveur (keryx-sip.test.ts), mais
// aucun vrai appel n'a eu lieu. Honnêtement : sur un petit processeur sans carte graphique, le tour « écoute → pense →
// parle » prend plusieurs secondes — Kéryx au téléphone marche comme un talkie-walkie, pas comme une conversation
// fluide. DÉSACTIVÉ par défaut ; la page propose « aucune ligne ».

import { createSocket, type Socket } from 'node:dgram';
import { CHARGE_RTP, type Codec, encoder } from './g711.ts';
import { construirePaquet, OrdonnanceurEcheance } from './rtp.ts';
import { ecrireMessage, enteteAutorisation, jeton, lireDefi, lireMessage } from './sip.ts';
import { NON_ESSAYE } from './types.ts';

export const APPEL_NOTE = NON_ESSAYE;

export interface ReglagesSip { serveur: string; port?: number; utilisateur: string; motDePasse: string; ipLocale?: string }

/** Une ligne SIP : s'enregistrer, et pousser un flux audio RTP pendant un appel. Non essayé sur du vrai matériel. */
export class LigneSip {
  private sock?: Socket;
  private readonly r: ReglagesSip;
  constructor(r: ReglagesSip) { this.r = r; }

  private envoyer(texte: string): void {
    const [hote, p] = this.r.serveur.split(':');
    this.sock?.send(texte, Number(p) || this.r.port || 5060, hote);
  }

  /** S'enregistre auprès du serveur (REGISTER → 401 → digest → 200). Rend vrai si le 200 est reçu à temps. */
  async enregistrer(delai = 5000): Promise<boolean> {
    this.sock = createSocket('udp4');
    await new Promise<void>((resolve) => this.sock!.bind(0, resolve));
    const uri = `sip:${this.r.utilisateur}@${this.r.serveur.split(':')[0]}`;
    const callId = jeton(16);
    const en = (seq: string, auth?: string): Record<string, string> => ({
      Via: `SIP/2.0/UDP ${this.r.ipLocale ?? '127.0.0.1'};branch=z9hG4bK${jeton(8)}`,
      From: `<${uri}>;tag=${jeton(6)}`, To: `<${uri}>`, 'Call-ID': callId, CSeq: seq, 'Max-Forwards': '70',
      ...(auth ? { Authorization: auth } : {}),
    });
    return await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => { this.sock?.removeAllListeners('message'); resolve(false); }, delai);
      this.sock!.on('message', (buf) => {
        const m = lireMessage(buf.toString('utf8'));
        if (!m?.code) return;
        if (m.code === 401 || m.code === 407) {
          const defi = lireDefi(m.entetes['www-authenticate'] ?? m.entetes['proxy-authenticate'] ?? '');
          if (!defi) { clearTimeout(t); resolve(false); return; }
          const autor = enteteAutorisation({ username: this.r.utilisateur, password: this.r.motDePasse, uri, method: 'REGISTER', defi });
          this.envoyer(ecrireMessage(`REGISTER ${uri} SIP/2.0`, en('2 REGISTER', autor)));
        } else if (m.code === 200) { clearTimeout(t); resolve(true); }
        else if (m.code >= 400) { clearTimeout(t); resolve(false); }
      });
      this.envoyer(ecrireMessage(`REGISTER ${uri} SIP/2.0`, en('1 REGISTER')));
    });
  }

  /** Arrête la ligne. */
  arreter(): void { try { this.sock?.close(); } catch { /* */ } this.sock = undefined; }
}

/**
 * Pousse un flux audio (échantillons 16 bits à 8 kHz) en paquets RTP de 20 ms (160 échantillons), avec l'ordonnanceur à
 * échéance absolue qui tient le rythme. `emettre` envoie le paquet (vers le pair RTP). Rend une fonction d'arrêt.
 */
export function emettreRtp(opts: { codec: Codec; ssrc: number; prochainBloc: () => Int16Array | undefined; emettre: (paquet: Uint8Array) => void }): () => void {
  let sequence = (Math.random() * 0xffff) | 0;
  let horodatage = (Math.random() * 0xffffffff) >>> 0;
  const ordo = new OrdonnanceurEcheance(20, () => {
    const bloc = opts.prochainBloc();
    if (!bloc) return;
    const charge = encoder(opts.codec, bloc);
    opts.emettre(construirePaquet({ charge: CHARGE_RTP[opts.codec], sequence, horodatage, ssrc: opts.ssrc }, charge));
    sequence = (sequence + 1) & 0xffff;
    horodatage = (horodatage + bloc.length) >>> 0;
  });
  ordo.demarrer();
  return () => ordo.arreter();
}
