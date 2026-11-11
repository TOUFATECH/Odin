// Économies : ce qu'Odin a fait sans IA, ce que ça a évité, et ce que le choix du modèle le moins
// cher qui convient a fait gagner. Tout vient du journal réel (jamais d'une estimation au hasard) :
//   - une tâche faite sans IA évite, en moyenne, ce que te coûte une demande confiée à une IA
//     (moyenne mesurée sur TES demandes des 30 derniers jours, appels de fond compris) ;
//   - pour les demandes passées par une IA, on compare ce qu'elles ont coûté avec ce qu'elles
//     auraient coûté si tout était parti vers ton modèle le plus cher.
// Quand il n'y a pas encore assez de demandes pour comparer, Odin le dit au lieu d'inventer un chiffre.

export interface SavingsData {
  /** Tâches faites sans IA. */
  direct: number;
  /** Dont : grâce à ce qu'Odin a appris. */
  learned: number;
  /** Demandes confiées à une IA (tours), appels, dépense, jetons. */
  aiTurns: number;
  aiCalls: number;
  spentUsd: number;
  tokens: number;
  /** Par fournisseur : jetons et dépense. */
  byProvider: Array<{ provider: string; label: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  /** Pourquoi sans IA (les raisons les plus fréquentes). */
  reasons: Array<{ reason: string; n: number }>;
}
export interface Price { name: string; priceIn?: number; priceOut?: number }
export interface Savings extends SavingsData {
  days: number;
  /** Part des demandes faites sans IA (0 à 1). */
  share: number;
  /** Coût moyen d'une demande confiée à une IA (undefined : pas assez de demandes pour le mesurer). */
  avgTurnUsd?: number;
  avgTurnTokens?: number;
  /** Évité grâce au « sans IA » (estimation à partir de la moyenne mesurée). */
  avoidedUsd?: number;
  avoidedTokens?: number;
  /** Gagné en n'envoyant pas tout au modèle le plus cher. */
  cheaperUsd: number;
  reference?: string;
  /** Acquis en mémoire. */
  acquis: number;
}
export interface SavingsSource { savingsData(since: number): SavingsData; getKv(k: string): string | undefined | null }

/** Calcule les économies à partir du journal. Pur. */
export function savings(data: SavingsData, prices: Price[], acquis = 0, days = 30): Savings {
  const total = data.direct + data.aiTurns;
  const enough = data.aiTurns >= 3;
  const avgTurnUsd = enough ? data.spentUsd / data.aiTurns : undefined, avgTurnTokens = enough ? Math.round(data.tokens / data.aiTurns) : undefined;
  // Le modèle le plus cher parmi ceux qui ont un prix : la référence « si tout était parti chez lui ».
  const priced = prices.filter((p) => (p.priceIn ?? 0) > 0 || (p.priceOut ?? 0) > 0).sort((a, b) => ((b.priceIn ?? 0) + (b.priceOut ?? 0)) - ((a.priceIn ?? 0) + (a.priceOut ?? 0)));
  const ref = priced[0];
  let cheaperUsd = 0;
  if (ref && priced.length > 1) for (const p of data.byProvider) { if (p.provider === ref.name) continue; cheaperUsd += Math.max(0, (p.tokensIn * (ref.priceIn ?? 0) + p.tokensOut * (ref.priceOut ?? 0)) / 1e6 - p.costUsd); }
  const refLabel = ref ? data.byProvider.find((p) => p.provider === ref.name)?.label ?? ref.name.split(':').slice(1).join(':') : undefined;
  return {
    ...data, days, share: total ? data.direct / total : 0, avgTurnUsd, avgTurnTokens,
    avoidedUsd: avgTurnUsd !== undefined ? data.direct * avgTurnUsd : undefined,
    avoidedTokens: avgTurnTokens !== undefined ? data.direct * avgTurnTokens : undefined,
    cheaperUsd, reference: cheaperUsd > 0 ? refLabel : undefined, acquis,
  };
}

const money = (n: number) => (n >= 1 ? `${n.toFixed(2).replace('.', ',')} $` : n >= 0.01 ? `${n.toFixed(3).replace('.', ',')} $` : n > 0 ? `${(n * 100).toFixed(2).replace('.', ',')} centime${n * 100 >= 2 ? 's' : ''}` : '0 $');
const count = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

/** Les économies, en clair (discussion, terminal). Pur. */
export function savingsReport(s: Savings): string {
  const L: string[] = [`Économies sur ${s.days} jours (d'après mon journal) :`];
  if (!s.direct && !s.aiTurns) return 'Rien à compter pour l\'instant : aucune demande sur les 30 derniers jours.';
  const learned = s.learned ? `, dont ${s.learned} grâce à ce que j'ai appris` : '';
  if (s.direct) {
    L.push(`- ${s.direct} tâche${s.direct > 1 ? 's' : ''} faite${s.direct > 1 ? 's' : ''} sans IA${learned} : ${Math.round(s.share * 100)} % de tes demandes.`);
    L.push(s.avoidedUsd !== undefined
      ? `  Ça t'a évité environ ${money(s.avoidedUsd)} et ${count(s.avoidedTokens ?? 0)} jetons (une demande confiée à une IA te coûte en moyenne ${money(s.avgTurnUsd ?? 0)}, mesuré sur ${s.aiTurns} demandes).`
      : '  Je chiffrerai ce que ça évite dès que quelques demandes seront passées par une IA (il m\'en faut trois pour comparer).');
  } else L.push('- Aucune tâche faite sans IA pour l\'instant : je prends la main dès qu\'une demande correspond à une action que je sais faire seul.');
  if (s.aiTurns) L.push(`- ${s.aiTurns} demande${s.aiTurns > 1 ? 's' : ''} confiée${s.aiTurns > 1 ? 's' : ''} à une IA (${s.aiCalls} appel${s.aiCalls > 1 ? 's' : ''}) : ${money(s.spentUsd)} dépensé${s.spentUsd >= 2 ? 's' : ''}.`);
  if (s.cheaperUsd > 0 && s.reference) L.push(`- En envoyant chaque demande au modèle le moins cher qui convient, plutôt que tout à ${s.reference} : environ ${money(s.cheaperUsd)} gagnés.`);
  if (s.reasons.length) L.push(`- Fait sans IA, le plus souvent : ${s.reasons.slice(0, 4).map((r) => `${r.reason.replace(/^action reconnue : /, '').slice(0, 60)} (${r.n})`).join(' ; ')}.`);
  L.push(s.acquis ? `- ${s.acquis} demande${s.acquis > 1 ? 's' : ''} apprise${s.acquis > 1 ? 's' : ''} : je les fais maintenant sans IA (dis « ce que tu as appris »).` : '- Je n\'ai encore rien appris à faire sans IA : ça vient tout seul, à chaque demande qu\'une IA règle par une seule action.');
  return L.join('\n');
}

/** Raccourci : lit le journal et rend le texte. */
export function savingsOf(src: SavingsSource, prices: Price[], now = Date.now(), days = 30): Savings {
  let acquis = 0; try { const l = JSON.parse(src.getKv('acquis') ?? '[]') as unknown[]; acquis = Array.isArray(l) ? l.length : 0; } catch { /* rien */ }
  return savings(src.savingsData(now - days * 86_400_000), prices, acquis, days);
}
export const savingsText = (src: SavingsSource, prices: Price[], now = Date.now()) => savingsReport(savingsOf(src, prices, now));
