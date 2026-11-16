// Zeus — le client du serveur STRATA (contrat v1 : docs/strata-contrat.md).
// STRATA est un modèle de recherche de NVIDIA (Earth-2) : il lui faut une carte de calcul NVIDIA sous Linux et un état
// initial complet de l'atmosphère. Il ne tourne pas sur la machine d'Odin : Odin n'appelle qu'un serveur que le
// propriétaire a monté lui-même, à l'adresse qu'il a réglée. Sans réglage, sans réponse, ou avec une réponse
// impossible, Odin le DIT : il n'invente ni ne simule jamais une valeur STRATA.

import { hiddenV4, isPrivateHost } from '../../heimdall/policy.ts';
import { arrondi, type JourValeurs, type Point } from './sources.ts';
import { valeurImpossible } from './comparer.ts';

export const PAS_DE_SERVEUR = 'STRATA : pas de serveur avec carte NVIDIA, prédiction non disponible';
export const NE_REPOND_PAS = 'Souci : le serveur STRATA ne répond pas';
export const PAS_SI_LOIN = 'STRATA ne prévoit pas au-delà de quelques jours';
export const VALEUR_IMPOSSIBLE = 'Souci : valeur impossible';
/** Odin ne demande jamais plus de 3 jours. */
export const JOURS_MAX_ODIN = 3;
export const DELAI_PREVISION_MS = 60_000;
export const DELAI_ETAT_MS = 10_000;
/** Une réponse plus grosse est refusée (64 Ko au plus, d'après le contrat). */
export const TAILLE_MAX = 64 * 1024;

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

export interface EtatStrata { pret: boolean; modele?: string; version?: string; carte?: string; etatInitial?: { source?: string; date?: string }; joursMax: number; raison?: string }
export interface JourStrata extends JourValeurs { pression: number | null; ventNiveau?: string; /** le vent n'est pas à 10 m : « vent approché » */ ventApproche: boolean }
export interface PrevisionStrata { modele: string; version?: string; etatInitial?: { source?: string; date?: string }; calculeA?: string; jours: JourStrata[] }
/** Ce que rend un appel : jamais de valeur inventée, toujours la raison quand il n'y en a pas. */
export type Resultat<T> = { ok: true; data: T } | { ok: false; couleur: 'gris' | 'rouge'; texte: string; reessayerDans?: number };

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const txt = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 200) : undefined);
const ini = (x: unknown) => (x && typeof x === 'object' ? { source: txt((x as Record<string, unknown>).source), date: txt((x as Record<string, unknown>).date) } : undefined);

/** Lit la réponse de /v1/etat (pur). */
export function lireEtat(json: unknown): EtatStrata | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as Record<string, unknown>; if (typeof o.pret !== 'boolean') return undefined;
  const jm = num(o.jours_max);
  return { pret: o.pret, modele: txt(o.modele), version: txt(o.version), carte: txt(o.carte), etatInitial: ini(o.etat_initial), joursMax: jm !== null && jm >= 1 ? Math.min(Math.floor(jm), 16) : 1, raison: txt(o.raison) };
}
/**
 * Lit la réponse de /v1/prevision avec ses bornes (pur) : une réponse qui ne suit pas le contrat est refusée ; une
 * valeur hors des bornes physiques marque la réponse « Souci : valeur impossible » (elle n'est pas comparée).
 */
export function lireReponse(json: unknown): { ok: true; data: PrevisionStrata } | { ok: false; texte: string } {
  if (!json || typeof json !== 'object') return { ok: false, texte: 'Souci : réponse STRATA illisible' };
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.jours)) return { ok: false, texte: 'Souci : réponse STRATA sans « jours »' };
  const jours: JourStrata[] = [];
  for (const j of o.jours.slice(0, 16) as unknown[]) {
    if (!j || typeof j !== 'object') return { ok: false, texte: 'Souci : réponse STRATA illisible' };
    const x = j as Record<string, unknown>, jour = txt(x.date);
    if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { ok: false, texte: 'Souci : réponse STRATA avec une date illisible' };
    const niveau = txt(x.vent_niveau);
    const v: JourStrata = { jour, tmax: num(x.temperature_max_c), tmin: num(x.temperature_min_c), pluie: num(x.pluie_mm), vent: num(x.vent_max_kmh), pression: num(x.pression_surface_hpa), ...(niveau ? { ventNiveau: niveau } : {}), ventApproche: niveau !== '10m' && niveau !== '10 m' };
    const imp = valeurImpossible(v);
    if (imp) return { ok: false, texte: `${VALEUR_IMPOSSIBLE} (${imp}, le ${jour})` };
    if (v.pression !== null && (v.pression < 300 || v.pression > 1100)) return { ok: false, texte: `${VALEUR_IMPOSSIBLE} (pression de ${v.pression} hPa, le ${jour})` };
    jours.push(v);
  }
  return { ok: true, data: { modele: txt(o.modele) ?? 'STRATA', version: txt(o.version), etatInitial: ini(o.etat_initial), calculeA: txt(o.calcule_a), jours } };
}

async function corpsJson(r: Response): Promise<unknown> {
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > TAILLE_MAX) throw new Error('réponse trop grosse');
  return JSON.parse(b.toString('utf8'));
}
const retryAfter = (r: Response) => { const n = Number(r.headers.get('retry-after')); return Number.isFinite(n) && n >= 0 ? Math.min(n, 86_400) : undefined; };

/** L'état du serveur (GET /v1/etat, 10 s au plus). */
export async function etat(fetchFn: typeof fetch, adresse: string | undefined): Promise<Resultat<EtatStrata>> {
  if (!adresse) return { ok: false, couleur: 'gris', texte: PAS_DE_SERVEUR };
  const a = adresseStrataValide(adresse); if (!a.ok) return { ok: false, couleur: 'rouge', texte: `Souci : adresse du serveur STRATA refusée (${a.raison})` };
  try {
    const r = await fetchFn(`${a.url}/v1/etat`, { signal: AbortSignal.timeout(DELAI_ETAT_MS), redirect: 'error' });
    if (!r.ok) return { ok: false, couleur: 'rouge', texte: `Souci : le serveur STRATA répond ${r.status}` };
    const e = lireEtat(await corpsJson(r));
    if (!e) return { ok: false, couleur: 'rouge', texte: 'Souci : réponse STRATA illisible' };
    return { ok: true, data: e };
  } catch { return { ok: false, couleur: 'rouge', texte: NE_REPOND_PAS }; }
}

/**
 * La prévision de STRATA pour un lieu (POST /v1/prevision, 60 s au plus) : position arrondie à 0,01°, jamais plus de
 * 3 jours. 503 : calcul en cours (avec le délai annoncé) ; 422 : lieu ou échéance non couverts ; 400 : demande refusée.
 */
export async function prevision(fetchFn: typeof fetch, adresse: string | undefined, lieu: Point & { fuseau?: string }, jours: number): Promise<Resultat<PrevisionStrata>> {
  if (!adresse) return { ok: false, couleur: 'gris', texte: PAS_DE_SERVEUR };
  const a = adresseStrataValide(adresse); if (!a.ok) return { ok: false, couleur: 'rouge', texte: `Souci : adresse du serveur STRATA refusée (${a.raison})` };
  const n = Math.max(1, Math.min(JOURS_MAX_ODIN, Math.floor(Number(jours) || 1)));
  const corps = { latitude: arrondi(lieu.lat), longitude: arrondi(lieu.lon), fuseau: lieu.fuseau || 'UTC', jours: n };
  let r: Response;
  try { r = await fetchFn(`${a.url}/v1/prevision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps), signal: AbortSignal.timeout(DELAI_PREVISION_MS), redirect: 'error' }); }
  catch { return { ok: false, couleur: 'rouge', texte: NE_REPOND_PAS }; }
  const erreur = async () => { try { const e = (await corpsJson(r)) as { erreur?: unknown }; return txt(e?.erreur); } catch { return undefined; } };
  if (r.status === 503) { const s = retryAfter(r); return { ok: false, couleur: 'rouge', texte: `Souci : le serveur STRATA calcule encore${s !== undefined ? ` (réessayer dans ${s} s)` : ''}`, ...(s !== undefined ? { reessayerDans: s } : {}) }; }
  if (r.status === 422) { const e = await erreur(); return { ok: false, couleur: 'gris', texte: `STRATA ne couvre pas ce lieu ou cette échéance${e ? ` (${e})` : ''}` }; }
  if (r.status === 400) { const e = await erreur(); return { ok: false, couleur: 'rouge', texte: `Souci : le serveur STRATA refuse la demande${e ? ` (${e})` : ''}` }; }
  if (!r.ok) return { ok: false, couleur: 'rouge', texte: `Souci : le serveur STRATA répond ${r.status}` };
  let json: unknown; try { json = await corpsJson(r); } catch { return { ok: false, couleur: 'rouge', texte: 'Souci : réponse STRATA illisible' }; }
  const l = lireReponse(json);
  if (!l.ok) return { ok: false, couleur: 'rouge', texte: l.texte };
  return { ok: true, data: { ...l.data, jours: l.data.jours.slice(0, n) } };
}
