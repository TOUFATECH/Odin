// Fluidité de l'interface, mesurée dans un vrai navigateur : temps d'ouverture d'un écran, décalages de mise en
// page, tâches longues, page qui se redessine toute seule (clignotement, défilement perdu), animations qui
// tournent malgré « réduire les animations ». Le code qui tourne dans la page est dans `fluidite-page.js`.
//
//   await poserSonde(context);                       // avant d'ouvrir la page (ou poserSondeIci(page) après)
//   const m = await marquer(page, '#v-app');         // juste avant d'ouvrir un écran
//   … ouvrir l'écran …
//   const f = await ouverture(page, m);              // { ms, expire, decalage, sources, longues, longueMax }

import { readFileSync } from 'node:fs';
import type { PageQ } from './debordements.ts';

export const SONDE_JS: string = readFileSync(new URL('./fluidite-page.js', import.meta.url), 'utf8').trim().replace(/;$/, '');
export interface Marque { t: number; cls: number; longs: number }
export interface Ouverture { /** temps jusqu'au dernier changement de la page, requêtes finies (ms) */ ms: number; /** vrai si la page bougeait encore à la fin de l'attente */ expire: boolean; /** somme des décalages de mise en page (0 = rien ne saute ; au-delà de 0,1 ça se voit) */ decalage: number; decalages: number; sources: string[]; longues: number; longueMax: number; longuesTotal: number }
export interface Animation { nom: string; sel: string; infinie: boolean; duree: number; props: string[]; visible: boolean; bouge: boolean }
export interface Redessin { redessins: number; retires: number; ajoutes: number; images: number; vides: number; sauts: number; hauteur: number; hauteurMin: number; elements: number; champPerdu: boolean | null; voletReferme: boolean | null; defilementPerdu: boolean | null; interneRemis: boolean | null; focusPerdu: boolean | null }

/** Pose la sonde sur toutes les pages à venir du contexte (avant leur chargement : rien n'est manqué). */
export async function poserSonde(contexte: { addInitScript(js: string): Promise<void> }): Promise<void> { await contexte.addInitScript(`(${SONDE_JS});`); }
/** Pose la sonde sur une page déjà ouverte. */
export async function poserSondeIci(page: PageQ): Promise<void> { await page.evaluate(`void (${SONDE_JS})`); }
/** Point de départ d'une mesure. `racine` : ne compter que les changements sous cet élément. */
export async function marquer(page: PageQ, racine = ''): Promise<Marque> { return page.evaluate<Marque>(`(${SONDE_JS}).marquer(${JSON.stringify(racine)})`); }
/** Attend que l'écran soit stable et rend ses mesures depuis le point de départ. */
export async function ouverture(page: PageQ, m: Marque, o: { calme?: number; max?: number } = {}): Promise<Ouverture> {
  return page.evaluate<Ouverture>(`(async () => { const F = (${SONDE_JS}); const s = await F.stable(${o.calme ?? 350}, ${o.max ?? 12000}); return Object.assign(s, F.depuis(${JSON.stringify(m)})); })()`);
}
/** Les animations en cours dans la page. */
export async function animations(page: PageQ): Promise<Animation[]> { return page.evaluate<Animation[]>(`(${SONDE_JS}).animations()`); }
/** Ce qui change de place tout seul pendant `ms` millisecondes. */
export async function bougent(page: PageQ, ms = 1500): Promise<Array<{ sel: string; px: number }>> { return page.evaluate(`(${SONDE_JS}).bougent(${ms})`); }
/** Regarde une zone se redessiner toute seule pendant `ms` millisecondes (témoins posés avant : champ rempli, volet ouvert, défilement, focus). */
export async function redessin(page: PageQ, racine: string, ms: number): Promise<Redessin | null> { return page.evaluate<Redessin | null>(`(${SONDE_JS}).redessin(${JSON.stringify(racine)}, ${ms})`); }

/** Ce qu'un redessin fait perdre à l'utilisateur, en clair (liste vide : rien). */
export function pertes(r: Redessin): string[] {
  return [r.vides ? `la page se vide pendant ${r.vides} image(s) : elle clignote` : '', r.sauts ? `sa hauteur chute ${r.sauts} fois : le contenu saute` : '', r.defilementPerdu ? 'le défilement revient en haut' : '', r.interneRemis ? 'une zone défilante (journal) revient en haut' : '', r.champPerdu ? 'ce qui est tapé dans un champ est effacé' : '', r.voletReferme ? 'un volet ouvert se referme' : '', r.focusPerdu ? 'le focus au clavier est perdu' : ''].filter(Boolean);
}
