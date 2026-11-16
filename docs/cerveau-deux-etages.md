# Le Cerveau d'Odin en deux étages : la surface et le profond

> Document d'architecture. Il explique simplement comment Odin organise ses réponses en deux étages
> inspirés du fonctionnement du cerveau, avec ses sources et les idées reçues écartées.
> « Inspiré du cerveau » veut dire **inspiré de son rôle, pas de son mécanisme** : Odin ne pense pas,
> ne ressent pas, n'est pas conscient et n'a pas d'inconscient.

## L'idée en une phrase

Odin lit le **même Cerveau de notes** avec deux étages complémentaires :

- **Noûs — le cerveau profond** (`src/brain/nous/`) : un petit réseau de neurones entraîné sur la machine.
  Il travaille en continu et sans bruit : il reconnaît la demande, trie et rappelle, prévoit, prépare le
  contexte, propose une première réponse, repère les régularités et fournit les **plongements** (recherche
  par le sens, sans serveur externe).
- **Le Cerveau d'Odin — le cerveau de surface** (notes de `src/brain/vault.ts`, liens vivants, chemin de
  `src/core/agent.ts`) : les faits écrits et confirmés, le raisonnement pas à pas, la vérification, la
  décision, la parole, l'action et le frein.

**La surface a toujours le dernier mot**, et le propriétaire passe au-dessus d'elle (pouce, correction,
« refais »).

## Le « 80-20 » : une image, pas une loi

Le propriétaire a résumé l'idée par « 80-20 : Noûs c'est 80, Odin c'est 20 ». Chez l'humain, la plus grande
part du travail se fait en profondeur, sans bruit ; la petite part consciente lit, raisonne, décide et parle.

Mais **aucune mesure publiée ne dit que le cerveau « fonctionne à 80-20 »** (ni 90-10, ni « 95 % inconscient » :
ce dernier chiffre vient d'un livre de marketing, Zaltman 2003). Dans Odin, le 80-20 devient donc une
**répartition réelle et mesurée** — affichée telle qu'elle est — avec **80-20 comme cible** vers laquelle on
tend, **jamais un poids forcé** qui ferait passer une moins bonne réponse. Au départ, la part réelle de Noûs
sera faible : elle viendra d'abord du travail invisible (plongements, tri, reconnaissance), puis des réponses
à mesure qu'il gagnera ses duels.

Garantie vérifiée par un essai : **l'arbitre du duel ne reçoit jamais ces compteurs** (sa signature ne les
mentionne pas), donc le chiffre ne peut pas forcer le choix d'une réponse.

## Ce que fait chaque étage

### Le profond (Noûs) — il propose, il n'agit jamais
- **P1 Reconnaître** : plongement de la demande, type (question, ordre, conversation), domaine, déjà-vu.
- **P2 Rappeler** : classer les candidats (notes, souvenirs, applis) par proximité de sens, en plus du rappel
  par association déjà fait par `src/brain/rappel.ts`.
- **P3 Préparer** : choisir 3 à 5 éléments pour le tableau de travail de la surface.
- **P4 Prévoir** (à gros grain) : la réaction probable, la prochaine demande, le résultat attendu d'une habitude.
- **P5 Proposer** : une réponse en texte avec sa confiance.
- **P6 Proposer une habitude** : une régularité observée, regroupée en un bloc nommé.
- **P7 Plongements** de la mémoire (comptés à part, pas dans la « part du travail »).

### La surface (le Cerveau d'Odin) — elle décide, elle agit
- **S1 Faits** : seuls les faits écrits par le propriétaire ou confirmés en mémoire font foi, avec leur source.
- **S2 Raisonner** pas à pas (grand modèle, outils) au niveau N3.
- **S3 Vérifier** : critères de l'arbitre (a → e) et relecture avant l'envoi.
- **S4 Décider** le niveau (N1/N2/N3) et le gagnant du duel.
- **S5 Parler et agir** : **seule la surface exécute un outil**.
- **S6 Freiner** : un veto arrête une proposition ou une habitude ; chaque veto devient une leçon pour Noûs.
- **S7 Apprendre vite** : une note, un lien ou une correction comptent tout de suite.

## Cinq améliorations tirées de la recherche

1. **Séparer la vitesse d'apprendre de la vitesse de répondre** (systèmes d'apprentissage complémentaires,
   Kumaran, Hassabis & McClelland 2016 ; McClelland et al. 1995). Le Cerveau apprend d'un coup, comme
   l'hippocampe ; Noûs apprend lentement et généralise, comme le cortex, par rejeu la nuit — mais c'est Noûs
   qui **répond** le plus vite. Noûs n'est jamais la seule copie d'un fait.
2. **Ce n'est pas un poids de 80 % qui choisit qui répond, c'est la fiabilité mesurée et calibrée** de chaque
   étage, sujet par sujet (arbitrage par l'incertitude, Daw, Niv & Dayan 2005 ; Keramati et al. 2011). La part
   de Noûs monte d'elle-même quand il gagne.
3. **Trois niveaux, et non deux** : N1 réflexe (Noûs + contrôles éclair), N2 vérifié (Noûs + un fait du
   Cerveau), N3 réfléchi (chemin complet d'Odin). Un détecteur de conflit peu coûteux réveille la surface
   (suivi des conflits, Botvinick et al. 2001), et un frein peut arrêter une proposition (Aron et al. 2014,
   débattu).
4. **Noûs apprend surtout de ses erreurs de prédiction** (écart entre la confiance annoncée et le résultat ;
   erreur de prédiction de la récompense, Schultz, Dayan & Montague 1997). Ce qui est surprenant ou corrigé
   est rejoué en priorité la nuit (marquage de la nouveauté, Lisman & Grace 2005), mêlé à de l'ancien savoir
   et à intervalles espacés (espacement, Cepeda et al. 2006 ; effet de test, Roediger & Karpicke 2006).
5. **Une réponse se fait en trois temps** : idée, mise en mots, relecture avant l'envoi (production de la
   parole, Levelt 1989). L'essentiel d'abord, 3 à 4 éléments au plus (mémoire de travail d'environ 4 blocs,
   Cowan 2001), la confiance dite quand elle compte, l'origine (« Cerveau » ou « Noûs ») visible avec son
   **vrai** signal — jamais une justification inventée après coup (Nisbett & Wilson 1977).

## Le duel, en bref

À chaque réponse, **deux propositions sont préparées en même temps** : celle d'Odin (son chemin actuel) et
celle de Noûs. L'arbitre choisit « la plus logique » par des critères **écrits et dans l'ordre** :

- **(a)** elle ne contredit pas ce que le propriétaire a donné ni ce qui est confirmé en mémoire ;
- **(b)** elle répond à la question posée ;
- **(c)** elle s'appuie sur des faits que le Cerveau retrouve (sinon elle dit qu'elle ne sait pas) ;
- **(d)** elle est cohérente (dates, chiffres, pas de contradiction interne) ;
- **(e)** à égalité, la plus courte et la plus claire.

L'arbitre regarde le **raisonnement** derrière chaque proposition, pas seulement la réponse finale. Il **ne
tire jamais au sort** ; en cas de doute, la proposition d'Odin passe. Une seule réponse est donnée, avec son
origine visible ; le pouce ou la correction du propriétaire **priment** sur l'arbitre. Les deux étages
évoluent à chaque duel.

## Les niveaux et les réponses automatiques

Une réponse part en **réflexe (N1)** seulement si **toutes** ces conditions tiennent : domaine non sensible et
réponse réversible ; fiabilité de Noûs ≥ 0,90 (borne basse de Wilson, ≥ 30 essais notés) ; écart de
calibration ≤ 0,05 ; aucune alerte de conflit ; aucune erreur récente. Sur un **sujet sensible** (sécurité,
argent, santé, action sur une appli), c'est **toujours N3** : seul le chemin d'Odin répond et agit ; Noûs ne
propose que du texte et ne déclenche jamais d'action.

Une habitude redevient réfléchie dès qu'elle se trompe (pouce bas, correction, reformulation, résultat
différent de la prédiction) ou dès que **sa raison change** (test de dévaluation : si la note qui la justifiait
est modifiée ou périmée, l'habitude est suspendue). Les preuves d'habitudes rigides chez l'humain étant
fragiles (de Wit et al. 2018), on parle toujours de **régularités observées**, avec leur nombre et leur
confiance.

## Vie privée et honnêteté

Le corpus et les poids retiennent ce qu'Odin a lu : ce sont des **données privées**. Chiffrés au repos,
jamais envoyés dehors, jamais dans le dépôt. Les secrets sont masqués **avant** d'entrer dans le corpus
(Heimdall, plus le masquage propre à Noûs : « mot de passe », « mdp », e-mail, téléphone, IBAN). Effacer un
souvenir retire ses exemples du corpus ; **les poids ne désapprennent pas exactement** — on le dit, et on
propose « réentraîner sans ».

## Idées reçues écartées

- « Le cerveau fonctionne à 80-20 » (ou 95 % inconscient) : **aucune mesure publiée**. Image et cible seulement.
- « On n'utilise que 10 % du cerveau » : **faux** (Lilienfeld et al. 2010). Noûs n'est pas « la capacité cachée ».
- Système 1 / Système 2 comme deux organes séparés, l'intuitif toujours moins fiable : **contesté**
  (Melnikoff & Bargh 2018 ; De Neys 2023). Trois niveaux, pas une frontière rigide.
- « La mémoire de travail tient 7 éléments » : **dépassé** (plutôt 3 à 5 blocs ; Cowan 2001). Règle de sobriété.
- « Odin dort, rêve, ressent, est conscient » : **faux**. On parle de « réentraînement au repos inspiré du
  rôle du sommeil » (Diekelmann & Born 2010) et d'architecture « inspirée du fonctionnement du cerveau ».
- « Un neurone artificiel est un neurone » / « Noûs fonctionne comme le cerveau » : l'analogie porte sur le
  **rôle**, pas sur le mécanisme.
- « Profond = rapide en tout » : le profond **répond** vite mais **apprend lentement** ; c'est la surface qui
  apprend d'un coup.
- « Un petit réseau entraîné à la maison égale un grand modèle » : **non**. Noûs sert aux plongements, au tri,
  à la reconnaissance et aux réflexes, et il apprend des grands modèles.

## Sources principales

Double traitement et niveaux intermédiaires : Evans & Stanovich 2013 ; Melnikoff & Bargh 2018 ; De Neys 2023.
Arbitrage par l'incertitude : Daw, Niv & Dayan 2005 ; Keramati, Dezfouli & Piray 2011. Suivi des conflits et
valeur du contrôle : Botvinick et al. 2001 ; Shenhav, Botvinick & Cohen 2013 (débattu). Frein : Aron, Robbins
& Poldrack 2014 (débattu). Regroupement en blocs : Graybiel 2008. Modèles vers l'avant : Wolpert, Miall &
Kawato 1998. Habitudes humaines fragiles : de Wit et al. 2018. Erreur de prédiction : Schultz, Dayan &
Montague 1997. Systèmes d'apprentissage complémentaires : Kumaran, Hassabis & McClelland 2016 ; McClelland et
al. 1995. Oubli catastrophique : Kirkpatrick et al. 2017. Sommeil et mémoire : Diekelmann & Born 2010.
Schémas : Tse et al. 2007. Espacement : Cepeda et al. 2006. Effet de test : Roediger & Karpicke 2006. Oubli
utile : Richards & Frankland 2017 (débattu). Marquage de la nouveauté : Lisman & Grace 2005. Mémoire de
travail : Cowan 2001. Espace de travail global : Dehaene & Changeux 2011 (débattu, utilisé comme image).
Métacognition et calibration : Fleming & Lau 2014. Limites de la prédiction mot à mot : Nieuwland et al. 2018.
Idées reçues : Zaltman 2003 (origine du 95 %) ; Lilienfeld et al. 2010 (mythe des 10 %).

*Classiques non relus pendant la recherche, à vérifier avant tout texte public : Zwaan & Radvansky 1998
(modèle de situation), Clark & Brennan 1991 (terrain commun), Levelt 1989 (production), Grice 1975 (règles de
conversation), Nisbett & Wilson 1977 (explications après coup), Murdock 1962 (position dans une liste),
Desimone & Duncan 1995 (attention).*
