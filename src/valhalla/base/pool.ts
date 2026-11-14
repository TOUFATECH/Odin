// La base d'Odin — une petite réserve de connexions PostgreSQL pour un compte (une appli, ou l'administrateur).
// Requêtes paramétrées SEULEMENT : un texte SQL qui contient une valeur collée (guillemet simple) est refusé ;
// les valeurs passent toujours à part ($1, $2…). Seules les migrations (SQL écrit dans le code d'Odin) passent par
// `migration()`, qui accepte plusieurs instructions.
import { Pg, PgError, type PgOpts, type Result } from '../urdr/pg.ts';

export type Valeur = string | number | boolean | null;

/** Une connexion perdue (serveur arrêté, réseau) : à distinguer d'une erreur SQL (requête fausse, contrainte). */
export const connexionPerdue = (e: unknown): boolean => !(e instanceof PgError) || /^(57P0[123]|08\d{3}|53300)$/.test(e.code);

/** Refuse un texte SQL qui contient une valeur collée : elle doit passer en paramètre. */
export function sansValeurCollee(sql: string): void {
  if (sql.includes("'")) throw new Error('requête refusée : une valeur est collée dans le SQL (passe-la en paramètre $1, $2…)');
}

export interface Lien {
  /** une instruction, valeurs à part */
  q(sql: string, params?: Valeur[]): Promise<Result>;
}

export class Reserve implements Lien {
  private libres: Pg[] = []; private ouvertes = 0; private file: Array<{ ok: (c: Pg) => void; ko: (e: unknown) => void }> = []; private ferme = false;
  private o: PgOpts; private max: number;
  constructor(o: PgOpts, max = 2) { this.o = { timeoutMs: 5000, ...o }; this.max = max; }

  private async prendre(): Promise<Pg> {
    if (this.ferme) throw new Error('la base d\'Odin est fermée');
    const c = this.libres.pop(); if (c) return c;
    if (this.ouvertes < this.max) { this.ouvertes++; try { return await Pg.connect(this.o); } catch (e) { this.ouvertes--; throw e; } }
    return new Promise((ok, ko) => this.file.push({ ok, ko }));
  }
  private rendre(c: Pg, casse: boolean): void {
    if (casse || this.ferme) { this.ouvertes--; void c.close().catch(() => undefined); const w = this.file.shift(); if (w) void this.prendre().then(w.ok, w.ko); return; }
    const w = this.file.shift(); if (w) w.ok(c); else this.libres.push(c);
  }
  /** Une connexion pour le temps de `f` (rendue cassée si la connexion a lâché). */
  async avec<T>(f: (c: Pg) => Promise<T>, essai = 0): Promise<T> {
    const reprise = this.libres.length > 0, c = await this.prendre();
    try { const r = await f(c); this.rendre(c, false); return r; } catch (e) {
      const perdue = connexionPerdue(e); this.rendre(c, perdue);
      // Une connexion gardée de côté a pu lâcher pendant qu'elle dormait (serveur redémarré) : un seul nouvel essai.
      if (perdue && reprise && essai === 0 && !(e instanceof PgError)) return this.avec(f, 1);
      throw e;
    }
  }
  async q(sql: string, params: Valeur[] = []): Promise<Result> { sansValeurCollee(sql); return this.avec((c) => c.query(sql, params)); }
  /** Plusieurs requêtes d'un coup : tout ou rien. */
  tx<T>(f: (l: Lien) => Promise<T>): Promise<T> {
    return this.avec(async (c) => {
      await c.simple('BEGIN');
      try { const r = await f({ q: (sql, p = []) => { sansValeurCollee(sql); return c.query(sql, p); } }); await c.simple('COMMIT'); return r; }
      catch (e) { await c.simple('ROLLBACK').catch(() => undefined); throw e; }
    });
  }
  /** SQL écrit dans le code d'Odin (migrations, création des comptes) : plusieurs instructions, dans une transaction. */
  migration(sql: string): Promise<void> {
    return this.avec(async (c) => { await c.simple('BEGIN'); try { await c.simple(sql); await c.simple('COMMIT'); } catch (e) { await c.simple('ROLLBACK').catch(() => undefined); throw e; } });
  }
  /** Le serveur répond-il ? */
  async repond(): Promise<boolean> { try { await this.q('SELECT 1'); return true; } catch { return false; } }
  async fermer(): Promise<void> { this.ferme = true; for (const w of this.file.splice(0)) w.ko(new Error('la base d\'Odin est fermée')); const l = this.libres; this.libres = []; for (const c of l) await c.close().catch(() => undefined); this.ouvertes = 0; }
}
