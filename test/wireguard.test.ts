// Le moteur WireGuard écrit dans Odin : chiffrement (vecteurs officiels), poignée de main, paquets,
// protections (rejeu, fausse adresse, message modifié, saturation), renouvellement des clés.
// La compatibilité avec le WireGuard officiel (wireguard-go) est vérifiée à part, avec des cartes réseau réelles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { blake2s, hchacha20, HMAC, XAEAD, XAEAD_OPEN, dhGenerate } from '../src/valhalla/wireguard/crypto.ts';
import { Replay, T, WgDevice, inCidr, ipInfo, parseCidr, tai64n, type TunPort } from '../src/valhalla/wireguard/engine.ts';

test('chiffrement : BLAKE2s, HMAC, HChaCha20 et XChaCha20-Poly1305 justes', () => {
  const k = Buffer.from([...Array(32).keys()]);
  assert.equal(blake2s(Buffer.from('abc')).toString('hex'), '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');   // RFC 7693
  assert.equal(blake2s(Buffer.alloc(0), 32, k).toString('hex'), '48a8997da407876b3d79c0d92325ad3b89cbb754d86ab71aee047ad345fd2c49');   // BLAKE2s à clé
  assert.equal(hchacha20(k, Buffer.from('000000090000004a0000000031415927', 'hex')).toString('hex'), '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc'); // brouillon XChaCha
  for (const n of [0, 1, 63, 64, 65, 200]) { const d = randomBytes(n), key = randomBytes(32); assert.ok(blake2s(d).equals(createHash('blake2s256').update(d).digest())); assert.ok(HMAC(key, d).equals(createHmac('blake2s256', key).update(d).digest())); }
  const nonce = randomBytes(24), sealed = XAEAD(k, nonce, Buffer.from('cookie'), Buffer.from('ad'));
  assert.equal(XAEAD_OPEN(k, nonce, sealed, Buffer.from('ad'))?.toString(), 'cookie');
  assert.equal(XAEAD_OPEN(k, nonce, sealed, Buffer.from('autre')), undefined);
});

test('adresses : sous-réseaux v4 et v6, horodatage croissant, fenêtre anti-rejeu', () => {
  assert.ok(inCidr(parseCidr('10.8.0.0/24'), Buffer.from([10, 8, 0, 7])));
  assert.ok(!inCidr(parseCidr('10.8.0.2/32'), Buffer.from([10, 8, 0, 3])));
  assert.ok(inCidr(parseCidr('0.0.0.0/0'), Buffer.from([1, 2, 3, 4])));
  assert.ok(inCidr(parseCidr('fd00::/8'), parseCidr('fd12::1').net)); assert.ok(!inCidr(parseCidr('fd00::/8'), Buffer.from([10, 0, 0, 1])));
  assert.throws(() => parseCidr('10.8.0.0/33'), /masque invalide/);
  assert.ok(Buffer.compare(tai64n(1_000), tai64n(1_001)) < 0);
  const r = new Replay();
  assert.ok(r.accept(0n)); assert.ok(r.accept(5n)); assert.ok(!r.accept(5n), 'rejoué'); assert.ok(r.accept(3n), 'en retard mais neuf');
  assert.ok(r.accept(5000n)); assert.ok(!r.accept(100n), 'trop vieux');
});

/** Un paquet IPv4 minimal (UDP) de `src` vers `dst`. */
function packet(src: string, dst: string, body = 'bonjour'): Buffer {
  const b = Buffer.from(body), p = Buffer.alloc(28 + b.length);
  p[0] = 0x45; p.writeUInt16BE(p.length, 2); p[8] = 64; p[9] = 17;
  Buffer.from(src.split('.').map(Number)).copy(p, 12); Buffer.from(dst.split('.').map(Number)).copy(p, 16); b.copy(p, 28);
  return p;
}
function fakeTun() {
  const got: Buffer[] = []; let cb: (p: Buffer) => void = () => {};
  const port: TunPort = { write: (p) => { got.push(Buffer.from(p)); }, onPacket: (f) => { cb = f; }, close: () => {} };
  return { port, got, inject: (p: Buffer) => cb(p) };
}
const wait = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 20)); } return true; };

async function pair(o: { psk?: boolean; underLoadAt?: number; now?: () => number } = {}) {
  const ka = dhGenerate(), kb = dhGenerate(), psk = o.psk === false ? undefined : dhGenerate().priv.toString('base64');
  const ta = fakeTun(), tb = fakeTun();
  const b = new WgDevice({ privateKey: kb.priv.toString('base64'), listenPort: 0, tun: tb.port, now: o.now, underLoadAt: o.underLoadAt, peers: [{ name: 'A', publicKey: ka.pub.toString('base64'), presharedKey: psk, allowedIps: ['10.9.0.1/32'] }] });
  const pb = await b.start();
  const a = new WgDevice({ privateKey: ka.priv.toString('base64'), listenPort: 0, tun: ta.port, now: o.now, peers: [{ name: 'B', publicKey: kb.pub.toString('base64'), presharedKey: psk, allowedIps: ['10.9.0.0/24'], endpoint: `127.0.0.1:${pb}` }] });
  await a.start();
  return { a, b, ta, tb, ka, kb, end: () => { a.stop(); b.stop(); } };
}

test('deux moteurs : poignée de main, paquets dans les deux sens, l\'adresse de l\'autre apprise en route', async () => {
  for (const psk of [true, false]) {
    const x = await pair({ psk });
    try {
      x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'aller'));
      assert.ok(await wait(() => x.tb.got.length === 1), 'le premier paquet attend la poignée de main, puis part');
      assert.equal(x.tb.got[0].subarray(28).toString(), 'aller'); assert.equal(x.tb.got[0].length, 33, 'le remplissage est retiré');
      x.tb.inject(packet('10.9.0.2', '10.9.0.1', 'retour'));
      assert.ok(await wait(() => x.ta.got.length === 1)); assert.equal(x.ta.got[0].subarray(28).toString(), 'retour');
      assert.ok(x.b.stats()[0].endpoint?.startsWith('127.0.0.1:'), 'B a appris d\'où vient A');
      assert.ok(x.a.stats()[0].lastHandshake && x.b.stats()[0].lastHandshake);
      for (let i = 0; i < 50; i++) x.ta.inject(packet('10.9.0.1', '10.9.0.2', `n°${i}`));
      assert.ok(await wait(() => x.tb.got.length === 51), `50 paquets de plus (${x.tb.got.length - 1})`);
    } finally { x.end(); }
  }
});

test('protections : fausse adresse, inconnu, message modifié, rejeu', async () => {
  const x = await pair();
  try {
    x.ta.inject(packet('10.9.0.1', '10.9.0.2')); assert.ok(await wait(() => x.tb.got.length === 1));
    // A envoie depuis une adresse qui n'est pas la sienne : B refuse.
    x.ta.inject(packet('10.9.0.66', '10.9.0.2', 'usurpé')); await new Promise((r) => setTimeout(r, 200));
    assert.equal(x.tb.got.length, 1);
    // Un inconnu (clé non déclarée) ne passe pas la poignée de main.
    const intrus = dhGenerate(), ti = fakeTun();
    const i = new WgDevice({ privateKey: intrus.priv.toString('base64'), listenPort: 0, tun: ti.port, peers: [{ publicKey: x.kb.pub.toString('base64'), allowedIps: ['10.9.0.0/24'], endpoint: `127.0.0.1:${(x.b as unknown as { port: number }).port}` }] });
    await i.start(); ti.inject(packet('10.9.0.1', '10.9.0.2', 'intrus')); await new Promise((r) => setTimeout(r, 400));
    assert.equal(x.tb.got.length, 1); assert.equal(i.stats()[0].lastHandshake, undefined); i.stop();
    // Un paquet capturé puis renvoyé tel quel, ou modifié d'un octet : ignoré.
    const spy = dgram.createSocket('udp4'), captured: Buffer[] = [];
    await new Promise<void>((r) => spy.bind(0, '127.0.0.1', () => r()));
    const realB = (x.b as unknown as { port: number }).port;
    spy.on('message', (m) => { captured.push(Buffer.from(m)); });
    // On fait passer le prochain paquet de A par l'espion.
    (x.a as unknown as { peers: Map<string, { endpoint: { address: string; port: number } }> }).peers.forEach((p) => { p.endpoint = { address: '127.0.0.1', port: (spy.address() as { port: number }).port }; });
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'capturé'));
    assert.ok(await wait(() => captured.length === 1));
    const send = (b: Buffer) => new Promise<void>((r) => spy.send(b, realB, '127.0.0.1', () => r()));
    await send(captured[0]); assert.ok(await wait(() => x.tb.got.length === 2), 'transmis une fois');
    await send(captured[0]); await new Promise((r) => setTimeout(r, 200)); assert.equal(x.tb.got.length, 2, 'rejeu ignoré');
    const evil = Buffer.from(captured[0]); evil[evil.length - 20] ^= 1; await send(evil); await new Promise((r) => setTimeout(r, 200));
    assert.equal(x.tb.got.length, 2, 'message modifié ignoré');
    spy.close();
  } finally { x.end(); }
});

test('renouvellement : nouvelles clés après 2 minutes, vieille session refusée après 3', async () => {
  let clock = 1_000_000;
  const x = await pair({ now: () => clock });
  try {
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'un')); assert.ok(await wait(() => x.tb.got.length === 1));
    const first = x.a.stats()[0].lastHandshake!;
    clock += T.REKEY_AFTER_TIME + 1000;
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'deux'));
    assert.ok(await wait(() => x.tb.got.length === 2), 'encore envoyé avec l\'ancienne clé');
    assert.ok(await wait(() => (x.a.stats()[0].lastHandshake ?? 0) > first), 'nouvelle poignée de main');
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'trois')); assert.ok(await wait(() => x.tb.got.length === 3));
    // Trois minutes sans renouvellement possible : la vieille session ne sert plus, Odin refait une poignée de main.
    clock += T.REJECT_AFTER_TIME + 1000;
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'quatre')); assert.ok(await wait(() => x.tb.got.length === 4), 'repart après une nouvelle poignée de main');
  } finally { x.end(); }
});

test('saturation : sous une pluie de poignées de main, Odin exige un cookie, et l\'autre le fournit', async () => {
  const x = await pair({ underLoadAt: 0 });
  try {
    x.ta.inject(packet('10.9.0.1', '10.9.0.2', 'malgré la charge'));
    // 1re tentative : cookie demandé ; la tentative suivante (5 s plus tard) porte le cookie et passe.
    assert.ok(await wait(() => x.tb.got.length === 1, 9000), 'passe avec le cookie');
  } finally { x.end(); }
});
