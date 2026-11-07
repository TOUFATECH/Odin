// Outils d'assistant personnel : régler le briefing du matin, installer la voix locale (gratuite).

import { setConfigValue } from '../config.ts';
import { installLocalVoice, localPiper, localWhisper, PIPER_VOICE } from '../voice/local.ts';
import { bool, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '').trim();
const hhmm = (v: string) => /^([01]?\d|2[0-3])[:h]([0-5]\d)$/.exec(v.replace(/\s/g, ''));

/** Change une valeur de configuration, sur le disque et dans la configuration en cours. */
function setCfg(ctx: ToolContext, path: string[], value: unknown): void {
  if (!ctx.paths) throw new Error('configuration indisponible ici');
  setConfigValue(ctx.paths, path, value);
  if (ctx.careCfg) { let n = ctx.careCfg as unknown as Record<string, unknown>; for (const k of path.slice(0, -1)) n = (n[k] ??= {}) as Record<string, unknown>; n[path.at(-1)!] = value; }
}

export const briefingSet: Tool = {
  name: 'briefing_set',
  description: 'Règle le briefing du matin (météo, agenda, mails non lus, rappels du jour, machines, ta nuit) : ville pour la météo, heure d\'envoi, version vocale, ou le couper. À utiliser quand le propriétaire dit « ma ville est … », « envoie le briefing à 6h30 », « lis-le moi en vocal ».',
  risk: 'write',
  schema: obj({ region: str('région ou territoire pour les alertes (« Mayotte »)'), city: str('ville pour la météo (« Mamoudzou »)'), at: str('heure d\'envoi HH:MM'), voice: bool('envoyer aussi une note vocale'), enabled: bool('briefing actif') }),
  summarize: (i) => `briefing du matin : ${[s(i.city) && `ville ${s(i.city)}`, s(i.at) && `à ${s(i.at)}`, i.voice != null && `vocal ${i.voice ? 'oui' : 'non'}`, i.enabled != null && (i.enabled ? 'activé' : 'coupé')].filter(Boolean).join(', ')}`,
  async run(i, ctx) {
    const done: string[] = [];
    if (s(i.city)) { setCfg(ctx, ['journal', 'city'], s(i.city).slice(0, 80)); done.push(`météo pour ${s(i.city)}`); }
    if (s(i.region)) { setCfg(ctx, ['alerts'], { enabled: true, region: s(i.region).slice(0, 80) }); done.push(`alertes pour ${s(i.region)}`); }
    if (s(i.at)) {
      const m = hhmm(s(i.at)); if (!m) throw new Error('heure invalide : HH:MM');
      const v = `${m[1].padStart(2, '0')}:${m[2]}`; setCfg(ctx, ['journal', 'morning'], v); done.push(`envoi à ${v}`);
    }
    if (i.voice != null) { setCfg(ctx, ['journal', 'morningVoice'], Boolean(i.voice)); done.push(i.voice ? 'version vocale en plus' : 'sans vocal'); }
    if (i.enabled != null) { setCfg(ctx, ['journal', 'enabled'], Boolean(i.enabled)); done.push(i.enabled ? 'briefing activé' : 'briefing coupé'); }
    return done.length ? `Briefing du matin réglé : ${done.join(', ')}.` : 'Rien à changer.';
  },
};

export const voiceSetup: Tool = {
  name: 'voice_setup',
  description: 'Installe la voix locale et gratuite d\'Odin sur sa machine : Whisper (comprendre les messages vocaux) et Piper (répondre à voix haute, voix d\'homme française). Rien ne sort de la machine, aucune clé. Plusieurs minutes (compilation, ~500 Mo). Puis active les vocaux.',
  risk: 'exec',
  schema: obj({ listen: bool('installer la compréhension des vocaux (oui par défaut)'), speak: bool('installer la voix (oui par défaut)'), model: str('modèle Whisper : small (défaut, bon en français), base (plus léger), medium (plus précis, plus lent)') }),
  summarize: () => 'installer la voix locale (Whisper + Piper) dans ~/.odin/voice',
  async run(i, ctx) {
    const already = { stt: Boolean(localWhisper(ctx.home)), tts: Boolean(localPiper(ctx.home)) };
    const stt = i.listen !== false && !already.stt, tts = i.speak !== false && !already.tts;
    let log = '';
    if (stt || tts) {
      const r = await installLocalVoice({ stt, tts, model: s(i.model) || 'small', home: ctx.home });
      log = r.log;
      if (!r.ok) return `Installation interrompue :\n${r.log}`;
    }
    const ok = { stt: Boolean(localWhisper(ctx.home)), tts: Boolean(localPiper(ctx.home)) };
    if (ok.stt || ok.tts) setCfg(ctx, ['voice', 'enabled'], true);
    if (ok.tts) { setCfg(ctx, ['voice', 'voiceReplies'], true); if (ctx.careCfg && ctx.careCfg.voice.tts.provider === 'piper') { setCfg(ctx, ['voice', 'tts', 'baseUrl'], 'local'); setCfg(ctx, ['voice', 'tts', 'voiceId'], PIPER_VOICE); } }
    return `Voix locale : ${ok.stt ? '✅ je comprends tes vocaux' : '❌ compréhension des vocaux absente'} · ${ok.tts ? '✅ je réponds en vocal (voix « tom »)' : '❌ voix absente'}.${log ? `\n${log.split('\n').slice(-6).join('\n')}` : ''}`;
  },
};

export const maintenanceSet: Tool = {
  name: 'maintenance_set',
  description: 'Mises à jour de nuit des machines (celle d\'Odin et toutes celles où il a accès, ou une liste) : instantané Proxmox avant quand c\'est possible, mise à jour des paquets, redémarrage si le système le demande, services relancés, retour à l\'instantané si quelque chose casse. frequence : chaque nuit | chaque semaine (dimanche) ; heure 0-23.',
  risk: 'write',
  schema: obj({ enabled: bool('activer'), frequence: str('chaque nuit | chaque semaine'), heure: str('heure de début (0-23, 4 par défaut)') }, ['enabled']),
  summarize: (i) => `mises à jour de nuit : ${i.enabled ? `oui, ${s(i.frequence) || 'chaque semaine'} à ${s(i.heure) || '4'} h` : 'non'}`,
  async run(i, ctx) {
    const cur = ctx.careCfg?.updates ?? { enabled: false, weekday: 0, hour: 4, targets: [], rollbackOnFailure: true };
    const hour = Math.max(0, Math.min(23, Number.parseInt(s(i.heure), 10) || cur.hour || 4));
    const weekday = /nuit|jour/i.test(s(i.frequence)) ? -1 : /semaine/i.test(s(i.frequence)) ? 0 : cur.weekday;
    setCfg(ctx, ['updates'], { ...cur, enabled: Boolean(i.enabled), hour, weekday, rollbackOnFailure: true });
    return i.enabled ? `Mises à jour de nuit activées : ${weekday < 0 ? 'chaque nuit' : 'chaque dimanche'} à ${hour} h, ${cur.targets.length ? `${cur.targets.length} machine(s) choisie(s)` : 'ma machine et toutes celles où j\'ai accès'}. Je te fais le compte rendu le matin.` : 'Mises à jour de nuit coupées.';
  },
};

export const voiceSet: Tool = {
  name: 'voice_set',
  description: 'Change la voix d\'Odin : homme ou femme (« parle avec une voix de femme », « reprends ta voix d\'homme »). voix : nom ou identifiant d\'une voix précise (facultatif ; OpenAI : nova, shimmer, coral pour une femme, onyx, echo, ash pour un homme).',
  risk: 'write',
  schema: obj({ genre: str('homme | femme'), voix: str('voix précise (facultatif)') }, ['genre']),
  summarize: (i) => `voix d'Odin : ${s(i.genre)}${s(i.voix) ? ` (${s(i.voix)})` : ''}`,
  async run(i, ctx) {
    const g = /^f/i.test(s(i.genre)) ? 'femme' : 'homme';
    const v = s(i.voix);
    if (v && !/^[A-Za-z0-9_.-]{1,80}$/.test(v)) throw new Error('nom de voix invalide');
    setCfg(ctx, ['voice', 'gender'], g);
    if (v) setCfg(ctx, g === 'femme' ? ['voice', 'femaleVoiceId'] : ['voice', 'tts', 'voiceId'], v);
    return `Voix d'Odin : ${g === 'femme' ? 'une voix de femme' : 'une voix d\'homme'}${v ? ` (${v})` : ''}. C'est pris en compte dès la prochaine réponse vocale.`;
  },
};

export const ASSISTANT_TOOLS: Tool[] = [briefingSet, voiceSetup, maintenanceSet, voiceSet];
