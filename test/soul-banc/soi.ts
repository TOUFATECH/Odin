// Banc « connaissance de soi » : ce qu'Odin sait de LUI-MÊME (son infrastructure, son interface, son modèle, son
// acquisition). La MESURE (fonctions pures), la PRÉPARATION d'un Odin jetable, les ADAPTATEURS et la COMMANDE.
//
//   node --disable-warning=ExperimentalWarning test/soul-banc/soi.ts \
//        --jeu test/soul-banc/jeux/soi-developpement.json --jeu test/soul-banc/jeux/soi-principal.json \
//        --methodes produit,mots,ngrammes --sortie <dossier> [--seuil 0.8]
//
// Un jeu (jeux/soi-*.json) :
//   { version, origine, fige?, maintenant, preparation, questions: [question] }
//   - preparation : ce que le jeu met dans l'Odin jetable AVANT de fabriquer les fiches (rien d'autre n'y est) :
//       machine (figée par le jeu : les chiffres ne dépendent pas de la machine qui mesure), config (fusionnée dans
//       config.json : sauvegarde, surveillance, services…), appareils (un balayage de l'inventaire : ip, mac, nom),
//       deconnectes (les ip absentes d'un second balayage), mathesis (réglages, journal, sites à absorber), souvenirs ;
//   - question : { id, langue, ecriture, question, famille, sorte, attendus: [id de fiche], valeur?, aRelire, note? }
//       famille : infrastructure | interface | modele | acquisition | aucune (sans réponse) ;
//       sorte : 'directe' (la réponse est dans le code), 'etat' (elle dépend de l'Odin préparé : `valeur` doit figurer
//       dans la fiche attendue), 'sans-reponse' (attendus vide : la bonne réponse est « je ne sais pas »).
//
// Une réponse de méthode : les identifiants des fiches rendues, de la plus pertinente à la moins pertinente (liste vide :
// « je ne sais pas »).
//
// Mesures (par question ; le n de chaque relevé dit sur quoi il porte) :
//   - premier rang : la première fiche rendue est attendue (questions avec réponse) ;
//   - trois premiers : une fiche attendue est dans les trois premières ;
//   - rang réciproque moyen ;
//   - fausses réponses : rien à répondre et la méthode rend quand même une fiche (plus petit = mieux) ;
//   - fiche à jour : pour une question d'état, la fiche attendue contient bien `valeur` (contrôle de la FABRIQUE, pas de
//     la méthode : si ce chiffre n'est pas 100 %, c'est la fabrique qui ment) ;
//   - entièrement juste : premier rang juste (et fiche à jour pour une question d'état), ou liste vide sans réponse ;
//   - le tout par famille, par sorte, par langue, par écriture ; temps par question (médiane, 95e centile).
// Version 2 (après relecture) : une fiche qui dit la même réponse que la fiche attendue compte aussi (fichesAcceptees) ;
// le PRODUIT est jugé sur le texte qu'il rend (jugerTexte : la valeur, ou le lieu), ses lectures sont lancées comme
// Odin les lancerait ; « avec réponse » et « sans réponse » sont publiés séparément.
import { wilson, centile, type Proportion } from './mesure.ts';
import type { Fiche, SourcesSoi } from '../../src/brain/nous/connaissance-de-soi.ts';

export const FAMILLES_Q = ['infrastructure', 'interface', 'modele', 'acquisition', 'aucune'] as const;
export const SORTES_Q = ['directe', 'etat', 'sans-reponse'] as const;
export type SorteSoi = typeof SORTES_Q[number];
export interface QuestionSoi { id: string; langue: string; ecriture: string; question: string; famille: typeof FAMILLES_Q[number]; sorte: SorteSoi; attendus: string[]; valeur?: string; aRelire: boolean; note?: string }
export interface Preparation {
  machine?: SourcesSoi['machine'];
  config?: Record<string, unknown>;
  appareils?: Array<{ ip: string; mac: string; nom: string; genre?: string; important?: boolean }>;
  deconnectes?: string[];
  mathesis?: { reglages?: Record<string, unknown>; journal?: Array<{ id: string; at: string; genre: string; quoi: string; pourquoi?: string; source?: string; retenu?: Array<{ texte: string; niveau: string }> }>; sites?: Array<{ id: string; racine: string; etat: string; lues?: number; connues?: number; ajoute?: string }> };
  souvenirs?: string[];
}
export interface JeuSoi { version: number | string; origine: string; fige?: boolean; maintenant: string; preparation: Preparation; questions: QuestionSoi[]; [cle: string]: unknown }
/**
 * Une réponse : les fiches rendues (méthodes de recherche) ; et, pour le PRODUIT (version 2), le TEXTE qu'il a rendu :
 * il est alors jugé sur ce qu'il dit (la valeur, ou le lieu), pas sur les fiches qu'il « nomme ».
 */
export interface ReponseSoi { ids: string[]; texte?: string; detail?: string }
export interface ResultatSoi { question: QuestionSoi; reponse: ReponseSoi; ms: number }

// ------------------------------------------------------------------------------------------------ une question jugée
/** Texte ramené pour comparer (minuscules, sans accents, espaces simples). */
export const plat = (t: string) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s ]+/g, ' ').trim();
/** Le texte en mots séparés par une espace, bordé d'espaces (pour chercher un élément « mot entier »). */
const mots = (t: string) => ` ${plat(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** L'élément figure-t-il dans le texte, en mots entiers (sans accents ni casse, ponctuation ignorée) ? */
export const dit = (texte: string, element: string) => { const e = mots(element).trim(); return e.length > 0 && mots(texte).includes(` ${e} `); };
/**
 * Version 2 (M1) : les fiches qui répondent AUSSI à la question. Une autre fiche répond quand son texte dit tout ce que
 * la réponse attendue doit dire (`reponse` de la fiche attendue : la valeur, ou le lieu), et la valeur pour une question
 * d'état. Seulement quand la réponse attendue est précise (au moins deux éléments, ou un nombre) : sinon une fiche qui
 * dit seulement « Réglages » répondrait à tout.
 */
export function fichesAcceptees(q: QuestionSoi, parId?: Map<string, Fiche>): Set<string> {
  const ok = new Set(q.attendus);
  if (!parId) return ok;
  for (const id of q.attendus) {
    const f = parId.get(id), el = f?.reponse ?? [];
    if (!(el.length >= 2 || el.some((x) => /\d/.test(x)))) continue;
    for (const g of parId.values()) {
      if (ok.has(g.id)) continue;
      const t = `${g.texte} ${g.ou ? `${g.ou.page} ${g.ou.onglet ?? ''} ${g.ou.reglage ?? ''}` : ''}`;
      if (el.every((x) => dit(t, x)) && (q.sorte !== 'etat' || !q.valeur || plat(t).includes(plat(q.valeur)))) ok.add(g.id);
    }
  }
  return ok;
}
/**
 * Version 2 (G3) : le PRODUIT jugé sur son texte. Une question avec réponse est juste quand le texte dit tout ce que
 * l'une des fiches acceptées doit faire dire (sa `reponse`, sinon l'une de ses clés propres) ET, pour une question
 * d'état, la valeur. Une question sans réponse est juste quand le texte ne nomme aucune fiche (clés propres à une seule
 * fiche et précises, voir fichesNommees).
 */
export function jugerTexte(q: QuestionSoi, texte: string, fiches: Fiche[], parId: Map<string, Fiche>): boolean {
  if (!q.attendus.length) return fichesNommees(texte, fiches).length === 0;
  const propres = clesPropres(fiches);
  // La réponse de la fiche quand elle en a une (le lieu ou la valeur) ; sinon l'une de ses clés propres.
  const nomme = (f: Fiche) => (f.reponse?.length ? f.reponse.every((x) => dit(texte, x)) : f.cles.some((c) => propres.has(c) && dit(texte, c)));
  const acceptees = [...fichesAcceptees(q, parId)].map((id) => parId.get(id)).filter((f): f is Fiche => Boolean(f));
  if (q.sorte === 'etat' && q.valeur) {
    // Une question d'état : la valeur doit être dite. Une valeur vague (« déconnecté », « en pause », « mars ») ne
    // suffit pas seule : le texte doit aussi dire de quoi il parle (la fiche nommée, ou sa réponse).
    if (!dit(texte, q.valeur) && !plat(texte).includes(plat(q.valeur))) return false;
    const precise = /[\d.@]/.test(q.valeur) || plat(q.valeur).length >= 11;
    const parle = (f: Fiche) => nomme(f) || f.cles.some((c) => propres.has(c) && dit(texte, c));
    return precise || acceptees.some(parle) || acceptees.every((f) => !f.reponse?.length && !f.cles.some((c) => propres.has(c)));
  }
  return acceptees.some(nomme);
}
export interface JugementSoi { avecReponse: boolean; rang1: boolean; top3: boolean; rr: number; fausse: boolean; aJour: boolean | null; entiere: boolean; /** jugé sur le texte (produit) plutôt que sur les fiches rendues */ surTexte: boolean }
export function jugerSoi(q: QuestionSoi, r: ReponseSoi, parId?: Map<string, Fiche>, fiches?: Fiche[]): JugementSoi {
  const ids = r.ids ?? [], att = fichesAcceptees(q, parId);
  const rang = ids.findIndex((x) => att.has(x));
  const avecReponse = q.attendus.length > 0;
  const rang1 = avecReponse && ids.length > 0 && att.has(ids[0]);
  const top3 = avecReponse && rang >= 0 && rang < 3;
  const rr = avecReponse && rang >= 0 ? 1 / (rang + 1) : 0;
  const aJour = q.sorte === 'etat' && q.valeur !== undefined && parId ? q.attendus.some((id) => { const f = parId.get(id); return Boolean(f && plat(`${f.texte} ${f.sujet}`).includes(plat(q.valeur!))); }) : null;
  if (r.texte !== undefined && parId && fiches) {
    const juste = jugerTexte(q, r.texte, fiches, parId);
    return { avecReponse, rang1, top3, rr, fausse: !avecReponse && !juste, aJour, entiere: juste, surTexte: true };
  }
  const fausse = !avecReponse && ids.length > 0;
  const entiere = avecReponse ? rang1 && aJour !== false : ids.length === 0;
  return { avecReponse, rang1, top3, rr, fausse, aJour, entiere, surTexte: false };
}

// ------------------------------------------------------------------------------------------------ relevés
/** `entieresAvec` / `entieresSans` (version 2) : publiés séparément — une question sans réponse se réussit en ne disant rien. */
export interface ReleveSoi { n: number; rang1: Proportion; top3: Proportion; mrr: number; fausses: Proportion; aJour: Proportion; entieres: Proportion; entieresAvec: Proportion; entieresSans: Proportion }
type J = { question: QuestionSoi; j: JugementSoi; ms: number };
export function releveSoi(js: J[]): ReleveSoi {
  const avec = js.filter((x) => x.j.avecReponse), sans = js.filter((x) => !x.j.avecReponse), et = js.filter((x) => x.j.aJour !== null);
  return {
    n: js.length,
    entieresAvec: wilson(avec.filter((x) => x.j.entiere).length, avec.length), entieresSans: wilson(sans.filter((x) => x.j.entiere).length, sans.length),
    rang1: wilson(avec.filter((x) => x.j.rang1).length, avec.length), top3: wilson(avec.filter((x) => x.j.top3).length, avec.length),
    mrr: avec.length ? avec.reduce((s, x) => s + x.j.rr, 0) / avec.length : 0,
    fausses: wilson(sans.filter((x) => x.j.fausse).length, sans.length),
    aJour: wilson(et.filter((x) => x.j.aJour).length, et.length),
    entieres: wilson(js.filter((x) => x.j.entiere).length, js.length),
  };
}
function grouper(js: J[], cle: (q: QuestionSoi) => string): Record<string, ReleveSoi> {
  const g = new Map<string, J[]>();
  for (const x of js) { const k = cle(x.question); if (!g.has(k)) g.set(k, []); g.get(k)!.push(x); }
  return Object.fromEntries([...g.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, releveSoi(v)]));
}
export interface RapportSoi {
  global: ReleveSoi; parFamille: Record<string, ReleveSoi>; parSorte: Record<string, ReleveSoi>; parLangue: Record<string, ReleveSoi>; parEcriture: Record<string, ReleveSoi>;
  francais: ReleveSoi; autres: ReleveSoi; moyenneLangues: number; pireLangue: { langue: string; p: number; n: number } | null;
  temps: { mediane: number; p95: number; max: number };
}
export function rapportSoi(rs: ResultatSoi[], parId?: Map<string, Fiche>, fiches?: Fiche[]): RapportSoi {
  const js: J[] = rs.map((x) => ({ question: x.question, j: jugerSoi(x.question, x.reponse, parId, fiches), ms: x.ms }));
  const parLangue = grouper(js, (q) => q.langue || '?');
  const ls = Object.entries(parLangue);
  let pire: RapportSoi['pireLangue'] = null;
  for (const [langue, r] of ls) if (!pire || r.entieres.p < pire.p) pire = { langue, p: r.entieres.p, n: r.n };
  const ms = rs.map((x) => x.ms);
  return {
    global: releveSoi(js), parFamille: grouper(js, (q) => q.famille), parSorte: grouper(js, (q) => q.sorte), parLangue, parEcriture: grouper(js, (q) => q.ecriture || '?'),
    francais: releveSoi(js.filter((x) => x.question.langue === 'fr')), autres: releveSoi(js.filter((x) => x.question.langue !== 'fr')),
    moyenneLangues: ls.length ? ls.reduce((s, [, r]) => s + r.entieres.p, 0) / ls.length : 0, pireLangue: pire,
    temps: { mediane: centile(ms, 0.5), p95: centile(ms, 0.95), max: ms.length ? Math.max(...ms) : 0 },
  };
}

// ------------------------------------------------------------------------------------------------ contrôle d'un jeu
/** Défauts d'un jeu (liste vide si tout va bien). Avec `fiches` : chaque fiche attendue doit exister. */
export function defautsJeuSoi(j: unknown, fiches?: Map<string, Fiche>): string[] {
  const out: string[] = [];
  const o = j as JeuSoi;
  if (!o || typeof o !== 'object' || !Array.isArray(o.questions)) return ['le jeu n\'a pas de liste « questions »'];
  if (typeof o.maintenant !== 'string' || Number.isNaN(new Date(o.maintenant).getTime())) out.push('« maintenant » manque ou est illisible');
  if (!o.preparation || typeof o.preparation !== 'object') out.push('« preparation » manque');
  const ids = new Set<string>(), phrases = new Set<string>();
  o.questions.forEach((q, i) => {
    const ou = `question ${i} (${q?.id ?? 'sans id'})`;
    if (!q || typeof q !== 'object') { out.push(`${ou} : pas un objet`); return; }
    if (typeof q.id !== 'string' || !q.id) out.push(`${ou} : id manquant`); else if (ids.has(q.id)) out.push(`${ou} : id en double`); else ids.add(q.id);
    if (typeof q.question !== 'string' || !q.question.trim()) out.push(`${ou} : question vide`);
    else { const p = plat(q.question); if (phrases.has(p)) out.push(`${ou} : question en double`); phrases.add(p); }
    if (typeof q.langue !== 'string' || !q.langue) out.push(`${ou} : langue manquante`);
    if (typeof q.ecriture !== 'string' || !q.ecriture) out.push(`${ou} : écriture manquante`);
    if (typeof q.aRelire !== 'boolean') out.push(`${ou} : aRelire manquant`);
    if (!(FAMILLES_Q as readonly string[]).includes(q.famille)) out.push(`${ou} : famille inconnue « ${q.famille} »`);
    if (!(SORTES_Q as readonly string[]).includes(q.sorte)) out.push(`${ou} : sorte inconnue « ${q.sorte} »`);
    if (!Array.isArray(q.attendus)) { out.push(`${ou} : attendus n'est pas une liste`); return; }
    if (q.sorte === 'sans-reponse' && (q.attendus.length || q.famille !== 'aucune')) out.push(`${ou} : sans réponse, mais des fiches attendues ou une famille`);
    if (q.sorte !== 'sans-reponse' && !q.attendus.length) out.push(`${ou} : aucune fiche attendue`);
    if (q.sorte === 'etat' && (typeof q.valeur !== 'string' || !q.valeur)) out.push(`${ou} : question d'état sans valeur`);
    if (fiches) {
      for (const a of q.attendus) if (!fiches.has(a)) out.push(`${ou} : fiche inconnue « ${a} »`);
      // La famille d'une question est celle de sa PREMIÈRE fiche attendue (les autres peuvent être d'une autre famille).
      const f0 = q.attendus.length ? fiches.get(q.attendus[0]) : undefined;
      if (f0 && f0.famille !== q.famille) out.push(`${ou} : première fiche « ${q.attendus[0]} » de la famille ${f0.famille}, question ${q.famille}`);
    }
  });
  return out;
}
export function comptesSoi(j: JeuSoi): Record<string, unknown> {
  const par = <T>(l: T[], f: (x: T) => string) => Object.fromEntries(Object.entries(l.reduce<Record<string, number>>((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    questions: j.questions.length, aRelire: j.questions.filter((q) => q.aRelire).length,
    parFamille: par(j.questions, (q) => q.famille), parSorte: par(j.questions, (q) => q.sorte), parLangue: par(j.questions, (q) => q.langue), parEcriture: par(j.questions, (q) => q.ecriture),
    fichesVisees: new Set(j.questions.flatMap((q) => q.attendus)).size,
    francais: j.questions.filter((q) => q.langue === 'fr').length, langues: new Set(j.questions.map((q) => q.langue)).size,
  };
}

// ------------------------------------------------------------------------------------------------ l'Odin jetable préparé
const RACINE = new URL('../../', import.meta.url);
const fichierDuDepot = (p: string) => new URL(p, RACINE);
export interface OdinPrepare { sources: SourcesSoi; fiches: Fiche[]; muninn: import('../../src/muninn/store.ts').Mnemosyne; inventory: import('../../src/hlidskjalf/inventory.ts').Inventory; mods: Array<import('../../src/valhalla/types.ts').Module>; fin(): void }
/**
 * Prépare un Odin jetable dans `home` (l'environnement du banc doit déjà pointer dessus) selon la préparation du jeu, lit
 * ses vraies structures avec les fonctions du produit (config, inventaire, Mathésis, nousEtat, modules, ui.html…) et
 * fabrique les fiches. Rien n'est lancé, rien ne sort sur le réseau.
 */
export async function preparerOdin(home: string, p: Preparation, maintenant: number): Promise<OdinPrepare> {
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const os = await import('node:os');
  const { odinPaths, loadConfig } = await import('../../src/config.ts');
  const { envFile } = await import('../../src/settings.ts');
  const paths = odinPaths(home);
  mkdirSync(home, { recursive: true });
  if (p.config) writeFileSync(paths.config, JSON.stringify(p.config, null, 1));
  const cfg = loadConfig(paths);
  // Les applis du produit.
  const { modulesDuProduit } = await import('./catalogue.ts');
  const mods = await modulesDuProduit(home);
  // La mémoire et l'inventaire, dans le dossier jetable.
  const { Mnemosyne } = await import('../../src/muninn/store.ts');
  const { Inventory } = await import('../../src/hlidskjalf/inventory.ts');
  const muninn = new Mnemosyne(join(home, 'odin.db'));
  const inventory = new Inventory(muninn as never);
  const reseau = '198.51.100.0/24';
  if (p.appareils?.length) {
    const found = (l: NonNullable<Preparation['appareils']>) => l.map((a) => ({ ip: a.ip, mac: a.mac, name: a.nom, hostname: '', ports: [], services: [], network: reseau }));
    inventory.applyScan(found(p.appareils) as never, [reseau], maintenant - 3_600_000, 7, false);
    const off = new Set(p.deconnectes ?? []);
    if (off.size) inventory.applyScan(found(p.appareils.filter((a) => !off.has(a.ip))) as never, [reseau], maintenant - 60_000, 7, false);
    for (const a of p.appareils) if (a.nom) { const d = inventory.list({ status: 'all' }).find((x) => x.ip === a.ip); if (d) inventory.setLabel(d.id, a.nom); }
  }
  for (const s of p.souvenirs ?? []) muninn.remember(s, 'owner', 'fact', '', { source: 'banc soi' } as never);
  // Mathésis : son magasin (fichiers chiffrés avec la clé de l'Odin jetable), écrit puis relu par le produit.
  const M = await import('../../src/valhalla/mathesis/index.ts');
  const mag = new M.MagasinFichiers(M.dirMathesis(home), home);
  mag.ecrire('reglages', M.normaliserReglages(p.mathesis?.reglages ?? {}));
  mag.ecrire('journal', (p.mathesis?.journal ?? []).map((e) => ({ ...e, at: new Date(e.at).getTime() })));
  mag.ecrire('absorber', Object.fromEntries((p.mathesis?.sites ?? []).map((s) => [s.id, { ...s, ajoute: s.ajoute ? new Date(s.ajoute).getTime() : maintenant, par: 'page', plans: [], fils: [], fraicheurs: {}, file: [], connues: s.connues ?? 0, lues: s.lues ?? 0, refusees: 0, erreurs: 0, faits: 0, decouvert: s.etat !== 'a-explorer' }])));
  const lu = new M.MagasinFichiers(M.dirMathesis(home), home);
  const reglages = M.normaliserReglages(lu.lire('reglages', M.reglagesParDefaut()));
  const journal = lu.lire<Array<{ id: string; at: number; genre: string; quoi: string }>>('journal', []);
  const sites = Object.values(lu.lire<Record<string, { id: string; racine: string; etat: string; lues?: number; connues?: number; ajoute?: number; absorbeLe?: number }>>('absorber', {}));
  // Noûs : l'état tel que la page le montre.
  const { nousEtat, oublierCacheNous } = await import('../../src/web/nous-api.ts');
  oublierCacheNous();
  const nous = nousEtat({ cfg, paths } as never);
  const { hyperDe } = await import('../../src/brain/nous/tailles.ts');
  const tailles = (['petit', 'moyen', 'grand'] as const).map((t) => hyperDe(t));
  const { DEFAULT_DIRECT, } = await import('../../src/valhalla/ports.ts');
  const { directFile } = await import('../../src/valhalla/directports.ts');
  const { fichierCorrections } = await import('../../src/brain/nous/aiguilleur.ts');
  const F = await import('../../src/brain/nous/connaissance-de-soi.ts');
  const ui = F.lireInterface(readFileSync(fichierDuDepot('src/web/ui.html'), 'utf8'));
  const volets = F.lireVoletsCerveau(readFileSync(fichierDuDepot('src/web/brain.js'), 'utf8'));
  const etat = JSON.parse(readFileSync(fichierDuDepot('docs/etat.json'), 'utf8')) as SourcesSoi['etat'];
  const m = p.machine ?? { systeme: os.type(), architecture: os.arch(), coeurs: os.cpus().length, memoireGo: Math.round(os.totalmem() / 1073741824), node: process.versions.node };
  const sources: SourcesSoi = {
    interface: ui, voletsCerveau: volets,
    applis: mods.map((x) => ({ id: x.id, name: x.name, family: String(x.family), what: String(x.what ?? ''), does: [...(x.does ?? [])], modes: [...(x.modes ?? [])], actions: x.actions.map((a) => ({ id: a.id, label: a.label, what: String(a.what ?? ''), read: Boolean(a.read) })) })),
    ports: DEFAULT_DIRECT, machine: m,
    config: {
      web: { port: cfg.web.port, access: cfg.web.access, tls: cfg.web.tls?.enabled, enabled: cfg.web.enabled },
      http: { enabled: Boolean(cfg.channels?.http?.enabled), port: Number(cfg.channels?.http?.port ?? 0) },
      autoBackup: { enabled: cfg.autoBackup.enabled, hour: cfg.autoBackup.hour, keep: cfg.autoBackup.keep, dir: cfg.autoBackup.dir ? 'oui' : '' },
      watch: { ...cfg.watch }, services: cfg.services.map((s) => ({ id: s.id, name: s.name, where: s.where, auto: s.auto })),
    },
    dossiers: F.dossiersDe(home, { home, config: paths.config, persona: paths.persona, db: paths.db, skills: paths.skills, drafts: paths.drafts, workspace: paths.workspace, logs: paths.logs, env: envFile(paths), mathesis: M.dirMathesis(home), soul: dirname(fichierCorrections(home)), ports: directFile(home) }),
    // Version 2 (M10) : « important » vient du PRODUIT (la surveillance, cfg.watch.devices : id, adresse, nom ou MAC),
    // plus de la préparation du jeu — l'inventaire et la surveillance disent la même chose.
    appareils: inventory.list({ status: 'all' }).map((d) => ({ id: d.id, ip: d.ip, nom: d.label || d.name, genre: d.kind, etat: d.status, important: (cfg.watch.devices ?? []).some((x) => [String(d.id), d.ip, d.label, d.name, d.mac].some((v) => v && String(v).toLowerCase() === x.toLowerCase())) })),
    nous, tailles, tailleChoisie: undefined,
    mathesis: { reglages: reglages as unknown as Record<string, unknown>, journal, sites },
    etat, memoire: { souvenirs: muninn.listMemories(1e9).length }, maintenant,
  };
  const fiches = F.fabriquerFiches(sources);
  return { sources, fiches, muninn, inventory, mods, fin: () => { try { muninn.close(); } catch { /* rien */ } } };
}

// ------------------------------------------------------------------------------------------------ les méthodes
export interface MethodeSoi { nom: string; description: string; repondre(question: string): Promise<ReponseSoi> | ReponseSoi }

/** Découpe en jetons : mots (lettres et chiffres, sans accents), et paires de caractères pour le chinois et le japonais. */
export function jetons(t: string): string[] {
  const out: string[] = [];
  for (const m of plat(t).matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w)) { const c = [...w]; for (let i = 0; i < c.length; i++) out.push(i + 1 < c.length ? c[i] + c[i + 1] : c[i]); }
    else if (w.length >= 2) out.push(w.length > 5 ? w.slice(0, 5) : w); // une racine grossière : les 5 premières lettres
  }
  return out;
}
const texteFiche = (f: Fiche) => `${f.sujet} ${f.cles.join(' ')} ${f.ou ? `${f.ou.page} ${f.ou.onglet ?? ''} ${f.ou.reglage ?? ''}` : ''} ${f.texte}`;

/** « mots » : BM25 sur les jetons des fiches. Sous le seuil (fixé ici, jamais réglé sur un jeu figé) : « je ne sais pas ». */
export const SEUIL_MOTS = 6;
export function methodeMots(fiches: Fiche[], o: { seuil?: number; n?: number } = {}): MethodeSoi {
  const docs = fiches.map((f) => jetons(texteFiche(f)));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length, moy = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  const tfs = docs.map((d) => { const m = new Map<string, number>(); for (const w of d) m.set(w, (m.get(w) ?? 0) + 1); return m; });
  const seuil = o.seuil ?? SEUIL_MOTS, n = o.n ?? 5;
  return {
    nom: 'mots', description: `BM25 sur les jetons des fiches fabriquées (k1 1,2 ; b 0,75 ; « je ne sais pas » sous ${seuil})`,
    repondre(question) {
      const q = [...new Set(jetons(question))];
      const sc = tfs.map((tf, i) => {
        let s = 0;
        for (const w of q) { const f = tf.get(w); if (!f) continue; const idf = Math.log(1 + (N - df.get(w)! + 0.5) / (df.get(w)! + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * docs[i].length / moy)); }
        return s;
      });
      const ordre = sc.map((s, i) => [s, i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || (fiches[a[1]].id < fiches[b[1]].id ? -1 : 1));
      if (!ordre.length || ordre[0][0] < seuil) return { ids: [], detail: ordre.length ? `meilleur score ${ordre[0][0].toFixed(2)}` : 'aucun mot commun' };
      return { ids: ordre.slice(0, n).map(([, i]) => fiches[i].id) };
    },
  };
}

/** « ngrammes » : l'index de n-grammes de caractères de l'aiguilleur (IndexNgrammes de src/brain/nous/aiguilleur.ts, non modifié), une paire par fiche. */
export const SEUIL_NGRAMMES = 0.12;
export async function methodeNgrammes(fiches: Fiche[], o: { seuil?: number; n?: number } = {}): Promise<MethodeSoi> {
  const A = await import('../../src/brain/nous/aiguilleur.ts');
  const ix = new A.IndexNgrammes(fiches.map((f) => ({ texte: texteFiche(f).slice(0, 600), appli: f.id, action: null, source: 'fiche' })), { ...A.REGLAGES, idfAppli: 0 });
  const seuil = o.seuil ?? SEUIL_NGRAMMES, n = o.n ?? 5;
  return {
    nom: 'ngrammes', description: `index n-grammes TF-IDF de l'aiguilleur (1 à 4 caractères, sans IDF par appli), cosinus ; « je ne sais pas » sous ${seuil}`,
    repondre(question) {
      const r = ix.ressemblances(question);
      const ordre = r.idx.map((d, k) => [r.sim[k], d] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      if (!ordre.length || ordre[0][0] < seuil) return { ids: [], detail: ordre.length ? `meilleur cosinus ${ordre[0][0].toFixed(3)}` : 'rien' };
      return { ids: ordre.slice(0, n).map(([, d]) => ix.paire(d).appli as string) };
    },
  };
}

/**
 * Les fiches qu'un TEXTE de réponse nomme : une fiche est nommée quand l'une de ses clés (au moins 4 caractères, mot
 * entier, sans accents ni casse) figure dans le texte. Ordre : la plus longue clé trouvée d'abord (la plus précise), puis
 * la première apparition. Règle écrite une fois ici pour juger un produit qui répond en phrases.
 */
/**
 * Version 2 (G3 b) : les clés PROPRES — portées par une seule fiche, et précises : plusieurs mots, ou un chiffre, un
 * point, un @, ou le nom d'une appli, ou un seul mot d'au moins 8 lettres. « Langue », « Adresse », « Pause »,
 * « journal » ne nomment plus une fiche par hasard.
 */
const cachePropres = new WeakMap<Fiche[], Set<string>>();
export function clesPropres(fiches: Fiche[]): Set<string> {
  const deja = cachePropres.get(fiches); if (deja) return deja;
  const n = new Map<string, number>();
  for (const f of fiches) for (const c of new Set(f.cles.map((x) => mots(x).trim()))) n.set(c, (n.get(c) ?? 0) + 1);
  const noms = new Set(fiches.filter((f) => f.id.startsWith('interface:appli:')).map((f) => mots(f.cles[0] ?? '').trim()));
  const out = new Set<string>();
  for (const f of fiches) for (const c of f.cles) {
    const k = mots(c).trim();
    if (k.length < 4 || (n.get(k) ?? 0) > 1) continue;
    // Le nom propre d'une fiche du modèle, de l'acquisition ou de l'infrastructure (« Soul », « Brain », « Lyncée ») compte
    // aussi ; pas le libellé d'un réglage ou d'une action de l'interface (« Langue », « Pause »).
    const nomPropre = f.famille !== 'interface' && c === f.cles[0];
    if (k.includes(' ') || /[\d.@]/.test(c) || noms.has(k) || k.length >= 8 || nomPropre) out.add(c);
  }
  cachePropres.set(fiches, out);
  return out;
}
export function fichesNommees(texte: string, fiches: Fiche[], n = 5): string[] {
  const t = ` ${plat(texte).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const propres = clesPropres(fiches);
  const vus: Array<{ id: string; long: number; pos: number }> = [];
  for (const f of fiches) {
    let best: { long: number; pos: number } | undefined;
    for (const c of f.cles) {
      if (!propres.has(c)) continue;
      const k = plat(c).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (k.length < 4) continue;
      const pos = t.indexOf(` ${k} `);
      if (pos >= 0 && (!best || k.length > best.long || (k.length === best.long && pos < best.pos))) best = { long: k.length, pos };
    }
    if (best) vus.push({ id: f.id, ...best });
  }
  return vus.sort((a, b) => b.long - a.long || a.pos - b.pos || (a.id < b.id ? -1 : 1)).slice(0, n).map((x) => x.id);
}

/**
 * « produit » : ce qu'Odin répond AUJOURD'HUI sans modèle, appelé tel quel : la compréhension sans IA (understand de
 * src/valhalla/huginn.ts) ; si elle ne dit rien d'utile (pas comprise, hésitation), le cerveau de secours (offlineAnswer
 * de src/core/offline.ts, avec la mémoire et l'inventaire de l'Odin préparé). Une ACTION choisie n'est pas une réponse
 * à une question sur Odin : elle est rendue comme le texte « appli … action … » (elle nomme au mieux la fiche de l'appli
 * ou de l'action). Le texte est ensuite lu par fichesNommees.
 */
export async function methodeProduit(o: OdinPrepare, home: string, maintenant: Date): Promise<MethodeSoi & { fin(): void }> {
  const { Valhalla } = await import('../../src/valhalla/service.ts');
  const { understand, forgetPending } = await import('../../src/valhalla/huginn.ts');
  const { offlineAnswer } = await import('../../src/core/offline.ts');
  const { couperSorties, lectureSure } = await import('./taches.ts');
  await couperSorties();
  const v = new Valhalla(home, o.mods, {
    run: async () => ({ code: 1, out: '', err: 'banc : rien n\'est lancé' }),
    fetch: (async () => { throw new Error('banc : réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => maintenant,
  } as never);
  let tour = 0;
  return {
    nom: 'produit', description: 'chemin sans modèle du produit : understand (huginn), puis offlineAnswer (cerveau de secours) ; fiches nommées dans le texte rendu',
    async repondre(question) {
      const session = `soi-${++tour}`;
      let texte = '', detail = '';
      try {
        const u = await understand(v, question, session, maintenant);
        if (u?.kind === 'say' && !u.unsure) { texte = u.text; detail = 'huginn : dit'; }
        else if (u?.kind === 'action' && lectureSure(u.module, u.action, u.read)) {
          // Version 2 (G3 a) : une LECTURE choisie est lancée comme Odin la lancerait (liste blanche du banc des tâches :
          // elle ne lit que l'Odin préparé ; sorties coupées), et c'est sa réponse qui est jugée.
          const r = await (v as unknown as { act(m: string, a: string, i: Record<string, unknown>): Promise<{ text: string }> }).act(u.module, u.action, u.input ?? {});
          texte = r.text; detail = `huginn : lecture ${u.module}.${u.action} lancée`;
        }
        else if (u?.kind === 'action' || u?.kind === 'ask') { const m = v.module(u.module); const a = m?.actions.find((x) => x.id === u.action); texte = `appli ${m?.name ?? u.module} action ${a?.label ?? u.action}`; detail = `huginn : ${u.kind} ${u.module}.${u.action}${u.kind === 'action' ? ' (non lancée : elle change quelque chose, ou lit hors de l\'Odin préparé)' : ''}`; }
        else {
          const off = offlineAnswer({ muninn: o.muninn, home, inventory: o.inventory as never }, question, { channel: 'banc', peer: 'banc' }, maintenant);
          texte = off.text; detail = `secours${off.handled ? ' (compris)' : ' (pas compris)'}${u?.kind === 'say' ? ' ; huginn hésitait' : ''}`;
        }
      } finally { forgetPending(session); }
      return { ids: fichesNommees(texte, o.fiches), texte, detail: `${detail} : ${texte.slice(0, 160).replace(/\s+/g, ' ')}` };
    },
    fin: () => { try { v.stop(); } catch { /* rien de lancé */ } },
  };
}

// ------------------------------------------------------------------------------------------------ la commande
const pc = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1).replace('.', ',')} %`;
export const propS = (p?: Proportion) => (p && p.n ? `${p.k}/${p.n} = ${pc(p.p)} [${pc(p.bas)} ; ${(Math.ceil(p.haut * 1000) / 10).toFixed(1).replace('.', ',')} %]` : '—');
const ENTETE = '| groupe | n | avec réponse : juste | sans réponse : rien d\'inventé | les deux | 1er rang | 3 premiers | rang réciproque moyen | fausses réponses (rien à dire) | fiche à jour (état) |\n|---|---:|---|---|---|---|---|---:|---|---|';
const ligne = (k: string, r: ReleveSoi) => `| ${k} | ${r.n} | ${propS(r.entieresAvec)} | ${propS(r.entieresSans)} | ${propS(r.entieres)} | ${propS(r.rang1)} | ${propS(r.top3)} | ${r.mrr.toFixed(3).replace('.', ',')} | ${propS(r.fausses)} | ${propS(r.aJour)} |`;
export function markdownSoi(jeu: string, methode: string, description: string, r: RapportSoi, fige: boolean, fiches: Record<string, number>): string {
  const g = r.global;
  return [
    `# Banc « connaissance de soi » : ${methode} sur ${jeu}`, '',
    `${description}. Jeu ${fige ? 'FIGÉ (aucune question écrite ici)' : 'de développement'} ; ${g.n} questions ; fiches fabriquées sur l'Odin jetable du jeu : ${Object.entries(fiches).map(([k, v]) => `${k} ${v}`).join(', ')}. Intervalles de Wilson à 95 %.`, '',
    '## En tête', '',
    `- Questions AVEC réponse, réponse juste${methode === 'produit' ? ' (jugée sur le texte rendu : la valeur ou le lieu)' : ' (bonne fiche au premier rang ; une fiche qui dit la même réponse compte aussi)'} : ${propS(g.entieresAvec)}.`,
    `- Questions SANS réponse, rien d'inventé : ${propS(g.entieresSans)}.`,
    `- Les deux ensemble : ${propS(g.entieres)}.`,
    `- Bonne fiche au premier rang : ${propS(g.rang1)} ; dans les trois premières : ${propS(g.top3)} ; rang réciproque moyen ${g.mrr.toFixed(3).replace('.', ',')}.`,
    `- Fausses réponses quand il n'y a rien à dire (plus petit = mieux) : ${propS(g.fausses)}.`,
    `- Fiche à jour pour les questions d'état (contrôle de la fabrique) : ${propS(g.aJour)}.`,
    `- Français : ${propS(r.francais.entieres)} ; autres langues : ${propS(r.autres.entieres)} ; moyenne des langues ${pc(r.moyenneLangues)} ; la pire : ${r.pireLangue ? `${r.pireLangue.langue} ${pc(r.pireLangue.p)} sur ${r.pireLangue.n}` : '—'}.`,
    `- Temps par question : médiane ${r.temps.mediane.toFixed(2)} ms, 95e centile ${r.temps.p95.toFixed(2)} ms, maximum ${r.temps.max.toFixed(2)} ms.`, '',
    '## Par famille', '', ENTETE, ...Object.entries(r.parFamille).map(([k, x]) => ligne(k, x)), '',
    '## Par sorte', '', ENTETE, ...Object.entries(r.parSorte).map(([k, x]) => ligne(k, x)), '',
    '## Par langue', '', ENTETE, ...Object.entries(r.parLangue).map(([k, x]) => ligne(k, x)), '',
    '## Par écriture', '', ENTETE, ...Object.entries(r.parEcriture).map(([k, x]) => ligne(k, x)), '',
  ].join('\n');
}

async function principal(): Promise<void> {
  const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { basename, resolve } = await import('node:path');
  const { performance } = await import('node:perf_hooks');
  const args = process.argv.slice(2);
  const tous = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
  const jeux = tous('jeu'), sortie = tous('sortie')[0], seuil = Number(tous('seuil')[0] ?? '0.8');
  const noms = (tous('methodes')[0] ?? 'produit,mots,ngrammes').split(',').map((x) => x.trim()).filter(Boolean);
  if (!jeux.length || !sortie) { console.error('usage : soi.ts --jeu <fichier.json> [--jeu …] --sortie <dossier> [--methodes produit,mots,ngrammes] [--seuil 0.8]'); process.exitCode = 2; return; }
  const { dossierJetable, environnementBanc, modulesDuProduit } = await import('./catalogue.ts');
  const { home, fin } = dossierJetable('odin-soul-soi-');
  environnementBanc(home);
  mkdirSync(sortie, { recursive: true });
  try {
    const lus = jeux.map((f) => { const j = JSON.parse(readFileSync(f, 'utf8')) as JeuSoi; const nom = basename(f).replace(/\.json$/i, ''); return { nom, j, fige: j.fige === true || nom.includes('principal') }; });
    // Fuites : contre la matière d'apprentissage, les autres jeux du banc, et entre ces jeux (comme les autres bancs).
    const F = await import('./fuites.ts');
    const { textesDesJeux } = await import('./logique.ts');
    const mods0 = await modulesDuProduit(home);
    const { sources } = await F.sourcesApprentissage(mods0);
    const index = new F.Index([...sources, ...(await textesDesJeux(lus.map((x) => x.nom)))]);
    const textes = (j: JeuSoi) => j.questions.map((q) => ({ id: q.id, phrase: q.question })) as never;
    for (const x of lus) {
      const contre = F.fuitesContre(textes(x.j), index, seuil), internes = F.doublonsInternes(textes(x.j), seuil);
      const entre = lus.filter((y) => y !== x).map((y) => ({ jeu: y.nom, fuites: F.fuitesContre(textes(x.j), new F.Index(y.j.questions.map((q) => ({ texte: q.question, source: `${y.nom}#${q.id}` }))), seuil) }));
      const masquer = (l: ReturnType<typeof F.fuitesContre>) => (x.fige ? l.map(({ phrase: _p, texteSource: _t, ...r }) => r) : l);
      writeFileSync(resolve(sortie, `fuites-${x.nom}.json`), JSON.stringify({ seuil, sources: index.taille, contreApprentissageEtJeux: masquer(contre), internes: masquer(internes), entreJeux: entre.map((e) => ({ jeu: e.jeu, fuites: masquer(e.fuites) })) }, null, 1));
      writeFileSync(resolve(sortie, `comptes-${x.nom}.json`), JSON.stringify(comptesSoi(x.j), null, 1));
      console.log(`${x.nom} : ${x.j.questions.length} questions ; fuites contre l'apprentissage et les autres jeux ${contre.length}, internes ${internes.length}, ${entre.map((e) => `contre ${e.jeu} ${e.fuites.length}`).join(', ')}`);
    }
    for (const x of lus) {
      const sous = mkdtempSync(resolve(home, `jeu-${x.nom}-`));
      process.env.ODIN_HOME = sous;
      const maintenant = new Date(x.j.maintenant);
      const o = await preparerOdin(sous, x.j.preparation ?? {}, maintenant.getTime());
      const parId = new Map(o.fiches.map((f) => [f.id, f]));
      const { comptesFiches } = await import('../../src/brain/nous/connaissance-de-soi.ts');
      const cf = comptesFiches(o.fiches);
      writeFileSync(resolve(sortie, `fiches-${x.nom}.json`), JSON.stringify({ comptes: cf, total: o.fiches.length, fiches: o.fiches }, null, 1));
      const defauts = defautsJeuSoi(x.j, parId);
      writeFileSync(resolve(sortie, `defauts-${x.nom}.json`), JSON.stringify(defauts, null, 1));
      console.log(`${x.nom} : ${o.fiches.length} fiches (${Object.entries(cf).map(([k, v]) => `${k} ${v}`).join(', ')}) ; ${defauts.length} défaut(s)`);
      for (const d of defauts.slice(0, 30)) console.log(`  défaut : ${d}`);
      const meths: Array<MethodeSoi & { fin?(): void }> = [];
      for (const n of noms) {
        if (n === 'produit') meths.push(await methodeProduit(o, sous, maintenant));
        else if (n === 'mots') meths.push(methodeMots(o.fiches));
        else if (n === 'ngrammes') meths.push(await methodeNgrammes(o.fiches));
        else console.log(`méthode inconnue : ${n} (connues : produit, mots, ngrammes)`);
      }
      try {
        for (const meth of meths) {
          const rs: ResultatSoi[] = [];
          for (const q of x.j.questions) {
            const t = performance.now();
            let reponse: ReponseSoi;
            const vrai = Date.now; Date.now = () => maintenant.getTime();
            try { reponse = await meth.repondre(q.question); } catch (e) { reponse = { ids: [], detail: `erreur : ${String((e as Error)?.message ?? e).slice(0, 160)}` }; } finally { Date.now = vrai; }
            rs.push({ question: q, reponse, ms: performance.now() - t });
          }
          const r = rapportSoi(rs, parId, o.fiches);
          writeFileSync(resolve(sortie, `rapport-${x.nom}-${meth.nom}.json`), JSON.stringify({ jeu: x.nom, version: x.j.version, fige: x.fige, methode: meth.nom, description: meth.description, maintenant: x.j.maintenant, quand: new Date().toISOString(), fiches: cf, ...r }, null, 1));
          writeFileSync(resolve(sortie, `tableau-${x.nom}-${meth.nom}.md`), markdownSoi(x.nom, meth.nom, meth.description, r, x.fige, cf));
          const ratees = rs.map((y) => ({ y, j: jugerSoi(y.question, y.reponse, parId, o.fiches) })).filter((z) => !z.j.entiere);
          if (!x.fige) writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}.json`), JSON.stringify(ratees.map(({ y, j }) => ({ id: y.question.id, langue: y.question.langue, famille: y.question.famille, sorte: y.question.sorte, question: y.question.question, attendus: y.question.attendus, rendus: y.reponse.ids.slice(0, 3), detail: y.reponse.detail, jugement: j })), null, 1));
          else writeFileSync(resolve(sortie, `ratees-${x.nom}-${meth.nom}-comptes.json`), JSON.stringify({ ratees: ratees.length, parFamille: ratees.reduce<Record<string, number>>((a, { y }) => { a[y.question.famille] = (a[y.question.famille] ?? 0) + 1; return a; }, {}) }, null, 1));
          console.log(`${meth.nom} sur ${x.nom} : avec réponse ${propS(r.global.entieresAvec)} ; sans réponse ${propS(r.global.entieresSans)} ; les deux ${propS(r.global.entieres)} ; 1er rang ${propS(r.global.rang1)} ; 3 premiers ${propS(r.global.top3)} ; fausses réponses ${propS(r.global.fausses)} ; fiche à jour ${propS(r.global.aJour)} ; médiane ${r.temps.mediane.toFixed(2)} ms`);
        }
      } finally { for (const m of meths) m.fin?.(); o.fin(); }
    }
  } finally { fin(); }
}

if (process.argv[1] && (await import('node:path')).resolve(process.argv[1]) === (await import('node:url')).fileURLToPath(import.meta.url)) {
  await principal();
  process.exit(process.exitCode ?? 0);
}
