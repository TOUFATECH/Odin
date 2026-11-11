// Odin administrateur de sa machine, partout : le diagnostic dit la vraie cause, la réparation ne casse rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose, dropIn, fixAdmin, fixAdminWindows, inContainer, noNewPrivs, parseShow, unitOf, type Facts, type Shell } from '../src/machines/admin.ts';
import { sudoRefused } from '../src/machines/access.ts';
import { voiceBlocked, voiceFailure } from '../src/voice/local.ts';

const base: Facts = { platform: 'linux', uid: 1001, elevated: false, noNewPrivs: false, sudo: true, sudoFree: false, password: false, container: false, user: 'odin', command: '/usr/bin/node /opt/odin/bin/odin.mjs' };

test('droits administrateur : chaque situation a sa cause et sa marche à suivre, jamais un mot de passe inutile', () => {
  assert.deepEqual([diagnose({ ...base, uid: 0 }).mode, diagnose({ ...base, uid: 0 }).ok], ['root', true]);
  assert.equal(diagnose({ ...base, sudoFree: true }).mode, 'nopasswd');
  assert.equal(diagnose({ ...base, password: true }).mode, 'password');
  const none = diagnose(base);
  assert.equal(none.mode, 'none'); assert.equal(none.ok, false);
  assert.match(none.fix, /le mot de passe admin de ce poste est/); assert.match(none.fix, /Droits et machines/); assert.match(none.fix, /admin fix --user odin/);
  // Service verrouillé (le cas d'un compte dédié avec NoNewPrivileges) : le mot de passe ne servirait à rien.
  const locked = diagnose({ ...base, noNewPrivs: true, sudoFree: false, password: true, unit: { name: 'odin.service', scope: 'system' } });
  assert.equal(locked.mode, 'blocked'); assert.equal(locked.ok, false);
  assert.match(locked.state, /service « odin\.service »[\s\S]*NoNewPrivileges[\s\S]*Aucun mot de passe/);
  assert.match(locked.fix, /sudo \/usr\/bin\/node \/opt\/odin\/bin\/odin\.mjs admin fix --unit odin\.service --user odin/);
  assert.doesNotMatch(`${locked.state} ${locked.fix}`, /mot de passe admin de ce poste/, 'on ne réclame pas un mot de passe qui ne servirait à rien');
  // Conteneur : durci, ou sans sudo.
  assert.match(diagnose({ ...base, noNewPrivs: true, container: true }).fix, /docker run --user root/);
  const bare = diagnose({ ...base, sudo: false, container: true });
  assert.equal(bare.mode, 'absent'); assert.match(bare.state, /conteneur[\s\S]*sudo n'y est pas installé/); assert.match(bare.fix, /--user root/);
  assert.match(diagnose({ ...base, sudo: false }).fix, /admin fix --user odin/);
  // Windows : élevé ou non.
  assert.equal(diagnose({ ...base, platform: 'win32', uid: -1, elevated: true }).mode, 'root');
  const win = diagnose({ ...base, platform: 'win32', uid: -1 });
  assert.equal(win.ok, false); assert.match(win.fix, /PowerShell en administrateur[\s\S]*odin admin fix/);
});

test('droits administrateur : service, conteneur et verrou reconnus d\'après ce que dit le système', () => {
  assert.deepEqual(unitOf('0::/system.slice/odin.service\n'), { name: 'odin.service', scope: 'system' });
  assert.deepEqual(unitOf('0::/user.slice/user-1000.slice/user@1000.service/app.slice/odin.service\n'), { name: 'odin.service', scope: 'user' });
  assert.deepEqual(unitOf('12:pids:/system.slice/agent-odin.service\n1:name=systemd:/system.slice/agent-odin.service\n'), { name: 'agent-odin.service', scope: 'system' });
  assert.equal(unitOf('0::/user.slice/user-1000.slice/session-3.scope\n'), undefined, 'un terminal n\'est pas un service');
  assert.equal(unitOf('0::/\n'), undefined);
  assert.equal(noNewPrivs('Name:\tnode\nNoNewPrivs:\t1\nSeccomp:\t0\n'), true);
  assert.equal(noNewPrivs('Name:\tnode\nNoNewPrivs:\t0\n'), false);
  assert.equal(inContainer('0::/\n', {}, (p) => p === '/.dockerenv'), true);
  assert.equal(inContainer('0::/kubepods/besteffort/pod1/abc\n', {}, () => false), true);
  assert.equal(inContainer('0::/system.slice/odin.service\n', {}, () => false), false);
});

test('droits administrateur : sudo a-t-il vraiment refusé ? (sinon on montre la vraie erreur)', () => {
  for (const out of ['sudo: a password is required', 'sudo: a terminal is required to read the password; either use the -S option', 'sudo: The "no new privileges" flag is set, which prevents sudo from running as root.', 'bash: line 1: sudo: command not found', 'sh: 1: sudo: not found', 'sudo: effective uid is not 0, is /usr/bin/sudo on a file system with the \'nosuid\' option set']) assert.equal(sudoRefused(out), true, out);
  for (const out of ['E: Unable to locate package cmake', 'CMake Error at CMakeLists.txt:3', 'curl: (6) Could not resolve host: huggingface.co', 'fatal: unable to access \'https://github.com/\'', '']) assert.equal(sudoRefused(out), false, out);
  // L'écoute : droits manquants → la cause du diagnostic ; autre échec → la vraie dernière ligne, sans parler de mot de passe.
  const adm = voiceFailure('Paquets à installer : cmake g++ ffmpeg\nsudo: a password is required', true, 'Pas encore administrateur : sudo me demande un mot de passe. Dis-moi une fois…');
  assert.match(adm, /il manque cmake, g\+\+, ffmpeg[\s\S]*droits administrateur[\s\S]*sudo me demande un mot de passe[\s\S]*je relance l'installation tout seul/);
  const real = voiceFailure('→ Whisper (compréhension des vocaux)\nCMake Error at CMakeLists.txt:3 (project): No CMAKE_CXX_COMPILER could be found.', false);
  assert.match(real, /a échoué : CMake Error at CMakeLists\.txt:3/); assert.doesNotMatch(real, /mot de passe/);
});

test('écoute des vocaux : sans droits pour installer ses outils, Odin le dit une fois, avec la vraie cause et la commande', { skip: process.platform !== 'linux' && 'cette installation ne concerne que Linux' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-voix-'));
  try {
    const locked = diagnose({ ...base, noNewPrivs: true, unit: { name: 'odin.service', scope: 'system' } });
    const msg = voiceBlocked(home, (c) => !['cmake', 'g++', 'ffmpeg'].includes(c), () => locked)!;
    assert.match(msg, /^Je ne peux pas encore écouter tes vocaux : il manque cmake, g\+\+, ffmpeg sur ce poste/);
    assert.match(msg, /NoNewPrivileges[\s\S]*admin fix --unit odin\.service --user odin[\s\S]*je l'installe tout seul/);
    assert.doesNotMatch(msg, /Réglages → Droits et machines|mot de passe admin de ce poste/, 'pas de mot de passe réclamé quand il ne servirait à rien');
    // Tout est là, ou Odin est administrateur : rien ne bloque, l'installation peut partir.
    assert.equal(voiceBlocked(home, () => true, () => locked), undefined);
    assert.equal(voiceBlocked(home, () => false, () => diagnose({ ...base, sudoFree: true })), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('odin admin fix : seuls les réglages qui bloquent sont retirés', () => {
  const p = parseShow('LoadState=loaded\nUser=odin\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=read-only\nPrivateDevices=yes\nRestrictNamespaces=yes\nSystemCallFilter=@system-service\nLockPersonality=no\nRestrictAddressFamilies=\nCapabilityBoundingSet=cap_net_bind_service\n');
  const d = dropIn(p);
  assert.match(d, /^\[Service\]$/m);
  for (const l of ['NoNewPrivileges=no', 'ProtectSystem=no', 'ProtectHome=no', 'PrivateDevices=no', 'RestrictNamespaces=no', 'SystemCallFilter=', 'CapabilityBoundingSet=~']) assert.ok(d.split('\n').includes(l), l);
  for (const l of ['LockPersonality=no', 'RestrictAddressFamilies=', 'MemoryDenyWriteExecute=no']) assert.ok(!d.split('\n').includes(l), `${l} n'était pas en cause : on n'y touche pas`);
  assert.ok(!dropIn({ LoadState: 'loaded', CapabilityBoundingSet: 'cap_chown cap_sys_admin cap_setuid' }).includes('CapabilityBoundingSet'), 'capacités intactes : rien à rendre');
  // Rien pu lire du service : tout ce qui verrouille est remis à zéro.
  assert.ok(dropIn().split('\n').includes('MemoryDenyWriteExecute=no') && dropIn().split('\n').includes('SystemCallFilter='));
});

/** Faux système : un service « odin.service » verrouillé, qu'on peut faire échouer au redémarrage. */
function fake(o: { failRestart?: boolean; visudo?: number; dynamic?: boolean; stillLocked?: boolean } = {}) {
  const calls: string[] = []; let restarts = 0;
  const sh: Shell = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'visudo') return { code: o.visudo ?? 0, out: o.visudo ? 'syntax error near line 1' : 'parsed OK' };
    if (cmd === 'systemctl' && args[0] === 'show' && args.includes('--property=MainPID')) return { code: 0, out: 'MainPID=4242' };
    if (cmd === 'systemctl' && args[0] === 'show') return { code: 0, out: `LoadState=loaded\nUser=odin\nNoNewPrivileges=yes\nProtectSystem=strict\nPrivateDevices=yes\n${o.dynamic ? 'DynamicUser=yes\n' : ''}` };
    if (cmd === 'systemctl' && args[0] === 'restart') { restarts++; return o.failRestart && restarts === 1 ? { code: 1, out: 'Job for odin.service failed because the control process exited with error code.' } : { code: 0, out: '' }; }
    if (cmd === 'systemctl' && args[0] === 'is-active') return { code: 0, out: 'active' };
    return { code: 0, out: '' };
  };
  const root = mkdtempSync(join(tmpdir(), 'odin-admin-'));
  const run = (extra: Parameters<typeof fixAdmin>[0] = {}) => fixAdmin({ sh, root, isRoot: true, sleep: () => {}, has: (c) => c === 'systemctl' || c === 'sudo', readStatus: () => `NoNewPrivs:\t${o.stillLocked ? 1 : 0}\n`, unit: 'odin', user: 'odin', ...extra });
  return { calls, root, run, sudoers: join(root, 'etc', 'sudoers.d', 'odin'), drop: join(root, 'etc', 'systemd', 'system', 'odin.service.d', '90-odin-administrateur.conf'), end: () => rmSync(root, { recursive: true, force: true }) };
}

test('odin admin fix : droits donnés, verrous du service retirés, service redémarré et vérifié', () => {
  const f = fake();
  try {
    const r = f.run();
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(readFileSync(f.sudoers, 'utf8'), 'odin ALL=(ALL:ALL) NOPASSWD: ALL\n');
    assert.ok(f.calls.some((c) => c.startsWith('visudo -cf ')), 'la règle est vérifiée par visudo avant d\'être posée');
    const d = readFileSync(f.drop, 'utf8');
    assert.ok(d.includes('NoNewPrivileges=no') && d.includes('ProtectSystem=no') && d.includes('PrivateDevices=no'));
    assert.ok(f.calls.indexOf('systemctl daemon-reload') < f.calls.indexOf('systemctl restart odin.service'), 'rechargement, puis redémarrage');
    assert.match(r.lines.join('\n'), /Vérifié sur le processus : plus de verrou/);
  } finally { f.end(); }
});

test('odin admin fix : si le service ne repart pas, tout est remis comme avant', () => {
  const f = fake({ failRestart: true });
  try {
    const r = f.run();
    assert.equal(r.ok, false);
    assert.equal(existsSync(f.drop), false, 'le réglage ajouté est retiré');
    assert.equal(f.calls.filter((c) => c === 'systemctl restart odin.service').length, 2, 'le service est relancé comme avant');
    assert.match(r.lines.join('\n'), /n'a pas redémarré avec le nouveau réglage : je l'ai retiré et le service est relancé comme avant/);
  } finally { f.end(); }
});

test('odin admin fix : refus propres (pas administrateur, règle invalide, compte temporaire, verrou restant)', () => {
  let f = fake();
  try { const r = f.run({ isRoot: false }); assert.equal(r.ok, false); assert.match(r.lines[0], /lance-la en administrateur[\s\S]*sudo .*admin fix --unit odin --user odin/); assert.equal(f.calls.length, 0, 'rien n\'est tenté'); } finally { f.end(); }
  f = fake({ visudo: 1 });
  try { const r = f.run({ unit: undefined }); assert.equal(existsSync(f.sudoers), false, 'une règle refusée par visudo n\'est jamais posée'); assert.match(r.lines.join('\n'), /refusée par visudo/); } finally { f.end(); }
  f = fake({ dynamic: true });
  try { const r = f.run(); assert.equal(r.ok, false); assert.equal(existsSync(f.drop), false); assert.match(r.lines.join('\n'), /DynamicUser/); } finally { f.end(); }
  f = fake({ stillLocked: true });
  try { const r = f.run(); assert.equal(r.ok, false); assert.match(r.lines.join('\n'), /Le verrou est encore là/); } finally { f.end(); }
  f = fake();
  try { assert.equal(fixAdmin({ sh: () => ({ code: 0, out: '' }), root: f.root, isRoot: true, has: () => false, unit: 'odin; rm -rf /', user: 'odin' }).ok, false, 'nom de service inattendu refusé'); assert.equal(fixAdmin({ sh: () => ({ code: 0, out: '' }), root: f.root, isRoot: true, has: (c) => c === 'sudo', user: 'odin$(id)' }).ok, false, 'nom de compte inattendu refusé'); } finally { f.end(); }
});

test('odin admin fix (Windows) : la tâche « Odin » passe en privilèges élevés', () => {
  assert.equal(fixAdminWindows(() => ({ code: 0, out: '' }), false).ok, false);
  assert.match(fixAdminWindows(() => ({ code: 0, out: '' }), false).lines[0], /PowerShell en administrateur/);
  let seen = '';
  const ok = fixAdminWindows((cmd, args) => { seen = `${cmd} ${args.join(' ')}`; return { code: 0, out: 'Highest' }; }, true);
  assert.equal(ok.ok, true); assert.match(seen, /-RunLevel Highest[\s\S]*Set-ScheduledTask -TaskName 'Odin'/); assert.doesNotMatch(seen.split('-Command ')[1], /"/, 'aucun guillemet double dans le script passé à PowerShell');
  assert.equal(fixAdminWindows(() => ({ code: 3, out: 'ABSENTE' }), true).ok, false);
  assert.match(fixAdminWindows(() => ({ code: 3, out: 'ABSENTE' }), true).lines[0], /relance l'installateur/);
});
