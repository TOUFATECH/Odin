# Arachné — tes sites web

Arachné garde tes sites en vie et à jour : elle les surveille, les essaie, les relance, les déploie et applique
leurs mises à jour. Tout cela marche **sans IA**. Avec une IA connectée, elle peut aussi faire évoluer le
code, sur une branche à part, sous garde-fous.

(Dans les mythes, Arachné garde les pommes qui empêchent les dieux de vieillir.)

## Mise en route

1. Ouvre **Applis → Arachné**, encadré **Surveiller un site** : l'adresse suffit. Ou dis :
   « surveille le site https://monsite.fr ».
2. Pour aller plus loin, renseigne ce que tu as (tout est facultatif) :
   - le **dépôt GitHub** (`propriétaire/dépôt`) ;
   - le **projet Vercel** (son nom), et l'équipe si le projet est dans une équipe ;
   - la **zone Cloudflare** (le nom de domaine).
3. Encadré **Accès** : colle les jetons. Ils sont rangés avec les secrets d'Odin, jamais affichés,
   jamais écrits dans les réglages, et envoyés seulement aux adresses officielles de chaque service.

| Service | Jeton | Droits utiles |
| --- | --- | --- |
| GitHub | jeton à accès limité au dépôt du site | contenu, demandes de fusion, Actions, alertes Dependabot (lecture et écriture) |
| Vercel | jeton de compte ou d'équipe | déploiements et projets |
| Cloudflare | jeton d'API | Zone : lecture · DNS : lecture · Purge du cache · Réglages de zone : modification |

Changer un jeton demande toujours ta confirmation ; une automatisation ou un autre assistant ne peut pas le faire.

## Ce qu'elle surveille

Toutes les 5 minutes, pour chaque site :

- **le site** : il répond ou non (« hors ligne » seulement après deux essais ratés de suite), son temps de
  réponse, son certificat HTTPS (alerte à 14, 7, 3 et 1 jour de la fin, puis à l'expiration, et s'il n'est
  plus valable), le titre et le contenu de la page d'accueil ;
- **GitHub** : envois de code, tests réussis ou en échec, demandes de fusion, versions publiées ;
- **Vercel** : déploiements en ligne, en échec, annulés ;
- **Cloudflare** : zone en pause, enregistrements DNS qui changent, niveau de sécurité qui change.

Chaque chose vue devient un **événement**. Ce qui est sérieux devient une **alerte** (fil commun de Forseti,
et ta messagerie).

## Demander des événements précis

Dis-le en français, dans la discussion ou dans l'encadré **Voir des événements** :

- « les événements du site monsite »
- « donne-moi les erreurs du site monsite depuis 2 jours »
- « les déploiements cette semaine »
- « les événements github d'hier »
- « les événements critiques »
- un mot entre guillemets : « "paiement" »

Odin répond en rappelant le filtre compris (`Filtre : monsite · erreurs · depuis 2 jour(s)`).
Genres reconnus : déploiements, erreurs, envois de code, tests, demandes de fusion, certificat, lenteur,
contenu, DNS et Cloudflare, disponibilité, versions.

## Gérer le site, sans IA

| Tu dis | Ce qui se passe | Accord demandé |
| --- | --- | --- |
| « comment va le site monsite ? » | vérification immédiate et résumé des 24 dernières heures | non |
| « teste le site monsite » | chaque page répond, a un titre, n'affiche pas d'erreur ; liens de l'accueil ; en-têtes de sécurité | non |
| « bilan du site monsite » | ce qu'il faut garder, améliorer, ne pas garder (des faits vérifiés) | non |
| « relance le site monsite » | le même code est reconstruit et remis en ligne | non (annulable) |
| « déploie le site monsite » | le dernier code part en production | **oui** |
| « reviens à la version précédente du site monsite » | le déploiement d'avant sert de nouveau le site | **oui** |
| « remets en ligne le dernier déploiement du site monsite » | reprend les mises en ligne après un retour en arrière | **oui** |
| « mises à jour du site monsite » | les mises à jour proposées et l'état de leurs tests | non |
| « active les mises à jour du site monsite » | GitHub propose les correctifs de sécurité (Dependabot) | non (annulable) |
| « fusionne la mise à jour 12 du site monsite » | appliquée seulement si tous ses tests passent | **oui** |
| « relance les tests du site monsite » | rejoue les étapes en échec | non |
| « vide le cache du site monsite » | Cloudflare oublie ses copies | non |
| « le site monsite est attaqué » | Cloudflare vérifie chaque visiteur ; à retirer ensuite | non (annulable) |
| « crée le projet nom-du-projet » | dépôt GitHub privé et projet Vercel relié | **oui** |

Ce qui touche la production est une **action grave** : Odin te demande toujours ton accord, et elle ne part
jamais d'une automatisation, ni d'un autre assistant.

Deux choses qu'Arachné fait d'elle-même :

- après **chaque mise en production**, elle essaie le site ; si quelque chose casse, tu es prévenu et elle te
  propose de revenir en arrière (elle ne le fait pas seule) ;
- si le **DNS ou le certificat** d'un site change **et** que sa page d'accueil change aussi, Asclépios ouvre un
  incident « site peut-être détourné ».

## Faire évoluer le code, avec une IA

Il faut une IA connectée et le dépôt GitHub du site.

1. « recode le site monsite : … » sans fichier → un **plan** : ce qui est gardé, changé, retiré, et les
   risques. Rien n'est modifié.
2. Avec le **fichier** à modifier (réglage « Fichier ») → l'IA écrit le nouveau fichier ; Odin le vérifie,
   l'envoie sur une branche `odin/…` et ouvre une **demande de fusion** qui dit combien de lignes sont
   gardées, changées, retirées, et ce qu'il faut relire.
3. Tu relis. Quand les tests passent : « fusionne la mise à jour N du site monsite » (ton accord est demandé).

Garde-fous, vérifiés par le code et non par l'IA :

- jamais la branche principale : seulement une branche `odin/…` ;
- jamais les fichiers de secrets (`.env`), les clés, le dossier `.github` (les tests automatiques ne peuvent
  pas être neutralisés), ni les fichiers générés (verrouillage des dépendances) ;
- changement **refusé** s'il contient ce qui ressemble à une clé secrète ou un de tes jetons, ou s'il retire
  un en-tête de sécurité ;
- signalés pour relecture : nouvelles adresses extérieures, code évalué à la volée, HTML injecté tel quel,
  exécution de commandes, vérification TLS coupée, accès ouvert à tous les sites ;
- le contenu du site et du dépôt est donné à l'IA comme une **donnée**, jamais comme un ordre ;
- « annule » supprime la branche de la proposition, et rien d'autre.

Un fichier à la fois : pour plusieurs fichiers, redonne la même branche.

## Serveurs MCP (appli Interprète)

- **GitHub** et **Cloudflare** acceptent un jeton : leur serveur MCP peut être branché dans Interprète. L'IA
  d'Odin s'en sert alors ; sans IA, tu peux appeler un outil toi-même : « appelle l'outil … » (un outil qui
  peut modifier quelque chose demande ton accord).
- **Vercel** : son serveur MCP exige une connexion par navigateur (OAuth) qu'Odin ne fait pas encore. Arachné
  passe par l'API officielle de Vercel, avec ton jeton.

Arachné elle-même n'a pas besoin de ces serveurs : elle parle directement aux API officielles.

## Ses liens avec les autres applis

- **Forseti** : ses alertes rejoignent le fil commun et ta messagerie.
- **Asclépios** : les changements de DNS, de certificat et de page d'accueil sont des signaux ; recoupés, ils
  ouvrent un incident.
- **Talos** : chaque événement peut déclencher une automatisation (« quand un déploiement échoue… »).
- **Thot** : sa fiche est dans le Cerveau (`Odin/Applis/Arachné`), sans aucun de tes réglages.

## Limites, dites clairement

- Arachné regarde le site de l'extérieur : elle ne lit pas les journaux du serveur ni les erreurs des
  visiteurs.
- « Essayer le site » vérifie que les pages répondent et s'affichent sans erreur ; ce n'est pas un test de
  parcours (panier, paiement, connexion).
- L'évolution du code se fait un fichier à la fois, et dépend de la qualité de l'IA connectée : relis
  toujours la demande de fusion.
- Après un retour en arrière, Vercel ne met plus en ligne tout seul les nouveaux déploiements : il faut le
  redemander (« remets en ligne… »).
- Sur l'offre gratuite de Vercel, on ne peut revenir qu'au déploiement précédent.

## Ce qui est testé

`test/idunn.test.ts` (15 tests) : le site surveillé est un **vrai** serveur web local ; GitHub, Vercel et
Cloudflare sont **simulés** (mêmes adresses et mêmes formes de réponses que leurs API). Les trois liens sont
vérifiés dans `test/liens.test.ts`. Les API réelles de GitHub, Vercel et Cloudflare n'ont pas été essayées
depuis l'environnement de développement (réseau fermé) : le premier essai réel se fait chez toi, en
commençant par les lectures (« comment va le site … », « les déploiements du site … »).

Versions des API vérifiées dans leur documentation le 11 novembre 2026 : GitHub `2026-03-10`, Vercel
(`/v13/deployments`, `/v7/deployments`, `/v9/projects`, `/v1/…/rollback`, `/v10/…/promote`, `/v11/projects`),
Cloudflare `client/v4`.
