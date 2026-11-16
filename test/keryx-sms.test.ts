// Kéryx — SMS par modem AT : analyse des réponses, et l'enchaînement complet (entrant + sortant) contre un FAUX modem,
// octets exacts (dont le Ctrl-Z 0x1A qui termine un SMS). Rien sur du vrai matériel. UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandeEnvoi, commandeLecture, LecteurModem, lireLigne, numeroPropre } from '../src/valhalla/keryx/at.ts';
import { fauxModem } from '../src/valhalla/keryx/faux.ts';
import { NON_ESSAYE } from '../src/valhalla/keryx/types.ts';

test('AT : lecture des réponses du modem', () => {
  assert.deepEqual(lireLigne('OK'), { type: 'ok' });
  assert.deepEqual(lireLigne('> '), { type: 'invite' });
  assert.deepEqual(lireLigne('+CMTI: "SM",3'), { type: 'arrivee', stockage: 'SM', index: 3 });
  assert.deepEqual(lireLigne('+CMGS: 42'), { type: 'envoye', ref: 42 });
  assert.deepEqual(lireLigne('+CLIP: "+33612345678",145'), { type: 'appelant', numero: '+33612345678' });
  assert.equal(lireLigne('ERROR')!.type, 'erreur');
  assert.equal(numeroPropre('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(commandeEnvoi('+33612345678'), 'AT+CMGS="+33612345678"');
  assert.equal(commandeLecture(3), 'AT+CMGR=3');
});

test('AT : le lecteur rattache le texte d\'un SMS à la ligne +CMGR', () => {
  const l = new LecteurModem();
  const out = l.pousser('\r\n+CMGR: "REC UNREAD","+33123456789","","2026-11-16"\r\nBonjour Odin\r\n\r\nOK\r\n');
  const msg = out.find((r) => r.type === 'message');
  assert.ok(msg && msg.type === 'message');
  assert.equal(msg.numero, '+33123456789');
  assert.equal(msg.texte, 'Bonjour Odin');
});

test('faux modem : init, envoi (texte + Ctrl-Z), puis réception d\'un SMS — octets exacts (non essayé en vrai)', async () => {
  const e = await fauxModem();
  assert.equal(e.ok, true, JSON.stringify(e.etapes, null, 2));
  assert.equal(e.note, NON_ESSAYE);
  const trames = e.etapes.map((x) => x.trame);
  assert.ok(trames.some((t) => /Ctrl-Z \(0x1A\)/.test(t)), 'le SMS sortant est terminé par Ctrl-Z');
  assert.ok(trames.some((t) => /\+CMGS: 42/.test(t)), 'référence d\'envoi reçue');
  assert.ok(trames.some((t) => /\+33123456789/.test(t)), 'le SMS entrant est lu');
});
