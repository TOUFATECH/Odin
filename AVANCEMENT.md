# Odin — avancement du projet (fil de suivi)

> **À lire en premier par toute personne qui reprend le projet.**
> Ce fichier dit où en est le projet, sans tout relire. Il est tenu à jour à chaque session de travail
> (voir « Comment tenir ce fichier à jour » tout en bas).
>
> Dernière mise à jour : **2026-11-15** · version du code : **1.36.0** (`package.json`) · branche : `main`

---

## 1. Ce qu'est le projet (en 30 secondes)

- **Odin** (`odin-agent`) : agent IA personnel auto-hébergé de TOUFATECH. Interface web, terminal, Telegram, API HTTP,
  inventaire du réseau, maison connectée, sécurité, médias…
- Il est fait d'**applis** (les « modules Valhalla ») qui portent chacune un **nom grec** (validé le 13/11/2026).
  Odin les pilote lui-même : chaque appli a une page, des actions, des alertes et des mots-clés.
- **Ce fichier suit l'application Odin (branche `main`), pas Odin OS.** Odin OS (système, noyau, serveur d'Odin) est
  un projet distinct : code sur la branche `odin-os`, présentation dans [ODIN-OS.md](ODIN-OS.md), cahier des charges
  à part. Ne pas mélanger les deux ; les applis seront réunies dans Odin OS par la suite.
- Dépôt : https://github.com/TOUFATECH/Odin · copie locale : `V:\Work\ODIN` (partage réseau `\\192.168.1.20`).

## 2. Démarrer vite

| Besoin | Commande / endroit |
|---|---|
| Node | ≥ 22.18 (TypeScript lancé directement par Node, pas de compilation) |
| Lancer Odin | `npm run odin` |
| Tout vérifier | `npm run check` (types puis tests, ~137 fichiers de tests dans `test/`) |
| Tests seuls | `npm test` |
| Git sur le partage réseau | Git refuse le dossier (« dubious ownership ») : utiliser `git -c safe.directory=* …` ou ajouter une fois `git config --global --add safe.directory '%(prefix)///192.168.1.20/toufatech/Work/ODIN'` |
| Intégration continue | `.github/workflows/` : `ci.yml`, `pages.yml` (site), `pegase-desktop.yml`, `pegase-android.yml`, `agora-poste.yml`, `agora-android.yml` |

## 3. Carte du dépôt

| Dossier | Contenu |
|---|---|
| `src/valhalla/modules/*.ts` | **une appli = un fichier** (61 fichiers). Enregistrées dans `allModules()` de `src/valhalla/odin.ts` |
| `src/valhalla/<id>/` | le code lourd d'une appli quand elle en a (ex. `ullr/`, `hel/`, `thjalfi/`) |
| `src/valhalla/names.ts` | **noms affichés** (`NAMES`), histoire du nom (`NAME_STORY`), logiciels similaires (`SIMILAIRES`) |
| `src/valhalla/types.ts` | le type `Module` (page, actions, alertes…) |
| `src/valhalla/forge/` | socle commun « dossier gardé à jour » (Hermès, Andromède) |
| `src/muninn`, `yggdrasil`, `hlidskjalf`, `runes`, `draupnir`, `mimir`, `heimdall`, `bifrost`… | le cœur d'Odin (mémoire, compétences, réseau, Talos, passerelle…) |
| `src/web/`, `src/cli/` | interface web, ligne de commande |
| `pegase/`, `pegase-android/`, `pegase-plume/` | navigateur Pégase (Electron, Android, Plume) |
| `agora-poste/`, `agora-android/` | store Agora (ordinateur, Android) |
| `site/` | site public · `docs/` : protocoles et plans · `tools/` : outils (guide…) · `clients/` : client SSO |

## 4. Règles du projet (à respecter)

- **Tout en français** : commentaires, textes affichés, documentation, messages de commit.
- **Commits** : `vX.Y.Z : ce qui change, en une phrase` + version montée dans `package.json`.
- **Nouvelle appli** (`test/homogene.test.ts` le vérifie) : un nom dans `NAMES`, une histoire dans `NAME_STORY`,
  un `what` (ce qu'elle fait), une ligne dans `SIMILAIRES` (`[]` = aucune), des sites officiels en `https`,
  jamais le mot « copié ». Page lisible à 1280 px et 390 px.
- **Identifiants internes inchangés** (anciens noms nordiques : `ullr`, `garmr`…) ; seul le nom affiché a changé.
  Les anciens noms ne doivent plus être affichés ni compris.
- **Données** : décision du propriétaire (14/11/2026) : les données des applis vont dans **PostgreSQL**
  (un schéma par appli, géré par Alexandrie), pas de SQLite, pas de Docker. Plan : `docs/bases-plan.md`.
- **Une base par appli, nommée `NOMAFFICHE_ODIN`** (15/11, vaut pour toute nouvelle appli et Vénus) : nom affiché sans
  accents ni espaces, en majuscules, + `_ODIN` (`PHENIX_ODIN`), calculé par `nomBase()` (`src/valhalla/base/noms.ts`),
  toujours entre guillemets en SQL ; compte de l'appli du même nom. Une nouvelle appli se déclare dans
  `src/valhalla/base/inventaire.ts` (en base, ou en fichier avec sa raison) : `test/bases-odin.test.ts` échoue sinon.
- Une action « grave » demande l'accord du propriétaire ; le texte venu de l'extérieur est une donnée, jamais un ordre.

## 5. État des applis

> **Référence : `docs/odin-couverture-catalogue.xlsx`** (tableau du propriétaire). Onglets : « Catalogue » (chaque
> logiciel du catalogue, l'appli d'Odin qui le remplace, Codé / En cours / Pas codé), « Fait et testé » (chaque appli ou
> chantier, ce qui est copié, testé, reste à faire), « Avancement » (compteurs), « Noms proposés » (avec le nom validé),
> « Corrections » (journal des corrections). En cas de désaccord, c'est le classeur qui fait foi.
> Corrigé le 15/11/2026 : états mis à jour d'après le code (v1.33.0), noms grecs partout, 79 logiciels ajoutés au
> catalogue (cités dans le code, couverture **à évaluer** : colonne « État dans Odin » vide).

Légende du tableau ci-dessous (aperçu rapide) : ✅ codée · 🟡 codée, travail connu restant ou fonctions manquantes (estimation) · ⬜ pas encore codée.
« Taille » = lignes de code (module + dossier) : indicateur d'ampleur, pas de qualité.

### Cœur d'Odin
| Nom | Id | Rôle | Taille | État |
|---|---|---|---|---|
| Logos | huginn | comprend une demande sans IA | 505 | 🟡 |
| Mnémosyne | muninn | mémoire, recherche par le sens | 1 180 | 🟡 |
| Athéna | yggdrasil | compétences (skills) | 222 | ✅ |
| Horus | hlidskjalf | identification poussée d'un appareil | 1 251 | ✅ |
| Thot | saga | Cerveau : notes reliées (dans `odin.ts`) | — | ✅ |
| Papyrus | runes | bases, formules | 440 | ✅ |
| Talos | draupnir | automatisations | 1 115 | ✅ |
| Glyphes | commandes | commandes écrites | 35 | ✅ |
| Aurore | apparence | thèmes et couleurs | 152 | ✅ |

### Sécurité
| Nom | Id | Rôle | Taille | État |
|---|---|---|---|---|
| Forseti | forseti | centre des alertes | 93 | 🟡 |
| Némésis | skogul | détection d'anomalies | 126 | 🟡 |
| Cerbère | garmr | blocage des intrusions | 157 | ✅ |
| Méduse | geri | fige les connexions dangereuses | 151 | 🟡 |
| Ariane | ran | paquets réseau | 140 | ✅ |
| Asclépios | ullr | antivirus | 1 751 | ✅ |
| Sirènes | loki | faux services pièges | 225 | ✅ |
| Sphinx | vidarr | filtre DNS | 1 718 | ✅ |
| Thermopyles | hlid | pare-feu | 201 | ✅ |
| Vortex | gjoll | VPN | 394 | ✅ |
| Thésauros | brisingamen | coffre à mots de passe | 87 | 🟡 |
| Persona | var | identités, connexion unique | 270 | ✅ |
| Gygès | hlin | vie privée | 1 375 | ✅ |
| Héra | heidrun | contrôle parental | 145 | ✅ |

### Réseau, machines, serveurs
| Nom | Id | Rôle | Taille | État |
|---|---|---|---|---|
| Pulsar | vordr | surveillance | 669 | ✅ |
| Hygie | eir | santé de la machine | 403 | ✅ |
| Atlas | askr | inventaire du matériel | 279 | ✅ |
| Argo | naglfar | conteneurs | 259 | ✅ |
| Hydre | ymir | Proxmox, VM | 736 | ✅ |
| Arachné | idunn | sites web | 595 | ✅ |
| Valgrind | valgrind | proxy inverse | 595 | ✅ |
| Bifröst | bru | pont vers Internet | 235 | ✅ |
| Zéphyr | svalinn | Wi-Fi | 335 | ✅ |
| Satellites | hermod | ordinateurs à distance | 60 | 🟡 |
| Interprète | ratatoskr | MCP | 103 | ✅ |
| Genèse | thjalfi | installation par le réseau | 1 819 | ✅ |
| Tirésias | durinn | santé des disques | 1 433 | ✅ |
| Pyramide | fensalir | disques et partages | 136 | 🟡 |
| Perséphone | hel | récupération de fichiers | 2 225 | ✅ |
| Phénix | sindri | sauvegardes | 152 | ✅ |
| Alexandrie | urdr | bases de données | 776 | 🟡 |
| Arche | skuld | copies des bases | 219 | ✅ |
| Chroniques | mimisbrunnr | journaux | 160 | 🟡 |
| Héraclès | gefjon | ménage de la machine | 156 | ✅ |
| Hermès | fjalar | logiciels à jour (forge) | 20 | ✅ |
| Andromède | eitri | ISO (forge) | 14 | ✅ |
| Dédale | ivaldi | code et dépôts | 567 | ✅ |
| Pharos | kvasir | veille des nouveautés | 210 | ✅ |
| Zénith | syn | tableaux de bord | 186 | ✅ |

### Maison, médias, quotidien
| Nom | Id | Rôle | Taille | État |
|---|---|---|---|---|
| Hestia | gladsheim | la maison en un écran | 273 | ✅ |
| Midgard | midgard | tableau de bord par pièce | 136 | 🟡 |
| Constellation | appareils | appareils connectés | 187 | 🟡 |
| Héphaïstos | brokkr | atelier des modules | 79 | 🟡 |
| Cyclope | himinbjorg | caméras | 142 | 🟡 |
| Orphée | bragi | voix d'Odin | 113 | 🟡 |
| Écho | rodd | dictée | 89 | 🟡 |
| Vénus | freyja (`venus.ts`) | films, séries, chaînes ; parties Odéon, Delta, Sirius, Pléiades, Odyssée, Comète | 296 | ✅ |
| Apollon | aegir | musique, radios | 107 | 🟡 |
| Hélios | sol | photos | 158 | 🟡 |
| Plume | snotra | bureautique | 1 163 | ✅ |
| Nébuleuse | skidbladnir | nuage de fichiers | 943 | ✅ |
| Alchimie | dvalinn | conversion de fichiers | 1 397 | ✅ |
| Champollion | champollion | texte des images et des sons | 291 | ✅ |
| Chronos | frigg | rendez-vous | 101 | 🟡 |
| Pythie | volva | recherche | 319 | ✅ |
| Ulysse | gna | trajets | 929 | ✅ |
| Olympie | leikvangr | jeux | 171 | ✅ |
| Pégase | pegase | navigateur (+ applis `pegase*/`) | 1 038 + applis | 🟡 |
| Agora | agora | store (+ applis `agora-*/`) | 658 + applis | 🟡 |

### Pas encore codées
Aucune : le **Compagnon d'Odin sur chaque système installé** est codé depuis le 15/11 (`src/valhalla/compagnon/`, à essayer sur de vrais postes).
Dans l'onglet « Catalogue », les 79 logiciels ajoutés le 15/11 restent à évaluer un par un.

## 6. Chantiers ouverts (ce qui reste à faire)

État au 15/11/2026 au soir. Les demandes du propriétaire sont recopiées ici pour qu'une autre session puisse reprendre
sans relire la conversation. Ordre conseillé : de haut en bas.

| # | Chantier | Applis | État | Ce que le propriétaire a demandé |
|---|---|---|---|---|
| 1 | ISO, logiciels, antivirus d'abord | Hydre (`ymir`), Andromède (`eitri`), Hermès (`fjalar`), Genèse (`thjalfi`, menu seulement), Asclépios (`ullr`), Argo (`naglfar`) | **commencé, pas fini** : `src/valhalla/forge/bibliotheque.ts`, `src/valhalla/ullr/garde.ts`, `src/valhalla/ymir/bibliotheque.ts`, `src/valhalla/ymir/isos.ts` et les modules cités sont modifiés ; vérifier ce qui marche avant de continuer (carnet éventuel : voir le rapport de l'agent) | Importer des ISO dans Hydre (navigateur avec barre, pourcentage, vitesse, secondes restantes, plusieurs fichiers, glisser-déposer ; par lien ; en parcourant le réseau) et choisir l'ISO à la création d'une machine (Windows, Mac, Linux, autre). Un « espace ISO » : un dossier réglé, scanné, partagé par Hydre, Andromède et le menu PXE de Genèse (images prêtes, en cours avec avancement, scannées ; jamais une image en quarantaine). Fiche de chaque ISO : logo, version, taille, date de téléchargement, source, empreinte, antivirus, dernière vérification, VM qui l'utilisent. Mise à jour automatique : la nouvelle remplace l'ancienne, l'ancienne va dans `old` (une seule gardée). Vérification planifiable, mensuelle par défaut. La même chose pour les logiciels (dossier des logiciels, scan, fiche avec image et liens, mises à jour avec `old`), et installation de logiciels et de leurs mises à jour dans les VM et les LXC. Tout ce qui vient de l'extérieur passe par l'antivirus AVANT usage (ISO, images de VM, images du moteur d'Argo, téléchargements, recherches, fichiers déposés) : en cas de détection, notification (quoi, pourquoi, comment), le propriétaire accepte ou refuse ; sans réponse : quarantaine ; depuis la quarantaine : libérer (rangé à sa place) ou bloquer (supprimé). Une VM infectée est mise en quarantaine dans Hydre (isolée) jusqu'à ce qu'on l'en sorte. Dans Asclépios : les sources des signatures et des failles récentes, mises à jour automatiques. |
| 2 | Suivi des installations PXE | Genèse (`thjalfi`) | **pas commencé** (repérage fait, rien d'écrit) | Postes identifiés ; déroulement de chaque installation visible en direct jusqu'à la fin ; bloquer un poste ou une installation ; mot de passe à saisir sur le poste pour installer ; historique et rapport de toutes les installations en base (GENESE_ODIN) avec le résultat ; Odin prévient (en cours, échec, réussite). |
| 3 | Odin vivant | mascotte (`src/web/face.js`, `companion.js`, `mascotte.js`, `src/mood/mood.ts`) | **pas commencé** (conception interrompue deux fois par la limite d'utilisation) | Animation logique « comme un être humain qui a ses choix, ses envies, ses humeurs » ; très expressif ; autonome ; il répond quand on l'appelle. Palette COMPLÈTE d'émotions humaines (tristesse, pleurs, colère, rage… tous les degrés), chacune animée avec sa couleur et ses yeux, la même liste côté interface et côté serveur. Décisions à garder : yeux en pastille au repos, yeux carrés pour la seule concentration, couleur du thème au repos (la couleur de l'émotion seulement tant qu'elle dure), jamais sur la zone de travail, jamais deux fois la même chose, rien au hasard gratuit. Script de travail prêt : `odin-vivant` (conception à 3, 2 lots, 4 relectures). |
| 4 | Réponses sans IA | Logos (`huginn.ts`), `src/core/direct.ts`, `offline.ts`, `offline-act.ts`, Pythie (`volva`), `src/voice/`, `src/brain/contexte.ts`, `src/valhalla/links.ts` | **pas commencé** (étude en 7 angles interrompue) | Sans modèle d'IA, Odin doit répondre comme si un modèle tournait : logique, structuré, très rapide, jamais deux fois le même texte, bonne compréhension (aussi des demandes dictées, des mots mal entendus et des ambiguïtés, en français et en anglais). Réponses adaptées : recherche web avec sources citées et recoupées, image et date de sortie, tableau, comparaison de prix, analyse ; en texte ou en audio si c'est activé (lire la réponse, créer un audio). Il se sert du Cerveau, de la mémoire et des bases des applis pour répondre et confirmer. Des voyants montrent les ressources utilisées (Cerveau, mémoire, base, appli, web, voix, avec ou sans IA). Revoir tous les liens entre applis (à ajouter, améliorer, retirer). |
| 5 | Parler naturellement, voix d'homme ou de femme | `src/core/prompt.ts`, `src/core/style.ts`, `src/voice/`, Réglages, installation | **pas commencé** | Odin ne doit pas parler comme une machine : langue courante, suppositions et propositions naturelles. Choix « homme » ou « femme » à l'installation et dans les Réglages (accords du texte et voix), voix naturelle. |
| 6 | Conversation dynamique | discussion (`src/web/ui.html`) | **pas commencé** | Odin réagit pendant qu'on écrit, montre qu'il réfléchit et ce qu'il fait, et son expression suit sa réponse. Lié aux chantiers 3 et 4. |
| 7 | Relecture complète | tout | **pas commencée** | Un passage qui vérifie tout le code du 15/11 contre les demandes de départ (oublis, erreurs), puis mise à jour du classeur. Reste connu : une fenêtre native `confirm(` dans `src/valhalla/skidbladnir/server.ts` (page à part) ; ce que dit Odin est gardé dans un fichier (`valhalla/parole.json`), à mettre en base. |
| 8 | Données en base | 15 applis encore en fichiers : Pythie, Chronos, Pharos, Plume, Dédale, Agora, Pulsar, Atlas, Tirésias, Cerbère, Méduse, Sphinx, Hestia, Ulysse, Gygès ; bases `app_<nom>` des logiciels installés par Argo | liste fermée dans `test/bases-odin.test.ts` | Une base `NOMAPPLI_ODIN` par appli dans Alexandrie (`docs/bases-plan.md`). Les essais avec un vrai PostgreSQL sont à lancer sous Linux avant toute mise en service. |
| 9 | Essais en vrai | — | à faire | Jamais essayés pour de vrai : vrais postes Windows / Linux / Mac (agent de Phénix, capsule d'Écho, Compagnon), vraie image disque, vrai SFTP / partage, vrai PostgreSQL (déménagement des bases), vrais Nextcloud / Gitea / Grafana / Home Assistant (connexion par Odin), clés d'accès dans un vrai navigateur, envoi d'e-mail, affichages dans le vrai Odin (mascotte, liens qui brillent, rendu des réponses, pastille), la géolocalisation réelle. L'essai `ports-directs` bloque sous Windows. |
| 10 | Signature | Pégase | à faire (projet de l'OS) | installateurs `.exe` / `.dmg` pas encore signés |
| 11 | Catalogue | toutes | à faire | évaluer les 79 logiciels ajoutés (état vide) et revérifier les lignes « En cours » du catalogue |

## 7. Branches

`main` est la référence. `correctif-maj`, `draupnir-runes`, `notifications-pastille` sont **déjà fusionnées** dans `main`
(rien de plus qu'elle au 15/11/2026).

## 8. Journal des sessions (le plus récent en haut)

| Date | Session | Ce qui a été fait | Prochaine étape |
|---|---|---|---|
| 2026-11-15 | Antivirus d'abord et bibliothèques | Un point de passage commun « quarantaine d'abord » (`src/valhalla/ullr/garde.ts`) pour tout ce qui vient de l'extérieur : ISO (Hydre, Andromède), installateurs (Hermès), couches d'images Docker d'Argo avant dépaquetage, fichiers joints et déposés (`/api/upload`, `/api/valhalla/depot`), pièces jointes des messageries, image téléchargée par Odin, fichier envoyé par Pégase. Asclépios : notification quoi / pourquoi / fait / à faire, accepter ou refuser (délai réglable, 2 min), onglet Quarantaine (détail, réanalyser, libérer, bloquer), onglet Sources (dernière, prochaine, nombre, échec signalé, failles CISA KEV), source ClamAV daily. Bibliothèque commune (`src/valhalla/forge/bibliotheque.ts`) pour les ISO (espace ISO d'Andromède, partagé avec Hydre et Genèse) et les logiciels d'Hermès (`forge/logiciels.ts`) : dossier scanné, fiche complète, ancienne version dans « old » (une seule gardée), vérification mensuelle replanifiable. Hydre : onglet ISO (import par morceaux reprenables `src/web/morceaux.ts`, lien, dossier, partage), choix de l'ISO à la création avec réglages par système (Windows : UEFI, TPM, pilotes virtio ; macOS : limites dites), machine infectée en quarantaine (démarrage en mode analyse), logiciels d'Hermès dans les machines. Genèse : le menu PXE ne propose que les images prêtes de la bibliothèque. Essais : `antivirus-partout` (9/9), `hydre-iso` (5/5), `bibliotheque-commune` (6/6), `genese-bibliotheque` (1/1). Pas essayé en vrai : page Hydre dans un navigateur (barre d'envoi, glisser-déposer), vrai QEMU / swtpm / LXC, vrai partage SMB, vraies sources (ClamAV, abuse.ch), vrai registre Docker, installation d'un logiciel dans une vraie VM. | Essayer l'onglet ISO dans un navigateur et sur un vrai Linux ; mettre à jour le classeur. |
| 2026-11-15 | Écran de la maison | Deux nouveaux modules de la fenêtre d'Odin (accueil et `/maison`) : « Heure et lieu » (date et heure dans le fuseau du lieu d'Odin, lever et coucher du soleil) et « Site surveillé » (une sonde de Pulsar : état, temps de réponse, disponibilité ; on peut créer la sonde en l'ajoutant) — `WidgetKind` `heure` et `site` dans `src/valhalla/modules/gladsheim.ts`, données dans `src/web/maison-api.ts`, rendu dans `src/web/fenetre.js` et `src/web/maison.js`. L'horloge de `/maison` suit le fuseau d'Odin, pas celui de l'appareil. Mode « Modifier l'écran » sur `/maison` (tous les droits) : glisser un module par sa poignée (souris ou doigt), flèches, taille, retirer, ajouter heure / météo / site ; rangé par `regler_fenetre`. Vérifié dans un vrai Odin de test avec le navigateur (flèches, ajout, glisser-déposer, carte « Lieu et région » des Réglages). | Thème par défaut de l'écran et de l'accueil : attendre le choix du propriétaire (les maquettes ne sont pas dans le dépôt). Essai au doigt sur une vraie tablette. |
| 2026-11-15 | Lieu d'Odin | Le lieu exact où Odin est installé (`src/valhalla/modules/gladsheim.ts` : `trouverLieux`, `changerLieu`, `changerPosition`, `previsions`) : par son nom (« ma ville est Dembéni », « j'habite à … », sans IA par `src/core/offline-act.ts` ; plusieurs lieux du même nom : celui du pays réglé d'abord, « Ville, pays » pour un autre) ou par la position de l'appareil (bouton « Me localiser » de la carte météo de `/maison`, village nommé par OpenStreetMap, précision dite, position approximative signalée). La météo, le fuseau horaire (thème, événements du jour) et la ville du briefing du matin suivent. « Météo à Paris » ne change plus le lieu. Odin se règle d'après son lieu (`src/valhalla/lieu.ts` : pays → unités °C/°F et km/miles, heure sur 12 ou 24 h, devise, fêtes proposées ; fuseau du lieu pour l'heure, le thème, les événements et la date donnée au modèle) ; au démarrage, sans lieu réglé, il le suppose d'après l'horloge de la machine et le dit ; « configure-toi pour Paris », « configure-toi tout seul » (ville du point de sortie de la connexion Internet, utile sur un serveur loué) ; réglage à la main dans Réglages → Maison → « Lieu et région » (`src/web/pages/lieu.js`) ou l'action « Réglages régionaux » de Hestia. Géolocalisation permise au navigateur sur `/maison` seulement. Essai : `test/meteo-lieu.test.ts` (9/9). | Essayer en vrai : géolocalisation d'un téléphone, recherche du nom du village, service de localisation par la connexion (`https://ipapi.co/json/`, jamais appelé pendant le développement). L'interface reste en français partout ; l'heure sur 12 h et la devise ne servent encore qu'aux consignes du modèle et au résumé. |
| 2026-11-15 | Thèmes et visage | 33 thèmes (7 nouveaux, 6 de température : gel, froid, frais, chaud, torride, canicule). Thème automatique dans l'ordre : fête du jour, temps (orage, pluie, neige, brouillard, grand vent), température hors de 18–27°, puis moment de la journée (veille de l'aube 3 h – 6 h, jour, après-midi, soir, nuit) qui varie avec l'humeur d'Odin (`src/valhalla/modules/apparence.ts` : `MOMENTS`, `TEMPERATURES`, `autoTheme` ; humeur du moment : `currentMood` dans `src/mood/mood.ts`). Odin prend la couleur du thème au repos ; yeux en pastille pour toutes les humeurs, carrés pour la seule concentration (`src/web/face.js`). Pastille de l'onglet Applis en rouge = nombre d'alertes (elle se lisait comme un nombre d'applis), titre « Tes applis (64) ». | Odin vivant (chantier 3). |
| 2026-11-15 | Dialogues, mascotte, liens | Fenêtres de confirmation au thème d'Odin partout (`src/web/dialog.js`, 96 appels natifs remplacés, `test/dialogues.test.ts`). Mascotte : chemins qui contournent le contenu, zone de travail évitée, survol, pastille des notifications réduite à 6 points de couleur + le nombre (rouge urgence, jaune moyen, vert information) (`src/web/companion.js`, `notices.js`). Liens qui brillent quand deux applis se parlent, avec le sens de la demande (`src/valhalla/echanges.ts`, `src/web/graph.js`, `test/echanges-applis.test.ts`). Une base par appli `NOMAPPLI_ODIN` (`src/valhalla/base/`, `test/bases-odin.test.ts`). | — |
| 2026-11-15 | Réponses d'Odin | Un seul moteur de mise en forme (`src/web/pages/rendu.js`, `window.OdinRendu`) pour la Discussion, la bulle d'Odin et ses notifications : tableaux alignés (défilement sur téléphone), images (zoom), son, vidéo (miniature, lecture au clic, Ouvrir / Copier / Partager), logo des applis, résultats de Pythie ; l'ancien `md()` de `ui.html` est retiré. Bulle d'Odin : réponse mise en forme, taille bornée, ×, Échap, toucher dehors, animation douce. « Odin consulte » : `consultBrain` rend le chemin suivi (`etapes`), l'agent l'envoie (événement `consulte`), la carte du Cerveau l'allume avec le moteur des échanges de `graph.js`. Cerveau plus rapide (notes non relues si inchangées, index, texte replié en cache : ~1,2 s → ~50 ms par tour sur 2 000 notes). Pythie depuis la discussion (`src/valhalla/volva/demande.ts`, action `resultats`) : « fais-moi une recherche sur … », vidéos, images, sons, 5 résultats par défaut, nombre gardé, cartes / tableau / liste / navigateur / voix. Essais : `test/reponses-odin.test.ts`. | Essayer dans le vrai Odin (vignettes via `/api/recherche/vignette`, lecture YouTube : CSP `frame-src` ajoutée). |
| 2026-11-15 | Persona et Compagnon | Persona : groupes d'accès complets (`src/valhalla/sso/groupes.ts` : créer, renommer, supprimer, y mettre des personnes, applis et sites, double authentification par groupe ; droits appliqués aux ports, à l'interface — droit `odin` exigé —, au proxy — admin partout — et aux jetons), logiciels OpenID (Nextcloud, Gitea, Grafana, Penpot, Home Assistant) avec écran « Autoriser ? », clés d'accès WebAuthn sans dépendance (`sso/cles-acces.ts`, « Mon compte » `/sso/compte`), invitation par lien et mot de passe oublié par e-mail (`sso/comptes.ts`, boîte de Réglages → Mail) ; doc `docs/sso-protocole.md` § 13. Compagnon d'Odin (`src/valhalla/compagnon/` : agent Python `compagnon.py`, scripts sh / PowerShell, API `/api/compagnon/*`, actions de Satellites) : icône et bulles, antivirus avec les signatures d'Asclépios, mises à jour dans la version du système, failles (catalogue KEV), posé par Satellites ou par Genèse à la fin d'une installation. Essais : `test/persona-acces.test.ts` (13/13, vrai Odin), `test/compagnon.test.ts` (6/6, faux postes + vrai agent Python face à un vrai Odin). Pas essayé en vrai : clés d'accès dans un vrai navigateur (nom + vrai certificat), envoi d'e-mail réel, Nextcloud / Gitea réels, compagnon installé sur de vrais Windows / Linux / Mac (service, icône, Windows Update, winget). | Essayer le compagnon sur un vrai PC de chaque système ; clés d'accès sur le portail du proxy (autre domaine) ; mettre à jour le classeur. |
| 2026-11-15 | Phénix et Écho | Phénix : agent des PC (`src/valhalla/sindri/agent.py` + `agent.ts`, porte `src/web/phenix-agent-api.ts`) installé par Satellites (Linux / Mac : crontab ; Windows : tâche planifiée toutes les heures, compte système + VSS si administrateur, sinon dossier Démarrage), sauvegarde incrémentielle dédupliquée vers le plan « PC · poste », restauration sur le PC depuis le navigateur (grave) ; image disque complète (`sindri/image.ts` : partclone / dd, VSS + copie brute, hdiutil / asr), vérifiée, rotation, remise sur un disque (grave, jamais le disque du système). Écho : capsule installée sous Windows par SSH ou WinRM (`rodd/capsule-windows.ts`, `machines/windows.ts`), profil de la personne, veille Ctrl+Espace à l'ouverture de session, micro Windows sans logiciel, retrait complet. Essais : `phenix-agent`, `phenix-image`, `capsule-windows` (faux SSH / faux PowerShell). Rien essayé sur un vrai PC Windows (VSS, WinRM, Ctrl+Espace, micro), ni vrai partclone / hdiutil / asr. | Essayer en vrai sur un PC Windows et un Linux ; mettre à jour le classeur. |
| 2026-11-15 | Parole d'Odin | Un seul moteur « que dire maintenant » (`src/valhalla/parole.ts`, `POST /api/valhalla/parole`) pour tout ce que dit la mascotte : la fenêtre ouverte (appli : ses chiffres, alertes, actions, liens ; pages : mode d'emploi de `guide.js`), les alertes, tâches, dernières demandes, demandes qui reviennent, le Cerveau (fiche de l'appli et « Mes notes », notes qui en parlent, retards) et la mémoire. Toucher Odin : une nouvelle utile + l'étape suivante du mode d'emploi ; carnet par personne (`valhalla/parole.json`, 60 jours) : jamais deux fois la même phrase ni la même proposition ; rien de neuf : il le dit une fois puis se tait. Branché sur « Que veux-tu ? » (`notices.js`), Odin de la Discussion (`ui.html` : plus de conseils tirés au hasard), clic rapide « Une phrase » (`mascotte.js`). Essai : `test/odin-parole.test.ts` (5/5). Non vérifié dans un vrai navigateur. | Essayer sur téléphone et ordinateur ; régler les poids si l'ordre des phrases ne plaît pas. |
| 2026-11-15 | Cerveau unique | Plus d'écran « Mémoire » : les souvenirs sont la rubrique « Souvenirs » du Cerveau (`brain.js`, panneau `#brMem` de `ui.html`), la recherche du Cerveau les trouve (`/api/brain/search` → `memories`, `cerveau_chercher`). Avant chaque réponse, l'agent consulte le Cerveau (`src/brain/contexte.ts` : notes, fiches des applis, liens `[[…]]` suivis, applis du besoin) dans le prompt du tour. Choix de l'appli : mots des applis + usages connus (`src/valhalla/besoin.ts`, utilisé par `advise`) ; 8 usages ajoutés (plus aucune appli isolée), anciens noms retirés des fiches (Appareils, Hermóðr). Essai : `test/cerveau-unique.test.ts`. Non vérifié dans un vrai navigateur. | Essayer l'écran Souvenirs dans le Cerveau sur téléphone et ordinateur. |
| 2026-11-15 | Plan des ports | v1.35.0 : Odin passe de 7777 à 8888 (canal HTTP 7778 → 8889) dans le code, l'installation, Docker, la CI, Pégase, Agora, les clients et la doc ; chaque appli a son port par défaut `8FNN` (`DEFAULT_DIRECT` dans `src/valhalla/ports.ts`), ouvert d'office là où écoute l'interface, modifiable dans « Son port » et Réglages → Ports (« Remettre », « Ouvrir le pare-feu ») ; retrait gardé (`retires`) ; `web.portsParAppli` (coupé dans les essais). Essai : `test/ports-par-appli.test.ts`. | Mettre le classeur à jour quand il est fermé dans Excel. |
| 2026-11-15 | Fin des applis en cours | Hydre (créer, cloner, modèles, disque, adresse fixe, console LXC, clavier VM), Phénix (complète / incrémentielle / différentielle, SFTP, partage, restauration par le navigateur), Arche (2e site vérifié), Héraclès et Dédale sur un autre poste, Orphée en direct (service Python `voix-temps-reel/`), Logos pour la voix, Mnémosyne (Projet actif, audio brut), Écho (capsule Linux / Mac), Odyssée (livres), export Google Docs. Essais nouveaux tous verts ; essais Linux-seulement identiques avant / après. Rien essayé sur un vrai SFTP, SMB, QEMU / LXC, Google, ni avec Silero / Smart Turn. | Reste : agent PC et image disque de Phénix, capsule Écho sous Windows, écran vidéo des VM. Mettre à jour le classeur (fermé dans Excel). Valider `docs/plan-ports.md` puis coder les ports. |
| 2026-11-15 | Connexion par port d'appli | v1.34.0 : sur le port d'une appli, connexion par e-mail et mot de passe (propriétaire ou personne de Persona) ou par QR code autorisé depuis un téléphone déjà connecté ; sans droit sur l'appli : pas de session, retour à l'écran de connexion d'Odin (`?refus=`). Essais : `test/connexion-qr.test.ts` (6/6). Les essais `ports-directs` qui demandent Linux échouent sur Windows, avant comme après. | Port d'Odin 8888 et un port dédié par appli (demandé, pas commencé). |
| 2026-11-15 | Organisation | Classeur réorganisé par appli : nom validé en 1re colonne, lignes triées par appli, colonne Port (d'après `src/valhalla/ports.ts`), état en dernière colonne coloré (vert / jaune / rouge, gris = à évaluer), texte replié dans les cellules. | — |
| 2026-11-15 | Couleurs et noms | Classeur : lignes colorées selon l'état (vert codé, jaune en cours, rouge pas codé, gris à évaluer), couleurs qui suivent les listes déroulantes ; 11 noms proposés (onglet « Noms proposés », en bleu, à valider) pour Forseti, Valgrind, Midgard, Hnoss et 7 chantiers sans nom. Code inchangé. | Valider ou refuser les noms proposés ; une fois validés, les reporter dans `src/valhalla/names.ts` (NAMES, NAME_STORY). |
| 2026-11-15 | Catalogue | Tableau du propriétaire corrigé et versé dans `docs/odin-couverture-catalogue.xlsx` (remplace `applicatifs-odin.xlsx`) : Gygès, Tirésias, Perséphone, Ulysse passés à « Codé » ; Partage/export « En cours » (Google Docs) ; lignes Pégase, SSO, Vénus remplies ; Excalidraw « Codé », Penpot « En cours » ; noms grecs partout ; 79 logiciels ajoutés ; onglet « Corrections ». | Évaluer les 79 logiciels ajoutés ; revérifier les « En cours » du catalogue. |
| 2026-11-15 | Inventaire | Séparation application / Odin OS : README (application d'abord, Odin OS en dernière section), `ODIN-OS.md` à part. | — |
| 2026-11-15 | Reprise | Dépôt cloné dans `V:\Work\ODIN` ; inventaire des applis et de leur état ; création de ce fichier. Aucun code modifié. | Obtenir la feuille « Catalogue » ; choisir le prochain chantier (section 6). |

---

## Comment tenir ce fichier à jour

À la fin de chaque session qui change quelque chose :
1. Mettre à jour la date et la version en haut.
2. Changer l'état des applis touchées (section 5) et les chantiers (section 6) : retirer ce qui est fini, ajouter ce qui est nouveau.
3. Ajouter **une ligne en haut** du journal (section 8) : date, qui, ce qui a été fait, prochaine étape.
4. Noter toute nouvelle décision du propriétaire dans « Règles du projet » (section 4), avec sa date.

Rester court : ce fichier sert à reprendre le fil, pas à remplacer le README.
