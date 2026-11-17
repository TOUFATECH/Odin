// Mathésis — le magasin : la base MATHESIS_ODIN dans Alexandrie, et le repli en fichiers CHIFFRÉS tant qu'elle
// n'est pas prête (comme Théia et Archytas).
//
// Le repli range une collection par fichier (`<dossier>/donnees/<collection>.odc`), tout le contenu chiffré avec la
// clé de la machine (src/vault.ts, chiffrerChamp) et écrit de façon atomique (fichier .tmp puis renommage) : une
// panne pendant l'écriture laisse l'ancien fichier intact. Ce qu'Odin a lu et cherché peut dire beaucoup du
// propriétaire : rien n'est en clair sur le disque.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { champChiffre, chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { nomBase } from '../base/noms.ts';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';

/** Le nom de la base de Mathésis dans Alexandrie : MATHESIS_ODIN. */
export const nomBaseMathesis = (): string => nomBase('mathesis', 'Mathésis');
/** Le dossier de données de Mathésis (le même que le ctx.dir du futur module). */
export const dirMathesis = (home: string): string => join(home, 'valhalla', 'mathesis');

/** Les collections du magasin (plus une par site à absorber : « site:<nom> », sa file et ses adresses connues). */
export type Collection = `site:${string}` | 'reglages' | 'interdits' | 'curiosite' | 'journal' | 'empreintes' | 'pages' | 'robots' | 'sites' | 'budget' | 'fichiers' | 'prochains' | 'recherches' | 'apprisPages' | 'absorber' | 'absorberConnues' | 'ouTrouver';
/** Le nom d'une collection par site (un nom de site, rien d'autre). */
const COLL_SITE = /^site:[a-z0-9.-]{1,120}$/;
const COLLECTIONS: readonly Collection[] = ['reglages', 'interdits', 'curiosite', 'journal', 'empreintes', 'pages', 'robots', 'sites', 'budget', 'fichiers', 'prochains', 'recherches', 'apprisPages', 'absorber', 'absorberConnues', 'ouTrouver'];

/** Le schéma de la base : des documents chiffrés par collection ; les vues ne montrent que des compteurs. */
export const DEF_MATHESIS: DefAppli = {
  id: 'mathesis', schema: 'mathesis', appli: 'mathesis',
  migrations: [{
    v: 1, nom: 'documents chiffrés de Mathésis (curiosité, journal, empreintes, pages, consignes des robots, budgets)',
    sql: `
CREATE TABLE documents (collection text NOT NULL, cle text NOT NULL, valeur_chiffree text NOT NULL, maj bigint NOT NULL, PRIMARY KEY (collection, cle));
-- Ce qu'Odin (compte odin_lecture) peut lire : SEULEMENT des compteurs. Jamais un sujet, une page ou une question.
CREATE VIEW v_compteurs AS SELECT collection, count(*) AS nombre, max(maj) AS maj FROM documents GROUP BY collection;
GRANT SELECT ON v_compteurs TO odin_lecture`,
  }],
  ecritures: {
    document_pose: 'INSERT INTO documents (collection, cle, valeur_chiffree, maj) VALUES ($1, $2, $3, $4) ON CONFLICT (collection, cle) DO UPDATE SET valeur_chiffree = EXCLUDED.valeur_chiffree, maj = EXCLUDED.maj',
    document_retire: 'DELETE FROM documents WHERE collection = $1 AND cle = $2',
  },
};

/** Une collection présente mais illisible (abîmée, clé perdue, ou posée EN CLAIR) ; `secours` : relue de sa copie. */
export interface Illisible { collection: Collection; secours: boolean }

/** Ce qui reçoit les écritures quand la base MATHESIS_ODIN est prête (les écritures déclarées dans DEF_MATHESIS). */
export interface Miroir { ecrire(...ls: Array<[k: string, ...p: Array<string | number | boolean | null>]>): void }

/** Le magasin vu par le moteur : une valeur par collection. */
export interface Magasin {
  lire<T>(c: Collection, defaut: T): T;
  ecrire<T>(c: Collection, v: T): void;
  /** Efface tout (essais, « tout oublier »). */
  vider(): void;
  /** Les collections trouvées illisibles (le moteur applique alors l'état le plus prudent). */
  illisibles?(): Illisible[];
}

/** Les collections qui protègent : une copie de secours de la dernière version lisible est gardée à côté. */
const AVEC_SECOURS: readonly Collection[] = ['reglages', 'interdits', 'budget'];

/** Le repli en fichiers chiffrés. `chiffrer`/`dechiffrer` sont injectables (par défaut : la clé de la machine). */
export class MagasinFichiers implements Magasin {
  private readonly dossier: string;
  private readonly chiffrer: (t: string) => string;
  private readonly dechiffrer: (t: string) => string;
  private readonly estChiffre: (t: string) => boolean;
  private readonly cache = new Map<Collection, unknown>();
  private readonly casses = new Map<Collection, boolean>();
  private miroir?: Miroir;
  private readonly maintenant: () => number;
  constructor(dossier: string, home: string, o: { chiffrer?: (t: string) => string; dechiffrer?: (t: string) => string; estChiffre?: (t: string) => boolean; maintenant?: () => number } = {}) {
    this.dossier = join(dossier, 'donnees');
    this.chiffrer = o.chiffrer ?? ((t) => chiffrerChamp(home, t));
    this.dechiffrer = o.dechiffrer ?? ((t) => dechiffrerChamp(home, t));
    this.estChiffre = o.estChiffre ?? (o.chiffrer ? () => true : champChiffre);
    this.maintenant = o.maintenant ?? Date.now;
  }
  private fichier(c: Collection): string {
    // Une collection par site : un nom de site sûr seulement (le fichier « site~<nom>.odc »).
    if (c.startsWith('site:')) { if (!COLL_SITE.test(c)) throw new Error(`collection refusée : ${String(c).slice(0, 80)}`); return join(this.dossier, `site~${c.slice(5)}.odc`); }
    if (!COLLECTIONS.includes(c)) throw new Error(`collection inconnue : ${String(c)}`);
    return join(this.dossier, `${c}.odc`);
  }
  /** Les collections par site présentes sur le disque. */
  private collectionsSites(): Collection[] {
    try { return readdirSync(this.dossier).filter((f) => /^site~[a-z0-9.-]{1,120}\.odc$/.test(f)).map((f) => `site:${f.slice(5, -4)}` as Collection); } catch { return []; }
  }
  /** Lit et déchiffre un fichier ; undefined s'il est illisible. Un contenu NON chiffré est refusé (jamais appliqué). */
  private ouvrir<T>(f: string): { ok: true; v: T } | { ok: false } {
    try {
      const t = readFileSync(f, 'utf8');
      if (!this.estChiffre(t)) return { ok: false };
      return { ok: true, v: JSON.parse(this.dechiffrer(t)) as T };
    } catch { return { ok: false }; }
  }
  lire<T>(c: Collection, defaut: T): T {
    if (this.cache.has(c)) return this.cache.get(c) as T;
    const f = this.fichier(c);
    let v: T = defaut;
    if (existsSync(f)) {
      const r = this.ouvrir<T>(f);
      if (r.ok) v = r.v;
      else {
        // Fichier abîmé, clé perdue ou contenu en clair : jamais de plantage ; la copie de secours si elle est lisible,
        // et le moteur est prévenu (il applique l'état le plus prudent et alerte le propriétaire).
        const s = AVEC_SECOURS.includes(c) && existsSync(`${f}.bak`) ? this.ouvrir<T>(`${f}.bak`) : { ok: false as const };
        if (s.ok) v = s.v;
        this.casses.set(c, s.ok);
      }
    }
    this.cache.set(c, v);
    return v;
  }
  illisibles(): Illisible[] { return [...this.casses.entries()].map(([collection, secours]) => ({ collection, secours })); }
  ecrire<T>(c: Collection, v: T): void {
    const f = this.fichier(c);
    mkdirSync(this.dossier, { recursive: true });
    const texte = this.chiffrer(JSON.stringify(v));
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, texte, { mode: 0o600 });
    renameSync(tmp, f);
    if (AVEC_SECOURS.includes(c)) { writeFileSync(`${tmp}.bak`, texte, { mode: 0o600 }); renameSync(`${tmp}.bak`, `${f}.bak`); }
    this.cache.set(c, v);
    this.casses.delete(c);
    this.reporter(c, texte);
  }
  /** La base est prête : ce qui est déjà rangé y est reporté, puis chaque écriture (contenus chiffrés). */
  brancherMiroir(m: Miroir): void {
    this.miroir = m;
    for (const c of [...COLLECTIONS, ...this.collectionsSites()]) {
      const f = this.fichier(c);
      if (!existsSync(f)) continue;
      try { const t = readFileSync(f, 'utf8'); if (this.estChiffre(t)) this.reporter(c, t); } catch { /* illisible : pas reporté */ }
    }
  }
  private reporter(c: Collection, texte: string): void {
    if (!this.miroir) return;
    try { this.miroir.ecrire(['document_pose', c, 'tout', texte, this.maintenant()]); } catch { /* la base ne gêne jamais : le fichier fait foi */ }
  }
  vider(): void {
    for (const c of [...COLLECTIONS, ...this.collectionsSites()]) { rmSync(this.fichier(c), { force: true }); rmSync(`${this.fichier(c)}.bak`, { force: true }); }
    this.cache.clear(); this.casses.clear();
  }
}

/** Un magasin en mémoire (essais). */
export class MagasinMemoire implements Magasin {
  private readonly m = new Map<Collection, string>();
  lire<T>(c: Collection, defaut: T): T { const x = this.m.get(c); return x === undefined ? defaut : JSON.parse(x) as T; }
  ecrire<T>(c: Collection, v: T): void { this.m.set(c, JSON.stringify(v)); }
  vider(): void { this.m.clear(); }
}

// ------------------------------------------------------------------ Branchement sur Alexandrie
const branchees = new Set<string>();
/** Enregistre et prépare la base MATHESIS_ODIN au démarrage (idempotent par dossier). Le repli reste la source de vérité. */
export function brancherMathesis(dir: string, recevoir: (m: Miroir) => void = () => {}): void {
  if (branchees.has(dir)) return;
  branchees.add(dir);
  let appli: AppliBase | undefined;
  let dansBase = false;
  quandBase((b) => {
    appli = b.appli(DEF_MATHESIS, dir);
    const pret = () => { dansBase = true; try { recevoir(appli!); } catch { /* le fichier fait foi */ } };
    appli.on('prete', pret); if (appli.prete) pret();
  });
  inscrireMigrable({
    id: 'mathesis', nom: 'Mathésis',
    etat: () => ({ support: dansBase ? 'base' : 'fichiers', pret: dansBase, attente: appli?.attente.taille ?? 0, message: dansBase ? 'dans la base d\'Odin' : 'en fichiers chiffrés (passera dans la base dès qu\'elle sera prête)' }),
    attendre: async () => { await appli?.vider().catch((e) => { if (!(e instanceof BaseAttente)) throw e; }); },
    retour: async () => { dansBase = false; return '↩ Mathésis est revenue en fichiers chiffrés (les données restent aussi dans la base).'; },
    repasser: async () => (dansBase ? '🗄 Mathésis est dans la base d\'Odin.' : '⏳ Mathésis passera dans la base dès qu\'elle sera prête.'),
  });
}
/** (essais) oublie les branchements. */
export function oublierBranchementsMathesis(): void { branchees.clear(); }
