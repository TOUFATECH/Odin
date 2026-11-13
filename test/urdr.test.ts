// Urðr (bases de données, Studio, SQL) et Skuld (sauvegarde des bases) : client PostgreSQL maison (SCRAM),
// SQLite, lecture seule garantie, modifications avec accord, sauvegarde relue, restauration, durée de garde.
// Un vrai PostgreSQL est utilisé si ODIN_TEST_PG est donné (ex. postgres://postgres:mdp@127.0.0.1:55432/postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRead, statements, PgDriver } from '../src/valhalla/urdr/db.ts';
import { FakeDriver } from './fake-driver.ts';
import { md5Password, scramFinal, scramFirst } from '../src/valhalla/urdr/pg.ts';
import { bases, password, saveBases, useOpener } from '../src/valhalla/urdr/bases.ts';
import { keep } from '../src/valhalla/skuld/dump.ts';
import { due, skuld, useTools } from '../src/valhalla/modules/skuld.ts';
import { urdr } from '../src/valhalla/modules/urdr.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';
import type { Module } from '../src/valhalla/types.ts';

test('SQL : découpage, lecture ou écriture', () => {
  assert.deepEqual(statements("select ';' as x; -- ; commentaire\nselect $$a;b$$; /* ; */ select 3"), ["select ';' as x", 'select $$a;b$$', 'select 3']);
  for (const q of ['select 1', ' SELECT * FROM t ;', 'with a as (select 1) select * from a', 'explain select 1', 'show search_path', 'pragma table_info(t)']) assert.ok(isRead(q), q);
  for (const q of ['update t set a = 1', 'select 1; drop table t', 'with x as (delete from t returning *) select * from x', 'select * into t2 from t', 'explain analyze delete from t', 'pragma journal_mode = wal', 'copy t to \'/tmp/x\'', 'vacuum', 'attach database \'/tmp/x\' as y']) assert.ok(!isRead(q), q);
  assert.ok(isRead("select 'into' as mot"), 'le mot « into » dans une chaîne ne compte pas');
});

test('SCRAM-SHA-256 : exemple de la RFC 7677', () => {
  // RFC 7677 §3 : user, pencil, nonce rOprNGfwEbeRWgbNEkqO
  const f = scramFirst('rOprNGfwEbeRWgbNEkqO');
  const r = scramFinal('pencil', 'n=user,r=rOprNGfwEbeRWgbNEkqO', 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096', f.nonce);
  assert.equal(r.final, 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  assert.equal(r.serverSig.toString('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  assert.throws(() => scramFinal('x', f.bare, 'r=autre,s=AA==,i=4096', f.nonce), /nonce/);
  assert.equal(md5Password('u', 'p', Buffer.from([1, 2, 3, 4])).length, 35);
});

test('isSecretFile : secrets d\'Urðr et archives de Skuld protégés', () => {
  assert.ok(isSecretFile('/home/x/.odin/valhalla/urdr/secrets.json'));
  assert.ok(isSecretFile('/home/x/.odin/valhalla/skuld/archives/compta/2026.dump'));
  assert.ok(isSecretFile('/home/x/.odin/valhalla/urdr/donnees/famille/base'));
  assert.ok(!isSecretFile('/home/x/.odin/valhalla/urdr/bases.json'));
});

/** Brísingamen simulé (le mot de passe y est rangé). */
const coffre: string[] = [];
const fakeVault: Module = { id: 'brisingamen', name: 'Brísingamen', family: 'Accès', what: '', does: [], from: [], upstream: [], words: [], actions: [{ id: 'ajouter', label: 'Ajouter', what: '', run: (_c, i) => { coffre.push(String(i.nom)); return { text: 'ok' }; } }], view: () => ({ sections: [] }) };

test('Urðr + Skuld (fausse base PostgreSQL en mémoire) : Studio, SQL, accord, sauvegarde ; zéro SQLite', async () => {
  const home = mkdtempSync(join(tmpdir(), 'urdr-'));
  const d = new FakeDriver({
    clients: { columns: [{ name: 'id', type: 'int8', nullable: false, pk: true }, { name: 'nom', type: 'text', nullable: false, pk: false }, { name: 'ville', type: 'text', nullable: true, pk: false }],
      rows: [{ id: '1', nom: 'Awa', ville: 'Mamoudzou' }, { id: '2', nom: 'Ibrahim', ville: 'Koungou' }, { id: '3', nom: 'Nour', ville: 'Dembéni' }, { id: '4', nom: "O'Neil", ville: 'Mamoudzou' }] },
    rdv: { columns: [{ name: 'id', type: 'int8', nullable: false, pk: true }, { name: 'client_id', type: 'int8', nullable: true, pk: false, ref: { table: 'clients', column: 'id' } }, { name: 'quand', type: 'date', nullable: true, pk: false }], rows: [{ id: '1', client_id: '3', quand: '2026-11-15' }] },
  });
  useOpener((b) => (b.id === 'boutique' ? d : undefined));
  useTools(() => ({ has: async () => false, inContainer: async () => ({ cmd: 'sh', args: ['-c', 'printf PGDMP-archive-de-test'], env: {} }) }));
  try {
    const v = new Valhalla(home, [urdr, skuld, fakeVault]);
    let r = await v.act('urdr', 'relier', { nom: 'Notes', type: 'sqlite', fichier: '/tmp/x.sqlite' }); assert.equal(r.ok, false); assert.match(r.text, /zéro SQLite/);
    saveBases(home, [{ id: 'boutique', nom: 'Boutique', type: 'postgres', utilisateur: 'app_boutique', base: 'app_boutique', conteneur: 'odin-pg', ajoutee: new Date().toISOString() }]);
    r = await v.act('urdr', 'tables', { base: 'boutique' }); assert.match(r.text, /clients \(4 lignes\)/); assert.match(r.text, /rdv\.client_id → clients\.id/);
    r = await v.act('urdr', 'lignes', { base: 'Boutique', table: 'clients', filtres: '[{"col":"ville","op":"=","value":"Mamoudzou"}]', tri: 'nom', sens: 'desc' });
    assert.deepEqual((r.data as { rows: string[][] }).rows.map((x) => x[1]), ["O'Neil", 'Awa']);
    const sql = v.action('urdr', 'sql')!.a;
    assert.equal(sql.grave!({ base: 'boutique', requete: 'select count(*) from clients' }), undefined);
    assert.match(sql.grave!({ base: 'boutique', requete: "update clients set ville = 'Sada'" })!, /modifie/);
    assert.match(v.action('urdr', 'modifier')!.a.grave!({ base: 'boutique', table: 'clients', cle: '{"id":3}', changements: '{"ville":"Chirongui"}' })!, /la case ville de clients/);
    r = await v.act('urdr', 'modifier', { base: 'boutique', table: 'clients', cle: '{"id":"3"}', changements: '{"ville":"Chirongui"}' }); assert.match(r.text, /1 ligne modifiée/); assert.equal(d.t.clients.rows[2].ville, 'Chirongui');
    r = await v.act('urdr', 'sql', { base: 'boutique', requete: "delete from rdv where quand < '2026-11-10'" }); assert.match(r.text, /DELETE 1/); assert.match(r.text, /sauvegarde faite juste avant/);
    assert.equal(readdirSync(join(home, 'valhalla', 'skuld', 'archives', 'boutique')).length, 1);
    r = await v.act('urdr', 'journal'); assert.match(r.text, /delete from rdv/); assert.match(r.text, /UPDATE clients SET ville/);
    r = await v.act('skuld', 'sauvegarder', { base: 'boutique' }); assert.match(r.text, /sauvegardée .*vérifiée/);
    assert.match(v.action('skuld', 'restaurer')!.a.grave!({ base: 'boutique', ou: 'par-dessus' })!, /PAR-DESSUS/);
    r = await v.act('skuld', 'plan', { base: 'boutique', toutes: 'nuit', heure: 3, jours: 7 }); assert.match(r.text, /chaque nuit à 3 h · garde 7 j, 4 sem., 6 mois/);
    const view = await skuld.view(v.ctx('skuld'), new URLSearchParams()); assert.equal(view.sections[0].kind, 'cards');
    await v.act('urdr', 'ouvrir', { base: 'boutique', table: 'clients' });
    const uv = await urdr.view(v.ctx('urdr'), new URLSearchParams()); assert.ok(uv.sections.some((x) => x.title.startsWith('Studio · clients (4 lignes)')));
  } finally { useOpener(undefined); useTools(); rmSync(home, { recursive: true, force: true }); }
});

test('Skuld : quand sauvegarder, quoi garder', () => {
  const plan = { base: 'b', toutes: 'nuit' as const, heure: 3, garde: { jours: 7, semaines: 4, mois: 6 }, actif: true };
  const at = (s: string) => new Date(s);
  assert.equal(due(plan, undefined, at('2026-11-13T10:00:00')), true, 'jamais sauvegardée : tout de suite');
  assert.equal(due(plan, at('2026-11-12T03:00:00'), at('2026-11-13T03:05:00')), true);
  assert.equal(due(plan, at('2026-11-13T03:00:00'), at('2026-11-13T10:00:00')), false);
  assert.equal(due({ ...plan, toutes: 'heure' }, at('2026-11-13T09:00:00'), at('2026-11-13T10:00:00')), true);
  assert.equal(due({ ...plan, actif: false }, undefined, at('2026-11-13T10:00:00')), false);
  const now = new Date('2026-11-13T12:00:00Z'), days = Array.from({ length: 200 }, (_, i) => new Date(now.getTime() - i * 864e5).toISOString());
  const k = keep(days, { jours: 7, semaines: 4, mois: 6 }, now);
  assert.ok(k.size >= 15 && k.size <= 22, `gardées : ${k.size}`);
  for (let i = 0; i <= 6; i++) assert.ok(k.has(days[i]), `jour ${i} gardé`);
  assert.ok(!k.has(days[199]), 'au-delà de la durée de garde : effacée');
  assert.equal(keep(['2020-01-01T00:00:00Z'], { jours: 1, semaines: 0, mois: 0 }, now).size, 1, 'jamais sans la dernière');
});

const PG = process.env.ODIN_TEST_PG;
test('PostgreSQL réel : SCRAM, Studio, lecture seule, sauvegarde et restauration', { skip: !PG && 'ODIN_TEST_PG absent' }, async () => {
  const u = new URL(PG!), home = mkdtempSync(join(tmpdir(), 'urdr-pg-'));
  const d = await PgDriver.open({ host: u.hostname, port: Number(u.port), user: u.username, password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
  try {
    await d.sql('drop table if exists t_rdv', true); await d.sql('drop table if exists t_clients', true);
    await d.sql('create table t_clients (id serial primary key, nom text not null, ville text)', true);
    await d.sql('create table t_rdv (id serial primary key, client_id int references t_clients(id), quand date)', true);
    await d.sql("insert into t_clients (nom, ville) values ('Awa', 'Mamoudzou'), ('Nour', 'Dembéni'), ('Kamal', 'Mamoudzou')", true);
    await d.sql("insert into t_rdv (client_id, quand) values (2, '2026-11-15')", true);
    await assert.rejects(() => d.sql("insert into t_clients (nom) values ('x')", false), /read-only/);
    await assert.rejects(() => d.sql('select 1; select 2', true), /une seule instruction/);
    const v = new Valhalla(home, [urdr, skuld, fakeVault]);
    let r = await v.act('urdr', 'relier', { nom: 'Test PG', type: 'postgres', hote: u.hostname, port: u.port, utilisateur: u.username, mot_de_passe: decodeURIComponent(u.password), base: u.pathname.slice(1), ssl: 'non' });
    assert.match(r.text, /Test PG reliée/); assert.ok(password(home, 'test-pg')); assert.ok(coffre.includes('Base · Test PG'), 'mot de passe rangé dans le coffre');
    r = await v.act('urdr', 'colonnes', { base: 'test-pg', table: 't_rdv' }); assert.match(r.text, /client_id · integer · → t_clients\.id/);
    r = await v.act('urdr', 'lignes', { base: 'test-pg', table: 't_clients', filtres: '[{"col":"ville","op":"contient","value":"mamou"}]', tri: 'id', sens: 'desc' });
    assert.deepEqual((r.data as { rows: string[][] }).rows.map((x) => x[1]), ['Kamal', 'Awa']);
    r = await v.act('urdr', 'modifier', { base: 'test-pg', table: 't_clients', cle: '{"id":"2"}', changements: '{"ville":"Chirongui"}' }); assert.match(r.text, /1 ligne modifiée/);
    r = await v.act('skuld', 'sauvegarder', { base: 'test-pg' }); assert.match(r.text, /vérifiée \(archive relue, \d+ éléments\)/);
    r = await v.act('skuld', 'restaurer', { base: 'test-pg', ou: 'nouvelle base' }); assert.match(r.text, /nouvelle base : postgres_restauree_\d{8}/, r.text);
    const nb = bases(home).find((b) => b.id === 'test-pg-restauree')!;
    r = await v.act('urdr', 'sql', { base: nb.id, requete: 'select ville from t_clients where id = 2' }); assert.match(r.text, /Chirongui/);
    await d.sql(`drop database ${nb.base}`, true);
  } finally { await d.sql('drop table if exists t_rdv', true).catch(() => {}); await d.sql('drop table if exists t_clients', true).catch(() => {}); await d.close(); rmSync(home, { recursive: true, force: true }); }
});

test('Skuld : base hébergée par Odin → pg_dump et pg_restore lancés DANS son conteneur', { skip: !PG && 'ODIN_TEST_PG absent' }, async () => {
  const { dump, restore, verify } = await import('../src/valhalla/skuld/dump.ts');
  const home = mkdtempSync(join(tmpdir(), 'skuld-ct-')), seen: string[][] = [];
  // Le « conteneur » : la commande reçue est lancée ici, sur la socket locale du PostgreSQL d'essai.
  const t = { inContainer: async (ct: string, argv: string[]) => { seen.push([ct, ...argv]); return { cmd: argv[0], args: [...argv.slice(1), '-h', '/tmp', '-p', new URL(PG!).port], env: {} }; }, has: async () => true };
  const b = { id: 'famille', nom: 'Famille', type: 'postgres' as const, utilisateur: 'postgres', base: 'postgres', conteneur: 'urdr-famille', ajoutee: '' };
  try {
    const f = join(home, 'a.dump'); await dump(home, b, f, t);
    assert.deepEqual(seen[0], ['urdr-famille', 'pg_dump', '-U', 'postgres', '-Fc', '-d', 'postgres']);
    assert.match(await verify(b, f, t), /vérifiée/);
    const name = `famille_essai_${process.pid}`;
    assert.equal(await restore(home, b, f, { new: true, name }, t), name);
    assert.deepEqual(seen.slice(1).map((x) => x.slice(0, 2)), [['urdr-famille', 'createdb'], ['urdr-famille', 'pg_restore']]);
    const d = await PgDriver.open({ host: '127.0.0.1', port: Number(new URL(PG!).port), user: 'postgres', password: decodeURIComponent(new URL(PG!).password), database: 'postgres' });
    await d.sql(`drop database ${name}`, true); await d.close();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('base d\'Odin : chaque appli reçoit SA base et son compte, isolés des autres ; variables selon l\'appli', { skip: !PG && 'ODIN_TEST_PG absent' }, async () => {
  const { provision, envFor, needsDb, roleOf, useServerPort, SERVER } = await import('../src/valhalla/urdr/serveur.ts');
  const { setPassword } = await import('../src/valhalla/urdr/bases.ts');
  const { Pg } = await import('../src/valhalla/urdr/pg.ts');
  const u = new URL(PG!), home = mkdtempSync(join(tmpdir(), 'odin-pg-')); useServerPort(Number(u.port));
  setPassword(home, SERVER, decodeURIComponent(u.password));
  const e = { find: () => ({ state: { status: 'en marche', ip: u.hostname } }) } as never;
  const admin = await Pg.connect({ host: u.hostname, port: Number(u.port), user: 'postgres', password: decodeURIComponent(u.password), database: 'postgres' });
  try {
    assert.equal(roleOf('Mon n8n !'), 'app_mon_n8n'); assert.ok(needsDb('n8nio/n8n:1.120')); assert.ok(needsDb('vaultwarden/server')); assert.ok(!needsDb('nginx'));
    const a = await provision(home, e, 'essai-a'), b = await provision(home, e, "essai-b'; drop table x; --");
    assert.equal(a.created, true); assert.equal(a.info.database, 'app_essai_a'); assert.equal(b.info.user, 'app_essai_b_drop_table_x');
    assert.equal((await provision(home, e, 'essai-a')).created, false, 'deuxième fois : la même base');
    const ca = await Pg.connect({ host: u.hostname, port: Number(u.port), user: a.info.user, password: a.info.password, database: a.info.database, ssl: 'non' });
    await ca.query('create table t (x int)'); await ca.query('insert into t values (1)'); await ca.close();
    await assert.rejects(() => Pg.connect({ host: u.hostname, port: Number(u.port), user: a.info.user, password: a.info.password, database: b.info.database, ssl: 'non' }), /permission denied|not have CONNECT/, 'une appli n\'entre pas dans la base d\'une autre');
    assert.deepEqual(Object.keys(envFor('n8nio/n8n', a.info)).sort(), ['DB_POSTGRESDB_DATABASE', 'DB_POSTGRESDB_HOST', 'DB_POSTGRESDB_PASSWORD', 'DB_POSTGRESDB_PORT', 'DB_POSTGRESDB_USER', 'DB_TYPE']);
    assert.match(envFor('vaultwarden/server', a.info).DATABASE_URL, /^postgresql:\/\/app_essai_a:[\w-]+@odin-pg:5432\/app_essai_a$/);
    assert.equal(envFor('nextcloud:31', a.info).POSTGRES_HOST, 'odin-pg:5432');
  } finally {
    for (const r of ['app_essai_a', 'app_essai_b_drop_table_x']) { await admin.simple(`drop database if exists ${r}`).catch(() => {}); await admin.simple(`drop role if exists ${r}`).catch(() => {}); }
    await admin.close(); rmSync(home, { recursive: true, force: true });
  }
});
