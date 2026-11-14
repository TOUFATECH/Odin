// La base d'Odin — les journaux et historiques des applis (alertes, bulles, historique d'Arche, connexions de
// Persona…) : schéma « journaux », une ligne par entrée. Même usage qu'avant pour l'appli : `ajouter(e)` et `tout()`.
//
// - Sans base (ou pas encore) : le rangement d'avant (fichier JSONL, ou ce que l'appli fournit).
// - Base prête la première fois : le journal y passe (rejouable : rien n'est doublé), le fichier d'avant va dans une
//   copie de secours (avant-base/), un repère dit « ce journal vit dans la base ».
// - Ensuite : les dernières entrées restent en mémoire (lecture immédiate), chaque ajout passe par le journal d'attente
//   (sur le disque) puis dans la base. Base arrêtée : rien n'est perdu.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type BaseOdin, type DefAppli } from './index.ts';

export const DEF_JOURNAUX: DefAppli = {
  id: 'journaux',
  migrations: [{
    v: 1, nom: 'journaux et historiques des applis',
    sql: `
CREATE TABLE entrees (n bigserial NOT NULL, uid text PRIMARY KEY, journal text NOT NULL, quand timestamptz NOT NULL, donnees jsonb NOT NULL);
-- n : l'ordre d'arrivée (celui du fichier d'avant), gardé même quand deux entrées ont la même heure
CREATE INDEX entrees_journal ON entrees (journal, n);
CREATE INDEX entrees_quand ON entrees (journal, quand);
-- Ce qu'Odin peut lire (compte odin_lecture). Les connexions de Persona : sans adresse IP ni raison détaillée.
CREATE VIEW v_alertes AS SELECT quand, donnees->>'module' AS appli, donnees->>'level' AS niveau, donnees->>'title' AS titre, donnees->>'detail' AS detail FROM entrees WHERE journal = 'alertes';
CREATE VIEW v_bulles AS SELECT quand, donnees->>'app' AS appli, donnees->>'level' AS niveau, donnees->>'title' AS titre, donnees->>'detail' AS detail FROM entrees WHERE journal = 'bulles';
CREATE VIEW v_sauvegardes AS SELECT quand, donnees->>'base' AS base, (donnees->>'ok')::boolean AS reussie, donnees->>'raison' AS raison, (donnees->>'taille')::bigint AS taille, donnees->>'erreur' AS erreur FROM entrees WHERE journal = 'arche';
CREATE VIEW v_connexions AS SELECT quand, donnees->>'login' AS compte, (donnees->>'ok')::boolean AS reussie FROM entrees WHERE journal = 'connexions';
GRANT SELECT ON v_alertes, v_bulles, v_sauvegardes, v_connexions TO odin_lecture`,
  }],
  ecritures: {
    ajout: 'INSERT INTO entrees (uid, journal, quand, donnees) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (uid) DO NOTHING',
  },
};

/** Le rangement d'avant la base : un fichier JSONL (par défaut), ou ce que l'appli fournit (ses réglages…). */
export interface RangementJournal<T> {
  lire(): T[];
  ajouter(e: T): void;
  /** le journal est passé dans la base (sa copie de secours est faite) : le rangement d'avant est vidé */
  vider(): void;
  /** retour en fichiers : tout réécrire */
  reecrire(l: T[]): void;
}
export function fichierJsonl<T>(f: string, garder?: number): RangementJournal<T> {
  const lire = (): T[] => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } }); } catch { return []; } };
  const reecrire = (l: T[]) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, l.length ? `${l.map((x) => JSON.stringify(x)).join('\n')}\n` : '', { mode: 0o600 }); renameSync(t, f); };
  return {
    lire,
    ajouter: (e) => { appendFileSync(f, `${JSON.stringify(e)}\n`, { mode: 0o600 }); if (garder) { const l = lire(); if (l.length > garder * 2) reecrire(l.slice(-garder)); } },
    vider: () => rmSync(f, { force: true }),
    reecrire,
  };
}

interface Ent<T> { uid: string; e: T }
const horodatage = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export class Journal<T extends object> {
  readonly nom: string;
  private r: RangementJournal<T>;
  /** dossier des repères et de la copie de secours */
  private dossier: string;
  private quand: (e: T) => string | number | undefined;
  private garder: number;
  private appli?: AppliBase;
  private memo?: Array<Ent<T>>;
  private lu = false;
  private off?: () => void;
  constructor(nom: string, dossier: string, o: { rangement?: RangementJournal<T>; quand?: (e: T) => string | number | undefined; garder?: number } = {}) {
    this.nom = nom; this.dossier = dossier; this.garder = o.garder ?? 2000;
    this.r = o.rangement ?? fichierJsonl<T>(join(dossier, `${nom}.jsonl`));
    this.quand = o.quand ?? ((e) => (e as { at?: string }).at);
    this.off = quandBase((b) => this.brancher(b));
  }
  private get repere() { return join(this.dossier, `.${this.nom}.en-base.json`); }
  private get retour() { return join(this.dossier, `.${this.nom}.fichiers.json`); }
  /** où vit le journal : fichiers, ou base (lue ou pas encore) */
  get support(): 'fichiers' | 'base' { return this.memo ? 'base' : 'fichiers'; }

  ajouter(e: T): void {
    if (!this.memo || !this.appli) { this.r.ajouter(e); return; }
    const x = { uid: `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`, e };
    this.memo.push(x); if (this.memo.length > this.garder * 1.5) this.memo = this.memo.slice(-this.garder);
    this.appli.ecrire(['ajout', x.uid, this.nom, quandIso(this.quand(e)), JSON.stringify(e)]);
  }
  /** Les entrées (de la plus ancienne à la plus récente) ; en base : les dernières (`garder`). */
  tout(): T[] { return this.memo ? this.memo.map((x) => x.e) : this.r.lire(); }
  /** La base est là, mais ce journal n'a pas encore été relu (Odin vient de démarrer). */
  enAttente(): boolean { return Boolean(this.memo) && !this.lu; }
  fermer(): void { this.off?.(); this.off = undefined; }

  private brancher(b: BaseOdin): void {
    if (existsSync(this.retour)) return;
    const a = b.appli(DEF_JOURNAUX, join(b.home, 'valhalla', 'journaux')); this.appli = a;
    if (existsSync(this.repere) && !this.memo) this.memo = [];
    let enCours: Promise<void> | undefined;
    const pret = () => (enCours ??= (async () => {
      if (existsSync(this.retour)) return;
      if (existsSync(this.repere)) { if (!this.lu) await this.relire(); return; }
      await this.migrer();
    })().catch((e) => { if (!(e instanceof BaseAttente)) console.error(`[base] journal ${this.nom} : ${(e as Error).message}`); }).finally(() => { enCours = undefined; }));
    a.on('prete', () => void pret()); if (a.prete) void pret();
    inscrireMigrable({
      id: `journal:${this.nom}`, nom: `Journal ${this.nom}`,
      etat: () => ({ support: this.support, pret: !this.enAttente(), attente: this.memo ? a.attente.taille : 0, message: this.memo ? (this.lu ? 'dans la base' : 'dans la base, en attente qu\'elle réponde') : existsSync(this.retour) ? 'en fichiers (retour demandé)' : 'en fichiers (passera dans la base dès qu\'elle sera prête)' }),
      attendre: async () => { await pret(); await a.vider(); },
      retour: () => this.revenir(),
      repasser: async () => { rmSync(this.retour, { force: true }); this.brancher(b); await pret(); return `🗄 Journal ${this.nom} : ${this.memo ? 'de nouveau dans la base' : 'repassera dans la base dès qu\'elle sera prête'}.`; },
    });
  }
  private async relire(): Promise<void> {
    const a = this.appli!; await a.vider();
    const r = await a.q('SELECT uid, donnees::text FROM entrees WHERE journal = $1 ORDER BY n DESC LIMIT $2', [this.nom, this.garder]);
    const lus = r.rows.reverse().map(([uid, d]) => ({ uid: uid!, e: JSON.parse(d!) as T })), vus = new Set(lus.map((x) => x.uid));
    this.memo = [...lus, ...(this.memo ?? []).filter((x) => !vus.has(x.uid))]; this.lu = true;
  }
  /** Fichier → base : tout est envoyé et recompté, le fichier d'avant va dans la copie de secours. */
  private async migrer(): Promise<void> {
    const a = this.appli!, l = this.r.lire();
    // Identifiant stable par ligne : rejouer la migration (Odin arrêté au milieu) ne double rien.
    const ents = l.map((e, i) => ({ uid: `m-${createHash('sha256').update(`${this.nom}\n${i}\n${JSON.stringify(e)}`).digest('hex').slice(0, 24)}`, e }));
    this.memo = ents.slice(-this.garder); this.lu = true;
    for (let i = 0; i < ents.length; i += 1000) a.ecrire(...ents.slice(i, i + 1000).map((x): [string, string, string, string, string] => ['ajout', x.uid, this.nom, quandIso(this.quand(x.e)), JSON.stringify(x.e)]));
    await a.vider();
    const n = Number((await a.q('SELECT count(*) FROM entrees WHERE journal = $1', [this.nom])).rows[0][0]);
    if (n < ents.length) { this.memo = undefined; this.lu = false; throw new Error(`migration incomplète (${n}/${ents.length}) : le journal reste en fichier`); }
    // Copie de secours : le journal tel qu'il était, en JSONL (relisible, et rechargeable par le retour en fichiers).
    const secours = join(this.dossier, 'avant-base'); mkdirSync(secours, { recursive: true, mode: 0o700 });
    writeFileSync(join(secours, `${this.nom}.${horodatage(Date.now())}.jsonl`), l.map((x) => JSON.stringify(x)).join('\n') + (l.length ? '\n' : ''), { mode: 0o600 });
    writeFileSync(this.repere, JSON.stringify({ depuis: new Date().toISOString(), entrees: ents.length }), { mode: 0o600 });
    this.r.vider();
  }
  /** Base → fichiers : tout le journal est relu dans la base et réécrit à l'ancienne. */
  private async revenir(): Promise<string> {
    const a = this.appli; if (!this.memo || !a) return `Journal ${this.nom} : déjà en fichiers.`;
    await a.vider();
    const l = (await a.q('SELECT donnees::text FROM entrees WHERE journal = $1 ORDER BY n', [this.nom])).rows.map(([d]) => JSON.parse(d!) as T);
    this.r.reecrire(l);
    writeFileSync(this.retour, JSON.stringify({ depuis: new Date().toISOString() }), { mode: 0o600 }); rmSync(this.repere, { force: true });
    this.memo = undefined; this.lu = false;
    return `↩ Journal ${this.nom} revenu en fichiers (${l.length} entrée(s)). Les entrées restent aussi dans la base.`;
  }
}
function quandIso(v: string | number | undefined): string {
  const t = typeof v === 'number' ? v : v ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
}
