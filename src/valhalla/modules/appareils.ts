// Appareils — un seul registre pour tous les appareils de la maison, quel que soit leur réseau radio.
// Tout passe par Veðrfölnir (le relais MQTT d'Odin) : les passerelles Zigbee (Hjúki), Z-Wave (Bil),
// Matter (Alfheim), radio 433 MHz / BLE (Gná) et les modules ESP ou prises flashées (Brokkr) s'y
// annoncent ; Odin les range, suit leur état, leur pile, leur signal, et leur envoie les ordres.

import { randomBytes } from 'node:crypto';
import { MqttBroker, type Msg } from '../mqtt.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Device { id: string; name: string; kind: string; room: string; network: string; state?: string; attrs: Record<string, unknown>; stateTopic?: string; commandTopic?: string; on?: string; off?: string; valueKey?: string; unit?: string; lastSeen?: string; battery?: number; signal?: number; model?: string }
const s = (v: unknown) => String(v ?? '');
const KIND: Record<string, string> = { light: 'lumière', switch: 'prise', sensor: 'capteur', binary_sensor: 'détecteur', cover: 'volet', climate: 'clim', fan: 'ventilateur', lock: 'serrure', button: 'bouton', number: 'réglage', select: 'choix', siren: 'sirène', camera: 'caméra', vacuum: 'aspirateur', valve: 'vanne' };
/** Annonce d'un appareil (format de découverte MQTT standard : <préfixe>/<type>/<nœud>/<objet>/config). */
export function fromDiscovery(topic: string, payload: string): Device | undefined {
  const m = /^[^/]+\/([^/]+)\/(?:([^/]+)\/)?([^/]+)\/config$/.exec(topic); if (!m) return undefined;
  let c: Record<string, unknown>; try { c = JSON.parse(payload); } catch { return undefined; }
  const dev = (c.device ?? c.dev ?? {}) as Record<string, unknown>;
  const base = s(c['~']), t = (x: unknown) => (x ? s(x).replace(/^~/, base) : undefined);
  const net = /zigbee/i.test(`${s(dev.via_device)} ${s(dev.sw_version)} ${s(dev.manufacturer)} ${topic}`) ? 'Zigbee' : /zwave|z-wave/i.test(topic + s(dev.manufacturer)) ? 'Z-Wave' : /tasmota/i.test(`${s(dev.sw_version)} ${topic}`) ? 'Prise flashée' : /esphome/i.test(`${s(dev.sw_version)} ${topic}`) ? 'Module ESP' : 'MQTT';
  return {
    id: s(c.unique_id ?? c.uniq_id ?? `${m[2] ?? ''}_${m[3]}`), name: s(c.name ?? dev.name ?? m[3]) || m[3], kind: KIND[m[1]] ?? m[1], room: s(dev.suggested_area ?? dev.sa ?? ''), network: net,
    stateTopic: t(c.state_topic ?? c.stat_t), commandTopic: t(c.command_topic ?? c.cmd_t), on: s(c.payload_on ?? c.pl_on ?? 'ON'), off: s(c.payload_off ?? c.pl_off ?? 'OFF'),
    valueKey: /value_json\.(\w+)/.exec(s(c.value_template ?? c.val_tpl))?.[1], unit: s(c.unit_of_measurement ?? c.unit_of_meas ?? '') || undefined, model: s(dev.model ?? dev.mdl ?? '') || undefined, attrs: {},
  };
}
/** Valeur lisible d'un message d'état (texte simple, ou JSON avec la clé du modèle). */
export function readState(d: Device, payload: string): { state: string; battery?: number; signal?: number; attrs: Record<string, unknown> } {
  let j: Record<string, unknown> | undefined; try { const x = JSON.parse(payload); if (x && typeof x === 'object') j = x; } catch { /* texte */ }
  if (!j) return { state: payload.slice(0, 60), attrs: {} };
  const v = d.valueKey ? j[d.valueKey] : j.state ?? j.POWER ?? j.contact ?? j.occupancy ?? j.temperature;
  return { state: s(typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v ?? ''), battery: typeof j.battery === 'number' ? j.battery : undefined, signal: typeof j.linkquality === 'number' ? j.linkquality : undefined, attrs: j };
}

let broker: MqttBroker | undefined, appCtx: ModCtx | undefined;
export const brokerOf = () => broker;
/** Registre partagé (Midgard, Draupnir, mode sans IA). */
export const allDevices = (): Device[] => (appCtx ? Object.values(devs(appCtx)) : []);
const devs = (ctx: ModCtx): Record<string, Device> => (ctx.settings.devices as Record<string, Device> | undefined) ?? {};
let dirty = false;
function remember(ctx: ModCtx, d: Device): void { const all = devs(ctx); const old = all[d.id]; all[d.id] = { ...d, name: old?.name ?? d.name, room: old?.room || d.room, state: old?.state, lastSeen: old?.lastSeen }; ctx.settings.devices = all; dirty = true; }
export function command(_ctx: ModCtx, idOrName: string, value: string): string {
  const all = allDevices(), q = idOrName.toLowerCase();
  const d = all.find((x) => x.id === idOrName) ?? all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q));
  if (!d) throw new Error(`appareil introuvable : ${idOrName}`);
  if (!d.commandTopic) throw new Error(`${d.name} ne reçoit pas d'ordre (capteur)`);
  if (!broker) throw new Error('relais de messages arrêté');
  const v = /^(on|allume|marche|ouvre|1|true)$/i.test(value) ? d.on ?? 'ON' : /^(off|eteins|éteins|arret|arrêt|ferme|0|false)$/i.test(value) ? d.off ?? 'OFF' : value;
  broker.publish(d.commandTopic, v);
  return `${d.name} → ${v}`;
}

export const appareils: Module = {
  id: 'appareils', name: 'Appareils', family: 'Maison',
  what: 'Tous les appareils de la maison dans un seul registre : lumières, prises, capteurs, volets, clims…',
  does: ['relais de messages intégré (Veðrfölnir) auquel les appareils se connectent', 'reconnaissance automatique des appareils qui s\'annoncent (passerelles Zigbee, Z-Wave, modules ESP, prises flashées)', 'état, pile, qualité du signal, dernière nouvelle de chaque appareil', 'allumer, éteindre, régler', 'pièces et noms', 'mode appairage des passerelles Zigbee (60 s)', 'alerte pile faible et appareil muet depuis longtemps'],
  from: ['Zigbee2MQTT', 'Z-Wave JS UI', 'Mosquitto', 'OpenMQTTGateway', 'Matter Server'], upstream: ['Koenkk/zigbee2mqtt', 'zwave-js/zwave-js-ui', 'eclipse-mosquitto/mosquitto', '1technophile/OpenMQTTGateway', 'home-assistant-libs/python-matter-server'],
  modes: ['Hjúki · Zigbee', 'Bil · Z-Wave', 'Alfheim · Matter', 'Gná · radio 433 MHz et BLE', 'Veðrfölnir · messages'],
  words: ['appareil', 'appareils', 'lumiere', 'lumière', 'lampe', 'prise', 'capteur', 'zigbee', 'z-wave', 'zwave', 'mqtt', 'appairer', 'pile', 'allume', 'eteins', 'éteins', 'volet', 'clim'],
  actions: [
    { id: 'lister', label: 'Appareils', what: 'Tous les appareils et leur état', read: true, words: ['liste', 'appareils', 'etat des appareils'], run: (ctx) => ({ text: Object.values(devs(ctx)).map((d) => `- ${d.name} (${d.kind}${d.room ? `, ${d.room}` : ''}) : ${d.state ?? '?'}${d.unit ? ` ${d.unit}` : ''}`).join('\n') || 'Aucun appareil : branche une passerelle ou un module sur le relais.' }) },
    { id: 'commander', label: 'Commander', what: 'Allumer, éteindre ou régler un appareil', params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'valeur', label: 'Valeur (on, off, nombre…)', kind: 'text', required: true }], words: ['allume', 'eteins', 'éteins', 'ouvre', 'ferme', 'regle', 'règle'], run: (ctx, i) => ({ text: `✓ ${command(ctx, s(i.appareil), s(i.valeur))}` }) },
    { id: 'ranger', label: 'Nom et pièce', what: 'Renommer un appareil et choisir sa pièce', params: [{ key: 'appareil', label: 'Appareil', kind: 'text', required: true }, { key: 'nom', label: 'Nouveau nom', kind: 'text' }, { key: 'piece', label: 'Pièce', kind: 'text' }], run: (ctx, i) => { const all = devs(ctx), d = Object.values(all).find((x) => x.id === s(i.appareil) || x.name === s(i.appareil)); if (!d) throw new Error('introuvable'); if (s(i.nom)) d.name = s(i.nom); if (s(i.piece)) d.room = s(i.piece); ctx.saveSettings({ devices: all }); return { text: `✓ ${d.name}${d.room ? ` · ${d.room}` : ''}` }; } },
    { id: 'appairer', label: 'Appairer (60 s)', what: 'Ouvre l\'appairage des passerelles Zigbee pendant 60 s', words: ['appaire', 'appairer', 'nouvel appareil'], run: () => { if (!broker) throw new Error('relais arrêté'); broker.publish('zigbee2mqtt/bridge/request/permit_join', JSON.stringify({ value: true, time: 60 })); return { text: '📡 Appairage ouvert 60 s : mets ton appareil en mode appairage.' }; } },
    { id: 'publier', label: 'Envoyer un message', what: 'Message brut sur le relais (avancé)', params: [{ key: 'sujet', label: 'Sujet', kind: 'text', required: true }, { key: 'contenu', label: 'Contenu', kind: 'text', required: true }], run: (_ctx, i) => { if (!broker) throw new Error('relais arrêté'); broker.publish(s(i.sujet), s(i.contenu)); return { text: `✉ ${s(i.sujet)} ← ${s(i.contenu)}` }; } },
    { id: 'acces', label: 'Accès au relais', what: 'Adresse, port, identifiant et mot de passe pour brancher un appareil', run: (ctx) => ({ text: `Relais MQTT : port ${ctx.settings.port ?? 1883}, utilisateur « ${ctx.settings.user ?? 'odin'} ». Le mot de passe est dans le coffre d'Odin (MQTT_PASSWORD), visible dans Réglages → Coffre.` }) },
  ],
  async start(ctx) {
    appCtx = ctx;
    let pass = process.env.MQTT_PASSWORD;
    if (!pass) { pass = randomBytes(12).toString('base64url'); ctx.saveSettings({ generatedPass: pass }); }
    broker = new MqttBroker({ user: s(ctx.settings.user ?? 'odin'), pass });
    await broker.listen(Number(ctx.settings.port ?? 1883));
    broker.on('+/+/+/config', (m) => { const d = fromDiscovery(m.topic, m.payload.toString()); if (d) remember(ctx, d); });
    broker.on('+/+/+/+/config', (m) => { const d = fromDiscovery(m.topic, m.payload.toString()); if (d) remember(ctx, d); });
    broker.on('#', (m: Msg) => {
      for (const d of Object.values(devs(ctx))) {
        if (d.stateTopic !== m.topic) continue;
        const r = readState(d, m.payload.toString()), was = d.state;
        Object.assign(d, { state: r.state, attrs: r.attrs, lastSeen: ctx.now().toISOString() }, r.battery !== undefined ? { battery: r.battery } : {}, r.signal !== undefined ? { signal: r.signal } : {});
        dirty = true;
        if (was !== r.state) ctx.emit('etat', { appareil: d.name, id: d.id, type: d.kind, pièce: d.room, avant: was ?? '', après: r.state });
      }
    });
    setInterval(() => { if (dirty) { dirty = false; ctx.saveSettings({ devices: devs(ctx) }); } }, 10_000).unref();
  },
  stop() { broker?.close(); broker = undefined; },
  view(ctx) {
    const all = Object.values(devs(ctx)), nets = [...new Set(all.map((d) => d.network))];
    return {
      subtitle: `${all.length} appareil(s) · relais ${broker ? `en marche (port ${ctx.settings.port ?? 1883}, ${broker.connected().length} connexion(s))` : 'arrêté'}`,
      tabs: ['Tous', ...nets, 'Veðrfölnir · messages'],
      kpis: [{ label: 'Appareils', value: String(all.length) }, { label: 'Piles faibles', value: String(all.filter((d) => (d.battery ?? 100) < 20).length), tone: all.some((d) => (d.battery ?? 100) < 20) ? 'attention' : 'bon' }, { label: 'Muets depuis 24 h', value: String(all.filter((d) => d.lastSeen && Date.now() - Date.parse(d.lastSeen) > 86_400_000).length) }, { label: 'Connexions au relais', value: String(broker?.connected().length ?? 0) }],
      sections: [{ kind: 'table', title: 'Appareils', columns: ['Appareil', 'Type', 'Pièce', 'Réseau', 'État', 'Pile', 'Signal', 'Dernière nouvelle'], empty: 'Aucun appareil : branche une passerelle ou un module sur le relais (voir « Accès au relais »).', rows: all.map((d) => ({ cells: [d.name, d.kind, d.room, d.network, `${d.state ?? '?'}${d.unit ? ` ${d.unit}` : ''}`, d.battery !== undefined ? `${d.battery} %` : '—', d.signal !== undefined ? String(d.signal) : '—', d.lastSeen ? new Date(d.lastSeen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'], tone: (d.battery ?? 100) < 20 ? 'attention' : undefined, actions: d.commandTopic ? [{ action: 'commander', label: 'Allumer', input: { appareil: d.id, valeur: 'on' } }, { action: 'commander', label: 'Éteindre', input: { appareil: d.id, valeur: 'off' } }] : [] })) }],
      side: [{ kind: 'log', title: 'Veðrfölnir · derniers messages', lines: [...(broker?.retained.values() ?? [])].slice(-12).map((m) => `${m.topic} ${m.payload.toString().slice(0, 60)}`) }, { kind: 'form', title: 'Nom et pièce', action: 'ranger', submit: 'Enregistrer', params: appareils.actions[2].params! }],
    };
  },
  watch: { every: 3600, run(ctx) {
    for (const d of Object.values(devs(ctx))) {
      if ((d.battery ?? 100) < 15) ctx.alert({ level: 'moyenne', title: `Pile faible : ${d.name} (${d.battery} %)`, key: `bat:${d.id}` });
      if (d.lastSeen && Date.now() - Date.parse(d.lastSeen) > 2 * 86_400_000 && d.kind !== 'bouton') ctx.alert({ level: 'info', title: `${d.name} ne donne plus de nouvelles`, key: `mute:${d.id}` });
    }
  } },
};
