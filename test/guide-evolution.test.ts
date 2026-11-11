// Guide d'Odin : arbre d'évolution (historique daté, rangé par planète), connecteurs actifs seulement une fois
// configurés, Odin qui parle tant qu'on ne l'a pas coupé, visite guidée sur demande seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evolutions, evolutionTree, parseCommit, PLANETS } from '../src/web/evolutions.ts';
import { connectors } from '../src/web/brain-api.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('évolution : version, titre, détails sans les lignes d\'attribution, planètes et nature', () => {
  const e = parseCommit('abc123', '2026-11-11T21:00:00+03:00', 'v1.6.1 : Telegram mis en forme, droits sur Windows',
    '- Messages Telegram en gras et listes\n  sur deux lignes\n- Droits administrateur expliqués\n\nCo-Authored-By: X <x@y>\nClaude-Session: https://exemple');
  assert.equal(e.version, '1.6.1');
  assert.equal(e.title, 'Telegram mis en forme, droits sur Windows');
  assert.equal(e.date, '2026-11-11');
  assert.deepEqual(e.details, ['Messages Telegram en gras et listes sur deux lignes', 'Droits administrateur expliqués']);
  assert.ok(e.planets.includes('canaux') && e.planets.includes('machines'));
  assert.equal(e.kind, 'nouveauté');
  assert.equal(parseCommit('d', '2026-11-03T10:00:00Z', 'Corrige le graphe du cerveau', '').kind, 'correction');
});

test('arbre d\'évolution : soleil, planètes datées, versions dans l\'ordre, tout est daté', () => {
  const t = evolutionTree('9.9.9') as { sun: { version: string; total: number; since: string }; planets: Array<{ id: string; count: number; last: string; items: string[] }>; versions: Array<{ version: string; date: string }>; evolutions: Array<{ id: string; date: string }> };
  assert.equal(t.sun.version, '9.9.9');
  assert.ok(t.evolutions.length > 10, 'historique trouvé (git ou evolutions.json)');
  assert.equal(t.sun.total, t.evolutions.length);
  for (const e of t.evolutions) assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const p of t.planets) { assert.ok(PLANETS.some((x) => x.id === p.id)); assert.equal(p.count, p.items.length); assert.match(p.last, /^\d{4}-/); }
  assert.ok(t.versions.length >= 3);
  // Du plus récent au plus ancien
  const d = t.versions.map((v) => v.date); assert.deepEqual(d, [...d].sort().reverse());
  // La liste livrée (installations sans git) existe et a la même forme
  const bundled = JSON.parse(readFileSync(new URL('../src/web/evolutions.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(bundled) && bundled.length > 10 && bundled[0].date && bundled[0].planets);
  assert.ok(evolutions().length >= bundled.length - 5);
});

test('connecteurs : actifs seulement une fois configurés (et activés)', () => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const by = (list: ReturnType<typeof connectors>) => Object.fromEntries(list.map((c) => [c.id, c]));
  // Rien de configuré : aucun connecteur à configurer n'est dit actif
  let c = by(connectors({ cfg }, new Map(), {}));
  for (const id of ['Telegram', 'WhatsApp', 'Signal', 'Mail', 'Agenda', 'GitHub', 'Notion']) { assert.equal(c[id].on, false, id); assert.equal(c[id].state, 'à configurer', id); assert.ok(c[id].how, id); }
  for (const id of ['YouTube', 'Web', 'Fichiers']) { assert.equal(c[id].on, false, id); assert.equal(c[id].state, 'intégré', id); }
  // Telegram configuré (jeton + propriétaire) et activé : actif ; configuré mais coupé : « coupé »
  cfg.channels.telegram = { enabled: true, tokenEnv: 'TELEGRAM_BOT_TOKEN', owners: ['12345'] };
  c = by(connectors({ cfg }, new Map([['Telegram', 3]]), { TELEGRAM_BOT_TOKEN: '123456:abc' }));
  assert.equal(c.Telegram.state, 'actif'); assert.equal(c.Telegram.on, true); assert.equal(c.Telegram.notes, 3);
  cfg.channels.telegram.enabled = false;
  assert.equal(by(connectors({ cfg }, new Map(), { TELEGRAM_BOT_TOKEN: '123456:abc' })).Telegram.state, 'coupé');
  // Jeton sans propriétaire : pas encore configuré
  cfg.channels.telegram = { enabled: true, tokenEnv: 'TELEGRAM_BOT_TOKEN', owners: [] };
  assert.equal(by(connectors({ cfg }, new Map(), { TELEGRAM_BOT_TOKEN: '123456:abc' })).Telegram.on, false);
  // Mail : serveur, identifiant et mot de passe
  cfg.mail = { ...cfg.mail, imapHost: 'imap.exemple.fr', user: 'moi' };
  assert.equal(by(connectors({ cfg }, new Map(), {})).Mail.on, false);
  assert.equal(by(connectors({ cfg }, new Map(), { MAIL_PASSWORD: 'x' })).Mail.on, true);
  assert.equal(by(connectors({ cfg }, new Map(), { GITHUB_TOKEN: 'x' })).GitHub.on, true);
});

test('interface : Odin parle par défaut, visite guidée sur demande, bulle reliée à la discussion', () => {
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../src/web/guide.js', import.meta.url), 'utf8');
  assert.ok(!/OdinTour\?\.offer\(\)/.test(ui), 'plus de visite proposée toute seule');
  assert.match(ui, /window\.OdinChat = \{/);
  assert.match(ui, /odin:reply/);
  assert.match(ui, /section: 'speak'/);
  assert.match(ui, /\/evolution\.js/);
  assert.match(guide, /OdinChat/);
  assert.match(guide, /Comment l\\?'utiliser/);
  assert.match(guide, /Comment la configurer/);
  assert.match(guide, /Arbre d\\?'évolution/);
});
