// Lyncée : la lecture des réponses des moteurs. Tout est PUR (texte en entrée, résultats en sortie) et essayé
// sur des échantillons réduits. Le texte venu des moteurs est une donnée : on n'en garde que du texte brut.
import { parseBing, parseDuckDuckGo, parseNewsRss } from '../../../tools/search.ts';
import { parseWikipedia } from '../engine.ts';
import type { ResultatMoteur } from './types.ts';

const NOMMEES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', uuml: 'ü', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•', oelig: 'œ', deg: '°', euro: '€',
};
/** Les entités HTML (&eacute; &#233; &#xE9;) en caractères. Pur. */
export function entites(t: string): string {
  return t.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ''; }
    return NOMMEES[e] ?? all;
  });
}
/** Du HTML (ou un texte avec balises) en texte clair : balises retirées, entités décodées, espaces resserrés. Pur. */
export function texteSur(html: string): string {
  return entites(String(html ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Un lien de moteur en lien direct, SANS jamais l'appeler : DuckDuckGo (uddg=), Bing (u=a1… et url=),
 * Yahoo (RU=…/). Les liens « // » deviennent https. Pur.
 */
export function lienDirect(u: string): string {
  let x = entites(String(u ?? '').trim());
  if (x.startsWith('//')) x = `https:${x}`;
  try {
    const p = new URL(x), h = p.hostname.toLowerCase();
    if (/(^|\.)duckduckgo\.com$/.test(h) && p.pathname.startsWith('/l/') && p.searchParams.get('uddg')) return p.searchParams.get('uddg')!;
    if (/(^|\.)bing\.com$/.test(h)) {
      const a1 = p.searchParams.get('u');
      if (a1 && a1.startsWith('a1')) { const d = Buffer.from(a1.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); if (/^https?:\/\//i.test(d)) return d; }
      const url = p.searchParams.get('url'); if (url && /^https?:\/\//i.test(url)) return url;
    }
    if (/(^|\.)search\.yahoo\.com$/.test(h)) { const m = /\/RU=([^/]+)\//.exec(p.pathname); if (m) { const d = decodeURIComponent(m[1]); if (/^https?:\/\//i.test(d)) return d; } }
  } catch { /* adresse illisible : gardée telle quelle, le filtre la refusera */ }
  return x;
}

const json = (t: string): unknown => { try { return JSON.parse(t); } catch { return undefined; } };
/** Une chaîne d'un littéral JavaScript ("…" avec /, \") en texte. Pur. */
const chaineJs = (s: string): string => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };
const dateIso = (d: string): string | undefined => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined; };

// ------------------------------------------------------------------ Pages web

/** DuckDuckGo (page HTML) : les blocs « result--ad » (publicités) sont retirés avant la lecture. Pur. */
export function lireDuckDuckGo(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const sans = html.replace(/class="([^"]*\bresult--ad\b[^"]*)"/g, 'class="pub-retiree"');
  const resultats = parseDuckDuckGo(sans).map((r) => ({ title: r.title, url: lienDirect(r.url), snippet: r.snippet }));
  return { resultats, suivante: /<input[^>]+value="(?:Next|Suivant)/i.test(html) };
}
/** DuckDuckGo (version légère) : liens « result-link », extraits « result-snippet ». Pur. */
export function lireDuckDuckGoLite(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  for (const m of html.split(/(?=<a\b[^>]*class=['"]result-link['"])/)) {
    const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(m); if (!a || !/class=['"]result-link['"]/.test(a[1])) continue;
    const href = /href="([^"]+)"/.exec(a[1]); if (!href) continue;
    const url = lienDirect(href[1]); if (/duckduckgo\.com\/y\.js|ad_domain|ad_provider/.test(url)) continue;
    const sn = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(m);
    resultats.push({ title: texteSur(a[2]), url, snippet: sn ? texteSur(sn[1]) : '' });
  }
  return { resultats, suivante: /class=['"]navbutton['"][^>]*value="Next/i.test(html) };
}

/** Yahoo : blocs « algo-sr », liens r.search.yahoo.com décodés (RU=) sans les appeler, blocs sponsorisés retirés. Pur. */
export function lireYahoo(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  const blocs = html.split(/<div class="([^"]*\balgo-sr\b[^"]*)"/);
  for (let i = 1; i + 1 < blocs.length; i += 2) {
    const classe = blocs[i], b = blocs[i + 1];
    if (/\bads?\b|sponsor/i.test(classe)) continue;
    const a = /<a\b[^>]*\shref="([^"]+)"/.exec(b), t = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(b); if (!a || !t) continue;
    if (/\/cbclk\d*\/|\/rdclks?\//.test(a[1])) continue; // liens publicitaires
    const sn = /class="compText[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b);
    resultats.push({ title: texteSur(t[1]), url: lienDirect(a[1]), snippet: sn ? texteSur(sn[1]) : '' });
  }
  return { resultats, suivante: /class="next\b/.test(html) };
}

/** Bing (page web) : blocs « b_algo » ; les blocs publicitaires « b_ad » sont retirés. Pur. */
export function lireBingWeb(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const sans = html.replace(/<li class="b_ad\b[\s\S]*?<\/ul>\s*<\/li>/g, '');
  return { resultats: parseBing(sans).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })), suivante: /sb_pagN/.test(html) };
}

/** Brave : pages (web), actualités (news) et vidéos lues dans la page ; images lues dans les données de la page. Pur. */
export function lireBrave(html: string, sorte: 'web' | 'news' | 'videos' | 'images'): { resultats: ResultatMoteur[]; suivante: boolean } {
  const suivante = /more_results_available:true/.test(html);
  if (sorte === 'images') { const resultats = lireBraveDonnees(html); return { resultats, suivante: resultats.length >= 20 }; }
  const resultats: ResultatMoteur[] = [];
  for (const b of html.split(new RegExp(`data-type="${sorte}"`)).slice(1)) {
    const bloc = b.split(/data-type="/)[0];
    const a = /<a\b[^>]*\shref="(https?:\/\/[^"]+)"/.exec(bloc); if (!a) continue;
    const t = /class="title[^"]*"[^>]*\stitle="([^"]*)"/.exec(bloc) ?? /class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(bloc); if (!t) continue;
    const d = /class="(?:content|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(bloc);
    const img = /class="thumbnail[^"]*"[\s\S]*?<img\b[^>]*\ssrc="(https:\/\/[^"]+)"/.exec(bloc);
    const duree = sorte === 'videos' ? /class="duration[^"]*"[^>]*>([^<]{1,12})</.exec(bloc) : null;
    const texte = d ? texteSur(d[1]) : '';
    resultats.push({ title: texteSur(t[1]), url: entites(a[1]), snippet: duree ? `${texteSur(duree[1])}${texte ? ` · ${texte}` : ''}` : texte, ...(img && sorte !== 'web' ? { thumb: entites(img[1]) } : {}) });
  }
  return { resultats, suivante };
}
/** Les images de Brave sont dans les données de la page (littéral JavaScript, jamais exécuté) : titre, page, vignette. Pur. */
function lireBraveDonnees(html: string): ResultatMoteur[] {
  const out: ResultatMoteur[] = [], vus = new Set<string>(), S = '((?:[^"\\\\]|\\\\.)*)';
  const zone = html.slice(Math.max(0, html.indexOf('type:"images"')));
  for (const m of zone.split('{title:"').slice(1)) {
    const tu = new RegExp(`^${S}",url:"${S}"`).exec(m); if (!tu || vus.has(tu[2])) continue; vus.add(tu[2]);
    const th = new RegExp(`thumbnail:\\{src:"${S}"`).exec(m.split('{title:"')[0]);
    const src = new RegExp(`source:"${S}"`).exec(m);
    out.push({ title: chaineJs(tu[1]), url: chaineJs(tu[2]), snippet: src ? chaineJs(src[1]) : '', ...(th ? { thumb: chaineJs(th[1]) } : {}) });
  }
  return out;
}

/** Bing Images : chaque vignette porte un attribut m= (JSON) : purl = la page, turl = la vignette. Pur. */
export function lireBingImages(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  for (const tag of html.match(/<a\b[^>]*class="iusc"[^>]*>/g) ?? []) {
    const m = /\sm="([^"]+)"/.exec(tag); if (!m) continue;
    const d = json(entites(m[1])) as { purl?: string; turl?: string; t?: string; desc?: string } | undefined; if (!d?.purl) continue;
    resultats.push({ title: texteSur(d.t ?? d.desc ?? ''), url: d.purl, snippet: texteSur(d.desc ?? ''), ...(d.turl ? { thumb: d.turl } : {}) });
  }
  return { resultats, suivante: resultats.length >= 20 };
}
/** Bing Vidéos : attributs vrhm= (JSON) : titre, page, durée, vignette. Pur. */
export function lireBingVideos(html: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  for (const m of html.matchAll(/\svrhm="([^"]+)"/g)) {
    const d = json(entites(m[1])) as { vt?: string; pgurl?: string; murl?: string; du?: string; thid?: string; smturl?: string } | undefined;
    const url = d?.pgurl || d?.murl; if (!d || !url) continue;
    const thumb = d.thid && /^[\w.-]{4,120}$/.test(d.thid) ? `https://tse1.mm.bing.net/th/id/${d.thid}?w=320&h=180&c=7` : undefined;
    resultats.push({ title: texteSur(d.vt ?? ''), url, snippet: d.du ? `Durée ${texteSur(d.du)}` : '', ...(thumb ? { thumb } : {}) });
  }
  return { resultats, suivante: resultats.length >= 10 };
}

// ------------------------------------------------------------------ Flux d'actualités

const balise = (it: string, n: string) => (new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`).exec(it)?.[1] ?? '').replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
/** Google Actualités (RSS) : le lien reste celui du flux (jamais décodé par un appel), le site vient de <source>. Pur. */
export function lireGoogleActus(xml: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  for (const it of xml.split(/<item>/).slice(1)) {
    const lien = entites(balise(it, 'link').trim()); if (!/^https:\/\//.test(lien)) continue;
    const source = texteSur(balise(it, 'source')), date = dateIso(balise(it, 'pubDate'));
    let titre = texteSur(balise(it, 'title')); if (source && titre.endsWith(` - ${source}`)) titre = titre.slice(0, -(source.length + 3));
    // Le lien passe par Google : le site du journal (<source url>) sert à la limite par site et à l'affichage.
    let site = ''; try { site = new URL(entites(/<source\b[^>]*\burl="([^"]+)"/.exec(it)?.[1] ?? '')).hostname.replace(/^www\./, ''); } catch { /* pas de site */ }
    resultats.push({ title: titre, url: lien, snippet: [source, date ? new Date(date).toLocaleDateString('fr-FR') : '', 'lien via Google Actualités'].filter(Boolean).join(' · '), ...(date ? { published: date } : {}), ...(site ? { site } : {}) });
  }
  return { resultats, suivante: false };
}
/** Bing Actualités (RSS) : le vrai lien (url=) décodé par parseNewsRss, la date et l'image en plus. Pur. */
export function lireBingActus(xml: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const resultats: ResultatMoteur[] = [];
  for (const it of xml.split(/<item>/).slice(1)) {
    const r = parseNewsRss(`<item>${it}`)[0]; if (!r) continue;
    const date = dateIso(balise(it, 'pubDate')), img = entites(balise(it, 'News:Image').trim()).replace(/^http:\/\//, 'https://');
    resultats.push({ title: r.title, url: r.url, snippet: r.snippet, ...(date ? { published: date } : {}), ...(/^https:\/\//.test(img) ? { thumb: img } : {}) });
  }
  return { resultats, suivante: false };
}

// ------------------------------------------------------------------ API ouvertes (JSON)

/** Wikipédia (API list=search) : balises <span searchmatch> retirées. Pur. */
export function lireWikipedia(texte: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const j = json(texte) as { continue?: { sroffset?: number } } | undefined;
  return { resultats: parseWikipedia(j).map((r) => ({ title: texteSur(r.title), url: r.url, snippet: texteSur(r.snippet) })), suivante: Boolean(j?.continue?.sroffset) };
}
/** Wikidata (wbsearchentities) : l'élément, sa description. Pur. */
export function lireWikidata(texte: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const j = json(texte) as { search?: Array<{ id?: string; label?: string; description?: string; url?: string }>; 'search-continue'?: number } | undefined;
  const resultats = (j?.search ?? []).filter((x) => x.id && /^[QPL]\d+$/.test(x.id)).map((x) => ({ title: texteSur(x.label || x.id!), url: `https://www.wikidata.org/wiki/${x.id}`, snippet: texteSur(x.description ?? '') }));
  return { resultats, suivante: Boolean(j?.['search-continue']) };
}
const sansPisteurs = (u: string) => { try { const x = new URL(u); for (const k of [...x.searchParams.keys()]) if (/^utm_/.test(k)) x.searchParams.delete(k); return x.toString(); } catch { return u; } };
/** Wikimedia Commons (generator=search, prop=imageinfo) : la page du fichier, sa vignette (sans utm_). Pur. */
export function lireCommons(texte: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const j = json(texte) as { continue?: unknown; query?: { pages?: Record<string, { title?: string; index?: number; imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; width?: number; height?: number }> }> } } | undefined;
  const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const resultats = pages.flatMap((p) => {
    const ii = p.imageinfo?.[0]; if (!ii?.descriptionurl) return [];
    const titre = texteSur(p.title ?? '').replace(/^(File|Fichier):/, '').replace(/\.[a-z0-9]{2,5}$/i, '');
    return [{ title: titre, url: ii.descriptionurl, snippet: ii.width && ii.height ? `${ii.width} × ${ii.height} · Wikimedia Commons` : 'Wikimedia Commons', ...(ii.thumburl ? { thumb: sansPisteurs(ii.thumburl) } : {}) }];
  });
  return { resultats, suivante: Boolean(j?.continue) };
}
/** Openverse (images sous licence libre) : la page d'origine, la vignette, l'auteur et la licence. Pur. */
export function lireOpenverse(texte: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const j = json(texte) as { page?: number; page_count?: number; results?: Array<{ title?: string; foreign_landing_url?: string; thumbnail?: string; creator?: string; license?: string; license_version?: string }> } | undefined;
  const resultats = (j?.results ?? []).filter((x) => x.foreign_landing_url).map((x) => ({ title: texteSur(x.title ?? ''), url: x.foreign_landing_url!, snippet: [x.creator ? texteSur(x.creator) : '', x.license ? `licence ${x.license.toUpperCase()}${x.license_version ? ` ${x.license_version}` : ''}` : ''].filter(Boolean).join(' · '), ...(x.thumbnail ? { thumb: x.thumbnail } : {}) }));
  return { resultats, suivante: Boolean(j?.page && j.page_count && j.page < j.page_count) };
}
/** SepiaSearch (index des vidéos PeerTube) : titre, page, vignette, durée, chaîne, date. Pur. */
export function lireSepia(texte: string): { resultats: ResultatMoteur[]; suivante: boolean } {
  const j = json(texte) as { total?: number; data?: Array<{ name?: string; url?: string; thumbnailUrl?: string; duration?: number; publishedAt?: string; channel?: { displayName?: string }; account?: { displayName?: string } }> } | undefined;
  const duree = (s?: number) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
  const resultats = (j?.data ?? []).filter((x) => x.url).map((x) => { const date = x.publishedAt ? dateIso(x.publishedAt) : undefined; return { title: texteSur(x.name ?? ''), url: x.url!, snippet: [duree(x.duration) && `Durée ${duree(x.duration)}`, texteSur(x.channel?.displayName ?? x.account?.displayName ?? '')].filter(Boolean).join(' · '), ...(x.thumbnailUrl ? { thumb: x.thumbnailUrl } : {}), ...(date ? { published: date } : {}) }; });
  return { resultats, suivante: (j?.total ?? 0) > resultats.length };
}
