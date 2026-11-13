// Odin OS — applis d'Odin (mode essai). Fichier généré par « npm run os:catalogue » : ne pas modifier à la main.
window.OS_CATALOGUE = [
 {
  "id": "saga",
  "name": "Saga",
  "family": "Données",
  "what": "Le Cerveau : tes notes reliées entre elles, avec le graphe des Nornes.",
  "does": [
   "notes en Markdown reliées par [[liens]]",
   "graphe des Nornes (comme Obsidian)",
   "recherche dans tout le Cerveau",
   "journal du jour, projets, captures",
   "ce qui demande ton attention (retards, échéances)"
  ],
  "actions": [
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Dans tout le Cerveau",
    "read": true,
    "grave": false
   },
   {
    "id": "noter",
    "label": "Noter",
    "what": "Nouvelle note",
    "read": false,
    "grave": false
   },
   {
    "id": "completer",
    "label": "Compléter une note",
    "what": "Ajoute du texte à la fin d'une note existante",
    "read": false,
    "grave": false
   },
   {
    "id": "fiches",
    "label": "Fiches des applis",
    "what": "Remet à jour les fiches d'Odin dans le Cerveau (une par appli, leurs liens, le mode de fonctionnement) ; tes notes y sont gardées",
    "read": false,
    "grave": false
   },
   {
    "id": "attention",
    "label": "À surveiller",
    "what": "Retards, échéances, projets à l'arrêt",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "runes",
  "name": "Runes",
  "family": "Données",
  "what": "Les pages et bases de données : tables, tableaux, calendriers, formules.",
  "does": [
   "bases avec propriétés typées (texte, nombre, statut, date, relation, formule…)",
   "vues table, tableau, calendrier, galerie, liste, chronologie, formulaire",
   "filtres, tris, groupes, agrégations",
   "sous-pages, historique, commentaires",
   "import et export CSV, automatisations de base"
  ],
  "actions": [
   {
    "id": "bases",
    "label": "Bases",
    "what": "Liste des bases",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Ajouter une fiche",
    "what": "Dans une base",
    "read": false,
    "grave": false
   },
   {
    "id": "client",
    "label": "Fiche client",
    "what": "Crée ou met à jour une fiche dans la base « Clients » (créée au besoin)",
    "read": false,
    "grave": false
   },
   {
    "id": "evolution",
    "label": "Noter une évolution",
    "what": "Fiche dans la base « Évolutions » (créée au besoin)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "draupnir",
  "name": "Draupnir",
  "family": "Données",
  "what": "Les automatisations : déclencheurs, étapes, et toutes les applis reliées.",
  "does": [
   "éditeur à nœuds (déclencheurs, logique, données, web, IA)",
   "planning, webhook, formulaire, flux, page surveillée, événements des applis",
   "actions de toutes les applis d'Odin (sauf les graves)",
   "création à partir d'une phrase (avec IA)",
   "modèles prêts, versions, historique des exécutions"
  ],
  "actions": [
   {
    "id": "lister",
    "label": "Automatisations",
    "what": "Liste",
    "read": true,
    "grave": false
   },
   {
    "id": "executer",
    "label": "Lancer",
    "what": "Lance une automatisation",
    "read": false,
    "grave": false
   },
   {
    "id": "modele",
    "label": "Ajouter un modèle",
    "what": "Modèle d'automatisation entre applis",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "eir",
  "name": "Eir",
  "family": "Machines",
  "what": "La santé de la machine en direct et dans le temps : processeur, mémoire, disques, réseau, capteurs, SMART, RAID, carte graphique, processus. Comme Glances, lisible d'un coup d'œil.",
  "does": [
   "processeur par cœur, attente disque, vol de temps (VM), charge 1 / 5 / 15 min",
   "mémoire, cache, échange (swap)",
   "réseau par carte : filaire, Wi-Fi (signal), VPN, débit et erreurs",
   "disques : place, débit lecture / écriture, occupation",
   "capteurs : températures (avec seuil critique), ventilateurs, batterie",
   "RAID logiciel (complet, dégradé, reconstruction)",
   "santé SMART des disques (secteurs réalloués, usure des SSD)",
   "carte graphique NVIDIA (charge, mémoire, température, watts)",
   "processus : tri par processeur ou mémoire, arrêt d'un processus avec ton accord",
   "personnes connectées, connexions réseau",
   "chaque mesure gardée : courbes 1 h, 24 h, 7 j, 30 j, 1 an",
   "seuils réglables : vert, bleu, orange, rouge (comme Glances)",
   "export pour Prometheus et Grafana",
   "alertes : disque plein, mémoire saturée, surchauffe, RAID dégradé, disque qui lâche"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État de la machine",
    "what": "Mesures du moment, avec leur niveau",
    "read": true,
    "grave": false
   },
   {
    "id": "processus",
    "label": "Processus",
    "what": "Les processus qui consomment le plus (processeur ou mémoire)",
    "read": true,
    "grave": false
   },
   {
    "id": "arreter_processus",
    "label": "Arrêter un processus",
    "what": "Demande poliment à un programme de s'arrêter (signal TERM)",
    "read": false,
    "grave": true
   },
   {
    "id": "mesures",
    "label": "Courbe d'une mesure",
    "what": "Les valeurs d'une mesure sur une période (1h, 24h, 7j, 30j, 1an)",
    "read": true,
    "grave": false
   },
   {
    "id": "seuils",
    "label": "Régler les seuils",
    "what": "À partir de quand une mesure passe en bleu, orange, rouge",
    "read": false,
    "grave": false
   },
   {
    "id": "exporter",
    "label": "Exporter pour Prometheus",
    "what": "Les dernières valeurs au format Prometheus (pour Grafana ou un autre outil)",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "skogul",
  "name": "Skögul",
  "family": "Sécurité",
  "what": "Surveille le comportement des programmes et signale ce qui n'est pas normal.",
  "does": [
   "programme lancé depuis /tmp ou /dev/shm",
   "programme effacé après son lancement",
   "shell ouvert par un serveur web (site piraté)",
   "mineurs de cryptomonnaie",
   "nouveau port ouvert sur la machine",
   "tâches planifiées modifiées",
   "arrêt d'un processus suspect (avec ton accord)"
  ],
  "actions": [
   {
    "id": "analyser",
    "label": "Analyser maintenant",
    "what": "Passe tous les programmes en revue",
    "read": true,
    "grave": false
   },
   {
    "id": "tuer",
    "label": "Arrêter un processus",
    "what": "Arrête un processus suspect",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "forseti",
  "name": "Forseti",
  "family": "Sécurité",
  "what": "Le centre de sécurité : toutes les alertes, la chasse aux menaces, les fichiers sensibles et la conformité.",
  "does": [
   "fil unique des alertes de tous les modules (gravité, module, recherche, « vu »)",
   "chasse (mode Vígríðr) : recherche dans les alertes, le journal des connexions et les journaux système",
   "surveillance des fichiers sensibles (comptes, sudo, SSH, clés autorisées…)",
   "contrôles de conformité avec un score",
   "expiration des certificats de tes sites",
   "envoie les alertes graves sur ta messagerie"
  ],
  "actions": [
   {
    "id": "alertes",
    "label": "Dernières alertes",
    "what": "Les alertes récentes, les plus graves d'abord",
    "read": true,
    "grave": false
   },
   {
    "id": "chercher",
    "label": "Chasser",
    "what": "Cherche dans les alertes, le journal des connexions et les journaux système",
    "read": true,
    "grave": false
   },
   {
    "id": "conformite",
    "label": "Contrôle de conformité",
    "what": "Score et points à corriger",
    "read": true,
    "grave": false
   },
   {
    "id": "vu",
    "label": "Marquer comme vu",
    "what": "Les alertes ne sont plus « nouvelles »",
    "read": false,
    "grave": false
   },
   {
    "id": "domaines",
    "label": "Sites à surveiller",
    "what": "Domaines dont surveiller le certificat",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "garmr",
  "name": "Garmr",
  "family": "Sécurité",
  "what": "Bannit au pare-feu ceux qui essaient d'entrer de force (SSH, sites, mail, Odin).",
  "does": [
   "lit les journaux SSH, web, mail et ceux d'Odin",
   "bannit après 5 échecs en 10 minutes (réglable)",
   "durée multipliée par 4 à chaque récidive",
   "liste blanche ; jamais le réseau local",
   "seule action de bannissement d'Odin, utilisée par Loki, Geri et Forseti"
  ],
  "actions": [
   {
    "id": "bannis",
    "label": "Bannis en ce moment",
    "what": "Adresses bannies et pour combien de temps",
    "read": true,
    "grave": false
   },
   {
    "id": "bannir",
    "label": "Bannir une adresse",
    "what": "Bloque une adresse au pare-feu",
    "read": false,
    "grave": false
   },
   {
    "id": "debannir",
    "label": "Débannir",
    "what": "Retire une adresse du pare-feu",
    "read": false,
    "grave": false
   },
   {
    "id": "ouvrir_port",
    "label": "Ouvrir un port",
    "what": "Sur la machine d'Odin (pare-feu), et sur la box si demandé (UPnP)",
    "read": false,
    "grave": false
   },
   {
    "id": "fermer_port",
    "label": "Fermer un port",
    "what": "Sur la machine d'Odin (et la box si Odin l'y avait ouvert)",
    "read": false,
    "grave": true
   },
   {
    "id": "ports_ouverts",
    "label": "Ports ouverts par Odin",
    "what": "Ce qu'Odin a ouvert, pour qui, et comment",
    "read": true,
    "grave": false
   },
   {
    "id": "journal",
    "label": "Surveiller un journal",
    "what": "Ajoute un fichier journal à lire (application, site…)",
    "read": false,
    "grave": false
   },
   {
    "id": "proteger",
    "label": "Protéger une adresse",
    "what": "Ajoute à la liste blanche (jamais bannie)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "geri",
  "name": "Geri",
  "family": "Sécurité",
  "what": "Surveille les connexions réseau de la machine : adresses malveillantes connues, ports de pirates, et journal de qui parle à qui.",
  "does": [
   "compare chaque connexion aux listes publiques d'adresses malveillantes (mises à jour chaque jour)",
   "repère les ports typiques des pirates (minage, portes dérobées, IRC)",
   "journal des connexions (mode Freki) : programme, destination, première et dernière fois",
   "bannit les adresses malveillantes via Garmr",
   "alerte quand un programme contacte une nouvelle destination à l'étranger la nuit"
  ],
  "actions": [
   {
    "id": "connexions",
    "label": "Connexions en cours",
    "what": "Qui parle à qui en ce moment",
    "read": true,
    "grave": false
   },
   {
    "id": "journal",
    "label": "Journal des connexions",
    "what": "Destinations vues récemment, par programme",
    "read": true,
    "grave": false
   },
   {
    "id": "listes",
    "label": "Mettre à jour les listes",
    "what": "Télécharge les listes d'adresses malveillantes",
    "read": false,
    "grave": false
   },
   {
    "id": "verifier",
    "label": "Vérifier une adresse",
    "what": "Est-elle dans les listes ?",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "ran",
  "name": "Rán",
  "family": "Sécurité",
  "what": "Les paquets réseau lus en entier et décodés couche par couche, comme Wireshark : la carte de qui parle à qui, chaque paquet en détail, et Odin qui explique.",
  "does": [
   "lit tous les paquets (tout le réseau ou une machine) et les décode couche par couche : liaison, réseau, transport, chiffrement, application",
   "reconnaît les applis et les sites : DNS, HTTP, HTTPS (nom du site), QUIC, DHCP, SSH, mDNS, UPnP, NTP…",
   "carte interactive : machines et sites d'Internet reliés par des flèches, de qui vers qui",
   "détail de chaque paquet : tous les champs et le contenu brut (hexadécimal) ; le contenu chiffré reste illisible",
   "pause et reprise de la lecture ; historique 7 jours ; Odin explique ce qui se passe"
  ],
  "actions": [
   {
    "id": "lire",
    "label": "Lire les paquets",
    "what": "Lit les paquets de tout le réseau (ou d'une machine) et les garde dans l'historique",
    "read": false,
    "grave": false
   },
   {
    "id": "pause",
    "label": "Pause",
    "what": "Arrête toute lecture de paquets (l'historique reste)",
    "read": false,
    "grave": false
   },
   {
    "id": "reprendre",
    "label": "Reprendre la lecture",
    "what": "Reprend la lecture des paquets après une pause",
    "read": false,
    "grave": false
   },
   {
    "id": "expliquer",
    "label": "Ce qui se passe",
    "what": "Résumé de qui parle à qui, applis et sites (tout le réseau ou une machine)",
    "read": true,
    "grave": false
   },
   {
    "id": "trafic",
    "label": "Trafic par appareil",
    "what": "Comme Sniffnet : ce que chaque appareil envoie et reçoit, ses applis, ses pays, sur la dernière heure",
    "read": true,
    "grave": false
   },
   {
    "id": "table_pays",
    "label": "Mettre à jour la table des pays",
    "what": "Télécharge la table « adresse → pays » (DB-IP, gratuite, CC BY 4.0) ; aucune adresse de ton réseau n'est envoyée",
    "read": false,
    "grave": false
   },
   {
    "id": "seuil",
    "label": "Alerte de débit",
    "what": "Prévenir quand le réseau dépasse un débit (Mo/s) ; 0 pour ne plus prévenir",
    "read": false,
    "grave": false
   },
   {
    "id": "paquet",
    "label": "Détail d'un paquet",
    "what": "Toutes les couches et le contenu d'un paquet, par son numéro",
    "read": true,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Ne plus suivre en continu",
    "what": "Retire une machine (ou tout le réseau) de la lecture continue ; l'historique reste",
    "read": false,
    "grave": false
   },
   {
    "id": "effacer",
    "label": "Effacer l'historique",
    "what": "Supprime les paquets gardés (tout le réseau ou une machine)",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "ullr",
  "name": "Ullr",
  "family": "Sécurité",
  "what": "L'antivirus d'Odin, fait maison : fichiers, archives, téléchargements, clés USB, sites web, liens et messages, relié à toutes les autres applis.",
  "does": [
   "empreintes de malwares connus et familles (MalwareBazaar, ThreatFox), mises à jour toutes les 6 heures",
   "règles : les tiennes (Galdr) et des règles YARA publiques importées, testées contre les fausses alertes",
   "heuristiques au score explicable : programme déguisé, macros, PDF piégé, raccourci, script dissimulé, vol d'identifiants, espion",
   "archives ouvertes (zip, gzip, tar, documents Office, APK), bombes de décompression repérées",
   "hameçonnage : pages, messages et adresses web (OpenPhish, URLhaus, imitation de marque, lien menteur)",
   "logiciels espions : applis de surveillance pour téléphone (Stalkerware Indicators)",
   "réputation d'une empreinte (VirusTotal, MalwareBazaar, CIRCL) sans jamais envoyer le fichier",
   "protection en continu : téléchargements, supports amovibles, fichiers sentinelles contre les rançongiciels",
   "analyses planifiées avec exclusions, ralenties si la machine est chargée, annulables",
   "incidents : relie les signaux de Skögul, Geri, Loki, Garmr, Forseti, Eir… et répond",
   "base de signatures signée, versionnée, testée avant activation, annulable",
   "quarantaine réversible, exceptions, fausses alertes, rapports horodatés",
   "failles réellement exploitées (CISA KEV) comparées aux logiciels installés"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État de la protection",
    "what": "En une phrase : es-tu protégé, y a-t-il quelque chose à regarder ?",
    "read": true,
    "grave": false
   },
   {
    "id": "analyser",
    "label": "Analyser",
    "what": "Analyse un dossier, un fichier ou un profil (téléchargements, sites web, maison, temporaire, tout)",
    "read": false,
    "grave": false
   },
   {
    "id": "fichier",
    "label": "Analyser un fichier",
    "what": "Un seul fichier, avec l'explication du verdict",
    "read": true,
    "grave": false
   },
   {
    "id": "adresse",
    "label": "Vérifier une adresse web",
    "what": "Un lien ou un nom de site est-il dangereux (malware, hameçonnage, espion) ?",
    "read": true,
    "grave": false
   },
   {
    "id": "message",
    "label": "Vérifier un message",
    "what": "Un e-mail (fichier .eml) ou un texte reçu : est-ce un hameçonnage ?",
    "read": true,
    "grave": false
   },
   {
    "id": "isoler",
    "label": "Mettre en quarantaine",
    "what": "Met un fichier à l'écart (réversible)",
    "read": false,
    "grave": false
   },
   {
    "id": "restaurer",
    "label": "Sortir de quarantaine",
    "what": "Remet le fichier à sa place",
    "read": false,
    "grave": true
   },
   {
    "id": "supprimer",
    "label": "Supprimer de la quarantaine",
    "what": "Efface définitivement un fichier isolé",
    "read": false,
    "grave": true
   },
   {
    "id": "quarantaine",
    "label": "Quarantaine",
    "what": "Fichiers isolés",
    "read": true,
    "grave": false
   },
   {
    "id": "mettre_a_jour",
    "label": "Mettre à jour les signatures",
    "what": "Interroge les sources, teste le résultat, puis active une nouvelle version signée",
    "read": false,
    "grave": false
   },
   {
    "id": "sources",
    "label": "Sources",
    "what": "D'où viennent les signatures : état, licence, dernière mise à jour",
    "read": true,
    "grave": false
   },
   {
    "id": "cles",
    "label": "Clés des sources",
    "what": "Range la clé gratuite d'abuse.ch (MalwareBazaar, ThreatFox, URLhaus) ou de VirusTotal avec les secrets d'Odin",
    "read": false,
    "grave": true
   },
   {
    "id": "source",
    "label": "Activer une source",
    "what": "Active ou désactive une source de signatures",
    "read": false,
    "grave": false
   },
   {
    "id": "versions",
    "label": "Versions des signatures",
    "what": "Historique des paquets (pour revenir en arrière)",
    "read": true,
    "grave": false
   },
   {
    "id": "revenir",
    "label": "Revenir à la version précédente",
    "what": "Annule la dernière mise à jour des signatures",
    "read": false,
    "grave": true
   },
   {
    "id": "regle",
    "label": "Ajouter une règle (Galdr)",
    "what": "Nouvelle règle de détection",
    "read": false,
    "grave": false
   },
   {
    "id": "importer",
    "label": "Importer des signatures",
    "what": "Fichier de règles YARA (.yar), d'empreintes (une par ligne) ou de signatures ClamAV (.hsb)",
    "read": false,
    "grave": false
   },
   {
    "id": "plan",
    "label": "Planifier une analyse",
    "what": "Analyse récurrente d'un dossier ou d'un profil",
    "read": false,
    "grave": false
   },
   {
    "id": "plans",
    "label": "Analyses planifiées",
    "what": "Ce qui est analysé tout seul, et quand",
    "read": true,
    "grave": false
   },
   {
    "id": "retirer_plan",
    "label": "Retirer une analyse planifiée",
    "what": "Supprime un plan",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêter l'analyse",
    "what": "Coupe l'analyse en cours (le rapport partiel est gardé)",
    "read": false,
    "grave": false
   },
   {
    "id": "rapport",
    "label": "Rapport d'analyse",
    "what": "Le dernier rapport (ou celui dont tu donnes l'identifiant)",
    "read": true,
    "grave": false
   },
   {
    "id": "rapports",
    "label": "Analyses faites",
    "what": "Les dernières analyses : quand, quoi, combien de fichiers, combien de détections",
    "read": true,
    "grave": false
   },
   {
    "id": "exception",
    "label": "Ajouter une exception",
    "what": "Un dossier, une empreinte ou une règle à ne plus signaler",
    "read": false,
    "grave": false
   },
   {
    "id": "exceptions",
    "label": "Exceptions",
    "what": "Ce qu'Ullr ne signale plus",
    "read": true,
    "grave": false
   },
   {
    "id": "retirer_exception",
    "label": "Retirer une exception",
    "what": "Ullr signale de nouveau ce dossier, cette empreinte ou cette règle",
    "read": false,
    "grave": false
   },
   {
    "id": "faux_positif",
    "label": "Signaler une fausse alerte",
    "what": "Le fichier est sain : il sort de quarantaine et son empreinte devient une exception",
    "read": false,
    "grave": true
   },
   {
    "id": "incidents",
    "label": "Incidents",
    "what": "Les attaques reconstituées à partir des signaux de toutes les applis",
    "read": true,
    "grave": false
   },
   {
    "id": "incident",
    "label": "Classer un incident",
    "what": "Marque un incident comme traité ou ignoré",
    "read": false,
    "grave": false
   },
   {
    "id": "reputation",
    "label": "Réputation d'une empreinte",
    "what": "Avis de VirusTotal, MalwareBazaar et CIRCL sur une empreinte (aucun fichier n'est envoyé)",
    "read": true,
    "grave": false
   },
   {
    "id": "failles",
    "label": "Failles exploitées",
    "what": "Les failles réellement utilisées par des attaquants, comparées aux logiciels installés ici",
    "read": true,
    "grave": false
   },
   {
    "id": "sentinelles",
    "label": "Poser des fichiers sentinelles",
    "what": "Deux faux documents dans un dossier : si quelque chose les chiffre ou les renomme, c'est un rançongiciel, et Odin alerte aussitôt",
    "read": false,
    "grave": false
   },
   {
    "id": "protection",
    "label": "Protection en continu",
    "what": "Analyse à l'arrivée (téléchargements, supports amovibles) et réponse automatique",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "loki",
  "name": "Loki",
  "family": "Sécurité",
  "what": "Pièges à pirates : de faux services qui attirent les attaquants, notent tout et les font bannir.",
  "does": [
   "Narfi — Telnet : faux terminal : identifiants et commandes des robots, téléchargements capturés",
   "Fenrir — SSH (enlisement) : retient les robots SSH des heures en leur envoyant une bannière sans fin",
   "Narfi-SSH — SSH (identification) : note la version et l'outil de chaque robot SSH",
   "Sköll — Web : faux site (WordPress, phpMyAdmin, .env) : chemins sondés et mots de passe essayés",
   "Hel — Elasticsearch : fausse base Elasticsearch ouverte",
   "Thrym — Redis : faux Redis sans mot de passe : commandes d'attaque notées",
   "Skrymir — Mail (SMTP) : faux relais de mail : identifiants et spams capturés",
   "Jörmungandr — FTP : faux FTP : identifiants et fichiers déposés capturés",
   "Muspel — Modbus (automates) : faux automate industriel",
   "Bergelmir — Android ADB : faux téléphone Android en débogage ouvert",
   "Logi — Téléphonie (SIP) : fausse centrale téléphonique : tentatives d'appels frauduleux",
   "Hræsvelg — Amplification (UDP) : repère les attaques par déni de service sans jamais répondre",
   "Surtr — Tous ports : piège à tout : note les premiers octets sur des ports choisis",
   "identifiants essayés, commandes, chemins sondés : tout est noté",
   "logiciels malveillants capturés et analysés par Ullr",
   "attaquant banni de tes vrais services par Garmr",
   "console centrale et statistiques (origine, protocoles, mots de passe les plus essayés)"
  ],
  "actions": [
   {
    "id": "allumer",
    "label": "Allumer un piège",
    "what": "Démarre un piège sur un port",
    "read": false,
    "grave": true
   },
   {
    "id": "eteindre",
    "label": "Éteindre un piège",
    "what": "Arrête un piège",
    "read": false,
    "grave": false
   },
   {
    "id": "activite",
    "label": "Activité des pièges",
    "what": "Ce que les pirates ont tenté",
    "read": true,
    "grave": false
   },
   {
    "id": "statistiques",
    "label": "Statistiques",
    "what": "Origines, mots de passe essayés, pièges les plus touchés",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "naglfar",
  "name": "Naglfar",
  "family": "Machines",
  "what": "Tes conteneurs, sur le moteur d'Odin (sans Docker ni Podman, sans démon) : lancer une appli depuis une image Docker, la suivre, l'arrêter, lire son journal, la mettre à jour.",
  "does": [
   "lancer une appli à partir d'une image Docker (Docker Hub, GHCR, Quay…)",
   "liste des conteneurs, démarrer, arrêter, redémarrer",
   "journal de chaque conteneur",
   "lancer une commande dedans",
   "mettre à jour l'image et relancer avec les mêmes réglages",
   "images présentes, nettoyage",
   "les commandes run, ps, stop, start, rm, logs, exec, pull, images aussi dans la discussion",
   "ports publiés, dossiers partagés, limites de mémoire et de processeur, relance automatique"
  ],
  "actions": [
   {
    "id": "lister",
    "label": "Lister les conteneurs",
    "what": "Tous les conteneurs et leur état",
    "read": true,
    "grave": false
   },
   {
    "id": "journaux",
    "label": "Journaux",
    "what": "Les 80 dernières lignes",
    "read": true,
    "grave": false
   },
   {
    "id": "demarrer",
    "label": "Démarrer",
    "what": "Démarre un conteneur",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêter",
    "what": "Arrête un conteneur",
    "read": false,
    "grave": false
   },
   {
    "id": "redemarrer",
    "label": "Redémarrer",
    "what": "Redémarre un conteneur",
    "read": false,
    "grave": false
   },
   {
    "id": "lancer",
    "label": "Lancer une appli",
    "what": "Récupère l'image si besoin, crée le conteneur et le démarre ; une appli qui a besoin d'une base la reçoit dans la base d'Odin",
    "read": false,
    "grave": true
   },
   {
    "id": "executer",
    "label": "Commande dans un conteneur",
    "what": "Lance une commande dans un conteneur en marche et montre sa réponse",
    "read": false,
    "grave": true
   },
   {
    "id": "mettre_a_jour",
    "label": "Mettre à jour l'image",
    "what": "Récupère la dernière image puis recrée le conteneur avec les mêmes réglages",
    "read": false,
    "grave": true
   },
   {
    "id": "supprimer",
    "label": "Supprimer un conteneur",
    "what": "Supprime un conteneur (ses dossiers partagés sont gardés)",
    "read": false,
    "grave": true
   },
   {
    "id": "images",
    "label": "Images",
    "what": "Les images présentes",
    "read": true,
    "grave": false
   },
   {
    "id": "tirer",
    "label": "Récupérer une image",
    "what": "Télécharge une image (vérifiée) sans rien lancer",
    "read": false,
    "grave": false
   },
   {
    "id": "supprimer_image",
    "label": "Supprimer une image",
    "what": "Supprime une image qui ne sert plus",
    "read": false,
    "grave": true
   },
   {
    "id": "nettoyer",
    "label": "Nettoyer",
    "what": "Supprime les images qu'aucun conteneur n'utilise",
    "read": false,
    "grave": true
   },
   {
    "id": "ports",
    "label": "Les ports des applis",
    "what": "Chaque appli et son port, au même endroit (Odin, ses services réseau, les applis installées)",
    "read": true,
    "grave": false
   },
   {
    "id": "services",
    "label": "Services mis à l'échelle",
    "what": "Les services en plusieurs copies : copies prêtes, visiteurs, pourquoi",
    "read": true,
    "grave": false
   },
   {
    "id": "creer_service",
    "label": "Créer un service mis à l'échelle",
    "what": "Une appli en plusieurs copies derrière un répartiteur : le moteur ajoute ou retire des copies selon les visiteurs, le processeur et la mémoire",
    "read": false,
    "grave": true
   },
   {
    "id": "regler_service",
    "label": "Régler la mise à l'échelle",
    "what": "Copies min / max, visiteurs par copie, processeur visé, part de la machine (pris en compte tout de suite)",
    "read": false,
    "grave": false
   },
   {
    "id": "demarrer_service",
    "label": "Démarrer un service",
    "what": "Relance un service et ses copies",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter_service",
    "label": "Arrêter un service",
    "what": "Laisse finir les visiteurs en cours puis arrête toutes les copies",
    "read": false,
    "grave": true
   },
   {
    "id": "supprimer_service",
    "label": "Supprimer un service",
    "what": "Arrête et supprime un service (l'image et les dossiers partagés restent)",
    "read": false,
    "grave": true
   },
   {
    "id": "grandir",
    "label": "Grandir tout seul",
    "what": "Un conteneur seul (une base de données) reçoit plus de mémoire et de processeur quand il en a besoin, sans arrêt, entre deux bornes",
    "read": false,
    "grave": false
   },
   {
    "id": "commande",
    "label": "Commande",
    "what": "Une commande comme dans un terminal : run, ps, stop, start, restart, rm, logs, exec, pull, images, rmi, inspect",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "urdr",
  "name": "Urðr",
  "family": "Données",
  "what": "Tes bases de données comme Supabase : créer une base PostgreSQL, relier les tiennes, parcourir et modifier les tables comme un tableur (Urðr Studio, comme Prisma Studio), SQL avec journal.",
  "does": [
   "créer une base PostgreSQL dans le moteur de conteneurs d'Odin (mot de passe généré, rangé dans le coffre)",
   "relier une base PostgreSQL ou un fichier SQLite existants",
   "tables, colonnes, clés et liens entre tables",
   "lignes avec filtres, tri et pages (Urðr Studio)",
   "modifier, ajouter ou supprimer une ligne avec ton accord",
   "SQL en lecture seule garantie par la base ; ce qui écrit demande ton accord et Skuld sauvegarde juste avant",
   "journal de toutes les requêtes"
  ],
  "actions": [
   {
    "id": "bases",
    "label": "Mes bases",
    "what": "La liste de tes bases",
    "read": true,
    "grave": false
   },
   {
    "id": "relier",
    "label": "Relier une base",
    "what": "Ajoute une base existante (essai de connexion avant) ; le mot de passe va dans le coffre",
    "read": false,
    "grave": false
   },
   {
    "id": "creer",
    "label": "Créer une base",
    "what": "Une nouvelle base dans LA base de données d'Odin (PostgreSQL, créée la première fois), avec son propre compte ; mot de passe dans le coffre ; sauvegarde chaque nuit par Skuld",
    "read": false,
    "grave": true
   },
   {
    "id": "acces",
    "label": "Accès d'une appli",
    "what": "Ce qu'une appli doit utiliser pour joindre sa base (le mot de passe reste dans le coffre)",
    "read": true,
    "grave": false
   },
   {
    "id": "oublier",
    "label": "Retirer de la liste",
    "what": "Retire une base de la liste d'Urðr (la base elle-même et ses données ne sont pas touchées)",
    "read": false,
    "grave": false
   },
   {
    "id": "ouvrir",
    "label": "Ouvrir",
    "what": "Ouvre une base (et une table) dans la page d'Urðr",
    "read": true,
    "grave": false
   },
   {
    "id": "tables",
    "label": "Tables",
    "what": "Les tables d'une base, leurs lignes et leurs liens",
    "read": true,
    "grave": false
   },
   {
    "id": "colonnes",
    "label": "Colonnes",
    "what": "Les colonnes d'une table (type, clé, lien)",
    "read": true,
    "grave": false
   },
   {
    "id": "lignes",
    "label": "Lignes",
    "what": "Les lignes d'une table, avec filtres, tri et pages",
    "read": true,
    "grave": false
   },
   {
    "id": "modifier",
    "label": "Modifier une ligne",
    "what": "Écrit les cases modifiées d'une ligne (repérée par sa clé)",
    "read": false,
    "grave": true
   },
   {
    "id": "ajouter_ligne",
    "label": "Ajouter une ligne",
    "what": "Ajoute une ligne (les cases vides prennent leur valeur par défaut)",
    "read": false,
    "grave": true
   },
   {
    "id": "supprimer_ligne",
    "label": "Supprimer une ligne",
    "what": "Supprime une ligne (repérée par sa clé) ; Skuld sauvegarde la base juste avant",
    "read": false,
    "grave": true
   },
   {
    "id": "sql",
    "label": "Lancer du SQL",
    "what": "Une instruction SQL : une lecture passe tout de suite (la base refuse d'écrire) ; ce qui modifie demande ton accord, avec une sauvegarde Skuld juste avant",
    "read": false,
    "grave": true
   },
   {
    "id": "journal",
    "label": "Journal des requêtes",
    "what": "Les dernières requêtes lancées",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "skuld",
  "name": "Skuld",
  "family": "Données",
  "what": "La sauvegarde de tes bases de données (comme Portabase) : plans, durée de garde, chaque sauvegarde relue, restauration avec ton accord.",
  "does": [
   "PostgreSQL (pg_dump, dans le conteneur pour une base hébergée par Odin), SQLite (copie à chaud), MySQL / MariaDB (mysqldump), MongoDB (mongodump)",
   "plans : chaque heure, toutes les 6 h, chaque nuit, chaque semaine",
   "durée de garde : jours, puis une par semaine, puis une par mois",
   "chaque sauvegarde est relue (base rouverte ou archive listée)",
   "restaurer dans une nouvelle base à côté (conseillé) ou par-dessus, toujours avec ton accord",
   "sauvegarde automatique avant toute requête Urðr qui modifie une base",
   "alerte si une sauvegarde échoue"
  ],
  "actions": [
   {
    "id": "sauvegarder",
    "label": "Sauvegarder maintenant",
    "what": "Sauvegarde une base tout de suite et relit la sauvegarde",
    "read": false,
    "grave": false
   },
   {
    "id": "plan",
    "label": "Planifier",
    "what": "Sauvegardes automatiques d'une base et durée de garde",
    "read": false,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Les dernières sauvegardes",
    "read": true,
    "grave": false
   },
   {
    "id": "archives",
    "label": "Sauvegardes gardées",
    "what": "Les sauvegardes encore présentes d'une base",
    "read": true,
    "grave": false
   },
   {
    "id": "restaurer",
    "label": "Restaurer",
    "what": "Restaure une sauvegarde : dans une nouvelle base à côté (conseillé) ou par-dessus (une sauvegarde de l'état actuel est faite avant)",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "rodd",
  "name": "Rödd",
  "family": "Données",
  "what": "La dictée vocale partout (comme Murmure) : tu parles, le texte s'écrit, corrigé si tu veux, avec tes mots ; « Odin, … » devient une demande.",
  "does": [
   "dictée 100 % locale (Whisper sur la machine d'Odin)",
   "mise en forme : tel quel, corrigé, mail, traduction, liste (IA d'Odin ; sans IA : ponctuation de base)",
   "tes mots : ce que tu dis → ce qu'il faut écrire, appris aussi de tes corrections, partagés avec tout ce que tu dis à Odin",
   "« Odin, … » en dictée = une demande (les actions graves gardent ton accord)",
   "historique des dictées (désactivable)"
  ],
  "actions": [
   {
    "id": "dicter",
    "label": "Mettre en forme une dictée",
    "what": "Un texte dicté (déjà transcrit) : tes mots, puis la mise en forme choisie ; « Odin, … » part à Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "mots",
    "label": "Mes mots",
    "what": "Ce que tu dis → ce qu'Odin doit écrire",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter_mot",
    "label": "Ajouter un mot",
    "what": "Un mot à bien écrire, et comment il est souvent entendu",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_mot",
    "label": "Retirer un mot",
    "what": "Retire un mot de ta liste",
    "read": false,
    "grave": false
   },
   {
    "id": "apprendre",
    "label": "Apprendre d'une correction",
    "what": "Tu as corrigé une dictée : les mots changés sont appris",
    "read": false,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Dernières dictées",
    "what": "Les dernières dictées et demandes",
    "read": true,
    "grave": false
   },
   {
    "id": "regler",
    "label": "Régler",
    "what": "Mise en forme par défaut, historique gardé ou non",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "svalinn",
  "name": "Svalinn",
  "family": "Sécurité",
  "what": "Le Wi-Fi de la maison : sa note de sécurité et ce qu'il faut corriger, les réseaux et canaux autour, qui est connecté, le débit, le Wi-Fi invités, et la box (Livebox pilotée, les autres guidées). Rien ne change sans ton accord.",
  "does": [
   "note du Wi-Fi sur 100 et corrections, le plus urgent d'abord (WPS, chiffrement, mot de passe d'origine, accès à distance, UPnP, canal encombré)",
   "réseaux voisins et meilleur canal (carte Wi-Fi de la machine d'Odin)",
   "appareils connectés et leur nombre sur 24 h",
   "test de débit",
   "Wi-Fi invités avec QR code",
   "Livebox : lecture et changements avec ton accord, sauvegarde avant, retour automatique si le Wi-Fi ne revient pas",
   "autres box : Odin te guide écran par écran ; il ne force jamais l'accès"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "Analyser le Wi-Fi",
    "what": "Relit le Wi-Fi autour, la box et l'UPnP, puis donne la note et ce qu'il faut corriger",
    "read": true,
    "grave": false
   },
   {
    "id": "relier_box",
    "label": "Relier la box",
    "what": "L'adresse de la box et son mot de passe d'administration (rangé dans le coffre, jamais affiché)",
    "read": false,
    "grave": false
   },
   {
    "id": "corriger",
    "label": "Corriger",
    "what": "Applique une correction proposée (la box est sauvegardée avant ; retour automatique si le Wi-Fi ne revient pas)",
    "read": false,
    "grave": true
   },
   {
    "id": "tout_corriger",
    "label": "Tout corriger avec Odin",
    "what": "Applique toutes les corrections proposées, une par une, avec une seule sauvegarde avant",
    "read": false,
    "grave": true
   },
   {
    "id": "annuler",
    "label": "Revenir en arrière",
    "what": "Remet le dernier réglage changé par Svalinn",
    "read": false,
    "grave": true
   },
   {
    "id": "invites",
    "label": "Wi-Fi invités",
    "what": "Allume ou coupe le Wi-Fi invités (Internet seulement : ni tes PC, ni tes caméras)",
    "read": false,
    "grave": true
   },
   {
    "id": "qr_invites",
    "label": "QR code invités",
    "what": "Le QR code du Wi-Fi invités, à montrer à tes visiteurs",
    "read": true,
    "grave": false
   },
   {
    "id": "appareils",
    "label": "Qui est connecté ?",
    "what": "Les appareils connectés à la maison",
    "read": true,
    "grave": false
   },
   {
    "id": "tester_debit",
    "label": "Tester le débit",
    "what": "Télécharge 25 Mo depuis un serveur de test (Cloudflare) et mesure la vitesse",
    "read": true,
    "grave": false
   },
   {
    "id": "regler",
    "label": "Régler",
    "what": "Wi-Fi invités (nom, mot de passe), retour automatique, ce que tu sais de ta box",
    "read": false,
    "grave": false
   },
   {
    "id": "resume",
    "label": "Résumé",
    "what": "Le dernier état connu (sans relire la box), pour la page de Svalinn",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "ymir",
  "name": "Ymir",
  "family": "Machines",
  "what": "Tes machines virtuelles et conteneurs, sur tous tes serveurs de virtualisation.",
  "does": [
   "tous les serveurs réunis (mode Asgard) : nœuds, machines, conteneurs",
   "processeur, mémoire, disque de chaque machine",
   "démarrer, arrêt propre, arrêt forcé, redémarrer",
   "instantanés et retour en arrière (avec ton accord)",
   "sauvegarde d'une machine (Sindri, mode Andvari)",
   "alerte si une machine s'arrête ou si un nœud sature"
  ],
  "actions": [
   {
    "id": "parc",
    "label": "Toutes mes machines",
    "what": "Ordinateurs installés par le réseau, VM, LXC et conteneurs Docker, avec leur nom automatique",
    "read": true,
    "grave": false
   },
   {
    "id": "installer_docker",
    "label": "Installer un conteneur",
    "what": "Sur le moteur d'Odin (sans Docker ni démon) : image téléchargée et vérifiée, dossiers créés, ports libres choisis, démarrage, santé vérifiée, suivi branché",
    "read": false,
    "grave": true
   },
   {
    "id": "machines",
    "label": "Machines virtuelles",
    "what": "Toutes les machines et leur état",
    "read": true,
    "grave": false
   },
   {
    "id": "demarrer",
    "label": "Démarrer",
    "what": "Démarre une machine",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêt propre",
    "what": "Éteint proprement une machine",
    "read": false,
    "grave": true
   },
   {
    "id": "redemarrer",
    "label": "Redémarrer",
    "what": "Redémarre une machine",
    "read": false,
    "grave": true
   },
   {
    "id": "instantane",
    "label": "Instantané",
    "what": "Photo de la machine à cet instant",
    "read": false,
    "grave": false
   },
   {
    "id": "revenir",
    "label": "Revenir à un instantané",
    "what": "Remet la machine dans l'état de l'instantané",
    "read": false,
    "grave": true
   },
   {
    "id": "serveur",
    "label": "Ajouter un serveur",
    "what": "Relier un serveur de virtualisation (jeton d'API dans le coffre)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "idunn",
  "name": "Idunn",
  "family": "Machines",
  "what": "Tes sites web : Odin les surveille, les essaie, les relance et les met à jour, sans IA.",
  "does": [
   "surveille chaque site : disponibilité, lenteur, certificat HTTPS, titre et contenu",
   "journal de tout ce qui se passe : envois de code, tests, demandes de fusion (GitHub), déploiements (Vercel), zone et DNS (Cloudflare)",
   "événements filtrables en français : « les erreurs du site … depuis 2 jours »",
   "essais du site : pages, liens, erreurs affichées, en-têtes de sécurité",
   "relancer, déployer, revenir en arrière, remettre en ligne (Vercel)",
   "mises à jour de sécurité : les activer, les lister, fusionner celles dont les tests passent (GitHub)",
   "créer un projet (dépôt GitHub et projet Vercel reliés)",
   "vider le cache et mode « attaque » (Cloudflare)",
   "bilan : ce qu'il faut garder, améliorer, ne pas garder",
   "avec une IA : faire évoluer le code sur une branche « odin/… », avec une demande de fusion et des garde-fous",
   "les jetons d'accès restent dans le coffre ; ce qui touche la production demande ton accord"
  ],
  "actions": [
   {
    "id": "sites",
    "label": "Mes sites",
    "what": "Les sites suivis et leur état",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Surveiller un site",
    "what": "Ajoute un site à la veille (ou complète un site déjà suivi) ; le dépôt GitHub, le projet Vercel et la zone Cloudflare sont facultatifs",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Ne plus surveiller",
    "what": "Retire un site de la veille (son journal est gardé)",
    "read": false,
    "grave": false
   },
   {
    "id": "acces",
    "label": "Accès",
    "what": "Range les jetons GitHub, Vercel et Cloudflare avec les secrets d'Odin, puis vérifie chacun",
    "read": false,
    "grave": true
   },
   {
    "id": "etat",
    "label": "État d'un site",
    "what": "Vérifie le site maintenant et résume ce qui s'est passé depuis 24 heures",
    "read": true,
    "grave": false
   },
   {
    "id": "evenements",
    "label": "Événements",
    "what": "Tout ce qui s'est passé, filtré comme tu le dis : par site, par genre, par gravité, par période, par mot",
    "read": true,
    "grave": false
   },
   {
    "id": "tester",
    "label": "Essayer le site",
    "what": "Chaque page répond, a un titre, n'affiche pas d'erreur ; liens de l'accueil ; en-têtes de sécurité",
    "read": false,
    "grave": false
   },
   {
    "id": "deploiements",
    "label": "Déploiements",
    "what": "Les derniers déploiements du site (Vercel)",
    "read": true,
    "grave": false
   },
   {
    "id": "relancer",
    "label": "Relancer le site",
    "what": "Reconstruit et remet en ligne la version actuellement en production (même code)",
    "read": false,
    "grave": false
   },
   {
    "id": "deployer",
    "label": "Déployer le dernier code",
    "what": "Met en production le dernier code de la branche de production",
    "read": false,
    "grave": true
   },
   {
    "id": "revenir",
    "label": "Revenir en arrière",
    "what": "Remet en production le déploiement précédent (ou celui que tu indiques), sans rien reconstruire",
    "read": false,
    "grave": true
   },
   {
    "id": "promouvoir",
    "label": "Remettre en ligne un déploiement",
    "what": "Fait servir la production par un déploiement déjà construit (le plus récent, ou celui que tu indiques), et reprend les mises en ligne automatiques après un retour en arrière",
    "read": false,
    "grave": true
   },
   {
    "id": "mises_a_jour",
    "label": "Mises à jour",
    "what": "Les mises à jour proposées (Dependabot, Renovate) et l'état de leurs tests",
    "read": true,
    "grave": false
   },
   {
    "id": "activer_mises_a_jour",
    "label": "Activer les mises à jour de sécurité",
    "what": "Demande à GitHub de surveiller les dépendances et de proposer leurs correctifs (Dependabot)",
    "read": false,
    "grave": false
   },
   {
    "id": "couper_mises_a_jour",
    "label": "Couper les mises à jour de sécurité",
    "what": "GitHub ne propose plus les correctifs automatiques (les alertes restent)",
    "read": false,
    "grave": false
   },
   {
    "id": "fusionner",
    "label": "Fusionner une mise à jour",
    "what": "Applique une demande de fusion, seulement si tous ses tests passent",
    "read": false,
    "grave": true
   },
   {
    "id": "relancer_tests",
    "label": "Relancer les tests en échec",
    "what": "Rejoue les étapes en échec de la dernière série de tests (GitHub Actions)",
    "read": false,
    "grave": false
   },
   {
    "id": "creer_projet",
    "label": "Créer un projet",
    "what": "Nouveau dépôt GitHub (depuis un modèle si tu en donnes un) et projet Vercel relié",
    "read": false,
    "grave": true
   },
   {
    "id": "vider_cache",
    "label": "Vider le cache",
    "what": "Demande à Cloudflare d'oublier ses copies du site (les visiteurs voient la dernière version)",
    "read": false,
    "grave": false
   },
   {
    "id": "mode_attaque",
    "label": "Mode « attaque »",
    "what": "Cloudflare vérifie chaque visiteur avant de le laisser passer (à activer pendant une attaque, à retirer ensuite)",
    "read": false,
    "grave": false
   },
   {
    "id": "bilan",
    "label": "Bilan du site",
    "what": "Ce qu'il faut garder, améliorer, ne pas garder (faits vérifiés ; avec une IA, un avis en plus)",
    "read": true,
    "grave": false
   },
   {
    "id": "recoder",
    "label": "Faire évoluer le site (avec l'IA)",
    "what": "Sans fichier : un plan (ce qui est gardé, changé, retiré). Avec un fichier : l'IA le modifie sur une branche « odin/… » et ouvre une demande de fusion. Jamais sur la branche principale",
    "read": false,
    "grave": false
   },
   {
    "id": "abandonner",
    "label": "Abandonner une proposition",
    "what": "Supprime une branche « odin/… » (sa demande de fusion se ferme). Aucune autre branche ne peut être supprimée ici",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "sindri",
  "name": "Sindri",
  "family": "Machines",
  "what": "Les sauvegardes : chiffrées, dédupliquées, planifiées, vérifiées, et la restauration d'un fichier ou de tout.",
  "does": [
   "sauvegarde chiffrée (AES-256) avant d'écrire quoi que ce soit",
   "déduplication : un morceau identique n'est stocké qu'une fois",
   "plans planifiés (heure par jour) avec rétention (derniers, jours, semaines, mois)",
   "dépôts sur disque USB, partage réseau ou serveur monté",
   "restauration d'un fichier, d'un dossier ou de tout",
   "vérification de l'intégrité chaque semaine",
   "mode Hvergelmir : partages des PC du foyer",
   "mode Andvari : exports de machines virtuelles",
   "alerte si une sauvegarde échoue ou prend du retard"
  ],
  "actions": [
   {
    "id": "plans",
    "label": "Plans de sauvegarde",
    "what": "Ce qui est sauvegardé, où et quand",
    "read": true,
    "grave": false
   },
   {
    "id": "creer",
    "label": "Nouveau plan",
    "what": "Quoi, où, quand",
    "read": false,
    "grave": false
   },
   {
    "id": "machines",
    "label": "Machines virtuelles du plan (Andvari)",
    "what": "Avant chaque sauvegarde de ce plan, Ymir prend un instantané de ces machines virtuelles",
    "read": false,
    "grave": false
   },
   {
    "id": "sauvegarder",
    "label": "Sauvegarder maintenant",
    "what": "Lance un plan tout de suite",
    "read": false,
    "grave": false
   },
   {
    "id": "instantanes",
    "label": "Instantanés",
    "what": "Les versions disponibles d'un plan",
    "read": true,
    "grave": false
   },
   {
    "id": "chercher",
    "label": "Chercher un fichier",
    "what": "Dans quelles versions se trouve un fichier",
    "read": true,
    "grave": false
   },
   {
    "id": "restaurer",
    "label": "Restaurer",
    "what": "Remet des fichiers d'un instantané dans un dossier (jamais par-dessus sans ton accord)",
    "read": false,
    "grave": true
   },
   {
    "id": "verifier",
    "label": "Vérifier",
    "what": "Relit et déchiffre le dernier instantané de chaque plan",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "brisingamen",
  "name": "Brísingamen",
  "family": "Accès",
  "what": "Le coffre de mots de passe de la famille et de l'entreprise, avec codes à deux facteurs.",
  "does": [
   "identifiants, cartes et notes sécurisées, rangés par coffre (Famille, TOUFATECH, Clients)",
   "codes à deux facteurs (TOTP) intégrés",
   "générateur de mots de passe et de phrases de passe",
   "bilan : mots de passe trouvés dans des fuites, réutilisés, trop faibles",
   "historique des anciens mots de passe",
   "chiffré avec une clé du coffre d'Odin ; jamais affiché dans une conversation"
  ],
  "actions": [
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Trouve un élément (le mot de passe n'est jamais affiché ici)",
    "read": true,
    "grave": false
   },
   {
    "id": "generer",
    "label": "Générer un mot de passe",
    "what": "Mot de passe ou phrase de passe solide",
    "read": false,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Ajouter",
    "what": "Nouvel élément",
    "read": false,
    "grave": false
   },
   {
    "id": "bilan",
    "label": "Bilan de sécurité",
    "what": "Fuites, réutilisés, faibles",
    "read": true,
    "grave": false
   },
   {
    "id": "fuites",
    "label": "Vérifier les fuites",
    "what": "Compare à la base publique des mots de passe volés (seuls 5 caractères d'empreinte partent)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "gjoll",
  "name": "Gjöll",
  "family": "Accès",
  "what": "Le VPN de la maison : tes appareils se connectent chez toi de n'importe où, chiffré, avec un QR code.",
  "does": [
   "clés générées par Odin (jamais réutilisées)",
   "un appareil = une config + un QR code à scanner",
   "tout le trafic par la maison, ou seulement le réseau de la maison",
   "mode Gleipnir : réseau maillé, les appareils se parlent directement",
   "activer, désactiver, révoquer, renommer un appareil",
   "date de fin d'accès : coupé tout seul le jour venu",
   "qui est connecté, trafic reçu et envoyé, dernière connexion",
   "fichier .conf à télécharger pour un ordinateur",
   "moteur VPN écrit dans Odin (Gjallarbrú) : rien à installer ; les téléphones et ordinateurs se connectent avec l'appli VPN gratuite « WireGuard »",
   "assistant de mise en route : adresse, port de la box, essai depuis dehors",
   "réglages du tunnel : port, MTU, maintien de connexion",
   "chaque appareil peut passer par le DNS d'Odin (Víðarr) : pubs et sites dangereux bloqués aussi hors de la maison",
   "alerte quand un appareil se connecte"
  ],
  "actions": [
   {
    "id": "trafic",
    "label": "Trafic du VPN",
    "what": "Tout ce qui est passé dans le tunnel : par appareil, vers où, quel service, combien (en direct ou un jour passé)",
    "read": true,
    "grave": false
   },
   {
    "id": "ouvrir_port",
    "label": "Ouvrir le port du VPN sur la box",
    "what": "Odin ouvre lui-même le port du VPN sur la box (UPnP). Par ce seul port : Odin, son DNS (pubs bloquées), la maison et Internet par la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "fermer_port",
    "label": "Fermer le port du VPN sur la box",
    "what": "Le VPN ne sera plus joignable depuis Internet",
    "read": false,
    "grave": true
   },
   {
    "id": "ports_box",
    "label": "Ports ouverts sur la box",
    "what": "La liste des ports ouverts sur la box (par Odin ou d'autres appareils)",
    "read": true,
    "grave": false
   },
   {
    "id": "detecter",
    "label": "Trouver mon adresse publique",
    "what": "Demande ton adresse Internet (service ipify) et la garde comme adresse de la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "port",
    "label": "Port ouvert sur la box",
    "what": "Note que la redirection du port est faite sur la box",
    "read": false,
    "grave": false
   },
   {
    "id": "allumer",
    "label": "Allumer le tunnel",
    "what": "Démarre le VPN (et au démarrage de la machine)",
    "read": false,
    "grave": true
   },
   {
    "id": "eteindre",
    "label": "Éteindre le tunnel",
    "what": "Coupe le VPN pour tous les appareils",
    "read": false,
    "grave": true
   },
   {
    "id": "appareils",
    "label": "Appareils VPN",
    "what": "Liste et état",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Ajouter un appareil",
    "what": "Nouvelle config + QR code",
    "read": false,
    "grave": true
   },
   {
    "id": "qr",
    "label": "QR code",
    "what": "QR code de configuration (à scanner)",
    "read": true,
    "grave": false
   },
   {
    "id": "telecharger",
    "label": "Fichier de configuration",
    "what": "Le fichier .conf d'un appareil (pour un ordinateur)",
    "read": true,
    "grave": false
   },
   {
    "id": "modifier",
    "label": "Modifier un appareil",
    "what": "Nom, tout le trafic ou maison seulement, maillage, date de fin d'accès",
    "read": false,
    "grave": false
   },
   {
    "id": "serveur",
    "label": "Réglages du tunnel",
    "what": "Port, taille des paquets (MTU), maintien de la connexion",
    "read": false,
    "grave": true
   },
   {
    "id": "activer",
    "label": "Activer / désactiver",
    "what": "Coupe ou rouvre l'accès d'un appareil",
    "read": false,
    "grave": false
   },
   {
    "id": "revoquer",
    "label": "Révoquer",
    "what": "Supprime définitivement l'accès d'un appareil",
    "read": false,
    "grave": true
   },
   {
    "id": "adresse",
    "label": "Adresse publique",
    "what": "Adresse ou domaine par lequel on joint la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "reseaux",
    "label": "Réseaux de la maison",
    "what": "Réseaux ouverts aux appareils du VPN, et DNS donné aux appareils",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "vidarr",
  "name": "Víðarr",
  "family": "Accès",
  "what": "Le serveur DNS d'Odin : bloque pubs, pisteurs et sites dangereux pour toute la maison, coupe des services, donne des noms à tes machines, et garde le journal de qui demande quoi.",
  "does": [
   "serveur DNS écrit dans Odin (UDP et TCP), rien à installer",
   "listes de blocage (pubs, pisteurs, sites dangereux, contrôle parental), mises à jour chaque jour",
   "règles perso : bloquer, autoriser, expressions, jokers, réécritures",
   "alias vérifiés : un pisteur caché derrière un nom propre est bloqué quand même",
   "services coupés d'un clic (TikTok, YouTube, jeux…), pour tous ou par appareil",
   "recherche sécurisée (Google, YouTube, Bing, DuckDuckGo, Qwant, Ecosia)",
   "réglages par appareil : filtrage, contrôle parental, services, serveurs amont, liste autorisée",
   "noms de la maison (nas.maison → 192.168.1.10), noms privés jamais envoyés sur Internet",
   "réponses chiffrées (HTTPS, TLS), ou résolution autonome depuis la racine d'Internet",
   "cache avec réponses servies même expirées pendant le rafraîchissement",
   "journal des requêtes (qui, quoi, résultat, temps), statistiques, pause du blocage",
   "limite de requêtes par machine, requêtes ANY refusées",
   "pubs et pistage de YouTube, TikTok, Instagram, Snapchat, X, télés et téléphones bloqués sans toucher aux vidéos",
   "horaires : services coupés seulement à certaines heures, pour la maison ou un appareil",
   "zone de la maison : A, AAAA, CNAME, MX, TXT, SRV",
   "serveur DHCP : adresses, passerelle, DNS, adresses fixes, noms des appareils servis par le DNS, vérification qu'aucun autre DHCP ne répond",
   "DNS chiffré pour les appareils : HTTPS (/dns-query) et TLS (port 853)",
   "surveillance : alerte si Internet ou les serveurs amont ne répondent plus, nouvel appareil sur le réseau",
   "alerte quand un appareil demande un site dangereux ; lien avec le VPN Gjöll"
  ],
  "actions": [
   {
    "id": "demarrer",
    "label": "Démarrer le DNS",
    "what": "Víðarr répond aux appareils (port 53)",
    "read": false,
    "grave": true
   },
   {
    "id": "arreter",
    "label": "Arrêter le DNS",
    "what": "Les appareils ne peuvent plus résoudre par Víðarr",
    "read": false,
    "grave": true
   },
   {
    "id": "etat",
    "label": "État",
    "what": "En marche, chiffres du jour",
    "read": true,
    "grave": false
   },
   {
    "id": "tester",
    "label": "Tester un domaine",
    "what": "Dit si un domaine est bloqué, pourquoi, et ce qu'il répond",
    "read": true,
    "grave": false
   },
   {
    "id": "bloquer",
    "label": "Bloquer un domaine",
    "what": "Bloque le domaine et ses sous-domaines",
    "read": false,
    "grave": false
   },
   {
    "id": "autoriser",
    "label": "Autoriser un domaine",
    "what": "Laisse passer un domaine bloqué par une liste",
    "read": false,
    "grave": false
   },
   {
    "id": "regle",
    "label": "Ajouter une règle",
    "what": "Règle perso (« ||pub.fr^ », « @@||ok.fr^ », « /^ads[0-9]+\\./ », « *.exemple.fr »)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_regle",
    "label": "Retirer une règle",
    "what": "Retire une règle perso",
    "read": false,
    "grave": false
   },
   {
    "id": "listes",
    "label": "Listes",
    "what": "Listes de blocage et leur état",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter_liste",
    "label": "Ajouter une liste",
    "what": "Une liste de blocage par son adresse web",
    "read": false,
    "grave": false
   },
   {
    "id": "activer_liste",
    "label": "Activer / couper une liste",
    "what": "Sans la supprimer",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_liste",
    "label": "Retirer une liste",
    "what": "Supprime une liste",
    "read": false,
    "grave": false
   },
   {
    "id": "mettre_a_jour",
    "label": "Mettre à jour les listes",
    "what": "Télécharge la dernière version de chaque liste active",
    "read": false,
    "grave": false
   },
   {
    "id": "services",
    "label": "Couper un service",
    "what": "TikTok, YouTube, jeux… pour toute la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "appareil",
    "label": "Réglages d'un appareil",
    "what": "Filtrage, contrôle parental, services, serveurs amont pour un appareil",
    "read": false,
    "grave": false
   },
   {
    "id": "couper_machine",
    "label": "Couper une machine d'Internet",
    "what": "Plus aucun site ne lui répond (tout de suite, ou à des horaires) ; le réseau de la maison reste joignable",
    "read": false,
    "grave": false
   },
   {
    "id": "couper_video",
    "label": "Couper la vidéo d'un appareil",
    "what": "YouTube, Netflix, Twitch, TikTok, Prime Video et Disney+ ne répondent plus à cet appareil (le reste d'Internet marche)",
    "read": false,
    "grave": false
   },
   {
    "id": "retablir_machine",
    "label": "Rétablir une machine",
    "what": "Elle retrouve Internet",
    "read": false,
    "grave": false
   },
   {
    "id": "bloquer_horaires",
    "label": "Bloquer un site à des horaires",
    "what": "Ex. jeux.fr bloqué de 21:00 à 07:00, pour tous ou un appareil",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_horaire",
    "label": "Retirer un blocage à horaires",
    "what": "Le site redevient libre",
    "read": false,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique du réseau",
    "what": "Ce qui s'est passé un jour, un mois ou une année",
    "read": true,
    "grave": false
   },
   {
    "id": "retirer_appareil",
    "label": "Retirer un appareil",
    "what": "Ses réglages propres sont oubliés",
    "read": false,
    "grave": false
   },
   {
    "id": "nom_local",
    "label": "Nom de la maison",
    "what": "Un nom pour une machine (nas.maison → 192.168.1.10), ou un alias",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_nom",
    "label": "Retirer un nom",
    "what": "Retire un nom de la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "pubs_reseaux",
    "label": "Pubs des réseaux et plateformes",
    "what": "Bloque la pub et le pistage de YouTube, TikTok, Instagram… sans toucher aux vidéos",
    "read": false,
    "grave": false
   },
   {
    "id": "horaires",
    "label": "Horaires des services coupés",
    "what": "Couper les services seulement à certaines heures (ex. TikTok après 21 h)",
    "read": false,
    "grave": false
   },
   {
    "id": "dhcp_chercher",
    "label": "Chercher un autre DHCP",
    "what": "Y a-t-il déjà un serveur qui donne les adresses (la box) ?",
    "read": true,
    "grave": false
   },
   {
    "id": "dhcp_reglages",
    "label": "Réglages DHCP",
    "what": "Plage d'adresses, passerelle, DNS, durée des baux, domaine",
    "read": false,
    "grave": false
   },
   {
    "id": "dhcp_demarrer",
    "label": "Allumer le DHCP",
    "what": "Odin donne les adresses aux appareils (coupe d'abord celui de la box)",
    "read": false,
    "grave": true
   },
   {
    "id": "dhcp_arreter",
    "label": "Arrêter le DHCP",
    "what": "Odin ne donne plus d'adresses (rallume celui de la box)",
    "read": false,
    "grave": true
   },
   {
    "id": "dhcp_fixe",
    "label": "Adresse fixe",
    "what": "Toujours la même adresse (et un nom) pour un appareil",
    "read": false,
    "grave": false
   },
   {
    "id": "dhcp_retirer_fixe",
    "label": "Retirer une adresse fixe",
    "what": "L'appareil reprend une adresse de la plage",
    "read": false,
    "grave": false
   },
   {
    "id": "baux",
    "label": "Appareils du réseau (baux)",
    "what": "Qui a reçu quelle adresse",
    "read": true,
    "grave": false
   },
   {
    "id": "dns_chiffre",
    "label": "DNS chiffré (TLS)",
    "what": "Les appareils qui le savent (Android « DNS privé ») chiffrent leurs questions jusqu'à Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "pause",
    "label": "Pause du blocage",
    "what": "Laisse tout passer quelques minutes (les sites dangereux restent bloqués)",
    "read": false,
    "grave": false
   },
   {
    "id": "reprendre",
    "label": "Reprendre le blocage",
    "what": "Fin de la pause",
    "read": false,
    "grave": false
   },
   {
    "id": "reglages",
    "label": "Réglages DNS",
    "what": "Serveurs amont, stratégie, façon de bloquer, recherche sécurisée, contrôle parental",
    "read": false,
    "grave": false
   },
   {
    "id": "vider_cache",
    "label": "Vider le cache",
    "what": "Oublie les réponses gardées",
    "read": false,
    "grave": false
   },
   {
    "id": "journal",
    "label": "Journal des requêtes",
    "what": "Les dernières requêtes, filtrées",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "vordr",
  "name": "Vörðr",
  "family": "Machines",
  "what": "La télésurveillance : sites, machines, ports, DNS, certificats, programmes et applis d'Odin vérifiés en continu, avec l'historique et une page d'état à partager.",
  "does": [
   "sondes HTTP(S) (codes acceptés, mot attendu ou interdit), port TCP, ping, DNS (réponse attendue), signe de vie (push) et applis d'Odin",
   "rythme, nombre d'échecs avant d'alerter, délai, heures de maintenance, pause",
   "certificats HTTPS : alerte avant l'expiration",
   "alerte de panne et de retour, avec la cause probable (box, Internet, autres pannes) expliquée par Odin",
   "disponibilité sur 24 h, 30 jours et un an, temps de réponse, journal des pannes, gardés jour par jour",
   "graphe : Odin, les groupes, les machines et leurs sondes, une fiche par point",
   "page publique d'état à partager (sans les adresses)",
   "sondes ajoutées toutes seules : la box, Internet, le DNS et le VPN d'Odin, les sites suivis par Iðunn",
   "SNMP (box, switch, imprimante, onduleur, NAS), scénarios web en plusieurs pages, greffons Nagios / Centreon",
   "déclencheurs sur toutes les mesures d'Odin (moyenne, min, max, variation, pas de données), 5 gravités",
   "problèmes : prise en main, commentaires, escalade si personne ne s'en occupe, dépendances (symptômes sans alerte en double)",
   "engagement de disponibilité (SLA) : objectif, temps de panne permis"
  ],
  "actions": [
   {
    "id": "ajouter",
    "label": "Ajouter une sonde",
    "what": "Surveiller un site, une machine, un port, un nom, un programme ou une appli d'Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Retirer une sonde",
    "what": "Ne plus surveiller (l'historique est gardé)",
    "read": false,
    "grave": false
   },
   {
    "id": "verifier",
    "label": "Vérifier maintenant",
    "what": "Une sonde, ou toutes",
    "read": true,
    "grave": false
   },
   {
    "id": "pause",
    "label": "Mettre en pause",
    "what": "Plus de vérification ni d'alerte",
    "read": false,
    "grave": false
   },
   {
    "id": "reprendre",
    "label": "Reprendre",
    "what": "La sonde repart",
    "read": false,
    "grave": false
   },
   {
    "id": "maintenance",
    "label": "Heures de maintenance",
    "what": "Pas d'alerte pendant ces heures (ex. sauvegarde la nuit)",
    "read": false,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Disponibilité et pannes d'une sonde sur 24 h, 30 jours, un an",
    "read": true,
    "grave": false
   },
   {
    "id": "liens",
    "label": "Sondes automatiques",
    "what": "Ajoute ce que les autres applis apportent : box, Internet, DNS et VPN d'Odin, sites d'Iðunn, Venus",
    "read": false,
    "grave": false
   },
   {
    "id": "declencheur",
    "label": "Ajouter un déclencheur",
    "what": "Un problème quand une mesure d'Odin passe un seuil (mémoire, disque, temps de réponse, température…)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_declencheur",
    "label": "Retirer un déclencheur",
    "what": "Ses problèmes ouverts sont fermés",
    "read": false,
    "grave": false
   },
   {
    "id": "activer_declencheur",
    "label": "Activer / couper un déclencheur",
    "what": "Sans le retirer",
    "read": false,
    "grave": false
   },
   {
    "id": "problemes",
    "label": "Problèmes",
    "what": "Les problèmes ouverts (et les derniers résolus), du plus grave au moins grave",
    "read": true,
    "grave": false
   },
   {
    "id": "prendre_en_main",
    "label": "Je m'en occupe",
    "what": "Prendre un problème en main (plus d'escalade), avec un mot",
    "read": false,
    "grave": false
   },
   {
    "id": "commenter",
    "label": "Commenter un problème",
    "what": "Garder une trace de ce qui a été fait",
    "read": false,
    "grave": false
   },
   {
    "id": "dependance",
    "label": "Dépendance entre sondes",
    "what": "Si la première est en panne, la seconde n'alerte pas (rangée comme symptôme)",
    "read": false,
    "grave": false
   },
   {
    "id": "sla",
    "label": "Engagement de disponibilité (SLA)",
    "what": "Disponibilité du mois de chaque sonde comparée à l'objectif, avec le temps de panne encore permis",
    "read": true,
    "grave": false
   },
   {
    "id": "page_publique",
    "label": "Page publique d'état",
    "what": "Une adresse à partager qui montre l'état des sondes choisies (sans leurs adresses)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "askr",
  "name": "Askr",
  "family": "Machines",
  "what": "L'inventaire du matériel : une fiche par appareil (modèle, série, MAC, IP, pièce, propriétaire, achat, garantie), étiquettes QR, prêts et licences, avec les appareils du réseau ajoutés tout seuls.",
  "does": [
   "fiche par appareil : type, fabricant, modèle, n° de série, MAC, IP, système, pièce, propriétaire, achat, prix, fournisseur, garantie, notes, historique",
   "appareils vus sur le réseau (registre d'Odin, DHCP de Víðarr) ajoutés tout seuls, sans écraser ce que tu as écrit",
   "état : en service, en stock, en réparation, prêté, retiré",
   "prêts (à qui, retour prévu) et alerte de retard ; alerte avant la fin de garantie",
   "étiquette QR imprimable pour chaque appareil",
   "licences (postes utilisés, expiration), clé rangée dans le coffre Brísingamen",
   "graphe : pièces, appareils, personnes ; export et import CSV (Excel)"
  ],
  "actions": [
   {
    "id": "ajouter",
    "label": "Ajouter un appareil",
    "what": "Une nouvelle fiche dans l'inventaire",
    "read": false,
    "grave": false
   },
   {
    "id": "modifier",
    "label": "Modifier une fiche",
    "what": "Change ce qui est renseigné (les champs vides ne changent pas)",
    "read": false,
    "grave": false
   },
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Par nom, étiquette, modèle, série, IP, MAC, pièce ou personne",
    "read": true,
    "grave": false
   },
   {
    "id": "synchroniser",
    "label": "Ajouter les appareils du réseau",
    "what": "Ceux que le registre d'Odin et le DHCP ont vus (rien n'est écrasé)",
    "read": false,
    "grave": false
   },
   {
    "id": "preter",
    "label": "Prêter",
    "what": "À qui, jusqu'à quand",
    "read": false,
    "grave": false
   },
   {
    "id": "rendre",
    "label": "Rendu",
    "what": "L'appareil prêté est revenu",
    "read": false,
    "grave": false
   },
   {
    "id": "etiquette",
    "label": "Étiquette QR",
    "what": "Un QR code à coller sur l'appareil : il ouvre sa fiche",
    "read": true,
    "grave": false
   },
   {
    "id": "surveiller",
    "label": "Surveiller avec Vörðr",
    "what": "Une sonde ping pour cet appareil (alerte s'il ne répond plus)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Retirer du service",
    "what": "Vendu, cassé, donné : la fiche reste dans l'historique",
    "read": false,
    "grave": false
   },
   {
    "id": "supprimer",
    "label": "Supprimer une fiche",
    "what": "Efface la fiche et son historique",
    "read": false,
    "grave": true
   },
   {
    "id": "licence",
    "label": "Ajouter une licence",
    "what": "Logiciel, nombre de postes, expiration ; la clé va dans le coffre",
    "read": false,
    "grave": false
   },
   {
    "id": "attribuer",
    "label": "Attribuer une licence",
    "what": "Un poste de la licence va à un appareil",
    "read": false,
    "grave": false
   },
   {
    "id": "exporter",
    "label": "Exporter (CSV)",
    "what": "Tout l'inventaire pour Excel",
    "read": true,
    "grave": false
   },
   {
    "id": "importer",
    "label": "Importer (CSV)",
    "what": "Colle un tableau (colonnes : nom, type, fabricant, modele, serie, mac, ip, piece, proprietaire, achat, prix, fournisseur, garantie, notes)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "valgrind",
  "name": "Valgrind",
  "family": "Accès",
  "what": "Le proxy inverse : tes services de la maison sous un vrai nom, en HTTPS (Let's Encrypt ou auto-signé), avec accès par adresses, mot de passe, redirections et flux TCP.",
  "does": [
   "un nom de domaine → un service de la maison (HTTP ou HTTPS), jokers *.exemple.fr",
   "certificats Let's Encrypt obtenus et renouvelés tout seuls (sans envoyer d'adresse e-mail), ou auto-signés pour la maison",
   "passage forcé en HTTPS, HSTS, WebSocket, en-têtes X-Forwarded",
   "accès réservé à des adresses ou réseaux ; mot de passe par site (gardé dans le coffre) ; adresses bannies par Garmr refusées",
   "redirections 301 / 302, flux TCP (un port → un service)",
   "journal et statistiques par site, alertes (certificat, service en panne), robots qui cherchent des failles signalés à Ullr",
   "graphe : Internet, le proxy, les sites, les services de la maison"
  ],
  "actions": [
   {
    "id": "ouvrir_ports",
    "label": "Ouvrir 80 et 443 sur la box",
    "what": "Accès direct depuis Internet (sans tunnel) et certificats Let's Encrypt : Odin ouvre lui-même les ports de la box (UPnP)",
    "read": false,
    "grave": true
   },
   {
    "id": "fermer_ports",
    "label": "Fermer 80 et 443 sur la box",
    "what": "Plus d'accès direct depuis Internet (le tunnel Cloudflare continue)",
    "read": false,
    "grave": false
   },
   {
    "id": "demarrer",
    "label": "Démarrer le proxy",
    "what": "Odin répond sur les ports 80 et 443",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêter le proxy",
    "what": "Les sites ne répondent plus par Odin",
    "read": false,
    "grave": true
   },
   {
    "id": "ajouter",
    "label": "Ajouter un site",
    "what": "Un nom → un service de la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Retirer un site",
    "what": "Le nom ne mène plus au service",
    "read": false,
    "grave": false
   },
   {
    "id": "activer",
    "label": "Couper / réactiver un site",
    "what": "Sans le retirer",
    "read": false,
    "grave": false
   },
   {
    "id": "proteger",
    "label": "Protéger par mot de passe",
    "what": "Le site demande un identifiant et un mot de passe (rangé dans le coffre)",
    "read": false,
    "grave": false
   },
   {
    "id": "acces",
    "label": "Accès par adresses",
    "what": "Réserver un site à certaines adresses, ou en refuser",
    "read": false,
    "grave": false
   },
   {
    "id": "rediriger",
    "label": "Redirection",
    "what": "Un nom renvoie vers une autre adresse",
    "read": false,
    "grave": false
   },
   {
    "id": "connexion_unique",
    "label": "Connexion unique (Vár)",
    "what": "Le site demande la connexion d'Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "portail",
    "label": "Servir le portail de connexion",
    "what": "Le nom du portail de Vár, avec son certificat",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_redirection",
    "label": "Retirer une redirection",
    "what": "",
    "read": false,
    "grave": false
   },
   {
    "id": "flux",
    "label": "Flux TCP",
    "what": "Un port d'Odin mène à un service (jeux, SSH, base de données…)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_flux",
    "label": "Retirer un flux",
    "what": "",
    "read": false,
    "grave": false
   },
   {
    "id": "certificat",
    "label": "Obtenir / renouveler un certificat",
    "what": "Let's Encrypt maintenant (ou auto-signé)",
    "read": false,
    "grave": false
   },
   {
    "id": "tester",
    "label": "Tester un site",
    "what": "Le nom, le certificat et le service derrière",
    "read": true,
    "grave": false
   },
   {
    "id": "journal",
    "label": "Journal",
    "what": "Les dernières requêtes",
    "read": true,
    "grave": false
   },
   {
    "id": "reglages",
    "label": "Réglages Let's Encrypt",
    "what": "Serveur d'essai (pour tester sans limite)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "var",
  "name": "Vár",
  "family": "Accès",
  "what": "Les identités : les personnes et leurs groupes, un seul compte (et la double authentification) pour entrer sur tous les sites du proxy, avec sessions, verrouillage et journal.",
  "does": [
   "personnes, groupes, comptes coupés ou réactivés",
   "portail de connexion à la mascotte d'Odin : une connexion pour tous les sites du proxy Valgrind (connexion unique)",
   "double authentification par code (appli Google Authenticator, Aegis…), obligatoire par groupe",
   "sites réservés à des groupes ; l'identité est transmise au service (Remote-User, Remote-Groups)",
   "sessions ouvertes visibles et coupables, durée réglable",
   "verrouillage après 5 essais, adresse bannie par Garmr, alerte, journal des connexions",
   "mots de passe choisis par Odin rangés dans le coffre",
   "graphe : personnes, groupes, sites, sessions"
  ],
  "actions": [
   {
    "id": "ajouter",
    "label": "Ajouter une personne",
    "what": "Un compte pour entrer sur les sites d'Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "modifier",
    "label": "Modifier une personne",
    "what": "Nom, groupes, compte actif",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Retirer une personne",
    "what": "Son compte et ses sessions disparaissent",
    "read": false,
    "grave": true
   },
   {
    "id": "mot_de_passe",
    "label": "Nouveau mot de passe",
    "what": "Remplace le mot de passe (rangé dans le coffre) et ferme les sessions",
    "read": false,
    "grave": false
   },
   {
    "id": "double_auth",
    "label": "Double authentification",
    "what": "Un QR code à scanner avec une appli d'authentification, puis un code pour confirmer",
    "read": false,
    "grave": false
   },
   {
    "id": "confirmer_double_auth",
    "label": "Confirmer la double authentification",
    "what": "Le code à 6 chiffres de l'appli",
    "read": false,
    "grave": false
   },
   {
    "id": "couper_sessions",
    "label": "Couper les sessions",
    "what": "La personne devra se reconnecter partout",
    "read": false,
    "grave": false
   },
   {
    "id": "proteger_site",
    "label": "Réserver un site",
    "what": "Un site du proxy demande la connexion d'Odin, pour certains groupes",
    "read": false,
    "grave": false
   },
   {
    "id": "liberer_site",
    "label": "Libérer un site",
    "what": "Plus besoin de se connecter",
    "read": false,
    "grave": false
   },
   {
    "id": "reglages",
    "label": "Réglages",
    "what": "Le nom du portail, le domaine, la durée des sessions, la double authentification obligatoire",
    "read": false,
    "grave": false
   },
   {
    "id": "personnes",
    "label": "Personnes et groupes",
    "what": "Qui a un compte et dans quels groupes (sans aucun mot de passe)",
    "read": true,
    "grave": false
   },
   {
    "id": "journal",
    "label": "Journal des connexions",
    "what": "Qui s'est connecté, d'où, et les échecs",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "bru",
  "name": "Brú",
  "family": "Accès",
  "what": "Le pont vers Internet par Cloudflare : tes sites et applis d'Odin accessibles de l'extérieur sous ton nom de domaine, sans ouvrir de port sur la box. Les DNS sont ajoutés tout seuls chez Cloudflare.",
  "does": [
   "tunnel Cloudflare nommé créé avec ta clé, sans ouvrir de port sur la box",
   "chaque nom ajouté au proxy Valgrind (et le portail de Vár) est publié tout seul : règle du tunnel + enregistrement DNS chez Cloudflare",
   "certificat HTTPS public fourni par Cloudflare",
   "vraie adresse du visiteur transmise (bannissements et accès par adresses restent justes)",
   "programme officiel cloudflared téléchargé et vérifié par Odin (empreinte), redémarré s'il s'arrête",
   "santé du tunnel surveillée (Cloudflare), alerte s'il tombe",
   "retirer un nom d'Internet : règle et DNS enlevés (seulement ceux d'Odin)",
   "graphe : Cloudflare, tes domaines, les noms publiés, Odin"
  ],
  "actions": [
   {
    "id": "verifier",
    "label": "Vérifier la clé",
    "what": "La clé Cloudflare marche-t-elle, et quels domaines voit-elle ?",
    "read": true,
    "grave": false
   },
   {
    "id": "creer",
    "label": "Créer le tunnel",
    "what": "Un tunnel nommé chez Cloudflare (une fois)",
    "read": false,
    "grave": false
   },
   {
    "id": "demarrer",
    "label": "Démarrer le tunnel",
    "what": "Odin se relie à Cloudflare (télécharge le programme la première fois)",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêter le tunnel",
    "what": "Tes noms publiés ne répondent plus depuis Internet",
    "read": false,
    "grave": true
   },
   {
    "id": "publier_odin",
    "label": "Publier Odin",
    "what": "L'interface d'Odin sous ton domaine (ex. odin.exemple.fr), pour la gérer depuis le téléphone",
    "read": false,
    "grave": false
   },
   {
    "id": "publier",
    "label": "Publier un nom",
    "what": "Ce nom devient accessible depuis Internet (règle du tunnel + DNS chez Cloudflare)",
    "read": false,
    "grave": false
   },
   {
    "id": "depublier",
    "label": "Retirer un nom d'Internet",
    "what": "Règle du tunnel et DNS enlevés (seulement ce qu'Odin a ajouté)",
    "read": false,
    "grave": false
   },
   {
    "id": "etat",
    "label": "État du tunnel",
    "what": "Santé chez Cloudflare, noms publiés, dernières lignes du programme",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "skidbladnir",
  "name": "Skíðblaðnir",
  "family": "Données",
  "what": "Tes fichiers chez toi : espaces partagés par groupe, espace perso de chacun, liens de partage, dépôts, notes secrètes, versions, corbeille, lecteur réseau et synchro de dossiers.",
  "does": [
   "espaces partagés par groupe (Vár) : lecture ou écriture, quota",
   "espace perso pour chaque personne",
   "interface web ordinateur et téléphone (téléverser, glisser-déposer, dossiers, renommer, déplacer, chercher, aperçu photo / vidéo / son)",
   "versions gardées à chaque remplacement, restaurables",
   "corbeille 30 jours (rien n'est effacé d'un coup)",
   "liens de partage : expiration, mot de passe, nombre de téléchargements, archive .zip",
   "dépôt : quelqu'un t'envoie des fichiers par un lien",
   "envoi de gros fichiers par lien temporaire",
   "notes secrètes chiffrées dans le navigateur, effacées après lecture",
   "WebDAV : lecteur réseau sur Windows, Mac, Linux et applis du téléphone (mot de passe d'appli)",
   "synchronisation de dossiers (disque, clé USB, NAS) dans les deux sens, conflits gardés",
   "antivirus sur chaque fichier reçu : le dangereux est mis de côté",
   "5 mots de passe faux sur un lien → adresse bannie",
   "graphe : espaces, groupes, personnes, liens, synchros"
  ],
  "actions": [
   {
    "id": "espace",
    "label": "Créer ou régler un espace",
    "what": "Un dossier partagé, avec les groupes qui lisent et qui écrivent",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_espace",
    "label": "Retirer un espace",
    "what": "Il n'apparaît plus ; ses fichiers restent sur le disque",
    "read": false,
    "grave": false
   },
   {
    "id": "demarrer",
    "label": "Démarrer",
    "what": "Le serveur des fichiers (derrière le proxy)",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter",
    "label": "Arrêter",
    "what": "Plus d'accès aux fichiers par le web",
    "read": false,
    "grave": false
   },
   {
    "id": "publier",
    "label": "Mettre en ligne",
    "what": "Deux noms : l'espace (réservé aux personnes connectées) et les liens publics",
    "read": false,
    "grave": false
   },
   {
    "id": "lien",
    "label": "Créer un lien de partage",
    "what": "Un fichier ou un dossier par lien (expiration, mot de passe)",
    "read": false,
    "grave": false
   },
   {
    "id": "couper_lien",
    "label": "Couper un lien",
    "what": "Le lien ne marche plus",
    "read": false,
    "grave": false
   },
   {
    "id": "mot_de_passe_appli",
    "label": "Mot de passe d'appli (lecteur réseau)",
    "what": "Pour monter les fichiers sur un ordinateur ou une appli du téléphone (WebDAV). Affiché une seule fois",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_mot_de_passe_appli",
    "label": "Retirer un mot de passe d'appli",
    "what": "L'appareil ne peut plus se connecter",
    "read": false,
    "grave": false
   },
   {
    "id": "synchro",
    "label": "Synchroniser un dossier",
    "what": "Un espace ⇄ un dossier de la machine (disque, clé USB, NAS monté)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_synchro",
    "label": "Retirer une synchro",
    "what": "Les deux dossiers restent tels quels",
    "read": false,
    "grave": false
   },
   {
    "id": "synchroniser",
    "label": "Synchroniser maintenant",
    "what": "Lance les synchros tout de suite",
    "read": false,
    "grave": false
   },
   {
    "id": "liberer",
    "label": "Publier un fichier mis de côté",
    "what": "Un fichier retenu par l'antivirus est remis à sa place",
    "read": false,
    "grave": true
   },
   {
    "id": "vider_corbeille",
    "label": "Vider la corbeille",
    "what": "Efface pour de bon ce qui est à la corbeille d'un espace",
    "read": false,
    "grave": true
   },
   {
    "id": "journal",
    "label": "Journal",
    "what": "Qui a envoyé, téléchargé, partagé quoi",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "eitri",
  "name": "Eitri",
  "family": "Données",
  "what": "Les ISO (Windows, Linux, serveurs, dépannage) rangées dans un dossier ou un partage réseau, gardées à jour depuis les sites officiels aux jours que tu programmes, deux versions gardées.",
  "does": [
   "reconnaît les ISO déjà dans ton dossier (disque ou partage réseau monté)",
   "télécharge depuis les sites officiels seulement, empreinte de l'éditeur vérifiée, reprise si coupure, débit maximum",
   "vérifie aux jours et à l'heure que tu programmes (ou à une date) ; télécharge tout seul ou te prévient",
   "garde 2 versions (l'ancienne et la nouvelle), nombre réglable",
   "historique de tout, contrôle des fichiers abîmés, résumé chaque jour, bulles de la mascotte à chaque événement",
   "icônes des éditeurs, catalogue, sources à toi (dépôt GitHub ou adresse officielle)",
   "Windows : Microsoft ne permet pas le téléchargement automatique, Odin repère tes ISO et donne la page officielle",
   "clé USB de démarrage avec Rufus ou Ventoy, gardés à jour par Fjalar"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État",
    "what": "Ce qui est suivi, à jour ou en retard, et le prochain passage",
    "read": true,
    "grave": false
   },
   {
    "id": "dossier",
    "label": "Choisir le dossier",
    "what": "Où ranger les ISO : un disque, ou un partage réseau monté (ex. /mnt/nas/iso)",
    "read": false,
    "grave": false
   },
   {
    "id": "catalogue",
    "label": "Catalogue",
    "what": "Les ISO qu'Odin sait trouver sur les sites officiels",
    "read": true,
    "grave": false
   },
   {
    "id": "suivre",
    "label": "Suivre",
    "what": "Odin garde ce ISO à jour dans le dossier",
    "read": false,
    "grave": false
   },
   {
    "id": "ne_plus_suivre",
    "label": "Ne plus suivre",
    "what": "Les fichiers restent dans le dossier",
    "read": false,
    "grave": false
   },
   {
    "id": "verifier",
    "label": "Vérifier les mises à jour",
    "what": "Compare avec les sites officiels, sans rien télécharger",
    "read": true,
    "grave": false
   },
   {
    "id": "mettre_a_jour",
    "label": "Tout mettre à jour",
    "what": "Vérifie et télécharge maintenant tout ce qui est nouveau",
    "read": false,
    "grave": false
   },
   {
    "id": "telecharger",
    "label": "Télécharger",
    "what": "La dernière version d'un ISO, maintenant (il devient suivi)",
    "read": false,
    "grave": false
   },
   {
    "id": "annuler",
    "label": "Arrêter le téléchargement",
    "what": "Le fichier entamé reprendra la prochaine fois",
    "read": false,
    "grave": false
   },
   {
    "id": "programmer",
    "label": "Programmer",
    "what": "Jours et heure des vérifications (ou une date), et téléchargement automatique ou non",
    "read": false,
    "grave": false
   },
   {
    "id": "garder",
    "label": "Versions à garder",
    "what": "2 par défaut : l'ancienne et la nouvelle",
    "read": false,
    "grave": false
   },
   {
    "id": "resume",
    "label": "Résumé du jour",
    "what": "L'heure du résumé quotidien (téléchargements, mises à jour, changements)",
    "read": false,
    "grave": false
   },
   {
    "id": "debit",
    "label": "Débit maximum",
    "what": "Pour ne pas saturer la connexion (0 : sans limite)",
    "read": false,
    "grave": false
   },
   {
    "id": "ajouter_source",
    "label": "Ajouter un ISO à suivre",
    "what": "Un dépôt GitHub (proprietaire/projet) ou une adresse directe officielle, avec le motif du nom de fichier",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_source",
    "label": "Retirer un ajout",
    "what": "Retire une source ajoutée par toi (les fichiers restent)",
    "read": false,
    "grave": false
   },
   {
    "id": "controler",
    "label": "Contrôler les fichiers",
    "what": "Recalcule l'empreinte de chaque fichier et la compare à celle du téléchargement (fichier abîmé ?)",
    "read": true,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Tout ce qui s'est passé : vérifications, téléchargements, remplacements, échecs",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "fjalar",
  "name": "Fjalar",
  "family": "Données",
  "what": "Les logiciels : un dossier d'installateurs (disque ou partage réseau) gardé à jour depuis les sites officiels, aux jours que tu programmes, analysé par l'antivirus, deux versions gardées.",
  "does": [
   "reconnaît les logiciels déjà dans ton dossier (disque ou partage réseau monté)",
   "télécharge depuis les sites officiels seulement, empreinte de l'éditeur vérifiée, reprise si coupure, débit maximum",
   "vérifie aux jours et à l'heure que tu programmes (ou à une date) ; télécharge tout seul ou te prévient",
   "garde 2 versions (l'ancienne et la nouvelle), nombre réglable",
   "historique de tout, contrôle des fichiers abîmés, résumé chaque jour, bulles de la mascotte à chaque événement",
   "icônes des éditeurs, catalogue, sources à toi (dépôt GitHub ou adresse officielle)",
   "chaque installateur téléchargé passe par l'antivirus (Ullr) : s'il est suspect, il est mis de côté et ne remplace pas l'ancien"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État",
    "what": "Ce qui est suivi, à jour ou en retard, et le prochain passage",
    "read": true,
    "grave": false
   },
   {
    "id": "dossier",
    "label": "Choisir le dossier",
    "what": "Où ranger les logiciels : un disque, ou un partage réseau monté (ex. /mnt/nas/logiciels)",
    "read": false,
    "grave": false
   },
   {
    "id": "catalogue",
    "label": "Catalogue",
    "what": "Les logiciels qu'Odin sait trouver sur les sites officiels",
    "read": true,
    "grave": false
   },
   {
    "id": "suivre",
    "label": "Suivre",
    "what": "Odin garde ce logiciel à jour dans le dossier",
    "read": false,
    "grave": false
   },
   {
    "id": "ne_plus_suivre",
    "label": "Ne plus suivre",
    "what": "Les fichiers restent dans le dossier",
    "read": false,
    "grave": false
   },
   {
    "id": "verifier",
    "label": "Vérifier les mises à jour",
    "what": "Compare avec les sites officiels, sans rien télécharger",
    "read": true,
    "grave": false
   },
   {
    "id": "mettre_a_jour",
    "label": "Tout mettre à jour",
    "what": "Vérifie et télécharge maintenant tout ce qui est nouveau",
    "read": false,
    "grave": false
   },
   {
    "id": "telecharger",
    "label": "Télécharger",
    "what": "La dernière version d'un logiciel, maintenant (il devient suivi)",
    "read": false,
    "grave": false
   },
   {
    "id": "annuler",
    "label": "Arrêter le téléchargement",
    "what": "Le fichier entamé reprendra la prochaine fois",
    "read": false,
    "grave": false
   },
   {
    "id": "programmer",
    "label": "Programmer",
    "what": "Jours et heure des vérifications (ou une date), et téléchargement automatique ou non",
    "read": false,
    "grave": false
   },
   {
    "id": "garder",
    "label": "Versions à garder",
    "what": "2 par défaut : l'ancienne et la nouvelle",
    "read": false,
    "grave": false
   },
   {
    "id": "resume",
    "label": "Résumé du jour",
    "what": "L'heure du résumé quotidien (téléchargements, mises à jour, changements)",
    "read": false,
    "grave": false
   },
   {
    "id": "debit",
    "label": "Débit maximum",
    "what": "Pour ne pas saturer la connexion (0 : sans limite)",
    "read": false,
    "grave": false
   },
   {
    "id": "ajouter_source",
    "label": "Ajouter un logiciel à suivre",
    "what": "Un dépôt GitHub (proprietaire/projet) ou une adresse directe officielle, avec le motif du nom de fichier",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_source",
    "label": "Retirer un ajout",
    "what": "Retire une source ajoutée par toi (les fichiers restent)",
    "read": false,
    "grave": false
   },
   {
    "id": "controler",
    "label": "Contrôler les fichiers",
    "what": "Recalcule l'empreinte de chaque fichier et la compare à celle du téléchargement (fichier abîmé ?)",
    "read": true,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Tout ce qui s'est passé : vérifications, téléchargements, remplacements, échecs",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "thjalfi",
  "name": "Þjálfi",
  "family": "Machines",
  "what": "Le déploiement par le réseau : les ISO d'Eitri démarrent sur n'importe quelle machine sans clé USB, s'installent toutes seules sur les machines que tu autorises, avec les logiciels de Fjalar ; tu suis chaque machine.",
  "does": [
   "démarrage par le réseau (PXE) en BIOS et UEFI, sans rien régler sur la box (proxy DHCP) ou avec le DHCP d'Odin",
   "les ISO d'Eitri lues directement (ISO 9660, Joliet, Rock Ridge, UDF) sans extraction",
   "installation automatique : Ubuntu (autoinstall), Debian (preseed), Fedora / Rocky / Alma (Kickstart), Windows (unattend, partage réseau)",
   "profils : compte, langue, clavier, fuseau, paquets Linux, logiciels Windows de Fjalar en silencieux",
   "outils et systèmes live (Clonezilla, GParted, Arch, Alpine…) démarrés depuis le menu",
   "suivi en direct : machine, ISO, étape ; historique avec le nom pris sur le réseau ; nombre de déploiements par ISO",
   "sécurité : machine inconnue = son propre disque ; installation automatique seulement si tu l'autorises, une seule fois"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État",
    "what": "Serveur allumé ou non, ISO prêtes, machines en cours",
    "read": true,
    "grave": false
   },
   {
    "id": "allumer",
    "label": "Allumer",
    "what": "Répond aux machines qui démarrent par le réseau (une machine inconnue démarre sur son disque par défaut)",
    "read": false,
    "grave": false
   },
   {
    "id": "eteindre",
    "label": "Éteindre",
    "what": "Ne répond plus aux machines qui démarrent par le réseau",
    "read": false,
    "grave": false
   },
   {
    "id": "preparer",
    "label": "Préparer (chargeurs officiels)",
    "what": "Télécharge iPXE et wimboot depuis leurs sites officiels, et le programme d'installation réseau de Debian pour tes ISO Debian ; tout passe par l'antivirus",
    "read": false,
    "grave": false
   },
   {
    "id": "isos",
    "label": "ISO",
    "what": "Les ISO d'Eitri, ce que Þjálfi en fait, et combien de fois chacune a été déployée",
    "read": true,
    "grave": false
   },
   {
    "id": "iso_par_defaut",
    "label": "ISO par défaut",
    "what": "Ce que démarre une machine qui ne choisit rien dans le menu (« disque » = son propre disque)",
    "read": false,
    "grave": false
   },
   {
    "id": "autoriser",
    "label": "Autoriser une machine",
    "what": "Cette machine (par son adresse MAC) démarre l'ISO choisie ; avec « installation automatique », elle s'installe toute seule une fois (son disque est effacé)",
    "read": false,
    "grave": true
   },
   {
    "id": "retirer_machine",
    "label": "Retirer une machine",
    "what": "Elle redevient une machine inconnue",
    "read": false,
    "grave": false
   },
   {
    "id": "reinstaller",
    "label": "Réinstaller",
    "what": "Relance l'installation automatique d'une machine déjà installée (son disque sera effacé)",
    "read": false,
    "grave": true
   },
   {
    "id": "profil",
    "label": "Profil d'installation",
    "what": "Compte créé, langue, clavier, fuseau, paquets Linux et logiciels Windows (Fjalar) ; le mot de passe est généré et rangé dans le coffre",
    "read": false,
    "grave": false
   },
   {
    "id": "partage_windows",
    "label": "Partage Windows",
    "what": "Le partage réseau (SMB, ton NAS) où Odin dépose les fichiers d'installation de Windows",
    "read": false,
    "grave": false
   },
   {
    "id": "preparer_windows",
    "label": "Préparer Windows",
    "what": "Copie les fichiers d'installation d'une ISO Windows sur le partage (une fois par version)",
    "read": false,
    "grave": false
   },
   {
    "id": "mode",
    "label": "Mode DHCP",
    "what": "« proxy » : ta box donne les adresses, Odin ajoute le démarrage réseau (rien à régler) ; « aucun » : tu règles toi-même ton DHCP",
    "read": false,
    "grave": false
   },
   {
    "id": "machines",
    "label": "Machines",
    "what": "En cours de déploiement, autorisées, et déjà passées",
    "read": true,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Les machines déployées : nom pris sur le réseau, ISO, durée, résultat",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "gladsheim",
  "name": "Glaðsheimr",
  "family": "Maison",
  "what": "La maison en un écran, pour tablette murale, téléphone, ordinateur et Home Assistant : appareils, scènes, météo, état de toutes tes applis, tes boutons, onze thèmes, et la mascotte qui joue et obéit.",
  "does": [
   "écran plein format à onze thèmes (verre, bleu nuit, braise, acier, tablette murale, crépuscule, classique, violet, aurore, lagon, clair)",
   "pièces et appareils de toutes tes box (Midgard) : lumières (intensité), volets, clim (+/−), serrures (glisser pour ouvrir, avec ton accord), lecteurs",
   "scènes d'un geste",
   "météo du lieu choisi (heure par heure, 7 jours, lever et coucher du soleil)",
   "l'état de toutes tes applis (alertes, chiffres clés), un clic pour ouvrir",
   "tes boutons vers n'importe quelle action d'une appli : bloquer quelqu'un, VPN, accès réseau, informations, mises à jour…",
   "la mascotte se promène, joue à la balle, donne la météo, l'heure, les alertes, et fait ce que tu lui dis (mêmes droits et mêmes validations que partout dans Odin)",
   "clés de tablette (lien à poser sur une tablette ou dans Home Assistant), droits « maison » ou « complet », retirables",
   "dans Home Assistant : un tableau de bord « page web » prêt à coller"
  ],
  "actions": [
   {
    "id": "ouvrir",
    "label": "Ouvrir l'écran de la maison",
    "what": "L'adresse de l'écran plein format",
    "read": true,
    "grave": false
   },
   {
    "id": "theme",
    "label": "Thème",
    "what": "Le thème de l'écran de la maison",
    "read": false,
    "grave": false
   },
   {
    "id": "fenetre",
    "label": "Ma fenêtre",
    "what": "Les pages de modules de la fenêtre d'Odin (ordinateur, téléphone, écran de la maison)",
    "read": true,
    "grave": false
   },
   {
    "id": "regler_fenetre",
    "label": "Ranger ma fenêtre",
    "what": "Enregistre les pages et les modules (mode « Modifier »)",
    "read": false,
    "grave": false
   },
   {
    "id": "meteo",
    "label": "Météo",
    "what": "Le temps qu'il fait (et le lieu choisi)",
    "read": true,
    "grave": false
   },
   {
    "id": "bouton",
    "label": "Ajouter un bouton",
    "what": "Un bouton vers une action de n'importe quelle appli",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_bouton",
    "label": "Retirer un bouton",
    "what": "Par son texte",
    "read": false,
    "grave": false
   },
   {
    "id": "boutons",
    "label": "Boutons",
    "what": "Les boutons de l'écran de la maison",
    "read": true,
    "grave": false
   },
   {
    "id": "cle_tablette",
    "label": "Clé de tablette",
    "what": "Un lien pour une tablette murale ou Home Assistant, sans mot de passe (gardé secret)",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_cle",
    "label": "Retirer une clé de tablette",
    "what": "La tablette perd l'accès tout de suite",
    "read": false,
    "grave": false
   },
   {
    "id": "membre",
    "label": "Ajouter un membre (OwnTracks)",
    "what": "Un membre de la famille partage sa position avec l'appli OwnTracks : Odin lui donne ses identifiants",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer_membre",
    "label": "Retirer un membre",
    "what": "Ses identifiants ne marchent plus et ses positions sont effacées",
    "read": false,
    "grave": false
   },
   {
    "id": "positions",
    "label": "Où est la famille",
    "what": "La dernière position partagée de chacun",
    "read": true,
    "grave": false
   },
   {
    "id": "duree_positions",
    "label": "Durée de garde des positions",
    "what": "1 jour par défaut, 30 au plus",
    "read": false,
    "grave": false
   },
   {
    "id": "home_assistant",
    "label": "Afficher dans Home Assistant",
    "what": "Autorise ta box Home Assistant à afficher l'écran, et donne le tableau de bord à coller",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "apparence",
  "name": "Apparence",
  "family": "Maison",
  "what": "Les 20 thèmes d'Odin : couleurs, décor et couleur d'Odin au repos, choisis par toi ou selon l'heure et la météo.",
  "does": [
   "20 thèmes (Glace, Vacances, Paysage, Ciel, Nuit étoilée, Plage, Mayotte…)",
   "le même thème sur tous tes écrans",
   "automatique : nuit, matin, journée, fin de journée, pluie, orage, chaleur",
   "Odin prend la couleur du thème au repos ; ses humeurs gardent leurs couleurs",
   "« Odin, change ton thème », aussi sur Telegram"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "Thème actuel",
    "what": "Le thème d'Odin en ce moment, et pourquoi",
    "read": true,
    "grave": false
   },
   {
    "id": "theme",
    "label": "Changer de thème",
    "what": "Un thème au choix, « automatique » (heure et météo) ou « au hasard » ; sans précision, Odin choisit celui qui va avec le temps qu'il fait",
    "read": false,
    "grave": false
   },
   {
    "id": "mascotte",
    "label": "Odin : apparence du moment",
    "what": "Thème, couleur d'Odin (météo, marée, nuit), événement du jour, clics, pouvoirs : ce que tous tes écrans affichent",
    "read": true,
    "grave": false
   },
   {
    "id": "regler_mascotte",
    "label": "Régler Odin (clics, pouvoirs, événements)",
    "what": "Enregistre les réglages venus de l'écran Réglages → Apparence (JSON : mascotte, pouvoirs, evenements)",
    "read": false,
    "grave": false
   },
   {
    "id": "cacher",
    "label": "Odin se cache",
    "what": "Odin disparaît de tous tes écrans (il revient par Réglages → Apparence, ou « Odin, reviens »)",
    "read": false,
    "grave": false
   },
   {
    "id": "montrer",
    "label": "Odin revient",
    "what": "Odin réapparaît sur tous tes écrans",
    "read": false,
    "grave": false
   },
   {
    "id": "pouvoirs",
    "label": "Pouvoirs d'Odin",
    "what": "Active ou coupe les pouvoirs (animations quand un onglet s'ouvre ou se ferme, quand tu supprimes…)",
    "read": false,
    "grave": false
   },
   {
    "id": "evenements",
    "label": "Événements de l'année",
    "what": "Les prochaines fêtes et anniversaires, et ce qui est activé",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "commandes",
  "name": "Commandes",
  "family": "Données",
  "what": "Toutes les invites de commande d'Odin : une pour chaque fonction de chaque appli, avec un exemple prêt à copier.",
  "does": [
   "une commande par action de chaque appli : odin <appli> <action> --option valeur",
   "exemple prêt à copier, options, accord demandé pour ce qui est grave",
   "trouver la commande d'une demande (« la commande pour bannir une adresse »)",
   "la liste est aussi dans la mémoire d'Odin (fiche de chaque appli)"
  ],
  "actions": [
   {
    "id": "chercher",
    "label": "Trouver une commande",
    "what": "La commande qui fait ce que tu décris",
    "read": true,
    "grave": false
   },
   {
    "id": "liste",
    "label": "Liste des commandes",
    "what": "Toutes les commandes, ou celles d'une appli",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "volva",
  "name": "Völva",
  "family": "Données",
  "what": "La recherche façon Perplexity : une question, tous tes moteurs (SearXNG avec Google, Bing, DuckDuckGo, Qwant…, Brave, Wikipédia), une réponse rédigée par ton IA avec des sources cliquables, et les applis d'Odin qui peuvent agir.",
  "does": [
   "plusieurs moteurs ensemble : ton SearXNG (Google, Bing, DuckDuckGo, Qwant, Startpage, Mojeek, Yahoo…), Brave, Wikipédia, Tavily, Exa",
   "résultats fusionnés et dédoublonnés (une page vue par plusieurs moteurs passe devant), 3 pages au plus par site",
   "pages lues, réponse rédigée par l'IA réglée dans Odin, chaque phrase avec ses sources [1][2], sans rien inventer",
   "sans IA : les meilleurs extraits, chacun avec sa source",
   "questions de suite, conversation (la suite comprend la question d'avant), focus Actualités, Wikipédia, Science, Vidéos",
   "les applis d'Odin qui peuvent agir sur le sujet, avec leur bouton",
   "historique, export Markdown et JSON, lien de partage, impression en PDF",
   "toutes les recherches d'Odin passent par Völva quand il est réglé",
   "installe et lance SearXNG à côté d'Odin (Docker), en français, format JSON activé"
  ],
  "actions": [
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Une question en français : réponse sourcée",
    "read": true,
    "grave": false
   },
   {
    "id": "moteurs",
    "label": "Moteurs",
    "what": "Ce que chaque moteur demande et s'il est prêt",
    "read": true,
    "grave": false
   },
   {
    "id": "moteur",
    "label": "Activer / couper un moteur",
    "what": "Choisir les moteurs interrogés",
    "read": false,
    "grave": false
   },
   {
    "id": "searxng",
    "label": "Relier mon SearXNG",
    "what": "L'adresse de ton instance SearXNG (format JSON activé)",
    "read": false,
    "grave": false
   },
   {
    "id": "installer_searxng",
    "label": "Installer SearXNG",
    "what": "Lance SearXNG à côté d'Odin (Docker), en français, format JSON activé, sur cette machine seulement",
    "read": false,
    "grave": false
   },
   {
    "id": "arreter_searxng",
    "label": "Arrêter SearXNG",
    "what": "Arrête et retire le SearXNG lancé par Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "historique",
    "label": "Historique",
    "what": "Les dernières recherches",
    "read": true,
    "grave": false
   },
   {
    "id": "exporter",
    "label": "Exporter une recherche",
    "what": "En Markdown ou en JSON",
    "read": true,
    "grave": false
   },
   {
    "id": "oublier",
    "label": "Effacer l'historique",
    "what": "Toutes les recherches gardées",
    "read": false,
    "grave": true
   },
   {
    "id": "reglages",
    "label": "Réglages",
    "what": "Lire les pages, recherches d'Odin par Völva, historique",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "hermod",
  "name": "Hermod",
  "family": "Accès",
  "what": "Ton parc d'ordinateurs : qui est allumé, l'état de chacun, commandes à distance, réveil et prise en main.",
  "does": [
   "inventaire : système, mémoire, disque, mises à jour en attente",
   "en ligne ou non (vérifié toutes les 5 minutes)",
   "commande à distance (avec ton accord)",
   "réveil à distance (Wake-on-LAN)",
   "redémarrage à distance (avec ton accord)",
   "mode Skírnir : prise en main du bureau quand la machine a un accès VNC ou bureau à distance",
   "alerte si une machine disparaît ou si son disque se remplit"
  ],
  "actions": [
   {
    "id": "parc",
    "label": "État du parc",
    "what": "Machines, en ligne, disque, mises à jour",
    "read": true,
    "grave": false
   },
   {
    "id": "inventaire",
    "label": "Rafraîchir l'inventaire",
    "what": "Interroge chaque machine",
    "read": true,
    "grave": false
   },
   {
    "id": "commande",
    "label": "Commande à distance",
    "what": "Exécute une commande sur une machine",
    "read": false,
    "grave": true
   },
   {
    "id": "reveiller",
    "label": "Réveiller",
    "what": "Allume une machine à distance (Wake-on-LAN)",
    "read": false,
    "grave": false
   },
   {
    "id": "redemarrer",
    "label": "Redémarrer",
    "what": "Redémarre une machine",
    "read": false,
    "grave": true
   },
   {
    "id": "bureau",
    "label": "Prise en main (Skírnir)",
    "what": "Vérifie l'accès au bureau à distance (VNC 5900 / RDP 3389) et donne l'adresse",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "ratatoskr",
  "name": "Ratatoskr",
  "family": "Accès",
  "what": "Les serveurs MCP : brancher les outils d'autres applis sur Odin, et ouvrir Odin aux autres assistants.",
  "does": [
   "branche un serveur MCP local (programme) ou distant (adresse HTTP)",
   "ses outils deviennent des outils d'Odin, sous Heimdall",
   "sans IA : tu appelles toi-même un outil (« appelle l'outil … »)",
   "serveur MCP d'Odin (/mcp, jeton obligatoire) : tes applis utilisables depuis un autre assistant",
   "jamais d'action grave par MCP : elles se valident dans Odin"
  ],
  "actions": [
   {
    "id": "serveurs",
    "label": "Serveurs MCP",
    "what": "Serveurs branchés et leurs outils",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Brancher un serveur",
    "what": "Programme local (commande) ou adresse HTTP. Jeton éventuel dans le coffre : MCP_<NOM>.",
    "read": false,
    "grave": true
   },
   {
    "id": "reconnecter",
    "label": "Reconnecter",
    "what": "Relance un serveur et relit ses outils",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Débrancher",
    "what": "Retire le serveur et ses outils",
    "read": false,
    "grave": false
   },
   {
    "id": "outils",
    "label": "Outils d'un serveur",
    "what": "Liste détaillée",
    "read": true,
    "grave": false
   },
   {
    "id": "appeler",
    "label": "Appeler un outil",
    "what": "Lance toi-même un outil d'un serveur branché, sans IA (réglages en JSON). Un outil qui peut modifier quelque chose demande ton accord",
    "read": false,
    "grave": true
   }
  ]
 },
 {
  "id": "appareils",
  "name": "Appareils",
  "family": "Maison",
  "what": "Tous les appareils de la maison dans un seul registre : lumières, prises, capteurs, volets, clims…",
  "does": [
   "relais de messages intégré (Veðrfölnir) auquel les appareils se connectent",
   "reconnaissance automatique des appareils qui s'annoncent (passerelles Zigbee, Z-Wave, modules ESP, prises flashées Tasmota au format d'aujourd'hui)",
   "en ligne ou hors ligne, su tout de suite",
   "état, pile, qualité du signal, dernière nouvelle de chaque appareil",
   "allumer, éteindre, régler",
   "pièces et noms",
   "mode appairage des passerelles Zigbee (60 s)",
   "alerte pile faible et appareil muet depuis longtemps"
  ],
  "actions": [
   {
    "id": "lister",
    "label": "Appareils",
    "what": "Tous les appareils et leur état",
    "read": true,
    "grave": false
   },
   {
    "id": "commander",
    "label": "Commander",
    "what": "Allumer, éteindre ou régler un appareil",
    "read": false,
    "grave": true
   },
   {
    "id": "ranger",
    "label": "Nom et pièce",
    "what": "Renommer un appareil et choisir sa pièce",
    "read": false,
    "grave": false
   },
   {
    "id": "appairer",
    "label": "Appairer (60 s)",
    "what": "Ouvre l'appairage des passerelles Zigbee pendant 60 s",
    "read": false,
    "grave": false
   },
   {
    "id": "publier",
    "label": "Envoyer un message",
    "what": "Message brut sur le relais (avancé)",
    "read": false,
    "grave": false
   },
   {
    "id": "acces",
    "label": "Accès au relais",
    "what": "Adresse, port, identifiant et mot de passe pour brancher un appareil",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "brokkr",
  "name": "Brokkr",
  "family": "Maison",
  "what": "L'atelier des modules connectés : trouver, brancher sur Odin, commander et préparer les prises et modules ESP.",
  "does": [
   "trouve les prises et modules flashés sur le réseau (Tasmota, ESPHome)",
   "les branche sur le relais d'Odin en un clic (ils apparaissent ensuite dans Appareils)",
   "commandes directes (allumer, consommation, redémarrer)",
   "prépare la configuration d'un nouveau module ESP (température, relais, mouvement, porte)",
   "mise à jour du micrologiciel (avec ton accord)"
  ],
  "actions": [
   {
    "id": "chercher",
    "label": "Chercher les modules",
    "what": "Balaye le réseau local",
    "read": true,
    "grave": false
   },
   {
    "id": "brancher",
    "label": "Brancher sur Odin",
    "what": "Configure le module pour qu'il parle au relais d'Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "commande",
    "label": "Commande",
    "what": "Commande directe à un module Tasmota",
    "read": false,
    "grave": false
   },
   {
    "id": "mettre_a_jour",
    "label": "Mettre à jour",
    "what": "Met à jour le micrologiciel Tasmota (officiel)",
    "read": false,
    "grave": true
   },
   {
    "id": "preparer",
    "label": "Préparer un module ESP",
    "what": "Configuration prête à flasher",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "midgard",
  "name": "Midgard",
  "family": "Maison",
  "what": "Le tableau de bord de la maison : pièces, scènes, et les appareils de toutes tes box réunis.",
  "does": [
   "tableau de bord par pièce (cartes Ýdalir, bulles Breiðablik)",
   "scènes : plusieurs appareils d'un coup (« Je pars », « Film », « Bonne nuit »)",
   "ponts vers d'autres box (Home Assistant, et box compatibles) : leurs appareils apparaissent ici",
   "allumer, éteindre, ouvrir, fermer depuis le tableau ou par la voix",
   "chaque changement d'état peut lancer une automatisation Draupnir"
  ],
  "actions": [
   {
    "id": "maison",
    "label": "État de la maison",
    "what": "Résumé par pièce",
    "read": true,
    "grave": false
   },
   {
    "id": "scene",
    "label": "Lancer une scène",
    "what": "Plusieurs appareils d'un coup",
    "read": false,
    "grave": true
   },
   {
    "id": "creer_scene",
    "label": "Créer une scène",
    "what": "Nom + une ligne par étape : « appareil = valeur », ou « appli.action = valeur » pour piloter une autre appli (ex. freyja.regarder = Inception)",
    "read": false,
    "grave": false
   },
   {
    "id": "commander",
    "label": "Commander",
    "what": "Un appareil (de n'importe quelle box)",
    "read": false,
    "grave": true
   },
   {
    "id": "pont",
    "label": "Relier une box",
    "what": "Ajoute une box domotique (adresse ; jeton dans le coffre : HA_TOKEN)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "himinbjorg",
  "name": "Himinbjörg",
  "family": "Maison",
  "what": "Tes caméras : voir, photographier, détecter les mouvements et enregistrer.",
  "does": [
   "toutes les caméras réseau (RTSP, HTTP) au même endroit",
   "photo à la demande",
   "détection de mouvement maison, avec sensibilité et heures de surveillance",
   "enregistrement d'un clip à chaque mouvement, gardé N jours",
   "alerte avec photo sur ta messagerie ; chaque mouvement peut lancer une scène Midgard ou une automatisation"
  ],
  "actions": [
   {
    "id": "cameras",
    "label": "Caméras",
    "what": "Liste des caméras",
    "read": true,
    "grave": false
   },
   {
    "id": "ajouter",
    "label": "Ajouter une caméra",
    "what": "Adresse du flux (identifiants dans le coffre : CAMERA_<NOM>=utilisateur:motdepasse)",
    "read": false,
    "grave": false
   },
   {
    "id": "photo",
    "label": "Photo",
    "what": "Prend une photo maintenant",
    "read": true,
    "grave": false
   },
   {
    "id": "enregistrer",
    "label": "Enregistrer",
    "what": "Clip de N secondes",
    "read": false,
    "grave": false
   },
   {
    "id": "retirer",
    "label": "Retirer une caméra",
    "what": "La caméra est oubliée (les clips restent)",
    "read": false,
    "grave": false
   },
   {
    "id": "reglages",
    "label": "Réglages",
    "what": "Sensibilité et rétention",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "bragi",
  "name": "Bragi",
  "family": "Maison",
  "what": "La voix d'Odin : comprendre ce que tu dis, parler, annoncer sur les enceintes.",
  "does": [
   "comprend les vocaux et fichiers audio (Whisper sur la machine ou en ligne), langue détectée",
   "parle avec la voix choisie (ElevenLabs, Piper local gratuit, ou compatible OpenAI)",
   "Vör : annonce sur une enceinte de la maison ou partout",
   "Gjallarhorn : les alertes critiques peuvent être dites à voix haute",
   "transcrit un fichier audio en texte horodaté"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État de la voix",
    "what": "Ce qui est prêt",
    "read": true,
    "grave": false
   },
   {
    "id": "dire",
    "label": "Dire",
    "what": "Fabrique un fichier audio avec la voix d'Odin",
    "read": false,
    "grave": false
   },
   {
    "id": "annoncer",
    "label": "Annoncer",
    "what": "Sur une enceinte (nom), ou « partout »",
    "read": false,
    "grave": false
   },
   {
    "id": "transcrire",
    "label": "Transcrire",
    "what": "Fichier audio → texte",
    "read": true,
    "grave": false
   },
   {
    "id": "ordre",
    "label": "Ordre à la voix",
    "what": "Comprend un ordre dit ou écrit (« mets Inception sur la télé », « allume le salon ») et le fait faire par la bonne appli, sans IA. Une action grave n'est jamais lancée ainsi.",
    "read": false,
    "grave": false
   },
   {
    "id": "voix",
    "label": "Voix disponibles",
    "what": "Voix du fournisseur",
    "read": true,
    "grave": false
   },
   {
    "id": "gjallarhorn",
    "label": "Alertes à voix haute",
    "what": "Dire les alertes critiques sur les enceintes",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "freyja",
  "name": "Freyja",
  "family": "Maison",
  "what": "Ton serveur multimédia : films, séries, chaînes, programmes, enregistrements, sur tous tes écrans.",
  "does": [
   "lance un film, une série ou une chaîne sur l'écran choisi (« mets One Piece sur la télé du salon »)",
   "guide des programmes : ce qui passe maintenant et ce soir",
   "enregistre une émission ou toutes ses diffusions",
   "liste les écrans où Venus est ouvert",
   "recherche dans toute la bibliothèque",
   "ma liste et demandes de nouveaux titres",
   "alerte si un enregistrement échoue",
   "te prévient quand un épisode arrive (et quand la VF arrive)",
   "demande la VF d'un titre à Radarr / Sonarr",
   "met le dernier épisode, le suivant ou S2E5 d'une série"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État",
    "what": "Serveur joignable, lecture en cours",
    "read": true,
    "grave": false
   },
   {
    "id": "adresse",
    "label": "Adresse de Venus",
    "what": "L'adresse du serveur Venus relié (pour la surveillance de Vörðr)",
    "read": true,
    "grave": false
   },
   {
    "id": "sante",
    "label": "Santé de Venus",
    "what": "En marche depuis, lectures en cours, analyse de la bibliothèque, place libre",
    "read": true,
    "grave": false
   },
   {
    "id": "regarder",
    "label": "Regarder",
    "what": "Film, série ou chaîne (nom ou numéro) sur un écran",
    "read": false,
    "grave": false
   },
   {
    "id": "programme",
    "label": "Programme",
    "what": "Ce qui passe maintenant (filtre facultatif)",
    "read": true,
    "grave": false
   },
   {
    "id": "enregistrer",
    "label": "Enregistrer",
    "what": "Une émission du guide (24 h)",
    "read": false,
    "grave": false
   },
   {
    "id": "enregistrer_plage",
    "label": "Enregistrer une chaîne",
    "what": "Une chaîne, à une heure, pendant une durée (sans passer par le guide)",
    "read": false,
    "grave": false
   },
   {
    "id": "enregistrements",
    "label": "Enregistrements",
    "what": "Programmés, en cours, terminés",
    "read": true,
    "grave": false
   },
   {
    "id": "annuler_enregistrement",
    "label": "Annuler un enregistrement",
    "what": "Annule un enregistrement programmé ou en cours",
    "read": false,
    "grave": false
   },
   {
    "id": "nouveautes",
    "label": "Nouveautés",
    "what": "Épisodes, films et VF arrivés ces derniers jours",
    "read": true,
    "grave": false
   },
   {
    "id": "chercher_vf",
    "label": "Chercher en VF",
    "what": "Demande la version française d'un film ou d'une série à Radarr / Sonarr (via Venus)",
    "read": false,
    "grave": false
   },
   {
    "id": "prevenir",
    "label": "Me prévenir des arrivées",
    "what": "Nouveaux épisodes et films (tout), seulement la VF, ou rien",
    "read": false,
    "grave": false
   },
   {
    "id": "ecrans",
    "label": "Écrans",
    "what": "Où Venus est ouvert",
    "read": true,
    "grave": false
   },
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Dans la bibliothèque",
    "read": true,
    "grave": false
   },
   {
    "id": "ma_liste",
    "label": "Ma liste",
    "what": "Titres gardés pour plus tard",
    "read": true,
    "grave": false
   },
   {
    "id": "demander",
    "label": "Demander un titre",
    "what": "Titre absent de la bibliothèque (via la demande de Venus)",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "aegir",
  "name": "Ægir",
  "family": "Maison",
  "what": "Ta musique et tes radios : bibliothèque, recherche, listes, lecture sur les enceintes.",
  "does": [
   "indexe tes dossiers de musique (titre, artiste, album, durée)",
   "recherche par mots",
   "listes de lecture",
   "radios web",
   "lecture sur une enceinte de la maison ou sur cette machine",
   "arrêt de la lecture"
  ],
  "actions": [
   {
    "id": "indexer",
    "label": "Indexer",
    "what": "Relit les dossiers de musique",
    "read": true,
    "grave": false
   },
   {
    "id": "dossier",
    "label": "Ajouter un dossier",
    "what": "Dossier de musique sur cette machine",
    "read": false,
    "grave": false
   },
   {
    "id": "chercher",
    "label": "Chercher",
    "what": "Titre, artiste, album",
    "read": true,
    "grave": false
   },
   {
    "id": "jouer",
    "label": "Jouer",
    "what": "Un morceau, une liste ou une radio, ici ou sur une enceinte",
    "read": false,
    "grave": false
   },
   {
    "id": "stop",
    "label": "Arrêter",
    "what": "Arrête la lecture sur cette machine",
    "read": false,
    "grave": false
   },
   {
    "id": "liste",
    "label": "Créer une liste",
    "what": "Nom + recherche : les morceaux trouvés forment la liste",
    "read": false,
    "grave": false
   },
   {
    "id": "radio",
    "label": "Ajouter une radio",
    "what": "Nom + adresse du flux",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "frigg",
  "name": "Frigg",
  "family": "Données",
  "what": "Les rendez-vous : prestations, horaires, créneaux libres et page publique de réservation.",
  "does": [
   "prestations avec durée et prix",
   "horaires d'ouverture par jour",
   "créneaux libres calculés tout seuls",
   "page publique de réservation (lien secret) sans compte",
   "confirmation, annulation, rappel la veille sur ta messagerie",
   "chaque réservation peut lancer une automatisation (SMS, fiche client dans Runes…)"
  ],
  "actions": [
   {
    "id": "agenda",
    "label": "Rendez-vous à venir",
    "what": "Les prochains rendez-vous",
    "read": true,
    "grave": false
   },
   {
    "id": "creneaux",
    "label": "Créneaux libres",
    "what": "Pour une prestation et un jour",
    "read": true,
    "grave": false
   },
   {
    "id": "reserver",
    "label": "Réserver",
    "what": "Ajoute un rendez-vous",
    "read": false,
    "grave": false
   },
   {
    "id": "confirmer",
    "label": "Confirmer",
    "what": "Confirme une demande",
    "read": false,
    "grave": false
   },
   {
    "id": "annuler",
    "label": "Annuler",
    "what": "Annule un rendez-vous",
    "read": false,
    "grave": true
   },
   {
    "id": "prestation",
    "label": "Ajouter une prestation",
    "what": "Nom, durée, prix",
    "read": false,
    "grave": false
   },
   {
    "id": "horaires",
    "label": "Horaires",
    "what": "Une ligne par jour : « lundi 9:00-12:00,14:00-18:00 »",
    "read": false,
    "grave": false
   },
   {
    "id": "page",
    "label": "Page publique",
    "what": "Lien à donner à tes clients",
    "read": true,
    "grave": false
   }
  ]
 },
 {
  "id": "kvasir",
  "name": "Kvasir",
  "family": "Données",
  "what": "La veille d'Odin : nouveautés des applis d'origine, et étude des liens GitHub que tu envoies.",
  "does": [
   "suit les versions publiées par chaque projet d'origine (GitHub)",
   "résume ce qui pourrait servir à l'appli d'Odin correspondante (avec IA) ou liste les points clés (sans IA)",
   "note chaque nouveauté dans la base « Évolutions » et te prévient",
   "étudie un lien GitHub : appli d'Odin concernée, ce qui est déjà couvert, ce qui est nouveau",
   "carnet de travail des fonctions à ajouter, sans doublon"
  ],
  "actions": [
   {
    "id": "verifier",
    "label": "Vérifier maintenant",
    "what": "Interroge les dépôts suivis",
    "read": true,
    "grave": false
   },
   {
    "id": "etudier",
    "label": "Étudier un lien GitHub",
    "what": "Rattache un projet aux applis d'Odin et note ce qu'il apporte",
    "read": false,
    "grave": false
   },
   {
    "id": "carnet",
    "label": "Carnet de travail",
    "what": "Fonctions à ajouter, par appli",
    "read": true,
    "grave": false
   },
   {
    "id": "idee",
    "label": "Changer une idée",
    "what": "Statut d'une fonction du carnet",
    "read": false,
    "grave": false
   },
   {
    "id": "suivre",
    "label": "Suivre un dépôt",
    "what": "Ajoute un dépôt à la veille d'une appli",
    "read": false,
    "grave": false
   }
  ]
 },
 {
  "id": "valaskjalf",
  "name": "Valaskjálf",
  "family": "Machines",
  "what": "Odin OS, le système d'exploitation d'Odin : l'essayer dans le navigateur, l'installer sur Docker ou LXC, retrouver les images pour PC, Windows et téléphone.",
  "does": [
   "bureau Odin OS servi par Odin (/os/) : 5 thèmes, écran téléphone, Fichiers, Terminal, Odin Store, Ullr",
   "essai dans le navigateur, sans rien installer",
   "installation dans Docker (avec ton accord)",
   "installation dans un conteneur LXC, Proxmox ou LXC classique (avec ton accord)",
   "liste des images construites : taille et empreinte SHA-256",
   "ouvre ou ferme le vrai terminal du bureau sur cette machine"
  ],
  "actions": [
   {
    "id": "etat",
    "label": "État de Valaskjálf",
    "what": "Odin OS : version, où il tourne, images construites",
    "read": true,
    "grave": false
   },
   {
    "id": "essayer",
    "label": "Essayer dans le navigateur",
    "what": "Donne l'adresse du bureau Odin OS servi par cet Odin",
    "read": true,
    "grave": false
   },
   {
    "id": "docker",
    "label": "Installer dans Docker",
    "what": "Crée et démarre un conteneur Odin OS (image construite ou construite depuis le dépôt)",
    "read": false,
    "grave": true
   },
   {
    "id": "lxc",
    "label": "Installer dans LXC",
    "what": "Crée un conteneur LXC Odin OS (Proxmox ou LXC classique) à partir du modèle construit",
    "read": false,
    "grave": true
   },
   {
    "id": "retirer_docker",
    "label": "Retirer le conteneur Docker",
    "what": "Arrête et supprime le conteneur (le volume de données est gardé)",
    "read": false,
    "grave": true
   },
   {
    "id": "images",
    "label": "Images construites",
    "what": "Taille et empreinte SHA-256 de chaque image (os/sortie)",
    "read": true,
    "grave": false
   },
   {
    "id": "terminal",
    "label": "Ouvrir ou fermer le terminal",
    "what": "Autorise (ou non) le Terminal du bureau à lancer de vraies commandes sur cette machine",
    "read": false,
    "grave": true
   }
  ]
 }
];
