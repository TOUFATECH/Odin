// Comète · partage de fichiers : demander des pairs à un tracker (HTTP(S) par le réseau vérifié de Comète, UDP selon
// BEP 15). Ce qui est envoyé : l'empreinte du partage, l'identifiant de pair ALÉATOIRE, un port, les compteurs. Rien
// de personnel (ni nom de machine, ni adresse). Réponses bornées (taille, nombre de pairs), lues comme des données.
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { dico, entier, lire, liste, octets, texte } from './bencode.ts';
import { adressePermise, portValide, resoudreSur, type Resoudre } from './garde.ts';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface Pair { ip: string; port: number }
export interface Annonce { empreinte: Buffer; idPair: Buffer; port: number; envoye: number; recu: number; reste: number; evenement?: 'started' | 'completed' | 'stopped' }
export interface Reponse { pairs: Pair[]; intervalle: number }
export const MAX_PAIRS_TRACKER = 200;

/** Les pairs « compacts » (6 octets IPv4, 18 octets IPv6), filtrés et bornés. Pur. */
export function pairsCompacts(b: Buffer, v6 = false, essai = false): Pair[] {
  const pas = v6 ? 18 : 6, out: Pair[] = [];
  for (let k = 0; k + pas <= b.length && out.length < MAX_PAIRS_TRACKER; k += pas) {
    const ip = v6 ? Array.from({ length: 8 }, (_, g) => b.readUInt16BE(k + g * 2).toString(16)).join(':') : `${b[k]}.${b[k + 1]}.${b[k + 2]}.${b[k + 3]}`;
    const port = b.readUInt16BE(k + pas - 2);
    if (portValide(port) && adressePermise(ip, essai)) out.push({ ip, port });
  }
  return out;
}
/** Lit la réponse bencodée d'un tracker HTTP. Pur. */
export function lireReponseHttp(b: Buffer, essai = false): Reponse {
  const d = dico(lire(b, { taille: 1024 * 1024, elements: 20_000 }).valeur); if (!d) throw new Error('réponse du tracker illisible');
  const raison = texte(d['failure reason']); if (raison) throw new Error(`le tracker refuse : ${raison.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120)}`);
  const pairs: Pair[] = [];
  const p = d.peers;
  if (Buffer.isBuffer(p)) pairs.push(...pairsCompacts(p, false, essai));
  else for (const e of liste(p) ?? []) { const x = dico(e), ip = texte(x?.ip), port = entier(x?.port); if (ip && port && portValide(port) && adressePermise(ip, essai)) pairs.push({ ip, port }); if (pairs.length >= MAX_PAIRS_TRACKER) break; }
  const p6 = octets(d.peers6); if (p6) pairs.push(...pairsCompacts(p6, true, essai));
  return { pairs: pairs.slice(0, MAX_PAIRS_TRACKER), intervalle: Math.min(3600, Math.max(60, entier(d.interval) ?? 1800)) };
}
const pourcent = (b: Buffer) => [...b].map((x) => (/[A-Za-z0-9.\-_~]/.test(String.fromCharCode(x)) ? String.fromCharCode(x) : `%${x.toString(16).padStart(2, '0').toUpperCase()}`)).join('');
/** L'adresse d'annonce HTTP. Pur. */
export function adresseAnnonce(tracker: string, a: Annonce): string {
  const u = new URL(tracker);
  const q = [`info_hash=${pourcent(a.empreinte)}`, `peer_id=${pourcent(a.idPair)}`, `port=${a.port}`, `uploaded=${a.envoye}`, `downloaded=${a.recu}`, `left=${a.reste}`, 'compact=1', 'numwant=80', ...(a.evenement ? [`event=${a.evenement}`] : [])].join('&');
  return `${u.origin}${u.pathname}${u.search ? `${u.search}&` : '?'}${q}`;
}
/** Annonce à un tracker HTTP(S) par le réseau vérifié (aucune redirection, réponse ≤ 1 Mo, 20 s). */
export async function annonceHttp(f: Fetch, tracker: string, a: Annonce, essai = false): Promise<Reponse> {
  const r = await f(adresseAnnonce(tracker, a), { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { accept: 'text/plain' } });
  if (r.status !== 200) { await r.body?.cancel().catch(() => undefined); throw new Error(`le tracker répond ${r.status}`); }
  const morceaux: Buffer[] = []; let n = 0; const lecteur = r.body?.getReader();
  if (lecteur) for (;;) { const { done, value } = await lecteur.read(); if (done) break; n += value.length; if (n > 1024 * 1024) { await lecteur.cancel().catch(() => undefined); throw new Error('réponse du tracker trop grosse'); } morceaux.push(Buffer.from(value)); }
  return lireReponseHttp(Buffer.concat(morceaux), essai);
}

/** Annonce à un tracker UDP (BEP 15) : connexion, puis annonce. Deux essais de 8 s au plus. */
export async function annonceUdp(tracker: string, a: Annonce, o: { resoudre: Resoudre; essai?: boolean; signal?: AbortSignal }): Promise<Reponse> {
  const u = new URL(tracker); const port = Number(u.port); if (!portValide(port)) throw new Error('tracker UDP sans port');
  const ip = await resoudreSur(u.hostname, o.resoudre, !!o.essai);
  const s = createSocket(ip.includes(':') ? 'udp6' : 'udp4');
  const attente = new Map<number, (b: Buffer) => void>();
  s.on('message', (m, rinfo) => { if (rinfo.address.replace(/^::ffff:/, '') !== ip || m.length < 8 || m.length > 65_536) return; const t = m.readUInt32BE(4); const f = attente.get(t); if (f) { attente.delete(t); f(m); } });
  s.on('error', () => undefined);
  const demander = (corps: (t: number) => Buffer): Promise<Buffer> => new Promise((ok, ko) => {
    let essais = 0; const t = randomBytes(4).readUInt32BE(0);
    const fin = (e?: Error, b?: Buffer) => { clearTimeout(h); attente.delete(t); o.signal?.removeEventListener('abort', stop); if (e) ko(e); else ok(b!); };
    const stop = () => fin(new Error('arrêté'));
    let h: NodeJS.Timeout;
    const envoyer = () => { if (essais++ >= 2) { fin(new Error('le tracker UDP ne répond pas')); return; } s.send(corps(t), port, ip); h = setTimeout(envoyer, 8000); };
    attente.set(t, (b) => fin(undefined, b)); o.signal?.addEventListener('abort', stop, { once: true }); envoyer();
  });
  try {
    const c = await demander((t) => { const b = Buffer.alloc(16); b.writeBigUInt64BE(0x41727101980n, 0); b.writeUInt32BE(0, 8); b.writeUInt32BE(t, 12); return b; });
    if (c.readUInt32BE(0) === 3) throw new Error(`le tracker refuse : ${c.subarray(8, 200).toString('utf8').replace(/[\u0000-\u001f]/g, ' ')}`);
    if (c.readUInt32BE(0) !== 0 || c.length < 16) throw new Error('réponse du tracker UDP illisible');
    const idc = c.subarray(8, 16);
    const ev = { started: 2, completed: 1, stopped: 3 }[a.evenement ?? 'x' as 'started'] ?? 0;
    const r = await demander((t) => {
      const b = Buffer.alloc(98); idc.copy(b, 0); b.writeUInt32BE(1, 8); b.writeUInt32BE(t, 12); a.empreinte.copy(b, 16); a.idPair.copy(b, 36);
      b.writeBigUInt64BE(BigInt(a.recu), 56); b.writeBigUInt64BE(BigInt(Math.max(0, a.reste)), 64); b.writeBigUInt64BE(BigInt(a.envoye), 72);
      b.writeUInt32BE(ev, 80); b.writeUInt32BE(0, 84); randomBytes(4).copy(b, 88); b.writeInt32BE(80, 92); b.writeUInt16BE(a.port, 96); return b;
    });
    if (r.readUInt32BE(0) === 3) throw new Error(`le tracker refuse : ${r.subarray(8, 200).toString('utf8').replace(/[\u0000-\u001f]/g, ' ')}`);
    if (r.readUInt32BE(0) !== 1 || r.length < 20) throw new Error('réponse du tracker UDP illisible');
    return { pairs: pairsCompacts(r.subarray(20), ip.includes(':'), !!o.essai), intervalle: Math.min(3600, Math.max(60, r.readUInt32BE(8))) };
  } finally { s.close(); }
}
