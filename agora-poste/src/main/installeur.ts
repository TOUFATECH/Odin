// Agora sur l'ordinateur : télécharger un installateur, vérifier son empreinte, l'installer, le désinstaller.
//
// - L'empreinte SHA-256 annoncée par Odin est vérifiée AVANT toute installation : un fichier différent est effacé et
//   l'installation refusée (« Empreinte différente »), même si le serveur se trompe ou qu'on a modifié le fichier en route.
// - Linux : .AppImage copiée dans ~/Applications (exécutable) avec son raccourci dans le menu ; .deb par apt (pkexec
//   demande le mot de passe d'administrateur si le store ne tourne pas en administrateur).
// - Windows : installateur NSIS en silencieux (/S), .msi avec msiexec /qn ; désinstallation par la commande que
//   l'appli a laissée dans le registre (clé Uninstall).
// - Mac : .dmg monté, l'appli copiée dans /Applications, image démontée ; désinstallation : l'appli est mise à la corbeille.
// Rien de ce qui est téléchargé n'est exécuté avant d'avoir passé la vérification de l'empreinte.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export type Format = 'appimage' | 'deb' | 'exe' | 'msi' | 'dmg' | 'apk';
export interface Paquet { format: Format; version: string; sha256: string; taille: number; nomFichier: string; ident?: string; telecharger: string }
/** Ce que le store a installé sur ce poste (pour le désinstaller, l'ouvrir, et le dire à Odin). */
export interface Installe { element: string; nom: string; version: string; format: Format; chemin?: string; raccourci?: string; ident?: string; par: 'personne' | 'impose'; quand: number }

export class EmpreinteFausse extends Error {}
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
/** Un nom de fichier sûr à partir du nom de l'appli (« Bloc-notes » → « Bloc-notes »). */
export const nomSur = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.+-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || 'appli';

/** Lance un programme et attend sa fin (sans shell : les arguments ne sont jamais interprétés). */
export function lancer(cmd: string, args: string[], o: { delai?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    let out = '', err = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: o.env ?? process.env });
    const fin = setTimeout(() => p.kill('SIGKILL'), o.delai ?? 15 * 60_000);
    p.stdout.on('data', (d) => { out = (out + d).slice(-20_000); }); p.stderr.on('data', (d) => { err = (err + d).slice(-20_000); });
    p.on('error', (e) => { clearTimeout(fin); ok({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(fin); ok({ code: code ?? -1, out, err }); });
  });
}

/**
 * Télécharge `url` dans un fichier temporaire, en calculant son SHA-256 au fil de l'eau, et le compare à `attendu`.
 * `entetes` (jeton d'Odin) seulement pour l'adresse d'Odin ; `ouvrir` sert la requête épinglée vers Odin.
 */
export async function telecharger(url: string, attendu: string, o: { entetes?: Record<string, string>; progression?: (pc: number) => void; ouvrir?: (u: string) => Promise<NodeJS.ReadableStream & { headers?: Record<string, unknown>; statusCode?: number }>; dossier?: string } = {}): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(attendu)) throw new EmpreinteFausse('Odin n\'a pas donné d\'empreinte valable pour ce fichier : installation refusée.');
  const dossier = o.dossier ?? join(tmpdir(), 'agora-telechargements'); mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const tmp = join(dossier, `${randomBytes(6).toString('hex')}.part`);
  const flux = o.ouvrir ? await o.ouvrir(url) : await ouvrirAdresse(url, o.entetes ?? {});
  const status = (flux as { statusCode?: number }).statusCode ?? 200;
  if (status !== 200) { (flux as unknown as { resume?: () => void }).resume?.(); throw new Error(`le téléchargement a répondu ${status}`); }
  const total = Number((flux as { headers?: Record<string, unknown> }).headers?.['content-length'] ?? 0);
  const h = createHash('sha256'), f = createWriteStream(tmp, { mode: 0o600 }); let n = 0, dernier = -1;
  await new Promise<void>((ok, ko) => {
    flux.on('data', (c: Buffer) => { h.update(c); n += c.length; if (total && o.progression) { const pc = Math.floor((n / total) * 100); if (pc !== dernier) { dernier = pc; o.progression(pc); } } if (!f.write(c)) { flux.pause(); f.once('drain', () => flux.resume()); } });
    flux.on('end', () => f.end(ok)); flux.on('error', ko); f.on('error', ko);
  });
  const vu = h.digest('hex');
  if (vu !== attendu) { rmSync(tmp, { force: true }); throw new EmpreinteFausse(`Empreinte différente : installation refusée (attendue ${attendu.slice(0, 12)}…, reçue ${vu.slice(0, 12)}…). Le fichier a été effacé.`); }
  return tmp;
}
/** Une adresse https (ou http) avec les certificats du système, en suivant 5 redirections au plus. */
function ouvrirAdresse(url: string, entetes: Record<string, string>, reste = 5): Promise<NodeJS.ReadableStream & { headers?: Record<string, unknown>; statusCode?: number }> {
  return new Promise((ok, ko) => {
    const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return ko(new Error('adresse de téléchargement refusée'));
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { headers: { 'user-agent': 'Agora (store d\'Odin)', ...entetes }, timeout: 60_000 }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && reste > 0) {
        res.resume(); const suite = new URL(loc, u);
        if (u.protocol === 'https:' && suite.protocol !== 'https:') return ko(new Error('redirection vers une adresse non chiffrée refusée'));
        // Le jeton d'Odin ne part jamais vers un autre serveur.
        return ouvrirAdresse(suite.toString(), suite.host === u.host ? entetes : {}, reste - 1).then(ok, ko);
      }
      ok(res);
    });
    req.on('timeout', () => req.destroy(new Error('le serveur ne répond plus'))); req.on('error', ko); req.end();
  });
}

// ---------------------------------------------------------------- Installer / désinstaller

export interface Lieux { applis: string; raccourcis: string; plateforme: NodeJS.Platform; root: boolean }
export const lieuxParDefaut = (): Lieux => ({
  applis: process.env.AGORA_APPLIS || (process.platform === 'darwin' ? '/Applications' : join(homedir(), 'Applications')),
  raccourcis: join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications'),
  plateforme: process.platform, root: process.getuid?.() === 0,
});
/** Lance en administrateur sous Linux (pkexec demande le mot de passe ; rien à demander si le store est déjà administrateur). */
const admin = (l: Lieux, cmd: string, args: string[]) => (l.root ? lancer(cmd, args) : lancer('pkexec', [cmd, ...args]));
const raccourciLinux = (l: Lieux, element: string, nom: string, exe: string) => {
  mkdirSync(l.raccourcis, { recursive: true });
  const f = join(l.raccourcis, `agora-${nomSur(element)}.desktop`);
  writeFileSync(f, ['[Desktop Entry]', 'Type=Application', `Name=${nom.replace(/[\r\n]/g, ' ')}`, 'Comment=Installé par Agora, le store d\'Odin', `Exec="${exe.replace(/"/g, '')}" %U`, 'Icon=application-x-executable', 'Terminal=false', 'Categories=Utility;', `X-Agora-Element=${nomSur(element)}`, ''].join('\n'), { mode: 0o644 });
  void lancer('update-desktop-database', [l.raccourcis]).catch(() => undefined);
  return f;
};

/** Installe un fichier déjà vérifié. Rend ce qu'il faut garder pour le désinstaller ensuite. */
export async function installer(fichier: string, p: Paquet, e: { id: string; nom: string }, par: Installe['par'], l: Lieux = lieuxParDefaut()): Promise<Installe> {
  const base: Installe = { element: e.id, nom: e.nom, version: p.version, format: p.format, par, quand: Date.now() };
  try {
    if (p.format === 'appimage') {
      if (l.plateforme !== 'linux') throw new Error('une AppImage ne s\'installe que sous Linux');
      mkdirSync(l.applis, { recursive: true });
      const dest = join(l.applis, `${nomSur(e.nom)}.AppImage`), tmp = `${dest}.${randomBytes(3).toString('hex')}.tmp`;
      copyFileSync(fichier, tmp); chmodSync(tmp, 0o755); renameSync(tmp, dest); // remplace l'ancienne version d'un coup
      return { ...base, chemin: dest, raccourci: raccourciLinux(l, e.id, e.nom, dest) };
    }
    if (p.format === 'deb') {
      if (l.plateforme !== 'linux') throw new Error('un paquet .deb ne s\'installe que sous Linux');
      const ident = s((await lancer('dpkg-deb', ['-f', fichier, 'Package'])).out) || p.ident;
      if (!ident) throw new Error('ce fichier .deb est illisible');
      const r = await admin(l, 'apt-get', ['install', '-y', '--no-install-recommends', fichier]);
      if (r.code !== 0) { const r2 = await admin(l, 'dpkg', ['-i', fichier]); if (r2.code !== 0) throw new Error(r.code === 126 || r2.code === 126 ? 'mot de passe d\'administrateur refusé' : `apt n'a pas pu l'installer (${(r.err || r2.err).trim().split('\n').pop()?.slice(0, 160)})`); }
      return { ...base, ident };
    }
    if (p.format === 'exe') {
      if (l.plateforme !== 'win32') throw new Error('un installateur .exe ne s\'installe que sous Windows');
      const exe = `${fichier}.exe`; renameSync(fichier, exe);
      const r = await lancer(exe, ['/S']); if (r.code !== 0) throw new Error(`l'installateur a répondu ${r.code}`);
      return { ...base, ident: p.ident || e.nom };
    }
    if (p.format === 'msi') {
      if (l.plateforme !== 'win32') throw new Error('un installateur .msi ne s\'installe que sous Windows');
      const msi = `${fichier}.msi`; renameSync(fichier, msi);
      const r = await lancer('msiexec', ['/i', msi, '/qn', '/norestart']); if (r.code !== 0 && r.code !== 3010) throw new Error(`msiexec a répondu ${r.code}`);
      return { ...base, ident: p.ident || e.nom };
    }
    if (p.format === 'dmg') {
      if (l.plateforme !== 'darwin') throw new Error('une image .dmg ne s\'installe que sur Mac');
      const mp = join(tmpdir(), `agora-dmg-${randomBytes(4).toString('hex')}`); mkdirSync(mp, { recursive: true });
      const a = await lancer('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mp, fichier]); if (a.code !== 0) throw new Error(`l'image .dmg ne s'ouvre pas (${a.err.trim().slice(0, 120)})`);
      try {
        const app = readdirSync(mp).find((x) => x.endsWith('.app')); if (!app) throw new Error('pas d\'appli (.app) dans cette image');
        const dest = join(l.applis, app); if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
        const c = await lancer('ditto', [join(mp, app), dest]); if (c.code !== 0) throw new Error(`copie dans Applications refusée (${c.err.trim().slice(0, 120)})`);
        return { ...base, chemin: dest };
      } finally { await lancer('hdiutil', ['detach', mp, '-quiet']); }
    }
    throw new Error(`format ${p.format} : pas pour un ordinateur`);
  } finally { rmSync(fichier, { force: true }); rmSync(`${fichier}.exe`, { force: true }); rmSync(`${fichier}.msi`, { force: true }); }
}

/** La commande de désinstallation qu'une appli Windows a laissée dans le registre (clé Uninstall, utilisateur puis machine). */
async function desinstalleurWindows(nom: string): Promise<string | undefined> {
  const q = nom.replace(/'/g, "''");
  const ps = `$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';$a=Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '${q}*' } | Select-Object -First 1;if($a){ if($a.QuietUninstallString){$a.QuietUninstallString}else{$a.UninstallString} }`;
  const r = await lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]); return s(r.out) || undefined;
}
/** Découpe une ligne de commande Windows (« "C:\…\Uninstall X.exe" /currentuser ») en programme et arguments. */
export function decouperCommande(c: string): { cmd: string; args: string[] } {
  const m = /^\s*"([^"]+)"\s*(.*)$/.exec(c) ?? /^\s*(\S+)\s*(.*)$/.exec(c); if (!m) return { cmd: c, args: [] };
  return { cmd: m[1], args: m[2] ? (m[2].match(/"[^"]*"|\S+/g) ?? []).map((x) => x.replace(/^"|"$/g, '')) : [] };
}

export async function desinstaller(x: Installe, l: Lieux = lieuxParDefaut()): Promise<void> {
  if (x.format === 'appimage') { if (x.chemin) rmSync(x.chemin, { force: true }); if (x.raccourci) rmSync(x.raccourci, { force: true }); void lancer('update-desktop-database', [l.raccourcis]).catch(() => undefined); return; }
  if (x.format === 'deb') { if (!x.ident) throw new Error('nom du paquet inconnu'); const r = await admin(l, 'apt-get', ['remove', '-y', x.ident]); if (r.code !== 0) throw new Error(r.code === 126 ? 'mot de passe d\'administrateur refusé' : `apt n'a pas pu l'enlever (${r.err.trim().split('\n').pop()?.slice(0, 160)})`); return; }
  if (x.format === 'exe' || x.format === 'msi') {
    const c = await desinstalleurWindows(x.ident || x.nom); if (!c) throw new Error(`pas de désinstalleur trouvé pour « ${x.ident || x.nom} » dans le registre`);
    const msi = /msiexec/i.test(c) ? /\{[0-9A-F-]{36}\}/i.exec(c)?.[0] : undefined;
    const r = msi ? await lancer('msiexec', ['/x', msi, '/qn', '/norestart']) : (() => { const d = decouperCommande(c); return lancer(d.cmd, [...d.args.filter((a) => a.toUpperCase() !== '/S'), '/S']); })();
    const fin = await r; if (fin.code !== 0 && fin.code !== 3010) throw new Error(`le désinstalleur a répondu ${fin.code}`); return;
  }
  if (x.format === 'dmg') { if (x.chemin && existsSync(x.chemin)) { const r = await lancer('osascript', ['-e', `tell application "Finder" to delete POSIX file "${x.chemin.replace(/"/g, '')}"`]); if (r.code !== 0) rmSync(x.chemin, { recursive: true, force: true }); } return; }
  throw new Error(`format ${x.format} : pas pour un ordinateur`);
}
/** L'appli est-elle encore là ? (la personne a pu l'effacer à la main) */
export async function present(x: Installe): Promise<boolean> {
  if (x.format === 'appimage' || x.format === 'dmg') return Boolean(x.chemin && existsSync(x.chemin) && statSync(x.chemin));
  if (x.format === 'deb') return x.ident ? (await lancer('dpkg-query', ['-W', '-f=${Status}', x.ident])).out.includes('install ok installed') : false;
  if (x.format === 'exe' || x.format === 'msi') return Boolean(await desinstalleurWindows(x.ident || x.nom));
  return false;
}
/** Le format que ce système sait installer, par ordre de préférence. */
export const formatsDuSysteme = (pf: NodeJS.Platform = process.platform): Format[] => (pf === 'linux' ? ['appimage', 'deb'] : pf === 'win32' ? ['exe', 'msi'] : pf === 'darwin' ? ['dmg'] : []);
