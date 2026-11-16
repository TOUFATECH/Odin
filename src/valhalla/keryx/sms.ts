// Le SMS par modem GSM/AT : pilote au-dessus d'un flux série déjà ouvert (la clé USB avec la SIM du propriétaire).
// Il parle le protocole d'at.ts (mode texte). Essayé contre un FAUX modem (keryx-sms.test.ts, via faux.ts), mais
// « codé, pas essayé sur du vrai matériel » : Node n'a pas d'API série (débit, parité, mode brut), la configuration du
// port exige une brique du système à préciser (stty / mode.com), et sous Windows un handle COM se lit mal. DÉSACTIVÉ
// par défaut (la page propose « aucune ligne »).

import { commandeEnvoi, commandeLecture, CTRL_Z, INIT, LecteurModem, type Reponse, texteSms } from './at.ts';
import { NON_ESSAYE } from './types.ts';

/** Un flux série minimal (ce qu'offre un périphérique ouvert par node:fs ou un socket). */
export interface FluxSerie {
  write(donnees: Uint8Array | string): void;
  on(evenement: 'data', ecouteur: (b: Buffer) => void): void;
  off(evenement: 'data', ecouteur: (b: Buffer) => void): void;
}

export const SMS_NOTE = NON_ESSAYE;

/** Pilote AT pour les SMS en mode texte. Reçoit un flux déjà ouvert et configuré (brique série hors de ce lot). */
export class PiloteAt {
  private lecteur = new LecteurModem();
  private surMessage?: (m: { numero: string; texte: string }) => void;
  private aLire: number[] = [];
  private readonly flux: FluxSerie;
  constructor(flux: FluxSerie) {
    this.flux = flux;
    this.flux.on('data', (b) => { for (const r of this.lecteur.pousser(b)) this.reagir(r); });
  }

  private reagir(r: Reponse): void {
    if (r.type === 'arrivee') { this.aLire.push(r.index); this.ecrire(commandeLecture(r.index)); }
    else if (r.type === 'message' && this.surMessage) this.surMessage({ numero: r.numero, texte: r.texte });
  }
  private ecrire(ligne: string): void { this.flux.write(ligne + '\r'); }

  /** Attend une réponse qui satisfait le prédicat (délai borné). */
  private attendre(predicat: (r: Reponse) => boolean, delai = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.flux.off('data', onData); reject(new Error('le modem ne répond pas')); }, delai);
      const onData = (b: Buffer) => { for (const r of this.lecteur.pousser(b)) { this.reagir(r); if (predicat(r)) { clearTimeout(t); this.flux.off('data', onData); resolve(); return; } } };
      this.flux.on('data', onData);
    });
  }

  /** Met le modem en route pour les SMS en mode texte. */
  async init(): Promise<void> {
    for (const c of INIT) { this.ecrire(c); await this.attendre((r) => r.type === 'ok' || r.type === 'erreur'); }
  }
  /** Envoie un SMS : commande → « > » → texte + Ctrl-Z → +CMGS. Rend la référence du modem. */
  async envoyer(numero: string, texte: string): Promise<number> {
    this.ecrire(commandeEnvoi(numero));
    await this.attendre((r) => r.type === 'invite');
    this.flux.write(texteSms(texte) + String.fromCharCode(CTRL_Z));
    let ref = -1;
    await this.attendre((r) => { if (r.type === 'envoye') { ref = r.ref; return true; } return r.type === 'erreur'; });
    if (ref < 0) throw new Error('le modem a refusé l\'envoi');
    return ref;
  }
  /** Écoute les SMS entrants. */
  onMessage(cb: (m: { numero: string; texte: string }) => void): void { this.surMessage = cb; }
}
