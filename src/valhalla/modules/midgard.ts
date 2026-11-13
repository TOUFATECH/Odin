// Midgard — la maison : tableau de bord par pièce (cartes Mosaïque et bulles Écume), scènes
// (« Je pars », « Bonne nuit »…), présence, et ponts vers d'autres box domotiques (Home Assistant
// et équivalents) pour reprendre leurs appareils. Les appareils viennent du registre « Appareils ».

import { haApi, type HaState } from '../../tools/homeassistant.ts';
import { lanRequest } from '../../tools/lan.ts';
import type { ModCtx, Module } from '../types.ts';
import { allDevices, command } from './appareils.ts';
/** Valeurs à deux états : l'inverse sert à annuler une manip. */
const INVERSE: Record<string, string> = { on: 'off', off: 'on', allumer: 'eteindre', eteindre: 'allumer', 'éteindre': 'allumer', ouvrir: 'fermer', fermer: 'ouvrir', verrouiller: 'deverrouiller', deverrouiller: 'verrouiller', 'déverrouiller': 'verrouiller', marche: 'arret', arret: 'marche', 'arrêt': 'marche' };

export interface Scene { name: string; steps: Array<{ appareil: string; valeur: string }> }
interface Dev { id: string; name: string; kind: string; room: string; state?: string; unit?: string; commandTopic?: string }
const s = (v: unknown) => String(v ?? '');
const scenes = (ctx: ModCtx): Scene[] => (ctx.settings.scenes as Scene[] | undefined) ?? [];
async function devices(ctx: ModCtx): Promise<Dev[]> {
  const own: Dev[] = allDevices();
  const ha = await haDevices(ctx).catch(() => []);
  return [...own, ...ha];
}
const K: Record<string, string> = { light: 'lumière', switch: 'prise', sensor: 'capteur', binary_sensor: 'détecteur', cover: 'volet', climate: 'clim', media_player: 'lecteur', lock: 'serrure', fan: 'ventilateur', vacuum: 'aspirateur' };
/** Pièce de chaque entité d'une box Home Assistant (ses « zones »), demandée en une fois. */
export async function haAreas(url: string, token: string): Promise<Map<string, string>> {
  const tpl = '{% for a in areas() %}{% for e in area_entities(a) %}{{ e }}|{{ area_name(a) }}\n{% endfor %}{% endfor %}';
  const r = await lanRequest(`${url}/api/template`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ template: tpl }) });
  const m = new Map<string, string>();
  if (r.status >= 400) return m;
  for (const l of r.text.split('\n')) { const k = l.indexOf('|'); if (k > 0) m.set(l.slice(0, k).trim(), l.slice(k + 1).trim()); }
  return m;
}
async function haDevices(ctx: ModCtx): Promise<Dev[]> {
  const url = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!url || !token) return [];
  const [st, areas] = await Promise.all([haApi(url, token, 'GET', '/states') as Promise<HaState[]>, haAreas(url, token).catch(() => new Map<string, string>())]);
  return st.filter((x) => K[x.entity_id.split('.')[0]] && x.state !== 'unavailable').map((x) => ({ id: `ha:${x.entity_id}`, name: x.attributes.friendly_name ?? x.entity_id, kind: K[x.entity_id.split('.')[0]], room: areas.get(x.entity_id) ?? '', state: x.state, unit: x.attributes.unit_of_measurement, commandTopic: /^(light|switch|cover|fan|climate|lock|media_player|vacuum)\./.test(x.entity_id) ? 'ha' : undefined }));
}
const ON = /^(on|allume|allumer|marche|ouvre|ouvrir|ouvert|1|true|oui|deverrouille|déverrouille|demarre|démarre|lance)$/;
const OFF = /^(off|eteins|éteins|eteindre|éteindre|arret|arrêt|arrete|arrête|ferme|fermer|0|false|non|verrouille|rentre)$/;
/** Ordre en français → service de la box (pur, testable) : « on », « ferme », « 40 % », « 21 »… */
export function haCommand(entity: string, valeur: string): { domain: string; service: string; data: Record<string, unknown> } {
  const domain = entity.split('.')[0], v = valeur.trim().toLowerCase(), data: Record<string, unknown> = { entity_id: entity };
  const n = /^(\d{1,3})(?:[.,](\d))?\s*(%|°|°c)?$/.exec(v), num = n ? Number(`${n[1]}.${n[2] ?? 0}`) : undefined;
  const on = ON.test(v), off = OFF.test(v);
  const out = (service: string, more: Record<string, unknown> = {}) => ({ domain, service, data: { ...data, ...more } });
  if (num !== undefined) {
    if (domain === 'light') return out('turn_on', { brightness_pct: Math.min(100, num) });
    if (domain === 'cover') return out('set_cover_position', { position: Math.min(100, num) });
    if (domain === 'climate') return out('set_temperature', { temperature: num });
    if (domain === 'fan') return out('set_percentage', { percentage: Math.min(100, num) });
    if (domain === 'media_player') return out('volume_set', { volume_level: Math.min(100, num) / 100 });
  }
  if (domain === 'cover') { if (v === 'stop') return out('stop_cover'); if (on || off) return out(on ? 'open_cover' : 'close_cover'); }
  if (domain === 'lock' && (on || off)) return out(on ? 'unlock' : 'lock');
  if (domain === 'vacuum' && (on || off)) return out(on ? 'start' : 'return_to_base');
  if (domain === 'media_player' && /^(pause|lecture|play|suivant|precedent|précédent)$/.test(v)) return out({ pause: 'media_pause', lecture: 'media_play', play: 'media_play', suivant: 'media_next_track', precedent: 'media_previous_track', 'précédent': 'media_previous_track' }[v]!);
  if (on || off) return out(on ? 'turn_on' : 'turn_off');
  throw new Error(`ordre non compris pour ${entity} : « ${valeur} » (on, off, ouvre, ferme, un nombre…)`);
}
/** Ouvrir une serrure, un garage ou un portail, c'est ouvrir la maison : toujours avec ton accord. */
export function sensitive(appareil: string, valeur: string): string | undefined {
  if (!ON.test(valeur.trim().toLowerCase())) return undefined;
  const own = appareil.startsWith('ha:') ? undefined : allDevices().find((d) => d.id === appareil || d.name.toLowerCase() === appareil.toLowerCase());
  const lock = /^ha:lock\./.test(appareil) || own?.kind === 'serrure';
  const gate = (/^ha:cover\./.test(appareil) || own?.kind === 'volet') && /garage|portail|porte|gate|door/i.test(`${appareil} ${own?.name ?? ''}`);
  return lock ? `déverrouiller ${own?.name ?? appareil.replace(/^ha:/, '')}` : gate ? `ouvrir ${own?.name ?? appareil.replace(/^ha:/, '')}` : undefined;
}
async function set(ctx: ModCtx, appareil: string, valeur: string): Promise<string> {
  if (appareil.startsWith('ha:')) {
    const url = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!url || !token) throw new Error('Home Assistant non relié');
    const c = haCommand(appareil.slice(3), valeur);
    await haApi(url, token, 'POST', `/services/${c.domain}/${c.service}`, c.data);
    return `${appareil.slice(3)} → ${c.service}`;
  }
  return command(ctx, appareil, valeur);
}
/** Une scène qui ouvre la maison (serrure, garage, portail) demande ton accord. */
export function sceneRisk(sc: Scene | undefined): string | undefined { const r = sc?.steps.map((st) => sensitive(st.appareil, st.valeur)).filter(Boolean) ?? []; return r.length ? `scène « ${sc!.name} » : ${r.join(', ')}` : undefined; }
export async function runScene(ctx: ModCtx, name: string): Promise<string> {
  const sc = scenes(ctx).find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!sc) throw new Error(`scène inconnue : ${name}`);
  const out: string[] = [];
  for (const st of sc.steps) {
    try {
      // « appli.action = valeur » : la scène pilote une autre appli (Vénus lance le film, Apollon la musique, Orphée annonce…).
      const app = /^([\p{L}]+)\.([a-z_]+)$/u.exec(st.appareil.trim()), mod = app ? ctx.modules().find((m) => m.id === app[1].toLowerCase() || m.name.toLowerCase() === app[1].toLowerCase()) : undefined;
      if (app && mod) {
        const a = mod.actions.find((x) => x.id === app[2]); if (!a) throw new Error(`action inconnue : ${app[2]}`);
        const first = (a.params ?? []).find((p) => p.required) ?? (a.params ?? [])[0], input = first ? { [first.key]: st.valeur } : {};
        if (a.grave?.(input)) throw new Error('action grave : elle ne part pas d\'une scène, lance-la toi-même');
        const r = await ctx.call(mod.id, a.id, input, `scène « ${sc.name} »`);
        out.push(`${r.ok === false ? '✗' : '✓'} ${mod.name} · ${a.label} : ${r.text.split('\n')[0].slice(0, 120)}`);
      } else out.push(`✓ ${await set(ctx, st.appareil, st.valeur)}`);
    } catch (e) { out.push(`✗ ${st.appareil} : ${(e as Error).message}`); }
  }
  ctx.emit('scene', { scène: sc.name });
  return `🎬 ${sc.name}\n${out.join('\n')}`;
}

export const midgard: Module = {
  id: 'midgard', name: 'Midgard', family: 'Maison',
  what: 'Le tableau de bord de la maison : pièces, scènes, et les appareils de toutes tes box réunis.',
  does: ['tableau de bord par pièce (cartes Mosaïque, bulles Écume)', 'scènes : plusieurs appareils d\'un coup (« Je pars », « Film », « Bonne nuit »)', 'ponts vers d\'autres box (Home Assistant, et box compatibles) : leurs appareils apparaissent ici', 'allumer, éteindre, ouvrir, fermer depuis le tableau ou par la voix', 'chaque changement d\'état peut lancer une automatisation Talos'],
  from: ['Home Assistant', 'Mushroom', 'Bubble Card', 'HACS', 'openHAB', 'Domoticz', 'ioBroker'], upstream: ['home-assistant/core', 'piitaya/lovelace-mushroom', 'Clooos/Bubble-Card'],
  modes: ['Mosaïque · cartes', 'Écume · bulles', 'Ponts · autres box domotiques'],
  words: ['maison', 'domotique', 'scene', 'scène', 'je pars', 'bonne nuit', 'piece', 'pièce', 'salon', 'chambre', 'tableau de bord', 'home assistant'],
  actions: [
    { id: 'maison', label: 'État de la maison', what: 'Résumé par pièce', read: true, words: ['etat de la maison', 'état de la maison', 'comment va la maison'], run: async (ctx) => { const d = await devices(ctx); const rooms = [...new Set(d.map((x) => x.room || 'Sans pièce'))]; return { text: rooms.map((r) => `${r} : ${d.filter((x) => (x.room || 'Sans pièce') === r).map((x) => `${x.name} ${x.state ?? '?'}${x.unit ? ` ${x.unit}` : ''}`).join(', ')}`).join('\n') || 'Aucun appareil relié.' }; } },
    { id: 'scene', label: 'Lancer une scène', what: 'Plusieurs appareils d\'un coup', params: [{ key: 'scene', label: 'Scène', kind: 'text', required: true }], grave: (i, ctx) => (ctx ? sceneRisk(scenes(ctx).find((x) => x.name.toLowerCase() === s(i.scene).toLowerCase())) : undefined), words: ['scene', 'scène', 'je pars', 'je rentre', 'bonne nuit', 'film'], run: async (ctx, i) => ({ text: await runScene(ctx, s(i.scene)) }) },
    { id: 'creer_scene', label: 'Créer une scène', what: 'Nom + une ligne par étape : « appareil = valeur », ou « appli.action = valeur » pour piloter une autre appli (ex. freyja.regarder = Inception)', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'etapes', label: 'Appareil = valeur (une par ligne)', kind: 'textarea', required: true }], run: (ctx, i) => { const steps = s(i.etapes).split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((x) => x[0] && x[1]).map(([appareil, valeur]) => ({ appareil, valeur })); ctx.saveSettings({ scenes: [...scenes(ctx).filter((x) => x.name !== s(i.nom)), { name: s(i.nom), steps }] }); return { text: `🎬 Scène « ${s(i.nom)} » : ${steps.length} appareil(s).` }; } },
    { id: 'commander', undo: (i) => { const inv = INVERSE[String(i.valeur ?? '').trim().toLowerCase()]; return inv ? { action: 'commander', input: { appareil: i.appareil, valeur: inv }, label: `remis sur « ${inv} »` } : undefined; }, label: 'Commander', what: 'Un appareil (de n\'importe quelle box)', params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'valeur', label: 'Valeur', kind: 'text', required: true }], grave: (i) => sensitive(s(i.appareil), s(i.valeur)), run: async (ctx, i) => ({ text: `✓ ${await set(ctx, s(i.appareil), s(i.valeur))}` }) },
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
      side: [{ kind: 'list', title: 'Scènes', items: scenes(ctx).map((x) => ({ title: x.name, detail: x.steps.map((st) => `${st.appareil} = ${st.valeur}`).join(', ') })), empty: 'Aucune scène.' }, { kind: 'form', title: 'Créer une scène', action: 'creer_scene', submit: 'Créer', params: midgard.actions.find((a) => a.id === 'creer_scene')?.params ?? [] }, { kind: 'form', title: 'Relier une box', action: 'pont', submit: 'Relier', params: midgard.actions.find((a) => a.id === 'pont')?.params ?? [] }],
    };
  },
};

/** Les appareils de toutes les box (pour l'écran de la maison, Hestia). */
export const homeDevices = (ctx: ModCtx) => devices(ctx);
export const homeScenes = (ctx: ModCtx) => scenes(ctx);
export type HomeDevice = Dev;
/** Les membres de la famille suivis par la box (entités « person » : position partagée par l'appli Home Assistant de chacun). */
export async function homePeople(ctx: ModCtx): Promise<Array<{ id: string; name: string; state: string; since?: string; lat?: number; lon?: number; picture?: string }>> {
  const url = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!url || !token) return [];
  const st = await haApi(url, token, 'GET', '/states') as Array<HaState & { last_changed?: string }>;
  return st.filter((x) => x.entity_id.startsWith('person.')).map((x) => ({ id: x.entity_id, name: x.attributes.friendly_name ?? x.entity_id.slice(7), state: x.state, since: x.last_changed, ...(typeof x.attributes.latitude === 'number' && typeof x.attributes.longitude === 'number' ? { lat: x.attributes.latitude, lon: x.attributes.longitude } : {}) }));
}
