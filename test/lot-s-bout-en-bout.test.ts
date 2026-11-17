// Relecture du lot S, constats 1, 5 et 7 : DE BOUT EN BOUT (un Odin jetable, la vraie boucle, la vraie passerelle,
// un faux modèle) — pas une demande à Heimdall écrite à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, makeOdin } from './helpers.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { scriptJob } from '../src/tools/scripts.ts';

test('constat 1 : un membre ne fait pas réécrire le code par une aide (delegate) — même avec « jamais »', async () => {
  const cible = join(RACINE_APPLI, 'test', '__delegate_membre__.txt');
  rmSync(cible, { force: true });
  const o = makeOdin([
    call('delegate', { tasks: [{ goal: 'écris le fichier' }] }),
    call('self_edit', { path: 'test/__delegate_membre__.txt', content: 'pirate' }),
    { text: 'fait' }, { text: 'terminé' },
  ]);
  o.heimdall.setValidationCode(() => 'jamais');
  try {
    await o.agent.run('demande à une aide de modifier ton code', { sessionId: 'web:lea', speaker: { name: 'Léa', role: 'member', autonomy: 'prudent' } });
    assert.equal(existsSync(cible), false, 'le membre n\'a pas fait écrire le code par l\'aide');
  } finally { rmSync(cible, { force: true }); o.cleanup(); }
});

test('constat 1 (S5) : une tâche automatique qui délègue reste « automatique » pour son aide', async () => {
  const o = makeOdin([call('delegate', { tasks: [{ goal: 'écris une note' }] }), call('fs_write', { path: 'note.txt', content: 'x' }), { text: 'fait' }, { text: 'fin' }]);
  o.heimdall.setAutonomy('breaker');
  await o.agent.run('Fais le point', { sessionId: 'auto:veille', trusted: true, unattended: true, automatique: 'Fais le point' });
  assert.equal(existsSync(join(o.paths.workspace, 'note.txt')), false, 'l\'aide d\'une tâche automatique n\'écrit rien seule');
  o.cleanup();
});

class FakeChannel implements Channel {
  readonly name = 'fake'; readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

test('constat 5 : un script programmé par le propriétaire tourne à nouveau en Équilibré, sans juge (comme avant le lot S)', async () => {
  const o = makeOdin([]);
  o.heimdall.setAutonomy('equilibre');
  mkdirSync(join(o.paths.workspace, 'scripts'), { recursive: true });
  const { scriptSave } = await import('../src/tools/scripts.ts');
  await scriptSave.run({ name: 'bonjour', lang: 'node', code: 'console.log("bonjour du script")', description: 'essai' }, { workspace: o.paths.workspace, home: o.paths.home, redactor: o.redactor, muninn: o.muninn, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never);
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(new FakeChannel());
  o.muninn.addJob({ id: 'jb', cron: '0 7 * * *', prompt: scriptJob({ name: 'bonjour', args: '', where: 'local', report: false }), channel: 'fake', peer: 'boss', next_run: Date.now() - 1000 });
  await gw.tick();
  const { readFileSync } = await import('node:fs');
  const journal = readFileSync(join(o.paths.logs, 'cron.md'), 'utf8');
  assert.doesNotMatch(journal, /Refusé|sans surveillance/, journal.slice(-400)); assert.match(journal, /bonjour du script/, journal.slice(-400));
  o.cleanup();
});

test('constat 7 : une aide qui clique sur « Payer » dans la page vue par sa conversation demande ta validation', async () => {
  const { noterPage, graveArgent } = await import('../src/heimdall/paiement.ts');
  noterPage('web:principal', 'Panier — Total 249 € — [5] bouton « Payer maintenant »');
  assert.match(graveArgent('browser_click', { element: 5 }, 'web:principal:sub:abc:1') ?? '', /paiement possible/);
});
