// La base d'Odin — les données des applis dans une vraie base PostgreSQL, gérée par Alexandrie.
//
// - Une base « odin », un schéma par appli, un compte par appli (`odin_app_<id>`, droits sur SON schéma seulement),
//   un compte `odin_lecture` qui ne voit que les vues prévues (`v_*`) : c'est par lui qu'Odin (l'IA) lit les données
//   pour répondre, en lecture seule (Alexandrie : SQL en lecture garantie par la base ; écrire demande ton accord).
// - Migrations versionnées par appli (`<schéma>._migrations`), chacune dans une transaction.
// - Odin démarre même sans base : elle est préparée en arrière-plan, et réessayée tant qu'elle ne répond pas.
//   Les écritures des applis passent par le journal d'attente (attente.ts) : rien n'est perdu.
// - Mots de passe générés, jamais affichés : secrets d'Alexandrie (fichier bloqué) et coffre Thésauros.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Pg, PgError } from '../urdr/pg.ts';
import { bases, password, saveBases, setPassword } from '../urdr/bases.ts';
import { Attente, type Ligne } from './attente.ts';
import { connexionPerdue, Reserve, type Lien, type Valeur } from './pool.ts';
import { cibleGardee, choisir, demarrerLocale, garderCible, motDePasseAdmin, SECRET_ADMIN, type Cible } from './serveur.ts';
import type { Result } from '../urdr/pg.ts';

export type { Valeur, Lien } from './pool.ts';
export type Etat = 'absente' | 'preparation' | 'prete' | 'perdue';
export interface Migration { v: number; nom: string; sql: string }
/** Ce qu'une appli déclare : ses migrations et ses écritures (SQL paramétré, rejouable). */
export interface DefAppli { id: string; migrations: Migration[]; ecritures: Record<string, string> }

export const BASE = 'odin', LECTURE = 'odin_lecture', ID_ALEXANDRIE = 'odin';
export const roleDe = (app: string) => `odin_app_${app}`;
const ID = /^[a-z][a-z0-9_]{1,30}$/;

/** La base n'est pas prête : l'appli le dit, et réessaie. */
export class BaseAttente extends Error {
  constructor(quoi = 'la base d\'Odin') { super(`${quoi[0].toUpperCase()}${quoi.slice(1)} n'est pas prête pour l'instant (elle démarre, ou PostgreSQL est arrêté) : tes données sont gardées, réessaie dans un instant.`); }
}

/** Une appli branchée sur la base : ses requêtes, ses transactions, son journal d'attente. */
export class AppliBase extends EventEmitter {
  readonly id: string; readonly def: DefAppli; readonly attente: Attente;
  private reserve?: Reserve; private envoi?: Promise<void>; private relance?: ReturnType<typeof setTimeout>;
  /** prête quand ses migrations sont passées et sa connexion ouverte */
  prete = false;
  erreur?: string;
  private base: BaseOdin;
  constructor(base: BaseOdin, def: DefAppli, fichierAttente: string) {
    super(); this.base = base; this.def = def; this.id = def.id; this.attente = new Attente(fichierAttente); this.setMaxListeners(50);
  }
  get role(): string { return roleDe(this.id); }
  /** Lecture ou écriture immédiate (base prête seulement). */
  q(sql: string, params: Valeur[] = []): Promise<Result> { if (!this.reserve || !this.prete) return Promise.reject(new BaseAttente()); return this.reserve.q(sql, params); }
  tx<T>(f: (l: Lien) => Promise<T>): Promise<T> { if (!this.reserve || !this.prete) return Promise.reject(new BaseAttente()); return this.reserve.tx(f); }
  /** Note des écritures (journal d'attente sur le disque) puis les envoie dès que possible. */
  ecrire(...ls: Array<[k: string, ...p: Valeur[]]>): void {
    for (const [k] of ls) if (!(k in this.def.ecritures)) throw new Error(`écriture inconnue : ${this.id}.${k}`);
    this.attente.ajouter(...ls.map(([k, ...p]) => ({ k, p })));
    this.planifier(0);
  }
  /** Attend que tout ce qui est noté soit parti (ou lève l'erreur si la base ne répond pas). */
  async vider(): Promise<void> {
    while (this.envoi) await this.envoi.catch(() => undefined);
    if (!this.attente.taille) return;
    if (!this.prete || !this.reserve) throw new BaseAttente();
    this.envoi = this.envoyer(); try { await this.envoi; } finally { this.envoi = undefined; }
    if (this.attente.taille) return this.vider();
  }
  private planifier(ms: number): void {
    if (this.relance || !this.prete) return;
    this.relance = setTimeout(() => { this.relance = undefined; this.vider().catch((e) => { if (connexionPerdue(e)) this.base.signalerPerte(); }); }, ms);
    this.relance.unref?.();
  }
  private async envoyer(): Promise<void> {
    const r = this.reserve!, ecr = this.def.ecritures;
    await this.attente.vider(async (ls) => {
      for (let i = 0; i < ls.length; i += 500) {
        const lot = ls.slice(i, i + 500);
        try { await r.tx(async (l) => { for (const x of lot) await l.q(ecr[x.k], x.p); }); }
        catch (e) {
          if (connexionPerdue(e)) throw e;
          // Une écriture refusée par la base (requête fausse) ne bloque pas les autres : elles partent une à une.
          for (const x of lot) { try { await r.q(ecr[x.k], x.p); } catch (e2) { if (connexionPerdue(e2)) throw e2; this.attente.rejeter(x as Ligne, (e2 as Error).message); console.error(`[base] ${this.id} : écriture refusée par la base (${(e2 as Error).message}), mise de côté`); } }
        }
      }
    });
  }
  /** (base) branche l'appli : son compte, son schéma, ses migrations, puis envoie ce qui attendait. */
  async brancher(admin: Reserve, cible: { hote: string; port: number }): Promise<void> {
    if (!ID.test(this.id)) throw new Error(`identifiant d'appli invalide pour la base : ${this.id}`);
    const role = this.role, secret = `odin-app-${this.id.replace(/_/g, '-')}`;
    let pw = password(this.base.home, secret); const nouveau = !pw; if (!pw) pw = randomBytes(24).toString('base64url');
    await admin.avec(async (c) => {
      const existe = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length > 0;
      if (!existe || nouveau) await c.simple((await c.query(`SELECT format(${existe ? "'ALTER ROLE %I LOGIN PASSWORD %L'" : "'CREATE ROLE %I LOGIN PASSWORD %L'"}, $1::text, $2::text)`, [role, pw])).rows[0][0]!);
      const admin = this.base.cible!.admin;
      for (const [f, a, b] of [["'GRANT %I TO %I'", role, admin], ["'GRANT CONNECT ON DATABASE %I TO %I'", BASE, role], ["'CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I'", this.id, role], ["'ALTER ROLE %I SET search_path = %I'", role, this.id]]) {
        await c.simple((await c.query(`SELECT format(${f}, $1::text, $2::text)`, [a, b])).rows[0][0]!);
      }
    });
    setPassword(this.base.home, secret, pw);
    await this.reserve?.fermer();
    const res = new Reserve({ host: cible.hote, port: cible.port, user: role, password: pw, database: BASE, ssl: 'non' }, 2);
    // Les migrations, chacune dans une transaction, par le compte de l'appli (il possède son schéma).
    await res.avec((c) => c.simple(`CREATE TABLE IF NOT EXISTS _migrations (version int PRIMARY KEY, nom text NOT NULL, faite timestamptz NOT NULL DEFAULT now()); GRANT USAGE ON SCHEMA ${ident(this.id)} TO ${LECTURE}`));
    const faites = new Set((await res.q('SELECT version FROM _migrations')).rows.map((x) => Number(x[0])));
    for (const m of [...this.def.migrations].sort((a, b) => a.v - b.v)) {
      if (faites.has(m.v)) continue;
      await res.migration(`${m.sql};\nINSERT INTO _migrations (version, nom) VALUES (${Math.trunc(m.v)}, ${lit(m.nom)})`);
    }
    this.reserve = res; this.prete = true; this.erreur = undefined;
    await this.vider();
    this.emit('prete');
  }
  /** (base) la connexion est perdue : les écritures attendent sur le disque. */
  perdre(raison: string): void { if (!this.prete) return; this.prete = false; this.erreur = raison; this.emit('perdue', raison); }
  async fermer(): Promise<void> { if (this.relance) clearTimeout(this.relance); this.relance = undefined; this.prete = false; await this.reserve?.fermer(); this.reserve = undefined; }
}
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface OptionsBase {
  /** où est le serveur (sinon : choix automatique, voir serveur.ts) */
  cible?: Cible;
  /** essayer Hringhorni si rien d'autre (défaut : oui) */
  hringhorni?: boolean;
  /** rangement du mot de passe dans le coffre (Thésauros) */
  coffre?(nom: string, identifiant: string, mdp: string, site: string): Promise<void>;
  /** intervalle de vérification (ms) */
  verifierMs?: number;
  log?(t: string): void;
}

/** LA base d'Odin (une par dossier d'Odin). */
export class BaseOdin extends EventEmitter {
  readonly home: string;
  etat: Etat = 'absente';
  message = 'La base d\'Odin n\'est pas encore préparée.';
  cible?: Cible;
  private admin?: Reserve; private applis = new Map<string, AppliBase>(); private o: OptionsBase;
  private minuterie?: ReturnType<typeof setInterval>; private enCours?: Promise<void>; private arretee = false;
  constructor(home: string, o: OptionsBase = {}) { super(); this.home = home; this.o = o; this.setMaxListeners(50); }

  /** Une appli (créée une fois) ; elle se branche dès que la base est prête. */
  appli(def: DefAppli, dossier: string): AppliBase {
    let a = this.applis.get(def.id); if (a) return a;
    a = new AppliBase(this, def, join(dossier, '.attente-base.jsonl')); this.applis.set(def.id, a);
    if (this.etat === 'prete' && this.admin && this.cible) void a.brancher(this.admin, this.cible).catch((e) => { a!.erreur = (e as Error).message; this.log(`${def.id} : ${(e as Error).message}`); });
    return a;
  }
  applisBranchees(): AppliBase[] { return [...this.applis.values()]; }

  /** Prépare la base en arrière-plan, et la surveille (réessaie tant qu'elle ne répond pas). */
  demarrer(): Promise<void> {
    const tick = () => { if (!this.enCours && !this.arretee) { this.enCours = this.verifier().finally(() => { this.enCours = undefined; }); } return this.enCours ?? Promise.resolve(); };
    this.minuterie = setInterval(() => void tick(), this.o.verifierMs ?? 15_000); this.minuterie.unref?.();
    return tick();
  }
  /** Vérifie maintenant (et prépare si besoin). */
  async verifier(): Promise<void> {
    if (this.etat === 'prete' && this.admin) {
      if (await this.admin.repond()) { for (const a of this.applis.values()) if (!a.prete) await a.brancher(this.admin, this.cible!).catch((e) => { a.erreur = (e as Error).message; }); return; }
      this.signalerPerte();
    }
    try { await this.preparer(); }
    catch (e) {
      const was = this.etat as Etat; this.etat = was === 'perdue' || was === 'prete' ? 'perdue' : 'absente';
      this.message = `La base d'Odin ne répond pas (${(e as Error).message}). Odin marche quand même : les écritures des applis attendent sur le disque et partiront dès qu'elle revient.`;
      if (was !== (this.etat as Etat) || was === 'preparation') this.emit('etat', this.etat, this.message);
    }
  }
  /** Une appli a vu la connexion tomber. */
  signalerPerte(): void {
    if (this.etat !== 'prete') return;
    this.etat = 'perdue'; this.message = 'La base d\'Odin ne répond plus : les écritures attendent sur le disque et partiront dès qu\'elle revient.';
    for (const a of this.applis.values()) a.perdre(this.message);
    void this.admin?.fermer(); this.admin = undefined;
    this.emit('etat', this.etat, this.message); this.log(this.message);
  }

  private async preparer(): Promise<void> {
    if (this.etat !== 'perdue') { this.etat = 'preparation'; this.message = 'La base d\'Odin se prépare…'; }
    let c = this.o.cible ?? cibleGardee(this.home);
    if (!c || !motDePasseAdmin(this.home)) c = (await choisir(this.home)) ?? (this.o.hringhorni === false ? undefined : await hringhorni(this.home));
    if (!c) throw new Error('pas de PostgreSQL sur cette machine : installe-le (paquet « postgresql ») ou laisse Hringhorni le faire');
    if (c.mode === 'locale') await demarrerLocale(c);
    if (c.mode === 'hringhorni') c = { ...c, ...(await adresseHringhorni(c)) };
    this.cible = c;
    const pw = motDePasseAdmin(this.home);
    // La base « odin » (créée une fois) ; puis tout se fait dedans.
    const p = await Pg.connect({ host: c.hote, port: c.port, user: c.admin, password: pw, database: 'postgres', ssl: 'non', timeoutMs: 5000 });
    try {
      if (!(await p.query('SELECT 1 FROM pg_database WHERE datname = $1', [BASE])).rows.length) {
        await p.simple((await p.query(`SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', $1::text, $2::text)`, [BASE, c.admin])).rows[0][0]!);
        await p.simple((await p.query(`SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', $1::text)`, [BASE])).rows[0][0]!);
      }
    } finally { await p.close(); }
    await this.admin?.fermer();
    const admin = new Reserve({ host: c.hote, port: c.port, user: c.admin, password: pw, database: BASE, ssl: 'non' }, 2);
    // Le compte de lecture d'Odin (vues seulement) et l'inscription dans Alexandrie.
    let lpw = password(this.home, ID_ALEXANDRIE); const nouveau = !lpw; if (!lpw) lpw = randomBytes(24).toString('base64url');
    await admin.avec(async (x) => {
      const existe = (await x.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [LECTURE])).rows.length > 0;
      if (!existe || nouveau) await x.simple((await x.query(`SELECT format(${existe ? "'ALTER ROLE %I LOGIN PASSWORD %L'" : "'CREATE ROLE %I LOGIN PASSWORD %L'"}, $1::text, $2::text)`, [LECTURE, lpw])).rows[0][0]!);
      await x.simple((await x.query(`SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text)`, [BASE, LECTURE])).rows[0][0]!);
      // Le schéma public ne sert à personne : aucune appli n'y crée rien.
      await x.simple('REVOKE ALL ON SCHEMA public FROM PUBLIC').catch(() => undefined);
    });
    setPassword(this.home, ID_ALEXANDRIE, lpw);
    inscrireDansAlexandrie(this.home, c);
    if (!c.coffre && this.o.coffre) { try { await this.o.coffre('Base · Données des applis d\'Odin', c.admin, pw!, `${c.hote}:${c.port}/${BASE}`); c.coffre = true; if (!this.o.cible) garderCible(this.home, c); } catch { /* coffre fermé : réessayé au prochain démarrage */ } }
    this.admin = admin;
    for (const a of this.applis.values()) await a.brancher(admin, c).catch((e) => { a.erreur = (e as Error).message; this.log(`${a.id} : ${(e as Error).message}`); if (connexionPerdue(e)) throw e; });
    const was = this.etat as Etat; this.etat = 'prete';
    this.message = `La base d'Odin est prête (${({ machine: 'PostgreSQL de la machine', locale: 'serveur PostgreSQL d\'Odin', hringhorni: 'Hringhorni, conteneur odin-pg' } as const)[c.mode]}, ${c.hote}:${c.port}).`;
    if (was !== 'prete') { this.emit('etat', this.etat, this.message); this.log(this.message); }
  }
  /** Lien administrateur (sauvegardes, retour en fichiers). */
  administrateur(): Reserve { if (!this.admin || this.etat !== 'prete') throw new BaseAttente(); return this.admin; }
  async arreter(): Promise<void> {
    this.arretee = true; if (this.minuterie) clearInterval(this.minuterie);
    await this.enCours?.catch(() => undefined);
    // Ce qui attend part si la base répond (5 s au plus) ; sinon il reste sur le disque et partira au prochain démarrage.
    for (const a of this.applis.values()) { await Promise.race([a.vider().catch(() => undefined), new Promise((r) => setTimeout(r, 5000).unref())]); await a.fermer(); }
    await this.admin?.fermer(); this.admin = undefined;
  }
  private log(t: string): void { (this.o.log ?? ((x: string) => console.log(`[base] ${x}`)))(t); }
}

/** La base dans la liste d'Alexandrie (compte de lecture : Odin la lit pour répondre, Alexandrie Studio la montre). */
function inscrireDansAlexandrie(home: string, c: Cible): void {
  const l = bases(home).filter((b) => b.id !== ID_ALEXANDRIE);
  saveBases(home, [...l, { id: ID_ALEXANDRIE, nom: 'Données des applis d\'Odin', type: 'postgres', ...(c.mode === 'hringhorni' ? { conteneur: c.conteneur } : { hote: c.hote, port: c.port }), utilisateur: LECTURE, base: BASE, ssl: 'non', version: undefined, ajoutee: bases(home).find((b) => b.id === ID_ALEXANDRIE)?.ajoutee ?? new Date().toISOString() }]);
}

/** 3. Hringhorni : le serveur « odin-pg » d'Alexandrie (créé s'il n'existe pas, attendu). */
async function hringhorni(home: string): Promise<Cible | undefined> {
  try {
    const { engine } = await import('../modules/naglfar.ts');
    const { createServer: creer, waitServer, SERVER } = await import('../urdr/serveur.ts');
    const e = engine(); creer(home, e); await waitServer(home, e, 600_000);
    const pw = password(home, SERVER); if (!pw) return undefined;
    setPassword(home, SECRET_ADMIN, pw);
    const c: Cible = { mode: 'hringhorni', hote: '', port: 5432, admin: 'postgres', conteneur: SERVER, creee: new Date().toISOString() };
    garderCible(home, c); return c;
  } catch { return undefined; }
}
async function adresseHringhorni(c: Cible): Promise<{ hote: string; port: number }> {
  const { engine } = await import('../modules/naglfar.ts');
  const ct = engine().find(c.conteneur ?? 'odin-pg'); if (ct.state.status !== 'en marche' || !ct.state.ip) { await engine().start(ct.spec.id).catch(() => undefined); throw new Error('le conteneur odin-pg ne tourne pas (redémarrage demandé)'); }
  return { hote: ct.state.ip, port: 5432 };
}

// ---------------- Les applis qui passent dans la base (état, retour en fichiers) ----------------
export interface Migrable {
  id: string; nom: string;
  etat(): { support: 'fichiers' | 'base'; pret: boolean; attente: number; message: string };
  /** attend la fin d'une migration ou d'une lecture en cours, et l'envoi de ce qui attend */
  attendre(): Promise<void>;
  /** remet l'appli en fichiers (les données restent aussi dans la base) */
  retour(): Promise<string>;
  /** l'appli repasse dans la base */
  repasser(): Promise<string>;
}
const migrables = new Map<string, Migrable>();
export function inscrireMigrable(m: Migrable): void { migrables.set(m.id, m); }
export const lesMigrables = (): Migrable[] => [...migrables.values()];

// ---------------- La base de cet Odin (une seule, posée au démarrage) ----------------
let courante: BaseOdin | undefined;
const abonnes = new Set<(b: BaseOdin) => void>();
export const baseOdin = (): BaseOdin | undefined => courante;
export function utiliserBase(b: BaseOdin | undefined): void { courante = b; if (b) for (const f of abonnes) f(b); else migrables.clear(); }
/** Appelé tout de suite si la base existe, sinon dès qu'elle est posée. */
export function quandBase(f: (b: BaseOdin) => void): () => void { abonnes.add(f); if (courante) f(courante); return () => { abonnes.delete(f); }; }
export { PgError };
