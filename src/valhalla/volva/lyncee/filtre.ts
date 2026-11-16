// Lyncée : le filtre de chaque résultat avant la fusion. PUR.
// On garde le http(s) seulement, en lien direct (décodé sans jamais appeler le moteur), sans publicité, et jamais
// une adresse de la maison (IP nue, réseau local, .local, .lan…) : un résultat ne doit pas faire sortir Odin du web public.
import { isPrivateHost } from '../../../heimdall/policy.ts';
import { lienDirect, texteSur } from './lecteurs.ts';
import type { ResultatMoteur } from './types.ts';

// Un lien Bing « /ck/a » est décodé d'abord ; s'il le reste après décodage, il est écarté (voir nettoyer).
const PUB = /duckduckgo\.com\/y\.js|[?&]ad_domain=|[?&]ad_provider=|bing\.com\/aclick|r\.search\.yahoo\.com\/(cbclk\d*|rdclks?)\/|googleadservices\.com|doubleclick\.net|googlesyndication\.com/i;
const SUFFIXES_LOCAUX = /(^|\.)(localhost|local|lan|home\.arpa|internal|intranet|home|corp|localdomain)$/i;

/** Une adresse publique en http(s) ? (ni IP nue, ni nom de la maison, ni identifiants dans l'adresse) Pur. */
export function adressePublique(u: string): boolean {
  let x: URL; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
  if (x.username || x.password) return false;
  const h = x.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h || !h.includes('.') || h.includes(':')) return false; // nom sans point ou IPv6 nue
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^(0x[0-9a-f]+|\d+)$/i.test(h)) return false; // IPv4 nue (même écrite autrement)
  if (isPrivateHost(h) || SUFFIXES_LOCAUX.test(h)) return false;
  return true;
}
/** Un lien publicitaire ? (avant comme après décodage) Pur. */
export const estPub = (u: string): boolean => PUB.test(u);

/** Un résultat propre (lien direct public, texte clair et borné), ou undefined s'il faut l'écarter. Pur. */
export function nettoyer(r: ResultatMoteur): ResultatMoteur | undefined {
  if (!r || typeof r.url !== 'string') return undefined;
  if (estPub(r.url)) return undefined;
  const url = lienDirect(r.url);
  if (estPub(url) || /bing\.com\/ck\//i.test(url) || !adressePublique(url) || url.length > 2000) return undefined;
  const title = texteSur(String(r.title ?? '')).slice(0, 300) || new URL(url).hostname.replace(/^www\./, '');
  const snippet = texteSur(String(r.snippet ?? '')).slice(0, 500);
  let thumb: string | undefined;
  if (r.thumb) { const t = lienDirect(r.thumb); if (!estPub(t) && adressePublique(t) && t.length <= 2000) thumb = t; }
  const published = r.published && /^\d{4}-\d{2}-\d{2}/.test(r.published) ? r.published.slice(0, 10) : undefined;
  const site = typeof r.site === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(r.site) && r.site.length <= 253 ? r.site.toLowerCase() : undefined;
  return { title, url, snippet, ...(thumb ? { thumb } : {}), ...(published ? { published } : {}), ...(site ? { site } : {}) };
}
