// Pygmalion — OpenDocument (.odt texte, .ods tableur, .odp présentation), écrit dans Odin d'après la norme publique :
// une archive zip dont la PREMIÈRE entrée est « mimetype », rangée sans compression, puis le manifeste, le contenu,
// les styles et les métadonnées. Les métadonnées ne portent que le titre et le générateur (aucun nom de personne,
// aucune machine, aucune date de création réelle de l'ordinateur).
import { zip } from '../../files/zip.ts';
import { corpsOds } from './tableur.ts';
import type { Cellule } from './types.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"';

const MIME = { odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation' } as const;

/** Un texte en ligne avec **gras** et *italique* (styles automatiques G et I). */
function enLigne(t: string): string {
  return t.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).map((p) => {
    if (/^\*\*.*\*\*$/.test(p)) return `<text:span text:style-name="G">${esc(p.slice(2, -2))}</text:span>`;
    if (/^\*.*\*$/.test(p)) return `<text:span text:style-name="I">${esc(p.slice(1, -1))}</text:span>`;
    return esc(p);
  }).join('');
}

/** Le corps d'un document texte à partir d'un Markdown simple (# titres, - listes, paragraphes). */
export function corpsOdt(markdown: string, titre: string): string {
  const out: string[] = [];
  if (titre) out.push(`<text:h text:outline-level="1">${enLigne(titre)}</text:h>`);
  let liste: string[] = [];
  const fermerListe = () => { if (liste.length) out.push(`<text:list>${liste.map((x) => `<text:list-item><text:p>${x}</text:p></text:list-item>`).join('')}</text:list>`); liste = []; };
  for (const ligne of String(markdown ?? '').replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(ligne), li = /^\s*[-*•]\s+(.*)$/.exec(ligne);
    if (li) { liste.push(enLigne(li[1])); continue; }
    fermerListe();
    if (h) out.push(`<text:h text:outline-level="${Math.min(6, h[1].length + (titre ? 1 : 0))}">${enLigne(h[2])}</text:h>`);
    else if (ligne.trim()) out.push(`<text:p>${enLigne(ligne)}</text:p>`);
  }
  fermerListe();
  return `<office:text>${out.join('')}</office:text>`;
}

/** Le corps d'une présentation : une page par diapositive (titre et puces). */
export function corpsOdp(diapos: Array<{ titre: string; puces?: string[] }>): string {
  return `<office:presentation>${diapos.map((d, i) => `<draw:page draw:name="page${i + 1}" draw:master-page-name="Standard"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="26cm" svg:height="3cm"><draw:text-box><text:p text:style-name="G">${esc(d.titre)}</text:p></draw:text-box></draw:frame>${(d.puces ?? []).length ? `<draw:frame svg:x="1cm" svg:y="4.5cm" svg:width="26cm" svg:height="12cm"><draw:text-box><text:list>${(d.puces ?? []).map((p) => `<text:list-item><text:p>${esc(p)}</text:p></text:list-item>`).join('')}</text:list></draw:text-box></draw:frame>` : ''}</draw:page>`).join('')}</office:presentation>`;
}

/** Le paquet OpenDocument complet. */
export function paquetOdf(genre: 'odt' | 'ods' | 'odp', corps: string, titre: string): Buffer {
  const styles = `<office:automatic-styles><style:style style:name="G" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles>`;
  const content = `${XML}<office:document-content ${NS}>${styles}<office:body>${corps}</office:body></office:document-content>`;
  const stylesXml = `${XML}<office:document-styles ${NS}><office:master-styles>${genre === 'odp' ? '<style:master-page style:name="Standard"/>' : ''}</office:master-styles></office:document-styles>`;
  const meta = `${XML}<office:document-meta ${NS}><office:meta><meta:generator>Odin (Pygmalion)</meta:generator><dc:title>${esc(titre)}</dc:title></office:meta></office:document-meta>`;
  const manifest = `${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME[genre]}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return zip([
    { name: 'mimetype', data: Buffer.from(MIME[genre]), store: true },
    { name: 'META-INF/manifest.xml', data: Buffer.from(manifest) },
    { name: 'content.xml', data: Buffer.from(content) },
    { name: 'styles.xml', data: Buffer.from(stylesXml) },
    { name: 'meta.xml', data: Buffer.from(meta) },
  ]);
}

export const ecrireOdt = (markdown: string, titre: string): Buffer => paquetOdf('odt', corpsOdt(markdown, titre), titre);
export const ecrireOds = (feuilles: Array<{ nom: string; lignes: Cellule[][] }>, titre: string): Buffer => paquetOdf('ods', corpsOds(feuilles), titre);
export const ecrireOdp = (diapos: Array<{ titre: string; puces?: string[] }>, titre: string): Buffer => paquetOdf('odp', corpsOdp(diapos), titre);
