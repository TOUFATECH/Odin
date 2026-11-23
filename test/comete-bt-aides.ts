// Aides des essais du moteur de partage de fichiers de Comète : un petit partage fabriqué, un faux tracker HTTP (par
// le réseau d'essai), un faux tracker UDP, un faux nœud DHT et de faux pairs, tous sur 127.0.0.1 (aucun Internet).
import { createHash, randomBytes } from 'node:crypto';
import { createServer as serveurHttp, type Server as ServeurHttp } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import { createSocket, type Socket as SocketUdp } from 'node:dgram';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ecrire, lire, dico, entier, type Valeur } from '../src/valhalla/venus/comete/bt/bencode.ts';
import { decouper, ecrireMessage, PROTOCOLE } from '../src/valhalla/venus/comete/bt/pair.ts';

export const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
export interface Fabrique { torrent: Buffer; info: Buffer; empreinte: Buffer; donnees: Buffer; tailleMorceau: number; video: Buffer; nbMorceaux: number }
/** Un partage de plusieurs fichiers : un texte, la vidéo voulue, un extrait (« sample »). */
export function fabriquer(o: { tailleVideo?: number; tailleMorceau?: number; chemins?: Valeur[]; trackers?: string[]; nom?: string } = {}): Fabrique {
  const tm = o.tailleMorceau ?? 32 * 1024;
  const video = Buffer.concat([EBML, randomBytes((o.tailleVideo ?? 300_000) - 4)]);
  const lisez = Buffer.from('Lisez-moi : fichier de test\n'.repeat(37)), extrait = Buffer.concat([EBML, randomBytes(5000)]);
  const fichiers = [{ p: ['Lisez-moi.txt'], b: lisez }, { p: ['Film.Essai.2024.1080p.mkv'], b: video }, { p: ['Sample', 'film-sample.mkv'], b: extrait }];
  const donnees = Buffer.concat(fichiers.map((f) => f.b));
  const pieces: Buffer[] = []; for (let d = 0; d < donnees.length; d += tm) pieces.push(createHash('sha1').update(donnees.subarray(d, d + tm)).digest());
  const infoD: Record<string, Valeur> = { name: Buffer.from(o.nom ?? 'Film Essai (2024)'), 'piece length': tm, pieces: Buffer.concat(pieces), files: fichiers.map((f, k) => ({ length: f.b.length, path: (o.chemins && k === 1 ? o.chemins : f.p.map((x) => Buffer.from(x))) as Valeur })) };
  const info = ecrire(infoD), empreinte = createHash('sha1').update(info).digest();
  const t: Record<string, Valeur> = { info: infoD };
  if (o.trackers?.length) t.announce = Buffer.from(o.trackers[0]);
  return { torrent: ecrire(t), info, empreinte, donnees, tailleMorceau: tm, video, nbMorceaux: pieces.length };
}

export interface OptionsPair { mauvais?: (i: number) => boolean; delaiBloc?: number; delaiUnchoke?: number; meta?: 'bonne' | 'fausse' | 'aucune'; partiel?: Set<number> }
export interface FauxPair { port: number; demandes: number; metaServies: number; connexions: number; fermer(): Promise<void>; o: OptionsPair }
/** Un faux pair qui a tout le partage (ou une partie) et le sert. */
export async function fauxPair(f: Fabrique, o: OptionsPair = {}): Promise<FauxPair> {
  const etat = { demandes: 0, metaServies: 0, connexions: 0 };
  const sockets = new Set<Socket>();
  const srv: Server = createServer((s) => {
    sockets.add(s); etat.connexions++; s.on('close', () => sockets.delete(s)); s.on('error', () => undefined);
    let tampon = Buffer.alloc(0), poignee = false, idMetaClient = 0;
    s.on('data', (d) => {
      tampon = Buffer.concat([tampon, d]);
      if (!poignee) {
        if (tampon.length < 68) return;
        if (!tampon.subarray(0, 20).equals(PROTOCOLE) || !tampon.subarray(28, 48).equals(f.empreinte)) { s.destroy(); return; }
        poignee = true; tampon = tampon.subarray(68);
        const r = Buffer.alloc(8); r[5] |= 0x10;
        s.write(Buffer.concat([PROTOCOLE, r, f.empreinte, Buffer.concat([Buffer.from('-FX0001-'), randomBytes(12)])]));
        const champ = Buffer.alloc(Math.ceil(f.nbMorceaux / 8)); for (let i = 0; i < f.nbMorceaux; i++) if (!o.partiel || o.partiel.has(i)) champ[i >> 3] |= 0x80 >> (i & 7);
        s.write(ecrireMessage.bitfield(champ));
        s.write(ecrireMessage.ext(0, o.meta === 'aucune' ? { m: {} } : { m: { ut_metadata: 2 }, metadata_size: f.info.length }));
      }
      const r = decouper(tampon); tampon = Buffer.from(r.reste);
      for (const m of r.messages) {
        if (m.t === 'interested') setTimeout(() => s.write(ecrireMessage.unchoke()), o.delaiUnchoke ?? 0);
        if (m.t === 'request') {
          etat.demandes++;
          let b = Buffer.from(f.donnees.subarray(m.index * f.tailleMorceau + m.debut, m.index * f.tailleMorceau + m.debut + m.longueur));
          if (o.mauvais?.(m.index)) b = randomBytes(b.length);
          const envoyer = () => { if (!s.destroyed) s.write(ecrireMessage.piece(m.index, m.debut, b)); };
          if (o.delaiBloc) setTimeout(envoyer, o.delaiBloc); else envoyer();
        }
        if (m.t === 'ext' && m.id === 0) { const x = dico(m.dico.m); idMetaClient = entier(x?.ut_metadata) ?? 0; }
        if (m.t === 'ext' && m.id === 2 && idMetaClient) {
          const k = entier(m.dico.piece) ?? 0; etat.metaServies++;
          const src = o.meta === 'fausse' ? randomBytes(f.info.length) : f.info;
          s.write(ecrireMessage.ext(idMetaClient, { msg_type: 1, piece: k, total_size: f.info.length }, src.subarray(k * 16384, (k + 1) * 16384)));
        }
      }
    });
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  return {
    port: (srv.address() as AddressInfo).port, o,
    get demandes() { return etat.demandes; }, get metaServies() { return etat.metaServies; }, get connexions() { return etat.connexions; },
    fermer: async () => { for (const s of sockets) s.destroy(); await new Promise<void>((ok) => srv.close(() => ok())); },
  } as FauxPair;
}
export const compact = (ports: number[]) => Buffer.concat(ports.map((p) => { const b = Buffer.alloc(6); b.set([127, 0, 0, 1]); b.writeUInt16BE(p, 4); return b; }));

/** Un faux serveur HTTP : le tracker (/announce) et les fichiers (.torrent). `pairs` peut changer pendant l'essai. */
export async function fauxHttp(o: { pairs: () => number[]; fichiers?: Record<string, Buffer> }): Promise<{ base: string; annonces: string[]; srv: ServeurHttp; local: typeof fetch }> {
  const annonces: string[] = [];
  const srv = serveurHttp((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/announce') { annonces.push(req.url!); res.writeHead(200); res.end(ecrire({ interval: 60, peers: compact(o.pairs()) })); return; }
    const b = o.fichiers?.[u.pathname]; if (b) { res.writeHead(200, { 'content-length': b.length }); res.end(b); return; }
    res.writeHead(404); res.end();
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const local: typeof fetch = (u, i) => fetch(String(u).replace(/^http:\/\/[a-z]+\.exemple\.test/, base), i);
  return { base, annonces, srv, local };
}

/** Un faux tracker UDP (BEP 15). */
export async function fauxUdp(pairs: () => number[]): Promise<{ port: number; s: SocketUdp; annonces: number }> {
  const s = createSocket('udp4'); const st = { annonces: 0 };
  s.on('message', (m, ri) => {
    const action = m.readUInt32BE(8), t = m.readUInt32BE(12);
    if (action === 0) { const r = Buffer.alloc(16); r.writeUInt32BE(0, 0); r.writeUInt32BE(t, 4); randomBytes(8).copy(r, 8); s.send(r, ri.port, ri.address); return; }
    if (action === 1) { st.annonces++; const h = Buffer.alloc(20); h.writeUInt32BE(1, 0); h.writeUInt32BE(t, 4); h.writeUInt32BE(60, 8); s.send(Buffer.concat([h, compact(pairs())]), ri.port, ri.address); }
  });
  s.bind(0, '127.0.0.1'); await once(s, 'listening');
  return { port: s.address().port, s, get annonces() { return st.annonces; } } as { port: number; s: SocketUdp; annonces: number };
}
/** Un faux nœud DHT : il répond à get_peers avec des pairs. */
export async function fauxDht(pairs: () => number[]): Promise<{ port: number; s: SocketUdp; questions: number }> {
  const s = createSocket('udp4'); const st = { questions: 0 };
  s.on('message', (m, ri) => {
    const d = dico(lire(m).valeur); if (!d) return; st.questions++;
    s.send(ecrire({ t: d.t as Buffer, y: Buffer.from('r'), r: { id: randomBytes(20), token: Buffer.from('jt'), values: pairs().map((p) => compact([p])) } }), ri.port, ri.address);
  });
  s.bind(0, '127.0.0.1'); await once(s, 'listening');
  return { port: s.address().port, s, get questions() { return st.questions; } } as { port: number; s: SocketUdp; questions: number };
}

/** Un faux pair qui n'a rien et demande ce qu'on lui annonce (pour vérifier l'envoi limité). */
export async function fauxDemandeur(f: Fabrique): Promise<{ port: number; recu: number; ferme: boolean; fermer(): Promise<void> }> {
  const st = { recu: 0, ferme: false }; const sockets = new Set<Socket>();
  const srv: Server = createServer((s) => {
    sockets.add(s); s.on('error', () => undefined); s.on('close', () => { st.ferme = true; sockets.delete(s); });
    let tampon = Buffer.alloc(0), poignee = false, libre = false; const aDemander: number[] = [];
    const demander = () => { while (libre && aDemander.length) { const i = aDemander.shift()!; const t = Math.min(f.tailleMorceau, f.donnees.length - i * f.tailleMorceau); for (let d = 0; d < t; d += 16384) s.write(ecrireMessage.request(i, d, Math.min(16384, t - d))); } };
    s.on('data', (d) => {
      tampon = Buffer.concat([tampon, d]);
      if (!poignee) {
        if (tampon.length < 68) return; poignee = true; tampon = tampon.subarray(68);
        s.write(Buffer.concat([PROTOCOLE, Buffer.alloc(8), f.empreinte, Buffer.concat([Buffer.from('-FX0002-'), randomBytes(12)])]));
        s.write(ecrireMessage.interested());
      }
      const r = decouper(tampon); tampon = Buffer.from(r.reste);
      for (const m of r.messages) {
        if (m.t === 'unchoke') { libre = true; demander(); }
        if (m.t === 'choke') libre = false;
        if (m.t === 'have') { aDemander.push(m.index); demander(); }
        if (m.t === 'bitfield') { for (let i = 0; i < f.nbMorceaux; i++) if (m.champ[i >> 3] & (0x80 >> (i & 7))) aDemander.push(i); demander(); }
        if (m.t === 'piece') st.recu += m.bloc.length;
      }
    });
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  return { port: (srv.address() as AddressInfo).port, get recu() { return st.recu; }, get ferme() { return st.ferme; }, fermer: async () => { for (const s of sockets) s.destroy(); await new Promise<void>((ok) => srv.close(() => ok())); } } as never;
}
