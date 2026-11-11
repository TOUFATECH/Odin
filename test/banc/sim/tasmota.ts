// Faux module Tasmota (une prise connectée avec mesure de consommation) : il se comporte comme le
// micrologiciel d'aujourd'hui (14.x), côté web (commandes /cm : Status, Power, Backlog, Upgrade…)
// comme côté MQTT (dernière volonté, annonce native tasmota/discovery/…, états, capteurs, ordres).
// Comme le vrai : l'ancienne annonce « Home Assistant » (SetOption19 1) n'existe plus.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MqttClient } from './mqtt-client.ts';

export interface TasmotaSim {
  url: string; host: string; port: number; mac: string; topic: string;
  /** État courant (relais, réglages MQTT). */
  state: { power: boolean; settings: Record<string, string>; version: string; upgrades: number; restarts: number };
  /** Commandes reçues par le web, dans l'ordre. */
  commands: string[];
  mqtt(): { connected: boolean; error?: string };
  /** Coupe le courant du module (le relais doit publier « Offline »). */
  unplug(): void;
  close(): Promise<void>;
}

export async function tasmotaSim(o: { name?: string; mac?: string; host?: string; port?: number; webPassword?: string; restartMs?: number } = {}): Promise<TasmotaSim> {
  const mac = (o.mac ?? 'DC4F22AB12CD').toUpperCase(), topic = `tasmota_${mac.slice(-6)}`, name = o.name ?? 'Prise salon';
  const st: TasmotaSim['state'] = { power: false, version: '14.4.1(release-tasmota)', upgrades: 0, restarts: 0, settings: { DeviceName: name, FriendlyName1: name, Topic: topic, MqttHost: '', MqttPort: '1883', MqttUser: 'DVES_USER', MqttPassword: '', SetOption19: '0' } };
  const commands: string[] = [];
  let client: MqttClient | undefined, mqttError: string | undefined, closed = false, retry: ReturnType<typeof setTimeout> | undefined;
  const now = () => new Date().toISOString().slice(0, 19);
  const energy = () => ({ TotalStartTime: '2026-01-01T00:00:00', Total: 12.345, Yesterday: 0.512, Today: 0.127, Power: st.power ? 42 : 0, ApparentPower: st.power ? 47 : 0, ReactivePower: st.power ? 21 : 0, Factor: st.power ? 0.89 : 0, Voltage: 231, Current: st.power ? 0.204 : 0 });
  const P = () => (st.power ? 'ON' : 'OFF');
  const pubState = () => { client?.publish(`stat/${topic}/RESULT`, JSON.stringify({ POWER: P() })); client?.publish(`stat/${topic}/POWER`, P()); };
  const pubTele = () => {
    client?.publish(`tele/${topic}/STATE`, JSON.stringify({ Time: now(), Uptime: '0T00:00:09', UptimeSec: 9, Heap: 26, SleepMode: 'Dynamic', Sleep: 50, LoadAvg: 19, MqttCount: 1, POWER: P(), Wifi: { AP: 1, SSId: 'Maison', BSSId: '00:11:22:33:44:55', Channel: 6, Mode: '11n', RSSI: 74, Signal: -63, LinkCount: 1, Downtime: '0T00:00:03' } }));
    client?.publish(`tele/${topic}/SENSOR`, JSON.stringify({ Time: now(), ENERGY: energy() }));
  };
  const setPower = (v: string) => { const x = v.trim().toUpperCase(); if (x === 'ON' || x === '1' || x === 'TRUE') st.power = true; else if (x === 'OFF' || x === '0' || x === 'FALSE') st.power = false; else if (x === 'TOGGLE' || x === '2') st.power = !st.power; pubState(); if (x) pubTele(); };

  async function mqttConnect(): Promise<void> {
    if (closed || !st.settings.MqttHost) return;
    client?.close(false);
    const c = new MqttClient(); client = c; mqttError = undefined;
    c.on((t, payload) => { const m = new RegExp(`^cmnd/${topic}/(\\w+)$`).exec(t); if (!m) return; const cmd = m[1].toUpperCase(); if (cmd === 'POWER' || cmd === 'POWER1') setPower(payload.toString()); else if (cmd === 'STATE') pubTele(); });
    try {
      await c.connect(st.settings.MqttHost, Number(st.settings.MqttPort) || 1883, { clientId: `DVES_${mac.slice(-6)}`, user: st.settings.MqttUser, pass: st.settings.MqttPassword, will: { topic: `tele/${topic}/LWT`, payload: 'Offline', retain: true }, keepalive: 30 });
      c.publish(`tele/${topic}/LWT`, 'Online', { retain: true });
      await c.subscribe(`cmnd/${topic}/#`);
      // Annonce native (SetOption19 0, le réglage d'usine). L'ancienne annonce n'est plus dans le micrologiciel.
      if (st.settings.SetOption19 === '0') {
        c.publish(`tasmota/discovery/${mac}/config`, JSON.stringify({ ip: o.host ?? '127.0.0.1', dn: st.settings.DeviceName, fn: [st.settings.FriendlyName1, null, null, null, null, null, null, null], hn: `tasmota-${mac.slice(-6)}-4813`, mac, md: 'Sonoff S2X', ty: 0, if: 0, ofln: 'Offline', onln: 'Online', state: ['OFF', 'ON', 'TOGGLE', 'HOLD'], sw: st.version.replace(/\(.*/, ''), t: topic, ft: '%prefix%/%topic%/', tp: ['cmnd', 'stat', 'tele'], rl: [1, 0, 0, 0, 0, 0, 0, 0], swc: [-1, -1, -1, -1, -1, -1, -1, -1], swn: [null, null, null, null, null, null, null, null], btn: [0, 0, 0, 0, 0, 0, 0, 0], so: { 4: 0, 11: 0, 13: 0, 17: 0, 20: 0, 30: 0, 68: 0, 73: 0, 82: 0, 114: 0, 117: 0 }, lk: 0, lt_st: 0, bat: 0, dslp: 0, sho: [], sht: [], ver: 1 }), { retain: true });
        c.publish(`tasmota/discovery/${mac}/sensors`, JSON.stringify({ sn: { Time: now(), ENERGY: energy() }, ver: 1 }), { retain: true });
      }
      c.publish(`tele/${topic}/INFO1`, JSON.stringify({ Info1: { Module: 'Sonoff S2X', Version: st.version, FallbackTopic: `cmnd/DVES_${mac.slice(-6)}_fb/`, GroupTopic: 'cmnd/tasmotas/' } }));
      pubState(); pubTele();
    } catch (e) { mqttError = (e as Error).message; if (!closed) retry = setTimeout(() => void mqttConnect(), 2000); retry?.unref(); }
  }
  const restart = () => { st.restarts++; client?.close(true); client = undefined; setTimeout(() => void mqttConnect(), o.restartMs ?? 300).unref(); };

  function run(cmd: string): Record<string, unknown> {
    const m = /^\s*(\w+)\s*(.*)$/s.exec(cmd); if (!m) return { Command: 'Unknown' };
    const key = m[1].toLowerCase(), arg = m[2].trim();
    if (key === 'backlog') { let needRestart = false; for (const c of arg.split(';').map((x) => x.trim()).filter(Boolean)) { run(c); if (/^(mqtt(host|port|user|password)|topic)\b/i.test(c)) needRestart = true; } if (needRestart) restart(); return {}; }
    if (key === 'status') {
      const sns = { StatusSNS: { Time: now(), ENERGY: energy() } };
      if (arg === '8' || arg === '10') return sns;
      return { Status: { Module: 0, DeviceName: st.settings.DeviceName, FriendlyName: [st.settings.FriendlyName1], Topic: topic, ButtonTopic: '0', Power: st.power ? '1' : '0', PowerOnState: 3, LedState: 1 }, StatusFWR: { Version: st.version, BuildDateTime: '2026-10-01T10:00:00', Core: '2_7_8', SDK: '2.2.2' }, StatusNET: { Hostname: `tasmota-${mac.slice(-6)}-4813`, IPAddress: o.host ?? '127.0.0.1', Mac: mac.replace(/(..)(?=.)/g, '$1:') }, StatusMQT: { MqttHost: st.settings.MqttHost, MqttPort: Number(st.settings.MqttPort), MqttClient: `DVES_${mac.slice(-6)}`, MqttUser: st.settings.MqttUser, MqttCount: client?.connected ? 1 : 0 }, StatusSTS: { Time: now(), POWER: P() }, ...sns };
    }
    if (key === 'power' || key === 'power1') { if (arg) setPower(arg); return { POWER: P() }; }
    if (key === 'upgrade') { st.upgrades++; st.version = '14.5.0(release-tasmota)'; restart(); return { Upgrade: 'Version 14.5.0 from http://ota.tasmota.com/tasmota/release/tasmota.bin.gz' }; }
    if (key === 'restart') { if (arg === '1') restart(); return { Restart: arg === '1' ? 'Restarting' : '1 to restart' }; }
    const setting = Object.keys(st.settings).find((k) => k.toLowerCase() === key);
    if (setting) { if (arg) st.settings[setting] = arg; return { [setting]: setting === 'MqttPassword' ? '****' : setting === 'SetOption19' ? (st.settings[setting] === '1' ? 'ON' : 'OFF') : st.settings[setting] }; }
    return { Command: 'Unknown' };
  }

  const srv: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', server: 'Tasmota/14.4.1 (ESP8266EX)' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html', server: 'Tasmota/14.4.1 (ESP8266EX)' }); return void res.end(`<html><head><title>${name} - Main Menu</title></head><body>Tasmota ${st.version}</body></html>`); }
    if (u.pathname !== '/cm') return json(404, { error: 'Not found' });
    if (o.webPassword && (u.searchParams.get('user') !== 'admin' || u.searchParams.get('password') !== o.webPassword)) return json(401, { WARNING: 'Need user=<username>&password=<password>' });
    const cmd = u.searchParams.get('cmnd') ?? '';
    commands.push(cmd.replace(/(MqttPassword\s+)\S+/i, '$1****'));
    json(200, run(cmd));
  });
  await new Promise<void>((r) => srv.listen(o.port ?? 0, o.host ?? '127.0.0.1', r));
  const port = (srv.address() as AddressInfo).port, host = o.host ?? '127.0.0.1';
  return {
    url: `http://${host}:${port}`, host, port, mac, topic, state: st, commands,
    mqtt: () => ({ connected: Boolean(client?.connected), error: mqttError }),
    unplug: () => { closed = true; if (retry) clearTimeout(retry); client?.close(false); },
    close: () => new Promise<void>((r) => { closed = true; if (retry) clearTimeout(retry); client?.close(true); srv.closeAllConnections?.(); srv.close(() => r()); }),
  };
}
