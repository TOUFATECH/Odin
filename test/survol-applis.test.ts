// Les phrases de survol des applis (src/valhalla/survol.ts) : une pour chaque appli, courte et en mots simples,
// trois ou quatre actions qui commencent par un verbe ; et « Alternative à » ne dit jamais « copié » ni « clone ».
import assert from 'node:assert/strict';
import test from 'node:test';
import { allModules } from '../src/valhalla/odin.ts';
import { SIMILAIRES } from '../src/valhalla/names.ts';
import { SURVOL } from '../src/valhalla/survol.ts';
import { makeOdin } from './helpers.ts';

function ids(): string[] {
  const o = makeOdin([{ text: 'ok' }]);
  try { return allModules(o as never).map((m) => m.id); } finally { (o as { close?: () => void }).close?.(); }
}

test('survol : chaque appli a sa phrase et ses actions, et aucune appli inconnue n\'en a', () => {
  const liste = ids();
  const manques = liste.filter((id) => !SURVOL[id]);
  assert.deepEqual(manques, [], `phrase de survol manquante (src/valhalla/survol.ts) : ${manques.join(', ')}`);
  const inconnues = Object.keys(SURVOL).filter((id) => !liste.includes(id));
  assert.deepEqual(inconnues, [], `appli inconnue dans SURVOL : ${inconnues.join(', ')}`);
});

test('survol : phrase de 90 caractères au plus, sans parenthèse, sans comparaison ni jargon', () => {
  for (const [id, s] of Object.entries(SURVOL)) {
    assert.ok(s.phrase.trim().length > 10, `${id} : phrase trop courte`);
    assert.ok(s.phrase.length <= 90, `${id} : ${s.phrase.length} caractères`);
    assert.ok(!s.phrase.includes('('), `${id} : parenthèse`);
    assert.doesNotMatch(s.phrase, /\bcomme\b|docker|podman|démon|supabase|prisma|\bapi\b|crud/i, id);
  }
});

test('survol : trois ou quatre actions de 42 caractères au plus, qui commencent par un verbe à l\'infinitif', () => {
  for (const [id, s] of Object.entries(SURVOL)) {
    assert.ok(s.faire.length >= 3 && s.faire.length <= 4, `${id} : ${s.faire.length} actions`);
    for (const f of s.faire) {
      assert.ok(f.length <= 42, `${id} : « ${f} » (${f.length})`);
      const premier = f.split(/[\s,]/)[0];
      assert.match(premier, /(er|ir|re|oir)$/i, `${id} : « ${f} » ne commence pas par un verbe`);
      assert.doesNotMatch(f, /docker|podman|démon|supabase|prisma/i, id);
    }
  }
});

test('alternatives : jamais « copié » ni « clone » dans les applicatifs similaires', () => {
  for (const [id, l] of Object.entries(SIMILAIRES)) for (const nom of l) assert.doesNotMatch(nom, /copi[ée]|clone/i, `${id} : ${nom}`);
});
