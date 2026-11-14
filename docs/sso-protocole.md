# Connexion unique (SSO) d'Odin et sauvegarde des applis : le protocole précis

Ce fichier précise, sans le contredire, le contrat `missions/sso-protocole.md`. **C'est lui qui fait foi** pour Odin, Pégase
(ordinateur et téléphone) et Vénus. Version du protocole : **1**.

- Tout passe par le port de l'interface d'Odin (par défaut `https://<ip>:7777`, certificat souvent auto-signé : voir § 9).
- OpenID Connect « standard » (code d'autorisation + PKCE) pour les pages web et les applis qui ouvrent un navigateur ;
  routes propres à Odin (`/sso/connexion`, `/sso/poste`, `/sso/echange`, `/sso/revoquer`) pour les programmes du poste.
- Dates : **millisecondes depuis 1970 (UTC)** dans les réponses JSON d'Odin ; **secondes** dans les jetons JWT (`exp`, `iat`)
  et `expires_in` (norme OAuth).
- Textes (`message`, `error_description`) : en français, au tutoiement, **à montrer tels quels** à l'utilisateur.
- Bibliothèque cliente prête à copier (Node 18+, Electron, sans dépendance) : `clients/odin-sso.mjs` (§ 10).

## 0. Erreurs

Routes propres à Odin (`/sso/connexion`, `/sso/poste`, `/sso/echange`, `/sso/revoquer`, `/sso/infos`, `/api/sauvegardes/…`) :

```json
{ "ok": false, "code": "refuse", "message": "Tu n'as pas accès à Vénus. Demande à Awa de t'ajouter au groupe famille." }
```

| HTTP | `code`                 | Quand                                                                              | Que fait l'appli                         |
|------|------------------------|------------------------------------------------------------------------------------|------------------------------------------|
| 400  | `requete_invalide`     | corps illisible, champ manquant ou de mauvaise forme                               | montre `message`                         |
| 400  | `empreinte_fausse`     | sauvegarde : le SHA-256 reçu ne correspond pas au contenu                          | renvoie la sauvegarde                    |
| 401  | `identifiants`         | identifiant (e-mail) ou mot de passe faux                                          | montre `message`                         |
| 401  | `code_requis`          | la personne a la double authentification : renvoyer avec `code` (6 chiffres)       | demande le code                          |
| 401  | `code_faux`            | code de double authentification faux                                               | redemande mot de passe **et** code       |
| 401  | `jeton_requis`         | pas d'en-tête `Authorization: Bearer …`                                            | connexion                                |
| 401  | `jeton_invalide`       | jeton d'accès expiré, mal signé ou session révoquée                                | renouvelle (§ 4) ; sinon connexion       |
| 401  | `jeton_poste_invalide` | jeton du poste inconnu, révoqué, expiré, ou présenté par un autre appareil / utilisateur du système | **efface le coffre**, connexion |
| 403  | `refuse`               | la personne n'a pas le droit d'utiliser cette appli                                | montre `message` (rien d'autre)          |
| 403  | `double_auth_a_regler` | son groupe exige la double authentification et elle ne l'a pas encore              | montre `message`                         |
| 403  | `mauvaise_appli`       | jeton d'une autre appli (ex. jeton Pégase sur `/api/sauvegardes/venus`)            | échange (§ 6) ou connexion               |
| 404  | `appli_inconnue`       | `appli` n'est pas une appli cliente déclarée dans Persona                          | montre `message`                         |
| 404  | `introuvable`          | version de sauvegarde inconnue                                                     |                                          |
| 413  | `trop_gros`            | sauvegarde au-delà de la taille maximale (champ `limite`, en octets)               | montre `message`                         |
| 415  | `json_attendu`         | `POST` JSON sans `content-type: application/json`                                  |                                          |
| 423  | `verrouille`           | compte verrouillé après 5 essais ratés (15 min) ; champ `attente` (secondes)       | montre `message`                         |
| 429  | `trop_d_essais`        | freinage par adresse IP ; champ `attente` (secondes) et en-tête `retry-after`      | attend `attente` s                       |
| 503  | `indisponible`         | les applis d'Odin (Persona) ne tournent pas, ou la clé du coffre manque            | réessaie plus tard                       |

`/sso/jeton` répond aux erreurs **à la norme OAuth** (RFC 6749 § 5.2), avec en plus le texte français :

```json
{ "error": "invalid_grant", "error_description": "Ce code a déjà servi ou il a expiré : recommence la connexion.", "message": "Ce code a déjà servi ou il a expiré : recommence la connexion." }
```

`/sso/autoriser` renvoie ses erreurs **à l'adresse de retour** (`?error=…&error_description=…&state=…&iss=…`), sauf quand
l'appli ou l'adresse de retour est inconnue : Odin montre alors une page d'erreur et ne renvoie nulle part (§ 3).

## 1. Identités et droits (Persona, dans Odin)

- Une **personne** de Persona : `sub` (identifiant stable, 10 caractères hexadécimaux, ne change jamais), `preferred_username`
  (identifiant de connexion, ex. `awa`), `name`, `email` (facultatif), `groups` (ex. `["famille"]`).
- On se connecte avec son **identifiant** Persona **ou son adresse e-mail** (le champ s'appelle `identifiant`).
- Le **propriétaire d'Odin** est une personne de Persona du groupe `admin` (créée toute seule à sa première connexion SSO,
  `preferred_username` = `proprietaire`, son e-mail et son nom sont ceux du compte d'Odin). Son mot de passe reste celui du
  compte d'Odin (pas de second mot de passe). Il a toujours accès à toutes les applis (on ne peut pas s'enfermer dehors).
- **Droits par appli** (page Persona → onglet « Accès », cases à cocher par groupe et par personne ; ou par commande
  « donne l'accès à Vénus au groupe famille ») : une table appli → groupes, pour **toutes** les applis : les applis
  clientes (Pégase, Vénus…) **et** les applis d'Odin (Cerbère, Hermès…). Valeurs de départ :
  `odin: famille, admin` (entrer dans l'interface d'Odin) · `pegase: famille, admin, invite` · `venus: famille, admin` ·
  toute autre appli d'Odin : `admin` seulement. `*` = toute personne connectée ; `@identifiant` = une personne précise.
  L'appli Vénus d'Odin (`freyja`) suit le droit de `venus`. Le groupe `admin` a toujours tout (§ 12).
- Refus : `403 refuse` avec le message à afficher tel quel, de la forme
  « Tu n'as pas accès à Vénus. Demande à Awa de t'ajouter au groupe famille. » (Awa = prénom du propriétaire ; le groupe
  proposé est le premier groupe autorisé qui n'est pas `admin`).
- **Applis clientes** (onglet « Applis ») : `{ id, nom, retours: [adresses de retour], module }`. Préinscrites :

| `id`     | `nom`  | adresses de retour préinscrites                                                                       |
|----------|--------|--------------------------------------------------------------------------------------------------------|
| `pegase` | Pégase | `http://127.0.0.1/sso/retour`, `http://[::1]/sso/retour`, `pegase://sso/retour`                        |
| `venus`  | Vénus  | `http://127.0.0.1/sso/retour`, `http://[::1]/sso/retour`, et `<adresse de Vénus>/auth/odin/retour` si Vénus est relié à Odin (appli Vénus d'Odin) |
| `odin`   | Odin   | son interface elle-même (§ 12), adresse de retour `<issuer>/sso/odin/retour` seulement |

  - Comparaison **exacte** de l'adresse de retour, sauf pour `http://127.0.0.1`, `http://[::1]` et `http://localhost` déclarés
    **sans port** : n'importe quel port est accepté (RFC 8252 § 7.3, programmes qui écoutent sur un port libre).
  - Vénus dans le navigateur : son adresse de retour est **`<origine de Vénus>/auth/odin/retour`** (ex.
    `http://192.168.1.20:8096/auth/odin/retour`). Si Vénus est servi à une autre adresse, le propriétaire l'ajoute dans
    Persona → Applis → « Ajouter une adresse de retour ».
  - Applis « publiques » (pas de secret client, RFC 8252) : la preuve, c'est PKCE.

## 2. Découverte

`GET /.well-known/openid-configuration` (sans connexion) :

```json
{
  "issuer": "https://192.168.1.10:7777",
  "authorization_endpoint": "https://192.168.1.10:7777/sso/autoriser",
  "token_endpoint": "https://192.168.1.10:7777/sso/jeton",
  "userinfo_endpoint": "https://192.168.1.10:7777/sso/infos",
  "jwks_uri": "https://192.168.1.10:7777/sso/cles",
  "end_session_endpoint": "https://192.168.1.10:7777/sso/deconnexion",
  "revocation_endpoint": "https://192.168.1.10:7777/sso/revoquer",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["ES256"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["openid", "profile", "email", "groups", "offline_access"],
  "claims_supported": ["sub", "name", "preferred_username", "email", "groups", "applis", "nonce", "auth_time", "sid"],
  "authorization_response_iss_parameter_supported": true,
  "odin": { "protocole": 1, "nom": "Odin", "version": "1.24.1", "connexion": "…/sso/connexion", "poste": "…/sso/poste",
            "echange": "…/sso/echange", "sauvegardes": "…/api/sauvegardes/" }
}
```

- `issuer` = l'adresse par laquelle **tu** as joint Odin (schéma + hôte + port, sans `/` final). Odin peut être joint par
  plusieurs adresses (IP locale, nom) : garde celle de la découverte et compare `iss` des jetons à **elle**.
- Trouver Odin sur le réseau : `127.0.0.1:7777`, puis le /24 local sur les ports 7777 et 7443, `https` puis `http`,
  32 requêtes en parallèle, 1,5 s max chacune ; on garde les réponses qui ont `odin.protocole`. (Pégase peut aussi utiliser
  `GET /api/pegase/bonjour`.)

## 3. Connexion par le navigateur : `GET /sso/autoriser` (code + PKCE obligatoire)

```
GET /sso/autoriser?response_type=code&client_id=venus
   &redirect_uri=http%3A%2F%2F192.168.1.20%3A8096%2Fauth%2Fodin%2Fretour
   &scope=openid%20profile%20email%20groups%20offline_access
   &state=<aléatoire, 16 octets ou plus>&nonce=<aléatoire>
   &code_challenge=<BASE64URL(SHA256(code_verifier))>&code_challenge_method=S256
   [&prompt=none|login] [&login_hint=awa]
```

| Paramètre               | Règle                                                                                        |
|-------------------------|-----------------------------------------------------------------------------------------------|
| `client_id`             | une appli cliente déclarée (§ 1), sinon page d'erreur (pas de renvoi)                         |
| `redirect_uri`          | déclarée pour cette appli (§ 1), sinon page d'erreur « adresse de retour non déclarée »      |
| `response_type`         | `code` seulement (sinon `unsupported_response_type`)                                          |
| `scope`                 | doit contenir `openid` (sinon `invalid_scope`)                                                 |
| `state`                 | **obligatoire**, 8 à 512 caractères (sinon `invalid_request`). L'appli **doit** vérifier qu'il revient identique |
| `nonce`                 | conseillé (≤ 512 caractères), recopié dans le jeton d'identité                               |
| `code_challenge`        | **obligatoire**, 43 caractères base64url (sinon `invalid_request` « PKCE obligatoire »)       |
| `code_challenge_method` | `S256` seulement (`plain` refusé : `invalid_request`)                                          |
| `prompt`                | `none` : jamais d'écran (sans session → `login_required`) ; `login` : redemande le mot de passe |

Déroulé :
1. Le navigateur a déjà une session Odin (le **compte du propriétaire** ouvert dans l'interface d'Odin, ou une session
   Persona sur Odin) → **pas d'écran** : vérification du droit, puis renvoi immédiat.
2. Sinon : le **portail Persona** (mascotte d'Odin) « Connexion à Vénus avec ton compte Odin » : identifiant ou e-mail,
   mot de passe, puis le code à 6 chiffres si la personne a la double authentification. Le formulaire est envoyé en
   `POST /sso/autoriser` (même origine ; le mot de passe ne quitte jamais Odin, il n'est ni écrit ni journalisé).
   Une session Persona est ouverte pour ce navigateur (cookie `odin_var`, `HttpOnly`, `SameSite=Lax`, chemin `/sso`) :
   les applis suivantes se connectent sans écran.
3. Réussite : `303` vers `redirect_uri?code=<code>&state=<state>&iss=<issuer>`.
   Le code vaut **60 secondes**, **une seule fois** (un second usage révoque les jetons déjà donnés pour ce code).
4. Pas le droit : `303` vers `redirect_uri?error=access_denied&error_description=<message français>&state=…&iss=…`
   → l'appli montre `error_description` tel quel.

Le journal des connexions de Persona garde chaque essai (réussi, refusé, pas le droit), avec l'appli et l'adresse IP.
Freinage : 20 essais ratés par adresse IP en 10 minutes → 429 ; 5 essais ratés pour une personne → compte verrouillé
15 minutes, alerte, et l'adresse bannie une heure par Cerbère (comme le portail Persona).

## 4. Jetons : `POST /sso/jeton`

`content-type: application/x-www-form-urlencoded` (norme) **ou** `application/json`. Pas de secret client.

**Code → jetons**

```
grant_type=authorization_code&code=…&redirect_uri=<la même>&client_id=venus&code_verifier=<43 à 128 caractères>
[&appareil=<id de l'appareil>&appareil_nom=PC%20du%20salon&plateforme=windows]
```

**Renouvellement** (rotation : chaque jeton de renouvellement ne sert **qu'une fois**)

```
grant_type=refresh_token&refresh_token=odr1.…&client_id=venus[&appareil=<le même id qu'à la connexion>]
```

Réponse `200` (en-têtes `cache-control: no-store`, `pragma: no-cache`) :

```json
{ "access_token": "eyJhbGciOiJFUzI1NiIs…", "token_type": "Bearer", "expires_in": 900,
  "id_token": "eyJhbGciOiJFUzI1NiIs…", "refresh_token": "odr1.k3v9x2m7aq.Xy…43 caractères",
  "scope": "openid profile email groups offline_access" }
```

Erreurs (`400` sauf mention) : `invalid_request` (champ manquant), `invalid_client` (appli inconnue, `401`),
`invalid_grant` (code inconnu, expiré, déjà servi, autre `redirect_uri`, **`code_verifier` faux**, jeton de renouvellement
révoqué / expiré / déjà servi / présenté par un autre appareil), `unsupported_grant_type`, `access_denied` (`403`, le droit
a été retiré depuis : `message` à montrer).

Règles des jetons :
- **Jeton d'accès** : JWT signé **ES256**, valable **15 minutes** (`expires_in: 900`).
- **Jeton de renouvellement** : `odr1.<idSession>.<secret>` (opaque, ASCII, ~60 caractères ; Odin n'en garde que le SHA-256).
  Valable 30 jours sans servir, 180 jours au plus. **Lié à l'appareil** : l'`appareil` donné à la connexion doit être redonné
  à chaque renouvellement. **Rotation** : chaque renouvellement rend un nouveau jeton ; présenter un ancien jeton déjà
  remplacé = vol probable → la session entière est révoquée (`invalid_grant`).
- Révocable à tout moment (Persona → Applis → « Appareils connectés », `/sso/revoquer`, `/sso/deconnexion`, compte coupé,
  nouveau mot de passe, personne retirée). Une session révoquée rend tout de suite `jeton_invalide` sur les routes d'Odin
  (`/sso/infos`, `/api/sauvegardes`). Une appli qui vérifie le JWT **elle-même** (clé publique) peut l'accepter jusqu'à son
  expiration (15 min au plus) : pour une action sensible, appelle `/sso/infos`.
- `appareil` : identifiant choisi par l'appli **une fois par installation** (8 à 64 caractères `A-Z a-z 0-9 _ -`, ex. un
  UUID), gardé avec ses jetons. `plateforme` : `windows` | `mac` | `linux` | `android` | `web` | `autre`.

### Format des jetons JWT (JWS compact, RFC 7515/7519)

En-tête : `{ "alg": "ES256", "typ": "at+jwt" | "JWT", "kid": "<empreinte de la clé>" }` (`at+jwt` pour le jeton d'accès,
RFC 9068 ; `JWT` pour le jeton d'identité). Signature : ECDSA P-256 + SHA-256, **64 octets bruts `r‖s`** (pas DER),
en base64url.

Jeton d'accès :

```json
{ "iss": "https://192.168.1.10:7777", "sub": "a41f0c9e2b", "aud": "venus", "client_id": "venus",
  "iat": 1763125200, "exp": 1763126100, "jti": "…", "sid": "k3v9x2m7aq", "scope": "openid profile email groups",
  "preferred_username": "awa", "name": "Awa Saïd", "groups": ["famille"] }
```

Jeton d'identité : `iss`, `sub`, `aud` (= `client_id`), `iat`, `exp` (15 min), `auth_time`, `nonce` (s'il a été donné),
`sid`, `name`, `preferred_username`, `email` (si connu), `groups`.

À vérifier côté appli (dans cet ordre) : `alg` = `ES256` (refuse tout autre, surtout `none`) ; la clé `kid` de `/sso/cles` ;
la signature ; `iss` = l'`issuer` de la découverte ; `aud` = ton `client_id` ; `exp` > maintenant (tolérance 60 s) ;
`nonce` = celui envoyé (jeton d'identité).

## 5. Infos, clés, déconnexion

- `GET /sso/infos` (ou `POST`), `Authorization: Bearer <jeton d'accès>` →
  `{ "sub", "preferred_username", "name", "email", "groups": [...], "applis": ["pegase", "venus"], "appli": "venus" }`
  (`applis` : celles que la personne a le droit d'ouvrir). Jeton absent / faux / révoqué : `401` avec
  `www-authenticate: Bearer error="invalid_token"` et `{ ok: false, code: "jeton_invalide", message }`.
- `GET /sso/cles` → `{ "keys": [ { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "…", "use": "sig", "alg": "ES256" } ] }`
  (cache 5 minutes au plus ; un `kid` inconnu → relire les clés une fois). La clé privée ne quitte jamais Odin (chiffrée sur
  son disque avec la clé du coffre).
- `GET|POST /sso/deconnexion?id_token_hint=…&post_logout_redirect_uri=…&state=…&client_id=…` (navigateur) : ferme la
  session Persona de ce navigateur sur Odin, révoque la session `sid` du jeton d'identité, puis renvoie vers
  `post_logout_redirect_uri` (seulement si elle est déclarée pour l'appli ; sinon une page « Tu es déconnecté »). La session
  de l'**interface** d'Odin du propriétaire n'est pas fermée.
- `POST /sso/deconnexion` avec `Authorization: Bearer <jeton d'accès>` (programme) → `{ "ok": true }` : révoque cette session.

## 6. SSO du poste

Le premier programme qui se connecte sur un poste ouvre une **session de poste** ; les autres programmes **du même
utilisateur du système** l'échangent contre leurs propres jetons, sans mot de passe.

### `POST /sso/connexion` (identifiant + mot de passe tapés dans l'appli : réglages de Vénus, premier écran de Pégase)

```json
{ "identifiant": "awa@exemple.yt", "motdepasse": "…", "code": "123456",
  "appli": "venus", "appareil": { "id": "6f1c…", "nom": "Serveur Vénus", "plateforme": "linux" } }
```

`code` : seulement si la réponse précédente était `401 code_requis`. Réponse `200` :

```json
{ "ok": true, "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 900, "id_token": "eyJ…",
  "refresh_token": "odr1.…", "scope": "openid profile email groups offline_access",
  "personne": { "sub": "a41f0c9e2b", "preferred_username": "awa", "name": "Awa Saïd", "email": "awa@exemple.yt", "groups": ["famille"] },
  "appli": "venus", "applis": ["pegase", "venus"] }
```

Erreurs : `401 identifiants` (« Identifiant ou mot de passe incorrect. », sans dire lequel), `401 code_requis`,
`401 code_faux`, `403 refuse`, `403 double_auth_a_regler`, `404 appli_inconnue`, `423 verrouille`, `429 trop_d_essais`.

### `POST /sso/poste` (juste après une connexion réussie)

`Authorization: Bearer <jeton d'accès>` +

```json
{ "appareil": { "id": "6f1c…", "nom": "PC du salon", "plateforme": "windows" }, "utilisateur": "awa" }
```

- `utilisateur` : le nom de l'utilisateur du système (Windows : `%USERNAME%` ; Mac/Linux : `os.userInfo().username`).
- `appareil.id` : le **même pour tous les programmes du poste** → la bibliothèque le range dans le coffre du système sous
  « Odin SSO appareil » (créé une fois). S'il manque, Odin le refuse (`400`).

→ `200 { "ok": true, "jeton_poste": "odp1.<idPoste>.<secret>", "poste": { "id": "…", "expire": 1765717200000 } }`

Le jeton du poste vaut 30 jours sans servir, 90 jours au plus ; chaque échange le prolonge. Odin n'en garde que le SHA-256.
Il est lié à la personne, à `appareil.id` et à `utilisateur` : présenté avec un autre appareil ou un autre utilisateur du
système, il est refusé (`401 jeton_poste_invalide`).

**Rangement** (jamais en clair dans un fichier) dans le coffre du système de l'utilisateur, nom
**« Odin SSO <issuer> »** (ex. `Odin SSO https://192.168.1.10:7777`), contenu = le jeton du poste :

| Système  | Coffre                          | Commande / API (voir `clients/odin-sso.mjs`)                                                     |
|----------|---------------------------------|---------------------------------------------------------------------------------------------------|
| Windows  | Gestionnaire d'identification   | `CredWriteW` / `CredReadW` / `CredDeleteW` (advapi32), `CRED_TYPE_GENERIC`, `TargetName` = le nom, `UserName` = `odin-sso`, persistance `CRED_PERSIST_LOCAL_MACHINE` ; depuis Node : PowerShell + `Add-Type`, le secret passe par l'entrée standard |
| Mac      | Trousseau de session            | `security add-generic-password -U -s "<nom>" -a odin-sso -w …` (le secret passe par `security -i` sur l'entrée standard, jamais dans la ligne de commande) ; lecture `security find-generic-password -s "<nom>" -a odin-sso -w` |
| Linux    | Secret Service (GNOME Keyring, KWallet) | `secret-tool store --label="<nom>" service odin-sso adresse <issuer>` (secret sur l'entrée standard) ; `secret-tool lookup service odin-sso adresse <issuer>` ; `secret-tool clear …` |
| Android  | pas de coffre partagé entre applis | chaque appli garde **ses** jetons (clé AES de l'Android Keystore) ; pas de SSO du poste entre applis Android (voir § 11) |

Sans coffre disponible (Linux sans Secret Service, par ex. un serveur) : **pas de SSO du poste** ; l'appli garde son
jeton de renouvellement avec son propre chiffrement (Electron `safeStorage`, fichier chiffré de Vénus) et le dit à
l'utilisateur. Jamais de repli en clair.

### `POST /sso/echange` (un autre programme du même poste)

```json
{ "jeton_poste": "odp1.…", "appli": "pegase", "appareil": { "id": "6f1c…", "nom": "PC du salon", "plateforme": "windows" }, "utilisateur": "awa" }
```

→ `200`, même réponse que `/sso/connexion` (jetons **de l'appli demandée**, sa propre session liée au poste).
→ `403 { "ok": false, "code": "refuse", "message": "Tu n'as pas accès à Vénus. Demande à Awa de t'ajouter au groupe famille." }`
   à afficher tel quel (le jeton du poste reste valable pour les autres applis).
→ `401 jeton_poste_invalide` : efface le jeton du coffre, propose la connexion.

### `POST /sso/revoquer`

- `{ "jeton_poste": "odp1.…" }` : coupe la session du poste **et toutes les sessions d'applis ouvertes par elle**
  (« Se déconnecter d'Odin sur ce poste » ; la bibliothèque efface aussi le coffre).
- `{ "token": "odr1.…", "token_type_hint": "refresh_token" }` (RFC 7009, formulaire ou JSON) : coupe cette session d'appli.
- Réponse toujours `200 { "ok": true }`, même pour un jeton inconnu (RFC 7009 § 2.2).

## 7. Sauvegarde des applis sur Odin : `/api/sauvegardes/<appli>`

`Authorization: Bearer <jeton d'accès>` **de cette appli** (`aud` = `<appli>`, sinon `403 mauvaise_appli`).
Chaque **personne** a son propre jeu de sauvegardes par appli (une installation de Vénus connectée avec le compte d'Awa
sauvegarde dans le jeu d'Awa ; un invité ne voit jamais les sauvegardes d'Awa). La page de l'appli dans Odin (compte du
propriétaire) les voit toutes.

### Envoyer : `POST /api/sauvegardes/<appli>`

Corps = **les octets de l'archive** (`content-type: application/octet-stream`, envoi en flux possible), en-têtes :

| En-tête             | Obligatoire | Valeur                                                                                       |
|---------------------|-------------|-----------------------------------------------------------------------------------------------|
| `x-odin-empreinte`  | oui         | SHA-256 du corps, hexadécimal minuscule (Odin le recalcule : sinon `400 empreinte_fausse`)    |
| `x-odin-sorte`      | non         | `complete` (défaut : toute la base) ou `changements` (seulement ce qui a changé)             |
| `x-odin-base`       | si `changements` | la version complète sur laquelle s'appliquent ces changements                            |
| `x-odin-raison`     | non         | pourquoi, ≤ 120 caractères (`nouvel utilisateur`, `favori`, `téléchargement terminé`, `réglage`, `vérification`, `quotidienne`) ; encodé avec `encodeURIComponent` |
| `x-odin-nom`        | non         | nom du fichier (`venus-base.tar.gz`), encodé avec `encodeURIComponent`                       |

→ `201 { "ok": true, "inchange": false, "version": { … } }`
→ `200 { "ok": true, "inchange": true, "version": { … } }` si l'empreinte est celle de la dernière version (rien de rangé).
→ `413 trop_gros` (champ `limite`) ; taille max réglable par appli dans Persona (défaut **500 Mo**).

Une version : `{ "id": "v20261114T153012Z-ab12", "date": 1763134212000, "taille": 48213, "empreinte": "…", "sorte": "complete",
"raison": "nouvel utilisateur", "nom": "venus-base.tar.gz", "base": null, "appareil": "Serveur Vénus" }`.

Rangement sur Odin : `~/.odin/valhalla/<module de l'appli>/sauvegardes/<personne>/` (Vénus : `valhalla/freyja/…` ;
Pégase : `valhalla/pegase/…`), chaque version **chiffrée** (AES-256-GCM, clé dérivée de la clé du coffre d'Odin ;
jamais en clair sur le disque), dossier bloqué pour les outils de fichiers d'Odin. Versions gardées : tout ce qui a moins de
48 heures (100 au plus), puis une complète par jour pendant 30 jours, puis une par mois pendant 12 mois ; la dernière
complète n'est jamais effacée ; les `changements` vivent 48 h ou jusqu'à la complète suivante.

### Lister : `GET /api/sauvegardes/<appli>`

```json
{ "ok": true, "appli": "venus", "versions": [ { …la plus récente d'abord… } ], "derniere": { … } , "taille_totale": 192841,
  "taille_max": 524288000, "restaurer": null }
```

### Empreinte (vérification toutes les 5 minutes) : `GET /api/sauvegardes/<appli>/empreinte`

```json
{ "ok": true, "empreinte": "…ou null…", "version": "v20261114T153012Z-ab12", "date": 1763134212000, "restaurer": null }
```

L'appli compare avec l'empreinte de sa base actuelle ; si elle diffère, elle renvoie une sauvegarde (`x-odin-raison:
vérification`). **`restaurer`** : si le propriétaire a cliqué « Restaurer » sur cette version dans Odin, l'identifiant de la
version à restaurer ; l'appli la télécharge, la restaure, puis le confirme :

`POST /api/sauvegardes/<appli>/restauree` `{ "version": "v…" }` → `{ "ok": true }` (efface la demande, note au journal).

### Télécharger : `GET /api/sauvegardes/<appli>/<version>`

→ les octets d'origine (`content-type: application/octet-stream`, `x-odin-empreinte`, `x-odin-sorte`,
`content-disposition: attachment`). **Vérifie le SHA-256** avant de restaurer. Version inconnue : `404 introuvable`.
Restauration d'une nouvelle installation : connexion (`/sso/connexion`), liste, téléchargement de la dernière `complete`
puis des `changements` plus récents dont `base` est cette version, dans l'ordre des dates.

## 8. Sécurité (résumé)

- Mot de passe : vérifié par scrypt dans Odin, jamais écrit, jamais journalisé, jamais renvoyé. Les applis ne gardent
  **pas** le mot de passe : seulement leurs jetons (coffre du système ou chiffrement de l'appli).
- Jetons : Odin ne garde que leurs SHA-256. Signature ES256 (clé privée chiffrée avec la clé du coffre d'Odin).
- PKCE S256 obligatoire, `state` obligatoire, adresse de retour exacte, code à usage unique de 60 s, rotation des jetons de
  renouvellement avec détection de réutilisation, freinage des essais, verrouillage, journal des connexions dans Persona.
- Rien n'est garanti à 100 % : un poste dont la session du système est ouverte et compromise donne accès aux jetons qu'il
  contient (c'est le principe du SSO du poste). Coupe-le dans Persona → Applis → Appareils connectés.

## 9. Certificat d'Odin

Odin a souvent un certificat auto-signé. Épingle son empreinte au premier contact (SHA-256 du certificat DER, hexadécimal
minuscule ; Pégase : `GET /api/pegase/bonjour`), puis refuse tout autre certificat. `clients/odin-sso.mjs` le fait
(option `empreinte`), ou installe l'autorité d'Odin (`GET /odin-cert.crt`).

## 10. Bibliothèque Node / Electron : `clients/odin-sso.mjs`

Un seul fichier, sans dépendance, à **copier** dans Pégase (processus principal d'Electron) et Vénus (serveur Node).

```js
import { OdinSSO, trouverOdin, coffre } from './odin-sso.mjs';

const odins = await trouverOdin();                     // [{ adresse: 'https://192.168.1.10:7777', nom, version }]
const sso = new OdinSSO({
  adresse: odins[0].adresse, appli: 'venus',
  appareil: { nom: 'Serveur Vénus', plateforme: 'linux' },   // id : pris (ou créé) dans le coffre du système
  empreinte: reglages.empreinteOdin,                   // certificat épinglé (null au premier contact)
  garder: (secret) => reglages.ranger(secret),         // où ranger SES jetons si le coffre du système manque (chiffré !)
});

// 1) Déjà connecté sur ce poste ? (jeton du poste dans le coffre → échange, sans mot de passe)
const r = await sso.ouvrir();                          // { ok: true, personne } | { ok: false, code, message }
// 2) Sinon : identifiant + mot de passe (+ code si `code_requis`) ; ouvre aussi la session du poste
if (!r.ok) await sso.connecter({ identifiant, motdepasse, code });
// ou par le navigateur (code + PKCE, adresse de retour http://127.0.0.1:<port libre>/sso/retour) :
// await sso.autoriser({ ouvrir: (url) => shell.openExternal(url) });

const jeton = await sso.jeton();                       // jeton d'accès valable (renouvelé tout seul)
await sso.sauvegarder(octets, { raison: 'nouvel utilisateur' });
const { versions } = await sso.versions();
const octets2 = await sso.telecharger(versions[0].id); // vérifie le SHA-256
await sso.deconnecter();                               // révoque la session du poste et vide le coffre
```

- `coffre.ranger(nom, secret)`, `coffre.lire(nom)`, `coffre.effacer(nom)`, `coffre.disponible()` : Windows (PowerShell +
  advapi32), Mac (`security`), Linux (`secret-tool`).
- Erreurs : les méthodes rendent `{ ok: false, code, message }` (codes du § 0) ; `message` est à montrer tel quel.

## 11. Exemple Kotlin (Pégase téléphone)

Sur Android, PKCE par le navigateur (Custom Tabs, adresse de retour `pegase://sso/retour`) ou connexion directe. Les jetons
se gardent chiffrés avec une clé AES de l'Android Keystore (pas de coffre partagé entre applis : pas de SSO du poste).

```kotlin
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

fun b64url(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
val verifier = b64url(ByteArray(32).also { SecureRandom().nextBytes(it) })
val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
val state = b64url(ByteArray(16).also { SecureRandom().nextBytes(it) })
val nonce = b64url(ByteArray(16).also { SecureRandom().nextBytes(it) })
val url = Uri.parse("$odin/sso/autoriser").buildUpon()
    .appendQueryParameter("response_type", "code").appendQueryParameter("client_id", "pegase")
    .appendQueryParameter("redirect_uri", "pegase://sso/retour")
    .appendQueryParameter("scope", "openid profile email groups offline_access")
    .appendQueryParameter("state", state).appendQueryParameter("nonce", nonce)
    .appendQueryParameter("code_challenge", challenge).appendQueryParameter("code_challenge_method", "S256").build()
CustomTabsIntent.Builder().build().launchUrl(context, url)

// Au retour (pegase://sso/retour?code=…&state=…&iss=…) : vérifier state, puis échanger le code.
fun echanger(code: String): JSONObject {
    val c = URL("$odin/sso/jeton").openConnection() as HttpsURLConnection   // épingler le certificat (TrustManager)
    c.requestMethod = "POST"; c.doOutput = true
    c.setRequestProperty("content-type", "application/x-www-form-urlencoded")
    val body = listOf("grant_type" to "authorization_code", "code" to code, "client_id" to "pegase",
        "redirect_uri" to "pegase://sso/retour", "code_verifier" to verifier, "appareil" to appareilId,
        "appareil_nom" to Build.MODEL, "plateforme" to "android")
        .joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
    c.outputStream.use { it.write(body.toByteArray()) }
    val txt = (if (c.responseCode < 400) c.inputStream else c.errorStream).bufferedReader().readText()
    return JSONObject(txt)  // { access_token, id_token, refresh_token, expires_in } ou { error, message }
}

// Vérifier le jeton d'identité (ES256) : la signature JWS fait 64 octets r‖s → la convertir en DER pour java.security.
fun es256Ok(jwt: String, jwk: JSONObject): Boolean {
    val (h, p, s) = jwt.split(".")
    val x = BigInteger(1, Base64.decode(jwk.getString("x"), Base64.URL_SAFE))
    val y = BigInteger(1, Base64.decode(jwk.getString("y"), Base64.URL_SAFE))
    val params = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
        .getParameterSpec(ECParameterSpec::class.java)
    val key = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), params))
    val raw = Base64.decode(s, Base64.URL_SAFE)
    fun der(i: ByteArray): ByteArray { var b = i.dropWhile { it == 0.toByte() }.toByteArray(); if (b.isEmpty() || b[0] < 0) b = byteArrayOf(0) + b; return byteArrayOf(2, b.size.toByte()) + b }
    val seq = der(raw.copyOfRange(0, 32)) + der(raw.copyOfRange(32, 64))
    val sig = byteArrayOf(0x30, seq.size.toByte()) + seq
    return Signature.getInstance("SHA256withECDSA").run { initVerify(key); update("$h.$p".toByteArray()); verify(sig) }
}
```

Renouvellement : même `POST /sso/jeton` avec `grant_type=refresh_token`, `refresh_token`, `client_id=pegase`,
`appareil=<appareilId>` ; **remplace** le jeton de renouvellement gardé par le nouveau à chaque fois.

## 12. Plusieurs personnes dans Odin (droits appliqués partout)

- **Entrer dans l'interface d'Odin** : l'écran de connexion garde le compte du propriétaire (e-mail + mot de passe) et
  ajoute « J'ai un compte Persona » → `GET /sso/odin` → portail Persona (code + PKCE, Odin est sa propre appli cliente
  `odin`) → `GET /sso/odin/retour` → cookie de session habituel (`odin_session`). Le propriétaire qui passe par là
  retrouve **sa** session ; une autre personne ouvre une session « membre » (visible et coupable dans Persona).
- **Le compte du propriétaire est la personne `admin` de Persona** (`preferred_username: proprietaire`, créée toute seule) :
  aucune copie de son mot de passe (il reste dans `compte.json`, jamais modifié). Retour arrière : Persona → « Délier le
  compte du propriétaire » (la fiche disparaît, le compte d'Odin reste) ; « Relier » la recrée.
- **Un seul endroit décide** : `Valhalla.act` refuse toute action d'une appli sans droit pour la personne qui agit
  (bouton, API `/api/valhalla/act`, phrase comprise par Logos `/api/valhalla/order`). Autour :
  - la liste des applis (`/api/valhalla/catalog`) ne montre que les applis permises ; `/api/valhalla/view?id=<appli>` sans
    droit → `403 { ok: false, code: "refuse", error: "<message>" }` (message de § 1) ; alertes et bulles filtrées ;
  - port direct d'une appli (`http://<odin>:<port de l'appli>`) sans droit → `403 refuse` ;
  - `/maison` (Hestia) et `/recherche` (Pythie) demandent le droit sur leur appli ; les liens de partage privés ne
    s'ouvrent plus « en propriétaire » pour un membre ;
  - un membre n'a **pas** la conversation avec l'IA d'Odin (`/api/message`, `/api/ask` → `403 reserve`) : l'IA a des
    outils au-delà des applis (fichiers, machines) ; il fait agir ses applis par leurs boutons ou par une phrase (Logos) ;
  - tout le reste de l'API (réglages, conversations, machines, sauvegarde d'Odin…) → `403 reserve` ; `/api/state` lui
    rend un état vide (même forme) avec `membre: { login, name, groups }`.
- **Logiciels du proxy Valgrind** (SearXNG, LanguageTool, Penpot…) : le portail Persona protège un site du proxy dès qu'il
  est « réservé » ; Persona → Applis montre les sites encore sans connexion unique et « Protéger tous les sites ».
  Un logiciel qui sait faire OpenID s'inscrit comme appli cliente **confidentielle** (« Connexion Odin pour un logiciel ») :
  son secret va dans le coffre Thésauros (jamais affiché), `/sso/jeton` accepte `client_secret_basic` et
  `client_secret_post`, PKCE reste obligatoire s'il l'envoie. Penpot (documentation officielle, backend) :
  `PENPOT_FLAGS=… enable-login-with-oidc`, `PENPOT_OIDC_CLIENT_ID`, `PENPOT_OIDC_CLIENT_SECRET`, `PENPOT_OIDC_BASE_URI`
  (= l'`issuer` d'Odin), `PENPOT_OIDC_SCOPES=openid profile email groups`, adresse de retour
  `https://<penpot>/api/auth/oidc/callback` ; `PENPOT_SSRF_ALLOWED_HOSTS` si Odin est sur une adresse privée.
