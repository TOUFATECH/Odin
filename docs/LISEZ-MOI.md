# docs/ — la documentation d'Odin

| Fichier | Quoi |
|---|---|
| [`etat.json`](etat.json) | **l'état de chaque chose** : fait, en cours, à venir. Seule source : le guide et le README la lisent (`npm run guide`) |
| [`utiliser-odin.md`](utiliser-odin.md) | le détail des fonctions, toutes les commandes, la configuration, le dépannage |
| [`installer.md`](installer.md) | installer, dans un conteneur, mettre à jour, désinstaller |
| [`plan-ports.md`](plan-ports.md) | le port de chaque appli |
| [`sso-protocole.md`](sso-protocole.md) · [`pegase-protocole.md`](pegase-protocole.md) · [`plume-protocole.md`](plume-protocole.md) | les contrats entre Odin et les programmes qui s'y connectent |
| [`strata-contrat.md`](strata-contrat.md) · [`strata-installation.md`](strata-installation.md) | brancher un serveur de prévisions météo sur Zeus |
| [`antivirus-ullr.md`](antivirus-ullr.md) · [`achille-garde-fous.md`](achille-garde-fous.md) · [`sites-idunn.md`](sites-idunn.md) · [`meteo-sources.md`](meteo-sources.md) | le fonctionnement de quelques applis |
| [`cerveau-deux-etages.md`](cerveau-deux-etages.md) · [`voix-v2.md`](voix-v2.md) · [`bases-plan.md`](bases-plan.md) · [`zero-instance-externe.md`](zero-instance-externe.md) | architecture et plans |
| `odin-couverture-catalogue.xlsx` | chaque logiciel du catalogue et l'appli d'Odin qui le remplace |

**Quand une demande nouvelle change le plan** : ajoute ou modifie l'élément dans `etat.json` (« à venir »), écris le
chapitre concerné du guide (`tools/guide/template.html`), puis `npm run site`. Quand un chantier est commité : passe-le
à « fait » avec son commit et ses fichiers ; `npm test` refuse « fait » si ce n'est pas vrai.
