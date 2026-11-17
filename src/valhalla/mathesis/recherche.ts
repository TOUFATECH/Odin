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
import { clePhrase, delaiRepos, type Traces } from './traces.ts';
import type { OuTrouver } from './ou-trouver.ts';
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

/** Les écritures sans espaces entre les mots. */
const SANS_BLANCS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
/** Le décor d'une page, jamais retenu comme un fait (bandeaux de liens « A · B · C » compris). */
const BRUIT = /https?:\/\/|www\.|^\s*[↑^]|^\s*\(\w{2}\)\s*«|derni[eè]re modification de cette page|ce document provient de|consult[ée] le \d|r[ée]cup[ée]r[ée] de|^\s*\d+\s*[.)]\s*↑|([·•|].*){2}|(\s[»›>]\s.*){3}/i;

/**
 * Les mots CENTRAUX du sujet : ceux que la question écrit avec une majuscule ou un chiffre (« PNG » dans « format de
 * fichier PNG », « Zigbee » dans « protocole Zigbee domotique ») — le nom de la chose, pas sa catégorie. Le premier mot
 * ne compte que s'il est tout en capitales (sa majuscule n'est peut-être que celle du début de phrase). Sans aucun, rien
 * n'est exigé. Pur.
 */
export function motsCentraux(sujet: string): string[] {
  const out: string[] = [];
  String(sujet ?? '').split(/[\s,;:!?()«»"'’]+/).filter(Boolean).forEach((brut, i) => {
    const capitales = /^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9.-]+$/.test(brut) && /[A-ZÀ-Ý]/.test(brut);
    if (i === 0 ? !capitales : !(/[A-ZÀ-Ý]/.test(brut) || /\d/.test(brut))) return;
    for (const m of motsUtiles(brut)) if (!out.includes(m)) out.push(m);
  });
  return out;
}

/** Combien de fois les mots centraux reviennent dans une page (texte entier). Linéaire. */
function compteCentraux(texte: string, centraux: string[]): number {
  const c = new Set(centraux);
  let n = 0;
  for (const brut of String(texte ?? '').split(/\s+/)) for (const m of motsUtiles(brut)) if (c.has(m)) n++;
  return n;
}

/**
 * Les pages qui parlent de la chose cherchée. Une page en est si son titre ou son adresse contient un mot central, ou
 * si ce mot y revient souvent : au moins un tiers autant que dans la page qui le cite le plus. La page « ZIP » qui
 * cite le PNG une ou deux fois n'en est pas ; l'article sur le PNG (titre « Portable Network Graphics ») le cite partout.
 * (Constaté sur de vraies pages : leur première phrase est souvent un bandeau, pas le sujet.) Pur.
 */
export function pagesDansLeSujet<P extends Pick<PageLue, 'titre' | 'urlFinale' | 'texte'>>(pages: P[], centraux: string[]): P[] {
  if (!centraux.length) return pages;
  const nommee = (p: P): boolean => {
    let chemin = p.urlFinale;
    try { chemin = decodeURIComponent(new URL(p.urlFinale).pathname); } catch { /* adresse brute */ }
    const t = new Set(motsUtiles(`${p.titre} ${chemin}`));
    return centraux.some((m) => t.has(m));
  };
  const comptes = pages.map((p) => compteCentraux(p.texte, centraux));
  const plus = Math.max(0, ...comptes);
  return pages.filter((p, i) => nommee(p) || (comptes[i] >= 1 && comptes[i] * 3 >= plus));
}

/** Les renvois de notes (« [ 6 ] », « [a] », « [réf. nécessaire] ») retirés d'une phrase. */
const sansRenvois = (p: string): string => p.replace(/\s*\[\s*(?:\d{1,3}|[a-z]|note \d{1,3}|r[ée]f\.? n[ée]cessaire)\s*\]/gi, '').replace(/\s+([.,])(?=\s|$)/g, '$1');

/** Les phrases d'un texte qui parlent du sujet (et ne sont pas des consignes). Avec des mots centraux, une phrase
 *  doit en contenir un. Pur. */
export function phrasesPertinentes(texte: string, mots: string[], max = 8, centraux: string[] = []): { gardees: string[]; consignes: string[] } {
  const gardees: string[] = [], consignes: string[] = [];
  if (!mots.length) return { gardees, consignes };
  const besoin = mots.length >= 3 ? Math.ceil(mots.length / 2) : mots.length;
  // Phrases : après . ! ? suivis d'un blanc, après la ponctuation pleine largeur (。！？, sans blanc), ou à la ligne.
  for (const brute of String(texte ?? '').split(/(?<=[.!?])\s+|(?<=[。！？])|\n+/)) {
    const p = sansRenvois(brute.replace(/^[-#*\s]+/, '')).replace(/\s+/g, ' ').trim();
    // Une écriture sans espaces (chinois, japonais…) dit en 10 caractères ce qu'une autre dit en 30.
    const min = SANS_BLANCS.test(p) ? 10 : 30;
    if (p.length < min || p.length > 400) continue;
    // Le décor d'une page n'est pas un fait (vu sur de vraies pages, 17/11/2026) : une adresse écrite dans la phrase
    // (« Ce document provient de « https://… » »), un renvoi de note (« ↑ (en) « … » »), une date de modification.
    if (BRUIT.test(p)) continue;
    const ici = new Set(motsUtiles(p));
    const n = mots.filter((m) => ici.has(m)).length;
    if (n < besoin) continue;
    // Un mot central est exigé (« PNG » pour « format de fichier PNG » : « format de fichier » seul ne suffit pas).
    if (centraux.length && !centraux.some((m) => ici.has(m))) continue;
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
export function recouper(pages: PageLue[], sujet: string, maintenant: number, o: { seuil?: number; max?: number; deja?: (url: string) => Set<string>; sansCentraux?: boolean } = {}): { faits: FaitRecoupe[]; consignes: Array<{ texte: string; source: string }>; vues: Map<string, string[]> } {
  const mots = motsUtiles(sujet);
  // Une page qui ne parle pas de la chose cherchée (son titre, son adresse, son début) ne donne aucun fait.
  const centraux = o.sansCentraux ? [] : motsCentraux(sujet);
  const dansLeSujet = pagesDansLeSujet(pages, centraux);
  const evalues = clusterSources(dansLeSujet.map((p, i) => assess(versPage(p, maintenant), i + 1, maintenant)));
  const groupes: Array<{ rep: string; mots: Set<string>; clusters: Set<number>; sources: Set<string>; sites: Set<string>; score: number; nouveau: boolean; membres: Array<{ url: string; cle: string }> }> = [];
  const consignes: Array<{ texte: string; source: string }> = [];
  dansLeSujet.forEach((p, i) => {
    const a = evalues[i];
    const { gardees, consignes: c } = phrasesPertinentes(p.texte, mots, 60, centraux);
    for (const x of c) consignes.push({ texte: x, source: p.urlFinale });
    const deja = o.deja?.(p.urlFinale) ?? new Set<string>();
    let nouvelles = 0;
    for (const ph of gardees) {
      const cle = clePhrase(ph), nouveau = !deja.has(cle);
      // Au plus 8 phrases NOUVELLES par page et par lecture ; les suivantes ne sont pas notées : elles restent à apprendre.
      if (nouveau && ++nouvelles > 8) continue;
      const ms = new Set(motsUtiles(ph));
      const g = groupes.find((x) => jaccard(x.mots, ms) >= (o.seuil ?? 0.5));
      if (g) {
        g.clusters.add(a.cluster); g.sources.add(p.urlFinale); g.sites.add(p.site); g.score = Math.max(g.score, a.score);
        g.membres.push({ url: p.urlFinale, cle });
        if (nouveau && !g.nouveau) { g.nouveau = true; g.rep = ph; } // le fait se dit avec sa phrase NOUVELLE
      } else groupes.push({ rep: ph, mots: ms, clusters: new Set([a.cluster]), sources: new Set([p.urlFinale]), sites: new Set([p.site]), score: a.score, nouveau, membres: [{ url: p.urlFinale, cle }] });
    }
  });
  // Seulement le NOUVEAU : un fait dont toutes les phrases étaient déjà connues de ces pages n'est pas réappris (une
  // phrase ancienne peut encore CONFIRMER une nouvelle venue d'une autre source).
  const retenus = groupes
    .filter((g) => !o.deja || g.nouveau)
    .sort((x, y) => y.clusters.size - x.clusters.size || y.score - x.score)
    .slice(0, o.max ?? 5);
  // « Déjà lues » : SEULEMENT les phrases des faits retenus. Celles coupées par un plafond seront apprises plus tard.
  const vues = new Map<string, string[]>();
  for (const g of retenus) for (const x of g.membres) vues.set(x.url, [...(vues.get(x.url) ?? []), x.cle]);
  const faits = retenus
    .map((g) => ({
      texte: g.rep,
      verdict: { verdict: g.clusters.size >= 2 ? 'confirmé' : 'probable', independent: g.clusters.size } as VerdictBrut,
      sources: [...g.sources], sites: [...g.sites],
    }));
  return { faits, consignes, vues };
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
  /** La trace des recherches et des phrases déjà lues page par page (jamais deux fois la même chose). */
  traces?: Traces;
  /** L'endroit précis (adresse, titre, date) de chaque fait appris, pour répondre « c'est ici ». */
  ouTrouver?: OuTrouver;
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
  const garderTrace = !d.reglages().nePasGarder;
  // Une adresse confiée n'a pas de « sujet » en mots : on prend alors le titre des pages lues.
  const confiee = /^https?:\/\//i.test(m.sujet);
  const sujet = confiee ? neuves.map((p) => p.titre).join(' ') || m.sujet : m.sujet;
  // Une page confiée a été choisie par le propriétaire : elle est dans le sujet par définition (pas de mot central exigé).
  const { faits, consignes, vues } = recouper(neuves, sujet, now, { sansCentraux: confiee, ...(d.traces && garderTrace ? { deja: (u: string) => d.traces!.deja(u) } : {}) });
  for (const c of consignes) ecartes.push(`phrase écartée (ressemble à une consigne) : « ${court(c.texte, 120)} » — ${c.source}`);
  const gardes: BilanManque['faits'] = [];
  const souvenirs: number[] = [];
  const garder = !d.reglages().nePasGarder;
  const endroits: Array<{ texte: string; url: string; titre: string; site: string; at: number }> = [];
  faits.forEach((f, i) => {
    const fait: Fait = { texte: f.texte, sujet: m.memoire?.sujet ?? m.sujet, verdict: f.verdict };
    // Seul le meilleur fait porte la clé de mémoire (pour remplacer un fait périmé ; jamais un fait du propriétaire).
    if (i === 0 && m.memoire?.cle) fait.cle = m.memoire.cle;
    const source = `web:${f.sites.join('+')}`;
    if (garder) {
      const adresse = f.sources[0];
      const res = d.apprendre({ sorte: 'lecture', source, date: now, faits: [fait], ...(adresse ? { adresse } : {}) });
      souvenirs.push(...res.souvenirs);
      if (res.rejetes > 0 && res.retenus === 0 && res.ignores === 0) { ecartes.push(`fait écarté (sans intérêt ou donnée sensible) : « ${court(f.texte, 120)} »`); return; }
    }
    gardes.push({ texte: f.texte, niveau: niveauDe(f.verdict), sources: f.sources });
    // Où trouver : la page précise de ce fait (la première source), son titre et la date de lecture.
    if (garder && d.ouTrouver && f.sources[0]) {
      const p = neuves.find((x) => x.urlFinale === f.sources[0]);
      endroits.push({ texte: f.texte, url: f.sources[0], titre: p?.titre ?? '', site: p?.site ?? f.sites[0] ?? '', at: now });
    }
  });
  // Où trouver : tous les faits de ces pages en une seule écriture.
  if (garder && d.ouTrouver && endroits.length) { try { d.ouTrouver.noterTout(endroits); } catch { /* jamais bloquant */ } }
  // « Ne pas garder » : seulement un compteur — ni sujet, ni adresse, ni empreinte, ni phrase écartée.
  if (!garder) {
    d.journal.noter({ genre: 'ecarte', quoi: `a lu ${neuves.length} page(s) sans rien garder (réglage « ne pas garder »)` });
    return { faits: [], ecartes: ecartes.map(() => 'écarté (détail non gardé)') };
  }
  for (const p of neuves) d.empreintes.marquer(p.empreinte, `page ${p.urlFinale}`);
  // Les phrases lues sur chaque page sont gardées : à la prochaine lecture, seul ce qui est nouveau sera appris.
  if (d.traces) for (const p of neuves) d.traces.noterPage(p.urlFinale, vues.get(p.urlFinale) ?? [], gardes.filter((g) => g.sources.includes(p.urlFinale)).length);
  d.journal.noter({
    genre: garder ? 'retenu' : 'ecarte', manque: m.id, pourquoi: m.raison,
    quoi: garder ? `a retenu ${gardes.length} fait(s) nouveau(x) sur « ${court(m.sujet, 80)} » (${dateCourte(now)})` : `a lu sans rien garder (réglage « ne pas garder ») sur « ${court(m.sujet, 80)} »`,
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
  const debutRecherche = d.maintenant();
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
        // Déjà posée il y a moins d'une semaine : pas reposée ; ses adresses resservent (le robot ne relit que le dû).
        const deja = d.traces?.recente(q);
        if (deja) {
          if (!d.reglages().nePasGarder) d.journal.noter({ genre: 'recherche', manque: m.id, quoi: `« ${court(q, 120)} » déjà cherché le ${dateCourte(deja.at)} : pas reposé avant le ${dateCourte(deja.at + delaiRepos(deja))}`, pourquoi: m.raison });
          for (const u of deja.urls) if (!graines.includes(u) && !siteInterdit(d.interdits(), u)) graines.push(u);
          continue;
        }
        if (!d.budget.prendre('recherches')) { bilan.arret = 'budget'; break; }
        bilan.questions.push(q);
        let res: Awaited<ReturnType<Chercheur>> = [];
        let enPanne = false;
        try { res = await d.chercher(q, signal); } catch { res = []; enPanne = true; }
        // Moteur injoignable : la question n'est PAS notée « cherchée » (elle sera reposée au prochain tour).
        if (enPanne) {
          d.journal.noter(d.reglages().nePasGarder
            ? { genre: 'recherche', quoi: 'une recherche impossible (moteur injoignable)' }
            : { genre: 'recherche', manque: m.id, quoi: `n'a pas pu chercher « ${court(q, 120)} » (moteur injoignable) : reposée plus tard`, pourquoi: m.raison });
          continue;
        }
        const trouvees: string[] = [];
        d.journal.noter(d.reglages().nePasGarder
          ? { genre: 'recherche', quoi: `une recherche (${res.length} résultat(s) ; question non gardée)` }
          : { genre: 'recherche', manque: m.id, quoi: `a cherché « ${court(q, 120)} » (${res.length} résultat(s))`, pourquoi: m.raison });
        for (const x of res) {
          const f = controlerForme(x?.url);
          if (!f.ok || siteInterdit(d.interdits(), f.url.toString())) continue;
          trouvees.push(f.url.toString());
          if (!graines.includes(f.url.toString())) graines.push(f.url.toString());
        }
        if (d.traces && !d.reglages().nePasGarder) d.traces.noterRecherche({ q, moteur: (res as { moteur?: string }).moteur ?? 'moteur d\'Odin', resultats: res.length, urls: trouvees, manque: m.id });
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
    if (d.traces && !d.reglages().nePasGarder) d.traces.noterRetenus(m.id, debutRecherche, rang.faits.length);
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
    // le nom du moteur qui a répondu accompagne les résultats (gardé dans la trace des recherches)
    return Object.assign(r.results.map((x) => ({ url: x.url, titre: x.title, extrait: x.snippet })), { moteur: String(r.provider) });
  };
}
