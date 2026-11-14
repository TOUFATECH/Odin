// Un vrai serveur PostgreSQL jetable pour les essais (les programmes de la machine : initdb, pg_ctl), créé par le
// même code qu'Odin (base/serveur.ts, mode « serveur à Odin »), dans un dossier temporaire, sur un port libre.
// On peut l'arrêter et le relancer (essai « base arrêtée puis revenue ») ; il est effacé à la fin.
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arreterLocale, creerLocale, demarrerLocale, programmes, type Cible } from '../../src/valhalla/base/serveur.ts';

export interface PgJetable { home: string; cible: Cible; arreter(): Promise<void>; relancer(): Promise<void>; fin(): Promise<void> }
export const pgDisponible = (): boolean => Boolean(programmes()) && (process.getuid?.() !== 0 || (() => { try { return readFileSync('/etc/passwd', 'utf8').includes('\npostgres:'); } catch { return false; } })());

export async function pgJetable(home?: string): Promise<PgJetable> {
  const racine = mkdtempSync(join(tmpdir(), 'odin-pg-')); chmodSync(racine, 0o755);
  const h = home ?? join(racine, 'odin');
  const port = await new Promise<number>((ok, ko) => { import('node:net').then(({ createServer }) => { const s = createServer(); s.once('error', ko); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); }); });
  const cible = await creerLocale(h, { donnees: join(racine, 'pg'), port });
  if (!cible) throw new Error('PostgreSQL absent de la machine');
  await demarrerLocale(cible);
  return {
    home: h, cible,
    arreter: () => arreterLocale(cible),
    relancer: () => demarrerLocale(cible),
    fin: async () => { await arreterLocale(cible).catch(() => undefined); rmSync(racine, { recursive: true, force: true }); },
  };
}
