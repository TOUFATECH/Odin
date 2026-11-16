# Maquettes d'Odin

Une page par appli, plus l'interface d'Odin. Chaque page se regarde sur téléphone, tablette et ordinateur,
dans les 51 thèmes d'Odin (3 Valhalla, 32 thèmes, 16 événements).

```
node tools/maquettes/build.mjs        # refait toutes les pages dans docs/maquettes/
node tools/maquettes/build.mjs pegase # une seule appli
node tools/maquettes/verifier.mjs     # contrôle : rien ne dépasse, mêmes hauteurs partout (Chrome requis)
```

## Ce qui est relu à chaque passage

- la liste des applis et leur fiche : `src/valhalla/modules/*.ts`, `src/valhalla/odin.ts`, `src/valhalla/names.ts` ;
- les icônes : `src/web/app-icons.js` ;
- les thèmes : `src/web/themes.js`.

Une nouvelle appli ou un nouveau thème apparaît donc tout seul. Une appli sans contenu écrit dans `applis.mjs`
reçoit une maquette faite à partir de sa fiche (ce qu'elle fait, ses modes) ; on l'enrichit ensuite dans `applis.mjs`.

## Règles d'alignement (socle.css)

- une seule hauteur pour boutons, onglets, champs, interrupteurs et entrées du menu : `--ctl` (44 px) ;
- 4 onglets au plus, tous de la même largeur ;
- cartes de même hauteur sur une même ligne, chiffres clés de même taille ;
- sur téléphone, un tableau devient une liste : la page ne défile jamais de côté.

## Fichiers

- `build.mjs` : fabrique les pages ; `socle.css` et `socle.js` : le socle commun ;
- `applis.mjs` : le contenu de chaque appli ; `odin.mjs` : l'interface d'Odin et ses Réglages ;
- `liens.json` : l'adresse de la maquette publiée de chaque appli ;
- `docs/maquettes/rapport-themes.md` : les couleurs trop pâles de chaque thème, à reporter dans `themes.js`.

Non maquettés : Hestia et Midgard (ils ont déjà leurs thèmes), l'Accueil et la Maison de l'interface.
Les blocs de Vénus (Odéon, Delta, Sirius, Pléiades, Odyssée, Comète) sont dans la maquette de Vénus.
