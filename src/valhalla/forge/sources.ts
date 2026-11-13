// Andromède (ISO) et Hermès (logiciels) — d'où viennent les fichiers : uniquement les sites officiels des éditeurs
// (ou leurs dépôts GitHub), avec l'empreinte SHA-256 publiée par eux. Rien d'autre n'est téléchargé.
//
// Chaque source sait :
//   - reconnaître ses fichiers dans un dossier (« ubuntu-24.04.3-desktop-amd64.iso » → Ubuntu 24.04.3) ;
//   - trouver la dernière version publiée, son adresse et son empreinte ;
//   - donner une icône (celle du site de l'éditeur, gardée en cache par Odin ; sinon un pavé de couleur).

export type Kind = 'iso' | 'logiciel';
export interface Release { version: string; url: string; file: string; sha256?: string; size?: number; page?: string }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface Source {
  id: string; name: string; kind: Kind; family: string;
  /** Une phrase : ce que c'est. */
  about: string;
  /** Reconnaît un fichier de cette source et rend sa version. */
  match: RegExp;
  /** Icône : adresse officielle (favicon de l'éditeur, avatar GitHub du projet). */
  icon?: string; color: string;
  /** La page officielle (pour les éditeurs qui ne permettent pas le téléchargement automatique). */
  page: string;
  /** Pas de téléchargement automatique possible (ex. Microsoft) : Odin prévient et donne la page officielle. */
  manual?: string;
  latest?: (f: Fetch) => Promise<Release>;
  /** Source ajoutée par l'utilisateur (dépôt GitHub ou adresse directe). */
  custom?: boolean;
}

// ---------------- Outils purs ----------------
/** Compare deux versions naturellement (« 24.04.10 » > « 24.04.9 », « 2025.01.01 » > « 2024.12.01 »). */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[^0-9a-z]+/i).filter(Boolean), pb = b.split(/[^0-9a-z]+/i).filter(Boolean);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '', y = pb[i] ?? '';
    if (x === y) continue; if (!x) return -1; if (!y) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y) || x.length - y.length;
    if (nx !== ny) return nx ? 1 : -1; // « 1.0 » > « 1.0rc »
    return x < y ? -1 : 1;
  }
  return 0;
}
/** Lit un fichier d'empreintes : « hash  fichier », « hash *fichier » ou « SHA256 (fichier) = hash ». Pur. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of text.split('\n')) {
    const a = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(l.trim()), b = /^SHA256\s*\((.+?)\)\s*=\s*([a-f0-9]{64})\s*$/i.exec(l.trim());
    if (a) out.set(a[2].replace(/^\.\//, ''), a[1].toLowerCase()); else if (b) out.set(b[1], b[2].toLowerCase());
  }
  return out;
}
/** Les liens d'une page d'index (Apache, nginx) : noms de dossiers et de fichiers. Pur. */
export function parseIndex(html: string): string[] {
  return [...new Set([...html.matchAll(/href="([^"?#]+)"/gi)].map((m) => decodeURIComponent(m[1])).filter((h) => !/^(?:\/|\.\.|https?:|mailto:)/.test(h)))];
}
/** La plus haute version parmi des noms, d'après une expression (groupe 1 = version). Pur. */
export function highest(names: string[], re: RegExp): { name: string; version: string } | undefined {
  let best: { name: string; version: string } | undefined;
  for (const n of names) { const m = re.exec(n); if (m && (!best || cmpVersion(m[1], best.version) > 0)) best = { name: n, version: m[1] }; }
  return best;
}
const text = async (f: Fetch, url: string) => { const r = await f(url, { headers: { 'user-agent': 'Odin-Eitri/1', accept: '*/*' }, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`${new URL(url).host} répond ${r.status}`); return r.text(); };
const json = async <T>(f: Fetch, url: string, headers: Record<string, string> = {}) => JSON.parse(await text2(f, url, headers)) as T;
const text2 = async (f: Fetch, url: string, headers: Record<string, string>) => { const r = await f(url, { headers: { 'user-agent': 'Odin-Eitri/1', ...headers }, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`${new URL(url).host} répond ${r.status}`); return r.text(); };
const join = (base: string, rel: string) => new URL(rel, base.endsWith('/') ? base : `${base}/`).toString();

// ---------------- Façons de trouver la dernière version ----------------
/** Un fichier d'empreintes à une adresse fixe : le fichier qui correspond est la dernière version. */
const sumsAt = (dir: string, sums: string, re: RegExp) => async (f: Fetch): Promise<Release> => {
  const s = parseSums(await text(f, join(dir, sums))), h = highest([...s.keys()], re); if (!h) throw new Error('aucun fichier reconnu dans les empreintes officielles');
  return { version: h.version, file: h.name.split('/').pop()!, url: join(dir, h.name), sha256: s.get(h.name) };
};
/** Un index de dossiers par version (« 24.04.3/ ») puis un fichier d'empreintes dans le dossier le plus récent. */
const indexThenSums = (index: string, dirRe: RegExp, sums: string | RegExp, re: RegExp, sub = '') => async (f: Fetch): Promise<Release> => {
  const d = highest(parseIndex(await text(f, index)), dirRe); if (!d) throw new Error('aucune version trouvée sur le site officiel');
  const dir = join(index, `${d.name.replace(/\/?$/, '/')}${sub}`);
  const sumsName = typeof sums === 'string' ? sums : parseIndex(await text(f, dir)).find((n) => sums.test(n)); if (!sumsName) throw new Error('fichier d\'empreintes introuvable');
  return sumsAt(dir, sumsName, re)(f);
};
/** Un index de fichiers, chaque fichier avec son « .sha256 » à côté. */
const indexSidecar = (dir: string, re: RegExp) => async (f: Fetch): Promise<Release> => {
  const h = highest(parseIndex(await text(f, dir)).filter((n) => !/\.(sha256|sha512|asc|sig|md5)$/i.test(n)), re); if (!h) throw new Error('aucun fichier reconnu sur le site officiel');
  const sha = /([a-f0-9]{64})/i.exec(await text(f, join(dir, `${h.name}.sha256`)))?.[1]?.toLowerCase();
  return { version: h.version, file: h.name, url: join(dir, h.name), sha256: sha };
};
/** La dernière version d'un dépôt GitHub (le fichier qui correspond, et son empreinte publiée par GitHub). */
export const github = (repo: string, re: RegExp) => async (f: Fetch): Promise<Release> => {
  const r = await json<{ tag_name: string; html_url: string; assets: Array<{ name: string; browser_download_url: string; size: number; digest?: string | null }> }>(f, `https://api.github.com/repos/${repo}/releases/latest`, { accept: 'application/vnd.github+json' });
  const a = r.assets.find((x) => re.test(x.name)); if (!a) throw new Error(`aucun fichier « ${re.source} » dans la version ${r.tag_name}`);
  const v = re.exec(a.name)?.[1] ?? r.tag_name.replace(/^v/i, '');
  // L'empreinte : celle de GitHub, sinon un fichier d'empreintes joint à la version.
  let sha = a.digest?.startsWith('sha256:') ? a.digest.slice(7) : undefined;
  if (!sha) { const s = r.assets.find((x) => /sha256|checksums?|sums/i.test(x.name) && !/\.(sig|asc)$/i.test(x.name)); if (s) sha = parseSums(await text(f, s.browser_download_url)).get(a.name); }
  return { version: v, file: a.name, url: a.browser_download_url, sha256: sha, size: a.size, page: r.html_url };
};

// ---------------- Les ISO (Andromède) ----------------
const gh = (o: string) => `https://github.com/${o}.png?size=64`;
export const ISO: Source[] = [
  { id: 'ubuntu', name: 'Ubuntu (bureau, LTS)', kind: 'iso', family: 'Linux', about: 'Ubuntu Desktop, version suivie longtemps (LTS)', match: /^ubuntu-(\d\d\.04(?:\.\d+)?)-desktop-amd64\.iso$/, icon: 'https://ubuntu.com/favicon.ico', color: '#E95420', page: 'https://ubuntu.com/download/desktop', latest: indexThenSums('https://releases.ubuntu.com/', /^(\d\d\.04(?:\.\d+)?)\/$/, 'SHA256SUMS', /^ubuntu-(\d\d\.04(?:\.\d+)?)-desktop-amd64\.iso$/) },
  { id: 'ubuntu-server', name: 'Ubuntu Server (LTS)', kind: 'iso', family: 'Linux', about: 'Ubuntu pour serveur, LTS', match: /^ubuntu-(\d\d\.04(?:\.\d+)?)-live-server-amd64\.iso$/, icon: 'https://ubuntu.com/favicon.ico', color: '#E95420', page: 'https://ubuntu.com/download/server', latest: indexThenSums('https://releases.ubuntu.com/', /^(\d\d\.04(?:\.\d+)?)\/$/, 'SHA256SUMS', /^ubuntu-(\d\d\.04(?:\.\d+)?)-live-server-amd64\.iso$/) },
  { id: 'debian', name: 'Debian (netinst)', kind: 'iso', family: 'Linux', about: 'Debian stable, installation par le réseau', match: /^debian-(\d+\.\d+(?:\.\d+)?)-amd64-netinst\.iso$/, icon: 'https://www.debian.org/favicon.ico', color: '#A80030', page: 'https://www.debian.org/distrib/', latest: sumsAt('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/', 'SHA256SUMS', /^debian-(\d+\.\d+(?:\.\d+)?)-amd64-netinst\.iso$/) },
  { id: 'debian-dvd', name: 'Debian (DVD complet)', kind: 'iso', family: 'Linux', about: 'Debian stable, premier DVD', match: /^debian-(\d+\.\d+(?:\.\d+)?)-amd64-DVD-1\.iso$/, icon: 'https://www.debian.org/favicon.ico', color: '#A80030', page: 'https://www.debian.org/CD/', latest: sumsAt('https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/', 'SHA256SUMS', /^debian-(\d+\.\d+(?:\.\d+)?)-amd64-DVD-1\.iso$/) },
  { id: 'mint', name: 'Linux Mint (Cinnamon)', kind: 'iso', family: 'Linux', about: 'Linux Mint, bureau Cinnamon', match: /^linuxmint-(\d+(?:\.\d+)?)-cinnamon-64bit\.iso$/, icon: 'https://linuxmint.com/favicon.ico', color: '#87CF3E', page: 'https://linuxmint.com/download.php', latest: indexThenSums('https://mirrors.edge.kernel.org/linuxmint/stable/', /^(\d+(?:\.\d+)?)\/$/, 'sha256sum.txt', /^linuxmint-(\d+(?:\.\d+)?)-cinnamon-64bit\.iso$/) },
  { id: 'fedora', name: 'Fedora Workstation', kind: 'iso', family: 'Linux', about: 'Fedora, bureau GNOME', match: /^Fedora-Workstation-Live-(?:x86_64-)?(\d+-[\d.]+)(?:\.x86_64)?\.iso$/, icon: 'https://fedoraproject.org/favicon.ico', color: '#51A2DA', page: 'https://fedoraproject.org/workstation/download', latest: indexThenSums('https://download.fedoraproject.org/pub/fedora/linux/releases/', /^(\d+)\/$/, /CHECKSUM$/, /^Fedora-Workstation-Live-(?:x86_64-)?(\d+-[\d.]+)(?:\.x86_64)?\.iso$/, 'Workstation/x86_64/iso/') },
  { id: 'arch', name: 'Arch Linux', kind: 'iso', family: 'Linux', about: 'Arch Linux, image du mois', match: /^archlinux-(\d{4}\.\d\d\.\d\d)-x86_64\.iso$/, icon: 'https://archlinux.org/static/favicon.png', color: '#1793D1', page: 'https://archlinux.org/download/', latest: sumsAt('https://geo.mirror.pkgbuild.com/iso/latest/', 'sha256sums.txt', /^archlinux-(\d{4}\.\d\d\.\d\d)-x86_64\.iso$/) },
  { id: 'alpine', name: 'Alpine Linux', kind: 'iso', family: 'Linux', about: 'Alpine, très léger (serveurs, conteneurs)', match: /^alpine-standard-(\d+\.\d+\.\d+)-x86_64\.iso$/, icon: 'https://alpinelinux.org/alpinelinux-logo.svg', color: '#0D597F', page: 'https://alpinelinux.org/downloads/', latest: indexSidecar('https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/', /^alpine-standard-(\d+\.\d+\.\d+)-x86_64\.iso$/) },
  { id: 'kali', name: 'Kali Linux (installation)', kind: 'iso', family: 'Linux', about: 'Kali, outils de test de sécurité', match: /^kali-linux-(\d{4}\.\d+[a-z]?)-installer-amd64\.iso$/, icon: 'https://www.kali.org/images/favicon.svg', color: '#367BF0', page: 'https://www.kali.org/get-kali/', latest: sumsAt('https://cdimage.kali.org/current/', 'SHA256SUMS', /^kali-linux-(\d{4}\.\d+[a-z]?)-installer-amd64\.iso$/) },
  { id: 'rocky', name: 'Rocky Linux 9 (minimal)', kind: 'iso', family: 'Linux', about: 'Rocky Linux, compatible RHEL', match: /^Rocky-(9\.\d+)-x86_64-minimal\.iso$/, icon: 'https://rockylinux.org/favicon.png', color: '#10B981', page: 'https://rockylinux.org/download', latest: sumsAt('https://download.rockylinux.org/pub/rocky/9/isos/x86_64/', 'CHECKSUM', /^Rocky-(9\.\d+)-x86_64-minimal\.iso$/) },
  { id: 'alma', name: 'AlmaLinux 9 (minimal)', kind: 'iso', family: 'Linux', about: 'AlmaLinux, compatible RHEL', match: /^AlmaLinux-(9\.\d+)-x86_64-minimal\.iso$/, icon: 'https://almalinux.org/fr/favicon.ico', color: '#0F4266', page: 'https://almalinux.org/get-almalinux/', latest: sumsAt('https://repo.almalinux.org/almalinux/9/isos/x86_64/', 'CHECKSUM', /^AlmaLinux-(9\.\d+)-x86_64-minimal\.iso$/) },
  { id: 'proxmox', name: 'Proxmox VE', kind: 'iso', family: 'Serveur', about: 'Proxmox, machines virtuelles et conteneurs', match: /^proxmox-ve_(\d+\.\d+-\d+)\.iso$/, icon: 'https://www.proxmox.com/favicon.ico', color: '#E57000', page: 'https://www.proxmox.com/en/downloads', latest: sumsAt('https://enterprise.proxmox.com/iso/', 'SHA256SUMS', /^proxmox-ve_(\d+\.\d+-\d+)\.iso$/) },
  { id: 'proxmox-backup', name: 'Proxmox Backup Server', kind: 'iso', family: 'Serveur', about: 'Serveur de sauvegarde Proxmox', match: /^proxmox-backup-server_(\d+\.\d+-\d+)\.iso$/, icon: 'https://www.proxmox.com/favicon.ico', color: '#E57000', page: 'https://www.proxmox.com/en/downloads', latest: sumsAt('https://enterprise.proxmox.com/iso/', 'SHA256SUMS', /^proxmox-backup-server_(\d+\.\d+-\d+)\.iso$/) },
  { id: 'clonezilla', name: 'Clonezilla Live', kind: 'iso', family: 'Outils', about: 'Copie et restauration de disques', match: /^clonezilla-live-(\d+\.\d+\.\d+-\d+)-amd64\.iso$/, icon: gh('stevenshiau'), color: '#2B6CB0', page: 'https://clonezilla.org/downloads.php', latest: github('stevenshiau/clonezilla', /^clonezilla-live-(\d+\.\d+\.\d+-\d+)-amd64\.iso$/) },
  { id: 'gparted', name: 'GParted Live', kind: 'iso', family: 'Outils', about: 'Partitionner un disque', match: /^gparted-live-(\d+\.\d+\.\d+-\d+)-amd64\.iso$/, color: '#4A5568', page: 'https://gparted.org/download.php', manual: 'GParted est publié sur SourceForge : Odin repère ta version et te donne la page officielle.' },
  { id: 'windows11', name: 'Windows 11', kind: 'iso', family: 'Windows', about: 'Windows 11 (64 bits)', match: /^Win11_(\d\d[HhAa]\d)_[A-Za-z]+(?:_[A-Za-z]+)*_x64(?:v\d)?\.iso$/, icon: 'https://www.microsoft.com/favicon.ico', color: '#0078D4', page: 'https://www.microsoft.com/fr-fr/software-download/windows11', manual: 'Microsoft ne permet pas le téléchargement automatique de ses ISO : Odin repère tes ISO Windows, te prévient d\'une nouvelle version et ouvre la page officielle.' },
  { id: 'windows10', name: 'Windows 10', kind: 'iso', family: 'Windows', about: 'Windows 10 (64 bits)', match: /^Win10_(\d\d[HhAa]\d)_[A-Za-z]+(?:_[A-Za-z]+)*_x64(?:v\d)?\.iso$/, icon: 'https://www.microsoft.com/favicon.ico', color: '#0078D4', page: 'https://www.microsoft.com/fr-fr/software-download/windows10', manual: 'Microsoft ne permet pas le téléchargement automatique de ses ISO : Odin repère tes ISO Windows et ouvre la page officielle.' },
  { id: 'windows-server', name: 'Windows Server', kind: 'iso', family: 'Windows', about: 'Windows Server (évaluation ou licence)', match: /^(?:SERVER_EVAL_)?.*?Windows[_ ]?Server[_ ]?(\d{4}).*\.iso$/i, icon: 'https://www.microsoft.com/favicon.ico', color: '#0078D4', page: 'https://www.microsoft.com/fr-fr/evalcenter', manual: 'Le centre d\'évaluation de Microsoft demande un formulaire : Odin ne le remplit pas à ta place.' },
];

// ---------------- Les logiciels (Hermès) ----------------
const firefox = async (f: Fetch): Promise<Release> => {
  const v = (await json<{ LATEST_FIREFOX_VERSION: string }>(f, 'https://product-details.mozilla.org/1.0/firefox_versions.json')).LATEST_FIREFOX_VERSION;
  const base = `https://ftp.mozilla.org/pub/firefox/releases/${v}/`, rel = `win64/fr/Firefox Setup ${v}.exe`;
  return { version: v, file: `Firefox Setup ${v}.exe`, url: join(base, rel.split('/').map(encodeURIComponent).join('/')), sha256: parseSums(await text(f, join(base, 'SHA256SUMS'))).get(rel), page: 'https://www.mozilla.org/fr/firefox/' };
};
const vscode = async (f: Fetch): Promise<Release> => {
  const r = await json<{ name: string; url: string; sha256hash: string; productVersion?: string }>(f, 'https://update.code.visualstudio.com/api/update/win32-x64/stable/latest');
  const v = r.productVersion ?? r.name; return { version: v, file: `VSCodeSetup-x64-${v}.exe`, url: r.url, sha256: r.sha256hash, page: 'https://code.visualstudio.com/' };
};
const node = async (f: Fetch): Promise<Release> => {
  const l = await json<Array<{ version: string; lts: string | false; files: string[] }>>(f, 'https://nodejs.org/dist/index.json');
  const x = l.find((r) => r.lts && r.files.includes('win-x64-msi')); if (!x) throw new Error('aucune version LTS');
  const file = `node-${x.version}-x64.msi`, base = `https://nodejs.org/dist/${x.version}/`;
  return { version: x.version.replace(/^v/, ''), file, url: join(base, file), sha256: parseSums(await text(f, join(base, 'SHASUMS256.txt'))).get(file), page: 'https://nodejs.org/' };
};
export const SOFT: Source[] = [
  { id: 'firefox', name: 'Firefox', kind: 'logiciel', family: 'Internet', about: 'Navigateur de Mozilla (Windows, français)', match: /^Firefox Setup (\d+(?:\.\d+)+)\.exe$/, icon: 'https://www.mozilla.org/favicon.ico', color: '#FF7139', page: 'https://www.mozilla.org/fr/firefox/', latest: firefox },
  { id: 'vscode', name: 'Visual Studio Code', kind: 'logiciel', family: 'Développement', about: 'Éditeur de code', match: /^VSCodeSetup-x64-(\d+\.\d+\.\d+)\.exe$/, icon: 'https://code.visualstudio.com/favicon.ico', color: '#007ACC', page: 'https://code.visualstudio.com/', latest: vscode },
  { id: 'node', name: 'Node.js (LTS)', kind: 'logiciel', family: 'Développement', about: 'JavaScript côté serveur, version LTS', match: /^node-v(\d+\.\d+\.\d+)-x64\.msi$/, icon: 'https://nodejs.org/static/images/favicons/favicon.png', color: '#5FA04E', page: 'https://nodejs.org/', latest: node },
  { id: '7zip', name: '7-Zip', kind: 'logiciel', family: 'Outils', about: 'Archives (zip, 7z, rar…)', match: /^7z(\d{4})-x64\.exe$/, icon: gh('ip7z'), color: '#2E3440', page: 'https://www.7-zip.org/', latest: github('ip7z/7zip', /^7z(\d{4})-x64\.exe$/) },
  { id: 'notepadpp', name: 'Notepad++', kind: 'logiciel', family: 'Outils', about: 'Éditeur de texte', match: /^npp\.(\d+(?:\.\d+)+)\.Installer\.x64\.exe$/, icon: gh('notepad-plus-plus'), color: '#90E59A', page: 'https://notepad-plus-plus.org/', latest: github('notepad-plus-plus/notepad-plus-plus', /^npp\.(\d+(?:\.\d+)+)\.Installer\.x64\.exe$/) },
  { id: 'keepassxc', name: 'KeePassXC', kind: 'logiciel', family: 'Sécurité', about: 'Coffre de mots de passe', match: /^KeePassXC-(\d+\.\d+\.\d+)-Win64\.msi$/, icon: gh('keepassxreboot'), color: '#6CAC4D', page: 'https://keepassxc.org/', latest: github('keepassxreboot/keepassxc', /^KeePassXC-(\d+\.\d+\.\d+)-Win64\.msi$/) },
  { id: 'rufus', name: 'Rufus', kind: 'logiciel', family: 'Outils', about: 'Clé USB de démarrage (avec les ISO d\'Andromède)', match: /^rufus-(\d+\.\d+)\.exe$/, icon: gh('pbatard'), color: '#2C3E50', page: 'https://rufus.ie/', latest: github('pbatard/rufus', /^rufus-(\d+\.\d+)\.exe$/) },
  { id: 'ventoy', name: 'Ventoy', kind: 'logiciel', family: 'Outils', about: 'Clé USB qui démarre plusieurs ISO', match: /^ventoy-(\d+\.\d+\.\d+)-windows\.zip$/, icon: gh('ventoy'), color: '#2E7D32', page: 'https://www.ventoy.net/', latest: github('ventoy/Ventoy', /^ventoy-(\d+\.\d+\.\d+)-windows\.zip$/) },
  { id: 'git', name: 'Git pour Windows', kind: 'logiciel', family: 'Développement', about: 'Git et Git Bash', match: /^Git-(\d+\.\d+\.\d+(?:\.\d+)?)-64-bit\.exe$/, icon: gh('git-for-windows'), color: '#F05032', page: 'https://gitforwindows.org/', latest: github('git-for-windows/git', /^Git-(\d+\.\d+\.\d+(?:\.\d+)?)-64-bit\.exe$/) },
  { id: 'obs', name: 'OBS Studio', kind: 'logiciel', family: 'Multimédia', about: 'Enregistrer et diffuser l\'écran', match: /^OBS-Studio-(\d+\.\d+(?:\.\d+)?)-(?:Full-Installer-x64|Windows-x64-Installer|Windows-Installer)\.exe$/, icon: gh('obsproject'), color: '#302E31', page: 'https://obsproject.com/', latest: github('obsproject/obs-studio', /^OBS-Studio-(\d+\.\d+(?:\.\d+)?)-(?:Full-Installer-x64|Windows-x64-Installer|Windows-Installer)\.exe$/) },
  { id: 'powertoys', name: 'PowerToys', kind: 'logiciel', family: 'Outils', about: 'Petits outils Windows de Microsoft', match: /^PowerToysSetup-(\d+\.\d+\.\d+)-x64\.exe$/, icon: gh('microsoft'), color: '#0078D4', page: 'https://learn.microsoft.com/windows/powertoys/', latest: github('microsoft/PowerToys', /^PowerToysSetup-(\d+\.\d+\.\d+)-x64\.exe$/) },
  { id: 'vlc', name: 'VLC', kind: 'logiciel', family: 'Multimédia', about: 'Lecteur vidéo', match: /^vlc-(\d+\.\d+\.\d+)-win64\.exe$/, icon: 'https://www.videolan.org/favicon.ico', color: '#FF8800', page: 'https://www.videolan.org/vlc/', latest: indexSidecar('https://download.videolan.org/pub/videolan/vlc/last/win64/', /^vlc-(\d+\.\d+\.\d+)-win64\.exe$/) },
  { id: 'putty', name: 'PuTTY', kind: 'logiciel', family: 'Réseau', about: 'Connexion SSH', match: /^putty-64bit-(\d+\.\d+)-installer\.msi$/, color: '#4A5568', page: 'https://www.chiark.greenend.org.uk/~sgtatham/putty/', latest: async (f) => { const base = 'https://the.earth.li/~sgtatham/putty/latest/'; const s = parseSums(await text(f, join(base, 'sha256sums'))); const h = highest([...s.keys()], /^w64\/putty-64bit-(\d+\.\d+)-installer\.msi$/); if (!h) throw new Error('installateur introuvable'); return { version: h.version, file: h.name.split('/').pop()!, url: join(base, h.name), sha256: s.get(h.name) }; } },
  { id: 'wireguard', name: 'WireGuard', kind: 'logiciel', family: 'Réseau', about: 'Client VPN (avec Vortex)', match: /^wireguard-amd64-(\d+\.\d+\.\d+)\.msi$/, icon: 'https://www.wireguard.com/favicon.ico', color: '#88171A', page: 'https://www.wireguard.com/install/', latest: async (f) => { const dir = 'https://download.wireguard.com/windows-client/'; const h = highest(parseIndex(await text(f, dir)), /^wireguard-amd64-(\d+\.\d+\.\d+)\.msi$/); if (!h) throw new Error('installateur introuvable'); return { version: h.version, file: h.name, url: join(dir, h.name) }; } },
];

/** Une source ajoutée par l'utilisateur : un dépôt GitHub (« proprietaire/projet ») et le motif de son fichier. */
export function customSource(o: { id: string; name: string; kind: Kind; repo?: string; url?: string; pattern: string; sha256?: string; version?: string }): Source {
  let re: RegExp; try { re = new RegExp(`^${o.pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\{version\\\}|\{version\}/, '([0-9][0-9A-Za-z.\\-_]*?)')}$`, 'i'); } catch { throw new Error('motif invalide'); }
  if (!/\(/.test(re.source)) throw new Error('le motif doit contenir {version}, ex. MonLogiciel-{version}-x64.exe');
  const latest = o.repo ? github(o.repo, re) : o.url ? async (): Promise<Release> => { const file = decodeURIComponent(new URL(o.url!).pathname.split('/').pop() ?? ''); return { version: re.exec(file)?.[1] ?? o.version ?? 'inconnue', file, url: o.url!, sha256: o.sha256 }; } : undefined;
  return { id: o.id, name: o.name, kind: o.kind, family: 'Ajoutés par toi', about: o.repo ? `Dépôt GitHub ${o.repo}` : o.url ? 'Adresse directe' : 'Repéré dans le dossier', match: re, color: '#6B7280', page: o.repo ? `https://github.com/${o.repo}/releases` : o.url ?? '', ...(o.repo ? { icon: gh(o.repo.split('/')[0]) } : {}), latest, custom: true };
}
