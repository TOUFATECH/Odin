import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { identityLine, listScripts, scriptRun, scriptSave, scriptsIndex, selfIdentity } from '../src/tools/scripts.ts';
import { makeOdin } from './helpers.ts';

const out = (r: unknown) => (typeof r === 'string' ? r : (r as { output: string }).output);

test('scripts : écrit, lancé, échoue, corrigé (nouvelle version gardée), réussites comptées', async () => {
  const o = makeOdin([]);
  try {
    const ctx = { workspace: o.paths.workspace, home: o.paths.home, redactor: o.redactor, signal: new AbortController().signal } as never;
    await scriptSave.run({ name: 'compte-mots', lang: 'python', description: 'compte les mots d\'un texte (argument)', code: 'import sys\nprint(len(sys.argv[1].split())) if len(sys.argv) > 1 else sys.exit("argument manquant")' }, ctx);
    assert.match(out(await scriptRun.run({ name: 'compte-mots', args: '"un deux trois"' }, ctx)), /^3\n\[script compte-mots v1 — code de sortie 0\]/);
    assert.match(out(await scriptRun.run({ name: 'compte-mots' }, ctx)), /argument manquant[\s\S]*ÉCHEC/);
    let m = listScripts(o.paths.workspace)[0];
    assert.deepEqual([m.runs, m.ok, m.fails], [2, 1, 1]); assert.match(m.lastError!, /argument manquant/);
    await scriptSave.run({ name: 'compte-mots', lang: 'python', code: 'import sys\nprint(len(" ".join(sys.argv[1:]).split()))', change: 'sans argument : 0 au lieu d\'une erreur' }, ctx);
    assert.match(out(await scriptRun.run({ name: 'compte-mots' }, ctx)), /^0\n/);
    m = listScripts(o.paths.workspace)[0];
    assert.equal(m.version, 2); assert.equal(m.lastError, undefined);
    assert.ok(existsSync(join(o.paths.workspace, 'scripts', '.versions', 'compte-mots.v1.py')), 'ancienne version gardée');
    assert.match(scriptsIndex([m]), /compte-mots \(python, v2, 2\/3 réussi\(s\)\)/);
    await scriptSave.run({ name: 'bonjour', lang: 'bash', description: 'dit bonjour', code: 'echo "bonjour $1"' }, ctx);
    assert.match(out(await scriptRun.run({ name: 'bonjour', args: 'Djin' }, ctx)), /^bonjour Djin/);
    assert.match(out(await scriptSave.run({ name: 'casse', lang: 'bash', code: 'rm -rf / --no-preserve-root' }, ctx)), /Refusé/);
    assert.ok(!readdirSync(join(o.paths.workspace, 'scripts')).some((f) => f.startsWith('casse')));
    assert.match(out(await scriptRun.run({ name: 'inconnu' }, ctx)), /Script inconnu[\s\S]*bonjour/);
  } finally { o.cleanup(); }
});

test('Odin connaît le nom d\'hôte et l\'adresse IP de sa machine', () => {
  const id = selfIdentity({ eth0: [{ address: '192.168.1.21', family: 'IPv4', internal: false } as never, { address: 'fe80::1', family: 'IPv6', internal: false } as never], lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never] }, 'odin-ct');
  assert.equal(id.hostname, 'odin-ct');
  assert.deepEqual(id.ips.map((x) => x.ip), ['192.168.1.21']);
  assert.match(identityLine({ ...id, container: 'conteneur LXC' }), /nom d'hôte « odin-ct » \(conteneur LXC\), adresse\(s\) IP : 192\.168\.1\.21 \(eth0\)/);
});
