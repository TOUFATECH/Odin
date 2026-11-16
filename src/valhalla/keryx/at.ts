// Pilote AT : le langage d'un modem GSM/LTE (clé USB avec la SIM du propriétaire). Écrit d'après le jeu de commandes
// public (normes 3GPP TS 27.005 pour les SMS, V.250 pour les commandes AT) — rien recopié d'un code sous licence.
//
// SMS en mode texte, enchaînement :
//   mise en route : AT · ATE0 (pas d'écho) · AT+CPIN? (la SIM est-elle prête) · AT+CMGF=1 (mode texte) · AT+CNMI=… (prévenir à l'arrivée)
//   reçu   : le modem envoie « +CMTI: "SM",<index> » → on lit avec AT+CMGR=<index> → « +CMGR: …,"<numéro>",… <ligne CR> <texte> »
//   envoyé : AT+CMGS="<numéro>" → le modem répond « > » → on envoie le texte puis Ctrl-Z (0x1A) → « +CMGS: <ref> » puis « OK »
//
// ATTENTION (dit honnêtement) : Node n'a aucune API série (ni débit, ni parité, ni mode brut). Lire/écrire le
// périphérique passe par node:fs, mais la configuration du port exige un outil du système (stty sous Linux, mode.com
// sous Windows), et sous Windows un handle COM se lit mal par sondage. D'où : « nécessite une brique série à préciser,
// non essayé sur du vrai matériel ». Ce fichier ne parle QUE le protocole (octets), au-dessus d'un flux déjà ouvert.

export const CTRL_Z = 0x1a;
export const ESC = 0x1b;

/** Les commandes de mise en route d'un modem pour les SMS en mode texte. */
export const INIT: readonly string[] = ['AT', 'ATE0', 'AT+CPIN?', 'AT+CMGF=1', 'AT+CNMI=2,1,0,0,0'];

/** Un numéro de téléphone propre pour une commande AT (chiffres et « + » seulement, borné). */
export function numeroPropre(numero: string): string {
  const n = numero.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 20);
  if (!/^\+?\d{3,}$/.test(n)) throw new Error('numéro invalide');
  return n;
}

/** La commande qui commence l'envoi d'un SMS (le modem répondra « > »). */
export const commandeEnvoi = (numero: string): string => `AT+CMGS="${numeroPropre(numero)}"`;
/** La commande qui lit un SMS reçu à un index donné. */
export const commandeLecture = (index: number): string => `AT+CMGR=${Math.max(0, Math.trunc(index))}`;

/** Un texte de SMS sûr pour le mode texte : pas de Ctrl-Z ni d'échappement caché, longueur bornée. */
export function texteSms(texte: string): string {
  return texte.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, 640);
}

export type Reponse =
  | { type: 'ok' }
  | { type: 'erreur'; detail: string }
  | { type: 'invite' }                              // « > » : le modem attend le texte
  | { type: 'arrivee'; index: number; stockage: string } // +CMTI
  | { type: 'message'; numero: string; texte: string }    // +CMGR
  | { type: 'envoye'; ref: number }                 // +CMGS
  | { type: 'sonnerie' }                            // RING / +CLIP
  | { type: 'appelant'; numero: string }            // +CLIP
  | { type: 'autre'; ligne: string };

/** Lit une ligne (ou le « > ») venue du modem et dit ce qu'elle veut dire. Analyse stricte, rejet calme de l'inconnu. */
export function lireLigne(ligne: string): Reponse | undefined {
  const l = ligne.replace(/[\r\n]+$/, '');
  if (l === '') return undefined;
  if (l === '>' || l === '> ') return { type: 'invite' };
  if (l === 'OK') return { type: 'ok' };
  if (l === 'ERROR' || /^\+CM[ES] ERROR:/.test(l)) return { type: 'erreur', detail: l };
  if (l === 'RING') return { type: 'sonnerie' };
  let m = /^\+CMTI:\s*"?([^",]*)"?\s*,\s*(\d+)/.exec(l);
  if (m) return { type: 'arrivee', stockage: m[1], index: Number(m[2]) };
  m = /^\+CMGS:\s*(\d+)/.exec(l);
  if (m) return { type: 'envoye', ref: Number(m[1]) };
  m = /^\+CLIP:\s*"([^"]*)"/.exec(l);
  if (m) return { type: 'appelant', numero: m[1] };
  // +CMGR: "REC READ","<numéro>","","<date>"  (le texte est sur la ligne suivante : géré par le lecteur ci-dessous)
  m = /^\+CMGR:\s*"[^"]*"\s*,\s*"([^"]*)"/.exec(l);
  if (m) return { type: 'message', numero: m[1], texte: '' };
  return { type: 'autre', ligne: l };
}

/**
 * Un lecteur qui transforme un flux d'octets du modem en réponses, ligne par ligne. Le « > » n'est pas suivi d'un saut
 * de ligne : il est repéré à part. Le texte d'un SMS lu suit la ligne « +CMGR: … » : on le rattache.
 */
export class LecteurModem {
  private tampon = '';
  private attenduCmgr?: { numero: string };
  /** Pousse des octets reçus, rend les réponses complètes trouvées. */
  pousser(octets: Uint8Array | string): Reponse[] {
    this.tampon += typeof octets === 'string' ? octets : Buffer.from(octets).toString('latin1');
    if (this.tampon.length > 64 * 1024) this.tampon = this.tampon.slice(-4096); // garde-fou anti-abus
    const out: Reponse[] = [];
    // D'abord les lignes complètes (terminées par un saut de ligne).
    let nl: number;
    while ((nl = this.tampon.indexOf('\n')) >= 0) {
      const ligne = this.tampon.slice(0, nl).replace(/\r$/, '');
      this.tampon = this.tampon.slice(nl + 1);
      if (this.attenduCmgr) { const num = this.attenduCmgr.numero; this.attenduCmgr = undefined; if (ligne.trim()) { out.push({ type: 'message', numero: num, texte: ligne }); continue; } }
      const r = lireLigne(ligne);
      if (!r) continue;
      if (r.type === 'message') { this.attenduCmgr = { numero: r.numero }; continue; }
      out.push(r);
    }
    // Le « > » d'invite n'a pas de fin de ligne : si ce qui reste est juste ce prompt (après les éventuels CR/LF déjà
    // consommés), c'est que le modem attend le texte du SMS.
    if (/^\s*>\s?$/.test(this.tampon) && this.tampon.includes('>')) { out.push({ type: 'invite' }); this.tampon = ''; }
    return out;
  }
}
