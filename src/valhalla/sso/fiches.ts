// Plusieurs serveurs Vénus sur le même compte, synchronisés entre eux par Odin, fiche par fiche (/api/venus/*), sur le
// modèle de Pégase (/api/pegase/envoyer|tirer|empreintes|flux) : { id, col, data, maj, appareil, suppr }, le « maj » le plus
// récent gagne (à égalité, l'appareil au plus petit identifiant), et le flux en direct ne renvoie jamais à un serveur ses
// propres changements (pas de boucle). Contrat : docs/sso-protocole.md § 7 bis.
//
// Rangement : comme Pégase (fichiers JSON écrits d'un coup, droits 600 ; zéro base de données), dans le dossier des
// sauvegardes de la personne (`valhalla/freyja/sauvegardes/<personne>/fiches/`), déjà bloqué pour les outils de fichiers.
// Les fiches ne contiennent ni fichier vidéo ni bibliothèque : profils, favoris, « ma liste », reprises, réglages.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ecrireAtomique, empreinte, gagne } from '../pegase/store.ts';
import { aDroit, dossierSauvegardes, messageRefus, parSub, persona, sessionValide } from './etat.ts';
import { erreur, json, lireJeton } from './oidc.ts';

export const COLS_VENUS = ['profils', 'reglages', 'maliste', 'favoris', 'reprises'] as const;
export type ColVenus = typeof COLS_VENUS[number];
const estCol = (c: unknown): c is ColVenus => typeof c === 'string' && (COLS_VENUS as readonly string[]).includes(c);
export interface Fiche { id: string; col: ColVenus; data: Record<string, unknown>; maj: number; appareil: string; suppr?: true }
export interface Resultat { appliques: number; ignores: Array<{ id: string; col: string; raison: string }>; refuses: Array<{ id: string; col: string; raison: string }>; gagnants: Fiche[]; acceptes: Fiche[] }

const ID = /^[A-Za-z0-9._:@-]{1,200}$/;
const lire = <T>(f: string, defaut: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return defaut; } };

/** Les fiches Vénus d'une personne (un dossier). */
export class FichesVenus {
  readonly dir: string;
  private cols = new Map<ColVenus, Map<string, Fiche>>();
  private emp = new Map<ColVenus, { n: number; hash: string }>();
  constructor(dir: string) { this.dir = dir; mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  col(c: ColVenus): Map<string, Fiche> {
    let m = this.cols.get(c);
    if (!m) { m = new Map(lire<Fiche[]>(join(this.dir, `${c}.json`), []).map((r) => [r.id, r])); this.cols.set(c, m); }
    return m;
  }
  /** La raison du refus d'une fiche reçue (sinon undefined). */
  static refus(x: unknown, now: number): string | undefined {
    if (!x || typeof x !== 'object') return 'pas un objet';
    const r = x as Record<string, unknown>;
    if (!estCol(r.col)) return 'collection inconnue';
    if (typeof r.id !== 'string' || !ID.test(r.id)) return 'identifiant invalide';
    if (typeof r.maj !== 'number' || !Number.isFinite(r.maj) || r.maj <= 0) return 'date « maj » invalide';
    if (r.maj > now + 10 * 60_000) return 'date « maj » dans le futur (horloge du serveur fausse ?)';
    if (r.suppr !== undefined && r.suppr !== true) return '« suppr » doit valoir true';
    if (r.data !== undefined && (typeof r.data !== 'object' || r.data === null || Array.isArray(r.data))) return '« data » doit être un objet';
    if (r.suppr !== true && r.data === undefined) return '« data » manquant';
    if (JSON.stringify(r.data ?? {}).length > 64 * 1024) return '« data » trop gros (64 Ko au plus)';
    return undefined;
  }
  /** Applique des fiches venues d'un serveur Vénus (l'appareil est celui de son jeton, jamais celui qu'il annonce). */
  appliquer(appareil: string, l: unknown[], now = Date.now()): Resultat {
    const out: Resultat = { appliques: 0, ignores: [], refuses: [], gagnants: [], acceptes: [] }, touchees = new Set<ColVenus>();
    for (const x of l) {
      const why = FichesVenus.refus(x, now), r0 = x as Record<string, unknown>;
      if (why) { out.refuses.push({ id: String(r0?.id ?? '').slice(0, 200), col: String(r0?.col ?? '').slice(0, 30), raison: why }); continue; }
      const r: Fiche = { id: r0.id as string, col: r0.col as ColVenus, data: r0.suppr ? {} : r0.data as Record<string, unknown>, maj: Math.trunc(r0.maj as number), appareil, ...(r0.suppr ? { suppr: true as const } : {}) };
      const m = this.col(r.col), old = m.get(r.id);
      if (old && !gagne(r, old)) {
        if (old.maj === r.maj && old.appareil === r.appareil) continue; // déjà reçue
        out.ignores.push({ id: r.id, col: r.col, raison: 'plus ancienne' }); out.gagnants.push(old); continue;
      }
      m.set(r.id, r); touchees.add(r.col); out.appliques++; out.acceptes.push(r);
    }
    for (const c of touchees) { this.emp.delete(c); ecrireAtomique(join(this.dir, `${c}.json`), JSON.stringify([...this.col(c).values()])); }
    return out;
  }
  /** Empreinte de chaque collection : SHA-256 des lignes « id:maj » triées (la même que Pégase, calculée pareil par Vénus). */
  empreintes(): Record<ColVenus, { n: number; hash: string }> {
    const o = {} as Record<ColVenus, { n: number; hash: string }>;
    for (const c of COLS_VENUS) { let e = this.emp.get(c); if (!e) { e = empreinte(this.col(c).values()); this.emp.set(c, e); } o[c] = e; }
    return o;
  }
  tirer(c: ColVenus, depuis?: number, limite = 5000): { changements: Fiche[]; complet: boolean; suite: number | null } {
    const l = [...this.col(c).values()].filter((r) => depuis === undefined || r.maj >= depuis).sort((a, b) => a.maj - b.maj || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const n = Math.max(1, Math.min(20_000, Math.trunc(limite) || 5000));
    if (l.length <= n) return { changements: l, complet: true, suite: null };
    const part = l.slice(0, n); return { changements: part, complet: false, suite: part[part.length - 1].maj };
  }
}

const magasins = new Map<string, FichesVenus>();
const bus = new EventEmitter(); bus.setMaxListeners(500);
function fichesDe(dir: string): FichesVenus { let m = magasins.get(dir); if (!m) { m = new FichesVenus(dir); magasins.set(dir, m); } return m; }
/** Odin s'arrête : les flux ouverts se ferment. */
export function arreterFluxVenus(): void { bus.emit('arret'); magasins.clear(); }

async function lireCorps(req: IncomingMessage, max: number): Promise<Record<string, unknown> | undefined | 'trop'> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return 'trop'; parts.push(c as Buffer); }
  try { const v = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** Les routes /api/venus/envoyer|tirer|empreintes|flux. Rend true si la requête est servie. */
export async function routeVenus(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/venus/')) return false;
  const route = url.pathname.slice('/api/venus/'.length), meth = req.method ?? 'GET';
  const ctx = persona();
  if (!ctx) { erreur(res, 503, 'indisponible', 'Les applis d\'Odin ne tournent pas : réessaie dans un moment.'); return true; }
  const j = lireJeton(ctx, req);
  if (!j.ok) { erreur(res, j.status, j.code, j.message, {}, { 'www-authenticate': 'Bearer error="invalid_token"' }); return true; }
  if (j.charge.aud !== 'venus') { erreur(res, 403, 'mauvaise_appli', `Ce jeton est celui de ${String(j.charge.aud)} : connecte Vénus à Odin.`); return true; }
  if (!aDroit(ctx, j.p, 'venus')) { erreur(res, 403, 'refuse', messageRefus(ctx, 'venus')); return true; }
  const m = fichesDe(join(dossierSauvegardes(ctx, 'venus', j.p.login), 'fiches')), appareil = j.session.appareil.id || `session-${j.session.id}`, now = Date.now();
  if (meth === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) { erreur(res, 415, 'json_attendu', 'Envoie le corps en JSON (content-type: application/json).'); return true; }

  if (meth === 'POST' && route === 'envoyer') {
    const b = await lireCorps(req, 4 * 1024 * 1024);
    if (b === 'trop') { erreur(res, 413, 'trop_gros', 'Envoi trop gros (4 Mo au plus) : envoie les fiches en plusieurs fois.'); return true; }
    const l = b?.changements;
    if (!Array.isArray(l)) { erreur(res, 400, 'requete_invalide', '« changements » doit être une liste.'); return true; }
    if (l.length > 2000) { erreur(res, 413, 'trop_gros', '2 000 fiches au plus par envoi.'); return true; }
    const r = m.appliquer(appareil, l, now);
    if (r.acceptes.length) bus.emit('changements', { dir: m.dir, appareil, fiches: r.acceptes });
    json(res, 200, { ok: true, serveur: now, appliques: r.appliques, ignores: r.ignores, refuses: r.refuses, gagnants: r.gagnants }); return true;
  }
  if (meth === 'GET' && route === 'empreintes') { json(res, 200, { ok: true, serveur: now, empreintes: m.empreintes() }); return true; }
  if (meth === 'POST' && route === 'tirer') {
    const b = await lireCorps(req, 4096); const o = b === 'trop' || !b ? {} : b;
    if (!estCol(o.col)) { erreur(res, 404, 'introuvable', `Collection inconnue. Collections : ${COLS_VENUS.join(', ')}.`); return true; }
    const depuis = o.depuis === undefined || o.depuis === null ? undefined : Number(o.depuis);
    if (depuis !== undefined && !Number.isFinite(depuis)) { erreur(res, 400, 'requete_invalide', '« depuis » : une date en millisecondes.'); return true; }
    json(res, 200, { ok: true, col: o.col, ...m.tirer(o.col, depuis, Number(o.limite) || 5000), serveur: now }); return true;
  }
  if (meth === 'GET' && route === 'flux') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
    const envoie = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    envoie('bonjour', { appareil, serveur: Date.now(), empreintes: m.empreintes() });
    // Jamais ses propres fiches à un serveur : pas de boucle d'envois.
    const onCh = (e: { dir: string; appareil: string; fiches: Fiche[] }) => { if (e.dir === m.dir && e.appareil !== appareil) envoie('changements', { changements: e.fiches }); };
    const fin = (event?: string, texte?: string) => { if (event) envoie(event, { texte }); clearInterval(t); bus.off('changements', onCh); bus.off('arret', onArret); if (!res.writableEnded) res.end(); };
    const onArret = () => fin();
    bus.on('changements', onCh); bus.on('arret', onArret);
    const sid = j.session.id, p = j.p;
    const t = setInterval(() => {
      if (!sessionValide(ctx, sid)) return fin('revoque', 'Cette connexion a été coupée dans Odin : relie Vénus de nouveau.');
      if (!aDroit(ctx, parSub(ctx, p.id), 'venus')) return fin('revoque', messageRefus(ctx, 'venus'));
      envoie('verif', { serveur: Date.now(), empreintes: m.empreintes() });
    }, 25_000);
    req.on('close', () => fin());
    return true;
  }
  erreur(res, 404, 'introuvable', 'Route inconnue (envoyer, tirer, empreintes, flux).'); return true;
}
