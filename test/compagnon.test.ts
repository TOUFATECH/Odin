// Le compagnon d'Odin sur les postes du parc : calculs purs (versions, failles, conseils), scripts d'installation
// (sh et PowerShell), Satellites avec de faux postes (faux SSH, faux PowerShell), Genèse qui le pose à la fin d'une
// installation, et pour de vrai : un vrai Odin et le vrai programme Python du compagnon (analyse avec les signatures
// d'Asclépios, rapport du système, consignes et bulles).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { saveMachine } from '../src/machines/access.ts';
import { essais } from '../src/machines/windows.ts';
import { intelOf } from '../src/valhalla/modules/ullr.ts';
import { conseils, failles, fiche, inscrire, inscrits, lireEtat, posteDuJeton, propre, scriptInstallationPosix, scriptInstallationWindows, versionInferieure, type Rapport } from '../src/valhalla/compagnon/compagnon.ts';
import { ubuntuUserData, windowsAfter, type Answer } from '../src/valhalla/thjalfi/recipes.ts';

const PY = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' }).stdout?.trim() === '3');
const AGENT = fileURLToPath(new URL('../src/valhalla/compagnon/compagnon.py', import.meta.url));
const KEV = [
  { cve: 'CVE-2026-1001', vendor: 'Google', product: 'Chromium V8', name: 'Google Chromium V8 Type Confusion', added: '2026-10-01', ransomware: false },
  { cve: 'CVE-2026-1002', vendor: 'RARLAB', product: 'WinRAR', name: 'RARLAB WinRAR Path Traversal', added: '2026-09-15', ransomware: true },
  { cve: 'CVE-2019-0001', vendor: 'Mozilla', product: 'Firefox', name: 'vieille faille', added: '2019-01-01', ransomware: false },
];

test('calculs purs : versions, failles (catalogue des failles exploitées), conseils à la personne', () => {
  assert.equal(versionInferieure('1.2.9', '1.2.10'), true); assert.equal(versionInferieure('10.0', '9.9'), false); assert.equal(versionInferieure('1.0', '1.0.0'), false); assert.equal(versionInferieure('2.4.1-1ubuntu1', '2.4.1-2'), true);
  const applis = [{ nom: 'Google Chrome', version: '129.0.1' }, { nom: 'WinRAR 6.02 (64-bit)', version: '6.02.0' }, { nom: 'Mozilla Firefox', version: '60.0' }, { nom: 'Calculatrice', version: '1' }];
  const f = failles(applis, KEV, [{ nom: 'Google Chrome', nouvelle: '131.0.2' }], { now: Date.parse('2026-11-15') });
  assert.deepEqual(f.map((x) => x.cve), ['CVE-2026-1001', 'CVE-2026-1002'], 'les failles de plus de 2 ans sont laissées de côté ; celle qui a un correctif en attente d\'abord');
  assert.equal(f[0].majDispo, '131.0.2'); assert.equal(f[1].rancon, true); assert.equal(f[1].majDispo, undefined);
  const r: Rapport = { t: 0, version: '1.0.0', systeme: { disque: 95 }, applis, majs: [{ nom: 'Google Chrome', nouvelle: '131.0.2', securite: true }], redemarrage: true };
  const c = conseils(r, f, { majsAuto: true, heure: 3 });
  assert.deepEqual(c.map((x) => x.cle?.split(':')[0]), ['failles', 'redemarrage', 'disque']);
  assert.match(c[0].texte, /cette nuit \(3 h\)/); assert.equal(c[0].niveau, 'haute');
  assert.match(conseils({ ...r, redemarrage: false, systeme: {} }, [], { majsAuto: false, heure: 3 })[0].texte, /1 mise\(s\) à jour attend\(ent\), dont 1 de sécurité\. Dis-moi quand/);
  assert.equal(propre('PC du salon; rm -rf /'), 'PC du salon rm -rf ');
});

test('scripts d\'installation : configuration contrôlée, jeton jamais en clair dans la commande, icône Windows', () => {
  const c = { odin: 'https://192.168.1.10:8888', jeton: 'a'.repeat(64), poste: 'pc-salon', empreinte: 'b'.repeat(64) };
  assert.throws(() => scriptInstallationPosix({ ...c, odin: 'https://x"; rm -rf /' }), /adresse d'Odin invalide/);
  assert.throws(() => scriptInstallationPosix({ ...c, jeton: 'court' }), /jeton invalide/);
  const sh = scriptInstallationPosix(c);
  assert.ok(!sh.includes(c.jeton), 'le jeton n\'apparaît pas en clair'); assert.match(sh, /sudo sh -c "\$CODE" sh systeme/);
  const coeur = Buffer.from(/printf %s '([A-Za-z0-9+/=]+)'/.exec(sh)![1], 'base64').toString('utf8');
  assert.match(coeur, /systemctl enable --now odin-compagnon\.service/); assert.match(coeur, /LaunchDaemons/); assert.match(coeur, /\/etc\/xdg\/autostart/);
  const ps = scriptInstallationWindows(c);
  assert.ok(!ps.includes(c.jeton)); assert.match(ps, /Register-ScheduledTask -TaskName \$tache/); assert.match(ps, /S-1-5-18/); assert.match(ps, /Python\.Python\.3\.12/);
  const icone = Buffer.from(/session\\icone\.ps1'\) '([A-Za-z0-9+/=]+)'/.exec(ps)![1], 'base64').toString('utf8');
  assert.match(icone, /NotifyIcon/); assert.match(icone, /ShowBalloonTip/); assert.match(icone, /Analyser maintenant/);
});

test('Genèse : le compagnon posé à la fin de l\'installation (Linux et Windows), seulement si le profil le veut', () => {
  const a: Answer = { host: 'pc-01', user: 'admin', password: 'mot-de-passe-1', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://192.168.1.10:16000/etat/AbCdEfGhIjKlMnOpQr' };
  const unite = (x: Answer) => Buffer.from(/echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(ubuntuUserData(x))![1], 'base64').toString('utf8');
  assert.doesNotMatch(unite(a), /compagnon/);
  assert.match(unite({ ...a, compagnon: true }), /curl -fsS "http:\/\/192\.168\.1\.10:16000\/seed\/AbCdEfGhIjKlMnOpQr\/compagnon\.sh"/);
  assert.match(windowsAfter({ ...a, compagnon: true }), /\/w\/AbCdEfGhIjKlMnOpQr\/compagnon\.ps1/); assert.doesNotMatch(windowsAfter(a), /compagnon/);
});

test('les sorties des gestionnaires de mises à jour, lues par le compagnon (Python)', { skip: !PY && 'python 3 absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'compagnon-majs-'));
  try {
    const lire = (g: string, t: string) => { writeFileSync(join(d, 'x.txt'), t); const r = spawnSync(PY!, [AGENT, 'lire-majs', '--gestionnaire', g, '--fichier', join(d, 'x.txt')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout) as Array<Record<string, string>>; };
    assert.deepEqual(lire('apt', 'Listing...\nopenssl/noble-updates,noble-security 3.0.13-0ubuntu3.4 amd64 [upgradable from: 3.0.13-0ubuntu3.1]\n'), [{ nom: 'openssl', nouvelle: '3.0.13-0ubuntu3.4', version: '3.0.13-0ubuntu3.1' }]);
    assert.deepEqual(lire('dnf', '\nLast metadata expiration check: 0:01:02 ago.\nkernel.x86_64                6.11.4-301.fc41         updates\ncurl.x86_64 8.9.1-2.fc41 updates\n').map((x) => x.nom), ['kernel', 'curl']);
    assert.deepEqual(lire('zypper', 'S | Repository | Name | Current Version | Available Version | Arch\n--+---+---+---+---+---\nv | Main | sudo | 1.9.15 | 1.9.16 | x86_64\n'), [{ nom: 'sudo', version: '1.9.15', nouvelle: '1.9.16' }]);
    const su = lire('softwareupdate', 'Software Update found the following new or updated software:\n* Label: macOS Sequoia 15.1.1-24B91\n\tTitle: macOS Sequoia 15.1.1, Version: 15.1.1, Size: 1234K, Recommended: YES, Action: restart,\n');
    assert.equal(su[0].label, 'macOS Sequoia 15.1.1-24B91'); assert.equal(su[0].nouvelle, '15.1.1');
    const wg = lire('winget', 'Name                Id                    Version  Available Source\n------------------------------------------------------------------\nMozilla Firefox     Mozilla.Firefox       131.0    132.0.1   winget\n7-Zip 23.01 (x64)   7zip.7zip             23.01    24.08     winget\n2 upgrades available.\n');
    assert.deepEqual(wg.map((x) => [x.id, x.version, x.nouvelle]), [['Mozilla.Firefox', '131.0', '132.0.1'], ['7zip.7zip', '23.01', '24.08']]);
    assert.equal(lire('windows-update', '[{"titre":"2026-11 Mise à jour cumulative (KB5050001)","kb":"5050001","securite":true}]')[0].securite, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Satellites : installer, vérifier et retirer le compagnon sur de faux postes Windows et Linux', async () => {
  const home = mkdtempSync(join(tmpdir(), 'compagnon-sat-')), saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const vus: Array<{ m: string; script: string; lien?: string }> = [];
  essais.windows = async (m, script, lien) => { vus.push({ m: m.label, script, lien }); if (/Register-ScheduledTask/.test(script)) return { code: 0, out: 'bruit\n{"ok":true,"version":"1.0.0","mode":"systeme","systeme":{"systeme":"Windows 11 Pro","version":"24H2","build":"26100.2314"},"gestionnaires":["windows-update","winget"],"demarrage":"tâche planifiée (SYSTEM)"}' }; if (/Unregister-ScheduledTask/.test(script)) return { code: 0, out: '{"ok":true,"reste":[]}' }; return { code: 0, out: '{"ok":true,"mode":"systeme","systeme":{"systeme":"Windows 11 Pro","version":"24H2","build":"26100.2314"},"service":"Running"}' }; };
  essais.commande = async (m, cmd) => { vus.push({ m: m.label, script: cmd }); if (cmd === 'uname -s') return { code: 0, out: m.label === 'pc-linux' ? 'Linux\n' : 'bash: uname: not found\n' }; if (cmd === 'cmd /c ver') return { code: 0, out: 'Microsoft Windows [version 10.0.26100.2314]' }; if (/sudo sh -c "\$CODE" sh systeme/.test(cmd)) return { code: 0, out: '{"ok":true,"mode":"systeme","systeme":{"systeme":"Ubuntu","version":"24.04","build":"24.04.1 LTS (Noble Numbat)"},"gestionnaires":["apt"],"demarrage":"systemd"}' }; if (/odin-compagnon/.test(cmd)) return { code: 0, out: '{"ok":true}' }; return { code: 1, out: '' }; };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never).filter((m) => ['hermod', 'ullr'].includes(m.id)), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'autonome' });
  try {
    saveMachine(home, { label: 'pc-bureau', host: '192.168.1.31', user: 'admin', password: 'mdp-du-poste' }); saveMachine(home, { label: 'pc-linux', host: '192.168.1.32', user: 'awa' });
    const r = await v.act('hermod', 'compagnon_installer', { machine: 'pc-bureau', adresse_odin: 'https://192.168.1.10:8888' }, { confirmed: true } as never);
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Windows 11 Pro 24H2 \(26100\.2314\)/);
    const ps = vus.find((x) => /Register-ScheduledTask/.test(x.script))!; assert.equal(ps.lien, 'ssh');
    const conf = JSON.parse(Buffer.from(/FromBase64String\('([A-Za-z0-9+/=]+)'\)\) \| ConvertFrom-Json/.exec(ps.script)![1], 'base64').toString('utf8')) as { jeton: string; odin: string; poste: string };
    assert.equal(conf.odin, 'https://192.168.1.10:8888'); assert.equal(posteDuJeton(home, conf.jeton)?.poste, 'pc-bureau', 'Odin ne garde que l\'empreinte du jeton remis au poste');
    assert.equal((await v.act('hermod', 'compagnon_installer', { machine: 'pc-linux' }, { confirmed: true } as never)).ok, true);
    assert.deepEqual(inscrits(home).map((x) => [x.poste, x.systeme]).sort(), [['pc-bureau', 'windows'], ['pc-linux', 'posix']]);
    assert.match((await v.act('hermod', 'compagnon_etat', { machine: 'pc-bureau' })).text, /Running/);
    assert.match((await v.act('hermod', 'compagnons')).text, /pc-bureau · Windows/);
    assert.equal((await v.act('hermod', 'compagnon_analyser', { poste: 'pc-bureau' })).ok, true); assert.equal(fiche(home, 'pc-bureau').consignes.analyser, true);
    assert.equal((await v.act('hermod', 'compagnon_guider', { poste: 'tous', texte: 'Pense à brancher ton ordinateur ce soir.' })).ok, true);
    assert.ok(fiche(home, 'pc-linux').consignes.bulles.some((b) => /brancher/.test(b.texte)));
    assert.equal((await v.act('hermod', 'compagnon_retirer', { machine: 'pc-bureau' }, { confirmed: true } as never)).ok, true);
    assert.equal(posteDuJeton(home, conf.jeton), undefined, 'retiré : le jeton ne vaut plus rien');
    assert.equal((await v.act('hermod', 'compagnon_analyser', { poste: 'pc-bureau' })).ok, false);
    const g = await v.act('hermod', 'compagnon_script', { poste: 'pc-02', systeme: 'windows', adresse_odin: 'https://192.168.1.10:8888' });
    assert.match(String((g.data as { script: string }).script), /Register-ScheduledTask/); assert.equal(inscrits(home).find((x) => x.poste === 'pc-02')?.via, 'genese');
    void lireEtat;
  } finally { essais.windows = undefined; essais.commande = undefined; v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); }
});

test('pour de vrai : le compagnon Python parle à un vrai Odin (signatures d\'Asclépios, analyse, rapport, consignes)', { skip: !PY && 'python 3 absent', timeout: 240_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const o = await vraiOdin(tt, { compte: true, modules: (x) => allModules(x).filter((m) => ['hermod', 'ullr', 'var'].includes(m.id)) }), va = valhallaOf()!;
    const home = o.o.paths.home, ullr = va.ctx('ullr');
    // Asclépios connaît un « malware » (un fichier d'essai) par son empreinte.
    const faux = Buffer.from(`programme dangereux d'essai ${Date.now()}`), h = createHash('sha256').update(faux).digest('hex');
    intelOf(ullr).build([{ hashes: [{ sha: h, family: 'Essai.Odin' }], stamp: { id: 'essai', at: new Date().toISOString(), count: 1, licence: 'essai' } }]);
    // Le poste : le programme du compagnon, sa configuration (jeton), un dossier avec deux fichiers dangereux et un sain.
    const d = tt.tmp('compagnon-poste-'), ici = join(d, 'OdinCompagnon'), docs = join(d, 'Telechargements'); mkdirSync(ici); mkdirSync(docs);
    copyFileSync(AGENT, join(ici, 'compagnon.py'));
    const jeton = inscrire(home, 'pc-essai', { systeme: process.platform === 'win32' ? 'windows' : 'posix' });
    writeFileSync(join(ici, 'compagnon.json'), JSON.stringify({ odin: o.url, jeton, poste: 'pc-essai', empreinte: '', mode: 'utilisateur' }));
    // (Pas de fichier EICAR ici : l'antivirus de la machine d'essai l'efface avant nous.)
    writeFileSync(join(docs, 'facture.pdf.exe'), faux); writeFileSync(join(docs, 'photo.jpg'), Buffer.alloc(2048, 7)); writeFileSync(join(docs, 'lettre.txt'), 'Bonjour');
    // Lancé à part (jamais spawnSync : Odin tourne dans ce même processus et doit pouvoir répondre).
    const lancer = (...a: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((ok) => execFile(PY!, [join(ici, 'compagnon.py'), ...a], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (e, stdout, stderr) => ok({ status: e ? (typeof e.code === 'number' ? e.code : null) : 0, stdout, stderr })));
    let r = await lancer('analyser', '--chemin', docs); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').at(-1)!), { ok: true, fichiers: 3, detections: 1 });
    assert.deepEqual(readdirSync(docs).sort(), ['lettre.txt', 'photo.jpg'], 'le fichier dangereux est mis à l\'écart');
    assert.ok(existsSync(join(ici, 'etat', 'signatures.bin')), 'signatures d\'Asclépios reçues');
    const f = fiche(home, 'pc-essai'); assert.equal(f.analyse?.detections.length, 1); assert.ok(f.analyse?.detections.every((x) => x.ecarte));
    assert.ok(f.analyse?.detections.some((x) => x.sha256 === h && /malware connu/.test(x.quoi)));
    assert.ok(ullr.alerts({ module: 'ullr' }).some((a) => /1 fichier\(s\) dangereux sur pc-essai/.test(a.title)), 'alerte d\'Asclépios');
    assert.ok(f.consignes.bulles.some((b) => /mis à l'écart/.test(b.titre)), 'bulle pour la personne du poste');
    r = await lancer('rapport', '--sans-majs'); assert.equal(r.status, 0, r.stderr + r.stdout);
    const f2 = fiche(home, 'pc-essai'); assert.ok(f2.rapport?.systeme.famille); assert.ok(Array.isArray(f2.rapport?.applis));
    // Les consignes : les bulles partent une fois, l'analyse demandée aussi.
    await va.act('hermod', 'compagnon_analyser', { poste: 'pc-essai' });
    const consignes = async (tok = jeton) => fetch(`${o.url}/api/compagnon/consignes`, { headers: { authorization: `Bearer ${tok}` } });
    let c = (await (await consignes()).json()) as { analyser: boolean; bulles: unknown[]; majs: string };
    assert.equal(c.analyser, true); assert.ok(c.bulles.length >= 1); assert.equal(c.majs, 'auto');
    c = (await (await consignes()).json()) as typeof c; assert.equal(c.analyser, false); assert.equal(c.bulles.length, 0, 'une seule fois');
    assert.equal((await consignes('0'.repeat(64))).status, 401, 'jeton inconnu');
    assert.equal((await fetch(`${o.url}/api/compagnon/rapport`, { method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' }, body: '{pas du json' })).status, 400);
    const e = await lancer('etat'); assert.equal(JSON.parse(e.stdout.trim()).signatures, 1);
  } finally { Object.assign(console, orig); await tt.end(); }
});
