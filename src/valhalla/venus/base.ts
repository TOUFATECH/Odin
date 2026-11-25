// Vénus dans la base d'Odin (Alexandrie) : la bibliothèque, les écrans, les télécommandes, la reprise, ma liste,
// l'historique, les demandes et les réglages YouTube de Vénus, rangés dans la base VENUS_ODIN (schéma « freyja »)
// dès qu'elle est prête ; avant (et sans PostgreSQL), dans des fichiers JSON sous ~/.odin/valhalla/freyja/ (mode
// 0o600), qui passent dans la base au premier branchement. L'index de scan et les listes restent lisibles sans base.
//
// Vie privée : l'historique, les demandes et l'historique YouTube sont CHIFFRÉS (clé de la machine, coffre) ; les
// jetons des télécommandes ne sont gardés qu'en empreinte (le secret va au coffre). Les vues v_* pour odin_lecture
// n'exposent jamais ces contenus en clair : seulement des compteurs et les champs publics.
//
// On suit le modèle d'Écho (rodd/conversation-historique.ts) : un DefAppli, le repli fichier d'abord, la base en
// miroir rejouable par le journal d'attente.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli, type Valeur } from '../base/index.ts';
import { nomBase } from '../base/noms.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

/** Le nom de la base de Vénus dans Alexandrie : VENUS_ODIN (= nomBase('freyja')). */
export const nomBaseVenus = (): string => nomBase('freyja');
/** Le dossier de données de Vénus (le même que le ctx.dir du module freyja). */
export const dirVenus = (home: string): string => join(home, 'valhalla', 'freyja');

/** Les collections de Vénus. Les trois marquées privées sont chiffrées au repos et jamais exposées en clair. */
export type Collection =
  | 'dossiers' | 'oeuvres' | 'episodes' | 'pistes' | 'fichiers' | 'reprise' | 'ma_liste'
  | 'historique' | 'demandes' | 'ecrans' | 'telecommandes'
  | 'yt_abonnements' | 'yt_historique' | 'yt_reglages'
  // Acquisition (phase 2) : tables posées, remplies plus tard.
  | 'sources' | 'envies' | 'filtres' | 'telechargements' | 'acq_journal' | 'lots' | 'acq_reglages' | 'autotest'
  // L'interface de Vénus (lot V1) : la planète et le menu choisis, par profil.
  | 'preferences'
  // Lot V3 : les images gardées par Odin (affiches, fonds, photos, vignettes) et les personnes (distribution).
  | 'images' | 'personnes'
  // Hnoss : les sorties relevées pour « À venir » et le calendrier (et les liens personnels du calendrier).
  | 'sorties'
  // La maison (lot V8) : les séances et votes en famille, les collections et listes de lecture, les téléchargements hors ligne.
  | 'seances' | 'collections' | 'hors_ligne';

/** Les collections privées : contenu chiffré au repos, jamais dans une vue en clair. */
export const PRIVEES: ReadonlySet<Collection> = new Set<Collection>(['historique', 'demandes', 'yt_historique']);
export const COLLECTIONS: Collection[] = ['dossiers', 'oeuvres', 'episodes', 'pistes', 'fichiers', 'reprise', 'ma_liste', 'historique', 'demandes', 'ecrans', 'telecommandes', 'yt_abonnements', 'yt_historique', 'yt_reglages', 'sources', 'envies', 'filtres', 'telechargements', 'acq_journal', 'lots', 'acq_reglages', 'autotest', 'preferences', 'images', 'personnes', 'sorties', 'seances', 'collections', 'hors_ligne'];

/** Un enregistrement d'une collection : un identifiant et des données libres (JSON). */
export interface Enr { id: string; data: Record<string, unknown>; maj: number }

/** Les tables (schéma freyja). Les trois privées gardent un seul champ `chiffre` (contenu chiffré), jamais le clair. */
export const DEF_FREYJA: DefAppli = {
  id: 'freyja', schema: 'freyja', appli: 'freyja',
  migrations: [{
    v: 1, nom: 'bibliothèque, écrans, télécommandes, listes et réglages YouTube de Vénus',
    sql: `
CREATE TABLE dossiers (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE oeuvres (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE episodes (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE pistes (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE fichiers (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE reprise (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE ma_liste (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE historique (id text PRIMARY KEY, chiffre text NOT NULL, maj bigint NOT NULL);
CREATE TABLE demandes (id text PRIMARY KEY, chiffre text NOT NULL, maj bigint NOT NULL);
CREATE TABLE ecrans (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE telecommandes (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE yt_abonnements (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE yt_historique (id text PRIMARY KEY, chiffre text NOT NULL, maj bigint NOT NULL);
CREATE TABLE yt_reglages (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE sources (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE envies (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE filtres (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE telechargements (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE acq_journal (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE lots (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE acq_reglages (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE autotest (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
-- Les vues qu'Odin peut lire (compte odin_lecture) : la bibliothèque publique, et SEULEMENT des compteurs pour ce qui
-- est privé (jamais les titres regardés, les demandes, l'historique YouTube ni les jetons des télécommandes).
CREATE VIEW v_oeuvres AS SELECT id, data->>'type' AS type, data->>'titre' AS titre, data->>'annee' AS annee FROM oeuvres;
CREATE VIEW v_ecrans AS SELECT id, data->>'nom' AS nom, data->>'type' AS type FROM ecrans;
CREATE VIEW v_compteurs AS
  SELECT 'historique' AS liste, count(*) AS nombre FROM historique
  UNION ALL SELECT 'demandes', count(*) FROM demandes
  UNION ALL SELECT 'ma_liste', count(*) FROM ma_liste
  UNION ALL SELECT 'yt_historique', count(*) FROM yt_historique
  UNION ALL SELECT 'telecommandes', count(*) FROM telecommandes;
GRANT SELECT ON v_oeuvres, v_ecrans, v_compteurs TO odin_lecture`,
  }, {
    v: 2, nom: "préférences de l'interface de Vénus (planète, menu) par profil",
    sql: 'CREATE TABLE preferences (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL)',
  }, {
    v: 3, nom: 'images gardées par Odin (affiches, fonds, photos, vignettes) et personnes (distribution) de Vénus',
    sql: `CREATE TABLE images (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE personnes (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL)`,
  }, {
    v: 4, nom: 'sorties relevées par Hnoss (« À venir », calendrier des sorties) et liens personnels du calendrier',
    sql: 'CREATE TABLE sorties (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL)',
  }, {
    v: 5, nom: 'la maison de Vénus : séances et votes en famille, collections et listes de lecture, téléchargements hors ligne',
    sql: `CREATE TABLE seances (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE collections (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
CREATE TABLE hors_ligne (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL)`,
  }],
  ecritures: {
    pose: 'INSERT INTO __t__ (id, data, maj) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, maj = EXCLUDED.maj',
    pose_chiffre: 'INSERT INTO __t__ (id, chiffre, maj) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET chiffre = EXCLUDED.chiffre, maj = EXCLUDED.maj',
    retire: 'DELETE FROM __t__ WHERE id = $1',
    vide: 'DELETE FROM __t__',
  },
};
// Les écritures ci-dessus portent un nom de table à remplacer (__t__) : on en fait une par table, une seule fois.
const TABLES_PUBLIQUES = COLLECTIONS.filter((c) => !PRIVEES.has(c));
for (const t of COLLECTIONS) {
  if (PRIVEES.has(t)) DEF_FREYJA.ecritures[`pose_${t}`] = DEF_FREYJA.ecritures.pose_chiffre.replace(/__t__/g, t);
  else DEF_FREYJA.ecritures[`pose_${t}`] = DEF_FREYJA.ecritures.pose.replace(/__t__/g, t);
  DEF_FREYJA.ecritures[`retire_${t}`] = DEF_FREYJA.ecritures.retire.replace(/__t__/g, t);
  DEF_FREYJA.ecritures[`vide_${t}`] = DEF_FREYJA.ecritures.vide.replace(/__t__/g, t);
}
delete (DEF_FREYJA.ecritures as Record<string, string>).pose;
delete (DEF_FREYJA.ecritures as Record<string, string>).pose_chiffre;
delete (DEF_FREYJA.ecritures as Record<string, string>).retire;
delete (DEF_FREYJA.ecritures as Record<string, string>).vide;
void TABLES_PUBLIQUES;

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const now = () => Date.now();

/**
 * Le magasin de Vénus : les collections en mémoire, écrites dans des fichiers JSON (repli, mode 0o600) et, dès que la
 * base VENUS_ODIN répond, rejouées dedans puis tenues à jour par le journal d'attente. Les trois collections privées
 * sont chiffrées au repos (fichier comme base).
 */
export class MagasinVenus {
  readonly home: string; readonly dir: string;
  private memo = new Map<Collection, Map<string, Enr>>();
  private appli?: AppliBase; private off?: () => void; private branchee = false;
  constructor(home: string, dir: string) {
    this.home = home; this.dir = dir;
    for (const c of COLLECTIONS) this.memo.set(c, this.lireFichier(c));
  }
  /** où vivent les données en ce moment */
  get support(): 'fichiers' | 'base' { return this.branchee ? 'base' : 'fichiers'; }

  /** Branche sur Alexandrie : à faire une fois au démarrage (pas pendant les essais sans PostgreSQL). */
  brancher(): void {
    if (this.off) return;
    this.off = quandBase((b) => {
      const a = b.appli(DEF_FREYJA, this.dir); this.appli = a;
      const pret = () => void this.versBase().catch((e) => { if (!(e instanceof BaseAttente)) console.error(`[base] Vénus : ${(e as Error).message}`); });
      a.on('prete', pret); if (a.prete) pret();
    });
    inscrireMigrable({
      id: 'freyja', nom: 'Vénus',
      etat: () => ({ support: this.support, pret: this.branchee, attente: this.appli?.attente.taille ?? 0, message: this.branchee ? 'dans la base d\'Odin' : 'en fichiers (passera dans la base dès qu\'elle sera prête)' }),
      attendre: async () => { await this.appli?.vider(); },
      retour: async () => { this.branchee = false; return '↩ Vénus est revenu en fichiers (les données restent aussi dans la base).'; },
      repasser: async () => { await this.versBase().catch(() => undefined); return this.branchee ? '🗄 Vénus est de nouveau dans la base d\'Odin.' : '⏳ Vénus repassera dans la base dès qu\'elle sera prête.'; },
    });
  }
  fermer(): void { this.off?.(); this.off = undefined; }

  /** La base est prête : chaque collection est rejouée, puis le journal d'attente la tient à jour. */
  private async versBase(): Promise<void> {
    const a = this.appli!; if (!a.prete) throw new BaseAttente('la base de Vénus');
    for (const c of COLLECTIONS) {
      const m = this.memo.get(c)!; if (!m.size) continue;
      a.ecrire(...[...m.values()].map((e) => this.ligne(c, e)));
    }
    await a.vider();
    this.branchee = true;
  }
  private ligne(c: Collection, e: Enr): [string, ...Valeur[]] {
    return PRIVEES.has(c) ? [`pose_${c}`, e.id, chiffrerChamp(this.home, JSON.stringify(e.data)), e.maj] : [`pose_${c}`, e.id, JSON.stringify(e.data), e.maj];
  }

  // ---------------- Lecture/écriture (mémoire = source de vérité, lisible sans base) ----------------
  /** Tous les enregistrements d'une collection. */
  liste(c: Collection): Enr[] { return [...(this.memo.get(c)?.values() ?? [])]; }
  /** Un enregistrement par son identifiant. */
  get(c: Collection, id: string): Enr | undefined { return this.memo.get(c)?.get(id); }
  /** Pose (ou remplace) un enregistrement. */
  poser(c: Collection, id: string, data: Record<string, unknown>): Enr {
    if (!ID.test(id)) throw new Error(`identifiant invalide : ${id}`);
    const e: Enr = { id, data, maj: now() }; this.memo.get(c)!.set(id, e);
    if (this.appli) this.appli.ecrire(this.ligne(c, e)); else this.ecrireFichier(c);
    return e;
  }
  /** Retire un enregistrement (rend vrai s'il existait). */
  retirer(c: Collection, id: string): boolean {
    const ok = this.memo.get(c)!.delete(id);
    if (ok) { if (this.appli) this.appli.ecrire([`retire_${c}`, id]); else this.ecrireFichier(c); }
    return ok;
  }
  /** Vide une collection (rend le nombre d'enregistrements retirés). */
  vider(c: Collection): number {
    const n = this.memo.get(c)!.size; this.memo.get(c)!.clear();
    if (n) { if (this.appli) this.appli.ecrire([`vide_${c}`]); else this.ecrireFichier(c); }
    return n;
  }

  // ---------------- Repli fichier (une ligne JSON par enregistrement, privé chiffré) ----------------
  private fichierDe(c: Collection): string { return join(this.dir, `${c}.jsonl`); }
  private lireFichier(c: Collection): Map<string, Enr> {
    const m = new Map<string, Enr>();
    try {
      for (const l of readFileSync(this.fichierDe(c), 'utf8').split('\n').filter(Boolean)) {
        try {
          const x = JSON.parse(l) as { id: string; maj: number; data?: Record<string, unknown>; chiffre?: string };
          const data = PRIVEES.has(c) ? (x.chiffre ? JSON.parse(dechiffrerChamp(this.home, x.chiffre)) as Record<string, unknown> : {}) : (x.data ?? {});
          if (x.id) m.set(x.id, { id: x.id, data, maj: Number(x.maj) || now() });
        } catch { /* ligne illisible : ignorée */ }
      }
    } catch { /* pas encore de fichier */ }
    return m;
  }
  private ecrireFichier(c: Collection): void {
    const m = this.memo.get(c)!;
    if (!m.size) { rmSync(this.fichierDe(c), { force: true }); return; }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const lignes = [...m.values()].map((e) => PRIVEES.has(c) ? JSON.stringify({ id: e.id, maj: e.maj, chiffre: chiffrerChamp(this.home, JSON.stringify(e.data)) }) : JSON.stringify({ id: e.id, maj: e.maj, data: e.data }));
    const f = this.fichierDe(c), t = `${f}.tmp`;
    writeFileSync(t, `${lignes.join('\n')}\n`, { mode: 0o600 }); renameSync(t, f);
  }
  // (appendFileSync gardé pour un éventuel ajout rapide ligne à ligne.)
  protected ajoutRapide(c: Collection, e: Enr): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const l = PRIVEES.has(c) ? JSON.stringify({ id: e.id, maj: e.maj, chiffre: chiffrerChamp(this.home, JSON.stringify(e.data)) }) : JSON.stringify({ id: e.id, maj: e.maj, data: e.data });
    appendFileSync(this.fichierDe(c), `${l}\n`, { mode: 0o600 });
  }
}

/** Un magasin par dossier de Vénus (comme historiqueDe d'Écho). */
const parDir = new Map<string, MagasinVenus>();
export function magasinVenus(home: string, dir: string): MagasinVenus {
  const cle = `${home}\u0000${dir}`;
  let m = parDir.get(cle);
  if (!m) { mkdirSync(dir, { recursive: true, mode: 0o700 }); m = new MagasinVenus(home, dir); parDir.set(cle, m); }
  return m;
}
/** (essais) oublie les magasins en mémoire. */
export function oublierMagasins(): void { parDir.clear(); }
export const fichierRepliExiste = (dir: string, c: Collection): boolean => existsSync(join(dir, `${c}.jsonl`));
