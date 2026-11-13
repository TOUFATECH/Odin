// La voix d'Odin, fonction par fonction : voix d'homme ou de femme, voix fabriquée sur la machine (Piper), ElevenLabs
// avec la clé du propriétaire, copie de sa voix avec l'accord noté, réponses en audio (Telegram, web), réponse de
// Pythie en audio, et ce qui doit rester secret.
//
// Pour de vrai ici : le serveur web d'Odin, ses réglages et ses fichiers, ffmpeg et ffprobe (conversion en note vocale,
// lecture des sons), et Piper lui-même quand il est dans le dossier du banc (`npm run banc:outils`, ou BANC_VOIX).
// Avec un faux : ElevenLabs (service payant) et Telegram (faux serveurs qui parlent le même protocole et vérifient
// ce qu'Odin envoie), et Piper quand il n'est pas installé (faux programme, faux serveur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gateway, voiceGenderCommand } from '../src/bifrost/gateway.ts';
import { TelegramChannel } from '../src/bifrost/channels/telegram.ts';
import { DEFAULT_CONFIG, type OdinConfig } from '../src/config.ts';
import { isSecretFile, toolPath } from '../src/heimdall/policy.ts';
import { voiceFor } from '../src/profiles.ts';
import { voiceSet } from '../src/tools/assistant.ts';
import { startValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { bragi } from '../src/valhalla/modules/bragi.ts';
import { volva } from '../src/valhalla/modules/volva.ts';
import { accords, accordsFile, phraseAccord } from '../src/voice/accords.ts';
import { audioKind, cloneBlocked, cloneVoice, forSpeech, hear, listVoices, removeVoice, scrub, speakAudio, toVoiceNote, ttsIsLocal, ttsReady, TTS_DEFAULTS } from '../src/voice/voice.ts';
import { freePort, T, until } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { telegramSim } from './banc/sim/telegram.ts';
import { elevenSim, FFMPEG, FFPROBE, maisonVoix, PETIT_MP3, PETIT_OGG, piperSim, sonde, volume, vraiPiper, vraiServeurPiper, wav, wavRate, wavSeconds, type MaisonVoix } from './banc/sim/voix.ts';
import { makeOdin } from './helpers.ts';

const PHRASE = 'Bonjour, je suis Odin. Voici ma voix, fabriquée sur la machine.';
const PIPER = vraiPiper() ? 'vrai Piper' : 'faux Piper';
type Voice = OdinConfig['voice'];
const base = (): Voice => structuredClone(DEFAULT_CONFIG.voice);
/** Garde des variables d'environnement et les remet à la fin de l'essai. */
function garde(t: T, ...names: string[]): void {
  const saved = names.map((n) => [n, process.env[n]] as const);
  t.onEnd(() => { for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; } });
}
/** La voix locale est installée (vrai Piper du banc, sinon le faux programme) : ODIN_HOME pointe dessus pour cet essai. */
function avecPiper(t: T): MaisonVoix { garde(t, 'ODIN_HOME'); const m = maisonVoix(); t.onEnd(m.end); process.env.ODIN_HOME = m.home; return m; }
/** Aucune voix locale sur la machine pour cet essai (ODIN_HOME pointe sur un dossier vide). */
function sansPiper(t: T): string { garde(t, 'ODIN_HOME'); const d = t.tmp('odin-voix-vide-'); process.env.ODIN_HOME = d; return d; }
/** Tous les fichiers d'un dossier (récursif). */
function fichiers(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(dir, e.name)) : [join(dir, e.name)])); }
/** Les fichiers du dossier qui contiennent ces octets. */
const contenant = (dir: string, needle: Buffer | string) => fichiers(dir).filter((f) => { try { return readFileSync(f).includes(needle); } catch { return false; } });
const femme = (m: MaisonVoix) => /fr_FR-siwis-medium\.onnx/.test(m.appels().at(-1) ?? ''), homme = (m: MaisonVoix) => /fr_FR-tom-medium\.onnx/.test(m.appels().at(-1) ?? '');
/** Un vrai son lisible : format attendu, durée, et pas du silence (quand ffprobe et ffmpeg sont là). */
function lisible(data: Uint8Array, format: RegExp, what: string): void {
  assert.ok(data.byteLength > 100, `${what} : pas vide`);
  const s = sonde(data); if (!s) return; // ffprobe absent : les octets d'en-tête ont déjà été vérifiés par audioKind
  assert.match(s.format, format, `${what} : format lu par ffprobe`); assert.ok(s.duree > 0.2, `${what} : durée ${s.duree} s`); assert.equal(s.canaux, 1, `${what} : un canal`);
  const vol = volume(data); if (vol !== undefined) assert.ok(vol > -60, `${what} : on entend quelque chose (${vol} dB)`);
}
/** Demandes à l'interface web avec la session du propriétaire. */
function web(v: VraiOdin) {
  const h = { 'x-odin': '1', cookie: v.session };
  return {
    speak: async (body: Record<string, unknown>) => { const r = await fetch(`${v.url}/api/voice/speak`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const type = r.headers.get('content-type') ?? '', data = new Uint8Array(await r.arrayBuffer()); return { type, data, error: /json/.test(type) ? String((JSON.parse(Buffer.from(data).toString('utf8')) as { error?: string }).error ?? '') : '' }; },
    save: async (section: string, body: Record<string, unknown>) => (await v.json('/api/action', { kind: 'settings_save', section, ...body })).body as { ok: boolean; error?: string; reloading?: boolean; restartNeeded?: boolean },
    clone: async (q: Record<string, string>, sample: Uint8Array, type = 'audio/webm') => await (await fetch(`${v.url}/api/voice/clone?${new URLSearchParams(q)}`, { method: 'POST', headers: { ...h, 'content-type': type }, body: sample })).json() as { ok: boolean; error?: string; voiceId?: string; verify?: boolean; text?: string },
    copies: async () => ((await v.json('/api/voice/copies')).body as { copies: Array<{ id: string; nom: string; de: string; personne: string; phrase: string; aVerifier: boolean; retire: string; effacee: boolean; actuelle: boolean }> }).copies,
    retirer: async (id: string) => (await v.json('/api/voice/retirer', { id })).body as { ok: boolean; error?: string; text?: string },
    /** Les réglages que la page envoie avec « Enregistrer » (Services de la voix). */
    services: (o: Record<string, unknown>) => ({ gender: 'homme', femaleVoiceId: '', enabled: true, ttsProvider: 'piper', ttsUrl: 'local', elevenKey: '', voiceId: 'fr_FR-tom-medium', voiceName: '', sttUrl: 'https://api.openai.com/v1', sttKey: '', language: 'fr', speakReplies: true, voiceReplies: true, ...o }),
  };
}

// ------------------------------------------------------------------ a. Voix d'homme ou de femme

test(`voix d'homme ou de femme : le choix de Réglages → Voix se garde et sert dès la phrase suivante, sans relancer Odin (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt), v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    // Au départ : voix d'homme.
    const a = await w.speak({ text: PHRASE });
    assert.equal(a.type, 'audio/wav'); assert.ok(homme(m), 'voix d\'homme par défaut'); lisible(a.data, /wav/, 'voix d\'homme');
    // « Écouter » la voix de femme avant de choisir : l'essai ne change pas le réglage.
    const essai = await w.speak({ text: PHRASE, gender: 'femme' });
    assert.ok(femme(m), 'l\'essai parle avec la voix de femme'); lisible(essai.data, /wav/, 'voix de femme');
    assert.equal(v.o.cfg.voice.gender, 'homme', 'écouter un essai ne change rien');
    await w.speak({ text: PHRASE }); assert.ok(homme(m));
    // Choisir « femme » et enregistrer : pris en compte tout de suite, écrit dans la configuration, sans redémarrage.
    const r = await w.save('voice', w.services({ gender: 'femme' }));
    assert.deepEqual({ ok: r.ok, reloading: r.reloading, restartNeeded: r.restartNeeded }, { ok: true, reloading: false, restartNeeded: false });
    assert.equal(v.o.cfg.voice.gender, 'femme');
    assert.equal((JSON.parse(readFileSync(v.o.paths.config, 'utf8')) as { voice: { gender: string } }).voice.gender, 'femme', 'le choix est gardé sur le disque');
    await w.speak({ text: PHRASE }); assert.ok(femme(m), 'la phrase suivante est dite avec la voix de femme');
    const etat = (await v.json('/api/state')).body as { settings: { voice: { gender: string } } };
    assert.equal(etat.settings.voice.gender, 'femme', 'la page le retrouve coché en se rechargeant');
    // À la demande, avec une IA (outil voice_set) : même réglage, tout de suite.
    await voiceSet.run({ genre: 'homme' }, { paths: v.o.paths, careCfg: v.o.cfg } as never);
    await w.speak({ text: PHRASE }); assert.ok(homme(m), '« reprends ta voix d\'homme »');
    // … et sans IA : la phrase seule suffit, dans la discussion.
    await v.json('/api/message', { text: 'Parle avec une voix de femme.', peer: 'principal' });
    assert.ok(await until(() => v.o.cfg.voice.gender === 'femme', 5000), 'compris sans IA');
    assert.equal(v.o.provider.calls.length, 0, 'aucune IA appelée pour ça');
    await w.speak({ text: PHRASE }); assert.ok(femme(m));
  } finally { await tt.end(); }
});

test('voix d\'homme ou de femme : la phrase seule est comprise, pas une vraie demande qui contient ces mots', () => {
  for (const [p, g] of [['Parle avec une voix de femme.', 'femme'], ['reprends ta voix d\'homme', 'homme'], ['prends une voix d’homme', 'homme'], ['Odin, voix de femme', 'femme'], ['je veux une voix d\'homme', 'homme'], ['passe à la voix de femme maintenant', 'femme']] as const) assert.equal(voiceGenderCommand(p), g, p);
  for (const p of ['mets une voix de femme sur la vidéo', 'parle-moi de la voix de femme', 'quelle voix de femme as-tu ?', 'la voix de l\'homme est grave', 'parle-moi']) assert.equal(voiceGenderCommand(p), undefined, p);
  // Chaque service a sa voix d'homme et sa voix de femme ; une voix de femme précise passe devant.
  const el = { ...base(), tts: { ...base().tts, provider: 'elevenlabs' as const, voiceId: '' } };
  assert.equal(voiceFor({ ...el, gender: 'homme' }, DEFAULT_CONFIG).tts.voiceId, 'onwK4e9ZLuTAKqWW03F9');
  assert.equal(voiceFor({ ...el, gender: 'femme' }, DEFAULT_CONFIG).tts.voiceId, 'XB0fDUnXU5powFXDhCwa');
  assert.equal(voiceFor({ ...el, gender: 'femme', femaleVoiceId: 'MaVoixDeFemme' }, DEFAULT_CONFIG).tts.voiceId, 'MaVoixDeFemme');
  assert.equal(voiceFor({ ...base(), gender: 'femme' }, DEFAULT_CONFIG).tts.voiceId, 'fr_FR-siwis-medium', 'Piper : siwis');
});

// ------------------------------------------------------------------ b. Voix fabriquée sur la machine, sans clé (Piper)

test(`Piper sur la machine : un vrai fichier son, sans clé, vitesse réglable, prêt pour une note vocale (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt), v = base();
    assert.equal(ttsReady(v, {}), true, 'prêt sans aucune clé'); assert.equal(ttsIsLocal(v), true);
    const a = await speakAudio(PHRASE, v, 'mp3_44100_128', undefined, {});
    assert.equal(a.mime, 'audio/wav'); assert.equal(audioKind(a.data), 'wav'); lisible(a.data, /wav/, 'voix locale');
    assert.ok(wavSeconds(a.data) > 1, `une phrase entière (${wavSeconds(a.data).toFixed(1)} s)`);
    assert.doesNotMatch(m.appels().at(-1)!, /--length_scale/, 'vitesse normale : rien de spécial');
    // Plus vite : Piper reçoit une durée de phonème plus courte.
    const vite = await speakAudio(PHRASE, { ...v, speech: { ...v.speech, rate: 1.25 } }, 'mp3_44100_128', undefined, {});
    assert.match(m.appels().at(-1)!, /--length_scale 0\.80/);
    if (!m.vrai) assert.ok(wavSeconds(vite.data) < wavSeconds(a.data), 'le son est plus court');
    // Pour Telegram : converti en Ogg/Opus par ffmpeg (le vrai), un seul canal.
    if (FFMPEG) { const note = await toVoiceNote(a); assert.equal(audioKind(note), 'ogg'); lisible(note, /ogg/, 'note vocale'); if (FFPROBE) assert.equal(sonde(note)!.codec, 'opus'); }
    // Le Piper de la machine prend aussi le relais d'un service en ligne qui n'est pas prêt (pas de clé).
    const sansCle = { ...v, localOnly: false, tts: { ...v.tts, provider: 'elevenlabs' as const, voiceId: 'x', baseUrl: 'http://127.0.0.1:9', apiKeyEnv: 'CLE_ABSENTE' } };
    assert.equal((await speakAudio('Bonjour.', sansCle, 'mp3_44100_128', undefined, {})).mime, 'audio/wav');
  } finally { await tt.end(); }
});

test('Piper pas installé : Odin le dit clairement, et pendant les essais il n\'installe rien tout seul', async () => {
  const tt = new T();
  try {
    const vide = sansPiper(tt), v = base();
    assert.equal(ttsReady(v, {}), false);
    const t0 = Date.now();
    await assert.rejects(speakAudio(PHRASE, v, 'mp3_44100_128', undefined, {}), /voix locale/);
    await assert.rejects(hear(new Uint8Array([1, 2, 3]), 'audio/ogg', v, undefined, {}), /installation automatique de la voix locale est coupée/);
    assert.ok(Date.now() - t0 < 5000, 'réponse immédiate (pas de compilation lancée)');
    assert.deepEqual(readdirSync(vide), [], 'rien n\'a été téléchargé ni compilé dans le dossier d\'Odin');
  } finally { await tt.end(); }
});

test('serveur Piper lancé à part : la version actuelle (POST /synthesize) et l\'ancienne (texte brut) sont comprises (faux serveurs)', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const cur = await piperSim('actuel'); tt.onEnd(() => cur.close());
    const v: Voice = { ...base(), localOnly: false, tts: { provider: 'piper', voiceId: 'fr_FR-tom-medium', voiceName: '', model: '', baseUrl: cur.url, apiKeyEnv: '' } };
    assert.equal(ttsReady(v, {}), true); assert.equal(ttsIsLocal(v), true, 'une adresse de cette machine : rien ne sort');
    const a = await speakAudio('Bonjour **toi**', voiceFor(v, DEFAULT_CONFIG), 'mp3_44100_128', undefined, {});
    assert.equal(a.mime, 'audio/wav', 'reconnu comme un WAV alors que le serveur l\'annonce comme une page'); lisible(a.data, /wav/, 'serveur Piper');
    assert.deepEqual(cur.hits.map((h) => `${h.method} ${h.path}`), ['POST /synthesize'], 'la bonne adresse du premier coup');
    assert.deepEqual(cur.said[0], { text: 'Bonjour toi', voice: 'fr_FR-tom-medium', length_scale: undefined });
    // Voix de femme et vitesse : demandées au serveur.
    const f = await speakAudio('Bonjour', voiceFor({ ...v, gender: 'femme', speech: { ...v.speech, rate: 0.8 } }, DEFAULT_CONFIG), 'mp3_44100_128', undefined, {});
    assert.deepEqual(cur.said[1], { text: 'Bonjour', voice: 'fr_FR-siwis-medium', length_scale: 1.25 });
    assert.notEqual(wavRate(f.data), wavRate(a.data), 'ce n\'est pas la même voix');
    // Ancien serveur (2023) : il ne connaît pas /synthesize et veut le texte tel quel, pas du JSON.
    const old = await piperSim('ancien'); tt.onEnd(() => old.close());
    const b = await speakAudio('Salut à toi', { ...v, tts: { ...v.tts, baseUrl: old.url } }, 'mp3_44100_128', undefined, {});
    assert.equal(b.mime, 'audio/wav'); assert.deepEqual(old.hits.map((h) => `${h.method} ${h.path}`), ['POST /synthesize', 'POST /']);
    assert.deepEqual(old.said, [{ text: 'Salut à toi' }], 'le texte seul est dit (pas « text : … »)');
    // Une adresse qui rend une page web à la place du son : c'est dit, rien n'est joué.
    const page = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!DOCTYPE html><html><body>Bienvenue</body></html>'); });
    await new Promise<void>((r) => page.listen(0, '127.0.0.1', r)); tt.onEnd(() => new Promise((r) => page.close(r)));
    await assert.rejects(speakAudio('Salut', { ...v, tts: { ...v.tts, baseUrl: `http://127.0.0.1:${(page.address() as AddressInfo).port}` } }, 'mp3_44100_128', undefined, {}), /n'a pas renvoyé de son.*page web/);
    // Serveur arrêté : phrase claire, avec quoi faire.
    const dead = `http://127.0.0.1:${await freePort()}`;
    await assert.rejects(speakAudio('Salut', { ...v, tts: { ...v.tts, baseUrl: dead } }, 'mp3_44100_128', undefined, {}), /le serveur Piper ne répond pas.*« local »/);
    // … et si le Piper d'Odin est installé sur la machine, c'est lui qui parle à la place.
    const m = avecPiper(tt);
    assert.equal((await speakAudio('Salut', { ...v, gender: 'femme', tts: { ...v.tts, baseUrl: dead } }, 'mp3_44100_128', undefined, {})).mime, 'audio/wav'); assert.ok(femme(m));
  } finally { await tt.end(); }
});

test('serveur Piper lancé à part : le vrai (piper-tts[http]), voix d\'homme puis de femme', { skip: vraiServeurPiper() ? false : 'le vrai serveur Piper n\'est pas dans le dossier du banc (npm run banc:outils)' }, async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const port = await freePort(), dir = join(vraiPiper()!, 'piper-voices');
    const p: ChildProcess & { log: () => string } = tt.spawn(vraiServeurPiper()!, ['-m', 'piper.http_server', '-m', 'fr_FR-tom-medium', '--data-dir', dir, '--host', '127.0.0.1', '--port', String(port)]);
    assert.ok(await until(async () => (await fetch(`http://127.0.0.1:${port}/voices`)).ok, 60_000, 400), `le serveur Piper démarre (${p.log().slice(-300)})`);
    const v: Voice = { ...base(), localOnly: false, tts: { provider: 'piper', voiceId: 'fr_FR-tom-medium', voiceName: '', model: '', baseUrl: `http://127.0.0.1:${port}`, apiKeyEnv: '' } };
    const h = await speakAudio(PHRASE, voiceFor(v, DEFAULT_CONFIG), 'mp3_44100_128', undefined, {});
    assert.equal(h.mime, 'audio/wav'); lisible(h.data, /wav/, 'vrai serveur, voix d\'homme');
    const f = await speakAudio(PHRASE, voiceFor({ ...v, gender: 'femme' }, DEFAULT_CONFIG), 'mp3_44100_128', undefined, {});
    lisible(f.data, /wav/, 'vrai serveur, voix de femme');
    assert.match(p.log(), /POST \/synthesize HTTP\/1\.1" 200/); assert.doesNotMatch(p.log(), /"(GET|POST) \/ HTTP/, 'jamais la page d\'accueil prise pour du son');
    assert.doesNotMatch(p.log(), /Voice not found/, 'les deux voix demandées existent sur le serveur');
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ c. ElevenLabs avec la clé du propriétaire

test('ElevenLabs : adresse, clé dans l\'en-tête, voix choisie, texte et modèle vérifiés par un faux serveur ; un vrai son revient', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const el = await elevenSim(); tt.onEnd(() => el.close());
    const env = { MA_CLE: el.key };
    const v: Voice = { ...base(), localOnly: false, tts: { provider: 'elevenlabs', voiceId: '', voiceName: '', model: TTS_DEFAULTS.elevenlabs.model, baseUrl: el.url, apiKeyEnv: 'MA_CLE' } };
    assert.equal(TTS_DEFAULTS.elevenlabs.baseUrl, 'https://api.elevenlabs.io'); assert.equal(TTS_DEFAULTS.elevenlabs.model, 'eleven_multilingual_v2');
    // Voix d'homme par défaut (Daniel), pour le navigateur : MP3.
    const a = await speakAudio('**Voilà** : `npm test` passe. Détails sur https://exemple.fr', voiceFor(v, DEFAULT_CONFIG), 'mp3_44100_128', undefined, env);
    assert.equal(a.mime, 'audio/mpeg'); assert.deepEqual(Buffer.from(a.data), PETIT_MP3); lisible(a.data, /mp3/, 'MP3 d\'ElevenLabs');
    const h = el.hits[0];
    assert.equal(`${h.method} ${h.path}?${h.query}`, 'POST /v1/text-to-speech/onwK4e9ZLuTAKqWW03F9?output_format=mp3_44100_128');
    assert.equal(h.headers['xi-api-key'], el.key, 'la clé part dans l\'en-tête xi-api-key'); assert.doesNotMatch(`${h.path}?${h.query}`, new RegExp(el.key), 'jamais dans l\'adresse');
    assert.deepEqual(h.json, { text: 'Voilà : npm test passe. Détails sur le lien affiché', model_id: 'eleven_multilingual_v2' });
    // Voix de femme (Charlotte), pour une note vocale : Opus, reconnu à ses octets (le service n'annonce pas son type).
    const b = await speakAudio('Bonjour', voiceFor({ ...v, gender: 'femme' }, DEFAULT_CONFIG), 'opus_48000_64', undefined, env);
    assert.deepEqual(el.said[1], { voice: 'XB0fDUnXU5powFXDhCwa', text: 'Bonjour', model: 'eleven_multilingual_v2', format: 'opus_48000_64' });
    assert.equal(b.mime, 'audio/ogg'); lisible(b.data, /ogg/, 'Opus d\'ElevenLabs'); assert.deepEqual(Buffer.from(await toVoiceNote(b)), PETIT_OGG, 'déjà une note vocale : envoyée telle quelle');
    // Une voix précise (celle du propriétaire) : c'est elle qui est demandée.
    el.voices.push({ voice_id: 'MaVoix123', name: 'Ma voix', category: 'cloned' });
    await speakAudio('Bonjour', voiceFor({ ...v, tts: { ...v.tts, voiceId: 'MaVoix123' } }, DEFAULT_CONFIG), 'mp3_44100_128', undefined, env);
    assert.equal(el.said[2].voice, 'MaVoix123');
    // Pas de clé : pas prêt. « 100 % local » : ElevenLabs n'est jamais appelé, même avec la clé.
    assert.equal(ttsReady(v, {}), false); assert.equal(ttsReady(voiceFor(v, DEFAULT_CONFIG), env), true);
    const n = el.hits.length;
    assert.equal(ttsReady({ ...voiceFor(v, DEFAULT_CONFIG), localOnly: true }, env), false);
    await assert.rejects(speakAudio('Bonjour', { ...voiceFor(v, DEFAULT_CONFIG), localOnly: true }, 'mp3_44100_128', undefined, env), /voix locale/);
    assert.equal(el.hits.length, n, 'rien n\'est parti en ligne');
  } finally { await tt.end(); }
});

test('ElevenLabs : la liste des voix vient de /v2/voices, page après page (et de /v1/voices sur un ancien serveur)', async () => {
  const tt = new T();
  try {
    const el = await elevenSim({ pageMax: 2 }); tt.onEnd(() => el.close());
    el.voices.push({ voice_id: 'v3', name: 'Sarah', category: 'premade' }, { voice_id: 'MaVoix123', name: 'Ma voix', category: 'cloned' }, { voice_id: 'v5', name: 'Lily', category: 'premade' });
    const v: Voice = { ...base(), localOnly: false, tts: { provider: 'elevenlabs', voiceId: '', voiceName: '', model: '', baseUrl: el.url, apiKeyEnv: 'MA_CLE' } };
    const list = await listVoices(v, { MA_CLE: el.key });
    assert.deepEqual(list.map((x) => x.name), ['Ma voix', 'Daniel', 'Charlotte', 'Sarah', 'Lily'], 'les cinq voix, la voix copiée en premier');
    assert.deepEqual(el.hits.map((h) => `${h.path}?${h.query}`), ['/v2/voices?page_size=100&include_total_count=false', '/v2/voices?page_size=100&include_total_count=false&next_page_token=2', '/v2/voices?page_size=100&include_total_count=false&next_page_token=4']);
    assert.ok(el.hits.every((h) => h.headers['xi-api-key'] === el.key));
    const old = await elevenSim({ ancien: true }); tt.onEnd(() => old.close());
    assert.deepEqual((await listVoices({ ...v, tts: { ...v.tts, baseUrl: old.url } }, { MA_CLE: old.key })).map((x) => x.name), ['Daniel', 'Charlotte']);
    assert.deepEqual(old.hits.map((h) => h.path), ['/v2/voices', '/v1/voices']);
    await assert.rejects(listVoices(v, { MA_CLE: 'mauvaise-cle-0000' }), /la clé est refusée/);
  } finally { await tt.end(); }
});

test('ElevenLabs : la clé n\'apparaît jamais (message d\'erreur, journal), même si le service la répète', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const cle = 'sk_cle_tres_secrete_du_proprietaire_42';
    const el = await elevenSim({ key: cle, panne: { status: 500, echo: true } }); tt.onEnd(() => el.close());
    const v: Voice = { ...base(), localOnly: false, tts: { provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', voiceName: '', model: '', baseUrl: el.url, apiKeyEnv: 'MA_CLE' } }, env = { MA_CLE: cle };
    const lu: string[] = [], err = console.error, log = console.log;
    console.error = (...a: unknown[]) => { lu.push(a.join(' ')); }; console.log = (...a: unknown[]) => { lu.push(a.join(' ')); };
    const messages: string[] = [];
    try {
      for (const f of [() => speakAudio('Bonjour', v, 'mp3_44100_128', undefined, env), () => listVoices(v, env), () => cloneVoice('Ma voix', [{ data: new Uint8Array([1, 2, 3]), mime: 'audio/webm', filename: 'moi.webm' }], true, v, env), () => removeVoice('MaVoix123', v, env)]) {
        await f().then(() => assert.fail('le service est en panne'), (e: Error) => { messages.push(e.message); });
      }
    } finally { console.error = err; console.log = log; }
    assert.equal(messages.length, 4);
    for (const m of messages) { assert.doesNotMatch(m, new RegExp(cle), 'la clé n\'est pas dans le message'); assert.match(m, /le service est en panne \(HTTP 500\).*\[clé masquée\]/, m); }
    assert.ok(!lu.join('\n').includes(cle), 'ni dans le journal');
    assert.ok(el.hits.every((h) => h.headers['xi-api-key'] === cle), 'elle n\'est partie que dans l\'en-tête, vers le service');
    assert.equal(scrub(`a ${cle} b ${cle}`, cle), 'a [clé masquée] b [clé masquée]'); assert.equal(scrub('rien à cacher', ''), 'rien à cacher');
    // Clé refusée, voix disparue : la raison est dite simplement.
    const ok = await elevenSim({ key: cle }); tt.onEnd(() => ok.close());
    const w = { ...v, tts: { ...v.tts, baseUrl: ok.url } };
    await assert.rejects(speakAudio('Bonjour', w, 'mp3_44100_128', undefined, { MA_CLE: 'pas-la-bonne-cle' }), /Synthèse vocale impossible : la clé est refusée \(vérifie-la dans Réglages → Voix\) \(HTTP 401\) — Invalid API key/);
    await assert.rejects(speakAudio('Bonjour', { ...w, tts: { ...w.tts, voiceId: 'VoixPartie' } }, 'mp3_44100_128', undefined, env), /la voix ou l'adresse n'existe pas \(HTTP 404\)/);
  } finally { await tt.end(); }
});

test('ElevenLabs par la page : la clé enregistrée dans Réglages → Voix reste dans le coffre local, et le navigateur reçoit un vrai MP3', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const cle = 'sk_cle_du_proprietaire_pour_la_page_7788';
    const el = await elevenSim({ key: cle }); tt.onEnd(() => el.close());
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    // Tant que « 100 % local » est coché, un service en ligne reste éteint : on le décoche, puis on règle ElevenLabs.
    assert.equal((await w.save('voice_options', { localOnly: false })).ok, true);
    // En passant de Piper à ElevenLabs, la page renvoyait le nom de la voix Piper : il n'existe pas chez ElevenLabs,
    // Odin repart donc de la voix prête à l'emploi (sinon : « voix introuvable » à la première phrase).
    let r = await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, elevenKey: cle, voiceId: 'fr_FR-tom-medium', voiceName: 'fr_FR-tom-medium', gender: 'homme' }));
    assert.equal(r.ok, true, r.error); assert.equal(v.o.cfg.voice.tts.voiceId, '', 'la voix de l\'ancien service n\'est pas gardée');
    assert.equal((await w.speak({ text: 'Bonjour.' })).type, 'audio/mpeg'); assert.equal(el.said.at(-1)!.voice, 'onwK4e9ZLuTAKqWW03F9', 'une clé suffit : la voix d\'homme prête à l\'emploi parle');
    r = await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '', gender: 'femme' }));
    assert.deepEqual({ ok: r.ok, reloading: r.reloading, restartNeeded: r.restartNeeded }, { ok: true, reloading: false, restartNeeded: false });
    const a = await w.speak({ text: 'Bonjour, je parle avec ElevenLabs.' });
    assert.equal(a.type, 'audio/mpeg'); assert.deepEqual(Buffer.from(a.data), PETIT_MP3); lisible(a.data, /mp3/, 'son reçu par le navigateur');
    assert.deepEqual(el.said.at(-1), { voice: 'XB0fDUnXU5powFXDhCwa', text: 'Bonjour, je parle avec ElevenLabs.', model: 'eleven_multilingual_v2', format: 'mp3_44100_128' });
    // La clé : dans le fichier des secrets (lisible par le propriétaire seulement), et nulle part ailleurs.
    const ou = contenant(v.o.paths.home, cle).map((f) => f.slice(v.o.paths.home.length + 1));
    assert.deepEqual(ou, ['env']); assert.equal(statSync(join(v.o.paths.home, 'env')).mode & 0o777, 0o600);
    assert.ok(isSecretFile('/home/x/.odin/env'), 'ce fichier est fermé aux outils de fichiers');
    const etat = JSON.stringify((await v.json('/api/state')).body);
    assert.ok(!etat.includes(cle), 'la page ne reçoit jamais la clé'); assert.match(etat, /"ELEVENLABS_API_KEY":\{"set":true,"hint":"…7788"\}/, 'seulement « enregistrée » et ses 4 derniers caractères');
    assert.equal(v.o.redactor.redact(`ma clé est ${cle}`).includes(cle), false, 'masquée dans tout ce qu\'Odin écrit ou dit');
    // Une erreur du service arrive à la page en clair, sans la clé.
    const essai = await w.speak({ text: 'Bonjour', gender: 'homme' }); assert.equal(essai.type, 'audio/mpeg');
    el.voices.length = 0;
    const e = await w.speak({ text: 'Bonjour' });
    assert.match(e.error, /la voix ou l'adresse n'existe pas/); assert.ok(!e.error.includes(cle));
    const liste = (await v.json('/api/voice/voices')).body as { ok: boolean; voices: unknown[] };
    assert.equal(liste.ok, true); assert.deepEqual(liste.voices, []);
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ d. Copier sa propre voix, avec l'accord noté

test('copie de voix : jamais sans accord, l\'accord est noté avant que l\'enregistrement parte, la voix copiée sert ensuite, l\'enregistrement n\'est pas gardé', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v), home = v.o.paths.home;
    const sample = Buffer.concat([Buffer.from('ECHANTILLON-DE-MA-VOIX-'), Buffer.alloc(4000, 7)]);
    let aLArrivee = '';
    const el = await elevenSim({ avant: () => { aLArrivee = existsSync(accordsFile(home)) ? readFileSync(accordsFile(home), 'utf8') : ''; } }); tt.onEnd(() => el.close());
    const moi = { name: 'Ma voix', consent: '1', de: 'moi', file: 'moi.webm' };
    // « 100 % local » coché (réglage de départ) : la voix ne part pas en ligne, même avec l'accord.
    let r = await w.clone(moi, sample);
    assert.equal(r.ok, false); assert.match(r.error!, /100 % local.*ne part pas chez ElevenLabs/);
    assert.equal((await w.save('voice_options', { localOnly: false })).ok, true);
    // ElevenLabs pas encore choisi, puis choisi sans clé : refusé avec quoi faire.
    r = await w.clone(moi, sample); assert.match(r.error!, /choisis « ElevenLabs »/);
    assert.equal((await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '' }))).ok, true);
    delete process.env.ELEVENLABS_API_KEY;
    r = await w.clone(moi, sample); assert.match(r.error!, /Il manque ta clé ElevenLabs/);
    assert.equal((await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '', elevenKey: el.key }))).ok, true);
    // Sans accord : refusé. La voix de quelqu'un d'autre sans son nom : refusé. Rien n'est parti, rien n'est noté.
    r = await w.clone({ name: 'Ma voix', de: 'moi' }, sample); assert.equal(r.ok, false); assert.match(r.error!, /copie refusée.*accord/);
    r = await w.clone({ name: 'Ma voix', consent: '0', de: 'moi' }, sample); assert.equal(r.ok, false);
    r = await w.clone({ name: 'Voix de Mariam', consent: '1', de: 'autre', personne: ' ' }, sample); assert.equal(r.ok, false); assert.match(r.error!, /écris le nom de la personne/);
    r = await w.clone({ consent: '1', de: 'moi', name: '' }, sample); assert.match(r.error!, /donne un nom/);
    r = await w.clone(moi, new Uint8Array()); assert.match(r.error!, /ajoute un enregistrement/);
    assert.equal(el.hits.filter((h) => h.path === '/v1/voices/add').length, 0, 'aucun enregistrement n\'est parti sans accord');
    assert.deepEqual(accords(home), [], 'et rien n\'est noté');
    // Avec l'accord (« c'est ma voix ») : noté d'abord, puis envoyé.
    r = await w.clone(moi, sample);
    assert.equal(r.ok, true, r.error); assert.equal(r.verify, false); assert.match(r.text!, /accord noté/);
    assert.match(aLArrivee, /"de": "moi"/, 'l\'accord était déjà écrit quand l\'enregistrement est arrivé chez ElevenLabs');
    assert.match(aLArrivee, /"voiceId": ""/, 'la voix n\'existait pas encore');
    const add = el.hits.find((h) => h.path === '/v1/voices/add')!;
    assert.equal(add.headers['xi-api-key'], el.key); assert.equal(add.form!.name, 'Ma voix');
    assert.deepEqual(el.samples[0].file.data, sample, 'l\'enregistrement envoyé est bien celui-là'); assert.equal(el.samples[0].file.name, 'moi.webm'); assert.equal(el.samples[0].file.type, 'audio/webm');
    const [a] = accords(home);
    assert.deepEqual({ de: a.de, personne: a.personne, phrase: a.phrase, par: a.par, voiceName: a.voiceName, voiceId: a.voiceId, service: a.service, echantillon: a.echantillon },
      { de: 'moi', personne: '', phrase: 'C\'est ma voix, et j\'accepte qu\'Odin la copie pour parler avec.', par: 'Awa', voiceName: 'Ma voix', voiceId: r.voiceId, service: 'elevenlabs', echantillon: { octets: sample.length, sha256: createHash('sha256').update(sample).digest('hex'), type: 'audio/webm' } });
    assert.ok(Date.now() - Date.parse(a.at) < 60_000, 'avec la date');
    // L'enregistrement n'est écrit nulle part dans le dossier d'Odin (ni l'adresse du propriétaire dans le registre).
    assert.deepEqual(contenant(home, 'ECHANTILLON-DE-MA-VOIX-'), [], 'l\'enregistrement n\'est pas gardé');
    assert.ok(!readFileSync(accordsFile(home), 'utf8').includes('@'), 'pas d\'adresse dans le registre');
    assert.equal(statSync(accordsFile(home)).mode & 0o777, 0o600);
    // La voix copiée sert ensuite : c'est elle qui parle.
    assert.equal(v.o.cfg.voice.tts.voiceId, r.voiceId); assert.equal(v.o.cfg.voice.tts.voiceName, 'Ma voix');
    const dit = await w.speak({ text: 'Je parle avec ma propre voix.' });
    assert.equal(dit.type, 'audio/mpeg'); assert.equal(el.said.at(-1)!.voice, r.voiceId);
    const liste = await w.copies();
    assert.deepEqual(liste.map((c) => ({ nom: c.nom, de: c.de, actuelle: c.actuelle, retire: c.retire })), [{ nom: 'Ma voix', de: 'moi', actuelle: true, retire: '' }]);
    assert.ok(!JSON.stringify(liste).includes(a.echantillon.sha256) && !JSON.stringify(liste).includes(r.voiceId!), 'la page ne reçoit ni l\'empreinte ni l\'identifiant');
    // Le registre est fermé aux outils de fichiers (une voix est une donnée personnelle).
    assert.ok(isSecretFile(accordsFile(home))); assert.ok(isSecretFile('/home/x/.odin/valhalla/bragi/copies/echantillon.wav'));
    assert.throws(() => toolPath({ workspace: v.o.paths.workspace, fullAccess: true }, accordsFile(home)), /Fichier de secrets d'Odin/);
    assert.ok(!isSecretFile('/home/x/.odin/valhalla/bragi/audio/odin-1.wav'), 'un son fabriqué par « Dire » n\'est pas un secret');
  } finally { await tt.end(); }
});

test('copie de voix : la voix de quelqu\'un d\'autre porte son nom dans l\'accord ; vérification demandée par ElevenLabs ; échec = aucun accord gardé', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v), home = v.o.paths.home, sample = Buffer.alloc(2000, 3);
    const el = await elevenSim(); tt.onEnd(() => el.close());
    await w.save('voice_options', { localOnly: false });
    await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '', elevenKey: el.key, gender: 'femme' }));
    // La voix de Mariam, avec son accord : noté avec son nom ; elle devient la voix de femme d'Odin (le genre choisi).
    const r = await w.clone({ name: 'Voix de Mariam', consent: '1', de: 'autre', personne: 'Mariam Saïd', file: 'mariam.m4a' }, sample, 'audio/mp4');
    assert.equal(r.ok, true, r.error);
    const [a] = accords(home);
    assert.deepEqual({ de: a.de, personne: a.personne, phrase: a.phrase }, { de: 'autre', personne: 'Mariam Saïd', phrase: 'C\'est la voix de Mariam Saïd, qui m\'a donné son accord pour qu\'Odin la copie et parle avec.' });
    assert.equal(v.o.cfg.voice.femaleVoiceId, r.voiceId, 'rangée comme voix de femme'); assert.notEqual(v.o.cfg.voice.tts.voiceId, r.voiceId);
    await w.speak({ text: 'Bonjour' }); assert.equal(el.said.at(-1)!.voice, r.voiceId, 'c\'est elle qui parle');
    assert.deepEqual((await w.copies()).map((c) => [c.nom, c.de, c.personne, c.actuelle]), [['Voix de Mariam', 'autre', 'Mariam Saïd', true]]);
    // ElevenLabs demande une vérification : la voix n'est pas choisie (elle ne pourrait pas parler), et c'est dit.
    const el2 = await elevenSim({ verify: true }); tt.onEnd(() => el2.close());
    await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el2.url, voiceId: '', elevenKey: el2.key, gender: 'homme' }));
    const r2 = await w.clone({ name: 'Ma voix', consent: '1', de: 'moi' }, sample);
    assert.equal(r2.ok, true); assert.equal(r2.verify, true); assert.match(r2.text!, /ElevenLabs demande encore de vérifier/);
    assert.equal(v.o.cfg.voice.tts.voiceId, '', 'pas choisie tant qu\'elle n\'est pas vérifiée'); assert.equal(accords(home)[0].aVerifier, true);
    // ElevenLabs en panne : la copie échoue, aucun accord ne reste noté pour une voix qui n'existe pas.
    const el3 = await elevenSim({ panne: { status: 500 } }); tt.onEnd(() => el3.close());
    await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el3.url, voiceId: '', elevenKey: el3.key }));
    const n = accords(home).length, r3 = await w.clone({ name: 'Encore', consent: '1', de: 'moi' }, sample);
    assert.equal(r3.ok, false); assert.match(r3.error!, /Copie de la voix impossible : le service est en panne/); assert.equal(accords(home).length, n);
    // Les mêmes règles hors de la page : sans accord, rien ; en mode 100 % local, rien.
    assert.throws(() => phraseAccord({ consent: false }), /copie refusée/); assert.throws(() => phraseAccord({ consent: true, de: 'autre', personne: 'X' }), /nom de la personne/);
    assert.match(cloneBlocked({ ...v.o.cfg.voice, localOnly: true })!, /100 % local/);
    await assert.rejects(cloneVoice('Ma voix', [{ data: new Uint8Array(sample), mime: 'audio/webm', filename: 'a.webm' }], false, v.o.cfg.voice), /accord/);
    await assert.rejects(cloneVoice('Ma voix', [{ data: new Uint8Array(sample), mime: 'audio/webm', filename: 'a.webm' }], true, { ...v.o.cfg.voice, localOnly: true }), /100 % local/);
    assert.equal(el3.hits.filter((h) => h.path === '/v1/voices/add').length, 1, 'un seul envoi : celui de la copie en panne');
  } finally { await tt.end(); }
});

test('copie de voix : retirer l\'accord arrête Odin tout de suite et efface la voix chez ElevenLabs (même si le service ne répond pas d\'abord)', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v), home = v.o.paths.home, sample = Buffer.alloc(2000, 5);
    const el = await elevenSim(); tt.onEnd(() => el.close());
    await w.save('voice_options', { localOnly: false });
    await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '', elevenKey: el.key }));
    const r = await w.clone({ name: 'Ma voix', consent: '1', de: 'moi' }, sample); assert.equal(r.ok, true, r.error);
    const id = (await w.copies())[0].id;
    assert.equal((await w.retirer('inconnu')).ok, false);
    // Le service ne répond pas : Odin arrête quand même de parler avec cette voix, et dit ce qui reste à faire.
    const vraieAdresse = v.o.cfg.voice.tts.baseUrl; v.o.cfg.voice.tts.baseUrl = `http://127.0.0.1:${await freePort()}`;
    const x = await w.retirer(id);
    assert.equal(x.ok, false); assert.match(x.error!, /Odin ne parle plus avec « Ma voix », mais je n'ai pas pu l'effacer chez ElevenLabs/);
    assert.equal(v.o.cfg.voice.tts.voiceId, '', 'Odin ne s\'en sert plus');
    let c = (await w.copies())[0]; assert.ok(c.retire); assert.equal(c.effacee, false); assert.equal(c.actuelle, false);
    assert.equal(el.deleted.length, 0);
    // Nouvel essai, le service répond : la voix est effacée là-bas.
    v.o.cfg.voice.tts.baseUrl = vraieAdresse;
    const y = await w.retirer(id);
    assert.equal(y.ok, true, y.error); assert.match(y.text!, /effacée chez ElevenLabs/);
    assert.deepEqual(el.deleted, [r.voiceId]); assert.equal(el.hits.at(-1)!.method, 'DELETE'); assert.equal(el.hits.at(-1)!.headers['xi-api-key'], el.key);
    c = (await w.copies())[0]; assert.equal(c.effacee, true);
    assert.equal(accords(home)[0].retire !== undefined, true, 'le retrait reste noté, avec sa date');
    // Odin reparle avec la voix prête à l'emploi.
    await w.speak({ text: 'Bonjour' }); assert.equal(el.said.at(-1)!.voice, 'onwK4e9ZLuTAKqWW03F9');
    // Déjà effacée depuis elevenlabs.io : c'est ce qu'on voulait, pas une erreur. Même quand Piper parle aujourd'hui.
    await removeVoice(r.voiceId!, v.o.cfg.voice);
    await assert.rejects(removeVoice('../etc', v.o.cfg.voice), /identifiant de voix invalide/);
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ e. Réponses en audio : Telegram et web

test(`Telegram : la réponse part en note vocale, au format qu'il attend (Ogg/Opus, un canal) ; Pythie se laisse écouter (${PIPER}, faux Telegram)`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt); garde(tt, 'MQTT_PASSWORD', 'BRISINGAMEN_KEY');
    const tg = await telegramSim(); tt.onEnd(() => tg.close());
    const o = makeOdin([{ text: 'Il fait beau à Mamoudzou, 29 degrés.' }, { text: 'Deuxième réponse, par écrit.' }, { text: 'Troisième réponse.' }]); tt.onEnd(() => o.cleanup());
    const gw = new Gateway(o, { owners: { telegram: ['42'] } });
    gw.add(new TelegramChannel(tg.token, tg.url, { owner: '42', progress: false, home: o.paths.home }));
    await gw.start(); tt.onEnd(() => gw.stop());
    const voix = () => tg.sent.filter((x) => x.method === 'sendVoice'), textes = () => tg.sent.filter((x) => x.method === 'sendMessage').map((x) => x.text ?? '');
    // « … en vocal » : la réponse écrite, puis la même en note vocale.
    tg.say(42, 'Quel temps fait-il ? Réponds-moi en vocal.');
    assert.ok(await until(() => voix().length === 1 || tg.sent.some((x) => x.method === 'sendDocument'), 20_000), `note vocale envoyée (${JSON.stringify(tg.sent.map((x) => x.method))})`);
    assert.ok(textes().some((t) => /Il fait beau à Mamoudzou/.test(t)), 'la réponse écrite part aussi'); assert.ok(homme(m));
    if (FFMPEG) {
      const n = voix()[0]; assert.equal(n.chat_id, '42');
      assert.deepEqual({ name: n.file!.name, type: n.file!.type }, { name: 'odin.ogg', type: 'audio/ogg' });
      assert.equal(audioKind(n.file!.data), 'ogg'); lisible(n.file!.data, /ogg/, 'note vocale Telegram');
      if (FFPROBE) { const s = sonde(n.file!.data)!; assert.equal(s.codec, 'opus'); assert.equal(s.cadence, 48000); }
    } else assert.equal(tg.sent.find((x) => x.method === 'sendDocument')!.file!.name, 'odin.wav', 'sans ffmpeg : un fichier son, pas une fausse note vocale');
    // Une question écrite ordinaire : pas de note vocale.
    const avant = tg.sent.filter((x) => x.method !== 'sendMessage').length;
    tg.say(42, 'Et demain ?');
    assert.ok(await until(() => textes().some((t) => /Deuxième réponse/.test(t)), 15_000)); await new Promise((r) => setTimeout(r, 300));
    assert.equal(tg.sent.filter((x) => x.method !== 'sendMessage').length, avant, 'réponse écrite seulement');
    // Voix de femme choisie d'une phrase : la note vocale suivante l'utilise.
    tg.say(42, 'parle avec une voix de femme');
    assert.ok(await until(() => textes().some((t) => /voix de femme/.test(t)), 10_000)); assert.equal(o.cfg.voice.gender, 'femme');
    tg.say(42, 'Dis-le à voix haute : quel temps demain ?');
    assert.ok(await until(() => tg.sent.filter((x) => x.method === 'sendVoice' || x.method === 'sendDocument').length === 2, 20_000)); assert.ok(femme(m));
    // Pythie : le bouton « Écouter » sous une réponse envoie la réponse en note vocale (sans ses renvois [1]).
    const stop = startValhalla(o, async () => undefined, { modules: [volva(() => ({})), bragi(() => voiceFor(o.cfg.voice, o.cfg))] }); tt.onEnd(stop);
    writeFileSync(join(valhallaOf()!.ctx('volva').dir, 'historique.json'), JSON.stringify([{ id: 'abc123', at: Date.now(), q: 'Chef-lieu de Mayotte ?', focus: 'tout', answer: '**Mamoudzou** est le chef-lieu de Mayotte [1].', sources: [], engines: [], followups: [], apps: [], ai: false, errors: [] }]));
    tg.press(42, 'vs:ec:abc123');
    assert.ok(await until(() => tg.sent.filter((x) => x.method === 'sendVoice' || x.method === 'sendDocument').length === 3, 20_000), 'la réponse de Pythie part en note vocale');
    tg.press(42, 'vs:ec:ffffff');
    assert.ok(await until(() => textes().some((t) => /n'est plus dans l'historique de Pythie/.test(t)), 10_000));
  } finally { await tt.end(); }
});

test('Telegram : la note vocale d\'ElevenLabs part telle quelle ; un refus de Telegram ou une voix en panne ne casse pas la réponse écrite', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const el = await elevenSim(); tt.onEnd(() => el.close()); process.env.ELEVENLABS_API_KEY = el.key;
    const tg = await telegramSim(); tt.onEnd(() => tg.close());
    const cfg = (c: OdinConfig): OdinConfig => ({ ...c, voice: { ...c.voice, localOnly: false, gender: 'femme', tts: { provider: 'elevenlabs', voiceId: '', voiceName: '', model: 'eleven_multilingual_v2', baseUrl: el.url, apiKeyEnv: 'ELEVENLABS_API_KEY' } } });
    const o = makeOdin([{ text: 'Réponse une.' }, { text: 'Réponse deux.' }], { config: cfg }); tt.onEnd(() => o.cleanup());
    const gw = new Gateway(o, { owners: { telegram: ['42'] } });
    const ch = new TelegramChannel(tg.token, tg.url, { owner: '42', progress: false, home: o.paths.home });
    gw.add(ch); await gw.start(); tt.onEnd(() => gw.stop());
    tg.say(42, 'Quelle heure est-il ? Réponds-moi en vocal.');
    assert.ok(await until(() => tg.sent.some((x) => x.method === 'sendVoice'), 15_000), `note vocale envoyée (${JSON.stringify(tg.sent.map((x) => x.text ?? x.method))})`);
    const n = tg.sent.find((x) => x.method === 'sendVoice')!;
    assert.deepEqual(n.file!.data, PETIT_OGG, 'l\'Opus d\'ElevenLabs est envoyé sans conversion'); assert.equal(n.file!.name, 'odin.ogg');
    assert.deepEqual(el.said.at(-1), { voice: 'XB0fDUnXU5powFXDhCwa', text: 'Réponse une.', model: 'eleven_multilingual_v2', format: 'opus_48000_64' });
    // Telegram refuse une note vocale (jeton révoqué, fichier refusé…) : l'envoi le dit au lieu de se taire.
    const refus = new TelegramChannel('mauvais-jeton', tg.url);
    await assert.rejects(refus.sendVoice('42', PETIT_OGG), /Telegram a refusé la note vocale \(Unauthorized\)/);
    // Un MP3 passe aussi en note vocale ; un WAV (pas de ffmpeg pour le convertir) part comme un fichier son.
    await ch.sendVoice('42', PETIT_MP3); assert.deepEqual({ m: tg.sent.at(-1)!.method, n: tg.sent.at(-1)!.file!.name, t: tg.sent.at(-1)!.file!.type }, { m: 'sendVoice', n: 'odin.mp3', t: 'audio/mpeg' });
    await ch.sendVoice('42', wav(0.3)); assert.deepEqual({ m: tg.sent.at(-1)!.method, n: tg.sent.at(-1)!.file!.name }, { m: 'sendDocument', n: 'odin.wav' });
    // La voix tombe en panne : la réponse écrite arrive quand même.
    await el.close();
    tg.say(42, 'Et demain ? Dis-le à voix haute.');
    assert.ok(await until(() => tg.sent.some((x) => x.method === 'sendMessage' && /Réponse deux/.test(x.text ?? '')), 15_000), 'la réponse écrite arrive');
  } finally { await tt.end(); }
});

test(`web : le son demandé par la page est un vrai fichier lisible ; la page a le droit de le jouer ; sans voix prête, c'est dit (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt), v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    const a = await w.speak({ text: 'La réponse d\'Odin, lue à voix haute dans la page.' });
    assert.equal(a.type, 'audio/wav'); lisible(a.data, /wav/, 'son servi à la page'); assert.equal(m.appels().length, 1);
    // La page (et celle de Pythie) ont le droit de jouer un son reçu d'Odin, et rien d'autre.
    for (const p of ['/', '/recherche']) assert.match((await fetch(v.url + p, { headers: { cookie: v.session } })).headers.get('content-security-policy')!, /media-src 'self' blob:/, p);
    // Réservé à la session du propriétaire, et à une demande qui vient bien de la page.
    assert.equal((await fetch(`${v.url}/api/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: '{"text":"x"}' })).status, 401);
    assert.equal((await fetch(`${v.url}/api/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: v.session }, body: '{"text":"x"}' })).status, 403);
    for (const p of ['/api/voice/copies', '/api/voice/voices']) assert.equal((await fetch(v.url + p)).status, 401, p);
    assert.equal((await fetch(`${v.url}/api/voice/clone?name=x&consent=1`, { method: 'POST', headers: { 'x-odin': '1' }, body: 'x' })).status, 401);
    // Un texte vide, puis plus de voix du tout : une phrase claire, pas un son cassé.
    assert.match((await w.speak({ text: '   ' })).error, /rien à dire/);
    process.env.ODIN_HOME = tt.tmp('odin-voix-vide-');
    assert.match((await w.speak({ text: 'Bonjour' })).error, /La synthèse vocale n'est pas configurée \(Réglages → Voix\)/);
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ f. Orphée « Dire » et la réponse de Pythie en audio

test(`Orphée « Dire » et Pythie « Écouter une réponse » : un son à télécharger depuis la page, avec la voix choisie (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt);
    const v = await vraiOdin(tt, { compte: true, modules: (o) => [volva(() => ({})), bragi(() => voiceFor(o.cfg.voice, o.cfg))] });
    const act = async (module: string, action: string, input: Record<string, unknown>) => (await v.json('/api/valhalla/act', { module, action, input })).body as { ok: boolean; text: string; fichiers?: Array<{ nom: string; ref: string }>; module?: string };
    const prendre = async (module: string, ref: string) => await fetch(`${v.url}/api/valhalla/fichier?${new URLSearchParams({ module, ref })}`, { headers: { cookie: v.session } });
    // Orphée « Dire » : le fichier porte la vraie extension du son (du WAV avec Piper, plus un « .mp3 » qui n'en est pas un).
    const d = await act('bragi', 'dire', { texte: 'Bonjour, voici un message à écouter.' });
    assert.equal(d.ok, true, d.text); assert.match(d.fichiers![0].nom, /^odin-\d+\.wav$/); assert.ok(homme(m));
    const f = await prendre('bragi', d.fichiers![0].ref);
    assert.equal(f.status, 200); assert.match(f.headers.get('content-disposition')!, /attachment; filename="odin-\d+\.wav"/);
    lisible(new Uint8Array(await f.arrayBuffer()), /wav/, 'son téléchargé');
    // Avec la voix de femme choisie dans Réglages → Voix.
    v.o.cfg.voice.gender = 'femme';
    await act('bragi', 'dire', { texte: 'Et maintenant avec la voix de femme.' }); assert.ok(femme(m), 'Orphée suit le réglage');
    // Rien d'autre du dossier d'Orphée ne sort par là (ni le registre des accords, ni un chemin qui remonte).
    for (const ref of ['../copies/accords.json', '../réglages.json', 'odin-1.wav/../../x', '/etc/passwd']) assert.equal((await prendre('bragi', ref)).status, 404, ref);
    assert.match((await act('bragi', 'dire', { texte: '   ' })).text, /écris le texte à dire|Il manque/);
    // Pythie : la réponse d'une recherche, lue par Orphée ; le son se télécharge depuis la page de Pythie.
    assert.match((await act('volva', 'ecouter', {})).text, /aucune recherche à lire/);
    writeFileSync(join(valhallaOf()!.ctx('volva').dir, 'historique.json'), JSON.stringify([{ id: 'abc123', at: Date.now(), q: 'Quel est le chef-lieu de Mayotte ?', focus: 'tout', answer: '**Mamoudzou** est le chef-lieu de Mayotte [1]. La ville compte environ 71 000 habitants [2].', sources: [], engines: [], followups: [], apps: [], ai: false, errors: [] }]));
    const e = await act('volva', 'ecouter', { id: 'abc123' });
    assert.equal(e.ok, true, e.text); assert.match(e.text, /la réponse est prête à écouter/); assert.equal(e.module, 'volva');
    const son = await prendre('volva', e.fichiers![0].ref); assert.equal(son.status, 200);
    const octets = new Uint8Array(await son.arrayBuffer()); lisible(octets, /wav/, 'réponse de Pythie en audio');
    assert.ok(wavSeconds(octets) > 2, 'toute la réponse est lue'); assert.ok(femme(m));
    assert.match((await act('volva', 'ecouter', { id: 'inconnu' })).text, /n'est plus dans l'historique/);
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ Ce qui se dit, et comment

test('texte à dire : trop long, il s\'arrête à la fin d\'une phrase ; le format d\'un son se lit dans ses octets', () => {
  const long = `${'Une phrase assez courte pour être dite. '.repeat(80)}Fin.`;
  const dit = forSpeech(long);
  assert.ok(dit.length <= 2500 && dit.length > 2000); assert.ok(dit.endsWith('dite.'), 'coupé après un point, pas au milieu d\'un mot');
  assert.equal(forSpeech('Court. **Gras** et `code`.'), 'Court. Gras et code.');
  assert.equal(audioKind(PETIT_MP3), 'mp3'); assert.equal(audioKind(PETIT_OGG), 'ogg'); assert.equal(audioKind(wav(0.1)), 'wav');
  assert.equal(audioKind(Buffer.from('<!DOCTYPE html><html>')), ''); assert.equal(audioKind(new Uint8Array(3)), '');
  assert.equal(audioKind(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(8)])), 'm4a');
});
