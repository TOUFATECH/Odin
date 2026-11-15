# Odin — avancement du projet (fil de suivi)

> **À lire en premier par toute personne qui reprend le projet.**
> Ce fichier dit où en est le projet, sans tout relire. Il est tenu à jour à chaque session de travail
> (voir « Comment tenir ce fichier à jour » tout en bas).
>
> Dernière mise à jour : **2026-11-15** · version du code : **1.33.0** (`package.json`) · branche : `main`

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
- Une action « grave » demande l'accord du propriétaire ; le texte venu de l'extérieur est une donnée, jamais un ordre.

## 5. État des applis

> Tableau complet (logiciels copiés, ce que fait chaque appli, histoire du nom, reste à faire, couleurs vert / jaune / rouge) :
> **`docs/applicatifs-odin.xlsx`**. Il fait foi pour l'état des applis : le garder aligné avec ce fichier.

Légende : ✅ codée · 🟡 codée, travail connu restant · ⬜ pas encore codée.
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
Aucune appli nommée n'est sans code dans le dépôt. La liste des applis **prévues** est dans la feuille « Catalogue »
du propriétaire (citée dans `names.ts`, **absente du dépôt**). À compléter quand elle sera fournie.

## 6. Chantiers ouverts (ce qui reste à faire)

| Chantier | Applis | Ce qui manque | Source |
|---|---|---|---|
| Voix temps réel | Orphée | service vocal Python (Silero, Smart Turn, transcription en direct, coupure < 200 ms) | `docs/voix-v2.md` |
| Voix : lexique | Logos | lexique appris, corrections par prononciation | `docs/voix-v2.md` |
| Projet actif | Mnémosyne | index des fichiers d'un projet, réponses sourcées sans IA ; option « garder l'audio brut » non branchée | `docs/voix-v2.md` |
| Données en base | Alexandrie + Pégase, Persona (journal), Valhalla (alertes), Mascotte, Arche, Agora… | migration fichiers JSON → PostgreSQL | `docs/bases-plan.md` |
| Signature | Pégase | installateurs `.exe` / `.dmg` pas encore signés | `README.md` |
| Catalogue | — | obtenir la feuille « Catalogue » pour lister les applis pas encore codées | — |

## 7. Branches

`main` est la référence. `correctif-maj`, `draupnir-runes`, `notifications-pastille` sont **déjà fusionnées** dans `main`
(rien de plus qu'elle au 15/11/2026).

## 8. Journal des sessions (le plus récent en haut)

| Date | Session | Ce qui a été fait | Prochaine étape |
|---|---|---|---|
| 2026-11-15 | Inventaire | Séparation application / Odin OS : README (application d'abord, Odin OS en dernière section), `ODIN-OS.md` à part. Classeur `docs/applicatifs-odin.xlsx` : 68 applis (47 terminées, 21 en cours), logiciels copiés, histoire des noms, 23 tâches restantes. Les « en cours » par manque de fonctions sont une estimation à confirmer. | Le propriétaire confirme les états ; fournir la feuille « Catalogue » (applis pas commencées). |
| 2026-11-15 | Reprise | Dépôt cloné dans `V:\Work\ODIN` ; inventaire des applis et de leur état ; création de ce fichier. Aucun code modifié. | Obtenir la feuille « Catalogue » ; choisir le prochain chantier (section 6). |

---

## Comment tenir ce fichier à jour

À la fin de chaque session qui change quelque chose :
1. Mettre à jour la date et la version en haut.
2. Changer l'état des applis touchées (section 5) et les chantiers (section 6) : retirer ce qui est fini, ajouter ce qui est nouveau.
3. Ajouter **une ligne en haut** du journal (section 8) : date, qui, ce qui a été fait, prochaine étape.
4. Noter toute nouvelle décision du propriétaire dans « Règles du projet » (section 4), avec sa date.

Rester court : ce fichier sert à reprendre le fil, pas à remplacer le README.
