// Syrinx dans la base d'Odin (Alexandrie) : la base SYRINX_ODIN (= nomBase('syrinx')), schéma « syrinx ».
// Elle range ce que l'oreille d'Odin a entendu, SANS rien envoyer dehors :
//   - sons        : une ligne par son analysé ; le résultat (`contenu`) est déjà CHIFFRÉ (clé de la machine) ;
//   - empreintes  : les codes de l'empreinte sonore (pour reconnaître un son déjà entendu, sans le réanalyser) ;
//   - corrections : ce que le propriétaire corrige (« c'est la sonnette »), chiffré aussi ;
//   - mesures     : la vitesse mesurée sur cette machine (ms et fois le temps réel, par étape).
//
// Vie privée : les vues v_* que lit odin_lecture ne montrent que des compteurs, jamais un résultat ni une correction.
// Aucun secret : rien ne va dans le coffre. On suit le motif de Théia (theia/base.ts) : un DefAppli, la base préparée en
// arrière-plan, et le repli en fichiers qui reste la source de vérité (magasin.ts).
import { join } from 'node:path';
import { nomBase } from '../base/noms.ts';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import type { Valeur } from '../base/pool.ts';

/** Le nom de la base de Syrinx dans Alexandrie : SYRINX_ODIN (= nomBase('syrinx')). */
export const nomBaseSyrinx = (): string => nomBase('syrinx');
/** Le dossier de données de Syrinx (le même que le ctx.dir du module syrinx). */
export const dirSyrinx = (home: string): string => join(home, 'valhalla', 'syrinx');
/** Les poids du modèle de sons ouvert, téléchargés une fois, avec leur licence à côté. */
export const dirPoidsSons = (home: string): string => join(dirSyrinx(home), 'poids');

/** Les tables du schéma « syrinx ». `contenu` est toujours le texte chiffré (jamais le clair). */
export const DEF_SYRINX: DefAppli = {
  id: 'syrinx', schema: 'syrinx', appli: 'syrinx',
  migrations: [{
    v: 1, nom: 'sons entendus (chiffrés), empreintes sonores, corrections et vitesse mesurée de Syrinx',
    sql: `
CREATE TABLE sons (id text PRIMARY KEY, quand timestamptz NOT NULL, source_ref text NOT NULL, sha_fichier text NOT NULL, duree real NOT NULL, contenu text NOT NULL);
CREATE INDEX sons_sha ON sons (sha_fichier);
CREATE TABLE empreintes (code bigint NOT NULL, son_id text NOT NULL, t int NOT NULL);
CREATE INDEX empreintes_code ON empreintes (code);
CREATE INDEX empreintes_son ON empreintes (son_id);
CREATE TABLE corrections (id serial PRIMARY KEY, quand timestamptz NOT NULL, son_id text NOT NULL, libelle text NOT NULL, contenu text NOT NULL);
CREATE TABLE mesures (quand timestamptz NOT NULL, etape text NOT NULL, ms real NOT NULL, x_temps_reel real NOT NULL);
-- Ce qu'Odin (compte odin_lecture) peut lire : SEULEMENT des compteurs. Jamais un résultat, une correction ni une empreinte.
CREATE VIEW v_compteurs AS
  SELECT 'sons' AS table_, count(*) AS nombre FROM sons
  UNION ALL SELECT 'empreintes', count(*) FROM empreintes
  UNION ALL SELECT 'corrections', count(*) FROM corrections
  UNION ALL SELECT 'mesures', count(*) FROM mesures;
GRANT SELECT ON v_compteurs TO odin_lecture`,
  }],
  ecritures: {
    son_pose: 'INSERT INTO sons (id, quand, source_ref, sha_fichier, duree, contenu) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET quand = EXCLUDED.quand, source_ref = EXCLUDED.source_ref, sha_fichier = EXCLUDED.sha_fichier, duree = EXCLUDED.duree, contenu = EXCLUDED.contenu',
    son_retire: 'DELETE FROM sons WHERE id = $1',
    // Toute l'empreinte d'un son en UNE écriture : $2 = paires [code, instant] en JSON (jamais une ligne par code).
    empreintes_pose: 'INSERT INTO empreintes (code, son_id, t) SELECT (e->>0)::bigint, $1, (e->>1)::int FROM jsonb_array_elements($2::jsonb) AS e',
    empreintes_retire: 'DELETE FROM empreintes WHERE son_id = $1',
    correction_pose: 'INSERT INTO corrections (quand, son_id, libelle, contenu) VALUES ($1, $2, $3, $4)',
    corrections_retire: 'DELETE FROM corrections WHERE son_id = $1',
    mesure_pose: 'INSERT INTO mesures (quand, etape, ms, x_temps_reel) VALUES ($1, $2, $3, $4)',
  },
};

// ------------------------------------------------------------------ Branchement sur Alexandrie
// Sans ceci, DEF_SYRINX n'est jamais enregistré et la base SYRINX_ODIN n'est JAMAIS créée : on la pose au démarrage comme
// Théia. Le repli en fichiers reste la source de vérité ; la base en reçoit un double (déjà chiffré) quand elle est prête.
const branchees = new Set<string>();
const applis = new Map<string, AppliBase>();
/** Enregistre et prépare la base SYRINX_ODIN au démarrage (à appeler une fois, idempotent par dossier). */
export function brancherSyrinx(dir: string): void {
  if (branchees.has(dir)) return;
  branchees.add(dir);
  let appli: AppliBase | undefined;
  let dansBase = false;
  quandBase((b) => {
    appli = b.appli(DEF_SYRINX, dir); // ← pose le schéma « syrinx » et joue les migrations dès que la base est prête.
    applis.set(dir, appli);
    const pret = () => { dansBase = true; };
    appli.on('prete', pret); if (appli.prete) pret();
  });
  inscrireMigrable({
    id: 'syrinx', nom: 'Syrinx',
    etat: () => ({ support: dansBase ? 'base' : 'fichiers', pret: dansBase, attente: appli?.attente.taille ?? 0, message: dansBase ? 'dans la base d\'Odin' : 'en fichiers (passera dans la base dès qu\'elle sera prête)' }),
    attendre: async () => { await appli?.vider().catch((e) => { if (!(e instanceof BaseAttente)) throw e; }); },
    retour: async () => { dansBase = false; return '↩ Syrinx est revenue en fichiers (les données restent aussi dans la base).'; },
    repasser: async () => (dansBase ? '🗄 Syrinx est dans la base d\'Odin.' : '⏳ Syrinx passera dans la base dès qu\'elle sera prête.'),
  });
}

/**
 * Note un double dans la base (journal d'attente d'Alexandrie) si elle est branchée ; sinon rien : les fichiers font foi.
 * Ne lève jamais (la base ne doit pas gêner l'écoute).
 */
export function noterBase(dir: string, ...lignes: Array<[k: string, ...p: Valeur[]]>): void {
  const a = applis.get(dir); if (!a || !lignes.length) return;
  try { for (let i = 0; i < lignes.length; i += 1000) a.ecrire(...lignes.slice(i, i + 1000)); } catch { /* la base n'est qu'un double */ }
}

/** (essais) oublie les branchements. */
export function oublierBranchementsSyrinx(): void { branchees.clear(); applis.clear(); }
