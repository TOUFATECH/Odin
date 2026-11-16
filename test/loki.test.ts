// Sirènes (Loki) : les nouveaux pièges notent bien l'IP et les identifiants, les adresses prises sont partagées à
// Méduse, l'origine géo est résolue, et une session enregistrée se rejoue au bon rythme (horodatages), s'exporte
// et se résume. Tout en logique pure / fichiers temporaires : aucun vrai socket, aucun vrai réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRdpCookie, parseMysqlUser, mysqlGreeting, parsePgStartup, parsePgPassword, parseMqttConnect, smbSignature, dockerReponse } from '../src/valhalla/loki/pieges.ts';
import { ouvrirSession, noter, fermerSession, rejouer, resume, versCast, versTexte, sauver, charger, lister, estTerminal, lecteurHtml, type Session } from '../src/valhalla/loki/rejeu.ts';
import { voirAttaquant, reseauxAttaquants, lireAttaquants, lokiDir } from '../src/valhalla/loki/attaquants.ts';
import { dansReseaux } from '../src/valhalla/geri/malveillant.ts';
import { estMalveillante } from '../src/valhalla/modules/geri.ts';
import { LokiEngine } from '../src/valhalla/modules/loki.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { loki } from '../src/valhalla/modules/loki.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'odin-loki-'));

// ----------------------------------------------------------------- 1. Les nouveaux pièges notent l'IP / les identifiants
test('RDP : le nom d\'utilisateur tenté (Cookie mstshash) est lu', () => {
  assert.equal(parseRdpCookie(Buffer.from('\x03\x00\x00\x2b\x26\xe0\x00\x00\x00\x00\x00Cookie: mstshash=Administrateur\r\n', 'latin1')), 'Administrateur');
  assert.equal(parseRdpCookie(Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e])), undefined);
});
test('MySQL : la bannière est plausible et le nom d\'utilisateur essayé est lu en clair', () => {
  const g = mysqlGreeting(); assert.equal(g[4], 0x0a, 'protocole 10'); assert.match(g.subarray(5).toString('latin1'), /^5\.7\./);
  const payload = Buffer.concat([Buffer.alloc(32), Buffer.from('root\0', 'latin1'), Buffer.from([0x14]), randomBytes(20)]);
  const head = Buffer.alloc(4); head.writeUIntLE(payload.length, 0, 3); head[3] = 1;
  assert.equal(parseMysqlUser(Buffer.concat([head, payload])), 'root');
});
test('PostgreSQL : utilisateur et base en clair, demande de chiffrement reconnue, mot de passe en clair', () => {
  const ssl = Buffer.alloc(8); ssl.writeUInt32BE(8, 0); ssl.writeUInt32BE(80877103, 4);
  assert.deepEqual(parsePgStartup(ssl), { ssl: true });
  const params = Buffer.from('user\0admin\0database\0prod\0\0', 'latin1');
  const body = Buffer.concat([Buffer.from([0x00, 0x03, 0x00, 0x00]), params]);
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length + 4, 0);
  assert.deepEqual(parsePgStartup(Buffer.concat([len, body])), { user: 'admin', database: 'prod' });
  const corps = Buffer.from('S3cr3t!\0', 'latin1'); const p = Buffer.alloc(5); p[0] = 0x70; p.writeUInt32BE(corps.length + 4, 1);
  assert.equal(parsePgPassword(Buffer.concat([p, corps])), 'S3cr3t!');
});
test('MQTT : objet, utilisateur et mot de passe lus dans la demande de connexion', () => {
  const s = (x: string) => { const b = Buffer.from(x, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length, 0); return Buffer.concat([l, b]); };
  const vh = Buffer.concat([s('MQTT'), Buffer.from([0x04, 0xc2, 0x00, 0x3c])]);
  const payload = Buffer.concat([s('capteur-salon'), s('mqttuser'), s('mqttpass')]);
  const rest = Buffer.concat([vh, payload]);
  const c = parseMqttConnect(Buffer.concat([Buffer.from([0x10, rest.length]), rest]));
  assert.equal(c?.clientId, 'capteur-salon'); assert.equal(c?.user, 'mqttuser'); assert.equal(c?.pass, 'mqttpass');
});
test('SMB et Docker : la tentative est reconnue honnêtement', () => {
  assert.match(smbSignature(Buffer.from([0x00, 0, 0, 0x55, 0xff, 0x53, 0x4d, 0x42])) ?? '', /SMB1/);
  assert.match(smbSignature(Buffer.from([0x00, 0, 0, 0x55, 0xfe, 0x53, 0x4d, 0x42])) ?? '', /SMB2/);
  assert.equal(smbSignature(Buffer.from('GET / HTTP', 'latin1')), undefined);
  assert.equal(dockerReponse('GET', '/version').code, 200);
  assert.match(dockerReponse('GET', '/version').corps, /ApiVersion/);
  assert.equal(dockerReponse('POST', '/v1.43/containers/create').code, 201);
});

// ----------------------------------------------------------------- 2. Les IP d'attaquants protègent toute la maison (Méduse)
test('une IP prise par un piège est partagée à Méduse (liste locale lue par geri)', () => {
  const home = tmp();
  try {
    const dir = lokiDir(home); mkdirSync(dir, { recursive: true });
    voirAttaquant(dir, '203.0.113.9', { at: '2026-01-01T00:00:00Z', pays: 'NL', piege: 'Morphée' });
    const reseaux = reseauxAttaquants(home);
    assert.ok(dansReseaux('203.0.113.9', reseaux), 'l\'attaquant est dans la liste partagée');
    assert.ok(!dansReseaux('8.8.8.8', reseaux), 'une autre adresse ne l\'est pas');
    assert.equal(lireAttaquants(dir)['203.0.113.9']?.pays, 'NL');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('record() d\'un piège : note l\'IP, résout l\'origine géo, partage à Méduse et émet « piege »', () => {
  const home = tmp();
  const v = new Valhalla(home, [loki], { now: () => new Date('2026-01-01T00:00:00Z') });
  try {
    writeFileSync(join(home, 'ip-pays.csv'), '203.0.113.0,203.0.113.255,NL\n');
    const evts: Array<{ type: string; data: Record<string, unknown> }> = [];
    v.events.on('event', (e: { type: string; data: Record<string, unknown> }) => evts.push(e));
    const eng = new LokiEngine(v.ctx('loki'));
    eng.record({ trap: 'Morphée', ip: '203.0.113.9', port: 3389, kind: 'identifiants', detail: 'Administrateur / 123456' });
    const a = lireAttaquants(lokiDir(home));
    assert.equal(a['203.0.113.9']?.n, 1, 'l\'IP est notée');
    assert.equal(a['203.0.113.9']?.pays, 'NL', 'l\'origine géo est résolue');
    assert.ok(evts.some((e) => e.type === 'piege' && e.data.ip === '203.0.113.9'), 'l\'événement remonte aux incidents');
    assert.ok(estMalveillante(v.ctx('geri'))('203.0.113.9'), 'Méduse signale désormais cette adresse pour toute la maison');
    assert.ok(!estMalveillante(v.ctx('geri'))('8.8.8.8'), 'une adresse jamais vue reste sûre');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

// ----------------------------------------------------------------- 3. Enregistrement → rejeu au bon rythme, export, résumé
function sessionExemple(): Session {
  const s = ouvrirSession({ id: 'abc123', trapId: 'narfi', trap: 'Loki', proto: 'Telnet', ip: '203.0.113.9', port: 2323, pays: 'NL', at: '2026-01-01T00:00:00Z', now: 1000 });
  noter(s, 'out', 'login: ', 1000);          // t = 0
  noter(s, 'in', 'root\r\n', 1500);           // t = 500
  noter(s, 'note', 'identifiants: root / 123456', 1500);
  noter(s, 'out', 'Password: ', 1600);
  noter(s, 'in', 'uname -a\r\n', 2500);       // t = 1500
  noter(s, 'note', 'commande: uname -a', 2500);
  fermerSession(s, '2026-01-01T00:00:03Z');
  return s;
}
test('une session se rejoue AU BON RYTHME (les écarts viennent des horodatages)', () => {
  const s = sessionExemple();
  const frames = rejouer(s);
  assert.deepEqual(frames.map((f) => f.delai), [0, 500, 0, 100, 900, 0], 'chaque image attend le bon temps');
  assert.equal(frames[1].dir, 'in'); assert.equal(frames[1].data, 'root\r\n');
  // Le raccourcissement des silences garde l'ordre sans dépasser le plafond.
  assert.deepEqual(rejouer(s, 300).map((f) => f.delai), [0, 300, 0, 100, 300, 0]);
});
test('le résumé liste les commandes et les identifiants essayés', () => {
  const r = resume(sessionExemple());
  assert.ok(r.commandes.includes('uname -a'), 'la commande tapée est listée');
  assert.deepEqual(r.identifiants, ['root / 123456'], 'l\'identifiant essayé est listé');
  assert.equal(r.ip, '203.0.113.9'); assert.equal(r.pays, 'NL'); assert.ok(r.notable);
});
test('exports : texte horodaté et asciinema .cast corrects', () => {
  const s = sessionExemple();
  const txt = versTexte(s);
  assert.match(txt, /\[\+0\.50s\]/); assert.match(txt, /203\.0\.113\.9/); assert.match(txt, /uname -a/);
  const cast = versCast(s), lignes = cast.trim().split('\n');
  const entete = JSON.parse(lignes[0]); assert.equal(entete.version, 2);
  const ev1 = JSON.parse(lignes[1]); assert.equal(ev1[1], 'o'); assert.equal(typeof ev1[0], 'number');
  assert.equal(lignes.length - 1, s.events.filter((e) => e.dir !== 'note').length, 'les notes ne sont pas dans le .cast');
  assert.ok(estTerminal('narfi') && !estTerminal('skoll'));
  assert.match(lecteurHtml(s), /<!doctype html>/i);
});
test('rangement des sessions : aller-retour et rétention réglable', () => {
  const home = tmp();
  try {
    const dir = lokiDir(home); mkdirSync(dir, { recursive: true });
    sauver(dir, sessionExemple(), 500);
    const lu = charger(dir, 'abc123');
    assert.equal(lu?.ip, '203.0.113.9'); assert.equal(lu?.events.length, 6);
    for (const id of ['s1', 's2', 's3']) sauver(dir, { ...sessionExemple(), id, start: id === 's3' ? 9000 : id === 's2' ? 8000 : 7000 }, 2);
    assert.ok(lister(dir).length <= 2, 'la rétention garde au plus 2 sessions (les plus récentes)');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
