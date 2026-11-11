// Sauvegarde et restauration chiffrées de ~/.odin.
//
// Tout ce qui fait « ton » Odin tient dans un dossier : configuration, clés (fichier env), mémoire
// (base SQLite), persona, compétences, espace de travail. Une sauvegarde est une archive zip de ce
// dossier, chiffrée avec un mot de passe : AES-256-GCM, clé dérivée par scrypt. Sans le mot de passe,
// le fichier ne révèle rien, pas même la liste des fichiers. Format :
//   "ODINBK1" · sel (16 o) · nonce (12 o) · étiquette GCM (16 o) · données chiffrées.
// Aucune dépendance : node:crypto + le zip maison.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { OdinPaths } from './config.ts';
import { unzip, zip, type ZipEntry } from './files/zip.ts';

const MAGIC = Buffer.from('ODINBK1');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
/** Jamais sauvegardé : journaux (volumineux, sans valeur) et certificat (régénéré) ; le jeton web est recréé. */
const SKIP = new Set(['logs', 'web-cert', 'web-token', 'sessions.json', 'sessions.json.tmp', 'compte.json.tmp', 'odin.db-wal', 'odin.db-shm', 'odin.db-journal', 'node_modules', 'inbox']);
const MAX_FILE = 200 * 1024 * 1024;

export interface BackupOptions {
  /** Inclure l'espace de travail (fichiers de travail d'Odin). Défaut : oui, hors fichiers > 200 Mo. */
  workspace?: boolean;
}

function walk(root: string, dir: string, out: ZipEntry[], o: BackupOptions): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).split(sep).join('/');
    if (dir === root && SKIP.has(name)) continue;
    if (dir === root && name === 'workspace' && o.workspace === false) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { walk(root, p, out, o); continue; }
    if (!st.isFile() || st.size > MAX_FILE) continue;
    out.push({ name: rel, data: readFileSync(p) });
  }
}

/** Liste ce qui partira dans la sauvegarde (pour l'afficher avant). */
export function backupManifest(paths: OdinPaths, o: BackupOptions = {}): Array<{ name: string; size: number }> {
  const entries: ZipEntry[] = [];
  if (existsSync(paths.home)) walk(paths.home, paths.home, entries, o);
  return entries.map((e) => ({ name: e.name, size: e.data.length }));
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (password.length < 8) throw new Error('mot de passe : 8 caractères au moins');
  return scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
}

/** Chiffre des octets avec un mot de passe (format ODINBK1). */
export function encryptBackup(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

/** Déchiffre un fichier ODINBK1 ; mot de passe faux ou fichier altéré → erreur claire. */
export function decryptBackup(data: Buffer, password: string): Buffer {
  if (data.length < MAGIC.length + 44 || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('ce fichier n\'est pas une sauvegarde Odin');
  let off = MAGIC.length;
  const salt = data.subarray(off, off += 16), iv = data.subarray(off, off += 12), tag = data.subarray(off, off += 16);
  const d = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(data.subarray(off)), d.final()]); } catch { throw new Error('mot de passe incorrect ou sauvegarde altérée'); }
}

/** Sauvegarde complète : zip de ~/.odin, chiffré. */
export function createBackup(paths: OdinPaths, password: string, o: BackupOptions = {}): Buffer {
  const entries: ZipEntry[] = [];
  if (existsSync(paths.home)) walk(paths.home, paths.home, entries, o);
  if (!entries.length) throw new Error('rien à sauvegarder (dossier Odin vide)');
  entries.push({ name: '_sauvegarde.json', data: Buffer.from(JSON.stringify({ format: 1, date: new Date().toISOString(), files: entries.length }, null, 2)) });
  return encryptBackup(zip(entries), password);
}

export interface RestoreResult { files: number; replaced: string[] }

/**
 * Restauration : déchiffre, vérifie l'archive, puis remplace les fichiers de ~/.odin. L'ancien contenu
 * de chaque fichier remplacé est gardé à côté (nom + .avant-restauration) jusqu'au prochain démarrage.
 * À faire Odin arrêté, ou juste avant un redémarrage des services (le bouton de l'interface s'en charge).
 */
export function restoreBackup(paths: OdinPaths, data: Buffer, password: string): RestoreResult {
  const files = unzip(decryptBackup(data, password));
  if (!files.has('_sauvegarde.json') || !files.has('config.json')) throw new Error('sauvegarde incomplète (pas de config.json)');
  files.delete('_sauvegarde.json');
  const replaced: string[] = [];
  for (const [name, buf] of files) {
    if (name.split('/').some((s) => s === '..' || s === '' || /^[A-Za-z]:/.test(s))) throw new Error(`chemin refusé dans l'archive : ${name}`);
    const dest = join(paths.home, ...name.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    if (existsSync(dest)) { replaced.push(name); rmSync(`${dest}.avant-restauration`, { force: true }); renameSync(dest, `${dest}.avant-restauration`); }
    writeFileSync(dest, buf, { mode: /^(env|web-token|compte\.json|admin\.json|machines\.json|vault\.json|backup-pass|vapid\.json|codex-auth\.json|push\.json|[^/]*\.enc)$/.test(name) ? 0o600 : 0o644 });
  }
  // Base SQLite : les fichiers WAL de l'ancienne base ne doivent pas se mélanger à la nouvelle.
  for (const suffix of ['-wal', '-shm', '-journal']) rmSync(paths.db + suffix, { force: true });
  return { files: files.size, replaced };
}

/** Supprime les copies « .avant-restauration » (au démarrage suivant, une fois qu'Odin a redémarré sans erreur). */
export function cleanupRestore(paths: OdinPaths): number {
  let n = 0;
  const rec = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) { if (name.name !== 'logs' && name.name !== 'node_modules') rec(p); }
      else if (name.name.endsWith('.avant-restauration')) { rmSync(p, { force: true }); n++; }
    }
  };
  if (existsSync(paths.home)) rec(paths.home);
  return n;
}
