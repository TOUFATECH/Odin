import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMail, decodeWords, mailText, parseFetchHeaders } from '../src/tools/mail.ts';
import { buildIcs, parseIcs } from '../src/tools/calendar.ts';
import { formatStates } from '../src/tools/homeassistant.ts';
import { findDocs, indexDocs } from '../src/tools/docindex.ts';
import { parseCloudflareUrl, parseTailscaleName } from '../src/web/tunnel.ts';
import { activeProfile, voiceFor } from '../src/profiles.ts';

test('mail : en-têtes encodés, parties MIME, liste IMAP, message à envoyer', () => {
  assert.equal(decodeWords('=?UTF-8?B?RmFjdHVyZSDDqWxlY3RyaWNpdMOp?='), 'Facture électricité');
  assert.equal(decodeWords('=?iso-8859-1?Q?R=E9union_demain?='), 'Réunion demain');
  const raw = 'From: =?UTF-8?Q?EDF?= <noreply@edf.fr>\r\nSubject: Votre facture\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nMontant : 84,20 =E2=82=AC\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--b1--\r\n';
  const m = mailText(raw);
  assert.equal(m.from, 'EDF <noreply@edf.fr>');
  assert.equal(m.text, 'Montant : 84,20 €');
  const list = parseFetchHeaders('* 1 FETCH (UID 42 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {58}\r\nFrom: Alice <a@x.fr>\r\nSubject: Coucou\r\nDate: Mon, 3 Nov 2026\r\n\r\n)\r\n* 2 FETCH (UID 43 FLAGS () BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {30}\r\nFrom: Bob <b@x.fr>\r\nSubject: Hé\r\n\r\n)\r\nA3 OK');
  assert.deepEqual(list.map((x) => [x.uid, x.seen, x.subject]), [[42, true, 'Coucou'], [43, false, 'Hé']]);
  const out = buildMail('Moi <moi@x.fr>', ['a@x.fr'], 'Réunion', 'Bonjour\nà demain');
  assert.match(out, /Subject: =\?UTF-8\?B\?/);
  assert.equal(Buffer.from(out.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString(), 'Bonjour\r\nà demain');
});

test('agenda : évènements ICS (simples, journée, hebdomadaires) et création CalDAV', () => {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z\r\nSUMMARY:Dentiste\r\nLOCATION:Mamoudzou\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:Férié\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261103T180000\r\nDTEND:20261103T190000\r\nRRULE:FREQ=WEEKLY;COUNT=10\r\nSUMMARY:Sport\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const ev = parseIcs(ics, new Date('2026-11-09T00:00:00'), new Date('2026-11-16T00:00:00'));
  assert.deepEqual(ev.map((e) => e.title), ['Dentiste', 'Sport', 'Férié']);
  assert.equal(ev[1].start.getDate(), 10, 'répétition hebdomadaire');
  assert.ok(ev[2].allDay);
  const out = buildIcs('u1', 'Réunion; budget', new Date('2026-11-12T08:00:00Z'), new Date('2026-11-12T09:00:00Z'));
  assert.match(out, /DTSTART:20261112T080000Z/);
  assert.match(out, /SUMMARY:Réunion\\; budget/);
});

test('Home Assistant : liste filtrée par mot (sans accents) ou domaine', () => {
  const st = [
    { entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Lumière Salon' } },
    { entity_id: 'sensor.temp_salon', state: '24.5', attributes: { friendly_name: 'Température salon', unit_of_measurement: '°C' } },
    { entity_id: 'light.cuisine', state: 'off', attributes: { friendly_name: 'Cuisine' } },
  ];
  assert.equal(formatStates(st, 'Salon').split('\n').length, 2);
  assert.match(formatStates(st, 'temperature'), /24\.5 °C/);
  assert.equal(formatStates(st, '', 'light').split('\n').length, 2);
});

test('documents : index (nom et contenu), recherche, fichiers modifiés seulement, suppression', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-docs-'));
  const db = new DatabaseSync(':memory:');
  try {
    mkdirSync(join(dir, 'Factures'));
    writeFileSync(join(dir, 'Factures', 'edf-2026-03.txt'), 'EDF facture électricité mars 2026 montant 84,20');
    writeFileSync(join(dir, 'contrat_assurance_voiture.txt'), 'Contrat MAIF véhicule');
    writeFileSync(join(dir, 'photo.jpg'), 'xx');
    assert.equal(indexDocs(db, [dir]).updated, 3);
    assert.match(findDocs(db, 'facture electricite mars')[0].path, /edf-2026-03\.txt$/);
    assert.match(findDocs(db, 'assurance voiture')[0].path, /contrat_assurance_voiture/);
    assert.equal(indexDocs(db, [dir]).updated, 0, 'rien de modifié : rien de relu');
    rmSync(join(dir, 'photo.jpg'));
    assert.equal(indexDocs(db, [dir]).removed, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('accès extérieur et personnalités', () => {
  assert.equal(parseCloudflareUrl('INF |  https://calm-river-12.trycloudflare.com  |'), 'https://calm-river-12.trycloudflare.com');
  assert.equal(parseTailscaleName('{"Self":{"DNSName":"odin.tail1234.ts.net."}}'), 'odin.tail1234.ts.net');
  const cfg = { profiles: { active: 'maison', auto: true, list: [{ id: 'maison', name: 'Maison', tone: 'détendu', voiceId: '' }, { id: 'travail', name: 'Travail', tone: 'concis', voiceId: 'voix-pro' }] } };
  assert.equal(activeProfile(cfg, new Date('2026-11-05T10:00:00'))?.id, 'travail', 'jeudi 10 h');
  assert.equal(activeProfile(cfg, new Date('2026-11-08T10:00:00'))?.id, 'maison', 'dimanche');
  assert.equal(voiceFor({ tts: { voiceId: 'défaut' } }, cfg, new Date('2026-11-05T10:00:00')).tts.voiceId, 'voix-pro');
  assert.equal(activeProfile({ profiles: { ...cfg.profiles, auto: false } })?.id, 'maison');
});
