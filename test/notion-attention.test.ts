import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksToMd, mdToBlocks, richToMd } from '../src/tools/notion.ts';
import { Vault } from '../src/brain/vault.ts';

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
