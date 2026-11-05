// Ce qui sort de l'ordinaire, plan de reprise, test de restauration, bilan de la semaine.

import { cpus, loadavg } from 'node:os';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decryptBackup } from '../backup.ts';
import type { OdinConfig, OdinPaths } from '../config.ts';
import { deviceLabel, type Device } from '../hlidskjalf/inventory.ts';
import { backupDir, diskUsage } from './watch.ts';

export interface KV { getKv(k: string): string | undefined; setKv(k: string, v: string): void }

/**
 * Anomalies : appareil inconnu apparu la nuit, machine d'Odin surchargée durablement, disque qui
 * se remplit vite. Renvoie des alertes (avec une clé, pour ne pas répéter).
 */
export function anomalies(o: { kv: KV; events: Array<{ device_id: string; kind: string; detail: string; at: number }>; devices: Device[]; paths: OdinPaths; now?: number; load?: number }): Array<{ key: string; text: string }> {
  const now = o.now ?? Date.now(), out: Array<{ key: string; text: string }> = [];
  // 1. Nouvel appareil entre 0 h et 6 h (la nuit, rien de nouveau ne devrait arriver).
  for (const e of o.events.filter((x) => x.kind === 'nouveau' && now - x.at < 12 * 3600_000)) {
    const h = new Date(e.at).getHours();
    if (h < 6) { const d = o.devices.find((x) => x.id === e.device_id); out.push({ key: `night:${e.device_id}`, text: `🌙 Un appareil inconnu s'est connecté cette nuit à ${new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} : ${d ? `${deviceLabel(d)} (${d.ip}${d.mac ? `, ${d.mac}` : ''})` : e.detail}. Tu le connais ?` }); }
  }
  // 2. Charge : au-dessus de 2× le nombre de cœurs, trois contrôles de suite.
  const load = (o.load ?? loadavg()[0]) / Math.max(1, cpus().length);
  const streak = load > 2 ? Number(o.kv.getKv('load-streak') ?? 0) + 1 : 0;
  o.kv.setKv('load-streak', String(streak));
  if (streak >= 3) out.push({ key: 'load', text: `🔥 La machine d'Odin est surchargée depuis un moment (charge ${load.toFixed(1)} par cœur). Je peux regarder quel programme consomme.` });
  // 3. Disque qui se remplit vite : plus de 10 points en 24 h.
  for (const u of diskUsage(['/', o.paths.home])) {
    const k = `disk-hist:${u.path}`, prev = o.kv.getKv(k);
    if (!prev) { o.kv.setKv(k, `${now},${u.usedPct}`); continue; }
    const [at, pct] = prev.split(',').map(Number);
    if (now - at >= 86_400_000) { o.kv.setKv(k, `${now},${u.usedPct}`); if (u.usedPct - pct >= 10) out.push({ key: `diskgrow:${u.path}`, text: `📈 Le disque ${u.path} s'est rempli de ${u.usedPct - pct} points en 24 h (${u.usedPct} % maintenant). Je peux chercher ce qui grossit.` }); }
  }
  return out;
}

/** Test de restauration : la dernière sauvegarde se déchiffre-t-elle, et contient-elle l'essentiel ? */
export function restoreTest(paths: OdinPaths, cfg: OdinConfig['autoBackup']): { ok: boolean; text: string } {
  const dir = backupDir(paths, cfg);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.odinbk')).sort() : [];
  if (!files.length) return { ok: false, text: 'aucune sauvegarde à tester' };
  try {
    const zip = decryptBackup(readFileSync(join(dir, files.at(-1)!)), readFileSync(join(paths.home, 'backup-pass'), 'utf8'));
    const names = zip.toString('latin1');
    const missing = ['config.json', 'odin.db'].filter((n) => !names.includes(n));
    return missing.length ? { ok: false, text: `la sauvegarde ${files.at(-1)} ne contient pas : ${missing.join(', ')}` } : { ok: true, text: `la sauvegarde ${files.at(-1)} se restaure (déchiffrée, complète)` };
  } catch (e) { return { ok: false, text: `la sauvegarde ${files.at(-1)} ne se déchiffre pas : ${(e as Error).message}` }; }
}

/** Plan de reprise : que faire si une machine tombe pour de bon (document écrit dans l'espace de travail). */
export function recoveryPlan(o: { cfg: OdinConfig; paths: OdinPaths; devices: Device[]; machines: Array<{ label: string; host: string; user: string }> }): string {
  const imp = new Set(o.cfg.watch.devices), d = o.devices.filter((x) => x.status !== 'removed');
  const key = d.filter((x) => imp.has(x.id) || ['serveur', 'machine virtuelle', 'stockage (NAS)', 'routeur'].includes(x.kind));
  const bk = backupDir(o.paths, o.cfg.autoBackup);
  const lines = [
    `# Plan de reprise — ${new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })}`, '',
    '## Ce qui compte', ...key.map((x) => `- **${deviceLabel(x)}** — ${x.kind}, ${x.ip}${x.mac ? `, MAC ${x.mac}` : ''}${(x.web ?? []).length ? `, interface : ${x.web![0].url}` : ''}`), '',
    '## Sauvegardes', `- Odin : ${o.cfg.autoBackup.enabled ? `chaque nuit à ${o.cfg.autoBackup.hour} h dans ${bk} (garder ${o.cfg.autoBackup.keep})` : 'sauvegarde automatique DÉSACTIVÉE — à activer (Réglages → Sauvegarde)'}`,
    `- Proxmox : ${o.cfg.proxmox.url ? `instantanés avant chaque mise à jour (${o.cfg.updates.enabled ? 'mises à jour de nuit actives' : 'mises à jour de nuit désactivées'})` : 'non relié à Odin'}`, '',
    '## Si Odin lui-même tombe', '1. Réinstaller Odin : `curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.sh | bash`', `2. Restaurer : \`odin restore <fichier .odinbk>\` (mot de passe de sauvegarde)`, '3. Redémarrer le service, puis « odin test ».', '',
    '## Si une machine du réseau tombe', '1. Vérifier l\'alimentation et le câble, puis l\'adresse (Odin → Réseau).', '2. Machine virtuelle : la redémarrer depuis Proxmox ; si elle est cassée, revenir au dernier instantané.', '3. NAS : vérifier l\'état des disques dans son interface ; ne rien réinitialiser avant d\'avoir une copie des données.', '',
    '## Accès', ...o.machines.map((m) => `- ${m.label} : ${m.user}@${m.host} (mot de passe dans le coffre d\'Odin)`), '- Le jeton d\'Odin : `odin link` sur sa machine.',
  ];
  const text = lines.join('\n');
  writeFileSync(join(o.paths.workspace, 'plan-de-reprise.md'), text);
  return text;
}

/** Bilan de la semaine : missions, réussite, coût, corrections — et l'évolution par rapport à la semaine d'avant. */
export function weeklyReport(missions: Array<{ status: string; started_at: number; ended_at: number | null; cost_usd: number }>, lessons: Array<{ created_at: number; origin: string }>, now = Date.now()): string {
  const W = 7 * 86_400_000;
  const stats = (from: number, to: number) => {
    const ms = missions.filter((m) => m.started_at >= from && m.started_at < to);
    const done = ms.filter((m) => m.status === 'terminée');
    const dur = done.filter((m) => m.ended_at).map((m) => (m.ended_at! - m.started_at) / 1000);
    return { n: ms.length, rate: ms.length ? done.length / ms.length : 0, cost: ms.reduce((s, m) => s + m.cost_usd, 0), dur: dur.length ? dur.reduce((a, b) => a + b, 0) / dur.length : 0, corr: lessons.filter((l) => l.origin === 'owner' && l.created_at >= from && l.created_at < to).length };
  };
  const a = stats(now - W, now), b = stats(now - 2 * W, now - W);
  const arrow = (x: number, y: number, better: 'up' | 'down') => (y === 0 || Math.abs(x - y) / Math.max(1e-9, Math.abs(y)) < 0.05 ? '=' : (x > y) === (better === 'up') ? '↗ mieux' : '↘ moins bien');
  return [`📊 Bilan de la semaine`,
    `Missions : ${a.n} (semaine d'avant : ${b.n})`,
    `Réussite : ${Math.round(a.rate * 100)} % ${arrow(a.rate, b.rate, 'up')}`,
    `Durée moyenne : ${Math.round(a.dur)} s ${arrow(a.dur, b.dur, 'down')}`,
    `Coût : ${a.cost.toFixed(2)} $ ${arrow(a.cost, b.cost, 'down')}`,
    `Corrections de ta part : ${a.corr} ${arrow(a.corr, b.corr, 'down')} (chacune est devenue une leçon)`].join('\n');
}
