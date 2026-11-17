// Prónoia — lot 4 : la suite probable d'une scène ou d'un son, à partir de la ligne de temps (étiquettes datées de
// Théia ou de Syrinx, reçues comme des données). Pour mieux comprendre, jamais pour inventer ; l'écart va à Noûs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluxPrevoyeur } from '../src/valhalla/pronoia/flux.ts';

function chanson(f: FluxPrevoyeur, tours = 4): number {
  let t = 0;
  f.observer({ t, etiquette: 'intro', confiance: 0.9 }); t += 10;
  for (let k = 0; k < tours; k++) {
    f.observer({ t, etiquette: 'couplet', confiance: 0.8 }); t += 20;
    f.observer({ t, etiquette: 'refrain', confiance: 0.85 }); t += 15;
  }
  return t;
}

test('après un couplet, le refrain est attendu au bon moment ; la réalisation et l\'écart vont à Noûs', () => {
  const notes: string[] = [];
  const f = new FluxPrevoyeur({ source: 'syrinx', nourrir: (n) => notes.push(`${n.source}|${n.texte}`) });
  const t = chanson(f);
  f.observer({ t, etiquette: 'couplet', confiance: 0.8 });
  const l = f.suiteProbable(60);
  assert.equal(l[0].etiquette, 'refrain');
  assert.ok(l[0].confiance > 0.7, String(l[0].confiance));
  assert.ok(Math.abs(l[0].t - (t + 20)) < 0.01);
  f.observer({ t: t + 21, etiquette: 'refrain', confiance: 0.9 });
  assert.equal(f.jugees.realisees, 1);
  assert.match(notes[0], /^pronoia:flux:syrinx\|Flux syrinx — prévu : « refrain » vers \d+\.\d s \(confiance \d+ %/);
  assert.match(notes[0], /écart \+1\.0 s/);
});

test('une suite inattendue est jugée ratée et dite à Noûs ; l\'étiquette surprenante a une faible attente', () => {
  const notes: string[] = [];
  const f = new FluxPrevoyeur({ source: 'theia', nourrir: (n) => notes.push(n.texte) });
  const t = chanson(f);
  f.observer({ t, etiquette: 'couplet', confiance: 0.8 });
  f.suiteProbable(60);
  assert.ok((f.attendu('intro') ?? 1) < 0.2, 'une intro après un couplet serait surprenante');
  assert.ok((f.attendu('refrain') ?? 0) > 0.7);
  f.observer({ t: t + 40, etiquette: 'applaudissements', confiance: 0.9 });
  assert.equal(f.jugees.ratees, 1);
  assert.match(notes.at(-1)!, /pas arrivé \(vu « applaudissements »/);
});

test('un retour régulier (sonnette toutes les 5 s) est prévu avec sa régularité mesurée', () => {
  const f = new FluxPrevoyeur({ source: 'syrinx' });
  for (let k = 0; k < 6; k++) { f.observer({ t: k * 5, etiquette: 'sonnette', confiance: 0.9 }); f.observer({ t: k * 5 + 1, etiquette: 'silence', confiance: 0.9 }); }
  const l = f.suiteProbable(10);
  const s = l.find((x) => x.etiquette === 'sonnette');
  assert.ok(s);
  assert.ok(Math.abs(s!.t - 30) < 0.01);
  assert.ok(s!.confiance > 0.7 && s!.confiance < 1, 'jamais 100 % : la régularité est lissée');
});

test('jamais inventer : prévoir n\'ajoute rien à la ligne de temps ; le douteux n\'est pas appris ; privé = rien vers Noûs', () => {
  const notes: string[] = [];
  let prive = true;
  const f = new FluxPrevoyeur({ source: 'theia', nourrir: (n) => notes.push(n.texte), prive: () => prive });
  const t = chanson(f, 3);
  f.observer({ t, etiquette: 'couplet', confiance: 0.8 });
  const avant = f.attendu('refrain');
  f.suiteProbable(60); f.suiteProbable(60);
  assert.equal(f.attendu('refrain'), avant, 'les prévisions ne deviennent pas des observations');
  f.observer({ t: t + 5, etiquette: 'fantome', confiance: 0.1 }); // trop douteux
  assert.equal(f.attendu('fantome'), 0);
  f.observer({ t: t + 20, etiquette: 'refrain', confiance: 0.9 });
  assert.equal(f.jugees.realisees, 1);
  assert.equal(notes.length, 0, 'mode privé : rien n\'est transmis');
  prive = false;
  f.fermer();
  assert.deepEqual(f.suiteProbable(60), []);
});

test('mémoire bornée sur un très long flux', () => {
  const f = new FluxPrevoyeur({ source: 'theia' });
  const t0 = performance.now();
  for (let k = 0; k < 20_000; k++) { f.observer({ t: k, etiquette: `e${k % 500}`, confiance: 0.9 }); if (k % 100 === 0) f.suiteProbable(30); }
  assert.ok(performance.now() - t0 < 10_000);
  assert.ok(f.suiteProbable(30).length <= 21);
});
