# Plume partout — le contrat (Odin, son interface, Pégase)

Plume corrige pendant qu'on écrit, partout : la discussion avec Odin, chaque champ de texte de chaque appli d'Odin,
l'interface d'Odin elle-même, et Pégase (sites, formulaires, barre de recherche). Rouge : orthographe et frappe ;
bleu : grammaire. Une petite fenêtre pointée sur le mot propose **Corriger**, **Modifier**, **Tout voir · N** et
**Désactiver**. Ce fichier est le contrat entre Odin (le serveur) et ses clients : l'interface d'Odin
(`src/web/plume.js`) et Pégase (`pegase-plume/`, branché par l'agent qui code Pégase).

## 1. Les règles (demande du propriétaire, 14/11/2026)

- **Rien n'est changé sans un clic.** Plume souligne et propose ; seul un clic (Corriger, Remplacer, Tout corriger)
  touche au texte.
- **Jamais** dans un champ de mot de passe, de code (code reçu par SMS, code PIN…), de carte bancaire, ni dans un
  éditeur de code. Voir § 6.
- **Le texte ne part que vers Odin, jamais sur Internet.** Odin corrige avec son correcteur de base (fait maison,
  dictionnaire français Grammalecte livré avec Odin) ou avec un LanguageTool installé à côté d'Odin (réseau local).
  Odin ne garde pas les textes (seulement un cache en mémoire de 2 minutes pour aller vite).
- **Désactiver = Plume se tait partout, tout de suite** : plus aucune proposition dans Odin, ses applis et Pégase, et
  l'IA d'Odin ne s'en sert plus. **Seul Réglages → Plume le rallume** (le message « Plume est désactivé partout » a
  aussi un bouton Annuler, juste après le clic).
- Le réglage est **par personne** (les personnes de Persona ; le propriétaire d'Odin a le sien), le même sur tous ses
  appareils.
- « Ignorer » et « Ajouter au dictionnaire » sont retenus (par personne, sur Odin).

## 2. Qui parle à Odin, avec quoi

| Client | Authentification | Personne |
|---|---|---|
| Interface d'Odin (navigateur) | cookie de session `odin_session` ; en POST, l'en-tête `x-odin: 1` est obligatoire | le propriétaire, ou le membre de Persona connecté |
| Programme avec la clé d'API d'Odin | `Authorization: Bearer <clé d'API>` | le propriétaire |
| Pégase | `Authorization: Bearer pg1.…` (jeton d'appareil Pégase) **ou** jeton d'accès de la connexion unique (audience `pegase`) | la personne de Persona de cet appareil (le compte du propriétaire dans Persona = le propriétaire) |

Sans connexion valable : `401 { ok: false, code: "connexion", message }` (avec un jeton Pégase refusé ou expiré : le code
de Pégase, `jeton_invalide` ou `jeton_requis`, pour que Pégase renouvelle sa connexion) (un mauvais jeton compte comme un essai raté
dans la limite d'essais d'Odin). Sans `x-odin: 1` sur un POST avec cookie : `403`. Corps JSON de 64 Ko au plus.

## 3. Les routes

Toutes les réponses sont du JSON (`cache-control: no-store`).

### `GET /api/plume/etat` — l'état, lu par tous les clients

```json
{ "ok": true, "actif": true, "odin": true, "pegase": true, "ia": true, "grammaire": true, "langue": "fr",
  "correcteur": "maison", "dictionnaire": 14, "ignores": 3, "depuis": null, "maj": 1763104920000, "personne": "Awa" }
```

- `actif` : l'interrupteur principal. Plume ne propose quelque chose **dans l'interface d'Odin** que si
  `actif && odin`, **dans Pégase** que si `actif && pegase`. L'IA d'Odin ne s'en sert que si `actif && ia`.
- `grammaire` : bleu (grammaire et style) en plus du rouge (orthographe et frappe).
- `correcteur` : `maison` (correcteur de base d'Odin) ou `LanguageTool`.
- `depuis` : quand Plume a été désactivé (millisecondes depuis 1970), sinon `null`.
- `maj` : la version du réglage (millisecondes). Un client qui voit un `maj` différent du sien relit l'état.

### `POST /api/plume/corriger` — les fautes d'un texte

Requête : `{ "texte": "…", "ou": "odin" | "pegase", "champ": "texte" | "ligne" | "recherche", "langue": "fr" }`
(`texte` : 20 000 caractères au plus ; `champ` : zone de texte, champ d'une ligne, barre de recherche ; `langue`
facultative, sinon celle du réglage).

Réponse :

```json
{ "ok": true, "actif": true, "maj": 1763104920000, "moteur": "maison", "ms": 4,
  "fautes": [
    { "id": "a1b2c3d4", "debut": 7, "fin": 18, "genre": "orthographe", "avant": "rendez vous",
      "propositions": ["rendez-vous"], "raison": "Le nom « rendez-vous » s'écrit avec un trait d'union.", "regle": "MOT_COMPOSE" }
  ] }
```

- `debut` / `fin` : positions dans `texte`, en unités UTF-16 (comme `String.prototype.slice` et `selectionStart`
  en JavaScript). `avant === texte.slice(debut, fin)`.
- `genre` : `orthographe` (rouge), `frappe` (rouge), `grammaire` (bleu). Sans le réglage `grammaire`, aucune faute
  `grammaire` n'est rendue.
- `propositions` : du meilleur au moins bon (3 au plus, parfois aucune : alors seulement « Modifier »).
- Les mots du dictionnaire de la personne et les fautes ignorées (même `avant` et même `regle`) ne sont jamais rendus.
- Plume coupé pour ce client (`actif` faux, ou `odin` / `pegase` faux selon `ou`) : `{ ok: true, actif: false,
  fautes: [] }` **sans rien corriger**. Le client efface alors tout de suite ses soulignements.
- `incomplet: true` (rare) : beaucoup de mots inconnus d'un coup, Odin n'a pas tout regardé pour rester rapide ; le client
  redemande le même texte un peu après (la réponse suivante est complète).
- Vitesse : moins de 150 ms pour un message avec le correcteur de base (en pratique quelques millisecondes ; le premier
  appel charge le dictionnaire, environ une demi-seconde). Le même texte redemandé sort du cache.

### `POST /api/plume/reglages` — changer le réglage

Requête : un ou plusieurs champs parmi `actif`, `odin`, `pegase`, `ia`, `grammaire` (booléens), `langue` (`fr`,
`en-US`, `en-GB`, `de-DE`, `es`, `it`, `pt-PT` ; hors `fr`, il faut LanguageTool). Réponse : l'état complet (comme
`/etat`). **Désactiver** = `{ "actif": false }`.

### `GET|POST /api/plume/dictionnaire` — le dictionnaire de la personne

`GET` → `{ ok, mots: ["Mamoudzou", …] }`. `POST { "ajouter": "Mamoudzou" }` ou `{ "retirer": "…" }` → `{ ok, mots }`.
Un mot : 1 à 60 caractères, sans espace ; 2 000 mots au plus.

### `GET|POST /api/plume/ignorer` — les fautes ignorées

`GET` → `{ ok, ignores: [{ avant, regle }] }`. `POST { "avant": "…", "regle": "…" }` (ignorer cette faute partout),
`{ "retirer": { avant, regle } }`, ou `{ "oublier": true }` (tout oublier) → `{ ok, ignores }`. 2 000 au plus.

## 4. Ce que fait un client (interface d'Odin, Pégase)

1. Au démarrage : `GET /etat`. Plume coupé pour ce client → rien d'autre (aucun appel à `/corriger`).
2. Pendant la frappe : un appel à `/corriger` quand la personne s'arrête d'écrire **400 ms** (appels regroupés), avec
   un cache des textes déjà vus. Les soulignements suivent le texte tapé entre deux réponses.
3. Clic (ou doigt) sur un mot souligné : la petite fenêtre pointée sur le mot (sur téléphone : posée au-dessus du
   clavier, boutons de 44 px au moins).
4. Le compteur Plume dans le champ (nombre de fautes) ouvre « Tout voir ».
5. **Désactiver** : `POST /reglages { actif: false }`, tout disparaît tout de suite ; message « Plume est désactivé
   partout » avec **Annuler** (`{ actif: true }`) et **Ouvrir les réglages**. Les autres onglets du même navigateur le
   savent tout de suite (`BroadcastChannel("odin-plume")`) ; les autres appareils à leur prochain appel (réponse
   `actif: false`), quand la fenêtre revient au premier plan, et au plus tard une minute après (relecture de `/etat`).
6. Corriger : le texte est changé comme si on l'avait tapé (annulable avec Ctrl+Z), et un événement `input` part pour
   la page.

## 5. L'IA d'Odin

Quand le propriétaire demande à Odin de corriger un texte ou un fichier joint, ou pose une question sur l'écriture
(orthographe, grammaire, accord, conjugaison…), et seulement si Plume est activé pour lui avec « Odin se sert de Plume »
(`actif && ia`), Odin passe d'abord le texte (ou le document joint) à Plume et répond en le disant : « Odin, avec
Plume : … ». Plume coupé : Odin n'appelle pas Plume (ni pour le message, ni par l'action « Corriger un texte » de
l'appli Plume pendant une réponse de l'IA).

## 6. Les champs où Plume ne va jamais

`input` autre que `text` / `search` (donc jamais `password`, `email`, `number`, `tel`, `url`…) ; un champ dont
`autocomplete` parle de mot de passe, de code à usage unique ou de carte (`current-password`, `new-password`,
`one-time-code`, `cc-*`) ; dont le nom, l'identifiant ou l'aide parlent de mot de passe, code, PIN, carte, CVC, IBAN,
jeton, clé ou secret ; `inputmode="numeric"` ; en lecture seule ou désactivé ; `spellcheck="false"` ; police à chasse
fixe (éditeurs de code), `.CodeMirror`, `.cm-editor`, `.monaco-editor`, `.ace_editor` ; et tout champ marqué
`data-plume="non"`.

## 7. Pégase

Pégase ne donne **jamais** l'accès à Odin à la page : le script de page (`pegase-plume/plume-page.js`) tourne dans le
monde isolé de Pégase, dessine dans un Shadow DOM **fermé**, et demande au processus principal par IPC
(`pegase:plume`) ; seul le processus principal parle à Odin, avec le jeton de l'appareil. Mode d'emploi :
`pegase-plume/README.md`.
