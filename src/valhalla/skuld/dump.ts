// Skuld — sauvegarder et restaurer une base avec ses outils propres : copie à chaud pour SQLite, pg_dump /
// pg_restore pour PostgreSQL (dans le conteneur d'Odin pour une base qu'il héberge, sinon sur la machine),
// mysqldump pour MySQL / MariaDB, mongodump pour MongoDB. Les mots de passe passent par un fichier temporaire
// protégé (jamais sur la ligne de commande, donc jamais visibles dans la liste des processus).
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { createGunzip, createGzip } from 'node:zlib';
import { password, type Base } from '../urdr/bases.ts';

export interface Tools {
  /** commande à lancer dans le conteneur d'une base hébergée (nsenter…) */
  inContainer(ct: string, argv: string[]): Promise<{ cmd: string; args: string[]; env: Record<string, string> }>;
  has(cmd: string): Promise<boolean>;
}
export interface Done { file: string; bytes: number }

/** Lance une commande ; sa sortie va dans `out` (fichier) ; `input` (fichier) devient son entrée. */
function exec(cmd: string, args: string[], o: { env?: Record<string, string>; out?: string; input?: string; gzipOut?: boolean; gunzipIn?: boolean; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((ok, ko) => {
    const p = spawn(cmd, args, { env: { PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin', ...o.env }, stdio: [o.input ? 'pipe' : 'ignore', o.out ? 'pipe' : 'ignore', 'pipe'] });
    let err = ''; p.stderr!.on('data', (d) => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill('SIGKILL'), o.timeoutMs ?? 6 * 3600_000);
    const jobs: Promise<unknown>[] = [];
    if (o.out) jobs.push(o.gzipOut ? pipeline(p.stdout!, createGzip(), createWriteStream(o.out, { mode: 0o600 })) : pipeline(p.stdout!, createWriteStream(o.out, { mode: 0o600 })));
    if (o.input) jobs.push(o.gunzipIn ? pipeline(createReadStream(o.input), createGunzip(), p.stdin!) : pipeline(createReadStream(o.input), p.stdin!));
    p.on('error', (e) => { clearTimeout(t); ko(e); });
    p.on('close', async (code, sig) => { clearTimeout(t); await Promise.allSettled(jobs); if (code === 0) ok(err); else ko(new Error(`${cmd.split('/').pop()} : ${err.trim().split('\n').slice(-3).join(' ') || (sig ? `arrêté (${sig})` : `code ${code}`)}`)); });
  });
}
/** Un dossier temporaire privé pour les fichiers de mots de passe, effacé à la fin. */
async function secret<T>(f: (dir: string) => Promise<T>): Promise<T> { const d = mkdtempSync(join(tmpdir(), 'odin-skuld-')); try { return await f(d); } finally { rmSync(d, { recursive: true, force: true }); } }
const pgSsl = (b: Base) => ({ non: 'disable', 'si-possible': 'prefer', obligatoire: 'require' })[b.ssl ?? 'si-possible'];
const pgEnv = (home: string, b: Base, dir: string) => { const f = join(dir, 'pgpass'); writeFileSync(f, `*:*:*:*:${(password(home, b.id) ?? '').replace(/[\\:]/g, '\\$&')}\n`, { mode: 0o600 }); return { PGPASSFILE: f, PGSSLMODE: pgSsl(b), PGCONNECT_TIMEOUT: '15' }; };
const pgConn = (b: Base) => ['-h', b.hote ?? '127.0.0.1', '-p', String(b.port ?? 5432), '-U', b.utilisateur ?? 'postgres'];
const myConf = (home: string, b: Base, dir: string) => { const f = join(dir, 'my.cnf'); writeFileSync(f, `[client]\nhost=${b.hote ?? '127.0.0.1'}\nport=${b.port ?? 3306}\nuser=${b.utilisateur ?? 'root'}\npassword="${(password(home, b.id) ?? '').replace(/["\\]/g, '\\$&')}"\n`, { mode: 0o600 }); return f; };
const mongoConf = (home: string, b: Base, dir: string) => { const f = join(dir, 'mongo.yaml'); writeFileSync(f, `password: ${JSON.stringify(password(home, b.id) ?? '')}\n`, { mode: 0o600 }); return f; };
const need = async (t: Tools, c: string, what: string) => { if (!(await t.has(c))) throw new Error(`${c} n'est pas installé sur la machine d'Odin (il faut les outils ${what})`); };

export const extOf = (b: Base) => ({ sqlite: 'sqlite.gz', postgres: 'dump', mysql: 'sql.gz', mongodb: 'archive.gz' })[b.type];

/** Sauvegarde `b` dans `file`. */
export async function dump(home: string, b: Base, file: string, t: Tools): Promise<Done> {
  if (b.type === 'sqlite') {
    if (!b.fichier || !existsSync(b.fichier)) throw new Error(`fichier introuvable : ${b.fichier}`);
    await secret(async (d) => { const tmp = join(d, 'copie.sqlite'), src = new DatabaseSync(b.fichier!, { readOnly: true }); try { await backup(src, tmp); } finally { src.close(); } await pipeline(createReadStream(tmp), createGzip(), createWriteStream(file, { mode: 0o600 })); });
  } else if (b.type === 'postgres') {
    if (b.conteneur) { const x = await t.inContainer(b.conteneur, ['pg_dump', '-U', 'postgres', '-Fc', '-d', b.base ?? 'postgres']); await exec(x.cmd, x.args, { env: x.env, out: file }); }
    else { await need(t, 'pg_dump', 'PostgreSQL'); await secret((d) => exec('pg_dump', [...pgConn(b), '-Fc', '-d', b.base ?? 'postgres'], { env: pgEnv(home, b, d), out: file })); }
  } else if (b.type === 'mysql') {
    const bin = (await t.has('mariadb-dump')) ? 'mariadb-dump' : 'mysqldump'; await need(t, bin, 'MySQL / MariaDB');
    await secret((d) => exec(bin, [`--defaults-extra-file=${myConf(home, b, d)}`, '--single-transaction', '--routines', '--triggers', '--events', b.base ?? ''], { out: file, gzipOut: true }));
  } else if (b.type === 'mongodb') {
    await need(t, 'mongodump', 'MongoDB (database tools)');
    await secret((d) => exec('mongodump', ['--host', b.hote ?? '127.0.0.1', '--port', String(b.port ?? 27017), ...(b.utilisateur ? ['--username', b.utilisateur, '--authenticationDatabase', 'admin', `--config=${mongoConf(home, b, d)}`] : []), ...(b.base ? ['--db', b.base] : []), `--archive=${file}`, '--gzip']));
  }
  return { file, bytes: statSync(file).size };
}

/** Vérifie qu'une sauvegarde se relit : SQLite rouverte et contrôlée, archive PostgreSQL listée, gzip lu jusqu'au bout. */
export async function verify(b: Base, file: string, t: Tools): Promise<string> {
  if (!existsSync(file) || statSync(file).size === 0) throw new Error('sauvegarde vide');
  if (b.type === 'sqlite') return secret(async (d) => { const tmp = join(d, 'v.sqlite'); await pipeline(createReadStream(file), createGunzip(), createWriteStream(tmp)); const db = new DatabaseSync(tmp, { readOnly: true }); try { const r = db.prepare('PRAGMA integrity_check').get() as Record<string, string>; const n = (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n; if (Object.values(r)[0] !== 'ok') throw new Error(`base abîmée : ${Object.values(r)[0]}`); return `vérifiée (rouverte, ${n} tables, intégrité ok)`; } finally { db.close(); } });
  if (b.type === 'postgres') {
    const head = readFileSync(file).subarray(0, 5).toString('latin1'); if (head !== 'PGDMP') throw new Error('ce n\'est pas une archive pg_dump');
    if (await t.has('pg_restore')) { const out = join(file + '.liste'); try { await exec('pg_restore', ['-l', file], { out }); const n = readFileSync(out, 'utf8').split('\n').filter((l) => /^\d+;/.test(l)).length; return `vérifiée (archive relue, ${n} éléments)`; } finally { rmSync(out, { force: true }); } }
    return 'vérifiée (en-tête de l\'archive)';
  }
  let n = 0; await pipeline(createReadStream(file), createGunzip(), async function* (src) { for await (const c of src) n += (c as Buffer).length; yield* []; });
  return `vérifiée (archive relue, ${(n / 1e6).toFixed(1)} Mo)`;
}

/** Restaure : dans une nouvelle base `target` (conseillé) ou par-dessus la base elle-même (`target` = son nom). */
export async function restore(home: string, b: Base, file: string, target: { new: boolean; name: string; file?: string }, t: Tools): Promise<string> {
  if (b.type === 'sqlite') {
    const dest = target.file ?? b.fichier!;
    await secret(async (d) => { const tmp = join(d, 'r.sqlite'); await pipeline(createReadStream(file), createGunzip(), createWriteStream(tmp)); const src = new DatabaseSync(tmp, { readOnly: true }); try { await backup(src, dest); } finally { src.close(); } });
    return dest;
  }
  if (b.type === 'postgres') {
    const user = b.conteneur ? 'postgres' : (b.utilisateur ?? 'postgres'), db = target.name;
    if (b.conteneur) {
      if (target.new) { const c = await t.inContainer(b.conteneur, ['createdb', '-U', user, ...(b.utilisateur && b.utilisateur !== 'postgres' ? ['-O', b.utilisateur] : []), db]); await exec(c.cmd, c.args, { env: c.env }); }
      const r = await t.inContainer(b.conteneur, ['pg_restore', '-U', user, '-d', db, ...(target.new ? ['--no-owner', ...(b.utilisateur && b.utilisateur !== 'postgres' ? ['--role', b.utilisateur] : [])] : ['--clean', '--if-exists'])]);
      await exec(r.cmd, r.args, { env: r.env, input: file });
    } else {
      await need(t, 'pg_restore', 'PostgreSQL');
      await secret(async (d) => { const env = pgEnv(home, b, d); if (target.new) await exec('createdb', [...pgConn(b), db], { env }); await exec('pg_restore', [...pgConn(b), '-d', db, '--no-owner', ...(target.new ? [] : ['--clean', '--if-exists']), file], { env }); });
    }
    return db;
  }
  if (b.type === 'mysql') {
    const bin = (await t.has('mariadb')) ? 'mariadb' : 'mysql'; await need(t, bin, 'MySQL / MariaDB');
    await secret(async (d) => { const cnf = myConf(home, b, d); if (target.new) await exec(bin, [`--defaults-extra-file=${cnf}`, '-e', `CREATE DATABASE \`${target.name.replace(/`/g, '')}\``]); await exec(bin, [`--defaults-extra-file=${cnf}`, target.name], { input: file, gunzipIn: true }); });
    return target.name;
  }
  await need(t, 'mongorestore', 'MongoDB (database tools)');
  await secret((d) => exec('mongorestore', ['--host', b.hote ?? '127.0.0.1', '--port', String(b.port ?? 27017), ...(b.utilisateur ? ['--username', b.utilisateur, '--authenticationDatabase', 'admin', `--config=${mongoConf(home, b, d)}`] : []), `--archive=${file}`, '--gzip', ...(target.new && b.base ? ['--nsFrom', `${b.base}.*`, '--nsTo', `${target.name}.*`] : ['--drop'])]));
  return target.name;
}

/** Ce qu'on garde (comme Portabase / Proxmox Backup) : tout sur `jours` jours, puis une par semaine, puis une par mois. */
export function keep(dates: string[], g: { jours: number; semaines: number; mois: number }, now: Date): Set<string> {
  const k = new Set<string>(), sorted = [...dates].sort().reverse(), day = 864e5, weeks = new Set<string>(), months = new Set<string>();
  const wk = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dn = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dn + 3); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 4)); return `${x.getUTCFullYear()}-${Math.round(((x.getTime() - y.getTime()) / day - 3 + ((y.getUTCDay() + 6) % 7)) / 7) + 1}`; };
  for (const s of sorted) {
    const d = new Date(s), age = (now.getTime() - d.getTime()) / day;
    if (age <= g.jours) { k.add(s); continue; }
    if (age <= g.jours + g.semaines * 7 && !weeks.has(wk(d))) { weeks.add(wk(d)); k.add(s); continue; }
    const m = s.slice(0, 7); if (age <= g.jours + g.semaines * 7 + g.mois * 31 && !months.has(m)) { months.add(m); k.add(s); }
  }
  if (sorted[0]) k.add(sorted[0]); // jamais sans la dernière
  return k;
}
