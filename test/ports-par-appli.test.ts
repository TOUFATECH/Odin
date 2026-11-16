// Plan des ports : Odin sur 8888, et chaque appli sur SON port, facile à retenir (8FNN : F = sa famille, NN = son
// rang dans la famille). Le port par défaut écoute là où écoute l'interface ; il se change dans la page de l'appli ou
// dans Réglages → Ports, et un port retiré n'est pas repris au redémarrage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DirectPorts, directFile } from '../src/valhalla/directports.ts';
import { DEFAULT_DIRECT, FAMILY_BASE, ODIN_PORTS, WEB, conflicts, directRefusal, familyRange, setDirectPorts, suggestDirect } from '../src/valhalla/ports.ts';
import { makeOdin } from './helpers.ts';

test('Odin sur 8888, son canal HTTP sur 8889', () => {
  assert.equal(WEB, 8888); assert.equal(DEFAULT_CONFIG.web.port, 8888); assert.equal(DEFAULT_CONFIG.channels.http?.port, 8889);
  assert.ok(ODIN_PORTS.some((p) => p.app === 'odin' && p.port === 8889));
  assert.equal(DEFAULT_CONFIG.web.portsParAppli, true, 'chaque appli a son port par défaut');
});

test('chaque appli a son port : unique, dans la centaine de sa famille, sans conflit avec le plan', () => {
  assert.deepEqual(conflicts(), []);
  const o = makeOdin([{ text: 'ok' }]);
  try {
    for (const m of allModules(o)) {
      const p = DEFAULT_DIRECT[m.id]; if (!p) continue;
      assert.equal(Math.floor(p / 100) * 100, FAMILY_BASE[m.family], `${m.name} (${p}) est dans la famille ${m.family}`);
    }
    const sans = allModules(o).filter((m) => FAMILY_BASE[m.family] && !DEFAULT_DIRECT[m.id]).map((m) => m.name);
    assert.deepEqual(sans, [], 'toute appli d\'une famille a son port');
  } finally { o.cleanup(); }
  assert.equal(DEFAULT_DIRECT.vidarr, 8207, 'Sphinx (DNS) : page sur 8207, DNS toujours sur 53');
  assert.ok(ODIN_PORTS.some((p) => p.app === 'vidarr' && p.port === 53) && ODIN_PORTS.some((p) => p.app === 'vidarr' && p.port === 67), 'les ports imposés restent');
  assert.deepEqual(familyRange('garmr'), [8101, 8199]); assert.deepEqual(familyRange('nouvelle', 'Maison'), [8501, 8599]);
});

test('refus et propositions : le port d\'une autre appli est gardé, sauf si elle l\'a laissé', () => {
  setDirectPorts({});
  assert.match(directRefusal(8103, 'eir', { name: (id) => (id === 'garmr' ? 'Cerbère' : id) }) ?? '', /le port 8103 est celui de Cerbère \(plan des ports\)/);
  assert.equal(directRefusal(8103, 'garmr'), undefined, 'son propre port');
  assert.equal(directRefusal(8103, 'eir', { libres: new Set(['garmr']) }), undefined, 'Cerbère a retiré son port : il est libre');
  assert.equal(suggestDirect([], WEB, 'garmr'), 8103, 'sans numéro : son port par défaut');
  assert.equal(suggestDirect([8103], WEB, 'garmr'), 8113, 'pris : le premier libre de sa famille');
  assert.equal(suggestDirect([], WEB, 'nouvelle', 'Données'), 8423, 'une appli sans port du plan : le premier libre de sa famille');
});

test('le gardien : port par défaut ouvert d\'office, rien sur le disque ; changé ou retiré, c\'est gardé', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-ppa-'));
  const g = () => new DirectPorts({ home, web: 8888, host: '127.0.0.1', access: 'local', defauts: () => ['eir', 'garmr'], attach: (s) => s.destroy() });
  let d = g(); await d.start();
  try {
    assert.equal(d.status('eir')?.port, 8308); assert.equal(d.status('eir')?.auto, true);
    assert.equal(d.status('garmr')?.port, 8103);
    assert.throws(() => readFileSync(directFile(home), 'utf8'), 'rien n\'est écrit tant que tu n\'y touches pas');
    // Changer le port de Hygie : gardé ; son ancien port redevient libre pour une autre appli.
    const libre = 8399; await d.set('eir', libre);
    assert.equal(d.status('eir')?.port, libre); assert.equal(d.status('eir')?.auto, undefined);
    assert.ok(d.libres().has('eir'));
    // Retirer celui de Cerbère : gardé, il ne revient pas au redémarrage.
    await d.remove('garmr');
    const f = JSON.parse(readFileSync(directFile(home), 'utf8')) as { applis: Record<string, { port: number }>; retires: string[] };
    assert.deepEqual(Object.keys(f.applis), ['eir']); assert.deepEqual(f.retires, ['garmr']);
    d.stop(); d = g(); await d.start();
    assert.equal(d.status('eir')?.port, libre); assert.equal(d.status('garmr'), undefined, 'retiré : pas repris');
    // Le redonner (sans numéro) : il retrouve son port par défaut.
    assert.equal(await d.suggest('garmr'), 8103);
    await d.set('garmr', 8103);
    assert.equal((JSON.parse(readFileSync(directFile(home), 'utf8')) as { retires?: string[] }).retires, undefined);
  } finally { d.stop(); rmSync(home, { recursive: true, force: true }); }
});
