// Pulsar — le gardien qui veille : surveillance de la maison numérique et audit de sécurité du réseau.
//
// - Appareils importants (que tu as marqués) : alerte quand l'un tombe, puis quand il revient.
// - Disques de la machine d'Odin presque pleins.
// - Certificats HTTPS des appareils (et d'Odin) qui expirent bientôt.
// - Audit du réseau : ports à risque (Telnet, Docker non chiffré, bureau à distance…), interfaces
//   d'administration non chiffrées, appareils inconnus récents. Chaque point vient avec un conseil.
// - Sauvegarde chiffrée automatique chaque nuit, avec rotation.
// Rien n'est modifié sur les appareils : Odin observe et prévient ; corriger reste une action validée.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:tls';
import { join } from 'node:path';
import { createBackup } from '../backup.ts';
import type { OdinPaths } from '../config.ts';
import { deviceLabel, type Device } from '../hlidskjalf/inventory.ts';

export type Level = 'grave' | 'attention' | 'info';
export interface Finding { level: Level; device?: string; ip?: string; title: string; advice: string; key: string }

/** Ports dont l'ouverture mérite un avertissement, avec le conseil associé. */
const RISKY: Record<number, { level: Level; title: string; advice: string }> = {
  23: { level: 'grave', title: 'Telnet ouvert (mots de passe en clair)', advice: 'Désactive Telnet et utilise SSH à la place.' },
  2375: { level: 'grave', title: 'Docker accessible sans chiffrement ni mot de passe', advice: 'Ferme le port 2375 ou passe en 2376 avec TLS : quiconque sur le réseau peut prendre le contrôle de la machine.' },
  21: { level: 'attention', title: 'FTP ouvert (mots de passe en clair)', advice: 'Préfère SFTP (via SSH) ou désactive FTP.' },
  3389: { level: 'attention', title: 'Bureau à distance (RDP) ouvert', advice: 'Garde-le fermé côté Internet, active l\'authentification réseau (NLA) et un mot de passe solide.' },
  5900: { level: 'attention', title: 'Écran à distance (VNC) ouvert', advice: 'VNC est souvent peu protégé : mets un mot de passe fort ou passe par un tunnel SSH.' },
  1883: { level: 'attention', title: 'MQTT sans chiffrement', advice: 'Vérifie qu\'un mot de passe est exigé ; préfère MQTT chiffré (8883).' },
  6379: { level: 'attention', title: 'Redis accessible sur le réseau', advice: 'Limite Redis à la machine locale ou exige un mot de passe.' },
  111: { level: 'info', title: 'RPC ouvert', advice: 'Utile seulement pour NFS : ferme-le sinon.' },
};
const ADMIN_KINDS = new Set(['routeur', 'stockage (NAS)', 'caméra', 'serveur', 'imprimante']);

/** Audit de sécurité de l'inventaire (pur, testable). */
export function auditNetwork(devices: Device[], now = Date.now()): Finding[] {
  const out: Finding[] = [];
  for (const d of devices.filter((x) => x.status === 'online')) {
    const name = deviceLabel(d);
    for (const p of d.ports) {
      const r = RISKY[p];
      if (r) out.push({ ...r, device: name, ip: d.ip, key: `port:${d.id}:${p}` });
    }
    const web = d.web ?? [];
    if (ADMIN_KINDS.has(d.kind) && web.length && web.every((w) => w.url.startsWith('http:'))) {
      out.push({ level: 'attention', device: name, ip: d.ip, title: 'Administration web non chiffrée', advice: 'Active HTTPS sur son interface : sinon le mot de passe circule en clair sur le réseau.', key: `http:${d.id}` });
    }
    if (d.kind === 'inconnu' && now - d.first_seen < 7 * 86_400_000) {
      out.push({ level: 'info', device: name, ip: d.ip, title: 'Appareil récent non identifié', advice: 'Vérifie que tu le connais ; donne-lui un nom (Réseau → ✎) ou demande à Odin de l\'identifier.', key: `unknown:${d.id}` });
    }
  }
  const order: Level[] = ['grave', 'attention', 'info'];
  return out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

/** Occupation des disques de la machine d'Odin (racine et dossier d'Odin). */
export function diskUsage(dirs: string[]): Array<{ path: string; usedPct: number; freeGb: number }> {
  const seen = new Set<string>(), out: Array<{ path: string; usedPct: number; freeGb: number }> = [];
  for (const p of dirs) {
    try {
      const s = statfsSync(p);
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      const key = `${s.blocks}:${s.bsize}`;
      if (!total || seen.has(key)) continue;
      seen.add(key);
      out.push({ path: p, usedPct: Math.round((1 - free / total) * 100), freeGb: Math.round(free / 1e9 * 10) / 10 });
    } catch { /* chemin absent */ }
  }
  return out;
}

/** Jours avant l'expiration du certificat d'une adresse https (certificat auto-signé accepté : on lit seulement sa date). */
export function certDaysLeft(url: string, timeoutMs = 4000): Promise<number | undefined> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { resolve(undefined); return; }
    if (u.protocol !== 'https:') { resolve(undefined); return; }
    const sock = connect({ host: u.hostname, port: Number(u.port || 443), servername: /^[\d.]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      resolve(c?.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / 86_400_000) : undefined);
    });
    sock.on('error', () => resolve(undefined));
    sock.on('timeout', () => { sock.destroy(); resolve(undefined); });
  });
}

export interface WatchConfig { enabled: boolean; intervalMin: number; devices: string[]; diskPct: number; certDays: number }
export interface Alert { key: string; text: string; resolved?: boolean }

/** Contrôle de santé : appareils importants, disques, certificats. Renvoie les alertes du moment. */
export async function healthCheck(o: { devices: Device[]; cfg: WatchConfig; paths: OdinPaths; certs?: (url: string) => Promise<number | undefined> }): Promise<Alert[]> {
  const out: Alert[] = [];
  for (const id of o.cfg.devices) {
    const d = o.devices.find((x) => x.id === id);
    if (!d) continue;
    const key = `down:${id}`;
    if (d.status !== 'online') out.push({ key, text: `🔴 ${deviceLabel(d)} (${d.ip}) ne répond plus depuis ${new Date(d.last_seen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.` });
    else out.push({ key, text: `🟢 ${deviceLabel(d)} (${d.ip}) est de nouveau en ligne.`, resolved: true });
  }
  for (const u of diskUsage(['/', o.paths.home])) {
    const key = `disk:${u.path}`;
    if (u.usedPct >= o.cfg.diskPct) out.push({ key, text: `💽 Disque presque plein (${u.path}) : ${u.usedPct} % utilisé, ${u.freeGb} Go libres.` });
    else out.push({ key, text: '', resolved: true });
  }
  const certs = o.certs ?? certDaysLeft;
  const urls = new Map<string, string>();
  for (const d of o.devices.filter((x) => x.status === 'online')) for (const w of d.web ?? []) if (w.url.startsWith('https:')) urls.set(w.url, deviceLabel(d));
  for (const [url, name] of [...urls].slice(0, 40)) {
    const days = await certs(url);
    if (days === undefined) continue;
    const key = `cert:${url}`;
    if (days <= o.cfg.certDays) out.push({ key, text: days < 0 ? `🔒 Le certificat HTTPS de ${name} (${url}) a expiré il y a ${-days} jour(s).` : `🔒 Le certificat HTTPS de ${name} (${url}) expire dans ${days} jour(s).` });
    else out.push({ key, text: '', resolved: true });
  }
  return out;
}

/**
 * Ne garde que ce qui est nouveau : une alerte est envoyée une fois (puis rappelée après 24 h si elle
 * dure) ; son retour à la normale n'est signalé que si elle avait été envoyée. État dans logs/watch.json.
 */
export function newAlerts(alerts: Alert[], stateFile: string, now = Date.now()): string[] {
  let st: Record<string, number> = {};
  try { st = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* premier passage */ }
  const msgs: string[] = [];
  for (const a of alerts) {
    if (a.resolved) { if (st[a.key]) { if (a.text) msgs.push(a.text); delete st[a.key]; } continue; }
    if (!st[a.key] || now - st[a.key] > 86_400_000) { msgs.push(a.text); st[a.key] = now; }
  }
  writeFileSync(stateFile, JSON.stringify(st));
  return msgs;
}

// ---------------- Sauvegarde automatique ----------------

export interface AutoBackupConfig { enabled: boolean; hour: number; dir: string; keep: number }
const passFile = (paths: OdinPaths) => join(paths.home, 'backup-pass');
export function setBackupPassword(paths: OdinPaths, pw: string): void {
  if (pw.length < 8) throw new Error('mot de passe de sauvegarde : 8 caractères au moins');
  writeFileSync(passFile(paths), pw, { mode: 0o600 });
}
export const hasBackupPassword = (paths: OdinPaths) => existsSync(passFile(paths));
export const backupDir = (paths: OdinPaths, cfg: AutoBackupConfig) => cfg.dir.trim() || join(paths.home, 'sauvegardes');

/** Fait la sauvegarde du jour si l'heure est passée et qu'elle n'existe pas encore ; garde les « keep » dernières. */
export function autoBackup(paths: OdinPaths, cfg: AutoBackupConfig, now = new Date()): { file?: string; error?: string } | undefined {
  if (!cfg.enabled || now.getHours() < cfg.hour) return undefined;
  const dir = backupDir(paths, cfg), day = now.toISOString().slice(0, 10);
  const file = join(dir, `odin-sauvegarde-${day}.odinbk`);
  if (existsSync(file)) return undefined;
  if (!hasBackupPassword(paths)) return { error: 'sauvegarde automatique : aucun mot de passe (Réglages → Sauvegarde)' };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, createBackup(paths, readFileSync(passFile(paths), 'utf8'), { workspace: true }), { mode: 0o600 });
    const old = readdirSync(dir).filter((f) => /^odin-sauvegarde-\d{4}-\d{2}-\d{2}\.odinbk$/.test(f)).sort().reverse().slice(Math.max(1, cfg.keep));
    for (const f of old) rmSync(join(dir, f), { force: true });
    return { file };
  } catch (e) { return { error: `sauvegarde automatique impossible : ${(e as Error).message}` }; }
}

/** Les sauvegardes présentes (pour l'interface). */
export function listBackups(paths: OdinPaths, cfg: AutoBackupConfig): Array<{ name: string; size: number }> {
  const dir = backupDir(paths, cfg);
  try { return readdirSync(dir).filter((f) => f.endsWith('.odinbk')).sort().reverse().map((f) => ({ name: f, size: statSync(join(dir, f)).size })); } catch { return []; }
}
