// Zeus — STRATA, le modèle de recherche de NVIDIA (Earth-2) qu'un serveur du propriétaire pouvait faire tourner.
// Depuis le 17/11/2026, Odin n'utilise aucun modèle qui ne soit pas le sien : le serveur STRATA n'est plus interrogé,
// même quand son adresse est réglée. La ligne STRATA reste grise et le dit ; aucune valeur n'est inventée. Zeus garde
// les prévisions publiques des centres météo (des données, pas un modèle qu'Odin fait tourner).

import { hiddenV4, isPrivateHost } from '../../heimdall/policy.ts';
import { pasEntraine } from '../../langue/pas-entraine.ts';

export const PAS_DE_SERVEUR = 'STRATA : pas de serveur avec carte NVIDIA, prédiction non disponible';
export const PAS_SI_LOIN = 'STRATA ne prévoit pas au-delà de quelques jours';
/** Ce que dit la ligne STRATA quand une adresse est réglée : le serveur n'est plus interrogé. */
export const PLUS_INTERROGE = `STRATA n'est plus interrogé : c'est un modèle qui n'est pas celui d'Odin. ${pasEntraine('prevoirMeteo')}`;

const nu = (h: string) => hiddenV4(h).replace(/^(?:::ffff:|(?:0:){5}ffff:)/, '').replace(/\.+$/, '');
/** Jamais : les adresses de lien local et les métadonnées des hébergeurs. */
function hoteRefuse(h: string): boolean {
  return /^169\.254\./.test(h) || /^fe80:/.test(h) || h === '0.0.0.0' || h === '::' || /^0\./.test(h) || h === 'fd00:ec2::254' || h === '100.100.100.200' || h === 'metadata.google.internal' || h === 'metadata' || h.endsWith('.metadata.google.internal');
}
/**
 * L'adresse du serveur STRATA, vérifiée : http ou https, sans identifiant dans le lien ; une adresse de la maison
 * (réseau privé ou boucle locale) ou un https public ; jamais 169.254.x ni les métadonnées d'un hébergeur. Pur.
 */
export function adresseStrataValide(raw: unknown): { ok: true; url: string } | { ok: false; raison: string } {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: false, raison: 'adresse vide' };
  let u: URL; try { u = new URL(t); } catch { return { ok: false, raison: 'adresse illisible (attendu : http://192.168.1.50:8000)' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, raison: 'seules les adresses http et https sont acceptées' };
  if (u.username || u.password) return { ok: false, raison: 'pas d\'identifiant ni de mot de passe dans l\'adresse' };
  if (u.search || u.hash) return { ok: false, raison: 'l\'adresse du serveur s\'écrit sans « ? » ni « # »' };
  const h = nu(u.hostname);
  if (hoteRefuse(h)) return { ok: false, raison: 'adresse réservée refusée (lien local ou métadonnées d\'un hébergeur)' };
  if (!isPrivateHost(h) && u.protocol !== 'https:') return { ok: false, raison: 'un serveur hors de la maison doit être en https' };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/** Ce que dit STRATA : jamais de valeur, toujours la raison (le serveur n'est plus interrogé). */
export interface RefusStrata { ok: false; couleur: 'gris'; texte: string }

/** L'état du serveur : plus jamais demandé (aucun appel, aucune prévision). */
export async function etat(_fetchFn: typeof fetch, adresse: string | undefined): Promise<RefusStrata> {
  return { ok: false, couleur: 'gris', texte: adresse ? PLUS_INTERROGE : PAS_DE_SERVEUR };
}
