# Banc d'essai virtuel d'Odin

Le banc essaie les applis d'Odin contre de **vrais services** lancés pour l'occasion. Quand le vrai
service est impossible sur une machine de test (un serveur Proxmox, une prise Tasmota, les serveurs
de Telegram), un **simulateur** rejoue son protocole. Rien n'est caché : un scénario dont l'outil
manque est marqué « ignoré », avec la raison.

```bash
npm run banc                 # tout
npm run banc -- docker vpn   # seulement ces scénarios
npm run banc -- --liste      # la liste
npm run banc:outils          # télécharge MediaMTX et les serveurs MCP officiels (une fois)
```

Le rapport détaillé est écrit dans `test/banc/rapport.json`. Les trois scénarios simulés tournent
aussi dans `npm test` (fichier `test/banc-sim.test.ts`).

## Les scénarios

| Scénario | Appli d'Odin | Contre quoi | Mode |
|---|---|---|---|
| `docker` | Argo | un vrai Docker (conteneur lancé, arrêté, relancé, journaux) | réel |
| `parefeu` | Cerbère | le vrai pare-feu nftables, un attaquant dans un réseau isolé | réel |
| `antivirus` | Asclépios | les vraies sources de signatures (OpenPhish, Stalkerware Indicators, signature-base, CISA KEV), de vraies archives (`zip`, `tar`, `gzip`), les programmes de la machine, le fichier de test EICAR | réel |
| `pieges` | Sirènes → Asclépios → Cerbère | un attaquant avec de vrais clients (ssh, curl), virus d'essai EICAR | réel |
| `vpn` | Vortex | un vrai tunnel WireGuard (téléphone et NAS dans des réseaux isolés) | réel |
| `cameras` | Cyclope | un vrai flux RTSP avec mot de passe (MediaMTX + ffmpeg) | réel |
| `venus` | Vénus | le vrai serveur Venus (dépôt TOUFATECH/Venus) | réel |
| `homeassistant` | Midgard, Orphée, Apollon | un vrai Home Assistant (intégration de démonstration) | réel |
| `relais` | Appareils | de vrais clients MQTT (Mosquitto) sur le relais d'Odin | réel |
| `github` | Pharos | GitHub en ligne (flux publics des versions) | réel |
| `mcp` | Interprète | les serveurs MCP officiels (programme local et HTTP) | réel |
| `mcp-serveur` | Interprète | le client officiel du SDK MCP sur le `/mcp` d'un vrai Odin | réel |
| `proxmox` | Hydre | un simulateur de l'API Proxmox VE (HTTPS, jeton) | simulé |
| `tasmota` | Héphaïstos, Appareils | un simulateur de module Tasmota (HTTP + MQTT) | simulé |
| `telegram` | passerelle d'Odin | un simulateur de l'API Bot de Telegram | simulé |
| `telegram-reel` | passerelle d'Odin | les vrais serveurs de Telegram | réel (avec ton jeton) |

## Ce qu'il faut sur la machine

- Tout : Node 22+.
- `docker`, `parefeu`, `pieges`, `vpn` : droits administrateur (root), `docker`, `nft`, `ip`,
  `wg`, `wg-quick` (et `wireguard-go` si le noyau n'a pas WireGuard).
- `antivirus` : `zip`, `tar`, et un accès à GitHub (sources de signatures). Avec `ABUSE_CH_KEY` (clé gratuite
  d'abuse.ch), MalwareBazaar, ThreatFox et URLhaus sont essayés aussi. Aucun malware n'est téléchargé.
- `cameras` : `ffmpeg`, et MediaMTX (`npm run banc:outils`, ou `BANC_MEDIAMTX=/chemin/mediamtx`).
- `venus` : `BANC_VENUS_DIR=/chemin/du/depot/Venus` (après `npm install` dans ce dépôt).
- `homeassistant` : `BANC_HASS="/chemin/venv/bin/python -m homeassistant"` (paquet `homeassistant`
  installé dans un environnement Python).
- `relais` : `mosquitto_pub` et `mosquitto_sub` (paquet `mosquitto-clients`).
- `mcp`, `mcp-serveur` : `npm run banc:outils`.
- `telegram-reel` : `TELEGRAM_BOT_TOKEN` (le jeton de ton bot) et `BANC_TELEGRAM_CHAT` (ton
  identifiant de discussion). Sans eux, le scénario est ignoré. Le jeton n'est jamais affiché.

## Limites connues

- Proxmox, Tasmota et Telegram sont simulés : le protocole est rejoué fidèlement, mais ce n'est pas
  le vrai matériel ni le vrai service.
- Le mode « tout le trafic par le VPN » est vérifié sur la configuration générée, pas en navigation.
- Les volets Tasmota à deux relais et Zigbee2MQTT sans annonce Home Assistant ne sont pas couverts.

## Qualité de l'interface (débordements, placement, fluidité)

Un détecteur passe sur l'interface dans un vrai navigateur (Chromium, Playwright) et rend la liste des défauts,
chacun avec sa page, sa largeur, son sélecteur, sa mesure et une capture recadrée.

```bash
node test/banc/qualite.ts --liste                                  # les pages connues
node test/banc/qualite.ts --page appli:ullr --largeur 390          # UNE page, une largeur
node test/banc/qualite.ts --tout --sortie /tmp/qualite             # tout, avec rapport.md, rapport.json et captures
node test/banc/qualite.ts --fluidite --sortie /tmp/qualite         # pages qui se redessinent, animations réduites
node test/banc/qualite.ts --odin /chemin/autre/copie --page aujourdhui   # l'interface d'une autre copie du projet
```

Ce qu'il cherche, à chaque largeur (1440, 1280, 1024, 768, 390, 360, 320) : la page qui défile de côté ; un élément
qui sort de l'écran ou de sa boîte ; un texte coupé, tronqué ou recouvert (par un autre élément, une notification,
la mascotte, la barre du bas) ; un texte posé sur le décor du thème ; des éléments cliquables qui se chevauchent ;
une rangée d'onglets sur plusieurs lignes ; un libellé de bouton sur 3 lignes ; une cible tactile de moins de 40 px
sur téléphone ; une image déformée ; un contraste insuffisant (calcul WCAG) ; un focus au clavier invisible.
Fluidité : temps d'ouverture, décalages de mise en page, tâches longues, page qui se redessine toute seule,
animations qui tournent malgré « réduire les animations ».

Dans un essai, on donne une page Playwright au détecteur :

```ts
import { detecter, capturer } from './banc/debordements.ts';
const defauts = await detecter(page);                    // les plus graves d'abord
await capturer(page, defauts[0], '/tmp/defaut.png');     // l'élément fautif entouré de rouge
```

Fichiers : `debordements.ts` (+ `debordements-page.js`, le code qui tourne dans la page), `fluidite.ts`
(+ `fluidite-page.js`), `odin-plein.ts` (un Odin de test rempli de données de démonstration), `qualite.ts` (le parcours).
Le détecteur s'essaie lui-même sur des pages à défauts voulus : `test/debordements.test.ts`.
