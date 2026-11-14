// Gygès — les fiches : les seules personnes et sociétés qu'on peut chercher. Trois genres, pas un de plus :
// « moi » (le propriétaire), ses sociétés, et un proche SEULEMENT si son accord est noté (qui l'a donné, quand,
// comment). Aucune recherche ne part d'un nom tapé au vol : elle part de l'identifiant d'une fiche.
// Ici aussi : la mise en forme des identifiants (numéros, e-mails, pseudos, domaines) et leur masquage
// (« 06 •• •• •• 12 ») pour tout ce qui sort de l'appli (alertes, réponses lues par l'IA, tableaux).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';
import type { ModCtx } from '../types.ts';

export type Genre = 'moi' | 'societe' | 'proche';
/** L'accord d'un proche : qui l'a donné, quel jour, comment ; et quand il a été noté dans Odin. */
export interface Accord { par: string; le: string; comment: string; note: string }
export interface Fiche {
  id: string; genre: Genre;
  /** le nom affiché (« Awa Saïd », « TOUFATECH ») */
  nom: string; prenom?: string; famille?: string;
  /** autres écritures à chercher : nom de naissance, nom d'usage ; pour une société : enseigne, sigle */
  noms: string[]; villes: string[]; adresses: string[]; telephones: string[]; emails: string[]; pseudos: string[];
  /** société : ses noms de domaine et ses comptes officiels (« instagram.com/toufatech ») */
  domaines: string[]; comptes: string[];
  accord?: Accord; creee: string; modifiee: string;
  /** la dernière recherche complète (la revérification du mois part de là) */
  verifiee?: string;
}
export const MAX_PROCHES = 5, MAX_SOCIETES = 10;
/** Un accord se redemande : au bout de douze mois, Gygès ne cherche plus rien sur le proche tant qu'il n'est pas noté de nouveau. */
export const ACCORD_MOIS = 12;
const MAX: Record<'noms' | 'villes' | 'adresses' | 'telephones' | 'emails' | 'pseudos' | 'domaines' | 'comptes', number> = { noms: 4, villes: 4, adresses: 4, telephones: 5, emails: 6, pseudos: 8, domaines: 6, comptes: 12 };

// ---------------------------------------------------------------- fichiers de l'appli (dossier protégé)
/** Lit un fichier JSON du dossier de l'appli (ou la valeur vide s'il n'existe pas encore). */
export function lire<T>(ctx: ModCtx, nom: string, vide: T): T { try { return JSON.parse(readFileSync(join(ctx.dir, nom), 'utf8')) as T; } catch { return vide; } }
/** Écrit un fichier JSON du dossier de l'appli : d'un coup (jamais à moitié écrit), lisible par Odin seul. */
export function ecrire(ctx: ModCtx, nom: string, v: unknown): void {
  mkdirSync(ctx.dir, { recursive: true, mode: 0o700 });
  const f = join(ctx.dir, nom), tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); renameSync(tmp, f);
}
export const fiches = (ctx: ModCtx): Fiche[] => lire<Fiche[]>(ctx, 'fiches.json', []);
export const garderFiches = (ctx: ModCtx, l: Fiche[]) => ecrire(ctx, 'fiches.json', l);

// ---------------------------------------------------------------- mise en forme (pur)
export const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'");
const net = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Une liste tapée dans un formulaire (une valeur par ligne, ou séparées par des virgules). Pur. */
export const liste = (v: unknown, sep: RegExp = /[\n,;]+/) => [...new Set(String(v ?? '').split(sep).map(net).filter(Boolean))];
export const slug = (t: string) => plat(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'fiche';

/** L'indicatif d'un numéro français écrit « 0… » : métropole, ou outre-mer (0269 et 0639 : Mayotte ; 0262, 0692 : La Réunion…). Pur. */
const indicatif = (n: string) => (/^0(26[239]|639|69[23])/.test(n) ? '262' : /^0(590|69[01])/.test(n) ? '590' : /^0(594|694)/.test(n) ? '594' : /^0(596|69[67])/.test(n) ? '596' : /^0508/.test(n) ? '508' : '33');
/**
 * Un numéro de téléphone tel qu'on le tape → sa forme nationale (« 0639123456 ») et internationale (« +262639123456 »).
 * Rien s'il n'a pas la forme d'un numéro. Pur.
 */
export function telephone(brut: string): { national: string; inter: string } | undefined {
  const t = net(brut).replace(/[\s.\-()/]/g, '');
  if (!/^\+?\d{8,15}$/.test(t)) return undefined;
  if (/^(\+|00)/.test(t)) { const d = t.replace(/^(\+|00)/, ''), fr = /^(33|262|590|594|596|508)(\d{9})$/.exec(d); return { inter: `+${d}`, national: fr ? `0${fr[2]}` : `+${d}` }; }
  if (/^0\d{9}$/.test(t)) return { national: t, inter: `+${indicatif(t)}${t.slice(1)}` };
  return { national: t, inter: t };
}
/** Les écritures d'un numéro qu'on trouve sur le web : collé, par paires, international. Pur. */
export function formesTel(n: string): string[] {
  const t = telephone(n); if (!t) return [];
  const paires = /^0\d{9}$/.test(t.national) ? t.national.replace(/(\d\d)(?=\d)/g, '$1 ') : t.national;
  return [...new Set([paires, t.national, t.inter])];
}
export const courriel = (brut: string) => { const e = net(brut).toLowerCase(); return /^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/.test(e) && e.length <= 120 ? e : undefined; };
export const pseudo = (brut: string) => { const p = net(brut).replace(/^@/, ''); return /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(p) ? p : undefined; };
/** Un nom de domaine propre (« https://www.Exemple.fr/page » → « exemple.fr »), ou rien. Pur. */
export function domaine(brut: string): string | undefined {
  const d = domainToASCII(net(brut).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, ''));
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,23}$/.test(d) ? d : undefined;
}
/** Un compte officiel : l'adresse de son profil, sans « https:// » ni « www. » (« instagram.com/toufatech »). Pur. */
export function compte(brut: string): string | undefined {
  const b = net(brut); if (!b) return undefined;
  try { const u = new URL(/^https?:\/\//i.test(b) ? b : `https://${b}`), h = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, ''), p = u.pathname.replace(/\/+$/, ''); return domaine(h) && p.length > 1 ? `${h}${p}`.slice(0, 200) : undefined; } catch { return undefined; }
}
const nomDePersonne = (t: string) => /^[\p{L}][\p{L}\p{M}' .-]{0,78}$/u.test(t), nomDeSociete = (t: string) => /^[\p{L}\p{N}][\p{L}\p{M}\p{N}' .&+@!-]{0,78}$/u.test(t);

export interface Saisie { prenom?: unknown; nom?: unknown; autres_noms?: unknown; villes?: unknown; adresses?: unknown; telephones?: unknown; emails?: unknown; pseudos?: unknown; domaines?: unknown; comptes?: unknown }
/**
 * Les identifiants d'une fiche, vérifiés un par un. Une valeur mal écrite arrête tout avec une phrase claire
 * (on ne cherche pas « à peu près » un numéro). Pur.
 */
export function identifiants(genre: Genre, i: Saisie): Pick<Fiche, 'nom' | 'prenom' | 'famille' | 'noms' | 'villes' | 'adresses' | 'telephones' | 'emails' | 'pseudos' | 'domaines' | 'comptes'> {
  const prenom = net(i.prenom), famille = net(i.nom), societe = genre === 'societe';
  if (!famille) throw new Error(societe ? 'il manque le nom de la société' : 'il manque le nom de famille');
  if (societe ? !nomDeSociete(famille) : !nomDePersonne(famille) || (prenom !== '' && !nomDePersonne(prenom))) throw new Error('ce nom contient des caractères que je ne sais pas chercher (lettres, espaces, tirets et apostrophes seulement)');
  if (!societe && !prenom) throw new Error('il manque le prénom (un nom de famille seul ramène tous les homonymes)');
  const borne = <T>(cle: keyof typeof MAX, l: T[]) => { if (l.length > MAX[cle]) throw new Error(`trop de valeurs pour « ${cle} » (${MAX[cle]} au plus)`); return l; };
  const chaque = <T>(cle: keyof typeof MAX, brut: string[], f: (x: string) => T | undefined, quoi: string) => borne(cle, [...new Set(brut.map((x) => { const v = f(x); if (v === undefined) throw new Error(`« ${x.slice(0, 60)} » n'est pas ${quoi}`); return v; }))]);
  return {
    nom: societe ? famille : `${prenom} ${famille}`, ...(societe ? {} : { prenom, famille }),
    noms: chaque('noms', liste(i.autres_noms), (x) => ((societe ? nomDeSociete(x) : nomDePersonne(x)) ? x : undefined), 'un nom que je sais chercher'),
    villes: chaque('villes', liste(i.villes), (x) => (/^[\p{L}][\p{L}\p{M}' .-]{1,58}$/u.test(x) ? x : undefined), 'un nom de ville'),
    adresses: chaque('adresses', liste(i.adresses, /\n+/), (x) => (x.length >= 6 && x.length <= 160 ? x : undefined), 'une adresse postale (une par ligne)'),
    telephones: chaque('telephones', liste(i.telephones), (x) => telephone(x)?.national, 'un numéro de téléphone'),
    emails: chaque('emails', liste(i.emails), courriel, 'une adresse e-mail'),
    pseudos: chaque('pseudos', liste(i.pseudos), pseudo, 'un pseudo (lettres, chiffres, point, tiret)'),
    domaines: chaque('domaines', liste(i.domaines), domaine, 'un nom de domaine'),
    comptes: chaque('comptes', liste(i.comptes), compte, 'l\'adresse d\'un profil (ex. instagram.com/ma-societe)'),
  };
}

/** Une date tapée (« 2026-11-12 » ou « 12/11/2026 ») → « 2026-11-12 », ou rien. Pur. */
export function jour(brut: unknown): string | undefined {
  const t = net(brut), a = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t), b = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const [y, m, d] = a ? [Number(a[1]), Number(a[2]), Number(a[3])] : b ? [Number(b[3]), Number(b[2]), Number(b[1])] : [0, 0, 0];
  const x = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
}
/** Le jour d'une date, à l'heure de la machine (« 2026-11-13 »). Pur. */
export const jourLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** « 2026-11-13 » → « 13/11/2026 ». Pur. */
export const jourFr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
/** L'accord d'un proche, complet ou refusé : qui, quand, comment. Sans les trois, pas de fiche. Pur. */
export function accord(i: { accord_par?: unknown; accord_le?: unknown; accord_comment?: unknown }, now: Date): Accord {
  const par = net(i.accord_par), comment = net(i.accord_comment), le = jour(i.accord_le);
  if (par.length < 2 || comment.length < 4 || !net(i.accord_le)) throw new Error('sans l\'accord de cette personne, pas de fiche : note qui a donné l\'accord, quel jour, et comment (de vive voix, par message, par écrit…)');
  if (!le) throw new Error('le jour de l\'accord n\'est pas une date (écris 2026-11-12 ou 12/11/2026)');
  if (le > jourLocal(now)) throw new Error('le jour de l\'accord est dans le futur : note l\'accord une fois qu\'il est donné');
  return { par: par.slice(0, 80), le, comment: comment.slice(0, 200), note: now.toISOString() };
}
/** L'accord d'un proche tient-il encore ? (moi et sociétés : toujours ; proche : accord noté depuis moins de douze mois). Pur. */
export function accordValide(f: Fiche, now: Date): boolean {
  if (f.genre !== 'proche') return true;
  if (!f.accord?.le || !f.accord.par || !f.accord.comment) return false;
  const fin = new Date(`${f.accord.le}T00:00:00Z`); fin.setUTCMonth(fin.getUTCMonth() + ACCORD_MOIS);
  return now.getTime() < fin.getTime();
}
/** Comment on parle de la fiche dans une alerte : « toi », le nom de la société, ou le prénom et l'initiale d'un proche. Pur. */
export const etiquette = (f: Fiche) => (f.genre === 'moi' ? 'toi' : f.genre === 'societe' ? f.nom : `${f.prenom ?? f.nom} ${(f.famille ?? '').slice(0, 1).toUpperCase()}.`.trim());
/** La fiche désignée : par son identifiant, ou par son nom exact. Jamais créée ici. */
export function trouver(l: Fiche[], ref: unknown): Fiche | undefined {
  const k = net(ref) || 'moi', n = plat(k);
  return l.find((f) => f.id === k) ?? l.find((f) => plat(f.nom) === n) ?? (/^(moi|ma fiche|la mienne)$/.test(n) ? l.find((f) => f.genre === 'moi') : undefined);
}

// ---------------------------------------------------------------- masquage (pur)
/** « 0639123456 » → « 06 •• •• •• 56 ». */
export function masqueTel(n: string): string {
  const d = n.replace(/[^\d+]/g, '');
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 2)} •• •• •• ${d.slice(-2)}` : d.length >= 6 ? `${d.slice(0, d.startsWith('+') ? 4 : 2)} ••• ${d.slice(-2)}` : '•••';
}
/** « awa.said@exemple.yt » → « a•••@exemple.yt ». */
export const masqueMail = (e: string) => { const [a, b] = e.split('@'); return b ? `${a.slice(0, 1)}•••@${b}` : '•••'; };
/** « 12 rue des Fleurs, 97600 Mamoudzou » → « •••, 97600 Mamoudzou » (la rue ne sort jamais). */
export function masqueAdresse(a: string): string { const m = /\b(\d{5})\b\s*(.*)$/.exec(a); return m ? `•••, ${m[1]} ${m[2]}`.trim() : '••• (adresse masquée)'; }
/** La partie « rue » d'une adresse (avant le code postal ou la première virgule). Pur. */
export const rueDe = (a: string) => net(a.split(/,|\b\d{5}\b/)[0] ?? '').replace(/[.;]+$/, '');
const sur = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RUE = /\b\d{1,4}\s*(?:bis|ter|quater)?\s*,?\s*(?:rue|avenue|av\.?|boulevard|bd\.?|chemin|impasse|all[ée]e|route|rte|place|quai|cours|passage|square|lotissement|r[ée]sidence|cit[ée]|quartier|voie|sentier|ruelle)\s+[^,;:\n()«»"]{2,60}/giu;
/**
 * Masque dans un texte venu d'ailleurs (titre, extrait d'un résultat) tout ce qui ressemble à un numéro de téléphone,
 * une adresse e-mail ou une rue, et les rues des fiches même écrites sans numéro. Ce texte peut partir dans une
 * alerte ou être lu par l'IA : les coordonnées n'y figurent jamais en entier. Pur.
 */
export function masquer(texte: string, l: Fiche[] = []): string {
  let t = texte.replace(/[^\s@<>"',;()]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi, (e) => masqueMail(e));
  for (const f of l) for (const a of f.adresses) { const r = rueDe(a); if (r.length >= 5) t = t.replace(new RegExp(sur(r).replace(/\s+/g, '[\\s,]+'), 'giu'), '••• (adresse masquée)'); }
  t = t.replace(RUE, '••• (adresse masquée)');
  // Un numéro : écrit à la française (« 06 39 12 34 56 », collé ou avec des points) ou à l'international (« +262 639… »).
  // Une date suivie d'une heure (« 09-11-2026 10:30 ») n'en est pas un.
  return t.replace(/(?<![\w@./:-])(?:(?:\+|00)\d(?:[\s.\-]?\d){7,13}|0[1-9](?:[\s.\-]?\d{2}){4})(?![\w@/:-])/g, (n) => masqueTel(telephone(n)?.national ?? n));
}
/** Les identifiants d'une fiche, masqués, en une ligne (pour la page et les réponses). Pur. */
export function resumeMasque(f: Fiche): string {
  const p = (n: number, un: string, pl = `${un}s`) => (n ? `${n} ${n > 1 ? pl : un}` : '');
  return [f.villes.length ? f.villes.join(', ') : '', ...f.telephones.map(masqueTel), ...f.emails.map(masqueMail), ...f.adresses.map(masqueAdresse), p(f.pseudos.length, 'pseudo'), ...(f.genre === 'societe' ? [f.domaines.join(', '), p(f.comptes.length, 'compte officiel', 'comptes officiels')] : []), p(f.noms.length, 'autre nom', 'autres noms')].filter(Boolean).join(' · ') || 'aucun identifiant';
}
