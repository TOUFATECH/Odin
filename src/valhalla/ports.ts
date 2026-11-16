// Les ports de toutes les applis, au même endroit, chacun bien défini.
// Règle : les services réseau d'Odin gardent le port de leur protocole (DNS 53, DHCP 67, TFTP 69, web 80/443,
// MQTT 1883, WireGuard 51820) ; l'interface d'Odin est sur 8888 ; chaque appli d'Odin a en plus SON port, facile à
// retenir (8FNN : F = sa famille, NN = son rang dans la famille, voir DEFAULT_DIRECT) ; les applis installées dans le moteur de conteneurs ont un port
// fixe dans la plage 20000-20999 (une appli = un port, toujours le même) ; les services mis à l'échelle dans
// 21000-21999 ; les pièges de Sirènes imitent de vrais services, d'où leurs ports. Odin ne donne jamais à une appli
// installée un port déjà réservé ici.
// Port direct : chaque appli d'Odin a SON port (http://IP:<port> ouvre directement sa page, par la même interface et
// avec la même connexion). Par défaut, c'est celui du plan ci-dessous ; tu le changes dans la page de l'appli ou dans
// Réglages → Ports (sans numéro, Odin propose un port libre de sa famille). Une appli qui a déjà son propre service
// web (Vénus : Venus sur 8096) garde ce port-là pour lui : c'est son service qui y répond.

export type Proto = 'tcp' | 'udp';
/** machine = cette machine seulement · réseau = ton réseau local · Internet = seulement si tu l'ouvres (avec ton accord) · interne = réseau privé des conteneurs */
export type Where = 'machine' | 'réseau' | 'Internet' | 'interne';
export interface PortDef { app: string; name: string; port: number; proto: Proto; what: string; where: Where; /** allumé seulement si tu le demandes */ optional?: boolean; /** même port, partagé exprès (ex. DHCP de Sphinx et de Genèse : jamais les deux en même temps) */ shared?: string; /** tenu par le programme de l'appli lui-même, pas par Odin (Venus, la base d'Odin dans son conteneur) */ by?: string; /** une interface web qu'on ouvre dans un navigateur : c'est déjà le port direct de l'appli */ web?: boolean }

export const WEB = 8888;
export const APPS_RANGE = [20000, 20999] as const;
export const SERVICES_RANGE = [21000, 21999] as const;
/** Ports directs proposés quand la famille de l'appli n'a plus de place (tu peux en choisir un autre ailleurs). */
export const DIRECT_RANGE = [22000, 22999] as const;

/** Les familles d'applis et la centaine de leurs ports : 81xx Sécurité, 82xx Accès, 83xx Machines, 84xx Données, 85xx Maison. */
export const FAMILY_BASE: Record<string, number> = { 'Sécurité': 8100, 'Accès': 8200, 'Machines': 8300, 'Données': 8400, 'Maison': 8500 };
/**
 * Le port de chaque appli par défaut (docs/plan-ports.md) : 8FNN, F = sa famille, NN = son rang alphabétique dans la
 * famille. Figé ici (une appli ajoutée prend le numéro libre suivant de sa famille) : un port ne change jamais tout seul.
 */
export const DEFAULT_DIRECT: Record<string, number> = {
  // Sécurité
  ran: 8101, ullr: 8102, garmr: 8103, forseti: 8104, hlin: 8105, geri: 8106, skogul: 8107, loki: 8108, hlid: 8109, svalinn: 8110, achille: 8111, argos: 8112,
  // Accès et réseau
  agora: 8201, bru: 8202, ratatoskr: 8203, pegase: 8204, var: 8205, hermod: 8206, vidarr: 8207, brisingamen: 8208, valgrind: 8209, gjoll: 8210,
  // Machines
  idunn: 8301, naglfar: 8302, askr: 8303, mimisbrunnr: 8304, thjalfi: 8305, gefjon: 8306, ymir: 8307, eir: 8308, sindri: 8309, vordr: 8310, fensalir: 8311, durinn: 8312,
  // Données et cœur
  dvalinn: 8401, urdr: 8402, eitri: 8403, skuld: 8404, champollion: 8405, frigg: 8406, ivaldi: 8407, rodd: 8408, commandes: 8409, sol: 8410,
  fjalar: 8411, skidbladnir: 8412, runes: 8413, hel: 8414, kvasir: 8415, snotra: 8416, volva: 8417, draupnir: 8418, saga: 8419, syn: 8420, atalante: 8421, dodone: 8422,
  // Maison et médias
  aegir: 8501, apparence: 8502, appareils: 8503, himinbjorg: 8504, brokkr: 8505, heidrun: 8506, gladsheim: 8507, midgard: 8508, leikvangr: 8509, bragi: 8510, gna: 8511, freyja: 8512, zeus: 8513,
};
/** Le port d'une appli par défaut, s'il y en a un. */
export const defaultDirect = (app: string): number | undefined => DEFAULT_DIRECT[app];
/** La plage de la famille d'une appli (8F01 à 8F99), d'après son port par défaut ou le nom de sa famille. */
export function familyRange(app: string, family?: string): readonly [number, number] | undefined {
  const d = DEFAULT_DIRECT[app], b = d ? Math.floor(d / 100) * 100 : family ? FAMILY_BASE[family] : undefined;
  return b ? [b + 1, b + 99] as const : undefined;
}

export const ODIN_PORTS: PortDef[] = [
  { app: 'odin', name: 'Odin', port: WEB, proto: 'tcp', what: 'l\'interface d\'Odin (HTTPS) et la page de chaque appli', where: 'réseau' },
  { app: 'odin', name: 'Odin', port: 8889, proto: 'tcp', what: 'canal HTTP (autres programmes qui parlent à Odin, avec jeton)', where: 'machine', optional: true },
  { app: 'odin', name: 'Odin', port: 1455, proto: 'tcp', what: 'retour de connexion du compte Codex (le temps de se connecter)', where: 'machine', optional: true },
  { app: 'vidarr', name: 'Sphinx', port: 53, proto: 'udp', what: 'DNS pour les appareils', where: 'réseau', optional: true },
  { app: 'vidarr', name: 'Sphinx', port: 53, proto: 'tcp', what: 'DNS (grandes réponses)', where: 'réseau', optional: true },
  { app: 'vidarr', name: 'Sphinx', port: 853, proto: 'tcp', what: 'DNS chiffré (TLS, « DNS privé » d\'Android)', where: 'réseau', optional: true },
  { app: 'vidarr', name: 'Sphinx', port: 67, proto: 'udp', what: 'DHCP (adresses des appareils)', where: 'réseau', optional: true, shared: 'dhcp' },
  { app: 'thjalfi', name: 'Genèse', port: 67, proto: 'udp', what: 'proxyDHCP du démarrage réseau (n\'attribue pas d\'adresse)', where: 'réseau', optional: true, shared: 'dhcp' },
  { app: 'thjalfi', name: 'Genèse', port: 69, proto: 'udp', what: 'TFTP du démarrage réseau', where: 'réseau', optional: true },
  { app: 'thjalfi', name: 'Genèse', port: 4011, proto: 'udp', what: 'PXE (démarrage réseau UEFI)', where: 'réseau', optional: true },
  { app: 'thjalfi', name: 'Genèse', port: 16000, proto: 'tcp', what: 'images et fichiers d\'installation (HTTP)', where: 'réseau', optional: true },
  { app: 'valgrind', name: 'Valgrind', port: 80, proto: 'tcp', what: 'proxy des sites (HTTP, Let\'s Encrypt)', where: 'Internet', optional: true },
  { app: 'valgrind', name: 'Valgrind', port: 443, proto: 'tcp', what: 'proxy des sites (HTTPS)', where: 'Internet', optional: true },
  { app: 'appareils', name: 'Constellation', port: 1883, proto: 'tcp', what: 'MQTT (prises, capteurs, modules ESP), allumé avec Odin', where: 'réseau' },
  { app: 'gjoll', name: 'Vortex', port: 51820, proto: 'udp', what: 'VPN WireGuard', where: 'Internet', optional: true },
  { app: 'urdr', name: 'Alexandrie', port: 5432, proto: 'tcp', what: 'base de données d\'Odin (odin-pg, 10.89.0.250), jamais publiée dehors', where: 'interne', by: 'odin-pg' },
  ...([[2323, 'tcp', 'Telnet'], [2222, 'tcp', 'SSH'], [2200, 'tcp', 'SSH (2e)'], [8081, 'tcp', 'site web'], [9201, 'tcp', 'Elasticsearch'], [6380, 'tcp', 'Redis'], [2525, 'tcp', 'mail (SMTP)'], [2121, 'tcp', 'FTP'], [5020, 'tcp', 'automates (Modbus)'], [5556, 'tcp', 'ADB Android'], [5061, 'tcp', 'téléphonie (SIP)'], [11212, 'udp', 'Memcached'], [2375, 'tcp', 'Docker'], [3389, 'tcp', 'bureau à distance (RDP)'], [5900, 'tcp', 'écran à distance (VNC)'], [3306, 'tcp', 'base MySQL/MariaDB'], [54320, 'tcp', 'base PostgreSQL'], [18830, 'tcp', 'objets connectés (MQTT)'], [4445, 'tcp', 'partage Windows (SMB)'], [23750, 'tcp', 'API Docker']] as const)
    .map(([port, proto, w]) => ({ app: 'loki', name: 'Sirènes', port, proto, what: `piège : faux ${w}`, where: 'réseau' as Where, optional: true })),
  { app: 'achille', name: 'Achille', port: 8890, proto: 'tcp', what: 'proxy d\'essai de tes propres sites (allumé à la demande)', where: 'réseau', optional: true },
  // Vénus = Venus (serveur multimédia, sur sa machine) : interface, HTTPS, base PostgreSQL, Comète (BitTorrent)
  { app: 'freyja', name: 'Vénus (Venus)', port: 8096, proto: 'tcp', what: 'interface de Venus', where: 'réseau', by: 'Venus', web: true },
  { app: 'freyja', name: 'Vénus (Venus)', port: 8920, proto: 'tcp', what: 'interface de Venus en HTTPS', where: 'réseau', optional: true, by: 'Venus', web: true },
  { app: 'freyja', name: 'Vénus (Venus)', port: 5433, proto: 'tcp', what: 'base PostgreSQL de Venus', where: 'machine', by: 'Venus' },
  { app: 'freyja', name: 'Comète', port: 51413, proto: 'tcp', what: 'téléchargements BitTorrent de Venus (pairs)', where: 'Internet', optional: true, by: 'Venus' },
];

/** Les applis connues qu'on installe dans le moteur de conteneurs : leur port fixe sur la machine → leur port dedans. */
export const APP_PORTS: Array<{ match: RegExp; name: string; host: number; inner: number; proto?: Proto }> = [
  { match: /(^|\/)n8n(:|$)/, name: 'n8n', host: 20010, inner: 5678 },
  { match: /(^|\/)nextcloud(:|$)/, name: 'Nextcloud', host: 20020, inner: 80 },
  { match: /(^|\/)gitea(:|$)/, name: 'Gitea', host: 20030, inner: 3000 },
  { match: /(^|\/)forgejo(:|$)/, name: 'Forgejo', host: 20031, inner: 3000 },
  { match: /authentik.*server|goauthentik/, name: 'Authentik', host: 20040, inner: 9000 },
  { match: /vaultwarden/, name: 'Vaultwarden', host: 20050, inner: 80 },
  { match: /uptime-kuma/, name: 'Uptime Kuma', host: 20060, inner: 3001 },
  { match: /immich-server/, name: 'Immich', host: 20070, inner: 2283 },
  { match: /(^|\/)grafana(:|$)/, name: 'Grafana', host: 20080, inner: 3000 },
  { match: /prometheus/, name: 'Prometheus', host: 20081, inner: 9090 },
  { match: /home-assistant/, name: 'Home Assistant', host: 20090, inner: 8123 },
  { match: /node-red/, name: 'Node-RED', host: 20091, inner: 1880 },
  { match: /jellyfin/, name: 'Jellyfin', host: 20100, inner: 8096 },
  { match: /navidrome/, name: 'Navidrome', host: 20101, inner: 4533 },
  { match: /audiobookshelf/, name: 'Audiobookshelf', host: 20102, inner: 80 },
  { match: /kavita/, name: 'Kavita', host: 20103, inner: 5000 },
  { match: /radarr/, name: 'Radarr', host: 20110, inner: 7878 },
  { match: /sonarr/, name: 'Sonarr', host: 20111, inner: 8989 },
  { match: /lidarr/, name: 'Lidarr', host: 20112, inner: 8686 },
  { match: /qbittorrent/, name: 'qBittorrent', host: 20113, inner: 8080 },
  { match: /seerr/, name: 'Seerr', host: 20114, inner: 5055 },
  { match: /stirling-pdf/, name: 'Stirling-PDF', host: 20120, inner: 8080 },
  { match: /bentopdf/, name: 'BentoPDF', host: 20121, inner: 8080 },
  { match: /vert-sh|\/vert(:|$)/, name: 'VERT', host: 20122, inner: 80 },
  { match: /it-tools/, name: 'IT-Tools', host: 20123, inner: 80 },
  { match: /excalidraw/, name: 'Excalidraw', host: 20124, inner: 80 },
  { match: /onlyoffice/, name: 'ONLYOFFICE', host: 20125, inner: 80 },
  { match: /languagetool/, name: 'LanguageTool', host: 20126, inner: 8010 },
  { match: /penpot-frontend/, name: 'Penpot', host: 20127, inner: 8080 },
  { match: /netbox/, name: 'NetBox', host: 20130, inner: 8080 },
  { match: /keycloak/, name: 'Keycloak', host: 20131, inner: 8080 },
  { match: /syncthing/, name: 'Syncthing', host: 20140, inner: 8384 },
  { match: /privatebin/, name: 'PrivateBin', host: 20141, inner: 8080 },
  { match: /calcom|cal\.com/, name: 'Cal.com', host: 20150, inner: 3000 },
  { match: /rallly/, name: 'Rallly', host: 20151, inner: 3000 },
  { match: /appflowy/, name: 'AppFlowy', host: 20152, inner: 80 },
  { match: /opensearch-dashboards/, name: 'OpenSearch Dashboards', host: 20160, inner: 5601 },
  { match: /guacamole/, name: 'Guacamole', host: 20161, inner: 8080 },
  { match: /searxng/, name: 'SearXNG', host: 20170, inner: 8080 },
  { match: /ollama/, name: 'Ollama', host: 20180, inner: 11434 },
  { match: /(^|\/)nginx(:|$)/, name: 'nginx', host: 20200, inner: 80 },
  { match: /(^|\/)httpd(:|$)/, name: 'Apache', host: 20201, inner: 80 },
  { match: /wordpress/, name: 'WordPress', host: 20210, inner: 80 },
  { match: /ghost/, name: 'Ghost', host: 20211, inner: 2368 },
];

/** Le port fixe d'une appli connue (image Docker), ou undefined. */
export function appPort(image: string): { name: string; host: number; inner: number; proto: Proto } | undefined {
  const x = APP_PORTS.find((a) => a.match.test(image.toLowerCase())); return x ? { name: x.name, host: x.host, inner: x.inner, proto: x.proto ?? 'tcp' } : undefined;
}
/** Les ports qu'Odin garde pour lui et ses applis (une appli installée ne les prend jamais). */
export function reserved(): Set<number> { return new Set([...ODIN_PORTS.filter((p) => p.where !== 'interne').map((p) => p.port), ...APP_PORTS.map((a) => a.host), ...Object.values(DEFAULT_DIRECT), ...direct.values()]); }
/** Les ports d'une appli d'Odin (ses services réseau), ou l'interface d'Odin si elle n'en a pas. */
export function portsOf(app: string): PortDef[] { return ODIN_PORTS.filter((p) => p.app === app); }
export function describe(app: string): string {
  const d = direct.get(app); return `${planOf(app)}${d ? ` · port direct ${d}` : ''}`;
}
/** Ce que dit le plan pour une appli, sans son port direct : ses ports de service, ou l'interface d'Odin. */
export function planOf(app: string): string {
  const l = portsOf(app);
  if (!l.length) return `${WEB} (interface d'Odin)`;
  const by = new Map<string, number[]>(); for (const p of l) { const k = p.proto.toUpperCase(); by.set(k, [...(by.get(k) ?? []), p.port]); }
  return [...by].map(([k, v]) => `${[...new Set(v)].join(', ')} ${k}`).join(' · ');
}
/** Deux applis sur le même port et le même protocole (hors partage voulu) : doit rester vide. */
export function conflicts(): string[] {
  const seen = new Map<string, PortDef>(), out: string[] = [];
  for (const p of ODIN_PORTS) { const k = `${p.port}/${p.proto}`, o = seen.get(k); if (o && o.app !== p.app && !(o.shared && o.shared === p.shared)) out.push(`${k} : ${o.name} et ${p.name}`); seen.set(k, p); }
  const hosts = new Map<number, string>(); for (const a of APP_PORTS) { if (hosts.has(a.host)) out.push(`${a.host} : ${hosts.get(a.host)} et ${a.name}`); hosts.set(a.host, a.name); if (a.host < APPS_RANGE[0] || a.host > APPS_RANGE[1]) out.push(`${a.name} hors de la plage des applis`); if (ODIN_PORTS.some((p) => p.port === a.host)) out.push(`${a.host} : ${a.name} prend un port d'Odin`); }
  // La plage proposée pour les ports directs ne marche sur aucun port du plan ni sur les autres plages.
  const inDirect = (n: number) => n >= DIRECT_RANGE[0] && n <= DIRECT_RANGE[1];
  for (const p of ODIN_PORTS) if (inDirect(p.port)) out.push(`${p.port} : ${p.name} est dans la plage des ports directs`);
  for (const [a, b] of [APPS_RANGE, SERVICES_RANGE]) if (inDirect(a) || inDirect(b) || (a < DIRECT_RANGE[0] && b > DIRECT_RANGE[1])) out.push(`la plage ${a}-${b} chevauche celle des ports directs`);
  // Le port par défaut de chaque appli : unique, et sur aucun port du plan ni port refusé par les navigateurs.
  const vus = new Map<number, string>();
  for (const [app, port] of Object.entries(DEFAULT_DIRECT)) {
    if (vus.has(port)) out.push(`${port} : port par défaut de ${vus.get(port)} et de ${app}`); vus.set(port, app);
    if (port === WEB || ODIN_PORTS.some((p) => p.port === port)) out.push(`${port} : port par défaut de ${app}, déjà gardé par le plan`);
    if (port in BROWSER_BLOCKED || port % 100 === 0) out.push(`${port} : port par défaut de ${app} impossible`);
  }
  return out;
}

// ---------------- Ports directs des applis (réglés par le propriétaire ; écoute et réglages : directports.ts) ----------------
const direct = new Map<string, number>();
/** Les ports directs en place (tenus à jour par directports.ts) : ils comptent comme gardés, et le plan les montre. */
export function setDirectPorts(m: Record<string, number>): void { direct.clear(); for (const [k, v] of Object.entries(m)) if (Number.isInteger(v) && v > 0) direct.set(k, v); }
/** Le port direct d'une appli, s'il y en a un. */
export const directPort = (app: string): number | undefined => direct.get(app);
/** L'appli qui a ce port direct, s'il y en a une. */
export const directApp = (port: number): string | undefined => [...direct].find(([, p]) => p === port)?.[0];

/**
 * Les ports que les navigateurs refusent d'ouvrir (« bad ports » de la norme Fetch, § Port blocking, relue le
 * 13/11/2026) : une page servie sur l'un d'eux ne s'afficherait jamais. Le nom est celui du protocole qui le garde
 * (vide quand la norme n'en donne pas).
 */
export const BROWSER_BLOCKED: Record<number, string> = {
  1: 'tcpmux', 7: 'echo', 9: 'discard', 11: 'systat', 13: 'daytime', 15: 'netstat', 17: 'qotd', 19: 'chargen', 20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 37: 'time', 42: 'name',
  43: 'nicname', 53: 'domain', 69: 'tftp', 77: '', 79: 'finger', 87: '', 95: 'supdup', 101: 'hostname', 102: 'iso-tsap', 103: 'gppitnp', 104: 'acr-nema', 109: 'pop2', 110: 'pop3', 111: 'sunrpc',
  113: 'auth', 115: 'sftp', 117: 'uucp-path', 119: 'nntp', 123: 'ntp', 135: 'epmap', 137: 'netbios-ns', 139: 'netbios-ssn', 143: 'imap', 161: 'snmp', 179: 'bgp', 389: 'ldap', 427: 'svrloc',
  465: 'submissions', 512: 'exec', 513: 'login', 514: 'shell', 515: 'printer', 526: 'tempo', 530: 'courier', 531: 'chat', 532: 'netnews', 540: 'uucp', 548: 'afp', 554: 'rtsp', 556: 'remotefs',
  563: 'nntps', 587: 'submission', 601: 'syslog-conn', 636: 'ldaps', 989: 'ftps-data', 990: 'ftps', 993: 'imaps', 995: 'pop3s', 1719: 'h323gatestat', 1720: 'h323hostcall', 1723: 'pptp', 2049: 'nfs',
  3659: 'apple-sasl', 4045: 'npp', 4190: 'sieve', 5060: 'sip', 5061: 'sips', 6000: 'x11', 6566: 'sane-port', 6665: 'ircu', 6666: 'ircu', 6667: 'ircu', 6668: 'ircu', 6669: 'ircu', 6679: 'osaut',
  6697: 'ircs-u', 10080: 'amanda',
};

/**
 * Pourquoi ce port ne peut pas devenir le port direct de cette appli (rien : le plan le permet). Pur : la règle ne
 * regarde pas qui écoute vraiment sur la machine (c'est l'ouverture du port qui le dit : déjà pris, droits manquants).
 * `web` : le port de l'interface d'Odin ; `name` : le nom affiché d'une appli.
 */
export function directRefusal(port: number, app: string, o: { web?: number; name?: (id: string) => string; /** applis qui ont laissé leur port par défaut (retiré ou changé) : ce port-là est libre */ libres?: Set<string> } = {}): string | undefined {
  const nom = o.name ?? ((id: string) => id);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'un port est un nombre entier entre 1 et 65535';
  if (port === (o.web ?? WEB)) return `le port ${port} est celui de l'interface d'Odin : toutes les applis y sont déjà`;
  const other = directApp(port); if (other && other !== app) return `le port ${port} est déjà le port direct de ${nom(other)}`;
  const parDefaut = Object.entries(DEFAULT_DIRECT).find(([a, p]) => p === port && a !== app)?.[0];
  if (parDefaut && !o.libres?.has(parDefaut)) return `le port ${port} est celui de ${nom(parDefaut)} (plan des ports) : choisis-en un autre`;
  const p = ODIN_PORTS.find((x) => x.port === port);
  if (p) return `le port ${port} est gardé pour ${p.name} : ${p.what}`;
  const a = APP_PORTS.find((x) => x.host === port); if (a) return `le port ${port} est gardé pour ${a.name} (appli installée par Argo)`;
  if (port >= APPS_RANGE[0] && port <= APPS_RANGE[1]) return `les ports ${APPS_RANGE[0]} à ${APPS_RANGE[1]} sont gardés pour les applis installées (Argo)`;
  if (port >= SERVICES_RANGE[0] && port <= SERVICES_RANGE[1]) return `les ports ${SERVICES_RANGE[0]} à ${SERVICES_RANGE[1]} sont gardés pour les services mis à l'échelle (Argo)`;
  if (port in BROWSER_BLOCKED) return `les navigateurs refusent d'ouvrir le port ${port}${BROWSER_BLOCKED[port] ? ` (ils le gardent pour « ${BROWSER_BLOCKED[port]} »)` : ''} : la page ne s'afficherait jamais`;
  return undefined;
}
/**
 * Le port à proposer quand tu n'en donnes pas : pour une appli, son port par défaut s'il est libre, sinon le premier
 * libre de sa famille (8F01 à 8F99) ; à défaut (ou sans appli), le premier libre de la plage des ports directs.
 */
export function suggestDirect(busy: Iterable<number> = [], web = WEB, app?: string, family?: string): number | undefined {
  const pris = [...busy], d = app ? DEFAULT_DIRECT[app] : undefined;
  if (d && direct.get(app!) === d) return d;
  if (d && !new Set([...ODIN_PORTS.map((p) => p.port), ...pris, web, ...[...direct].filter(([a]) => a !== app).map(([, p]) => p)]).has(d)) return d;
  const no = new Set([...reserved(), ...pris, web]), f = app ? familyRange(app, family) : undefined;
  for (const [a, b] of [...(f ? [f] : []), DIRECT_RANGE]) for (let p = a; p <= b; p++) if (!no.has(p) && !(p in BROWSER_BLOCKED)) return p;
  return undefined;
}
