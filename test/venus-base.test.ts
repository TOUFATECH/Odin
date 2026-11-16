// Vénus · le magasin natif (VENUS_ODIN) : repli fichier, base mémoire, collections privées chiffrées au repos,
// et la forme du DefAppli (migrations + écritures par table). Sans PostgreSQL : tout passe par les fichiers/mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COLLECTIONS, DEF_FREYJA, MagasinVenus, PRIVEES, nomBaseVenus } from '../src/valhalla/venus/base.ts';
import { nomBase } from '../src/valhalla/base/noms.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-base-'));

test('le nom de la base de Vénus est VENUS_ODIN (= nomBase(freyja))', () => {
  assert.equal(nomBaseVenus(), 'VENUS_ODIN');
  assert.equal(nomBaseVenus(), nomBase('freyja'));
});

test('DefAppli : schéma freyja, migrations non vides, une écriture par table (chiffre pour les privées)', () => {
  assert.equal(DEF_FREYJA.id, 'freyja'); assert.equal(DEF_FREYJA.schema, 'freyja'); assert.equal(DEF_FREYJA.appli, 'freyja');
  assert.ok(DEF_FREYJA.migrations.length >= 1 && DEF_FREYJA.migrations[0].sql.includes('CREATE TABLE oeuvres'));
  // Chaque collection a ses trois écritures (pose/retire/vide), et aucune écriture générique ne reste.
  for (const c of COLLECTIONS) { for (const k of [`pose_${c}`, `retire_${c}`, `vide_${c}`]) assert.ok(k in DEF_FREYJA.ecritures, k); }
  assert.ok(!('pose' in DEF_FREYJA.ecritures) && !('pose_chiffre' in DEF_FREYJA.ecritures));
  // Les collections privées écrivent une colonne « chiffre » (jamais le clair) ; les autres une colonne « data ».
  assert.match(DEF_FREYJA.ecritures.pose_historique, /INSERT INTO historique \(id, chiffre, maj\)/);
  assert.match(DEF_FREYJA.ecritures.pose_oeuvres, /INSERT INTO oeuvres \(id, data, maj\)/);
  // Les vues v_* n'exposent pas les contenus privés (seulement des compteurs).
  assert.match(DEF_FREYJA.migrations[0].sql, /GRANT SELECT ON v_oeuvres, v_ecrans, v_compteurs TO odin_lecture/);
  assert.ok(PRIVEES.has('historique') && PRIVEES.has('demandes') && PRIVEES.has('yt_historique'));
});

test('repli fichier : poser → relire depuis les fichiers (mémoire reconstruite), retirer, vider', () => {
  const home = tmp();
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    m.poser('oeuvres', 'film:x', { type: 'film', titre: 'Un film' });
    m.poser('oeuvres', 'film:y', { type: 'film', titre: 'Autre' });
    assert.equal(m.liste('oeuvres').length, 2);
    // Un nouveau magasin relit les fichiers.
    const m2 = new MagasinVenus(home, join(home, 'freyja'));
    assert.equal(m2.get('oeuvres', 'film:x')?.data.titre, 'Un film');
    assert.ok(m2.retirer('oeuvres', 'film:x'));
    assert.equal(new MagasinVenus(home, join(home, 'freyja')).get('oeuvres', 'film:x'), undefined);
    assert.equal(m2.vider('oeuvres'), 1);
    assert.equal(new MagasinVenus(home, join(home, 'freyja')).liste('oeuvres').length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('collections privées : chiffrées au repos (le clair n\'est pas dans le fichier) et relues en clair', () => {
  const home = tmp();
  try {
    const dir = join(home, 'freyja');
    const m = new MagasinVenus(home, dir);
    m.poser('historique', 'moi:1:film:secret', { profil: 'moi', titre: 'Titre très secret', cible_id: 'film:secret', type: 'video', quand: 1 });
    const brut = readFileSync(join(dir, 'historique.jsonl'), 'utf8');
    assert.doesNotMatch(brut, /Titre très secret/, 'le titre n\'est jamais en clair dans le fichier');
    assert.match(brut, /odc1:/, 'le contenu est chiffré (clé de la machine)');
    // Relu : le contenu revient en clair.
    const m2 = new MagasinVenus(home, dir);
    assert.equal(m2.get('historique', 'moi:1:film:secret')?.data.titre, 'Titre très secret');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
