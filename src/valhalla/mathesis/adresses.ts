// Mathésis — le contrôle des adresses du robot de lecture. Le robot ne SONDE ni adresses ni ports : il ne suit que
// des liens trouvés dans des pages, et chaque adresse (et chaque redirection) repasse ces contrôles :
//  - http ou https seulement, aucun identifiant dans l'adresse ;
//  - ports habituels seulement (80 pour http, 443 pour https) ;
//  - aucune adresse IP écrite en chiffres (IPv4 sous toutes ses formes, IPv6) ; aucun nom de la maison ;
//  - le nom ne doit mener qu'à des adresses PUBLIQUES (ni privée, ni locale, ni lien local, ni multidiffusion…).
// Le transport système revérifie au moment même de la connexion (`lookupGarde`) : un nom qui changerait d'adresse
// entre le contrôle et la connexion (rebond DNS) est refusé lui aussi.
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateHost } from '../../heimdall/policy.ts';
import { adressePublique } from '../volva/lyncee/filtre.ts';
import type { Resolveur } from './types.ts';

/** Une adresse IP (déjà résolue) est-elle interdite au robot ? Pur. */
export function ipInterdite(ip: string): boolean {
  const a = String(ip ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!a || isPrivateHost(a)) return true;
  if (isIP(a) === 4) {
    const [x, y, z] = a.split('.').map(Number);
    if (x >= 224) return true;                                    // multidiffusion, réservé, diffusion
    if (x === 192 && y === 0 && (z === 0 || z === 2)) return true; // 192.0.0.0/24, documentation
    if (x === 198 && (y === 18 || y === 19)) return true;          // bancs d'essai
    if (x === 198 && y === 51 && z === 100) return true;           // documentation
    if (x === 203 && y === 0 && z === 113) return true;            // documentation
    if (x === 192 && y === 88 && z === 99) return true;            // ancien relais 6to4
    return false;
  }
  if (isIP(a) === 6) {
    // Liste BLANCHE : seul l'unicast global public ordinaire (2000::/3) passe. Tout le reste est refusé : boucle,
    // non spécifiée, IPv4 transportée (::a.b.c.d, ::ffff:, 64:ff9b::), locale (fc00::/7), lien local (fe80::/10, jusqu'à
    // febf), ancien site local (fec0::/10), multidiffusion (ff00::/8), et dans 2000::/3 : 6to4 (2002::/16) et Teredo
    // (2001::/32) qui portent une IPv4, ORCHID (2001:10::/28, 2001:20::/28), documentation (2001:db8::/32, 3fff::/20).
    const premier = a.startsWith('::') ? 0 : parseInt(a.split(':')[0], 16);
    if (!Number.isFinite(premier) || premier < 0x2000 || premier > 0x3fff) return true;
    const groupes = a.split(':');
    const second = a.startsWith('::') ? 0 : parseInt(groupes[1] || '0', 16) || 0;
    if (premier === 0x2002) return true;
    if (premier === 0x2001 && (second === 0 || second === 0x0db8 || (second >= 0x10 && second <= 0x2f))) return true;
    if (premier === 0x3fff && second <= 0x0fff) return true;
    return false;
  }
  return true; // pas une adresse : interdite
}

export type Controle = { ok: true; url: URL } | { ok: false; raison: string };

/** Contrôle de FORME d'une adresse (sans résolution). Pur. */
export function controlerForme(brut: string): Controle {
  let u: URL;
  try { u = new URL(String(brut ?? '')); } catch { return { ok: false, raison: 'adresse illisible' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, raison: `schéma refusé (${u.protocol})` };
  if (u.username || u.password) return { ok: false, raison: 'identifiants dans l\'adresse refusés' };
  if (u.port !== '') return { ok: false, raison: `port inhabituel refusé (${u.port})` }; // 80/443 explicites sont déjà retirés par URL
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(h)) return { ok: false, raison: 'adresse IP écrite en chiffres refusée' };
  if (!adressePublique(u.toString())) return { ok: false, raison: 'adresse non publique refusée' };
  if (u.toString().length > 2000) return { ok: false, raison: 'adresse trop longue' };
  u.hash = '';
  return { ok: true, url: u };
}

/** Le résolveur du système (toutes les adresses d'un nom). */
export const resolveurSysteme: Resolveur = async (hote) => (await lookup(hote, { all: true, verbatim: true })).map((a) => a.address);

/** Contrôle complet : forme, puis le nom ne doit mener qu'à des adresses publiques. */
export async function controlerAdresse(brut: string, resoudre: Resolveur): Promise<Controle> {
  const f = controlerForme(brut);
  if (!f.ok) return f;
  let ips: string[];
  try { ips = await resoudre(f.url.hostname); } catch { return { ok: false, raison: 'nom introuvable' }; }
  if (!ips.length) return { ok: false, raison: 'nom introuvable' };
  if (ips.some(ipInterdite)) return { ok: false, raison: 'le nom mène à une adresse privée, locale ou réservée' };
  return f;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;
type LookupBase = (hostname: string, options: { all: true; verbatim?: boolean }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * Une fonction `lookup` pour le transport système : elle résout le nom au moment de la connexion et REFUSE si une
 * seule adresse est interdite. `base` est injectable (essais).
 */
export function lookupGarde(base: LookupBase = lookupCb as unknown as LookupBase) {
  return (hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCb): void => {
    const toutes = typeof options === 'object' && options?.all === true;
    base(hostname, { all: true, verbatim: true }, (err, adresses) => {
      if (err) return cb(err);
      if (!adresses?.length || adresses.some((a) => ipInterdite(a.address))) {
        const e = new Error(`connexion refusée : ${hostname} mène à une adresse privée, locale ou réservée`) as NodeJS.ErrnoException;
        e.code = 'EODINPRIVE';
        return cb(e);
      }
      if (toutes) return cb(null, adresses);
      return cb(null, adresses[0].address, adresses[0].family);
    });
  };
}
