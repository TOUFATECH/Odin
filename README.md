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
| **Données** (27) | Thot (le Cerveau), Papyrus (pages et bases), Talos (automatisations), Archytas (scripts), Alexandrie (bases de données), Amphore (sauvegarde des bases), Écho (dictée), Nébuleuse (fichiers partagés), Andromède (images d'installation), Hermès (logiciels), Glyphes (invites de commande), Pythie (recherche), Chronos (rendez-vous), Pharos (veille), Zénith (tableaux de bord), Alchimie (conversion), Champollion (reconnaissance du texte), Hélios (photos), Dédale (code et dépôts), Plume (bureautique), Perséphone (récupération de fichiers), Atalante (téléchargements), Dodone (requêtes web), Théia (l'œil), Syrinx (l'oreille), Mathésis (apprendre tout seul), Prónoia (prévoir) |
| **Machines** (12) | Hygie (santé de la machine), Arche (conteneurs, sans Docker), Hydre (machines virtuelles), Arachné (sites web), Phénix (sauvegardes), Pulsar (télésurveillance), Atlas (inventaire du matériel), Genèse (déploiement par le réseau), Chroniques (journaux), Héraclès (ménage), Pyramide (disques et partages), Tirésias (santé des disques) |
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
  tes données (qui restent chez toi) et des jeux de données publics à licence libre. Une seule exception, décidée le
  18/11 : la programmation (écrire, lire, corriger du code, créer des sites) pourra passer par un modèle extérieur, et
  chaque envoi attendra ta validation, avec ce qui part sous tes yeux. Rien de cette exception n'est encore construit.
- **Honnête** : Soul reste petit. Au jeu figé (quinze langues, demandes jamais vues), il trouve la bonne appli du premier
  coup pour 609 demandes sur 690, soit 88,3 % (tour 7, mesuré le 18/11/2026) ; cet aiguilleur n'est pas encore branché sur Odin. Il calcule sur le processeur ;
  la carte graphique n'est pas utilisable depuis Odin sans programme ajouté. Tant que son propre modèle de langue n'est
  pas entraîné, Odin répondra avec Soul et ses actions directes, sans rédiger de longues réponses ni raisonner ; sur un
  petit processeur, ces réseaux resteront longtemps petits et spécialisés.

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

Un membre de la famille ne confirme jamais lui-même une action grave : elle ne part pas, et sa demande t'arrive (qui
demande, dans quelle appli, quoi). Si tu dis oui, elle part à son nom ; sinon, ou sans réponse à temps, rien ne part.
Quand tu ouvres Odin, les demandes qui attendent encore ta réponse te sont remontrées. L'écran de la maison lui est fermé.

Une page web, un mail ou un document lu n'est **jamais** un ordre : après un contenu extérieur, rien d'engageant ne part
sans toi, même en Odin Breaker. Une tâche automatique ne décide jamais à ta place, et « stop » arrête tout jusqu'à
« reprends ». Chaque décision est notée (onglet Décisions, `odin decisions`). Le détail : [docs/utiliser-odin.md](docs/utiliser-odin.md#décisions-et-autonomie-en-détail).

---

## Sécurité et vie privée

- **La sécurité est dans le code**, pas dans une consigne au modèle : commandes destructrices refusées, contenu
  extérieur marqué non fiable, adresses internes protégées, fichiers confinés.
- **Le coffre** : clés et mots de passe chiffrés avec la clé de la machine (et un mot de passe maître si tu veux),
  masqués partout où Odin écrit, jamais envoyés au modèle. Un mot de passe écrit dans la conversation y est rangé
  aussitôt ; seul le texte sans le secret est gardé.
- **La clé d'accès** (raccourcis du téléphone, scripts) lit et parle seulement : ce qu'elle demande de faire attend ta
  validation dans Odin, et tout geste qui écrit demande ta session.
- **L'interface** : HTTPS, ton réseau local par défaut, un compte, une session par appareil.
- **Tes données restent chez toi**. Aujourd'hui, si tu branches un fournisseur de modèle en ligne, lui seul reçoit tes
  messages ; sans lui, rien ne sort. Ces branchements vont être retirés : Odin n'utilisera que ses propres modèles, entraînés sur ta machine, sauf pour la programmation (à venir, chaque envoi validé par toi).
- **Le disque** : `odin doctor` dit si le disque des données d'Odin est chiffré, et sinon comment le chiffrer toi-même ;
  il ne bloque rien et ne lit jamais la clé. Le chiffrement à l'installation et la clé de secours sont à venir.
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

État au 26/11/2026.

**Fait**

- 75 applis reliées, plus de 1 000 actions — Sécurité, machines, données, accès, maison : une page par appli, des actions comprises avec ou sans IA, des liens automatiques entre elles.
- Heimdall et Mímir : chaque action jugée, le grave toujours validé — Une gravité par action, quatre niveaux d'autonomie, contenu extérieur marqué non fiable, secrets masqués, journal de chaque décision.
- Lyncée, le moteur de recherche d'Odin — Plusieurs moteurs interrogés ensemble, réponses fusionnées, sans service à installer.
- Vénus, le serveur multimédia, dans Odin — Films et séries, télécommande par QR code.
- Soul (Noûs), premier jet du réseau de neurones — Un petit réseau qui s'entraîne sur la machine, sans carte graphique : calcul, duel, raisonnement pas à pas.
- Apprendre de tout (chemin rapide) — Une entrée commune pour ce qu'Odin apprend : confiance, source, date, sans doublon.
- Archytas, la fenêtre Script — Créer, garder, suivre et améliorer des scripts, dans un bac à sable.
- Kéryx, l'assistant joignable de dehors — Il agit sur tes messages après un code secret ; SMS et appel écrits mais pas essayés sur du vrai matériel, éteints.
- Métis : les modèles de langue ouverts dans Odin, sans serveur — Odin lit lui-même les modèles ouverts (GGUF), sans serveur de modèles à côté. Ce branchement est en cours de retrait : Odin n'utilisera que ses propres modèles, sauf pour la programmation (ta décision du 18/11).
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
- Soul, version 3, tour 7 : 609 bonnes applis du premier coup sur 690 — Au jeu figé (toutes les applis, quinze langues, demandes jamais vues), l'aiguilleur de Soul trouve la bonne appli du premier coup pour 609 demandes sur 690, soit 88,3 % (605 au tour 6) ; l'appli et l'action justes ensemble : 426 (412 au tour 6) ; quand il décide seul, 0 appli fausse sur 69. Le second temps regarde jusqu'à cinq applis candidates, et l'action est choisie en la comparant aux autres actions de la même appli ; une correction refaite change aussi l'action tout de suite. Dit franchement : sa préparation est plus longue qu'au tour 6, aucun modèle ni poids n'est livré dans le dépôt, et cet aiguilleur n'est toujours pas branché sur Odin : dans la discussion, c'est toujours Logos qui choisit l'appli. L'objectif reste la bonne appli à 100 %.
- Apparence : les thèmes rangés par familles, 49 au choix — Dans Réglages → Apparence, les thèmes sont rangés par familles, chacune avec son nombre. Ce lot a fait les deux premières : « Les thèmes d'Odin » et « Événements de l'année » (16) ; les thèmes d'événements se choisissent comme les autres, à la main ou en le disant ; le choix est gardé sur tous tes écrans. « Au hasard » ne tombe jamais sur un événement, ni sur le thème en cours. Les familles « Mis en avant » et « Thèmes de Hestia » sont venues ensuite (voir plus bas).
- Apparence : « Mis en avant », six thèmes de la maquette validée — En tête de Réglages → Apparence, la famille « Mis en avant » : Glace (aux couleurs de la maquette), Vitre, Glace nuit, Néon, Home Assistant et Maison claire. Sur l'accueil, ils passent maintenant sous le verre (plus bas) ; ailleurs, le fond reste uni. « Minuit » ne change pas.
- Apparence : les 31 thèmes de Hestia, 85 thèmes au choix — Les 31 thèmes de l'écran de la maison se choisissent aussi pour Odin, dans Réglages → Apparence, famille « Thèmes de Hestia », avec leurs décors et les noms que l'écran de la maison leur donne. Un thème de Hestia s'affiche avec le nom de sa famille. En tout, 85 thèmes en quatre familles : Mis en avant (6), Les thèmes d'Odin (32), Thèmes de Hestia (31), Événements de l'année (16). Sur l'accueil, ils passent maintenant sous le verre (plus bas). L'écran de la maison garde ses propres thèmes. « Au hasard » peut tomber sur un thème mis en avant ou de Hestia, jamais sur un événement.
- Menu : « Aujourd'hui » devient « Accueil » — Un seul nom pour le premier écran : dans le menu, la barre du haut, la barre du bas du téléphone, le titre de la page, la palette et le guide de la mascotte. Aucune adresse ne change.
- Menu : « Home Assistant » ouvre l'écran de la maison, « ← Odin » ramène à Odin — Sous « Accueil », l'entrée « Home Assistant » ouvre l'écran de la maison (Hestia). Toi seul la vois, et seulement quand Hestia est là ; un membre de la famille ne la voit jamais. Sur l'écran de la maison, « ← Odin » ramène à Odin (pas sur une tablette ouverte par sa clé). Sur téléphone, ouvrir puis fermer « Plus » ne laisse plus une page vide.
- L'écran de la maison fermé aux membres de la famille — Une session de membre n'y a plus aucun droit, même s'il a le droit sur Hestia : état, caméras, réseau, thème, discussion et boutons lui sont refusés. Un membre ne se crée plus de clé de tablette, et toi seul ranges la fenêtre. Les clés de tablette et ta session ne changent pas.
- Un membre de la famille ne confirme plus lui-même une action grave — Depuis la page d'une appli, la barre des applis ou le port direct d'une appli, un membre ne peut pas confirmer lui-même une action grave : elle ne part pas, et c'est noté au journal des connexions. Ce que tu fais, les automatisations et ce qu'un membre fait librement ne changent pas. Sa demande t'est envoyée (élément suivant).
- La demande d'un membre arrive chez toi — Quand un membre touche une action grave, elle ne part pas : sa demande t'est présentée par le validateur d'Odin, comme celles qui viennent des messageries (qui demande, dans quelle appli, quoi), sur Odin ouvert ou sur ta messagerie. Oui : l'action part à son nom, après un nouveau contrôle de ses droits. Non, ou pas de réponse dans le délai (5 minutes par défaut) : rien ne part. Il lit « Demande envoyée… », puis ta réponse. Au plus 3 demandes en attente par membre et 10 en tout ; une action que toi seul règles reste refusée, sans demande. Ce qu'un membre fait est noté à son nom, sans chasser du journal ce qu'Odin a fait.
- Les validations en attente te sont remontrées — Quand tu ouvres Odin, changes de conversation ou reviens après une coupure, tu vois toutes les demandes qui attendent encore ta réponse, celles d'Odin comme celles d'un membre, avec Autoriser, Refuser et l'heure limite. Une demande expirée ou déjà répondue perd ses boutons. Le membre lit « ⏳ Demande envoyée… ». Dans le suivi des manips, une action faite pour un membre dit « à la demande de … (membre de la famille) », dans une liste à part. Seul le propriétaire lit cette liste d'attente.
- Garde-fou du dépôt public : les données d'exemple de la maquette n'entrent pas dans le code — Deux essais refusent les noms de la maquette de l'accueil et de l'écran de la maison (lieux, machines, adresses, personnes, titres) dans le code. Ils ne connaissent ces mots que par des empreintes chiffrées avec une clé gardée hors du dépôt, et ne disent jamais le mot trouvé : seulement le fichier et la ligne.
- « Disque d'Odin » dans odin doctor ; BitLocker lu par les clés d'installation — « odin doctor » dit si le disque des données d'Odin est chiffré : dossier d'Odin, clé de la machine, application et sauvegardes, liens et jonctions résolus. « Chiffré » seulement si tout l'est ; au moindre doute, « je ne peux pas le savoir » ; avec la marche à suivre pour le chiffrer toi-même. Rien ne bloque, Odin ne lance aucun chiffrement et ne lit jamais la clé. Phrases en français, anglais, allemand, espagnol et japonais (les autres langues : en anglais). Sous Windows, l'onglet « Clé USB » de Genèse lit enfin BitLocker (l'état de chaque lecteur, jamais la clé) et ne touche pas un disque chiffré, suspendu ou en pause.
- Clés d'installation : un disque au chiffrement inconnu n'est pas touché — Dans Genèse, onglet « Clé USB » : un disque dont Odin ne peut pas lire le chiffrement (sans droits d'administrateur, ou une partition de données sans lettre) est traité comme chiffré. Aucune partition créée, Windows jamais réduit ; le refus dit pourquoi, lecteur par lecteur, et Odin ne demande jamais la clé de récupération. Une étiquette « Chiffrement inconnu » s'affiche sur le disque.
- Inviter quelqu'un de la famille depuis Réglages → Personnes — Dans Réglages → Personnes, « Inviter quelqu'un de la famille » : le nom, un e-mail facultatif (Odin y envoie le lien), la durée (1 à 30 jours, 7 par défaut) et le groupe (« famille » par défaut, jamais « admin »). Tu valides, puis tu as le lien à usage unique, « Copier » et un QR code ; la personne choisit elle-même son identifiant et son mot de passe. La liste des invitations en cours a un bouton « Annuler ». Un membre ne voit pas ce bloc. Le lien n'est pas gardé dans le navigateur : il quitte la page quand tu fermes le bloc ou annules l'invitation. C'est le même lien d'invitation que dans Persona, avec la même validation.
- Les filets de l'accueil et de l'écran de la maison — Deux essais tiennent tout ce que l'accueil et l'écran de la maison savent faire aujourd'hui (38 choses de l'accueil, dont ton accord avant une action grave ; chaque commande de l'écran de la maison et l'ordre qu'elle envoie ; ce qu'une tablette reçoit et ne reçoit pas), pour qu'aucune livraison de la maquette n'en perde rien. Rien ne change à l'écran.
- Persona : un groupe vide a ses cases d'applis ; une invitation acceptée au journal — Un groupe qu'on vient de créer, même vide, a tout de suite ses cases d'applis dans l'onglet Accès de Persona. Une invitation acceptée est notée au journal des droits, comme une personne ajoutée à la main.
- Odin se recode, la fondation : le brouillon d'une réécriture — Rien ne se voit encore et rien n'est branché : c'est la base des étapes suivantes. Le brouillon d'une réécriture est chiffré et gardé hors du code ; sa différence est complète et numérotée, rien n'est coupé. Odin calcule la liste de ce qu'un membre ne pourra jamais demander : le noyau, le code sensible et tout fichier qu'ils chargent (imports suivis, même ceux faits à la demande).
- Modèles qui ne sont pas ceux d'Odin : le retrait révisé le 19/11, les agents connectés sont gardés — Ta décision du 19/11 a révisé le retrait : les agents connectés sont gardés. Aucune clé n'est effacée, ni la connexion par abonnement, ni la liste des fournisseurs : un service de modèles que tu as réglé répond encore. Chaque appel est noté (Réglages → Modèle → « Qui a répondu »). Un agent n'a jamais la valeur d'un secret du coffre (voir « Secrets dans la conversation »). Sans aucun agent prêt, Odin répond avec ses seuls moyens et dit « pas encore » pour le reste, dans ta langue ; les questions qu'il gardait pour un modèle sont alors rangées dans une note du Cerveau, secrets masqués, jamais quand le coffre est verrouillé. Le modèle ouvert lu par Métis ne sert plus de secours, et le conseil qui proposait d'en télécharger un est retiré. Ce qui était retiré le reste : la voix, la traduction, la recherche et l'analyse par un service en ligne, le second avis d'un modèle dans les décisions (plus haut). Pas construit : classer les agents depuis les Réglages, le vérificateur des actions risquées, l'exception du 18/11 pour la programmation (plus bas).
- Automatisations : les blocs en cercles, leurs bulles et la bulle des données — Chaque bloc est un rond avec l'icône de son appli et son nom dessous, le « + » à droite. Après un test, chaque bloc qui a tourné porte une bulle avec son nombre d'éléments (une bulle rouge « ! » pour une erreur). Toucher la bulle ouvre ce que le bloc a rendu (20 éléments au plus), la durée ou l'erreur entière. Les données restent dans la page.
- Automatisations : ce qu'un bloc a reçu, « oui » et « non » sur les liaisons du « Si », « Filtrer » en petit rond — Le moteur garde ce qu'un bloc a reçu : les 20 premiers éléments et leur nombre, dans la même ligne d'exécution que ce qu'il a rendu, aussi longtemps. La bulle des données montre cette entrée vraie ; pour un passage d'avant, elle montre l'entrée déduite du bloc d'avant quand c'est sûr, et le dit. Un « Si » écrit « oui » et « non » sur ses deux liaisons. « Filtrer » se dessine comme un petit rond posé sur la liaison, avec le même menu, les mêmes liaisons et la même place. Rien de ce qui est enregistré ne change : une automatisation d'avant s'ouvre au même endroit.
- Garde-fous d'Odin (le noyau) : un « oui » ne vaut que pour une seule demande — Un chemin écrit par un détour est reconnu comme le fichier qu'il désigne : les garde-fous demandent leur validation, les fichiers secrets restent refusés. Un « oui » tout court ne valide que s'il n'y a qu'une demande en attente ; sinon, la liste revient. Un « oui » arrivé trop tard dit que rien n'est parti.
- Double facteur du compte administrateur — Dans Réglages → Accès : un QR code à scanner avec une appli de codes, un premier code pour confirmer, puis le code à 6 chiffres demandé à chaque connexion. Un code ne sert qu'une fois ; des codes faux font attendre, et Odin te prévient. Téléphone perdu : un lien envoyé à l'adresse e-mail du compte, avec ton mot de passe, retire le double facteur et propose un nouveau QR code ; sinon, une commande sur la machine d'Odin, Odin arrêté. Le secret est gardé chiffré.
- Une seule conversation avec Odin — Plus de « Nouvelle conversation » ni de liste : un seul fil, lu page par page (« Voir plus haut »), avec tes anciennes conversations dans l'ordre des dates et ce que tu as dit depuis le téléphone, marqué. L'Historique cherche dans tout, va à un jour et exporte tout. « Masquer » vide l'écran sans rien effacer (plus bas).
- Garde-fous mis à jour d'un clic, et le journal des tours — Une nouvelle version des garde-fous est acceptée par ton seul clic « Mettre à jour », et seulement si c'est la version officielle, revérifiée fichier par fichier ; « Voir le code des garde-fous » montre ce qui change ; une clé d'API ne vaut pas ton clic. Chaque message devient un « tour » écrit avant tout traitement (qui, canal, fil, but, état) ; en mode privé, rien n'est écrit.
- L'âge et les informations d'une personne — Dans Persona, une personne a, en plus de son nom, une année de naissance et une langue, toutes deux facultatives. Elles se donnent à l'ajout, à la modification, sur la page d'invitation et dans « Mon compte ». Elles sont chiffrées sur le disque. Seule l'année est gardée ; l'âge est recalculé à chaque lecture. Une année impossible (dans l'avenir, avant 1900) est refusée avant toute confirmation. Un membre ne voit et ne corrige que les siennes. Rien de nouveau ne part vers un logiciel relié.
- Secrets dans la conversation : rangés au coffre — Un identifiant ou un mot de passe écrit dans la conversation va au coffre de la bonne personne avant toute écriture ; seul le texte sans secret est gardé, et Odin dit en une ligne ce qu'il a rangé. Un agent n'a jamais la valeur : le serveur la met juste avant l'outil. « Masquer » vide l'écran de la discussion sans rien effacer ; « Réafficher l'historique » remet tout. Le coffre s'écrit à côté puis d'un geste : une coupure laisse l'ancien intact.
- Le masqueur des secrets ne s'emballe plus — Une très longue suite d'espaces collée à « mot de passe » ne fait plus travailler Odin des minutes : tout ce qui était masqué l'est encore.
- La clé d'accès lit et parle seulement — Avec la clé d'accès (raccourcis du téléphone, scripts), Odin répond aux questions ; tout geste qui écrit demande ta session (refus « Ce geste demande ta session »). Ce qu'une phrase venue avec la clé demande de faire attend ta validation dans Odin. La clé ne valide jamais rien elle-même et n'ouvre plus l'écran de la maison.
- Activer ou désactiver chaque appli — Un bouton marche/arrêt sur la carte de chaque appli, « Désactiver » (avec confirmation) ou « Activer » sur sa page. Une appli désactivée reste visible en gris, ne fait plus rien et ses actions sont refusées ; ses données sont gardées. Toi seul, depuis ta session.
- Genèse : les clés USB (maquette validée) — Les huit lots de la maquette : choisir la clé (un disque interne ou celui d'Odin n'est jamais accepté), la façon de démarrer, les systèmes et la place, les logiciels et scripts vérifiés, « Vérifier » puis écrire (phrase tapée et appui de 3 s), « Mes clés », l'écran de démarrage graphique et le mode texte, et la parole. Pour l'instant, seule une clé déjà ODIN est écrite ; une clé neuve est refusée. Réservé au propriétaire.
- Genèse : les systèmes et le déploiement par le réseau (maquette validée) — Les onze lots : la bibliothèque des systèmes, le catalogue et les versions, la fiche et le retrait, les logiciels et leurs profils, « Déployer » vers une clé, des PC par le réseau ou une machine virtuelle, le suivi PC par PC, le serveur de démarrage par le réseau, le menu PXE, le même écran de démarrage que la clé, et la parole. Avant d'effacer un PC : phrase tapée, appui de 3 s, et le PC doit être exactement celui autorisé. Réservé au propriétaire ; essayé sur des PC et des réseaux simulés.
- Arche : les conteneurs (maquette validée) — Les conteneurs s'appellent maintenant Arche (avant Argo) et la sauvegarde des bases Amphore (avant Arche). Tableau de bord et fiche d'un conteneur, volumes et réseaux, piles décrites dans un fichier, catalogue de dix applis, mises à jour proposées (jamais toutes seules, retour à l'ancienne si la nouvelle ne tient pas), et la parole. Réservé au propriétaire ; essayé sur un moteur simulé ; sous Windows, la page dit ce qui viendra.
- Hydre : les machines virtuelles (maquette validée) — Pause et reprise, la liste des machines et ce qui en dépend, créer une machine en quatre étapes (Odin refuse ce que ce PC ne peut pas donner), l'écran d'une machine dans le navigateur (clavier, souris, plein écran) et ses instantanés (un automatique avant une mise à jour, gardé 7 jours). Réservé au propriétaire ; jamais essayé sur une vraie machine virtuelle.
- Sphinx : appareils, adresses, DHCP et DNS (maquette validée « Réseau ») — Qui a quelle adresse, bloquer ou mettre en pause un appareil, les adresses fixes et le plan, les réglages du DHCP (Odin refuse de distribuer si un autre serveur répond), les noms du réseau, le journal du DNS, le blocage, et les serveurs : la racine d'abord, un secours public seulement si elle ne répond pas (« Racine seule » possible). Réservé au propriétaire ; un membre ne voit que son appareil. Jamais essayé sur un vrai réseau.
- Vortex : les appareils du VPN et leur QR code (maquette validée « Réseau ») — Chaque appareil en carte, « Couper » et « Retirer », l'état du tunnel ; ajouter un appareil en trois étapes. Le QR code est caché, montré sur un geste, masqué seul après 2 minutes ; le remontrer demande ton accord ; une tablette ne le reçoit jamais. Les clés du VPN sont chiffrées sur le disque. Réservé au propriétaire ; jamais essayé sur un vrai tunnel.
- Vénus : l'interface de l'appli d'origine, le lecteur, les affiches — Vénus s'ouvre dans Odin avec l'interface de l'appli Vénus d'origine : planètes, bibliothèques, fiches, recherche, « Qui regarde ? ». Le lecteur avec ses touches, ses pistes audio, ses qualités, ses sous-titres et la bande-annonce. Les vignettes sont tirées par Odin ; affiches et fiches seulement si tu l'as réglé, gardées chez toi. Réservé au propriétaire et à ses profils.
- Vénus : faire venir un film ou une série, sans service extérieur — Un clic sur un titre « à venir » : Odin garde la demande, cherche dans les sources que tu règles toi-même, télécharge (aussi par partage de fichiers, avec son propre moteur), passe l'antivirus et range le fichier. « À venir », « Mes envies », « Nouveau », « Nouveautés » ; « Ajouter à mon calendrier » avec un lien personnel. La demande d'un membre attend ta validation.
- Vénus : La maison, première part — « Ce soir » et « Qui regarde ce soir ? », le vote en famille (code de 4 lettres ou QR, expire après 3 h), « Mes statistiques » de l'année et la rétrospective, les collections et les listes de chaque profil. Écritures réservées au propriétaire.
- Accueil : la grille, le bandeau, le menu, la barre du bas — La grille de 12 colonnes (4 au téléphone), tirer le coin et les sept tailles, glisser un widget, douze animations, le tiroir « Ajouter un widget », le bandeau du haut avec sa cloche, le menu dans l'ordre de la maquette, la barre du bas au téléphone avec Odin au centre, le plein écran « seulement les widgets » et le nid d'Odin. Home Assistant et Vénus s'ouvrent dans la page d'Odin.
- Accueil : les widgets, « Régler » et qui voit quoi — Le même en-tête pour tous les widgets et cinq états (prêt, vide, source absente, refusé, ancien). « ⋯ » ouvre « Régler » : titre, taille, ce que fait un toucher, « Ouvrir à… », copier vers l'autre écran, retirer. Le serveur décide widget par widget ce qu'un membre ou une tablette reçoit ; la vie privée reste fermée sauf ce que tu ouvres à une personne.
- Accueil : la page « Aujourd'hui » en widgets — Les cinq chiffres en tête, « Tu veux sans doute », « À faire », « Ce qu'Odin a fait », « Comment Odin se comporte » et les quatre tuiles (Surveillance, Sauvegarde, Résumé du matin, Application). Chez toi, tout l'accueil est une grille de widgets ; ces widgets restent à toi seul. Un membre garde son affichage d'avant.
- Thèmes : les cartes, le nom dit, l'interrupteur d'humeur — Réglages → Apparence montre une carte par thème avec son aperçu. Chaque thème se choisit par son nom, dit ou écrit ; si un nom est porté par plusieurs thèmes, Odin demande lequel. L'interrupteur « Odin change de thème selon son humeur ». L'écran de la maison lit ses 31 thèmes dans le même catalogue.
- Gestes réservés au propriétaire, et téléchargements par adresse — Phénix (restaurer, parcourir, télécharger les sauvegardes), Genèse (réinstaller un PC, éteindre le serveur) et les commandes d'Arche sont au propriétaire seul. Importer une ISO, un logiciel, ou un téléchargement de Vénus ne suit plus une redirection vers la maison ou la machine d'Odin.
- Vénus : La maison, seconde part — La séance (on la rejoint avec un code de 4 lettres), la télécommande (un écran connu d'Odin, −30 s, lecture ou pause, +30 s, un QR code pour un autre téléphone) et les téléchargements : une version légère en 720p ou 480p préparée sur la machine d'Odin, gardée 7 jours, sans jamais remplir le disque. Un profil enfant ne télécharge pas ; chaque profil ne voit que les siennes. Pas encore : la croix, les chaînes et « Reprendre sur la TV ».
- Vénus : le tableau de bord de l'administration — Pour l'administrateur seulement : le nombre d'œuvres et la place prise, les lectures en cours (sans adresse d'appareil), les écrans connus, l'activité, la santé de la machine (« source absente » quand une mesure manque, jamais 0 %), les tâches de fond avec « Analyser », chaque médiathèque. Un profil enfant n'a ni l'entrée ni la page.
- Le réseau par la parole (maquette validée « Réseau ») — En français, anglais, espagnol et allemand : « qui est connecté sur le VPN » (selon les droits de qui demande), « quelle machine a l'adresse… » (jamais la box ni Odin), puis « bloque-la », qui ne vaut que pour la seule machine nommée, avec la confirmation habituelle. Aucune clé ni QR code n'est jamais dit.
- Hydre : cloner et exporter une machine — Cloner une machine éteinte (copie complète, ou copie liée depuis un modèle), ranger une machine comme modèle, l'exporter dans un fichier .ody (même allumée), importer un .ody après l'antivirus. Réservé au propriétaire, dans le budget d'Hydre, noté dans « qui a fait quoi ». Pas encore : vers une vraie clé, vers un serveur, sous Windows.
- Les contenus venus de dehors ne bloquent plus Odin — Un texte piégé (des milliers de balises jamais fermées, une très longue ligne) ne fige plus Odin et ne peut plus imiter la fin de l'enveloppe qui le marque comme une donnée ; la source écrite dans l'en-tête tient sur une ligne. Validé par toi le 25/11.
- Discussion : le cadre « Venu de l'appli » — Le texte rendu par une appli s'affiche dans un cadre qui dit d'où il vient ; hors du cadre, c'est Odin qui parle. Ce texte n'est jamais suivi comme une consigne ; il ne peut ni sortir du cadre ni imiter l'avertissement. Pas encore : la notification du système, la voix et les autres canaux ; les mots en d'autres langues.
- Accueil : les widgets « Infos » et la grande météo — L'heure, la météo et les alertes pas encore vues en petits chiffres ; l'horloge ; la météo en quatre styles (Simple, Complète, Compacte, Scène) avec les 7 jours, les 24 heures, le lever et le coucher. L'heure d'Odin, jamais celle de l'appareil ; rien d'affirmé sans lieu choisi ni sans source.
- Accueil : « Alertes et erreurs » et « Sites web » — La liste des alertes avec « Vu » ; les sites surveillés par Arachné, les pannes d'abord, et le petit chiffre « combien répondent ». Les actions (« Vérifier », « Relancer »…) ne vont qu'au propriétaire, avec confirmation. Pas encore : les styles « Liste » et « Pastilles ».
- Accueil : « Agenda », « Recherche », « Sauvegardes », « Pubs bloquées » (toi seul) — Tes prochains rendez-vous, le champ « Pose ta question… » et tes dernières recherches, l'état des sauvegardes de Phénix, les pubs bloquées aujourd'hui par Sphinx (des comptes seulement). Refusés par le serveur à un membre, à une tablette « maison » et à la clé d'accès. Ta question n'apparaît dans aucune adresse.
- Accueil : le verre et le curseur « Transparence du verre » — Sur l'accueil seulement, le décor du thème passe derrière des cartes de verre, assez opaques pour que tout texte reste lisible (4,5 pour 1). Dans Réglages → Apparence, un curseur de 0 à 100 (propriétaire seul) règle ce verre pour chaque thème, sans jamais rendre un texte illisible. Pas encore : sur l'écran de la maison.
- Accueil : le fond qui vit (éteint au départ) — Seize ambiances animées derrière l'accueil (glace, vitre, néon, étoiles, aurore, vagues, pluie, orage, neige, feuilles, pétales, bulles, coucher de soleil, orbes…). Éteint au départ (ton choix du 26/11) : tu l'allumes dans Réglages → Apparence. Rien ne bouge si l'appareil demande moins de mouvement. Pas encore : sur l'écran de la maison.
- Écran de la maison : toutes les familles de thèmes — La page « Thèmes » de l'écran de la maison montre les quatre familles de Réglages → Apparence, sous les mêmes noms. Un réglage par écran : le thème choisi ici ne change pas celui d'Odin. « Valhalla (classique) » n'y est pas proposé.
- Écran de la maison : la barre de côté, le bandeau, les onglets, le téléphone — La barre de côté avec ses mots et sa punaise (détachée au départ) ; le bandeau qui ne montre que ce qui est vrai ; les onglets de pièces qui filtrent ; au téléphone, la barre du bas avec Odin au centre et « Plus » ; le plein écran. Pas encore : les mots dans la langue d'Odin.

**En cours (écrit, en relecture ou en correction, pas encore publié)**

- L'entraînement de contrôle et le rapport d'entraînement — Des scénarios par domaine, et un rapport qui sépare ce qui marche, ce qui est un défaut et ce qui n'est pas encore codé.
- Pygmalion : produire des documents, des graphes, des images — Écrit, corrigé et rangé dans le dépôt, mais fermé. Ses refus des faux documents et des trucages ont été attaqués avec des demandes jamais vues : environ trois sur dix passent encore. Il ne s'ouvrira pas sur ce filtre seul.
- La maquette validée de l'Accueil et de l'écran de la maison — 48 livraisons enregistrées sur 80. Faites : le garde-fou des données, les thèmes et le verre de l'accueil, son curseur, le fond qui vit (éteint au départ), le menu, les automatisations en cercles, la grille et le socle des widgets, la page « Aujourd'hui », les widgets « Infos », la grande météo, « Alertes et erreurs », « Sites web », « Agenda », « Recherche », « Sauvegardes », « Pubs bloquées », et sur l'écran de la maison les familles de thèmes, la barre de côté, le bandeau, les onglets de pièces, le téléphone et le plein écran. Pas à construire, d'après tes réponses du 25/11 : la page « Énergie » et créer une scène depuis l'écran de la maison. En cours, pas enregistré : 7 livraisons (le widget d'une appli, les raccourcis, les automatisations, « Mettre en widget », la grille de l'écran de la maison, son verre et son fond qui vit, les relevés gardés). À venir : les 23 autres. Le détail, livraison par livraison, est dans AVANCEMENT.md.
- Écrit ou commencé, pas encore enregistré — Sur l'accueil : le widget de n'importe quelle appli, les widgets « Raccourcis » et « Automatisations », « Mettre en widget » depuis la fiche d'une appli. Sur l'écran de la maison : le modèle de sa grille de widgets, le verre et le fond qui vit, les relevés gardés des prises et des capteurs. Rien de cela n'est dans ton Odin tant que ce n'est pas enregistré.
- Profil, la suite : les droits sur la fiche, le graphe d'une personne — En cours : le bloc « Droits » sur la carte d'une personne (limiter en un geste, donner avec ta validation, « Couper tout ») ; écrit en partie, pas encore relu ni enregistré. Aujourd'hui, les droits se règlent dans Réglages → Personnes. À venir : le graphe d'une personne ; demander à Odin « qui a demandé quoi, quand » ; la mesure des applis les plus demandées ; un portrait en phrases quand son propre modèle sera entraîné.

**À venir**

- Ne plus montrer comme ta ville une ville seulement supposée — Tant que tu n'as pas réglé ta ville, l'accueil ne montrera plus comme la tienne une ville seulement supposée d'après l'horloge de la machine : il dira que c'est une supposition et proposera de régler ta ville sur place. Pas commencé.
- Comptes, groupes, informations d'une personne : la suite — Tes demandes du 18/11, dans l'ordre de l'étude. Déjà là : l'invitation depuis Réglages, les cases d'un groupe vide, l'invitation au journal, la demande d'un membre qui t'arrive, l'âge et les informations sur la personne de Persona (plus haut). À venir : les mêmes informations sur ton compte d'Odin et sur la carte Profil ; Odin s'en servira pour te répondre ; un groupe « admin » d'une seule appli (après ta réponse) ; s'inscrire sur une page avec tes informations (étude à part avant le code ; accepter les conditions d'un site restera ton geste).
- Disque chiffré et clé de secours : la suite — Ta demande du 18/11 : à l'installation, le disque sera chiffré et une clé de secours te sera donnée pendant la configuration. Étapes de l'étude : la vérification à chaque démarrage, en avertissement ; la vérification et le guide à l'installation ; un garde-fou pour qu'Odin ne lise ni ne crée jamais lui-même un moyen de récupération ; la clé de secours pendant la configuration (sous Windows, c'est BitLocker qui la crée : Odin te guidera et te demandera de confirmer que tu l'as rangée hors de la machine) ; refuser de fonctionner sur un disque non chiffré, seulement après ta réponse ; un serveur qui redémarre seul. Franchement : une clé de secours perdue, ce seront toutes les données perdues. Pas commencé.
- Odin se recode : la demande d'un membre, validée par toi — Aujourd'hui, toi seul peux faire réécrire son code à Odin, avec ta validation par défaut ; un membre est refusé et tu n'en es pas prévenu (le refus est seulement noté au journal des décisions). Déjà là : la fondation, le brouillon (plus haut). À venir, dans l'ordre de l'étude : une page « Réécritures proposées » qui montre chaque brouillon en entier, avant et après, avec qui l'a demandé ; appliquer seulement ce que tu as vu ; puis la demande d'un membre, que tu valides. Ce qui touche aux garde-fous ne changera qu'avec une nouvelle version que tu accepteras toi-même.
- Odin programmeur et créateur de sites — Ta demande du 18/11. Étapes de l'étude : un premier site fait sur la machine et visible dans Odin, son serveur sur la machine seulement, des modifications précises avec retour en arrière, les images, vidéos, sons et documents dans le site, vérifier un site et reconnaître un langage, appliquer un correctif donné, le site servi à la maison selon ta réponse, et l'entraînement de Soul à comprendre les demandes de site. Franchement : Soul apprendra à comprendre ces demandes, pas à écrire du code. Rien ne sera ouvert au réseau sans ta validation. Pas commencé.
- L'exception pour la programmation : un modèle extérieur pour le code seul, chaque envoi validé par toi — Tes réponses du 18/11 : « Exception pour le code » (un modèle extérieur pour la seule programmation) et « Je valide chaque envoi » (chaque envoi attendra ta validation, avec ce qui part sous tes yeux ; sans ta réponse, rien ne partira). Ta règle du 17/11 tient pour tout le reste : aucun modèle externe. L'étude propose, à confirmer par toi : la programmation, c'est écrire, lire, corriger du code et créer des sites ; ne jamais envoyer le coffre, la mémoire, le Cerveau, les personnes, les autres applis ; tes réponses d'abord (quel service, où tu valides, qui s'en sert, un plafond par mois), puis la tranche du retrait revue, la porte de la programmation, la page où tu valides, un premier usage dans Dédale, l'atelier de code, puis les sites. Rien n'est construit.
- Ses propres réseaux : langue, son, musique, image, vidéo — Écrits dans Odin et entraînés sur sa machine, comme Soul et Brain, avec les données du propriétaire (qui restent chez lui) et des jeux de données publics à licence libre, vérifiée et notée. Reconnaître les personnes désignées (voix, puis visage, avec leur accord, en local et chiffré) et créer des images se feront avec eux.
- Ce que cela veut dire, franchement — Tant que son propre modèle de langue n'est pas entraîné, Odin répond avec Soul et ses actions directes, sans rédiger de longues réponses ni raisonner. Sur un petit processeur, ces réseaux resteront longtemps petits et spécialisés. Seule exception décidée le 18/11 : la programmation (voir plus bas).
- Automatisations : la suite des gestes de l'éditeur de scénarios — Déjà là : les blocs en cercles et leurs bulles, ce qu'un bloc a reçu gardé par le moteur, « oui » et « non » sur les liaisons du « Si », « Filtrer » en petit rond sur la liaison (plus haut). À venir : la barre du bas de l'éditeur ; les branches et les conditions sur un fil, le planning réglé depuis le déclencheur, que faire en cas d'erreur ; couper les autres liens ; plus tard, un déclencheur à l'arrivée d'un mail ou d'un message.
- Graphe 3D, les autres endroits — Le proxy (avec le DNS et le DHCP), le reverse proxy, le VPN, le Profil, une carte d'Internet : il faut d'abord y créer les données du graphe.
- Vénus complet, sans rien d'extérieur : la suite — Déjà là : l'interface de l'appli Vénus d'origine, son lecteur, les affiches, « faire venir » un titre, le calendrier, « Ce soir », le vote, les statistiques, les collections, la séance, la télécommande, les téléchargements et le tableau de bord de l'administration (voir plus haut). À venir : dans l'administration, le code de connexion, déconnecter un appareil, redémarrer, le message à tous, les pages Qualité, Sécurité et Serveur et les autres rubriques des réglages ; dans la télécommande, la croix, les chaînes et « Reprendre sur la TV » ; la musique, les livres et les photos ; la télévision en direct ; la même demande « lance tel film » dans les autres langues suivies ; YouTube et l'envoi vers une télé faits par Odin lui-même.
- La liste « à valider » retrouvée au retour — Ce qu'Odin a voulu faire seul et qui engage t'attend, avec oui ou non, même après le délai d'une validation. (Les validations encore dans leur délai te sont déjà remontrées : voir plus haut.)
- Soul sur le processeur, au maximum ; choix « processeur ou carte graphique » — Plus de calcul utile par seconde. Le choix « carte graphique » existera mais dira qu'il n'est pas disponible : sans programme ajouté, Odin ne peut pas faire calculer la partie graphique d'un processeur.
- Brain et Soul branchés ensemble — Chacun a son identité ; si l'un manque, Odin le dit (« il me manque mon âme ») et aide à réparer ; export et import.
- Les noms « Brain » et « Soul » partout à l'écran
- Corriger sa mémoire à la main ; la capsule juste — « Que sais-tu de moi ? », « oublie ça », « c'est faux », et Odin remarque tes corrections faites à la main.
- Consolidation à tout moment — Un passage léger dès qu'Odin est libre, un passage profond par jour.
- Soul apprend de tout
- La mascotte reliée à Brain et Soul — Ses réactions choisies par Soul parmi celles que les règles permettent, et ses souvenirs dans Brain. Son visage reste ses yeux et sa couleur ; ses marques autour d'elle et ses habits de fête sont gardés.
- Toutes les langues, la suite — Comprendre sans modèle dans plus de langues, la langue de chaque personne retenue, la langue de l'interface choisie au premier réglage, des sous-titres traduits. Shimaoré et kibushi avec la matière que fournira le propriétaire, et Odin dit quand il n'est pas sûr.
- Lui parler à la voix, à plusieurs
- Des widgets posés par la parole ; le nouvel accueil — « Mets la météo en haut à gauche », « agrandis-le », « remets comme avant ». Le nouvel accueil est en partie là (48 livraisons sur 80, plus haut) ; sur l'écran de la maison, le cadre est là (barre de côté, bandeau, onglets de pièces, téléphone, plein écran), ses widgets sont à venir.
- Parler à Odin en SSH — Une porte écrite dans Odin : la même conversation dans un terminal, avec la mascotte en caractères ; clés seulement ; réseau de la maison ; fermée tant que tu ne l'ouvres pas dans les Réglages.
- Mails, factures et actualités — Tri, résumé, brouillon par défaut, plusieurs boîtes ; factures et abonnements ; actualités en fiches.
- Comptes et adresses de façade — S'inscrire pour toi pas à pas, une adresse par site sur ton domaine, un registre de qui connaît quoi ; un CAPTCHA reste ton geste.
- Navigateur, achats, cinéma — Toujours validé au paiement.
- Trajets et horaires calculés dans Odin — « Je prends le bus » : sans service extérieur (gros chantier).
- Tout le parc par la parole — Déjà là : Genèse, Arche et Hydre par la parole (« mets Windows 11 sur la clé », « arrête wiki », « crée-moi une VM Ubuntu avec 4 Go »), toujours avec la confirmation à la main. À venir : essayer un dépôt GitHub dans une machine isolée, contrôleur de domaine et GPO, servir son propre modèle de langue aux autres machines.
- Plusieurs aides en même temps, Odin chef d'orchestre
- Mathésis : vidéos, musique, images — Lire aussi les médias, dont la vidéothèque de Vénus, sans jamais rien modifier.
- Un entraînement de tout, puis un banc comparé aux bancs publics — Sur le raisonnement, c'est le propre modèle de langue d'Odin qui sera mesuré, une fois entraîné.
- Parler à Odin sur tous les canaux ; tes réseaux sociaux — Ta demande du 20/11 : te parler sur les canaux que tu configures, te prévenir d'un message arrivé et y répondre ; publier sur tes réseaux. Rien ne part sans ta confirmation, sauf sur un canal où tu as permis la réponse automatique. Tes choix : sept canaux en premier, ceux sans porte officielle simple, par les portes ouvertes aux particuliers. Pas commencé.
- Piloter un drone — Ta demande du 20/11 : un configurateur des drones et des ordres à la voix ou à l'écrit. Tes réponses : ton accord avant chaque décollage, des limites de hauteur, de distance et de zone, « stop » et « atterris » toujours en premier ; commencer par ton drone (sa marque et son modèle te seront demandés). Pas commencé.
- La visio sur le site d'Odin — Ta demande du 20/11 : Odin crée un lien audio ou vidéo sur son propre site, chaque lien avec son identifiant, sa date et la durée que tu donnes ; un invité attend dans une salle d'attente ; Odin te montre le courriel avant chaque envoi. Pas commencé.
- L'agent et le Cerveau ; l'agent dans une machine à lui — Tes réponses du 19 et 20/11 : un agent connecté peut lire tout le Cerveau, secrets masqués ; une amélioration des neurones n'est gardée qu'après un essai sur une copie, mesuré. Pour une tâche, l'agent peut créer seul une machine ou un conteneur d'Odin, dans des limites, puis le supprimer. Un banc d'essai des neurones est enregistré comme code d'essai (rien dans l'appli). Le reste n'est pas commencé.
- Lire les documents, les images et les vidéos — Tes demandes du 19/11 : un document déposé est lu et Odin propose la suite (convertir, en tirer les données) ; le texte des documents et des images est toujours lu ; une vidéo image par image et son son mot par mot. Tes réponses : une image ne part vers un agent connecté qu'avec ton oui (une question par vidéo) ; l'écoute d'abord en français puis en anglais. Pas commencé.
- Une recherche rend une réponse directe, sourcée, avec des conseils — Ta demande du 19/11 : la réponse d'abord, quelques points avec leurs sources, puis des conseils et la suite à toucher ; ce qui se calcule (heures, dates, conversions) est calculé exactement. Pas commencé.
- Mise à jour automatique réglable : activée, tout s'installe sans geste — Ta demande du 19/11. Déjà là : le réglage Réglages → Mises à jour d'Odin (tout seul quand il ne travaille pas, me prévient, ne pas vérifier) et, quand une version change les garde-fous, ton seul clic « Mettre à jour » si c'est la version officielle revérifiée (plus haut). À venir, ta réponse « Signée par ma clé » : une nouvelle version des garde-fous ne s'installera seule que si elle porte ta signature ; sans elle, elle attendra ton clic.
- Les agents classés de 1 à 10, le vérificateur et l'observateur — Tes réponses du 19/11. Déjà là : le classement s'écrit dans la configuration (routing.classement) ; Odin prend les agents dans cet ordre, l'agent local d'Odin compris, et passe au suivant si l'un se tait ou refuse ; chaque appel est noté, sans son contenu ; et le journal des tours (plus haut). À venir : le classer depuis les Réglages ; le vérificateur, un modèle à part qui relit les seules actions risquées et cite ta phrase ; l'agent observateur ; les tâches en parallèle par sujet.
- Une IA qui décide dans les automatisations — Ta demande du 19/11 et ta réponse du même jour. Déjà là : les blocs « Agent Odin », « Classer (IA) » et « Extraire des infos (IA) », et une automatisation créée depuis la Discussion (créée désactivée, marquée « écrite par Odin »), avec le modèle réglé. À venir : y brancher le modèle d'Odin et les agents connectés, chaque appel noté et visible, sans validation à chaque envoi ; une action grave reste validée par toi, les demandes regroupées pour que tu les valides ensemble.
- Proactif, de bout en bout — Ta demande du 19/11 : repérer une réservation dans tes courriels, chercher et comparer les options, réserver, annuler, demander un remboursement, se désabonner, faire l'enregistrement en ligne, garder le billet, mettre l'événement au calendrier, te le rappeler, et te le proposer de lui-même. Chaque action risquée passera par le vérificateur, et un paiement par ta validation. Pas commencé.
- Le lien d'Odin sur l'Accueil, pour la famille — Ta demande du 19/11 et tes réponses : un lien par personne, à usage unique, comme l'invitation de Réglages → Personnes (déjà là, plus haut), mais proposé aussi sur l'Accueil ; la personne crée son compte comme tu as créé le tien. Pas encore sur l'Accueil.
- Odin depuis dehors — Tes réponses du 19/11 à l'étude : toutes les façons d'arriver jusqu'à Odin, partout (un nom de domaine, un serveur à toi, l'adresse locale, l'adresse publique) ; Odin règle lui-même la box avec ses identifiants rangés au coffre ; depuis dehors, tout ce qui est possible à la maison ; un inconnu ne voit que la mascotte, qui lui dit qu'il n'est pas autorisé. Pas commencé.
- Les autres maquettes validées : ce qui reste — Clés USB : écrire une clé neuve (avec une vraie clé d'essai). Systèmes : les essayer sur un vrai PC et un vrai réseau. Conteneurs et machines virtuelles : Odin sous Windows (après tes réponses) ; copier une machine vers une vraie clé, l'envoyer vers un serveur, importer un disque seul (cloner et exporter en fichier sont là). Réseau : les comptes et la page de connexion du VPN (tes réponses du 23/11) ; la parole dans d'autres langues que le français, l'anglais, l'espagnol et l'allemand. Vénus : la fin de l'administration, la musique, les livres et les photos, la télévision en direct.
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
