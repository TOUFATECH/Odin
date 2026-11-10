// ia_historique : Odin consulte son propre journal des routages pour dire EXACTEMENT quelle IA a
// traité une demande (et qui a été essayé avant), au lieu de le déduire de la configuration.

import { providerLabel, routeContext, routingReport, serviceOf, turnSummary, type ReportScope } from '../providers/journal.ts';
import { tierOf } from '../providers/router.ts';
import { num, obj, str, type Tool } from './registry.ts';

export const routingHistory: Tool = {
  name: 'ia_historique',
  description: 'Journal réel des IA utilisées : quel modèle a traité quelle demande, pourquoi il a été choisi, qui a été essayé avant et pourquoi il a échoué, temps, jetons, coût. « en_cours » = la demande actuelle (jusqu\'ici), « dernier » = la demande précédente de cette conversation, « conversation » = les dernières demandes ici, « tout » = les derniers appels partout, « bilan » = qui a travaillé combien sur 30 jours, « config » = l\'ordre prévu. À utiliser TOUJOURS avant de dire quelle IA a répondu : ne le déduis jamais de la configuration.',
  risk: 'read',
  schema: obj({ portee: str('en_cours, dernier, conversation, tout, bilan ou config (défaut : dernier)'), limite: num('nombre de demandes ou d\'appels (défaut 10)') }),
  async run(i, ctx) {
    const scope = String(i.portee ?? 'dernier');
    const cur = routeContext();
    if (scope === 'en_cours') {
      const rows = cur?.entries ?? [];
      return rows.length ? `Demande en cours (tour ${cur?.turnId}) jusqu'ici : ${turnSummary(rows).line}` : 'Aucun appel enregistré pour la demande en cours.';
    }
    if (scope === 'config') {
      const list = ctx.careCfg?.providers ?? [];
      return `Ordre PRÉVU (configuration, pas l'historique) :\n${list.map((p, k) => `${k + 1}. ${providerLabel(`${p.kind === 'openai' ? serviceOf(p.baseUrl) : p.kind}:${p.model}`)} · palier ${tierOf(p)}${p.personal === false ? ' · pas de données personnelles' : ''}`).join('\n')}\nPour savoir qui a réellement répondu, utilise la portée « dernier » ou « conversation ».`;
    }
    const valid: ReportScope[] = ['dernier', 'conversation', 'tout', 'bilan'];
    return routingReport(ctx.muninn, { scope: valid.includes(scope as ReportScope) ? scope as ReportScope : 'dernier', sessionId: ctx.sessionId, currentTurnId: cur?.turnId, limit: Number(i.limite) || 10 });
  },
};
