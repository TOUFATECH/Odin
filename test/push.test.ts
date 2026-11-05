import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSubscription, encryptPayload, listSubscriptions, pushAll, vapidAuth, vapidKeys } from '../src/push/webpush.ts';

/** Ce que fait le navigateur à la réception (RFC 8291), pour vérifier le chiffrement. */
function browserDecrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'délimiteur du dernier enregistrement');
  return plain.subarray(0, -1).toString();
}

test('push : chiffré pour l\'appareil seul (aes128gcm), jeton VAPID signé, abonnements filtrés et nettoyés', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-push-'));
  try {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const auth = randomBytes(16);
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
    assert.equal(browserDecrypt(encryptPayload(Buffer.from('{"title":"Odin"}'), sub), ua, auth), '{"title":"Odin"}');

    const v = vapidKeys(home);
    assert.equal(vapidKeys(home).publicKey, v.publicKey, 'clés stables');
    const h = vapidAuth(sub.endpoint, v);
    const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
    const [hd, bd, sg] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(bd, 'base64url').toString()).aud, 'https://fcm.googleapis.com');
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(k, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(k, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${hd}.${bd}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')));

    assert.throws(() => addSubscription(home, { ...sub, endpoint: 'https://pirate.example/x' }), /inconnu/, 'pas d\'adresse arbitraire');
    addSubscription(home, sub);
    addSubscription(home, { ...sub, endpoint: 'https://web.push.apple.com/xyz' });
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push(String(url)); assert.equal((init.headers as Record<string, string>)['content-encoding'], 'aes128gcm'); return new Response('', { status: String(url).includes('apple') ? 410 : 201 }); }) as unknown as typeof fetch;
    assert.equal(await pushAll(home, { title: 'Odin', body: 'test' }, f), 1);
    assert.equal(seen.length, 2);
    assert.deepEqual(listSubscriptions(home).map((s) => s.endpoint), [sub.endpoint], 'abonnement expiré retiré');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
