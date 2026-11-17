# Fichiers partagés avec l'application Odin

Les applications de l'OS (Pégase, Agora) se fabriquent sans l'application Odin à côté. Les quelques fichiers de
l'application dont elles ont besoin sont **copiés ici**, tels quels, et ne se modifient jamais dans ce dossier : on les
recopie depuis la branche `main` du dépôt quand ils y changent.

Copiés le 17/11/2026 depuis `main`, commit `5253953426a7a775fd5ce24f2a6bb8a122663eb4`.

| Fichier ici | Origine sur `main` | Objet git d'origine | Utilisé par |
|---|---|---|---|
| `plume.js` | `src/web/plume.js` | `997e633d1280d3e12ab852b0e38838cf33252e48` | `pegase-plume/construire.mjs` (fabrique `plume-page.js`) |
| `plume.css` | `src/web/plume.css` | `56d2a5771be738d7a12e1498bc3934d3f5b525c3` | `pegase-plume/construire.mjs` |
| `app-icons.js` | `src/web/app-icons.js` | `83cafcd5a8b50dd514b3379b780fd9dba259b275` | `pegase/scripts/icones.mjs` (fabrique `odin-icones.json`) |
| `names.ts` | `src/valhalla/names.ts` | `1cfd45d12e28b05efcef344d070551b3ee9f52e5` | `pegase/scripts/icones.mjs` (noms affichés des applis) |
| `odin-sso.mjs` | `clients/odin-sso.mjs` | `893f838034f8b5d01cd89d8889317061a53e72d5` | référence de la connexion unique : `pegase/src/main/odin-sso.mjs` et `agora-poste/src/main/odin-sso.mjs` en sont des copies **identiques** |

Une seule version de la connexion unique : celle de `clients/odin-sso.mjs`. (Avant le 17/11, Agora sur le poste en
avait une copie plus ancienne ; elle a été remplacée par celle-ci, qui ne fait qu'ajouter : renouvellement retenté,
état rendu par la sauvegarde.)

## Vérifier que les copies sont à jour

```
git fetch origin main
node applications/commun/verifier.mjs
```

Le script compare chaque fichier de ce dossier à sa version sur `origin/main`, et les deux copies de la connexion unique
à `odin-sso.mjs`. Il ne modifie rien ; il dit ce qui a changé. À lancer avant chaque nouvelle version de Pégase ou
d'Agora ; s'il signale un écart, recopier le fichier depuis `main`, mettre ce tableau à jour, puis refabriquer
(`node applications/pegase-plume/construire.mjs` pour Plume).
