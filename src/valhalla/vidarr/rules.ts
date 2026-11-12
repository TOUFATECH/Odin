// Les règles de Víðarr : listes de blocage (format « hosts », liste de domaines, règles de blocage
// « ||domaine^ »), règles perso (bloquer, autoriser, expression régulière, joker), réécritures locales,
// services bloqués, recherche sécurisée. Tout est compilé en tables pour répondre vite.

export type Verdict =
  | { action: 'allow'; rule?: string; list?: string }
  | { action: 'block'; rule: string; list: string }
  | { action: 'rewrite'; rule: string; list: string; to: string[] };

/** Une liste compilée : domaines exacts, domaines et sous-domaines, expressions, exceptions. */
export interface Compiled { exact: Set<string>; sub: Set<string>; regex: RegExp[]; allowExact: Set<string>; allowSub: Set<string>; allowRegex: RegExp[]; rewrites: Map<string, string[]>; wildRewrites: Map<string, string[]>; count: number; important: Set<string> }
export const emptyList = (): Compiled => ({ exact: new Set(), sub: new Set(), regex: [], allowExact: new Set(), allowSub: new Set(), allowRegex: [], rewrites: new Map(), wildRewrites: new Map(), count: 0, important: new Set() });

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
export const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/\.$/, '');
export const isDomain = (d: string) => DOMAIN.test(cleanDomain(d));
const SINKS = new Set(['0.0.0.0', '127.0.0.1', '::', '::1', '0', 'localhost', '::0']);
const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix', 'ip6-allnodes', 'ip6-allrouters', '0.0.0.0']);

/** Une règle seule → ajoutée à la liste. Rend vrai si elle a été comprise. Comprend :
 *  - hosts : « 0.0.0.0 pub.exemple.fr » (le domaine exact) ;
 *  - domaine seul : « pub.exemple.fr » (exact) ;
 *  - blocage : « ||exemple.fr^ » (le domaine et ses sous-domaines), « *.exemple.fr » (les sous-domaines) ;
 *  - exception : « @@||exemple.fr^ », « @@exemple.fr » ;
 *  - expression : « /^pub[0-9]+\\./ » (sur le nom entier) ;
 *  - réécriture : « exemple.lan 192.168.1.10 » via addRewrite ; « ||x^$dnsrewrite=1.2.3.4 ».
 *  Les modificateurs inconnus rendent la règle ignorée (plutôt que de bloquer trop). */
export function addRule(c: Compiled, line: string): boolean {
  let s = line.trim();
  if (!s || s.startsWith('!') || s.startsWith('#') || s.startsWith('[')) return false;
  s = s.replace(/\s+#.*$/, '');
  const allow = s.startsWith('@@'); if (allow) s = s.slice(2);
  // Modificateurs : seuls $important et $dnsrewrite=… sont compris.
  let important = false, rewrite: string | undefined;
  const dollar = s.lastIndexOf('$');
  if (dollar > 0 && !s.startsWith('/')) {
    for (const m of s.slice(dollar + 1).split(',')) { if (m === 'important') important = true; else if (m.startsWith('dnsrewrite=')) rewrite = m.slice(11); else return false; }
    s = s.slice(0, dollar);
  }
  if (s.startsWith('/') && s.endsWith('/') && s.length > 2) {
    try { const re = new RegExp(s.slice(1, -1), 'i'); (allow ? c.allowRegex : c.regex).push(re); c.count++; return true; } catch { return false; }
  }
  const hosts = /^(\S+)\s+(.+)$/.exec(s);
  if (hosts && !allow) {
    const ip = hosts[1];
    if (!SINKS.has(ip) && !/^[\d.]+$|:/.test(ip)) return false;
    let n = 0;
    for (const d of hosts[2].split(/\s+/)) { const x = cleanDomain(d); if (!LOCAL_NAMES.has(x) && isDomain(x)) { if (SINKS.has(ip)) c.exact.add(x); else c.rewrites.set(x, [...(c.rewrites.get(x) ?? []), ip]); n++; } }
    c.count += n; return n > 0;
  }
  let sub = false;
  if (s.startsWith('||')) { sub = true; s = s.slice(2); }
  else if (s.startsWith('|')) s = s.slice(1);
  s = s.replace(/\^\|?$/, '').replace(/\|$/, '');
  let wild = false;
  if (s.startsWith('*.')) { wild = true; s = s.slice(2); }
  const d = cleanDomain(s);
  if (!isDomain(d) || LOCAL_NAMES.has(d)) return false;
  if (rewrite) { (wild ? c.wildRewrites : c.rewrites).set(d, rewrite.split(';').map((x) => x.trim()).filter(Boolean)); c.count++; return true; }
  if (allow) { (sub || wild ? c.allowSub : c.allowExact).add(d); c.count++; return true; }
  if (wild) c.sub.add(`*.${d}`); else (sub ? c.sub : c.exact).add(d);
  if (important) c.important.add(d);
  c.count++; return true;
}
export function compile(text: string, into = emptyList()): Compiled { for (const l of text.split(/\r?\n/)) addRule(into, l); return into; }

/** Le nom et tous ses parents : a.b.c → a.b.c, b.c, c. */
export function* parents(name: string): Generator<string> { let n = name; for (;;) { yield n; const i = n.indexOf('.'); if (i < 0) return; n = n.slice(i + 1); } }

/** Ce qu'une liste dit d'un nom : autorisé (exception), bloqué, réécrit, ou rien. */
export function judge(c: Compiled, name: string, listName: string): Verdict | undefined {
  const n = cleanDomain(name);
  let blocked: string | undefined, important = false;
  for (const p of parents(n)) {
    if ((p === n && c.exact.has(p)) || c.sub.has(p) || (p !== n && c.sub.has(`*.${p}`))) { blocked = p === n && c.exact.has(p) ? p : `||${p}^`; important = c.important.has(p); break; }
  }
  if (!blocked) for (const re of c.regex) if (re.test(n)) { blocked = `/${re.source}/`; break; }
  let allowed: string | undefined;
  if (c.allowExact.has(n)) allowed = `@@${n}`;
  else for (const p of parents(n)) if (c.allowSub.has(p)) { allowed = `@@||${p}^`; break; }
  if (!allowed) for (const re of c.allowRegex) if (re.test(n)) { allowed = `@@/${re.source}/`; break; }
  if (allowed && !important) return { action: 'allow', rule: allowed, list: listName };
  if (blocked) return { action: 'block', rule: blocked, list: listName };
  const rw = c.rewrites.get(n) ?? [...parents(n)].slice(1).map((p) => c.wildRewrites.get(p)).find(Boolean);
  if (rw) return { action: 'rewrite', rule: `${n} → ${rw.join(', ')}`, list: listName, to: rw };
  if (allowed) return { action: 'allow', rule: allowed, list: listName };
  return undefined;
}

/** Services qu'on peut couper d'un clic (domaines connus de chaque service). */
export const SERVICES: Record<string, { label: string; domains: string[] }> = {
  tiktok: { label: 'TikTok', domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'byteoversea.com', 'musical.ly', 'ibytedtos.com', 'tiktokcdn-us.com', 'ttwstatic.com'] },
  facebook: { label: 'Facebook', domains: ['facebook.com', 'facebook.net', 'fbcdn.net', 'fb.com', 'fb.me', 'fbsbx.com', 'messenger.com'] },
  instagram: { label: 'Instagram', domains: ['instagram.com', 'cdninstagram.com', 'ig.me', 'instagr.am'] },
  whatsapp: { label: 'WhatsApp', domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  snapchat: { label: 'Snapchat', domains: ['snapchat.com', 'snap.com', 'sc-cdn.net', 'snapkit.com', 'snapads.com', 'feelinsonice-hrd.appspot.com'] },
  youtube: { label: 'YouTube', domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'youtube-nocookie.com', 'youtubei.googleapis.com', 'yt.be'] },
  netflix: { label: 'Netflix', domains: ['netflix.com', 'netflix.net', 'nflxext.com', 'nflximg.net', 'nflxvideo.net', 'nflxso.net'] },
  twitch: { label: 'Twitch', domains: ['twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net', 'twitchsvc.net'] },
  discord: { label: 'Discord', domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'] },
  x: { label: 'X (Twitter)', domains: ['twitter.com', 'x.com', 'twimg.com', 't.co'] },
  roblox: { label: 'Roblox', domains: ['roblox.com', 'rbxcdn.com', 'rbx.com', 'robloxlabs.com'] },
  fortnite: { label: 'Fortnite / Epic', domains: ['epicgames.com', 'fortnite.com', 'unrealengine.com', 'epicgames.dev'] },
  steam: { label: 'Steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamcontent.com'] },
  playstation: { label: 'PlayStation', domains: ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com'] },
  xbox: { label: 'Xbox', domains: ['xbox.com', 'xboxlive.com', 'xboxservices.com'] },
  telegram: { label: 'Telegram', domains: ['telegram.org', 't.me', 'telegram.me', 'telesco.pe'] },
  pinterest: { label: 'Pinterest', domains: ['pinterest.com', 'pinimg.com', 'pin.it'] },
  reddit: { label: 'Reddit', domains: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'] },
  amazon_video: { label: 'Prime Video', domains: ['primevideo.com', 'aiv-cdn.net', 'aiv-delivery.net'] },
  disney: { label: 'Disney+', domains: ['disneyplus.com', 'disney-plus.net', 'dssott.com', 'bamgrid.com'] },
  spotify: { label: 'Spotify', domains: ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spoti.fi'] },
  chatgpt: { label: 'ChatGPT', domains: ['openai.com', 'chatgpt.com', 'oaiusercontent.com'] },
  tinder: { label: 'Tinder', domains: ['tinder.com', 'gotinder.com'] },
  vinted: { label: 'Vinted', domains: ['vinted.com', 'vinted.fr', 'vinted.net'] },
  shein: { label: 'Shein', domains: ['shein.com', 'shein.fr', 'ltwebstatic.com'] },
  jeux_argent: { label: 'Jeux d\'argent (FDJ, Winamax, Betclic, PMU)', domains: ['fdj.fr', 'parionssport.fdj.fr', 'winamax.fr', 'betclic.fr', 'pmu.fr', 'unibet.fr', 'zebet.fr'] },
};
export function servicesList(ids: string[]): Compiled {
  const c = emptyList();
  for (const id of ids) for (const d of SERVICES[id]?.domains ?? []) { c.sub.add(d); c.count++; }
  return c;
}

/**
 * Pubs et pistage des réseaux et des plateformes, SANS toucher aux vidéos ni aux comptes : seulement des noms
 * qui ne servent qu'à la pub ou au pistage. Limite (vraie pour tout bloqueur DNS) : les pubs que YouTube,
 * Instagram ou Facebook glissent dans le même flux que les vidéos et les publications viennent des mêmes
 * serveurs que le contenu ; les bloquer couperait aussi les vidéos.
 */
export const SOCIAL_ADS: Record<string, { label: string; domains: string[]; limit?: string }> = {
  google: { label: 'YouTube et Google', domains: ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adservice.google.com', 'pagead2.googlesyndication.com', 'imasdk.googleapis.com', 'googletagservices.com', 'google-analytics.com', 'app-measurement.com', 'adsense.google.com', 'partnerad.l.doubleclick.net', 'ade.googlesyndication.com'], limit: 'les pubs dans l\'appli YouTube viennent des mêmes serveurs que les vidéos : celles-là restent (seul YouTube Premium ou un lecteur sans pub les enlève)' },
  tiktok: { label: 'TikTok', domains: ['ads.tiktok.com', 'ads-api.tiktok.com', 'ads-sg.tiktok.com', 'analytics.tiktok.com', 'analytics-sg.tiktok.com', 'business-api.tiktok.com', 'ads.tiktokv.com', 'ads-api.tiktokv.com', 'ads-sg.tiktokv.com', 'log.byteoversea.com', 'ads.byteoversea.com', 'ads-api.byteoversea.com'], limit: 'les vidéos sponsorisées du fil « Pour toi » sont des vidéos comme les autres : elles restent' },
  meta: { label: 'Instagram, Facebook, WhatsApp', domains: ['an.facebook.com', 'pixel.facebook.com', 'ads.facebook.com', 'adsmanager.facebook.com', 'ad.atdmt.com', 'atdmt.com', 'connect.facebook.net', 'analytics.facebook.com', 'ads.instagram.com'], limit: 'les publications sponsorisées d\'Instagram et Facebook arrivent avec le fil : elles restent' },
  snapchat: { label: 'Snapchat', domains: ['tr.snapchat.com', 'ads.snapchat.com', 'adsapi.snapchat.com', 'sc-analytics.appspot.com', 'app-analytics.snapchat.com', 'snapads.com'] },
  x: { label: 'X (Twitter)', domains: ['ads-api.twitter.com', 'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com', 'ads-api.x.com', 'analytics.x.com'] },
  amazon: { label: 'Amazon', domains: ['amazon-adsystem.com', 'aax.amazon-adsystem.com', 'device-metrics-us.amazon.com', 'adtago.s3.amazonaws.com'] },
  microsoft: { label: 'Microsoft, Bing, LinkedIn', domains: ['ads.microsoft.com', 'bat.bing.com', 'ads.linkedin.com', 'px.ads.linkedin.com', 'analytics.linkedin.com', 'c.bing.com'] },
  apple: { label: 'Apple', domains: ['iadsdk.apple.com', 'api-adservices.apple.com', 'banners.itunes.apple.com'] },
  samsung_tv: { label: 'Télés Samsung, LG, Roku (pubs de l\'écran d\'accueil)', domains: ['ads.samsungads.com', 'samsungads.com', 'config.samsungads.com', 'ad.lgappstv.com', 'lgad.cjpowercast.com', 'ads.roku.com', 'logs.roku.com'] },
  xiaomi: { label: 'Téléphones Xiaomi, Huawei, Oppo (pubs du système)', domains: ['api.ad.xiaomi.com', 'ad.xiaomi.com', 'ad.mi.com', 'tracking.miui.com', 'data.mistat.xiaomi.com', 'ads.huawei.com', 'adx.ads.oppomobile.com', 'adsfs.oppomobile.com'] },
};
/** La liste « pubs des réseaux » compilée (les sous-domaines compris). */
export function socialAdsList(ids: string[] = Object.keys(SOCIAL_ADS)): Compiled {
  const c = emptyList();
  for (const id of ids) for (const d of SOCIAL_ADS[id]?.domains ?? []) { c.sub.add(d); c.count++; }
  return c;
}

/** Recherche sécurisée : les moteurs sont renvoyés vers leur version filtrée (par leur propre nom « sûr »). */
export const SAFE_SEARCH: Array<{ match: RegExp; to: string; label: string }> = [
  { match: /^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/, to: 'forcesafesearch.google.com', label: 'Google' },
  { match: /^(?:www\.|m\.)?youtube\.com$|^youtubei\.googleapis\.com$|^youtube\.googleapis\.com$|^(?:www\.)?youtube-nocookie\.com$/, to: 'restrictmoderate.youtube.com', label: 'YouTube' },
  { match: /^(?:www\.)?bing\.com$/, to: 'strict.bing.com', label: 'Bing' },
  { match: /^(?:www\.)?duckduckgo\.com$|^start\.duckduckgo\.com$|^html\.duckduckgo\.com$/, to: 'safe.duckduckgo.com', label: 'DuckDuckGo' },
  { match: /^(?:www\.)?qwant\.com$/, to: 'safeapi.qwant.com', label: 'Qwant' },
  { match: /^(?:www\.)?ecosia\.org$/, to: 'strict-safe-search.ecosia.org', label: 'Ecosia' },
  { match: /^(?:www\.)?yandex\.[a-z]{2,3}$/, to: 'familysearch.yandex.ru', label: 'Yandex' },
  { match: /^(?:www\.)?pixabay\.com$/, to: 'safesearch.pixabay.com', label: 'Pixabay' },
];
export const safeSearchFor = (name: string) => SAFE_SEARCH.find((s) => s.match.test(cleanDomain(name)));
