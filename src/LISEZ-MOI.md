# src/ — le code d'Odin

TypeScript exécuté directement par Node (22.18 ou plus) : rien à compiler. Le point d'entrée est `bin/odin.mjs`, qui
charge `cli/main.ts`. `runtime.ts` assemble Odin (modèles, mémoire, outils, garde-fous) ; `config.ts` lit et vérifie
`~/.odin/config.json`.

Les dossiers portent des noms nordiques (leur rôle dans le code) ; les applis, elles, ont un nom affiché à l'écran,
souvent grec. La table dit les deux.

| Dossier | Rôle | Nom affiché |
|---|---|---|
| `core/` | la boucle de l'agent : comprendre, appeler les outils, répondre ; le mode sans modèle | Logos |
| `heimdall/` | **les garde-fous** : gravité de chaque action, contenu extérieur non fiable, secrets masqués, chemins | Heimdall |
| `mimir/` | le juge des décisions : questions, tables de vérité, autonomie | Mímir |
| `muninn/` | la mémoire en fichiers (souvenirs, conversations, recherche) | Mnémosyne |
| `brain/` | le Cerveau (notes reliées), Soul (`brain/nous/`), les modèles ouverts (`brain/metis/`) | Brain (« Thot » à l'écran), Soul (« Noûs »), Métis |
| `learn/` | apprendre de tout, le « cerveau direct » | — |
| `bifrost/` | la passerelle : canaux (web, Telegram, Kéryx…), tâches planifiées, travail continu | Bifröst |
| `web/` | l'interface web (serveur, page, visage de la mascotte) | — |
| `valhalla/` | **les 75 applis** (un module par appli dans `valhalla/modules/`, leur logique dans un dossier à leur nom) | voir le guide |
| `tools/` | les outils qu'Odin appelle (fichiers, commandes, web, mails, navigateur…) | Gungnir |
| `providers/` | les fournisseurs de modèles et le routeur | — |
| `voice/` | la voix : comprendre, parler, accords pour copier une voix | Orphée |
| `vision/` · `audio/` · `video/` | voir, entendre, analyser une vidéo | Théia · Syrinx |
| `langue/` | reconnaître la langue d'un texte (232 langues, sans service extérieur) | — |
| `research/` | la recherche vérifiée (collecte, sources, verdicts) | Pythie |
| `browser/` | le navigateur piloté | — |
| `hlidskjalf/` | l'inventaire du réseau local | — |
| `machines/` | les droits d'Odin sur sa machine et sur les machines du réseau | — |
| `yggdrasil/` | les compétences (format SKILL.md) | Athéna |
| `plugins/` | l'onglet « Plugins » des compétences | — |
| `draupnir/` | le moteur des automatisations | Talos |
| `runes/` | les formules des bases | Papyrus |
| `scripts/` | la garde des scripts et des compétences | — |
| `apps/` | le contrôle d'un dépôt GitHub avant de l'installer | — |
| `cron/` · `home/` · `guard/` · `net/` · `push/` · `files/` · `mood/` | planification · réveil · alertes locales · état d'Internet · notifications · fichiers reçus · humeurs | — |
| `cli/` | les commandes `odin …` | — |

Fichiers à la racine de `src/` : `vault.ts` (le coffre chiffré), `settings.ts` et `reglages-*.ts` (réglages modifiables
depuis l'interface), `prive*.ts` (mode privé), `backup.ts`, `undo.ts`, `selftest.ts`, `types.ts`.

**À savoir avant de modifier** : les fichiers des garde-fous (`heimdall/`, `vault.ts`, `tools/self.ts`,
`tools/reglages.ts`, `mimir/decisions.ts`, `mimir/questions.ts`) ont une version de référence ; après un changement,
lance `npm run noyau:empreintes`, sinon Odin refuse toute action engageante au démarrage suivant.
