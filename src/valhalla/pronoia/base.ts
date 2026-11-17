// Prónoia dans la base d'Odin (Alexandrie) : la base PRONOIA_ODIN (= nomBase('pronoia')), schéma « pronoia ».
//   - previsions : ce qu'Odin a anticipé, sa confiance, son échéance, son état (en attente, réalisée, ratée, périmée) ;
//   - demandes   : l'historique des demandes du propriétaire servant à anticiper (texte CHIFFRÉ) ;
//   - evenements : les événements datés reçus des applis (contenu CHIFFRÉ).
// Le contenu (ce qui est prévu, ses sources, le texte d'une demande) est chiffré au repos (clé de la machine, comme le
// coffre) : seuls des compteurs et des nombres restent lisibles. odin_lecture ne voit que des compteurs.
// Comme Théia : la base est préparée en arrière-plan, le repli en fichier chiffré (magasin.ts) reste la source de vérité.
import { join } from 'node:path';
import { nomBase } from '../base/noms.ts';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';

/** Le nom de la base de Prónoia dans Alexandrie : PRONOIA_ODIN. */
export const nomBasePronoia = (): string => nomBase('pronoia', 'Prónoia');
/** Le dossier de données de Prónoia (le même que le ctx.dir du futur module pronoia). */
export const dirPronoia = (home: string): string => join(home, 'valhalla', 'pronoia');

export const DEF_PRONOIA: DefAppli = {
  id: 'pronoia', schema: 'pronoia', appli: 'pronoia',
  migrations: [{
    v: 1, nom: 'prévisions, demandes et événements (contenus chiffrés) de Prónoia',
    sql: `
CREATE TABLE previsions (id text PRIMARY KEY, sorte text NOT NULL, contenu text NOT NULL, echeance bigint NOT NULL, confiance real NOT NULL, etat text NOT NULL, cree bigint NOT NULL, resolue bigint, ecart_min real);
CREATE INDEX previsions_cree ON previsions (cree);
CREATE TABLE demandes (id text PRIMARY KEY, at bigint NOT NULL, contenu text NOT NULL);
CREATE INDEX demandes_at ON demandes (at);
CREATE TABLE evenements (id text PRIMARY KEY, at bigint NOT NULL, appli text NOT NULL, contenu text NOT NULL);
CREATE INDEX evenements_at ON evenements (at);
-- Ce qu'Odin (compte odin_lecture) peut lire : SEULEMENT des compteurs (jamais un texte de demande ni une prévision).
CREATE VIEW v_bilan AS SELECT sorte, etat, count(*) AS nombre, avg(confiance) AS confiance_moyenne FROM previsions GROUP BY sorte, etat;
CREATE VIEW v_compteurs AS
  SELECT 'previsions' AS table_, count(*) AS nombre FROM previsions
  UNION ALL SELECT 'demandes', count(*) FROM demandes
  UNION ALL SELECT 'evenements', count(*) FROM evenements;
GRANT SELECT ON v_bilan, v_compteurs TO odin_lecture`,
  }],
  ecritures: {
    prevision_pose: 'INSERT INTO previsions (id, sorte, contenu, echeance, confiance, etat, cree, resolue, ecart_min) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET contenu = EXCLUDED.contenu, etat = EXCLUDED.etat, resolue = EXCLUDED.resolue, ecart_min = EXCLUDED.ecart_min',
    demande_pose: 'INSERT INTO demandes (id, at, contenu) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    evenement_pose: 'INSERT INTO evenements (id, at, appli, contenu) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
    // une requête par écriture (le protocole paramétré n'en accepte qu'une)
    purge_previsions: 'DELETE FROM previsions WHERE cree < $1',
    purge_demandes: 'DELETE FROM demandes WHERE at < $1',
    purge_evenements: 'DELETE FROM evenements WHERE at < $1',
    effacer_previsions: 'DELETE FROM previsions',
    effacer_demandes: 'DELETE FROM demandes',
    effacer_evenements: 'DELETE FROM evenements',
  },
};

/** Ce dont le magasin a besoin pour écrire aussi dans la base : les écritures déclarées ci-dessus. */
export interface Miroir { ecrire(...ls: Array<[k: string, ...p: Array<string | number | null>]>): void }

const branchees = new Map<string, { miroir?: Miroir }>();
/**
 * Enregistre et prépare la base PRONOIA_ODIN (idempotent par dossier). `recevoir` est appelé avec le miroir dès que la
 * base est prête : le magasin y reporte alors ses écritures (le fichier chiffré reste la source de vérité).
 */
export function brancherPronoia(dir: string, recevoir: (m: Miroir) => void = () => {}): void {
  const deja = branchees.get(dir);
  if (deja) { if (deja.miroir) recevoir(deja.miroir); return; }
  const etat: { miroir?: Miroir } = {};
  branchees.set(dir, etat);
  let appli: AppliBase | undefined;
  let dansBase = false;
  quandBase((b) => {
    appli = b.appli(DEF_PRONOIA, dir);
    const pret = () => { dansBase = true; etat.miroir = appli!; recevoir(appli!); };
    appli.on('prete', pret); if (appli.prete) pret();
  });
  inscrireMigrable({
    id: 'pronoia', nom: 'Prónoia',
    etat: () => ({ support: dansBase ? 'base' : 'fichiers', pret: dansBase, attente: appli?.attente.taille ?? 0, message: dansBase ? 'dans la base d\'Odin' : 'en fichier chiffré (passera dans la base dès qu\'elle sera prête)' }),
    attendre: async () => { await appli?.vider().catch((e) => { if (!(e instanceof BaseAttente)) throw e; }); },
    retour: async () => { dansBase = false; return '↩ Prónoia est revenue en fichier chiffré (les données restent aussi dans la base).'; },
    repasser: async () => (dansBase ? '🗄 Prónoia est dans la base d\'Odin.' : '⏳ Prónoia passera dans la base dès qu\'elle sera prête.'),
  });
}
/** (essais) oublie les branchements. */
export function oublierBranchementsPronoia(): void { branchees.clear(); }
