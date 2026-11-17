// Plugins des compétences : les adaptateurs vers Odin (compétences, Muninn, Cerveau, Soul, connecteurs MCP).
// Lecture seule, sauf constats.json (la récolte des traces). Rien ici ne crée de client MCP, n'écrit les réglages
// de l'Interprète ni ne lance de connexion : tout passe par l'appli elle-même.

import { basename } from 'node:path';
import type { Odin } from '../runtime.ts';
import type { McpServerConf } from '../valhalla/mcp.ts';
import type { Module, ModCtx } from '../valhalla/types.ts';
import { brainOf } from '../tools/brain.ts';
import { decrireConnecteur, indexerNote, recolter } from './graphe.ts';
import { ecrireConstats, lireConstats, lirePlugins } from './magasin.ts';
import type { Connecteur, IndexNote, SourcesEtat } from './types.ts';

export type OdinPlugins = Pick<Odin, 'paths' | 'skills' | 'muninn' | 'tools' | 'cfg'>;
/** Ce dont on a besoin de Valhalla (le vrai, ou celui d'un essai). */
export interface ValhallaLike {
  modules(): Module[];
  ctx(id: string): ModCtx;
  action(moduleId: string, actionId: string): { m: Module; a: Module['actions'][number] } | undefined;
  act(moduleId: string, actionId: string, input?: Record<string, unknown>): Promise<{ ok?: boolean; text: string }>;
}

const MAX_NOTES = 5000, MAX_CAR_NOTE = 20_000, CACHE_MS = 60_000, RECOLTE_MS = 30_000;
const cacheBrain = new Map<string, { at: number; notes: IndexNote[]; titres: Set<string> }>();
const cacheSoul = new Map<string, { at: number; v: SourcesEtat['soul'] }>();
const derniereRecolte = new Map<string, number>();

/** L'Interprète, s'il fait partie des applis démarrées. */
export const interprete = (v: ValhallaLike | undefined): Module | undefined => v?.modules().find((m) => m.id === 'ratatoskr');
/** Les connecteurs tels que réglés dans l'Interprète (lecture seule). */
export const confsMcp = (v: ValhallaLike | undefined): McpServerConf[] => {
  if (!interprete(v)) return [];
  const l = v!.ctx('ratatoskr').settings.servers;
  return Array.isArray(l) ? (l as McpServerConf[]).filter((c) => c && typeof c.name === 'string') : [];
};

/** Les connecteurs décrits pour la page ; undefined si les applis ne sont pas démarrées. */
export async function lireConnecteurs(v: ValhallaLike | undefined, odin: OdinPlugins): Promise<Connecteur[] | undefined> {
  const m = interprete(v); if (!m) return undefined;
  let vue: unknown;
  try { vue = await m.view(v!.ctx('ratatoskr'), new URLSearchParams()); } catch { vue = undefined; }
  const outils = odin.tools.all(), confs = confsMcp(v), tous = confs.map((c) => c.name);
  return confs.map((c) => decrireConnecteur(c, vue, outils, process.env, { tous, lectureDeclaree: lectureDeclaree(v, c.name) }));
}

/**
 * Vrai si le serveur déclare l'outil en lecture seule. On le demande à l'action « appeler » de l'Interprète, la règle
 * même qu'Odin applique : elle ne rend « rien de grave » que pour readOnlyHint === true (et sans destructiveHint).
 * Serveur non connecté, outil inconnu : faux (« non déclaré », traité comme pouvant modifier).
 */
function lectureDeclaree(v: ValhallaLike | undefined, serveur: string): (outilOdin: string) => boolean {
  const f = v?.action('ratatoskr', 'appeler');
  if (!f?.a.grave) return () => false;
  const ctx = v!.ctx('ratatoskr');
  return (outil) => f.a.grave!({ serveur, outil }, ctx) === undefined;
}

/** Les notes du Cerveau, réduites à leurs liens et mots (au plus 5 000 notes de 20 000 caractères), gardées 60 s. */
function lireNotes(odin: OdinPlugins, maintenant: number): { notes: IndexNote[]; titres: Set<string> } {
  const cle = odin.paths.home, c = cacheBrain.get(cle);
  if (c && maintenant - c.at < CACHE_MS) return c;
  let notes: IndexNote[] = []; const titres = new Set<string>();
  try {
    const toutes = brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace }).all().slice(0, MAX_NOTES);
    notes = toutes.map((n) => indexerNote(String(n.body ?? '').slice(0, MAX_CAR_NOTE)));
    for (const n of toutes) { titres.add(String(n.title ?? '').trim().toLowerCase()); titres.add(basename(String(n.path ?? ''), '.md').trim().toLowerCase()); }
    titres.delete('');
  } catch { notes = []; }
  const r = { at: maintenant, notes, titres };
  cacheBrain.set(cle, r);
  return r;
}

/** Le nom qu'a sur le disque la source des compétences dans le corpus de Soul (nom de tranche nettoyé : « odin-competences »). */
export async function sourceSoulCompetences(): Promise<string> {
  const { nomTranche } = await import('../brain/nous/corpus.ts') as { nomTranche: (jour: string, source: string) => string };
  return nomTranche('', 'odin:competences').replace(/^tranche--/, '').replace(/\.bin$/, '');
}

/** Soul (Noûs) : combien d'extraits venus des compétences sont dans son corpus. Import dynamique, gardé 60 s. */
export async function lireSoul(home: string, maintenant: number): Promise<SourcesEtat['soul']> {
  const c = cacheSoul.get(home);
  if (c && maintenant - c.at < CACHE_MS) return c.v;
  let v: SourcesEtat['soul'];
  try {
    const mod = await import('../brain/nous/file-odin.ts') as { etatCorpus?: (h: string) => { parSource: Array<{ source: string; n: number }> } };
    if (typeof mod.etatCorpus !== 'function') throw new Error('etatCorpus absent');
    const source = await sourceSoulCompetences();
    v = { etat: 'connu', extraitsCompetences: mod.etatCorpus(home).parSource.find((x) => x.source === source)?.n ?? 0 };
  } catch { v = { etat: 'inconnu', extraitsCompetences: 0 }; }
  cacheSoul.set(home, { at: maintenant, v });
  return v;
}

/** Récolte les traces des tours (au plus une fois toutes les 30 s) et range les constats. */
export function recolterTraces(odin: OdinPlugins, connecteurs: string[], maintenant: number, forcer = false): void {
  const cle = odin.paths.home, d = derniereRecolte.get(cle);
  if (!forcer && d !== undefined && maintenant - d < RECOLTE_MS) return;
  derniereRecolte.set(cle, maintenant);
  const { constats, abime } = lireConstats(odin.paths.home);
  const r = recolter(constats, odin.muninn.kvPrefix('trace:'), connecteurs);
  if (r.change || abime) ecrireConstats(odin.paths.home, r.constats, abime);
}

/** Toutes les données déjà lues, prêtes pour construireEtat. */
export async function lireSources(odin: OdinPlugins, v: ValhallaLike | undefined, maintenant: number): Promise<SourcesEtat> {
  const connecteurs = await lireConnecteurs(v, odin);
  try { recolterTraces(odin, (connecteurs ?? []).map((c) => c.nom), maintenant); } catch (e) { console.error('plugins : récolte des traces impossible', (e as Error).message); }
  const { fichier, abime } = lirePlugins(odin.paths.home);
  const brain = lireNotes(odin, maintenant);
  return {
    competences: odin.skills.list().map((s) => ({ nom: s.name, description: s.description, body: s.body })),
    brouillons: odin.skills.drafts().length,
    stats: odin.muninn.skillStats().map((s) => ({ name: s.name, uses: s.uses })),
    connecteurs,
    fichier,
    abime,
    constats: lireConstats(odin.paths.home).constats,
    notes: brain.notes,
    titresNotes: brain.titres,
    soul: await lireSoul(odin.paths.home, maintenant),
  };
}

/** Pour les essais : oublie les caches (Cerveau, Soul, dernière récolte). */
export function oublierCaches(): void { cacheBrain.clear(); cacheSoul.clear(); derniereRecolte.clear(); }
