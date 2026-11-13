// Zénith (comme Grafana) : tableaux de bord sur les mesures d'Odin, modèles, panneaux, seuils qui préviennent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { compute, expand, toneOf } from '../src/valhalla/modules/syn.ts';

test('Zénith : calculs purs (mesures « * », calcul, seuils dans les deux sens)', () => {
  assert.deepEqual(expand(['eir.fs.*', 'eir.cpu'], ['eir.fs.racine', 'eir.fs.data', 'eir.mem']), ['eir.fs.racine', 'eir.fs.data', 'eir.cpu']);
  assert.equal(compute([1, 5, 3], 'max'), 5); assert.equal(compute([1, 5, 3], 'derniere'), 3); assert.equal(compute([2, 4], 'moyenne'), 3); assert.equal(compute([], 'min'), undefined);
  const p = { id: 'x', titre: 'X', series: [], type: 'courbe' as const, calcul: 'moyenne' as const, attention: 75, grave: 90 };
  assert.deepEqual([50, 80, 95, undefined].map((v) => toneOf(p, v)), ['bon', 'attention', 'mauvais', 'neutre']);
  assert.deepEqual([-60, -75, -85].map((v) => toneOf({ ...p, attention: -70, grave: -80, bas: true }, v)), ['bon', 'attention', 'mauvais']);
});

test('Zénith : modèle Machine, panneau ajouté, vue, texte, alerte de seuil', async () => {
  const home = mkdtempSync(join(tmpdir(), 'syn-'));
  const alerts: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async (t: string) => { alerts.push(t); }, autonomy: () => 'equilibre' });
  try {
    const now = Date.now();
    for (let k = 30; k >= 0; k--) v.metrics.put({ 'eir.cpu': 95, 'eir.mem': 40, 'eir.fs.racine': 70, 'eir.fs.data': 97, 'vordr.up.nas': 1, 'vordr.temps.nas': 120 }, now - k * 60e3);
    v.metrics.flush();
    assert.match((await v.act('syn', 'tableaux')).text, /Aucun tableau.*Machine/);
    assert.match((await v.act('syn', 'modele', { modele: 'machine' })).text, /Tableau « Machine » ajouté \(5 panneaux\)/);
    assert.match((await v.act('syn', 'modele', { modele: 'sites' })).text, /Sites et appareils/);
    const t = (await v.act('syn', 'voir', { tableau: 'machine', periode: '1h' })).text;
    assert.match(t, /Processeur \(moyenne\) : 🔴 eir\.cpu 95 %/); assert.match(t, /Disques remplis \(dernière valeur\) : 🔴 data 97 % · 🟢 racine 70 %/); assert.match(t, /Charge : pas encore de valeurs/);
    assert.match((await v.act('syn', 'voir', { tableau: 'Sites et appareils', periode: '1h' })).text, /Disponibilité \(moyenne\) : 🟢 nas 100 %/);
    assert.match((await v.act('syn', 'creer', { nom: 'Mon NAS', periode: '6h' })).text, /créé/);
    assert.match((await v.act('syn', 'panneau', { tableau: 'Mon NAS', titre: 'Mémoire NAS', mesures: 'eir.mem', type: 'valeur', calcul: 'max', unite: '%', attention: '30' })).text, /ajouté à Mon NAS \(1 mesure/);
    assert.match((await v.act('syn', 'panneau', { tableau: 'Mon NAS', titre: 'x', mesures: 'pas bon!' })).text, /invalide/);
    const view = await v.module('syn')!.view(v.ctx('syn'), new URLSearchParams('tab=Mon NAS&periode=1h'));
    assert.equal(view.kpis?.[0].value, '40 %'); assert.equal(view.kpis?.[0].tone, 'attention');
    const vm = await v.module('syn')!.view(v.ctx('syn'), new URLSearchParams('periode=1h'));
    assert.ok(vm.sections.some((x) => x.kind === 'courbe' && x.title === 'Processeur')); assert.ok(vm.sections.some((x) => x.kind === 'bars'));
    await v.module('syn')!.watch!.run(v.ctx('syn'));
    const al = v.ctx('syn').alerts({ module: 'syn' }).map((a) => a.title);
    assert.ok(al.some((x) => /Machine · Processeur : eir\.cpu 95 %/.test(x))); assert.ok(al.some((x) => /data 97 %/.test(x)));
    assert.match((await v.act('syn', 'retirer_panneau', { tableau: 'Mon NAS', panneau: 'Mémoire NAS' })).text, /retiré/);
    assert.match((await v.act('syn', 'supprimer', { tableau: 'Mon NAS' })).text, /les mesures restent/);
    assert.match((await v.act('syn', 'mesures_connues', { debut: 'eir.fs' })).text, /eir\.fs\.data/);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
