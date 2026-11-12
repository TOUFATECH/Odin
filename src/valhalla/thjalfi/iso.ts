// Þjálfi · lecture d'une ISO sans la monter ni l'extraire : ISO 9660 (avec les noms Rock Ridge et Joliet) et
// UDF (les ISO de Windows, dont la partie ISO 9660 ne contient qu'un fichier « lisez-moi »).
// Odin lit seulement les morceaux utiles (noyau, initrd, fichiers d'installation) et les sert aux machines
// qui démarrent par le réseau, directement depuis le fichier .iso d'Eitri. Écrit pour Odin (rien de copié).
import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';

const SECTOR = 2048;
/** Un morceau d'un fichier dans l'image : position et longueur en octets. */
interface Extent { at: number; len: number }
export interface IsoEntry { name: string; dir: boolean; size: number }
interface Node { name: string; dir: boolean; size: number; extents: Extent[]; inline?: Buffer; udf?: { part: number; lbn: number } }

const u16 = (b: Buffer, o: number) => b.readUInt16LE(o), u32 = (b: Buffer, o: number) => b.readUInt32LE(o);

export class Iso {
  readonly path: string; private fh?: FileHandle;
  private roots: Array<{ kind: 'rr' | 'joliet' | 'iso' | 'udf'; root: Node }> = [];
  private dirs = new Map<string, Node[]>();
  private udf?: { partStart: number; block: number };
  label = '';
  private constructor(path: string) { this.path = path; }

  static async open(path: string): Promise<Iso> {
    const i = new Iso(path); i.fh = await open(path, 'r');
    try { await i.load(); } catch (e) { await i.close(); throw e; }
    return i;
  }
  async close(): Promise<void> { await this.fh?.close().catch(() => undefined); this.fh = undefined; }
  private async read(at: number, len: number): Promise<Buffer> {
    const b = Buffer.alloc(len); const { bytesRead } = await this.fh!.read(b, 0, len, at); return bytesRead === len ? b : b.subarray(0, bytesRead);
  }

  // ---------------- Chargement : descripteurs de volume ----------------
  private async load(): Promise<void> {
    let pvd: Buffer | undefined, joliet: Buffer | undefined;
    for (let s = 16; s < 64; s++) {
      const d = await this.read(s * SECTOR, SECTOR); if (d.length < SECTOR) break;
      const id = d.toString('latin1', 1, 6);
      if (id !== 'CD001') { if (id === 'BEA01' || id === 'NSR02' || id === 'NSR03' || id === 'TEA01') continue; break; }
      if (d[0] === 1 && !pvd) pvd = d;
      else if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90])) joliet = d;
      else if (d[0] === 255) break;
    }
    if (pvd) {
      this.label = pvd.toString('latin1', 40, 72).trim();
      const root = this.record(pvd.subarray(156, 190), 'iso');
      if (root) {
        // Rock Ridge ? (signature « SP » ou « RR »/« NM » dans le premier enregistrement du dossier racine)
        const first = await this.read(root.extents[0].at, Math.min(SECTOR, root.size));
        const rr = first[0] > 34 && /SP|RR|NM|PX/.test(first.toString('latin1', 34 + (first[32] % 2 === 0 ? 1 : 0), first[0]));
        this.roots.push({ kind: rr ? 'rr' : 'iso', root });
      }
    }
    if (joliet) { const root = this.record(joliet.subarray(156, 190), 'joliet'); if (root) this.roots.push({ kind: 'joliet', root }); if (!this.label) this.label = joliet.subarray(40, 72).swap16().toString('utf16le').trim(); }
    // UDF : ancre à l'adresse 256.
    try { await this.loadUdf(); } catch { /* pas d'UDF */ }
    if (!this.roots.length) throw new Error('ce fichier n\'est pas une ISO lisible (ni ISO 9660 ni UDF)');
    // Ordre de préférence : Rock Ridge (vrais noms), Joliet, UDF, ISO 9660 nu. Mais si l'ISO 9660 est presque vide
    // (Windows : un seul « README.TXT »), l'UDF passe devant.
    const order = { rr: 0, joliet: 1, udf: 2, iso: 3 } as const;
    this.roots.sort((a, b) => order[a.kind] - order[b.kind]);
    const udf = this.roots.find((r) => r.kind === 'udf');
    if (udf && this.roots[0] !== udf) { const top = await this.children(this.roots[0].root, this.roots[0].kind); if (top.length <= 2) { this.roots = [udf, ...this.roots.filter((r) => r !== udf)]; } }
  }

  /** Un enregistrement de dossier ISO 9660. */
  private record(r: Buffer, kind: 'rr' | 'joliet' | 'iso'): Node | undefined {
    const len = r[0]; if (len < 34) return undefined;
    const at = u32(r, 2) * SECTOR, size = u32(r, 10), flags = r[25], nl = r[32];
    let name = kind === 'joliet' ? Buffer.from(r.subarray(33, 33 + (nl & ~1))).swap16().toString('utf16le') : r.toString('latin1', 33, 33 + nl);
    if (nl === 1 && (r[33] === 0 || r[33] === 1)) name = r[33] === 0 ? '.' : '..';
    else {
      name = name.replace(/;\d+$/, '');
      if (kind !== 'joliet') name = name.replace(/\.$/, '');
      if (kind === 'rr') { const nm = this.rrName(r.subarray(33 + nl + (nl % 2 === 0 ? 1 : 0), len)); if (nm) name = nm; }
    }
    return { name, dir: (flags & 2) !== 0, size, extents: [{ at, len: size }], ...(flags & 0x80 ? { more: true } : {}) } as Node;
  }
  /** Le vrai nom (Rock Ridge « NM ») dans la zone système d'un enregistrement. */
  private rrName(su: Buffer): string | undefined {
    let p = 0, out = '';
    while (p + 4 <= su.length) {
      const sig = su.toString('latin1', p, p + 2), l = su[p + 2]; if (l < 4 || p + l > su.length) break;
      if (sig === 'NM') { const f = su[p + 4]; if (!(f & 6)) out += su.toString('utf8', p + 5, p + l); }
      p += l;
    }
    return out || undefined;
  }

  // ---------------- UDF (ISO de Windows) ----------------
  private async loadUdf(): Promise<void> {
    const avdp = await this.read(256 * SECTOR, SECTOR); if (u16(avdp, 0) !== 2) return;
    const vdsLen = u32(avdp, 16), vdsAt = u32(avdp, 20);
    let partStart = -1, block = SECTOR, fsd: { lbn: number } | undefined;
    for (let i = 0; i < Math.min(64, Math.ceil(vdsLen / SECTOR)); i++) {
      const d = await this.read((vdsAt + i) * SECTOR, SECTOR), tag = u16(d, 0);
      if (tag === 5) partStart = u32(d, 188);
      else if (tag === 6) { block = u32(d, 212) || SECTOR; fsd = { lbn: u32(d, 252) }; if (!this.label) { const l = d.subarray(84, 84 + 128); this.label = dstring(l.subarray(0, l[127] || 0)) || this.label; } }
      else if (tag === 8) break;
    }
    if (partStart < 0 || !fsd) return;
    this.udf = { partStart, block };
    const f = await this.read(this.lba(fsd.lbn), block); if (u16(f, 0) !== 256) return;
    const rootIcb = u32(f, 404);
    const root = await this.udfNode(rootIcb, '');
    if (root) this.roots.push({ kind: 'udf', root });
  }
  private lba(lbn: number): number { return (this.udf!.partStart * SECTOR) + lbn * this.udf!.block; }
  /** Lit une « entrée de fichier » UDF (simple ou étendue) et rend ses morceaux. */
  private async udfNode(lbn: number, name: string): Promise<Node | undefined> {
    const e = await this.read(this.lba(lbn), this.udf!.block), tag = u16(e, 0);
    if (tag !== 261 && tag !== 266) return undefined;
    const ftype = e[27], adType = u16(e, 34) & 7, size = Number(e.readBigUInt64LE(56));
    const [lEa, lAd, base] = tag === 261 ? [u32(e, 168), u32(e, 172), 176] : [u32(e, 208), u32(e, 212), 216];
    const ads = e.subarray(base + lEa, base + lEa + lAd), node: Node = { name, dir: ftype === 4, size, extents: [], udf: { part: 0, lbn } };
    if (adType === 3) { node.inline = Buffer.from(ads.subarray(0, size)); return node; }
    const step = adType === 0 ? 8 : 16;
    for (let p = 0; p + step <= ads.length; p += step) {
      const raw = u32(ads, p), len = raw & 0x3fffffff, kind = raw >>> 30; if (!len) break;
      const at = u32(ads, p + 4);
      if (kind === 3) break; // suite des descripteurs ailleurs : rare sur une ISO
      if (kind === 0) node.extents.push({ at: this.lba(at), len });
    }
    return node;
  }

  // ---------------- Dossiers ----------------
  private async children(dir: Node, kind: 'rr' | 'joliet' | 'iso' | 'udf'): Promise<Node[]> {
    const key = `${kind}:${dir.extents[0]?.at ?? 'inline'}:${dir.udf?.lbn ?? ''}`; const c = this.dirs.get(key); if (c) return c;
    const data = await this.bytes(dir, 0, Math.min(dir.size, 8 * 1024 * 1024)); const out: Node[] = [];
    if (kind === 'udf') {
      let p = 0;
      while (p + 38 <= data.length) {
        if (u16(data, p) !== 257) break;
        const ch = data[p + 18], lFi = data[p + 19], icb = u32(data, p + 24), lIu = u16(data, p + 36);
        const name = dstring(data.subarray(p + 38 + lIu, p + 38 + lIu + lFi));
        if (!(ch & 8) && !(ch & 4) && name) { const n = await this.udfNode(icb, name); if (n) out.push(n); }
        p += (38 + lIu + lFi + 3) & ~3;
      }
    } else {
      let p = 0;
      while (p < data.length) {
        const len = data[p]; if (!len) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; }
        const n = this.record(data.subarray(p, p + len), kind) as (Node & { more?: boolean }) | undefined; p += len;
        if (!n || n.name === '.' || n.name === '..') continue;
        const prev = out[out.length - 1] as (Node & { more?: boolean }) | undefined;
        if (prev?.more && prev.name === n.name) { prev.extents.push(...n.extents); prev.size += n.size; prev.more = n.more; continue; }
        out.push(n);
      }
    }
    this.dirs.set(key, out); return out;
  }
  private async find(path: string): Promise<Node | undefined> {
    const parts = path.split('/').filter((x) => x && x !== '.');
    if (parts.includes('..')) return undefined;
    for (const { kind, root } of this.roots) {
      let cur: Node | undefined = root;
      for (const part of parts) {
        if (!cur?.dir) { cur = undefined; break; }
        const list: Node[] = await this.children(cur, kind), low = part.toLowerCase();
        cur = list.find((x) => x.name === part) ?? list.find((x) => x.name.toLowerCase() === low);
      }
      if (cur) return cur;
    }
    return undefined;
  }

  // ---------------- API ----------------
  /** Le contenu d'un dossier de l'ISO (« / », « casper », « sources »…). */
  async list(path = '/'): Promise<IsoEntry[]> {
    const n = await this.find(path); if (!n?.dir) throw new Error(`dossier absent de l'ISO : ${path}`);
    const kind = this.roots.find((r) => r.root === n)?.kind ?? (await this.kindOf(path));
    return (await this.children(n, kind)).map((x) => ({ name: x.name, dir: x.dir, size: x.size }));
  }
  private async kindOf(path: string): Promise<'rr' | 'joliet' | 'iso' | 'udf'> {
    const parts = path.split('/').filter(Boolean);
    for (const { kind, root } of this.roots) {
      let cur: Node | undefined = root;
      for (const part of parts) { if (!cur?.dir) { cur = undefined; break; } const l: Node[] = await this.children(cur, kind); cur = l.find((x) => x.name === part) ?? l.find((x) => x.name.toLowerCase() === part.toLowerCase()); }
      if (cur) return kind;
    }
    return this.roots[0].kind;
  }
  async stat(path: string): Promise<IsoEntry | undefined> { const n = await this.find(path); return n ? { name: n.name, dir: n.dir, size: n.size } : undefined; }
  async exists(path: string): Promise<boolean> { return Boolean(await this.find(path)); }
  /** Lit un fichier entier (petits fichiers : configuration, .disk/info, BCD…). */
  async file(path: string, max = 64 * 1024 * 1024): Promise<Buffer> {
    const n = await this.find(path); if (!n || n.dir) throw new Error(`fichier absent de l'ISO : ${path}`);
    if (n.size > max) throw new Error(`fichier trop gros pour être lu d'un coup : ${path}`);
    return this.bytes(n, 0, n.size);
  }
  private async bytes(n: Node, start: number, end: number): Promise<Buffer> {
    if (n.inline) return n.inline.subarray(start, end);
    const parts: Buffer[] = []; let off = 0;
    for (const e of n.extents) {
      const s = Math.max(start, off), t = Math.min(end, off + e.len);
      if (s < t) parts.push(await this.read(e.at + (s - off), t - s));
      off += e.len; if (off >= end) break;
    }
    return Buffer.concat(parts);
  }
  /** Un flux d'une partie d'un fichier (pour servir de gros fichiers par HTTP, avec reprise). */
  async stream(path: string, start = 0, end?: number): Promise<{ size: number; body: Readable }> {
    const n = await this.find(path); if (!n || n.dir) throw new Error(`fichier absent de l'ISO : ${path}`);
    const stop = Math.min(n.size, end ?? n.size);
    if (n.inline) return { size: n.size, body: Readable.from([n.inline.subarray(start, stop)]) };
    const file = this.path, extents = n.extents;
    async function* gen() {
      let off = 0;
      for (const e of extents) {
        const s = Math.max(start, off), t = Math.min(stop, off + e.len);
        if (s < t) for await (const c of createReadStream(file, { start: e.at + (s - off), end: e.at + (t - off) - 1, highWaterMark: 256 * 1024 })) yield c as Buffer;
        off += e.len; if (off >= stop) break;
      }
    }
    return { size: n.size, body: Readable.from(gen()) };
  }
  /** Les systèmes de fichiers trouvés (pour le diagnostic). */
  get kinds(): string[] { return this.roots.map((r) => r.kind); }
}

/** Une chaîne UDF (« dstring ») : premier octet 8 = Latin-1, 16 = UTF-16 grand-boutiste. */
function dstring(b: Buffer): string {
  if (!b.length) return '';
  if (b[0] === 8) return b.toString('latin1', 1);
  if (b[0] === 16) { const x = Buffer.from(b.subarray(1, 1 + ((b.length - 1) & ~1))); return x.swap16().toString('utf16le'); }
  return '';
}
