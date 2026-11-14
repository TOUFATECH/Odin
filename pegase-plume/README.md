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

## Brancher (4 étapes)

1. **Le script de page** : `src/preload/page.ts` est compilé à part et le préchargement est en bac à sable (il ne peut pas
   `require` un fichier local). Ajoute `plume-page.js` **à la fin** de `dist/preload/page.js` à la construction, par
   exemple dans `build:main` :

   ```json
   "build:main": "tsc -p tsconfig.main.json && node -e \"const f=require('fs');f.copyFileSync('src/main/odin-sso.mjs','dist/main/odin-sso.mjs');f.appendFileSync('dist/preload/page.js','\\n'+f.readFileSync('../pegase-plume/plume-page.js','utf8'))\""
   ```

   (Le script ne fait rien hors des pages `http(s)` ni dans les cadres.)

2. **Le processus principal** (au démarrage, à côté de `brancherMotsDePasse`) — copie `plume-main.cjs` dans
   `src/main/` (ou `require('../../../pegase-plume/plume-main.cjs')` si tu l'empaquettes) :

   ```ts
   const { brancherPlume } = require('./plume-main.cjs');
   const plume = brancherPlume({
     ipcMain,
     // GET si corps est undefined, sinon POST JSON ; avec le jeton du profil courant (ou de la connexion unique).
     appelOdin: async (chemin, corps) => { const l = profil.lien(); if (!l) return { status: 0, j: {} }; const a = await authOdin(l); return appel(l.adresse, chemin, { empreinte: l.empreinte, jeton: a.jeton, entetes: a.entetes, ...(corps === undefined ? {} : { corps }), delai: 5000 }); },
     estPage: (id) => Boolean(trouverOnglet(id)),              // un onglet de page web, pas l'interface de Pégase
     ouvrirReglages: () => ouvrirOnglet(`${profil.lien()!.adresse}/#plume`), // Réglages → Plume dans l'interface d'Odin
     pages: () => tousLesOnglets().map((o) => o.vue.webContents),
   });
   ```

   `appel` doit faire un **GET** quand `corps` est `undefined` (lecture de l'état) et un **POST** JSON sinon. Dans une
   fenêtre privée, tu peux ne pas brancher Plume (rien n'est alors envoyé).

3. **Rafraîchir l'état** : appelle `plume.diffuser(etat)` si tu relis `GET /api/plume/etat` ailleurs (par exemple à la
   synchro). Sinon chaque page relit l'état quand elle revient au premier plan et au plus toutes les minutes ; une page
   apprend aussi « désactivé » à son prochain appel (`actif: false`).

4. **Réglages de Pégase** : une ligne « Plume (correcteur) » qui ouvre Réglages → Plume d'Odin (`<Odin>/#plume`) suffit :
   le réglage est celui de la personne, le même dans Odin, ses applis et Pégase, sur tous ses appareils.

## Essayé

`test/plume-pegase.test.ts` (dans Odin) charge `plume-page.js` dans un vrai Chromium (Playwright), sur une page de
formulaire servie avec une politique de contenu stricte, avec un transport qui imite l'IPC et parle au vrai Odin avec un
vrai jeton d'appareil Pégase : soulignement, Corriger, Tout voir, Désactiver, champ mot de passe ignoré, et la page ne
voit ni l'intérieur de Plume ni le jeton. Il vérifie aussi que `plume-page.js` est à jour. L'Electron réel n'est pas
lancé par cet essai (l'agent Pégase le fait dans ses essais `test/*.test.mjs`).
