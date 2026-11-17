// L'API de la page de Noûs (/api/brain/nous/*) : un état HONNÊTE et les réglages, branchés sur la configuration.
// Rien d'inventé : la taille réelle du corpus, « pas encore entraîné », aucun duel, la part de travail « pas encore
// mesurée » ; l'essai répond « pas encore de modèle » tant qu'aucun réseau n'a été entraîné et branché.
import { setConfigValue } from '../config.ts';
import type { Odin } from '../runtime.ts';
import { etatCorpus, fileNousOdin } from '../brain/nous/file-odin.ts';
import { CHOIX_DEPART, departFait, type ChoixDepart } from '../brain/nous/corpus-depart.ts';
import { derniersBilans } from '../brain/nous/tache-odin.ts';
import { listerReprises } from '../brain/nous/reprise.ts';
import { departInstalle } from '../brain/nous/livraison.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { piloteExistant, filsPour, PUISSANCES, type Puissance } from '../brain/nous/entrainement-odin.ts';

/** L'entraînement : l'état vivant du pilote, ou le dernier gardé sur le disque. */
function etatEntrainement(home: string, puissance: Puissance): Record<string, unknown> {
  const vivant = piloteExistant()?.etat;
  let e: Record<string, unknown> = vivant ? { ...vivant } : {};
  if (!vivant) { try { e = JSON.parse(readFileSync(join(home, 'cerveau-reseau', 'entrainement.json'), 'utf8')) as Record<string, unknown>; e.apprend = false; } catch { e = { apprend: false, pas: 0, tempsMs: 0 }; } }
  return { ...e, puissance, fils: filsPour(puissance), filsMachine: availableParallelism(), puissances: Object.entries(PUISSANCES).map(([id, texte]) => ({ id, texte, fils: filsPour(id) })) };
}

type OdinNous = Pick<Odin, 'cfg' | 'paths'> & { demo?: boolean };
const nousCfg = (odin: OdinNous) => (odin.cfg.nous ??= { actif: true, corpusDepart: 'odin', puissance: 'pleine', filsJour: 1, filsNuit: 3, heuresNuit: 8, disqueMaxMo: 2000, delaiMsN1: 250, seuilReflexe: 0.9, arbitreGrand: false, metisRaisonnement: 'regles' });

// La lecture du corpus déchiffre ses tranches : on la garde une minute (la page se recharge souvent).
let cache: { home: string; at: number; v: ReturnType<typeof etatCorpus> } | undefined;
const corpusEnCache = (home: string) => { if (!cache || cache.home !== home || Date.now() - cache.at > 60_000) cache = { home, at: Date.now(), v: etatCorpus(home) }; return cache.v; };
/** (essais) oublie le cache. */
export function oublierCacheNous(): void { cache = undefined; }

export function nousEtat(odin: OdinNous): Record<string, unknown> {
  const c = nousCfg(odin), home = odin.paths.home;
  const corpus = corpusEnCache(home);
  const reprises = (() => { try { return listerReprises(home); } catch { return []; } })();
  const depart = departFait(home, Number(c.disqueMaxMo ?? 2000));
  const choix = (c.corpusDepart ?? 'demander') as ChoixDepart;
  return {
    ok: true,
    actif: c.actif !== false,
    prive: odin.cfg.voice?.privacy?.privateMode === true,
    demo: odin.demo === true,
    entraine: reprises.length > 0,
    message: reprises.length
      ? 'Un point de reprise existe, mais Noûs n\'est pas encore branché sur les réponses (étape suivante).'
      : 'Noûs n\'a pas encore de point de reprise : il apprend dès qu\'Odin est libre, et rien n\'est mis en service tant que ce n\'est pas mieux sur le banc.',
    lu: { total: corpus.exemples, octets: corpus.octets, parSource: corpus.parSource.map((x) => ({ source: x.source, n: x.n })), enFile: fileNousOdin.taille() },
    // Le modèle de départ livré avec Odin : installé (version, date) ou pourquoi pas (dernier essai d'installation).
    modeleDepart: (() => { const d = departInstalle(home); return d ? { installe: true, version: d.version, quand: d.quand, texte: `modèle de départ v${d.version} installé le ${d.quand.slice(0, 10)}` } : { installe: false, texte: derniersBilans.installation?.raison ?? 'pas encore de modèle de départ installé' }; })(),
    depart: { choix, texte: CHOIX_DEPART[choix] ?? '', fait: depart.fait, quand: depart.quand, ...(depart.incomplet ? { incomplet: depart.incomplet } : {}), textes: depart.textes, paires: depart.paires, choix_possibles: Object.entries(CHOIX_DEPART).map(([id, texte]) => ({ id, texte })) },
    // Aucune part mesurée tant que Noûs ne répond à rien : jamais un « 80 / 20 » affiché comme une mesure.
    travail: null,
    duels: { joues: 0, gagnes: 0, egalites: 0, apres: 0 },
    // Étape 1 (pré-entraînement) : en cours dès le premier pas ; l'avancement n'a pas de fin connue, on dit les pas.
    // Étapes 2 et 3 (ajustement sur les paires, alignement par les duels) : pas encore lancées.
    // « en cours » seulement s'il apprend EN CE MOMENT ; sinon « commencée », avec la raison de l'arrêt (constat 15).
    etapes: (() => {
      const e = etatEntrainement(home, (c.puissance ?? 'pleine') as Puissance) as { pas?: number; apprend?: boolean; arret?: string };
      const p = Number(e.pas ?? 0);
      if (!(p > 0)) return null;
      const raison = c.actif === false ? 'Noûs est en pause' : e.arret;
      return { etape1: { texte: e.apprend && c.actif !== false ? `en cours (${p.toLocaleString('fr')} pas)` : `commencée (${p.toLocaleString('fr')} pas)${raison ? ` — arrêtée : ${raison}` : ' — en attente d\'un moment libre'}` } };
    })(),
    // L'oubli : ce qui est effacé de la mémoire quitte aussi le corpus de Noûs ; les poids déjà entraînés, eux, ne
    // s'effacent pas exemple par exemple (seul un retour à un point de reprise antérieur, ou un réentraînement, le fait).
    oubli: 'Effacer un souvenir le retire aussi de ce que Noûs lit (son corpus), et il n\'y revient plus. Ce que le réseau a déjà appris (ses poids, et les morceaux de son découpage) ne s\'efface pas exemple par exemple : seul un retour à un point de reprise antérieur, ou un réentraînement, le retire.',
    reglages: { heuresNuit: c.heuresNuit, filsNuit: c.filsNuit, disqueMaxMo: c.disqueMaxMo, corpusDepart: choix, puissance: c.puissance ?? 'pleine' },
    entrainement: etatEntrainement(home, (c.puissance ?? 'pleine') as Puissance),
    cout: { vidage: derniersBilans.vidage ?? null, depart: derniersBilans.depart ? { ms: derniersBilans.depart.ms, rangeMs: derniersBilans.depart.vidage?.ms ?? 0, textes: derniersBilans.depart.textes, paires: derniersBilans.depart.paires, nonResolues: derniersBilans.depart.nonResolues } : null },
  };
}

const borne = (x: unknown, min: number, max: number): number | undefined => { const n = Number(x); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : undefined; };

export function nousPost(odin: OdinNous, path: string, b: Record<string, unknown>): Record<string, unknown> | undefined {
  const c = nousCfg(odin);
  const enregistrer = (k: string, v: unknown) => { (c as Record<string, unknown>)[k] = v; try { setConfigValue(odin.paths, ['nous', k], v); } catch { /* fichier en lecture seule : le réglage vaut jusqu'au redémarrage */ } };
  switch (path) {
    case '/api/brain/nous/pause': {
      if (typeof b.actif !== 'boolean') return { ok: false, error: 'actif : vrai ou faux' };
      enregistrer('actif', b.actif);
      return { ok: true, actif: b.actif };
    }
    case '/api/brain/nous/reglages': {
      const h = borne(b.heuresNuit, 1, 12), f = borne(b.filsNuit, 1, 16), d = borne(b.disqueMaxMo, 50, 100_000);
      if (h !== undefined) enregistrer('heuresNuit', h);
      if (f !== undefined) enregistrer('filsNuit', f);
      if (d !== undefined) enregistrer('disqueMaxMo', d);
      if (b.puissance !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(PUISSANCES, String(b.puissance))) return { ok: false, error: 'puissance : douce, normale ou pleine' };
        enregistrer('puissance', String(b.puissance));
      }
      if (b.corpusDepart !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(CHOIX_DEPART, String(b.corpusDepart))) return { ok: false, error: 'corpusDepart : odin, memoire, web ou demander' };
        enregistrer('corpusDepart', String(b.corpusDepart));
      }
      return { ok: true, reglages: { heuresNuit: c.heuresNuit, filsNuit: c.filsNuit, disqueMaxMo: c.disqueMaxMo, corpusDepart: c.corpusDepart, puissance: c.puissance ?? 'pleine' } };
    }
    case '/api/brain/nous/essai':
      return listerReprises(odin.paths.home).length
        ? { ok: false, text: 'Un modèle existe (point de reprise en service), mais l\'essai depuis cette page n\'est pas encore branché : il sert pour l\'instant à la recherche par le sens.' }
        : { ok: false, text: 'Pas encore de modèle : Noûs apprend dès qu\'Odin est libre, et rien n\'est mis en service tant que ce n\'est pas mieux sur le banc.' };
    default: return undefined;
  }
}
