// Les liens entre les applis d'Odin : qui alimente qui (réflexes automatiques, toujours actifs),
// les usages de prédilection (« pour ce besoin, prends celle-ci, puis celle-là »), et des modèles
// d'automatisations Draupnir qui relient plusieurs applis. Sert aussi à expliquer « qui fait quoi ».

import type { Valhalla } from './service.ts';
import { horn } from './modules/bragi.ts';
import { observe } from './modules/ullr.ts';
import { SENSORS } from './ullr/incidents.ts';

/**
 * Un lien entre deux applis. Tous sont automatiques : rien à activer.
 * `kind` : « réflexe » (une appli en déclenche une autre), « soin » (Odin répare tout seul ; au niveau
 * « prudent » il propose seulement), « donnée » (une appli alimente l'autre en continu).
 */
export interface Link { from: string; to: string; when: string; does: string; auto: true; kind: 'réflexe' | 'soin' | 'donnée' }
export const LINKS: Link[] = [
  { from: 'loki', to: 'garmr', when: 'un pirate tape un mot de passe ou une commande dans un piège', does: 'son adresse est bannie de tes vrais services', auto: true, kind: 'réflexe' },
  { from: 'loki', to: 'ullr', when: 'un pirate fait télécharger un fichier à un piège', does: 'le fichier est gardé à l\'écart (jamais exécuté) et analysé ; le verdict part avec l\'alerte, et l\'attaque rejoint les incidents', auto: true, kind: 'réflexe' },
  { from: 'geri', to: 'garmr', when: 'une connexion part vers une adresse malveillante connue', does: 'l\'adresse est bannie 24 h', auto: true, kind: 'réflexe' },
  { from: 'skogul', to: 'ullr', when: 'un processus suspect tourne', does: 'son programme est analysé ; alerte critique si Ullr confirme, et le signal rejoint les incidents', auto: true, kind: 'réflexe' },
  { from: 'ullr', to: 'forseti', when: 'une menace est trouvée', does: 'l\'alerte rejoint le fil commun et part sur ta messagerie', auto: true, kind: 'donnée' },
  { from: 'sindri', to: 'forseti', when: 'une sauvegarde échoue', does: 'alerte haute sur ta messagerie', auto: true, kind: 'donnée' },
  { from: 'eir', to: 'forseti', when: 'disque, mémoire ou processeur saturés', does: 'alerte avec la cause probable', auto: true, kind: 'donnée' },
  { from: 'naglfar', to: 'forseti', when: 'un conteneur s\'arrête tout seul', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'ymir', to: 'forseti', when: 'une machine virtuelle s\'arrête ou un nœud sature', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'hermod', to: 'forseti', when: 'une machine du parc disparaît du réseau', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'himinbjorg', to: 'midgard', when: 'mouvement détecté aux heures surveillées', does: 'la scène « Alerte intrusion » est lancée si elle existe', auto: true, kind: 'réflexe' },
  { from: 'forseti', to: 'bragi', when: 'alerte critique', does: 'Gjallarhorn la dit à voix haute sur les enceintes (si activé)', auto: true, kind: 'réflexe' },
  { from: 'appareils', to: 'midgard', when: 'un appareil change d\'état', does: 'le tableau de bord de la maison est à jour ; les scènes le commandent', auto: true, kind: 'donnée' },
  { from: 'brokkr', to: 'appareils', when: 'un module est branché sur Odin', does: 'il apparaît dans Appareils puis Midgard', auto: true, kind: 'donnée' },
  { from: 'rodd', to: 'bragi', when: 'tu parles à Odin (web, téléphone, Telegram, Glaðsheimr)', does: 'tes mots de Rödd sont soufflés à l\'écoute puis corrigés : ta voix est mieux comprise partout', auto: true, kind: 'donnée' },
  { from: 'naglfar', to: 'urdr', when: 'une appli installée (Naglfar ou Ymir) a besoin d\'une base', does: 'elle reçoit SA base et son compte dans la base de données d\'Odin (jamais un fichier SQLite), ses variables sont remplies toutes seules, et sa base s\'ouvre dans Urðr Studio et SQL (bouton « Sa base (Urðr) »)', auto: true, kind: 'réflexe' },
  { from: 'svalinn', to: 'brisingamen', when: 'tu relies la box', does: 'son mot de passe d\'administration est rangé dans le coffre (jamais affiché) ; Odin ne force jamais l\'accès', auto: true, kind: 'réflexe' },
  { from: 'svalinn', to: 'forseti', when: 'le Wi-Fi a un problème urgent (WPS, réseau ouvert…) ou un changement est annulé tout seul', does: 'alerte avec ce qu\'il faut corriger', auto: true, kind: 'donnée' },
  { from: 'urdr', to: 'brisingamen', when: 'une base est créée ou reliée', does: 'son mot de passe est rangé dans le coffre (jamais affiché)', auto: true, kind: 'réflexe' },
  { from: 'urdr', to: 'skuld', when: 'une base est créée, ou une requête va la modifier', does: 'sauvegarde chaque nuit, et une sauvegarde juste avant toute modification', auto: true, kind: 'réflexe' },
  { from: 'skuld', to: 'forseti', when: 'une sauvegarde de base échoue', does: 'alerte haute avec le bouton « Réessayer »', auto: true, kind: 'donnée' },
  { from: 'frigg', to: 'runes', when: 'une réservation arrive', does: 'la fiche du client est créée ou mise à jour dans la base « Clients »', auto: true, kind: 'réflexe' },
  { from: 'gjoll', to: 'brisingamen', when: 'un nouvel accès VPN est créé', does: 'sa configuration est rangée dans le coffre chiffré', auto: true, kind: 'réflexe' },
  { from: 'gjoll', to: 'vidarr', when: 'un appareil du VPN coche « DNS d\'Odin »', does: 'il résout par Víðarr, qui le connaît sous son nom : pubs et sites dangereux bloqués aussi hors de la maison, ses requêtes au journal', auto: true, kind: 'réflexe' },
  { from: 'vidarr', to: 'forseti', when: 'un appareil demande un site dangereux (virus, hameçonnage)', does: 'la demande est bloquée et une alerte haute part sur ta messagerie, avec le conseil d\'analyser l\'appareil', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'une machine inonde le DNS (boucle, virus, attaque)', does: 'ses requêtes sont ignorées un moment et tu es prévenu', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'le DNS n\'arrive plus à joindre Internet (box ou serveurs amont en panne)', does: 'alerte haute avec les serveurs en cause ; Víðarr bascule seul sur ses serveurs de secours', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'un appareil jamais vu reçoit une adresse du DHCP d\'Odin', does: 'tu es prévenu avec son nom, son adresse et sa MAC ; son nom répond aussitôt dans le DNS', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'saga', when: 'un jour se termine', does: 'le résumé du réseau (requêtes, blocages, sites dangereux, appareils) est noté dans le Cerveau ; l\'historique jour, mois, année reste dans Víðarr', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'ran', when: 'tu cliques un poste dans le graphe du réseau', does: '« Voir ses paquets » lit ses paquets dans Rán ; son débit s\'affiche dans sa fiche', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'vordr', when: 'Vörðr démarre ou tu demandes les sondes automatiques', does: 'le DNS d\'Odin est surveillé : panne signalée tout de suite', auto: true, kind: 'donnée' },
  { from: 'gjoll', to: 'vordr', when: 'Vörðr démarre ou tu demandes les sondes automatiques', does: 'le tunnel VPN est surveillé : s\'il s\'éteint, tu es prévenu', auto: true, kind: 'donnée' },
  { from: 'freyja', to: 'vordr', when: 'Venus est relié et Vörðr démarre (ou tu demandes les sondes automatiques)', does: 'Venus est surveillé (/api/health) : panne signalée, temps de réponse et disponibilité sur un an', auto: true, kind: 'donnée' },
  { from: 'idunn', to: 'vordr', when: 'un site est suivi par Iðunn', does: 'il devient une sonde de Vörðr (graphe, disponibilité sur un an, page publique d\'état)', auto: true, kind: 'donnée' },
  { from: 'vordr', to: 'forseti', when: 'une sonde passe en panne ou revient', does: 'alerte avec la cause probable (box, Internet, autres pannes) expliquée par Odin ; certificat qui expire bientôt', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'askr', when: 'un appareil reçoit une adresse du DHCP d\'Odin', does: 'il a sa fiche dans l\'inventaire (MAC, fabricant, adresse) ; son adresse y est tenue à jour', auto: true, kind: 'donnée' },
  { from: 'askr', to: 'vordr', when: 'tu cliques « Surveiller » sur un appareil de l\'inventaire', does: 'une sonde ping le surveille : alerte s\'il ne répond plus', auto: true, kind: 'donnée' },
  { from: 'askr', to: 'brisingamen', when: 'tu ajoutes une licence avec sa clé', does: 'la clé est rangée chiffrée dans le coffre, jamais gardée en clair dans l\'inventaire', auto: true, kind: 'réflexe' },
  { from: 'askr', to: 'forseti', when: 'une garantie, une licence finit bientôt ou un prêt est en retard', does: 'alerte avec le modèle et le numéro de série', auto: true, kind: 'donnée' },
  { from: 'valgrind', to: 'vidarr', when: 'tu ajoutes un site au proxy', does: 'à la maison, son nom mène directement à Odin (DNS de la maison) : pas de détour par Internet', auto: true, kind: 'réflexe' },
  { from: 'valgrind', to: 'vordr', when: 'tu ajoutes un site au proxy', does: 'le service derrière est surveillé : panne signalée', auto: true, kind: 'donnée' },
  { from: 'valgrind', to: 'brisingamen', when: 'tu protèges un site par mot de passe', does: 'le mot de passe est rangé dans le coffre ; le proxy n\'en garde que l\'empreinte', auto: true, kind: 'réflexe' },
  { from: 'valgrind', to: 'garmr', when: 'une adresse rate 5 mots de passe en 10 minutes', does: 'elle est bannie une heure (jamais une adresse de la maison)', auto: true, kind: 'réflexe' },
  { from: 'garmr', to: 'valgrind', when: 'une adresse est bannie', does: 'le proxy la refuse sur tous les sites', auto: true, kind: 'réflexe' },
  { from: 'valgrind', to: 'forseti', when: 'un service derrière le proxy ne répond plus ou un certificat ne se renouvelle pas', does: 'alerte avec le site, la cible et les jours restants', auto: true, kind: 'donnée' },
  { from: 'var', to: 'valgrind', when: 'tu réserves un site aux personnes connectées', does: 'le proxy renvoie au portail d\'Odin, vérifie le groupe et transmet l\'identité au service', auto: true, kind: 'réflexe' },
  { from: 'var', to: 'brisingamen', when: 'Odin choisit ou change le mot de passe d\'une personne', does: 'il est rangé dans le coffre ; Vár n\'en garde que l\'empreinte', auto: true, kind: 'réflexe' },
  { from: 'var', to: 'garmr', when: 'un compte est verrouillé après 5 essais', does: 'l\'adresse qui essayait est bannie une heure (jamais une adresse de la maison)', auto: true, kind: 'réflexe' },
  { from: 'var', to: 'forseti', when: 'un compte est verrouillé', does: 'alerte : quelqu\'un essaie peut-être de deviner un mot de passe', auto: true, kind: 'donnée' },
  { from: 'var', to: 'ullr', when: 'des connexions sont refusées ou un compte verrouillé', does: 'le signal rejoint les incidents (recoupé avec le proxy et les pièges)', auto: true, kind: 'donnée' },
  { from: 'var', to: 'bru', when: 'tu règles le portail de connexion', does: 'le portail est publié sur Internet par le tunnel Cloudflare (DNS ajouté tout seul)', auto: true, kind: 'réflexe' },
  { from: 'valgrind', to: 'bru', when: 'tu ajoutes un site au proxy', does: 'il est publié sur Internet par le tunnel Cloudflare : règle du tunnel + DNS chez Cloudflare, sans ouvrir de port', auto: true, kind: 'réflexe' },
  { from: 'bru', to: 'forseti', when: 'Cloudflare voit le tunnel coupé', does: 'alerte : tes noms publiés ne répondent plus depuis Internet (Odin relance le programme)', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'garmr', when: 'le DNS de la maison démarre', does: 'son port (53) est ouvert sur le pare-feu de la machine, et noté dans « Ports ouverts par Odin »', auto: true, kind: 'réflexe' },
  { from: 'gjoll', to: 'garmr', when: 'le VPN s\'allume', does: 'son port UDP est ouvert sur le pare-feu de la machine (la box : bouton « Ouvrir le port »)', auto: true, kind: 'réflexe' },
  { from: 'var', to: 'skidbladnir', when: 'tu ranges une personne dans un groupe', does: 'elle lit ou écrit dans les espaces de fichiers de ce groupe, et a son espace perso', auto: true, kind: 'donnée' },
  { from: 'skidbladnir', to: 'valgrind', when: 'tu mets les fichiers en ligne', does: 'deux noms dans le proxy : l\'espace (réservé) et les liens publics, en HTTPS', auto: true, kind: 'réflexe' },
  { from: 'skidbladnir', to: 'var', when: 'tu mets les fichiers en ligne', does: 'l\'espace demande la connexion d\'Odin ; l\'identité de la personne décide de ses droits', auto: true, kind: 'réflexe' },
  { from: 'fjalar', to: 'ullr', when: 'un installateur est téléchargé', does: 'l\'antivirus le vérifie ; s\'il est suspect il est mis de côté et ne remplace pas l\'ancienne version', auto: true, kind: 'réflexe' },
  { from: 'eitri', to: 'thjalfi', when: 'une ISO arrive dans le dossier d\'Eitri', does: 'elle apparaît dans le menu de démarrage par le réseau, reconnue (Ubuntu, Debian, Rocky, Windows, outils), avec son nombre de déploiements', auto: true, kind: 'donnée' },
  { from: 'fjalar', to: 'thjalfi', when: 'une machine Windows s\'installe par le réseau avec un profil qui a des logiciels', does: 'les installateurs de Fjalar lui sont servis et s\'installent en silencieux à la première ouverture de session', auto: true, kind: 'donnée' },
  { from: 'thjalfi', to: 'askr', when: 'une machine finit de s\'installer par le réseau', does: 'elle a sa fiche dans l\'inventaire : nom pris sur le réseau, MAC, adresse, système installé', auto: true, kind: 'réflexe' },
  { from: 'thjalfi', to: 'forseti', when: 'une installation par le réseau finit, rate ou ne donne plus de nouvelles', does: 'tu es prévenu avec le nom de la machine, l\'ISO et la durée', auto: true, kind: 'donnée' },
  { from: 'thjalfi', to: 'brisingamen', when: 'tu crées un profil d\'installation', does: 'le mot de passe du compte créé sur les machines est généré et rangé dans le coffre', auto: true, kind: 'réflexe' },
  { from: 'thjalfi', to: 'ullr', when: 'un chargeur de démarrage officiel (iPXE, wimboot) est téléchargé', does: 'l\'antivirus le vérifie ; s\'il est suspect, il n\'est jamais servi aux machines', auto: true, kind: 'réflexe' },
  { from: 'thjalfi', to: 'vidarr', when: 'Þjálfi est allumé et le DHCP d\'Odin donne les adresses', does: 'sa réponse indique aussi le chargeur aux machines qui démarrent par le réseau (rien à régler)', auto: true, kind: 'réflexe' },
  { from: 'skidbladnir', to: 'ullr', when: 'un fichier arrive (envoi, dépôt, lecteur réseau)', does: 'l\'antivirus le vérifie ; s\'il est suspect il est mis de côté, pas publié', auto: true, kind: 'réflexe' },
  { from: 'skidbladnir', to: 'forseti', when: 'un fichier suspect arrive, un espace est presque plein, une synchro a un conflit', does: 'alerte avec la procédure et le bouton qui règle', auto: true, kind: 'donnée' },
  { from: 'skidbladnir', to: 'garmr', when: '5 mots de passe faux sur un lien ou le lecteur réseau', does: 'l\'adresse est bannie (jamais une adresse de la maison)', auto: true, kind: 'réflexe' },
  { from: 'valgrind', to: 'ullr', when: 'une adresse d\'Internet cherche des failles sur tes sites ou rate des mots de passe', does: 'le signal rejoint les incidents (recoupé avec les pièges de Loki : c\'est un attaquant)', auto: true, kind: 'donnée' },
  { from: 'valgrind', to: 'ran', when: 'tu cliques un service dans le graphe du proxy', does: '« Voir ses paquets » ouvre ce qui passe vers cette machine', auto: true, kind: 'donnée' },
  { from: 'gjoll', to: 'forseti', when: 'un accès VPN arrive à sa date de fin', does: 'l\'appareil est coupé du tunnel tout seul et tu es prévenu', auto: true, kind: 'donnée' },
  { from: 'bragi', to: 'freyja', when: 'tu dis « mets … sur la télé » (ordre à la voix)', does: 'Bragi transcrit, Huginn comprend sans IA, Freyja lance le titre', auto: true, kind: 'réflexe' },
  { from: 'midgard', to: 'freyja', when: 'une scène contient l\'étape « freyja.regarder = titre »', does: 'les lumières se règlent puis Freyja ouvre le titre', auto: true, kind: 'réflexe' },
  { from: 'kvasir', to: 'runes', when: 'une appli d\'origine publie une version', does: 'une fiche dans la base « Évolutions »', auto: true, kind: 'réflexe' },
  { from: 'sindri', to: 'ymir', when: 'un plan de sauvegarde couvre des machines virtuelles (mode Andvari)', does: 'Ymir prend un instantané de chaque machine juste avant la sauvegarde', auto: true, kind: 'réflexe' },
  { from: 'naglfar', to: 'naglfar', when: 'un conteneur s\'arrête tout seul', does: 'Odin le relance (une fois par heure au plus) et te prévient : « garde » ou « annule »', auto: true, kind: 'soin' },
  { from: 'ymir', to: 'ymir', when: 'une machine virtuelle s\'arrête toute seule', does: 'Odin la relance (une fois par heure au plus) et te prévient', auto: true, kind: 'soin' },
  { from: 'sindri', to: 'sindri', when: 'une sauvegarde échoue', does: 'Odin la relance une fois, dix minutes plus tard', auto: true, kind: 'soin' },
  // Ullr relie ce que voient toutes les applis : un signal seul ne dit rien, plusieurs qui se recoupent font un incident.
  ...SENSORS.filter((q) => !['loki', 'skogul'].includes(q.app)).map((q): Link => ({ from: q.app, to: 'ullr', when: q.when, does: 'le signal rejoint les incidents d\'Ullr : s\'il recoupe ceux d\'une autre appli, un incident est ouvert avec son score et sa chronologie', auto: true, kind: 'donnée' })),
  { from: 'idunn', to: 'forseti', when: 'un site tombe, un déploiement ou des tests échouent, un certificat arrive à sa fin', does: 'alerte sur ta messagerie, avec le lien pour aller voir', auto: true, kind: 'donnée' },
  { from: 'idunn', to: 'idunn', when: 'un déploiement arrive en production', does: 'Odin essaie le site (pages, liens, erreurs affichées) ; si quelque chose casse, tu es prévenu et il te propose de revenir en arrière', auto: true, kind: 'soin' },
  { from: 'ullr', to: 'garmr', when: 'un incident sérieux implique une adresse extérieure', does: 'l\'adresse est bannie 24 h au pare-feu (manip annulable)', auto: true, kind: 'réflexe' },
  { from: 'ullr', to: 'saga', when: 'un incident sérieux est ouvert, s\'aggrave ou est classé', does: 'une note datée dans le Cerveau raconte l\'incident : chronologie, score, ce qui a été fait', auto: true, kind: 'réflexe' },
];

/** Usages de prédilection : besoin → chaîne d'applis. */
export const USAGES: Array<{ need: string; chain: string[]; why: string }> = [
  { need: 'protéger un serveur ouvert sur Internet', chain: ['loki', 'garmr', 'geri', 'forseti'], why: 'Loki attire et repère les pirates, Garmr les bannit, Geri surveille ce qui sort, Forseti rassemble tout.' },
  { need: 'savoir si un fichier est dangereux', chain: ['ullr'], why: 'empreintes connues, règles et heuristiques, quarantaine.' },
  { need: 'surveiller la santé d\'une machine', chain: ['eir', 'skogul', 'forseti'], why: 'Eir mesure, Skögul regarde les processus, Forseti alerte.' },
  { need: 'ne jamais perdre ses fichiers', chain: ['sindri', 'forseti'], why: 'sauvegardes chiffrées dédoublonnées, alerte si une sauvegarde échoue.' },
  { need: 'accéder à la maison de l\'extérieur', chain: ['gjoll', 'hermod'], why: 'Gjöll crée le VPN, Hermóðr réveille et pilote les machines.' },
  { need: 'bloquer les pubs et les sites dangereux pour toute la maison', chain: ['vidarr', 'gjoll', 'forseti'], why: 'Víðarr filtre le DNS de la maison, Gjöll l\'étend aux appareils en déplacement, Forseti alerte si un appareil cherche un site dangereux.' },
  { need: 'piloter la maison', chain: ['brokkr', 'appareils', 'midgard', 'bragi'], why: 'Brokkr branche les modules, Appareils les connaît, Midgard les réunit en pièces et scènes, Bragi parle.' },
  { need: 'surveiller la maison', chain: ['himinbjorg', 'midgard', 'bragi'], why: 'caméras et mouvements, scène d\'alerte, annonce à voix haute.' },
  { need: 'regarder un film ou la télé', chain: ['freyja', 'midgard', 'bragi'], why: 'Freyja lance le titre sur l\'écran, Midgard règle l\'ambiance, Bragi te comprend à la voix.' },
  { need: 'gérer des rendez-vous clients', chain: ['frigg', 'runes', 'draupnir'], why: 'Frigg prend les rendez-vous, Runes garde les fiches clients, Draupnir envoie les rappels.' },
  { need: 'faire tourner des services', chain: ['naglfar', 'ymir', 'sindri'], why: 'conteneurs, machines virtuelles, et leurs sauvegardes.' },
  { need: 'tenir beaucoup de visiteurs', chain: ['naglfar', 'urdr', 'valgrind', 'vordr'], why: 'Naglfar met ton site en plusieurs copies qui suivent les visiteurs, Urðr tient la base, Valgrind sert le nom et le HTTPS, Vörðr surveille.' },
  { need: 'sécuriser mon Wi-Fi', chain: ['svalinn', 'brisingamen'], why: 'Svalinn note le Wi-Fi et corrige avec ton accord, le coffre garde le mot de passe de la box.' },
  { need: 'voir les données d\'une appli installée', chain: ['naglfar', 'urdr', 'skuld'], why: 'les applis qui ont besoin d\'une base l\'ont dans la base d\'Odin : Urðr Studio et SQL l\'ouvrent, Skuld la sauvegarde. Celles qui n\'en ont pas besoin : ce qu\'elles font va dans la mémoire d\'Odin (journal des applis du Cerveau), sans base de données.' },
  { need: 'écrire en parlant', chain: ['rodd', 'saga', 'volva'], why: 'Rödd transcrit et met en forme, Saga garde la note, Völva cherche à partir de ta dictée.' },
  { need: 'gérer des bases de données', chain: ['urdr', 'skuld', 'brisingamen'], why: 'Urðr crée et ouvre les bases (Studio, SQL), Skuld les sauvegarde, Brísingamen garde les mots de passe.' },
  { need: 'gérer un site web', chain: ['idunn', 'forseti', 'ullr'], why: 'Idunn surveille, essaie, déploie et met à jour ; Forseti t\'alerte ; Ullr relie un changement de DNS, de certificat ou de page d\'accueil pour reconnaître un détournement.' },
  { need: 'garder ses mots de passe', chain: ['brisingamen'], why: 'coffre chiffré, codes à usage unique, vérification des fuites.' },
  { need: 'organiser ses idées et projets', chain: ['saga', 'runes', 'draupnir'], why: 'Saga relie les notes, Runes en fait des bases, Draupnir automatise.' },
];

/** Branche les réflexes intégrés (ceux qui ne sont pas déjà dans les modules eux-mêmes). */
export function wireReflexes(v: Valhalla, o: { retryMs?: number } = {}): () => void {
  const lastCare = new Map<string, number>(), timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Un « soin » : Odin répare lui-même (action simple et annulable), au plus une fois par heure pour la même chose.
   * Niveau « prudent » : il ne touche à rien et te dit seulement ce qu'il ferait.
   */
  const care = (key: string, module: string, action: string, input: Record<string, unknown>, why: string, say: string): void => {
    const now = Date.now(); if (now - (lastCare.get(key) ?? 0) < 3600_000) return;
    lastCare.set(key, now);
    if (v.autonomy() === 'prudent') { v.alert(module, { level: 'moyenne', title: `Je peux réparer : ${say}`, detail: `${why}. En niveau « Me demander », je ne fais rien seul : dis-le-moi (« ${say} ») ou passe en « Équilibré ».`, key: `soin:${key}` }); return; }
    void v.act(module, action, input, { auto: true, by: 'odin', why });
  };
  const hasUllr = v.modules().some((m) => m.id === 'ullr');
  const onEvent = (e: { module: string; type: string; data: Record<string, unknown> }) => {
    // Ullr relie les signaux de toutes les applis en incidents (jamais bloquant pour le reste).
    if (hasUllr) try { observe(v.ctx('ullr'), e); } catch (err) { console.error(`[ullr] incident : ${(err as Error).message}`); }
    if (e.module === 'skogul' && e.type === 'suspect' && e.data.pid) {
      void v.act('ullr', 'fichier', { chemin: `/proc/${Number(e.data.pid)}/exe` }, { auto: true, by: 'réflexe' }).then((r) => { if (r.ok && /⚠/.test(r.text)) v.alert('ullr', { level: 'critique', title: 'Processus suspect confirmé par Ullr', detail: r.text.slice(0, 500), key: `proc:${String(e.data.pid)}` }); });
    }
    if (e.module === 'himinbjorg' && e.type === 'mouvement' && e.data['surveillé'] !== false) {
      const sc = ((v.ctx('midgard').settings.scenes as Array<{ name: string }> | undefined) ?? []).find((x) => /intrusion/i.test(x.name));
      if (sc) void v.act('midgard', 'scene', { scene: sc.name }, { auto: true, by: 'réflexe', why: `mouvement sur la caméra ${String(e.data['caméra'] ?? '')} aux heures surveillées` });
    }
    // Frigg → Runes : chaque réservation crée ou met à jour la fiche du client.
    if (e.module === 'frigg' && e.type === 'reservation' && e.data.name) void v.act('runes', 'client', { nom: String(e.data.name), contact: String(e.data.contact ?? ''), rendez_vous: String(e.data.start ?? ''), prestation: String(e.data.service ?? '') }, { auto: true, by: 'réflexe', why: 'nouvelle réservation' });
    // Idunn : chaque mise en production est essayée ; un essai raté propose le retour en arrière (action grave : jamais lancée seule).
    if (e.module === 'idunn' && e.type === 'deploiement_ok' && e.data.production === true && e.data.site) {
      const name = String(e.data.site);
      void v.act('idunn', 'tester', { site: name }, { auto: true, by: 'réflexe', why: 'nouveau déploiement en production' }).then((r) => { if (r.ok && (r.data as { ok?: boolean } | undefined)?.ok === false) v.alert('idunn', { level: 'haute', title: `${name} : le nouveau déploiement casse quelque chose`, detail: `${r.text.slice(0, 600)}\nPour revenir à la version d'avant : « reviens à la version précédente du site ${name} ».`, key: `essai:${name}` }); });
    }
    // Soins : ce qu'Odin répare tout seul.
    if (e.module === 'naglfar' && e.type === 'conteneur_arrete' && e.data.conteneur) care(`ct:${String(e.data.conteneur)}`, 'naglfar', 'demarrer', { conteneur: String(e.data.conteneur) }, `le conteneur ${String(e.data.conteneur)} s'est arrêté tout seul`, `démarre le conteneur ${String(e.data.conteneur)}`);
    if (e.module === 'ymir' && e.type === 'vm_arretee' && e.data.vmid) care(`vm:${String(e.data.vmid)}`, 'ymir', 'demarrer', { vmid: Number(e.data.vmid) }, `la machine virtuelle ${String(e.data.nom ?? e.data.vmid)} s'est arrêtée toute seule`, `démarre la machine virtuelle ${String(e.data.vmid)}`);
    if (e.module === 'sindri' && e.type === 'sauvegarde_echec' && e.data.plan) {
      const key = `sv:${String(e.data.plan)}`, now = Date.now(); if (now - (lastCare.get(key) ?? 0) < 6 * 3600_000 || v.autonomy() === 'prudent') return;
      lastCare.set(key, now);
      const t = setTimeout(() => { timers.delete(t); void v.act('sindri', 'sauvegarder', { plan: String(e.data.plan) }, { auto: true, by: 'odin', why: `la sauvegarde « ${String(e.data.plan)} » avait échoué (${String(e.data.erreur ?? '').slice(0, 80)})` }); }, o.retryMs ?? 600_000);
      (t as { unref?: () => void }).unref?.(); timers.add(t);
    }
  };
  const onAlert = (a: { level: string; title: string; module: string }) => { if (a.level === 'critique') void horn(v.ctx('bragi'), `Alerte : ${a.title}`); };
  v.events.on('event', onEvent); v.events.on('alert', onAlert);
  return () => { v.events.off('event', onEvent); v.events.off('alert', onAlert); for (const t of timers) clearTimeout(t); timers.clear(); };
}

/** Modèles d'automatisations entre applis (Draupnir). */
export function linkTemplates(): Array<{ id: string; name: string; what: string; flow: { name: string; nodes: unknown[]; connections: Record<string, Array<Array<{ node: string }>>> } }> {
  const pos = (i: number): [number, number] => [i * 260, 200];
  return [
    { id: 'mouvement-photo', name: 'Mouvement → photo sur ma messagerie', what: 'Quand Himinbjörg détecte un mouvement, une photo et un message.', flow: { name: 'Mouvement → photo', nodes: [
      { name: 'Mouvement', type: 'déclencheur.module', params: { module: 'Himinbjörg', 'événement': 'mouvement' }, position: pos(0) },
      { name: 'Photo', type: 'module.action', params: { module: 'himinbjorg', action: 'photo', 'entrée': '{"camera":"{{ $json.caméra }}"}' }, position: pos(1) },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📷 Mouvement sur {{ $node["Mouvement"].json.caméra }}' }, position: pos(2) },
    ], connections: { Mouvement: [[{ node: 'Photo' }]], Photo: [[{ node: 'Prévenir' }]] } } },
    { id: 'reservation-client', name: 'Réservation → fiche client', what: 'Chaque réservation Frigg crée une fiche dans la base Clients de Runes.', flow: { name: 'Réservation → fiche client', nodes: [
      { name: 'Réservation', type: 'déclencheur.module', params: { module: 'Frigg', 'événement': 'reservation' }, position: pos(0) },
      { name: 'Fiche', type: 'runes.ajouter', params: { base: 'Clients', titre: '{{ $json.name }}', 'propriétés': '{"Contact":"{{ $json.contact }}","Dernier rendez-vous":"{{ $json.start }}"}' }, position: pos(1) },
    ], connections: { Réservation: [[{ node: 'Fiche' }]] } } },
    { id: 'sauvegarde-nuit', name: 'Chaque nuit : sauvegarde puis bilan', what: 'Lance les sauvegardes Sindri à 3 h et t\'envoie le bilan.', flow: { name: 'Sauvegarde de nuit', nodes: [
      { name: 'À 3 h', type: 'déclencheur.planning', params: { mode: 'cron', cron: '0 3 * * *' }, position: pos(0) },
      { name: 'Sauvegarder', type: 'module.action', params: { module: 'sindri', action: 'sauvegarder', 'entrée': '{}' }, position: pos(1) },
      { name: 'Bilan', type: 'odin.prévenir', params: { texte: '💾 {{ $json.texte }}' }, position: pos(2) },
    ], connections: { 'À 3 h': [[{ node: 'Sauvegarder' }]], Sauvegarder: [[{ node: 'Bilan' }]] } } },
    { id: 'je-pars', name: 'Je pars : scène + VPN + caméras', what: 'Un webhook (raccourci téléphone) lance la scène « Je pars » et active la surveillance.', flow: { name: 'Je pars', nodes: [
      { name: 'Raccourci', type: 'déclencheur.webhook', params: {}, position: pos(0) },
      { name: 'Scène', type: 'module.action', params: { module: 'midgard', action: 'scene', 'entrée': '{"scene":"Je pars"}' }, position: pos(1) },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '🏠 Maison en mode absence.' }, position: pos(2) },
    ], connections: { Raccourci: [[{ node: 'Scène' }]], Scène: [[{ node: 'Prévenir' }]] } } },
    { id: 'alertes-saga', name: 'Alertes hautes → notes Saga', what: 'Chaque alerte haute ou critique devient une note dans Saga.', flow: { name: 'Alertes → journal', nodes: [
      { name: 'Alerte', type: 'déclencheur.module', params: { module: 'Forseti', 'événement': 'alerte', niveau: 'haute' }, position: pos(0) },
      { name: 'Noter', type: 'saga.écrire', params: { mode: 'créer', titre: 'Alerte {{ $json.appli }} : {{ $json.title }}', type: 'capture', contenu: '{{ $json.niveau }} · {{ $json.appli }} : {{ $json.title }}\n{{ $json.detail }}' }, position: pos(1) },
    ], connections: { Alerte: [[{ node: 'Noter' }]] } } },
  ];
}
