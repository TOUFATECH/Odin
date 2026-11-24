// Par la parole (lots S11 et C8) : relire un nom DIT contre une liste RÉELLE (les systèmes de la bibliothèque, ceux du
// catalogue, les clés connues, les PC vus). Jamais deviné à moitié : un seul nom convient, ou Odin demande lequel et rien
// ne part. Pur : aucune lecture, aucune écriture, aucun import (Genèse, Hydre et leurs essais s'en servent).
//   - « Ubuntu » convient à « Ubuntu Server 24.04.3 » (tous les mots dits y sont, en mots entiers) ; s'il y a aussi
//     « Ubuntu 24.04 (bureau) », les deux sont proposés ;
//   - « Windows 11 » convient à « Windows 11 » avant « Windows 11 (ARM 64) » (le nom exact passe d'abord) ;
//   - un morceau de mot (« ubu », « win ») ne convient jamais : Odin dit de qui il est proche, sans choisir ;
//   - « la dernière Debian » : parmi les Debian qui conviennent, la version la plus haute, seulement si « dernière » est
//     dit, que chacune a un numéro de version et qu'elles ne diffèrent QUE par lui (« Ubuntu Server 24.04 » et « Ubuntu
//     22.04 (bureau) » ne sont pas deux versions du même système : Odin demande lequel) ;
//   - un numéro dit est le DÉBUT du numéro du nom (« Ubuntu 24 », « Ubuntu 24.04 ») : jamais un morceau pris au milieu
//     (« Debian 1 » ne désigne pas « Debian 13.1.0 », ni « Ubuntu 3 » « Ubuntu 24.04.3 »).
// Les petits mots (« le », « the », « el », « der »…) et les mots de politesse sont laissés de côté dans les langues que
// Logos comprend déjà (français, anglais, espagnol, allemand ; le japonais s'écrit sans espaces : seul le nom exact y passe).

/** Un nom tel qu'on le dit : minuscules, sans accents, tirets, points et soulignés comme des espaces. Pur. */
export const formeDite = (x: unknown): string => (typeof x === 'string' ? x : '').slice(0, 400).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'')
  .replace(/[-_.]+/g, ' ').replace(/[«»"“”?!,;:()[\]{}/\\]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Les petits mots qui ne nomment rien (articles, possessifs, politesse), dans les langues comprises. */
const PETITS = new Set(('le la les l un une du de des d au aux mon ma mes ton ta tes notre nos ce cet cette ces svp stp merci moi '
  + 'the a an my our your please of this that some '
  + 'el los las lo una unos unas mi mis tu tus nuestro nuestra por favor del al este esta '
  + 'der die das den dem des ein eine einen einem einer mein meine meinen meinem meiner bitte dieser diese dieses hinzu').split(' '));
/** « la dernière », dans les langues comprises : ce n'est pas un mot du nom, c'est une demande (la version la plus haute). */
const DERNIERE = new Set('dernier derniere dernieres derniers latest newest ultima ultimo ultimas ultimos neueste neuesten neuester neuestes aktuelle aktuellen 最新 最新の 最新版'.split(' '));
/** Des mots qui disent le genre de la chose, pas son nom (« la version », « le système »). */
const GENRE = new Set('version versions versión system systeme systemes sistema sistemas betriebssystem os iso image imagen abbild release'.split(' '));

/** Les mots d'un nom, entiers ; une lettre collée à un chiffre donne aussi ses deux moitiés (« win11 » → win, 11). Pur. */
export function motsDe(x: unknown): string[] {
  const out = new Set<string>();
  for (const w of formeDite(x).replace(/^(?:l|d)'/, '').split(/[\s']+/)) {
    if (!w) continue; out.add(w);
    const m = /^([a-z]+)(\d+)$/.exec(w); if (m) { out.add(m[1]); out.add(m[2]); }
  }
  // « win » écrit dans un nom de fichier (« Win11_24H2 ») est Windows ; l'inverse n'est pas vrai (« win » dit seul ne suffit pas).
  if (out.has('win')) out.add('windows');
  return [...out];
}
/** Les suites de numéros d'un nom (« Ubuntu Server 24.04.3 » → [24, 04, 3] ; « Win11_24H2 » → [11]). Pur. */
export function suitesDeNumeros(x: unknown): string[][] {
  const out: string[][] = []; let cours: string[] = [];
  const fin = () => { if (cours.length) out.push(cours); cours = []; };
  for (const w of formeDite(x).split(/[\s']+/)) {
    if (/^\d+$/.test(w)) { cours.push(w); continue; }
    fin();
    const m = /^[a-z]+(\d+)$/.exec(w); if (m) out.push([m[1]]);
  }
  fin();
  return out;
}
/** Ce qui est dit, sans les petits mots ; `derniere` : « la dernière » a été dit. Pur. */
export function motsDits(dit: unknown): { mots: string[]; derniere: boolean } {
  const tous = formeDite(dit).replace(/\b(?:l|d)'/g, '').split(/[\s']+/).filter(Boolean);
  const derniere = tous.some((w) => DERNIERE.has(w));
  const utiles = tous.filter((w) => !PETITS.has(w) && !DERNIERE.has(w));
  // « la dernière version de Debian » : « version » n'est pas dans le nom ; « système » seul, lui, reste (rien d'autre n'est dit).
  const sansGenre = utiles.filter((w) => !GENRE.has(w));
  return { mots: sansGenre.length ? sansGenre : utiles, derniere };
}

/** Le verbe en tête d'une demande (« installe-moi … », « put … », « füge … »), dans les langues comprises : il ne nomme rien. */
const VERBES = '(?:installe[rz]?|mets|mettre|copie|ajoute|rajoute|d[ée]ploie|t[ée]l[ée]charge|cr[ée]e|cr[ée]er|fais|install|put|copy|add|deploy|create|make|instala|pon|copia|a[ñn]ade|agrega|despliega|crea|haz|installiere|kopiere|packe|f[üu]ge|erstelle|mache?)';
const RE_AMORCE = new RegExp(`^\\s*${VERBES}(?:-(?:moi|nous|lui|toi))?\\s+(?:(?:moi|me|mir|uns)\\s+)?`, 'i');
/** La demande sans son verbe de tête (« installe-moi un système » → « un système »). Pur. */
export const sansAmorce = (t: string): string => t.replace(RE_AMORCE, '');
/** Rien n'est nommé : la demande est vide, ou ne dit que le genre (« un système », « a system », « ein System »). Pur. */
export function rienDeNomme(dit: unknown): boolean { const m = motsDits(dit).mots; return !m.length || m.every((w) => GENRE.has(w)); }
/** Ce qui est dit, en clair, sans les petits mots (vide : rien n'est dit). Pur. */
export const ditUtile = (dit: unknown): string => motsDits(dit).mots.join(' ');

/** Une chose qu'on peut nommer : son nom montré, et d'autres façons de l'écrire (nom du fichier, famille, version). */
export interface Nommable { nom: string; autres?: string[]; version?: string }
export type Relu<T> = { ok: true; x: T; derniere?: boolean } | { ok: false; raison: 'vide' | 'plusieurs' | 'proche' | 'inconnu'; choix: T[]; dit: string };

/** Compare deux numéros de version (« 24.04.3 », « 13.1.0 », « 24H2 ») morceau par morceau. Pur. */
export function cmpVersionDite(a: string, b: string): number {
  const p = (x: string) => x.toLowerCase().split(/[^0-9a-z]+/).filter(Boolean);
  const A = p(a), B = p(b);
  for (let k = 0; k < Math.max(A.length, B.length); k++) {
    const x = A[k] ?? '', y = B[k] ?? '';
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN, ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Relit un nom dit contre une liste réelle. Un seul convient : c'est lui. Plusieurs : ils sont rendus (Odin demande
 * lequel). Aucun : ceux dont il est proche, sinon rien. Pur ; jamais un choix au hasard, jamais le premier venu.
 */
export function relireDit<T extends Nommable>(dit: unknown, liste: T[]): Relu<T> {
  const { mots, derniere } = motsDits(dit), d = mots.join(' ');
  const non = (raison: 'vide' | 'plusieurs' | 'proche' | 'inconnu', choix: T[]): Relu<T> => ({ ok: false, raison, choix: choix.slice(0, 6), dit: d.slice(0, 60) });
  if (!mots.length) return non('vide', []);
  const l = liste.filter((c) => c && typeof c.nom === 'string' && c.nom.trim()).map((c) => ({ c, formes: [formeDite(c.nom)], mots: new Set([c.nom, ...(c.autres ?? [])].flatMap(motsDe)), suites: [c.nom, ...(c.autres ?? [])].flatMap(suitesDeNumeros) }));
  // Les numéros dits, dans l'ordre : ils doivent COMMENCER une suite de numéros du nom (« 24 04 » pour « 24.04.3 ») ;
  // jamais un numéro pris au milieu (« Debian 1 » pour « Debian 13.1.0 »).
  const numeros = mots.filter((w) => /^\d+$/.test(w));
  const numerosBons = (x: (typeof l)[number]) => !numeros.length || x.suites.some((s) => numeros.every((n, k) => s[k] === n));
  // « la dernière » : parmi ceux qui conviennent, la version la plus haute — seulement si chacun dit sa version, sans
  // égalité, et s'ils ne diffèrent que par elle (le même nom une fois les numéros ôtés) : « serveur » et « bureau » ne
  // sont pas deux versions du même système.
  const sansNumeros = (x: (typeof l)[number]) => x.formes[0].split(' ').filter((w) => !/^\d/.test(w)).join(' ');
  const plusHaute = (xs: typeof l): T | undefined => {
    if (!derniere || xs.length < 2 || xs.some((x) => !x.c.version) || new Set(xs.map(sansNumeros)).size !== 1) return undefined;
    const tri = [...xs].sort((a, b) => cmpVersionDite(b.c.version!, a.c.version!));
    return cmpVersionDite(tri[0].c.version!, tri[1].c.version!) > 0 ? tri[0].c : undefined;
  };
  const un = (x: T): Relu<T> => ({ ok: true, x, ...(derniere ? { derniere: true } : {}) });
  // 1. le nom exact (à la majuscule, à l'accent et au tiret près) — le nom montré seulement : « Ubuntu », nom de famille de
  //    deux systèmes, ne désigne pas l'un des deux
  const exacts = l.filter((x) => x.formes[0] === d);
  if (exacts.length === 1) return un(exacts[0].c);
  if (exacts.length > 1) { const h = plusHaute(exacts); return h ? un(h) : non('plusieurs', exacts.map((x) => x.c)); }
  // 2. tous les mots dits sont dans le nom, en mots entiers
  const tous = l.filter((x) => mots.every((w) => x.mots.has(w)) && numerosBons(x));
  if (tous.length === 1) return un(tous[0].c);
  if (tous.length > 1) { const h = plusHaute(tous); return h ? un(h) : non('plusieurs', tous.map((x) => x.c)); }
  // 3. seulement un morceau (un mot sur deux, ou le début d'un mot) : jamais choisi, Odin dit de qui c'est proche
  const proches = l.filter((x) => mots.some((w) => w.length >= 3 && !/^\d+$/.test(w) && (x.mots.has(w) || [...x.mots].some((m) => m.startsWith(w)))));
  return proches.length ? non('proche', proches.map((x) => x.c)) : non('inconnu', []);
}

/** « A, B ou C ». Pur. */
export const ouListe = (l: string[]): string => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} ou ${l.at(-1)}`);

/** Ce qu'Odin répond quand le nom dit ne désigne pas une seule chose (rien ne part). `quoi` : « système », « clé », « PC ». Pur. */
export function texteNonRelu<T extends Nommable>(r: Extract<Relu<T>, { ok: false }>, quoi: string, ou: string): string {
  const noms = ouListe(r.choix.map((c) => `« ${c.nom} »`));
  if (r.raison === 'vide') return `Dis le nom du ${quoi}. Rien n'est fait.`;
  if (r.raison === 'plusieurs') return `Plusieurs ${quoi}s conviennent pour « ${r.dit} » : ${noms}. Lequel ? Rien n'est fait.`;
  if (r.raison === 'proche') return `Je ne connais pas « ${r.dit} » tel quel ${ou}. Tu parles de ${noms} ? Rien n'est fait : redis-le avec son nom.`;
  return `Je ne connais pas « ${r.dit} » ${ou}. Rien n'est fait.`;
}

// ---------------- La phrase : ce qui nomme le système, ce qui nomme la cible ----------------
/** Les mots qui annoncent une clé (« sur la clé », « on the USB stick », « en la memoria USB », « auf den USB-Stick »). */
const CLE = '(?:cl[eé]s?(?:\\s+usb)?|usb[- ]?(?:stick|drive|key|sticks?)|(?:thumb|flash|pen)\\s?drive|stick|key|memoria\\s+usb|pendrive|llave(?:\\s+usb)?|usb)';
/** Les mots qui annoncent des PC. */
const PCS = '(?:pcs?|postes?|ordinateurs?|ordis?|machines?|computers?|ordenadores?|equipos?|rechnern?|computern?)';
const VERS = '(?:sur|dans|à|a|au|aux|vers|on|onto|to|in|into|en|auf|zu|zum|für|for|pour|para)';
const ARTICLES = '(?:(?:tous\\s+les|toutes\\s+les|all\\s+the|all|todos\\s+los|alle|allen|les|le|la|l\'|mes|ma|mon|the|my|los|las|el|mis|mi|den|die|dem|der|meine[nmr]?|mein)\\s+)?';
const RE_CLE = new RegExp(`(?:^|\\s)${VERS}\\s+${ARTICLES}${CLE}(?=\\s|$)(.*)$`, 'i');
const RE_PCS = new RegExp(`(?:^|\\s)${VERS}\\s+${ARTICLES}${PCS}(?=\\s|$)(.*)$`, 'i');
/** « qui viennent de démarrer », « that just booted », « que acaban de arrancar », « die gerade gestartet sind », « au menu ». */
const RE_RECENTS = /viennent\s+(?:tout\s+)?(?:juste\s+)?de|vient\s+(?:tout\s+)?(?:juste\s+)?de|just\s+(?:booted|started|turned|powered|came)|acaban\s+de|acaba\s+de|gerade|eben\s+ge|soeben|au\s+menu|at\s+the\s+menu|en\s+el\s+men[uú]|im\s+men[uü]|en\s+attente|waiting/i;

/**
 * Coupe une demande dite en deux : le système (« Ubuntu », « Windows 11 ») et ce qui suit le mot de la cible (« qui
 * viennent de démarrer », « Lagon »). `genre` : la cible attendue. Sans mot de cible, tout est le système. Pur.
 */
export function couperDemande(demande: unknown, genre: 'cle' | 'pcs'): { systeme: string; cible: string; ciblee: boolean } {
  const t = (typeof demande === 'string' ? demande : '').slice(0, 400).replace(/[.!?。]+\s*$/, '').replace(/\s+/g, ' ').trim();
  const m = (genre === 'cle' ? RE_CLE : RE_PCS).exec(t);
  if (!m) return { systeme: sansAmorce(t).trim(), cible: '', ciblee: false };
  return { systeme: sansAmorce(t.slice(0, m.index)).trim(), cible: (m[1] ?? '').trim(), ciblee: true };
}
/** « sauf le mien », « except pc-02 », « pero no… », « außer… » : la demande en RETIRE un. */
const RE_SAUF = /(?:^|\s)(?:sauf|except[ée]s?|hormis|mais\s+pas|et\s+pas|pas\s+(?:le|la|les|celui|ceux|sur)|sans|except|but|other\s+than|without|not|excepto|salvo|menos|pero\s+no|sin|au(?:ß|ss)er|aber\s+nicht|nicht|ohne)(?=\s|$)/i;
/** La cible retire-t-elle quelque chose (« … sauf le mien ») ? La parole ne retire pas un PC d'un lot : Odin le dit. Pur. */
export const cibleAvecExclusion = (cible: string): boolean => RE_SAUF.test(cible.normalize('NFC'));
/** La cible dit-elle « ceux qui viennent de démarrer » (les PC au menu en ce moment) ? Pur. */
export const pcsRecents = (cible: string): boolean => RE_RECENTS.test(cible);
/** « qui viennent de démarrer » en entier, dans les langues comprises (pour savoir ce qui est dit EN PLUS). */
const RE_RECENTS_ENTIERS = [
  /(?:qui\s+)?(?:viennent|vient)\s+(?:juste\s+|tout\s+juste\s+)?de\s+(?:d[ée]marrer|red[ée]marrer|booter|s'allumer|se\s+lancer)/gi,
  /(?:qui\s+(?:sont|attendent)\s+)?au\s+menu/gi, /(?:qui\s+sont\s+)?en\s+attente/gi,
  /(?:(?:that|which|who)\s+)?(?:have\s+)?just\s+(?:booted|started|turned\s+on|powered\s+on|came\s+up)(?:\s+up)?/gi, /(?:(?:that|which)\s+are\s+)?(?:waiting\s+)?at\s+the\s+menu/gi, /(?:(?:that|which)\s+are\s+)?waiting/gi,
  /(?:que\s+)?acaban?\s+de\s+(?:arrancar|encenderse|iniciarse|iniciar)/gi, /(?:que\s+est[áa]n\s+)?en\s+el\s+men[uú]/gi,
  /(?:die\s+)?(?:gerade|soeben|eben)\s+(?:hoch)?ge(?:startet|bootet|fahren)(?:\s+(?:sind|wurden))?/gi, /(?:die\s+)?im\s+men[uü](?:\s+(?:sind|warten))?/gi,
];
const SUPERFLUS = new Set('maintenant now ahora jetzt actuellement currently moment right tous toutes all todos alle qui that which que sont are estan sind en juste just'.split(' '));
/**
 * Ce qui est dit EN PLUS de « qui viennent de démarrer » (« du salon », « in the office ») : une précision que la
 * parole ne sait pas appliquer à un lot. Vide : la cible ne dit que « ceux qui viennent de démarrer ». Pur.
 */
export function resteApresRecents(cible: string): string {
  let t = ` ${cible.normalize('NFC')} `;
  for (const re of RE_RECENTS_ENTIERS) t = t.replace(re, ' ');
  return motsDits(t).mots.filter((w) => !SUPERFLUS.has(w)).join(' ');
}
/** Les adresses MAC écrites dans un texte (en minuscules, avec « : »). Pur. */
export const macsDites = (t: string): string[] => [...new Set([...t.matchAll(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi)].map((m) => m[0].toLowerCase().replace(/-/g, ':')))];
