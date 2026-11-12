// Orchestration d'un balayage : découverte → fusion dans l'inventaire → rapport.
import type { OdinConfig } from '../config.ts';
import { discover, type DiscoverOptions, type Found, type Subnet } from './discover.ts';
import { type Inventory, type ScanReport } from './inventory.ts';

export type DiscoverFn = (o: DiscoverOptions) => Promise<{ subnets: Subnet[]; found: Found[] }>;

export async function scanNetwork(inv: Inventory, cfg: OdinConfig['network'], full: boolean, discoverFn: DiscoverFn = discover): Promise<ScanReport> {
  const { subnets, found } = await discoverFn({ full });
  return inv.applyScan(found, subnets.map((s) => s.cidr), Date.now(), cfg.removeAfterDays, full);
}

/** Un balayage complet tous les `fullEvery` balayages (ou si aucun n'a jamais eu lieu). */
export function shouldRunFull(inv: Inventory, fullEvery: number): boolean {
  const rows = inv.recentScans(Math.max(1, fullEvery));
  return rows.length === 0 || (rows.length >= fullEvery && rows.every((r) => r.full === 0));
}
