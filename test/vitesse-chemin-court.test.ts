// Lot B « répondre vite » : le chemin court (réflexe / ce qu'Odin sait d'avance) répond SANS réseau et sous la
// cible, en marquant le temps ; et le niveau de confiance d'un souvenir est LU (déjà calculé), jamais recalculé
// au moment de répondre — la réponse dit d'où elle vient et de quand.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { ETAPE } from '../src/core/jalons.ts';
import { fraicheurSouvenir, infoReponse, libelleConfiance } from '../src/web/temps-reponse.ts';
import { makeOdin } from './helpers.ts';

test('le niveau de confiance est LU tel quel (jamais recalculé) ; la réponse dit d\'où ça vient et de quand', () => {
  const at = Date.now() - 3 * 86_400_000;
  const f = fraicheurSouvenir({ source: 'ta consigne', at, niveau: 'confirmé' });
  assert.match(f, /d'après ta consigne/);
  assert.match(f, /il y a 3 jours/);
  assert.match(f, /confirmé/);
  // LU, pas recalculé : une étiquette inconnue n'est pas « devinée » confirmée, elle est simplement tue.
  assert.equal(libelleConfiance('nawak'), '');
  assert.equal(libelleConfiance('a-verifier'), 'à vérifier');
  assert.equal(libelleConfiance('owner'), 'donné par toi');
  assert.equal(libelleConfiance('conteste'), 'contesté');
  // infoReponse réunit le partage du temps et la fraîcheur/source du souvenir.
  const info = infoReponse({ decoupage: { [ETAPE.rappel]: 8, [ETAPE.cerveau]: 20 }, souvenir: { source: 'toi', at, niveau: 'donné par toi' } });
  assert.match(info, /mémoire 8 ms/);
  assert.match(info, /Cerveau 20 ms/);
  assert.match(info, /d'après toi/);
  assert.match(info, /donné par toi/);
});

test('chemin court (ce qu\'Odin sait d\'avance) : répond SANS modèle et marque le temps', async () => {
  const odin = makeOdin([{ text: 'ne devrait jamais être appelé' }]);
  try {
    const t = performance.now();
    const r = await odin.agent.run('quelle heure est-il', { sessionId: 'web:test', channel: 'web', peer: 'principal', trusted: true });
    const ms = performance.now() - t;
    assert.equal(odin.provider.calls.length, 0, 'aucun appel au modèle (aucun réseau) sur le chemin court');
    assert.equal(r.ai?.needed, false, 'réponse donnée sans IA');
    assert.match(r.text, /Il est/);
    assert.ok(r.timing && typeof r.timing[ETAPE.direct] === 'number', 'le temps du chemin court est mesuré (jalon « direct »)');
    // Borné large pour un test (le disque jetable pèse) : l'essentiel vérifié est « aucun réseau ».
    assert.ok(ms < 2000, `le chemin court reste rapide (${Math.round(ms)} ms)`);
  } finally { odin.cleanup(); }
});
