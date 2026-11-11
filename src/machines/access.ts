// Les droits d'Odin : administrateur sur sa machine, et accès aux machines de ton réseau.
//
// - Machine locale : si tu lui donnes le mot de passe administrateur (Réglages → Droits et machines,
//   ou « odin admin password »), chaque « sudo » de ses commandes reçoit ce mot de passe tout seul
//   (SUDO_ASKPASS). Il peut aussi être réglé pour ne plus en avoir besoin (« odin admin nopasswd »).
//   S'il tourne déjà en root (conteneur LXC…), il n'a besoin de rien.
// - Autres machines : tu enregistres l'adresse, l'utilisateur et le mot de passe ; Odin s'y connecte
//   en SSH (client ssh du système, aucune dépendance) et peut aussi y faire des « sudo ».
//   Sa propre clé SSH peut y être installée pour ne plus dépendre du mot de passe.
// Les mots de passe restent dans ~/.odin (droits 600), ne sont jamais renvoyés à la page ni montrés
// au modèle, et sont masqués dans tout ce qu'Odin lit ou écrit (journal, réponses).
// Les règles de Heimdall s'appliquent toujours : commandes destructrices interdites, validation
// selon ton niveau d'autonomie.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readSecretFile, writeSecretFile } from '../vault.ts';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { diagnose, facts, isElevatedWindows, type AdminMode, type Diagnosis } from './admin.ts';
export type { AdminMode } from './admin.ts';

// ---------------- Mot de passe transmis sans terminal (askpass) ----------------

/** Petit programme qui répond au mot de passe à la place d'un humain (lu dans une variable d'environnement du seul processus lancé). */
export function askpassScript(home: string): string {
  const win = process.platform === 'win32';
  const f = join(home, win ? 'askpass.cmd' : 'askpass.sh');
  if (!existsSync(f)) {
    mkdirSync(home, { recursive: true });
    writeFileSync(f, win ? '@echo off\r\necho %ODIN_ASKPASS_SECRET%\r\n' : '#!/bin/sh\nprintf \'%s\\n\' "$ODIN_ASKPASS_SECRET"\n', { mode: 0o700 });
    try { chmodSync(f, 0o700); } catch { /* Windows */ }
  }
  return f;
}

// ---------------- Administrateur sur la machine locale ----------------

let rightsCache: { at: number; home: string; text: string } | undefined;
let diagCache: { at: number; home: string; d: Diagnosis } | undefined;
const adminFile = (home: string) => join(home, 'admin.json');
/** Mot de passe administrateur donné à Odin (fichier 600 ; ou variable ODIN_SUDO_PASSWORD). */
export function adminPassword(home: string, env = process.env): string | undefined {
  if (env.ODIN_SUDO_PASSWORD) return env.ODIN_SUDO_PASSWORD;
  try { return (JSON.parse(readSecretFile(adminFile(home)) ?? '{}') as { password?: string }).password || undefined; } catch { return undefined; }
}
export function setAdminPassword(home: string, password: string | undefined): void {
  writeSecretFile(adminFile(home), JSON.stringify(password ? { password } : {}));
  rightsCache = undefined; diagCache = undefined;
}

/** Odin a déjà tous les droits : root sous Linux et macOS, session élevée sous Windows. */
export const isRoot = () => (typeof process.getuid === 'function' && process.getuid() === 0) || isElevatedWindows();
export const hasSudo = () => process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v sudo'], { encoding: 'utf8' }).status === 0;

/**
 * Où en sont les droits d'Odin sur cette machine, pourquoi, et quoi faire (gardé une minute : la lecture
 * lance « sudo -n true »). Voir ./admin.ts pour le détail des cas.
 */
export function adminDiagnosis(home: string, env = process.env): Diagnosis {
  if (diagCache && diagCache.home === home && Date.now() - diagCache.at < 60_000) return diagCache.d;
  const d = diagnose(facts(Boolean(adminPassword(home, env))));
  diagCache = { at: Date.now(), home, d };
  return d;
}
/** Comment Odin obtient les droits administrateur ici. */
export function adminMode(home: string, env = process.env): AdminMode { diagCache = undefined; return adminDiagnosis(home, env).mode; }

/** Vérifie un mot de passe administrateur (sudo -k : on oublie l'éventuel accès en cache). */
export function checkSudoPassword(password: string, home: string): { ok: boolean; message: string } {
  if (isRoot()) return { ok: true, message: 'Odin tourne déjà en administrateur (root).' };
  if (!hasSudo()) return { ok: false, message: 'sudo est introuvable sur cette machine.' };
  const r = spawnSync('sudo', ['-k', '-A', 'true'], { env: { ...process.env, SUDO_ASKPASS: askpassScript(home), ODIN_ASKPASS_SECRET: password }, encoding: 'utf8', timeout: 15000 });
  return r.status === 0 ? { ok: true, message: 'Mot de passe administrateur correct.' } : { ok: false, message: /not in the sudoers|n'est pas dans le fichier sudoers/i.test(r.stderr) ? 'ce compte n\'a pas le droit d\'utiliser sudo' : 'mot de passe administrateur refusé' };
}

/**
 * Prépare une commande pour qu'elle obtienne les droits administrateur toute seule :
 * root → « sudo » retiré s'il n'existe pas ; mot de passe connu → « sudo -A » + askpass ; sinon « sudo -n »
 * (échoue vite au lieu d'attendre un mot de passe que personne ne tapera).
 */
export function withAdmin(command: string, home: string, env = process.env): { command: string; env: NodeJS.ProcessEnv; hint?: string } {
  if (!/\bsudo\b/.test(command) || process.platform === 'win32') return { command, env: {} };
  const quiet = (c: string) => c.replace(/\bsudo\b(?!\s+-[a-zA-Z]*n)/g, 'sudo -n');
  // Déjà administrateur (root) : rien à demander, jamais.
  if (isRoot()) return { command: hasSudo() ? quiet(command) : command.replace(/\bsudo\s+(-\S+\s+)*/g, ''), env: {} };
  const pw = adminPassword(home, env);
  if (pw) {
    return { command: command.replace(/\bsudo\b(?!\s+-[a-zA-Z]*A)/g, 'sudo -A'), env: { SUDO_ASKPASS: askpassScript(home), ODIN_ASKPASS_SECRET: pw } };
  }
  // Sans mot de passe gardé : « sudo -n » passe tout seul si Odin a déjà les droits (règle posée à l'installation),
  // et échoue tout de suite sinon. Le conseil ne se montre que dans ce second cas (voir sudoRefused).
  const d = adminDiagnosis(home, env);
  return { command: quiet(command), env: {}, hint: d.ok ? ADMIN_HINT : `${d.state[0].toUpperCase()}${d.state.slice(1)}. ${d.fix}` };
}
/** Ce qu'Odin dit quand il lui manque vraiment les droits administrateur : une phrase à écrire, une seule fois. */
export const ADMIN_HINT = 'Il me manque les droits administrateur sur ce poste. Dis-moi une fois, dans la discussion : « le mot de passe admin de ce poste est … ». Il n\'est montré à aucune IA, je deviens administrateur pour de bon et je ne te le redemande plus. (Ou : Réglages → Droits et machines.)';
/**
 * La sortie d'une commande montre-t-elle qu'Odin n'a pas pu devenir administrateur ? (mot de passe demandé,
 * service verrouillé, sudo absent). Sinon l'échec vient d'ailleurs : on ne parle pas de droits.
 */
export const sudoRefused = (out: string) => /sudo: (?:a password is required|a terminal is required|no tty present|no askpass program|sorry, you must have a tty|il est nécessaire de saisir un mot de passe|un mot de passe est (?:requis|nécessaire)|un terminal est (?:requis|nécessaire)|effective uid is not 0)|no new privileges|sudo: (?:command )?not found|sudo : commande introuvable|sudo: introuvable/i.test(out);

/** Ligne sudoers qui dispense Odin de mot de passe (à installer avec les droits administrateur). */
export const sudoersLine = (user: string) => `${user} ALL=(ALL:ALL) NOPASSWD: ALL\n`;

/**
 * Rend Odin administrateur durablement : règle sudoers « sans mot de passe » vérifiée par visudo
 * (une erreur ne casse jamais sudo). Avec le mot de passe donné (sudo -A), ou sudo -n s'il est déjà permis.
 */
export function installNopasswd(home: string, password?: string, user = userInfo().username): { ok: boolean; message: string } {
  if (process.platform === 'win32') return { ok: false, message: 'Windows : lance Odin dans une session administrateur.' };
  if (isRoot()) return { ok: true, message: 'Odin tourne déjà en administrateur (root).' };
  if (!hasSudo()) return { ok: false, message: 'sudo est introuvable sur cette machine.' };
  if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) return { ok: false, message: `nom d'utilisateur inattendu : ${user}` };
  const line = sudoersLine(user).trim();
  const script = `t=$(mktemp) && printf '%s\\n' '${line}' > "$t" && visudo -cf "$t" >/dev/null && install -m 0440 "$t" /etc/sudoers.d/odin; s=$?; rm -f "$t"; exit $s`;
  const r = password
    ? spawnSync('sudo', ['-A', 'sh', '-c', script], { env: { ...process.env, SUDO_ASKPASS: askpassScript(home), ODIN_ASKPASS_SECRET: password }, encoding: 'utf8', timeout: 30_000 })
    : spawnSync('sudo', ['-n', 'sh', '-c', script], { encoding: 'utf8', timeout: 30_000 });
  rightsCache = undefined; diagCache = undefined;
  return r.status === 0 ? { ok: true, message: 'Odin est administrateur de cette machine (sudo sans mot de passe, règle /etc/sudoers.d/odin).' } : { ok: false, message: (r.stderr || 'règle non installée').trim().split('\n').at(-1) ?? 'échec' };
}

/** La commande a-t-elle échoué faute de droits ? (on la relance alors avec sudo) */
export const deniedOutput = (out: string) => /permission denied|permission non accordée|operation not permitted|opération non permise|must be root|must be run as root|are you root|êtes-vous root|requires root|need to be root|superuser|EACCES|could not open lock file|unable to lock|access denied|accès refusé/i.test(out);

/** Résumé des droits pour le prompt (gardé une minute). */
export function rightsSummary(home: string, env = process.env): string {
  if (rightsCache && rightsCache.home === home && Date.now() - rightsCache.at < 60_000) return rightsCache.text;
  const d = adminDiagnosis(home, env), mode = d.mode;
  const local = mode === 'root' ? 'tu es administrateur (root) sur cette machine'
    : mode === 'nopasswd' ? 'tu as les droits administrateur sur cette machine (sudo sans mot de passe)'
    : mode === 'password' ? 'tu as les droits administrateur sur cette machine : « sudo » reçoit le mot de passe tout seul'
    : mode === 'none' ? 'tu n\'es PAS encore administrateur ici, mais le propriétaire veut que tu le sois. Ne réponds jamais seulement « je n\'ai pas les droits » : demande-lui UNE fois le mot de passe de sa session (« le mot de passe admin de ce poste est … »), puis appelle admin_enable — tu deviens administrateur pour de bon'
    // Service verrouillé, sudo absent, Windows non élevé : un mot de passe n'y changerait rien. On donne la vraie cause et la commande exacte.
    : `tu n'es PAS administrateur ici, et tu ne peux pas le devenir toi-même : ${d.state}. Ne demande PAS de mot de passe (il ne servirait à rien). Dis au propriétaire la cause en une phrase et donne-lui exactement ceci : ${d.fix.replace(/\n\s*/g, ' ⏎ ')}`;
  const ms = listMachines(home);
  const text = `## Droits\n- Machine locale : ${local}.${mode === 'root' || mode === 'nopasswd' || mode === 'password' ? ' Sers-toi de sudo sans demander la permission au propriétaire (Heimdall reste juge) ; si une commande est refusée faute de droits, elle est relancée avec sudo toute seule.' : ''}\n- Machines du réseau accessibles (outil machine_exec, machine_copy) : ${ms.length ? ms.map((m) => `${m.label} (${m.user}@${m.host})`).join(', ') : 'aucune pour l\'instant (le propriétaire les ajoute avec leurs mots de passe dans Réglages → Droits et machines)'}.\n- Fichiers : tout le disque (chemin absolu ou ~/… dans fs_read, fs_list, fs_write, fs_edit ; « cwd » pour shell et python). Python 3 est disponible (outil python).
- Quand on te demande ce qu'est un appareil ou son nom : net_identify d'abord, puis réponds précisément (nom, type, IP, à quoi il sert). Jamais de réponse vague : si aucun nom n'est trouvé, dis-le et propose de le renommer.
- Avant un changement risqué sur une machine : change_plan (impact, retour arrière, vérifications), puis suis-le.
- Ton propre code : tu peux te mettre à jour (self_update) et t'améliorer toi-même (self_info, self_read, self_edit, self_check, self_restart, self_rollback). Toujours : lire le code, modifier, self_check, puis prévenir l'utilisateur et self_restart.
- N'affiche jamais un mot de passe ; tu n'en as pas besoin, ils sont fournis tout seuls.`;
  rightsCache = { at: Date.now(), home, text };
  return text;
}
export function forgetRights(): void { rightsCache = undefined; diagCache = undefined; }

// ---------------- Coffre des machines du réseau ----------------

export interface Machine {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  /** Mot de passe sudo s'il diffère du mot de passe de connexion. */
  sudoPassword?: string;
  /** La clé SSH d'Odin a été installée sur la machine. */
  keyInstalled?: boolean;
  addedAt: number;
  lastOk?: number;
}
/** Vue sans secret (page web, modèle). */
export type MachineView = Omit<Machine, 'password' | 'sudoPassword'> & { hasPassword: boolean };

const vaultFile = (home: string) => join(home, 'machines.json');
export function listMachines(home: string): Machine[] {
  try { return JSON.parse(readSecretFile(vaultFile(home)) ?? '[]') as Machine[]; } catch { return []; }
}
function saveMachines(home: string, list: Machine[]): void {
  writeSecretFile(vaultFile(home), JSON.stringify(list, null, 2));
}
export const viewMachine = (m: Machine): MachineView => { const { password: _p, sudoPassword: _s, ...rest } = m; return { ...rest, hasPassword: Boolean(m.password) }; };

const HOST = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9a-fA-F:]+\]?$/;
const USER = /^[a-z_][a-z0-9_.-]{0,31}\$?$/i;
export function saveMachine(home: string, m: { id?: string; label?: string; host: string; port?: number; user: string; password?: string; sudoPassword?: string }): Machine {
  const host = m.host.trim(), user = m.user.trim(), port = Number(m.port ?? 22);
  if (!HOST.test(host)) throw new Error('adresse invalide (ex. 192.168.1.30 ou nas.local)');
  if (!USER.test(user)) throw new Error('nom d\'utilisateur invalide');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port invalide');
  const list = listMachines(home);
  const prev = list.find((x) => (m.id && x.id === m.id) || (x.host === host && x.user === user && x.port === port));
  const next: Machine = {
    id: prev?.id ?? `m_${randomBytes(4).toString('hex')}`,
    label: (m.label ?? prev?.label ?? host).trim().slice(0, 60) || host,
    host, port, user,
    password: m.password !== undefined && m.password !== '' ? m.password : prev?.password,
    sudoPassword: m.sudoPassword !== undefined && m.sudoPassword !== '' ? m.sudoPassword : prev?.sudoPassword,
    keyInstalled: prev?.keyInstalled,
    addedAt: prev?.addedAt ?? Date.now(),
    lastOk: prev?.lastOk,
  };
  saveMachines(home, [...list.filter((x) => x.id !== next.id), next]);
  return next;
}
export function removeMachine(home: string, idOrName: string): boolean {
  const list = listMachines(home), keep = list.filter((x) => x.id !== idOrName && x.label !== idOrName && x.host !== idOrName);
  saveMachines(home, keep);
  return keep.length !== list.length;
}
export function findMachine(home: string, name: string): Machine | undefined {
  const n = name.trim().toLowerCase();
  const list = listMachines(home);
  return list.find((x) => x.id === name) ?? list.find((x) => x.label.toLowerCase() === n) ?? list.find((x) => x.host.toLowerCase() === n) ?? list.find((x) => `${x.user}@${x.host}`.toLowerCase() === n);
}
function touchMachine(home: string, id: string, patch: Partial<Machine>): void {
  const list = listMachines(home); const m = list.find((x) => x.id === id); if (!m) return;
  Object.assign(m, patch); saveMachines(home, list);
}
/** Tous les mots de passe connus (pour les masquer partout). */
export const machineSecrets = (home: string) => [adminPassword(home), ...listMachines(home).flatMap((m) => [m.password, m.sudoPassword])].filter((x): x is string => Boolean(x && x.length >= 4));

// ---------------- SSH ----------------

export const odinKey = (home: string) => join(home, 'id_ed25519');
/** Clé SSH propre à Odin (créée au besoin, sans phrase de passe, lisible par toi seul). */
export function ensureOdinKey(home: string): string | undefined {
  const k = odinKey(home);
  if (!existsSync(k)) {
    const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'odin', '-f', k], { stdio: 'ignore', timeout: 20000 });
    if (r.status !== 0) return undefined;
  }
  return existsSync(`${k}.pub`) ? readFileSync(`${k}.pub`, 'utf8').trim() : undefined;
}

/** Arguments ssh communs (pur, testable). */
export function sshArgs(home: string, m: Pick<Machine, 'host' | 'port' | 'user' | 'password'>, extra: string[] = []): string[] {
  const a = ['-p', String(m.port), '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(home, 'known_hosts')}`,
    '-o', 'NumberOfPasswordPrompts=1', '-o', `PreferredAuthentications=${m.password ? 'publickey,password,keyboard-interactive' : 'publickey'}`, '-o', 'LogLevel=ERROR'];
  if (!m.password) a.push('-o', 'BatchMode=yes');
  if (existsSync(odinKey(home))) a.push('-i', odinKey(home));
  return [...a, ...extra, `${m.user}@${m.host.replace(/^\[|\]$/g, '')}`];
}

/** Commande distante : chaque « sudo » lit le mot de passe sur l'entrée (sudo -S), sans invite. */
export function remoteCommand(command: string, hasSudoPassword: boolean): string {
  return hasSudoPassword ? command.replace(/\bsudo\b(?!\s+-[a-zA-Z]*S)/g, "sudo -S -p ''") : command;
}

export interface RunOptions { timeoutMs?: number; signal?: AbortSignal; stdin?: string | Buffer; /** Garder la sortie standard telle quelle (fichier copié). */ binary?: boolean }
/** Lance une commande sur une machine du coffre. */
export function runOnMachine(home: string, m: Machine, command: string, o: RunOptions = {}): Promise<{ code: number | null; out: string; data?: Buffer }> {
  const sudoPw = m.sudoPassword ?? m.password;
  const usesSudo = /\bsudo\b/.test(command) && Boolean(sudoPw);
  const remote = remoteCommand(command, usesSudo);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (m.password) Object.assign(env, { SSH_ASKPASS: askpassScript(home), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY || ':0', ODIN_ASKPASS_SECRET: m.password });
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgs(home, m, ['-T']).concat(remote), { env, signal: o.signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const chunks: Buffer[] = [];
    const add = (d: Buffer) => { if (out.length < 60_000) out += d.toString(); };
    child.stdout.on('data', o.binary ? (d: Buffer) => chunks.push(d) : add); child.stderr.on('data', add);
    // Mot de passe sudo : une ligne par « sudo » de la commande, puis l'entrée éventuelle.
    const n = usesSudo ? (remote.match(/sudo -S/g) ?? []).length : 0;
    child.stdin.end(Buffer.concat([Buffer.from(n ? `${sudoPw}\n`.repeat(n) : ''), Buffer.isBuffer(o.stdin) ? o.stdin : Buffer.from(o.stdin ?? '')]));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out: `Erreur : ${e.message}${/ENOENT/.test(e.message) ? ' (client ssh introuvable : installe openssh-client)' : ''}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) touchMachine(home, m.id, { lastOk: Date.now() });
      resolve({ code, out: out.replace(/^\[sudo\][^\n]*\n?/gm, ''), ...(o.binary ? { data: Buffer.concat(chunks) } : {}) });
    });
  });
}

/** Teste la connexion ; installe au passage la clé d'Odin si demandé. */
export async function testMachine(home: string, m: Machine, installKey = true): Promise<{ ok: boolean; message: string }> {
  const r = await runOnMachine(home, m, 'echo odin-ok; uname -sn 2>/dev/null || ver', { timeoutMs: 25_000 });
  if (r.code !== 0 || !r.out.includes('odin-ok')) {
    const why = /Permission denied/i.test(r.out) ? 'utilisateur ou mot de passe refusé' : /Connection refused/i.test(r.out) ? 'SSH fermé sur cette machine (port refusé)' : /timed out|No route|unreachable/i.test(r.out) ? 'machine injoignable' : /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(r.out) ? 'l\'empreinte de la machine a changé (sécurité) : retire-la de ~/.odin/known_hosts si c\'est normal' : r.out.trim().slice(0, 160);
    return { ok: false, message: `Connexion impossible : ${why}` };
  }
  let extra = '';
  if (installKey && !m.keyInstalled) {
    const pub = ensureOdinKey(home);
    if (pub) {
      const add = await runOnMachine(home, m, `umask 077; mkdir -p ~/.ssh; grep -qF '${pub.split(' ')[1]}' ~/.ssh/authorized_keys 2>/dev/null || cat >> ~/.ssh/authorized_keys`, { stdin: `${pub}\n`, timeoutMs: 20_000 });
      if (add.code === 0) { touchMachine(home, m.id, { keyInstalled: true }); extra = ' Clé SSH d\'Odin installée.'; }
    }
  }
  return { ok: true, message: `Connecté à ${r.out.replace('odin-ok', '').trim().split('\n')[0] || m.host}.${extra}` };
}
