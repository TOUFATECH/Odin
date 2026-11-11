import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractLinks, extractTags, formatNote, parseNote, safeName, seedVault, sourceOf, Vault } from '../src/brain/vault.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'odin-cerveau-'));

test('format Obsidian : propriétés, liens, étiquettes, aller-retour', () => {
  const t = '---\ntype: projet\nstatut: en cours\ntags: [barber, site]\npriorité: 2\naliases:\n  - OQG\n---\n# Site\nVoir [[Amina]] et [[Réunion du 3|la réunion]], ![[logo.png]] #web #2026 ```\n[[pas-un-lien]]\n```';
  const { meta, body } = parseNote(t);
  assert.deepEqual(meta, { type: 'projet', statut: 'en cours', tags: ['barber', 'site'], 'priorité': 2, aliases: ['OQG'] });
  assert.deepEqual(extractLinks(body), ['Amina', 'Réunion du 3', 'logo.png']);
  assert.deepEqual(extractTags(body, meta), ['barber', 'site', 'web']);
  assert.deepEqual(parseNote(formatNote(meta, body)).meta, meta);
  assert.equal(safeName('Plan: v2 / final?'), 'Plan v2 final');
  assert.equal(sourceOf({ meta: { source: 'https://www.youtube.com/watch?v=x' } }), 'YouTube');
  assert.equal(sourceOf({ meta: { source: 'telegram' } }), 'Telegram');
});

test('coffre : créer, relier, rétroliens, mentions, renommer (les liens suivent), corbeille', () => {
  const dir = tmp();
  try {
    const v = new Vault(dir);
    const p = v.create('Site OQG', 'projet', 'Refonte avec [[Amina]].\n\n## Objectifs\n\n## Décisions\n');
    assert.equal(p, 'Projets/Site OQG.md');
    v.create('Amina', 'personne', 'Gère les réservations.');
    v.write('Idée vitrine', {}, 'Mettre des vidéos sur le Site OQG, demander à Amina.');
    assert.deepEqual(v.backlinks('Amina').map((n) => n.path), ['Projets/Site OQG.md']);
    assert.deepEqual(v.unlinkedMentions('Site OQG').map((n) => n.path), ['Idée vitrine.md']);
    v.projectMemory('Site OQG', 'décision', 'Stripe pour les tresses');
    assert.match(v.read('Site OQG')!.body, /## Décisions\n- \d{4}-\d{2}-\d{2} · Stripe pour les tresses\n/);
    const r = v.rename('Personnes/Amina.md', 'Personnes/Amina Saïd.md');
    assert.match(r, /liens mis à jour dans 1 note/);
    assert.match(readFileSync(join(dir, 'Projets/Site OQG.md'), 'utf8'), /\[\[Amina Saïd\]\]/);
    v.trash('Idée vitrine');
    assert.equal(v.find('Idée vitrine'), undefined);
    assert.equal(v.trashed().length, 1);
    v.restore(v.trashed()[0]);
    assert.ok(v.find('Idée vitrine'));
    assert.throws(() => v.abs('../../etc/passwd'), /hors du Cerveau/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('graphe : liens écrits, liens devinés (mentions, étiquettes), connecteurs', () => {
  const dir = tmp();
  try {
    const v = new Vault(dir);
    v.write('Alpha', {}, 'Lien vers [[Bravo]] #rare');
    v.write('Bravo', {}, 'Rien');
    v.write('Charlie', {}, 'On parle de bravo ici. #rare');
    v.write('Captures/Vidéo', { type: 'capture', source: 'https://youtu.be/x' }, 'résumé');
    const g = v.graph();
    const kinds = (a: string, b: string) => g.edges.filter((e) => [e.from, e.to].sort().join() === [a, b].sort().join()).map((e) => e.kind);
    assert.deepEqual(kinds('Alpha.md', 'Bravo.md'), ['lien']);
    assert.deepEqual(kinds('Charlie.md', 'Bravo.md'), ['mention']);
    assert.deepEqual(kinds('Alpha.md', 'Charlie.md'), ['étiquette']);
    assert.ok(g.nodes.some((n) => n.id === 'source:YouTube' && n.type === 'connecteur'));
    assert.deepEqual(kinds('Captures/Vidéo.md', 'source:YouTube'), ['source']);
    const local = v.graph({ center: 'Bravo', depth: 1 });
    assert.deepEqual(local.nodes.map((n) => n.id).sort(), ['Alpha.md', 'Bravo.md', 'Charlie.md']);
    assert.equal(v.stats().links, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recherche, bases, journal, accueil et reprise des anciennes fiches', () => {
  const dir = tmp(), old = tmp();
  try {
    writeFileSync(join(old, 'installer-nas.md'), '# NAS\nÉtapes pour le NAS Synology.');
    const v = new Vault(dir);
    assert.equal(seedVault(v, old), 2);
    assert.ok(v.find('Fiches/installer-nas'));
    v.create('Lancer la boutique', 'projet', 'Boutique en ligne pour les tondeuses.');
    v.create('Appeler le comptable', 'tâche');
    const s = v.search('tondeuse boutique');
    assert.equal(s[0].note.title, 'Lancer la boutique');
    assert.match(s[0].snippet, /tondeuses/);
    assert.equal(v.database('projet').length, 1);
    assert.equal(v.database('tâche')[0].meta.statut, 'à faire');
    const d = v.daily(new Date(2026, 10, 11));
    assert.equal(d, 'Journal/2026-11-11.md');
    assert.ok(existsSync(join(dir, d)));
    mkdirSync(join(dir, '.obsidian')); writeFileSync(join(dir, '.obsidian', 'x.md'), 'interne');
    assert.ok(!v.all(true).some((n) => n.path.startsWith('.obsidian')));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(old, { recursive: true, force: true }); }
});

test('outils du Cerveau : n\'importe quelle IA capture, retrouve, retient les décisions et cite ses sources', async () => {
  const { makeOdin, call } = await import('./helpers.ts');
  const o = makeOdin([
    call('cerveau_projet', { projet: 'Boutique', quoi: 'décision', texte: 'Livraison gratuite dès 50 €' }), { text: 'Retenu.' },
    call('cerveau_capturer', { source: 'Kits de tresses enfants', projet: 'Boutique' }), { text: 'Capturé.' },
    call('cerveau_chercher', { question: 'livraison gratuite' }), { text: 'D\'après [[Boutique]] : dès 50 €.' },
  ]);
  try {
    await o.agent.run('On a décidé la livraison gratuite dès 50 € pour la boutique', { sessionId: 's' });
    await o.agent.run('Garde cette idée : vendre des kits de tresses pour enfants', { sessionId: 's' });
    const r = await o.agent.run('Qu\'est-ce que j\'ai décidé pour la livraison ?', { sessionId: 's' });
    const toolOut = o.provider.calls.at(-1)!.messages.findLast((m) => m.role === 'tool')?.content ?? '';
    assert.match(toolOut, /\[\[Boutique\]\] \(Projets\/Boutique\.md, projet/);
    assert.match(r.text, /\[\[Boutique\]\]/);
    const { brainOf } = await import('../src/tools/brain.ts');
    const v = brainOf({ home: o.paths.home, workspace: o.paths.workspace });
    assert.match(v.read('Boutique')!.body, /## Décisions\n- \d{4}-\d{2}-\d{2} · Livraison gratuite dès 50 €/);
    const cap = v.database('capture');
    assert.equal(cap.length, 1);
    assert.match(v.read('Boutique')!.body, /Capture : \[\[/);
    assert.ok(v.find(v.daily()));
    // Les consignes du Cerveau sont dans le prompt de toute IA.
    assert.match(o.provider.calls[0].system, /TON DEUXIÈME CERVEAU/);
  } finally { o.cleanup(); }
});
