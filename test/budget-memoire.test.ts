// Le comptable de la mémoire vive : budget pris sur la mémoire LIBRE moins une marge, réservations bornées, rendues,
// et vidage de tout ce qui est gardé quand la machine manque de mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetLibreMo, rendre, reserver, surPression } from '../src/brain/budget-memoire.ts';

function avec<T>(env: Record<string, string | undefined>, f: () => T): T {
  const avant: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { avant[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return f(); } finally { for (const k of Object.keys(avant)) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; } }
}

test('le budget vient de la mémoire libre moins la marge, jamais du total', () => {
  avec({ ODIN_MEMOIRE_LIBRE_MO: '3000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
    assert.equal(budgetLibreMo(), 1000); // (3000 − 1000) × 0,5
  });
  avec({ ODIN_MEMOIRE_LIBRE_MO: '900', ODIN_MEMOIRE_MARGE_MO: '1000' }, () => assert.equal(budgetLibreMo(), 0));
  // Sans réglage : un nombre fini, jamais négatif, borné par le plafond par défaut.
  avec({ ODIN_MEMOIRE_LIBRE_MO: undefined, ODIN_MEMOIRE_MARGE_MO: undefined, ODIN_MEMOIRE_PLAFOND_MO: undefined }, () => {
    const b = budgetLibreMo(); assert.ok(Number.isFinite(b) && b >= 0 && b <= 4096, String(b));
  });
});

test('réserver au-delà du budget est refusé ; ce qui est réservé compte pour tous ; rendre libère', () => {
  avec({ ODIN_MEMOIRE_LIBRE_MO: '3000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
    try {
      assert.equal(reserver('essai-a', 600), true);
      // (3000 − 1000) × 0,5 − 600 = 400 : ce qui est réservé est retiré pour tous.
      assert.equal(budgetLibreMo(), 400);
      assert.equal(reserver('essai-b', 500), false, 'deux caches ne prennent pas chacun « sur le libre »');
      assert.equal(reserver('essai-b', 400), true);
      assert.equal(budgetLibreMo(), 0);
      // Un cache qui grandit redemande son total : sa propre réservation d'avant ne compte pas contre lui.
      assert.equal(reserver('essai-a', 650), false);
      assert.equal(reserver('essai-a', 500), true);
      rendre('essai-b');
      assert.ok(budgetLibreMo() > 0);
      assert.equal(reserver('essai-c', -1), false);
      assert.equal(reserver('', 1), false);
    } finally { rendre('essai-a'); rendre('essai-b'); }
  });
});

test('le plafond borne la somme de tout ce qui est réservé', () => {
  avec({ ODIN_MEMOIRE_LIBRE_MO: '100000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '300' }, () => {
    try {
      assert.equal(budgetLibreMo(), 300);
      assert.equal(reserver('essai-p1', 200), true);
      assert.equal(reserver('essai-p2', 200), false);
      assert.equal(reserver('essai-p2', 100), true);
    } finally { rendre('essai-p1'); rendre('essai-p2'); }
  });
});

test('sous pression, chacun vide ce qu\'il garde et le budget tombe à zéro', () => {
  let vides = 0;
  surPression(() => { vides++; rendre('essai-pression'); });
  avec({ ODIN_MEMOIRE_LIBRE_MO: '5000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
    assert.equal(reserver('essai-pression', 100), true);
  });
  avec({ ODIN_MEMOIRE_LIBRE_MO: '500', ODIN_MEMOIRE_MARGE_MO: '1000' }, () => {
    assert.equal(budgetLibreMo(), 0);
    assert.equal(vides, 1);
    assert.equal(reserver('essai-pression', 1), false);
    // Rester sous la marge sans rien de réservé ne fait pas vider en boucle.
    budgetLibreMo(); budgetLibreMo();
    assert.equal(vides, 1);
  });
  avec({ ODIN_MEMOIRE_LIBRE_MO: '5000', ODIN_MEMOIRE_MARGE_MO: '1000', ODIN_MEMOIRE_PLAFOND_MO: '100000' }, () => {
    assert.ok(budgetLibreMo() > 0, 'la pression passée, le budget revient');
  });
});
