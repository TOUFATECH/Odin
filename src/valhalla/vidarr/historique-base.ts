// L'historique durable de Sphinx (DNS et DHCP), gardé dans la base de l'appli (VIDARR_ODIN, dans Alexandrie),
// avec repli en fichier tant que la base n'est pas prête (même mécanique que les autres journaux d'Odin).
//
// Deux sortes d'entrées dans le même journal « vidarr » :
//  - « dns »  : une requête (quand, adresse qui demande, domaine, autorisé ou bloqué + par quelle liste, serveur amont).
//  - « bail » : un événement DHCP (quand, MAC, adresse donnée, nom, utilisateur si connu, ce qui se passe).
//
// Vie privée : ces données (qui a visité quoi) sont sensibles. Elles restent dans la base locale d'Odin, jamais
// envoyées dehors. L'anneau en mémoire reste pour l'affichage « direct » ; la base garde l'histoire longue.
import { journalDe, type Journal } from '../base/journal.ts';
import type { LogEntry } from './server.ts';
import type { ModCtx } from '../types.ts';

/** Ce que le DHCP a fait pour un appareil à cet instant. */
export type ActionBail = 'donne' | 'renouvele' | 'libere' | 'refuse' | 'bloque' | 'pause' | 'actif' | 'attente';
/** Une entrée de l'historique : une requête DNS, ou un événement de bail DHCP. */
export type EvtHist =
  | { k: 'dns'; t: number; ip: string; nom: string; statut: LogEntry['status']; liste?: string; amont?: string }
  | { k: 'bail'; t: number; mac: string; ip: string; nom?: string; utilisateur?: string; action: ActionBail };
export type EvtBail = Extract<EvtHist, { k: 'bail' }>;
export type EvtDns = Extract<EvtHist, { k: 'dns' }>;
export type PeriodeHist = 'heure' | 'jour' | 'semaine' | 'mois' | 'annee';

const SPAN: Record<PeriodeHist, number> = { heure: 3600_000, jour: 86400_000, semaine: 7 * 86400_000, mois: 30 * 86400_000, annee: 365 * 86400_000 };
/** Garde les entrées des `periode` écoulées (fenêtre glissante simple, honnête : « 7 derniers jours » pour la semaine). Pur. */
export function filtrerPeriode<T>(items: T[], quand: (x: T) => number, periode: PeriodeHist, now = Date.now()): T[] {
  const span = SPAN[periode];
  return items.filter((x) => now - quand(x) <= span);
}

/**
 * La machine (MAC, nom, utilisateur) qui tenait cette adresse IP à l'instant `t`, d'après l'historique des baux.
 * Une IP est redonnée à d'autres machines au fil du temps : on prend le dernier bail DONNÉ (ou renouvelé) pour cette
 * IP avant `t`. Une requête d'hier 15 h appartient à la machine qui tenait l'IP à 15 h hier, pas à celle d'aujourd'hui. Pur.
 */
export function machineAt(baux: EvtBail[], ip: string, t: number): { mac: string; nom?: string; utilisateur?: string } | undefined {
  let best: EvtBail | undefined;
  for (const e of baux) if (e.ip === ip && e.t <= t && (e.action === 'donne' || e.action === 'renouvele')) { if (!best || e.t > best.t) best = e; }
  return best ? { mac: best.mac, nom: best.nom, utilisateur: best.utilisateur } : undefined;
}

/** Les requêtes DNS attribuées à une machine (par sa MAC), sur une période : chaque requête est reliée à la machine qui
 *  tenait son IP À L'HEURE de la requête (via les baux). Pur — l'appelant fournit requêtes et baux. */
export function requetesDeMachine(requetes: EvtDns[], baux: EvtBail[], mac: string, periode: PeriodeHist, now = Date.now()): EvtDns[] {
  return filtrerPeriode(requetes, (e) => e.t, periode, now).filter((e) => machineAt(baux, e.ip, e.t)?.mac === mac);
}

/** Résumé des requêtes d'une machine : combien, combien bloquées, par quelle liste, les sites les plus fréquents. Pur. */
export function resumerRequetes(reqs: EvtDns[]): { total: number; bloquees: number; parListe: Array<[string, number]>; topSites: Array<[string, number]> } {
  const sites = new Map<string, number>(), listes = new Map<string, number>();
  let bloquees = 0;
  for (const e of reqs) {
    sites.set(e.nom, (sites.get(e.nom) ?? 0) + 1);
    if (e.statut === 'bloqué') { bloquees++; if (e.liste) listes.set(e.liste, (listes.get(e.liste) ?? 0) + 1); }
  }
  const tri = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { total: reqs.length, bloquees, parListe: tri(listes), topSites: tri(sites).slice(0, 10) };
}

/** Le journal durable de Sphinx (DNS + DHCP) : une seule table, deux sortes de lignes, dans la base VIDARR_ODIN. */
export function histVidarr(ctx: ModCtx): Journal<EvtHist> {
  return journalDe<EvtHist>(ctx, 'vidarr', 'historique.jsonl', { garder: 50_000, quand: (e) => e.t });
}

/** Note une requête DNS dans l'historique durable (sans ralentir : ajout par lots géré par le journal). Ne jette pas. */
export function noterRequete(ctx: ModCtx, e: LogEntry): void {
  try { histVidarr(ctx).ajouter({ k: 'dns', t: e.t, ip: e.client.replace(/^::ffff:/, ''), nom: e.name, statut: e.status, liste: e.list, amont: e.upstream }); } catch { /* repli : l'anneau mémoire et le journal du jour restent */ }
}
/** Note un événement de bail DHCP (adresse donnée, renouvelée, bloquée…). Ne jette pas. */
export function noterBail(ctx: ModCtx, e: Omit<EvtBail, 'k'>): void {
  try { histVidarr(ctx).ajouter({ k: 'bail', ...e }); } catch { /* repli fichier */ }
}

/** Toutes les entrées gardées en mémoire (les dernières), séparées DNS / baux. Pour le direct et les récaps récents. */
export function histTout(ctx: ModCtx): { dns: EvtDns[]; baux: EvtBail[] } {
  const tout = histVidarr(ctx).tout();
  return { dns: tout.filter((e): e is EvtDns => e.k === 'dns'), baux: tout.filter((e): e is EvtBail => e.k === 'bail') };
}
