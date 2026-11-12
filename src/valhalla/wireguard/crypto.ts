// Les briques de chiffrement du protocole WireGuard, écrites pour Odin (rien à installer) :
//  - BLAKE2s (RFC 7693), avec clé et longueur de sortie au choix : HASH, MAC (BLAKE2s-128 à clé), HMAC ;
//  - HKDF de WireGuard (KDF1, KDF2, KDF3) ;
//  - ChaCha20-Poly1305 (celui de Node) avec le nonce de WireGuard (4 octets nuls + compteur 64 bits) ;
//  - XChaCha20-Poly1305 (pour les « cookies » anti-saturation), à partir de HChaCha20 écrit ici ;
//  - X25519 (celui de Node), clés brutes de 32 octets.

import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes } from 'node:crypto';

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

function compress(h: Uint32Array, block: Buffer, t: number, last: boolean): void {
  const v = new Uint32Array(16), m = new Uint32Array(16);
  for (let i = 0; i < 16; i++) m[i] = block.readUInt32LE(i * 4);
  for (let i = 0; i < 8; i++) { v[i] = h[i]; v[i + 8] = IV[i]; }
  v[12] ^= t >>> 0; v[13] ^= Math.floor(t / 0x100000000) >>> 0;
  if (last) v[14] = ~v[14] >>> 0;
  const g = (a: number, b: number, c: number, d: number, x: number, y: number) => {
    v[a] = (v[a] + v[b] + x) >>> 0; v[d] = rotr(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 12);
    v[a] = (v[a] + v[b] + y) >>> 0; v[d] = rotr(v[d] ^ v[a], 8);
    v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 7);
  };
  for (let r = 0; r < 10; r++) {
    const s = SIGMA[r];
    g(0, 4, 8, 12, m[s[0]], m[s[1]]); g(1, 5, 9, 13, m[s[2]], m[s[3]]); g(2, 6, 10, 14, m[s[4]], m[s[5]]); g(3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(0, 5, 10, 15, m[s[8]], m[s[9]]); g(1, 6, 11, 12, m[s[10]], m[s[11]]); g(2, 7, 8, 13, m[s[12]], m[s[13]]); g(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
}

/** BLAKE2s (RFC 7693) : `outLen` de 1 à 32 octets, clé facultative (32 octets au plus). */
export function blake2s(data: Buffer | Uint8Array, outLen = 32, key: Buffer | Uint8Array = Buffer.alloc(0)): Buffer {
  if (outLen < 1 || outLen > 32 || key.length > 32) throw new Error('blake2s : paramètres invalides');
  const h = new Uint32Array(IV);
  h[0] ^= 0x01010000 ^ (key.length << 8) ^ outLen;
  const input = key.length ? Buffer.concat([Buffer.concat([Buffer.from(key)], 64), Buffer.from(data)]) : Buffer.from(data);
  let t = 0, off = 0;
  while (input.length - off > 64) { t += 64; compress(h, input.subarray(off, off + 64), t, false); off += 64; }
  const lastBlock = Buffer.alloc(64); input.copy(lastBlock, 0, off); t += input.length - off;
  compress(h, lastBlock, t, true);
  const out = Buffer.alloc(32); for (let i = 0; i < 8; i++) out.writeUInt32LE(h[i], i * 4);
  return out.subarray(0, outLen);
}
export const HASH = (...parts: Array<Buffer | Uint8Array>): Buffer => blake2s(Buffer.concat(parts.map((p) => Buffer.from(p))));
/** MAC de WireGuard : BLAKE2s à clé, 16 octets. */
export const MAC = (key: Buffer, data: Buffer): Buffer => blake2s(data, 16, key);
/** HMAC-BLAKE2s (bloc de 64 octets). */
export function HMAC(key: Buffer, data: Buffer): Buffer {
  const k = Buffer.alloc(64); (key.length > 64 ? HASH(key) : key).copy(k);
  const ipad = Buffer.alloc(64), opad = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  return HASH(opad, HASH(ipad, data));
}
const ONE = Buffer.from([1]), TWO = Buffer.from([2]), THREE = Buffer.from([3]);
export function KDF1(key: Buffer, input: Buffer): Buffer { const t0 = HMAC(key, input); return HMAC(t0, ONE); }
export function KDF2(key: Buffer, input: Buffer): [Buffer, Buffer] { const t0 = HMAC(key, input), t1 = HMAC(t0, ONE); return [t1, HMAC(t0, Buffer.concat([t1, TWO]))]; }
export function KDF3(key: Buffer, input: Buffer): [Buffer, Buffer, Buffer] { const t0 = HMAC(key, input), t1 = HMAC(t0, ONE), t2 = HMAC(t0, Buffer.concat([t1, TWO])); return [t1, t2, HMAC(t0, Buffer.concat([t2, THREE]))]; }

const nonce12 = (counter: bigint): Buffer => { const n = Buffer.alloc(12); n.writeBigUInt64LE(counter, 4); return n; };
function aeadSeal(key: Buffer, nonce: Buffer, plain: Buffer, ad: Buffer): Buffer {
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  c.setAAD(ad, { plaintextLength: plain.length });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
function aeadOpen(key: Buffer, nonce: Buffer, sealed: Buffer, ad: Buffer): Buffer | undefined {
  if (sealed.length < 16) return undefined;
  try {
    const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    d.setAAD(ad, { plaintextLength: sealed.length - 16 }); d.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  } catch { return undefined; }
}
export const AEAD = (key: Buffer, counter: bigint, plain: Buffer, ad: Buffer): Buffer => aeadSeal(key, nonce12(counter), plain, ad);
/** Déchiffre ; `undefined` si le message a été modifié ou n'est pas pour cette clé. */
export const AEAD_OPEN = (key: Buffer, counter: bigint, sealed: Buffer, ad: Buffer): Buffer | undefined => aeadOpen(key, nonce12(counter), sealed, ad);

/** HChaCha20 : dérive une sous-clé de 32 octets (pour XChaCha20). */
export function hchacha20(key: Buffer, nonce16: Buffer): Buffer {
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) s[4 + i] = key.readUInt32LE(i * 4);
  for (let i = 0; i < 4; i++) s[12 + i] = nonce16.readUInt32LE(i * 4);
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const q = (a: number, b: number, c: number, d: number) => {
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 16); s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 12);
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 8); s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 7);
  };
  for (let i = 0; i < 10; i++) { q(0, 4, 8, 12); q(1, 5, 9, 13); q(2, 6, 10, 14); q(3, 7, 11, 15); q(0, 5, 10, 15); q(1, 6, 11, 12); q(2, 7, 8, 13); q(3, 4, 9, 14); }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) { out.writeUInt32LE(s[i], i * 4); out.writeUInt32LE(s[12 + i], 16 + i * 4); }
  return out;
}
const xparts = (key: Buffer, nonce24: Buffer) => { const n = Buffer.alloc(12); nonce24.copy(n, 4, 16, 24); return { k: hchacha20(key, nonce24.subarray(0, 16)), n }; };
export const XAEAD = (key: Buffer, nonce24: Buffer, plain: Buffer, ad: Buffer): Buffer => { const x = xparts(key, nonce24); return aeadSeal(x.k, x.n, plain, ad); };
export const XAEAD_OPEN = (key: Buffer, nonce24: Buffer, sealed: Buffer, ad: Buffer): Buffer | undefined => { const x = xparts(key, nonce24); return aeadOpen(x.k, x.n, sealed, ad); };

const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex'), SPKI = Buffer.from('302a300506032b656e032100', 'hex');
/** Une paire de clés X25519 brutes (32 octets chacune). */
export function dhGenerate(): { priv: Buffer; pub: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32) };
}
export const pubOf = (priv: Buffer): Buffer => createPublicKey(createPrivateKey({ key: Buffer.concat([PKCS8, priv]), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(-32);
/** Secret partagé X25519 ; refuse un résultat nul (clé publique piégée). */
export function DH(priv: Buffer, pub: Buffer): Buffer {
  const out = diffieHellman({ privateKey: createPrivateKey({ key: Buffer.concat([PKCS8, priv]), format: 'der', type: 'pkcs8' }), publicKey: createPublicKey({ key: Buffer.concat([SPKI, pub]), format: 'der', type: 'spki' }) });
  if (out.every((b) => b === 0)) throw new Error('clé publique invalide');
  return out;
}
export const random = (n: number): Buffer => randomBytes(n);
