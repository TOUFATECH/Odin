// Lyncée : les moteurs interrogés par Odin lui-même, sans clé. Chaque adaptateur dit quelle adresse appeler
// (écrite en dur, seule la question change) et comment lire la réponse, en reconnaissant un contrôle anti-robot,
// un refus ou une limite de débit : le moteur est alors mis en pause, jamais contourné, aucun captcha n'est résolu.
import { lireBingActus, lireBingImages, lireBingVideos, lireBingWeb, lireBrave, lireCommons, lireDuckDuckGo, lireDuckDuckGoLite, lireGoogleActus, lireOpenverse, lireSepia, lireWikidata, lireWikipedia, lireYahoo } from './lecteurs.ts';
import type { Adaptateur, Categorie, Lecture, Requete, ResultatMoteur } from './types.ts';

const e = encodeURIComponent;
const corps = (o: Record<string, string>) => new URLSearchParams(o).toString();
const BLOQUANT = /captcha|challenge|consent|showcaptcha/i;
const blocage = (raison: string): Lecture => ({ bloque: raison, genre: 'blocage' });
const limite = (raison: string): Lecture => ({ bloque: raison, genre: 'limite' });

/** Les cas communs à tous les moteurs : redirection vers un contrôle, refus, limite de débit. Pur. */
export function statutCommun(statut: number, urlFinale: string, location?: string): Lecture | undefined {
  if (statut >= 300 && statut < 400) {
    if (/consent\./i.test(location ?? '')) return blocage('demande de consentement (jamais acceptée par Odin)');
    if (BLOQUANT.test(location ?? '')) return blocage('contrôle anti-robot');
    return blocage('redirection inattendue');
  }
  if (/consent\./i.test(urlFinale)) return blocage('demande de consentement (jamais acceptée par Odin)');
  if (/\/(captcha|challenge|showcaptcha)\b/i.test(urlFinale)) return blocage('contrôle anti-robot');
  if (statut === 403) return blocage('accès refusé (403)');
  if (statut === 429) return limite('trop de requêtes (429)');
  return undefined;
}
const ok = (r: { resultats: ResultatMoteur[]; suivante: boolean }): Lecture => r;

/** Une page de contrôle anti-robot reconnue par son titre (le mot dans un libellé ne compte pas). Pur. */
const titreCaptcha = (t: string) => /<title>[^<]{0,80}(captcha|are you a robot|vérification|unusual traffic)[^<]{0,80}<\/title>/i.test(t);
const bingBloque = (t: string) => /PoWChallenge/.test(t) && (/class="b_no"/.test(t) || !/b_algo|class="iusc"|vrhm=/.test(t));
const page = (p: number) => Math.max(1, Math.min(10, Math.floor(p) || 1));

export const ADAPTATEURS: Adaptateur[] = [
  // ---------------------------------------------------------------- Web
  {
    id: 'duckduckgo', etiquette: 'DuckDuckGo', famille: 'duckduckgo', categories: ['web'], intervalle: 2000,
    requete: (q, _c, p): Requete => ({ url: 'https://html.duckduckgo.com/html/', method: 'POST', body: corps({ q, kl: 'fr-fr', s: String((page(p) - 1) * 10) }), genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (st === 202 ? limite('trop de requêtes (202)') : /anomaly-modal|anomaly\.js|bots use DuckDuckGo/i.test(t) ? blocage('contrôle anti-robot') : ok(lireDuckDuckGo(t))),
  },
  {
    id: 'duckduckgo_lite', etiquette: 'DuckDuckGo', famille: 'duckduckgo', categories: ['web'], intervalle: 2000,
    requete: (q, _c, p): Requete => ({ url: 'https://lite.duckduckgo.com/lite/', method: 'POST', body: corps({ q, kl: 'fr-fr', s: String((page(p) - 1) * 10) }), genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (st === 202 ? limite('trop de requêtes (202)') : /anomaly-modal|anomaly\.js|bots use DuckDuckGo/i.test(t) ? blocage('contrôle anti-robot') : ok(lireDuckDuckGoLite(t))),
  },
  {
    id: 'brave', etiquette: 'Brave', famille: 'brave', categories: ['web'], intervalle: 3000,
    requete: (q, _c, p) => ({ url: `https://search.brave.com/search?q=${e(q)}&source=web&offset=${page(p) - 1}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (titreCaptcha(t) ? blocage('contrôle anti-robot') : ok(lireBrave(t, 'web'))),
  },
  {
    id: 'yahoo', etiquette: 'Yahoo', categories: ['web'], intervalle: 2000,
    requete: (q, _c, p) => ({ url: `https://search.yahoo.com/search?p=${e(q)}&b=${1 + 10 * (page(p) - 1)}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (/consent\.yahoo\.com\/v2\/|<form[^>]+consent/i.test(t) && !/algo-sr/.test(t) ? blocage('demande de consentement (jamais acceptée par Odin)') : ok(lireYahoo(t))),
  },
  {
    id: 'bing', etiquette: 'Bing', famille: 'bing', categories: ['web'], intervalle: 2000,
    requete: (q, _c, p) => ({ url: `https://www.bing.com/search?q=${e(q)}&setlang=fr&cc=FR&first=${1 + 10 * (page(p) - 1)}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (bingBloque(t) ? blocage('contrôle anti-robot') : ok(lireBingWeb(t))),
  },
  // ---------------------------------------------------------------- Savoir (et Web pour Wikipédia)
  {
    id: 'wikipedia', etiquette: 'Wikipédia', categories: ['web', 'savoir'], intervalle: 500,
    requete: (q, _c, p) => ({ url: `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${e(q)}&srlimit=10&sroffset=${10 * (page(p) - 1)}&format=json&utf8=1`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireWikipedia(t)),
  },
  {
    id: 'wikidata', etiquette: 'Wikidata', categories: ['savoir'], intervalle: 500,
    requete: (q, _c, p) => ({ url: `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${e(q)}&language=fr&uselang=fr&type=item&limit=10&continue=${10 * (page(p) - 1)}&format=json`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireWikidata(t)),
  },
  // ---------------------------------------------------------------- Actualités
  {
    id: 'google_actus', etiquette: 'Google Actualités', categories: ['actualites'], intervalle: 2000, pagine: false,
    requete: (q) => ({ url: `https://news.google.com/rss/search?q=${e(q)}&hl=fr&gl=FR&ceid=FR:fr`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireGoogleActus(t)),
  },
  {
    id: 'bing_actus', etiquette: 'Bing Actualités', famille: 'bing', categories: ['actualites'], intervalle: 2000, pagine: false,
    requete: (q) => ({ url: `https://www.bing.com/news/search?q=${e(q)}&format=rss&setlang=fr&cc=FR`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (bingBloque(t) ? blocage('contrôle anti-robot') : ok(lireBingActus(t))),
  },
  {
    id: 'brave_actus', etiquette: 'Brave', famille: 'brave', categories: ['actualites'], intervalle: 3000,
    requete: (q, _c, p) => ({ url: `https://search.brave.com/news?q=${e(q)}&offset=${page(p) - 1}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (titreCaptcha(t) ? blocage('contrôle anti-robot') : ok(lireBrave(t, 'news'))),
  },
  // ---------------------------------------------------------------- Images
  {
    id: 'bing_images', etiquette: 'Bing', famille: 'bing', categories: ['images'], intervalle: 2000,
    requete: (q, _c, p) => ({ url: `https://www.bing.com/images/async?q=${e(q)}&first=${1 + 30 * (page(p) - 1)}&count=30&mmasync=1`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (bingBloque(t) ? blocage('contrôle anti-robot') : ok(lireBingImages(t))),
  },
  {
    id: 'brave_images', etiquette: 'Brave', famille: 'brave', categories: ['images'], intervalle: 3000, pagine: false,
    requete: (q) => ({ url: `https://search.brave.com/images?q=${e(q)}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (titreCaptcha(t) ? blocage('contrôle anti-robot') : ok(lireBrave(t, 'images'))),
  },
  {
    id: 'commons', etiquette: 'Wikimedia Commons', categories: ['images'], intervalle: 500,
    requete: (q, _c, p) => ({ url: `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${e(q)}&gsrnamespace=6&gsrlimit=20&gsroffset=${20 * (page(p) - 1)}&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=300&format=json`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireCommons(t)),
  },
  {
    id: 'openverse', etiquette: 'Openverse', categories: ['images'], intervalle: 5000,
    requete: (q, _c, p) => ({ url: `https://api.openverse.org/v1/images/?q=${e(q)}&page=${page(p)}&page_size=20`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireOpenverse(t)),
  },
  // ---------------------------------------------------------------- Vidéos
  {
    id: 'bing_videos', etiquette: 'Bing', famille: 'bing', categories: ['videos'], intervalle: 2000,
    requete: (q, _c, p) => ({ url: `https://www.bing.com/videos/asyncv2?q=${e(q)}&async=content&first=${1 + 20 * (page(p) - 1)}&count=20`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (bingBloque(t) ? blocage('contrôle anti-robot') : ok(lireBingVideos(t))),
  },
  {
    id: 'brave_videos', etiquette: 'Brave', famille: 'brave', categories: ['videos'], intervalle: 3000,
    requete: (q, _c, p) => ({ url: `https://search.brave.com/videos?q=${e(q)}&offset=${page(p) - 1}`, genre: 'page' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? (titreCaptcha(t) ? blocage('contrôle anti-robot') : ok(lireBrave(t, 'videos'))),
  },
  {
    id: 'sepia', etiquette: 'SepiaSearch', categories: ['videos'], intervalle: 1000,
    requete: (q, _c, p) => ({ url: `https://sepiasearch.org/api/v1/search/videos?search=${e(q)}&start=${20 * (page(p) - 1)}&count=20`, genre: 'api' }),
    lire: (t, st, u, loc) => statutCommun(st, u, loc) ?? ok(lireSepia(t)),
  },
];

/** Les hôtes que Lyncée a le droit d'appeler (aucun autre, jamais une adresse venue d'un résultat). */
export const HOTES_MOTEURS = new Set(['html.duckduckgo.com', 'lite.duckduckgo.com', 'search.brave.com', 'search.yahoo.com', 'www.bing.com', 'fr.wikipedia.org', 'www.wikidata.org', 'news.google.com', 'commons.wikimedia.org', 'api.openverse.org', 'sepiasearch.org']);
export const adaptateur = (id: string) => ADAPTATEURS.find((a) => a.id === id);
export const adaptateursDe = (c: Categorie) => ADAPTATEURS.filter((a) => a.categories.includes(c));
