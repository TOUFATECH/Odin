# Plan des ports d'Odin

Règle : **Odin écoute sur 8888**. Chaque appli a **son port**, en `8FNN` : `F` = la famille (1 à 5), `NN` = son numéro dans la famille (ordre alphabétique).
Par défaut, chaque port écoute au même endroit que l'interface d'Odin (cette machine, ou le réseau local si Odin y est ouvert) et demande toujours la connexion.
Les ports imposés par un protocole ou un outil restent les leurs (DNS 53, DHCP 67, MQTT 1883…). Tout port se change dans la page de l'appli (« Son port ») ou dans Réglages → Ports.

Validé le 15/11/2026 et en place depuis la v1.35.0 : le plan est dans `src/valhalla/ports.ts` (`DEFAULT_DIRECT`), le gardien dans `src/valhalla/directports.ts`.
- Un port par défaut n'est pas écrit sur le disque : il suit le plan. Un port changé ou retiré est gardé dans `~/.odin/valhalla/ports-directs.json`.
- Sans numéro, Odin propose le port par défaut de l'appli s'il est libre, sinon le premier libre de sa famille, puis 22000-22999.
- Le port d'une autre appli est refusé, sauf si elle l'a laissé (changé ou retiré).
- Une appli ajoutée plus tard prend le numéro libre suivant de sa famille : les numéros déjà donnés ne bougent jamais.
- Une installation qui avait réglé 7777 dans `config.json` le garde ; Pégase, Agora et les clients cherchent 8888, puis 7777 et 7443.

| Famille | Plage |
|---|---|
| Sécurité | 8101 à 8199 |
| Accès et réseau | 8201 à 8299 |
| Machines | 8301 à 8399 |
| Données et cœur | 8401 à 8499 |
| Maison et médias | 8501 à 8599 |

| Port | Usage |
|---|---|
| **8888** | Odin (interface, page de chaque appli) |
| 8889 | canal HTTP d'Odin pour les autres programmes (remplace 7778) |
| 1455 | retour de connexion du compte Codex (imposé par Codex) |

## Sécurité (81xx)

| Port | Appli | Ports imposés (gardés) |
|---|---|---|
| 8101 | Ariane | — |
| 8102 | Asclépios | — |
| 8103 | Cerbère | — |
| 8104 | Forseti | — |
| 8105 | Gygès | — |
| 8106 | Méduse | — |
| 8107 | Némésis | — |
| 8108 | Sirènes | 2323, 2222, 2200, 8081, 9201, 6380, 2525, 2121… (pièges : imitent de vrais services) |
| 8109 | Thermopyles | — |
| 8110 | Zéphyr | — |
| 8111 | Achille | 8890 (proxy d'essai, à la demande) |

## Accès et réseau (82xx)

| Port | Appli | Ports imposés (gardés) |
|---|---|---|
| 8201 | Agora | — |
| 8202 | Bifröst | — |
| 8203 | Interprète | — |
| 8204 | Pégase | — |
| 8205 | Persona | — |
| 8206 | Satellites | — |
| 8207 | Sphinx | 53 (DNS, UDP/TCP) · 853 (DNS chiffré) · 67 (DHCP) |
| 8208 | Thésauros | — |
| 8209 | Valgrind | 80 (HTTP) · 443 (HTTPS) |
| 8210 | Vortex | 51820 (WireGuard, UDP) |

## Machines (83xx)

| Port | Appli | Ports imposés (gardés) |
|---|---|---|
| 8301 | Arachné | — |
| 8302 | Argo | — |
| 8303 | Atlas | — |
| 8304 | Chroniques | — |
| 8305 | Genèse | 67 (proxyDHCP) · 69 (TFTP) · 4011 (PXE) · 16000 (images d'installation) |
| 8306 | Héraclès | — |
| 8307 | Hydre | — |
| 8308 | Hygie | — |
| 8309 | Phénix | — |
| 8310 | Pulsar | — |
| 8311 | Pyramide | — |
| 8312 | Tirésias | — |

## Données et cœur (84xx)

| Port | Appli | Ports imposés (gardés) |
|---|---|---|
| 8401 | Alchimie | — |
| 8402 | Alexandrie | 5432 (PostgreSQL, interne) |
| 8403 | Andromède | — |
| 8404 | Arche | — |
| 8405 | Champollion | — |
| 8406 | Chronos | — |
| 8407 | Dédale | — |
| 8408 | Écho | — |
| 8409 | Glyphes | — |
| 8410 | Hélios | — |
| 8411 | Hermès | — |
| 8412 | Nébuleuse | — |
| 8413 | Papyrus | — |
| 8414 | Perséphone | — |
| 8415 | Pharos | — |
| 8416 | Plume | — |
| 8417 | Pythie | — |
| 8418 | Talos | — |
| 8419 | Thot | — |
| 8420 | Zénith | — |
| 8421 | Atalante | — |
| 8422 | Dodone | — |

## Maison et médias (85xx)

| Port | Appli | Ports imposés (gardés) |
|---|---|---|
| 8501 | Apollon | — |
| 8502 | Aurore | — |
| 8503 | Constellation | 1883 (MQTT) |
| 8504 | Cyclope | — |
| 8505 | Héphaïstos | — |
| 8506 | Héra | — |
| 8507 | Hestia | — |
| 8508 | Midgard | — |
| 8509 | Olympie | — |
| 8510 | Orphée | — |
| 8511 | Ulysse | — |
| 8512 | Vénus | 8096 (Venus) · 8920 (Venus HTTPS) · 5433 (base de Venus) · 51413 (BitTorrent) |
| 8513 | Zeus | — |
