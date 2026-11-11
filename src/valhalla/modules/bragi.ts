// Bragi — la voix d'Odin réunie en un module : comprendre (Whisper, local ou en ligne), parler
// (ElevenLabs, Piper local, ou compatible OpenAI), annonces sur les enceintes de la maison (Vör),
// et diffusion d'une alerte à voix haute partout (Gjallarhorn). Réutilise src/voice (pas de doublon).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { haApi, speakPlan, type HaState } from '../../tools/homeassistant.ts';
import { hear, listVoices, speakAudio, sttReady, ttsIsLocal, ttsReady, type VoiceConfig } from '../../voice/voice.ts';
import type { ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac' };

async function speakers(ctx: ModCtx): Promise<{ url: string; token: string; states: HaState[] } | undefined> {
  const url = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!url || !token) return undefined;
  return { url, token, states: await haApi(url, token, 'GET', '/states') as HaState[] };
}
async function announce(ctx: ModCtx, message: string, where?: string): Promise<string> {
  const ha = await speakers(ctx); if (!ha) throw new Error('aucune box reliée (Midgard → Relier une box) : les enceintes viennent de là');
  const players = ha.states.filter((x) => x.entity_id.startsWith('media_player.'));
  const q = (where ?? '').toLowerCase();
  const list = q === 'partout' ? players : players.filter((p) => !q || `${p.entity_id} ${p.attributes.friendly_name ?? ''}`.toLowerCase().includes(q)).slice(0, q ? 10 : 1);
  if (!list.length) throw new Error(`aucune enceinte ${q ? `« ${q} »` : ''}`);
  for (const p of list) { const plan = speakPlan(ha.states, p.entity_id, message.slice(0, 1000)); await haApi(ha.url, ha.token, 'POST', plan.path, plan.data); }
  return `🔊 Annoncé sur ${list.map((p) => p.attributes.friendly_name ?? p.entity_id).join(', ')}.`;
}

export function bragi(voice: () => VoiceConfig): Module {
  const m: Module = {
    id: 'bragi', name: 'Bragi', family: 'Maison',
    what: 'La voix d\'Odin : comprendre ce que tu dis, parler, annoncer sur les enceintes.',
    does: ['comprend les vocaux et fichiers audio (Whisper sur la machine ou en ligne), langue détectée', 'parle avec la voix choisie (ElevenLabs, Piper local gratuit, ou compatible OpenAI)', 'Vör : annonce sur une enceinte de la maison ou partout', 'Gjallarhorn : les alertes critiques peuvent être dites à voix haute', 'transcrit un fichier audio en texte horodaté'],
    from: ['Home Assistant Assist', 'Rhasspy', 'Wyoming', 'Piper', 'Whisper', 'openWakeWord'], upstream: ['rhasspy/piper', 'openai/whisper', 'rhasspy/wyoming'],
    modes: ['Vör · annonces', 'Gjallarhorn · alertes à voix haute'],
    words: ['voix', 'parle', 'dis', 'annonce', 'enceinte', 'haut-parleur', 'transcris', 'transcription', 'vocal', 'audio', 'lis a voix haute', 'lis à voix haute'],
    actions: [
      { id: 'etat', label: 'État de la voix', what: 'Ce qui est prêt', read: true, run: () => { const v = voice(); return { text: `Comprendre : ${sttReady(v) ? 'prêt' : 'pas prêt (Whisper absent et pas de clé)'}\nParler : ${ttsReady(v) ? `prêt (${v.tts.provider}${ttsIsLocal(v) ? ', sur la machine' : ', en ligne'})` : 'pas prêt'}\nVoix : ${v.tts.voiceName || v.tts.voiceId || 'par défaut'}` }; } },
      { id: 'dire', label: 'Dire', what: 'Fabrique un fichier audio avec la voix d\'Odin', params: [{ key: 'texte', label: 'Texte', kind: 'textarea', required: true }], words: ['dis', 'lis'], run: async (ctx, i) => {
        const a = await speakAudio(s(i.texte).slice(0, 4000), voice()); const dir = join(ctx.dir, 'audio'); mkdirSync(dir, { recursive: true });
        const f = join(dir, `${ctx.now().getTime()}.${a.mime.includes('ogg') ? 'ogg' : 'mp3'}`); writeFileSync(f, a.data);
        return { text: '🗣 Audio prêt.', data: { file: f } };
      } },
      { id: 'annoncer', label: 'Annoncer', what: 'Sur une enceinte (nom), ou « partout »', params: [{ key: 'message', label: 'Message', kind: 'textarea', required: true }, { key: 'ou', label: 'Enceinte (ou « partout »)', kind: 'text', default: '' }], words: ['annonce', 'enceinte', 'previens a voix haute', 'préviens à voix haute'], run: async (ctx, i) => ({ text: await announce(ctx, s(i.message), s(i.ou) || undefined) }) },
      { id: 'transcrire', label: 'Transcrire', what: 'Fichier audio → texte', read: true, params: [{ key: 'fichier', label: 'Chemin du fichier', kind: 'text', required: true }], words: ['transcris', 'transcription'], run: async (_ctx, i) => {
        const f = s(i.fichier), mime = MIME[extname(f).toLowerCase()] ?? 'audio/mpeg';
        const h = await hear(readFileSync(f), mime, voice()); return { text: h.text, data: h };
      } },
      { id: 'voix', label: 'Voix disponibles', what: 'Voix du fournisseur', read: true, run: async () => ({ text: (await listVoices(voice())).map((x) => `- ${x.name} (${x.category}) ${x.id}`).join('\n') || 'Aucune.' }) },
      { id: 'gjallarhorn', label: 'Alertes à voix haute', what: 'Dire les alertes critiques sur les enceintes', params: [{ key: 'actif', label: 'Activé', kind: 'boolean', default: false }, { key: 'ou', label: 'Enceinte (ou « partout »)', kind: 'text', default: 'partout' }, { key: 'heures', label: 'Heures autorisées (ex. 7-22)', kind: 'text', default: '7-22' }], run: (ctx, i) => { ctx.saveSettings({ horn: i.actif === true || i.actif === 'true', hornWhere: s(i.ou) || 'partout', hornHours: s(i.heures) || '7-22' }); return { text: `Gjallarhorn ${ctx.settings.horn ? 'activé' : 'désactivé'}.` }; } },
    ],
    view(ctx) {
      const v = voice();
      return {
        subtitle: `${sttReady(v) ? 'comprend' : 'ne comprend pas encore'} · ${ttsReady(v) ? 'parle' : 'ne parle pas encore'}`,
        tabs: ['Bragi · voix', 'Vör · annonces', 'Gjallarhorn · alertes'],
        kpis: [{ label: 'Comprendre', value: sttReady(v) ? 'prêt' : 'non', tone: sttReady(v) ? 'bon' : 'attention' }, { label: 'Parler', value: ttsReady(v) ? v.tts.provider : 'non', tone: ttsReady(v) ? 'bon' : 'attention' }, { label: 'Gjallarhorn', value: ctx.settings.horn ? 'actif' : 'éteint' }],
        sections: [{ kind: 'text', title: 'Comment ça marche', text: 'Envoie un vocal à Odin sur ta messagerie ou parle-lui dans l\'interface : Bragi comprend, Odin répond, et Bragi peut répondre à voix haute. Pour les enceintes de la maison, relie ta box dans Midgard.' }],
        side: [{ kind: 'form', title: 'Annoncer', action: 'annoncer', submit: 'Annoncer', params: m.actions[2].params! }, { kind: 'form', title: 'Gjallarhorn', action: 'gjallarhorn', submit: 'Enregistrer', params: m.actions[5].params! }],
      };
    },
  };
  return m;
}
/** Gjallarhorn : appelé par les liens pour une alerte critique. */
export async function horn(ctx: ModCtx, text: string): Promise<void> {
  if (!ctx.settings.horn) return;
  const [a, b] = s(ctx.settings.hornHours || '7-22').split('-').map(Number), h = ctx.now().getHours();
  if (!(a <= b ? h >= a && h < b : h >= a || h < b)) return;
  await announce(ctx, text, s(ctx.settings.hornWhere) || 'partout').catch(() => undefined);
}
