# D'où Odin récupère la météo

Toutes les adresses sont réunies dans un seul module : `src/valhalla/zeus/sources.ts` (`OPEN_METEO`, `LIGNE_SOURCES`).
L'appli **Zeus** les affiche dans son onglet **Sources**, avec ce que chacune donne, sa portée et qui s'en sert.
Aucune ne demande de clé. La position envoyée est celle du lieu d'Odin (réglé dans Hestia, gardé chiffré) ; Zeus
l'arrondit à 0,01° (environ 1 km) et ne la garde jamais.

| Adresse | Ce qu'elle donne | Portée | Qui s'en sert dans Odin |
|---|---|---|---|
| https://geocoding-api.open-meteo.com/v1/search | Open-Meteo, recherche d'un lieu : nom → latitude, longitude, fuseau, pays | le monde entier, 10 résultats au plus | Hestia (`trouverLieux`, adresse réglable `meteoGeo`), briefing du matin et alertes locales quand seule la ville est connue |
| https://api.open-meteo.com/v1/forecast | Open-Meteo, prévisions : maintenant, heure par heure, jour par jour, un ou plusieurs modèles | 16 jours au plus (`forecast_days`), 92 jours passés au plus (`past_days`) ; chaque modèle a sa propre portée | Hestia (meilleur modèle, maintenant, 24 h, 7 jours), briefing (1 jour), alertes (3 jours : pluie, rafales, orages), Zeus (6 modèles côte à côte) |
| https://archive-api.open-meteo.com/v1/archive | Open-Meteo, le temps qu'il a fait (réanalyse ERA5, la veille complétée par l'analyse ECMWF IFS) | depuis 1940 ; ERA5 arrive avec 5 jours de retard | Zeus, pour dire si les prédictions étaient justes |
| https://seasonal-api.open-meteo.com/v1/seasonal | Open-Meteo, prévisions saisonnières en écart à la normale | SEAS5 : 6 mois par défaut, 7 au plus ; EC46 : 46 jours (null ensuite) | Zeus (onglet Mois) |
| https://nominatim.openstreetmap.org/reverse | OpenStreetMap, nom du village d'après une position GPS (pas de météo) | le monde entier | Hestia (`changerPosition`, adresse réglable `lieuInverse`) |
| https://huggingface.co/nvidia/strata | STRATA (NVIDIA Earth-2), sur **ton propre serveur** à carte NVIDIA | de quelques heures à quelques jours ; rien à 1, 2 ou 3 mois | Zeus, seulement à l'adresse réglée (aucune par défaut) — voir [strata-contrat.md](strata-contrat.md) |

Documentation : https://open-meteo.com/en/docs · https://open-meteo.com/en/docs/historical-weather-api ·
https://open-meteo.com/en/docs/seasonal-forecast-api

## Les modèles comparés par Zeus

Une seule question à `api.open-meteo.com/v1/forecast` avec
`models=best_match,ecmwf_ifs025,ecmwf_aifs025_single,meteofrance_seamless,icon_seamless,gfs_seamless`,
`daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max`, `timezone=auto`,
`forecast_days=16`. Avec plusieurs modèles, chaque variable porte le suffixe du modèle
(`temperature_2m_max_icon_seamless`). Si la question échoue, Zeus repose une question par modèle pour savoir lequel
est en panne.

| Identifiant | Nom affiché | Qui | Portée |
|---|---|---|---|
| `best_match` | Information récupérée | le meilleur mélange choisi par Open-Meteo pour le lieu : **la référence** | 16 jours |
| `ecmwf_ifs025` | ECMWF | Centre européen (ECMWF IFS 0,25°) | 15 jours |
| `ecmwf_aifs025_single` | AIFS | Centre européen, modèle par apprentissage automatique (utile à comparer avec STRATA) | 15 jours |
| `meteofrance_seamless` | MF | Météo-France (ARPEGE et AROME ; AROME ne couvre que la France) | environ 4 jours hors de France (null ensuite) |
| `icon_seamless` | ICON | Service météo allemand (DWD ICON) | 7 jours |
| `gfs_seamless` | GFS | Service météo américain (NOAA GFS) | 16 jours |

## Les verdicts (Zeus, `src/valhalla/zeus/comparer.ts`)

Chaque prédiction est comparée à l'information récupérée, jour par jour ; le verdict du jour est le pire.
Chaque couleur a son mot : **OK** (vert), **Diffère** (jaune), **Souci** (rouge), **—** (gris).

- Température max ou min : 2 °C d'écart ou moins = vert ; 5 °C ou moins = jaune ; au-delà = rouge « écart très grand ».
- Pluie : sec (moins de 1 mm), faible (1 à 10 mm), forte (10 mm ou plus). Vert si même catégorie et écart d'au plus le
  plus grand de 2 mm et 50 % ; jaune sinon ; rouge si sec contre forte.
- Vent max : 15 km/h ou moins = vert ; 30 km/h ou moins = jaune ; au-delà = rouge.
- Valeur impossible (température hors de −90 à 60 °C, min > max + 0,5, pluie hors de 0 à 500 mm, vent hors de 0 à
  400 km/h) = rouge ; source en panne = rouge « ne répond pas » ; valeur absente = gris « ne prévoit pas si loin ».

Phrases : « Prédiction et information récupérée correctes » ; « Prédiction diffère : <source> annonce <valeur>,
l'information récupérée <valeur> (écart <x>) » ; « Souci : <source> <raison> ».

## Les prédictions étaient-elles justes ?

Chaque matin (06:30, tâche « Relevé des prévisions » dans Talos), Zeus garde ce que chaque source prévoit pour J+1 à
J+3. Chaque jour à 07:00 (tâche « Bilan des prédictions »), il lit l'archive des 7 derniers jours. Un jour est juste
quand toutes ses grandeurs sont vertes face à la mesure. Sur 14 jours : 80 % ou plus = « Prédictions justes » ;
50 % ou plus = « Prédictions parfois fausses » ; moins = « Souci : prédictions souvent fausses » ; moins de 5 jours =
« pas encore assez de jours ».

La mesure n'est **pas une station** : c'est l'archive d'Open-Meteo (réanalyse ERA5 et analyse ECMWF). Elle vient du
même centre que deux des modèles comparés (ECMWF IFS et AIFS), ce qui les avantage un peu.

## 1, 2, 3 mois

ECMWF SEAS5 (`models=ecmwf_seas5_ensemble_mean`, `monthly=temperature_2m_anomaly,precipitation_anomaly,wind_speed_10m_anomaly`)
et ECMWF EC46 (`models=ecmwf_ec46_ensemble_mean`, `weekly=temperature_2m_anomaly,precipitation_anomaly`). Les semaines
d'EC46 qui commencent dans un mois sont regroupées (moyenne pour la température, somme pour la pluie, 2 semaines au
moins). Les deux viennent du même centre européen : ce ne sont **pas** deux sources indépendantes. STRATA ne prévoit pas
au-delà de quelques jours.

## Connue mais non utilisée

https://previous-runs-api.open-meteo.com/v1/forecast donne, heure par heure, ce que chaque modèle prévoyait 1 à 7 jours
avant (`temperature_2m_previous_day1`…). Laissée de côté en v1 : le bilan démarre avec les relevés d'Odin.
