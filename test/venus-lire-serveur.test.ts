// La ligne du bouton « Lire » de Vénus (« [▶ Vénus : identifiant] ») n'est qu'un repère pour la discussion de
// l'application. Deux sorties du serveur web rendent une réponse HORS de la page : le raccourci du téléphone
// (/api/ask, en texte simple) et la notification poussée quand l'application est fermée. Aucune ne doit la montrer.
// Aucun service réel, dossiers temporaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Gateway } from '../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { ligneLireVenus } from '../src/valhalla/modules/venus.ts';
import { makeOdin } from './helpers.ts';

const TEXTE = '« Serie Lumen » S02E05 est dans ta bibliothèque de Vénus : ouvre Vénus et clique « Lire » sur S02E05.';
const LIGNE = ligneLireVenus('serie:serie-lumen:s2e5');

test('raccourci du téléphone : /api/ask rend le texte de la réponse sans la ligne du bouton « Lire »', async () => {
  assert.ok(LIGNE.includes('Vénus'), 'la ligne existe pour un identifiant en règle');
  const o = makeOdin([{ text: `${TEXTE}\n\n${LIGNE} [humeur:joie]` }]);
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined as never }, { port, host: '127.0.0.1', token }));
  await gw.start();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ask`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'lance Serie Lumen S02E05' }) });
    assert.equal(r.status, 200);
    const recu = await r.text();
    assert.ok(!recu.includes('▶'), `la ligne technique ne sort pas : ${recu}`);
    assert.ok(!recu.includes('serie:serie-lumen'), `l'identifiant ne sort pas : ${recu}`);
    assert.equal(recu, TEXTE);
  } finally { await gw.stop(); o.cleanup(); }
});

test('serveur web : chaque sortie en texte qui retire l\'humeur retire aussi la ligne du bouton « Lire » (raccourci, notification poussée)', () => {
  const src = readFileSync(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  const sorties = src.split(/\r?\n/).filter((l) => l.includes('replace(/\\[humeur:'));
  assert.ok(sorties.length >= 2, `le raccourci et la notification poussée sont là (${sorties.length} trouvées)`);
  for (const l of sorties) assert.ok(l.includes('sansLigneLireVenus('), `sortie sans le retrait de la ligne : ${l.trim().slice(0, 140)}`);
  assert.ok(sorties.some((l) => l.includes('pushAll(')), 'la notification poussée en fait partie');
});
