// La passerelle : reçoit les messages de tous les canaux, applique l'appairage des
// inconnus, sérialise les tours par conversation, relaie les demandes de validation au
// propriétaire, et exécute les tâches planifiées.

import { vendorOf } from '../hlidskjalf/vendors.ts';
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
import { auditNetwork, autoBackup, diskUsage, healthCheck, newAlerts } from '../guard/watch.ts';
import { pushAll } from '../push/webpush.ts';
import { vaultState } from '../vault.ts';
import { listScripts, parseScriptJob, type ScriptMeta } from '../tools/scripts.ts';
import { DEFAULT_CONFIG } from '../config.ts';
const DEFAULT_CONTINUOUS = DEFAULT_CONFIG.continuous;
import { gardenMemory, type GardenReport } from '../muninn/garden.ts';
import { extractSecret, keepSecret } from '../machines/onboard.ts';
import { careServices, runUpdates, updateDue } from '../guard/care.ts';
import { docDirs, indexDocs } from '../tools/docindex.ts';
import { voiceFor } from '../profiles.ts';
import { fetchEvents } from '../tools/calendar.ts';
import { anomalies, recoveryPlan, restoreTest, weeklyReport } from '../guard/insight.ts';
import { listMachines } from '../machines/access.ts';
import { validHhmm } from '../mimir/decisions.ts';
import { speakAudio, toVoiceNote, ttsReady } from '../voice/voice.ts';
import { armNag, clearNag, dueNags, isReminderJob, nags, reminderReply, reminderText, whenFr } from '../cron/reminders.ts';
import { morningBriefing } from './briefing.ts';
import { resolveShortcut } from '../learn/shortcuts.ts';
import { QUEUE_KEY, type QueuedAsk } from '../core/offline.ts';
import { applyParental, extend as extendParental } from '../home/parental.ts';
import { checkLocalAlerts } from '../guard/alerts.ts';
import { alarmTime, getAlarm, haPhoneAlarm, twilioCall, wakeText } from '../home/alarm.ts';
import { haApi, speakPlan, type HaState } from '../tools/homeassistant.ts';
import { diagnose, errorsSince, measure, trimLogs } from '../guard/selfcheck.ts';
import { budgetReport, checkPrices, getMode, modeFromText, setMode, upcomingCharges } from '../tools/everyday.ts';
import { syncMemoryFiles } from '../muninn/files.ts';
import { episodeText, saveThread, toArchive } from '../muninn/threads.ts';
import { applyUpdate as applyAppUpdate, checkForUpdate, lastUpdateInfo } from '../tools/update.ts';
import { learnEnvironment } from '../learn/environment-map.ts';
import { habitCron, habitEvents, habitPrompt, habitWhen, knownHabits, newHabits, pendingProposal, recordAsk, revokeTrust, setKnown, type Known, type Trust } from '../learn/habits.ts';

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
    // Confiance apprise : Odin te dit ce qu'il fera seul désormais, et comment revenir en arrière.
    const onLearned = (kv: unknown, tr: Trust) => { if (kv === odin.muninn) void this.tellOwner(`🧠 J'ai remarqué que tu acceptes toujours : « ${tr.example.slice(0, 120)} ». Désormais je le fais seul et je te le signale. Dis « redemande-moi » pour revenir comme avant.`, 'home', true).catch(() => {}); };
    habitEvents.on('learned', onLearned);
    this.offLearned = () => habitEvents.off('learned', onLearned);
  }
  private offLearned?: () => void;

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
    // Coffre verrouillé : Odin ne peut rien faire d'utile ; il te le dit (notification push, hors coffre).
    if (vaultState(this.odin.paths.home) === 'locked') void pushAll(this.odin.paths.home, { title: 'Odin — coffre verrouillé', body: 'Odin a redémarré : ouvre l\'application et déverrouille le coffre pour qu\'il reprenne le travail.', view: 'home', tag: 'odin-coffre' }).catch(() => 0);
    // Missions coupées par un redémarrage : Odin les reprend là où il en était.
    else if (this.odin.cfg.continuous?.autoResume && !this.odin.demo) {
      for (const m of this.odin.muninn.interruptedMissions(Date.now() - 86_400_000)) {
        this.odin.muninn.endMission(m.id, 'en attente', 'interrompue par un redémarrage');
        setTimeout(() => void this.resume(m.session_id, 'Odin a redémarré pendant ta mission : reprends-la là où tu t\'étais arrêté (vérifie d\'abord ce qui est déjà fait).').catch((e) => console.error('[reprise]', (e as Error).message)), 5000);
      }
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.offLearned?.();
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

  async send(channel: string, peer: string, text: string, opts?: { secret?: boolean }): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch) throw new Error(`Canal inconnu ou inactif : ${channel}`);
    await ch.send(peer, text, opts);
  }

  /** Point d'entrée de tout message entrant. */
  async handle(m: Inbound): Promise<void> {
    const ch = this.channels.get(m.channel)!;
    const owner = this.isOwner(m.channel, m.peer);
    // Un mot de passe dans le message du propriétaire : retiré AVANT le modèle, gardé à part (chiffré).
    if (owner) { const x = extractSecret(m.text); if (x.secret) { keepSecret(this.odin.paths.home, x.secret, x.label); this.odin.redactor.add(x.secret); m = { ...m, text: x.text }; } }
    const text = m.text.trim();

    // Commandes prioritaires, traitées même pendant qu'un tour est en cours.
    let cmd = text.match(/^\/(yes|no|oui|non|always|toujours)\s+(\S+)/i);
    // « oui », « non », « ok », « vas-y », « toujours »… tout court : la dernière demande en attente.
    const bare = text.match(/^\/?(yes|no|oui|non|nan|ok|okay|ouais|vas[- ]y|d'accord|daccord|go|always|toujours)[\s.!]*$/i);
    if (!cmd && bare && owner && this.pendingApprovals.size) cmd = Object.assign([text, bare[1], [...this.pendingApprovals.keys()].at(-1)!], { index: 0, input: text }) as RegExpMatchArray;
    else if (!cmd && bare && text.startsWith('/') && owner) return ch.send(m.peer, 'Aucune demande en attente : elle a peut-être expiré. Redemande-moi l\'action, je la referai.');
    if (cmd) {
      if (!owner) return ch.send(m.peer, 'Seul le propriétaire peut valider une action.');
      const resolve = this.pendingApprovals.get(cmd[2]);
      if (!resolve) return ch.send(m.peer, 'Demande inconnue ou expirée.');
      this.pendingApprovals.delete(cmd[2]);
      const ans = /^(always|toujours)$/i.test(cmd[1]) ? 'always' : /^(no|non|nan)$/i.test(cmd[1]) ? 'no' : 'yes';
      resolve(ans === 'always' ? 'always' : ans === 'yes');
      for (const c of this.channels.values()) c.event?.(m.peer, { type: 'approval_done', id: cmd[2], answer: ans });
      return;
    }
    // Réveil : « je suis réveillé » (ou n'importe quel message pendant que le réveil sonne), « encore 5 min ».
    const run = this.alarmRun();
    if (owner && run && !run.acked) {
      const sn = /^\/reveil (\d+)$/.exec(text) ?? (/^(encore|laisse[- ]moi|snooze)\b.*?(\d+)?\s*(min)?/i.exec(text) as RegExpExecArray | null);
      if (sn && !/^\/reveil ok/.test(text)) {
        const min = Number(sn[1] ?? sn[2]) || 5;
        this.odin.muninn.setKv('alarm-run', JSON.stringify({ ...run, next: Date.now() + min * 60_000 }));
        return ch.send(m.peer, `😴 D'accord, je te rappelle dans ${min} min.`);
      }
      this.odin.muninn.setKv('alarm-run', JSON.stringify({ ...run, acked: Date.now() }));
      setMode(this.odin.muninn, 'disponible', 0);
      if (/^\/reveil ok$|^(je suis |c'est bon,? je suis )?(r[ée]veill[ée]e?|debout|lev[ée]e?)(?![a-zà-ÿ])|^ok\b|^merci\b/i.test(text)) {
        await ch.send(m.peer, '☀️ Parfait, bonne journée ! Voici ton point du matin.');
        void this.morning(Date.now(), true).catch(() => undefined);
        return;
      }
    }
    // Contrôle parental : bouton « +30 min » sous l'avertissement.
    const pcx = /^\/parental (\S+) (\d+)$/.exec(text);
    if (owner && pcx) {
      const r = extendParental(this.odin.muninn, pcx[1], Number(pcx[2]));
      if (r && r.state === 'blocked') await applyParental({ kv: this.odin.muninn, home: this.odin.paths.home, inventory: this.odin.inventory as never }).catch(() => []);
      return ch.send(m.peer, r ? `✅ ${r.label} : Internet jusqu'à ${new Date(r.until!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` : 'Règle introuvable.');
    }
    // Mise à jour d'Odin : bouton « Mettre à jour » ou /update (propriétaire seulement).
    if (owner && /^\/(update|maj)\b/i.test(text)) {
      if (/plus tard/i.test(text)) return ch.send(m.peer, '👌 D\'accord, je te le redemanderai à la prochaine version.');
      await ch.send(m.peer, '⬆️ Je me mets à jour…');
      return ch.send(m.peer, await this.updateNow());
    }
    // Habitudes : réponse à une proposition (boutons /habitude oui|non, ou « oui » / « non » tout court), « redemande-moi ».
    const hb = /^\/habitude (oui|non)(?: (.+))?$/.exec(text);
    const prop = owner ? pendingProposal(this.odin.muninn) : undefined;
    if (owner && (hb || (prop && bare && !this.pendingApprovals.size))) {
      const yes = hb ? hb[1] === 'oui' : /^(yes|oui|ouais|ok|okay|vas[- ]y|d'accord|daccord|go|always|toujours)$/i.test(bare![1]);
      const k = hb?.[2] ? knownHabits(this.odin.muninn).find((x) => x.key === hb[2]) : prop;
      if (!k) return ch.send(m.peer, 'Proposition expirée.');
      return ch.send(m.peer, yes ? this.activateHabit(k, m.channel, m.peer) : (setKnown(this.odin.muninn, { ...k, state: 'refused', at: Date.now() }), '👌 Compris, je ne te le proposerai plus.'));
    }
    if (owner && /^(re)?demande[- ]moi( avant| d'abord| la permission)?\b/i.test(text) && text.length < 80) {
      const tr = revokeTrust(this.odin.muninn);
      if (tr) return ch.send(m.peer, `👌 D'accord, je te redemanderai avant de faire « ${tr.example.slice(0, 100)} ».`);
    }
    // Rappels : boutons « C'est fait / Plus tard » (/rappel …) ou réponse en texte juste après un rappel.
    const rc = /^\/rappel (done|later) (\S+)(?: (\d+))?$/.exec(text);
    if (rc && owner) {
      const n = clearNag(this.odin.muninn, rc[2]);
      if (rc[1] === 'done') return ch.send(m.peer, n ? `👍 Noté : « ${n.text.slice(0, 80)} » est réglé.` : '👍 Noté.');
      const min = Number(rc[3] ?? 60), when = rc[3] === '0' ? tomorrowAt9() : new Date(Date.now() + min * 60_000);
      if (n) this.addReminder(n.text, n.channel, n.peer, when);
      return ch.send(m.peer, `⏰ D'accord, je te le rappelle ${whenFr(when)}.`);
    }
    if (owner && nags(this.odin.muninn).some((x) => x.peer === m.peer && Date.now() - x.at < 12 * 3600_000)) {
      const rep = reminderReply(text);
      if (rep) {
        const n = clearNag(this.odin.muninn, undefined, m.peer)!;
        if ('done' in rep) return ch.send(m.peer, `👍 Parfait, « ${n.text.slice(0, 80)} » est réglé. Je n'insiste plus.`);
        this.addReminder(n.text, n.channel, n.peer, rep.snooze);
        return ch.send(m.peer, `⏰ D'accord, je te le rappelle ${whenFr(rep.snooze)}.`);
      }
    }
    // Ton mode du moment, dit en passant : « je conduis », « je suis en réunion », « bonne nuit », « je suis de retour ».
    if (owner) {
      const md = modeFromText(text);
      if (md) {
        const was = getMode(this.odin.muninn).mode;
        setMode(this.odin.muninn, md.mode, md.minutes);
        // De retour : ce qui a été gardé pendant la réunion ou la nuit arrive maintenant.
        if (md.mode === 'disponible' && was !== 'disponible') { const kept = JSON.parse(this.odin.muninn.getKv('deferred') ?? '[]') as string[]; if (kept.length) { this.odin.muninn.setKv('deferred', ''); await ch.send(m.peer, `— Pendant que tu étais occupé :\n${kept.join('\n\n').slice(0, 3000)}`).catch(() => {}); } }
      }
      // « Comme d'hab », « refais pareil » : Odin précise pour lui-même de quoi il s'agit.
      try {
        const journal = JSON.parse(this.odin.muninn.getKv('task-journal') ?? '[]');
        const hint = resolveShortcut(text, journal, knownHabits(this.odin.muninn));
        if (hint) m = { ...m, text: `${m.text}\n\n[Précision d'Odin pour lui-même : ${hint}]` };
      } catch { /* facultatif */ }
    }
    const sessionId = `${m.channel}:${m.peer}`;
    this.odin.muninn.setKv('last-inbound', String(Date.now()));
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
    if (owner && /^\/essai\b/i.test(text)) {
      const on = /\b(off|non|stop|0)\b/i.test(text) ? false : /\b(on|oui|1)\b/i.test(text) ? true : !this.odin.agent.dryRun();
      this.odin.agent.setDryRun(on);
      for (const c of this.channels.values()) c.notify?.('state');
      return ch.send(m.peer, on ? '🧪 Mode essai activé : je prépare et j\'explique tout, sans rien changer. (/essai off pour revenir)' : '✅ Mode essai coupé : j\'agis pour de vrai.');
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
    // « Odin écrit… » tant qu'il travaille (Telegram l'efface au bout de 5 s : on le renouvelle).
    const typing = ch.typing ? setInterval(() => void ch.typing!(m.peer), 4500) : undefined;
    void ch.typing?.(m.peer);
    const used: string[] = [];
    try {
      const r = await this.odin.agent.run(m.text, {
        // Un membre est de confiance (son texte n'est pas une « donnée externe »), mais son autonomie est plafonnée.
        sessionId, channel: m.channel, peer: m.peer, trusted: owner || speaker?.role === 'member', signal: ctrl.signal, speaker,
        onEvent: (e) => {
          if (e.type === 'tool_start') used.push(e.name);
          ch.event?.(m.peer, e);
          if (e.type === 'skill_proposed') void ch.send(m.peer, e.active ? `💡 Nouvelle compétence apprise, active tout de suite : ${e.name}` : `💡 Nouvelle compétence proposée : ${e.name} (odin skills approve ${e.name})`);
        },
      });
      // Habitudes : on retient ce que le propriétaire demande, et quand (jamais le contenu des réponses).
      if (owner && r.stopReason === 'done') { try { recordAsk(this.odin.muninn, m.text, used); } catch { /* pas bloquant */ } }
      // Son visage : l'autocollant de son humeur (ses yeux) quand elle change.
      const mood = r.mood && MOODS[r.mood] ? r.mood : undefined;
      if (mood && ch.sendSticker && this.odin.cfg.mood.stickers && this.lastMood.get(sessionId) !== mood) {
        const webp = moodSticker(mood);
        if (webp) await ch.sendSticker(m.peer, webp).catch((e) => console.error('[humeur]', (e as Error).message));
      }
      if (mood) this.lastMood.set(sessionId, mood);
      // Sa réaction : un émoji à la fin du texte (même taille que le texte), sur Telegram.
      // Sur Telegram, le canal ajoute son visage (émoji personnalisé, ou l'émoji classique) à la fin.
      const body = (r.text || '(pas de réponse)') + decisionsFooter(r.decisions) + (r.notices.length ? `\n\nℹ️ ${r.notices.join(' ')}` : '');
      // Texte seul : plus d'émoji ajouté à la fin (demande du propriétaire)
      await ch.send(m.peer, body, { final: true });
      // Tu as parlé : Odin te répond aussi à voix haute (note vocale), si la voix est réglée.
      // … ou quand tu le demandes (« réponds-moi en vocal », « dis-le à voix haute »).
      const askVoice = /\b(en vocal|vocalement|a voix haute|à voix haute|message vocal|note vocale|dis[- ]le moi)\b/i.test(m.text);
      const driving = owner && getMode(this.odin.muninn).mode === 'conduite';
      if ((m.voice && this.odin.cfg.voice.voiceReplies || askVoice || driving) && ch.sendVoice && ttsReady(this.odin.cfg.voice) && r.text) {
        await speakAudio(r.text, voiceFor(this.odin.cfg.voice, this.odin.cfg), 'opus_48000_64').then((a) => toVoiceNote(a)).then((a) => ch.sendVoice!(m.peer, a)).catch((e) => console.error('[voix]', (e as Error).message));
      }
    } finally {
      clearInterval(typing);
      this.aborts.delete(sessionId);
    }
  }

  /** Les validations partent vers le propriétaire sur un canal interactif. */
  readonly approver: Approver = {
    approve: async (req: ApprovalRequest) => {
      const target = this.approvalTarget(req.sessionId);
      if (!target) return false;
      const head = req.severity === 'grave' ? '🛑 Décision GRAVE : Odin a besoin de toi' : '⚠️ Odin demande une validation';
      const options = `Réponds oui ou non${req.grantable ? ' (ou « toujours » pour ne plus te le demander)' : ''}. Réf. /yes ${req.id}`;
      const msg = `${head}\nAction : ${req.summary}\nPourquoi : ${req.reason}\n${options}`;
      const answer = new Promise<ApprovalAnswer>((r) => this.pendingApprovals.set(req.id, r));
      // Canaux qui savent afficher une carte (interface web) : évènement typé, pas de détection par le texte.
      target.ch.event?.(target.peer, { type: 'approval', id: req.id, summary: req.summary, reason: req.reason, severity: req.severity, grantable: req.grantable });
      // Heimdall tranche « non » après approvalTimeoutSec ; on oublie la demande peu après pour ne pas accumuler.
      setTimeout(() => this.pendingApprovals.delete(req.id), (this.odin.cfg.policy.approvalTimeoutSec + 60) * 1000).unref?.();
      await target.ch.send(target.peer, msg, { approval: { id: req.id, grantable: req.grantable } });
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
  private lastEmbed = 0;
  private lastAgenda = 0;
  private updating = false;
  private careCtx() { return { home: this.odin.paths.home, logs: this.odin.paths.logs, proxmox: { url: this.odin.cfg.proxmox.url, token: process.env.PROXMOX_TOKEN ?? '' } }; }
  /** Prévient le propriétaire (Telegram ou autre canal) et ses appareils (push). */
  /** En ce moment, faut-il éviter de déranger (nuit, ou rendez-vous en cours) ? */
  quietNow(now = Date.now()): string | undefined {
    // Ton mode du moment (« bonne nuit », « je suis en réunion ») passe avant les horaires.
    const lm = getMode(this.odin.muninn, now);
    if (lm.mode === 'sommeil') return 'tu dors';
    if (lm.mode === 'reunion' || lm.mode === 'occupe') return lm.mode === 'reunion' ? 'tu es en réunion' : 'tu es occupé';
    const q = this.odin.cfg.quiet; if (!q?.enabled) return undefined;
    const d = new Date(now), m = d.getHours() * 60 + d.getMinutes(), toMin = (s: string) => { const [h, mi] = s.split(':').map(Number); return h * 60 + mi; };
    const a = toMin(q.from), b = toMin(q.to);
    if (a > b ? m >= a || m < b : m >= a && m < b) return 'nuit';
    if (q.agenda) { try { const ev = JSON.parse(this.odin.muninn.getKv('agenda-today') ?? '[]') as Array<{ start: number; end: number; title: string }>; const busy = ev.find((e) => e.start <= now && now < e.end); if (busy) return `rendez-vous « ${busy.title} »`; } catch { /* agenda indisponible */ } }
    return undefined;
  }

  private async tellOwner(text: string, view = 'home', urgent = false): Promise<void> {
    // Ne pas déranger : hors urgence, le message attend le rapport du matin (ou la fin du rendez-vous).
    // Discrétion « seulement l'urgent » : le reste attend le bilan, comme pendant « Ne pas déranger ».
    if (!urgent && (this.quietNow() || this.odin.muninn.getKv('discretion') === 'urgent')) {
      const l = JSON.parse(this.odin.muninn.getKv('deferred') ?? '[]') as string[]; l.push(text.slice(0, 1500)); this.odin.muninn.setKv('deferred', JSON.stringify(l.slice(-30)));
      for (const ch of this.channels.values()) ch.notify?.('watch');
      return;
    }
    const pending = JSON.parse(this.odin.muninn.getKv('deferred') ?? '[]') as string[];
    if (pending.length) { this.odin.muninn.setKv('deferred', ''); text = `${text}\n\n— Pendant que tu étais occupé :\n${pending.join('\n\n').slice(0, 3000)}`; }
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
      if (msgs.length) await this.tellOwner(`🛡 Vörðr — services\n${msgs.join('\n')}`, 'home', msgs.some((m) => m.startsWith('🔴')));
    }
    const stamp = join(this.odin.paths.logs, 'updates.txt');
    if (!this.updating && updateDue(cfg.updates, stamp, new Date(now))) {
      this.updating = true;
      void runUpdates(this.careCtx(), cfg.updates, stamp, cfg.services, new Date(now)).then((r) => this.tellOwner(r)).catch((e) => console.error('[mises à jour]', (e as Error).message)).finally(() => { this.updating = false; });
    }
    await this.journal(now).catch((e) => console.error('[journal]', (e as Error).message));
    await this.morning(now).catch((e) => console.error('[matin]', (e as Error).message));
    await this.breakerRoutines(now).catch((e) => console.error('[routines]', (e as Error).message));
    await this.garden(now).catch((e) => console.error('[mémoire]', (e as Error).message));
    await this.continuous(now).catch((e) => console.error('[travail continu]', (e as Error).message));
    await this.weekly(now).catch((e) => console.error('[semaine]', (e as Error).message));
    // Agenda du jour en cache (contexte de ta journée, « ne pas déranger » pendant un rendez-vous).
    if (process.env.CALENDAR_ICS_URL && now - this.lastAgenda >= 30 * 60_000) {
      this.lastAgenda = now;
      const from = new Date(now); from.setHours(0, 0, 0, 0);
      try { const ev = await fetchEvents(from, new Date(from.getTime() + 2 * 86_400_000)); this.odin.muninn.setKv('agenda-days', JSON.stringify(ev.filter((e) => e.allDay).map((e) => ({ start: e.start.getTime(), end: (e.end ?? new Date(e.start.getTime() + 86_400_000)).getTime(), title: e.title.slice(0, 80), allDay: true })))); this.odin.muninn.setKv('agenda-today', JSON.stringify(ev.filter((e) => !e.allDay).map((e) => ({ start: e.start.getTime(), end: (e.end ?? new Date(e.start.getTime() + 3600_000)).getTime(), title: e.title.slice(0, 80) })))); } catch { /* agenda injoignable : on garde l'ancien */ }
    }
    // Mémoire : vecteurs des nouveaux souvenirs (recherche par le sens) ; oubli des souvenirs périmés, une fois par jour.
    const emb = this.odin.agent.deps.embedder;
    if (emb && now - this.lastEmbed >= 5 * 60_000) {
      this.lastEmbed = now;
      for (const m of this.odin.muninn.missingVectors(emb.model, 40)) { try { this.odin.muninn.setVector(m.id, emb.model, await emb.embed(m.content)); } catch { break; } }
    }
    const mstamp = join(this.odin.paths.logs, 'memory-decay.txt');
    if (!(existsSync(mstamp) && readFileSync(mstamp, 'utf8').trim() === new Date(now).toDateString())) { writeFileSync(mstamp, new Date(now).toDateString()); const n = this.odin.muninn.decay(now); if (n) console.error(`[mémoire] ${n} souvenir(s) périmé(s) oublié(s)`); }
    // Index des documents : chaque nuit vers 3 h (seuls les fichiers modifiés sont relus).
    const dstamp = join(this.odin.paths.logs, 'docs-index.txt'), d = new Date(now);
    const ddirs = docDirs(cfg.docs.dirs, this.odin.paths.workspace);
    if (ddirs.length && d.getHours() >= 3 && !(existsSync(dstamp) && readFileSync(dstamp, 'utf8').trim() === d.toDateString())) {
      writeFileSync(dstamp, d.toDateString());
      try { const r = indexDocs(this.odin.muninn.db, ddirs); console.error(`[documents] ${r.files} fichiers, ${r.updated} relus`); } catch (e) { console.error('[documents]', (e as Error).message); }
    }
  }

  private lastContinuous = 0;
  private wasBreaker = false;
  /**
   * Travail continu, sans pause : toutes les N minutes (si Odin ne travaille pas déjà), il relance
   * les missions coupées ou échouées, puis cherche lui-même ce qui est utile (alertes, sécurité,
   * habitudes…) et le fait — dans ton budget du jour. Ce qui demande ta validation attend ton accord.
   */
  async continuous(now = Date.now(), force = false): Promise<string | undefined> {
    const c = { ...DEFAULT_CONTINUOUS, ...this.odin.cfg.continuous };
    const breakerOn = this.odin.heimdall.breakerActive(new Date(now));
    // Odin Breaker = carte blanche : il travaille de lui-même même si le « travail continu » est coupé.
    if (!(c.enabled || breakerOn) || this.odin.demo || this.aborts.size || vaultState(this.odin.paths.home) === 'locked') return undefined;
    if (breakerOn && !this.wasBreaker) this.lastContinuous = 0; // Breaker vient de s'allumer : il s'y met tout de suite
    this.wasBreaker = breakerOn;
    if (!force && now - this.lastContinuous < (breakerOn ? Math.min(c.intervalMin * 0.5, 15) : c.intervalMin) * 60_000) return undefined;
    this.lastContinuous = now;
    if (breakerOn) await this.breakerRound(now).catch((e) => console.error('[ronde]', (e as Error).message));
    // 1. Relancer les missions échouées (modèle indisponible) ou arrêtées faute d'étapes.
    for (const m of this.odin.muninn.stalledMissions(now - 2 * 86_400_000)) {
      const why = this.odin.muninn.getKv(`mission-stop:${m.id}`) ?? '';
      if (!['error', 'max_steps', 'loop'].includes(why) && m.status !== 'échouée') continue;
      const n = Number(this.odin.muninn.getKv(`mission-retry:${m.id}`) ?? 0);
      if (n >= c.maxRetries || m.session_id.startsWith('auto:')) continue;
      this.odin.muninn.setKv(`mission-retry:${m.id}`, String(n + 1));
      await this.resume(m.session_id, `Reprends la mission « ${m.goal.slice(0, 120)} » (essai ${n + 2}) : vérifie ce qui est déjà fait, puis termine-la.`).catch(() => undefined);
      return 'reprise';
    }
    // 2. Initiative : budget du jour respecté.
    const day = new Date(now).toDateString(), spentKey = `continuous-spent:${day}`;
    const spent = Number(this.odin.muninn.getKv(spentKey) ?? 0);
    // Odin Breaker : plus de moyens (budget ×3) et une vraie liste de choses à faire, sans attendre d'accord.
    const breaker = this.odin.heimdall.breakerActive();
    if (c.dailyBudgetUsd > 0 && spent >= c.dailyBudgetUsd * (breaker ? 3 : 1)) { this.odin.muninn.setKv('continuous-why', `budget du jour atteint (${spent.toFixed(2)} $)`); return undefined; }
    const todo = continuousTodo(this.odin);
    const facts = [...(todo.length ? ['À FAIRE (repéré par Odin) :', ...todo.map((x) => `- ${x}`)] : []), dayFacts(this.odin, now), ...(this.odin.inventory.list({ status: 'all' }).filter((d) => d.status === 'offline').slice(0, 5).map((d) => `Hors ligne : ${d.label || d.name || d.ip}`)), ...this.odin.muninn.habits().slice(0, 3).map((h) => `Demande fréquente : « ${h.text.slice(0, 80)} » (${h.count} fois)`)].join('\n');
    this.odin.muninn.setKv('continuous-why', `${todo.length} chose(s) à faire repérée(s)`);
    const r = await this.odin.agent.run(`${breaker ? CONTINUOUS_BREAKER : CONTINUOUS_PROMPT}\n\n<situation>\n${facts}\n</situation>`, { sessionId: 'auto:veille', channel: 'web', peer: 'principal', trusted: true, unattended: true }).catch(() => undefined);
    if (!r) return undefined;
    this.odin.muninn.setKv(spentKey, String(spent + r.costUsd));
    const text = r.text.trim();
    if (text && !/^(rien|RIEN)\b/.test(text) && r.toolCalls > 0) { this.breakerLog(`${text.split('\n')[0].slice(0, 200)}`, now); await this.tellOwner(`🔄 Odin a travaillé de lui-même\n${text.slice(0, 1200)}`, 'home'); }
    return text;
  }

  /**
   * Odin Breaker : il met lui-même en place les tâches planifiées logiques d'un homelab (une fois ;
   * il ne recrée pas celles que tu as supprimées) et te le dit.
   */
  /** Journal visible de ce qu'Odin a fait de lui-même (onglet Breaker / Accueil). */
  breakerLog(text: string, now = Date.now()): void {
    let log: Array<{ at: number; text: string }> = [];
    try { log = JSON.parse(this.odin.muninn.getKv('breaker-log') ?? '[]'); } catch { /* vide */ }
    log.unshift({ at: now, text: text.slice(0, 240) });
    this.odin.muninn.setKv('breaker-log', JSON.stringify(log.slice(0, 40)));
    for (const ch of this.channels.values()) ch.notify?.('state');
  }

  /**
   * Ronde du Breaker, sans modèle : balayage du réseau s'il date (même si le balayage auto est coupé),
   * contrôle de sécurité, disques. Ce qu'elle trouve alimente la liste « À FAIRE » du travail continu.
   */
  async breakerRound(now = Date.now()): Promise<string> {
    const last = this.odin.inventory.lastScan(), parts: string[] = [];
    if (!last || now - last.at >= 45 * 60_000) {
      const full = !last || shouldRunFull(this.odin.inventory, this.odin.cfg.network.fullEvery || 6);
      const r = await this.scanNetwork(full).catch(() => undefined);
      if (r) parts.push(`réseau balayé${full ? ' (complet)' : ''} : ${r.seen} appareil(s)${r.added.length ? `, ${r.added.length} nouveau(x)` : ''}${r.macAlerts?.length ? `, ${r.macAlerts.length} alerte(s) MAC` : ''}`);
    }
    const f = auditNetwork(this.odin.inventory.list({ status: 'online' }), now).filter((x) => x.level !== 'info');
    if (f.length) parts.push(`${f.length} risque(s) de sécurité repéré(s)`);
    const full = diskUsage([this.odin.paths.home, '/']).filter((d) => d.usedPct >= 90);
    if (full.length) parts.push(`disque presque plein : ${full.map((d) => `${d.path} ${d.usedPct} %`).join(', ')}`);
    const text = parts.length ? `Ronde : ${parts.join(' · ')}` : '';
    if (text) this.breakerLog(text, now);
    this.odin.muninn.setKv('breaker-round', JSON.stringify({ at: now, text: text || 'Ronde : rien d\'anormal' }));
    return text;
  }

  async breakerRoutines(now = Date.now()): Promise<number> {
    if (this.odin.demo || !this.odin.heimdall.breakerActive(new Date(now))) return 0;
    const done = new Set((this.odin.muninn.getKv('breaker-routines') ?? '').split(',').filter(Boolean));
    const target = this.ownerTarget(); if (!target) return 0;
    const jobs = this.odin.muninn.listJobs();
    const add: Array<[string, string, string]> = BREAKER_ROUTINES.filter(([id]) => !done.has(id) && !jobs.some((j) => j.prompt.includes(`[routine:${id}]`)));
    for (const [id, cron, prompt] of add) {
      this.odin.muninn.addJob({ id: `job_${id}_${now.toString(36)}`, cron, prompt: `[routine:${id}] ${prompt}`, channel: target.ch.name, peer: target.peer, next_run: nextRun(cron, new Date(now)).getTime(), tainted: 0 });
      done.add(id);
    }
    this.odin.muninn.setKv('breaker-routines', [...done].join(','));
    if (add.length) await this.tellOwner(`⚡ Odin Breaker : j'ai planifié ${add.length} tâche(s) de fond :\n${add.map(([, c, p]) => `- ${cronFr(c)} : ${p.split(' : ')[0]}`).join('\n')}\nTu les vois (et peux les retirer) dans Tâches planifiées.`, 'jobs');
    return add.length;
  }

  /** Rangement de la mémoire : une fois par jour (la nuit de préférence), quand Odin ne travaille pas. */
  async garden(now = Date.now(), force = false): Promise<GardenReport | undefined> {
    if (this.odin.demo || this.aborts.size) return undefined;
    const d = new Date(now), stamp = this.odin.muninn.getKv('memory-garden-day');
    if (!force && (stamp === d.toDateString() || (d.getHours() >= 7 && d.getHours() < 23))) return undefined;
    this.odin.muninn.setKv('memory-garden-day', d.toDateString());
    const devs = this.odin.inventory.list({ status: 'all' }).filter((x) => x.label || x.name || x.hostname).slice(0, 60).map((x) => `${x.ip} = ${x.label || x.name || x.hostname} (${x.kind}${x.status !== 'online' ? ', hors ligne' : ''})`);
    const { identityLine } = await import('../tools/scripts.ts');
    const facts = [identityLine(), `Appareils connus : ${devs.join(' ; ') || 'aucun'}`, `Date : ${d.toLocaleDateString('fr-FR', { dateStyle: 'full' })}`].join('\n');
    const rep = await gardenMemory(this.odin.muninn, (s, u, m) => this.odin.agent.ask(s, u, m), facts, now).catch(() => undefined);
    if (rep && rep.updated + rep.merged + rep.forgotten) this.odin.muninn.setKv('memory-garden-note', `🧹 Mémoire rangée : ${rep.updated} amélioré(s), ${rep.merged} fusionné(s), ${rep.forgotten} oublié(s).`);
    return rep;
  }

  /** Chaque dimanche : test de restauration de la dernière sauvegarde, plan de reprise à jour, bilan de la semaine. */
  async weekly(now = Date.now(), force = false): Promise<string | undefined> {
    const d = new Date(now), stamp = join(this.odin.paths.logs, 'weekly.txt');
    const [h] = (this.odin.cfg.journal.at ?? '21:30').split(':').map(Number);
    if (!force && (d.getDay() !== 0 || d.getHours() < h || (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === d.toDateString()))) return undefined;
    writeFileSync(stamp, d.toDateString());
    const parts = [weeklyReport(this.odin.muninn.listMissions(1000), this.odin.muninn.lessons('', 500), now)];
    if (this.odin.cfg.autoBackup.enabled) { const r = restoreTest(this.odin.paths, this.odin.cfg.autoBackup); parts.push(`${r.ok ? '✅' : '🔴'} Test de restauration : ${r.text}.`); }
    { const sh = skillsHealth(this.odin.skills.list(), this.odin.muninn.skillStats(), listScripts(this.odin.paths.workspace), now); if (sh) parts.push(sh); }
    try { recoveryPlan({ cfg: this.odin.cfg, paths: this.odin.paths, devices: this.odin.inventory.list({ status: 'all' }), machines: listMachines(this.odin.paths.home) }); parts.push('📄 Plan de reprise mis à jour (plan-de-reprise.md dans l\'espace de travail).'); } catch { /* facultatif */ }
    const text = parts.join('\n');
    await this.tellOwner(text, 'home', parts.some((p) => p.startsWith('🔴')));
    return text;
  }

  /**
   * Mises à jour publiées : vérifiées toutes les 6 h. Mode « notify » (défaut) : Odin te prévient une
   * fois par version, avec un bouton « Mettre à jour ». Mode « auto » (ou Breaker) : il se met à jour
   * seul quand il ne travaille pas et que personne ne lui a écrit depuis 15 min, puis te dit ce qui change.
   * Après un redémarrage dû à une mise à jour, il annonce la nouvelle version.
   */
  async updateLoop(now = Date.now(), force = false): Promise<void> {
    const kv = this.odin.muninn;
    // Annonce après redémarrage
    const done = kv.getKv('updated-to');
    if (done) {
      const { appVersions } = await import('../tools/self.ts');
      const [, to] = done.split('→');
      if (appVersions().running === to) { kv.setKv('updated-to', ''); const ch = (kv.getKv('update-changes') ?? '').split('\n').filter(Boolean).slice(0, 6); kv.setKv('update-changes', ''); await this.tellOwner(`✅ Odin est à jour : v${done.replace('→', ' → v')}.${ch.length ? `\nNouveautés :\n${ch.map((c) => `• ${c.replace(/^v[\d.]+\s*:\s*/, '')}`).join('\n')}` : ''}`, 'home').catch(() => {}); }
    }
    const cfg = this.odin.cfg.update ?? { auto: 'notify', everyHours: 6 };
    if (this.odin.demo || cfg.auto === 'off') return;
    const last = Number(kv.getKv('update-checked') ?? 0);
    if (!force && now - last < Math.max(1, cfg.everyHours) * 3600_000) return;
    kv.setKv('update-checked', String(now));
    const info = await checkForUpdate(undefined, now);
    kv.setKv('update-info', JSON.stringify(info));
    for (const c of this.channels.values()) c.notify?.('version');
    if (!info.available || !info.canApply) return;
    const auto = cfg.auto === 'auto' || this.odin.heimdall.breakerActive();
    const idle = !this.aborts.size && now - Number(kv.getKv('last-inbound') ?? 0) > 15 * 60_000;
    if (auto && idle) { const msg = await this.updateNow(); if (!/redémarre/.test(msg)) await this.tellOwner(msg, 'home').catch(() => {}); return; }
    if (kv.getKv('update-told') === info.latest) return;
    kv.setKv('update-told', info.latest);
    const t = this.ownerTarget();
    const text = `⬆️ Nouvelle version d'Odin : v${info.latest} (tu as la v${info.current}).\n${info.changes.slice(0, 6).map((c) => `• ${c.replace(/^v[\d.]+\s*:\s*/, '')}`).join('\n')}${auto ? '\nJe la mettrai en place dès que je ne travaille plus.' : '\nTouche « Mettre à jour » (ou dis « mets-toi à jour ») : je reviens en quelques secondes.'}`;
    if (t) await t.ch.send(t.peer, text, auto ? undefined : { update: { version: info.latest } }).catch(() => {});
    void pushAll(this.odin.paths.home, { title: 'Odin — nouvelle version', body: `v${info.latest} est disponible`, view: 'settings', tag: 'odin-maj' }).catch(() => 0);
  }

  /** Met Odin à jour maintenant (vérifie le nouveau code, revient en arrière s'il ne se charge pas), puis redémarre. */
  async updateNow(): Promise<string> {
    if (this.odin.demo) return 'Mode démo : pas de mise à jour.';
    const before = lastUpdateInfo(this.odin.muninn);
    if (before?.changes.length) this.odin.muninn.setKv('update-changes', before.changes.join('\n'));
    const r = applyAppUpdate();
    this.odin.muninn.setKv('update-info', JSON.stringify(await checkForUpdate().catch(() => lastUpdateInfo(this.odin.muninn))));
    for (const c of this.channels.values()) c.notify?.('version');
    if (!r.ok) return `⚠️ ${r.message}`;
    if (!r.restart) return `✅ ${r.message}`;
    this.odin.muninn.setKv('updated-to', `${r.from}→${r.to}`);
    if (process.env.ODIN_NO_RESTART) return `✅ ${r.message}\n(redémarrage simulé)`;
    const { restartSelf } = await import('../tools/self.ts');
    restartSelf(3000);
    return `✅ ${r.message}\nJe redémarre : je reviens dans quelques secondes.`;
  }

  /**
   * Nouvelle version installée (git pull, mise à jour par Hermes…) mais pas encore chargée : quand
   * Odin ne travaille pas, il vérifie que le nouveau code se charge, puis redémarre tout seul.
   */
  async applyUpdate(): Promise<boolean> {
    if (this.odin.demo || process.env.ODIN_NO_RESTART || this.aborts.size) return false;
    const { appVersions, checkApp, restartSelf } = await import('../tools/self.ts');
    const v = appVersions();
    if (!v.disk || v.disk === v.running) return false;
    if (this.odin.muninn.getKv('update-tried') === v.disk) return false;
    this.odin.muninn.setKv('update-tried', v.disk);
    const c = checkApp(undefined, false);
    if (!c.ok) { await this.tellOwner(`⚠️ La version ${v.disk} d'Odin est installée mais ne se charge pas : je reste en ${v.running}.\n${c.output.slice(0, 600)}`, 'home', true); return false; }
    this.odin.muninn.setKv('updated-to', `${v.running}→${v.disk}`);
    restartSelf(1500);
    return true;
  }

  /**
   * Habitudes (une fois par jour, en fin de matinée) : une demande que tu fais presque chaque jour à la
   * même heure (ou chaque semaine le même jour). Autonome ou Breaker : Odin la prépare tout seul dès
   * maintenant et te prévient ; sinon il te le propose (oui / non). Une proposition à la fois.
   */
  async habits(now = Date.now(), force = false): Promise<Known | undefined> {
    const d = new Date(now), stamp = this.odin.muninn.getKv('habits-day');
    if (!force && (stamp === d.toDateString() || d.getHours() < 10)) return undefined;
    this.odin.muninn.setKv('habits-day', d.toDateString());
    if (pendingProposal(this.odin.muninn, now)) return undefined;
    const h = newHabits(this.odin.muninn, now)[0];
    const t = this.ownerTarget();
    if (!h || !t) return undefined;
    const k: Known = { key: h.key, state: 'proposed', at: now, habit: h };
    const auto = this.odin.cfg.mimir.autonomy === 'breaker' || this.odin.cfg.mimir.autonomy === 'autonome';
    if (auto) { await t.ch.send(t.peer, this.activateHabit(k, t.ch.name, t.peer, true)).catch(() => {}); return k; }
    setKnown(this.odin.muninn, k);
    await t.ch.send(t.peer, `🧠 J'ai remarqué que tu me demandes souvent « ${h.sample.slice(0, 120)} » ${habitWhen(h)}.\nVeux-tu que je le prépare tout seul, juste avant, et que je te l'envoie ?`, { habit: { key: h.key } }).catch(() => {});
    return k;
  }
  /** Met l'habitude en place (tâche planifiée 10 min avant l'heure habituelle) ; renvoie le message pour le propriétaire. */
  private activateHabit(k: Known, channel: string, peer: string, self = false): string {
    const id = `hab_${Date.now().toString(36)}`, cron = habitCron(k.habit);
    this.odin.muninn.addJob({ id, cron, prompt: habitPrompt(k.habit), channel, peer, next_run: nextRun(cron, new Date()).getTime(), tainted: 0 });
    setKnown(this.odin.muninn, { ...k, state: 'active', at: Date.now(), jobId: id });
    for (const c of this.channels.values()) c.notify?.('jobs');
    const when = cronFr(cron);
    return self
      ? `🧠 J'ai remarqué que tu me demandes souvent « ${k.habit.sample.slice(0, 120)} » ${habitWhen(k.habit)}. Désormais je le prépare tout seul (${when}) et je te l'envoie. Dis « oublie cette habitude » pour arrêter.`
      : `✅ C'est noté : je le prépare tout seul (${when}) et je te l'envoie. Dis « oublie cette habitude » pour arrêter.`;
  }

  /**
   * Veille (une fois par jour, à l'heure choisie) : Odin déduit tes centres d'intérêt de ce qu'il sait de
   * toi (préférences, projets, conversations récentes), cherche sur Internet ce qui est NOUVEAU, et
   * t'envoie 3 à 5 trouvailles avec leurs liens. Tu dis « plus de ça » ou « moins de ça » : il apprend.
   */
  async veille(now = Date.now(), force = false): Promise<string | undefined> {
    const v = this.odin.cfg.veille ?? { enabled: true, at: '12:30' };
    if (this.odin.demo || !v.enabled) return undefined;
    const d = new Date(now), [h, mi] = v.at.split(':').map(Number), kv = this.odin.muninn;
    if (!force && (kv.getKv('veille-day') === d.toDateString() || d.getHours() * 60 + d.getMinutes() < h * 60 + mi)) return undefined;
    kv.setKv('veille-day', d.toDateString());
    const about = kv.listMemories(400).filter((m) => m.origin !== 'untrusted' && /preference|person|project|mission/.test(m.kind)).slice(0, 40).map((m) => `- ${m.content.slice(0, 160)}`).join('\n');
    const recent = (await import('../muninn/threads.ts')).allThreads(kv).filter((t) => !t.tainted && now - t.updated < 14 * 86_400_000).slice(0, 10).map((t) => `- ${t.title || t.goal}`).join('\n');
    if (!about && !recent) return undefined;
    const sent = (kv.getKv('veille-sent') ?? '').split('\n').filter(Boolean).slice(-80);
    const prompt = `Veille pour le propriétaire (sans qu'il l'ait demandé). D'après ce que tu sais de lui :\n${about || '(peu de chose)'}\nSes sujets récents :\n${recent || '(aucun)'}\n\nDéduis 3 ou 4 centres d'intérêt, cherche sur le web ce qui est NOUVEAU (moins de 7 jours) et vraiment utile ou intéressant pour lui (actualité de ses sujets, nouvelles versions de ses logiciels, bons plans, évènements près de chez lui). Ne reprends pas ces liens déjà envoyés :\n${sent.join('\n') || '(aucun)'}\n\nRéponds avec 3 à 5 trouvailles, chacune : un titre court, une phrase sur pourquoi ça le concerne, le lien. Si rien de valable, réponds seulement « RIEN ».`;
    const r = await this.odin.agent.run(prompt, { sessionId: 'auto:veille', channel: 'web', peer: 'principal', trusted: true, unattended: true }).catch(() => undefined);
    if (!r || r.offline || r.stopReason !== 'done' || /^\s*RIEN\b/.test(r.text)) return undefined;
    const links = r.text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
    kv.setKv('veille-sent', [...sent, ...links].slice(-120).join('\n'));
    const text = `🔭 Ce que j'ai trouvé pour toi aujourd'hui :\n\n${r.text.trim()}\n\nDis-moi « plus de ça » ou « moins de ça » : j'ajuste ma veille.`;
    await this.tellOwner(text, 'home').catch(() => {});
    return text;
  }

  /** Réveil en cours (aujourd'hui) : tentatives, prochaine sonnerie, réveillé ou non. */
  private alarmRun(): { date: string; kind: string; attempt: number; next: number; acked?: number } | undefined {
    try { const r = JSON.parse(this.odin.muninn.getKv('alarm-run') ?? 'null'); return r && r.date === new Date().toDateString() ? r : undefined; } catch { return undefined; }
  }

  async alarmTick(now = Date.now()): Promise<boolean> {
    const kv = this.odin.muninn, a = getAlarm(kv);
    if (!a.enabled) return false;
    const d = new Date(now);
    let agenda: Array<{ start: number; end: number; title: string }> = [];
    try { agenda = [...JSON.parse(kv.getKv('agenda-days') ?? '[]'), ...JSON.parse(kv.getKv('agenda-today') ?? '[]')]; } catch { /* sans agenda */ }
    const due = alarmTime(a, d, agenda);
    let run = this.alarmRun();
    if (!run) {
      // On ne sonne pas pour un réveil passé depuis plus d'une heure (Odin redémarré dans la matinée).
      if (!due || now < due.at.getTime() || now - due.at.getTime() > 3600_000) return false;
      run = { date: d.toDateString(), kind: due.kind, attempt: 0, next: now };
    }
    if (run.acked || now < run.next || run.attempt >= 7) return false;
    await this.wakeUp(run.kind, run.attempt, now);
    kv.setKv('alarm-run', JSON.stringify({ ...run, attempt: run.attempt + 1, next: now + 5 * 60_000 }));
    return true;
  }

  /** Une sonnerie : appel, alarme sur le téléphone, enceintes, message avec boutons, note vocale, notification. Passe toujours (même « Ne pas déranger »). */
  private async wakeUp(kind: string, attempt: number, now: number): Promise<void> {
    const a = getAlarm(this.odin.muninn), text = wakeText(kind, new Date(now), attempt), jobs: Array<Promise<unknown>> = [];
    if (a.phone && a.twilioFrom && process.env.TWILIO_ACCOUNT_SID) jobs.push(twilioCall(a.phone, a.twilioFrom, `${text} Réponds-moi « je suis réveillé » sur ton téléphone.`));
    const ha = this.odin.cfg.homeAssistant?.url, haTok = process.env.HA_TOKEN;
    if (ha && haTok && a.haPhone) jobs.push(haPhoneAlarm(ha, haTok, a.haPhone, text));
    if (ha && haTok && a.speaker) jobs.push((async () => { const states = await haApi(ha, haTok, 'GET', '/states') as HaState[]; const plan = speakPlan(states, a.speaker!, text); await haApi(ha, haTok, 'POST', plan.path, plan.data); })());
    const t = this.ownerTarget();
    if (t) {
      jobs.push(t.ch.send(t.peer, `⏰ ${text}`, { alarm: { attempt } }));
      if (t.ch.sendVoice && ttsReady(this.odin.cfg.voice)) jobs.push(speakAudio(text, voiceFor(this.odin.cfg.voice, this.odin.cfg), 'opus_48000_64').then((x) => toVoiceNote(x)).then((x) => t.ch.sendVoice!(t.peer, x)));
    }
    jobs.push(pushAll(this.odin.paths.home, { title: '⏰ Réveil', body: text, view: 'home', tag: 'odin-reveil' }));
    for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') console.error('[réveil]', (r.reason as Error)?.message);
  }

  /** Réessaie la plus ancienne question gardée ; si un modèle répond, envoie la vraie réponse. */
  async retryOffline(now = Date.now()): Promise<boolean> {
    const kv = this.odin.muninn;
    let l: QueuedAsk[] = []; try { l = JSON.parse(kv.getKv(QUEUE_KEY) ?? '[]') as QueuedAsk[]; } catch { /* vide */ }
    l = l.filter((q) => now - q.at < 2 * 86_400_000 && q.tries < 30);
    const q = l[0];
    if (!q) { kv.setKv(QUEUE_KEY, '[]'); return false; }
    const r = await this.odin.agent.run(q.text, { sessionId: q.sessionId, channel: q.channel, peer: q.peer, unattended: true }).catch(() => undefined);
    if (!r || r.offline || r.stopReason === 'error') { q.tries++; kv.setKv(QUEUE_KEY, JSON.stringify(l)); return false; }
    kv.setKv(QUEUE_KEY, JSON.stringify(l.slice(1)));
    const ch = this.channels.get(q.channel);
    const text = `🔌 Le modèle est revenu. Je reviens sur ta question de ${new Date(q.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (« ${q.text.slice(0, 80)} ») :\n\n${r.text}`;
    if (ch) await ch.send(q.peer, text).catch(() => {}); else await this.tellOwner(text).catch(() => {});
    return true;
  }

  /** Auto-surveillance, réparations sans risque, prix suivis, prélèvements à venir (chaque heure). */
  async selfCheck(now = Date.now()): Promise<string[]> {
    const kv = this.odin.muninn, told = JSON.parse(kv.getKv('selfcheck-told') ?? '{}') as Record<string, number>, sent: string[] = [];
    const say = async (key: string, text: string, urgent = false) => { if (now - (told[key] ?? 0) < 86_400_000) return; told[key] = now; sent.push(text); await this.tellOwner(text, 'home', urgent).catch(() => {}); };
    trimLogs(this.odin.paths.logs);
    const failed = kv.listMissions(200).filter((x) => x.status === 'échouée' && now - (x.ended_at ?? x.started_at) < 86_400_000).length;
    const m = measure(this.odin.paths.home, this.odin.paths.db);
    for (const d of diagnose({ ...m, errorsLastHour: errorsSince(now - 3600_000), failedMissions: failed, monthCost: kv.monthCost(), budget: this.odin.cfg.routing.monthlyBudgetUsd })) {
      if (d.fix === 'vacuum' && new Date(now).getHours() >= 2 && new Date(now).getHours() < 5) { try { kv.db.exec('VACUUM'); } catch { /* plus tard */ } continue; }
      await say(d.key, d.text, d.key === 'disk');
    }
    if (!this.odin.demo) {
      for (const msg of await checkPrices(kv, now).catch(() => [])) await say(`prix:${msg.slice(0, 40)}`, msg);
      if (new Date(now).getHours() >= 9) for (const s of upcomingCharges(kv, now, 2)) await say(`prelev:${s.name}:${new Date(now).toDateString()}`, `💳 Prélèvement dans 2 jours : ${s.name}, ${s.amount.toFixed(2).replace('.', ',')} €.`);
    }
    kv.setKv('selfcheck-told', JSON.stringify(told));
    return sent;
  }

  /** Envoie un rappel (avec les boutons « C'est fait » / « Plus tard » sur Telegram) ; jamais retenu par « Ne pas déranger ». */
  private async sendReminder(id: string, text: string, channel: string, peer: string, relance: number): Promise<{ ch: string; peer: string } | false> {
    const ch = this.channels.get(channel) ?? this.ownerTarget()?.ch;
    const to = this.channels.has(channel) ? peer : this.ownerTarget()?.peer;
    if (!ch || !to) return false;
    const head = relance ? `🔔 Rappel (je reviens vers toi${relance > 1 ? `, ${relance}ᵉ fois` : ''}) : ${text}` : `🔔 Rappel : ${text}`;
    const hint = ch.name === 'telegram' ? '' : '\nRéponds « fait » quand c\'est réglé, ou « plus tard » (« dans 20 min », « demain »…).';
    await ch.send(to, head + hint, { reminder: { id } });
    void pushAll(this.odin.paths.home, { title: 'Odin — rappel', body: text, view: 'home', tag: `odin-rappel-${id}` }).catch(() => 0);
    return { ch: ch.name, peer: to };
  }
  /** Programme un rappel ponctuel (« plus tard »). */
  addReminder(text: string, channel: string, peer: string, when: Date): string {
    const id = `rem_${Date.now().toString(36)}`;
    this.odin.muninn.addJob({ id, cron: '@reminder', prompt: text.slice(0, 1000), channel, peer, next_run: when.getTime(), tainted: 0 });
    for (const c of this.channels.values()) c.notify?.('jobs');
    return id;
  }

  /** Rapport du matin : la nuit d'Odin, ce qui attend ta validation, ses conseils (une fois par jour). */
  async morning(now = Date.now(), force = false): Promise<string | undefined> {
    const at = this.odin.cfg.journal.morning;
    if (!force && (!this.odin.cfg.journal.enabled || !at || !validHhmm(at))) return undefined;
    const d = new Date(now), [h, mi] = (at ?? '07:00').split(':').map(Number), stamp = join(this.odin.paths.logs, 'morning.txt');
    if (!force && (d.getHours() * 60 + d.getMinutes() < h * 60 + mi || d.getHours() >= 12 || (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === d.toDateString()))) return undefined;
    writeFileSync(stamp, d.toDateString());
    const facts = dayFacts(this.odin, now, now - 12 * 3600_000);
    let night = facts;
    const waiting = JSON.parse(this.odin.muninn.getKv('deferred') ?? '[]') as string[];
    if (!this.odin.demo) {
      const r = await this.odin.agent.run(`${MORNING_PROMPT}\n\n<faits>\n${facts}${waiting.length ? `\nMessages gardés pendant la nuit :\n${waiting.join('\n').slice(0, 4000)}` : ''}\n</faits>`, { sessionId: 'journal:matin', channel: 'web', peer: 'principal', trusted: true, unattended: true }).catch(() => undefined);
      if (r?.text.trim()) night = r.text.trim().slice(0, 1500);
    }
    // Briefing : météo, agenda, mails, rappels du jour, machines (assemblé par le code : le contenu des mails ne passe jamais par le modèle).
    const b = await morningBriefing(this.odin, night, now).catch((e) => ({ text: `☀️ Bonjour !\n\n🌙 ${night}\n(briefing incomplet : ${(e as Error).message})`, speech: '' }));
    if (waiting.length) this.odin.muninn.setKv('deferred', '');
    const t = this.ownerTarget();
    if (t) await t.ch.send(t.peer, b.text + (waiting.length ? `\n\n— Gardé pendant la nuit :\n${waiting.join('\n\n').slice(0, 2500)}` : '')).catch(() => {});
    void pushAll(this.odin.paths.home, { title: 'Odin — briefing du matin', body: b.text.slice(0, 400), view: 'home', tag: 'odin-matin' }).catch(() => 0);
    for (const ch of this.channels.values()) ch.notify?.('watch');
    // Version à écouter (note vocale), si tu l'as demandée et que la voix est prête.
    if (this.odin.cfg.journal.morningVoice && b.speech && t?.ch.sendVoice && ttsReady(this.odin.cfg.voice)) {
      await speakAudio(b.speech, voiceFor(this.odin.cfg.voice, this.odin.cfg), 'opus_48000_64').then((a) => toVoiceNote(a)).then((a) => t.ch.sendVoice!(t.peer, a)).catch((e) => console.error('[matin voix]', (e as Error).message));
    }
    return b.text;
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
      // Ce qui sort de l'ordinaire (appareil inconnu la nuit, surcharge, disque qui se remplit vite).
      for (const a of anomalies({ kv: this.odin.muninn, events: this.odin.inventory.events(100), devices: this.odin.inventory.list({ status: 'all' }), paths: this.odin.paths, now })) {
        const k = `anom:${a.key}`, last = Number(this.odin.muninn.getKv(k) ?? 0);
        if (now - last > 86_400_000) { this.odin.muninn.setKv(k, String(now)); msgs.push(a.text); }
      }
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
    await this.applyUpdate().catch((e) => console.error('[mise à jour]', (e as Error).message));
    await this.updateLoop(now).catch((e) => console.error('[mise à jour]', (e as Error).message));
    const net = this.odin.cfg.network;
    const last = this.odin.inventory.lastScan();
    if (net.enabled && (!last || now - last.at >= net.intervalMin * 60_000)) {
      void this.scanNetwork(shouldRunFull(this.odin.inventory, net.fullEvery)).catch((e) => console.error('[hlidskjalf]', (e as Error).message));
    }
    await this.habits(now).catch((e) => console.error('[habitudes]', (e as Error).message));
    // Mémoire en fichiers (USER.md, MEMORY.md) : tes corrections à la main sont prises, puis les fichiers sont réécrits (10 min).
    if (now - Number(this.odin.muninn.getKv('memfiles-tick') ?? 0) >= 10 * 60_000) {
      this.odin.muninn.setKv('memfiles-tick', String(now));
      try { const r = syncMemoryFiles(this.odin.paths.home, this.odin.muninn); if (r.edited + r.added + r.forgotten) console.error(`[mémoire] fichiers : ${r.edited} corrigé(s), ${r.added} ajouté(s), ${r.forgotten} oublié(s)`); } catch (e) { console.error('[mémoire]', (e as Error).message); }
    }
    // Conversations au repos depuis 2 h : leur fil devient un souvenir, retrouvé quand on en reparle.
    for (const th of toArchive(this.odin.muninn, now).slice(0, 5)) {
      try { this.odin.muninn.remember(episodeText(th), 'agent', 'episode', '', { subject: `conversation:${th.sessionId}`, topic: 'resume', source: `conversation du ${new Date(th.updated).toLocaleDateString('fr-FR')}` }); } catch { /* facultatif */ }
      saveThread(this.odin.muninn, { ...th, archived: now });
    }
    // Questions gardées pendant une panne de modèle : on réessaie toutes les 10 min, et on répond pour de vrai.
    if (!this.odin.demo && now - Number(this.odin.muninn.getKv('offline-tick') ?? 0) >= 10 * 60_000) {
      this.odin.muninn.setKv('offline-tick', String(now));
      await this.retryOffline(now).catch((e) => console.error('[hors ligne]', (e as Error).message));
    }
    // Réveil : à l'heure du jour (travail / repos / vacances), puis toutes les 5 min tant que tu n'es pas réveillé.
    await this.alarmTick(now).catch((e) => console.error('[réveil]', (e as Error).message));
    // Contrôle parental : horaires appliqués chaque minute, avertissement 10 min avant avec « prolonger ».
    for (const msg of await applyParental({ kv: this.odin.muninn, home: this.odin.paths.home, inventory: this.odin.inventory as never }, new Date(now)).catch(() => [])) {
      const t2 = this.ownerTarget();
      if (msg.warnId && t2) await t2.ch.send(t2.peer, msg.text, { parental: { id: msg.warnId } }).catch(() => {});
      else await this.tellOwner(msg.text, 'net').catch(() => {});
    }
    // Alertes locales (météo dangereuse, cyclone, coupures…) : toutes les 2 h ; l'urgent passe même la nuit.
    const al = this.odin.cfg.alerts ?? { enabled: true, region: '' };
    if (!this.odin.demo && al.enabled && now - Number(this.odin.muninn.getKv('alerts-tick') ?? 0) >= 2 * 3600_000) {
      this.odin.muninn.setKv('alerts-tick', String(now));
      for (const a of await checkLocalAlerts(this.odin.muninn, this.odin.cfg.journal.city ?? '', al.region, new Date(now)).catch(() => [])) await this.tellOwner(a.text, 'home', a.urgent).catch(() => {});
    }
    // Mises à jour de nuit pas encore activées alors qu'Odin gère des machines : il le propose une fois (ou l'active en autonome).
    if (!this.odin.demo && !this.odin.cfg.updates.enabled && !this.odin.muninn.getKv('maint-proposed') && new Date(now).getHours() >= 19 && listMachines(this.odin.paths.home).length) {
      this.odin.muninn.setKv('maint-proposed', String(now));
      const auto = this.odin.cfg.mimir.autonomy === 'breaker' || this.odin.cfg.mimir.autonomy === 'autonome';
      if (auto) {
        const { setConfigValue } = await import('../config.ts');
        const plan = { ...this.odin.cfg.updates, enabled: true, weekday: 0, hour: 4, rollbackOnFailure: true };
        try { setConfigValue(this.odin.paths, ['updates'], plan); this.odin.cfg.updates = plan; await this.tellOwner('🔧 J\'ai activé les mises à jour de tes machines chaque dimanche à 4 h (instantané avant, services vérifiés, retour arrière si ça casse). Dis « pas de mises à jour de nuit » pour arrêter.', 'home'); } catch { /* config invalide : on laisse */ }
      } else await this.tellOwner('🔧 Je peux mettre à jour tes machines la nuit (dimanche 4 h) : instantané avant quand c\'est possible, services vérifiés et relancés, retour arrière si ça casse, compte rendu le matin. Dis « oui, mets à jour mes machines la nuit » pour l\'activer.', 'home');
    }
    // Veille du jour : ce qui peut t'intéresser, trouvé sans que tu demandes.
    await this.veille(now).catch((e) => console.error('[veille]', (e as Error).message));
    // Chaque heure : Odin se surveille lui-même, vérifie les prix suivis et les prélèvements qui arrivent.
    if (now - Number(this.odin.muninn.getKv('selfcheck-tick') ?? 0) >= 3600_000) {
      this.odin.muninn.setKv('selfcheck-tick', String(now));
      await this.selfCheck(now).catch((e) => console.error('[auto-surveillance]', (e as Error).message));
    }
    // Apprentissage de l'environnement (présence des appareils, rôles, ENVIRONMENT.md) : chaque heure.
    if (now - Number(this.odin.muninn.getKv('envlearn-tick') ?? 0) >= 3600_000) {
      this.odin.muninn.setKv('envlearn-tick', String(now));
      try { const alerts = learnEnvironment(this.odin, now, listMachines(this.odin.paths.home).map((m) => ({ label: m.label, host: m.host, user: m.user }))); if (alerts.length) await this.tellOwner(`🏠 Ce qui change dans ton environnement :\n${alerts.join('\n')}`, 'home'); } catch (e) { console.error('[environnement]', (e as Error).message); }
    }
    // Relances des rappels pas encore réglés (30 min, 1 h, 2 h).
    for (const n of dueNags(this.odin.muninn, now)) await this.sendReminder(n.id, n.text, n.channel, n.peer, n.n).catch(() => {});
    for (const job of this.odin.muninn.dueJobs(now)) {
      if (isReminderJob(job)) {
        // Rappel : envoyé avec ses boutons, puis relancé tant que ce n'est pas fait. Ponctuel : supprimé ; récurrent : prochaine date.
        if (job.cron === '@reminder') this.odin.muninn.removeJob(job.id);
        else this.odin.muninn.advanceJob(job.id, now, nextRun(job.cron, new Date(now)).getTime());
        const text = reminderText(job), id = job.cron === '@reminder' ? job.id : `${job.id}_${now.toString(36)}`;
        const sent = await this.sendReminder(id, text, job.channel, job.peer, 0).catch(() => false as const);
        if (sent) armNag(this.odin.muninn, { id, text, channel: sent.ch, peer: sent.peer }, now);
        else appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · rappel\n${text}\n`);
        continue;
      }
      this.odin.muninn.advanceJob(job.id, now, nextRun(job.cron, new Date(now)).getTime());
      // Script programmé : il tourne directement, sans le modèle (rapide, gratuit) ; on ne te dérange que s'il échoue.
      const sj = parseScriptJob(job.prompt);
      if (sj) {
        const { scriptRun } = await import('../tools/scripts.ts');
        const out = job.tainted ? 'Refusé : tâche créée après lecture d\'un contenu non fiable.' : await scriptRun.run({ name: sj.name, args: sj.args, where: sj.where }, { workspace: this.odin.paths.workspace, home: this.odin.paths.home, redactor: this.odin.redactor, muninn: this.odin.muninn, signal: AbortSignal.timeout(3600_000), sessionId: `cron:${job.id}`, channel: job.channel, peer: job.peer, isTainted: () => false } as never).then((x) => (typeof x === 'string' ? x : x.output)).catch((e) => `ÉCHEC : ${(e as Error).message}`);
        const failed = /ÉCHEC|Refusé|✗|code de sortie [1-9]/.test(out);
        appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · script ${sj.name}\n${out.slice(-3000)}\n`);
        if (failed || sj.report) await this.tellOwner(`${failed ? '⚠️' : '✅'} Script programmé « ${sj.name} »${sj.where !== 'local' ? ` (${sj.where})` : ''}\n${out.slice(-1500)}`, 'skills', failed).catch(() => {});
        continue;
      }
      const r = await this.odin.agent.run(job.prompt, {
        // Une tâche née sous l'influence d'un contenu non fiable n'a pas la confiance du propriétaire.
        sessionId: `cron:${job.id}`, channel: job.channel, peer: job.peer, trusted: !job.tainted, unattended: true,
      }).catch((e) => ({ text: `Échec : ${(e as Error).message}` }));
      const text = job.prompt.startsWith('[habitude]') ? `🧠 Comme d'habitude :\n\n${r.text}` : `⏰ ${job.prompt.slice(0, 60)}\n\n${r.text}`;
      const ch = this.channels.get(job.channel);
      if (ch) await ch.send(job.peer, text).catch(() => {});
      else appendFileSync(join(this.odin.paths.logs, 'cron.md'), `\n## ${new Date(now).toISOString()} · ${job.id}\n${text}\n`);
    }
  }
}

/** Santé des compétences et des scripts : à améliorer (échecs fréquents), à ranger (inutilisés). Pur, testable. */
export function skillsHealth(skills: Array<{ name: string }>, stats: Array<{ name: string; uses: number; last_used: number; ok: number; fails: number }>, scripts: ScriptMeta[], now = Date.now()): string {
  const weak = stats.filter((s) => s.ok + s.fails >= 3 && s.ok / (s.ok + s.fails) < 0.6 && skills.some((k) => k.name === s.name)).map((s) => `${s.name} (${s.ok}/${s.ok + s.fails})`);
  const idle = skills.filter((k) => { const s = stats.find((x) => x.name === k.name); return !s || now - s.last_used > 90 * 86_400_000; }).map((k) => k.name);
  const badScripts = scripts.filter((m) => m.runs >= 3 && m.ok / m.runs < 0.6).map((m) => `${m.name} (${m.ok}/${m.runs})`);
  const used = stats.filter((s) => now - s.last_used < 7 * 86_400_000).length;
  const L: string[] = [];
  if (used || scripts.length) L.push(`🧩 Compétences utilisées cette semaine : ${used} · scripts : ${scripts.length} (${scripts.reduce((a, m) => a + m.runs, 0)} lancements au total)`);
  if (weak.length) L.push(`🔧 Compétences qui échouent souvent (je propose des améliorations après chaque échec) : ${weak.join(', ')}`);
  if (badScripts.length) L.push(`🔧 Scripts peu fiables : ${badScripts.join(', ')}`);
  if (idle.length > 2) L.push(`🗄 Compétences inutilisées depuis 3 mois (à ranger ? Compétences → Ranger) : ${idle.slice(0, 8).join(', ')}`);
  return L.join('\n');
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
export function dayFacts(odin: { muninn: { listMissions(n: number): Array<{ goal: string; status: string; started_at: number; cost_usd: number }> }; inventory: { events(n: number): Array<{ kind: string; detail: string; at: number }> }; paths: { logs: string } }, now = Date.now(), from?: number): string {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const since = from ?? start.getTime(), lines: string[] = [];
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

const CONTINUOUS_PROMPT = `Travail continu (personne ne te parle en ce moment). Regarde la situation ci-dessous et ce que tu sais (memory_search, schedule_list, net_inventory, net_security) : y a-t-il quelque chose d'UTILE à faire maintenant pour le propriétaire — corriger un problème repéré, vérifier un appareil hors ligne, préparer ce qu'il demande souvent, mettre en place une tâche planifiée qui manque, ranger, mettre à jour une fiche ?
Règles : ne refais pas ce qui a déjà été fait (vérifie), une ou deux actions utiles au plus, rien d'irréversible ni de coûteux ; ce qui demande validation attendra son accord. Vérifie le résultat de chaque action.
Réponds « RIEN » si rien d'utile, sinon trois lignes au plus : ce que tu as fait, vérifié, et ce qui attend son accord.`;

/** Tâches de fond qu'Odin Breaker met en place tout seul (id, cron, consigne). */
export const BREAKER_ROUTINES: Array<[string, string, string]> = [
  ['reseau-nuit', '17 3 * * *', 'Ronde du réseau : appareils importants, nouveaux appareils (identifie-les avec net_identify et nomme-les avec net_rename), contrôle de sécurité (net_security) ; corrige ce qui est simple et sûr, note le reste'],
  ['maj-semaine', '43 4 * * 0', 'Mises à jour de la semaine : vérifie les mises à jour de la machine d\'Odin et des machines enregistrées ; applique-les (instantané Proxmox avant quand c\'est possible), vérifie que tout redémarre, et fais un compte rendu'],
  ['disques-jour', '27 6 * * *', 'Espace disque : machine d\'Odin, machines et conteneurs enregistrés ; au-dessus de 85 %, trouve ce qui grossit et libère ce qui est sans risque (journaux, caches, paquets), jamais de données personnelles'],
  ['sauvegardes-semaine', '12 7 * * 1', 'Sauvegardes : vérifie que les sauvegardes (Odin, Proxmox, NAS) ont bien tourné cette semaine et qu\'elles sont lisibles ; relance celles qui ont échoué'],
  ['scripts-mois', '33 5 1 * *', 'Révision mensuelle : scripts en échec ou lents, compétences qui échouent souvent ; corrige-les et teste-les en mode essai'],
];
/** Cron → français simple (pur). */
export function cronFr(c: string): string {
  const [mi, h, dom, , dow] = c.split(' ');
  const at = `${h.padStart(2, '0')} h ${mi.padStart(2, '0')}`;
  if (dom !== '*') return `le ${dom} de chaque mois à ${at}`;
  if (dow !== '*') return `chaque ${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][Number(dow)] ?? dow} à ${at}`;
  return `chaque jour à ${at}`;
}

const CONTINUOUS_BREAKER = `Travail continu en mode ⚡ Odin Breaker (personne ne te parle). Le propriétaire t'a donné carte blanche : tu n'as PAS besoin de son accord. AGIS sur la liste « À FAIRE » ci-dessous, dans l'ordre : identifie les appareils inconnus (net_identify) puis donne-leur TOUJOURS un nom clair (net_rename) : même une identité seulement probable suffit (« NAS Samba », « Routeur (box) », « Téléphone Android ? », « Appareil Apple ? ») — un nom avec « ? » vaut mieux que pas de nom, et tu pourras l'améliorer plus tard ; ne laisse sans nom que ce dont tu ne sais vraiment rien ; corrige les problèmes de sécurité et les scripts en échec ; relance ce qui est tombé ; complète ce qui manque. Jusqu'à 5 actions, chacune vérifiée.
Si une vérification ou une action utile revient souvent et n'est pas encore planifiée, planifie-la toi-même (schedule_task, ou script_schedule pour un script) à une heure creuse.
Limites : rien d'irréversible sur les données (pas de suppression), pas d'envoi de message à des tiers.
Termine par 3 à 6 lignes : ce que tu as FAIT (concret), vérifié, et ce qui reste. « RIEN » seulement si la liste est vide et qu'il n'y a vraiment rien d'utile.`;

/** Choses concrètes à faire, repérées sans le modèle (pur sauf lecture). */
export function continuousTodo(odin: Odin): string[] {
  const out: string[] = [];
  const devs = odin.inventory.list({ status: 'online' });
  const unknown = devs.filter((d) => d.kind === 'inconnu' || (!d.label && !d.name && !d.hostname)).slice(0, 5);
  for (const d of unknown) out.push(`Appareil sans nom : ${d.ip}${d.mac ? ` (${d.mac})` : ''}${vendorOf(d.mac) ? `, fabricant ${vendorOf(d.mac)}` : ''} → net_identify puis net_rename (nom probable avec « ? » si besoin)`);
  const watched = new Set(odin.cfg.watch?.devices ?? []);
  for (const d of odin.inventory.list({ status: 'all' }).filter((x) => watched.has(x.id) && x.status !== 'online').slice(0, 3)) out.push(`Appareil important hors ligne : ${d.label || d.name || d.ip} (${d.ip}) → vérifier et relancer si possible`);
  // Demandes qui reviennent sans compétence : en faire une (procédure + script si utile)
  try {
    const skills = odin.skills.list().map((s) => `${s.name} ${s.description}`.toLowerCase());
    for (const h of odin.muninn.habits(30, 2).slice(0, 3)) if (!skills.some((s) => h.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => s.includes(w)))) out.push(`Demande fréquente sans compétence : « ${h.text.slice(0, 90)} » (${h.count} fois) → fais-en une compétence (skill_propose), avec un script si c'est une action`);
  } catch { /* pas d'habitudes */ }
  // Sécurité : risques graves ou à surveiller sur les appareils (ports dangereux…)
  for (const f of auditNetwork(devs).filter((x) => x.level === 'grave' || x.level === 'attention').slice(0, 3)) out.push(`Sécurité : ${f.title}${f.device ? ` sur ${f.device} (${f.ip})` : ''} → vérifie (net_identify) puis corrige si tu as l'accès, sinon explique précisément ce qu'il faut`);
  // Adresses MAC suspectes (24 dernières heures)
  for (const e of odin.inventory.events(80).filter((x) => /MAC|IP reprise/.test(x.kind) && Date.now() - x.at < 86_400_000).slice(0, 3)) { const d = odin.inventory.get(e.device_id); out.push(`Adresse MAC : ${e.kind} sur ${d ? `${d.label || d.name || d.ip} (${d.ip})` : e.device_id} — ${e.detail} → identifie l'appareil (net_identify) ; s'il est hostile, préviens (net_block seulement si la menace est claire)`); }
  // Appareils mal connus : système inconnu → identification approfondie (de quoi toujours avoir du travail utile)
  if (out.length < 3) for (const d of devs.filter((x) => !x.os && x.kind !== 'téléphone / tablette' && !unknown.includes(x)).slice(0, 3 - out.length)) out.push(`Fiche incomplète : ${d.label || d.name || d.ip} (${d.ip}) sans système connu → net_identify pour compléter`);
  try { for (const m of listScripts(odin.paths.workspace).filter((x) => x.lastError).slice(0, 3)) out.push(`Script en échec : ${m.name} (${m.lastError!.split('\n').filter(Boolean).at(-1)?.slice(0, 100)}) → corriger (script_save) et relancer`); } catch { /* pas de scripts */ }
  return out;
}

const MORNING_PROMPT = `Écris la partie « cette nuit » du briefing du matin, en français, très court (4 lignes au plus, sans titre ni salutation) : ce que tu as fait cette nuit, ce qui attend sa validation ou son attention, puis un conseil pour la journée. Appuie-toi UNIQUEMENT sur les faits ci-dessous ; n'invente rien. N'agis pas : n'utilise aucun outil.`;

function tomorrowAt9(): Date { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
