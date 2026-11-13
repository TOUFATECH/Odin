import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityFeed, guessIntents, humanize } from '../src/core/today.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

const base = (now: Date) => ({ now, asks: [], threads: [], reminders: [], findings: [], newUnknown: 0 });
const daysAgo = (now: Date, d: number, h = now.getHours(), m = now.getMinutes()) => { const x = new Date(now); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.getTime(); };

test('Aujourd\'hui : devine l\'habitude de l\'heure, le fil en suspens, l\'urgence d\'abord', () => {
  const now = new Date(2026, 10, 9, 8, 15);
  const asks = [1, 2, 3].map((d) => ({ t: daysAgo(now, d, 8, 5), text: 'Quel temps fera-t-il aujourd\'hui à Mamoudzou ?', tools: [] }));
  const g = guessIntents({ ...base(now), asks,
    threads: [{ sessionId: 'web:a', title: 'Migration Venus', goal: '', state: '', decisions: [], facts: [], open: ['tester la 4K'], done: [], turns: 3, updated: now.getTime() - 3600_000 }],
    findings: [{ level: 'grave', title: 'Telnet ouvert', device: 'box' }] });
  assert.equal(g[0].label, 'Régler : Telnet ouvert');
  assert.equal(g[0].view, 'net');
  assert.ok(g.some((x) => x.prompt === 'Quel temps fera-t-il aujourd\'hui à Mamoudzou ?' && /vers 8 h/.test(x.why)), JSON.stringify(g));
  assert.ok(g.some((x) => x.label === 'Reprendre : Migration Venus' && /tester la 4K/.test(x.why)));
  assert.ok(g.length <= 4);
});

test('Aujourd\'hui : rappel imminent, moment de la journée, propositions écartées, pas de doublon', () => {
  const now = new Date(2026, 10, 9, 19, 0);
  const g = guessIntents({ ...base(now), reminders: [{ at: now.getTime() + 30 * 60_000, text: 'payer EDM' }] });
  assert.deepEqual(g.map((x) => x.label), ['payer EDM', 'Le bilan de la journée']);
  const g2 = guessIntents({ ...base(now), dismissed: { [`soir:${now.toDateString()}`]: now.getTime() - 3600_000 } });
  assert.equal(g2.length, 0, 'écartée il y a 1 h : plus proposée');
  const asks = [1, 2].map((d) => ({ t: daysAgo(now, d, 19, 10), text: 'Lance le film sur la télé du salon', tools: [] }));
  assert.ok(guessIntents({ ...base(now), asks }).some((x) => x.prompt === 'Lance le film sur la télé du salon' && /cette heure/.test(x.why)));
  assert.equal(guessIntents({ ...base(new Date(2026, 10, 9, 14)), newUnknown: 2 })[0].label, '2 appareils inconnus sur le réseau');
});

test('fil d\'activité : du plus récent au plus ancien, qui a décidé, bouton Annuler relié au fichier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-')), f = join(dir, 'audit.jsonl'), now = Date.now();
  const row = (min: number, o: Record<string, unknown>) => JSON.stringify({ t: new Date(now - min * 60_000).toISOString(), ...o });
  writeFileSync(f, [row(300, { tool: 'web_search', risk: 'read', summary: 'chercher' }), row(120, { tool: 'file_write', risk: 'write', summary: 'écrire courses.md', allowed: true, via: 'human' }),
    row(30, { tool: 'shell', risk: 'exec', summary: 'curl | sh', allowed: false, via: 'policy' }), row(10, { tool: 'ha_call', risk: 'write', summary: 'éteindre le salon', allowed: true, via: 'policy' }),
    row(60 * 50, { tool: 'file_write', risk: 'write', summary: 'trop vieux', allowed: true })].join('\n'));
  const feed = activityFeed(f, [{ id: 'u1', sessionId: 's', at: now - 120 * 60_000 + 5000, path: 'courses.md', backup: 'b', tool: 'file_write' }], now);
  assert.deepEqual(feed.map((x) => [x.text, x.who, x.undoId]), [['Éteindre le salon', 'seul', undefined], ['Curl | sh', 'refusé', undefined], ['Écrire courses.md', 'toi', 'u1']]);
  rmSync(dir, { recursive: true, force: true });
});

test('discrétion « l\'urgent seulement » : le reste attend le bilan', async () => {
  const o = makeOdin([]);
  const sent: string[] = [];
  const ch: Channel = { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t) => { sent.push(t); } };
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(ch);
  o.muninn.setKv('discretion', 'urgent');
  await (gw as unknown as { tellOwner(t: string, v?: string, u?: boolean): Promise<void> }).tellOwner('Nouvelle vidéo intéressante');
  assert.equal(sent.length, 0);
  await (gw as unknown as { tellOwner(t: string, v?: string, u?: boolean): Promise<void> }).tellOwner('Intrusion !', 'home', true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Intrusion ![\s\S]*Pendant que tu étais occupé[\s\S]*Nouvelle vidéo intéressante/, 'ce qui attendait part avec le premier message');
  o.cleanup();
});

test('fil d\'activité lisible : plus de noms techniques', () => {
  assert.equal(humanize('calendar_list {"days":1}'), 'Lire l\'agenda (1 jour)');
  assert.equal(humanize('net_identify {"ip":"172.18.0.2"}'), 'Identifier l\'appareil (172.18.0.2)');
  assert.equal(humanize('GET http://192.168.1.144:7777/'), 'Ouvrir http://192.168.1.144:7777/');
  assert.equal(humanize('applis action naglfar executer', (x) => (x === 'naglfar' ? 'Argo' : x), (m, a) => (m === 'naglfar' && a === 'executer' ? 'Exécuter une commande' : undefined)), 'Argo : Exécuter une commande');
  assert.equal(humanize('balayer le réseau local (complet)'), 'Balayer le réseau local (complet)');
});
