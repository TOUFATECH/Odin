// La boucle locale (localhost, 127.x, ::1) pour les applis d'essai (Dodone, Achille en rejeu) : tester un service qui
// tourne sur la machine d'Odin est permis, SAUF sur les ports d'Odin lui-même (son interface, son canal, le proxy
// d'Achille). La même règle vaut pour les adresses de cette machine sur le réseau (192.168… de son propre réseau) :
// la machine d'Odin n'est pas joignable par une porte et refusée par l'autre. Les métadonnées d'un hébergeur, le lien
// local (169.254…) et 0.0.0.0 restent toujours refusés (voir hoteInterdit dans lien.ts).
import { networkInterfaces } from 'node:os';
import { hiddenV4 } from '../heimdall/policy.ts';
import { ODIN_PORTS } from './ports.ts';

/** Le nom ou l'adresse, nu : sans crochets, en minuscules, IPv4 cachée dans une IPv6 remise en clair. Pur. */
const nu = (h: string) => hiddenV4(String(h ?? '').trim().replace(/^\[|\]$/g, '')).replace(/^(?:::ffff:|(?:0:){5}ffff:)/, '').replace(/\.+$/, '').toLowerCase();

/** La boucle locale : localhost, *.localhost, 127.x.x.x, ::1. Pur. */
export function boucleLocale(h: string): boolean {
  const x = nu(h);
  return x === 'localhost' || x.endsWith('.localhost') || /^127\./.test(x) || x === '::1';
}
/** Les adresses de cette machine (toutes ses cartes réseau). */
export function adressesDeCetteMachine(): Set<string> {
  const out = new Set<string>();
  for (const l of Object.values(networkInterfaces())) for (const a of l ?? []) out.add(nu(a.address));
  return out;
}
/** Les ports d'Odin lui-même : son interface, son canal HTTP, le retour de connexion, le proxy d'Achille. */
export const PORTS_ODIN: ReadonlySet<number> = new Set(ODIN_PORTS.filter((p) => p.proto === 'tcp' && (p.app === 'odin' || p.app === 'achille')).map((p) => p.port));
/** Le port d'un lien (80 ou 443 s'il n'est pas écrit). Pur. */
export const portDuLien = (u: URL) => Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
/**
 * Ce lien vise-t-il Odin lui-même ? (une des adresses est la boucle locale ou une adresse de cette machine, ET le port
 * est un port d'Odin). `machine` : injectable pour les essais.
 */
export function versOdinLuiMeme(adresses: string[], port: number, machine: Set<string> = adressesDeCetteMachine()): boolean {
  if (!PORTS_ODIN.has(port)) return false;
  return adresses.some((a) => boucleLocale(a) || machine.has(nu(a)));
}
export const REFUS_ODIN = 'ce lien vise l\'interface d\'Odin lui-même (un de ses ports) : refusé';
