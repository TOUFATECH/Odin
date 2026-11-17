// Pygmalion — les modèles réutilisables : un gabarit de courrier, de tableau, de fiche. Un gabarit a des champs
// {{nom}} remplis par des valeurs ; une valeur n'est JAMAIS interprétée (pas de champ dans un champ, pas de formule :
// dans un tableau, une valeur reste un texte). Un champ non fourni reste visible « [nom ?] » : rien n'est inventé.
import type { Cellule, DemandeDocument, Format } from './types.ts';

export interface Modele {
  id: string; nom: string; champs: string[];
  /** les formats où il a du sens */
  formats: Array<Exclude<Format, 'zip' | 'tar.gz'>>;
  fabriquer(v: Record<string, string>, format: Exclude<Format, 'zip' | 'tar.gz'>): DemandeDocument;
}

/** Remplit {{champ}} une seule fois (la valeur insérée n'est jamais relue comme un gabarit). */
export function remplir(gabarit: string, v: Record<string, string>): string {
  return gabarit.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, k: string) => (Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]).replace(/\r/g, '') : `[${k} ?]`));
}

const val = (v: Record<string, string>, k: string) => (Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : `[${k} ?]`);

export const MODELES: Modele[] = [
  {
    id: 'courrier', nom: 'Courrier', champs: ['expediteur', 'destinataire', 'lieu', 'date', 'objet', 'corps', 'signature'],
    formats: ['docx', 'odt', 'pdf', 'rtf', 'html', 'md', 'txt'],
    fabriquer: (v, format) => ({
      format, titre: `Courrier — ${val(v, 'objet')}`,
      texte: remplir('{{expediteur}}\n\n{{destinataire}}\n\n{{lieu}}, le {{date}}\n\n**Objet : {{objet}}**\n\n{{corps}}\n\n{{signature}}', v),
      sources: [{ genre: 'modele', detail: 'modèle « Courrier »' }],
    }),
  },
  {
    id: 'tableau', nom: 'Tableau de suivi', champs: ['titre', 'colonnes', 'lignes'],
    formats: ['xlsx', 'ods', 'csv', 'html', 'md'],
    fabriquer: (v, format) => {
      const colonnes = val(v, 'colonnes').split(';').map((x) => x.trim());
      const lignes: Cellule[][] = val(v, 'lignes').split('\n').filter((l) => l.trim()).map((l) => l.split(';').map((x) => ({ texte: x.trim() })));
      const md = [`| ${colonnes.join(' | ')} |`, `| ${colonnes.map(() => '---').join(' | ')} |`, ...lignes.map((l) => `| ${l.map((c) => (c as { texte: string }).texte).join(' | ')} |`)].join('\n');
      return { format, titre: val(v, 'titre'), feuilles: [{ nom: val(v, 'titre'), lignes: [colonnes, ...lignes] }], texte: md, sources: [{ genre: 'modele', detail: 'modèle « Tableau de suivi »' }] };
    },
  },
  {
    id: 'fiche', nom: 'Fiche', champs: ['titre', 'resume', 'points', 'sources'],
    formats: ['docx', 'odt', 'pdf', 'html', 'md', 'rtf', 'pptx', 'odp'],
    fabriquer: (v, format) => {
      const points = val(v, 'points').split('\n').map((x) => x.trim()).filter(Boolean);
      return {
        format, titre: val(v, 'titre'),
        texte: `${val(v, 'resume')}\n\n## Points clés\n${points.map((p) => `- ${p}`).join('\n')}\n\n## Sources\n${val(v, 'sources')}`,
        diapositives: [{ titre: val(v, 'titre'), puces: [val(v, 'resume')] }, { titre: 'Points clés', puces: points }],
        sources: [{ genre: 'modele', detail: 'modèle « Fiche »' }],
      };
    },
  },
];
