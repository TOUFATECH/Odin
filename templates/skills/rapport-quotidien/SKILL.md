---
name: rapport-quotidien
description: Produire un rapport quotidien des fichiers modifiés dans l'espace de travail
version: 1
origin: human
status: active
---

# Rapport quotidien

Copie ce dossier (rapport-quotidien/) dans `~/.odin/skills/` pour l'activer, puis :
`odin cron add "0 18 * * 1-5" "Fais mon rapport quotidien" telegram TON_ID`

## Étapes
1. `shell` : `git status` puis `git log --since=midnight --oneline` (commandes en liste blanche, aucune validation).
2. Pour chaque fichier important modifié, `fs_read` les 40 premières lignes.
3. Rédige 5 puces maximum : ce qui a avancé, ce qui bloque, la prochaine action.

## Vérification
- Chaque puce cite un fichier ou un commit réel.
- Si rien n'a changé, dis-le en une phrase au lieu d'inventer.
