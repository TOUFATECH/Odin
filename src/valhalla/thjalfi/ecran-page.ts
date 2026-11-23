// Genèse · la page de l'écran de démarrage GRAPHIQUE, servie par Genèse sur le réseau local (/ecran) et posée telle
// quelle sur la clé ODIN (copie hors ligne, ecran-offline.ts). C'est LE MÊME écran pour les deux (maquettes validées
// « Clés USB · Démarrage » et « Systèmes · Démarrage ») : l'arrivée d'Odin qui se déplace avec ses émotions et les
// trois points, puis le menu (barre « depuis la clé » ou « par le réseau », cartes des systèmes dans l'ordre choisi,
// panneau de détail, compte à rebours). Clavier : ← → ↑ ↓ choisir · Entrée démarrer · T mode texte · I installer ·
// A « Installer pour moi » (réseau seulement) · D disposition · Tab famille · Échap arrête l'attente.
//
// La page ne contient AUCUNE donnée : elle lit l'état (/ecran/etat) et ne fait que demander (/ecran/choisir) ;
// rien n'est construit en HTML à partir des noms reçus. Sa source unique est src/web/pages/thjalfi-cle-menu.js
// (l'aperçu de la page Clés USB en est fait aussi) : voir ecranDemarrage() dans ecrans-communs.ts.
import { ecranDemarrage } from './ecrans-communs.ts';

let memo: string | undefined;
/** La page /ecran (la même octet pour octet sur le réseau et sur la clé). */
export function ecranPage(): string {
  memo ??= ecranDemarrage().page();
  return memo;
}
