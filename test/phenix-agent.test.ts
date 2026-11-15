// Phénix · l'agent des PC du foyer. Le script d'installation de Satellites est lancé pour de vrai (sh + Python, dans
// un dossier personnel jetable ; sous Windows : le vrai PowerShell avec un faux planificateur), puis l'agent sauvegarde
// vers le vrai serveur d'Odin : complète, puis incrémentielle (seuls les morceaux nouveaux partent), fichier effacé,
// restauration demandée dans Odin (grave) et faite par l'agent, morceau vérifié. Jetons et refus de la porte HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { agentDuJeton, agents, desinscrireAgent, inscrireAgent, minuteDe, scriptAgentPosix, scriptAgentWindows, gestesAgent, TACHE_AGENT } from '../src/valhalla/sindri/agent.ts';
import { lireEtat } from '../src/valhalla/rodd/capsule.ts';
import { encoder, LANCEUR } from '../src/machines/windows.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { trouverPython } from '../src/voice/orphee.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const py = trouverPython();
const bash = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((b) => existsSync(b)) : '/bin/sh';
const sansSh = !py ? 'Python 3 n\'est pas installé ici' : !bash ? 'pas de shell POSIX (Git Bash) sur cette machine' : false;
const lancer = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<{ status: number | null; stdout: string; stderr: string }>((ok) => {
  const p = spawn(cmd, args, { env, windowsHide: true }); let stdout = '', stderr = '';
  const fin = setTimeout(() => p.kill(), 60_000);
  p.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; }); p.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
  p.on('close', (status) => { clearTimeout(fin); ok({ status, stdout, stderr }); });
});

test('jetons des agents : empreinte seulement, réinscrire rend l\'ancien inutile ; minute étalée ; scripts sûrs', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-'));
  try {
    const j1 = inscrireAgent(home, 'pc-salon'); assert.equal(agentDuJeton(home, j1)?.plan, 'PC · pc-salon');
    assert.doesNotMatch(readFileSync(join(home, 'valhalla', 'sindri', 'agents.json'), 'utf8'), new RegExp(j1));
    const j2 = inscrireAgent(home, 'pc-salon'); assert.equal(agentDuJeton(home, j1), undefined); assert.ok(agentDuJeton(home, j2));
    assert.ok(desinscrireAgent(home, 'pc-salon')); assert.equal(agents(home).length, 0);
    assert.ok(minuteDe('pc-salon') >= 0 && minuteDe('pc-salon') < 60);
    const c = { odin: 'https://192.168.1.10:8888', jeton: 'c'.repeat(64), poste: 'pc', empreinte: '', dossiers: [], exclure: [] };
    assert.ok(!scriptAgentPosix(c).includes('c'.repeat(64)) && !scriptAgentWindows(c).includes('c'.repeat(64)), 'jeton jamais en clair');
    assert.throws(() => scriptAgentPosix({ ...c, odin: 'https://x\'; rm' }), /invalide/);
    assert.throws(() => scriptAgentPosix({ ...c, exclure: ['(('] }), /exclusion invalide/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('agent installé par le script de Satellites, sauvegardes poussées (complète puis incrémentielle), restauration sur le PC', { skip: sansSh, timeout: 180_000 }, async () => {
  const t = new T(), avant = process.env.SINDRI_PASSWORD; process.env.SINDRI_PASSWORD = 'mot-de-passe-de-test';
  const perso = mkdtempSync(join(tmpdir(), 'poste-')), bin = join(perso, 'bin'), src = join(perso, 'Documents');
  mkdirSync(bin); mkdirSync(join(src, 'factures'), { recursive: true });
  writeFileSync(join(bin, 'python3'), `#!/bin/sh\nexec "${py!.cmd.replace(/\\/g, '/')}" ${py!.args.join(' ')} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(src, 'note.txt'), 'version 1'); writeFileSync(join(src, 'factures', 'grosse.bin'), Buffer.alloc(2_500_000, 7)); writeFileSync(join(src, 'efface.txt'), 'bientôt parti'); writeFileSync(join(src, 'brouillon.tmp'), 'jamais sauvegardé');
  try {
    const v = await vraiOdin(t, { compte: true }), va = valhallaOf()!, home = v.o.paths.home;
    // Le plan du PC (fait par Satellites à l'installation) et le jeton de l'agent.
    const plan = await va.act('sindri', 'agent_plan', { poste: 'pc-essai', depot: join(home, 'sauvegardes-pc') }); assert.equal(plan.ok, true, plan.text);
    const jeton = inscrireAgent(home, 'pc-essai');
    const script = scriptAgentPosix({ odin: v.url, jeton, poste: 'pc-essai', empreinte: '', dossiers: [src], exclure: [] });
    const env = { ...process.env, HOME: perso, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
    const inst = spawnSync(bash!, ['-s'], { input: `export PATH="${bin.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, l: string) => `/${l.toLowerCase()}`)}:$PATH"\n${script}\n`, encoding: 'utf8', env, timeout: 30_000 });
    const etat = lireEtat(inst.stdout);
    assert.equal(inst.status, 0, inst.stderr); assert.equal(etat?.ok, true); assert.equal(etat?.poste, 'pc-essai'); assert.equal(etat?.configure, true);
    const agent = join(perso, '.odin-phenix', 'agent.py'), sauver = () => lancer(py!.cmd, [...py!.args, agent, 'sauvegarder'], env);
    // 1. Première sauvegarde : complète.
    let r = await sauver(); let e = lireEtat(r.stdout);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(e?.sorte, 'complète'); assert.equal(e?.fichiers, 3, 'le .tmp est exclu');
    assert.equal(e?.envoyes, 4, 'grosse.bin : 3 morceaux dont 2 identiques (envoyé une fois), + le reste, + 2 petits fichiers');
    // 2. Changements : un fichier modifié, un ajouté, un effacé ; seule la nouveauté part.
    writeFileSync(join(src, 'note.txt'), 'version 2, plus longue'); writeFileSync(join(src, 'nouveau.txt'), 'neuf'); rmSync(join(src, 'efface.txt'));
    r = await sauver(); e = lireEtat(r.stdout);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(e?.sorte, 'incrémentielle'); assert.equal(e?.lus, 2); assert.equal(e?.envoyes, 2);
    const l = (await va.act('sindri', 'instantanes', { plan: 'PC · pc-essai' })).data as Array<{ id: string; type: string }>;
    assert.deepEqual(l.map((x) => x.type), ['incrémentielle', 'complète']);
    const p = await va.act('sindri', 'parcourir', { instantane: l[0].id, dossier: src });
    assert.match(p.text, /📄 note\.txt/); assert.match(p.text, /📄 nouveau\.txt/); assert.doesNotMatch(p.text, /efface\.txt/); assert.match(p.text, /📁 factures\//);
    assert.match((await va.act('sindri', 'plans', {})).text, /PC · pc-essai : .*Documents/, 'les dossiers du PC sont notés dans le plan');
    // 3. Restaurer sur le PC : grave ; l'ancienne version revient dans « Restauré par Odin … » au passage suivant.
    assert.equal((await va.act('sindri', 'restaurer_pc', { instantane: l[1].id }, { auto: true })).ok, false);
    const demande = await va.act('sindri', 'restaurer_pc', { instantane: l[1].id, filtre: 'note' });
    assert.match(demande.text, /prochain passage/, demande.text);
    r = await sauver(); e = lireEtat(r.stdout);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal((e?.restauration as { fichiers: number }).fichiers, 1);
    const rest = readdirSync(perso).find((n) => n.startsWith('Restauré par Odin')); assert.ok(rest, 'dossier de restauration créé');
    const remis = join(perso, rest, src.replace(/^([A-Za-z]):/, '$1').replace(/^[\\/]+/, ''), 'note.txt');
    assert.equal(readFileSync(remis, 'utf8'), 'version 1', 'l\'ancienne version, vérifiée morceau par morceau');
    assert.equal(readFileSync(join(src, 'note.txt'), 'utf8'), 'version 2, plus longue', 'rien écrasé sans « à leur place »');
    // 4. La porte : jeton faux refusé ; morceau abîmé refusé.
    const x = await fetch(`${v.url}/api/sindri/agent/debut`, { method: 'POST', headers: { authorization: `Bearer ${'0'.repeat(64)}` }, body: '{}' });
    assert.equal(x.status, 401);
    const d = await (await fetch(`${v.url}/api/sindri/agent/debut`, { method: 'POST', headers: { authorization: `Bearer ${jeton}` }, body: '{}' })).json() as { session: string; sorte: string };
    assert.equal(d.sorte, 'complète', 'l\'agent ne dit pas sa dernière version : complète');
    const y = await fetch(`${v.url}/api/sindri/agent/morceau?session=${d.session}`, { method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'x-sha256': 'a'.repeat(64) }, body: 'pas ça' });
    assert.equal(y.status, 400);
    const z = await fetch(`${v.url}/api/sindri/agent/morceau?tache=x&id=y`, { headers: { authorization: `Bearer ${jeton}` } }); assert.equal(z.status, 403);
  } finally { await t.end(); rmSync(perso, { recursive: true, force: true }); if (avant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = avant; }
});

const pyExe = py ? String(spawnSync(py.cmd, [...py.args, '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout).trim() : '';
test('agent sous Windows (faux PowerShell) : installé (tâche toutes les heures), état, retrait complet', { skip: process.platform !== 'win32' ? 'PowerShell de Windows absent' : !pyExe && 'Python 3 absent', timeout: 120_000 }, () => {
  const perso = mkdtempSync(join(tmpdir(), 'poste-win-'));
  mkdirSync(join(perso, 'AppData', 'Roaming'), { recursive: true }); mkdirSync(join(perso, 'ProgramData')); mkdirSync(join(perso, 'Documents'));
  const faux = String.raw`function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force) Set-Content -LiteralPath (Join-Path $env:USERPROFILE ('tache-' + $TaskName)) -Value ($Action.a) }
function Get-ScheduledTask { param($TaskName, $ErrorAction) if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE ('tache-' + $TaskName))) { return @{ TaskName = $TaskName } } }
function Unregister-ScheduledTask { param($TaskName, $Confirm, $ErrorAction) Remove-Item -LiteralPath (Join-Path $env:USERPROFILE ('tache-' + $TaskName)) }
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) @{ e = $Execute; a = $Argument } }
function New-ScheduledTaskTrigger { param([switch]$Once, $At, $RepetitionInterval) if ($RepetitionInterval.TotalHours -ne 1) { throw 'pas toutes les heures' }; 'declencheur' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'compte' }
function New-ScheduledTaskSettingsSet { param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable, $ExecutionTimeLimit, $MultipleInstances) 'reglages' }
`;
  const env = { ...process.env, USERPROFILE: perso, APPDATA: join(perso, 'AppData', 'Roaming'), ProgramData: join(perso, 'ProgramData'), PATH: `${dirname(pyExe)};${process.env.PATH}` };
  const poste = (script: string) => spawnSync('powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoder(LANCEUR)], { input: faux + script, encoding: 'utf8', env, timeout: 90_000, windowsHide: true });
  try {
    const i = poste(scriptAgentWindows({ odin: 'http://192.168.1.10:8888', jeton: 'd'.repeat(64), poste: 'PC-BUREAU', empreinte: '', dossiers: [], exclure: [] }));
    const e = lireEtat(i.stdout); assert.equal(e?.ok, true, i.stdout + i.stderr);
    assert.match(String(e?.planification), /^tâche planifiée/); assert.deepEqual(e?.dossiers, [join(perso, 'Documents')], 'dossiers personnels par défaut');
    const d = String(e?.dossier); assert.ok(d.startsWith(perso), 'installé dans le profil jetable (ou ProgramData si administrateur)');
    assert.match(readFileSync(join(perso, `tache-${TACHE_AGENT}`), 'utf8'), /agent\.py" sauvegarder/);
    assert.equal(JSON.parse(readFileSync(join(d, 'agent.json'), 'utf8')).jeton, 'd'.repeat(64));
    assert.match(String(lireEtat(poste(gestesAgent.etat().windows()).stdout)?.planification), /tâche planifiée/);
    const r = lireEtat(poste(gestesAgent.retirer().windows()).stdout); assert.equal(r?.ok, true);
    assert.ok(!existsSync(d) && !existsSync(join(perso, `tache-${TACHE_AGENT}`)));
  } finally { rmSync(perso, { recursive: true, force: true }); }
});
