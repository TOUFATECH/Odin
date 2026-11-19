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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';

/** Secrets que le mot de passe maître verrouille (dont les clés reçues dans un message : jamais en clair sur le disque). */
export const VAULT_FILES = ['env', 'machines.json', 'admin.json', 'backup-pass', 'codex-auth.json', 'secrets-cles-recues.json'] as const;
/** Les clés reçues dans un message (rangées par rangerClesRecues, qui ne lève jamais). */
const CLES_RECUES = 'secrets-cles-recues.json';
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

// ---------------- Dossiers réels et Odin jetables ----------------
// Un Odin JETABLE (lancé par un essai ou un banc, ou dont le dossier est sous le dossier temporaire du système)
// n'écrit jamais dans les dossiers réels de la personne : ni sa clé dans le dossier des clés de la machine, ni quoi que
// ce soit dans son ~/.odin. Une vraie installation n'est jamais sous le dossier temporaire ni lancée par un essai :
// rien ne change pour elle (même dossier, même clé, même coffre).

/** Chemin comparable : absolu, chemin réel (raccourcis 8.3, liens) pour la partie qui existe déjà, casse ignorée sous Windows. */
function cheminComparable(p: string): string {
  let abs = resolve(p), reste = '';
  for (;;) {
    try { abs = join(realpathSync.native(abs), reste); break; } catch { /* pas encore créé : on remonte */ }
    const parent = dirname(abs);
    if (parent === abs) break;
    reste = join(basename(abs), reste); abs = parent;
  }
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}
/** `p` est-il `dossier` lui-même ou dedans ? */
function dansDossier(p: string, dossier: string): boolean {
  const r = relative(cheminComparable(dossier), cheminComparable(p));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}
/** Le processus est-il un essai (lanceur d'essais) ou un banc (ODIN_ESSAI) ? */
export const processusJetable = (): boolean => enEssai() || Boolean(process.env.ODIN_ESSAI);
/** Cet Odin est-il jetable : essai, banc, ou dossier sous le dossier temporaire du système ? */
export function estJetable(home?: string): boolean {
  if (processusJetable()) return true;
  // Le critère du dossier temporaire ne vaut que s'il est à part du profil (TMPDIR réglé sur le dossier personnel ou
  // sur « / » : il ne dirait plus rien, et une vraie installation changerait de dossier de clés).
  const tmp = tmpdir();
  return Boolean(home) && dansDossier(home!, tmp) && !dansDossier(homedir(), tmp);
}
/** Le vrai dossier d'Odin de la personne, quand rien n'est réglé (~/.odin). */
export const dossierOdinReel = (): string => join(homedir(), '.odin');
/**
 * Sous un essai ou un banc, ce dossier est-il le vrai dossier d'Odin de la personne (lui, un de ses sous-dossiers, ou
 * un dossier qui le contient) ? Alors refus franc : un essai qui
 * l'ouvrirait avec sa clé d'essai mettrait les VRAIS secrets de côté (« .illisible ») et réécrirait vault.json.
 * Le message ne montre pas le chemin (il finit dans des journaux d'essais) : « ~/.odin » suffit.
 */
export function refuserDossierReelEnEssai(home: string, quoi = 'le coffre'): void {
  if (!processusJetable()) return;
  const reel = dossierOdinReel();
  if (dansDossier(home, reel) || dansDossier(reel, home)) throw new Error(`essai : ${quoi} refuse le vrai dossier d'Odin de la personne (~/.odin, ou un dossier qui le contient). Donne un dossier d'Odin jetable (mkdtempSync(join(tmpdir(), 'odin-…'))) ou pose ODIN_HOME sur un dossier temporaire.`);
}
/**
 * Le dossier d'Odin quand aucun n'est donné : ODIN_HOME s'il est posé et non vide, sinon ~/.odin (vraie installation,
 * inchangé). Sous un essai ou un banc, jamais le vrai : refus franc.
 */
export function dossierOdinParDefaut(quoi = 'Odin'): string {
  const v = process.env.ODIN_HOME?.trim() ? process.env.ODIN_HOME : undefined;
  if (!v && processusJetable()) throw new Error(`essai : ${quoi} sans dossier d'Odin écrirait dans le vrai ~/.odin de la personne. Passe un dossier d'Odin jetable (mkdtempSync(join(tmpdir(), 'odin-…'))) ou pose ODIN_HOME sur un dossier temporaire.`);
  const home = v ? resolve(v) : dossierOdinReel();
  refuserDossierReelEnEssai(home, quoi);
  return home;
}
// Garde au chargement : un essai ou un banc lancé SANS ODIN_HOME (ou vide) reçoit tout de suite un dossier d'Odin
// jetable, retiré à la sortie. Toutes les valeurs par défaut du code (« ODIN_HOME ?? ~/.odin » : odinPaths, voix,
// vidéo, moteur de Soul…) le prennent alors, avant que quoi que ce soit n'écrive ou ne nettoie dans le vrai ~/.odin.
// Une vraie installation n'est ni un essai ni un banc : rien ne change pour elle.
if (processusJetable() && !process.env.ODIN_HOME?.trim()) {
  const jetable = mkdtempSync(join(tmpdir(), 'odin-jetable-home-'));
  process.env.ODIN_HOME = jetable;
  process.on('exit', () => { try { rmSync(jetable, { recursive: true, force: true }); } catch { /* dossier temporaire : tant pis */ } });
  if (!enEssai()) console.error('[coffre] banc sans ODIN_HOME : dossier d\'Odin jetable pris dans le dossier temporaire (jamais ~/.odin).');
}
/** Le dossier des clés de la machine d'une vraie installation (dans le profil de la personne), quel que soit le processus. */
export function dossierClesMachine(): string {
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Odin', 'cles');
  if (process.getuid?.() === 0) return '/etc/odin/cles';
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'odin-cles');
}
/** Les dossiers réels qu'un Odin jetable ne prend jamais pour ses clés : celui des clés, son dossier « Odin », ~/.odin. */
function zonesReelles(): string[] {
  const reel = dossierClesMachine(), parent = dirname(reel);
  return [reel, dossierOdinReel(), ...(basename(parent).toLowerCase() === 'odin' ? [parent] : [])];
}
const recoupe = (a: string, b: string) => dansDossier(a, b) || dansDossier(b, a);
const dossierClesJetables = () => join(tmpdir(), 'odin-cles-essais');
let averti = false, avertiDurable = false;
/**
 * Dossier des clés de machine : hors du dossier d'Odin (réglable par ODIN_CLE_DIR). Pour un Odin jetable (voir
 * estJetable), jamais un dossier réel du profil : un dossier temporaire, même si ODIN_CLE_DIR recoupe par erreur le
 * dossier des clés, son dossier « Odin » ou ~/.odin.
 */
export function machineKeyDir(home?: string): string {
  const jetable = estJetable(home), choisi = process.env.ODIN_CLE_DIR;
  if (choisi) {
    if (!jetable || !zonesReelles().some((z) => recoupe(choisi, z))) return choisi;
    if (!averti) { averti = true; console.error('[coffre] Odin d\'essai : ODIN_CLE_DIR recoupe un dossier réel de la personne (dossier des clés de la machine ou ~/.odin) ; ignoré, clés rangées dans le dossier temporaire des clés d\'essai.'); }
    return dossierClesJetables();
  }
  if (!jetable) return dossierClesMachine();
  if (home && !avertiDurable && !dansDossier(home, tmpdir())) {
    avertiDurable = true;
    console.error('[coffre] Odin d\'essai hors du dossier temporaire : sa clé va dans le dossier temporaire des clés d\'essai, qu\'un nettoyage peut vider. Si ce dossier d\'Odin doit durer, pose ODIN_CLE_DIR sur un dossier à côté de lui.');
  }
  return dossierClesJetables();
}
/** Jetable pour la SEULE raison que son dossier est sous le dossier temporaire (ni essai ni banc) : peut-être une vraie installation déplacée là. */
const jetableParDossierSeul = (home: string) => !processusJetable() && estJetable(home);
/**
 * Le nom de la clé est rangé dans vault.json : déplacer ou renommer le dossier d'Odin ne la perd pas, même sous le
 * dossier temporaire : si la clé de ce nom est déjà là où une vraie installation la range (simple lecture), elle y reste.
 */
function keyFileOf(home: string, id: string): string {
  const nom = `${id.replace(/[^a-f0-9]/g, '')}.cle`;
  if (jetableParDossierSeul(home)) {
    const reelle = join(process.env.ODIN_CLE_DIR || dossierClesMachine(), nom);
    if (existsSync(reelle)) return reelle;
  }
  return join(machineKeyDir(home), nom);
}
export function machineKeyFile(home: string): string { return keyFileOf(home, keyId(home)); }
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
/**
 * Met un fichier de côté à côté de lui (`<nom><suffixe>`), sans JAMAIS écraser une copie déjà là : si le nom est
 * pris, `<nom><suffixe>-<date>` (puis un numéro). Rend le nom de la copie.
 */
function copieDeCote(f: string, suffixe: string): string {
  let c = `${f}${suffixe}`;
  if (existsSync(c)) {
    const date = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    c = `${f}${suffixe}-${date}`;
    for (let n = 2; existsSync(c); n++) c = `${f}${suffixe}-${date}-${n}`;
  }
  writeFileSync(c, readFileSync(f), { mode: 0o600, flag: 'wx' });
  return c;
}
function saveMachineKey(home: string, key: Buffer, dejaCopiee = false): void {
  refuserDossierReelEnEssai(home);
  const f = machineKeyFile(home);
  // Une clé déjà là n'est jamais remplacée sans copie gardée à côté (une clé perdue ne se retrouve pas).
  if (existsSync(f) && !dejaCopiee) {
    let meme = false;
    try { meme = unwrapKey(readFileSync(f, 'utf8')).equals(key); } catch { /* illisible : copiée */ }
    if (!meme) { const c = copieDeCote(f, '.illisible'); console.error(`[coffre] clé de la machine remplacée : l'ancienne est gardée (${basename(c)})`); }
  }
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
  refuserDossierReelEnEssai(home);
  const f = machineKeyFile(home), m = readMeta(home);
  if (existsSync(f)) {
    try {
      const key = unwrapKey(readFileSync(f, 'utf8'));
      if (m?.mode === 'machine' && !checkOk(key, m.check)) throw new Error('la clé ne correspond pas à ce coffre');
      machineKeys.set(home, key); return key;
    } catch (e) { if (!creer) return undefined; console.error(`[coffre] clé de la machine illisible : ${(e as Error).message}`); }
  } else if (!creer) return undefined;
  const orphelins = [...(m?.mode === 'machine' ? VAULT_FILES : []), ...MACHINE_FILES].map((n) => join(home, `${n}.enc`)).filter((x) => existsSync(x));
  if (orphelins.length && jetableParDossierSeul(home)) {
    // Sous le dossier temporaire sans être un essai : peut-être une vraie installation déplacée là. Ses secrets ne sont
    // jamais mis de côté pour cette seule raison.
    throw new Error('la clé de ce dossier d\'Odin est introuvable et il est sous le dossier temporaire du système : ses secrets ne sont pas mis de côté. Remets le dossier d\'Odin hors du dossier temporaire, ou pose ODIN_CLE_DIR sur le dossier qui contient sa clé.');
  }
  if (orphelins.length) {
    // Copies jamais écrasées : une mise de côté précédente reste là (copieDeCote) ; la clé, elle, est gardée par saveMachineKey.
    for (const x of orphelins) { copieDeCote(x, '.illisible'); rmSync(x, { force: true }); }
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
  refuserDossierReelEnEssai(home);
  const f = machineKeyFile(home);
  if (existsSync(f)) copieDeCote(f, '.avant-restauration');
  saveMachineKey(home, key, true);
}

// ---------------- Mise en place et migration ----------------

const check = (key: Buffer) => seal(key, Buffer.from('odin-coffre'), 'vault.json').toString('base64');
const checkOk = (key: Buffer, c: string) => { try { return timingSafeEqual(open(key, Buffer.from(c, 'base64'), 'vault.json'), Buffer.from('odin-coffre')); } catch { return false; } };

/**
 * Chiffre les secrets encore en clair d'un dossier (ancien Odin, fichier restauré) avec la bonne clé : relu, écrit chiffré,
 * relu chiffré ; l'ancien n'est effacé que si cette relecture rend exactement son contenu (sinon il est gardé, et le
 * passage suivant recommence : jamais un secret perdu).
 */
function sealPlain(home: string, names: readonly string[], key: Buffer): void {
  for (const n of names) {
    const f = join(home, n);
    if (!existsSync(f)) continue;
    const clair = readFileSync(f);
    garderLeChiffre(f, n);
    write600(`${f}.enc`, seal(key, clair, n));
    let relu = false;
    try { relu = open(key, readFileSync(`${f}.enc`), n).equals(clair); } catch { /* illisible : l'ancien est gardé */ }
    if (relu) shred(f);
    else console.error(`[coffre] ${n} : la copie chiffrée ne se relit pas à l'identique ; l'ancien fichier est gardé`);
  }
}
/**
 * Les clés reçues forment une liste qui s'allonge : un fichier en clair revenu à côté du chiffré (ancien code relancé,
 * restauration) ne le remplace jamais sans que le chiffré soit d'abord mis de côté (copie chiffrée, jamais écrasée).
 */
function garderLeChiffre(f: string, n: string): void {
  if (n !== CLES_RECUES || !existsSync(f) || !existsSync(`${f}.enc`)) return;
  const c = copieDeCote(`${f}.enc`, '.avant-migration');
  console.error(`[coffre] ${n} : un fichier en clair est revenu à côté du chiffré ; le chiffré est gardé de côté (${basename(c)})`);
}
/** Premier passage : pas de coffre → coffre à clé de machine, et les secrets en clair sont chiffrés puis effacés. */
export function ensureVault(home: string): void {
  refuserDossierReelEnEssai(home);
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
  if (existsSync(f)) {
    // Un fichier en clair déposé depuis (restauration, ancien code) : chiffré tout de suite. Si cela n'aboutit pas
    // (écriture impossible, relecture différente), l'ancien fait foi et il est rendu tel quel : jamais une erreur prise
    // pour « rien », qui ferait réécrire le fichier sans lui. La migration recommence au passage suivant.
    try { sealPlain(home, [n], key); } catch { console.error(`[coffre] ${n} : pas encore chiffré (écriture impossible) ; l'ancien fichier est gardé`); }
    if (existsSync(f)) return readFileSync(f, 'utf8');
  }
  if (!existsSync(`${f}.enc`)) return undefined;
  return open(key, readFileSync(`${f}.enc`), n).toString('utf8');
}
/** Écrit un fichier secret, toujours chiffré (refusé si le coffre est verrouillé). */
export function writeSecretFile(f: string, text: string): void {
  const home = dirname(f), n = basename(f);
  if (!isVaulted(n) && !isMachine(n)) return write600(f, text);
  refuserDossierReelEnEssai(home);
  mkdirSync(home, { recursive: true });
  ensureVault(home);
  const key = keyFor(home, n);
  if (!key) {
    // Coffre fermé : rien n'est écrit, ni chiffré ni en clair. Les clés reçues sont rangées par un appel qui ne lève
    // jamais : le journal le dit (sans aucune valeur).
    if (n === CLES_RECUES) console.error('[coffre] coffre fermé : clé reçue non gardée, rien n\'est écrit sur le disque');
    throw new Error('le coffre est verrouillé : déverrouille-le d\'abord (Accueil)');
  }
  garderLeChiffre(f, n);
  write600(`${f}.enc`, seal(key, Buffer.from(text, 'utf8'), n));
  shred(f);
}
// ---------------- Champs privés (numéros, adresses, position…) ----------------
// Une valeur privée dans un fichier de réglages (ou dans la base d'Odin) : chiffrée avec la clé de la machine, écrite
// « odc1:<base64> ». Toujours la clé de la machine (jamais le mot de passe maître) : Odin doit lire ses réglages au
// démarrage, coffre verrouillé ou pas.
const CHAMP = 'odc1:';
/** Une valeur déjà chiffrée par chiffrerChamp ? */
export const champChiffre = (v: unknown): v is string => typeof v === 'string' && v.startsWith(CHAMP);
/** Chiffre un texte avec la clé de la machine (coffre créé au besoin). */
export function chiffrerChamp(home: string, texte: string): string {
  refuserDossierReelEnEssai(home);
  mkdirSync(home, { recursive: true });
  ensureVault(home);
  const key = machineKey(home);
  if (!key) throw new Error('clé de la machine indisponible');
  return CHAMP + seal(key, Buffer.from(texte, 'utf8'), 'champ').toString('base64');
}
/** Déchiffre une valeur écrite par chiffrerChamp (une valeur en clair est rendue telle quelle) ; erreur si la clé ne l'ouvre pas. */
export function dechiffrerChamp(home: string, v: string): string {
  if (!champChiffre(v)) return v;
  const key = machineKey(home, false);
  if (!key) throw new Error('clé de la machine absente : valeur privée illisible');
  return open(key, Buffer.from(v.slice(CHAMP.length), 'base64'), 'champ').toString('utf8');
}

/** Un fichier secret existe-t-il (chiffré ou pas encore) ? */
export const secretFileExists = (f: string) => existsSync(`${f}.enc`) || existsSync(f);
/** Supprime un fichier secret. */
export function removeSecretFile(f: string): void { refuserDossierReelEnEssai(dirname(f)); shred(f); rmSync(`${f}.enc`, { force: true }); }

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
export function vaultUnlock(home: string, pw: string): void {
  const key = verify(home, pw);
  keys.set(home, key);
  // Un ancien fichier de clés reçues encore en clair (écrit avant qu'il soit du coffre, illisible coffre fermé) : chiffré dès l'ouverture.
  try { sealPlain(home, [CLES_RECUES], key); } catch { console.error(`[coffre] ${CLES_RECUES} : pas chiffré à l'ouverture (écriture impossible) ; l'ancien fichier est gardé`); }
}
export function vaultLock(home: string): void { if (vaultMode(home) === 'password') keys.delete(home); }
/** Retire le mot de passe maître : les secrets restent chiffrés, avec la clé de la machine. */
export function vaultDisable(home: string, pw: string): void {
  const key = verify(home, pw), mk = machineKey(home)!;
  rekey(home, key, mk);
  write600(meta(home), JSON.stringify({ v: 2, mode: 'machine', check: check(mk), cle: keyId(home) } satisfies Meta));
  keys.delete(home);
}
