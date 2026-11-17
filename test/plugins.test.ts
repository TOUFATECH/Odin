// Plugins des compétences : le cœur (magasin, calcul du graphe, récolte des constats), avec de fausses sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adresseMasquee, construireEtat, constatsVides, indexerNote, nettoyer, outilsDuConnecteur, recolter, slugMcp } from '../src/plugins/graphe.ts';
import { enregistrerPlugin, lier, lirePlugins, LIMITES } from '../src/plugins/magasin.ts';
import type { Connecteur, SourcesEtat } from '../src/plugins/types.ts';
import { toolName } from '../src/valhalla/modules/ratatoskr.ts';

const dossier = () => mkdtempSync(join(tmpdir(), 'odin-plugins-'));
const quand = new Date('2026-11-17T10:00:00.000Z');
const refs = (skills: string[], mcp: string[]) => ({ skills: new Set(skills), mcp: new Set(mcp) });
const github: Connecteur = { nom: 'GitHub', sorte: 'http', adresse: 'https://h.example.org/mcp', etat: 'relie', jeton: false, outils: [] };
const sources = (o: Partial<SourcesEtat> = {}): SourcesEtat => ({
  competences: [{ nom: 'a', description: 'compétence a', body: 'corps a' }, { nom: 'b', description: 'compétence b', body: 'corps b' }],
  brouillons: 0, stats: [], connecteurs: [github], fichier: { version: 1, plugins: [], liens: [] }, abime: false,
  constats: constatsVides(), notes: [], soul: { etat: 'connu', extraitsCompetences: 0 }, ...o,
});
const lien = (e: ReturnType<typeof construireEtat>, a: string, b: string) => e.liens.find((l) => l.a === a && l.b === b);

test('1. magasin vide, puis création atomique sans fichier temporaire', () => {
  const h = dossier();
  try {
    const r = lirePlugins(h);
    assert.equal(r.fichier.plugins.length, 0); assert.equal(r.fichier.liens.length, 0); assert.equal(r.abime, false);
    assert.equal(existsSync(join(h, 'competences')), false, 'rien n\'est écrit tant que rien n\'est créé');
    const p = enregistrerPlugin(h, { nom: 'Développement', skills: ['a'], mcp: ['GitHub'] }, refs(['a'], ['GitHub']), quand);
    assert.equal(p.id, 'developpement');
    assert.ok(existsSync(join(h, 'competences', 'plugins.json')));
    assert.equal(lirePlugins(h).fichier.plugins[0].nom, 'Développement');
    assert.deepEqual(readdirSync(join(h, 'competences')).filter((f) => f.includes('.tmp-')), []);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('2. fichier abîmé : lu vide, mis de côté à la première écriture', () => {
  const h = dossier();
  try {
    mkdirSync(join(h, 'competences')); writeFileSync(join(h, 'competences', 'plugins.json'), '{oups');
    assert.equal(lirePlugins(h).abime, true);
    enregistrerPlugin(h, { nom: 'X1', skills: [], mcp: [] }, refs([], []), quand);
    const f = readdirSync(join(h, 'competences'));
    assert.ok(f.some((x) => x.startsWith('plugins.json.abime-')), 'l\'ancien fichier est gardé');
    assert.equal(readFileSync(join(h, 'competences', f.find((x) => x.startsWith('plugins.json.abime-'))!), 'utf8'), '{oups');
    const r = lirePlugins(h); assert.equal(r.abime, false); assert.equal(r.fichier.plugins.length, 1);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('3. validation : identifiant tiré du nom, références inconnues, limite de 200', () => {
  const h = dossier();
  try {
    assert.equal(enregistrerPlugin(h, { nom: 'Dév & Tests', skills: [], mcp: [] }, refs([], []), quand).id, 'dev-tests');
    assert.equal(enregistrerPlugin(h, { nom: 'Dév & Tests', skills: [], mcp: [] }, refs([], []), quand).id, 'dev-tests-2');
    assert.throws(() => enregistrerPlugin(h, { nom: 'Y', skills: ['fantome'], mcp: [] }, refs(['a'], []), quand), (e: Error & { code?: number }) => e.code === 400 && /fantome/.test(e.message));
    assert.throws(() => enregistrerPlugin(h, { nom: 'Y', skills: [], mcp: ['Nulle part'] }, refs([], ['GitHub']), quand), (e: Error & { code?: number }) => e.code === 400 && /Nulle part/.test(e.message));
    assert.throws(() => enregistrerPlugin(h, { nom: '', skills: [], mcp: [] }, refs([], []), quand), /obligatoire/);
    assert.throws(() => enregistrerPlugin(h, { id: 'zz', nom: 'Z', skills: [], mcp: [] }, refs([], []), quand), (e: Error & { code?: number }) => e.code === 404);
    assert.throws(() => lier(h, 'a', 'GitHub', true, refs([], ['GitHub']), quand), (e: Error & { code?: number }) => e.code === 400);
    for (let i = 2; i < LIMITES.plugins; i++) enregistrerPlugin(h, { nom: `P ${i}`, skills: [], mcp: [] }, refs([], []), quand);
    assert.equal(lirePlugins(h).fichier.plugins.length, 200);
    assert.throws(() => enregistrerPlugin(h, { nom: 'De trop', skills: [], mcp: [] }, refs([], []), quand), (e: Error & { code?: number }) => e.code === 400);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('4. points seuls : dessinés, sans lien', () => {
  const e = construireEtat(sources());
  assert.equal(e.noeuds.length, 6);
  assert.deepEqual(e.noeuds.slice(0, 3).map((n) => n.id), ['brain', 'memoire', 'soul']);
  for (const id of ['skill:a', 'skill:b', 'mcp:GitHub']) assert.equal(e.noeuds.find((n) => n.id === id)?.seul, true, id);
  assert.equal(e.liens.length, 0);
  assert.equal(e.resume.seuls, 3);
  assert.equal(e.resume.mcpDisponible, true);
});

test('5. liens déclarés : par un plugin, et en direct', () => {
  const e = construireEtat(sources({ fichier: { version: 1, plugins: [{ id: 'x', nom: 'X', description: '', skills: ['a', 'absente'], mcp: ['GitHub'], cree: '', modifie: '' }], liens: [{ skill: 'b', mcp: 'GitHub', cree: '' }] } }));
  assert.deepEqual(lien(e, 'plugin:x', 'skill:a')?.provenances, ['declare']);
  assert.deepEqual(lien(e, 'plugin:x', 'mcp:GitHub')?.provenances, ['declare']);
  assert.deepEqual(lien(e, 'skill:b', 'mcp:GitHub')?.provenances, ['declare']);
  assert.equal(e.noeuds.some((n) => n.id === 'skill:absente'), false, 'une référence disparue n\'est pas dessinée');
  assert.deepEqual(e.plugins[0].skills, [{ nom: 'a', present: true }, { nom: 'absente', present: false }]);
  assert.deepEqual(e.noeuds.find((n) => n.id === 'skill:a')?.plugins, ['x']);
});

test('6. lien cité : le nom d\'outil complet, pas un simple mot', () => {
  const e = construireEtat(sources({ competences: [{ nom: 'a', description: '', body: 'Appelle mcp_github_create_issue puis vérifie.' }, { nom: 'b', description: 'parle de github', body: 'github' }] }));
  assert.deepEqual(lien(e, 'skill:a', 'mcp:GitHub')?.provenances, ['cite']);
  assert.equal(lien(e, 'skill:b', 'mcp:GitHub'), undefined);
});

test('7. lien constaté et récolte idempotente', () => {
  const t1 = JSON.stringify({ at: 1, question: 'jamais lue', tools: [{ name: 'skill_read', input: '{"name":"a"}' }, { name: 'mcp_github_list', input: '{}' }] });
  let r = recolter(constatsVides(), { s1: t1 }, ['GitHub']);
  assert.equal(r.change, true);
  let e = construireEtat(sources({ constats: r.constats }));
  assert.deepEqual(lien(e, 'skill:a', 'mcp:GitHub')?.provenances, ['constate']);
  assert.equal(lien(e, 'skill:a', 'mcp:GitHub')?.n, 1);
  assert.equal(r.constats.mcpTours.GitHub, 1);
  assert.equal(JSON.stringify(r.constats).includes('jamais lue'), false, 'la question n\'est jamais lue');
  r = recolter(r.constats, { s1: t1 }, ['GitHub']);
  assert.equal(r.change, false); assert.equal(r.constats.skillMcp['a|GitHub'].n, 1);
  r = recolter(r.constats, { s1: JSON.stringify({ at: 2, tools: [{ name: 'skill_read', input: '{"name":"a","x":"coup' }, { name: 'mcp_github_list', input: '{}' }] }) }, ['GitHub']);
  assert.equal(r.constats.skillMcp['a|GitHub'].n, 2, 'JSON coupé : le nom est quand même retrouvé');
  e = construireEtat(sources({ constats: r.constats, fichier: { version: 1, plugins: [], liens: [{ skill: 'a', mcp: 'GitHub', cree: '' }] }, competences: [{ nom: 'a', description: '', body: 'mcp_github_list' }, { nom: 'b', description: '', body: '' }] }));
  assert.deepEqual(lien(e, 'skill:a', 'mcp:GitHub')?.provenances, ['declare', 'cite', 'constate'], 'un seul lien, provenances dans l\'ordre');
  assert.equal(e.liens.filter((l) => l.a === 'skill:a' && l.b === 'mcp:GitHub').length, 1);
});

test('8. Mémoire : seulement une compétence vraiment utilisée', () => {
  const e = construireEtat(sources({ stats: [{ name: 'a', uses: 3 }, { name: 'b', uses: 0 }] }));
  assert.equal(lien(e, 'memoire', 'skill:a')?.titre, 'utilisée 3 fois (mémoire d\'Odin)');
  assert.equal(lien(e, 'memoire', 'skill:b'), undefined);
});

test('9. Brain : seulement par un lien écrit dans une note', () => {
  const comp = [{ nom: 'a-b', description: '', body: '' }, { nom: 'abc', description: '', body: '' }];
  const fichier = { version: 1 as const, plugins: [{ id: 'x', nom: 'X', description: '', skills: [], mcp: [], cree: '', modifie: '' }], liens: [] };
  let e = construireEtat(sources({ competences: comp, fichier, notes: [indexerNote('Voir [[a-b]].')] }));
  assert.equal(lien(e, 'brain', 'skill:a-b')?.titre, 'citée dans 1 note(s)');
  e = construireEtat(sources({ competences: comp, fichier, notes: [indexerNote('On a lancé a-b hier.')] }));
  assert.ok(lien(e, 'brain', 'skill:a-b'), 'un nom à tiret cité comme mot entier relie');
  e = construireEtat(sources({ competences: comp, fichier, notes: [indexerNote('le mot abc tout seul, et xa-by')] }));
  assert.equal(lien(e, 'brain', 'skill:abc'), undefined, 'sans tiret, un simple mot ne relie pas');
  assert.equal(lien(e, 'brain', 'skill:a-b'), undefined, 'a-b dans xa-by n\'est pas un mot entier');
  e = construireEtat(sources({ competences: comp, fichier, notes: [indexerNote('[[abc]] et [[mcp:GitHub]] et [[plugin:x]]')] }));
  assert.ok(lien(e, 'brain', 'skill:abc'));
  assert.ok(lien(e, 'brain', 'mcp:GitHub'));
  assert.ok(lien(e, 'brain', 'plugin:x'));
});

test('10. Soul : un compteur, aucun lien', () => {
  let e = construireEtat(sources({ soul: { etat: 'connu', extraitsCompetences: 7 } }));
  assert.equal(e.noeuds.find((n) => n.id === 'soul')?.sous, '7 extrait(s) des compétences dans son corpus');
  assert.equal(e.liens.some((l) => l.a === 'soul' || l.b === 'soul'), false);
  e = construireEtat(sources({ soul: { etat: 'inconnu', extraitsCompetences: 0 } }));
  assert.equal(e.soul.etat, 'inconnu');
  assert.equal(e.noeuds.find((n) => n.id === 'soul')?.sous, 'état de Soul inconnu');
});

test('11. slug identique à celui de l\'Interprète', () => {
  assert.equal(slugMcp('GitHub Pro'), 'github_pro');
  assert.equal(slugMcp('Été'), 'ete');
  for (const n of ['GitHub Pro', 'Été', 'a.b-c']) assert.ok(toolName(n, 'outil').startsWith(`mcp_${slugMcp(n)}_`));
});

test('12. adresse masquée', () => {
  assert.equal(adresseMasquee({ kind: 'http', url: 'https://u:p@h.example.org/x?key=abc#f' }), 'https://h.example.org/x');
  assert.equal(adresseMasquee({ kind: 'stdio', command: 'node', args: ['/chemin/privé/serveur.mjs', '--cle=zz'] }), 'node (2 argument(s))');
  assert.equal(adresseMasquee({ kind: 'http', url: 'pas une adresse' }), 'adresse illisible');
});

test('13. bornes : texte du serveur nettoyé et coupé', () => {
  const longue = `[MCP GitHub, description du serveur non vérifiée] ${'x\u0000y'.repeat(1700)}`;
  const o = outilsDuConnecteur('GitHub', [{ name: 'mcp_github_lire', description: longue }, { name: 'mcp_autre_x', description: 'autre' }]);
  assert.equal(o.length, 1);
  assert.equal(o[0].nom, 'lire');
  assert.ok(o[0].description.length <= 200);
  assert.equal(/[\u0000-\u001f]/.test(o[0].description), false);
  assert.equal(o[0].description.startsWith('[MCP'), false);
  assert.equal(nettoyer('a\u0007b', 10), 'a b');
});
