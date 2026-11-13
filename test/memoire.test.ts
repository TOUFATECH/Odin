// La mémoire d'Odin en fichiers : jamais de SQLite, rien de perdu au redémarrage, ancienne base convertie,
// conversations supprimées pour de bon (après la corbeille) ou remises.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mnemosyne } from '../src/muninn/store.ts';
import { Table } from '../src/muninn/tables.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

test('zéro SQLite : aucun fichier du code ne charge SQLite (sauf la conversion unique de l\'ancienne base)', () => {
  const bad = walk('src').filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(join('muninn', 'migrate.ts')))
    .filter((f) => /from 'node:sqlite'|import\('node:sqlite'\)|DatabaseSync|getBuiltinModule\?*\.?\(?'node:sqlite'/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('mémoire en fichiers : tout est relu après un redémarrage, recherche sans accents et par début de mot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-mem-'));
  try {
    const a = new Mnemosyne(dir);
    a.ensureSession('web:x', 'web', 'x'); a.setSessionTitle('web:x', 'Projet Athena');
    a.addMessage('web:x', { role: 'user', content: 'Redémarre le serveur Proxmox du garage' });
    a.addMessage('web:x', { role: 'assistant', content: 'C\'est fait, Proxmox a redémarré.' });
    const id = a.remember('Le NAS s\'appelle Coffre', 'owner', 'fact', 'nas');
    a.setKv('pin:x', '1'); a.recordUsage('web:x', 'ollama', 10, 5, 0);
    const b = new Mnemosyne(dir);
    assert.equal(b.getSession('web:x')?.title, 'Projet Athena');
    assert.equal(b.history('web:x').length, 2);
    assert.equal(b.recall('coffre')[0]?.id, id.id);
    assert.equal(b.searchMessages('redemar')[0]?.session_id, 'web:x', 'sans accent, début de mot');
    assert.match(b.searchMessages('proxmox')[0].snippet, /«Proxmox/);
    assert.equal(b.getKv('pin:x'), '1');
    assert.equal(b.usageCount('web:x'), 1);
    assert.ok(existsSync(join(dir, 'messages.jsonl')) && existsSync(join(dir, 'memories.jsonl')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('une ligne abîmée par une coupure de courant est ignorée, le reste est gardé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-mem-'));
  try {
    const t = new Table<{ id: number; v: string }>(join(dir, 't.jsonl'), (r) => r.id);
    t.insert({ v: 'un' }); t.insert({ v: 'deux' });
    const f = join(dir, 't.jsonl');
    appendFileSync(f, '{"p":{"id":3,"v":"tro');
    const u = new Table<{ id: number; v: string }>(f, (r) => r.id);
    assert.deepEqual(u.all().map((r) => r.v), ['un', 'deux']);
    assert.equal(u.nextId(), 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ancienne base odin.db convertie une seule fois en fichiers, puis mise de côté', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-mig-'));
  try {
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const db = new sqlite.DatabaseSync(join(home, 'odin.db'));
    db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, channel TEXT, peer TEXT, title TEXT, summary TEXT, compact_upto INTEGER, tainted INTEGER, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE memories(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, origin TEXT, trust REAL, tags TEXT, created_at INTEGER, last_used_at INTEGER, uses INTEGER, pinned INTEGER, subject TEXT, topic TEXT, source TEXT, superseded_by INTEGER);
      CREATE TABLE usage(session_id TEXT, provider TEXT, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, created_at INTEGER, purpose TEXT);
      CREATE TABLE devices(id TEXT PRIMARY KEY, ip TEXT, ports TEXT, services TEXT, web TEXT);
      INSERT INTO sessions VALUES ('web:a','web','a','Ancienne','',0,0,1,2);
      INSERT INTO memories(kind, content, origin, trust, tags, created_at, last_used_at, uses, pinned, subject, topic, source) VALUES ('fact','Mon chat s''appelle Simba','owner',1,'',1,1,0,1,'','','');
      INSERT INTO usage VALUES ('web:a','claude',1,2,0.5,5,'agent');
      INSERT INTO devices VALUES ('aa:bb','192.168.1.2','[22,80]','[]','[]');`);
    db.close();
    const m = new Mnemosyne(join(home, 'odin.db'));
    assert.equal(m.getSession('web:a')?.title, 'Ancienne');
    assert.equal(m.pinned()[0]?.content, 'Mon chat s\'appelle Simba');
    assert.equal(m.monthCost(new Date(0)), 0.5);
    assert.deepEqual(m.table<{ id: string; ports: number[] }>('devices', (r) => r.id).get('aa:bb')?.ports, [22, 80]);
    assert.ok(!existsSync(join(home, 'odin.db')), 'ancienne base mise de côté');
    assert.ok(readdirSync(home).some((f) => f.startsWith('odin.db.ancien-')));
    assert.ok(existsSync(join(home, 'memoire', 'migration.json')));
    m.remember('Nouveau souvenir', 'owner');
    assert.equal(new Mnemosyne(join(home, 'odin.db')).listMemories().length, 2, 'pas de seconde conversion');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('suppression d\'une conversation : corbeille, annulation, puis effacement réel sur le disque', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-mem-'));
  try {
    const m = new Mnemosyne(dir);
    m.ensureSession('web:secret', 'web', 'secret');
    m.addMessage('web:secret', { role: 'user', content: 'Mon code de portail est 4242' });
    m.remember('Le code du portail est 4242', 'owner', 'fact', '', { source: 'conversation:web:secret' });
    assert.ok(m.trashSession('web:secret', true));
    assert.equal(m.getSession('web:secret'), undefined);
    assert.equal(m.searchMessages('portail').length, 0, 'disparue de la recherche tout de suite');
    assert.equal(m.listTrash().length, 1);
    assert.ok(m.restoreSession('web:secret'));
    assert.equal(m.history('web:secret').length, 1, 'annulation : tout revient');
    m.trashSession('web:secret', true);
    assert.equal(m.purgeTrash(Date.now()), 0, 'gardée 7 jours');
    assert.equal(m.purgeTrash(Date.now() + 8 * 86_400_000), 1);
    assert.equal(m.recall('portail').length, 0, 'souvenir venu de cette conversation oublié');
    const disk = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    assert.doesNotMatch(disk, /4242/, 'plus aucune trace sur le disque');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
