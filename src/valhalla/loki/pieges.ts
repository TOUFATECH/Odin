// De nouveaux faux services pour Sirènes (Loki) : RDP, VNC, MySQL/MariaDB, MQTT, partage Windows (SMB),
// API Docker, PostgreSQL. Même règle que les pièges existants : ce sont de FAUX écouteurs qui NOTENT (adresse,
// bannière, identifiants essayés, commandes) puis COUPENT — aucun vrai accès, aucune vraie donnée. Les
// analyseurs (parse…) sont PURS et testés à part (sans réseau). Rien n'est jamais envoyé dehors.

import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';

export type Kind = 'connexion' | 'identifiants' | 'commande' | 'requête' | 'capture';
/** Ce que le moteur de Sirènes prête à un piège : noter une prise (journal + bannissement + incident + rejeu), lire des lignes, capturer un fichier. */
export interface PiegeAide { pris(kind: Kind, detail: string): void; lignes(cb: (l: string) => void): void; capture(url: string): void }

const txt = (b: Buffer, max = 160) => b.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, max);
const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, '').trim();

// ----------------------------------------------------------------------- RDP (bureau à distance, 3389)
/** Le nom d'utilisateur glissé par beaucoup de clients/scanners RDP dans la demande de connexion (Cookie: mstshash=…). Pur. */
export function parseRdpCookie(buf: Buffer): string | undefined {
  const m = /Cookie:\s*mstshash=([^\r\n]{1,64})/i.exec(buf.toString('latin1'));
  return m ? printable(m[1]) || undefined : undefined;
}
function rdp(s: Socket, aide: PiegeAide): void {
  s.once('data', (d: Buffer) => {
    const user = parseRdpCookie(d);
    if (user) aide.pris('identifiants', `${user} / (RDP)`);
    else aide.pris('requête', `RDP : ${txt(d)}`);
    // On répond un refus de négociation TLS/CredSSP (comme un Windows protégé), puis on coupe.
    try { s.end(Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x03, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00])); } catch { /* déjà coupé */ }
  });
}

// ----------------------------------------------------------------------- VNC (écran à distance, 5900)
function vnc(s: Socket, aide: PiegeAide): void {
  s.write('RFB 003.008\n');
  s.once('data', (d: Buffer) => { aide.pris('requête', `VNC : client ${printable(d.toString('latin1').split('\n')[0]).slice(0, 40) || 'inconnu'}`); s.end(); });
}

// ----------------------------------------------------------------------- MySQL / MariaDB (3306)
/** Une bannière d'accueil MySQL plausible (protocole 10, version 5.7) : assez réelle pour que le client envoie sa demande de connexion. Pur. */
export function mysqlGreeting(): Buffer {
  const version = Buffer.from('5.7.42-0ubuntu0.18.04.1\0', 'latin1');
  const sel1 = randomBytes(8), sel2 = randomBytes(12);
  const corps = Buffer.concat([
    Buffer.from([0x0a]), version,
    Buffer.from([0x01, 0x00, 0x00, 0x00]), sel1, Buffer.from([0x00]),
    Buffer.from([0xff, 0xf7]), Buffer.from([0x21]), Buffer.from([0x02, 0x00]), Buffer.from([0xff, 0x81]), Buffer.from([0x15]),
    Buffer.alloc(10), sel2, Buffer.from([0x00]), Buffer.from('mysql_native_password\0', 'latin1'),
  ]);
  const head = Buffer.alloc(4); head.writeUIntLE(corps.length, 0, 3); head[3] = 0;
  return Buffer.concat([head, corps]);
}
/** Le nom d'utilisateur essayé, lu dans la demande de connexion MySQL (en clair ; le mot de passe, lui, est brouillé). Pur. */
export function parseMysqlUser(buf: Buffer): string | undefined {
  if (buf.length < 4 + 33) return undefined;
  const corps = buf.subarray(4); // saute l'en-tête de paquet (3 o longueur + 1 o n°)
  let i = 32; // 4 o capacités + 4 o taille max + 1 o jeu de caractères + 23 o réservés
  const fin = corps.indexOf(0x00, i); if (fin < 0 || fin === i) return undefined;
  return printable(corps.subarray(i, Math.min(fin, i + 64)).toString('latin1')) || undefined;
}
function mysql(s: Socket, aide: PiegeAide): void {
  s.write(mysqlGreeting());
  s.once('data', (d: Buffer) => { const u = parseMysqlUser(d); if (u) aide.pris('identifiants', `${u} / (MySQL, mot de passe brouillé)`); else aide.pris('requête', `MySQL : ${txt(d)}`); try { s.end(Buffer.from([0x17, 0x00, 0x00, 0x02, 0xff, 0x15, 0x04, ...Buffer.from('#28000Access denied', 'latin1')])); } catch { /* coupé */ } });
}

// ----------------------------------------------------------------------- PostgreSQL (5432 → 54320)
/** La demande de connexion PostgreSQL : l'utilisateur et la base, EN CLAIR. `ssl` : c'est une demande de chiffrement (à refuser). Pur. */
export function parsePgStartup(buf: Buffer): { ssl?: boolean; user?: string; database?: string } | undefined {
  if (buf.length < 8) return undefined;
  const len = buf.readUInt32BE(0), code = buf.readUInt32BE(4);
  if (len === 8 && code === 80877103) return { ssl: true }; // SSLRequest
  if (code !== 196608) return undefined; // protocole 3.0 attendu
  const params: Record<string, string> = {}; let i = 8;
  while (i < buf.length) { const k = buf.indexOf(0x00, i); if (k < 0 || k === i) break; const key = buf.subarray(i, k).toString('latin1'); const v = buf.indexOf(0x00, k + 1); if (v < 0) break; params[key] = buf.subarray(k + 1, v).toString('latin1'); i = v + 1; }
  return { user: params.user ? printable(params.user).slice(0, 64) : undefined, database: params.database ? printable(params.database).slice(0, 64) : undefined };
}
/** Le mot de passe PostgreSQL envoyé en clair (message « p »), après qu'on l'a demandé en clair. Pur. */
export function parsePgPassword(buf: Buffer): string | undefined {
  if (buf.length < 5 || buf[0] !== 0x70) return undefined;
  const fin = buf.indexOf(0x00, 5); return printable(buf.subarray(5, fin < 0 ? buf.length : fin).toString('latin1')).slice(0, 128) || undefined;
}
const pgAuthClair = Buffer.concat([Buffer.from('R'), (() => { const b = Buffer.alloc(8); b.writeUInt32BE(8, 0); b.writeUInt32BE(3, 4); return b; })()]);
function pgErreur(msg: string): Buffer { const corps = Buffer.concat([Buffer.from('SFATAL\0C28000\0M', 'latin1'), Buffer.from(`${msg}\0`, 'latin1'), Buffer.from([0x00])]); const b = Buffer.alloc(5); b[0] = 0x45; b.writeUInt32BE(corps.length + 4, 1); return Buffer.concat([b, corps]); }
function postgres(s: Socket, aide: PiegeAide): void {
  let etape = 0, user = '';
  s.on('data', (d: Buffer) => {
    if (etape === 0) {
      const p = parsePgStartup(d);
      if (p?.ssl) { s.write(Buffer.from('N')); return; } // refuse le chiffrement : le client renverra la demande en clair
      user = p?.user ?? '';
      aide.pris('requête', `PostgreSQL : utilisateur « ${user || '?'} », base « ${p?.database ?? '?'} »`);
      etape = 1; s.write(pgAuthClair); return; // demande le mot de passe EN CLAIR
    }
    const mdp = parsePgPassword(d);
    if (mdp) aide.pris('identifiants', `${user || '?'} / ${mdp}`);
    try { s.end(pgErreur('password authentication failed')); } catch { /* coupé */ }
  });
}

// ----------------------------------------------------------------------- MQTT (objets connectés, 1883 → 18830)
/** La demande de connexion MQTT (CONNECT) : identité de l'objet, utilisateur et mot de passe, EN CLAIR. Pur. */
export function parseMqttConnect(buf: Buffer): { proto?: string; clientId?: string; user?: string; pass?: string } | undefined {
  if (buf.length < 2 || (buf[0] & 0xf0) !== 0x10) return undefined;
  let i = 1, mult = 1, rl = 0; // longueur restante (varint)
  for (let n = 0; n < 4 && i < buf.length; n++) { const b = buf[i++]; rl += (b & 0x7f) * mult; mult *= 128; if (!(b & 0x80)) break; }
  const str = (): string | undefined => { if (i + 2 > buf.length) return undefined; const l = buf.readUInt16BE(i); i += 2; if (i + l > buf.length) return undefined; const v = buf.subarray(i, i + l).toString('utf8'); i += l; return v; };
  const proto = str(); if (proto === undefined) return undefined; // « MQTT » ou « MQIsdp »
  if (i >= buf.length) return { proto };
  const niveau = buf[i++]; const flags = i < buf.length ? buf[i++] : 0; i += 2; // keepalive
  if (niveau >= 5) { let m = 1, pl = 0; for (let n = 0; n < 4 && i < buf.length; n++) { const b = buf[i++]; pl += (b & 0x7f) * m; m *= 128; if (!(b & 0x80)) break; } i += pl; } // propriétés v5 sautées
  const clientId = str();
  if (flags & 0x04) { str(); str(); } // testament (sujet + message) ignoré
  const user = flags & 0x80 ? str() : undefined;
  const pass = flags & 0x40 ? str() : undefined;
  return { proto: printable(proto), clientId: clientId ? printable(clientId).slice(0, 64) : undefined, user: user ? printable(user).slice(0, 64) : undefined, pass: pass ? printable(pass).slice(0, 64) : undefined };
}
function mqtt(s: Socket, aide: PiegeAide): void {
  let fait = false;
  s.on('data', (d: Buffer) => {
    if (!fait) { const c = parseMqttConnect(d); fait = true; if (c) { if (c.user || c.pass) aide.pris('identifiants', `${c.user ?? ''} / ${c.pass ?? ''}`.trim()); aide.pris('requête', `MQTT : objet « ${c.clientId ?? '?'} » (${c.proto ?? '?'})`); } else aide.pris('requête', `MQTT : ${txt(d)}`); s.write(Buffer.from([0x20, 0x02, 0x00, 0x00])); return; } // CONNACK accepté
    if ((d[0] & 0xf0) === 0x82) aide.pris('commande', `MQTT abonnement : ${txt(d.subarray(2), 80)}`);
    else if ((d[0] & 0xf0) === 0x30) aide.pris('commande', `MQTT publication : ${txt(d.subarray(2), 120)}`);
    try { s.end(); } catch { /* coupé */ }
  });
}

// ----------------------------------------------------------------------- Partage Windows (SMB, 445 → 4445)
/** Reconnaît une tentative SMB (partage de fichiers Windows) et dit laquelle. Au moins : la tentative est notée honnêtement. Pur. */
export function smbSignature(buf: Buffer): string | undefined {
  for (let i = 0; i + 3 < buf.length && i < 8; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0x53 && buf[i + 2] === 0x4d && buf[i + 3] === 0x42) return 'SMB1 (ancien partage Windows)';
    if (buf[i] === 0xfe && buf[i + 1] === 0x53 && buf[i + 2] === 0x4d && buf[i + 3] === 0x42) return 'SMB2/3 (partage Windows)';
  }
  return undefined;
}
function smb(s: Socket, aide: PiegeAide): void {
  s.once('data', (d: Buffer) => { const sig = smbSignature(d); aide.pris('requête', sig ? `Partage Windows : tentative ${sig}` : `Partage Windows : ${txt(d)}`); s.end(); });
}

// ----------------------------------------------------------------------- API Docker exposée (2375 → 23750)
/** La réponse d'une fausse API Docker à une requête (comme un démon exposé par erreur). Pur. */
export function dockerReponse(methode: string, chemin: string): { code: number; corps: string } {
  if (/^\/(v[\d.]+\/)?_ping$/.test(chemin)) return { code: 200, corps: 'OK' };
  if (/^\/(v[\d.]+\/)?version$/.test(chemin)) return { code: 200, corps: JSON.stringify({ Version: '24.0.7', ApiVersion: '1.43', Os: 'linux', Arch: 'amd64', KernelVersion: '5.15.0-91-generic' }) };
  if (/^\/(v[\d.]+\/)?info$/.test(chemin)) return { code: 200, corps: JSON.stringify({ ID: 'ODIN:FAKE', Containers: 0, Images: 0, ServerVersion: '24.0.7', OperatingSystem: 'Ubuntu 22.04.3 LTS' }) };
  if (/containers\/json/.test(chemin)) return { code: 200, corps: '[]' };
  if (/containers\/create/.test(chemin) || /images\/create/.test(chemin)) return { code: 201, corps: JSON.stringify({ Id: randomBytes(32).toString('hex'), Warnings: [] }) };
  return { code: 404, corps: JSON.stringify({ message: 'page not found' }) };
}
function docker(s: Socket, aide: PiegeAide): void {
  let brut = '';
  s.on('data', (d: Buffer) => {
    brut += d.toString('latin1'); if (!brut.includes('\r\n\r\n') && brut.length < 65536) return;
    const [tete, corps = ''] = brut.split('\r\n\r\n'), ligne = tete.split('\r\n')[0], [methode = 'GET', chemin = '/'] = ligne.split(' ');
    aide.pris('requête', `Docker ${methode} ${chemin.slice(0, 120)}`);
    if (corps.trim()) { aide.pris('commande', `Docker charge : ${printable(corps).slice(0, 200)}`); for (const u of [...corps.matchAll(/(https?|ftp):\/\/[^\s'";|&\\]+/g)].map((m) => m[0]).slice(0, 3)) aide.capture(u); }
    const r = dockerReponse(methode, chemin);
    try { s.end(`HTTP/1.1 ${r.code} ${r.code === 200 ? 'OK' : r.code === 201 ? 'Created' : 'Not Found'}\r\nServer: Docker/24.0.7\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(r.corps)}\r\nConnection: close\r\n\r\n${r.corps}`); } catch { /* coupé */ }
    brut = '';
  });
}

/** Lance le faux service d'un nouveau piège sur un socket déjà accepté. Renvoie faux si l'identifiant n'est pas géré ici. */
export function jouerNouveauPiege(id: string, s: Socket, aide: PiegeAide): boolean {
  switch (id) {
    case 'vali': rdp(s, aide); return true;
    case 'nari': vnc(s, aide); return true;
    case 'byleist': mysql(s, aide); return true;
    case 'angrboda': postgres(s, aide); return true;
    case 'helblindi': mqtt(s, aide); return true;
    case 'sigyn': smb(s, aide); return true;
    case 'eldr': docker(s, aide); return true;
    default: return false;
  }
}
/** Les identifiants des pièges gérés ici (pour le moteur). */
export const NOUVEAUX_PIEGES = ['vali', 'nari', 'byleist', 'angrboda', 'helblindi', 'sigyn', 'eldr'] as const;
