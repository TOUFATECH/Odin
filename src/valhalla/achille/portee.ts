// Achille · la portée : ce qu'Achille a le droit de toucher. Seulement ce qui est à toi :
//   - une adresse de ta maison (192.168…, 10…, 172.16-31…, fd…), revérifiée APRÈS la résolution DNS : un nom qui
//     mène à Internet est refusé, même s'il ressemble à un nom de la maison ;
//   - un nom local (.lan, .local, .home, .home.arpa, .internal, .ts.net) qui mène bien à une adresse de la maison ;
//   - un domaine que tu as déclaré ET prouvé (enregistrement TXT ou fichier .well-known), et ses sous-domaines.
// Jamais la machine d'Odin elle-même ni les métadonnées d'un hébergeur. Tout le reste est refusé.
// Pur : la résolution DNS et la lecture du fichier de preuve sont injectées (faux résolveur dans les essais).
import { lookup, resolveTxt } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { hiddenV4, isPrivateHost } from '../../heimdall/policy.ts';
import { hoteInterdit } from '../lien.ts';
import { boucleLocale } from '../boucle.ts';
import { LOCAL_SUFFIXES } from '../../web/access.ts';

/** Un domaine déclaré par le propriétaire. `prouve` : date de la preuve validée (sinon : pas dans la portée). */
export interface Domaine { nom: string; jeton: string; declare: string; prouve?: string; par?: 'txt' | 'fichier' }
/** La résolution DNS (injectable). */
export interface Resolveur { adresses(hote: string): Promise<string[]>; txt(nom: string): Promise<string[]> }
export const RESOLVEUR_SYSTEME: Resolveur = {
  adresses: async (h) => (await lookup(h, { all: true })).map((a) => a.address),
  txt: async (n) => (await resolveTxt(n)).map((l) => l.join('')),
};
export interface Portee { ok: boolean; raison: string; /** l'adresse vérifiée à laquelle se connecter (jamais résolue une seconde fois) */ adresse?: string; /** une adresse de la maison (certificat invalide toléré, mais noté) */ prive?: boolean }

/** Le nom nu : minuscules, sans crochets ni point final, IPv4 cachée dans une IPv6 remise en clair. Pur. */
export const nu = (h: string) => hiddenV4(String(h ?? '').trim()).replace(/^(?:::ffff:|(?:0:){5}ffff:)/, '').replace(/\.+$/, '').toLowerCase();
/** Un nom local (.lan, .local…) ? Pur. */
export const nomLocal = (h: string) => LOCAL_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
/** Une adresse de la maison (et pas une adresse interdite) ? Pur. */
export const adresseMaison = (a: string) => !hoteInterdit(nu(a)) && isPrivateHost(nu(a));

const RE_DOMAINE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** Un nom de domaine propre à déclarer (« monsite.fr »), ou une erreur claire. Pur. */
export function domainePropre(x: unknown): string {
  const d = nu(String(x ?? '').replace(/^https?:\/\//i, '').split(/[/:?#]/)[0]);
  if (!RE_DOMAINE.test(d)) throw new Error('domaine invalide (ex. monsite.fr)');
  if (nomLocal(d)) throw new Error(`${d} est un nom local : il est déjà dans ta portée, inutile de le déclarer`);
  if (hoteInterdit(d)) throw new Error('adresse réservée : refusée');
  return d;
}
/** Un jeton de preuve neuf. */
export const nouveauJeton = () => `odin-achille-${randomBytes(16).toString('hex')}`;
/** Le domaine prouvé qui couvre cet hôte (lui-même ou un domaine parent). Pur. */
export function domaineDe(hote: string, domaines: Domaine[]): Domaine | undefined {
  const h = nu(hote);
  return domaines.filter((d) => d.prouve && (h === d.nom || h.endsWith(`.${d.nom}`))).sort((a, b) => b.nom.length - a.nom.length)[0];
}

/**
 * L'hôte est-il dans ta portée ? Adresse IP : elle doit être de la maison. Nom : il est résolu, et CHAQUE adresse
 * obtenue est revérifiée (un nom local qui mène à Internet est refusé ; un nom qui mène à Odin lui-même aussi).
 */
export async function dansLaPortee(hote: string, o: { domaines: Domaine[]; resoudre?: Resolveur; boucle?: boolean }): Promise<Portee> {
  const h = nu(hote);
  if (!h) return { ok: false, raison: 'adresse vide' };
  // `boucle` (rejeu seulement) : un service en essai sur la machine d'Odin (localhost) est à toi ; l'appelant refuse
  // encore les ports d'Odin lui-même (boucle.ts). Le proxy d'interception, lui, ne l'accepte jamais.
  const interdit = (a: string) => hoteInterdit(a) && !(o.boucle && boucleLocale(a));
  const maison = (a: string) => adresseMaison(a) || Boolean(o.boucle && boucleLocale(a));
  if (interdit(h)) return { ok: false, raison: `${h} : la machine d'Odin elle-même ou une adresse réservée, toujours refusée` };
  if (isIP(h)) return maison(h) ? { ok: true, raison: boucleLocale(h) ? 'la machine d\'Odin (boucle locale)' : 'adresse de ta maison', adresse: h, prive: true } : { ok: false, raison: `${h} n'est pas une adresse de ta maison` };
  const dom = domaineDe(h, o.domaines);
  let adresses: string[] = [];
  try { adresses = (await (o.resoudre ?? RESOLVEUR_SYSTEME).adresses(h)).map(nu); } catch { adresses = []; }
  if (!adresses.length) return { ok: false, raison: `${h} : nom introuvable` };
  if (adresses.some(interdit)) return { ok: false, raison: `${h} mène à la machine d'Odin elle-même ou à une adresse réservée : refusé` };
  const toutesMaison = adresses.every(maison);
  if (dom) return { ok: true, raison: `domaine ${dom.nom}, déclaré et prouvé`, adresse: adresses[0], prive: toutesMaison };
  if (toutesMaison) return { ok: true, raison: nomLocal(h) ? 'nom local de ta maison' : 'nom qui mène à ta maison', adresse: adresses[0], prive: true };
  if (nomLocal(h)) return { ok: false, raison: `${h} ressemble à un nom de la maison mais mène à Internet : refusé` };
  return { ok: false, raison: `${h} n'est pas à toi (ni adresse de la maison, ni domaine déclaré et prouvé)` };
}

/**
 * Vérifie la preuve de propriété d'un domaine : un enregistrement TXT `_odin-achille.<domaine>` qui contient le
 * jeton, ou le fichier https://<domaine>/.well-known/odin-achille.txt qui le contient. Une seule lecture, courte.
 */
export async function verifierPreuve(d: Domaine, o: { resoudre?: Resolveur; fetch?: typeof fetch }): Promise<{ ok: boolean; par?: 'txt' | 'fichier'; texte: string }> {
  const r = o.resoudre ?? RESOLVEUR_SYSTEME;
  try { if ((await r.txt(`_odin-achille.${d.nom}`)).some((t) => t.trim() === d.jeton)) return { ok: true, par: 'txt', texte: `preuve trouvée dans l'enregistrement TXT _odin-achille.${d.nom}` }; } catch { /* pas d'enregistrement */ }
  if (o.fetch) {
    try {
      const rep = await o.fetch(`https://${d.nom}/.well-known/odin-achille.txt`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Odin-Achille' } });
      const t = rep.ok ? (await rep.text()).slice(0, 2048) : '';
      if (t.split(/\s+/).includes(d.jeton)) return { ok: true, par: 'fichier', texte: `preuve trouvée dans https://${d.nom}/.well-known/odin-achille.txt` };
    } catch { /* site injoignable */ }
  }
  return { ok: false, texte: `aucune preuve : ajoute l'enregistrement TXT _odin-achille.${d.nom} = ${d.jeton}, ou le fichier https://${d.nom}/.well-known/odin-achille.txt qui contient ce jeton` };
}
