// Alexandrie · le schéma dessiné (comme drawDB) : lu dans un VRAI PostgreSQL (lancé pour l'essai, ou ODIN_TEST_PG),
// placement, changements dessinés → SQL relu par la base et lancé seulement avec l'accord (tout ou rien), exports SQL
// (le SQL PostgreSQL exporté est rejoué dans une base neuve : même schéma), SVG valide (xmllint), PNG, Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { urdr } from '../src/valhalla/modules/urdr.ts';
import { skuld } from '../src/valhalla/modules/skuld.ts';
import { PgDriver } from '../src/valhalla/urdr/db.ts';
import { exportSql, lireSchema, placer, sqlDe, type Schema } from '../src/valhalla/urdr/schema.ts';
import type { Module } from '../src/valhalla/types.ts';

const BIN = '/usr/lib/postgresql/16/bin';
const a = (c: string) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const libre = () => new Promise<number>((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
const peutLancer = existsSync(`${BIN}/postgres`) && process.getuid?.() === 0 && a('runuser');

/** Un vrai PostgreSQL pour l'essai : ODIN_TEST_PG s'il est donné, sinon un serveur lancé ici (compte « postgres », mot de passe SCRAM). */
async function serveur(): Promise<{ url: URL; fin: () => void } | undefined> {
  if (process.env.ODIN_TEST_PG) return { url: new URL(process.env.ODIN_TEST_PG), fin: () => {} };
  if (!peutLancer) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'pg-essai-')), data = join(dir, 'data'), pw = `Essai${Math.random().toString(36).slice(2, 10)}`, port = await libre();
  chmodSync(dir, 0o777); writeFileSync(join(dir, 'pw'), pw); chmodSync(join(dir, 'pw'), 0o644);
  execFileSync('runuser', ['-u', 'postgres', '--', `${BIN}/initdb`, '-D', data, '-U', 'postgres', '--pwfile', join(dir, 'pw'), '--auth', 'scram-sha-256', '-E', 'UTF8', '--locale', 'C'], { stdio: 'ignore' });
  const p: ChildProcess = spawn('runuser', ['-u', 'postgres', '--', `${BIN}/postgres`, '-D', data, '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { if (spawnSync(`${BIN}/pg_isready`, ['-h', '127.0.0.1', '-p', String(port)]).status === 0) break; await new Promise((x) => setTimeout(x, 150)); }
  // « runuser » ne transmet pas le signal au serveur : on l'arrête avec pg_ctl (sinon il survit à l'essai).
  return { url: new URL(`postgres://postgres:${pw}@127.0.0.1:${port}/postgres`), fin: () => { spawnSync('runuser', ['-u', 'postgres', '--', `${BIN}/pg_ctl`, '-D', data, 'stop', '-m', 'fast'], { stdio: 'ignore' }); p.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

test('schéma : changements → SQL vérifié (noms, types, valeurs par défaut), sans rien lancer (pur)', () => {
  const s: Schema = { tables: [{ nom: 'clients', lignes: 0, index: [], colonnes: [{ nom: 'id', type: 'integer', nul: false, pk: true }, { nom: 'nom', type: 'text', nul: false, pk: false }] }], liens: [] };
  const sql = sqlDe([{ op: 'table', nom: 'factures', colonnes: [{ nom: 'id', type: 'serial', pk: true }, { nom: 'client_id', type: 'integer', nul: false }, { nom: 'montant', type: 'numeric(10,2)', defaut: '0' }] }, { op: 'lien', table: 'factures', colonne: 'client_id', vers: 'clients', versColonne: 'id' }, { op: 'colonne', table: 'clients', colonne: { nom: 'ville', type: 'varchar(80)', defaut: '\'Mamoudzou\'' } }], s);
  assert.deepEqual(sql, ['CREATE TABLE "factures" (\n  "id" serial PRIMARY KEY,\n  "client_id" integer NOT NULL,\n  "montant" numeric(10,2) DEFAULT 0\n);', 'ALTER TABLE "factures" ADD CONSTRAINT "factures_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id");', 'ALTER TABLE "clients" ADD COLUMN "ville" varchar(80) DEFAULT \'Mamoudzou\';']);
  assert.match(sqlDe([{ op: 'table', nom: 't', colonnes: [{ nom: 'id', type: 'serial', pk: true }] }], s, 'mysql')[0], /`id` INT AUTO_INCREMENT PRIMARY KEY/);
  for (const [c, re] of [[{ op: 'table', nom: 'x"; drop table clients; --', colonnes: [{ nom: 'a', type: 'text' }] }, /nom de table refusé/], [{ op: 'colonne', table: 'clients', colonne: { nom: 'a', type: 'text; drop' } }, /type inconnu/], [{ op: 'colonne', table: 'clients', colonne: { nom: 'b', type: 'text', defaut: '1); drop table x; --' } }, /valeur par défaut refusée/], [{ op: 'lien', table: 'clients', colonne: 'nom', vers: 'nexiste', versColonne: 'id' }, /table inconnue/], [{ op: 'table', nom: 'clients', colonnes: [{ nom: 'a', type: 'text' }] }, /existe déjà/]] as const)
    assert.throws(() => sqlDe([c as never], s), re);
  // Placement : une table qui pointe vers une autre est à sa droite ; une place gardée est respectée.
  const p = placer({ tables: [...s.tables, { nom: 'factures', lignes: 0, index: [], colonnes: [{ nom: 'client_id', type: 'integer', nul: false, pk: false }] }], liens: [{ de: 'factures', colonne: 'client_id', vers: 'clients', versColonne: 'id' }] }, { clients: { x: 500, y: 40 } });
  assert.deepEqual(p.clients, { x: 500, y: 40 }); assert.ok(p.factures.x > 20);
});

test('schéma sur un vrai PostgreSQL : lu, dessiné, modifié avec accord (tout ou rien), exporté et rejoué', { timeout: 180_000, skip: !peutLancer && !process.env.ODIN_TEST_PG && 'PostgreSQL non disponible' }, async () => {
  const pg = (await serveur())!, u = pg.url, home = mkdtempSync(join(tmpdir(), 'urdr-schema-'));
  const conn = (db = u.pathname.slice(1)) => PgDriver.open({ host: u.hostname, port: Number(u.port), user: u.username, password: decodeURIComponent(u.password), database: db });
  const d = await conn();
  const fakeVault: Module = { id: 'brisingamen', name: 'Coffre', family: 'Sécurité', what: '', does: [], from: [], upstream: [], words: [], actions: [{ id: 'ajouter', label: 'a', what: '', run: () => ({ text: 'ok' }) }], view: () => ({ sections: [] }) };
  const v = new Valhalla(home, [urdr, skuld, fakeVault]);
  try {
    await d.sql('drop database if exists essai_schema', true); await d.sql('drop database if exists essai_rejoue', true);
    await d.sql('create database essai_schema', true); await d.sql('create database essai_rejoue', true);
    const b = await conn('essai_schema');
    for (const q of ['create table clients (id serial primary key, nom text not null, ville text default \'Mamoudzou\')', 'create table rdv (id serial primary key, client_id int not null references clients(id), quand date)', 'create index rdv_quand_idx on rdv (quand)', 'insert into clients (nom) values (\'Awa\')']) await b.sql(q, true);
    await b.close();
    let r = await v.act('urdr', 'relier', { nom: 'Essai schéma', type: 'postgres', hote: u.hostname, port: u.port, utilisateur: u.username, mot_de_passe: decodeURIComponent(u.password), base: 'essai_schema', ssl: 'non' });
    assert.match(r.text, /reliée/, r.text);
    const id = 'essai-schema';
    r = await v.act('urdr', 'schema_base', { base: id });
    const sc = (r.data as { schema: Schema }).schema;
    assert.deepEqual(sc.tables.map((t) => t.nom).sort(), ['clients', 'rdv']);
    assert.deepEqual(sc.liens, [{ de: 'rdv', colonne: 'client_id', vers: 'clients', versColonne: 'id' }]);
    assert.ok(sc.tables.find((t) => t.nom === 'rdv')!.index.some((i) => i.nom === 'rdv_quand_idx'), 'les index sont lus');
    assert.equal(sc.tables.find((t) => t.nom === 'clients')!.colonnes.find((c) => c.nom === 'id')!.pk, true);
    // Les places : gardées.
    await v.act('urdr', 'placer_tables', { base: id, positions: JSON.stringify({ clients: { x: 300, y: 60 } }) });
    r = await v.act('urdr', 'schema_base', { base: id }); assert.deepEqual((r.data as { positions: Record<string, unknown> }).positions.clients, { x: 300, y: 60 });
    // Changements dessinés → SQL ; rien n'est lancé sans l'accord ; une erreur au milieu n'en laisse aucun (tout ou rien).
    const ch = [{ op: 'table', nom: 'factures', colonnes: [{ nom: 'id', type: 'serial', pk: true }, { nom: 'client_id', type: 'integer', nul: false }, { nom: 'montant', type: 'numeric(10,2)', defaut: '0' }] }, { op: 'lien', table: 'factures', colonne: 'client_id', vers: 'clients', versColonne: 'id' }, { op: 'colonne', table: 'clients', colonne: { nom: 'telephone', type: 'varchar(20)' } }];
    r = await v.act('urdr', 'sql_schema', { base: id, changements: JSON.stringify(ch) }); assert.match(r.text, /^CREATE TABLE "factures"/);
    assert.match(urdr.actions.find((x) => x.id === 'appliquer_schema')!.grave!({ base: id, changements: JSON.stringify(ch) }) ?? '', /modifier la structure de la base essai-schema \(3 changement/);
    const casse = [{ op: 'colonne', table: 'clients', colonne: { nom: 'pays', type: 'text' } }, { op: 'colonne', table: 'clients', colonne: { nom: 'nom2', type: 'integer', nul: false } }];
    // « nom2 » NOT NULL sans défaut sur une table qui a déjà une ligne : la base refuse, et « pays » n'est pas gardé non plus.
    r = await v.act('urdr', 'appliquer_schema', { base: id, changements: JSON.stringify(casse) }); assert.equal(r.ok, false); assert.match(r.text, /Rien n'a été changé \(tout ou rien\)/);
    r = await v.act('urdr', 'schema_base', { base: id }); assert.ok(!(r.data as { schema: Schema }).schema.tables.find((t) => t.nom === 'clients')!.colonnes.some((c) => c.nom === 'pays'));
    r = await v.act('urdr', 'appliquer_schema', { base: id, changements: JSON.stringify(ch) }); assert.notEqual(r.ok, false, r.text); assert.match(r.text, /3 changement\(s\) appliqué\(s\)/);
    const apres = (await v.act('urdr', 'schema_base', { base: id })).data as { schema: Schema };
    assert.ok(apres.schema.liens.some((l) => l.de === 'factures' && l.vers === 'clients')); assert.ok(apres.schema.tables.find((t) => t.nom === 'clients')!.colonnes.some((c) => c.nom === 'telephone'));
    // Exports : SQL PostgreSQL rejoué dans une base neuve → même schéma ; MySQL ; Markdown ; SVG valide ; PNG.
    r = await v.act('urdr', 'exporter_schema', { base: id, format: 'sql-postgres' });
    const sql = String((r.data as { contenu: string }).contenu); assert.ok(r.fichiers?.[0]?.ref.startsWith('export:'));
    const rj = await conn('essai_rejoue');
    try { for (const q of sql.split(/;\s*\n/).map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await rj.sql(q, true); const s2 = await lireSchema(rj);
      const forme = (s: Schema) => s.tables.map((t) => `${t.nom}(${t.colonnes.map((c) => `${c.nom}:${c.type}:${c.nul}:${c.pk}`).join(',')})`).sort();
      assert.deepEqual(forme(s2), forme(apres.schema)); assert.deepEqual(s2.liens.map((l) => `${l.de}.${l.colonne}>${l.vers}`).sort(), apres.schema.liens.map((l) => `${l.de}.${l.colonne}>${l.vers}`).sort());
      assert.ok(s2.tables.find((t) => t.nom === 'rdv')!.index.some((i) => i.nom === 'rdv_quand_idx'), 'les index suivent');
    } finally { await rj.close(); }
    assert.equal(exportSql(apres.schema, 'postgres'), sql);
    r = await v.act('urdr', 'exporter_schema', { base: id, format: 'sql-mysql' }); assert.match(String((r.data as { contenu: string }).contenu), /CREATE TABLE `clients` \(\n {2}`id` INT AUTO_INCREMENT NOT NULL/);
    r = await v.act('urdr', 'exporter_schema', { base: id, format: 'markdown' }); assert.match(String((r.data as { contenu: string }).contenu), /## factures[\s\S]*\| client_id \| integer \| non \|  \|  \| → clients\.id \|/);
    r = await v.act('urdr', 'exporter_schema', { base: id, format: 'svg' }); const svg = String((r.data as { contenu: string }).contenu);
    if (a('xmllint')) { const f = join(home, 's.svg'); writeFileSync(f, svg); execFileSync('xmllint', ['--noout', f]); }
    assert.match(svg, /factures/);
    if (a('rsvg-convert')) { r = await v.act('urdr', 'exporter_schema', { base: id, format: 'png' }); assert.notEqual(r.ok, false, r.text); assert.ok(urdr.retrait!(v.ctx('urdr'), r.fichiers![0].ref)); }
    assert.equal(urdr.retrait!(v.ctx('urdr'), 'export:../bases.json'), undefined);
  } finally { v.stop(); await d.sql('drop database if exists essai_schema with (force)', true).catch(() => {}); await d.sql('drop database if exists essai_rejoue with (force)', true).catch(() => {}); await d.close(); pg.fin(); rmSync(home, { recursive: true, force: true }); }
});
