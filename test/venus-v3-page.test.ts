// Vénus, lot V3 (la page) : les filtres « Genres » et « Note minimale » et le tri « Note moyenne » de Browse.js, laissés
// « bientôt » par le lot V1, marchent sur les genres et les notes des fiches ; un titre sans fiche n'est pas inventé
// dans un genre ni une note. La page ne contient aucune adresse extérieure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
function logique(): Record<string, Fn> {
  const ctx = vm.createContext({ window: {}, URLSearchParams, Intl });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  return (ctx.window as { VenusApp: { L: Record<string, Fn> } }).VenusApp.L;
}
const items = [
  { id: 'a', title: 'Brume', category: 'movie', year: 2021, added: 3, status: 'unseen', genres: ['Drame', 'Science-fiction'], critics: 7.4 },
  { id: 'b', title: 'Aube', category: 'movie', year: 1999, added: 1, status: 'seen', genres: ['Comédie'], vote: 6.2 },
  { id: 'c', title: 'Cendre', category: 'movie', added: 2, status: 'unseen', genres: ['Drame'], vote: 8.3 },
  { id: 'd', title: 'Sans fiche', category: 'movie', added: 4, status: 'unseen' },
];
const f = (x: Record<string, unknown>) => ({ sort: 'added', desc: false, status: 'all', genres: [], decades: [], quality: [], minScore: '', ...x });
const ids = (l: unknown) => ici((l as Array<{ id: string }>).map((x) => x.id));

test('filtre Genres : les genres des fiches, un titre sans fiche n\'entre dans aucun genre', () => {
  const L = logique();
  assert.deepEqual(ici(L.genresDe(items)), ['Comédie', 'Drame', 'Science-fiction']);
  assert.deepEqual(ids(L.shown(items, f({ genres: ['Drame'] }))), ['a', 'c']);
  assert.deepEqual(ids(L.shown(items, f({ genres: ['Drame', 'Comédie'] }))), ['a', 'c', 'b']);
  assert.deepEqual(ids(L.shown(items, f({}))), ['d', 'a', 'c', 'b'], 'sans filtre : tout, comme avant');
});

test('Note minimale et tri « Note moyenne » : la note du public, sinon celle des critiques ; aucune note inventée', () => {
  const L = logique();
  assert.deepEqual(ids(L.shown(items, f({ minScore: '70' }))), ['a', 'c']);
  assert.deepEqual(ids(L.shown(items, f({ minScore: '80' }))), ['c']);
  assert.deepEqual(ids(L.shown(items, f({ sort: 'score' }))), ['c', 'a', 'b', 'd'], 'mieux notés d\'abord, sans note à la fin');
  assert.deepEqual(ids(L.shown(items, f({ sort: 'score', desc: true }))), ['d', 'b', 'a', 'c']);
  assert.equal(L.note(items[3]), 0);
  // Les anciens réglages de filtre (sans genres ni note, gardés par le lot V1) marchent encore.
  assert.deepEqual(ids(L.shown(items, { sort: 'az', desc: false, status: 'all', decades: [], quality: [] })), ['b', 'a', 'c', 'd']);
});

test('la page ne charge rien d\'Internet : aucune adresse extérieure dans son code', () => {
  // (Le seul « https:// » du code est un exemple d'adresse de source tapée par le propriétaire, dans un texte d'aide.)
  assert.ok(!/(src|href)=["'`]?https?:|url\(\s*["']?https?:|fetch\(\s*["'`]https?:/.test(SRC.app), 'aucune image, aucun lien ni aucune lecture d\'une adresse extérieure');
  assert.equal((SRC.app.match(/https?:\/\//g) ?? []).length, 1);
  assert.match(SRC.app, /data-act="person"/, 'la distribution ouvre la fiche d\'une personne');
  assert.match(SRC.app, /\/venus\/api\/personne\//);
});
