// Le relais de messages d'Odin (Mercure, serveur MQTT maison) contre de VRAIS clients tiers :
// les outils Mosquitto (mosquitto_pub, mosquitto_sub). Connexion avec mot de passe, refus sans,
// messages retenus, jokers, accusé de réception, dernière volonté, puis un appareil qui s'annonce
// au format standard et qu'Odin pilote.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appareils, allDevices } from '../../../src/valhalla/modules/appareils.ts';
import { freePort, sh, until, wait, type Scenario, type T } from '../lib.ts';

export const relais: Scenario = {
  id: 'relais', title: 'Relais MQTT d\'Odin ↔ clients Mosquitto', mode: 'réel',
  what: 'Le serveur MQTT écrit pour Odin essayé avec les clients de référence Mosquitto : mot de passe, messages retenus, jokers, QoS 1, dernière volonté, découverte d\'un appareil et ordre.',
  async run(t) {
    await t.need('mosquitto_pub', 'mosquitto_sub');
    const had = process.env.MQTT_PASSWORD; process.env.MQTT_PASSWORD = 'relais-banc-Qp47';
    t.onEnd(() => { if (had === undefined) delete process.env.MQTT_PASSWORD; else process.env.MQTT_PASSWORD = had; });
    const { v, events } = t.valhalla([appareils]);
    const port = await freePort(); v.ctx('appareils').saveSettings({ port });
    await appareils.start!(v.ctx('appareils')); t.onEnd(() => appareils.stop?.());
    const auth = ['-h', '127.0.0.1', '-p', String(port), '-u', 'odin', '-P', 'relais-banc-Qp47'];
    const pub = (topic: string, msg: string, extra: string[] = [], a = auth) => sh('mosquitto_pub', [...a, '-t', topic, '-m', msg, ...extra], { timeoutMs: 10_000 });
    /** Abonné Mosquitto qui attend `count` messages (ou le délai) ; rend ce qu'il a reçu. */
    const sub = (t2: T, topic: string, count: number, extra: string[] = []) => { const p = t2.spawn('mosquitto_sub', [...auth, '-t', topic, '-C', String(count), '-W', '8', '-v', ...extra]); return { p, lines: () => p.log().split('\n').filter(Boolean) }; };

    const bad = await pub('maison/test', 'x', [], ['-h', '127.0.0.1', '-p', String(port), '-u', 'odin', '-P', 'mauvais']);
    t.ok(bad.code !== 0 && /not authori[sz]ed|Connection Refused/i.test(bad.err + bad.out), 'mauvais mot de passe : le client Mosquitto est refusé', bad.err);
    const anon = await sh('mosquitto_pub', ['-h', '127.0.0.1', '-p', String(port), '-t', 'maison/test', '-m', 'x'], { timeoutMs: 10_000 });
    t.ok(anon.code !== 0, 'sans identifiant : refusé aussi');

    const s1 = sub(t, 'maison/+/temperature', 2); await wait(400);
    t.ok((await pub('maison/salon/temperature', '24.5')).code === 0 && (await pub('maison/chambre/temperature', '26.1')).code === 0 && (await pub('maison/salon/humidite', '60')).code === 0, 'publications acceptées');
    t.ok(await until(() => s1.lines().length >= 2, 5000) && s1.lines().join('|') === 'maison/salon/temperature 24.5|maison/chambre/temperature 26.1', 'un abonné avec joker « + » reçoit les bons messages, dans l\'ordre', s1.lines().join('|'));

    await pub('maison/etat', 'porte fermée', ['-r']);
    const s2 = sub(t, 'maison/#', 1);
    t.ok(await until(() => s2.lines().includes('maison/etat porte fermée'), 5000), 'message retenu : un abonné arrivé après le reçoit quand même', s2.lines().join('|'));
    t.ok((await pub('maison/alarme', 'test', ['-q', '1'])).code === 0, 'QoS 1 : le relais accuse réception (le client attend l\'accusé)');
    const big = 'x'.repeat(200_000);
    // L'abonné compte les octets reçus (le message est trop long pour être gardé en entier dans le journal du banc).
    const s3 = t.spawn('sh', ['-c', `mosquitto_sub -h 127.0.0.1 -p ${port} -u odin -P relais-banc-Qp47 -t 'gros/#' -C 1 -W 8 | wc -c`]); await wait(400);
    const bigFile = join(t.tmp(), 'gros.txt'); writeFileSync(bigFile, big);
    await sh('mosquitto_pub', [...auth, '-t', 'gros/message', '-f', bigFile], { timeoutMs: 10_000 });
    t.ok(await until(() => Number(s3.log().trim()) >= 200_000, 9000), 'un gros message (200 Ko) passe entier jusqu\'à l\'abonné', s3.log().trim());

    // Dernière volonté : un client coupé net → le relais publie son message d'adieu.
    const s4 = sub(t, 'appareils/+/etat', 1); await wait(300);
    const mourant = t.spawn('mosquitto_sub', [...auth, '-t', 'rien/du/tout', '--will-topic', 'appareils/capteur/etat', '--will-payload', 'perdu', '-i', 'capteur-banc']);
    await wait(700); mourant.kill('SIGKILL');
    t.ok(await until(() => s4.lines().includes('appareils/capteur/etat perdu'), 6000), 'client coupé net : sa « dernière volonté » est publiée', s4.lines().join('|'));

    // Un appareil s'annonce au format standard (celui de Zigbee2MQTT, ESPHome…) et Odin le pilote.
    await pub('homeassistant/light/lampe_banc/config', JSON.stringify({ name: 'Lampe du banc', unique_id: 'lampe_banc', state_topic: 'banc/lampe/state', command_topic: 'banc/lampe/set', payload_on: 'ON', payload_off: 'OFF', availability_topic: 'banc/lampe/dispo', device: { name: 'Lampe du banc', model: 'E27', suggested_area: 'Bureau', manufacturer: 'Banc' } }), ['-r']);
    await pub('homeassistant/sensor/sonde_temp/config', JSON.stringify({ name: 'Sonde frigo', uniq_id: 'sonde_temp', stat_t: 'zigbee2mqtt/sonde', val_tpl: '{{ value_json.temperature }}', unit_of_meas: '°C', dev: { name: 'Sonde frigo', mdl: 'WSDCGQ11LM', via_device: 'zigbee2mqtt_bridge' } }), ['-r']);
    t.ok(await until(() => allDevices().some((d) => d.id === 'lampe_banc') && allDevices().some((d) => d.id === 'sonde_temp'), 4000), 'deux appareils annoncés par un client tiers : Appareils les enregistre');
    const lampe = () => allDevices().find((d) => d.id === 'lampe_banc'), sonde = () => allDevices().find((d) => d.id === 'sonde_temp');
    t.ok(lampe()?.kind === 'lumière' && lampe()?.room === 'Bureau' && sonde()?.network === 'Zigbee' && sonde()?.unit === '°C', 'type, pièce, réseau et unité reconnus', JSON.stringify([lampe(), sonde()]).slice(0, 300));
    await pub('zigbee2mqtt/sonde', JSON.stringify({ temperature: 4.2, humidity: 71, battery: 12, linkquality: 88 }));
    t.ok(await until(() => sonde()?.state === '4.2' && sonde()?.battery === 12 && sonde()?.signal === 88, 4000), 'état, pile et qualité du signal lus dans le message', JSON.stringify(sonde()));
    await appareils.watch!.run(v.ctx('appareils'));
    t.ok(v.alerts({ module: 'appareils' }).some((a) => /Pile faible : Sonde frigo \(12 %\)/.test(a.title)), 'pile à 12 % → alerte « pile faible »');
    const s5 = sub(t, 'banc/lampe/set', 1); await wait(300);
    const on = await v.act('appareils', 'commander', { appareil: 'lampe du banc', valeur: 'allume' });
    t.ok(on.ok && await until(() => s5.lines().includes('banc/lampe/set ON'), 5000), 'ordre d\'Odin : l\'appareil (client Mosquitto) reçoit « ON » sur son sujet de commande', `${on.text} ${s5.lines().join('|')}`);
    await pub('banc/lampe/state', 'ON');
    t.ok(await until(() => lampe()?.state === 'ON', 3000) && events.some((e) => e.type === 'etat' && e.data.id === 'lampe_banc'), 'l\'appareil confirme : état ON, événement émis');
    await pub('banc/lampe/dispo', 'offline');
    t.ok(await until(() => lampe()?.online === false, 3000), 'il annonce « offline » : Odin le sait hors ligne');
    t.ok(v.ctx('appareils') && (await appareils.view(v.ctx('appareils'), new URLSearchParams())).kpis?.some((k) => k.label === 'Connexions au relais'), 'la page du relais s\'affiche');
  },
};
