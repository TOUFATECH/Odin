// Odin administrateur de sa machine, partout (Linux, conteneur, macOS, Windows).
//
// Deux choses ici :
//  1. le diagnostic : Odin sait POURQUOI il n'est pas administrateur (compte ordinaire sans sudo, sudo qui
//     demande un mot de passe, service verrouillé par « NoNewPrivileges », conteneur sans droits, Windows
//     non élevé) et le dit avec la commande exacte qui règle le problème, au lieu de réclamer un mot de
//     passe qui ne servirait à rien ;
//  2. la réparation : « odin admin fix », lancée une fois par un administrateur, donne les droits pour de bon
//     (règle sudo vérifiée par visudo, verrous du service retirés, tâche Windows en privilèges élevés) et
//     revient en arrière toute seule si le service ne redémarre pas.
//
// Un service verrouillé ne peut pas se déverrouiller lui-même : c'est le système qui l'interdit. D'où la
// commande à lancer une fois de l'extérieur. Les installateurs, eux, posent les droits dès le départ.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AdminMode = 'root' | 'nopasswd' | 'password' | 'none' | 'absent' | 'blocked';

/** Ce qu'on sait de la machine (réunis à part pour que le diagnostic soit une fonction pure, testable). */
export interface Facts {
  platform: NodeJS.Platform;
  /** Identifiant du compte (0 = root). -1 sous Windows. */
  uid: number;
  /** Windows : session lancée en administrateur. */
  elevated: boolean;
  /** Linux : le processus ne peut plus gagner de droits (service verrouillé, conteneur durci). */
  noNewPrivs: boolean;
  /** La commande sudo existe. */
  sudo: boolean;
  /** sudo marche sans mot de passe. */
  sudoFree: boolean;
  /** Un mot de passe administrateur a été donné à Odin. */
  password: boolean;
  /** Service systemd qui lance Odin, s'il y en a un. */
  unit?: { name: string; scope: 'system' | 'user' };
  /** Odin tourne dans un conteneur (Docker, Podman, Kubernetes, LXC). */
  container: boolean;
  /** Compte sous lequel Odin tourne. */
  user: string;
  /** Commande complète qui lance Odin (pour l'écrire telle quelle dans les conseils). */
  command: string;
}
export interface Diagnosis { mode: AdminMode; ok: boolean; state: string; fix: string }

const ASK_PASSWORD = 'Dis-moi une fois, dans la discussion : « le mot de passe admin de ce poste est … ». Il n\'est montré à aucune IA, je deviens administrateur pour de bon et je ne te le redemande plus. (Ou : Réglages → Droits et machines.)';

/** Pourquoi Odin est, ou n'est pas, administrateur ici, et quoi faire. Pur. */
export function diagnose(f: Facts): Diagnosis {
  const once = (extra = '') => `Sur la machine, depuis un compte administrateur, lance une fois :\n  sudo ${f.command} admin fix${f.unit?.scope === 'system' ? ` --unit ${f.unit.name}` : ''} --user ${f.user}${extra}`;
  if (f.platform === 'win32') {
    return f.elevated
      ? { mode: 'root', ok: true, state: 'administrateur (session Windows élevée) : je peux tout faire ici', fix: '' }
      : { mode: 'absent', ok: false, state: 'pas administrateur : Windows ne m\'a pas lancé avec les droits élevés', fix: 'Ouvre PowerShell en administrateur (clic droit → « Exécuter en tant qu\'administrateur ») et lance une fois :\n  odin admin fix\nJe démarrerai ensuite en administrateur à chaque ouverture de session.' };
  }
  if (f.uid === 0) return { mode: 'root', ok: true, state: 'administrateur (root) : je peux tout faire ici', fix: '' };
  if (f.noNewPrivs) {
    if (f.unit) return { mode: 'blocked', ok: false, state: `pas administrateur : le service « ${f.unit.name} » qui me lance m'interdit de le devenir (verrou « NoNewPrivileges »). Aucun mot de passe n'y change rien`, fix: `${once()}\nLa commande retire ce verrou, me donne les droits et me redémarre. Si le service ne repart pas, elle remet tout comme avant.` };
    if (f.container) return { mode: 'blocked', ok: false, state: 'pas administrateur : ce conteneur est lancé avec l\'option « no-new-privileges », qui m\'interdit de le devenir. Aucun mot de passe n\'y change rien', fix: 'Relance le conteneur sans cette option, ou en root :\n  docker run --user root …   (dans un fichier compose : user: root, et retire « no-new-privileges »)' };
    return { mode: 'blocked', ok: false, state: 'pas administrateur : le programme qui me lance m\'interdit de le devenir (verrou « NoNewPrivileges »). Aucun mot de passe n\'y change rien', fix: `Lance-moi sans ce verrou. ${once()}` };
  }
  if (!f.sudo) {
    return f.container
      ? { mode: 'absent', ok: false, state: 'pas administrateur : dans ce conteneur je ne suis pas root, et sudo n\'y est pas installé', fix: 'Relance le conteneur en root :\n  docker run --user root …   (dans un fichier compose : user: root)\nou reconstruis l\'image d\'Odin à jour : elle me donne les droits.' }
      : { mode: 'absent', ok: false, state: 'pas administrateur : sudo n\'est pas installé sur cette machine, et je ne tourne pas en root', fix: `${once()}\n(en root directement si sudo n'existe pas : enlève « sudo » au début ; la commande l'installe.)` };
  }
  if (f.sudoFree) return { mode: 'nopasswd', ok: true, state: 'administrateur : sudo sans mot de passe', fix: '' };
  if (f.password) return { mode: 'password', ok: true, state: 'administrateur : sudo reçoit tout seul le mot de passe que tu m\'as donné', fix: '' };
  return { mode: 'none', ok: false, state: 'pas encore administrateur : sudo me demande un mot de passe', fix: `${ASK_PASSWORD}\nOu, sur la machine : ${once().split('\n').slice(1).join('\n').trim()}` };
}

// ---------------- Les faits, lus sur la machine ----------------

let winElevated: boolean | undefined;
/** Windows : « net session » ne réussit que dans une session administrateur élevée. */
export function isElevatedWindows(): boolean {
  if (process.platform !== 'win32') return false;
  winElevated ??= spawnSync('net', ['session'], { stdio: 'ignore', timeout: 8000, windowsHide: true }).status === 0;
  return winElevated;
}
/** Linux : ce processus (et ses commandes) ne peut plus gagner de droits. */
export function noNewPrivs(status?: string): boolean {
  let s = status;
  if (s === undefined) { if (process.platform !== 'linux') return false; try { s = readFileSync('/proc/self/status', 'utf8'); } catch { return false; } }
  return /^NoNewPrivs:\s*1\s*$/m.test(s);
}
/** Service systemd qui lance ce processus, d'après son groupe de contrôle. */
export function unitOf(cgroup: string): Facts['unit'] {
  const lines = cgroup.split('\n').map((l) => l.split(':').slice(2).join(':')).filter(Boolean);
  for (const l of lines) {
    const m = /\/([^/]+\.service)(?:\/[^/]*)?$/.exec(l); if (!m) continue;
    const name = m[1];
    if (/^user@\d+\.service$/.test(name) || /^(session-|init\.scope)/.test(name)) continue;
    return { name, scope: /\/user@\d+\.service\//.test(l) ? 'user' : 'system' };
  }
  return undefined;
}
export function inContainer(cgroup: string, env: NodeJS.ProcessEnv = process.env, has: (p: string) => boolean = existsSync): boolean {
  return has('/.dockerenv') || has('/run/.containerenv') || Boolean(env.container) || Boolean(env.KUBERNETES_SERVICE_HOST) || /docker|kubepods|containerd|libpod|\/lxc\//.test(cgroup);
}
/** Commande qui relance Odin (chemins complets, entre guillemets s'ils contiennent une espace). */
export function selfCommand(): string {
  const q = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'odin.mjs');
  return `${q(process.execPath)} ${q(entry)}`;
}
const hasCmd = (c: string) => process.platform !== 'win32' && spawnSync('sh', ['-c', `command -v ${c}`], { stdio: 'ignore' }).status === 0;

/** Lit la situation réelle. `password` : un mot de passe administrateur est-il gardé par Odin ? */
export function facts(password: boolean): Facts {
  const linux = process.platform === 'linux', win = process.platform === 'win32';
  let cgroup = ''; if (linux) { try { cgroup = readFileSync('/proc/self/cgroup', 'utf8'); } catch { /* pas de /proc */ } }
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  const nnp = noNewPrivs(), sudo = !win && hasCmd('sudo');
  let user = ''; try { user = userInfo().username; } catch { user = process.env.USER ?? process.env.USERNAME ?? ''; }
  return {
    platform: process.platform, uid, elevated: isElevatedWindows(), noNewPrivs: nnp, sudo,
    sudoFree: sudo && !nnp && uid !== 0 && spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore', timeout: 5000 }).status === 0,
    password, unit: linux ? unitOf(cgroup) : undefined, container: linux && inContainer(cgroup), user, command: selfCommand(),
  };
}

// ---------------- Réparation : « odin admin fix » ----------------

/** Réglages d'un service qui, pour un compte ordinaire, verrouillent « NoNewPrivileges » (documentation systemd.exec). */
const NNP_BOOL = ['PrivateDevices', 'ProtectKernelTunables', 'ProtectKernelModules', 'ProtectKernelLogs', 'ProtectClock', 'ProtectHostname', 'MemoryDenyWriteExecute', 'RestrictRealtime', 'RestrictSUIDSGID', 'LockPersonality', 'PrivateUsers'];
const NNP_LIST = ['SystemCallFilter', 'SystemCallArchitectures', 'RestrictAddressFamilies'];
export const SHOWN = ['LoadState', 'ActiveState', 'FragmentPath', 'User', 'MainPID', 'DynamicUser', 'NoNewPrivileges', 'ProtectSystem', 'ProtectHome', 'RestrictNamespaces', 'CapabilityBoundingSet', 'ReadOnlyPaths', 'InaccessiblePaths', ...NNP_BOOL, ...NNP_LIST];

/** Sortie de « systemctl show » → réglages. */
export function parseShow(out: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of out.split('\n')) { const i = l.indexOf('='); if (i > 0) r[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return r;
}
const on = (v: string | undefined) => v !== undefined && v !== '' && !/^(no|false|0)$/i.test(v);
/**
 * Complément de service qui laisse Odin devenir administrateur : seuls les réglages qui l'en empêchent
 * sont remis à zéro (ceux lus dans le service ; tous si on n'a rien pu lire). Pur.
 */
export function dropIn(props: Record<string, string> = {}): string {
  const known = Object.keys(props).length > 0;
  const L = ['# Écrit par « odin admin fix » : Odin est administrateur de cette machine.', '# Ces réglages du service l\'en empêchaient. Pour revenir en arrière : supprime ce fichier,', '# puis « systemctl daemon-reload » et redémarre le service.', '[Service]', 'NoNewPrivileges=no'];
  for (const k of NNP_BOOL) if (!known || on(props[k])) L.push(`${k}=no`);
  for (const k of NNP_LIST) if (!known || on(props[k])) L.push(`${k}=`);
  if (!known || on(props.RestrictNamespaces)) L.push('RestrictNamespaces=no');
  if (!known || on(props.ProtectSystem)) L.push('ProtectSystem=no');
  if (!known || on(props.ProtectHome)) L.push('ProtectHome=no');
  if (!known || on(props.ReadOnlyPaths)) L.push('ReadOnlyPaths=');
  if (!known || on(props.InaccessiblePaths)) L.push('InaccessiblePaths=');
  // Capacités réduites par le service (root n'y pourrait presque rien) : « ~ » seul les rend toutes
  // (une liste vide, elle, les retirerait toutes). Rien n'est écrit si le service ne les a pas réduites.
  if (known && props.CapabilityBoundingSet !== undefined && !/\bcap_sys_admin\b/.test(props.CapabilityBoundingSet)) L.push('CapabilityBoundingSet=~');
  return `${L.join('\n')}\n`;
}

export interface Shell { (cmd: string, args: string[], input?: string): { code: number; out: string } }
const realShell: Shell = (cmd, args, input) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, input }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }; };

export interface FixOptions { unit?: string; user?: string; sh?: Shell; root?: string; isRoot?: boolean; sleep?: (ms: number) => void; has?: (cmd: string) => boolean; readStatus?: (pid: string) => string }
export interface FixResult { ok: boolean; lines: string[] }

/** Règle sudo « sans mot de passe » pour un compte, vérifiée par visudo avant d'être posée. */
function sudoers(user: string, sh: Shell, root: string, lines: string[]): boolean {
  if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) { lines.push(`✗ Nom de compte inattendu : ${user}.`); return false; }
  const dir = join(root, 'etc', 'sudoers.d'), file = join(dir, 'odin'), tmp = `${file}.essai`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    writeFileSync(tmp, `${user} ALL=(ALL:ALL) NOPASSWD: ALL\n`, { mode: 0o440 });
    const v = sh('visudo', ['-cf', tmp]);
    if (v.code !== 0) { rmSync(tmp, { force: true }); lines.push(`✗ Règle sudo refusée par visudo (${v.out.split('\n').at(-1) ?? 'erreur'}) : rien n'est changé.`); return false; }
    writeFileSync(file, readFileSync(tmp)); rmSync(tmp, { force: true });
    sh('chmod', ['0440', file]);
    lines.push(`✓ Le compte « ${user} » peut utiliser sudo sans mot de passe (règle ${file}, vérifiée).`);
    return true;
  } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* rien */ } lines.push(`✗ Règle sudo non posée : ${(e as Error).message}.`); return false; }
}

/**
 * Rend Odin administrateur pour de bon sur Linux et macOS. À lancer en root (sudo). Chaque étape est
 * dite ; si le service ne redémarre pas avec le nouveau réglage, l'ancien est remis.
 */
export function fixAdmin(o: FixOptions = {}): FixResult {
  const sh = o.sh ?? realShell, root = o.root ?? '/', lines: string[] = [], has = o.has ?? hasCmd;
  const sleep = o.sleep ?? ((ms: number) => { spawnSync('sleep', [String(ms / 1000)]); });
  const amRoot = o.isRoot ?? (typeof process.getuid === 'function' && process.getuid() === 0);
  if (!amRoot) return { ok: false, lines: [`Cette commande change les droits de la machine : lance-la en administrateur.\n  sudo ${selfCommand()} admin fix${o.unit ? ` --unit ${o.unit}` : ''}${o.user ? ` --user ${o.user}` : ''}`] };

  // Quel service, quel compte ?
  const systemd = has('systemctl');
  let unit = o.unit ?? '';
  if (unit && !/^[\w@.:-]+$/.test(unit)) return { ok: false, lines: [`Nom de service inattendu : ${unit}.`] };
  if (unit && !unit.endsWith('.service')) unit += '.service';
  let props: Record<string, string> = {};
  if (systemd) {
    if (!unit) { const guess = parseShow(sh('systemctl', ['show', 'odin.service', `--property=${SHOWN.join(',')}`]).out); if (guess.LoadState === 'loaded') unit = 'odin.service'; }
    if (unit) props = parseShow(sh('systemctl', ['show', unit, `--property=${SHOWN.join(',')}`]).out);
    if (unit && props.LoadState !== 'loaded') { lines.push(`ℹ Service « ${unit} » introuvable parmi les services du système : je m'occupe seulement des droits du compte.`); unit = ''; props = {}; }
  }
  const user = o.user || props.User || process.env.SUDO_USER || '';
  if (!user && !unit) return { ok: false, lines: ['Dis-moi pour quel compte : sudo … admin fix --user <compte qui lance Odin>'] };

  // 1. Le compte : sudo sans mot de passe (sauf root, qui a déjà tout).
  let ok = true;
  if (user && user !== 'root') {
    if (!has('sudo')) {
      const pm = has('apt-get') ? ['apt-get', 'install', '-y', '-qq', 'sudo'] : has('dnf') ? ['dnf', 'install', '-y', '-q', 'sudo'] : has('apk') ? ['apk', 'add', 'sudo'] : has('pacman') ? ['pacman', '-S', '--noconfirm', '--needed', 'sudo'] : undefined;
      if (pm) { if (pm[0] === 'apt-get') sh('apt-get', ['update', '-qq']); const r = sh(pm[0], pm.slice(1)); lines.push(r.code === 0 ? '✓ sudo installé.' : `✗ sudo n'a pas pu être installé (${r.out.split('\n').at(-1) ?? 'erreur'}).`); }
      else lines.push('✗ sudo est absent et je ne connais pas le gestionnaire de paquets de cette machine : installe-le, puis relance cette commande.');
    }
    ok = sudoers(user, sh, root, lines) && ok;
  } else if (user === 'root') lines.push('✓ Le compte est root : rien à ajouter côté droits.');

  // 2. Le service : retirer ce qui interdit de devenir administrateur.
  if (unit) {
    if (on(props.DynamicUser)) { lines.push(`✗ Le service « ${unit} » utilise un compte temporaire (DynamicUser) : je ne peux pas le rendre administrateur tout seul. Donne-lui un vrai compte (User=…), puis relance cette commande.`); return { ok: false, lines }; }
    const dir = join(root, 'etc', 'systemd', 'system', `${unit}.d`), file = join(dir, '90-odin-administrateur.conf');
    const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    const restart = () => { sh('systemctl', ['daemon-reload']); return sh('systemctl', ['restart', unit]); };
    const active = () => { for (let i = 0; i < 10; i++) { sleep(1500); const s = sh('systemctl', ['is-active', unit]).out.split('\n')[0]?.trim(); if (s === 'active') return true; if (s === 'failed') return false; } return false; };
    try { mkdirSync(dir, { recursive: true }); writeFileSync(file, dropIn(props)); }
    catch (e) { lines.push(`✗ Réglage du service non écrit : ${(e as Error).message}.`); return { ok: false, lines }; }
    const r = restart();
    if (r.code !== 0 || !active()) {
      // Retour arrière : le service doit repartir comme avant.
      try { if (before === undefined) rmSync(file, { force: true }); else writeFileSync(file, before); } catch { /* rien */ }
      const back = restart();
      lines.push(`✗ Le service « ${unit} » n'a pas redémarré avec le nouveau réglage : je l'ai retiré${back.code === 0 ? ' et le service est relancé comme avant' : ' (relance-le : systemctl restart ' + unit + ')'}. Détail : ${(r.out || sh('systemctl', ['status', unit, '--no-pager', '-n', '5']).out).split('\n').slice(-3).join(' | ').slice(0, 300)}`);
      return { ok: false, lines };
    }
    lines.push(`✓ Service « ${unit} » : verrous retirés (${file}) et service redémarré.`);
    // Vérification sur le processus réel.
    const pid = parseShow(sh('systemctl', ['show', unit, '--property=MainPID']).out).MainPID;
    let status = ''; try { status = pid && pid !== '0' ? (o.readStatus ?? ((p: string) => readFileSync(`/proc/${p}/status`, 'utf8')))(pid) : ''; } catch { /* processus parti */ }
    if (status && noNewPrivs(status)) { lines.push('✗ Le verrou est encore là sur le processus : un autre réglage du service l\'impose. Montre-moi le fichier du service (systemctl cat ' + unit + ').'); ok = false; }
    else if (status) lines.push('✓ Vérifié sur le processus : plus de verrou, Odin peut devenir administrateur.');
  } else if (user && user !== 'root') lines.push('ℹ Redémarre Odin pour qu\'il voie ses nouveaux droits.');
  return { ok, lines };
}

/** Windows : la tâche planifiée « Odin » démarre avec les privilèges élevés. À lancer dans une session administrateur. */
export function fixAdminWindows(sh: Shell = realShell, elevated = isElevatedWindows()): FixResult {
  if (!elevated) return { ok: false, lines: ['Cette commande change les droits de la machine : ouvre PowerShell en administrateur (clic droit → « Exécuter en tant qu\'administrateur »), puis relance :\n  odin admin fix'] };
  // (Guillemets simples partout : le texte passe tel quel sur la ligne de commande de PowerShell.)
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$t = Get-ScheduledTask -TaskName 'Odin' -ErrorAction SilentlyContinue",
    "if (-not $t) { Write-Output 'ABSENTE'; exit 3 }",
    "$p = New-ScheduledTaskPrincipal -UserId $t.Principal.UserId -LogonType Interactive -RunLevel Highest",
    "Set-ScheduledTask -TaskName 'Odin' -Principal $p | Out-Null",
    "Stop-ScheduledTask -TaskName 'Odin' -ErrorAction SilentlyContinue",
    "Start-ScheduledTask -TaskName 'Odin'",
    "Write-Output ((Get-ScheduledTask -TaskName 'Odin').Principal.RunLevel)",
  ].join('; ');
  const r = sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (r.code === 3 || /ABSENTE/.test(r.out)) return { ok: false, lines: ['La tâche « Odin » n\'existe pas encore : relance l\'installateur d\'Odin (dans cette fenêtre administrateur), il la crée avec les bons droits.'] };
  if (r.code !== 0 || !/Highest/i.test(r.out)) return { ok: false, lines: [`✗ La tâche « Odin » n'a pas pu être modifiée : ${r.out.split('\n').at(-1)?.slice(0, 200) ?? 'erreur'}`] };
  return { ok: true, lines: ['✓ Odin démarre maintenant en administrateur à chaque ouverture de session (tâche « Odin », privilèges élevés), et il vient d\'être relancé.'] };
}
