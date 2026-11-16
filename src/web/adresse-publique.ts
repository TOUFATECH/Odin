// Une adresse donnée par un résultat de recherche (une vignette, une redirection) ne doit jamais faire entrer Odin
// dans le réseau de la maison : on regarde le nom, puis TOUTES les adresses vers lesquelles il pointe.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { assertPublicUrl, isPrivateHost } from '../heimdall/policy.ts';

export type Resoudre = (hote: string) => Promise<string[]>;
const parDns: Resoudre = async (h) => (await lookup(h, { all: true, verbatim: true })).map((x) => x.address);
let resoudre: Resoudre = parDns;
/** Pour les essais seulement : une résolution simulée (sans argument : la vraie revient). */
export function remplacerResolution(f?: Resoudre): void { resoudre = f ?? parDns; }

/** Une adresse locale, de lien ou « n'importe laquelle » : jamais visitée. Pur. */
export function adresseInterdite(a: string): boolean {
  const x = a.replace(/^\[|\]$/g, '').toLowerCase();
  return isPrivateHost(x) || /^169\.254\./.test(x) || x === '0.0.0.0' || x === '::' || /^0+(\.0+){3}$/.test(x) || /^fe80:/.test(x);
}

/** Rend l'adresse si elle est en http(s) et que son nom ne mène qu'à des adresses publiques ; sinon lève une erreur. */
export async function adressePublique(url: string | URL): Promise<URL> { return (await adresseVerifiee(url)).u; }

/**
 * Comme adressePublique, mais rend aussi l'adresse IP vérifiée : on se connecte à CELLE-LÀ, sans résoudre le nom
 * une deuxième fois (un nom piégé ne peut pas répondre « public » au contrôle puis « maison » à la connexion).
 */
export async function adresseVerifiee(url: string | URL): Promise<{ u: URL; ip: string }> {
  const u = assertPublicUrl(String(url));
  if (!/^https?:$/.test(u.protocol)) throw new Error('adresse refusée');
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(h)) { if (adresseInterdite(h)) throw new Error('adresse interne refusée'); return { u, ip: h }; }
  let liste: string[];
  try { liste = await resoudre(h); } catch { throw new Error('nom introuvable'); }
  if (!liste.length || liste.some(adresseInterdite)) throw new Error('adresse interne refusée');
  return { u, ip: liste[0] };
}
