// Midgard — la maison : tableau de bord par pièce (cartes Ýdalir et bulles Breiðablik), scènes
// (« Je pars », « Bonne nuit »…), présence, et ponts vers d'autres box domotiques (Home Assistant
// et équivalents) pour reprendre leurs appareils. Les appareils viennent du registre « Appareils ».

import { haApi, type HaState } from '../../tools/homeassistant.ts';
import type { ModCtx, Module } from '../types.ts';
import { allDevices, command } from './appareils.ts';

export interface Scene { name: string; steps: Array<{ appareil: string; valeur: string }> }
interface Dev { id: string; name: string; kind: string; room: string; state?: string; unit?: string; commandTopic?: string }
const s = (v: unknown) => String(v ?? '');
const scenes = (ctx: ModCtx): Scene[] => (ctx.settings.scenes as Scene[] | undefined) ?? [];
async function devices(ctx: ModCtx): Promise<Dev[]> {
  const own: Dev[] = allDevices();
  const ha = await haDevices(ctx).catch(() => []);
  return [...own, ...ha];
}
async function haDevices(ctx: ModCtx): Promise<Dev[]> {
  const url = s(ctx.settings.haUrl), token = process.env.HA_TOKEN; if (!url || !token) return [];
  const st = await haApi(url.replace(/\/$/, ''), token, 'GET', '/states') as HaState[];
  const K: Record<string, string> = { light: 'lumière', switch: 'prise', sensor: 'capteur', binary_sensor: 'détecteur', cover: 'volet', climate: 'clim', media_player: 'lecteur', lock: 'serrure', fan: 'ventilateur', vacuum: 'aspirateur' };
  return st.filter((x) => K[x.entity_id.split('.')[0]]).map((x) => ({ id: `ha:${x.entity_id}`, name: x.attributes.friendly_name ?? x.entity_id, kind: K[x.entity_id.split('.')[0]], room: s(x.attributes.area ?? ''), state: x.state, unit: x.attributes.unit_of_measurement, commandTopic: /^(light|switch|cover|fan|climate|lock)\./.test(x.entity_id) ? 'ha' : undefined }));
}
async function set(ctx: ModCtx, appareil: string, valeur: string): Promise<string> {
  if (appareil.startsWith('ha:')) {
    const url = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!url || !token) throw new Error('Home Assistant non relié');
    const e = appareil.slice(3), dom = e.split('.')[0], on = /^(on|allume|ouvre|1|true)$/i.test(valeur);
    const svc = dom === 'cover' ? (on ? 'open_cover' : 'close_cover') : dom === 'lock' ? (on ? 'unlock' : 'lock') : on ? 'turn_on' : 'turn_off';
    await haApi(url, token, 'POST', `/services/${dom}/${svc}`, { entity_id: e });
    return `${e} → ${svc}`;
  }
  return command(ctx, appareil, valeur);
}
export async function runScene(ctx: ModCtx, name: string): Promise<string> {
  const sc = scenes(ctx).find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!sc) throw new Error(`scène inconnue : ${name}`);
  const out: string[] = [];
  for (const st of sc.steps) { try { out.push(`✓ ${await set(ctx, st.appareil, st.valeur)}`); } catch (e) { out.push(`✗ ${st.appareil} : ${(e as Error).message}`); } }
  ctx.emit('scene', { scène: sc.name });
  return `🎬 ${sc.name}\n${out.join('\n')}`;
}

export const midgard: Module = {
  id: 'midgard', name: 'Midgard', family: 'Maison',
  what: 'Le tableau de bord de la maison : pièces, scènes, et les appareils de toutes tes box réunis.',
  does: ['tableau de bord par pièce (cartes Ýdalir, bulles Breiðablik)', 'scènes : plusieurs appareils d\'un coup (« Je pars », « Film », « Bonne nuit »)', 'ponts vers d\'autres box (Home Assistant, et box compatibles) : leurs appareils apparaissent ici', 'allumer, éteindre, ouvrir, fermer depuis le tableau ou par la voix', 'chaque changement d\'état peut lancer une automatisation Draupnir'],
  from: ['Home Assistant', 'Mushroom', 'Bubble Card', 'HACS', 'openHAB', 'Domoticz', 'ioBroker'], upstream: ['home-assistant/core', 'piitaya/lovelace-mushroom', 'Clooos/Bubble-Card'],
  modes: ['Ýdalir · cartes', 'Breiðablik · bulles', 'Ponts (Jörð, Nóatún, Bilskírnir)'],
  words: ['maison', 'domotique', 'scene', 'scène', 'je pars', 'bonne nuit', 'piece', 'pièce', 'salon', 'chambre', 'tableau de bord', 'home assistant'],
  actions: [
    { id: 'maison', label: 'État de la maison', what: 'Résumé par pièce', read: true, words: ['etat de la maison', 'état de la maison', 'comment va la maison'], run: async (ctx) => { const d = await devices(ctx); const rooms = [...new Set(d.map((x) => x.room || 'Sans pièce'))]; return { text: rooms.map((r) => `${r} : ${d.filter((x) => (x.room || 'Sans pièce') === r).map((x) => `${x.name} ${x.state ?? '?'}${x.unit ? ` ${x.unit}` : ''}`).join(', ')}`).join('\n') || 'Aucun appareil relié.' }; } },
    { id: 'scene', label: 'Lancer une scène', what: 'Plusieurs appareils d\'un coup', params: [{ key: 'scene', label: 'Scène', kind: 'text', required: true }], words: ['scene', 'scène', 'je pars', 'je rentre', 'bonne nuit', 'film'], run: async (ctx, i) => ({ text: await runScene(ctx, s(i.scene)) }) },
    { id: 'creer_scene', label: 'Créer une scène', what: 'Nom + une ligne par appareil : « appareil = valeur »', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'etapes', label: 'Appareil = valeur (une par ligne)', kind: 'textarea', required: true }], run: (ctx, i) => { const steps = s(i.etapes).split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((x) => x[0] && x[1]).map(([appareil, valeur]) => ({ appareil, valeur })); ctx.saveSettings({ scenes: [...scenes(ctx).filter((x) => x.name !== s(i.nom)), { name: s(i.nom), steps }] }); return { text: `🎬 Scène « ${s(i.nom)} » : ${steps.length} appareil(s).` }; } },
    { id: 'commander', label: 'Commander', what: 'Un appareil (de n\'importe quelle box)', params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'valeur', label: 'Valeur', kind: 'text', required: true }], run: async (ctx, i) => ({ text: `✓ ${await set(ctx, s(i.appareil), s(i.valeur))}` }) },
    { id: 'pont', label: 'Relier une box', what: 'Ajoute une box domotique (adresse ; jeton dans le coffre : HA_TOKEN)', params: [{ key: 'adresse', label: 'Adresse (http://…:8123)', kind: 'text', required: true }], run: (ctx, i) => { ctx.saveSettings({ haUrl: s(i.adresse).trim() }); return { text: '🔗 Box reliée. Range son jeton longue durée dans le coffre (HA_TOKEN).' }; } },
  ],
  async view(ctx) {
    const d = await devices(ctx), rooms = [...new Set(d.map((x) => x.room || 'Sans pièce'))];
    const on = d.filter((x) => /^(on|ouvert|open|heat|cool)$/i.test(x.state ?? '')).length;
    return {
      subtitle: `${d.length} appareil(s) · ${rooms.length} pièce(s) · ${on} allumé(s)`,
      tabs: ['Tout', ...rooms],
      kpis: [{ label: 'Allumés', value: String(on) }, { label: 'Scènes', value: String(scenes(ctx).length) }, { label: 'Box reliées', value: ctx.settings.haUrl ? '1' : '0' }],
      sections: [
        ...rooms.map((r) => ({ kind: 'table' as const, title: r, columns: ['Appareil', 'Type', 'État'], rows: d.filter((x) => (x.room || 'Sans pièce') === r).map((x) => ({ cells: [x.name, x.kind, `${x.state ?? '?'}${x.unit ? ` ${x.unit}` : ''}`], tone: (/^on$/i.test(x.state ?? '') ? 'bon' : undefined) as 'bon' | undefined, actions: x.commandTopic ? [{ action: 'commander', label: 'Allumer', input: { appareil: x.id, valeur: 'on' } }, { action: 'commander', label: 'Éteindre', input: { appareil: x.id, valeur: 'off' } }] : [] })) })),
        ...(d.length ? [] : [{ kind: 'text' as const, title: 'Aucun appareil', text: 'Branche tes appareils sur le relais (page Appareils) ou relie ta box domotique à droite.' }]),
      ],
      side: [{ kind: 'list', title: 'Scènes', items: scenes(ctx).map((x) => ({ title: x.name, detail: x.steps.map((st) => `${st.appareil} = ${st.valeur}`).join(', ') })), empty: 'Aucune scène.' }, { kind: 'form', title: 'Créer une scène', action: 'creer_scene', submit: 'Créer', params: midgard.actions[2].params! }, { kind: 'form', title: 'Relier une box', action: 'pont', submit: 'Relier', params: midgard.actions[4].params! }],
    };
  },
};
