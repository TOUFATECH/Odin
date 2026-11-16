# Achille — les garde-fous

Achille sert à tester la sécurité de **tes propres** sites et appareils. Il ne vise jamais les sites des autres.
Ce document dit ce qu'il a le droit de toucher, comment il le prouve, ce qu'il refuse et ce qu'il garde.

## 1. La portée : ce qui est à toi

Achille n'accepte une cible que si elle est dans ta portée :

- **une adresse de ta maison** : 10.x, 172.16 à 172.31, 192.168.x, 100.64/10, fd00::/8 ;
- **un nom local** (`.lan`, `.local`, `.home`, `.home.arpa`, `.internal`, `.ts.net`) **qui mène bien à une adresse de ta maison** ;
- **un domaine que tu as déclaré et prouvé**, et ses sous-domaines.

Un nom est toujours résolu, puis **chaque adresse obtenue est revérifiée** : un nom « de la maison » qui mène à
Internet est refusé (protection contre la redirection DNS). La connexion part vers l'adresse vérifiée, jamais
résolue une seconde fois.

Toujours refusés, même avec ton accord : la machine d'Odin elle-même (boucle locale, `localhost`) et les adresses
des métadonnées d'un hébergeur (169.254.x, `metadata.google.internal`…).

## 2. La preuve de propriété d'un domaine

1. « Déclarer un de mes domaines » (action grave) : Achille te donne un jeton `odin-achille-…`.
2. Publie ce jeton, au choix :
   - un enregistrement DNS **TXT** nommé `_odin-achille.<ton domaine>` avec le jeton pour valeur ;
   - ou un fichier `https://<ton domaine>/.well-known/odin-achille.txt` qui contient le jeton.
3. « Vérifier la preuve » (action grave) : une lecture DNS, puis au besoin une seule requête vers le fichier.

Tant que la preuve n'est pas validée, le domaine reste hors de ta portée.

## 3. Ce qui est refusé

- Toute cible hors de ta portée : le proxy répond `403 refusé : hors de ta portée`, et c'est noté au journal.
  Pas de tunnel aveugle : un `CONNECT` vers un autre site est refusé, pas relayé.
- Tout appareil non autorisé : seuls les appareils dont tu as donné l'adresse IP (et la machine d'Odin) peuvent
  passer par le proxy.
- Le scanner actif, les listes d'attaque, la force brute, les envois en rafale : Achille n'en a pas.
  La recherche des défauts est **passive** : elle lit les réponses déjà reçues, sans rien envoyer.
- Le rejeu d'une requête : **une par seconde, 300 par jour au plus**, portée revérifiée à chaque envoi.
- Le contrôle planifié (tâche Talos « Contrôle passif de tes sites ») : une fois par semaine, **une seule requête
  GET** par domaine prouvé.
- Un certificat invalide sur un site public : refusé. Sur une adresse de la maison : accepté, mais noté comme défaut.

## 4. Le proxy d'essai

- Port 8890, **éteint par défaut**. Il s'allume par une action grave (ton accord) et **s'éteint tout seul** après
  2 h (réglable de quelques minutes à 12 h).
- Le HTTPS de tes sites est lu grâce à l'autorité d'Achille (voir §6). Le `Host` d'une requête dans un tunnel ne
  change pas la cible : c'est l'hôte du `CONNECT`, vérifié, qui compte.

## 5. Le journal

Le journal `achille` (base `ACHILLE_ODIN`) garde tout ce qui a été testé ou refusé : méthode, lien, code, durée,
taille et en-têtes. Les valeurs secrètes sont remplacées par `●●●●` : `Authorization`, `Cookie`, `Set-Cookie`,
`X-Api-Key`, et tout en-tête ou paramètre de lien dont le nom contient `token`, `key`, `secret`, `pass` ou
`session`. Les **corps** des échanges ne sont jamais écrits sur le disque : ils restent en mémoire (256 Ko au plus
chacun, les 200 derniers échanges), car ils peuvent contenir des données privées.

## 6. Le certificat d'Achille : installer et retirer

Achille a sa propre autorité de certification, distincte de celle d'Odin. Elle est **limitée par construction**
(contrainte de noms) aux adresses privées, aux noms locaux et à tes domaines prouvés : un appareil qui lui fait
confiance refuserait quand même un certificat qu'elle aurait signé pour un autre site. Sa clé privée est chiffrée
avec la clé de la machine (`ca.json`, droits 600). Quand la liste de tes domaines change, l'autorité est refaite et
la page te dit de la réinstaller.

Bouton « Certificat » : il remet le fichier `achille-autorite.crt`.

- **Windows** : double-clic → Installer le certificat → Ordinateur local → « Autorités de certification racines de confiance ».
- **macOS** : double-clic → Trousseaux d'accès (Système) → ouvrir le certificat → « Toujours approuver ».
- **Android** : Paramètres → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA.
- **iOS** : ouvrir le fichier → Réglages → Profil téléchargé → Installer, puis Général → Informations → Réglages des certificats → activer Achille.
- **Linux** : copier dans `/usr/local/share/ca-certificates/achille.crt` puis `sudo update-ca-certificates` (Firefox : Paramètres → Certificats → Importer).

**Retirer** : supprime « Achille (Odin) » de la même liste. Fais-le quand tu as fini tes essais sur un appareil.
