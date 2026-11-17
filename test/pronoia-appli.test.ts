// Prónoia — l'appli : actions, droits (les actions graves demandent l'accord et sont refusées à une automatisation), page
// (structure et textes honnêtes), interrupteur, mode privé. Fausse horloge ; aucun réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { pronoia, moteurPronoia, oublierMoteursPronoia, court, type OptionsPronoia } from '../src/valhalla/pronoia/index.ts';
import { oublierBranchementsPronoia } from '../src/valhalla/pronoia/base.ts';
import { MOTS_CERTITUDE } from '../src/valhalla/pronoia/honnete.ts';
import { a } from './pronoia-outils-essai.ts';

const homes: string[] = [];
after(() => { oublierMoteursPronoia(); oublierBranchementsPronoia(); for (const h of homes) rmSync(h, { recursive: true, force: true }); });

function monter(o: OptionsPronoia = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-appli-')); homes.push(home);
  const horloge = { t: a(14, 6, 0) };
  const mod = pronoia(() => ({ maintenant: () => horloge.t, ...o }));
  const v = new Valhalla(home, [mod], { notify: async () => { throw new Error('aucune notification attendue'); }, fetch: (async () => { throw new Error('réseau interdit'); }) as typeof fetch, now: () => new Date(horloge.t) });
  const ctx = v.ctx('pronoia');
  mod.start?.(ctx);
  const m = moteurPronoia(home)!;
  return { home, horloge, mod, v, ctx, m };
}

/** 14 jours de porte de garage vers 8h (Théia), 12 jours sur 14. */
function garage(m: NonNullable<ReturnType<typeof moteurPronoia>>): void {
  for (let j = 0; j < 14; j++) {
    if (j !== 3 && j !== 9) m.recevoirEvenement({ appli: 'theia', type: 'porte_ouverte', cle: 'garage', at: a(j, 8, 5) });
    m.recevoirEvenement({ appli: 'theia', type: 'mouvement', cle: 'jardin', at: a(j, 21, 0) });
  }
}

test('identité du module : Prónoia, famille Données, aucun logiciel nommé', () => {
  const mod = pronoia();
  assert.equal(mod.id, 'pronoia'); assert.equal(mod.name, 'Prónoia'); assert.equal(mod.family, 'Données');
  assert.deepEqual(mod.from, []);
  for (const id of ['bilan', 'previsions', 'jugees', 'prevoir', 'couper', 'allumer', 'regler', 'purger', 'effacer']) assert.ok(mod.actions.some((x) => x.id === id), id);
  const tout = JSON.stringify({ what: mod.what, does: mod.does });
  assert.doesNotMatch(tout, /prédit l'avenir|prédire l'avenir/i);
  assert.doesNotMatch(tout, MOTS_CERTITUDE);
});

test('prévoir, puis voir les prévisions avec confiance, date et sources ; le bilan est le vrai', async () => {
  const { v, m, horloge } = monter();
  garage(m);
  const p = await v.act('pronoia', 'prevoir', {});
  assert.equal(p.ok, true);
  assert.match(p.text, /Prévision \(confiance 81 %\) : peut-être porte ouverte \(garage\)/);
  assert.match(p.text, /D'après : 12 jour\(s\) sur 14/);
  const l = await v.act('pronoia', 'previsions', {});
  assert.match(l.text, /Estimation faite/);
  assert.equal(((await v.act('pronoia', 'bilan', {})).data as { taux?: number } | undefined)?.taux, undefined);
  horloge.t = a(14, 8, 10);
  m.recevoirEvenement({ appli: 'theia', type: 'porte_ouverte', cle: 'garage', at: horloge.t });
  const b = await v.act('pronoia', 'bilan', {});
  assert.match(b.text, /Taux de réussite mesuré : 100 % \(1 réalisée\(s\) sur 1 jugée\(s\)\)/);
  const j = await v.act('pronoia', 'jugees', {});
  assert.match(j.text, /réalisée · porte ouverte \(garage\) \(confiance 81 %\) · écart \+\d+ min/);
});

test('droits : effacer, rallumer, baisser un seuil ou changer la garde sont graves et refusés à une automatisation', async () => {
  const { v, m, mod, ctx } = monter();
  garage(m);
  const act = (id: string) => mod.actions.find((x) => x.id === id)!;
  assert.match(act('effacer').grave?.({}, ctx) ?? '', /effacer tout/);
  const auto = await v.act('pronoia', 'effacer', {}, { auto: true });
  assert.equal(auto.ok, false); assert.match(auto.text, /action grave/);
  assert.ok(m.magasin.etat.evenements.length > 0, 'rien n\'a été effacé');
  assert.equal(act('regler').grave?.({ seuilPressentiment: 30 }, ctx)?.includes('baisser le seuil des pressentiments à 30 %'), true);
  assert.match(act('regler').grave?.({ gardeJours: 10 }, ctx) ?? '', /la purge effacera/);
  assert.match(act('regler').grave?.({ gardeJours: 365 }, ctx) ?? '', /garder tes habitudes 365 jours/);
  assert.equal(act('regler').grave?.({ seuilPressentiment: 80, seuilPrevenir: 90 }, ctx), undefined, 'renforcer une protection n\'est pas grave');
  assert.equal((await v.act('pronoia', 'regler', { seuilPressentiment: 30 }, { auto: true })).ok, false);
  // couper est une protection : un clic, même pour une automatisation
  assert.equal(act('couper').grave, undefined);
  assert.equal((await v.act('pronoia', 'couper', {}, { auto: true })).ok, true);
  assert.equal(m.actif, false);
  assert.match(act('allumer').grave?.({}, ctx) ?? '', /recommencera à apprendre/);
  assert.equal((await v.act('pronoia', 'allumer', {}, { auto: true })).ok, false);
  assert.equal(m.actif, false);
  // le propriétaire, lui, peut
  assert.equal((await v.act('pronoia', 'allumer', {})).ok, true);
  assert.equal(m.actif, true);
  const r = await v.act('pronoia', 'regler', { seuilPressentiment: 50, gardeJours: 30 });
  assert.match(r.text, /pressentiment sous 50 %, prévenir à partir de 70 %, garde 30 jour\(s\)/);
  const e = await v.act('pronoia', 'effacer', {});
  assert.equal(e.ok, true);
  assert.equal(m.magasin.etat.evenements.length, 0);
});

test('interrupteur coupé : prévoir ne prévoit rien, la page le dit', async () => {
  const { v, m, mod, ctx } = monter();
  garage(m);
  await v.act('pronoia', 'couper', {});
  const p = await v.act('pronoia', 'prevoir', {});
  assert.match(p.text, /coupée : rien n'est prévu/);
  const page = await mod.view!(ctx, new URLSearchParams());
  assert.match(page.subtitle ?? '', /anticipation coupée/);
  assert.equal(page.kpis?.[0].value, 'coupée');
  const s = JSON.stringify(page);
  assert.match(s, /Rallumer l'anticipation/);
});

test('mode privé : rien n\'est prévu ni appris, la page le dit', async () => {
  let prive = true;
  const { v, m, mod, ctx } = monter({ prive: () => prive });
  assert.equal(m.recevoirEvenement({ appli: 'theia', type: 'x', at: a(13, 1, 0) }).accepte, false);
  assert.match((await v.act('pronoia', 'prevoir', {})).text, /Mode privé/);
  const page = await mod.view!(ctx, new URLSearchParams());
  assert.match(page.subtitle ?? '', /mode privé/);
  prive = false;
  assert.equal(m.recevoirEvenement({ appli: 'theia', type: 'x', at: a(13, 1, 0) }).accepte, true);
});

test('la page : onglets courts, textes honnêtes, heures locales, tableaux (pas de barres), unités, noms longs raccourcis', async () => {
  const { m, mod, ctx, horloge } = monter();
  garage(m);
  for (let j = 0; j < 10; j++) m.recevoirEvenement({ appli: 'syrinx', type: 'un_evenement_au_nom_vraiment_tres_long_qui_ne_doit_pas_deborder_de_la_page', cle: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', at: a(j, 12, 0) });
  m.prevoirEvenements();
  horloge.t = a(14, 8, 10);
  m.recevoirEvenement({ appli: 'theia', type: 'porte_ouverte', cle: 'garage', at: horloge.t });
  horloge.t = a(15, 0, 0);
  const page = await mod.view!(ctx, new URLSearchParams());
  assert.deepEqual(page.onglets, ['Prévisions', 'Bilan', 'Réglages']);
  for (const o of page.onglets!) assert.ok(!o.includes(' '));
  const s = JSON.stringify(page);
  assert.match(s, /ne prédit pas l'avenir/);
  assert.match(s, /pas encore essayé pour de vrai/);
  assert.doesNotMatch(s, MOTS_CERTITUDE);
  assert.ok(!page.sections.some((x) => x.kind === 'bars'), 'aucune barre mise à l\'échelle du plus fort');
  const jugees = page.sections.find((x) => x.title === 'Ce qui s\'est réalisé ou non');
  assert.equal(jugees?.kind, 'table');
  if (jugees?.kind === 'table') {
    assert.ok(jugees.rows.length >= 1);
    for (const r of jugees.rows) { assert.match(r.cells[3], / %$/); assert.ok(r.cells[2].length <= 60, r.cells[2]); assert.doesNotMatch(r.cells[0], /T\d\d:/, 'heure locale, pas ISO'); }
  }
  const cal = page.sections.find((x) => x.title === 'Justesse par tranche de confiance');
  assert.equal(cal?.kind, 'table');
  const kTaux = page.kpis!.find((k) => k.label === 'Taux de réussite')!;
  assert.match(kTaux.value, / %$/);
  const enCours = page.sections.find((x) => x.title === 'Prévisions en cours');
  assert.equal(enCours?.kind, 'log', 'un texte long va dans un journal');
  assert.ok(court('a'.repeat(200)).length <= 60);
  assert.match(court('debut-' + 'x'.repeat(100) + '-fin'), /^debut-.*….*-fin$/);
});

test('aucune notification ni action n\'est lancée par l\'appli, même à confiance maximale', async () => {
  const { v, m } = monter();
  for (let j = 0; j < 60; j++) m.recevoirEvenement({ appli: 'domus', type: 'chaudiere', at: a(j - 50, 6, 0) });
  const r = await v.act('pronoia', 'prevoir', {});
  assert.equal(r.ok, true); // le faux notify lève s'il est appelé : il ne l'est pas
  assert.ok(m.aPrevenir(24 * 3_600_000).every((p) => p.agit === false && p.niveau === 'discret'));
});
