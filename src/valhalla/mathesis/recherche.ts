// Mathésis — lot 2 : les recherches autonomes. Pour un manque de la liste de curiosité :
//   1. préparer les questions (sans modèle : le sujet, puis une variante qui vise la source officielle) ;
//   2. chercher avec LE moteur d'Odin (adaptateur `Chercheur`, défaut = webSearch de src/tools/search.ts) ;
//   3. lire les pages par le lecteur poli du robot (jamais ailleurs) ;
//   4. recouper : deux groupes de sources INDÉPENDANTS (assess + clusterSources de src/research/sources.ts : même
//      site, texte repris, même agence = un seul groupe) qui disent la même chose = « confirmé » ; une seule = « à vérifier » ;
//   5. ranger ce qui est retenu par l'ENTRÉE COMMUNE d'apprentissage (src/learn/apprendre-de-tout.ts : source, date,
//      niveau de confiance ; elle nourrit Noûs) — un fait du propriétaire n'est jamais écrasé (la mémoire le garantit).
// Un texte venu d'une page est une DONNÉE : il ne devient jamais une consigne. Les phrases qui ressemblent à des
// ordres adressés à un assistant sont écartées (et notées) ; rien de ce qui est lu ne touche aux réglages.
import type { Apport, ResultatApprentissage } from '../../learn/apprendre-de-tout.ts';
import type { Fait } from '../../learn/apprendre-de-tout.ts';
import type { VerdictBrut } from '../../learn/confiance.ts';
import type { Page } from '../../research/fetch.ts';
import { assess, clusterSources } from '../../research/sources.ts';
import { controlerForme } from './adresses.ts';
import type { Budget } from './budget.ts';
import type { Curiosite } from './curiosite.ts';
import type { Empreintes } from './empreintes.ts';
import { siteInterdit, sujetInterdit } from './interdits.ts';
import type { Journal } from './journal.ts';
import { court, dateCourte, motsUtiles } from './outils.ts';
import { PHRASES_ARRET } from './reglages.ts';
import type { Chercheur, Interdits, Manque, PageLue, RaisonArret, Reglages } from './types.ts';

/** Une phrase qui s'adresse à un assistant comme un ordre : jamais retenue comme un fait. Pur. */
export const CONSIGNE = /(ignore[rz]?|oublie[rz]?|ne tiens? (plus )?compte|disregard|forget)\b[^.]{0,60}\b(instructions?|consignes?|r[èe]gles?|prompts?|rules?)|system prompt|invite syst[èe]me|tu dois (maintenant|d[ée]sormais)|you must now|from now on,? you|en tant qu'(ia|assistant)|as an (ai|assistant)|d[ée]sactive[rz]? (l'interrupteur|les? (limites?|budgets?|consignes?))|ajoute[rz]? .{0,40} (aux|en) (interdits|priorit[ée])|<\s*script/i;

export interface FaitRecoupe { texte: string; verdict: VerdictBrut; sources: string[]; sites: string[] }

/** Les questions préparées pour un manque (sans modèle). Pur. */
export function preparerQuestions(m: Pick<Manque, 'sujet'>, max = 2): string[] {
  const s = m.sujet.replace(/\s+/g, ' ').trim();
  const q = [s, `${s.replace(/\?+$/, '')} source officielle`];
  return [...new Set(q)].slice(0, Math.max(1, max));
}

/** Les phrases d'un texte qui parlent du sujet (et ne sont pas des consignes). Pur. */
export function phrasesPertinentes(texte: string, mots: string[], max = 8): { gardees: string[]; consignes: string[] } {
  const gardees: string[] = [], consignes: string[] = [];
  if (!mots.length) return { gardees, consignes };
  const besoin = mots.length >= 3 ? Math.ceil(mots.length / 2) : mots.length;
  for (const brute of String(texte ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const p = brute.replace(/^[-#*\s]+/, '').replace(/\s+/g, ' ').trim();
    if (p.length < 30 || p.length > 400) continue;
    const ici = new Set(motsUtiles(p));
    const n = mots.filter((m) => ici.has(m)).length;
    if (n < besoin) continue;
    if (CONSIGNE.test(p)) { consignes.push(p); continue; }
    gardees.push(p);
    if (gardees.length >= max) break;
  }
  return { gardees, consignes };
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let c = 0; for (const x of a) if (b.has(x)) c++;
  return c / (a.size + b.size - c);
};

/** Une page lue, vue comme une page de la recherche fiable (pour réutiliser assess et clusterSources). */
function versPage(p: PageLue, accede: number): Page {
  return {
    url: p.url, finalUrl: p.urlFinale, status: 200, kind: 'html', title: p.titre, text: p.texte,
    ...(p.publie ? { published: p.publie } : {}), links: p.liens.map((l) => l.url), accessed: new Date(accede).toISOString(), via: 'http',
  };
}

/**
 * Recoupe les pages : regroupe les phrases qui disent la même chose (mêmes mots porteurs), compte les groupes de
 * sources INDÉPENDANTS derrière chaque affirmation. ≥ 2 = « confirmé », 1 = « probable » (→ « à vérifier »). Pur.
 */
export function recouper(pages: PageLue[], sujet: string, maintenant: number, o: { seuil?: number; max?: number } = {}): { faits: FaitRecoupe[]; consignes: Array<{ texte: string; source: string }> } {
  const mots = motsUtiles(sujet);
  const evalues = clusterSources(pages.map((p, i) => assess(versPage(p, maintenant), i + 1, maintenant)));
  const groupes: Array<{ rep: string; mots: Set<string>; clusters: Set<number>; sources: Set<string>; sites: Set<string>; score: number }> = [];
  const consignes: Array<{ texte: string; source: string }> = [];
  pages.forEach((p, i) => {
    const a = evalues[i];
    const { gardees, consignes: c } = phrasesPertinentes(p.texte, mots);
    for (const x of c) consignes.push({ texte: x, source: p.urlFinale });
    for (const ph of gardees) {
      const ms = new Set(motsUtiles(ph));
      const g = groupes.find((x) => jaccard(x.mots, ms) >= (o.seuil ?? 0.5));
      if (g) { g.clusters.add(a.cluster); g.sources.add(p.urlFinale); g.sites.add(p.site); g.score = Math.max(g.score, a.score); }
      else groupes.push({ rep: ph, mots: ms, clusters: new Set([a.cluster]), sources: new Set([p.urlFinale]), sites: new Set([p.site]), score: a.score });
    }
  });
  const faits = groupes
    .sort((x, y) => y.clusters.size - x.clusters.size || y.score - x.score)
    .slice(0, o.max ?? 5)
    .map((g) => ({
      texte: g.rep,
      verdict: { verdict: g.clusters.size >= 2 ? 'confirmé' : 'probable', independent: g.clusters.size } as VerdictBrut,
      sources: [...g.sources], sites: [...g.sites],
    }));
  return { faits, consignes };
}

/** Ce dont la recherche autonome a besoin (tout est injecté). */
export interface DepsRecherche {
  chercher: Chercheur;
  /** Obtenir les pages (le robot : lecture polie et suite des liens pertinents). */
  obtenirPages: (m: Manque, graines: string[], signal?: AbortSignal) => Promise<{ pages: PageLue[]; arret?: RaisonArret }>;
  /** L'entrée commune d'apprentissage (apprendreDeTout liée à la mémoire et à Noûs). */
  apprendre: (a: Apport) => ResultatApprentissage;
  budget: Budget;
  journal: Journal;
  empreintes: Empreintes;
  curiosite: Curiosite;
  reglages: () => Reglages;
  interdits: () => Interdits;
  garde: () => RaisonArret | undefined;
  maintenant: () => number;
}

export interface BilanManque {
  manque: string;
  questions: string[];
  pagesLues: number;
  faits: Array<{ texte: string; niveau: string; sources: string[] }>;
  ecartes: string[];
  arret?: RaisonArret;
}

const niveauDe = (v: VerdictBrut): string => (v.verdict === 'confirmé' ? 'confirmé' : 'à vérifier');

/** Range des pages lues pour un manque : recoupement, apprentissage, journal. Rend les faits rangés. */
export function rangerPages(d: DepsRecherche, m: Manque, pages: PageLue[]): Pick<BilanManque, 'faits' | 'ecartes'> {
  const ecartes: string[] = [];
  const neuves: PageLue[] = [];
  for (const p of pages) {
    if (p.noindex) { ecartes.push(`${p.urlFinale} : la page demande à ne pas être indexée`); continue; }
    if (siteInterdit(d.interdits(), p.urlFinale)) { ecartes.push(`${p.urlFinale} : site interdit`); continue; }
    if (d.empreintes.dejaAnalyse(p.empreinte)) { ecartes.push(`${p.urlFinale} : déjà analysée (même contenu)`); continue; }
    neuves.push(p);
  }
  const now = d.maintenant();
  const { faits, consignes } = recouper(neuves, m.sujet, now);
  for (const c of consignes) ecartes.push(`phrase écartée (ressemble à une consigne) : « ${court(c.texte, 120)} » — ${c.source}`);
  const gardes: BilanManque['faits'] = [];
  const souvenirs: number[] = [];
  const garder = !d.reglages().nePasGarder;
  faits.forEach((f, i) => {
    const fait: Fait = { texte: f.texte, sujet: m.memoire?.sujet ?? m.sujet, verdict: f.verdict };
    // Seul le meilleur fait porte la clé de mémoire (pour remplacer un fait périmé ; jamais un fait du propriétaire).
    if (i === 0 && m.memoire?.cle) fait.cle = m.memoire.cle;
    const source = `web:${f.sites.join('+')}`;
    if (garder) {
      const res = d.apprendre({ sorte: 'lecture', source, date: now, faits: [fait] });
      souvenirs.push(...res.souvenirs);
      if (res.rejetes > 0 && res.retenus === 0 && res.ignores === 0) { ecartes.push(`fait écarté (sans intérêt ou donnée sensible) : « ${court(f.texte, 120)} »`); return; }
    }
    gardes.push({ texte: f.texte, niveau: niveauDe(f.verdict), sources: f.sources });
  });
  // « Ne pas garder » : seulement un compteur — ni sujet, ni adresse, ni empreinte, ni phrase écartée.
  if (!garder) {
    d.journal.noter({ genre: 'ecarte', quoi: `a lu ${neuves.length} page(s) sans rien garder (réglage « ne pas garder »)` });
    return { faits: [], ecartes: ecartes.map(() => 'écarté (détail non gardé)') };
  }
  for (const p of neuves) d.empreintes.marquer(p.empreinte, `page ${p.urlFinale}`);
  d.journal.noter({
    genre: garder ? 'retenu' : 'ecarte', manque: m.id, pourquoi: m.raison,
    quoi: garder ? `a retenu ${gardes.length} fait(s) sur « ${court(m.sujet, 80)} » (${dateCourte(now)})` : `a lu sans rien garder (réglage « ne pas garder ») sur « ${court(m.sujet, 80)} »`,
    source: [...new Set(neuves.map((p) => p.site))].join(', '),
    retenu: garder ? gardes.map((g) => ({ texte: court(g.texte, 300), niveau: g.niveau })) : [],
    ...(souvenirs.length ? { souvenirs } : {}),
    ...(ecartes.length ? { supprime: ecartes.slice(0, 30) } : {}),
  });
  return { faits: garder ? gardes : [], ecartes };
}

/** Traite un manque de bout en bout. Ne lève jamais (une panne devient un échec noté). */
export async function rechercherManque(d: DepsRecherche, m: Manque, signal?: AbortSignal): Promise<BilanManque> {
  const bilan: BilanManque = { manque: m.id, questions: [], pagesLues: 0, faits: [], ecartes: [] };
  try {
    const g = d.garde(); if (g) { bilan.arret = g; return bilan; }
    if (sujetInterdit(d.interdits(), m.sujet)) { d.curiosite.noter(m.id, 'interdit', 'sujet interdit'); return bilan; }
    const r = d.reglages().robot;
    let graines: string[] = [];
    if (m.genre === 'page') {
      graines = (m.adresses ?? []).slice(0, r.pagesParManque);
    } else {
      for (const q of preparerQuestions(m)) {
        const g2 = d.garde(); if (g2) { bilan.arret = g2; break; }
        if (!d.budget.prendre('recherches')) { bilan.arret = 'budget'; break; }
        bilan.questions.push(q);
        let res: Awaited<ReturnType<Chercheur>> = [];
        try { res = await d.chercher(q, signal); } catch { res = []; }
        d.journal.noter(d.reglages().nePasGarder
          ? { genre: 'recherche', quoi: `une recherche (${res.length} résultat(s) ; question non gardée)` }
          : { genre: 'recherche', manque: m.id, quoi: `a cherché « ${court(q, 120)} » (${res.length} résultat(s))`, pourquoi: m.raison });
        for (const x of res) {
          const f = controlerForme(x?.url);
          if (!f.ok || siteInterdit(d.interdits(), f.url.toString())) continue;
          if (!graines.includes(f.url.toString())) graines.push(f.url.toString());
        }
        if (graines.length >= r.pagesParManque) break;
      }
      graines = graines.slice(0, r.pagesParManque);
    }
    if (!graines.length) {
      if (!bilan.arret) d.curiosite.noter(m.id, 'echec', 'aucune page à lire');
      return bilan;
    }
    const lu = await d.obtenirPages(m, graines, signal);
    bilan.pagesLues = lu.pages.length;
    if (lu.arret) bilan.arret = lu.arret;
    const rang = rangerPages(d, m, lu.pages);
    bilan.faits = rang.faits;
    bilan.ecartes = rang.ecartes;
    if (bilan.arret && !lu.pages.length) return bilan; // arrêté avant d'avoir lu : le manque reste en attente
    const confirme = bilan.faits.some((f) => f.niveau === 'confirmé');
    d.curiosite.noter(m.id, bilan.faits.length ? 'fait' : 'echec', bilan.faits.length ? `${bilan.faits.length} fait(s), ${confirme ? 'au moins un confirmé' : 'à vérifier'}` : 'rien de sûr trouvé');
  } catch (e) {
    d.curiosite.noter(m.id, 'echec', `panne : ${court(String((e as Error)?.message ?? e), 120)}`);
  }
  if (bilan.arret) d.journal.noter({ genre: 'arret', manque: m.id, quoi: `arrêt : ${PHRASES_ARRET[bilan.arret]}` });
  return bilan;
}

/** L'adaptateur vers LE moteur de recherche d'Odin (chargé tard : rien ne part tant qu'il n'est pas appelé). */
export function chercheurOdin(o: { fetcher?: typeof fetch; n?: number } = {}): Chercheur {
  return async (q, signal) => {
    const { webSearch } = await import('../../tools/search.ts');
    const r = await webSearch(q, o.n ?? 8, { signal, ...(o.fetcher ? { fetcher: o.fetcher } : {}) });
    return r.results.map((x) => ({ url: x.url, titre: x.title, extrait: x.snippet }));
  };
}
