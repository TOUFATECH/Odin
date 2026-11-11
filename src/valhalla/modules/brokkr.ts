// Brokkr — l'atelier des modules connectés : trouve les prises et modules flashés (Tasmota, ESPHome)
// sur le réseau, les branche sur le relais d'Odin en un clic, leur envoie des commandes, prépare la
// configuration d'un nouveau module ESP (capteurs, relais) et lance leurs mises à jour.

import { localSubnets, probe } from '../../hlidskjalf/discover.ts';
import type { ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
export interface Mod { ip: string; kind: 'Tasmota' | 'ESPHome'; name: string; version?: string; mqtt?: string; seen: string }
const mods = (ctx: ModCtx): Mod[] => (ctx.settings.modules as Mod[] | undefined) ?? [];
async function tasmota(ctx: ModCtx, ip: string, cmd: string): Promise<Record<string, unknown>> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error('adresse invalide');
  const pw = process.env.TASMOTA_PASSWORD ? `&user=admin&password=${encodeURIComponent(process.env.TASMOTA_PASSWORD)}` : '';
  const r = await ctx.fetch(`http://${ip}/cm?cmnd=${encodeURIComponent(cmd)}${pw}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${ip} : HTTP ${r.status}`);
  return await r.json() as Record<string, unknown>;
}
async function identify(ctx: ModCtx, ip: string): Promise<Mod | undefined> {
  try { const j = await tasmota(ctx, ip, 'Status 0') as { Status?: { DeviceName?: string; FriendlyName?: string[] }; StatusFWR?: { Version?: string }; StatusMQT?: { MqttHost?: string } }; if (j.Status) return { ip, kind: 'Tasmota', name: j.Status.DeviceName ?? j.Status.FriendlyName?.[0] ?? ip, version: j.StatusFWR?.Version, mqtt: j.StatusMQT?.MqttHost, seen: ctx.now().toISOString() }; } catch { /* pas Tasmota */ }
  try { const r = await ctx.fetch(`http://${ip}/`, { signal: AbortSignal.timeout(4000) }); const t = await r.text(); if (/esphome/i.test(t) || /esphome/i.test(r.headers.get('server') ?? '')) return { ip, kind: 'ESPHome', name: /<title>([^<]+)<\/title>/i.exec(t)?.[1] ?? ip, seen: ctx.now().toISOString() }; } catch { /* rien */ }
  return undefined;
}
/** Configuration d'un module ESP (format ESPHome) à partir d'une description simple. */
export function espConfig(name: string, parts: string[], o: { wifi: string; mqttHost: string; mqttUser: string }): string {
  const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
  const blocks: string[] = [];
  for (const p of parts) {
    const [kind, pin = 'GPIO4'] = p.split('@').map((x) => x.trim());
    if (/temp|dht/i.test(kind)) blocks.push(`sensor:\n  - platform: dht\n    pin: ${pin}\n    temperature:\n      name: "${name} température"\n    humidity:\n      name: "${name} humidité"\n    update_interval: 60s`);
    else if (/relais|relay|prise/i.test(kind)) blocks.push(`switch:\n  - platform: gpio\n    pin: ${pin}\n    name: "${name} relais"`);
    else if (/mouvement|pir/i.test(kind)) blocks.push(`binary_sensor:\n  - platform: gpio\n    pin: ${pin}\n    name: "${name} mouvement"\n    device_class: motion`);
    else if (/porte|contact/i.test(kind)) blocks.push(`binary_sensor:\n  - platform: gpio\n    pin:\n      number: ${pin}\n      mode: INPUT_PULLUP\n    name: "${name} porte"\n    device_class: door`);
  }
  return `esphome:\n  name: ${id}\n\nesp32:\n  board: esp32dev\n\nwifi:\n  ssid: "${o.wifi}"\n  password: !secret wifi_password\n\nlogger:\nota:\n  - platform: esphome\n\nmqtt:\n  broker: ${o.mqttHost}\n  username: ${o.mqttUser}\n  password: !secret mqtt_password\n  discovery: true\n\n${blocks.join('\n\n')}\n`;
}

export const brokkr: Module = {
  id: 'brokkr', name: 'Brokkr', family: 'Maison',
  what: 'L\'atelier des modules connectés : trouver, brancher sur Odin, commander et préparer les prises et modules ESP.',
  does: ['trouve les prises et modules flashés sur le réseau (Tasmota, ESPHome)', 'les branche sur le relais d\'Odin en un clic (ils apparaissent ensuite dans Appareils)', 'commandes directes (allumer, consommation, redémarrer)', 'prépare la configuration d\'un nouveau module ESP (température, relais, mouvement, porte)', 'mise à jour du micrologiciel (avec ton accord)'],
  from: ['ESPHome', 'Tasmota'], upstream: ['esphome/esphome', 'arendst/Tasmota'],
  modes: ['Eitri · prises flashées'],
  words: ['tasmota', 'esphome', 'esp32', 'esp8266', 'module', 'modules', 'prise connectee', 'prise connectée', 'flasher', 'micrologiciel', 'firmware'],
  actions: [
    { id: 'chercher', label: 'Chercher les modules', what: 'Balaye le réseau local', read: true, words: ['cherche', 'trouve', 'detecte', 'détecte'], run: async (ctx) => {
      const found: Mod[] = [];
      for (const sn of localSubnets()) {
        // D'abord qui répond sur le port web (rapide), puis seulement ceux-là sont interrogés.
        const hosts = sn.hosts.slice(0, 254).filter((h) => h !== sn.address), open: string[] = [];
        for (let i = 0; i < hosts.length; i += 64) open.push(...(await Promise.all(hosts.slice(i, i + 64).map(async (h) => ((await probe(h, 80, 700)) === 'open' ? h : '')))).filter(Boolean));
        for (let i = 0; i < open.length; i += 8) { const r = await Promise.all(open.slice(i, i + 8).map((h) => identify(ctx, h))); found.push(...r.filter((x): x is Mod => Boolean(x))); }
      }
      ctx.saveSettings({ modules: [...found, ...mods(ctx).filter((m) => !found.some((f) => f.ip === m.ip))] });
      return { text: found.map((m) => `- ${m.name} (${m.kind} ${m.version ?? ''}) ${m.ip}${m.mqtt ? ` · relais : ${m.mqtt}` : ' · pas branché'}`).join('\n') || 'Aucun module trouvé.' };
    } },
    { id: 'brancher', label: 'Brancher sur Odin', what: 'Configure le module pour qu\'il parle au relais d\'Odin', params: [{ key: 'ip', label: 'Adresse du module', kind: 'text', required: true }, { key: 'odin', label: 'Adresse d\'Odin sur le réseau', kind: 'text', required: true }, { key: 'port', label: 'Port du relais', kind: 'number', default: 1883 }], run: async (ctx, i) => {
      const pass = process.env.MQTT_PASSWORD; if (!pass) throw new Error('mot de passe du relais absent du coffre (MQTT_PASSWORD) : ouvre la page Appareils une fois');
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(s(i.odin))) throw new Error('adresse d\'Odin : une adresse IP du réseau local (ex. 192.168.1.20)');
      const port = Number(i.port) || 1883;
      // SetOption19 0 : le module s'annonce au format Tasmota d'aujourd'hui (tasmota/discovery/…), compris par Appareils.
      await tasmota(ctx, s(i.ip), `Backlog MqttHost ${s(i.odin)}; MqttPort ${port}; MqttUser odin; MqttPassword ${pass}; SetOption19 0`);
      ctx.saveSettings({ modules: mods(ctx).map((m) => (m.ip === s(i.ip) ? { ...m, mqtt: s(i.odin) } : m)) });
      return { text: `🔌 ${s(i.ip)} branché sur Odin : il redémarre puis apparaît dans Appareils.` };
    } },
    { id: 'commande', label: 'Commande', what: 'Commande directe à un module Tasmota', params: [{ key: 'ip', label: 'Adresse', kind: 'text', required: true }, { key: 'commande', label: 'Commande (Power on, Status 8…)', kind: 'text', required: true }], run: async (ctx, i) => { if (/^(reset|upgrade|otaurl|password|webpassword)/i.test(s(i.commande))) throw new Error('commande sensible : utilise l\'action dédiée'); return { text: JSON.stringify(await tasmota(ctx, s(i.ip), s(i.commande))) }; } },
    { id: 'mettre_a_jour', label: 'Mettre à jour', what: 'Met à jour le micrologiciel Tasmota (officiel)', params: [{ key: 'ip', label: 'Adresse', kind: 'text', required: true }], grave: (i) => `mettre à jour le micrologiciel de ${s(i.ip)}`, run: async (ctx, i) => { await tasmota(ctx, s(i.ip), 'Upgrade 1'); return { text: `⬆ Mise à jour lancée sur ${s(i.ip)} (2 à 3 minutes).` }; } },
    { id: 'preparer', label: 'Préparer un module ESP', what: 'Configuration prête à flasher', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'parties', label: 'Parties (une par ligne : température@GPIO4, relais@GPIO5, mouvement@GPIO13, porte@GPIO14)', kind: 'textarea', required: true }, { key: 'wifi', label: 'Nom du Wi-Fi', kind: 'text', required: true }, { key: 'odin', label: 'Adresse d\'Odin', kind: 'text', required: true }], run: (_ctx, i) => ({ text: espConfig(s(i.nom), s(i.parties).split('\n').filter((x) => x.trim()), { wifi: s(i.wifi), mqttHost: s(i.odin), mqttUser: 'odin' }) }) },
  ],
  view(ctx) {
    const m = mods(ctx);
    return {
      subtitle: `${m.length} module(s) connu(s)`,
      tabs: ['Brokkr · modules', 'Eitri · prises flashées'],
      kpis: [{ label: 'Modules', value: String(m.length) }, { label: 'Branchés sur Odin', value: String(m.filter((x) => x.mqtt).length) }],
      sections: [{ kind: 'table', title: 'Modules trouvés', columns: ['Module', 'Type', 'Adresse', 'Version', 'Relais'], empty: 'Lance « Chercher les modules ».', rows: m.map((x) => ({ cells: [x.name, x.kind, x.ip, x.version ?? '—', x.mqtt ?? 'pas branché'], tone: x.mqtt ? 'bon' : 'attention', actions: x.kind === 'Tasmota' ? [{ action: 'commande', label: 'Allumer', input: { ip: x.ip, commande: 'Power on' } }, { action: 'commande', label: 'Éteindre', input: { ip: x.ip, commande: 'Power off' } }, { action: 'mettre_a_jour', label: 'Mettre à jour', input: { ip: x.ip } }] : [] })) }],
      side: [{ kind: 'form', title: 'Brancher sur Odin', action: 'brancher', submit: 'Brancher', params: brokkr.actions.find((a) => a.id === 'brancher')?.params ?? [] }, { kind: 'form', title: 'Préparer un module ESP', action: 'preparer', submit: 'Préparer', params: brokkr.actions.find((a) => a.id === 'preparer')?.params ?? [] }],
    };
  },
};
