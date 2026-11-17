// Liens vivants (src/brain/liens-vivants.ts) : après l'écriture d'une note, la table des voisins est mise à jour pour
// cette note seule (elle n'est plus refaite en entier), et elle est EXACTEMENT celle qu'une reconstruction donnerait :
// mêmes liens écrits, mêmes voisins, mêmes freins, et mêmes résultats de consultation (notes, chemin, influx).
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = process.env.RAPIDITE_SRC ? pathToFileURL(join(process.env.RAPIDITE_SRC, 'x')).href.replace(/x$/, '') : new URL('../src/', import.meta.url).href;
const { Vault } = await import(`${src}brain/vault.ts`) as typeof import('../src/brain/vault.ts');
const { LiensVivants } = await import(`${src}brain/liens-vivants.ts`) as typeof import('../src/brain/liens-vivants.ts');
const { consultBrain } = await import(`${src}brain/contexte.ts`) as typeof import('../src/brain/contexte.ts');
const { Mnemosyne } = await import(`${src}muninn/store.ts`) as typeof import('../src/muninn/store.ts');

const MOTS = 'sauvegarde serveur imprimante réseau facture électricité banque projet boutique routeur caméra jardin budget épargne crédit maison travaux'.split(' ');
interface St { ecrit: Set<string>; adj: Map<string, string[]>; freins: Map<string, Array<{ id: string; fr: string }>> }
const etat = (l: unknown): St => (l as { st: St }).st;
const resume = (s: St) => ({ ecrit: [...s.ecrit].sort(), adj: [...s.adj].map(([k, v]) => `${k}>${[...v].sort().join(',')}`).sort(), freins: [...s.freins].map(([k, v]) => `${k}>${v.map((x) => `${x.fr}:${x.id}`).join(',')}`).sort() });

test('écrire une note met la table des voisins à jour sans la refaire, avec le même résultat qu\'une reconstruction', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-liens-'));
  try {
    const root = join(home, 'cerveau'); mkdirSync(root, { recursive: true });
    let a = 11; const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
    for (let i = 0; i < 300; i++) {
      const d = ['Projets', 'Idées', ''][i % 3]; mkdirSync(join(root, d), { recursive: true });
      const liens = [`[[note ${Math.floor(r() * 300)}]]`, `[[note ${Math.floor(r() * 300)}]]`, ...(i % 50 === 0 ? ['[[Plan futur]]'] : [])].join(' ');
      const meta = i % 97 === 5 ? 'type: note\nremplace: "[[Plan futur]]"' : i % 61 === 3 ? 'type: capture' : 'type: note';
      writeFileSync(join(root, d, `note ${i}.md`), `---\n${meta}\n---\n# note ${i}\n\n${Array.from({ length: 25 }, () => MOTS[Math.floor(r() * MOTS.length)]).join(' ')}.\n\n${liens}\n`);
    }
    const m = new Mnemosyne(join(home, 'odin.db'));
    const v = new Vault(root), l = new LiensVivants(m);
    const now = Date.now();
    l.voisinage(v, undefined);
    const avant = etat(l);
    // Odin écrit une note nouvelle (attendue par des liens orphelins) et en modifie une autre.
    v.write('Plan futur', { type: 'note' }, '# Plan futur\n\nsauvegarde du serveur et budget. Voir [[note 7]] et [[note 8]].');
    // (note 3 est une capture : la rendre fiable change la façon de compter ses liens, la table serait refaite ; note 4 non)
    v.write('Idées/note 4', { type: 'note', contredit: '[[note 9]]' }, '# note 4\n\nfacture banque. Voir [[note 12]] et [[Plan futur]].');
    l.voisinage(v, undefined);
    const apres = etat(l);
    // Référence : une table toute neuve sur le même coffre.
    const ref = new LiensVivants(m); ref.voisinage(v, undefined);
    assert.deepEqual(resume(apres), resume(etat(ref)), 'la table mise à jour doit être celle d\'une reconstruction');
    for (const q of ['sauvegarde serveur', 'plan futur budget', 'facture banque', 'note 9', 'jardin caméra routeur']) {
      const x = consultBrain({ vault: v, liens: l, souvenirs: [], now }, q), y = consultBrain({ vault: v, liens: ref, souvenirs: [], now }, q);
      assert.deepEqual({ n: x.notes, e: x.etapes, i: x.influx }, { n: y.notes, e: y.etapes, i: y.influx }, `consultation différente pour « ${q} »`);
    }
    assert.equal(apres, avant, 'la table doit être mise à jour, pas refaite en entier');
  } finally { try { rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } }
});
