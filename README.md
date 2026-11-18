<div align="center">

# ᛟ Odin Agent IA

**Ton agent personnel, chez toi : il agit sur ta machine, ton réseau et ta maison, apprend de ce qu'il fait, et ne fait jamais rien de grave sans ton accord.**

[![Tests](https://github.com/TOUFATECH/Odin/actions/workflows/ci.yml/badge.svg)](https://github.com/TOUFATECH/Odin/actions/workflows/ci.yml)
![Licence MIT](https://img.shields.io/badge/licence-MIT-green)
![Node 22.18+](https://img.shields.io/badge/node-%E2%89%A5%2022.18-blue)
![macOS · Linux · Windows](https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-ok-lightgrey)

[En trente secondes](#odin-en-trente-secondes) · [Installer](#installer) · [Premiers pas](#premiers-pas) · [Les applis](#les-applis-par-famille) · [Brain et Soul](#brain-et-soul) · [Autonomie](#autonomie-et-ce-qui-est-toujours-validé) · [Sécurité](#sécurité-et-vie-privée) · [État](#fait-en-cours-à-venir) · [Développer](#développer)

</div>

---

## Odin en trente secondes

Odin est un agent personnel qui tourne sur **ta** machine. Tu lui parles (page web, terminal, Telegram, voix) ou tu
ouvres la page d'une de ses applis : il surveille, répare, range, cherche, pilote ta maison et te rend compte.

- **75 applis faites maison, reliées entre elles** : sécurité, machines, données, accès, maison. Plus de 1 000 actions.
- **Il marche même sans IA** : les demandes courantes vers ses applis sont comprises par un moteur à règles, en
  français, anglais, espagnol, allemand et japonais. Il reconnaît la langue d'un texte parmi 232 ; ses refus et ses
  questions suivent la langue de la demande. Aujourd'hui, un modèle de langue extérieur peut encore être branché pour
  parler librement ; ce branchement va être retiré (voir [Brain et Soul](#brain-et-soul)).
- **Tu gardes le dernier mot** : chaque action reçoit une gravité ; ce qui est grave attend ton accord, toujours.
- **Il apprend** : sa mémoire (Brain) et son propre petit réseau de neurones (Soul), entraîné sur ta machine.
- **Tout reste chez toi** : aucun service tiers obligatoire, pas de serveur à côté ; les secrets vont dans un coffre
  chiffré.

Le **guide** complet, avec toutes les applis et leurs phrases : [site/guide.html](site/guide.html)
(publié sur le site du projet). Le détail des fonctions : [docs/utiliser-odin.md](docs/utiliser-odin.md).

---

## Installer

### macOS et Linux

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.sh | bash
```

### Windows (PowerShell, sans droits administrateur)

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.ps1 | iex
```

L'installateur vérifie **Node.js 22.18 ou plus** (s'il manque, il télécharge la version officielle, somme vérifiée,
dans ton dossier personnel), installe Odin (`~/.odin/app`, ou `%LOCALAPPDATA%\Odin\app` sous Windows), crée la
commande `odin`, prépare `~/.odin`, puis te pose trois questions : qui peut ouvrir l'interface, l'inventaire du réseau
local, le démarrage automatique. Sans question : `ODIN_YES=1`.

**Sous Windows**, le démarrage automatique est une tâche planifiée « Odin », à ton nom, lancée à l'ouverture de ta session et **sans fenêtre** (aucun terminal à fermer par erreur). Odin n'y prépare pas de base de données (rien n'est téléchargé pour cela) : il garde ses réglages en fichiers, et son journal dit pourquoi.

**Ce qui est vraiment nécessaire** : Node.js, rien d'autre. Ni serveur de modèles, ni base de données, ni Docker.

**Ce qui sert à certaines applis, si tu le veux** (Odin te le dit quand il en a besoin, et sait souvent l'installer
lui-même) :

| Programme | Pour quoi |
|---|---|
| `ffmpeg` | sons et vidéos (conversion, lecture d'une vidéo) |
| `tesseract`, `pdftoppm` | texte d'une image ou d'un PDF scanné (Théia) |
| `git` | mises à jour d'Odin, dépôts de code |
| `lxc`, `qemu` (Linux) | créer des machines sur ce PC (Hydre) |
| Docker | seulement pour essayer une appli venue d'un dépôt qui se lance avec Docker, ou pour isoler les commandes (`policy.sandbox`) |

<details>
<summary><b>Depuis les sources</b></summary>

```bash
git clone https://github.com/TOUFATECH/Odin.git
cd Odin
npm install          # uniquement les outils de développement
npm link             # la commande « odin »
odin init
```

Node.js exécute directement le TypeScript : il n'y a rien à compiler.
</details>

<details>
<summary><b>Dans un conteneur</b></summary>

Un `Dockerfile` est fourni. Le détail (réseau de la maison, droits, ports) est dans
[docs/installer.md](docs/installer.md).
</details>

**Mettre à jour** : `odin update`. **Désinstaller** : voir [docs/installer.md](docs/installer.md).

---

## Premiers pas

1. **L'interface s'ouvre** à la fin de l'installation (sinon : `odin web`). Elle est joignable en HTTPS sur ton réseau
   local ; la première fois, tu crées ton compte (prénom, nom, adresse, mot de passe).
2. **Sans aucun réglage**, Odin comprend les demandes vers ses applis. Aujourd'hui, Réglages → Modèle permet encore de
   brancher un modèle de langue extérieur (un fournisseur avec ta clé, ou un modèle ouvert lu sur ta machine). Ces branchements vont être retirés : Odin n'utilisera que ses propres modèles, entraînés sur ta machine.
3. **Vérifier** : `odin doctor`.
4. **Lui parler** : dans la page, ou `odin chat` dans un terminal. Essaie : « les alertes », « quels appareils sont
   sur mon réseau ? », « analyse mes téléchargements », « chaque matin à 7 h 30, résume mes tâches ».

Les clés vont dans `~/.odin/env`, lisible par toi seul, chiffré par le coffre : jamais dans `config.json`, jamais
renvoyées à la page.

---

## Les applis par famille

Chaque appli a sa page, ses actions (comprises avec ou sans IA) et ses liens avec les autres. La liste complète, avec
ce que dit chacune, est générée depuis le code dans le [guide](site/guide.html).

| Famille | Applis |
|---|---|
| **Données** (27) | Thot (le Cerveau), Papyrus (pages et bases), Talos (automatisations), Archytas (scripts), Alexandrie (bases de données), Arche (sauvegarde des bases), Écho (dictée), Nébuleuse (fichiers partagés), Andromède (images d'installation), Hermès (logiciels), Glyphes (invites de commande), Pythie (recherche), Chronos (rendez-vous), Pharos (veille), Zénith (tableaux de bord), Alchimie (conversion), Champollion (reconnaissance du texte), Hélios (photos), Dédale (code et dépôts), Plume (bureautique), Perséphone (récupération de fichiers), Atalante (téléchargements), Dodone (requêtes web), Théia (l'œil), Syrinx (l'oreille), Mathésis (apprendre tout seul), Prónoia (prévoir) |
| **Machines** (12) | Hygie (santé de la machine), Argo (conteneurs, sans Docker), Hydre (machines virtuelles), Arachné (sites web), Phénix (sauvegardes), Pulsar (télésurveillance), Atlas (inventaire du matériel), Genèse (déploiement par le réseau), Chroniques (journaux), Héraclès (ménage), Pyramide (disques et partages), Tirésias (santé des disques) |
| **Sécurité** (12) | Némésis (comportement des programmes), Forseti (centre de sécurité), Cerbère (bannissement), Méduse (anti-malware réseau), Ariane (paquets réseau), Asclépios (antivirus), Sirènes (pièges à pirates), Argos (console du parc), Zéphyr (Wi-Fi), Thermopyles (pare-feu), Gygès (vie privée), Achille (tests de tes propres sites) |
| **Accès** (10) | Thésauros (mots de passe), Vortex (VPN), Sphinx (DNS), Valgrind (proxy inverse), Persona (identités et connexion unique), Bifröst (pont vers Internet), Satellites (parc d'ordinateurs), Interprète (connecteurs MCP), Pégase (service du navigateur), Agora (service du store) |
| **Maison** (14) | Hestia (la maison en un écran), Zeus (météo), Ulysse (trajets), Aurore (thèmes), Constellation (appareils), Héphaïstos (modules connectés), Midgard (pièces et scènes), Cyclope (caméras), Orphée (la voix), Vénus (films et séries), Apollon (musique), Héra (contrôle parental), Olympie (jeux rétro), Kéryx (joignable de dehors) |

Partout dans l'interface : `Ctrl K` ou `/` ouvre la barre de commande. La mascotte d'Odin, ses yeux et sa couleur,
explique la page où tu es.

---

## Brain et Soul

- **Brain**, c'est la mémoire d'Odin : tes notes reliées (compatibles Obsidian), ses souvenirs (chacun avec son sujet,
  sa source et sa date), et les fiches qu'il tient à jour sur ses applis. Aujourd'hui, l'appli s'appelle encore
  « Thot » à l'écran ; le nom « Brain » partout est à venir.
- **Soul**, c'est son réseau de neurones à lui (appelé « Noûs » dans le code) : un petit modèle qui s'entraîne **sur ta
  machine**, sur le processeur, à partir de ce qu'Odin est et de ce qu'il apprend, dès qu'Odin est libre (il s'arrête
  dès qu'Odin répond). Il sert à retrouver par le sens et à proposer. Ce qu'on lui fait oublier, il l'oublie aussi.
- **Aucun modèle de départ n'est livré aujourd'hui** : un Odin neuf commence avec un Soul vide. Un modèle de départ
  fabriqué sans aucune donnée privée est en cours (les deux premières versions n'ont pas été retenues). Voir
  [l'état](#fait-en-cours-à-venir).
- **Ses propres modèles (à venir)** : Odin n'utilisera plus aucun modèle qui ne soit pas le
  sien. Les fournisseurs en ligne, les modèles ouverts téléchargés et les modèles de voix téléchargés vont être retirés ;
  Odin aura ses propres réseaux (langue, son, musique, image, vidéo), écrits dans Odin et entraînés sur la machine avec
  tes données (qui restent chez toi) et des jeux de données publics à licence libre.
- **Honnête** : Soul reste petit et se trompe encore souvent sur la bonne appli à proposer. Il calcule sur le processeur ;
  la carte graphique n'est pas utilisable depuis Odin sans programme ajouté. Tant que son propre modèle de langue n'est
  pas entraîné, Odin répondra avec Soul et ses actions directes, sans rédiger de longues réponses ni raisonner ; sur un
  processeur à 4 cœurs, ces réseaux resteront longtemps petits et spécialisés.

---

## Autonomie et ce qui est toujours validé

Avant chaque action qui écrit, exécute ou envoie, Odin se pose des questions simples (l'as-tu demandée ? supprime-t-elle
des données ? envoie-t-elle des données dehors ? engage-t-elle de l'argent ? est-elle difficile à annuler ?). Une table
écrite dans le code en tire une **gravité** : routine, important, grave, bloqué.

| Niveau | Ce qu'Odin fait seul |
|---|---|
| **Prudent** | rien : il te demande |
| **Équilibré** (défaut) | la routine, en te le disant |
| **Autonome** | la routine et l'important |
| **⚡ Odin Breaker** | il mène ses missions sans te déranger, et te fait un rapport le soir |

**Quand personne ne lui parle** (travail continu, rondes) : le sans-risque seul, le reste attend. Il peut garder une
fiche (écrite à côté, jamais par-dessus une fiche existante, marquée « écrit par Odin seul ») et nommer un appareil
encore sans nom ; une routine qu'il voudrait créer est préparée inactive et annoncée, et ne part que quand tu l'actives
dans Talos ; tout le reste qui engage est refusé. À venir : la liste « à valider » retrouvée à ton retour, avec oui ou
non.

**Toujours ton accord, quel que soit le niveau** :

- payer ou engager de l'argent ;
- envoyer un message ou un mail **en ton nom** à quelqu'un d'autre (tu vois le destinataire et le texte exact) ;
- supprimer des données que tu n'as pas demandé de supprimer ;
- ouvrir une serrure, désarmer l'alarme, ouvrir le portail ;
- toucher à ses propres garde-fous, ou au code qui décide de tes droits.

Une page web, un mail ou un document lu n'est **jamais** un ordre : après un contenu extérieur, rien d'engageant ne part
sans toi, même en Odin Breaker. Une tâche automatique ne décide jamais à ta place, et « stop » arrête tout jusqu'à
« reprends ». Chaque décision est notée (onglet Décisions, `odin decisions`). Le détail : [docs/utiliser-odin.md](docs/utiliser-odin.md#décisions-et-autonomie-en-détail).

---

## Sécurité et vie privée

- **La sécurité est dans le code**, pas dans une consigne au modèle : commandes destructrices refusées, contenu
  extérieur marqué non fiable, adresses internes protégées, fichiers confinés.
- **Le coffre** : clés et mots de passe chiffrés avec la clé de la machine (et un mot de passe maître si tu veux),
  masqués partout où Odin écrit, jamais envoyés au modèle.
- **L'interface** : HTTPS, ton réseau local par défaut, un compte, une session par appareil.
- **Tes données restent chez toi**. Aujourd'hui, si tu branches un fournisseur de modèle en ligne, lui seul reçoit tes
  messages ; sans lui, rien ne sort. Ces branchements vont être retirés : Odin n'utilisera que ses propres modèles, entraînés sur ta machine.
- **Reconnaître une personne** (voix, visage ; à venir, avec les propres modèles d'Odin) : seulement les personnes que tu
  enrôles, avec leur accord, en local et chiffré ; éteint tant que personne n'est enrôlé.
- **Le web** : pages publiques, consignes des sites respectées, lecture seule ; Odin ne contourne aucune protection.
- **Ce qui n'est pas garanti** : aucun antivirus ne détecte tout ; ce qui n'a pas été essayé sur du vrai matériel est
  marqué comme tel dans le guide.

---

## Fait, en cours, à venir

« Fait » veut dire publié dans ce dépôt. « En cours » : écrit, en relecture ou en correction. « À venir » : décrit,
pas encore écrit. Cette liste vient de [docs/etat.json](docs/etat.json) ; le chapitre « Ce qui arrive » du guide la
montre aussi.

<!-- etat:debut (généré par « npm run guide » depuis docs/etat.json : ne pas modifier à la main) -->

État au 18/11/2026.

**Fait**

- 75 applis reliées, plus de 1 000 actions — Sécurité, machines, données, accès, maison : une page par appli, des actions comprises avec ou sans IA, des liens automatiques entre elles.
- Heimdall et Mímir : chaque action jugée, le grave toujours validé — Une gravité par action, quatre niveaux d'autonomie, contenu extérieur marqué non fiable, secrets masqués, journal de chaque décision.
- Lyncée, le moteur de recherche d'Odin — Plusieurs moteurs interrogés ensemble, réponses fusionnées, sans service à installer.
- Vénus, le serveur multimédia, dans Odin — Films, séries, chaînes et enregistrements, télécommande par QR code.
- Soul (Noûs), premier jet du réseau de neurones — Un petit réseau qui s'entraîne sur la machine, sans carte graphique : calcul, duel, raisonnement pas à pas.
- Apprendre de tout (chemin rapide) — Une entrée commune pour ce qu'Odin apprend : confiance, source, date, sans doublon.
- Archytas, la fenêtre Script — Créer, garder, suivre et améliorer des scripts, dans un bac à sable.
- Kéryx, l'assistant joignable de dehors — Il agit sur tes messages après un code secret ; SMS et appel écrits mais pas essayés sur du vrai matériel, éteints.
- Métis : les modèles de langue ouverts dans Odin, sans serveur — Odin lit lui-même les modèles ouverts (GGUF), sans serveur de modèles à côté. Ce branchement est en cours de retrait : Odin n'utilisera que ses propres modèles.
- Théia, l'œil d'Odin — Voir les images, lire tout document, même scanné.
- Syrinx, l'oreille d'Odin — Parole, musique et sons de la maison compris sur la machine.
- Mathésis (Odin apprend tout seul) et Prónoia (prévoir) — Il cherche ce qu'il ne sait pas, lit des pages publiques dans les règles des sites, et prévoit d'après ce qu'il a appris chez toi.
- Une page ou un PDF piégé ne fige plus Odin — Lecture des pages en temps linéaire, décompression bornée.
- Soul : le découpage en sous-mots corrigé — De vraies fusions apprises, la marque d'ordre des octets gardée.
- L'application seule sur la branche principale — Les programmes livrés à part (navigateur, store des appareils) ont quitté la branche principale ; Odin garde leur service (compte, synchronisation).
- La sûreté d'abord : argent, envois en ton nom, code sensible, maison, « stop » — Payer, envoyer en ton nom, ouvrir la maison et toucher à ses garde-fous te sont toujours demandés, même en Odin Breaker ; les tâches automatiques ne décident pas à ta place ; « stop » arrête tout jusqu'à « reprends » ; une clé collée dans un message part au coffre ; réglage « réécrire mon code ».
- Soul dans Odin : il apprend dès qu'il est libre — Une file unique vers un corpus chiffré, des séances quand Odin est libre (arrêtées dès qu'il répond), « oublie ça » et la corbeille d'une note retirent aussi de Soul, reprise sûre après une coupure.
- Mathésis sur le vrai web, et « absorber un site » — Lire un site page après page, dans ses consignes, chaque fait gardé avec l'adresse de sa page, jamais deux fois la même page.
- Répondre plus vite — Brain ne relit que ce qui change, la recherche web n'attend plus la page la plus lente, premier mot plus tôt, la mascotte suit le travail.
- Les tâches de tous les jours — Odin fait ce qu'il sait, dit franchement ce qu'il ne sait pas encore faire, et attend toujours ta validation pour ce qui engage.
- Reconnaître la langue, et répondre dans la langue de la demande — Un reconnaisseur écrit dans Odin, sans service extérieur : 232 langues, avec une confiance. Sans modèle de langue, Odin comprend des demandes en 5 langues ; ses refus et ses questions suivent la langue de la demande.
- Talos : les automatisations rangées par dossier — Actives, Brouillons, Corbeille et tes propres dossiers, sous le titre « Workflow » ; au premier lancement, des automatisations déjà actives qui ne font rien d'engageant sans toi.
- Compétences : l'onglet « Plugins » — Les compétences et les connecteurs MCP au même endroit, avec leur graphe ; seul le propriétaire branche un connecteur.
- Thèmes à décor : un fond uni dans la zone de travail — Le décor (pluie, orage…) ne passe plus sous le texte ; il reste visible derrière la barre de côté.
- Mathésis : le rythme de lecture des sites, réglable — Pages par jour et par site (1 000 000 par défaut) et attente entre deux pages d'un même site (2 secondes par défaut, jamais moins ; la consigne du site l'emporte), dans les Réglages de Mathésis ou par la parole. Seul le propriétaire peut monter le rythme.
- Ce qu'Odin fait seul : le sans-risque, le reste attend — En tâche automatique, Odin peut seul garder une fiche (écrite à côté, jamais par-dessus, marquée « écrit par Odin seul ») et nommer un appareil sans nom ; une routine qu'il voudrait créer est préparée inactive et annoncée, et ne part que quand tu l'actives dans Talos ; tout le reste qui engage est refusé.
- Droits des personnes : seul le propriétaire en donne — Donner un accès à une appli, un groupe, un rôle, de l'autonomie, une identité reliée, une adresse de retour ou un mot de passe à une fiche passe par ta validation, qui dit pour qui et montre l'avant et l'après ; retirer s'applique tout de suite. Ni un membre, ni une automatisation, ni une conversation qui a lu un contenu extérieur ne donnent un droit.
- Ce qu'un membre de la famille fait faire sans toi — Six choses, demandées par lui en direct : noter, mettre un rappel, mettre de la musique, allumer ou éteindre une lumière, convertir un fichier (tous les formats d'Alchimie, pas seulement les documents ; un nouveau fichier à côté, l'original intact), faire analyser un fichier. Tout le reste t'est demandé, une tâche qu'il programme aussi ; un invité ne gagne rien. Un fichier jugé dangereux n'est jamais mis à l'écart sans toi : la conversion est refusée et tu es prévenu.
- Ouvrir un port du pare-feu : ta validation quand tu le demandes — La demande dit le port, le protocole, pour quoi, et si la box s'ouvre aussi vers Internet. Une automatisation ne peut pas ouvrir un port, et une appli qui appelle Cerbère d'elle-même non plus tant que tu n'as pas validé l'action de départ.
- Modèles extérieurs : trois premières tranches retirées — Plus aucune sortie vers un service de voix, de traduction, de recherche par modèle ou d'analyse en ligne ; plus de programme d'écoute ou de voix d'autrui sur la machine ; le juge local décide seul ; sans modèle, Odin n'est plus « en démonstration ». Ce qui en dépendait répond « pas encore », dans la langue de la personne.
- Profil, premier lot : la fiche et l'historique de chaque personne — Des données seulement, pas encore d'écran : une fiche par personne qui parle à Odin, et chaque demande notée (qui, quand, ce que ça a donné), sans copie du texte ; rien en mode privé ; un inconnu non appairé n'est qu'un compteur.
- Graphe 3D à côté de chaque graphe — Un espace sombre où les points brillent par groupe, qu'on tourne, qu'on zoome et où l'on va vers un point : carte des applis, page d'une appli qui a un graphe, Plugins, scripts, paquets, le Cerveau et la carte du réseau de la Maison. Un seul composant, écrit dans Odin, sans bibliothèque.
- Vénus : déclarer un dossier de médias et lancer un film — Vénus → Odéon : coller le chemin d'un dossier, « Ajouter le dossier », « Scanner maintenant », toucher un titre : il se lit dans le navigateur. Un dossier introuvable est refusé avec la raison ; l'absence de FFmpeg est dite. Réservé au propriétaire.
- Sous Windows : démarrage sans fenêtre, pas de base à préparer — La tâche d'ouverture de session n'ouvre plus de terminal visible ; au premier démarrage, Odin n'essaie plus de préparer une base qu'il ne peut pas faire tourner (plus de téléchargement ni d'attente en boucle), et le journal dit pourquoi.
- Automatisations : la série « Liens entre applis » — Dans Talos, des liens d'une appli à une autre : une nouvelle adresse vue par Persona est vérifiée par Méduse et tu es prévenu (actif : il ne fait que lire) ; une machine créée par Hydre est ajoutée à l'inventaire d'Atlas (en brouillon). Sur un Odin déjà installé, ils sont proposés dans un encart et rien n'est ajouté sans « Les ajouter ».
- La page d'une appli en premier — Quand une appli a sa propre page, elle s'affiche juste sous l'en-tête ; les chiffres et les boutons génériques passent après, la présentation reste repliée dans l'en-tête. Une appli sans page propre ne change pas.
- Lire les médias reçus : photos, musique, vidéos — Odin lit seul ce qui est rangé dans un fichier : date, appareil et lieu d'une photo ; titre, artiste et album d'une musique ; durée, pistes et sous-titres d'une vidéo ; informations d'un document. Ce qu'il ne comprend pas encore (décrire, transcrire), il le dit avec la raison. Un faux fichier vidéo ne peut plus faire lire un autre fichier de la machine.
- La fenêtre Profil — Un onglet Profil : la liste des personnes qui parlent à Odin, la carte de chacune (rôle, autonomie, identités et leur preuve, accès aux applis en lecture, ta note) et son historique. Sur la carte, « Ce qu'Odin a observé » : langues employées, longueur des demandes, heures habituelles, part de demandes abouties, chacune avec son nombre d'observations et grisée sous vingt ; toi seul peux cacher ou corriger une mesure. Toi, tu vois tout ; un membre, seulement la sienne, et il peut te signaler une erreur ; un invité, rien. Effacer l'historique d'une personne ou d'une période passe par une confirmation qui dit ce qui part et ce qui reste ailleurs. Les droits se règlent encore dans Réglages → Personnes.
- Automatisations : le « + », les vrais champs, les fils, les données, le menu d'un bloc, copier, coller, annuler, refaire, et 50 liens entre applis qui se coupent — Un « + » sur chaque bloc, au centre d'une fenêtre vide et au double-clic ouvre la grille des applis puis leurs fonctions, et pose le bloc suivant, déjà relié. Le bloc d'une appli montre son icône et le nom de sa fonction ; son panneau montre un champ par réglage, avec son aide (le texte reste derrière « Réglages avancés »). À côté d'un champ, « Données » ouvre la liste des données des blocs d'avant, vues au dernier passage : celle que tu choisis se pose en pastille. Toucher un fil ouvre un petit menu (retirer le lien, ajouter un bloc au milieu), et l'on peut relier en tirant un fil. Un clic droit, un appui long ou le « ⋯ » d'un bloc ouvre son menu : l'exécuter seul (il reçoit les données vues au dernier passage, les blocs suivants ne tournent pas, et un bloc qui agit te demande une confirmation à chaque fois), le renommer, le copier, y mettre une note, le retirer ; quand tu renommes un bloc, les données que les autres blocs prennent chez lui suivent son nouveau nom. « Copier » (ou Ctrl+C) puis Ctrl+V colle une copie au nom libre, avec ses réglages et sa note, sans ses fils, à la première place libre sous le bloc copié ; elle reste dans la page, jamais dans le presse-papiers de ton appareil, et un déclencheur webhook ou formulaire collé reçoit sa propre adresse. Ctrl+Z et Ctrl+Y, ou « Annuler » et « Refaire », défont et refont un geste de l'éditeur (cent au plus) sans rien envoyer à Odin ; + et − zooment ; aucun raccourci pendant que tu écris dans un champ. Dans « Dernières exécutions », une ligne dit « bloc seul : » et le nom du bloc quand un seul bloc a tourné ; un réglage de relance qui n'est pas un nombre entier ne relance pas. Les 137 liens déjà écrits entre applis sont montrés dans la fenêtre, rangés par appli, et chacun dit s'il protège. Cinquante d'entre eux se coupent et se rétablissent d'un interrupteur, par toi seul, depuis ton navigateur (21 liens directs et les 29 liens qui passent par une alerte) : couper un lien qui protège demande une confirmation qui dit ce qui ne sera plus protégé, lève une alerte, et le lien se rétablit seul (1 heure par défaut, 24 heures au plus). Pour un lien qui passe par une alerte, l'alerte reste visible dans Odin et seul son message ne part plus ; l'appli continue son travail. Les 87 autres liens ne se coupent pas encore.
- Graphe 3D du Cerveau — Le choix « Graphe | Graphe 3D » à côté du graphe du Cerveau : les mêmes notes et les mêmes liens dans l'espace, groupés par type de note ; toucher une note l'ouvre. Au-delà de 600 éléments, les plus liés sont montrés, et c'est dit à l'écran.
- Validations des actions qui ouvrent quelque chose — Une appli ou une automatisation ne peut plus, par un appel entre applis, ouvrir un port ni publier quelque chose sur Internet sans que tu aies validé l'action de départ : c'est refusé, et tu es prévenu. Fermer un port reste libre. Démarrer le proxy, le tunnel, le VPN ou le DNS, publier un partage, une page publique ou le portail de Persona, libérer un site de la connexion unique, changer l'adresse du VPN ou donner à ses appareils un serveur de noms hors de la maison : la validation dit quoi, où et vers qui. Un bloc d'appel web d'une automatisation, comme ses déclencheurs « flux » et « surveiller une page », ne peut pas non plus viser Odin lui-même ni sa machine, y compris par l'adresse de son tunnel ou par un nom que le proxy mène à lui. Avant de lancer une automatisation qu'il a écrite lui-même et qui agit (appel web, note, message…), Odin te demande ton accord en disant ce que fera chaque bloc ; tant que tu ne l'as pas validée, une autre automatisation ne peut pas la lancer non plus.
- Les chemins sous Windows — Les copies de machines, les fichiers retrouvés et les journaux trouvent le bon chemin sous Windows ; Odin y refuse de ranger des fichiers dans les dossiers du système, même désignés par un autre nom ; les essais n'émettent plus rien sur le vrai réseau.
- Vénus : le bouton « Lire » dans la discussion, et les titres dans toutes les écritures — « Lance-moi », « joue » ou « mets-moi » suivis d'un titre de ta bibliothèque, avec « S02E10 » ou « à la saison 3 épisode 7 », trouvent le bon fichier sans modèle de langue, aussi en anglais, espagnol, allemand et japonais. La réponse porte un bouton « Lire » qui ouvre Vénus et démarre le lecteur à la reprise ; rien ne se lance sans ce clic. Un titre qui porte le nom d'autre chose fait poser la question au lieu de choisir ; une personne sans droit sur Vénus n'apprend rien de la bibliothèque ; le bouton n'existe que dans la discussion de l'application (ni sur les messageries, ni par le raccourci du téléphone, ni dans les notifications). Un titre écrit en japonais, arabe, cyrillique, grec, chinois, coréen, hindi… a son propre identifiant et se retrouve par son titre, au lieu de se confondre sous « sans-titre » ; un titre qui avait déjà son identifiant le garde, avec sa reprise et ses « vus ».
- Profil, les droits : lier un compte à une personne toujours validé, chaque droit au journal — Lier un compte de messagerie ou un téléphone à une personne demande toujours ta validation, qui montre le rôle et l'autonomie que ce compte reçoit, avant → après ; délier s'applique tout de suite. Chaque droit donné ou limité (rôle, autonomie, accès aux applis, groupes, compte, identité liée) est écrit au journal des personnes, sans mot de passe ni clé. La personne dont les droits sont limités n'est pas prévenue.
- Soul, version 3, tour 6 : 605 bonnes applis du premier coup sur 690 — Au jeu figé (toutes les applis, quinze langues, demandes jamais vues), l'aiguilleur de Soul trouve la bonne appli du premier coup pour 605 demandes sur 690 (581 aux tours 4 et 5) : un second temps reclasse ses trois premières applis. Sa préparation est environ deux fois plus rapide, sans changer une seule réponse (mesure non officielle). Aucun modèle ni poids n'est livré dans le dépôt. Dit franchement : cet aiguilleur n'est pas encore branché sur Odin (décision du propriétaire : rien à brancher pour l'instant) ; dans la discussion, c'est toujours Logos qui choisit l'appli.

**En cours (écrit, en relecture ou en correction, pas encore publié)**

- Soul, version 3 : trouver la bonne appli — le tour 7 — En cours : le tour 7. Mesuré une fois au jeu figé : 609 bonnes applis du premier coup sur 690 (605 au tour 6). Pas encore enregistré : sa préparation est d'abord ramenée sous la limite de temps de la suite d'essais, et un défaut trouvé à la relecture est à corriger. Aucun modèle n'est livré : un Odin neuf commence avec un Soul vide. L'aiguilleur n'est pas branché sur la discussion. L'objectif : la bonne application à 100 %.
- L'entraînement de contrôle et le rapport d'entraînement — Des scénarios par domaine, et un rapport qui sépare ce qui marche, ce qui est un défaut et ce qui n'est pas encore codé.
- Pygmalion : produire des documents, des graphes, des images — Écrit, corrigé et rangé dans le dépôt, mais fermé. Ses refus des faux documents et des trucages ont été attaqués avec des demandes jamais vues : environ trois sur dix passent encore. Il ne s'ouvrira pas sur ce filtre seul.
- Retirer les derniers modèles qui ne sont pas ceux d'Odin — Une tranche est écrite et attend ta décision avant d'être enregistrée : la porte du modèle, et la migration qui efface du coffre les clés des services de modèles. Ensuite : plus aucun fournisseur de modèle de langue construit, Métis retiré. Aujourd'hui, ces branchements existent encore dans le code.
- La maquette validée de l'Accueil et de l'écran de la maison — Le plan est écrit : 80 livraisons (lots 0 à 62). Aucun lot n'est encore enregistré : rien de cette maquette n'est dans Odin aujourd'hui. Le premier lot (les thèmes rangés par familles, 49 au choix au lieu de 33) est en train d'être écrit. D'abord les 73 thèmes de la maquette (plus le choix « Automatique ») dans Réglages → Apparence, deux menus (noms à choisir) vers l'accueil et l'écran de la maison, les blocs des automatisations en cercles ; ensuite le verre, la grille de l'accueil, les widgets de tes applis avec tes vraies données, l'écran de la maison jusqu'à la maison 3D, et les bulles des automatisations.
- Profil, la suite : les droits sur la fiche, le graphe d'une personne — En cours : le bloc « Droits » sur la carte d'une personne (limiter en un geste, donner avec ta validation, « Couper tout ») ; écrit en partie, pas encore relu ni enregistré. Aujourd'hui, les droits se règlent dans Réglages → Personnes. À venir : le graphe d'une personne ; demander à Odin « qui a demandé quoi, quand » ; la mesure des applis les plus demandées ; un portrait en phrases quand son propre modèle sera entraîné.

**À venir**

- Ne plus montrer comme ta ville une ville seulement supposée — Tant que tu n'as pas réglé ta ville, l'accueil ne montrera plus comme la tienne une ville seulement supposée d'après l'horloge de la machine : il dira que c'est une supposition et proposera de régler ta ville sur place. Pas commencé.
- Ses propres réseaux : langue, son, musique, image, vidéo — Écrits dans Odin et entraînés sur sa machine, comme Soul et Brain, avec les données du propriétaire (qui restent chez lui) et des jeux de données publics à licence libre, vérifiée et notée. Reconnaître les personnes désignées (voix, puis visage, avec leur accord, en local et chiffré) et créer des images se feront avec eux.
- Ce que cela veut dire, franchement — Tant que son propre modèle de langue n'est pas entraîné, Odin répond avec Soul et ses actions directes, sans rédiger de longues réponses ni raisonner. Sur un processeur à 4 cœurs, ces réseaux resteront longtemps petits et spécialisés.
- Automatisations : la suite des gestes de l'éditeur de scénarios — Le dessin en cercles et en bulles que tu as demandé le 18/11 : il est dans le plan de la maquette validée, pas encore codé. Une étape à la fois : l'exécution montrée bloc par bloc, les branches et les conditions sur un fil, le planning réglé depuis le déclencheur, que faire en cas d'erreur ; couper les autres liens (les appels d'une appli à l'autre, les sondes…) ; plus tard, un déclencheur à l'arrivée d'un mail ou d'un message.
- Graphe 3D, les autres endroits — Le proxy (avec le DNS et le DHCP), le reverse proxy, le VPN, le Profil, une carte d'Internet : il faut d'abord y créer les données du graphe.
- Vénus complet, sans rien d'extérieur : la suite — Déjà là : envoyer un film, une série ou une musique depuis un téléphone ou un ordinateur ; dans le lecteur, la durée entière et le saut à un endroit d'un film converti à la volée ; « lance tel film, telle série, à tel épisode » trouve le bon fichier ; le bouton « Lire » dans la discussion ; les titres dans toutes les écritures. À venir : la même demande dans les autres langues suivies ; les affiches et le scan en arrière-plan ; trouver et récupérer films et séries par Odin lui-même ; YouTube et l'envoi vers une télé existent mais passent encore par un outil extérieur : les faire par Odin lui-même.
- La liste « à valider » retrouvée au retour — Ce qu'Odin a voulu faire seul et qui engage t'attend, avec oui ou non.
- Soul sur le processeur, au maximum ; choix « processeur ou carte graphique » — Plus de calcul utile par seconde. Le choix « carte graphique » existera mais dira qu'il n'est pas disponible : sans programme ajouté, Odin ne peut pas faire calculer la partie graphique d'un processeur.
- Brain et Soul branchés ensemble — Chacun a son identité ; si l'un manque, Odin le dit (« il me manque mon âme ») et aide à réparer ; export et import.
- Les noms « Brain » et « Soul » partout à l'écran
- Corriger sa mémoire à la main ; la capsule juste — « Que sais-tu de moi ? », « oublie ça », « c'est faux », et Odin remarque tes corrections faites à la main.
- Consolidation à tout moment — Un passage léger dès qu'Odin est libre, un passage profond par jour.
- Soul apprend de tout
- La mascotte reliée à Brain et Soul — Ses réactions choisies par Soul parmi celles que les règles permettent, et ses souvenirs dans Brain. Son visage reste ses yeux et sa couleur ; ses marques autour d'elle et ses habits de fête sont gardés.
- Toutes les langues, la suite — Comprendre sans modèle dans plus de langues, la langue de chaque personne retenue, la langue de l'interface choisie au premier réglage, des sous-titres traduits. Shimaoré et kibushi avec la matière que fournira le propriétaire, et Odin dit quand il n'est pas sûr.
- Lui parler à la voix, à plusieurs
- Des widgets posés par la parole ; le nouvel accueil — « Mets la météo en haut à gauche », « agrandis-le », « remets comme avant » ; puis l'accueil et l'écran de la maison redessinés.
- Parler à Odin en SSH — Une porte écrite dans Odin : la même conversation dans un terminal, avec la mascotte en caractères ; clés seulement ; réseau de la maison ; fermée tant que tu ne l'ouvres pas dans les Réglages.
- Mails, factures et actualités — Tri, résumé, brouillon par défaut, plusieurs boîtes ; factures et abonnements ; actualités en fiches.
- Comptes et adresses de façade — S'inscrire pour toi pas à pas, une adresse par site sur ton domaine, un registre de qui connaît quoi ; un CAPTCHA reste ton geste.
- Navigateur, achats, cinéma — Toujours validé au paiement.
- Trajets et horaires calculés dans Odin — « Je prends le bus » : sans service extérieur (gros chantier).
- Tout le parc par la parole — Pause d'une VM, « crée-moi une VM », essai d'un dépôt GitHub dans une machine isolée, contrôleur de domaine et GPO, servir son propre modèle de langue aux autres machines.
- Plusieurs aides en même temps, Odin chef d'orchestre
- Mathésis : vidéos, musique, images — Lire aussi les médias, dont la vidéothèque de Vénus, sans jamais rien modifier.
- Un entraînement de tout, puis un banc comparé aux bancs publics — Sur le raisonnement, c'est le propre modèle de langue d'Odin qui sera mesuré, une fois entraîné.
- Rangement du dépôt et revue finale — Dossiers rangés, code mort retiré, puis une revue complète de tout le code.

<!-- etat:fin -->

---

## Commandes utiles

| Commande | Rôle |
|---|---|
| `odin web` | l'interface, les canaux et les tâches planifiées |
| `odin chat` · `odin demande "…"` | parler dans le terminal · une seule demande |
| `odin doctor` · `odin test` | diagnostic · essai réel de chaque fonction reliée |
| `odin decisions` · `odin audit` | ce qu'Odin a décidé, et pourquoi · le journal brut |
| `odin breaker on\|nuit\|off` | Odin Breaker |
| `odin memory …` · `odin skills …` | mémoire · compétences |
| `odin net …` | réseau local |
| `odin backup` · `odin restore` | sauvegarde chiffrée · restauration |
| `odin update` | mettre Odin à jour |

Toutes les commandes, la configuration et le dépannage : [docs/utiliser-odin.md](docs/utiliser-odin.md#toutes-les-commandes).

---

## Développer

```bash
npm install
npm run check        # référence des garde-fous, types, essais
npm run guide        # régénère le guide (site/guide.html) et l'état du README depuis le code et docs/etat.json
npm run site         # régénère les autres pages du site (site/*.html)
```

| Où | Quoi |
|---|---|
| [`src/`](src/LISEZ-MOI.md) | le code d'Odin (TypeScript exécuté directement par Node) ; la table des dossiers est dans son LISEZ-MOI |
| [`test/`](test/LISEZ-MOI.md) | les essais (`node --test`), les bancs de mesure |
| [`tools/`](tools/LISEZ-MOI.md) | fabrication du guide, du site, de la référence des garde-fous |
| [`docs/`](docs/LISEZ-MOI.md) | protocoles, plans, et l'état de chaque chose |
| [`site/`](site/) | le site public (pages générées) |

Ajouter un outil = un objet avec un nom, une description, un **niveau de risque** et une fonction `run` : Heimdall et
Mímir s'occupent du reste. Modifier un fichier des garde-fous (`src/heimdall/`, et quelques autres) demande de refaire
leur référence : `npm run noyau:empreintes`.

Suivi du projet : [AVANCEMENT.md](AVANCEMENT.md).

---

## Licence

[MIT](LICENSE) © TOUFATECH

Le dictionnaire français de Plume vient de Grammalecte (MPL 2.0) : fichiers inchangés, avec leur licence à côté.
