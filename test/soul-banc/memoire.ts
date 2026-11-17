// Banc de Brain : la MÉMOIRE. Retrouver le bon souvenir quand la question est dite AUTREMENT que le souvenir (autres
// mots, autre langue, question indirecte) ; dire « je ne sais pas » quand la mémoire n'a rien ; laisser gagner le plus
// récent quand un souvenir a été corrigé ; ne plus jamais ressortir un souvenir oublié à la demande.
//
// Un jeu de mémoire (jeux/memoire-*.json) :
//   { version, origine, fige?, maintenant, souvenirs: [souvenir], oublis: [id], questions: [question] }
//   - souvenir : { id, texte, sorte: 'note' | 'fait' | 'preference' | 'rendez-vous', date, langue, origine?, sujet?, cle?,
//                  aRelire }. `date` : le moment où il a été rangé. `origine` : 'owner' (dit par le propriétaire, défaut)
//                  ou 'agent' (tiré d'une conversation). `sujet` et `cle` : comme les faits que l'agent tire d'une
//                  conversation (src/core/agent.ts) ; un fait plus récent de même sujet et même clé REMPLACE l'ancien
//                  dans le produit. Une correction sans sujet ni clé reste à côté de l'ancien : c'est le classement qui
//                  doit faire gagner le plus récent ;
//   - oublis   : les souvenirs que le propriétaire a demandé d'oublier, oubliés après le rangement de tous ;
//   - question : { id, langue, ecriture, question, sorte, attendus: [id], interdits: [id], aRelire, note? }.
//                sortes : 'reformulee' (autres mots, même langue), 'autre-langue' (la question n'est pas dans la langue
//                du souvenir), 'indirecte' (il faut un pas de plus : « à quelle heure dois-je partir pour… »),
//                'sans-reponse' (rien dans la mémoire : la bonne réponse est « je ne sais pas », attendus vide),
//                'plus-recent' (attendus : le souvenir le plus récent ; interdits : celui qu'il corrige),
//                'oubli' (interdits : le souvenir oublié ; attendus : ce qui reste de juste, ou vide).
//
// Une réponse de méthode : les identifiants des souvenirs rendus, du plus pertinent au moins pertinent (liste vide :
// « je ne sais pas »).
//
// Mesures (par question ; n de chaque relevé dit sur quoi il porte) :
//   - premier rang : le premier souvenir rendu est attendu (questions avec réponse) ;
//   - cinq premiers : un souvenir attendu est dans les cinq premiers ;
//   - rang réciproque moyen (1 / rang du premier attendu, 0 s'il n'est pas rendu) ;
//   - fausses réponses : la mémoire n'a rien et la méthode rend quand même un souvenir (plus petit = mieux) ;
//   - plus récent : le souvenir le plus récent est rendu ET l'ancien n'est pas au-dessus de lui ;
//   - oubli : aucun souvenir oublié n'est rendu ;
//   - entièrement juste : premier rang juste sans interdit rendu au-dessus (avec réponse), liste vide (sans réponse),
//     et pour « oubli », aucun interdit rendu du tout ;
//   - ressemblance question-souvenir (trigrammes) : publiée, pour vérifier que les questions sont bien dites autrement ;
//   - temps par question (médiane, 95e centile).
//
// Le TITRE (version 2, relecture du 17/11) : parmi les questions qui ont une réponse dans la mémoire (hors « oubli »), le
// bon souvenir au premier rang. « Ne jamais rien rendre » ferait mieux que le produit sur le total mêlé : chaque chiffre
// a donc cette base à côté. « Sans réponse » (dire « je ne sais pas ») est publiée à part, et les fausses réponses ne
// comptent que ces questions-là. « Oubli » est un contrôle (le produit efface la ligne : 100 % par construction), pas une
// compétence. « Plus-recent » est coupée en deux : quand l'ancien et le nouveau ont le même sujet et la même clé, le
// produit retire l'ancien lui-même ; sinon, seul le classement fait gagner le plus récent.
import { wilson, type Proportion } from './mesure.ts';
import { objectif, propC } from './comprehension.ts';
import { jaccard, trigrammes } from './fuites.ts';

export const SORTES_Q = ['reformulee', 'autre-langue', 'indirecte', 'sans-reponse', 'plus-recent', 'oubli'] as const;
export type SorteQ = typeof SORTES_Q[number];
export const SORTES_S = ['note', 'fait', 'preference', 'rendez-vous'] as const;
export interface Souvenir { id: string; texte: string; sorte: typeof SORTES_S[number]; date: string; langue: string; origine?: 'owner' | 'agent'; sujet?: string; cle?: string; aRelire?: boolean }
export interface QuestionM { id: string; langue: string; ecriture: string; question: string; sorte: SorteQ; attendus: string[]; interdits: string[]; aRelire: boolean; note?: string }
export interface JeuM { version: number | string; origine: string; fige?: boolean; maintenant: string; souvenirs: Souvenir[]; oublis: string[]; questions: QuestionM[]; [cle: string]: unknown }
export interface ReponseM { ids: string[]; detail?: string }
export interface ResultatM { question: QuestionM; reponse: ReponseM; ms: number }

// ------------------------------------------------------------------------------------------------ une question jugée
export interface JugementM {
  avecReponse: boolean; rang1: boolean; top5: boolean; rr: number;
  /** Sans réponse dans la mémoire, et pourtant un souvenir rendu. */
  fausse: boolean;
  /** Souvenirs interdits rendus (oubliés, ou anciens corrigés). */
  interditsRendus: number;
  /** Plus récent rendu et pas d'ancien au-dessus (null si la question n'est pas « plus-recent »). */
  recent: boolean | null;
  /** Aucun souvenir oublié rendu (null si la question ne vise pas un oubli). */
  oubli: boolean | null;
  entiere: boolean;
}
export function jugerM(q: QuestionM, r: ReponseM, oublies: Set<string> = new Set()): JugementM {
  const ids = r.ids ?? [];
  const att = new Set(q.attendus), int = new Set(q.interdits);
  const rangAtt = ids.findIndex((x) => att.has(x)), rangInt = ids.findIndex((x) => int.has(x));
  const avecReponse = att.size > 0;
  const rang1 = avecReponse && ids.length > 0 && att.has(ids[0]);
  const top5 = avecReponse && rangAtt >= 0 && rangAtt < 5;
  const rr = avecReponse && rangAtt >= 0 ? 1 / (rangAtt + 1) : 0;
  const fausse = !avecReponse && ids.length > 0;
  const interditsRendus = ids.filter((x) => int.has(x)).length;
  const recent = q.sorte === 'plus-recent' ? rangAtt >= 0 && (rangInt < 0 || rangInt > rangAtt) : null;
  const visesOubli = q.interdits.filter((x) => oublies.has(x));
  const oubli = q.sorte === 'oubli' || visesOubli.length ? !ids.some((x) => oublies.has(x)) : null;
  let entiere = avecReponse ? rang1 : ids.length === 0;
  if (q.sorte === 'oubli' && interditsRendus > 0) entiere = false;
  return { avecReponse, rang1, top5, rr, fausse, interditsRendus, recent, oubli, entiere };
}

// ------------------------------------------------------------------------------------------------ relevés
export interface ReleveM {
  n: number;
  /** Parmi les questions avec réponse. */
  rang1: Proportion; top5: Proportion; mrr: number;
  /** Parmi les questions « sans-reponse » (plus petit = mieux). */
  fausses: Proportion;
  recent: Proportion; oubli: Proportion;
  entieres: Proportion;
}
export function releveM(js: Array<{ question: QuestionM; j: JugementM }>): ReleveM {
  // « Fausses réponses » : sur les questions « sans-reponse » seulement (les questions d'oubli sont jugées à part).
  const avec = js.filter((x) => x.j.avecReponse), sans = js.filter((x) => x.question.sorte === 'sans-reponse');
  const rec = js.filter((x) => x.j.recent !== null), oub = js.filter((x) => x.j.oubli !== null);
  return {
    n: js.length,
    rang1: wilson(avec.filter((x) => x.j.rang1).length, avec.length), top5: wilson(avec.filter((x) => x.j.top5).length, avec.length),
    mrr: avec.length ? avec.reduce((s, x) => s + x.j.rr, 0) / avec.length : 0,
    fausses: wilson(sans.filter((x) => x.j.fausse).length, sans.length),
    recent: wilson(rec.filter((x) => x.j.recent).length, rec.length), oubli: wilson(oub.filter((x) => x.j.oubli).length, oub.length),
    entieres: wilson(js.filter((x) => x.j.entiere).length, js.length),
  };
}
function grouperM(js: Array<{ question: QuestionM; j: JugementM }>, cle: (q: QuestionM) => string): Record<string, ReleveM> {
  const g = new Map<string, Array<{ question: QuestionM; j: JugementM }>>();
  for (const x of js) { const k = cle(x.question); if (!g.has(k)) g.set(k, []); g.get(k)!.push(x); }
  return Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, releveM(v)]));
}
/** Une langue n'est désignée « la pire » qu'avec au moins ce nombre de questions. */
export const MIN_LANGUE_M = 10;
/** Le champ du titre : une question qui a une réponse dans la mémoire, hors « oubli » (contrôle, pas compétence). */
export const avecReponseHorsOubli = (q: QuestionM) => q.attendus.length > 0 && q.sorte !== 'oubli';
/**
 * La sorte détaillée : « plus-recent » est coupée en deux. Quand l'ancien et le nouveau souvenir ont le même sujet et la
 * même clé, le produit retire lui-même l'ancien au rangement (« remplacé par le produit ») ; sinon, seul le classement
 * peut faire gagner le plus récent (« classement seul »).
 */
export function sorteDetaillee(q: QuestionM, parId: Map<string, Souvenir>): string {
  if (q.sorte !== 'plus-recent') return q.sorte;
  const a = parId.get(q.attendus[0] ?? ''), b = parId.get(q.interdits[0] ?? '');
  const k = (s?: Souvenir) => (s?.sujet && s.cle ? `${s.sujet.trim().toLowerCase()}|${s.cle.trim().toLowerCase()}` : '');
  return k(a) && k(a) === k(b) ? 'plus-recent (remplacé par le produit)' : 'plus-recent (classement seul)';
}
export interface RapportM {
  /** LE chiffre en tête : questions avec réponse (hors « oubli ») dont le bon souvenir est au premier rang. */
  titre: Proportion;
  /** Questions « sans-reponse » où la méthode ne rend rien (sans les questions d'oubli). */
  sansReponse: Proportion;
  /** Questions « oubli » où aucun souvenir oublié ne ressort : un CONTRÔLE (le produit efface la ligne), pas une compétence. */
  oubli: Proportion;
  titreFrancais: Proportion; titreAutres: Proportion; titreParLangue: Record<string, Proportion>;
  /** Par sorte, « plus-recent » coupée en deux (voir sorteDetaillee). */
  parSorteDetail: Record<string, ReleveM>;
  /** Les mêmes chiffres pour une méthode qui ne rend jamais rien. */
  base: { titre: Proportion; sansReponse: Proportion; global: ReleveM; parSorteDetail: Record<string, ReleveM> };
  global: ReleveM; parSorte: Record<string, ReleveM>; parLangue: Record<string, ReleveM>; parEcriture: Record<string, ReleveM>;
  /** La question est-elle dans la langue de son (premier) souvenir attendu ? */
  parLangueDuSouvenir: Record<string, ReleveM>;
  francais: ReleveM; autres: ReleveM;
  /** Moyenne des langues (part entièrement juste, toutes sortes) ; la pire langue, sur le titre (n ≥ MIN_LANGUE_M). */
  moyenneLangues: number; pireLangue: { langue: string; p: number; n: number } | null;
  /** Combien de souvenirs rendus par question (médiane, et part des questions sans aucun). */
  rendus: { mediane: number; aucun: Proportion };
}
export function rapportM(rs: ResultatM[], jeu: Pick<JeuM, 'souvenirs' | 'oublis'>): RapportM {
  const oublies = new Set(jeu.oublis ?? []), langueDe = new Map(jeu.souvenirs.map((s) => [s.id, s.langue])), parId = new Map(jeu.souvenirs.map((s) => [s.id, s]));
  const js = rs.map((x) => ({ question: x.question, j: jugerM(x.question, x.reponse, oublies) }));
  const jb = rs.map((x) => ({ question: x.question, j: jugerM(x.question, { ids: [] }, oublies) }));
  const titre = (l: typeof js) => { const a = l.filter((x) => avecReponseHorsOubli(x.question)); return wilson(a.filter((x) => x.j.entiere).length, a.length); };
  const sansRep = (l: typeof js) => { const a = l.filter((x) => x.question.sorte === 'sans-reponse'); return wilson(a.filter((x) => x.j.entiere).length, a.length); };
  const parLangue = grouperM(js, (q) => q.langue || '?');
  // La pire langue : sur le titre, parmi les langues d'au moins MIN_LANGUE_M questions.
  const ls = Object.entries(parLangue);
  const titreParLangue = Object.fromEntries(ls.map(([l]) => [l, titre(js.filter((x) => (x.question.langue || '?') === l))]));
  let pire: RapportM['pireLangue'] = null;
  for (const [langue, r] of ls) { const t = titreParLangue[langue]; if (r.n >= MIN_LANGUE_M && t.n && (!pire || t.p < pire.p)) pire = { langue, p: t.p, n: t.n }; }
  const n = rs.map((x) => x.reponse.ids.length).sort((a, b) => a - b);
  const oub = js.filter((x) => x.question.sorte === 'oubli');
  return {
    titre: titre(js), sansReponse: sansRep(js), oubli: wilson(oub.filter((x) => x.j.oubli === true).length, oub.length),
    titreFrancais: titre(js.filter((x) => x.question.langue === 'fr')), titreAutres: titre(js.filter((x) => x.question.langue !== 'fr')), titreParLangue,
    parSorteDetail: grouperM(js, (q) => sorteDetaillee(q, parId)),
    base: { titre: titre(jb), sansReponse: sansRep(jb), global: releveM(jb), parSorteDetail: grouperM(jb, (q) => sorteDetaillee(q, parId)) },
    global: releveM(js), parSorte: grouperM(js, (q) => q.sorte), parLangue, parEcriture: grouperM(js, (q) => q.ecriture || '?'),
    parLangueDuSouvenir: grouperM(js, (q) => (!q.attendus.length ? 'sans souvenir attendu' : langueDe.get(q.attendus[0]) === q.langue ? 'même langue' : 'autre langue')),
    francais: releveM(js.filter((x) => x.question.langue === 'fr')), autres: releveM(js.filter((x) => x.question.langue !== 'fr')),
    moyenneLangues: ls.length ? ls.reduce((s, [, r]) => s + r.entieres.p, 0) / ls.length : 0, pireLangue: pire,
    rendus: { mediane: n.length ? n[Math.floor((n.length - 1) / 2)] : 0, aucun: wilson(n.filter((x) => x === 0).length, n.length) },
  };
}

// ------------------------------------------------------------------------------------------------ contrôle d'un jeu
/** Ressemblance (trigrammes de caractères) entre une question et chacun de ses souvenirs attendus : la plus forte. */
export function ressemblance(q: QuestionM, parId: Map<string, Souvenir>): number {
  const a = trigrammes(q.question);
  return Math.max(0, ...q.attendus.map((id) => { const s = parId.get(id); return s ? jaccard(a, trigrammes(s.texte)) : 0; }));
}
/** Défauts d'un jeu de mémoire (liste vide si tout va bien). */
export function defautsJeuM(j: unknown, seuilRessemblance = 0.6): string[] {
  const out: string[] = [];
  const o = j as JeuM;
  if (!o || typeof o !== 'object' || !Array.isArray(o.souvenirs) || !Array.isArray(o.questions)) return ['le jeu n\'a pas de listes « souvenirs » et « questions »'];
  if (typeof o.maintenant !== 'string' || Number.isNaN(new Date(o.maintenant).getTime())) out.push('« maintenant » (l\'heure figée du jeu) manque ou est illisible');
  if (!Array.isArray(o.oublis)) out.push('« oublis » n\'est pas une liste');
  const maintenant = new Date(o.maintenant).getTime();
  const parId = new Map<string, Souvenir>(), ids = new Set<string>();
  o.souvenirs.forEach((s, i) => {
    const ou = `souvenir ${i} (${s?.id ?? 'sans id'})`;
    if (!s || typeof s !== 'object') { out.push(`${ou} : pas un objet`); return; }
    if (typeof s.id !== 'string' || !s.id) out.push(`${ou} : id manquant`); else if (ids.has(s.id)) out.push(`${ou} : id en double`); else { ids.add(s.id); parId.set(s.id, s); }
    if (typeof s.texte !== 'string' || !s.texte.trim()) out.push(`${ou} : texte vide`);
    if (!(SORTES_S as readonly string[]).includes(s.sorte)) out.push(`${ou} : sorte inconnue « ${s.sorte} »`);
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t)) out.push(`${ou} : date illisible`); else if (t > maintenant) out.push(`${ou} : rangé après « maintenant »`);
    if (typeof s.langue !== 'string' || !s.langue) out.push(`${ou} : langue manquante`);
    if (s.origine !== undefined && s.origine !== 'owner' && s.origine !== 'agent') out.push(`${ou} : origine inconnue`);
    if (Boolean(s.sujet) !== Boolean(s.cle)) out.push(`${ou} : sujet et clé vont ensemble`);
  });
  for (const id of o.oublis ?? []) if (!parId.has(id)) out.push(`oubli inconnu « ${id} »`);
  const qids = new Set<string>();
  o.questions.forEach((q, i) => {
    const ou = `question ${i} (${q?.id ?? 'sans id'})`;
    if (!q || typeof q !== 'object') { out.push(`${ou} : pas un objet`); return; }
    if (typeof q.id !== 'string' || !q.id) out.push(`${ou} : id manquant`); else if (qids.has(q.id) || ids.has(q.id)) out.push(`${ou} : id en double`); else qids.add(q.id);
    if (typeof q.question !== 'string' || !q.question.trim()) out.push(`${ou} : question vide`);
    if (typeof q.langue !== 'string' || !q.langue) out.push(`${ou} : langue manquante`);
    if (typeof q.ecriture !== 'string' || !q.ecriture) out.push(`${ou} : écriture manquante`);
    if (typeof q.aRelire !== 'boolean') out.push(`${ou} : aRelire manquant`);
    if (!(SORTES_Q as readonly string[]).includes(q.sorte)) out.push(`${ou} : sorte inconnue « ${q.sorte} »`);
    if (!Array.isArray(q.attendus) || !Array.isArray(q.interdits)) { out.push(`${ou} : attendus et interdits doivent être des listes`); return; }
    for (const id of [...q.attendus, ...q.interdits]) if (!parId.has(id)) out.push(`${ou} : souvenir inconnu « ${id} »`);
    for (const id of q.attendus) if ((o.oublis ?? []).includes(id)) out.push(`${ou} : attend un souvenir oublié « ${id} »`);
    if (q.sorte === 'sans-reponse' && q.attendus.length) out.push(`${ou} : sans réponse, mais des souvenirs attendus`);
    if (q.sorte !== 'sans-reponse' && q.sorte !== 'oubli' && !q.attendus.length) out.push(`${ou} : aucun souvenir attendu`);
    if (q.sorte === 'plus-recent') {
      if (!q.interdits.length) out.push(`${ou} : plus récent sans ancien souvenir corrigé`);
      for (const a of q.attendus) for (const b of q.interdits) { const x = parId.get(a), y = parId.get(b); if (x && y && new Date(x.date) <= new Date(y.date)) out.push(`${ou} : « ${a} » n'est pas plus récent que « ${b} »`); }
    }
    if (q.sorte === 'oubli' && !q.interdits.some((x) => (o.oublis ?? []).includes(x))) out.push(`${ou} : oubli sans souvenir oublié dans interdits`);
    if (q.sorte === 'autre-langue' && q.attendus.every((id) => parId.get(id)?.langue === q.langue)) out.push(`${ou} : « autre-langue », mais dans la langue du souvenir`);
    const r = ressemblance(q, parId);
    if (r >= seuilRessemblance) out.push(`${ou} : question trop proche de son souvenir (trigrammes ${r.toFixed(2)} ≥ ${seuilRessemblance})`);
  });
  return out;
}

/** Les comptes d'un jeu. */
export function comptesM(j: JeuM): Record<string, unknown> {
  const par = <T>(l: T[], f: (x: T) => string) => Object.fromEntries(Object.entries(l.reduce<Record<string, number>>((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  const parId = new Map(j.souvenirs.map((s) => [s.id, s]));
  const r = j.questions.filter((q) => q.attendus.length).map((q) => ressemblance(q, parId)).sort((a, b) => a - b);
  return {
    souvenirs: j.souvenirs.length, questions: j.questions.length, oublis: (j.oublis ?? []).length,
    souvenirsAvecSujetEtCle: j.souvenirs.filter((s) => s.sujet).length, souvenirsARelire: j.souvenirs.filter((s) => s.aRelire).length, questionsARelire: j.questions.filter((q) => q.aRelire).length,
    souvenirsParSorte: par(j.souvenirs, (s) => s.sorte), souvenirsParLangue: par(j.souvenirs, (s) => s.langue),
    questionsParSorte: par(j.questions, (q) => q.sorte), questionsParLangue: par(j.questions, (q) => q.langue), questionsParEcriture: par(j.questions, (q) => q.ecriture),
    souvenirsVisesParUneQuestion: new Set(j.questions.flatMap((q) => [...q.attendus, ...q.interdits])).size,
    ressemblanceQuestionSouvenir: r.length ? { mediane: Number(r[Math.floor((r.length - 1) / 2)].toFixed(3)), max: Number(r[r.length - 1].toFixed(3)) } : null,
  };
}

// ------------------------------------------------------------------------------------------------ la mémoire du produit
export interface MethodeM { nom: string; description: string; repondre(question: string): Promise<ReponseM> | ReponseM }
/** Fait croire au produit qu'il est l'heure `t` le temps de `f` (rangement daté, rappel à l'heure figée du jeu). */
export function aLHeure<T>(t: number, f: () => T): T {
  const vrai = Date.now;
  Date.now = () => t;
  try { return f(); } finally { Date.now = vrai; }
}
/**
 * Range les souvenirs du jeu dans la mémoire du produit (Mnemosyne de src/muninn/store.ts, dans le dossier d'un Odin
 * jetable), chacun à sa date, avec son origine, son sujet et sa clé, puis oublie ceux de `oublis` (forget du produit).
 * Rend les méthodes de recherche du produit, appelées telles quelles à l'heure figée du jeu :
 *   - « rappel »    : l'outil memory_search (src/tools/builtin.ts : recall, 10 souvenirs, classés par pertinence BM25 ×
 *                     confiance × fraîcheur) — c'est aussi le rappel par mots de l'agent (recallSmart sans plongements) ;
 *   - « souvenirs » : findMemories (la part « souvenirs » de cerveau_chercher et de la page du Cerveau : BM25 seul).
 * La recherche par le SENS (plongements de Soul, src/brain/nous/plongement.ts) n'est mesurée que si un point de reprise
 * de Soul existe dans le dossier : dans un Odin neuf, il n'y en a pas (aucun modèle livré) et le produit retombe sur
 * les mots ; la méthode est alors dite absente, avec sa raison.
 */
export async function memoireDuProduit(home: string, jeu: JeuM): Promise<{ methodes: MethodeM[]; absentes: Array<{ nom: string; raison: string }>; ranges: number; remplaces: number; fin(): void }> {
  const { join } = await import('node:path');
  const { Mnemosyne } = await import('../../src/muninn/store.ts');
  const mem = new Mnemosyne(join(home, 'memoire-banc'));
  const versJeu = new Map<number, string>(), versProduit = new Map<string, number>();
  let remplaces = 0;
  const tri = [...jeu.souvenirs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (const s of tri) {
    const r = aLHeure(new Date(s.date).getTime(), () => mem.remember(s.texte, s.origine ?? 'owner', s.sorte === 'rendez-vous' ? 'event' : s.sorte === 'preference' ? 'preference' : s.sorte === 'note' ? 'note' : 'fact', '', s.sujet ? { subject: s.sujet, topic: s.cle, source: 'banc de mémoire' } : { source: 'banc de mémoire' }));
    if (r.replaced !== undefined) remplaces++;
    versJeu.set(r.id, s.id); versProduit.set(s.id, r.id);
  }
  for (const id of jeu.oublis ?? []) { const p = versProduit.get(id); if (p !== undefined) mem.forget(p); }
  const maintenant = new Date(jeu.maintenant).getTime();
  const enJeu = (ids: number[]) => ids.map((x) => versJeu.get(x) ?? `#${x}`);
  const { memorySearch } = await import('../../src/tools/builtin.ts');
  const methodes: MethodeM[] = [
    {
      nom: 'rappel', description: 'outil memory_search du produit (recall de src/muninn/store.ts, 10 souvenirs, BM25 × confiance × fraîcheur), à l\'heure figée du jeu',
      async repondre(question) {
        const vrai = Date.now; Date.now = () => maintenant;
        try {
          const out = await memorySearch.run({ query: question }, { muninn: mem } as never);
          const texte = typeof out === 'string' ? out : String((out as { output?: string }).output ?? '');
          if (/^Aucun souvenir pertinent/.test(texte)) return { ids: [], detail: 'aucun souvenir' };
          return { ids: enJeu([...texte.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]))) };
        } finally { Date.now = vrai; }
      },
    },
    { nom: 'souvenirs', description: 'findMemories du produit (part « souvenirs » de cerveau_chercher et de la page du Cerveau : BM25 seul, 10 souvenirs)', repondre: (question) => aLHeure(maintenant, () => ({ ids: enJeu(mem.findMemories(question, 10).map((m) => m.id)) })) },
  ];
  const absentes: Array<{ nom: string; raison: string }> = [];
  try {
    const { listerReprises } = await import('../../src/brain/nous/reprise.ts');
    if (!listerReprises(home).length) absentes.push({ nom: 'sens', raison: 'aucun point de reprise de Soul dans un Odin neuf (aucun modèle livré) : les plongements échouent et le produit retombe sur la recherche par mots, déjà mesurée par « rappel »' });
    else absentes.push({ nom: 'sens', raison: 'un point de reprise existe, mais ce banc ne range pas encore les vecteurs (à brancher : setVector puis nearest)' });
  } catch (e) { absentes.push({ nom: 'sens', raison: `points de reprise illisibles : ${String((e as Error)?.message ?? e).slice(0, 160)}` }); }
  return { methodes, absentes, ranges: tri.length, remplaces, fin: () => { try { mem.close(); } catch { /* rien */ } } };
}

// ------------------------------------------------------------------------------------------------ la commande
//   node --disable-warning=ExperimentalWarning test/soul-banc/memoire.ts \
//        --jeu test/soul-banc/jeux/memoire-developpement.json --jeu test/soul-banc/jeux/memoire-principal.json \
//        --sortie <dossier> [--seuil 0.8]
// Écrit, par jeu : defauts-<jeu>.json, comptes-<jeu>.json, fuites-<jeu>.json (sans texte pour un jeu figé), et pour
// chaque méthode rapport-<jeu>-<méthode>.json, tableau-<jeu>-<méthode>.md ; ratees-… pour un jeu de développement.
const ENTETE = '| groupe | n | entièrement juste | 1er rang | 5 premiers | rang réciproque moyen | fausses réponses (rien en mémoire) | plus récent | oubli |\n|---|---:|---|---|---|---:|---|---|---|';
const ligneM = (k: string, r: ReleveM) => `| ${k} | ${r.n} | ${propC(r.entieres)} | ${propC(r.rang1)} | ${propC(r.top5)} | ${r.mrr.toFixed(3).replace('.', ',')} | ${propC(r.fausses)} | ${propC(r.recent)} | ${propC(r.oubli)} |`;
const pc = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
export function markdownM(jeu: string, methode: string, r: RapportM, fige: boolean, temps: { mediane: number; p95: number }, rangement: { ranges: number; remplaces: number; oublis: number }, fuites = 0): string {
  const g = r.global;
  return [
    `# Banc de mémoire : ${methode} sur ${jeu}`, '',
    ...(fuites ? [`**NON PUBLIABLE : ${fuites} fuite(s) vers la matière d'apprentissage ou un autre jeu.**`, ''] : []),
    `Jeu ${fige ? 'FIGÉ (aucun texte écrit ici)' : 'de développement'} ; ${rangement.ranges} souvenirs rangés (${rangement.remplaces} remplacés par un plus récent de même sujet et même clé), ${rangement.oublis} oubliés ; ${g.n} questions. Intervalles de Wilson à 95 %.`, '',
    '## En tête', '',
    `- **Titre — questions avec réponse (hors « oubli ») : le bon souvenir au premier rang : ${propC(r.titre)}** ; base « ne jamais rien rendre » : ${propC(r.base.titre)}.`,
    `- Français : ${propC(r.titreFrancais)} ; autres langues : ${propC(r.titreAutres)}.`,
    `- Questions sans réponse dans la mémoire : rien rendu (« je ne sais pas ») : ${propC(r.sansReponse)} ; base « ne jamais rien rendre » : ${propC(r.base.sansReponse)}.`,
    `- Oubli : aucun souvenir oublié ne ressort : ${propC(r.oubli)} — un contrôle, pas une compétence (le produit efface la ligne et l'index ; 100 % par construction).`,
    `- Toutes questions mêlées : ${propC(g.entieres)} ; base « ne jamais rien rendre » : ${propC(r.base.global.entieres)} (ce chiffre récompense le silence : il n'est pas le titre).`,
    `- Bon souvenir au premier rang : ${propC(g.rang1)} ; dans les cinq premiers : ${propC(g.top5)} ; rang réciproque moyen ${g.mrr.toFixed(3).replace('.', ',')}.`,
    `- Fausses réponses quand la mémoire n'a rien (plus petit = mieux) : ${propC(g.fausses)}.`,
    `- Le plus récent gagne : ${propC(g.recent)} ; un souvenir oublié ne ressort pas : ${propC(g.oubli)}.`,
    `- Souvenirs rendus par question : médiane ${r.rendus.mediane} ; questions sans aucun souvenir rendu : ${propC(r.rendus.aucun)}.`,
    `- Moyenne des langues (toutes questions) : ${pc(r.moyenneLangues)} ; la pire au titre (langues d'au moins ${MIN_LANGUE_M} questions ; à égalité, la première par ordre alphabétique) : ${r.pireLangue ? `${r.pireLangue.langue} ${pc(r.pireLangue.p)} sur ${r.pireLangue.n}` : '—'}.`,
    `- Temps par question : médiane ${temps.mediane.toFixed(2)} ms, 95e centile ${temps.p95.toFixed(2)} ms.`, '',
    '## Objectif 100 %, sorte par sorte (« plus-recent » coupée en deux)', '', ...objectif(r.parSorteDetail, r.base.parSorteDetail), '',
    '## Titre par langue de la question', '', '| langue | bon souvenir au 1er rang |', '|---|---|', ...Object.entries(r.titreParLangue).map(([k, p]) => `| ${k} | ${propC(p)} |`), '',
    '## Par sorte de question (« plus-recent » coupée en deux)', '', ENTETE, ...Object.entries(r.parSorteDetail).map(([k, x]) => ligneM(k, x)), '',
    '## Question dans la langue du souvenir ?', '', ENTETE, ...Object.entries(r.parLangueDuSouvenir).map(([k, x]) => ligneM(k, x)), '',
    '## Par langue de la question', '', ENTETE, ...Object.entries(r.parLangue).map(([k, x]) => ligneM(k, x)), '',
    '## Par écriture', '', ENTETE, ...Object.entries(r.parEcriture).map(([k, x]) => ligneM(k, x)), '',
  ].join('\n');
}

async function principal(): Promise<void> {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { basename, resolve } = await import('node:path');
  const { performance } = await import('node:perf_hooks');
  const args = process.argv.slice(2);
  const tous = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
  const jeux = tous('jeu'), sortie = tous('sortie')[0], seuil = Number(tous('seuil')[0] ?? '0.8');
  if (!jeux.length || !sortie) { console.error('usage : memoire.ts --jeu <fichier.json> [--jeu …] --sortie <dossier> [--seuil 0.8]'); process.exitCode = 2; return; }
  const { dossierJetable, environnementBanc, modulesDuProduit } = await import('./catalogue.ts');
  const { home, fin } = dossierJetable('odin-soul-memoire-');
  environnementBanc(home);
  mkdirSync(sortie, { recursive: true });
  try {
    const mods = await modulesDuProduit(home);
    const lus = jeux.map((f) => { const j = JSON.parse(readFileSync(f, 'utf8')) as JeuM; const nom = basename(f).replace(/\.json$/i, ''); return { nom, j, fige: j.fige === true || nom.includes('principal') }; });
    const F = await import('./fuites.ts');
    const { textesDesJeux } = await import('./logique.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    const index = new F.Index([...sources, ...(await textesDesJeux(lus.map((x) => x.nom)))]);
    const textes = (j: JeuM) => [...j.souvenirs.map((s) => ({ id: s.id, phrase: s.texte })), ...j.questions.map((q) => ({ id: q.id, phrase: q.question }))] as never;
    const nbFuites = new Map<string, number>();
    for (const x of lus) {
      const defauts = defautsJeuM(x.j);
      writeFileSync(resolve(sortie, `defauts-${x.nom}.json`), JSON.stringify(defauts, null, 1));
      writeFileSync(resolve(sortie, `comptes-${x.nom}.json`), JSON.stringify(comptesM(x.j), null, 1));
      const contre = F.fuitesContre(textes(x.j), index, seuil), internes = F.doublonsInternes(textes(x.j), seuil);
      const entre = lus.filter((y) => y !== x).map((y) => ({ jeu: y.nom, fuites: F.fuitesContre(textes(x.j), new F.Index((textes(y.j) as unknown as Array<{ id: string; phrase: string }>).map((d) => ({ texte: d.phrase, source: `${y.nom}#${d.id}` }))), seuil) }));
      const masquer = (l: ReturnType<typeof F.fuitesContre>) => (x.fige ? l.map(({ phrase: _p, texteSource: _t, ...r }) => r) : l);
      writeFileSync(resolve(sortie, `fuites-${x.nom}.json`), JSON.stringify({ seuil, sources: index.taille, contreApprentissageEtJeux: masquer(contre), internes: masquer(internes), entreJeux: entre.map((e) => ({ jeu: e.jeu, fuites: masquer(e.fuites) })) }, null, 1));
      nbFuites.set(x.nom, contre.length + internes.length + entre.reduce((s, e) => s + e.fuites.length, 0));
      console.log(`${x.nom} : ${x.j.souvenirs.length} souvenirs,${x.j.questions.length} questions, ${defauts.length} défaut(s) ; fuites contre l'apprentissage et les autres jeux ${contre.length}, internes ${internes.length}, ${entre.map((e) => `contre ${e.jeu} ${e.fuites.length}`).join(', ')}`);
      for (const d of defauts.slice(0, 30)) console.log(`  défaut : ${d}`);
    }
    for (const x of lus) {
      const { mkdtempSync } = await import('node:fs');
      const sous = mkdtempSync(resolve(home, `jeu-${x.nom}-`));
      const p = await memoireDuProduit(sous, x.j);
      try {
        for (const a of p.absentes) console.log(`${x.nom} : méthode « ${a.nom} » absente — ${a.raison}`);
        for (const meth of p.methodes) {
          const rs: ResultatM[] = [];
          for (const q of x.j.questions) {
            const t = performance.now();
            let reponse: ReponseM;
            try { reponse = await meth.repondre(q.question); } catch (e) { reponse = { ids: [], detail: `erreur : ${String((e as Error)?.message ?? e).slice(0, 160)}` }; }
            rs.push({ question: q, reponse, ms: performance.now() - t });
          }
          const r = rapportM(rs, x.j);
          const ms = rs.map((y) => y.ms).sort((a, b) => a - b), qq = (v: number) => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(v * ms.length) - 1))] ?? 0;
          const temps = { mediane: qq(0.5), p95: qq(0.95) };
          const rangement = { ranges: p.ranges, remplaces: p.remplaces, oublis: (x.j.oublis ?? []).length };
          const fuites = nbFuites.get(x.nom) ?? 0;
          if (fuites) { console.log(`${x.nom} : NON PUBLIABLE, ${fuites} fuite(s)`); process.exitCode = 3; }
          writeFileSync(resolve(sortie, `rapport-${x.nom}-${meth.nom}.json`), JSON.stringify({ jeu: x.nom, version: x.j.version, fige: x.fige, publiable: fuites === 0, fuites, methode: meth.nom, description: meth.description, absentes: p.absentes, maintenant: x.j.maintenant, quand: new Date().toISOString(), temps, rangement, ...r }, null, 1));
          writeFileSync(resolve(sortie, `tableau-${x.nom}-${meth.nom}.md`), markdownM(x.nom, meth.nom, r, x.fige, temps, rangement, fuites));
          const oublies = new Set(x.j.oublis ?? []);
          const ratees = rs.map((y) => ({ y, j: jugerM(y.question, y.reponse, oublies) })).filter((z) => !z.j.entiere);
          if (!x.fige) {
            const parId = new Map(x.j.souvenirs.map((s) => [s.id, s]));
            writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}.json`), JSON.stringify(ratees.map(({ y, j }) => ({ id: y.question.id, langue: y.question.langue, sorte: y.question.sorte, question: y.question.question, attendus: y.question.attendus.map((a) => `${a} : ${parId.get(a)?.texte}`), interdits: y.question.interdits, rendus: y.reponse.ids.slice(0, 5).map((a) => `${a} : ${parId.get(a)?.texte ?? '?'}`), jugement: j })), null, 1));
          } else writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}-comptes.json`), JSON.stringify({ ratees: ratees.length, parSorte: ratees.reduce<Record<string, number>>((o, { y }) => { o[y.question.sorte] = (o[y.question.sorte] ?? 0) + 1; return o; }, {}) }, null, 1));
          console.log(`${meth.nom} sur ${x.nom} : TITRE (avec réponse) ${propC(r.titre)}, base « rien » ${propC(r.base.titre)} ; sans réponse ${propC(r.sansReponse)} ; toutes ${propC(r.global.entieres)} ; 1er rang ${propC(r.global.rang1)} ; 5 premiers ${propC(r.global.top5)} ; fausses réponses ${propC(r.global.fausses)} ; plus récent ${propC(r.global.recent)} ; oubli ${propC(r.global.oubli)} ; médiane ${temps.mediane.toFixed(2)} ms`);
        }
      } finally { p.fin(); }
    }
  } finally { fin(); }
}

if (process.argv[1] && (await import('node:path')).resolve(process.argv[1]) === (await import('node:url')).fileURLToPath(import.meta.url)) {
  await principal();
  process.exit(process.exitCode ?? 0);
}
