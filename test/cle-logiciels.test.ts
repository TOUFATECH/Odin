// Genèse · clé USB et PC par le réseau — choisir des logiciels PAR SYSTÈME, FILTRÉS PAR OS, puis les installer à la
// fin. On vérifie : le tri par OS (Windows pour Windows, Linux pour Linux), le signalement « à installer à la main »
// quand le mode silencieux n'est pas connu, et la conversion vers ce que scripts.ts installe. Aucune install réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  familleLogiciel, osDuFichier, osDuSysteme, modeInstall, compatible,
  logicielsPourSysteme, installeAuto, versScripts, type FicheLog,
} from '../src/valhalla/thjalfi/logiciels-cle.ts';
import { apresWindowsCle, scriptsLinuxCle } from '../src/valhalla/thjalfi/scripts.ts';
import type { Answer } from '../src/valhalla/thjalfi/recipes.ts';

test('famille et OS d\'un fichier selon son extension', () => {
  assert.equal(familleLogiciel('Firefox Setup 130.0.exe'), 'windows');
  assert.equal(familleLogiciel('node-v20.0.0-x64.msi'), 'windows');
  assert.equal(familleLogiciel('code_1.90_amd64.deb'), 'linux-deb');
  assert.equal(familleLogiciel('app-x86_64.AppImage'), 'linux-appimage');
  assert.equal(familleLogiciel('Firefox.dmg'), 'macos');
  assert.equal(osDuFichier('vlc-3.0.20-win64.exe'), 'windows');
  assert.equal(osDuFichier('code_1.90_amd64.deb'), 'linux');
  assert.equal(osDuFichier('Firefox.dmg'), undefined);
});

test('OS visé d\'un système (Windows / Windows Server / Ubuntu / Ubuntu Server)', () => {
  assert.deepEqual(osDuSysteme({ recipe: { os: 'windows' }, nom: 'Windows 11' }), { os: 'windows', serveur: false });
  assert.deepEqual(osDuSysteme({ recipe: { os: 'windows' }, nom: 'Windows Server 2022' }), { os: 'windows', serveur: true });
  assert.deepEqual(osDuSysteme({ recipe: { os: 'linux' }, nom: 'Ubuntu Desktop' }), { os: 'linux', serveur: false });
  assert.deepEqual(osDuSysteme({ famille: 'linux', nom: 'Ubuntu Server' }), { os: 'linux', serveur: true });
  // Sans recette : on lit la famille / le nom de la maquette.
  assert.equal(osDuSysteme({ famille: 'windows', nom: 'Windows 11' }).os, 'windows');
});

test('mode d\'installation : silencieux connu, ou « à la main » quand inconnu', () => {
  // MSI : toujours silencieux.
  const msi = modeInstall('node', 'node-v20.0.0-x64.msi');
  assert.equal(msi.os, 'windows'); assert.equal(msi.silencieux, true); assert.equal(msi.connu, true); assert.equal(msi.msi, true);
  // .exe connu : silencieux promis, avec ses arguments.
  const ff = modeInstall('firefox', 'Firefox Setup 130.0.exe');
  assert.equal(ff.silencieux, true); assert.equal(ff.connu, true); assert.ok(ff.args.length > 0);
  // .exe inconnu : copié, à installer à la main (pas de promesse de silencieux).
  const inconnu = modeInstall('un-logiciel-maison', 'MonLogiciel-2.0-setup.exe');
  assert.equal(inconnu.silencieux, false); assert.equal(inconnu.connu, false); assert.match(inconnu.note ?? '', /à installer à la main/i);
  // .deb : silencieux (apt/dpkg).
  assert.equal(modeInstall('code', 'code_1.90_amd64.deb').silencieux, true);
  // AppImage : seulement copié.
  const app = modeInstall('x', 'x-x86_64.AppImage');
  assert.equal(app.silencieux, false); assert.match(app.note ?? '', /à installer à la main/i);
});

test('logiciels proposés filtrés par OS, avec le signalement', () => {
  const fiches: FicheLog[] = [
    { source: 'firefox', nom: 'Firefox', chemin: 'D:/Logiciels/Firefox Setup 130.0.exe' },
    { source: 'node', nom: 'Node.js', fichier: 'node-v20.0.0-x64.msi' },
    { source: 'maison', nom: 'Logiciel maison', fichier: 'Maison-1.0-setup.exe' },
    { source: 'code', nom: 'VS Code', fichier: 'code_1.90_amd64.deb' },
    { source: 'brave', nom: 'Brave', fichier: 'Brave.dmg' }, // macOS : ni Windows ni Linux
  ];
  const win = logicielsPourSysteme(fiches, { os: 'windows', serveur: false });
  assert.deepEqual(win.map((l) => l.id).sort(), ['firefox', 'maison', 'node']);
  // Le .deb et le .dmg ne sont pas proposés à un système Windows.
  assert.ok(!win.some((l) => l.id === 'code' || l.id === 'brave'));
  // Le logiciel maison est signalé (pas de silencieux connu), Firefox et Node non.
  assert.equal(win.find((l) => l.id === 'maison')!.silencieux, false);
  assert.equal(win.find((l) => l.id === 'firefox')!.silencieux, true);

  const lin = logicielsPourSysteme(fiches, { os: 'linux', serveur: true });
  assert.deepEqual(lin.map((l) => l.id), ['code']);
  assert.equal(lin[0].silencieux, true);
});

test('compatible : un installateur ne va qu\'à son OS', () => {
  assert.equal(compatible('Firefox Setup 130.0.exe', { os: 'windows', serveur: false }), true);
  assert.equal(compatible('Firefox Setup 130.0.exe', { os: 'linux', serveur: false }), false);
  assert.equal(compatible('code_1.90_amd64.deb', { os: 'linux', serveur: false }), true);
});

test('installeAuto : seulement les installateurs sûrs sont lancés tout seuls', () => {
  assert.equal(installeAuto('firefox', 'Firefox Setup 130.0.exe'), 'windows');
  assert.equal(installeAuto('node', 'node-v20.0.0-x64.msi'), 'windows');
  assert.equal(installeAuto('code', 'code_1.90_amd64.deb'), 'linux');
  assert.equal(installeAuto('maison', 'Maison-1.0-setup.exe'), undefined); // inconnu : pas d'auto-install
  assert.equal(installeAuto('x', 'x.AppImage'), undefined);
});

test('versScripts : conversion vers ce que scripts.ts installe à la fin', () => {
  const choisis = [
    { source: 'firefox', fichier: 'Firefox Setup 130.0.exe' },
    { source: 'node', fichier: 'node-v20.0.0-x64.msi' },
    { source: 'maison', fichier: 'Maison-1.0-setup.exe' }, // Windows copié seulement
    { source: 'code', fichier: 'code_1.90_amd64.deb' },
    { source: 'x', fichier: 'x.AppImage' }, // Linux copié seulement
  ];
  const r = versScripts(choisis);
  assert.deepEqual(r.windows.map((l) => l.id).sort(), ['firefox', 'node']);
  assert.deepEqual(r.debs, ['code_1.90_amd64.deb']);
  assert.deepEqual(r.copieWindows, ['Maison-1.0-setup.exe']);
  assert.deepEqual(r.copieLinux, ['x.AppImage']);

  // Le script Windows de fin installe bien les silencieux, et le .deb entre dans les late-commands Linux.
  const ps1 = apresWindowsCle(r.windows, { retirerExigences: true, effacerApres: false });
  // Le nom est assaini (espaces → _) avant d'entrer dans la chaîne PowerShell.
  assert.match(ps1, /Firefox_Setup_130\.0\.exe/);
  assert.match(ps1, /node-v20\.0\.0-x64\.msi/);
  assert.doesNotMatch(ps1, /Maison/); // copié, pas lancé en silencieux

  const answer: Answer = { host: 'odin-pc', user: 'marc', password: 'solide', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://127.0.0.1/etat/cle' };
  const linux = scriptsLinuxCle(answer, 'ubuntu', 'cle', r.debs);
  assert.match(linux['user-data'], /code_1\.90_amd64\.deb/);
});
