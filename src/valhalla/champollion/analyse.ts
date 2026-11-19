// Champollion · comprendre un texte : type de document, langue, dates, événements (rendez-vous, échéances,
// livraisons…), montants, contacts, liens. Pur, testé, sans IA (l'IA d'Odin, si elle est là, ajoute un résumé).
// Plus bas : typeDocument, le document déposé (son type en règles dans six langues, et ses données clés).

import { scanForInjection } from '../../heimdall/injection.ts';
import { trierSecrets } from '../../heimdall/secrets-entrants.ts';
import { chiffresLatins, compare, decimalExact, langueCouverte, lireChiffres, moins, norm, plus, rat, LANGUES_CALCUL, type Langue, type Rationnel } from '../../langue/nombres.ts';
import { lireDateTexte, reservationsDuCourriel, type Reservation } from '../../tools/reservations.ts';
import { LANGUES_DOCUMENTS } from './types-documents/index.ts';
import { SORTES_REFERENCE, TYPES_CONNUS, type DonneesLangue, type IdBouton, type SorteReference, type TypeConnu } from './types-documents/forme.ts';

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MOIS_COURT: Record<string, number> = { janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12 };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200;

export interface DateFound { date: string; heure?: string; texte: string; index: number }
export interface Event { quand: string; heure?: string; quoi: string; genre: string }
export interface Analyse {
  type: string; langue: 'français' | 'anglais' | 'autre'; mots: number; resume: string[];
  dates: DateFound[]; evenements: Event[]; montants: Array<{ valeur: number; texte: string; total: boolean }>;
  emails: string[]; telephones: string[]; liens: string[]; iban: string[];
}

const TYPES: Array<[string, RegExp]> = [
  ['devis', /\bdevis\b|offre de prix/],
  ['facture', /\bfacture\b|n[°o] de facture|montant (ttc|ht)|total ttc/],
  ['bulletin de salaire', /bulletin de (salaire|paie)|salaire (brut|net)|net a payer/],
  ['relevé bancaire', /releve de compte|solde (crediteur|debiteur|au)|\biban\b.*\bbic\b/],
  ['ordonnance', /ordonnance|posologie|\bcomprime|\bmg\b.*par jour/],
  ['contrat', /\bcontrat\b|entre les soussignes|article \d+|le present contrat/],
  ['convocation', /convocation|vous etes convoque|est convoque/],
  ['billet ou réservation', /reservation|embarquement|numero de vol|\bvol\b [a-z]{2}\s?\d|check-in|confirmation de commande/],
  ['attestation', /\battestation\b|certifie que|atteste que/],
  ['CV', /curriculum|experiences? professionnelles?|competences|formation\s*:/],
  ['courrier', /madame, monsieur|veuillez agreer|cordialement|objet\s*:/],
];
const EVENT_WORDS: Array<[string, RegExp]> = [
  ['rendez-vous', /rendez-vous|\brdv\b|consultation|rencontre/],
  ['réunion', /reunion|visio|meeting|assemblee/],
  ['échéance', /echeance|date limite|avant le|au plus tard|a payer le|a regler|expire|valable jusqu/],
  ['livraison', /livraison|livre le|expedi|retrait/],
  ['voyage', /\bvol\b|depart|arrivee|embarquement|check-in/],
  ['convocation', /convoqu|audience|examen|entretien/],
  ['événement', /anniversaire|fete|mariage|soiree|spectacle|match|concert/],
];

/** Les dates du texte (formats français et ISO, « 13 novembre 2026 », « lundi 16 nov. », « demain »), avec l'heure à côté. */
export function findDates(text: string, now = new Date()): DateFound[] {
  const out: DateFound[] = [], t = fold(text), Y = now.getFullYear();
  const heureAt = (i: number) => { const m = /^[^\n.]{0,24}?\b(?:a\s+|de\s+|vers\s+)?(\d{1,2})\s?(?:h|:)\s?(\d{2})?\b/.exec(t.slice(i, i + 40)); if (!m) return undefined; const h = Number(m[1]), mi = Number(m[2] ?? 0); return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : undefined; };
  const push = (y: number, m: number, d: number, idx: number, len: number) => { if (!valid(y, m, d)) return; if (out.some((x) => Math.abs(x.index - idx) < 4)) return; out.push({ date: iso(y, m, d), heure: heureAt(idx + len), texte: text.slice(idx, idx + len).trim(), index: idx }); };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(+m[1], +m[2], +m[3], m.index!, m[0].length);
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; push(y, +m[2], +m[1], m.index!, m[0].length); }
  const moisRe = `(${MOIS.join('|')}|${Object.keys(MOIS_COURT).join('|')})\\.?`;
  for (const m of t.matchAll(new RegExp(`\\b(?:(?:${JOURS.join('|')})\\s+)?(\\d{1,2})(?:er)?\\s+${moisRe}(?:\\s+(\\d{4}))?`, 'g'))) {
    const mois = MOIS.indexOf(m[2]) + 1 || MOIS_COURT[m[2]]; let y = m[3] ? +m[3] : Y;
    if (!m[3] && new Date(y, mois - 1, +m[1]).getTime() < now.getTime() - 60 * 864e5) y++; // sans année : la prochaine
    push(y, mois, +m[1], m.index!, m[0].length);
  }
  for (const m of t.matchAll(/\b(aujourd'hui|demain|apres-demain)\b/g)) { const d = new Date(now); d.setDate(d.getDate() + (m[1] === 'demain' ? 1 : m[1] === 'apres-demain' ? 2 : 0)); push(d.getFullYear(), d.getMonth() + 1, d.getDate(), m.index!, m[0].length); }
  return out.sort((a, b) => a.index - b.index);
}

/** Ce qu'on comprend d'un texte. `now` pour les dates relatives. */
export function analyse(text: string, now = new Date()): Analyse {
  const t = fold(text), words = t.split(/\s+/).filter(Boolean);
  const fr = (t.match(/\b(le|la|les|de|des|du|et|est|une|pour|vous|nous|avec|sur|dans|au|aux|chez|avant|apres)\b/g) ?? []).length + Math.floor((text.match(/[éèêàçùâîôû]/gi) ?? []).length / 2), en = (t.match(/\b(the|and|is|of|to|for|you|with|on|in|your|this)\b/g) ?? []).length;
  const type = TYPES.find(([, re]) => re.test(t))?.[0] ?? (words.length < 40 ? 'message' : 'document');
  const dates = findDates(text, now);
  // Une phrase (ou ligne) qui porte une date et un mot d'événement = un événement
  const evenements: Event[] = [];
  const sentences = [...text.matchAll(/[^\n.!?]+[.!?]?/g)].map((m) => ({ s: m[0], i: m.index! }));
  for (const d of dates) {
    const sen = sentences.find((x) => d.index >= x.i && d.index < x.i + x.s.length); if (!sen) continue;
    const f = fold(sen.s), g = EVENT_WORDS.find(([, re]) => re.test(f));
    if (g || d.heure) evenements.push({ quand: d.date, heure: d.heure, quoi: sen.s.trim().replace(/\s+/g, ' ').slice(0, 160), genre: g?.[0] ?? 'rendez-vous' });
  }
  const montants = [...text.matchAll(/(\d{1,3}(?:[  .]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(€|eur\b|euros?)/gi)].map((m) => {
    const v = Number(m[1].replace(/[  .](?=\d{3}\b)/g, '').replace(',', '.'));
    const before = fold(text.slice(Math.max(0, m.index! - 30), m.index!));
    return { valeur: v, texte: m[0].trim(), total: /total|net a payer|a payer|montant ttc|solde/.test(before) };
  }).filter((x) => Number.isFinite(x.valeur));
  const uniq = (l: string[]) => [...new Set(l)];
  const emails = uniq(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []);
  const telephones = uniq((text.match(/(?:\+262|\+33|\b0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/g) ?? []).map((x) => x.replace(/[\s.-]/g, ' ').replace(/\s+/g, ' ').trim()));
  const liens = uniq(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []);
  const iban = uniq((text.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g) ?? []).map((x) => x.replace(/\s/g, '')));
  const resume = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && /[a-zà-ÿ]{3}/i.test(l)).slice(0, 3).map((l) => l.slice(0, 140));
  return { type, langue: fr > en && fr >= 2 ? 'français' : en > fr && en >= 2 ? 'anglais' : 'autre', mots: words.length, resume, dates, evenements, montants, emails, telephones, liens, iban };
}

/** Le compte rendu en texte. Pur. */
export function report(a: Analyse, source: string): string {
  const fmtD = (d: string, h?: string) => `${new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${h ? ` à ${h.replace(':', ' h ')}` : ''}`;
  const total = a.montants.find((m) => m.total) ?? null;
  return [
    `📄 ${source} · ${a.type} · ${a.langue} · ${a.mots} mots`,
    ...(a.resume.length ? [`En bref : ${a.resume.join(' / ')}`] : []),
    ...(a.evenements.length ? ['Événements :', ...a.evenements.slice(0, 10).map((e) => `- ${e.genre} · ${fmtD(e.quand, e.heure)} · ${e.quoi}`)] : a.dates.length ? [`Dates : ${a.dates.slice(0, 6).map((d) => fmtD(d.date, d.heure)).join(' · ')}`] : []),
    ...(a.montants.length ? [`Montants : ${a.montants.slice(0, 6).map((m) => m.texte).join(' · ')}${total ? ` (total : ${total.texte})` : ''}`] : []),
    ...(a.emails.length || a.telephones.length ? [`Contacts : ${[...a.emails, ...a.telephones].slice(0, 6).join(' · ')}`] : []),
    ...(a.iban.length ? [`IBAN : ${a.iban.map((x) => `${x.slice(0, 4)} … ${x.slice(-4)}`).join(' · ')}`] : []),
    ...(a.liens.length ? [`Liens : ${a.liens.slice(0, 5).join(' · ')}`] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Le document déposé : son type en règles, par langue, et ses données clés. Pur : aucun fichier, aucun réseau, aucun
// modèle. Tout ce qui sort d'ici est une DONNÉE lue dehors (origine « lu dehors »), jamais un ordre : un document qui
// donne des consignes est signalé, rien n'est exécuté, et les boutons ne viennent que d'une liste fermée.
//  - Le type est dit avec ses raisons (les mots trouvés) et une confiance : « sûr », « probable », ou « inconnu » quand
//    rien ne tranche (jamais deviné ; une hésitation entre deux types est dite).
//  - Les montants sont lus exactement (fractions, nombres.ts) ; un total qui ne tombe pas juste est signalé avec l'écart,
//    jamais corrigé ; un total qui n'a pas pu être recompté depuis ses lignes est dit « pas vérifié ». Un séparateur ambigu
//    (« 1,250 ») est lu selon la langue et marqué « à vérifier ».
//  - « Préparer le paiement » (jamais « payer ») : seulement sur une facture au total positif, recompté juste depuis ses
//    lignes, qui ne se dit pas déjà réglée, sans consigne ; il reste à valider par le propriétaire.
//  - La conversion proposée suit le format du fichier, que l'appelant donne : un Word en PDF, un PDF en Word.
//  - Une date ambiguë (03/04 : jour ou mois ?) ou impossible n'est pas tranchée : seul le doute est rendu.
//  - IBAN et cartes : seulement ceux dont la clé est juste (secrets-entrants.ts), et masqués (4 derniers caractères).
//  - Bornes : texte de 200 000 caractères au plus (au-delà : non lu), 5 000 lignes, 1 000 caractères par ligne ; un
//    contenu binaire n'est pas lu.

export type TypeDocument = TypeConnu | 'inconnu';
export type { IdBouton, SorteReference, TypeConnu };
/** La liste fermée des boutons. « Payer » n'y est jamais : seulement « préparer le paiement », validé par le propriétaire. */
export const BOUTONS_DOCUMENT: readonly IdBouton[] = ['convertir-word', 'convertir-pdf', 'extraire-tableau', 'ajouter-echeance', 'preparer-paiement'];

export interface MontantLu {
  /** Tel qu'écrit. */
  texte: string;
  /** Valeur exacte en décimal (« 1250.5 »). */
  valeur: string;
  devise?: string;
  aVerifier?: string;
}
export interface ControleMontant { quoi: string; juste: boolean; calcule: string; ecrit: string; ecart?: string }
export type RoleDate = 'émission' | 'échéance' | 'validité' | 'voyage' | 'autre';
export interface DateDocument { role: RoleDate; jour?: string; heure?: string; texte: string; doute?: string }
export interface BoutonDocument { id: IdBouton; libelle: string; engageant: boolean; validation?: 'propriétaire' }
export interface DonneesDocument {
  emetteur?: string;
  destinataire?: string;
  dates: DateDocument[];
  montants: { devise?: string; lignes: MontantLu[]; ht?: MontantLu; tva?: MontantLu; ttc?: MontantLu; total?: MontantLu; controles: ControleMontant[] };
  references: Array<{ sorte: SorteReference; valeur: string }>;
  /** IBAN à la clé juste, masqués : « •••• 5432 ». */
  iban: string[];
  /** Cartes à la clé de Luhn juste, masquées : « •••• 1111 ». */
  cartes: string[];
  /** Billet ou carte d'embarquement : la réservation lue (reservations.ts), elle aussi « lu dehors ». */
  reservation?: Pick<Reservation, 'type' | 'qui' | 'depart' | 'arrivee' | 'debut' | 'fin' | 'numero' | 'prix' | 'statut' | 'raisons'>;
}
export interface DocumentLu {
  type: TypeDocument;
  confiance: 'sûr' | 'probable' | 'inconnu';
  langue?: Langue;
  /** Les mots qui l'ont fait reconnaître (ou pourquoi il ne l'est pas). */
  raisons: string[];
  /** Ce qui doit être vu : total faux, consignes dans le document, lecture partielle… */
  alertes: string[];
  donnees: DonneesDocument;
  boutons: BoutonDocument[];
  origine: 'lu dehors';
}
export interface OptionsDocument {
  /** La langue des libellés des boutons ; sinon celle du document ; sinon le français. */
  langue?: string;
  /**
   * Le format du fichier déposé, donné par l'appelant (le texte seul ne le dit pas) : « word » → « convertir en PDF » ;
   * « pdf » ou rien → « convertir en Word » (le texte a été lu dans un PDF ou une image).
   */
  format?: 'pdf' | 'word';
}

const MAX_TEXTE = 200_000, MAX_LIGNES = 5_000, MAX_LIGNE = 1_000, ZONE_TYPE = 30_000;
const LETTRE_OU_CHIFFRE = '[\\p{L}\\p{N}]';
const ARABE = /\p{Script=Arabic}/u;
const INVISIBLES_DOC = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Le motif d'une étiquette : même forme que le texte, mots entiers, « : » souple, préfixes et suffixes arabes admis.
 * La fin : un mot qui finit par une lettre ou un chiffre ne doit pas être suivi d'une lettre ou d'un chiffre (une seule
 * condition pour tout un groupe : la dernière lettre prise n'en est pas une, ou la suivante n'en est pas une).
 */
const FIN_MOT = `(?:(?<=[^\\p{L}\\p{N}])|(?!${LETTRE_OU_CHIFFRE}))`;
function motif(p: string, ancre = false): { avant: string; corps: string; apres: string } {
  const debut = ancre || p.startsWith('^');
  const q = norm(chiffresLatins(p.replace(/^\^/, ''))).replace(/\s*:\s*/g, ':').trim();
  const corps = q.split(/\s+/).map(echapper).join('\\s+').replace(/:/g, '\\s*:');
  if (ARABE.test(q)) return { avant: `${debut ? '^\\s*' : `(?<!${LETTRE_OU_CHIFFRE})`}(?:[وفبلك]?(?:ال|لل)?)`, corps, apres: `(?:ه|ها|ك|كم|نا|ي|هم)?(?!${LETTRE_OU_CHIFFRE})` };
  const avant = debut ? '^\\s*' : /^[\p{L}\p{N}]/u.test(q) ? `(?<!${LETTRE_OU_CHIFFRE})` : '';
  return { avant, corps, apres: FIN_MOT };
}
/**
 * Une expression pour une liste d'étiquettes (les plus longues d'abord, pour que « facture n° » passe avant « facture »).
 * Les étiquettes qui ont les mêmes bornes sont regroupées sous elles : l'expression reste petite, et rapide à préparer.
 */
function expression(phrases: string[], drapeaux: string, ancre = false): RegExp {
  const groupes = new Map<string, { avant: string; apres: string; corps: string[] }>();
  for (const p of [...new Set(phrases)].sort((a, b) => b.length - a.length)) {
    const m = motif(p, ancre), cle = `${m.avant}\u0000${m.apres}`;
    const g = groupes.get(cle) ?? { avant: m.avant, apres: m.apres, corps: [] };
    g.corps.push(m.corps);
    groupes.set(cle, g);
  }
  const alt = [...groupes.values()].map((g) => `${g.avant}(?:${g.corps.join('|')})${g.apres}`);
  return new RegExp(alt.length ? alt.map((x) => `(?:${x})`).join('|') : '(?!)', drapeaux);
}
const deToutes = (f: (l: DonneesLangue) => string[] | undefined) => LANGUES_CALCUL.flatMap((l) => f(LANGUES_DOCUMENTS[l]) ?? []);

// Les expressions, compilées une fois.
const RX_TYPES = TYPES_CONNUS.map((t) => ({ t, forts: expression(deToutes((d) => d.types[t].forts), 'gmu'), indices: expression(deToutes((d) => d.types[t].indices), 'gmu') }));
const RX_LANGUES = LANGUES_CALCUL.map((l) => {
  const d = LANGUES_DOCUMENTS[l];
  const phrases = [...TYPES_CONNUS.flatMap((t) => [...d.types[t].forts, ...d.types[t].indices]), ...d.emetteur, ...d.destinataire, ...Object.values(d.references).flat(),
    ...Object.values(d.dates).flat(), ...Object.values(d.montants).flat()].map((p) => p.replace(/^\^/, ''));
  return { l, mots: expression(d.mots, 'gmu'), phrases: expression(phrases, 'gmu') };
});
const RX = {
  emetteur: expression(deToutes((d) => d.emetteur), 'u', true),
  destinataire: expression(deToutes((d) => d.destinataire), 'u', true),
  references: SORTES_REFERENCE.map((s) => ({ s, re: expression(deToutes((d) => d.references[s]), 'u') })),
  dates: {
    échéance: expression(deToutes((d) => d.dates.echeance), 'u'), validité: expression(deToutes((d) => d.dates.validite), 'u'),
    voyage: expression(deToutes((d) => d.dates.voyage), 'u'), émission: expression(deToutes((d) => d.dates.emission), 'u'),
  },
  // « Date : » seul devant la date (« Date de naissance : », « Effective date: » ne sont pas des dates d'émission).
  generique: new RegExp(`^[\\s,;|-]*(?:${expression(deToutes((d) => d.dates.generiques), 'u').source})\\s*:?\\s*$`, 'u'),
  ttc: expression(deToutes((d) => d.montants.ttc), 'u'), ht: expression(deToutes((d) => d.montants.ht), 'u'),
  tva: expression(deToutes((d) => d.montants.tva), 'u'), total: expression(deToutes((d) => d.montants.total), 'u'),
  horsLignes: expression(deToutes((d) => d.montants.horsLignes), 'u'),
  regle: expression(deToutes((d) => d.regle), 'gmu'),
};
/** Mois arabes et swahilis (le lecteur des réservations lit ceux du français, de l'anglais, de l'allemand, de l'espagnol). */
const MOIS_LOCAUX = new Map<string, number>();
for (const l of LANGUES_CALCUL) LANGUES_DOCUMENTS[l].mois?.forEach((noms, i) => { for (const n of noms) MOIS_LOCAUX.set(norm(n), i + 1); });
const RE_DATE_LOCALE = /(?<![\p{N}])(\d{1,2})\s+(?:ya\s+)?(\p{L}+(?:\s\p{L}+)?)\s*[,،]?\s*(\d{4})(?![\p{N}])/gu;
/**
 * Un numéro qui a la forme d'un IBAN (deux lettres, deux chiffres, puis 11 à 30 lettres ou chiffres, dont 8 chiffres au
 * moins) ou d'une carte (13 à 19 chiffres, le premier groupe de 4 au moins), même si sa clé est fausse : il ne sort
 * jamais en clair d'ici. `auDebut` : seulement s'il commence la valeur (une référence).
 */
const RE_IBAN_FORME = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![A-Z0-9])/gu;
const RE_CARTE_FORME = /(?<![\p{N}])\d{4}[\d \-]{8,24}\d(?![\p{N}])/gu;
function formeSecrete(v: string, auDebut = false): boolean {
  for (const re of [RE_IBAN_FORME, RE_CARTE_FORME]) {
    for (const m of v.toUpperCase().matchAll(re)) {
      if (auDebut && (m.index ?? 0) > 0) break;
      const chiffres = m[0].replace(/\D/g, '').length;
      if (re === RE_IBAN_FORME ? chiffres >= 8 : chiffres >= 13 && chiffres <= 19) return true;
    }
  }
  return false;
}
const RE_CHAMP_VIDE = /_{3,}|\.{5,}|…{2,}|\[\s?\]|[☐□]/u;

/** Le texte ramené à la forme de comparaison, avec pour chaque caractère sa place dans l'original. */
function formeAvecPlaces(s: string): { n: string; place: number[] } {
  let n = '', i = 0;
  const place: number[] = [];
  for (const c of s) {
    const k = norm(c);
    for (let j = 0; j < k.length; j++) place.push(i);
    n += k;
    i += c.length;
  }
  place.push(i);
  return { n, place };
}

interface DateTrouvee { index: number; fin: number; jour?: string; heure?: string; texte: string; doute?: string }
/** Les dates d'une ligne (chiffres déjà ramenés en latins), dans l'ordre. */
function datesDeLigne(s: string): DateTrouvee[] {
  const out: DateTrouvee[] = [];
  for (let k = 0, n = 0; k < s.length && n < 8; n++) {
    const r = lireDateTexte(s.slice(k));
    if (!r) break;
    const index = k + r.index;
    const texte = r.date?.texte || /«\s?(.+?)\s?»/.exec(r.doute ?? '')?.[1] || s.slice(index, index + 10);
    out.push({ index, fin: index + Math.max(1, texte.length), ...(r.date?.jour ? { jour: r.date.jour } : {}), ...(r.date?.heure ? { heure: r.date.heure } : {}), texte, ...(r.doute ? { doute: r.doute } : {}) });
    k = index + Math.max(1, texte.length);
  }
  for (const m of s.matchAll(RE_DATE_LOCALE)) {
    const mots = m[2].split(/\s/), mois = MOIS_LOCAUX.get(norm(m[2])) ?? (mots.length === 1 ? MOIS_LOCAUX.get(norm(mots[0])) : undefined);
    if (!mois) continue;
    const a = +m[3], j = +m[1], index = m.index ?? 0;
    if (out.some((x) => index < x.fin && x.index < index + m[0].length)) continue;
    const valide = a >= 1900 && a <= 2200 && j >= 1 && j <= new Date(Date.UTC(a, mois, 0)).getUTCDate();
    out.push({ index, fin: index + m[0].length, texte: m[0], ...(valide ? { jour: `${a}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}` } : { doute: `date impossible : « ${m[0]} »` }) });
  }
  return out.sort((x, y) => x.index - y.index);
}

// Les montants : un nombre avec une devise, ou avec deux décimales. Les dates et les heures sont masquées avant.
const DEV_AVANT = String.raw`US\$|€|\$|£|EUR|USD|GBP|CHF|KMF|MGA|TZS|TSh|KES|KSh|MAD|SAR|AED|EGP|DZD|TND|XOF|XAF`;
const DEV_APRES = String.raw`€|\$|£|EUR|euros?|USD|GBP|CHF|KMF|MGA|TZS|TSh|KES|KSh|MAD|DH|SAR|AED|EGP|DZD|TND|XOF|XAF|F\s?CFA|ر\.س|د\.إ|ج\.م|د\.م|دج|درهم|ريال|دينار|جنيه|يورو|دولار|shilingi`;
const NOMBRE = String.raw`\d{1,3}(?:[ \u00a0\u202f.,'’٬]\d{3})+(?:[.,٫]\d{1,2})?|\d+(?:[.,٫]\d{1,2})?`;
// Le signe moins est collé au nombre (« -50,00 € ») : un tiret entre une étiquette et le nombre (« Total - 144,00 € ») n'en est pas un.
const RE_MONTANT = new RegExp(String.raw`(?<![\p{L}\p{N}.,٫٬/:])([-−])?(?:(${DEV_AVANT})\s?)?(${NOMBRE})(?:\s?(${DEV_APRES})(?!\p{L}))?(?![\p{N}]|[.,٫/:]\d|\s?[%٪])`, 'giu');
const RE_HEURE_SEULE = /(?<![\p{N}])\d{1,2}\s?[:h]\s?\d{2}(?![\p{N}])/gu;
const DEVISES: Record<string, string> = {
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', 'يورو': 'EUR', 'us$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF', kmf: 'KMF', mga: 'MGA',
  tzs: 'TZS', tsh: 'TZS', kes: 'KES', ksh: 'KES', mad: 'MAD', dh: 'MAD', 'د.م': 'MAD', sar: 'SAR', 'ر.س': 'SAR', aed: 'AED', 'د.إ': 'AED', egp: 'EGP', 'ج.م': 'EGP',
  dzd: 'DZD', 'دج': 'DZD', tnd: 'TND', xof: 'XOF', xaf: 'XAF',
};
/** `i` : la place du montant dans la ligne. */
interface MontantBrut { m: MontantLu; r: Rationnel; i: number }
/** Les montants d'une ligne. Langue du document inconnue : lus à la française, et un séparateur qui en dépend est dit. */
function montantsDeLigne(s: string, dates: DateTrouvee[], langue: Langue | undefined): MontantBrut[] {
  let t = s;
  for (const d of dates) t = t.slice(0, d.index) + ' '.repeat(Math.max(0, Math.min(d.fin, t.length) - d.index)) + t.slice(d.fin);
  t = t.replace(RE_HEURE_SEULE, (x) => ' '.repeat(x.length));
  const out: MontantBrut[] = [];
  for (const m of t.matchAll(RE_MONTANT)) {
    const dev = m[2] ?? m[4];
    if (!dev && !/[.,٫]\d{2}$/.test(m[3])) continue;
    const lu = lireChiffres(m[3], langue ?? 'fr');
    if (!lu) continue;
    const r = m[1] ? rat(-lu.valeur.n, lu.valeur.d) : lu.valeur;
    const valeur = decimalExact(r, 6);
    if (valeur === undefined) continue;
    const brut = s.slice(m.index ?? 0, (m.index ?? 0) + m[0].length).trim();
    const devise = dev === undefined ? undefined : DEVISES[dev.toLowerCase().replace(/\s/g, '')] ?? dev;
    const montant: MontantLu = { texte: brut, valeur, ...(devise ? { devise } : {}) };
    if (lu.ambigu && lu.autre) montant.aVerifier = `${langue ? '' : 'langue du document inconnue, '}séparateur ambigu : lu ${valeur}, ou ${decimalExact(lu.autre, 6) ?? '?'} : à vérifier`;
    out.push({ m: montant, r, i: m.index ?? 0 });
    if (out.length >= 50) break;
  }
  return out;
}

/** Un nom, une raison sociale : propre, une lettre au moins, 120 caractères au plus ; la première colonne seulement. */
function valeurNom(v: string): string | undefined {
  const t = v.replace(INVISIBLES_DOC, ' ').replace(/^[\s:：\-–—]+/, '').split(/\s{3,}|\t|\s\|\s/)[0].replace(/\s+/g, ' ').trim();
  return t && t.length <= 120 && /\p{L}/u.test(t) ? t : undefined;
}
const RE_VALEUR_REF = /^[\s:：#.\-–—]*(?:(?:n°|nº|no\.?|nr\.?|núm\.?|num\.?|number|numero|número|namba|رقم)\s*[:：.]?\s*)?([\p{L}\p{N}][\p{L}\p{N}\-/._]{0,39})/iu;
const RE_VOL = /^[\s:：#.\-–—]*(?:(?:n°|nº|no\.?|nr\.?)\s*[:：.]?\s*)?([A-Z0-9]{2})\s?(\d{1,4}[A-Z]?)(?![\p{L}\p{N}])/u;
function valeurReference(sorte: SorteReference, reste: string): string | undefined {
  if (sorte === 'vol') { const m = RE_VOL.exec(reste); return m && /[A-Z]/.test(m[1]) ? `${m[1]} ${m[2]}` : undefined; }
  const v = RE_VALEUR_REF.exec(reste)?.[1]?.replace(/[.\-/_]+$/, '');
  if (!v || /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(v)) return undefined;
  if (/\d/.test(v) || (sorte === 'réservation' && /^[A-Z0-9]{5,8}$/.test(v))) return v;
  return undefined;
}

const vide = (): DonneesDocument => ({ dates: [], montants: { lignes: [], controles: [] }, references: [], iban: [], cartes: [] });
function refus(alerte: string): DocumentLu {
  return { type: 'inconnu', confiance: 'inconnu', raisons: [alerte], alertes: [alerte], donnees: vide(), boutons: [], origine: 'lu dehors' };
}
const masque = (v: string) => `•••• ${v.replace(/[\s-]/g, '').slice(-4)}`;
const TYPES_TABLEAU: readonly TypeDocument[] = ['facture', 'devis', 'relevé bancaire', 'formulaire', 'billet', "carte d'embarquement"];

/**
 * Le document déposé (son texte déjà lu) : son type, la confiance, les raisons, les données clés et les boutons à
 * proposer. Pur. Rien n'est exécuté, rien n'est suivi ; tout ce qui est rendu est « lu dehors ».
 */
export function typeDocument(texte: string, o: OptionsDocument = {}): DocumentLu {
  if (typeof texte !== 'string') return refus('pas un texte : non lu');
  if (texte.length > MAX_TEXTE) return refus(`document trop grand pour être lu en règles (plus de ${MAX_TEXTE} caractères) : non lu`);
  const echantillon = texte.slice(0, 10_000);
  const bizarres = (echantillon.match(/[\u0000-\u0008\u000e-\u001f\ufffd]/g) ?? []).length;
  if (echantillon.includes('\u0000') || bizarres > echantillon.length / 100) return refus('contenu binaire : non lu comme un texte');

  const raisons: string[] = [], alertes: string[] = [];
  const toutes = texte.replace(/\r\n?/g, '\n').split('\n');
  const lignes = toutes.slice(0, MAX_LIGNES).map((l) => chiffresLatins(l.slice(0, MAX_LIGNE)).replace(INVISIBLES_DOC, ' '));
  if (toutes.length > MAX_LIGNES) alertes.push(`document long : seules les ${MAX_LIGNES} premières lignes sont lues`);
  const source = chiffresLatins(texte.slice(0, ZONE_TYPE)).replace(INVISIBLES_DOC, ' ');
  const { n: zone, place: placeZone } = formeAvecPlaces(source);
  /** Les mots trouvés, une fois chacun (forme de comparaison), avec leur écriture dans le document. */
  const trouves = (re: RegExp) => {
    const out = new Map<string, string>();
    for (const m of zone.matchAll(re)) {
      const cle = m[0].replace(/\s+/g, ' ').trim(), i = m.index ?? 0;
      if (!out.has(cle)) out.set(cle, source.slice(placeZone[i], placeZone[i + m[0].length]).replace(/\s+/g, ' ').trim());
    }
    return out;
  };

  // La langue : mots courants et étiquettes de chaque langue.
  const scoresLangue = RX_LANGUES.map(({ l, mots, phrases }) => ({ l, s: (zone.match(mots) ?? []).length + 2 * new Set(zone.match(phrases) ?? []).size }))
    .sort((a, b) => b.s - a.s);
  const langue = scoresLangue[0].s > 0 && scoresLangue[0].s > scoresLangue[1].s ? scoresLangue[0].l : undefined;

  // Le type : les indices de chaque type (un mot compté une fois), plus les champs à remplir d'un formulaire.
  // Un mot contenu dans un autre mot trouvé (« agreement » et « this agreement », « facture » et « facture n° ») ne
  // compte qu'une fois : le plus long.
  const champsVides = lignes.filter((l) => RE_CHAMP_VIDE.test(l)).length;
  const dedans = (a: string[], b: string[]) => a.length > 0 && a.length <= b.length && b.some((_, j) => j + a.length <= b.length && a.every((w, x) => b[j + x] === w));
  const scores = RX_TYPES.map(({ t, forts, indices }) => {
    const f = trouves(forts), i = trouves(indices);
    for (const cle of f.keys()) i.delete(cle);
    const cles = [...f.keys(), ...i.keys()].map((k) => ({ k, w: k.match(/[\p{L}\p{N}]+/gu) ?? [] }));
    cles.forEach((c, n) => {
      if (cles.some((o, j) => j !== n && dedans(c.w, o.w) && (o.w.length > c.w.length || j < n))) { f.delete(c.k); i.delete(c.k); }
    });
    let s = 3 * f.size + i.size, nf = f.size;
    const mots = [...f.values(), ...i.values()].map((x) => `« ${x} »`);
    if (t === 'formulaire' && champsVides >= 3) { s += 3; nf++; mots.push(`${champsVides} champs à remplir`); }
    return { t, s, nf, n: nf + i.size, mots };
  }).sort((a, b) => b.s - a.s);
  const [p1, p2] = scores;
  let type: TypeDocument = 'inconnu', confiance: DocumentLu['confiance'] = 'inconnu';
  if (p1.s < 3) raisons.push(p1.s ? `trop peu d'indices (${p1.t} : ${p1.mots.join(', ')})` : 'aucun indice d\'un type de document connu');
  else if (p1.s === p2.s) raisons.push(`hésitation entre ${p1.t} (${p1.mots.join(', ')}) et ${p2.t} (${p2.mots.join(', ')})`);
  // Un type demande le nom du document (un mot fort) ET un autre indice : un mot seul (« ticket », « quote », « Re: »,
  // « CV ») peut parler d'autre chose.
  else if (!p1.nf || p1.n < 2) raisons.push(`trop peu d'indices (${p1.t} : ${p1.mots.join(', ')}) : il faut le nom du document et un autre indice`);
  else {
    type = p1.t;
    confiance = p1.s >= 6 && p1.s - p2.s >= 3 ? 'sûr' : 'probable';
    raisons.push(`${p1.t} : ${p1.mots.join(', ')}`);
    if (p2.s >= 3) raisons.push(`aussi des indices de ${p2.t} (${p2.mots.join(', ')})`);
  }
  // Un document qui donne des ordres : signalé, ses données restent des données, et la confiance n'est jamais « sûr ».
  const consignes = scanForInjection(texte).suspicious;
  if (consignes) {
    alertes.push('le document contient des consignes : ignorées, ce n\'est qu\'une donnée lue dehors');
    if (confiance === 'sûr') confiance = 'probable';
  }

  // Les données, ligne par ligne.
  const d = vide();
  const resumes: Record<'ht' | 'tva' | 'tvaTotal' | 'ttc' | 'total', MontantBrut[]> = { ht: [], tva: [], tvaTotal: [], ttc: [], total: [] };
  const articles: MontantBrut[] = [];
  /** Les montants d'avant le premier total qui ne sont ni une ligne simple ni un total (ligne à étiquette, date à rôle, sans texte). */
  const nonRanges: MontantBrut[] = [];
  const SORTES_MONTANT = [['ttc', RX.ttc], ['ht', RX.ht], ['tva', RX.tva], ['total', RX.total], ['hors', RX.horsLignes]] as const;
  let premierResume = -1;
  const refsVues = new Set<string>();
  lignes.forEach((ligne, k) => {
    if (!ligne.trim()) return;
    const { n, place } = formeAvecPlaces(ligne);
    const apres = (re: RegExp) => { const m = re.exec(n); return m ? ligne.slice(place[(m.index ?? 0) + m[0].length]) : undefined; };
    const dates = datesDeLigne(ligne);
    let etiquetee = false;
    for (const [champ, re] of [['emetteur', RX.emetteur], ['destinataire', RX.destinataire]] as const) {
      const reste = apres(re);
      if (reste === undefined) continue;
      etiquetee = true;
      if (d[champ]) continue;
      const suivante = reste.replace(/[\s:：\-–—]/g, '') ? undefined : lignes.slice(k + 1, k + 3).find((l) => l.trim());
      const v = valeurNom(reste) ?? (suivante === undefined ? undefined : valeurNom(suivante));
      if (v) d[champ] = v;
    }
    for (const { s, re } of RX.references) {
      const reste = apres(re);
      if (reste === undefined) continue;
      etiquetee = true;
      // Une valeur qui a la forme d'un IBAN ou d'une carte (même à la clé fausse, même écrite avec des espaces) : masquée.
      const debut = reste.replace(/^[\s:：#.\-–—]*(?:(?:n°|nº|no\.?|nr\.?|núm\.?|num\.?|number|numero|número|namba|رقم)\s*[:：.]?\s*)?/iu, '');
      const masquee = formeSecrete(debut, true);
      const v = masquee ? '[masqué]' : valeurReference(s, reste);
      if (!v) continue;
      const ou = ligne.length - reste.length + reste.indexOf(v);
      if (!masquee && dates.some((x) => ou < x.fin && x.index < ou + v.length)) continue;
      if (!refsVues.has(v) && d.references.length < 20) { refsVues.add(v); d.references.push({ sorte: s, valeur: v }); }
    }
    let depuis = 0, dateARole = false;
    for (const x of dates) {
      const avant = norm(ligne.slice(depuis, x.index));
      depuis = x.fin;
      let role: RoleDate = 'autre';
      for (const r of ['échéance', 'validité', 'voyage', 'émission'] as const) if (RX.dates[r].test(avant)) { role = r; break; }
      if (role === 'autre' && RX.generique.test(avant)) role = type === 'billet' || type === "carte d'embarquement" ? 'voyage' : 'émission';
      if (role !== 'autre') dateARole = true;
      if (d.dates.length < 50) d.dates.push({ role, ...(x.jour ? { jour: x.jour } : {}), ...(x.heure ? { heure: x.heure } : {}), texte: x.texte.trim(), ...(x.doute ? { doute: x.doute } : {}) });
    }
    const montants = montantsDeLigne(ligne, dates, langue);
    if (!montants.length) return;
    let sorte: (typeof SORTES_MONTANT)[number][0] | undefined, etiquette: RegExpExecArray | null = null;
    for (const [s, re] of SORTES_MONTANT) { etiquette = re.exec(n); if (etiquette) { sorte = s; break; } }
    if (sorte === 'hors') return;
    if (sorte && etiquette) {
      // Le montant qui suit l'étiquette (« Total TTC : 144,00 € (dont TVA 24,00 €) » : 144) ; sinon le dernier avant elle.
      const fin = place[etiquette.index + etiquette[0].length];
      const pris = montants.find((x) => x.i >= fin) ?? montants[montants.length - 1];
      // « Total TVA » est le total des lignes de TVA, pas une ligne de plus.
      resumes[sorte === 'tva' && RX.total.test(n) ? 'tvaTotal' : sorte].push(pris);
      if (premierResume < 0) premierResume = k;
      return;
    }
    if (premierResume >= 0) return; // après les totaux : mentions et pieds de page
    // Une ligne simple (du texte et un montant, une date sans rôle comme « 12/03/2026 Nuitée ») compte dans la somme ;
    // les autres montants d'avant le total sont gardés à part : la somme des lignes n'est alors pas vérifiée.
    const dernier = montants[montants.length - 1];
    if (!etiquetee && !dateARole && /\p{L}/u.test(ligne) && articles.length < 500) articles.push(dernier);
    else if (nonRanges.length < 500) nonRanges.push(dernier);
  });

  // Montants : une seule devise, sinon pas de contrôle.
  const tous = [...articles, ...nonRanges, ...resumes.ht, ...resumes.tva, ...resumes.tvaTotal, ...resumes.ttc, ...resumes.total];
  const devises = new Set(tous.map((x) => x.m.devise).filter((x): x is string => !!x));
  let totauxDouteux = false;
  const unique = (l: MontantBrut[], nom: string): MontantBrut | undefined => {
    if (l.length > 1 && l.some((x) => compare(x.r, l[0].r) !== 0)) {
      alertes.push(`plusieurs montants « ${nom} » différents : le premier est gardé, à vérifier`);
      totauxDouteux = true;
    }
    return l[0];
  };
  // La TVA : les lignes par taux additionnées ; une ligne « Total TVA » est leur total (et contrôlée contre elles).
  let tvaTaux: MontantBrut | undefined;
  if (resumes.tva.length) {
    const r = resumes.tva.reduce((acc, x) => plus(acc, x.r), rat(0n));
    tvaTaux = { m: { ...resumes.tva[0].m, texte: resumes.tva.map((x) => x.m.texte).join(' + '), valeur: decimalExact(r, 6)! }, r, i: 0 };
  }
  const tvaTotale = unique(resumes.tvaTotal, 'total de la TVA');
  const tva = tvaTotale ?? tvaTaux;
  const ht = unique(resumes.ht, 'hors taxes'), ttc = unique(resumes.ttc, 'toutes taxes comprises'), total = unique(resumes.total, 'total');
  const final = ttc ?? total;
  const m = d.montants;
  if (devises.size === 1) m.devise = [...devises][0];
  if (type === 'facture' || type === 'devis') m.lignes = articles.map((x) => x.m);
  if (ht) m.ht = ht.m;
  if (tva) m.tva = tva.m;
  if (ttc) m.ttc = ttc.m;
  if (total) m.total = total.m;
  /** Vrai seulement quand le total a été recompté depuis toutes ses lignes, et qu'il tombe juste. */
  let sommeVerifiee = false;
  if (devises.size > 1) alertes.push(`plusieurs devises (${[...devises].join(', ')}) : aucun total contrôlé`);
  else {
    const controler = (quoi: string, calcule: Rationnel, ecrit: MontantBrut): boolean => {
      const juste = compare(calcule, ecrit.r) === 0, c = decimalExact(calcule, 6)!;
      const ctl: ControleMontant = { quoi, juste, calcule: c, ecrit: ecrit.m.valeur };
      if (!juste) {
        ctl.ecart = decimalExact(moins(ecrit.r, calcule), 6)!.replace(/^-/, '');
        alertes.push(`le montant écrit (${ecrit.m.texte}) ne correspond pas à ${quoi} (${c}) : écart de ${ctl.ecart}, à vérifier ; rien n'a été corrigé`);
      }
      m.controles.push(ctl);
      return juste;
    };
    if (tvaTotale && tvaTaux) controler('la somme des lignes de TVA', tvaTaux.r, tvaTotale);
    const recompte = ht ?? final;
    if ((type === 'facture' || type === 'devis') && recompte) {
      // Sans lignes, ou avec des montants qui ne sont pas des lignes simples : le total n'est pas vérifié, et c'est dit.
      if (!articles.length) alertes.push(`le total (${recompte.m.texte}) n'a pas été vérifié : aucune ligne de montant avant lui, à vérifier`);
      else if (nonRanges.length) alertes.push(`la somme des lignes n'a pas été vérifiée : ${nonRanges.length} montant(s) avant le total ne sont pas des lignes simples (${nonRanges.slice(0, 3).map((x) => x.m.texte).join(', ')}), à vérifier`);
      else {
        const somme = articles.reduce((acc, x) => plus(acc, x.r), rat(0n));
        if (ht) sommeVerifiee = controler('la somme des lignes', somme, ht);
        else if (final && tva && compare(somme, final.r) !== 0) sommeVerifiee = controler('la somme des lignes plus la TVA', plus(somme, tva.r), final);
        else if (final) sommeVerifiee = controler('la somme des lignes', somme, final);
      }
    }
    if (ht && tva && final) controler('le hors taxes plus la TVA', plus(ht.r, tva.r), final);
  }
  for (const x of tous) if (x.m.aVerifier && !alertes.includes(`${x.m.texte} : ${x.m.aVerifier}`)) alertes.push(`${x.m.texte} : ${x.m.aVerifier}`);

  // Rien à payer : une facture qui se dit déjà réglée (en tout ou en partie) ou qui est un avoir, un total nul ou négatif.
  const regle = type === 'facture' ? trouves(RX.regle) : new Map<string, string>();
  if (regle.size) alertes.push(`le document dit qu'il est déjà réglé, en tout ou en partie, ou que c'est un avoir (${[...regle.values()].map((x) => `« ${x} »`).join(', ')}) : aucun paiement proposé`);
  const negatif = type === 'facture' && final !== undefined && compare(final.r, rat(0n)) <= 0;
  if (negatif && final) alertes.push(`total négatif ou nul (${final.m.texte}) : un avoir ou un remboursement ? aucun paiement proposé`);
  // Langue inconnue et un séparateur qui en dépend : le montant n'est pas sûr.
  const lectureSure = langue !== undefined || !tous.some((x) => x.m.aVerifier);

  // IBAN et cartes : vérifiés par leur clé (secrets-entrants.ts), rendus masqués ; aucun secret ne sort en clair.
  const secrets = trierSecrets(texte).secrets;
  for (const s of secrets) {
    if (s.champ === 'IBAN' && !d.iban.includes(masque(s.valeur))) d.iban.push(masque(s.valeur));
    if (s.champ === 'carte bancaire' && !d.cartes.includes(masque(s.valeur))) d.cartes.push(masque(s.valeur));
  }
  const sansSecret = (v: string) => (secrets.some((s) => s.valeur.length >= 4 && v.includes(s.valeur)) || formeSecrete(v) ? '[masqué]' : v);
  if (d.emetteur) d.emetteur = sansSecret(d.emetteur);
  if (d.destinataire) d.destinataire = sansSecret(d.destinataire);
  d.references = d.references.map((r) => ({ ...r, valeur: sansSecret(r.valeur) }));

  // Billet, carte d'embarquement : la réservation, par le lecteur des réservations (texte seulement, rien n'est suivi).
  if (type === 'billet' || type === "carte d'embarquement") {
    const r = reservationsDuCourriel({ id: 'document déposé', from: '', subject: '', text: texte, pieces: [] })[0];
    if (r) {
      const raisonsR = r.raisons.filter((x) => !/expéditeur non authentifié/.test(x));
      d.reservation = {
        type: r.type, ...(r.qui ? { qui: sansSecret(r.qui) } : {}), ...(r.depart ? { depart: r.depart } : {}), ...(r.arrivee ? { arrivee: r.arrivee } : {}),
        ...(r.debut ? { debut: r.debut } : {}), ...(r.fin ? { fin: r.fin } : {}), ...(r.numero ? { numero: sansSecret(r.numero) } : {}), ...(r.prix ? { prix: r.prix } : {}),
        statut: raisonsR.length ? 'à vérifier' : 'lu', raisons: raisonsR,
      };
    }
  }

  // Les boutons : la liste fermée, selon le type et le format donné par l'appelant ; rien ne vient du document.
  // « Préparer le paiement » : seulement sur une facture dont le total, positif, a été recompté juste depuis ses lignes,
  // sans consigne, sans mention « réglé », sans total en double ni lecture douteuse ; il reste à valider par le propriétaire.
  const ids: IdBouton[] = [o.format === 'word' ? 'convertir-pdf' : 'convertir-word'];
  if (type !== 'inconnu') {
    if (TYPES_TABLEAU.includes(type)) ids.push('extraire-tableau');
    if (d.dates.some((x) => x.role === 'échéance' && x.jour)) ids.push('ajouter-echeance');
    if (type === 'facture' && final && !negatif && !regle.size && !consignes && sommeVerifiee && m.controles.every((c) => c.juste)
      && !totauxDouteux && devises.size <= 1 && lectureSure) ids.push('preparer-paiement');
  }
  const libelles = LANGUES_DOCUMENTS[(o.langue !== undefined ? langueCouverte(o.langue) : undefined) ?? langue ?? 'fr'].boutons;
  const boutons = ids.map((id): BoutonDocument => (id === 'preparer-paiement'
    ? { id, libelle: libelles[id], engageant: true, validation: 'propriétaire' }
    : { id, libelle: libelles[id], engageant: false }));

  return { type, confiance, ...(langue ? { langue } : {}), raisons, alertes, donnees: d, boutons, origine: 'lu dehors' };
}
