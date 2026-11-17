// La documentation ne promet pas plus que le dépôt : un élément « fait » de docs/etat.json doit avoir tous ses
// fichiers dans le dernier commit, et son commit dans l'histoire de la branche ; le README montre exactement l'état
// tiré de ce fichier (`npm run guide` le régénère).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ETATS, avecEtat, lireEtat } from '../tools/guide/etat.ts';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const git = (...a: string[]) => spawnSync('git', ['-c', 'safe.directory=*', '-C', RACINE, ...a], { encoding: 'utf8' });
const avecGit = git('rev-parse', '--verify', 'HEAD').status === 0;
const etat = lireEtat(RACINE);

test('docs/etat.json : identifiants uniques, états connus, une famille et un nom pour chacun', () => {
  const ids = etat.elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiant en double');
  for (const e of etat.elements) {
    assert.ok(ETATS.includes(e.etat), `${e.id} : état inconnu « ${e.etat} »`);
    assert.ok(e.nom && e.famille, `${e.id} : nom et famille obligatoires`);
  }
});

test('« fait » seulement si c\'est commité : chaque fichier est dans le dernier commit, le commit est dans l\'histoire', { skip: avecGit ? false : 'pas de dépôt git ici' }, () => {
  for (const e of etat.elements.filter((x) => x.etat === 'fait')) {
    assert.ok(e.fichiers?.length, `${e.id} est « fait » : il faut au moins un fichier pour le prouver`);
    for (const f of e.fichiers!) {
      const r = git('ls-tree', '-r', '--name-only', 'HEAD', '--', f);
      assert.ok(r.status === 0 && r.stdout.trim().length > 0, `${e.id} est « fait » mais ${f} n'est pas dans le dernier commit : remets-le « en cours »`);
    }
    if (e.commit) {
      const r = git('merge-base', '--is-ancestor', e.commit, 'HEAD');
      assert.equal(r.status, 0, `${e.id} : le commit ${e.commit} n'est pas dans l'histoire de la branche`);
    }
  }
});

test('le README montre l\'état tiré de docs/etat.json (sinon : npm run guide)', () => {
  const readme = readFileSync(join(RACINE, 'README.md'), 'utf8');
  assert.equal(avecEtat(readme, etat), readme, 'la partie « Fait, en cours, à venir » du README est périmée : lance « npm run guide »');
});
