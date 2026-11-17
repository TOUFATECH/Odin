// Talos, la page des dossiers (src/web/pages/talos-dossiers.js) : ordre et compteurs des onglets, contenu de chaque
// onglet, mêmes refus de nom que le serveur, choix proposé au premier enregistrement, onglet rouvert.
// Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { validerNomDossier, type Dossier } from '../src/draupnir/dossiers.ts';

type Onglet = { id: string; nom: string; nombre: number; fixe: boolean };
type W = { id: string; name: string; active: boolean; dossier?: string };
interface Logique {
  RESERVES: string[];
  onglets: (st: unknown) => Onglet[];
  filtrer: (flows: W[], onglet: string) => W[];
  validerNom: (nom: string, dossiers: Array<{ id: string; nom: string }>, sauf?: string) => string;
  choixParDefaut: (onglet: string, dossiers?: Array<{ id: string }>) => { dossier: string; etat: string };
  ongletInitial: (garde: string, onglets: Onglet[]) => string;
  texteProposition: (liste: Array<{ active: boolean }>) => string;
}
const source = readFileSync(new URL('../src/web/pages/talos-dossiers.js', import.meta.url), 'utf8');
function charger(): Logique {
  const win: { OdinTalosDossiers?: { logique: Logique; monter: unknown; choisir: unknown; barre: unknown } } = {};
  vm.runInNewContext(source, { window: win });
  assert.ok(win.OdinTalosDossiers, 'window.OdinTalosDossiers est posé');
  for (const f of ['monter', 'choisir', 'barre'] as const) assert.equal(typeof win.OdinTalosDossiers[f], 'function', f);
  return win.OdinTalosDossiers.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

const FLOWS: W[] = [
  { id: 'a', name: 'A', active: true, dossier: 'd-maison01' },
  { id: 'b', name: 'B', active: false, dossier: 'd-maison01' },
  { id: 'c', name: 'C', active: true },
  { id: 'd', name: 'D', active: false, dossier: 'd-reseau01' },
  { id: 'e', name: 'E', active: false },
];
const ST = { ok: true, flows: FLOWS, dossiers: [{ id: 'd-reseau01', nom: 'Réseau', nombre: 1 }, { id: 'd-maison01', nom: 'Maison', nombre: 2 }], corbeille: 3 };

test('onglets : Actives, Brouillons, les dossiers dans l\'ordre de création, Corbeille, avec leurs compteurs', () => {
  const L = charger();
  assert.deepEqual(ici(L.onglets(ST)), [
    { id: 'actives', nom: 'Actives', nombre: 2, fixe: true },
    { id: 'brouillons', nom: 'Brouillons', nombre: 3, fixe: true },
    { id: 'd-reseau01', nom: 'Réseau', nombre: 1, fixe: false },
    { id: 'd-maison01', nom: 'Maison', nombre: 2, fixe: false },
    { id: 'corbeille', nom: 'Corbeille', nombre: 3, fixe: true },
  ]);
  assert.deepEqual(ici(L.onglets({ ok: true, flows: [] }).map((o) => o.id)), ['actives', 'brouillons', 'corbeille'], 'ancien serveur sans dossiers');
});

test('filtrer : Actives et Brouillons tous dossiers confondus ; un dossier garde les deux états', () => {
  const L = charger();
  assert.deepEqual(ici(L.filtrer(FLOWS, 'actives').map((w) => w.id)), ['a', 'c']);
  assert.deepEqual(ici(L.filtrer(FLOWS, 'brouillons').map((w) => w.id)), ['b', 'd', 'e']);
  assert.deepEqual(ici(L.filtrer(FLOWS, 'd-maison01').map((w) => w.id)), ['a', 'b']);
  assert.deepEqual(ici(L.filtrer(FLOWS, 'corbeille').map((w) => w.id)), []);
  assert.deepEqual(ici(L.filtrer(FLOWS, 'd-inconnu1').map((w) => w.id)), []);
});

test('validerNom : les mêmes refus, aux mêmes mots, que le serveur', () => {
  const L = charger();
  const dossiers: Dossier[] = [{ id: 'd-secu0001', nom: 'Sécurité', cree: '' }];
  const serveur = (nom: string, sauf?: string) => { try { validerNomDossier(nom, dossiers, sauf); return ''; } catch (e) { return (e as Error).message; } };
  const cas = ['', '   ', 'x'.repeat(41), 'é'.repeat(40), 'a/b', 'a\\b', 'a<b', 'a>b', 'a​b', 'a\u0007b', 'corbeille', 'ACTIVES', 'Brouillons', 'sécurité', 'SÉCURITÉ', 'Securite', '  Mon   dossier ', 'Ｓécurité', 'می‌خواهم', '👨‍👩‍👧 Famille', 'a‮b'];
  assert.equal(L.validerNom('می‌خواهم', []), '', 'l\'antiliant sans chasse est permis (persan)');
  for (const nom of cas) assert.equal(L.validerNom(nom, dossiers), serveur(nom), `nom ${JSON.stringify(nom)}`);
  assert.equal(L.validerNom('Sécurité', dossiers, 'd-secu0001'), '', 'son propre nom n\'est pas un doublon');
  assert.equal(L.validerNom('', []), 'nom vide');
  assert.equal(L.validerNom('x'.repeat(41), []), 'nom trop long (40 caractères au plus)');
  assert.equal(L.validerNom('Corbeille', []), 'nom réservé');
  assert.equal(L.validerNom('sécurité', dossiers), 'ce dossier existe déjà');
  assert.equal(L.validerNom('a/b', []), 'caractère interdit dans le nom');
});

test('choixParDefaut : le dossier ouvert juste avant, sinon aucun ; toujours en brouillon', () => {
  const L = charger();
  assert.deepEqual(ici(L.choixParDefaut('d-maison01')), { dossier: 'd-maison01', etat: 'brouillon' });
  assert.deepEqual(ici(L.choixParDefaut('d-maison01', ST.dossiers)), { dossier: 'd-maison01', etat: 'brouillon' });
  assert.deepEqual(ici(L.choixParDefaut('d-parti001', ST.dossiers)), { dossier: '', etat: 'brouillon' }, 'dossier supprimé entre-temps');
  for (const o of ['actives', 'brouillons', 'corbeille', '', '../x']) assert.deepEqual(ici(L.choixParDefaut(o)), { dossier: '', etat: 'brouillon' }, o);
});

test('ongletInitial : l\'onglet gardé s\'il existe encore, sinon Actives', () => {
  const L = charger(), o = L.onglets(ST);
  assert.equal(L.ongletInitial('d-maison01', o), 'd-maison01');
  assert.equal(L.ongletInitial('corbeille', o), 'corbeille');
  assert.equal(L.ongletInitial('d-supprime', o), 'actives');
  assert.equal(L.ongletInitial('', o), 'actives');
});

test('proposition des automatisations de départ : le compte des actives et des brouillons', () => {
  const L = charger();
  assert.equal(L.texteProposition([{ active: true }, { active: true }, { active: false }]), 'Odin propose 3 automatisations de départ, rangées par dossier : 2 tourneront seules (des bilans qui ne t\'écrivent que si c\'est utile), 1 restent en brouillon.');
});

test('la page : titre « Workflow » au-dessus des onglets, rangée qui défile seule, cibles de 44 px, couleurs par variables', () => {
  assert.match(source, /el\('h2', \{ class: 'td-titre'[^)]*\}, 'Workflow'\)[\s\S]{0,40}el\('div', \{ class: 'td-rangee' \}/, 'le titre vient juste avant la rangée d\'onglets');
  const cssOnglets = /\.td-onglets\{[^}]*\}/.exec(source)?.[0] ?? '';
  for (const r of ['overflow-x:auto', 'flex-wrap:nowrap', 'min-width:0']) assert.ok(cssOnglets.includes(r), r);
  assert.match(source, /\.td-onglets button\{[^}]*min-height:44px/);
  // La Corbeille, au bout de la rangée, ne se cache jamais : la rangée passe à la ligne sur grand écran, et sur
  // téléphone un fondu à droite dit qu'il reste des onglets.
  assert.match(source, /@media \(min-width:701px\)\{\.td-onglets\{flex-wrap:wrap;overflow-x:visible\}/);
  assert.match(source, /\.td-onglets\.td-suite\{[^}]*mask-image:linear-gradient/);
  assert.match(source, /classList\.toggle\('td-suite'/);
  assert.match(source, /\.td-onglets button\{[^}]*max-width:180px/);
  assert.match(source, /\.td-panneau \.dr-row \.btn\.small[^{]*\{min-height:44px\}/);
  const css = /const css = `([\s\S]*?)`;/.exec(source)?.[1] ?? '';
  assert.ok(css.length > 500);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'aucune couleur écrite en dur');
  // La confirmation existante avant d'activer, mot pour mot comme flows.js.
  assert.ok(source.includes('Activer « ${w.name} » ? Elle agira seule ensuite.'));
  assert.ok(source.includes('Activer « ${wf.name} » ? Elle agira seule ensuite.'));
});
