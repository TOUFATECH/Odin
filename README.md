<div align="center">

# ᛟ Odin Agent IA

**Ton agent IA personnel : il réfléchit avant d'agir, apprend de chaque tâche, et ne te dérange que quand ça compte.**

[![Tests](https://github.com/TOUFATECH/Odin/actions/workflows/ci.yml/badge.svg)](https://github.com/TOUFATECH/Odin/actions/workflows/ci.yml)
![Licence MIT](https://img.shields.io/badge/licence-MIT-green)
![Node 22.18+](https://img.shields.io/badge/node-%E2%89%A5%2022.18-blue)
![macOS · Linux · Windows](https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-ok-lightgrey)

[Installation](#installation) · [Premiers pas](#premiers-pas) · [Utilisation](#utilisation) · [Décisions et autonomie](#décisions-et-autonomie) · [Sécurité](#sécurité) · [Commandes](#toutes-les-commandes) · [Dépannage](#dépannage)

</div>

---

## Ce que fait Odin

- **Il travaille pour toi** : fichiers, commandes, recherche web, messages, tâches planifiées, sous-agents en parallèle.
- **Il vit où tu es** : interface web locale, terminal, Telegram, API HTTP.
- **Il décide seul la routine, de façon transparente** : chaque action reçoit une gravité. La routine est faite et annoncée ; l'important et le grave te sont demandés.
- **Il se souvient et apprend** : mémoire durable avec recherche, compétences proposées après une tâche réussie (tu les relis avant de les activer).
- **Il connaît ton réseau** : inventaire automatique des appareils, alerte quand l'un apparaît, se déconnecte ou disparaît.
- **Il est sûr par défaut** : une page web piégée ne peut pas lui faire exécuter, écrire ou envoyer quoi que ce soit ; les secrets sont masqués partout ; chaque décision est tracée.
- **Il est léger** : aucune dépendance à l'exécution, un seul fichier de données (SQLite), ~5 000 lignes de code commentées en français.

---

## Installation

### macOS et Linux

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.sh | bash
```

### Windows (PowerShell, sans droits administrateur)

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.ps1 | iex
```

L'installateur :

1. vérifie Node.js ≥ 22.18 ; s'il manque, il télécharge Node 22 officiel (somme SHA-256 vérifiée) dans ton dossier personnel, sans toucher au système ;
2. installe Odin (`~/.odin/app` sur macOS et Linux, `%LOCALAPPDATA%\Odin\app` sur Windows) ;
3. crée la commande `odin` ;
4. initialise `~/.odin` (configuration, personnalité, mémoire, espace de travail) ;
5. te propose : ta clé d'API, l'inventaire du réseau local, le démarrage automatique (launchd, systemd ou Planificateur de tâches).

Installation sans question : `ODIN_YES=1` (ajoute `ODIN_NO_SERVICE=1` ou `ODIN_NO_SCAN=1` pour sauter une étape).

<details>
<summary><b>Depuis les sources</b></summary>

```bash
git clone https://github.com/TOUFATECH/Odin.git
cd odin
npm install          # uniquement les outils de développement
npm link             # rend la commande « odin » disponible
odin init
```

Node.js exécute directement le TypeScript : aucune compilation.
</details>

<details>
<summary><b>Avec Docker</b></summary>

```bash
docker build -t odin .
docker run -d --name odin -v odin-data:/data -e ANTHROPIC_API_KEY=… odin
docker exec -it odin node bin/odin.mjs chat
```

Dans un conteneur, l'interface web est en mode réseau local par défaut : publie le port (`-p 7777:7777`) et ouvre `https://<ip-de-la-machine>:7777`. L'API HTTP reste disponible (`"http": { "host": "0.0.0.0" }` dans `/data/config.json`, port 7778).
</details>

**Mise à jour** : `odin update` · **Désinstallation** : voir [Dépannage](#dépannage).

---

## Premiers pas

### 1. Choisir le modèle dans l'interface web

À la fin de l'installation, l'interface web s'ouvre sur l'onglet **Réglages** (sinon : `odin web`).

1. Choisis un fournisseur : **Anthropic**, **OpenRouter**, **OpenAI**, **Ollama** (local, sans clé) ou un autre service compatible OpenAI.
2. Colle ta clé d'API, clique **Tester**, puis **Enregistrer**. Odin redémarre ses services tout seul et sort du mode démo.
3. Dans le même onglet : niveau d'autonomie, juge des décisions, bot Telegram, suivi du réseau local.

Les clés sont écrites dans `~/.odin/env` (lisible par toi seul) : jamais dans `config.json`, jamais renvoyées à la page. Tu peux aussi éditer ce fichier à la main :

```bash
ANTHROPIC_API_KEY=sk-ant-…
```

Sans aucun modèle, Odin démarre en **mode démo** pour que tu puisses explorer.

### 2. Vérifier

```bash
odin doctor
```

### 3. Parler à Odin

```bash
odin web      # ouvre l'interface dans ton navigateur
odin chat     # ou directement dans le terminal
```

Essaie : *« Quels appareils sont sur mon réseau ? »*, *« Range mon dossier Téléchargements par type »*, *« Chaque matin à 7 h 30, prépare-moi un résumé de mes tâches »*.

---

## Utilisation

### Interface web

`odin web` ouvre l'interface. Par défaut elle est **joignable sur ton réseau local, en HTTPS** : `https://127.0.0.1:7777` sur la machine, `https://192.168.1.20:7777` (son adresse locale) depuis ton téléphone. Les liens personnels, avec jeton, s'affichent au démarrage ; le jeton est aussi dans `~/.odin/web-token`.

| Onglet | Ce que tu y fais |
|---|---|
| **Discussion** | parler à Odin, voir ses outils en direct, répondre aux validations en un clic (Autoriser · Toujours autoriser · Refuser) |
| **Missions** | tout ce qu'Odin fait ou a fait : origine (toi, tâche planifiée, initiative), étapes, outils, sous-agents, coût ; **Arrêter** une mission en cours, **Reprendre** une mission interrompue |
| **Réseau** | appareils en ligne, déconnectés, retirés ; ce qu'Odin peut faire avec chacun ; balayage à la demande |
| **Mémoire** | souvenirs d'Odin ; valider ceux en quarantaine, épingler, oublier |
| **Compétences** | relire et approuver les compétences qu'Odin propose |
| **Tâches planifiées** | voir et supprimer les tâches récurrentes |
| **Décisions** | tout ce qu'Odin a fait, qui l'a décidé et pourquoi ; niveau d'autonomie ; autorisations permanentes |
| **Réglages** | modèle et clés (avec test), **budget mensuel** et dépense par modèle et par usage, autonomie et juge, **personnes** (propriétaires, membres, invités), Telegram, voix, réseau local, accès, **sauvegarde chiffrée** |

#### Qui peut ouvrir l'interface ?

Au choix, à l'installation, dans **Réglages → Accès à l'interface** ou avec `odin web access` :

| Mode | Qui peut l'ouvrir | Chiffrement |
|---|---|---|
| **lan** (par défaut) | cette machine et les appareils de ton sous-réseau (ex. `192.168.1.0/24`, détecté tout seul, ou ta liste de réseaux) ; les autres adresses sont ignorées | HTTPS (désactivable avec `--http`) |
| **local** | cette machine seulement (`127.0.0.1`) | HTTP (rien ne circule sur le réseau) |
| **wan** | tout Internet (pense à rediriger le port sur ta box, ou à utiliser un tunnel) | HTTPS obligatoire ; ou `--proxy` si Caddy, Nginx ou Cloudflare Tunnel chiffre devant Odin |

Le certificat HTTPS est créé par Odin lui-même (aucun outil à installer) pour `localhost`, l'adresse locale et le nom de la machine. Ton navigateur demandera de l'accepter une fois : compare son empreinte avec celle de Réglages. Tu peux aussi donner ton propre certificat (Let's Encrypt…).

**Première connexion** : tant qu'aucun appareil ne s'est jamais connecté, le premier navigateur de ton réseau local qui ouvre Odin (tant qu'il n'est pas configuré, ou dans l'heure qui suit son démarrage) devient le tien, sans jeton à chercher : bouton **Commencer**. Ensuite, le jeton est obligatoire. Pour retrouver tes liens à tout moment, en ligne de commande : `odin link` (dans un LXC Proxmox, depuis l'hôte : `pct exec <ID> -- odin link`). L'installateur les affiche aussi à la fin.

Dans tous les modes, chaque appel exige le jeton, et une adresse qui se trompe 10 fois en 10 minutes est bloquée 15 minutes. **Nouveau jeton** (Réglages, ou `odin web rotate`) déconnecte tous les appareils.

### Terminal

`odin chat`, puis dans la conversation : `/new` (nouvelle conversation), `/memory mot`, `/skills`, `/drafts`, `/cost`, `/exit`. **Ctrl+C** interrompt Odin. Une seule demande : `odin run "…"`.

### Telegram

1. Crée un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`) et copie son jeton.
2. Dans l'interface web, **Réglages → Telegram** : colle le jeton, coche « Activer », enregistre.
3. Écris à ton bot : il te répond avec ton identifiant. Ajoute-le dans « Tes identifiants Telegram » et enregistre : Odin relance le canal tout seul.

Dans Telegram : `/stop` interrompt, `/new` repart de zéro, `/status` affiche les coûts, `/yes ID` · `/always ID` · `/no ID` répondent aux validations. Un inconnu reçoit un code d'appairage ; tu l'acceptes avec `odin pairing approve telegram CODE`.

### API HTTP

Pour brancher Odin à un raccourci iPhone, à n8n ou à ta propre page :

```bash
# ~/.odin/env : ODIN_HTTP_TOKEN=une-longue-chaine-aleatoire
# config.json  : "http": { "enabled": true, "port": 7778, "tokenEnv": "ODIN_HTTP_TOKEN" }
curl -s http://127.0.0.1:7778/v1/message \
  -H "Authorization: Bearer $ODIN_HTTP_TOKEN" \
  -d '{"peer":"moi","text":"Quelles sont mes tâches planifiées ?"}'
```

### Tâches planifiées

Demande-le simplement (*« tous les lundis à 9 h, fais le point sur mes projets »*) ou :

```bash
odin cron add "30 7 * * 1-5" "Prépare mon brief du matin" telegram TON_ID
odin cron list
```

Les tâches s'exécutent quand `odin web` ou `odin gateway` tourne. Sans personne pour valider, seule la routine passe.

### Mémoire

Odin retient seul ce qui est durable (préférences, faits, projets) et le retrouve quand c'est utile. Il refuse les secrets et l'éphémère. Ce qu'il apprend d'une source non fiable reste en **quarantaine** tant que tu ne l'as pas validé.

```bash
odin memory              # liste
odin memory search café  # recherche
odin memory vouch 12     # valider un souvenir en quarantaine
odin memory forget 12
```

### Compétences

Après une tâche réussie en plusieurs étapes, Odin propose une **compétence** : une procédure réutilisable, au format `SKILL.md` du standard ouvert agentskills.io. Elle reste un brouillon jusqu'à ce que tu l'approuves.

```bash
odin skills drafts
odin skills diff deploy-site
odin skills approve deploy-site     # ou reject ; rollback pour revenir à la version précédente
```

Tu peux aussi écrire les tiennes dans `~/.odin/skills/<nom>/SKILL.md` (exemple dans `templates/skills/`).

### Réseau local

```bash
odin net enable              # balayage automatique toutes les 30 min
odin net scan --full         # balayage complet maintenant (~30 s)
odin net list                # ● en ligne  ○ déconnecté  × retiré
odin net show 192.168.1.20   # détail, historique, ce qu'Odin peut faire avec
odin net label 192.168.1.20 "Imprimante du bureau"
```

Odin découvre les appareils sans droits administrateur (table ARP, balayage TCP léger, Bonjour, UPnP) et **ne balaie que les réseaux privés de sa machine**, jamais Internet. Absent, un appareil passe « déconnecté », puis « retiré » après 7 jours ; tu es prévenu à chaque changement.

### Documents et médias

Odin lit et produit les formats du quotidien, sans rien installer :

| Type | Lire | Créer / transformer |
|---|---|---|
| PDF | texte (lecteur intégré, `pdftotext` s'il existe) | PDF A4 paginé à partir de texte simple |
| Word `.docx` | titres, listes, texte | document avec titres, gras, listes |
| Excel `.xlsx` | chaque feuille en tableau | classeur multi-feuilles, formules (`=SUM(B2:B9)`) |
| PowerPoint `.pptx` | texte de chaque diapositive | présentation titre + puces |
| Images | description, lecture du texte (vision du modèle) | conversion, redimensionnement |
| Vidéo, audio | informations, **transcription** (Whisper) | format, découpe, extraction du son, miniature (`ffmpeg`) |

Envoie un fichier à Odin sur Telegram ou dépose-le dans `~/.odin/workspace`, puis demande : « résume ce PDF », « fais-en un Excel », « transcris cette réunion ». Un fichier venu de l'extérieur est traité comme un contenu non fiable.

### Voix

Réglages → Voix. **Whisper** (OpenAI, ou un serveur local sans clé, ex. [speaches](https://github.com/speaches-ai/speaches)) transcrit ce que tu dis : micro de l'interface, notes vocales Telegram, fichiers audio. Pour parler, au choix : **ElevenLabs** (voix naturelles, **copie de ta voix** à partir d'un enregistrement d'une minute, avec ton accord explicite), **Piper** (gratuit, hors ligne, sur ta machine : `pip install piper-tts` puis `python3 -m piper.http_server --model fr_FR-siwis-medium`), ou tout serveur **compatible OpenAI** `/v1/audio/speech` (Kokoro, openedai-speech…). Avec Piper et un Whisper local, ta voix ne quitte jamais la maison ; les notes vocales Telegram sont converties en Opus par ffmpeg s'il est là.

### Modèles : le bon pour chaque tâche

Configure plusieurs modèles (Réglages → Modèle) : un par défaut, des secours, et leur palier : **installé/gratuit** (Ollama…), **standard**, **le plus capable**. Odin choisit le moins cher qui suffit : question simple → modèle local, tâche ordinaire → standard, tâche complexe → le plus capable. Quand un modèle arrive **à bout de quota**, il passe au suivant tout seul et te le dit. Pour une **décision risquée**, il croise l'avis de plusieurs modèles et retient le plus prudent (seulement quand un vrai danger est probable, et un même verdict est réutilisé dix minutes : ça ne coûte pas à chaque fichier écrit). **Codex** (OpenAI) peut recevoir les tâches de code : `npm install -g @openai/codex`.

**Ton abonnement ChatGPT via Codex** (comme `hermes auth add openai-codex`) : Réglages → Modèle → *OpenAI Codex (abonnement ChatGPT)* → **Se connecter avec ChatGPT**, ou en ligne de commande :

```bash
odin auth add openai-codex   # connexion (lien à ouvrir ; sur un serveur/LXC, recolle l'adresse de retour)
odin model codex gpt-6-luna  # choisir Codex et le modèle de ton abonnement
odin doctor                  # vérifier
```

Odin a **sa propre connexion**, rangée dans `~/.odin/codex-auth.json` (lisible par toi seul) et renouvelée toute seule : elle n'est jamais partagée avec Codex CLI ni Hermes (deux programmes sur la même connexion se déconnecteraient l'un l'autre). Ne colle jamais un jeton dans une discussion : seule l'adresse de retour de la page de connexion est à recopier, et seulement dans Odin.

**Budget mensuel** (Réglages → Modèle) : un plafond en dollars ; tous les appels sont comptés (agent, juges, résumés, observation, vision), la dépense s'affiche par modèle et par usage, et une fois le plafond atteint seuls les modèles gratuits servent, Odin te le dit.

### Son visage et ses humeurs

Odin a un visage, une petite boule aux deux yeux qui **change de couleur selon son humeur** ; ses yeux, toujours droits, changent de taille, de place et de mouvement selon l'émotion (tout petits quand il est gêné, plissés quand il est fâché, mi-clos quand il est fatigué, grands quand il est surpris, un clin d'œil…). Une vingtaine d'humeurs en tout : content, rieur, attendri, fier, enthousiaste, complice, malicieux, surpris, pensif, concentré, perplexe, inquiet, triste, fâché, effrayé, gêné, fatigué, à l'écoute, attentif… **Il choisit lui-même son humeur** à chaque réponse, selon ce qu'il vit avec toi. Entre deux réponses, son visage réagit tout seul : il t'écoute quand tu écris ou parles, se concentre quand il travaille, regarde quand tu lui montres une photo (bouton 📷), parle quand il lit sa réponse à voix haute, **ferme les yeux quand tu tapes une clé** dans les réglages, sourit quand un réglage est enregistré, s'endort si on l'oublie. Touche-le : il saute ; touche-le trop, il se fâche, devient rouge, puis bleu, puis redevient jaune. Chaque mouvement a son petit **son**, synthétisé dans le navigateur : « boing » quand il saute, grognement quand il se fâche, petit « tic » quand il ferme puis rouvre les yeux, carillon montant quand il est content, descendant quand il est triste (bouton pour couper les sons, sur le site comme dans l'interface). Sur **Telegram**, il t'envoie l'autocollant de son visage, à la couleur de son humeur, quand elle change (`mood.stickers` dans la configuration).

### Navigateur : il ouvre des pages, remplit des formulaires

Odin pilote un vrai navigateur (le Chrome, Chromium ou Edge de la machine, sans rien d'autre à installer ; invisible sur un serveur ou un LXC) : il **ouvre une page**, **regarde** ce qui est visible (liens, boutons, champs numérotés, texte, et au besoin une capture analysée par la vision du modèle), puis **clique, écrit, choisit dans une liste, appuie sur une touche, fait défiler, revient en arrière**, comme une personne. Il garde ses connexions aux sites (profil dans `~/.odin/browser`) et peut aussi ouvrir l'interface de tes appareils (box, NAS, caméras). Pas de navigateur sur la machine : `sudo apt install chromium`. Le contenu des pages reste non fiable (une page ne lui donne jamais d'ordre) ; cliquer ou envoyer un formulaire suit ton niveau d'autonomie.

### Droits : sa machine et les machines du réseau

Odin peut **tout faire sur sa machine** et sur **les machines de ton réseau** : il suffit de lui donner les mots de passe (Réglages → **Droits et machines**, ou en ligne de commande).

```bash
odin admin password                       # mot de passe sudo : chaque « sudo » d'Odin le reçoit tout seul
odin admin nopasswd                       # ou : sudo sans mot de passe pour Odin (règle vérifiée par visudo)
odin machines add 192.168.1.30 admin --nom NAS   # une machine du réseau (SSH) : mot de passe demandé
odin machines list · odin machines test NAS · odin machines remove NAS
```

En root (conteneur LXC…), Odin est déjà administrateur. Sur les autres machines, il se connecte en SSH (client du système) ; « sudo » y fonctionne aussi avec le mot de passe donné, et sa propre clé SSH peut y être installée. Les mots de passe restent dans `~/.odin` (fichiers lisibles par toi seul, inclus dans la sauvegarde chiffrée), ne sont jamais réaffichés ni montrés au modèle, et sont masqués dans tout ce qu'il lit et écrit. Les règles de sécurité restent : commandes destructrices interdites, validation selon ton niveau d'autonomie.

### Personnes : famille, équipe

Réglages → Personnes (ou `odin pairing approve telegram CODE --membre Léa`). Trois rôles :

| Rôle | Ce qu'Odin fait avec |
|---|---|
| **Propriétaire** | tout : demandes, validations, réglages |
| **Membre** | de confiance (ses messages ne sont pas traités comme une donnée externe), Odin l'aide volontiers et retient ce qu'il apprend de lui à son nom ; son autonomie est **plafonnée** (prudent par défaut, jamais Breaker), ses demandes importantes **te sont soumises** (il est prévenu), il ne peut ni valider ni changer un réglage |
| **Invité** | appairé, mais ses messages restent du contenu non fiable : rien d'important sans ta validation |

Quand quelqu'un écrit au bot Telegram, sa demande apparaît dans Réglages → Personnes : **Accepter comme membre**, **Comme invité**, ou **Refuser**.

### Sauvegarde et restauration

Réglages → Sauvegarde, ou `odin backup` : tout `~/.odin` (configuration, clés, mémoire, compétences, espace de travail) dans un seul fichier **chiffré** (AES-256-GCM, clé dérivée du mot de passe par scrypt) ; sans le mot de passe il ne révèle rien, pas même les noms de fichiers. `odin restore fichier.odinbk` (Odin arrêté) ou le bouton Restaurer remet tout en place sur une nouvelle machine ; les fichiers remplacés sont gardés en `.avant-restauration` jusqu'au démarrage suivant.

### Apprentissage rapide

Après chaque échange, Odin retient jusqu'à trois faits durables (tes préférences, ton environnement, tes missions), jamais de secret, jamais depuis une page web. Il connaît le profil de sa machine (système, ressources, outils). En Odin Breaker, les compétences qu'il apprend sont actives tout de suite.

### Mises à jour de la machine

`odin updates` liste les mises à jour disponibles (apt, dnf, pacman, Homebrew, softwareupdate, winget). Odin peut les installer **avec ton accord** ; ce n'est jamais une décision de routine.

---

## Décisions et autonomie

Avant chaque action qui écrit, exécute ou envoie, Odin se pose 7 questions simples : l'as-tu demandée ? supprime-t-elle des données ? envoie-t-elle des données dehors ? modifie-t-elle le système ? engage-t-elle de l'argent ? partage-t-elle des données privées ? est-elle difficile à annuler ? Une table de vérité, écrite dans le code, en déduit une **gravité** :

| Gravité | Exemples | Prudent | **Équilibré** (défaut) | Autonome | ⚡ Odin Breaker |
|---|---|---|---|---|---|
| routine | créer le dossier demandé, envoyer le message dicté | demande | **fait seul, et te le dit** | fait seul | fait seul |
| important | droits administrateur, suppression définitive, effet incertain, contenu web douteux lu | demande | **demande** (ou autorisation permanente) | fait seul\* | fait seul |
| grave | argent, données privées envoyées, suppression ou changement système non demandés | demande | **demande toujours** | demande toujours | fait seul\*\* |
| bloqué | envoi non demandé après lecture d'une page piégée | refus | **refus** | refus | refus |

\* sauf après lecture de contenu non fiable. \*\* sauf si un contenu non fiable vient de la suggérer.

### ⚡ Odin Breaker : l'autonomie totale

Le quatrième niveau. Odin mène ses missions **sans plus rien te demander**, actions graves et tâches planifiées comprises ; il discute simplement avec toi quand tu lui parles.

- **Initiative** : il crée lui-même tâches planifiées et rappels (`reminder_set`) quand il repère un besoin ; chaque soir, il relit sa journée et met en place ce qui manque.
- **Réseau local ouvert** : il agit directement sur tes appareils et services locaux (box, NAS, imprimante, domotique, API locales) avec `http_request`, inventaire et mises à jour compris.
- **Missions longues** : jusqu'à 100 étapes par mission et un plafond de coût réglable (5 $ par défaut, 0 = sans plafond).
- **Rapport du soir** (21 h par défaut) : tout ce qu'il a fait seul, les actions graves, et ce qu'il a refusé pour te protéger.
- **Quand** : tout le temps, ou **seulement la nuit** (de 22 h à 7 h par défaut, avec le niveau de ton choix le jour).
- **Ce qui reste refusé** : les seules limites protègent contre les attaques, pas contre toi. Ce sont les commandes destructrices connues (effacer le disque…), les envois de données dictés par une page piégée, les actions graves qu'un contenu non fiable vient de suggérer, et les services de métadonnées cloud.

Activer : onglet Décisions ou Réglages (bouton **⚡ Odin Breaker**), ou `odin breaker on` (`odin breaker nuit` pour la nuit seulement, `odin breaker off` pour revenir).

- **Transparence** : chaque décision prise seul est annoncée pendant le travail et résumée à la fin de la réponse (« 🛡 Décidé sans te déranger »). Historique complet : onglet **Décisions** ou `odin decisions`.
- **Autorisation permanente** : pour une action importante, réponds « toujours » ; Odin ne te redemandera plus pour ce type d'action (`shell:make install`, par exemple). Jamais pour le grave. Liste et retrait : `odin grants`.
- **Niveau** : `odin mimir autonomy prudent|equilibre|autonome|breaker`, ou les boutons de l'onglet Décisions.

### Qui répond aux questions ?

Par défaut, un **juge local** : hors ligne, sans clé, moins d'une milliseconde, rien ne sort de ta machine. Quand il ne sait pas (programme inconnu, tournure inédite), il répond « incertain », et Odin te demande. Tu peux lui adjoindre un juge plus fin, consulté **seulement quand le juge local hésite** :

| `odin mimir use …` | Clé | Réseau |
|---|---|---|
| `local` (défaut) | aucune | aucun |
| `local+llm` | aucune avec Ollama | seulement si le juge local hésite |
| `local+jev` | `JEV_API_KEY` ([Jev de TypeSafe](https://docs.typesafe.ai)) | seulement si le juge local hésite |
| `llm` · `jev` | idem | à chaque question |

`odin mimir test` montre les jugements sur 5 exemples ; `odin mimir eval` mesure le juge sur 140 cas étiquetés (ajoute les tiens dans `src/mimir/cases.ts`). Sur des cas écrits après le gel de ses règles, le juge local voit juste 78 % du temps ; ses erreurs ajoutent moins de protection, jamais moins de sécurité, car les règles de base de Heimdall restent en place. Une panne du juge n'est jamais lue comme un « non ».

---

## Sécurité

Odin applique sa sécurité **dans le code**, pas dans le prompt :

- **Marquage du contenu non fiable** : dès qu'Odin lit une page web ou le message d'un inconnu, écrire, exécuter ou envoyer demande ta validation. Une page piégée ne peut pas le retourner contre toi.
- **Règles absolues** : `rm -rf /`, `curl … | sh`, `mkfs`, `format C:`, `diskpart`… sont refusés même si tu acceptes.
- **Shell sans secrets** : les variables contenant KEY, TOKEN, SECRET ou PASSWORD sont retirées de son environnement. Bac à sable Docker en option (`policy.sandbox.kind: "docker"` : sans réseau, lecture seule, ressources limitées).
- **Secrets masqués** partout : avant le modèle, dans la mémoire, les journaux et les messages. La configuration ne contient jamais de clé, seulement le nom de la variable qui la contient.
- **Fichiers confinés** à l'espace de travail (`~/.odin/workspace`), liens symboliques compris.
- **Anti-SSRF** : l'outil web n'accède pas aux adresses internes.
- **Inconnus** appairés par code ; **interface web** en HTTPS sur ton réseau local (ou cette machine seulement, ou Internet en HTTPS obligatoire), jeton exigé partout, essais ratés limités ; **journal** de chaque décision (`~/.odin/logs/audit.jsonl`).

---

## Toutes les commandes

| Commande | Rôle |
|---|---|
| `odin init` | crée `~/.odin` |
| `odin doctor` | diagnostic complet |
| `odin web` | interface web + Telegram + API + tâches planifiées |
| `odin web access [lan\|local\|wan]` | qui peut ouvrir l'interface (`--http`, `--proxy`) |
| `odin link` (ou `odin web link`) | affiche les liens personnels (avec jeton) |
| `odin web rotate` | nouveau jeton : déconnecte tous les appareils |
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
| `odin admin [status\|password\|nopasswd\|forget]` | droits administrateur sur sa machine |
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
| `web.port` | 7777 | port de l'interface web |
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
| Le téléphone n'arrive pas à ouvrir l'interface | même Wi-Fi que l'ordinateur ; utilise l'adresse `https://…` affichée au démarrage ; vérifie que son réseau figure dans Réglages → Accès ; autorise le port 7777 dans le pare-feu |
| « Ta connexion n'est pas privée » | normal la première fois avec le certificat créé par Odin : compare l'empreinte (Réglages → Accès) puis accepte |
| `odin : commande introuvable` | ouvre un nouveau terminal (le PATH a été mis à jour) |
| Odin répond « mode démo » | Réglages → Modèle : colle ta clé (ou choisis Ollama), « Tester », « Enregistrer » |
| Telegram ne répond pas | Réglages → Telegram : jeton enregistré, « Activer » coché, ton identifiant ajouté ; puis `odin doctor` |
| Odin me demande trop souvent | réponds « toujours » aux demandes importantes récurrentes, ou `odin mimir autonomy autonome` |
| Aucun appareil trouvé | la machine doit être sur un réseau privé (Wi-Fi, Ethernet) ; lance `odin net scan --full` |

**Désinstaller** : macOS `launchctl unload ~/Library/LaunchAgents/ai.odin.gateway.plist` · Linux `systemctl --user disable --now odin` · Windows `Unregister-ScheduledTask Odin` ; puis supprime `~/.odin` (et `~/.local/bin/odin` ou `%LOCALAPPDATA%\Odin`).

---

## Développement

```bash
npm install
npm run check      # vérification des types + tests
```

| Dossier | Module |
|---|---|
| `src/core` | **Huginn**, la boucle de l'agent |
| `src/heimdall` | sécurité : politique, marquage, secrets, chemins |
| `src/mimir` | décisions : questions, juges, tables de vérité |
| `src/muninn` | mémoire SQLite |
| `src/yggdrasil` | compétences |
| `src/tools` | outils (**Gungnir**) |
| `src/bifrost` | passerelle et canaux |
| `src/hlidskjalf` | inventaire du réseau |
| `src/web` | interface web (dont l'onglet Réglages) |
| `src/settings.ts` | réglages modifiables depuis le web : modèle, clés (~/.odin/env), Telegram, réseau |
| `src/providers` · `src/cron` · `src/cli` | modèles · planification · commandes |

Ajouter un outil = un objet avec un nom, une description, un **niveau de risque** et une fonction `run` ; Heimdall et Mímir s'occupent du reste.

## Licence

[MIT](LICENSE) © TOUFATECH
