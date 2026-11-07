// Odin prend soin de tes machines : réparation automatique des services qui tombent, mises à jour
// planifiées la nuit (avec instantané Proxmox avant, retour arrière si ça casse), journal du soir.
// Tout ce qui s'exécute ici a été configuré par toi (Réglages) : ce sont tes consignes, pas celles
// d'un contenu extérieur. Chaque action est inscrite dans le journal d'audit.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { findMachine, listMachines, runOnMachine, withAdmin } from '../machines/access.ts';
import { pveApi, type PveResource } from '../tools/proxmox.ts';

export interface Service {
  id: string;
  name: string;
  /** http(s)://… (répond sans erreur serveur) ou tcp://hôte:port (accepte la connexion). */
  check: string;
  /** Où réparer : « local », l'identifiant d'une machine enregistrée, ou « proxmox:<vmid> » (redémarrage de la VM / du conteneur). */
  where: string;
  /** Commande de réparation (ex. « sudo systemctl restart home-assistant »). Inutile pour proxmox:<vmid>. */
  repair: string;
  /** Réparer tout seul (sinon : seulement prévenir). */
  auto: boolean;
}

export interface CareCtx { home: string; logs: string; proxmox: { url: string; token: string } }

/** Le service répond-il ? */
export function probe(check: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(check); } catch { resolve(false); return; }
    if (u.protocol === 'tcp:') {
      const s = connect({ host: u.hostname, port: Number(u.port), timeout: timeoutMs }, () => { s.end(); resolve(true); });
      s.on('error', () => resolve(false)); s.on('timeout', () => { s.destroy(); resolve(false); });
      return;
    }
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false, headers: { 'user-agent': 'Odin-Vordr/1.0' } }, (res) => { res.resume(); resolve((res.statusCode ?? 0) > 0 && (res.statusCode ?? 0) < 500); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** Exécute une commande sur la machine d'Odin ou sur une machine enregistrée. */
export function runWhere(ctx: CareCtx, where: string, command: string, timeoutMs = 600_000): Promise<{ code: number | null; out: string }> {
  if (where && where !== 'local') {
    const m = findMachine(ctx.home, where);
    if (!m) return Promise.resolve({ code: -1, out: `machine inconnue : ${where}` });
    return runOnMachine(ctx.home, m, command, { timeoutMs });
  }
  return new Promise((resolve) => {
    const a = withAdmin(command, ctx.home);
    const child = process.platform === 'win32' ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }) : spawn('/bin/sh', ['-c', a.command], { env: { ...process.env, ...a.env } });
    let out = '';
    const add = (d: Buffer) => { if (out.length < 20_000) out += d.toString(); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

async function pveGuest(ctx: CareCtx, vmid: number): Promise<PveResource | undefined> {
  const rs = await pveApi(ctx.proxmox.url, ctx.proxmox.token, 'GET', '/cluster/resources?type=vm') as PveResource[];
  return rs.find((r) => r.vmid === vmid);
}
/** Action Proxmox simple : start, reboot, snapshot <nom>, rollback <nom>. */
export async function pveDo(ctx: CareCtx, vmid: number, action: 'start' | 'reboot' | 'snapshot' | 'rollback', snap?: string): Promise<string> {
  const g = await pveGuest(ctx, vmid);
  if (!g) throw new Error(`Proxmox : aucune VM ni conteneur n° ${vmid}`);
  const base = `/nodes/${encodeURIComponent(g.node)}/${g.type}/${vmid}`;
  if (action === 'snapshot') return String(await pveApi(ctx.proxmox.url, ctx.proxmox.token, 'POST', `${base}/snapshot`, { snapname: snap!, description: 'Avant mise à jour (Odin)' }));
  if (action === 'rollback') return String(await pveApi(ctx.proxmox.url, ctx.proxmox.token, 'POST', `${base}/snapshot/${encodeURIComponent(snap!)}/rollback`));
  return String(await pveApi(ctx.proxmox.url, ctx.proxmox.token, 'POST', `${base}/status/${action === 'start' && g.status === 'running' ? 'reboot' : action}`));
}

const audit = (ctx: CareCtx, what: string, ok: boolean) => { try { appendFileSync(join(ctx.logs, 'audit.jsonl'), `${JSON.stringify({ t: new Date().toISOString(), tool: 'vordr', summary: what, allowed: true, via: 'policy', ok })}\n`); } catch { /* journal indisponible */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vérifie les services ; répare ceux qui sont tombés (une tentative par 30 min) ; renvoie les messages pour toi. */
export async function careServices(ctx: CareCtx, services: Service[], o: { stateFile: string; now?: number; waitMs?: number; probeFn?: typeof probe } = { stateFile: '' }): Promise<string[]> {
  const now = o.now ?? Date.now(), p = o.probeFn ?? probe, msgs: string[] = [];
  let st: Record<string, { down?: number; tried?: number; alerted?: boolean }> = {};
  try { st = JSON.parse(readFileSync(o.stateFile, 'utf8')); } catch { /* premier passage */ }
  for (const s of services) {
    const k = st[s.id] ??= {};
    if (await p(s.check)) { if (k.down) msgs.push(`✅ ${s.name} répond de nouveau.`); delete st[s.id]; continue; }
    if (!k.down) k.down = now;
    if (!s.auto || (k.tried && now - k.tried < 30 * 60_000)) { if (!s.auto && !k.alerted) { k.alerted = true; msgs.push(`🔴 ${s.name} ne répond plus (${s.check}).`); } continue; }
    k.tried = now;
    let detail = '';
    try {
      const vm = /^proxmox:(\d+)$/.exec(s.where);
      if (vm) detail = `redémarrage Proxmox (tâche ${await pveDo(ctx, Number(vm[1]), 'start')})`;
      else { const r = await runWhere(ctx, s.where, s.repair, 180_000); detail = `« ${s.repair} » → code ${r.code}`; }
    } catch (e) { detail = `réparation impossible : ${(e as Error).message}`; }
    await sleep(o.waitMs ?? 20_000);
    const ok = await p(s.check);
    audit(ctx, `réparation automatique de ${s.name} : ${detail}`, ok);
    msgs.push(ok ? `🛠 ${s.name} ne répondait plus : je l'ai réparé (${detail}). Il refonctionne.` : `🔴 ${s.name} ne répond plus et ma réparation n'a pas suffi (${detail}). Il faut regarder.`);
    if (ok) delete st[s.id];
  }
  if (o.stateFile) writeFileSync(o.stateFile, JSON.stringify(st));
  return msgs;
}

// ---------------- Mises à jour planifiées ----------------

export interface UpdatePlan { enabled: boolean; weekday: number; hour: number; targets: Array<{ where: string; vmid?: number }>; rollbackOnFailure: boolean }
export const UPDATE_SCRIPT = 'export DEBIAN_FRONTEND=noninteractive; if command -v apt-get >/dev/null 2>&1; then sudo -E apt-get update -q && sudo -E apt-get -y -q -o Dpkg::Options::=--force-confold upgrade; elif command -v dnf >/dev/null 2>&1; then sudo dnf -y upgrade; elif command -v pacman >/dev/null 2>&1; then sudo pacman -Syu --noconfirm; elif command -v apk >/dev/null 2>&1; then sudo apk upgrade; else echo "gestionnaire de paquets inconnu"; exit 3; fi';

/** Machines à mettre à jour : celles choisies, sinon la machine d'Odin et toutes les machines où il a accès (pur). */
export function planTargets(plan: UpdatePlan, machines: Array<{ id: string }>): UpdatePlan['targets'] {
  return plan.targets.length ? plan.targets : [{ where: 'local' }, ...machines.map((m) => ({ where: m.id }))];
}
/** Services qui tournent (pour vérifier qu'ils tournent toujours après la mise à jour). */
export const RUNNING_SERVICES = "systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' | sort";
/** Services qui tournaient avant et plus après (pur). */
export function stoppedServices(before: string, after: string): string[] {
  const now = new Set(after.split('\n').map((x) => x.trim()).filter(Boolean));
  return before.split('\n').map((x) => x.trim()).filter((x) => /\.service$/.test(x) && !now.has(x) && !/^(apt|unattended|packagekit|fwupd|snapd\.|man-db|systemd-(tmpfiles|update)|user@|getty@)/.test(x));
}

/** Est-ce le moment de la mise à jour (une fois par jour prévu) ? */
export function updateDue(plan: UpdatePlan, stampFile: string, now = new Date()): boolean {
  if (!plan.enabled || now.getHours() < plan.hour) return false;
  if (plan.weekday >= 0 && now.getDay() !== plan.weekday) return false;
  return !(existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === now.toDateString());
}

/** Met à jour chaque machine : instantané Proxmox avant, mise à jour, vérification, retour arrière si demandé. */
export async function runUpdates(ctx: CareCtx, plan: UpdatePlan, stampFile: string, services: Service[] = [], now = new Date()): Promise<string> {
  writeFileSync(stampFile, now.toDateString());
  const lines: string[] = [], snap = `odin-maj-${now.toISOString().slice(0, 10).replace(/-/g, '')}`;
  for (const t of planTargets(plan, listMachines(ctx.home))) {
    const label = t.where === 'local' ? 'machine d\'Odin' : findMachine(ctx.home, t.where)?.label ?? t.where;
    let snapOk = false;
    if (t.vmid && ctx.proxmox.url && ctx.proxmox.token) {
      try { await pveDo(ctx, t.vmid, 'snapshot', snap); snapOk = true; await sleep(15_000); } catch (e) { lines.push(`⚠ ${label} : instantané impossible (${(e as Error).message}) — mise à jour annulée par prudence.`); continue; }
    }
    const before = (await runWhere(ctx, t.where, RUNNING_SERVICES, 60_000)).out;
    const r = await runWhere(ctx, t.where, UPDATE_SCRIPT, 1_800_000);
    const ok = r.code === 0;
    audit(ctx, `mise à jour planifiée de ${label}`, ok);
    if (ok) {
      // Redémarrage demandé par le système (noyau…) : seulement pour les autres machines, et on attend qu'elle revienne.
      let rebooted = '';
      if (t.where !== 'local' && (await runWhere(ctx, t.where, 'test -f /var/run/reboot-required && echo oui || true', 30_000)).out.includes('oui')) {
        await runWhere(ctx, t.where, 'sudo systemctl reboot || sudo reboot', 30_000);
        let back = false;
        for (let k = 0; k < 20 && !back; k++) { await sleep(15_000); back = (await runWhere(ctx, t.where, 'echo ok', 15_000)).out.includes('ok'); }
        rebooted = back ? ', redémarrée' : ', redémarrage en cours (ne répond pas encore)';
      } else if (t.where === 'local' && (await runWhere(ctx, 'local', 'test -f /var/run/reboot-required && echo oui || true', 30_000)).out.includes('oui')) rebooted = ', redémarrage conseillé quand tu veux';
      // Services arrêtés par la mise à jour : on les relance.
      const stopped = before.trim() ? stoppedServices(before, (await runWhere(ctx, t.where, RUNNING_SERVICES, 60_000)).out) : [];
      const fixed: string[] = [], still: string[] = [];
      for (const s of stopped) { const x = await runWhere(ctx, t.where, `sudo systemctl restart ${s.replace(/[^\w@.:-]/g, '')} && systemctl is-active ${s.replace(/[^\w@.:-]/g, '')}`, 60_000); (x.out.includes('active') && x.code === 0 ? fixed : still).push(s.replace(/\.service$/, '')); }
      lines.push(`✅ ${label} : à jour${snapOk ? ` (instantané « ${snap} » gardé)` : ''}${rebooted}.${fixed.length ? ` Relancé : ${fixed.join(', ')}.` : ''}${still.length ? ` ⚠ Ne redémarrent pas : ${still.join(', ')}.` : ''}`);
      if (still.length && snapOk && plan.rollbackOnFailure && t.vmid) { try { await pveDo(ctx, t.vmid, 'rollback', snap); lines.push(`↩ ${label} : services en panne après la mise à jour, je suis revenu à l'instantané « ${snap} ».`); } catch { /* signalé ci-dessus */ } }
      continue;
    }
    const tail = r.out.trim().split('\n').slice(-3).join(' · ').slice(0, 300);
    if (snapOk && plan.rollbackOnFailure && t.vmid) {
      try { await pveDo(ctx, t.vmid, 'rollback', snap); lines.push(`↩ ${label} : la mise à jour a échoué (${tail}) ; je suis revenu à l'instantané « ${snap} ».`); } catch (e) { lines.push(`🔴 ${label} : mise à jour échouée et retour arrière impossible (${(e as Error).message}).`); }
    } else lines.push(`🔴 ${label} : la mise à jour a échoué (${tail})${snapOk ? ` — instantané « ${snap} » disponible pour revenir en arrière` : ''}.`);
  }
  // Après les mises à jour, les services surveillés répondent-ils toujours ?
  const down: string[] = [];
  for (const s of services) if (!(await probe(s.check))) down.push(s.name);
  if (down.length) lines.push(`⚠ Après les mises à jour, ne répondent plus : ${down.join(', ')}.`);
  return `🔧 Mises à jour de la nuit\n${lines.join('\n')}`;
}
