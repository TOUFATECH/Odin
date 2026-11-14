import assert from 'node:assert/strict';
import test from 'node:test';
import { CLICK_CATALOG, DEFAULT_CLICKS2, cleanClicks2 } from '../src/valhalla/clics.ts';

test('clics sur Odin : catalogue, nombres proposés uniques, un nombre = une action', () => {
  assert.equal(new Set(CLICK_CATALOG.map((a) => a.id)).size, CLICK_CATALOG.length, 'chaque action a son identifiant');
  assert.equal(DEFAULT_CLICKS2['4'], 'alchimie', '4 clics : Alchimie (maquette du 14/11/2026)');
  assert.ok(!Object.values(DEFAULT_CLICKS2).includes('serveur_redemarrer'), 'le redémarrage du serveur n\'a plus de nombre au départ');
  assert.ok(!DEFAULT_CLICKS2['7'] && !DEFAULT_CLICKS2['8'], 'les actions retirées (7, 8) n\'ont pas de nombre au départ');
  assert.ok(Object.keys(DEFAULT_CLICKS2).every((k) => Number(k) >= 4 && Number(k) <= 100));
  assert.equal(new Set(Object.values(DEFAULT_CLICKS2)).size, Object.keys(DEFAULT_CLICKS2).length, 'une action n\'a qu\'un nombre');
  for (const a of CLICK_CATALOG) assert.ok(a.run.act || a.run.say || a.run.fn, `${a.id} sait quoi faire`);
  assert.ok(CLICK_CATALOG.filter((a) => a.grave).every((a) => a.ask), 'une action grave pose toujours sa question');
  // nettoyage : hors bornes, inconnu, ou même action deux fois → écarté
  assert.deepEqual(cleanClicks2({ 3: 'rire', 4: 'rire', 5: 'rire', 101: 'theme', 6: 'piratage', 9: 'theme' }), { 4: 'rire', 9: 'theme' });
  assert.deepEqual(cleanClicks2(null), DEFAULT_CLICKS2, 'rien de réglé : les nombres proposés');
});
