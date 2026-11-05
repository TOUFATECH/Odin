// Home Assistant : lire l'état de la maison (lumières, prises, capteurs…) et la piloter.
// Adresse dans Réglages (homeAssistant.url, ex. http://192.168.1.40:8123) ; jeton longue durée dans
// HA_TOKEN (Home Assistant → ton profil → Sécurité → Jetons d'accès longue durée).

import { lanRequest } from './lan.ts';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
export interface HaState { entity_id: string; state: string; attributes: { friendly_name?: string; unit_of_measurement?: string; [k: string]: unknown } }

function conf(ctx: ToolContext): { url: string; token: string } {
  const url = (ctx.homeAssistant?.url ?? '').replace(/\/$/, ''), token = process.env.HA_TOKEN ?? '';
  if (!url || !token) throw new Error('Home Assistant n\'est pas relié : Réglages → Maison (adresse et jeton longue durée).');
  return { url, token };
}

export async function haApi(url: string, token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const r = await lanRequest(`${url}/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401) throw new Error('Home Assistant refuse le jeton (HA_TOKEN)');
  if (r.status >= 400) throw new Error(`Home Assistant : HTTP ${r.status} ${r.text.slice(0, 160)}`);
  return r.text ? r.json() : null;
}

/** Liste lisible des entités, filtrée (pur, testable). */
export function formatStates(states: HaState[], q = '', domain = ''): string {
  const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = states.filter((x) => (!domain || x.entity_id.startsWith(`${domain}.`)) && (!n || `${x.entity_id} ${x.attributes.friendly_name ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n)));
  return list.slice(0, 120).map((x) => `${x.entity_id} · ${x.attributes.friendly_name ?? ''} · ${x.state}${x.attributes.unit_of_measurement ? ` ${x.attributes.unit_of_measurement}` : ''}`).join('\n') + (list.length > 120 ? `\n… et ${list.length - 120} autres (précise ta recherche)` : '') || 'Aucune entité ne correspond.';
}

export const haStates: Tool = {
  name: 'ha_states',
  description: 'Home Assistant : état des appareils de la maison (lumières, prises, volets, capteurs de température…). Filtre par mot (« salon ») ou domaine (light, switch, sensor, climate, cover…).',
  risk: 'read',
  schema: obj({ search: str('mot à chercher (facultatif)'), domain: str('domaine (facultatif) : light, switch, sensor…') }),
  async run(i, ctx) {
    const { url, token } = conf(ctx);
    return formatStates(await haApi(url, token, 'GET', '/states') as HaState[], s(i.search), s(i.domain));
  },
};

export const haCall: Tool = {
  name: 'ha_call',
  description: 'Home Assistant : pilote un appareil ou lance un scénario. Ex. domain=light service=turn_off entity_id=all ; domain=climate service=set_temperature data={"temperature":21} ; domain=script service=turn_on entity_id=script.bonne_nuit ; domain=scene service=turn_on.',
  risk: 'external',
  schema: obj({ domain: str('domaine (light, switch, climate, cover, scene, script, automation…)'), service: str('service (turn_on, turn_off, toggle, set_temperature…)'), entity_id: str('entité(s), séparées par des virgules, ou « all »'), data: str('paramètres en JSON (facultatif)') }, ['domain', 'service']),
  summarize: (i) => `Maison : ${s(i.domain)}.${s(i.service)}${i.entity_id ? ` → ${s(i.entity_id)}` : ''}`,
  async run(i, ctx) {
    const { url, token } = conf(ctx);
    if (!/^[a-z_]+$/.test(s(i.domain)) || !/^[a-z_]+$/.test(s(i.service))) return 'Domaine ou service invalide.';
    let data: Record<string, unknown> = {};
    if (s(i.data)) { try { data = JSON.parse(s(i.data)) as Record<string, unknown>; } catch { return 'data doit être du JSON valide.'; } }
    if (s(i.entity_id)) data.entity_id = s(i.entity_id).includes(',') ? s(i.entity_id).split(',').map((x) => x.trim()) : s(i.entity_id);
    const r = await haApi(url, token, 'POST', `/services/${s(i.domain)}/${s(i.service)}`, data) as HaState[] | null;
    return `Fait : ${s(i.domain)}.${s(i.service)}${Array.isArray(r) && r.length ? `\n${r.slice(0, 15).map((x) => `${x.entity_id} → ${x.state}`).join('\n')}` : ''}`;
  },
};

/** Service de synthèse vocale à utiliser (pur, testable) : tts.speak (récent) s'il y a une entité tts, sinon tts.<moteur>_say. */
export function speakPlan(states: HaState[], player: string, message: string): { path: string; data: Record<string, unknown> } {
  const tts = states.find((x) => x.entity_id.startsWith('tts.'));
  if (tts) return { path: '/services/tts/speak', data: { entity_id: tts.entity_id, media_player_entity_id: player, message, language: 'fr' } };
  return { path: '/services/tts/google_translate_say', data: { entity_id: player, message, language: 'fr' } };
}

export const haSpeak: Tool = {
  name: 'ha_speak',
  description: 'Home Assistant : Odin parle à voix haute sur une enceinte de la maison (Google Home, Sonos, Alexa reliée…). Sans enceinte précisée : la première trouvée. Pour une annonce, un rappel, réveiller, prévenir quelqu\'un dans une autre pièce.',
  risk: 'external',
  schema: obj({ message: str('ce qu\'Odin doit dire'), speaker: str('enceinte (entité media_player.… ou mot de son nom, facultatif)') }, ['message']),
  summarize: (i) => `Maison : dire « ${s(i.message).slice(0, 80)} » sur ${s(i.speaker) || 'l\'enceinte'}`,
  async run(i, ctx) {
    const { url, token } = conf(ctx);
    const states = await haApi(url, token, 'GET', '/states') as HaState[];
    const q = s(i.speaker).toLowerCase();
    const players = states.filter((x) => x.entity_id.startsWith('media_player.'));
    const p = players.find((x) => x.entity_id === q) ?? players.find((x) => q && `${x.entity_id} ${x.attributes.friendly_name ?? ''}`.toLowerCase().includes(q)) ?? (q ? undefined : players[0]);
    if (!p) return players.length ? `Enceinte introuvable. Disponibles : ${players.map((x) => `${x.entity_id} (${x.attributes.friendly_name ?? ''})`).join(', ')}` : 'Aucune enceinte (media_player) dans Home Assistant.';
    const plan = speakPlan(states, p.entity_id, s(i.message).slice(0, 1000));
    await haApi(url, token, 'POST', plan.path, plan.data);
    return `Annoncé sur ${p.attributes.friendly_name ?? p.entity_id}.`;
  },
};

export const HA_TOOLS: Tool[] = [haStates, haCall, haSpeak];
