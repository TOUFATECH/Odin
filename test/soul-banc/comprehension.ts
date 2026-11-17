// Banc de Soul : la COMPRÉHENSION complète d'une demande. Le banc d'aiguillage (mesure.ts) ne dit que « la bonne appli »
// et « la bonne action » ; celui-ci mesure en plus les RÉGLAGES de l'action, et ce qu'il faut faire quand il en MANQUE un
// (le demander, pas l'inventer) ou quand la demande est ambiguë.
//
// Une demande de compréhension (jeux/comprehension-*.json) :
//   { id, langue, ecriture, phrase, appli, action, reglages: { nom: valeur attendue }, manque: [noms],
//     sorte: 'complete' | 'manque' | 'ambigue' | 'hors-champ', contexte?: { precedent }, aussi?: ['appli.action'], aRelire }
//   - complete   : la phrase donne tous les réglages obligatoires ; la bonne réponse est d'AGIR avec ces réglages ;
//   - manque     : un réglage obligatoire (ou plusieurs) n'est pas dit ; la bonne réponse est de le DEMANDER, avec les
//                  autres réglages déjà bien compris, sans rien inventer pour lui ;
//   - ambigue    : on ne peut pas savoir sans demander (quelle appli, quel appareil, quelle valeur) ; la bonne réponse
//                  est de ne PAS agir seul (demander ou passer la main) ;
//   - hors-champ : aucune appli d'Odin ne le fait ; la bonne réponse est de ne choisir aucune appli.
//   `reglages` liste TOUTES les valeurs que la phrase donne aux réglages de l'action (obligatoires ou non) ;
//   `manque` les réglages OBLIGATOIRES qu'elle ne donne pas.
//
// Une réponse de méthode : { appli, action, reglages, manque, decision: 'agir' | 'demander' | 'passer' }.
//
// Comparaison des valeurs (memeValeur) — tolérante, et toujours la même :
//   - textes : minuscules, sans accents, largeur des caractères ramenée (NFKC), guillemets et ponctuation du bord
//     retirés, espaces simples ; puis, si ce n'est pas égal, les petits mots du bord retirés (« le », « la », « the »,
//     « el », « der »… : liste BORD ci-dessous) ; puis la même chose sans aucun signe hors lettres et chiffres
//     (« lampe-du-salon » = « lampe du salon », « 22° » = « 22 ») ;
//   - adresses web : sans « http(s):// », sans « www. », sans « / » final ;
//   - nombres : « 22 », 22 et « 22,0 » sont égaux ; pour une durée (minutes, duree, secondes, duree_h), « 2 h »,
//     « 120 min » et « PT2H » sont convertis dans l'unité du réglage ;
//   - dates : attendu « AAAA-MM-JJ » (date seule : l'heure obtenue, s'il y en a une, est ignorée), « AAAA-MM-JJ HH:MM »
//     (date et heure toutes deux exigées), « HH:MM » (heure seule : la date obtenue est ignorée). Obtenu : ISO, JJ/MM/AAAA,
//     « 14h30 », « 2 pm », un objet Date, ou — si le réglage accepte un texte libre (« jeudi 14 h ») — ce texte résolu
//     par `resoudreDate` quand on en donne un (le lanceur donne celui de l'appli elle-même, à l'heure figée du banc) ;
//   - oui / non : true, « oui », « on », « 1 »… ; « on » / « off » d'un appareil : « allume », « true »… comptent ;
//     « ouvrir » / « fermer » : « ouvre », « open », « on » / « ferme », « close », « shut », « off »… comptent ;
//   - une heure ISO avec fuseau (« …Z ») est ramenée à l'heure locale ;
//   - listes (attendu en tableau) : l'ordre ne compte pas ; l'obtenu peut être un tableau ou un texte coupé aux
//     virgules, « et », « and », « y », « und », « e », « 、 », « 和 », « と », « и », « و » ;
//   - plusieurs bonnes valeurs : { "un_de": [v1, v2] }.
//
// Réglages inventés à tort : une valeur donnée par la méthode à un réglage de `manque` (inventée). À part, « en trop » :
// une valeur pour un réglage que la phrase ne donne pas (ni dans `reglages`, ni dans `manque`) et qui n'est pas sa valeur
// par défaut — compté et publié, mais il ne casse pas « entièrement comprise » (le jeu peut avoir oublié un réglage
// facultatif ; voir les cas discutables du rapport).
//
// Entièrement comprise :
//   - complete   : bonne appli et bonne action (ou l'une de `aussi`), chaque réglage attendu juste, décision « agir »,
//                  aucun réglage déclaré manquant ;
//   - manque     : bonne appli et bonne action, chaque réglage DONNÉ juste, décision « demander », les réglages déclarés
//                  manquants sont exactement ceux de `manque`, aucun inventé ;
//   - ambigue    : la décision n'est pas « agir » ;
//   - hors-champ : aucune appli choisie, ou décision « passer ».
//
// Le TITRE (version 2, relecture du 17/11) : la part entièrement comprise parmi les demandes du CHAMP (complete et
// manque) seulement. Les ambiguës et les hors-champ se gagnent en passant la main : une méthode qui passe toujours y
// fait le plein ; elles sont publiées à part, chacune avec la base « toujours passer la main » à côté. L'objectif de
// 100 % se lit sorte par sorte, jamais sur le total mêlé. Les ratées où la méthode dit ne pas connaître la chose
// nommée sont comptées à part : le banc n'a ni appareil ni conteneur (ce chiffre mêle comprendre et connaître la maison ;
// il compte aussi les fois où la méthode a mal découpé la phrase et cherche un nom qui n'existe pas).
import { wilson, type Proportion } from './mesure.ts';

export type SorteC = 'complete' | 'manque' | 'ambigue' | 'hors-champ';
export type Valeur = string | number | boolean | Valeur[] | { un_de: Valeur[] };
export interface DemandeC {
  id: string; langue: string; ecriture: string; phrase: string;
  appli: string | null; action: string | null; reglages: Record<string, Valeur>; manque: string[];
  sorte: SorteC; contexte?: { precedent?: string }; aussi?: string[]; aRelire?: boolean; note?: string;
}
export interface JeuC { version: number | string; origine: string; fige?: boolean; maintenant: string; demandes: DemandeC[]; [cle: string]: unknown }
export type DecisionC = 'agir' | 'demander' | 'passer';
/** `vu` : l'appli et l'action que la méthode avait comprises, même quand elle passe (diagnostic seulement). */
export interface ReponseC { appli: string | null; action: string | null; reglages: Record<string, unknown>; manque: string[]; decision: DecisionC; detail?: string; vu?: { appli: string | null; action: string | null } }
export interface ResultatC { demande: DemandeC; reponse: ReponseC; ms: number }
/** Ce qu'on sait d'un réglage d'une action (tiré du catalogue du produit). */
export interface InfoParam { key: string; kind: string; required: boolean; default?: unknown; options?: string[] }
export type InfosActions = Map<string, InfoParam[]>;
export interface OptionsC { infos?: InfosActions; resoudreDate?: (texte: string) => Date | undefined }

// ------------------------------------------------------------------------------------------------ comparaison des valeurs
/** Petits mots qui peuvent border une valeur sans la changer (articles, possessifs), dans les langues des jeux. */
export const BORD = new Set(('le la les l un une des du de d au aux a mon ma mes ton ta tes son sa ses ce cet cette ces notre nos votre vos leur leurs '
  + 'the a an my your our his her their this that these those to '
  + 'el la los las lo un una unos unas mi mis tu tus su sus del al '
  + 'der die das den dem des ein eine einen einem einer mein meine meinen meinem '
  + 'il lo gli i un uno una mio mia miei mie dello della dei delle '
  + 'o os as um uma meu minha meus minhas do da dos das no na').split(' '));

/** Forme comparable d'un texte (voir l'en-tête). */
export function normerTexte(t: string): string {
  return String(t).normalize('NFKC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/[’`´]/g, "'").replace(/[«»“”„"‹›「」『』]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[\s.,;:!?¿¡。、，！？'()[\]-]+|[\s.,;:!?¿¡。、，！？'()[\]-]+$/g, '').trim();
}
/** Retire les petits mots du bord (« la lampe du salon » → « lampe du salon »). */
export function sansBord(t: string): string {
  const m = normerTexte(t).replace(/\b([ldj])'/g, '$1 ').split(' ').filter(Boolean);
  while (m.length > 1 && BORD.has(m[0])) m.shift();
  while (m.length > 1 && BORD.has(m[m.length - 1])) m.pop();
  return m.join(' ');
}
const seulementAlnum = (t: string) => normerTexte(t).replace(/[^\p{L}\p{N}]+/gu, '');
const ADRESSE = /^(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+[a-z]{2,24}(?::\d+)?(?:\/\S*)?$/iu;
const adresseNette = (t: string) => normerTexte(t).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/** Une date ou une heure lue dans une valeur obtenue : { date: 'AAAA-MM-JJ', heure: 'HH:MM' } (chacune facultative). */
export function lireMoment(x: unknown): { date?: string; heure?: string } {
  const d2 = (n: number) => String(n).padStart(2, '0');
  if (x instanceof Date && !Number.isNaN(x.getTime())) return { date: `${x.getFullYear()}-${d2(x.getMonth() + 1)}-${d2(x.getDate())}`, heure: `${d2(x.getHours())}:${d2(x.getMinutes())}` };
  const t = normerTexte(String(x ?? ''));
  // Une heure ISO avec un fuseau (« …Z », « +01:00 ») : ramenée à l'heure locale, comme un objet Date.
  const zone = /(\d{4}-\d{2}-\d{2})[t ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(z|[+-]\d{2}:?\d{2})\b/.exec(t);
  if (zone) { const d = new Date(`${zone[1]}T${zone[2]}${zone[3].toUpperCase()}`); if (!Number.isNaN(d.getTime())) return lireMoment(d); }
  const out: { date?: string; heure?: string } = {};
  const iso = /(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?/.exec(t);
  if (iso) { out.date = `${iso[1]}-${iso[2]}-${iso[3]}`; if (iso[4]) out.heure = `${d2(Number(iso[4]))}:${iso[5]}`; }
  else { const fr = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(t); if (fr) out.date = `${fr[3]}-${d2(Number(fr[2]))}-${d2(Number(fr[1]))}`; }
  if (!out.heure) {
    const rest = iso ? t.replace(iso[0], ' ') : t;
    const pm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(rest);
    const h = pm ? null : /(?:^|[^\d])(\d{1,2})\s*(?:h|:|heures?\b|uhr\b|時)\s*(\d{2})?/.exec(rest);
    if (pm) { let hh = Number(pm[1]) % 12; if (/^p/.test(pm[3])) hh += 12; out.heure = `${d2(hh)}:${pm[2] ?? '00'}`; }
    else if (h && Number(h[1]) < 24) out.heure = `${d2(Number(h[1]))}:${h[2] ?? '00'}`;
  }
  return out;
}
/** Un nombre lu dans une valeur obtenue ; pour une durée, converti dans l'unité du réglage. */
export function lireNombre(x: unknown, cle = ''): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'boolean' || x === null || x === undefined) return undefined;
  const t = normerTexte(String(x)).replace(/(\d),(\d)/g, '$1.$2');
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const unite = /^(minutes|duree)$/.test(cle) ? 60 : cle === 'secondes' ? 1 : cle === 'duree_h' ? 3600 : 0;
  if (unite) {
    const iso = /^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    let s: number | undefined;
    if (iso && (iso[1] || iso[2] || iso[3])) s = Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
    else {
      const hm = /^(\d+)\s*h\s*(\d{1,2})$/.exec(t);
      const m = /^(\d+(?:\.\d+)?)\s*(secondes?|sec|s|minutes?|min|mn|m|heures?|hours?|hrs?|h|jours?|days?|j|d)$/.exec(t);
      if (hm) s = Number(hm[1]) * 3600 + Number(hm[2]) * 60;
      else if (m) { const u = m[2]; s = Number(m[1]) * (/^s/.test(u) ? 1 : /^(m)/.test(u) ? 60 : /^(h)/.test(u) ? 3600 : 86400); }
    }
    if (s !== undefined) return s / unite;
  }
  const n = /^(-?\d+(?:\.\d+)?)\s*(?:%|°c?|degres?|go|mo|gb|mb|caracteres?|characters?|jours?|days?)?$/.exec(t);
  return n ? Number(n[1]) : undefined;
}
const OUI = new Set(['true', 'oui', 'yes', 'si', 'ja', 'sim', 'on', '1', 'vrai', 'active', 'actif']);
const NON = new Set(['false', 'non', 'no', 'nein', 'nao', 'off', '0', 'faux', 'desactive', 'inactif']);
const ALLUME = new Set(['on', 'allume', 'allumer', 'true', '1', 'marche', 'active', 'activer']);
const ETEINT = new Set(['off', 'eteint', 'eteins', 'eteindre', 'false', '0', 'arret', 'coupe', 'couper', 'desactive', 'desactiver']);
// Ouvrir / fermer : ce que la commande d'un appareil du produit accepte (src/valhalla/modules/appareils.ts : « ouvre »
// et « open » valent « on », « ferme » vaut « off »), plus les formes françaises et anglaises de la même valeur.
const OUVRE = new Set(['ouvrir', 'ouvre', 'ouvert', 'ouverte', 'open', 'opened', 'on', '1', 'true']);
const FERME = new Set(['fermer', 'ferme', 'fermee', 'close', 'closed', 'shut', 'off', '0', 'false']);
/** Une liste obtenue (tableau, ou texte coupé aux séparateurs). */
export function lireListe(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((y) => String(y));
  return String(x ?? '').split(/\s*(?:,|;|、|，|،|&|\+|\s(?:et|and|y|und|e|и|و)\s|和|と|및)\s*/u).map((y) => y.trim()).filter((y) => y && !BORD.has(normerTexte(y)));
}

/** La valeur obtenue vaut-elle la valeur attendue ? (règles dans l'en-tête) */
export function memeValeur(attendu: Valeur, obtenu: unknown, cle = '', o: { resoudreDate?: (t: string) => Date | undefined; texteLibre?: boolean } = {}): boolean {
  if (obtenu === undefined || obtenu === null || obtenu === '') return false;
  if (attendu && typeof attendu === 'object' && !Array.isArray(attendu)) return (attendu as { un_de: Valeur[] }).un_de.some((v) => memeValeur(v, obtenu, cle, o));
  if (Array.isArray(attendu)) {
    const recus = lireListe(obtenu);
    if (recus.length !== attendu.length) {
      // Une liste de un : le texte entier peut être la valeur (« salle de bain »).
      return attendu.length === 1 && memeValeur(attendu[0], obtenu, cle, o);
    }
    const libres = [...recus];
    return attendu.every((a) => { const i = libres.findIndex((r) => memeValeur(a, r, cle, o)); if (i < 0) return false; libres.splice(i, 1); return true; });
  }
  if (typeof attendu === 'boolean') {
    if (typeof obtenu === 'boolean') return obtenu === attendu;
    const t = normerTexte(String(obtenu));
    return attendu ? OUI.has(t) : NON.has(t);
  }
  if (typeof attendu === 'number') { const n = lireNombre(obtenu, cle); return n !== undefined && Math.abs(n - attendu) < 1e-9; }
  const a = String(attendu);
  // Dates et heures.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a), dateHeure = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(a), heure = /^\d{2}:\d{2}$/.test(a);
  if (date || dateHeure || heure) {
    const m = lireMoment(obtenu);
    const voulu = { date: date || dateHeure ? a.slice(0, 10) : undefined, heure: heure ? a : dateHeure ? a.slice(11) : undefined };
    const ok = (x: { date?: string; heure?: string }) => (!voulu.date || x.date === voulu.date) && (!voulu.heure || x.heure === voulu.heure);
    if (ok(m)) return true;
    // Un texte libre (« jeudi 14 h ») : résolu comme l'appli le résoudrait ; ce qui est écrit en clair l'emporte.
    if (typeof obtenu === 'string' && o.resoudreDate && (o.texteLibre ?? true)) {
      const r = o.resoudreDate(obtenu);
      if (r) { const mr = lireMoment(r); return ok({ date: m.date ?? mr.date, heure: m.heure ?? mr.heure }); }
    }
    return false;
  }
  if (typeof obtenu === 'boolean') return false;
  const b = String(obtenu), na = normerTexte(a), nb = normerTexte(b);
  if (na === 'on') return ALLUME.has(nb);
  if (na === 'off') return ETEINT.has(nb);
  if (na === 'ouvrir') return OUVRE.has(nb);
  if (na === 'fermer') return FERME.has(nb);
  if (ADRESSE.test(a.trim()) && ADRESSE.test(b.trim())) return adresseNette(a) === adresseNette(b);
  if (na === nb) return true;
  if (sansBord(a) === sansBord(b)) return true;
  const x = seulementAlnum(sansBord(a)), y = seulementAlnum(sansBord(b));
  return x.length > 0 && x === y;
}

// ------------------------------------------------------------------------------------------------ une demande jugée
const horsChamp = (d: DemandeC) => d.appli === null || d.appli === 'aucune';
const aussiDe = (d: DemandeC) => (d.aussi ?? []).map((x) => { const i = x.indexOf('.'); return i > 0 ? { appli: x.slice(0, i), action: x.slice(i + 1) } : { appli: x, action: null as string | null }; });
export interface Jugement {
  appli: boolean; action: boolean;
  /** Diagnostic : la bonne appli·action était-elle comprise, même si la méthode a passé la main ? */
  actionVue: boolean;
  /** Chaque réglage attendu : juste ou non (faux d'office si l'action est fausse). */
  reglages: Record<string, boolean>;
  tousReglages: boolean;
  /** Réglages de `manque` bien déclarés manquants, et sans valeur inventée. */
  manquesReperes: string[]; manquesRates: string[];
  /** Réglages de `manque` auxquels la méthode a donné une valeur. */
  inventes: string[];
  /** Valeurs pour des réglages que la phrase ne donne pas (hors défaut). */
  enTrop: string[];
  /** Réglages déclarés manquants alors que la phrase les donne (ou qu'ils ne sont pas obligatoires). */
  demandesATort: string[];
  decisionJuste: boolean; entiere: boolean;
}
const vide = (x: unknown) => x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0);
const egalDefaut = (x: unknown, d: unknown) => d !== undefined && (x === d || String(x) === String(d));

export function juger(d: DemandeC, r: ReponseC, o: OptionsC = {}): Jugement {
  if (horsChamp(d)) {
    const ok = r.appli === null || r.decision === 'passer';
    return { appli: ok, action: ok, actionVue: ok, reglages: {}, tousReglages: true, manquesReperes: [], manquesRates: [], inventes: [], enTrop: [], demandesATort: [], decisionJuste: ok, entiere: ok };
  }
  const alt = aussiDe(d);
  const appli = r.appli !== null && (r.appli === d.appli || alt.some((a) => a.appli === r.appli));
  const action = appli && ((r.appli === d.appli && (d.action === null || r.action === d.action)) || alt.some((a) => a.appli === r.appli && (a.action === null || a.action === r.action)));
  const params = o.infos?.get(`${r.appli}.${r.action}`) ?? [];
  const pinfo = (k: string) => params.find((p) => p.key === k);
  const reglages: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(d.reglages ?? {})) {
    const p = pinfo(k);
    reglages[k] = action && memeValeur(v, r.reglages?.[k], k, { resoudreDate: o.resoudreDate, texteLibre: !p || p.kind === 'text' || p.kind === 'textarea' });
  }
  const tousReglages = Object.values(reglages).every(Boolean);
  const declares = new Set((r.manque ?? []).filter(Boolean));
  const manques = d.manque ?? [];
  const inventes = action ? manques.filter((k) => !vide(r.reglages?.[k])) : [];
  const manquesReperes = action ? manques.filter((k) => declares.has(k) && vide(r.reglages?.[k])) : [];
  const manquesRates = manques.filter((k) => !manquesReperes.includes(k));
  const connus = new Set([...Object.keys(d.reglages ?? {}), ...manques]);
  const enTrop = action ? Object.entries(r.reglages ?? {}).filter(([k, x]) => !connus.has(k) && !vide(x) && !egalDefaut(x, pinfo(k)?.default)).map(([k]) => k) : [];
  const demandesATort = action ? [...declares].filter((k) => !manques.includes(k)) : [];
  let decisionJuste: boolean, entiere: boolean;
  if (d.sorte === 'ambigue') { decisionJuste = r.decision !== 'agir'; entiere = decisionJuste; }
  else if (d.sorte === 'manque') {
    decisionJuste = r.decision === 'demander';
    entiere = action && tousReglages && decisionJuste && manquesRates.length === 0 && inventes.length === 0 && demandesATort.length === 0;
  } else {
    decisionJuste = r.decision === 'agir';
    entiere = action && tousReglages && decisionJuste && declares.size === 0;
  }
  const vu = r.appli !== null ? { appli: r.appli, action: r.action } : r.vu;
  const actionVue = Boolean(vu && vu.appli !== null && ((vu.appli === d.appli && (d.action === null || vu.action === d.action)) || alt.some((a) => a.appli === vu.appli && (a.action === null || a.action === vu.action))));
  return { appli, action, actionVue, reglages, tousReglages, manquesReperes, manquesRates, inventes, enTrop, demandesATort, decisionJuste, entiere };
}

// ------------------------------------------------------------------------------------------------ relevés
export interface ReleveC {
  n: number;
  /** Dans le champ seulement (complete, manque, et les ambiguës qui nomment une appli). */
  appli: Proportion; action: Proportion;
  /** Diagnostic : bonne appli·action comprise, en comptant aussi les fois où la méthode a passé la main. */
  actionVue: Proportion;
  /** Chaque réglage attendu (n = nombre de réglages attendus) ; faux si l'action est fausse. */
  reglages: Proportion;
  /** Les mêmes, parmi les demandes dont l'action est juste. */
  reglagesSiActionJuste: Proportion;
  /** Demandes dont tous les réglages attendus sont justes (parmi celles qui en attendent). */
  tousReglages: Proportion;
  /** Réglages manquants bien repérés (n = nombre de réglages manquants). */
  manquesReperes: Proportion;
  /** Réglages manquants auxquels une valeur a été inventée (plus petit = mieux). */
  inventes: Proportion;
  /** Demandes avec au moins une valeur en trop (plus petit = mieux). */
  enTrop: Proportion;
  /** Demandes complètes où la méthode demande quand même un réglage (plus petit = mieux). */
  demandeATort: Proportion;
  decisionJuste: Proportion;
  /** La part des demandes ENTIÈREMENT comprises. */
  entieres: Proportion;
}
export function releveC(rs: Array<{ demande: DemandeC; j: Jugement }>): ReleveC {
  const champ = rs.filter((x) => !horsChamp(x.demande) && x.demande.appli);
  const avecReg = rs.filter((x) => Object.keys(x.demande.reglages ?? {}).length);
  let nr = 0, kr = 0, nra = 0, kra = 0, nm = 0, km = 0, ki = 0;
  for (const x of rs) {
    const v = Object.values(x.j.reglages); nr += v.length; kr += v.filter(Boolean).length;
    if (x.j.action) { nra += v.length; kra += v.filter(Boolean).length; }
    nm += (x.demande.manque ?? []).length; km += x.j.manquesReperes.length; ki += x.j.inventes.length;
  }
  const completes = rs.filter((x) => x.demande.sorte === 'complete');
  return {
    n: rs.length,
    appli: wilson(champ.filter((x) => x.j.appli).length, champ.length), action: wilson(champ.filter((x) => x.j.action).length, champ.length), actionVue: wilson(champ.filter((x) => x.j.actionVue).length, champ.length),
    reglages: wilson(kr, nr), reglagesSiActionJuste: wilson(kra, nra), tousReglages: wilson(avecReg.filter((x) => x.j.tousReglages).length, avecReg.length),
    manquesReperes: wilson(km, nm), inventes: wilson(ki, nm),
    enTrop: wilson(rs.filter((x) => x.j.enTrop.length).length, rs.length),
    demandeATort: wilson(completes.filter((x) => x.j.demandesATort.length || x.j.manquesReperes.length).length, completes.length),
    decisionJuste: wilson(rs.filter((x) => x.j.decisionJuste).length, rs.length), entieres: wilson(rs.filter((x) => x.j.entiere).length, rs.length),
  };
}
export function releveParC(rs: Array<{ demande: DemandeC; j: Jugement }>, cle: (d: DemandeC) => string): Record<string, ReleveC> {
  const g = new Map<string, Array<{ demande: DemandeC; j: Jugement }>>();
  for (const x of rs) { const k = cle(x.demande); if (!g.has(k)) g.set(k, []); g.get(k)!.push(x); }
  return Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, releveC(v)]));
}
/** Justesse de chaque NOM de réglage (toutes applis confondues) : où la méthode se trompe le plus. */
export function parNomDeReglage(rs: Array<{ demande: DemandeC; j: Jugement }>): Record<string, Proportion> {
  const c = new Map<string, { k: number; n: number }>();
  for (const x of rs) for (const [k, ok] of Object.entries(x.j.reglages)) { const e = c.get(k) ?? { k: 0, n: 0 }; e.n++; if (ok) e.k++; c.set(k, e); }
  return Object.fromEntries([...c.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, e]) => [k, wilson(e.k, e.n)]));
}
/** Une langue n'est désignée « la pire » qu'avec au moins ce nombre de demandes (en dessous, c'est du bruit). */
export const MIN_LANGUE = 10;
/** La réponse d'une méthode qui passe toujours la main : la base « abstention » publiée à côté de chaque chiffre. */
export const ABSTENTION_C: ReponseC = { appli: null, action: null, reglages: {}, manque: [], decision: 'passer', detail: 'abstention' };
/** Le champ du titre : les demandes où il faut comprendre une action (complete et manque). */
export const dansLeChamp = (d: DemandeC) => d.sorte === 'complete' || d.sorte === 'manque';
/** La méthode dit qu'elle ne connaît pas la chose nommée (appareil, conteneur…) : le banc n'a pas de maison. */
export const ditNePasConnaitre = (detail?: string) => /je ne connais pas/i.test(detail ?? '');
export interface RapportC {
  /** LE chiffre en tête : demandes du champ (complete et manque) entièrement comprises. */
  titre: Proportion;
  global: ReleveC; parSorte: Record<string, ReleveC>; parLangue: Record<string, ReleveC>; parEcriture: Record<string, ReleveC>; parAppli: Record<string, ReleveC>;
  parReglage: Record<string, Proportion>;
  francais: ReleveC; autres: ReleveC;
  /** Titre du français et des autres langues. */
  titreFrancais: Proportion; titreAutres: Proportion; titreParLangue: Record<string, Proportion>;
  /** Moyenne des langues (chaque langue pèse autant) de la part entièrement comprise ; la pire langue au titre (n ≥ MIN_LANGUE). */
  moyenneLangues: number; pireLangue: { langue: string; p: number; n: number } | null;
  /** Les mêmes relevés pour une méthode qui passe toujours la main. */
  base: { titre: Proportion; global: ReleveC; parSorte: Record<string, ReleveC> };
  /** Demandes où la méthode dit ne pas connaître la chose nommée (k), parmi toutes (n) ; et parmi les ratées du champ. */
  maisonInconnue: Proportion; maisonInconnueRateesChamp: number;
}
export function rapportC(rs: ResultatC[], o: OptionsC = {}): RapportC {
  const js = rs.map((x) => ({ demande: x.demande, j: juger(x.demande, x.reponse, o) }));
  const jb = rs.map((x) => ({ demande: x.demande, j: juger(x.demande, ABSTENTION_C, o) }));
  const titre = (l: typeof js) => { const c = l.filter((x) => dansLeChamp(x.demande)); return wilson(c.filter((x) => x.j.entiere).length, c.length); };
  const parLangue = releveParC(js, (d) => d.langue || '?');
  const ls = Object.entries(parLangue);
  // La pire langue : sur le TITRE (demandes du champ), parmi les langues d'au moins MIN_LANGUE demandes.
  const titreParLangue = Object.fromEntries(ls.map(([l]) => [l, titre(js.filter((x) => (x.demande.langue || '?') === l))]));
  let pire: RapportC['pireLangue'] = null;
  for (const [langue, r] of ls) { const t = titreParLangue[langue]; if (r.n >= MIN_LANGUE && t.n && (!pire || t.p < pire.p)) pire = { langue, p: t.p, n: t.n }; }
  const inconnue = rs.map((x, i) => ({ x, j: js[i].j })).filter(({ x }) => ditNePasConnaitre(x.reponse.detail));
  return {
    titre: titre(js),
    global: releveC(js), parSorte: releveParC(js, (d) => d.sorte), parLangue, parEcriture: releveParC(js, (d) => d.ecriture || '?'),
    parAppli: releveParC(js, (d) => d.appli ?? '(hors champ)'), parReglage: parNomDeReglage(js),
    francais: releveC(js.filter((x) => x.demande.langue === 'fr')), autres: releveC(js.filter((x) => x.demande.langue !== 'fr')),
    titreFrancais: titre(js.filter((x) => x.demande.langue === 'fr')), titreAutres: titre(js.filter((x) => x.demande.langue !== 'fr')),
    titreParLangue,
    moyenneLangues: ls.length ? ls.reduce((s, [, r]) => s + r.entieres.p, 0) / ls.length : 0, pireLangue: pire,
    base: { titre: titre(jb), global: releveC(jb), parSorte: releveParC(jb, (d) => d.sorte) },
    maisonInconnue: wilson(inconnue.length, rs.length), maisonInconnueRateesChamp: inconnue.filter(({ x, j }) => dansLeChamp(x.demande) && !j.entiere).length,
  };
}

// ------------------------------------------------------------------------------------------------ contrôle d'un jeu
const SORTES: SorteC[] = ['complete', 'manque', 'ambigue', 'hors-champ'];
/**
 * Défauts d'un jeu de compréhension (liste vide si tout va bien). Avec `infos` (le catalogue des réglages), vérifie aussi
 * que chaque appli, action et nom de réglage existe, que `manque` ne cite que des réglages OBLIGATOIRES, et qu'une
 * demande « complete » donne chaque réglage obligatoire sans valeur par défaut.
 */
export function defautsJeuC(j: unknown, infos?: InfosActions, applis?: Set<string>): string[] {
  const out: string[] = [];
  const o = j as JeuC;
  if (!o || typeof o !== 'object' || !Array.isArray(o.demandes)) return ['le jeu n\'a pas de liste « demandes »'];
  if (typeof o.maintenant !== 'string' || Number.isNaN(new Date(o.maintenant).getTime())) out.push('« maintenant » (l\'heure figée du jeu) manque ou est illisible');
  const ids = new Set<string>();
  o.demandes.forEach((d, i) => {
    const ou = `demande ${i} (${d?.id ?? 'sans id'})`;
    if (!d || typeof d !== 'object') { out.push(`${ou} : pas un objet`); return; }
    if (typeof d.id !== 'string' || !d.id) out.push(`${ou} : id manquant`); else if (ids.has(d.id)) out.push(`${ou} : id en double`); else ids.add(d.id);
    if (typeof d.phrase !== 'string' || !d.phrase.trim()) out.push(`${ou} : phrase vide`);
    if (typeof d.langue !== 'string' || !d.langue) out.push(`${ou} : langue manquante`);
    if (typeof d.ecriture !== 'string' || !d.ecriture) out.push(`${ou} : écriture manquante`);
    if (!SORTES.includes(d.sorte)) out.push(`${ou} : sorte inconnue « ${d.sorte} »`);
    if (!d.reglages || typeof d.reglages !== 'object' || Array.isArray(d.reglages)) out.push(`${ou} : reglages n'est pas un objet`);
    if (!Array.isArray(d.manque)) out.push(`${ou} : manque n'est pas une liste`);
    if (typeof d.aRelire !== 'boolean') out.push(`${ou} : aRelire manquant`);
    const reg = d.reglages ?? {}, man = Array.isArray(d.manque) ? d.manque : [];
    if (d.sorte === 'manque' && !man.length) out.push(`${ou} : sorte « manque » sans réglage manquant`);
    if (d.sorte !== 'manque' && man.length) out.push(`${ou} : réglages manquants dans une demande « ${d.sorte} »`);
    if (d.sorte === 'hors-champ' && (d.appli !== null || d.action !== null || Object.keys(reg).length)) out.push(`${ou} : hors champ avec une appli, une action ou des réglages`);
    if ((d.sorte === 'complete' || d.sorte === 'manque') && (!d.appli || !d.action)) out.push(`${ou} : appli ou action manquante`);
    for (const k of man) if (k in reg) out.push(`${ou} : « ${k} » est à la fois donné et manquant`);
    if (d.contexte !== undefined && (typeof d.contexte !== 'object' || typeof d.contexte.precedent !== 'string')) out.push(`${ou} : contexte sans « precedent »`);
    if (!infos || !d.appli || !d.action) { if (applis && d.appli && !applis.has(d.appli)) out.push(`${ou} : appli inconnue « ${d.appli} »`); return; }
    if (applis && !applis.has(d.appli)) { out.push(`${ou} : appli inconnue « ${d.appli} »`); return; }
    const ps = infos.get(`${d.appli}.${d.action}`);
    if (!ps) { out.push(`${ou} : action inconnue « ${d.appli}.${d.action} »`); return; }
    for (const k of Object.keys(reg)) {
      const p = ps.find((x) => x.key === k);
      if (!p) { out.push(`${ou} : réglage inconnu « ${d.appli}.${d.action}.${k} »`); continue; }
      const v = reg[k];
      if (p.kind === 'select' && typeof v === 'string' && p.options && !p.options.includes(v)) out.push(`${ou} : « ${v} » n'est pas une option de ${k} (${p.options.slice(0, 8).join(', ')})`);
      if (p.kind === 'number' && typeof v !== 'number' && !(v && typeof v === 'object' && !Array.isArray(v))) out.push(`${ou} : ${k} attend un nombre`);
      if (p.kind === 'boolean' && typeof v !== 'boolean') out.push(`${ou} : ${k} attend oui / non`);
    }
    for (const k of man) { const p = ps.find((x) => x.key === k); if (!p) out.push(`${ou} : réglage manquant inconnu « ${k} »`); else if (!p.required) out.push(`${ou} : « ${k} » n'est pas obligatoire`); }
    if (d.sorte === 'complete') for (const p of ps) if (p.required && (p.default === undefined || p.default === '') && !(p.key in reg)) out.push(`${ou} : complète, mais l'obligatoire « ${p.key} » n'est pas donné`);
    if (d.sorte === 'manque') for (const p of ps) if (p.required && (p.default === undefined || p.default === '') && !(p.key in reg) && !man.includes(p.key)) out.push(`${ou} : l'obligatoire « ${p.key} » n'est ni donné ni dans manque`);
    for (const a of d.aussi ?? []) { const i = a.indexOf('.'); if (i <= 0 || !infos.has(a)) out.push(`${ou} : « aussi » inconnu « ${a} »`); }
  });
  return out;
}

/** Les comptes d'un jeu : par langue, par écriture, par sorte, par appli ; demandes à relire ; réglages attendus et manquants. */
export function comptes(j: JeuC): Record<string, unknown> {
  const par = (f: (d: DemandeC) => string) => j.demandes.reduce<Record<string, number>>((o, d) => { const k = f(d); o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const tri = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    demandes: j.demandes.length, aRelire: j.demandes.filter((d) => d.aRelire).length,
    reglagesAttendus: j.demandes.reduce((s, d) => s + Object.keys(d.reglages ?? {}).length, 0), reglagesManquants: j.demandes.reduce((s, d) => s + (d.manque ?? []).length, 0),
    applis: new Set(j.demandes.map((d) => d.appli).filter(Boolean)).size, actions: new Set(j.demandes.filter((d) => d.appli).map((d) => `${d.appli}.${d.action}`)).size,
    parLangue: tri(par((d) => d.langue)), parEcriture: tri(par((d) => d.ecriture)), parSorte: tri(par((d) => d.sorte)), parAppli: tri(par((d) => d.appli ?? '(hors champ)')),
  };
}

// ------------------------------------------------------------------------------------------------ les textes des autres jeux
/** Toutes les phrases des jeux du banc (dossier jeux/), sauf ceux nommés : demandes, souvenirs et questions. */
export async function textesDesJeux(exclure: string[] = []): Promise<Array<{ texte: string; source: string }>> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const dir = resolve(import.meta.dirname, 'jeux');
  const out: Array<{ texte: string; source: string }> = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const nom = f.replace(/\.json$/, ''); if (exclure.includes(nom)) continue;
    let j: { demandes?: Array<{ id: string; phrase: string; contexte?: unknown }>; souvenirs?: Array<{ id: string; texte: string }>; questions?: Array<{ id: string; question: string }> };
    try { j = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; }
    for (const d of j.demandes ?? []) if (typeof d.phrase === 'string') out.push({ texte: d.phrase, source: `jeux/${nom}#${d.id}` });
    for (const s of j.souvenirs ?? []) if (typeof s.texte === 'string') out.push({ texte: s.texte, source: `jeux/${nom}#${s.id}` });
    for (const q of j.questions ?? []) if (typeof q.question === 'string') out.push({ texte: q.question, source: `jeux/${nom}#${q.id}` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ la méthode d'aujourd'hui
type Valhalla = import('../../src/valhalla/service.ts').Valhalla;
export interface MethodeC { nom: string; description: string; repondre(phrase: string, contexte?: { precedent?: string }): Promise<ReponseC> }
/** Les réglages de chaque action du produit (clé « appli.action »). */
export function infosDe(mods: Array<import('../../src/valhalla/types.ts').Module>): InfosActions {
  const m = new Map<string, InfoParam[]>();
  for (const x of mods) for (const a of x.actions) m.set(`${x.id}.${a.id}`, (a.params ?? []).map((p) => ({ key: p.key, kind: p.kind, required: Boolean(p.required), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.options ? { options: [...p.options] } : {}) })));
  return m;
}
/** Les applis de la maison, recopiées de src/core/offline-act.ts (constante non exportée) : la règle du doute y diffère. */
const MAISON = new Set(['appareils', 'midgard', 'gladsheim', 'brokkr', 'himinbjorg', 'bragi']);
/**
 * « logos » : la compréhension sans modèle du produit, appelée telle quelle (understand de src/valhalla/huginn.ts, qui
 * choisit l'appli et l'action puis remplit les réglages avec fill), à l'heure figée du jeu. La DÉCISION suit la règle
 * du produit quand aucun modèle n'est joignable (agirSansIA de src/core/offline-act.ts, mode non strict, partie « mes
 * applis »), recopiée ici pas à pas avec les mêmes fonctions du produit (pasEncore, langueProbable, verbeDit) :
 *   - ni demande de précision ni action sans doute, et la phrase est « pas encore » faisable  → passer ;
 *   - idem, et la phrase n'est probablement pas en français                                   → passer ;
 *   - { say, unsure } (« tu parles de X ou de Y ? »)                                         → demander, sans appli ;
 *   - { ask } (« il me manque … »)                                                            → demander ; manque = les
 *     réglages obligatoires encore vides (le produit les demande un par un) ;
 *   - { action } avec un doute qui n'a rien à voir (sauf « je devinais… » hors maison, verbe dit) → passer ;
 *   - { action } qui change quelque chose, avec doute, sans que son verbe soit dit              → passer ;
 *   - { action } qui change quelque chose, doute « je ne connais pas … »                      → demander (le produit dit
 *     qu'il ne connaît pas la chose, il n'agit pas ; aucun réglage n'est déclaré manquant) ;
 *   - toute autre { action } (y compris avec un doute proche)                                → agir ;
 *   - autre réponse (explication, manip) ou rien                                             → passer.
 * Quand la méthode passe, l'appli et l'action devinées sont gardées dans `detail` seulement (elle n'a rien choisi).
 * Un contexte { precedent } est joué d'abord dans la même session, comme dans le produit.
 */
export async function methodeLogosC(v: Valhalla, maintenant: Date): Promise<MethodeC> {
  const { understand, forgetPending, verbeDit } = await import('../../src/valhalla/huginn.ts');
  const { pasEncore, langueProbable } = await import('../../src/core/offline.ts');
  let tour = 0;
  const passer = (detail: string, u?: Awaited<ReturnType<typeof understand>>): ReponseC => ({ appli: null, action: null, reglages: {}, manque: [], decision: 'passer', detail, ...(u && (u.kind === 'action' || u.kind === 'ask') ? { vu: { appli: u.module, action: u.action } } : {}) });
  return {
    nom: 'logos', description: 'compréhension sans modèle du produit (understand et fill, src/valhalla/huginn.ts ; décision de agirSansIA, src/core/offline-act.ts), à l\'heure figée du jeu',
    async repondre(phrase, contexte) {
      const session = `banc-comprehension-${++tour}`;
      try {
        if (contexte?.precedent) await understand(v, contexte.precedent, session, maintenant);
        const u = await understand(v, phrase, session, maintenant);
        const vu = u?.kind === 'action' || u?.kind === 'ask' ? `${u.module}.${u.action}` : u?.kind ?? 'rien';
        const sur = u?.kind === 'ask' || (u?.kind === 'action' && !u.doubt);
        if (!sur) {
          const pe = pasEncore(phrase);
          if (pe) return passer(`pas encore (${pe.id}) ; vu : ${vu}`, u);
          if (langueProbable(phrase) !== 'fr') return passer(`langue non comprise sans modèle ; vu : ${vu}`, u);
        }
        if (u?.kind === 'say' && u.unsure) return { appli: null, action: null, reglages: {}, manque: [], decision: 'demander', detail: 'hésite entre deux applis' };
        if (u?.kind === 'ask') {
          const a = v.action(u.module, u.action)?.a;
          const manque = (a?.params ?? []).filter((p) => p.required && vide(u.input[p.key])).map((p) => p.key);
          return { appli: u.module, action: u.action, reglages: { ...u.input }, manque, decision: 'demander', detail: `il manque ${u.missing}` };
        }
        if (u?.kind !== 'action') return passer(vu);
        const read = Boolean(v.action(u.module, u.action)?.a.read);
        if (u.doubt && !u.near && !(/^je devinais/.test(u.doubt) && !MAISON.has(u.module) && verbeDit(v, phrase, u.module, u.action))) return passer(`doute lointain : ${u.doubt} ; vu : ${vu}`, u);
        if (!read && u.doubt && !verbeDit(v, phrase, u.module, u.action)) return passer(`verbe non dit : ${u.doubt} ; vu : ${vu}`, u);
        const rep = { appli: u.module, action: u.action, reglages: { ...u.input }, manque: [] as string[] };
        if (!read && u.doubt && /^je ne connais pas/.test(u.doubt)) return { ...rep, decision: 'demander', detail: `dit : ${u.doubt}` };
        return { ...rep, decision: 'agir', detail: u.doubt ? `agit malgré le doute : ${u.doubt}` : 'action' };
      } finally { forgetPending(session); }
    },
  };
}

// ------------------------------------------------------------------------------------------------ la commande
//   node --disable-warning=ExperimentalWarning test/soul-banc/comprehension.ts \
//        --jeu test/soul-banc/jeux/comprehension-developpement.json --jeu test/soul-banc/jeux/comprehension-principal.json \
//        --sortie <dossier> [--seuil 0.8]
// Écrit, par jeu : defauts-<jeu>.json, comptes-<jeu>.json, fuites-<jeu>.json (sans phrase pour un jeu figé),
// rapport-<jeu>-logos.json, tableau-<jeu>-logos.md, et pour un jeu de développement seulement ratees-<jeu>-logos.json.
// Jeu FIGÉ (« fige »: true, ou nom qui contient « principal ») : aucune phrase n'est écrite.
const pc = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
export const propC = (p: Proportion) => (p.n ? `${p.k}/${p.n} = ${pc(p.p)} [${pc(p.bas)} ; ${(Math.ceil(p.haut * 1000) / 10).toFixed(1).replace('.', ',')} %]` : '—');
const ENTETE = '| groupe | n | entièrement comprise | appli | action | chaque réglage | réglages si action juste | manques repérés | inventés | décision juste |\n|---|---:|---|---|---|---|---|---|---|---|';
const ligneC = (k: string, r: ReleveC) => `| ${k} | ${r.n} | ${propC(r.entieres)} | ${propC(r.appli)} | ${propC(r.action)} | ${propC(r.reglages)} | ${propC(r.reglagesSiActionJuste)} | ${propC(r.manquesReperes)} | ${propC(r.inventes)} | ${propC(r.decisionJuste)} |`;
/** Le tableau « objectif 100 % » : par sorte, la part entièrement juste, ce qu'il manque pour 100 et la base abstention. */
export function objectif(par: Record<string, { entieres: Proportion }>, base: Record<string, { entieres: Proportion }>): string[] {
  return ['| sorte | entièrement juste | manque pour 100 % | base abstention |', '|---|---|---:|---|',
    ...Object.entries(par).map(([k, x]) => `| ${k} | ${propC(x.entieres)} | ${x.entieres.n - x.entieres.k} | ${propC(base[k]?.entieres ?? { k: 0, n: 0, p: 0, bas: 0, haut: 0 })} |`)];
}
export function markdownC(jeu: string, methode: string, r: RapportC, fige: boolean, temps: { mediane: number; p95: number }, fuites = 0): string {
  const g = r.global;
  return [
    `# Banc de compréhension : ${methode} sur ${jeu}`, '',
    ...(fuites ? [`**NON PUBLIABLE : ${fuites} fuite(s) vers la matière d'apprentissage ou un autre jeu.**`, ''] : []),
    `Jeu ${fige ? 'FIGÉ (aucune phrase écrite ici)' : 'de développement'} ; ${g.n} demandes. Intervalles de Wilson à 95 %. Pourcentages tronqués, borne haute arrondie vers le haut.`, '',
    '## En tête', '',
    `- **Titre — demandes du champ (complètes et à compléter) ENTIÈREMENT comprises : ${propC(r.titre)}** ; base « toujours passer la main » : ${propC(r.base.titre)}.`,
    `- Français : ${propC(r.titreFrancais)} ; autres langues : ${propC(r.titreAutres)}.`,
    `- Toutes sortes mêlées (ambiguës et hors champ comprises) : ${propC(g.entieres)} ; base abstention : ${propC(r.base.global.entieres)} (ce chiffre récompense le fait de passer la main : il n'est pas le titre).`,
    `- La méthode dit ne pas connaître la chose nommée (le plus souvent parce que le banc n'a ni appareil, ni conteneur, ni caméra ; parfois parce qu'elle a mal découpé la phrase) : ${propC(r.maisonInconnue)} des demandes ; ${r.maisonInconnueRateesChamp} ratée(s) du champ en viennent.`,
    `- Bonne appli : ${propC(g.appli)} ; bonne action : ${propC(g.action)} (dans le champ) ; bonne appli·action comprise même quand la méthode passe la main (diagnostic) : ${propC(g.actionVue)}.`,
    `- Chaque réglage attendu juste : ${propC(g.reglages)} ; parmi les actions justes : ${propC(g.reglagesSiActionJuste)} ; demandes dont tous les réglages sont justes : ${propC(g.tousReglages)}.`,
    `- Réglages manquants bien repérés (demandés, pas inventés) : ${propC(g.manquesReperes)} ; inventés à tort : ${propC(g.inventes)}.`,
    `- Demandes complètes où un réglage est demandé quand même : ${propC(g.demandeATort)} ; demandes avec une valeur en trop : ${propC(g.enTrop)}.`,
    `- Bonne décision (agir / demander / passer) : ${propC(g.decisionJuste)} ; base abstention : ${propC(r.base.global.decisionJuste)}.`,
    `- Moyenne des langues (toutes sortes) : ${pc(r.moyenneLangues)} ; la pire au titre (langues d'au moins ${MIN_LANGUE} demandes ; à égalité, la première par ordre alphabétique) : ${r.pireLangue ? `${r.pireLangue.langue} ${pc(r.pireLangue.p)} sur ${r.pireLangue.n}` : '—'}.`,
    `- Temps par demande : médiane ${temps.mediane.toFixed(2)} ms, 95e centile ${temps.p95.toFixed(2)} ms.`, '',
    '## Objectif 100 %, sorte par sorte', '', ...objectif(r.parSorte, r.base.parSorte), '',
    '## Titre par langue (demandes du champ)', '', '| langue | entièrement comprises |', '|---|---|', ...Object.entries(r.titreParLangue).map(([k, p]) => `| ${k} | ${propC(p)} |`), '',
    '## Par sorte', '', ENTETE, ...Object.entries(r.parSorte).map(([k, x]) => ligneC(k, x)), '',
    '## Par langue', '', ENTETE, ...Object.entries(r.parLangue).map(([k, x]) => ligneC(k, x)), '',
    '## Par écriture', '', ENTETE, ...Object.entries(r.parEcriture).map(([k, x]) => ligneC(k, x)), '',
    '## Par nom de réglage', '', '| réglage | justes |', '|---|---|', ...Object.entries(r.parReglage).map(([k, p]) => `| ${k} | ${propC(p)} |`), '',
    '## Par appli', '', ENTETE, ...Object.entries(r.parAppli).map(([k, x]) => ligneC(k, x)), '',
  ].join('\n');
}

async function principal(): Promise<void> {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { basename, resolve } = await import('node:path');
  const { performance } = await import('node:perf_hooks');
  const args = process.argv.slice(2);
  const tous = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
  const jeux = tous('jeu'), sortie = tous('sortie')[0], seuil = Number(tous('seuil')[0] ?? '0.8');
  if (!jeux.length || !sortie) { console.error('usage : comprehension.ts --jeu <fichier.json> [--jeu …] --sortie <dossier> [--seuil 0.8]'); process.exitCode = 2; return; }
  const { dossierJetable, environnementBanc, modulesDuProduit } = await import('./catalogue.ts');
  const { home, fin } = dossierJetable('odin-soul-comprehension-');
  environnementBanc(home);
  mkdirSync(sortie, { recursive: true });
  try {
    const mods = await modulesDuProduit(home);
    const infos = infosDe(mods), applis = new Set(mods.map((m) => m.id));
    const lus = jeux.map((f) => { const j = JSON.parse(readFileSync(f, 'utf8')) as JeuC; const nom = basename(f).replace(/\.json$/i, ''); return { nom, j, fige: j.fige === true || nom.includes('principal') }; });
    // Fuites : contre tout ce que les méthodes apprennent ou indexent, contre les autres jeux du banc, entre ces jeux.
    const F = await import('./fuites.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    // Tous les autres jeux du banc (aiguillage, recherche, logique, mémoire), comme les bancs de logique et de mémoire.
    const index = new F.Index([...sources, ...(await textesDesJeux(lus.map((x) => x.nom)))]);
    const pourFuites = (j: JeuC) => j.demandes.map((d) => ({ id: d.id, phrase: d.phrase, langue: d.langue, ecriture: d.ecriture, appli: d.appli, action: d.action, sorte: d.sorte })) as never;
    // Aucun chiffre n'est publiable tant qu'une phrase d'un jeu fuit (relecture du 17/11, G3).
    const nbFuites = new Map<string, number>();
    for (const x of lus) {
      const defauts = defautsJeuC(x.j, infos, applis);
      writeFileSync(resolve(sortie, `defauts-${x.nom}.json`), JSON.stringify(defauts, null, 1));
      writeFileSync(resolve(sortie, `comptes-${x.nom}.json`), JSON.stringify(comptes(x.j), null, 1));
      const contre = F.fuitesContre(pourFuites(x.j), index, seuil), internes = F.doublonsInternes(pourFuites(x.j), seuil);
      const entre = lus.filter((y) => y !== x).map((y) => ({ jeu: y.nom, fuites: F.fuitesContre(pourFuites(x.j), new F.Index(y.j.demandes.map((d) => ({ texte: d.phrase, source: `${y.nom}#${d.id}` }))), seuil) }));
      const masquer = (l: ReturnType<typeof F.fuitesContre>) => (x.fige ? l.map(({ phrase: _p, texteSource: _t, ...r }) => r) : l);
      writeFileSync(resolve(sortie, `fuites-${x.nom}.json`), JSON.stringify({ seuil, sources: index.taille, contreApprentissageEtJeux: masquer(contre), internes: masquer(internes), entreJeux: entre.map((e) => ({ jeu: e.jeu, fuites: masquer(e.fuites) })) }, null, 1));
      nbFuites.set(x.nom, contre.length + internes.length + entre.reduce((s, e) => s + e.fuites.length, 0));
      console.log(`${x.nom} : ${x.j.demandes.length} demandes, ${defauts.length} défaut(s) ; fuites contre l'apprentissage et les autres jeux ${contre.length}, internes ${internes.length}, ${entre.map((e) => `contre ${e.jeu} ${e.fuites.length}`).join(', ')}`);
      for (const d of defauts.slice(0, 30)) console.log(`  défaut : ${d}`);
    }
    const { monde } = await import('./methodes.ts');
    const { lireCatalogue } = await import('./catalogue.ts');
    const m = await monde(home, await lireCatalogue(home));
    try {
      const { parseWhen } = await import('../../src/cron/reminders.ts');
      for (const x of lus) {
        const maintenant = new Date(x.j.maintenant);
        const meth = await methodeLogosC(m.v, maintenant);
        const rs: ResultatC[] = [];
        for (const d of x.j.demandes) {
          const t = performance.now();
          let reponse: ReponseC;
          try { reponse = await meth.repondre(d.phrase, d.contexte); } catch (e) { reponse = { appli: null, action: null, reglages: {}, manque: [], decision: 'passer', detail: `erreur : ${String((e as Error)?.message ?? e).slice(0, 160)}` }; }
          rs.push({ demande: d, reponse, ms: performance.now() - t });
        }
        const o: OptionsC = { infos, resoudreDate: (t) => parseWhen(t, maintenant) };
        const r = rapportC(rs, o);
        const ms = rs.map((y) => y.ms).sort((a, b) => a - b), q = (p: number) => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(p * ms.length) - 1))] ?? 0;
        const temps = { mediane: q(0.5), p95: q(0.95) };
        const fuites = nbFuites.get(x.nom) ?? 0;
        if (fuites) { console.log(`${x.nom} : NON PUBLIABLE, ${fuites} fuite(s)`); process.exitCode = 3; }
        writeFileSync(resolve(sortie, `rapport-${x.nom}-${meth.nom}.json`), JSON.stringify({ jeu: x.nom, version: x.j.version, fige: x.fige, publiable: fuites === 0, fuites, methode: meth.nom, description: meth.description, maintenant: x.j.maintenant, quand: new Date().toISOString(), temps, ...r }, null, 1));
        writeFileSync(resolve(sortie, `tableau-${x.nom}-${meth.nom}.md`), markdownC(x.nom, meth.nom, r, x.fige, temps, fuites));
        // Pour le jeu figé : seulement des comptes (quels réglages ratés, quelles décisions), jamais une phrase ni une valeur.
        const detail = rs.map((y) => ({ y, j: juger(y.demande, y.reponse, o) })).filter((z) => !z.j.entiere);
        if (!x.fige) writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}.json`), JSON.stringify(detail.map(({ y, j }) => ({ id: y.demande.id, langue: y.demande.langue, sorte: y.demande.sorte, phrase: y.demande.phrase, attendu: { appli: y.demande.appli, action: y.demande.action, reglages: y.demande.reglages, manque: y.demande.manque }, obtenu: y.reponse, faux: { appli: !j.appli, action: !j.action, reglages: Object.entries(j.reglages).filter(([, ok]) => !ok).map(([k]) => k), manquesRates: j.manquesRates, inventes: j.inventes, enTrop: j.enTrop, demandesATort: j.demandesATort, decision: !j.decisionJuste } })), null, 1));
        else writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}-comptes.json`), JSON.stringify({ ratees: detail.length, decisions: detail.reduce<Record<string, number>>((o2, { y }) => { const k = `${y.demande.sorte} → ${y.reponse.decision}`; o2[k] = (o2[k] ?? 0) + 1; return o2; }, {}) }, null, 1));
        console.log(`${meth.nom} sur ${x.nom} : TITRE (champ) ${propC(r.titre)}, base abstention ${propC(r.base.titre)} ; toutes sortes ${propC(r.global.entieres)} ; appli ${propC(r.global.appli)} ; action ${propC(r.global.action)} ; réglages ${propC(r.global.reglages)} ; manques repérés ${propC(r.global.manquesReperes)} ; inventés ${propC(r.global.inventes)} ; décision ${propC(r.global.decisionJuste)}`);
      }
    } finally { m.fin(); }
  } finally { fin(); }
}

if (process.argv[1] && (await import('node:path')).resolve(process.argv[1]) === (await import('node:url')).fileURLToPath(import.meta.url)) {
  await principal();
  process.exit(process.exitCode ?? 0);
}
