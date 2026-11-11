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
| `docker` | Naglfar | un vrai Docker (conteneur lancé, arrêté, relancé, journaux) | réel |
| `parefeu` | Garmr | le vrai pare-feu nftables, un attaquant dans un réseau isolé | réel |
| `pieges` | Loki → Ullr → Garmr | un attaquant avec de vrais clients (ssh, curl), virus d'essai EICAR | réel |
| `vpn` | Gjöll | un vrai tunnel WireGuard (téléphone et NAS dans des réseaux isolés) | réel |
| `cameras` | Himinbjörg | un vrai flux RTSP avec mot de passe (MediaMTX + ffmpeg) | réel |
| `venus` | Freyja | le vrai serveur Venus (dépôt TOUFATECH/Venus) | réel |
| `homeassistant` | Midgard, Bragi, Ægir | un vrai Home Assistant (intégration de démonstration) | réel |
| `relais` | Appareils | de vrais clients MQTT (Mosquitto) sur le relais d'Odin | réel |
| `github` | Kvasir | GitHub en ligne (flux publics des versions) | réel |
| `mcp` | Ratatoskr | les serveurs MCP officiels (programme local et HTTP) | réel |
| `mcp-serveur` | Ratatoskr | le client officiel du SDK MCP sur le `/mcp` d'un vrai Odin | réel |
| `proxmox` | Ymir | un simulateur de l'API Proxmox VE (HTTPS, jeton) | simulé |
| `tasmota` | Brokkr, Appareils | un simulateur de module Tasmota (HTTP + MQTT) | simulé |
| `telegram` | passerelle d'Odin | un simulateur de l'API Bot de Telegram | simulé |
| `telegram-reel` | passerelle d'Odin | les vrais serveurs de Telegram | réel (avec ton jeton) |

## Ce qu'il faut sur la machine

- Tout : Node 22+.
- `docker`, `parefeu`, `pieges`, `vpn` : droits administrateur (root), `docker`, `nft`, `ip`,
  `wg`, `wg-quick` (et `wireguard-go` si le noyau n'a pas WireGuard).
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
