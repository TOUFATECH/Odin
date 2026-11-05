// Notifications « push » (Web Push, RFC 8030/8291/8292) sans dépendance : elles arrivent sur le
// téléphone même quand l'appli Odin est fermée. Clés VAPID créées une fois (~/.odin/vapid.json, 600) ;
// abonnements des appareils dans ~/.odin/push.json. Le contenu est chiffré pour l'appareil seul :
// le service de push du navigateur (Google, Mozilla, Apple) ne peut pas le lire.

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

export interface Subscription { endpoint: string; keys: { p256dh: string; auth: string }; label?: string; at?: number }
export interface Vapid { publicKey: string; privateJwk: { kty: string; crv: string; d: string; x: string; y: string } }

/** Clés VAPID d'Odin (créées une fois). */
export function vapidKeys(home: string): Vapid {
  const f = join(home, 'vapid.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Vapid;
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', d: b64u(ecdh.getPrivateKey()), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  const v: Vapid = { publicKey: b64u(pub), privateJwk: jwk };
  writeFileSync(f, JSON.stringify(v), { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows */ }
  return v;
}

/** Jeton VAPID (JWT ES256) pour un service de push. */
export function vapidAuth(endpoint: string, v: Vapid, subject = 'https://github.com/TOUFATECH/Odin', now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key: KeyObject = createPrivateKey({ key: v.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

/** Chiffrement « aes128gcm » du message pour l'appareil (RFC 8291). */
export function encryptPayload(payload: Buffer, sub: Subscription, salt = randomBytes(16), local?: ECDH): Buffer {
  if (!local) { local = createECDH('prime256v1'); local.generateKeys(); }
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth), asPub = local.getPublicKey();
  const shared = local.computeSecret(uaPub);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

// ---------- Abonnements ----------

const subsFile = (home: string) => join(home, 'push.json');
export function listSubscriptions(home: string): Subscription[] { try { return JSON.parse(readFileSync(subsFile(home), 'utf8')) as Subscription[]; } catch { return []; } }
function saveSubs(home: string, s: Subscription[]) { writeFileSync(subsFile(home), JSON.stringify(s), { mode: 0o600 }); }

/** Ajoute un appareil (seulement les services de push connus : pas d'adresse arbitraire). */
export function addSubscription(home: string, s: Subscription): void {
  const u = new URL(s.endpoint);
  if (u.protocol !== 'https:' || !/(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/.test(u.hostname)) throw new Error('service de push inconnu');
  if (unb64u(s.keys.p256dh).length !== 65 || unb64u(s.keys.auth).length < 16) throw new Error('clés d\'abonnement invalides');
  const all = listSubscriptions(home).filter((x) => x.endpoint !== s.endpoint);
  all.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label: (s.label ?? '').slice(0, 60), at: Date.now() });
  saveSubs(home, all.slice(-20));
}
export function removeSubscription(home: string, endpoint: string): void { saveSubs(home, listSubscriptions(home).filter((x) => x.endpoint !== endpoint)); }

/** Envoie une notification à tous tes appareils abonnés ; retire ceux qui n'existent plus. */
export async function pushAll(home: string, msg: { title: string; body: string; view?: string; tag?: string }, fetcher: typeof fetch = fetch): Promise<number> {
  const subs = listSubscriptions(home);
  if (!subs.length) return 0;
  const v = vapidKeys(home), payload = Buffer.from(JSON.stringify({ ...msg, body: msg.body.slice(0, 300) }));
  let ok = 0;
  for (const s of subs) {
    try {
      const r = await fetcher(s.endpoint, { method: 'POST', headers: { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal', authorization: vapidAuth(s.endpoint, v) }, body: encryptPayload(payload, s), signal: AbortSignal.timeout(15_000) });
      if (r.status === 404 || r.status === 410) removeSubscription(home, s.endpoint);
      else if (r.ok) ok++;
    } catch { /* appareil injoignable : on réessaiera au prochain message */ }
  }
  return ok;
}

