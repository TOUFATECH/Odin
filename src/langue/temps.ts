// Dates relatives et absolues, durées, jours ouvrés, âge : calculés en règles (calendrier grégorien), sans service en
// ligne ni modèle, en français, anglais, espagnol, allemand, arabe et swahili. Deuxième brique de la « réponse directe »
// avec nombres.ts et calcul.ts : même forme de résultat que temps-fuseaux.ts (direct, points, pasSur, conseils, calcul,
// donnees), en DONNÉES ; le branchement dans la conversation vient ensuite, ailleurs.
//  - « Aujourd'hui » est le jour au mur du fuseau d'ici (donné par l'appelant) ; sans fuseau, le temps universel, et c'est dit.
//  - Une ambiguïté est DITE, jamais tranchée en silence : « 03/04 » (jour/mois ou mois/jour), « mardi » sans « prochain »
//    (le prochain est pris, le dernier est proposé), « samedi prochain » dit dans la même semaine, une année non écrite,
//    un 31 + 1 mois (ramené au dernier jour du mois).
//  - Jours ouvrés : du lundi au vendredi par défaut (réglable), les deux dates comprises ; les jours fériés ne sont PAS
//    retirés (aucun calendrier de fêtes ici), et c'est dit.
//  - Bornes : années 1583 à 9999, phrases de 500 caractères au plus.
// Pur : aucune lecture de fichier, aucune horloge (l'instant « maintenant » est passé par l'appelant).

import {
  chiffresLatins, choisirLangue, jetons, lireChiffres, lireNombreMots, norm, remplir, sansPrefixesAr, LANGUES_CALCUL, LONGUEUR_MAX,
  type ConseilCalcul, type Jeton, type Langue, type ReponseCalculee,
} from './nombres.ts';

// ---------------------------------------------------------------------------------------------------------------
// Les dates civiles (« AAAA-MM-JJ »), sans fuseau

export const ANNEE_MIN = 1583, ANNEE_MAX = 9999;
const JOUR_MS = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, '0');
function versJours(iso: string): number {
  const [a, m, j] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, j) / JOUR_MS;
}
function depuisJours(n: number): string {
  const d = new Date(n * JOUR_MS);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
const bissextile = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const joursDuMois = (a: number, m: number) => [31, bissextile(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** Vrai si la date existe et tient dans les bornes. */
export function dateValide(a: number, m: number, j: number): boolean {
  return Number.isInteger(a) && Number.isInteger(m) && Number.isInteger(j) && a >= ANNEE_MIN && a <= ANNEE_MAX && m >= 1 && m <= 12 && j >= 1 && j <= joursDuMois(a, m);
}
const isoDe = (a: number, m: number, j: number) => `${String(a).padStart(4, '0')}-${p2(m)}-${p2(j)}`;
const anneeDe = (iso: string) => Number(iso.slice(0, 4));
const dansBornes = (iso: string) => { const a = anneeDe(iso); return a >= ANNEE_MIN && a <= ANNEE_MAX; };

/** Le nombre de jours de `a` à `b` (positif si `b` est après). */
export const joursEntre = (a: string, b: string) => versJours(b) - versJours(a);
/** Le jour de la semaine (0 = dimanche … 6 = samedi). */
export const jourSemaine = (iso: string) => new Date(versJours(iso) * JOUR_MS).getUTCDay();
export const ajouterJours = (iso: string, n: number) => depuisJours(versJours(iso) + n);
/** Ajoute des mois ; un jour qui n'existe pas dans le mois d'arrivée devient le dernier du mois (`borne` vrai). */
export function ajouterMois(iso: string, n: number): { date: string; borne: boolean } {
  const [a, m, j] = iso.split('-').map(Number);
  const t = a * 12 + (m - 1) + n, na = Math.floor(t / 12), nm = (t % 12) + 1;
  const max = joursDuMois(na, nm);
  return { date: isoDe(na, nm, Math.min(j, max)), borne: j > max };
}
/** Les jours ouvrés de `a` à `b`, les deux comprises ; `weekend` : les jours retirés (0 = dimanche), samedi et dimanche par défaut. */
export function joursOuvres(a: string, b: string, weekend: number[] = [6, 0]): number {
  let x = versJours(a), y = versJours(b);
  if (x > y) [x, y] = [y, x];
  const we = new Set(weekend.filter((k) => Number.isInteger(k) && k >= 0 && k <= 6));
  const total = y - x + 1, semaines = Math.floor(total / 7);
  let n = semaines * (7 - we.size);
  for (let k = x + semaines * 7; k <= y; k++) if (!we.has(new Date(k * JOUR_MS).getUTCDay())) n++;
  return n;
}
/** L'âge le jour `jour` d'une personne née le `naissance` ; `undefined` si la naissance est après. */
export function age(naissance: string, jour: string): { ans: number; mois: number; jours: number } | undefined {
  if (versJours(naissance) > versJours(jour)) return undefined;
  let ans = anneeDe(jour) - anneeDe(naissance);
  if (versJours(ajouterMois(naissance, 12 * ans).date) > versJours(jour)) ans--;
  let mois = 0;
  while (mois < 12 && versJours(ajouterMois(naissance, 12 * ans + mois + 1).date) <= versJours(jour)) mois++;
  return { ans, mois, jours: joursEntre(ajouterMois(naissance, 12 * ans + mois).date, jour) };
}
const lundiDe = (iso: string) => ajouterJours(iso, -((jourSemaine(iso) + 6) % 7));

/** Le jour (AAAA-MM-JJ) d'un instant au mur d'un fuseau ; `undefined` si le fuseau est inconnu. */
function jourAuMur(t: number, fuseau: string): { date: string; heure: string } | undefined {
  try {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t)) p[x.type] = x.value;
    return { date: isoDe(Number(p.year), Number(p.month), Number(p.day)), heure: `${p2(Number(p.hour) % 24)}:${p2(Number(p.minute))}` };
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------------------------------------------
// Les mots, par langue (forme de comparaison)

const L = (s: string) => s.split(',').map((x) => norm(x.trim())).filter(Boolean);
/** Les jours de la semaine, du dimanche au samedi. */
const JOURS: Record<Langue, string[][]> = {
  fr: [L('dimanche'), L('lundi'), L('mardi'), L('mercredi'), L('jeudi'), L('vendredi'), L('samedi')],
  en: [L('sunday'), L('monday'), L('tuesday'), L('wednesday'), L('thursday'), L('friday'), L('saturday')],
  es: [L('domingo'), L('lunes'), L('martes'), L('miércoles'), L('jueves'), L('viernes'), L('sábado')],
  de: [L('sonntag'), L('montag'), L('dienstag'), L('mittwoch'), L('donnerstag'), L('freitag'), L('samstag,sonnabend')],
  ar: [L('الأحد'), L('الاثنين,الإثنين'), L('الثلاثاء'), L('الأربعاء'), L('الخميس'), L('الجمعة'), L('السبت')],
  sw: [L('jumapili'), L('jumatatu'), L('jumanne'), L('jumatano'), L('alhamisi'), L('ijumaa'), L('jumamosi')],
};
/** Les mois, de janvier à décembre. */
const MOIS: Record<Langue, string[][]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].map((x) => L(x)),
  en: ['january,jan', 'february,feb', 'march,mar', 'april,apr', 'may', 'june,jun', 'july,jul', 'august,aug', 'september,sep,sept', 'october,oct', 'november,nov', 'december,dec'].map((x) => L(x)),
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre,setiembre', 'octubre', 'noviembre', 'diciembre'].map((x) => L(x)),
  de: ['januar,jänner', 'februar,feber', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'].map((x) => L(x)),
  ar: ['يناير,جانفي,كانون الثاني', 'فبراير,فيفري,شباط', 'مارس,آذار', 'أبريل,إبريل,أفريل,نيسان', 'مايو,ماي,أيار', 'يونيو,يونيه,جوان,حزيران', 'يوليو,يوليه,جويلية,تموز', 'أغسطس,أوت,آب', 'سبتمبر,أيلول', 'أكتوبر,تشرين الأول', 'نوفمبر,تشرين الثاني', 'ديسمبر,كانون الأول'].map((x) => L(x)),
  sw: ['januari', 'februari', 'machi', 'aprili', 'mei', 'juni', 'julai', 'agosti', 'septemba', 'oktoba', 'novemba', 'desemba'].map((x) => L(x)),
};
/** Les jours nommés par rapport à aujourd'hui. */
const RELATIFS: Record<Langue, Array<[string, number]>> = {
  fr: [["aujourd'hui", 0], ['demain', 1], ['après-demain', 2], ['après demain', 2], ['hier', -1], ['avant-hier', -2], ['avant hier', -2]],
  en: [['today', 0], ['tomorrow', 1], ['day after tomorrow', 2], ['yesterday', -1], ['day before yesterday', -2]],
  es: [['hoy', 0], ['esta mañana', 0], ['mañana', 1], ['pasado mañana', 2], ['ayer', -1], ['anteayer', -2], ['antes de ayer', -2]],
  de: [['heute', 0], ['heute morgen', 0], ['morgen', 1], ['übermorgen', 2], ['gestern', -1], ['vorgestern', -2]],
  ar: [['اليوم', 0], ['غداً', 1], ['غدا', 1], ['بكرة', 1], ['بعد غد', 2], ['بعد الغد', 2], ['أمس', -1], ['البارحة', -1], ['أول أمس', -2], ['قبل أمس', -2]],
  sw: [['leo', 0], ['kesho', 1], ['keshokutwa', 2], ['jana', -1], ['juzi', -2]],
};
type UniteT = 'j' | 'sem' | 'mois' | 'an' | 'h' | 'min';
/** Les unités de durée ; un nombre après le signe « = 2 » est le duel arabe (« أسبوعين » : deux semaines). */
const UNITES_T: Record<Langue, Array<[string, UniteT, number?]>> = {
  fr: [['jour', 'j'], ['jours', 'j'], ['semaine', 'sem'], ['semaines', 'sem'], ['mois', 'mois'], ['an', 'an'], ['ans', 'an'], ['année', 'an'], ['années', 'an'], ['heure', 'h'], ['heures', 'h'], ['minute', 'min'], ['minutes', 'min']],
  en: [['day', 'j'], ['days', 'j'], ['week', 'sem'], ['weeks', 'sem'], ['month', 'mois'], ['months', 'mois'], ['year', 'an'], ['years', 'an'], ['hour', 'h'], ['hours', 'h'], ['minute', 'min'], ['minutes', 'min']],
  es: [['día', 'j'], ['días', 'j'], ['semana', 'sem'], ['semanas', 'sem'], ['mes', 'mois'], ['meses', 'mois'], ['año', 'an'], ['años', 'an'], ['hora', 'h'], ['horas', 'h'], ['minuto', 'min'], ['minutos', 'min']],
  de: [['tag', 'j'], ['tage', 'j'], ['tagen', 'j'], ['woche', 'sem'], ['wochen', 'sem'], ['monat', 'mois'], ['monate', 'mois'], ['monaten', 'mois'], ['jahr', 'an'], ['jahre', 'an'], ['jahren', 'an'], ['stunde', 'h'], ['stunden', 'h'], ['minute', 'min'], ['minuten', 'min']],
  ar: [['يوم', 'j'], ['أيام', 'j'], ['يوما', 'j'], ['يومين', 'j', 2], ['أسبوع', 'sem'], ['أسابيع', 'sem'], ['أسبوعا', 'sem'], ['أسبوعين', 'sem', 2], ['شهر', 'mois'], ['أشهر', 'mois'], ['شهور', 'mois'], ['شهرا', 'mois'], ['شهرين', 'mois', 2],
    ['سنة', 'an'], ['سنوات', 'an'], ['سنين', 'an'], ['عام', 'an'], ['أعوام', 'an'], ['عاما', 'an'], ['سنتين', 'an', 2], ['عامين', 'an', 2], ['ساعة', 'h'], ['ساعات', 'h'], ['ساعتين', 'h', 2], ['دقيقة', 'min'], ['دقائق', 'min'], ['دقيقتين', 'min', 2]],
  sw: [['siku', 'j'], ['wiki', 'sem'], ['mwezi', 'mois'], ['miezi', 'mois'], ['mwaka', 'an'], ['miaka', 'an'], ['saa', 'h'], ['dakika', 'min']],
};
const N = (o: Record<Langue, string>) => Object.fromEntries(LANGUES_CALCUL.map((l) => [l, L(o[l])])) as Record<Langue, string[]>;
const FUTUR_AVANT = N({ fr: 'dans', en: 'in', es: 'dentro de,en', de: 'in', ar: 'بعد', sw: 'baada ya' });
const PASSE_AVANT = N({ fr: 'il y a', en: '', es: 'hace', de: 'vor', ar: 'قبل', sw: '' });
const FUTUR_APRES = N({ fr: 'plus tard', en: 'from now,from today,later', es: 'después', de: 'später', ar: 'من الآن', sw: 'zijazo,ijayo,ujao' });
const PASSE_APRES = N({ fr: '', en: 'ago', es: '', de: '', ar: '', sw: 'zilizopita,iliyopita,uliopita,yaliyopita' });
const PROCHAIN = N({ fr: 'prochain,prochaine', en: 'next,coming', es: 'próximo,próxima,que viene,siguiente', de: 'nächsten,nächster,nächste,kommenden,kommender,kommende', ar: 'القادم,المقبل,القادمة,المقبلة,الجاي', sw: 'ijayo,ujao,inayokuja' });
const DERNIER = N({ fr: 'dernier,dernière,passé,passée', en: 'last,past,previous', es: 'pasado,pasada,último,última', de: 'letzten,letzter,letzte,vergangenen,vergangener', ar: 'الماضي,الماضية,الفائت,السابق', sw: 'iliyopita,uliopita' });
const AGE = N({ fr: 'âge,age', en: 'old,age', es: 'edad', de: 'alter,alt', ar: 'عمر,العمر,عمري,عمره,عمرها', sw: 'umri' });
const NAISSANCE = N({ fr: 'né,née,nés,nées,naissance', en: 'born,birth,birthday', es: 'nacido,nacida,nacimiento,nací', de: 'geboren,geburt,geburtstag', ar: 'ولد,ولدت,مولود,مواليد,الميلاد', sw: 'alizaliwa,nilizaliwa,amezaliwa,kuzaliwa' });
const ENTRE = N({ fr: 'entre,du,depuis', en: 'between,from', es: 'entre,del,desde', de: 'zwischen,vom,von', ar: 'بين,من', sw: 'kati,kutoka' });
const JUSQUA = N({ fr: "jusqu',jusqu'à,jusqu'au,avant", en: 'until,till,before', es: 'faltan,hasta,para', de: 'bis', ar: 'حتى,إلى,الى', sw: 'hadi,mpaka' });
const OUVRES = N({ fr: 'ouvrés,ouvres,ouvrables', en: 'working,business,workdays,weekdays', es: 'hábiles,habiles,laborables', de: 'werktage,arbeitstage,werktagen,arbeitstagen', ar: 'أيام عمل,أيام العمل', sw: 'siku za kazi' });
const QUESTION = N({ fr: 'quel,quelle,combien,tombe,date,jour', en: 'what,which,how,many,date', es: 'qué,cuántos,cuántas,cae,fecha', de: 'welcher,welches,wie,viele,datum,fällt', ar: 'كم,أي,ما,تاريخ', sw: 'ngapi,gani,tarehe' });
const SAUTER_AVANT_JOUR = new Set(L('er,re,e,eme,ème,st,nd,rd,th,.,de,of,the,el,le,der,den,am,tarehe'));
const SAUTER_AVANT_ANNEE = new Set([',', 'de', 'del', 'of', '.']);
/** Les mots qui lient les parties d'une durée (« 3 semaines et 2 jours ») ; en arabe, « و » peut aussi être collé. */
const LIENS = N({ fr: 'et', en: 'and', es: 'y,e', de: 'und', ar: 'و', sw: 'na' });
/** « Et demi » : une durée avec une moitié n'est pas calculée (pas devinée). */
const DEMI = N({ fr: 'demi,demie', en: 'half', es: 'medio,media', de: 'halb,halbe,halben,anderthalb,eineinhalb', ar: 'نصف,ونصف,والنصف', sw: 'nusu' });
/** Après « vendredi 13 », ces mots font du nombre une heure (« vendredi 13 h »), pas un jour du mois. */
const HEURE_APRES = new Set(L('h,heure,heures,hour,hours,hrs,uhr,hora,horas,am,pm,saa,ساعة,:'));
/** « combien », « how many », « cuántos », « wie viele », « كم », « ngapi ». */
const COMBIEN = N({ fr: 'combien', en: 'many', es: 'cuántos,cuántas', de: 'viele', ar: 'كم', sw: 'ngapi' });

let MOTS: Record<Langue, Set<string>> | undefined;
function motsLangue(): Record<Langue, Set<string>> {
  if (MOTS) return MOTS;
  const m = {} as Record<Langue, Set<string>>;
  for (const l of LANGUES_CALCUL) {
    m[l] = new Set([
      ...JOURS[l].flat(), ...MOIS[l].flat(), ...RELATIFS[l].map(([x]) => norm(x)), ...UNITES_T[l].map(([x]) => norm(x)),
      ...FUTUR_AVANT[l], ...PASSE_AVANT[l], ...FUTUR_APRES[l], ...PASSE_APRES[l], ...PROCHAIN[l], ...DERNIER[l],
      ...AGE[l], ...NAISSANCE[l], ...ENTRE[l], ...JUSQUA[l], ...OUVRES[l], ...QUESTION[l],
    ]);
  }
  return (MOTS = m);
}

// ---------------------------------------------------------------------------------------------------------------
// Les textes

interface Textes {
  estLe: string; tombe: string; jusqua: string; entre: string; ouvres: string; age: string; aujourdhui: string;
  autre: string; anneeSupposee: string; deuxChiffres: string; sansFuseau: string; finDeMois: string; feries: string;
  werktage: string; ouvrables: string; vingtNeuf: string; gregorien: string; hors: string; futur: string;
  calcul: string; calendrier: string; rappel: string; contraire: string; prochainAvec: string;
}
const TEXTES: Record<Langue, Textes> = {
  fr: {
    estLe: "C'est le {date}.", tombe: 'Le {date} tombe un {jour}.', jusqua: '{date} : {rel}.', entre: 'Du {a} au {b} : {duree}.',
    ouvres: 'Jours ouvrés du {a} au {b} : {n} ({we} exclus).', age: "Âge aujourd'hui : {duree}.", aujourdhui: "Aujourd'hui : {date}.",
    autre: '« {expr} » peut aussi vouloir dire le {date}.', anneeSupposee: "Année non écrite : j'ai pris {annee}.",
    deuxChiffres: "Année écrite en deux chiffres : j'ai pris {annee}.", sansFuseau: "Fuseau d'ici inconnu : « aujourd'hui » est compté en temps universel (UTC).",
    finDeMois: "Le jour d'arrivée n'existe pas ce mois-là : j'ai pris le dernier jour du mois ({date}).",
    feries: 'Les deux dates sont comptées ; les jours fériés ne sont pas retirés.',
    werktage: '', ouvrables: 'Les jours ouvrables comptent souvent aussi le samedi ; ici, seuls les jours ouvrés sont comptés.',
    vingtNeuf: "Naissance un 29 février : les années non bissextiles, l'anniversaire est compté le 28 février.",
    gregorien: '', hors: 'Date hors des bornes (années {min} à {max}) : pas de calcul.', futur: 'Cette date de naissance est après aujourd\'hui.',
    calcul: 'Calculé par Odin, en règles (calendrier grégorien).', calendrier: 'Ajouter au calendrier', rappel: 'Créer un rappel',
    contraire: '« {jour} » ne correspond pas : le {date} tombe un {vrai}.', prochainAvec: "J'ai pris le prochain « {expr} » : le {date}.",
  },
  en: {
    estLe: 'That is {date}.', tombe: '{date} is a {jour}.', jusqua: '{date}: {rel}.', entre: 'From {a} to {b}: {duree}.',
    ouvres: 'Working days from {a} to {b}: {n} ({we} excluded).', age: 'Age today: {duree}.', aujourdhui: 'Today: {date}.',
    autre: '“{expr}” may also mean {date}.', anneeSupposee: 'No year written: I took {annee}.',
    deuxChiffres: 'Two-digit year: I took {annee}.', sansFuseau: 'Local time zone unknown: “today” is counted in universal time (UTC).',
    finDeMois: 'That day does not exist in the target month: I took the last day of the month ({date}).',
    feries: 'Both dates are counted; public holidays are not removed.', werktage: '', ouvrables: '',
    vingtNeuf: 'Born on 29 February: in non-leap years the birthday is counted on 28 February.',
    gregorien: '', hors: 'Date out of range (years {min} to {max}): not calculated.', futur: 'This birth date is after today.',
    calcul: 'Calculated by Odin, with rules (Gregorian calendar).', calendrier: 'Add to calendar', rappel: 'Create a reminder',
    contraire: '“{jour}” does not match: {date} is a {vrai}.', prochainAvec: 'I took the next “{expr}”: {date}.',
  },
  es: {
    estLe: 'Es el {date}.', tombe: 'El {date} cae en {jour}.', jusqua: '{date}: {rel}.', entre: 'Del {a} al {b}: {duree}.',
    ouvres: 'Días hábiles del {a} al {b}: {n} (sin {we}).', age: 'Edad hoy: {duree}.', aujourdhui: 'Hoy: {date}.',
    autre: '«{expr}» también puede significar el {date}.', anneeSupposee: 'Sin año escrito: tomé {annee}.',
    deuxChiffres: 'Año escrito con dos cifras: tomé {annee}.', sansFuseau: 'Zona horaria local desconocida: «hoy» se cuenta en tiempo universal (UTC).',
    finDeMois: 'Ese día no existe en el mes de llegada: tomé el último día del mes ({date}).',
    feries: 'Se cuentan las dos fechas; no se restan los días festivos.', werktage: '', ouvrables: '',
    vingtNeuf: 'Nacimiento un 29 de febrero: en los años no bisiestos, el cumpleaños se cuenta el 28 de febrero.',
    gregorien: '', hors: 'Fecha fuera de los límites (años {min} a {max}): no se calcula.', futur: 'Esta fecha de nacimiento es posterior a hoy.',
    calcul: 'Calculado por Odin, con reglas (calendario gregoriano).', calendrier: 'Añadir al calendario', rappel: 'Crear un recordatorio',
    contraire: '«{jour}» no coincide: el {date} cae en {vrai}.', prochainAvec: 'Tomé el próximo «{expr}»: el {date}.',
  },
  de: {
    estLe: 'Das ist {date}.', tombe: 'Der {date} ist ein {jour}.', jusqua: '{date}: {rel}.', entre: 'Vom {a} bis {b}: {duree}.',
    ouvres: 'Arbeitstage vom {a} bis {b}: {n} (ohne {we}).', age: 'Alter heute: {duree}.', aujourdhui: 'Heute: {date}.',
    autre: '„{expr}“ kann auch {date} bedeuten.', anneeSupposee: 'Kein Jahr angegeben: Ich habe {annee} genommen.',
    deuxChiffres: 'Jahr mit zwei Ziffern: Ich habe {annee} genommen.', sansFuseau: 'Lokale Zeitzone unbekannt: „heute“ wird in Weltzeit (UTC) gezählt.',
    finDeMois: 'Diesen Tag gibt es im Zielmonat nicht: Ich habe den letzten Tag des Monats genommen ({date}).',
    feries: 'Beide Daten werden mitgezählt; Feiertage werden nicht abgezogen.',
    werktage: '„Werktage“ schließen oft auch den Samstag ein; gezählt sind hier nur Montag bis Freitag.', ouvrables: '',
    vingtNeuf: 'Geboren am 29. Februar: In Nicht-Schaltjahren wird der Geburtstag am 28. Februar gezählt.',
    gregorien: '', hors: 'Datum außerhalb der Grenzen (Jahre {min} bis {max}): nicht berechnet.', futur: 'Dieses Geburtsdatum liegt nach heute.',
    calcul: 'Von Odin berechnet, mit Regeln (gregorianischer Kalender).', calendrier: 'Zum Kalender hinzufügen', rappel: 'Erinnerung erstellen',
    contraire: '„{jour}“ passt nicht: Der {date} ist ein {vrai}.', prochainAvec: 'Genommen: der nächste „{expr}“, {date}.',
  },
  ar: {
    estLe: 'إنه {date}.', tombe: 'يوافق {date} يوم {jour}.', jusqua: '{date}: {rel}.', entre: 'من {a} إلى {b}: {duree}.',
    ouvres: 'أيام العمل من {a} إلى {b}: {n} (باستثناء {we}).', age: 'العمر اليوم: {duree}.', aujourdhui: 'اليوم: {date}.',
    autre: 'قد تعني «{expr}» أيضًا {date}.', anneeSupposee: 'لم تُكتب السنة: اعتمدت {annee}.',
    deuxChiffres: 'سنة مكتوبة برقمين: اعتمدت {annee}.', sansFuseau: 'المنطقة الزمنية المحلية غير معروفة: «اليوم» محسوب بالتوقيت العالمي (UTC).',
    finDeMois: 'هذا اليوم غير موجود في الشهر المطلوب: اعتمدت آخر يوم في الشهر ({date}).',
    feries: 'التاريخان محسوبان؛ العطل الرسمية غير مستبعدة.', werktage: '', ouvrables: '',
    vingtNeuf: 'ولادة في 29 فبراير: في السنوات غير الكبيسة يُحسب عيد الميلاد في 28 فبراير.',
    gregorien: 'التواريخ بالتقويم الميلادي (الغريغوري)، لا بالتقويم الهجري.', hors: 'التاريخ خارج الحدود (السنوات {min} إلى {max}): لا حساب.', futur: 'تاريخ الميلاد هذا بعد اليوم.',
    calcul: 'حسبه Odin بالقواعد (التقويم الميلادي).', calendrier: 'إضافة إلى التقويم', rappel: 'إنشاء تذكير',
    contraire: '«{jour}» لا يوافق: {date} يوافق يوم {vrai}.', prochainAvec: 'اعتمدت أقرب «{expr}» قادم: {date}.',
  },
  sw: {
    estLe: 'Ni {date}.', tombe: '{date} ni siku ya {jour}.', jusqua: '{date}: {rel}.', entre: 'Kuanzia {a} hadi {b}: {duree}.',
    ouvres: 'Siku za kazi kuanzia {a} hadi {b}: {n} (bila {we}).', age: 'Umri leo: {duree}.', aujourdhui: 'Leo: {date}.',
    autre: '“{expr}” inaweza pia kumaanisha {date}.', anneeSupposee: 'Mwaka haukuandikwa: nimechukua {annee}.',
    deuxChiffres: 'Mwaka umeandikwa kwa tarakimu mbili: nimechukua {annee}.', sansFuseau: 'Saa za eneo hili hazijulikani: “leo” imehesabiwa kwa saa ya dunia (UTC).',
    finDeMois: 'Siku hiyo haipo katika mwezi huo: nimechukua siku ya mwisho ya mwezi ({date}).',
    feries: 'Tarehe zote mbili zimehesabiwa; sikukuu za umma hazijaondolewa.', werktage: '', ouvrables: '',
    vingtNeuf: 'Kuzaliwa tarehe 29 Februari: katika miaka isiyo mirefu, siku ya kuzaliwa huhesabiwa tarehe 28 Februari.',
    gregorien: '', hors: 'Tarehe iko nje ya mipaka (miaka {min} hadi {max}): haijakokotolewa.', futur: 'Tarehe hii ya kuzaliwa ni baada ya leo.',
    calcul: 'Imekokotolewa na Odin, kwa kanuni (kalenda ya Gregori).', calendrier: 'Ongeza kwenye kalenda', rappel: 'Weka kikumbusho',
    contraire: '“{jour}” hailingani: {date} ni siku ya {vrai}.', prochainAvec: 'Nimechukua “{expr}” inayofuata: {date}.',
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Mise en forme (par Intl, dans la langue)

const ms = (iso: string) => versJours(iso) * JOUR_MS;
const dateLongue = (iso: string, l: Langue) => new Intl.DateTimeFormat(l, { dateStyle: 'full', timeZone: 'UTC' }).format(ms(iso));
const dateCourte = (iso: string, l: Langue) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(ms(iso));
const nomJour = (iso: string, l: Langue) => new Intl.DateTimeFormat(l, { weekday: 'long', timeZone: 'UTC' }).format(ms(iso));
const enJours = (n: number, l: Langue) => new Intl.NumberFormat(l, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(n);
const relatif = (n: number, l: Langue) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }).format(n, 'day');
function enDuree(o: { years?: number; months?: number; days?: number }, l: Langue): string {
  const DF = (Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format(d: object): string } }).DurationFormat;
  const propre = Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, number>;
  if (!Object.keys(propre).length) propre.days = 0;
  if (DF) { try { return new DF(l, { style: 'long' }).format(propre); } catch { /* repli ci-dessous */ } }
  const u: Record<string, string> = { years: 'year', months: 'month', days: 'day' };
  return Object.entries(propre).map(([k, v]) => new Intl.NumberFormat(l, { style: 'unit', unit: u[k], unitDisplay: 'long' }).format(v)).join(', ');
}

// ---------------------------------------------------------------------------------------------------------------
// Lire les dates écrites dans la phrase

interface DateLue { iso: string; debut: number; fin: number; brut: string; autre?: string; anneeSupposee?: number; deuxChiffres?: number }

/** Les mots d'une liste qui commencent au jeton `i` (le plus long), en nombre de jetons ; 0 si aucun. */
function egalA(js: Jeton[], i: number, liste: string[]): number {
  let best = 0;
  for (const x of liste) {
    const w = x.split(' ');
    if (w.length > best && w.every((m, k) => js[i + k] && js[i + k].n === m)) best = w.length;
  }
  if (!best && js[i]?.sorte === 'mot' && sansPrefixesAr(js[i].n).some((x) => liste.includes(x))) best = 1;
  return best;
}
const contientMot = (js: Jeton[], liste: string[]) => js.some((_, i) => egalA(js, i, liste) > 0);

function anneeDeuxChiffres(yy: number, aujourdhui: string): number {
  const a = anneeDe(aujourdhui), siecle = Math.floor(a / 100) * 100;
  return siecle + yy <= a + 20 ? siecle + yy : siecle - 100 + yy;
}
/** La prochaine fois (aujourd'hui compris) qu'arrive ce jour et ce mois. */
function prochaineFois(m: number, j: number, aujourdhui: string): number {
  const a = anneeDe(aujourdhui);
  for (let k = 0; k < 8; k++) if (dateValide(a + k, m, j) && versJours(isoDe(a + k, m, j)) >= versJours(aujourdhui)) return a + k;
  return a;
}

function lireDates(phrase: string, js: Jeton[], l: Langue, aujourdhui: string, ordre: 'jm' | 'mj', avecAnneeSupposee: boolean): DateLue[] {
  const out: DateLue[] = [];
  // Écritures en chiffres : AAAA-MM-JJ ; JJ/MM(/AAAA) ; JJ.MM.AAAA et JJ-MM-AAAA (année obligatoire avec « . » et « - »).
  // Les chiffres de toutes les écritures sont ramenés aux chiffres latins, un caractère pour un : les places restent justes.
  const brutLatin = chiffresLatins(phrase);
  for (const m of brutLatin.matchAll(/(?<![\d/.\-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d/.\-])/g)) {
    const a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]);
    if (dateValide(a, mo, j)) out.push({ iso: isoDe(a, mo, j), debut: m.index!, fin: m.index! + m[0].length, brut: m[0] });
  }
  for (const m of brutLatin.matchAll(/(?<![\d/.\-])(\d{1,2})([/.\-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/\-]|\.\d)/g)) {
    if (m[2] !== '/' && !m[4]) continue;
    if (out.some((d) => m.index! < d.fin && m.index! + m[0].length > d.debut)) continue;
    const x = Number(m[1]), y = Number(m[3]);
    let a1: number, a2: number, deux: number | undefined, supp: number | undefined;
    const lire = (jour: number, mois: number) => ({ jour, mois });
    const prem = ordre === 'jm' ? lire(x, y) : lire(y, x), sec = ordre === 'jm' ? lire(y, x) : lire(x, y);
    if (m[4]) { a1 = Number(m[4]); if (m[4].length === 2) { a1 = anneeDeuxChiffres(a1, aujourdhui); deux = a1; } a2 = a1; }
    else {
      // Année non écrite : chaque lecture prend SA prochaine fois (l'autre lecture n'est jamais une date déjà passée).
      if (!avecAnneeSupposee) continue;
      a1 = prochaineFois(prem.mois, prem.jour, aujourdhui); a2 = prochaineFois(sec.mois, sec.jour, aujourdhui);
    }
    const ok1 = dateValide(a1, prem.mois, prem.jour), ok2 = dateValide(a2, sec.mois, sec.jour);
    const choisi = ok1 ? prem : ok2 ? sec : undefined;
    if (!choisi) continue;
    const a = choisi === prem ? a1 : a2;
    if (!m[4]) supp = a;
    const autre = ok1 && ok2 && x !== y ? isoDe(a2, sec.mois, sec.jour) : undefined;
    out.push({ iso: isoDe(a, choisi.mois, choisi.jour), debut: m.index!, fin: m.index! + m[0].length, brut: m[0], ...(autre ? { autre } : {}), ...(supp ? { anneeSupposee: supp } : {}), ...(deux ? { deuxChiffres: deux } : {}) });
  }
  // Écritures avec le nom du mois : « 3 mars 2027 », « March 3, 2027 », « 3 de marzo de 2027 », « 3. März », « 3 مارس », « tarehe 3 Machi ».
  const moisListe = MOIS[l];
  for (let i = 0; i < js.length; i++) {
    let mois = 0, long = 0;
    for (let k = 0; k < 12 && !mois; k++) { const g = egalA(js, i, moisListe[k]); if (g) { mois = k + 1; long = g; } }
    if (!mois) continue;
    const nombre = (k: number) => {
      const j = js[k];
      if (!j || j.sorte !== 'nombre') return undefined;
      const v = lireChiffres(j.brut, l);
      return v && v.valeur.d === 1n ? Number(v.valeur.n) : undefined;
    };
    // Le jour : avant le mois (en sautant « de », « . », « er »…), sinon après (« March 3 »).
    let jour: number | undefined, kJour = -1;
    for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
      const v = nombre(k);
      if (v !== undefined) { if (v >= 1 && v <= 31) { jour = v; kJour = k; } break; }
      if (!SAUTER_AVANT_JOUR.has(js[k].n)) break;
    }
    let kSuite = i + long;
    if (jour === undefined) {
      const v = nombre(kSuite);
      if (v !== undefined && v >= 1 && v <= 31 && js[kSuite].brut.length <= 2) { jour = v; kJour = kSuite; kSuite++; while (js[kSuite] && SAUTER_AVANT_JOUR.has(js[kSuite].n) && js[kSuite].n !== 'de' && js[kSuite].n !== 'of') kSuite++; }
    }
    if (jour === undefined) continue;
    // L'année : après, en sautant « , », « de », « of ».
    let annee: number | undefined, kFin = kSuite;
    for (let k = kSuite; k < js.length && k <= kSuite + 2; k++) {
      const v = nombre(k);
      if (v !== undefined) { if (js[k].brut.length === 4) { annee = v; kFin = k + 1; } break; }
      if (!SAUTER_AVANT_ANNEE.has(js[k].n)) break;
    }
    let supp: number | undefined;
    if (annee === undefined) { if (!avecAnneeSupposee) continue; annee = prochaineFois(mois, jour, aujourdhui); supp = annee; }
    if (!dateValide(annee, mois, jour)) continue;
    const d0 = js[Math.min(kJour, i)].debut, d1 = js[Math.max(kFin, i + long, kJour + 1) - 1].fin;
    if (out.some((d) => d0 < d.fin && d1 > d.debut)) continue;
    out.push({ iso: isoDe(annee, mois, jour), debut: d0, fin: d1, brut: phrase.slice(d0, d1), ...(supp ? { anneeSupposee: supp } : {}) });
    i = Math.max(i, kFin - 1);
  }
  return out.sort((a, b) => a.debut - b.debut);
}

// ---------------------------------------------------------------------------------------------------------------
// La réponse

export interface OptionsTemps {
  /** L'instant de la question (l'appelant le donne : la fonction ne lit pas l'horloge). */
  maintenant: Date;
  /** Le fuseau d'« ici » (le lieu d'Odin). Absent ou inconnu : le temps universel, et c'est dit. */
  fuseau?: string;
  /** La langue de la réponse (« fr », ou un code ISO 639-3 comme « swh »). Absente : celle des mots de la phrase. */
  langue?: string;
  /** Les jours de week-end pour les jours ouvrés (0 = dimanche … 6 = samedi). Défaut : samedi et dimanche. */
  weekend?: number[];
  /** L'ordre d'une date en chiffres ambiguë (« 03/04 ») : jour/mois ou mois/jour. Défaut : mois/jour en anglais, jour/mois sinon. */
  ordreDate?: 'jm' | 'mj';
}
export interface DonneesTemps {
  /** La date trouvée (AAAA-MM-JJ). */
  date?: string;
  /** L'autre lecture possible, quand la phrase est ambiguë. */
  autre?: string;
  jourSemaine?: number;
  /** Jours entre aujourd'hui (ou la première date) et la date. */
  jours?: number;
  joursOuvres?: number;
  aujourdhui?: string;
  ans?: number;
  mois?: number;
  joursEnPlus?: number;
  /** Pour une durée en heures ou en minutes : l'instant (temps universel) et l'heure au mur d'ici. */
  instant?: string;
  heure?: string;
  [cle: string]: unknown;
}

/**
 * La réponse à une question de date (« mardi prochain », « dans 3 semaines », « combien de jours jusqu'au 3 mars »,
 * « quel jour tombe le … », « jours ouvrés entre … et … », « quel âge … né le … »). Rend `undefined` quand la phrase
 * n'en est pas une ou que sa langue n'est pas couverte ; une date hors des bornes : `reconnu` faux, et `direct` le dit.
 */
export function repondreTemps(phrase: string, o: OptionsTemps): ReponseCalculee<DonneesTemps> | undefined {
  if (typeof phrase !== 'string' || !phrase.trim() || phrase.length > LONGUEUR_MAX) return undefined;
  if (!o || !Number.isFinite(+o.maintenant)) return undefined;
  const js = jetons(phrase);
  const l = choisirLangue(js, o.langue, motsLangue());
  if (!l) return undefined;
  const T = TEXTES[l];
  const t = +o.maintenant;
  const mur = (o.fuseau && jourAuMur(t, o.fuseau)) || undefined;
  const fuseau = mur ? o.fuseau! : 'UTC';
  const aujourdhui = (mur ?? jourAuMur(t, 'UTC')!).date;
  const pasSur: string[] = [];
  if (!mur) pasSur.push(T.sansFuseau);
  if (T.gregorien) pasSur.push(T.gregorien);
  const conseils: ConseilCalcul[] = [{ id: 'ajouter-calendrier', libelle: T.calendrier }, { id: 'creer-rappel', libelle: T.rappel }];
  const calcul = { par: 'regles' as const, texte: T.calcul };
  const hors = (): ReponseCalculee<DonneesTemps> => ({ langue: l, sorte: 'date', reconnu: false, direct: remplir(T.hors, { min: String(ANNEE_MIN), max: String(ANNEE_MAX) }), points: [], pasSur, conseils: [], calcul });
  const unJour = (sorte: string, date: string, extra: { direct?: string; points?: string[]; donnees?: DonneesTemps; passe?: boolean } = {}): ReponseCalculee<DonneesTemps> => {
    const ecart = joursEntre(aujourdhui, date);
    // « Ajouter au calendrier » et « créer un rappel » n'ont de sens que pour un moment à venir.
    const passe = extra.passe ?? ecart < 0;
    return {
      langue: l, sorte, reconnu: true, direct: extra.direct ?? remplir(T.estLe, { date: dateLongue(date, l) }),
      points: extra.points ?? [relatif(ecart, l), remplir(T.aujourdhui, { date: dateLongue(aujourdhui, l) })],
      pasSur, conseils: passe ? [] : conseils, calcul, donnees: { date, jourSemaine: jourSemaine(date), jours: ecart, aujourdhui, ...(extra.donnees ?? {}) },
    };
  };
  const ordre = o.ordreDate ?? ordreParDefaut(o.langue, l);
  const age_ = contientMot(js, AGE[l]) || contientMot(js, NAISSANCE[l]);
  const dates = lireDates(phrase, js, l, aujourdhui, ordre, !age_);
  for (const d of dates) {
    if (d.autre) pasSur.push(remplir(T.autre, { expr: d.brut, date: dateCourte(d.autre, l) }));
    if (d.anneeSupposee) pasSur.push(remplir(T.anneeSupposee, { annee: String(d.anneeSupposee) }));
    if (d.deuxChiffres) pasSur.push(remplir(T.deuxChiffres, { annee: String(d.deuxChiffres) }));
  }
  const autreDe = (d: DateLue) => (d.autre ? { autre: d.autre } : {});

  // 1. L'âge : un mot d'âge ou de naissance et une date (avec son année).
  if (age_ && dates.length === 1) {
    const n = dates[0].iso;
    const a = age(n, aujourdhui);
    if (!a) return { langue: l, sorte: 'age', reconnu: false, direct: T.futur, points: [], pasSur, conseils: [], calcul };
    if (n.slice(5) === '02-29') pasSur.push(T.vingtNeuf);
    return {
      langue: l, sorte: 'age', reconnu: true, direct: remplir(T.age, { duree: enDuree({ years: a.ans }, l) }),
      points: [enDuree({ years: a.ans, months: a.mois, days: a.jours }, l), remplir(T.aujourdhui, { date: dateLongue(aujourdhui, l) })],
      pasSur, conseils: [], calcul, donnees: { date: n, ...autreDe(dates[0]), ans: a.ans, mois: a.mois, joursEnPlus: a.jours, aujourdhui },
    };
  }
  if (age_ && !dates.length && contientMot(js, NAISSANCE[l])) return undefined;

  // 2. Entre deux dates : jours, ou jours ouvrés.
  if (dates.length === 2 && (contientMot(js, ENTRE[l]) || contientMot(js, OUVRES[l]) || contientMot(js, JUSQUA[l]))) {
    const [a, b] = dates;
    const autre = a.autre ?? b.autre;
    if (contientMot(js, OUVRES[l])) {
      const we = (o.weekend ?? [6, 0]).filter((k) => Number.isInteger(k) && k >= 0 && k <= 6);
      const n = joursOuvres(a.iso, b.iso, we);
      const noms = new Intl.ListFormat(l, { type: 'conjunction' }).format(we.map((k) => nomJour(ajouterJours('2023-01-01', k), l)));
      pasSur.push(T.feries);
      if (l === 'de' && js.some((j) => j.n.startsWith('werktag'))) pasSur.push(T.werktage);
      if (l === 'fr' && js.some((j) => j.n === 'ouvrables')) pasSur.push(T.ouvrables);
      return {
        langue: l, sorte: 'jours-ouvres', reconnu: true, direct: remplir(T.ouvres, { a: dateCourte(a.iso, l), b: dateCourte(b.iso, l), n: new Intl.NumberFormat(l).format(n), we: noms }),
        // Les jours du calendrier, comptés comme les jours ouvrés : les deux dates comprises.
        points: [remplir(T.entre, { a: dateLongue(a.iso, l), b: dateLongue(b.iso, l), duree: enJours(Math.abs(joursEntre(a.iso, b.iso)) + 1, l) })],
        pasSur, conseils: [], calcul, donnees: { de: a.iso, a: b.iso, joursOuvres: n, weekend: we, ...(autre ? { autre } : {}) },
      };
    }
    const n = joursEntre(a.iso, b.iso);
    const sem = Math.floor(Math.abs(n) / 7), reste = Math.abs(n) % 7;
    return {
      langue: l, sorte: 'entre-dates', reconnu: true, direct: remplir(T.entre, { a: dateLongue(a.iso, l), b: dateLongue(b.iso, l), duree: enJours(Math.abs(n), l) }),
      points: sem ? [new Intl.NumberFormat(l, { style: 'unit', unit: 'week', unitDisplay: 'long' }).format(sem) + (reste ? ' + ' + enJours(reste, l) : '')] : [],
      pasSur, conseils: [], calcul, donnees: { de: a.iso, a: b.iso, jours: n, ...(autre ? { autre } : {}) },
    };
  }

  // 3. Une date : jusqu'à elle (« combien de jours jusqu'au… »), ou le jour de la semaine où elle tombe.
  if (dates.length === 1) {
    const d = dates[0];
    const ecart = joursEntre(aujourdhui, d.iso);
    // Un jour de la semaine écrit qui ne va pas avec la date (« mardi 2 décembre 2026 », un mercredi) : c'est dit.
    for (const j of js) {
      const w = jourNomme(j, l);
      if (w >= 0 && w !== jourSemaine(d.iso)) pasSur.push(remplir(T.contraire, { jour: j.brut, date: dateCourte(d.iso, l), vrai: nomJour(d.iso, l) }));
    }
    const jusqua = contientMot(js, JUSQUA[l]) || contientMot(js, COMBIEN[l]);
    if (jusqua) return unJour('jusqua', d.iso, { direct: remplir(T.jusqua, { date: dateLongue(d.iso, l), rel: relatif(ecart, l) }), points: [enJours(Math.abs(ecart), l), remplir(T.aujourdhui, { date: dateLongue(aujourdhui, l) })], donnees: autreDe(d) });
    return unJour('jour-de-la-semaine', d.iso, { direct: remplir(T.tombe, { date: dateCourte(d.iso, l), jour: nomJour(d.iso, l) }), donnees: autreDe(d) });
  }
  if (dates.length > 2) return undefined;

  // 4. Une durée avant ou après aujourd'hui : « dans 3 semaines », « il y a 3 jours », « baada ya wiki 3 », « بعد أسبوعين ».
  const duree = lireDuree(js, l);
  if (duree === 'incertain') return undefined;
  if (duree) {
    // Toutes les parties sont additionnées (« 3 semaines et 2 jours ») ; des heures mêlées à des jours ou des mois ne
    // sont pas devinées (un jour ne fait pas toujours 24 h au mur, au changement d'heure).
    if (duree.parties.some((p) => p.n > 10_000_000)) return hors();
    const horloge = duree.parties.filter((p) => p.unite === 'h' || p.unite === 'min');
    if (horloge.length && horloge.length !== duree.parties.length) return undefined;
    const somme = (u: UniteT, f: number) => duree.parties.filter((p) => p.unite === u).reduce((s, p) => s + p.n * f, 0);
    if (horloge.length) {
      const minutes = somme('h', 60) + somme('min', 1);
      const instant = t + duree.sens * minutes * 60_000;
      if (!Number.isFinite(instant) || Math.abs(instant) > 8.64e15) return hors();
      const m = jourAuMur(instant, fuseau);
      if (!m || !dansBornes(m.date)) return hors();
      const txt = new Intl.DateTimeFormat(l, { dateStyle: 'full', timeStyle: 'short', timeZone: fuseau }).format(instant);
      return unJour('heure', m.date, { direct: remplir(T.estLe, { date: txt }), donnees: { instant: new Date(instant).toISOString(), heure: m.heure }, passe: instant < t });
    }
    const mois = somme('mois', 1) + somme('an', 12), jours = somme('j', 1) + somme('sem', 7);
    if (jours > 4_000_000 || mois > 150_000) return hors();
    let date = aujourdhui, borne = false;
    if (mois) { const r = ajouterMois(aujourdhui, duree.sens * mois); date = r.date; borne = r.borne; }
    if (!dansBornes(date)) return hors();
    const finDeMois = date;
    if (jours) date = ajouterJours(date, duree.sens * jours);
    if (!dansBornes(date)) return hors();
    if (borne) pasSur.push(remplir(T.finDeMois, { date: dateCourte(finDeMois, l) }));
    return unJour('date-relative', date);
  }

  // 5. Un jour de la semaine : « mardi prochain », « last Friday », « Jumanne ijayo », « mardi ».
  for (let i = 0; i < js.length; i++) {
    const w = jourNomme(js[i], l);
    if (w < 0) continue;
    // « vendredi 13 », « Friday the 13th » : le numéro du jour compte. Le prochain 13 est pris s'il tombe ce jour-là ;
    // sinon le prochain vendredi 13, et l'écart est dit (jamais le 13 ignoré).
    const n = numeroApres(js, i, l);
    if (n !== undefined) {
      const cand = prochainNumero(aujourdhui, n.jour);
      if (cand && jourSemaine(cand) === w) return unJour('jour-de-la-semaine', cand);
      const vrai = cand && prochainJourNumero(aujourdhui, n.jour, w);
      if (!cand || !vrai) return undefined;
      const expr = phrase.slice(js[i].debut, js[n.fin - 1].fin).trim();
      pasSur.push(remplir(T.contraire, { jour: js[i].brut, date: dateCourte(cand, l), vrai: nomJour(cand, l) }));
      pasSur.push(remplir(T.prochainAvec, { expr, date: dateCourte(vrai, l) }));
      return unJour('jour-de-la-semaine', vrai, { donnees: { autre: cand } });
    }
    const autour = (liste: string[]) => [i - 2, i - 1, i + 1, i + 2].some((k) => k >= 0 && k < js.length && egalA(js, k, liste) > 0);
    const proche = autour(PROCHAIN[l]), dernier = autour(DERNIER[l]);
    const tj = jourSemaine(aujourdhui);
    const apres = ajouterJours(aujourdhui, (w - tj + 7) % 7 || 7);
    const avant = ajouterJours(aujourdhui, -((tj - w + 7) % 7 || 7));
    let date: string, autre: string | undefined;
    if (proche && !dernier) { date = apres; if (lundiDe(apres) === lundiDe(aujourdhui)) autre = ajouterJours(apres, 7); }
    else if (dernier && !proche) { date = avant; if (lundiDe(avant) === lundiDe(aujourdhui)) autre = ajouterJours(avant, -7); }
    else { date = apres; autre = tj === w ? aujourdhui : avant; }
    const exprTexte = phrase.slice(js[Math.max(0, i - 2)].debut, js[Math.min(js.length - 1, i + 2)].fin).trim();
    if (autre) pasSur.push(remplir(T.autre, { expr: exprTexte, date: dateCourte(autre, l) }));
    return unJour('jour-de-la-semaine', date, { donnees: autre ? { autre } : {} });
  }

  // 6. Les jours nommés : « demain », « hier », « après-demain »…
  let best: [number, number] | undefined; // [longueur, décalage]
  for (let i = 0; i < js.length; i++) {
    for (const [mot, dec] of RELATIFS[l]) {
      const w = norm(mot).split(' ');
      if (w.every((m, k) => js[i + k]?.n === m) && (!best || w.length > best[0])) best = [w.length, dec];
    }
  }
  if (best) return unJour('date-relative', ajouterJours(aujourdhui, best[1]));
  return undefined;
}

/** L'indice du jour de la semaine que nomme ce jeton (0 = dimanche), ou -1. */
function jourNomme(j: Jeton, l: Langue): number {
  return JOURS[l].findIndex((noms) => noms.includes(j.n) || sansPrefixesAr(j.n).some((x) => noms.includes(x) && x.startsWith('ال')));
}
/** Le numéro du jour juste après un jour de la semaine (« vendredi 13 », « Friday the 13th », « Freitag, der 13. »). */
function numeroApres(js: Jeton[], i: number, l: Langue): { jour: number; fin: number } | undefined {
  let k = i + 1;
  while (k < js.length && k <= i + 3 && (js[k].brut === ',' || SAUTER_AVANT_JOUR.has(js[k].n))) k++;
  const j = js[k];
  if (!j || j.sorte !== 'nombre' || j.brut.length > 2) return undefined;
  const v = lireChiffres(j.brut, l);
  if (!v || v.valeur.d !== 1n) return undefined;
  const n = Number(v.valeur.n);
  if (n < 1 || n > 31) return undefined;
  let fin = k + 1;
  if (js[fin] && HEURE_APRES.has(js[fin].n)) return undefined; // « vendredi 13 h » : une heure, pas un jour du mois
  if (js[fin] && ['st', 'nd', 'rd', 'th', 'er', '.'].includes(js[fin].n) && js[fin].debut === j.fin) fin++;
  return { jour: n, fin };
}
/** Le prochain jour numéroté `jour` (aujourd'hui compris), ce mois-ci ou après. */
function prochainNumero(aujourdhui: string, jour: number): string | undefined {
  const [a, m] = aujourdhui.split('-').map(Number);
  for (let k = 0; k < 24; k++) {
    const t = a * 12 + (m - 1) + k, na = Math.floor(t / 12), nm = (t % 12) + 1;
    if (dateValide(na, nm, jour) && versJours(isoDe(na, nm, jour)) >= versJours(aujourdhui)) return isoDe(na, nm, jour);
  }
  return undefined;
}
/** Le prochain jour numéroté `jour` qui tombe le jour de la semaine `w` (aujourd'hui compris). */
function prochainJourNumero(aujourdhui: string, jour: number, w: number): string | undefined {
  const [a, m] = aujourdhui.split('-').map(Number);
  for (let k = 0; k < 400; k++) {
    const t = a * 12 + (m - 1) + k, na = Math.floor(t / 12), nm = (t % 12) + 1;
    if (na > ANNEE_MAX) return undefined;
    if (!dateValide(na, nm, jour)) continue;
    const iso = isoDe(na, nm, jour);
    if (versJours(iso) >= versJours(aujourdhui) && jourSemaine(iso) === w) return iso;
  }
  return undefined;
}
/** L'ordre d'une date en chiffres en anglais : mois/jour sans région ; avec une région, celui de la région (« en-GB » : jour/mois). */
function ordreParDefaut(langue: string | undefined, l: Langue): 'jm' | 'mj' {
  if (l !== 'en') return 'jm';
  const code = String(langue ?? '').replace(/_/g, '-');
  if (!/^[a-z]{2,3}-[a-z0-9]{2,3}$/i.test(code)) return 'mj';
  try {
    const p = new Intl.DateTimeFormat(code, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).formatToParts(0);
    return p.findIndex((x) => x.type === 'day') < p.findIndex((x) => x.type === 'month') ? 'jm' : 'mj';
  } catch { return 'mj'; }
}

type PartieDuree = { n: number; unite: UniteT };
/**
 * Une durée écrite avec son sens : une ou plusieurs parties (nombre en chiffres ou en lettres, ou duel arabe, + unité),
 * liées par « et », « and », « , »… (« 3 semaines et 2 jours »), et un mot « dans », « il y a », « ago »… avant ou après.
 * « Et demi », « half »… : 'incertain' (la moitié n'est pas devinée).
 */
function lireDuree(js: Jeton[], l: Langue): { parties: PartieDuree[]; sens: 1 | -1 } | 'incertain' | undefined {
  const unites = new Map(UNITES_T[l].map(([x, u, n]) => [norm(x), [u, n] as const]));
  const nombreA = (k: number): number | undefined => {
    const j = js[k];
    if (!j) return undefined;
    if (j.sorte === 'nombre') { const v = lireChiffres(j.brut, l); return v && v.valeur.d === 1n ? Number(v.valeur.n) : undefined; }
    const r = lireNombreMots(js, k, l);
    return r ? Number(r.valeur) : undefined;
  };
  const nombreFinissantA = (k: number, depuis: number): [number, number] | undefined => {
    // Un nombre qui finit juste avant le jeton k, commencé au plus tôt à `depuis` : [valeur, premier jeton].
    if (js[k - 1]?.sorte === 'nombre') { if (k - 1 < depuis) return undefined; const v = nombreA(k - 1); return v === undefined ? undefined : [v, k - 1]; }
    for (let s = Math.max(depuis, k - 6); s < k; s++) {
      const r = lireNombreMots(js, s, l);
      if (r && r.fin === k) return [Number(r.valeur), s];
    }
    return undefined;
  };
  /** La partie dont l'unité est au jeton u : [partie, premier jeton, jeton qui suit]. */
  const partieEn = (u: number, depuis: number): { p: PartieDuree; debut: number; fin: number } | undefined => {
    const info = unites.get(js[u].n) ?? sansPrefixesAr(js[u].n).map((x) => unites.get(x)).find(Boolean);
    if (!info) return undefined;
    const [unite, duel] = info;
    let n: number | undefined, debut = u, fin = u + 1;
    if (duel) n = duel;
    else if (l === 'sw') { const v = nombreA(u + 1); if (v !== undefined) { n = v; fin = u + 2; } }
    else {
      const r = nombreFinissantA(u, depuis);
      if (r) { n = r[0]; debut = r[1]; }
      else if (l === 'ar' || (l === 'en' && u - 1 >= depuis && ['a', 'an'].includes(js[u - 1]?.n ?? ''))) { n = 1; if (l === 'en') debut = u - 1; }
    }
    if (n === undefined || !Number.isInteger(n) || n < 0) return undefined;
    return { p: { n, unite }, debut, fin };
  };
  const finitAvant = (k: number, liste: string[]) => liste.some((x) => { const w = x.split(' '); return k - w.length >= 0 && w.every((m, q) => js[k - w.length + q].n === m); });
  const commenceA = (k: number, liste: string[]) => egalA(js, k, liste) > 0;
  for (let u = 0; u < js.length; u++) {
    const p0 = partieEn(u, 0);
    if (!p0) continue;
    const parties = [p0.p];
    let fin = p0.fin;
    // Les parties suivantes : « et », « and », « , » (ou « و » collé en arabe), puis une autre partie qui commence là.
    for (;;) {
      let q = fin;
      if (js[q]?.brut === ',') q++;
      if (js[q] && LIENS[l].includes(js[q].n)) q++;
      const colleAr = l === 'ar' && q === fin && js[q]?.n.startsWith('و');
      if (q === fin && !colleAr) break;
      let suivante: ReturnType<typeof partieEn>;
      for (let v = q; v < js.length && v <= q + 6 && !suivante; v++) { const x = partieEn(v, q); if (x && x.debut === q) suivante = x; }
      if (!suivante) break;
      parties.push(suivante.p); fin = suivante.fin;
    }
    const sens = finitAvant(p0.debut, FUTUR_AVANT[l]) || commenceA(fin, FUTUR_APRES[l]) ? 1
      : finitAvant(p0.debut, PASSE_AVANT[l]) || commenceA(fin, PASSE_APRES[l]) ? -1 : 0;
    if (sens) return js.some((j, k) => egalA(js, k, DEMI[l]) > 0 || DEMI[l].includes(j.n)) ? 'incertain' : { parties, sens };
    u = Math.max(u, fin - 1);
  }
  return undefined;
}
