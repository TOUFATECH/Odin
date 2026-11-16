// SIP : la signalisation d'un appel (texte sur UDP), en pur Node (node:dgram, node:crypto), écrite d'après la norme
// publique (RFC 3261 pour les messages, RFC 2617 pour l'authentification digest) — rien recopié d'un code sous licence.
// Enchaînement normal d'un appel sortant : REGISTER → 401 (le serveur envoie un « nonce ») → REGISTER avec la réponse
// digest → 200 OK ; puis INVITE → 100/180 (ça sonne) → 200 OK (avec le SDP) → ACK → … → BYE → 200 OK.
//
// La réponse digest se CALCULE des deux côtés et doit être identique : c'est ce qui prouve qu'on connaît le mot de
// passe, sans jamais l'envoyer. L'essai (keryx-sip.test.ts) le vérifie contre un faux serveur.

import { createHash, randomBytes } from 'node:crypto';

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex');

export interface DefiDigest { realm: string; nonce: string; qop?: string; opaque?: string; algorithm?: string }
export interface EntreeDigest { username: string; password: string; realm: string; nonce: string; uri: string; method: string; qop?: string; nc?: string; cnonce?: string }

/**
 * La réponse digest de la RFC 2617. Avec qop=auth :
 *   HA1 = MD5(user:realm:pass) · HA2 = MD5(method:uri) · réponse = MD5(HA1:nonce:nc:cnonce:qop:HA2).
 * Sans qop (ancien) : réponse = MD5(HA1:nonce:HA2). Pur et déterministe (donc testable des deux côtés).
 */
export function reponseDigest(e: EntreeDigest): string {
  const ha1 = md5(`${e.username}:${e.realm}:${e.password}`);
  const ha2 = md5(`${e.method}:${e.uri}`);
  if (e.qop) return md5(`${ha1}:${e.nonce}:${e.nc ?? '00000001'}:${e.cnonce ?? ''}:${e.qop}:${ha2}`);
  return md5(`${ha1}:${e.nonce}:${ha2}`);
}

/** Lit un en-tête WWW-Authenticate / Proxy-Authenticate (Digest …). */
export function lireDefi(entete: string): DefiDigest | undefined {
  if (!/^Digest\b/i.test(entete.trim())) return undefined;
  const champ = (nom: string): string | undefined => {
    const m = new RegExp(`${nom}\\s*=\\s*(?:"([^"]*)"|([^,\\s]+))`, 'i').exec(entete);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  const realm = champ('realm'), nonce = champ('nonce');
  if (realm === undefined || nonce === undefined) return undefined;
  return { realm, nonce, qop: champ('qop'), opaque: champ('opaque'), algorithm: champ('algorithm') };
}

/** Fabrique l'en-tête Authorization qui répond à un défi. */
export function enteteAutorisation(e: { username: string; password: string; uri: string; method: string; defi: DefiDigest; cnonce?: string; nc?: string }): string {
  const qop = e.defi.qop ? (e.defi.qop.split(',')[0].trim() || undefined) : undefined;
  const cnonce = e.cnonce ?? randomBytes(8).toString('hex');
  const nc = e.nc ?? '00000001';
  const reponse = reponseDigest({ username: e.username, password: e.password, realm: e.defi.realm, nonce: e.defi.nonce, uri: e.uri, method: e.method, qop, nc, cnonce });
  const parts = [
    `username="${e.username}"`, `realm="${e.defi.realm}"`, `nonce="${e.defi.nonce}"`, `uri="${e.uri}"`,
    `response="${reponse}"`, `algorithm=${e.defi.algorithm ?? 'MD5'}`,
  ];
  if (qop) { parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`); }
  if (e.defi.opaque) parts.push(`opaque="${e.defi.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

export interface MessageSip {
  // Requête : methode + uri ; réponse : code + raison.
  methode?: string; uri?: string; code?: number; raison?: string;
  entetes: Record<string, string>;
  corps: string;
}

/** Sépare le texte d'un message SIP en ligne de départ, en-têtes et corps. Rejette vite une trame informe. */
export function lireMessage(texte: string): MessageSip | undefined {
  const coupe = texte.indexOf('\r\n\r\n');
  const tete = coupe >= 0 ? texte.slice(0, coupe) : texte;
  const corps = coupe >= 0 ? texte.slice(coupe + 4) : '';
  const lignes = tete.split('\r\n');
  if (!lignes.length || !lignes[0].trim()) return undefined;
  const depart = lignes[0];
  const entetes: Record<string, string> = {};
  for (const l of lignes.slice(1)) {
    const i = l.indexOf(':'); if (i < 0) continue;
    const nom = l.slice(0, i).trim().toLowerCase(), val = l.slice(i + 1).trim();
    entetes[nom] = entetes[nom] ? `${entetes[nom]},${val}` : val;
  }
  const rep = /^SIP\/2\.0\s+(\d{3})\s*(.*)$/.exec(depart);
  if (rep) return { code: Number(rep[1]), raison: rep[2], entetes, corps };
  const req = /^([A-Z]+)\s+(\S+)\s+SIP\/2\.0$/.exec(depart);
  if (req) return { methode: req[1], uri: req[2], entetes, corps };
  return undefined;
}

/** Assemble un message SIP (requête ou réponse) à partir de sa ligne de départ, ses en-têtes et son corps. */
export function ecrireMessage(depart: string, entetes: Record<string, string>, corps = ''): string {
  const e = { ...entetes };
  if (corps) e['Content-Length'] = String(Buffer.byteLength(corps, 'utf8'));
  else if (!('Content-Length' in e)) e['Content-Length'] = '0';
  const tete = [depart, ...Object.entries(e).map(([k, v]) => `${k}: ${v}`)].join('\r\n');
  return `${tete}\r\n\r\n${corps}`;
}

/** Un SDP minimal pour un appel G.711 (µ-law et A-law), audio RTP sur le port donné. */
export function sdpAudio(ip: string, port: number): string {
  return [
    'v=0', `o=odin ${Date.now()} ${Date.now()} IN IP4 ${ip}`, 's=Keryx', `c=IN IP4 ${ip}`, 't=0 0',
    `m=audio ${port} RTP/AVP 0 8`, 'a=rtpmap:0 PCMU/8000', 'a=rtpmap:8 PCMA/8000', 'a=sendrecv',
  ].join('\r\n') + '\r\n';
}

/** Lit l'adresse et le port audio d'un SDP (ligne « m=audio … » et « c=IN IP4 … »). */
export function lireSdp(corps: string): { ip?: string; port?: number; codecs: number[] } | undefined {
  const m = /^m=audio\s+(\d+)\s+RTP\/AVP\s+([\d\s]+)/m.exec(corps);
  if (!m) return undefined;
  const c = /^c=IN IP4\s+(\S+)/m.exec(corps);
  return { ip: c?.[1], port: Number(m[1]), codecs: m[2].trim().split(/\s+/).map(Number) };
}

/** Une balise / un identifiant d'appel courts et aléatoires. */
export const jeton = (n = 10): string => randomBytes(n).toString('hex').slice(0, n);
