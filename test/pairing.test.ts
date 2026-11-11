import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { buttonsFor, buttonText } from '../src/bifrost/channel.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { Pairing, deviceName } from '../src/web/pairing.ts';
import { makeOdin } from './helpers.ts';

let next = 47_800 + Math.floor(Math.random() * 500);
const port = () => next++;

test('demande d\'accès : code, décision, un seul retrait, limites', () => {
  const p = new Pairing(), t0 = 1_000_000;
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1'), 'Safari sur iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Chrome sur Windows');
  const r = p.request('x Android Chrome/1', '192.168.1.5', t0)!;
  assert.match(r.code, /^\d{6}$/);
  assert.equal(p.collect(r.secret, t0), 'attente');
  assert.equal(p.collect('faux', t0), 'inconnue');
  assert.equal(p.decide(r.id, true, t0)!.state, 'ok');
  assert.equal(p.decide(r.id, false, t0)!.state, 'ok', 'une décision ne se change pas');
  assert.equal(p.collect(r.secret, t0), 'ok');
  assert.equal(p.collect(r.secret, t0), 'inconnue', 'l\'accès ne se retire qu\'une fois');
  p.request('', '10.0.0.9', t0); p.request('', '10.0.0.9', t0);
  assert.ok(p.request('', '10.0.0.9', t0));
  assert.equal(p.request('', '10.0.0.9', t0), undefined, '3 demandes par appareil et par 10 min');
  const late = p.request('', '10.0.0.10', t0)!;
  assert.equal(p.collect(late.secret, t0 + 11 * 60_000), 'inconnue', 'expire en 10 min');
  assert.deepEqual(buttonsFor({ pair: { id: 'abcdef012345' } }).map((b) => b.id), ['pa:ok:abcdef012345', 'pa:no:abcdef012345']);
  assert.equal(buttonText('pa:ok:abcdef012345'), '/acces ok abcdef012345');
});

test('demande d\'accès de bout en bout : Telegram « Autoriser » → le navigateur entre sans jeton', async () => {
  const o = makeOdin([]);
  const p = port(), token = ensureWebToken(o.paths);
  const sent: Array<{ text: string; opts?: unknown }> = [];
  const tg: Channel = { name: 'telegram', interactive: true, defaultPeer: '42', start: async () => {}, stop: async () => {}, send: async (_p, text, opts) => { sent.push({ text, opts }); } };
  const gw = new Gateway(o, { owners: { telegram: ['42'], web: ['*'] } });
  const web = new WebChannel(o, { scanNetwork: async () => undefined, pairAsk: (r) => gw.pairAsk(r) }, { port: p, host: '127.0.0.1', token, scryptN: 1024 });
  gw.add(tg).add(web);
  await gw.start();
  const B = `http://127.0.0.1:${p}`, post = (path: string, h: Record<string, string> = {}) => fetch(B + path, { method: 'POST', headers: { 'x-odin': '1', ...h } });
  try {
    assert.equal((await fetch(B + '/api/pair', { method: 'POST' })).status, 403, 'sans en-tête x-odin : refusé');
    const r = await (await post('/api/pair', { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120' })).json() as { ok: boolean; secret: string; code: string };
    assert.ok(r.ok);
    const msg = sent.find((x) => /demande l'accès/.test(x.text))!;
    assert.match(msg.text, new RegExp(`Chrome sur Android[\\s\\S]*${r.code}`));
    const id = (msg.opts as { pair: { id: string } }).pair.id;
    // Pas encore autorisé : pas de cookie.
    const wait = await post('/api/pair/status', { 'x-pair': r.secret });
    assert.equal((await wait.json() as { state: string }).state, 'attente');
    assert.equal(wait.headers.get('set-cookie'), null);
    // Quelqu'un d'autre que le propriétaire ne peut pas autoriser.
    await gw.handle({ channel: 'telegram', peer: '666', name: 'intrus', text: `/acces ok ${id}` });
    assert.equal((await (await post('/api/pair/status', { 'x-pair': r.secret })).json() as { state: string }).state, 'attente');
    // Le propriétaire touche « Autoriser ».
    await gw.handle({ channel: 'telegram', peer: '42', name: 'moi', text: buttonText(`pa:ok:${id}`)! });
    assert.match(sent.at(-1)!.text, /a maintenant accès/);
    const done = await post('/api/pair/status', { 'x-pair': r.secret });
    assert.equal((await done.json() as { state: string }).state, 'ok');
    const cookie = done.headers.get('set-cookie')!;
    assert.match(cookie, /odin_token=[a-f0-9]+; HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(B + '/api/state', { headers: { cookie: cookie.split(';')[0] } })).status, 401, 'autorisé à créer le compte, pas encore connecté');
    // Refus depuis un écran déjà connecté.
    const r2 = await (await post('/api/pair')).json() as { secret: string };
    const st = await (await fetch(B + '/api/state', { headers: { authorization: `Bearer ${token}` } })).json() as { pairRequests: Array<{ id: string }> };
    assert.equal(st.pairRequests.length, 1);
    await fetch(B + '/api/action', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'pair_decide', id: st.pairRequests[0].id, ok: false }) });
    const no = await post('/api/pair/status', { 'x-pair': r2.secret });
    assert.equal((await no.json() as { state: string }).state, 'refus');
    assert.equal(no.headers.get('set-cookie'), null);
    // L'appareil autorisé crée le compte : il est alors connecté, et la demande d'accès ne sert plus.
    const made = await fetch(B + '/api/account/create', { method: 'POST', headers: { cookie: cookie.split(';')[0], 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ prenom: 'Awa', nom: 'Saïd', email: 'awa@exemple.yt', password: 'un-cheval-bleu-traverse-mamoudzou' }) });
    assert.equal(made.status, 200);
    const session = made.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!.split(';')[0];
    assert.equal((await fetch(B + '/api/state', { headers: { cookie: session } })).status, 200, 'le navigateur est connecté');
    assert.equal((await post('/api/pair')).status, 403, 'compte créé : on se connecte avec ses identifiants');
  } finally { await gw.stop(); o.cleanup(); }
});

test('réinstallation sans modèle ni messagerie : la première connexion reste possible malgré l\'ancienne trace', async () => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const o = makeOdin([]);
  (o as unknown as { demo: boolean }).demo = true;
  writeFileSync(join(o.paths.home, 'web-claimed'), 'ancienne installation\n');
  const p = port(), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, scryptN: 1024 }));
  await gw.start();
  try {
    const page = await (await fetch(`http://127.0.0.1:${p}/`)).text();
    assert.match(page, /const ACCOUNT = false, SETUP = true/, 'création du compte proposée');
    const proxied = await (await fetch(`http://127.0.0.1:${p}/`, { headers: { 'x-forwarded-for': '8.8.8.8' } })).text();
    assert.match(proxied, /const ACCOUNT = false, SETUP = false/, 'par un tunnel : pas de création sans le lien');
    assert.match(proxied, /const CLAIM_WHY = "tu passes par un tunnel/, 'la raison du refus est expliquée');
    const body = JSON.stringify({ prenom: 'Awa', nom: 'Saïd', email: 'awa@exemple.yt', password: 'un-cheval-bleu-traverse-mamoudzou' }), H = { 'x-odin': '1', 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: { ...H, 'x-forwarded-for': '8.8.8.8' }, body })).status, 403, 'par un tunnel : refusé');
    const c = await fetch(`http://127.0.0.1:${p}/api/account/create`, { method: 'POST', headers: H, body });
    assert.equal(c.status, 200);
  } finally { await gw.stop(); o.cleanup(); }
});
