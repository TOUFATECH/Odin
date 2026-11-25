// Sphinx · Noms et enregistrements (maquette « Réseau » validée, écran « DNS · Noms »). Ici, la partie pure : aucune
// prise réseau, aucun fichier.
//  - `nomPropre` : un nom écrit dans n'importe quelle langue que le DNS accepte (« café.maison », « дом.maison »,
//    « 厨房.maison ») est rangé sous sa forme ASCII (« xn--… ») et montré dans sa langue ; tout nom piégé est refusé
//    (espaces, caractères invisibles, sens d'écriture caché, « % », « / », un nom qui est en fait une adresse) ;
//  - `verifierNom` : « Ajouter un nom » (ou le changer) vérifié AVANT d'écrire : la sorte (adresse, alias, joker, texte),
//    la valeur, pas de doublon, pas de conflit avec un nom automatique (DHCP) ni avec celui d'Odin, un joker seulement
//    sous le nom de la maison ; un nom d'Internet n'est remplacé que pour la maison, et c'est dit ;
//  - `listeNoms` : tous les noms que le DNS d'Odin sert pour la maison (automatiques depuis les baux du DHCP, adresses
//    fixes, à la main, ceux d'Odin), leur sorte en mots, et l'inverse (adresse → nom) donné tout seul.
// Le message d'un refus ne répète jamais ce qui a été tapé : rien de piégé n'en ressort.
import { domainToASCII, domainToUnicode } from 'node:url';
import { isIPv6 } from 'node:net';
import { ipNum, ipPropre } from './dhcp.ts';
import { ipv6Bytes } from './wire.ts';

export type SorteNom = 'a' | 'aaaa' | 'alias' | 'joker' | 'inverse' | 'texte' | 'autre';
export type OrigineNom = 'main' | 'dhcp' | 'fixe' | 'odin';
/** Les sortes d'enregistrements, dans l'ordre où la page les montre. */
export const SORTES_NOMS: SorteNom[] = ['a', 'aaaa', 'alias', 'joker', 'inverse', 'texte', 'autre'];

export type CodeNom = 'ok' | 'vide' | 'nom' | 'adresse-nom' | 'reserve' | 'sorte' | 'valeur' | 'joker' | 'doublon' | 'introuvable' | 'automatique' | 'odin';
export interface NomPropre { ok: boolean; ascii: string; unicode: string; joker: boolean; code: CodeNom; message: string }

const DOMAINE = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
/** Lettres et chiffres de toutes les écritures, signes qui s'y attachent, « - », « _ » et « . » : rien d'autre. */
const PERMIS = /^[\p{L}\p{M}\p{N}_.-]+$/u;
const refusNom = (code: CodeNom, message: string): NomPropre => ({ ok: false, ascii: '', unicode: '', joker: false, code, message });

/** Un nom de machine propre (ASCII pour le DNS, dans sa langue pour l'écran), ou le refus en mots. Pur. */
export function nomPropre(v: unknown): NomPropre {
  if (typeof v !== 'string' || v.length > 300) return refusNom('vide', 'Écris un nom (par exemple « serveur » suivi du nom de la maison).');
  // Un caractère de contrôle n'est pas « nettoyé » : le nom est refusé (un retour à la ligne caché change ce qui est servi).
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) return refusNom('nom', 'Ce nom contient un caractère invisible : écris-le de nouveau, sans copier-coller.');
  let t = v.replace(/^[ \t]+|[ \t]+$/g, '');
  if (!t) return refusNom('vide', 'Écris un nom (par exemple « serveur » suivi du nom de la maison).');
  if (t.endsWith('.') && t !== '.') t = t.slice(0, -1);
  const joker = t.startsWith('*.');
  const corps = joker ? t.slice(2) : t;
  if (!corps || !PERMIS.test(corps)) return refusNom('nom', 'Ce nom n\'est pas valable : des lettres (de n\'importe quelle langue), des chiffres et des tirets, séparés par des points ; ni espace, ni caractère invisible, ni « * » ailleurs qu\'au début.');
  const parts = corps.split('.');
  if (parts.some((p) => !p)) return refusNom('nom', 'Ce nom n\'est pas valable : deux points qui se suivent, ou un point au début.');
  // Un nom dont la fin est un nombre serait lu comme une adresse (« 1.2.3 », « 0x7f.1 ») : refusé avant toute conversion.
  const fin = parts[parts.length - 1];
  if (/^\d+$/.test(fin) || /^0x[0-9a-f]*$/i.test(fin)) return refusNom('adresse-nom', 'Ce nom ressemble à une adresse : un nom finit par des lettres.');
  const ascii = domainToASCII(corps);
  if (!ascii || !DOMAINE.test(ascii) || ascii.split('.').some((p) => p.startsWith('-') || p.endsWith('-'))) return refusNom('nom', 'Ce nom n\'est pas valable pour le DNS : chaque partie fait de 1 à 63 caractères, sans tiret au début ni à la fin, et le tout au plus 253.');
  // « .arpa » est réservé (les adresses inverses), sauf « home.arpa », fait pour les réseaux de maison (et que les réglages
  // du DHCP proposent comme nom de la maison) : les noms SOUS « home.arpa » sont des noms de machines comme les autres.
  if (ascii === 'localhost' || ascii.endsWith('.localhost') || ascii === 'arpa' || (ascii.endsWith('.arpa') && !ascii.endsWith('.home.arpa')) || ascii === 'local' || ascii.endsWith('.local')) {
    return refusNom('reserve', 'Ce nom est réservé (la machine elle-même, les adresses inverses, ou les noms que les appareils se donnent entre eux) : choisis-en un autre.');
  }
  const unicode = domainToUnicode(ascii) || ascii;
  return { ok: true, ascii: joker ? `*.${ascii}` : ascii, unicode: joker ? `*.${unicode}` : unicode, joker, code: 'ok', message: '' };
}

/** Une adresse donnée à un nom : IPv4 ou IPv6 bien écrite, et qui peut désigner une machine. Pur. */
export function adressePropre(v: string): { ok: boolean; ip: string; famille: 4 | 6 | 0; message: string } {
  const t = v.trim();
  const v4 = ipPropre(t);
  if (v4) {
    const n = ipNum(v4), a = n >>> 24;
    if (a === 0) return { ok: false, ip: '', famille: 0, message: 'Refusé : une adresse en 0.x.x.x ne désigne aucune machine.' };
    if (a === 127) return { ok: false, ip: '', famille: 0, message: 'Refusé : une adresse en 127.x.x.x renverrait chaque appareil vers lui-même.' };
    if (a >= 224) return { ok: false, ip: '', famille: 0, message: 'Refusé : cette adresse sert à envoyer à plusieurs machines à la fois (ou est réservée), pas à une machine.' };
    return { ok: true, ip: v4, famille: 4, message: '' };
  }
  if (t.length <= 45 && !t.includes('%') && isIPv6(t)) {
    // Lue octet par octet (une adresse IPv4 glissée dedans n'est pas comprise : refusée, par prudence).
    const b = ipv6Bytes(t);
    if (b && b.every((x) => x === 0)) return { ok: false, ip: '', famille: 0, message: 'Refusé : l\'adresse « :: » ne désigne aucune machine.' };
    if (b && b.subarray(0, 15).every((x) => x === 0) && b[15] === 1) return { ok: false, ip: '', famille: 0, message: 'Refusé : l\'adresse « ::1 » renverrait chaque appareil vers lui-même.' };
    if (b && b[0] === 0xff) return { ok: false, ip: '', famille: 0, message: 'Refusé : cette adresse sert à envoyer à plusieurs machines à la fois, pas à une machine.' };
    if (b) return { ok: true, ip: t.toLowerCase(), famille: 6, message: '' };
  }
  return { ok: false, ip: '', famille: 0, message: 'Adresse mal écrite : quatre nombres de 0 à 255 séparés par des points (IPv4), ou une adresse IPv6.' };
}

/** Un nom automatique (DHCP), celui d'une adresse fixe, ou celui d'Odin : « nom.domaine » → son adresse. */
export interface NomAuto { nom: string; ip: string; origine: Exclude<OrigineNom, 'main'>; qui?: string; mac?: string }
export interface EntreeNoms {
  /** le nom de la maison (« maison ») */
  domaine: string;
  /** les noms ajoutés à la main (les réglages du DNS : nom ASCII → valeurs) */
  main: Record<string, string[]>;
  automatiques: NomAuto[];
  /** vrai pour une adresse du réseau de la maison (l'inverse n'est donné que pour elles, et pour les adresses privées) */
  reseau?: (ip: string) => boolean;
}

export interface VerdictNom {
  ok: boolean; code: CodeNom; message: string; avis: string[];
  /** la clé rangée (ASCII, « *. » devant pour un joker) */
  nom: string; unicode: string; sorte: SorteNom;
  /** ce qui sera rangé pour ce nom */
  to: string[];
  /** un nom qui n'est pas de la maison : il peut exister sur Internet, il ne sera remplacé que pour la maison */
  horsMaison: boolean;
  /** ce nom existe déjà à la main */
  existe: boolean;
}

// « (.+) » : la valeur tient sur une ligne (un retour à la ligne n'y entre jamais).
const TYPE_ECRIT = /^(A|AAAA|CNAME|MX|TXT|SRV|NS|PTR)\s+(.+)$/i;
/** Un caractère de contrôle, ou une fin de ligne Unicode : jamais dans un enregistrement écrit. */
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Ce qu'il y a de rangé pour un nom, dit en une sorte. Pur. */
export function sorteDe(nom: string, to: string[]): SorteNom {
  if (nom.startsWith('*.')) return 'joker';
  const ecrits = to.map((x) => TYPE_ECRIT.exec(x.trim()));
  if (to.length && ecrits.every(Boolean)) {
    const k = new Set(ecrits.map((m) => m![1].toUpperCase()));
    if (k.size === 1) { const [u] = [...k]; return u === 'A' ? 'a' : u === 'AAAA' ? 'aaaa' : u === 'CNAME' ? 'alias' : u === 'TXT' ? 'texte' : 'autre'; }
    if ([...k].every((x) => x === 'A' || x === 'AAAA')) return 'a';
    return 'autre';
  }
  if (ecrits.some(Boolean)) return 'autre';
  const v4 = to.filter((x) => ipPropre(x)), v6 = to.filter((x) => !ipPropre(x) && isIPv6(x));
  if (to.length && v4.length + v6.length === to.length) return v4.length ? 'a' : 'aaaa';
  return to.length === 1 ? 'alias' : 'autre';
}
/** La valeur lisible : les adresses, le nom visé (dans sa langue), le texte. Pur. */
function valeurLisible(to: string[]): string {
  return to.map((x) => {
    const m = TYPE_ECRIT.exec(x.trim());
    if (m) { const k = m[1].toUpperCase(), v = m[2].trim(); return k === 'TXT' ? v : k === 'A' || k === 'AAAA' ? v : k === 'CNAME' ? domainToUnicode(v) || v : `${k} ${v}`; }
    return ipPropre(x) || isIPv6(x) ? x : domainToUnicode(x) || x;
  }).join(', ');
}

/** Le nom de la maison et ses sous-noms : « lecteur.maison », ou un nom sans point. */
const deLaMaison = (ascii: string, domaine: string) => !ascii.includes('.') || ascii === domaine || ascii.endsWith(`.${domaine}`);
const refus = (code: CodeNom, message: string, plus: Partial<VerdictNom> = {}): VerdictNom => ({ ok: false, code, message, avis: [], nom: '', unicode: '', sorte: 'a', to: [], horsMaison: false, existe: false, ...plus });

/**
 * « Ajouter un nom » ou le changer (`remplacer`), vérifié avant d'écrire. `sorte` : « a » (nom → adresse, IPv4 ou IPv6),
 * « alias », « joker », « texte » ; vide ou « auto » : comme avant, la valeur dit la sorte (des adresses, un nom, ou un
 * enregistrement écrit « MX 10 … », « TXT … »). Pur.
 */
export function verifierNom(e: EntreeNoms & { nom: unknown; sorte?: unknown; valeur: unknown; remplacer?: boolean }): VerdictNom {
  const domaine = (e.domaine || 'maison').toLowerCase();
  const sorteDemandee = typeof e.sorte === 'string' ? e.sorte.trim().toLowerCase() : '';
  if (!['', 'auto', 'a', 'alias', 'joker', 'texte'].includes(sorteDemandee)) return refus('sorte', 'Sorte inconnue : « nom → adresse », « autre nom (alias) », « tous les noms d\'un groupe (joker) » ou « texte ».');
  // Le joker : « atelier.maison » tapé avec la sorte « joker » devient « *.atelier.maison ».
  const brut = typeof e.nom === 'string' && sorteDemandee === 'joker' && !e.nom.trim().startsWith('*.') ? `*.${e.nom.trim()}` : e.nom;
  const n = nomPropre(brut);
  if (!n.ok) return refus(n.code, n.message);
  const cle = n.ascii, base = n.joker ? cle.slice(2) : cle;
  if (n.joker && sorteDemandee !== 'joker' && sorteDemandee !== '' && sorteDemandee !== 'auto') return refus('sorte', 'Un nom qui commence par « *. » couvre tout un groupe : choisis la sorte « tous les noms d\'un groupe (joker) ».');
  // Un joker seulement sous le nom de la maison : « *.atelier.maison ». Jamais tout le nom de la maison, jamais Internet.
  if (n.joker && !base.endsWith(`.${domaine}`)) return refus('joker', `Un joker ne couvre qu'un groupe de la maison, par exemple « *.atelier.${domaine} » : jamais tout « .${domaine} », jamais un nom d'Internet.`);
  if (base === domaine) return refus('reserve', `C'est le nom de la maison lui-même (« .${domaine} ») : donne un nom à une machine, par exemple « serveur.${domaine} ».`);
  const existe = Object.hasOwn(e.main, cle);
  // Les noms automatiques et celui d'Odin : ils suivent les appareils, ils ne se prennent pas à la main. Un nom DÉJÀ ajouté
  // à la main n'est pas pris par un appareil qui annonce le même par le DHCP (le nom à la main passe avant dans le DNS) :
  // le propriétaire le change ou le retire toujours. Celui d'Odin reste verrouillé dans tous les cas.
  if (!n.joker) {
    // Le DNS sert chaque nom automatique avec et sans le nom de la maison (« scanner.maison » et « scanner »).
    const nue = (x: string) => (x.endsWith(`.${domaine}`) ? x.slice(0, -(domaine.length + 1)) : x);
    const meme = (a: NomAuto) => a.nom === cle || (!cle.includes('.') && nue(a.nom) === cle);
    const odin = e.automatiques.find((a) => a.origine === 'odin' && meme(a));
    if (odin) return refus('odin', `Refusé : « ${n.unicode} » est le nom d'Odin lui-même ; il est verrouillé.`);
    const auto = existe ? undefined : e.automatiques.find((a) => a.origine !== 'odin' && meme(a));
    if (auto) return refus('automatique', `Refusé : « ${n.unicode} » est le nom automatique ${auto.qui ? `de « ${auto.qui} » ` : ''}(donné par le DHCP). Pour le changer, renomme l'appareil dans « Appareils » ; sinon choisis un autre nom.`);
  }
  if (existe && !e.remplacer) return refus('doublon', `« ${n.unicode} » existe déjà : change-le (le crayon) ou retire-le d'abord.`, { existe });
  if (!existe && e.remplacer) return refus('introuvable', `« ${n.unicode} » n'existe pas encore : ajoute-le.`);
  // La valeur.
  const val = typeof e.valeur === 'string' ? e.valeur : '';
  if (val.length > 2000) return refus('valeur', 'Valeur trop longue.');
  let sorte: SorteNom, to: string[];
  const pasValeur = (message: string) => refus('valeur', message, { nom: cle, unicode: n.unicode, existe });
  const adresses = (): string[] | VerdictNom => {
    const l = val.split(/[\s,]+/).filter(Boolean);
    if (!l.length) return pasValeur('Écris l\'adresse de la machine.');
    if (l.length > 8) return pasValeur('Au plus 8 adresses pour un nom.');
    const out: string[] = [];
    for (const x of l) { const a = adressePropre(x); if (!a.ok) return pasValeur(a.message); if (!out.includes(a.ip)) out.push(a.ip); }
    return out;
  };
  if (sorteDemandee === 'a' || sorteDemandee === 'joker') {
    const a = adresses(); if (!Array.isArray(a)) return a;
    to = a; sorte = n.joker ? 'joker' : sorteDe(cle, a);
  } else if (sorteDemandee === 'alias') {
    const c = nomPropre(val.trim());
    if (!c.ok || c.joker) return pasValeur('Écris le vrai nom de la machine, par exemple « serveur.' + domaine + ' ».');
    if (c.ascii === cle) return pasValeur('Un nom ne peut pas être l\'alias de lui-même.');
    to = [c.ascii]; sorte = 'alias';
  } else if (sorteDemandee === 'texte') {
    const t = val.trim();
    if (!t || /[\u0000-\u001f\u007f-\u009f]/.test(val) || Buffer.byteLength(t, 'utf8') > 255) return pasValeur('Le texte : de 1 à 255 caractères simples (moins pour des lettres accentuées ou d\'autres écritures), sans caractère invisible.');
    to = [`TXT ${t}`]; sorte = 'texte';
  } else {
    // Comme avant le lot : la valeur dit la sorte. Des enregistrements écrits « MX 10 … ; TXT … », ou des adresses, ou un nom.
    const raw = val.trim();
    if (!raw) return pasValeur('Valeur vide.');
    if (/^(A|AAAA|CNAME|MX|TXT|SRV|NS|PTR)\s/i.test(raw)) {
      // Comme avant le lot : un retour à la ligne (ou une tabulation, un caractère invisible) n'entre jamais dans ce qui est rangé.
      if (CONTROLE.test(raw)) return pasValeur('Un enregistrement écrit tient sur une ligne, sans caractère invisible : écris-le de nouveau, sans copier-coller.');
      to = raw.split(';').map((x) => x.trim()).filter(Boolean);
      for (const x of to) {
        const m = TYPE_ECRIT.exec(x); if (!m) return pasValeur('Un enregistrement écrit n\'est pas compris : « A », « AAAA », « CNAME », « MX », « TXT », « SRV », « NS » ou « PTR », suivi de sa valeur.');
        const k = m[1].toUpperCase(), v = m[2].trim();
        const ok = k === 'A' ? adressePropre(v).ok && adressePropre(v).famille === 4 : k === 'AAAA' ? adressePropre(v).ok && adressePropre(v).famille === 6 : k === 'TXT' ? v.length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(v)
          : k === 'MX' ? /^\d+\s+\S+$/.test(v) && nomPropre(v.split(/\s+/)[1]).ok : k === 'SRV' ? /^\d+\s+\d+\s+\d+\s+\S+$/.test(v) && nomPropre(v.split(/\s+/)[3]).ok : nomPropre(v).ok && !nomPropre(v).joker;
        if (!ok) return pasValeur(`Enregistrement ${k} mal écrit.`);
      }
    } else {
      const l = raw.split(/[\s,]+/).filter(Boolean);
      if (l.length === 1 && !ipPropre(l[0]) && !isIPv6(l[0])) {
        const c = nomPropre(l[0]); if (!c.ok || c.joker) return pasValeur('Valeur mal écrite : une adresse, ou le nom d\'une machine.');
        if (c.ascii === cle) return pasValeur('Un nom ne peut pas être l\'alias de lui-même.');
        to = [c.ascii];
      } else { const a = adresses(); if (!Array.isArray(a)) return a; to = a; }
    }
    sorte = sorteDe(cle, to);
  }
  const horsMaison = !deLaMaison(base, domaine);
  const avis = horsMaison ? [`« ${n.unicode} » n'est pas un nom de la maison (« .${domaine} ») : il existe peut-être sur Internet. Pour tous les appareils de la maison, Odin répondra à sa place ; le vrai site ne sera plus joignable par ce nom depuis la maison.`] : [];
  return { ok: true, code: 'ok', message: `« ${n.unicode} » → ${valeurLisible(to)}`, avis, nom: cle, unicode: n.unicode, sorte, to, horsMaison, existe };
}

export interface LigneNom {
  /** le nom dans sa langue */
  nom: string;
  /** le nom rangé (ASCII) */
  ascii: string;
  sorte: SorteNom; valeur: string; valeurs: string[]; origine: OrigineNom;
  /** un nom automatique ou celui d'Odin : il ne se change pas ici */
  verrouille: boolean;
  /** un nom à la main du même nom passe avant celui-ci dans le DNS */
  remplace: boolean;
  qui?: string; mac?: string;
  /** la dernière fois qu'un appareil a demandé ce nom (journal du DNS) */
  derniere?: number;
}
const PRIVEE = (ip: string) => { const n = ipNum(ip) >>> 0; return (n >>> 24) === 10 || (n >>> 20) === 0xac1 || (n >>> 16) === 0xc0a8; };
/** L'adresse → le nom de l'inverse : « 30.2.0.192.in-addr.arpa ». Pur. */
export const nomInverse = (ip: string) => `${ip.split('.').reverse().join('.')}.in-addr.arpa`;

/** Tous les noms que le DNS d'Odin sert pour la maison, leurs sortes comptées, et les inverses donnés tout seuls. Pur. */
export function listeNoms(e: EntreeNoms & { derniere?: (ascii: string) => number | undefined }): { lignes: LigneNom[]; inverses: Array<{ adresse: string; nom: string }>; comptes: Record<SorteNom, number> } {
  const lignes: LigneNom[] = [], main = e.main;
  const ordre: Record<OrigineNom, number> = { odin: 0, main: 1, fixe: 2, dhcp: 3 };
  for (const [ascii, to] of Object.entries(main)) {
    const l = Array.isArray(to) ? to.map(String) : [];
    lignes.push({ nom: ascii.startsWith('*.') ? `*.${domainToUnicode(ascii.slice(2)) || ascii.slice(2)}` : domainToUnicode(ascii) || ascii, ascii, sorte: sorteDe(ascii, l), valeur: valeurLisible(l), valeurs: l, origine: 'main', verrouille: false, remplace: false, derniere: e.derniere?.(ascii) });
  }
  for (const a of e.automatiques) {
    lignes.push({ nom: domainToUnicode(a.nom) || a.nom, ascii: a.nom, sorte: 'a', valeur: a.ip, valeurs: [a.ip], origine: a.origine, verrouille: true, remplace: Object.hasOwn(main, a.nom), ...(a.qui ? { qui: a.qui } : {}), ...(a.mac ? { mac: a.mac } : {}), derniere: e.derniere?.(a.nom) });
  }
  lignes.sort((x, y) => ordre[x.origine] - ordre[y.origine] || x.ascii.localeCompare(y.ascii));
  // L'inverse : une adresse de la maison (ou privée) → un seul nom, celui d'Odin d'abord, puis à la main, adresse fixe, DHCP.
  const inv = new Map<string, string>();
  for (const l of lignes) {
    if (l.remplace || l.sorte !== 'a' || l.ascii.startsWith('*.')) continue;
    for (const x of l.valeurs) {
      const m = TYPE_ECRIT.exec(x.trim()), ip = ipPropre(m ? (m[1].toUpperCase() === 'A' ? m[2].trim() : '') : x);
      if (ip && (PRIVEE(ip) || e.reseau?.(ip)) && !inv.has(ip)) inv.set(ip, l.ascii);
    }
  }
  const inverses = [...inv].sort((a, b) => ipNum(a[0]) - ipNum(b[0])).map(([adresse, nom]) => ({ adresse, nom }));
  const comptes = Object.fromEntries(SORTES_NOMS.map((k) => [k, 0])) as Record<SorteNom, number>;
  for (const l of lignes) if (!l.remplace) comptes[l.sorte]++;
  comptes.inverse = inverses.length;
  return { lignes, inverses, comptes };
}
