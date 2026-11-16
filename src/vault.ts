// Coffre d'Odin : ses secrets ne sont JAMAIS en clair sur le disque (clés et jetons de ~/.odin/env, mots de passe des
// machines, mot de passe administrateur, mot de passe des sauvegardes, connexion ChatGPT, clé d'accès web, clé des
// notifications).
//
// Deux façons de protéger :
// - par défaut, la CLÉ DE CETTE MACHINE : une clé aléatoire rangée HORS du dossier d'Odin (protégée par Windows avec
//   DPAPI ; sous Linux dans /etc/odin/cles en root, sinon ~/.config/odin-cles, lisible par toi seul). Qui copie le
//   dossier d'Odin ou une sauvegarde ne lit rien. Rien à taper au redémarrage.
// - en plus, un MOT DE PASSE MAÎTRE (facultatif) : au redémarrage le coffre est verrouillé jusqu'à ce que tu le
//   déverrouilles dans l'interface ; sa clé ne vit qu'en mémoire.
// Un ancien dossier aux secrets en clair est chiffré tout seul au premier passage (les fichiers en clair sont effacés).

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** Secrets que le mot de passe maître verrouille. */
export const VAULT_FILES = ['env', 'machines.json', 'admin.json', 'backup-pass', 'codex-auth.json'] as const;
/** Secrets dont le serveur a besoin dès le démarrage : toujours chiffrés avec la clé de la machine, jamais verrouillés. */
export const MACHINE_FILES = ['web-token', 'vapid.json'] as const;
const MAGIC1 = Buffer.from('ODV1'), MAGIC2 = Buffer.from('ODV2');
const meta = (home: string) => join(home, 'vault.json');
const keys = new Map<string, Buffer>();
const machineKeys = new Map<string, Buffer>();

interface Meta { v: number; mode?: 'machine' | 'password'; salt?: string; n?: number; check: string; /** nom de la clé de la machine */ cle?: string }
const readMeta = (home: string): Meta | undefined => { try { return JSON.parse(readFileSync(meta(home), 'utf8')) as Meta; } catch { return undefined; } };
/** « machine » : chiffré avec la clé de la machine ; « password » : avec le mot de passe maître. */
export function vaultMode(home: string): 'machine' | 'password' {
  ensureVault(home);
  const m = readMeta(home);
  return !m || m.mode === 'machine' ? 'machine' : 'password';
}

/** off = pas de mot de passe maître (chiffré avec la clé de la machine, toujours ouvert) ; locked / open = mot de passe maître. */
export type VaultState = 'off' | 'locked' | 'open';
export function vaultState(home: string): VaultState {
  if (vaultMode(home) === 'machine') return 'off';
  return keys.has(home) ? 'open' : 'locked';
}

// ---------------- Chiffrement ----------------

const derive = (pw: string, salt: Buffer, n = 1 << 15) => scryptSync(pw.normalize('NFC'), salt, 32, { N: n, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
/** Chiffre (AES-256-GCM). Le nom du fichier est lié au contenu : on ne peut pas échanger deux fichiers chiffrés. */
export function seal(key: Buffer, data: Buffer, nom = ''): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(nom, 'utf8'));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC2, iv, c.getAuthTag(), ct]);
}
export function open(key: Buffer, blob: Buffer, nom = ''): Buffer {
  const v2 = blob.subarray(0, 4).equals(MAGIC2);
  if (!v2 && !blob.subarray(0, 4).equals(MAGIC1)) throw new Error('fichier du coffre illisible');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  if (v2) d.setAAD(Buffer.from(nom, 'utf8'));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}
const write600 = (f: string, data: string | Buffer) => { writeFileSync(f, data, { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* Windows : droits du profil */ } };
/** Efface un fichier en clair (réécrit avec des zéros d'abord). */
function shred(f: string): void {
  if (!existsSync(f)) return;
  try { writeFileSync(f, Buffer.alloc(statSync(f).size)); } catch { /* rien */ }
  rmSync(f, { force: true });
}
const isVaulted = (n: string) => (VAULT_FILES as readonly string[]).includes(n);
const isMachine = (n: string) => (MACHINE_FILES as readonly string[]).includes(n);

// ---------------- Clé de la machine ----------------

const enEssai = () => Boolean(process.env.NODE_TEST_CONTEXT);
/** Dossier des clés de machine : hors du dossier d'Odin (réglable par ODIN_CLE_DIR). */
export function machineKeyDir(): string {
  if (process.env.ODIN_CLE_DIR) return process.env.ODIN_CLE_DIR;
  if (enEssai()) return join(tmpdir(), 'odin-cles-essais');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Odin', 'cles');
  if (process.getuid?.() === 0) return '/etc/odin/cles';
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'odin-cles');
}
/** Le nom de la clé est rangé dans vault.json : déplacer ou renommer le dossier d'Odin ne la perd pas. */
const keyFileOf = (id: string) => join(machineKeyDir(), `${id.replace(/[^a-f0-9]/g, '')}.cle`);
export function machineKeyFile(home: string): string { return keyFileOf(keyId(home)); }
function keyId(home: string): string {
  const m = readMeta(home);
  if (m?.cle) return m.cle;
  const id = randomBytes(8).toString('hex');
  if (m) write600(meta(home), JSON.stringify({ ...m, cle: id }));
  else pendingIds.set(home, pendingIds.get(home) ?? id);
  return m ? id : pendingIds.get(home)!;
}
const pendingIds = new Map<string, string>();
const lostKeys = new Map<string, number>();
/** La clé de la machine a été perdue (autre compte, autre PC sans sauvegarde) : les secrets sont à ressaisir. */
export const machineKeyLost = (home: string): number | undefined => lostKeys.get(home);
/** Oublie les clés gardées en mémoire pour ce dossier (essais, restauration). */
export function resetVaultCache(home: string): void { machineKeys.delete(home); keys.delete(home); pendingIds.delete(home); }

/** DPAPI de Windows : la clé n'est lisible que par ce compte Windows sur cette machine. */
function dpapi(op: 'Protect' | 'Unprotect', b64: string): string | undefined {
  if (process.platform !== 'win32' || enEssai()) return undefined;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($i),$null,'CurrentUser'))`],
  { input: b64, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const out = r.status === 0 ? String(r.stdout ?? '').trim() : '';
  return /^[A-Za-z0-9+/=]+$/.test(out) ? out : undefined;
}
const wrapKey = (key: Buffer) => { const p = dpapi('Protect', key.toString('base64')); return p ? `dpapi:${p}` : `brut:${key.toString('base64')}`; };
function unwrapKey(t: string): Buffer {
  const [genre, b64] = t.trim().split(':');
  const raw = genre === 'dpapi' ? dpapi('Unprotect', b64 ?? '') : genre === 'brut' ? b64 : undefined;
  const k = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (k.length !== 32) throw new Error('clé de la machine illisible (autre compte ou autre machine ?)');
  return k;
}
function saveMachineKey(home: string, key: Buffer): void {
  const f = machineKeyFile(home);
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  write600(f, wrapKey(key));
  machineKeys.set(home, key);
}
/**
 * La clé de la machine pour ce dossier d'Odin (créée la première fois). Si elle est illisible ou absente alors que des
 * secrets chiffrés existent (restauration sur un autre PC sans la clé, autre compte Windows), Odin démarre quand même :
 * les fichiers chiffrés sont mis de côté (« .illisible », jamais effacés), une nouvelle clé est créée et l'alerte
 * machineKeyLost() demande de ressaisir les secrets.
 */
function machineKey(home: string, creer = true): Buffer | undefined {
  const k = machineKeys.get(home); if (k) return k;
  const f = machineKeyFile(home), m = readMeta(home);
  if (existsSync(f)) {
    try {
      const key = unwrapKey(readFileSync(f, 'utf8'));
      if (m?.mode === 'machine' && !checkOk(key, m.check)) throw new Error('la clé ne correspond pas à ce coffre');
      machineKeys.set(home, key); return key;
    } catch (e) { if (!creer) return undefined; console.error(`[coffre] clé de la machine illisible : ${(e as Error).message}`); }
  } else if (!creer) return undefined;
  const orphelins = [...(m?.mode === 'machine' ? VAULT_FILES : []), ...MACHINE_FILES].map((n) => join(home, `${n}.enc`)).filter((x) => existsSync(x));
  if (orphelins.length) {
    for (const x of orphelins) { rmSync(`${x}.illisible`, { force: true }); writeFileSync(`${x}.illisible`, readFileSync(x), { mode: 0o600 }); rmSync(x, { force: true }); }
    if (existsSync(f)) { rmSync(`${f}.illisible`, { force: true }); writeFileSync(`${f}.illisible`, readFileSync(f), { mode: 0o600 }); }
    lostKeys.set(home, Date.now());
    console.error(`[coffre] secrets chiffrés mis de côté (clé de la machine perdue) : ${orphelins.map((x) => basename(x)).join(', ')}`);
  }
  const key = randomBytes(32); saveMachineKey(home, key);
  if (m?.mode === 'machine') write600(meta(home), JSON.stringify({ ...m, check: check(key) }));
  return key;
}
/** Pour la sauvegarde : la clé de la machine (glissée dans l'archive, elle-même chiffrée par le mot de passe des sauvegardes). */
export function exportMachineKey(home: string): Buffer | undefined { try { return machineKey(home, false); } catch { return undefined; } }
/** À la restauration : remet la clé de la machine qui va avec les secrets restaurés. */
export function importMachineKey(home: string, key: Buffer): void {
  if (key.length !== 32) throw new Error('clé de machine invalide dans la sauvegarde');
  const f = machineKeyFile(home);
  if (existsSync(f)) { rmSync(`${f}.avant-restauration`, { force: true }); writeFileSync(`${f}.avant-restauration`, readFileSync(f), { mode: 0o600 }); }
  saveMachineKey(home, key);
}

// ---------------- Mise en place et migration ----------------

const check = (key: Buffer) => seal(key, Buffer.from('odin-coffre'), 'vault.json').toString('base64');
const checkOk = (key: Buffer, c: string) => { try { return timingSafeEqual(open(key, Buffer.from(c, 'base64'), 'vault.json'), Buffer.from('odin-coffre')); } catch { return false; } };

/** Chiffre les secrets encore en clair d'un dossier (ancien Odin, fichier restauré) avec la bonne clé. */
function sealPlain(home: string, names: readonly string[], key: Buffer): void {
  for (const n of names) { const f = join(home, n); if (existsSync(f)) { write600(`${f}.enc`, seal(key, readFileSync(f), n)); shred(f); } }
}
/** Premier passage : pas de coffre → coffre à clé de machine, et les secrets en clair sont chiffrés puis effacés. */
export function ensureVault(home: string): void {
  if (!existsSync(home)) return;
  if (!existsSync(meta(home))) {
    const id = keyId(home), key = randomBytes(32);
    saveMachineKey(home, key);
    sealPlain(home, VAULT_FILES, key);
    write600(meta(home), JSON.stringify({ v: 2, mode: 'machine', cle: id, check: check(key) } satisfies Meta));
    pendingIds.delete(home);
  }
  const mk = MACHINE_FILES.some((n) => existsSync(join(home, n))) ? machineKey(home) : undefined;
  if (mk) sealPlain(home, MACHINE_FILES, mk);
}

/** La clé qui ouvre ce fichier, ou rien si le coffre est verrouillé. */
function keyFor(home: string, n: string): Buffer | undefined {
  if (isMachine(n)) return machineKey(home);
  const m = readMeta(home);
  if (!m || m.mode === 'machine') return machineKey(home);
  return keys.get(home);
}

/** Lit un fichier secret (déchiffré) ; rien s'il n'existe pas ou si le coffre est verrouillé. */
export function readSecretFile(f: string): string | undefined {
  const home = dirname(f), n = basename(f);
  if (!isVaulted(n) && !isMachine(n)) return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
  ensureVault(home);
  const key = keyFor(home, n);
  if (!key) return undefined;
  if (existsSync(f)) sealPlain(home, [n], key); // un fichier en clair déposé depuis (restauration, ancien code) : chiffré tout de suite
  if (!existsSync(`${f}.enc`)) return undefined;
  return open(key, readFileSync(`${f}.enc`), n).toString('utf8');
}
/** Écrit un fichier secret, toujours chiffré (refusé si le coffre est verrouillé). */
export function writeSecretFile(f: string, text: string): void {
  const home = dirname(f), n = basename(f);
  if (!isVaulted(n) && !isMachine(n)) return write600(f, text);
  mkdirSync(home, { recursive: true });
  ensureVault(home);
  const key = keyFor(home, n);
  if (!key) throw new Error('le coffre est verrouillé : déverrouille-le d\'abord (Accueil)');
  write600(`${f}.enc`, seal(key, Buffer.from(text, 'utf8'), n));
  shred(f);
}
/** Un fichier secret existe-t-il (chiffré ou pas encore) ? */
export const secretFileExists = (f: string) => existsSync(`${f}.enc`) || existsSync(f);
/** Supprime un fichier secret. */
export function removeSecretFile(f: string): void { shred(f); rmSync(`${f}.enc`, { force: true }); }

// ---------------- Mot de passe maître ----------------

function verify(home: string, pw: string): Buffer {
  const m = readMeta(home);
  if (!m || m.mode === 'machine' || !m.salt) throw new Error('aucun mot de passe maître n\'est activé');
  const key = derive(pw, Buffer.from(m.salt, 'base64'), m.n ?? 1 << 15);
  if (!checkOk(key, m.check) && !checkV1(key, m.check)) throw new Error('mot de passe du coffre incorrect');
  return key;
}
/** Ancien contrôle (avant que le nom soit lié au contenu). */
const checkV1 = (key: Buffer, c: string) => { try { return timingSafeEqual(open(key, Buffer.from(c, 'base64')), Buffer.from('odin-coffre')); } catch { return false; } };

/** Passe les secrets d'une clé à une autre. */
function rekey(home: string, from: Buffer, to: Buffer): void {
  for (const n of VAULT_FILES) {
    const f = join(home, n);
    if (existsSync(`${f}.enc`)) write600(`${f}.enc`, seal(to, open(from, readFileSync(`${f}.enc`), n), n));
    else if (existsSync(f)) { write600(`${f}.enc`, seal(to, readFileSync(f), n)); shred(f); }
  }
}
/** Ajoute le mot de passe maître : les secrets passent de la clé de la machine à ce mot de passe. */
export function vaultEnable(home: string, pw: string): void {
  ensureVault(home);
  if (vaultMode(home) === 'password') throw new Error('le coffre a déjà un mot de passe maître');
  if (pw.length < 10) throw new Error('mot de passe trop court (10 caractères au moins)');
  const n = 1 << 17, salt = randomBytes(16), key = derive(pw, salt, n);
  rekey(home, machineKey(home)!, key);
  write600(meta(home), JSON.stringify({ v: 2, mode: 'password', salt: salt.toString('base64'), n, check: check(key), cle: keyId(home) } satisfies Meta));
  keys.set(home, key);
}
export function vaultUnlock(home: string, pw: string): void { keys.set(home, verify(home, pw)); }
export function vaultLock(home: string): void { if (vaultMode(home) === 'password') keys.delete(home); }
/** Retire le mot de passe maître : les secrets restent chiffrés, avec la clé de la machine. */
export function vaultDisable(home: string, pw: string): void {
  const key = verify(home, pw), mk = machineKey(home)!;
  rekey(home, key, mk);
  write600(meta(home), JSON.stringify({ v: 2, mode: 'machine', check: check(mk), cle: keyId(home) } satisfies Meta));
  keys.delete(home);
}
