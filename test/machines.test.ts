import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { adminPassword, findMachine, listMachines, machineSecrets, remoteCommand, removeMachine, rightsSummary, saveMachine, setAdminPassword, sshArgs, viewMachine, withAdmin } from '../src/machines/access.ts';
import { makeOdin, call } from './helpers.ts';

test('administrateur local : « sudo » reçoit le mot de passe donné, jamais affiché', () => {
  const o = makeOdin([]);
  try {
    const home = o.paths.home;
    assert.deepEqual(withAdmin('ls -la', home, {}).env, {}, 'sans sudo : rien à faire');
    if (process.platform !== 'win32' && !(process.getuid?.() === 0)) {
      const none = withAdmin('sudo apt update && sudo apt upgrade -y', home, {});
      assert.equal(none.command, 'sudo -n apt update && sudo -n apt upgrade -y', 'sans mot de passe : échoue vite');
      assert.match(none.hint ?? '', /Droits et machines/);
    }
    setAdminPassword(home, 'mon mot de passe $ "spécial"');
    assert.equal(adminPassword(home, {}), 'mon mot de passe $ "spécial"', 'espaces et caractères spéciaux acceptés');
    if (process.platform !== 'win32') assert.equal(statSync(join(home, 'admin.json')).mode & 0o777, 0o600);
    if (process.platform !== 'win32' && !(process.getuid?.() === 0)) {
      const w = withAdmin('sudo systemctl restart nginx', home, {});
      assert.equal(w.command, 'sudo -A systemctl restart nginx');
      assert.equal(w.env.ODIN_ASKPASS_SECRET, 'mon mot de passe $ "spécial"');
      assert.match(readFileSync(String(w.env.SUDO_ASKPASS), 'utf8'), /ODIN_ASKPASS_SECRET/, 'le script lit la variable, le mot de passe n\'y est pas écrit');
      assert.doesNotMatch(readFileSync(String(w.env.SUDO_ASKPASS), 'utf8'), /spécial/);
    }
    assert.ok(machineSecrets(home).includes('mon mot de passe $ "spécial"'), 'masqué partout');
  } finally { o.cleanup(); }
});

test('coffre des machines : mots de passe gardés à part, jamais dans la vue ni le prompt', () => {
  const o = makeOdin([]);
  try {
    const home = o.paths.home;
    assert.throws(() => saveMachine(home, { host: 'a b', user: 'x' }), /adresse invalide/);
    assert.throws(() => saveMachine(home, { host: '192.168.1.30', user: 'x;rm' }), /utilisateur invalide/);
    const m = saveMachine(home, { host: '192.168.1.30', user: 'admin', password: 'Pa ss!', label: 'NAS' });
    if (process.platform !== 'win32') assert.equal(statSync(join(home, 'machines.json')).mode & 0o777, 0o600);
    // Mise à jour sans mot de passe : l'ancien est gardé.
    saveMachine(home, { host: '192.168.1.30', user: 'admin', label: 'NAS maison' });
    assert.equal(listMachines(home).length, 1);
    assert.equal(listMachines(home)[0].password, 'Pa ss!');
    assert.equal(findMachine(home, 'nas maison')?.id, m.id);
    assert.equal(findMachine(home, 'admin@192.168.1.30')?.id, m.id);
    const v = viewMachine(listMachines(home)[0]);
    assert.equal('password' in v, false); assert.equal(v.hasPassword, true);
    const summary = rightsSummary(home, {});
    assert.match(summary, /NAS maison \(admin@192\.168\.1\.30\)/);
    assert.doesNotMatch(summary, /Pa ss!/);
    // SSH : port, empreintes gardées par Odin, mot de passe seulement s'il y en a un.
    const args = sshArgs(home, listMachines(home)[0]);
    assert.ok(args.includes('StrictHostKeyChecking=accept-new'));
    assert.ok(args.includes(`UserKnownHostsFile=${join(home, 'known_hosts')}`));
    assert.equal(args.at(-1), 'admin@192.168.1.30');
    assert.ok(sshArgs(home, { host: 'h', port: 2222, user: 'u' }).includes('BatchMode=yes'), 'sans mot de passe : jamais d\'attente');
    assert.equal(remoteCommand('sudo apt update && sudo reboot', true), "sudo -S -p '' apt update && sudo -S -p '' reboot");
    assert.ok(removeMachine(home, 'NAS maison'));
    assert.equal(listMachines(home).length, 0);
  } finally { o.cleanup(); }
});

test('outil machine_exec : machine inconnue expliquée, mots de passe masqués dans les réponses', async () => {
  const o = makeOdin([call('machine_exec', { machine: 'serveur', command: 'uptime' }), { text: 'ok' }], { approve: true });
  try {
    saveMachine(o.paths.home, { host: '192.168.1.40', user: 'pi', password: 'MotDePasse123', label: 'raspberry' });
    o.redactor.add('MotDePasse123');
    await o.agent.run('quelle charge sur le serveur ?', { sessionId: 't' });
    const toolMsg = o.provider.calls[1].messages.find((m) => m.role === 'tool')!;
    assert.match(toolMsg.content, /Machine inconnue : serveur\. Machines enregistrées : raspberry/);
    assert.equal(o.redactor.redact('le mot est MotDePasse123'), 'le mot est [SECRET]');
    assert.doesNotMatch(o.provider.calls[0].system, /MotDePasse123/);
    assert.match(o.provider.calls[0].system, /raspberry \(pi@192\.168\.1\.40\)/, 'Odin sait quelles machines il peut joindre');
  } finally { o.cleanup(); }
});
