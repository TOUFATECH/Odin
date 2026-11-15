// Écho · la capsule de dictée sur un poste Windows, installée par Satellites. Le poste distant est simulé par un
// « faux PowerShell » : le vrai PowerShell de la machine d'essai, dans un profil jetable (USERPROFILE, APPDATA), où les
// commandes des tâches planifiées sont remplacées (rien n'est inscrit dans le vrai planificateur de Windows).
// Le chemin WinRM passe par le faux `run` d'Odin (mot de passe sur l'entrée, jamais en argument).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { capsules, posteDuJeton } from '../src/valhalla/rodd/capsule.ts';
import { scriptEtatWindows, scriptInstallationWindows, scriptReglageWindows, scriptRetraitWindows, RACCOURCI_CAPSULE, TACHE_CAPSULE } from '../src/valhalla/rodd/capsule-windows.ts';
import { commandeSsh, encoder, essais, LANCEUR, lanceurWinrm } from '../src/machines/windows.ts';
import { saveMachine } from '../src/machines/access.ts';
import { trouverPython } from '../src/voice/orphee.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const win = process.platform === 'win32';
const py = trouverPython();
const pyExe = py ? String(spawnSync(py.cmd, [...py.args, '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout).trim() : '';
const sansPs = !win ? 'PowerShell de Windows absent (essai à faire sous Windows)' : !pyExe ? 'Python 3 n\'est pas installé ici' : false;
const OPTS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

/** Les commandes du planificateur, remplacées : une tâche « inscrite » est un fichier dans le profil jetable. */
const FAUX_PLANIFICATEUR = String.raw`function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force) if ($env:FAUX_TACHE_REFUSEE) { throw 'Accès refusé' }; Set-Content -LiteralPath (Join-Path $env:USERPROFILE ('tache-' + $TaskName)) -Value ($Action.e + ' ' + $Action.a) }
function Get-ScheduledTask { param($TaskName, $ErrorAction) if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE ('tache-' + $TaskName))) { return @{ TaskName = $TaskName } } }
function Unregister-ScheduledTask { param($TaskName, $Confirm, $ErrorAction) $f = Join-Path $env:USERPROFILE ('tache-' + $TaskName); if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f } else { throw 'absente' } }
function Start-ScheduledTask { param($TaskName) Add-Content -LiteralPath (Join-Path $env:USERPROFILE 'lancees.txt') -Value $TaskName }
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) @{ e = $Execute; a = $Argument } }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User, [switch]$Once, $At, $RepetitionInterval) 'declencheur' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'compte' }
function New-ScheduledTaskSettingsSet { param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable, $ExecutionTimeLimit, $MultipleInstances) 'reglages' }
`;
/** Le faux poste : le script part sur l'entrée du vrai lanceur (comme par SSH), dans le profil jetable. */
function fauxPoste(perso: string, extra: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, USERPROFILE: perso, APPDATA: join(perso, 'AppData', 'Roaming'), ProgramData: join(perso, 'ProgramData'), PATH: `${dirname(pyExe)};${process.env.PATH}`, ...extra };
  return (script: string) => { const r = spawnSync('powershell', [...OPTS, '-EncodedCommand', encoder(LANCEUR)], { input: FAUX_PLANIFICATEUR + script, encoding: 'utf8', env, timeout: 90_000, windowsHide: true }); return { code: r.status, out: `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}` }; };
}
/** Contrôle de syntaxe par l'analyseur de PowerShell. */
function erreursPs(script: string): string {
  const r = spawnSync('powershell', [...OPTS, '-EncodedCommand', encoder('$e=$null;$t=[Console]::In.ReadToEnd();[void][Management.Automation.Language.Parser]::ParseInput($t,[ref]$null,[ref]$e);$e | ForEach-Object { $_.Message + \' (ligne \' + $_.Extent.StartLineNumber + \')\' }')], { input: script, encoding: 'utf8', windowsHide: true });
  return r.stdout.trim();
}

test('lanceurs : le script part sur l\'entrée (SSH), WinRM garde le mot de passe hors de la ligne de commande', () => {
  const c = commandeSsh(); assert.match(c, /^powershell -NoLogo .* -EncodedCommand [A-Za-z0-9+/=]+$/);
  assert.equal(Buffer.from(c.split(' ').at(-1)!, 'base64').toString('utf16le'), LANCEUR);
  assert.ok(c.length < 2000, 'commande courte : le script, lui, voyage sur l\'entrée');
  const w = lanceurWinrm({ host: '192.168.1.40', user: 'Fatima Ali', port: 22, domain: 'MAISON' });
  assert.match(w, /ComputerName='192\.168\.1\.40';Port=5985/); assert.match(w, /PSCredential\('MAISON\\Fatima Ali'/);
  assert.doesNotMatch(w, /secret/);
  assert.match(lanceurWinrm({ host: 'pc', user: 'a', port: 5986 }), /UseSSL=\$true/);
  assert.throws(() => lanceurWinrm({ host: 'pc;calc', user: 'a', port: 22 }), /adresse invalide/);
  assert.throws(() => scriptReglageWindows('mail\'; Remove-Item C:\\'), /invalide/);
  const inst = scriptInstallationWindows({ odin: 'https://192.168.1.10:8888', jeton: 'a'.repeat(64), poste: 'PC-SALON', mode: 'corrigé', empreinte: '' });
  assert.ok(!inst.includes('a'.repeat(64)), 'le jeton n\'apparaît pas en clair dans le script');
  assert.match(inst, new RegExp(TACHE_CAPSULE.replace(/[()]/g, '\\$&'))); assert.match(inst, /veiller/);
});

test('scripts PowerShell de la capsule : syntaxe acceptée par PowerShell', { skip: !win && 'PowerShell de Windows absent' }, () => {
  for (const sc of [scriptInstallationWindows({ odin: 'http://192.168.1.10:8888', jeton: 'b'.repeat(64), poste: 'PC', mode: 'mail', empreinte: '' }), scriptEtatWindows(), scriptReglageWindows('tel quel'), scriptRetraitWindows(), LANCEUR]) assert.equal(erreursPs(sc), '', sc.slice(0, 80));
});

test('le lanceur SSH exécute un script reçu sur l\'entrée, accents compris', { skip: !win && 'PowerShell de Windows absent' }, () => {
  const r = spawnSync('powershell', [...OPTS, '-EncodedCommand', encoder(LANCEUR)], { input: "$x = 'Écho été'; Write-Output ([int][char]$x[0])", encoding: 'utf8', windowsHide: true });
  assert.equal(r.stdout.trim(), String('É'.charCodeAt(0)));
});

test('Satellites installe la capsule sur un poste Windows (WinRM simulé), la règle, la vérifie, la retire proprement', { skip: sansPs, timeout: 180_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-')), perso = mkdtempSync(join(tmpdir(), 'poste-win-'));
  mkdirSync(join(perso, 'AppData', 'Roaming'), { recursive: true });
  const poste = fauxPoste(perso), mots: string[] = [];
  // Le faux `run` d'Odin : PowerShell local qui ferait Invoke-Command ; ici on vérifie le lanceur puis on joue le poste.
  const run = async (cmd: string, args: string[], o: { input?: string } = {}) => {
    if (cmd !== 'powershell' && cmd !== 'pwsh') return { code: 1, out: '', err: `inattendu ${cmd}` };
    const l = Buffer.from(args.at(-1)!, 'base64').toString('utf16le'); assert.match(l, /Invoke-Command @o/); assert.match(l, /ComputerName='192\.168\.1\.40'/);
    assert.ok(!args.join(' ').includes('mot-de-passe-du-pc'), 'mot de passe jamais en argument');
    const k = (o.input ?? '').indexOf('\n'); mots.push((o.input ?? '').slice(0, k));
    const r = poste((o.input ?? '').slice(k + 1)); return { code: r.code ?? 1, out: r.out, err: '' };
  };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: run as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  saveMachine(home, { label: 'PC-SALON', host: '192.168.1.40', user: 'Fatima', password: 'mot-de-passe-du-pc' });
  try {
    assert.equal((await v.act('hermod', 'capsule_installer', { machine: 'PC-SALON', acces: 'winrm', adresse_odin: 'http://192.168.1.10:8888' }, { auto: true })).ok, false, 'installer reste grave');
    const r = await v.act('hermod', 'capsule_installer', { machine: 'PC-SALON', acces: 'winrm', adresse_odin: 'http://192.168.1.10:8888', mode: 'tel quel' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Capsule d'Écho installée sur PC-SALON .*démarrage : tâche planifiée/); assert.match(r.text, /Ctrl\+Espace lance la dictée/);
    assert.ok(mots.every((x) => x === 'mot-de-passe-du-pc'), 'le mot de passe passe par l\'entrée');
    const d = join(perso, '.odin-capsule'), conf = JSON.parse(readFileSync(join(d, 'capsule.json'), 'utf8'));
    assert.equal(posteDuJeton(home, conf.jeton)?.poste, 'PC-SALON'); assert.equal(conf.odin, 'http://192.168.1.10:8888');
    assert.match(readFileSync(join(perso, `tache-${TACHE_CAPSULE}`), 'utf8'), /capsule\.py" veiller$/m, 'la tâche lance la veille sur Ctrl+Espace');
    assert.match(readFileSync(join(perso, 'lancees.txt'), 'utf8'), /Odin - Echo/, 'veille lancée tout de suite');
    assert.ok((r.data as { enregistreur?: string }).enregistreur, 'un micro sous Windows sans rien installer');
    // État, réglage.
    assert.match((await v.act('hermod', 'capsule_etat', { machine: 'PC-SALON' })).text, /PC-SALON : version 1\.1\.0 .*démarrage : tâche planifiée/);
    assert.match((await v.act('hermod', 'capsule_regler', { machine: 'PC-SALON', mode: 'mail' })).text, /mise en forme « mail »/);
    assert.equal(JSON.parse(readFileSync(join(d, 'capsule.json'), 'utf8')).mode, 'mail');
    // Retrait : grave ; tout part (tâche, dossier), le jeton ne vaut plus rien.
    assert.equal((await v.act('hermod', 'capsule_retirer', { machine: 'PC-SALON' }, { auto: true })).ok, false);
    assert.match((await v.act('hermod', 'capsule_retirer', { machine: 'PC-SALON' })).text, /Capsule retirée de PC-SALON \(veille arrêtée/);
    assert.ok(!existsSync(d) && !existsSync(join(perso, `tache-${TACHE_CAPSULE}`))); assert.equal(capsules(home).length, 0);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); rmSync(perso, { recursive: true, force: true }); }
});

test('tâche planifiée refusée (SSH simulé) : raccourci dans le dossier Démarrage, effacé au retrait', { skip: sansPs, timeout: 180_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-')), perso = mkdtempSync(join(tmpdir(), 'poste-win-'));
  mkdirSync(join(perso, 'AppData', 'Roaming'), { recursive: true });
  const poste = fauxPoste(perso, { FAUX_TACHE_REFUSEE: '1' }), vus: string[] = [];
  essais.commande = async (_m, cmd) => { vus.push(cmd); return cmd === 'uname -s' ? { code: 1, out: '\'uname\' n\'est pas reconnu en tant que commande interne' } : { code: 0, out: 'Microsoft Windows [version 10.0.26200.1]' }; };
  essais.windows = async (_m, script, lien) => { assert.equal(lien, 'ssh'); return poste(script); };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (async () => ({ code: 1, out: '', err: '' })) as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  saveMachine(home, { label: 'PORTABLE', host: '192.168.1.41', user: 'awa' });
  try {
    const r = await v.act('hermod', 'capsule_installer', { machine: 'PORTABLE', adresse_odin: 'http://192.168.1.10:8888' });
    assert.equal(r.ok, true, r.text); assert.deepEqual(vus, ['uname -s', 'cmd /c ver'], 'système deviné par le poste');
    assert.match(r.text, /démarrage : dossier Démarrage/); assert.match(r.text, /prochaine ouverture de session/);
    const lnk = join(perso, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', RACCOURCI_CAPSULE);
    assert.ok(existsSync(lnk), 'raccourci de démarrage créé');
    assert.match((await v.act('hermod', 'capsule_etat', { machine: 'PORTABLE' })).text, /démarrage : dossier Démarrage/);
    assert.match((await v.act('hermod', 'capsule_retirer', { machine: 'PORTABLE' })).text, /Capsule retirée/);
    assert.ok(!existsSync(lnk) && !existsSync(join(perso, '.odin-capsule')));
  } finally { delete essais.commande; delete essais.windows; v.stop(); rmSync(home, { recursive: true, force: true }); rmSync(perso, { recursive: true, force: true }); }
});
