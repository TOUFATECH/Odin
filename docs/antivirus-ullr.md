# Ullr — l'antivirus d'Odin

Ullr est l'antivirus d'Odin. Son moteur est fait maison (aucun moteur d'un autre antivirus n'est
intégré) et il est nourri par des sources publiques. Il est relié à toutes les autres applis d'Odin.

**Aucun antivirus ne détecte 100 % des menaces, Ullr non plus.** Son moteur n'a pas été validé par un
laboratoire indépendant. Il s'ajoute à tes autres protections, il ne les remplace pas.

## 1. Ce qu'il fait

| | |
|---|---|
| **Fichiers** | programmes, scripts, documents Office, PDF, raccourcis, pages web, e-mails |
| **Archives** | zip, gzip, tar, documents Office et applis Android (ce sont des zip), jusqu'à 3 niveaux |
| **Menaces** | malwares connus, rançongiciels, chevaux de Troie, portes dérobées, logiciels espions, mineurs, scripts malveillants, documents piégés, hameçonnage |
| **Adresses** | liens et sites dangereux (malware, hameçonnage, applis espionnes), imitation de marque |
| **En continu** | ce qui arrive dans les téléchargements, sur une clé USB, dans la boîte de réception d'Odin |
| **Incidents** | relie les signaux de toutes les applis pour reconnaître une attaque |
| **Failles** | compare les failles réellement exploitées aux logiciels installés |

## 2. Mise en route

Rien à faire : Ullr marche dès l'installation d'Odin, avec ses règles de base, même sans Internet.

Deux clés **facultatives** l'améliorent. Colle-les dans la page Ullr, encadré « Clés des sources » :
elles sont rangées avec les autres secrets d'Odin (`~/.odin/env`), jamais affichées, et masquées
partout. Ne les donne jamais dans une discussion.

| Clé | Ce qu'elle apporte | Où l'obtenir | Conditions |
|---|---|---|---|
| `ABUSE_CH_KEY` | empreintes des malwares récents (MalwareBazaar), indicateurs (ThreatFox), sites qui distribuent des malwares (URLhaus) | gratuite, sur auth.abuse.ch | usage raisonnable ; offre payante pour un usage commercial |
| `VT_API_KEY` | l'avis de dizaines d'antivirus sur une empreinte (VirusTotal) | gratuite, sur virustotal.com | 4 demandes par minute, 500 par jour ; **interdite dans un produit ou un service commercial** |

Sans clé, Ullr utilise quand même : OpenPhish, Stalkerware Indicators, les règles signature-base et le
catalogue CISA KEV.

## 3. Procédure d'utilisation

Tout se fait en parlant à Odin (compris **sans IA**), ou depuis la page **Ullr**.

| Tu veux | Tu dis | Ce qui se passe |
|---|---|---|
| Vérifier un fichier | « analyse le fichier /chemin/fichier » | verdict expliqué : menace, raisons, score, empreinte |
| Vérifier un dossier | « analyse le dossier /chemin » | analyse, puis rapport |
| Vérifier tes téléchargements | « analyse mes téléchargements » | profils : `téléchargements`, `sites web`, `maison`, `temporaire`, `tout` |
| Vérifier un lien | « vérifie le lien https://… » | connu comme dangereux ? forme suspecte ? |
| Vérifier un message | « vérifie ce message : … » | signes d'hameçonnage, avec la raison de chacun |
| Programmer une analyse | page Ullr → « Planifier une analyse » | chaque heure, jour ou semaine, avec des dossiers exclus |
| Arrêter une analyse | « arrête l'analyse » | le rapport partiel est gardé |
| Lire le rapport | « rapport antivirus » | fichiers, durée, détections (chemin, empreinte, règle, gravité, action) |
| Mettre à jour | « mets à jour les signatures » | se fait aussi tout seul |
| Revenir en arrière | « reviens à la version précédente des signatures » | la mise à jour est annulée |
| Voir la quarantaine | « la quarantaine » | fichiers mis à l'écart |
| Voir les incidents | « les incidents » | les attaques reconstituées |
| Protéger un dossier | « pose des sentinelles dans /chemin » | deux faux documents qui trahissent un rançongiciel |
| Voir les failles | « les failles » | failles exploitées qui concernent tes logiciels |
| Savoir où tu en es | « y a-t-il un virus sur ma machine ? » | l'état en quelques lignes : incidents, fichiers à vérifier, signatures, dernière analyse |
| Voir les analyses faites | « les analyses » | les derniers rapports |

### Quand Ullr trouve quelque chose

1. **C'est sûr** (empreinte connue, ou règle fiable sur un fichier qui peut se lancer). Le fichier est mis
   en **quarantaine** : déplacé et brouillé, il ne peut plus se lancer. Tu reçois un message.
   Réponds « garde » ou « annule » : annuler le remet à sa place, identique. En mode Odin Breaker, Odin
   garde seul.
2. **C'est un soupçon** (indices, sans preuve). Le fichier reste en place, marqué « à vérifier ».
   Dis « isole /chemin » pour l'écarter, ou « fausse alerte » depuis la page.
3. **C'est le fichier de test** (EICAR). Il est signalé et laissé en place : il est inoffensif.

Rien n'est jamais **supprimé** sans ton accord. Supprimer un fichier de la quarantaine, le restaurer ou
le déclarer sain sont des actions graves : Odin te demande de confirmer.

### Fausse alerte

Depuis la page (bouton « Fausse alerte »), le fichier sort de quarantaine et son empreinte devient une
exception. Tu peux aussi ajouter une exception pour un dossier, une empreinte ou une règle
(« ajoute une exception pour /chemin »). Un fichier que tu as fait restaurer n'est pas remis en
quarantaine dans ton dos.

### Vérifier que ça marche

Crée un fichier texte nommé `eicar.com` contenant exactement cette ligne, dans tes téléchargements :

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

En deux secondes environ, l'alerte « Ullr : Test antivirus EICAR » apparaît. C'est le fichier de test
standard de tous les antivirus : il ne fait rien.

## 4. Mode de fonctionnement

Ullr travaille en quatre étages.

### Connaître — la base de signatures

Les sources sont interrogées toutes seules (chacune à son rythme). Chaque mise à jour devient un
**paquet** :

1. les données sont lues et nettoyées (formats vérifiés, doublons retirés, indicateurs peu sûrs écartés) ;
2. le paquet est **essayé avant d'être activé** : le fichier EICAR doit toujours être détecté, et aucun
   fichier sain d'un corpus (fichiers d'Odin et programmes du système) ne doit l'être ;
3. une liste polluée est **refusée** : l'ancienne version reste en service et tu es prévenu ;
4. une règle importée qui se trompe sur des fichiers sains est **mise de côté** toute seule (elle est listée
   dans « exceptions ») ;
5. le paquet est **signé** (Ed25519), numéroté, avec la date et le compte de chaque source ;
6. les trois dernières versions sont gardées : on peut **revenir en arrière**.

Au démarrage, la signature et l'empreinte de chaque fichier du paquet sont vérifiées. Un paquet modifié
sur le disque est refusé : Ullr revient à la dernière version saine, sinon aux règles de base.

> La clé de signature est créée sur ta machine et y reste. Elle protège contre un paquet abîmé ou
> modifié par un autre compte. Elle ne protège pas contre quelqu'un qui a déjà les droits d'Odin sur
> la machine.

### Détecter — quatre moyens, un score

| Moyen | Exemple | Fiabilité |
|---|---|---|
| **Empreinte** (SHA-256) | « Malware connu : AgentTesla » | sûre |
| **Règle** (Galdr maison, ou YARA importée) | « PHP.Webshell (eval encodé) » | sûre sur un fichier qui peut se lancer |
| **Heuristique** | « Programme déguisé en document » | indice |
| **Réputation** (VirusTotal, MalwareBazaar, CIRCL) | « 39 antivirus sur 69 le jugent dangereux » | confirme ou calme un soupçon |

Chaque trouvaille a un poids (0 à 100) et **sa raison écrite**. Les poids se cumulent sans dépasser
100 :

| Score | Niveau | Ce que fait Ullr |
|---|---|---|
| moins de 35 | rien | l'indice est noté dans le verdict, sans alerte |
| 35 à 59 | moyenne | alerte dans le fil d'Odin, « à vérifier » |
| 60 à 84 | haute | alerte sur ta messagerie |
| 85 et plus | critique | alerte même en « Ne pas déranger » |

**Réputation** : seule l'**empreinte** du fichier part sur Internet, jamais le fichier. Elle n'est
demandée que pour un soupçon sérieux, et seulement si tu as mis une clé. La réponse est gardée 7 jours.

**Fichiers passifs.** Une documentation, un fichier de données ou du code source ne se lance pas tel
quel. S'il contient le texte d'une attaque, c'est presque toujours un cours, un test ou une règle de
détection. Une règle n'y est qu'un indice : jamais de quarantaine. Sans cela, un antivirus se reconnaît
dans son propre code.

**Là où les fichiers arrivent.** Décrire ce que fait un script ne prouve rien : un installateur honnête
télécharge et lance, lui aussi. Ces indices pèsent le double dans les téléchargements, les dossiers
temporaires, la boîte de réception et les supports amovibles.

**Dossiers de tests.** Dans un dossier `tests`, `fixtures` ou `exemples`, une règle ne déplace rien :
c'est toi qui décides.

Chaque détection porte, quand elle existe, le code de la technique d'attaque (MITRE ATT&CK, par
exemple T1105).

### Relier — les incidents

Un signal seul ne dit rien. Plusieurs signaux qui touchent la même chose (même adresse, même
programme, même fichier, ou la même machine dans les mêmes minutes) racontent une attaque.

| Appli | Ce qu'elle signale à Ullr |
|---|---|
| Loki | un attaquant tombé dans un piège |
| Skögul | un processus suspect, un port qui s'ouvre |
| Geri | un programme qui parle à une adresse malveillante ou nouvelle |
| Garmr | une adresse bannie |
| Forseti | un fichier système modifié |
| Eir | le processeur saturé |
| Naglfar | un conteneur arrêté tout seul |
| Hermóðr | une machine disparue du réseau |
| Himinbjörg | un mouvement aux heures surveillées |
| Odin | un mot de passe refusé à la connexion |

Un incident s'ouvre s'il y a un **vrai indice d'attaque** et, soit deux applis qui se recoupent, soit
un signal qui se suffit (rançongiciel en cours, mot de passe d'Odin essayé cinq fois). Il a un titre, un
score, une chronologie, et il n'est annoncé qu'une fois (puis seulement s'il s'aggrave).

Exemples : « Cette machine communique avec un attaquant », « Comportement de rançongiciel »,
« Quelqu'un essaie de deviner ton mot de passe d'Odin », « Installation furtive possible »,
« Quelqu'un était là : mouvement aux heures surveillées, puis un support branché ».

### Répondre — toujours annulable

| Odin fait seul (tu peux annuler) | Odin propose seulement |
|---|---|
| mettre un fichier sûr en quarantaine | tuer un processus |
| bannir 24 h une adresse **extérieure** d'un incident sérieux (par Garmr) | couper le réseau, restaurer depuis Sindri |
| écrire la note de l'incident dans le Cerveau | supprimer un fichier |

Une adresse du réseau local n'est jamais bannie. Un fichier du système n'est jamais déplacé. Aucune
décision de ce genre ne vient d'une IA : ce sont des règles écrites, et tout est noté dans le journal des
manips.

### Protection en continu

- **À l'arrivée** : les téléchargements et la boîte de réception d'Odin sont surveillés ; un fichier qui
  arrive est analysé en deux secondes environ.
- **Supports amovibles** : une clé USB ou un disque branché est analysé (les 20 000 premiers fichiers).
- **Sentinelles** : deux faux documents dans un dossier. Si quelque chose les chiffre ou les renomme,
  c'est un rançongiciel : incident critique immédiat.
- **Rafale** : 80 fichiers réécrits en 10 secondes dans un dossier surveillé déclenchent le même signal.
- **Analyses planifiées** : ralenties si la machine est chargée, une seule à la fois, annulables. Les
  sites web (`/var/www`…) sont analysés chaque nuit.

## 5. Les sources

| Source | Apporte | Clé | Rythme | Conditions |
|---|---|---|---|---|
| MalwareBazaar | empreintes et familles des malwares récents | `ABUSE_CH_KEY` | 6 h | données CC0 |
| ThreatFox | serveurs de commande, sites, empreintes | `ABUSE_CH_KEY` | 6 h | données CC0 |
| URLhaus | adresses qui distribuent des malwares | `ABUSE_CH_KEY` | 6 h | données CC0 |
| OpenPhish (flux public) | pages d'hameçonnage actives | — | 12 h | pas de revente |
| Stalkerware Indicators | applis espionnes pour téléphone | — | 3 jours | licence du dépôt, à citer |
| signature-base | règles YARA (portes dérobées, outils de piratage, rançongiciels) | — | 7 jours | Detection Rule License 1.1, auteur à citer |
| CISA KEV | failles réellement exploitées | — | 24 h | domaine public |
| VirusTotal | réputation d'une empreinte | `VT_API_KEY` | à la demande | pas d'usage commercial |
| CIRCL hashlookup | fichiers connus de logiciels légitimes | — | à la demande | service public gratuit |
| Phishing.Database, YARA Forge | listes et règles plus larges | — | désactivées | à activer depuis la page |

ClamAV, Malpedia, AlienVault OTX, Kaspersky OpenTIP, AndroZoo, NVD, MITRE ATT&CK, Microsoft Security
Intelligence et Objective-See sont listées comme **références** : elles ne sont pas branchées (accès
sur invitation, conditions à vérifier, ou simple documentation). Le moteur de ClamAV n'est pas
intégré ; ses signatures d'empreintes (`.hsb`) peuvent être importées à la main, comme un fichier de
règles YARA ou une liste d'empreintes (« importe /chemin/fichier »).

**Aucun échantillon de malware n'est jamais téléchargé** : seulement des empreintes, des adresses et
des règles.

## 6. Liens avec les autres applis

| Lien | Ce qui se passe |
|---|---|
| Loki → Ullr | le fichier qu'un pirate dépose dans un piège est analysé, sans jamais être lancé |
| Skögul → Ullr | le programme d'un processus suspect est analysé |
| toutes les applis → Ullr | leurs signaux rejoignent les incidents |
| Ullr → Garmr | l'adresse extérieure d'un incident sérieux est bannie 24 h (annulable) |
| Ullr → Saga (le Cerveau) | chaque incident sérieux a sa note, complétée quand il s'aggrave ou est classé |
| Ullr → Forseti | toutes ses alertes rejoignent le fil commun et ta messagerie |
| Ullr → Bragi | une alerte critique est dite à voix haute (si activé) |
| Draupnir | les événements `menace` et `incident` peuvent lancer tes automatisations |

## 7. Limites connues

- Pas de garantie de détection, pas de validation par un laboratoire indépendant.
- Ullr tourne sur la machine d'Odin (Linux, macOS, Windows avec Node). Il n'y a **pas d'agent** à
  installer sur d'autres postes, ni d'appli Android ou iOS. Une page web ne peut pas lire les disques
  d'un autre ordinateur.
- Pas de blocage avant l'ouverture d'un fichier (cela demande un pilote du système) : la protection
  « à l'arrivée » analyse juste après l'écriture.
- Pas de nettoyage d'un fichier infecté : quarantaine, ou rien.
- Archives à mot de passe, RAR et 7z : non ouvertes (signalées quand un programme est dedans).
- Au-delà de 48 Mo, l'empreinte complète est calculée, mais le contenu n'est analysé que sur les
  8 premiers Mo. Les expressions régulières ne regardent que les 2 premiers Mo.
- Règles YARA : un sous-ensemble est compris (chaînes, octets, expressions, `N of`, `filesize`,
  `uint16(0)`). Les règles qui utilisent des modules ou des boucles sont écartées et comptées.
- Supports amovibles : Linux seulement. Liste des logiciels installés (pour les failles) : Debian, Ubuntu
  et dérivés (`dpkg`) seulement pour l'instant.
- Pas de classifieur par apprentissage automatique : les décisions viennent de règles lisibles.
- Vitesse mesurée : environ 120 Mo par seconde sur un cœur, avec 700 règles.

## 8. Tests

```bash
npm test                      # 21 tests pour Ullr, 33 pour les liens entre applis, 22 phrases comprises sans IA
npm run banc -- antivirus     # vraies sources, vraies archives, vrai disque (34 vérifications)
npm run banc -- pieges        # Loki → Ullr → Garmr contre un attaquant simulé
```

Mesures faites pendant le développement :

| Mesure | Résultat |
|---|---|
| Fichiers sains analysés (bibliothèques, documentation, programmes) | 128 141 (2,9 Go) |
| Fausses alertes après réglage | 0 |
| Échantillons inoffensifs de chaque classe reconnus | 22 sur 22 |
| Programmes de `/usr/bin` avec les 714 règles réelles | 970, aucune fausse alerte |

Le taux de détection sur de vrais malwares **n'a pas été mesuré** : cela demande un laboratoire
isolé, qui n'existe pas ici.

## 9. Par rapport au cahier des charges

| Exigence | État |
|---|---|
| Moteur maison, sans moteur tiers | fait |
| Analyses à la demande : fichier, dossier, archive, téléchargement, support monté | fait |
| Analyses planifiées, exclusions, seuil de charge, annulation | fait (reprise après arrêt : non) |
| Signatures : empreintes SHA-256 et règles | fait |
| Détection des classes citées | fait pour les signatures et heuristiques statiques ; pas d'analyse du comportement d'un programme qui tourne |
| Score explicable, revue humaine, jamais 100 % | fait |
| Quarantaine, restauration, exceptions, fausses alertes | fait |
| Protection en temps réel | partiel : analyse à l'arrivée, pas de blocage avant ouverture |
| Paquets signés, vérification, retour arrière, hors ligne | fait (un seul canal de déploiement) |
| Chaîne de mise à jour : format, doublons, confiance, test sur corpus sain, signature, retour arrière | fait (corpus malveillant : non, pas de laboratoire) |
| Sources : MalwareBazaar, ThreatFox, URLhaus, VirusTotal, CISA KEV | fait (les trois premières non essayées en ligne ici : clé absente) |
| Sources : Malpedia, OTX, Kaspersky, AndroZoo, NVD | listées en référence, non branchées |
| Aucun fichier envoyé à un tiers | fait (empreintes seulement) |
| Aucune action grave décidée par une IA, journal d'audit | fait |
| Périphériques USB : analyse des supports | fait sur Linux |
| Inventaire, santé, processus, parc | par les applis existantes (Eir, Skögul, Hermóðr) ; pas d'historique des mises à jour des postes |
| Tableau de bord, filtres, alertes | page Ullr et fil de Forseti ; export CSV/PDF : non |
| Rapport horodaté : chemin, empreinte, règle, gravité, action | fait |
| Test EICAR | fait (seul, compressé, en archive, en archive dans une archive) |
| Précision, rappel, temps d'analyse | fausses alertes et vitesse mesurées ; rappel non mesuré |
| Agents Windows, macOS, Android, iOS ; MDM | non fait |
| Partage d'écran et prise en main à distance | non fait |
| Classifieur par apprentissage automatique | non fait |
| OpenID Connect, plusieurs organisations, rôles | non fait (un seul propriétaire, compte et sessions) |
| Double authentification | non fait (recommandé) |
