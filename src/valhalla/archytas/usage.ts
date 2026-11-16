// Le suivi des scripts : à chaque exécution on mesure (temps, succès/échec), on range l'exécution, on tient à
// jour la statistique du script, et on construit le suivi (plus/moins utilisés, récents/anciens, jamais
// servis) et le graphe (un point par script, placé selon son usage et sa fraîcheur). Tout est daté. Pur.

import type { ExecutionRangee, Graphe, NoeudScript, ScriptResume, Stat, Suivi } from './scripts.ts';

/** Une statistique vide (script jamais lancé). */
export const statVide = (): Stat => ({ runs: 0, ok: 0, echecs: 0, msMoyen: 0 });

/** Plie une nouvelle exécution dans la statistique d'un script (moyenne du temps mise à jour). Pur. */
export function majStat(stat: Stat, ok: boolean, ms: number, at: number): Stat {
  const runs = stat.runs + 1;
  const msMoyen = Math.round((stat.msMoyen * stat.runs + Math.max(0, ms)) / runs);
  return { runs, ok: stat.ok + (ok ? 1 : 0), echecs: stat.echecs + (ok ? 0 : 1), msMoyen, dernier: at };
}

/** La statistique recalculée depuis les exécutions rangées (filet de sécurité / repli). Pur. */
export function statDepuisExecutions(execs: ExecutionRangee[]): Stat {
  if (!execs.length) return statVide();
  let ok = 0, ms = 0, dernier = 0;
  for (const e of execs) { if (e.ok) ok++; ms += Math.max(0, e.ms); dernier = Math.max(dernier, e.at); }
  return { runs: execs.length, ok, echecs: execs.length - ok, msMoyen: Math.round(ms / execs.length), dernier };
}

/** Le dernier moment utile d'un script (dernier usage, sinon dernière modification, sinon création). Pur. */
const quand = (s: ScriptResume): number => s.dernierUsage ?? s.stat.dernier ?? s.modifie ?? s.cree;

/**
 * Le suivi : les plus utilisés d'abord, les plus récents, les plus anciens, et ceux jamais servis. Chaque
 * liste est bornée (12) pour rester lisible. Pur.
 */
export function construireSuivi(resumes: ScriptResume[], limite = 12): Suivi {
  const servis = resumes.filter((s) => s.stat.runs > 0);
  const jamais = resumes.filter((s) => s.stat.runs === 0);
  const plusUtilises = [...servis].sort((a, b) => b.stat.runs - a.stat.runs || quand(b) - quand(a)).slice(0, limite);
  const recents = [...resumes].sort((a, b) => quand(b) - quand(a)).slice(0, limite);
  const anciens = [...resumes].sort((a, b) => quand(a) - quand(b)).slice(0, limite);
  return { plusUtilises, recents, anciens, jamais: jamais.sort((a, b) => a.cree - b.cree).slice(0, limite) };
}

/** Les mots d'une mission (pour relier les scripts d'un même thème dans le graphe). Pur. */
function motsMission(s: ScriptResume): string[] {
  return (s.mission || s.nom).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
}

/**
 * Le graphe des scripts : un point par script. `usage` = nombre d'exécutions ; `frais` = fraîcheur 0..1 (1 =
 * tout récent, 0 = ancien, sur 30 jours). La taille suit l'usage, la couleur suit la fraîcheur. Les points
 * se relient quand ils partagent un mot de mission (même thème). Cliquable : l'id est le nom du script. Pur.
 */
export function construireGraphe(resumes: ScriptResume[], now: number): Graphe {
  const maxRuns = Math.max(1, ...resumes.map((s) => s.stat.runs));
  const jour = 86_400_000;
  const nodes: NoeudScript[] = resumes.map((s) => {
    const age = Math.max(0, now - quand(s));
    const frais = Math.max(0, Math.min(1, 1 - age / (30 * jour)));
    const usage = s.stat.runs;
    return {
      id: s.nom,
      label: s.nom,
      sub: s.mission.slice(0, 48) || s.description.slice(0, 48),
      usage,
      frais,
      size: 6 + Math.round(14 * (usage / maxRuns)),
      // Vert si frais et utilisé, orangé si tiède, gris si jamais servi ou ancien.
      color: usage === 0 ? '#9aa4b2' : frais > 0.6 ? '#39c17f' : frais > 0.2 ? '#e0a23a' : '#c05b5b',
    };
  });
  // Liens : scripts partageant un mot de mission (au plus quelques liens par point, pour rester lisible).
  const parMot = new Map<string, string[]>();
  for (const s of resumes) for (const w of new Set(motsMission(s))) parMot.set(w, [...(parMot.get(w) ?? []), s.nom]);
  const vus = new Set<string>(), edges: Array<[string, string]> = [];
  for (const liste of parMot.values()) {
    if (liste.length < 2 || liste.length > 8) continue;
    for (let i = 1; i < liste.length; i++) {
      const a = liste[0], b = liste[i], cle = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      if (a === b || vus.has(cle)) continue; vus.add(cle); edges.push([a, b]);
    }
  }
  return { nodes, edges };
}
