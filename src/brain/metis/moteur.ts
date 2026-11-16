// Le moteur de génération de Métis : consomme l'amorce, échantillonne morceau par morceau, diffuse au fil de l'eau,
// s'arrête net sur demande, et MESURE la vitesse réelle (morceaux par seconde) — jamais promise.
//
// Arrêt net : le signal (AbortSignal) est vérifié à chaque morceau ET entre chaque couche de la passe avant, donc la
// génération s'arrête au plus tard au morceau en cours. Le patron « drapeau en mémoire partagée + Atomics » de Noûs
// (src/brain/nous/moteur.ts) est l'équivalent quand le calcul est déporté dans un worker ; ici la passe avant reçoit
// un modèle DÉJÀ ouvert (sa poignée de fichier vit dans ce processus), donc le calcul tourne dans ce fil avec un
// arrêt coopératif immédiat. Voir la note d'écart dans le rapport du chantier.

import type { ModeleGguf } from './types.ts';
import { creerEtat, passeAvant, type EtatMetis } from './avant.ts';
import { echantillonner } from './echantillon.ts';
import { hasard } from '../nous/hasard.ts';

export interface MetisGen {
  amorce: Int32Array;
  maxMorceaux: number;
  temperature?: number;
  topP?: number;
  penaliteRepetition?: number;
  graine?: number;
  signal?: AbortSignal;
  onDelta?(texte: string): void;
}

export interface MetisSortie {
  texte: string;
  morceaux: number;
  tempsMs: number;
  morceauxParSeconde: number;
}

/** Refus poli (message clair) si le modèle dépasse ce que la machine peut charger. octetsMax = 0 : pas de limite. */
export function refusSiTropGros(tailleOctets: number, octetsMax: number): void {
  if (octetsMax > 0 && tailleOctets > octetsMax) {
    const mo = Math.round(tailleOctets / (1024 * 1024));
    const max = Math.round(octetsMax / (1024 * 1024));
    throw new Error(`Métis : ce modèle pèse ${mo} Mo, au-delà de ce que cette machine peut charger (${max} Mo). Choisis un modèle plus petit — Métis affiche la bonne taille d'après la mesure.`);
  }
}

const aborte = (o: MetisGen): boolean => o.signal?.aborted === true;

/** Génère la suite de l'amorce. Reproductible à graine fixée. Diffuse chaque morceau par `onDelta`. */
export async function generer(modele: ModeleGguf, o: MetisGen): Promise<MetisSortie> {
  const t0 = performance.now();
  const h = hasard(o.graine ?? 0x4d33);
  const e: EtatMetis = await creerEtat(modele);
  const amo = Array.from(o.amorce, (x) => x | 0);
  const recents: number[] = [...amo];
  const eos = modele.decoupage.eos;
  const max = Math.max(0, o.maxMorceaux | 0);

  // Prélecture : on consomme toute l'amorce sauf le dernier morceau, qui amorcera la génération.
  for (let i = 0; i < amo.length - 1; i++) {
    if (aborte(o)) break;
    await passeAvant(e, amo[i]);
  }
  let courant = amo.length ? amo[amo.length - 1] : (modele.decoupage.bos >= 0 ? modele.decoupage.bos : 0);

  let texte = '';
  let morceaux = 0;
  for (let s = 0; s < max; s++) {
    if (aborte(o)) break;
    if (e.pos >= e.Tmax) break;
    const logits = await passeAvant(e, courant);
    const choisi = echantillonner(logits, recents.slice(-64), h, {
      temperature: o.temperature,
      topP: o.topP,
      penaliteRepetition: o.penaliteRepetition,
    });
    if (eos >= 0 && choisi === eos) break;
    recents.push(choisi);
    courant = choisi;
    morceaux++;
    const frag = modele.decoupage.morceau(choisi);
    texte += frag;
    if (o.onDelta) o.onDelta(frag);
    if (aborte(o)) break;
  }

  const tempsMs = performance.now() - t0;
  const morceauxParSeconde = morceaux > 0 && tempsMs > 0 ? morceaux / (tempsMs / 1000) : 0;
  return { texte, morceaux, tempsMs, morceauxParSeconde };
}
