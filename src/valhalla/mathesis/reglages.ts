// Mathésis — les réglages : UN interrupteur qui arrête tout, la pause immédiate, la vitesse (budgets par jour), les
// heures permises et les bornes du robot. Défaut décidé par le propriétaire (17/11/2026) : Mathésis démarre dès
// qu'Odin est lancé, « allumé, vitesse douce » ; le travail LÉGER (recherches, pages, dossiers ouverts) est permis toute
// la journée sous la garde « occupé » (il s'arrête dès qu'Odin doit répondre) ; le travail LOURD (vidéos, gros fichiers)
// reste réservé à la nuit (22 h → 7 h). Il coupe tout d'un clic (`actif: false`).
import { isAbsolute } from 'node:path';
import type { Budgets, BornesRobot, Plage, RaisonArret, Reglages, Vitesse } from './types.ts';

/** Les budgets par jour de chaque vitesse. Les appels à un modèle payant restent à 0 quelle que soit la vitesse. */
export const VITESSES: Record<Vitesse, Budgets> = {
  douce: { recherches: 20, pages: 100, octets: 50 * 1024 * 1024, minutesVideo: 30, appelsPayants: 0, fichiers: 200, octetsFichiers: 200 * 1024 * 1024 },
  normale: { recherches: 60, pages: 400, octets: 200 * 1024 * 1024, minutesVideo: 120, appelsPayants: 0, fichiers: 1000, octetsFichiers: 1024 * 1024 * 1024 },
  soutenue: { recherches: 200, pages: 1500, octets: 1024 * 1024 * 1024, minutesVideo: 480, appelsPayants: 0, fichiers: 5000, octetsFichiers: 5 * 1024 * 1024 * 1024 },
};

/** Les plafonds que même un réglage ne peut pas dépasser (protection contre une valeur folle). */
export const PLAFONDS: Budgets = { recherches: 2000, pages: 20_000, octets: 10 * 1024 * 1024 * 1024, minutesVideo: 2000, appelsPayants: 1000, fichiers: 50_000, octetsFichiers: 50 * 1024 * 1024 * 1024 };

export const BORNES_ROBOT: BornesRobot = {
  delaiSiteMs: 10_000, pagesParSiteJour: 30, profondeurMax: 2, tailleMaxPage: 2 * 1024 * 1024,
  delaiDemandeMs: 15_000, redirectionsMax: 3, liensParPage: 40, pagesParManque: 6,
};
/** Les limites dures des bornes du robot (un réglage est ramené dedans). */
const LIMITES_ROBOT: Record<keyof BornesRobot, [number, number]> = {
  delaiSiteMs: [2_000, 600_000], pagesParSiteJour: [1, 500], profondeurMax: [0, 4], tailleMaxPage: [16 * 1024, 10 * 1024 * 1024],
  delaiDemandeMs: [1_000, 60_000], redirectionsMax: [0, 5], liensParPage: [0, 200], pagesParManque: [1, 50],
};

/** Travail léger : toute la journée. */
export const HEURES_DEFAUT: Plage[] = [{ de: 0, a: 24 }];
/** Travail lourd : la nuit. */
export const HEURES_LOURD_DEFAUT: Plage[] = [{ de: 22, a: 7 }];
/** Au plus 50 dossiers ouverts. */
export const DOSSIERS_MAX = 50;

export function reglagesParDefaut(): Reglages {
  return {
    actif: true, pause: false, vitesse: 'douce', budgets: { ...VITESSES.douce }, heures: HEURES_DEFAUT.map((p) => ({ ...p })),
    heuresLourd: HEURES_LOURD_DEFAUT.map((p) => ({ ...p })), dossiers: [],
    robot: { ...BORNES_ROBOT }, modeleEnLigne: false, nePasGarder: false,
  };
}

/** Des plages d'heures sûres (8 au plus, bornées 0–24) ; une valeur illisible garde le défaut. */
function plages(x: unknown, defaut: Plage[]): Plage[] {
  if (!Array.isArray(x)) return defaut.map((p) => ({ ...p }));
  return x.slice(0, 8).map((p) => ({ de: borne((p as Plage)?.de, 0, 24, 0), a: borne((p as Plage)?.a, 0, 24, 0) })).filter((p) => p.de !== p.a || p.de === 0);
}

/** Les dossiers ouverts : chemins absolus seulement, sans doublon, 50 au plus. */
export function dossiersSurs(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.map((d) => String(d ?? '').trim()).filter((d) => d.length > 0 && d.length <= 1000 && isAbsolute(d) && !d.includes('\0')))].slice(0, DOSSIERS_MAX);
}

/** La part de la journée couverte par des plages (en minutes, 0–1440). Sert à savoir si on ÉLARGIT les heures. */
export function minutesCouvertes(p: Plage[]): Set<number> {
  const s = new Set<number>();
  for (let m = 0; m < 1440; m += 15) if (dansLesHeures(p, new Date(2026, 0, 1, Math.floor(m / 60), m % 60).getTime())) s.add(m);
  return s;
}
/** Les nouvelles plages permettent-elles un moment que les anciennes refusaient ? */
export const elargit = (avant: Plage[], apres: Plage[]): boolean => { const a = minutesCouvertes(avant); return [...minutesCouvertes(apres)].some((m) => !a.has(m)); };

const borne = (x: unknown, min: number, max: number, defaut: number): number => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : defaut;
};

/**
 * Ramène n'importe quelle valeur (réglage enregistré, formulaire) à des réglages sûrs et bornés. Ce qui manque prend
 * le défaut ; un budget d'appels payants n'est accepté que si `modeleEnLigne` est explicitement vrai.
 */
export function normaliserReglages(x: unknown): Reglages {
  const d = reglagesParDefaut();
  if (!x || typeof x !== 'object') return d;
  const r = x as Partial<Reglages> & Record<string, unknown>;
  const vitesse: Vitesse = r.vitesse === 'normale' || r.vitesse === 'soutenue' || r.vitesse === 'douce' ? r.vitesse : d.vitesse;
  const base = VITESSES[vitesse];
  const b = (r.budgets ?? {}) as Partial<Budgets>;
  const modeleEnLigne = r.modeleEnLigne === true;
  const budgets: Budgets = {
    recherches: borne(b.recherches, 0, PLAFONDS.recherches, base.recherches),
    pages: borne(b.pages, 0, PLAFONDS.pages, base.pages),
    octets: borne(b.octets, 0, PLAFONDS.octets, base.octets),
    minutesVideo: borne(b.minutesVideo, 0, PLAFONDS.minutesVideo, base.minutesVideo),
    appelsPayants: modeleEnLigne ? borne(b.appelsPayants, 0, PLAFONDS.appelsPayants, 0) : 0,
    fichiers: borne(b.fichiers, 0, PLAFONDS.fichiers, base.fichiers),
    octetsFichiers: borne(b.octetsFichiers, 0, PLAFONDS.octetsFichiers, base.octetsFichiers),
  };
  const heures = plages(r.heures, d.heures);
  const heuresLourd = plages(r.heuresLourd, d.heuresLourd);
  const ro = (r.robot ?? {}) as Partial<BornesRobot>;
  const robot = { ...d.robot };
  for (const k of Object.keys(LIMITES_ROBOT) as Array<keyof BornesRobot>) robot[k] = borne(ro[k], LIMITES_ROBOT[k][0], LIMITES_ROBOT[k][1], d.robot[k]);
  return {
    actif: r.actif !== false, pause: r.pause === true, vitesse, budgets, heures, heuresLourd, dossiers: dossiersSurs(r.dossiers), robot,
    modeleEnLigne, nePasGarder: r.nePasGarder === true,
  };
}

/** L'heure locale est-elle dans une plage permise ? Une plage {0, 0} ou {0, 24} = toute la journée. */
export function dansLesHeures(heures: Plage[], maintenant: number): boolean {
  if (!heures.length) return false;
  const d = new Date(maintenant);
  const h = d.getHours() + d.getMinutes() / 60;
  return heures.some((p) => {
    if ((p.de === 0 && p.a === 0) || (p.de === 0 && p.a === 24)) return true;
    return p.de < p.a ? h >= p.de && h < p.a : h >= p.de || h < p.a;
  });
}

/** Ce que la garde consulte, à CHAQUE unité de travail (recherche, demande de page). */
export interface EtatGarde {
  reglages: Reglages;
  maintenant: number;
  /** Odin doit répondre (ou la machine est prise) : on s'arrête aussitôt. */
  occupe?: () => boolean;
  signal?: AbortSignal;
  /** Mode privé de la mémoire : rien n'est gardé, donc rien n'est cherché. */
  prive?: () => boolean;
  /** Travail LOURD (vidéos, gros fichiers) : ses propres heures (la nuit par défaut), en plus de celles du travail léger. */
  lourd?: boolean;
}

/** Peut-on travailler maintenant ? Rend la raison d'arrêt, ou undefined. Une erreur des sondes vaut « arrêt ». */
export function garde(e: EtatGarde): RaisonArret | undefined {
  if (!e.reglages.actif) return 'eteint';
  if (e.reglages.pause) return 'pause';
  if (e.signal?.aborted) return 'abandon';
  try { if (e.occupe?.()) return 'occupe'; } catch { return 'occupe'; }
  try { if (e.prive?.()) return 'prive'; } catch { return 'prive'; }
  if (!dansLesHeures(e.reglages.heures, e.maintenant)) return 'hors_heures';
  if (e.lourd && !dansLesHeures(e.reglages.heuresLourd, e.maintenant)) return 'hors_heures';
  return undefined;
}

export const PHRASES_ARRET: Record<RaisonArret, string> = {
  eteint: 'l\'interrupteur est éteint : aucune recherche, aucun robot',
  pause: 'en pause (reprise à la demande)',
  hors_heures: 'hors des heures permises',
  occupe: 'Odin doit répondre : le travail s\'arrête aussitôt',
  abandon: 'travail abandonné',
  prive: 'mode privé : rien n\'est gardé, donc rien n\'est cherché',
  budget: 'budget du jour atteint',
};

/** Un modèle payant ou en ligne peut-il être appelé ? Jamais sans réglage explicite ET budget du jour restant. */
export function appelPayantPermis(r: Reglages, restant: number): boolean {
  return r.modeleEnLigne === true && r.budgets.appelsPayants > 0 && restant > 0;
}
