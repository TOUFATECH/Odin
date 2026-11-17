# src/web/ — l'interface d'Odin

| Fichier | Rôle |
|---|---|
| `server.ts` | le serveur HTTPS de l'interface : compte, sessions, accès (réseau local par défaut), routes `/api/*`, fil en direct |
| `ui.html` | la page principale (discussion, accueil, réglages, décisions…) |
| `pages/*.js` | les pages dessinées à la main de certaines applis (les autres utilisent la vue générique) |
| `*-api.ts` | les routes d'une appli ou d'un espace (Brain, maison, Talos, Pégase…) |
| `face.js` | **le visage de la mascotte** : ses yeux et sa couleur pour chaque humeur ; rien d'autre n'est dessiné |
| `vie.js` | sa « vie intérieure » : besoins et émotions tirés de ce qui se passe, sans hasard |
| `companion.js` · `mascotte.js` | où elle se promène, et ses habits |
| `fenetre.js` · `maison.js` | l'accueil et l'écran de la maison (widgets) |
| `access.ts` · `pairing.ts` · `account.ts` | qui peut entrer, l'appairage d'un appareil, ton compte |

Règles : aucun script externe (politique de sécurité du contenu stricte), en-tête `x-odin` exigé sur chaque envoi,
textes en français dans le code (la traduction de l'interface est à venir).

Le site public (`site/`) reprend `face.js` tel quel : la même mascotte que dans l'interface.
