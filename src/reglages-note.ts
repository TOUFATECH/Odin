// Chaque enregistrement d'un réglage le signale ici (config.json, réglages.json des applis, réglages gardés dans la
// mémoire d'Odin) ; reglages-base.ts l'envoie dans la base d'Odin quand elle est branchée. Petit module sans
// dépendance : config.ts et valhalla/service.ts peuvent l'importer sans tirer toute la base.
import { resolve } from 'node:path';

/** Les réglages rangés dans la mémoire d'Odin (memoire/kv.jsonl) : réveil, discrétion, liens vivants du Cerveau, mode essai. */
export const KV_REGLAGES: readonly string[] = ['alarm', 'discretion', 'cerveau-liens-actif', 'dry-run'];

export type Ecouteur = (n: { fichier?: string; kv?: string; valeur?: string }) => void;
const ecouteurs = new Map<string, Ecouteur>();

/** (reglages-base.ts) écoute les enregistrements d'un dossier d'Odin ; rend de quoi arrêter. */
export function ecouterReglages(home: string, f: Ecouteur): () => void {
  const h = resolve(home); ecouteurs.set(h, f);
  return () => { if (ecouteurs.get(h) === f) ecouteurs.delete(h); };
}
/** Un fichier de réglages vient d'être écrit. */
export function reglageFichierEcrit(home: string, fichier: string): void {
  const f = ecouteurs.get(resolve(home)); if (!f) return;
  try { f({ fichier: resolve(fichier) }); } catch (e) { console.error(`[réglages] ${(e as Error).message}`); }
}
/** Un réglage de la mémoire d'Odin (kv) vient d'être écrit (valeur telle que gardée, champs privés chiffrés). */
export function reglageKvEcrit(home: string, cle: string, valeur: string): void {
  const f = ecouteurs.get(resolve(home)); if (!f) return;
  try { f({ kv: cle, valeur }); } catch (e) { console.error(`[réglages] ${(e as Error).message}`); }
}
