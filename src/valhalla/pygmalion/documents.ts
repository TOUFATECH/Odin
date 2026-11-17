// Pygmalion — fabriquer un document dans le bon format, par les générateurs écrits dans Odin (aucun logiciel de
// bureautique à côté). Réutilise ce qui existe (src/files/office.ts : Word et PowerPoint ; src/files/pdf.ts : PDF) et
// ajoute ce qui manquait (tableurs à cellules typées, OpenDocument, RTF, HTML, XML, Markdown, CSV, JSON).
// Chaque document porte la marque « création d'Odin » quand le format le permet ; sinon elle est au registre.
import { createDocx, createPptx } from '../../files/office.ts';
import { createPdf } from '../../files/pdf.ts';
import { ecrireCsv, ecrireXlsx } from './tableur.ts';
import { ecrireOdp, ecrireOds, ecrireOdt } from './odf.ts';
import { ecrireHtml, ecrireJson, ecrireMarkdown, ecrireRtf, ecrireTexte, ecrireXml } from './texte.ts';
import { BORNES, type Cellule, type Creation, type DemandeDocument } from './types.ts';

export interface Fabrique { octets: Buffer; moyen: string; marque: Creation['marque'] }

const feuillesDe = (d: DemandeDocument): Array<{ nom: string; lignes: Cellule[][] }> => {
  if (d.feuilles?.length) return d.feuilles;
  // à défaut, le texte devient une colonne (une ligne par ligne) — toujours en TEXTE
  return [{ nom: d.titre || 'Feuille1', lignes: String(d.texte ?? '').split('\n').filter((l) => l.trim()).map((l) => [{ texte: l }]) }];
};
const diaposDe = (d: DemandeDocument): Array<{ titre: string; puces?: string[] }> => {
  if (d.diapositives?.length) return d.diapositives;
  // à défaut, une diapositive par titre « ## » du texte, ses lignes en puces
  const out: Array<{ titre: string; puces: string[] }> = [];
  for (const l of String(d.texte ?? '').split('\n')) {
    const h = /^#{1,3}\s+(.*)$/.exec(l);
    if (h) out.push({ titre: h[1], puces: [] });
    else if (l.trim()) { if (!out.length) out.push({ titre: d.titre, puces: [] }); out[out.length - 1].puces.push(l.replace(/^\s*[-*•]\s+/, '')); }
  }
  return out.length ? out : [{ titre: d.titre, puces: [] }];
};

/** Fabrique les octets d'un document. Ne touche à aucun fichier. */
export function fabriquer(d: DemandeDocument, marque: string): Fabrique {
  const texte = String(d.texte ?? '');
  if (texte.length > BORNES.texte) throw new Error('texte trop long');
  const md = `${texte.replace(/\r/g, '').trim()}\n\n*${marque}*`;
  const titre = String(d.titre ?? '').slice(0, 300);
  const buf = (s: string) => Buffer.from(s, 'utf8');
  switch (d.format) {
    case 'docx': return { octets: createDocx(md, titre), moyen: 'écrivain Word d\'Odin (src/files/office.ts)', marque: 'dans le fichier' };
    case 'pptx': return { octets: createPptx([...diaposDe(d).map((x) => ({ title: x.titre, bullets: x.puces })), { title: 'Création d\'Odin', bullets: [marque] }], titre), moyen: 'écrivain PowerPoint d\'Odin (src/files/office.ts)', marque: 'dans le fichier' };
    case 'pdf': return { octets: createPdf(md, titre), moyen: 'écrivain PDF d\'Odin (src/files/pdf.ts ; polices standard, caractères hors Latin-1 remplacés)', marque: 'dans le fichier' };
    // tableurs : une feuille « Création d'Odin » porte la marque, sans toucher aux données
    case 'xlsx': return { octets: ecrireXlsx([...feuillesDe(d), { nom: 'Création d\'Odin', lignes: [[{ texte: marque }]] }]), moyen: 'écrivain de tableur d\'Odin (cellules typées)', marque: 'dans le fichier' };
    case 'ods': return { octets: ecrireOds([...feuillesDe(d), { nom: 'Création d\'Odin', lignes: [[{ texte: marque }]] }], titre), moyen: 'écrivain OpenDocument d\'Odin (tableur)', marque: 'dans le fichier' };
    case 'odt': return { octets: ecrireOdt(md, titre), moyen: 'écrivain OpenDocument d\'Odin (texte)', marque: 'dans le fichier' };
    case 'odp': return { octets: ecrireOdp([...diaposDe(d), { titre: 'Création d\'Odin', puces: [marque] }], titre), moyen: 'écrivain OpenDocument d\'Odin (présentation)', marque: 'dans le fichier' };
    case 'html': return { octets: buf(ecrireHtml(texte, titre, marque)), moyen: 'écrivain HTML d\'Odin (aucun script)', marque: 'dans le fichier' };
    case 'xml': return { octets: buf(ecrireXml(d.donnees ?? { texte }, 'document', marque)), moyen: 'écrivain XML d\'Odin (sans DOCTYPE)', marque: 'dans le fichier' };
    case 'rtf': return { octets: buf(ecrireRtf(texte, titre, marque)), moyen: 'écrivain RTF d\'Odin', marque: 'dans le fichier' };
    case 'md': return { octets: buf(ecrireMarkdown(texte, titre, marque)), moyen: 'écrivain Markdown d\'Odin', marque: 'dans le fichier' };
    case 'txt': return { octets: buf(ecrireTexte(texte, marque)), moyen: 'écrivain de texte d\'Odin', marque: 'dans le fichier' };
    case 'json': return { octets: buf(ecrireJson(d.donnees ?? { texte }, marque)), moyen: 'écrivain JSON d\'Odin', marque: 'dans le fichier' };
    // CSV : une ligne de marque fausserait les données d'un tableur qui l'importe → la marque est au registre
    case 'csv': return { octets: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf(ecrireCsv(feuillesDe(d)[0].lignes))]), moyen: 'écrivain CSV d\'Odin (débuts dangereux neutralisés)', marque: 'au registre' };
    default: throw new Error(`format inconnu : ${String((d as { format: unknown }).format)}`);
  }
}
