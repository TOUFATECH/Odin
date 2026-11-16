// Vénus · Odéon — le jeton de diffusion vers un écran. Quand Odin envoie un flux sur une télé de la maison (Home
// Assistant → media_player/play_media), c'est le LECTEUR (Chromecast, DLNA…) qui va chercher l'adresse du flux, tout
// seul, SANS la session du propriétaire. La route /venus/flux est réservée au propriétaire : sans jeton, le lecteur
// reçoit 401 au lieu du média. On lui donne donc un jeton à PORTÉE RESTREINTE, ajouté à l'adresse du flux :
//   - il ne vaut QUE pour CETTE cible (le média envoyé), rien d'autre ;
//   - il est LIMITÉ DANS LE TEMPS (le temps d'un film, large) ;
//   - il est vérifié AVANT la garde propriétaire, et ne donne accès à rien d'autre d'Odin.
// Le jeton est chiffré par la clé de la machine (coffre) : il porte la cible et l'échéance, sans rien stocker.
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

/** Durée par défaut d'un jeton de diffusion : six heures (le temps d'un film et d'un entracte, large). */
export const DUREE_FLUX_MS = 6 * 60 * 60 * 1000;
const SEP = '\u0000';

/** Un jeton de diffusion pour UNE cible (film, épisode, piste), limité dans le temps. Rend '' si le coffre est fermé. */
export function jetonFlux(home: string, cibleId: string, o: { dureeMs?: number; maintenant?: number } = {}): string {
  const exp = (o.maintenant ?? Date.now()) + Math.max(60_000, o.dureeMs ?? DUREE_FLUX_MS);
  try { return chiffrerChamp(home, `${cibleId}${SEP}${exp}`); } catch { return ''; }
}
/** Vérifie un jeton de diffusion : bon pour CETTE cible, et pas expiré. Ne lève jamais. */
export function fluxAutorise(home: string, cibleId: string, jeton: string, maintenant = Date.now()): boolean {
  if (!jeton) return false;
  try {
    const clair = dechiffrerChamp(home, jeton);
    const i = clair.lastIndexOf(SEP); if (i < 0) return false;
    const id = clair.slice(0, i), exp = Number(clair.slice(i + 1));
    return id === cibleId && Number.isFinite(exp) && exp > maintenant;
  } catch { return false; }
}
