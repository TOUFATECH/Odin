// Outil de recherche fiable (équipe d'agents : chercheur, analyste des sources, contradicteur,
// vérificateur, rédacteur). Plus lent qu'une simple recherche, mais chaque fait est prouvé.

import { research } from '../research/research.ts';
import { LECTURE_RECHERCHE, politeFetch } from '../research/fetch.ts';
import { browserFor } from './browser.ts';
import { obj, str, type Tool } from './registry.ts';
import { signalerVerdicts } from '../valhalla/mathesis/signaux.ts';
import { apprendreDeLaRecherche, depsRecherche, peutApprendreDeLaRecherche } from '../learn/apprendre-recherche.ts';

const s = (v: unknown) => String(v ?? '');

export const webResearch: Tool = {
  name: 'web_research',
  description: 'Recherche web FIABLE et vérifiée : plusieurs requêtes et plusieurs moteurs, lecture des pages et PDF, évaluation des sources (auteur, date, officielle ou non), détection des reprises d\'une même source, recherche active de contradictions, chaque fait prouvé par une citation exacte. Renvoie un rapport sourcé (vérifié / probable / contredit, limites). À utiliser pour toute question factuelle importante, comparaison, actualité, chiffres, choix technique. Prend 30 s à 2 min.',
  risk: 'network',
  taints: true,
  lookup: () => true,
  schema: obj({ question: str('la question, complète et précise'), depth: { type: 'string', enum: ['rapide', 'normale', 'approfondie'], description: 'rapide (5 sources), normale (9), approfondie (14)' } }, ['question']),
  summarize: (i) => `recherche vérifiée : ${s(i.question)}`,
  async run(i, ctx) {
    if (!ctx.llm) return 'Recherche vérifiée indisponible ici : utilise web_search puis web_fetch.';
    // Qui demande, et dans quelle conversation : pris AVANT la recherche (qui, elle, marque la conversation).
    const demande = { proprietaire: ctx.fullAccess === true, marquee: ctx.isTainted(), prive: ctx.muninn.privateMode === true };
    const browserText = ctx.home ? async (url: string, fin?: AbortSignal) => {
      if (fin?.aborted) return undefined; // la collecte est finie : on n'ouvre plus de page
      const b = browserFor(ctx.home!);
      const l = await b.open(url);
      return { title: l.title, text: l.text };
    } : undefined;
    const r = await research(s(i.question), {
      llm: ctx.llm, browserText, depth: (['rapide', 'normale', 'approfondie'].includes(s(i.depth)) ? s(i.depth) : 'normale') as 'normale',
      provider: ctx.search?.provider, searxngUrl: ctx.search?.searxngUrl, signal: ctx.signal,
      fetchPage: (u, fin) => politeFetch(u, { signal: fin ?? ctx.signal, ...LECTURE_RECHERCHE }),
      // Chaque étape (« je cherche avec plusieurs moteurs », « je lis 8 sources »…) part vers l'interface.
      onStep: (t) => ctx.etape?.(t),
    });
    for (const c of r.claims) for (const e of c.evidence) {
      const src = r.sources.find((x) => x.n === e.source);
      if (src) ctx.muninn.addEvidence({ session: ctx.sessionId, question: r.question, claim: c.claim, verdict: c.verdict, url: src.page.finalUrl, title: src.page.title, site: src.site, published: src.page.published, accessed: src.page.accessed, quote: e.quote, stance: e.stance, tier: src.tier });
    }
    // Mathésis : ce qui reste sans réponse sûre (ou à une seule source) rejoint sa liste de curiosité (rien en privé).
    try { signalerVerdicts(r.question, r.claims, { prive: ctx.muninn.privateMode === true }); } catch { /* jamais bloquant */ }
    // L'entrée commune d'apprentissage : les affirmations prouvées deviennent des souvenirs avec leur niveau, leur source
    // et leur date (sans doublon). APRÈS coup, jamais bloquant ; seulement pour le propriétaire, dans une conversation
    // non marquée, hors mode privé.
    if (peutApprendreDeLaRecherche({ ...demande, prive: demande.prive || ctx.muninn.privateMode === true })) {
      // La vraie configuration d'Odin (Noûs coupé, mode privé). Point ouvert : le contexte d'un outil ne dit pas si Odin
      // tourne en démonstration.
      const odin = ctx.careCfg ? { cfg: ctx.careCfg, paths: { home: ctx.home ?? '' } } : undefined;
      setImmediate(() => { try { apprendreDeLaRecherche(depsRecherche(ctx.muninn, odin), r); } catch { /* jamais bloquant */ } });
    }
    // Les pages non lues à temps (ou lues en partie) sont TOUJOURS dites, toutes, avant les autres erreurs.
    const nonLues = r.nonLues ?? [], autres = r.errors.filter((e) => !nonLues.includes(e));
    const meta = `\n\n— Moteurs : ${r.engines.join(', ')} · ${r.sources.length} source(s) lue(s), ${new Set(r.sources.map((x) => x.cluster)).size} groupe(s) indépendant(s)${nonLues.length ? ` · non lues à temps ou en partie : ${nonLues.join(' ; ')}` : ''}${autres.length ? ` · non lues : ${autres.slice(0, 3).join(' ; ')}` : ''}`;
    return { output: r.report + meta, tainted: true };
  },
};

export const evidenceSearch: Tool = {
  name: 'evidence_search',
  description: 'Retrouve les preuves déjà archivées par les recherches vérifiées (affirmation, verdict, passage exact, adresse, dates).',
  risk: 'read',
  schema: obj({ query: str('sujet ou mot-clé') }, ['query']),
  async run(i, ctx) {
    const rows = ctx.muninn.findEvidence(s(i.query));
    return rows.map((r) => `• ${r.claim} → ${r.verdict} [${r.stance}]\n  « ${r.quote} »\n  ${r.title} — ${r.url} (publiée ${r.published || '?'}, consultée ${r.accessed.slice(0, 10)})`).join('\n') || 'Aucune preuve archivée sur ce sujet.';
  },
};
