// La base d'Odin — les données des applis dans de vraies bases PostgreSQL, gérées par Alexandrie.
//
// - UNE BASE PAR APPLI, au nom de l'appli en majuscules suivi de « _ODIN » (PEGASE_ODIN, PERSONA_ODIN… : noms.ts),
//   toujours écrit entre guillemets (PostgreSQL mettrait sinon le nom en minuscules). Dans chaque base, un schéma par
//   partie (« pegase », « journaux »…), et un compte par appli, du même nom que sa base, qui n'entre que dans sa base.
// - Un compte `odin_lecture` qui ne voit que les vues prévues (`v_*`) de chaque base : c'est par lui qu'Odin (l'IA)
//   lit les données pour répondre, en lecture seule (Alexandrie : « Lire la base d'une appli »).
// - Migrations versionnées par schéma (`<schéma>._migrations`), chacune dans une transaction.
// - Avant, toutes les applis partageaient une base « odin » : ce qu'elle contient est copié dans la base de chaque appli
//   au premier branchement (demenagement.ts), et elle reste là, intacte, comme copie de secours.
// - Le nom d'une appli change (nom affiché) : sa base et son compte sont renommés (renommage.ts), sans rien perdre.
// - Odin démarre même sans base : elle est préparée en arrière-plan, et réessayée tant qu'elle ne répond pas.
//   Les écritures des applis passent par le journal d'attente (attente.ts) : rien n'est perdu.
// - Mots de passe générés, jamais affichés : secrets d'Alexandrie (fichier bloqué) et coffre Thésauros.
// - Chaque création, migration, déménagement et renommage est noté dans la traçabilité (trace.ts).
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pg, PgError } from '../urdr/pg.ts';
import { bases, dirOf, password, saveBases, setPassword, type Base } from '../urdr/bases.ts';
import { Attente, type Ligne } from './attente.ts';
import { connexionPerdue, Reserve, type Lien, type Valeur } from './pool.ts';
import { cibleGardee, choisir, demarrerLocale, garderCible, motDePasseAdmin, SECRET_ADMIN, type Cible } from './serveur.ts';
import { ident, nomBase, nomConforme } from './noms.ts';
import { baseExiste, compteExiste, renommerBase, renommerCompte } from './renommage.ts';
import { ANCIENNE_BASE, demenager } from './demenagement.ts';
import { tracer } from './trace.ts';
import { dossierSauvegardes } from './sauvegarde.ts';
import { NOMS_REPRIS } from '../names.ts';
import type { Result } from '../urdr/pg.ts';

export type { Valeur, Lien } from './pool.ts';
export type Etat = 'absente' | 'preparation' | 'prete' | 'perdue';
export interface Migration { v: number; nom: string; sql: string }
/** Ce qu'une appli déclare : ses migrations et ses écritures (SQL paramétré, rejouable). */
export interface DefAppli {
  id: string; migrations: Migration[]; ecritures: Record<string, string>;
  /** le schéma dans la base (défaut : l'identifiant) */
  schema?: string;
  /** l'appli dont c'est la base (défaut : l'identifiant) : la base s'appelle NOM_ODIN */
  appli?: string;
  /** au déménagement depuis l'ancienne base commune : seulement les lignes dont `colonne` passe `garder` */
  demenagement?: { colonne: string; garder(valeur: string): boolean };
}

export const LECTURE = 'odin_lecture', ID_ALEXANDRIE = 'odin';
/** L'ancienne base commune (avant une base par appli) : gardée comme copie de secours. */
export { ANCIENNE_BASE };
/** Le compte d'une appli : le même nom que sa base (PEGASE_ODIN). */
export const roleDe = (app: string) => nomBase(app);
/** L'entrée de la base d'une appli dans la liste d'Alexandrie. */
export const idAlexandrie = (app: string) => `odin-${app.replace(/_/g, '-')}`;
const ID = /^[a-z][a-z0-9_]{1,30}$/;

/** La base n'est pas prête : l'appli le dit, et réessaie. */
export class BaseAttente extends Error {
  constructor(quoi = 'la base d\'Odin') { super(`${quoi[0].toUpperCase()}${quoi.slice(1)} n'est pas prête pour l'instant (elle démarre, ou PostgreSQL est arrêté) : tes données sont gardées, réessaie dans un instant.`); }
}

// ---------------- Les noms des bases (gardés pour reconnaître un renommage) ----------------
export interface NomGarde { nom: string; precedent?: string; garder?: boolean; depuis?: string }
const fichierNoms = (home: string) => join(dirOf(home), 'noms-bases.json');
export function nomsGardes(home: string): Record<string, NomGarde> { try { return JSON.parse(readFileSync(fichierNoms(home), 'utf8')) as Record<string, NomGarde>; } catch { return {}; } }
export function garderNom(home: string, appli: string, n: NomGarde | undefined): void {
  const l = nomsGardes(home); if (n) l[appli] = n; else delete l[appli];
  mkdirSync(dirOf(home), { recursive: true, mode: 0o700 }); const f = fichierNoms(home), t = `${f}.tmp`; writeFileSync(t, JSON.stringify(l, null, 1), { mode: 0o600 }); renameSync(t, f);
}
/** Le nom de la base d'une appli sur cet Odin : la règle NOM_ODIN, sauf si le propriétaire a demandé de garder un autre nom. */
export function nomDeLaBase(home: string, appli: string): string { const g = nomsGardes(home)[appli]; return g?.garder && g.nom ? g.nom : nomBase(appli); }

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
  /** l'appli dont c'est la base */
  get appli(): string { return this.def.appli ?? this.id; }
  get schema(): string { return this.def.schema ?? this.id; }
  /** le nom de sa base (PEGASE_ODIN) */
  get nomDeBase(): string { return nomDeLaBase(this.base.home, this.appli); }
  get role(): string { return this.nomDeBase; }
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
  /** (base) branche l'appli : sa base et son compte (créés ou renommés), son schéma, ses migrations, le déménagement
   *  depuis l'ancienne base commune, puis envoie ce qui attendait. */
  async brancher(): Promise<void> {
    if (!ID.test(this.id) || !ID.test(this.schema) || !ID.test(this.appli)) throw new Error(`identifiant d'appli invalide pour la base : ${this.id}`);
    const { nom, motDePasse } = await this.base.baseDe(this.appli);
    const role = nom, schema = ident(this.schema), adm = this.base.adminSur(nom);
    await adm.avec(async (c) => {
      await c.simple(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${ident(role)}`);
      // Le schéma public ne sert à personne : aucune appli n'y crée rien.
      await c.simple('REVOKE ALL ON SCHEMA public FROM PUBLIC').catch(() => undefined);
      await c.simple(`ALTER ROLE ${ident(role)} IN DATABASE ${ident(nom)} SET search_path = ${this.base.schemasDe(this.appli).map(ident).join(', ')}`);
    });
    await this.reserve?.fermer();
    const cible = this.base.cible!;
    const res = new Reserve({ host: cible.hote, port: cible.port, user: role, password: motDePasse, database: nom, ssl: 'non' }, 2);
    // Les migrations, chacune dans une transaction, par le compte de l'appli (il possède son schéma).
    const mig = `${schema}._migrations`;
    await res.avec((c) => c.simple(`CREATE TABLE IF NOT EXISTS ${mig} (version int PRIMARY KEY, nom text NOT NULL, faite timestamptz NOT NULL DEFAULT now()); GRANT USAGE ON SCHEMA ${schema} TO ${LECTURE}`));
    const faites = new Set((await res.q(`SELECT version FROM ${mig}`)).rows.map((x) => Number(x[0])));
    for (const m of [...this.def.migrations].sort((a, b) => a.v - b.v)) {
      if (faites.has(m.v)) continue;
      await res.migration(`SET LOCAL search_path = ${schema};\n${m.sql};\nINSERT INTO ${mig} (version, nom) VALUES (${Math.trunc(m.v)}, ${lit(m.nom)})`);
      tracer(this.base.home, { qui: 'Odin (démarrage)', appli: this.appli, base: nom, tables: [this.schema], op: 'migration', pourquoi: `migration ${Math.trunc(m.v)} : ${m.nom}` });
    }
    // Ce qui était dans l'ancienne base commune « odin » : copié une fois (l'ancienne base n'est pas touchée).
    if (await this.base.ancienneExiste()) {
      const d = this.def.demenagement;
      const r = await this.base.adminSur(ANCIENNE_BASE).avec((src) => adm.avec((dst) => demenager(src, dst, this.schema, { filtre: d ? { colonne: d.colonne, garder: d.garder } : undefined })));
      if (!r.deja) tracer(this.base.home, { qui: 'Odin (démarrage)', appli: this.appli, base: nom, tables: r.tables.map((t) => `${this.schema}.${t}`), op: 'demenagement', pourquoi: `copie depuis l'ancienne base commune « ${ANCIENNE_BASE} » (gardée intacte)`, lignes: r.lignes, ok: true });
    }
    this.reserve = res; this.prete = true; this.erreur = undefined;
    await this.vider();
    this.emit('prete');
  }
  /** (base) la connexion est perdue : les écritures attendent sur le disque. */
  perdre(raison: string): void { if (!this.prete) return; this.prete = false; this.erreur = raison; this.emit('perdue', raison); }
  async fermer(): Promise<void> { if (this.relance) clearTimeout(this.relance); this.relance = undefined; this.prete = false; await this.reserve?.fermer(); this.reserve = undefined; }
}
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

/** LE serveur de bases d'Odin (un par dossier d'Odin) : une base par appli. */
export class BaseOdin extends EventEmitter {
  readonly home: string;
  etat: Etat = 'absente';
  message = 'La base d\'Odin n\'est pas encore préparée.';
  /** la raison seule de la dernière préparation manquée (sans la phrase autour), tant qu'elle vaut */
  cause?: string;
  cible?: Cible;
  /** connexions administrateur : « postgres » (créer, renommer) et une par base d'appli */
  private admins = new Map<string, Reserve>(); private admin?: Reserve; private pwAdmin?: string;
  private applis = new Map<string, AppliBase>(); private o: OptionsBase;
  private preparees = new Map<string, Promise<{ nom: string; motDePasse: string }>>(); private ancienne?: boolean;
  private minuterie?: ReturnType<typeof setInterval>; private enCours?: Promise<void>; private arretee = false;
  constructor(home: string, o: OptionsBase = {}) { super(); this.home = home; this.o = o; this.setMaxListeners(50); }
  /** Complète les options (base préparée avant les applis, pour les réglages : le coffre arrive ensuite). */
  regler(o: Partial<OptionsBase>): void { this.o = { ...this.o, ...o }; }

  /** Une appli (créée une fois) ; elle se branche dès que la base est prête. */
  appli(def: DefAppli, dossier: string): AppliBase {
    let a = this.applis.get(def.id); if (a) return a;
    a = new AppliBase(this, def, join(dossier, '.attente-base.jsonl')); this.applis.set(def.id, a);
    if (this.etat === 'prete' && this.admin && this.cible) void a.brancher().catch((e) => { a!.erreur = (e as Error).message; this.log(`${def.id} : ${(e as Error).message}`); });
    return a;
  }
  applisBranchees(): AppliBase[] { return [...this.applis.values()]; }
  /** Les noms des bases des applis branchées (pour les sauvegardes et l'état). */
  basesDesApplis(): string[] { return [...new Set([...this.applis.values()].map((a) => a.nomDeBase))].sort(); }
  /** Les schémas d'une base (search_path du compte de l'appli). */
  schemasDe(appli: string): string[] { return [...new Set([...this.applis.values()].filter((a) => a.appli === appli).map((a) => a.schema))].sort(); }

  /** Prépare la base en arrière-plan, et la surveille (réessaie tant qu'elle ne répond pas). */
  demarrer(): Promise<void> {
    const tick = () => (this.arretee ? Promise.resolve() : this.verifier());
    this.minuterie = setInterval(() => void tick(), this.o.verifierMs ?? 15_000); this.minuterie.unref?.();
    return tick();
  }
  /** Vérifie maintenant (et prépare si besoin) ; une seule vérification à la fois. */
  verifier(): Promise<void> { return (this.enCours ??= this.verifierUneFois().finally(() => { this.enCours = undefined; })); }
  private async verifierUneFois(): Promise<void> {
    if (this.etat === 'prete' && this.admin) {
      if (await this.admin.repond()) { for (const a of this.applis.values()) if (!a.prete) await a.brancher().catch((e) => { a.erreur = (e as Error).message; }); return; }
      this.signalerPerte();
    }
    try { await this.preparer(); }
    catch (e) {
      const was = this.etat as Etat; this.etat = was === 'perdue' || was === 'prete' ? 'perdue' : 'absente';
      this.cause = (e as Error).message;
      this.message =`La base d'Odin ne répond pas (${(e as Error).message}). Odin marche quand même : les écritures des applis attendent sur le disque et partiront dès qu'elle revient.`;
      if (was !== (this.etat as Etat) || was === 'preparation') this.emit('etat', this.etat, this.message);
    }
  }
  /** Une appli a vu la connexion tomber. */
  signalerPerte(): void {
    if (this.etat !== 'prete') return;
    this.etat = 'perdue'; this.message = 'La base d\'Odin ne répond plus : les écritures attendent sur le disque et partiront dès qu\'elle revient.';
    for (const a of this.applis.values()) a.perdre(this.message);
    this.fermerAdmins(); this.preparees.clear();
    this.emit('etat', this.etat, this.message); this.log(this.message);
  }
  private fermerAdmins(): void { for (const r of this.admins.values()) void r.fermer(); this.admins.clear(); this.admin = undefined; }

  /** Connexion administrateur à une base (créée une fois). */
  adminSur(base: string): Reserve {
    const c = this.cible; if (!c) throw new BaseAttente();
    let r = this.admins.get(base);
    if (!r) { r = new Reserve({ host: c.hote, port: c.port, user: c.admin, password: this.pwAdmin, database: base, ssl: 'non' }, 2); this.admins.set(base, r); }
    return r;
  }
  /** L'ancienne base commune « odin » existe-t-elle encore sur ce serveur ? (copie à faire, ou copie de secours) */
  async ancienneExiste(): Promise<boolean> {
    if (this.ancienne === undefined) this.ancienne = await this.administrateur().avec((c) => baseExiste(c, ANCIENNE_BASE));
    return this.ancienne;
  }

  /** La base et le compte d'une appli : renommés si son nom a changé, créés s'ils n'existent pas (une fois par démarrage). */
  baseDe(appli: string): Promise<{ nom: string; motDePasse: string }> {
    let p = this.preparees.get(appli);
    if (!p) { p = this.preparerBaseAppli(appli); this.preparees.set(appli, p); p.catch(() => this.preparees.delete(appli)); }
    return p;
  }
  private async preparerBaseAppli(appli: string): Promise<{ nom: string; motDePasse: string }> {
    const c = this.cible!, voulu = nomDeLaBase(this.home, appli), garde = nomsGardes(this.home)[appli];
    if (!garde?.garder && !nomConforme(voulu)) throw new Error(`nom de base invalide pour ${appli} : ${voulu}`);
    // Un nom repris à une autre appli (23/11 : « Arche » passe de la sauvegarde des bases aux conteneurs) : la base qui
    // porte encore ce nom est celle de l'autre appli ; elle est renommée d'abord (son nouveau nom), jamais reprise ici.
    const gardes = nomsGardes(this.home), liste = bases(this.home);
    const autre = Object.entries(gardes).find(([a, g]) => a !== appli && g.nom === voulu)?.[0];
    if (autre && nomDeLaBase(this.home, autre) === voulu) throw new Error(`la base ${voulu} est celle de ${autre} : rien n'est touché`);
    if (autre) await this.baseDe(autre);
    // Même sans nom gardé (noms-bases.json perdu ou abîmé) : une base qui porte l'ANCIEN nom d'une autre appli
    // (NOMS_REPRIS) est la sienne ; elle passe d'abord chez elle (si elle ne peut pas partir, l'erreur remonte ici et
    // rien n'est touché). Après, une base de ce nom encore là ne peut plus être la sienne.
    const reprisDe = NOMS_REPRIS.filter((r) => r.id !== appli && nomBase(r.id, r.de) === voulu).map((r) => r.id);
    const aNous = garde?.nom === voulu || liste.some((b) => b.id === idAlexandrie(appli) && b.base === voulu);
    if (!aNous) for (const r of reprisDe) if (r !== autre) await this.baseDe(r);
    // Qui d'autre dit qu'un nom de base est le sien (nom gardé, ou entrée d'Alexandrie) : ce nom n'est jamais repris ici.
    const pris = (n: string) => Object.entries(gardes).some(([a, g]) => a !== appli && g.nom === n) || liste.some((b) => b.id !== idAlexandrie(appli) && b.base === n && b.id.startsWith('odin-'));
    const secret = `base-${appli}`;
    let pw = password(this.home, secret); const nouveau = !pw; if (!pw) pw = randomBytes(24).toString('base64url');
    // Les noms à reprendre : le nom gardé (l'appli a changé de nom), et le même nom écrit sans guillemets (minuscules).
    // Sans nom gardé : son entrée d'Alexandrie, et son ancien nom repris par une autre appli (NOMS_REPRIS) — si personne
    // d'autre ne le dit sien.
    const secours = garde ? [] : [liste.find((b) => b.id === idAlexandrie(appli))?.base, ...NOMS_REPRIS.filter((r) => r.id === appli).map((r) => nomBase(appli, r.de))].filter((n): n is string => Boolean(n) && !pris(n!));
    const anciens = [...new Set([garde?.nom, ...secours, voulu.toLowerCase()])].filter((x): x is string => Boolean(x) && x !== voulu);
    // Un renommage pas fini (le nom gardé n'est pas encore le nouveau) : le mot de passe du compte est remis quoi qu'il
    // arrive (un compte au mot de passe MD5 le perd en changeant de nom, et une coupure a pu tomber juste entre les deux).
    const aFinir = anciens.length > 0 && (!garde || garde.nom !== voulu);
    await this.administrateur().avec(async (x) => {
      for (const ancien of anciens) {
        const rb = await renommerBase(x, ancien, voulu);
        if (rb === 'renommee') {
          await this.admins.get(ancien)?.fermer(); this.admins.delete(ancien);
          tracer(this.home, { qui: 'Odin (démarrage)', appli, base: voulu, op: 'renommage', pourquoi: `base renommée : ${ancien} → ${voulu} (règle NOM_ODIN)`, ok: true });
        }
        if ((await renommerCompte(x, ancien, voulu, pw)) === 'renommee') tracer(this.home, { qui: 'Odin (démarrage)', appli, base: voulu, op: 'renommage', pourquoi: `compte renommé : ${ancien} → ${voulu}`, ok: true });
      }
      const existe = await compteExiste(x, voulu);
      if (!existe || nouveau || aFinir) await x.simple((await x.query(`SELECT format(${existe ? "'ALTER ROLE %I LOGIN PASSWORD %L'" : "'CREATE ROLE %I LOGIN PASSWORD %L'"}, $1::text, $2::text)`, [voulu, pw])).rows[0][0]!);
      if (voulu !== c.admin) await x.simple(`GRANT ${ident(voulu)} TO ${ident(c.admin)}`).catch(() => undefined);
      if (!(await baseExiste(x, voulu))) {
        await x.simple(`CREATE DATABASE ${ident(voulu)} OWNER ${ident(c.admin)} ENCODING 'UTF8' TEMPLATE template0`);
        await x.simple(`REVOKE ALL ON DATABASE ${ident(voulu)} FROM PUBLIC`);
        tracer(this.home, { qui: 'Odin (démarrage)', appli, base: voulu, op: 'creation', pourquoi: 'première base de l\'appli dans Alexandrie', ok: true });
      }
      await x.simple(`GRANT CONNECT ON DATABASE ${ident(voulu)} TO ${ident(voulu)}, ${LECTURE}`);
    });
    setPassword(this.home, secret, pw);
    // Les sauvegardes chiffrées de cette base portent son nom (<BASE>-<date>.dump.odinbk) : elles le suivent, sinon une
    // sauvegarde de l'ancien nom serait prise pour celle de l'appli qui reprend ce nom. Jamais par-dessus un fichier.
    for (const ancien of anciens) suivreSauvegardes(this.home, ancien, voulu);
    garderNom(this.home, appli, { ...garde, nom: voulu, precedent: garde?.nom && garde.nom !== voulu ? garde.nom : garde?.precedent, depuis: garde?.nom === voulu ? garde.depuis : new Date().toISOString() });
    inscrireDansAlexandrie(this.home, c, appli, voulu);
    return { nom: voulu, motDePasse: pw };
  }

  /**
   * Renomme la base d'une appli (et son compte) ; `garder` : ce nom reste (Odin ne remet pas la règle NOM_ODIN).
   * Sert au retour arrière d'un renommage. Les connexions de l'appli sont fermées puis rouvertes sous le nouveau nom.
   */
  async renommer(appli: string, nouveau: string, o: { garder?: boolean; pourquoi?: string } = {}): Promise<string> {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(nouveau)) throw new Error('nom de base invalide (lettres, chiffres et « _ », 63 caractères au plus)');
    const ancien = nomDeLaBase(this.home, appli), lesApplis = [...this.applis.values()].filter((a) => a.appli === appli);
    if (ancien === nouveau) return `La base de ${appli} s'appelle déjà ${nouveau}.`;
    for (const a of lesApplis) { a.perdre('base en cours de renommage'); await a.fermer(); }
    await this.admins.get(ancien)?.fermer(); this.admins.delete(ancien);
    const pw = password(this.home, `base-${appli}`);
    const r = await this.administrateur().avec(async (x) => { const rb = await renommerBase(x, ancien, nouveau); await renommerCompte(x, ancien, nouveau, pw); return rb; });
    garderNom(this.home, appli, { nom: nouveau, precedent: ancien, garder: o.garder, depuis: new Date().toISOString() });
    this.preparees.delete(appli);
    tracer(this.home, { qui: 'Odin (Alexandrie)', appli, base: nouveau, op: 'renommage', pourquoi: o.pourquoi ?? `base renommée : ${ancien} → ${nouveau}`, ok: true });
    for (const a of lesApplis) await a.brancher().catch((e) => { a.erreur = (e as Error).message; });
    return r === 'absente' ? `La base ${ancien} n'existe pas encore : elle sera créée sous le nom ${nouveau}.` : `🗄 Base ${ancien} renommée en ${nouveau} (données intactes).`;
  }

  private async preparer(): Promise<void> {
    if (this.etat !== 'perdue') { this.etat = 'preparation'; this.message = 'La base d\'Odin se prépare…'; this.cause = undefined; }
    let c = this.o.cible ?? cibleGardee(this.home);
    if (!c || !motDePasseAdmin(this.home)) c = (await choisir(this.home)) ?? (this.o.hringhorni === false || !HRINGHORNI_POSSIBLE ? undefined : await hringhorni(this.home));
    if (!c) throw new Error(HRINGHORNI_POSSIBLE ? 'pas de PostgreSQL sur cette machine : installe-le (paquet « postgresql ») ou laisse Hringhorni le faire' : `pas de PostgreSQL utilisable sur cette machine (${process.platform}) : Odin ne sait en préparer un que sous Linux pour l'instant`);
    if (c.mode === 'locale') await demarrerLocale(c);
    if (c.mode === 'hringhorni') c = { ...c, ...(await adresseHringhorni(c)) };
    this.cible = c;
    const pw = motDePasseAdmin(this.home); this.pwAdmin = pw;
    // On vérifie que le serveur répond avant de garder quoi que ce soit.
    const p = await Pg.connect({ host: c.hote, port: c.port, user: c.admin, password: pw, database: 'postgres', ssl: 'non', timeoutMs: 5000 });
    await p.close();
    this.fermerAdmins(); this.preparees.clear(); this.ancienne = undefined;
    const admin = this.adminSur('postgres'); this.admin = admin;
    // Le compte de lecture d'Odin (vues seulement).
    let lpw = password(this.home, ID_ALEXANDRIE); const nouveau = !lpw; if (!lpw) lpw = randomBytes(24).toString('base64url');
    await admin.avec(async (x) => {
      const existe = (await x.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [LECTURE])).rows.length > 0;
      if (!existe || nouveau) await x.simple((await x.query(`SELECT format(${existe ? "'ALTER ROLE %I LOGIN PASSWORD %L'" : "'CREATE ROLE %I LOGIN PASSWORD %L'"}, $1::text, $2::text)`, [LECTURE, lpw])).rows[0][0]!);
    });
    setPassword(this.home, ID_ALEXANDRIE, lpw);
    inscrireAncienne(this.home, c, await this.ancienneExiste());
    if (!c.coffre && this.o.coffre) { try { await this.o.coffre('Base · Données des applis d\'Odin', c.admin, pw!, `${c.hote}:${c.port}`); c.coffre = true; if (!this.o.cible) garderCible(this.home, c); } catch { /* coffre fermé : réessayé au prochain démarrage */ } }
    for (const a of this.applis.values()) await a.brancher().catch((e) => { a.erreur = (e as Error).message; this.log(`${a.id} : ${(e as Error).message}`); if (connexionPerdue(e)) throw e; });
    const was = this.etat as Etat; this.etat = 'prete';
    this.message = `La base d'Odin est prête (${({ machine: 'PostgreSQL de la machine', locale: 'serveur PostgreSQL d\'Odin', hringhorni: 'Hringhorni, conteneur odin-pg' } as const)[c.mode]}, ${c.hote}:${c.port}) : une base par appli (${this.basesDesApplis().join(', ') || 'aucune pour l\'instant'}).`;
    if (was !== 'prete') { this.emit('etat', this.etat, this.message); this.log(this.message); }
  }
  /** Lien administrateur à la base « postgres » (créer, renommer, sauvegarder). */
  administrateur(): Reserve { if (!this.admin || (this.etat !== 'prete' && this.etat !== 'preparation' && this.etat !== 'perdue')) throw new BaseAttente(); return this.admin; }
  async arreter(): Promise<void> {
    this.arretee = true; if (this.minuterie) clearInterval(this.minuterie);
    await this.enCours?.catch(() => undefined);
    // Ce qui attend part si la base répond (5 s au plus) ; sinon il reste sur le disque et partira au prochain démarrage.
    for (const a of this.applis.values()) { await Promise.race([a.vider().catch(() => undefined), new Promise((r) => setTimeout(r, 5000).unref())]); await a.fermer(); }
    for (const r of this.admins.values()) await r.fermer(); this.admins.clear(); this.admin = undefined;
  }
  private log(t: string): void { (this.o.log ?? ((x: string) => console.log(`[base] ${x}`)))(t); }
}

/** Les sauvegardes chiffrées d'une base renommée prennent son nouveau nom (même date) ; un fichier déjà là n'est jamais écrasé. */
function suivreSauvegardes(home: string, ancien: string, nouveau: string): void {
  const d = dossierSauvegardes(home); let l: string[] = []; try { l = readdirSync(d); } catch { return; }
  for (const f of l) {
    const reste = f.startsWith(ancien) ? f.slice(ancien.length) : '';
    if (!/^-\d{8}-\d{6}\.dump\.odinbk$/.test(reste)) continue;
    const vers = join(d, `${nouveau}${reste}`); if (existsSync(vers)) continue;
    try { renameSync(join(d, f), vers); tracer(home, { qui: 'Odin (démarrage)', appli: nouveau, base: nouveau, op: 'renommage', pourquoi: `sauvegarde renommée : ${f} → ${nouveau}${reste}`, ok: true }); } catch { /* réessayé au prochain démarrage */ }
  }
}
/** La base d'une appli dans la liste d'Alexandrie (compte de lecture : Odin la lit pour répondre, Alexandrie Studio la montre). */
function inscrireDansAlexandrie(home: string, c: Cible, appli: string, nom: string): void {
  const id = idAlexandrie(appli), l = bases(home), avant = l.find((b) => b.id === id);
  const b: Base = { id, nom, type: 'postgres', ...(c.mode === 'hringhorni' ? { conteneur: c.conteneur } : { hote: c.hote, port: c.port }), utilisateur: LECTURE, base: nom, ssl: 'non', version: undefined, ajoutee: avant?.ajoutee ?? new Date().toISOString() };
  if (JSON.stringify(avant) !== JSON.stringify(b)) saveBases(home, [...l.filter((x) => x.id !== id), b]);
  const lpw = password(home, ID_ALEXANDRIE); if (lpw && password(home, id) !== lpw) setPassword(home, id, lpw);
}
/** L'ancienne base commune : montrée comme copie de secours tant qu'elle existe, retirée de la liste sinon. */
function inscrireAncienne(home: string, c: Cible, existe: boolean): void {
  const l = bases(home).filter((b) => b.id !== ID_ALEXANDRIE);
  if (!existe) { if (l.length !== bases(home).length) saveBases(home, l); return; }
  saveBases(home, [...l, { id: ID_ALEXANDRIE, nom: 'Ancienne base commune d\'Odin (copie de secours)', type: 'postgres', ...(c.mode === 'hringhorni' ? { conteneur: c.conteneur } : { hote: c.hote, port: c.port }), utilisateur: LECTURE, base: ANCIENNE_BASE, ssl: 'non', version: undefined, ajoutee: bases(home).find((b) => b.id === ID_ALEXANDRIE)?.ajoutee ?? new Date().toISOString() }]);
}

/** Hringhorni a besoin de Linux (espaces de noms, unshare) : ailleurs, il n'est pas essayé (il téléchargerait l'image
 *  PostgreSQL sur un registre extérieur, attendrait dix minutes pour rien, et recommencerait à chaque vérification). */
const HRINGHORNI_POSSIBLE = process.platform === 'linux';
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
