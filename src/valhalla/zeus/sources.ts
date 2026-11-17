// Zeus — le module météo unique d'Odin : toutes les adresses d'où vient la météo, au même endroit, et ce que chaque
// partie d'Odin en fait (Hestia, briefing du matin, alertes locales, Zeus). Fonctions pures, sauf les deux qui
// appellent un service (meteoDuJour, chercherLieu) et le ménage de la mémoire (purgerPositionsEnClair).
// Règle de confidentialité : une position n'est jamais gardée ici. Elle vient du lieu d'Odin (lieu.ts, chiffré dans
// les réglages d'Hestia) et part seulement, arrondie à 0,01°, dans la question posée au service météo.

/** Les adresses d'Open-Meteo (sans clé). Documentation : https://open-meteo.com/en/docs */
export const OPEN_METEO = {
  /** un nom de lieu → latitude, longitude, fuseau, pays */
  geocodage: 'https://geocoding-api.open-meteo.com/v1/search',
  /** prévisions : maintenant, heure par heure, jour par jour, un ou plusieurs modèles */
  previsions: 'https://api.open-meteo.com/v1/forecast',
  /** le temps qu'il a fait (réanalyse ERA5, la veille complétée par l'analyse ECMWF IFS) */
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  /** prévisions saisonnières (ECMWF SEAS5 en mois, EC46 en semaines), en écart à la normale */
  saisonnier: 'https://seasonal-api.open-meteo.com/v1/seasonal',
} as const;
export type CleSource = keyof typeof OPEN_METEO;
/** Le nom du village d'après une position (OpenStreetMap Nominatim) : pas de météo, mais c'est lui qui nomme le lieu. */
export const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

/** Le réglage de Zeus qui remplace chaque adresse (servent aux faux serveurs des essais). */
export const REGLAGE_ADRESSE: Record<CleSource, string> = { geocodage: 'adresseGeocodage', previsions: 'adressePrevisions', archive: 'adresseArchive', saisonnier: 'adresseSaisonnier' };
/** Les adresses en service : celles d'Open-Meteo, sauf celles changées dans les réglages (http ou https seulement). */
export function adressesDe(reglages: Record<string, unknown> = {}): Record<CleSource, string> {
  const out = { ...OPEN_METEO } as Record<CleSource, string>;
  for (const k of Object.keys(REGLAGE_ADRESSE) as CleSource[]) {
    const v = reglages[REGLAGE_ADRESSE[k]];
    if (typeof v === 'string' && /^https?:\/\/[^\s@]+$/.test(v.trim())) out[k] = v.trim().replace(/\/+$/, '');
  }
  return out;
}

// ---------------------------------------------------------------- Les modèles comparés

export interface Modele {
  id: string;
  /** le nom affiché en entier */ nom: string;
  /** le nom court des tableaux (lisibles à 390 px) */ court: string;
  /** qui le fait tourner */ qui: string;
  /** jusqu'où il prévoit */ portee: string;
}
/** La référence : le meilleur mélange choisi par Open-Meteo pour ce lieu, « l'information récupérée ». */
export const REFERENCE = 'best_match';
/** Les modèles qu'Open-Meteo sert et que Zeus compare (identifiants vérifiés par une vraie requête). Liste fermée. */
export const MODELES: Modele[] = [
  { id: 'best_match', nom: 'Information récupérée', court: 'Récupérée', qui: 'Open-Meteo, le meilleur modèle pour ce lieu', portee: '16 jours' },
  { id: 'ecmwf_ifs025', nom: 'ECMWF IFS', court: 'ECMWF', qui: 'Centre européen (ECMWF IFS 0,25°)', portee: '15 jours' },
  { id: 'ecmwf_aifs025_single', nom: 'ECMWF AIFS', court: 'AIFS', qui: 'Centre européen, modèle par apprentissage automatique (AIFS)', portee: '15 jours' },
  { id: 'meteofrance_seamless', nom: 'Météo-France', court: 'MF', qui: 'Météo-France (ARPEGE et AROME ; AROME ne couvre que la France)', portee: '4 jours, selon le lieu' },
  { id: 'icon_seamless', nom: 'DWD ICON', court: 'ICON', qui: 'Service météo allemand (DWD ICON)', portee: '7 jours' },
  { id: 'gfs_seamless', nom: 'NOAA GFS', court: 'GFS', qui: 'Service météo américain (NOAA GFS)', portee: '16 jours' },
];
export const IDS_MODELES = MODELES.map((m) => m.id);
export const modele = (id: string): Modele | undefined => MODELES.find((m) => m.id === id);
/** Les modèles choisis (liste fermée), la référence toujours en tête. */
export function modelesChoisis(v: unknown): string[] {
  const l = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []).map((x) => String(x).trim()).filter((x) => IDS_MODELES.includes(x));
  const choix = l.length ? l : IDS_MODELES;
  return [REFERENCE, ...IDS_MODELES.filter((x) => x !== REFERENCE && choix.includes(x))];
}

// ---------------------------------------------------------------- Les adresses des questions

/** Une position arrondie à 0,01° (environ 1 km) : jamais plus précis vers un service. */
export const arrondi = (x: number) => Math.round(x * 100) / 100;
export interface Point { lat: number; lon: number }
const pos = (p: Point) => `latitude=${arrondi(p.lat)}&longitude=${arrondi(p.lon)}`;
export const VARIABLES_JOUR = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max'] as const;

export function urlPrevisions(base: string, p: Point, modeles: string[], jours = 16): string {
  return `${base}?${pos(p)}&daily=${VARIABLES_JOUR.join(',')}&models=${modeles.join(',')}&timezone=auto&forecast_days=${Math.max(1, Math.min(16, Math.round(jours)))}`;
}
export function urlArchive(base: string, p: Point, debut: string, fin: string): string {
  return `${base}?${pos(p)}&start_date=${debut}&end_date=${fin}&daily=${VARIABLES_JOUR.join(',')}&timezone=auto`;
}
export const SEAS5 = 'ecmwf_seas5_ensemble_mean';
export const EC46 = 'ecmwf_ec46_ensemble_mean';
export function urlSaisonMois(base: string, p: Point): string {
  return `${base}?${pos(p)}&monthly=temperature_2m_anomaly,precipitation_anomaly,wind_speed_10m_anomaly&models=${SEAS5}&timezone=auto`;
}
export function urlSaisonSemaines(base: string, p: Point): string {
  return `${base}?${pos(p)}&weekly=temperature_2m_anomaly,precipitation_anomaly&models=${EC46}&timezone=auto`;
}

// ---------------------------------------------------------------- Lire les réponses

/** Les valeurs d'un jour : null = le modèle ne dit rien (au-delà de sa portée, ou valeur absente). */
export interface Valeurs { tmax: number | null; tmin: number | null; pluie: number | null; vent: number | null }
export interface JourValeurs extends Valeurs { jour: string }
const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const CLES: Array<[keyof Valeurs, string]> = [['tmax', 'temperature_2m_max'], ['tmin', 'temperature_2m_min'], ['pluie', 'precipitation_sum'], ['vent', 'wind_speed_10m_max']];
/** Une série d'Open-Meteo : `<variable>_<modèle>` quand plusieurs modèles sont demandés, sinon `<variable>`. */
function serie(bloc: Record<string, unknown>, variable: string, m: string, seul: boolean): unknown[] | undefined {
  const a = bloc[`${variable}_${m}`] ?? (seul ? bloc[variable] : undefined);
  return Array.isArray(a) ? a : undefined;
}
/**
 * Découpe une réponse « daily » multi-modèles : par modèle et par jour, { tmax, tmin, pluie, vent }, null gardé.
 * Un modèle absent de la réponse n'a pas d'entrée (≠ un modèle qui répond null au-delà de sa portée).
 */
export function lireMultiModeles(json: unknown, modeles: string[]): Record<string, JourValeurs[]> {
  const d = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const out: Record<string, JourValeurs[]> = {};
  if (!d || !Array.isArray(d.time)) return out;
  const jours = (d.time as unknown[]).map(String), seul = modeles.length === 1;
  for (const m of modeles) {
    const s = CLES.map(([k, v]) => [k, serie(d, v, m, seul)] as const);
    if (s.every(([, a]) => !a)) continue;
    out[m] = jours.map((jour, i) => ({ jour, ...Object.fromEntries(s.map(([k, a]) => [k, nombre(a?.[i])])) as unknown as Valeurs }));
  }
  return out;
}
/** Une réponse « daily » sans modèle (archive) : par jour. */
export function lireJours(json: unknown): JourValeurs[] { return lireMultiModeles(json, ['_'])['_'] ?? []; }

// ---------------------------------------------------------------- Pour le briefing et les alertes

/** Les valeurs « daily » demandées pour un lieu (meilleur modèle), sans rien garder. Lève une erreur si le service ne répond pas. */
export async function meteoDuJour(fetchFn: typeof fetch, p: Point, jours: number, variables: string[], base: string = OPEN_METEO.previsions): Promise<{ daily?: Record<string, unknown[]>; timezone?: string }> {
  const r = await fetchFn(`${base}?${pos(p)}&daily=${variables.join(',')}&timezone=auto&forecast_days=${Math.max(1, Math.min(16, Math.round(jours)))}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Open-Meteo répond ${r.status}`);
  return await r.json() as { daily?: Record<string, unknown[]>; timezone?: string };
}
/** Le premier lieu qui porte ce nom (Open-Meteo), sans rien garder. */
export async function chercherLieu(fetchFn: typeof fetch, nom: string, base: string = OPEN_METEO.geocodage): Promise<(Point & { nom: string; fuseau?: string }) | undefined> {
  const r = await fetchFn(`${base}?name=${encodeURIComponent(nom)}&count=1&language=fr`, { signal: AbortSignal.timeout(10_000) });
  const g = (await r.json() as { results?: Array<{ latitude: number; longitude: number; name: string; timezone?: string }> }).results?.[0];
  return g ? { lat: g.latitude, lon: g.longitude, nom: g.name, ...(g.timezone ? { fuseau: g.timezone } : {}) } : undefined;
}

// ---------------------------------------------------------------- Qui utilise quoi dans Odin

export interface LigneSource { adresse: string; nom: string; donne: string; portee: string; qui: string; doc: string }
/** Chaque adresse d'où vient la météo, ce qu'elle donne, sa portée et qui s'en sert dans Odin (montré dans l'onglet Sources). */
export const LIGNE_SOURCES: LigneSource[] = [
  { adresse: OPEN_METEO.geocodage, nom: 'Open-Meteo, recherche d\'un lieu', donne: 'Un nom de lieu → latitude, longitude, fuseau, pays (sans clé).', portee: 'Le monde entier, 10 résultats au plus.', qui: 'Hestia (choix du lieu), briefing du matin et alertes quand seule la ville est connue.', doc: 'https://open-meteo.com/en/docs/geocoding-api' },
  { adresse: OPEN_METEO.previsions, nom: 'Open-Meteo, prévisions', donne: 'Maintenant, heure par heure et jour par jour, pour un ou plusieurs modèles (sans clé).', portee: '16 jours au plus ; chaque modèle a sa propre portée (Météo-France : environ 4 jours hors de France).', qui: 'Hestia (meilleur modèle, 7 jours), briefing (1 jour), alertes (3 jours : pluie, rafales, orages), Zeus (6 modèles côte à côte).', doc: 'https://open-meteo.com/en/docs' },
  { adresse: OPEN_METEO.archive, nom: 'Open-Meteo, le temps qu\'il a fait', donne: 'Les valeurs mesurées reconstituées (réanalyse ERA5, la veille complétée par l\'analyse ECMWF IFS). Pas une station.', portee: 'Depuis 1940 ; ERA5 arrive avec 5 jours de retard.', qui: 'Zeus, pour dire si les prédictions étaient justes.', doc: 'https://open-meteo.com/en/docs/historical-weather-api' },
  { adresse: OPEN_METEO.saisonnier, nom: 'Open-Meteo, prévisions saisonnières', donne: 'Écart à la normale par mois (ECMWF SEAS5, moyenne de 51 membres) et par semaine (ECMWF EC46).', portee: 'SEAS5 : 6 à 7 mois ; EC46 : 46 jours. Les deux viennent du même centre européen.', qui: 'Zeus (onglet Mois).', doc: 'https://open-meteo.com/en/docs/seasonal-forecast-api' },
  { adresse: NOMINATIM, nom: 'OpenStreetMap Nominatim', donne: 'Le nom du village d\'après une position GPS. Pas de météo.', portee: 'Le monde entier.', qui: 'Hestia, quand le lieu est donné par la position de l\'appareil.', doc: 'https://nominatim.org/release-docs/latest/api/Reverse/' },
  { adresse: 'https://huggingface.co/nvidia/strata', nom: 'STRATA (NVIDIA Earth-2), sur ton propre serveur', donne: 'Températures, pluie, vent approché et pression, calculés par le modèle de recherche STRATA.', portee: 'De quelques heures à quelques jours ; pas de prévision à 1, 2 ou 3 mois.', qui: 'Personne : plus interrogé depuis le 17/11/2026 (un modèle qui n\'est pas celui d\'Odin), même à une adresse réglée.', doc: 'https://github.com/NVlabs/STRATA' },
];

// ---------------------------------------------------------------- Ménage : plus aucune position en clair

type KvMenage = { kvPrefix(prefix: string): Record<string, string>; setKv(k: string, v: string): void; compacterKv(): void };
/** Le préfixe des anciennes clés qui gardaient la position de la maison en clair dans la mémoire d'Odin. */
export const PREFIXE_POSITION_EN_CLAIR = 'weather-geo:';
/**
 * Efface les clés `weather-geo:*` de la mémoire d'Odin (elles gardaient la position de la maison en clair), puis
 * réécrit le fichier pour que les anciennes lignes disparaissent du disque. Rend le nombre de clés effacées.
 */
export function purgerPositionsEnClair(kv: KvMenage): number {
  const l = Object.keys(kv.kvPrefix(PREFIXE_POSITION_EN_CLAIR));
  for (const k of l) kv.setKv(`${PREFIXE_POSITION_EN_CLAIR}${k}`, '');
  if (l.length) kv.compacterKv();
  return l.length;
}
