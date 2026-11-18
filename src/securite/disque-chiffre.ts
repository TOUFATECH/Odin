// Disque d'Odin : est-il chiffré ? (SEC-28, « vérifie » et « guide » seulement.)
//
// Odin DIT si les volumes qui portent ses données sont chiffrés : chiffré / pas chiffré / je ne peux pas le savoir
// (et « conteneur » : le disque est celui de l'hôte). Il ne bloque rien, ne lance aucun chiffrement et ne lit, ne
// crée ni ne garde JAMAIS une clé de récupération : les commandes lancées et les champs lus ne la contiennent pas.
//  - Windows : la classe Win32_EncryptableVolume, champs DriveLetter, ProtectionStatus et ConversionStatus
//    seulement (aucune méthode qui touche aux protecteurs ; pas Get-BitLockerVolume, qui charge les protecteurs) ;
//    et l'édition de Windows (EditionID), pour savoir si BitLocker existe ;
//  - Linux : findmnt (le volume d'un dossier), lsblk (la couche « crypt » au-dessus), lsattr -d (le drapeau
//    « E » d'un dossier chiffré fichier par fichier) ;
//  - macOS : fdesetup status, df -P.
// Les lecteurs sont PURS (ils prennent la sortie enregistrée d'un outil) ; la vérification reçoit un « lanceur »
// injecté, comme la source des disques de Genèse (valhalla/thjalfi/disques.ts) : les essais ne lancent jamais rien.
// Le doute vaut toujours « je ne peux pas le savoir », jamais « chiffré » : un seul volume pas chiffré ou inconnu
// suffit pour que le disque d'Odin ne soit pas dit chiffré.

import { posix, win32 } from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';

/** Ce que porte un volume vérifié : le dossier d'Odin, le dossier de la clé de la machine, l'application, les sauvegardes. */
export type Role = 'dossier' | 'cles' | 'application' | 'sauvegardes';
export const ROLES: Role[] = ['dossier', 'cles', 'application', 'sauvegardes'];
export type Etat = 'chiffre' | 'pas-chiffre' | 'inconnu';
export type Decision = Etat | 'conteneur';
export type Systeme = 'windows' | 'linux' | 'macos' | 'autre';
export type Raison =
  | 'bitlocker-protege' | 'bitlocker-suspendu' | 'bitlocker-en-cours' | 'bitlocker-en-pause' | 'bitlocker-non-chiffre' | 'bitlocker-illisible'
  | 'volume-absent' | 'chemin-reseau' | 'droits-manquants' | 'outil-absent' | 'illisible'
  | 'luks' | 'sans-luks' | 'luks-partiel' | 'dossier-non-relie' | 'chiffrement-fichiers'
  | 'filevault-actif' | 'filevault-inactif' | 'filevault-en-cours' | 'hors-disque-demarrage'
  | 'conteneur' | 'systeme-inconnu';
export interface VolumeVu { role: Role; chemin: string; volume?: string; etat: Etat; raison: Raison }
export interface Bilan { decision: Decision; systeme: Systeme; volumes: VolumeVu[]; windowsFamille?: boolean; conteneur?: string }

const entier = (x: unknown): number | undefined => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\d+$/.test(x.trim()) ? Number(x) : NaN;
  return Number.isInteger(n) ? n : undefined;
};

// ---------------- Windows : BitLocker ----------------
/** L'état BitLocker d'un volume. « verrouille » : chiffré mais fermé (on ne sait rien de plus). */
export type EtatBitLocker = 'protege' | 'suspendu' | 'en-cours' | 'en-pause' | 'verrouille' | 'non-chiffre' | 'inconnu';
export type LectureBitLocker = 'ok' | 'outil-absent' | 'droits-manquants' | 'illisible';
export interface SortieBitLocker { lecture: LectureBitLocker; edition?: string; parLettre: Record<string, EtatBitLocker> }

/**
 * La commande PowerShell (lecture seule) : l'édition de Windows, puis, pour chaque volume, sa lettre, l'état de sa
 * protection et de sa conversion. Aucun protecteur, aucune clé n'est demandé. Sans les droits d'administrateur,
 * la classe refuse : la lecture vaut alors « droits-manquants ».
 */
const PS_BITLOCKER = [
  "$ErrorActionPreference='Stop'",
  "$ed=''",
  "try{$ed=[string](Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID}catch{}",
  "$l='ok'",
  '$v=@()',
  "try{$v=@(Get-CimInstance -Namespace 'root\\cimv2\\Security\\MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume | Select-Object DriveLetter,ProtectionStatus,ConversionStatus)}catch{$c=[string]$_.Exception.NativeErrorCode;$l=if($c -eq 'InvalidNamespace' -or $c -eq 'InvalidClass' -or $c -eq 'NotFound'){'outil-absent'}elseif($c -eq 'AccessDenied'){'droits-manquants'}else{'illisible'}}",
  "if($l -eq 'ok' -and $v.Count -eq 0){$l='illisible'}",
  '[pscustomobject]@{edition=$ed;lecture=$l;volumes=$v}|ConvertTo-Json -Depth 3 -Compress',
].join(';');
export const ARGS_BITLOCKER: readonly string[] = ['-NoProfile', '-NonInteractive', '-Command', PS_BITLOCKER];

/** L'état d'un volume d'après ProtectionStatus (0 sans, 1 active, 2 inconnue) et ConversionStatus (0 déchiffré, 1 chiffré, 2-3 en cours, 4-5 en pause : une pause ne reprend pas seule). Pur. */
export function etatBitLocker(protection: unknown, conversion: unknown): EtatBitLocker {
  const p = entier(protection), c = entier(conversion);
  if (c === 0) return p === 0 ? 'non-chiffre' : 'inconnu';
  if (c === 1) return p === 1 ? 'protege' : p === 0 ? 'suspendu' : p === 2 ? 'verrouille' : 'inconnu';
  if (c === 2 || c === 3) return 'en-cours';
  if (c === 4 || c === 5) return 'en-pause';
  return 'inconnu';
}

/** Lit la sortie enregistrée de ARGS_BITLOCKER. Une sortie vide ou illisible n'apprend rien : « illisible ». Pur. */
export function lireBitLocker(texte: string): SortieBitLocker {
  let o: { edition?: unknown; lecture?: unknown; volumes?: unknown };
  try { o = JSON.parse(texte || 'null'); } catch { return { lecture: 'illisible', parLettre: {} }; }
  if (!o || typeof o !== 'object') return { lecture: 'illisible', parLettre: {} };
  const lecture: LectureBitLocker = (['ok', 'outil-absent', 'droits-manquants', 'illisible'] as const).find((x) => x === o.lecture) ?? 'illisible';
  const edition = typeof o.edition === 'string' && o.edition ? o.edition : undefined;
  const parLettre: Record<string, EtatBitLocker> = {};
  if (lecture === 'ok') {
    const vols = Array.isArray(o.volumes) ? o.volumes : o.volumes && typeof o.volumes === 'object' ? [o.volumes] : [];
    for (const v of vols as Array<Record<string, unknown>>) {
      const m = /^([A-Za-z]):?$/.exec(String(v?.DriveLetter ?? '').trim());
      if (m) parLettre[m[1].toUpperCase()] = etatBitLocker(v.ProtectionStatus, v.ConversionStatus);
    }
  }
  return { lecture, ...(edition ? { edition } : {}), parLettre };
}

/** Pour Genèse (ne pas toucher un disque chiffré) : vrai dès que BitLocker est sur le volume, même en pause. Pur. */
export function bitLockerPourGenese(e: EtatBitLocker | undefined): boolean | 'inconnu' {
  if (e === 'protege' || e === 'suspendu' || e === 'en-cours' || e === 'en-pause' || e === 'verrouille') return true;
  return e === 'non-chiffre' ? false : 'inconnu';
}

/** Windows Famille (EditionID « Core… ») : pas de BitLocker. Pur. */
export const windowsFamille = (edition: string | undefined): boolean => /^core/i.test(edition ?? '');

/** La lettre de lecteur d'un chemin Windows (« C:\… » → « C ») ; rien pour un chemin réseau. Pur. */
export function lettreDe(chemin: string): string | undefined {
  const m = /^([A-Za-z]):/.exec(chemin.replace(/^\\\\\?\\/, ''));
  return m ? m[1].toUpperCase() : undefined;
}

/** Le partage d'un chemin réseau (« \\serveur\partage\… » → « \\serveur\partage »), rien sinon. Pur. */
export function partageDe(chemin: string): string | undefined {
  const m = /^(?:\\\\\?\\UNC\\|\\\\(?![?.]\\))([^\\/]+)[\\/]([^\\/]+)/i.exec(chemin);
  return m ? `\\\\${m[1]}\\${m[2]}` : undefined;
}

/**
 * L'état d'un volume Windows d'après la lecture BitLocker. `reel` est le vrai chemin du dossier (liens et jonctions
 * résolus) ; le chemin montré reste celui d'Odin. Pur.
 */
export function volumeWindows(role: Role, chemin: string, bl: SortieBitLocker, reel: string = chemin): VolumeVu {
  const L = lettreDe(reel);
  if (!L) {
    const partage = partageDe(reel);
    return partage ? { role, chemin, volume: partage, etat: 'inconnu', raison: 'chemin-reseau' } : { role, chemin, etat: 'inconnu', raison: 'dossier-non-relie' };
  }
  const volume = `${L}:`;
  if (bl.lecture !== 'ok') return { role, chemin, volume, etat: 'inconnu', raison: bl.lecture === 'outil-absent' ? 'outil-absent' : bl.lecture === 'droits-manquants' ? 'droits-manquants' : 'illisible' };
  const e = bl.parLettre[L];
  if (e === undefined) return { role, chemin, volume, etat: 'inconnu', raison: 'volume-absent' };
  const r: Record<EtatBitLocker, [Etat, Raison]> = {
    protege: ['chiffre', 'bitlocker-protege'], suspendu: ['pas-chiffre', 'bitlocker-suspendu'], 'en-cours': ['pas-chiffre', 'bitlocker-en-cours'], 'en-pause': ['pas-chiffre', 'bitlocker-en-pause'],
    'non-chiffre': ['pas-chiffre', 'bitlocker-non-chiffre'], verrouille: ['inconnu', 'bitlocker-illisible'], inconnu: ['inconnu', 'bitlocker-illisible'],
  };
  return { role, chemin, volume, etat: r[e][0], raison: r[e][1] };
}

// ---------------- Linux : findmnt, lsblk, lsattr ----------------
/** Le montage d'un dossier, d'après `findmnt -J -T <dossier> -o SOURCE,TARGET,FSTYPE`. Pur. */
export function lireFindmnt(json: string): { source: string; cible: string; fstype: string } | undefined {
  try {
    const f = (JSON.parse(json) as { filesystems?: Array<{ source?: string; target?: string; fstype?: string }> }).filesystems?.[0];
    if (!f?.source) return undefined;
    // Un sous-volume btrfs s'écrit « /dev/sda2[/@home] » : le volume est ce qui précède le crochet.
    return { source: f.source.replace(/\[.*\]$/, ''), cible: f.target ?? '', fstype: (f.fstype ?? '').toLowerCase() };
  } catch { return undefined; }
}

interface NoeudLsblk { name?: string; kname?: string; path?: string; type?: string; children?: NoeudLsblk[] }

/**
 * Relie le volume d'un dossier à l'arbre de `lsblk -J -O` : chiffré seulement si CHAQUE apparition du volume
 * (un volume LVM sur plusieurs disques apparaît sous chacun) a une couche « crypt » en lui ou au-dessus. Un volume
 * absent de l'arbre : « inconnu ». Pur.
 */
export function relierLsblk(json: string, source: string): { etat: Etat; raison: Raison } {
  let racine: { blockdevices?: NoeudLsblk[] };
  try { racine = JSON.parse(json); } catch { return { etat: 'inconnu', raison: 'illisible' }; }
  if (!racine || !Array.isArray(racine.blockdevices)) return { etat: 'inconnu', raison: 'illisible' };
  const vus: boolean[] = [];
  const parcourir = (noeuds: NoeudLsblk[], crypt: boolean) => {
    for (const n of noeuds) {
      const ici = crypt || n.type === 'crypt';
      const noms = [n.path, n.name && `/dev/${n.name}`, n.name && `/dev/mapper/${n.name}`, n.kname && `/dev/${n.kname}`].filter(Boolean);
      if (noms.includes(source)) vus.push(ici);
      if (Array.isArray(n.children)) parcourir(n.children, ici);
    }
  };
  parcourir(racine.blockdevices, false);
  if (!vus.length) return { etat: 'inconnu', raison: 'dossier-non-relie' };
  if (vus.every(Boolean)) return { etat: 'chiffre', raison: 'luks' };
  return vus.some(Boolean) ? { etat: 'pas-chiffre', raison: 'luks-partiel' } : { etat: 'pas-chiffre', raison: 'sans-luks' };
}

/** Vrai si `lsattr -d <dossier>` montre le drapeau « E » (dossier chiffré fichier par fichier, fscrypt). Pur. */
export function chiffreParFichiers(sortieLsattr: string): boolean {
  const attrs = sortieLsattr.trim().split('\n')[0]?.trim().split(/\s+/)[0] ?? '';
  return /^[-A-Za-z]+$/.test(attrs) && attrs.includes('E');
}

// ---------------- macOS : fdesetup, df ----------------
/** Lit `fdesetup status` (FileVault, disque de démarrage). Pur. */
export function lireFdesetup(sortie: string): { etat: Etat; raison: Raison } {
  if (/(En|De)cryption in progress/i.test(sortie)) return { etat: 'pas-chiffre', raison: 'filevault-en-cours' };
  if (/FileVault is On\./.test(sortie)) return { etat: 'chiffre', raison: 'filevault-actif' };
  if (/FileVault is Off\./.test(sortie)) return { etat: 'pas-chiffre', raison: 'filevault-inactif' };
  return { etat: 'inconnu', raison: 'illisible' };
}

/** Le point de montage d'un dossier d'après `df -P <dossier>` (dernière colonne). Pur. */
export function pointDeMontageDf(sortie: string): string | undefined {
  const lignes = sortie.trim().split('\n');
  if (lignes.length < 2) return undefined;
  const champs = lignes[lignes.length - 1].trim().split(/\s+/);
  return champs.length >= 6 ? champs.slice(5).join(' ') : undefined;
}
const DEMARRAGE_MAC = new Set(['/', '/System/Volumes/Data']);

// ---------------- La décision ----------------
/** Chiffré seulement si TOUS les volumes le sont ; un seul « pas chiffré » l'emporte ; sinon « inconnu ». Pur. */
export function decider(volumes: VolumeVu[]): Etat {
  if (!volumes.length) return 'inconnu';
  if (volumes.some((v) => v.etat === 'pas-chiffre')) return 'pas-chiffre';
  return volumes.every((v) => v.etat === 'chiffre') ? 'chiffre' : 'inconnu';
}

/** Lance une commande et rend sa sortie (injecté : les essais rendent des sorties enregistrées). */
export type Lanceur = (cmd: string, args: string[]) => Promise<string>;
export interface Entrees {
  plateforme: NodeJS.Platform;
  /** les chemins à vérifier, par rôle (un rôle absent n'est pas vérifié) */
  chemins: Partial<Record<Role, string>>;
  lancer: Lanceur;
  /** Linux : ce que disent les deux détecteurs de conteneur (machines/admin.ts inContainer, tools/scripts.ts selfIdentity) */
  conteneur?: { inContainer: boolean; identite?: string };
  /** existe-t-il ? (pour remonter au premier dossier qui existe) */
  existe?: (p: string) => boolean;
  /** Windows : le vrai chemin d'un dossier qui existe, liens et jonctions résolus (par défaut fs.realpathSync.native) */
  reel?: (p: string) => string;
  /** Windows : l'identité du volume d'un dossier (par défaut fs.statSync(p).dev, le numéro de série du volume) */
  idVolume?: (p: string) => number | bigint | undefined;
}

async function essayer(lancer: Lanceur, cmd: string, args: string[]): Promise<{ sortie?: string; raison?: Raison }> {
  try { return { sortie: await lancer(cmd, args) }; } catch (e) { return { raison: (e as { code?: string })?.code === 'ENOENT' ? 'outil-absent' : 'illisible' }; }
}
const premierExistant = (p: string, existe: (p: string) => boolean, dirname: (p: string) => string = posix.dirname): string => {
  let x = p; for (let i = 0; i < 64 && !existe(x); i++) { const d = dirname(x); if (d === x) break; x = d; }
  return x;
};

/**
 * Windows : le vrai chemin d'un dossier d'Odin, pour que la lettre lue soit celle du volume qui le porte VRAIMENT.
 * Un lien ou une jonction est suivi ; un volume monté dans un dossier (sans lettre) a une autre identité que la racine
 * de sa lettre : il est rendu sans lettre (« je ne relie pas ce dossier »). Le doute rend aussi « sans lettre ».
 * Un chemin réseau n'est pas touché (un serveur absent ferait attendre).
 */
function cheminReelWindows(chemin: string, existe: (p: string) => boolean, reel: (p: string) => string, idVolume: (p: string) => number | bigint | undefined): string {
  if (!lettreDe(chemin)) return chemin;
  let r: string;
  try { r = reel(premierExistant(chemin, existe, win32.dirname)); } catch { return ''; }
  const L = lettreDe(r);
  if (!L) return r;
  let ici: number | bigint | undefined, racine: number | bigint | undefined;
  try { ici = idVolume(r); racine = idVolume(`${L}:\\`); } catch { return ''; }
  return ici !== undefined && racine !== undefined && ici === racine ? r : '';
}
const idVolumeParDefaut = (p: string) => statSync(p).dev;

/** Vérifie chaque volume qui porte les données d'Odin. Ne lance que des lectures (voir l'en-tête), ne bloque rien. */
export async function verifierDisqueOdin(e: Entrees): Promise<Bilan> {
  const roles = ROLES.filter((r) => e.chemins[r]).map((r) => [r, e.chemins[r] as string] as const);
  const existe = e.existe ?? existsSync;
  if (e.plateforme === 'win32') {
    const r = await essayer(e.lancer, 'powershell', [...ARGS_BITLOCKER]);
    const bl: SortieBitLocker = r.sortie !== undefined ? lireBitLocker(r.sortie) : { lecture: r.raison === 'outil-absent' ? 'outil-absent' : 'illisible', parLettre: {} };
    const reel = e.reel ?? ((p: string) => realpathSync.native(p));
    const idVolume = e.idVolume ?? idVolumeParDefaut;
    const volumes = roles.map(([role, chemin]) => volumeWindows(role, chemin, bl, cheminReelWindows(chemin, existe, reel, idVolume)));
    return { decision: decider(volumes), systeme: 'windows', volumes, ...(bl.edition ? { windowsFamille: windowsFamille(bl.edition) } : {}) };
  }
  if (e.plateforme === 'linux') {
    // Dans un conteneur, lsblk montrerait les disques de l'hôte : on ne lit rien, on le dit.
    if (e.conteneur?.inContainer || e.conteneur?.identite) {
      const volumes = roles.map(([role, chemin]): VolumeVu => ({ role, chemin, etat: 'inconnu', raison: 'conteneur' }));
      return { decision: 'conteneur', systeme: 'linux', volumes, ...(e.conteneur.identite ? { conteneur: e.conteneur.identite } : {}) };
    }
    const blk = await essayer(e.lancer, 'lsblk', ['-J', '-O']);
    const volumes: VolumeVu[] = [];
    for (const [role, chemin] of roles) {
      const ou = premierExistant(chemin, existe);
      const fm = await essayer(e.lancer, 'findmnt', ['-J', '-T', ou, '-o', 'SOURCE,TARGET,FSTYPE']);
      const m = fm.sortie !== undefined ? lireFindmnt(fm.sortie) : undefined;
      if (!m) { volumes.push({ role, chemin, etat: 'inconnu', raison: fm.raison ?? 'illisible' }); continue; }
      if (m.fstype === 'ecryptfs') { volumes.push({ role, chemin, volume: m.cible, etat: 'inconnu', raison: 'chiffrement-fichiers' }); continue; }
      if (!m.source.startsWith('/dev/')) { volumes.push({ role, chemin, volume: m.cible, etat: 'inconnu', raison: 'dossier-non-relie' }); continue; }
      if (blk.sortie === undefined) { volumes.push({ role, chemin, volume: m.source, etat: 'inconnu', raison: blk.raison ?? 'illisible' }); continue; }
      const lien = relierLsblk(blk.sortie, m.source);
      const at = await essayer(e.lancer, 'lsattr', ['-d', ou]);
      if (at.sortie !== undefined && chiffreParFichiers(at.sortie)) { volumes.push({ role, chemin, volume: m.source, etat: 'inconnu', raison: 'chiffrement-fichiers' }); continue; }
      volumes.push({ role, chemin, volume: m.source, ...lien });
    }
    return { decision: decider(volumes), systeme: 'linux', volumes };
  }
  if (e.plateforme === 'darwin') {
    const fd = await essayer(e.lancer, 'fdesetup', ['status']);
    const fv = fd.sortie !== undefined ? lireFdesetup(fd.sortie) : { etat: 'inconnu' as Etat, raison: fd.raison ?? 'illisible' };
    const volumes: VolumeVu[] = [];
    for (const [role, chemin] of roles) {
      const df = await essayer(e.lancer, 'df', ['-P', premierExistant(chemin, existe)]);
      const mp = df.sortie !== undefined ? pointDeMontageDf(df.sortie) : undefined;
      if (!mp) volumes.push({ role, chemin, etat: 'inconnu', raison: df.raison ?? 'illisible' });
      else if (!DEMARRAGE_MAC.has(mp)) volumes.push({ role, chemin, volume: mp, etat: 'inconnu', raison: 'hors-disque-demarrage' });
      else volumes.push({ role, chemin, volume: mp, ...fv });
    }
    return { decision: decider(volumes), systeme: 'macos', volumes };
  }
  const volumes = roles.map(([role, chemin]): VolumeVu => ({ role, chemin, etat: 'inconnu', raison: 'systeme-inconnu' }));
  return { decision: 'inconnu', systeme: 'autre', volumes };
}

// ---------------- Les phrases (toutes les langues écrites ici ; repli : anglais, puis français) ----------------
type Cle =
  | 'titre' | 'sep' | 'liste' | `decision.${Decision}` | `role.${Role}` | `raison.${Raison}`
  | 'guide.sauvegarde' | 'guide.cle' | 'guide.fin' | 'guide.ailleurs' | 'guide.en-cours'
  | 'guide.windows.droits' | 'guide.windows.outil' | 'guide.windows.suspendu' | 'guide.windows.en-pause' | 'guide.windows.activer'
  | 'guide.windows.microsoft' | 'guide.windows.famille' | 'guide.windows.famille-cle'
  | 'guide.linux.reinstaller' | 'guide.linux.fichiers' | 'guide.macos.activer' | 'guide.conteneur' | 'guide.autre';

const FR: Record<Cle, string> = {
  titre: 'Disque d\'Odin', sep: ' : ', liste: ', ',
  'decision.chiffre': 'chiffré', 'decision.pas-chiffre': 'pas chiffré', 'decision.inconnu': 'je ne peux pas le savoir',
  'decision.conteneur': 'je ne peux pas le savoir (Odin tourne dans un conteneur)',
  'role.dossier': 'dossier d\'Odin', 'role.cles': 'clé de la machine', 'role.application': 'application', 'role.sauvegardes': 'sauvegardes',
  'raison.bitlocker-protege': 'chiffré par BitLocker, protection active',
  'raison.bitlocker-suspendu': 'BitLocker en pause : la protection est suspendue, la clé est posée en clair sur le disque',
  'raison.bitlocker-en-cours': 'BitLocker en cours de chiffrement ou de déchiffrement',
  'raison.bitlocker-en-pause': 'BitLocker : chiffrement ou déchiffrement en pause',
  'raison.bitlocker-non-chiffre': 'pas chiffré',
  'raison.bitlocker-illisible': 'état BitLocker inconnu (volume verrouillé ?)',
  'raison.volume-absent': 'lecteur que BitLocker ne connaît pas',
  'raison.chemin-reseau': 'dossier sur le réseau : son disque est sur une autre machine',
  'raison.droits-manquants': 'lire BitLocker demande les droits d\'administrateur',
  'raison.outil-absent': 'l\'outil du système qui le dit est absent',
  'raison.illisible': 'réponse de l\'outil du système illisible',
  'raison.luks': 'chiffré (LUKS / dm-crypt)',
  'raison.sans-luks': 'pas chiffré (aucune couche LUKS / dm-crypt)',
  'raison.luks-partiel': 'chiffré en partie seulement',
  'raison.dossier-non-relie': 'je ne relie pas ce dossier à un disque que je vois en entier',
  'raison.chiffrement-fichiers': 'dossier chiffré fichier par fichier (fscrypt ou eCryptfs) ; le disque lui-même, je ne peux pas le savoir',
  'raison.filevault-actif': 'chiffré par FileVault',
  'raison.filevault-inactif': 'FileVault désactivé',
  'raison.filevault-en-cours': 'FileVault en cours de chiffrement ou de déchiffrement',
  'raison.hors-disque-demarrage': 'pas sur le disque de démarrage : FileVault ne le couvre pas',
  'raison.conteneur': 'le disque est celui de la machine hôte',
  'raison.systeme-inconnu': 'système que je ne sais pas encore vérifier',
  'guide.sauvegarde': 'Avant tout : une sauvegarde d\'Odin (« odin backup »), rangée hors de cette machine.',
  'guide.cle': 'Note la clé de récupération hors de la machine (imprimée, ou sur une clé USB rangée ailleurs). Sans elle, personne ne pourra récupérer le disque, ni toi ni Odin.',
  'guide.fin': 'Odin ne lance aucun chiffrement et ne lit jamais la clé : c\'est toi qui le fais, dans ta propre fenêtre. Puis relance « odin doctor ».',
  'guide.ailleurs': 'Une partie des données d\'Odin est sur un volume que je ne peux pas vérifier ({volumes}) : vérifie toi-même qu\'il est chiffré.',
  'guide.en-cours': 'Le chiffrement est en cours : laisse-le finir, secteur branché, puis relance « odin doctor ».',
  'guide.windows.droits': 'Pour lire l\'état de BitLocker, ouvre un terminal en administrateur et relance « odin doctor ».',
  'guide.windows.outil': 'Ce Windows ne donne pas l\'état de BitLocker (son composant de chiffrement ne répond pas) : regarde toi-même dans « Gérer BitLocker » (Panneau de configuration) si le disque est chiffré.',
  'guide.windows.en-pause': 'Le chiffrement (ou le déchiffrement) BitLocker est en pause sur {volumes} et ne reprendra pas seul : reprends-le toi-même, secteur branché, en administrateur, puis relance « odin doctor ».',
  'guide.windows.suspendu': 'Protection BitLocker suspendue sur {volumes} : reprends-la toi-même (« Gérer BitLocker » → « Reprendre la protection »).',
  'guide.windows.activer': 'Secteur branché, ouvre « Gérer BitLocker » (Panneau de configuration) et active BitLocker sur {volumes}.',
  'guide.windows.microsoft': 'Quand Windows propose d\'enregistrer la clé sur ton compte Microsoft, choisis une autre option : sur ce compte, la clé serait sur un serveur extérieur.',
  'guide.windows.famille': 'Cette édition de Windows (Famille) n\'a pas BitLocker. Son « chiffrement de l\'appareil » envoie la clé de récupération au compte Microsoft, un serveur extérieur : Odin ne te le conseille pas. BitLocker existe dans les éditions Professionnel, Entreprise et Éducation.',
  'guide.windows.famille-cle': 'Sur Windows Famille, ce chiffrement (« chiffrement de l\'appareil ») range d\'ordinaire sa clé de récupération sur le compte Microsoft, un serveur extérieur : garde aussi une copie de la clé hors de la machine (imprimée, ou sur une clé USB rangée ailleurs).',
  'guide.linux.reinstaller': 'Un Linux déjà installé ne se chiffre pas sur place sans risque : le plus sûr est de réinstaller le système en cochant le chiffrement du disque (LUKS) dans son installateur, puis de restaurer la sauvegarde d\'Odin.',
  'guide.linux.fichiers': 'Un dossier chiffré fichier par fichier ne protège pas tout le disque : vérifie que le disque lui-même est chiffré (LUKS).',
  'guide.macos.activer': 'Ouvre Réglages du système → Confidentialité et sécurité → FileVault → Activer. Choisis une clé de récupération, pas ton compte Apple (un serveur extérieur).',
  'guide.conteneur': 'Odin tourne dans un conteneur : son disque est celui de la machine hôte, et Odin ne peut pas le vérifier d\'ici. Vérifie sur l\'hôte que le stockage de ce conteneur est chiffré.',
  'guide.autre': 'Je ne sais pas encore vérifier ce système : chiffre le disque avec l\'outil du système.',
};

const EN: Record<Cle, string> = {
  titre: 'Odin\'s disk', sep: ': ', liste: ', ',
  'decision.chiffre': 'encrypted', 'decision.pas-chiffre': 'not encrypted', 'decision.inconnu': 'I can\'t tell',
  'decision.conteneur': 'I can\'t tell (Odin runs in a container)',
  'role.dossier': 'Odin\'s folder', 'role.cles': 'machine key', 'role.application': 'application', 'role.sauvegardes': 'backups',
  'raison.bitlocker-protege': 'encrypted by BitLocker, protection on',
  'raison.bitlocker-suspendu': 'BitLocker paused: protection is suspended, the key sits in clear on the disk',
  'raison.bitlocker-en-cours': 'BitLocker is encrypting or decrypting',
  'raison.bitlocker-en-pause': 'BitLocker: encryption or decryption paused',
  'raison.bitlocker-non-chiffre': 'not encrypted',
  'raison.bitlocker-illisible': 'BitLocker state unknown (volume locked?)',
  'raison.volume-absent': 'drive unknown to BitLocker',
  'raison.chemin-reseau': 'network folder: its disk is on another machine',
  'raison.droits-manquants': 'reading BitLocker needs administrator rights',
  'raison.outil-absent': 'the system tool that tells is missing',
  'raison.illisible': 'unreadable answer from the system tool',
  'raison.luks': 'encrypted (LUKS / dm-crypt)',
  'raison.sans-luks': 'not encrypted (no LUKS / dm-crypt layer)',
  'raison.luks-partiel': 'only partly encrypted',
  'raison.dossier-non-relie': 'I can\'t link this folder to a disk I fully see',
  'raison.chiffrement-fichiers': 'folder encrypted file by file (fscrypt or eCryptfs); the disk itself, I can\'t tell',
  'raison.filevault-actif': 'encrypted by FileVault',
  'raison.filevault-inactif': 'FileVault off',
  'raison.filevault-en-cours': 'FileVault is encrypting or decrypting',
  'raison.hors-disque-demarrage': 'not on the startup disk: FileVault does not cover it',
  'raison.conteneur': 'the disk belongs to the host machine',
  'raison.systeme-inconnu': 'a system I can\'t check yet',
  'guide.sauvegarde': 'First: a backup of Odin ("odin backup"), stored off this machine.',
  'guide.cle': 'Write the recovery key down off the machine (printed, or on a USB stick kept elsewhere). Without it, nobody can recover the disk, neither you nor Odin.',
  'guide.fin': 'Odin never starts encryption and never reads the key: you do it, in your own window. Then run "odin doctor" again.',
  'guide.ailleurs': 'Part of Odin\'s data is on a volume I can\'t check ({volumes}): check yourself that it is encrypted.',
  'guide.en-cours': 'Encryption is in progress: let it finish, plugged in, then run "odin doctor" again.',
  'guide.windows.droits': 'To read the BitLocker state, open a terminal as administrator and run "odin doctor" again.',
  'guide.windows.outil': 'This Windows does not give the BitLocker state (its encryption component does not answer): check yourself in "Manage BitLocker" (Control Panel) whether the disk is encrypted.',
  'guide.windows.en-pause': 'BitLocker encryption (or decryption) is paused on {volumes} and will not resume by itself: resume it yourself, plugged in, as administrator, then run "odin doctor" again.',
  'guide.windows.suspendu': 'BitLocker protection is suspended on {volumes}: resume it yourself ("Manage BitLocker" → "Resume protection").',
  'guide.windows.activer': 'Plugged in, open "Manage BitLocker" (Control Panel) and turn BitLocker on for {volumes}.',
  'guide.windows.microsoft': 'When Windows offers to save the key to your Microsoft account, pick another option: there, the key would be on an outside server.',
  'guide.windows.famille': 'This edition of Windows (Home) has no BitLocker. Its "device encryption" sends the recovery key to the Microsoft account, an outside server: Odin does not advise it. BitLocker comes with the Pro, Enterprise and Education editions.',
  'guide.windows.famille-cle': 'On Windows Home, this encryption ("device encryption") usually keeps its recovery key on the Microsoft account, an outside server: also keep a copy of the key off the machine (printed, or on a USB stick kept elsewhere).',
  'guide.linux.reinstaller': 'An installed Linux can\'t be encrypted in place without risk: the safest way is to reinstall the system with disk encryption (LUKS) ticked in its installer, then restore Odin\'s backup.',
  'guide.linux.fichiers': 'A folder encrypted file by file does not protect the whole disk: check that the disk itself is encrypted (LUKS).',
  'guide.macos.activer': 'Open System Settings → Privacy & Security → FileVault → Turn On. Choose a recovery key, not your Apple account (an outside server).',
  'guide.conteneur': 'Odin runs in a container: its disk is the host\'s, and Odin can\'t check it from here. Check on the host that this container\'s storage is encrypted.',
  'guide.autre': 'I can\'t check this system yet: encrypt the disk with the system\'s own tool.',
};

const DE: Record<Cle, string> = {
  titre: 'Odins Laufwerk', sep: ': ', liste: ', ',
  'decision.chiffre': 'verschlüsselt', 'decision.pas-chiffre': 'nicht verschlüsselt', 'decision.inconnu': 'das kann ich nicht wissen',
  'decision.conteneur': 'das kann ich nicht wissen (Odin läuft in einem Container)',
  'role.dossier': 'Odins Ordner', 'role.cles': 'Schlüssel des Rechners', 'role.application': 'Anwendung', 'role.sauvegardes': 'Sicherungen',
  'raison.bitlocker-protege': 'mit BitLocker verschlüsselt, Schutz aktiv',
  'raison.bitlocker-suspendu': 'BitLocker angehalten: der Schutz ist ausgesetzt, der Schlüssel liegt unverschlüsselt auf dem Laufwerk',
  'raison.bitlocker-en-cours': 'BitLocker ver- oder entschlüsselt gerade',
  'raison.bitlocker-en-pause': 'BitLocker: Ver- oder Entschlüsselung angehalten',
  'raison.bitlocker-non-chiffre': 'nicht verschlüsselt',
  'raison.bitlocker-illisible': 'BitLocker-Zustand unbekannt (Volume gesperrt?)',
  'raison.volume-absent': 'Laufwerk, das BitLocker nicht kennt',
  'raison.chemin-reseau': 'Netzwerkordner: sein Laufwerk ist auf einem anderen Rechner',
  'raison.droits-manquants': 'BitLocker zu lesen braucht Administratorrechte',
  'raison.outil-absent': 'das Systemwerkzeug, das es sagt, fehlt',
  'raison.illisible': 'unlesbare Antwort des Systemwerkzeugs',
  'raison.luks': 'verschlüsselt (LUKS / dm-crypt)',
  'raison.sans-luks': 'nicht verschlüsselt (keine LUKS-/dm-crypt-Schicht)',
  'raison.luks-partiel': 'nur teilweise verschlüsselt',
  'raison.dossier-non-relie': 'ich kann diesen Ordner keinem Laufwerk zuordnen, das ich ganz sehe',
  'raison.chiffrement-fichiers': 'Ordner Datei für Datei verschlüsselt (fscrypt oder eCryptfs); das Laufwerk selbst kann ich nicht beurteilen',
  'raison.filevault-actif': 'mit FileVault verschlüsselt',
  'raison.filevault-inactif': 'FileVault aus',
  'raison.filevault-en-cours': 'FileVault ver- oder entschlüsselt gerade',
  'raison.hors-disque-demarrage': 'nicht auf dem Startvolume: FileVault deckt es nicht ab',
  'raison.conteneur': 'das Laufwerk gehört dem Host-Rechner',
  'raison.systeme-inconnu': 'ein System, das ich noch nicht prüfen kann',
  'guide.sauvegarde': 'Zuerst: eine Sicherung von Odin („odin backup“), außerhalb dieses Rechners aufbewahrt.',
  'guide.cle': 'Bewahre den Wiederherstellungsschlüssel außerhalb des Rechners auf (ausgedruckt oder auf einem USB-Stick an einem anderen Ort). Ohne ihn kann niemand das Laufwerk wiederherstellen, weder du noch Odin.',
  'guide.fin': 'Odin startet nie eine Verschlüsselung und liest nie den Schlüssel: das machst du, in deinem eigenen Fenster. Danach „odin doctor“ erneut ausführen.',
  'guide.ailleurs': 'Ein Teil von Odins Daten liegt auf einem Volume, das ich nicht prüfen kann ({volumes}): prüfe selbst, ob es verschlüsselt ist.',
  'guide.en-cours': 'Die Verschlüsselung läuft: lass sie mit Netzteil zu Ende laufen, dann „odin doctor“ erneut ausführen.',
  'guide.windows.droits': 'Um den BitLocker-Zustand zu lesen, öffne ein Terminal als Administrator und führe „odin doctor“ erneut aus.',
  'guide.windows.outil': 'Dieses Windows gibt den BitLocker-Zustand nicht an (seine Verschlüsselungskomponente antwortet nicht): prüfe selbst unter „BitLocker verwalten“ (Systemsteuerung), ob das Laufwerk verschlüsselt ist.',
  'guide.windows.en-pause': 'Die BitLocker-Verschlüsselung (oder Entschlüsselung) ist auf {volumes} angehalten und setzt nicht von selbst fort: setze sie selbst fort, mit Netzteil, als Administrator, dann „odin doctor“ erneut ausführen.',
  'guide.windows.suspendu': 'BitLocker-Schutz auf {volumes} ausgesetzt: setze ihn selbst fort („BitLocker verwalten“ → „Schutz fortsetzen“).',
  'guide.windows.activer': 'Mit Netzteil „BitLocker verwalten“ (Systemsteuerung) öffnen und BitLocker für {volumes} aktivieren.',
  'guide.windows.microsoft': 'Wenn Windows anbietet, den Schlüssel in deinem Microsoft-Konto zu speichern, wähle eine andere Option: dort läge der Schlüssel auf einem fremden Server.',
  'guide.windows.famille': 'Diese Windows-Edition (Home) hat kein BitLocker. Ihre „Geräteverschlüsselung“ schickt den Wiederherstellungsschlüssel an das Microsoft-Konto, einen fremden Server: Odin rät nicht dazu. BitLocker gibt es in den Editionen Pro, Enterprise und Education.',
  'guide.windows.famille-cle': 'Unter Windows Home legt diese Verschlüsselung („Geräteverschlüsselung“) ihren Wiederherstellungsschlüssel meist im Microsoft-Konto ab, einem fremden Server: bewahre auch eine Kopie des Schlüssels außerhalb des Rechners auf (ausgedruckt oder auf einem USB-Stick an einem anderen Ort).',
  'guide.linux.reinstaller': 'Ein installiertes Linux lässt sich nicht ohne Risiko an Ort und Stelle verschlüsseln: am sichersten ist es, das System mit aktivierter Laufwerksverschlüsselung (LUKS) neu zu installieren und dann Odins Sicherung wiederherzustellen.',
  'guide.linux.fichiers': 'Ein Datei für Datei verschlüsselter Ordner schützt nicht das ganze Laufwerk: prüfe, ob das Laufwerk selbst verschlüsselt ist (LUKS).',
  'guide.macos.activer': 'Öffne Systemeinstellungen → Datenschutz & Sicherheit → FileVault → Einschalten. Wähle einen Wiederherstellungsschlüssel, nicht dein Apple-Konto (ein fremder Server).',
  'guide.conteneur': 'Odin läuft in einem Container: sein Laufwerk ist das des Hosts, und Odin kann es von hier nicht prüfen. Prüfe auf dem Host, ob der Speicher dieses Containers verschlüsselt ist.',
  'guide.autre': 'Dieses System kann ich noch nicht prüfen: verschlüssle das Laufwerk mit dem Werkzeug des Systems.',
};

const ES: Record<Cle, string> = {
  titre: 'Disco de Odin', sep: ': ', liste: ', ',
  'decision.chiffre': 'cifrado', 'decision.pas-chiffre': 'sin cifrar', 'decision.inconnu': 'no puedo saberlo',
  'decision.conteneur': 'no puedo saberlo (Odin funciona en un contenedor)',
  'role.dossier': 'carpeta de Odin', 'role.cles': 'clave de la máquina', 'role.application': 'aplicación', 'role.sauvegardes': 'copias de seguridad',
  'raison.bitlocker-protege': 'cifrado con BitLocker, protección activa',
  'raison.bitlocker-suspendu': 'BitLocker en pausa: la protección está suspendida, la clave está sin cifrar en el disco',
  'raison.bitlocker-en-cours': 'BitLocker está cifrando o descifrando',
  'raison.bitlocker-en-pause': 'BitLocker: cifrado o descifrado en pausa',
  'raison.bitlocker-non-chiffre': 'sin cifrar',
  'raison.bitlocker-illisible': 'estado de BitLocker desconocido (¿volumen bloqueado?)',
  'raison.volume-absent': 'unidad que BitLocker no conoce',
  'raison.chemin-reseau': 'carpeta de red: su disco está en otra máquina',
  'raison.droits-manquants': 'leer BitLocker requiere derechos de administrador',
  'raison.outil-absent': 'falta la herramienta del sistema que lo indica',
  'raison.illisible': 'respuesta ilegible de la herramienta del sistema',
  'raison.luks': 'cifrado (LUKS / dm-crypt)',
  'raison.sans-luks': 'sin cifrar (ninguna capa LUKS / dm-crypt)',
  'raison.luks-partiel': 'cifrado solo en parte',
  'raison.dossier-non-relie': 'no puedo relacionar esta carpeta con un disco que vea entero',
  'raison.chiffrement-fichiers': 'carpeta cifrada archivo por archivo (fscrypt o eCryptfs); el disco en sí, no puedo saberlo',
  'raison.filevault-actif': 'cifrado con FileVault',
  'raison.filevault-inactif': 'FileVault desactivado',
  'raison.filevault-en-cours': 'FileVault está cifrando o descifrando',
  'raison.hors-disque-demarrage': 'no está en el disco de arranque: FileVault no lo cubre',
  'raison.conteneur': 'el disco es el de la máquina anfitriona',
  'raison.systeme-inconnu': 'un sistema que aún no sé comprobar',
  'guide.sauvegarde': 'Antes que nada: una copia de seguridad de Odin («odin backup»), guardada fuera de esta máquina.',
  'guide.cle': 'Guarda la clave de recuperación fuera de la máquina (impresa, o en una memoria USB guardada en otro sitio). Sin ella, nadie podrá recuperar el disco, ni tú ni Odin.',
  'guide.fin': 'Odin nunca inicia un cifrado y nunca lee la clave: lo haces tú, en tu propia ventana. Después vuelve a ejecutar «odin doctor».',
  'guide.ailleurs': 'Parte de los datos de Odin está en un volumen que no puedo comprobar ({volumes}): comprueba tú que esté cifrado.',
  'guide.en-cours': 'El cifrado está en curso: déjalo terminar, con el cargador enchufado, y vuelve a ejecutar «odin doctor».',
  'guide.windows.droits': 'Para leer el estado de BitLocker, abre un terminal como administrador y vuelve a ejecutar «odin doctor».',
  'guide.windows.outil': 'Este Windows no da el estado de BitLocker (su componente de cifrado no responde): comprueba tú en «Administrar BitLocker» (Panel de control) si el disco está cifrado.',
  'guide.windows.en-pause': 'El cifrado (o descifrado) de BitLocker está en pausa en {volumes} y no se reanudará solo: reanúdalo tú, con el cargador enchufado, como administrador, y vuelve a ejecutar «odin doctor».',
  'guide.windows.suspendu': 'Protección de BitLocker suspendida en {volumes}: reanúdala tú («Administrar BitLocker» → «Reanudar la protección»).',
  'guide.windows.activer': 'Con el cargador enchufado, abre «Administrar BitLocker» (Panel de control) y activa BitLocker en {volumes}.',
  'guide.windows.microsoft': 'Cuando Windows proponga guardar la clave en tu cuenta Microsoft, elige otra opción: ahí la clave estaría en un servidor externo.',
  'guide.windows.famille': 'Esta edición de Windows (Home) no tiene BitLocker. Su «cifrado del dispositivo» envía la clave de recuperación a la cuenta Microsoft, un servidor externo: Odin no lo aconseja. BitLocker viene con las ediciones Pro, Enterprise y Education.',
  'guide.windows.famille-cle': 'En Windows Home, este cifrado («cifrado del dispositivo») suele guardar su clave de recuperación en la cuenta Microsoft, un servidor externo: guarda también una copia de la clave fuera de la máquina (impresa, o en una memoria USB guardada en otro sitio).',
  'guide.linux.reinstaller': 'Un Linux ya instalado no se cifra en el sitio sin riesgo: lo más seguro es reinstalar el sistema marcando el cifrado del disco (LUKS) en su instalador, y luego restaurar la copia de Odin.',
  'guide.linux.fichiers': 'Una carpeta cifrada archivo por archivo no protege todo el disco: comprueba que el disco en sí esté cifrado (LUKS).',
  'guide.macos.activer': 'Abre Ajustes del Sistema → Privacidad y seguridad → FileVault → Activar. Elige una clave de recuperación, no tu cuenta de Apple (un servidor externo).',
  'guide.conteneur': 'Odin funciona en un contenedor: su disco es el del anfitrión, y Odin no puede comprobarlo desde aquí. Comprueba en el anfitrión que el almacenamiento de este contenedor esté cifrado.',
  'guide.autre': 'Aún no sé comprobar este sistema: cifra el disco con la herramienta del propio sistema.',
};

const JA: Record<Cle, string> = {
  titre: 'Odin のディスク', sep: '：', liste: '、',
  'decision.chiffre': '暗号化済み', 'decision.pas-chiffre': '暗号化されていません', 'decision.inconnu': '確認できません',
  'decision.conteneur': '確認できません（Odin はコンテナー内で動いています）',
  'role.dossier': 'Odin のフォルダー', 'role.cles': 'マシンの鍵', 'role.application': 'アプリケーション', 'role.sauvegardes': 'バックアップ',
  'raison.bitlocker-protege': 'BitLocker で暗号化済み、保護は有効',
  'raison.bitlocker-suspendu': 'BitLocker が一時停止中：保護が中断され、鍵が暗号化されずにディスク上にあります',
  'raison.bitlocker-en-cours': 'BitLocker が暗号化または復号の途中です',
  'raison.bitlocker-en-pause': 'BitLocker：暗号化または復号が一時停止中',
  'raison.bitlocker-non-chiffre': '暗号化されていません',
  'raison.bitlocker-illisible': 'BitLocker の状態が不明（ボリュームがロック中？）',
  'raison.volume-absent': 'BitLocker が知らないドライブ',
  'raison.chemin-reseau': 'ネットワーク上のフォルダー：ディスクは別のマシンにあります',
  'raison.droits-manquants': 'BitLocker を読むには管理者権限が必要です',
  'raison.outil-absent': 'それを示すシステムのツールがありません',
  'raison.illisible': 'システムのツールの応答が読めません',
  'raison.luks': '暗号化済み（LUKS / dm-crypt）',
  'raison.sans-luks': '暗号化されていません（LUKS / dm-crypt の層なし）',
  'raison.luks-partiel': '一部だけ暗号化されています',
  'raison.dossier-non-relie': 'このフォルダーを、全体が見えるディスクに結びつけられません',
  'raison.chiffrement-fichiers': 'ファイル単位で暗号化されたフォルダー（fscrypt または eCryptfs）。ディスク自体は確認できません',
  'raison.filevault-actif': 'FileVault で暗号化済み',
  'raison.filevault-inactif': 'FileVault はオフ',
  'raison.filevault-en-cours': 'FileVault が暗号化または復号の途中です',
  'raison.hors-disque-demarrage': '起動ディスク上にありません：FileVault の対象外です',
  'raison.conteneur': 'ディスクはホストマシンのものです',
  'raison.systeme-inconnu': 'まだ確認できないシステムです',
  'guide.sauvegarde': 'まず：Odin のバックアップ（「odin backup」）を作り、このマシンの外に保管してください。',
  'guide.cle': '回復キーはマシンの外に控えてください（印刷する、または別の場所に置いた USB メモリーに保存）。それがなければ、あなたも Odin も、誰もディスクを復旧できません。',
  'guide.fin': 'Odin は暗号化を開始せず、鍵を読むこともありません。あなた自身のウィンドウで、あなたが行います。その後「odin doctor」をもう一度実行してください。',
  'guide.ailleurs': 'Odin のデータの一部が確認できないボリューム（{volumes}）にあります：暗号化されているかご自身で確認してください。',
  'guide.en-cours': '暗号化の途中です：電源につないだまま終わるのを待ち、「odin doctor」をもう一度実行してください。',
  'guide.windows.droits': 'BitLocker の状態を読むには、管理者としてターミナルを開き、「odin doctor」をもう一度実行してください。',
  'guide.windows.outil': 'この Windows は BitLocker の状態を返しません（暗号化のコンポーネントが応答しません）：ディスクが暗号化されているか、「BitLocker の管理」（コントロール パネル）でご自身で確認してください。',
  'guide.windows.en-pause': '{volumes} の BitLocker の暗号化（または復号）は一時停止中で、自動では再開しません：電源につないだまま、管理者としてご自身で再開し、「odin doctor」をもう一度実行してください。',
  'guide.windows.suspendu': '{volumes} の BitLocker 保護が中断されています：ご自身で再開してください（「BitLocker の管理」→「保護の再開」）。',
  'guide.windows.activer': '電源につないで「BitLocker の管理」（コントロール パネル）を開き、{volumes} で BitLocker を有効にしてください。',
  'guide.windows.microsoft': 'Windows が回復キーを Microsoft アカウントに保存するよう勧めたら、別の方法を選んでください：そこでは鍵が外部のサーバーに置かれます。',
  'guide.windows.famille': 'この Windows のエディション（Home）には BitLocker がありません。その「デバイスの暗号化」は回復キーを外部のサーバーである Microsoft アカウントに送るため、Odin は勧めません。BitLocker は Pro、Enterprise、Education の各エディションにあります。',
  'guide.windows.famille-cle': 'Windows Home では、この暗号化（「デバイスの暗号化」）は通常、回復キーを外部のサーバーである Microsoft アカウントに保管します：鍵の控えもマシンの外に保管してください（印刷する、または別の場所に置いた USB メモリーに保存）。',
  'guide.linux.reinstaller': 'インストール済みの Linux をその場で暗号化するのは危険です：最も安全なのは、インストーラーでディスクの暗号化（LUKS）を選んでシステムを入れ直し、Odin のバックアップを復元することです。',
  'guide.linux.fichiers': 'ファイル単位で暗号化されたフォルダーはディスク全体を守りません：ディスク自体が暗号化されているか（LUKS）確認してください。',
  'guide.macos.activer': 'システム設定 → プライバシーとセキュリティ → FileVault → オンにする を開いてください。Apple アカウント（外部のサーバー）ではなく、回復キーを選んでください。',
  'guide.conteneur': 'Odin はコンテナー内で動いています：ディスクはホストのもので、Odin はここから確認できません。このコンテナーのストレージが暗号化されているか、ホスト側で確認してください。',
  'guide.autre': 'このシステムはまだ確認できません：システム自身のツールでディスクを暗号化してください。',
};

export const TEXTES: Record<string, Record<Cle, string>> = { fr: FR, en: EN, de: DE, es: ES, ja: JA };
export const LANGUES_ECRITES = Object.keys(TEXTES);

/** Le code court d'une langue (« fr-FR » → « fr »). Pur. */
const codeDe = (langue: string | undefined) => (langue ?? '').toLowerCase().replace(/[-_].*$/, '');
/** Une phrase dans la langue donnée si elle est écrite, sinon en anglais, sinon en français (comme langue/pas-entraine.ts). Pur. */
export function phrase(cle: Cle, langue?: string, params: Record<string, string> = {}): string {
  const c = codeDe(langue);
  const essais = c ? [c, 'en', 'fr'] : ['fr', 'en'];
  for (const l of essais) { const t = TEXTES[l]?.[cle]; if (t) return t.replace(/\{(\w+)\}/g, (_m, k: string) => params[k] ?? ''); }
  return cle;
}

/** Ce que doctor affiche : le symbole, la ligne, le détail par volume et, si ce n'est pas « chiffré », le pas-à-pas. Pur. */
export function rendre(b: Bilan, langue?: string): { symbole: '✓' | '✗' | '?'; ligne: string; details: string[]; guide: string[] } {
  const t = (k: Cle, p?: Record<string, string>) => phrase(k, langue, p);
  const symbole = b.decision === 'chiffre' ? '✓' : b.decision === 'pas-chiffre' ? '✗' : '?';
  // Un détail par volume et par raison, avec les rôles qu'il porte.
  const groupes = new Map<string, { volume?: string; raison: Raison; roles: Role[] }>();
  for (const v of b.volumes) {
    const k = `${v.volume ?? ''}|${v.raison}`;
    const g = groupes.get(k) ?? { volume: v.volume, raison: v.raison, roles: [] };
    if (!g.roles.includes(v.role)) g.roles.push(v.role);
    groupes.set(k, g);
  }
  const details = [...groupes.values()].map((g) => `${g.volume ? `${g.volume} — ` : ''}${g.roles.map((r) => t(`role.${r}`)).join(t('liste'))}${t('sep')}${t(`raison.${g.raison}`)}`);
  const guide: string[] = [];
  // Windows Famille déjà chiffrée : la clé de récupération est d'ordinaire sur le compte Microsoft ; on le dit.
  if (b.decision === 'chiffre' && b.systeme === 'windows' && b.windowsFamille) guide.push(t('guide.windows.famille-cle'));
  if (b.decision !== 'chiffre') {
    const avec = (...rs: Raison[]) => b.volumes.filter((v) => rs.includes(v.raison));
    const noms = (vs: VolumeVu[]) => [...new Set(vs.map((v) => v.volume ?? v.chemin))].join(t('liste'));
    // La phrase de fin (« c'est toi qui le fais ») ne vient que si la personne a quelque chose à faire sur le chiffrement.
    let aFaire = false;
    const aChiffrer = avec('bitlocker-non-chiffre', 'sans-luks', 'luks-partiel', 'filevault-inactif');
    // Sous Windows, un outil absent ou une lecture refusée a sa ligne (les droits) ; ailleurs, c'est un volume non vérifié.
    const ailleurs = avec('volume-absent', 'chemin-reseau', 'dossier-non-relie', 'hors-disque-demarrage', ...(b.systeme === 'windows' ? [] : ['outil-absent', 'illisible'] as Raison[]));
    if (b.decision === 'conteneur') guide.push(t('guide.conteneur'));
    else if (b.systeme === 'windows') {
      // Les droits d'administrateur aident quand la lecture est refusée ; pas quand l'outil manque (rien ne le dirait mieux).
      if (avec('droits-manquants', 'illisible', 'bitlocker-illisible').length) guide.push(t('guide.windows.droits'));
      if (avec('outil-absent').length && !b.windowsFamille) guide.push(t('guide.windows.outil'));
      if (avec('bitlocker-suspendu').length) { guide.push(t('guide.windows.suspendu', { volumes: noms(avec('bitlocker-suspendu')) })); aFaire = true; }
      if (avec('bitlocker-en-pause').length) { guide.push(t('guide.windows.en-pause', { volumes: noms(avec('bitlocker-en-pause')) })); aFaire = true; }
      if (b.windowsFamille) guide.push(t('guide.windows.famille'));
      else if (aChiffrer.length) { guide.push(t('guide.sauvegarde'), t('guide.windows.activer', { volumes: noms(aChiffrer) }), t('guide.windows.microsoft'), t('guide.cle')); aFaire = true; }
    } else if (b.systeme === 'linux') {
      if (avec('chiffrement-fichiers').length) guide.push(t('guide.linux.fichiers'));
      if (aChiffrer.length) { guide.push(t('guide.sauvegarde'), t('guide.linux.reinstaller'), t('guide.cle')); aFaire = true; }
    } else if (b.systeme === 'macos') {
      if (aChiffrer.length) { guide.push(t('guide.sauvegarde'), t('guide.macos.activer'), t('guide.cle')); aFaire = true; }
    } else guide.push(t('guide.autre'));
    if (avec('bitlocker-en-cours', 'filevault-en-cours').length) guide.push(t('guide.en-cours'));
    if (ailleurs.length) guide.push(t('guide.ailleurs', { volumes: noms(ailleurs) }));
    if (aFaire) guide.push(t('guide.fin'));
  }
  return { symbole, ligne: `${t('titre')}${t('sep')}${t(`decision.${b.decision}`)}`, details, guide };
}

// ---------------- Mise en page dans le terminal ----------------
/** La largeur d'un caractère à l'écran : 2 pour les caractères larges (chinois, japonais, coréen, pleine chasse). Pur. */
const largeurCar = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
};
/** La largeur d'un texte à l'écran. Pur. */
export const largeur = (texte: string): number => { let n = 0; for (const ch of texte) n += largeurCar(ch); return n; };

/**
 * Coupe un texte en lignes d'au plus `max` colonnes, aux espaces ; un mot plus long que la ligne (une phrase japonaise,
 * sans espaces) est coupé entre deux caractères. Pur.
 */
export function couper(texte: string, max: number): string[] {
  const m = Math.max(10, Math.floor(max) || 80);
  const lignes: string[] = [];
  let ligne = '', l = 0;
  const pousser = () => { const x = ligne.trimEnd(); if (x) lignes.push(x); ligne = ''; l = 0; };
  for (const mot of texte.split(/\s+/)) {
    if (!mot) continue;
    const w = largeur(mot);
    const espace = l > 0 ? 1 : 0;
    if (l + espace + w <= m) { ligne += (espace ? ' ' : '') + mot; l += espace + w; continue; }
    if (w <= m) { pousser(); ligne = mot; l = w; continue; }
    if (espace && l + 1 < m) { ligne += ' '; l += 1; } else if (l) pousser();
    for (const ch of mot) { const c = largeurCar(ch); if (l + c > m) pousser(); ligne += ch; l += c; }
  }
  pousser();
  return lignes.length ? lignes : [''];
}
