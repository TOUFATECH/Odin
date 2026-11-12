// Certificats Let's Encrypt (protocole ACME, RFC 8555) écrits dans Odin : compte (clé ECDSA P-256),
// commande, défi HTTP-01 servi par le proxy Valgrind, demande de certificat (CSR encodée à la main en DER),
// téléchargement de la chaîne. Aucune adresse e-mail n'est envoyée (le compte n'en a pas besoin).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const der = (tag: number, body: Buffer): Buffer => {
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...b: Buffer[]) => der(0x30, Buffer.concat(b));
const set = (...b: Buffer[]) => der(0x31, Buffer.concat(b));
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of rest) { const t = [v & 127]; for (let x = v >> 7; x > 0; x >>= 7) t.unshift((x & 127) | 128); bytes.push(...t); }
  return der(0x06, Buffer.from(bytes));
};

/** Une clé ECDSA P-256 neuve (PEM PKCS#8). */
export function newKey(): string { return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string; }
/** Demande de certificat (PKCS#10) pour ces noms, signée par la clé du site. Pure (à clé donnée). */
export function csr(domains: string[], keyPem: string): Buffer {
  const key = createPrivateKey(keyPem), spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
  const san = seq(...domains.map((d) => der(0x82, Buffer.from(d, 'ascii'))));
  const exts = seq(seq(oid('2.5.29.17'), der(0x04, san)));
  const info = seq(der(0x02, Buffer.from([0])), seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(domains[0], 'utf8'))))), spki, der(0xa0, seq(oid('1.2.840.113549.1.9.14'), set(exts))));
  const alg = seq(oid('1.2.840.10045.4.3.2'));
  return seq(info, alg, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', info, key)])));
}

/** Empreinte de la clé du compte (RFC 7638), qui forme la réponse au défi HTTP-01. */
export function thumbprint(keyPem: string): string {
  const j = createPublicKey(createPrivateKey(keyPem)).export({ format: 'jwk' }) as { crv: string; x: string; y: string };
  return b64u(createHash('sha256').update(`{"crv":"${j.crv}","kty":"EC","x":"${j.x}","y":"${j.y}"}`).digest());
}

export interface AcmeOpts {
  directory: string; accountKey: string; fetch: typeof fetch;
  /** le proxy sert la réponse au défi : token → réponse (et l'oublie quand on rappelle avec undefined) */
  challenge: (token: string, answer: string | undefined) => void;
  log?: (s: string) => void; pollMs?: number; tries?: number;
}
/** Obtient un certificat pour ces domaines. Rend la chaîne PEM et la clé du site (PEM). */
export async function obtain(domains: string[], o: AcmeOpts): Promise<{ cert: string; key: string }> {
  const f = o.fetch, log = o.log ?? (() => {}), wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const dir = await (await f(o.directory)).json() as { newNonce: string; newAccount: string; newOrder: string };
  const key = createPrivateKey(o.accountKey), jwk = createPublicKey(key).export({ format: 'jwk' }) as Record<string, string>;
  let nonce = '', kid = '';
  const fresh = async () => { const r = await f(dir.newNonce, { method: 'HEAD' }); nonce = r.headers.get('replay-nonce') ?? ''; if (!nonce) throw new Error('le serveur ACME ne donne pas de jeton (nonce)'); };
  const post = async (url: string, payload: unknown, useJwk = false): Promise<Response> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!nonce) await fresh();
      const prot = b64u(JSON.stringify({ alg: 'ES256', nonce, url, ...(useJwk ? { jwk: { crv: jwk.crv, kty: 'EC', x: jwk.x, y: jwk.y } } : { kid }) }));
      const body = payload === '' ? '' : b64u(JSON.stringify(payload));
      const sig = sign('sha256', Buffer.from(`${prot}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/jose+json' }, body: JSON.stringify({ protected: prot, payload: body, signature: b64u(sig) }) });
      nonce = r.headers.get('replay-nonce') ?? '';
      if (r.status === 400) { const e = await r.clone().json().catch(() => ({})) as { type?: string }; if (e.type === 'urn:ietf:params:acme:error:badNonce') continue; }
      if (r.status >= 400) { const e = await r.json().catch(() => ({})) as { detail?: string; type?: string }; throw new Error(`ACME : ${e.detail ?? e.type ?? `HTTP ${r.status}`}`); }
      return r;
    }
    throw new Error('ACME : jeton refusé trois fois');
  };
  const acc = await post(dir.newAccount, { termsOfServiceAgreed: true }, true); kid = acc.headers.get('location') ?? '';
  if (!kid) throw new Error('ACME : compte sans adresse');
  log('compte ACME prêt');
  const ord = await post(dir.newOrder, { identifiers: domains.map((d) => ({ type: 'dns', value: d })) });
  const orderUrl = ord.headers.get('location') ?? ''; let order = await ord.json() as { status: string; authorizations: string[]; finalize: string; certificate?: string };
  const thumb = thumbprint(o.accountKey), tokens: string[] = [];
  try {
    for (const az of order.authorizations) {
      const a = await (await post(az, '')).json() as { status: string; identifier: { value: string }; challenges: Array<{ type: string; url: string; token: string; status: string }> };
      if (a.status === 'valid') continue;
      const ch = a.challenges.find((c) => c.type === 'http-01'); if (!ch) throw new Error(`pas de défi HTTP-01 pour ${a.identifier.value}`);
      o.challenge(ch.token, `${ch.token}.${thumb}`); tokens.push(ch.token);
      await post(ch.url, {});
      log(`défi HTTP-01 lancé pour ${a.identifier.value}`);
      for (let i = 0; ; i++) {
        await wait(o.pollMs ?? 2000);
        const s = await (await post(az, '')).json() as { status: string; challenges?: Array<{ type: string; error?: { detail?: string } }> };
        if (s.status === 'valid') break;
        if (s.status === 'invalid') throw new Error(`${a.identifier.value} : ${s.challenges?.find((c) => c.type === 'http-01')?.error?.detail ?? 'défi refusé'} (le port 80 doit être ouvert vers Odin sur ta box, et le nom doit pointer vers ton adresse publique)`);
        if (i >= (o.tries ?? 30)) throw new Error(`${a.identifier.value} : pas de réponse du serveur ACME`);
      }
    }
    const siteKey = newKey();
    await post(order.finalize, { csr: b64u(csr(domains, siteKey)) });
    for (let i = 0; ; i++) {
      order = await (await post(orderUrl, '')).json() as typeof order;
      if (order.status === 'valid' && order.certificate) break;
      if (order.status === 'invalid') throw new Error('commande refusée par le serveur ACME');
      if (i >= (o.tries ?? 30)) throw new Error('certificat pas prêt à temps');
      await wait(o.pollMs ?? 2000);
    }
    const cert = await (await post(order.certificate!, '')).text();
    if (!cert.includes('BEGIN CERTIFICATE')) throw new Error('certificat illisible');
    log(`certificat obtenu pour ${domains.join(', ')}`);
    return { cert, key: siteKey };
  } finally { for (const t of tokens) o.challenge(t, undefined); }
}
export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETS_ENCRYPT_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';
