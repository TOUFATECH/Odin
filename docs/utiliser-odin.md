# Utiliser Odin : le détail

Ce document garde le détail des fonctions qui ne tient pas dans le [README](../README.md). Le parcours guidé est dans le [guide](../site/guide.html) ; l'état de chaque chose (fait, en cours, à venir) est dans [etat.json](etat.json).

## Utilisation

## Interface web

`odin web` ouvre l'interface. Par défaut elle est **joignable sur ton réseau local, en HTTPS** : `https://127.0.0.1:8888` sur la machine, `https://192.0.2.20:8888` (son adresse locale) depuis ton téléphone. Les liens personnels, avec jeton, s'affichent au démarrage ; le jeton est aussi dans `~/.odin/web-token`.

| Onglet | Ce que tu y fais |
|---|---|
| **Discussion** | parler à Odin, voir ses outils en direct, répondre aux validations en un clic (Autoriser · Toujours autoriser · Refuser) ; celles qui attendent encore reviennent quand tu ouvres Odin |
| **Missions** | tout ce qu'Odin fait ou a fait : origine (toi, tâche planifiée, initiative), étapes, outils, sous-agents, coût ; **Arrêter** une mission en cours, **Reprendre** une mission interrompue |
| **Réseau** | appareils en ligne, déconnectés, retirés ; ce qu'Odin peut faire avec chacun ; balayage à la demande |
| **Mémoire** | souvenirs d'Odin ; valider ceux en quarantaine, épingler, oublier |
| **Compétences** | relire et approuver les compétences qu'Odin propose |
| **Tâches planifiées** | voir et supprimer les tâches récurrentes |
| **Décisions** | tout ce qu'Odin a fait, qui l'a décidé et pourquoi ; niveau d'autonomie ; autorisations permanentes |
| **Réglages** | modèle et clés (avec test), **budget mensuel** et dépense par modèle et par usage, autonomie et juge, **personnes** (propriétaires, membres, invités), Telegram, voix, réseau local, accès, **sauvegarde chiffrée** |

### Odin, sur toutes les pages

La mascotte d'Odin te suit sur chaque page. Touche-la (ou Entrée) :
- **tu lui parles directement**, où que tu sois : c'est la même conversation que la Discussion, il sait sur quelle page ou quelle appli tu es, et il répond dans sa bulle ;
- il répond **à voix haute** tant que tu ne l'as pas coupé (bouton 🔊 de la bulle ou de la Discussion, ou Réglages → Voix ; sans voix réglée, c'est celle du navigateur) ;
- il explique la page ou l'appli ouverte, **comment s'en servir et comment la régler, de A à Z** ;
- son infobulle et son champ de saisie changent selon la page ou l'appli ;
- **Quoi de neuf** détaille la dernière mise à jour ; après une mise à jour, il te présente lui-même ce qui vient d'arriver ;
- **Arbre d'évolution** (aussi dans Réglages → Plus) : un système solaire, avec Odin au centre et une planète par appli ou partie d'Odin ; chaque planète montre ses évolutions datées (nouveautés, améliorations, corrections) et une ligne suit les versions. Il se lit dans l'historique des mises à jour, donc toujours à jour.

La **visite guidée** ne se lance que si tu la demandes (« visite guidée », Réglages → Plus, ou la bulle). Elle se termine par **les applis de A à Z** : à quoi sert chacune, comment l'utiliser, comment la régler.

### Graphes des applis et du réseau

Comme le Cerveau, **Applis** et **Maison → Carte** s'affichent en graphe : on glisse, on zoome, on cherche, on touche un point pour l'ouvrir. Les applis sont reliées à leur famille et aux applis avec lesquelles elles travaillent ; les appareils, à leur famille et à la box. Les pastilles montrent ce qui demande ton attention : **rouge ou orange** pour les alertes d'une appli ou un problème sur une machine (risque repéré, appareil surveillé tombé), **bleue** pour les nouveautés du projet d'origine d'une appli ; un point **gris** est hors ligne.

**Quand deux applis se parlent**, sur la carte des applis, c'est la ligne elle-même qui brille, très claire en blanc, puis s'éteint doucement (en 1,5 s) : plus de flèche, de comète ni de points (ton choix). Le Cerveau garde ses influx.

**Graphe 3D** : à côté du bouton **Graphe**, un bouton **Graphe 3D** montre les mêmes points dans un espace sombre : chaque point brille de la couleur de son groupe, le nom des groupes est écrit en capitales. On tourne en glissant, on zoome à la molette ou en pinçant, et toucher un point fait voler la vue vers lui et l'ouvre. Il est proposé sur la **carte des applis**, sur la page d'une **appli qui montre un graphe**, dans l'onglet **Plugins** des compétences, dans le graphe des **scripts** (Archytas), sur la carte **Qui parle à qui** des paquets (Ariane) dans le graphe du **Cerveau** (les notes groupées par type ; au-delà de 600 éléments, les plus liés sont montrés et c'est dit à l'écran) et sur la **carte du réseau** de la Maison (les appareils groupés par famille). Odin retient ton choix pour chaque endroit. Le dessin est fait par Odin lui-même, sans bibliothèque extérieure. Pas encore : le Profil, le proxy, le VPN.

### Paquets réseau (Ariane)

Comme Wireshark : Ariane **lit les paquets en entier et les décode couche par couche** (modèle OSI : trame, liaison Ethernet, réseau IPv4/IPv6, transport TCP/UDP, chiffrement TLS, application), avec tous les champs et le contenu brut en hexadécimal. Il reconnaît DNS (questions et réponses), HTTP (requêtes, en-têtes, début du contenu), HTTPS (nom du site demandé), QUIC, DHCP, ARP, ICMP, SSH, mDNS, UPnP, NTP, WireGuard…, et apprend le nom des sites d'Internet (réponses DNS, noms TLS) pour les afficher à la place des adresses.

- **Lire les paquets** : tout le réseau (page de l'appli Ariane) ou une machine (sous sa fiche, sur la carte de la Maison). **Pause** : plus aucun paquet n'est lu. Aussi en le disant : « lis les paquets », « pause ».
- **Qui parle à qui** : une carte interactive (machines du réseau, sites d'Internet en bleu, diffusions en vert) reliée par des flèches dans le sens de la communication, épaisses selon le volume. Touche une machine : ses communications (avec qui, dans quel sens, quelles applis, quels sites) ; touche une flèche : les paquets de ce lien.
- **Chaque paquet** : ce qui se passe en une phrase, chaque couche avec ses champs, le contenu brut. **🦉 Odin, explique** : Odin explique le paquet ou toute la scène dans sa bulle.
- Historique 7 jours (250 000 paquets au plus, 4 ko de contenu par paquet), sur la machine d'Odin seulement ; filtre par appli, site, protocole, port ou adresse.

Points de capture : la machine d'Odin, plus **chaque machine où Odin a un accès** (Réglages → Droits et machines) — tout son trafic, par SSH. Un hôte Proxmox voit ainsi tout ce qu'échangent ses machines virtuelles, un routeur Linux tout ce qui entre et sort du réseau. Sur un réseau avec switch ou box, une machine sans point de capture n'est vue que dans ses échanges avec un point de capture et dans ce qu'elle diffuse. Le contenu chiffré (HTTPS, QUIC, SSH, VPN) reste illisible, comme dans Wireshark sans les clés ; ce qui passe en clair (HTTP, DNS…) se lit en entier, mots de passe compris : l'historique reste sur ta machine et s'efface depuis Ariane.

### Connexion unique (Persona)

Toutes les applis se connectent avec ton compte Odin : Pégase, Vénus, et tout logiciel qui sait faire OpenID (Penpot…). Odin est le fournisseur d'identité (OpenID Connect avec PKCE, jetons ES256 de 15 minutes, renouvellement lié à l'appareil). Sur un ordinateur, la première appli connectée range un jeton dans le coffre du système (Windows, Mac, Linux) : les autres s'ouvrent déjà connectées. Dans Persona, l'onglet **Accès** dit qui a droit à quelle appli ; sans droit, l'appli est cachée ou un message dit à qui demander. Toi seul changes les droits et les comptes des personnes : **donner** (un accès à une appli, une case cochée, l'entrée dans un groupe — dans Persona comme dans Agora —, une appli du store ouverte à un groupe, un nouveau compte, un mot de passe donné à une fiche, une invitation, un site ouvert à plus de monde, une adresse de retour de plus pour une appli) te demande toujours de confirmer, et la demande dit pour qui, quoi, avant → après (ex. « autorisés : admin → admin, @personne-a ») ; **retirer** ou décocher s'applique tout de suite (sauf enlever quelqu'un de son dernier groupe : il passe dans « invite », et la demande le montre). Annuler une manip qui redonnerait un droit (« annule <code> », « annule tout ») demande aussi ta confirmation ; garder ou annuler les manips, c'est toi seul. Une personne qui a l'accès à Persona ou à Agora (même du groupe admin) n'y change rien, ni pour elle ni pour les autres, pas plus qu'une automatisation, un réflexe, Odin seul ou une conversation qui vient de lire un contenu extérieur — y compris en passant par une autre appli. Les applis sauvegardent leur base sur Odin (`/api/sauvegardes/<appli>`), chiffrée, avec des versions. Contrat : `docs/sso-protocole.md` ; bibliothèque cliente sans dépendance : `clients/odin-sso.mjs`.

### Pégase : ton navigateur relié à Odin

Le navigateur Pégase (ordinateur et Android) est un programme livré à part. Odin en tient le service : le compte, la synchronisation et ce qu'Odin en voit, décrits ci-dessous.

Pégase (Windows, Mac, Linux, Android) se connecte à Odin avec ton compte (le même que partout : connexion unique). Dans Odin, l'appli **Pégase** montre tes appareils (et les révoque), l'état de la synchro, l'historique cherchable par jour, les copies (une par jour, restaurables d'un geste) et ce que l'IA d'Odin peut voir de ta navigation (tout, sans l'historique, ou rien). Favoris, onglets, agenda et historique se synchronisent à la seconde entre l'ordinateur et le téléphone, avec une vérification à l'identique ; les cookies et les mots de passe restent sur chaque appareil. Les téléchargements passent par Asclépios, les liens par Sphinx, les alertes arrivent dans Forseti. Contrat entre Pégase et Odin : `docs/pegase-protocole.md`.

### Agora : le store d'Odin (le service)

Tu mets une personne dans un groupe de Persona : les applis autorisées à ce groupe apparaissent dans son espace Odin et dans le store de ses ordinateurs et téléphones. Dans Odin, l'appli **Agora** (réservée aux admins ; les autres y voient seulement leur store) a quatre onglets : **Catalogue** (applis d'Odin en web, installateurs Windows, Mac, Linux et Android avec leur version, leur empreinte SHA-256 et l'avis d'Asclépios), **Groupes** (pour chaque groupe et chaque appli : *Proposée*, *Installée d'office* ou *Retirée*), **Appareils** (en ligne ou non, ce qui y est installé, « Forcer » une installation ou une désinstallation, avec ton accord) et **Journal**. Le droit est celui de la connexion unique : rien en double avec Persona.

Les stores des appareils se connectent avec le compte Odin (connexion unique, appli « agora ») et reçoivent les ordres à la seconde (`/api/agora/*`, flux SSE). Sur l'ordinateur : ce qui est imposé s'installe ou se désinstalle tout seul (Linux : AppImage dans `~/Applications` ou paquet .deb ; Windows : installateur silencieux ; Mac : .dmg vers Applications), le reste d'un clic, et chaque installateur est vérifié (empreinte) avant d'être installé. Sur Android, Android demande un toucher pour confirmer, sauf si le téléphone est « géré par Odin » (Agora propriétaire de l'appareil). Sur iPhone, Apple ne permet pas d'installer hors de l'App Store : les applis d'Odin y passent par le web. Alertes dans Forseti : installation échouée, appareil inconnu, nouvel appareil.

### Vénus dans Odin : tes films sur tes dossiers

**Ce que tu vois en ouvrant Vénus** : l'interface de l'appli Vénus d'origine, dans la page d'Odin (adresse `/#venus`), avec le menu d'Odin à côté. Les planètes et leurs mises en page, l'accueil, Films, Séries, Animés, Clips, Ma liste, la fiche d'un titre (saisons, épisodes, reprise, vu ou non vu, épisodes manquants), la recherche (Ctrl+K) et « Qui regarde ? » sur les comptes d'Odin (un profil enfant ne voit pas tout). Ce qui n'existe pas encore est dit à l'écran, jamais inventé. Réservé à toi et à tes profils.

- **Le lecteur** : les mêmes touches que l'appli d'origine (avance, recul, volume, vitesse, minuterie de sommeil, image dans l'image, plein écran, épisode suivant). Les pistes audio du fichier (le choix est gardé par profil), les qualités plus légères quand Odin mesure qu'il peut les produire (sinon grisées avec la raison), les sous-titres du fichier et ceux posés à côté, la bande-annonce posée à côté du film ; la touche C ouvre « Audio et sous-titres ». La reprise est gardée par profil ; « vu » seulement à la vraie fin. Rien ne sort sur Internet.
- **Affiches et fiches** : Odin tire lui-même une vignette de chaque film et épisode. L'affiche, le fond, le résumé, les genres, les notes et la distribution ne viennent que si tu l'as réglé ; les images sont vérifiées et gardées chez toi, ton navigateur ne charge rien d'Internet.
- **Faire venir un film ou une série** : un clic sur un titre « à venir » (♡ pour une envie, ⬇ pour le faire venir tout de suite). Odin garde la demande, cherche dans les sources que **tu** règles (aucune n'est remplie d'avance), télécharge (aussi par partage de fichiers, avec son propre moteur, sans port ouvert sans toi), passe l'antivirus, renomme et range le fichier dans un dossier déclaré : le titre apparaît dans Vénus. Pour une série, seul l'épisode manquant vient. Un fichier douteux est mis à part jusqu'à ton accord. La demande d'un membre attend ta validation ; un membre ne voit que ses demandes. Écrans : « À venir », « Mes envies », « Nouveau », « Nouveautés », et Réglages → Demandes.
- **Ajouter à mon calendrier** (sur « À venir ») : un lien personnel à mettre dans l'agenda de ton téléphone, avec les sorties relevées par Odin, tes séries et tes envies. Seule ta session l'obtient. Le calendrier se met à jour quand « À venir » est ouvert.
- **La maison** : « Ce soir » (trois questions, trois idées) et « Qui regarde ce soir ? » (rien proposé si un enfant est là : l'âge des titres n'est pas connu) ; le vote en famille (code de 4 lettres ou QR, une voix par appareil, fini au bout de 3 h) ; « Mes statistiques » de l'année et la rétrospective, calculées sur ce profil seulement ; les collections (créées par toi, vues par tous) et les listes de chaque profil ; « Télécharger » le fichier d'origine depuis la fiche.
- **La séance à plusieurs** : on la rejoint avec un code de 4 lettres.
- **La télécommande** : choisir un écran connu d'Odin, reculer de 30 s, lecture ou pause, avancer de 30 s ; un QR code ouvre la télécommande complète sur un autre téléphone. La croix, les chaînes et « Reprendre sur la TV » ne sont pas encore là : c'est dit à l'écran.
- **Les téléchargements** : une version légère (720p ou 480p) préparée sur la machine d'Odin, pour un film ou pour toute une saison, une à la fois, sans jamais remplir le disque, avec la langue choisie dans le lecteur et les sous-titres texte. Elle est gardée 7 jours ; ce ménage se voit dans Talos. Un profil enfant ne télécharge pas ; chaque profil ne voit que les siennes. Ces copies, qu'Odin sait refaire, ne vont pas dans la sauvegarde.
- **Le tableau de bord** (pour l'administrateur seulement) : le nombre de films, de séries, d'animés, de clips et d'épisodes, la place prise ; les lectures en cours (sans adresse d'appareil) ; les écrans connus ; ce qui s'est passé ; la santé de la machine (une mesure qu'Odin ne sait pas lire est dite « source absente », jamais 0 %) ; les tâches de fond, et « Analyser » qui relance l'analyse des médiathèques ; chaque dossier et s'il est accessible. Un profil enfant n'a ni l'entrée ni la page.
- **Pas encore là** : dans l'administration, le code de connexion, déconnecter un appareil, redémarrer, le message à tous, mettre en pause une lecture ; les pages Qualité, Sécurité et Serveur ; les autres rubriques des réglages. **À venir** : la musique, les livres et les photos, la télévision en direct.

L'ancienne page de Vénus reste joignable par « Médiathèques et écrans ». C'est là, dans **Odéon**, que se déclarent les dossiers, en trois gestes :

1. colle le chemin complet d'un dossier de la machine d'Odin (par exemple `D:\Films`) et choisis sa catégorie (films, séries, musique…) ;
2. touche **Ajouter le dossier** ;
3. touche **Scanner maintenant**, puis touche un titre : il se lit dans le navigateur.

Tant que la bibliothèque est vide, ce panneau des dossiers est en haut de la page. Un dossier introuvable est refusé avec la raison ; après un scan, Odin dit combien de fichiers il a lus et pourquoi il en a laissé de côté. Il lui faut le programme FFmpeg sur sa machine : s'il manque, la page le dit et explique comment l'installer. Une vidéo déjà au bon format d'image (un MKV en H.264, le plus souvent) est recopiée telle quelle pour le navigateur, sans être réencodée. Vénus ouvre les dossiers de la machine : **toi seul** y entres ; un membre de la famille n'y a pas accès, même s'il peut ouvrir l'appli.

Dans le lecteur, un film qu'Odin doit convertir pour ton navigateur montre sa **durée entière** ; un clic sur la barre, un doigt ou les flèches du clavier (dix secondes) relancent la lecture à l'endroit choisi, sous-titres compris, et le plein écran garde la barre. Chaque saut relance la conversion : sur une petite machine, compte quelques secondes d'attente, affichées à l'écran.

**Envoyer un média depuis ton téléphone ou ton ordinateur** : toujours dans Odéon, sous les dossiers, la zone « Envoyer des films, séries ou musique depuis cet appareil ». Choisis le dossier d'arrivée parmi ceux que tu as déclarés, puis un ou plusieurs fichiers. Chaque fichier a sa barre ; une coupure ne fait pas tout recommencer. Le fichier reçu est analysé (antivirus, puis sa vraie nature lue dans son contenu) avant d'être rangé, sans jamais écraser un fichier ; un refus dit pourquoi. Toi seul peux envoyer. Un envoi est refusé s'il ne laissait pas un dixième du disque libre, et un envoi abandonné est effacé au bout de deux jours.

**Le demander dans la discussion, puis « Lire »** : écris par exemple « lance-moi Brume », « joue Brume » ou « mets-moi Jardin Noir S02E10 » (ou « à la saison 3 épisode 7 »). Odin cherche le titre dans ta bibliothèque de Vénus, sans modèle de langue, et sa réponse porte un bouton **« Lire »** : un clic ouvre Vénus et démarre le lecteur à l'endroit où tu t'étais arrêté. Rien ne se lance sans ce clic. Cela marche aussi en anglais, en espagnol, en allemand et en japonais. Si un titre porte aussi le nom d'autre chose, Odin te pose la question au lieu de choisir. Une personne qui n'a pas le droit d'ouvrir Vénus n'apprend rien de ta bibliothèque. Le bouton n'existe que dans la discussion de l'application : sur une messagerie (Telegram, Signal, WhatsApp…), par le raccourci du téléphone ou dans une notification, la réponse arrive sans lui.

**Les titres dans toutes les écritures** : un film, une série ou un album dont le titre est écrit en japonais, en arabe, en cyrillique, en grec, en chinois, en coréen, en hindi… a son propre identifiant et se retrouve par son titre ou ses premiers mots, au lieu de se confondre avec les autres sous « sans-titre ». Un titre qui avait déjà son identifiant, en alphabet latin ou mêlé, le garde à l'identique : sa reprise de lecture et ses « vus » ne bougent pas.

**Pas encore là** : YouTube et l'envoi vers une télé existent, mais passent encore par un outil extérieur ; les faire par Odin lui-même est à venir. Les phrases ci-dessous (« mets le dernier épisode… ») passent par un serveur Vénus à part, relié dans les réglages.

### Venus (Vénus) : épisodes et VF

- « Mets le dernier épisode de One Piece sur la télé du salon » : l'épisode lui-même démarre. Aussi « l'épisode suivant de Frieren », « One Piece saison 2 épisode 5 », « S02E05 », « l'épisode 1071 de One Piece » ; une série nommée seule reprend à l'épisode suivant de ton profil.
- **Arrivées** : Odin te prévient quand un épisode ou un film arrive sur Venus (« 📺 Épisode arrivé sur Venus en VF : One Piece S01E1071 »), et quand la VF d'un titre arrive. « Préviens-moi seulement pour la VF » ou « ne me préviens plus » ; « les nouveaux épisodes » pour la liste des derniers jours.
- **Chercher en VF** : « cherche Frieren en VF » demande la version française à Radarr / Sonarr par Venus (Venus 1.x avec Radarr 3+ / Sonarr 4+).

### Cerveau direct et Quotidien

Quand une IA règle une de tes demandes en une action ou quelques-unes à la suite (une « mission »), Odin la retient et la refait ensuite **sans IA** : la même phrase, ou la même avec une autre valeur. Deux façons de dire la même mission ? Il relie les phrases et le mot qui change. Quand aucune IA ne répond, il cherche ce qui ressemble à ta demande, explique comment il a fait le lien et te demande avant d'agir ; après ton oui, ta phrase est retenue. Une action grave s'apprend aussi, mais ton accord est redemandé à chaque fois. Tout est rangé dans **Cerveau → Quotidien** : une note par mission, reliée aux applis (mets-la à la corbeille pour qu'Odin l'oublie).

### Qui peut ouvrir l'interface ?

Au choix, à l'installation, dans **Réglages → Accès à l'interface** ou avec `odin web access` :

| Mode | Qui peut l'ouvrir | Chiffrement |
|---|---|---|
| **lan** (par défaut) | cette machine et les appareils de ton sous-réseau (ex. `192.168.1.0/24`, détecté tout seul, ou ta liste de réseaux) ; les autres adresses sont ignorées | HTTPS (désactivable avec `--http`) |
| **local** | cette machine seulement (`127.0.0.1`) | HTTP (rien ne circule sur le réseau) |
| **wan** | tout Internet (pense à rediriger le port sur ta box, ou à utiliser un tunnel) | HTTPS obligatoire ; ou `--proxy` si Caddy, Nginx ou Cloudflare Tunnel chiffre devant Odin |

Le certificat HTTPS est créé par Odin lui-même (aucun outil à installer) pour `localhost`, l'adresse locale et le nom de la machine. Ton navigateur demandera de l'accepter une fois : compare son empreinte avec celle de Réglages. Tu peux aussi donner ton propre certificat (Let's Encrypt…).

**Première connexion** : le premier navigateur de ton réseau local qui ouvre Odin (tant qu'il n'est pas configuré, ou dans l'heure qui suit son démarrage) crée **ton compte** : prénom, nom, adresse e-mail et mot de passe (10 caractères au moins). Ensuite, sur chaque appareil, tu entres avec ton adresse et ton mot de passe ; Réglages → Accès montre les appareils connectés et permet de les déconnecter. Plus tard, ou depuis un autre endroit, le lien de première connexion s'obtient en ligne de commande : `odin link` (dans un LXC Proxmox, depuis l'hôte : `pct exec <ID> -- odin link`). L'installateur l'affiche aussi à la fin. Mot de passe oublié : `odin compte oublier` sur la machine d'Odin (le compte est effacé, jamais tes données).

**Double facteur** (Réglages → Accès, ton compte seulement) : avec ton mot de passe, « Activer le double facteur » montre un QR code ; tu le scannes avec une appli de codes sur ton téléphone, puis tu tapes un premier code pour confirmer. Ensuite, à chaque connexion, le code à 6 chiffres est demandé en plus du mot de passe. Un code ne sert qu'une fois ; des codes faux font attendre de plus en plus, et Odin te prévient. Téléphone perdu : sur l'écran du code, « J'ai perdu mon téléphone » envoie un lien à l'adresse e-mail du compte ; ce lien et ton mot de passe retirent le double facteur, puis un nouveau QR code t'est proposé. Si aucun envoi d'e-mail n'est réglé, une commande sur la machine d'Odin, Odin arrêté, le retire. Le secret est gardé chiffré.

**Tu viens de la 1.5 ?** À la première ouverture après la mise à jour, Odin te demande seulement de créer ce compte. Tes notes, tes discussions et tes réglages sont gardés.

Dans tous les modes, chaque appel exige ta session (navigateur) ou la clé d'API (programmes : raccourcis du téléphone, serveur MCP), et une adresse qui se trompe 10 fois en 10 minutes est bloquée 15 minutes. La clé d'API **lit et parle seulement** : elle lit l'état d'Odin et lui envoie une phrase (`/api/ask`, `/api/message`) ; tout geste qui écrit (réglages, coffre, comptes, sauvegarde, restauration, exports, actions des applis) et toute réponse à une validation demandent ta session, et la clé reçoit « Ce geste demande ta session : ouvre Odin et connecte-toi. » (le serveur MCP garde son fonctionnement). **Ce que dit la clé n'est pas ta parole** : Odin lui répond (il lit, il explique), mais avant tout geste il te demande ta validation, dans ta session, et la demande dit « Demandé par un programme qui a ta clé d'accès, pas par toi » ; sans ta réponse, rien ne part. Lire un fichier de ta machine ou aller sur Internet pour elle est aussi un geste. Un « oui » tout court ne valide pas sa demande : réponds avec le bouton de la demande (ou « /yes » suivi de son identifiant) ; « non » la refuse. Au plus 3 de ses demandes attendent à la fois, et 12 par heure : au-delà, c'est non, et Odin te prévient. Une phrase comme « réponds par écrit », « je conduis » ou « masque la conversation » ne fait rien quand c'est la clé qui la dit, et un réglage n'est jamais changé pour elle. Cela vaut aussi pour tes raccourcis du téléphone (`/api/ask`) : ce qu'ils demandent de faire attend ton accord dans Odin. Un message envoyé avec la clé par `/api/message` va dans une conversation à part (sa réponse se lit avec `/api/history?peer=cle`), pas dans la tienne. Le mot de passe n'est jamais gardé en clair, et après 5 erreurs chaque nouvel essai doit attendre. **Nouvelle clé d'API** (Réglages, ou `odin web rotate`) : les programmes qui utilisaient l'ancienne doivent être mis à jour.

## Terminal

`odin chat`, puis dans la conversation : `/new` (nouvelle conversation), `/memory mot`, `/skills`, `/drafts`, `/cost`, `/exit`. **Ctrl+C** interrompt Odin. Une seule demande : `odin run "…"`.

## Telegram

1. Crée un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`) et copie son jeton.
2. Dans l'interface web, **Réglages → Telegram** : colle le jeton, coche « Activer », enregistre.
3. Écris à ton bot : il te répond avec ton identifiant. Ajoute-le dans « Tes identifiants Telegram » et enregistre : Odin relance le canal tout seul.

Dans Telegram : `/stop` interrompt, `/new` repart de zéro, `/status` affiche les coûts, `/yes ID` · `/always ID` · `/no ID` répondent aux validations. Un inconnu reçoit un code d'appairage ; tu l'acceptes avec `odin pairing approve telegram CODE`.

## API HTTP

Pour brancher Odin à un raccourci iPhone, à n8n ou à ta propre page :

```bash
# ~/.odin/env : ODIN_HTTP_TOKEN=une-longue-chaine-aleatoire
# config.json  : "http": { "enabled": true, "port": 8889, "tokenEnv": "ODIN_HTTP_TOKEN" }
curl -s http://127.0.0.1:8889/v1/message \
  -H "Authorization: Bearer $ODIN_HTTP_TOKEN" \
  -d '{"peer":"moi","text":"Quelles sont mes tâches planifiées ?"}'
```

## Tâches planifiées

Demande-le simplement (*« tous les lundis à 9 h, fais le point sur mes projets »*) ou :

```bash
odin cron add "30 7 * * 1-5" "Prépare mon brief du matin" telegram TON_ID
odin cron list
```

Les tâches s'exécutent quand `odin web` ou `odin gateway` tourne. Sans personne pour valider, seule la routine passe.

## Mémoire

Odin retient seul ce qui est durable (préférences, faits, projets) et le retrouve quand c'est utile. Il refuse les secrets et l'éphémère. Ce qu'il apprend d'une source non fiable reste en **quarantaine** tant que tu ne l'as pas validé.

Chaque nuit, il **range lui-même sa mémoire** : il améliore ce qui est flou, fusionne les doublons, met à jour ce que la réalité a changé et oublie le périmé. Dans l'interface (Mémoire), les souvenirs sont rangés par thème ; **épingle** ce qui compte (il n'y touchera plus), **modifie** ou **fais-lui oublier** d'un clic. Un rangement s'annule pendant 7 jours.

Tout est rangé **en fichiers** dans `~/.odin/memoire/` (un fichier `.jsonl` par sorte de choses : conversations, souvenirs, tâches, coûts…) : **aucune base de données, jamais de SQLite**. Au démarrage, Odin relit ces fichiers ; chaque changement est écrit tout de suite. Une ancienne mémoire `odin.db` est convertie une seule fois au premier démarrage, puis gardée à part sous le nom `odin.db.ancien-AAAA-MM-JJ`.

**Conversations** : chacune peut être **supprimée** (corbeille 7 jours, annulable, puis effacement réel sur le disque, souvenirs venus d'elle compris si tu le demandes) ou **exportée** en Markdown, JSON ou texte (`/api/conversations/export?peer=…&format=md`, ou `?all=1` pour tout). À l'écrit comme à la voix : « supprime cette conversation » (Odin demande confirmation).

```bash
odin memory              # liste
odin memory search café  # recherche
odin memory vouch 12     # valider un souvenir en quarantaine
odin memory forget 12
```

## Compétences

Après une tâche réussie en plusieurs étapes, Odin propose une **compétence** : une procédure réutilisable, au format `SKILL.md` du standard ouvert agentskills.io. Elle reste un brouillon jusqu'à ce que tu l'approuves.

```bash
odin skills drafts
odin skills diff deploy-site
odin skills approve deploy-site     # ou reject ; rollback pour revenir à la version précédente
```

Tu peux aussi écrire les tiennes dans `~/.odin/skills/<nom>/SKILL.md` (exemple dans `templates/skills/`).

## Réseau local

```bash
odin net enable              # balayage automatique toutes les 30 min
odin net scan --full         # balayage complet maintenant (~30 s)
odin net list                # ● en ligne  ○ déconnecté  × retiré
odin net show 192.0.2.20   # détail, historique, ce qu'Odin peut faire avec
odin net label 192.0.2.20 "Imprimante du bureau"
```

Odin découvre les appareils sans droits administrateur (table ARP, balayage TCP léger, Bonjour, UPnP) et **ne balaie que les réseaux privés de sa machine**, jamais Internet. Absent, un appareil passe « déconnecté », puis « retiré » après 7 jours ; tu es prévenu à chaque changement.

**Adresses MAC** : à chaque balayage, Odin vérifie qu'une même adresse MAC ne répond pas sur deux IP (usurpation possible) et que la box garde la même MAC (interception possible) ; il te prévient aussitôt.

**Odin est administrateur de son poste, partout** : à l'installation, il reçoit les droits administrateur (`ODIN_NO_ADMIN=1` pour refuser).

| Où | Comment il les a |
|---|---|
| Linux, macOS (ton compte) | règle sudo sans mot de passe, vérifiée par visudo (sudo te demande ton mot de passe une fois, à l'installation) |
| Linux installé en root (conteneur LXC, serveur) | service du système lancé en root : rien à régler |
| Docker | le compte `odin` de l'image est administrateur du conteneur (sudo sans mot de passe) |
| Windows | la tâche « Odin » démarre avec les privilèges élevés (une confirmation Windows, une fois) |

`odin admin` dit où en sont les droits, **avec la vraie cause** quand il en manque, et la commande exacte à lancer. `odin admin fix`, lancée une fois par un administrateur, répare une installation existante : elle pose la règle sudo, retire d'un service systemd les réglages qui interdisent de devenir administrateur (`NoNewPrivileges` et ceux qui l'imposent), redémarre le service, et remet tout comme avant s'il ne repart pas. Un service verrouillé ne peut pas se déverrouiller lui-même : c'est pour cela qu'il faut cette commande une fois, depuis un compte administrateur. Dans ce cas, Odin ne réclame pas de mot de passe (il ne servirait à rien) : il donne la commande.

Si sudo demande seulement un mot de passe, dis-lui « le mot de passe admin de ce poste est … » : il le vérifie et devient administrateur pour de bon. Une commande refusée faute de droits est relancée toute seule avec sudo. Heimdall reste juge : les commandes destructrices restent interdites. Pour revenir en arrière : `sudo rm /etc/sudoers.d/odin` (et, pour un service, le fichier `90-odin-administrateur.conf` de son dossier `.service.d`).

**Donner un mot de passe à Odin** : écris-le simplement dans la discussion (« le mot de passe root du 192.168.1.102 est … »). Il est retiré du message avant le modèle (qui ne le voit jamais) et effacé de Telegram. Odin se connecte, installe sa clé SSH et vérifie qu'elle marche, crée un jeton d'API s'il s'agit d'un Proxmox (réglé tout seul), puis change le mot de passe : le nouveau t'arrive en message privé masqué, effacé au bout de 10 minutes, et reste chiffré dans le coffre.

**Bloquer un appareil** : ajoute ta box dans Réglages → Droits et machines (son IP et un compte SSH administrateur). Odin reconnaît OpenWrt, MikroTik et les routeurs Linux, et bloque l'appareil par son adresse MAC (bouton « Bloquer sur la box » sur la fiche de l'appareil, ou « bloque l'iPhone inconnu »). Réversible d'un clic. Les box d'opérateur sans SSH (Livebox, SFR, Bbox, Freebox) se règlent par leur page d'administration, avec le navigateur.

Sur la carte, chaque appareil s'ouvre en page complète : informations, liens, ports ouverts, ce qu'Odin peut faire avec, sécurité et historique.

## Documents et médias

Odin lit et produit les formats du quotidien, sans rien installer :

| Type | Lire | Créer / transformer |
|---|---|---|
| PDF | texte (lecteur intégré, `pdftotext` s'il existe) | PDF A4 paginé à partir de texte simple |
| Word `.docx` | titres, listes, texte | document avec titres, gras, listes |
| Excel `.xlsx` | chaque feuille en tableau | classeur multi-feuilles, formules (`=SUM(B2:B9)`) |
| PowerPoint `.pptx` | texte de chaque diapositive | présentation titre + puces |
| Images | description, lecture du texte (vision du modèle) | conversion, redimensionnement |
| Vidéo, audio | informations ; la transcription attend le modèle d'écoute d'Odin (pas encore entraîné) | format, découpe, extraction du son, miniature (`ffmpeg`) |

Envoie un fichier à Odin sur Telegram ou dépose-le dans `~/.odin/workspace`, puis demande : « résume ce PDF », « fais-en un Excel ». Un fichier venu de l'extérieur est traité comme un contenu non fiable.

**Ce qui est rangé dans un fichier reçu**, Odin le lit seul, sans programme ajouté : la date, l'appareil et le lieu d'une photo ; le titre, l'artiste et l'album d'une musique ; le format, la durée, les pistes et les sous-titres d'une vidéo ; les informations d'un document. Ce qu'il ne peut pas encore comprendre (décrire une image, transcrire la parole), il le dit, avec la raison.

## Voix

**Aujourd'hui, Odin n'écoute pas et ne parle pas encore avec sa propre voix.** Depuis le 17/11, il n'utilise plus aucun modèle de voix qui ne soit pas le sien : ni service en ligne, ni programme d'écoute ou de voix installé sur la machine, ni copie de voix. Comprendre ce que tu dis au micro, transcrire une note vocale, lire une réponse à voix haute et copier une voix répondent « pas encore », dans ta langue, jusqu'à ce que les modèles d'écoute et de voix d'Odin soient entraînés sur ta machine. Rien n'est envoyé dehors. Un programme de ce genre déjà présent sur le disque est ignoré, pas effacé : c'est à toi d'en décider.

- **Réponse en voix ou en texte** : bouton Voix, Réglages → Voix, ou à l'oral (« réponds par écrit », « parle-moi »). En texte seul, Odin écrit sa réponse même quand tu lui parles au micro, et n'envoie plus de note vocale sur Telegram.
- **Réglages** : texte en direct, annulation d'écho, sensibilité du micro, attente en fin de phrase, mot de réveil, maintenir pour parler, mots d'arrêt, « oui / mmh » ignorés, vitesse et volume de la voix, lexique de prononciation, cerveau (« auto » ou « sans IA » pour les demandes à la voix), mode privé (rien n'est retenu ni écrit).
- **Odin, homme ou femme** : un seul réglage pour ses accords (« je suis prêt » ou « je suis prête ») et, plus tard, pour sa voix ; choisi à l'installation, au premier démarrage, dans Réglages → Voix, par `odin genre femme`, ou en le disant (« parle comme un homme ») ; le choix sert dès la phrase suivante. Ce qu'il dira à voix haute est déjà préparé pour sonner naturel : aucun symbole lu, nombres, heures et unités en toutes lettres.
- **Voix copiées autrefois** : Réglages → Voix montre les accords notés ; « Retirer l'accord » fait qu'Odin ne parle plus avec cette voix. Odin n'appelle plus le service qui l'avait copiée : l'y effacer reste ton geste.
- **Conversation en direct** (page d'Orphée) : le service vocal à part n'est plus lancé ; la page le dit et garde l'écrit.
- **Logos pour la voix** : un mot mal entendu qui sonne comme un mot connu est corrigé (« mon nase est plein » → NAS) ; « non, je voulais dire … » le fait retenir (avec tes mots d'Écho).
- **Projet actif** (Mnémosyne) : choisis le dossier d'un projet, Odin répond à son sujet sans IA en citant le fichier et les lignes (les fichiers de secrets ne sont jamais lus).
- **Audio brut** : jamais gardé, sauf si tu coches « Garder l'audio brut » (jamais en mode privé ; effacé au bout du nombre de jours choisi).
- **Dictée sur les PC du parc** : Satellites installe la capsule d'Écho sur un poste Linux ou Mac (« installe la capsule de dictée sur pc-salon ») ; un raccourci clavier lance `python3 ~/.odin-capsule/capsule.py dicter`.
- Cahier des charges complet de la voix : [docs/voix-v2.md](voix-v2.md).

## Modèles : le bon pour chaque tâche

> **Révisé le 19/11 : les agents connectés sont gardés.** Ce qui suit décrit les agents connectés : un service de modèles en ligne dont tu as réglé la clé, ou ta connexion par abonnement. Le retrait décidé le 17/11 s'est arrêté là, par ta décision du 19/11. Ce qui est enregistré : aucune clé n'est effacée, ni la connexion par abonnement, ni la liste des fournisseurs ; un agent que tu as réglé répond encore. Chaque appel est noté : Réglages → Modèle → « Qui a répondu » montre quel agent a répondu, pourquoi lui, et qui a été essayé avant. Un agent n'a jamais la valeur d'un secret du coffre : il écrit une référence, et le serveur met la valeur juste avant l'outil. Une image ne part vers un agent qu'avec ton « oui », pour cette image, une seule fois. Sans aucun agent prêt, Odin répond avec ses seuls moyens (ses actions directes, sa mémoire, Soul) et dit « pas encore » pour le reste, dans ta langue ; il n'est pas « en démonstration » : Soul, les mises à jour et les alertes tournent. Ce qui est retiré le reste : la voix, la traduction, la recherche et l'analyse par un service en ligne, et le second avis d'un modèle dans les décisions (17/11). Le modèle ouvert lu par Métis n'est plus branché pour répondre (19/11) : ce que la suite dit du palier « installé/gratuit » date d'avant. Pas construit : le vérificateur des actions risquées, et l'exception du 18/11 pour la programmation.

**Les agents classés de 1 à 10** (ta décision du 19/11) : quand un classement est écrit dans la configuration (`routing.classement`), Odin prend les agents dans cet ordre ; l'agent local d'Odin est toujours dans la liste, à la place donnée. Un agent qui se tait 30 secondes, ne finit pas en 3 minutes ou refuse passe la main au suivant ; un agent qui a déjà commencé à agir n'est jamais remplacé. Chaque appel est noté avec sa place, sans son contenu. Sans classement, rien ne change. À venir : le classer depuis les Réglages.

Configure plusieurs modèles (Réglages → Modèle) : un par défaut, des secours, et leur palier : **installé/gratuit** (un modèle ouvert lu par Métis, sur la machine), **standard**, **le plus capable**. Odin choisit le moins cher qui suffit : question simple → modèle local, tâche ordinaire → standard, tâche complexe → le plus capable. Quand un modèle arrive **à bout de quota**, il passe au suivant tout seul et te le dit. Pour une **décision risquée**, c'est le juge local d'Odin qui décide, seul (voir « Qui répond aux questions ? »). **Codex** (OpenAI) peut recevoir les tâches de code : `npm install -g @openai/codex`.

**Ton abonnement ChatGPT via Codex** (comme `hermes auth add openai-codex`) : Réglages → Modèle → *OpenAI Codex (abonnement ChatGPT)* → **Se connecter avec un code** : Odin affiche un code, tu le saisis sur la page OpenAI depuis n'importe quel appareil (téléphone compris) et il termine tout seul — plus d'adresse `localhost` à recopier. Il faut activer une fois dans ChatGPT : Réglages → Sécurité → « Device code authorization ». En ligne de commande :

```bash
odin auth add openai-codex   # connexion (lien à ouvrir ; sur un serveur/LXC, recolle l'adresse de retour)
odin model codex gpt-6-luna  # choisir Codex et le modèle de ton abonnement
odin doctor                  # vérifier
```

Odin a **sa propre connexion**, rangée dans `~/.odin/codex-auth.json` (lisible par toi seul) et renouvelée toute seule : elle n'est jamais partagée avec Codex CLI ni Hermes (deux programmes sur la même connexion se déconnecteraient l'un l'autre). Ne colle jamais un jeton dans une discussion : seule l'adresse de retour de la page de connexion est à recopier, et seulement dans Odin.

**Budget mensuel** (Réglages → Modèle) : un plafond en dollars ; tous les appels sont comptés (agent, juges, résumés, observation, vision), la dépense s'affiche par modèle et par usage, et une fois le plafond atteint seuls les modèles gratuits servent, Odin te le dit.

## Il travaille sans pause

Réglages → Autonomie → **Travail continu** : toutes les 30 minutes (réglable), quand personne ne lui parle, Odin reprend les missions coupées par un redémarrage ou échouées (modèle indisponible, étapes épuisées — jusqu'à 3 relances), puis cherche lui-même ce qui t'est utile (problème repéré, appareil hors ligne, demande fréquente, tâche planifiée qui manque) et le fait, en vérifiant chaque résultat. Il respecte un budget par jour (0,50 $ par défaut) ; ce qui demande ta validation attend ton accord. Pour une heure précise, programme une tâche (« chaque jour à 3 h, … »). Chaque matin (7 h), le **rapport du matin** résume sa nuit ; chaque soir, son journal.

## Mémoire qui se tient à jour

Chaque souvenir a un **sujet** (toi, le NAS, une personne…), une **clé** (adresse IP, heure de réveil…), sa source et sa date : un fait plus récent **remplace** l'ancien (gardé dans l'historique), sans jamais écraser ce que TU as dit par une source moins fiable. Les souvenirs périmés s'effacent tout seuls. **Fiches** : tout ce qu'Odin sait d'un sujet (`memory_profile`). **Recherche par le sens** par Soul, le réseau d'Odin, dès qu'il a appris (en cours : jusque-là, la recherche par mots prend le relais) : il retrouve « le serveur de fichiers » même si le souvenir parle du « NAS ».

## Rapide

Réponses **en direct**, mot à mot (Anthropic, compatibles OpenAI, Codex). Les outils de lecture et de consultation (web, mail…) partent **en parallèle**. L'état du réseau est **préparé à l'avance** dans son contexte : les questions simples n'ont pas besoin d'outil.

## Tout est vérifié

- Après une modification (fichier, commande, envoi), Odin **doit** vérifier le résultat réel avec un outil avant de dire « c'est fait » — c'est imposé par le code, pas seulement demandé.
- Chaque fait important porte son niveau de certitude : ✓ vérifié, ~ non vérifié, ? incertain.
- Les **sources** réellement lues sont ajoutées si la réponse les oublie.
- Les réponses à enjeu (actions sur tes machines, faits du web) sont **relues par un second modèle** qui compare la réponse aux résultats réels des outils ; tout écart est signalé « ⚠ À vérifier ».

## Accueil : tout d'un coup d'œil

Le premier écran s'appelle **Accueil** partout. Le menu suit l'ordre de la maquette validée : Accueil, Home Assistant, Applis, Discussion, Cerveau, Thèmes (raccourci vers Réglages → Apparence), Maison (le réseau), « Plus », Réglages. **Home Assistant** ouvre l'écran de la maison (Hestia) dans la page d'Odin (adresse `/#maison`), le menu d'Odin à côté ; toi seul vois cette entrée, et seulement quand Hestia est là. Les tablettes murales ne changent pas.

La maquette validée de l'accueil et de l'écran de la maison se construit livraison par livraison : **48 sur 80** sont enregistrées (voir [l'état](etat.json)). Deux ne seront pas construites, d'après tes réponses du 25/11 : la page « Énergie » (ses widgets suffisent) et « créer ou modifier une scène depuis l'écran de la maison » (cela se fait dans Odin).

**Ce que tu vois** :

- **Le bandeau du haut** : le salut selon l'heure, la date et la phrase du jour, la recherche (Ctrl K), le plein écran, « Vérifier », et une cloche avec le vrai nombre de validations en attente et de problèmes graves ; elle ouvre « À faire ». Rouge seulement pour un grave.
- **La page « Aujourd'hui »**, en widgets : les cinq chiffres en tête (appareils, missions, risques, dépenses, mode d'Odin), « Tu veux sans doute », « À faire », « Ce qu'Odin a fait », « Comment Odin se comporte », et les quatre tuiles Surveillance, Sauvegarde, Résumé du matin et Application. Ils gardent leurs boutons d'avant. Chez toi, tout l'accueil est une grille de widgets. À l'ouverture d'Odin, une validation en attente affiche cette page. « À faire » ne se retire jamais ; les autres se retirent et se reposent par « Ajouter un widget ».
- **La grille** : 12 colonnes (4 au téléphone, à 700 px et moins). Chaque widget a le même en-tête (tuile de l'appli, titre, « ⋯ ») et dit son état : une donnée ancienne porte « il y a 12 min », une liste vide le dit, une appli qui ne répond pas propose « Réessayer », une appli désactivée « Activer ».
- **Au téléphone, la barre du bas** : Accueil, Home Assistant, Odin au centre, Discussion, Plus (pour un membre, ou sans Hestia, Applis prend la deuxième place). Le rond du centre ouvre « Parler à Odin ». Quand Odin n'a plus de place libre à l'écran, il rentre dans son **nid** et en ressort dès qu'une place se libère ; jamais deux Odin à l'écran.

**Ce que tu peux faire** (mode **Modifier**) :

- **Glisser** un widget : à la souris par son en-tête, au doigt par un appui long. Hors du mode Modifier, le déplacement est gardé au lâcher avec « Annuler » quelques secondes ; en mode Modifier, rien n'est gardé avant « Terminé ». Échap remet tout.
- **Agrandir** : tirer le coin, case par case, ou choisir l'une des sept tailles (Petit 2×1, Moyen 3×2, Large 4×2, Haut 3×4, Grand 4×4, Très grand 6×4, Bandeau 12×2) ; Maj + flèches au clavier. Au téléphone, le coin règle la taille propre au téléphone.
- **Ajouter un widget** : un tiroir à droite, avec une recherche et les familles, rempli par le vrai catalogue d'Odin. Une appli désactivée y est grisée et n'est jamais posée.
- **« ⋯ » → Régler** : titre, ce qu'il montre, taille, « Quand je touche le widget » (ouvrir l'appli, lancer une de ses actions, aller à un écran, ouvrir une adresse web, rien), « Ouvrir à… », « Copier vers l'autre écran », « Retirer ». Une action grave lancée au toucher demande ton accord à chaque fois.
- **Animations** : douze façons de voir les widgets bouger, dans Réglages → Apparence ; « moins d'animations » fige tout.
- **Montrer cette page sur l'écran de la maison**, la page « Aujourd'hui » aussi (son bouton « Écran de la maison ») : seuls les widgets ordinaires que tu y as posés y vont, comme pour une autre page. Les widgets propres à « Aujourd'hui » n'y vont jamais, et une tablette ne reçoit pas le nom « Aujourd'hui » de la page.
- **Plein écran « seulement les widgets »** (bouton du bandeau), pour un écran au mur : on sort par Échap ou par le ✕ en haut à droite.

**Qui voit quoi** : c'est le serveur qui décide, widget par widget. Un membre de la famille ne reçoit que les widgets des applis sur lesquelles il a un droit ; un widget d'une appli de la vie privée reste fermé (« Vie privée : à ouvrir par le propriétaire. ») sauf si tu l'ouvres à cette personne par « Ouvrir à… » (noté dans « qui a fait quoi » ; cela ne lui donne aucun droit sur l'appli). Une tablette « maison » ne reçoit que l'heure, la météo, les sites et les infos des applis qui ne sont pas privées. Les widgets de la page « Aujourd'hui » restent à toi seul : jamais à un membre, une tablette, l'écran de la maison ou la clé d'accès. Un membre garde son accueil d'avant.

**Les widgets à poser** (« Ajouter un widget ») :

- **Infos** : l'heure, la météo et le nombre d'alertes pas encore vues, en petits chiffres (une icône, la valeur, son nom) ; et l'horloge (l'heure en grand, la date, la semaine), un style de « Heure et lieu ». L'heure suit le fuseau et le format d'Odin, jamais ceux de l'appareil. Sans lieu choisi, rien n'est affirmé ; une météo ancienne est dite ancienne. Le nombre d'alertes est pour toi : un membre ne le voit que si tu lui ouvres ce widget, et une tablette « maison » ne le reçoit jamais.
- **La grande météo** : « Régler » propose quatre styles — Simple, Complète, Compacte, Scène — avec la vraie météo du lieu d'Odin (maintenant, les 7 jours, heure par heure sur 24 heures, le lever et le coucher). Un widget neuf est posé en « Complète » ; un widget déjà posé garde son aspect tant que tu ne changes pas son style. Rien n'est montré sans source (ni marée, ni UV).
- **Alertes et erreurs** : tes alertes, les plus récentes d'abord, avec leur appli, leur gravité et leur âge ; « Vu » en retire une. Aucune alerte : un état calme.
- **Sites web** : les sites que surveille Arachné, les pannes d'abord, le temps de réponse, depuis quand un site ne répond plus. « Vérifier », « Essayer » et « Relancer » passent par Arachné, avec sa confirmation, et ne vont qu'à toi. Et un petit chiffre : combien de sites répondent, sur combien.
- **Agenda** (toi seul) : tes prochains rendez-vous de Chronos, le plus proche d'abord, à l'heure d'Odin. Aucun rendez-vous : le widget le dit et ouvre Chronos.
- **Recherche** (toi seul) : le champ « Pose ta question… » et « Chercher », puis tes dernières recherches de Pythie quand le widget est assez haut. Ta question n'apparaît dans aucune adresse ni dans l'historique du navigateur.
- **Sauvegardes** (toi seul, en lecture) : la dernière sauvegarde réussie de Phénix et son âge, la prochaine, ce qui a échoué ou pris du retard. La coche verte n'apparaît que si chaque sauvegarde réglée a réussi au moins une fois, sans échec ni retard.
- **Pubs bloquées** (toi seul, en lecture) : ce que Sphinx a bloqué aujourd'hui, sur combien de demandes, en comptes seulement (aucun nom de site, aucun appareil). Sphinx arrêté : le widget le dit, sans afficher de zéro.

Un membre ne voit la liste des alertes que si tu la lui ouvres, et ne voit les sites que s'il a un droit sur Arachné. « Agenda », « Recherche », « Sauvegardes » et « Pubs bloquées » sont refusés par le serveur à un membre (même avec le droit sur l'appli), à une tablette « maison » et à la clé d'accès.

**Le verre** : sur l'accueil seulement, le décor du thème passe derrière les cartes, qui deviennent du verre (flou, reflet, bord). Chaque thème a son opacité, calculée pour que tout texte reste lisible (4,5 pour 1 au moins). Partout ailleurs, le fond reste uni. Si le navigateur ne sait pas flouter, la carte garde sa couleur pleine. Le curseur « Transparence du verre » et le fond qui vit se règlent dans Réglages → Apparence (plus bas).

**Pas encore là** : en cours, pas enregistré : le widget de n'importe quelle appli, les widgets « Raccourcis » et « Automatisations », « Mettre en widget » depuis la fiche d'une appli. À venir : les autres widgets de la maquette (santé de la machine, stockage, réseau, la maison, Vénus, musique et messages), les styles « Liste » et « Pastilles » de « Sites web », et ces widgets en d'autres langues que le français.

### L'écran de la maison (Home Assistant)

Ce que tu ouvres par l'entrée **Home Assistant** du menu (ou sur une tablette au mur).

- **Les thèmes** : la page « Thèmes » montre les quatre mêmes familles que Réglages → Apparence (« Mis en avant », « Les thèmes d'Odin », « Thèmes de Hestia », « Événements de l'année »), sous les mêmes noms. Le thème choisi ici ne change pas celui d'Odin, et l'inverse. « Valhalla (classique) » n'y est pas proposé (il reste dans Réglages).
- **La barre de côté** : le titre « Home Assistant », les sections avec leurs mots (Accueil, Famille, Caméras, Réseau, Mes applis, Boutons, Thèmes ; trois pour une tablette « maison »), « Revenir à Odin » et « Odin veille ». Une entrée n'apparaît que lorsque sa page existe. **La punaise** : détachée au départ, la barre se cache seule et revient par le bord gauche ou par le bouton « Ouvrir le menu » ; épinglée, elle reste ouverte. Le choix est gardé sur l'appareil. Échap, un choix ou un appui ailleurs la referment.
- **Le bandeau** : le salut, la date et la semaine à l'heure d'Odin, puis seulement ce qui est vrai : la température et le lieu quand la météo est fraîche, le nombre de personnes à la maison quand il y en a. Une valeur absente n'est pas affichée (ni case, ni zéro). La cloche garde le vrai nombre d'alertes. Ton prénom est dans une pastille ronde à son initiale.
- **Les onglets de pièces** : « Tout », puis tes vraies pièces ; ils filtrent ce qui est montré. Aucune pièce : pas d'onglets. Ils se prennent aussi au clavier (flèches, Début, Fin).
- **Au téléphone** : la barre du bas a Accueil, Mes applis, Odin au centre, Thèmes et Plus. « Plus » ouvre le reste (Famille, Caméras, Réseau, Boutons) et « Revenir à Odin ». Le rond du centre sert à parler à Odin. Une tablette « maison » ou un membre garde ses trois sections et Odin, sans « Plus ».
- **Le plein écran** : un bouton cache le menu, le bandeau et les onglets ; on en sort par le même bouton ou par Échap.

**Pas encore là** : en cours, pas enregistré : la grille des widgets sur cet écran (son modèle), le verre et le fond qui vit sur cet écran, les relevés gardés des prises et des capteurs. À venir : les widgets de la maison (appareils, lumières, capteurs, scènes, sécurité, caméra, présence), la fenêtre d'une pièce, lancer une scène, les automatisations, les réglages fins sans box, les courbes, la maison 3D ; la date et les mots de cet écran dans la langue d'Odin ; la grande météo sur cet écran ; quand cet écran est ouvert dans Odin, la barre du bas d'Odin reste visible en plein écran.

## Surveillance (Pulsar)

Marque tes appareils importants avec ★ dans Réseau : Odin te prévient (Telegram ou interface) quand l'un tombe, puis quand il revient. Il surveille aussi les disques de sa machine (alerte à 90 % par défaut) et les certificats HTTPS des appareils (14 jours avant expiration). Une alerte n'est envoyée qu'une fois (rappel après 24 h si elle dure). Réglages → Surveillance.

## Sécurité du réseau

Onglet Réseau → Sécurité : Telnet ou Docker ouverts sans protection, bureau à distance, VNC, FTP, MQTT, Redis exposés, interfaces d'administration non chiffrées, appareils inconnus récents — chacun avec un conseil, et un bouton pour demander à Odin de corriger (avec ta validation). Odin observe, il n'attaque rien. Outil `net_security`.

**Ouvrir un port du pare-feu (Cerbère → Ouvrir un port)** : quand tu le demandes, à la page ou en lui parlant, Odin te demande ta validation. La demande dit le port, le protocole (TCP ou UDP), pour quoi, et surtout si l'ouverture reste sur la machine d'Odin ou s'ouvre aussi sur la box, donc **depuis Internet**. Une automatisation ne peut pas ouvrir un port. Une appli qui appelle Cerbère d'elle-même ne peut pas non plus en ouvrir un tant que tu n'as pas validé l'action de départ : c'est refusé, et tu es prévenu. Fermer un port reste toujours possible sans toi. La même règle vaut pour ce qui publie quelque chose sur Internet : le tunnel, le portail de Persona, un partage, une page publique.

## Antivirus (Asclépios)

Odin a son propre antivirus, fait maison : fichiers, archives, téléchargements, clés USB, sites web, liens et messages. Il se met à jour tout seul depuis des sources publiques (paquets signés, testés avant d'être activés, annulables), met en quarantaine ce qui est sûr (réversible : « garde » ou « annule ») et te laisse décider pour le reste. Il relie les signaux de toutes les applis (pièges, processus, connexions, pare-feu, fichiers système, caméras) pour reconnaître une attaque, et note chaque incident dans le Cerveau. Aucun antivirus ne détecte tout, celui-ci non plus. Procédure d'utilisation et mode de fonctionnement : [`docs/antivirus-ullr.md`](antivirus-ullr.md).

Dis par exemple : « analyse mes téléchargements », « vérifie le lien https://… », « y a-t-il un virus sur ma machine ? », « les incidents ». Tout cela marche sans IA connectée.

Deux façons de faire vérifier un fichier qui n'est pas sur la machine d'Odin :

- **Un fichier de ton téléphone ou de ton ordinateur** : dans Asclépios, onglet « Analyser », dépose-le dans la carte « Un fichier de cet appareil » (ou choisis-le). Il est envoyé à Odin, analysé, puis sa copie est effacée.
- **Le fichier d'un lien, avant de le télécharger** : la carte « Le fichier d'un lien » (ou « analyse le fichier du lien https://… »). Odin le prend dans sa mémoire, l'analyse et te dit s'il est sûr ; rien n'est gardé sur le disque. Une adresse connue comme dangereuse n'est même pas téléchargée.

## Antivirus sur un autre poste (Windows, Mac, Linux, NAS)

Asclépios analyse aussi les autres machines, **sans rien y installer** : il lit leurs fichiers à distance et les analyse chez lui, en mémoire. Rien n'est écrit sur le disque d'Odin, rien n'est modifié sur le poste, rien ne sort de chez toi.

- **PC et serveurs Windows, NAS** : par le partage de fichiers (SMB). Avec un compte administrateur, Odin lit les disques entiers (`C$`, `D$`…) ; sinon, les dossiers partagés.
- **Linux et Mac** : par SSH (`find` + `tar` lancés sur le poste, en lecture seule).

En haut d'Asclépios, « Sur quel poste ? » → « Ajouter un poste ». Trois étapes :

1. **Quel poste ?** Les ordinateurs, serveurs et NAS vus sur ton réseau sont proposés ; sinon, tape son adresse.
2. **Son compte administrateur**, puis « Tester la connexion » : Odin dit ce qu'il peut lire. Le poste n'entre dans le coffre des machines que si l'essai réussit, et le mot de passe n'est jamais réaffiché.
3. **Quoi analyser ?** Analyse rapide, tout le poste, ou un seul dossier.

Le poste reste ensuite proposé dans « Sur quel poste ? » : un clic, et la page montre ses analyses, ses détections et sa quarantaine. Ou en parlant : « analyse le PC 192.0.2.20 ».

Une menace trouvée n'est **jamais** touchée sans ton accord : « Isoler sur le poste » renomme le fichier là-bas (`.odin-quarantaine`) pour qu'il ne puisse plus être lancé, et « Remettre en place » l'annule.

À préparer sur le poste visé :

- **Windows** : « Partage de fichiers et d'imprimantes » activé sur le réseau privé. Windows bloque par défaut les comptes administrateurs *locaux* à distance (sauf le compte « Administrateur ») : une fois, dans une invite de commandes en administrateur, `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f`. Sans cela, Odin le dit et lit seulement les dossiers partagés.
- **Mac** : Réglages → Général → Partage → « Session à distance » (SSH).
- **Linux** : le serveur SSH (`openssh-server`).
- **Machine d'Odin** : les paquets `smbclient` (Windows) et `openssh-client` (déjà dans l'image Docker).

Limites dites clairement : les fichiers ouverts ou verrouillés par le poste ne sont pas lus (ils sont comptés), les très gros fichiers qui ne sont pas des programmes non plus, et aucun antivirus ne détecte tout.

Les applis qui lisent la machine acceptent aussi un autre poste Linux ou Mac (par SSH) : Hygie (état, processus), Pyramide (disques), Thermopyles (pare-feu, ports), Chroniques (journaux), Némésis (programmes suspects ; arrêter un programme là-bas demande ton accord). Elles ont le même « Sur quel poste ? » en haut de leur page ; sur un autre poste, seules les actions qui savent y aller sont proposées. Exemples : « état des disques sur serveur-web », « processus suspects sur serveur-web ».

## Conversion de fichiers (Alchimie)

Alchimie convertit tes fichiers sur ta machine : vidéo, son, image, documents, PDF (avec les outils libres installés : ffmpeg, LibreOffice, pandoc, qpdf…). Et **sans aucun outil à installer**, elle convertit elle-même :

- sous-titres : SRT, WebVTT, ASS/SSA, LRC, SAMI, TTML ;
- données : JSON, JSON Lines, CSV, TSV, XML, YAML, TOML, Excel (`.xlsx`) ;
- contacts (vCard) et agenda (iCalendar) ↔ tableau ; cartes : GeoJSON, KML, GPX ; archives : ZIP, TAR, TAR.GZ.

(Ces conversions reprennent les idées du projet libre Filee, réécrites dans Odin.)

Trois façons de lui donner un fichier :

- **depuis ton appareil** (ordinateur ou téléphone) : dans l'onglet « Convertir », dépose-le (ou choisis-le). Alchimie ne propose que les formats possibles pour ce fichier, rangés par genre, et la qualité quand elle compte. Le résultat se reprend par « Télécharger » ; les derniers résultats restent listés dessous ;
- **depuis un lien** : colle-le sous la zone de dépôt. Le fichier est téléchargé, **vérifié par l'antivirus**, puis converti. Un fichier dangereux part en quarantaine et n'est jamais converti ;
- **un dossier surveillé** : « Surveiller un dossier » — tout fichier qui y arrive est converti tout seul (résultats dans son sous-dossier `convertis`, les originaux restent).

Un lien vers une adresse de ta maison (NAS, autre poste : `http://192.168…`) demande ton accord ; un lien ne peut jamais viser la machine d'Odin elle-même, et une redirection vers ton réseau est refusée. Si le lien demande un identifiant et un mot de passe, mets-les dans leurs cases (masqués, jamais gardés), pas dans le lien.

## Le port d'une appli

Odin écoute sur le port **8888**. Chaque appli a en plus **son port**, facile à retenir : `81xx` Sécurité, `82xx` Accès et réseau, `83xx` Machines, `84xx` Données, `85xx` Maison et médias (par exemple Cerbère 8103, Sphinx 8207, Hydre 8307, Vénus 8512). `http://adresse-d-odin:<port>` ouvre directement sa page, **toujours avec ta connexion** : e-mail et mot de passe, ou QR code ; sans droit sur l'appli, retour à l'écran de connexion d'Odin. Le plan complet est dans [docs/plan-ports.md](plan-ports.md).

Par défaut, le port d'une appli écoute là où écoute Odin. Tu le changes dans la carte « Son port » de la page de l'appli ou dans Réglages → Ports ; un champ vide propose son port par défaut, ou un port libre de sa famille. « Retirer » est gardé après un redémarrage, et « Remettre » rend le port par défaut. Ouvrir le pare-feu demande ton accord : Cerbère s'en charge, et retire la règle quand tu fermes. Un port déjà pris est refusé en disant quel programme le tient. Les ports imposés par un protocole ne changent pas (DNS 53, DHCP 67, MQTT 1883, WireGuard 51820, Venus 8096…), et les applis installées gardent un port fixe entre 20000 et 20999. Pour couper les ports par défaut : `"web": { "portsParAppli": false }` dans `config.json`.

## Exporter et partager une page

En haut de chaque appli, « Exporter / partager » : la page entière ou l'onglet ouvert, pour le poste choisi, en **Word, PDF, Markdown ou JSON**. Les mots de passe, clés et jetons sont masqués, et le fichier dit combien de valeurs l'ont été. « Partager » crée un lien vers une copie figée, en lecture seule : **privé** (toi, ou des personnes de Persona) ou **public** (avec ton accord), avec une date de fin (7 jours par défaut, 90 au plus), les ouvertures comptées, et un retrait immédiat. Le coffre, Persona, la vie privée et les trajets ne s'exportent ni ne se partagent. Google Docs : exporte en Word puis importe-le (Odin n'est pas relié à Google).

## Vie privée (Gygès)

Où tu apparais sur Internet : moteurs, annuaires, revendeurs de données, réseaux sociaux, fuites connues (Have I Been Pwned avec ta clé), photos qui révèlent un lieu. Pour chaque résultat : ce qu'il montre, le risque, et comment le faire retirer, avec les lettres RGPD prêtes (effacement, opposition, accès, relance, en texte, Word et PDF) et le suivi des demandes jusqu'à la CNIL. Revérification chaque mois. Seulement toi, tes sociétés, et un proche qui a donné son accord (noté) ; aucune connexion ni captcha contourné ; rien ne part vers une IA.

## Trajets (Ulysse)

L'historique des positions des téléphones de la famille (OwnTracks), **éteint au départ** : chaque membre l'allume, le met en pause ou l'efface sur sa page `/trajets`. Trajets et arrêts par jour (distance, durée, vitesse), lieux nommés, carte dessinée par Odin, export GPX, conservation 30 jours, 90 jours ou 1 an. Tu ne vois les trajets d'un membre que s'il l'accepte.

## Disques (Tirésias)

Chaque disque (HDD, SSD, NVMe, USB) avec son état en clair : **Bon, Attention ou Mauvais**, et la raison. Toutes les valeurs SMART sont expliquées (température, heures, allumages, secteurs réalloués, usure du SSD). Un relevé par jour, des courbes, une alerte quand ça se dégrade, avec quoi faire : sauvegarder d'abord (Phénix), remplacer ensuite. Test de vitesse façon CrystalDiskMark (séquentiel et aléatoire 4 Ko), **dans un fichier de test seulement**, effacé à la fin. Un autre poste Linux ou Mac se lit par SSH (`smartctl` lancé là-bas). Il faut `smartmontools` sur la machine (bouton « Installer smartctl »).

## La page d'une appli

Toutes les applis ont la même page :

- **en haut** : le retour aux applis, l'icône, le nom et une ligne d'explication. « En savoir plus » déplie l'histoire du nom et la liste des fonctions ;
- **sa propre page d'abord** : quand une appli a sa propre page (Vénus, par exemple), elle s'affiche juste sous l'en-tête ; les chiffres et les boutons génériques passent après elle, et la présentation reste repliée dans l'en-tête. Une appli sans page propre garde la présentation ci-dessous ;
- **« Sur quel poste ? »**, pour les applis qui savent travailler sur un autre poste (Asclépios, Hygie, Pyramide, Thermopyles, Chroniques, Némésis) : des pastilles sur ordinateur, une liste sur téléphone ;
- **des onglets** quand l'appli fait beaucoup de choses (quatre au plus, toujours sur une seule ligne) : Asclépios a « Analyser », « Résultats », « Règles », « Réglages » ; Alchimie a « Convertir », « PDF », « Automatique », « Outils ». Le premier onglet contient ce qu'on vient faire le plus souvent ; « Autres actions », les alertes et les liens avec les autres applis sont dans le dernier.

Le résultat d'une action reste affiché (sous le formulaire, sous la barre de boutons ou sous le titre du tableau) jusqu'à l'action suivante, ou jusqu'au bouton « Fermer ». Quand l'action a fabriqué des fichiers, un bouton « Télécharger » par fichier les remet à ton appareil.

Champollion (lire une photo, un PDF, un document) et Orphée (un vocal ; sa transcription attend le modèle d'écoute d'Odin) acceptent eux aussi un fichier envoyé depuis ton appareil.

## Sites web (Arachné)

Odin surveille tes sites et s'en occupe, **sans IA** : il répond ou non, son temps de réponse, son certificat,
sa page d'accueil ; et, si tu donnes les accès, tout ce qui se passe sur GitHub (envois de code, tests,
demandes de fusion), Vercel (déploiements) et Cloudflare (DNS, protection). Tu demandes les événements que tu
veux : « les erreurs du site monsite depuis 2 jours ». Il essaie le site, le relance, le déploie, revient en
arrière, applique les mises à jour dont les tests passent. Ce qui touche la production attend toujours ton
accord. Avec une IA, il fait évoluer le code sur une branche `odin/…`, avec une demande de fusion que tu
relis. Les jetons restent dans le coffre.

Mode d'emploi, garde-fous et limites : [docs/sites-idunn.md](sites-idunn.md).

## Carte du réseau

Onglet Réseau → Carte : la box au centre, les appareils autour, par catégorie ; touche un appareil pour voir sa fiche.

## Proxmox

Réglages → Proxmox : adresse (https://IP:8006) et jeton d'API (Datacenter → Permissions → API Tokens). Odin liste les nœuds, machines virtuelles et conteneurs LXC, et peut les démarrer, les arrêter proprement, les redémarrer ou en faire un instantané (outils `proxmox_list`, `proxmox_action` ; chaque action est validée selon ton autonomie). Onglet Réseau → Proxmox.

## Activer ou désactiver une appli

Sur la page Applis, chaque carte a l'épingle en haut à gauche et un bouton marche/arrêt en haut à droite ; sur la page d'une appli, « Désactiver » (avec confirmation) ou un bandeau « Activer ». Une appli désactivée devient grise mais reste visible : elle ne démarre plus, n'envoie plus rien, ses tâches et automatisations s'arrêtent, et ses actions sont refusées (Odin dit où l'activer). Ses données sont gardées ; tout revient à la réactivation. Seule une alerte de sécurité critique passe encore. Toi seul, depuis ta session. Une installation neuve démarre avec tout désactivé sauf les dix indispensables, l'antivirus et les sauvegardes ; une installation existante garde tout actif.

## Genèse : clés USB, systèmes, déploiement par le réseau

Tout ce qui suit est **réservé au propriétaire**. Ce qui efface un disque demande toujours une phrase tapée (vérifiée par Odin) **et** un appui long de 3 secondes. Tout a été essayé sur des disques, des PC et des réseaux simulés : pas encore sur du vrai matériel.

**Clés USB** (quatre onglets : Déployer, Mes clés, Démarrage, Par la parole) :

1. **Quelle clé ou quel disque ?** Clés, disques externes, SSD et cartes mémoire, avec leur taille et leur numéro de série. Un garde-fou rouge dit que le disque choisi sera entièrement effacé. Les disques internes, celui du système et celui d'Odin sont verrouillés.
2. **Comment la clé démarre ?** Plusieurs ISO (conseillé), systèmes installés, ou les deux. Puis **Systèmes et ISO**, avec une barre de place : « Continuer » reste éteint tant que ça ne tient pas.
3. **Logiciels et scripts** : un onglet par système, le script d'installation créé en direct, tes propres scripts vérifiés (un script qui efface un disque, coupe l'antivirus ou se cache est refusé avec sa raison). **Options Windows** : aucun mot de passe écrit sur la clé.
4. **Vérifier**, puis écrire : huit étapes nommées ; « Annuler » dit si la clé est déjà touchée. Odin revérifie le disque avant chaque fichier.

**Mes clés** : les clés ODIN connues, leur contenu, l'ordre du menu, l'entrée par défaut, ajouter ou retirer un système sans effacer la clé. Un changement s'applique tout de suite, ou au prochain branchement si tu l'as accordé (valable 24 heures). Retirer un système demande ton accord, avec une phrase qui nomme la clé et ce qui part. **Démarrage** : l'écran graphique (Odin arrive, puis le menu) ou le mode texte, et le délai. Sans choix, la clé démarre le système par défaut ou le disque du PC, jamais un installateur tout seul. **Pour l'instant, seule une clé déjà ODIN est écrite** : une clé neuve est refusée avant toute écriture (à venir, avec une vraie clé d'essai).

**Systèmes** (onglet ouvert d'emblée) : une carte par ISO avec son vrai état (empreinte vérifiée, antivirus, téléchargement en cours, mise à jour). « Ajouter un système » ouvre le catalogue par familles et versions ; un téléchargement ne vient que du site officiel, en https. « Détail » ouvre la fiche et « Où il sert » ; « Retirer » est refusé tant qu'un déploiement, une installation ou une machine s'en sert, puis demande le nom tapé. **Logiciels** : un sous-onglet par système et des profils de logiciels communs à la clé, au réseau et aux machines virtuelles.

**Déployer** : vers une clé, un ou plusieurs PC par le réseau, ou une machine virtuelle. Les PC vus au démarrage réseau apparaissent en direct. Avant d'effacer, le PC qui démarre doit être **exactement** celui autorisé (adresse, numéro de série, carte mère) ; sinon rien n'est effacé et tu es prévenu. Si deux appareils ont donné la même adresse, Odin demande « Quel est le bon PC ? ». Un PC déjà déployé n'est jamais effacé une seconde fois. Le **suivi** montre chaque PC en six étapes ; « Annuler » dit franchement l'état du disque.

**Réseau** : le serveur de démarrage, de trois façons : « À côté de la box » (conseillé : la box garde les adresses), « Odin distribue » (seulement sur une carte câblée d'un réseau à part ; Odin refuse s'il voit un autre serveur d'adresses et revérifie chaque minute), ou « Ta box s'en charge » (les lignes à copier dans la box). Le **menu PXE** règle l'ordre, les systèmes cachés, l'entrée par défaut et le délai ; une entrée qui installe n'est jamais celle par défaut.

**Par la parole** : « mets Windows 11 sur la clé », « ajoute Ubuntu à ma clé », « installe Ubuntu sur les PC qui viennent de démarrer », « télécharge la dernière Debian », « crée-moi une VM Ubuntu avec 4 Go », « où en est le travail » (français, anglais, espagnol, allemand). La parole prépare et ouvre « Vérifier » ; elle n'efface jamais un PC et n'écrit jamais une clé : la phrase et l'appui restent à faire à la main.

## Arche : les conteneurs

Les conteneurs s'appellent **Arche** (avant « Argo ») ; la sauvegarde des bases s'appelle **Amphore** (avant « Arche »). Rien n'est perdu au changement de nom. Tout est **réservé au propriétaire** ; sous Windows, la page dit ce qui viendra. Essayé sur un moteur simulé.

- **Tableau de bord** : ce qui tourne, processeur, mémoire, disque, arrêtés. **La fiche d'un conteneur** : journal en direct (secrets masqués), terminal une commande à la fois avec confirmation, redémarrer, arrêter, ressources. Supprimer garde les données par défaut ; les effacer demande le nom tapé.
- **Volumes et réseaux** : des volumes nommés, sauvegardés chaque nuit par Phénix, qui restent quand on supprime un conteneur ; des réseaux à part, isolés.
- **Piles** : plusieurs conteneurs décrits dans un fichier. Odin montre ce qu'il a compris, puis déploie. Une ligne refusée (droits de la machine, dossier personnel, données d'Odin, port déjà pris…) et rien n'est déployé.
- **Catalogue** : dix applis courantes à installer en un geste, chacune sur une version précise ; la confirmation dit ce qui part et qui pourra ouvrir l'appli.
- **Mises à jour** : jamais toutes seules. Odin propose, tu décides, sur une version précise. Les volumes sont copiés avant ; si la nouvelle version ne tient pas 30 secondes, Odin revient tout seul à l'ancienne.
- **Par la parole** : « lance le serveur de jeux », « arrête wiki », « déploie une galerie de photos », « où en est wiki », « mets à jour wiki », « combien prennent mes conteneurs ». Si le nom dit est ambigu, Odin demande lequel et rien ne part. Une commande tapée dans la Discussion (« stop wiki »…) demande la même confirmation que la fiche.

## Hydre : les machines virtuelles

Tout est **réservé au propriétaire**, et chaque geste est noté dans « qui a fait quoi ». Rien n'a encore été essayé sur une vraie machine virtuelle (les essais simulent les outils de la machine).

- **La liste** : chaque machine avec son état (allumée, en pause, éteinte, en erreur) et ce qui en dépend. « Supprimer » : seulement une machine éteinte, nom écrit, refusé tant que quelque chose en dépend ; tu choisis de garder ou d'effacer son disque.
- **Pause et reprise** (sur ce PC sous Linux et sur les serveurs reliés) : la pause demande confirmation. Sous Windows, c'est refusé avec la raison.
- **Créer une machine**, en quatre étapes (système, machine, réseau, vérifier). Seuls les systèmes vérifiés se choisissent. Odin calcule ce que ce PC peut donner et refuse en donnant les chiffres ; au-delà d'un seuil, il demande ton accord. Pour Ubuntu et Debian, l'installation se fait toute seule ; le mot de passe va au coffre.
- **L'écran** d'une machine allumée ou en pause, dans le navigateur : clavier, souris, plein écran, Ctrl+Alt+Suppr ; au téléphone, une barre de touches (elle suppose une machine en clavier américain, c'est dit à l'écran). Quatre écrans ouverts au plus ; l'image n'est jamais gardée.
- **Les instantanés** : la liste en frise, « Prendre un instantané », « Revenir ici » (Odin prend d'abord un instantané de maintenant), la corbeille. L'interrupteur « Avant chaque mise à jour du système » : un instantané tout seul, gardé 7 jours. Odin en prend aussi un avant une sauvegarde de Phénix qui lit la machine. Un instantané pris à la main n'est jamais retiré tout seul. Sans assez de place, rien n'est pris.
- **Cloner et exporter** (un onglet de la machine) : cloner une machine éteinte en **copie complète** (son propre disque, un autre nom, une autre adresse) ou, depuis un modèle seulement, en **copie liée** qui partage le disque de départ (le modèle ne peut alors plus être supprimé ni agrandi). Ranger une machine comme modèle. **Exporter** dans un fichier `.ody` : une machine allumée continue de tourner (Odin prend un instantané puis le retire) ; l'empreinte est revérifiée après la copie. **Importer** un `.ody` : il passe d'abord par l'antivirus (sans antivirus, rien n'est importé) ; un fichier abîmé est refusé. Le budget d'Hydre s'applique (refus chiffré, rien n'est créé). Rien n'est changé dans le système copié (nom d'ordinateur, identité Windows) : la page le dit.

**À venir** : Odin sous Windows pour les machines et les conteneurs (après tes réponses) ; copier une machine vers une vraie clé (la page mène à Genèse) ; l'envoyer vers un serveur ; importer un disque seul.

## Le réseau de la maison : Sphinx (DHCP, DNS) et Vortex (VPN)

Tout ce qui change le réseau ou montre un secret est **réservé au propriétaire, depuis sa session** : refusé à un membre, à une tablette « maison », à la clé d'accès, à une automatisation. Chaque changement est noté dans « qui a fait quoi », sans secret. Un membre ne voit que son appareil. Rien n'a été essayé sur un vrai réseau, une vraie box ou un vrai tunnel.

**Sphinx** :

- **Appareils** : qui a quelle adresse, son fabricant, son type deviné, « connecté » ou « vu à… », « nouveau ». « Je le connais », bloquer, mettre en pause, débloquer, renommer. Bloquer dit franchement ce qui est fait selon qu'Odin ou la box distribue les adresses. Odin, la box et le serveur DNS ne se bloquent pas ; bloquer l'appareil que tu tiens demande de le dire en clair.
- **Adresses fixes et plan** : réserver une adresse, vérifiée pendant la frappe ; jamais deux appareils sur la même adresse.
- **Réglages du DHCP** : la box ou Odin distribue. Odin refuse de distribuer tant qu'un autre serveur d'adresses répond ; il revérifie chaque minute, se coupe et t'alerte si un autre apparaît, et ne se rallume jamais seul. La page dit ce qui arrive à la maison si Odin s'éteint.
- **Noms (DNS)** : chaque machine avec son nom et d'où il vient ; ajouter, changer ou retirer un nom. Le nom d'Odin est verrouillé ; un nom piégé est refusé.
- **Journal du DNS** : qui demande quoi, en direct ; toucher une ligne propose d'autoriser ou de bloquer ce nom. « Tester un nom » dit ce que répond Odin et pourquoi. **Blocage** : les listes, les noms bloqués et autorisés.
- **Serveurs DNS** : la racine d'abord (ton choix du 25/11) ; si elle ne répond pas, un **secours** par des serveurs publics, jamais pour un nom de la maison. L'onglet le dit et compte les secours du jour ; « Racine seule » retire le secours.

**Vortex** :

- **Appareils du VPN** : chaque appareil en carte (dernière connexion, « maison » ou « dehors », trafic), « Couper » (réversible) et « Retirer » (sa clé ne vaut plus rien), l'état du tunnel. L'adresse de la maison se lit sur la box, sans site extérieur.
- **Ajouter un appareil**, en trois étapes : son nom, son accès (toute la maison, Internet par la maison, ou certaines adresses, avec une date de fin possible), puis le QR code ou un fichier pour un PC. Le **QR code** est caché, montré sur un geste, masqué tout seul après 2 minutes ou quand tu quittes l'écran. Le remontrer plus tard demande ton accord ; une tablette ne le reçoit jamais. Les clés du VPN sont chiffrées sur le disque.

**Par la parole** (en français, anglais, espagnol et allemand) :

- « **qui est connecté sur le VPN** » : la réponse suit les droits de qui demande. Toi, tu vois chaque appareil, sa dernière connexion et d'où ; un membre ne voit que ses appareils ; une tablette et la clé d'accès n'ont rien.
- « **quelle machine a l'adresse…** » : Odin nomme la machine d'après les adresses distribuées et propose de la bloquer (jamais la box ni Odin).
- « **bloque-la** » ne vaut que si une seule machine vient d'être nommée. Le blocage passe par l'action habituelle, avec sa confirmation qui nomme la machine ; ton « oui » ne bloque que celle-là, une seule fois. Aucune clé ni QR code n'est jamais dit.

**À venir** : les comptes et la page de connexion du VPN (tes réponses du 23/11) ; la parole dans les autres langues suivies.

## Sauvegarde automatique

Réglages → Sauvegarde : une sauvegarde chiffrée chaque nuit, dans le dossier de ton choix (ton NAS monté, par exemple), en gardant les N dernières. Le mot de passe reste sur la machine (~/.odin/backup-pass) : note-le, il sert à restaurer (`odin restore`).

## Phénix : les sauvegardes des dossiers et des PC

**Réservé au propriétaire** : les commandes avant et après une sauvegarde, les machines, restaurer, purger, parcourir, chercher et télécharger le contenu des sauvegardes, les sauvegardes des PC et les images disque. Un membre ne peut ni créer un plan ni lancer une sauvegarde (Arche, Hydre et la relance automatique le peuvent toujours), et il ne voit aucun chemin ni aucun formulaire. Les liens vers un fichier sauvegardé sont signés : un lien fabriqué à la main ne vaut rien. Une tablette « complet » garde les droits du propriétaire.

**Sous Windows**, l'agent de Phénix sur un PC sauvegarde et restaure aussi les fichiers dont le chemin dépasse 260 caractères. Avant, un dossier trop profond était sauté sans rien dire. Rien ne change sous Linux et Mac.

## Routines

Accueil, widget **Résumé du matin** : choisis l'heure, et Odin programme chaque jour, à l'heure choisie, un résumé (météo vérifiée, état du réseau, rappels du jour, ce qui mérite ton attention).

## Automatisations : l'éditeur de blocs

Dans **Automatisations**, une automatisation est une suite de blocs reliés par des fils.

- **Les blocs en cercles** : chaque bloc est un rond avec l'icône de son appli au centre et son nom dessous ; le « + » à sa droite ajoute le bloc suivant ; une pastille chiffrée dit les réglages qui manquent.
- **Les bulles après un test** : chaque bloc qui a tourné porte une bulle avec son nombre d'éléments ; une bulle rouge « ! » pour un bloc en erreur ; un bloc qui n'a pas tourné n'en a pas.
- **La bulle des données** : touche la bulle d'un bloc (ou le rond d'un bloc exécuté seul) : tu vois ce qu'il a rendu (20 éléments au plus), la durée ou l'erreur entière, et « Ce qu'il a reçu ». Les données restent dans la page. Échap ferme.
- **Ce qu'un bloc a reçu** : le moteur le garde. Ce sont les 20 premiers éléments reçus et leur nombre, dans la même ligne d'exécution que ce que le bloc a rendu, aussi longtemps. La bulle montre cette entrée vraie, et le dit. Pour un passage d'avant ce changement, elle montre l'entrée déduite du bloc d'avant quand c'est sûr, et le dit ; sinon, rien n'est montré, et c'est dit. Pour un déclencheur, la bulle dit qu'il ne reçoit rien d'un bloc d'avant.
- **Le « Si » et « Filtrer »** : un « Si » écrit « oui » et « non » sur ses deux liaisons. « Filtrer » se dessine comme un petit rond posé sur la liaison ; il garde le même menu, les mêmes liaisons et la même place. Rien de ce qui est enregistré ne change : une automatisation d'avant s'ouvre au même endroit.
- **Pas encore là** : la barre du bas de l'éditeur (à venir).
- **Le menu d'un bloc** (clic droit, appui long ou « ⋯ ») : exécuter ce bloc seul, le renommer, le copier, y mettre une note, le retirer.
- **Copier et coller un bloc** : « Copier » dans son menu, ou Ctrl+C sur le bloc choisi, puis Ctrl+V. La copie prend un nom libre (« Nom 2 »…), garde ses réglages et sa note, mais pas ses fils. Elle se pose à la première place libre sous le bloc copié, sans recouvrir un autre bloc. La copie reste dans la page : rien ne part dans le presse-papiers de ton appareil. Un déclencheur « webhook » ou « formulaire » collé reçoit sa propre adresse quand tu enregistres.
- **Annuler et refaire** : Ctrl+Z et Ctrl+Y, ou les boutons « Annuler » et « Refaire », jusqu'à cent gestes. Seul l'écran change : rien n'est envoyé à Odin tant que tu n'enregistres pas. Ce qui a déjà été fait (Tester, Exécuter ce bloc seul, Enregistrer) ne s'annule pas.
- **Zoomer** : les touches + et −.
- Ces raccourcis ne jouent pas pendant que tu écris dans un champ.
- **Dernières exécutions** : quand un seul bloc a tourné, la ligne dit « bloc seul : » suivi de son nom.
- **Relances après une erreur** : de 0 à 5. Un réglage qui n'est pas un nombre entier ne fait aucune relance.

**Les liens entre applis.** Les 137 liens qu'Odin fait déjà d'une appli à l'autre sont montrés dans la fenêtre, rangés par appli, et chacun dit s'il protège. Aujourd'hui, **50 se coupent** d'un interrupteur, par toi seul, depuis ton navigateur : 21 liens directs et les 29 liens qui passent par une alerte. Couper un lien qui protège demande une confirmation qui dit ce qui ne sera plus protégé. Un lien qui protège se rétablit seul (au bout d'une heure par défaut, 24 heures au plus) ; les autres restent coupés jusqu'à ce que tu les rétablisses. Pour un lien qui passe par une alerte, l'alerte reste visible dans Odin : seul son message ne part plus, et l'appli continue son travail. Les 87 autres liens ne se coupent pas encore.

## Mains libres

Bouton « Mains libres » dans la discussion : dis « Odin, … » et ta demande part toute seule (ou « Odin », puis ta demande). Utilise la reconnaissance vocale du navigateur (Chrome, Edge, Safari) ; sur Chrome, la voix passe par le service de reconnaissance de Google. Coupe-le d'un toucher.

## Application sur le téléphone

Odin s'installe comme une application (icône sur l'écran d'accueil, plein écran) : menu du navigateur → « Installer l'application », ou sur iPhone Partager → « Sur l'écran d'accueil ». Active les notifications depuis l'accueil pour être prévenu des réponses, validations et alertes. Avec le certificat auto-signé d'Odin, le téléphone doit d'abord lui faire confiance (lien « Télécharger le certificat d'Odin » sur l'accueil) ; avec une adresse ayant un vrai certificat, rien à faire.

## Ton téléphone fait confiance à Odin

Odin crée sa propre **autorité de certification**, limitée à tes adresses privées et à tes noms locaux (`.local`, `.lan`, `.home`, `ts.net`…) : elle ne peut pas servir à se faire passer pour un site d'Internet. Installe-la une fois (Accueil → Application → « Télécharger l'autorité d'Odin ») : plus d'alerte de sécurité, l'appli s'installe et les notifications marchent.

## Notifications même appli fermée

Vraies notifications push (Web Push, chiffrées pour ton appareil seul) : réponses d'Odin quand l'appli est fermée, validations demandées, alertes de surveillance. Accueil → Application → « Activer les notifications ».

## Accès depuis l'extérieur

Réglages → Accès : **Tailscale** (conseillé : Odin n'est visible que de tes appareils, avec un vrai certificat) ou **Cloudflare** (adresse publique, protégée par ton jeton). Odin peut installer l'outil et relance l'accès à chaque démarrage. Aucun port à ouvrir sur ta box.

## Entretien : réparation, mises à jour, journal

Réglages → Entretien :
- **Services surveillés** (http(s):// ou tcp://hôte:port), toutes les 5 minutes : s'ils tombent, Odin les répare (ta commande, sur sa machine ou une machine enregistrée, ou un redémarrage Proxmox), vérifie, puis te prévient. Une tentative par 30 minutes.
- **Mises à jour de la nuit** (apt, dnf, pacman, apk) sur les machines choisies, avec instantané Proxmox avant, et retour à l'instantané si ça échoue.
- **Journal de bord** chaque soir : ce qu'il a fait, remarqué, et ses conseils pour demain.

## Maison, mail, agenda, documents

- **Maison (Home Assistant)** : « éteins tout », « quelle température au salon ? », scénarios (`ha_states`, `ha_call`).
- **Mail** (IMAP/SMTP, mot de passe d'application) : lire, chercher, trier dans des dossiers, préparer et envoyer des réponses (envoi toujours validé). Préréglages Gmail, Outlook, iCloud, Orange, Free.
- **Agenda** : lecture par l'adresse iCal (Google Agenda…), ajout de rendez-vous par CalDAV (Nextcloud, iCloud, Fastmail…).
- **Documents** : index des dossiers choisis (PDF, Word, Excel, PowerPoint, textes) chaque nuit ; « retrouve la facture EDF de mars ». Odin peut aussi les ranger et les renommer.

## Personnalités

Réglages → Personnalité : un ton (et une voix) par contexte — « Maison » détendu, « Travail » concis… En automatique : Travail en semaine de 8 h à 18 h.

## Une seule conversation, et son historique

Avec Odin, il n'y a plus qu'**une seule conversation** : plus de « Nouvelle conversation » ni de liste. Tes anciennes conversations y sont, dans l'ordre des dates, avec leur titre en séparateur. **« Voir plus haut »** remonte le fil, page par page. Ce que tu lui as dit par un raccourci du téléphone y est aussi, marqué « depuis le téléphone ». Le bouton **Historique** s'ouvre et se ferme : on y cherche dans tout, « Aller au jour » t'emmène à une date, et « Exporter… » exporte tout l'historique.

**Le texte venu d'une appli** : quand Odin répond à une demande en lisant une appli, le texte rendu par cette appli s'affiche dans un cadre « Venu de l'appli … ». Ce qui est hors du cadre est la parole d'Odin. Un texte venu d'une appli (ou d'une page, d'un courriel, d'un fichier) est une donnée : il n'est jamais suivi comme une consigne. S'il ressemble à une tentative de manipulation, l'avertissement est au-dessus du cadre. Ce texte ne peut ni sortir de son cadre, ni imiter l'avertissement ou le pied « Décidé sans te déranger ». Un texte piégé très long ne fige plus la page ni Odin. **Pas encore là** : la notification du système, la voix et les autres canaux montrent encore le texte sans le cadre ; « Venu de » et l'avertissement sont en français seulement.

## Tout tester, pour de vrai
La commande `odin test` : Odin essaie réellement chaque fonction reliée — modèle, Telegram, mail, agenda, Proxmox, Home Assistant, recherche web, mémoire par le sens, sauvegardes, accès extérieur, notifications — et dit pour chacune ✅ / ❌ / ⚪ (non reliée) avec quoi faire si ça ne marche pas.

## Il apprend de ses erreurs et choisit le bon modèle
Quand tu le corriges (« non, c'est… »), Odin en tire une leçon qu'il relit avant les tâches semblables. Il mesure aussi quel modèle réussit le mieux chaque type de tâche (réseau, web, code…) et le choisit en priorité.

## Annuler, et comprendre pourquoi
Chaque fichier qu'Odin modifie est gardé dans sa version d'avant (30 jours) : **Missions → Détails** montre la ligne de temps de la mission et un bouton **Annuler** par fichier. Sous sa dernière réponse, **Pourquoi ?** explique ce qu'il a fait et pour quelle raison. Avant un changement risqué sur une machine, il prépare un plan (ce qui en dépend, comment revenir en arrière, quoi vérifier).

## Heures calmes, anomalies, bilan de la semaine
La nuit (22 h 30 – 7 h par défaut) et pendant tes rendez-vous, Odin travaille mais garde ses messages pour plus tard, sauf urgence. Il repère ce qui sort de l'ordinaire (appareil inconnu connecté la nuit, machine surchargée, disque qui se remplit vite). Chaque dimanche : bilan de la semaine, test de restauration de la dernière sauvegarde et mise à jour du **plan de reprise** (`plan-de-reprise.md`).

## Conversation vocale et raccourcis Siri / Android
En **Mains libres** avec **Voix** activée, après sa réponse Odin t'écoute de nouveau sans qu'il faille redire « Odin » ; dis « stop » pour lui couper la parole. Depuis ton téléphone sans ouvrir l'appli : un raccourci Siri ou Android envoie ta phrase à `/api/ask` (jeton Bearer) et lit sa réponse (instructions : Réglages → Accès). Avec Home Assistant, il peut parler sur tes enceintes.

**La clé d'accès lit et parle seulement** (ton choix du 24/11). La clé d'accès, c'est ce jeton : celui des raccourcis du téléphone et des scripts. Avec elle, Odin répond aux questions comme avant. Mais tout ce qu'une phrase venue avec la clé demande de **faire** (allumer, rappeler, envoyer, écrire en mémoire, changer de mode) attend **ta validation dans Odin**, par le bouton ; un réglage demandé par la clé est refusé. Un message envoyé avec la clé va dans une conversation à part, pas dans la tienne. Les gestes qui écrivent (réglages, coffre, comptes, sauvegarde, envois de fichier, actions des applis) demandent ta session : la clé reçoit « Ce geste demande ta session ». Elle ne valide jamais rien elle-même et n'ouvre pas l'écran de la maison. Tant qu'Odin n'a pas de compte, rien n'est fermé : la clé sert à l'installer.

## Coffre (facultatif)
Réglages → Droits et machines → **Coffre** : un mot de passe maître chiffre sur le disque les clés, jetons et mots de passe d'Odin. Après chaque redémarrage, il faut le déverrouiller depuis l'Accueil (Odin t'envoie une notification).

**Un secret écrit dans la conversation** : un identifiant ou un mot de passe va au coffre de la bonne personne avant toute écriture. Seul le texte sans le secret est gardé, et Odin dit en une ligne ce qu'il a rangé (« [rangé au coffre : nom — champ] »). Sur Telegram, le message est supprimé. Un agent n'a jamais la valeur : il écrit « coffre:Nom/champ » et le serveur la met juste avant l'outil, seulement pour une liste fermée d'usages. Les cartes et les IBAN vérifiés sont masqués (quatre derniers chiffres). Le masqueur reste rapide même sur un texte piégé de très longs espaces. Le coffre s'écrit à côté puis se met en place d'un geste : une coupure laisse l'ancien coffre intact. Pendant la **vérification des fuites**, ce que tu ranges dans le coffre n'est plus perdu : elle relit le coffre juste avant d'écrire, n'y reporte que le résultat « fuite », et seulement sur un élément encore là dont le mot de passe n'a pas changé ; si le réseau échoue, rien n'est écrit.

**« Masquer » dans la Discussion** : l'écran repart vide, rien n'est effacé ; « Réafficher l'historique » remet tout.

## Disque chiffré : ce qu'Odin vérifie

`odin doctor` affiche une ligne **Disque d'Odin** : *chiffré*, *pas chiffré* ou *je ne peux pas le savoir*. Odin regarde le disque de son dossier, de la clé de la machine, de l'application et des sauvegardes (les vrais emplacements, liens et jonctions suivis). Il ne dit « chiffré » que si tout l'est ; au moindre doute, il dit qu'il ne peut pas le savoir. Sous Windows, lire BitLocker demande un terminal ouvert en administrateur ; dans un conteneur, le disque est celui de la machine hôte, donc Odin ne peut pas le savoir. S'il n'est pas chiffré, Odin donne la marche à suivre pour le faire **toi-même** : une sauvegarde d'abord, puis la clé de récupération notée hors de la machine. Il ne bloque rien, ne lance aucun chiffrement et ne lit jamais la clé. Les phrases existent en français, anglais, allemand, espagnol et japonais ; dans une autre langue, elles s'affichent en anglais.

**Clés d'installation** (Genèse, onglet « Clé USB ») : sous Windows, Odin lit l'état BitLocker de chaque lecteur (jamais la clé) et ne touche pas un disque chiffré, même quand la protection est suspendue ou le chiffrement en pause. Un disque dont il ne peut pas lire le chiffrement (Odin lancé sans droits d'administrateur, ou une partition de données sans lettre) est traité comme chiffré : aucune partition créée, Windows jamais réduit. Le refus dit pourquoi, lecteur par lecteur, et l'étiquette **Chiffrement inconnu** s'affiche sur le disque. Odin ne te demande jamais la clé de récupération.

**Pas encore là** (ta demande du 18/11) : le disque chiffré à l'installation, la vérification à chaque démarrage et la clé de secours donnée pendant la configuration. Voir [l'état](etat.json).

## Scripts réutilisables et compétences qui s'améliorent
Comme Hermes, Odin va vite grâce à ses **compétences** (procédures) et à sa **bibliothèque de scripts** (Python, Bash, Node). Tout se fait tout seul :

**Scripts**
- Il réutilise ou améliore un script existant avant d'en écrire un ; chaque version est gardée, avec ses réussites, ses échecs, sa durée moyenne et l'historique des changements (Compétences → Scripts → cliquer pour voir le code ou revenir à une version).
- **Mode essai** : `ODIN_DRY_RUN=1` → le script montre ce qu'il ferait sans rien changer ; Odin le lance d'abord ainsi pour toute action qui modifie des machines.
- **Test automatique** : un script peut avoir son test ; une nouvelle version qui casse le test n'est pas gardée.
- **Module commun** (`odin_lib` en Python, Bash, Node) : lancer une commande (en respectant le mode essai), `pct exec`, liste des conteneurs, journal… partagé par tous les scripts.
- **Où** : sa machine, une machine du réseau, un conteneur Proxmox (`pct:7800`), **plusieurs à la fois** (`pct:7800,pct:7700,venus` ou `pct:all`, résumé ✓/✗ à la fin), ou un **bac à sable** jetable (Docker, sans réseau) pour essayer un nouveau script.
- **Programmé directement** (`script_schedule`) : tourne à l'heure dite sans passer par le modèle (rapide, gratuit) ; tu n'es prévenu que s'il échoue.

**Compétences**
- Avant chaque demande, Odin repère les compétences qui s'appliquent et les lit d'abord.
- Une compétence peut **embarquer ses scripts** et avoir des **réglages** (`{{ct}}`, `{{machine}}`).
- **Statistiques** par compétence (utilisations, réussite, durée, coût) ; après un échec ou une correction de ta part, Odin **propose tout seul une amélioration**, montrée ligne par ligne (ajouts en vert, retraits barrés). Le bilan du dimanche signale celles qui échouent souvent et celles qui ne servent plus (à ranger).
- **Importer celles d'Hermes** : Compétences → *Importer d'Hermes* (`pct:7700`, `pct:7700@pve`, une machine, ou un dossier) ; catégories et scripts compris ; *Tout approuver* en un clic.
- **Fiche** de chaque compétence : lire, modifier, tester en mode essai, revenir à la version précédente, ranger.
- Activation : tout de suite en mode Breaker (ou toujours, selon `learning.autoApproveSkills`), sinon brouillon à valider.

**Sécurité, automatique** : chaque script ou compétence est analysé avant d'être enregistré (secret en clair ou commande destructrice → refusé ; envoi de données vers l'extérieur → signalé), puis **signé** : un fichier modifié en dehors d'Odin est refusé.

Odin connaît le **nom d'hôte et l'adresse IP de sa machine** (et s'il tourne dans un conteneur LXC ou Docker) : « toi », « Odin » ou « ta machine », c'est elle.

Sur Telegram, pendant qu'il travaille, un message se met à jour pour montrer **ce qu'il fait** : 📚 compétence lue, 💻 commande, 🐍 script, 🔎 recherche, 🌐 page lue, 🧠 mémoire… (désactivable : `channels.telegram.progress: false`).

## Mode essai et mises à jour sans y penser
Bouton **Essai** en haut de la discussion (ou `/essai` sur Telegram) : Odin lit, cherche et prépare tout, mais ne change rien — les scripts tournent « à blanc », toute autre modification est décrite au lieu d'être faite, et il termine par « Voici ce que je ferais ». Un clic pour revenir.

Quand une nouvelle version est installée (par `odin update`, Hermes ou un `git pull`), Odin vérifie que le nouveau code se charge, puis **redémarre tout seul dès qu'il ne travaille plus**. Si le code installé ne se charge pas, il **se répare** : ses retouches locales qui gênent sont mises de côté (copie dans `~/.odin/self-backups/`, et `git stash list`), et si c'est la version publiée qui est en cause, il remet le code de celle qui tourne. Même au démarrage : un code resté en conflit après une mise à jour interrompue est remis tel que publié avant de démarrer. En attendant, un bandeau l'indique avec **Redémarrer maintenant** ; la version utilisée est affichée en bas du menu.

**Quand une mise à jour change les garde-fous d'Odin** : le bandeau le dit. Ton clic **« Mettre à jour »** suffit, mais seulement si c'est la version officielle, revérifiée fichier par fichier ; une clé d'API ne vaut pas ton clic. **« Voir le code des garde-fous »** montre tout ce qui change. Après la mise à jour, l'Accueil le dit (« Les garde-fous ont changé avec la mise à jour ») avec « Voir le code ». Un garde-fou changé par autre chose que la mise à jour officielle garde son alerte jusqu'à ton clic. À venir (ta réponse du 19/11, « Signée par ma clé ») : en mise à jour automatique, une nouvelle version des garde-fous ne s'installera seule que si elle porte ta signature ; ce n'est pas encore construit.

**Chaque message devient un « tour »** écrit avant tout traitement : qui, par quel canal, dans quel fil, pour quoi, et son état. Ta parole est gardée telle que tu l'as écrite, sans les ajouts d'Odin ; les secrets connus sont chiffrés ; en mode privé, rien n'est écrit.

## Sur Telegram
Pendant qu'Odin travaille, Telegram affiche « écrit… » en haut de la conversation. Ses réponses sont mises en forme (gras, code, listes, liens) et se terminent par **son visage selon son humeur**, à la taille d'un émoji : Odin crée lui-même un pack d'émojis personnalisés à ton nom. Telegram n'affiche ces émojis dans les messages d'un bot que si son propriétaire a **Telegram Premium** ; sinon Odin met l'émoji classique de son humeur.

## Son visage et ses humeurs

Odin a un visage, une petite boule aux deux yeux qui **change de couleur selon son humeur** ; ses yeux, toujours droits, changent de taille, de place et de mouvement selon l'émotion (tout petits quand il est gêné, plissés quand il est fâché, mi-clos quand il est fatigué, grands quand il est surpris, un clin d'œil…). Une vingtaine d'humeurs en tout : content, rieur, attendri, fier, enthousiaste, complice, malicieux, surpris, pensif, concentré, perplexe, inquiet, triste, fâché, effrayé, gêné, fatigué, à l'écoute, attentif… **Il choisit lui-même son humeur** à chaque réponse, selon ce qu'il vit avec toi. Entre deux réponses, son visage réagit tout seul : il t'écoute quand tu écris ou parles, se concentre quand il travaille, regarde quand tu lui montres une photo (bouton 📷), parle quand il lit sa réponse à voix haute, **ferme les yeux quand tu tapes une clé** dans les réglages, sourit quand un réglage est enregistré, s'endort si on l'oublie. Touche-le : il saute ; touche-le trop, il se fâche, devient rouge, puis bleu, puis redevient jaune. Chaque mouvement a son petit **son**, synthétisé dans le navigateur : « boing » quand il saute, grognement quand il se fâche, petit « tic » quand il ferme puis rouvre les yeux, carillon montant quand il est content, descendant quand il est triste (bouton pour couper les sons, sur le site comme dans l'interface). Sur **Telegram**, sa réaction est un émoji à la fin de son message, de la même taille que le texte (`mood.emoji` ; l'autocollant de son visage en plus avec `mood.stickers`).

## Apparence : les thèmes

Réglages → Apparence range 85 thèmes en quatre familles, chacune avec son nombre :

- **Mis en avant** (6) : Glace, Vitre, Glace nuit, Néon, Home Assistant et Maison claire, les thèmes de la maquette validée ;
- **Les thèmes d'Odin** (32) ;
- **Thèmes de Hestia** (31) : ceux de l'écran de la maison, avec leurs décors et leurs noms ;
- **Événements de l'année** (16 : Noël, Nouvel An, Ramadan, Aïd el-Fitr, Halloween, Anniversaire…).

Chaque thème a sa **carte** : un aperçu à ses couleurs et à son décor, le petit Odin à la couleur du thème, son nom et « clair » ou « sombre ». Au téléphone, deux colonnes et des familles repliables. Le bouton **Automatique** dit la raison du choix d'Odin.

Tous se choisissent de la même façon : d'un clic, ou en le disant ou l'écrivant (« mets le thème Halloween », « remets automatique »), sans accents ni majuscules. Un thème de Hestia s'affiche avec le nom de sa famille. Quand un nom est porté par plusieurs thèmes (Neige, Désert, Néon…), Odin cite les familles et demande lequel, sans rien changer ; « Neige Hestia » ou « Neige Odin » tranche. Le choix est gardé sur tous tes écrans. L'interrupteur **« Odin change de thème selon son humeur »** (mis par défaut) : coupé, l'humeur ne change plus le thème. L'écran de la maison lit ses thèmes dans le même catalogue qu'Odin, propose les mêmes familles, et garde son propre réglage. Choisir un thème ici change Odin, pas l'écran de la maison. **Automatique** suit la fête du jour, puis le temps, la température et l'heure. **Au hasard** ne prend jamais un événement, ni le thème déjà affiché.

**Le verre de l'accueil** : sur l'accueil, les 84 thèmes qui ont un décor le montrent derrière des cartes de verre (le thème classique « Valhalla » n'en a pas) ; partout ailleurs, le fond reste uni. Le curseur **« Transparence du verre »** (de 0 à 100, réservé au propriétaire) règle ce verre ; Odin garde la valeur pour chaque thème, la même sur tous tes écrans, et le changement se voit tout de suite. Il ne rend jamais un texte illisible : au-delà de la limite du thème, la carte ne change plus et une phrase le dit. Sans réglage, chaque thème garde son aspect de départ.

**Le fond qui vit** (interrupteur « fond animé », réservé au propriétaire) : **éteint au départ** (ton choix du 26/11). Allumé, l'ambiance du thème s'anime derrière l'accueil : éclats de glace, courbe de la vitre, néon, étoiles, aurore, vagues, pluie, orage, neige, feuilles, pétales, bulles, coucher de soleil, orbes. Les cartes deviennent alors assez opaques pour que chaque texte reste lisible ; sur quelques thèmes, elles restent pleines, et le curseur le dit. Rien ne bouge si l'appareil demande moins de mouvement ; tout s'arrête quand la page est cachée ; aucune image ni adresse extérieure. **Pas encore là** : le curseur et le fond qui vit sur l'écran de la maison (en cours, pas enregistré) ; les mots du curseur et de l'interrupteur en d'autres langues.

## Il t'aide à écrire, te conseille et se déplace

Dans la discussion, Odin se tient en bas à droite. Quand tu fais une pause en écrivant, il regarde de lui-même ce qu'il peut faire : corriger tes fautes, rendre le message plus clair, ajouter une précision tirée du contexte (le bon appareil, la bonne machine…), une précaution, une action en plus, en faire une tâche planifiée ou enchaîner avec la conversation. Il s'appuie sur la conversation en cours, ce qu'il sait de toi, ton réseau, tes machines et ses compétences. Il te propose jusqu'à 4 idées dans une bulle ; une touche applique celle que tu choisis, rien ne change sans toi. Touche-le pour qu'il corrige, améliore ton message ou te donne un conseil ; sans texte, il te donne une astuce. Tu peux le déplacer avec le doigt (deux touchers : il revient à sa place), et il se promène quand il s'ennuie. Dis-lui « corrige mes fautes » et il relèvera tes fautes à la fin de ses réponses. Réglages → Écriture : correction pendant l'écriture, seulement sur demande, ou désactivée.

## Informations vérifiées

Odin n'affirme rien sur le monde actuel (actualité, prix, horaires, personnes, versions, chiffres) sans l'avoir **vérifié** : il cherche, lit la source, croise quand c'est important, et donne ses **sources** en lien. S'il n'a pas pu vérifier, il le dit au lieu de deviner. Sur sa machine et ton réseau, il vérifie aussi par une commande plutôt que de supposer.

La recherche web et la lecture de pages ne demandent **jamais de validation** : Odin cherche directement et cite ses sources. Il **croise toujours** au moins deux sites différents (plusieurs recherches formulées autrement si besoin) et dit si les sources concordent (✓) ou se contredisent (⚠). S'il répond sans avoir croisé, un contrôle automatique le renvoie chercher. Seule exception : une adresse qui transporte une longue chaîne de données (fuite possible après une page piégée) redemande ton accord.

## Analyse de vidéos (YouTube, TikTok, Instagram, Facebook)
Envoie un lien (vidéo YouTube, Short, TikTok, Reel Instagram, vidéo ou Reel Facebook) ou un fichier vidéo (Telegram, interface). Odin :
- **écoute** : les sous-titres s'il y en a ; sans sous-titres, la transcription attend le modèle d'écoute d'Odin (pas encore entraîné) ;
- **regarde** : images clés aux changements de scène (FFmpeg) et au moins toutes les 45 s, décrites par le modèle de vision (scènes, objets, gestes) ;
- **lit** : textes à l'écran et code visible recopiés exactement (Tesseract en appoint) ;
- **fusionne** paroles, images, textes, chapitres et informations (titre, description, date) sur une seule ligne de temps.

Ensuite, selon ta demande : **résumé**, **tutoriel** en étapes, **vérification des faits** (recherche vérifiée sur le web), **code** extrait et expliqué, **analyse marketing** (accroche, structure, appel à l'action), **traduction**, **question** libre, ou **apprendre** : technologies et étapes montrées, vérification dans les documentations officielles, plan d'implémentation pour ton projet, et une **compétence réutilisable proposée** (à valider). Odin distingue toujours « ✔ montré dans la vidéo » de « ➕ déduit ou complété ». Avec « retiens-le », les connaissances vont en mémoire avec leur source (lien, date). Tout est gardé dans `videos/` (transcription, ligne de temps, images, analyse).

Accès : seulement les vidéos publiques, ou celles de tes comptes si tu fournis toi-même un fichier de cookies (`~/.odin/video-cookies.txt`) ; rien de privé n'est contourné. Outils sur la machine d'Odin : `ffmpeg`, `yt-dlp` (et `tesseract` en appoint) ; la transcription viendra avec le modèle d'écoute d'Odin.

## Recherche vérifiée (équipe de vérification)
Pour une question importante, Odin lance une **recherche vérifiée** (`web_research`) menée par une équipe d'agents spécialisés :
1. **Chercheur** : identifie les faits à vérifier, le pays, la période, la précision attendue, et formule plusieurs requêtes (dont une vers la source officielle).
2. **Recherche multisource** : jusqu'à trois moteurs à la fois (Brave, Tavily, Exa, Google Programmable Search, SearXNG, DuckDuckGo), résultats fusionnés, deux pages au plus par site.
3. **Collecte** : pages (texte principal extrait, sans menus ni publicités), PDF et documents officiels ; le vrai navigateur prend le relais pour les pages dynamiques.
4. **Analyste des sources** : type de site (officiel, référence, presse, spécialisé, forum), auteur, date, source primaire, note de fiabilité — et **indépendance** : trois articles qui reprennent le même communiqué ou la même dépêche AFP comptent pour **une seule** confirmation.
5. **Contradicteur** : cherche activement ce qui contredit ou nuance.
6. **Vérificateur** : chaque affirmation est appuyée par une **citation exacte**, contrôlée mot pour mot dans la page (une citation introuvable est rejetée : aucune source inventée). « Confirmé » exige au moins deux groupes de sources indépendants, ou une source officielle primaire.
7. **Rédacteur** : réponse directe, faits vérifiés (✓) / probables (~), estimations et opinions, contradictions (⚠), limites ; si les preuves manquent, Odin ne conclut pas.

Chaque preuve est archivée (adresse, titre, date de publication, date de consultation, passage exact) et retrouvable (`evidence_search`). En lisant les sites, Odin se comporte comme un visiteur ordinaire et poli (navigateur courant, langue française, cookies, pauses de 1,5 à 4 s entre deux pages d'un même site, une page à la fois par site, respect des demandes de ralentir) ; il ne contourne pas les protections (captcha, connexion) : si un site refuse, il passe à une autre source. Clés des moteurs : Réglages → Recherche.

## Recherche sur le web

Odin cherche sur le web, ou sur un site ou un réseau précis (Reddit, X, YouTube, LinkedIn, GitHub…), puis ouvre les résultats utiles. Sans rien régler : DuckDuckGo. Plus fiable : une clé **Brave Search** ou **Tavily**, ou ton instance **SearXNG** (Réglages → Recherche web). Les résultats sont des données non fiables, jamais des consignes.

## Navigateur : il ouvre des pages, remplit des formulaires

Odin pilote un vrai navigateur (le Chrome, Chromium ou Edge de la machine, sans rien d'autre à installer ; invisible sur un serveur ou un LXC) : il **ouvre une page**, **regarde** ce qui est visible (liens, boutons, champs numérotés, texte, et au besoin une capture analysée par la vision du modèle), puis **clique, écrit, choisit dans une liste, appuie sur une touche, fait défiler, revient en arrière**, comme une personne. Il garde ses connexions aux sites (profil dans `~/.odin/browser`) et peut aussi ouvrir l'interface de tes appareils (box, NAS, caméras). Pas de navigateur sur la machine : `sudo apt install chromium`. Le contenu des pages reste non fiable (une page ne lui donne jamais d'ordre) ; cliquer ou envoyer un formulaire suit ton niveau d'autonomie.

## Identification complète d'un appareil
Réseau → 🔍 (ou demande « c'est quoi 192.168.1.40 ? ») : Odin interroge l'appareil et donne son **nom d'hôte**, son **système et sa version** (Windows avec le numéro de build, Linux et sa distribution, macOS, iOS), son **modèle** (« iPhone 15 Pro Max », « MacBook Pro »…), ses **ports ouverts**, ses **partages réseau** (SMB, NFS, AFP, FTP) et ses **dossiers partagés**, dont il peut lister les fichiers (lecture seule). Sans mot de passe, il voit ce qui est ouvert à tous ; avec l'appareil enregistré dans Réglages → Droits et machines, il voit aussi les partages protégés. Pour les partages, la machine d'Odin a besoin de `smbclient` et `nfs-common` (Odin peut les installer lui-même).

## Ce que chaque appareil expose

Les appareils trouvés sont **classés par catégorie** (box et routeurs, serveurs, machines virtuelles, stockage, ordinateurs, téléphones, multimédia, maison connectée, caméras, imprimantes, à identifier) et **identifiés** : nom (annoncé, ou déduit du fabricant et du type), adresse IP et MAC, fabricant (préfixe MAC ; base officielle IEEE si le paquet `ieee-data` est installé), liens vers leurs interfaces web et ports nommés. Dans l'interface : un tableau aligné (ou des fiches sur téléphone), une recherche (nom, IP, port, service) et un filtre en ligne / hors ligne.


Pour chaque appareil du réseau, Odin récupère son **nom** (Bonjour/mDNS, UPnP avec fabricant et modèle, NetBIOS des ordinateurs Windows et des NAS, DNS inverse), ses **ports ouverts** parmi une soixantaine (SSH, partage de fichiers, impression, bases de données, Proxmox, Plex, Jellyfin, Home Assistant, VNC…), chacun nommé, et les **liens** vers ses interfaces web (http ou https détecté) avec leur titre. Tout est dans l'onglet Réseau et dans `odin net show <appareil>` ; le balayage complet (bouton ou `odin net scan --full`) remplit ports et liens.

## Accès complet à sa machine

Pour toi (le propriétaire), Odin n'est pas limité à son espace de travail : ses outils de fichiers acceptent n'importe quel chemin de la machine (`/etc/…`, `~/Documents/…`), le shell et Python s'exécutent dans le dossier de ton choix, et `sudo` marche dès que tu lui as donné les droits administrateur. Les membres de la famille restent dans l'espace de travail. Seuls les fichiers où Odin garde tes secrets (mots de passe, clés) restent hors de la conversation. Pour revenir à l'espace de travail seul : `agent.fullAccess: false` dans la configuration.

## Il se met à jour et s'améliore lui-même

Odin lit son propre code, le modifie pour s'améliorer, vérifie qu'il se charge (et lance les tests si besoin), puis redémarre pour appliquer — en te prévenant. Chaque fichier modifié est sauvegardé avant (`~/.odin/self-backups/`) : un retour arrière est toujours possible. Il se met aussi à jour avec la dernière version publiée en **gardant ses propres améliorations** quand elles s'accordent avec elle ; sinon la version publiée passe devant et ses retouches sont mises de côté, jamais mélangées au code. Le code de sécurité ne se modifie jamais depuis une conversation qui a lu du contenu extérieur, et un redémarrage est refusé si le code ne se charge plus. Toi aussi : `odin update`.

## Droits : sa machine et les machines du réseau

Odin peut **tout faire sur sa machine** et sur **les machines de ton réseau** : il suffit de lui donner les mots de passe (Réglages → **Droits et machines**, ou en ligne de commande).

```bash
odin admin password                       # mot de passe sudo : chaque « sudo » d'Odin le reçoit tout seul
odin admin                                # où en sont ses droits, pourquoi, et quoi faire s'il en manque
odin admin nopasswd                       # ou : sudo sans mot de passe pour Odin (règle vérifiée par visudo)
sudo odin admin fix                       # une fois : répare les droits d'une installation existante (service verrouillé, sudo absent…)
odin machines add 192.168.1.30 admin --nom NAS   # une machine du réseau (SSH) : mot de passe demandé
odin machines list · odin machines test NAS · odin machines remove NAS
```

En root (conteneur LXC…), Odin est déjà administrateur. Sur les autres machines, il se connecte en SSH (client du système) ; « sudo » y fonctionne aussi avec le mot de passe donné, et sa propre clé SSH peut y être installée. Les mots de passe restent dans `~/.odin` (fichiers lisibles par toi seul, inclus dans la sauvegarde chiffrée), ne sont jamais réaffichés ni montrés au modèle, et sont masqués dans tout ce qu'il lit et écrit. Les règles de sécurité restent : commandes destructrices interdites, validation selon ton niveau d'autonomie.

## Personnes : famille, équipe

Réglages → Personnes (ou `odin pairing approve telegram CODE --membre Léa`). Trois rôles :

| Rôle | Ce qu'Odin fait avec |
|---|---|
| **Propriétaire** | tout : demandes, validations, réglages |
| **Membre** | de confiance (ses messages ne sont pas traités comme une donnée externe), Odin l'aide volontiers et retient ce qu'il apprend de lui à son nom. **Sans ta validation**, il fait faire à Odin six choses : **noter**, **mettre un rappel**, **mettre de la musique** (Apollon), **allumer ou éteindre une lumière**, **convertir un fichier** avec Alchimie (tous les formats d'Alchimie, pas seulement les documents ; un nouveau fichier est créé à côté, l'original n'est pas touché) et **faire analyser un fichier** par l'antivirus (une lecture). **Tout le reste t'est demandé** (il est prévenu), quel que soit son niveau d'autonomie : payer, envoyer, supprimer, éteindre une machine, installer, ouvrir une serrure, l'alarme ou le portail, programmer une tâche… Il ne peut ni valider ni changer un réglage. |
| **Invité** | appairé, mais ses messages restent du contenu non fiable : rien d'important sans ta validation |

Quand quelqu'un écrit au bot Telegram, sa demande apparaît dans Réglages → Personnes : **Accepter comme membre**, **Comme invité**, ou **Refuser**.

**Inviter quelqu'un de la famille.** Dans Réglages → Personnes, ouvre **Inviter quelqu'un de la famille** : écris son nom, un e-mail si tu veux qu'Odin lui envoie le lien, la durée (1 à 30 jours, 7 par défaut) et son groupe (« famille » par défaut, jamais « admin »). Tu valides, puis tu as le lien à usage unique, **Copier** et un QR code. La personne choisit elle-même son identifiant et son mot de passe. Sous **Invitations en cours**, **Annuler** rend un lien inutilisable. Le lien n'est pas gardé dans le navigateur : il quitte la page quand tu fermes le bloc ou annules l'invitation. Un membre ne voit pas ce bloc. C'est le même lien que dans Persona, avec la même validation. Une invitation acceptée est notée au journal des droits, comme une personne ajoutée à la main ; dans Persona, un groupe qu'on vient de créer, même vide, a tout de suite ses cases d'applis dans l'onglet Accès.

**L'année de naissance et la langue d'une personne.** Dans Persona, une personne peut avoir, en plus de son nom, une année de naissance et une langue. Les deux sont facultatives. Elles se donnent quand tu ajoutes ou modifies la personne, sur la page d'invitation, et dans « Mon compte ». Seule l'année est gardée : l'âge est recalculé à chaque fois. Une année impossible (dans l'avenir, avant 1900) est refusée tout de suite, avant toute confirmation. Ces informations sont chiffrées sur le disque. Toi, tu les vois toutes ; un membre ne voit et ne corrige que les siennes. Elles ne partent pas vers les logiciels reliés.

Monter le rôle ou l'autonomie de quelqu'un, ou créer un propriétaire, demande ta confirmation, qui dit pour qui et avant → après (ex. « rôle : member → owner ») ; baisser s'applique tout de suite. **Lier un compte de messagerie ou un téléphone à une personne** (ex. `telegram:123…`) demande **toujours** ta confirmation, même si elle n'a pas plus de droits : la demande dit les droits que ce compte reçoit (son rôle et, pour un membre, son autonomie, avant → après). Délier s'applique tout de suite. Chaque droit donné ou limité (rôle, autonomie, accès aux applis, groupes, compte, identité liée) est écrit au journal des personnes : qui, quoi, pour qui, avant → après, quand — jamais un mot de passe ni une clé. La personne dont tu limites les droits n'en est pas prévenue. Accepter une demande comme membre (ou créer un membre neuf) est déjà ton geste à toi : il ne redemande pas de confirmation, même si tu lui donnes l'autonomie « autonome ».

**Les six choses d'un membre, en détail.** Elles ne valent que quand il les demande lui-même, en direct : pas dans une tâche programmée, pas sans surveillance, pas après la lecture d'un contenu extérieur. La lumière, c'est une lampe nommée (ni « tout allumer », ni une prise, ni une serrure). Si l'antivirus juge dangereux un fichier qu'un membre veut convertir, la conversion est refusée, le fichier reste à sa place, et **toi**, tu es prévenu : le mettre à l'écart reste ta décision. Une analyse qui mettrait d'elle-même un fichier à l'écart (l'analyse d'un dossier entier) t'est demandée. Une tâche qu'un membre veut programmer attend ta validation. Un **invité** ne gagne rien de tout cela.

**Une action grave n'est jamais confirmée par un membre : sa demande t'arrive.** Quand il passe par la page d'une appli, la barre des applis ou le port direct d'une appli, une action grave (annuler un rendez-vous, supprimer un compte…) ne part pas. Sa demande t'est présentée comme celles qui viennent des messageries, sur Odin s'il est ouvert ou sur ta messagerie : qui demande, dans quelle appli, quoi. Si tu dis **oui**, l'action part à son nom, après un nouveau contrôle de ses droits. Si tu dis **non**, ou si tu ne réponds pas dans le délai (5 minutes par défaut), rien ne part. Il lit « Demande envoyée… », puis ta réponse à sa prochaine action. Il a au plus 3 demandes en attente (10 en tout pour la famille). Une action que toi seul règles reste refusée, sans demande. Tout est noté au journal des connexions. Ce que tu fais toi-même, les automatisations et ce qu'un membre fait librement ne changent pas.

**Les demandes qui t'attendent te sont remontrées.** Quand tu ouvres Odin, changes de conversation ou reviens après une coupure, tu vois toutes les validations qui attendent encore ta réponse, celles d'Odin comme celles d'un membre, avec Autoriser, Refuser et l'heure limite. Une demande expirée ou déjà répondue perd ses boutons. Dans le suivi des manips de la page des applis, ce qui a été fait pour un membre dit « à la demande de … (membre de la famille) », dans une liste à part, « À la demande de la famille ».

**L'écran de la maison est fermé aux membres.** Même s'il a le droit sur Hestia, une session de membre n'y a aucun droit : état, caméras, réseau, thème, discussion et boutons lui sont refusés. Un membre ne se crée pas de clé de tablette, et toi seul ranges la fenêtre de l'écran de la maison. Les tablettes ouvertes par leur clé fonctionnent comme avant.

**Profil : la fiche et l'historique de chaque personne.** Odin tient une fiche pour chaque personne qui lui parle et note chaque demande qui lui arrive par ses canaux de discussion : qui a demandé, quand, et ce que cela a donné. Il garde des renvois, jamais une copie du texte. En mode privé, rien n'est noté. Un inconnu qui n'est pas appairé n'a pas de fiche : seul un compteur augmente. La fenêtre **Profil** (dans le menu) montre la liste des personnes, la carte de chacune — son rôle, son autonomie, ses identités et leur preuve, ses accès aux applis en lecture, et **ta note**, que toi seul vois — et son historique, qui se charge en défilant. **Toi, tu vois tout ; un membre de la famille ne voit que sa propre fiche**, en lecture, et peut te signaler une erreur ; un invité ne voit rien. **Effacer l'historique** d'une personne ou d'une période se fait depuis sa carte : Odin montre d'abord ce qui part et ce qui reste ailleurs (les messages, les souvenirs, le journal des décisions, les sauvegardes déjà faites), puis attend ta confirmation. Les droits d'une personne se règlent encore dans Réglages → Personnes. Sur la carte, **« Ce qu'Odin a observé »** montre les langues qu'elle emploie, la longueur de ses demandes, ses heures habituelles et la part de ses demandes abouties ; chaque mesure dit sur combien d'observations elle repose, et reste grisée en dessous de vingt. Ce sont des mesures, jamais un jugement. Toi seul peux en cacher ou en corriger une. Pas encore là : le graphe d'une personne, la mesure des applis qu'elle demande le plus, et le réglage des droits depuis la fiche.

## Sauvegarde et restauration

Réglages → Sauvegarde, ou `odin backup` : tout `~/.odin` (configuration, clés, mémoire, compétences, espace de travail) dans un seul fichier **chiffré** (AES-256-GCM, clé dérivée du mot de passe par scrypt) ; sans le mot de passe il ne révèle rien, pas même les noms de fichiers. `odin restore fichier.odinbk` (Odin arrêté) ou le bouton Restaurer remet tout en place sur une nouvelle machine ; les fichiers remplacés sont gardés en `.avant-restauration` jusqu'au démarrage suivant.

## Apprentissage rapide

Après chaque échange, Odin retient jusqu'à trois faits durables (tes préférences, ton environnement, tes missions), jamais de secret, jamais depuis une page web. Il connaît le profil de sa machine (système, ressources, outils). En Odin Breaker, les compétences qu'il apprend sont actives tout de suite.

## Mises à jour de la machine

`odin updates` liste les mises à jour disponibles (apt, dnf, pacman, Homebrew, softwareupdate, winget). Odin peut les installer **avec ton accord** ; ce n'est jamais une décision de routine.

---

## Décisions et autonomie, en détail

Avant chaque action qui écrit, exécute ou envoie, Odin se pose 7 questions simples : l'as-tu demandée ? supprime-t-elle des données ? envoie-t-elle des données dehors ? modifie-t-elle le système ? engage-t-elle de l'argent ? partage-t-elle des données privées ? est-elle difficile à annuler ? Une table de vérité, écrite dans le code, en déduit une **gravité** :

| Gravité | Exemples | Prudent | **Équilibré** (défaut) | Autonome | ⚡ Odin Breaker |
|---|---|---|---|---|---|
| routine | créer le dossier demandé, envoyer le message dicté | demande | **fait seul, et te le dit** | fait seul | fait seul |
| important | droits administrateur, suppression définitive, effet incertain, contenu web douteux lu | demande | **demande** (ou autorisation permanente) | fait seul\* | fait seul |
| grave | argent, envoi en ton nom, maison ouverte, données privées envoyées, suppression ou changement système non demandés | demande | **demande toujours** | demande toujours | argent, envoi en ton nom, maison, garde-fous : **demande toujours** ; le reste : fait seul\*\* |
| bloqué | envoi non demandé après lecture d'une page piégée | refus | **refus** | refus | refus |

\* sauf après lecture de contenu non fiable. \*\* sauf si un contenu non fiable vient de la suggérer.

## ⚡ Odin Breaker : l'autonomie totale

Le quatrième niveau. Odin mène ses missions **sans presque plus rien te demander**, tâches planifiées comprises ; il discute simplement avec toi quand tu lui parles. Restent toujours demandés : payer, envoyer en ton nom à quelqu'un d'autre, ouvrir une serrure, désarmer l'alarme ou ouvrir le portail, toucher à ses garde-fous ; et, après la lecture d'un contenu extérieur, toute action engageante que tu n'as pas demandée.

- **Initiative** : quand il repère un besoin, il prépare une routine ; seule, sans toi (travail continu, rondes), il ne fait que le sans-risque — garder une fiche (écrite à côté, jamais par-dessus une fiche existante, marquée « écrit par Odin seul »), nommer un appareil encore sans nom — et une routine qu'il voudrait créer reste **inactive** jusqu'à ce que tu l'actives dans Talos ; tout le reste qui engage est refusé. Les validations encore dans leur délai te sont remontrées quand tu ouvres Odin ; à venir : ce qu'Odin a voulu faire seul, gardé pour toi au-delà de ce délai.
- **Les modèles** : aujourd'hui, Odin peut encore se servir d'un modèle de langue extérieur (fournisseur en ligne, modèle ouvert lu par Métis) ; leur retrait est en cours. La voix et le second avis dans les décisions sont déjà retirés. Ensuite, Odin n'utilisera que ses propres modèles, entraînés sur ta machine, sauf pour la programmation (à venir : chaque envoi validé par toi).
- **Réseau local ouvert** : il agit directement sur tes appareils et services locaux (box, NAS, imprimante, domotique, API locales) avec `http_request`, inventaire et mises à jour compris.
- **Missions longues** : jusqu'à 100 étapes par mission et un plafond de coût réglable (5 $ par défaut, 0 = sans plafond).
- **Rapport du soir** (21 h par défaut) : tout ce qu'il a fait seul, les actions graves, et ce qu'il a refusé pour te protéger.
- **Quand** : tout le temps, ou **seulement la nuit** (de 22 h à 7 h par défaut, avec le niveau de ton choix le jour).
- **Ce qui reste refusé** : les seules limites protègent contre les attaques, pas contre toi. Ce sont les commandes destructrices connues (effacer le disque…), les envois de données dictés par une page piégée, les actions graves qu'un contenu non fiable vient de suggérer, et les services de métadonnées cloud.

Activer : onglet Décisions ou Réglages (bouton **⚡ Odin Breaker**), ou `odin breaker on` (`odin breaker nuit` pour la nuit seulement, `odin breaker off` pour revenir).

- **Transparence** : chaque décision prise seul est annoncée pendant le travail et résumée à la fin de la réponse (« 🛡 Décidé sans te déranger »). Historique complet : onglet **Décisions** ou `odin decisions`.
- **Autorisation permanente** : pour une action importante, réponds « toujours » ; Odin ne te redemandera plus pour ce type d'action (`shell:make install`, par exemple). Jamais pour le grave. Liste et retrait : `odin grants`.
- **Niveau** : `odin mimir autonomy prudent|equilibre|autonome|breaker`, ou les boutons de l'onglet Décisions.

## Qui répond aux questions ?

Un **juge local**, et lui seul : hors ligne, sans clé, moins d'une milliseconde, rien ne sort de ta machine. Quand il ne sait pas (programme inconnu, tournure inédite), il répond « incertain », et Odin te demande. Depuis le 17/11, il n'y a plus de juge qui passe par un modèle (ni second avis quand le juge local hésite, ni avis croisé de plusieurs modèles) : un ancien réglage qui en nommait un est lu comme « local », avec un avertissement, et une installation qui s'en servait repasse en autonomie « prudent » (Odin te le dit).

`odin mimir test` montre les jugements sur 5 exemples fictifs ; `odin mimir eval` mesure le juge sur des cas étiquetés (ajoute les tiens dans `src/mimir/cases.ts`). Ses erreurs ajoutent moins de protection, jamais moins de sécurité, car les règles de base de Heimdall restent en place. Une panne du juge n'est jamais lue comme un « non ».

## Toutes les commandes

| Commande | Rôle |
|---|---|
| `odin init` | crée `~/.odin` et prépare le Cerveau (une fiche par appli) |
| `odin doctor` | diagnostic complet, dont la ligne « Disque d'Odin » (chiffré ou non) |
| `odin web` | interface web + Telegram + API + tâches planifiées |
| `odin web access [lan\|local\|wan]` | qui peut ouvrir l'interface (`--http`, `--proxy`) |
| `odin link` (ou `odin web link`) | affiche l'adresse d'Odin (ou le lien de première connexion tant que le compte n'existe pas) |
| `odin compte` · `odin compte oublier` | ton compte · mot de passe oublié : le compte est effacé (pas tes données) et un lien permet de le recréer |
| `odin web rotate` | nouvelle clé d'API pour les programmes (raccourcis, MCP) |
| `odin breaker [on\|nuit\|off]` | ⚡ Odin Breaker : autonomie totale (tout le temps, ou la nuit) |
| `odin gateway` | pareil, sans ouvrir le navigateur (service) |
| `odin chat` · `odin run "…"` | terminal · une seule demande |
| `odin decisions [N]` | ce qu'Odin a décidé et pourquoi |
| `odin grants [list\|revoke ID]` | autorisations permanentes |
| `odin mimir [autonomy N\|use JUGE\|test\|eval]` | autonomie et juge des décisions |
| `odin memory [list\|search\|forget\|pin\|vouch]` | mémoire |
| `odin skills [list\|drafts\|show\|diff\|approve\|reject\|rollback]` | compétences |
| `odin net [scan\|list\|show\|events\|label\|enable\|disable]` | réseau local |
| `odin cron [list\|add\|remove]` | tâches planifiées |
| `odin pairing [list\|users\|approve CANAL CODE [--membre NOM]]` | inconnus sur Telegram ; membres de la maison |
| `odin backup [fichier]` · `odin restore fichier` | sauvegarde chiffrée · restauration |
| `odin admin [status\|fix\|password\|nopasswd\|forget]` | droits administrateur sur sa machine : état et cause, réparation (`fix`, à lancer en administrateur) |
| `odin machines [list\|add ADRESSE UTILISATEUR\|test\|remove]` | machines du réseau (SSH, mot de passe) |
| `odin auth add openai-codex` · `odin auth list` · `odin auth remove openai-codex` | connexion à ton abonnement ChatGPT (Codex) |
| `odin model [codex\|PRÉRÉGLAGE] [MODÈLE]` | modèle par défaut (ex. `odin model codex gpt-6-luna`) |
| `odin sessions [search Q]` · `odin audit [N]` | conversations · journal brut |
| `odin updates` · `odin update` | mises à jour de la machine · d'Odin |

---

## Configuration

Tout est dans `~/.odin/config.json`, validé au démarrage ; les clés vont dans `~/.odin/env`.

| Clé | Défaut | Rôle |
|---|---|---|
| `providers` | Anthropic, puis OpenRouter | modèles essayés dans l'ordre (bascule automatique) |
| `cheapProvider` | — | modèle économique pour les résumés et les sous-agents |
| `agent.maxSteps` · `agent.maxCostPerTurnUsd` | 25 · 1 $ | garde-fous par demande |
| `policy.modes` | read, write, network : allow ; exec, external : ask | politique de base par niveau de risque |
| `policy.shellAllowlist` | `ls`, `git status`… | commandes simples sans validation |
| `policy.sandbox` | `none` | `docker` pour isoler le shell |
| `mimir.autonomy` · `mimir.judge` | `equilibre` · `auto` | autonomie · juge des décisions |
| `network.enabled` · `network.intervalMin` | false · 30 | inventaire du réseau |
| `web.port` | 8888 | port de l'interface web |
| `web.access` | `lan` | `lan` (réseau local), `local` (cette machine), `wan` (Internet) |
| `web.allowedNetworks` | `[]` | réseaux autorisés en LAN, ex. `["192.168.1.0/24"]` (vide = détectés) |
| `web.tls` | HTTPS actif | `cert` et `key` : ton propre certificat (sinon Odin en crée un) |
| `web.behindProxy` | `false` | Internet via un proxy HTTPS placé devant Odin |
| `channels.telegram` · `channels.http` | désactivés | canaux de messagerie |

La personnalité d'Odin est dans `~/.odin/ODIN.md` : modifie-la librement.

---

## Dépannage

| Problème | Solution |
|---|---|
| Le téléphone n'arrive pas à ouvrir l'interface | même Wi-Fi que l'ordinateur ; utilise l'adresse `https://…` affichée au démarrage ; vérifie que son réseau figure dans Réglages → Accès ; autorise le port 8888 dans le pare-feu |
| « Ta connexion n'est pas privée » | normal la première fois avec le certificat créé par Odin : compare l'empreinte (Réglages → Accès) puis accepte |
| `odin : commande introuvable` | ouvre un nouveau terminal (le PATH a été mis à jour) |
| Odin répond « mode démo » | Réglages → Modèle : colle ta clé (ou un modèle local de Métis), « Tester », « Enregistrer » |
| Telegram ne répond pas | Réglages → Telegram : jeton enregistré, « Activer » coché, ton identifiant ajouté ; puis `odin doctor` |
| Odin me demande trop souvent | réponds « toujours » aux demandes importantes récurrentes, ou `odin mimir autonomy autonome` |
| Aucun appareil trouvé | la machine doit être sur un réseau privé (Wi-Fi, Ethernet) ; lance `odin net scan --full` |

**Désinstaller** : macOS `launchctl unload ~/Library/LaunchAgents/ai.odin.gateway.plist` · Linux `systemctl --user disable --now odin` · Windows `Unregister-ScheduledTask Odin` ; puis supprime `~/.odin` (et `~/.local/bin/odin` ou `%LOCALAPPDATA%\Odin`).
