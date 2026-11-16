// Écho · copie sonore d'une conversation (en option, chiffrée). On vérifie : éteinte par défaut, rien en clair sur le
// disque, assemblage correct du WAV, plafonds (le plus ancien morceau rogné), effacement réel. Aucun service réel :
// le son est de vrais petits WAV fabriqués ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnregistrementConversation, assemblerWav, MAX_OCTETS } from '../src/valhalla/rodd/conversation-son.ts';
import { resetVaultCache } from '../src/vault.ts';

/** Un petit WAV mono 8 kHz PCM 16 bits : en-tête RIFF + `n` octets de données (un motif reconnaissable). */
function wav(octet: number, n = 32): Uint8Array {
  const data = Buffer.alloc(n, octet);
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n, 40); data.copy(b, 44);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
/** Tous les fichiers d'un dossier, en un seul buffer (pour chercher du clair). */
const toutOctets = (d: string): Buffer => Buffer.concat(readdirSync(d).map((f) => { const p = join(d, f); return statSync(p).isDirectory() ? toutOctets(p) : readFileSync(p); }));

test('assemblerWav : morceaux de même format réunis en un seul WAV ; données concaténées', () => {
  const a = Buffer.from(wav(0xaa, 10)), b = Buffer.from(wav(0xbb, 6));
  const w = assemblerWav([a, b]);
  assert.equal(w.toString('ascii', 0, 4), 'RIFF'); assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  // Les données des deux morceaux se suivent (16 octets au total).
  const tailleData = w.readUInt32LE(w.length - 16 - 4 > 0 ? w.indexOf(Buffer.from('data')) + 4 : 0);
  assert.equal(tailleData, 16);
});

test('copie sonore : éteinte par défaut, allumage, rien en clair, assemblage, effacement', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-enr-')), dir = join(home, 'rodd');
  resetVaultCache(home);
  try {
    const e = new EnregistrementConversation(home, dir);
    assert.equal(e.actif('c1'), false, 'éteinte par défaut');
    assert.equal(e.existe('c1'), false);
    // Tant qu'elle est éteinte, ajouter marche quand même (l'API n'ajoute que si actif) — ici on la teste directement.
    assert.equal(e.activer('c1', true), true); assert.equal(e.actif('c1'), true);
    e.ajouter('c1', 't1', wav(0x11, 20));
    e.ajouter('c1', 't2', wav(0x22, 20));
    assert.equal(e.existe('c1'), true);
    assert.ok(e.taille('c1') > 0);
    // Rien en clair : le motif 0x11/0x22 répété ne doit pas apparaître tel quel (tout est scellé).
    const clair = toutOctets(join(dir, 'enregistrements'));
    assert.ok(!clair.includes(Buffer.alloc(16, 0x11)), 'le son n\'est pas en clair sur le disque');
    assert.ok(!clair.includes(Buffer.alloc(16, 0x22)), 'le son n\'est pas en clair sur le disque');
    // Assemblage : un WAV lisible, dont les données contiennent les deux motifs déchiffrés.
    const w = e.assembler('c1');
    assert.equal(w.toString('ascii', 0, 4), 'RIFF');
    const data = w.subarray(w.indexOf(Buffer.from('data')) + 8);
    assert.ok(data.includes(Buffer.alloc(20, 0x11)) && data.includes(Buffer.alloc(20, 0x22)), 'les deux morceaux déchiffrés');
    // Relu depuis le disque (nouvelle instance) : l'état « actif » et le son survivent.
    const e2 = new EnregistrementConversation(home, dir);
    assert.equal(e2.actif('c1'), true); assert.equal(e2.existe('c1'), true);
    // Effacement : plus rien.
    e2.effacer('c1');
    assert.equal(e2.existe('c1'), false); assert.equal(e2.taille('c1'), 0);
    assert.equal(e2.assembler('c1').length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('plafond d\'octets : le plus ancien morceau est rogné, le dernier est toujours gardé', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-enr-')), dir = join(home, 'rodd');
  resetVaultCache(home);
  try {
    const e = new EnregistrementConversation(home, dir); e.activer('c1', true);
    // Un morceau juste sous le plafond, puis un second : le premier est rogné.
    const gros = Math.floor(MAX_OCTETS * 0.8);
    e.ajouter('c1', 't1', wav(0x01, gros));
    e.ajouter('c1', 't2', wav(0x02, gros));
    assert.ok(e.taille('c1') <= MAX_OCTETS, 'la copie reste sous le plafond');
    const w = e.assembler('c1'), data = w.subarray(w.indexOf(Buffer.from('data')) + 8);
    assert.ok(data.includes(Buffer.alloc(100, 0x02)), 'le dernier morceau est gardé');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
