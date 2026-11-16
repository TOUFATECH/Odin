// Vénus · Odéon — la télécommande par QR. Sur un écran (page de Vénus ou la télé via Odéon) on affiche un QR code ; en
// le scannant, un téléphone ouvre DIRECTEMENT la télécommande de CET écran (et rien d'autre d'Odin) par un lien court
// /t/<jeton>. Le jeton :
//   - ne donne QUE la télécommande de cet écran (portée restreinte) ;
//   - est LIMITÉ DANS LE TEMPS (durée réglable) ;
//   - est RÉVOCABLE d'un bouton et RÉGÉNÉRABLE (l'ancien QR ne vaut plus) ;
//   - compte les téléphones connectés.
// En base : seulement l'empreinte du jeton (SHA-256) et les compteurs ; le secret est chiffré (clé de la machine).
// Assumé : qui a le QR peut piloter cet écran (pratique pour les invités) — d'où la durée courte et la révocation.
import { createHash, randomBytes } from 'node:crypto';
import { svg } from '../qr.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import type { MagasinVenus } from './base.ts';

export const DUREE_DEFAUT_MS = 2 * 60 * 60 * 1000; // deux heures
const MAX_PHONES = 50;

/** L'empreinte d'un jeton (ce qui est gardé en base, pas le jeton lui-même). Pur. */
export const empreinteJeton = (jeton: string): string => createHash('sha256').update(jeton).digest('hex');
/** Le lien court de la télécommande d'un écran. Pur. */
export const lienTelecommande = (origin: string, jeton: string): string => `${origin.replace(/\/$/, '')}/t/${jeton}`;
/** Le QR (SVG) du lien de la télécommande. Pur (à partir de l'origine et du jeton). */
export const qrTelecommande = (origin: string, jeton: string): string => svg(lienTelecommande(origin, jeton), { ecc: 'M', scale: 6 });

export interface Telecommande { id: string; ecranId: string; cree: number; expire: number; revoque: number; derniereVue: number; phones: number }
function vers(e: { id: string; data: Record<string, unknown> }): Telecommande {
  return { id: e.id, ecranId: String(e.data.ecran_id), cree: Number(e.data.cree), expire: Number(e.data.expire), revoque: Number(e.data.revoque) || 0, derniereVue: Number(e.data.derniere_vue) || 0, phones: Array.isArray(e.data.vus) ? (e.data.vus as string[]).length : Number(e.data.phones) || 0 };
}

/** Crée une télécommande pour un écran. Rend le jeton (à mettre dans le QR) UNE fois ; en base, seulement l'empreinte. */
export function creerTelecommande(mag: MagasinVenus, home: string, ecranId: string, o: { dureeMs?: number; maintenant?: number } = {}): { jeton: string; id: string; expire: number } {
  const jeton = randomBytes(18).toString('base64url');
  const id = empreinteJeton(jeton), now = o.maintenant ?? Date.now();
  const expire = now + Math.max(60_000, o.dureeMs ?? DUREE_DEFAUT_MS);
  mag.poser('telecommandes', id, { ecran_id: ecranId, cree: now, expire, revoque: 0, derniere_vue: 0, vus: [], secret: chiffrerChamp(home, jeton) });
  return { jeton, id, expire };
}
/** Retrouve le jeton d'une télécommande (déchiffré) pour réafficher son QR, si elle est encore valable. */
export function jetonDe(mag: MagasinVenus, home: string, id: string, maintenant = Date.now()): string | undefined {
  const e = mag.get('telecommandes', id); if (!e) return undefined;
  const t = vers(e); if (t.revoque || t.expire <= maintenant) return undefined;
  try { return dechiffrerChamp(home, String(e.data.secret ?? '')); } catch { return undefined; }
}

/**
 * Valide un jeton reçu sur /t/<jeton> : rend l'écran piloté, ou une raison de refus. Marque aussi le passage (dernière
 * vue, téléphone compté) si une empreinte de téléphone est fournie. La portée est TOUJOURS ce seul écran.
 */
export function validerJeton(mag: MagasinVenus, jeton: string, o: { maintenant?: number; telephone?: string } = {}): { ecranId: string; id: string } | { refus: string } {
  const id = empreinteJeton(jeton), e = mag.get('telecommandes', id);
  if (!e) return { refus: 'télécommande inconnue' };
  const t = vers(e), now = o.maintenant ?? Date.now();
  if (t.revoque) return { refus: 'télécommande révoquée' };
  if (t.expire <= now) return { refus: 'télécommande expirée' };
  if (o.telephone) marquerVue(mag, id, o.telephone, now);
  return { ecranId: t.ecranId, id };
}
/** Note le passage d'un téléphone (dernière vue + compteur distinct). */
export function marquerVue(mag: MagasinVenus, id: string, telephone: string, maintenant = Date.now()): void {
  const e = mag.get('telecommandes', id); if (!e) return;
  const vus = Array.isArray(e.data.vus) ? [...(e.data.vus as string[])] : [];
  if (telephone && !vus.includes(telephone)) vus.push(telephone);
  mag.poser('telecommandes', id, { ...e.data, derniere_vue: maintenant, vus: vus.slice(-MAX_PHONES) });
}
/** Révoque une télécommande (l'ancien QR ne vaut plus). */
export function revoquer(mag: MagasinVenus, id: string, maintenant = Date.now()): boolean {
  const e = mag.get('telecommandes', id); if (!e || Number(e.data.revoque)) return false;
  mag.poser('telecommandes', id, { ...e.data, revoque: maintenant }); return true;
}
/** Régénère : révoque l'ancienne et en crée une neuve pour le même écran. */
export function regenerer(mag: MagasinVenus, home: string, id: string, o: { dureeMs?: number; maintenant?: number } = {}): { jeton: string; id: string; expire: number } | undefined {
  const e = mag.get('telecommandes', id); if (!e) return undefined;
  revoquer(mag, id, o.maintenant);
  return creerTelecommande(mag, home, String(e.data.ecran_id), o);
}
/** Les télécommandes actives d'un écran (ou de tous). */
export function telecommandes(mag: MagasinVenus, ecranId?: string, maintenant = Date.now()): Telecommande[] {
  return mag.liste('telecommandes').map(vers).filter((t) => !t.revoque && t.expire > maintenant && (!ecranId || t.ecranId === ecranId)).sort((a, b) => b.cree - a.cree);
}
/** Combien de téléphones sont connectés sur une télécommande (affiché sur l'écran). */
export const nombreTelephones = (mag: MagasinVenus, id: string): number => { const e = mag.get('telecommandes', id); return e ? vers(e).phones : 0; };

/** Une empreinte de téléphone à partir de son IP et de son navigateur (pour compter, pas pour identifier). Pur. */
export const empreinteTelephone = (ip: string, ua: string): string => createHash('sha256').update(`${ip}\u0000${ua}`).digest('hex').slice(0, 16);
