// Mathésis — le branchement sur Odin : inscription dans la liste des applis, signal « Odin répond », boîte aux manques
// (recherche vérifiée sans réponse sûre), mémoire et mode privé ; rien ne bloque ni ne change Odin quand c'est coupé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { odinCommenceARepondre, odinRepond, oublierReponses } from '../src/valhalla/mathesis/occupe.ts';
import { manquesEnAttente, poserEtatMathesis, signalerManque, signalerVerdicts, viderManques } from '../src/valhalla/mathesis/signaux.ts';
import { optionsOdin } from '../src/valhalla/mathesis/branchement.ts';
import { monter } from './mathesis-outils-essai.ts';
import { Mnemosyne } from '../src/muninn/store.ts';

test('le signal « Odin répond » : posé, levé, et jamais coincé plus de 10 minutes', () => {
  oublierReponses();
  let t = 1_000_000;
  const fin = odinCommenceARepondre(() => t);
  assert.equal(odinRepond(() => t), true);
  fin(); fin();
  assert.equal(odinRepond(() => t), false);
  odinCommenceARepondre(() => t); // une fin oubliée
  t += 11 * 60_000;
  assert.equal(odinRepond(() => t), false);
});

test('boîte aux manques : sans réponse sûre et une seule source deviennent des manques ; rien en privé ; jamais « confié »', () => {
  viderManques();
  poserEtatMathesis(true); // Mathésis allumée (coupée, la boîte ne garde rien : voir mathesis-corrections-2)
  signalerVerdicts('Quelle est la hauteur du Piton des Neiges ?', [{ claim: 'Il mesure 3070 m', verdict: 'probable' }]);
  const l = viderManques();
  assert.deepEqual(l.map((x) => x.origine).sort(), ['a_verifier', 'question_sans_reponse']);
  signalerVerdicts('Question confirmée', [{ claim: 'x', verdict: 'confirmé' }]);
  assert.equal(manquesEnAttente(), 0);
  signalerVerdicts('Question privée', [], { prive: true });
  signalerManque({ sujet: 'se faire passer pour le propriétaire', origine: 'confie' });
  assert.equal(manquesEnAttente(), 0);
  for (let i = 0; i < 500; i++) signalerManque({ sujet: `s${i}`, origine: 'sujet_recurrent' });
  assert.equal(manquesEnAttente(), 200, 'bornée');
  viderManques();
});

test('le tour vide la boîte dans la liste de curiosité ; Odin qui répond arrête le tour', async () => {
  viderManques();
  const { m } = monter(); // un moteur allumé : la boîte accepte les manques
  signalerManque({ sujet: 'éruption du Piton de la Fournaise', origine: 'question_sans_reponse' });
  await m.tour({ manques: 0, revisites: 0 });
  assert.ok(m.curiosite.liste().some((x) => /Fournaise/.test(x.sujet)));
  oublierReponses();
  const fin = odinCommenceARepondre();
  const b = await monter({ occupe: () => odinRepond() }).m.tour();
  assert.equal(b.arret, 'occupe');
  fin();
});

test('branchement sur Odin : mémoire, oubli, mode privé suivi, aucun réseau sous les essais', async () => {
  const muninn = new Mnemosyne(':memory:');
  const cfg = { voice: { privacy: { privateMode: false } }, learning: { observe: true }, nous: { actif: true } };
  const o = optionsOdin({ cfg, muninn });
  assert.ok(o.apprentissage);
  assert.equal(o.prive?.(), false);
  cfg.voice.privacy.privateMode = true;
  assert.equal(o.prive?.(), true, 'le mode privé est lu à chaque fois');
  assert.deepEqual(await o.chercher!('x'), []);
  await assert.rejects(o.transport!('https://exemple.fr/', { method: 'GET', headers: {}, redirect: 'manual' }), /aucun réseau/);
  const r = muninn.remember('un souvenir à oublier', 'agent');
  assert.equal(o.oublierSouvenir?.(r.id), true);
  assert.equal(optionsOdin({ cfg }).apprentissage, undefined, 'sans mémoire, rien n\'est rangé (et la page le dit)');
});

test('Mathésis est inscrite parmi les applis d\'Odin', async () => {
  const { allModules } = await import('../src/valhalla/odin.ts');
  const { loadConfig } = await import('../src/config.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'mathesis-inscr-'));
  try {
    const paths = { home, db: join(home, 'db'), workspace: join(home, 'ws') } as never;
    const mods = allModules({ paths, cfg: loadConfig(paths) } as never);
    const m = mods.find((x) => x.id === 'mathesis');
    assert.ok(m);
    assert.equal(m!.name, 'Mathésis');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
