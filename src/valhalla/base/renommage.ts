// Alexandrie — renommer une base (ou un compte) PostgreSQL sans rien perdre : la base garde ses données, seul son nom
// change. Idempotent (le refaire ne change rien), et le retour se fait par le même chemin (nouveau → ancien).
//
// - Les noms sont TOUJOURS entre guillemets (sinon PostgreSQL les met en minuscules : PHENIX_ODIN deviendrait phenix_odin).
// - Avant de renommer une base : plus aucune nouvelle connexion, celles qui restent sont fermées (le renommage est
//   refusé tant que quelqu'un y est connecté), puis les connexions sont rouvertes sous le nouveau nom.
// - Les deux noms existent déjà : rien n'est touché (on n'écrase jamais une base).
import { ident } from './noms.ts';

/** Ce qu'il faut pour parler au serveur (une connexion administrateur à la base « postgres », ou un faux pour les essais). */
export interface Executeur {
  query(sql: string, params?: Array<string | number | boolean | null>): Promise<{ rows: Array<Array<string | null>> }>;
  simple(sql: string): Promise<unknown>;
}
export type Resultat = 'renommee' | 'deja' | 'absente';

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function baseExiste(c: Executeur, nom: string): Promise<boolean> { return (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [nom])).rows.length > 0; }
export async function compteExiste(c: Executeur, nom: string): Promise<boolean> { return (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nom])).rows.length > 0; }

/** Renomme la base `ancien` en `nouveau`. « deja » : c'est déjà fait ; « absente » : aucune des deux n'existe. */
export async function renommerBase(c: Executeur, ancien: string, nouveau: string): Promise<Resultat> {
  if (ancien === nouveau) return 'deja';
  const a = await baseExiste(c, ancien), n = await baseExiste(c, nouveau);
  if (!a) return n ? 'deja' : 'absente';
  if (n) throw new Error(`les bases ${ancien} et ${nouveau} existent toutes les deux : rien n'est touché (regarde-les dans Alexandrie)`);
  await c.simple(`ALTER DATABASE ${ident(ancien)} ALLOW_CONNECTIONS false`);
  try {
    let derniere: unknown;
    for (let essai = 0; essai < 10; essai++) {
      await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [ancien]).catch(() => undefined);
      try { await c.simple(`ALTER DATABASE ${ident(ancien)} RENAME TO ${ident(nouveau)}`); derniere = undefined; break; }
      catch (e) { derniere = e; if (!/55006|being accessed|est en cours d'utilisation/i.test(`${(e as { code?: string }).code ?? ''} ${(e as Error).message}`)) throw e; await attendre(200); }
    }
    if (derniere) throw derniere;
  } catch (e) {
    await c.simple(`ALTER DATABASE ${ident(ancien)} ALLOW_CONNECTIONS true`).catch(() => undefined);
    throw e;
  }
  await c.simple(`ALTER DATABASE ${ident(nouveau)} ALLOW_CONNECTIONS true`);
  return 'renommee';
}

/** Renomme un compte ; le mot de passe est remis (un compte au mot de passe MD5 le perd en changeant de nom). */
export async function renommerCompte(c: Executeur, ancien: string, nouveau: string, motDePasse?: string): Promise<Resultat> {
  if (ancien === nouveau) return 'deja';
  const a = await compteExiste(c, ancien), n = await compteExiste(c, nouveau);
  if (!a) return n ? 'deja' : 'absente';
  if (n) throw new Error(`les comptes ${ancien} et ${nouveau} existent tous les deux : rien n'est touché`);
  await c.simple(`ALTER ROLE ${ident(ancien)} RENAME TO ${ident(nouveau)}`);
  if (motDePasse) await c.simple(`ALTER ROLE ${ident(nouveau)} PASSWORD ${lit(motDePasse)}`);
  return 'renommee';
}
