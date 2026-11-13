import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../src/brain/vault.ts';
import { formula } from '../src/runes/formula.ts';
import { Papyrus } from '../src/runes/runes.ts';

test('Papyrus : formules sûres', () => {
  const p = (n: string) => (({ Prix: 12.5, Quantité: 4, Statut: 'fait', Échéance: '2026-11-20' }) as Record<string, string | number>)[n] ?? null;
  const now = new Date('2026-11-11T10:00:00Z');
  assert.equal(formula('prop("Prix") * prop("Quantité")', p), 50);
  assert.equal(formula('si(prop("Statut") == "fait", "✓", "…")', p), '✓');
  assert.equal(formula('concat("J-", jours(prop("Échéance"), aujourdhui()))', p, now), 'J-9');
  assert.equal(formula('arrondi(10 / 3, 2)', p), 3.33);
  assert.equal(formula('prop("Prix") > 10 et non vide(prop("Statut"))', p), true);
  assert.match(String(formula('process.exit()', p)), /^⚠/);
  assert.match(String(formula('constructor("x")', p)), /fonction inconnue/);
});

test('Papyrus : base typée, vues (tableau, calendrier, filtres, tris), formules, agrégations, automatisations, CSV, sous-pages, historique', () => {
  const v = new Vault(mkdtempSync(join(tmpdir(), 'runes-')));
  const r = new Papyrus(v);
  assert.ok(r.bases().some((b) => b.id === 'tâche' && b.views.some((x) => x.type === 'tableau')), 'bases par défaut issues de Thot');
  const clients = r.createBase('Clients', [{ label: 'Ville', type: 'sélection' }, { label: 'Code', type: 'id', prefix: 'CL-' }]);
  const cmd = r.createBase('Commandes', [
    { label: 'Statut', type: 'statut' }, { label: 'Date', type: 'date' }, { label: 'Prix', type: 'nombre' }, { label: 'Quantité', type: 'nombre' },
    { label: 'Total', type: 'formule', formula: 'prop("Prix") * prop("Quantité")' }, { label: 'Client', type: 'relation', relation: 'clients' },
  ]);
  assert.equal(cmd.folder, 'Bases/Commandes');
  const a = r.addRow('clients', 'Amina', { ville: 'Mamoudzou' });
  r.addRow('clients', 'Bacar', { ville: 'Dzaoudzi' });
  assert.equal(v.find(a)!.meta.code, 'CL-1', 'identifiant unique automatique');
  r.addRow('commandes', 'iPhone', { prix: 900, quantite: 2, date: '2026-11-20', client: 'Amina' });
  r.addRow('commandes', 'Starlink', { prix: 450, quantite: 1, date: '2026-11-05', client: 'Amina', statut: 'fait' });
  assert.throws(() => r.addRow('commandes', 'X', { prix: 'beaucoup' }), /nombre/);
  r.addProp('clients', { label: 'CA', type: 'agrégation', rollup: { relation: 'commandes', prop: 'total', calc: 'somme' } });
  // L'agrégation va de Clients vers Commandes : il faut une relation côté Clients.
  r.addProp('clients', { label: 'Commandes', type: 'relation', relation: 'commandes' });
  r.updateRow(a, { commandes: 'iPhone, Starlink' }, 'clients');
  r.renameProp('clients', 'ca', 'Chiffre d\'affaires');
  const amina = r.rows('clients').find((x) => x.title === 'Amina')!;
  assert.equal(amina.values.chiffre_d_affaires, 2250, '900×2 + 450');
  const rows = r.rows('commandes');
  assert.equal(rows.find((x) => x.title === 'iPhone')!.values.total, 1800);
  const board = r.query('commandes', 'tableau');
  assert.deepEqual(board.groups!.map((g) => [g.name, g.rows.length]), [['à faire', 1], ['en cours', 0], ['fait', 1]]);
  assert.deepEqual(Object.keys(r.query('commandes', 'calendrier').days!).sort(), ['2026-11-05', '2026-11-20']);
  r.saveView('commandes', { id: 'cher', name: 'Grosses commandes', type: 'table', filters: [{ prop: 'total', op: 'plus grand que', value: '1000' }], sorts: [{ prop: 'total', dir: 'desc' }] });
  assert.deepEqual(r.query('commandes', 'cher').rows.map((x) => x.title), ['iPhone']);
  assert.deepEqual(r.query('commandes', 'table', {}, new Date('2026-11-11')).rows.length, 2);
  r.saveView('commandes', { id: 'retard', name: 'En retard', type: 'liste', filters: [{ prop: 'date', op: 'en retard' }] });
  assert.deepEqual(r.query('commandes', 'retard', {}, new Date('2026-11-11')).rows.map((x) => x.title), ['Starlink']);
  // Automatisation de base : quand le statut passe à « fait », la date de fin est remplie.
  r.updateBase('commandes', { automations: [{ id: 'a1', when: { prop: 'statut', to: 'fait' }, then: { kind: 'définir', prop: 'livré', value: 'oui' } }, { id: 'a2', when: { prop: 'statut', to: 'fait' }, then: { kind: 'prévenir', text: 'Commande livrée' } }] });
  const iphone = rows.find((x) => x.title === 'iPhone')!.path;
  const u = r.updateRow(iphone, { statut: 'fait' });
  assert.equal(u.fired.length, 2); assert.equal(v.find(iphone)!.meta.livré, 'oui');
  assert.equal(r.updateRow(iphone, { statut: 'fait' }).fired.length, 0, 'pas de changement : rien ne se déclenche');
  assert.equal(r.history(iphone).length, 2);
  r.restoreVersion(iphone, r.history(iphone).at(-1)!.at);
  assert.equal(v.find(iphone)!.meta.statut, 'à faire');
  const csv = r.exportCsv('commandes');
  assert.match(csv.split('\n')[0], /^Nom,Statut,Date,Prix,Quantité,Total,Client$/);
  const n = r.importCsv('clients', 'Nom;Ville;Téléphone\nChamsia;Sada;0639\n"Dupont; fils";Mamoudzou;');
  assert.equal(n, 2); assert.ok(r.base('clients').props.some((p) => p.label === 'Téléphone'));
  const page = v.create('Studio Vidéo IA', 'projet');
  const child = r.childPage(page, 'Plan de lancement', '## Étapes');
  assert.equal(child, 'Projets/Studio Vidéo IA/Plan de lancement.md');
  assert.deepEqual(r.children(page).map((c) => c.title), ['Plan de lancement']);
  r.comment(child, 'Odin', 'À relire');
  assert.equal(r.comments(child).length, 1);
});
