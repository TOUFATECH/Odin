// La liste blanche LOCALE d'Asclépios (NSRL / CIRCL) : filtre de Bloom, lecture des exports, et le
// court-circuit « fichier connu-sain » qui évite une demande en ligne. Rien ici ne touche Internet.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Blanche, bloomContient, construireBloom, lireEntete, parseHashlookup, parseNsrl, positions, tailleBloom } from '../src/valhalla/ullr/nsrl.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('Bloom · taille conseillée : plus d\'empreintes = plus de bits, k raisonnable', () => {
  const a = tailleBloom(1000, 0.001), b = tailleBloom(100_000, 0.001);
  assert.ok(b.bits > a.bits);
  assert.ok(a.k >= 1 && a.k <= 16);
  assert.equal(a.octets, a.bits / 8);
});

test('Bloom · positions stables et dans la plage', () => {
  const h = sha('un fichier'), p = positions(h, 1024, 7);
  assert.equal(p.length, 7);
  assert.ok(p.every((x) => x >= 0 && x < 1024));
  assert.deepEqual(positions(h, 1024, 7), p, 'déterministe');
});

test('Bloom · une empreinte ajoutée est retrouvée, une inconnue est (presque toujours) absente', () => {
  const connus = ['a', 'b', 'c', 'd', 'e'].map(sha);
  const buf = construireBloom(connus);
  const e = lireEntete(buf);
  assert.ok(e && e.n === 5);
  for (const h of connus) assert.equal(bloomContient(buf, h), true, 'un connu est présent');
  let faux = 0; for (let i = 0; i < 2000; i++) if (bloomContient(buf, sha(`inconnu-${i}`))) faux++;
  assert.ok(faux < 20, `trop de fausses présences : ${faux}/2000`);
  assert.equal(bloomContient(buf, 'pas-une-empreinte'), false);
});

test('Export CIRCL / liste d\'empreintes : une SHA-256 par ligne, commentaires ignorés', () => {
  const txt = `# export\n${sha('x')}\n${sha('y').toUpperCase()}  logiciel légitime\n# ${sha('z')}\nrien\n`;
  const out = parseHashlookup(txt);
  assert.deepEqual(out, [sha('x'), sha('y')]);
});

test('Fichier NSRL (RDS) : colonne SHA-256 repérée par l\'en-tête', () => {
  const txt = `"SHA-1","SHA-256","FileName"\n"aaaa","${sha('prog')}","prog.exe"\n"bbbb","${sha('lib')}","lib.dll"\n`;
  assert.deepEqual(parseNsrl(txt), [sha('prog'), sha('lib')]);
});

test('Blanche · un fichier connu-sain court-circuite l\'analyse en ligne', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nsrl-'));
  try {
    const b = new Blanche(dir);
    assert.equal(b.etat().present, false, 'vide au départ');
    const sain = sha('/usr/bin/legitime'), inconnu = sha('/tmp/suspect');
    b.remplacer([sain], 'CIRCL hashlookup');
    assert.equal(b.contient(sain), true, 'le fichier sain est connu : on saute la réputation en ligne');
    assert.equal(b.contient(inconnu), false, 'un fichier inconnu passe à l\'analyse');
    assert.equal(b.etat().entrees, 1);
    assert.deepEqual(b.etat().sources, ['CIRCL hashlookup']);
    // Rechargée depuis le disque : la liste tient.
    const b2 = new Blanche(dir);
    assert.equal(b2.contient(sain), true, 'persistée sur le disque');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
