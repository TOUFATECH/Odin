// Une action « propriétaire seul » (le rythme de Mathésis) : le propriétaire la règle lui-même sans validation ; une
// automatisation, Odin seul, un membre ou une conversation marquée ne le peuvent pas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module } from '../src/valhalla/types.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';

const home = mkdtempSync(join(tmpdir(), 'proprio-seul-'));
after(() => rmSync(home, { recursive: true, force: true }));
let rythme = 10;
const mod = {
  id: 'essai', name: 'Essai', family: 'Données', what: 'essai', does: [], from: [], upstream: [], words: [],
  actions: [
    { id: 'rythme', label: 'Rythme', what: 'pages par jour', proprietaireSeul: true, params: [{ key: 'n', label: 'n', kind: 'number' }], run: async (_c: unknown, i: Record<string, unknown>) => { rythme = Number(i.n); return { text: `rythme ${rythme}` }; } },
    { id: 'regler', label: 'Régler', what: 'réglages', proprietaireSeul: (i: Record<string, unknown>) => i.attenteS !== undefined, run: async () => ({ text: 'réglé' }) },
  ],
} as unknown as Module;
const v = new Valhalla(home, [mod]);

test('une automatisation (auto) ne peut pas monter le rythme', async () => {
  const r = await v.act('essai', 'rythme', { n: 1_000_000 }, { auto: true });
  assert.equal(r.ok, false); assert.match(r.text, /seul le propriétaire/); assert.equal(rythme, 10);
});

test('Odin seul, un réflexe, un membre, une personne de Persona, une conversation marquée : non', async () => {
  for (const o of [{ by: 'odin' as const }, { by: 'réflexe' as const }, { qui: 'member' as const }, { qui: 'guest' as const }, { marque: true }]) {
    const r = await v.act('essai', 'rythme', { n: 999 }, o);
    assert.equal(r.ok, false, JSON.stringify(o));
  }
  const p = await auNomDe({ login: 'lea', name: 'Léa', groups: [] }, () => v.act('essai', 'rythme', { n: 999 }));
  assert.equal(p.ok, false);
  assert.equal(rythme, 10);
});

test('le propriétaire le règle lui-même, sans validation ; un champ ordinaire du réglage reste libre', async () => {
  const r = await v.act('essai', 'rythme', { n: 50 }, { qui: 'owner' });
  assert.equal(r.ok, true); assert.equal(rythme, 50);
  assert.equal((await v.act('essai', 'regler', { vitesse: 'douce' }, { auto: true })).ok, true, 'hors champs de rythme : pas « propriétaire seul »');
  assert.equal((await v.act('essai', 'regler', { attenteS: 1 }, { auto: true })).ok, false, 'l\'attente entre deux pages : propriétaire seul');
});

test('le vrai Mathésis : une automatisation ne MONTE pas le rythme d\'un site ni le rythme général ; elle peut le baisser', async () => {
  const { mathesis } = await import('../src/valhalla/mathesis/module.ts');
  const { oublierBranchementsMathesis } = await import('../src/valhalla/mathesis/magasin.ts');
  const { fausseHorloge, fauxSite, fauxResolveur, fauxMoteur, html } = await import('./mathesis-outils-essai.ts');
  oublierBranchementsMathesis();
  const h2 = mkdtempSync(join(tmpdir(), 'proprio-seul-m-'));
  const hl = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const site = fauxSite({ 'https://essai.example.org/': { corps: html('Accueil', ['bonjour']) } } as never, hl);
  const mod = mathesis(() => ({ transport: site.transport, resoudre: fauxResolveur(), temps: { maintenant: hl.maintenant, attendre: hl.attendre }, chercher: fauxMoteur({}).chercher }));
  const vm = new Valhalla(h2, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit'); }, now: () => new Date(hl.t) });
  try {
    await vm.act('mathesis', 'absorber', { adresse: 'https://essai.example.org' });
    assert.equal((await vm.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 5000 })).ok, true, 'le propriétaire le règle');
    const monte = await vm.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 9_000_000 }, { auto: true });
    assert.equal(monte.ok, false, monte.text); assert.match(monte.text, /seul le propriétaire/);
    assert.equal((await vm.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 10 }, { auto: true })).ok, true, 'baisser : permis');
    assert.equal((await vm.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 4000 }, { qui: 'member' })).ok, false, 'un membre : non');
    assert.equal((await vm.act('mathesis', 'regler', { attenteS: 0.5 }, { auto: true })).ok, false, 'raccourcir l\'attente : propriétaire seul');
  } finally { vm.stop(); rmSync(h2, { recursive: true, force: true }); }
});
