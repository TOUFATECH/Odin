// Þjálfi · serveur TFTP (RFC 1350, options 2347/2348/2349 : blksize, tsize, timeout), lecture seule.
// Il ne sert que le petit chargeur de démarrage (iPXE) ; tout le reste passe ensuite par HTTP, bien plus rapide.
// Chaque transfert a sa propre prise réseau (« TID »), avec renvoi en cas de perte. Écrit pour Odin.
import dgram from 'node:dgram';

const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5, OACK: 6 } as const;
export interface TftpDeps {
  /** Le fichier demandé (nom tel que reçu), ou undefined s'il n'existe pas. */
  file: (name: string, from: string) => Buffer | undefined | Promise<Buffer | undefined>;
  /** Après un envoi complet (pour suivre la machine). */
  sent?: (name: string, from: string, bytes: number) => void;
  log?: (s: string) => void;
}

/** Lit une demande de lecture : nom, mode et options. Pur. */
export function parseRequest(b: Buffer): { op: number; name: string; mode: string; opts: Record<string, string> } {
  const op = b.readUInt16BE(0), parts = b.subarray(2).toString('latin1').split('\0');
  const opts: Record<string, string> = {};
  for (let i = 2; i + 1 < parts.length; i += 2) if (parts[i]) opts[parts[i].toLowerCase()] = parts[i + 1];
  return { op, name: parts[0] ?? '', mode: (parts[1] ?? '').toLowerCase(), opts };
}
const err = (code: number, msg: string) => { const m = Buffer.from(msg, 'latin1'); const b = Buffer.alloc(5 + m.length); b.writeUInt16BE(OP.ERROR, 0); b.writeUInt16BE(code, 2); m.copy(b, 4); return b; };

export class TftpServer {
  sock?: dgram.Socket; port = 69; private d: TftpDeps; private active = new Set<dgram.Socket>();
  constructor(d: TftpDeps) { this.d = d; }
  async start(port = 69, host = '0.0.0.0'): Promise<void> {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((ok, ko) => { s.once('error', ko); s.bind(port, host, () => { s.off('error', ko); ok(); }); });
    s.on('message', (m, r) => { void this.onRequest(m, r).catch((e) => this.d.log?.(`TFTP : ${(e as Error).message}`)); });
    this.sock = s; this.port = (s.address() as { port: number }).port;
  }
  stop(): void { try { this.sock?.close(); } catch { /* */ } this.sock = undefined; for (const t of this.active) try { t.close(); } catch { /* */ } this.active.clear(); }

  private async onRequest(m: Buffer, r: dgram.RemoteInfo): Promise<void> {
    if (m.length < 4) return;
    const q = parseRequest(m);
    const t = dgram.createSocket('udp4'); this.active.add(t);
    await new Promise<void>((ok) => t.bind(0, ok));
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => { if (closed) return; closed = true; clearTimeout(timer); try { t.close(); } catch { /* */ } this.active.delete(t); };
    t.on('close', () => { closed = true; clearTimeout(timer); });
    const send = (b: Buffer) => { if (!closed) try { t.send(b, r.port, r.address); } catch { /* fermé */ } };
    if (q.op !== OP.RRQ) { send(err(2, 'lecture seule')); setTimeout(close, 200); return; }
    if (q.mode !== 'octet' && q.mode !== 'netascii') { send(err(0, 'mode inconnu')); setTimeout(close, 200); return; }
    const name = q.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.split('/').includes('..')) { send(err(2, 'accès refusé')); setTimeout(close, 200); return; }
    const data = await this.d.file(name, r.address);
    if (!data) { this.d.log?.(`TFTP : ${r.address} demande ${name} (absent)`); send(err(1, 'fichier absent')); setTimeout(close, 200); return; }
    // Options négociées.
    const oack: string[] = []; let blk = 512, timeout = 2;
    if (q.opts.blksize) { blk = Math.max(8, Math.min(65464, Number(q.opts.blksize) || 512, 1468)); oack.push('blksize', String(blk)); }
    if (q.opts.tsize !== undefined) oack.push('tsize', String(data.length));
    if (q.opts.timeout) { timeout = Math.max(1, Math.min(255, Number(q.opts.timeout) || 2)); oack.push('timeout', String(timeout)); }
    const total = Math.floor(data.length / blk) + 1; // le dernier bloc est plus court (éventuellement vide)
    let waitingFor = oack.length ? 0 : 1, tries = 0;
    const block = (n: number) => { const s = (n - 1) * blk, c = data.subarray(s, Math.min(data.length, s + blk)); const b = Buffer.alloc(4 + c.length); b.writeUInt16BE(OP.DATA, 0); b.writeUInt16BE(n & 0xffff, 2); c.copy(b, 4); return b; };
    const packet = () => (waitingFor === 0 ? Buffer.concat([Buffer.from([0, OP.OACK]), Buffer.from(`${oack.join('\0')}\0`, 'latin1')]) : block(waitingFor));
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (++tries > 5) { this.d.log?.(`TFTP : ${r.address} ne répond plus (${name})`); close(); return; } send(packet()); arm(); }, timeout * 1000); };
    t.on('message', (b, from) => {
      if (from.port !== r.port || from.address !== r.address) { try { t.send(err(5, 'mauvais correspondant'), from.port, from.address); } catch { /* */ } return; }
      const op = b.readUInt16BE(0);
      if (op === OP.ERROR) { clearTimeout(timer); close(); return; }
      if (op !== OP.ACK) return;
      const n = b.readUInt16BE(2);
      if (n !== (waitingFor & 0xffff)) return; // ACK en double : on attend le bon
      if (waitingFor >= total) { clearTimeout(timer); close(); this.d.sent?.(name, r.address, data.length); return; }
      waitingFor++; tries = 0; send(packet()); arm();
    });
    send(packet()); arm();
  }
}
