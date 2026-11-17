# tools/ — fabriquer le guide, le site et les références

| Commande | Ce qu'elle fait | Fichiers |
|---|---|---|
| `npm run guide` | fabrique **le guide** (`site/guide.html`) depuis le code des applis et `docs/etat.json`, et met à jour la partie « Fait, en cours, à venir » du README | `guide/build.ts`, `guide/template.html` (textes rédigés), `guide/etat.ts` |
| `npm run site` | fabrique les autres pages du site (`site/*.html`, `sitemap.xml`, `robots.txt`) depuis `site/` (fragments + gabarit), puis le guide | `site/build.ts`, `site/_layout.html`, `site/pages.json`, `site/*.html` |
| `npm run noyau:empreintes` | refait la version de référence des garde-fous (à lancer après les avoir modifiés, au moment de publier) | `noyau-empreintes.ts` |
| `node tools/soul-depart.ts …` | prépare, entraîne, exporte et vérifie un modèle de départ de Soul, sans rien de privé (aucun n'est livré aujourd'hui) | `soul-depart.ts` |

Les pages du site sont des fichiers générés : on modifie les fragments dans `tools/site/` ou le gabarit du guide, puis
on relance `npm run site`. Ne modifie pas `site/*.html` à la main.

Ailleurs : `planche-humeurs.mjs` et `render-moods.cjs` dessinent la planche des humeurs de la mascotte.
