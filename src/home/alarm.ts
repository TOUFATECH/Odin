// Réveil : Odin te réveille à l'heure des jours de travail (ex. 3 h) et à celle des jours de repos ou de
// vacances (ex. 4 h). Il t'APPELLE : vrai appel téléphonique (Twilio), sonnerie d'alarme sur ton
// téléphone par l'application Home Assistant (même en silencieux), annonce sur les enceintes, note vocale
// et notification. Il recommence toutes les 5 minutes tant que tu n'as pas dit « je suis réveillé ».

import { haApi } from '../tools/homeassistant.ts';
import { obj, str, type Tool } from '../tools/registry.ts';
import { parseWhen } from '../cron/reminders.ts';

type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void };

export interface AlarmConf {
  enabled: boolean;
  /** Heure les jours de travail (HH:MM). */
  work: string;
  /** Heure les jours de repos et de vacances (HH:MM) ; vide = pas de réveil ces jours-là. */
  off: string;
  /** Jours de travail (0 = dimanche). */
  workDays: number[];
  /** Périodes de vacances (dates incluses, AAAA-MM-JJ). */
  vacations: Array<{ from: string; to: string }>;
  /** Jours sans réveil (AAAA-MM-JJ), « demain pas de réveil ». */
  skip: string[];
  /** Appel téléphonique : numéro à appeler (+262…) et numéro Twilio qui appelle. */
  phone?: string; twilioFrom?: string;
  /** Application Home Assistant du téléphone (service notify, ex. mobile_app_pixel_8). */
  haPhone?: string;
  /** Enceinte(s) Home Assistant pour l'annonce (media_player.chambre). */
  speaker?: string;
}
export const DEFAULT_ALARM: AlarmConf = { enabled: false, work: '03:00', off: '04:00', workDays: [1, 2, 3, 4, 5], vacations: [], skip: [] };
export const getAlarm = (kv: Kv): AlarmConf => { try { return { ...DEFAULT_ALARM, ...(JSON.parse(kv.getKv('alarm') ?? '{}') as Partial<AlarmConf>) }; } catch { return { ...DEFAULT_ALARM }; } };
export const setAlarm = (kv: Kv, a: AlarmConf) => kv.setKv('alarm', JSON.stringify(a));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Type du jour (pur) : vacances (période déclarée ou agenda « vacances / congés »), travail, repos. */
export function dayKind(a: AlarmConf, d: Date, agenda: Array<{ start: number; end: number; title: string; allDay?: boolean }> = []): 'travail' | 'repos' | 'vacances' {
  const k = ymd(d);
  if (a.vacations.some((v) => v.from <= k && k <= v.to)) return 'vacances';
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
  if (agenda.some((e) => /vacances|cong[ée]s?|repos|r[ée]cup/i.test(e.title) && e.start < dayStart.getTime() + 86_400_000 && e.end > dayStart.getTime())) return 'vacances';
  return a.workDays.includes(d.getDay()) ? 'travail' : 'repos';
}

/** Heure de réveil du jour (pur), ou undefined. */
export function alarmTime(a: AlarmConf, d: Date, agenda: Parameters<typeof dayKind>[2] = []): { at: Date; kind: string } | undefined {
  if (!a.enabled || a.skip.includes(ymd(d))) return undefined;
  const kind = dayKind(a, d, agenda);
  const hm = kind === 'travail' ? a.work : a.off;
  if (!/^\d{1,2}:\d{2}$/.test(hm ?? '')) return undefined;
  const [h, m] = hm.split(':').map(Number);
  const at = new Date(d); at.setHours(h, m, 0, 0);
  return { at, kind };
}

/** Message dit au réveil (pur). */
export function wakeText(kind: string, now: Date, attempt: number): string {
  const t = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return attempt === 0
    ? `Bonjour ! Il est ${t}, c'est l'heure de te lever${kind === 'travail' ? ' pour le travail' : ''}.`
    : `Il est ${t} : toujours pas levé ? Debout ! (rappel ${attempt + 1})`;
}

/** TwiML de l'appel : la voix lit le message deux fois. */
export const twiml = (text: string) => `<Response><Say language="fr-FR" voice="Polly.Lea">${text.replace(/[<>&]/g, ' ')}</Say><Pause length="2"/><Say language="fr-FR" voice="Polly.Lea">${text.replace(/[<>&]/g, ' ')}</Say></Response>`;

/** Appel téléphonique Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN). */
export async function twilioCall(to: string, from: string, text: string, env = process.env, fetchFn: typeof fetch = fetch): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('Twilio non configuré');
  const r = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml(text) }), signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Twilio : HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}

/** Alarme sur le téléphone par l'application Home Assistant : sonne même en mode silencieux (Android), alerte critique (iPhone). */
export async function haPhoneAlarm(haUrl: string, token: string, service: string, text: string): Promise<void> {
  await haApi(haUrl, token, 'POST', `/services/notify/${service.replace(/^notify\./, '')}`, {
    title: '⏰ Réveil Odin', message: 'TTS',
    data: { tts_text: text, media_stream: 'alarm_stream_max', priority: 'high', ttl: 0, channel: 'alarm_stream', push: { sound: { name: 'default', critical: 1, volume: 1.0 } } },
  });
  await haApi(haUrl, token, 'POST', `/services/notify/${service.replace(/^notify\./, '')}`, { title: '⏰ Réveil Odin', message: text, data: { priority: 'high', ttl: 0, channel: 'alarm_stream', push: { sound: { name: 'default', critical: 1, volume: 1.0 } } } });
}

export const alarmTool: Tool = {
  name: 'alarm_set',
  description: 'Réveil du propriétaire : Odin l\'APPELLE (appel téléphonique Twilio, alarme sur le téléphone via Home Assistant, enceintes, note vocale) et insiste toutes les 5 min. action : regler (travail HH:MM, repos HH:MM ou vide, jours de travail : semaine | lun,mar…), vacances (du, au : « du 20 au 30 décembre »), sans_vacances, sauter (date : « demain »), appel (telephone +262…, twilio_from, ha_phone : service notify de l\'app HA, enceinte : media_player…), couper, etat.',
  risk: 'write',
  schema: obj({ action: str('regler | vacances | sans_vacances | sauter | appel | couper | etat'), travail: str('HH:MM'), repos: str('HH:MM ou vide'), jours: str('jours de travail'), du: str('début des vacances'), au: str('fin des vacances'), date: str('jour sans réveil'), telephone: str('+262…'), twilio_from: str('numéro Twilio'), ha_phone: str('ex. mobile_app_pixel_8'), enceinte: str('media_player.…') }, ['action']),
  summarize: (i) => `réveil : ${String(i.action)} ${[i.travail, i.repos, i.du, i.au, i.date].filter(Boolean).join(' ')}`,
  async run(i, ctx) {
    const kv = ctx.muninn, a = getAlarm(kv), act = String(i.action ?? '').toLowerCase(), s = (x: unknown) => String(x ?? '').trim();
    const hm = (x: string) => { const m = /^([01]?\d|2[0-3])\s*[h:]\s*([0-5]\d)?$/.exec(x); return m ? `${m[1].padStart(2, '0')}:${m[2] ?? '00'}` : undefined; };
    const day = (x: string) => { const d = parseWhen(x.replace(/^(le |du |au )/, ''), new Date()); return d ? ymd(d) : /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined; };
    if (act.startsWith('regl')) {
      if (s(i.travail)) { const v = hm(s(i.travail)); if (!v) throw new Error('heure de travail : HH:MM'); a.work = v; }
      if (i.repos !== undefined) { const v = s(i.repos); a.off = v ? hm(v) ?? a.off : ''; }
      if (s(i.jours)) {
        const DAYS: Record<string, number> = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
        const x = s(i.jours).toLowerCase();
        a.workDays = /semaine/.test(x) ? [1, 2, 3, 4, 5] : /tous/.test(x) ? [0, 1, 2, 3, 4, 5, 6] : [...new Set([...x.matchAll(/(dim|lun|mar|mer|jeu|ven|sam)/g)].map((m) => DAYS[m[1]]))].sort();
      }
      a.enabled = true;
    } else if (act.startsWith('vac')) {
      const from = day(s(i.du)), to = day(s(i.au)) ?? from;
      if (!from || !to) throw new Error('dates des vacances non comprises (ex. du « 20 décembre » au « 30 décembre »)');
      a.vacations = [...a.vacations.filter((v) => v.to >= ymd(new Date())), { from, to }];
    } else if (act.startsWith('sans')) a.vacations = [];
    else if (act.startsWith('saut')) { const d = day(s(i.date) || 'demain'); if (!d) throw new Error('date non comprise'); a.skip = [...a.skip.filter((x) => x >= ymd(new Date())), d]; }
    else if (act.startsWith('appel')) {
      if (s(i.telephone)) { if (!/^\+\d{6,15}$/.test(s(i.telephone).replace(/\s/g, ''))) throw new Error('numéro au format international : +262639…'); a.phone = s(i.telephone).replace(/\s/g, ''); }
      if (s(i.twilio_from)) a.twilioFrom = s(i.twilio_from).replace(/\s/g, '');
      if (s(i.ha_phone)) a.haPhone = s(i.ha_phone).replace(/^notify\./, '');
      if (s(i.enceinte)) a.speaker = s(i.enceinte);
    } else if (act.startsWith('coup')) a.enabled = false;
    setAlarm(kv, a);
    const next = [0, 1, 2].map((k) => { const d = new Date(); d.setDate(d.getDate() + k); return alarmTime(a, d); }).find((x) => x && x.at.getTime() > Date.now());
    const ways = [a.phone && process.env.TWILIO_ACCOUNT_SID ? `appel au ${a.phone}` : '', a.haPhone ? 'alarme sur ton téléphone (Home Assistant)' : '', a.speaker ? `annonce sur ${a.speaker}` : '', 'note vocale et notification'].filter(Boolean);
    return a.enabled
      ? `Réveil : ${a.work} les jours de travail (${a.workDays.map((d) => ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][d]).join(', ')}), ${a.off ? `${a.off} les jours de repos et de vacances` : 'pas de réveil les jours de repos'}.${a.vacations.length ? ` Vacances : ${a.vacations.map((v) => `${v.from} → ${v.to}`).join(', ')}.` : ''}${next ? ` Prochain : ${next.at.toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })} (${next.kind}).` : ''}\nPour te réveiller : ${ways.join(', ')}. J'insiste toutes les 5 min jusqu'à « je suis réveillé ».${!a.phone || !process.env.TWILIO_ACCOUNT_SID ? '\nPour un vrai appel téléphonique : Réglages → Réveil → « Vrai appel téléphonique » (compte Twilio) et ton numéro.' : ''}`
      : 'Réveil coupé.';
  },
};
