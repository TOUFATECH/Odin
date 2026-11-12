// Hringhorni — dépaquetage des couches d'image (tar, tar.gz, tar.zst), écrit pour Odin.
// Sûr par défaut : aucun chemin ne sort du dossier racine (« .. », chemins absolus, liens symboliques
// piégés), les fichiers spéciaux (périphériques) sont ignorés, et les « whiteouts » des images
// (.wh.nom : effacer ; .wh..wh..opq : vider le dossier) sont appliqués comme le prévoit le format OCI.
import { createReadStream } from 'node:fs';
import { chmod, link, lchown, lstat, mkdir, readdir, readlink, rm, symlink, utimes, open } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type { Readable } from 'node:stream';
import * as zlib from 'node:zlib';

export interface ExtractOpts { chown?: boolean }
export interface ExtractStats { files: number; dirs: number; links: number; whiteouts: number; skipped: string[] }

/** Normalise un chemin d'archive : relatif, sans « . », refuse « .. ». Rend null si le chemin est à ignorer. */
export function cleanPath(p: string): string | null {
  const parts: string[] = [];
  for (const c of p.replace(/\\/g, '/').split('/')) {
    if (!c || c === '.') continue;
    if (c === '..') return null; // une couche qui tente de sortir est refusée entrée par entrée
    parts.push(c);
  }
  return parts.join('/');
}

/** Résout `rel` dans `root` en suivant les liens symboliques DANS la racine (comme un chroot) : on ne sort jamais. */
export async function safeJoin(root: string, rel: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error('trop de liens symboliques');
  const out: string[] = [];
  const todo = rel.split('/').filter((c) => c && c !== '.');
  while (todo.length) {
    const c = todo.shift()!;
    if (c === '..') { out.pop(); continue; }
    const cur = join(root, ...out, c);
    let st;
    try { st = await lstat(cur); } catch { out.push(c, ...todo.filter((x) => x !== '.')); return join(root, ...normalize(out)); }
    if (st.isSymbolicLink() && todo.length) { // on ne suit un lien que pour aller plus loin, jamais pour la dernière composante
      const target = await readlink(cur);
      const rest = todo.splice(0);
      const base = target.startsWith('/') ? [] : out.slice();
      const resolved = await safeJoin(root, [...base, ...target.split('/'), ...rest].join('/'), depth + 1);
      return resolved;
    }
    out.push(c);
  }
  return join(root, ...out);
}
function normalize(parts: string[]): string[] { const o: string[] = []; for (const p of parts) { if (p === '..') o.pop(); else if (p && p !== '.') o.push(p); } return o; }

/** Lit un nombre octal (ou base-256 GNU) d'un en-tête tar. */
function num(b: Buffer, off: number, len: number): number {
  if (b[off] & 0x80) { let v = 0; for (let i = off + 1; i < off + len; i++) v = v * 256 + b[i]; return v; }
  const s = b.toString('latin1', off, off + len).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}
const str = (b: Buffer, off: number, len: number) => { const e = b.indexOf(0, off); return b.toString('utf8', off, e < 0 || e > off + len ? off + len : e); };
function pax(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}; let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i); if (sp < 0) break;
    const len = parseInt(buf.toString('latin1', i, sp), 10); if (!len) break;
    const rec = buf.toString('utf8', sp + 1, i + len - 1), eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** Ouvre une couche selon son type (gzip, zstd ou tar brut, deviné aussi par les premiers octets). */
export async function layerStream(file: string, mediaType = '', onRead?: (n: number) => void): Promise<Readable> {
  const fh = await open(file, 'r'); const head = Buffer.alloc(4); await fh.read(head, 0, 4, 0); await fh.close();
  const src = createReadStream(file);
  if (onRead) src.on('data', (c: Buffer | string) => onRead(c.length));
  if ((head[0] === 0x1f && head[1] === 0x8b) || /gzip/.test(mediaType)) return src.pipe(zlib.createGunzip());
  if ((head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) || /zstd/.test(mediaType)) {
    const z = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
    if (!z) throw new Error('couche zstd : il faut Node 22.15 ou plus récent');
    return src.pipe(z()) as unknown as Readable;
  }
  return src;
}

/** Applique une couche (flux tar) sur `root`. */
export async function extractLayer(input: Readable, root: string, o: ExtractOpts = {}): Promise<ExtractStats> {
  const st: ExtractStats = { files: 0, dirs: 0, links: 0, whiteouts: 0, skipped: [] };
  const created = new Set<string>(); // ce que CETTE couche a posé (un « opaque » ne l'efface pas)
  const dirModes: Array<[string, number, number]> = [];
  let buf: Buffer = Buffer.alloc(0), longName: string | null = null, longLink: string | null = null, paxH: Record<string, string> = {};
  const it = input[Symbol.asyncIterator]();
  let ended = false;
  const need = async (n: number): Promise<boolean> => {
    while (buf.length < n && !ended) { const r = await it.next(); if (r.done) { ended = true; break; } buf = buf.length ? Buffer.concat([buf, r.value as Buffer]) : (r.value as Buffer); }
    return buf.length >= n;
  };
  const take = (n: number) => { const out = buf.subarray(0, n); buf = buf.subarray(n); return out; };
  // Lit `size` octets en flux (pour les gros fichiers) et les passe à `sink`, puis saute le bourrage.
  const body = async (size: number, sink?: (chunk: Buffer) => Promise<void> | void) => {
    let left = size;
    while (left > 0) {
      if (!buf.length && !(await need(1))) throw new Error('archive tronquée');
      const n = Math.min(left, buf.length), part = take(n); left -= n;
      if (sink) await sink(Buffer.from(part));
    }
    const pad = (512 - (size % 512)) % 512; if (pad) { await need(pad); take(Math.min(pad, buf.length)); }
  };
  const collect = async (size: number) => { const parts: Buffer[] = []; await body(size, (c) => { parts.push(c); }); return Buffer.concat(parts); };

  while (await need(512)) {
    const h = take(512);
    if (h.every((x) => x === 0)) { if (await need(512)) take(512); break; }
    const type = String.fromCharCode(h[156] || 0x30), size = paxH.size !== undefined ? Number(paxH.size) : num(h, 124, 12);
    if (type === 'x') { paxH = pax(await collect(size)); continue; }
    if (type === 'g') { await collect(size); continue; }
    if (type === 'L') { longName = (await collect(size)).toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'K') { longLink = (await collect(size)).toString('utf8').replace(/\0+$/, ''); continue; }
    const prefix = str(h, 345, 155), rawName = paxH.path ?? longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    const linkName = paxH.linkpath ?? longLink ?? str(h, 157, 100);
    const mode = num(h, 100, 8) & 0o7777, uid = paxH.uid ? Number(paxH.uid) : num(h, 108, 8), gid = paxH.gid ? Number(paxH.gid) : num(h, 116, 8), mtime = paxH.mtime ? Number(paxH.mtime) : num(h, 136, 12);
    longName = null; longLink = null; paxH = {};
    const name = cleanPath(rawName);
    if (name === null) { st.skipped.push(rawName); await body(size); continue; }
    if (!name) { await body(size); continue; } // la racine elle-même
    const base = posix.basename(name), parent = posix.dirname(name) === '.' ? '' : posix.dirname(name);
    // Whiteouts OCI
    if (base === '.wh..wh..opq') {
      const dir = await safeJoin(root, parent);
      try { for (const e of await readdir(dir)) { const rel = parent ? `${parent}/${e}` : e; if (!created.has(rel)) await rm(join(dir, e), { recursive: true, force: true }); } } catch { /* dossier absent */ }
      st.whiteouts++; await body(size); continue;
    }
    if (base.startsWith('.wh.')) {
      const target = await safeJoin(root, parent ? `${parent}/${base.slice(4)}` : base.slice(4));
      await rm(target, { recursive: true, force: true }); st.whiteouts++; await body(size); continue;
    }
    const dest = await safeJoin(root, name);
    if (!dest.startsWith(root)) { st.skipped.push(rawName); await body(size); continue; }
    await mkdir(dirname(dest), { recursive: true });
    const old = await lstat(dest).catch(() => null);
    if (type === '5') {
      if (old && !old.isDirectory()) await rm(dest, { recursive: true, force: true });
      await mkdir(dest, { recursive: true }); dirModes.push([dest, mode || 0o755, mtime]);
      if (o.chown) await lchown(dest, uid, gid).catch(() => {});
      created.add(name); st.dirs++; await body(size); continue;
    }
    if (old) await rm(dest, { recursive: true, force: true });
    if (type === '2') {
      await symlink(linkName, dest); if (o.chown) await lchown(dest, uid, gid).catch(() => {});
      created.add(name); st.links++; await body(size); continue;
    }
    if (type === '1') {
      const ln = cleanPath(linkName); if (ln === null) { st.skipped.push(rawName); await body(size); continue; }
      const src = await safeJoin(root, ln);
      try { await link(src, dest); st.links++; created.add(name); } catch { st.skipped.push(rawName); }
      await body(size); continue;
    }
    if (type === '0' || type === '\0' || type === '7') {
      const fh = await open(dest, 'w', 0o600);
      try { await body(size, async (c) => { await fh.write(c); }); } finally { await fh.close(); }
      if (o.chown) await lchown(dest, uid, gid).catch(() => {});
      await chmod(dest, mode || 0o644);
      if (mtime) await utimes(dest, mtime, mtime).catch(() => {});
      created.add(name); st.files++; continue;
    }
    // périphériques, tubes nommés… : jamais créés depuis une image
    st.skipped.push(rawName); await body(size);
  }
  // Les droits des dossiers à la fin (un dossier en lecture seule bloquerait la suite de la couche)
  for (const [d, m, t] of dirModes.reverse()) { await chmod(d, m).catch(() => {}); if (t) await utimes(d, t, t).catch(() => {}); }
  return st;
}
