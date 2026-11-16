// Kéryx dans la grille des applis d'Odin. Son interface vit entièrement dans sa page dessinée à la main
// (src/web/pages/keryx.js, enregistrée dans OdinPages.keryx) ; ce module est le minimum pour qu'Odin la connaisse :
// sans lui, /api/valhalla/view?id=keryx répondait « appli inconnue » et la page restait injoignable (jamais dans la
// grille, jamais ouverte). La vue générique est donc vide : c'est la page custom qui prend toute la largeur.
//
// Pas d'actions d'outil ici : Kéryx AGIT en pilotant les applis d'Odin (courrier, agenda…) depuis les messages qu'il
// reçoit de dehors (voir canal.ts / actions.ts), pas par des boutons de cette page.

import type { Module } from '../types.ts';

export const keryxModule: Module = {
  id: 'keryx', name: 'Kéryx', family: 'Maison',
  what: 'L\'assistant d\'Odin qu\'on joint de dehors (messagerie, et plus tard SMS ou appel) et qui AGIT à ta place : mails, agenda, autres applis — par message ou par la voix.',
  does: [
    'joignable sans appli par les messageries déjà actives (Telegram…), par la voix, et — quand une ligne est branchée — par SMS ou par appel (codés, pas encore essayés sur du vrai matériel)',
    'agit à ta place : trie, résume et répond à tes mails, tient ton agenda, enchaîne les étapes',
    'peut t\'écrire le premier : rappel de rendez-vous, mail important (selon ce que tu l\'autorises à surveiller)',
    'deux crans avant d\'agir : numéro en liste blanche, puis code secret ; confirmation avant toute action peu réversible',
    'aucune capture d\'écran, aucun pistage de ta position ; échanges et actions privés, chiffrés au repos',
  ],
  from: [], upstream: [],
  words: ['keryx', 'kéryx', 'assistant', 'joignable', 'sms', 'appel', 'texto', 'hermes', 'messager', 'secretaire', 'secrétaire'],
  actions: [],
  view() { return { subtitle: 'L\'assistant joignable de dehors, qui agit à ta place', sections: [] }; },
};
