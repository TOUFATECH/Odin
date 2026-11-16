# Installer STRATA sur une machine NVIDIA (guide honnête)

Ce guide dit ce qu'il faut pour faire tourner **STRATA** et le brancher sur Zeus. Ce n'est **pas simple** : c'est un
modèle de recherche, pas un logiciel prêt à l'emploi. Rien ici n'a été essayé sur une vraie machine par Odin ; les
points marqués « à vérifier » doivent l'être sur la fiche et le dépôt avant de se lancer.

Le contrat que le serveur doit respecter : [strata-contrat.md](strata-contrat.md).

## Ce qu'est STRATA

- Un modèle de recherche de NVIDIA (Earth-2), 331,7 millions de paramètres, qui **émule une simulation atmosphérique
  mondiale** à environ 5 km, par pas de 10 minutes (grille SCREAM).
- Fiche : https://huggingface.co/nvidia/strata · code : https://github.com/NVlabs/STRATA (Apache-2.0) · poids sous
  licence OpenMDW v1.1 (lire la licence avant tout usage).
- Usage prévu : la prévision courte, de quelques heures à quelques jours. **Pas de prévision à 1, 2 ou 3 mois.**
- Il ne se nourrit **pas** des prévisions publiques : il lui faut un **état initial complet** de l'atmosphère.

## Le matériel et les logiciels

- Une **carte de calcul NVIDIA** : Ampere, Hopper ou Blackwell. Testé par NVIDIA sur **A100 et H100**.
- **Linux**.
- **PyTorch avec CUDA**.
- **NVIDIA PhysicsNeMo** (le modèle y est sous `physicsnemo.experimental.models.strata` d'après la fiche ; « experimental »
  veut dire que l'interface peut changer).
- **NATTEN**, compilé pour la **même** version de PyTorch et de CUDA (c'est souvent là que ça casse).
- Le dépôt https://github.com/NVlabs/STRATA et les poids de https://huggingface.co/nvidia/strata.

### Et une carte grand public ?

Rien n'est garanti. Une RTX 30 est une Ampere, mais la fiche ne dit rien de la mémoire nécessaire : à essayer, sans
promesse. Une RTX 40 (Ada) n'est pas dans la liste. Le PC qui fait tourner Odin n'a pas de carte de ce niveau : STRATA
tourne **ailleurs**, et Odin l'interroge par le réseau.

## Le plus dur : l'état initial

- STRATA attend **145 canaux sur 24 niveaux**, sur la grille SCREAM **ne1024pg2**, plus **4 champs fixes** (`coszr`,
  `phis`, `sgh30`, `landfrac`) : 149 canaux en tout.
- Les jeux de données SCREAM-STRATA (CC BY 4.0) servent à la **recherche** : ils ne donnent pas l'état de l'atmosphère
  d'aujourd'hui.
- Pour une prévision du jour, il faut **régriller une analyse opérationnelle** (ECMWF IFS ou NOAA GFS) vers la grille
  SCREAM, avec toutes les variables attendues. Ce n'est **pas fourni**. La bibliothèque earth2studio de NVIDIA peut
  aider à récupérer les analyses (à vérifier : elle ne fait pas forcément le régrillage SCREAM).
- Tant que cet état initial n'existe pas chaque jour, le serveur doit répondre `"pret": false` avec sa raison : Zeus
  l'affichera tel quel, sans rien inventer.

## Le petit serveur à écrire

Le dépôt de STRATA ne fournit pas le serveur d'Odin : il faut l'écrire (quelques dizaines de lignes autour du modèle).
Ce qu'il doit faire, d'après le contrat :

1. Une fois par jour, dès qu'un nouvel état initial est prêt : lancer STRATA sur 3 jours, découper les journées
   locales, calculer pour chaque point demandé les températures à 2 m (max et min), la pluie (flux liquide et solide
   × 600 s par pas), le vent du niveau le plus bas (dit dans `vent_niveau`) et la pression de surface. Garder le
   résultat en cache.
2. `GET /v1/etat` : dire s'il est prêt, sa carte, d'où vient l'état initial et sa date.
3. `POST /v1/prevision` : répondre depuis le cache ; `503` + `Retry-After` si le calcul tourne encore ; `422` si le
   lieu ou l'échéance n'est pas couvert ; `null` pour toute valeur inconnue.
4. N'écouter que sur le réseau de la maison (pas d'authentification en v1). Réponses de 64 Ko au plus.

## Brancher sur Odin

1. Dans Zeus, onglet **Sources**, case « Adresse du serveur STRATA » : par exemple `http://192.168.1.50:8000`.
   Une adresse hors de la maison doit être en `https`. Les adresses 169.254.x et celles des métadonnées d'un hébergeur
   sont refusées, comme un identifiant écrit dans le lien.
2. Bouton **« Essayer le serveur STRATA »** : un seul appel ; la ligne STRATA dit ce qui s'est passé.
3. Ensuite, Zeus l'interroge **une fois par jour**, pendant le relevé du matin (tâche « Relevé des prévisions » dans
   Talos, mise en pause possible).
