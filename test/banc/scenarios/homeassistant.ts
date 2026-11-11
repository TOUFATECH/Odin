// Midgard, Bragi et Ægir contre un VRAI Home Assistant, lancé pour l'occasion avec ses entités de
// démonstration (lumières, volets, clim, serrures, lecteurs). Le banc crée le compte et le jeton
// comme tu le ferais à la main, range quelques appareils dans des pièces, puis Odin pilote la maison.

import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { aegir } from '../../../src/valhalla/modules/aegir.ts';
import { bragi } from '../../../src/valhalla/modules/bragi.ts';
import { midgard } from '../../../src/valhalla/modules/midgard.ts';
import { DEFAULT_CONFIG } from '../../../src/config.ts';
import { HA_CONFIG, onboard, wsCalls, type HaAccess } from '../ha-vierge.ts';
import { freePort, has, until, type Scenario, type T } from '../lib.ts';

async function boot(t: T): Promise<HaAccess> {
  const cmd = (process.env.BANC_HASS ?? ((await has('hass')) ? 'hass' : '')).trim();
  if (!cmd) t.skip('Home Assistant n\'est pas installé sur cette machine (pip install homeassistant, puis BANC_HASS="python -m homeassistant")');
  const [bin, ...args] = cmd.split(/\s+/), port = await freePort(), dir = t.tmp('banc-ha-'), url = `http://127.0.0.1:${port}`;
  writeFileSync(join(dir, 'configuration.yaml'), HA_CONFIG(port));
  const p = t.spawn(bin, [...args, '-c', dir]);
  // Le premier lancement installe ses dépendances : jusqu'à plusieurs minutes.
  if (!(await until(async () => p.exitCode === null && (await fetch(`${url}/api/onboarding`)).ok, 420_000, 1000))) t.skip(`Home Assistant n'a pas démarré : ${p.log().split('\n').filter((l) => /ERROR|Error/.test(l)).slice(-2).join(' | ').slice(0, 300) || 'délai dépassé'}`);
  const a = await onboard(url, `Banc-${randomBytes(9).toString('base64url')}`);
  // Les entités de démonstration arrivent quelques secondes après l'API.
  await until(async () => ((await (await fetch(`${url}/api/states`, { headers: { authorization: `Bearer ${a.token}` } })).json()) as unknown[]).length > 60, 60_000, 1000);
  return a;
}

export const homeassistant: Scenario = {
  id: 'home-assistant', title: 'Midgard, Bragi, Ægir ↔ Home Assistant', mode: 'réel',
  what: 'Un vrai Home Assistant avec ses appareils de démonstration : pièces, lumières, volets, clim, serrure (avec accord), scènes, annonce vocale, radio sur une enceinte.',
  async run(t) {
    const a = await boot(t);
    const state = async (id: string) => await (await fetch(`${a.url}/api/states/${id}`, { headers: { authorization: `Bearer ${a.token}` } })).json() as { state: string; attributes: Record<string, unknown> };
    const version = ((await (await fetch(`${a.url}/api/config`, { headers: { authorization: `Bearer ${a.token}` } })).json()) as { version: string }).version;
    t.note(`Home Assistant ${version} (vrai serveur, entités de démonstration).`);

    // Quelques appareils rangés dans des pièces, comme dans une vraie maison.
    const areas = (await wsCalls(a, [{ type: 'config/area_registry/list' }]))[0].result as Array<{ area_id: string; name: string }>;
    const area = async (name: string) => areas.find((x) => x.name.toLowerCase() === name.toLowerCase())?.area_id ?? ((await wsCalls(a, [{ type: 'config/area_registry/create', name }]))[0].result as { area_id: string }).area_id;
    const salon = await area('Salon'), chambre = await area('Chambre'), cuisine = await area('Cuisine');
    const place = [['light.ceiling_lights', salon], ['cover.living_room_window', salon], ['light.bed_light', chambre], ['light.kitchen_lights', cuisine], ['cover.kitchen_window', cuisine]];
    const placed = await wsCalls(a, place.map(([entity_id, area_id]) => ({ type: 'config/entity_registry/update', entity_id, area_id })));
    t.ok(placed.every((r) => r.success), '(préparation) appareils rangés dans Salon, Chambre, Cuisine', placed.map((r, k) => (r.success ? '' : `${place[k][0]} : ${r.error?.message}`)).filter(Boolean).join(' ; '));

    const had = process.env.HA_TOKEN; process.env.HA_TOKEN = a.token;
    t.onEnd(() => { if (had === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = had; });
    const voix = bragi(() => DEFAULT_CONFIG.voice);
    const { v } = t.valhalla([midgard, voix, aegir]);
    const act = (m: string, x: string, i: Record<string, unknown> = {}, o = {}) => v.act(m, x, i, o);

    const link = await act('midgard', 'pont', { adresse: a.url });
    t.ok(link.ok, 'box reliée à Midgard (adresse ; le jeton reste dans le coffre)', link.text);
    t.ok(!JSON.stringify(v.ctx('midgard').settings).includes(a.token), 'le jeton n\'est pas écrit dans les réglages');
    for (const id of ['bragi', 'aegir']) v.ctx(id).saveSettings({ haUrl: a.url });

    const house = (await act('midgard', 'maison')).text;
    t.ok(/^Salon : .*Ceiling Lights/m.test(house) && /^Chambre : .*Bed Light/m.test(house) && /^Cuisine : /m.test(house), 'état de la maison rangé par pièce (les pièces viennent de la box)', house.slice(0, 400));
    const view = await midgard.view(v.ctx('midgard'), new URLSearchParams());
    t.ok(['Salon', 'Chambre', 'Cuisine'].every((r) => view.tabs?.includes(r)) && view.sections.some((x) => x.kind === 'table' && x.title === 'Salon' && x.rows.some((r) => r.cells[0] === 'Ceiling Lights')), 'la page Midgard a un tableau par pièce');

    // Lumière : on, off, intensité.
    t.eq((await state('light.bed_light')).state, 'off', '(avant) la lampe de chevet est éteinte');
    await act('midgard', 'commander', { appareil: 'ha:light.bed_light', valeur: 'allume' });
    t.ok(await until(async () => (await state('light.bed_light')).state === 'on', 5000), '« allume » : la lampe s\'allume vraiment dans Home Assistant');
    await act('midgard', 'commander', { appareil: 'ha:light.bed_light', valeur: '40 %' });
    t.ok(await until(async () => Math.abs(Number((await state('light.bed_light')).attributes.brightness) - 102) <= 2, 5000), '« 40 % » : intensité réglée (102 sur 255)', JSON.stringify((await state('light.bed_light')).attributes.brightness));
    await act('midgard', 'commander', { appareil: 'ha:light.bed_light', valeur: 'off' });
    t.ok(await until(async () => (await state('light.bed_light')).state === 'off', 5000), '« off » : elle s\'éteint');

    // Volet, clim.
    await act('midgard', 'commander', { appareil: 'ha:cover.kitchen_window', valeur: 'ouvre' });
    t.ok(await until(async () => ['opening', 'open'].includes((await state('cover.kitchen_window')).state), 8000), '« ouvre » : le volet de la cuisine s\'ouvre');
    await act('midgard', 'commander', { appareil: 'ha:climate.heatpump', valeur: '21' });
    t.ok(await until(async () => Number((await state('climate.heatpump')).attributes.temperature) === 21, 5000), '« 21 » : la consigne de la clim passe à 21 °C');

    // Serrure : ouvrir la maison demande toujours ton accord.
    const auto = await act('midgard', 'commander', { appareil: 'ha:lock.front_door', valeur: 'ouvre' }, { auto: true });
    t.ok(auto.ok === false && /accord/.test(auto.text) && (await state('lock.front_door')).state === 'locked', 'déverrouiller la porte est refusé à une automatisation (la porte reste fermée)', auto.text);
    await act('midgard', 'commander', { appareil: 'ha:lock.front_door', valeur: 'ouvre' });
    t.ok(await until(async () => ['unlocked', 'unlocking', 'open', 'opening'].includes((await state('lock.front_door')).state), 8000), 'avec ton accord, la porte se déverrouille');
    t.ok((await act('midgard', 'commander', { appareil: 'ha:lock.front_door', valeur: 'ferme' }, { auto: true })).ok, 'verrouiller reste possible sans accord (ça protège)');

    // Scène : plusieurs appareils d'un coup ; une scène qui ouvre la porte demande ton accord.
    await act('midgard', 'creer_scene', { nom: 'Bonne nuit', etapes: 'ha:light.ceiling_lights = off\nha:light.kitchen_lights = off\nha:lock.kitchen_door = ferme' });
    const night = await act('midgard', 'scene', { scene: 'bonne nuit' }, { auto: true });
    t.ok(night.ok && await until(async () => (await state('light.ceiling_lights')).state === 'off' && (await state('light.kitchen_lights')).state === 'off' && ['locked', 'locking'].includes((await state('lock.kitchen_door')).state), 8000), 'scène « Bonne nuit » : lumières éteintes et porte verrouillée, même depuis une automatisation', night.text);
    await act('midgard', 'creer_scene', { nom: 'Je rentre', etapes: 'ha:light.ceiling_lights = on\nha:lock.front_door = ouvre' });
    const home = await act('midgard', 'scene', { scene: 'Je rentre' }, { auto: true });
    t.ok(home.ok === false && /accord/.test(home.text), 'scène « Je rentre » (elle déverrouille) : refusée à une automatisation', home.text);

    // Voix : annonce sur l'enceinte du salon.
    const say = await act('bragi', 'annoncer', { message: 'Le dîner est prêt', ou: 'living room' });
    t.ok(say.ok && /Annoncé sur Living Room/.test(say.text), 'Bragi annonce un message sur l\'enceinte du salon', say.text);
    t.ok(await until(async () => /tts|demo/.test(String((await state('media_player.living_room')).attributes.media_content_id ?? '')), 6000), 'l\'enceinte joue bien la voix de synthèse', JSON.stringify((await state('media_player.living_room')).attributes.media_content_id));
    t.match((await act('bragi', 'annoncer', { message: 'x', ou: 'enceinte inconnue' })).text, /aucune enceinte/, 'enceinte inconnue : message clair');

    // Musique : une radio sur une enceinte.
    await act('aegir', 'radio', { nom: 'Radio du banc', adresse: 'http://127.0.0.1:9/radio.mp3' });
    const radio = await act('aegir', 'jouer', { quoi: 'Radio du banc', ou: 'bedroom' });
    t.ok(radio.ok && /Sur Bedroom/.test(radio.text), 'Ægir lance une radio sur l\'enceinte de la chambre', radio.text);
    t.ok(await until(async () => (await state('media_player.bedroom')).attributes.media_content_id === 'http://127.0.0.1:9/radio.mp3', 6000), 'l\'enceinte a reçu l\'adresse de la radio', JSON.stringify((await state('media_player.bedroom')).attributes));

    // Jeton refusé.
    process.env.HA_TOKEN = 'jeton.faux.du-banc';
    const bad = await act('midgard', 'commander', { appareil: 'ha:light.bed_light', valeur: 'on' });
    t.ok(bad.ok === false && /refuse le jeton/.test(bad.text), 'jeton refusé : message clair', bad.text);
    process.env.HA_TOKEN = a.token;
  },
};
