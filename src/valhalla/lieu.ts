// Le lieu d'Odin et ce qui en découle. Odin se règle d'après l'endroit où il est installé : le pays donne les
// unités (métriques ou impériales), l'heure sur 12 ou 24 heures, la devise et les fêtes proposées d'office ; le fuseau
// donne l'heure locale. Tout se change à la main (Réglages → Maison → Lieu et région, ou « configure-toi pour … »).
// Ici : les règles (pures) et le lieu en cours, que le reste d'Odin lit (météo, thème, événements, consignes du modèle).

export type Unites = 'metrique' | 'imperial';
export type Heure = '24h' | '12h';
export interface Region {
  /** code du pays en deux lettres (FR, YT, US…) */
  pays: string; nom: string;
  unites: Unites; heure: Heure;
  /** code de la devise (EUR, USD…) */
  devise: string;
  /** les fêtes proposées d'office dans ce pays (identifiants de fetes.ts) ; ce que tu as choisi toi-même passe avant */
  fetes: Record<string, boolean>;
}

/** Les fêtes propres à la France d'Europe et d'outre-mer : pas celles de Mayotte seulement, pas celles d'ailleurs. */
const FETES_FR = { abolition: false };
const FETES_AILLEURS = { abolition: false, nationale: false, musique: false };
const FETES_US = { abolition: false, nationale: false, musique: false, travail: false, valentin: true, patrick: true, halloween: true, thanksgiving: true };
const P = (nom: string, devise: string, fetes: Record<string, boolean> = FETES_AILLEURS, unites: Unites = 'metrique', heure: Heure = '24h') => ({ nom, devise, fetes, unites, heure });
const PAYS: Record<string, { nom: string; devise: string; fetes: Record<string, boolean>; unites: Unites; heure: Heure }> = {
  YT: P('Mayotte', 'EUR', {}), FR: P('France', 'EUR', FETES_FR), RE: P('La Réunion', 'EUR', FETES_FR), GP: P('Guadeloupe', 'EUR', FETES_FR), MQ: P('Martinique', 'EUR', FETES_FR),
  GF: P('Guyane', 'EUR', FETES_FR), NC: P('Nouvelle-Calédonie', 'XPF', FETES_FR), PF: P('Polynésie française', 'XPF', FETES_FR), PM: P('Saint-Pierre-et-Miquelon', 'EUR', FETES_FR),
  BE: P('Belgique', 'EUR'), CH: P('Suisse', 'CHF'), LU: P('Luxembourg', 'EUR'), MC: P('Monaco', 'EUR', FETES_FR), DE: P('Allemagne', 'EUR'), ES: P('Espagne', 'EUR'), IT: P('Italie', 'EUR'), PT: P('Portugal', 'EUR'), NL: P('Pays-Bas', 'EUR'),
  GB: P('Royaume-Uni', 'GBP', { ...FETES_AILLEURS, travail: false, valentin: true, halloween: true }, 'metrique', '12h'), IE: P('Irlande', 'EUR', { ...FETES_AILLEURS, valentin: true, patrick: true, halloween: true }),
  US: P('États-Unis', 'USD', FETES_US, 'imperial', '12h'), CA: P('Canada', 'CAD', { ...FETES_AILLEURS, valentin: true, halloween: true }, 'metrique', '12h'),
  MA: P('Maroc', 'MAD'), DZ: P('Algérie', 'DZD'), TN: P('Tunisie', 'TND'), SN: P('Sénégal', 'XOF'), CI: P('Côte d\'Ivoire', 'XOF'), ML: P('Mali', 'XOF'), CM: P('Cameroun', 'XAF'),
  KM: P('Comores', 'KMF'), MG: P('Madagascar', 'MGA'), MU: P('Maurice', 'MUR'), KE: P('Kenya', 'KES'), TZ: P('Tanzanie', 'TZS'), ZA: P('Afrique du Sud', 'ZAR'),
  AU: P('Australie', 'AUD', FETES_AILLEURS, 'metrique', '12h'), JP: P('Japon', 'JPY'), CN: P('Chine', 'CNY'), IN: P('Inde', 'INR', FETES_AILLEURS, 'metrique', '12h'), BR: P('Brésil', 'BRL'), MX: P('Mexique', 'MXN'),
  AE: P('Émirats arabes unis', 'AED'), SA: P('Arabie saoudite', 'SAR'), TR: P('Turquie', 'TRY'),
};
/** Le pays par défaut d'Odin (là où il est né). */
export const PAYS_PAR_DEFAUT = 'YT';
/** Ce qui découle d'un pays. Pays inconnu : unités métriques, 24 heures, euro, et les fêtes communes. */
export function regionDe(pays?: string): Region {
  const c = (pays ?? '').toUpperCase(), p = PAYS[c];
  return p ? { pays: c, ...p } : { pays: c || PAYS_PAR_DEFAUT, ...(c ? P(c, 'EUR') : PAYS[PAYS_PAR_DEFAUT]) };
}

/** Les fuseaux horaires qui désignent un seul pays, et la ville qu'on y suppose tant que rien n'est dit. */
const FUSEAUX: Record<string, [string, string]> = {
  'Indian/Mayotte': ['YT', 'Mamoudzou'], 'Europe/Paris': ['FR', 'Paris'], 'Indian/Reunion': ['RE', 'Saint-Denis'], 'America/Guadeloupe': ['GP', 'Pointe-à-Pitre'], 'America/Martinique': ['MQ', 'Fort-de-France'],
  'America/Cayenne': ['GF', 'Cayenne'], 'Pacific/Noumea': ['NC', 'Nouméa'], 'Pacific/Tahiti': ['PF', 'Papeete'], 'America/Miquelon': ['PM', 'Saint-Pierre'],
  'Europe/Brussels': ['BE', 'Bruxelles'], 'Europe/Zurich': ['CH', 'Zurich'], 'Europe/Luxembourg': ['LU', 'Luxembourg'], 'Europe/Monaco': ['MC', 'Monaco'], 'Europe/Berlin': ['DE', 'Berlin'], 'Europe/Madrid': ['ES', 'Madrid'],
  'Europe/Rome': ['IT', 'Rome'], 'Europe/Lisbon': ['PT', 'Lisbonne'], 'Europe/Amsterdam': ['NL', 'Amsterdam'], 'Europe/London': ['GB', 'Londres'], 'Europe/Dublin': ['IE', 'Dublin'],
  'America/New_York': ['US', 'New York'], 'America/Chicago': ['US', 'Chicago'], 'America/Denver': ['US', 'Denver'], 'America/Los_Angeles': ['US', 'Los Angeles'], 'America/Phoenix': ['US', 'Phoenix'],
  'America/Toronto': ['CA', 'Toronto'], 'America/Montreal': ['CA', 'Montréal'], 'America/Vancouver': ['CA', 'Vancouver'],
  'Africa/Casablanca': ['MA', 'Casablanca'], 'Africa/Algiers': ['DZ', 'Alger'], 'Africa/Tunis': ['TN', 'Tunis'], 'Africa/Dakar': ['SN', 'Dakar'], 'Africa/Abidjan': ['CI', 'Abidjan'], 'Africa/Douala': ['CM', 'Douala'],
  'Indian/Comoro': ['KM', 'Moroni'], 'Indian/Antananarivo': ['MG', 'Antananarivo'], 'Indian/Mauritius': ['MU', 'Port-Louis'],
  'Asia/Tokyo': ['JP', 'Tokyo'], 'Asia/Dubai': ['AE', 'Dubaï'], 'Australia/Sydney': ['AU', 'Sydney'],
};
/**
 * Ce que l'horloge de la machine laisse supposer (sans rien demander à Internet) : le pays et une ville. Rien quand
 * le fuseau ne dit rien (UTC sur un serveur loué) ou qu'il couvre plusieurs pays.
 */
export function lieuDuFuseau(tz?: string): { pays: string; ville: string } | undefined {
  const f = FUSEAUX[tz ?? '']; return f ? { pays: f[0], ville: f[1] } : undefined;
}
/** Un fuseau horaire que la machine connaît (« Europe/Paris ») ? */
export function fuseauValide(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$|^UTC$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return true; } catch { return false; }
}

// ---------------- Affichage selon les unités ----------------
export const versF = (c: number) => Math.round(c * 9 / 5 + 32);
export const versMph = (kmh: number) => Math.round(kmh / 1.609344);
/** « 29 °C » ou « 84 °F ». */
export const temperature = (c: number, u: Unites = 'metrique') => (u === 'imperial' ? `${versF(c)} °F` : `${c} °C`);
/** « 24° » ou « 75° » (sans l'unité, pour les minimums et maximums). */
export const degres = (c: number, u: Unites = 'metrique') => `${u === 'imperial' ? versF(c) : c}°`;
/** « 18 km/h » ou « 11 mph ». */
export const vitesse = (kmh: number, u: Unites = 'metrique') => (u === 'imperial' ? `${versMph(kmh)} mph` : `${kmh} km/h`);

// ---------------- Le lieu en cours (tenu à jour par Hestia ; lu par le reste d'Odin) ----------------
export interface LieuCourant { nom: string; lat?: number; lon?: number; fuseau?: string; region: Region; /** supposé d'après l'horloge de la machine, jamais confirmé */ suppose?: boolean }
let courant: LieuCourant | undefined;
export function setLieuCourant(l: LieuCourant | undefined): void { courant = l; }
export const lieuCourant = (): LieuCourant | undefined => courant;
/** Une ligne pour les consignes du modèle : où est Odin, et comment y parler des heures, des mesures et des prix. */
export function lieuPourConsignes(): string {
  const l = courant; if (!l) return '';
  const r = l.region;
  return `Lieu d'Odin : ${l.nom} (${r.nom})${l.suppose ? ', supposé d\'après l\'horloge de la machine' : ''}${l.fuseau ? ` · fuseau ${l.fuseau}` : ''} · ${r.unites === 'imperial' ? 'degrés Fahrenheit, miles' : 'degrés Celsius, kilomètres'} · heure sur ${r.heure === '12h' ? '12 heures' : '24 heures'} · prix en ${r.devise}`;
}
