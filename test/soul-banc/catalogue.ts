// Banc de Soul : le catalogue RÉEL des applis d'Odin et de leurs actions, lu dans le registre du produit
// (allModules de src/valhalla/odin.ts, sur un Odin vide dans un dossier jetable : aucune donnée de qui que ce soit).
//
// Il sert à trois choses :
//   1. vérifier qu'un jeu de mesure ne vise que des applis et des actions qui existent ;
//   2. donner la liste des 75 applis au relevé « par appli » (une appli sans demande y figure avec 0) ;
//   3. expliquer l'écart entre le nombre d'actions du guide (toutes les actions de toutes les applis) et le nombre de
//      couples appli·action que l'apprentissage de Soul voit vraiment (voir `couverture`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ActionCatalogue { id: string; label: string; what: string; words: string[]; read: boolean }
export interface AppliCatalogue { id: string; name: string; family: string; what: string; words: string[]; from: string[]; actions: ActionCatalogue[] }
export interface Catalogue { applis: AppliCatalogue[]; parId: Map<string, AppliCatalogue>; actions: number }

/** Un dossier d'Odin jetable pour le banc (jamais le vrai dossier du propriétaire). */
export function dossierJetable(prefixe = 'odin-soul-banc-'): { home: string; fin: () => void } {
  const home = mkdtempSync(join(tmpdir(), prefixe));
  return { home, fin: () => { try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* dossier temporaire : tant pis */ } } };
}

/** Prépare l'environnement du banc AVANT tout import du produit : dossier jetable, aucune installation, mode essai. */
export function environnementBanc(home: string): void {
  process.env.ODIN_HOME = home;
  process.env.ODIN_CLE_DIR = join(home, 'cles');
  process.env.ODIN_ESSAI = '1';
  process.env.ODIN_NO_VOICE_INSTALL = '1';
}

/** Les modules du produit (objets complets), sur un Odin vide. */
export async function modulesDuProduit(home: string): Promise<import('../../src/valhalla/types.ts').Module[]> {
  const { allModules } = await import('../../src/valhalla/odin.ts');
  return allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never);
}

/** Le catalogue (données seules) tiré des modules. */
export function catalogueDe(mods: Array<import('../../src/valhalla/types.ts').Module>): Catalogue {
  const applis = mods.map((m) => ({
    id: m.id, name: m.name, family: String(m.family ?? ''), what: String(m.what ?? ''), words: [...(m.words ?? [])].map(String), from: [...(m.from ?? [])].map(String),
    actions: m.actions.map((a) => ({ id: a.id, label: a.label, what: String(a.what ?? ''), words: [...(a.words ?? [])].map(String), read: Boolean(a.read) })),
  }));
  return { applis, parId: new Map(applis.map((a) => [a.id, a])), actions: applis.reduce((s, a) => s + a.actions.length, 0) };
}

export async function lireCatalogue(home: string): Promise<Catalogue> { return catalogueDe(await modulesDuProduit(home)); }

/** L'appli et l'action existent-elles ? (« aucune » / null : hors du champ d'Odin, toujours accepté.) */
export function existe(c: Catalogue, appli: string | null, action: string | null): { appli: boolean; action: boolean } {
  if (appli === null || appli === 'aucune') return { appli: true, action: true };
  const a = c.parId.get(appli);
  return { appli: Boolean(a), action: action === null ? true : Boolean(a?.actions.some((x) => x.id === action)) };
}

/**
 * D'où viennent les couples appli·action que Soul apprend, comparés aux actions du catalogue.
 * La règle copiée ici est celle de fabriquerDepart (src/brain/nous/corpus-depart.ts) : une paire « demande → action »
 * n'est écrite que pour un mot de l'action (les 6 premiers, d'au moins 4 caractères) ; s'y ajoutent DEMANDES_EXEMPLES ;
 * puis le corpus v2 (src/brain/nous/demandes-v2.ts).
 */
export async function couverture(c: Catalogue): Promise<{ actions: number; avecMots: number; sansMots: number; parMots: number; plusExemples: number; plusV2: number; v2Seul: number; applisSansPaire: string[] }> {
  const { DEMANDES_EXEMPLES } = await import('../../src/brain/nous/corpus-depart.ts');
  const { DEMANDES_V2 } = await import('../../src/brain/nous/demandes-v2.ts');
  const vus = new Set<string>();
  let avecMots = 0;
  for (const m of c.applis) for (const a of m.actions) {
    if (a.words.length) avecMots++;
    if (a.words.slice(0, 6).some((w) => w.trim().length >= 4)) vus.add(`${m.id}.${a.id}`);
  }
  const parMots = vus.size;
  const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const ex of DEMANDES_EXEMPLES) {
    const m = c.parId.get(ex.module), a = m?.actions.find((x) => ex.action.test(x.id) || ex.action.test(sansAccent(x.label)));
    if (m && a) vus.add(`${m.id}.${a.id}`);
  }
  const plusExemples = vus.size;
  const v2 = new Set(DEMANDES_V2.filter((d) => d.module !== 'aucune' && existe(c, d.module, d.action).action).map((d) => `${d.module}.${d.action}`));
  for (const k of v2) vus.add(k);
  const applisSansPaire = c.applis.filter((m) => !m.actions.some((a) => vus.has(`${m.id}.${a.id}`))).map((m) => m.id);
  return { actions: c.actions, avecMots, sansMots: c.actions - avecMots, parMots, plusExemples, plusV2: vus.size, v2Seul: v2.size, applisSansPaire };
}
