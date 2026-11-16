// Genèse · clé USB — corrections de la greffe « systèmes installés » : on refait la preuve des défauts corrigés.
//  - defaut 2 : une famille en minuscule ('windows', comme l'envoie la page) donne bien un Windows To Go, pas un
//    « Linux installé », aussi bien dans le plan (planPlace) que dans les icônes (entreesVdiskAuto) et à l'écriture.
//  - defaut 5 : un Linux « installé » produit son entrée GRUB chainload dans le menu natif de Ventoy (ventoy_grub.cfg).
//  - defaut 6 : l'indexeur odin-scan est bel et bien posé sur la clé.
//  - defauts 1/4 : l'action cle_place reçoit la charge EXACTE de la page ({ cible, systemes }), calcule un VRAI plan
//    (partitions, effacé, reste) et sait REFUSER une cible trop petite.
// Tout est simulé : fausse liste de disques, IO en mémoire, aucun vrai disque touché, aucun service contacté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleUsb, ecrireCle, ioSimulee, buildersParDefaut, DOSSIER, type PreparationCle } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { planPlace } from '../src/valhalla/thjalfi/cle-cible.ts';
import { entreesVdiskAuto } from '../src/valhalla/thjalfi/cle-install.ts';
import type { Cible, SystemeCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const GO = 1024 ** 3;
const recipeWin: Recipe = { kind: 'windows', label: 'Windows', auto: true, os: 'windows' };
const recipeUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };
const MDP = 'MotDePasseEssai-9x!';

// La charge EXACTE que la page envoie : une famille EN MINUSCULE, sans winToGo posé.
const winInstallePage: SystemeCle = { fichier: 'win11.iso', nom: 'Windows 11', famille: 'windows' as never, mode: 'installer', recipe: recipeWin, choix: 'installe' };

test('defaut 2 (plan) : un Windows « installé » en minuscule est un Windows To Go, pas un Linux installé', () => {
  const cible: Cible = { id: 'd', genre: 'cle', tailleOctets: 128 * GO, estOdin: false };
  const plan = planPlace(cible, [winInstallePage]);
  const roles = plan.partitions.map((p) => p.role);
  assert.ok(roles.includes('WinToGo'), `attendu WinToGo, obtenu ${roles.join(', ')}`);
  assert.ok(!roles.includes('Linux installé'));
  assert.equal(plan.partitions.find((p) => p.role === 'WinToGo')!.tailleGo, 32);
});

test('defaut 2 (icône) : entreesVdiskAuto donne l\'icône Windows à un installe minuscule sans winToGo', () => {
  const auto = entreesVdiskAuto([winInstallePage]);
  assert.equal(auto.length, 1);
  assert.equal(auto[0].class, 'windows');
});

test('defauts 2/5/6 (écriture) : VHDX Windows To Go, menu chainload Linux, odin-scan posés', async () => {
  const prep: PreparationCle = {
    schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail',
    modeDefaut: 'graphique', delai: 5,
    systemes: [
      winInstallePage,
      { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'linux' as never, mode: 'installer', recipe: recipeUbuntu, choix: 'installe', installPartition: { tailleGo: 20 } },
    ],
    images: [], vdisks: [], logiciels: [],
  };
  const io = ioSimulee();
  const r = await ecrireCle(prep, io, buildersParDefaut, { cible: 'ODIN', motDePasse: MDP });
  assert.equal(r.ok, true, r.message);
  // defaut 2 : le Windows installé (minuscule, sans winToGo explicite) crée bien un VHDX Windows To Go.
  assert.ok([...io.fichiers.keys()].some((k) => /wintogo\.vhdx$/.test(k)), 'VHDX Windows To Go attendu');
  // defaut 5 : le Linux installé a son entrée GRUB chainload dans le menu natif de Ventoy.
  const cfg = io.fichiers.get(`${DOSSIER.ventoy}/ventoy_grub.cfg`);
  assert.ok(cfg, 'ventoy_grub.cfg attendu');
  assert.match(cfg!, /menuentry "Ubuntu \(installé\)"/);
  // defaut 6 : l'indexeur odin-scan est posé dans /odin.
  const scan = io.fichiers.get(`${DOSSIER.odin}/odin-scan`);
  assert.ok(scan, 'odin-scan attendu');
  assert.match(scan!, /odin-scan/);
});

// Un ModCtx minimal : une FAUSSE liste de disques (aucun vrai disque), rien d'autre n'est appelé par cle_place.
function ctxAvecDisques(disques: Disque[]): ModCtx {
  return { settings: { cleDisquesTest: disques }, run: async () => ({ out: '', code: 0, err: '' }) } as unknown as ModCtx;
}
const disque = (p: Partial<Disque>): Disque => ({ id: 'x', chemin: '/dev/x', tailleOctets: 128 * GO, genre: 'cle', externe: true, amovible: true, partitions: [], ...p });
const actionCle = (id: string) => cleUsb().actions.find((a) => a.id === id)!;

test('defauts 1/4 : cle_place reçoit { cible, systemes } de la page et calcule un vrai plan', async () => {
  const ctx = ctxAvecDisques([disque({ id: 'disk5', tailleOctets: 128 * GO })]);
  const r = await actionCle('cle_place').run(ctx, {
    cible: { id: 'disk5', genre: 'cle', tailleOctets: 128 * GO, estOdin: false },
    systemes: [winInstallePage],
  });
  assert.equal(r.ok, true, r.text);
  const plan = r.data as { partitions: Array<{ role: string }>; possible: boolean };
  assert.equal(plan.possible, true);
  // Le plan reflète RÉELLEMENT les systèmes (Windows To Go), pas « ISO ODIN » tout seul.
  assert.ok(plan.partitions.some((p) => p.role === 'WinToGo'), `obtenu ${plan.partitions.map((p) => p.role).join(', ')}`);
});

test('defauts 1/4 : cle_place refuse une cible trop petite (garde-fou)', async () => {
  const ctx = ctxAvecDisques([disque({ id: 'petite', tailleOctets: 16 * GO })]);
  const r = await actionCle('cle_place').run(ctx, {
    cible: { id: 'petite', genre: 'cle', tailleOctets: 16 * GO, estOdin: false },
    systemes: [winInstallePage], // 32 Go (WinToGo) + 8 Go (ISO ODIN) > 16 Go
  });
  assert.equal(r.ok, false);
  const plan = r.data as { possible: boolean; blocage?: string };
  assert.equal(plan.possible, false);
  assert.match(plan.blocage ?? '', /manque|réduis/i);
});

test('defaut 3 : cle_progres répond proprement (la sonde de la page ne tombe plus sur une action inconnue)', async () => {
  const r = await actionCle('cle_progres').run(ctxAvecDisques([]), { cible: { id: 'x' } });
  assert.equal(r.ok, true);
  assert.equal((r.data as { fini: boolean }).fini, true);
});
