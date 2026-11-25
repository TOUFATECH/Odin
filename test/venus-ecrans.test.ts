// Vénus · Odéon natif — les écrans de la maison (Home Assistant) : découverte, envoi, et pilotage EN CONTINU
// (lecture/pause/seek/volume/suivant/précédent/chaîne/épisode/couper). FAUX Home Assistant, aucun appareil réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HaState } from '../src/tools/homeassistant.ts';
import { ACTIONS_ECRAN, choisirEcran, ecransDepuisHa, envoyerSurEcran, piloterEcran, planEnvoi, planPilotage, type HaCaller } from '../src/valhalla/venus/ecrans.ts';

const etat = (id: string, state: string, attrs: Record<string, unknown> = {}): HaState => ({ entity_id: id, state, attributes: attrs });

test('ecransDepuisHa : classe télé / enceinte / écran, ignore « unavailable »', () => {
  const ec = ecransDepuisHa([
    etat('media_player.tele_salon', 'playing', { friendly_name: 'Télé du salon', media_position: 42, media_duration: 100, volume_level: 0.3 }),
    etat('media_player.enceinte_cuisine', 'idle', { friendly_name: 'Enceinte cuisine' }),
    etat('media_player.vieux', 'unavailable', {}),
    etat('light.salon', 'on', {}),
  ]);
  assert.equal(ec.length, 2);
  assert.equal(ec[0].type, 'tv'); assert.equal(ec[0].enLecture, true); assert.equal(ec[0].position, 42);
  assert.equal(ec[1].type, 'enceinte');
});

test('choisirEcran : par nom, sinon la télé, sinon le seul', () => {
  const ec = ecransDepuisHa([etat('media_player.tv', 'idle', { friendly_name: 'Télé salon' }), etat('media_player.sp', 'idle', { friendly_name: 'Enceinte' })]);
  assert.equal(choisirEcran(ec, 'salon')?.id, 'media_player.tv');
  assert.equal(choisirEcran(ec, '')?.type, 'tv', 'la télé par défaut');
  assert.equal(choisirEcran([ec[1]], '')?.id, 'media_player.sp', 'le seul écran');
});

test('planEnvoi et planPilotage : chaque action → le bon service Home Assistant', () => {
  assert.deepEqual(planEnvoi('media_player.tv', 'http://odin/venus/flux/x'), { path: '/services/media_player/play_media', data: { entity_id: 'media_player.tv', media_content_id: 'http://odin/venus/flux/x', media_content_type: 'video' } });
  const e = 'media_player.tv';
  assert.match((planPilotage('lecture', e) as { path: string }).path, /media_play$/);
  assert.match((planPilotage('pause', e) as { path: string }).path, /media_pause$/);
  assert.match((planPilotage('suivant', e) as { path: string }).path, /media_next_track$/);
  assert.match((planPilotage('precedent', e) as { path: string }).path, /media_previous_track$/);
  assert.match((planPilotage('couper', e) as { path: string }).path, /media_stop$/);
  assert.deepEqual((planPilotage('volume', e, 70) as { data: Record<string, unknown> }).data, { entity_id: e, volume_level: 0.7 });
  // Avancer : position relative à partir de l'état.
  const av = planPilotage('avancer', e, 30, { position: 100, duree: 500 }) as unknown as { data: { seek_position: number } };
  assert.equal(av.data.seek_position, 130);
  const rec = planPilotage('reculer', e, 30, { position: 10 }) as unknown as { data: { seek_position: number } };
  assert.equal(rec.data.seek_position, 0, 'borné à 0');
  assert.ok('erreur' in planPilotage('chaine', e, ''), 'chaîne sans URL refusée');
  assert.ok(ACTIONS_ECRAN.length === 11); // dont « basculer » (Lecture / pause de la télécommande de Vénus)
});

test('volume relatif (+/-), revoir, chaîne par numéro, épisode refusé (phase 2)', () => {
  const e = 'media_player.tv';
  // Volume relatif : part de l'état et ajoute/retranche le pas (5 % par défaut).
  const vol = (v: string | number, etat?: { volume?: number }) => (planPilotage('volume', e, v, etat) as unknown as { data: { volume_level: number } }).data.volume_level;
  assert.ok(Math.abs(vol('+', { volume: 0.4 }) - 0.45) < 1e-9, '+5 %');
  assert.ok(Math.abs(vol('-', { volume: 0.4 }) - 0.35) < 1e-9, '-5 %');
  assert.equal(vol('+10', { volume: 0.95 }), 1, 'borné à 1');
  assert.equal(vol(30), 0.3, 'absolu toujours accepté');
  // « Revoir » = reculer d'un grand saut → début.
  assert.equal((planPilotage('reculer', e, 999999, { position: 120 }) as unknown as { data: { seek_position: number } }).data.seek_position, 0);
  // Chaîne par numéro → play_media (channel) ; chaîne +/- refusée ; épisode par numéro refusé (phase 2).
  const ch = planPilotage('chaine', e, '7') as { path: string; data: Record<string, unknown> };
  assert.match(ch.path, /play_media$/); assert.equal(ch.data.media_content_id, '7'); assert.equal(ch.data.media_content_type, 'channel');
  assert.ok('erreur' in planPilotage('chaine', e, '+'), 'chaîne pas à pas refusée (phase 2)');
  assert.ok('erreur' in planPilotage('episode', e, '5'), 'épisode par numéro refusé (phase 2)');
});

test('piloter : le volume relatif relit le volume de l\'écran', async () => {
  const appels: Array<{ method: string; path: string; body?: unknown }> = [];
  const ha: HaCaller = async (method, path, body) => { appels.push({ method, path, body }); return method === 'GET' ? [etat('media_player.tv', 'playing', { volume_level: 0.5 })] as HaState[] : null; };
  await piloterEcran(ha, 'media_player.tv', 'volume', '+');
  const set = appels.find((a) => a.path.endsWith('/volume_set'))!;
  assert.ok(Math.abs((set.body as { volume_level: number }).volume_level - 0.55) < 1e-9, '0,5 + 5 % relu de l\'état');
});

test('envoyer + piloter : les appels partent au faux Home Assistant ; avancer relit la position', async () => {
  const appels: Array<{ method: string; path: string; body?: unknown }> = [];
  const ha: HaCaller = async (method, path, body) => { appels.push({ method, path, body }); return method === 'GET' ? [etat('media_player.tv', 'playing', { friendly_name: 'Télé salon', media_position: 50 })] as HaState[] : null; };
  const ec = await envoyerSurEcran(ha, 'salon', 'http://odin/venus/flux/x');
  assert.equal(ec.id, 'media_player.tv');
  assert.ok(appels.some((a) => a.method === 'POST' && a.path.endsWith('/play_media')));
  await piloterEcran(ha, 'media_player.tv', 'avancer', 30);
  const seek = appels.find((a) => a.path.endsWith('/media_seek'))!;
  assert.equal((seek.body as { seek_position: number }).seek_position, 80, '50 + 30 depuis l\'état relu');
});
