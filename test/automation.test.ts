import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkWorkflow, createWorkflow, hookToken, listWorkflows, n8nStatus, setActive, templates } from '../src/automation/n8n.ts';
import { handleHook, hookAllowed } from '../src/automation/bridge.ts';
import { blocksToMd, mdToBlocks, richToMd } from '../src/tools/notion.ts';
import { Vault } from '../src/brain/vault.ts';
import { brainOf } from '../src/tools/brain.ts';
import { makeOdin } from './helpers.ts';

test('modèles d\'automatisation : tous valides, tous reliés à Odin par la clé dédiée', () => {
  const list = templates('https://host.docker.internal:7777', 'CLE');
  assert.equal(list.length, 6);
  for (const t of list) {
    assert.equal(checkWorkflow(structuredClone(t.wf)), undefined, t.id);
    const odin = t.wf.nodes!.filter((n) => n.type === 'n8n-nodes-base.httpRequest' && String(n.parameters?.url).endsWith('/api/hook'));
    for (const n of odin) assert.equal((n.parameters!.headerParameters as { parameters: Array<{ value: string }> }).parameters[0].value, 'CLE');
  }
  assert.match(checkWorkflow({ name: 'x', nodes: [{ name: 'a', type: 'n8n-nodes-base.set' }], connections: {} })!, /déclencheur/);
  assert.match(checkWorkflow({ name: 'x', nodes: [{ name: 'a', type: 'evil.node' }], connections: {} })!, /type de nœud inconnu/);
  assert.match(checkWorkflow({ name: 'x', nodes: [{ name: 'a', type: 'n8n-nodes-base.webhook' }], connections: { a: { main: [[{ node: 'b' }]] } } })!, /nœud inconnu : b/);
});

test('n8n : état, liste, création, activation par l\'API (clé envoyée)', async () => {
  const seen: Array<{ url: string; key?: string; body?: string }> = [];
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      seen.push({ url: `${req.method} ${req.url}`, key: req.headers['x-n8n-api-key'] as string, body });
      if (req.url === '/healthz') return res.end('{"status":"ok"}');
      if (req.headers['x-n8n-api-key'] !== 'K') { res.statusCode = 401; return res.end('{}'); }
      if (req.url?.startsWith('/api/v1/workflows?')) return res.end(JSON.stringify({ data: [{ id: '1', name: 'Odin · point du matin', active: false }] }));
      if (req.url === '/api/v1/workflows' && req.method === 'POST') return res.end(JSON.stringify({ id: '2', name: JSON.parse(body).name, active: false }));
      if (req.url === '/api/v1/workflows/1/activate') return res.end(JSON.stringify({ id: '1', name: 'x', active: true }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await n8nStatus({ url }), { up: true, keyOk: false });
    assert.equal((await n8nStatus({ url, key: 'mauvaise' })).keyOk, false);
    assert.deepEqual(await n8nStatus({ url, key: 'K' }), { up: true, keyOk: true, workflows: 1 });
    assert.equal((await listWorkflows({ url, key: 'K' }))[0].name, 'Odin · point du matin');
    const t = templates('http://o', 'T')[0];
    const w = await createWorkflow({ url, key: 'K' }, t.wf);
    assert.equal(w.id, '2');
    assert.equal(JSON.parse(seen.find((x) => x.url === 'POST /api/v1/workflows')!.body!).settings.executionOrder, 'v1');
    assert.equal((await setActive({ url, key: 'K' }, '1', true)).active, true);
    assert.equal((await n8nStatus({ url: 'http://127.0.0.1:1' })).up, false);
  } finally { srv.close(); }
});

test('pont n8n → Odin : clé dédiée obligatoire, note écrite dans le Cerveau, prévenir, demander', async () => {
  const o = makeOdin([{ text: 'RIEN' }, { text: 'Deux tâches en retard : appeler le comptable.' }]);
  try {
    const tok = hookToken(o.paths.home);
    assert.equal(hookAllowed(o.paths.home, 'faux'), false);
    assert.equal(hookAllowed(o.paths.home, tok), true);
    const told: string[] = [];
    const tell = async (t: string) => { told.push(t); };
    const r = await handleHook(o, { action: 'note', titre: 'Facture EDF', type: 'ressource', contenu: 'Montant 82 €' }, tell);
    assert.equal(r.path, 'Ressources/Facture EDF.md');
    const v = brainOf({ home: o.paths.home, workspace: o.paths.workspace, careCfg: o.cfg });
    assert.equal(v.read('Facture EDF')!.meta.fiable, false, 'contenu d\'automatisation marqué non fiable');
    await handleHook(o, { action: 'notify', text: 'Site en panne' }, tell);
    assert.deepEqual(told, ['🔁 Site en panne']);
    await handleHook(o, { action: 'ask', text: 'Tâches en retard ?', send: 'si-utile' }, tell);
    assert.equal(told.length, 1, '« RIEN » : pas de message');
    await handleHook(o, { action: 'ask', text: 'Tâches en retard ?', send: 'si-utile' }, tell);
    assert.match(told[1], /appeler le comptable/);
    assert.equal((await handleHook(o, { action: 'rm -rf' }, tell)).ok, false);
  } finally { o.cleanup(); }
});

test('Notion ↔ Markdown, dans les deux sens', () => {
  assert.equal(richToMd([{ plain_text: 'gras', annotations: { bold: true } }, { plain_text: ' et ' }, { plain_text: 'lien', href: 'https://x.fr' }]), '**gras** et [lien](https://x.fr)');
  const md = blocksToMd([
    { id: '1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Plan' }] } },
    { id: '2', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Appeler' }], checked: true } },
    { id: '3', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Un' }] } },
    { id: '4', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Deux' }] } },
    { id: '5', type: 'code', code: { rich_text: [{ plain_text: 'ls' }], language: 'bash' } },
  ]);
  assert.equal(md, '## Plan\n- [x] Appeler\n1. Un\n2. Deux\n```bash\nls\n```');
  const blocks = mdToBlocks('# Titre\n- [ ] faire\n- point\nVoir [[Amina|la gérante]]\n---') as Array<{ type: string; paragraph?: { rich_text: Array<{ text: { content: string } }> } }>;
  assert.deepEqual(blocks.map((b) => b.type), ['heading_1', 'to_do', 'bulleted_list_item', 'paragraph', 'divider']);
  assert.equal(blocks[3].paragraph!.rich_text[0].text.content, 'Voir la gérante');
});

test('Cerveau proactif : retards, échéances proches, projets à l\'arrêt', () => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/odin-att-${Date.now()}`;
  const v = new Vault(dir);
  const now = Date.parse('2026-11-11T10:00:00');
  v.create('Payer l\'assurance', 'tâche', '', { échéance: '2026-11-05' });
  v.create('Envoyer le devis', 'tâche', '', { échéance: '2026-11-12' });
  v.create('Vieille tâche', 'tâche', '', { échéance: '2026-10-01', statut: 'fait' });
  const a = v.attention(now);
  assert.deepEqual(a.map((x) => [x.kind, x.title]), [['retard', 'Payer l\'assurance'], ['bientôt', 'Envoyer le devis']]);
});

test('graphe : cartes avec le début de chaque note (sans Markdown)', async () => {
  const { excerptOf } = await import('../src/brain/vault.ts');
  assert.equal(excerptOf('# Titre\n- **Appeler** [[Amina|la gérante]] et voir [le site](https://x.fr)\n```js\ncode\n```'), 'Titre Appeler la gérante et voir le site');
  assert.ok(excerptOf('mot '.repeat(100)).endsWith('…'));
});
