import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Gateway } from '../src/bifrost/gateway.ts';
import { TelegramChannel } from '../src/bifrost/channels/telegram.ts';
import type { OdinConfig } from '../src/config.ts';
import { cloneVoice, forSpeech, speak, speakAudio, sttReady, transcribe, ttsIsLocal, ttsReady } from '../src/voice/voice.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

type Hit = { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer };
async function mock(handler: (h: Hit) => { status?: number; type?: string; body: string | Buffer }): Promise<{ url: string; hits: Hit[]; close: () => void }> {
  const hits: Hit[] = [];
  const srv: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const h = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(parts) };
      hits.push(h);
      const r = handler(h);
      res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'application/json' });
      res.end(r.body);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, hits, close: () => srv.close() };
}

const voiceCfg = (stt: string, tts: string, voiceId = 'voixTest123'): OdinConfig['voice'] => ({
  enabled: true, speakReplies: false, voiceReplies: true,
  tts: { provider: 'elevenlabs', voiceId, voiceName: 'Test', model: 'eleven_multilingual_v2', baseUrl: tts, apiKeyEnv: 'ELEVEN_TEST' },
  stt: { provider: 'whisper', model: 'whisper-1', baseUrl: `${stt}/v1`, apiKeyEnv: 'OPENAI_TEST', language: 'fr' },
});
const env = { ELEVEN_TEST: 'cle-eleven', OPENAI_TEST: 'cle-openai' };

test('Whisper : audio envoyé en multipart avec modèle et langue, texte renvoyé', async () => {
  const m = await mock(() => ({ body: JSON.stringify({ text: ' Allume la lumière du salon. ' }) }));
  try {
    const v = voiceCfg(m.url, m.url);
    const text = await transcribe(new Uint8Array([1, 2, 3]), 'audio/webm', v, undefined, env);
    assert.equal(text, 'Allume la lumière du salon.');
    const h = m.hits[0];
    assert.equal(h.url, '/v1/audio/transcriptions');
    assert.equal(h.headers.authorization, 'Bearer cle-openai');
    const body = h.body.toString('latin1');
    assert.match(body, /name="model"\r\n\r\nwhisper-1/);
    assert.match(body, /name="language"\r\n\r\nfr/);
    assert.match(body, /filename="parole\.webm"/);
    assert.equal(sttReady(v, env), true);
    assert.equal(sttReady({ ...v, stt: { ...v.stt, baseUrl: 'https://api.openai.com/v1' } }, {}), false, 'service distant sans clé : pas prêt');
    assert.equal(sttReady({ ...v, stt: { ...v.stt, baseUrl: 'http://localhost:8000/v1' } }, {}), true, 'serveur Whisper local : sans clé');
    await assert.rejects(transcribe(new Uint8Array(), 'audio/webm', v, undefined, env), /vide/);
  } finally { m.close(); }
});

test('ElevenLabs : texte nettoyé pour la parole, clé envoyée, audio renvoyé', async () => {
  const m = await mock((h) => (h.url.startsWith('/v1/text-to-speech/') ? { type: 'audio/mpeg', body: Buffer.from('ID3fakeaudio') } : { status: 404, body: '{}' }));
  try {
    const v = voiceCfg(m.url, m.url);
    const audio = await speak('**Voilà** : `npm test` passe. Détails sur https://exemple.fr\n\n⚡ Odin Breaker', v, 'opus_48000_64', undefined, env);
    assert.equal(Buffer.from(audio).toString(), 'ID3fakeaudio');
    const h = m.hits[0];
    assert.equal(h.url, '/v1/text-to-speech/voixTest123?output_format=opus_48000_64');
    assert.equal(h.headers['xi-api-key'], 'cle-eleven');
    const sent = JSON.parse(h.body.toString()) as { text: string; model_id: string };
    assert.equal(sent.model_id, 'eleven_multilingual_v2');
    assert.equal(sent.text, 'Voilà : npm test passe. Détails sur le lien affiché Odin Breaker');
    assert.equal(ttsReady(v, env), true);
    assert.equal(ttsReady({ ...v, tts: { ...v.tts, voiceId: '' } }, env), false);
    assert.match(forSpeech('```js\nx()\n```'), /code affiché/);
  } finally { m.close(); }
});

test('copie de voix : jamais sans consentement, identifiant renvoyé sinon', async () => {
  const m = await mock(() => ({ body: JSON.stringify({ voice_id: 'clone42' }) }));
  try {
    const v = voiceCfg(m.url, m.url);
    const sample = [{ data: new Uint8Array([9, 9]), mime: 'audio/mpeg', filename: 'moi.mp3' }];
    await assert.rejects(cloneVoice('Ma voix', sample, false, v, env), /accord/);
    assert.equal(m.hits.length, 0, 'rien n\'est envoyé sans consentement');
    assert.equal(await cloneVoice('Ma voix', sample, true, v, env), 'clone42');
    assert.equal(m.hits[0].url, '/v1/voices/add');
    assert.match(m.hits[0].body.toString('latin1'), /name="name"\r\n\r\nMa voix/);
  } finally { m.close(); }
});

test('interface web : micro → Whisper, lecture → ElevenLabs, copie enregistrée dans la config', async () => {
  const m = await mock((h) => h.url.includes('transcriptions') ? { body: JSON.stringify({ text: 'bonjour Odin' }) }
    : h.url.includes('text-to-speech') ? { type: 'audio/mpeg', body: Buffer.from('MP3') }
    : h.url.includes('voices/add') ? { body: JSON.stringify({ voice_id: 'clonee99' }) }
    : { body: JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel', category: 'premade' }] }) });
  process.env.ELEVEN_TEST = 'cle-eleven'; process.env.OPENAI_TEST = 'cle-openai';
  const o = makeOdin([], { config: (c) => ({ ...c, voice: voiceCfg(m.url, m.url) }) });
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: '127.0.0.1', token }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`, h = { authorization: `Bearer ${token}`, 'x-odin': '1' };
  try {
    const t = await (await fetch(`${B}/api/voice/transcribe`, { method: 'POST', headers: { ...h, 'content-type': 'audio/webm' }, body: new Uint8Array([1, 2, 3]) })).json() as { ok: boolean; text: string };
    assert.deepEqual(t, { ok: true, text: 'bonjour Odin' });
    const s = await fetch(`${B}/api/voice/speak`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Salut' }) });
    assert.equal(s.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await s.arrayBuffer()).toString(), 'MP3');
    const list = await (await fetch(`${B}/api/voice/voices`, { headers: h })).json() as { voices: Array<{ name: string }> };
    assert.equal(list.voices[0].name, 'Rachel');
    const refused = await (await fetch(`${B}/api/voice/clone?name=Moi`, { method: 'POST', headers: { ...h, 'content-type': 'audio/mpeg' }, body: new Uint8Array([1]) })).json() as { ok: boolean; error: string };
    assert.match(refused.error, /accord/);
    const ok = await (await fetch(`${B}/api/voice/clone?name=Moi&consent=1`, { method: 'POST', headers: { ...h, 'content-type': 'audio/mpeg' }, body: new Uint8Array([1]) })).json() as { ok: boolean };
    assert.equal(ok.ok, true);
    assert.equal(o.cfg.voice.tts.voiceId, 'clonee99');
    const page = await fetch(`${B}/`, { headers: { cookie: `odin_token=${token}` } });
    assert.match(page.headers.get('content-security-policy')!, /media-src 'self' blob:/);
  } finally { await gw.stop(); o.cleanup(); m.close(); delete process.env.ELEVEN_TEST; delete process.env.OPENAI_TEST; }
});

test('Telegram : note vocale transcrite, réponse écrite + note vocale ; fichier déposé dans inbox', async () => {
  let served = false;
  const tg = await mock((h) => {
    if (h.url.endsWith('/getMe')) return { body: JSON.stringify({ ok: true, result: { username: 'odin_bot' } }) };
    if (h.url.includes('/getUpdates')) {
      if (served) return { body: JSON.stringify({ ok: true, result: [] }) };
      served = true;
      return { body: JSON.stringify({ ok: true, result: [
        { update_id: 1, message: { chat: { id: 42 }, from: { id: 42, first_name: 'Moi' }, voice: { file_id: 'VOX', mime_type: 'audio/ogg' } } },
        { update_id: 2, message: { chat: { id: 42 }, from: { id: 42 }, caption: 'Range ça', document: { file_id: 'DOC', file_name: 'facture mars.pdf', mime_type: 'application/pdf' } } },
      ] }) };
    }
    if (h.url.includes('/getFile')) return { body: JSON.stringify({ ok: true, result: { file_path: h.url.includes('VOX') ? 'voice/v.oga' : 'documents/f.pdf' } }) };
    if (h.url.includes('/file/bot')) return { type: 'application/octet-stream', body: Buffer.from('%PDF-1.4 ou audio') };
    return { body: JSON.stringify({ ok: true }) };
  });
  const eleven = await mock(() => ({ type: 'audio/ogg', body: Buffer.from('OggS') }));
  process.env.ELEVEN_TEST = 'cle-eleven';
  const o = makeOdin([{ text: 'La lumière est allumée.' }, { text: 'Facture rangée.' }], { config: (c) => ({ ...c, voice: voiceCfg('http://localhost:1', eleven.url) }) });
  const gw = new Gateway(o, { owners: { telegram: ['42'] } });
  gw.add(new TelegramChannel('T', tg.url, { transcribe: async () => 'allume la lumière', inbox: `${o.paths.workspace}/inbox` }));
  await gw.start();
  try {
    const until = Date.now() + 5000;
    while (Date.now() < until && tg.hits.filter((x) => x.url.endsWith('/sendMessage')).length < 2) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    const msgs = tg.hits.filter((x) => x.url.endsWith('/sendMessage')).map((x) => JSON.parse(x.body.toString()).text as string);
    assert.ok(msgs.some((t) => /^La lumière est allumée\. \S+$/u.test(t)), 'réaction à la fin, même taille que le texte');
    assert.match(o.provider.calls[0].messages.at(-1)!.content, /allume la lumière/);
    assert.ok(tg.hits.some((x) => x.url.endsWith('/sendVoice')), 'réponse vocale envoyée');
    const fileMsg = o.provider.calls[1].messages.at(-1)!.content;
    assert.match(fileMsg, /Range ça[\s\S]*\[Fichier reçu : inbox\/.*facture mars\.pdf \(application\/pdf/);
  } finally { await gw.stop(); o.cleanup(); tg.close(); eleven.close(); delete process.env.ELEVEN_TEST; }
});

test('voix locale : Piper (WAV, sans clé) et serveur compatible OpenAI, tout reste sur la machine', async () => {
  const m = await mock((h) => (h.url === '/' && h.method === 'POST' ? { type: 'audio/wav', body: Buffer.from('RIFFfakewav') } : h.url === '/v1/audio/speech' ? { type: 'audio/mpeg', body: Buffer.from('ID3local') } : { status: 404, body: '{}' }));
  try {
    const base = voiceCfg(m.url, m.url);
    const piper = { ...base, tts: { provider: 'piper' as const, voiceId: '', voiceName: '', model: '', baseUrl: m.url, apiKeyEnv: '' } };
    assert.equal(ttsReady(piper, {}), true, 'Piper : aucune clé, aucune voix à choisir');
    const a = await speakAudio('Bonjour **toi**', piper, 'mp3_44100_128', undefined, {});
    assert.equal(a.mime, 'audio/wav');
    assert.equal(Buffer.from(a.data).toString(), 'RIFFfakewav');
    assert.deepEqual(JSON.parse(m.hits[0].body.toString()), { text: 'Bonjour toi' });
    assert.equal(ttsIsLocal(piper), true);

    const oa = { ...base, tts: { provider: 'openai' as const, voiceId: 'nova', voiceName: 'nova', model: 'tts-1', baseUrl: `${m.url}/v1`, apiKeyEnv: 'ABSENTE' } };
    assert.equal(ttsReady(oa, {}), true, 'serveur local compatible OpenAI : sans clé');
    assert.equal(ttsReady({ ...oa, tts: { ...oa.tts, baseUrl: 'https://api.openai.com/v1' } }, {}), false, 'OpenAI en ligne : clé requise');
    const b = await speakAudio('Salut', oa, 'opus_48000_64', undefined, {});
    assert.equal(b.mime, 'audio/ogg');
    const sent = JSON.parse(m.hits[1].body.toString());
    assert.equal(sent.voice, 'nova'); assert.equal(sent.response_format, 'opus'); assert.equal(sent.input, 'Salut');
    assert.equal(m.hits[1].headers.authorization, undefined, 'pas de clé envoyée quand il n\'y en a pas');
  } finally { m.close(); }
});

test('Telegram : « écrit… » pendant le travail, mise en forme propre, visage d\'Odin en émoji à la fin', async () => {
  const { tgHtml } = await import('../src/bifrost/channels/telegram.ts');
  assert.equal(tgHtml('Un appareil : **192.168.1.130** et `ssh` <ok>'), 'Un appareil : <b>192.168.1.130</b> et <code>ssh</code> &lt;ok&gt;');
  assert.equal(tgHtml('## Titre\n- un\n- deux\n[site](https://x.fr)'), '<b>Titre</b>\n• un\n• deux\n<a href="https://x.fr">site</a>');
  assert.equal(tgHtml('```bash\nls *.txt\n```'), '<pre>ls *.txt</pre>');
  let made = false, premium = true, served = false;
  const tg = await mock((h) => {
    if (h.url.endsWith('/getMe')) return { body: JSON.stringify({ ok: true, result: { username: 'odin_bot' } }) };
    if (h.url.includes('/getUpdates')) {
      if (served) return { body: JSON.stringify({ ok: true, result: [] }) };
      served = true;
      return { body: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 42 }, from: { id: 42 }, text: 'salut' } }] }) };
    }
    if (h.url.endsWith('/getStickerSet')) return { body: JSON.stringify(made ? { ok: true, result: { stickers: Array.from({ length: 30 }, (_, k) => ({ custom_emoji_id: `E${k}` })) } } : { ok: false, description: 'STICKERSET_INVALID' }) };
    if (h.url.endsWith('/createNewStickerSet')) { made = true; return { body: JSON.stringify({ ok: true, result: true }) }; }
    if (h.url.endsWith('/sendMessage')) { const b = JSON.parse(h.body.toString()); return { body: JSON.stringify(b.text.includes('tg-emoji') && !premium ? { ok: false, description: 'Bad Request' } : { ok: true }) }; }
    return { body: JSON.stringify({ ok: true }) };
  });
  const o = makeOdin([{ text: '[humeur:joie] C\'est **fait**.' }]);
  const gw = new Gateway(o, { owners: { telegram: ['42'] } });
  gw.add(new TelegramChannel('T', tg.url, { home: o.paths.home, owner: '42' }));
  await gw.start();
  try {
    const until = Date.now() + 5000;
    while (Date.now() < until && !tg.hits.some((x) => x.url.endsWith('/sendMessage'))) await new Promise((r) => setTimeout(r, 50));
    assert.ok(tg.hits.some((x) => x.url.endsWith('/sendChatAction') && JSON.parse(x.body.toString()).action === 'typing'), '« écrit… »');
    const sent = JSON.parse(tg.hits.find((x) => x.url.endsWith('/sendMessage'))!.body.toString());
    assert.equal(sent.parse_mode, 'HTML');
    assert.match(sent.text, /^C'est <b>fait<\/b>\. <tg-emoji emoji-id="E1">😊<\/tg-emoji>$/, 'visage « joie » (2e humeur du pack)');
    const ch = new TelegramChannel('T', tg.url, { home: o.paths.home });
    premium = false;
    await ch.send('42', 'Ok', { mood: 'joie' });
    // pas de pack chargé pour ce canal neuf (pas démarré) : émoji classique ; et un refus Premium retombe aussi sur l'émoji classique
    assert.equal(JSON.parse(tg.hits.filter((x) => x.url.endsWith('/sendMessage')).at(-1)!.body.toString()).text, 'Ok 😊');
  } finally { await gw.stop(); o.cleanup(); tg.close(); }
});
