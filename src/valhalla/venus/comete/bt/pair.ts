// Comète · partage de fichiers : une connexion avec un pair (le protocole pair-à-pair, BEP 3, et l'extension BEP 10).
// Bornes : la poignée de main en 10 s, un message de 256 ko au plus (un morceau demandé fait 16 ko), ce qui attend
// d'être lu borné de même ; un pair qui dépasse est coupé. Rien n'est jamais exécuté : chaque message est une donnée.
import { Socket } from 'node:net';
import { dico, ecrire, entier, lire, octets, type Valeur } from './bencode.ts';

export const PROTOCOLE = Buffer.from('\x13BitTorrent protocol', 'latin1');
export const MAX_MESSAGE = 256 * 1024;
export const BLOC = 16 * 1024;
export const ID_EXT_METADONNEES = 3; // le numéro que NOUS donnons à ut_metadata dans notre poignée étendue

export type Message =
  | { t: 'choke' } | { t: 'unchoke' } | { t: 'interested' } | { t: 'notinterested' }
  | { t: 'have'; index: number } | { t: 'bitfield'; champ: Buffer }
  | { t: 'request'; index: number; debut: number; longueur: number } | { t: 'cancel'; index: number; debut: number; longueur: number }
  | { t: 'piece'; index: number; debut: number; bloc: Buffer } | { t: 'port'; port: number }
  | { t: 'ext'; id: number; dico: { [k: string]: Valeur }; suite: Buffer } | { t: 'keepalive' } | { t: 'inconnu' };

/** Découpe les messages d'un tampon. Rend les messages entiers et ce qui reste. Lève une erreur si un message est trop long. Pur. */
export function decouper(b: Buffer): { messages: Message[]; reste: Buffer } {
  const messages: Message[] = []; let i = 0;
  while (b.length - i >= 4) {
    const n = b.readUInt32BE(i);
    if (n > MAX_MESSAGE) throw new Error('message trop long');
    if (b.length - i - 4 < n) break;
    const m = b.subarray(i + 4, i + 4 + n); i += 4 + n;
    messages.push(lireMessage(m));
  }
  return { messages, reste: b.subarray(i) };
}
/** Un message (sans sa longueur). Pur. */
export function lireMessage(m: Buffer): Message {
  if (!m.length) return { t: 'keepalive' };
  const id = m[0], corps = m.subarray(1), n = corps.length;
  switch (id) {
    case 0: return { t: 'choke' };
    case 1: return { t: 'unchoke' };
    case 2: return { t: 'interested' };
    case 3: return { t: 'notinterested' };
    case 4: if (n !== 4) throw new Error('message « have » invalide'); return { t: 'have', index: corps.readUInt32BE(0) };
    case 5: return { t: 'bitfield', champ: Buffer.from(corps) };
    case 6: case 8: { if (n !== 12) throw new Error('demande invalide'); const x = { index: corps.readUInt32BE(0), debut: corps.readUInt32BE(4), longueur: corps.readUInt32BE(8) }; return id === 6 ? { t: 'request', ...x } : { t: 'cancel', ...x }; }
    case 7: if (n < 8) throw new Error('morceau invalide'); return { t: 'piece', index: corps.readUInt32BE(0), debut: corps.readUInt32BE(4), bloc: Buffer.from(corps.subarray(8)) };
    case 9: if (n !== 2) throw new Error('message « port » invalide'); return { t: 'port', port: corps.readUInt16BE(0) };
    case 20: {
      if (n < 1) throw new Error('message étendu invalide');
      const r = lire(corps.subarray(1), { reste: true, taille: MAX_MESSAGE, profondeur: 8, elements: 2000 }), d = dico(r.valeur);
      if (!d) throw new Error('message étendu invalide');
      return { t: 'ext', id: corps[0], dico: d, suite: Buffer.from(corps.subarray(1 + r.fin)) };
    }
    default: return { t: 'inconnu' };
  }
}
const cadre = (id: number, corps: Buffer = Buffer.alloc(0)) => { const b = Buffer.alloc(5 + corps.length); b.writeUInt32BE(1 + corps.length, 0); b[4] = id; corps.copy(b, 5); return b; };
const trois = (a: number, b: number, c: number) => { const x = Buffer.alloc(12); x.writeUInt32BE(a, 0); x.writeUInt32BE(b, 4); x.writeUInt32BE(c, 8); return x; };
export const ecrireMessage = {
  choke: () => cadre(0), unchoke: () => cadre(1), interested: () => cadre(2), notinterested: () => cadre(3),
  have: (i: number) => { const x = Buffer.alloc(4); x.writeUInt32BE(i, 0); return cadre(4, x); },
  bitfield: (c: Buffer) => cadre(5, c),
  request: (i: number, d: number, l: number) => cadre(6, trois(i, d, l)), cancel: (i: number, d: number, l: number) => cadre(8, trois(i, d, l)),
  piece: (i: number, d: number, bloc: Buffer) => { const x = Buffer.alloc(8 + bloc.length); x.writeUInt32BE(i, 0); x.writeUInt32BE(d, 4); bloc.copy(x, 8); return cadre(7, x); },
  ext: (id: number, d: { [k: string]: Valeur }, suite: Buffer = Buffer.alloc(0)) => cadre(20, Buffer.concat([Buffer.from([id]), ecrire(d), suite])),
  keepalive: () => Buffer.alloc(4),
};
/** La poignée de main : protocole, réservé (extension BEP 10), empreinte, identifiant de pair. Pur. */
export function poignee(empreinte: Buffer, idPair: Buffer): Buffer {
  const r = Buffer.alloc(8); r[5] |= 0x10;
  return Buffer.concat([PROTOCOLE, r, empreinte, idPair]);
}
/** Lit une poignée de main (68 octets). Pur. */
export function lirePoignee(b: Buffer): { empreinte: Buffer; idPair: Buffer; extension: boolean } {
  if (b.length < 68 || !b.subarray(0, 20).equals(PROTOCOLE)) throw new Error("ce pair ne parle pas le protocole");
  return { extension: (b[25] & 0x10) !== 0, empreinte: Buffer.from(b.subarray(28, 48)), idPair: Buffer.from(b.subarray(48, 68)) };
}

/** Champ de bits : a-t-il le morceau i ? Pur. */
export const aMorceau = (champ: Buffer, i: number): boolean => i >= 0 && (i >> 3) < champ.length && (champ[i >> 3] & (0x80 >> (i & 7))) !== 0;
export const poserBit = (champ: Buffer, i: number): void => { if ((i >> 3) < champ.length) champ[i >> 3] |= 0x80 >> (i & 7); };

/** Une connexion établie avec un pair (poignée de main faite). */
export class Connexion {
  private tampon: Buffer = Buffer.alloc(0);
  private ferme = false;
  extension = false; idDistant = Buffer.alloc(20);
  /** numéros que le pair a donnés à ses extensions (ut_metadata…) */ extDistantes: Record<string, number> = {};
  tailleMetadonnees?: number;
  readonly socket: Socket; readonly ip: string; readonly port: number;
  private surMessage: (m: Message) => void; private surFin: (raison: string) => void;
  constructor(socket: Socket, ip: string, port: number, surMessage: (m: Message) => void, surFin: (raison: string) => void) {
    this.socket = socket; this.ip = ip; this.port = port; this.surMessage = surMessage; this.surFin = surFin;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.recevoir(d));
    socket.on('error', (e) => this.fermer(`erreur (${(e as NodeJS.ErrnoException).code ?? 'réseau'})`));
    socket.on('close', () => this.fermer('connexion fermée'));
    socket.setTimeout(120_000, () => this.fermer('silence trop long'));
  }
  get ouverte(): boolean { return !this.ferme; }
  /** (aussi pour les octets reçus juste après la poignée de main) */
  recevoir(d: Buffer): void {
    if (this.ferme) return;
    this.tampon = this.tampon.length ? Buffer.concat([this.tampon, d]) : d;
    if (this.tampon.length > MAX_MESSAGE + 4 + 65_536) { this.fermer('trop de données en attente'); return; }
    let r: ReturnType<typeof decouper>;
    try { r = decouper(this.tampon); } catch (e) { this.fermer((e as Error).message); return; }
    this.tampon = Buffer.from(r.reste);
    for (const m of r.messages) { if (this.ferme) return; try { this.surMessage(m); } catch (e) { this.fermer(`message refusé : ${(e as Error).message}`); return; } }
  }
  envoyer(b: Buffer): boolean { if (this.ferme) return false; return this.socket.write(b); }
  /** Ce qui attend d'être envoyé (pour ne pas remplir la mémoire en servant les autres). */
  get enAttente(): number { return this.socket.writableLength; }
  fermer(raison = 'fermée'): void { if (this.ferme) return; this.ferme = true; this.socket.destroy(); this.surFin(raison); }
}

/** Ouvre une connexion SORTANTE vers un pair et fait la poignée de main (10 s au plus). */
export function connecter(ip: string, port: number, empreinte: Buffer, idPair: Buffer, signal?: AbortSignal): Promise<{ socket: Socket; distant: ReturnType<typeof lirePoignee>; reste: Buffer }> {
  return new Promise((ok, ko) => {
    const s = new Socket(); let recu = Buffer.alloc(0), fini = false;
    const fin = (e?: Error) => { if (fini) return; fini = true; clearTimeout(h); s.removeAllListeners('data'); signal?.removeEventListener('abort', stop); if (e) { s.destroy(); ko(e); } };
    const stop = () => fin(new Error('arrêté'));
    const h = setTimeout(() => fin(new Error('le pair ne répond pas')), 10_000);
    signal?.addEventListener('abort', stop, { once: true });
    s.on('error', (e) => fin(new Error(`connexion impossible (${(e as NodeJS.ErrnoException).code ?? 'erreur'})`)));
    s.connect({ host: ip, port }, () => { s.write(poignee(empreinte, idPair)); });
    s.on('data', (d) => {
      recu = Buffer.concat([recu, d]);
      if (recu.length < 68) { if (recu.length >= 20 && !recu.subarray(0, 20).equals(PROTOCOLE)) fin(new Error('ce pair ne parle pas le protocole')); return; }
      try {
        const distant = lirePoignee(recu);
        if (!distant.empreinte.equals(empreinte)) throw new Error("le pair n'a pas ce partage");
        if (distant.idPair.equals(idPair)) throw new Error('connexion à soi-même');
        const reste = recu.subarray(68); fin(); s.removeAllListeners('error'); s.on('error', () => undefined); ok({ socket: s, distant, reste });
      } catch (e) { fin(e as Error); }
    });
  });
}
/** La poignée de main étendue (BEP 10) : seulement ut_metadata ; pas de nom de logiciel, pas d'adresse. */
export const poigneeEtendue = (tailleMeta?: number, port?: number): Buffer => ecrireMessage.ext(0, { m: { ut_metadata: ID_EXT_METADONNEES }, reqq: 64, ...(tailleMeta ? { metadata_size: tailleMeta } : {}), ...(port ? { p: port } : {}) });
/** Lit la poignée étendue d'un pair. Pur. */
export function lirePoigneeEtendue(d: { [k: string]: Valeur }): { ext: Record<string, number>; tailleMeta?: number } {
  const m = dico(d.m) ?? {}, ext: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) { const n = entier(v); if (n !== undefined && n > 0 && n < 256 && k.length < 40) ext[k] = n; }
  const t = entier(d.metadata_size);
  return { ext, ...(t && t > 0 ? { tailleMeta: t } : {}) };
}
export const octetsDe = octets;
