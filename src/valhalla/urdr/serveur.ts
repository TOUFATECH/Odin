// Urðr — LA base de données d'Odin : un seul serveur PostgreSQL (« odin-pg ») dans le moteur de conteneurs, à une
// adresse fixe du réseau privé des conteneurs (jamais publié dehors). Chaque appli qui a besoin d'une base y reçoit
// la sienne, avec son propre compte (elle ne voit pas celles des autres) ; le mot de passe est généré et rangé dans
// le coffre, et Skuld la sauvegarde chaque nuit. Pas de fichier SQLite pour les applis installées.
import { randomBytes } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pg } from './pg.ts';
import { bases, dirOf, password, saveBases, setPassword, type Base } from './bases.ts';
import { SUBNET } from '../hringhorni/net.ts';
import type { Engine, Job } from '../hringhorni/engine.ts';

export const SERVER = 'odin-pg';
export const SERVER_IP = `${SUBNET}.250`;
export const PG_VERSION = '18';
/** Port du serveur (5432 ; changé seulement par les essais). */
let port = 5432;
export function useServerPort(p: number) { port = p; }
export const serverBase = (home: string): Base | undefined => bases(home).find((b) => b.id === SERVER);

/** Ce qu'une appli reçoit pour joindre sa base. */
export interface DbInfo { host: string; ip: string; port: number; database: string; user: string; password: string; url: string }

/** Le serveur tourne-t-il et accepte-t-il les connexions ? */
export async function serverReady(home: string, e: Pick<Engine, 'find'>): Promise<boolean> {
  try { const c = e.find(SERVER); if (c.state.status !== 'en marche' || !c.state.ip) return false; const p = await Pg.connect({ host: c.state.ip, port, user: 'postgres', password: password(home, SERVER), database: 'postgres', ssl: 'non', timeoutMs: 3000 }); await p.close(); return true; } catch { return false; }
}
/** Crée le serveur (une fois) : mot de passe généré, données dans le dossier d'Urðr, adresse fixe, grandit tout seul. */
export function createServer(home: string, e: Pick<Engine, 'find' | 'runJob'>, now = new Date()): Job | undefined {
  try { e.find(SERVER); return undefined; } catch { /* à créer */ }
  const data = join(dirOf(home), 'donnees', SERVER); mkdirSync(data, { recursive: true, mode: 0o700 });
  let pw = password(home, SERVER); if (!pw) { pw = randomBytes(24).toString('base64url'); setPassword(home, SERVER, pw); }
  const maxMem = Math.max(1, Math.floor(totalmem() / 1024 ** 3 / 2)), maxCpus = Math.max(1, Math.floor(cpus().length / 2));
  if (!serverBase(home)) saveBases(home, [...bases(home), { id: SERVER, nom: 'Base d\'Odin', type: 'postgres', utilisateur: 'postgres', base: 'postgres', conteneur: SERVER, version: PG_VERSION, ssl: 'non', ajoutee: now.toISOString() }]);
  return e.runJob({ image: `postgres:${PG_VERSION}`, name: SERVER, env: { POSTGRES_PASSWORD: pw }, mounts: `${data}:/var/lib/postgresql`, restart: 'sauf-arret', memory: '1g', cpus: '1',
    cmd: ['postgres', '-c', 'max_connections=500', '-c', 'shared_buffers=256MB', '-c', 'listen_addresses=*'],
    labels: { 'odin.ip': SERVER_IP, 'odin.grandir': `1g-${maxMem}g/1-${maxCpus}`, 'odin.role': 'base-odin' } });
}
/** Attend que le serveur réponde (après sa création ou un redémarrage). */
export async function waitServer(home: string, e: Pick<Engine, 'find'>, ms = 180_000): Promise<void> {
  const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await serverReady(home, e)) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error('la base d\'Odin ne répond pas (regarde son journal dans Naglfar : odin-pg)');
}
export const roleOf = (app: string) => (`app_${app.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 50).replace(/_$/, '')) || 'app_base';

/** Une base pour une appli (ou celle qu'elle a déjà) : compte à elle, droits sur sa base seulement. */
export async function provision(home: string, e: Pick<Engine, 'find'>, app: string, now = new Date()): Promise<{ info: DbInfo; created: boolean; base: Base }> {
  const srv = e.find(SERVER); if (srv.state.status !== 'en marche' || !srv.state.ip) throw new Error('la base d\'Odin ne tourne pas');
  const role = roleOf(app), have = bases(home).find((b) => b.conteneur === SERVER && b.utilisateur === role);
  const info = (pw: string): DbInfo => ({ host: SERVER, ip: SERVER_IP, port: 5432, database: role, user: role, password: pw, url: `postgresql://${role}:${pw}@${SERVER}:5432/${role}` });
  if (have && password(home, have.id)) return { info: info(password(home, have.id)!), created: false, base: have };
  const pw = randomBytes(24).toString('base64url');
  const c = await Pg.connect({ host: srv.state.ip, port, user: 'postgres', password: password(home, SERVER), database: 'postgres', ssl: 'non' });
  try {
    // les noms et le mot de passe passent par format(%I, %L) côté serveur : jamais collés à la main dans le SQL
    const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length > 0;
    const ddl = await c.query(`SELECT format(${exists ? "'ALTER ROLE %I LOGIN PASSWORD %L'" : "'CREATE ROLE %I LOGIN PASSWORD %L'"}, $1::text, $2::text)`, [role, pw]);
    await c.simple(ddl.rows[0][0]!);
    if (!(await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [role])).rows.length) {
      await c.simple((await c.query(`SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $1::text)`, [role])).rows[0][0]!);
      await c.simple((await c.query(`SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', $1::text)`, [role])).rows[0][0]!);
    }
  } finally { await c.close(); }
  const base: Base = have ?? { id: role.replace(/_/g, '-'), nom: app, type: 'postgres', utilisateur: role, base: role, conteneur: SERVER, version: PG_VERSION, ssl: 'non', ajoutee: now.toISOString() };
  if (!have) saveBases(home, [...bases(home), base]);
  setPassword(home, base.id, pw);
  return { info: info(pw), created: true, base };
}

/** Les applis connues qui ont besoin d'une base : elles la reçoivent d'office (sans fichier SQLite). */
export const needsDb = (image: string) => /(^|\/)n8n(:|$)|n8nio\/|(^|\/)nextcloud(:|$)|gitea|forgejo|authentik|vaultwarden|umami|outline|plausible|cal\.com|calcom|listmonk|miniflux|linkwarden|hoppscotch/.test(image.toLowerCase());
/** Tout ce qu'il faut pour qu'une appli ait sa base : le serveur (créé et attendu si besoin), sa base, ses variables. */
export async function databaseFor(home: string, e: Pick<Engine, 'find' | 'runJob'>, app: string, image: string): Promise<{ env: Record<string, string>; info: DbInfo; created: boolean; base: Base; serverCreated: boolean }> {
  const job = createServer(home, e); await waitServer(home, e);
  const r = await provision(home, e, app); return { ...r, env: envFor(image, r.info), serverCreated: !!job };
}
/** Les variables que chaque appli connue attend pour sa base ; les autres reçoivent les noms les plus courants. */
export function envFor(image: string, d: DbInfo): Record<string, string> {
  const i = image.toLowerCase(), hp = `${d.host}:${d.port}`;
  if (/(^|\/)n8n(:|$)|n8nio\//.test(i)) return { DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: d.host, DB_POSTGRESDB_PORT: String(d.port), DB_POSTGRESDB_DATABASE: d.database, DB_POSTGRESDB_USER: d.user, DB_POSTGRESDB_PASSWORD: d.password };
  if (/(^|\/)nextcloud(:|$)/.test(i)) return { POSTGRES_HOST: hp, POSTGRES_DB: d.database, POSTGRES_USER: d.user, POSTGRES_PASSWORD: d.password };
  if (/gitea|forgejo/.test(i)) { const p = /forgejo/.test(i) ? 'FORGEJO' : 'GITEA'; return { [`${p}__database__DB_TYPE`]: 'postgres', [`${p}__database__HOST`]: hp, [`${p}__database__NAME`]: d.database, [`${p}__database__USER`]: d.user, [`${p}__database__PASSWD`]: d.password }; }
  if (/authentik/.test(i)) return { AUTHENTIK_POSTGRESQL__HOST: d.host, AUTHENTIK_POSTGRESQL__PORT: String(d.port), AUTHENTIK_POSTGRESQL__NAME: d.database, AUTHENTIK_POSTGRESQL__USER: d.user, AUTHENTIK_POSTGRESQL__PASSWORD: d.password };
  if (/vaultwarden|umami|outline|plausible|cal\.com|calcom|listmonk|miniflux|linkwarden|hoppscotch/.test(i)) return { DATABASE_URL: d.url, ...(/miniflux/.test(i) ? { RUN_MIGRATIONS: '1' } : {}) };
  return { DATABASE_URL: d.url, POSTGRES_HOST: d.host, POSTGRES_PORT: String(d.port), POSTGRES_DB: d.database, POSTGRES_USER: d.user, POSTGRES_PASSWORD: d.password, DB_HOST: d.host, DB_PORT: String(d.port), DB_NAME: d.database, DB_USER: d.user, DB_PASSWORD: d.password, PGHOST: d.host, PGPORT: String(d.port), PGDATABASE: d.database, PGUSER: d.user, PGPASSWORD: d.password };
}
