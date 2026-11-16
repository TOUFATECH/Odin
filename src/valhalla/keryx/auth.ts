// L'authentification de Kéryx, à DEUX CRANS (n'importe qui peut texter ou appeler un numéro) :
//   cran 1 — le numéro est en LISTE BLANCHE (connu). Un inconnu n'obtient rien d'utile.
//   cran 2 — le CODE SECRET est prouvé AVANT toute action sensible. Le numéro affiché (CLIP, From, expéditeur) est
//            USURPABLE : la liste blanche suffit pour accueillir et lire, JAMAIS pour agir. Tant que le secret n'est
//            pas prouvé, la session reste au plafond « prudent » (tout part en validation au propriétaire).
//
// Contre le rejeu et la force brute : le code n'est gardé qu'en EMPREINTE scrypt (jamais en clair), comparé en temps
// constant (timingSafeEqual, jamais ===) ; un compteur d'échecs par pair verrouille avec un délai croissant ; la preuve
// du secret a une courte durée de vie (TTL) et doit être refaite ensuite.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { readSecretFile, removeSecretFile, secretFileExists, writeSecretFile } from '../../vault.ts';
import type { NiveauAuto } from './types.ts';

export interface Session {
  canal: string;
  pair: string;
  connu: boolean;
  secretProuve: boolean;
  /** Quand le secret a été prouvé (0 sinon) : sert au TTL de la preuve. */
  depuis: number;
}

/** La preuve du secret ne vaut qu'un temps : passé ce délai d'inactivité, il faut la refaire. */
export const TTL_PREUVE = 15 * 60_000;
const SEUIL_VERROU = 3;         // à partir du 3e échec, on verrouille
const VERROU_BASE = 2_000;      // 2 s, qui double à chaque échec de plus
const VERROU_MAX = 10 * 60_000; // jusqu'à 10 min

const sessions = new Map<string, Session>();
interface AntiBrute { echecs: number; verrouJusqua: number }
const antiBrute = new Map<string, AntiBrute>();
interface Debit { debut: number; n: number }
const debits = new Map<string, Debit>();

// Bornes anti-abus : les données viennent de dehors (numéro usurpable), on ne garde aucun état sans fin.
const MAX_PAIRS = 2_000;      // plafond de pairs suivis par Map (le plus ancien est évincé au-delà)
const RATE_FENETRE = 60_000;  // fenêtre glissante d'une minute pour le débit
const RATE_MAX = 20;          // messages/minute/pair acceptés

const cle = (canal: string, pair: string): string => `${canal}:${pair}`;

/** Évince les entrées les plus anciennes (ordre d'insertion) quand une Map dépasse le plafond. */
function borner<T>(m: Map<string, T>): void { while (m.size > MAX_PAIRS) { const k = m.keys().next().value; if (k === undefined) break; m.delete(k); } }

/** La session (canal, pair) : créée au besoin, gardée en mémoire (secret prouvé, anti-rejeu). Bornée (éviction). */
export function session(canal: string, pair: string): Session {
  const k = cle(canal, pair);
  let s = sessions.get(k);
  if (!s) { s = { canal, pair, connu: false, secretProuve: false, depuis: 0 }; sessions.set(k, s); borner(sessions); }
  return s;
}

/**
 * Une session ÉPHÉMÈRE, non gardée en mémoire : pour un pair non reconnu (jamais transmis à Odin), on ne matérialise
 * aucun état durable. Ainsi un flot de numéros inconnus / usurpés ne remplit ni `sessions` ni `antiBrute` (anti-fuite).
 */
export function sessionEphemere(canal: string, pair: string): Session {
  return { canal, pair, connu: false, secretProuve: false, depuis: 0 };
}

/** Trop de messages de ce pair dans la dernière minute ? (anti-inondation ; la Map des débits est bornée et évincée.) */
export function tropVite(canal: string, pair: string, maintenant = Date.now()): boolean {
  const k = cle(canal, pair);
  let d = debits.get(k);
  if (!d || maintenant - d.debut > RATE_FENETRE) { d = { debut: maintenant, n: 0 }; debits.set(k, d); borner(debits); }
  d.n += 1;
  return d.n > RATE_MAX;
}

/** Normalise un numéro / identifiant pour la comparaison (chiffres et « + » gardés). */
export function normaliser(x: string): string {
  const t = String(x).trim();
  return /[^\d+]/.test(t) && !/^\+?\d[\d\s.\-()]*$/.test(t) ? t.toLowerCase() : t.replace(/[^\d+]/g, '');
}
/** Le pair est-il dans la liste blanche ? (cran 1) */
export function estConnu(numeros: string[], pair: string): boolean {
  const p = normaliser(pair);
  return numeros.some((n) => normaliser(n) === p);
}

const fichierSecret = (home: string): string => join(home, 'keryx-secret');

/** Le propriétaire a-t-il posé un code secret ? */
export const secretPose = (home: string): boolean => secretFileExists(fichierSecret(home));

/** Pose (ou remplace) le code secret : seule son empreinte scrypt est gardée, jamais le clair. */
export function poserSecret(home: string, code: string): void {
  if (code.length < 4) throw new Error('code trop court (4 caractères au moins)');
  const sel = randomBytes(16);
  const empreinte = scryptSync(code.normalize('NFC'), sel, 32);
  writeSecretFile(fichierSecret(home), JSON.stringify({ sel: sel.toString('base64'), empreinte: empreinte.toString('base64') }));
}
/** Retire le code secret. */
export function effacerSecret(home: string): void { removeSecretFile(fichierSecret(home)); }

function lireEmpreinte(home: string): { sel: Buffer; empreinte: Buffer } | undefined {
  try {
    const p = JSON.parse(readSecretFile(fichierSecret(home)) ?? 'null') as { sel: string; empreinte: string } | null;
    if (!p) return undefined;
    return { sel: Buffer.from(p.sel, 'base64'), empreinte: Buffer.from(p.empreinte, 'base64') };
  } catch { return undefined; }
}

/**
 * Prouve le code secret (cran 2). Rend faux (sans rien révéler) si la session est verrouillée, si aucun secret n'est
 * posé, ou si le code est faux ; dans ce dernier cas, le compteur d'échecs monte et le verrou s'allonge. Comparaison en
 * temps constant.
 */
export function prouverSecret(home: string, s: Session, code: string, maintenant = Date.now()): boolean {
  const k = cle(s.canal, s.pair);
  const r = antiBrute.get(k) ?? { echecs: 0, verrouJusqua: 0 };
  if (maintenant < r.verrouJusqua) return false;
  const pose = lireEmpreinte(home);
  if (!pose) return false;
  const essai = scryptSync(String(code).normalize('NFC'), pose.sel, pose.empreinte.length);
  const bon = essai.length === pose.empreinte.length && timingSafeEqual(essai, pose.empreinte);
  if (bon) { antiBrute.delete(k); s.secretProuve = true; s.depuis = maintenant; return true; }
  r.echecs += 1;
  if (r.echecs >= SEUIL_VERROU) r.verrouJusqua = maintenant + Math.min(VERROU_MAX, VERROU_BASE * 2 ** (r.echecs - SEUIL_VERROU));
  antiBrute.set(k, r); borner(antiBrute);
  return false;
}

/** La session est-elle verrouillée (trop d'échecs), et jusqu'à quand ? */
export function verrouillee(s: Session, maintenant = Date.now()): number {
  const r = antiBrute.get(cle(s.canal, s.pair));
  return r && maintenant < r.verrouJusqua ? r.verrouJusqua - maintenant : 0;
}

/**
 * La preuve du secret est-elle ENCORE valide ? (prouvée, et non expirée). Met la session à jour en cas d'expiration.
 * Sert à distinguer « secret non prouvé » (= bloquer, demander le code) de « autonomie réglée prudente » (= transmettre,
 * mais au plafond prudent) : ce sont deux choses différentes qu'il ne faut pas confondre (cf. le défaut « prudent »).
 */
export function secretValide(s: Session, maintenant = Date.now()): boolean {
  if (!s.secretProuve) return false;
  if (maintenant - s.depuis > TTL_PREUVE) { s.secretProuve = false; return false; }
  return true;
}

/**
 * Le plafond d'autonomie de la session : « prudent » tant que le secret n'est pas prouvé (ou que sa preuve a expiré) ;
 * sinon, le niveau réglé par le propriétaire (`apres`), y compris 'prudent' qui circule alors comme une CONSIGNE (lire
 * et demander), jamais comme un blocage. (La signature du contrat est plafond(s) ; `apres` porte le réglage.)
 */
export function plafond(s: Session, apres: NiveauAuto = 'equilibre', maintenant = Date.now()): NiveauAuto {
  return secretValide(s, maintenant) ? apres : 'prudent';
}

/** Oublie tout l'état en mémoire (essais). */
export function _reinitialiser(): void { sessions.clear(); antiBrute.clear(); debits.clear(); }
/** Nombre de pairs dont la session est gardée en mémoire (essais : vérifier qu'un inconnu n'en crée pas). */
export function _tailleSessions(): number { return sessions.size; }
