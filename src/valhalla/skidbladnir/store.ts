// Skíðblaðnir — le rangement des fichiers : chemins sûrs (jamais hors de l'espace), versions gardées à
// chaque remplacement, corbeille (rien n'est effacé d'un coup), quota, recherche, archive .zip en flux.
// Écrit pour Odin, sans bibliothèque.
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import type { Writable } from 'node:stream';

/** Dossiers d'Odin dans chaque espace : jamais montrés ni synchronisés. */
export const HIDDEN = new Set(['.versions', '.corbeille', '.tmp', '.attente', '.odin-corbeille', '.odin-synchro.json']);
export interface Entry { name: string; path: string; dir: boolean; size: number; mtime: number; by?: string }
export interface TrashItem { id: string; path: string; at: number; by?: string; dir: boolean; size: number }

/** Un nom de fichier acceptable (pas de chemin, pas de nom réservé). Pur. */
export function cleanName(n: string): string {
  const x = n.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim();
  if (!x || x === '.' || x === '..' || x.length > 200 || HIDDEN.has(x) || /^\.odin/i.test(x)) throw new Error(`nom invalide : ${n.slice(0, 60)}`);
  return x;
}
/** Le chemin relatif nettoyé (« a/b/c »), jamais « .. » ni absolu. Pur. */
export function cleanRel(p: string): string {
  const parts = String(p ?? '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  for (const x of parts) { if (x === '..') throw new Error('chemin interdit'); cleanName(x); }
  return parts.join('/');
}
/** Le chemin absolu d'un élément de l'espace, vérifié : il reste dans l'espace (liens symboliques compris). */
export function inside(root: string, rel: string): string {
  const r = resolve(root), p = resolve(r, cleanRel(rel));
  if (p !== r && !p.startsWith(r + sep)) throw new Error('chemin interdit');
  // Un lien symbolique ne doit pas mener dehors.
  let cur = p; while (cur.length > r.length && !existsSync(cur)) cur = dirname(cur);
  if (existsSync(cur)) { const real = realpathSync(cur), rr = realpathSync(r); if (real !== rr && !real.startsWith(rr + sep)) throw new Error('chemin interdit (lien vers l\'extérieur)'); }
  return p;
}

export function list(root: string, rel = ''): Entry[] {
  const d = inside(root, rel); if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
  const meta = readMeta(root);
  return readdirSync(d, { withFileTypes: true }).filter((e) => !HIDDEN.has(e.name) && !e.isSymbolicLink()).map((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name, st = statSync(join(d, e.name));
    return { name: e.name, path: p, dir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, by: meta[p] };
  }).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'fr'));
}

// Qui a déposé quoi (nom de la personne), gardé à côté des fichiers.
const metaFile = (root: string) => join(root, '.tmp', 'auteurs.json');
function readMeta(root: string): Record<string, string> { try { return JSON.parse(readFileSync(metaFile(root), 'utf8')); } catch { return {}; } }
export function setAuthor(root: string, rel: string, by?: string): void {
  if (!by) return; const m = readMeta(root); m[rel] = by; const keys = Object.keys(m); if (keys.length > 20000) for (const k of keys.slice(0, 5000)) delete m[k];
  mkdirSync(join(root, '.tmp'), { recursive: true }); writeFileSync(metaFile(root), JSON.stringify(m));
}

/** Taille d'un dossier (versions et corbeille comprises : elles comptent dans le quota). */
export function usage(dir: string): number {
  let n = 0; if (!existsSync(dir)) return 0;
  const walk = (d: string, depth: number) => { if (depth > 40) return; for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isSymbolicLink()) continue; const p = join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else { try { n += statSync(p).size; } catch { /* disparu */ } } } };
  walk(dir, 0); return n;
}

// ---------------- Versions ----------------
let lastStamp = 0;
const versionsDir = (root: string, rel: string) => join(root, '.versions', cleanRel(rel));
/** Garde la version actuelle d'un fichier avant qu'il soit remplacé (les plus vieilles au-delà de `keep` partent). */
export function keepVersion(root: string, rel: string, keep: number, by?: string): void {
  const f = inside(root, rel); if (!existsSync(f) || statSync(f).isDirectory() || keep <= 0) return;
  const d = versionsDir(root, rel); mkdirSync(d, { recursive: true });
  // Un horodatage toujours croissant (deux versions dans la même milliseconde gardent leur ordre).
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  copyFileSync(f, join(d, `${lastStamp}${by ? `~${by.replace(/[^\w.-]/g, '')}` : ''}`));
  const all = readdirSync(d).sort(); for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(d, old), { force: true });
}
export function versions(root: string, rel: string): Array<{ id: string; at: number; by?: string; size: number }> {
  const d = versionsDir(root, rel); if (!existsSync(d)) return [];
  return readdirSync(d).map((id) => { const [t, by] = id.split('~'); return { id, at: Number(t), by, size: statSync(join(d, id)).size }; }).filter((v) => v.at).sort((a, b) => b.at - a.at);
}
export function restoreVersion(root: string, rel: string, id: string, keep: number, by?: string): void {
  if (!/^\d+(~[\w.-]+)?$/.test(id)) throw new Error('version inconnue');
  const v = join(versionsDir(root, rel), id); if (!existsSync(v)) throw new Error('version introuvable');
  // Copiée à part d'abord : garder la version actuelle peut faire partir la plus vieille (celle qu'on veut).
  const tmp = join(root, '.tmp', `restaure-${Date.now()}`); mkdirSync(join(root, '.tmp'), { recursive: true }); copyFileSync(v, tmp);
  keepVersion(root, rel, keep, by); renameSync(tmp, inside(root, rel));
}

// ---------------- Corbeille ----------------
const trashDir = (root: string) => join(root, '.corbeille');
const trashIndex = (root: string) => join(trashDir(root), 'index.json');
export function trash(root: string): TrashItem[] { try { return JSON.parse(readFileSync(trashIndex(root), 'utf8')); } catch { return []; } }
/** Met à la corbeille (jamais effacé tout de suite). */
export function toTrash(root: string, rel: string, by?: string): TrashItem {
  const p = inside(root, rel); if (!rel || !existsSync(p)) throw new Error('introuvable');
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, st = statSync(p);
  mkdirSync(trashDir(root), { recursive: true }); renameSync(p, join(trashDir(root), id));
  const item: TrashItem = { id, path: cleanRel(rel), at: Date.now(), by, dir: st.isDirectory(), size: st.isDirectory() ? usage(join(trashDir(root), id)) : st.size };
  writeFileSync(trashIndex(root), JSON.stringify([...trash(root), item]));
  return item;
}
/** Remet à sa place (sous un autre nom si la place est prise). */
export function restore(root: string, id: string): string {
  const all = trash(root), it = all.find((x) => x.id === id); if (!it) throw new Error('rien de tel dans la corbeille');
  let to = inside(root, it.path);
  if (existsSync(to)) { const e = extname(to); to = `${to.slice(0, to.length - e.length)} (restauré ${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')})${e}`; }
  mkdirSync(dirname(to), { recursive: true }); renameSync(join(trashDir(root), id), to);
  writeFileSync(trashIndex(root), JSON.stringify(all.filter((x) => x.id !== id)));
  return relative(resolve(root), to).split(sep).join('/');
}
/** Vide ce qui est dans la corbeille depuis plus de `days` jours (0 : tout). Rend le nombre. */
export function purge(root: string, days: number, now = Date.now()): number {
  const all = trash(root), old = all.filter((x) => now - x.at >= days * 864e5);
  for (const x of old) rmSync(join(trashDir(root), x.id), { recursive: true, force: true });
  if (old.length) writeFileSync(trashIndex(root), JSON.stringify(all.filter((x) => !old.includes(x))));
  return old.length;
}

// ---------------- Opérations ----------------
export function mkdir(root: string, rel: string): void { const p = inside(root, rel); if (existsSync(p)) throw new Error('existe déjà'); mkdirSync(p, { recursive: true }); }
export function rename(root: string, rel: string, name: string): string {
  const from = inside(root, rel), to = inside(root, join(dirname(cleanRel(rel)), cleanName(name)).split(sep).join('/'));
  if (!existsSync(from)) throw new Error('introuvable'); if (existsSync(to)) throw new Error('ce nom est déjà pris');
  renameSync(from, to); return relative(resolve(root), to).split(sep).join('/');
}
export function move(root: string, rel: string, toDir: string): string {
  const from = inside(root, rel), d = inside(root, toDir), to = join(d, basename(from));
  if (!existsSync(from)) throw new Error('introuvable'); if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier de destination introuvable');
  if ((to + sep).startsWith(from + sep)) throw new Error('impossible de mettre un dossier dans lui-même'); if (existsSync(to)) throw new Error('un élément du même nom est déjà là');
  renameSync(from, to); return relative(resolve(root), to).split(sep).join('/');
}
/** Un nom libre à côté (« photo (2).jpg »). Pur sur le disque. */
export function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const e = extname(name), b = name.slice(0, name.length - e.length);
  for (let i = 2; i < 10000; i++) { const n = `${b} (${i})${e}`; if (!existsSync(join(dir, n))) return n; }
  throw new Error('trop de fichiers du même nom');
}
export function search(root: string, q: string, max = 200): Entry[] {
  const want = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); if (!want) return [];
  const out: Entry[] = [], meta = readMeta(root);
  const walk = (d: string, rel: string, depth: number) => {
    if (depth > 30 || out.length >= max) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (HIDDEN.has(e.name) || e.isSymbolicLink()) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(want)) { const st = statSync(join(d, e.name)); out.push({ name: e.name, path: p, dir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, by: meta[p] }); }
      if (e.isDirectory()) walk(join(d, e.name), p, depth + 1);
      if (out.length >= max) return;
    }
  };
  walk(resolve(root), '', 0); return out;
}
/** Tous les fichiers sous un chemin (pour une archive). */
export function filesUnder(root: string, rel: string): Array<{ abs: string; name: string; size: number; mtime: number }> {
  const base = inside(root, rel), st = existsSync(base) ? lstatSync(base) : undefined; if (!st) throw new Error('introuvable');
  if (st.isFile()) return [{ abs: base, name: basename(base), size: st.size, mtime: st.mtimeMs }];
  const out: Array<{ abs: string; name: string; size: number; mtime: number }> = [];
  const walk = (d: string, prefix: string, depth: number) => { if (depth > 30) return; for (const e of readdirSync(d, { withFileTypes: true })) { if (HIDDEN.has(e.name) || e.isSymbolicLink()) continue; const p = join(d, e.name); if (e.isDirectory()) walk(p, `${prefix}${e.name}/`, depth + 1); else { const s = statSync(p); out.push({ abs: p, name: `${prefix}${e.name}`, size: s.size, mtime: s.mtimeMs }); } } };
  walk(base, '', 0); return out;
}

// ---------------- Archive .zip en flux (méthode « stockée », ZIP64 au-delà de 4 Go) ----------------
function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms), y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
const write = (out: Writable, b: Buffer) => new Promise<void>((ok, ko) => { if (out.write(b)) ok(); else { out.once('drain', ok); out.once('error', ko); } });
/** Écrit une archive .zip des fichiers dans `out`, sans tout charger en mémoire. */
export async function zipTo(out: Writable, files: Array<{ abs: string; name: string; size: number; mtime: number }>): Promise<void> {
  let offset = 0n; const central: Buffer[] = [];
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), { time, date } = dosTime(f.mtime), big = f.size >= 0xffffffff;
    // CRC calculé d'abord (lecture en flux), puis l'en-tête et les données.
    let crc = 0; for await (const c of createReadStream(f.abs)) crc = crc32(c as Buffer, crc);
    const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
    if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(f.size), 4); extra.writeBigUInt64LE(BigInt(f.size), 12); }
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(big ? 45 : 20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(big ? 0xffffffff : f.size, 18); lh.writeUInt32LE(big ? 0xffffffff : f.size, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(extra.length, 28);
    await write(out, Buffer.concat([lh, name, extra]));
    for await (const c of createReadStream(f.abs)) await write(out, c as Buffer);
    const far = offset >= 0xffffffffn, cx = big || far ? Buffer.alloc(4 + (big ? 16 : 0) + (far ? 8 : 0)) : Buffer.alloc(0);
    if (cx.length) { cx.writeUInt16LE(1, 0); cx.writeUInt16LE(cx.length - 4, 2); let o = 4; if (big) { cx.writeBigUInt64LE(BigInt(f.size), o); cx.writeBigUInt64LE(BigInt(f.size), o + 8); o += 16; } if (far) cx.writeBigUInt64LE(offset, o); }
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(cx.length ? 45 : 20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(big ? 0xffffffff : f.size, 20); ch.writeUInt32LE(big ? 0xffffffff : f.size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(cx.length, 30); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(far ? 0xffffffff : Number(offset), 42);
    central.push(Buffer.concat([ch, name, cx]));
    offset += BigInt(lh.length + name.length + extra.length + f.size);
  }
  const cd = Buffer.concat(central), cdOff = offset, n = files.length, z64 = cdOff >= 0xffffffffn || n >= 0xffff;
  await write(out, cd);
  if (z64) {
    const e64 = Buffer.alloc(56); e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14); e64.writeBigUInt64LE(BigInt(n), 24); e64.writeBigUInt64LE(BigInt(n), 32); e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(cdOff, 48);
    const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(cdOff + BigInt(cd.length), 8); loc.writeUInt32LE(1, 16);
    await write(out, Buffer.concat([e64, loc]));
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Math.min(n, 0xffff), 8); end.writeUInt16LE(Math.min(n, 0xffff), 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(z64 ? 0xffffffff : Number(cdOff), 16);
  await write(out, end);
}

/** Écrit un flux dans un fichier temporaire puis le met en place (jamais de fichier à moitié écrit). */
export async function receive(root: string, src: AsyncIterable<Buffer>, max: number): Promise<{ tmp: string; size: number }> {
  mkdirSync(join(root, '.tmp'), { recursive: true });
  const tmp = join(root, '.tmp', `envoi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`), w = createWriteStream(tmp);
  let size = 0;
  try {
    for await (const c of src) { size += c.length; if (size > max) throw new Error('trop gros (quota de l\'espace ou limite d\'envoi)'); await write(w, c); }
    await new Promise<void>((ok, ko) => w.end((e?: Error | null) => (e ? ko(e) : ok())));
    return { tmp, size };
  } catch (e) { w.destroy(); rmSync(tmp, { force: true }); throw e; }
}
