import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFlow, execute, readPath, resolve, type Deps, type Workflow } from '../src/draupnir/engine.ts';
import { CATALOG, parseFeed, test as cond } from '../src/draupnir/nodes.ts';
import { Draupnir, flowFromDescription, importN8n, templates } from '../src/draupnir/service.ts';

const scope = { $json: { a: { b: 2 }, 'é t': 'x', l: [1, 2] }, $node: { Avant: { json: { n: 5 }, items: [] } }, $now: '2026-11-11T10:00:00Z', $today: '2026-11-11', $index: 0, $items: [], $workflow: { id: 'w', name: 'W' } };

test('Draupnir : expressions par chemins seulement (pas de code)', () => {
  assert.equal(readPath('$json.a.b', scope), 2);
  assert.equal(readPath('$json["é t"]', scope), 'x');
  assert.equal(readPath('$node["Avant"].json.n', scope), 5);
  assert.equal(readPath('$json.l.length', scope), 2);
  assert.equal(readPath('$json.constructor', scope), undefined);
  assert.equal(readPath('process.exit()', scope), undefined);
  assert.equal(resolve('{{ $json.a.b }}', scope), 2, 'une expression seule garde son type');
  assert.equal(resolve('Le {{ $today }} : {{ $json.a }}', scope), 'Le 2026-11-11 : {"b":2}');
  assert.deepEqual(resolve({ x: ['{{ $json.l }}'] }, scope), { x: [[1, 2]] });
  assert.ok(cond('Urgent', 'contient', 'urg') && cond(3, 'plus grand que', 2) && cond('', 'vide', '') && !cond('x', 'vide', ''));
});

const deps = (over: Partial<Deps> = {}): Deps & { told: string[]; notes: Array<{ title: string; body: string }> } => {
  const told: string[] = [], notes: Array<{ title: string; body: string }> = [];
  return { told, notes, notify: async (t) => { told.push(t); }, ask: async (t) => `réponse à : ${t.slice(0, 40)}`, sleep: async () => {},
    saga: { search: (q) => [{ title: `Note ${q}`, path: 'n.md', snippet: '…', type: 'note' }], read: () => undefined, create: (title, _t, body) => { notes.push({ title, body }); return `Captures/${title}.md`; }, append: (n) => n, attention: () => [{ kind: 'retard', title: 'Payer', path: 't.md' }], rows: () => [{ path: 'a.md', title: 'A', meta: { statut: 'fait' } }, { path: 'b.md', title: 'B', meta: { statut: 'à faire' } }] }, ...over };
};

test('Draupnir : branches Si, aiguillage, données, Odin, Saga', async () => {
  const wf: Workflow = { id: 'w1', name: 'Test', active: false, nodes: [
    { id: '1', name: 'Go', type: 'déclencheur.manuel', params: {} },
    { id: '2', name: 'Liste', type: 'runes.lister', params: { base: 'tâche' } },
    { id: '3', name: 'Fait ?', type: 'logique.si', params: { valeur: '{{ $json.statut }}', opérateur: 'égal', comparer: 'fait' } },
    { id: '4', name: 'Résumé', type: 'odin.demander', params: { consigne: 'Reste : {{ $json.titre }}', pour: 'par élément', envoyer: 'oui' } },
    { id: '5', name: 'Garder', type: 'saga.écrire', params: { titre: 'Fini {{ $json.titre }}', contenu: 'ok' } },
    { id: '6', name: 'Tri', type: 'logique.aiguillage', params: { valeur: '{{ $json.titre }}', cas: 'A, Z' } },
  ], connections: { Go: [[{ node: 'Liste' }]], Liste: [[{ node: 'Fait ?' }, { node: 'Tri' }]], 'Fait ?': [[{ node: 'Garder' }], [{ node: 'Résumé' }]] } };
  assert.equal(checkFlow(wf, CATALOG), undefined);
  const d = deps();
  const ex = await execute(wf, CATALOG, d);
  assert.equal(ex.status, 'succès', ex.error);
  assert.deepEqual(d.notes, [{ title: 'Fini A', body: 'ok' }]);
  assert.deepEqual(d.told, ['réponse à : Reste : B']);
  assert.deepEqual(ex.nodes['Fait ?'].outputs, [1, 1]);
  assert.deepEqual(ex.nodes.Tri.outputs, [1, 0, 1], 'A → cas A ; B → autre');
});

test('Draupnir : erreur arrêtée et signalée, nouvelles tentatives', async () => {
  let calls = 0;
  const wf: Workflow = { id: 'w2', name: 'Web', active: false, settings: { retry: 2 }, nodes: [
    { id: '1', name: 'Go', type: 'déclencheur.manuel', params: {} },
    { id: '2', name: 'Appel', type: 'web.requête', params: { url: 'https://api.test/x', méthode: 'POST', corps: '{{ $json }}' } },
  ], connections: { Go: [[{ node: 'Appel' }]] } };
  const f = (async () => { calls++; return calls < 3 ? new Response('panne', { status: 503 }) : new Response('[{"id":1},{"id":2}]', { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  const ex = await execute(wf, CATALOG, deps({ fetch: f }), { items: [{ json: { a: 1 } }] });
  assert.equal(ex.status, 'succès'); assert.equal(calls, 3); assert.equal(ex.nodes.Appel.count, 2);
  const bad = await execute({ ...wf, settings: { retry: 0 } }, CATALOG, deps({ fetch: (async () => new Response('non', { status: 500 })) as unknown as typeof fetch }));
  assert.equal(bad.status, 'erreur'); assert.equal(bad.failedNode, 'Appel'); assert.match(bad.error!, /500/);
  assert.match(checkFlow({ name: 'x', nodes: [{ id: '1', name: 'a', type: 'logique.fin', params: {} }], connections: {} }, CATALOG)!, /déclencheur/);
  assert.match(checkFlow({ name: 'x', nodes: [{ id: '1', name: 'a', type: 'pirate', params: {} }], connections: {} }, CATALOG)!, /inconnu/);
});

test('Draupnir : rangement, webhook secret, Saga, flux (nouveautés seulement), page surveillée', async () => {
  const home = mkdtempSync(join(tmpdir(), 'draupnir-'));
  let feed = '<rss><channel><item><title>Un</title><link>https://b/1</link><guid>1</guid></item></channel></rss>', page = '<p>Prix 10 €</p>';
  const d = deps({ fetch: (async (u: string) => new Response(String(u).includes('flux') ? feed : page)) as unknown as typeof fetch });
  const dr = new Draupnir(home, d);
  try {
    const hook = dr.save({ name: 'Formulaire', active: true, nodes: [
      { id: '', name: 'Formulaire', type: 'déclencheur.webhook', params: { réponse: 'à la fin' } },
      { id: '', name: 'Ranger', type: 'saga.écrire', params: { titre: '{{ $json.nom }}', contenu: '{{ $json.message }}' } },
    ], connections: { Formulaire: [[{ node: 'Ranger' }]] } });
    const path = String(hook.nodes[0].params.chemin);
    assert.match(path, /^[\w-]{12,}$/, 'chemin secret généré');
    assert.equal((await dr.webhook('mauvais', {}, {}, 'POST')).status, 404);
    const r = await dr.webhook(path, { nom: 'Amina', message: 'Devis ?' }, {}, 'POST');
    assert.equal(r.status, 200); assert.deepEqual(d.notes.at(-1), { title: 'Amina', body: 'Devis ?' });
    assert.equal(dr.runs(hook.id)[0].status, 'succès');

    dr.save({ name: 'Tâche', active: true, nodes: [{ id: '', name: 'Créée', type: 'déclencheur.saga', params: { quand: 'créée', type: 'tâche' } }, { id: '', name: 'Dire', type: 'odin.prévenir', params: { texte: 'Nouvelle : {{ $json.titre }}' } }], connections: { Créée: [[{ node: 'Dire' }]] } });
    await dr.onSaga({ kind: 'créée', path: 'Tâches/x.md', title: 'Appeler', type: 'idée' });
    await dr.onSaga({ kind: 'créée', path: 'Tâches/y.md', title: 'Appeler', type: 'tâche' });
    assert.deepEqual(d.told, ['Nouvelle : Appeler']);

    const fl = dr.save({ name: 'Flux', active: false, nodes: [{ id: '', name: 'Nouveau', type: 'déclencheur.flux', params: { url: 'https://site/flux' } }, { id: '', name: 'Dire', type: 'odin.prévenir', params: { texte: '{{ $json.titre }}' } }], connections: { Nouveau: [[{ node: 'Dire' }]] } });
    dr.setActive(fl.id, true);
    assert.equal(await dr.poll(fl.id, 'Nouveau'), 0, 'première lecture : référence');
    feed = feed.replace('</channel>', '<item><title>Deux</title><link>https://b/2</link><guid>2</guid></item></channel>');
    assert.equal(await dr.poll(fl.id, 'Nouveau'), 1);
    assert.equal(d.told.at(-1), 'Deux');

    const pg = dr.save({ name: 'Prix', active: true, nodes: [{ id: '', name: 'Change', type: 'déclencheur.surveille', params: { url: 'https://site/page' } }, { id: '', name: 'Dire', type: 'odin.prévenir', params: { texte: '{{ $json.extrait }}' } }], connections: { Change: [[{ node: 'Dire' }]] } });
    assert.equal(await dr.poll(pg.id, 'Change'), 0); assert.equal(await dr.poll(pg.id, 'Change'), 0);
    page = '<p>Prix 8 €</p>';
    assert.equal(await dr.poll(pg.id, 'Change'), 1); assert.equal(d.told.at(-1), 'Prix 8 €');

    dr.trash(pg.id); assert.equal(dr.get(pg.id), undefined);
  } finally { dr.stop(); }
});

test('Draupnir : modèles valides, création par l\'IA, import n8n, flux RSS/Atom', async () => {
  for (const t of templates()) assert.equal(checkFlow({ id: 'x', active: false, ...t.flow, nodes: t.flow.nodes!.map((n, i) => ({ ...n, id: String(i) })) } as Workflow, CATALOG), undefined, t.id);
  let n = 0;
  const llm = async () => (++n === 1 ? '{"name":"x","nodes":[{"name":"a","type":"inventé"}]}' : '```json\n{"name":"Veille","nodes":[{"name":"Matin","type":"déclencheur.planning","params":{"cron":"0 8 * * *"}},{"name":"Dire","type":"odin.prévenir","params":{"texte":"Bonjour"}}],"connections":{"Matin":[[{"node":"Dire"}]]}}\n```');
  const wf = await flowFromDescription(llm, 'chaque matin dis bonjour');
  assert.equal(n, 2, 'une correction après refus'); assert.equal(wf.active, false); assert.equal(wf.nodes!.length, 2);
  const imp = importN8n({ name: 'N8N', nodes: [{ name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1' }] } } }, { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://x' } }, { name: 'Slack', type: 'n8n-nodes-base.slack' }], connections: { Cron: { main: [[{ node: 'HTTP' }]] }, HTTP: { main: [[{ node: 'Slack' }]] } } });
  assert.deepEqual(imp.flow.nodes!.map((x) => x.type), ['déclencheur.planning', 'web.requête', 'logique.fin']);
  assert.deepEqual(imp.todo, ['Slack (slack)']);
  assert.equal(imp.flow.nodes![0].params.cron, '0 9 * * 1');
  assert.deepEqual(parseFeed('<feed><entry><title>A &amp; B</title><link href="https://y"/><id>z</id></entry></feed>'), [{ titre: 'A & B', lien: 'https://y', date: '', résumé: '', id: 'z' }]);
});

test('Draupnir : fusion de branches, comparaison, résumé, dates, HTML, conversions, code isolé', async () => {
  const { htmlSelect, xmlToJson, mdToHtml, fmtDate } = await import('../src/draupnir/nodes.ts');
  const wf: Workflow = { id: 'm', name: 'Fusion', active: false, nodes: [
    { name: 'Go', type: 'déclencheur.manuel', params: {} },
    { name: 'A', type: 'données.définir', params: { champs: '{ "id": 1, "a": "x" }' } },
    { name: 'B', type: 'données.définir', params: { champs: '{ "id": 1, "b": "y" }', garder: false } },
    { name: 'Joindre', type: 'logique.fusionner', params: { mode: 'par champ', champ: 'id' } },
    { name: 'Compte', type: 'données.résumer', params: { opération: 'compter' } },
  ], connections: { Go: [[{ node: 'A' }, { node: 'B' }]], A: [[{ node: 'Joindre', input: 0 }]], B: [[{ node: 'Joindre', input: 1 }]], Joindre: [[{ node: 'Compte' }]] } };
  const ex = await execute(wf, CATALOG, deps());
  assert.equal(ex.status, 'succès', ex.error);
  assert.deepEqual(ex.nodes.Joindre.items, [{ id: 1, a: 'x', b: 'y' }], 'attend les deux branches puis joint');
  assert.equal(ex.nodes.Joindre.count, 1, 'une seule exécution du nœud de fusion');
  assert.deepEqual(ex.nodes.Compte.items, [{ compter: 1 }]);
  assert.deepEqual(htmlSelect('<ul><li class="p">Un <b>1</b></li><li class="p">Deux</li></ul><a href="/x">l</a>', 'li.p'), ['Un 1', 'Deux']);
  assert.deepEqual(htmlSelect('<a href="/x">l</a><a href="/y">m</a>', 'a@href'), ['/x', '/y']);
  assert.deepEqual(xmlToJson('<r><i>1</i><i>2</i><t>A &amp; B</t></r>'), { r: { i: ['1', '2'], t: 'A & B' } });
  assert.equal(mdToHtml('# T\n- **a**\n- b'), '<h1>T</h1>\n<ul>\n<li><strong>a</strong></li>\n<li>b</li>\n</ul>');
  assert.equal(fmtDate(new Date(2026, 10, 11, 7, 5), 'JJ/MM/AAAA HH:mm'), '11/11/2026 07:05');
  const code = await execute({ id: 'c', name: 'Code', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }, { name: 'Calcul', type: 'données.code', params: { code: 'return $input.all().map((x) => ({ total: x.prix * 2 }))' } }], connections: { Go: [[{ node: 'Calcul' }]] } }, CATALOG, { ...deps(), code: (await import('../src/draupnir/code.ts')).runCode }, { items: [{ json: { prix: 21 } }] });
  assert.deepEqual(code.nodes.Calcul.items, [{ total: 42 }]);
  const evil = await execute({ id: 'e', name: 'Code', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }, { name: 'Lire', type: 'données.code', params: { code: 'const fs = await import("node:fs"); return fs.readFileSync("/etc/hostname", "utf8")' } }], connections: { Go: [[{ node: 'Lire' }]] } }, CATALOG, { ...deps(), code: (await import('../src/draupnir/code.ts')).runCode });
  assert.equal(evil.status, 'erreur'); assert.match(evil.error!, /restricted|restreint|permission/i);
});

test('Draupnir : sous-automatisation, automatisation d\'erreur, formulaire, versions, exécuter jusqu\'ici', async () => {
  const home = mkdtempSync(join(tmpdir(), 'draupnir2-'));
  const d = deps();
  const dr = new Draupnir(home, d);
  try {
    dr.save({ name: 'Doubler', active: true, nodes: [{ name: 'Appel', type: 'déclencheur.appel', params: {} }, { name: 'Calcul', type: 'données.définir', params: { champs: '{ "double": "{{ $json.n }}{{ $json.n }}" }' } }], connections: { Appel: [[{ node: 'Calcul' }]] } });
    const main = dr.save({ name: 'Principal', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }, { name: 'Sous', type: 'flux.exécuter', params: { automatisation: 'Doubler' } }, { name: 'Casse', type: 'logique.erreur', params: { message: 'stop {{ $json.double }}' } }], connections: { Go: [[{ node: 'Sous' }]], Sous: [[{ node: 'Casse' }]] } });
    dr.save({ name: 'Alerte', active: true, nodes: [{ name: 'Échec', type: 'déclencheur.erreur', params: {} }, { name: 'Dire', type: 'odin.prévenir', params: { texte: '{{ $json.automatisation }} / {{ $json.étape }} / {{ $json.erreur }}' } }], connections: { Échec: [[{ node: 'Dire' }]] } });
    const partial = await dr.run(main.id, [{ json: { n: 4 } }], 'manuel', undefined, { stopAfter: 'Sous' });
    assert.equal(partial.status, 'succès'); assert.deepEqual(partial.nodes.Sous.items, [{ n: 4, double: '44' }]); assert.equal(partial.nodes.Casse, undefined);
    const ex = await dr.run(main.id, [{ json: { n: 4 } }], 'déclencheur');
    assert.equal(ex.error, 'stop 44');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(d.told.includes('Principal / Casse / stop 44'), d.told.join('|'));
    const pinned = await dr.run(main.id, [], 'test', undefined, { pinned: { Sous: [{ double: 'épinglé' }] }, stopAfter: 'Sous' });
    assert.deepEqual(pinned.nodes.Sous.items, [{ double: 'épinglé' }]);

    const f = dr.save({ name: 'Contact', active: true, nodes: [{ name: 'Formulaire', type: 'déclencheur.formulaire', params: { titre: 'Contact', champs: 'Nom*\nEmail* (email)\nSujet (choix: devis|autre)\nMessage (long)' } }, { name: 'Ranger', type: 'saga.écrire', params: { titre: '{{ $json.nom }}', contenu: '{{ $json.sujet }}' } }], connections: { Formulaire: [[{ node: 'Ranger' }]] } });
    const path = String(f.nodes[0].params.chemin);
    assert.deepEqual(dr.form(path)!.fields.map((x) => [x.key, x.kind, x.required]), [['nom', 'text', true], ['email', 'email', true], ['sujet', 'choix', false], ['message', 'long', false]]);
    assert.match((await dr.submitForm(path, { nom: 'A' })).error!, /Email/);
    assert.match((await dr.submitForm(path, { nom: 'A', email: 'pas-un-mail' })).error!, /invalide/);
    assert.equal((await dr.submitForm(path, { nom: 'Amina', email: 'a@b.fr', sujet: 'devis' })).ok, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(d.notes.at(-1), { title: 'Amina', body: 'devis' });

    dr.save({ ...f, name: 'Contact v2' });
    const v = dr.versions(f.id); assert.equal(v.length, 1); assert.equal(v[0].name, 'Contact');
    assert.equal(dr.restore(f.id, v[0].at).name, 'Contact');
  } finally { dr.stop(); }
});
