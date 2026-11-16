// Genèse · clé USB : le descripteur du Ventoy officiel et le ventoy.json construit. On vérifie que le descripteur
// pointe le dépôt officiel (github ventoy/Ventoy), porte une empreinte SHA-256 et la licence GPLv3 ; que le
// ventoy.json a le thème, le défaut + délai, le menu nommé/iconé par fichier, le retrait des exigences Windows, et
// l'injection des fichiers de réponses par chemin d'image. Fonctions pures : aucun téléchargement, aucune écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVentoyJson, classeIcone, descripteurVentoy, installArgs, updateArgs } from '../src/valhalla/thjalfi/cle-boot.ts';
import type { PreparationCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const rec = (kind: Recipe['kind'], os: Recipe['os']): Recipe => ({ kind, label: `${kind}`, auto: true, os });

function prep(p: Partial<PreparationCle> = {}): PreparationCle {
  return {
    schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'matrix', texte: 'matrix', disposition: 'eventail',
    modeDefaut: 'graphique', delai: 10,
    systemes: [
      { fichier: 'windows-11.iso', nom: 'Windows 11', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows') },
      { fichier: 'ubuntu-24.04.3-desktop-amd64.iso', nom: 'Ubuntu Desktop', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux') },
    ],
    images: [], vdisks: [{ fichier: 'alpine.vtoy', format: 'vtoy', prepare: true }], logiciels: [],
    defaut: 'ubuntu-24.04.3-desktop-amd64.iso',
    ...p,
  };
}

test('descripteur Ventoy : dépôt officiel, archive Linux, empreinte SHA-256, GPLv3', () => {
  const d = descripteurVentoy();
  assert.match(d.url, /^https:\/\/github\.com\/ventoy\/Ventoy\/releases\/download\/v[\d.]+\/ventoy-[\d.]+-linux\.tar\.gz$/);
  assert.equal(d.fichier, `ventoy-${d.version}-linux.tar.gz`);
  assert.match(d.sha256, /^[0-9a-f]{64}$/, 'une empreinte SHA-256 de 64 caractères');
  assert.equal(d.sha256, 'd86ff9de63d94c8b8f1f6b14d23c55af4b88e8207bf2893890892a6a97b1ad54');
  assert.equal(d.licence, 'GPLv3');
  assert.match(d.sha256Url, /\/sha256\.txt$/);
});

test('installArgs : GPT + Secure Boot + étiquette ODIN ; MBR sans -g ; mise à jour non destructive', () => {
  assert.deepEqual(installArgs({ schema: 'gpt', secureBoot: true }), ['-i', '-g', '-s', '-L', 'ODIN']);
  assert.deepEqual(installArgs({ schema: 'mbr', secureBoot: false }), ['-i', '-L', 'ODIN']);
  assert.deepEqual(updateArgs({ secureBoot: true }), ['-u', '-s']);
});

test('classeIcone : chaque fichier reçoit l\'icône de son système', () => {
  assert.equal(classeIcone('windows-11.iso'), 'windows');
  assert.equal(classeIcone('ubuntu-24.04.iso'), 'ubuntu');
  assert.equal(classeIcone('debian-12.iso'), 'debian');
  assert.equal(classeIcone('disque.vhdx'), 'vdisk');
  assert.equal(classeIcone('autre.iso'), 'linux');
});

test('ventoy.json : défaut + délai, menu nommé/iconé par fichier, bypass Windows, auto_install par chemin', () => {
  const j = JSON.parse(buildVentoyJson(prep())) as Record<string, any>;
  // control : défaut, délai, et le retrait des exigences de Microsoft (Windows présent).
  const control = Object.assign({}, ...j.control);
  assert.equal(control.VTOY_DEFAULT_IMAGE, '/ISO/ubuntu-24.04.3-desktop-amd64.iso');
  assert.equal(control.VTOY_MENU_TIMEOUT, '10');
  assert.equal(control.VTOY_WIN11_BYPASS_CHECK, '1');
  assert.equal(control.VTOY_WIN11_BYPASS_NRO, '1');
  // thème aux couleurs : le fichier du thème GRUB est désigné.
  assert.equal(j.theme.file, '/ventoy/theme/odin/theme.txt');
  assert.equal(j.theme.ventoy_color, '3dff7a', 'accent du thème matrix');
  // menu nommé et iconé, par fichier.
  assert.deepEqual(j.menu_alias.find((a: any) => a.image === '/ISO/windows-11.iso'), { image: '/ISO/windows-11.iso', alias: 'Windows 11' });
  assert.deepEqual(j.menu_class.find((c: any) => c.key === 'windows-11.iso'), { key: 'windows-11.iso', class: 'windows' });
  assert.ok(j.menu_alias.some((a: any) => a.image === '/vdisk/alpine.vtoy'), 'le disque virtuel est aussi au menu');
  // auto_install : le bon fichier de réponses par chemin d'image.
  const win = j.auto_install.find((a: any) => a.image === '/ISO/windows-11.iso');
  assert.equal(win.template, '/odin/autounattend.xml');
  const ubu = j.auto_install.find((a: any) => a.image === '/ISO/ubuntu-24.04.3-desktop-amd64.iso');
  assert.equal(ubu.template, '/odin/user-data');
});

test('ventoy.json : pas de bypass Windows si aucun Windows, et mot de passe d\'installation si demandé', () => {
  const sansWin = JSON.parse(buildVentoyJson(prep({ systemes: [{ fichier: 'debian-12.iso', nom: 'Debian', famille: 'Linux', mode: 'installer', recipe: rec('debian', 'linux') }], defaut: undefined })));
  const control = Object.assign({}, ...sansWin.control);
  assert.equal(control.VTOY_WIN11_BYPASS_CHECK, undefined);
  const deb = sansWin.auto_install.find((a: any) => a.image === '/ISO/debian-12.iso');
  assert.equal(deb.template, '/odin/preseed.cfg');
  const avecMdp = JSON.parse(buildVentoyJson(prep({ motDePasse: { algo: 'scrypt', N: 1, r: 8, p: 1, salt: 's', hash: 'abc123' } })));
  assert.equal(avecMdp.password.bootpwd, 'SHA256:abc123');
});
