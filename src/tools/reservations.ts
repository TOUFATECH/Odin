// Réservations lues dans un courriel : vol, train, bus, hôtel, location, spectacle, rendez-vous. Pur : aucun réseau,
// aucun fichier, aucune action. Rien ici ne réserve, n'annule, n'envoie ni ne suit un lien : une réservation lue est
// une DONNÉE venue de dehors (origine « lu dehors »), jamais un ordre, quoi que dise le courriel.
// D'abord le balisage schema.org du HTML (blocs JSON-LD : FlightReservation, TrainReservation, BusReservation,
// LodgingReservation, RentalCarReservation, EventReservation, FoodEstablishmentReservation) ; sinon des règles sur le
// texte (étiquettes en français, anglais, allemand, espagnol). Ce qui n'est pas sûr est « à vérifier », avec sa raison :
// une date ambiguë ou impossible reste vide, aucun fuseau n'est supposé, aucune devise n'est inventée.
// Tout est borné (taille du HTML, du texte, des lignes, des blocs) : un courriel énorme ou piégé ne bloque rien.

import { scanForInjection } from '../heimdall/injection.ts';

export type TypeReservation = 'vol' | 'train' | 'bus' | 'hôtel' | 'location' | 'spectacle' | 'rendez-vous';
export interface PieceJointe { nom: string; type: string; taille: number }
/** Une date telle qu'écrite (texte), et ce qui en est sûr : jour (AAAA-MM-JJ), heure (HH:MM), fuseau s'il est écrit. */
export interface DateReservation { texte: string; jour?: string; heure?: string; fuseau?: string }
export interface Reservation {
  type: TypeReservation;
  qui?: string;
  depart?: string;
  arrivee?: string;
  lieu?: string;
  debut?: DateReservation;
  fin?: DateReservation;
  numero?: string;
  fournisseur?: string;
  prix?: { montant: number; devise?: string };
  etat?: 'confirmée' | 'annulée' | 'en attente';
  /** Texte seulement : jamais ouvert ni suivi. */
  lienGestion?: string;
  piecesJointes: PieceJointe[];
  /** L'identifiant du courriel d'où elle vient. */
  source: string;
  origine: 'lu dehors';
  lecture: 'balisage' | 'texte';
  statut: 'lu' | 'à vérifier';
  raisons: string[];
}
/** Ce qu'il faut d'un courriel déjà décodé (voir lireCourriel dans mail.ts). */
export interface CourrielLu {
  id: string;
  from: string;
  subject: string;
  /** Le texte visible. */
  text: string;
  html?: string;
  htmlTronque?: boolean;
  pieces: PieceJointe[];
  /** L'expéditeur est-il authentifié par le serveur qui a reçu le message (DMARC ou DKIM) ? */
  authentifie?: boolean;
}

const MAX_HTML = 1_000_000, MAX_TEXTE = 100_000, MAX_LIGNE = 300, MAX_BLOC = 200_000, MAX_BLOCS = 20, MAX_RES = 20, MAX_LIENS = 2_000;

// Caractères de contrôle, invisibles et de sens d'écriture : retirés de tout champ gardé.
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/g;
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const forme = (s: string) => sansAccents(s.toLowerCase()).replace(/[’]/g, '\'').replace(/\s+/g, ' ').trim();

/** Un champ propre ; trop long → absent (plutôt que coupé). */
function net(v: string, max = 120): string | undefined {
  const t = v.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : undefined;
}
function nomValide(v: string | undefined): string | undefined {
  const t = v === undefined ? undefined : net(v, 80);
  if (!t || !/^\p{L}[\p{L}\p{M} '’.\-/]*$/u.test(t) || t.split(' ').length > 8) return undefined;
  return t;
}
function lieuValide(v: string | undefined): string | undefined {
  const t = v === undefined ? undefined : net(v, 120);
  if (!t || /@|https?:|www\./i.test(t) || !/\p{L}/u.test(t)) return undefined;
  return t;
}
function numeroValide(v: string | undefined): string | undefined {
  const t = v === undefined ? undefined : net(v, 40);
  return t && /^[\p{L}\p{N}][\p{L}\p{N}\-/ .]{1,39}$/u.test(t) ? t : undefined;
}

// ---------------- Dates ----------------

const MOIS: Record<string, number> = {};
for (const [n, mots] of [
  [1, 'janvier janv jan january januar janner jann enero ene'], [2, 'fevrier fevr fev february feb februar febrero'],
  [3, 'mars mar march marz maerz marzo'], [4, 'avril avr april apr abril abr'], [5, 'mai may mayo'],
  [6, 'juin june jun juni junio'], [7, 'juillet juil july jul juli julio'], [8, 'aout august aug agosto ago'],
  [9, 'septembre sept sep september septiembre setiembre'], [10, 'octobre oct october oktober okt octubre'],
  [11, 'novembre nov november noviembre'], [12, 'decembre dec december dezember dez diciembre dic'],
] as Array<[number, string]>) for (const m of mots.split(' ')) MOIS[m] = n;
const moisDe = (mot: string): number | undefined => MOIS[forme(mot).replace(/\.$/, '')];
const d2 = (n: number) => String(n).padStart(2, '0');
const jourValide = (a: number, m: number, j: number) => a >= 1990 && a <= 2200 && m >= 1 && m <= 12 && j >= 1 && j <= new Date(Date.UTC(a, m, 0)).getUTCDate();

const RE_ISO = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})?)?(?!\d)/g;
const RE_JOUR_MOIS = /(?<![\p{L}\d])(\d{1,2})(?:er|\.|º|°)?\s*(?:de\s+)?(\p{L}{3,10})\.?,?\s*(?:de\s+)?(\d{4})(?!\d)/gu;
const RE_MOIS_JOUR = /(?<!\p{L})(\p{L}{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/gu;
const RE_NUM = /(?<![\d./])(\d{1,2})([./])(\d{1,2})\2(\d{4})(?!\d)/g;
const RE_HEURE = /^\s*(?:,|à|a las|a la|um|at|-|–|\/)?\s*(\d{1,2})(?:\s*(?::|h|\.)\s*(\d{2})|\s*(h)(?![\p{L}\d]))?\s*((?:a|p)\.?\s?m\.?)?(?![\p{L}\d]|[./]\d)/iu;
const RE_FUSEAU = /^\s*(?:(Z|UTC|GMT)\s*([+-]\d{1,2}(?::?\d{2})?)?|([+-]\d{2}:?\d{2}))(?![\p{L}\d])/u;

function fuseauDe(z: string | undefined, decal: string | undefined): string | undefined {
  const brut = decal ?? (z ? '+00:00' : undefined);
  if (!brut) return undefined;
  const m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(brut);
  if (!m || Number(m[2]) > 14 || Number(m[3] ?? 0) > 59) return undefined;
  return `${m[1]}${d2(Number(m[2]))}:${m[3] ?? '00'}`;
}

interface Trouvee { index: number; fin: number; a: number; m: number; j: number; doute?: string; iso?: RegExpExecArray }

/**
 * La première date d'un texte court : ISO (2026-12-12T18:40+01:00), « 12 déc. 2026 18:40 », « Dec 12, 2026 6:40 PM »,
 * « 12. Dezember 2026 18:40 Uhr », « 12 de diciembre de 2026, 18:40 », 12.12.2026, 13/04/2027. Une date ambiguë
 * (03/04/2027 : jour ou mois ?) ou impossible n'est pas rendue : seul le doute l'est. undefined : aucune date.
 */
export function lireDateTexte(s0: string): { date?: DateReservation; doute?: string; index: number } | undefined {
  const s = s0.slice(0, MAX_LIGNE);
  const cands: Trouvee[] = [];
  const premiere = (re: RegExp, f: (m: RegExpExecArray) => Trouvee | undefined) => {
    re.lastIndex = 0;
    for (let m = re.exec(s), n = 0; m && n < 20; m = re.exec(s), n++) { const t = f(m); if (t) { cands.push(t); return; } if (m[0] === '') re.lastIndex++; }
  };
  premiere(RE_ISO, (m) => ({ index: m.index, fin: m.index + m[0].length, a: +m[1], m: +m[2], j: +m[3], iso: m }));
  premiere(RE_JOUR_MOIS, (m) => { const mo = moisDe(m[2]); return mo ? { index: m.index, fin: m.index + m[0].length, a: +m[3], m: mo, j: +m[1] } : undefined; });
  premiere(RE_MOIS_JOUR, (m) => { const mo = moisDe(m[1]); return mo ? { index: m.index, fin: m.index + m[0].length, a: +m[3], m: mo, j: +m[2] } : undefined; });
  premiere(RE_NUM, (m) => {
    const x = +m[1], y = +m[3], a = +m[4], t = { index: m.index, fin: m.index + m[0].length, a };
    if (m[2] === '.' || (x > 12 && y <= 12) || x === y) return { ...t, j: x, m: y };
    if (y > 12 && x <= 12) return { ...t, j: y, m: x };
    if (x <= 12 && y <= 12) return { ...t, j: 0, m: 0, doute: `date ambiguë (jour et mois) : « ${m[0]} »` };
    return { ...t, j: x, m: y };
  });
  if (!cands.length) return undefined;
  const c = cands.sort((p, q) => p.index - q.index)[0];
  if (c.doute) return { doute: c.doute, index: c.index };
  if (!jourValide(c.a, c.m, c.j)) return { doute: `date impossible : « ${s.slice(c.index, c.fin)} »`, index: c.index };
  const date: DateReservation = { texte: '', jour: `${c.a}-${d2(c.m)}-${d2(c.j)}` };
  let fin = c.fin, doute: string | undefined;
  let h: number | undefined, mi: number | undefined, fuseau: string | undefined;
  if (c.iso) {
    if (c.iso[4] !== undefined) { h = +c.iso[4]; mi = +c.iso[5]; }
    fuseau = fuseauDe(c.iso[6] === 'Z' ? 'Z' : undefined, c.iso[6] && c.iso[6] !== 'Z' ? c.iso[6] : undefined);
    if (h !== undefined && (h > 23 || (mi ?? 0) > 59)) return { doute: `date impossible : « ${c.iso[0]} »`, index: c.index };
  } else {
    const t = RE_HEURE.exec(s.slice(fin, fin + 40));
    if (t && (t[2] !== undefined || t[3] || t[4])) {
      let hh = +t[1]; const mm = t[2] !== undefined ? +t[2] : 0;
      const ampm = t[4] ? forme(t[4]).replace(/[.\s]/g, '') : '';
      if (ampm) hh = hh >= 1 && hh <= 12 ? (hh % 12) + (ampm === 'pm' ? 12 : 0) : 99;
      if (hh > 23 || mm > 59) doute = `heure impossible : « ${t[0].trim()} »`;
      else { h = hh; mi = mm; fin += t[0].length; }
      if (h !== undefined) {
        const z = RE_FUSEAU.exec(s.slice(fin, fin + 20));
        if (z) { fuseau = fuseauDe(z[1], z[2] ?? z[3]); fin += z[0].length; }
      }
    }
  }
  date.texte = s.slice(c.index, fin).trim();
  if (h !== undefined) date.heure = `${d2(h)}:${d2(mi ?? 0)}`;
  if (fuseau) date.fuseau = fuseau;
  return doute ? { date, doute, index: c.index } : { date, index: c.index };
}

// ---------------- Prix et liens ----------------

const DEVISES: Record<string, string> = { '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '£': 'GBP', gbp: 'GBP', usd: 'USD', chf: 'CHF', $: '$' };
const NOMBRE = '(\\d[\\d .,\'\\u00a0\\u202f]{0,15}\\d|\\d)';
const RE_PRIX_APRES = new RegExp(`${NOMBRE}\\s?(€|\\$|£|chf|eur|usd|gbp|euros?)(?![\\p{L}])`, 'iu');
const RE_PRIX_AVANT = new RegExp(`(€|\\$|£|chf|eur|usd|gbp)\\s?${NOMBRE}`, 'iu');
function montantDe(tok: string): number | undefined {
  const s = tok.replace(/[ '  ]/g, '');
  const dec = /[.,](\d{1,2})$/.exec(s);
  const ent = (dec ? s.slice(0, dec.index) : s).replace(/[.,]/g, '');
  if (!/^\d{1,9}$/.test(ent)) return undefined;
  return Number(dec ? `${ent}.${dec[1]}` : ent);
}
function prixDuTexte(v: string): Reservation['prix'] {
  const s = v.slice(0, MAX_LIGNE);
  const a = RE_PRIX_APRES.exec(s), b = RE_PRIX_AVANT.exec(s);
  const m = a && (!b || a.index <= b.index) ? { n: a[1], d: a[2] } : b ? { n: b[2], d: b[1] } : undefined;
  if (m) { const montant = montantDe(m.n); return montant === undefined ? undefined : { montant, devise: DEVISES[m.d.toLowerCase()] ?? m.d.toUpperCase() }; }
  const seul = new RegExp(NOMBRE).exec(s);
  const montant = seul ? montantDe(seul[1]) : undefined;
  return montant === undefined ? undefined : { montant };
}

const domaineDe = (hote: string) => hote.toLowerCase().replace(/\.$/, '').split('.').slice(-2).join('.');
/** Un lien de gestion, gardé comme TEXTE (jamais suivi) ; écarté s'il n'est pas une adresse web sûre à montrer. */
function lienValide(brut: string | undefined, from: string, raisons: string[]): string | undefined {
  const t = brut === undefined ? undefined : net(brut, 500);
  if (!t) return undefined;
  let u: URL;
  try { u = new URL(t); } catch { raisons.push('lien de gestion écarté : adresse illisible'); return undefined; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { raisons.push('lien de gestion écarté : pas une adresse web'); return undefined; }
  if (u.username || u.password) { raisons.push('lien de gestion écarté : il contient un identifiant'); return undefined; }
  const hote = u.hostname;
  if (/^[\d.]+$/.test(hote) || hote.includes(':') || hote.startsWith('[')) { raisons.push('lien de gestion écarté : une adresse IP au lieu d\'un nom'); return undefined; }
  if (/(^|\.)xn--/i.test(hote)) { raisons.push('lien de gestion écarté : nom de domaine déguisé'); return undefined; }
  if (u.protocol === 'http:') raisons.push('lien de gestion non chiffré (http)');
  const dom = (/@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? '');
  if (!dom || domaineDe(hote) !== domaineDe(dom)) raisons.push('le lien de gestion mène ailleurs que chez l\'expéditeur');
  return t;
}

// ---------------- Balisage schema.org (JSON-LD) ----------------

type J = Record<string, unknown>;
const estObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const premier = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
/** Le texte d'une valeur : chaîne, nombre, ou le « name » d'un objet (trois niveaux au plus). */
function texteDe(v: unknown, max = 120): string | undefined {
  let x = premier(v);
  for (let i = 0; i < 3 && estObj(x); i++) x = premier(x.name);
  return typeof x === 'string' || typeof x === 'number' ? net(String(x), max) : undefined;
}
function adresseDe(v: unknown): string | undefined {
  const a = premier(v);
  if (!estObj(a)) return texteDe(a);
  const ville = [texteDe(a.postalCode, 20), texteDe(a.addressLocality)].filter(Boolean).join(' ');
  return net([texteDe(a.streetAddress), ville, texteDe(a.addressCountry, 60)].filter(Boolean).join(', '), 200);
}
function lieuDe(v: unknown): string | undefined {
  const o = premier(v);
  if (!estObj(o)) return lieuValide(texteDe(o));
  const nom = texteDe(o.name), code = texteDe(o.iataCode, 8);
  const tete = nom && code ? `${nom} (${code})` : nom ?? code;
  return lieuValide([tete, adresseDe(o.address)].filter(Boolean).join(', '));
}
const TYPES: Record<string, TypeReservation> = {
  FlightReservation: 'vol', TrainReservation: 'train', BusReservation: 'bus', LodgingReservation: 'hôtel',
  RentalCarReservation: 'location', EventReservation: 'spectacle', FoodEstablishmentReservation: 'rendez-vous',
};
const nomType = (v: unknown) => (typeof v === 'string' ? v.split(/[/:#]/).pop() ?? '' : '');
function typeDe(o: J): TypeReservation | undefined {
  for (const t of Array.isArray(o['@type']) ? o['@type'] : [o['@type']]) { const r = TYPES[nomType(t)]; if (r) return r; }
  return undefined;
}

/** Les blocs <script type="application/ld+json"> d'un HTML, en un seul passage. */
function blocsLd(html: string): string[] {
  const bas = html.toLowerCase(), out: string[] = [];
  let pos = 0;
  while (out.length < MAX_BLOCS) {
    const i = bas.indexOf('<script', pos);
    if (i < 0) break;
    const gt = bas.indexOf('>', i);
    if (gt < 0) break;
    if (gt - i > 500 || !bas.slice(i, gt).includes('application/ld+json')) { pos = gt + 1; continue; }
    const fin = bas.indexOf('</script', gt);
    if (fin < 0) break;
    if (fin - gt <= MAX_BLOC) out.push(html.slice(gt + 1, fin));
    pos = fin + 8;
  }
  return out;
}
function collecter(v: unknown, out: J[], prof = 0): void {
  if (prof > 6 || out.length >= MAX_RES * 2) return;
  if (Array.isArray(v)) { for (const x of v.slice(0, 100)) collecter(x, out, prof + 1); return; }
  if (!estObj(v)) return;
  if (typeDe(v)) out.push(v);
  if (v['@graph'] !== undefined) collecter(v['@graph'], out, prof + 1);
  if (v.subReservation !== undefined) collecter(v.subReservation, out, prof + 1);
}

type Corps = Omit<Reservation, 'piecesJointes' | 'source' | 'origine' | 'lecture' | 'statut' | 'raisons'>;
interface Lu { r: Corps; raisons: string[]; lienBrut?: string }

function depuisBalisage(o: J): Lu {
  const type = typeDe(o)!, f = premier(o.reservationFor), rf: J = estObj(f) ? f : {};
  const raisons: string[] = [];
  const date = (v: unknown, quoi: string): DateReservation | undefined => {
    const s = texteDe(v, 80);
    if (!s) return undefined;
    const l = lireDateTexte(s);
    if (l?.doute) raisons.push(`${quoi} : ${l.doute}`);
    if (!l) raisons.push(`${quoi} : date illisible (« ${s} »)`);
    if (!l?.date) return undefined;
    // La valeur entière doit être lue : ce qui reste (une seconde date, un fuseau en lettres…) rend la date douteuse.
    const i = s.indexOf(l.date.texte, l.index);
    const reste = i < 0 ? s : `${s.slice(0, i)} ${s.slice(i + l.date.texte.length)}`;
    if (!/[\p{L}\p{N}]/u.test(reste)) return l.date;
    raisons.push(`${quoi} : partie de la date non lue (« ${net(reste, 80) ?? '…'} »)`);
    return { ...l.date, texte: s };
  };
  const r: Corps = { type };
  const pose = <K extends keyof typeof r>(k: K, v: (typeof r)[K] | undefined) => { if (v !== undefined) r[k] = v; };
  pose('qui', nomValide(texteDe(o.underName)));
  if (type === 'vol' || type === 'train' || type === 'bus') {
    pose('depart', lieuDe(rf.departureAirport ?? rf.departureStation ?? rf.departureBusStop));
    pose('arrivee', lieuDe(rf.arrivalAirport ?? rf.arrivalStation ?? rf.arrivalBusStop));
    pose('debut', date(rf.departureTime, 'départ'));
    pose('fin', date(rf.arrivalTime, 'arrivée'));
    pose('fournisseur', texteDe(rf.airline) ?? texteDe(rf.provider) ?? texteDe(rf.busCompany) ?? texteDe(o.provider));
  } else if (type === 'hôtel') {
    pose('lieu', lieuDe(rf));
    pose('fournisseur', texteDe(rf.name));
    pose('debut', date(o.checkinTime ?? o.checkinDate, 'arrivée'));
    pose('fin', date(o.checkoutTime ?? o.checkoutDate, 'départ'));
  } else if (type === 'location') {
    pose('depart', lieuDe(o.pickupLocation));
    pose('arrivee', lieuDe(o.dropoffLocation));
    pose('debut', date(o.pickupTime, 'prise'));
    pose('fin', date(o.dropoffTime, 'retour'));
    pose('fournisseur', texteDe(o.provider) ?? texteDe(rf.rentalCompany) ?? texteDe(rf.brand));
  } else if (type === 'spectacle') {
    pose('lieu', lieuDe(rf.location));
    pose('debut', date(rf.startDate, 'début'));
    pose('fin', date(rf.endDate, 'fin'));
    pose('fournisseur', texteDe(o.provider) ?? texteDe(rf.organizer));
  } else {
    pose('lieu', lieuDe(rf));
    pose('fournisseur', texteDe(rf.name));
    pose('debut', date(o.startTime ?? o.startDate, 'heure'));
  }
  pose('numero', numeroValide(texteDe(o.reservationNumber ?? o.reservationId, 40)));
  const p = premier(o.totalPrice ?? o.price), devise = texteDe(o.priceCurrency ?? (estObj(p) ? p.priceCurrency : undefined), 3);
  const montant = typeof p === 'number' ? p : typeof p === 'string' ? montantDe(p.trim()) : estObj(p) ? (typeof p.price === 'number' ? p.price : typeof p.price === 'string' ? montantDe(p.price.trim()) : undefined) : undefined;
  if (montant !== undefined && Number.isFinite(montant) && montant >= 0) r.prix = devise && /^[A-Z]{3}$/.test(devise) ? { montant, devise } : { montant };
  const etat = nomType(premier(o.reservationStatus));
  pose('etat', etat === 'ReservationConfirmed' ? 'confirmée' : etat === 'ReservationCancelled' ? 'annulée' : etat === 'ReservationPending' || etat === 'ReservationHold' ? 'en attente' : undefined);
  const action = premier(o.potentialAction);
  const lienBrut = [o.modifyReservationUrl, o.url, estObj(action) ? (estObj(premier(action.target)) ? (premier(action.target) as J).urlTemplate : action.target) : undefined]
    .map((x) => premier(x)).find((x): x is string => typeof x === 'string');
  if (!r.debut && !raisons.length) raisons.push('aucune date lue');
  return { r, raisons, lienBrut };
}

// ---------------- Règles sur le texte ----------------

const liste = (...mots: string[]) => new Set(mots);
const ETIQ = {
  numero: liste('reference', 'reference de reservation', 'reference de la reservation', 'reference du dossier', 'reference dossier', 'numero de reservation',
    'n° de reservation', 'no de reservation', 'n° reservation', 'numero de dossier', 'numero de confirmation', 'code de reservation', 'code reservation',
    'booking reference', 'booking ref', 'booking ref.', 'booking number', 'booking code', 'booking id', 'confirmation number', 'confirmation code',
    'confirmation no', 'confirmation no.', 'reservation number', 'reservation code', 'reservation no', 'pnr', 'record locator', 'buchungsnummer',
    'buchungscode', 'buchungsreferenz', 'reservierungsnummer', 'reservierungscode', 'bestatigungsnummer', 'numero de reserva', 'numero de confirmacion',
    'codigo de reserva', 'codigo de confirmacion', 'localizador', 'referencia', 'referencia de reserva', 'referencia de la reserva'),
  qui: liste('passager', 'passagere', 'voyageur', 'voyageuse', 'nom du passager', 'nom du voyageur', 'titulaire', 'client', 'cliente', 'nom', 'au nom de',
    'passenger', 'passenger name', 'traveller', 'traveler', 'guest', 'guest name', 'lead guest', 'name', 'reisender', 'reisende', 'fahrgast', 'gast',
    'pasajero', 'pasajera', 'viajero', 'viajera', 'titular', 'huesped', 'nombre', 'a nombre de'),
  depart: liste('depart', 'lieu de depart', 'gare de depart', 'aeroport de depart', 'departure', 'departing', 'from', 'abfahrt', 'abflug', 'abfahrtsort',
    'von', 'salida', 'origen'),
  arrivee: liste('arrivee', 'lieu d\'arrivee', 'gare d\'arrivee', 'aeroport d\'arrivee', 'destination', 'arrival', 'arriving', 'to', 'ankunft',
    'ankunftsort', 'ziel', 'nach', 'llegada', 'destino'),
  entree: liste('arrivee', 'date d\'arrivee', 'check-in', 'check in', 'arrival', 'arrival date', 'anreise', 'anreisedatum', 'ankunft', 'entrada',
    'fecha de entrada', 'llegada', 'fecha de llegada'),
  sortie: liste('depart', 'date de depart', 'check-out', 'check out', 'departure', 'departure date', 'abreise', 'abreisedatum', 'salida', 'fecha de salida'),
  date: liste('date', 'le', 'quand', 'date et heure', 'date du rendez-vous', 'horaire', 'when', 'date and time', 'date & time', 'datum', 'wann', 'termin',
    'datum und uhrzeit', 'fecha', 'fecha y hora', 'cuando'),
  lieu: liste('lieu', 'adresse', 'etablissement', 'hotel', 'salle', 'address', 'location', 'venue', 'ort', 'unterkunft', 'veranstaltungsort', 'direccion',
    'lugar', 'alojamiento', 'establecimiento'),
  prix: liste('total', 'montant', 'prix', 'prix total', 'montant total', 'montant paye', 'total paye', 'total ttc', 'total paid', 'total price', 'amount',
    'amount paid', 'price', 'gesamt', 'gesamtpreis', 'gesamtbetrag', 'betrag', 'summe', 'preis', 'importe', 'importe total', 'precio', 'precio total',
    'total pagado'),
};
const mots = (...m: string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${m.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
// Dans l'ordre de priorité, en cas d'égalité.
const SORTES: Array<[TypeReservation, RegExp]> = [
  ['location', mots('location de voiture', 'location de vehicule', 'voiture de location', 'car rental', 'rental car', 'hire car', 'mietwagen', 'autovermietung', 'alquiler de coche', 'alquiler de vehiculo', 'coche de alquiler')],
  ['vol', mots('vol', 'vols', 'avion', 'aeroport', 'embarquement', 'flight', 'flights', 'boarding', 'airport', 'flug', 'fluge', 'flughafen', 'bordkarte', 'vuelo', 'vuelos', 'aeropuerto', 'tarjeta de embarque')],
  ['train', mots('train', 'trains', 'gare', 'zug', 'bahn', 'bahnhof', 'tren', 'trenes')],
  ['bus', mots('bus', 'autocar', 'autocars', 'fernbus', 'reisebus', 'autobus', 'autobuses')],
  ['hôtel', mots('hotel', 'hotels', 'hebergement', 'sejour', 'nuitee', 'nuitees', 'chambre', 'hotelbuchung', 'unterkunft', 'zimmer', 'ubernachtung', 'alojamiento', 'habitacion', 'room', 'accommodation', 'lodging')],
  ['spectacle', mots('spectacle', 'concert', 'theatre', 'festival', 'billetterie', 'show', 'event', 'konzert', 'theater', 'veranstaltung', 'espectaculo', 'concierto', 'teatro')],
  ['rendez-vous', mots('rendez-vous', 'rdv', 'consultation', 'appointment', 'termin', 'cita', 'consulta')],
];
// Étiquettes courtes qui sont aussi des en-têtes de courriel (message transféré) : gardées seulement avec une date.
const LARGES = liste('from', 'to', 'von', 'nach');
const GESTION = /(gerer|modifier|manage|verwalten|andern|gestionar|modificar|ma reservation|my booking|meine buchung|mi reserva)/;
// Des ordres donnés par le courriel (en plus de la détection d'Heimdall) : signalés, jamais suivis.
const ORDRES = /(?<!\p{L})(annule[rz]?|cancel|storniere|stornieren|cancela[r]?|anula[r]?)\s+(tout|toutes|tous|all|every|alles|todo|todas|todos)(?!\p{L})/u;

function sorteDuTexte(t: string): TypeReservation | undefined {
  let mieux: TypeReservation | undefined, n = 0;
  for (const [type, re] of SORTES) { const k = t.match(re)?.length ?? 0; if (k > n) { mieux = type; n = k; } }
  return mieux;
}
/** Le lieu écrit avant la date sur une ligne « Départ : Valmonde, 12 déc. 2026 18:40 ». */
const avantDate = (v: string, i: number | undefined) => v.slice(0, i ?? v.length).replace(/[\s,;:\-–—]+(?:(?:le|on|am|el|à|at|den)\s*)?$/iu, '').trim();

function liensDuHtml(html: string): Array<{ href: string; texte: string }> {
  const bas = html.toLowerCase(), out: Array<{ href: string; texte: string }> = [];
  let pos = 0;
  for (let n = 0; n < MAX_LIENS; n++) {
    const i = bas.indexOf('<a', pos);
    if (i < 0) break;
    const gt = bas.indexOf('>', i);
    if (gt < 0) break;
    pos = gt + 1;
    if (gt - i > 2000 || !/^<a\s/.test(bas.slice(i, i + 3))) continue;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html.slice(i, gt))?.slice(1).find((x) => x !== undefined);
    const fin = bas.indexOf('</a', gt);
    const texte = html.slice(gt + 1, fin < 0 || fin - gt > 300 ? gt + 1 : fin).replace(/<[^<>]*>/g, ' ');
    if (href) out.push({ href: href.replace(/&amp;/g, '&'), texte });
  }
  return out;
}

function depuisTexte(c: CourrielLu, texte: string): Lu | undefined {
  const tout = forme(`${c.subject}\n${texte}`);
  const type = sorteDuTexte(tout);
  if (!type) return undefined;
  const r: Corps = { type };
  const raisons: string[] = [];
  let date = false;
  const lignes = texte.split(/\r?\n/);
  let lienBrut: string | undefined;
  for (let k = 0; k < lignes.length && k < 5_000; k++) {
    const l = lignes[k].slice(0, MAX_LIGNE).replace(INVISIBLES, ' ').trim().replace(/^[*•·>\-–]+\s*/, '');
    if (!lienBrut && GESTION.test(forme(l))) lienBrut = /https?:\/\/[^\s<>"']{1,500}/.exec(l)?.[0] ?? /https?:\/\/[^\s<>"']{1,500}/.exec(lignes[k + 1] ?? '')?.[0];
    const m = /^([^:：]{1,40}?)\s*[:：]\s*(.+)$/u.exec(l);
    if (!m) continue;
    const et = forme(m[1]).replace(/\s*\.$/, ''), v = m[2].trim();
    const dt = () => { const d = lireDateTexte(v); if (d?.doute) raisons.push(d.doute); if (d?.date) date = true; return d; };
    if (!r.numero && ETIQ.numero.has(et)) {
      const tok = /[\p{L}\p{N}][\p{L}\p{N}\-/]{2,29}/u.exec(v)?.[0];
      if (tok && (/\d/.test(tok) || (/^[A-Z]{5,}$/.test(tok)))) r.numero = tok;
    } else if (!r.qui && ETIQ.qui.has(et)) { const q = nomValide(v); if (q) r.qui = q; }
    else if (type === 'hôtel' && ETIQ.entree.has(et)) { const d = dt(); if (d?.date && !r.debut) r.debut = d.date; }
    else if (type === 'hôtel' && ETIQ.sortie.has(et)) { const d = dt(); if (d?.date && !r.fin) r.fin = d.date; }
    else if (type !== 'hôtel' && (ETIQ.depart.has(et) || ETIQ.arrivee.has(et))) {
      const d = dt();
      if (LARGES.has(et) && !d?.date) continue;
      const ou = lieuValide(avantDate(v, d?.index)), dep = ETIQ.depart.has(et);
      if (dep) { if (ou && !r.depart) r.depart = ou; if (d?.date && !r.debut) r.debut = d.date; }
      else { if (ou && !r.arrivee) r.arrivee = ou; if (d?.date && !r.fin) r.fin = d.date; }
    } else if (ETIQ.date.has(et)) { const d = dt(); if (d?.date && !r.debut) r.debut = d.date; }
    else if (!r.lieu && ETIQ.lieu.has(et)) { const ou = lieuValide(v); if (ou) r.lieu = ou; }
    else if (!r.prix && ETIQ.prix.has(et)) { const p = prixDuTexte(v); if (p) r.prix = p; }
  }
  // Pas une réservation : ni numéro, ni date sur une ligne étiquetée.
  if (!r.numero && !date && !raisons.length) return undefined;
  if (!lienBrut && c.html) lienBrut = liensDuHtml(c.html.slice(0, MAX_HTML)).find((a) => GESTION.test(forme(a.texte)))?.href;
  const expediteur = /^\s*"?([^"<]+?)"?\s*</.exec(c.from)?.[1];
  const four = expediteur === undefined ? undefined : net(expediteur, 80);
  if (four) r.fournisseur = four;
  raisons.unshift('lu dans le texte, sans balisage : à relire');
  if (!r.debut && !raisons.some((x) => /date/.test(x))) raisons.push('aucune date lue');
  return { r, raisons, lienBrut };
}

// ---------------- Assemblage ----------------

/** Les dates (jour, et jour + heure) écrites dans le texte visible, bornées. */
function datesDuTexte(t: string): Set<string> {
  const out = new Set<string>();
  let n = 0;
  for (const ligne of t.split(/\r?\n/)) {
    for (let k = 0; k < ligne.length && n < 5_000; k += MAX_LIGNE - 60, n++) {
      let s = ligne.slice(k, k + MAX_LIGNE);
      for (let j = 0; j < 10; j++) {
        const l = lireDateTexte(s);
        if (!l) break;
        if (l.date?.jour) { out.add(l.date.jour); if (l.date.heure) out.add(`${l.date.jour} ${l.date.heure}`); }
        s = s.slice(l.index + Math.max(1, l.date?.texte.length ?? 1));
      }
      if (ligne.length <= MAX_LIGNE) break;
    }
    if (n >= 5_000) break;
  }
  return out;
}

/** Les réservations d'un courriel (aucune si ce n'en est pas un). Une donnée « lu dehors » : jamais un ordre. */
export function reservationsDuCourriel(c: CourrielLu): Reservation[] {
  const texte = c.text.slice(0, MAX_TEXTE);
  const communes: string[] = [];
  if (c.authentifie !== true) communes.push('expéditeur non authentifié : le courriel peut venir de n\'importe qui');
  const echantillon = `${c.subject}\n${texte}`;
  if (scanForInjection(echantillon).suspicious || ORDRES.test(forme(echantillon))) communes.push('le courriel contient des consignes : ignorées, une réservation lue n\'est qu\'une donnée');
  const html = c.html ?? '';
  if (c.htmlTronque || html.length > MAX_HTML) communes.push('courriel très grand : lu en partie');

  const lus: Array<Lu & { lecture: Reservation['lecture'] }> = [];
  const objets: J[] = [];
  for (const b of blocsLd(html.slice(0, MAX_HTML))) { try { collecter(JSON.parse(b) as unknown, objets); } catch { /* bloc illisible : ignoré */ } }
  const vus = new Map<string, { sig: string; i: number }>();
  let datesVisibles: Set<string> | undefined;
  for (const o of objets) {
    const x = depuisBalisage(o);
    const cle = `${x.r.type}|${x.r.numero ?? ''}|${x.r.qui ?? ''}`;
    const sig = JSON.stringify([x.r.debut?.texte, x.r.fin?.texte, x.r.depart, x.r.arrivee, x.r.lieu]);
    const deja = vus.get(cle);
    if (deja) {
      if (deja.sig !== sig && !lus[deja.i].raisons.some((y) => /contradictoire/.test(y))) lus[deja.i].raisons.push('balisage contradictoire : deux versions de la même réservation');
      continue;
    }
    if (x.r.numero && !texte.includes(x.r.numero)) x.raisons.push('le numéro du balisage n\'apparaît pas dans le texte du courriel');
    // Le balisage est invisible au lecteur : sa date doit se retrouver (jour, et heure si donnée) dans le texte visible.
    for (const d of [x.r.debut, x.r.fin]) {
      if (!d?.jour) continue;
      datesVisibles ??= datesDuTexte(texte);
      if (!datesVisibles.has(d.heure ? `${d.jour} ${d.heure}` : d.jour)) { x.raisons.push('une date du balisage n\'apparaît pas dans le texte du courriel'); break; }
    }
    vus.set(cle, { sig, i: lus.length });
    lus.push({ ...x, lecture: 'balisage' });
    if (lus.length >= MAX_RES) break;
  }
  if (!lus.length) {
    const t = depuisTexte(c, texte);
    if (t) {
      if (/itemtype\s*=\s*["']?https?:\/\/schema\.org\/\w*Reservation/i.test(html.slice(0, MAX_HTML))) t.raisons.push('balisage en microdonnées non lu');
      lus.push({ ...t, lecture: 'texte' });
    }
  }
  return lus.map(({ r, raisons, lienBrut, lecture }) => {
    const toutes = [...raisons];
    const lien = lienValide(lienBrut, c.from, toutes);
    for (const x of communes) toutes.push(x);
    const out: Reservation = { ...r, piecesJointes: c.pieces.map((p) => ({ ...p })), source: c.id || 'courriel sans identifiant', origine: 'lu dehors', lecture, statut: toutes.length ? 'à vérifier' : 'lu', raisons: toutes };
    if (lien) out.lienGestion = lien;
    return out;
  });
}

const dateTexte = (d: DateReservation) => (d.jour ? `${d.jour}${d.heure ? ` ${d.heure}` : ''}${d.fuseau ? ` (${d.fuseau})` : ''}` : d.texte);
/** Une ligne lisible pour une réservation (dans la lecture d'un courriel). */
export function resumeReservation(r: Reservation): string {
  const trajet = r.depart || r.arrivee ? `${r.depart ?? '?'} → ${r.arrivee ?? '?'}` : r.lieu;
  const morceaux = [
    r.type, r.qui, trajet,
    r.debut && `début ${dateTexte(r.debut)}`, r.fin && `fin ${dateTexte(r.fin)}`,
    r.numero && `n° ${r.numero}`, r.fournisseur, r.prix && `${r.prix.montant.toFixed(2)}${r.prix.devise ? ` ${r.prix.devise}` : ''}`, r.etat,
    r.lienGestion && `lien de gestion (non suivi) : ${r.lienGestion}`,
    r.statut === 'lu' ? 'lu dehors' : `lu dehors, à vérifier : ${r.raisons.join(' ; ')}`,
  ];
  return `- ${morceaux.filter(Boolean).join(' · ')}`;
}
