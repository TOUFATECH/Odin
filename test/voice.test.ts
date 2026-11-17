import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Gateway } from '../src/bifrost/gateway.ts';
import { TelegramChannel } from '../src/bifrost/channels/telegram.ts';
import { DEFAULT_CONFIG, type OdinConfig } from '../src/config.ts';
import { forSpeech, speak, speakAudio, sttReady, transcribe, ttsIsLocal, ttsReady } from '../src/voice/voice.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { call, makeOdin } from './helpers.ts';

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

// Depuis le 17/11/2026, Odin n'utilise aucun modèle qui ne soit pas le sien : Whisper, ElevenLabs, OpenAI et Piper ne
// sont plus appelés, même avec une adresse et une clé. Ces essais le vérifient avec de faux services qui notent tout.
const voiceCfg = (stt: string, tts: string, voiceId = 'voixTest123'): OdinConfig['voice'] => ({
  ...DEFAULT_CONFIG.voice, localOnly: false,
  enabled: true, speakReplies: false, voiceReplies: true,
  tts: { provider: 'elevenlabs', voiceId, voiceName: 'Test', model: 'eleven_multilingual_v2', baseUrl: tts, apiKeyEnv: 'ELEVEN_TEST' },
  stt: { provider: 'whisper', model: 'whisper-1', baseUrl: `${stt}/v1`, apiKeyEnv: 'OPENAI_TEST', language: 'fr' },
});
const env = { ELEVEN_TEST: 'cle-eleven', OPENAI_TEST: 'cle-openai' };

test('Whisper, ElevenLabs, serveur Piper, OpenAI : plus aucun appel ; « pas encore » à la place', async () => {
  const m = await mock(() => ({ body: JSON.stringify({ text: 'bonjour', voice_id: 'clone42' }) }));
  try {
    const v = voiceCfg(m.url, m.url);
    await assert.rejects(transcribe(new Uint8Array([1, 2, 3]), 'audio/webm', v, undefined, env), /mon propre modèle d'écoute n'est pas encore entraîné/);
    await assert.rejects(transcribe(new Uint8Array(), 'audio/webm', v, undefined, env), /vide/);
    await assert.rejects(speak('Bonjour', v, 'opus_48000_64', undefined, env), /mon propre modèle de voix n'est pas encore entraîné/);
    const piper = { ...v, tts: { provider: 'piper' as const, voiceId: '', voiceName: '', model: '', baseUrl: m.url, apiKeyEnv: '' } };
    const oa = { ...v, tts: { provider: 'openai' as const, voiceId: 'nova', voiceName: 'nova', model: 'tts-1', baseUrl: `${m.url}/v1`, apiKeyEnv: 'ABSENTE' } };
    for (const w of [v, piper, oa]) {
      assert.equal(sttReady(w, env), false); assert.equal(ttsReady(w, env), false);
      await assert.rejects(speakAudio('Salut', w, 'mp3_44100_128', undefined, env), /pas encore entraîné/);
    }
    assert.equal(ttsIsLocal(piper), true, 'un ancien réglage local se lit toujours comme local');
    assert.equal(m.hits.length, 0, 'aucune demande n\'est partie');
  } finally { m.close(); }
});

test('texte préparé pour être dit : nettoyé (outil sans modèle, gardé pour la future voix d\'Odin)', () => {
  assert.equal(forSpeech('**Voilà** : `npm test` passe. Détails sur https://exemple.fr\n\n⚡ Odin Breaker'), 'Voilà : npm test passe. Détails sur le lien affiché. Odin Breaker', 'une fin de ligne devient une pause');
  assert.match(forSpeech('```js\nx()\n```'), /code affiché/);
});

test('interface web : micro, lecture, liste des voix et copie répondent « pas encore », sans aucun appel', async () => {
  const m = await mock(() => ({ body: JSON.stringify({ text: 'bonjour Odin', voice_id: 'clonee99', voices: [{ voice_id: 'v1', name: 'Rachel', category: 'premade' }] }) }));
  process.env.ELEVEN_TEST = 'cle-eleven'; process.env.OPENAI_TEST = 'cle-openai';
  const o = makeOdin([], { config: (c) => ({ ...c, voice: voiceCfg(m.url, m.url) }) });
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: '127.0.0.1', token }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`, h = { authorization: `Bearer ${token}`, 'x-odin': '1' };
  try {
    const t = await (await fetch(`${B}/api/voice/transcribe`, { method: 'POST', headers: { ...h, 'content-type': 'audio/webm' }, body: new Uint8Array([1, 2, 3]) })).json() as { ok: boolean; error: string };
    assert.equal(t.ok, false); assert.match(t.error, /pas encore entraîné/);
    const s = await (await fetch(`${B}/api/voice/speak`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Salut' }) })).json() as { ok: boolean; error: string };
    assert.equal(s.ok, false); assert.match(s.error, /pas encore entraîné/);
    const list = await (await fetch(`${B}/api/voice/voices`, { headers: h })).json() as { voices: unknown[] };
    assert.deepEqual(list.voices, []);
    const copie = await (await fetch(`${B}/api/voice/clone?name=Moi&consent=1`, { method: 'POST', headers: { ...h, 'content-type': 'audio/mpeg' }, body: new Uint8Array([1]) })).json() as { ok: boolean; error: string };
    assert.equal(copie.ok, false); assert.match(copie.error, /copier une voix/);
    assert.equal(o.cfg.voice.tts.voiceId, 'voixTest123', 'aucune voix copiée');
    const page = await fetch(`${B}/`, { headers: { cookie: `odin_token=${token}` } });
    assert.match(page.headers.get('content-security-policy')!, /media-src 'self' blob:/);
    assert.equal(m.hits.length, 0, 'aucune demande n\'est partie');
  } finally { await gw.stop(); o.cleanup(); m.close(); delete process.env.ELEVEN_TEST; delete process.env.OPENAI_TEST; }
});

test('Telegram : réponse écrite à une note vocale (texte fourni par le canal), sans note vocale en retour ; fichier déposé dans inbox', async () => {
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
    const sent = (t: string) => tg.hits.some((x) => x.url.endsWith('/sendMessage') && JSON.parse(x.body.toString()).text === t);
    while (Date.now() < until && !(sent('La lumière est allumée.') && sent('Facture rangée.'))) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 300));
    const msgs = tg.hits.filter((x) => x.url.endsWith('/sendMessage')).map((x) => JSON.parse(x.body.toString()).text as string);
    assert.ok(msgs.some((t) => t === 'La lumière est allumée.'), 'texte seul, sans émoji');
    assert.match(o.provider.calls[0].messages.at(-1)!.content, /allume la lumière/);
    assert.equal(tg.hits.some((x) => x.url.endsWith('/sendVoice')), false, 'aucune note vocale');
    assert.equal(eleven.hits.length, 0, 'ElevenLabs n\'est pas appelé');
    const fileMsg = o.provider.calls[1].messages.at(-1)!.content;
    assert.match(fileMsg, /Range ça[\s\S]*\[Document joint : inbox\/.*facture mars\.pdf \(application\/pdf[\s\S]*doc_read/);
  } finally { await gw.stop(); o.cleanup(); tg.close(); eleven.close(); delete process.env.ELEVEN_TEST; }
});

test('Telegram : « écrit… » pendant le travail, mise en forme propre, visage d\'Odin en émoji à la fin', async () => {
  const { tgHtml } = await import('../src/bifrost/channels/telegram.ts');
  assert.equal(tgHtml('Un appareil : **192.168.1.130** et `ssh` <ok>'), 'Un appareil : <b>192.168.1.130</b> et <code>ssh</code> &lt;ok&gt;');
  assert.equal(tgHtml('## Titre\n- un\n- deux\n[site](https://x.fr)'), '<b>Titre</b>\n• un\n• deux\n<a href="https://x.fr">site</a>');
  assert.equal(tgHtml('```bash\nls *.txt\n```'), '<pre>ls *.txt</pre>');
  // Le message vu en vrai dans Telegram : accents graves et gras ne doivent plus jamais apparaître bruts.
  assert.equal(tgHtml('Odin tourne sous le compte `odin`, `NoNewPrivs` est activé. **Je n’ai pas les droits.**'), 'Odin tourne sous le compte <code>odin</code>, <code>NoNewPrivs</code> est activé. <b>Je n’ai pas les droits.</b>');
  // Tableau → colonnes alignées ; citation ; cases à cocher ; italique souligné ; gras italique.
  assert.equal(tgHtml('| Appli | État |\n|---|---|\n| Ullr | **ok** |\n| Idunn | à voir |'), '<pre>Appli  État\n─────  ──────\nUllr   ok\nIdunn  à voir</pre>');
  assert.equal(tgHtml('> ligne une\n> ligne deux\n\nsuite'), '<blockquote>ligne une\nligne deux</blockquote>\n\nsuite');
  assert.equal(tgHtml('- [x] fait\n- [ ] à faire\n- puce'), '☑ fait\n☐ à faire\n• puce');
  assert.equal(tgHtml('un _mot_ et ***fort***, pas dans nom_de_fichier_x'), 'un <i>mot</i> et <b><i>fort</i></b>, pas dans nom_de_fichier_x');
  // Si Telegram refuse la mise en forme : texte simple, sans aucune marque.
  const { tgPlain } = await import('../src/bifrost/channels/telegram.ts');
  assert.equal(tgPlain('## Titre\n**gras** et `code`, [site](https://x.fr)\n- [ ] à faire\n> cité'), 'Titre\ngras et code, site (https://x.fr)\n☐ à faire\ncité');
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
    assert.equal(sent.text, 'C\'est <b>fait</b>.', 'texte mis en forme, sans émoji');
    const ch = new TelegramChannel('T', tg.url, { home: o.paths.home });
    premium = false;
    await ch.send('42', 'Ok', { mood: 'joie' });
    // pas de pack chargé pour ce canal neuf (pas démarré) : émoji classique ; et un refus Premium retombe aussi sur l'émoji classique
    assert.equal(JSON.parse(tg.hits.filter((x) => x.url.endsWith('/sendMessage')).at(-1)!.body.toString()).text, 'Ok 😊');
  } finally { await gw.stop(); o.cleanup(); tg.close(); }
});

test('Telegram : message de progression comme Hermes (compétence, terminal, script, ×n), mis à jour puis clos', async () => {
  const { progressLine } = await import('../src/bifrost/channels/telegram.ts');
  assert.equal(progressLine('skill_read', { name: 'proxmox-maj' }).html, '📚 Compétence <b>proxmox-maj</b>');
  assert.equal(progressLine('shell', { command: 'pct exec 7800 -- bash -lc "apt update"' }).html, '💻 terminal\n<pre>pct exec 7800 -- bash -lc "apt update"</pre>');
  assert.equal(progressLine('script_run', { name: 'maj-ct', args: '7800', where: 'pct:7800' }).html, '🐍 script <b>maj-ct</b> 7800 · pct:7800');
  let served = false;
  const tg = await mock((h) => {
    if (h.url.endsWith('/getMe')) return { body: JSON.stringify({ ok: true, result: { username: 'odin_bot' } }) };
    if (h.url.includes('/getUpdates')) { if (served) return { body: JSON.stringify({ ok: true, result: [] }) }; served = true; return { body: JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 42 }, from: { id: 42 }, text: 'liste les fichiers' } }] }) }; }
    if (h.url.endsWith('/sendMessage')) return { body: JSON.stringify({ ok: true, result: { message_id: 77 } }) };
    return { body: JSON.stringify({ ok: true, result: { stickers: [] } }) };
  });
  const o = makeOdin([call('skill_read', { name: 'inexistante' }), call('fs_list', { path: '.' }), call('fs_list', { path: '.' }), { text: 'Voilà.' }], { approve: true });
  const gw = new Gateway(o, { owners: { telegram: ['42'] } });
  gw.add(new TelegramChannel('T', tg.url, { home: o.paths.home }));
  await gw.start();
  try {
    const until = Date.now() + 6000;
    while (Date.now() < until && !tg.hits.some((x) => x.url.endsWith('/sendMessage') && /Voilà/.test(x.body.toString()))) await new Promise((r) => setTimeout(r, 50));
    const sends = tg.hits.filter((x) => x.url.endsWith('/sendMessage') || x.url.endsWith('/editMessageText')).map((x) => ({ m: x.url.split('/').at(-1), b: JSON.parse(x.body.toString()) }));
    const prog = sends.filter((x) => /Compétence/.test(x.b.text));
    assert.ok(prog.length >= 1, 'message de progression envoyé');
    assert.equal(prog[0].b.disable_notification ?? prog.at(-1)!.b.disable_notification ?? true, true);
    assert.match(prog.at(-1)!.b.text, /📚 Compétence <b>inexistante<\/b>\n📄 \. \(×2\)/);
    assert.ok(sends.findIndex((x) => /Voilà/.test(x.b.text)) > sends.indexOf(prog.at(-1)!), 'la réponse arrive après la progression');
  } finally { await gw.stop(); o.cleanup(); tg.close(); }
});

test('vocal dans une autre langue : plus d\'écoute (« pas encore ») ; la langue d\'un texte écrit se devine toujours sans modèle', async () => {
  const { hear, spokenLanguage, guessLang } = await import('../src/voice/voice.ts');
  const m = await mock(() => ({ body: JSON.stringify({ text: 'Turn on the living room light', language: 'english' }) }));
  try {
    const v = { ...voiceCfg(m.url, m.url), enabled: false, stt: { ...voiceCfg(m.url, m.url).stt, language: 'en' } };
    await assert.rejects(hear(new Uint8Array([1, 2, 3]), 'audio/ogg', v, undefined, env), /my own listening model isn't trained yet/);
    assert.equal(spokenLanguage('Turn on the living room light'), undefined);
    assert.equal(m.hits.length, 0, 'aucune demande n\'est partie');
  } finally { m.close(); }
  assert.equal(guessLang('Hello, can you tell me what is the weather like today?'), 'en');
  assert.equal(guessLang('Bonjour, est-ce que tu peux allumer la lumière ?'), 'fr');
  assert.equal(guessLang('Habari, wewe ni nani na unaweza kunisaidia sana'), 'sw');
});
