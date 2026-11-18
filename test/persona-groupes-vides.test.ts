// Persona : chaque groupe créé a ses cases d'applis dans l'onglet « Accès », même s'il n'a encore personne et aucune
// appli. Le formulaire se voit tout de suite, toutes ses cases décochées : il ne donne rien tout seul. Cocher une case
// passe toujours par la validation du propriétaire (rien n'est donné sans elle).
// Un vrai Odin (serveur web + applis), dossiers jetables, identifiants neutres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { groupesDe, persona } from '../src/valhalla/sso/etat.ts';

const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
interface Sec { kind: string; onglet?: string; title?: string; action?: string; fixe?: Record<string, unknown>; columns?: string[]; params?: Array<{ key: string; kind: string; default?: unknown }> }

test('un groupe créé, vide, a tout de suite ses cases d\'applis dans Persona → Accès ; cocher reste validé', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    const sections = async (): Promise<Sec[]> => { const r = await v.json('/api/valhalla/view?id=var'); assert.equal(r.status, 200); return ((r.body.view as { sections?: Sec[] }).sections ?? []); };
    const cases = (l: Sec[], g: string) => l.find((x) => x.kind === 'form' && x.action === 'acces_cases' && x.fixe?.qui === g);

    // Avant : le groupe n'existe pas, il n'a pas de cases.
    assert.equal(cases(await sections(), 'atelier'), undefined);

    // Le propriétaire crée le groupe : personne dedans, aucune appli donnée.
    const r = await va.act('var', 'creer_groupe', { nom: 'atelier' }); assert.equal(r.ok, true, r.text);
    const l = await sections(), f = cases(l, 'atelier');
    assert.ok(f, 'le groupe vide a son formulaire de cases');
    assert.equal(f!.onglet, 'Accès'); assert.equal(f!.title, 'Groupe atelier');
    assert.ok((f!.params ?? []).length > 0, 'une case par appli');
    assert.ok((f!.params ?? []).every((p) => p.kind === 'boolean' && p.default === false), 'toutes décochées : le groupe n\'a rien');
    const tableau = l.find((x) => x.kind === 'table' && x.onglet === 'Accès' && x.title === 'Accès aux applis');
    assert.ok(tableau?.columns?.includes('atelier'), 'le groupe a sa colonne dans le tableau des accès');
    assert.equal(cases(l, 'admin'), undefined, 'le groupe admin a tout : pas de cases');

    // Cocher une case sans la validation : refusé, rien n'est donné.
    const appli = (f!.params ?? []).find((p) => p.key === 'venus')?.key ?? f!.params![0].key;
    const sans = await v.json('/api/valhalla/act', { module: 'var', action: 'acces_cases', input: { qui: 'atelier', [appli]: true } });
    assert.notEqual(sans.body.ok, true, 'cocher sans validation est refusé');
    assert.ok(!groupesDe(persona()!, appli).includes('atelier'), 'rien n\'est donné sans validation');
    // Avec la validation : donné.
    const avec = await v.json('/api/valhalla/act', { module: 'var', action: 'acces_cases', input: { qui: 'atelier', [appli]: true }, confirm: true });
    assert.equal(avec.body.ok, true, JSON.stringify(avec.body).slice(0, 300));
    assert.ok(groupesDe(persona()!, appli).includes('atelier'), 'l\'appli est donnée au groupe');
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
