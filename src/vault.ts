// Coffre facultatif : un mot de passe maître chiffre les secrets d'Odin sur le disque (clés et jetons
// de ~/.odin/env, mots de passe des machines, mot de passe administrateur). Désactivé par défaut.
// Au redémarrage, le coffre est verrouillé : les secrets restent illisibles (même pour qui copierait le
// disque) jusqu'à ce que tu le déverrouilles dans l'interface. La clé ne vit qu'en mémoire.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Fichiers protégés par le coffre (dans le dossier d'Odin). */
export const VAULT_FILES = ['env', 'machines.json', 'admin.json'] as const;
const MAGIC = Buffer.from('ODV1');
const meta = (home: string) => join(home, 'vault.json');
const keys = new Map<string, Buffer>();

export type VaultState = 'off' | 'locked' | 'open';
export function vaultState(home: string): VaultState {
  if (!existsSync(meta(home))) return 'off';
  return keys.has(home) ? 'open' : 'locked';
}

const derive = (pw: string, salt: Buffer) => scryptSync(pw.normalize('NFC'), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
export function seal(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
export function open(key: Buffer, blob: Buffer): Buffer {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('fichier du coffre illisible');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}
const write600 = (f: string, data: string | Buffer) => { writeFileSync(f, data, { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* Windows */ } };
/** Efface un fichier en clair (réécrit avec des zéros d'abord). */
function shred(f: string): void {
  if (!existsSync(f)) return;
  try { writeFileSync(f, Buffer.alloc(statSync(f).size)); } catch { /* rien */ }
  rmSync(f, { force: true });
}
const isVaulted = (f: string) => (VAULT_FILES as readonly string[]).includes(basename(f));

/** Lit un fichier secret : en clair si le coffre est désactivé, déchiffré s'il est ouvert, rien s'il est verrouillé. */
export function readSecretFile(f: string): string | undefined {
  const home = dirname(f), st = isVaulted(f) ? vaultState(home) : 'off';
  if (st === 'off') return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
  if (st === 'locked' || !existsSync(`${f}.enc`)) return undefined;
  return open(keys.get(home)!, readFileSync(`${f}.enc`)).toString('utf8');
}
/** Écrit un fichier secret (chiffré si le coffre est actif ; refusé s'il est verrouillé). */
export function writeSecretFile(f: string, text: string): void {
  const home = dirname(f), st = isVaulted(f) ? vaultState(home) : 'off';
  if (st === 'off') return write600(f, text);
  if (st === 'locked') throw new Error('le coffre est verrouillé : déverrouille-le d\'abord (Accueil)');
  write600(`${f}.enc`, seal(keys.get(home)!, Buffer.from(text, 'utf8')));
}

const check = (key: Buffer) => seal(key, Buffer.from('odin-coffre')).toString('base64');
function verify(home: string, pw: string): Buffer {
  if (!existsSync(meta(home))) throw new Error('le coffre n\'est pas activé');
  const m = JSON.parse(readFileSync(meta(home), 'utf8')) as { salt: string; check: string };
  const key = derive(pw, Buffer.from(m.salt, 'base64'));
  try { if (!timingSafeEqual(open(key, Buffer.from(m.check, 'base64')), Buffer.from('odin-coffre'))) throw 0; } catch { throw new Error('mot de passe du coffre incorrect'); }
  return key;
}

/** Active le coffre : chiffre les secrets existants et efface les fichiers en clair. */
export function vaultEnable(home: string, pw: string): void {
  if (existsSync(meta(home))) throw new Error('le coffre est déjà activé');
  if (pw.length < 10) throw new Error('mot de passe trop court (10 caractères au moins)');
  const salt = randomBytes(16), key = derive(pw, salt);
  for (const n of VAULT_FILES) { const f = join(home, n); if (existsSync(f)) write600(`${f}.enc`, seal(key, readFileSync(f))); }
  write600(meta(home), JSON.stringify({ v: 1, salt: salt.toString('base64'), check: check(key) }));
  for (const n of VAULT_FILES) shred(join(home, n));
  keys.set(home, key);
}
export function vaultUnlock(home: string, pw: string): void { keys.set(home, verify(home, pw)); }
export function vaultLock(home: string): void { keys.delete(home); }
/** Désactive le coffre : remet les secrets en clair (fichiers 600). */
export function vaultDisable(home: string, pw: string): void {
  const key = verify(home, pw);
  for (const n of VAULT_FILES) { const f = join(home, n); if (existsSync(`${f}.enc`)) { write600(f, open(key, readFileSync(`${f}.enc`))); rmSync(`${f}.enc`, { force: true }); } }
  rmSync(meta(home), { force: true });
  keys.delete(home);
}
