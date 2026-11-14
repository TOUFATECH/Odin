// Pégase (le navigateur d'Odin) : le rangement des données synchronisées, côté Odin.
//
// - Zéro base de données : des fichiers JSON par profil et par collection, écrits d'un coup (fichier temporaire puis
//   renommage : jamais à moitié écrits), droits 600.
// - L'historique de navigation est un journal d'ajouts : un fichier par jour (une ligne JSON par visite), jamais réécrit.
// - Une copie par jour (et avant chaque restauration ou mise à jour d'Odin) de toutes les collections sauf l'historique.
// - Conflit : le « maj » le plus récent gagne ; à égalité, l'appareil au plus petit identifiant (docs/pegase-protocole.md).
// Les personnes (nom, e-mail, mot de passe) ne sont PAS ici : elles sont dans Persona. Ici, seulement leurs préférences
// Pégase, leurs appareils (empreinte du jeton, jamais le jeton) et leurs données de navigateur.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const COLS = ['profil', 'favoris', 'onglets', 'espaces', 'bureaux', 'historique', 'agenda', 'reglages', 'telechargements'] as const;
export type Col = typeof COLS[number];
export const isCol = (c: unknown): c is Col => typeof c === 'string' && (COLS as readonly string[]).includes(c);
export interface Rec { id: string; col: Col; data: Record<string, unknown>; maj: number; appareil: string; suppr?: true }
export type Voir = 'tout' | 'sans-historique' | 'rien';
export const VOIRS: Voir[] = ['tout', 'sans-historique', 'rien'];
export interface Prefs { voir: Voir; /** clé d'abonnement à l'agenda (lecture seule de l'agenda) */ agendaCle?: string }
export interface Appareil {
  id: string; profil: string; nom: string; plateforme: string; cree: number; vu: number; ip?: string;
  /** SHA-256 du jeton pg1 (jamais le jeton) ; absent pour un appareil connu par le SSO */
  jeton?: string; sso?: string;
  revoque?: number; synchro?: number; envoyes: number; recus: number;
}
export interface Copie { id: string; date: number; raison: 'quotidienne' | 'avant restauration' | 'avant mise à jour' | 'à la demande'; nombres: Record<string, number> }
export interface Resultat { appliques: number; ignores: Array<{ id: string; col: string; raison: string }>; refuses: Array<{ id: string; col: string; raison: string }>; gagnants: Rec[]; acceptes: Rec[] }

const ID = /^[A-Za-z0-9._:@-]{1,200}$/;
const PID = /^[A-Za-z0-9_-]{1,64}$/;
export const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const VIDE = sha256('');
/** Écrit un fichier d'un coup : jamais à moitié écrit, même si Odin s'arrête au milieu. */
export function ecrireAtomique(f: string, contenu: string): void {
  const tmp = `${f}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, contenu, { mode: 0o600 }); renameSync(tmp, f);
}
const lire = <T>(f: string, defaut: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return defaut; } };
/** Jour (heure locale d'Odin) d'une date en ms : AAAA-MM-JJ. */
export function jourDe(ms: number): string { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** Le gagnant d'un conflit : a remplace b ? */
export const gagne = (a: Pick<Rec, 'maj' | 'appareil'>, b: Pick<Rec, 'maj' | 'appareil'>) => a.maj > b.maj || (a.maj === b.maj && a.appareil < b.appareil);
/** Empreinte d'une collection (identique des deux côtés) : SHA-256 des lignes « id:maj » triées, jointes par « \n ». */
export function empreinte(recs: Iterable<Pick<Rec, 'id' | 'maj'>>): { n: number; hash: string } {
  const l: string[] = []; for (const r of recs) l.push(`${r.id}:${Math.trunc(r.maj)}`);
  l.sort();
  return { n: l.length, hash: l.length ? sha256(l.join('\n')) : VIDE };
}

interface Profil { cols: Map<Col, Map<string, Rec>>; jourDe: Map<string, string>; emp: Map<Col, { n: number; hash: string }> }

/** Les données Pégase d'un Odin (une instance par dossier). */
export class Magasin {
  readonly dir: string;
  readonly bus = new EventEmitter();
  private now: () => number;
  private profils = new Map<string, Profil>();
  private apps?: Appareil[];
  private prefsCache?: Record<string, Prefs>;
  /** appareils dont le flux est ouvert en ce moment */
  readonly enLigne = new Map<string, number>();
  constructor(dir: string, now: () => number = Date.now) { this.dir = dir; this.now = now; mkdirSync(dir, { recursive: true, mode: 0o700 }); this.bus.setMaxListeners(200); }

  // ---------------- Préférences par personne ----------------
  private get prefsFile() { return join(this.dir, 'profils.json'); }
  prefs(pid: string, defaut: Voir = 'tout'): Prefs { this.prefsCache ??= lire(this.prefsFile, {}); return this.prefsCache[pid] ?? { voir: defaut }; }
  setPrefs(pid: string, patch: Partial<Prefs>, defaut: Voir = 'tout'): Prefs {
    this.prefsCache ??= lire(this.prefsFile, {});
    const p = { ...this.prefs(pid, defaut), ...patch }; this.prefsCache[pid] = p;
    ecrireAtomique(this.prefsFile, JSON.stringify(this.prefsCache, null, 1)); return p;
  }
  /** Les personnes qui ont déjà des données Pégase. */
  personnes(): string[] { const d = join(this.dir, 'p'); try { return readdirSync(d).filter((x) => PID.test(x)); } catch { return []; } }

  // ---------------- Appareils et jetons ----------------
  private get appsFile() { return join(this.dir, 'appareils.json'); }
  appareils(): Appareil[] { this.apps ??= lire<Appareil[]>(this.appsFile, []); return this.apps; }
  private saveApps(): void { ecrireAtomique(this.appsFile, JSON.stringify(this.appareils(), null, 1)); }
  appareil(id: string): Appareil | undefined { return this.appareils().find((a) => a.id === id); }
  /** Nouvel appareil avec son jeton (rendu une seule fois, jamais gardé). */
  nouvelAppareil(profil: string, o: { nom: string; plateforme: string; ip?: string; sso?: string }): { appareil: Appareil; jeton?: string } {
    const id = `a_${randomBytes(6).toString('hex')}`, secret = randomBytes(32).toString('base64url'), jeton = o.sso ? undefined : `pg1.${id}.${secret}`;
    const a: Appareil = { id, profil, nom: o.nom.slice(0, 60), plateforme: o.plateforme, cree: this.now(), vu: this.now(), ...(o.ip ? { ip: o.ip } : {}), ...(jeton ? { jeton: sha256(jeton) } : {}), ...(o.sso ? { sso: o.sso } : {}), envoyes: 0, recus: 0 };
    this.appareils().push(a); this.saveApps();
    return { appareil: a, ...(jeton ? { jeton } : {}) };
  }
  /** L'appareil d'un jeton pg1 (comparaison en temps constant), s'il n'est pas révoqué. */
  parJeton(jeton: string): Appareil | undefined {
    const m = /^pg1\.(a_[a-f0-9]{12})\.[A-Za-z0-9_-]{20,}$/.exec(jeton); if (!m) return undefined;
    const a = this.appareil(m[1]); if (!a?.jeton || a.revoque) return undefined;
    const x = Buffer.from(sha256(jeton), 'hex'), y = Buffer.from(a.jeton, 'hex');
    return x.length === y.length && timingSafeEqual(x, y) ? a : undefined;
  }
  /** L'appareil d'une session SSO (créé à la première requête). */
  parSso(profil: string, cle: string, nom: string, plateforme = 'autre', ip?: string): { appareil: Appareil; nouveau: boolean } {
    const k = sha256(`${profil}:${cle}`), a = this.appareils().find((x) => x.sso === k && !x.revoque);
    if (a) return { appareil: a, nouveau: false };
    return { appareil: this.nouvelAppareil(profil, { nom, plateforme, ip, sso: k }).appareil, nouveau: true };
  }
  touche(id: string, patch: Partial<Pick<Appareil, 'vu' | 'synchro' | 'ip'>> & { envoyes?: number; recus?: number }): void {
    const a = this.appareil(id); if (!a) return;
    const ecrire = (patch.synchro !== undefined) || this.now() - a.vu > 60_000 || (patch.ip && patch.ip !== a.ip);
    Object.assign(a, { ...patch, envoyes: a.envoyes + (patch.envoyes ?? 0), recus: a.recus + (patch.recus ?? 0) });
    if (ecrire) this.saveApps();
  }
  revoquer(id: string): Appareil | undefined {
    const a = this.appareil(id); if (!a || a.revoque) return a;
    a.revoque = this.now(); this.saveApps(); this.bus.emit('revoque', a.id); return a;
  }

  // ---------------- Données d'un profil ----------------
  private pdir(pid: string): string { if (!PID.test(pid)) throw new Error('profil invalide'); const d = join(this.dir, 'p', pid); mkdirSync(join(d, 'historique'), { recursive: true, mode: 0o700 }); return d; }
  private charge(pid: string): Profil {
    let p = this.profils.get(pid); if (p) return p;
    const d = this.pdir(pid);
    p = { cols: new Map(), jourDe: new Map(), emp: new Map() };
    for (const c of COLS) {
      if (c === 'historique') continue;
      p.cols.set(c, new Map(lire<Rec[]>(join(d, `${c}.json`), []).map((r) => [r.id, r])));
    }
    // L'historique est rejoué jour après jour, avec la même règle de conflit : le résultat est toujours le même.
    const h = new Map<string, Rec>();
    for (const f of readdirSync(join(d, 'historique')).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
      const jour = f.slice(0, 10);
      for (const l of readFileSync(join(d, 'historique', f), 'utf8').split('\n')) {
        if (!l.trim()) continue;
        let r: Rec; try { r = JSON.parse(l) as Rec; } catch { continue; } // une ligne coupée (arrêt brutal) est ignorée
        const old = h.get(r.id); if (!old || gagne(r, old)) { h.set(r.id, r); if (!r.suppr || !p.jourDe.has(r.id)) p.jourDe.set(r.id, jour); }
      }
    }
    p.cols.set('historique', h);
    this.profils.set(pid, p); return p;
  }
  col(pid: string, c: Col): Map<string, Rec> { return this.charge(pid).cols.get(c)!; }
  private sauve(pid: string, c: Col): void { ecrireAtomique(join(this.pdir(pid), `${c}.json`), JSON.stringify([...this.col(pid, c).values()])); }

  /** Vérifie un changement reçu ; rend la raison du refus. */
  static refus(x: unknown, now: number): string | undefined {
    if (!x || typeof x !== 'object') return 'pas un objet';
    const r = x as Record<string, unknown>;
    if (!isCol(r.col)) return 'collection inconnue';
    if (typeof r.id !== 'string' || !ID.test(r.id)) return 'identifiant invalide';
    if (typeof r.maj !== 'number' || !Number.isFinite(r.maj) || r.maj <= 0) return 'date « maj » invalide';
    if (r.maj > now + 10 * 60_000) return 'date « maj » dans le futur (horloge de l\'appareil fausse ?)';
    if (r.suppr !== undefined && r.suppr !== true) return '« suppr » doit valoir true';
    if (r.data !== undefined && (typeof r.data !== 'object' || r.data === null || Array.isArray(r.data))) return '« data » doit être un objet';
    if (r.suppr !== true && r.data === undefined) return '« data » manquant';
    if (JSON.stringify(r.data ?? {}).length > 64 * 1024) return '« data » trop gros (64 Ko au plus)';
    return undefined;
  }

  /** Applique des changements venus d'un appareil (ou d'Odin : « odin »). */
  appliquer(pid: string, appareil: string, changements: unknown[]): Resultat {
    const now = this.now(), out: Resultat = { appliques: 0, ignores: [], refuses: [], gagnants: [], acceptes: [] };
    const touchees = new Set<Col>(), hist: Array<[string, Rec]> = [];
    const p = this.charge(pid);
    for (const x of changements) {
      const why = Magasin.refus(x, now), r0 = x as Record<string, unknown>;
      if (why) { out.refuses.push({ id: String(r0?.id ?? '').slice(0, 200), col: String(r0?.col ?? '').slice(0, 30), raison: why }); continue; }
      const r: Rec = { id: r0.id as string, col: r0.col as Col, data: r0.suppr ? {} : (r0.data as Record<string, unknown>), maj: Math.trunc(r0.maj as number), appareil, ...(r0.suppr ? { suppr: true as const } : {}) };
      const m = p.cols.get(r.col)!, old = m.get(r.id);
      if (old && !gagne(r, old)) {
        if (old.maj === r.maj && old.appareil === r.appareil) continue; // déjà reçu : sans effet
        out.ignores.push({ id: r.id, col: r.col, raison: 'plus ancien' }); out.gagnants.push(old); continue;
      }
      m.set(r.id, r); touchees.add(r.col); out.appliques++; out.acceptes.push(r);
      if (r.col === 'historique') {
        const jour = (r.suppr && p.jourDe.get(r.id)) || jourDe(typeof r.data.date === 'number' && Number.isFinite(r.data.date) ? r.data.date : r.maj);
        if (!p.jourDe.has(r.id) || !r.suppr) p.jourDe.set(r.id, jour);
        hist.push([jour, r]);
      }
    }
    // Historique : ajout à la fin du fichier du jour (jamais réécrit).
    const byDay = new Map<string, string[]>(); for (const [j, r] of hist) byDay.set(j, [...(byDay.get(j) ?? []), JSON.stringify(r)]);
    for (const [j, lines] of byDay) appendFileSync(join(this.pdir(pid), 'historique', `${j}.jsonl`), lines.join('\n') + '\n', { mode: 0o600 });
    for (const c of touchees) { p.emp.delete(c); if (c !== 'historique') this.sauve(pid, c); }
    if (out.acceptes.length) this.bus.emit('changements', { profil: pid, appareil, recs: out.acceptes });
    return out;
  }

  empreintes(pid: string): Record<Col, { n: number; hash: string }> {
    const p = this.charge(pid), o = {} as Record<Col, { n: number; hash: string }>;
    for (const c of COLS) { let e = p.emp.get(c); if (!e) { e = empreinte(p.cols.get(c)!.values()); p.emp.set(c, e); } o[c] = e; }
    return o;
  }

  tirer(pid: string, c: Col, depuis?: number, limite = 5000): { changements: Rec[]; complet: boolean; suite: number | null } {
    const l = [...this.col(pid, c).values()].filter((r) => depuis === undefined || r.maj >= depuis).sort((a, b) => a.maj - b.maj || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const n = Math.max(1, Math.min(20_000, Math.trunc(limite) || 5000));
    if (l.length <= n) return { changements: l, complet: true, suite: null };
    const part = l.slice(0, n); return { changements: part, complet: false, suite: part[part.length - 1].maj };
  }

  /** Les visites vivantes (sans les pierres tombales). */
  visites(pid: string): Rec[] { return [...this.col(pid, 'historique').values()].filter((r) => !r.suppr); }
  /** Jours qui ont un historique, avec le nombre de visites (du plus récent au plus ancien). */
  jours(pid: string): Array<{ jour: string; n: number }> {
    const p = this.charge(pid), n = new Map<string, number>();
    for (const r of p.cols.get('historique')!.values()) if (!r.suppr) { const j = p.jourDe.get(r.id) ?? jourDe(r.maj); n.set(j, (n.get(j) ?? 0) + 1); }
    return [...n].map(([jour, k]) => ({ jour, n: k })).sort((a, b) => (a.jour < b.jour ? 1 : -1));
  }
  /** Cherche dans l'historique (mots dans l'adresse, le titre ou la recherche ; un jour précis au besoin). */
  chercher(pid: string, o: { q?: string; jour?: string; limite?: number }): Rec[] {
    const p = this.charge(pid), mots = plier(o.q ?? '').split(/\s+/).filter(Boolean);
    return this.visites(pid).filter((r) => (!o.jour || (p.jourDe.get(r.id) ?? jourDe(r.maj)) === o.jour) && mots.every((m) => plier(`${r.data.url ?? ''} ${r.data.titre ?? ''} ${r.data.recherche ?? ''}`).includes(m)))
      .sort((a, b) => dateVisite(b) - dateVisite(a)).slice(0, o.limite ?? 50);
  }

  // ---------------- Copies ----------------
  private cdir(pid: string): string { const d = join(this.pdir(pid), 'copies'); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; }
  copies(pid: string): Copie[] {
    const d = this.cdir(pid);
    return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => lire<Copie & { cols?: unknown }>(join(d, f), undefined as never)).filter(Boolean).map((c) => ({ id: c.id, date: c.date, raison: c.raison, nombres: c.nombres })).sort((a, b) => b.date - a.date);
  }
  copier(pid: string, raison: Copie['raison']): Copie {
    const now = this.now(), id = raison === 'quotidienne' ? jourDe(now) : `${raison === 'avant restauration' ? 'avant' : raison === 'à la demande' ? 'copie' : 'maj'}-${now}`;
    const cols: Record<string, Rec[]> = {}, nombres: Record<string, number> = {};
    for (const c of COLS) if (c !== 'historique') { cols[c] = [...this.col(pid, c).values()]; nombres[c] = cols[c].filter((r) => !r.suppr).length; }
    const copie: Copie = { id, date: now, raison, nombres };
    ecrireAtomique(join(this.cdir(pid), `${id}.json`), JSON.stringify({ ...copie, cols }));
    // On garde 30 copies quotidiennes, 10 de chaque autre sorte.
    const all = this.copies(pid);
    for (const [r, keep] of [['quotidienne', 30], ['avant restauration', 10], ['avant mise à jour', 10], ['à la demande', 10]] as const) for (const c of all.filter((x) => x.raison === r).slice(keep)) rmSync(join(this.cdir(pid), `${c.id}.json`), { force: true });
    return copie;
  }
  aCopieDuJour(pid: string): boolean { return existsSync(join(this.cdir(pid), `${jourDe(this.now())}.json`)); }
  /** Remet une copie : ses données reviennent avec « maj » = maintenant (elles gagnent partout), le reste est effacé. */
  restaurer(pid: string, copieId: string): { changes: number; copie: Copie } {
    if (!/^[\w-]{1,40}$/.test(copieId)) throw new Error('copie inconnue');
    const f = join(this.cdir(pid), `${copieId}.json`); if (!existsSync(f)) throw new Error('copie inconnue');
    const c = lire<Copie & { cols: Record<string, Rec[]> }>(f, undefined as never); if (!c?.cols) throw new Error('copie illisible');
    this.copier(pid, 'avant restauration');
    const now = this.now(), ch: Array<Record<string, unknown>> = [];
    for (const col of COLS) {
      if (col === 'historique') continue;
      const voulu = new Map((c.cols[col] ?? []).map((r) => [r.id, r])), actuel = this.col(pid, col);
      for (const [id, r] of voulu) { const a = actuel.get(id); if (!a || Boolean(a.suppr) !== Boolean(r.suppr) || JSON.stringify(a.data) !== JSON.stringify(r.data)) ch.push({ id, col, data: r.data, maj: now, ...(r.suppr ? { suppr: true } : {}) }); }
      for (const [id, a] of actuel) if (!voulu.has(id) && !a.suppr) ch.push({ id, col, maj: now, suppr: true });
    }
    this.bus.emit('restaure', { profil: pid, copie: c.id, date: c.date });
    const r = this.appliquer(pid, 'odin', ch);
    return { changes: r.appliques, copie: { id: c.id, date: c.date, raison: c.raison, nombres: c.nombres } };
  }

  /** Taille sur le disque des données d'un profil (octets). */
  taille(pid: string): number {
    let n = 0; const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else n += statSync(p).size; } };
    try { walk(this.pdir(pid)); } catch { /* rien */ }
    return n;
  }
}

export const dateVisite = (r: Rec) => (typeof r.data.date === 'number' ? r.data.date : r.maj);
export const plier = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const magasins = new Map<string, Magasin>();
/** Le magasin d'un dossier d'appli (un seul par dossier, partagé par l'appli et les routes web). */
export function magasin(dir: string, now?: () => number): Magasin { let m = magasins.get(dir); if (!m) { m = new Magasin(dir, now); magasins.set(dir, m); } return m; }
export function oublierMagasin(dir: string): void { magasins.delete(dir); }
/** Odin s'arrête : les flux en direct se ferment (sinon le serveur web attendrait leur fin). */
export function arreterFlux(): void { for (const m of magasins.values()) m.bus.emit('arret'); }
