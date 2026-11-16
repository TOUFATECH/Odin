// Genèse · clé USB — écriture SIMULÉE dans une image de clé en mémoire : Ventoy « vérifié » (empreinte figée),
// ventoy.json / thème / écran hors ligne / scripts posés, revérification des empreintes, aucun service réel
// contacté. On vérifie aussi la disposition de la clé et la mise à jour d'une clé déjà ODIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireCle, ioSimulee, buildersParDefaut, descripteurVentoy, DOSSIER, type PreparationCle } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const recipeWin: Recipe = { kind: 'windows', label: 'Windows', auto: true, os: 'windows' };
const recipeUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };

const prep: PreparationCle = {
  schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail',
  modeDefaut: 'graphique', delai: 5,
  systemes: [
    { fichier: 'win11.iso', nom: 'Windows 11', famille: 'Windows', mode: 'installer', recipe: recipeWin },
    { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'installer', recipe: recipeUbuntu },
  ],
  images: ['memtest.iso'], vdisks: [{ fichier: 'vm.vhdx', format: 'vhdx', prepare: false }],
  logiciels: [{ id: 'firefox', fichier: 'firefox.exe', args: '', msi: false }],
  defaut: 'win11.iso',
};

// Un mot de passe de TEST (jamais une constante connue en dur dans le code) : fourni à l'écriture.
const MDP = 'MotDePasseEssai-9x!';

test('descripteurVentoy : dépôt officiel, licence GPLv3, empreinte vérifiée (pas 64 zéros)', () => {
  const d = descripteurVentoy();
  assert.match(d.url, /github\.com\/ventoy\/Ventoy\/releases/);
  assert.equal(d.licence, 'GPLv3');
  assert.equal(d.sha256.length, 64);
  // L'empreinte doit être une vraie empreinte publiée, pas un remplissage (64 zéros).
  assert.notEqual(d.sha256, '0'.repeat(64));
  assert.match(d.sha256, /[1-9a-f]/);
});

test('écriture refusée sans mot de passe (jamais de valeur par défaut connue)', async () => {
  const io = ioSimulee();
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN' });
  assert.equal(r.ok, false);
  assert.match(r.message, /mot de passe/i);
  assert.equal(io.fichiers.size, 0);
});

test('clé neuve (non ODIN) : installation, PAS mise à jour', async () => {
  const io = ioSimulee();
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN', motDePasse: MDP });
  assert.equal(r.ok, true, r.message);
  assert.equal(io.ventoy?.miseAJour, false);
});

test('écriture simulée : Ventoy installé, fichiers posés à leur place, empreintes vérifiées', async () => {
  const io = ioSimulee();
  // Cible DÉJÀ ODIN → mise à jour non destructive.
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN', motDePasse: MDP, cibleEstOdin: true });
  assert.equal(r.ok, true, r.message);
  // Ventoy : schéma et Secure Boot repris ; clé déjà ODIN → mise à jour.
  assert.equal(io.ventoy?.schema, 'gpt');
  assert.equal(io.ventoy?.secureBoot, true);
  assert.equal(io.ventoy?.miseAJour, true);
  // Disposition de la clé (contrat section 2).
  assert.ok(io.fichiers.has(`${DOSSIER.iso}/win11.iso`));
  assert.ok(io.fichiers.has(`${DOSSIER.iso}/memtest.iso`));
  assert.ok(io.fichiers.has(`${DOSSIER.vdisk}/vm.vhdx`));
  assert.ok(io.fichiers.has(`${DOSSIER.logicielsWindows}/firefox.exe`));
  assert.ok(io.fichiers.has(`${DOSSIER.ventoy}/ventoy.json`));
  assert.ok([...io.fichiers.keys()].some((k) => k.startsWith(`${DOSSIER.ecran}/`)));
  // Le VRAI ventoy.json du lot B (plus de stub) : délai, thème, menu.
  const vj = io.fichiers.get(`${DOSSIER.ventoy}/ventoy.json`)!;
  assert.match(vj, /VTOY_MENU_TIMEOUT/);
  assert.match(vj, /"theme"/);
  // Le VRAI thème GRUB du lot B.
  assert.ok(io.fichiers.has(`${DOSSIER.ventoy}/theme/odin/theme.txt`));
  // L'overlay Alpine (binaire) de l'écran hors ligne est posé.
  assert.ok(io.fichiers.has(`${DOSSIER.ecran}/odin-ecran.apkovl.tar.gz`));
  // Scripts aux NOMS du contrat (ventoy.json auto_install les référence), pas préfixés d'un slug.
  assert.ok(io.fichiers.has(`${DOSSIER.odin}/autounattend.xml`));
  assert.ok(io.fichiers.has(`${DOSSIER.odin}/user-data`));
  // Archive d'injection générée pour chaque système à installer (ventoy.json injection la référence).
  assert.ok(io.fichiers.has(`${DOSSIER.odin}/inject-win11.tar.gz`));
  assert.ok(io.fichiers.has(`${DOSSIER.odin}/inject-ubuntu.tar.gz`));
  // Le mot de passe par défaut connu ne figure NULLE PART dans les scripts posés.
  for (const v of io.fichiers.values()) assert.ok(!v.includes('motdepasse-a-regler'));
  // Manifeste : une empreinte par fichier écrit.
  assert.ok(r.manifeste.length >= io.fichiers.size);
});

test('revérification : une empreinte qui ne correspond plus fait échouer', async () => {
  const io = ioSimulee();
  // On corrompt un fichier après coup via une empreinte qui changera.
  const vrai = io.empreinte.bind(io);
  let corrige = false;
  io.empreinte = async (dest: string) => { if (!corrige && dest.endsWith('ventoy.json')) { corrige = true; return 'mauvaise-empreinte'; } return vrai(dest); };
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN', motDePasse: MDP });
  assert.equal(r.ok, false);
  assert.match(r.message, /empreinte/i);
});

test('annulation : l\'écriture s\'arrête proprement', async () => {
  const io = ioSimulee();
  io.annule = () => true;
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN', motDePasse: MDP });
  assert.equal(r.ok, false);
  assert.match(r.message, /annul/i);
});
