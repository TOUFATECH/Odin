// Jetons signés d'Odin (JWT, RFC 7519) : signature ES256 (ECDSA P-256 + SHA-256, RFC 7518 § 3.4), clé publique au
// format JWK (RFC 7517) et son empreinte (RFC 7638). Seulement node:crypto. La clé privée est rangée chiffrée
// (AES-256-GCM) avec une clé tirée de la clé du coffre d'Odin : jamais en clair sur le disque.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest();
export const sha256hex = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');

/** Une clé de 32 octets tirée de la clé du coffre d'Odin (BRISINGAMEN_KEY), propre à un usage. Absente : undefined. */
export function cleDuCoffre(usage: string): Buffer | undefined {
  const k = process.env.BRISINGAMEN_KEY; if (!k || !/^[a-f0-9]{64}$/.test(k)) return undefined;
  return Buffer.from(hkdfSync('sha256', Buffer.from(k, 'hex'), Buffer.from('odin'), Buffer.from(usage), 32));
}
const MAGIC = Buffer.from('OSK1');
export function sceller(cle: Buffer, clair: Buffer): Buffer { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', cle, iv); const ct = Buffer.concat([c.update(clair), c.final()]); return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]); }
export function desceller(cle: Buffer, b: Buffer): Buffer { if (!b.subarray(0, 4).equals(MAGIC)) throw new Error('fichier chiffré illisible'); const d = createDecipheriv('aes-256-gcm', cle, b.subarray(4, 16)); d.setAuthTag(b.subarray(16, 32)); return Buffer.concat([d.update(b.subarray(32)), d.final()]); }
function ecrire600(f: string, data: Buffer): void { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp`; writeFileSync(tmp, data, { mode: 0o600 }); try { chmodSync(tmp, 0o600); } catch { /* Windows */ } renameSync(tmp, f); }

export interface Jwk { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string; use: 'sig'; alg: 'ES256' }
export interface Signeur { kid: string; jwk: Jwk; prive: KeyObject; public: KeyObject; /** la clé ne vit qu'en mémoire (clé du coffre absente) */ ephemere: boolean }

/** Empreinte RFC 7638 d'une clé EC (les 16 premiers caractères servent de `kid`). */
export function empreinteJwk(j: { crv: string; x: string; y: string }): string { return b64u(sha256(`{"crv":"${j.crv}","kty":"EC","x":"${j.x}","y":"${j.y}"}`)); }
function jwkDe(pub: KeyObject): Jwk { const e = pub.export({ format: 'jwk' }) as { x: string; y: string }; const kid = empreinteJwk({ crv: 'P-256', x: e.x, y: e.y }).slice(0, 16); return { kty: 'EC', crv: 'P-256', x: e.x, y: e.y, kid, use: 'sig', alg: 'ES256' }; }

const cache = new Map<string, Signeur>();
/** La clé de signature d'Odin : lue (déchiffrée) ou créée une fois. Sans clé du coffre : une clé en mémoire seulement. */
export function signeur(fichier: string): Signeur {
  const c = cache.get(fichier); if (c) return c;
  const cle = cleDuCoffre('sso-signature-v1');
  let prive: KeyObject | undefined;
  if (cle && existsSync(fichier)) { try { prive = createPrivateKey({ key: desceller(cle, readFileSync(fichier)), format: 'der', type: 'pkcs8' }); } catch { prive = undefined; } }
  if (!prive) {
    prive = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    if (cle) ecrire600(fichier, sceller(cle, prive.export({ format: 'der', type: 'pkcs8' }) as Buffer));
  }
  const pub = createPublicKey(prive), jwk = jwkDe(pub), s: Signeur = { kid: jwk.kid, jwk, prive, public: pub, ephemere: !cle };
  cache.set(fichier, s); return s;
}
/** Oublie la clé gardée en mémoire (essais). */
export function oublierSigneur(): void { cache.clear(); }

/** Signe un JWT ES256 (signature brute r‖s de 64 octets, comme le veut JWS). */
export function signer(s: Signeur, charge: Record<string, unknown>, typ = 'JWT'): string {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ, kid: s.kid })), p = b64u(JSON.stringify(charge));
  const sig = sign('sha256', Buffer.from(`${h}.${p}`), { key: s.prive, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}

/** Vérifie un JWT ES256 avec une clé publique (KeyObject ou JWK). Rend la charge, ou une raison. Pur (hors horloge donnée). */
export function verifier(jwt: string, cle: KeyObject | { x: string; y: string; kid?: string }, o: { maintenant?: number; typ?: string } = {}): { ok: true; charge: Record<string, unknown>; entete: Record<string, unknown> } | { ok: false; raison: string } {
  const parts = String(jwt).split('.'); if (parts.length !== 3) return { ok: false, raison: 'jeton mal formé' };
  let entete: Record<string, unknown>, charge: Record<string, unknown>;
  try { entete = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); charge = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, raison: 'jeton illisible' }; }
  if (entete.alg !== 'ES256') return { ok: false, raison: 'algorithme refusé' };
  if (o.typ && entete.typ !== o.typ) return { ok: false, raison: 'type de jeton inattendu' };
  const k = 'type' in cle ? cle as KeyObject : createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: (cle as { x: string }).x, y: (cle as { y: string }).y }, format: 'jwk' });
  if (!('type' in cle) && (cle as { kid?: string }).kid && entete.kid !== (cle as { kid?: string }).kid) return { ok: false, raison: 'clé inconnue' };
  const sig = Buffer.from(parts[2], 'base64url'); if (sig.length !== 64) return { ok: false, raison: 'signature mal formée' };
  if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: k, dsaEncoding: 'ieee-p1363' }, sig)) return { ok: false, raison: 'signature fausse' };
  const t = Math.floor((o.maintenant ?? Date.now()) / 1000);
  if (typeof charge.exp !== 'number' || charge.exp < t) return { ok: false, raison: 'jeton expiré' };
  return { ok: true, charge, entete };
}
