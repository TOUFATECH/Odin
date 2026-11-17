// Orphée temps réel : depuis le 17/11/2026, le service (voix-temps-reel/orphee.py) n'est plus lancé : il reposait sur
// des modèles qui ne sont pas ceux d'Odin (détection de la parole, fin de tour, Whisper). Odin le dit (« pas encore »)
// sans lancer de programme ni ouvrir de port, et la page garde l'écrit. La reprise par segments (du texte, sans modèle)
// reste, pour la future voix d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Orphee, fixerOrphee, SCRIPT_ORPHEE } from '../src/voice/orphee.ts';
import { decouper, estContinue, Fil, resteApres } from '../src/voice/reprise.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

// ------------------------------------------------------------------ Reprise par segments (pur)
test('reprise : découpe en segments, « continue » reprend au premier mot jamais dit, une question s\'empile', () => {
  const segs = decouper('Premier point : on vérifie le disque. Ensuite on regarde la mémoire du serveur.\n- Puis le réseau.\n- Enfin les sauvegardes, qui sont importantes.');
  assert.ok(segs.length >= 3, segs.join(' | '));
  assert.ok(estContinue('continue') && estContinue('Vas-y, continue') && estContinue('la suite') && estContinue('Odin, reprends'));
  assert.ok(!estContinue('continue à surveiller le disque'));
  assert.equal(resteApres('un deux trois quatre cinq six sept huit', 500, 1000), 'quatre cinq six sept huit');
  const f = new Fil(30), now = Date.now();
  const r1 = f.nouvelle('explique la sauvegarde', 'La première étape consiste à brancher le disque de sauvegarde sur le serveur. La deuxième étape copie les dossiers importants vers les disques durs externes chaque nuit. La troisième étape vérifie que la copie se relit bien.', now);
  assert.equal(r1.segments.length, 3, r1.segments.map((x) => x.texte).join(' | '));
  f.dit(r1.segments[0].id);
  f.coupe(r1.segments[1].id, 1000, 2000, now);
  // Une question intermédiaire : sa réponse s'empile au-dessus.
  const r2 = f.nouvelle('quelle heure est-il', 'Il est midi.', now);
  let suite = f.continuer(now)!;
  assert.equal(suite.reponse.id, r2.id, 'la réponse la plus récente d\'abord');
  f.dit(r2.segments[0].id);
  suite = f.continuer(now)!;
  assert.equal(suite.reponse.id, r1.id, 'puis « continue » revient à la réponse coupée');
  assert.ok(!suite.segments[0].texte.startsWith('La deuxième'), `reprend au mot près : ${suite.segments[0].texte}`);
  assert.match(suite.segments[0].texte, /disques durs externes/);
  assert.equal(suite.segments.length, r1.segments.length - 1);
  // Un sujet coupé depuis plus longtemps que la durée gardée est oublié.
  assert.equal(f.continuer(now + 31 * 60_000), undefined);
});

// ------------------------------------------------------------------ Le vrai service Python

test('le service temps réel n\'est plus lancé : « pas encore », aucun programme, aucun port', async () => {
  assert.ok(SCRIPT_ORPHEE.endsWith('orphee.py'));
  const s = new Orphee();
  try {
    assert.equal(await s.demarrer(), false); assert.equal(s.etat, 'absent'); assert.equal(s.pret, false);
    assert.match(s.raison, /pas encore entraîné/); assert.equal(s.port, 0); assert.deepEqual(s.dernieresLignes(), []);
    await assert.rejects(s.appeler('/sante'), /pas encore entraîné/);
  } finally { s.arreter(); }
});

test('le navigateur passe par Odin : l\'état et l\'ouverture d\'une conversation disent « pas encore », sans rien lancer', { timeout: 60_000 }, async () => {
  const t = new T();
  const s = new Orphee();
  fixerOrphee(s);
  try {
    const v = await vraiOdin(t, { compte: true });
    const etat = await v.json('/api/voice/orphee/etat');
    assert.equal(etat.status, 200); assert.equal(etat.body.repli, true);
    const ouv = await v.json('/api/voice/orphee/session', {});
    assert.equal(ouv.body.ok, false); assert.equal(ouv.body.repli, true); assert.match(String(ouv.body.error), /pas encore entraîné/);
    assert.equal(s.port, 0);
  } finally { fixerOrphee(undefined); await t.end(); }
});
