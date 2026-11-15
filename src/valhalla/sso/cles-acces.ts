// Les clés d'accès (passkeys, WebAuthn niveau 2), écrites dans Odin sans dépendance : seulement node:crypto.
//   - Inscrire une clé : le navigateur crée une paire de clés dans le téléphone, l'ordinateur ou une clé USB ; Odin ne
//     garde que la clé publique (et le compteur). Rien de secret ne quitte l'appareil.
//   - Se connecter : l'appareil signe un défi tiré au hasard par Odin, après avoir vérifié la personne (empreinte,
//     visage ou code de l'appareil : « vérification de l'utilisateur » exigée). Une clé d'accès vaut donc deux facteurs :
//     elle remplit aussi la double authentification obligatoire d'un groupe.
//   - Le navigateur n'accepte les clés d'accès que sur un NOM (ex. odin.exemple.fr) avec un vrai certificat, ou sur
//     localhost : jamais par une adresse IP (règle de WebAuthn).
// Formats lus ici : CBOR (RFC 8949, le sous-ensemble utilisé par WebAuthn), clés COSE (RFC 9053 : EC2 P-256, RSA,
// OKP Ed25519), données de l'authentificateur, client data JSON. Attestation : « none » demandée, jamais exigée.

import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

// ---------------- CBOR (lecture, et écriture pour les essais)
export type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;
/** Lit une valeur CBOR ; rend la valeur et l'endroit où elle finit. Lève une erreur sur un CBOR mal formé. */
export function cborLire(b: Buffer, at = 0, prof = 0): { v: Cbor; fin: number } {
  if (prof > 16) throw new Error('CBOR trop imbriqué');
  if (at >= b.length) throw new Error('CBOR tronqué');
  const ib = b[at], maj = ib >> 5, info = ib & 31; let p = at + 1;
  const long = (): number => {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (!n || p + n > b.length) throw new Error('CBOR : longueur illisible');
    const v = n === 1 ? b[p] : n === 2 ? b.readUInt16BE(p) : n === 4 ? b.readUInt32BE(p) : Number(b.readBigUInt64BE(p));
    p += n; return v;
  };
  if (maj === 7) {
    if (info === 20) return { v: false, fin: p }; if (info === 21) return { v: true, fin: p }; if (info === 22) return { v: null, fin: p }; if (info === 23) return { v: undefined, fin: p };
    if (info === 25) { if (p + 2 > b.length) throw new Error('CBOR tronqué'); return { v: b.readUInt16BE(p), fin: p + 2 }; }
    if (info === 26) { if (p + 4 > b.length) throw new Error('CBOR tronqué'); return { v: b.readFloatBE(p), fin: p + 4 }; }
    if (info === 27) { if (p + 8 > b.length) throw new Error('CBOR tronqué'); return { v: b.readDoubleBE(p), fin: p + 8 }; }
    throw new Error('CBOR : valeur simple inconnue');
  }
  if (info === 31) throw new Error('CBOR : longueur indéfinie non acceptée');
  const n = long();
  switch (maj) {
    case 0: return { v: n, fin: p };
    case 1: return { v: -1 - n, fin: p };
    case 2: case 3: { if (p + n > b.length) throw new Error('CBOR tronqué'); const x = b.subarray(p, p + n); return { v: maj === 2 ? Buffer.from(x) : x.toString('utf8'), fin: p + n }; }
    case 4: { if (n > 10_000) throw new Error('CBOR : tableau trop long'); const a: Cbor[] = []; for (let i = 0; i < n; i++) { const r = cborLire(b, p, prof + 1); a.push(r.v); p = r.fin; } return { v: a, fin: p }; }
    case 5: { if (n > 10_000) throw new Error('CBOR : table trop longue'); const m = new Map<Cbor, Cbor>(); for (let i = 0; i < n; i++) { const k = cborLire(b, p, prof + 1); const v = cborLire(b, k.fin, prof + 1); m.set(k.v, v.v); p = v.fin; } return { v: m, fin: p }; }
    case 6: return cborLire(b, p, prof + 1); // étiquette : on garde la valeur
    default: throw new Error('CBOR illisible');
  }
}
/** Écrit une valeur en CBOR (entiers, textes, octets, tableaux, tables, booléens). */
export function cborEcrire(v: Cbor): Buffer {
  const tete = (maj: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(maj << 5) | n]);
    if (n < 256) return Buffer.from([(maj << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (maj << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (maj << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([tete(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([tete(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(cborEcrire)]);
  if (v instanceof Map) return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cborEcrire(k), cborEcrire(x)])]);
  if (v === true) return Buffer.from([0xf5]); if (v === false) return Buffer.from([0xf4]); if (v === null) return Buffer.from([0xf6]);
  throw new Error('CBOR : valeur non prise en charge');
}

// ---------------- Clés COSE
/** Algorithmes acceptés : ES256 (-7), EdDSA (-8), RS256 (-257). */
export const ALGS = [-7, -8, -257];
const b64u = (b: Buffer) => b.toString('base64url');
/** Une clé publique COSE → clé de node:crypto et son algorithme. */
export function cleCose(m: Cbor): { cle: KeyObject; alg: number } {
  if (!(m instanceof Map)) throw new Error('clé COSE illisible');
  const kty = m.get(1), alg = Number(m.get(3)), oct = (k: number) => { const x = m.get(k); if (!Buffer.isBuffer(x)) throw new Error('clé COSE incomplète'); return x; };
  if (!ALGS.includes(alg)) throw new Error(`algorithme de clé non accepté (${alg})`);
  if (kty === 2 && alg === -7) { if (m.get(-1) !== 1) throw new Error('courbe non acceptée (P-256 seulement)'); return { cle: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(oct(-2)), y: b64u(oct(-3)) }, format: 'jwk' }), alg }; }
  if (kty === 1 && alg === -8) { if (m.get(-1) !== 6) throw new Error('courbe non acceptée (Ed25519 seulement)'); return { cle: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(oct(-2)) }, format: 'jwk' }), alg }; }
  if (kty === 3 && alg === -257) { const n = oct(-1); if (n.length < 256) throw new Error('clé RSA trop courte'); return { cle: createPublicKey({ key: { kty: 'RSA', n: b64u(n), e: b64u(oct(-2)) }, format: 'jwk' }), alg }; }
  throw new Error('type de clé non accepté');
}

// ---------------- Données de l'authentificateur
export interface DonneesAuth { rpIdHash: Buffer; up: boolean; uv: boolean; compteur: number; credId?: Buffer; cose?: Cbor }
export function lireDonneesAuth(b: Buffer): DonneesAuth {
  if (b.length < 37) throw new Error('données de l\'authentificateur trop courtes');
  const flags = b[32], d: DonneesAuth = { rpIdHash: b.subarray(0, 32), up: Boolean(flags & 0x01), uv: Boolean(flags & 0x04), compteur: b.readUInt32BE(33) };
  if (flags & 0x40) {
    if (b.length < 55) throw new Error('données de la clé tronquées');
    const n = b.readUInt16BE(53); if (n < 16 || n > 1023 || 55 + n > b.length) throw new Error('identifiant de clé invalide');
    d.credId = b.subarray(55, 55 + n); d.cose = cborLire(b, 55 + n).v;
  }
  return d;
}

const sha = (x: Buffer | string) => createHash('sha256').update(x).digest();
const egal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const dec = (x: unknown): Buffer => { const t = String(x ?? ''); if (!/^[A-Za-z0-9_-]*={0,2}$/.test(t) || t.length > 20_000) throw new Error('donnée base64url invalide'); return Buffer.from(t, 'base64url'); };
function lireClientData(raw: Buffer, type: string, defi: string, origine: string): void {
  let c: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try { c = JSON.parse(raw.toString('utf8')) as typeof c; } catch { throw new Error('réponse du navigateur illisible'); }
  if (c.type !== type) throw new Error('réponse du navigateur d\'un autre type');
  if (!c.challenge || !egal(Buffer.from(c.challenge), Buffer.from(defi))) throw new Error('défi différent (réponse rejouée ?)');
  if (c.origin !== origine) throw new Error(`réponse venue d'un autre site (${String(c.origin).slice(0, 80)})`);
  if (c.crossOrigin === true) throw new Error('réponse venue d\'un cadre d\'un autre site');
}

/** Une clé d'accès gardée par Odin (rien de secret : la clé publique, au format SPKI). */
export interface CleAcces { id: string; sub: string; spki: string; alg: number; compteur: number; nom: string; cree: number; vu?: number; rp: string }
/** Le site pour WebAuthn : son origine (schéma + hôte + port) et son nom (rpId). Refusé pour une adresse IP. */
export function siteWebauthn(origine: string): { origine: string; rpId: string } {
  const u = new URL(origine), h = u.hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) throw new Error('Les clés d\'accès demandent un nom (ex. odin.exemple.fr) avec un vrai certificat : par une adresse IP, le navigateur les refuse.');
  if (u.protocol !== 'https:' && h !== 'localhost') throw new Error('Les clés d\'accès demandent une connexion https.');
  return { origine: u.origin, rpId: h };
}
export const nouveauDefi = () => b64u(randomBytes(32));

/** Les options à donner à navigator.credentials.create (le navigateur décode challenge et user.id). */
export function optionsInscription(o: { rpId: string; defi: string; sub: string; login: string; nom: string; deja: string[] }): Record<string, unknown> {
  return { challenge: o.defi, rp: { id: o.rpId, name: 'Odin' }, user: { id: b64u(Buffer.from(o.sub)), name: o.login, displayName: o.nom }, pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })), timeout: 120_000, attestation: 'none', authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, excludeCredentials: o.deja.map((id) => ({ type: 'public-key', id })) };
}
export function optionsConnexion(o: { rpId: string; defi: string }): Record<string, unknown> { return { challenge: o.defi, rpId: o.rpId, timeout: 120_000, userVerification: 'required', allowCredentials: [] }; }

/** Vérifie la réponse d'inscription ; rend la clé à garder. */
export function verifierInscription(r: { clientDataJSON: unknown; attestationObject: unknown }, o: { defi: string; origine: string; rpId: string; sub: string; nom: string; now?: number }): CleAcces {
  const cd = dec(r.clientDataJSON); lireClientData(cd, 'webauthn.create', o.defi, o.origine);
  const att = cborLire(dec(r.attestationObject)).v; if (!(att instanceof Map)) throw new Error('attestation illisible');
  const ad = att.get('authData'); if (!Buffer.isBuffer(ad)) throw new Error('attestation sans données');
  const d = lireDonneesAuth(ad);
  if (!egal(d.rpIdHash, sha(o.rpId))) throw new Error('clé créée pour un autre site');
  if (!d.up || !d.uv) throw new Error('l\'appareil n\'a pas vérifié la personne (empreinte, visage ou code de l\'appareil exigé)');
  if (!d.credId || d.cose === undefined) throw new Error('aucune clé dans la réponse');
  const k = cleCose(d.cose);
  return { id: b64u(d.credId), sub: o.sub, spki: (k.cle.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'), alg: k.alg, compteur: d.compteur, nom: o.nom.replace(/[\u0000-\u001f]/g, ' ').slice(0, 60) || 'clé d\'accès', cree: o.now ?? Date.now(), rp: o.rpId };
}

/** Vérifie une connexion par clé d'accès ; rend la clé (compteur à jour). Lève l'erreur à montrer. */
export function verifierConnexion(r: { id: unknown; clientDataJSON: unknown; authenticatorData: unknown; signature: unknown; userHandle?: unknown }, cles: CleAcces[], o: { defi: string; origine: string; rpId: string; now?: number }): CleAcces {
  const id = String(r.id ?? ''), c = cles.find((x) => x.id === id && x.rp === o.rpId);
  if (!c) throw new Error('clé d\'accès inconnue d\'Odin (elle a peut-être été retirée)');
  if (r.userHandle && dec(r.userHandle).toString('utf8') !== c.sub) throw new Error('cette clé appartient à une autre personne');
  const cd = dec(r.clientDataJSON); lireClientData(cd, 'webauthn.get', o.defi, o.origine);
  const ad = dec(r.authenticatorData), d = lireDonneesAuth(ad);
  if (!egal(d.rpIdHash, sha(o.rpId))) throw new Error('clé utilisée pour un autre site');
  if (!d.up || !d.uv) throw new Error('l\'appareil n\'a pas vérifié la personne');
  const cle = createPublicKey({ key: Buffer.from(c.spki, 'base64'), format: 'der', type: 'spki' }), donnee = Buffer.concat([ad, sha(cd)]), sig = dec(r.signature);
  const ok = c.alg === -7 ? verify('sha256', donnee, { key: cle, dsaEncoding: 'der' }, sig) : c.alg === -257 ? verify('sha256', donnee, cle, sig) : verify(null, donnee, cle, sig);
  if (!ok) throw new Error('signature de la clé d\'accès fausse');
  // Compteur : s'il recule, la clé a peut-être été copiée.
  if ((d.compteur || c.compteur) && d.compteur <= c.compteur) throw new Error('compteur de la clé en arrière : clé peut-être copiée, connexion refusée');
  return { ...c, compteur: d.compteur, vu: o.now ?? Date.now() };
}

/** Le petit programme de la page : base64url ↔ octets, et l'appel au navigateur (texte inséré avec le nonce de la page). */
export const WEBAUTHN_JS = `const odinB=(b)=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const odinD=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),(c)=>c.charCodeAt(0));
async function odinPost(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),credentials:'same-origin'});let j={};try{j=await r.json();}catch{}if(!r.ok||j.ok===false)throw new Error(j.message||'Refusé.');return j;}
async function odinCleCreer(debut,fin,plus){const o=(await odinPost(debut,plus)).options;o.challenge=odinD(o.challenge);o.user.id=odinD(o.user.id);o.excludeCredentials=(o.excludeCredentials||[]).map((x)=>({...x,id:odinD(x.id)}));const c=await navigator.credentials.create({publicKey:o});return odinPost(fin,{...plus,clientDataJSON:odinB(c.response.clientDataJSON),attestationObject:odinB(c.response.attestationObject)});}
async function odinCleSigner(debut,fin,plus){const o=(await odinPost(debut,plus)).options;o.challenge=odinD(o.challenge);const c=await navigator.credentials.get({publicKey:o});return odinPost(fin,{...plus,id:c.id,clientDataJSON:odinB(c.response.clientDataJSON),authenticatorData:odinB(c.response.authenticatorData),signature:odinB(c.response.signature),userHandle:c.response.userHandle?odinB(c.response.userHandle):''});}`;
