// Phénix · l'image disque complète d'un poste : tout le disque (table des partitions, chargeur de démarrage, système),
// pour le remettre tel quel sur un disque neuf.
//
// Le disque est lu par morceaux, en flux, depuis le poste (SSH) ; Odin range chaque morceau comme le reste de Phénix :
// compressé, chiffré, dédupliqué (une image refaite ne coûte que ce qui a changé), copié et vérifié sur la destination
// du plan, avec rotation. L'image est relue (empreinte de chaque pièce) aussitôt rangée.
//
// - Linux : le début et la fin du disque (tables GPT / MBR, chargeur), puis chaque partition : partclone si présent et
//   la partition n'est pas montée (seuls les blocs utilisés), sinon dd ; la mémoire d'échange n'est pas copiée.
// - Windows : instantané VSS de chaque volume (C:…) lu en brut (rien d'ouvert ne gêne), les autres partitions (EFI,
//   récupération) lues en brut sur le disque physique.
// - macOS : hdiutil (image .dmg du disque) remise ensuite par asr ; sinon dd du disque brut.
// Remettre une image (action grave) écrit sur un disque d'un poste Linux (un PC démarré sur Genèse, par exemple) :
// jamais sur le disque du système qui tourne, jamais sur un disque plus petit ; chaque pièce brute est relue ensuite.
//
// Ce fichier n'importe pas Phénix (../modules/sindri.ts) au chargement : il le charge au moment de s'en servir.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { askpassScript, findMachine, remoteCommand, sshArgs, type Machine } from '../../machines/access.ts';
import { commandeSsh, PS_SORTIR } from '../../machines/windows.ts';
import type { Action, ModCtx } from '../types.ts';
import type { FileEntry, Plan, Snapshot } from '../modules/sindri.ts';

const MORCEAU = 1024 * 1024, MIO = 1024 * 1024;
const phenix = () => import('../modules/sindri.ts');
const s = (v: unknown) => String(v ?? '');

export type SystemeImage = 'linux' | 'windows' | 'mac';
export type FormatPiece = 'brut' | 'partclone' | 'dmg' | 'vide';
export interface Piece {
  nom: string; format: FormatPiece; offset: number; taille: number;
  /** numéro de la partition (partclone, vide) */ numero?: number; fs?: string;
  /** Windows : volume lu par un instantané VSS (lettre) */ vss?: string;
  /** après rangement : octets lus et empreinte SHA-256 */ octets?: number; sha256?: string;
}
export interface InfoImage { poste: string; systeme: SystemeImage; disque: string; taille: number; pieces: Piece[]; notes?: string[] }
export interface PartitionVue { chemin: string; numero: number; offset: number; taille: number; fs: string; monte: boolean; lettre?: string }
export interface Disposition { disque: string; taille: number; partitions: PartitionVue[]; partclone: string[]; hdiutil?: boolean }

// ---------------- Lire le disque du poste ----------------
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
const DISQUE = /^\/dev\/[A-Za-z0-9/_-]{1,40}$/;
/** Le script qui décrit le disque (vide : celui du système). Pur. */
export function scriptSonde(systeme: SystemeImage, disque = ''): string {
  if (disque && systeme !== 'windows' && !DISQUE.test(disque)) throw new Error('disque invalide (ex. /dev/sda)');
  if (systeme === 'windows') {
    if (disque && !/^\d{1,2}$/.test(disque.replace(/^\\\\\.\\PhysicalDrive/i, ''))) throw new Error('disque Windows invalide (numéro du disque, ex. 0)');
    const n = disque.replace(/^\\\\\.\\PhysicalDrive/i, '');
    return [PS_SORTIR, '$ErrorActionPreference = \'Stop\'',
      n ? `$n = ${Number(n)}` : '$n = (Get-Partition -DriveLetter ($env:SystemDrive.Substring(0, 1))).DiskNumber',
      '$k = Get-Disk -Number $n',
      '$p = @(Get-Partition -DiskNumber $n | ForEach-Object { $l = \'\'; if ([string]$_.DriveLetter -match \'^[A-Za-z]$\') { $l = [string]$_.DriveLetter }; @{ numero = [int]$_.PartitionNumber; offset = [long]$_.Offset; taille = [long]$_.Size; lettre = $l; fs = [string]$_.Type } })',
      'Sortir @{ ok = $true; disque = (\'\\\\.\\PhysicalDrive\' + $n); taille = [long]$k.Size; partitions = $p }'].join('\n');
  }
  if (systeme === 'mac') {
    return [`d=${disque ? q(disque) : '"/dev/$(diskutil info / | awk \'/Part of Whole/{print $NF}\')"'}`,
      'echo "disque $d $(diskutil info "$d" | awk -F\'[()]\' \'/Disk Size/{print $2}\' | awk \'{print $1}\')"',
      'command -v hdiutil >/dev/null 2>&1 && echo hdiutil'].join('\n');
  }
  return [
    disque ? `d=${q(disque)}` : 'd=$(lsblk -nsro NAME,TYPE "$(findmnt -no SOURCE /)" | awk \'$2=="disk"{print "/dev/"$1; exit}\')',
    '[ -b "$d" ] || { echo "erreur disque introuvable : $d"; exit 3; }',
    'n=$(basename "$d"); echo "disque $d $(sudo blockdev --getsize64 "$d")"',
    'for p in /sys/block/$n/$n*; do [ -e "$p/partition" ] || continue; b=$(basename "$p"); fs=$(lsblk -no FSTYPE "/dev/$b" | head -n1); m=$(lsblk -no MOUNTPOINT "/dev/$b" | head -n1); [ -n "$fs" ] || fs=-; [ -n "$m" ] || m=-; echo "partition /dev/$b $(cat $p/partition) $(( $(cat $p/start) * 512 )) $(( $(cat $p/size) * 512 )) $fs $m"; done',
    'for x in ext2 ext3 ext4 xfs btrfs ntfs fat16 fat32 vfat exfat f2fs; do command -v partclone.$x >/dev/null 2>&1 && echo "partclone $x"; done',
  ].join('\n');
}
/** La réponse de la sonde, comprise. Pur. */
export function lireDisposition(systeme: SystemeImage, out: string): Disposition {
  if (systeme === 'windows') {
    const l = out.trim().split(/\r?\n/).reverse().find((x) => x.trim().startsWith('{'));
    const j = l ? JSON.parse(l) as { ok?: boolean; disque: string; taille: number; partitions: Array<{ numero: number; offset: number; taille: number; lettre: string; fs: string }> | { numero: number } } : undefined;
    if (!j?.ok) throw new Error(`disque illisible : ${out.trim().split('\n').at(-1)?.slice(0, 200) ?? ''}`);
    const parts = (Array.isArray(j.partitions) ? j.partitions : j.partitions ? [j.partitions] : []) as Array<{ numero: number; offset: number; taille: number; lettre: string; fs: string }>;
    return { disque: j.disque, taille: Number(j.taille), partclone: [], partitions: parts.map((p) => ({ chemin: `${j.disque}#${p.numero}`, numero: Number(p.numero), offset: Number(p.offset), taille: Number(p.taille), fs: s(p.fs), monte: Boolean(p.lettre), ...(p.lettre ? { lettre: p.lettre.toUpperCase() } : {}) })).sort((a, b) => a.offset - b.offset) };
  }
  const d: Disposition = { disque: '', taille: 0, partitions: [], partclone: [] };
  for (const l of out.split(/\r?\n/)) {
    const m = l.trim().split(/\s+/);
    if (m[0] === 'erreur') throw new Error(l.trim().slice(7));
    if (m[0] === 'disque' && DISQUE.test(m[1] ?? '')) { d.disque = m[1]; d.taille = Number(m[2]); }
    if (m[0] === 'partition' && DISQUE.test(m[1] ?? '')) d.partitions.push({ chemin: m[1], numero: Number(m[2]), offset: Number(m[3]), taille: Number(m[4]), fs: m[5] === '-' ? '' : m[5], monte: Boolean(m[6] && m[6] !== '-') });
    if (m[0] === 'partclone' && /^[a-z0-9]+$/.test(m[1] ?? '')) d.partclone.push(m[1]);
    if (m[0] === 'hdiutil') d.hdiutil = true;
  }
  if (!d.disque || !(d.taille > 0)) throw new Error('disque illisible (taille inconnue)');
  d.partitions.sort((a, b) => a.offset - b.offset);
  return d;
}
const fsPartclone = (fs: string) => (fs === 'vfat' ? 'vfat' : fs);
/** Les pièces de l'image : début et fin du disque, puis chaque partition (format choisi). Pur. */
export function planifier(systeme: SystemeImage, d: Disposition): Piece[] {
  if (systeme === 'mac') return [{ nom: 'disque', format: d.hdiutil ? 'dmg' : 'brut', offset: 0, taille: d.taille }];
  if (!d.partitions.length) return [{ nom: 'disque', format: 'brut', offset: 0, taille: d.taille }];
  const premier = d.partitions[0].offset, fin = Math.max(0, d.taille - MIO), pieces: Piece[] = [];
  pieces.push({ nom: 'debut', format: 'brut', offset: 0, taille: Math.min(Math.max(premier, MIO), 64 * MIO, d.taille) });
  if (d.taille > 2 * MIO) pieces.push({ nom: 'fin', format: 'brut', offset: fin, taille: d.taille - fin });
  for (const p of d.partitions) {
    const base = { nom: `partition-${p.numero}`, offset: p.offset, taille: p.taille, numero: p.numero, ...(p.fs ? { fs: p.fs } : {}) };
    if (systeme === 'windows') pieces.push({ ...base, format: 'brut', ...(p.lettre ? { vss: p.lettre } : {}) });
    else if (p.fs === 'swap') pieces.push({ ...base, format: 'vide' });
    else if (!p.monte && d.partclone.includes(fsPartclone(p.fs))) pieces.push({ ...base, format: 'partclone' });
    else pieces.push({ ...base, format: 'brut' });
  }
  return pieces;
}
/** Lecture brute d'un disque Windows (les chemins \\.\ et \\?\GLOBALROOT ne s'ouvrent qu'ainsi). */
const CS_BRUT = String.raw`using System; using System.IO; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class OdinBrut {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFileW(string n, uint a, uint s, IntPtr p, uint c, uint f, IntPtr t);
  public static void Copier(string chemin, long debut, long taille, bool exact) {
    SafeFileHandle h = CreateFileW(chemin, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) throw new IOException("ouverture impossible : " + chemin + " (erreur " + Marshal.GetLastWin32Error() + ")");
    using (FileStream f = new FileStream(h, FileAccess.Read, 1048576)) using (Stream o = Console.OpenStandardOutput()) {
      if (debut > 0) f.Seek(debut, SeekOrigin.Begin);
      byte[] b = new byte[1048576]; long reste = taille;
      while (reste > 0) { int n; try { n = f.Read(b, 0, (int)Math.Min(b.Length, reste)); } catch (IOException) { if (exact) throw; n = 0; } if (n <= 0) break; o.Write(b, 0, n); reste -= n; }
      o.Flush();
      if (exact && reste > 0) throw new IOException("lecture incomplète : " + reste + " octets manquent");
    }
  }
}`;
/** La commande qui sort une pièce sur la sortie standard. Pur. */
export function commandeLecture(systeme: SystemeImage, d: Disposition, p: Piece): string {
  if (p.format === 'vide') return '';
  if (systeme === 'windows') {
    const corps = p.vss
      ? [`$r = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{ Volume = '${p.vss.replace(/[^A-Z]/g, '')}:\\'; Context = 'ClientAccessible' }`,
        'if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine(\'instantané VSS refusé (code \' + $r.ReturnValue + \')\'); exit 5 }',
        '$c = Get-CimInstance Win32_ShadowCopy | Where-Object { $_.ID -eq $r.ShadowID }',
        `try { [OdinBrut]::Copier($c.DeviceObject, 0, ${p.taille}, $false) } finally { $c | Remove-CimInstance }`]
      : [`[OdinBrut]::Copier('${d.disque.replace(/'/g, '')}', ${p.offset}, ${p.taille}, $true)`];
    return commandeSsh(['$ErrorActionPreference = \'Stop\'', `Add-Type -TypeDefinition @'\n${CS_BRUT}\n'@`, ...corps].join('\n'));
  }
  if (p.format === 'dmg') return `t=$(mktemp -d) && sudo hdiutil create -quiet -srcdevice ${q(d.disque)} -format UDZO -o "$t/odin.dmg" && cat "$t/odin.dmg"; r=$?; sudo rm -rf "$t"; exit $r`;
  const dev = systeme === 'mac' ? d.disque.replace(/^\/dev\/disk/, '/dev/rdisk') : d.disque;
  if (p.format === 'partclone') return `sudo partclone.${fsPartclone(p.fs ?? '')} -c -s ${q(d.partitions.find((x) => x.numero === p.numero)?.chemin ?? '')} -o -`;
  if (systeme === 'mac') return `sudo dd if=${q(dev)} bs=1m`;
  return `sudo dd if=${q(dev)} bs=1M iflag=skip_bytes,count_bytes skip=${p.offset} count=${p.taille} status=none`;
}

// ---------------- Remettre une image ----------------
/** La partition n° `n` d'un disque Linux (/dev/sdb → /dev/sdb2, /dev/nvme0n1 → /dev/nvme0n1p2). Pur. */
export const partitionDe = (disque: string, n: number) => `${disque}${/\d$/.test(disque) ? 'p' : ''}${n}`;
/** La sonde du disque cible : taille, disque du système qui tourne, partitions montées. Pur. */
export function scriptCible(disque: string): string {
  if (!DISQUE.test(disque)) throw new Error('disque cible invalide (ex. /dev/sdb)');
  return [`d=${q(disque)}`, '[ -b "$d" ] || { echo "erreur disque cible introuvable : $d"; exit 3; }',
    'echo "taille $(sudo blockdev --getsize64 "$d")"',
    'echo "systeme $(lsblk -nsro NAME,TYPE "$(findmnt -no SOURCE /)" | awk \'$2=="disk"{print "/dev/"$1; exit}\')"',
    'lsblk -nro MOUNTPOINT "$d" | grep -q . && echo "monte oui"; true'].join('\n');
}
/** La commande qui écrit une pièce (lue sur l'entrée standard) sur le disque cible. Pur. */
export function commandeEcriture(cible: SystemeImage, disque: string, p: Piece): string {
  if (!DISQUE.test(disque)) throw new Error('disque cible invalide');
  if (p.format === 'dmg') return `t=$(mktemp -d) && cat > "$t/odin.dmg" && sudo asr restore --source "$t/odin.dmg" --target ${q(disque)} --erase --noprompt; r=$?; rm -rf "$t"; exit $r`;
  if (p.format === 'vide') return p.fs === 'swap' ? `sudo mkswap ${q(partitionDe(disque, p.numero ?? 0))} >/dev/null` : 'true';
  if (p.format === 'partclone') return `sudo partclone.${fsPartclone(p.fs ?? '')} -r -s - -o ${q(partitionDe(disque, p.numero ?? 0))}`;
  if (cible === 'mac') return `sudo dd of=${q(disque.replace(/^\/dev\/disk/, '/dev/rdisk'))} bs=1m`;
  return `sudo dd of=${q(disque)} bs=1M oflag=seek_bytes seek=${p.offset} conv=notrunc,fsync status=none`;
}
/** Relit une pièce brute écrite sur le disque cible et rend son empreinte. Pur. */
export const commandeRelecture = (disque: string, p: Piece) => `sudo dd if=${q(disque)} bs=1M iflag=skip_bytes,count_bytes skip=${p.offset} count=${p.octets ?? p.taille} status=none | { sha256sum 2>/dev/null || shasum -a 256; }`;

// ---------------- Accès au poste ----------------
export interface AccesPoste {
  nom: string;
  executer(cmd: string, timeoutMs?: number): Promise<{ code: number | null; out: string }>;
  /** la sortie de la commande arrive dans `surDonnees`, au fil de l'eau */
  lire(cmd: string, surDonnees: (d: Buffer) => void): Promise<{ code: number | null; out: string }>;
  /** l'entrée de la commande vient de `entree` */
  ecrire(cmd: string, entree: AsyncIterable<Buffer>): Promise<{ code: number | null; out: string }>;
}
/** Pour les essais seulement : un faux poste à la place de SSH. */
export const essaisImage: { acces?: (m: Machine) => AccesPoste } = {};
function sshFlux(home: string, m: Machine, command: string, o: { entree?: AsyncIterable<Buffer>; sortie?: (d: Buffer) => void; timeoutMs: number }): Promise<{ code: number | null; out: string }> {
  // root : pas de sudo (absent sur Proxmox) ; sinon sudo lit le mot de passe sur l'entrée, avant le flux.
  const cmd = m.user === 'root' ? command.replace(/\bsudo\s+/g, '') : command, sudoPw = m.sudoPassword ?? m.password;
  const usesSudo = /\bsudo\b/.test(cmd) && Boolean(sudoPw), remote = remoteCommand(cmd, usesSudo), n = usesSudo ? (remote.match(/sudo -S/g) ?? []).length : 0;
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (m.password) Object.assign(env, { SSH_ASKPASS: askpassScript(home), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY || ':0', ODIN_ASKPASS_SECRET: m.password });
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgs(home, m, ['-T']).concat(remote), { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; const add = (d: Buffer) => { if (out.length < 60_000) out += d.toString(); };
    child.stdout.on('data', o.sortie ?? add); child.stderr.on('data', add); child.stdin.on('error', () => undefined);
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/^\[sudo\][^\n]*\n?/gm, '') }); });
    void (async () => {
      if (n) child.stdin.write(`${sudoPw}\n`.repeat(n));
      try { if (o.entree) for await (const b of o.entree) { if (!child.stdin.write(b)) await new Promise((r) => child.stdin.once('drain', r)); } } catch (e) { out += (e as Error).message; child.kill('SIGKILL'); }
      child.stdin.end();
    })();
  });
}
function accesDe(home: string, m: Machine): AccesPoste {
  if (essaisImage.acces) return essaisImage.acces(m);
  return {
    nom: m.label,
    executer: (cmd, timeoutMs = 60_000) => sshFlux(home, m, cmd, { timeoutMs }),
    lire: (cmd, sortie) => sshFlux(home, m, cmd, { sortie, timeoutMs: 48 * 3600_000 }),
    ecrire: (cmd, entree) => sshFlux(home, m, cmd, { entree, timeoutMs: 48 * 3600_000 }),
  };
}
async function systemeDe(a: AccesPoste): Promise<SystemeImage> {
  const u = await a.executer('uname -s');
  if (u.code === 0 && /linux/i.test(u.out)) return 'linux';
  if (u.code === 0 && /darwin/i.test(u.out)) return 'mac';
  const w = await a.executer('cmd /c ver');
  if (/windows/i.test(w.out)) return 'windows';
  throw new Error(`${a.nom} : système non reconnu`);
}

// ---------------- Faire, vérifier, remettre ----------------
type Phenix = Awaited<ReturnType<typeof phenix>>;
type Depot = ReturnType<Phenix['depot']>;
/** Une pièce lue en flux et rangée morceau par morceau. */
async function ranger(a: AccesPoste, repo: Depot, cmd: string): Promise<{ chunks: string[]; octets: number; ajoutes: number; sha256: string; code: number | null; out: string }> {
  const h = createHash('sha256'), chunks: string[] = [], tampon = Buffer.alloc(MORCEAU); let plein = 0, octets = 0, ajoutes = 0;
  const pousser = (b: Buffer) => { const r = repo.put(Buffer.from(b)); chunks.push(r.id); if (r.added) ajoutes += b.length; };
  const r = await a.lire(cmd, (d) => {
    h.update(d); octets += d.length; let k = 0;
    while (k < d.length) { const n = Math.min(MORCEAU - plein, d.length - k); d.copy(tampon, plein, k, k + n); plein += n; k += n; if (plein === MORCEAU) { pousser(tampon); plein = 0; } }
  });
  if (plein) pousser(tampon.subarray(0, plein));
  return { chunks, octets, ajoutes, sha256: h.digest('hex'), code: r.code, out: r.out };
}
/** Relit chaque pièce dans le dépôt (déchiffrée) et compare son empreinte : rend les pièces abîmées. */
export function verifierImage(repo: Pick<Depot, 'get'>, snap: Snapshot): string[] {
  const bad: string[] = [];
  for (const p of snap.image?.pieces ?? []) {
    if (!p.sha256) continue;
    const f = snap.files.find((x) => x.path.endsWith(`/${p.nom}`)); if (!f) { bad.push(p.nom); continue; }
    const h = createHash('sha256'); try { for (const c of f.chunks) h.update(repo.get(c)); } catch { bad.push(p.nom); continue; }
    if (h.digest('hex') !== p.sha256) bad.push(p.nom);
  }
  return bad;
}
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };

/** Fait l'image disque d'un plan (appelée par « Sauvegarder maintenant » et à l'heure du plan). */
export async function faireImage(ctx: ModCtx, p: Plan): Promise<string> {
  if (!p.image) throw new Error('ce plan n\'est pas une image disque');
  const P = await phenix(), m = findMachine(ctx.home, p.image.poste); if (!m) throw new Error(`poste inconnu : ${p.image.poste}`);
  const a = accesDe(ctx.home, m), systeme = await systemeDe(a), t0 = Date.now();
  const sonde = await a.executer(systeme === 'windows' ? commandeSsh([scriptSonde('windows', p.image.disque)].join('\n')) : scriptSonde(systeme, p.image.disque), 60_000);
  const d = lireDisposition(systeme, sonde.out), pieces = planifier(systeme, d), notes: string[] = [];
  const t = p.destination && P.distant(p) ? (await import('./transport.ts')).transportDe(ctx.home, p.destination) : undefined;
  const repo = await P.ouvrir(ctx, p, t, t ? await t.liste() : undefined);
  const files: FileEntry[] = []; let ajoutes = 0;
  for (const piece of pieces) {
    const chemin = `image/${m.label}/${piece.nom}`;
    if (piece.format === 'vide') { files.push({ path: chemin, size: 0, mtime: Date.now(), mode: 0o600, chunks: [] }); continue; }
    let r = await ranger(a, repo, commandeLecture(systeme, d, piece));
    if (r.code !== 0 && piece.format === 'dmg') { notes.push('hdiutil a refusé le disque : copie brute à la place'); piece.format = 'brut'; r = await ranger(a, repo, commandeLecture(systeme, d, piece)); }
    if (r.code !== 0) throw new Error(`${m.label} : lecture de ${piece.nom} en échec (${r.out.trim().split('\n').at(-1)?.slice(0, 200) || `code ${r.code}`})`);
    if (piece.format === 'brut' && !piece.vss && r.octets !== piece.taille) throw new Error(`${m.label} : ${piece.nom} lue en partie seulement (${r.octets} octets sur ${piece.taille})`);
    piece.octets = r.octets; piece.sha256 = r.sha256; ajoutes += r.ajoutes;
    files.push({ path: chemin, size: r.octets, mtime: Date.now(), mode: 0o600, chunks: r.chunks });
  }
  if (systeme === 'linux' && pieces.some((x) => x.format === 'brut' && x.numero && d.partitions.find((y) => y.numero === x.numero)?.monte)) notes.push('partitions montées copiées à chaud (comme après une coupure de courant)');
  const now = ctx.now(), info: InfoImage = { poste: m.label, systeme, disque: d.disque, taille: d.taille, pieces, ...(notes.length ? { notes } : {}) };
  const snap: Snapshot = { id: `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, at: now.toISOString(), plan: p.name, paths: [`${m.label}:${d.disque}`], files, bytes: files.reduce((n, f) => n + f.size, 0), added: ajoutes, type: 'complète', image: info };
  repo.saveSnapshot(snap);
  const bad = verifierImage(repo, snap);
  if (bad.length) { repo.forget(snap.id); throw new Error(`image relue différente pour ${bad.join(', ')} : version retirée`); }
  const vieux = P.aOublier(repo.snapshots().filter((x) => x.plan === p.name), p.keep); for (const o of vieux) repo.forget(o.id);
  let envoi = '';
  if (t) { const e = await P.envoyerDepot(repo, t, p.garderLocal !== false); envoi = ` Copiée et vérifiée sur ${t.nom} (${e.envoyes} fichier(s), ${human(e.octets)}).`; }
  ctx.saveSettings({ last: { ...((ctx.settings.last as Record<string, unknown>) ?? {}), [p.name]: { at: now.toISOString(), ok: true, files: files.length, bytes: snap.bytes, added: ajoutes, type: 'image', ms: Date.now() - t0 } } });
  ctx.emit('sauvegarde_ok', { plan: p.name, fichiers: files.length, octets: snap.bytes, type: 'image' });
  return `💿 Image de ${m.label} (${d.disque}, ${human(d.taille)}) : ${pieces.length} pièce(s), ${human(snap.bytes)} lus, ${human(ajoutes)} de nouveau, relue et vérifiée.${vieux.length ? ` ${vieux.length} ancienne(s) image(s) retirée(s).` : ''}${envoi}${notes.length ? ` (${notes.join(' ; ')})` : ''}`;
}

/** Remet une image sur un disque d'un poste Linux (ou Mac pour une image .dmg). */
export async function remettreImage(ctx: ModCtx, instantane: string, poste: string, disque: string): Promise<string> {
  const P = await phenix(), { p, repo, snap } = P.trouverInstantane(ctx, instantane), info = snap.image;
  if (!info) throw new Error('cette version n\'est pas une image disque');
  const m = findMachine(ctx.home, poste); if (!m) throw new Error(`poste inconnu : ${poste}`);
  const a = accesDe(ctx.home, m), cible = await systemeDe(a);
  if (cible === 'windows') throw new Error(`${m.label} tourne sous Windows : démarre-le sur un système Linux (Genèse, clé de secours) pour remettre une image`);
  if (cible === 'mac' && info.systeme !== 'mac') throw new Error('une image de PC se remet depuis un système Linux');
  if (cible === 'linux' && info.pieces.some((x) => x.format === 'dmg')) throw new Error('une image .dmg se remet depuis un Mac (asr)');
  if (cible === 'linux') {
    const r = await a.executer(scriptCible(disque), 60_000), l = Object.fromEntries(r.out.split('\n').map((x) => x.trim().split(/\s+/)).filter((x) => x.length >= 2).map((x) => [x[0], x.slice(1).join(' ')]));
    if (l.erreur) throw new Error(l.erreur);
    if (l.systeme === disque) throw new Error(`${disque} porte le système qui tourne sur ${m.label} : refusé (démarre sur Genèse ou une clé de secours)`);
    if (l.monte) throw new Error(`${disque} a des partitions montées sur ${m.label} : démonte-les d'abord`);
    if (!(Number(l.taille) >= info.taille)) throw new Error(`${disque} est plus petit (${human(Number(l.taille) || 0)}) que le disque d'origine (${human(info.taille)})`);
  }
  const ordre = [...info.pieces].sort((x, y) => Number(Boolean(x.numero)) - Number(Boolean(y.numero)));
  const fichier = (x: { nom: string }) => snap.files.find((f) => f.path === `image/${info.poste}/${x.nom}`);
  await P.rapatrier(ctx, p, repo, ordre.flatMap((x) => fichier(x)?.chunks ?? []));
  let relues = 0, tables = false;
  for (const piece of ordre) {
    if (piece.numero && !tables && cible === 'linux') { tables = true; await a.executer(`sudo partprobe ${q(disque)} 2>/dev/null || sudo blockdev --rereadpt ${q(disque)}; sleep 1; true`, 60_000); }
    const f = fichier(piece); if (!f) throw new Error(`pièce ${piece.nom} absente de cette version`);
    async function* flux() { for (const c of f!.chunks) yield repo.get(c); }
    const r = await a.ecrire(commandeEcriture(cible, disque, piece), flux());
    if (r.code !== 0) throw new Error(`${m.label} : écriture de ${piece.nom} en échec (${r.out.trim().split('\n').at(-1)?.slice(0, 200) || `code ${r.code}`})`);
    if (cible === 'linux' && piece.format === 'brut' && piece.sha256) {
      const v = await a.executer(commandeRelecture(disque, piece), 6 * 3600_000);
      if (!v.out.includes(piece.sha256)) throw new Error(`${m.label} : ${piece.nom} relue différente sur ${disque} : le disque cible est peut-être abîmé`);
      relues++;
    }
  }
  ctx.emit('image_remise', { poste: m.label, disque, image: snap.id });
  return `💿 Image du ${snap.at.slice(0, 16).replace('T', ' ')} (${info.poste}) remise sur ${m.label}:${disque} : ${ordre.length} pièce(s), ${relues} relue(s) et vérifiée(s).`;
}

// ---------------- Actions ----------------
const paramsDest = [
  { key: 'destination', label: 'Destination', kind: 'select' as const, options: ['disque', 'sftp', 'partage'], default: 'disque' },
  { key: 'depot', label: 'Dossier de destination', kind: 'text' as const, default: '', help: 'vide : un dossier « images » dans les données de Phénix' },
  { key: 'poste_destination', label: 'Serveur ou poste (SFTP, partage)', kind: 'text' as const, default: '' },
  { key: 'partage', label: 'Nom du partage (partage réseau)', kind: 'text' as const, default: '' },
];
export const actionsImage: Action[] = [
  { id: 'image_plan', label: 'Image disque d\'un poste', what: 'Une image complète du disque d\'un poste du parc (Linux, Windows, Mac), refaite tous les N jours, rangée et vérifiée comme les autres sauvegardes',
    params: [{ key: 'machine', label: 'Poste', kind: 'text', required: true }, { key: 'disque', label: 'Disque (vide : celui du système)', kind: 'text', default: '', help: 'Linux / Mac : /dev/sda ; Windows : le numéro du disque (0)' }, ...paramsDest,
      { key: 'heure', label: 'Heure', kind: 'text', default: '03:00' }, { key: 'tous_les', label: 'Tous les (jours)', kind: 'number', default: 7 }, { key: 'garder', label: 'Images gardées', kind: 'number', default: 3 }],
    words: ['image disque', 'image du disque', 'image complete', 'image complète', 'cloner le disque'],
    run: async (ctx, i) => {
      const P = await phenix(), { lireDestination, transportDe, essayer, decrire } = await import('./transport.ts');
      const m = findMachine(ctx.home, s(i.machine)); if (!m) throw new Error(`poste inconnu : ${s(i.machine)} (Réglages → Machines)`);
      const disque = s(i.disque).trim(); if (disque) scriptSonde(/^\d+$/.test(disque) ? 'windows' : 'linux', disque);
      const nom = `Image · ${m.label}`, ancien = P.plans(ctx).find((x) => x.name === nom);
      const dest = lireDestination({ genre: i.destination, dossier: s(i.depot) || (s(i.destination) && s(i.destination) !== 'disque' ? '' : `${ctx.dir}${ctx.dir.includes('\\') ? '\\' : '/'}images${ctx.dir.includes('\\') ? '\\' : '/'}${P.slug(m.label)}`), poste: i.poste_destination, partage: i.partage }) ?? ancien?.destination;
      if (!dest) throw new Error('où ranger les images ?');
      const n = (v: unknown, d: number, max: number) => { const x = v === undefined || v === '' ? d : Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(1, x)) : d; };
      const plan: Plan = { ...(ancien ?? {}), name: nom, paths: [], repo: dest.genre === 'disque' ? dest.dossier : '', at: /^\d\d:\d\d$/.test(s(i.heure)) ? s(i.heure) : '03:00', tousLes: n(i.tous_les, 7, 365), image: { poste: m.label, ...(disque ? { disque } : {}) }, keep: { last: n(i.garder, 3, 100), daily: 0, weekly: 0, monthly: 0 }, schema: 'complète', compression: ancien?.compression ?? 'rapide', garderLocal: ancien?.garderLocal ?? true, ...(dest.genre === 'disque' ? {} : { destination: dest }) };
      if (dest.genre === 'disque') delete plan.destination;
      let essai = '';
      if (plan.destination) { const t = transportDe(ctx.home, plan.destination); essai = ` Destination : ${await essayer(t)}.`; await P.ouvrir(ctx, plan, t, await t.liste()); } else P.depot(ctx, plan);
      ctx.saveSettings({ plans: [...P.plans(ctx).filter((x) => x.name !== nom), plan] });
      return { text: `💿 Plan « ${nom} » : image de ${disque || 'son disque système'} tous les ${plan.tousLes} jour(s) à ${plan.at}, ${plan.keep.last} gardée(s) → ${plan.destination ? decrire(plan.destination) : plan.repo}.${essai}` };
    } },
  { id: 'image_restaurer', label: 'Remettre une image disque', what: 'Écrit une image disque sur un disque d\'un poste Linux (un PC démarré sur Genèse, par exemple) ou d\'un Mac (image .dmg) ; tout le disque cible est remplacé',
    params: [{ key: 'instantane', label: 'Image (instantané)', kind: 'text', required: true }, { key: 'machine', label: 'Poste cible', kind: 'text', required: true }, { key: 'disque', label: 'Disque cible (ex. /dev/sdb)', kind: 'text', required: true }],
    grave: (i) => `effacer TOUT le disque ${s(i.disque)} de ${s(i.machine)} et y remettre l'image ${s(i.instantane).slice(0, 24)}`,
    run: async (ctx, i) => ({ text: await remettreImage(ctx, s(i.instantane).trim(), s(i.machine), s(i.disque).trim()) }) },
];
