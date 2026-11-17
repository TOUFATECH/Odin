# src/valhalla/ — les applis d'Odin

Chaque appli est un **module** (`modules/<id>.ts`) : son nom affiché, sa famille (Données, Machines, Sécurité, Accès,
Maison), ce qu'elle fait, ses **actions** (chacune avec ses paramètres, ses mots, et `grave` si elle demande toujours
ton accord), sa vue (la page) et ses tâches de fond. La logique d'une appli qui dépasse un fichier vit dans un dossier
à son identifiant (`ullr/`, `mathesis/`, `keryx/`…).

| Fichier | Rôle |
|---|---|
| `odin.ts` | la liste de toutes les applis (`allModules`) et leur démarrage |
| `service.ts` | exécuter une action (droits, accord pour le grave, manips à garder ou annuler) |
| `huginn.ts` | **Logos sans modèle** : comprendre une phrase et choisir l'appli et l'action |
| `links.ts` | les liens automatiques entre applis (réflexes, soins, données) et les chaînes « pour quel besoin » |
| `automatismes.ts` | ce que les applis font toutes seules, visible dans Talos |
| `ports.ts` | le port de chaque appli (voir `docs/plan-ports.md`) |
| `sso/` | la connexion unique et la garde des membres de la maison |
| `mcp.ts` | Odin vu par un autre assistant (actions graves jamais proposées) et les connecteurs MCP |
| `types.ts` | le contrat d'un module |

Le **guide** (`npm run guide`) lit ces modules pour fabriquer la fiche de chaque appli : ce que tu écris dans `what`,
`does`, `words` et les actions apparaît tel quel dans `site/guide.html`.

Ajouter une appli : un module dans `modules/`, inscrit dans `odin.ts`, un port dans `ports.ts`, ses essais dans `test/`.
