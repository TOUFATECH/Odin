// Genèse · clé USB — scripts générés par système en réutilisant recipes.ts : autounattend Windows sans TPM ni
// compte Microsoft, user-data/preseed Linux, logiciels silencieux depuis la clé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autounattendCle, injecterSautExigences, apresWindowsCle, scriptsLinuxCle, modeleScriptPerso, verifierScriptPerso, apercu } from '../src/valhalla/thjalfi/scripts.ts';
import type { Answer } from '../src/valhalla/thjalfi/recipes.ts';

const answer: Answer = { host: 'odin-pc', user: 'marc', password: 'un-mot-de-passe-solide', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: ['curl'], report: 'http://127.0.0.1/etat/cle' };

test('autounattend : retire les exigences de Microsoft (TPM, Secure Boot, mémoire)', () => {
  const xml = autounattendCle(answer, 'uefi', { retirerExigences: true, effacerApres: false });
  assert.match(xml, /BypassTPMCheck/);
  assert.match(xml, /BypassSecureBootCheck/);
  assert.match(xml, /BypassRAMCheck/);
  // Compte local, pas de compte Microsoft imposé (écran des comptes en ligne caché).
  assert.match(xml, /HideOnlineAccountScreens/);
  assert.match(xml, /<LocalAccount/);
  // Sans l'option, pas de saut d'exigences.
  assert.doesNotMatch(autounattendCle(answer, 'uefi', { retirerExigences: false, effacerApres: false }), /BypassTPMCheck/);
});

test('injecterSautExigences : le bloc est dans la passe windowsPE (composant Setup)', () => {
  const xml = injecterSautExigences('<component name="Microsoft-Windows-Setup" x><DiskConfiguration/></component>');
  assert.match(xml, /<component name="Microsoft-Windows-Setup" x><RunSynchronous>/);
});

test('apresWindowsCle : logiciels installés depuis la clé, en silencieux', () => {
  const ps = apresWindowsCle([{ id: 'firefox', fichier: 'firefox.exe', args: '', msi: false }, { id: 'tool', fichier: 'tool.msi', args: '', msi: true }], { retirerExigences: true, effacerApres: true }, 'D:\\logiciels\\windows');
  assert.match(ps, /D:\\logiciels\\windows\\firefox\.exe/);
  assert.match(ps, /-ms/, 'Firefox installé avec son option silencieuse connue');
  assert.match(ps, /msiexec\.exe/, 'le MSI est installé par msiexec /qn');
  assert.match(ps, /Remove-Item/, 'les installeurs sont effacés ensuite (option)');
});

test('scriptsLinuxCle : Ubuntu user-data + meta-data, .deb de la clé en late-commands', () => {
  const f = scriptsLinuxCle(answer, 'ubuntu', 'jeton123', ['monlogiciel.deb']);
  assert.ok(f['user-data']);
  assert.match(f['user-data'], /autoinstall/);
  // Lot C4 (point 5) : le .deb est pris dans l'archive d'injection (/odin), pas dans /cdrom (l'ISO elle-même).
  assert.match(f['user-data'], /\/odin\/logiciels\/monlogiciel\.deb/);
  assert.match(f['meta-data'], /jeton123/);
  // Debian : preseed avec le .deb copié.
  const deb = scriptsLinuxCle(answer, 'debian', 'x', ['a.deb']);
  assert.match(deb['preseed.cfg'], /a\.deb/);
});

test('script perso : modèle proposé, et refus d\'une commande qui efface un disque', () => {
  assert.match(modeleScriptPerso('windows'), /Windows/);
  assert.match(modeleScriptPerso('linux'), /#!\/bin\/sh/);
  assert.ok(verifierScriptPerso('echo bonjour') === undefined);
  assert.match(verifierScriptPerso('rm -rf /') ?? '', /effacer/);
  assert.match(verifierScriptPerso('mkfs.ext4 /dev/sda') ?? '', /effacer/);
});

test('apres.ps1 : le nom de fichier d\'un logiciel est assaini (pas d\'injection PowerShell)', () => {
  // Un nom contenant une sous-expression PowerShell $(...) ne doit JAMAIS rester tel quel dans une chaîne à
  // guillemets doubles : il s'exécuterait à l'ouverture de session. On le remplace par des caractères sûrs.
  const ps = apresWindowsCle([{ id: 'x', fichier: 'app$(calc.exe).exe', args: '', msi: false }], { retirerExigences: true, effacerApres: false });
  assert.doesNotMatch(ps, /\$\(calc\.exe\)/);
  assert.match(ps, /app__calc\.exe_\.exe/);
  // Même garde pour un MSI.
  const msi = apresWindowsCle([{ id: 'y', fichier: 'pack`;calc.msi', args: '', msi: true }], { retirerExigences: true, effacerApres: false });
  assert.doesNotMatch(msi, /`;calc/);
});

test('apercu : montre les fichiers avant écriture', () => {
  const win = apercu({ famille: 'windows', answer, fw: 'uefi', opt: { retirerExigences: true, effacerApres: false }, logiciels: [] });
  assert.ok(win['autounattend.xml'] && win['apres.ps1']);
  const lin = apercu({ famille: 'ubuntu', answer, token: 't' });
  assert.ok(lin['user-data']);
});
