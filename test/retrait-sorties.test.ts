// Retrait des modèles qui ne sont pas ceux d'Odin, première tranche : plus aucune sortie vers un modèle d'autrui.
// Décision du propriétaire (17/11/2026) : aucun modèle qui ne soit pas le sien. Ici, ce qui partait dehors ou lançait
// un modèle d'autrui ne le fait plus : voix et écoute en ligne (ElevenLabs, OpenAI), Whisper et Piper (installation
// automatique comprise), copie de voix, conversation en direct, synthèse des enceintes de Home Assistant, traduction
// par LibreTranslate, STRATA, téléchargement du modèle de sons, l'outil qui confiait du code à Codex, Exa et VirusTotal.
// Chaque fonction coupée répond franchement « pas encore », dans la langue de la personne quand le texte existe.
// Rien de réel n'est appelé : `fetch` est remplacé par un faux qui note chaque adresse demandée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type OdinConfig } from '../src/config.ts';
import { langues } from '../src/langue/tables.ts';

type Voice = OdinConfig['voice'];
const voix = (o: Partial<Voice> = {}): Voice => ({ ...structuredClone(DEFAULT_CONFIG.voice), ...o });
const SON = new Uint8Array(Buffer.from('OggS' + '\0'.repeat(60)));

/** Un faux `fetch` qui note chaque adresse et répond « 200, rien » : un vrai appel se voit dans `adresses`. */
function fauxFetch(): { f: typeof fetch; adresses: string[] } {
  const adresses: string[] = [];
  const f = (async (u: string | URL | Request) => {
    adresses.push(String(u instanceof Request ? u.url : u));
    return new Response(JSON.stringify({ text: 'bonjour', voice_id: 'abc', voices: [], pret: true, jours_max: 3, jours: [], data: { attributes: { last_analysis_stats: {} } }, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, adresses };
}
/** Remplace le `fetch` global le temps d'un essai. */
async function avecFetch<T>(run: (adresses: string[]) => Promise<T>): Promise<T> {
  const avant = globalThis.fetch, { f, adresses } = fauxFetch();
  globalThis.fetch = f;
  try { return await run(adresses); } finally { globalThis.fetch = avant; }
}

test('écoute : ni OpenAI, ni Whisper, ni installation ; « pas encore » dans la langue réglée', async () => {
  const v = await import('../src/voice/voice.ts');
  await avecFetch(async (adresses) => {
    const env = { OPENAI_API_KEY: 'cle-essai-123456' };
    await assert.rejects(v.hear(SON, 'audio/ogg', voix({ localOnly: false, stt: { ...DEFAULT_CONFIG.voice.stt, language: 'en' } }), undefined, env), /my own listening model isn't trained yet/);
    await assert.rejects(v.hear(SON, 'audio/ogg', voix({ localOnly: false }), undefined, env), /mon propre modèle d'écoute n'est pas encore entraîné/);
    assert.equal(v.sttReady(voix({ localOnly: false }), env), false, 'jamais « prête », même avec une clé');
    assert.deepEqual(adresses, [], 'aucune adresse appelée');
  });
});

test('voix : ni ElevenLabs, ni OpenAI, ni Piper ; liste, copie et effacement de voix sans aucun appel', async () => {
  const v = await import('../src/voice/voice.ts');
  await avecFetch(async (adresses) => {
    const env = { ELEVENLABS_API_KEY: 'cle-essai-123456', OPENAI_API_KEY: 'cle-essai-123456' };
    const eleven = voix({ localOnly: false, tts: { ...v.TTS_DEFAULTS.elevenlabs, provider: 'elevenlabs', voiceName: '', voiceId: 'voix1' } });
    const openai = voix({ localOnly: false, tts: { ...v.TTS_DEFAULTS.openai, provider: 'openai', voiceName: '' } });
    await assert.rejects(v.speakAudio('Bonjour', eleven, 'mp3_44100_128', undefined, env), /mon propre modèle de voix n'est pas encore entraîné/);
    await assert.rejects(v.speakAudio('Hello there', openai, 'mp3_44100_128', undefined, env, 'en'), /my own voice model isn't trained yet/);
    assert.equal(v.ttsReady(eleven, env), false);
    assert.deepEqual(await v.listVoices(eleven, env), []);
    assert.match(v.cloneBlocked(eleven, env), /copier une voix/);
    assert.equal('cloneVoice' in v, false, 'plus de copie de voix'); assert.equal('removeVoice' in v, false, 'plus d\'appel pour effacer une voix');
    assert.deepEqual(adresses, [], 'aucune adresse appelée');
  });
});

test('Whisper et Piper installés sur la machine : plus jamais utilisés, rien n\'est téléchargé ni installé', async () => {
  const l = await import('../src/voice/local.ts');
  const home = mkdtempSync(join(tmpdir(), 'odin-retrait-'));
  try {
    const d = join(home, 'voice');
    for (const [f, x] of [['piper/piper', '#!'], ['piper-voices/fr_FR-tom-medium.onnx', 'x'], ['piper-voices/fr_FR-tom-medium.onnx.json', '{}'], ['whisper.cpp/build/bin/whisper-cli', '#!'], ['models/ggml-small.bin', 'x']] as const) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), x); }
    assert.equal('localPiper' in l, false, 'Piper présent sur le disque : ignoré (plus aucun chemin vers lui)');
    assert.equal(l.localWhisper(home), undefined, 'Whisper présent sur le disque : ignoré');
    await avecFetch(async (adresses) => {
      assert.equal('ensurePiperVoice' in l, false, 'plus de téléchargement de voix');
      assert.equal('ensureLocalVoice' in l, false, 'plus d\'installation lancée d\'elle-même');
      assert.equal('installLocalVoice' in l, false, 'plus d\'installation');
      const { ASSISTANT_TOOLS } = await import('../src/tools/assistant.ts');
      assert.equal(ASSISTANT_TOOLS.some((t) => t.name === 'voice_setup'), false, 'plus d\'outil qui installe Whisper et Piper');
      assert.equal('speakLocal' in l, false, 'plus de voix sur la machine');
      await assert.rejects(l.hearLocal(SON, 'auto', home), /pas encore entraîné/);
      assert.deepEqual(adresses, []);
    });
    assert.equal('installScript' in l, false, 'plus de script d\'installation');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('conversation en direct (Orphée) : le service n\'est plus lancé', async () => {
  const { Orphee, SCRIPT_ORPHEE } = await import('../src/voice/orphee.ts');
  assert.ok(SCRIPT_ORPHEE.endsWith('orphee.py'));
  const o = new Orphee();
  try {
    assert.equal(await o.demarrer(), false);
    assert.equal(o.etat, 'absent');
    assert.match(o.raison, /pas encore entraîné/);
    assert.equal(o.port, 0, 'aucun service à l\'écoute');
  } finally { o.arreter(); }
});

test('Home Assistant : plus de synthèse vocale sur les enceintes (ni outil, ni annonce)', async () => {
  const ha = await import('../src/tools/homeassistant.ts');
  assert.equal(ha.HA_TOOLS.some((t) => t.name === 'ha_speak'), false);
  assert.equal('speakPlan' in ha, false);
  const appel = ha.HA_TOOLS.find((t) => t.name === 'ha_call')!;
  assert.match(String(await appel.run({ domain: 'tts', service: 'speak', entity_id: 'tts.piper' }, { homeAssistant: { url: 'http://ha.maison.invalid:8123' } } as never)), /parler sur les enceintes/, 'ni par un appel direct à la box');
  const { bragi } = await import('../src/valhalla/modules/bragi.ts');
  const m = bragi(() => voix());
  const annoncer = m.actions.find((a) => a.id === 'annoncer')!;
  const avant = process.env.HA_TOKEN; process.env.HA_TOKEN = 'jeton-essai';
  try {
    await avecFetch(async (adresses) => {
      const ctx = { settings: { haUrl: 'http://ha.maison.invalid:8123' }, saveSettings() {}, now: () => new Date() } as unknown as Parameters<typeof annoncer.run>[0];
      await assert.rejects(async () => annoncer.run(ctx, { message: 'Bonjour', ou: 'partout' }), /parler sur les enceintes/);
      assert.deepEqual(adresses, []);
    });
  } finally { if (avant === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = avant; }
});

test('Home Assistant : ni annonce d\'un satellite, ni son fabriqué par la synthèse de la box (la box ne reçoit rien)', async () => {
  const { createServer } = await import('node:http');
  const ha = await import('../src/tools/homeassistant.ts');
  const appel = ha.HA_TOOLS.find((t) => t.name === 'ha_call')!;
  const recus: string[] = [];
  const srv = createServer((req, res) => { recus.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const avant = process.env.HA_TOKEN; process.env.HA_TOKEN = 'jeton-essai';
  try {
    const ctx = { homeAssistant: { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}` } } as never;
    for (const [domain, service, data] of [
      ['assist_satellite', 'announce', '{"message":"Bonjour"}'],
      ['assist_satellite', 'start_conversation', '{"start_message":"Bonjour"}'],
      ['media_player', 'play_media', '{"media_content_id":"media-source://tts/google_translate?message=Bonjour","media_content_type":"music"}'],
      ['media_player', 'play_media', '{"media_content_id":"MEDIA-SOURCE://TTS/cloud?message=Bonjour"}'],
      ['media_player', 'play_media', '{"media_content_id":"media-source:\\/\\/tts\\u002fpiper?message=Bonjour"}'],
    ]) assert.match(String(await appel.run({ domain, service, entity_id: 'media_player.salon', data }, ctx)), /parler sur les enceintes/, `${domain}.${service}`);
    assert.deepEqual(recus, [], 'la box ne reçoit aucun de ces appels');
    assert.match(String(await appel.run({ domain: 'light', service: 'turn_on', entity_id: 'light.salon' }, ctx)), /^Fait/, 'le reste de la maison se pilote toujours');
    assert.equal(recus.length, 1);
  } finally { srv.close(); if (avant === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = avant; }
});

test('réveil sur enceinte et Triton : « pas encore » dit franchement, rien d\'enregistré qui ne marcherait pas', async () => {
  const { alarmTool, getAlarm } = await import('../src/home/alarm.ts');
  const m0 = new Map<string, string>(), kv = { getKv: (k: string) => m0.get(k), setKv: (k: string, v: string) => { m0.set(k, v); } }, ctx = { muninn: kv } as never;
  assert.doesNotMatch(alarmTool.description, /enceinte/i, 'l\'outil n\'annonce plus les enceintes');
  const r = String(await alarmTool.run({ action: 'appel', telephone: '+262 639 00 00 00', enceinte: 'media_player.chambre' }, ctx));
  assert.match(r, /parler sur les enceintes/);
  const a = getAlarm(kv) as { phone?: string; speaker?: string };
  assert.equal(a.phone, '+262639000000', 'le reste du réglage est gardé');
  assert.equal(a.speaker, undefined, 'l\'enceinte n\'est pas enregistrée');
  const { bragi } = await import('../src/valhalla/modules/bragi.ts');
  const m = bragi(() => voix()), triton = m.actions.find((x) => x.id === 'gjallarhorn')!;
  const reglages: Record<string, unknown> = {};
  const c = { settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), now: () => new Date() } as unknown as Parameters<typeof triton.run>[0];
  const t = await triton.run(c, { actif: true, ou: 'partout', heures: '7-22' }) as { ok?: boolean; text: string };
  assert.match(t.text, /parler sur les enceintes/);
  assert.notEqual(reglages.horn, true, 'Triton n\'est pas activé');
  assert.equal('horn' in await import('../src/valhalla/modules/bragi.ts'), false, 'plus d\'alerte à voix haute qui échouerait en silence');
});

test('Écho Conversation : ni LibreTranslate, ni voix de service, ni Piper ; la voix du navigateur reste', async () => {
  const c = await import('../src/valhalla/rodd/conversation-moteur.ts');
  await avecFetch(async (adresses) => {
    const reglages = { local: false, moteur: 'hors-ligne' as const, serveur: 'http://127.0.0.1:5000' };
    const r = await c.traduire('Bonjour à tous', 'fr', 'en', reglages);
    assert.equal(r.texte, ''); assert.equal(r.moteur, null); assert.match(r.erreur ?? '', /pas encore entraîné/);
    assert.equal((await c.etatTraduction(reglages)).pret, false);
    const v = voix({ localOnly: false, tts: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voiceId: 'onyx', voiceName: '', apiKeyEnv: 'OPENAI_API_KEY' } });
    const deps = { env: { OPENAI_API_KEY: 'cle-essai-123456' } };
    for (const l of ['fr', 'en', 'ja'] as const) assert.equal(await c.voixPour(l, v, { local: false }, deps), 'navigateur', l);
    const dit = await c.dire('Bonjour', 'fr', v, { local: false, vitesse: 1 }, deps);
    assert.ok('navigateur' in dit, 'le navigateur dit la phrase');
    assert.equal(c.etatEcoute(v, { local: false }, deps).pret, false);
    await assert.rejects(c.ecouterTour({ audio: SON, mime: 'audio/ogg', qui: 'moi', attendu: 'moi', moi: 'fr', lui: 'en' }, v, { local: false }, deps), /pas encore entraîné/);
    assert.deepEqual(adresses, [], 'aucune adresse appelée');
  });
});

test('Zeus : le serveur STRATA n\'est plus interrogé, même réglé', async () => {
  const z = await import('../src/valhalla/zeus/strata.ts');
  const { f, adresses } = fauxFetch();
  const e = await z.etat(f, 'http://192.168.1.50:8000');
  assert.equal(e.ok, false);
  assert.equal('prevision' in z, false, 'plus de demande de prévision');
  assert.deepEqual(adresses, []);
});

test('Syrinx : plus de téléchargement du modèle de sons', async () => {
  const cat = await import('../src/audio/catalogue.ts');
  assert.equal('telechargerModeleSons' in cat, false);
  assert.equal('telechargerSelon' in cat, false);
  const idx = await import('../src/audio/index.ts');
  assert.equal('telechargerModeleSons' in idx, false);
  const { syrinx } = await import('../src/valhalla/syrinx/index.ts');
  assert.equal(syrinx(() => ({})).actions.some((a) => a.id === 'telecharger_modele'), false);
});

test('Codex : l\'outil qui confiait du code à l\'agent d\'OpenAI n\'existe plus', async () => {
  const { FILE_TOOLS } = await import('../src/tools/files.ts');
  assert.equal(FILE_TOOLS.some((t) => t.name === 'codex_run'), false);
  for (const f of ['src/tools/files.ts', 'src/core/agent.ts', 'src/mimir/local.ts']) assert.doesNotMatch(readFileSync(f, 'utf8'), /codex/i, f);
});

test('recherche : Exa n\'est plus interrogé, les autres moteurs restent', async () => {
  const s = await import('../src/tools/search.ts');
  const env = { EXA_API_KEY: 'cle-essai-123456', BRAVE_API_KEY: '' };
  assert.notEqual(s.pickProvider({ env }), 'exa');
  assert.notEqual(s.pickProvider({ env, provider: 'exa' as never }), 'exa', 'un ancien réglage « exa » ne l\'appelle plus');
  assert.equal(s.availableProviders({ env }).includes('exa' as never), false);
  assert.ok(s.availableProviders({ env: { BRAVE_API_KEY: 'x' } }).includes('brave'), 'Brave reste');
  const { ENGINES } = await import('../src/valhalla/modules/volva.ts');
  assert.equal('exa' in ENGINES, false);
});

test('recherche : un ancien réglage « exa » n\'empêche pas d\'enregistrer (il devient « automatique »)', async () => {
  const { applySettings, settingsView } = await import('../src/settings.ts');
  const { odinPaths } = await import('../src/config.ts');
  const home = mkdtempSync(join(tmpdir(), 'odin-retrait-')), paths = odinPaths(home), avant = process.env.BRAVE_API_KEY;
  try {
    const cfg = structuredClone(DEFAULT_CONFIG); (cfg.search as { provider: string }).provider = 'exa';
    assert.equal(settingsView(cfg, false, {}).search.provider, 'auto', 'la page ne reçoit plus « exa »');
    applySettings(paths, cfg, 'search', { provider: 'exa', braveKey: 'cle-brave-essai-1234567' });
    assert.equal(JSON.parse(readFileSync(paths.config, 'utf8')).search.provider, 'auto');
    assert.equal(process.env.BRAVE_API_KEY, 'cle-brave-essai-1234567', 'la nouvelle clé Brave est rangée');
    assert.throws(() => applySettings(paths, cfg, 'search', { provider: 'inconnu' }), /moteur inconnu/, 'un vrai nom inconnu reste refusé');
  } finally { if (avant === undefined) delete process.env.BRAVE_API_KEY; else process.env.BRAVE_API_KEY = avant; rmSync(home, { recursive: true, force: true }); }
});

test('antivirus : VirusTotal n\'est plus interrogé ; MalwareBazaar et CIRCL restent', async () => {
  const intel = await import('../src/valhalla/ullr/intel.ts');
  const { f, adresses } = fauxFetch();
  const cles: Record<string, string> = { VT_API_KEY: 'cle-essai-123456', ABUSE_CH_KEY: 'cle-abuse-123456' };
  const ctx = { fetch: f, now: () => new Date(), key: (k: string) => cles[k] ?? '', url: (_id: string, u: string) => u } as unknown as Parameters<typeof intel.reputation>[1];
  await intel.reputation('a'.repeat(64), ctx);
  assert.equal(adresses.some((u) => /virustotal/i.test(u)), false, 'aucun appel à VirusTotal');
  assert.ok(adresses.some((u) => /abuse\.ch/.test(u)), 'MalwareBazaar reste');
  assert.ok(adresses.some((u) => /circl\.lu/.test(u)), 'CIRCL reste');
  assert.equal(intel.SOURCES.some((x) => x.id === 'virustotal'), false);
});

test('« pas encore » : le texte existe dans chaque langue qu\'Odin parle', async () => {
  const { pasEntraine } = await import('../src/langue/pas-entraine.ts');
  for (const t of langues().values()) {
    if (!t.textes.rienCompris) continue; // une langue qu'Odin ne parle pas encore
    const x = pasEntraine('ecouter', t.code);
    assert.ok(x && !/\{\w+\}/.test(x), `${t.code} : ${x}`);
    assert.equal(typeof t.textes.modelePasEntraine, 'string', `${t.code} : texte modelePasEntraine`);
  }
  // Une langue sans le texte : l'anglais d'abord, puis le français (jamais seulement supposé en français).
  assert.match(pasEntraine('parler', 'xx'), /my own voice model/);
  assert.match(pasEntraine('parler'), /mon propre modèle de voix/);
});
