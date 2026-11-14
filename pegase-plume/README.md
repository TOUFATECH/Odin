# Plume dans Pégase — mode d'emploi pour l'agent qui code Pégase

Plume corrige pendant qu'on écrit dans les pages web de Pégase (sites, formulaires, barre de recherche d'un site) :
soulignements rouges (orthographe, frappe) et bleus (grammaire), compteur dans le champ, petite fenêtre
**Corriger · Modifier · Tout voir · N · Désactiver**, exactement comme dans l'interface d'Odin (même code :
`src/web/plume.js` et `src/web/plume.css`). Contrat avec Odin : `docs/plume-protocole.md`.

Ce dossier ne touche pas à `pegase/` : il est prêt à brancher.

| Fichier | Rôle |
|---|---|
| `plume-page.js` | le script de page (fabriqué, ne pas modifier à la main) : à exécuter dans le **monde isolé** de chaque page web |
| `plume-main.cjs` | le côté processus principal (CommonJS) : IPC `pegase:plume`, appelle Odin avec le jeton de l'appareil |
| `construire.mjs` | refabrique `plume-page.js` après un changement de `src/web/plume.js` ou `plume.css` : `node pegase-plume/construire.mjs` |

## Ce qui protège la personne et la page

- **Aucun accès de la page à Odin** : `plume-page.js` tourne dans le monde isolé (préchargement, `contextIsolation`,
  bac à sable) ; il n'expose rien (pas de `contextBridge`, aucune variable globale de la page) et ne parle qu'au
  processus principal par `ipcRenderer.invoke('pegase:plume', …)`. Le jeton ne quitte jamais le processus principal.
- **Shadow DOM fermé** : tout ce que Plume dessine (soulignements, compteur, fenêtres) est dans un élément
  `<plume-pegase>` dont l'ombre est fermée (`mode: 'closed'`) : la page ne peut ni lire les fautes ni cliquer à la place
  de la personne (Plume n'agit que sur un vrai clic, `isTrusted`). Les styles passent par `adoptedStyleSheets` : ils
  marchent aussi sur les sites à la politique de contenu stricte (`style-src 'self'`).
- `plume-main.cjs` refuse ce qui ne vient pas d'un onglet de page (`estPage`) ou vient d'un cadre, ne laisse passer que
  les 5 routes de Plume, ne garde que les champs attendus, et force `ou: "pegase"` (le réglage « Dans Pégase »).
- **Jamais** dans un champ de mot de passe, de code, de carte bancaire, ni dans un éditeur de code (règles du § 6 du
  contrat, appliquées par le script de page). Rien n'est changé sans un clic.
- Le texte ne part que vers Odin (réseau local ou ton accès à Odin), jamais vers un autre service.

## Branché dans Pégase (14/11/2026, Pégase 0.1.1)

1. **Script de page** : `build:main` copie `plume-page.js` en `dist/preload/plume.js`, inscrit comme préchargement de cadre
   (`registerPreloadScript`) **seulement pour les profils ordinaires** (`src/main/profil.ts`) : dans une fenêtre privée,
   Plume n'est même pas chargé.
2. **Processus principal** : `src/main/plume.ts` branche `plume-main.cjs` (copié en `dist/main/plume-main.cjs`) avec le
   jeton du profil ou la connexion unique (`Synchro.api`, certificat épinglé, renouvellement de la connexion unique) ;
   il refuse les fenêtres privées, l'interface de Pégase et les pages de l'interface d'Odin (qui ont déjà leur Plume).
3. **État** : chaque changement est envoyé aux onglets du même profil (`pegase:plume-etat`).
4. **Réglages de Pégase → Plume (correcteur)** : l'état, l'interrupteur « Dans Pégase » (grisé quand Plume est désactivé
   partout : seul Réglages → Plume d'Odin le rallume), et « Ouvrir Réglages → Plume dans Odin » (`<Odin>/#plume`).

Pour un autre logiciel : mêmes 4 étapes ; `brancherPlume({ ipcMain, appelOdin, estPage, ouvrirReglages, pages, groupe })`
(chaque fonction reçoit l'identifiant du webContents de la page qui demande).

## Essayé

Dans un vrai Chromium (Playwright), `plume-page.js` chargé dans un **monde isolé** (comme le préchargement de Pégase), sur
une page de formulaire servie avec une politique de contenu stricte (`style-src 'self'`), avec un transport qui imite
l'IPC et passe par le vrai `plume-main.cjs`, qui appelle le vrai Odin avec un vrai jeton d'appareil Pégase : soulignement,
Corriger, barre de recherche, compteur → Tout voir, Désactiver (coupé aussi dans Odin), champs mot de passe et code
ignorés, rien ne dépasse, et la page ne voit ni l'intérieur de Plume, ni le transport, ni le jeton ; ordinateur (1280) et
téléphone (390). L'essai est gardé hors du dépôt (il a besoin de Playwright) : `plume-partout-tmp/zz-pegase.test.ts`.
`test/plume-partout.test.ts` vérifie que `plume-page.js` est à jour et ce que `plume-main.cjs` laisse passer.
Et dans le vrai Pégase (Electron) contre un vrai Odin : `pegase/test/plume.test.mjs`.
