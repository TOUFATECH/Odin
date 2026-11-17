// La voix d'Odin, fonction par fonction, après le retrait des modèles d'autrui (décision du propriétaire, 17/11/2026) :
// Odin ne parle plus et n'écoute plus par Piper, Whisper, ElevenLabs ou OpenAI, ne copie plus de voix, et le dit
// (« pas encore ») ; le choix d'une voix d'homme ou de femme se garde ; les clés restent dans le coffre ; les accès
// restent fermés ; une ancienne copie de voix se retire sans appel ; la réponse écrite part toujours.
//
// Pour de vrai ici : le serveur web d'Odin, ses réglages et ses fichiers. Avec un faux : ElevenLabs, le serveur Piper
// et Telegram (faux serveurs : on vérifie qu'Odin ne leur demande plus rien), et Piper « installé » (faux programme
// qui note chaque lancement : on vérifie qu'il n'est jamais lancé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway, voiceGenderCommand } from '../src/bifrost/gateway.ts';
import { TelegramChannel } from '../src/bifrost/channels/telegram.ts';
import { DEFAULT_CONFIG, type OdinConfig } from '../src/config.ts';
import { isSecretFile, toolPath } from '../src/heimdall/policy.ts';
import { voiceFor } from '../src/profiles.ts';
import { voiceSet } from '../src/tools/assistant.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { bragi } from '../src/valhalla/modules/bragi.ts';
import { volva } from '../src/valhalla/modules/volva.ts';
import { accords, accordsFile, majAccord, noteAccord, phraseAccord } from '../src/voice/accords.ts';
import { audioKind, cloneBlocked, forSpeech, hear, listVoices, speakAudio, ttsIsLocal, ttsReady, TTS_DEFAULTS } from '../src/voice/voice.ts';
import { T, until } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { telegramSim } from './banc/sim/telegram.ts';
import { elevenSim, maisonVoix, PETIT_MP3, PETIT_OGG, piperSim, vraiPiper, wav, type MaisonVoix } from './banc/sim/voix.ts';
import { readSecretFile } from '../src/vault.ts';
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

test(`voix d'homme ou de femme : le choix de Réglages → Voix se garde et sert de réglage, sans relancer Odin ; aucune voix d'autrui ne parle (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt), v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    // Odin ne parle plus par un modèle d'autrui : la page reçoit « pas encore », Piper (présent) n'est jamais lancé.
    assert.match((await w.speak({ text: PHRASE })).error, /mon propre modèle de voix n'est pas encore entraîné/);
    assert.match((await w.speak({ text: PHRASE, gender: 'femme' })).error, /pas encore entraîné/);
    assert.equal(v.o.cfg.voice.gender, 'homme', 'écouter un essai ne change rien');
    // Choisir « femme » et enregistrer : pris en compte tout de suite, écrit dans la configuration, sans redémarrage.
    const r = await w.save('voice', w.services({ gender: 'femme' }));
    assert.deepEqual({ ok: r.ok, reloading: r.reloading, restartNeeded: r.restartNeeded }, { ok: true, reloading: false, restartNeeded: false });
    assert.equal(v.o.cfg.voice.gender, 'femme');
    assert.equal((JSON.parse(readFileSync(v.o.paths.config, 'utf8')) as { voice: { gender: string } }).voice.gender, 'femme', 'le choix est gardé sur le disque');
    const etat = (await v.json('/api/state')).body as { settings: { voice: { gender: string } } };
    assert.equal(etat.settings.voice.gender, 'femme', 'la page le retrouve coché en se rechargeant');
    // À la demande (outil voice_set) : même réglage, tout de suite.
    await voiceSet.run({ genre: 'homme' }, { paths: v.o.paths, careCfg: v.o.cfg } as never);
    assert.equal(v.o.cfg.voice.gender, 'homme');
    // … et sans IA : la phrase seule suffit, dans la discussion.
    await v.json('/api/message', { text: 'Parle avec une voix de femme.', peer: 'principal' });
    assert.ok(await until(() => v.o.cfg.voice.gender === 'femme', 5000), 'compris sans IA');
    assert.equal(v.o.provider.calls.length, 0, 'aucune IA appelée pour ça');
    assert.deepEqual(m.appels(), [], 'Piper n\'a jamais été lancé');
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

// ------------------------------------------------------------------ b. Plus aucune voix ni écoute d'autrui

test(`Piper installé sur la machine : plus jamais lancé ; rien n'est installé ni téléchargé (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt), v = base();
    assert.equal(ttsReady(v, {}), false, 'pas prête, même avec Piper sur le disque'); assert.equal(ttsIsLocal(v), true);
    const t0 = Date.now();
    await assert.rejects(speakAudio(PHRASE, v, 'mp3_44100_128', undefined, {}), /pas encore entraîné/);
    await assert.rejects(hear(new Uint8Array([1, 2, 3]), 'audio/ogg', v, undefined, {}), /mon propre modèle d'écoute n'est pas encore entraîné/);
    assert.ok(Date.now() - t0 < 5000, 'réponse immédiate (rien n\'est compilé)');
    assert.deepEqual(m.appels(), [], 'Piper n\'a jamais été lancé');
    const vide = sansPiper(tt);
    await assert.rejects(speakAudio(PHRASE, v, 'mp3_44100_128', undefined, {}), /pas encore entraîné/);
    assert.deepEqual(readdirSync(vide), [], 'rien n\'a été téléchargé ni compilé dans le dossier d\'Odin');
  } finally { await tt.end(); }
});

test('serveur Piper, ElevenLabs, OpenAI : plus aucun appel, même avec une adresse et une clé', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const el = await elevenSim(); tt.onEnd(() => el.close());
    const piper = await piperSim('actuel'); tt.onEnd(() => piper.close());
    const env = { ELEVENLABS_API_KEY: el.key, OPENAI_API_KEY: 'sk-essai-0123456789' };
    const eleven: Voice = { ...base(), localOnly: false, tts: { provider: 'elevenlabs', voiceId: '', voiceName: '', model: 'eleven_multilingual_v2', baseUrl: el.url, apiKeyEnv: 'ELEVENLABS_API_KEY' } };
    const serveurPiper: Voice = { ...base(), localOnly: false, tts: { ...base().tts, provider: 'piper', baseUrl: piper.url } };
    const openai: Voice = { ...base(), localOnly: false, tts: { ...TTS_DEFAULTS.openai, provider: 'openai', voiceName: '', baseUrl: el.url } };
    for (const [nom, w] of [['ElevenLabs', eleven], ['serveur Piper', serveurPiper], ['OpenAI', openai]] as const) {
      assert.equal(ttsReady(w, env), false, nom);
      await assert.rejects(speakAudio('Bonjour', w, 'mp3_44100_128', undefined, env), /pas encore entraîné/, nom);
      await assert.rejects(hear(new Uint8Array([1, 2, 3]), 'audio/ogg', { ...w, stt: { ...w.stt, baseUrl: el.url } }, undefined, env), /pas encore entraîné/, nom);
    }
    assert.deepEqual(await listVoices(eleven, env), [], 'plus de liste de voix à demander');
    assert.match(cloneBlocked(eleven, env), /copier une voix/);
    assert.equal(el.hits.length, 0, 'ElevenLabs n\'a reçu aucune demande');
    assert.equal(piper.hits.length, 0, 'le serveur Piper n\'a reçu aucune demande');
  } finally { await tt.end(); }
});

test('clé enregistrée dans Réglages → Voix : elle reste dans le coffre local, la page ne la reçoit jamais ; aucun service n\'est appelé', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const cle = 'sk_cle_du_proprietaire_pour_la_page_7788';
    const el = await elevenSim({ key: cle }); tt.onEnd(() => el.close());
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    assert.equal((await w.save('voice_options', { localOnly: false })).ok, true);
    const r = await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, elevenKey: cle, voiceId: '', gender: 'homme' }));
    assert.equal(r.ok, true, r.error);
    // La clé : chiffrée, on ne la trouve en clair dans AUCUN fichier, et le coffre la rend à Odin.
    assert.deepEqual(contenant(v.o.paths.home, cle).map((f) => f.slice(v.o.paths.home.length + 1)), []);
    assert.match(readSecretFile(join(v.o.paths.home, 'env'))!, new RegExp(cle));
    assert.ok(isSecretFile('/home/x/.odin/env'), 'ce fichier est fermé aux outils de fichiers');
    const etat = JSON.stringify((await v.json('/api/state')).body);
    assert.ok(!etat.includes(cle), 'la page ne reçoit jamais la clé');
    assert.equal(v.o.redactor.redact(`ma clé est ${cle}`).includes(cle), false, 'masquée dans tout ce qu\'Odin écrit ou dit');
    // La voix : « pas encore », sans la clé, et sans aucun appel.
    const e = await w.speak({ text: 'Bonjour' });
    assert.match(e.error, /pas encore entraîné/); assert.ok(!e.error.includes(cle));
    const liste = (await v.json('/api/voice/voices')).body as { ok: boolean; voices: unknown[] };
    assert.equal(liste.ok, true); assert.deepEqual(liste.voices, []);
    assert.equal(el.hits.length, 0, 'ElevenLabs n\'a reçu aucune demande');
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ c. Copie de voix : plus possible, rien ne part

test('copie de voix : « pas encore », aucun accord noté, aucun enregistrement envoyé ni gardé ; le registre reste un secret', async () => {
  const tt = new T();
  try {
    sansPiper(tt); garde(tt, 'ELEVENLABS_API_KEY');
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v), home = v.o.paths.home;
    const el = await elevenSim(); tt.onEnd(() => el.close());
    await w.save('voice_options', { localOnly: false });
    await w.save('voice', w.services({ ttsProvider: 'elevenlabs', ttsUrl: el.url, voiceId: '', elevenKey: el.key }));
    const sample = Buffer.concat([Buffer.from('ECHANTILLON-DE-MA-VOIX-'), Buffer.alloc(4000, 7)]);
    for (const q of [{ name: 'Ma voix', consent: '1', de: 'moi', file: 'moi.webm' } as Record<string, string>, { name: 'Ma voix', de: 'moi' }, { name: 'Voix de Mariam', consent: '1', de: 'autre', personne: 'Mariam Saïd' }]) {
      const r = await w.clone(q, sample);
      assert.equal(r.ok, false); assert.match(r.error!, /copier une voix/);
    }
    assert.equal(el.hits.length, 0, 'aucun enregistrement n\'est parti');
    assert.deepEqual(accords(home), [], 'rien n\'est noté');
    assert.deepEqual(contenant(home, 'ECHANTILLON-DE-MA-VOIX-'), [], 'l\'enregistrement n\'est pas gardé');
    assert.equal(v.o.cfg.voice.tts.voiceId, '');
    // Les règles de l'accord restent (pour la future voix d'Odin), et le registre reste fermé aux outils de fichiers.
    assert.throws(() => phraseAccord({ consent: false }), /copie refusée/); assert.throws(() => phraseAccord({ consent: true, de: 'autre', personne: 'X' }), /nom de la personne/);
    assert.ok(isSecretFile(accordsFile(home))); assert.ok(isSecretFile('/home/x/.odin/valhalla/bragi/copies/echantillon.wav'));
    assert.throws(() => toolPath({ workspace: v.o.paths.workspace, fullAccess: true }, accordsFile(home)), /Fichier de secrets d'Odin/);
    assert.ok(!isSecretFile('/home/x/.odin/valhalla/bragi/audio/odin-1.wav'), 'un son fabriqué par « Dire » n\'est pas un secret');
  } finally { await tt.end(); }
});

test('copie de voix d\'avant : retirer l\'accord arrête Odin tout de suite, sans appeler ElevenLabs ; il dit où l\'effacer', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v), home = v.o.paths.home;
    const el = await elevenSim(); tt.onEnd(() => el.close());
    // Une copie faite avant le retrait : l'accord noté, la voix choisie pour Odin.
    const a = noteAccord(home, { ...phraseAccord({ consent: true, de: 'moi' }), par: 'Awa', voiceName: 'Ma voix', service: 'elevenlabs', sample: new Uint8Array(2000), type: 'audio/webm' });
    majAccord(home, a.id, { voiceId: 'VoixCopieeAvant01' });
    v.o.cfg.voice.tts.voiceId = 'VoixCopieeAvant01'; v.o.cfg.voice.tts.voiceName = 'Ma voix';
    assert.equal((await w.retirer('inconnu')).ok, false);
    const x = await w.retirer(a.id);
    assert.equal(x.ok, true, x.error); assert.match(x.text!, /Odin ne parle plus avec « Ma voix »[\s\S]*elevenlabs\.io/);
    assert.equal(v.o.cfg.voice.tts.voiceId, '', 'Odin ne s\'en sert plus');
    const c = (await w.copies())[0]; assert.ok(c.retire); assert.equal(c.effacee, false, 'pas marquée effacée : Odin ne l\'a pas effacée'); assert.equal(c.actuelle, false);
    assert.equal(el.hits.length, 0, 'ElevenLabs n\'a reçu aucune demande');
  } finally { await tt.end(); }
});

// ------------------------------------------------------------------ d. Réponses : par écrit partout

test('Telegram : « réponds-moi en vocal » donne la réponse écrite, sans note vocale ; l\'envoi d\'un son par le canal reste juste', async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt); garde(tt, 'MQTT_PASSWORD', 'BRISINGAMEN_KEY');
    const tg = await telegramSim(); tt.onEnd(() => tg.close());
    const o = makeOdin([{ text: 'Il fait beau à Mamoudzou, 29 degrés.' }, { text: 'Deuxième réponse, par écrit.' }]); tt.onEnd(() => o.cleanup());
    const gw = new Gateway(o, { owners: { telegram: ['42'] } });
    const ch = new TelegramChannel(tg.token, tg.url, { owner: '42', progress: false, home: o.paths.home });
    gw.add(ch); await gw.start(); tt.onEnd(() => gw.stop());
    const textes = () => tg.sent.filter((x) => x.method === 'sendMessage').map((x) => x.text ?? '');
    tg.say(42, 'Quel temps fait-il ? Réponds-moi en vocal.');
    assert.ok(await until(() => textes().some((t) => /Il fait beau à Mamoudzou/.test(t)), 20_000), 'la réponse écrite part');
    tg.say(42, 'Et demain ? Dis-le à voix haute.');
    assert.ok(await until(() => textes().some((t) => /Deuxième réponse/.test(t)), 15_000)); await new Promise((r) => setTimeout(r, 300));
    assert.equal(tg.sent.filter((x) => x.method === 'sendVoice' || x.method === 'sendDocument').length, 0, 'aucune note vocale');
    assert.deepEqual(m.appels(), [], 'Piper n\'a jamais été lancé');
    // Le canal sait toujours envoyer un son (pour la future voix d'Odin) : un refus de Telegram est dit, un WAV part en fichier.
    const refus = new TelegramChannel('mauvais-jeton', tg.url);
    await assert.rejects(refus.sendVoice('42', PETIT_OGG), /Telegram a refusé la note vocale \(Unauthorized\)/);
    await ch.sendVoice('42', PETIT_MP3); assert.deepEqual({ m: tg.sent.at(-1)!.method, n: tg.sent.at(-1)!.file!.name, t: tg.sent.at(-1)!.file!.type }, { m: 'sendVoice', n: 'odin.mp3', t: 'audio/mpeg' });
    await ch.sendVoice('42', wav(0.3)); assert.deepEqual({ m: tg.sent.at(-1)!.method, n: tg.sent.at(-1)!.file!.name }, { m: 'sendDocument', n: 'odin.wav' });
  } finally { await tt.end(); }
});

test('web : la voix demandée par la page répond « pas encore » ; les accès restent fermés comme avant', async () => {
  const tt = new T();
  try {
    sansPiper(tt);
    const v = await vraiOdin(tt, { compte: true, valhalla: false }), w = web(v);
    assert.match((await w.speak({ text: 'La réponse d\'Odin, lue à voix haute dans la page.' })).error, /pas encore entraîné/);
    // La page (et celle de Pythie) gardent leur politique de contenu pour les sons.
    for (const p of ['/', '/recherche']) assert.match((await fetch(v.url + p, { headers: { cookie: v.session } })).headers.get('content-security-policy')!, /media-src 'self' blob:/, p);
    // Réservé à la session du propriétaire, et à une demande qui vient bien de la page.
    assert.equal((await fetch(`${v.url}/api/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: '{"text":"x"}' })).status, 401);
    assert.equal((await fetch(`${v.url}/api/voice/speak`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: v.session }, body: '{"text":"x"}' })).status, 403);
    for (const p of ['/api/voice/copies', '/api/voice/voices']) assert.equal((await fetch(v.url + p)).status, 401, p);
    assert.equal((await fetch(`${v.url}/api/voice/clone?name=x&consent=1`, { method: 'POST', headers: { 'x-odin': '1' }, body: 'x' })).status, 401);
  } finally { await tt.end(); }
});

test(`Orphée « Dire » et Pythie « Écouter » : « pas encore » ; rien d'autre du dossier d'Orphée ne sort (${PIPER})`, async () => {
  const tt = new T();
  try {
    const m = avecPiper(tt);
    const v = await vraiOdin(tt, { compte: true, modules: (o) => [volva(() => ({})), bragi(() => voiceFor(o.cfg.voice, o.cfg))] });
    const act = async (module: string, action: string, input: Record<string, unknown>) => (await v.json('/api/valhalla/act', { module, action, input })).body as { ok: boolean; text: string; fichiers?: Array<{ nom: string; ref: string }>; module?: string };
    const prendre = async (module: string, ref: string) => await fetch(`${v.url}/api/valhalla/fichier?${new URLSearchParams({ module, ref })}`, { headers: { cookie: v.session } });
    const d = await act('bragi', 'dire', { texte: 'Bonjour, voici un message à écouter.' });
    assert.equal(d.ok, false); assert.match(d.text, /pas encore entraîné/); assert.equal(d.fichiers, undefined);
    for (const ref of ['../copies/accords.json', '../réglages.json', 'odin-1.wav/../../x', '/etc/passwd']) assert.equal((await prendre('bragi', ref)).status, 404, ref);
    writeFileSync(join(valhallaOf()!.ctx('volva').dir, 'historique.json'), JSON.stringify([{ id: 'abc123', at: Date.now(), q: 'Quel est le chef-lieu de Mayotte ?', focus: 'tout', answer: '**Mamoudzou** est le chef-lieu de Mayotte [1].', sources: [], engines: [], followups: [], apps: [], ai: false, errors: [] }]));
    const e = await act('volva', 'ecouter', { id: 'abc123' });
    assert.equal(e.fichiers, undefined, 'aucun son fabriqué'); assert.match(e.text, /pas encore entraîné/);
    assert.deepEqual(m.appels(), [], 'Piper n\'a jamais été lancé');
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
