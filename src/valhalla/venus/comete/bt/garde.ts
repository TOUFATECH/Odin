// Comète · partage de fichiers : quelles adresses Odin accepte de joindre (pairs, trackers UDP, nœuds du DHT).
// Jamais la machine d'Odin, jamais la maison (réseau privé), jamais une adresse de groupe ou réservée. En essai
// seulement (le réglage d'essai explicite de Comète), 127.0.0.1 est permis pour les faux pairs locaux.
import { isIP } from 'node:net';
import { hoteInterdit } from '../../../lien.ts';
import { isPrivateHost } from '../../../../heimdall/policy.ts';

export type Resoudre = (hote: string) => Promise<string[]>;

/** Les 16 octets d'une adresse IPv6 écrite sous n'importe quelle forme (« 0::1 », « 0:0:…:1 », « ::ffff:1.2.3.4 »). Pur. */
function octets6(a: string): number[] | undefined {
  let t = a; const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (v4) { if (isIP(v4[1]) !== 4) return undefined; const o = v4[1].split('.').map(Number); t = `${t.slice(0, -v4[1].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`; }
  const moities = t.split('::'); if (moities.length > 2) return undefined;
  const g = (x: string) => (x ? x.split(':') : []);
  const a1 = g(moities[0]), a2 = moities.length === 2 ? g(moities[1]) : [];
  const manque = 8 - a1.length - a2.length; if (manque < 0 || (moities.length === 1 && manque !== 0)) return undefined;
  const groupes = [...a1, ...Array(moities.length === 2 ? manque : 0).fill('0'), ...a2];
  if (groupes.length !== 8 || groupes.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return undefined;
  return groupes.flatMap((x) => { const n = parseInt(x, 16); return [n >> 8, n & 255]; });
}
/** Une IPv4 publique ? Pur. */
function v4Permise(a: string): boolean {
  if (hoteInterdit(a) || isPrivateHost(a)) return false;
  const [x, y] = a.split('.').map(Number);
  return !(x >= 224 || x === 0 || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19))); // groupe, réservé, essais réseau
}
/**
 * L'adresse (déjà une IP) est-elle permise ? `essai` : 127.0.0.1 permis (faux pairs locaux). Pur.
 * Une IPv6 est lue en octets (toutes ses écritures se valent : « 0::1 » est la machine d'Odin comme « ::1 ») ; une IPv4
 * cachée dedans (mappée, compatible, NAT64, 6to4) est jugée comme une IPv4.
 */
export function adressePermise(ip: string, essai = false): boolean {
  const a = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const v = isIP(a); if (!v) return false;
  if (v === 4) return (essai && a === '127.0.0.1') || v4Permise(a);
  const o = octets6(a); if (!o) return false;
  const v4De = (k: number) => `${o[k]}.${o[k + 1]}.${o[k + 2]}.${o[k + 3]}`;
  const nuls = (n: number) => o.slice(0, n).every((x) => x === 0);
  if (nuls(10) && o[10] === 0xff && o[11] === 0xff) return (essai && v4De(12) === '127.0.0.1') || v4Permise(v4De(12)); // ::ffff:a.b.c.d
  if (nuls(12)) return false; // ::, ::1, ::a.b.c.d (ancienne forme)
  if (o[0] === 0 && o[1] === 0x64 && o[2] === 0xff && o[3] === 0x9b) return v4Permise(v4De(12)); // 64:ff9b::/96 (NAT64)
  if (o[0] === 0x20 && o[1] === 0x02) return v4Permise(v4De(2)); // 2002::/16 (6to4)
  if (o[0] === 0x20 && o[1] === 0x01 && o[2] === 0 && o[3] === 0) return false; // 2001::/32 (Teredo : une IPv4 cachée)
  if (o[0] === 0x20 && o[1] === 0x01 && o[2] === 0x0d && o[3] === 0xb8) return false; // documentation
  return (o[0] & 0xe0) === 0x20; // seulement l'espace public 2000::/3 (ni groupe, ni privé, ni lien local)
}
export const portValide = (p: number): boolean => Number.isInteger(p) && p > 0 && p < 65536;

/** Résout un nom et vérifie TOUTES ses adresses ; rend la première permise (IPv4 d'abord). */
export async function resoudreSur(hote: string, resoudre: Resoudre, essai: boolean): Promise<string> {
  const h = hote.replace(/^\[|\]$/g, '');
  const l = isIP(h) ? [h] : await resoudre(h).catch(() => [] as string[]);
  if (!l.length) throw new Error(`${h.slice(0, 60)} : nom introuvable`);
  for (const a of l) if (!adressePermise(a, essai)) throw new Error("l'adresse mène à la machine d'Odin, à ton réseau ou à une adresse réservée : refusé");
  return l.find((a) => isIP(a) === 4) ?? l[0];
}
