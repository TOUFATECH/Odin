# test/ — les essais

Lancer tous les essais : `npm test`. Un seul fichier :

```bash
node --disable-warning=ExperimentalWarning --test test/<nom>.test.ts
```

| Où | Quoi |
|---|---|
| `*.test.ts` | les essais (`node:test`) : un fichier par appli ou par sujet ; aucun accès à Internet, des faux serveurs à la place |
| `helpers.ts` | un Odin jetable avec un faux modèle scripté (`makeOdin`, `call`) |
| `fixtures/`, `*-fixtures.ts`, `fake-*.ts` | faux appareils, faux services, échantillons |
| `banc/` | bancs de mesure (`npm run banc`), et le contrôle d'affichage des pages |
| `controle/` | l'entraînement de contrôle : scénarios par domaine, note par domaine (en cours) |
| `rapidite/` | mesures de vitesse, sur un faux web local |
| `taches/` | la campagne des tâches de tous les jours |
| `entrainement/` | outils d'entraînement de Soul |

Deux essais gardent la documentation honnête : `noyau.test.ts` (« la référence du dépôt est à jour ») et
`doc-etat.test.ts` (un élément « fait » de `docs/etat.json` doit être commité, et le README à jour).
