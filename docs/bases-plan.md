# Les données des applis d'Odin dans une vraie base PostgreSQL — plan

Décision du propriétaire (14/11, 09:47) : « tout ce qui est base de données, il ne faut pas utiliser Odin, il faut
utiliser la base de données ». Les applis qui rangent leurs **données** en fichiers JSON passent sur une base
PostgreSQL gérée par Alexandrie (`urdr`). Odin lit ces bases (lecture seule, vues prévues) pour répondre ; il ne sert
plus lui-même de base. Zéro SQLite, zéro Docker.

## 1. Principes

- **Une base `odin`**, **un schéma PostgreSQL par appli** (`pegase`, `persona`, `journaux`…), **un compte par appli**
  (`odin_app_<id>`) qui n'a de droits que sur son schéma. Un schéma commun `odin_base` (versions des migrations,
  écritures en attente déjà reprises). Un compte `odin_lecture` qui ne voit **que les vues** `v_*` prévues pour Odin
  (jamais les colonnes sensibles : empreintes de jetons, adresses IP, réglages privés).
- **Requêtes paramétrées seulement** : la couche commune refuse un texte SQL qui contient une valeur collée (guillemet
  simple) ; seules les migrations (écrites dans le code) passent par le protocole simple.
- **Même interface qu'avant** pour chaque appli : la mémoire de l'appli reste la même (lectures synchrones), seul le
  « support » change (fichiers → base). Une appli migrée change peu de code.
- **Rien n'est perdu** : chaque écriture part d'abord dans un petit journal d'attente sur le disque (`.attente-base.jsonl`,
  ajout + `fsync`), puis dans la base (une transaction, numéro d'ordre noté dans la base : rejouer deux fois ne
  double rien). Base arrêtée : les écritures s'accumulent dans ce journal et partent quand elle revient.
- **Migration automatique** au premier passage (base prête + fichiers présents) : tout est écrit dans la base en une
  transaction, relu et compté ; les fichiers sont **copiés** dans `avant-base-<date>/` (copie de secours), puis un
  repère `en-base.json` dit « les données sont dans la base ». **Retour possible** : action d'Alexandrie qui réécrit
  les fichiers depuis la base et enlève le repère (l'appli repart en fichiers).

## 2. Où tourne la base d'Odin (ordre de choix, gardé dans `valhalla/urdr/base-odin.json`)

1. Déjà choisie (fichier ci-dessus + mot de passe dans les secrets d'Alexandrie et le coffre Thésauros).
2. **Un PostgreSQL déjà présent sur la machine** qui tourne (127.0.0.1:5432) et qu'Odin peut administrer (Odin lancé
   en root : compte `odin` créé par le compte système `postgres`, sans mot de passe sur la ligne de commande).
3. **Les programmes PostgreSQL présents** (initdb, pg_ctl) : Odin crée **son propre serveur** (dossier protégé,
   127.0.0.1 seulement, port libre, SCRAM-SHA-256), le démarre à chaque lancement.
4. Sinon **Hringhorni** (moteur de conteneurs d'Odin, pas Docker) : le serveur `odin-pg` existant d'Alexandrie.
5. Rien de tout ça : les applis restent en fichiers et Odin le dit (Alexandrie : « installe PostgreSQL ou laisse
   Hringhorni le faire »).

Mot de passe administrateur : généré, jamais affiché, dans `valhalla/urdr/secrets.json` (fichier bloqué
`SECRET_FILES`) et rangé dans le coffre (« Base · Données des applis d'Odin »).

## 3. Inventaire (grep des écritures : `saveSettings`, `writeFileSync`, `appendFileSync`, `ecrireAtomique`)

Volume : P = petit (< 100 ko), M = moyen (< 10 Mo), G = gros. Fréquence : R = rare (réglage), J = quelques fois par
jour, C = continu (synchro, journal). Sensibilité : S = secret (clé, mot de passe, jeton), Pr = privé (vie privée),
N = normal.

| Appli (id) | Données | Vol. | Fréq. | Sens. | Décision |
|---|---|---|---|---|---|
| Pégase (`pegase`, `pegase/store.ts`) | favoris, onglets, espaces, bureaux, agenda, réglages, téléchargements, profil par personne ; historique de navigation (journal par jour) ; préférences (voir/agenda) ; appareils (empreinte du jeton) ; copies quotidiennes | M→G | C | Pr (historique), S (empreintes de jetons) | **base** (schéma `pegase`) ; empreintes de jetons en base mais hors des vues |
| Pégase (réglages du module) | groupes IA, installateurs, version, résumés | P | R | N | fichier (réglages de démarrage) |
| Agora (pas encore fusionnée) | catalogue, installations | P | J | N | **base** quand elle sera fusionnée (même socle) |
| Persona (`var`, `sso/*`) | personnes (empreintes de mots de passe), sessions (empreintes de jetons), droits, applis clientes, règles du portail | P | J | **S** | fichier bloqué : nécessaire pour se connecter avant que la base existe, et secret |
| Persona | journal des connexions (500 dernières) | P | C | Pr | **base** (schéma `journaux`) |
| Persona / SSO | clé de signature, sauvegardes chiffrées des applis | P/G | R | **S** | fichier chiffré (coffre) |
| Valhalla (`service.ts`) | fil d'alertes `alertes.jsonl` | M | C | N | **base** (`journaux.entrees`, journal `alertes`) |
| Valhalla | alertes vues, manips (500) | P | J | N | base ensuite (petit, lu partout) |
| Mascotte (`notices.ts`) | bulles `bulles.jsonl` | P | C | N | **base** (journal `bulles`) |
| Alexandrie (`urdr`) | liste des bases `bases.json` | P | R | N | fichier : nécessaire **avant** la base (où est-elle ?) |
| Alexandrie | mots de passe des bases `secrets.json` | P | R | **S** | fichier bloqué + coffre |
| Alexandrie | journal des requêtes `journal.jsonl` | M | J | Pr | base (EN DERNIER : agent « applis ») |
| Arche (`skuld`) | historique des sauvegardes `historique.jsonl` ; archives `.dump` | P ; G | J | N ; S | historique → **base** ; archives = gros fichiers binaires → fichiers |
| Rödd (`rodd`) | historique | P | J | N | base (journal) |
| Iðunn (`idunn`) | événements des sites | P | J | N | base (journal) |
| Forge (`forge`) | historique des constructions | P | J | N | base (journal) |
| Loki (`loki`) | attaques vues (par IP) | M | C | Pr (IP) | base (journal), IP hors des vues |
| Garmr (`garmr`) | bannis, échecs, journaux | M | C | Pr | base (après les journaux) |
| Víðarr (`vidarr`) | DNS : historique des requêtes, listes | G | C | Pr | base pour l'historique ; listes de blocage = fichiers téléchargés |
| Gná / Gladsheim | positions (par jour), tuiles de carte | M ; G | C ; R | **Pr** | positions → base ; tuiles = binaires → fichiers |
| Durinn (`durinn`) | suivi, vitesses, test en cours | P | J | N | base (journal) |
| Hlín (`hlin`) | fiches, demandes, résultats ; lettres et photos | P ; G | J | Pr | fiches/demandes → base ; lettres/photos = fichiers |
| Völva (`volva`) | historique de recherche | P | J | Pr | base |
| Vörðr (`vordr`) | sondes, problèmes, historique | M | C | N | base |
| Frigg (`frigg`) | réservations, horaires, services | P | J | Pr | base |
| Kvasir, Syn, Heidrun, Aegir, Midgard, Hermod, Askr… | réglages de l'appli + petites listes | P | R | N | fichiers (réglages) ; listes → base au cas par cas |
| Snotra, Ivaldi, Hel (agent « applis ») | dossiers, documents | P ; G | R | Pr | EN DERNIER, petits changements ; documents = fichiers |
| Thésauros (`brisingamen`) | coffre chiffré `coffre.bin` | P | R | **S** | fichier chiffré (c'est le coffre) |
| Þjálfi, Svalinn, Valgrind, Bru… | secrets (`secrets.json`, clés ACME, jetons de tunnel) | P | R | **S** | fichiers bloqués `SECRET_FILES` |
| Hringhorni, Ymir | état des conteneurs et machines, images | P ; G | J | N | fichiers : nécessaires pour démarrer la base elle-même |
| Sól, Leikvangr, Bragi, Himinbjörg, Dvalinn, Skíðblaðnir, Champollion | index de médias, dépôts, clips, photos, fichiers synchronisés | G | J | Pr | fichiers (binaires) ; index → base plus tard |
| Mesures (`metrics.ts`) | courbes | M | C | N | base plus tard (séries) |
| Réglages de toutes les applis (`réglages.json`) | réglages | P | R | N/S | **fichier** : lus au démarrage, avant que la base existe |

## 4. Ce qui RESTE en fichier, et pourquoi

1. **Secrets et clés** : mots de passe des bases, coffre, clés de signature, jetons, clés ACME, empreintes de mots de
   passe de Persona → coffre ou fichiers bloqués (`SECRET_FILES`), **jamais en clair en base**.
2. **Réglages de démarrage** : `réglages.json` de chaque appli, `bases.json`, `base-odin.json`, état de Hringhorni —
   il faut les lire **avant** que la base existe (et pour la faire démarrer).
3. **Gros fichiers binaires** : archives d'Arche, photos, clips, tuiles, ISO, documents, médias.
4. **Le journal d'attente** (`.attente-base.jsonl`) : les écritures pas encore parties dans la base.
5. **La copie de secours** (`avant-base-<date>/`) : les fichiers d'avant la migration, pour le retour.

## 5. Schéma

```
base odin
├── odin_base           (admin)   migrations(app, version, nom, faite) · reprises(app, n)
├── pegase              (odin_app_pegase)
│   ├── enregistrements(profil, col, id, data jsonb, maj, appareil, suppr, jour)  PK(profil, col, id)
│   ├── prefs(profil PK, voir, agenda_cle)
│   ├── appareils(id PK, profil, nom, plateforme, cree, vu, ip, jeton, sso, revoque, synchro, envoyes, recus)
│   ├── copies(profil, id, date, raison, nombres jsonb, cols jsonb)  PK(profil, id)
│   └── vues : v_historique (seulement les profils qui laissent voir), v_favoris, v_agenda, v_appareils (sans jeton ni IP)
└── journaux            (odin_app_journaux)
    ├── entrees(n bigserial, journal, quand, donnees jsonb)  (alertes, bulles, connexions Persona, historique Arche…)
    └── vues : v_alertes, v_bulles, v_sauvegardes  (pas de vue sur les connexions : IP)
```

Rôles : `odin` (admin, crée les schémas et les comptes), `odin_app_<id>` (propriétaire de son schéma, rien
d'autre : `REVOKE ALL ON SCHEMA public`), `odin_lecture` (USAGE sur les schémas, SELECT sur les vues `v_*` seulement).

## 6. Le socle (`src/valhalla/base/`)

- `serveur.ts` : choix et démarrage du serveur (§2), création de la base `odin`, des comptes, inscription dans la liste
  d'Alexandrie (« Données des applis d'Odin », compte `odin_lecture`).
- `pool.ts` : connexions (une petite réserve par compte), transactions, requêtes paramétrées seulement.
- `migrations.ts` : migrations versionnées par appli, chacune dans une transaction.
- `attente.ts` : le journal d'attente sur le disque, reprise dans l'ordre, sans doublon.
- `sauvegarde.ts` : `pg_dump -Fc` de la base `odin`, **chiffré** (AES-256-GCM, même format que les sauvegardes
  d'Odin), relu (`pg_restore --list`), chaque nuit, gardé 7 jours + 4 semaines ; s'ajoute aux sauvegardes rapides
  (copies de Pégase) et aux plans d'Arche.
- `journal.ts` : un journal générique (ajout, N derniers, recherche) en base, avec repli fichier.
- Odin démarre même sans base : la base est préparée en arrière-plan ; les applis le disent (« base pas prête ») ;
  les écritures restent en fichier ou attendent puis sont reprises.

## 7. Ordre de migration

1. **Pégase** (données synchronisées, le plus gros volume, le plus de valeur).
2. **Agora** quand elle sera fusionnée (même modèle que Pégase).
3. **Persona** sauf secrets : le journal des connexions.
4. **Journaux et historiques** : alertes, bulles, historique d'Arche, puis Rödd, Iðunn, Forge, Loki, Durinn.
5. **Les autres** (Vörðr, Frigg, Gná, Völva, Hlín, mesures…), une à la fois.
6. EN DERNIER, petits changements : Snotra, Ivaldi, Alexandrie (journal), Hel, Agora (agents en cours).

Chaque appli migrée : ses essais au vert + essai de migration (données identiques avant/après) + essai « base arrêtée
puis revenue ».
