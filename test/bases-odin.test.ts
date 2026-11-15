// Les bases des applis dans Alexandrie : une base par appli, nommée NOM_ODIN (nom affiché sans accents, en majuscules),
// renommage sans perte et idempotent, Odin qui lit la base d'une appli en lecture seule (secrets masqués), et la
// traçabilité de chaque lien (journal + mémoire). Sans serveur PostgreSQL : un faux serveur (noms des bases et
// comptes) et une fausse base (urdr) suffisent ; les essais avec un vrai PostgreSQL sont dans base.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allModules } from '../src/valhalla/odin.ts';
import { rename } from '../src/valhalla/names.ts';
import { appliDeNom, ident, majuscules, nomBase, nomConforme, proprietaireJournal } from '../src/valhalla/base/noms.ts';
import { INVENTAIRE, verifierInventaire } from '../src/valhalla/base/inventaire.ts';
import { renommerBase, renommerCompte, type Executeur } from '../src/valhalla/base/renommage.ts';
import { colonneSecrete, lectureSeule, lireBaseAppli, masquer, MASQUE } from '../src/valhalla/base/lecture.ts';
import { brancherMemoire, traces, tablesDe } from '../src/valhalla/base/trace.ts';
import { idAlexandrie } from '../src/valhalla/base/index.ts';
import { repartirAttenteCommune } from '../src/valhalla/base/journal.ts';
import { saveBases, useOpener } from '../src/valhalla/urdr/bases.ts';
import { appSheet } from '../src/valhalla/fiches.ts';
import { dump } from '../src/valhalla/skuld/dump.ts';
import { FakeDriver } from './fake-driver.ts';
import type { SqlResult } from '../src/valhalla/urdr/db.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'odin-bases-'));
const modules = () => { const h = tmp(); try { return allModules({ paths: { home: h, workspace: h }, cfg: { venus: {}, voice: {} } } as never).map(rename); } finally { rmSync(h, { recursive: true, force: true }); } };

/**
 * Les données qui restent en fichier faute d'avoir été migrées (raison « a-faire ») : la liste est fermée. Une appli
 * qui n'est pas dans l'inventaire, ou qui ajoute des données « à faire » sans être ici, fait échouer l'essai.
 */
const A_FAIRE = new Set(['volva', 'frigg', 'kvasir', 'snotra', 'ivaldi', 'agora', 'vordr', 'askr', 'durinn', 'garmr', 'geri', 'vidarr', 'gladsheim', 'gna', 'hlin']);

test('nommage : chaque appli a sa base NOM_ODIN, calculée depuis son nom affiché, unique, en majuscules', () => {
  const ms = modules(), vus = new Map<string, string>();
  assert.ok(ms.length >= 50, `toutes les applis (${ms.length})`);
  for (const m of ms) {
    const n = nomBase(m.id);
    assert.equal(n, nomBase(m.id, m.name), `${m.id} : le nom vient du nom affiché « ${m.name} »`);
    assert.equal(n, `${majuscules(m.name)}_ODIN`, `${m.name} → ${n}`);
    assert.ok(nomConforme(n) && n === n.toUpperCase() && !/[^A-Z0-9_]/.test(n), `${n} : majuscules, sans accents ni espaces, fini par _ODIN`);
    assert.ok(!vus.has(n), `${n} : déjà pris par ${vus.get(n)}`); vus.set(n, m.id);
  }
  assert.equal(nomBase('sindri'), 'PHENIX_ODIN'); assert.equal(nomBase('urdr'), 'ALEXANDRIE_ODIN'); assert.equal(nomBase('freyja'), 'VENUS_ODIN');
  assert.equal(nomBase('var'), 'PERSONA_ODIN'); assert.equal(nomBase('rodd'), 'ECHO_ODIN'); assert.equal(nomBase('bru'), 'BIFROST_ODIN'); assert.equal(nomBase('pegase'), 'PEGASE_ODIN');
  // Toujours entre guillemets dans le SQL : PostgreSQL garde alors les majuscules.
  assert.equal(ident('PHENIX_ODIN'), '"PHENIX_ODIN"'); assert.equal(ident('a"b'), '"a""b"');
  // L'appli retrouvée par son nom, avec ou sans accent, ou par le nom de sa base.
  for (const t of ['Phénix', 'phenix', 'la base de Phénix', 'PHENIX_ODIN', 'sindri']) assert.equal(appliDeNom(t), 'sindri', t);
  assert.equal(appliDeNom('combien de connexions dans la base de Persona ?'), 'var');
  assert.equal(appliDeNom('rien de connu'), undefined);
});

test('règle pour toute appli, même nouvelle : ses données sont déclarées, en base ou en fichier pour une raison justifiée', () => {
  const ms = modules(), manque: string[] = [], injustifie: string[] = [];
  for (const m of ms) {
    const l = INVENTAIRE[m.id];
    if (!l) { manque.push(`${m.name} (${m.id})`); continue; }
    for (const r of l) {
      if (r.support === 'fichiers' && !r.raison) injustifie.push(`${m.name} : ${r.donnees} (sans raison)`);
      if (r.raison === 'a-faire' && !A_FAIRE.has(m.id)) injustifie.push(`${m.name} : ${r.donnees} (en fichier « à faire » : migre-la dans sa base ${nomBase(m.id)})`);
      if (r.support === 'base' && !r.tables?.length) injustifie.push(`${m.name} : ${r.donnees} (en base sans table)`);
    }
  }
  assert.deepEqual(manque, [], 'chaque appli dit où sont ses données (src/valhalla/base/inventaire.ts)');
  assert.deepEqual(injustifie, []);
  assert.deepEqual(verifierInventaire(), [], 'chaque journal va dans la base de l\'appli qui le déclare');
  // Les journaux connus vont dans la base de leur appli.
  for (const [j, a] of [['alertes', 'forseti'], ['connexions', 'var'], ['arche', 'skuld'], ['requetes', 'urdr'], ['forge_fjalar', 'fjalar'], ['loki', 'loki'], ['inconnu', 'journaux']]) assert.equal(proprietaireJournal(j), a, j);
});

/** Un faux serveur PostgreSQL : il connaît les bases et les comptes, et applique les ALTER … RENAME qu'on lui envoie. */
function fauxServeur(bases: string[], comptes: string[] = []) {
  const db = new Set(bases), roles = new Set(comptes), fermees = new Set<string>(), sql: string[] = [];
  const nom = (s: string) => s.slice(1, -1).replace(/""/g, '"');
  const c: Executeur = {
    async query(q, p = []) {
      if (/FROM pg_database/.test(q)) return { rows: db.has(String(p[0])) ? [['1']] : [] };
      if (/FROM pg_roles/.test(q)) return { rows: roles.has(String(p[0])) ? [['1']] : [] };
      return { rows: [] };
    },
    async simple(q) {
      sql.push(q);
      let m = /^ALTER DATABASE ("(?:[^"]|"")+") ALLOW_CONNECTIONS (true|false)$/.exec(q);
      if (m) { if (m[2] === 'false') fermees.add(nom(m[1])); else fermees.delete(nom(m[1])); return; }
      m = /^ALTER DATABASE ("(?:[^"]|"")+") RENAME TO ("(?:[^"]|"")+")$/.exec(q);
      if (m) { const [a, b] = [nom(m[1]), nom(m[2])]; if (!db.has(a)) throw new Error('absente'); if (db.has(b)) throw new Error('existe'); db.delete(a); db.add(b); if (fermees.delete(a)) fermees.add(b); return; }
      m = /^ALTER ROLE ("(?:[^"]|"")+") RENAME TO ("(?:[^"]|"")+")$/.exec(q);
      if (m) { roles.delete(nom(m[1])); roles.add(nom(m[2])); return; }
      if (/^ALTER ROLE ("(?:[^"]|"")+") PASSWORD '/.test(q)) return;
      throw new Error(`SQL inattendu : ${q}`);
    },
  };
  return { c, db, roles, fermees, sql };
}

test('renommage : ALTER DATABASE … RENAME TO entre guillemets, connexions fermées avant, idempotent, retour possible', async () => {
  const s = fauxServeur(['pegase_odin', 'postgres'], ['pegase_odin']);
  // Une base créée autrefois sans guillemets (minuscules) prend le nom de la règle.
  assert.equal(await renommerBase(s.c, 'pegase_odin', 'PEGASE_ODIN'), 'renommee');
  assert.ok(s.db.has('PEGASE_ODIN') && !s.db.has('pegase_odin'), 'les majuscules sont gardées');
  assert.ok(s.sql.indexOf('ALTER DATABASE "pegase_odin" ALLOW_CONNECTIONS false') < s.sql.indexOf('ALTER DATABASE "pegase_odin" RENAME TO "PEGASE_ODIN"'), 'plus de connexion avant de renommer');
  assert.equal(s.fermees.size, 0, 'les connexions sont rouvertes sous le nouveau nom');
  assert.ok(s.sql.every((q) => !/RENAME TO [^"]/.test(q)), 'noms toujours entre guillemets');
  // Idempotent : refaire ne change rien.
  const n = s.sql.length;
  assert.equal(await renommerBase(s.c, 'pegase_odin', 'PEGASE_ODIN'), 'deja'); assert.equal(s.sql.length, n);
  // Retour arrière par le même chemin.
  assert.equal(await renommerBase(s.c, 'PEGASE_ODIN', 'pegase_odin'), 'renommee'); assert.ok(s.db.has('pegase_odin'));
  assert.equal(await renommerBase(s.c, 'PEGASE_ODIN', 'pegase_odin'), 'deja');
  // Les deux existent : rien n'est touché.
  s.db.add('PEGASE_ODIN');
  await assert.rejects(() => renommerBase(s.c, 'pegase_odin', 'PEGASE_ODIN'), /toutes les deux/);
  assert.ok(s.db.has('pegase_odin') && s.db.has('PEGASE_ODIN'));
  assert.equal(await renommerBase(s.c, 'X_ODIN', 'Y_ODIN'), 'absente');
  // Le compte suit, son mot de passe est remis (jamais affiché ailleurs).
  assert.equal(await renommerCompte(s.c, 'pegase_odin', 'PEGASE_ODIN', 'mdp-genere'), 'renommee');
  assert.ok(s.roles.has('PEGASE_ODIN'));
  assert.equal(await renommerCompte(s.c, 'pegase_odin', 'PEGASE_ODIN', 'mdp-genere'), 'deja');
});

test('lecture seule : seules les lectures passent ; tout ce qui écrit est refusé avant même d\'aller à la base', () => {
  for (const q of ['select count(*) from v_sauvegardes', 'SELECT * FROM v_alertes WHERE titre = \'delete tout\' LIMIT 3', 'with x as (select 1) select * from x', '  select 1;  ']) assert.ok(lectureSeule(q), q);
  for (const q of ['insert into t values (1)', 'update t set a = 1', 'delete from t', 'drop table t', 'truncate t', 'select 1; delete from t', 'with x as (delete from t returning *) select * from x',
    'select * into copie from t', 'alter table t add column x int', 'grant select on t to public', 'copy t to \'/tmp/x\'', 'set role postgres', 'select nextval(\'s\')', 'select pg_sleep(10)',
    'select set_config(\'a\', \'b\', false)', 'select * from t for update', 'create table x (a int)', 'call p()', 'do $$ begin end $$', '', 'explain analyze delete from t', 'select pg_read_file(\'/etc/passwd\')']) {
    assert.throws(() => lectureSeule(q), /lecture seulement|une seule instruction|requête vide/, `refusé : ${q}`);
  }
});

test('secrets masqués : colonnes sensibles par leur nom, valeurs qui ressemblent à un jeton', () => {
  for (const c of ['mot_de_passe', 'password_hash', 'jeton', 'token', 'cle', 'api_key', 'empreinte', 'donnees_chiffrees', 'ip', 'adresse_ip', 'sel', 'secret', 'totp']) assert.ok(colonneSecrete(c), c);
  for (const c of ['nom', 'article', 'cycle', 'taille', 'quand', 'base', 'reussie', 'titre', 'description', 'type']) assert.ok(!colonneSecrete(c), c);
  const m = masquer(['nom', 'jeton', 'note'], [['a', 'abc', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl'], ['b', null, 'rien']]);
  assert.deepEqual(m.lignes, [['a', MASQUE, MASQUE], ['b', null, 'rien']]); assert.deepEqual(m.masquees, ['jeton']);
});

class FausseBase extends FakeDriver {
  async sql(text: string, write: boolean): Promise<SqlResult> {
    this.sqls.push({ text, write });
    if (write) throw new Error('jamais d\'écriture ici');
    return { columns: ['base', 'taille', 'jeton', 'ip'], rows: [['PHENIX_ODIN', '1200', 'abcdef123456', '192.168.1.20'], ['VENUS_ODIN', '900', 'zzz', '10.0.0.2']], command: 'SELECT 2', count: 2, ms: 1 };
  }
}

test('Odin lit la base d\'une appli : trouvée par le nom, lecture seule, limitée, secrets masqués, tracée et retenue', async () => {
  const home = tmp(), souvenirs: Array<[string, string]> = [];
  const f = new FausseBase({ v_sauvegardes: { columns: [], rows: [{}, {}, {}] }, v_versions: { columns: [], rows: [{}] } });
  saveBases(home, [{ id: idAlexandrie('sindri'), nom: 'PHENIX_ODIN', type: 'postgres', hote: '127.0.0.1', port: 5432, utilisateur: 'odin_lecture', base: 'PHENIX_ODIN', ssl: 'non', ajoutee: '2026-11-15T00:00:00Z' }]);
  useOpener((b) => (b.base === 'PHENIX_ODIN' ? f : undefined));
  brancherMemoire((t, sujet) => souvenirs.push([t, sujet]));
  try {
    // Sans requête : ce qu'Odin peut y lire.
    const vue = await lireBaseAppli(home, { appli: 'la base de Phénix', pourquoi: 'combien de sauvegardes', quand: new Date('2026-11-15T10:32:00Z') });
    assert.ok(!('absente' in vue)); if ('absente' in vue) return;
    assert.equal(vue.base, 'PHENIX_ODIN'); assert.deepEqual(vue.lignes, [['v_sauvegardes', '3'], ['v_versions', '1']]);
    // Avec une requête : lecture seule (write = false), limitée, colonnes secrètes masquées.
    const r = await lireBaseAppli(home, { appli: 'Phénix', requete: 'select base, taille, jeton, ip from v_sauvegardes', pourquoi: 'combien de sauvegardes' });
    if ('absente' in r) throw new Error('base attendue');
    assert.equal(f.sqls.at(-1)!.write, false, 'jamais en écriture');
    assert.match(f.sqls.at(-1)!.text, /^SELECT \* FROM \(select base, taille, jeton, ip from v_sauvegardes\) AS lecture_odin LIMIT 201$/);
    assert.deepEqual(r.lignes.map((l) => l.slice(2)), [[MASQUE, MASQUE], [MASQUE, MASQUE]]); assert.deepEqual(r.masquees, ['jeton', 'ip']);
    // Une écriture est refusée avant d'aller à la base.
    const n = f.sqls.length;
    await assert.rejects(() => lireBaseAppli(home, { appli: 'Phénix', requete: 'delete from v_sauvegardes' }), /lecture seulement/);
    assert.equal(f.sqls.length, n, 'rien n\'est parti vers la base');
    // Traçabilité : qui, quelle base, quelles tables, quand, pourquoi — jamais les valeurs.
    const t = traces(home, { appli: 'sindri' });
    assert.equal(t.length, 2); assert.equal(t[0].op, 'lecture'); assert.equal(t[0].base, 'PHENIX_ODIN'); assert.deepEqual(t[0].tables, ['v_sauvegardes']);
    assert.equal(t[0].pourquoi, 'combien de sauvegardes'); assert.equal(t[1].at, '2026-11-15T10:32:00.000Z'); assert.ok(t[0].qui.startsWith('Odin'));
    const brut = readFileSync(join(home, 'valhalla', 'urdr', 'liens-bases.jsonl'), 'utf8');
    assert.doesNotMatch(brut, /abcdef123456|192\.168\.1\.20|1200/, 'aucune valeur lue dans le journal');
    // Mémoire : « quand as-tu regardé la base de Phénix ? »
    assert.equal(souvenirs.length, 2); assert.match(souvenirs[0][0], /2026-11-15 à 10:32.*base de Phénix \(PHENIX_ODIN\)/); assert.equal(souvenirs[0][1], 'base Phénix');
    // Une appli sans base : Odin le dit, avec où sont ses données.
    const abs = await lireBaseAppli(home, { appli: 'Tirésias' });
    assert.ok('absente' in abs && /pas encore de base.*TIRESIAS_ODIN/.test(abs.absente));
    assert.deepEqual(tablesDe('select a from "journaux".v_alertes join x on true where t = \'from secret\''), ['journaux.v_alertes', 'x']);
  } finally { useOpener(undefined); brancherMemoire(undefined); rmSync(home, { recursive: true, force: true }); }
});

test('déménagement des journaux : l\'ancien journal d\'attente commun est réparti dans celui de chaque appli, rien n\'est perdu', () => {
  const home = tmp();
  try {
    const d = join(home, 'valhalla', 'journaux'); mkdirSync(d, { recursive: true });
    const l = [['alertes', 'a1'], ['arche', 'b1'], ['connexions', 'c1'], ['alertes', 'a2'], ['forge_fjalar', 'f1']].map(([j, u]) => JSON.stringify({ k: 'ajout', p: [u, j, '2026-11-15T00:00:00Z', '{}'] }));
    writeFileSync(join(d, '.attente-base.jsonl'), `${l.join('\n')}\n`);
    assert.equal(repartirAttenteCommune(home), 5);
    const lu = (a: string) => readFileSync(join(d, a, '.attente-base.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x).p[0]);
    assert.deepEqual(lu('forseti'), ['a1', 'a2']); assert.deepEqual(lu('skuld'), ['b1']); assert.deepEqual(lu('var'), ['c1']); assert.deepEqual(lu('fjalar'), ['f1']);
    assert.ok(!existsSync(join(d, '.attente-base.jsonl')) && readdirSync(d).some((f) => f.startsWith('.attente-base.jsonl.reparti-')), 'l\'ancien fichier est gardé à côté');
    assert.equal(repartirAttenteCommune(home), 0, 'une seule fois');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Cerveau : la fiche de l\'appli dit sa base, ses tables et ses liens ; Arche sauvegarde la base sous son vrai nom', async () => {
  const m = modules().find((x) => x.id === 'pegase')!, f = appSheet(m, [m]).body;
  assert.match(f, /## Sa base/); assert.match(f, /\*\*PEGASE_ODIN\*\*/); assert.match(f, /pegase\.enregistrements/); assert.match(f, /lecture seule/);
  const v = modules().find((x) => x.id === 'sindri')!; assert.match(appSheet(v, [v]).body, /PHENIX_ODIN[\s\S]*en fichiers : dépôt des sauvegardes/);
  // Arche : le nom de la base passe tel quel au programme (aucune mise en minuscules).
  const home = tmp(), out = join(home, 'x.dump');
  try {
    await dump(home, { id: 'odin-sindri', nom: 'PHENIX_ODIN', type: 'postgres', utilisateur: 'odin_lecture', base: 'PHENIX_ODIN', conteneur: 'odin-pg', ajoutee: '' }, out, {
      inContainer: async (_ct, argv) => ({ cmd: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...argv], env: {} }), has: async () => true,
    });
    const argv = JSON.parse(readFileSync(out, 'utf8')) as string[];
    assert.deepEqual(argv.slice(argv.indexOf('-d'), argv.indexOf('-d') + 2), ['-d', 'PHENIX_ODIN']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
