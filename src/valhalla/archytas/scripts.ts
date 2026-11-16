// Archytas — le moteur des scripts d'Odin (l'inventeur de la colombe mécanique : le premier automate).
// Odin fabrique des scripts (des suites d'actions de ses applis, avec conditions, variables et déclencheurs),
// les garde, les lance, les suit et les améliore. Ce fichier est LE CONTRAT (types + interface du moteur) :
// le reste du dossier l'implémente, les routes et la page le consomment, les essais le vérifient.
//
// SÉCURITÉ — le vrai garde-fou n'est pas node:vm, c'est la porte d'action d'Odin. Un script n'atteint les
// applis QUE par le pont `Appeler`, qui route vers v.act(module, action, entree, { auto: true, by:
// 'automatisation' }) : une action grave est alors refusée (service.ts), et on hérite de la note des manips,
// de l'annulation et du niveau d'autonomie Heimdall. On ne remet JAMAIS ctx.call ni un ModCtx à un script.

import { interpreter } from './moteur-declaratif.ts';
import { construireGraphe, construireSuivi, majStat } from './usage.ts';
import { porteQualite } from './amelioration.ts';
import { masquer } from './liens.ts';

// ---------------------------------------------------------------------------------------------------------
// §1 — Les types rangés (le contrat partagé avec les routes, la page et le faux moteur des essais).
// ---------------------------------------------------------------------------------------------------------

/** Ce qui lance un script : à la main, à l'heure (Talos), ou sur un événement d'une appli. */
export type Declencheur =
  | { genre: 'manuel' }
  | { genre: 'horaire'; rythme: string }
  | { genre: 'evenement'; module: string; type: string };

/** Une étape d'un script déclaratif : une action d'appli, une condition, ou poser une variable. */
export type Etape =
  | { faire: 'action'; module: string; action: string; entree?: Record<string, unknown> }
  | { faire: 'si'; cond: string; alors: Etape[]; sinon?: Etape[] }
  | { faire: 'poser'; variable: string; valeur: string };

/** Déclaratif : une donnée interprétée, aucun code exécuté (aucune surface d'évasion). Code : du JS libre, isolé. */
export type Genre = 'declaratif' | 'code';

/** Ce qu'on donne pour créer un script (ou une partie, pour l'éditer). */
export interface EntreeScript {
  nom: string;
  mission: string;
  description: string;
  genre: Genre;
  etapes?: Etape[];
  code?: string;
  declencheurs: Declencheur[];
}

/** Les mesures d'usage d'un script. */
export interface Stat { runs: number; ok: number; echecs: number; msMoyen: number; dernier?: number }

/** Une version gardée d'un script (jamais le code en clair ici : seulement de quoi s'y retrouver). */
export interface Version { version: number; change: string; at: number }

/** Le résumé d'un script (liste, suivi, graphe) : JAMAIS son code ni ses étapes ni un secret. */
export interface ScriptResume {
  nom: string;
  mission: string;
  description: string;
  genre: Genre;
  version: number;
  actif: boolean;
  cree: number;
  modifie: number;
  dernierUsage?: number;
  declencheurs: Declencheur[];
  stat: Stat;
  capacites: string[];
}

/** Le détail d'un script (propriétaire seul) : le résumé plus ses étapes et son code. */
export interface ScriptDetail extends ScriptResume { etapes?: Etape[]; code?: string }

/** Un point du graphe des scripts (id = nom ; compatible avec le graphe d'Odin). */
export interface NoeudScript { id: string; label: string; sub: string; usage: number; frais: number; size?: number; color?: string }

/** Une proposition d'amélioration (jamais le code en clair hors du propriétaire). */
export interface Proposition { nom: string; pourquoi: string; apercuChange: string }

/** Le suivi : quels scripts sont les plus utilisés, les plus récents, les plus anciens, jamais servis. */
export interface Suivi { plusUtilises: ScriptResume[]; recents: ScriptResume[]; anciens: ScriptResume[]; jamais: ScriptResume[] }

/** Le résultat d'une exécution (ou d'un appel d'appli). */
export interface Resultat { ok: boolean; texte: string; ms?: number }

/** Le graphe complet (points + liens), rendu par le moteur. */
export interface Graphe { nodes: NoeudScript[]; edges: Array<[string, string]> }

// ---------------------------------------------------------------------------------------------------------
// §2 — L'interface du moteur (lot A exporte, le faux moteur des essais l'implémente, les routes la montent).
// ---------------------------------------------------------------------------------------------------------

export interface MoteurArchytas {
  lister(): Promise<ScriptResume[]>;
  voir(nom: string): Promise<ScriptDetail | undefined>;
  creer(e: EntreeScript): Promise<ScriptResume>;
  editer(nom: string, patch: Partial<EntreeScript>): Promise<ScriptResume>;
  supprimer(nom: string): Promise<void>;
  lancer(nom: string, entree?: Record<string, unknown>): Promise<Resultat>;
  versions(nom: string): Promise<Version[]>;
  revenir(nom: string, version: number): Promise<ScriptResume>;
  proposerAmelioration(nom: string): Promise<Proposition | undefined>;
  appliquerAmelioration(nom: string, accord?: boolean): Promise<ScriptResume>;
  graphe(): Promise<Graphe>;
  suivi(): Promise<Suivi>;
}

// ---------------------------------------------------------------------------------------------------------
// §3 — Les petites interfaces que les autres fichiers implémentent (gardées ici pour éviter les boucles
//      d'import : scripts.ts est le seul point de vérité des types).
// ---------------------------------------------------------------------------------------------------------

/** Le pont unique vers les applis : routé vers v.act({ auto:true, by:'automatisation' }) en liste blanche. */
export type Appeler = (module: string, action: string, entree?: Record<string, unknown>) => Promise<Resultat>;

/** Un script tel qu'il est rangé (version courante). Le code est chiffré au repos par l'entrepôt. */
export interface RangScript {
  nom: string;
  mission: string;
  description: string;
  genre: Genre;
  etapes?: Etape[];
  code?: string;
  declencheurs: Declencheur[];
  capacites: string[];
  cree: number;
  modifie: number;
  dernierUsage?: number;
  version: number;
  actif: boolean;
  stat: Stat;
}

/** Une version rangée (instantané du comportement : étapes et/ou code, plus la note de changement). */
export interface VersionRangee { version: number; change: string; at: number; etapes?: Etape[]; code?: string }

/** Une exécution notée (pour le suivi, le graphe et l'amélioration). L'erreur est déjà masquée. */
export interface ExecutionRangee { nom: string; version: number; at: number; ok: boolean; ms: number; erreurMasquee?: string }

/**
 * L'entrepôt des scripts (base ARCHYTAS_ODIN, ou repli en fichiers pour les essais). Le code est TOUJOURS
 * chiffré au repos ; `lister` ne rend jamais le code ni les étapes ni un secret.
 */
export interface Entrepot {
  lister(): Promise<ScriptResume[]>;
  voir(nom: string): Promise<ScriptDetail | undefined>;
  /** le script rangé complet (code déchiffré) pour le moteur ; jamais servi au navigateur tel quel */
  lire(nom: string): Promise<RangScript | undefined>;
  poser(r: RangScript): Promise<void>;
  supprimer(nom: string): Promise<void>;
  versions(nom: string): Promise<Version[]>;
  poserVersion(nom: string, v: VersionRangee): Promise<void>;
  lireVersion(nom: string, version: number): Promise<VersionRangee | undefined>;
  noterExecution(e: ExecutionRangee): Promise<void>;
  executions(nom?: string, limit?: number): Promise<ExecutionRangee[]>;
}

/** L'exécuteur de code libre (bac à sable). Absent : le code libre est indisponible (déclaratif seul). */
export interface BacASable {
  executer(code: string, entree: Record<string, unknown>, limites: Limites, appeler: Appeler): Promise<Resultat>;
  arreter(): void;
}

/** Les bornes d'une exécution de code libre. */
export interface Limites { budgetMs: number; budgetMo: number; maxAppels: number; maxBoucles: number }

/** Le proposeur d'amélioration (raisonnement local Mímir / Noûs). Absent : pas de proposition. */
export interface Proposeur {
  proposer(detail: ScriptDetail, stat: Stat): Promise<{ pourquoi: string; apercuChange: string; etapes?: Etape[]; code?: string } | undefined>;
}

/** Le câblage « gardé de partout » (mémoire, Cerveau, Noûs). Posé par brancherArchytas ; no-op sans deps. */
export interface LienArchytas {
  enregistrer(detail: ScriptDetail): void;
  oublier(nom: string): void;
}

/** Les réglages de l'appli (lus à chaque lancement). */
export interface Reglages { codeLibre: boolean; maxWorkers: number; budgetMs: number; budgetMo: number; maxAppels: number; maxBoucles: number }

export const REGLAGES_DEFAUT: Reglages = { codeLibre: false, maxWorkers: 1, budgetMs: 2000, budgetMo: 64, maxAppels: 50, maxBoucles: 100_000 };

export interface MoteurDeps {
  entrepot: Entrepot;
  /** le pont vers les applis (v.act auto) ; par défaut un pont qui refuse tout (aucune appli jointe) */
  appeler?: Appeler;
  bac?: BacASable;
  proposeur?: Proposeur;
  lien?: LienArchytas;
  reglages?: () => Reglages;
  maintenant?: () => number;
}

// ---------------------------------------------------------------------------------------------------------
// §4 — La fabrique du moteur. Elle noue l'entrepôt, le pont vers les applis, le bac à sable, le proposeur et
//      le câblage « gardé de partout ». Toute la logique tient ici (le contrat demande scripts.ts).
// ---------------------------------------------------------------------------------------------------------

/** Un nom de script propre (mission tenue), unique parmi les caractères sûrs. */
function nomPropre(nom: unknown): string {
  const n = String(nom ?? '').trim();
  if (!n) throw new Error('Un script a besoin d\'un nom (tiré de sa mission).');
  if (n.length > 80) throw new Error('Nom de script trop long (80 caractères au plus).');
  return n;
}

export function creerMoteur(deps: MoteurDeps): MoteurArchytas {
  const e = deps.entrepot;
  const now = deps.maintenant ?? Date.now;
  const reglages = (): Reglages => deps.reglages?.() ?? REGLAGES_DEFAUT;
  // Le pont par défaut REFUSE tout : un moteur sans appeler câblé ne touche aucune appli.
  const appeler: Appeler = deps.appeler ?? (async () => ({ ok: false, texte: 'Aucune appli n\'est jointe à ce moteur.' }));

  const detailDepuisRang = (r: RangScript): ScriptDetail => ({ nom: r.nom, mission: r.mission, description: r.description, genre: r.genre, version: r.version, actif: r.actif, cree: r.cree, modifie: r.modifie, dernierUsage: r.dernierUsage, declencheurs: r.declencheurs, stat: r.stat, capacites: r.capacites, etapes: r.etapes, code: r.code });
  const resume = (r: RangScript): ScriptResume => { const { etapes: _e, code: _c, ...rest } = detailDepuisRang(r); return rest; };
  const prevenir = (r: RangScript): void => { try { deps.lien?.enregistrer(detailDepuisRang(r)); } catch { /* le câblage ne gêne jamais l'enregistrement */ } };

  function valider(ent: EntreeScript): void {
    if (ent.genre !== 'declaratif' && ent.genre !== 'code') throw new Error('Genre inconnu (déclaratif ou code).');
    if (ent.genre === 'code' && !String(ent.code ?? '').trim()) throw new Error('Un script « code » a besoin de son code.');
    if (ent.genre === 'declaratif' && ent.code) throw new Error('Un script déclaratif n\'a pas de code libre : décris-le en étapes.');
    if (!Array.isArray(ent.declencheurs)) throw new Error('Déclencheurs attendus (une liste).');
  }

  async function creer(ent: EntreeScript): Promise<ScriptResume> {
    const nom = nomPropre(ent.nom); valider(ent);
    if (await e.lire(nom)) throw new Error(`Un script « ${nom} » existe déjà.`);
    const t = now();
    const r: RangScript = {
      nom, mission: String(ent.mission ?? '').trim(), description: String(ent.description ?? '').trim(), genre: ent.genre,
      etapes: ent.genre === 'declaratif' ? (ent.etapes ?? []) : undefined, code: ent.genre === 'code' ? ent.code : undefined,
      declencheurs: ent.declencheurs, capacites: [], cree: t, modifie: t, version: 1, actif: true, stat: { runs: 0, ok: 0, echecs: 0, msMoyen: 0 },
    };
    await e.poser(r);
    await e.poserVersion(nom, { version: 1, change: 'création', at: t, etapes: r.etapes, code: r.code });
    prevenir(r);
    return resume(r);
  }

  async function editer(nom0: string, patch: Partial<EntreeScript>): Promise<ScriptResume> {
    const nom = nomPropre(nom0);
    const r = await e.lire(nom); if (!r) throw new Error(`Script introuvable : ${nom}.`);
    if (patch.nom && String(patch.nom).trim() !== nom) throw new Error('Le nom d\'un script ne se change pas ici (supprime-le et recrée-le pour le renommer).');
    const genre = patch.genre ?? r.genre;
    const etapes = genre === 'declaratif' ? (patch.etapes ?? (r.genre === 'declaratif' ? r.etapes : [])) : undefined;
    const code = genre === 'code' ? (patch.code ?? (r.genre === 'code' ? r.code : '')) : undefined;
    valider({ nom, mission: patch.mission ?? r.mission, description: patch.description ?? r.description, genre, etapes, code, declencheurs: patch.declencheurs ?? r.declencheurs });
    const t = now();
    const compte = JSON.stringify([etapes, code]) !== JSON.stringify([r.etapes, r.code]) || genre !== r.genre;
    const next: RangScript = { ...r, mission: patch.mission ?? r.mission, description: patch.description ?? r.description, genre, etapes, code, declencheurs: patch.declencheurs ?? r.declencheurs, modifie: t, version: compte ? r.version + 1 : r.version };
    await e.poser(next);
    if (compte) await e.poserVersion(nom, { version: next.version, change: 'modifié à la main', at: t, etapes, code });
    prevenir(next);
    return resume(next);
  }

  async function supprimer(nom0: string): Promise<void> {
    const nom = nomPropre(nom0);
    await e.supprimer(nom);
    try { deps.lien?.oublier(nom); } catch { /* le câblage ne gêne jamais la suppression */ }
  }

  async function lancer(nom0: string, entree?: Record<string, unknown>): Promise<Resultat> {
    const nom = nomPropre(nom0);
    const r = await e.lire(nom); if (!r) return { ok: false, texte: `Script introuvable : ${nom}.` };
    if (!r.actif) return { ok: false, texte: `Le script « ${nom} » est en pause.` };
    const g = reglages();
    const limites: Limites = { budgetMs: g.budgetMs, budgetMo: g.budgetMo, maxAppels: g.maxAppels, maxBoucles: g.maxBoucles };
    const debut = now();
    let res: Resultat;
    if (r.genre === 'code') {
      if (!g.codeLibre) res = { ok: false, texte: 'Le code libre est désactivé (déclaratif seul). Active-le dans les réglages d\'Archytas, pour du code que TU as relu.' };
      else if (!deps.bac) res = { ok: false, texte: 'Le bac à sable du code libre n\'est pas disponible ici.' };
      else res = await deps.bac.executer(r.code ?? '', entree ?? {}, limites, appeler);
    } else {
      res = await interpreter(r.etapes, appeler, { limites, entree });
    }
    const ms = res.ms ?? Math.max(0, now() - debut);
    const fin = now();
    try {
      await e.noterExecution({ nom, version: r.version, at: fin, ok: res.ok, ms, erreurMasquee: res.ok ? undefined : masquer(res.texte).slice(0, 200) });
      const next: RangScript = { ...r, dernierUsage: fin, stat: majStat(r.stat, res.ok, ms, fin) };
      await e.poser(next);
      prevenir(next);
    } catch { /* la mesure ne doit jamais faire échouer le lancement lui-même */ }
    return { ...res, ms };
  }

  async function revenir(nom0: string, version: number): Promise<ScriptResume> {
    const nom = nomPropre(nom0);
    const r = await e.lire(nom); if (!r) throw new Error(`Script introuvable : ${nom}.`);
    const v = await e.lireVersion(nom, version); if (!v) throw new Error(`Version ${version} introuvable pour « ${nom} ».`);
    const t = now();
    const next: RangScript = { ...r, etapes: r.genre === 'declaratif' ? (v.etapes ?? []) : undefined, code: r.genre === 'code' ? (v.code ?? r.code) : undefined, modifie: t, version: r.version + 1 };
    await e.poser(next);
    await e.poserVersion(nom, { version: next.version, change: `retour à la version ${version}`, at: t, etapes: next.etapes, code: next.code });
    prevenir(next);
    return resume(next);
  }

  async function candidatDe(nom: string): Promise<{ detail: ScriptDetail; cand: NonNullable<Awaited<ReturnType<Proposeur['proposer']>>> } | undefined> {
    if (!deps.proposeur) return undefined;
    const r = await e.lire(nom); if (!r) throw new Error(`Script introuvable : ${nom}.`);
    const detail = detailDepuisRang(r);
    const cand = await deps.proposeur.proposer(detail, r.stat);
    return cand ? { detail, cand } : undefined;
  }

  async function proposerAmelioration(nom0: string): Promise<Proposition | undefined> {
    const nom = nomPropre(nom0);
    const x = await candidatDe(nom);
    return x ? { nom, pourquoi: x.cand.pourquoi, apercuChange: x.cand.apercuChange } : undefined;
  }

  async function appliquerAmelioration(nom0: string, accord?: boolean): Promise<ScriptResume> {
    const nom = nomPropre(nom0);
    const x = await candidatDe(nom); if (!x) throw new Error(`Aucune amélioration à appliquer pour « ${nom} ».`);
    const porte = porteQualite(x.detail, x.cand, accord);
    if (!porte.ok) throw new Error(porte.raison);
    const r = await e.lire(nom); if (!r) throw new Error(`Script introuvable : ${nom}.`);
    const t = now();
    const next: RangScript = { ...r, etapes: r.genre === 'declaratif' ? (x.cand.etapes ?? r.etapes) : undefined, code: r.genre === 'code' ? (x.cand.code ?? r.code) : undefined, modifie: t, version: r.version + 1 };
    await e.poser(next);
    await e.poserVersion(nom, { version: next.version, change: `amélioration : ${x.cand.pourquoi}`.slice(0, 200), at: t, etapes: next.etapes, code: next.code });
    prevenir(next);
    return resume(next);
  }

  return {
    lister: () => e.lister(),
    voir: (nom) => e.voir(nomPropre(nom)),
    creer, editer, supprimer, lancer, revenir,
    versions: (nom) => e.versions(nomPropre(nom)),
    proposerAmelioration, appliquerAmelioration,
    graphe: async () => construireGraphe(await e.lister(), now()),
    suivi: async () => construireSuivi(await e.lister()),
  };
}
