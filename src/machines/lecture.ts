// Lire les fichiers d'un autre poste, sans rien y installer : par le partage de fichiers de Windows (SMB : PC et
// serveurs Windows, NAS, Mac ou Linux qui partagent des dossiers) ou par SSH (Linux, Mac). Les fichiers arrivent
// un par un, en mémoire, chez Odin ; rien n'est écrit sur le disque, rien n'est modifié sur le poste.
// Sert à l'antivirus (« analyser un autre PC ») et à toute appli qui doit lire un poste distant.
import { connect } from 'node:net';
import { lireTar, type EntreeTar } from '../files/tar-flux.ts';
import { runOnMachine, streamOnMachine, type Machine } from './access.ts';
import { lireFichiersSmb, listerSmb, partagesSmb, renommerSmb, type BilanListe, type FichierSmb, type Partage } from './smb.ts';

export type Via = 'ssh' | 'smb';
export type Systeme = 'windows' | 'linux' | 'mac' | 'inconnu';
export interface FichierLu {
  /** le chemin tel qu'on le montre et tel que les règles le lisent : « C:/Users/Fatima/a.exe », « /home/fatima/a.sh », « //nas/Photos/a.jpg » */
  chemin: string;
  /** pour agir ensuite sur ce fichier : le partage (SMB) et le chemin dedans, ou le chemin absolu (SSH) */
  partage?: string; relatif: string;
  octets: number; data?: Buffer; tete?: Buffer; sha256?: string;
}
export interface BilanLecture { via: Via; systeme: Systeme; racines: string[]; lus: number; octets: number; /** fichiers trop gros, non lus */ gros: number; /** fichiers verrouillés, disparus ou refusés */ illisibles: number; /** dossiers que le poste refuse d'ouvrir */ dossiersRefuses: number; notes: string[]; arrete: boolean }
export interface OptionsLecture {
  /** « rapide » : là où les virus se mettent (profils, téléchargements, temporaires, démarrage) ; « tout » : tous les disques */
  profil: 'rapide' | 'tout';
  /** un seul endroit : « C: », « D:\\Factures », « Photos » (un partage), « Photos/2024 », ou « /home/fatima » (SSH) */
  ou?: string;
  /** au plus ce nombre de fichiers (400 000) */
  max?: number;
  /** fichier lu en entier jusqu'à cette taille (48 Mo) ; au-delà, seuls les programmes et archives sont lus (début + empreinte), jusqu'à `maxGros` (1 Go) */
  maxEach?: number; maxGros?: number;
  signal?: AbortSignal;
  surFichier(f: FichierLu): Promise<void>;
  /** où on en est, en une phrase */
  surEtape?(texte: string): void;
}
/** Fichiers qui peuvent porter un programme : lus même gros (début + empreinte complète). Les gros films, images de disque de sauvegarde et bases ne le sont pas. */
const EXT_GROS = ['exe', 'dll', 'sys', 'scr', 'com', 'msi', 'msp', 'cpl', 'ocx', 'drv', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'jar', 'apk', 'ipa', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'run', 'bin', 'elf', 'so', 'dylib', 'sh', 'py', 'zip', '7z', 'rar', 'cab', 'iso', 'img', 'docm', 'xlsm', 'pptm'];
export const GROS_UTILES = new RegExp(`\\.(${EXT_GROS.join('|')})$`, 'i');
/** Un gros fichier vaut-il d'être lu ? Un programme, une archive, ou un fichier sans extension (souvent un programme sous Linux et Mac). Pur. */
export const grosUtile = (chemin: string) => GROS_UTILES.test(chemin) || !/\.[A-Za-z0-9]{1,8}$/.test(chemin.split(/[\\/]/).pop() ?? '');
const port = (host: string, p: number, ms = 2500) => new Promise<boolean>((res) => { const s = connect({ host: host.replace(/^\[|\]$/g, ''), port: p }); const fin = (ok: boolean) => { s.destroy(); res(ok); }; s.setTimeout(ms, () => fin(false)); s.once('connect', () => fin(true)); s.once('error', () => fin(false)); });

/** Par où lire ce poste : ce que tu as choisi, sinon le partage de fichiers s'il répond (Windows, NAS), sinon SSH. */
export async function quelAcces(home: string, m: Machine): Promise<Via | undefined> {
  if (m.via) return m.via;
  const [smb, ssh] = await Promise.all([port(m.host, m.smbPort ?? 445), port(m.host, m.port || 22)]);
  // Un poste qui a les deux (un Linux avec Samba, un NAS) : SSH lit tout le disque, le partage seulement ce qui est partagé.
  // Un Windows n'a d'habitude que le partage ; s'il a aussi SSH, le partage administratif reste le plus sûr.
  if (smb && ssh) return (await systemeSsh(home, m).catch(() => 'inconnu')) === 'windows' ? 'smb' : 'ssh';
  return smb ? 'smb' : ssh ? 'ssh' : undefined;
}
/** Le système d'un poste joint par SSH (« uname » ; un Windows répond autre chose). */
export async function systemeSsh(home: string, m: Machine): Promise<Systeme> {
  const r = await runOnMachine(home, m, 'uname -s', { timeoutMs: 20_000 });
  if (r.code === 0 && /Linux/i.test(r.out)) return 'linux'; if (r.code === 0 && /Darwin/i.test(r.out)) return 'mac';
  if (/not recognized|n'est pas reconnu|Microsoft|Windows/i.test(r.out)) return 'windows';
  if (r.code !== 0 && /Permission denied|Connection refused|timed out|No route|unreachable|Host key/i.test(r.out)) throw new Error(/Permission denied/i.test(r.out) ? 'utilisateur ou mot de passe refusé par le poste (SSH)' : /Connection refused/i.test(r.out) ? 'SSH est fermé sur ce poste' : /Host key/i.test(r.out) ? 'l\'empreinte SSH du poste a changé : vérifie que c\'est bien lui' : 'le poste ne répond pas (éteint, en veille, ou sur un autre réseau)');
  return 'inconnu';
}

/** « C: », « D:\\Factures », « C$/Users », « Photos/2024 » → le partage et le dossier. Pur. */
export function lireOu(ou: string): { partage: string; dossier: string } {
  const x = ou.trim().replace(/^\\\\[^\\/]+[\\/]/, '').replace(/^\/\/[^/]+\//, '');
  const d = /^([A-Za-z])(?::|\$)(?:[\\/]+(.*))?$/.exec(x);
  if (d) return { partage: `${d[1].toUpperCase()}$`, dossier: (d[2] ?? '').replace(/[\\/]+$/, '').replace(/\\/g, '/') };
  const [partage, ...reste] = x.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/');
  return { partage, dossier: reste.join('/') };
}
/** Le chemin montré pour un fichier d'un partage : « C:/Users/a.txt » pour un disque entier (C$), sinon « //poste/Partage/a.txt ». Pur. */
export function cheminMontre(host: string, partage: string, relatif: string): string {
  const d = /^([A-Za-z])\$$/.exec(partage);
  return d ? `${d[1].toUpperCase()}:/${relatif}` : `//${host}/${partage}/${relatif}`;
}
/** Les endroits lus sur un Windows en analyse rapide (dans chaque disque). */
const RAPIDE_WIN = ['Users', 'ProgramData', 'Windows/Temp', 'Windows/Tasks', 'Windows/System32/Tasks', 'Windows/System32/drivers/etc'];
/** Jamais lus : mémoire d'échange et veille (verrouillés, énormes), points de restauration. */
const JAMAIS_WIN = /^(pagefile\.sys|hiberfil\.sys|swapfile\.sys|DumpStack\.log(\.tmp)?|System Volume Information\/)/i;
/** Ce qui est lu sur un partage : la liste (partage, dossier) selon le profil et les partages visibles. Pur. */
export function racinesSmb(partages: Partage[], profil: 'rapide' | 'tout', ou?: string): Array<{ partage: string; dossier: string }> {
  if (ou) return [lireOu(ou)];
  const disques = partages.filter((p) => p.disque), autres = partages.filter((p) => !p.disque && !/^ADMIN\$$/i.test(p.nom) && !/\$$/.test(p.nom));
  const out: Array<{ partage: string; dossier: string }> = [];
  for (const d of disques) { if (profil === 'tout') out.push({ partage: d.nom, dossier: '' }); else for (const r of RAPIDE_WIN) out.push({ partage: d.nom, dossier: r }); }
  // Sans droit d'administrateur, on ne voit que les dossiers partagés : on les lit en entier.
  if (!disques.length || profil === 'tout') for (const a of autres) out.push({ partage: a.nom, dossier: '' });
  return out;
}
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
const RAPIDE_UNIX = ['/home', '/root', '/tmp', '/var/tmp', '/dev/shm', '/var/www', '/srv', '/opt', '/usr/local', '/etc', '/Users', '/Applications', '/Library/LaunchAgents', '/Library/LaunchDaemons', '/private/tmp'];
const JAMAIS_UNIX = ['/proc', '/sys', '/dev', '/run', '/snap', '/var/lib/docker', '/var/lib/containers', '/var/lib/lxcfs', '/System/Volumes', '/private/var/vm', '/Volumes', '/mnt', '/media', '/net', '/cdrom'];
/**
 * La commande lancée sur un poste Linux ou Mac : « find » choisit les fichiers (taille, dossiers du système
 * laissés de côté) et « tar » les envoie en flux. Rien n'est écrit sur le poste. Pur.
 */
export function commandeUnix(racines: string[], o: { maxEach: number; maxGros: number }): string {
  const ko = (n: number) => Math.floor(n / 1024) + 1;
  // Les petits fichiers, et parmi les gros : les programmes (droit d'exécution) et les archives.
  const taille = `\\( -size -${ko(o.maxEach)}k -o \\( -size -${ko(o.maxGros)}k \\( -perm -100 -o ${EXT_GROS.map((e) => `-iname ${q(`*.${e}`)}`).join(' -o ')} \\) \\) \\)`;
  // Un dossier que tu désignes toi-même n'est jamais laissé de côté.
  const prune = JAMAIS_UNIX.filter((p) => !racines.includes(p)).map((p) => `-path ${q(p)}`).join(' -o ');
  // Seules les racines qui existent sont données à find ; COPYFILE_DISABLE : pas de fichiers « ._ » ajoutés par macOS.
  return `set -- ; for d in ${racines.map(q).join(' ')}; do [ -e "$d" ] && set -- "$@" "$d"; done; [ $# -gt 0 ] || exit 0; find "$@" \\( ${prune} \\) -prune -o -type f ${taille} -print0 2>/dev/null | COPYFILE_DISABLE=1 tar --null --no-recursion -T - -cf - 2>/dev/null`;
}

/** Lit un poste : rend le bilan ; chaque fichier passe par `surFichier`. */
export async function lirePoste(home: string, m: Machine, o: OptionsLecture): Promise<BilanLecture> {
  const via = await quelAcces(home, m);
  if (!via) throw new Error(`${m.label} ne répond ni au partage de fichiers (Windows, port ${m.smbPort ?? 445}) ni à SSH (port ${m.port || 22}) : poste éteint ou en veille, pare-feu fermé, ou autre réseau`);
  return via === 'smb' ? lireSmb(m, o) : lireSsh(home, m, o);
}

async function lireSmb(m: Machine, o: OptionsLecture): Promise<BilanLecture> {
  const maxEach = o.maxEach ?? 48 * 1024 * 1024, maxGros = o.maxGros ?? 1024 ** 3, max = o.max ?? 400_000;
  const b: BilanLecture = { via: 'smb', systeme: 'inconnu', racines: [], lus: 0, octets: 0, gros: 0, illisibles: 0, dossiersRefuses: 0, notes: [], arrete: false };
  o.surEtape?.('je regarde les partages du poste');
  const partages = o.ou ? [] : await partagesSmb(m);
  if (partages.some((p) => p.disque)) b.systeme = 'windows';
  const racines = racinesSmb(partages, o.profil, o.ou);
  if (!racines.length) throw new Error('aucun dossier partagé à lire sur ce poste avec ce compte');
  if (!o.ou && !partages.some((p) => p.disque)) b.notes.push('ce compte ne voit pas les disques entiers (C$) : seuls les dossiers partagés ont été lus');
  const hote = m.host.replace(/^\[|\]$/g, ''); let ouverts = 0;
  for (const r of racines) {
    if (o.signal?.aborted || b.lus >= max) break;
    const nom = cheminMontre(hote, r.partage, r.dossier).replace(/\/$/, ''); b.racines.push(nom);
    o.surEtape?.(`je liste ${nom}`);
    const liste: BilanListe = { fichiers: 0, dossiers: 0, refuses: 0, evites: 0 }, fichiers: FichierSmb[] = [];
    try {
      // D'abord la liste (une seule connexion, sans pause), ensuite la lecture par lots : la connexion qui liste ne reste jamais à attendre.
      for await (const f of listerSmb(m, r.partage, r.dossier, { signal: o.signal, bilan: liste, sauter: (d) => JAMAIS_WIN.test(`${d}/`) })) {
        if (o.signal?.aborted || b.lus + fichiers.length >= max) break;
        if (JAMAIS_WIN.test(f.chemin) || f.octets === 0) continue;
        if (f.octets > maxEach && !(f.octets <= maxGros && grosUtile(f.chemin))) { b.gros++; continue; }
        fichiers.push(f);
        if (fichiers.length % 2000 === 0) o.surEtape?.(`je liste ${nom} (${fichiers.length} fichiers trouvés)`);
      }
      // Par lots : assez gros pour aller vite, assez petits pour suivre l'avancement et pouvoir s'arrêter.
      for (let k = 0; k < fichiers.length && !o.signal?.aborted;) {
        const lot: FichierSmb[] = []; let poids = 0;
        while (k < fichiers.length && lot.length < 1500 && poids < 384 * 1024 * 1024) { lot.push(fichiers[k]); poids += fichiers[k].octets; k++; }
        o.surEtape?.(`je lis ${nom} (${b.lus} fichiers analysés sur ${b.lus + fichiers.length - k + lot.length})`);
        const r2 = await lireFichiersSmb(m, r.partage, lot, async (f, e: EntreeTar) => {
          b.lus++; b.octets += e.octets;
          await o.surFichier({ chemin: cheminMontre(hote, r.partage, f.chemin), partage: r.partage, relatif: f.chemin, octets: e.octets, ...(e.data ? { data: e.data } : { tete: e.tete, sha256: e.sha256 }) });
        }, { maxEach, signal: o.signal });
        b.illisibles += r2.illisibles.length;
      }
      ouverts++;
    } catch (e) {
      const msg = (e as Error).message;
      if (o.signal?.aborted) break;
      b.racines.pop();
      // Un dossier absent sur ce disque (pas de « Windows/Tasks » sur un disque de données) n'est pas une panne.
      if (/dossier introuvable/.test(msg)) continue;
      // Compte refusé, poste muet : inutile d'insister sur les autres dossiers.
      if (!ouverts && !b.lus && (racines.length === 1 || /mot de passe refusé|ne répond pas|est fermé|désactivé|verrouillé|expiré|invalide/.test(msg))) throw e;
      b.notes.push(`${nom} : ${msg}`);
    }
    b.dossiersRefuses += liste.refuses;
  }
  if (!ouverts && !b.lus && !o.signal?.aborted) throw new Error(b.notes[0] ?? 'aucun de ces dossiers n\'existe sur ce poste');
  b.arrete = Boolean(o.signal?.aborted);
  return b;
}

async function lireSsh(home: string, m: Machine, o: OptionsLecture): Promise<BilanLecture> {
  const maxEach = o.maxEach ?? 48 * 1024 * 1024, maxGros = o.maxGros ?? 1024 ** 3, max = o.max ?? 400_000;
  o.surEtape?.('je me connecte au poste');
  const systeme = await systemeSsh(home, m);
  if (systeme === 'windows') throw new Error(`${m.label} est un Windows joint par SSH : pour l'analyser, active son partage de fichiers (« Partage de fichiers et d'imprimantes », port 445), Odin passera par là`);
  const b: BilanLecture = { via: 'ssh', systeme, racines: [], lus: 0, octets: 0, gros: 0, illisibles: 0, dossiersRefuses: 0, notes: [], arrete: false };
  if (o.ou && !o.ou.startsWith('/')) throw new Error('sur un poste Linux ou Mac, donne un dossier qui commence par « / » (ex. /home/fatima)');
  if (o.ou && /[\0\n\r]/.test(o.ou)) throw new Error('dossier invalide');
  // « tout » : la racine, plus /dev/shm (mémoire partagée : un endroit où les programmes malveillants se cachent).
  const racines = o.ou ? [o.ou.replace(/\/+$/, '') || '/'] : o.profil === 'tout' ? ['/', '/dev/shm'] : RAPIDE_UNIX;
  b.racines = o.ou ? racines : o.profil === 'tout' ? ['/'] : ['dossiers des utilisateurs, temporaires, sites web, programmes ajoutés, démarrage'];
  const script = commandeUnix(racines, { maxEach, maxGros });
  // Administrateur si possible (pour lire tous les fichiers) ; sinon, ce que ce compte peut lire.
  const essais = m.user === 'root' ? [`sh -c ${q(script)}`] : (m.sudoPassword ?? m.password) ? [`sudo sh -c ${q(script)}`, `sh -c ${q(script)}`] : [`if sudo -n true 2>/dev/null; then sudo -n sh -c ${q(script)}; else sh -c ${q(script)}; fi`];
  for (const [k, cmd] of essais.entries()) {
    o.surEtape?.(`je lis ${b.racines.join(', ')}`);
    const x = streamOnMachine(home, m, cmd, { signal: o.signal });
    let recu = 0, propre = false;
    try {
      for await (const e of lireTar(x.sortie as AsyncIterable<Buffer>, { maxEach })) {
        if (!e.fichier) continue; recu++;
        if (o.signal?.aborted || b.lus >= max) { propre = false; break; }
        b.lus++; b.octets += e.octets;
        const chemin = `/${e.nom.replace(/^\/+/, '')}`;
        await o.surFichier({ chemin, relatif: chemin, octets: e.octets, ...(e.data ? { data: e.data } : { tete: e.tete, sha256: e.sha256 }) });
        if (b.lus % 500 === 0) o.surEtape?.(`je lis le poste (${b.lus} fichiers analysés)`);
      }
      propre = !o.signal?.aborted && b.lus < max;
    } catch (e) { x.arreter(); await x.fin; throw e; }
    // Fin normale : on laisse la commande finir ; sinon (arrêt demandé, limite atteinte) on coupe.
    if (propre) x.vider(); else x.arreter();
    const fin = await x.fin;
    if (o.signal?.aborted) break;
    // « sudo » refusé (ce compte n'est pas administrateur) : on recommence sans, en le disant.
    if (!recu && k < essais.length - 1 && /sudo|sudoers|password|mot de passe/i.test(fin.err)) { b.notes.push(`${m.user} n'est pas administrateur de ce poste : seuls les fichiers qu'il peut lire ont été analysés`); continue; }
    if (!recu && fin.code !== 0 && fin.err.trim()) throw new Error(/Permission denied/i.test(fin.err) ? 'utilisateur ou mot de passe refusé par le poste (SSH)' : fin.err.trim().split('\n').at(-1)!.slice(0, 200));
    break;
  }
  if (m.user !== 'root' && !(m.sudoPassword ?? m.password) && !b.notes.length) b.notes.push('sans mot de passe administrateur pour ce poste, les fichiers réservés à root peuvent manquer');
  b.arrete = Boolean(o.signal?.aborted);
  return b;
}

/** Met un fichier d'un poste à l'écart, sur place : renommé (« .odin-quarantaine ») et, sous Linux et Mac, privé de tout droit. Réversible. */
export async function isolerSurPoste(home: string, m: Machine, f: { partage?: string; relatif: string }): Promise<{ vers: string }> {
  const vers = `${f.relatif}.odin-quarantaine`;
  if (f.partage) { await renommerSmb(m, f.partage, f.relatif, vers); return { vers }; }
  if (!f.relatif.startsWith('/') || /[\0\n\r]/.test(f.relatif)) throw new Error('chemin invalide');
  const cmd = `mv -n -- ${q(f.relatif)} ${q(vers)} && chmod 000 -- ${q(vers)}`;
  const r = await runOnMachine(home, m, m.user === 'root' ? cmd : `sudo sh -c ${q(cmd)}`, { timeoutMs: 30_000 });
  if (r.code !== 0) { const r2 = m.user === 'root' ? r : await runOnMachine(home, m, cmd, { timeoutMs: 30_000 }); if (r2.code !== 0) throw new Error(/No such file/i.test(r2.out) ? 'le fichier n\'est plus là' : /denied|not permitted/i.test(r2.out) ? 'le poste refuse de modifier ce fichier avec ce compte' : (r2.out.trim().split('\n').at(-1) ?? 'déplacement refusé').slice(0, 200)); }
  return { vers };
}
/** Remet à sa place un fichier mis à l'écart sur un poste. */
export async function remettreSurPoste(home: string, m: Machine, f: { partage?: string; relatif: string; vers: string }): Promise<void> {
  if (f.partage) { await renommerSmb(m, f.partage, f.vers, f.relatif); return; }
  if (!f.relatif.startsWith('/') || /[\0\n\r]/.test(`${f.relatif}${f.vers}`)) throw new Error('chemin invalide');
  const cmd = `chmod 644 -- ${q(f.vers)} && mv -n -- ${q(f.vers)} ${q(f.relatif)}`;
  const r = await runOnMachine(home, m, m.user === 'root' ? cmd : `sudo sh -c ${q(cmd)}`, { timeoutMs: 30_000 });
  if (r.code !== 0) { const r2 = m.user === 'root' ? r : await runOnMachine(home, m, cmd, { timeoutMs: 30_000 }); if (r2.code !== 0) throw new Error((r2.out.trim().split('\n').at(-1) ?? 'remise en place refusée').slice(0, 200)); }
}
