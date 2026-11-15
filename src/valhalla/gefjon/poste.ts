// Héraclès · ce qu'il fait sur la machine d'Odin ET sur un autre poste du coffre des machines :
//   - carte de l'espace disque (les dossiers qui prennent le plus de place) ;
//   - programmes lancés au démarrage (services, démarrage de session, dossiers « Démarrage » de Windows), désactivés
//     et réactivés avec ton accord ;
//   - programmes installés, désinstallés avec ton accord (jamais un paquet essentiel du système) ;
//   - nettoyage (temporaires, corbeille, caches, paquets, journal) sur un poste Linux ou Mac par SSH, et les
//     fichiers temporaires d'un Windows par son partage de fichiers.
// Un Linux ou un Mac est lu par SSH (mêmes commandes qu'ici, rien d'installé) ; un Windows par son partage de fichiers
// (C$) : on y voit l'espace, les dossiers « Démarrage » et les temporaires, mais pas le registre ni la désinstallation.
// Ce que répondent les postes (noms de programmes, chemins) est une donnée, jamais un ordre.
import { lstatSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findMachine, type Machine } from '../../machines/access.ts';
import { cheminSmb, commandesSmb, dossierSmb, listerSmb, renommerSmb, type EntreeSmb } from '../../machines/smb.ts';
import { estIci, posteDe, type Poste } from '../postes.ts';
import type { ModCtx } from '../types.ts';

export type Cible = { genre: 'ici'; nom: string; poste: Poste } | { genre: 'ssh'; nom: string; poste: Poste } | { genre: 'smb'; nom: string; m: Machine };
/** Le poste demandé : la machine d'Odin, un Linux ou Mac (SSH), ou un Windows (partage de fichiers). */
export function cibleDe(ctx: ModCtx, qui: unknown): Cible {
  if (estIci(qui)) return { genre: 'ici', nom: 'cette machine', poste: posteDe(ctx, '') };
  const m = findMachine(ctx.home, String(qui).trim());
  if (m?.via === 'smb') return { genre: 'smb', nom: m.label, m };
  const poste = posteDe(ctx, qui); return { genre: 'ssh', nom: poste.nom, poste };
}
const sh = (c: Cible & { poste: Poste }, script: string, args: string[] = [], o: { sudo?: boolean; timeoutMs?: number } = {}) => c.poste.run('sh', ['-c', script, 'odin', ...args], { timeoutMs: o.timeoutMs ?? 120_000, ...(o.sudo ? { sudo: true } : {}) });
const winIci = (c: Cible) => c.genre === 'ici' && process.platform === 'win32';

// ---------------- Carte de l'espace ----------------
export interface Carte { racine: string; total: number; items: Array<{ chemin: string; octets: number }>; partiel: boolean; quand: number }
/** « du -k -d 1 » → les dossiers et leur taille (la ligne de la racine donne le total). Pur. */
export function lireDu(out: string, racine: string): { total: number; items: Array<{ chemin: string; octets: number }> } {
  let total = 0; const items: Array<{ chemin: string; octets: number }> = [], r = racine.replace(/\/+$/, '') || '/';
  for (const l of out.split('\n')) {
    const m = /^(\d+)\t(.+)$/.exec(l.trim()); if (!m) continue;
    const o = Number(m[1]) * 1024, p = m[2].replace(/\/+$/, '') || '/';
    if (p === r) total = o; else items.push({ chemin: p, octets: o });
  }
  if (!total) total = items.reduce((a, x) => a + x.octets, 0);
  return { total, items: items.sort((a, b) => b.octets - a.octets) };
}
function tailleLocale(p: string, budget: { n: number }): number {
  if (budget.n-- <= 0) return 0;
  let st; try { st = lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0; if (!st.isDirectory()) return st.isFile() ? st.size : 0;
  let n = 0; let l: string[] = []; try { l = readdirSync(p); } catch { return 0; }
  for (const e of l) n += tailleLocale(join(p, e), budget); return n;
}
export async function carte(c: Cible, dossier = ''): Promise<Carte> {
  const quand = Date.now();
  if (c.genre === 'smb') {
    // Windows : le disque C: entier par son partage administratif, ou le dossier demandé (« Users », « Users/Fatima »).
    const ou = dossier.replace(/^[A-Za-z]:[\\/]?/, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), pre = ou ? `${ou}/` : '';
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 180_000), parts = new Map<string, number>(); let total = 0, n = 0;
    try { for await (const f of listerSmb(c.m, 'C$', ou, { signal: ac.signal })) { const rel = f.chemin.startsWith(pre) ? f.chemin.slice(pre.length) : f.chemin, k = rel.includes('/') ? rel.split('/')[0] : '(fichiers)'; parts.set(k, (parts.get(k) ?? 0) + f.octets); total += f.octets; if (++n >= 300_000) { ac.abort(); break; } } }
    catch (e) { if (!ac.signal.aborted) throw e; } finally { clearTimeout(t); }
    return { racine: `C:\\${cheminSmb(ou)}`, total, items: [...parts].map(([k, o]) => ({ chemin: `C:\\${cheminSmb(`${pre}${k}`)}`, octets: o })).sort((a, b) => b.octets - a.octets).slice(0, 25), partiel: ac.signal.aborted, quand };
  }
  if (winIci(c) || (c.genre === 'ici' && !(await c.poste.has('du')))) {
    const r = dossier || homedir(), budget = { n: 400_000 }; let l: string[] = []; try { l = readdirSync(r); } catch { throw new Error(`dossier illisible : ${r}`); }
    const items = l.map((e) => ({ chemin: join(r, e), octets: tailleLocale(join(r, e), budget) })).sort((a, b) => b.octets - a.octets);
    return { racine: r, total: items.reduce((a, x) => a + x.octets, 0), items: items.slice(0, 25), partiel: budget.n <= 0, quand };
  }
  if (dossier && (!dossier.startsWith('/') || /[\0\n]/.test(dossier))) throw new Error('dossier : un chemin absolu (ex. /home, /var)');
  const r = await sh(c, 'd="${1:-$HOME}"; echo "@@$d"; du -x -k -d 1 -- "$d" 2>/dev/null', [dossier], { timeoutMs: 300_000 });
  const racine = /^@@(.*)$/m.exec(r.out)?.[1]?.trim() || dossier || '~', x = lireDu(r.out, racine);
  if (!x.items.length && r.code !== 0) throw new Error(`${c.nom} : ${(r.err || 'du a échoué').trim().split('\n').at(-1)}`);
  return { racine, total: x.total, items: x.items.slice(0, 25), partiel: false, quand };
}

// ---------------- Démarrage ----------------
export interface Lancement { id: string; nom: string; genre: 'service' | 'session' | 'dossier' | 'registre' | 'launchd'; actif: boolean; detail?: string; desactivable: boolean; chemin?: string;
  /** session : l'entrée existe aussi pour tout le système (/etc/xdg/autostart) */ systeme?: boolean;
  /** session : le fichier de la session est la désactivation posée par Odin (Hidden=true) */ odin?: boolean }
const SCRIPT_DEMARRAGE = [
  'if command -v systemctl >/dev/null 2>&1; then echo "@@systemd"; systemctl list-unit-files --type=service --state=enabled --no-legend --no-pager 2>/dev/null; fi',
  'for f in "$HOME"/.config/autostart/*.desktop "$HOME"/.config/autostart/*.odin-desactive /etc/xdg/autostart/*.desktop; do [ -f "$f" ] || continue; echo "@@desktop $f"; grep -E "^(Name|Exec|Hidden|X-GNOME-Autostart-enabled|X-Odin-Desactive)=" "$f" 2>/dev/null; done',
  'for f in "$HOME"/Library/LaunchAgents/*.plist "$HOME"/Library/LaunchAgents/*.odin-desactive /Library/LaunchAgents/*.plist /Library/LaunchDaemons/*.plist; do [ -f "$f" ] && echo "@@plist $f"; done',
  'echo "@@home $HOME"',
].join('\n');
/** La sortie du script de démarrage (Linux, Mac) → les programmes lancés au démarrage. Pur. */
export function lireDemarrage(out: string): Lancement[] {
  const l: Lancement[] = []; let bloc = '', fichier = '', champs: Record<string, string> = {}, home = /^@@home (.+)$/m.exec(out)?.[1]?.trim() ?? '';
  const finDesktop = () => {
    if (!fichier) return;
    const base = fichier.split('/').pop()!.replace(/\.odin-desactive$/, ''), off = fichier.endsWith('.odin-desactive') || /^true$/i.test(champs.Hidden ?? '') || /^false$/i.test(champs['X-GNOME-Autostart-enabled'] ?? '');
    const systeme = fichier.startsWith('/etc/xdg/'), odin = /^true$/i.test(champs['X-Odin-Desactive'] ?? ''), deja = l.find((x) => x.genre === 'session' && x.id === `session:${base}`);
    // Le fichier de la session (lu d'abord) l'emporte sur celui du système : c'est là qu'Odin pose sa désactivation.
    if (deja) { if (systeme) { deja.systeme = true; if (!deja.detail) deja.detail = (champs.Exec ?? '').slice(0, 160); if (deja.odin && champs.Name) deja.nom = champs.Name; } }
    else l.push({ id: `session:${base}`, nom: champs.Name || base.replace(/\.desktop$/, ''), genre: 'session', actif: !off, detail: (champs.Exec ?? '').slice(0, 160), desactivable: true, chemin: fichier, ...(systeme ? { systeme } : {}), ...(odin ? { odin } : {}) });
    fichier = ''; champs = {};
  };
  for (const ligne of out.split('\n')) {
    const t = ligne.trim(); if (!t) continue;
    if (t.startsWith('@@')) { finDesktop(); bloc = t.slice(2).split(' ')[0]; if (bloc === 'desktop') fichier = t.slice(10).trim(); else if (bloc === 'plist') { const f = t.slice(8).trim(), base = f.split('/').pop()!.replace(/\.odin-desactive$/, ''), perso = Boolean(home) && f.startsWith(`${home}/Library/LaunchAgents/`); l.push({ id: `launchd:${base}`, nom: base.replace(/\.plist$/, ''), genre: 'launchd', actif: !f.endsWith('.odin-desactive'), detail: perso ? 'ton compte' : 'tout le système (à changer à la main)', desactivable: perso, chemin: f }); } continue; }
    if (bloc === 'systemd') { const m = /^([\w@.:-]+\.service)\s+(\S+)/.exec(t); if (m && m[2] === 'enabled') l.push({ id: `service:${m[1]}`, nom: m[1].replace(/\.service$/, ''), genre: 'service', actif: true, detail: 'service du système', desactivable: true }); }
    else if (bloc === 'desktop') { const m = /^([\w-]+)=(.*)$/.exec(t); if (m) champs[m[1]] = m[2]; }
  }
  finDesktop();
  return l;
}
/** « reg query …\Run » → les programmes lancés à l'ouverture de session (Windows). Pur. */
export function lireRun(out: string, ou: string): Lancement[] {
  const l: Lancement[] = [];
  for (const ligne of out.split(/\r?\n/)) { const m = /^\s{2,}(.+?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}(.*)$/.exec(ligne); if (m) l.push({ id: `registre:${ou}:${m[1]}`, nom: m[1], genre: 'registre', actif: true, detail: `${m[2].slice(0, 160)} (registre ${ou})`, desactivable: false }); }
  return l;
}
const DEMARRAGE_WIN = 'ProgramData/Microsoft/Windows/Start Menu/Programs/StartUp';
const demarrageUtilisateur = (u: string) => `Users/${u}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`;
function dossierDemarrage(ent: EntreeSmb[] | Array<{ nom: string; dossier: boolean }>, chemin: string, qui: string): Lancement[] {
  return ent.filter((e) => !e.dossier && !/^desktop\.ini$/i.test(e.nom)).map((e) => ({ id: `dossier:${chemin}/${e.nom.replace(/\.odin-desactive$/, '')}`, nom: e.nom.replace(/\.odin-desactive$/, '').replace(/\.lnk$/i, ''), genre: 'dossier' as const, actif: !e.nom.endsWith('.odin-desactive'), detail: `dossier Démarrage (${qui})`, desactivable: true, chemin: `${chemin}/${e.nom}` }));
}
export async function demarrage(c: Cible): Promise<Lancement[]> {
  if (c.genre === 'smb') {
    const out = dossierDemarrage(await dossierSmb(c.m, 'C$', DEMARRAGE_WIN), DEMARRAGE_WIN, 'tous les comptes');
    for (const u of (await dossierSmb(c.m, 'C$', 'Users')).filter((e) => e.dossier && !/^(Public|Default|Default User|All Users)$/i.test(e.nom))) out.push(...dossierDemarrage(await dossierSmb(c.m, 'C$', demarrageUtilisateur(u.nom)).catch(() => []), demarrageUtilisateur(u.nom), u.nom));
    return out;
  }
  if (winIci(c)) {
    const out: Lancement[] = [];
    for (const [cle, ou] of [['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'ton compte'], ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'tout le PC']]) { const r = await c.poste.run('reg', ['query', cle], { timeoutMs: 20_000 }).catch(() => ({ code: 1, out: '', err: '' })); if (r.code === 0) out.push(...lireRun(r.out, ou)); }
    for (const [d, qui] of [[join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), 'ton compte'], [join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp'), 'tous les comptes']]) {
      let n: string[] = []; try { n = readdirSync(d); } catch { continue; }
      out.push(...dossierDemarrage(n.map((nom) => ({ nom, dossier: false })), d.replace(/\\/g, '/'), qui));
    }
    return out;
  }
  const r = await sh(c, SCRIPT_DEMARRAGE); return lireDemarrage(r.out);
}
/** Désactive (ou réactive) un programme du démarrage, retrouvé dans la liste du poste (jamais un nom pris tel quel). */
export async function basculer(c: Cible, id: string, actif: boolean): Promise<Lancement> {
  const x = (await demarrage(c)).find((l) => l.id === id); if (!x) throw new Error('ce programme n\'est plus dans la liste du démarrage');
  if (!x.desactivable) throw new Error(`${x.nom} se change à la main (${x.detail ?? 'réservé au système'})`);
  if (x.actif === actif) return x;
  const off = '.odin-desactive';
  if (x.genre === 'dossier') {
    const de = x.chemin!, vers = actif ? de.replace(/\.odin-desactive$/, '') : `${de}${off}`;
    if (c.genre === 'smb') await renommerSmb(c.m, 'C$', de, vers); else renameSync(de, vers);
  } else if (c.genre === 'smb') throw new Error('sur un Windows, seuls les dossiers « Démarrage » se changent par le partage de fichiers');
  else if (x.genre === 'service') {
    const unit = x.id.slice('service:'.length); if (!/^[\w@.:-]+\.service$/.test(unit)) throw new Error('nom de service invalide');
    const r = await c.poste.run('systemctl', [actif ? 'enable' : 'disable', '--now', unit], { sudo: true, timeoutMs: 60_000 }); if (r.code !== 0) throw new Error(`${c.nom} : ${(r.err || r.out).trim().split('\n').at(-1) ?? 'refusé'}`);
  } else if (x.genre === 'session') {
    const f = x.chemin!, base = x.id.slice('session:'.length);
    if (!/^[\w@.+-]+\.desktop$/.test(base)) throw new Error('nom de lancement invalide');
    // Entrée du système : un fichier à son nom dans la session (Hidden=true) la cache ; entrée de la session : renommée.
    const script = actif
      ? (x.odin ? 'rm -f -- "$HOME/.config/autostart/$1"' : 'mv -- "$HOME/.config/autostart/$1.odin-desactive" "$HOME/.config/autostart/$1"')
      : (f.startsWith('/etc/xdg/') ? 'mkdir -p "$HOME/.config/autostart" && printf "[Desktop Entry]\\nHidden=true\\nX-Odin-Desactive=true\\n" > "$HOME/.config/autostart/$1"' : 'mv -- "$HOME/.config/autostart/$1" "$HOME/.config/autostart/$1.odin-desactive"');
    const r = await sh(c as Cible & { poste: Poste }, script, [base]); if (r.code !== 0) throw new Error(`${c.nom} : ${(r.err || 'refusé').trim().split('\n').at(-1)}`);
  } else if (x.genre === 'launchd') {
    const base = x.id.slice('launchd:'.length); if (!/^[\w@.+-]+\.plist$/.test(base)) throw new Error('nom invalide');
    const r = await sh(c as Cible & { poste: Poste }, actif ? 'd="$HOME/Library/LaunchAgents"; mv -- "$d/$1.odin-desactive" "$d/$1" && launchctl load "$d/$1"' : 'd="$HOME/Library/LaunchAgents"; launchctl unload "$d/$1" 2>/dev/null; mv -- "$d/$1" "$d/$1.odin-desactive"', [base]);
    if (r.code !== 0) throw new Error(`${c.nom} : ${(r.err || 'refusé').trim().split('\n').at(-1)}`);
  } else throw new Error('ce lancement se change à la main');
  return { ...x, actif };
}

// ---------------- Programmes installés ----------------
export interface Programme { id: string; nom: string; version?: string; octets?: number; source: 'apt' | 'rpm' | 'pacman' | 'flatpak' | 'snap' | 'mac' | 'windows' | 'dossier'; desinstallable: boolean; pourquoi?: string; chemin?: string }
/** Jamais désinstallés par Héraclès : ce sans quoi le poste ne démarre plus, ne se met plus à jour ou ne se joint plus. */
export const PROTEGES = /^(linux-(image|headers|modules|firmware)|systemd|libc6?|libc-bin|glibc|dpkg|apt|rpm|dnf|yum|pacman|bash|dash|coreutils|util-linux|sudo|openssh-(server|client)|ssh|grub|shim|base-files|base-passwd|init|login|passwd|mount|kernel|e2fsprogs|network-manager|netplan|ifupdown|iproute2|lxc|qemu|odin|nodejs|polkit|dbus|udev|bootloader)/i;
const SCRIPT_PROGRAMMES = [
  'if command -v dpkg-query >/dev/null 2>&1; then echo "@@apt"; dpkg-query -W -f=\'${Package}\\t${Version}\\t${Installed-Size}\\t${Priority}\\n\' 2>/dev/null;',
  'elif command -v rpm >/dev/null 2>&1; then echo "@@rpm"; rpm -qa --queryformat \'%{NAME}\\t%{VERSION}\\t%{SIZE}\\n\' 2>/dev/null;',
  'elif command -v pacman >/dev/null 2>&1; then echo "@@pacman"; pacman -Qe 2>/dev/null; fi',
  'if command -v flatpak >/dev/null 2>&1; then echo "@@flatpak"; flatpak list --app --columns=application,version 2>/dev/null; fi',
  'if command -v snap >/dev/null 2>&1; then echo "@@snap"; snap list 2>/dev/null; fi',
  'if [ -d /Applications ] && [ "$(uname -s)" = Darwin ]; then echo "@@mac"; for a in /Applications/*.app; do [ -d "$a" ] && printf "%s\\t%s\\n" "$(du -sk "$a" 2>/dev/null | cut -f1)" "$a"; done; fi',
].join('\n');
/** La sortie du script des programmes (Linux, Mac) → la liste. Pur. */
export function lireProgrammes(out: string): Programme[] {
  const l: Programme[] = []; let bloc = '';
  for (const ligne of out.split('\n')) {
    const t = ligne.replace(/\r$/, ''); if (!t.trim()) continue;
    if (t.startsWith('@@')) { bloc = t.slice(2).trim(); continue; }
    const c = t.split('\t');
    if (bloc === 'apt' && c.length >= 3) { const essentiel = /^(required|important)$/.test(c[3] ?? '') || PROTEGES.test(c[0]); l.push({ id: `apt:${c[0]}`, nom: c[0], version: c[1], octets: Number(c[2]) * 1024 || undefined, source: 'apt', desinstallable: !essentiel, ...(essentiel ? { pourquoi: 'essentiel au système' } : {}) }); }
    else if (bloc === 'rpm' && c.length >= 2) { const p = PROTEGES.test(c[0]); l.push({ id: `rpm:${c[0]}`, nom: c[0], version: c[1], octets: Number(c[2]) || undefined, source: 'rpm', desinstallable: !p, ...(p ? { pourquoi: 'essentiel au système' } : {}) }); }
    else if (bloc === 'pacman') { const [n, v] = t.trim().split(/\s+/); if (n) { const p = PROTEGES.test(n); l.push({ id: `pacman:${n}`, nom: n, version: v, source: 'pacman', desinstallable: !p, ...(p ? { pourquoi: 'essentiel au système' } : {}) }); } }
    else if (bloc === 'flatpak') { const [a, v] = t.split('\t'); if (a && /^[\w.-]+$/.test(a.trim())) l.push({ id: `flatpak:${a.trim()}`, nom: a.trim(), version: v?.trim(), source: 'flatpak', desinstallable: true }); }
    else if (bloc === 'snap') { const [n, v] = t.trim().split(/\s+/); if (n && n !== 'Name' && /^[a-z0-9-]+$/.test(n)) { const p = /^(core\d*|snapd|bare|gnome-[\d-]+|gtk-common-themes)$/.test(n); l.push({ id: `snap:${n}`, nom: n, version: v, source: 'snap', desinstallable: !p, ...(p ? { pourquoi: 'socle des autres snaps' } : {}) }); } }
    else if (bloc === 'mac' && c.length >= 2) { const p = c[1].trim(); if (/^\/Applications\/[^/]+\.app$/.test(p)) { const sys = /^\/Applications\/(Safari|App Store|System Settings|Utilities)\.app$/.test(p); l.push({ id: `mac:${p}`, nom: p.split('/').pop()!.replace(/\.app$/, ''), octets: Number(c[0]) * 1024 || undefined, source: 'mac', desinstallable: !sys, chemin: p, ...(sys ? { pourquoi: 'fourni avec macOS' } : {}) }); } }
  }
  return l;
}
/** « reg query …\Uninstall /s » → les programmes installés (Windows). Pur. */
export function lireDesinstall(out: string): Programme[] {
  const l: Programme[] = [], vus = new Set<string>(); let v: Record<string, string> = {};
  const fin = () => { const n = v.DisplayName?.trim(); if (n && v.SystemComponent !== '0x1' && !v.ParentKeyName && !vus.has(n.toLowerCase())) { vus.add(n.toLowerCase()); l.push({ id: `windows:${n}`, nom: n, version: v.DisplayVersion, octets: v.EstimatedSize ? parseInt(v.EstimatedSize, 16) * 1024 || undefined : undefined, source: 'windows', desinstallable: Boolean(v.UninstallString) }); } v = {}; };
  for (const ligne of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(ligne)) { fin(); continue; }
    const m = /^\s{2,}(\w+)\s{2,}REG_\w+\s{2,}(.*)$/.exec(ligne); if (m) v[m[1]] = m[2].trim();
  }
  fin(); return l;
}
export async function programmes(c: Cible): Promise<{ liste: Programme[]; note?: string }> {
  if (c.genre === 'smb') {
    const l: Programme[] = [];
    for (const d of ['Program Files', 'Program Files (x86)']) for (const e of (await dossierSmb(c.m, 'C$', d).catch(() => [])).filter((x) => x.dossier && !/^(Common Files|Windows \w+|WindowsApps|Internet Explorer|Microsoft\.NET|ModifiableWindowsApps)$/i.test(x.nom))) l.push({ id: `dossier:${d}/${e.nom}`, nom: e.nom, source: 'dossier', desinstallable: false, pourquoi: 'par le partage de fichiers', chemin: `C:\\${d}\\${e.nom}` });
    return { liste: l, note: 'Par le partage de fichiers, Odin voit les dossiers des programmes mais pas le registre : la désinstallation se fait sur le PC (Paramètres → Applications).' };
  }
  if (winIci(c)) {
    let out = '';
    for (const k of ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) { const r = await c.poste.run('reg', ['query', k, '/s'], { timeoutMs: 60_000 }).catch(() => ({ code: 1, out: '', err: '' })); if (r.code === 0) out += `${r.out}\n`; }
    const winget = await c.poste.has('winget');
    return { liste: lireDesinstall(out).map((p) => (winget ? p : { ...p, desinstallable: false, pourquoi: 'winget absent' })), ...(winget ? {} : { note: 'Sans winget, la désinstallation se fait dans Paramètres → Applications.' }) };
  }
  const r = await sh(c, SCRIPT_PROGRAMMES, [], { timeoutMs: 120_000 }); return { liste: lireProgrammes(r.out) };
}
/** La commande qui désinstalle un programme (retrouvé dans la liste du poste). Pur. */
export function commandeDesinstaller(p: Programme, outils: { dnf?: boolean } = {}): { cmd: string; args: string[]; sudo: boolean } {
  if (!p.desinstallable) throw new Error(`${p.nom} ne se désinstalle pas ici${p.pourquoi ? ` (${p.pourquoi})` : ''}`);
  const nom = p.id.slice(p.id.indexOf(':') + 1);
  if (['apt', 'rpm', 'pacman', 'snap'].includes(p.source) && (!/^[A-Za-z0-9][A-Za-z0-9+._:@-]{0,120}$/.test(nom) || PROTEGES.test(nom))) throw new Error(`${nom} : nom refusé ou paquet essentiel`);
  switch (p.source) {
    case 'apt': return { cmd: 'apt-get', args: ['remove', '-y', '--', nom], sudo: true };
    case 'rpm': return { cmd: outils.dnf ? 'dnf' : 'yum', args: ['remove', '-y', nom], sudo: true };
    case 'pacman': return { cmd: 'pacman', args: ['-R', '--noconfirm', nom], sudo: true };
    case 'snap': return { cmd: 'snap', args: ['remove', nom], sudo: true };
    case 'flatpak': if (!/^[\w.-]+$/.test(nom)) throw new Error('nom refusé'); return { cmd: 'flatpak', args: ['uninstall', '-y', '--noninteractive', nom], sudo: true };
    case 'mac': if (!/^\/Applications\/[^/]+\.app$/.test(nom)) throw new Error('chemin refusé'); return { cmd: 'sh', args: ['-c', 'mv -- "$1" "$HOME/.Trash/"', 'odin', nom], sudo: false };
    case 'windows': return { cmd: 'winget', args: ['uninstall', '--name', nom, '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity'], sudo: false };
    default: throw new Error('ce programme se désinstalle sur le poste lui-même');
  }
}
export async function desinstaller(c: Cible, id: string): Promise<Programme> {
  if (c.genre === 'smb') throw new Error('sur un Windows joint par son partage de fichiers, la désinstallation se fait sur le PC (Paramètres → Applications)');
  const p = (await programmes(c)).liste.find((x) => x.id === id); if (!p) throw new Error('ce programme n\'est pas (ou plus) installé');
  const k = commandeDesinstaller(p, { dnf: p.source === 'rpm' && await c.poste.has('dnf') });
  const r = await c.poste.run(k.cmd, k.args, { sudo: k.sudo, timeoutMs: 900_000 });
  if (r.code !== 0) throw new Error(`${c.nom} : ${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 200) ?? 'refusé'}`);
  return p;
}

// ---------------- Nettoyage d'un autre poste ----------------
export const CATEGORIES_DISTANTES = ['temporaires', 'corbeille', 'caches', 'paquets', 'journal'] as const;
/**
 * Le script qui mesure (ou vide) une catégorie sur un Linux ou un Mac : les mêmes règles qu'ici (temporaires de plus
 * de 7 jours sauf ce qu'un programme en marche utilise, caches de plus de 3 jours sauf modèles d'IA…). Pur.
 */
export function scriptNettoyage(cat: string, vider: boolean): { script: string; sudo: boolean } {
  const agir = (find: string) => (vider ? `${find} -exec rm -rf -- {} + 2>/dev/null; true` : `${find} -exec du -sk {} + 2>/dev/null | awk '{s+=$1} END {print s+0}'`);
  switch (cat) {
    case 'temporaires': return { sudo: true, script: agir('find /tmp /var/tmp -xdev -mindepth 1 -maxdepth 1 -mtime +7 ! -name ".*" ! -name "systemd-private-*" ! -name "snap-private-tmp" ! -name "tmux-*" ! -name "ssh-*" ! -name "pulse-*" ! -name "dbus-*" ! -name "gpg-*" ! -name "odin*"') };
    case 'corbeille': return { sudo: false, script: agir('find "$HOME/.local/share/Trash/files" "$HOME/.local/share/Trash/info" "$HOME/.Trash" -mindepth 1 -maxdepth 1') };
    case 'caches': return { sudo: false, script: agir('find "$HOME/.cache" "$HOME/Library/Caches" -mindepth 1 -maxdepth 1 -mtime +3 ! -name "huggingface" ! -name "whisper" ! -name "torch" ! -name "odin" ! -name "ollama" ! -name "lm-studio" ! -name "piper" ! -name "ms-playwright" ! -name "fontconfig"') };
    case 'paquets': return { sudo: true, script: vider ? 'if command -v apt-get >/dev/null; then apt-get clean; elif command -v dnf >/dev/null; then dnf clean packages; elif command -v pacman >/dev/null; then pacman -Sc --noconfirm; fi; true' : 'du -sk /var/cache/apt/archives /var/cache/dnf /var/cache/pacman/pkg 2>/dev/null | awk \'{s+=$1} END {print s+0}\'' };
    case 'journal': return { sudo: true, script: vider ? 'command -v journalctl >/dev/null && journalctl --vacuum-time=2weeks; true' : 'command -v journalctl >/dev/null && journalctl --disk-usage 2>/dev/null | awk \'{for(i=1;i<=NF;i++) if ($i ~ /^[0-9.]+[KMGT]$/) { v=$i; u=substr(v,length(v)); n=substr(v,1,length(v)-1); m=(u=="K"?1:u=="M"?1024:u=="G"?1048576:1073741824); print int(n*m); exit } } END {}\' || echo 0' };
    default: throw new Error(`catégorie inconnue sur un autre poste (${CATEGORIES_DISTANTES.join(', ')})`);
  }
}
const TEMP_WIN = ['Windows/Temp'];
/** Les éléments de plus de 7 jours des dossiers temporaires d'un Windows (par le partage de fichiers). */
async function tempsWindows(m: Machine, now: number): Promise<Array<{ chemin: string; dossier: boolean; octets: number }>> {
  const dossiers = [...TEMP_WIN, ...(await dossierSmb(m, 'C$', 'Users')).filter((e) => e.dossier && !/^(Public|Default|Default User|All Users)$/i.test(e.nom)).map((u) => `Users/${u.nom}/AppData/Local/Temp`)], out: Array<{ chemin: string; dossier: boolean; octets: number }> = [];
  for (const d of dossiers) for (const e of await dossierSmb(m, 'C$', d).catch(() => [])) if (e.quand && now - e.quand > 7 * 864e5) out.push({ chemin: `${d}/${e.nom}`, dossier: e.dossier, octets: e.octets });
  return out;
}
/** Mesure (ou vide) des catégories sur un autre poste ; rend les octets par catégorie (mesure) ou libérés (vidage). */
export async function nettoyageDistant(c: Cible, cats: string[], vider: boolean, now = Date.now()): Promise<Array<{ categorie: string; octets: number; note?: string }>> {
  const out: Array<{ categorie: string; octets: number; note?: string }> = [];
  if (c.genre === 'smb') {
    for (const k of cats) {
      if (k !== 'temporaires') { out.push({ categorie: k, octets: 0, note: 'pas par le partage de fichiers (seulement les temporaires d\'un Windows)' }); continue; }
      const l = await tempsWindows(c.m, now), octets = l.reduce((a, x) => a + x.octets, 0);
      if (vider && l.length) { const r = await commandesSmb(c.m, 'C$', l.map((x) => `${x.dossier ? 'deltree' : 'del'} "${cheminSmb(x.chemin)}"`)); const refus = (r.match(/NT_STATUS_(SHARING_VIOLATION|ACCESS_DENIED)/g) ?? []).length; out.push({ categorie: k, octets, ...(refus ? { note: `${refus} élément(s) en cours d'utilisation, laissés` } : {}) }); }
      else out.push({ categorie: k, octets });
    }
    return out;
  }
  if (c.genre === 'ici') throw new Error('sur cette machine, Héraclès nettoie lui-même (pas par SSH)');
  for (const k of cats) {
    let avant = 0;
    { const m = scriptNettoyage(k, false), r = await sh(c, m.script, [], { sudo: m.sudo, timeoutMs: 300_000 }); avant = (Number(r.out.trim().split('\n').at(-1)) || 0) * 1024; }
    if (vider) { const m = scriptNettoyage(k, true), r = await sh(c, m.script, [], { sudo: m.sudo, timeoutMs: 600_000 }); out.push({ categorie: k, octets: avant, ...(r.code !== 0 ? { note: (r.err || 'refusé').trim().split('\n').at(-1) } : {}) }); }
    else out.push({ categorie: k, octets: avant });
  }
  return out;
}
