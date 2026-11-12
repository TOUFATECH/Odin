// Odin se règle lui-même : à la demande du propriétaire, il lit et change ses réglages courants
// (autonomie, mises à jour, règles « sans IA », budget, affichage de l'IA qui répond…).
//
// Garde-fous :
//  - seule une liste fermée de réglages est accessible ; aucun secret (clé, mot de passe) ne passe par ici ;
//  - seul le propriétaire, et jamais dans une conversation qui a lu du contenu extérieur (mail, web, document) ;
//  - ce qui baisse la sécurité ou engage de l'argent (plus d'autonomie, mise à jour toute seule, limite de
//    dépense retirée, double vérification coupée) est « grave » : Heimdall demande toujours ton accord ;
//  - chaque valeur est vérifiée, et la configuration entière est revalidée avant d'être écrite.

import { setConfigValue, type OdinConfig, type OdinPaths } from '../config.ts';
import { AUTONOMY_LEVELS, type Autonomy } from '../mimir/decisions.ts';
import { obj, str, type Tool } from './registry.ts';

export interface SettingsDeps { paths: OdinPaths; cfg: OdinConfig; heimdall: { setAutonomy(a: Autonomy): void } }
type Value = string | number | boolean;
interface Rule {
  label: string;
  /** Ce que ça change, en une phrase (dit au propriétaire et au modèle). */
  help: string;
  kind: 'bool' | 'enum' | 'number';
  values?: string[];
  get(c: OdinConfig): Value;
  /** Écrit la valeur (fichier), puis l'applique tout de suite à l'Odin qui tourne. */
  set(d: SettingsDeps, v: Value): void;
  /** Raison si ce changement doit toujours attendre l'accord du propriétaire. */
  grave?(v: Value, cur: Value): string | undefined;
}

const bool = (label: string, help: string, path: [keyof OdinConfig & string, string], grave?: Rule['grave']): Rule => ({
  label, help, kind: 'bool', grave,
  get: (c) => (c[path[0]] as unknown as Record<string, unknown>)[path[1]] !== false,
  set: (d, v) => { setConfigValue(d.paths, path, v); (d.cfg[path[0]] as unknown as Record<string, unknown>)[path[1]] = v; },
});

export const SETTINGS: Record<string, Rule> = {
  autonomie: {
    label: 'Autonomie', kind: 'enum', values: AUTONOMY_LEVELS,
    help: 'Jusqu\'où j\'agis seul : prudent (je demande presque tout), equilibre (je demande pour ce qui est grave), autonome (j\'agis et je préviens), breaker (je garde seul mes décisions). Ce qui est grave attend toujours ton accord.',
    get: (c) => c.mimir.autonomy,
    set: (d, v) => { setConfigValue(d.paths, ['mimir', 'autonomy'], v); d.cfg.mimir.autonomy = v as Autonomy; d.heimdall.setAutonomy(v as Autonomy); },
    grave: (v, cur) => (AUTONOMY_LEVELS.indexOf(v as Autonomy) > AUTONOMY_LEVELS.indexOf(cur as Autonomy) && AUTONOMY_LEVELS.indexOf(v as Autonomy) >= 2 ? `me laisser agir seul davantage (autonomie « ${String(v)} »)` : undefined),
  },
  mises_a_jour: {
    label: 'Mises à jour d\'Odin', kind: 'enum', values: ['off', 'notify', 'auto'],
    help: 'off : je ne regarde pas ; notify : je te préviens quand une version sort ; auto : je l\'installe tout seul dès que je ne travaille plus.',
    get: (c) => c.update?.auto ?? 'notify',
    set: (d, v) => { const u = { auto: v as 'off' | 'notify' | 'auto', everyHours: d.cfg.update?.everyHours ?? 6 }; setConfigValue(d.paths, ['update'], u); d.cfg.update = u; },
    grave: (v, cur) => (v === 'auto' && cur !== 'auto' ? 'me mettre à jour tout seul, sans te demander' : undefined),
  },
  sans_ia_d_abord: bool('Sans IA d\'abord', 'Ce que je sais faire seul n\'est pas confié à une IA (plus rapide, gratuit).', ['routing', 'directFirst']),
  apprendre_sans_ia: bool('Apprendre à faire sans IA', 'Quand une IA règle une demande par une action (ou quelques-unes à la suite), je la retiens pour la refaire seul : c\'est le Cerveau direct, rangé dans le Cerveau, rubrique Quotidien.', ['learning', 'direct']),
  moins_cher_d_abord: bool('L\'IA la moins chère qui convient', 'À compétence égale, la demande part vers l\'IA la moins chère.', ['routing', 'cheapestFirst']),
  ia_locale_d_abord: bool('IA installée chez toi d\'abord', 'Les demandes simples partent d\'abord vers l\'IA installée sur ta machine, quand il y en a une.', ['routing', 'preferLocal']),
  ia_forte_si_complexe: bool('IA la plus capable pour le complexe', 'Les demandes difficiles partent vers l\'IA la plus capable.', ['routing', 'strongForComplex']),
  double_verification: bool('Double vérification des actions risquées', 'Une deuxième IA relit les actions risquées avant qu\'elles partent.', ['routing', 'crossCheckRisky'], (v) => (v === false ? 'ne plus faire relire les actions risquées par une deuxième IA' : undefined)),
  afficher_ia: {
    label: 'Dire quelle IA a répondu', kind: 'enum', values: ['web', 'partout', 'jamais'],
    help: 'Sous chaque réponse : dans l\'appli seulement (web), aussi sur les messageries (partout), ou jamais.',
    get: (c) => c.routing.showModel ?? 'web',
    set: (d, v) => { setConfigValue(d.paths, ['routing', 'showModel'], v); d.cfg.routing.showModel = v as 'web' | 'partout' | 'jamais'; },
  },
  budget_mensuel: {
    label: 'Limite de dépense en IA par mois (dollars)', kind: 'number',
    help: 'Au-delà, seules les IA gratuites servent jusqu\'à la fin du mois. 0 = pas de limite.',
    get: (c) => c.routing.monthlyBudgetUsd ?? 0,
    set: (d, v) => { setConfigValue(d.paths, ['routing', 'monthlyBudgetUsd'], v); d.cfg.routing.monthlyBudgetUsd = Number(v); },
    grave: (v, cur) => (Number(cur) > 0 && Number(v) === 0 ? 'retirer la limite de dépense en IA' : Number(cur) > 0 && Number(v) > Number(cur) ? `monter la limite de dépense en IA à ${String(v)} $ par mois` : undefined),
  },
};

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'').replace(/[\s-]+/g, '_').trim();
/** Le réglage visé, par sa clé (« autonomie ») ou son nom (« sans IA d'abord »). */
export function findSetting(name: string): string | undefined {
  const n = norm(name);
  return Object.keys(SETTINGS).find((k) => k === n) ?? Object.entries(SETTINGS).find(([, r]) => norm(r.label) === n)?.[0];
}
/** Lit une valeur dite en clair (« oui », « désactivé », « 15 », « autonome »). Rend une erreur lisible sinon. */
export function parseValue(r: Rule, raw: unknown): Value | { error: string } {
  const s = norm(String(raw ?? ''));
  if (r.kind === 'bool') {
    if (/^(oui|vrai|true|on|1|active|actif|activee?|allume|marche)$/.test(s)) return true;
    if (/^(non|faux|false|off|0|desactive|desactivee?|inactif|coupe|eteint|arrete)$/.test(s)) return false;
    return { error: `« ${r.label} » se règle sur oui ou non.` };
  }
  if (r.kind === 'enum') {
    const alias: Record<string, string> = { equilibree: 'equilibre', odin_breaker: 'breaker', prudente: 'prudent', prevenir: 'notify', previens: 'notify', automatique: 'auto', jamais_regarder: 'off', desactive: 'off' };
    const v = (r.values ?? []).find((x) => x === s) ?? (r.values ?? []).find((x) => x === alias[s]);
    return v ?? { error: `« ${r.label} » : valeurs possibles ${r.values?.join(', ')}.` };
  }
  const digits = String(raw ?? '').replace(',', '.').replace(/[^\d.-]/g, ''), n = Number(digits);
  return /\d/.test(digits) && Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : { error: `« ${r.label} » attend un nombre positif.` };
}
const shown = (r: Rule, v: Value) => (r.kind === 'bool' ? (v ? 'oui' : 'non') : String(v));

/** Tous les réglages accessibles, en clair. */
export function describeSettings(cfg: OdinConfig): string {
  return ['Mes réglages (dis « règle … sur … » pour en changer un) :', ...Object.entries(SETTINGS).map(([k, r]) => `- ${r.label} [${k}] : ${shown(r, r.get(cfg))}${r.kind === 'enum' ? ` (possible : ${r.values?.join(', ')})` : ''}. ${r.help}`),
    'Le reste (modèle d\'IA, voix, accès, messageries, clés) se règle dans Réglages : je t\'y guide, mais je ne touche pas aux clés ni aux mots de passe d\'ici.'].join('\n');
}

export function settingsTools(deps: () => SettingsDeps): Tool[] {
  const target = (i: Record<string, unknown>) => { const k = findSetting(String(i.reglage ?? '')); return k ? { k, r: SETTINGS[k] } : undefined; };
  return [
    {
      name: 'settings_get',
      description: 'Mes réglages actuels (autonomie, mises à jour, règles « sans IA », budget en IA, affichage de l\'IA qui répond), avec ce que chacun change. Aucun secret.',
      risk: 'read',
      schema: obj({}),
      async run() { return describeSettings(deps().cfg); },
    },
    {
      name: 'settings_set',
      description: `Change UN de mes réglages, quand le propriétaire le demande (« passe en autonome », « ne te mets plus à jour tout seul », « limite l'IA à 10 dollars par mois »). Réglages : ${Object.entries(SETTINGS).map(([k, r]) => `${k} (${r.kind === 'bool' ? 'oui/non' : r.kind === 'enum' ? r.values?.join('/') : 'nombre'})`).join(', ')}. Appliqué tout de suite. Dis ensuite ce qui a changé et ce que ça implique.`,
      risk: 'exec',
      schema: obj({ reglage: str('le réglage à changer (sa clé)'), valeur: str('la nouvelle valeur') }, ['reglage', 'valeur']),
      summarize: (i) => { const t = target(i); return t ? `régler « ${t.r.label} » sur ${String(i.valeur)}` : `changer le réglage ${String(i.reglage)}`; },
      grave: (i) => { const t = target(i); if (!t) return undefined; const v = parseValue(t.r, i.valeur); return typeof v === 'object' ? undefined : t.r.grave?.(v, t.r.get(deps().cfg)); },
      async run(i, ctx) {
        if (!ctx.fullAccess) return 'Seul le propriétaire peut changer mes réglages.';
        if (ctx.isTainted()) return 'Je ne change pas mes réglages dans une conversation qui a lu du contenu extérieur (mail, web, document). Redemande-le dans une nouvelle discussion.';
        const t = target(i);
        if (!t) return `Je ne connais pas ce réglage. Ceux que je peux changer : ${Object.entries(SETTINGS).map(([k, r]) => `${r.label} [${k}]`).join(', ')}. Le reste se règle dans Réglages.`;
        const v = parseValue(t.r, i.valeur);
        if (typeof v === 'object') return v.error;
        const d = deps(), before = t.r.get(d.cfg);
        if (before === v) return `« ${t.r.label} » est déjà sur ${shown(t.r, v)}.`;
        t.r.set(d, v);
        return `✓ ${t.r.label} : ${shown(t.r, before)} → ${shown(t.r, v)}. ${t.r.help}`;
      },
    },
  ];
}
