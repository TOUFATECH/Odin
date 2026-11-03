// La passerelle : reçoit les messages de tous les canaux, applique l'appairage des
// inconnus, sérialise les tours par conversation, relaie les demandes de validation au
// propriétaire, et exécute les tâches planifiées.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Approver, ApprovalAnswer, ApprovalRequest } from '../heimdall/policy.ts';
import type { Odin } from '../runtime.ts';
import { nextRun } from '../cron/cron.ts';
import type { Channel, Inbound } from './channel.ts';
import { formatReport, hasChanges, type ScanReport } from '../hlidskjalf/inventory.ts';
import { type DiscoverFn, scanNetwork, shouldRunFull } from '../hlidskjalf/scan.ts';

export interface GatewayOptions {
  /** Identifiants des propriétaires par canal (ex. { telegram: ['123456'] }). */
  owners: Record<string, string[]>;
  tickMs?: number;
  /** Remplace la découverte réseau (tests). */
  discover?: DiscoverFn;
}

export class Gateway {
  private channels = new Map<string, Channel>();
  private queues = new Map<string, Promise<void>>();
  private aborts = new Map<string, AbortController>();
  private pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>();
  private timer?: NodeJS.Timeout;
  private scanning = false;

  private odin: Odin;
  private opts: GatewayOptions;
  constructor(odin: Odin, opts: GatewayOptions) {
    this.odin = odin;
    this.opts = opts;
    odin.heimdall.setApprover(this.approver);
  }

  add(ch: Channel): this { this.channels.set(ch.name, ch); return this; }

  async start(): Promise<void> {
    for (const ch of this.channels.values()) await ch.start((m) => this.handle(m));
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 30_000);
    console.log(`[bifrost] passerelle prête (${[...this.channels.keys()].join(', ') || 'aucun canal'})`);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const a of this.aborts.values()) a.abort();
    for (const ch of this.channels.values()) await ch.stop();
  }

  isOwner(channel: string, peer: string): boolean {
    const owners = this.opts.owners[channel] ?? [];
    return owners.includes('*') || owners.includes(peer);
  }

  async send(channel: string, peer: string, text: string): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch) throw new Error(`Canal inconnu ou inactif : ${channel}`);
    await ch.send(peer, text);
  }

  /** Point d'entrée de tout message entrant. */
  async handle(m: Inbound): Promise<void> {
    const ch = this.channels.get(m.channel)!;
    const owner = this.isOwner(m.channel, m.peer);
    const text = m.text.trim();

    // Commandes prioritaires, traitées même pendant qu'un tour est en cours.
    const cmd = text.match(/^\/(yes|no|oui|non|always|toujours)\s+(\S+)/i);
    if (cmd) {
      if (!owner) return ch.send(m.peer, 'Seul le propriétaire peut valider une action.');
      const resolve = this.pendingApprovals.get(cmd[2]);
      if (!resolve) return ch.send(m.peer, 'Demande inconnue ou expirée.');
      this.pendingApprovals.delete(cmd[2]);
      resolve(/^(always|toujours)$/i.test(cmd[1]) ? 'always' : /^(yes|oui)$/i.test(cmd[1]));
      return;
    }
    const sessionId = `${m.channel}:${m.peer}`;
    if (/^\/stop\b/i.test(text)) { this.aborts.get(sessionId)?.abort(); return ch.send(m.peer, '⏹ Arrêté.'); }

    // Appairage : un inconnu reçoit un code que le propriétaire doit approuver.
    if (!owner) {
      const status = this.odin.muninn.pairingStatus(m.channel, m.peer);
      if (status !== 'approved') {
        const code = this.odin.muninn.requestPairing(m.channel, m.peer, m.name);
        return ch.send(m.peer, `Bonjour ! Je ne te connais pas encore. Code d'appairage : ${code}\nDemande à mon propriétaire de lancer : odin pairing approve ${m.channel} ${code}\n(Ton identifiant ${m.channel} : ${m.peer} — si tu es le propriétaire, ajoute-le dans channels.${m.channel}.owners.)`);
      }
    }
    if (owner && /^\/pair\s+(\S+)/i.test(text)) {
      const r = this.odin.muninn.approvePairing(m.channel, text.split(/\s+/)[1]);
      return ch.send(m.peer, r ? `✅ ${r.name} est appairé.` : 'Code inconnu ou expiré.');
    }
    if (/^\/new\b/i.test(text)) { this.odin.muninn.resetSession(sessionId); return ch.send(m.peer, '🆕 Nouvelle conversation.'); }
    if (/^\/status\b/i.test(text)) {
      const u = this.odin.muninn.usageSince(Date.now() - 86_400_000);
      return ch.send(m.peer, `Odin en ligne. 24 h : ${u.tokens_in + u.tokens_out} jetons, ${u.cost_usd.toFixed(3)} $.`);
    }

    // Une file par conversation : les messages sont traités dans l'ordre, jamais en parallèle.
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => this.runTurn(m, ch, sessionId, owner)).catch((e) => console.error('[bifrost]', (e as Error).message));
    this.queues.set(sessionId, next);
    await next;
  }

  private async runTurn(m: Inbound, ch: Channel, sessionId: string, owner: boolean): Promise<void> {
    const ctrl = new AbortController();
    this.aborts.set(sessionId, ctrl);
    try {
      const r = await this.odin.agent.run(m.text, {
        sessionId, channel: m.channel, peer: m.peer, trusted: owner, signal: ctrl.signal,
        onEvent: (e) => {
          ch.event?.(m.peer, e);
          if (e.type === 'skill_proposed') void ch.send(m.peer, `💡 Nouvelle compétence proposée : ${e.name} (odin skills approve ${e.name})`);
        },
      });
      await ch.send(m.peer, (r.text || '(pas de réponse)') + decisionsFooter(r.decisions));
    } finally {
      this.aborts.delete(sessionId);
    }
  }

  /** Les validations partent vers le propriétaire sur un canal interactif. */
  readonly approver: Approver = {
    approve: async (req: ApprovalRequest) => {
      const target = this.approvalTarget(req.sessionId);
      if (!target) return false;
      const head = req.severity === 'grave' ? '🛑 Décision GRAVE : Odin a besoin de toi' : '⚠️ Odin demande une validation';
      const options = req.grantable ? `Réponds /yes ${req.id} · /always ${req.id} (toujours autoriser ce type d'action) · /no ${req.id}` : `Réponds /yes ${req.id} ou /no ${req.id}`;
      const msg = `${head}\nAction : ${req.summary}\nPourquoi : ${req.reason}\n${options}`;
      const answer = new Promise<ApprovalAnswer>((r) => this.pendingApprovals.set(req.id, r));
      await target.ch.send(target.peer, msg);
      return answer;
    },
  };

  private approvalTarget(sessionId: string): { ch: Channel; peer: string } | undefined {
    const [channel, ...rest] = sessionId.split(':');
    const peer = rest.join(':');
    const ch = this.channels.get(channel);
    if (ch?.interactive && this.isOwner(channel, peer)) return { ch, peer };
    return this.ownerTarget();
  }

  /** Premier propriétaire joignable sur un canal interactif (Telegram, interface web…). */
  ownerTarget(): { ch: Channel; peer: string } | undefined {
    for (const [name, owners] of Object.entries(this.opts.owners)) {
      const c = this.channels.get(name);
      const peer = owners[0] === '*' ? c?.defaultPeer : owners[0];
      if (c?.interactive && peer) return { ch: c, peer };
    }
    return undefined;
  }

  /** Lance un balayage du réseau maintenant et prévient le propriétaire des changements. */
  async scanNetwork(full: boolean): Promise<ScanReport | undefined> {
    if (this.scanning) return undefined;
    this.scanning = true;
    try {
      const r = await scanNetwork(this.odin.inventory, this.odin.cfg.network, full, this.opts.discover);
      if (this.odin.cfg.network.notify && hasChanges(r)) {
        const t = this.ownerTarget();
        if (t) await t.ch.send(t.peer, `🛰 Hliðskjálf — ${formatReport(r)}`).catch(() => {});
      }
      for (const ch of this.channels.values()) ch.notify?.('inventory');
      return r;
    } finally {
      this.scanning = false;
    }
  }

  /** Tâches planifiées : exécution sans surveillance (validations refusées). */
  async tick(now = Date.now()): Promise<void> {
    const net = this.odin.cfg.network;
    const last = this.odin.inventory.lastScan();
    if (net.enabled && (!last || now - last.at >= net.intervalMin * 60_000)) {
      void this.scanNetwork(shouldRunFull(this.odin.inventory, net.fullEvery)).catch((e) => console.error('[hlidskjalf]', (e as Error).message));
    }
    for (const job of this.odin.muninn.dueJobs(now)) {
      this.odin.muninn.advanceJob(job.id, now, nextRun(job.cron, new Date(now)).getTime());
      const r = await this.odin.agent.run(job.prompt, {
        sessionId: `cron:${job.id}`, channel: job.channel, peer: job.peer, trusted: true, unattended: true,
      }).catch((e) => ({ text: `Échec : ${(e as Error).message}` }));
      const text = `⏰ ${job.prompt.slice(0, 60)}\n\n${r.text}`;
      const ch = this.channels.get(job.channel);
      if (ch) await ch.send(job.peer, text).catch(() => {});
      else appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · ${job.id}\n${text}\n`);
    }
  }
}

/** Transparence : ce qu'Odin a décidé seul pendant le tour, en fin de réponse. */
export function decisionsFooter(d: Array<{ summary: string; via: 'mimir' | 'grant'; severity?: string; why: string }>): string {
  if (!d.length) return '';
  const items = d.slice(0, 6).map((x) => `• ${x.summary} — ${x.via === 'grant' ? 'autorisation permanente' : x.severity ?? 'routine'} : ${x.why}`);
  return `\n\n🛡 Décidé sans te déranger (${d.length}) :\n${items.join('\n')}${d.length > 6 ? `\n… et ${d.length - 6} autre(s) — voir le journal` : ''}`;
}
