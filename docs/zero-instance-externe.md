# Zéro instance externe : audit et plan de recodage

Audit du 16/11/2026 sur les 66 applis et le cœur. Règle du propriétaire : aucune appli ne dépend d'un logiciel serveur à installer ou à lancer à côté d'Odin ; tout est recodé dans Odin, avec un nom adapté.

Résultat : 127 dépendances relevées, dont 36 instances externes, regroupées ci-dessous en 16 familles. Ce fichier sert de fil pour le recodage ; il sera retiré quand tout sera fait.

## 1. Instances externes à recoder

### 1.1 Midgard, Hestia, Orphée, Apollon, outils Home Assistant du cœur

- **Dépend de** : Serveur Home Assistant du propriétaire, joint par une adresse réglable (haUrl / homeAssistant.url) et le jeton HA_TOKEN. Les annonces passent en plus par les services de synthèse de Home Assistant (google_translate_say, cloud_say de Nabu Casa).
- **Obligatoire ?** oui pour les outils ha_* du cœur ; pour une fonction dans Midgard (appareils, pièces, présence), Hestia (tuile appareils), Orphée (annonces sur les enceintes) et Apollon (musique sur une enceinte)
- **Sert à** : Piloter lumières, prises, volets et capteurs ; présence ; énergie ; annonce du réveil ; annonces et musique sur les enceintes de la maison
- **Proposition** : Deux blocs natifs. (1) « Stentor » (nom déjà porté par la partie « annonces » d'Orphée, bragi.ts:63) devient un vrai diffuseur : Odin fabrique le son avec son Piper local et l'envoie lui-même aux enceintes (Google Cast, DLNA/UPnP, AirPlay, Sonos) ; Apollon s'en sert aussi. (2) « Eunomia » (nom libre) : moteur domotique natif sous Midgard (Shelly/Tasmota en HTTP local, MQTT du relais Mercure, Matter, présence native par l'appli téléphone d'Odin), base MIDGARD_ODIN dans Alexandrie. Home Assistant ne reste qu'en importation ponctuelle. Note : « Hestia », « Oïkos », « Échô » et « Héphaïstos » proposés par les auditeurs sont déjà pris.
- **Effort** : enorme (Stentor seul : gros)
- **Déjà prévu** : non
- **Où dans le code** : src/tools/homeassistant.ts:12 « const url = (ctx.homeAssistant?.url ?? '')…, token = process.env.HA_TOKEN » ; src/valhalla/modules/midgard.ts:32 « if (!url || !token) return []; » et :68 « Home Assistant non relié » ; src/valhalla/modules/gladsheim.ts:450 homeDevices(…('midgard')) ; src/valhalla/modules/bragi.ts:25 haUrl + HA_TOKEN et :38 « 'google_translate_say', 'cloud_say' » ; src/valhalla/modules/aegir.ts:47 « relie ta box dans Apollon »

### 1.2 Vénus, Pulsar (sonde Venus), outil venus du cœur

- **Dépend de** : Serveur Venus séparé, joint par son adresse (Réglages → Maison → Venus) et la clé VENUS_API_KEY. S'y rattachent : l'import des indexeurs depuis le Prowlarr du propriétaire, et les moteurs de téléchargement tiers au choix (qBittorrent, Transmission, SABnzbd).
- **Obligatoire ?** oui (tout le module Vénus et l'outil venus) ; facultatif pour Prowlarr et les moteurs tiers (Comète sert par défaut)
- **Sert à** : Films, séries, chaînes, guide, enregistrements, écrans, sources Delta, téléchargements Comète ; sonde « Venus » de Pulsar
- **Proposition** : DÉJÀ PRÉVU : portage natif du serveur dans le module venus, base VENUS_ODIN dans Alexandrie. Dans le même lot : Delta interroge les indexeurs lui-même (Prowlarr seulement en import ponctuel, à vérifier côté serveur Venus, autre dépôt), retirer les options qBittorrent/Transmission/SABnzbd (Comète existe), remplacer la sonde Pulsar par une sonde interne.
- **Effort** : enorme
- **Déjà prévu** : oui
- **Où dans le code** : src/tools/venus.ts:13 « if (!url || !key) throw new Error('Venus n'est pas relié… ») » ; src/valhalla/modules/venus.ts:334 « Venus n'est pas relié. » ; :224 « Delta passe par l'API Torznab de Prowlarr » ; :255 « options: ['venus', 'qbittorrent', 'transmission', 'sabnzbd'] » ; src/valhalla/modules/vordr.ts:350 ctx.call('freyja', 'adresse' …)

### 1.3 Constellation

- **Dépend de** : Logiciels passerelles tiers qui traduisent la radio en MQTT et se connectent au relais Mercure d'Odin : Zigbee2MQTT, Z-Wave JS UI, Matter Server (python-matter-server), OpenMQTTGateway
- **Obligatoire ?** pour une fonction
- **Sert à** : Appareils Zigbee, Z-Wave et Matter (modes Mélissa, Néréide, Atome, Ondine) et le bouton « Appairer (60 s) »
- **Proposition** : Pilotes de clés coordinateur USB écrits dans Odin, sous les noms déjà en place dans PART_NAMES : « Mélissa » (Zigbee EZSP/ZNP), « Néréide » (Z-Wave Serial API), « Atome » (Matter). Même chantier qu'Eunomia. Le relais MQTT, lui, est déjà maison.
- **Effort** : enorme
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/modules/appareils.ts:2 « les passerelles Zigbee (Mélissa), Z-Wave (Néréide), Matter (Atome) … s'y annoncent » ; :125 « broker.publish('zigbee2mqtt/bridge/request/permit_join', … »

### 1.4 Alexandrie, Argo, Hydre, Arche, et toutes les applis

- **Dépend de** : Serveur PostgreSQL 18 « odin-pg » : logiciel serveur tiers, mais créé, lancé, gardé et sauvegardé par Odin lui-même (image postgres:18 dans le moteur maison Hringhorni, sans Docker ; ou binaires initdb/pg_ctl lancés par Odin sur 127.0.0.1). L'image est tirée de Docker Hub à la première création. Il existe aussi un mode « PostgreSQL déjà présent sur la machine » (5432) que Odin ne lance pas.
- **Obligatoire ?** oui pour Alexandrie et Arche ; pour une fonction dans Argo et Hydre (applis installées qui demandent une base) ; le mode « PostgreSQL de la machine » est facultatif
- **Sert à** : LA base de données d'Odin : bases NOMAPPLI_ODIN, Studio, SQL, schéma, journal des requêtes, bases des applis installées, sauvegardes
- **Proposition** : À trancher par le propriétaire. Recommandation : le garder comme brique fournie par Odin (rien à installer à côté), mais livrer PostgreSQL avec l'installation d'Odin (binaire ou image embarquée) pour ne plus rien tirer d'un registre, et retirer le mode « PostgreSQL de la machine » (ou le limiter à une migration). Recoder un serveur compatible PostgreSQL n'est pas réaliste (« Mnémosyne », proposé par un auditeur, est déjà le nom de la mémoire d'Odin, src/muninn/store.ts:1). Remarque : deux chemins coexistent (valhalla/base/serveur.ts et urdr/serveur.ts), à unifier.
- **Effort** : petit pour livrer le binaire et retirer le mode machine ; enorme pour recoder
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/urdr/serveur.ts:1 « un seul serveur PostgreSQL (« odin-pg ») » et :36 « image: `postgres:${PG_VERSION}` » ; src/valhalla/base/serveur.ts:3 « un PostgreSQL déjà présent sur la machine, qui tourne » et :6 « Odin crée SON serveur (127.0.0.1 seulement » ; src/valhalla/modules/naglfar.ts:86 needsDb(image)

### 1.5 Agenda

- **Dépend de** : Serveur CalDAV (Nextcloud auto-hébergé, ou iCloud/Fastmail qui sont des services en ligne) et adresse ICS
- **Obligatoire ?** oui pour l'agenda
- **Sert à** : Lire et ajouter des rendez-vous ; agenda du briefing
- **Proposition** : Agenda natif « Héméra » (nom libre) dans Alexandrie (base HEMERA_ODIN), qui sert lui-même ICS/CalDAV aux téléphones ; les agendas extérieurs deviennent des abonnements facultatifs.
- **Effort** : moyen
- **Déjà prévu** : non
- **Où dans le code** : src/tools/calendar.ts:2 « CalDAV : Nextcloud, iCloud, Fastmail… » ; :101 « const cal = ctx.calendar?.caldavUrl ?? '' … CALDAV_PASSWORD »

### 1.6 Installer des applis libres

- **Dépend de** : Docker / Docker Compose (installés par Odin via apt) et les serveurs tiers qu'il lance en conteneurs
- **Obligatoire ?** oui pour cet outil
- **Sert à** : Installer un équivalent libre auto-hébergé (docker run --restart unless-stopped, docker compose up -d)
- **Proposition** : Contradiction directe avec la règle : désactiver le lancement et transformer l'outil en « analyser l'appli libre et préparer son plan de recodage dans Odin » ; si un lancement reste permis, le faire par Argo/Hringhorni, jamais par Docker.
- **Effort** : petit
- **Déjà prévu** : non
- **Où dans le code** : src/tools/apps.ts:85 « apt-get install -y -qq docker.io docker-compose-v2 » ; :107 « docker(['run', '-d', '--restart', 'unless-stopped' » ; :111 « docker(['compose', 'up', '-d']) »

### 1.7 Canal Signal d'Iris

- **Dépend de** : signal-cli-rest-api (conteneur Docker bbernhard/signal-cli-rest-api) à adresse réglable
- **Obligatoire ?** oui pour le canal Signal
- **Sert à** : Parler à Odin par Signal
- **Proposition** : Bloc « Angélia » (nom libre ; « Hermès » et « Iris » sont pris) : Odin lance et pilote signal-cli directement (json-rpc sur stdin/stdout), sans pont REST ni Docker. signal-cli reste un outil local Java.
- **Effort** : gros
- **Déjà prévu** : non
- **Où dans le code** : src/bifrost/channels/signal.ts:1 « via signal-cli-rest-api (conteneur Docker bbernhard/signal-cli-rest-api » ; :19 « signal-cli-rest-api injoignable » ; src/web/ui.html:1527 « docker run -d --name signal-api … »

### 1.8 Écho

- **Dépend de** : Serveur LibreTranslate (Argos Translate) à faire tourner à côté, adresse réglable, par défaut http://127.0.0.1:5000 ; Odin ne le lance pas
- **Obligatoire ?** pour une fonction (seule voie de traduction quand « tout sur la machine » est coché avec un modèle en ligne)
- **Sert à** : Traduction hors ligne de la conversation (fr, en, ja)
- **Proposition** : Traducteur embarqué « Glossa » (nom libre) : modèles OPUS-MT/Argos en ONNX, téléchargés et exécutés par Odin lui-même, sans serveur ; même moteur d'exécution que « Métis ». Retirer le réglage « serveur » et l'aide pip.
- **Effort** : gros
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/rodd/conversation.ts:43 « SERVEUR_PAR_DEFAUT = 'http://127.0.0.1:5000' » ; src/valhalla/rodd/conversation-moteur.ts:111 « lance un serveur de traduction LibreTranslate sur la machine (pip install libretranslate… » ; src/web/pages/rodd-conversation.js:495 « pip install libretranslate »

### 1.9 Pythie, Gygès, recherche web du cœur

- **Dépend de** : SearXNG : conteneur Docker docker.io/searxng/searxng lancé par Odin (odin-searxng), ou instance reliée par adresse (settings.searxng, search.searxngUrl). Gygès en dépend par Pythie.
- **Obligatoire ?** facultatif (les autres moteurs prennent le relais)
- **Sert à** : Recherche multi-moteurs
- **Proposition** : DÉJÀ PRÉVU (recodage en cours) : méta-moteur natif dans src/valhalla/volva/. Pour que la dépendance ne survive pas dans le cœur, le même lot doit brancher src/tools/search.ts (et research.ts, video.ts) sur ce méta-moteur et retirer installer_searxng, arreter_searxng, le réglage searxng, search.searxngUrl de config.ts et le champ « Adresse SearXNG » de ui.html:1563.
- **Effort** : gros (cœur : petit en plus)
- **Déjà prévu** : oui
- **Où dans le code** : src/valhalla/modules/volva.ts:200 « ctx.run('docker', ['run', '-d', '--name', 'odin-searxng' … » ; src/tools/search.ts:86 « if (o.searxngUrl) return 'searxng'; » ; src/config.ts:95 searxngUrl ; src/valhalla/modules/hlin.ts:121 ctx.call('volva', 'brut', …)

### 1.10 Cerveau local et recherche par le sens dans la mémoire

- **Dépend de** : Ollama (127.0.0.1:11434) ou serveur compatible OpenAI réglé par adresse (LM Studio, vLLM) ; Ollama /api/embeddings (nomic-embed-text) pour la mémoire
- **Obligatoire ?** facultatif
- **Sert à** : IA locale gratuite (palier « local », secours) ; retrouver un souvenir par le sens
- **Proposition** : Moteur d'inférence embarqué « Métis » (nom libre ; « Mimir » est déjà pris par le conseiller et par la recherche) : llama.cpp compilé et lancé par Odin comme whisper.cpp, modèles GGUF, plus un petit modèle d'embeddings ; plus aucune adresse de serveur tiers. Les fournisseurs en ligne restent des services en ligne.
- **Effort** : gros
- **Déjà prévu** : non
- **Où dans le code** : src/providers/router.ts:341-342 « tier: 'local', fallbackOnly: true … `ollama:${pick}` » ; src/muninn/embed.ts:12-14 « cfg.memory?.embedUrl … /:11434/ »
- **Recodé le 2026-11-16** : « Métis » (moteur d'inférence GGUF écrit dans Odin, src/brain/metis/) remplace le serveur local réglé par adresse. La bascule est branchée au démarrage (migrerMetis dans src/runtime.ts : retire TOUT fournisseur local — Ollama :11434, LM Studio :1234, llama.cpp :8080 — neutralise memory.embedUrl en :11434, persiste et prévient le propriétaire une fois) ; la page est servie par /api/metis/page (propriétaire seul) ; le fichier GGUF est borné (hyper-paramètres démesurés refusés) et un modèle à géométrie trop grande pour la machine est refusé poliment AVANT toute allocation ; l'étiquette des plongements suit la version de Noûs (recalcul auto). **Reste (codé, pas encore essayé sur un vrai modèle)** : exécution dans un worker_threads (aujourd'hui le fil principal est gelé pendant une génération), noyau WASM tuilé pour les gros matmul (sinon repli JS scalaire) et mesure sur le vrai chemin, réutilisation de l'état chaud entre messages (poids retransposés à chaque message), échantillonnage top-p sans tri complet du vocabulaire.

### 1.11 Plume

- **Dépend de** : LanguageTool (serveur Java tiers, image erikvl87/languagetool, lancée par Argo sans Docker, ou instance reliée par adresse)
- **Obligatoire ?** facultatif
- **Sert à** : Correcteur complet (grammaire, langues autres que le français)
- **Proposition** : Retirer « Installer » et « Relier un correcteur LanguageTool » ; bloc « Grammatiké » (nom libre) : enrichir le correcteur maison (correcteur.ts, orthographe.ts, partout.ts) avec plus de règles de grammaire et des dictionnaires Hunspell embarqués pour en, de, es.
- **Effort** : gros
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/snotra/actions.ts:111 « ctx.call('naglfar', 'lancer', { image: LT_IMAGE, … » ; :113 « saveSettings({ languagetool: `http://127.0.0.1:${LT_PORT}` » ; :116 relier_correcteur

### 1.12 Pyramide

- **Dépend de** : Serveur Samba du système (smbd, testparm, smbcontrol) ; Odin écrit smb.conf et recharge, mais n'installe ni ne lance Samba
- **Obligatoire ?** pour une fonction
- **Sert à** : Ajouter ou retirer un dossier partagé sur le réseau
- **Proposition** : À trancher : garder Samba comme paquet système installé par Odin (les PC Windows ne savent lire que SMB), ou ajouter un serveur de fichiers WebDAV écrit dans Odin, « Pithos » (nom libre), en complément.
- **Effort** : petit (faire installer Samba) ; enorme (recoder SMB)
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/modules/fensalir.ts:130 « Samba n'est pas installé sur cette machine (paquet « samba ») » ; :135 « ctx.run('smbcontrol', ['all', 'reload-config'] »

### 1.13 Écho, Orphée, voix d'Odin

- **Dépend de** : Serveurs de voix tiers à adresse réglable : serveur HTTP Piper lancé à part, serveur Whisper compatible OpenAI (speaches, faster-whisper-server, Docker conseillé dans l'interface), serveur TTS (Kokoro, openedai-speech)
- **Obligatoire ?** facultatif (Piper et whisper.cpp installés par Odin prennent le relais)
- **Sert à** : Comprendre et parler via un serveur séparé
- **Proposition** : Retirer l'option d'adresse de serveur local et les aides speaches/Docker/piper.http_server ; garder seulement « local » (whisper.cpp + Piper lancés par Odin) et les services en ligne. Pas de nouveau bloc.
- **Effort** : petit
- **Déjà prévu** : non
- **Où dans le code** : src/voice/voice.ts:88 « une adresse http://… vise un serveur Piper lancé à part » ; :195 fetch `${v.stt.baseUrl…}/audio/transcriptions` ; src/web/ui.html:1705 « docker run -p 8000:8000 ghcr.io/speaches-ai/speaches » ; :1671 « python3 -m piper.http_server »

### 1.14 Plume

- **Dépend de** : Penpot (serveur de maquettes auto-hébergé, adresse réglable) : simple lien et essai de réponse, aucune API appelée
- **Obligatoire ?** facultatif
- **Sert à** : Section « Maquettes (Penpot) »
- **Proposition** : Retirer le lien Penpot ; faire grandir l'éditeur de dessins maison (snotra/dessin.ts) vers des maquettes d'écrans, dans Plume. « Dédale », proposé par l'auditeur, est déjà pris (ivaldi).
- **Effort** : petit pour retirer ; enorme pour un vrai outil de maquettes
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/snotra/actions.ts:161 « relier_penpot … https://penpot.exemple.fr » ; :184 « title: 'Maquettes (Penpot)' »

### 1.15 Zeus

- **Dépend de** : Serveur STRATA (modèle NVIDIA Earth-2) monté par le propriétaire, adresse réglable
- **Obligatoire ?** facultatif
- **Sert à** : Ligne STRATA de la comparaison météo J+1 à J+3
- **Proposition** : Retirer la source STRATA (gros modèle sur carte NVIDIA : pas recodable raisonnablement) ; ne la remettre que si Odin la fait tourner lui-même un jour.
- **Effort** : petit
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/zeus/strata.ts:3 « Odin n'appelle qu'un serveur que le propriétaire a monté lui-même » ; src/valhalla/modules/zeus.ts:295 « http://192.168.1.50:8000 »

### 1.16 Interprète

- **Dépend de** : Serveurs MCP tiers branchés par le propriétaire (adresse HTTP, ou programme local lancé en stdio)
- **Obligatoire ?** facultatif (aucun configuré par défaut)
- **Sert à** : Ajouter à Odin les outils d'un serveur MCP
- **Proposition** : Rien à recoder : brancher un logiciel tiers est le but même de la passerelle. À confirmer par le propriétaire (exception assumée à la règle).
- **Effort** : petit
- **Déjà prévu** : non
- **Où dans le code** : src/valhalla/modules/ratatoskr.ts:67 « { name, kind: 'http', url: src ... } : { name, kind: 'stdio', command » ; src/valhalla/mcp.ts:56 spawn(this.conf.command

## 2. Ordre de recodage conseillé

1. Finir Pythie (en cours) : méta-moteur natif dans src/valhalla/volva/, et dans le même lot brancher src/tools/search.ts, research.ts et video.ts dessus, puis retirer searxngUrl (config.ts, ui.html:1563) et installer_searxng/arreter_searxng. Gygès est réglé du même coup. Pas de nouveau nom (c'est Pythie).
2. Lot de nettoyage rapide (petits efforts, sans nouveau bloc) : retirer les adresses de serveurs voix tiers et les aides speaches/Docker/piper.http_server ; retirer le mode « PostgreSQL de la machine » ; retirer STRATA de Zeus ; retirer le lien Penpot ; passer les bacs à sable du shell et des scripts sur Hringhorni ; désactiver le lancement Docker de github_app.
3. Vénus native (déjà prévu) : le serveur entre dans le module venus (base VENUS_ODIN), Delta interroge les indexeurs lui-même, options qBittorrent/Transmission/SABnzbd retirées, sonde Pulsar interne.
4. « Métis » (inférence embarquée) : llama.cpp compilé et lancé par Odin, modèles GGUF, embeddings de la mémoire ; remplace Ollama/LM Studio.
5. « Glossa » (traduction hors ligne sur le moteur de Métis ou onnxruntime) : remplace LibreTranslate dans Écho.
6. « Angélia » (Signal) : signal-cli piloté directement, sans pont REST ni Docker.
7. « Héméra » (agenda natif dans Alexandrie, servant ICS/CalDAV) : remplace le Nextcloud/CalDAV extérieur.
8. « Grammatiké » (correcteur maison élargi) : remplace LanguageTool dans Plume.
9. « Stentor » rendu natif (diffusion Cast/DLNA/AirPlay/Sonos du son Piper) pour Orphée et Apollon : premier pas pour sortir de Home Assistant.
10. « Eunomia » (moteur domotique natif sous Midgard) avec les pilotes radio « Mélissa » (Zigbee), « Néréide » (Z-Wave), « Atome » (Matter) dans Constellation : remplace Home Assistant et les passerelles Zigbee2MQTT/Z-Wave JS UI/Matter Server. Le plus gros chantier.
11. PostgreSQL odin-pg et Samba : selon la décision du propriétaire (livrer les binaires avec Odin ; « Pithos » WebDAV en complément de Samba si voulu).
12. Ensuite, facultatif, outils locaux : « Ichnée » (lecture de /proc et /sys à la place de ss, ip, lsblk, findmnt, dpkg-query), « Égide » (pare-feu par nft seul pour Cerbère et Thermopyles), « Dictys » (capture réseau native pour Ariane), « Apelle » (SVG → PNG pour Plume et Alexandrie). Tous ces noms sont libres dans src (vérifié) ; « Dédale », « Écho », « Arachné », « Hestia », « Oïkos », « Mnémosyne », « Héphaïstos », « Hermès », « Iris » et « Mimir », proposés par certains auditeurs, sont déjà pris.

## 3. Décision du propriétaire (16/11/2026)

« Tu me recodes tout ce qui n'a pas été codé. Je ne dois dépendre d'aucune dépendance, à part les liens de mise à jour, les liens de téléchargement et autres. Toutes les applis, tout doit être codé : les gros, les petits, les moyens, tout. Aucune dépendance externe. »

Familles citées : moteur de recherche, serveur Venus séparé, serveur domotique, passerelles Zigbee, Z-Wave et Matter, serveur de modèles local, cerveau local, mémoire par le sens, serveur de traduction, canal Signal, Docker, serveur de correction, serveur d'agenda, installation d'applis libres, serveurs de voix, serveur de maquettes, serveurs d'outils, partage de fichiers du système, serveur de prévision météo. Demande ajoutée : la prise de rendez-vous (voir Héméra).

Restent permis : les liens de mise à jour et de téléchargement (fichiers de données, dictionnaires, modèles, images, listes) et les services d'Internet qui sont des sources par nature.

### File des recodages (une équipe par chantier, deux équipes au plus à la fois)

| # | Chantier | Nom dans Odin | Remplace | État |
|---|---|---|---|---|
| 1 | Moteur de recherche natif | Lyncée (dans Pythie) | le méta-moteur en conteneur | en cours de code |
| 2 | Réseau de neurones du Cerveau | Noûs | — (nouveau ; fournira les plongements de la mémoire) | en cours d'étude |
| 3 | Vénus native | Vénus | le serveur Venus séparé | prêt à lancer |
| 4 | Petits retraits | — | Docker, serveurs de voix à part, lien de maquettes, mode « base de la machine », serveurs d'outils tiers | prêt à lancer |
| 5 | Agenda natif et prise de rendez-vous | Héméra | le serveur d'agenda extérieur | prêt à lancer |
| 6 | Modèles de langue ouverts dans Odin | Métis | le serveur de modèles local | après Noûs |
| 7 | Domotique native | Eunomia | le serveur domotique | prêt à lancer |
| 8 | Son sur les enceintes | Stentor | le passage par le serveur domotique | après Eunomia |
| 9 | Traduction hors ligne | Glossa | le serveur de traduction | après Métis |
| 10 | Correcteur natif | Grammatiké | le serveur de correction | prêt à lancer |
| 11 | Partages de fichiers natifs | Pithos | le démon de partage du système | prêt à lancer |
| 12 | Zigbee natif | Mélissa | la passerelle logicielle | après Eunomia |
| 13 | Z-Wave natif | Néréide | la passerelle logicielle | après Mélissa |
| 14 | Matter natif | Atome | le serveur à côté | après Eunomia |
| 15 | Canal Signal natif | Angélia | le pont en conteneur | prêt à lancer |
| 16 | Prévisions à 1, 2 et 3 mois calculées par Odin | (dans Zeus) | le serveur de prévision à monter | prêt à lancer |

### Ce qui reste à trancher

- Le serveur de base de données (odin-pg) : non cité par le propriétaire. Odin le crée, le lance et le sauvegarde lui-même ; le mode « base déjà présente sur la machine » est retiré au chantier 4. Écrire un moteur de base de données dans Odin n'est pas conseillé (toutes les données de la maison en dépendent).
- Les outils locaux lancés par Odin (section 4) : non cités ; gardés pour l'instant.

## 4. Outils locaux lancés par Odin (pas des instances)

- Docker (hors SearXNG) : bac à sable du shell (src/tools/builtin.ts:122, facultatif, kind = docker) et bac à sable des scripts (src/tools/scripts.ts:191-194, where = 'sandbox'), et l'installation de Pythie (volva.ts:196). Contraire à la règle « zéro Docker » (base/serveur.ts:9). Recodable : oui, petit — passer ces bacs à sable sur Hringhorni.
- OpenSSH (ssh, scp, ssh-keygen) : Hydre, Arche, Asclépios, Dédale, Thermopyles/Ariane, Satellites, Phénix, Némésis, accès aux machines du cœur. Obligatoire pour Satellites, pour une fonction ailleurs. Non installé par Odin. Recodable : partiel, gros (client SSH dans Odin possible mais lourd) ; raisonnable de garder.
- smbclient, showmount (Samba/NFS clients) : Arche, Asclépios, Méduse, Phénix, Héraclès, cœur machines. Pour une fonction ou facultatif. install.sh le suggère seulement. Recodable : partiel, gros (client SMB maison plus tard).
- PowerShell / pwsh (WinRM) : Satellites, Genèse (Get-Disk), Phénix sur les PC Windows. Pour une fonction. Recodable : partiel (WinRM HTTP dans Odin).
- ss, ip (iproute2), lsblk, findmnt, df, dpkg-query, ping, cat /proc : Méduse (ss obligatoire), Thermopyles, Hydre, Argo, Némésis, Perséphone, Pyramide, Genèse, Pulsar, Zéphyr, Asclépios. Facultatifs ou pour une fonction. Recodable : oui, petit à moyen — lecture directe de /proc/net/tcp*, udp*, route, arp, /sys/block, /proc/self/mountinfo, statfs, /var/lib/dpkg/status dans un petit module commun (nom libre proposé : « Ichnée », la pisteuse).
- Pare-feu : nft, iptables, ufw, firewall-cmd, journalctl : Cerbère, Thermopyles, Forseti, Vortex, Argo (réseau des conteneurs). Pour une fonction. Recodable : partiel, moyen — piloter seulement nft (table « inet odin ») et supprimer ufw/firewalld ; bloc commun « Égide » (nom libre). nft reste : c'est le noyau qui filtre.
- Outils noyau des conteneurs et VM : unshare, nsenter, setpriv, env (Argo, obligatoire) ; qemu-system-x86_64, qemu-img, OVMF, swtpm, lxc-* , e2fsck (Hydre, obligatoire) ; qemu-nbd/guestmount (Genèse, prévu, pas branché). Non installés par Odin. Recodable : non (hyperviseur et outils du noyau) ; à faire installer par Odin.
- tcpdump + sudo : Ariane, obligatoire. Recodable : oui, moyen — capture AF_PACKET par un petit assistant natif d'Odin doté de cap_net_raw (plus besoin de sudo en local). « Arachné », proposé par l'auditeur, est déjà pris (idunn) : nom libre proposé « Dictys » (le pêcheur au filet). tcpdump gardé sur les postes distants.
- ffmpeg / ffprobe / ffplay / mpv : Cyclope (obligatoire), Alchimie, Apollon, Orphée, voix locale, analyse vidéo. Non installé par Odin (install.sh le suggère). Recodable : partiel — tags audio et réception RTSP/MP4 sans réencodage en TypeScript possibles ; codecs non raisonnables. Fonction neuve codée le 17/11/2026 (relue et corrigée le même jour) : **Syrinx**, l'oreille d'Odin (src/valhalla/syrinx/, src/audio/) — le WAV est lu par Odin seul, l'analyse (volume, zones, tempo, tonalité, parties, empreinte, modèle de sons ouvert calculé dans Odin) n'appelle aucun serveur ; la parole passe seulement par la transcription locale déjà installée (jamais un service en ligne). Reste : décodeurs natifs FLAC/MP3/Ogg/MP4 (ces formats passent encore par l'outil média local), vrais poids du modèle de sons (téléchargement à autoriser), passe du modèle à déporter en worker_threads (elle rend la main entre ses blocs : retard de boucle mesuré ≤ 83 ms).
- Chaîne documents : tesseract, poppler-utils (pdftotext, pdftoppm), qpdf, ocrmypdf, Ghostscript, LibreOffice (soffice), pandoc, ImageMagick, Calibre : Champollion (tesseract obligatoire), Alchimie, lecture de fichiers du cœur. Non installés par Odin. Recodable : partiel, gros à enorme (pdf.js, tesseract.js/ONNX possibles ; LibreOffice non). Recodé le 16/11/2026 par **Théia** (l'œil d'Odin, src/valhalla/theia/, src/vision/) : lecture native d'OpenDocument (.odt/.ods/.odp), RTF, HTML et extraction des images de page d'un PDF scanné — sans soffice ni pdftotext ; Champollion repasse sur ces lecteurs natifs. L'OCR (lire un scan) et la vision (décrire une image) sont calculés par le moteur d'Odin à partir de modèles ouverts. Reste honnêtement : (a) les poids ouverts doivent être **pré-convertis au schéma maison** (convertisseur noms de tenseurs/config/vocabulaire encore à livrer) — tant qu'aucun vrai poids n'a tourné, l'interface dit « codé, pas encore essayé sur du vrai modèle » ; (b) la passe de vision est **synchrone sur le fil principal** (mesurée ~7-8 s/image sur petit CPU) — à déporter en worker_threads ; (c) vieux binaires .doc/.xls/.ppt et PDF très abîmés restent « lus en partie » (repli LibreOffice gardé où il existe).
- rsvg-convert / ImageMagick pour l'export PNG : Plume et Alexandrie, pour une fonction. Recodable : oui, moyen — petit traceur SVG → PNG maison (formes simples, encodeur PNG déjà dans ymir/local.ts), nom libre « Apelle ».
- Voix locale : whisper.cpp (compilé par Odin avec git, cmake, g++, curl), Piper et ses voix (téléchargés par Odin), Python + numpy + onnxruntime pour Orphée temps réel : Écho, Orphée. Installés par Odin (sauf paquets pip). Recodable : non ; conforme à la règle (outils lancés par Odin, aucun serveur à côté).
- python3 comme relais : terminal de Dédale (relais pty), tun.py de Vortex, agent et capsules sur les postes (Phénix, Écho via Satellites). Recodable : oui, moyen — relais pty et ouverture de /dev/net/tun natifs ; sur les postes, capsule en exécutable autonome.
- git : Dédale (obligatoire), mises à jour d'Odin. Non installé par Odin pour Dédale. Recodable : partiel, gros (lire .git oui, cloner/pousser lourd) ; garder.
- smartctl, nvidia-smi, who, ps, kill : Tirésias (installé par Odin sous Linux), Hygie, Pyramide, Némésis. Facultatifs ou pour une fonction. Recodable : non pour smartctl ; garder.
- Outils et gestionnaires du système (apt, dnf, pacman, brew, winget, systemctl, journalctl, du, reg, sudo) : Héraclès, Chroniques, Forseti, mises à jour de la machine. Recodable : non ; ce sont les outils du système qu'on pilote.
- Outils sur les postes sauvegardés : dd, partclone, blockdev, hdiutil/asr, VSS : Phénix. Recodable : non ; garder.
- cloudflared (téléchargé et lancé par Odin) et tailscale : Bifröst (obligatoire), et par lui Valgrind, Persona, Nébuleuse ; accès extérieur du cœur. Recodable : non (protocole Cloudflare non public) ; alternative 100 % Odin : Vortex (WireGuard maison) ou ouverture de port UPnP.
- Chrome/Chromium/Edge (ou Chromium de Playwright) : navigateur d'Odin, obligatoire pour browser_*. Non installé par Odin. Recodable : non ; faire installer Chromium par Odin.
- yt-dlp (téléchargé par Odin) : analyse vidéo. Recodable : non ; garder.
- signal-cli : outil Java à lancer directement si le pont REST disparaît (bloc Angélia).
- RetroArch : Olympie, pour « Lancer » seulement. Recodable : non ; garder facultatif.
- Binaire Ventoy (Ventoy2Disk.sh) : Genèse, prévu mais pas encore branché. Recodable : partiel, enorme (chargeur multi-ISO natif, nom libre « Gaïa »).
- Greffons Nagios (monitoring-plugins) : Pulsar, sondes « commande ». Recodable : partiel, moyen (contrôles courants en natif, SNMP déjà natif).
- Commandes libres du propriétaire (sh -c, cmd /c) : Phénix (avant/après sauvegarde), Vortex (allumage/arrêt). Facultatif ; rien à faire.
- osquery sur les postes (Argos, seulement s'il est déjà là) ; CLI codex (codex_run, obligatoire pour cet outil, appelle OpenAI) ; python3/bash/node pour les scripts du cœur. Garder (codex : garder en option ou retirer).
- Applis tierces hors de la machine d'Odin, rangées ici faute de mieux : OwnTracks sur les téléphones (Hestia, Ulysse : obligatoire pour les positions ; recodable, moyen, en ajoutant l'envoi de position dans l'appli téléphone d'Odin) ; chaîne ESPHome (Héphaïstos : le propriétaire compile et flashe lui-même, Odin ne la lance jamais).

## 5. Services d'Internet (des sources, pas des instances)

- Météo Open-Meteo (Zeus) : obligatoire pour les prévisions ; sans lui, seul le journal gardé reste lisible. Nominatim : facultatif (coordonnées brutes, ou table des communes embarquée possible).
- Moteurs de recherche (DuckDuckGo, Bing, Mojeek sans clé ; Brave, Tavily, Exa, Google avec clé ; Wikipédia) : Pythie et recherche du cœur ; utilisables tant qu'au moins un répond.
- Listes de menaces (abuse.ch, OpenPhish, CISA KEV, ClamAV daily.cvd, CIRCL, VirusTotal, FireHOL, Feodo, DB-IP) : Asclépios, Méduse ; facultatif, les règles de base et le dernier paquet gardé restent.
- Listes de blocage DNS (adguardteam, firebog) pour Sphinx (vidarr) : facultatif.
- Fournisseurs de modèles d'IA et de voix (OpenAI, ElevenLabs, etc.) : facultatifs, Odin garde la voix locale et le mode sans IA. Juge Jev de TypeSafe (Mímir) : facultatif, le juge local répond.
- Registres et dépôts d'images (Docker Hub, GHCR, Quay, images.linuxcontainers.org) : Argo, Hydre, et la première création d'odin-pg ; une fois l'image présente, tout tourne hors ligne. Disparaît pour odin-pg si PostgreSQL est livré avec Odin.
- GitHub (Releases, API) : téléchargement de cloudflared, Piper, whisper.cpp, Ventoy, installateurs de Pégase ; API GitHub/Vercel/Cloudflare pour Arachné (idunn), qui garde la surveillance des sites sans elles.
- Réseaux Cloudflare et Tailscale : publication sur Internet (Bifröst, Valgrind, Persona, Nébuleuse) ; sans eux, réseau de la maison seulement ou Vortex.
- Services push des navigateurs (FCM, Mozilla, Apple) : notifications appli fermée, facultatif.
- Telegram et messageries en ligne d'Iris ; Google/iCloud/Fastmail pour l'agenda (si pas de serveur maison) : facultatifs, sauf pour leur canal.
- Let's Encrypt (certificats de Valgrind) : facultatif, l'autorité de certificats maison existe.

## 6. Matériel et équipements du propriétaire

- Proxmox VE du propriétaire (Hydre, API :8006, PROXMOX_TOKEN ; commande pct pour les scripts et l'import de compétences) : facultatif, Hydre garde les machines locales.
- Ordinateurs du parc (Satellites : AUCUNE fonction sans eux ; Argos : rien que le résumé sans compagnon installé ; Phénix, Dédale, Ariane, Némésis pour le distant).
- Bases de données existantes du propriétaire (PostgreSQL, MySQL/MariaDB, MongoDB) reliées par hôte et port : Alexandrie (« Relier une base ») et Arche ; facultatif, odin-pg reste.
- Box Internet, caméras (Cyclope), modules Tasmota/ESP, NAS, enceintes, télé : pilotés en plus, pas des dépendances. Cyclope n'a aucune fonction sans caméra.
