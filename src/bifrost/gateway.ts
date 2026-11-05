// La passerelle : reçoit les messages de tous les canaux, applique l'appairage des
// inconnus, sérialise les tours par conversation, relaie les demandes de validation au
// propriétaire, et exécute les tâches planifiées.

import { MOODS, moodSticker } from '../mood/stickers.ts';
import { MOOD_EMOJI, type Mood } from '../mood/mood.ts';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Approver, ApprovalAnswer, ApprovalRequest } from '../heimdall/policy.ts';
import type { Odin } from '../runtime.ts';
import { nextRun } from '../cron/cron.ts';
import type { Channel, Inbound } from './channel.ts';
import { formatReport, hasChanges, type ScanReport } from '../hlidskjalf/inventory.ts';
import { type DiscoverFn, scanNetwork, shouldRunFull } from '../hlidskjalf/scan.ts';
import { autoBackup, healthCheck, newAlerts } from '../guard/watch.ts';
import { pushAll } from '../push/webpush.ts';
import { careServices, runUpdates, updateDue } from '../guard/care.ts';
import { indexDocs } from '../tools/docindex.ts';
import { voiceFor } from '../profiles.ts';
import { validHhmm } from '../mimir/decisions.ts';
import { speakAudio, toVoiceNote, ttsReady } from '../voice/voice.ts';

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
  /** Dernière humeur montrée par conversation (autocollant envoyé seulement quand elle change). */
  private lastMood = new Map<string, string>();
  private aborts = new Map<string, AbortController>();
  private pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>();
  private timer?: NodeJS.Timeout;
  private scanning = false;
  private ticking = false;

  private odin: Odin;
  private opts: GatewayOptions;
  constructor(odin: Odin, opts: GatewayOptions) {
    this.odin = odin;
    this.opts = opts;
    odin.heimdall.setApprover(this.approver);
  }

  add(ch: Channel): this { this.channels.set(ch.name, ch); return this; }

  /** Canaux qui n'ont pas pu démarrer (jeton Telegram invalide…) : affiché dans l'interface. */
  readonly failed = new Map<string, string>();

  async start(): Promise<void> {
    // Chaque canal démarre indépendamment : un jeton Telegram invalide ne doit pas priver de l'interface web.
    for (const ch of this.channels.values()) {
      try { await ch.start((m) => this.handle(m)); } catch (e) {
        this.failed.set(ch.name, (e as Error).message);
        this.channels.delete(ch.name);
        console.error(`[bifrost] canal ${ch.name} non démarré : ${(e as Error).message}`);
      }
    }
    if (!this.channels.size) throw new Error(`aucun canal n'a pu démarrer : ${[...this.failed.values()].join(' ; ')}`);
    this.timer = setInterval(() => { if (this.ticking) return; this.ticking = true; this.tick().catch((e) => console.error('[bifrost] tick :', (e as Error).message)).finally(() => { this.ticking = false; }); }, this.opts.tickMs ?? 30_000);
    console.log(`[bifrost] passerelle prête (${[...this.channels.keys()].join(', ') || 'aucun canal'})`);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const a of this.aborts.values()) a.abort();
    for (const ch of this.channels.values()) await ch.stop();
  }

  isOwner(channel: string, peer: string): boolean {
    const owners = this.opts.owners[channel] ?? [];
    return owners.includes('*') || owners.includes(peer) || this.odin.muninn.userFor(channel, peer)?.role === 'owner';
  }
  /** Qui parle : propriétaire, membre (famille, équipe) ou invité. */
  speakerOf(channel: string, peer: string, name = ''): { name: string; role: 'owner' | 'member' | 'guest'; autonomy?: 'prudent' | 'equilibre' | 'autonome' } {
    const u = this.odin.muninn.userFor(channel, peer);
    if (u) return { name: u.name, role: u.role, autonomy: u.role === 'member' ? u.autonomy : undefined };
    return { name: name || peer, role: this.isOwner(channel, peer) ? 'owner' : 'guest' };
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
      const ans = /^(always|toujours)$/i.test(cmd[1]) ? 'always' : /^(yes|oui)$/i.test(cmd[1]) ? 'yes' : 'no';
      resolve(ans === 'always' ? 'always' : ans === 'yes');
      for (const c of this.channels.values()) c.event?.(m.peer, { type: 'approval_done', id: cmd[2], answer: ans });
      return;
    }
    const sessionId = `${m.channel}:${m.peer}`;
    if (/^\/stop\b/i.test(text)) { this.aborts.get(sessionId)?.abort(); return ch.send(m.peer, '⏹ Arrêté.'); }

    const speaker = this.speakerOf(m.channel, m.peer, m.name);
    // Appairage : un inconnu reçoit un code que le propriétaire doit approuver.
    if (!owner && speaker.role !== 'member') {
      const status = this.odin.muninn.pairingStatus(m.channel, m.peer);
      if (status !== 'approved') {
        const code = this.odin.muninn.requestPairing(m.channel, m.peer, m.name);
        return ch.send(m.peer, `Bonjour ! Je ne te connais pas encore. Code d'appairage : ${code}\nDemande à mon propriétaire de lancer : odin pairing approve ${m.channel} ${code}\n(Ton identifiant ${m.channel} : ${m.peer} — si tu es le propriétaire, ajoute-le dans l'interface web, Réglages → Telegram.)`);
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
    const next = prev.then(() => this.runTurn(m, ch, sessionId, owner, speaker)).catch((e) => console.error('[bifrost]', (e as Error).message));
    this.queues.set(sessionId, next);
    await next;
  }

  private async runTurn(m: Inbound, ch: Channel, sessionId: string, owner: boolean, speaker?: ReturnType<Gateway['speakerOf']>): Promise<void> {
    const ctrl = new AbortController();
    this.aborts.set(sessionId, ctrl);
    try {
      const r = await this.odin.agent.run(m.text, {
        // Un membre est de confiance (son texte n'est pas une « donnée externe »), mais son autonomie est plafonnée.
        sessionId, channel: m.channel, peer: m.peer, trusted: owner || speaker?.role === 'member', signal: ctrl.signal, speaker,
        onEvent: (e) => {
          ch.event?.(m.peer, e);
          if (e.type === 'skill_proposed') void ch.send(m.peer, e.active ? `💡 Nouvelle compétence apprise, active tout de suite : ${e.name}` : `💡 Nouvelle compétence proposée : ${e.name} (odin skills approve ${e.name})`);
        },
      });
      // Son visage : l'autocollant de son humeur (ses yeux) quand elle change.
      const mood = r.mood && MOODS[r.mood] ? r.mood : undefined;
      if (mood && ch.sendSticker && this.odin.cfg.mood.stickers && this.lastMood.get(sessionId) !== mood) {
        const webp = moodSticker(mood);
        if (webp) await ch.sendSticker(m.peer, webp).catch((e) => console.error('[humeur]', (e as Error).message));
      }
      if (mood) this.lastMood.set(sessionId, mood);
      // Sa réaction : un émoji à la fin du texte (même taille que le texte), sur Telegram.
      const face = mood && ch.sendSticker && this.odin.cfg.mood.emoji ? ` ${MOOD_EMOJI[mood as Mood]}` : '';
      await ch.send(m.peer, (r.text || '(pas de réponse)') + face + decisionsFooter(r.decisions) + (r.notices.length ? `\n\nℹ️ ${r.notices.join(' ')}` : ''));
      // Tu as parlé : Odin te répond aussi à voix haute (note vocale), si la voix est réglée.
      if (m.voice && ch.sendVoice && this.odin.cfg.voice.voiceReplies && ttsReady(this.odin.cfg.voice) && r.text) {
        await speakAudio(r.text, voiceFor(this.odin.cfg.voice, this.odin.cfg), 'opus_48000_64').then((a) => toVoiceNote(a)).then((a) => ch.sendVoice!(m.peer, a)).catch((e) => console.error('[voix]', (e as Error).message));
      }
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
      // Canaux qui savent afficher une carte (interface web) : évènement typé, pas de détection par le texte.
      target.ch.event?.(target.peer, { type: 'approval', id: req.id, summary: req.summary, reason: req.reason, severity: req.severity, grantable: req.grantable });
      // Heimdall tranche « non » après approvalTimeoutSec ; on oublie la demande peu après pour ne pas accumuler.
      setTimeout(() => this.pendingApprovals.delete(req.id), (this.odin.cfg.policy.approvalTimeoutSec + 60) * 1000).unref?.();
      await target.ch.send(target.peer, msg);
      // La demande vient d'un membre : on le prévient que le propriétaire a été sollicité.
      const [sc, ...sp] = req.sessionId.split(':'); const sch = this.channels.get(sc); const speer = sp.join(':');
      if (sch?.interactive && (sc !== target.ch.name || speer !== target.peer) && this.odin.muninn.userFor(sc, speer)?.role === 'member') await sch.send(speer, `⏳ Cette action (${req.summary.slice(0, 80)}) demande l'accord du propriétaire : je lui ai transmis.`).catch(() => {});
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

  /** Arrête le tour en cours d'une session (bouton Arrêter de l'onglet Missions). */
  abortSession(sessionId: string): boolean { const a = this.aborts.get(sessionId); a?.abort(); return Boolean(a); }
  /** Relance une mission (« continue ») dans sa session, au nom du propriétaire. */
  async resume(sessionId: string, text = 'Continue la mission là où tu t\'étais arrêté.'): Promise<void> {
    const [channel, ...rest] = sessionId.split(':');
    const ch = this.channels.get(channel) ?? this.ownerTarget()?.ch;
    if (!ch) throw new Error('aucun canal pour reprendre cette mission');
    await this.handle({ channel: ch.name, peer: channel === ch.name ? rest.join(':') : (this.ownerTarget()?.peer ?? 'principal'), name: 'propriétaire', text });
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

  /** Envoie le rapport du soir une fois par jour quand Odin Breaker est choisi. */
  private async breakerReport(now: number): Promise<void> {
    const m = this.odin.cfg.mimir, at = m.breaker.reportAt;
    if (m.autonomy !== 'breaker' || !at || !validHhmm(at)) return;
    const d = new Date(now), [h, mi] = at.split(':').map(Number);
    if (d.getHours() * 60 + d.getMinutes() < h * 60 + mi) return;
    const stamp = join(this.odin.paths.logs, 'breaker-report.txt'), day = d.toDateString();
    if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === day) return;
    writeFileSync(stamp, day);
    let { text } = breakerDigest(join(this.odin.paths.logs, 'audit.jsonl'), now - 86_400_000);
    // Initiative du soir : Odin relit sa journée et met lui-même en place routines et rappels utiles.
    const t = this.ownerTarget();
    if (m.breaker.proactive && !this.odin.demo) {
      // Le bilan du soir (rapport à 21 h) peut tomber hors de la plage « nuit » : on applique Breaker le temps du bilan.
      const wasBreaker = this.odin.heimdall.breakerActive();
      if (!wasBreaker) this.odin.heimdall.setBreaker({ ...m.breaker, schedule: 'always' });
      const r = await this.odin.agent.run(PROACTIVE_PROMPT, { sessionId: 'breaker:soir', channel: t?.ch.name ?? 'web', peer: t?.peer ?? 'principal', trusted: true, unattended: true })
        .catch((e) => ({ text: `(bilan impossible : ${(e as Error).message.slice(0, 120)})` }));
      if (!wasBreaker) this.odin.heimdall.setBreaker(m.breaker);
      if (r.text.trim()) text = `${text || '⚡ Rapport du soir — Odin Breaker'}\n\n🧭 Initiative : ${r.text.trim().slice(0, 1200)}`;
    }
    if (text && t) await t.ch.send(t.peer, text).catch(() => {});
  }

  /** Tâches planifiées : exécution sans surveillance (validations refusées, sauf en Odin Breaker). */
  private lastWatch = 0;
  private lastCare = 0;
  private updating = false;
  private careCtx() { return { home: this.odin.paths.home, logs: this.odin.paths.logs, proxmox: { url: this.odin.cfg.proxmox.url, token: process.env.PROXMOX_TOKEN ?? '' } }; }
  /** Prévient le propriétaire (Telegram ou autre canal) et ses appareils (push). */
  private async tellOwner(text: string, view = 'home'): Promise<void> {
    const t = this.ownerTarget();
    if (t) await t.ch.send(t.peer, text).catch(() => {});
    void pushAll(this.odin.paths.home, { title: 'Odin', body: text, view, tag: 'odin-' + view }).catch(() => 0);
    for (const ch of this.channels.values()) ch.notify?.('watch');
  }

  /** Services surveillés (toutes les 5 min), mises à jour planifiées, journal du soir. */
  async care(now = Date.now()): Promise<void> {
    const cfg = this.odin.cfg;
    if (cfg.services.length && now - this.lastCare >= 5 * 60_000) {
      this.lastCare = now;
      const msgs = await careServices(this.careCtx(), cfg.services, { stateFile: join(this.odin.paths.logs, 'services.json'), now });
      if (msgs.length) await this.tellOwner(`🛡 Vörðr — services\n${msgs.join('\n')}`);
    }
    const stamp = join(this.odin.paths.logs, 'updates.txt');
    if (!this.updating && updateDue(cfg.updates, stamp, new Date(now))) {
      this.updating = true;
      void runUpdates(this.careCtx(), cfg.updates, stamp, cfg.services, new Date(now)).then((r) => this.tellOwner(r)).catch((e) => console.error('[mises à jour]', (e as Error).message)).finally(() => { this.updating = false; });
    }
    await this.journal(now).catch((e) => console.error('[journal]', (e as Error).message));
    // Index des documents : chaque nuit vers 3 h (seuls les fichiers modifiés sont relus).
    const dstamp = join(this.odin.paths.logs, 'docs-index.txt'), d = new Date(now);
    if (cfg.docs.dirs.length && d.getHours() >= 3 && !(existsSync(dstamp) && readFileSync(dstamp, 'utf8').trim() === d.toDateString())) {
      writeFileSync(dstamp, d.toDateString());
      try { const r = indexDocs(this.odin.muninn.db, cfg.docs.dirs); console.error(`[documents] ${r.files} fichiers, ${r.updated} relus`); } catch (e) { console.error('[documents]', (e as Error).message); }
    }
  }

  /** Journal de bord du soir (une fois par jour à journal.at). */
  async journal(now = Date.now(), force = false): Promise<string | undefined> {
    const j = this.odin.cfg.journal;
    if (!force && (!j.enabled || !validHhmm(j.at))) return undefined;
    const d = new Date(now), [h, mi] = j.at.split(':').map(Number), stamp = join(this.odin.paths.logs, 'journal.txt');
    if (!force && (d.getHours() * 60 + d.getMinutes() < h * 60 + mi || (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === d.toDateString()))) return undefined;
    writeFileSync(stamp, d.toDateString());
    const facts = dayFacts(this.odin, now);
    let text = `📓 Journal de bord — ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}\n${facts}`;
    if (!this.odin.demo) {
      const r = await this.odin.agent.run(`${JOURNAL_PROMPT}\n\n<faits>\n${facts}\n</faits>`, { sessionId: 'journal:soir', channel: 'web', peer: 'principal', trusted: true, unattended: true }).catch(() => undefined);
      if (r?.text.trim()) text = `📓 Journal de bord — ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}\n${r.text.trim().slice(0, 2500)}`;
    }
    await this.tellOwner(text, 'home');
    return text;
  }

  /** Vörðr : santé (appareils importants, disques, certificats) et sauvegarde de la nuit ; alertes au propriétaire. */
  async watch(now = Date.now(), force = false): Promise<string[]> {
    const w = this.odin.cfg.watch, msgs: string[] = [];
    const b = autoBackup(this.odin.paths, this.odin.cfg.autoBackup, new Date(now));
    if (b?.file) console.error(`[vörðr] sauvegarde : ${b.file}`);
    if (b?.error) msgs.push(`💾 ${b.error}`);
    if (w.enabled && (force || now - this.lastWatch >= w.intervalMin * 60_000)) {
      this.lastWatch = now;
      const alerts = await healthCheck({ devices: this.odin.inventory.list({ status: 'all' }), cfg: w, paths: this.odin.paths });
      msgs.push(...newAlerts(alerts, join(this.odin.paths.logs, 'watch.json'), now));
    }
    if (msgs.length) {
      const t = this.ownerTarget();
      if (t) await t.ch.send(t.peer, `🛡 Vörðr — surveillance\n${msgs.join('\n')}`).catch(() => {});
      void pushAll(this.odin.paths.home, { title: 'Odin — surveillance', body: msgs.join('\n'), view: 'home', tag: 'odin-veille' }).catch(() => 0);
      for (const ch of this.channels.values()) ch.notify?.('watch');
    }
    return msgs;
  }

  async tick(now = Date.now()): Promise<void> {
    await this.breakerReport(now).catch((e) => console.error('[breaker]', (e as Error).message));
    await this.watch(now).catch((e) => console.error('[vörðr]', (e as Error).message));
    await this.care(now).catch((e) => console.error('[soins]', (e as Error).message));
    const net = this.odin.cfg.network;
    const last = this.odin.inventory.lastScan();
    if (net.enabled && (!last || now - last.at >= net.intervalMin * 60_000)) {
      void this.scanNetwork(shouldRunFull(this.odin.inventory, net.fullEvery)).catch((e) => console.error('[hlidskjalf]', (e as Error).message));
    }
    for (const job of this.odin.muninn.dueJobs(now)) {
      if (job.cron === '@reminder') {
        // Rappel ponctuel : envoyé tel quel, puis supprimé.
        this.odin.muninn.removeJob(job.id);
        const ch = this.channels.get(job.channel) ?? this.ownerTarget()?.ch;
        const peer = this.channels.has(job.channel) ? job.peer : this.ownerTarget()?.peer;
        if (ch && peer) await ch.send(peer, `🔔 Rappel : ${job.prompt}`).catch(() => {});
        else appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · rappel\n${job.prompt}\n`);
        continue;
      }
      this.odin.muninn.advanceJob(job.id, now, nextRun(job.cron, new Date(now)).getTime());
      const r = await this.odin.agent.run(job.prompt, {
        // Une tâche née sous l'influence d'un contenu non fiable n'a pas la confiance du propriétaire.
        sessionId: `cron:${job.id}`, channel: job.channel, peer: job.peer, trusted: !job.tainted, unattended: true,
      }).catch((e) => ({ text: `Échec : ${(e as Error).message}` }));
      const text = `⏰ ${job.prompt.slice(0, 60)}\n\n${r.text}`;
      const ch = this.channels.get(job.channel);
      if (ch) await ch.send(job.peer, text).catch(() => {});
      else appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · ${job.id}\n${text}\n`);
    }
  }
}

/**
 * Rapport du soir d'Odin Breaker : ce qu'il a fait seul depuis 24 h, et ce qu'il a refusé
 * pour te protéger. Une fois par jour, à mimir.breaker.reportAt, au propriétaire.
 */
export function breakerDigest(auditFile: string, since: number): { text: string; actions: number } {
  const rows = existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>> : [];
  const recent = rows.filter((r) => Date.parse(String(r.t)) >= since);
  const done = recent.filter((r) => r.allowed === true && r.via === 'breaker');
  const refused = recent.filter((r) => r.allowed === false && String(r.reason ?? '').startsWith('Odin Breaker'));
  if (!done.length && !refused.length) return { text: '', actions: 0 };
  const hhmm = (t: unknown) => new Date(String(t)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const grave = done.filter((r) => r.severity === 'grave').length;
  const lines = [`⚡ Rapport du soir — Odin Breaker, dernières 24 h : ${done.length} action(s) faite(s) seul${grave ? `, dont ${grave} grave(s)` : ''}${refused.length ? ` · ${refused.length} refusée(s) pour te protéger` : ''}.`];
  for (const r of done.slice(-15)) lines.push(`• ${hhmm(r.t)} ${String(r.summary).slice(0, 140)}${r.severity ? ` (${r.severity})` : ''}`);
  if (done.length > 15) lines.push(`… et ${done.length - 15} autre(s) : onglet Décisions.`);
  for (const r of refused.slice(-5)) lines.push(`⛔ ${hhmm(r.t)} ${String(r.summary).slice(0, 120)} — ${String(r.reason).replace(/^Odin Breaker : /, '')}`);
  return { text: lines.join('\n'), actions: done.length };
}

const PROACTIVE_PROMPT = `Bilan du soir (Odin Breaker). Relis l'activité des dernières 24 heures (session_search, schedule_list, net_inventory, memory_search).
Si un besoin récurrent, une échéance ou un suivi utile apparaît, mets toi-même en place les tâches planifiées (schedule_task) ou rappels (reminder_set) qui manquent, sans doublon avec l'existant.
Réponds en trois lignes au plus : ce que tu as mis en place et pourquoi, ou « rien de nouveau ».`;

/** Transparence : ce qu'Odin a décidé seul pendant le tour, en fin de réponse. */
export function decisionsFooter(d: Array<{ summary: string; via: 'mimir' | 'grant' | 'breaker'; severity?: string; why: string }>): string {
  if (!d.length) return '';
  // Odin Breaker : il ne t'encombre pas ; une ligne, le détail est dans l'onglet Décisions et le rapport du soir.
  const breaker = d.filter((x) => x.via === 'breaker');
  const rest = d.filter((x) => x.via !== 'breaker');
  let out = '';
  if (rest.length) {
    const items = rest.slice(0, 6).map((x) => `• ${x.summary} — ${x.via === 'grant' ? 'autorisation permanente' : x.severity ?? 'routine'} : ${x.why}`);
    out += `\n\n🛡 Décidé sans te déranger (${rest.length}) :\n${items.join('\n')}${rest.length > 6 ? `\n… et ${rest.length - 6} autre(s) — voir le journal` : ''}`;
  }
  if (breaker.length) {
    const grave = breaker.filter((x) => x.severity === 'grave').length;
    out += `\n\n⚡ Odin Breaker : ${breaker.length} action(s) faite(s) sans te demander${grave ? `, dont ${grave} grave(s)` : ''} — détail dans Décisions et dans le rapport du soir.`;
  }
  return out;
}

const JOURNAL_PROMPT = `Écris ton journal de bord du soir pour le propriétaire, en français, court (10 lignes au plus) : ce que tu as fait aujourd'hui, ce que tu as remarqué (réseau, services, sécurité, sauvegardes), puis 1 à 3 conseils concrets pour demain. Appuie-toi UNIQUEMENT sur les faits ci-dessous ; n'invente rien, et dis-le s'il n'y a presque rien à signaler. N'agis pas : n'utilise aucun outil.`;

/** Les faits de la journée, pour le journal du soir (pur côté données). */
export function dayFacts(odin: { muninn: { listMissions(n: number): Array<{ goal: string; status: string; started_at: number; cost_usd: number }> }; inventory: { events(n: number): Array<{ kind: string; detail: string; at: number }> }; paths: { logs: string } }, now = Date.now()): string {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const since = start.getTime(), lines: string[] = [];
  const ms = odin.muninn.listMissions(200).filter((m) => m.started_at >= since);
  lines.push(`Missions : ${ms.length}${ms.length ? ` (${ms.filter((m) => m.status === 'terminée').length} terminée(s), ${ms.reduce((n, m) => n + m.cost_usd, 0).toFixed(2)} $)` : ''}`);
  for (const m of ms.slice(0, 8)) lines.push(`- ${m.goal.slice(0, 100)} → ${m.status}`);
  const ev = odin.inventory.events(300).filter((e) => e.at >= since);
  if (ev.length) lines.push(`Réseau : ${ev.length} évènement(s) — ${[...new Set(ev.map((e) => e.kind))].join(', ')}`);
  const auditFile = join(odin.paths.logs, 'audit.jsonl');
  if (existsSync(auditFile)) {
    const rows = readFileSync(auditFile, 'utf8').trim().split('\n').slice(-3000).map((l) => { try { return JSON.parse(l) as { t: string; allowed: boolean; summary?: string; tool?: string }; } catch { return null; } }).filter((r): r is NonNullable<typeof r> => Boolean(r) && Date.parse(r!.t) >= since);
    if (rows.length) lines.push(`Actions : ${rows.filter((r) => r.allowed).length} faite(s), ${rows.filter((r) => !r.allowed).length} refusée(s)`);
    for (const r of rows.filter((x) => x.tool === 'vordr').slice(-5)) lines.push(`- ${String(r.summary).slice(0, 120)}`);
  }
  return lines.join('\n');
}
