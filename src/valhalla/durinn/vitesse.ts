// Tirésias — le test de vitesse d'un disque (les mêmes mesures que CrystalDiskMark, code maison) : lecture et
// écriture séquentielles (blocs de 1 Mo) et aléatoires (blocs de 4 Ko), avec un ou plusieurs accès en parallèle.
// Règles : uniquement dans UN fichier de test créé dans le dossier choisi (jamais sur le disque brut, jamais
// par-dessus un fichier existant) ; la place libre est vérifiée avant ; le fichier est effacé à la fin, même en cas
// d'erreur, et même si Odin a été coupé en plein test (ménage au démarrage suivant). Les résultats sont gardés
// pour être comparés dans le temps. Sur un autre poste (par SSH) : séquentiel seulement, avec « dd ».
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Poste } from '../postes.ts';
import { MESURES, NOM_TEST, type LigneMesure } from './mesure.ts';

const M = 1024 * 1024;
/** Les tailles proposées pour le fichier de test, en Mio (petite par défaut). */
export const TAILLES: Record<string, number> = { '32 Mo': 32, '128 Mo': 128, '512 Mo': 512, '1 Go': 1024, '4 Go': 4096 };
export const TAILLE_DEFAUT = '128 Mo';
export interface Mesure { moS: number; acces: number; latMs: number }
export interface Resultat {
  id: string; quand: string;
  /** identifiant du poste (vide : la machine d'Odin) et son nom */
  poste: string; nomPoste: string;
  dossier: string;
  /** le volume où se trouve le dossier (« /dev/sda2 monté sur / ») */
  volume?: string;
  octets: number; dureeS: number;
  /** accès directs au disque, sans passer par le cache du système */
  direct: boolean;
  /** ce qui limite la confiance à accorder à cette mesure, dit honnêtement */
  reserves: string[];
  /** séquentiel seulement (test fait sur un autre poste) */
  partiel?: boolean;
  /** vitesse à laquelle le fichier de test a été écrit la première fois (Mo/s) */
  remplissage?: number;
  mesures: Record<string, { lecture?: Mesure; ecriture?: Mesure }>;
}
export const NOMS: Record<string, string> = { seq1m_q8: 'Séquentiel 1 Mo, 8 accès à la fois', seq1m_q1: 'Séquentiel 1 Mo, un accès à la fois', rnd4k_q32: 'Aléatoire 4 Ko, 32 accès à la fois', rnd4k_q1: 'Aléatoire 4 Ko, un accès à la fois' };
const lire = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 });
export const moS = (v: number | undefined) => (v === undefined ? '—' : `${fr(v)} Mo/s`);
export const tailleFichier = (octets: number) => (octets >= 1024 * M ? `${fr(octets / (1024 * M))} Go` : `${Math.round(octets / M)} Mo`);

// ---------------- Où tester ----------------
const VIRTUELS = /^(proc|sysfs|devtmpfs|devpts|cgroup2?|securityfs|pstore|bpf|tracefs|debugfs|mqueue|hugetlbfs|configfs|fusectl|autofs|binfmt_misc|efivarfs|squashfs|iso9660|udf|nsfs|rpc_pipefs|overlay)$/;
/** Le volume où se trouve un dossier : la ligne de /proc/mounts dont le point de montage est le plus long début du chemin. Pur. */
export function volumeDe(dossier: string, mounts: string): { source: string; point: string; fs: string } | undefined {
  let best: { source: string; point: string; fs: string } | undefined;
  for (const l of mounts.split('\n')) {
    const [source, brut, fs] = l.split(' '); if (!source || !brut || !fs) continue;
    const point = brut.replace(/\\040/g, ' ');
    if ((dossier === point || dossier.startsWith(point.endsWith('/') ? point : `${point}/`)) && (!best || point.length >= best.point.length)) best = { source, point, fs };
  }
  return best;
}
/** Les volumes de la machine où un test a un sens : de vrais disques, où l'on peut écrire. Pur. */
export function volumes(mounts: string): Array<{ source: string; point: string; fs: string }> {
  const vus = new Set<string>(), out: Array<{ source: string; point: string; fs: string }> = [];
  for (const l of mounts.split('\n')) {
    const [source, brut, fs, opts = ''] = l.split(' '); if (!source?.startsWith('/dev/') || !brut || VIRTUELS.test(fs ?? '') || /(^|,)ro(,|$)/.test(opts) || /^\/dev\/(loop|ram|zram)/.test(source)) continue;
    const point = brut.replace(/\\040/g, ' ');
    if (vus.has(source) || /^\/(boot|snap|proc|sys|dev|run)(\/|$)/.test(point) || /^\/etc\/(hosts|hostname|resolv\.conf)$/.test(point)) continue;
    vus.add(source); out.push({ source, point, fs: fs ?? '' });
  }
  return out;
}
/** Ce qui rend une mesure moins fiable dans ce dossier : dossier en mémoire, dossier sur le réseau, machine virtuelle. */
export function reservesDuLieu(dossier: string): string[] {
  const r: string[] = [];
  try {
    const t = Number(statfsSync(dossier).type) >>> 0;
    if (t === 0x01021994 || t === 0x858458f6) r.push('Ce dossier est en mémoire vive, pas sur un disque : la mesure est celle de la mémoire.');
    if (t === 0x6969 || t === 0xff534d42 || t === 0xfe534d42 || t === 0x01021997) r.push('Ce dossier est sur le réseau : la mesure compte aussi le réseau.');
  } catch { /* type de dossier inconnu : rien à dire */ }
  const v = volumeDe(dossier, lire('/proc/mounts'));
  if (/\bhypervisor\b/.test(lire('/proc/cpuinfo').slice(0, 20_000)) || /^\/dev\/x?vd/.test(v?.source ?? '')) r.push('Machine virtuelle : la mesure dépend aussi de la machine qui l\'héberge (elle peut garder des données en mémoire).');
  return r;
}
/**
 * Vérifie le dossier et la place avant un test : un vrai dossier où Odin peut écrire, jamais un périphérique, et
 * assez de place libre pour le fichier plus une marge. Lève une erreur qui dit quoi faire.
 */
export function controler(dossier: string, octets: number): { dossier: string; libre: number; besoin: number } {
  if (!dossier || !isAbsolute(dossier) || /[\0\n\r]/.test(dossier)) throw new Error('donne le chemin complet d\'un dossier (il commence par « / »)');
  let vrai: string; try { vrai = realpathSync(dossier); } catch { throw new Error(`le dossier ${dossier} n'existe pas`); }
  if (/^\/(dev|proc|sys)(\/|$)/.test(vrai)) throw new Error('le test se fait dans un dossier de fichiers, jamais sur un disque brut ni dans /dev, /proc ou /sys');
  if (!statSync(vrai).isDirectory()) throw new Error(`${dossier} n'est pas un dossier : donne le dossier où créer le fichier de test`);
  try { accessSync(vrai, constants.W_OK | constants.X_OK); } catch { throw new Error(`Odin n'a pas le droit d'écrire dans ${dossier} : choisis un dossier où il peut écrire`); }
  const st = statfsSync(vrai), libre = Number(st.bavail) * Number(st.bsize), besoin = octets + Math.max(64 * M, Math.round(octets * 0.1));
  if (libre < besoin) throw new Error(`pas assez de place : il reste ${tailleFichier(libre)} dans ${dossier}, il en faut ${tailleFichier(besoin)} pour un fichier de test de ${tailleFichier(octets)}. Choisis une taille plus petite ou un autre dossier`);
  return { dossier: vrai, libre, besoin };
}
/** Durée annoncée d'un test, en secondes : huit mesures, plus le temps d'écrire le fichier (compté à 60 Mo/s). Pur. */
export const estimation = (octets: number, dureeMs: number) => Math.round((8 * dureeMs) / 1000 + octets / (60 * 1e6) + 2);

// ---------------- Le test sur la machine d'Odin ----------------
export interface Etape { etape: string; texte: string; rang?: number; sur?: number }
/** Efface le fichier de test qu'un test coupé net aurait laissé (Odin arrêté de force, panne de courant). Rend son chemin s'il y en avait un. */
export function menage(registre: string): string | undefined {
  let x: { fichier?: string; pid?: number } | undefined; try { x = JSON.parse(readFileSync(registre, 'utf8')) as typeof x; } catch { return undefined; }
  let efface: string | undefined;
  if (x && typeof x.fichier === 'string' && NOM_TEST.test(basename(x.fichier))) {
    // Le banc tourne encore (très rare) : on lui demande de finir, il efface lui-même son fichier.
    if (typeof x.pid === 'number' && x.pid > 1) { try { process.kill(x.pid, 'SIGTERM'); } catch { /* il n'existe plus */ } }
    if (existsSync(x.fichier)) { try { rmSync(x.fichier, { force: true }); efface = x.fichier; } catch { /* disque absent */ } }
  }
  rmSync(registre, { force: true });
  return efface;
}
/**
 * Lance les mesures dans un fichier de test du dossier, sur la machine d'Odin. `registre` : un petit fichier qui note
 * le fichier de test en cours, pour le ménage si Odin est coupé. Le fichier de test est toujours effacé à la fin.
 */
export async function mesurerIci(o: { dossier: string; octets: number; dureeMs: number; registre?: string; surEtape?: (e: Etape) => void; signal?: AbortSignal }): Promise<{ lignes: LigneMesure[]; direct: boolean; remplissage?: number; dureeS: number; fichier: string }> {
  const fichier = join(o.dossier, `odin-test-vitesse-${randomBytes(5).toString('hex')}.tmp`), debut = Date.now();
  if (existsSync(fichier)) throw new Error('un fichier de test du même nom existe déjà : relance le test');
  const ecrireRegistre = (pid?: number) => { if (!o.registre) return; try { mkdirSync(join(o.registre, '..'), { recursive: true }); const tmp = `${o.registre}.tmp`; writeFileSync(tmp, JSON.stringify({ fichier, pid, depuis: new Date(debut).toISOString() })); renameSync(tmp, o.registre); } catch { /* le test se fait quand même */ } };
  ecrireRegistre();
  const lignes: LigneMesure[] = []; let direct = true, remplissage: number | undefined, erreur: string | undefined, fini = false;
  try {
    const enfant = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./mesure.ts', import.meta.url)), JSON.stringify({ fichier, octets: o.octets, dureeMs: o.dureeMs, ecoute: true })], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, UV_THREADPOOL_SIZE: '40' }, windowsHide: true });
    ecrireRegistre(enfant.pid);
    const arreter = () => { try { enfant.kill('SIGTERM'); } catch { /* déjà fini */ } };
    o.signal?.addEventListener('abort', arreter, { once: true });
    // Garde-fou : un disque qui écrit à moins de 2 Mo/s ne finira pas dans un délai raisonnable.
    const limite = setTimeout(() => { erreur = 'ce disque est trop lent pour un fichier de test de cette taille : choisis une taille plus petite'; arreter(); setTimeout(() => { try { enfant.kill('SIGKILL'); } catch { /* déjà fini */ } }, 5000).unref(); }, 60_000 + (o.octets / (2 * 1e6)) * 1000 + 8 * o.dureeMs);
    let reste = '', err = '';
    const ligne = (l: string) => {
      let x: Record<string, unknown>; try { x = JSON.parse(l) as Record<string, unknown>; } catch { return; }
      if (typeof x.erreur === 'string') erreur = x.erreur;
      if (x.etape === 'ouverture') direct = x.direct === true;
      if (x.etape === 'remplissage') { if (typeof x.moS === 'number') remplissage = x.moS; o.surEtape?.({ etape: 'remplissage', texte: `écriture du fichier de test (${Math.round((Number(x.fait) / Math.max(1, Number(x.total))) * 100)} %)` }); }
      if (x.etape === 'mesure') o.surEtape?.({ etape: 'mesure', texte: `${NOMS[String(x.nom)] ?? String(x.nom)}, ${x.sens === 'ecriture' ? 'écriture' : 'lecture'}`, rang: Number(x.rang), sur: Number(x.sur) });
      if (x.resultat && typeof x.resultat === 'object') lignes.push(x.resultat as LigneMesure);
      if (x.fin === true) fini = true;
    };
    enfant.stdout.on('data', (d: Buffer) => { reste += d.toString('utf8'); const l = reste.split('\n'); reste = l.pop() ?? ''; for (const x of l) if (x.trim()) ligne(x); });
    enfant.stderr.on('data', (d: Buffer) => { err = (err + d.toString('utf8')).slice(-2000); });
    const code = await new Promise<number>((ok) => { enfant.once('error', (e) => { erreur = `le banc de mesure n'a pas pu démarrer : ${e.message}`; ok(1); }); enfant.once('close', (c) => ok(c ?? 1)); });
    clearTimeout(limite); o.signal?.removeEventListener('abort', arreter);
    if (o.signal?.aborted) throw new Error('test arrêté à ta demande');
    if (erreur) throw new Error(erreur);
    if (code !== 0 || !fini) throw new Error(`le banc de mesure s'est arrêté avant la fin${err.trim() ? ` : ${err.trim().split('\n').at(-1)!.slice(0, 200)}` : ''}`);
    return { lignes, direct, ...(remplissage !== undefined ? { remplissage } : {}), dureeS: Math.round((Date.now() - debut) / 1000), fichier };
  } finally {
    // Quoi qu'il se soit passé : le fichier de test ne reste pas.
    try { rmSync(fichier, { force: true }); } catch { /* disque retiré en cours de test */ }
    if (o.registre) rmSync(o.registre, { force: true });
  }
}
/** Les lignes du banc rangées par mesure. Pur. */
export function ranger(lignes: LigneMesure[]): Resultat['mesures'] {
  const m: Resultat['mesures'] = {};
  for (const l of lignes) { const x = (m[l.nom] ??= {}); x[l.sens] = { moS: l.moS, acces: l.acces, latMs: l.latMs }; }
  return m;
}

// ---------------- Le test sur un autre poste (séquentiel, avec « dd ») ----------------
/**
 * Ce qu'on fait faire au poste, en une seule connexion. Arguments : dossier (vide : le dossier personnel du compte),
 * nom du fichier, taille en Mio, place demandée en Kio. Le fichier est créé sans jamais écraser (noclobber), puis
 * effacé par « trap » quoi qu'il arrive : erreur, arrêt, connexion coupée. Lecture et écriture directes si le « dd »
 * du poste sait le faire, sinon avec le cache (et on le dit).
 */
export const SCRIPT_DD = [
  'export LC_ALL=C', 'd=$1; [ -n "$d" ] || d=$HOME', 'f="$d/$2"; n=$3',
  '[ -d "$d" ] || { echo "---ERREUR dossier"; exit 3; }', '[ -w "$d" ] || { echo "---ERREUR droits"; exit 3; }',
  'echo "---DOSSIER $d"', 'echo "---FS $(stat -f -c %T -- "$d" 2>/dev/null)"',
  'libre=$(df -Pk -- "$d" 2>/dev/null | awk \'NR==2 { print $4 }\')', 'echo "---LIBRE ${libre:-0}"',
  '[ "${libre:-0}" -ge "$4" ] || { echo "---ERREUR place"; exit 4; }',
  '( set -C; : > "$f" ) 2>/dev/null || { echo "---ERREUR existe"; exit 5; }',
  'trap \'rm -f -- "$f"\' EXIT; trap \'exit 9\' INT TERM HUP',
  'echo "---ECRITURE direct"',
  'dd if=/dev/zero of="$f" bs=1048576 count="$n" oflag=direct conv=fsync 2>&1 || {',
  '  echo "---ECRITURE synchro"',
  '  dd if=/dev/zero of="$f" bs=1048576 count="$n" conv=fsync 2>&1 || {',
  '    echo "---ECRITURE cache"',
  '    dd if=/dev/zero of="$f" bs=1048576 count="$n" 2>&1 || { echo "---ERREUR ecriture"; exit 6; }',
  '    sync', '  }', '}',
  'echo "---LECTURE direct"',
  'dd if="$f" of=/dev/null bs=1048576 iflag=direct 2>&1 || {',
  '  echo "---LECTURE cache"',
  '  dd if="$f" of=/dev/null bs=1048576 2>&1 || { echo "---ERREUR lecture"; exit 7; }',
  '}', 'echo "---FIN"',
].join('\n');
export interface LuDd { dossier?: string; fs?: string; libre?: number; erreur?: string; fini: boolean; ecriture?: { moS: number; mode: 'direct' | 'synchro' | 'cache' }; lecture?: { moS: number; mode: 'direct' | 'cache' } }
/** La réponse du poste au script : la dernière ligne de bilan de chaque « dd » (GNU, BusyBox ou BSD / macOS). Pur. */
export function lireDd(out: string): LuDd {
  const r: LuDd = { fini: false }; let sens: 'ecriture' | 'lecture' | undefined, mode = '';
  for (const l of out.split('\n')) {
    const m = /^---([A-Z]+)(?: (.*))?$/.exec(l.trim());
    if (m) {
      if (m[1] === 'ECRITURE') { sens = 'ecriture'; mode = m[2] ?? ''; } else if (m[1] === 'LECTURE') { sens = 'lecture'; mode = m[2] ?? ''; }
      else if (m[1] === 'DOSSIER') r.dossier = (m[2] ?? '').slice(0, 300); else if (m[1] === 'FS') r.fs = (m[2] ?? '').slice(0, 40); else if (m[1] === 'LIBRE') r.libre = Number(m[2]) * 1024 || 0;
      else if (m[1] === 'ERREUR') r.erreur = m[2] ?? 'inconnue'; else if (m[1] === 'FIN') r.fini = true;
      continue;
    }
    const b = /(\d+) bytes[^\n]*?(?:copied,|transferred in)\s*([0-9.]+(?:e[-+]?\d+)?)\s*s/i.exec(l); if (!b || !sens) continue;
    const octets = Number(b[1]), s = Number(b[2]); if (!(octets > 0) || !(s > 0)) continue;
    const v = octets / 1e6 / s;
    if (sens === 'ecriture') r.ecriture = { moS: v, mode: mode === 'direct' ? 'direct' : mode === 'synchro' ? 'synchro' : 'cache' }; else r.lecture = { moS: v, mode: mode === 'direct' ? 'direct' : 'cache' };
  }
  return r;
}
/** Le test séquentiel sur un autre poste Linux ou Mac. Lève une erreur claire si le poste refuse (dossier, droits, place). */
export async function mesurerDistant(poste: Poste, o: { dossier: string; mo: number }): Promise<{ lu: LuDd; dureeS: number; reserves: string[] }> {
  if (o.dossier && (!o.dossier.startsWith('/') || /[\0\n\r]/.test(o.dossier))) throw new Error('donne le chemin complet d\'un dossier du poste (il commence par « / »), ou rien pour son dossier personnel');
  const nom = `odin-test-vitesse-${randomBytes(5).toString('hex')}.tmp`, besoinKo = Math.round(((o.mo + Math.max(64, o.mo * 0.1)) * M) / 1024), debut = Date.now();
  const r = await poste.run('sh', ['-c', SCRIPT_DD, 'sh', o.dossier, nom, String(o.mo), String(besoinKo)], { timeoutMs: Math.min(20 * 60_000, 90_000 + (o.mo / 2) * 2000) });
  const lu = lireDd(r.out), ou = lu.dossier || o.dossier || 'son dossier personnel';
  if (lu.erreur === 'dossier') throw new Error(`le dossier ${o.dossier} n'existe pas sur ${poste.nom}`);
  if (lu.erreur === 'droits') throw new Error(`le compte utilisé sur ${poste.nom} n'a pas le droit d'écrire dans ${ou}`);
  if (lu.erreur === 'place') throw new Error(`pas assez de place sur ${poste.nom} : il reste ${tailleFichier(lu.libre ?? 0)} dans ${ou}, il en faut ${tailleFichier(besoinKo * 1024)}. Choisis une taille plus petite ou un autre dossier`);
  if (lu.erreur === 'existe') throw new Error('un fichier de test du même nom existe déjà sur le poste : relance le test');
  if (lu.erreur || !lu.fini || !lu.ecriture || !lu.lecture) throw new Error(`${poste.nom} n'a pas fini le test${lu.erreur ? ` (${lu.erreur})` : ''}${r.err.trim() ? ` : ${r.err.trim().split('\n').at(-1)!.slice(0, 160)}` : ''}. Son fichier de test a été effacé`);
  const reserves = ['Sur un autre poste, seul le débit séquentiel est mesuré (avec « dd ») ; les mesures aléatoires 4 Ko ne se font que sur la machine d\'Odin.'];
  if (lu.lecture.mode === 'cache') reserves.push('Lecture faussée par le cache : le poste garde le fichier en mémoire, la lecture mesurée est surtout celle de la mémoire.');
  if (lu.ecriture.mode === 'cache') reserves.push('Écriture optimiste : le poste ne sait pas attendre que tout soit vraiment sur le disque avant de compter.');
  if (/^(tmpfs|ramfs)$/.test(lu.fs ?? '')) reserves.push('Ce dossier est en mémoire vive, pas sur un disque : la mesure est celle de la mémoire.');
  if (/^(zfs|btrfs)$/.test(lu.fs ?? '')) reserves.push('Ce système de fichiers peut compresser : le fichier de test étant rempli de zéros, l\'écriture mesurée peut être optimiste.');
  if (/^(nfs|cifs|smb2?|fuse)/.test(lu.fs ?? '')) reserves.push('Ce dossier est sur le réseau : la mesure compte aussi le réseau.');
  return { lu, dureeS: Math.round((Date.now() - debut) / 1000), reserves };
}

// ---------------- Les résultats, gardés et comparés ----------------
const fichierResultats = (dir: string) => join(dir, 'vitesse.json');
export function lireResultats(dir: string): Resultat[] { try { const l = JSON.parse(readFileSync(fichierResultats(dir), 'utf8')) as Resultat[]; return Array.isArray(l) ? l : []; } catch { return []; } }
export function ajouterResultat(dir: string, r: Resultat): void { mkdirSync(dir, { recursive: true }); const f = fichierResultats(dir), tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify([...lireResultats(dir), r].slice(-400))); renameSync(tmp, f); }
/** Le test précédent au même endroit (même poste, même volume ou même dossier), pour comparer. Pur. */
export function precedent(l: Resultat[], r: Pick<Resultat, 'id' | 'poste' | 'dossier' | 'volume'>): Resultat | undefined {
  return [...l].reverse().find((x) => x.id !== r.id && x.poste === r.poste && (x.dossier === r.dossier || (Boolean(x.volume) && x.volume === r.volume)));
}
const debit = (r: Resultat, sens: 'lecture' | 'ecriture') => r.mesures.seq1m_q8?.[sens]?.moS ?? r.mesures.seq1m_q1?.[sens]?.moS;
const ecart = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || !(b > 0) ? undefined : Math.round(((a - b) / b) * 100));
const signe = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
/** La comparaison avec un test plus ancien, en une phrase ; une baisse nette est signalée. Pur. */
export function comparer(r: Resultat, avant: Resultat | undefined): string | undefined {
  if (!avant) return undefined;
  const l = ecart(debit(r, 'lecture'), debit(avant, 'lecture')), e = ecart(debit(r, 'ecriture'), debit(avant, 'ecriture')), a = ecart(r.mesures.rnd4k_q1?.lecture?.moS, avant.mesures.rnd4k_q1?.lecture?.moS);
  const bouts = [l !== undefined ? `lecture séquentielle ${signe(l)}` : '', e !== undefined ? `écriture séquentielle ${signe(e)}` : '', a !== undefined ? `lecture aléatoire ${signe(a)}` : ''].filter(Boolean);
  if (!bouts.length) return undefined;
  const d = new Date(avant.quand), baisse = [l, e].some((x) => x !== undefined && x <= -30);
  return `Par rapport au test du ${d.toLocaleDateString('fr-FR')} : ${bouts.join(', ')}.${baisse ? ' Une baisse aussi nette peut venir d\'un disque trop plein, trop chaud ou fatigué : regarde sa santé.' : ''}`;
}
/** Le résultat d'un test, en clair. Pur. */
export function texte(r: Resultat, avant?: Resultat): string {
  const ligne = (k: string) => {
    const x = r.mesures[k]; if (!x) return '';
    const un = (m: Mesure | undefined) => (m ? `${moS(m.moS)}${k.startsWith('rnd') ? ` (${Math.round(m.acces).toLocaleString('fr-FR')} accès/s)` : ''}` : '—');
    return `${NOMS[k] ?? k} : lecture ${un(x.lecture)} · écriture ${un(x.ecriture)}`;
  };
  const cmp = comparer(r, avant);
  return [`⏱ Test de vitesse${r.poste ? ` sur ${r.nomPoste}` : ''} · ${r.dossier}${r.volume ? ` (${r.volume})` : ''} · fichier de ${tailleFichier(r.octets)} · fait en ${r.dureeS} s`,
    ...MESURES.map((m) => ligne(m.nom)).filter(Boolean), ...(cmp ? [cmp] : []),
    ...(r.reserves.length ? [`⚠ À savoir : ${r.reserves.join(' ')}`] : []), 'Le fichier de test a été effacé.'].join('\n');
}
