// Eitri · les ISO : Windows, Linux, serveurs et outils de dépannage rangés dans un dossier (disque ou partage
// réseau), gardés à jour depuis les sites officiels, empreinte vérifiée, deux versions gardées.
// Reprend les idées d'ISOMan et des gestionnaires de miroirs (Netboot, Ventoy), réécrit pour Odin.
import { forgeModule } from '../forge/forge.ts';
import { ISO } from '../forge/sources.ts';

export const eitri = forgeModule({
  id: 'eitri', name: 'Eitri', kind: 'iso', noun: 'ISO', nouns: 'ISO', defaultDir: 'ISO',
  what: 'Les ISO (Windows, Linux, serveurs, dépannage) rangées dans un dossier ou un partage réseau, gardées à jour depuis les sites officiels aux jours que tu programmes, deux versions gardées.',
  from: ['ISOMan', 'netboot.xyz', 'Ventoy'], upstream: ['netbootxyz/netboot.xyz', 'ventoy/Ventoy'],
  words: ['iso', 'isos', 'image iso', 'images iso', 'image disque', 'isoman', 'distribution linux', 'ubuntu', 'debian', 'fedora', 'proxmox'],
  sources: ISO,
  extraDoes: ['Windows : Microsoft ne permet pas le téléchargement automatique, Odin repère tes ISO et donne la page officielle', 'clé USB de démarrage avec Rufus ou Ventoy, gardés à jour par Fjalar'],
});
