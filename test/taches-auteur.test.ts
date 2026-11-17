// Relecture du lot S 2, constat 1 (de bout en bout) : une tâche programmée par un MEMBRE tourne avec SES droits, jamais
// ceux du propriétaire ; un script programmé par un membre ne tourne pas ; le propriétaire garde l'accord d'avance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOdin } from './helpers.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';

class FakeChannel implements Channel {
  readonly name = 'fake'; readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

// Programmer une tâche n'est pas dans ce qu'un membre fait faire seul (décision du propriétaire, 17/11 : « pour tout le
// reste, Odin te demande à toi ») : la programmation lui est demandée, même en Breaker avec « toujours » pour les tâches.
test('un membre programme une tâche : demandé au propriétaire ; sans son accord, rien n\'est programmé', async () => {
  const o = makeOdin([call('schedule_task', { cron: '0 3 * * *', prompt: 'lance la commande de nettoyage' }), { text: 'programmé' }]);
  try {
    o.heimdall.setBreaker({ ...o.heimdall.getBreaker(), schedule: 'always' });
    o.heimdall.setAutonomy('breaker');
    await o.agent.run('programme le nettoyage chaque nuit', { sessionId: 'fake:lea', channel: 'fake', peer: 'lea', speaker: { name: 'Léa', role: 'member', autonomy: 'prudent' } });
    assert.deepEqual(o.approvals.map((a) => a.tool), ['schedule_task'], 'la programmation est demandée au propriétaire');
    assert.equal(o.muninn.listJobs().length, 0, 'refusée : aucune tâche programmée');
  } finally { o.cleanup(); }
});

test('un membre programme « lance une commande », le propriétaire l\'accepte : la tâche est à son nom et, à l\'heure, tourne avec SES droits (Breaker du propriétaire : refusée)', async () => {
  const o = makeOdin([
    call('schedule_task', { cron: '0 3 * * *', prompt: 'lance la commande de nettoyage' }), { text: 'programmé' },
    call('shell', { command: 'touch pirate.txt' }), { text: 'fait' },
  ]);
  // Le propriétaire accepte la programmation, et rien d'autre.
  const demandes: string[] = [];
  o.heimdall.setApprover({ approve: async (r) => { demandes.push(r.tool); return r.tool === 'schedule_task'; } });
  o.heimdall.setBreaker({ ...o.heimdall.getBreaker(), schedule: 'always' });
  o.heimdall.setAutonomy('breaker');
  await o.agent.run('programme le nettoyage chaque nuit', { sessionId: 'fake:lea', channel: 'fake', peer: 'lea', speaker: { name: 'Léa', role: 'member', autonomy: 'prudent' } });
  assert.deepEqual(demandes, ['schedule_task'], 'la programmation a été demandée au propriétaire');
  const job = o.muninn.listJobs()[0];
  assert.ok(job, 'tâche programmée après son accord');
  const auteur = JSON.parse(o.muninn.getKv(`tache-auteur:${job.id}`) ?? 'null') as { role?: string; nom?: string } | null;
  assert.equal(auteur?.role, 'member', 'programmée au nom du membre, pas du propriétaire'); assert.equal(auteur?.nom, 'Léa');
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(new FakeChannel());
  // (en Breaker, le travail continu et les rondes appelleraient aussi le faux modèle : coupés pour cet essai)
  for (const k of ['continuous', 'breakerRoutines', 'breakerReport', 'veille', 'morning', 'journal', 'care', 'weekly', 'garden']) (gw as unknown as Record<string, unknown>)[k] = async () => undefined;
  (o.muninn as unknown as { jobs: { patch(id: string, p: object): void } }).jobs.patch(job.id, { next_run: Date.now() - 1000 });
  await gw.tick();
  const dernier = o.provider.calls.at(-1)!.messages.at(-1)!.content; console.log('# appels', o.provider.calls.length, JSON.stringify(dernier).slice(0, 300));
  assert.match(dernier, /Action refusée par Heimdall/, 'la commande n\'a pas tourné avec les droits du propriétaire');
  o.cleanup();
});

test('un script programmé par un membre ne tourne pas ; celui du propriétaire, oui', async () => {
  const o = makeOdin([]);
  const { scriptSave, scriptJob } = await import('../src/tools/scripts.ts');
  await scriptSave.run({ name: 'bonjour', lang: 'node', code: 'console.log("bonjour du script")', description: 'essai' }, { workspace: o.paths.workspace, home: o.paths.home, redactor: o.redactor, muninn: o.muninn, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never);
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(new FakeChannel());
  o.muninn.addJob({ id: 'jm', cron: '0 7 * * *', prompt: scriptJob({ name: 'bonjour', args: '', where: 'local', report: false }), channel: 'fake', peer: 'lea', next_run: Date.now() - 1000 });
  o.muninn.setKv('tache-auteur:jm', JSON.stringify({ role: 'member', nom: 'Léa', autonomie: 'prudent' }));
  o.muninn.addJob({ id: 'jp', cron: '0 7 * * *', prompt: scriptJob({ name: 'bonjour', args: '', where: 'local', report: false }), channel: 'fake', peer: 'boss', next_run: Date.now() - 1000 });
  await gw.tick();
  const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
  const journal = readFileSync(join(o.paths.logs, 'cron.md'), 'utf8');
  assert.match(journal, /Refusé : script programmé par Léa/);
  assert.match(journal, /bonjour du script/, 'le script du propriétaire tourne');
  o.cleanup();
});
