// L'heure ailleurs, le décalage entre deux lieux et les changements d'heure de l'année, calculés exactement par la base
// des fuseaux livrée avec Node (`Intl`), sans service en ligne ni modèle. Première brique de la « réponse directe » d'une
// recherche : le résultat donne la phrase de réponse, les points, ce qui n'est pas sûr et la suite proposée, en DONNÉES
// (l'affichage et le branchement dans la conversation viennent ensuite, ailleurs).
//  - Les changements d'heure ne sont JAMAIS écrits ici : ils sont trouvés en parcourant les décalages de l'année demandée
//    (pas de 6 h), puis l'instant exact par dichotomie (à la seconde).
//  - Fuseaux à demi-heure et à trois quarts d'heure compris (décalages en minutes, jamais arrondis à l'heure).
//  - Un lieu se reconnaît dans une phrase par une petite liste de villes et de pays courants écrite ici, en attendant le
//    fichier des lieux ; les noms des pays viennent d'`Intl.DisplayNames` (toutes les langues qu'il connaît). Un identifiant
//    de fuseau (« Asia/Tokyo ») ou un décalage (« UTC+5:30 ») est reconnu aussi. Un lieu qu'il ne connaît pas est DIT
//    (« je ne connais pas ce lieu »), jamais deviné ; un pays à plusieurs fuseaux prend celui de sa capitale, et le dit.
//  - Les textes existent en français, anglais, espagnol, allemand, arabe et swahili ; une autre langue retombe sur
//    l'anglais (règle de repli des langues d'Odin). Heures, dates, durées et noms de pays sont mis en forme par `Intl`.
// Pur : aucune lecture de fichier, aucune horloge (l'instant « maintenant » est passé par l'appelant).

/** Un instant au mur d'un fuseau. */
export interface HeureMurale {
  fuseau: string;
  /** AAAA-MM-JJ, au mur du fuseau. */
  date: string;
  /** HH:MM (0 à 23 h), au mur du fuseau. */
  heure: string;
  /** Décalage sur le temps universel, en minutes (330 pour UTC+5:30). */
  utcMinutes: number;
}

/** Un changement d'heure : l'instant exact et les décalages avant et après. */
export interface ChangementHeure {
  /** L'instant (temps universel) où le nouveau décalage commence. */
  instant: Date;
  /** Décalages sur le temps universel avant et après, en minutes. */
  avant: number;
  apres: number;
  /** L'heure au mur juste avant le saut (« 02:00 ») et celle qu'on lit après (« 03:00 »), HH:MM. */
  murAvant: string;
  murApres: string;
  /** Le jour du changement, au mur du fuseau (AAAA-MM-JJ, après le changement). */
  date: string;
}

export interface LieuTrouve {
  /** Le nom tel qu'il est écrit dans la phrase. */
  nom: string;
  fuseau: string;
  sorte: 'ville' | 'pays' | 'fuseau';
  /** Code du pays (ISO 3166), quand on le sait. */
  pays?: string;
  /** Un pays à plusieurs fuseaux : celui de la capitale a été pris. */
  plusieursFuseaux?: boolean;
  /** Place dans la phrase (début, fin), en caractères. */
  debut: number;
  fin: number;
}

export interface Conseil { id: 'convertir-heure' | 'planifier-appel'; libelle: string }

export interface ReponseHeure {
  /** La langue des textes rendus (fr, en, es, de, ar, sw). */
  langue: string;
  /** Faux quand un lieu n'est pas reconnu : rien n'est calculé, `direct` le dit. */
  reconnu: boolean;
  lieux: LieuTrouve[];
  /** Les noms de lieux trouvés dans la phrase mais inconnus. */
  inconnus: string[];
  /** La phrase de réponse directe. */
  direct: string;
  /** Les points courts : écarts de l'année, changements d'heure de chaque lieu. */
  points: string[];
  /** Ce qui n'est pas sûr (hypothèses du calcul). */
  pasSur: string[];
  /** La suite proposée (boutons à venir). */
  conseils: Conseil[];
  /** Comment c'est calculé (pastille « calcul »). */
  calcul?: { par: 'Intl'; baseFuseaux: string; texte: string };
  /** L'année des changements d'heure décrits. */
  annee: number;
  /** Les nombres du calcul : l'heure de chaque côté et l'écart (minutes, B moins A). */
  donnees?: { instant: string; a?: HeureMurale & { nom: string }; b: HeureMurale & { nom: string }; ecartMinutes?: number };
  /** Une heure écrite dans la question (« 9 h », « 9am », « 21 Uhr ») : elle n'est PAS convertie, `pasSur` le dit. */
  heureEcrite?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Le calcul

const formats = new Map<string, Intl.DateTimeFormat>();
function format(fuseau: string): Intl.DateTimeFormat {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', era: 'short' });
    formats.set(fuseau, f);
  }
  return f;
}

/** Vrai si la base des fuseaux connaît ce fuseau (identifiant comme « Asia/Tokyo » ou décalage comme « +05:30 »). */
export function fuseauValide(fuseau: string): boolean {
  if (typeof fuseau !== 'string' || !fuseau.trim()) return false;
  try { format(fuseau); return true; } catch { return false; }
}

/** Les champs du mur d'un instant dans un fuseau. */
function mur(t: number, fuseau: string): { a: number; mo: number; j: number; h: number; mi: number; s: number } {
  const p: Record<string, string> = {};
  for (const x of format(fuseau).formatToParts(new Date(t))) p[x.type] = x.value;
  let a = Number(p.year);
  if (/^b/i.test(p.era ?? '')) a = 1 - a; // avant notre ère
  return { a, mo: Number(p.month), j: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** Le décalage d'un fuseau sur le temps universel à un instant, en minutes (peut porter des secondes pour les dates anciennes). */
export function decalageUtc(instant: Date | number, fuseau: string): number {
  const t = Math.floor(+instant / 1000) * 1000;
  const m = mur(t, fuseau);
  const u = new Date(0); u.setUTCFullYear(m.a, m.mo - 1, m.j); u.setUTCHours(m.h, m.mi, m.s, 0);
  return (u.getTime() - t) / 60_000;
}

const deux = (n: number) => String(n).padStart(2, '0');
const quatre = (n: number) => (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(4, '0');

/** L'heure qu'il est dans un fuseau à un instant. */
export function heureAilleurs(instant: Date | number, fuseau: string): HeureMurale {
  const m = mur(+instant, fuseau);
  return { fuseau, date: `${quatre(m.a)}-${deux(m.mo)}-${deux(m.j)}`, heure: `${deux(m.h)}:${deux(m.mi)}`, utcMinutes: decalageUtc(instant, fuseau) };
}

/** L'écart entre deux fuseaux à un instant, en minutes : l'heure de B moins l'heure de A (positif : B est en avance). */
export function decalage(instant: Date | number, fuseauA: string, fuseauB: string): number {
  return decalageUtc(instant, fuseauB) - decalageUtc(instant, fuseauA);
}

/** Le premier instant (à la seconde) d'une année au mur d'un fuseau : le 1er janvier à 0 h. */
function debutAnnee(annee: number, fuseau: string): number {
  const u = new Date(0); u.setUTCFullYear(annee, 0, 1); u.setUTCHours(0, 0, 0, 0);
  // Deux passes : le décalage au premier essai peut différer de celui de l'instant trouvé.
  let t = u.getTime() - decalageUtc(u, fuseau) * 60_000;
  t = u.getTime() - decalageUtc(t, fuseau) * 60_000;
  return t;
}

const PAS = 6 * 3600_000;
export const ANNEE_MIN = 1900, ANNEE_MAX = 2100;

/**
 * Les changements d'heure d'une année (au mur du fuseau, du 1er janvier au 31 décembre), dans l'ordre. Une année sans
 * changement rend une liste vide. Rien n'est écrit d'avance : chaque changement est trouvé dans la base des fuseaux.
 */
export function changementsHeure(annee: number, fuseau: string): ChangementHeure[] {
  if (!Number.isInteger(annee) || annee < ANNEE_MIN || annee > ANNEE_MAX) throw new RangeError(`année hors de ${ANNEE_MIN}-${ANNEE_MAX}`);
  if (!fuseauValide(fuseau)) throw new RangeError('fuseau inconnu');
  const debut = debutAnnee(annee, fuseau), fin = debutAnnee(annee + 1, fuseau);
  const out: ChangementHeure[] = [];
  let t = debut, d = decalageUtc(t, fuseau);
  while (t < fin) {
    const t2 = Math.min(t + PAS, fin), d2 = decalageUtc(t2, fuseau);
    if (d2 !== d) {
      // Le premier instant (à la seconde) qui porte un autre décalage que `d`.
      let bas = t, haut = t2;
      while (haut - bas > 1000) { const mil = bas + Math.floor((haut - bas) / 2000) * 1000; if (decalageUtc(mil, fuseau) === d) bas = mil; else haut = mil; }
      const apres = decalageUtc(haut, fuseau);
      if (haut < fin) {
        const ma = new Date(haut + d * 60_000), mp = new Date(haut + apres * 60_000);
        out.push({ instant: new Date(haut), avant: d, apres, murAvant: `${deux(ma.getUTCHours())}:${deux(ma.getUTCMinutes())}`, murApres: `${deux(mp.getUTCHours())}:${deux(mp.getUTCMinutes())}`, date: heureAilleurs(haut, fuseau).date });
      }
      t = haut; d = apres;
    } else { t = t2; }
  }
  return out;
}

/** Les périodes d'une année (au mur de A) où l'écart B moins A reste le même, en minutes. */
export function periodesEcart(annee: number, fuseauA: string, fuseauB: string): Array<{ debut: Date; fin: Date; ecart: number }> {
  const debut = debutAnnee(annee, fuseauA), fin = debutAnnee(annee + 1, fuseauA);
  const bornes = [...changementsHeure(annee, fuseauA), ...changementsHeure(annee, fuseauB)].map((c) => +c.instant).filter((x) => x > debut && x < fin);
  const tri = [...new Set([debut, ...bornes, fin])].sort((x, y) => x - y);
  const out: Array<{ debut: Date; fin: Date; ecart: number }> = [];
  for (let i = 0; i + 1 < tri.length; i++) {
    const e = decalage(tri[i], fuseauA, fuseauB);
    const der = out[out.length - 1];
    if (der && der.ecart === e) der.fin = new Date(tri[i + 1]);
    else out.push({ debut: new Date(tri[i]), fin: new Date(tri[i + 1]), ecart: e });
  }
  return out;
}

/** « UTC+5:30 », « UTC-3 », « UTC ». */
export function texteUtc(minutes: number): string {
  const m = Math.round(minutes);
  if (!m) return 'UTC';
  const a = Math.abs(m), h = Math.floor(a / 60), r = a % 60;
  return `UTC${m < 0 ? '-' : '+'}${h}${r ? ':' + deux(r) : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Les lieux connus (en attendant le fichier des lieux)

type Endroit = { fuseau: string; pays?: string; sorte: 'ville' | 'pays'; plusieurs?: boolean };

/** Les villes et régions : [code du pays, fuseau, noms dans plusieurs langues]. */
const VILLES: Array<[string, string, string[]]> = [
  ['JP', 'Asia/Tokyo', ['Tokyo', 'Tokio', 'Tōkyō', 'طوكيو']],
  ['KR', 'Asia/Seoul', ['Séoul', 'Seoul', 'Seúl', 'سيول']],
  ['CN', 'Asia/Shanghai', ['Pékin', 'Beijing', 'Peking', 'Pekín', 'بكين']],
  ['CN', 'Asia/Shanghai', ['Shanghai', 'Shanghái', 'Schanghai', 'شنغهاي']],
  ['HK', 'Asia/Hong_Kong', ['Hong Kong', 'Hongkong', 'هونغ كونغ']],
  ['SG', 'Asia/Singapore', ['Singapour', 'Singapore', 'Singapur', 'سنغافورة']],
  ['TH', 'Asia/Bangkok', ['Bangkok', 'بانكوك']],
  ['VN', 'Asia/Ho_Chi_Minh', ['Hanoï', 'Hanoi', 'Hanói', 'هانوي']],
  ['ID', 'Asia/Jakarta', ['Jakarta', 'Yakarta', 'جاكرتا']],
  ['PH', 'Asia/Manila', ['Manille', 'Manila', 'مانيلا']],
  ['IN', 'Asia/Kolkata', ['Mumbai', 'Bombay', 'مومباي']],
  ['IN', 'Asia/Kolkata', ['Delhi', 'New Delhi', 'Nueva Delhi', 'Neu-Delhi', 'نيودلهي', 'دلهي']],
  ['IN', 'Asia/Kolkata', ['Calcutta', 'Kolkata', 'كلكتا']],
  ['LK', 'Asia/Colombo', ['Colombo', 'كولومبو']],
  ['NP', 'Asia/Kathmandu', ['Katmandou', 'Kathmandu', 'Katmandú', 'كاتماندو']],
  ['AF', 'Asia/Kabul', ['Kaboul', 'Kabul', 'كابول']],
  ['IR', 'Asia/Tehran', ['Téhéran', 'Tehran', 'Teherán', 'Teheran', 'طهران']],
  ['MM', 'Asia/Yangon', ['Rangoun', 'Yangon', 'Rangoon', 'Rangún', 'يانغون']],
  ['AE', 'Asia/Dubai', ['Dubaï', 'Dubai', 'دبي']],
  ['SA', 'Asia/Riyadh', ['Riyad', 'Riyadh', 'Riad', 'الرياض']],
  ['SA', 'Asia/Riyadh', ['La Mecque', 'Mecca', 'Makkah', 'La Meca', 'Mekka', 'مكة']],
  ['QA', 'Asia/Qatar', ['Doha', 'الدوحة']],
  ['EG', 'Africa/Cairo', ['Le Caire', 'Cairo', 'El Cairo', 'Kairo', 'القاهرة']],
  ['TR', 'Europe/Istanbul', ['Istanbul', 'İstanbul', 'Estambul', 'إسطنبول']],
  ['RU', 'Europe/Moscow', ['Moscou', 'Moscow', 'Moscú', 'Moskau', 'موسكو']],
  ['RU', 'Asia/Vladivostok', ['Vladivostok', 'Wladiwostok', 'فلاديفوستوك']],
  ['GB', 'Europe/London', ['Londres', 'London', 'Londoni', 'لندن']],
  ['FR', 'Europe/Paris', ['Paris', 'París', 'Parisi', 'باريس']],
  ['DE', 'Europe/Berlin', ['Berlin', 'Berlín', 'برلين']],
  ['ES', 'Europe/Madrid', ['Madrid', 'مدريد']],
  ['IT', 'Europe/Rome', ['Rome', 'Roma', 'Rom', 'روما']],
  ['PT', 'Europe/Lisbon', ['Lisbonne', 'Lisbon', 'Lisboa', 'Lissabon', 'لشبونة']],
  ['NL', 'Europe/Amsterdam', ['Amsterdam', 'Ámsterdam', 'أمستردام']],
  ['GR', 'Europe/Athens', ['Athènes', 'Athens', 'Atenas', 'Athen', 'أثينا']],
  ['PL', 'Europe/Warsaw', ['Varsovie', 'Warsaw', 'Varsovia', 'Warschau', 'وارسو']],
  ['UA', 'Europe/Kyiv', ['Kyiv', 'Kiev', 'Kiew', 'Kyïv', 'كييف']],
  ['IE', 'Europe/Dublin', ['Dublin', 'Dublín', 'دبلن']],
  ['IS', 'Atlantic/Reykjavik', ['Reykjavik', 'Reykjavík', 'ريكيافيك']],
  ['SN', 'Africa/Dakar', ['Dakar', 'داكار']],
  ['CI', 'Africa/Abidjan', ['Abidjan', 'Abiyán', 'أبيدجان']],
  ['NG', 'Africa/Lagos', ['Lagos', 'لاغوس']],
  ['GH', 'Africa/Accra', ['Accra', 'Acra', 'أكرا']],
  ['CD', 'Africa/Kinshasa', ['Kinshasa', 'كينشاسا']],
  ['KE', 'Africa/Nairobi', ['Nairobi', 'نيروبي']],
  ['TZ', 'Africa/Dar_es_Salaam', ['Dar es Salaam', 'Dar es-Salaam', 'دار السلام']],
  ['UG', 'Africa/Kampala', ['Kampala', 'كمبالا']],
  ['RW', 'Africa/Kigali', ['Kigali', 'كيغالي']],
  ['ET', 'Africa/Addis_Ababa', ['Addis-Abeba', 'Addis Ababa', 'Adís Abeba', 'Addis Abeba', 'أديس أبابا']],
  ['ZA', 'Africa/Johannesburg', ['Johannesburg', 'Johannesburgo', 'جوهانسبرغ']],
  ['ZA', 'Africa/Johannesburg', ['Le Cap', 'Cape Town', 'Ciudad del Cabo', 'Kapstadt', 'كيب تاون']],
  ['MA', 'Africa/Casablanca', ['Casablanca', 'الدار البيضاء']],
  ['DZ', 'Africa/Algiers', ['Alger', 'Algiers', 'Argel', 'Algier']],
  ['US', 'America/New_York', ['New York', 'Nueva York', 'نيويورك']],
  ['US', 'America/Chicago', ['Chicago', 'شيكاغو']],
  ['US', 'America/Denver', ['Denver', 'دنفر']],
  ['US', 'America/Phoenix', ['Phoenix', 'فينيكس']],
  ['US', 'America/Los_Angeles', ['Los Angeles', 'Los Ángeles', 'لوس أنجلوس']],
  ['US', 'America/Los_Angeles', ['San Francisco', 'سان فرانسيسكو']],
  ['US', 'America/Anchorage', ['Anchorage', 'أنكوريج']],
  ['US', 'Pacific/Honolulu', ['Honolulu', 'هونولولو']],
  ['CA', 'America/Toronto', ['Toronto', 'تورنتو']],
  ['CA', 'America/Toronto', ['Montréal', 'Montreal', 'مونتريال']],
  ['CA', 'America/Vancouver', ['Vancouver', 'فانكوفر']],
  ['CA', 'America/St_Johns', ['Terre-Neuve', 'Newfoundland', 'Terranova', 'Neufundland', 'نيوفاوندلاند']],
  ['MX', 'America/Mexico_City', ['Mexico City', 'Ciudad de México', 'Mexiko-Stadt', 'مكسيكو سيتي']],
  ['CU', 'America/Havana', ['La Havane', 'Havana', 'La Habana', 'Havanna', 'هافانا']],
  ['CO', 'America/Bogota', ['Bogota', 'Bogotá', 'بوغوتا']],
  ['VE', 'America/Caracas', ['Caracas', 'كاراكاس']],
  ['PE', 'America/Lima', ['Lima', 'ليما']],
  ['CL', 'America/Santiago', ['Santiago du Chili', 'Santiago de Chile']],
  ['AR', 'America/Argentina/Buenos_Aires', ['Buenos Aires', 'بوينس آيرس']],
  ['BR', 'America/Sao_Paulo', ['São Paulo', 'Sao Paulo', 'ساو باولو']],
  ['BR', 'America/Sao_Paulo', ['Rio de Janeiro', 'Río de Janeiro', 'ريو دي جانيرو']],
  ['BR', 'America/Manaus', ['Manaus', 'Manaos', 'ماناوس']],
  ['AU', 'Australia/Sydney', ['Sydney', 'Sídney', 'سيدني']],
  ['AU', 'Australia/Melbourne', ['Melbourne', 'ملبورن']],
  ['AU', 'Australia/Brisbane', ['Brisbane', 'بريزبين']],
  ['AU', 'Australia/Adelaide', ['Adélaïde', 'Adelaide', 'Adelaida', 'أديلايد']],
  ['AU', 'Australia/Darwin', ['Darwin', 'داروين']],
  ['AU', 'Australia/Lord_Howe', ['Lord Howe', 'île Lord Howe']],
  ['NZ', 'Pacific/Auckland', ['Auckland', 'أوكلاند']],
  ['NZ', 'Pacific/Auckland', ['Wellington', 'ويلينغتون']],
  // « Chatham » seul n'est pas pris : d'autres villes portent ce nom.
  ['NZ', 'Pacific/Chatham', ['îles Chatham', 'Chatham Islands', 'Islas Chatham', 'Chathaminseln']],
  ['WS', 'Pacific/Apia', ['Apia']],
  ['PF', 'Pacific/Marquesas', ['îles Marquises', 'Marquises', 'Marquesas Islands', 'Marquesas', 'Islas Marquesas', 'Marquesas-Inseln']],
  ['KI', 'Pacific/Kiritimati', ['Kiritimati']],
];

/** Les pays : [code, fuseau de la capitale, plusieurs fuseaux ?, noms ajoutés à ceux d'Intl]. */
const PAYS: Array<[string, string, boolean, string[]]> = [
  ['FR', 'Europe/Paris', true, []],
  ['GB', 'Europe/London', false, ['Angleterre', 'England', 'Inglaterra', 'UK', 'Grande-Bretagne', 'Great Britain', 'Britain', 'Gran Bretaña', 'Großbritannien', 'بريطانيا', 'إنجلترا', 'Uingereza']],
  ['DE', 'Europe/Berlin', false, []],
  ['ES', 'Europe/Madrid', true, []],
  ['IT', 'Europe/Rome', false, []],
  ['PT', 'Europe/Lisbon', true, []],
  ['BE', 'Europe/Brussels', false, []],
  ['CH', 'Europe/Zurich', false, []],
  ['NL', 'Europe/Amsterdam', false, ['Hollande', 'Holland', 'Holanda']],
  ['GR', 'Europe/Athens', false, []],
  ['PL', 'Europe/Warsaw', false, []],
  ['UA', 'Europe/Kyiv', false, []],
  ['IE', 'Europe/Dublin', false, []],
  ['RU', 'Europe/Moscow', true, []],
  ['TR', 'Europe/Istanbul', false, ['Turkey', 'Turquie']],
  ['EG', 'Africa/Cairo', false, []],
  ['MA', 'Africa/Casablanca', false, []],
  ['DZ', 'Africa/Algiers', false, []],
  ['TN', 'Africa/Tunis', false, []],
  ['SN', 'Africa/Dakar', false, []],
  ['CI', 'Africa/Abidjan', false, ["Côte d'Ivoire", 'Ivory Coast']],
  ['NG', 'Africa/Lagos', false, []],
  ['GH', 'Africa/Accra', false, []],
  ['CD', 'Africa/Kinshasa', true, ['RDC', 'RD Congo']],
  ['KE', 'Africa/Nairobi', false, []],
  ['TZ', 'Africa/Dar_es_Salaam', false, []],
  ['UG', 'Africa/Kampala', false, []],
  ['RW', 'Africa/Kigali', false, []],
  ['ET', 'Africa/Addis_Ababa', false, []],
  ['ZA', 'Africa/Johannesburg', false, []],
  ['SA', 'Asia/Riyadh', false, ['السعودية']],
  ['AE', 'Asia/Dubai', false, ['Émirats', 'Emirates', 'الإمارات']],
  ['QA', 'Asia/Qatar', false, []],
  ['IR', 'Asia/Tehran', false, []],
  ['AF', 'Asia/Kabul', false, []],
  ['IN', 'Asia/Kolkata', false, []],
  ['LK', 'Asia/Colombo', false, []],
  ['NP', 'Asia/Kathmandu', false, []],
  ['MM', 'Asia/Yangon', false, []],
  ['TH', 'Asia/Bangkok', false, []],
  ['VN', 'Asia/Ho_Chi_Minh', false, []],
  ['CN', 'Asia/Shanghai', false, []],
  ['JP', 'Asia/Tokyo', false, []],
  ['KR', 'Asia/Seoul', false, ['Corée', 'Korea']],
  ['ID', 'Asia/Jakarta', true, []],
  ['PH', 'Asia/Manila', false, []],
  ['SG', 'Asia/Singapore', false, []],
  ['AU', 'Australia/Sydney', true, []],
  ['NZ', 'Pacific/Auckland', true, []],
  ['US', 'America/New_York', true, ['USA', 'EEUU', 'EE UU']],
  ['CA', 'America/Toronto', true, []],
  ['MX', 'America/Mexico_City', true, []],
  ['CU', 'America/Havana', false, []],
  ['CO', 'America/Bogota', false, []],
  ['VE', 'America/Caracas', false, []],
  ['PE', 'America/Lima', false, []],
  ['CL', 'America/Santiago', true, []],
  ['AR', 'America/Argentina/Buenos_Aires', false, []],
  ['BR', 'America/Sao_Paulo', true, []],
  ['WS', 'Pacific/Apia', false, []],
];

/** Les langues dont `Intl.DisplayNames` donne les noms de pays reconnus dans une phrase. */
const LANGUES_NOMS = ['fr', 'en', 'es', 'de', 'ar', 'sw', 'it', 'pt'];

/** Le fuseau de capitale de chaque pays de la liste (pour l'essai et les appelants). */
export const fuseauxConnus = (): string[] => [...new Set([...VILLES.map((v) => v[1]), ...PAYS.map((p) => p[1])])];

/** Minuscules, sans accents (toutes écritures), ß → ss. */
function norm(w: string): string {
  return w.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}
type Jeton = { n: string; debut: number; fin: number; maj: boolean; arabe: boolean };
function jetons(s: string): Jeton[] {
  const out: Jeton[] = [];
  for (const m of s.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const debut = m.index ?? 0;
    out.push({ n: norm(m[0]), debut, fin: debut + m[0].length, maj: /^\p{Lu}/u.test(m[0]), arabe: /\p{Script=Arabic}/u.test(m[0]) });
  }
  return out;
}

type Entree = { toks: string[]; e: Endroit };
let index: Map<string, Entree[]> | undefined;
function lIndex(): Map<string, Entree[]> {
  if (index) return index;
  const m = new Map<string, Entree[]>();
  const vus = new Set<string>();
  const ajouter = (nom: string, e: Endroit) => {
    const toks = jetons(nom).map((t) => t.n);
    const cle = toks.join(' ');
    if (!toks.length || vus.has(cle)) return;
    vus.add(cle);
    const l = m.get(toks[0]) ?? []; l.push({ toks, e }); m.set(toks[0], l);
  };
  // Les villes d'abord : un nom porté par une ville et par un pays (Singapour) reste la ville, même fuseau.
  for (const [pays, fuseau, noms] of VILLES) for (const n of noms) ajouter(n, { fuseau, pays, sorte: 'ville' });
  for (const [pays, fuseau, plusieurs, noms] of PAYS) {
    const e: Endroit = { fuseau, pays, sorte: 'pays', plusieurs };
    for (const l of LANGUES_NOMS) {
      let n: string | undefined;
      try { n = new Intl.DisplayNames([l], { type: 'region' }).of(pays); } catch { n = undefined; }
      if (!n || n === pays) continue;
      ajouter(n, e);
      // « Myanmar (Birmanie) » : chacun des deux noms seul aussi.
      const par = /^(.*?)\s*\((.+)\)\s*$/.exec(n);
      if (par) { ajouter(par[1], e); ajouter(par[2], e); }
    }
    for (const n of noms) ajouter(n, e);
  }
  for (const l of m.values()) l.sort((a, b) => b.toks.length - a.toks.length);
  index = m;
  return m;
}

/**
 * Les noms qui sont aussi des mots courants (« the turkey », « les paris », « chile », « lagos ») : pris seulement avec
 * une majuscule, ou juste après un mot comme « à », « in », « en » (« quelle heure à paris »).
 */
const MAJUSCULE_REQUISE = new Set(['turkey', 'china', 'japan', 'chile', 'chili', 'cuba', 'peru', 'lagos', 'lima', 'paris', 'roma', 'manila', 'phoenix', 'darwin', 'wellington']);

/** Les préfixes collés d'un mot arabe (« و », « ب », « ل », « ف », « ك » et leurs paires). */
const PREFIXES_AR = ['', 'و', 'ب', 'ل', 'ف', 'ك', 'وب', 'ول', 'فب', 'فل'];

// ---------------------------------------------------------------------------------------------------------------
// Les mots de la question, par langue (sous forme normalisée : minuscules, sans accents)

const MOTS_HEURE: Record<string, string[]> = {
  fr: ['heure', 'heures', 'decalage', 'fuseau', 'fuseaux', 'horaire', 'horaires'],
  en: ['time', 'times', 'timezone', 'clock', 'clocks', 'dst'],
  es: ['hora', 'horas', 'horario', 'horaria', 'huso', 'husos'],
  de: ['uhr', 'uhrzeit', 'spat', 'zeitunterschied', 'zeitzone', 'zeitzonen', 'zeitverschiebung', 'zeitumstellung', 'sommerzeit', 'winterzeit'],
  ar: ['الساعة', 'ساعة', 'الوقت', 'وقت', 'التوقيت', 'توقيت', 'فرق', 'فارق'],
  sw: ['saa', 'ngapi', 'muda'],
};
/** Les mots après lesquels un nom de lieu est attendu (pour dire qu'un lieu est inconnu). */
const AVANT_LIEU: Record<string, string[]> = {
  fr: ['a', 'en', 'au', 'aux', 'entre', 'et', 'de', 'du'],
  en: ['in', 'at', 'between', 'and', 'from'],
  es: ['en', 'entre', 'y', 'de'],
  de: ['in', 'zwischen', 'und', 'nach'],
  ar: ['في', 'بين'],
  sw: ['huko', 'katika', 'kati', 'na'],
};
const PAS_UN_LIEU_AR = new Set(['هذا', 'هذه', 'ذلك', 'الان', 'الوقت', 'وقت']);
/**
 * Les mots à majuscule qui suivent souvent « in », « und »… sans être un lieu : « I », les saisons, les mois et les jours
 * (anglais, allemand), et en allemand les noms courants d'une question d'heure (tous les noms y ont une majuscule).
 */
const PAS_UN_LIEU = new Set([
  'i', 'summer', 'winter', 'spring', 'autumn', 'fall', 'daylight', 'standard', 'today', 'tomorrow', 'tonight',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'zeit', 'sommer', 'fruhling', 'fruhjahr', 'herbst', 'stunde', 'stunden', 'minute', 'minuten', 'tag', 'tage', 'woche', 'monat', 'jahr',
  'morgen', 'abend', 'nacht', 'mittag', 'vormittag', 'nachmittag', 'ordnung', 'zukunft',
  'januar', 'februar', 'marz', 'mai', 'juni', 'juli', 'oktober', 'dezember',
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
]);
/** Les mots qu'on saute entre « in » et le nom (« in der Stadt X », « في مدينة X », « à la ville de X »). */
const TRANSPARENTS = new Set([
  'the', 'city', 'la', 'le', 'l', 'les', 'ville', 'el', 'ciudad', 'der', 'die', 'dem', 'den', 'stadt', 'hauptstadt', 'mji', 'jiji', 'wa',
  'مدينة', 'عاصمة', 'دولة', 'بلد', 'بلاد', 'جزيرة', 'جزر', 'منطقة', 'ولاية',
]);

const sansPrefixeAr = (n: string): string[] => PREFIXES_AR.filter((p) => n.startsWith(p) && n.length - p.length >= 2).map((p) => n.slice(p.length));

// ---------------------------------------------------------------------------------------------------------------
// Trouver les lieux dans une phrase

/** Les lieux connus d'une phrase, dans l'ordre, et les noms qui ressemblent à un lieu mais que je ne connais pas. */
export function trouverLieux(phrase: string): { lieux: LieuTrouve[]; inconnus: string[] } {
  const js = jetons(phrase);
  const idx = lIndex();
  const trouves: LieuTrouve[] = [];
  const pris = (d: number, f: number) => trouves.some((t) => d < t.fin && f > t.debut);
  // 1. Les identifiants de fuseau (« Asia/Tokyo », « Etc/GMT+5 ») et les décalages (« UTC+5:30 », « GMT-3 »), sans relire
  //    une portion déjà prise (« Etc/GMT+5 » vaut UTC-5 : sa fin n'est pas un second « GMT+5 »).
  for (const m of phrase.matchAll(/(?<![\p{L}\p{N}_\/])(?:[A-Z][A-Za-z_-]+\/)+[A-Za-z0-9_+\-]+/gu)) {
    if (fuseauValide(m[0])) trouves.push({ nom: m[0], fuseau: m[0], sorte: 'fuseau', debut: m.index ?? 0, fin: (m.index ?? 0) + m[0].length });
  }
  for (const m of phrase.matchAll(/\b(?:UTC|GMT)(?:\s*([+\-−])\s*(\d{1,2})(?:[:h.]?(\d{2}))?)?(?![\p{L}\p{N}])/gu)) {
    const debut = m.index ?? 0, fin = debut + m[0].length;
    if (pris(debut, fin)) continue;
    if (!m[1]) { trouves.push({ nom: m[0], fuseau: 'UTC', sorte: 'fuseau', debut, fin }); continue; }
    const h = Number(m[2]), mi = Number(m[3] ?? 0);
    if (h > 14 || mi > 59) continue;
    const f = `${m[1] === '+' ? '+' : '-'}${deux(h)}:${deux(mi)}`;
    if (fuseauValide(f)) trouves.push({ nom: m[0], fuseau: f, sorte: 'fuseau', debut, fin });
  }
  const avant = new Set(Object.values(AVANT_LIEU).flat());
  // 2. Les villes et pays connus (le nom le plus long d'abord).
  for (let i = 0; i < js.length; i++) {
    if (pris(js[i].debut, js[i].fin)) continue;
    const formes = js[i].arabe ? sansPrefixeAr(js[i].n) : [js[i].n];
    let fait = false;
    for (const f of formes) {
      for (const c of idx.get(f) ?? []) {
        if (i + c.toks.length > js.length) continue;
        if (!c.toks.every((t, k) => k === 0 || js[i + k].n === t)) continue;
        // « the turkey », « les paris » : un nom qui est aussi un mot courant veut une majuscule ou un « à / in » devant.
        if (MAJUSCULE_REQUISE.has(c.toks.join(' ')) && !js[i].maj && !(i > 0 && avant.has(js[i - 1].n))) continue;
        // Le nom rendu laisse de côté le préfixe arabe collé (« بطوكيو » → « طوكيو »).
        const d0 = js[i].debut + (js[i].n.length - f.length), f0 = js[i + c.toks.length - 1].fin;
        trouves.push({ nom: phrase.slice(d0, f0), fuseau: c.e.fuseau, sorte: c.e.sorte, pays: c.e.pays, ...(c.e.plusieurs ? { plusieursFuseaux: true } : {}), debut: d0, fin: f0 });
        i += c.toks.length - 1; fait = true; break;
      }
      if (fait) break;
    }
  }
  trouves.sort((a, b) => a.debut - b.debut);
  // « Tokyo, au Japon » : le pays d'une ville déjà nommée n'est pas un second lieu.
  const villes = new Set(trouves.filter((t) => t.sorte === 'ville').map((t) => t.pays));
  const lieux = trouves.filter((t) => !(t.sorte === 'pays' && villes.has(t.pays)));
  // 3. Ce qui suit un mot comme « à », « in », « entre », « في » et qui n'est pas un lieu connu.
  const motsHeure = new Set(Object.values(MOTS_HEURE).flat());
  const transparent = (j: Jeton) => TRANSPARENTS.has(j.n) || (j.arabe && sansPrefixeAr(j.n).some((x) => TRANSPARENTS.has(x)));
  const inconnus: string[] = [];
  for (let i = 0; i + 1 < js.length; i++) {
    if (!avant.has(js[i].n)) continue;
    let k = i + 1;
    while (k + 1 < js.length && transparent(js[k])) k++;
    const s = js[k];
    if (pris(s.debut, s.fin) || motsHeure.has(s.n) || avant.has(s.n) || PAS_UN_LIEU.has(s.n) || transparent(s)) continue;
    if (s.arabe) { if (PAS_UN_LIEU_AR.has(s.n) || sansPrefixeAr(s.n).some((x) => motsHeure.has(x))) continue; }
    else {
      if (!s.maj) continue;
      while (k + 1 < js.length && js[k + 1].maj && !js[k + 1].arabe && !pris(js[k + 1].debut, js[k + 1].fin) && !motsHeure.has(js[k + 1].n) && !PAS_UN_LIEU.has(js[k + 1].n)) k++;
    }
    // « Central London », « Greater Tokyo » : un mot juste devant un lieu connu le précise, ce n'est pas un autre lieu.
    if (k + 1 < js.length && pris(js[k + 1].debut, js[k + 1].fin)) continue;
    const nom = phrase.slice(s.debut, js[k].fin);
    if (!inconnus.includes(nom)) inconnus.push(nom);
    i = k - 1;
  }
  return { lieux, inconnus };
}

// ---------------------------------------------------------------------------------------------------------------
// Les textes

type Textes = {
  ici: string; direct1: string; direct2: string;
  plus: string; moins: string; meme: string;
  plus2: string; moins2: string; meme2: string;
  periode: string; touteAnnee: string; changement: string; pasDeChangement: string;
  inconnu: string; plusieurs: string; deuxPremiers: string; calcul: string; heureEcrite: string;
  convertir: string; appel: string;
};
const TEXTES: Record<string, Textes> = {
  fr: {
    ici: 'ici',
    direct1: 'Il est {heure} là-bas ({lieu}, {date}), {ecart}.',
    direct2: 'Quand il est {heureA} ({A}, {dateA}), il est {heureB} ({B}, {dateB}) : {ecart}.',
    plus: "{duree} de plus qu'ici", moins: "{duree} de moins qu'ici", meme: "la même heure qu'ici",
    plus2: "{B} a {duree} d'avance", moins2: '{B} a {duree} de retard', meme2: 'la même heure',
    periode: 'Du {debut} au {fin} : {ecart}.', touteAnnee: "Toute l'année {annee} : {ecart}.",
    changement: "{lieu} : changement d'heure le {date}, {avant} → {apres} ({utcAvant} → {utcApres}).",
    pasDeChangement: "{lieu} : pas de changement d'heure en {annee} ({utc}).",
    inconnu: 'Je ne connais pas ce lieu : « {nom} ». Donne-moi la grande ville la plus proche ou son fuseau (par exemple Asia/Tokyo).',
    plusieurs: "{lieu} a plusieurs fuseaux : j'ai pris celui de la capitale ({fuseau}).",
    deuxPremiers: "Plus de deux lieux nommés : j'ai pris les deux premiers.",
    heureEcrite: "Une heure est écrite dans la question (« {h} ») : elle n'est pas encore convertie ; l'heure donnée est celle de maintenant, et l'écart celui d'aujourd'hui.",
    calcul: 'Calculé par Odin (base des fuseaux de la machine, version {v}).',
    convertir: 'Convertir une autre heure', appel: 'Planifier un appel',
  },
  en: {
    ici: 'here',
    direct1: 'It is {heure} there ({lieu}, {date}), {ecart}.',
    direct2: 'When it is {heureA} ({A}, {dateA}), it is {heureB} ({B}, {dateB}): {ecart}.',
    plus: '{duree} ahead of here', moins: '{duree} behind here', meme: 'the same time as here',
    plus2: '{B} is {duree} ahead', moins2: '{B} is {duree} behind', meme2: 'the same time',
    periode: 'From {debut} to {fin}: {ecart}.', touteAnnee: 'All of {annee}: {ecart}.',
    changement: '{lieu}: clocks change on {date}, {avant} → {apres} ({utcAvant} → {utcApres}).',
    pasDeChangement: '{lieu}: no clock change in {annee} ({utc}).',
    inconnu: 'I don’t know this place: “{nom}”. Give me the nearest large city or its time zone (for example Asia/Tokyo).',
    plusieurs: '{lieu} has several time zones: I used the capital’s ({fuseau}).',
    deuxPremiers: 'More than two places named: I used the first two.',
    heureEcrite: 'A time is written in the question (“{h}”): it is not converted yet; the time given is the current one, and the difference is today’s.',
    calcul: 'Calculated by Odin (this machine’s time zone database, version {v}).',
    convertir: 'Convert another time', appel: 'Schedule a call',
  },
  es: {
    ici: 'aquí',
    direct1: 'Hora allí: {heure} ({lieu}, {date}), {ecart}.',
    direct2: 'Cuando son las {heureA} ({A}, {dateA}), allí son las {heureB} ({B}, {dateB}): {ecart}.',
    plus: '{duree} más que aquí', moins: '{duree} menos que aquí', meme: 'la misma hora que aquí',
    plus2: '{B} va {duree} por delante', moins2: '{B} va {duree} por detrás', meme2: 'la misma hora',
    periode: 'Del {debut} al {fin}: {ecart}.', touteAnnee: 'Todo {annee}: {ecart}.',
    changement: '{lieu}: cambio de hora el {date}, {avant} → {apres} ({utcAvant} → {utcApres}).',
    pasDeChangement: '{lieu}: sin cambio de hora en {annee} ({utc}).',
    inconnu: 'No conozco este lugar: «{nom}». Dame la ciudad grande más cercana o su huso horario (por ejemplo Asia/Tokyo).',
    plusieurs: '{lieu} tiene varios husos horarios: tomé el de la capital ({fuseau}).',
    deuxPremiers: 'Hay más de dos lugares: tomé los dos primeros.',
    heureEcrite: 'La pregunta incluye una hora («{h}»): todavía no se convierte; la hora indicada es la actual y la diferencia es la de hoy.',
    calcul: 'Calculado por Odin (base de husos horarios de la máquina, versión {v}).',
    convertir: 'Convertir otra hora', appel: 'Programar una llamada',
  },
  de: {
    ici: 'hier',
    direct1: 'Dort ist es {heure} ({lieu}, {date}), {ecart}.',
    direct2: 'Wenn es {heureA} ist ({A}, {dateA}), ist es {heureB} ({B}, {dateB}): {ecart}.',
    plus: '{duree} später als hier', moins: '{duree} früher als hier', meme: 'dieselbe Uhrzeit wie hier',
    plus2: '{B} ist {duree} voraus', moins2: '{B} ist {duree} zurück', meme2: 'dieselbe Uhrzeit',
    periode: 'Vom {debut} bis {fin}: {ecart}.', touteAnnee: 'Das ganze Jahr {annee}: {ecart}.',
    changement: '{lieu}: Zeitumstellung am {date}, {avant} → {apres} ({utcAvant} → {utcApres}).',
    pasDeChangement: '{lieu}: keine Zeitumstellung im Jahr {annee} ({utc}).',
    inconnu: 'Diesen Ort kenne ich nicht: „{nom}“. Nenne mir die nächste große Stadt oder ihre Zeitzone (zum Beispiel Asia/Tokyo).',
    plusieurs: '{lieu} hat mehrere Zeitzonen: Ich habe die der Hauptstadt genommen ({fuseau}).',
    deuxPremiers: 'Mehr als zwei Orte genannt: Ich habe die ersten beiden genommen.',
    heureEcrite: 'In der Frage steht eine Uhrzeit („{h}“): Sie wird noch nicht umgerechnet; angegeben ist die aktuelle Uhrzeit und der heutige Unterschied.',
    calcul: 'Von Odin berechnet (Zeitzonendatenbank dieser Maschine, Version {v}).',
    convertir: 'Eine andere Uhrzeit umrechnen', appel: 'Einen Anruf planen',
  },
  ar: {
    ici: 'هنا',
    direct1: 'الساعة هناك {heure} ({lieu}، {date})، {ecart}.',
    direct2: 'عندما تكون الساعة {heureA} ({A}، {dateA})، تكون {heureB} ({B}، {dateB}): {ecart}.',
    plus: '{duree} أكثر من هنا', moins: '{duree} أقل من هنا', meme: 'نفس الوقت هنا',
    plus2: '{B} متقدمة بـ{duree}', moins2: '{B} متأخرة بـ{duree}', meme2: 'نفس الوقت',
    periode: 'من {debut} إلى {fin}: {ecart}.', touteAnnee: 'طوال عام {annee}: {ecart}.',
    changement: '{lieu}: تغيير الساعة في {date}، من {avant} إلى {apres} (من {utcAvant} إلى {utcApres}).',
    pasDeChangement: '{lieu}: لا تغيير للساعة في عام {annee} ({utc}).',
    inconnu: 'لا أعرف هذا المكان: «{nom}». أعطني أقرب مدينة كبيرة أو منطقتها الزمنية (مثلًا Asia/Tokyo).',
    plusieurs: 'في {lieu} أكثر من منطقة زمنية: أخذت منطقة العاصمة ({fuseau}).',
    deuxPremiers: 'ذُكر أكثر من مكانين: أخذت أول مكانين.',
    heureEcrite: 'في السؤال وقت مكتوب («{h}»): لم يُحوَّل بعد؛ الوقت المذكور هو الوقت الحالي، والفرق هو فرق اليوم.',
    calcul: 'حسبه Odin (قاعدة المناطق الزمنية في هذا الجهاز، الإصدار {v}).',
    convertir: 'تحويل وقت آخر', appel: 'جدولة مكالمة',
  },
  sw: {
    ici: 'hapa',
    direct1: 'Huko ni {heure} ({lieu}, {date}), {ecart}.',
    direct2: 'Ikiwa ni {heureA} ({A}, {dateA}), huko ni {heureB} ({B}, {dateB}): {ecart}.',
    plus: '{duree} mbele ya hapa', moins: '{duree} nyuma ya hapa', meme: 'sawa na hapa',
    plus2: '{B} iko mbele kwa {duree}', moins2: '{B} iko nyuma kwa {duree}', meme2: 'saa ni sawa',
    periode: 'Kuanzia {debut} hadi {fin}: {ecart}.', touteAnnee: 'Mwaka mzima wa {annee}: {ecart}.',
    changement: '{lieu}: saa hubadilishwa {date}, {avant} → {apres} ({utcAvant} → {utcApres}).',
    pasDeChangement: '{lieu}: hakuna mabadiliko ya saa mwaka {annee} ({utc}).',
    inconnu: 'Sijui mahali hapa: “{nom}”. Nipe jiji kubwa lililo karibu zaidi au saa za eneo lake (kwa mfano Asia/Tokyo).',
    plusieurs: '{lieu} ina saa za maeneo kadhaa: nimetumia ya mji mkuu ({fuseau}).',
    deuxPremiers: 'Zaidi ya mahali pawili: nimetumia pawili vya kwanza.',
    heureEcrite: 'Swali lina saa iliyoandikwa (“{h}”): bado haijabadilishwa; saa iliyotolewa ni ya sasa, na tofauti ni ya leo.',
    calcul: 'Imehesabiwa na Odin (hifadhidata ya saa za maeneo ya mashine hii, toleo {v}).',
    convertir: 'Badilisha saa nyingine', appel: 'Panga simu',
  },
};
/** Codes ISO 639-3 (ceux de la reconnaissance des langues) → codes des textes ci-dessus. */
const ISO3: Record<string, string> = { fra: 'fr', eng: 'en', spa: 'es', deu: 'de', ger: 'de', ara: 'ar', arb: 'ar', ary: 'ar', arz: 'ar', swa: 'sw', swh: 'sw' };
/** Les langues dont les textes sont écrits ici. */
export const languesTextes = (): string[] => Object.keys(TEXTES);

const remplir = (modele: string, v: Record<string, string>) => modele.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

function duree(minutes: number, langue: string): string {
  const a = Math.round(Math.abs(minutes)), h = Math.floor(a / 60), mi = a % 60;
  const DF = (Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format(d: object): string } }).DurationFormat;
  if (DF) { try { return new DF(langue, { style: 'long' }).format(mi ? (h ? { hours: h, minutes: mi } : { minutes: mi }) : { hours: h }); } catch { /* repli ci-dessous */ } }
  const nf = (n: number, u: string) => new Intl.NumberFormat(langue, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  return [h ? nf(h, 'hour') : '', mi ? nf(mi, 'minute') : ''].filter(Boolean).join(' ');
}
const heureTexte = (t: number, fuseau: string, langue: string) => new Intl.DateTimeFormat(langue, { timeZone: fuseau, hour: 'numeric', minute: '2-digit' }).format(t);
const dateTexte = (t: number, fuseau: string, langue: string) => new Intl.DateTimeFormat(langue, { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(t);
const jourMois = (t: number, fuseau: string, langue: string) => new Intl.DateTimeFormat(langue, { timeZone: fuseau, day: 'numeric', month: 'long' }).format(t);
/** « 02:00 » au mur, mis en forme dans la langue. */
const murTexte = (hhmm: string, langue: string) => { const [h, m] = hhmm.split(':').map(Number); return new Intl.DateTimeFormat(langue, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(Date.UTC(2000, 0, 1, h, m)); };

/** La date du jour, en plus du jour relatif (« demain ») quand il diffère de celui de référence. */
function dateAvecJour(t: number, fuseau: string, ref: string | undefined, langue: string): string {
  const d = dateTexte(t, fuseau, langue);
  if (!ref) return d;
  const ici = heureAilleurs(t, ref).date, la = heureAilleurs(t, fuseau).date;
  if (ici === la) return d;
  const ecartJours = Math.round((Date.parse(la + 'T00:00:00Z') - Date.parse(ici + 'T00:00:00Z')) / 86_400_000);
  try { return `${new Intl.RelativeTimeFormat(langue, { numeric: 'auto' }).format(ecartJours, 'day')}, ${d}`; } catch { return d; }
}

function choisirLangue(phrase: string, langue?: string): string {
  if (langue) {
    const l = langue.toLowerCase().split(/[-_]/)[0];
    const c = TEXTES[l] ? l : ISO3[l];
    return c && TEXTES[c] ? c : 'en'; // une langue sans textes ici : l'anglais
  }
  const js = jetons(phrase);
  let meilleure = '', n = 0;
  for (const [l, mots] of Object.entries(MOTS_HEURE)) {
    const s = new Set(mots);
    const k = js.filter((j) => s.has(j.n) || (j.arabe && sansPrefixeAr(j.n).some((x) => s.has(x)))).length;
    if (k > n) { n = k; meilleure = l; }
  }
  return meilleure || 'en';
}

/** Vrai si la phrase parle d'heure ou de fuseau, dans une des langues ci-dessus. */
export function parleDHeure(phrase: string): boolean {
  const tous = new Set(Object.values(MOTS_HEURE).flat());
  return jetons(phrase).some((j) => tous.has(j.n) || (j.arabe && sansPrefixeAr(j.n).some((x) => tous.has(x))));
}

export interface OptionsHeure {
  /** L'instant de la question (l'appelant le donne : la fonction ne lit pas l'horloge). */
  maintenant: Date;
  /** Le fuseau d'« ici » (le lieu d'Odin). Absent ou inconnu : la réponse donne l'heure là-bas et son décalage UTC. */
  fuseauIci?: string;
  /** La langue de la réponse (« fr », « en », ou un code ISO 639-3 comme « swh »). Absente : celle des mots de la question. */
  langue?: string;
  /** L'année des changements d'heure (sinon celle écrite dans la phrase, sinon celle de maintenant). */
  annee?: number;
}

/** Une heure écrite (« 9 h », « 21:15 », « 9am », « 21 Uhr », « a las 9 », « الساعة 9 », « saa 3 »), hors des lieux trouvés. */
const HEURE_ECRITE = /(?<![\p{L}\p{N}])(?:\p{Nd}{1,2}\s?[:h]\s?\p{Nd}{2}|\p{Nd}{1,2}\s?(?:a\.?m\.?|p\.?m\.?|o['’]?clock|uhr|heures?|h)|(?:a\s+las|las)\s+\p{Nd}{1,2}|(?:الساعة|saa)\s+\p{Nd}{1,2})(?![\p{L}\p{N}])/giu;
function heureEcriteDans(phrase: string, lieux: LieuTrouve[]): string | undefined {
  for (const m of phrase.matchAll(HEURE_ECRITE)) {
    const d = m.index ?? 0, f = d + m[0].length;
    if (!lieux.some((l) => d < l.fin && f > l.debut)) return m[0];
  }
  return undefined;
}
/** Une année DITE comme une année (« en 2027 », « in 2027 », « im Jahr 2027 », « عام 2027 », « mwaka 2027 ») : « at 1900 » n'en est pas une. */
const ANNEE_ECRITE = /(?:(?<![\p{L}\p{N}])(?:en|in|im|jahr|année|annee|year|año|ano|pour|for|para|für|mwaka(?:\s+wa)?)\s+|(?:عام|سنة|في)\s*)(\d{4})(?![\p{N}])/iu;

/**
 * La réponse à une question d'heure ou de fuseau, toute calculée. Rend `undefined` quand la phrase ne parle pas d'heure
 * ou ne nomme aucun lieu (ce n'est pas une question pour ce calcul). Un lieu inconnu : `reconnu` faux, et `direct` le dit.
 */
export function repondreHeure(phrase: string, o: OptionsHeure): ReponseHeure | undefined {
  if (typeof phrase !== 'string' || !phrase.trim() || phrase.length > 1000) return undefined;
  if (!o || !Number.isFinite(+o.maintenant)) return undefined; // un instant invalide : pas de réponse plutôt qu'une erreur
  if (!parleDHeure(phrase)) return undefined;
  const { lieux, inconnus } = trouverLieux(phrase);
  if (!lieux.length && !inconnus.length) return undefined;
  const langue = choisirLangue(phrase, o.langue), T = TEXTES[langue];
  const t = +o.maintenant;
  const ici = o.fuseauIci && fuseauValide(o.fuseauIci) ? o.fuseauIci : undefined;
  const ecrite = ANNEE_ECRITE.exec(phrase);
  const refAnnee = lieux[1]?.fuseau ?? lieux[0]?.fuseau ?? ici ?? 'UTC';
  let annee = o.annee ?? (ecrite ? Number(ecrite[1]) : Number(heureAilleurs(t, ici ?? refAnnee).date.slice(0, 4)));
  if (!Number.isInteger(annee) || annee < ANNEE_MIN || annee > ANNEE_MAX) annee = Number(heureAilleurs(t, ici ?? refAnnee).date.slice(0, 4));
  const base: Omit<ReponseHeure, 'direct' | 'reconnu'> = { langue, lieux, inconnus, points: [], pasSur: [], conseils: [], annee };
  if (inconnus.length) return { ...base, reconnu: false, direct: inconnus.map((nom) => remplir(T.inconnu, { nom })).join(' ') };

  // A (le point de départ) et B (le lieu demandé).
  const deuxLieux = lieux.length >= 2;
  const A = deuxLieux ? { nom: lieux[0].nom, fuseau: lieux[0].fuseau } : ici ? { nom: T.ici, fuseau: ici } : undefined;
  const lb = deuxLieux ? lieux[1] : lieux[0];
  const B = { nom: lb.nom, fuseau: lb.fuseau };
  const pasSur: string[] = [];
  for (const l of lieux.slice(0, 2)) if (l.plusieursFuseaux) pasSur.push(remplir(T.plusieurs, { lieu: l.nom, fuseau: l.fuseau }));
  if (lieux.length > 2) pasSur.push(T.deuxPremiers);
  const heureEcrite = heureEcriteDans(phrase, lieux);
  if (heureEcrite) pasSur.push(remplir(T.heureEcrite, { h: heureEcrite }));

  const hb = heureAilleurs(t, B.fuseau);
  let direct: string, ecartMinutes: number | undefined;
  if (A) {
    ecartMinutes = decalage(t, A.fuseau, B.fuseau);
    const d = duree(ecartMinutes, langue);
    if (deuxLieux) {
      const ecart = ecartMinutes > 0 ? remplir(T.plus2, { B: B.nom, duree: d }) : ecartMinutes < 0 ? remplir(T.moins2, { B: B.nom, duree: d }) : T.meme2;
      direct = remplir(T.direct2, { heureA: heureTexte(t, A.fuseau, langue), A: A.nom, dateA: dateTexte(t, A.fuseau, langue), heureB: heureTexte(t, B.fuseau, langue), B: B.nom, dateB: dateAvecJour(t, B.fuseau, A.fuseau, langue), ecart });
    } else {
      const ecart = ecartMinutes > 0 ? remplir(T.plus, { duree: d }) : ecartMinutes < 0 ? remplir(T.moins, { duree: d }) : T.meme;
      direct = remplir(T.direct1, { heure: heureTexte(t, B.fuseau, langue), lieu: B.nom, date: dateAvecJour(t, B.fuseau, A.fuseau, langue), ecart });
    }
  } else {
    direct = remplir(T.direct1, { heure: heureTexte(t, B.fuseau, langue), lieu: B.nom, date: dateTexte(t, B.fuseau, langue), ecart: texteUtc(hb.utcMinutes) });
  }

  // Les points : l'écart de chaque période de l'année, puis les changements d'heure de chaque lieu.
  const points: string[] = [];
  if (A) {
    const ps = periodesEcart(annee, A.fuseau, B.fuseau);
    const ecartTexte = (e: number) => {
      const d = duree(e, langue);
      if (deuxLieux) return e > 0 ? remplir(T.plus2, { B: B.nom, duree: d }) : e < 0 ? remplir(T.moins2, { B: B.nom, duree: d }) : T.meme2;
      return e > 0 ? remplir(T.plus, { duree: d }) : e < 0 ? remplir(T.moins, { duree: d }) : T.meme;
    };
    if (ps.length === 1) points.push(remplir(T.touteAnnee, { annee: String(annee), ecart: ecartTexte(ps[0].ecart) }));
    else for (const p of ps) points.push(remplir(T.periode, { debut: jourMois(+p.debut, A.fuseau, langue), fin: jourMois(+p.fin - 1000, A.fuseau, langue), ecart: ecartTexte(p.ecart) }));
  }
  for (const l of A ? [A, B] : [B]) {
    const cs = changementsHeure(annee, l.fuseau);
    if (!cs.length) { points.push(remplir(T.pasDeChangement, { lieu: l.nom, annee: String(annee), utc: texteUtc(decalageUtc(debutAnnee(annee, l.fuseau), l.fuseau)) })); continue; }
    for (const c of cs) points.push(remplir(T.changement, { lieu: l.nom, date: jourMois(+c.instant, l.fuseau, langue), avant: murTexte(c.murAvant, langue), apres: murTexte(c.murApres, langue), utcAvant: texteUtc(c.avant), utcApres: texteUtc(c.apres) }));
  }

  const v = (typeof process !== 'undefined' && process.versions?.tz) || '?';
  return {
    ...base, reconnu: true, direct, points, pasSur, ...(heureEcrite ? { heureEcrite } : {}),
    conseils: [{ id: 'convertir-heure', libelle: T.convertir }, { id: 'planifier-appel', libelle: T.appel }],
    calcul: { par: 'Intl', baseFuseaux: v, texte: remplir(T.calcul, { v }) },
    donnees: { instant: new Date(t).toISOString(), ...(A ? { a: { ...heureAilleurs(t, A.fuseau), nom: A.nom } } : {}), b: { ...hb, nom: B.nom }, ...(ecartMinutes !== undefined ? { ecartMinutes } : {}) },
  };
}
