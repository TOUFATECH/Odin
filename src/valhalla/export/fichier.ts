// Export des pages d'applis · le fichier remis à l'utilisateur.
// Quatre formats écrits par Odin lui-même, sans rien installer : Markdown, JSON, Word et PDF.
// Google Docs : Odin n'a pas (encore) de connexion à un compte Google ; plutôt que d'en inventer une, on le dit.

import { enDocx } from './docx.ts';
import { enJson, enMarkdown } from './markdown.ts';
import { jourIso, type PageExport } from './page.ts';
import { enPdf } from './pdf.ts';

export type Format = 'md' | 'json' | 'docx' | 'pdf';
/** Les formats proposés, dans l'ordre des boutons. */
export const FORMATS: ReadonlyArray<{ id: Format; nom: string; ext: string }> = [{ id: 'docx', nom: 'Word', ext: 'docx' }, { id: 'pdf', nom: 'PDF', ext: 'pdf' }, { id: 'md', nom: 'Markdown', ext: 'md' }, { id: 'json', nom: 'JSON', ext: 'json' }];
export const estFormat = (v: string): v is Format => FORMATS.some((f) => f.id === v);
/** Ce qu'on répond à qui demande Google Docs. */
export const GOOGLE_ABSENT = 'Odin n\'est pas encore relié à un compte Google. En attendant : exporte en Word (.docx), puis ouvre ce fichier dans Google Docs (Fichier → Ouvrir → Importer).';
export const estGoogle = (v: string) => /^(gdocs?|google(?:[ _-]?docs?)?)$/i.test(v);

/** Un nom de fichier sans caractère gênant pour Windows, macOS ou Linux. */
const nomSur = (t: string) => t.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80) || 'Odin';

/** « Nom de l'appli - date.ext » (avec l'onglet quand un seul est exporté). */
export function nomDuFichier(p: PageExport, format: Format): string {
  return `${nomSur(p.app.name)}${p.onglet ? ` - ${nomSur(p.onglet)}` : ''} - ${jourIso(new Date(p.at))}.${FORMATS.find((f) => f.id === format)!.ext}`;
}

/** Le fichier d'une page dans le format demandé. Pur. */
export function fichier(p: PageExport, format: Format): { nom: string; data: Buffer } {
  const data = format === 'md' ? Buffer.from(enMarkdown(p), 'utf8') : format === 'json' ? Buffer.from(enJson(p), 'utf8') : format === 'docx' ? enDocx(p) : enPdf(p);
  return { nom: nomDuFichier(p, format), data };
}
