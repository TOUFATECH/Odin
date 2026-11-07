import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { budgetReport, extractPrice, checkPrices, modeFromText, getMode, upsertSub, upcomingCharges, demarche, noteSave, noteFind, undoApply, undoRecent } from '../src/tools/everyday.ts';
import { resolveShortcut } from '../src/learn/shortcuts.ts';
import { diagnose } from '../src/guard/selfcheck.ts';
import { offlineAnswer, QUEUE_KEY } from '../src/core/offline.ts';
import { call, makeOdin } from './helpers.ts';

const kvOf = () => { const m = new Map<string, string>(); return { getKv: (k: string) => m.get(k), setKv: (k: string, v: string) => { m.set(k, v); } }; };
const web = (sent: string[]): Channel => ({ name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t) => { sent.push(t); } });

test('prix : lus sur la page (données structurées ou « 399,99 € »), baisse signalée', async () => {
  assert.equal(extractPrice('<script type="application/ld+json">{"offers":{"price":"449.90"}}</script>'), 449.9);
  assert.equal(extractPrice('<meta itemprop="price" content="1299">'), 1299);
  assert.equal(extractPrice('<div class="p">Prix : 1 299,99 €</div>'), 1299.99);
  assert.equal(extractPrice('<p>rien</p>'), undefined);
  const kv = kvOf();
  kv.setKv('price-watch', JSON.stringify([{ id: 'p1', url: 'https://x.fr/rtx', label: 'RTX', below: 400, last: 450 }]));
  const msgs = await checkPrices(kv, Date.now(), (async () => new Response('<span>389,00 €</span>')) as typeof fetch);
  assert.deepEqual(msgs, ['💶 RTX est à 389,00 € (sous ton seuil de 400,00 €) : https://x.fr/rtx']);
});

test('budget : abonnements, hausse repérée, prélèvement à venir', () => {
  const kv = kvOf();
  upsertSub(kv, { name: 'Netflix', amount: 13.49, period: 'mois', day: 9 });
  const r = upsertSub(kv, { name: 'netflix', amount: 14.99 });
  assert.equal(Math.round(r.hike! * 100), 150);
  upsertSub(kv, { name: 'Assurance auto', amount: 600, period: 'an' });
  const rep = budgetReport(kv);
  assert.match(rep, /Abonnements : 64,99 € par mois/);
  assert.match(rep, /Hausses repérées :\n- Netflix : 13,49 € → 14,99 €/);
  assert.equal(upcomingCharges(kv, new Date(2026, 10, 7).getTime(), 2)[0].name, 'Netflix');
});

test('mode du moment compris tout seul ; « comme d\'hab » et « refais pareil » retrouvés', () => {
  assert.equal(modeFromText('Je conduis, fais court')!.mode, 'conduite');
  assert.equal(modeFromText('bonne nuit Odin')!.mode, 'sommeil');
  assert.equal(modeFromText('je suis en réunion')!.mode, 'reunion');
  assert.equal(modeFromText('je suis de retour')!.mode, 'disponible');
  assert.equal(modeFromText('quel temps fait-il ?'), undefined);
  const now = Date.now();
  const journal = [{ at: now - 86_400_000, goal: 'Redémarre Venus sur le NAS', ok: true, tools: ['machine_exec'], result: '' }, { at: now - 3600_000, goal: 'Bloque la tablette des enfants', ok: true, tools: ['net_block'], result: '' }];
  assert.match(resolveShortcut('refais pareil', journal, [], now)!, /Bloque la tablette des enfants/);
  assert.match(resolveShortcut('la même chose qu\'hier', journal, [], now)!, /Redémarre Venus/);
  assert.equal(resolveShortcut('comment ça va ?', journal, [], now), undefined);
});

test('auto-surveillance : disque plein, erreurs, budget', () => {
  const d = diagnose({ diskFreePct: 3, diskFreeGb: 0.6, dbMb: 50, errorsLastHour: 7, failedMissions: 0, monthCost: 9, budget: 10 });
  assert.deepEqual(d.map((x) => x.key), ['disk', 'errors', 'budget-80']);
  assert.equal(diagnose({ diskFreePct: 40, diskFreeGb: 50, dbMb: 50, errorsLastHour: 0, failedMissions: 0, monthCost: 0, budget: 0 }).length, 0);
});

test('fiches, démarches et annulation des fichiers modifiés', async () => {
  const o = makeOdin([]);
  const ctx = { muninn: o.muninn, home: o.paths.home, workspace: o.paths.workspace, isTainted: () => false, sessionId: 's' } as never;
  assert.match(await noteSave.run({ title: 'Installer le NAS', content: 'DSM 7.2, IP 192.168.1.20' }, ctx) as string, /notes\/installer-le-nas\.md$/);
  assert.match(await noteFind.run({ query: 'nas' }, ctx) as string, /DSM 7\.2/);
  assert.match(await demarche.run({ type: 'carte grise' }, ctx) as string, /ants\.gouv\.fr/);
  // Une modification de fichier par Odin, puis annulée
  const f = join(o.paths.workspace, 'a.txt'); writeFileSync(f, 'avant');
  const { rememberBefore } = await import('../src/undo.ts');
  rememberBefore(o.paths.home, 's', f, 'fs_write'); writeFileSync(f, 'après');
  const list = await undoRecent.run({ since: 'aujourd\'hui' }, ctx) as string;
  const id = list.split(' · ')[0];
  await undoApply.run({ ids: id }, ctx);
  assert.equal(readFileSync(f, 'utf8'), 'avant');
  o.cleanup();
});

test('sans modèle : réponse tirée de la mémoire, rappel créé, question gardée puis vraiment traitée', async () => {
  const o = makeOdin([]);
  o.muninn.remember('Le NAS Synology est à l\'adresse 192.168.1.20', 'owner', 'fact');
  const a = offlineAnswer({ muninn: o.muninn }, 'quelle est l\'adresse du NAS ?', { channel: 'web', peer: 'principal' });
  assert.equal(a.handled, false); assert.match(a.text, /192\.168\.1\.20/); assert.match(a.text, /Je garde ta question/);
  const b = offlineAnswer({ muninn: o.muninn }, 'rappelle-moi de payer EDM demain 9h', { channel: 'web', peer: 'principal' });
  assert.equal(b.handled, true); assert.match(b.text, /je te rappelle « payer EDM »/);
  assert.equal(o.muninn.listJobs().filter((j) => j.cron === '@reminder').length, 1);
  // L'agent sans modèle passe par le cerveau de secours et garde la question
  o.agent.deps.offlineOnly = true;
  const r = await o.agent.run('où est le NAS ?', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
  assert.equal(r.offline, true); assert.match(r.text, /192\.168\.1\.20/);
  assert.equal(JSON.parse(o.muninn.getKv(QUEUE_KEY)!).length, 1);
  o.cleanup();
});

test('question gardée : traitée dès que le modèle revient', async () => {
  const o = makeOdin([{ text: 'Le NAS est en 192.168.1.20, il répond.' }]);
  o.muninn.setKv(QUEUE_KEY, JSON.stringify([{ text: 'le NAS répond ?', sessionId: 'web:principal', channel: 'web', peer: 'principal', at: Date.now() - 600_000, tries: 0 }]));
  const sent: string[] = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(web(sent));
  assert.equal(await gw.retryOffline(), true);
  assert.match(sent[0], /^🔌 Le modèle est revenu\. Je reviens sur ta question de .* \(« le NAS répond \? »\) :\n\nLe NAS est en 192\.168\.1\.20/);
  assert.equal(JSON.parse(o.muninn.getKv(QUEUE_KEY)!).length, 0);
  await gw.stop(); o.cleanup();
});

test('passerelle : « bonne nuit » coupe les notifications non urgentes, « je suis de retour » les livre', async () => {
  const o = makeOdin([{ text: 'Bonne nuit !' }, { text: 'Re !' }]);
  const sent: string[] = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(web(sent));
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'bonne nuit' });
  assert.equal(getMode(o.muninn).mode, 'sommeil');
  assert.equal(gw.quietNow(), 'tu dors');
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'je suis de retour' });
  assert.equal(getMode(o.muninn).mode, 'disponible');
  await gw.stop(); o.cleanup();
});
