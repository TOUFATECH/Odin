// Télécharger un fichier à partir d'un lien, sans se faire piéger. Sert aux applis qui acceptent « un lien »
// (convertir un fichier, l'analyser…). Les règles :
//   - http et https seulement ; jamais vers Odin lui-même (boucle locale) ni vers les métadonnées d'un hébergeur ;
//   - une adresse de la maison (192.168…, 10…, nom.local) n'est suivie que si le propriétaire a donné son accord
//     (l'action est alors « grave » : voir `lienDeMaison`) ;
//   - chaque redirection est revérifiée (un lien public ne peut pas renvoyer vers la maison) ;
//   - la taille est limitée, pendant le téléchargement aussi (un serveur peut mentir sur la taille annoncée) ;
//   - l'identifiant et le mot de passe (si le lien en demande) ne sont envoyés qu'au site du lien, jamais ailleurs.
import { lookup } from 'node:dns/promises';
import { hiddenV4, isPrivateHost } from '../heimdall/policy.ts';

/** Le nom ou l'adresse, nu : sans crochets, en minuscules, et l'IPv4 cachée dans une IPv6 (`::ffff:7f00:1`) remise en clair. */
const nu = (h: string) => hiddenV4(h).replace(/^(?:::ffff:|(?:0:){5}ffff:)/, '').replace(/\.+$/, '');
/** Odin lui-même (boucle locale) ou les métadonnées d'un hébergeur : jamais, même avec accord. Pur. */
export function hoteInterdit(host: string): boolean {
  const h = nu(host);
  return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || /^0\./.test(h) || h === '0.0.0.0' || h === '::1' || h === '::' || /^169\.254\./.test(h) || /^fe80:/.test(h) || h === 'fd00:ec2::254' || h === 'metadata.google.internal';
}
/** Le lien pointe-t-il, tel qu'il est écrit, vers une adresse de la maison (réseau privé, nom .local) ? Pur. */
export function lienDeMaison(raw: unknown): boolean {
  try { const u = new URL(String(raw ?? '').trim()); return /^https?:$/.test(u.protocol) && !hoteInterdit(u.hostname) && isPrivateHost(nu(u.hostname)); } catch { return false; }
}
/** Le lien, vérifié : http(s), sans identifiants écrits dedans, pas vers Odin lui-même. Lève une erreur claire. Pur. */
export function lienPropre(raw: unknown): URL {
  let u: URL; try { u = new URL(String(raw ?? '').trim()); } catch { throw new Error('lien invalide (attendu : https://…)'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('seuls les liens http et https sont acceptés');
  if (u.username || u.password) throw new Error('n\'écris pas l\'identifiant ni le mot de passe dans le lien : mets-les dans leurs cases (ils y sont masqués)');
  if (hoteInterdit(u.hostname)) throw new Error('adresse refusée : ce lien pointe vers la machine d\'Odin elle-même ou vers une adresse réservée');
  return u;
}

export interface Telecharge { data: Buffer; /** l'adresse finale, après redirections */ url: URL; type: string | null; disposition: string | null }
/**
 * Télécharge le fichier d'un lien (`max` octets au plus). `maison` : le propriétaire a accepté une adresse de son
 * réseau. `compte` : identifiant et mot de passe (authentification simple), envoyés au site du lien seulement.
 */
export async function telecharger(f: typeof fetch, raw: unknown, o: { max: number; maison?: boolean; timeoutMs?: number; compte?: { utilisateur: string; motDePasse: string }; resoudre?: (h: string) => Promise<string[]> }): Promise<Telecharge> {
  let url = lienPropre(raw); const depart = url.origin, fin = AbortSignal.timeout(o.timeoutMs ?? 180_000);
  const resoudre = o.resoudre ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
  for (let saut = 0; saut < 6; saut++) {
    if (saut) url = lienPropre(url.toString());
    // Le nom peut cacher une adresse de la maison : on regarde où il mène vraiment (sans DNS, le téléchargement échouera de lui-même).
    const adresses = [nu(url.hostname), ...(await resoudre(nu(url.hostname)).catch(() => [] as string[]))];
    if (adresses.some(hoteInterdit)) throw new Error(`${url.hostname} mène à la machine d'Odin elle-même ou à une adresse réservée : refusé`);
    if (!o.maison && adresses.some((a) => isPrivateHost(nu(a)))) throw new Error(saut ? `le lien renvoie vers une adresse de ton réseau (${url.hostname}) : refusé` : `${url.hostname} mène à une adresse de ton réseau : donne plutôt son adresse IP (Odin te demandera ton accord)`);
    const entetes: Record<string, string> = { accept: '*/*', 'user-agent': 'Odin' };
    // Même site, même port ET même protocole : une redirection de https vers http ne fait pas voyager le mot de passe en clair.
    if (o.compte && url.origin === depart) entetes.authorization = `Basic ${Buffer.from(`${o.compte.utilisateur}:${o.compte.motDePasse}`, 'utf8').toString('base64')}`;
    const r = await f(url, { redirect: 'manual', headers: entetes, signal: fin });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { await r.body?.cancel().catch(() => undefined); url = new URL(r.headers.get('location')!, url); continue; }
    if (r.status === 401 || r.status === 403) { await r.body?.cancel().catch(() => undefined); throw new Error(o.compte ? 'le site refuse cet identifiant ou ce mot de passe' : 'le site demande un identifiant et un mot de passe (ou refuse l\'accès)'); }
    if (!r.ok) { await r.body?.cancel().catch(() => undefined); throw new Error(`le site a répondu ${r.status}`); }
    const trop = () => new Error(`fichier trop gros (${Math.round(o.max / 1e6)} Mo au plus)`);
    if (Number(r.headers.get('content-length') ?? 0) > o.max) { await r.body?.cancel().catch(() => undefined); throw trop(); }
    const morceaux: Buffer[] = []; let n = 0;
    if (r.body) for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { n += c.length; if (n > o.max) throw trop(); morceaux.push(Buffer.from(c)); }
    if (!n) throw new Error('le lien n\'a rien renvoyé');
    return { data: Buffer.concat(morceaux, n), url, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition') };
  }
  throw new Error('trop de redirections');
}
/** Un nom de fichier sûr tiré d'un lien ou d'un en-tête (jamais de chemin, jamais de fichier caché). Pur. */
export function nomDeLien(url: URL, disposition?: string | null, type?: string | null): string {
  const cd = /filename\*=(?:UTF-8'')?([^";]+)/i.exec(disposition ?? '')?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition ?? '')?.[1];
  const brut = cd ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
  let nom = (() => { try { return decodeURIComponent(brut); } catch { return brut; } })().split(/[\\/]/).pop()!.replace(/[:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').trim().slice(-120);
  if (!nom) nom = 'fichier';
  if (!/\.[A-Za-z0-9]{1,8}$/.test(nom)) { const e = TYPES[(type ?? '').split(';')[0].trim().toLowerCase()]; if (e) nom += `.${e}`; }
  return nom;
}
const TYPES: Record<string, string> = {
  'application/json': 'json', 'text/csv': 'csv', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html', 'application/xml': 'xml', 'text/xml': 'xml',
  'application/zip': 'zip', 'application/gzip': 'gz', 'application/x-tar': 'tar', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'text/vtt': 'vtt',
  'application/x-subrip': 'srt', 'text/calendar': 'ics', 'text/vcard': 'vcf', 'application/gpx+xml': 'gpx', 'application/geo+json': 'geojson',
  'application/vnd.google-earth.kml+xml': 'kml', 'application/x-yaml': 'yaml', 'text/yaml': 'yaml', 'application/toml': 'toml', 'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.oasis.opendocument.text': 'odt',
};
