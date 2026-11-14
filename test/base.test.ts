// La base d'Odin (PostgreSQL géré par Alexandrie) : le socle, avec un VRAI serveur PostgreSQL jetable (les programmes
// de la machine : initdb, pg_ctl), arrêté et relancé pour de vrai : comptes par appli isolés, compte de lecture limité
// aux vues, requêtes paramétrées seulement, Odin démarre sans base puis la trouve, écritures gardées sur le disque
// pendant que la base est arrêtée, sauvegarde chiffrée relue et restaurée à côté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgDisponible, pgJetable } from './banc/pg-jetable.ts';
import { BaseAttente, BaseOdin, utiliserBase } from '../src/valhalla/base/index.ts';
import { Reserve } from '../src/valhalla/base/pool.ts';
import { restaurerACote, sauvegardes, sauvegarder } from '../src/valhalla/base/sauvegarde.ts';
import { essayerMachine, lancer, programmes } from '../src/valhalla/base/serveur.ts';
import { chmodSync, chownSync, mkdirSync, mkdtempSync, rmSync, writeFileSync as ecrire } from 'node:fs';
import { tmpdir } from 'node:os';
import { bases, password } from '../src/valhalla/urdr/bases.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { urdr } from '../src/valhalla/modules/urdr.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';

const SANS_PG = !pgDisponible() && 'PostgreSQL (initdb, pg_ctl) absent de la machine';
const attendre = async (f: () => boolean | Promise<boolean>, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('délai dépassé'); };
const silence = () => undefined;

test('socle : base prête, comptes par appli isolés, lecture par les vues seulement, valeurs jamais collées, base arrêtée puis revenue', { skip: SANS_PG, timeout: 120_000 }, async () => {
  const pg = await pgJetable();
  // « machine » : un serveur qu'Odin ne relance pas lui-même (sinon il le redémarrerait aussitôt arrêté).
  const b = new BaseOdin(pg.home, { cible: { ...pg.cible, mode: 'machine' }, hringhorni: false, verifierMs: 300, log: silence });
  try {
    const def = (id: string) => ({ id, migrations: [{ v: 1, nom: 'table', sql: 'CREATE TABLE t (id text PRIMARY KEY, v jsonb NOT NULL); CREATE VIEW v_t AS SELECT id FROM t; GRANT SELECT ON v_t TO odin_lecture' }, { v: 2, nom: 'colonne', sql: 'ALTER TABLE t ADD COLUMN n int NOT NULL DEFAULT 0' }], ecritures: { mettre: 'INSERT INTO t (id, v) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v' } });
    const a = b.appli(def('essai_a'), join(pg.home, 'a')), c = b.appli(def('essai_b'), join(pg.home, 'b'));
    await b.demarrer();
    assert.equal(b.etat, 'prete', b.message); assert.ok(a.prete && c.prete);
    assert.deepEqual((await a.q('SELECT version FROM _migrations ORDER BY 1')).rows.map((x) => x[0]), ['1', '2'], 'migrations versionnées, dans l\'ordre');
    a.ecrire(['mettre', 'x', JSON.stringify({ k: "l'apostrophe ; DROP TABLE t" })]); await a.vider();
    assert.deepEqual((await a.q('SELECT v->>$1 FROM t', ['k'])).rows, [["l'apostrophe ; DROP TABLE t"]], 'la valeur passe en paramètre');
    await assert.rejects(() => a.q("SELECT * FROM t WHERE id = 'x'"), /valeur est collée/, 'valeur collée dans le SQL : refusée');
    await assert.rejects(() => a.q('SELECT * FROM essai_b.t'), /permission denied/, 'une appli ne lit pas le schéma d\'une autre');
    // Le compte de lecture d'Odin : inscrit dans Alexandrie, les vues seulement.
    const al = bases(pg.home).find((x) => x.id === 'odin'); assert.equal(al?.utilisateur, 'odin_lecture'); assert.ok(password(pg.home, 'odin'));
    const lect = new Reserve({ host: '127.0.0.1', port: pg.cible.port, user: 'odin_lecture', password: password(pg.home, 'odin'), database: 'odin', ssl: 'non' });
    assert.deepEqual((await lect.q('SELECT id FROM essai_a.v_t')).rows, [['x']]);
    await assert.rejects(() => lect.q('SELECT v FROM essai_a.t'), /permission denied/, 'les tables : non');
    await lect.fermer();
    assert.ok(isSecretFile(join(pg.home, 'valhalla', 'urdr', 'secrets.json')), 'mots de passe : fichier bloqué');
    // Base arrêtée : l'écriture est gardée sur le disque ; base revenue : elle part.
    await pg.arreter();
    a.ecrire(['mettre', 'y', JSON.stringify({ k: 2 })]);
    await attendre(() => b.etat === 'perdue');
    assert.equal(a.attente.taille, 1); assert.ok(existsSync(a.attente.fichier), 'écriture en attente, sur le disque');
    await assert.rejects(() => a.q('SELECT 1'), BaseAttente);
    await pg.relancer();
    await attendre(() => b.etat === 'prete' && a.attente.taille === 0);
    assert.deepEqual((await a.q('SELECT id FROM t ORDER BY id')).rows.map((x) => x[0]), ['x', 'y'], 'rien n\'est perdu');
    assert.ok(!existsSync(a.attente.fichier));
  } finally { await b.arreter(); await pg.fin(); }
});

test('socle : Odin démarre sans base (serveur arrêté), le dit, garde les écritures, puis trouve la base', { skip: SANS_PG, timeout: 120_000 }, async () => {
  const pg = await pgJetable(); await pg.arreter();
  const b = new BaseOdin(pg.home, { cible: pg.cible, hringhorni: false, verifierMs: 300, log: silence });
  try {
    // Le serveur à Odin est relancé par Odin lui-même au démarrage : on simule une panne qui l'empêche (port pris par personne,
    // dossier absent) en pointant vers un port fermé.
    const b2 = new BaseOdin(pg.home, { cible: { ...pg.cible, mode: 'machine', port: 1 }, hringhorni: false, verifierMs: 300, log: silence });
    const a2 = b2.appli({ id: 'essai', migrations: [], ecritures: { rien: 'SELECT $1::text' } }, join(pg.home, 'e'));
    await b2.demarrer();
    assert.equal(b2.etat, 'absente'); assert.match(b2.message, /ne répond pas.*Odin marche quand même/);
    a2.ecrire(['rien', 'x']); assert.equal(a2.attente.taille, 1, 'écriture gardée');
    await b2.arreter();
    // Mode « serveur à Odin » : Odin démarre le serveur lui-même, et le relance s'il s'arrête.
    await b.demarrer(); assert.equal(b.etat, 'prete', b.message);
    await pg.arreter(); await b.verifier(); await b.verifier(); assert.equal(b.etat, 'prete', 'serveur arrêté : relancé par Odin');
  } finally { await b.arreter(); await pg.fin(); }
});

test('socle : sauvegarde chiffrée (pg_dump relu), restaurée dans une nouvelle base à côté ; état dans Alexandrie', { skip: SANS_PG, timeout: 120_000 }, async () => {
  const pg = await pgJetable();
  const b = new BaseOdin(pg.home, { cible: pg.cible, hringhorni: false, log: silence });
  try {
    const a = b.appli({ id: 'essai', migrations: [{ v: 1, nom: 't', sql: 'CREATE TABLE t (id text PRIMARY KEY, v text)' }], ecritures: { mettre: 'INSERT INTO t VALUES ($1, $2) ON CONFLICT (id) DO NOTHING' } }, join(pg.home, 'e'));
    await b.demarrer(); a.ecrire(['mettre', 'k', 'valeur-témoin-12345']); await a.vider();
    const r = await sauvegarder(b, new Date('2026-11-14T03:00:00Z'));
    assert.ok(r.elements > 3, `éléments relus : ${r.elements}`); assert.equal(sauvegardes(pg.home).length, 1);
    assert.ok(!readFileSync(r.fichier).includes(Buffer.from('valeur-témoin-12345')), 'chiffrée : la donnée ne se lit pas dans le fichier');
    assert.ok(isSecretFile(r.fichier), 'sauvegarde : fichier bloqué');
    const nom = await restaurerACote(b, r.fichier, new Date('2026-11-14T09:00:00Z'));
    const c = new Reserve({ host: '127.0.0.1', port: pg.cible.port, user: 'odin', password: password(pg.home, 'odin-admin'), database: nom, ssl: 'non' });
    assert.deepEqual((await c.q('SELECT v FROM essai.t')).rows, [['valeur-témoin-12345']], 'restaurée à côté, identique'); await c.fermer();
    utiliserBase(b);
    const v = new Valhalla(pg.home, [urdr]);
    const e = await v.act('urdr', 'base_odin'); assert.match(e.text, /prête/); assert.match(e.text, /Sauvegardes chiffrées : 1/);
  } finally { utiliserBase(undefined); await b.arreter(); await pg.fin(); }
});

test('socle : un PostgreSQL déjà présent sur la machine (comme celui d\'une distribution) : compte « odin » créé par le compte système, sans mot de passe sur la ligne de commande', { skip: SANS_PG || (process.getuid?.() !== 0 && 'il faut être root (compte système postgres)'), timeout: 120_000 }, async () => {
  // Un serveur « de distribution » : superutilisateur postgres, connexion locale par le compte système (peer), réseau en SCRAM.
  const racine = mkdtempSync(join(tmpdir(), 'odin-pgm-')); chmodSync(racine, 0o755);
  const bin = programmes()!, data = join(racine, 'data'), prise = join(racine, 'prise'), home = join(racine, 'odin');
  const port = await new Promise<number>((ok) => { import('node:net').then(({ createServer }) => { const x = createServer(); x.listen(0, '127.0.0.1', () => { const p = (x.address() as { port: number }).port; x.close(() => ok(p)); }); }); });
  mkdirSync(prise, { recursive: true }); chownSync(prise, ...(require_ids()));
  const b = new BaseOdin(home, { hringhorni: false, log: silence });
  try {
    mkdirSync(data, { mode: 0o700 }); chownSync(data, ...require_ids());
    const ini = await lancer(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth-local=peer', '--auth-host=scram-sha-256', '-E', 'UTF8', '--no-locale'], { sous: 'postgres' }); assert.equal(ini.code, 0, ini.sortie);
    ecrire(join(data, 'postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${prise}'\n`);
    const dem = await lancer(join(bin, 'pg_ctl'), ['-D', data, '-l', join(prise, 'log'), '-w', 'start'], { sous: 'postgres' }); assert.equal(dem.code, 0, `${dem.sortie} ${(() => { try { return readFileSync(join(prise, 'log'), 'utf8'); } catch { return ''; } })()}`);
    const c = await essayerMachine(home, { port, prise });
    assert.equal(c?.mode, 'machine'); assert.equal(c?.admin, 'odin');
    const bo = new BaseOdin(home, { cible: c, hringhorni: false, log: silence });
    const a = bo.appli({ id: 'essai', migrations: [{ v: 1, nom: 't', sql: 'CREATE TABLE t (x int)' }], ecritures: {} }, join(home, 'e'));
    await bo.demarrer(); assert.equal(bo.etat, 'prete', bo.message); assert.ok(a.prete);
    assert.match(bo.message, /PostgreSQL de la machine/);
    // Le compte « odin » n'est pas superutilisateur : il crée des bases et des comptes, rien de plus.
    assert.deepEqual((await a.q('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1', ['odin'])).rows, [['f', 't', 't']]);
    await bo.arreter();
  } finally { await b.arreter(); await lancer(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { sous: 'postgres' }); rmSync(racine, { recursive: true, force: true }); }
});
function require_ids(): [number, number] { const l = readFileSync('/etc/passwd', 'utf8').split('\n').find((x) => x.startsWith('postgres:'))!.split(':'); return [Number(l[2]), Number(l[3])]; }
