// Vénus · télécommande par QR : jeton par écran, LIMITÉ dans le temps, RÉVOCABLE, RÉGÉNÉRABLE, portée restreinte à CET
// écran, compteur de téléphones, et QR. En base : seulement l'empreinte (jamais le jeton en clair).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MagasinVenus } from '../src/valhalla/venus/base.ts';
import { creerTelecommande, empreinteJeton, empreinteTelephone, jetonDe, lienTelecommande, nombreTelephones, qrTelecommande, regenerer, revoquer, telecommandes, validerJeton } from '../src/valhalla/venus/telecommande.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-tc-'));

test('créer : jeton rendu une fois, seulement l\'empreinte en base (jamais le jeton en clair)', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    const { jeton, id } = creerTelecommande(m, home, 'media_player.tv');
    assert.equal(id, empreinteJeton(jeton));
    assert.equal(m.get('telecommandes', id)?.data.ecran_id, 'media_player.tv');
    // Le fichier au repos ne contient pas le jeton en clair (le secret est chiffré).
    const brut = readFileSync(join(home, 'freyja', 'telecommandes.jsonl'), 'utf8');
    assert.doesNotMatch(brut, new RegExp(jeton.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'le jeton n\'est jamais en clair');
    assert.match(brut, /odc1:/, 'le secret est chiffré');
    assert.equal(jetonDe(m, home, id), jeton, 'réaffichable pour le QR tant que valable');
    assert.ok(qrTelecommande('https://odin', jeton).startsWith('<svg'));
    assert.equal(lienTelecommande('https://odin/', jeton), `https://odin/t/${jeton}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('valider : ok (portée = cet écran), expiré, révoqué', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    const t0 = 1_000_000;
    const { jeton, id } = creerTelecommande(m, home, 'media_player.salon', { dureeMs: 60_000, maintenant: t0 });
    const v = validerJeton(m, jeton, { maintenant: t0 + 1000 });
    assert.deepEqual(v, { ecranId: 'media_player.salon', id });
    assert.ok('refus' in validerJeton(m, jeton, { maintenant: t0 + 61_000 }), 'expiré');
    assert.ok('refus' in validerJeton(m, 'jeton-bidon'), 'inconnu');
    revoquer(m, id);
    assert.ok('refus' in validerJeton(m, jeton, { maintenant: t0 + 1000 }), 'révoqué');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('compteur de téléphones : distinct ; empreinte de téléphone stable', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    const { jeton, id } = creerTelecommande(m, home, 'media_player.tv');
    const a = empreinteTelephone('192.168.1.2', 'iPhone'), b = empreinteTelephone('192.168.1.3', 'Android');
    validerJeton(m, jeton, { telephone: a }); validerJeton(m, jeton, { telephone: a }); validerJeton(m, jeton, { telephone: b });
    assert.equal(nombreTelephones(m, id), 2, 'deux téléphones distincts');
    assert.equal(empreinteTelephone('192.168.1.2', 'iPhone'), a, 'empreinte stable');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('régénérer : l\'ancien QR ne vaut plus, le neuf pilote le même écran', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    const { jeton: ancien, id } = creerTelecommande(m, home, 'media_player.tv');
    const neuf = regenerer(m, home, id)!;
    assert.notEqual(neuf.jeton, ancien);
    assert.ok('refus' in validerJeton(m, ancien), 'l\'ancien jeton est révoqué');
    const v = validerJeton(m, neuf.jeton);
    assert.ok(!('refus' in v) && v.ecranId === 'media_player.tv', 'le neuf pilote le même écran');
    assert.equal(telecommandes(m, 'media_player.tv').length, 1, 'une seule télécommande active');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
