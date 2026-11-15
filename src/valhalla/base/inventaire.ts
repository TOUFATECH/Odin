// Alexandrie — l'inventaire des données de chaque appli : où elles sont rangées (la base de l'appli dans Alexandrie, ou
// des fichiers dans ~/.odin/valhalla/<appli>/), et pourquoi ce qui reste en fichier y reste. Tenu à la main à partir du
// code (grep des écritures : saveSettings, writeFileSync, appendFileSync, journalDe) ; un essai vérifie que chaque
// appli y figure. Sert à la fiche de l'appli dans le Cerveau, à « état de la base d'Odin » et à la discussion.
import { NAMES } from '../names.ts';
import { AUTRES_NOMS, nomBase, proprietaireJournal } from './noms.ts';

export type Support = 'base' | 'fichiers';
/** Pourquoi une donnée reste en fichier (docs/bases-plan.md §4). */
export type Raison = 'reglages' | 'secret' | 'binaire' | 'demarrage' | 'coeur' | 'a-faire';
export const RAISONS: Record<Raison, string> = {
  reglages: 'réglages lus au démarrage, avant que la base existe',
  secret: 'secret (clé, mot de passe, jeton) : coffre ou fichier bloqué, jamais en clair dans une base',
  binaire: 'gros fichiers (images, archives, médias, disques)',
  demarrage: 'nécessaire pour démarrer la base elle-même',
  coeur: 'cœur d\'Odin (mémoire, Cerveau, compétences) : ses propres fichiers, lus sans base',
  'a-faire': 'pas encore migrée : à faire, une appli à la fois',
};
export interface Rangement { donnees: string; support: Support; raison?: Raison; journal?: string; tables?: string[] }

const R = (donnees: string, raison: Raison): Rangement => ({ donnees, support: 'fichiers', raison });
const J = (donnees: string, journal: string): Rangement => ({ donnees, support: 'base', journal, tables: ['journaux.entrees'] });
const B = (donnees: string, tables: string[]): Rangement => ({ donnees, support: 'base', tables });
const REG = R('réglages de l\'appli (réglages.json)', 'reglages');

/** Pour chaque appli : ses données et leur rangement. */
export const INVENTAIRE: Record<string, Rangement[]> = {
  // Cœur d'Odin
  huginn: [R('règles de compréhension (dans le code), demandes en attente (mémoire vive)', 'coeur')],
  muninn: [R('mémoire d\'Odin (~/.odin/memoire/, fichiers JSONL)', 'coeur')],
  yggdrasil: [R('compétences (dossiers de compétences)', 'coeur')],
  hlidskjalf: [R('empreintes des appareils (fichiers de l\'inventaire réseau)', 'coeur')],
  saga: [R('Cerveau : notes Markdown (le dossier du Cerveau)', 'coeur')],
  runes: [R('pages et bases de Papyrus (Markdown dans le Cerveau)', 'coeur')],
  draupnir: [R('automatisations (fichiers de Talos)', 'coeur')],
  bifrost: [R('passerelle des messageries (réglages, jetons des canaux)', 'secret')],
  commandes: [R('aucune donnée (les commandes viennent du code)', 'coeur')],
  apparence: [REG],
  // Données
  urdr: [J('journal des requêtes', 'requetes'), J('traçabilité des liens d\'Odin avec les bases', 'liens_bases'), R('liste des bases (bases.json), base-odin.json', 'demarrage'), R('mots de passe des bases (secrets.json)', 'secret')],
  skidbladnir: [J('journal des synchronisations', 'skidbladnir'), R('fichiers synchronisés', 'binaire'), REG],
  fjalar: [J('historique des constructions', 'forge_fjalar'), J('bibliothèque des logiciels : fiches (éditeur, version, empreinte, antivirus) et comptes rendus de vérification', 'fjalar'), R('dossiers gardés à jour (installateurs, anciennes versions dans « old »)', 'binaire')],
  eitri: [J('historique des constructions', 'forge_eitri'), R('dossiers gardés à jour', 'binaire')],
  volva: [R('historique de recherche (historique.json)', 'a-faire'), REG],
  frigg: [R('réservations, horaires, services (réglages)', 'a-faire')],
  kvasir: [REG, R('veille : nouveautés suivies (réglages)', 'a-faire')],
  syn: [REG],
  champollion: [REG, R('documents à traduire', 'binaire')],
  snotra: [R('tableaux, schémas, textes (partout.json, dossiers)', 'a-faire'), REG],
  ivaldi: [R('projets et terminaux (dossiers, journal des terminaux)', 'a-faire'), REG],
  mimisbrunnr: [REG, R('journaux système lus (pas gardés)', 'coeur')],
  hel: [R('partitions retrouvées (partitions.json), fichiers récupérés', 'binaire')],
  pegase: [B('favoris, onglets, historique, agenda, appareils, copies (par personne)', ['pegase.enregistrements', 'pegase.prefs', 'pegase.appareils', 'pegase.copies']), R('réglages du module (groupes IA, installateurs)', 'reglages')],
  agora: [R('catalogue, installations, appareils, ordres (catalogue.json, appareils.json…)', 'a-faire')],
  // Machines
  eir: [REG],
  naglfar: [R('état des conteneurs (Hringhorni)', 'demarrage'), REG],
  ymir: [J('bibliothèque d\'ISO : fiches (système, empreinte, antivirus, origine) et logiciels installés dans les machines', 'ymir'), R('machines virtuelles (machines.json), images disque', 'demarrage'), R('fichiers ISO (espace ISO commun avec Andromède)', 'binaire')],
  idunn: [J('événements des sites', 'idunn'), REG],
  skuld: [J('historique des sauvegardes de bases', 'arche'), R('archives des bases (.dump, .sql.gz)', 'binaire'), R('plans de sauvegarde (réglages)', 'reglages')],
  sindri: [R('dépôt des sauvegardes (morceaux chiffrés et dédupliqués, catalogue des versions)', 'binaire'), R('plans de sauvegarde (réglages)', 'reglages')],
  vordr: [R('sondes, problèmes, historique (réglages.json)', 'a-faire')],
  askr: [R('inventaire du matériel (réglages)', 'a-faire')],
  thjalfi: [J('historique des installations', 'thjalfi'), R('déploiements en cours, machines (fichiers)', 'demarrage'), R('secrets (secrets.json)', 'secret')],
  skogul: [REG],
  durinn: [R('suivi des disques, vitesses, test en cours (fichiers)', 'a-faire')],
  hermod: [R('parc de machines (réglages), clés des agents', 'secret')],
  // Sécurité
  garmr: [R('bannis, échecs, journaux (réglages)', 'a-faire')],
  geri: [R('journal des connexions vues (journal.json)', 'a-faire')],
  ran: [R('paquets des 7 derniers jours (fichiers de capture)', 'binaire')],
  ullr: [J('registre de la quarantaine (blocages à l\'arrivée, libérations, suppressions, réanalyses)', 'ullr'), R('signatures, fichiers en quarantaine (brouillés), rapports', 'binaire'), R('clé des signatures', 'secret')],
  loki: [J('attaques vues par les pièges', 'loki'), R('captures des pirates', 'binaire'), REG],
  svalinn: [R('appareils, état, secrets du tunnel', 'secret')],
  gjoll: [R('clés du VPN, appareils (réglages)', 'secret')],
  vidarr: [R('historique DNS, listes (réglages, fichiers téléchargés)', 'a-faire')],
  var: [J('journal des connexions', 'connexions'), R('personnes, sessions, droits, applis clientes (empreintes de mots de passe et de jetons)', 'secret')],
  bru: [R('tunnels, certificats, jetons', 'secret')],
  forseti: [J('fil des alertes de toutes les applis', 'alertes'), REG],
  valgrind: [R('règles du pare-feu (réglages)', 'reglages')],
  brisingamen: [R('coffre chiffré (coffre.bin)', 'secret')],
  hlid: [REG],
  fensalir: [REG],
  // Accès
  ratatoskr: [REG],
  gladsheim: [R('positions par jour (positions.json), tuiles de carte', 'a-faire')],
  gna: [R('choix et positions (choix.json)', 'a-faire')],
  // Maison
  himinbjorg: [R('enregistrements des caméras', 'binaire'), REG],
  aegir: [REG],
  freyja: [R('chaînes, enregistrements, médias', 'binaire'), REG],
  sessrumnir: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  bygul: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  gersemi: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  hildisvini: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  sjofn: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  folkvangr: [R('partie de Vénus (réglages de Vénus)', 'reglages')],
  dvalinn: [R('recettes et appareils (réglages)', 'reglages')],
  gefjon: [REG],
  sol: [R('index des photos (index.json), photos', 'binaire')],
  leikvangr: [R('jeux (jeux.json, fichiers des jeux)', 'binaire')],
  bragi: [R('voix, clips', 'binaire'), REG],
  heidrun: [REG],
  hlin: [R('fiches, demandes, résultats ; lettres et photos', 'a-faire')],
  appareils: [R('appareils connectés (réglages)', 'reglages')],
  brokkr: [R('modules ESP / Tasmota (réglages)', 'reglages')],
  midgard: [R('scènes (réglages)', 'reglages')],
  rodd: [J('historique des messages vocaux', 'rodd'), REG],
  mascotte: [J('bulles de la mascotte', 'bulles')],
  journaux: [],
};

/** Les données d'une appli et leur rangement (une ligne « réglages » par défaut). */
export const rangementDe = (id: string): Rangement[] => INVENTAIRE[id] ?? [REG];
/** L'appli a-t-elle (au moins en partie) ses données dans sa base ? */
export const aUneBase = (id: string): boolean => rangementDe(id).some((r) => r.support === 'base');
/** Les journaux rangés dans la base d'une appli. */
export const journauxDe = (id: string): string[] => rangementDe(id).flatMap((r) => (r.journal ? [r.journal] : []));

/** Ce qui est en base / ce qui reste en fichier, appli par appli (pour l'état de la base et la fiche). */
export function resume(id: string): { base: string; enBase: Rangement[]; enFichiers: Rangement[] } {
  const l = rangementDe(id);
  return { base: nomBase(id), enBase: l.filter((r) => r.support === 'base'), enFichiers: l.filter((r) => r.support === 'fichiers') };
}

/** Les applis connues (NAMES et les autres parties qui ont une base). */
export const applisConnues = (): string[] => [...new Set([...Object.keys(NAMES), ...Object.keys(AUTRES_NOMS)])];

/** Chaque journal déclaré ici appartient bien à l'appli qui le déclare (même règle que la base). */
export function verifierInventaire(): string[] {
  const err: string[] = [];
  for (const [id, l] of Object.entries(INVENTAIRE)) for (const r of l) if (r.journal && proprietaireJournal(r.journal) !== id) err.push(`${id} : le journal ${r.journal} irait dans la base de ${proprietaireJournal(r.journal)}`);
  return err;
}
