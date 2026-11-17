// Chaîne de construction : écrit la VERSION DE RÉFÉRENCE du noyau d'Odin (src/heimdall/noyau-empreintes.json),
// une empreinte SHA-256 par fichier de ses garde-fous. À lancer au moment de publier une version (« npm run
// noyau:empreintes »). Odin compare au démarrage et avant chaque action engageante.
import { ecrireReference, FICHIER_EMPREINTES, RACINE_APPLI } from '../src/heimdall/noyau.ts';

console.log(`${ecrireReference(RACINE_APPLI)} fichiers du noyau → ${FICHIER_EMPREINTES}`);
