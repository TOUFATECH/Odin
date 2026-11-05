// Outil de recherche fiable (équipe d'agents : chercheur, analyste des sources, contradicteur,
// vérificateur, rédacteur). Plus lent qu'une simple recherche, mais chaque fait est prouvé.

import { research } from '../research/research.ts';
import { politeFetch } from '../research/fetch.ts';
import { browserFor } from './browser.ts';
import { obj, str, type Tool } from './registry.ts';

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
    const browserText = ctx.home ? async (url: string) => {
      const b = browserFor(ctx.home!);
      const l = await b.open(url);
      return { title: l.title, text: l.text };
    } : undefined;
    const r = await research(s(i.question), {
      llm: ctx.llm, browserText, depth: (['rapide', 'normale', 'approfondie'].includes(s(i.depth)) ? s(i.depth) : 'normale') as 'normale',
      provider: ctx.search?.provider, searxngUrl: ctx.search?.searxngUrl, signal: ctx.signal,
      fetchPage: (u) => politeFetch(u, { signal: ctx.signal }),
    });
    for (const c of r.claims) for (const e of c.evidence) {
      const src = r.sources.find((x) => x.n === e.source);
      if (src) ctx.muninn.addEvidence({ session: ctx.sessionId, question: r.question, claim: c.claim, verdict: c.verdict, url: src.page.finalUrl, title: src.page.title, site: src.site, published: src.page.published, accessed: src.page.accessed, quote: e.quote, stance: e.stance, tier: src.tier });
    }
    const meta = `\n\n— Moteurs : ${r.engines.join(', ')} · ${r.sources.length} source(s) lue(s), ${new Set(r.sources.map((x) => x.cluster)).size} groupe(s) indépendant(s)${r.errors.length ? ` · non lues : ${r.errors.slice(0, 3).join(' ; ')}` : ''}`;
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
