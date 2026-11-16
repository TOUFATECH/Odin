// Théia dans la base d'Odin (Alexandrie) : la base THEIA_ODIN (= nomBase('theia')), schéma « theia ».
// Elle range ce que l'œil d'Odin apprend et retrouve, SANS rien envoyer dehors :
//   - notions        : les mots que l'œil sait reconnaître (le mot, sa langue, son vecteur de l'encodeur de texte) ;
//   - plongements_images : l'empreinte vectorielle d'une image, pour « retrouver une image par une phrase » ;
//   - corrections    : ce que le propriétaire corrige (« c'est le salon », « c'est mon chien »), pour apprendre dessus ;
//   - suivi          : les repères d'un élément suivi À L'INTÉRIEUR d'une vidéo (jamais relié entre deux sources) ;
//   - enrolements    : les gabarits de visages ENRÔLÉS par le propriétaire — TRÈS SENSIBLE, chiffré, ÉTEINT PAR DÉFAUT.
//
// Vie privée : les enrôlements sont chiffrés (clé de la machine, comme le coffre) et jamais exposés en clair. Les vues
// v_* que lit odin_lecture ne montrent que des compteurs et les mots publics, jamais un gabarit ni un vecteur privé.
// On suit le modèle de Vénus (venus/base.ts) : un DefAppli, la base préparée en arrière-plan, le repli en fichiers.
import { join } from 'node:path';
import { nomBase } from '../base/noms.ts';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';

/** Le nom de la base de Théia dans Alexandrie : THEIA_ODIN (= nomBase('theia')). */
export const nomBaseTheia = (): string => nomBase('theia');
/** Le dossier de données de Théia (le même que le ctx.dir du module theia). */
export const dirTheia = (home: string): string => join(home, 'valhalla', 'theia');
/** Les poids des modèles ouverts, téléchargés une fois, et leur licence à côté (voir metis/gguf.ts). */
export const dirPoids = (home: string): string => join(dirTheia(home), 'poids');

/**
 * Les tables du schéma « theia ». Les enrôlements gardent un seul champ `gabarit` déjà chiffré (jamais le clair) et une
 * date d'expiration réglable ; `consenti` dit que la personne a accepté. La reconnaissance de visages reste ÉTEINTE tant
 * que le propriétaire ne l'allume pas (réglage `visagesActif`, faux par défaut).
 */
export const DEF_THEIA: DefAppli = {
  id: 'theia', schema: 'theia', appli: 'theia',
  migrations: [{
    v: 1, nom: 'notions, plongements d\'images, corrections, suivi et enrôlements (chiffrés) de Théia',
    sql: `
CREATE TABLE notions (mot text NOT NULL, langue text NOT NULL DEFAULT 'fr', vecteur bytea NOT NULL, dim int NOT NULL, maj bigint NOT NULL, PRIMARY KEY (mot, langue));
CREATE TABLE plongements_images (id text PRIMARY KEY, source text NOT NULL, at bigint NOT NULL, vecteur bytea NOT NULL, dim int NOT NULL);
CREATE INDEX plongements_images_source ON plongements_images (source);
CREATE TABLE corrections (id text PRIMARY KEY, image text NOT NULL, etiquette_corrigee text NOT NULL, at bigint NOT NULL);
CREATE TABLE suivi (video text NOT NULL, repere text NOT NULL, classe text NOT NULL, boites jsonb NOT NULL, maj bigint NOT NULL, PRIMARY KEY (video, repere));
CREATE TABLE enrolements (id text PRIMARY KEY, nom text NOT NULL, gabarit text NOT NULL, consenti boolean NOT NULL DEFAULT false, expire bigint, maj bigint NOT NULL);
-- Ce qu'Odin (compte odin_lecture) peut lire : SEULEMENT des compteurs et les mots publics. Jamais un gabarit de visage,
-- jamais le vecteur d'une image privée, jamais le nom d'une personne enrôlée.
CREATE VIEW v_notions AS SELECT mot, langue FROM notions;
CREATE VIEW v_compteurs AS
  SELECT 'notions' AS table_, count(*) AS nombre FROM notions
  UNION ALL SELECT 'plongements_images', count(*) FROM plongements_images
  UNION ALL SELECT 'corrections', count(*) FROM corrections
  UNION ALL SELECT 'suivi', count(*) FROM suivi
  UNION ALL SELECT 'enrolements', count(*) FROM enrolements;
GRANT SELECT ON v_notions, v_compteurs TO odin_lecture`,
  }],
  ecritures: {
    notion_pose: 'INSERT INTO notions (mot, langue, vecteur, dim, maj) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (mot, langue) DO UPDATE SET vecteur = EXCLUDED.vecteur, dim = EXCLUDED.dim, maj = EXCLUDED.maj',
    notion_retire: 'DELETE FROM notions WHERE mot = $1 AND langue = $2',
    image_pose: 'INSERT INTO plongements_images (id, source, at, vecteur, dim) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, at = EXCLUDED.at, vecteur = EXCLUDED.vecteur, dim = EXCLUDED.dim',
    image_retire: 'DELETE FROM plongements_images WHERE id = $1',
    correction_pose: 'INSERT INTO corrections (id, image, etiquette_corrigee, at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET image = EXCLUDED.image, etiquette_corrigee = EXCLUDED.etiquette_corrigee, at = EXCLUDED.at',
    suivi_pose: 'INSERT INTO suivi (video, repere, classe, boites, maj) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (video, repere) DO UPDATE SET classe = EXCLUDED.classe, boites = EXCLUDED.boites, maj = EXCLUDED.maj',
    suivi_vide: 'DELETE FROM suivi WHERE video = $1',
    enrolement_pose: 'INSERT INTO enrolements (id, nom, gabarit, consenti, expire, maj) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, gabarit = EXCLUDED.gabarit, consenti = EXCLUDED.consenti, expire = EXCLUDED.expire, maj = EXCLUDED.maj',
    enrolement_retire: 'DELETE FROM enrolements WHERE id = $1',
    enrolement_expire: 'DELETE FROM enrolements WHERE expire IS NOT NULL AND expire < $1',
  },
};

/** La reconnaissance de visages est-elle allumée ? Éteinte par défaut (données très sensibles). */
export const visagesAllumes = (settings: Record<string, unknown>): boolean => settings.visagesActif === true;

// ------------------------------------------------------------------ Branchement sur Alexandrie
// Sans ceci, DEF_THEIA n'est jamais enregistré et la base THEIA_ODIN (tables notions/plongements_images/corrections/
// suivi/enrôlements) n'est JAMAIS créée : on la pose au démarrage comme Vénus (venus/base.ts). Le repli en fichiers reste
// la source de vérité ; la base est posée pour que les tables existent (comme l'annonce l'inventaire : theia en B()).
const branchees = new Set<string>();
/** Enregistre et prépare la base THEIA_ODIN au démarrage (à appeler une fois, idempotent par dossier). */
export function brancherTheia(dir: string): void {
  if (branchees.has(dir)) return;
  branchees.add(dir);
  let appli: AppliBase | undefined;
  let dansBase = false;
  quandBase((b) => {
    appli = b.appli(DEF_THEIA, dir); // ← pose le schéma « theia » et joue les migrations dès que la base est prête.
    const pret = () => { dansBase = true; };
    appli.on('prete', pret); if (appli.prete) pret();
  });
  inscrireMigrable({
    id: 'theia', nom: 'Théia',
    etat: () => ({ support: dansBase ? 'base' : 'fichiers', pret: dansBase, attente: appli?.attente.taille ?? 0, message: dansBase ? 'dans la base d\'Odin' : 'en fichiers (passera dans la base dès qu\'elle sera prête)' }),
    attendre: async () => { await appli?.vider().catch((e) => { if (!(e instanceof BaseAttente)) throw e; }); },
    retour: async () => { dansBase = false; return '↩ Théia est revenue en fichiers (les données restent aussi dans la base).'; },
    repasser: async () => (dansBase ? '🗄 Théia est dans la base d\'Odin.' : '⏳ Théia passera dans la base dès qu\'elle sera prête.'),
  });
}
/** (essais) oublie les branchements. */
export function oublierBranchementsTheia(): void { branchees.clear(); }
