// Mathésis — « Odin apprend tout seul ». Le socle (réglages, budgets, curiosité, interdits, empreintes, journal, magasin
// chiffré), les recherches autonomes, le robot de lecture des pages publiques, la lecture des dossiers ouverts (lecture
// seule) et le module (page « Ce qu'Odin a appris tout seul », réglages, démarrage avec Odin). Les vidéos, la musique,
// les images, « comment c'est fait » et la carte viendront aux passages suivants.
export * from './types.ts';
export { creerMathesis, type Mathesis, type OptionsMathesis, type BilanTour } from './moteur.ts';
export { reglagesParDefaut, normaliserReglages, garde, dansLesHeures, appelPayantPermis, VITESSES, PHRASES_ARRET } from './reglages.ts';
export { Budget, jourDe } from './budget.ts';
export { Curiosite, PRIORITE } from './curiosite.ts';
export { RegistreInterdits, sujetInterdit, siteInterdit, dossierInterdit } from './interdits.ts';
export { Empreintes } from './empreintes.ts';
export { Journal } from './journal.ts';
export { MagasinFichiers, MagasinMemoire, DEF_MATHESIS, nomBaseMathesis, dirMathesis, brancherMathesis } from './magasin.ts';
export { controlerAdresse, controlerForme, ipInterdite, lookupGarde, resolveurSysteme } from './adresses.ts';
export { analyserRobots, permis, NOM_ROBOT, AGENT_ROBOT } from './robots.ts';
export { Lecteur, transportSysteme } from './lecteur.ts';
export { Robot } from './robot.ts';
export { rechercherManque, recouper, preparerQuestions, chercheurOdin } from './recherche.ts';
export { mathesis, type OptionsModuleMathesis } from './module.ts';
export { LecteurMaison } from './maison.ts';
