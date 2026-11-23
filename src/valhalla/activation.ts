// Activer ou désactiver une appli d'Odin. Une appli désactivée reste visible (grisée) et se réactive d'un clic ; ses
// données sont gardées. Tant qu'elle est désactivée : elle ne démarre pas, ne surveille rien, n'envoie ni notification
// ni alerte, ne déclenche aucune automatisation, aucun lien entre applis ne l'atteint, et ni Odin ni la parole ne la
// choisissent (Odin dit qu'elle est désactivée et propose de l'activer).
//
// Réglage gardé par Odin : <home>/valhalla/applis-actives.json, écrit d'un coup.
//   { version: 1, defaut: 'active' | 'desactive', exceptions: string[] }
// - Pas de fichier (toute installation d'avant ce réglage) : TOUT est actif, rien n'est perdu à la mise à jour.
// - Installation neuve (« odin init » sur un dossier vide) : defaut 'desactive' ; on active les applis une à une.
// - Les applis indispensables au fonctionnement d'Odin sont toujours actives (jamais désactivables).
// Seul le propriétaire change ce réglage (la route web le vérifie ; un membre ou une tablette n'y arrive pas).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initHome, type OdinPaths } from '../config.ts';

/**
 * Les applis indispensables : jamais désactivables, actives même dans une installation neuve.
 * - saga (Thot), runes (Papyrus), draupnir (Talos) : le Cerveau, les bases et le moteur des automatisations, qui sont
 *   des vues d'Odin lui-même (leurs pages font partie d'Odin) ;
 * - var (Persona), agora (Agora) : les comptes, les connexions et les droits de chacun ;
 * - apparence (Aurore) : Réglages → Apparence ;
 * - forseti (Forseti), garmr (Cerbère) : la sûreté (le fil des alertes de sécurité, le bannissement de qui force
 *   l'entrée d'Odin) ;
 * - urdr (Alexandrie), brisingamen (Thésauros) : la base d'Odin (chaque appli y range sa base) et le coffre qui garde
 *   son mot de passe.
 */
export const ESSENTIELLES: readonly string[] = ['saga', 'runes', 'draupnir', 'var', 'agora', 'apparence', 'forseti', 'garmr', 'urdr', 'brisingamen'];
export const estEssentielle = (id: string): boolean => ESSENTIELLES.includes(id);

export interface EtatActivation { version: 1; defaut: 'active' | 'desactive'; exceptions: string[] }
export const fichierActivation = (home: string) => join(home, 'valhalla', 'applis-actives.json');
const TOUT_ACTIF: EtatActivation = { version: 1, defaut: 'active', exceptions: [] };
const ID = /^[a-z0-9_-]{1,40}$/;

/** Lit l'état. Absent : tout actif (installation d'avant). Illisible : tout actif aussi (rien n'est perdu), et c'est dit. */
export function lireActivation(home: string): EtatActivation {
  const f = fichierActivation(home);
  if (!existsSync(f)) return { ...TOUT_ACTIF, exceptions: [] };
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as Partial<EtatActivation>;
    if (j && (j.defaut === 'active' || j.defaut === 'desactive')) return { version: 1, defaut: j.defaut, exceptions: [...new Set((Array.isArray(j.exceptions) ? j.exceptions : []).filter((x): x is string => typeof x === 'string' && ID.test(x)))] };
  } catch { /* illisible */ }
  console.error('[applis] réglage « applis actives » illisible : toutes les applis restent actives');
  return { ...TOUT_ACTIF, exceptions: [] };
}
export function ecrireActivation(home: string, e: EtatActivation): void {
  const f = fichierActivation(home); mkdirSync(join(home, 'valhalla'), { recursive: true });
  const tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify({ version: 1, defaut: e.defaut, exceptions: [...new Set(e.exceptions)].sort() }, null, 1)); renameSync(tmp, f);
}

/** L'appli est-elle active dans cet état ? */
export function activeDans(e: EtatActivation, id: string): boolean {
  if (estEssentielle(id)) return true;
  const exc = e.exceptions.includes(id);
  return e.defaut === 'active' ? !exc : exc;
}
/** Le nouvel état après « activer » (`oui`) ou « désactiver » une appli (fonction pure). */
export function basculerDans(e: EtatActivation, id: string, oui: boolean): EtatActivation {
  const exc = new Set(e.exceptions);
  // En « tout actif », l'exception est une appli désactivée ; en « tout désactivé », une appli activée.
  if ((e.defaut === 'active') === oui) exc.delete(id); else exc.add(id);
  return { version: 1, defaut: e.defaut, exceptions: [...exc].sort() };
}

/**
 * Actives dès une installation neuve, mais désactivables (choix du propriétaire, 23/11) : l'antivirus (Asclépios) et les
 * sauvegardes (Phénix) — sinon aucune analyse ni sauvegarde tant qu'il n'y pense pas.
 */
export const ACTIVES_AU_DEPART: readonly string[] = ['ullr', 'sindri'];

/** Une installation neuve : toutes les applis désactivées sauf les indispensables et celles actives au départ. */
export function marquerInstallationNeuve(home: string): void {
  if (existsSync(fichierActivation(home))) return; // une décision existe déjà : jamais écrasée
  ecrireActivation(home, { version: 1, defaut: 'desactive', exceptions: [...ACTIVES_AU_DEPART] });
}

/**
 * « odin init » : prépare le dossier d'Odin ; s'il était vraiment neuf (ni réglages, ni base, ni applis), les applis
 * démarrent désactivées. Un Odin déjà installé (mis à jour par l'installateur, qui relance « init ») ne change pas.
 */
export function initOdin(paths: OdinPaths, init: (p: OdinPaths) => string[] = initHome): string[] {
  const neuf = !existsSync(paths.config) && !existsSync(join(paths.home, 'odin.db')) && !existsSync(join(paths.home, 'valhalla'));
  const created = init(paths);
  if (neuf && created.includes(paths.config)) { try { marquerInstallationNeuve(paths.home); } catch (e) { console.error(`[applis] installation neuve non marquée : ${(e as Error).message}`); } }
  return created;
}

/** Le texte dit quand on veut se servir d'une appli désactivée (Odin propose de l'activer). */
export const texteDesactivee = (nom: string) => `${nom} est désactivée : je ne m'en sers pas. Pour l'activer, ouvre Applis → ${nom} → « Activer ».`;
