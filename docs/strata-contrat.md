# Contrat d'échange Odin ↔ serveur STRATA, v1

Zeus (l'appli météo comparée d'Odin) peut comparer ses prévisions avec celles de **STRATA**, le modèle de recherche
de NVIDIA (Earth-2) : https://huggingface.co/nvidia/strata (code : https://github.com/NVlabs/STRATA).
STRATA ne tourne pas sur la machine d'Odin : il lui faut une carte de calcul NVIDIA. Odin parle donc à un petit
serveur, monté par le propriétaire, selon le contrat ci-dessous. Le code d'Odin qui suit ce contrat est
`src/valhalla/zeus/strata.ts` ; ses essais sont dans `test/zeus-strata.test.ts`. Pour monter le serveur :
[strata-installation.md](strata-installation.md).

Le serveur tourne sur une machine Linux avec une carte NVIDIA (Ampere, Hopper ou Blackwell), sur le réseau de la
maison. Il parle en HTTP ou HTTPS et en JSON UTF-8. Aucune authentification en v1 : il doit écouter sur le réseau
local seulement. Toutes les réponses font 64 Ko au plus.

## 1) `GET /v1/etat` → 200

```json
{"pret": true, "modele": "STRATA", "version": "<version des poids>", "carte": "NVIDIA H100 80GB",
 "etat_initial": {"source": "<d'où vient l'état initial, ex. analyse IFS régrillée SCREAM>", "date": "2026-11-16T00:00:00Z"},
 "jours_max": 3}
```

Si `pret` vaut `false`, le serveur ajoute `"raison": "<texte>"` (modèle en chargement, pas d'état initial du jour…).

## 2) `POST /v1/prevision`, `Content-Type: application/json`

Corps :

```json
{"latitude": 48.85, "longitude": 2.35, "fuseau": "Europe/Paris", "jours": 3}
```

- `latitude` et `longitude` sont arrondies à 0,01° par Odin (la grille fait environ 5 km).
- `fuseau` sert à découper les journées locales.
- `jours` va de 1 à `jours_max` ; Odin ne demande jamais plus de 3.

Réponse 200 :

```json
{"modele": "STRATA", "version": "…", "etat_initial": {"source": "…", "date": "…"}, "calcule_a": "2026-11-16T03:12:00Z",
 "jours": [{"date": "2026-11-17", "temperature_max_c": 12.4, "temperature_min_c": 6.1, "pluie_mm": 3.2,
            "vent_max_kmh": 28, "vent_niveau": "plus_bas_niveau_du_modele", "pression_surface_hpa": 1012.3}, …]}
```

Règles pour le serveur :

- Températures : la variable à 2 m du modèle, max et min sur la journée locale.
- `pluie_mm` : somme des flux de pluie liquide et solide en surface (kg m⁻² s⁻¹ × 600 s par pas ; 1 kg/m² = 1 mm).
- `vent_max_kmh` : STRATA n'a pas de vent à 10 m. Le serveur prend le niveau le plus bas du modèle et le dit dans
  `vent_niveau`. Odin affiche alors « vent approché ».
- `pression_surface_hpa` : la pression diagnostiquée en surface, pas ramenée au niveau de la mer.
- Une valeur inconnue vaut `null`, jamais 0 inventé.

Autres réponses :

- **503** avec l'en-tête `Retry-After` : calcul en cours. Le serveur doit précalculer une fois par jour après chaque
  nouvel état initial et servir depuis son cache.
- **422** si le lieu ou l'échéance n'est pas couvert.
- **400** si la demande est mal formée.
- Corps d'erreur : `{"erreur": "<texte>"}`.

## 3) Ce que fait Odin, et rien d'autre

- Au plus un appel par jour, pendant le relevé planifié par Talos, plus le bouton « Essayer le serveur STRATA ».
- Délai d'attente : 60 s pour `/v1/prevision`, 10 s pour `/v1/etat`.
- Adresse acceptée : http ou https, sans identifiant dans le lien. Adresse de la maison (privée ou boucle locale) ou
  https public. Jamais 169.254.x ni les métadonnées d'un hébergeur.
- Une réponse dont une valeur sort des bornes physiques (température entre −90 et 60 °C, pluie entre 0 et 500 mm/j,
  vent entre 0 et 400 km/h, min ≤ max) est marquée « Souci : valeur impossible » et n'est pas comparée.
- Aucun réglage : la ligne dit « STRATA : pas de serveur avec carte NVIDIA, prédiction non disponible ». Elle est en
  gris, avec le mot « Non branché », jamais en vert.
- Réglé mais sans réponse : rouge, « Souci : le serveur STRATA ne répond pas ».
- Au-delà de `jours_max` : « STRATA ne prévoit pas au-delà de quelques jours ».
- Odin n'invente ni ne simule jamais une valeur STRATA.

### Précisions côté Odin (v1)

- Le vent « approché » (niveau du modèle autre que 10 m) est montré mais **pas compté** dans le verdict du jour.
- Une pression hors de 300 à 1100 hPa est aussi traitée comme une valeur impossible.
- Les redirections ne sont pas suivies.
- Odin ne garde de la réponse que les valeurs des jours (dans les réglages de Zeus et, pour le bilan, dans la base
  `ZEUS_ODIN`, sans nom ni position du lieu).
