// Vénus · Odéon — les écrans de la maison (sans serveur extérieur). Les écrans sont les lecteurs multimédia de Home
// Assistant (media_player) : on les découvre, on leur envoie une lecture (media_player/play_media) et on les pilote
// EN CONTINU (lecture, pause, avancer, reculer, volume, suivant, précédent, chaîne, épisode, couper). Chaque commande
// est un appel indépendant à l'écran : on garde le pilotage tant que l'écran est ouvert (ce que l'« open » unique de
// l'ancien serveur ne permettait pas).
//
// L'appel à Home Assistant est injecté (une fonction) : les essais passent un faux, aucun appareil réel.
import type { HaState } from '../../tools/homeassistant.ts';
import type { MagasinVenus } from './base.ts';

export type TypeEcran = 'tv' | 'enceinte' | 'ecran';
export interface EcranVu { id: string; nom: string; type: TypeEcran; actif: boolean; enLecture: boolean; position?: number; duree?: number; volume?: number }

/** Les écrans de la maison d'après les états Home Assistant (media_player). Pur, testable. */
export function ecransDepuisHa(states: HaState[]): EcranVu[] {
  return states.filter((x) => x.entity_id.startsWith('media_player.') && x.state !== 'unavailable')
    .map((x) => {
      const nom = x.attributes.friendly_name ?? x.entity_id.slice('media_player.'.length).replace(/_/g, ' ');
      const classe = String((x.attributes as Record<string, unknown>).device_class ?? '');
      // Nom sans accents pour que « Télé » soit reconnu (les frontières \b ne tiennent pas sur les lettres accentuées).
      const base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const type: TypeEcran = classe === 'tv' || /\b(tv|tele|television|screen|chromecast|android tv|shield|cast)\b/.test(base) ? 'tv' : classe === 'speaker' || /\b(enceinte|speaker|sonos|home|echo|hifi)\b/.test(base) ? 'enceinte' : 'ecran';
      const a = x.attributes as Record<string, unknown>;
      return { id: x.entity_id, nom, type, actif: x.state !== 'off', enLecture: x.state === 'playing', position: num(a.media_position), duree: num(a.media_duration), volume: num(a.volume_level) };
    });
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface AppelHa { path: string; data: Record<string, unknown> }
/** L'appel Home Assistant pour envoyer une lecture sur un écran. Pur. */
export function planEnvoi(entityId: string, url: string, type: 'video' | 'audio' = 'video'): AppelHa {
  return { path: '/services/media_player/play_media', data: { entity_id: entityId, media_content_id: url, media_content_type: type === 'audio' ? 'music' : 'video' } };
}

export type ActionEcran = 'lecture' | 'pause' | 'avancer' | 'reculer' | 'volume' | 'suivant' | 'precedent' | 'chaine' | 'episode' | 'couper';
export const ACTIONS_ECRAN: ActionEcran[] = ['lecture', 'pause', 'avancer', 'reculer', 'volume', 'suivant', 'precedent', 'chaine', 'episode', 'couper'];

/** Ce qu'on sait de l'état d'un écran pour une commande : position/durée (seek) et volume (volume relatif). */
export interface EtatEcran { position?: number; duree?: number; volume?: number }
/** Un volume `valeur` est-il RELATIF (+ / −, avec un pas facultatif : « + », « - », « +5 », « -10 ») ? Pur. */
export const volumeRelatif = (valeur?: string | number): boolean => /^[+-]/.test(String(valeur ?? '').trim());
/**
 * L'appel Home Assistant pour une commande de pilotage. Pur, testable. `etat` sert aux seek relatifs (avancer/reculer)
 * et au volume relatif (+ / −) ; `valeur` au volume (0..100 absolu, ou « + »/« - » relatif), au saut (secondes) ou au
 * numéro de chaîne. « revoir » passe par reculer (grand saut → début). Chaîne pas-à-pas et épisode par numéro
 * demandent la télé en direct / la navigation de série (phase 2) : refusés proprement plutôt que d'envoyer n'importe quoi.
 */
export function planPilotage(action: ActionEcran, entityId: string, valeur?: string | number, etat?: EtatEcran): AppelHa | { erreur: string } {
  const e = { entity_id: entityId };
  switch (action) {
    case 'lecture': return { path: '/services/media_player/media_play', data: e };
    case 'pause': return { path: '/services/media_player/media_pause', data: e };
    case 'suivant': return { path: '/services/media_player/media_next_track', data: e };
    case 'precedent': return { path: '/services/media_player/media_previous_track', data: e };
    case 'couper': return { path: '/services/media_player/media_stop', data: e };
    case 'volume': {
      const sv = String(valeur ?? '').trim();
      if (volumeRelatif(sv)) {
        const pas = (Number(sv.replace(/^[+-]/, '')) || 5) / 100; // pas par défaut : 5 %
        const v = (etat?.volume ?? 0.5) + (sv[0] === '-' ? -pas : pas);
        return { path: '/services/media_player/volume_set', data: { ...e, volume_level: Math.min(1, Math.max(0, v)) } };
      }
      const v = Number(sv); if (!Number.isFinite(v)) return { erreur: 'volume attendu (0 à 100, ou « + » / « - »)' };
      return { path: '/services/media_player/volume_set', data: { ...e, volume_level: Math.min(1, Math.max(0, v > 1 ? v / 100 : v)) } };
    }
    case 'avancer': case 'reculer': {
      const pas = Number(valeur) || 30, pos = etat?.position ?? 0;
      const cible = Math.max(0, pos + (action === 'avancer' ? pas : -pas));
      return { path: '/services/media_player/media_seek', data: { ...e, seek_position: etat?.duree ? Math.min(etat.duree, cible) : cible } };
    }
    case 'chaine': {
      const sv = String(valeur ?? '').trim();
      if (!sv || volumeRelatif(sv)) return { erreur: 'changer de chaîne pas à pas arrive avec la télé en direct (donne un numéro de chaîne)' };
      return { path: '/services/media_player/play_media', data: { ...e, media_content_id: sv, media_content_type: 'channel' } };
    }
    case 'episode': return { erreur: 'choisir un épisode par numéro arrive avec la navigation de série (phase 2) : ouvre l\'épisode depuis la bibliothèque' };
  }
}

/** Un appel à Home Assistant (injecté pour les essais). */
export type HaCaller = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

/** Découvre les écrans et les range dans VENUS_ODIN (pour les retrouver et les nommer plus tard). */
export async function decouvrirEcrans(ha: HaCaller, mag?: MagasinVenus): Promise<EcranVu[]> {
  const states = await ha('GET', '/states') as HaState[];
  const ecrans = ecransDepuisHa(states);
  if (mag) for (const e of ecrans) mag.poser('ecrans', e.id, { nom: e.nom, type: e.type, vu: Date.now() });
  return ecrans;
}
/** Envoie une lecture sur un écran (par son nom ou son entité). Rend l'écran choisi. */
export async function envoyerSurEcran(ha: HaCaller, ou: string, url: string, type: 'video' | 'audio' = 'video'): Promise<EcranVu> {
  const ecrans = await decouvrirEcrans(ha);
  const ecran = choisirEcran(ecrans, ou);
  if (!ecran) throw new Error(ecrans.length ? `écran introuvable : « ${ou} » (${ecrans.map((e) => e.nom).join(', ')})` : 'aucun écran (media_player) dans Home Assistant');
  const a = planEnvoi(ecran.id, url, type);
  await ha('POST', a.path, a.data);
  return ecran;
}
/** Pilote un écran (lecture, pause, seek, volume, suivant/précédent, chaîne/épisode, couper). */
export async function piloterEcran(ha: HaCaller, entityId: string, action: ActionEcran, valeur?: string | number): Promise<void> {
  // On relit l'état pour un seek relatif (avancer/reculer/revoir) ET pour un volume relatif (+ / −).
  const relVol = action === 'volume' && volumeRelatif(valeur);
  let etat: EtatEcran | undefined;
  if (action === 'avancer' || action === 'reculer' || relVol) {
    const states = await ha('GET', '/states') as HaState[]; const s = states.find((x) => x.entity_id === entityId);
    etat = { position: num(s?.attributes.media_position), duree: num(s?.attributes.media_duration), volume: num(s?.attributes.volume_level) };
  }
  const plan = planPilotage(action, entityId, valeur, etat);
  if ('erreur' in plan) throw new Error(plan.erreur);
  await ha('POST', plan.path, plan.data);
}
/** Choisit un écran par son nom (ou la première télé, ou le seul écran). Pur. */
export function choisirEcran(ecrans: EcranVu[], ou: string): EcranVu | undefined {
  const q = ou.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (q) { const t = ecrans.find((e) => e.id === ou || `${e.id} ${e.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)); if (t) return t; }
  return ecrans.find((e) => e.type === 'tv') ?? (ecrans.length === 1 ? ecrans[0] : undefined);
}
