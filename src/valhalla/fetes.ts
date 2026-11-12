// Les événements de l'année d'Odin (maquettes validées) : fêtes, dates religieuses, fêtes d'ailleurs et
// anniversaires. Chaque événement se coupe à part, un jour se met en pause, tout se coupe d'un coup, et pendant
// le mois de Ramadan les autres événements peuvent être coupés. Calcul pur, sans réseau : Pâques par le comput,
// les dates musulmanes par le calendrier Umm al-Qura (ajustables d'un jour si l'annonce officielle diffère).

export interface EventDef {
  id: string; name: string; group: 'famille' | 'fetes' | 'religieuses' | 'ailleurs';
  /** couleur d'Odin ce jour-là */
  color: string; eyes?: string;
  /** accessoire dessiné sur Odin */
  accessory?: 'bonnet' | 'oeuf' | 'coeur' | 'citrouille' | 'trefle' | 'cotillons' | 'lune' | 'gateau' | 'masque' | 'note';
  /** phrase d'Odin (une fois par jour) */
  says: string;
  /** actif sans réglage */
  on: boolean;
  /** les pouvoirs prennent cette matière ce jour-là (si le choix est « selon le thème ») */
  power?: string;
}

export const EVENTS: EventDef[] = [
  { id: 'anniversaire', name: 'Ton anniversaire', group: 'famille', color: '#ff6ad5', accessory: 'gateau', says: 'Joyeux anniversaire !', on: true, power: 'artifice' },
  { id: 'famille', name: 'Anniversaires de la famille', group: 'famille', color: '#ff9ac8', accessory: 'gateau', says: 'C\'est l\'anniversaire de {nom} aujourd\'hui !', on: true, power: 'artifice' },
  { id: 'nouvelan', name: 'Nouvel An', group: 'fetes', color: '#ffd36a', accessory: 'cotillons', says: 'Bonne année !', on: true, power: 'artifice' },
  { id: 'carnaval', name: 'Carnaval', group: 'fetes', color: '#ff9a2a', accessory: 'masque', says: 'C\'est carnaval !', on: false, power: 'artifice' },
  { id: 'paques', name: 'Pâques', group: 'fetes', color: '#7a4527', accessory: 'oeuf', says: 'Joyeuses Pâques !', on: true, power: 'petales' },
  { id: 'abolition', name: 'Abolition de l\'esclavage à Mayotte', group: 'fetes', color: '#34c77b', says: '27 avril : on se souvient.', on: true },
  { id: 'travail', name: 'Fête du travail', group: 'fetes', color: '#2a2f3a', eyes: '#ffffff', says: 'Pas de travail aujourd\'hui : repose-toi.', on: true },
  { id: 'musique', name: 'Fête de la musique', group: 'fetes', color: '#5a6fdb', accessory: 'note', says: 'Fête de la musique !', on: true, power: 'onde' },
  { id: 'nationale', name: 'Fête nationale', group: 'fetes', color: '#3d6fe0', accessory: 'cotillons', says: 'Bon 14 juillet !', on: true, power: 'artifice' },
  { id: 'noel', name: 'Noël', group: 'fetes', color: '#2f8f4e', accessory: 'bonnet', says: 'Joyeux Noël !', on: true, power: 'blizzard' },
  { id: 'ramadan', name: 'Ramadan', group: 'religieuses', color: '#f2f2f2', eyes: '#2a2f3a', accessory: 'lune', says: 'Ramadan moubarak.', on: true, power: 'lumiere' },
  { id: 'aidfitr', name: 'Aïd el-Fitr', group: 'religieuses', color: '#34c77b', accessory: 'lune', says: 'Aïd moubarak !', on: true, power: 'lumiere' },
  { id: 'aidkebir', name: 'Aïd el-Kébir', group: 'religieuses', color: '#0fa3a0', accessory: 'lune', says: 'Aïd moubarak !', on: true, power: 'lumiere' },
  { id: 'valentin', name: 'Saint-Valentin', group: 'ailleurs', color: '#ef4f43', accessory: 'coeur', says: 'Bonne Saint-Valentin !', on: false, power: 'petales' },
  { id: 'patrick', name: 'Saint-Patrick', group: 'ailleurs', color: '#34c77b', accessory: 'trefle', says: 'Happy St Patrick\'s Day!', on: false, power: 'feuilles' },
  { id: 'halloween', name: 'Halloween', group: 'ailleurs', color: '#ff7a1a', accessory: 'citrouille', says: 'Bouh ! Joyeux Halloween !', on: false, power: 'ombre' },
  { id: 'thanksgiving', name: 'Thanksgiving', group: 'ailleurs', color: '#b08a5a', says: 'Happy Thanksgiving!', on: false, power: 'feuilles' },
];
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

export interface EventsCfg {
  /** tous les événements (interrupteur général) */
  actif?: boolean;
  /** le jour d'un événement, tout Odin prend le thème de l'événement */
  themes?: boolean;
  /** réglage par événement (sinon : valeur par défaut `on`) */
  choix?: Record<string, boolean>;
  /** jours en pause (AAAA-MM-JJ) */
  pauses?: string[];
  /** pendant le Ramadan, les autres événements sont coupés */
  ramadanSeul?: boolean;
  /** pendant le Ramadan, pas de pouvoirs */
  ramadanSansPouvoirs?: boolean;
  /** décalage (en jours, −2 à +2) des dates musulmanes, si l'annonce officielle diffère */
  decalageHijri?: number;
  /** ton anniversaire (MM-JJ) */
  anniversaire?: string;
  /** anniversaires de la famille */
  famille?: Array<{ nom: string; date: string }>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** AAAA-MM-JJ d'une date dans le fuseau donné. */
export function ymd(d: Date, tz = 'Indian/Mayotte'): string {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return d.toISOString().slice(0, 10); }
}
/** Dimanche de Pâques (comput grégorien, algorithme de Meeus). */
export function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Jour et mois du calendrier musulman (Umm al-Qura) pour une date AAAA-MM-JJ. */
export function hijri(iso: string, shift = 0): { day: number; month: number; year: number } {
  const d = new Date(`${addDays(iso, -shift)}T12:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: Number(p.day), month: Number(p.month), year: Number(String(p.year).replace(/\D/g, '')) };
}
/** 4e jeudi de novembre. */
const thanksgiving = (y: number) => { const first = new Date(Date.UTC(y, 10, 1)).getUTCDay(); return `${y}-11-${pad(1 + ((4 - first + 7) % 7) + 21)}`; };

export interface TodayEvent { id: string; name: string; color: string; eyes?: string; accessory?: string; says: string; power?: string; date: string }

/** Les événements qui tombent ce jour-là (sans tenir compte des réglages), le plus important d'abord. */
export function eventsOn(iso: string, cfg: EventsCfg = {}): TodayEvent[] {
  const y = Number(iso.slice(0, 4)), md = iso.slice(5), out: TodayEvent[] = [];
  const add = (id: string, extra: Partial<TodayEvent> = {}) => { const e = EVENT_BY_ID[id]; out.push({ id, name: e.name, color: e.color, eyes: e.eyes, accessory: e.accessory, says: e.says, power: e.power, date: iso, ...extra }); };
  if (cfg.anniversaire && cfg.anniversaire === md) add('anniversaire');
  for (const f of cfg.famille ?? []) if (f.date === md && f.nom) add('famille', { name: `Anniversaire de ${f.nom}`, says: EVENT_BY_ID.famille.says.replace('{nom}', f.nom) });
  const h = hijri(iso, cfg.decalageHijri ?? 0);
  if (h.month === 10 && h.day === 1) add('aidfitr');
  if (h.month === 12 && h.day === 10) add('aidkebir');
  if (md === '12-24' || md === '12-25') add('noel');
  if (md === '01-01') add('nouvelan');
  const e = easter(y); if (iso === e || iso === addDays(e, 1)) add('paques');
  if (iso === addDays(e, -47)) add('carnaval');
  if (md === '04-27') add('abolition');
  if (md === '05-01') add('travail');
  if (md === '06-21') add('musique');
  if (md === '07-14') add('nationale');
  if (md === '02-14') add('valentin');
  if (md === '03-17') add('patrick');
  if (md === '10-31') add('halloween');
  if (iso === thanksgiving(y)) add('thanksgiving');
  if (h.month === 9) add('ramadan', { says: h.day === 1 ? 'Ramadan moubarak.' : `Ramadan, jour ${h.day}.` });
  return out;
}
const enabled = (id: string, cfg: EventsCfg) => cfg.choix?.[id] ?? EVENT_BY_ID[id]?.on ?? false;
/** Le mois de Ramadan est-il en cours ? */
export const inRamadan = (iso: string, cfg: EventsCfg = {}) => hijri(iso, cfg.decalageHijri ?? 0).month === 9;

/** L'événement à montrer aujourd'hui, selon tes réglages (ou rien). */
export function todayEvent(iso: string, cfg: EventsCfg = {}): TodayEvent | undefined {
  if (cfg.actif === false || (cfg.pauses ?? []).includes(iso)) return undefined;
  let list = eventsOn(iso, cfg).filter((e) => enabled(e.id, cfg));
  // Pendant le Ramadan (s'il est actif) : les autres événements sont coupés, sauf réglage contraire.
  if (cfg.ramadanSeul !== false && inRamadan(iso, cfg) && enabled('ramadan', cfg)) list = list.filter((e) => e.id === 'ramadan');
  return list[0];
}

/** Les prochains événements (pour les réglages) : date, nom, actif ou non. */
export function upcoming(fromIso: string, days: number, cfg: EventsCfg = {}): Array<TodayEvent & { on: boolean; paused: boolean }> {
  const out: Array<TodayEvent & { on: boolean; paused: boolean }> = [], seen = new Set<string>();
  for (let i = 0; i < days; i++) {
    const iso = addDays(fromIso, i);
    for (const e of eventsOn(iso, cfg)) {
      const key = e.id === 'ramadan' ? `ramadan-${hijri(iso, cfg.decalageHijri ?? 0).year}` : `${e.id}-${iso}`;
      if (e.id === 'noel' && iso.endsWith('12-25')) continue;
      if (e.id === 'paques' && !iso.endsWith(easter(Number(iso.slice(0, 4))).slice(4))) continue;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ ...e, on: enabled(e.id, cfg) && cfg.actif !== false, paused: (cfg.pauses ?? []).includes(iso) });
    }
  }
  return out;
}
