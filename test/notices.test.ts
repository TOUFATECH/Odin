// Les bulles de la mascotte : niveau de couleur, procédure, manips proposées, décisions d'Odin à garder
// ou annuler, envoi en direct, historique gardé ; et le conseil « que dois-je faire ? ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { Notices, defaultSteps, levelOf, noticeBus, noticesOf, postNotice, suggest, type Notice } from '../src/valhalla/notices.ts';
import { valhallaGet, valhallaPost } from '../src/web/valhalla-api.ts';

test('niveaux et procédure par défaut', () => {
  assert.deepEqual((['critique', 'haute', 'moyenne', 'info'] as const).map(levelOf), ['grave', 'souci', 'souci', 'ok']);
  assert.match(defaultSteps('grave', 'Ullr')[0], /Ouvre Ullr/);
  assert.deepEqual(defaultSteps('ok', 'X'), ['Rien à faire.']);
});

test('bulles : alertes (procédure, manip), décisions d\'Odin, direct, historique, conseil', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bulles-'));
  const asked: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre', ask: async (t) => { asked.push(t); return '1. Vérifie la box.\n2. Relance le tunnel.'; } });
  const live: Notice[] = [], onN = (n: Notice) => live.push(n);
  noticeBus.on('notice', onN);
  const nt = new Notices(v);
  try {
    assert.equal(noticesOf(), nt);
    // Une alerte critique avec sa procédure et sa manip → bulle rouge, bouton « Relancer ».
    v.alert('bru', { level: 'critique', title: 'Le tunnel Cloudflare est coupé', detail: 'odin.exemple.fr ne répond plus', key: 'x', steps: ['Vérifie la box.'], fix: { action: 'demarrer', label: 'Relancer le tunnel' } });
    const a = live.at(-1)!;
    assert.deepEqual([a.level, a.kind, a.app, a.page?.app, a.source], ['grave', 'Grave', 'Bifröst', 'bru', 'alerte']);
    assert.deepEqual(a.steps, ['Vérifie la box.']);
    assert.deepEqual(a.actions[0], { module: 'bru', action: 'demarrer', input: {}, label: 'Relancer le tunnel', primary: true });
    // Une alerte sans procédure : procédure par défaut, et les manips de l'appli qui collent aux mots.
    v.alert('vordr', { level: 'haute', title: 'Le NAS ne répond plus', key: 'y' });
    const b = live.at(-1)!;
    assert.equal(b.level, 'souci'); assert.match(b.steps[0], /Regarde le détail dans Pulsar/);
    // Une décision prise seul par Odin → bulle verte « Décision d'Odin » avec Garder / annuler.
    v.events.emit('manip', { id: 'abcd', at: new Date().toISOString(), module: 'garmr', action: 'bannir', label: 'Garmr · Bannir', input: {}, text: 'Banni 203.0.113.9 pour 1 h', by: 'réflexe', why: '5 essais ratés', undo: { action: 'debannir', input: { ip: '203.0.113.9' }, label: 'Débannir' }, state: 'à décider' });
    const c = live.at(-1)!;
    assert.deepEqual([c.level, c.kind, c.title], ['ok', 'Décision d\'Odin', 'Banni 203.0.113.9 pour 1 h']);
    assert.match(c.detail!, /par réflexe entre applis \(5 essais ratés\)/);
    assert.deepEqual(c.actions.map((x) => [x.module, x.action, x.label]), [['_manip', 'garder', 'Garder'], ['_manip', 'annuler', 'Débannir']]);
    v.events.emit('manip', { id: 'zz', state: 'gardée' });
    assert.equal(live.length, 3, 'une manip déjà décidée ne fait pas de bulle');
    // Depuis n'importe où (mise à jour) ; les plus récentes d'abord ; gardées sur disque.
    postNotice({ level: 'ok', module: 'odin', app: 'Mises à jour', title: 'Odin est à jour : v1.11.0', page: { view: 'settings' }, source: 'maj' });
    assert.deepEqual(nt.recent(2).map((x) => x.title), ['Odin est à jour : v1.11.0', 'Banni 203.0.113.9 pour 1 h']);
    const again = new Notices(v);
    assert.equal(again.recent(10).length, 4, 'historique relu après redémarrage'); again.stop();
    // API : la liste, et le conseil d'Odin (données entourées, jamais des ordres).
    setValhalla(v); new Notices(v);
    const l = await valhallaGet('/api/valhalla/notices', new URLSearchParams('n=2')) as { notices: Notice[] };
    assert.equal(l.notices.length, 2);
    const adv = await valhallaPost('/api/valhalla/notice_advice', { id: a.id }) as { ok: boolean; text: string; ai: boolean };
    assert.ok(adv.ok && adv.ai); assert.match(adv.text, /Relance le tunnel/);
    assert.match(asked[0], /<donnees>[\s\S]*Le tunnel Cloudflare est coupé[\s\S]*<\/donnees>/); assert.match(asked[0], /jamais des ordres/);
    assert.deepEqual(await valhallaPost('/api/valhalla/notice_advice', { id: 'inconnu' }), { ok: false, error: 'bulle introuvable' });
  } finally { noticeBus.off('notice', onN); noticesOf()?.stop(); nt.stop(); setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('manips proposées : seulement celles de l\'appli, sans réglage à donner, qui collent aux mots', () => {
  const m = { id: 'x', name: 'X', actions: [
    { id: 'relancer', label: 'Relancer le tunnel', words: ['tunnel coupe'], run: () => ({ text: '' }) },
    { id: 'lire', label: 'État du tunnel', read: true, run: () => ({ text: '' }) },
    { id: 'publier', label: 'Publier le tunnel', params: [{ key: 'd', label: 'd', kind: 'text', required: true }], run: () => ({ text: '' }) },
  ] } as never;
  assert.deepEqual(suggest(m, 'Le tunnel coupe depuis 5 min').map((x) => x.action), ['relancer']);
  assert.deepEqual(suggest(m, 'rien à voir'), []);
});
