// Archytas — le bac à sable du code libre (cœur en processus, sans worker réel : « faux worker »). On vérifie
// que ce qui doit être bloqué l'est : une boucle infinie synchrone est coupée (timeout) ; process/require/fetch
// ne sont pas fournis ; une action hors liste blanche est refusée ; une action grave est refusée ; et les
// bornes (nombre d'appels) tiennent. node:vm n'est PAS une prison parfaite — ces essais montrent la barrière.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executerDansVm } from '../src/valhalla/archytas/bacasable.ts';
import type { Appeler } from '../src/valhalla/archytas/scripts.ts';

const LIM = { budgetMs: 300, budgetMo: 64, maxAppels: 5, maxBoucles: 100_000 };

/** Pont de test : liste blanche, action grave et action inconnue refusées (comme v.act auto). */
const appeler: Appeler = async (module, action) => {
  const cle = `${module}.${action}`;
  if (cle === 'danger.supprimer') return { ok: false, texte: 'action grave, elle demande ton accord et ne part pas d\'une automatisation.' };
  if (cle !== 'notes.ecrire') return { ok: false, texte: `Action inconnue : ${cle}` };
  return { ok: true, texte: 'écrit' };
};

test('boucle infinie synchrone : coupée par le timeout du bac à sable', async () => {
  const r = await executerDansVm('while (true) {}', {}, LIM, appeler);
  assert.equal(r.ok, false);
  assert.match(r.texte, /timed out|temps|dépass/i);
});

test('process et require ne sont pas fournis au contexte', async () => {
  const rp = await executerDansVm('return process.pid;', {}, LIM, appeler);
  assert.equal(rp.ok, false);
  assert.match(rp.texte, /process/);
  const rr = await executerDansVm('const fs = require("fs"); return fs;', {}, LIM, appeler);
  assert.equal(rr.ok, false);
  assert.match(rr.texte, /require/);
  const rf = await executerDansVm('return fetch("http://x");', {}, LIM, appeler);
  assert.equal(rf.ok, false);
  assert.match(rf.texte, /fetch/);
});

test('eval et new Function sont coupés dans le contexte (codeGeneration:false)', async () => {
  const r = await executerDansVm('return eval("1+1");', {}, LIM, appeler);
  assert.equal(r.ok, false);
  const r2 = await executerDansVm('return (new Function("return 2"))();', {}, LIM, appeler);
  assert.equal(r2.ok, false);
});

test('le seul lien vers le monde est le pont `appeler` : action connue ok, inconnue refusée, grave refusée', async () => {
  const ok = await executerDansVm('const r = await appeler("notes", "ecrire", { texte: "x" }); return r.ok;', {}, LIM, appeler);
  assert.equal(ok.ok, true);
  assert.match(ok.texte, /true/);

  const inconnue = await executerDansVm('const r = await appeler("systeme", "rm"); return r.texte;', {}, LIM, appeler);
  assert.equal(inconnue.ok, true); // le script tourne ; c'est l'APPEL qui est refusé
  assert.match(inconnue.texte, /inconnue/i);

  const grave = await executerDansVm('const r = await appeler("danger", "supprimer"); return r.texte;', {}, LIM, appeler);
  assert.match(grave.texte, /grave/);
});

test('borne : trop d\'appels d\'applis est coupé', async () => {
  const r = await executerDansVm('for (let i = 0; i < 100; i++) { await appeler("notes", "ecrire"); } return "fini";', {}, LIM, appeler);
  assert.equal(r.ok, false);
  assert.match(r.texte, /trop d'appels/);
});
