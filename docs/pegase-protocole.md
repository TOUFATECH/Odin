# Pégase ↔ Odin : le protocole précis

Ce fichier précise, sans le contredire, le contrat `missions/pegase-protocole.md`. **C'est lui qui fait foi** pour les trois
côtés (Odin, Pégase ordinateur, Pégase téléphone). Version du protocole : **1**.

- Toutes les routes sont sous `/api/pegase/`. Réponses en JSON UTF-8 (sauf `flux` : SSE, `agenda.ics` : texte iCalendar).
- Odin écoute par défaut sur `https://<ip>:7777` (certificat souvent auto-signé, voir § 1).
- Toute requête `POST` envoie `content-type: application/json` (sinon **415**). Pas de cookie, pas d'en-tête `x-odin` :
  Pégase n'est pas une page web, il s'authentifie par son jeton.
- Les dates sont des **millisecondes depuis 1970 (UTC)** (`maj`, `serveur`, `depuis`…), sauf dans les données de l'agenda
  (dates ISO 8601, voir § 6).
- Textes (`erreur`, `texte`) : en français, au tutoiement, à montrer tels quels à l'utilisateur.

## 0. Erreurs

Toute erreur a la forme :

```json
{ "ok": false, "code": "jeton_invalide", "erreur": "Ce Pégase n'est plus reconnu par Odin : reconnecte-toi." }
```

| HTTP | `code`              | Quand                                                                          | Que fait Pégase                       |
|------|---------------------|--------------------------------------------------------------------------------|----------------------------------------|
| 400  | `requete_invalide`  | corps illisible, champ manquant ou de mauvaise forme                           | montre `erreur`                        |
| 401  | `jeton_requis`      | pas d'en-tête `Authorization: Bearer …`                                        | écran de connexion                     |
| 401  | `jeton_invalide`    | jeton inconnu, ou appareil **révoqué** dans Odin                               | efface le jeton, écran de connexion    |
| 401  | `identifiants`      | e-mail ou mot de passe faux (`connexion`)                                      | montre `erreur`                        |
| 401  | `code_requis`       | la personne a la double authentification : renvoyer avec `code`               | montre le champ du code                |
| 403  | `pas_de_droit`      | la personne n'a pas le droit sur Pégase dans Persona (message clair)           | montre `erreur`, pas de nouvel essai   |
| 403  | `refuse`            | le profil n'a pas le droit (ex. `demander` pour un invité)                     | montre `erreur`                        |
| 403  | `demande_refusee`   | le propriétaire a refusé la création du profil                                 | montre `erreur`                        |
| 404  | `introuvable`       | route, copie ou collection inconnue                                            |                                        |
| 409  | `existe_deja`       | un profil a déjà cette adresse e-mail                                          | propose de se connecter                |
| 413  | `trop_gros`         | corps au-delà de la limite de la route                                         |                                        |
| 415  | `json_attendu`      | `POST` sans `content-type: application/json` (sauf `analyser`)                 |                                        |
| 429  | `trop_d_essais`     | freinage (mots de passe faux, demandes de profil) ; champ `attente` (secondes) et en-tête `retry-after` | attend `attente` s |
| 503  | `indisponible`      | la partie d'Odin nécessaire est arrêtée (applis, Asclépios, IA)                | réessaie plus tard                     |

## 1. Trouver Odin

### `GET /api/pegase/bonjour` (sans jeton)

```json
{ "odin": true, "nom": "Odin", "version": "1.24.1", "protocole": 1,
  "empreinte": "3f9a…64 caractères hexadécimaux minuscules…",
  "https": true, "dns": true, "comptes": true }
```

- `empreinte` : SHA-256 du certificat TLS d'Odin (forme DER), en hexadécimal **minuscule sans « : »** ; `null` si Odin est
  en http simple (essais, machine seule). Pégase l'épingle au premier contact puis refuse tout autre certificat.
  **Pégase compare toujours avec le certificat réellement présenté par la connexion TLS** (pas seulement avec ce champ).
  - Electron : `certificate.fingerprint` vaut `sha256/<base64>` → décoder le base64 en hexadécimal pour comparer ;
    Node : `X509Certificate.fingerprint256` sans les « : » et en minuscules.
  - Android : `MessageDigest.getInstance("SHA-256").digest(cert.encoded)` en hexadécimal minuscule.
- `dns` : le DNS chiffré de Sphinx tourne (`https://<odin>:<port>/dns-query`, voir § 5).
- `comptes` : la création de profils Pégase est possible (l'appli Pégase est démarrée dans Odin).

Recherche automatique (côté Pégase, rappel du contrat) : 127.0.0.1:7777, puis le /24 local sur 7777 et 7443,
32 requêtes en parallèle, 1,5 s max chacune, en `https` d'abord puis `http`. On garde la réponse qui a `odin: true`.

## 2. Profils, connexion, appareils (connexion unique d'Odin)

**Un profil Pégase est une personne de Persona** (les identités d'Odin, `src/valhalla/modules/var.ts`) : pas de second
fichier de comptes. Même e-mail, même mot de passe, même double authentification que partout ailleurs dans Odin
(voir le contrat SSO : `/home/claude/odin-wt/missions/sso-protocole.md` et `docs/sso-protocole.md` de l'agent sso-odin).

Un **profil** tel que le voit Pégase : `{ id, login, email, nom, groupes, role, voir }`.
- `id`, `login`, `nom`, `email`, `groupes` : ceux de la personne dans Persona.
- **Droit d'accès** : la personne doit avoir le droit sur l'appli `pegase` dans Persona (table « appli → groupes
  autorisés » du SSO, `ssoDroits` ; par défaut `famille`, `admin`, `invite` ; `*` = toute personne connectée,
  `@identifiant` = une personne précise ; le propriétaire et le groupe `admin` ont toujours accès). Sinon **403** `pas_de_droit`, avec un message à montrer tel quel
  (« Tu n'as pas accès à Pégase. Demande à Awa de t'ajouter au groupe famille. »). Le droit est revérifié à chaque requête :
  retiré dans Persona → 403 aussitôt (et le flux se ferme).
- `role` : `proprietaire` (groupe `admin`) ou `membre`.
- `voir` : ce qu'Odin (son IA, sa recherche, son journal) peut lire de ce profil : `tout`, `sans-historique`, `rien`.
  Par défaut : `tout` pour le groupe `admin`, `sans-historique` pour les autres (l'historique d'un proche reste privé tant
  qu'il ne l'a pas permis). La synchro, elle, marche toujours. (Préférence propre à Pégase, rangée à part.)

Un **appareil** : `{ id, nom, plateforme, cree, vu, revoque? }`. Un jeton par appareil.

### `POST /api/pegase/compte` : créer une personne depuis Pégase

```json
{ "email": "awa@exemple.yt", "nom": "Awa", "motdepasse": "…", "appareil": { "nom": "PC du salon", "plateforme": "windows" } }
```

- Crée **une personne de Persona** (identifiant tiré de l'e-mail, ex. `awa`, `awa2`… ; groupe `famille`), **avec l'accord du
  propriétaire d'Odin**, puis l'appareil et son jeton.
- `appareil.nom` : 1 à 60 caractères ; `appareil.plateforme` : `windows` | `mac` | `linux` | `android` | `autre`.
  (`appareil` peut aussi être une simple chaîne : c'est alors le nom.)
- Mot de passe : 10 caractères au moins, pas un mot de passe courant, pas proche du nom ou de l'e-mail. Sinon **400**
  `requete_invalide` avec la raison dans `erreur`.
- Odin calcule tout de suite l'empreinte scrypt (celle de Persona, sel aléatoire) ; le mot de passe n'est **jamais** écrit ni
  journalisé, même pendant l'attente.

Réponses :
- Requête faite avec la session du propriétaire d'Odin (cookie de son interface) ou la clé d'API d'Odin :
  `200 { "ok": true, "etat": "ok", "jeton": "pg1.…", "profil": {…}, "appareil": {…} }`.
- Sinon : `200 { "ok": true, "etat": "attente", "demande": "<secret, 48 hexa>", "code": "482913", "expire": 1763…000 }`.
  Le propriétaire est prévenu (Telegram et écrans d'Odin, comme `/api/pair`) avec le même `code` à 6 chiffres :
  Pégase l'affiche pour qu'il le reconnaisse. La demande expire au bout de 10 minutes.
  Au plus 3 demandes par adresse IP et par 10 minutes (**429** sinon).
- `409 existe_deja` si une personne de Persona a déjà cet e-mail (→ « connecte-toi »).

### `POST /api/pegase/compte/etat`

```json
{ "demande": "<le secret reçu>" }
```

→ `{ "ok": true, "etat": "attente" }` (redemander toutes les 2 s)
→ `{ "ok": true, "etat": "ok", "jeton": "pg1.…", "profil": {…}, "appareil": {…} }` (une seule fois : le jeton n'est rendu qu'à ce moment)
→ `{ "ok": false, "etat": "refus", "code": "demande_refusee", "erreur": "…" }` (HTTP 403)
→ `{ "ok": false, "etat": "inconnue", "code": "introuvable", "erreur": "…" }` (HTTP 404 : expirée ou déjà récupérée)

### `POST /api/pegase/connexion` : e-mail (ou identifiant) et mot de passe de Persona

```json
{ "email": "awa@exemple.yt", "motdepasse": "…", "code": "123456", "appareil": { "nom": "Téléphone d'Awa", "plateforme": "android" } }
```

→ `200 { "ok": true, "jeton": "pg1.…", "profil": { "id": "…", "login": "awa", "email": "…", "nom": "Awa", "groupes": ["admin"], "role": "proprietaire", "voir": "tout" }, "appareil": { "id": "a_…", "nom": "…" } }`

- `email` accepte aussi l'identifiant Persona (`awa`).
- Le propriétaire d'Odin (sa personne Persona est marquée « propriétaire » par le SSO) se connecte avec le mot de passe
  de son compte d'Odin : il n'a pas de second mot de passe.
- `code` : seulement si la personne a la double authentification. Sans lui : **401** `code_requis`
  (« Tape le code à 6 chiffres de ton appli d'authentification. ») — Pégase montre alors le champ du code et renvoie tout.
- Vérification scrypt côté Odin, comparaison en temps constant ; un e-mail inconnu coûte le même temps.
- Mauvais mot de passe : **401** `identifiants` (« Adresse e-mail ou mot de passe incorrect. »), sans dire lequel.
  Compte coupé dans Persona : même réponse.
- Pas le droit sur Pégase : **403** `pas_de_droit` (message à montrer tel quel).
- Freinage : celui de Persona (compte verrouillé 15 minutes après 5 essais ratés) et un freinage par adresse IP ;
  **429** `trop_d_essais` avec `attente` (secondes) et l'en-tête `retry-after`. Les échecs comptent aussi dans le
  freinage général d'Odin (par adresse IP, sauf la machine elle-même).
- Une connexion depuis un nouvel appareil crée un nouvel appareil (et une alerte « nouvel appareil » dans Forseti).

### Connexion unique du poste (SSO)

Si Pégase trouve dans le coffre du système un jeton de poste d'Odin (« Odin SSO <adresse d'Odin> », voir le contrat SSO),
il l'échange contre un jeton d'appli (`POST /sso/echange { jeton_poste, appli: "pegase" }`) et l'utilise **à la place** du
jeton `pg1.` : `Authorization: Bearer <jeton d'appli SSO>`. Toutes les routes ci-dessous acceptent les deux.
Avec un jeton SSO, Pégase envoie aussi l'en-tête `x-pegase-appareil: <nom de l'appareil>` (1 à 60 caractères) la première
fois : Odin crée l'appareil (son `id` est stable pour une même session de poste). Un jeton SSO expiré → **401**
`jeton_invalide` : Pégase le renouvelle par le SSO, puis, en dernier recours, montre l'écran de connexion.

### Le jeton

- Forme : `pg1.<idAppareil>.<secret>` (texte ASCII, ~60 caractères). Odin n'en garde que le SHA-256.
  (Ou un jeton d'appli SSO, voir ci-dessus : Odin les distingue tout seul.)
- Envoyé sur **toutes** les autres routes : `Authorization: Bearer pg1.…`.
- Pas d'expiration ; révocable dans l'appli Pégase d'Odin (ou par `POST /api/pegase/deconnexion`). Révoqué → **401**
  `jeton_invalide` partout, et le flux ouvert reçoit `event: revoque` puis se ferme.
- Côté Pégase : chiffré par le système (Electron `safeStorage`, Android Keystore), jamais dans un journal.

### `GET /api/pegase/moi`

→ `{ "ok": true, "profil": {…}, "appareil": {…}, "appareils": [ { "id", "nom", "plateforme", "cree", "vu", "enLigne": true } ] }`

### `POST /api/pegase/moi`

`{ "voir": "tout" | "sans-historique" | "rien" }` → `{ "ok": true, "profil": {…} }` (le nom aussi : `{ "nom": "…" }`).

### `POST /api/pegase/deconnexion`

`{}` → `{ "ok": true }` : révoque le jeton de cet appareil.

## 3. Synchro en temps réel

### Collections

`profil`, `favoris`, `onglets`, `espaces`, `bureaux`, `historique`, `agenda`, `reglages`, `telechargements`.
Toute autre valeur de `col` est refusée. **Jamais** synchronisés : cookies, cache, fenêtres privées, mots de passe.

### Un enregistrement

```json
{ "id": "f-7b1c…", "col": "favoris", "data": { "url": "https://…", "titre": "…" }, "maj": 1763112000123, "appareil": "a_9f…", "suppr": true }
```

- `id` : 1 à 200 caractères parmi `A-Z a-z 0-9 . _ : @ -` ; unique dans la collection. Pégase le crée (UUID conseillé).
- `data` : un objet JSON de 64 Ko au plus (absent ou `{}` si `suppr`).
- `maj` : date de la modification (ms), donnée par l'appareil. Refusée si plus de 10 minutes dans le futur (horloge fausse).
- `appareil` : **Odin le remplace** par l'identifiant de l'appareil du jeton (on ne parle pas au nom d'un autre).
  Les changements faits par Odin lui-même (restauration) portent `appareil: "odin"`.
- `suppr: true` : l'enregistrement est supprimé (on garde cette « pierre tombale » pour que tous les appareils l'apprennent).
- **Conflit** : le `maj` le plus grand gagne ; à `maj` égal, l'`appareil` le plus petit (comparaison de chaînes) gagne.
  Une version perdante est ignorée.

Formes conseillées de `data` (Odin lit ces champs ; les autres sont gardés tels quels) :

| `col`             | `data`                                                                                          |
|-------------------|--------------------------------------------------------------------------------------------------|
| `historique`      | `{ url, titre, date (ms, visite), duree (s), recherche? (texte cherché), moteur? }`              |
| `favoris`         | `{ url, titre, dossier?, ordre? }`                                                               |
| `onglets`         | `{ url, titre, espace?, epingle?, ordre? }`                                                      |
| `agenda`          | `{ titre, debut, fin, lieu?, agenda?, rappel? (minutes avant), couleur?, notes? }` (voir § 6)    |
| `telechargements` | `{ nom, url, taille, sha256, date (ms), verdict? ('sain'|'douteux'|'bloque'|'inconnu') }`        |
| `reglages`        | `{ valeur }` (id = nom du réglage)                                                               |

`historique` est un **journal d'ajouts** : on y ajoute des visites (et au besoin des pierres tombales pour effacer).
Odin le range par jour (jour de `data.date`, sinon de `maj`, en heure locale d'Odin).

### `POST /api/pegase/envoyer`

Envoyer dès qu'un changement a lieu, regroupés au plus 250 ms. Hors ligne : file sur le disque, vidée au retour.

```json
{ "changements": [ { "id": "f-1", "col": "favoris", "data": { "url": "https://mayotte.fr", "titre": "Mayotte" }, "maj": 1763112000123 } ] }
```

- 1 000 changements et 2 Mo au plus par envoi (**413** sinon).
- Réponse :

```json
{ "ok": true, "serveur": 1763112000200, "appliques": 1,
  "ignores":  [ { "id": "f-2", "col": "favoris", "raison": "plus ancien" } ],
  "refuses":  [ { "id": "x", "col": "favoris", "raison": "identifiant invalide" } ],
  "gagnants": [ { …l'enregistrement qu'Odin garde, pour chaque « ignoré »… } ] }
```

Pégase applique tout de suite les `gagnants` chez lui. Renvoyer un même changement est sans effet (idempotent).

### `GET /api/pegase/flux` (Server-Sent Events)

En-tête `Authorization: Bearer …` (pas de jeton dans l'adresse ; dans Electron, ouvrir le flux depuis le processus
principal avec `fetch`/`net`, pas avec `EventSource`). Réponse `text/event-stream` :

```
event: bonjour
data: {"profil":"p_…","appareil":"a_…","serveur":1763112000000}

event: changements
data: {"changements":[{"id":"f-1","col":"favoris","data":{…},"maj":1763112000123,"appareil":"a_autre"}]}

event: verif
data: {"serveur":1763112030000,"empreintes":{"favoris":{"n":12,"hash":"…"},…}}

event: restaure
data: {"copie":"2026-11-13","texte":"Les données ont été remises comme le 13/11/2026."}

event: revoque
data: {"texte":"Cet appareil a été déconnecté depuis Odin."}
```

- `changements` : chaque changement accepté venant d'un **autre** appareil du même profil (ou d'Odin), aussitôt (moins
  d'une seconde). Les changements de l'appareil lui-même ne lui sont pas renvoyés.
- `verif` : toutes les 30 s, avec les empreintes de toutes les collections (même forme que `GET empreintes`).
  Il sert aussi de signe de vie : sans `verif` depuis 70 s, Pégase rouvre le flux.
- `restaure` : une copie vient d'être remise ; tous les enregistrements changés arrivent aussi en `changements`.
- `revoque` : le flux se ferme juste après ; Pégase oublie le jeton.

### `GET /api/pegase/empreintes`

```json
{ "profil": { "n": 1, "hash": "…" }, "favoris": { "n": 12, "hash": "…" }, "onglets": { … }, "espaces": { … },
  "bureaux": { … }, "historique": { … }, "agenda": { … }, "reglages": { … }, "telechargements": { … } }
```

Les 9 collections sont toujours présentes. Calcul (identique des deux côtés) :
1. prendre **tous** les enregistrements de la collection, pierres tombales (`suppr`) comprises ;
2. faire une ligne `id + ":" + maj` pour chacun (`maj` en entier décimal) ;
3. trier les lignes par ordre des codes (tri JavaScript par défaut / `String.compareTo` en Java-Kotlin) ;
4. les joindre avec `"\n"` (pas de `\n` final), encoder en UTF-8, SHA-256, hexadécimal minuscule.
`n` = nombre d'enregistrements (pierres tombales comprises). Collection vide : `n = 0`,
`hash = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (SHA-256 de rien).

Exemple : `a:2` et `b:10` → texte `"a:2\nb:10"` → hash de cette chaîne.

### `POST /api/pegase/tirer`

```json
{ "col": "favoris", "depuis": 1763100000000, "limite": 5000 }
```

→ `{ "ok": true, "col": "favoris", "changements": [ … ], "complet": true, "suite": null, "serveur": 1763112000300 }`

- Sans `depuis` : toute la collection. Avec `depuis` : les enregistrements dont `maj >= depuis`.
- Triés par `maj` croissant puis `id`. `limite` : 5 000 par défaut, 20 000 au plus. Si `complet` vaut `false`,
  redemander avec `depuis = suite` (doublons possibles à la frontière : ils sont sans effet).
- Pégase compare ensuite avec ce qu'il a et **renvoie par `envoyer`** ce qu'Odin n'a pas (ou a en plus ancien).
- Indicateur dans Pégase : « Odin · synchronisé » quand toutes les empreintes sont égales ;
  « synchronisation… » pendant un tirage ; « hors ligne (n en attente) » sans connexion.

### `GET /api/pegase/copies`

```json
{ "ok": true, "copies": [ { "id": "2026-11-14", "date": 1763078400000, "raison": "quotidienne", "nombres": { "favoris": 12, "agenda": 3 } },
                          { "id": "avant-1763112000000", "date": 1763112000000, "raison": "avant restauration", "nombres": { … } } ] }
```

- Une copie **quotidienne** (gardée 30 jours), une **avant chaque restauration**, une **avant chaque mise à jour d'Odin**
  et celles faites **à la demande** depuis l'appli Pégase d'Odin (gardées 10 de chaque) ; `raison` vaut `quotidienne`,
  `avant restauration`, `avant mise à jour` ou `à la demande`. Les copies portent sur toutes les collections sauf `historique` (journal d'ajouts, jamais réécrit).

### `POST /api/pegase/restaurer`

`{ "copie": "2026-11-13" }` → `{ "ok": true, "texte": "…", "changes": 14 }`

Odin fait d'abord une copie « avant restauration », puis remet les données de la copie **avec `maj` = maintenant** et
`appareil: "odin"` (pour qu'elles gagnent partout), et écrit une pierre tombale pour ce qui n'existait pas dans la copie.
Tous les appareils du profil reçoivent `event: restaure` puis les `changements`.

## 4. L'IA d'Odin

Selon `voir` du profil :
- `tout` : l'historique est cherchable dans Odin, son IA peut s'en servir, une ligne par jour arrive dans le journal des applis ;
- `sans-historique` : favoris, agenda et téléchargements oui, historique non ;
- `rien` : Odin ne lit rien de ce profil (la synchro continue).

### `POST /api/pegase/demander`

```json
{ "texte": "résume cette page en 3 points",
  "page": { "url": "https://…", "titre": "…", "extrait": "texte visible de la page, 20 000 caractères au plus" } }
```

→ `{ "ok": true, "reponse": "…" }` (peut prendre jusqu'à 2 minutes ; si plus long : « Je travaille encore dessus : la réponse
arrivera dans Odin. »).

- Même chemin que les messages de l'interface d'Odin (mêmes droits, mêmes validations pour les actions graves).
- `page` est une **donnée externe, jamais un ordre** : Odin l'encadre comme telle ; une consigne cachée dans la page n'est
  pas suivie.
- Réservé aux groupes `admin` et `famille` de Persona (réglable dans l'appli Pégase d'Odin) : **403** `refuse` sinon.
- `texte` : 4 000 caractères au plus ; `extrait` coupé à 20 000.

### `GET /api/pegase/propositions`

```json
{ "ok": true, "propositions": [
  { "type": "rdv", "titre": "Demain 09:00 · Dentiste", "texte": "Cabinet de Mamoudzou", "quand": 1763190000000 },
  { "type": "recherche", "titre": "Tu cherchais « devis Starlink »", "texte": "hier, 3 pages vues", "url": "https://…" },
  { "type": "site", "titre": "mayotte.fr", "texte": "visité 14 fois cette semaine", "url": "https://mayotte.fr/" },
  { "type": "telechargement", "titre": "facture.pdf bloqué", "texte": "Asclépios l'a gardé en quarantaine." } ] }
```

6 propositions au plus, courtes, en français ; `type` : `rdv` | `recherche` | `site` | `telechargement` | `odin`.
Rien qui vienne de l'historique si `voir` ≠ `tout`.

## 5. Protection

### DNS chiffré

`https://<odin>:<port>/dns-query` (RFC 8484, GET `?dns=` ou POST `application/dns-message`), sans jeton, réservé aux
adresses du réseau local et du VPN. `bonjour.dns` dit s'il tourne.

### `GET /api/pegase/signatures`

`?version=<n>` facultatif.
→ `{ "ok": true, "version": 12, "n": 2, "empreintes": [ "275a021b…", "…" ] }` (SHA-256 des fichiers malveillants
connus d'Asclépios, hexadécimal minuscule, triées).
→ `{ "ok": true, "version": 12, "inchange": true }` si Pégase a déjà cette version.
La version 0 = règles de base seulement (liste souvent courte). Une empreinte absente ne veut pas dire « sain ».

### `POST /api/pegase/analyser`

Seulement si l'utilisateur l'a autorisé dans Pégase. Corps = **le fichier brut** :
`content-type: application/octet-stream`, en-tête `x-nom: <nom du fichier encodé avec encodeURIComponent>`.
200 Mo au plus (**413** sinon).

→ `{ "ok": true, "verdict": "bloque", "niveau": "critique", "menaces": [ "EICAR-Test-File" ], "sha256": "…", "texte": "…" }`

- `verdict` : `sain` (rien trouvé — jamais une garantie), `douteux` (à regarder), `bloque` (ne pas ouvrir).
- La copie envoyée est analysée par Asclépios puis **effacée** d'Odin.
- Un verdict `bloque` crée une alerte « fichier bloqué » dans Forseti.

### `POST /api/pegase/adresse`

`{ "url": "https://…" }` → `{ "ok": true, "verdict": "sur" | "douteux" | "dangereux", "score": 0, "texte": "…" }`
(l'action `adresse` d'Asclépios ; `sur` veut dire « rien de connu », jamais une garantie).

## 6. Agenda

Données d'un rendez-vous (`col: "agenda"`) :

```json
{ "titre": "Dentiste", "debut": "2026-11-20T09:00:00+03:00", "fin": "2026-11-20T09:30:00+03:00",
  "lieu": "Mamoudzou", "agenda": "Perso", "rappel": 30, "couleur": "#3b82f6", "notes": "…" }
```

- `debut`/`fin` : ISO 8601 avec décalage horaire ; journée entière = date seule (`"2026-11-20"`, `fin` exclue comme en iCalendar).
- `rappel` : minutes avant le début (facultatif).

### `GET /api/pegase/agenda.ics`

- Avec `Authorization: Bearer …`, **ou** `?cle=<clé d'abonnement>` (les applis d'agenda ne savent pas envoyer d'en-tête).
- Réponse `text/calendar; charset=utf-8`, iCalendar RFC 5545 : `VCALENDAR` (`PRODID:-//TOUFATECH//Odin Pegase//FR`,
  `VERSION:2.0`, `X-WR-CALNAME`), un `VEVENT` par rendez-vous (`UID` = `<id>@pegase.odin`, `DTSTAMP`, `DTSTART`/`DTEND`
  en UTC ou `VALUE=DATE`, `SUMMARY`, `LOCATION`, `DESCRIPTION`, `CATEGORIES`, `VALARM` si `rappel`), lignes en CRLF
  pliées à 75 octets, caractères spéciaux échappés.

### `POST /api/pegase/agenda/lien`

`{}` → `{ "ok": true, "url": "https://<odin>/api/pegase/agenda.ics?cle=…" }` : crée (ou rend) la clé d'abonnement du
profil, en **lecture seule de l'agenda uniquement**. `{ "nouvelle": true }` en crée une autre (l'ancienne ne marche plus).

## 7. Côté Odin (pour information)

- Les personnes (nom, e-mail, mot de passe haché, groupes, droits) restent dans Persona.
- Données : `~/.odin/valhalla/pegase/` — `profils.json` (préférences `voir` par personne), `appareils.json` (empreintes des jetons seulement),
  `p/<profil>/<col>.json`, `p/<profil>/historique/AAAA-MM-JJ.jsonl`, `p/<profil>/copies/`. Écritures atomiques.
  Ces fichiers sont bloqués pour les outils de fichiers d'Odin (liste `SECRET_FILES`).
- La sauvegarde complète d'une appli (`/api/sauvegardes/<appli>`, contrat SSO § 4) est faite par sso-odin ; pour
  Pégase, la synchro ci-dessus garde déjà tout ce qui compte (favoris, téléchargements, réglages…) et la restauration
  d'une nouvelle installation se fait en se connectant puis en tirant chaque collection (`tirer` sans `depuis`).
- L'appli « Pégase » d'Odin : profils, appareils (révoquer), état de la synchro par appareil, historique cherchable par
  jour, réglage de ce qu'Odin peut voir, copies et restauration, téléchargements de Pégase.
