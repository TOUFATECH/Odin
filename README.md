<div align="center">

# ᛟ Odin

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

Dans un conteneur, parle à Odin par Telegram ou par l'API HTTP (`"http": { "host": "0.0.0.0" }` dans `/data/config.json`, port 7778). L'interface web, elle, n'écoute que sur la machine locale.
</details>

**Mise à jour** : `odin update` · **Désinstallation** : voir [Dépannage](#dépannage).

---

## Premiers pas

### 1. Donner un cerveau à Odin

Odin fonctionne avec le modèle de ton choix. L'installateur te demande ta clé ; tu peux aussi la mettre plus tard dans `~/.odin/env` (lisible par toi seul) :

```bash
ANTHROPIC_API_KEY=sk-ant-…          # Claude (recommandé)
# ou OPENROUTER_API_KEY=sk-or-…     # des centaines de modèles
```

**Sans clé, 100 % local** avec [Ollama](https://ollama.com) : dans `~/.odin/config.json` :

```json
"providers": [{ "kind": "openai", "model": "qwen3:14b", "baseUrl": "http://localhost:11434/v1" }]
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

`odin web` ouvre `http://127.0.0.1:7777` (lien personnel avec jeton, affiché au démarrage ; le jeton est aussi dans `~/.odin/web-token`).

| Onglet | Ce que tu y fais |
|---|---|
| **Discussion** | parler à Odin, voir ses outils en direct, répondre aux validations en un clic (Autoriser · Toujours autoriser · Refuser) |
| **Réseau** | appareils en ligne, déconnectés, retirés ; ce qu'Odin peut faire avec chacun ; balayage à la demande |
| **Mémoire** | souvenirs d'Odin ; valider ceux en quarantaine, épingler, oublier |
| **Compétences** | relire et approuver les compétences qu'Odin propose |
| **Tâches planifiées** | voir et supprimer les tâches récurrentes |
| **Décisions** | tout ce qu'Odin a fait, qui l'a décidé et pourquoi ; niveau d'autonomie ; autorisations permanentes |

L'interface n'écoute que sur ta machine. Depuis ton téléphone : tunnel SSH, Tailscale, ou Telegram.

### Terminal

`odin chat`, puis dans la conversation : `/new` (nouvelle conversation), `/memory mot`, `/skills`, `/drafts`, `/cost`, `/exit`. **Ctrl+C** interrompt Odin. Une seule demande : `odin run "…"`.

### Telegram

1. Crée un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`) et copie son jeton.
2. Ajoute `TELEGRAM_BOT_TOKEN=…` dans `~/.odin/env`.
3. Dans `~/.odin/config.json` : `"telegram": { "enabled": true, "tokenEnv": "TELEGRAM_BOT_TOKEN", "owners": [] }`.
4. Lance `odin web` (ou `odin gateway`) et écris à ton bot : il te répond avec ton identifiant. Mets-le dans `owners`, puis relance.

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

### Mises à jour de la machine

`odin updates` liste les mises à jour disponibles (apt, dnf, pacman, Homebrew, softwareupdate, winget). Odin peut les installer **avec ton accord** ; ce n'est jamais une décision de routine.

---

## Décisions et autonomie

Avant chaque action qui écrit, exécute ou envoie, Odin se pose 7 questions simples : l'as-tu demandée ? supprime-t-elle des données ? envoie-t-elle des données dehors ? modifie-t-elle le système ? engage-t-elle de l'argent ? partage-t-elle des données privées ? est-elle difficile à annuler ? Une table de vérité, écrite dans le code, en déduit une **gravité** :

| Gravité | Exemples | Prudent | **Équilibré** (défaut) | Autonome |
|---|---|---|---|---|
| routine | créer le dossier demandé, envoyer le message dicté | demande | **fait seul, et te le dit** | fait seul |
| important | droits administrateur, suppression définitive, effet incertain, contenu web douteux lu | demande | **demande** (ou autorisation permanente) | fait seul\* |
| grave | argent, données privées envoyées, suppression ou changement système non demandés | demande | **demande toujours** | demande toujours |
| bloqué | envoi non demandé après lecture d'une page piégée | refus | **refus** | refus |

\* sauf après lecture de contenu non fiable.

- **Transparence** : chaque décision prise seul est annoncée pendant le travail et résumée à la fin de la réponse (« 🛡 Décidé sans te déranger »). Historique complet : onglet **Décisions** ou `odin decisions`.
- **Autorisation permanente** : pour une action importante, réponds « toujours » ; Odin ne te redemandera plus pour ce type d'action (`shell:make install`, par exemple). Jamais pour le grave. Liste et retrait : `odin grants`.
- **Niveau** : `odin jev autonomy prudent|equilibre|autonome`, ou les boutons de l'onglet Décisions.

### Qui répond aux questions ?

Par défaut, un **juge local** : hors ligne, sans clé, moins d'une milliseconde, rien ne sort de ta machine. Quand il ne sait pas (programme inconnu, tournure inédite), il répond « incertain », et Odin te demande. Tu peux lui adjoindre un juge plus fin, consulté **seulement quand le juge local hésite** :

| `odin jev use …` | Clé | Réseau |
|---|---|---|
| `local` (défaut) | aucune | aucun |
| `local+llm` | aucune avec Ollama | seulement si le juge local hésite |
| `local+jev` | `TYPESAFE_API_KEY` ([Jev de TypeSafe](https://docs.typesafe.ai)) | seulement si le juge local hésite |
| `llm` · `jev` | idem | à chaque question |

`odin jev test` montre les jugements sur 5 exemples ; `odin jev eval` mesure le juge sur 140 cas étiquetés (ajoute les tiens dans `src/mimir/cases.ts`). Sur des cas écrits après le gel de ses règles, le juge local voit juste 78 % du temps ; ses erreurs ajoutent moins de protection, jamais moins de sécurité, car les règles de base de Heimdall restent en place. Une panne du juge n'est jamais lue comme un « non ».

---

## Sécurité

Odin applique sa sécurité **dans le code**, pas dans le prompt :

- **Marquage du contenu non fiable** : dès qu'Odin lit une page web ou le message d'un inconnu, écrire, exécuter ou envoyer demande ta validation. Une page piégée ne peut pas le retourner contre toi.
- **Règles absolues** : `rm -rf /`, `curl … | sh`, `mkfs`, `format C:`, `diskpart`… sont refusés même si tu acceptes.
- **Shell sans secrets** : les variables contenant KEY, TOKEN, SECRET ou PASSWORD sont retirées de son environnement. Bac à sable Docker en option (`policy.sandbox.kind: "docker"` : sans réseau, lecture seule, ressources limitées).
- **Secrets masqués** partout : avant le modèle, dans la mémoire, les journaux et les messages. La configuration ne contient jamais de clé, seulement le nom de la variable qui la contient.
- **Fichiers confinés** à l'espace de travail (`~/.odin/workspace`), liens symboliques compris.
- **Anti-SSRF** : l'outil web n'accède pas aux adresses internes.
- **Inconnus** appairés par code, **interface web** liée à 127.0.0.1 avec jeton, **journal** de chaque décision (`~/.odin/logs/audit.jsonl`).

---

## Toutes les commandes

| Commande | Rôle |
|---|---|
| `odin init` | crée `~/.odin` |
| `odin doctor` | diagnostic complet |
| `odin web` | interface web + Telegram + API + tâches planifiées |
| `odin gateway` | pareil, sans ouvrir le navigateur (service) |
| `odin chat` · `odin run "…"` | terminal · une seule demande |
| `odin decisions [N]` | ce qu'Odin a décidé et pourquoi |
| `odin grants [list\|revoke ID]` | autorisations permanentes |
| `odin jev [autonomy N\|use JUGE\|test\|eval]` | autonomie et juge des décisions |
| `odin memory [list\|search\|forget\|pin\|vouch]` | mémoire |
| `odin skills [list\|drafts\|show\|diff\|approve\|reject\|rollback]` | compétences |
| `odin net [scan\|list\|show\|events\|label\|enable\|disable]` | réseau local |
| `odin cron [list\|add\|remove]` | tâches planifiées |
| `odin pairing [list\|approve CANAL CODE]` | inconnus sur Telegram |
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
| `web.port` | 7777 | interface web (toujours sur 127.0.0.1) |
| `channels.telegram` · `channels.http` | désactivés | canaux de messagerie |

La personnalité d'Odin est dans `~/.odin/ODIN.md` : modifie-la librement.

---

## Dépannage

| Problème | Solution |
|---|---|
| `odin : commande introuvable` | ouvre un nouveau terminal (le PATH a été mis à jour) |
| Odin répond « mode démo » | ajoute une clé dans `~/.odin/env` ou configure Ollama, puis `odin doctor` |
| Telegram ne répond pas | vérifie `TELEGRAM_BOT_TOKEN`, `enabled: true`, ton identifiant dans `owners`, puis `odin doctor` |
| Odin me demande trop souvent | réponds « toujours » aux demandes importantes récurrentes, ou `odin jev autonomy autonome` |
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
| `src/web` | interface web |
| `src/providers` · `src/cron` · `src/cli` | modèles · planification · commandes |

Ajouter un outil = un objet avec un nom, une description, un **niveau de risque** et une fonction `run` ; Heimdall et Mímir s'occupent du reste.

## Licence

[MIT](LICENSE) © TOUFATECH
