// Les partages Windows (SMB) lus avec « smbclient », sans rien monter ni rien installer sur le poste visé :
// liste des partages, liste récursive des fichiers (en flux), lecture des fichiers en flux tar, renommage
// (quarantaine). Le mot de passe est donné à smbclient par son environnement (visible de lui seul) : jamais sur
// la ligne de commande, jamais dans un fichier, jamais dans un journal.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { lireTar, type EntreeTar, type OptionsTar } from '../files/tar-flux.ts';
import type { Machine } from './access.ts';

type Compte = Pick<Machine, 'host' | 'user' | 'password' | 'domain' | 'smbPort'>;
/** Les options de connexion et l'environnement qui porte le mot de passe (jamais écrit sur le disque ni sur la ligne de commande). */
function acces(m: Compte): { args: string[]; env: NodeJS.ProcessEnv } {
  if (!m.user || /^[-\s]|[\r\n\0%]/.test(m.user) || /[\r\n\0]/.test(`${m.password ?? ''}${m.domain ?? ''}`) || /^-/.test(m.domain ?? '')) throw new Error('identifiants invalides');
  return { args: ['-U', m.user, ...(m.domain ? ['-W', m.domain] : []), ...(m.password ? [] : ['-N']), ...(m.smbPort && m.smbPort !== 445 ? ['-p', String(m.smbPort)] : []), '-t', '30'], env: m.password ? { PASSWD: m.password } : {} };
}
const hote = (m: Compte) => m.host.replace(/^\[|\]$/g, '');
/** L'environnement de smbclient : celui d'Odin, sans mot de passe hérité d'ailleurs, plus celui du compte demandé. */
const ENV = (compte: NodeJS.ProcessEnv) => { const e: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' }; delete e.PASSWD; delete e.PASSWD_FD; delete e.PASSWD_FILE; return { ...e, ...compte }; };

/** Ce que veut dire un refus de Windows, en français, avec quoi faire. Pur. */
export function erreurSmb(sortie: string): string | undefined {
  const code = /NT_STATUS_[A-Z_]+/.exec(sortie)?.[0]; if (!code) return undefined;
  const sens: Record<string, string> = {
    NT_STATUS_LOGON_FAILURE: 'identifiant ou mot de passe refusé par le poste',
    NT_STATUS_ACCESS_DENIED: 'accès refusé : ce compte ne peut pas ouvrir ce partage. Sur Windows, un compte administrateur local est bloqué à distance par défaut (sauf le compte « Administrateur ») : sur le PC, ouvre une invite de commandes en administrateur et lance une fois « reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f », ou partage simplement le dossier à analyser',
    NT_STATUS_BAD_NETWORK_NAME: 'ce partage n\'existe pas sur le poste',
    NT_STATUS_CONNECTION_REFUSED: 'le partage de fichiers est fermé sur ce poste (sur Windows : active « Partage de fichiers et d\'imprimantes » pour le réseau privé)',
    NT_STATUS_HOST_UNREACHABLE: 'le poste ne répond pas (éteint, en veille, ou sur un autre réseau)',
    NT_STATUS_IO_TIMEOUT: 'le poste ne répond pas (éteint, en veille, ou pare-feu fermé)',
    NT_STATUS_UNSUCCESSFUL: 'le poste ne répond pas au partage de fichiers',
    NT_STATUS_NETWORK_UNREACHABLE: 'réseau injoignable depuis la machine d\'Odin',
    NT_STATUS_ACCOUNT_DISABLED: 'ce compte est désactivé sur le poste',
    NT_STATUS_ACCOUNT_LOCKED_OUT: 'ce compte est verrouillé sur le poste (trop d\'essais) : attends ou déverrouille-le',
    NT_STATUS_PASSWORD_EXPIRED: 'le mot de passe de ce compte a expiré : change-le sur le poste',
    NT_STATUS_PASSWORD_MUST_CHANGE: 'le mot de passe de ce compte doit être changé sur le poste',
    NT_STATUS_ACCOUNT_RESTRICTION: 'ce compte n\'a pas le droit de se connecter par le réseau (un compte sans mot de passe est refusé à distance : donne-lui un mot de passe)',
    NT_STATUS_NOT_SUPPORTED: 'ce poste ne parle qu\'une ancienne version du partage (SMB1), refusée par sécurité',
    NT_STATUS_INVALID_NETWORK_RESPONSE: 'ce poste ne parle qu\'une ancienne version du partage (SMB1), refusée par sécurité',
  };
  return sens[code] ?? `le poste a refusé (${code.replace('NT_STATUS_', '').toLowerCase().replace(/_/g, ' ')})`;
}
/** La panne vient-elle de la connexion elle-même (compte, réseau, partage), pas d'un fichier ? Pur. */
export const panneConnexion = (sortie: string) => /session setup failed|tree connect failed|do_connect|Connection to .* failed|NT_STATUS_(LOGON_FAILURE|CONNECTION_REFUSED|HOST_UNREACHABLE|IO_TIMEOUT|BAD_NETWORK_NAME|NETWORK_UNREACHABLE|ACCOUNT_\w+|PASSWORD_\w+)/.test(sortie);

function lancer(args: string[], env: NodeJS.ProcessEnv, o: { signal?: AbortSignal; stdin?: string } = {}) {
  const child = spawn('smbclient', args, { env: ENV(env), signal: o.signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; child.stderr.on('data', (d: Buffer) => { if (err.length < 64_000) err += d.toString(); });
  child.stdin.on('error', () => undefined); child.stdin.end(o.stdin ?? '');
  // `absent` : smbclient n'a pas pu être lancé du tout (pas installé).
  const fin = new Promise<{ code: number | null; err: string; absent?: string }>((res) => {
    child.on('error', (e) => { const m = /ENOENT/.test(e.message) ? 'smbclient n\'est pas installé sur la machine d\'Odin (paquet « smbclient »)' : e.message; res({ code: null, err: m, absent: m }); });
    child.on('close', (code) => res({ code, err }));
  });
  // Arrêter : tuer le programme ET fermer sa sortie (une sortie pas lue jusqu'au bout retiendrait la fin pour toujours).
  return { child, fin, arreter: () => { try { child.kill('SIGKILL'); } catch { /* déjà fini */ } child.stdout.destroy(); }, vider: () => { child.stdout.resume(); } };
}
async function court(args: string[], env: NodeJS.ProcessEnv, stdin?: string, ms = 45_000): Promise<{ code: number | null; out: string }> {
  const x = lancer(args, env, { stdin }); let out = ''; x.child.stdout.on('data', (d: Buffer) => { if (out.length < 4_000_000) out += d.toString(); });
  const t = setTimeout(x.arreter, ms); const r = await x.fin; clearTimeout(t);
  return { code: r.code, out: `${out}${r.err}` };
}

export interface Partage { nom: string; commentaire: string; /** partage administratif d'un disque entier (C$, D$…) */ disque?: string }
/** « smbclient -L -g » → les partages de fichiers (pas les imprimantes ni IPC$). Pur. */
export function lirePartages(sortie: string): Partage[] {
  return sortie.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 3 && p[0] === 'Disk' && !/^(print\$|IPC\$)$/i.test(p[1]))
    .map(([, nom, c]) => ({ nom, commentaire: c.trim(), ...(/^[A-Za-z]\$$/.test(nom) ? { disque: nom[0].toUpperCase() } : {}) }));
}
/** Les partages de fichiers d'un poste. Lève une erreur claire si le poste refuse. */
export async function partagesSmb(m: Compte): Promise<Partage[]> {
  const a = acces(m), r = await court(['-L', `//${hote(m)}`, '-g', ...a.args], a.env);
  const l = lirePartages(r.out); if (l.length) return l;
  throw new Error(erreurSmb(r.out) ?? (r.out.trim().split('\n').at(-1)?.slice(0, 200) || 'aucun partage visible'));
}
/** Le partage s'ouvre-t-il avec ce compte ? Rend la raison du refus, ou rien si tout va bien. */
export async function essaiSmb(m: Compte, partage: string): Promise<string | undefined> {
  if (!nomOk(partage)) return 'nom de partage invalide';
  const a = acces(m), r = await court([`//${hote(m)}/${partage}`, ...a.args], a.env, 'ls\n', 30_000);
  return panneConnexion(r.out) || /NT_STATUS_ACCESS_DENIED/.test(r.out) ? erreurSmb(r.out) ?? 'connexion refusée' : undefined;
}
const nomOk = (x: string) => x.length > 0 && x.length < 4000 && !/["\r\n\0]/.test(x);

export interface FichierSmb { /** chemin dans le partage, avec des barres droites (« Users/Fatima/a.txt ») */ chemin: string; octets: number }
/**
 * Une ligne de « ls » : nom, attributs, taille. smbclient écrit toujours « deux espaces, le nom sur 30 colonnes au
 * moins, les attributs sur 7, un espace, la taille sur 8 au moins, deux espaces, la date » : lue depuis la droite,
 * la ligne n'a qu'une lecture possible, même si le nom contient des espaces, des chiffres ou des majuscules. Pur.
 */
export function ligneLs(l: string): { nom: string; attrs: string; octets: number } | undefined {
  const m = /^ {2}(.*)([ A-Za-z]{7}) ( {7}\d| {6}\d{2}| {5}\d{3}| {4}\d{4}| {3}\d{5}| {2}\d{6}| \d{7}|\d{8,}) {2}\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4}\s*$/.exec(l); if (!m) return undefined;
  const nom = m[1].trimEnd();
  return nom && nom !== '.' && nom !== '..' ? { nom, attrs: m[2].trim(), octets: Number(m[3]) } : undefined;
}
export interface BilanListe { fichiers: number; dossiers: number; refuses: number; /** dossiers non descendus : raccourci vers un autre dossier, chemin qui tourne en rond, trop profond */ evites: number }
/** Un chemin qui tourne en rond (« X11\\X11\\X11 », « a\\b\\a\\b\\a\\b ») : un raccourci qui renvoie vers un dossier parent. Pur. */
export function tourneEnRond(chemin: string): boolean {
  const p = chemin.toLowerCase().split(/[\\/]/).filter(Boolean);
  for (let n = 1; n <= 4; n++) {
    if (p.length < n * 3) continue;
    const bout = (k: number) => p.slice(p.length - k * n, p.length - (k - 1) * n).join('/');
    if (bout(1) === bout(2) && bout(2) === bout(3)) return true;
  }
  return false;
}
/**
 * Tous les fichiers d'un dossier d'un partage, sous-dossiers compris, rendus au fur et à mesure. Odin descend
 * lui-même dans les dossiers, niveau par niveau (une connexion par niveau, tous les dossiers du niveau demandés
 * d'un coup) : il ne suit pas les raccourcis de Windows (points de jonction), s'arrête quand un chemin tourne en
 * rond, et ne descend pas au-delà de 32 niveaux.
 */
export async function* listerSmb(m: Compte, partage: string, dossier = '', o: { signal?: AbortSignal; bilan?: BilanListe; profondeur?: number; /** dossiers à ne pas ouvrir (chemin dans le partage, avec des barres droites) */ sauter?: (dossier: string) => boolean } = {}): AsyncGenerator<FichierSmb> {
  const dir = dossier.replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
  if (!nomOk(partage) || (dir && !nomOk(dir))) throw new Error('nom de partage ou de dossier invalide');
  const a = acces(m), max = o.profondeur ?? 32, bilan = o.bilan ?? { fichiers: 0, dossiers: 0, refuses: 0, evites: 0 };
  let niveau = [dir], premier = true;
  while (niveau.length && !o.signal?.aborted) {
    const suivant: string[] = [];
    for (let k = 0; k < niveau.length && !o.signal?.aborted; k += 4000) {
      // Chaque dossier : « ls » puis « pwd », dont la réponse marque la fin de la liste de ce dossier.
      const file = niveau.slice(k, k + 4000);
      const x = lancer([`//${hote(m)}/${partage}`, ...a.args], a.env, { signal: o.signal, stdin: `${file.map((d) => `ls "${d ? `${d}\\` : ''}*"\npwd\n`).join('')}exit\n` });
      let debut = '', trouve = false;
      try {
        for await (const l of createInterface({ input: x.child.stdout, crlfDelay: Infinity })) {
          if (debut.length < 2000) debut += `${l}\n`;
          if (l.startsWith('Current directory is ')) { file.shift(); continue; }
          const cur = file[0]; if (cur === undefined) continue;
          if (/NT_STATUS_\w+ listing /.test(l)) {
            // Le dossier demandé au départ n'existe pas : c'est une erreur. Un sous-dossier refusé est seulement compté.
            if (premier && !trouve) throw new Error(/ACCESS_DENIED/.test(l) ? 'le poste refuse d\'ouvrir ce dossier avec ce compte' : /NOT_FOUND|NO_SUCH_FILE|NOT_A_DIRECTORY|BAD_NETWORK/.test(l) ? 'dossier introuvable sur ce partage' : erreurSmb(l) ?? 'dossier illisible');
            bilan.refuses++; continue;
          }
          const e = ligneLs(l); if (!e) { if (/^ {2}\.\.? /.test(l)) trouve = true; continue; }
          trouve = true;
          const chemin = `${cur ? `${cur}\\` : ''}${e.nom}`;
          if (e.attrs.includes('D')) {
            // Raccourci vers un autre dossier, chemin qui tourne en rond, trop profond, nom impossible à demander : on n'y descend pas.
            if (e.attrs.includes('L') || tourneEnRond(chemin) || chemin.split('\\').length > max || !nomOk(chemin) || o.sauter?.(chemin.replace(/\\/g, '/'))) { bilan.evites++; continue; }
            bilan.dossiers++; suivant.push(chemin); continue;
          }
          if (e.attrs.includes('L')) continue;   // raccourci vers un fichier rangé ailleurs : il sera vu à sa vraie place
          bilan.fichiers++;
          yield { chemin: chemin.replace(/\\/g, '/'), octets: e.octets };
        }
        const fin = await x.fin, tout = `${debut}${fin.err}`;
        if (fin.absent) throw new Error(fin.absent);
        if (o.signal?.aborted) return;
        if (panneConnexion(tout) || (premier && !trouve)) throw new Error(erreurSmb(tout) ?? 'la connexion au partage a été coupée');
        bilan.refuses += file.length;   // connexion coupée en route : ces dossiers n'ont pas été lus
      } finally { x.arreter(); }
      premier = false;
    }
    niveau = suivant;
  }
}

export interface BilanLectureSmb { lus: number; illisibles: string[] }
/**
 * Lit ces fichiers d'un partage, un par un, en mémoire (flux tar de smbclient). Un fichier verrouillé, disparu
 * ou refusé arrête le flux de smbclient : on note le fichier et on reprend juste après lui.
 */
export async function lireFichiersSmb(m: Compte, partage: string, fichiers: FichierSmb[], sur: (f: FichierSmb, e: EntreeTar) => Promise<void>, o: OptionsTar & { signal?: AbortSignal } = {}): Promise<BilanLectureSmb> {
  if (!nomOk(partage)) throw new Error('nom de partage invalide');
  const bilan: BilanLectureSmb = { lus: 0, illisibles: [] }, norm = (x: string) => x.replace(/\\/g, '/').replace(/^(\.\/)+/, '').normalize('NFC');
  let reste = fichiers.filter((f) => { if (/[\r\n\0]/.test(f.chemin)) { bilan.illisibles.push(f.chemin); return false; } return true; }), premier = true;
  // La liste des fichiers à lire (des noms, aucun secret) passe par un fichier temporaire, effacé dans tous les cas.
  const a = acces(m), dir = mkdtempSync(join(tmpdir(), 'odin-liste-')), liste = join(dir, 'liste');
  try {
  while (reste.length && !o.signal?.aborted) {
    writeFileSync(liste, `${reste.map((f) => f.chemin).join('\n')}\n`, { mode: 0o600 });
    const x = lancer([`//${hote(m)}/${partage}`, ...a.args, '-TcF', '-', liste], a.env, { signal: o.signal });
    let pos = 0, propre = false, debut = '';
    // Le début de la sortie est gardé : un refus de connexion s'y écrit à la place de l'archive.
    const sortie = (async function* () { for await (const d of x.child.stdout as AsyncIterable<Buffer>) { if (debut.length < 2000) debut += d.subarray(0, 2000).toString('latin1'); yield d; } })();
    try {
      for await (const e of lireTar(sortie, o)) {
        if (!e.fichier) continue;
        // Le fichier reçu est normalement le suivant de la liste ; s'il est plus loin, ceux d'avant ont été sautés.
        const nom = norm(e.nom); let k = pos; while (k < reste.length && norm(reste[k].chemin) !== nom) k++;
        if (k >= reste.length) k = pos;
        if (k >= reste.length) break;
        for (let j = pos; j < k; j++) bilan.illisibles.push(reste[j].chemin);
        pos = k + 1; bilan.lus++;
        await sur(reste[k], e);
      }
      propre = true;
    } catch (err) { if (!o.signal?.aborted && !/tar/.test((err as Error).message)) { x.arreter(); throw err; } /* flux abîmé : on reprend après le dernier fichier reçu */ }
    // Fin normale : on laisse smbclient finir d'écrire (la fin de l'archive) ; sinon on l'arrête.
    if (propre) x.vider(); else x.arreter();
    const fin = await x.fin;
    if (o.signal?.aborted) break;
    if (fin.absent) throw new Error(fin.absent);
    if (premier && pos === 0 && panneConnexion(`${fin.err}\n${debut}`)) throw new Error(erreurSmb(`${fin.err}\n${debut}`) ?? 'connexion au partage refusée');
    premier = false;
    if (pos >= reste.length) break;
    bilan.illisibles.push(reste[pos].chemin);   // celui sur lequel smbclient s'est arrêté
    reste = reste.slice(pos + 1);
  }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return bilan;
}

/** Renomme un fichier du partage (sert à la quarantaine : « virus.exe » → « virus.exe.odin-quarantaine »). */
export async function renommerSmb(m: Compte, partage: string, de: string, vers: string): Promise<void> {
  const d = de.replace(/\//g, '\\'), v = vers.replace(/\//g, '\\');
  if (!nomOk(partage) || !nomOk(d) || !nomOk(v)) throw new Error('nom de fichier impossible à renommer à distance (guillemet ou retour à la ligne)');
  const a = acces(m);
  {
    const r = await court([`//${hote(m)}/${partage}`, ...a.args], a.env, `rename "${d}" "${v}"\n`);
    if (panneConnexion(r.out)) throw new Error(erreurSmb(r.out) ?? 'connexion au partage refusée');
    if (/NT_STATUS_\w+ renaming/.test(r.out) || /NT_STATUS_(ACCESS_DENIED|SHARING_VIOLATION|OBJECT_NAME_NOT_FOUND|OBJECT_NAME_COLLISION|OBJECT_PATH_NOT_FOUND|MEDIA_WRITE_PROTECTED)/.test(r.out)) {
      const code = /NT_STATUS_[A-Z_]+/.exec(r.out)?.[0] ?? '';
      throw new Error(code === 'NT_STATUS_SHARING_VIOLATION' ? 'le fichier est ouvert par un programme sur le poste : ferme-le (ou redémarre le poste) puis recommence' : code === 'NT_STATUS_OBJECT_NAME_NOT_FOUND' || code === 'NT_STATUS_OBJECT_PATH_NOT_FOUND' ? 'le fichier n\'est plus là' : code === 'NT_STATUS_OBJECT_NAME_COLLISION' ? 'un fichier porte déjà ce nom' : code === 'NT_STATUS_MEDIA_WRITE_PROTECTED' ? 'ce partage est en lecture seule' : 'le poste refuse de modifier ce fichier avec ce compte');
    }
  }
}
