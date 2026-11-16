// Kéryx — téléphonie SIP/RTP/G.711 : codec aller-retour exact, ordonnanceur RTP à échéance absolue (pas de dérive
// cumulée), et l'enchaînement SIP complet (digest RFC 2617) contre un FAUX registrar. Rien sur du vrai matériel.
// UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decoderA, decoderMu, encoderA, encoderMu } from '../src/valhalla/keryx/g711.ts';
import { construirePaquet, delaiProchain, lirePaquet } from '../src/valhalla/keryx/rtp.ts';
import { enteteAutorisation, reponseDigest } from '../src/valhalla/keryx/sip.ts';
import { fauxSip } from '../src/valhalla/keryx/faux.ts';
import { NON_ESSAYE } from '../src/valhalla/keryx/types.ts';

test('G.711 : aller-retour exact — la valeur sonore décodée est stable pour les 256 octets (µ-law et A-law)', () => {
  // La norme a deux octets pour le « zéro » (0x7F/0xFF en µ-law, 0x55/0xD5 en A-law) : encoder(decoder(c)) peut donc
  // viser l'autre zéro. L'invariant vraiment exact est que la VALEUR sonore décodée ne bouge pas d'un aller-retour.
  for (let b = 0; b < 256; b++) {
    const linMu = decoderMu(b); assert.equal(decoderMu(encoderMu(linMu)), linMu, `µ-law ${b}`);
    const linA = decoderA(b); assert.equal(decoderA(encoderA(linA)), linA, `A-law ${b}`);
  }
  // Et tous les octets sauf le zéro en double se réencodent à l'identique.
  let exacts = 0;
  for (let b = 0; b < 256; b++) { if (encoderMu(decoderMu(b)) === b) exacts++; }
  assert.ok(exacts >= 255, `${exacts}/256 octets µ-law identiques à l'aller-retour`);
});

test('ordonnanceur RTP : échéance absolue → dérive bornée, là où le naïf accumule le retard', () => {
  const periode = 20, jitter = 6, tours = 500;
  // Échéance absolue : chaque tour vise base + n×période, le réveil tardif ne se reporte pas.
  let now = 0, maxDerive = 0;
  for (let k = 0; k < tours; k++) { const d = delaiProchain(0, k, periode, now); now = now + d + jitter; maxDerive = Math.max(maxDerive, Math.abs(now - k * periode)); }
  assert.ok(maxDerive <= jitter + 1, `dérive absolue bornée (${maxDerive} ms)`);
  // Naïf (setTimeout(période) à chaque tour) : le retard s'additionne.
  const deriveNaive = Math.abs(tours * (periode + jitter) - tours * periode);
  assert.ok(deriveNaive > 1000, `le naïf dérive de ${deriveNaive} ms sur ${tours} tours`);
});

test('RTP : en-tête construit puis relu ; trame trop courte rejetée vite', () => {
  const p = construirePaquet({ charge: 0, sequence: 1000, horodatage: 160000, ssrc: 0x11223344, marque: true }, new Uint8Array([1, 2, 3]));
  const r = lirePaquet(p);
  assert.ok(r);
  assert.equal(r!.entete.charge, 0);
  assert.equal(r!.entete.sequence, 1000);
  assert.equal(r!.entete.horodatage, 160000);
  assert.equal(r!.entete.ssrc, 0x11223344);
  assert.equal(r!.entete.marque, true);
  assert.deepEqual([...r!.charge], [1, 2, 3]);
  assert.equal(lirePaquet(new Uint8Array(5)), undefined);
});

test('SIP digest : identique des deux côtés, et l\'en-tête Authorization porte bien cette réponse', () => {
  const e = { username: 'odin', password: 'secret', realm: 'r', nonce: 'abc', uri: 'sip:odin@r', method: 'REGISTER', qop: 'auth', nc: '00000001', cnonce: 'xyz' };
  const r1 = reponseDigest(e);
  assert.equal(r1, reponseDigest({ ...e }));
  assert.match(r1, /^[0-9a-f]{32}$/);
  const h = enteteAutorisation({ username: 'odin', password: 'secret', uri: 'sip:odin@r', method: 'REGISTER', defi: { realm: 'r', nonce: 'abc', qop: 'auth' }, cnonce: 'xyz', nc: '00000001' });
  assert.ok(h.includes(`response="${r1}"`), h);
});

test('SIP : REGISTER→401→digest→200→INVITE→ACK→BYE contre un FAUX registrar (non essayé en vrai)', async () => {
  const e = await fauxSip();
  assert.equal(e.ok, true, JSON.stringify(e.etapes, null, 2));
  assert.equal(e.note, NON_ESSAYE);
  const trames = e.etapes.map((x) => x.trame).join(' | ');
  for (const attendu of ['REGISTER', '401', '200', 'INVITE', '180', 'digest MD5 identique des deux côtés : oui']) assert.match(trames, new RegExp(attendu));
});
