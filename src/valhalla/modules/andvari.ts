// Andvari · les logiciels : un dossier d'installateurs (disque ou partage réseau) gardé à jour depuis les sites
// officiels des éditeurs ou leurs dépôts GitHub, empreinte vérifiée, antivirus (Ullr), deux versions gardées.
// Reprend les idées de Ketarin, WingetUI / UniGetUI et Chocolatey (dossier d'installateurs), réécrit pour Odin.
import { forgeModule } from '../forge/forge.ts';
import { SOFT } from '../forge/sources.ts';

export const andvari = forgeModule({
  id: 'andvari', name: 'Andvari', kind: 'logiciel', noun: 'logiciel', nouns: 'logiciels', defaultDir: 'Logiciels',
  what: 'Les logiciels : un dossier d\'installateurs (disque ou partage réseau) gardé à jour depuis les sites officiels, aux jours que tu programmes, analysé par l\'antivirus, deux versions gardées.',
  from: ['Ketarin', 'UniGetUI', 'Chocolatey'], upstream: ['canneverbe/Ketarin', 'marticliment/UniGetUI', 'chocolatey/choco'],
  words: ['logiciels', 'installateurs', 'installateur', 'setup', 'programmes à installer', 'ketarin', 'mise à jour des logiciels', 'firefox', 'vlc', '7-zip'],
  sources: SOFT,
  extraDoes: ['chaque installateur téléchargé passe par l\'antivirus (Ullr) : s\'il est suspect, il est mis de côté et ne remplace pas l\'ancien'],
  // L'antivirus d'Odin sur chaque installateur (les ISO, très gros, sont vérifiés par l'empreinte de l'éditeur).
  after: async (ctx, path) => {
    const r = await ctx.call('ullr', 'fichier', { chemin: path }, 'vérifier un installateur téléchargé');
    const v = r.data as { level?: string; findings?: Array<{ threat?: string; name?: string }> } | undefined;
    return v?.level && ['moyenne', 'haute', 'critique'].includes(v.level) ? (v.findings?.map((f) => f.threat ?? f.name).filter(Boolean).join(', ') || v.level) : undefined;
  },
});
