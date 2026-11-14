// La base d'Odin — où tourne le serveur PostgreSQL qui garde les données des applis, et comment le démarrer.
// Ordre de choix (le choix est gardé dans valhalla/urdr/base-odin.json, le mot de passe dans les secrets d'Alexandrie) :
//   1. un PostgreSQL déjà présent sur la machine, qui tourne, et qu'Odin peut administrer (Odin lancé en root :
//      le compte « odin » est créé par le compte système « postgres », le mot de passe passe par l'entrée standard,
//      jamais sur la ligne de commande) ;
//   2. les programmes PostgreSQL présents (initdb, pg_ctl) : Odin crée SON serveur (127.0.0.1 seulement, port libre,
//      SCRAM-SHA-256, dossier protégé) et le démarre à chaque lancement ;
//   3. sinon Hringhorni (le moteur de conteneurs d'Odin, pas Docker) : le serveur « odin-pg » d'Alexandrie.
// Zéro SQLite, zéro Docker.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync, chownSync } from 'node:fs';
import { createServer, connect as tcp } from 'node:net';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { dirOf, password, setPassword } from '../urdr/bases.ts';

export type Mode = 'machine' | 'locale' | 'hringhorni';
export interface Cible {
  mode: Mode; hote: string; port: number; admin: string;
  /** serveur à Odin : programmes, dossier des données, compte système qui le fait tourner, dossier de la prise locale */
  bin?: string; donnees?: string; sous?: string; prise?: string;
  /** Hringhorni : le conteneur */
  conteneur?: string;
  /** mot de passe déjà rangé dans le coffre */
  coffre?: boolean;
  creee: string;
}
export const SECRET_ADMIN = 'odin-admin';
const fichier = (home: string) => join(dirOf(home), 'base-odin.json');
export function cibleGardee(home: string): Cible | undefined { try { return JSON.parse(readFileSync(fichier(home), 'utf8')) as Cible; } catch { return undefined; } }
export function garderCible(home: string, c: Cible | undefined): void {
  const f = fichier(home); if (!c) { rmSync(f, { force: true }); return; }
  mkdirSync(dirOf(home), { recursive: true, mode: 0o700 }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(c, null, 1), { mode: 0o600 }); renameSync(t, f);
}
export const motDePasseAdmin = (home: string) => password(home, SECRET_ADMIN);

/** Lance un programme ; `entree` est écrite sur son entrée standard (jamais sur la ligne de commande). */
export function lancer(cmd: string, args: string[], o: { sous?: string; entree?: string; env?: Record<string, string>; ms?: number } = {}): Promise<{ code: number; sortie: string }> {
  const root = process.getuid?.() === 0, [c, a] = o.sous && root && o.sous !== userInfo().username ? ['runuser', ['-u', o.sous, '--', cmd, ...args]] : [cmd, args];
  return new Promise((ok) => {
    let p; try { p = spawn(c, a, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', ...o.env } }); } catch (e) { ok({ code: 127, sortie: (e as Error).message }); return; }
    let out = ''; const t = setTimeout(() => p.kill('SIGKILL'), o.ms ?? 120_000);
    p.stdout.on('data', (d) => { out = (out + d).slice(-8000); }); p.stderr.on('data', (d) => { out = (out + d).slice(-8000); });
    p.on('error', (e) => { clearTimeout(t); ok({ code: 127, sortie: e.message }); });
    p.on('close', (code) => { clearTimeout(t); ok({ code: code ?? 1, sortie: out.trim() }); });
    p.stdin.on('error', () => undefined); p.stdin.end(o.entree ?? '');
  });
}

/** Les programmes PostgreSQL de la machine (la version la plus récente). */
export function programmes(): string | undefined {
  const dirs: Array<[number, string]> = [];
  const voir = (base: string, re: RegExp, bin: (n: string) => string) => { try { for (const n of readdirSync(base)) { const m = re.exec(n); if (m && existsSync(join(bin(n), 'initdb')) && existsSync(join(bin(n), 'pg_ctl'))) dirs.push([Number(m[1]) || 0, bin(n)]); } } catch { /* absent */ } };
  voir('/usr/lib/postgresql', /^(\d+)$/, (n) => join('/usr/lib/postgresql', n, 'bin'));
  voir('/usr', /^pgsql-(\d+)$/, (n) => join('/usr', n, 'bin'));
  voir('/opt/homebrew/opt', /^postgresql@?(\d*)$/, (n) => join('/opt/homebrew/opt', n, 'bin'));
  voir('/usr/local/opt', /^postgresql@?(\d*)$/, (n) => join('/usr/local/opt', n, 'bin'));
  for (const d of [...(process.env.PATH ?? '').split(':'), '/usr/local/pgsql/bin']) if (d && existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl'))) dirs.push([0, d]);
  return dirs.sort((a, b) => b[0] - a[0])[0]?.[1];
}
const ouvert = (hote: string, port: number, ms = 1500) => new Promise<boolean>((ok) => { const s = tcp({ host: hote, port }); const t = setTimeout(() => { s.destroy(); ok(false); }, ms); s.once('connect', () => { clearTimeout(t); s.destroy(); ok(true); }); s.once('error', () => { clearTimeout(t); ok(false); }); });
async function portLibre(depuis = 5433): Promise<number> {
  for (let p = depuis; p < depuis + 200; p++) {
    const libre = await new Promise<boolean>((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(p, '127.0.0.1', () => s.close(() => ok(true))); });
    if (libre && !(await ouvert('127.0.0.1', p, 300))) return p;
  }
  throw new Error('aucun port libre pour la base d\'Odin');
}
const existeCompte = (n: string) => { try { return readFileSync('/etc/passwd', 'utf8').split('\n').some((l) => l.startsWith(`${n}:`)); } catch { return false; } };
const motDePasse = () => randomBytes(24).toString('base64url');

/** 1. Un PostgreSQL de la machine qui tourne déjà, administrable par le compte système « postgres » (Odin en root). */
export async function essayerMachine(home: string, o: { hote?: string; port?: number; prise?: string; sous?: string } = {}): Promise<Cible | undefined> {
  const hote = o.hote ?? '127.0.0.1', port = o.port ?? 5432, sous = o.sous ?? 'postgres';
  if (process.getuid?.() !== 0 || !existeCompte(sous) || !(await ouvert(hote, port))) return undefined;
  const bin = programmes(), psql = bin ? join(bin, 'psql') : 'psql';
  const pw = motDePasseAdmin(home) ?? motDePasse();
  // Le mot de passe (lettres, chiffres, - et _ seulement) passe par l'entrée standard de psql.
  const sql = `DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odin') THEN CREATE ROLE odin LOGIN CREATEDB CREATEROLE; END IF; END$$;\nALTER ROLE odin LOGIN CREATEDB CREATEROLE PASSWORD '${pw.replace(/[^\w-]/g, '')}';\n`;
  const r = await lancer(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(o.prise ? ['-h', o.prise] : []), '-p', String(port), '-d', 'postgres'], { sous, entree: sql, ms: 30_000 });
  if (r.code !== 0) return undefined;
  setPassword(home, SECRET_ADMIN, pw);
  return { mode: 'machine', hote, port, admin: 'odin', sous, ...(o.prise ? { prise: o.prise } : {}), creee: new Date().toISOString() };
}

/** 2. Le serveur à Odin, créé avec les programmes de la machine. */
export async function creerLocale(home: string, o: { bin?: string; donnees?: string; port?: number; sous?: string } = {}): Promise<Cible | undefined> {
  const bin = o.bin ?? programmes(); if (!bin) return undefined;
  const root = process.getuid?.() === 0, sous = o.sous ?? (root ? 'postgres' : userInfo().username);
  if (root && sous === 'root') return undefined; // PostgreSQL refuse de tourner en root
  if (root && !existeCompte(sous)) return undefined;
  // En root, le dossier doit être lisible par le compte « postgres » (le dossier d'Odin, sous /root, ne l'est pas).
  const donnees = o.donnees ?? (root ? join('/var/lib/odin-pg', createHash('sha256').update(home).digest('hex').slice(0, 10)) : join(dirOf(home), 'donnees', 'odin-locale'));
  const pw = motDePasseAdmin(home) ?? motDePasse(), port = o.port ?? await portLibre();
  const cible: Cible = { mode: 'locale', hote: '127.0.0.1', port, admin: 'odin', bin, donnees, sous, prise: join(donnees, 'prise'), creee: new Date().toISOString() };
  if (!existsSync(join(donnees, 'data', 'PG_VERSION'))) {
    if (root) mkdirSync(dirname(donnees), { recursive: true, mode: 0o755 });
    mkdirSync(join(donnees, 'prise'), { recursive: true, mode: 0o700 });
    const pwf = join(donnees, '.mdp'); writeFileSync(pwf, pw, { mode: 0o600 });
    if (root) for (const d of [donnees, join(donnees, 'prise'), pwf]) chownSync(d, ...ids(sous));
    try {
      const r = await lancer(join(bin, 'initdb'), ['-D', join(donnees, 'data'), '-U', 'odin', '--auth=scram-sha-256', `--pwfile=${pwf}`, '-E', 'UTF8', '--no-locale'], { sous, ms: 180_000 });
      if (r.code !== 0) throw new Error(`initdb : ${r.sortie.split('\n').slice(-3).join(' ')}`);
    } finally { rmSync(pwf, { force: true }); }
    // 127.0.0.1 seulement ; la prise locale dans le dossier de la base (rien dans /var/run, rien dehors).
    const prise = cible.prise!.length < 90 ? cible.prise! : '';
    if (!prise) cible.prise = undefined;
    appendFileSync(join(donnees, 'data', 'postgresql.conf'), `\n# Base d'Odin (données des applis)\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${prise}'\nmax_connections = 60\nshared_buffers = 64MB\npassword_encryption = 'scram-sha-256'\n`);
  }
  setPassword(home, SECRET_ADMIN, pw);
  return cible;
}
function ids(n: string): [number, number] { const l = readFileSync('/etc/passwd', 'utf8').split('\n').find((x) => x.startsWith(`${n}:`))!.split(':'); return [Number(l[2]), Number(l[3])]; }

/** Le serveur à Odin tourne-t-il ? Sinon on le démarre. */
export async function demarrerLocale(c: Cible): Promise<void> {
  if (c.mode !== 'locale' || !c.bin || !c.donnees) return;
  const data = join(c.donnees, 'data');
  if ((await lancer(join(c.bin, 'pg_ctl'), ['-D', data, 'status'], { sous: c.sous, ms: 20_000 })).code === 0) return;
  const r = await lancer(join(c.bin, 'pg_ctl'), ['-D', data, '-l', join(c.donnees, 'journal.log'), '-w', '-t', '90', 'start'], { sous: c.sous, ms: 120_000 });
  if (r.code !== 0) throw new Error(`le serveur de la base d'Odin ne démarre pas : ${r.sortie.split('\n').slice(-2).join(' ')} (journal : ${join(c.donnees, 'journal.log')})`);
}
/** Arrête le serveur à Odin (les essais ; et l'action d'Alexandrie, avec ton accord). */
export async function arreterLocale(c: Cible): Promise<void> {
  if (c.mode !== 'locale' || !c.bin || !c.donnees) return;
  await lancer(join(c.bin, 'pg_ctl'), ['-D', join(c.donnees, 'data'), '-m', 'fast', '-w', 'stop'], { sous: c.sous, ms: 60_000 });
}

/** Choisit la cible (une fois) : machine, puis serveur à Odin, sinon rien (Hringhorni est essayé par l'appelant). */
export async function choisir(home: string): Promise<Cible | undefined> {
  const g = cibleGardee(home); if (g && motDePasseAdmin(home)) return g;
  const c = (await essayerMachine(home)) ?? (await creerLocale(home));
  if (c) { garderCible(home, c); chmodSync(fichier(home), 0o600); }
  return c;
}
