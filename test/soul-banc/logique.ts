// Banc de Soul : la LOGIQUE d'une demande. Le banc d'aiguillage (mesure.ts) dit « la bonne appli » ; celui de
// compréhension (comprehension.ts) dit « la bonne action avec les bons réglages ». Celui-ci mesure ce qu'il faut
// RAISONNER pour bien traiter une demande : une négation, une condition, un ordre, plusieurs actions dans une phrase,
// du temps et des quantités à calculer, une comparaison, une relance qui dépend du tour précédent, une correction en
// cours de phrase, une contradiction ou une demande impossible.
//
// Une demande de logique (jeux/logique-*.json) :
//   { id, langue, ecriture, phrase, logique: [sortes], decision, etapes: [étape], ordreLibre?, contexte?: { precedent },
//     aRelire, note? }
//   - logique  : les sortes de logique que la demande exerce (une ou plusieurs, liste SORTES ci-dessous) ;
//   - decision : « agir » (faire les étapes), « demander » (une précision manque : ne rien faire avant de la demander),
//                « rien » (la demande dit de ne rien faire, ou sa condition est déjà fausse), « refuser » (contradiction
//                ou demande impossible : le dire, ne rien faire) ;
//   - etapes   : pour « agir » seulement, la suite des étapes, DANS L'ORDRE : { appli, action, reglages, si?, depend?,
//                aussi? }. `si` : l'étape n'a lieu que si une condition est vraie (la condition se lit à l'étape d'avant) ;
//                `depend` : un réglage de l'étape vient du résultat d'une étape d'avant (il n'est pas jugé) ;
//                `aussi` : d'autres « appli.action » qui feraient aussi bien la même étape ;
//   - ordreLibre : les étapes sont indépendantes, l'ordre ne compte pas (« allume le salon et la cuisine »).
//
// Une réponse de méthode : { decision: 'agir' | 'demander' | 'rien' | 'refuser' | 'passer', etapes: [{ appli, action,
//   reglages, si? }] }. « passer » : la méthode ne sait pas et passe la main (au grand modèle ou au propriétaire).
//
// Règles de justesse (écrites une fois ici) :
//   - une étape obtenue vaut une étape attendue si l'appli et l'action sont les mêmes (ou l'une de `aussi`), si chaque
//     réglage attendu a la même valeur (memeValeur de comprehension.ts : la même comparaison tolérante) et si les deux
//     disent pareil pour `si` (une étape conditionnelle rendue sans condition est fausse, et l'inverse) ; un réglage
//     obtenu en plus n'est pas jugé ;
//   - une demande « agir » est ENTIÈREMENT juste si la décision est « agir », s'il y a autant d'étapes obtenues que
//     d'étapes attendues, et si chacune vaut l'attendue de même rang (ou, avec ordreLibre, s'il existe une façon de
//     les apparier une à une) ;
//   - une demande « demander », « rien » ou « refuser » est juste si la décision obtenue est la même. À côté, la
//     PRUDENCE : ne pas agir quand il ne fallait pas (toute décision autre que « agir », « passer » compris) ;
//   - étapes inventées : étapes obtenues (décision « agir ») qui ne valent aucune étape attendue ; pour une demande qui
//     n'est pas « agir », toute étape obtenue est inventée ;
//   - ordre : parmi les demandes « agir » à plusieurs étapes, ordre non libre, dont TOUTES les étapes sont trouvées
//     (dans n'importe quel ordre), la part où elles sont aussi dans le bon ordre ;
//   - plafond d'une seule action : une méthode qui ne rend qu'une étape ne peut réussir que les demandes à zéro ou une
//     étape ; le rapport donne ce plafond pour qu'on lise le chiffre honnêtement.
//   - ordre (version 2) : les étapes attendues doivent former une SOUS-SUITE des obtenues (une étape inventée en plus ne
//     rend pas l'ordre faux, elle est comptée à part) ; la première étape ne se juge pas quand l'ordre est libre.
// Le TITRE (version 2, relecture du 17/11) : les demandes « agir » entièrement justes. Les demandes « demander », « rien »
// et « refuser » sont publiées à part, jugées sur la MÊME décision (« passer » n'en est aucune). Chaque chiffre a la base
// « toujours passer la main » à côté ; l'objectif de 100 % se lit décision par décision et sorte par sorte.
import { wilson, type Proportion } from './mesure.ts';
import { memeValeur, objectif, propC, textesDesJeux, type InfosActions, type Valeur } from './comprehension.ts';

export const SORTES_L = ['negation', 'condition', 'ordre', 'plusieurs', 'temps', 'quantite', 'comparaison', 'relance', 'correction', 'contradiction'] as const;
export type SorteL = typeof SORTES_L[number];
export type DecisionL = 'agir' | 'demander' | 'rien' | 'refuser';
export const DECISIONS_L: DecisionL[] = ['agir', 'demander', 'rien', 'refuser'];
export interface EtapeL { appli: string; action: string; reglages: Record<string, Valeur>; si?: boolean; depend?: boolean; aussi?: string[] }
export interface DemandeL {
  id: string; langue: string; ecriture: string; phrase: string; logique: SorteL[]; decision: DecisionL; etapes: EtapeL[];
  ordreLibre?: boolean; contexte?: { precedent: string }; aRelire: boolean; note?: string;
}
export interface JeuL { version: number | string; origine: string; fige?: boolean; maintenant: string; demandes: DemandeL[]; [cle: string]: unknown }
export interface EtapeObtenue { appli: string | null; action: string | null; reglages: Record<string, unknown>; si?: boolean }
export interface ReponseL { decision: DecisionL | 'passer'; etapes: EtapeObtenue[]; detail?: string }
export interface ResultatL { demande: DemandeL; reponse: ReponseL; ms: number }
export interface OptionsL { infos?: InfosActions; resoudreDate?: (texte: string) => Date | undefined }

// ------------------------------------------------------------------------------------------------ une étape, une demande
/** L'étape obtenue vaut-elle l'étape attendue ? (règles dans l'en-tête) */
export function etapeVaut(a: EtapeL, o: EtapeObtenue, opt: OptionsL = {}): boolean {
  if (!o || !o.appli) return false;
  const memeAction = (o.appli === a.appli && o.action === a.action) || (a.aussi ?? []).includes(`${o.appli}.${o.action}`);
  if (!memeAction || Boolean(o.si) !== Boolean(a.si)) return false;
  const params = opt.infos?.get(`${o.appli}.${o.action}`) ?? [];
  return Object.entries(a.reglages ?? {}).every(([k, v]) => {
    const p = params.find((x) => x.key === k);
    return memeValeur(v, o.reglages?.[k], k, { resoudreDate: opt.resoudreDate, texteLibre: !p || p.kind === 'text' || p.kind === 'textarea' });
  });
}

/** Le plus grand appariement une à une entre étapes attendues et obtenues (petites listes : recherche complète). */
export function appariement(att: EtapeL[], obt: EtapeObtenue[], opt: OptionsL = {}): number {
  const ok = att.map((a) => obt.map((o) => etapeVaut(a, o, opt)));
  // Chemins augmentants (Kuhn) : exact, et immédiat pour des listes de quelques étapes.
  const lien = new Array<number>(obt.length).fill(-1);
  const essayer = (i: number, vu: boolean[]): boolean => {
    for (let j = 0; j < obt.length; j++) if (ok[i][j] && !vu[j]) { vu[j] = true; if (lien[j] < 0 || essayer(lien[j], vu)) { lien[j] = i; return true; } }
    return false;
  };
  let n = 0;
  for (let i = 0; i < att.length; i++) if (essayer(i, new Array<boolean>(obt.length).fill(false))) n++;
  return n;
}

export interface JugementL {
  decisionJuste: boolean;
  /** Ne pas agir quand il ne fallait pas (vrai d'office pour une demande « agir » où la méthode agit). */
  prudent: boolean;
  /** Étapes attendues trouvées (dans n'importe quel ordre) ; nombre d'étapes attendues. */
  trouvees: number; attendues: number;
  /** Étapes obtenues qui ne valent aucune étape attendue. */
  inventees: number; obtenues: number;
  /** Toutes les étapes trouvées, et dans le bon ordre (null si la question ne se pose pas). */
  toutesTrouvees: boolean; bonOrdre: boolean | null;
  /** null quand l'ordre est libre (la première étape ne se juge pas). */
  premiereJuste: boolean | null;
  entiere: boolean;
}

export function jugerL(d: DemandeL, r: ReponseL, opt: OptionsL = {}): JugementL {
  const obt = r.decision === 'agir' ? (r.etapes ?? []) : [];
  if (d.decision !== 'agir') {
    const decisionJuste = r.decision === d.decision;
    return { decisionJuste, prudent: r.decision !== 'agir', trouvees: 0, attendues: 0, inventees: obt.length, obtenues: obt.length, toutesTrouvees: true, bonOrdre: null, premiereJuste: decisionJuste, entiere: decisionJuste && obt.length === 0 };
  }
  const att = d.etapes;
  const trouvees = appariement(att, obt, opt);
  const inventees = obt.length - trouvees;
  const toutesTrouvees = trouvees === att.length;
  const dansLOrdre = obt.length === att.length && att.every((a, i) => etapeVaut(a, obt[i], opt));
  // L'ordre se juge sur les étapes trouvées : les attendues forment-elles une sous-suite des obtenues ? (une étape
  // inventée en plus ne rend pas l'ordre faux ; elle est comptée à part, et la demande reste ratée).
  const bonOrdre = att.length >= 2 && !d.ordreLibre && toutesTrouvees ? sousSuite(att, obt, opt) : null;
  const decisionJuste = r.decision === 'agir';
  const entiere = decisionJuste && obt.length === att.length && toutesTrouvees && (d.ordreLibre ? true : dansLOrdre);
  // La « première étape » n'a de sens que quand l'ordre compte.
  const premiereJuste = d.ordreLibre ? null : obt.length > 0 && etapeVaut(att[0], obt[0], opt);
  return { decisionJuste, prudent: true, trouvees, attendues: att.length, inventees, obtenues: obt.length, toutesTrouvees, bonOrdre, premiereJuste, entiere };
}
/** Les étapes attendues se retrouvent-elles, dans cet ordre, parmi les obtenues (d'autres étapes pouvant s'intercaler) ? */
export function sousSuite(att: EtapeL[], obt: EtapeObtenue[], opt: OptionsL = {}): boolean {
  let j = 0;
  for (const a of att) { while (j < obt.length && !etapeVaut(a, obt[j], opt)) j++; if (j >= obt.length) return false; j++; }
  return true;
}

// ------------------------------------------------------------------------------------------------ relevés
export interface ReleveL {
  n: number;
  /** La part des demandes ENTIÈREMENT justes (toutes les étapes, dans le bon ordre, ou la bonne décision). */
  entieres: Proportion;
  decisionJuste: Proportion;
  /** Parmi les demandes qui ne sont pas « agir » : la méthode n'a pas agi. */
  prudence: Proportion;
  /** Étapes attendues trouvées (n = nombre d'étapes attendues). */
  etapes: Proportion;
  /** Parmi les demandes « agir » dont l'ordre compte : la première étape obtenue est la première attendue. */
  premiere: Proportion;
  /** Parmi les demandes « agir » à plusieurs étapes, ordre non libre, toutes trouvées : dans le bon ordre. */
  ordre: Proportion;
  /** Demandes avec au moins une étape inventée (plus petit = mieux). */
  avecInventees: Proportion;
  /** Étapes inventées parmi toutes les étapes obtenues (plus petit = mieux). */
  inventees: Proportion;
  /** Demandes qu'une méthode à UNE étape au plus pourrait réussir (zéro ou une étape attendue). */
  plafondUneEtape: Proportion;
}
export function releveL(js: Array<{ demande: DemandeL; j: JugementL }>): ReleveL {
  const agir = js.filter((x) => x.demande.decision === 'agir'), pasAgir = js.filter((x) => x.demande.decision !== 'agir');
  const ordre = js.filter((x) => x.j.bonOrdre !== null);
  const s = (f: (x: { demande: DemandeL; j: JugementL }) => number) => js.reduce((t, x) => t + f(x), 0);
  return {
    n: js.length,
    entieres: wilson(js.filter((x) => x.j.entiere).length, js.length),
    decisionJuste: wilson(js.filter((x) => x.j.decisionJuste).length, js.length),
    prudence: wilson(pasAgir.filter((x) => x.j.prudent).length, pasAgir.length),
    etapes: wilson(s((x) => x.j.trouvees), s((x) => x.j.attendues)),
    premiere: wilson(agir.filter((x) => x.j.premiereJuste === true).length, agir.filter((x) => x.j.premiereJuste !== null).length),
    ordre: wilson(ordre.filter((x) => x.j.bonOrdre).length, ordre.length),
    avecInventees: wilson(js.filter((x) => x.j.inventees > 0).length, js.length),
    inventees: wilson(s((x) => x.j.inventees), s((x) => x.j.obtenues)),
    plafondUneEtape: wilson(js.filter((x) => x.demande.decision !== 'agir' || x.demande.etapes.length <= 1).length, js.length),
  };
}
function grouper(js: Array<{ demande: DemandeL; j: JugementL }>, cles: (d: DemandeL) => string[]): Record<string, ReleveL> {
  const g = new Map<string, Array<{ demande: DemandeL; j: JugementL }>>();
  for (const x of js) for (const k of cles(x.demande)) { if (!g.has(k)) g.set(k, []); g.get(k)!.push(x); }
  return Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, releveL(v)]));
}
/** Une langue n'est désignée « la pire » qu'avec au moins ce nombre de demandes. */
export const MIN_LANGUE_L = 10;
/** La réponse d'une méthode qui passe toujours la main : la base « abstention ». */
export const ABSTENTION_L: ReponseL = { decision: 'passer', etapes: [], detail: 'abstention' };
export interface RapportL {
  /** LE chiffre en tête : demandes « agir » entièrement justes (toutes les étapes, dans le bon ordre). */
  titre: Proportion;
  /** Demandes « demander », « rien », « refuser » : la MÊME décision (« passer » n'en est aucune). */
  pasAgir: Proportion;
  titreFrancais: Proportion; titreAutres: Proportion; titreParLangue: Record<string, Proportion>;
  /** Les mêmes chiffres pour une méthode qui passe toujours la main. */
  base: { titre: Proportion; pasAgir: Proportion; global: ReleveL; parDecision: Record<string, ReleveL>; parSorte: Record<string, ReleveL> };
  /** Demandes où la méthode dit ne pas connaître la chose nommée (le banc n'a pas de maison) ; ratées « agir » qui en viennent. */
  maisonInconnue: Proportion; maisonInconnueRateesAgir: number;
  global: ReleveL;
  /** Une demande à plusieurs sortes compte dans chacune. */
  parSorte: Record<string, ReleveL>; parLangue: Record<string, ReleveL>; parEcriture: Record<string, ReleveL>;
  parDecision: Record<string, ReleveL>; parNombreEtapes: Record<string, ReleveL>;
  francais: ReleveL; autres: ReleveL;
  moyenneLangues: number; pireLangue: { langue: string; p: number; n: number } | null;
  /** Ce que la méthode a décidé, pour chaque décision attendue (« agir → passer » : 12…). */
  decisions: Record<string, number>;
}
export function rapportL(rs: ResultatL[], opt: OptionsL = {}): RapportL {
  const js = rs.map((x) => ({ demande: x.demande, j: jugerL(x.demande, x.reponse, opt) }));
  const jb = rs.map((x) => ({ demande: x.demande, j: jugerL(x.demande, ABSTENTION_L, opt) }));
  const titre = (l: typeof js) => { const a = l.filter((x) => x.demande.decision === 'agir'); return wilson(a.filter((x) => x.j.entiere).length, a.length); };
  const pasAgir = (l: typeof js) => { const a = l.filter((x) => x.demande.decision !== 'agir'); return wilson(a.filter((x) => x.j.entiere).length, a.length); };
  const parLangue = grouper(js, (d) => [d.langue || '?']);
  const ls = Object.entries(parLangue);
  // La pire langue : sur le TITRE (demandes « agir »), parmi les langues d'au moins MIN_LANGUE_L demandes.
  const titreParLangue = Object.fromEntries(ls.map(([l]) => [l, titre(js.filter((x) => (x.demande.langue || '?') === l))]));
  let pire: RapportL['pireLangue'] = null;
  for (const [langue, r] of ls) { const t = titreParLangue[langue]; if (r.n >= MIN_LANGUE_L && t.n && (!pire || t.p < pire.p)) pire = { langue, p: t.p, n: t.n }; }
  const decisions: Record<string, number> = {};
  for (const x of rs) { const k = `${x.demande.decision} → ${x.reponse.decision}`; decisions[k] = (decisions[k] ?? 0) + 1; }
  const inconnue = rs.map((x, i) => ({ x, j: js[i].j })).filter(({ x }) => /je ne connais pas/i.test(x.reponse.detail ?? ''));
  return {
    titre: titre(js), pasAgir: pasAgir(js),
    titreFrancais: titre(js.filter((x) => x.demande.langue === 'fr')), titreAutres: titre(js.filter((x) => x.demande.langue !== 'fr')),
    titreParLangue,
    base: { titre: titre(jb), pasAgir: pasAgir(jb), global: releveL(jb), parDecision: grouper(jb, (d) => [d.decision]), parSorte: grouper(jb, (d) => d.logique) },
    maisonInconnue: wilson(inconnue.length, rs.length), maisonInconnueRateesAgir: inconnue.filter(({ x, j }) => x.demande.decision === 'agir' && !j.entiere).length,
    global: releveL(js), parSorte: grouper(js, (d) => d.logique), parLangue, parEcriture: grouper(js, (d) => [d.ecriture || '?']),
    parDecision: grouper(js, (d) => [d.decision]), parNombreEtapes: grouper(js, (d) => [d.decision !== 'agir' ? '0 (pas agir)' : d.etapes.length >= 3 ? '3 et plus' : String(d.etapes.length)]),
    francais: releveL(js.filter((x) => x.demande.langue === 'fr')), autres: releveL(js.filter((x) => x.demande.langue !== 'fr')),
    moyenneLangues: ls.length ? ls.reduce((s, [, r]) => s + r.entieres.p, 0) / ls.length : 0, pireLangue: pire,
    decisions: Object.fromEntries(Object.entries(decisions).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

// ------------------------------------------------------------------------------------------------ contrôle d'un jeu
/** Défauts d'un jeu de logique (liste vide si tout va bien) ; avec `infos`, chaque appli, action et réglage doit exister. */
export function defautsJeuL(j: unknown, infos?: InfosActions): string[] {
  const out: string[] = [];
  const o = j as JeuL;
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
    if (typeof d.aRelire !== 'boolean') out.push(`${ou} : aRelire manquant`);
    if (!Array.isArray(d.logique) || !d.logique.length) out.push(`${ou} : aucune sorte de logique`);
    else for (const s of d.logique) if (!(SORTES_L as readonly string[]).includes(s)) out.push(`${ou} : sorte inconnue « ${s} »`);
    if (!DECISIONS_L.includes(d.decision)) out.push(`${ou} : décision inconnue « ${d.decision} »`);
    if (!Array.isArray(d.etapes)) { out.push(`${ou} : etapes n'est pas une liste`); return; }
    if (d.decision === 'agir' && !d.etapes.length) out.push(`${ou} : « agir » sans étape`);
    if (d.decision !== 'agir' && d.etapes.length) out.push(`${ou} : des étapes pour une décision « ${d.decision} »`);
    if (d.logique?.includes('relance') && !d.contexte?.precedent) out.push(`${ou} : relance sans tour précédent`);
    if (d.contexte !== undefined && (typeof d.contexte !== 'object' || typeof d.contexte.precedent !== 'string' || !d.contexte.precedent.trim())) out.push(`${ou} : contexte sans « precedent »`);
    if (d.etapes.length >= 2 && !d.logique?.some((s) => s === 'ordre' || s === 'plusieurs' || s === 'condition' || s === 'comparaison' || s === 'correction' || s === 'negation' || s === 'temps' || s === 'quantite' || s === 'relance')) out.push(`${ou} : plusieurs étapes sans sorte qui l'explique`);
    d.etapes.forEach((e, k) => {
      const ue = `${ou} étape ${k + 1}`;
      if (!e || typeof e.appli !== 'string' || typeof e.action !== 'string') { out.push(`${ue} : appli ou action manquante`); return; }
      if (!e.reglages || typeof e.reglages !== 'object' || Array.isArray(e.reglages)) out.push(`${ue} : reglages n'est pas un objet`);
      if (k === 0 && e.si) out.push(`${ue} : la première étape ne peut pas dépendre d'une condition lue avant`);
      if (!infos) return;
      const ps = infos.get(`${e.appli}.${e.action}`);
      if (!ps) { out.push(`${ue} : action inconnue « ${e.appli}.${e.action} »`); return; }
      for (const [cle, v] of Object.entries(e.reglages ?? {})) {
        const p = ps.find((x) => x.key === cle);
        if (!p) { out.push(`${ue} : réglage inconnu « ${e.appli}.${e.action}.${cle} »`); continue; }
        if (p.kind === 'select' && typeof v === 'string' && p.options && !p.options.includes(v)) out.push(`${ue} : « ${v} » n'est pas une option de ${cle}`);
        if (p.kind === 'number' && typeof v !== 'number' && !(v && typeof v === 'object' && !Array.isArray(v))) out.push(`${ue} : ${cle} attend un nombre`);
        if (p.kind === 'boolean' && typeof v !== 'boolean') out.push(`${ue} : ${cle} attend oui / non`);
      }
      for (const a of e.aussi ?? []) if (!infos.has(a)) out.push(`${ue} : « aussi » inconnu « ${a} »`);
    });
  });
  return out;
}

/** Les comptes d'un jeu : par langue, écriture, sorte, décision, nombre d'étapes ; à relire. */
export function comptesL(j: JeuL): Record<string, unknown> {
  const par = (f: (d: DemandeL) => string[]) => j.demandes.reduce<Record<string, number>>((o, d) => { for (const k of f(d)) o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const tri = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    demandes: j.demandes.length, aRelire: j.demandes.filter((d) => d.aRelire).length,
    etapes: j.demandes.reduce((s, d) => s + d.etapes.length, 0), reglagesAttendus: j.demandes.reduce((s, d) => s + d.etapes.reduce((t, e) => t + Object.keys(e.reglages ?? {}).length, 0), 0),
    applis: new Set(j.demandes.flatMap((d) => d.etapes.map((e) => e.appli))).size, actions: new Set(j.demandes.flatMap((d) => d.etapes.map((e) => `${e.appli}.${e.action}`))).size,
    parLangue: tri(par((d) => [d.langue])), parEcriture: tri(par((d) => [d.ecriture])), parSorte: tri(par((d) => d.logique)), parDecision: tri(par((d) => [d.decision])),
    parNombreEtapes: tri(par((d) => [String(d.etapes.length)])), avecContexte: j.demandes.filter((d) => d.contexte).length, ordreLibre: j.demandes.filter((d) => d.ordreLibre).length,
  };
}

// ------------------------------------------------------------------------------------------------ les textes des autres jeux
// Écrite dans comprehension.ts (le banc de compréhension s'en sert aussi, sans importer ce fichier : pas de cycle).
export { textesDesJeux };

// ------------------------------------------------------------------------------------------------ la méthode d'aujourd'hui
type Valhalla = import('../../src/valhalla/service.ts').Valhalla;
export interface MethodeL { nom: string; description: string; repondre(phrase: string, contexte?: { precedent?: string }): Promise<ReponseL> }
/**
 * « logos » : le chemin sans modèle du produit, appelé tel quel, à travers l'adaptateur du banc de compréhension
 * (methodeLogosC : understand et fill de src/valhalla/huginn.ts, décision de agirSansIA de src/core/offline-act.ts),
 * à l'heure figée du jeu. Ce chemin rend UNE action au plus : « agir » devient une étape, sans condition ; « demander »
 * et « passer » restent tels quels ; il ne sait dire ni « rien » ni « refuser ».
 */
export async function methodeLogosL(v: Valhalla, maintenant: Date): Promise<MethodeL> {
  const { methodeLogosC } = await import('./comprehension.ts');
  const c = await methodeLogosC(v, maintenant);
  return {
    nom: 'logos', description: `${c.description} ; une action au plus, rendue comme une étape`,
    async repondre(phrase, contexte) {
      const r = await c.repondre(phrase, contexte);
      if (r.decision === 'agir' && r.appli) return { decision: 'agir', etapes: [{ appli: r.appli, action: r.action, reglages: r.reglages }], detail: r.detail };
      return { decision: r.decision, etapes: [], detail: r.detail };
    },
  };
}

// ------------------------------------------------------------------------------------------------ la commande
//   node --disable-warning=ExperimentalWarning test/soul-banc/logique.ts \
//        --jeu test/soul-banc/jeux/logique-developpement.json --jeu test/soul-banc/jeux/logique-principal.json \
//        --sortie <dossier> [--seuil 0.8]
// Écrit, par jeu : defauts-<jeu>.json, comptes-<jeu>.json, fuites-<jeu>.json (sans phrase pour un jeu figé),
// rapport-<jeu>-logos.json, tableau-<jeu>-logos.md ; pour un jeu de développement, ratees-<jeu>-logos.json ; pour un
// jeu figé, seulement des comptes des ratées (aucune phrase, aucune valeur).
const ENTETE = '| groupe | n | entièrement juste | décision juste | prudence | étapes trouvées | 1re étape | ordre | avec étapes inventées | plafond 1 étape |\n|---|---:|---|---|---|---|---|---|---|---|';
const ligneL = (k: string, r: ReleveL) => `| ${k} | ${r.n} | ${propC(r.entieres)} | ${propC(r.decisionJuste)} | ${propC(r.prudence)} | ${propC(r.etapes)} | ${propC(r.premiere)} | ${propC(r.ordre)} | ${propC(r.avecInventees)} | ${propC(r.plafondUneEtape)} |`;
const pc = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
export function markdownL(jeu: string, methode: string, r: RapportL, fige: boolean, temps: { mediane: number; p95: number }, fuites = 0): string {
  const g = r.global;
  return [
    `# Banc de logique : ${methode} sur ${jeu}`, '',
    ...(fuites ? [`**NON PUBLIABLE : ${fuites} fuite(s) vers la matière d'apprentissage ou un autre jeu.**`, ''] : []),
    `Jeu ${fige ? 'FIGÉ (aucune phrase écrite ici)' : 'de développement'} ; ${g.n} demandes. Intervalles de Wilson à 95 %. Pourcentages tronqués, borne haute arrondie vers le haut.`, '',
    '## En tête', '',
    `- **Titre — demandes « agir » ENTIÈREMENT justes (toutes les étapes, dans le bon ordre) : ${propC(r.titre)}** ; base « toujours passer la main » : ${propC(r.base.titre)}.`,
    `- Français : ${propC(r.titreFrancais)} ; autres langues : ${propC(r.titreAutres)}.`,
    `- Demandes « demander », « rien », « refuser » : la même décision : ${propC(r.pasAgir)} ; base abstention : ${propC(r.base.pasAgir)} (« passer » n'en est aucune).`,
    `- Toutes demandes mêlées : ${propC(g.entieres)} ; base abstention : ${propC(r.base.global.entieres)}.`,
    `- Plafond d'une méthode qui ne rend qu'une étape : ${propC(g.plafondUneEtape)} des demandes.`,
    `- Bonne décision (agir / demander / rien / refuser) : ${propC(g.decisionJuste)} ; prudence (n'agit pas quand il ne fallait pas, « passer » compris) : ${propC(g.prudence)} ; base abstention : ${propC(r.base.global.prudence)}.`,
    `- La méthode dit ne pas connaître la chose nommée (le plus souvent parce que le banc n'a ni appareil, ni conteneur, ni caméra ; parfois parce qu'elle a mal découpé la phrase) : ${propC(r.maisonInconnue)} des demandes ; ${r.maisonInconnueRateesAgir} ratée(s) « agir » en viennent.`,
    `- Étapes attendues trouvées : ${propC(g.etapes)} ; première étape juste : ${propC(g.premiere)} ; bon ordre (quand toutes sont trouvées) : ${propC(g.ordre)}.`,
    `- Demandes avec au moins une étape inventée : ${propC(g.avecInventees)} ; étapes inventées parmi les étapes rendues : ${propC(g.inventees)}.`,
    `- Moyenne des langues (toutes demandes) : ${pc(r.moyenneLangues)} ; la pire au titre (langues d'au moins ${MIN_LANGUE_L} demandes ; à égalité, la première par ordre alphabétique) : ${r.pireLangue ? `${r.pireLangue.langue} ${pc(r.pireLangue.p)} sur ${r.pireLangue.n}` : '—'}.`,
    `- Temps par demande : médiane ${temps.mediane.toFixed(2)} ms, 95e centile ${temps.p95.toFixed(2)} ms.`, '',
    '## Objectif 100 %, décision par décision', '', ...objectif(r.parDecision, r.base.parDecision), '',
    '## Objectif 100 %, sorte de logique par sorte', '', ...objectif(r.parSorte, r.base.parSorte), '',
    '## Titre par langue (demandes « agir »)', '', '| langue | entièrement justes |', '|---|---|', ...Object.entries(r.titreParLangue).map(([k, p]) => `| ${k} | ${propC(p)} |`), '',
    '## Décisions (attendue → obtenue)', '', '| attendue → obtenue | n |', '|---|---:|', ...Object.entries(r.decisions).map(([k, n]) => `| ${k} | ${n} |`), '',
    '## Par sorte de logique (une demande compte dans chacune de ses sortes)', '', ENTETE, ...Object.entries(r.parSorte).map(([k, x]) => ligneL(k, x)), '',
    '## Par décision attendue', '', ENTETE, ...Object.entries(r.parDecision).map(([k, x]) => ligneL(k, x)), '',
    '## Par nombre d\'étapes attendues', '', ENTETE, ...Object.entries(r.parNombreEtapes).map(([k, x]) => ligneL(k, x)), '',
    '## Par langue', '', ENTETE, ...Object.entries(r.parLangue).map(([k, x]) => ligneL(k, x)), '',
    '## Par écriture', '', ENTETE, ...Object.entries(r.parEcriture).map(([k, x]) => ligneL(k, x)), '',
  ].join('\n');
}

async function principal(): Promise<void> {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { basename, resolve } = await import('node:path');
  const { performance } = await import('node:perf_hooks');
  const args = process.argv.slice(2);
  const tous = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
  const jeux = tous('jeu'), sortie = tous('sortie')[0], seuil = Number(tous('seuil')[0] ?? '0.8');
  if (!jeux.length || !sortie) { console.error('usage : logique.ts --jeu <fichier.json> [--jeu …] --sortie <dossier> [--seuil 0.8]'); process.exitCode = 2; return; }
  const { dossierJetable, environnementBanc, modulesDuProduit, lireCatalogue } = await import('./catalogue.ts');
  const { home, fin } = dossierJetable('odin-soul-logique-');
  environnementBanc(home);
  mkdirSync(sortie, { recursive: true });
  try {
    const mods = await modulesDuProduit(home);
    const { infosDe } = await import('./comprehension.ts');
    const infos = infosDe(mods);
    const lus = jeux.map((f) => { const j = JSON.parse(readFileSync(f, 'utf8')) as JeuL; const nom = basename(f).replace(/\.json$/i, ''); return { nom, j, fige: j.fige === true || nom.includes('principal') }; });
    const F = await import('./fuites.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    const index = new F.Index([...sources, ...(await textesDesJeux(lus.map((x) => x.nom)))]);
    const pourFuites = (j: JeuL) => j.demandes.map((d) => ({ id: d.id, phrase: d.phrase })) as never;
    const nbFuites = new Map<string, number>();
    for (const x of lus) {
      const defauts = defautsJeuL(x.j, infos);
      writeFileSync(resolve(sortie, `defauts-${x.nom}.json`), JSON.stringify(defauts, null, 1));
      writeFileSync(resolve(sortie, `comptes-${x.nom}.json`), JSON.stringify(comptesL(x.j), null, 1));
      const contre = F.fuitesContre(pourFuites(x.j), index, seuil), internes = F.doublonsInternes(pourFuites(x.j), seuil);
      const entre = lus.filter((y) => y !== x).map((y) => ({ jeu: y.nom, fuites: F.fuitesContre(pourFuites(x.j), new F.Index(y.j.demandes.map((d) => ({ texte: d.phrase, source: `${y.nom}#${d.id}` }))), seuil) }));
      const masquer = (l: ReturnType<typeof F.fuitesContre>) => (x.fige ? l.map(({ phrase: _p, texteSource: _t, ...r }) => r) : l);
      writeFileSync(resolve(sortie, `fuites-${x.nom}.json`), JSON.stringify({ seuil, sources: index.taille, contreApprentissageEtJeux: masquer(contre), internes: masquer(internes), entreJeux: entre.map((e) => ({ jeu: e.jeu, fuites: masquer(e.fuites) })) }, null, 1));
      nbFuites.set(x.nom, contre.length + internes.length + entre.reduce((s, e) => s + e.fuites.length, 0));
      console.log(`${x.nom} : ${x.j.demandes.length} demandes, ${defauts.length} défaut(s) ; fuites contre l'apprentissage et les autres jeux ${contre.length}, internes ${internes.length}, ${entre.map((e) => `contre ${e.jeu} ${e.fuites.length}`).join(', ')}`);
      for (const d of defauts.slice(0, 30)) console.log(`  défaut : ${d}`);
    }
    const { monde } = await import('./methodes.ts');
    const m = await monde(home, await lireCatalogue(home));
    try {
      const { parseWhen } = await import('../../src/cron/reminders.ts');
      for (const x of lus) {
        const maintenant = new Date(x.j.maintenant);
        const meth = await methodeLogosL(m.v, maintenant);
        const rs: ResultatL[] = [];
        for (const d of x.j.demandes) {
          const t = performance.now();
          let reponse: ReponseL;
          try { reponse = await meth.repondre(d.phrase, d.contexte); } catch (e) { reponse = { decision: 'passer', etapes: [], detail: `erreur : ${String((e as Error)?.message ?? e).slice(0, 160)}` }; }
          rs.push({ demande: d, reponse, ms: performance.now() - t });
        }
        const o: OptionsL = { infos, resoudreDate: (t) => parseWhen(t, maintenant) };
        const r = rapportL(rs, o);
        const ms = rs.map((y) => y.ms).sort((a, b) => a - b), q = (p: number) => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(p * ms.length) - 1))] ?? 0;
        const temps = { mediane: q(0.5), p95: q(0.95) };
        const fuites = nbFuites.get(x.nom) ?? 0;
        if (fuites) { console.log(`${x.nom} : NON PUBLIABLE, ${fuites} fuite(s)`); process.exitCode = 3; }
        writeFileSync(resolve(sortie, `rapport-${x.nom}-${meth.nom}.json`), JSON.stringify({ jeu: x.nom, version: x.j.version, fige: x.fige, publiable: fuites === 0, fuites, methode: meth.nom, description: meth.description, maintenant: x.j.maintenant, quand: new Date().toISOString(), temps, ...r }, null, 1));
        writeFileSync(resolve(sortie, `tableau-${x.nom}-${meth.nom}.md`), markdownL(x.nom, meth.nom, r, x.fige, temps, fuites));
        const ratees = rs.map((y) => ({ y, j: jugerL(y.demande, y.reponse, o) })).filter((z) => !z.j.entiere);
        if (!x.fige) writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}.json`), JSON.stringify(ratees.map(({ y, j }) => ({ id: y.demande.id, langue: y.demande.langue, logique: y.demande.logique, phrase: y.demande.phrase, attendu: { decision: y.demande.decision, etapes: y.demande.etapes }, obtenu: y.reponse, jugement: j })), null, 1));
        else writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}-comptes.json`), JSON.stringify({ ratees: ratees.length, decisions: r.decisions }, null, 1));
        console.log(`${meth.nom} sur ${x.nom} : TITRE (agir) ${propC(r.titre)}, base abstention ${propC(r.base.titre)} ; pas agir ${propC(r.pasAgir)} ; toutes ${propC(r.global.entieres)} ; plafond une étape ${propC(r.global.plafondUneEtape)} ; décision ${propC(r.global.decisionJuste)} ; prudence ${propC(r.global.prudence)} ; étapes ${propC(r.global.etapes)} ; inventées ${propC(r.global.avecInventees)}`);
      }
    } finally { m.fin(); }
  } finally { fin(); }
}

if (process.argv[1] && (await import('node:path')).resolve(process.argv[1]) === (await import('node:url')).fileURLToPath(import.meta.url)) {
  await principal();
  process.exit(process.exitCode ?? 0);
}
