// Orchestration d'un balayage : découverte → fusion dans l'inventaire → rapport.
import type { OdinConfig } from '../config.ts';
import { discover, type DiscoverOptions, type Found, type Subnet } from './discover.ts';
import { type Inventory, type ScanReport } from './inventory.ts';

export type DiscoverFn = (o: DiscoverOptions) => Promise<{ subnets: Subnet[]; found: Found[] }>;

/**
 * La découverte utilisée quand l'appelant n'en donne pas : le vrai réseau de la machine. Les essais la remplacent
 * (test/helpers.ts) pour ne JAMAIS balayer le réseau de la maison par accident.
 */
let decouverteParDefaut: DiscoverFn = discover;
export function definirDecouverteParDefaut(fn?: DiscoverFn): void { decouverteParDefaut = fn ?? discover; }

export async function scanNetwork(inv: Inventory, cfg: OdinConfig['network'], full: boolean, discoverFn?: DiscoverFn): Promise<ScanReport> {
  const { subnets, found } = await (discoverFn ?? decouverteParDefaut)({ full });
  return inv.applyScan(found, subnets.map((s) => s.cidr), Date.now(), cfg.removeAfterDays, full);
}

/** Un balayage complet tous les `fullEvery` balayages (ou si aucun n'a jamais eu lieu). */
export function shouldRunFull(inv: Inventory, fullEvery: number): boolean {
  const rows = inv.recentScans(Math.max(1, fullEvery));
  return rows.length === 0 || (rows.length >= fullEvery && rows.every((r) => r.full === 0));
}
