// Brokkr, Appareils et Midgard contre un module Tasmota simulé (une prise avec mesure de
// consommation, micrologiciel 14.x) : Odin le trouve, le branche sur son relais de messages, le
// module s'annonce au format Tasmota d'aujourd'hui, puis Odin l'allume, lit sa consommation et
// apprend tout de suite quand il est débranché.

import { appareils, allDevices } from '../../../src/valhalla/modules/appareils.ts';
import { brokkr } from '../../../src/valhalla/modules/brokkr.ts';
import { midgard } from '../../../src/valhalla/modules/midgard.ts';
import { tasmotaSim } from '../sim/tasmota.ts';
import { freePort, until, type Scenario } from '../lib.ts';

const IP = '10.77.0.50'; // adresse « sur le réseau » du module simulé

export const tasmota: Scenario = {
  id: 'tasmota', title: 'Brokkr, Appareils ↔ module Tasmota', mode: 'simulé',
  what: 'Une prise Tasmota simulée (web + MQTT comme le vrai micrologiciel) : identification, branchement sur le relais d\'Odin, annonce native, allumage, consommation, hors ligne, mise à jour.',
  async run(t) {
    const dev = await tasmotaSim({ name: 'Prise salon', webPassword: 'web-du-module' });
    t.onEnd(() => dev.close());
    const env = { MQTT_PASSWORD: process.env.MQTT_PASSWORD, TASMOTA_PASSWORD: process.env.TASMOTA_PASSWORD };
    t.onEnd(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    process.env.MQTT_PASSWORD = 'relais-banc-Zx81'; delete process.env.TASMOTA_PASSWORD;
    // Le module est joint à son adresse du réseau local ; ici elle mène au simulateur.
    const net: typeof fetch = (input, init) => fetch(String(input).replace(`http://${IP}/`, `${dev.url}/`), init);
    const { v, events } = t.valhalla([appareils, brokkr, midgard], { fetch: net });
    const port = await freePort();
    v.ctx('appareils').saveSettings({ port });
    await appareils.start!(v.ctx('appareils')); t.onEnd(() => appareils.stop?.());
    const act = (m: string, a: string, i: Record<string, unknown> = {}, o = {}) => v.act(m, a, i, o);

    // Sans le mot de passe web du module : refus propre.
    const locked = await act('brokkr', 'commande', { ip: IP, commande: 'Power' });
    t.ok(locked.ok === false && /401/.test(locked.text), 'module protégé par mot de passe : sans lui, refus clair', locked.text);
    process.env.TASMOTA_PASSWORD = 'web-du-module';
    t.match((await act('brokkr', 'commande', { ip: IP, commande: 'Status 0' })).text, /"Version":"14\.4\.1/, 'avec le mot de passe (coffre) : le module répond (version lue)');

    await act('brokkr', 'commande', { ip: IP, commande: 'Power on' });
    t.ok(dev.state.power === true, 'commande directe « Power on » : le relais du module s\'allume');
    await act('brokkr', 'commande', { ip: IP, commande: 'Power off' });
    t.match((await act('brokkr', 'commande', { ip: IP, commande: 'Upgrade 1' })).text, /sensible/, 'une commande sensible (Upgrade, Reset…) ne passe pas par « commande »');

    // Brancher sur le relais d'Odin.
    v.ctx('brokkr').saveSettings({ modules: [{ ip: IP, kind: 'Tasmota', name: 'Prise salon', seen: new Date().toISOString() }] });
    const plug = await act('brokkr', 'brancher', { ip: IP, odin: '127.0.0.1', port });
    t.ok(plug.ok, 'branchement demandé (hôte, port, identifiant et mot de passe du relais envoyés au module)', plug.text);
    t.ok(dev.commands.some((c) => /SetOption19 0/.test(c)) && !dev.commands.some((c) => c.includes('relais-banc-Zx81')), 'annonce native demandée (SetOption19 0)');
    t.ok(await until(() => dev.mqtt().connected, 8000), 'le module redémarre et se connecte au relais d\'Odin avec ses identifiants', JSON.stringify(dev.mqtt()));
    t.ok(await until(() => allDevices().some((d) => d.name === 'Prise salon'), 5000), 'il s\'annonce : Appareils le reconnaît tout seul');
    const d = allDevices().find((x) => x.name === 'Prise salon');
    t.ok(d?.kind === 'prise' && d.network === 'Prise flashée' && d.commandTopic === `cmnd/${dev.topic}/POWER1`, 'reconnu comme une prise flashée, avec son sujet de commande', JSON.stringify(d));
    t.ok(await until(() => allDevices().find((x) => x.name === 'Prise salon')?.state === 'OFF', 3000), 'son état est connu (OFF)');
    t.ok(allDevices().some((x) => x.name === 'Prise salon puissance' && x.unit === 'W') && allDevices().some((x) => x.name === 'Prise salon énergie du jour'), 'ses capteurs de consommation sont repris (puissance, énergie du jour, tension)', allDevices().map((x) => x.name).join(', '));

    // Piloter par le relais (Appareils), puis par Midgard.
    const on = await act('appareils', 'commander', { appareil: 'Prise salon', valeur: 'on' });
    t.ok(on.ok && await until(() => dev.state.power === true, 3000), '« allume la prise du salon » : l\'ordre arrive au module par le relais', on.text);
    t.ok(await until(() => allDevices().find((x) => x.name === 'Prise salon')?.state === 'ON', 3000), 'le module confirme : état ON');
    t.ok(await until(() => allDevices().find((x) => x.name === 'Prise salon puissance')?.state === '42', 3000), 'la puissance mesurée remonte (42 W)', allDevices().find((x) => x.name === 'Prise salon puissance')?.state);
    t.ok(events.some((e) => e.type === 'etat' && e.data.appareil === 'Prise salon' && e.data.après === 'ON'), 'événement « état » émis (pour les scènes et Draupnir)');
    await act('appareils', 'ranger', { appareil: 'Prise salon', piece: 'Salon' });
    t.match((await act('midgard', 'maison')).text, /^Salon : .*Prise salon ON/m, 'Midgard montre la prise dans le salon, allumée');
    await act('midgard', 'creer_scene', { nom: 'Bonne nuit', etapes: 'Prise salon = off' });
    await act('midgard', 'scene', { scene: 'Bonne nuit' }, { auto: true });
    t.ok(await until(() => dev.state.power === false, 3000), 'scène « Bonne nuit » : la prise s\'éteint');

    // Mise à jour : avec ton accord seulement.
    const up = await act('brokkr', 'mettre_a_jour', { ip: IP }, { auto: true });
    t.ok(up.ok === false && dev.state.upgrades === 0, 'mise à jour du micrologiciel refusée à une automatisation');
    await act('brokkr', 'mettre_a_jour', { ip: IP });
    t.ok(dev.state.upgrades === 1 && await until(() => dev.mqtt().connected, 8000), 'avec ton accord : mise à jour lancée, le module revient sur le relais');

    // Débranché : su tout de suite.
    dev.unplug();
    t.ok(await until(() => allDevices().find((x) => x.name === 'Prise salon')?.online === false, 5000), 'module débranché : Appareils le voit hors ligne tout de suite (dernière volonté)');
    t.ok(events.some((e) => e.type === 'disponibilite' && e.data.en_ligne === false), 'événement « hors ligne » émis');
    const view = await appareils.view(v.ctx('appareils'), new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Hors ligne' && Number(k.value) >= 1), 'la page compte les appareils hors ligne');

    // Un module avec un mauvais mot de passe n'entre pas sur le relais.
    const intrus = await tasmotaSim({ name: 'Intrus', mac: 'AABBCC000001' }); t.onEnd(() => intrus.close());
    await fetch(`${intrus.url}/cm?cmnd=${encodeURIComponent(`Backlog MqttHost 127.0.0.1; MqttPort ${port}; MqttUser odin; MqttPassword mauvais`)}`);
    t.ok(await until(() => /refusés/.test(intrus.mqtt().error ?? ''), 6000) && !allDevices().some((x) => x.name === 'Intrus'), 'mauvais mot de passe : le relais refuse le module, rien n\'apparaît', JSON.stringify(intrus.mqtt()));
  },
};
