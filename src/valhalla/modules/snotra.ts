// Plume — la bureautique (comme ONLYOFFICE / LibreOffice, côté « mes documents ») : Odin liste tes documents
// (Word, OpenDocument, Excel, PowerPoint, Markdown, texte, CSV), en lit le texte, cherche dedans, compte les mots,
// et en crée de nouveaux à partir d'un texte simple : document (.docx, .odt, .html, .md) ou tableur (.xlsx) avec
// nombres et formules. Lecteurs et écrivains faits maison (les fichiers Office sont des archives ZIP de XML).
// Plume ne lit que dans tes dossiers de documents, jamais ailleurs. Pour convertir en PDF : Alchimie.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { unzip, zip } from '../../files/zip.ts';
import type { Kpi, ModCtx, Module } from '../types.ts';
import { ACTIONS_PLUME, retraitExport, sectionsPlume } from '../snotra/actions.ts';
import { brancherPlume } from '../snotra/partout.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const strip = (xml: string) => unesc(xml.replace(/<[^>]+>/g, ''));

// ---------------- Lire ----------------
/** Le texte d'un .docx : un paragraphe par ligne ; dans un tableau, une ligne par rangée et une tabulation entre les cases. Pur. */
export function texteDocx(b: Buffer): string {
  const x = unzip(b).get('word/document.xml')?.toString('utf8') ?? ''; if (!x) throw new Error('document Word illisible');
  return strip(x.replace(/<w:(instrText|delText)\b[^>]*>[\s\S]*?<\/w:\1>/g, '').replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>').replace(/<\/w:tc>\s*<\/w:tr>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:p\b[^>]*\/>/g, '\n'))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Le texte d'un fichier OpenDocument (.odt, .ods, .odp), tableaux compris (une ligne par rangée). Pur. */
export function texteOdf(b: Buffer): string {
  const x = unzip(b).get('content.xml')?.toString('utf8') ?? ''; if (!x) throw new Error('document OpenDocument illisible');
  return strip(x.replace(/<text:tab\b[^>]*\/>/g, '\t').replace(/<text:line-break\b[^>]*\/>/g, '\n').replace(/<text:s\b[^>]*\/>/g, ' ')
    .replace(/<\/text:(p|h)>\s*<\/table:table-cell>/g, '</table:table-cell>').replace(/<\/table:table-cell>\s*<\/table:table-row>/g, '\n').replace(/<\/table:table-cell>/g, '\t').replace(/<\/(text:p|text:h|table:table-row)>/g, '\n'))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Les lignes de la première feuille d'un .xlsx (texte, nombres, résultat des formules). Pur. */
export function lignesXlsx(b: Buffer): string[][] {
  const z = unzip(b), sh = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, c) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(c)![0]))[0];
  if (!sh) throw new Error('classeur Excel illisible');
  const shared = [...(z.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => strip(m[1].replace(/<rPh>[\s\S]*?<\/rPh>/g, '')));
  const col = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const r of z.get(sh)!.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const line: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1], t = /\bt="(\w+)"/.exec(c[1])?.[1], body = c[2] ?? '', v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? strip(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '') : unesc(v);
      const k = ref ? col(ref) : line.length; while (line.length < k) line.push(''); line[k] = val;
    }
    rows.push(line);
  }
  return rows;
}
/** Le texte d'un .pptx, diapositive par diapositive. Pur. */
export function textePptx(b: Buffer): string {
  const z = unzip(b), slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, c) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(c)![1]));
  if (!slides.length) throw new Error('présentation illisible');
  return slides.map((k, i) => `— Diapositive ${i + 1} —\n${z.get(k)!.toString('utf8').split(/<\/a:p>/).map((p) => strip(p)).filter((t) => t.trim()).join('\n')}`).join('\n\n');
}
export type Genre = 'texte' | 'tableur' | 'présentation';
export const FORMATS: Record<string, Genre> = { docx: 'texte', odt: 'texte', md: 'texte', txt: 'texte', rtf: 'texte', html: 'texte', xlsx: 'tableur', ods: 'tableur', csv: 'tableur', pptx: 'présentation', odp: 'présentation' };
/** Le texte d'un document selon son format. */
export function texteDe(fichier: string, b: Buffer): string {
  const e = extname(fichier).slice(1).toLowerCase();
  if (e === 'docx') return texteDocx(b); if (e === 'odt' || e === 'ods' || e === 'odp') return texteOdf(b);
  if (e === 'xlsx') return lignesXlsx(b).map((r) => r.join('\t')).join('\n'); if (e === 'pptx') return textePptx(b);
  if (e === 'html') return strip(b.toString('utf8').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n'));
  if (e === 'rtf') return b.toString('latin1').replace(/\\par[d]?\b/g, '\n').replace(/\\'[0-9a-f]{2}/gi, (m) => Buffer.from(m.slice(2), 'hex').toString('latin1')).replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').trim();
  return b.toString('utf8');
}
/** Mots, caractères et temps de lecture (200 mots par minute). Pur. */
export function compter(t: string): { mots: number; caracteres: number; minutes: number } {
  const mots = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length; return { mots, caracteres: t.replace(/\s/g, '').length, minutes: Math.max(1, Math.round(mots / 200)) };
}

// ---------------- Écrire ----------------
type Run = { t: string; b?: boolean; i?: boolean };
type Bloc = { k: 'h'; n: 1 | 2 | 3; r: Run[] } | { k: 'p'; r: Run[] } | { k: 'li'; r: Run[]; num?: number } | { k: 'table'; rows: string[][] };
/** **gras** et *italique* dans une ligne. Pur. */
export function morceaux(t: string): Run[] {
  const out: Run[] = []; let rest = t;
  for (;;) { const m = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*)/.exec(rest); if (!m) break; if (m.index) out.push({ t: rest.slice(0, m.index) }); out.push(m[2] ? { t: m[2], b: true, i: true } : m[3] ? { t: m[3], b: true } : { t: m[4], i: true }); rest = rest.slice(m.index + m[0].length); }
  if (rest) out.push({ t: rest }); return out.length ? out : [{ t: '' }];
}
/** Un texte simple (titres « # », listes « - » et « 1. », tableaux « | a | b | », paragraphes) en blocs. Pur. */
export function blocs(md: string): Bloc[] {
  const out: Bloc[] = []; let para: string[] = [], table: string[][] = [];
  const flush = () => { if (para.length) { out.push({ k: 'p', r: morceaux(para.join(' ')) }); para = []; } if (table.length) { out.push({ k: 'table', rows: table }); table = []; } };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const l = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(l)) { if (para.length) flush(); if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) table.push(l.trim().slice(1, -1).split('|').map((c) => c.trim())); continue; }
    if (table.length) flush();
    const h = /^(#{1,3})\s+(.*)$/.exec(l), li = /^\s*[-*•]\s+(.*)$/.exec(l), num = /^\s*(\d+)[.)]\s+(.*)$/.exec(l);
    if (!l.trim()) flush(); else if (h) { flush(); out.push({ k: 'h', n: h[1].length as 1 | 2 | 3, r: morceaux(h[2]) }); } else if (li) { flush(); out.push({ k: 'li', r: morceaux(li[1]) }); } else if (num) { flush(); out.push({ k: 'li', r: morceaux(num[2]), num: Number(num[1]) }); } else para.push(l.trim());
  }
  flush(); return out;
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** Un document Word (.docx) à partir d'un titre et d'un texte simple. Pur. */
export function docx(titre: string, md: string): Buffer {
  const run = (r: Run) => `<w:r>${r.b || r.i ? `<w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
  const p = (style: string, runs: Run[]) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs.map(run).join('')}</w:p>`;
  const bord = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((x) => `<w:${x} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('') + '</w:tblBorders>';
  const body = blocs(md).map((b) => b.k === 'h' ? p(`Heading${b.n}`, b.r) : b.k === 'li' ? p('ListParagraph', [{ t: b.num ? `${b.num}. ` : '• ' }, ...b.r]) : b.k === 'table' ? `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${bord}</w:tblPr>${b.rows.map((r, k) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p('', k === 0 ? [{ t: c, b: true }] : morceaux(c))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl><w:p/>` : p('', b.r)).join('');
  const style = (id: string, nom: string, size: number, bold: boolean, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nom}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="${size > 24 ? 240 : 0}" w:after="120"/>${extra}</w:pPr><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title', 'Title', 52, true)}${style('Heading1', 'heading 1', 36, true)}${style('Heading2', 'heading 2', 28, true)}${style('Heading3', 'heading 3', 24, true)}${style('ListParagraph', 'List Paragraph', 22, false, '<w:ind w:left="720"/>')}</w:styles>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${titre ? p('Title', [{ t: titre }]) : ''}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const f = (name: string, t: string) => ({ name, data: Buffer.from(t, 'utf8') });
  return zip([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    f('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    f('word/document.xml', doc), f('word/styles.xml', styles),
  ]);
}
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3"';
/** Un document OpenDocument (.odt) à partir d'un titre et d'un texte simple. Pur. */
export function odt(titre: string, md: string): Buffer {
  const run = (r: Run) => (r.b || r.i ? `<text:span text:style-name="${r.b && r.i ? 'BI' : r.b ? 'B' : 'I'}">${esc(r.t)}</text:span>` : esc(r.t));
  const para = (r: Run[], st = '') => `<text:p${st ? ` text:style-name="${st}"` : ''}>${r.map(run).join('')}</text:p>`;
  const B = blocs(md); let body = titre ? `<text:h text:style-name="Titre" text:outline-level="1">${esc(titre)}</text:h>` : '';
  for (let k = 0; k < B.length; k++) {
    const b = B[k];
    if (b.k === 'h') body += `<text:h text:style-name="H${b.n}" text:outline-level="${b.n}">${b.r.map(run).join('')}</text:h>`;
    else if (b.k === 'p') body += para(b.r);
    else if (b.k === 'table') body += `<table:table table:name="Tableau${k}"><table:table-column table:number-columns-repeated="${Math.max(1, ...b.rows.map((r) => r.length))}"/>${b.rows.map((r, j) => `<table:table-row>${r.map((c) => `<table:table-cell office:value-type="string">${para(j === 0 ? [{ t: c, b: true }] : morceaux(c))}</table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`;
    else { const items: string[] = []; while (k < B.length && B[k].k === 'li') { const li = B[k] as Extract<Bloc, { k: 'li' }>; items.push(`<text:list-item>${para([...(li.num ? [{ t: `${li.num}. ` }] : []), ...li.r])}</text:list-item>`); k++; } k--; body += `<text:list>${items.join('')}</text:list>`; }
  }
  const auto = '<office:automatic-styles><style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="BI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style></office:automatic-styles>';
  const h = (n: string, size: number) => `<style:style style:name="${n}" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS}><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.25cm"/><style:text-properties fo:font-size="11pt" fo:language="fr" fo:country="FR"/></style:default-style>${h('Titre', 26)}${h('H1', 18)}${h('H2', 14)}${h('H3', 12)}</office:styles></office:document-styles>`;
  const f = (name: string, t: string, store = false) => ({ name, data: Buffer.from(t, 'utf8'), store });
  return zip([
    f('mimetype', 'application/vnd.oasis.opendocument.text', true),
    f('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    f('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}>${auto}<office:body><office:text>${body}</office:text></office:body></office:document-content>`),
    f('styles.xml', styles),
  ]);
}
/** Une page web simple (.html) à partir d'un titre et d'un texte simple. Pur. */
export function html(titre: string, md: string): string {
  const run = (r: Run) => { const t = esc(r.t); return r.b && r.i ? `<strong><em>${t}</em></strong>` : r.b ? `<strong>${t}</strong>` : r.i ? `<em>${t}</em>` : t; };
  const B = blocs(md); let body = titre ? `<h1>${esc(titre)}</h1>` : '';
  for (let k = 0; k < B.length; k++) { const b = B[k];
    if (b.k === 'h') body += `<h${b.n + 1}>${b.r.map(run).join('')}</h${b.n + 1}>`; else if (b.k === 'p') body += `<p>${b.r.map(run).join('')}</p>`;
    else if (b.k === 'table') body += `<table>${b.rows.map((r, j) => `<tr>${r.map((c) => (j === 0 ? `<th>${esc(c)}</th>` : `<td>${morceaux(c).map(run).join('')}</td>`)).join('')}</tr>`).join('')}</table>`;
    else { const ord = Boolean((b as Extract<Bloc, { k: 'li' }>).num), items: string[] = []; while (k < B.length && B[k].k === 'li') { items.push(`<li>${(B[k] as Extract<Bloc, { k: 'li' }>).r.map(run).join('')}</li>`); k++; } k--; body += `<${ord ? 'ol' : 'ul'}>${items.join('')}</${ord ? 'ol' : 'ul'}>`; } }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre || 'Document')}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1f2e}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.3rem .6rem;text-align:left}</style></head><body>${body}</body></html>`;
}
/** Les lignes d'un texte de tableur : séparateur « ; », tabulation ou « , » (deviné), guillemets gérés. Pur. */
export function lignesCsv(t: string): string[][] {
  const first = t.split('\n')[0] ?? '', sepc = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) && first.includes(';') ? ';' : first.includes(',') ? ',' : ';';
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let k = 0; k < t.length; k++) { const ch = t[k];
    if (q) { if (ch === '"' && t[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"' && !cur) q = true; else if (ch === sepc) { row.push(cur.trim()); cur = ''; } else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch; }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}
const colName = (n: number) => { let x = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) x = String.fromCharCode(65 + ((n - 1) % 26)) + x; return x; };
/** Un classeur Excel (.xlsx) : texte, nombres (« 12,5 » compris) et formules (« =SUM(B2:B5) »). Pur. */
export function xlsx(rows: string[][], feuille = 'Feuille1'): Buffer {
  const cell = (v: string, r: number, c: number) => { const ref = `${colName(c)}${r + 1}`;
    if (v === '') return ''; if (/^=/.test(v)) return `<c r="${ref}"><f>${esc(v.slice(1))}</f></c>`;
    // Comme dans un tableur : une apostrophe en tête garde le contenu en texte (« '0976 » reste « 0976 »).
    if (v.startsWith('\'')) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v.slice(1))}</t></is></c>`;
    if (/^-?\d{1,15}([.,]\d+)?$/.test(v)) return `<c r="${ref}"><v>${v.replace(',', '.')}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`; };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, k) => `<row r="${k + 1}">${r.map((v, c) => cell(v, k, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const f = (name: string, t: string) => ({ name, data: Buffer.from(t, 'utf8') });
  return zip([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(feuille.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    f('xl/worksheets/sheet1.xml', sheet),
  ]);
}
export const MODELES: Record<string, { nom: string; texte: string }> = {
  lettre: { nom: 'Lettre', texte: '[Ton prénom et ton nom]\n[Ton adresse]\n\n[Nom du destinataire]\n[Son adresse]\n\n[Ville], le [date]\n\n**Objet : [objet de la lettre]**\n\nMadame, Monsieur,\n\n[Ton message : dis d\'abord ce que tu demandes, puis explique.]\n\nJe vous prie d\'agréer, Madame, Monsieur, mes salutations distinguées.\n\n[Signature]' },
  compte_rendu: { nom: 'Compte rendu de réunion', texte: '**Date :** [date] · **Lieu :** [lieu]\n\n**Présents :** [noms]\n\n# Sujets abordés\n\n- [sujet 1 : ce qui a été dit]\n- [sujet 2]\n\n# Décisions\n\n1. [décision]\n2. [décision]\n\n# À faire\n\n| Quoi | Qui | Pour quand |\n| --- | --- | --- |\n| [tâche] | [personne] | [date] |' },
  ordre_du_jour: { nom: 'Ordre du jour', texte: '**Réunion du [date] à [heure]**, [lieu]\n\n1. [premier point] (10 min)\n2. [deuxième point] (15 min)\n3. Questions diverses\n\n**À préparer :** [documents à lire avant]' },
  note: { nom: 'Note', texte: '# [Sujet]\n\n[L\'essentiel en deux phrases.]\n\n## Détails\n\n- [point]\n- [point]\n\n## Suite\n\n[Ce qu\'il faut faire maintenant.]' },
};

// ---------------- Les dossiers ----------------
const dossiers = (ctx: ModCtx): string[] => { const l = (ctx.settings.dossiers as string[] | undefined) ?? []; return l.length ? l : [join(homedir(), 'Documents')].filter((d) => existsSync(d)); };
/** Un dossier qu'on peut confier à Plume ? (jamais la racine, le dossier personnel entier, un dossier caché, ni les données d'Odin). Pur. */
export function dossierPermis(d: string, home = homedir(), odin = ''): boolean {
  const r = resolve(d); if (r === resolve('/') || r === resolve(home) || r.split(sep).some((x) => x.startsWith('.') && x.length > 1)) return false;
  if (odin && (r === resolve(odin) || r.startsWith(resolve(odin) + sep) || resolve(odin).startsWith(r + sep))) return false;
  return !/^\/(etc|proc|sys|dev|boot|root|var\/lib)(\/|$)/.test(r);
}
const dedans = (p: string, roots: string[]) => { const r = resolve(p); return roots.some((d) => r.startsWith(resolve(d) + sep)); };
export interface Doc { chemin: string; nom: string; genre: Genre; octets: number; mtime: number }
export function lister(roots: string[], max = 2000): Doc[] {
  const out: Doc[] = [];
  const walk = (d: string, n: number) => {
    if (n > 5 || out.length >= max) return; let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    for (const e of names) { if (e.startsWith('.') || e.startsWith('~$') || e === 'node_modules') continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, n + 1); else { const g = FORMATS[extname(e).slice(1).toLowerCase()]; if (g && out.length < max) out.push({ chemin: p, nom: e, genre: g, octets: st.size, mtime: Math.round(st.mtimeMs) }); } }
  };
  for (const r of roots) walk(r, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}
const cache = new Map<string, string>();
function texteCache(d: Doc): string {
  const k = `${d.chemin}|${d.mtime}|${d.octets}`, h = cache.get(k); if (h !== undefined) return h;
  let t = ''; try { if (d.octets <= 30 * 1024 * 1024) t = texteDe(d.chemin, readFileSync(d.chemin)); } catch { t = ''; }
  if (cache.size > 800) cache.clear(); cache.set(k, t); return t;
}
function trouver(ctx: ModCtx, qui: unknown): Doc {
  const k = s(qui).trim(); if (!k) throw new Error('quel document ?');
  const l = lister(dossiers(ctx)), low = k.toLowerCase();
  const d = l.find((x) => x.chemin === k) ?? l.find((x) => x.nom.toLowerCase() === low) ?? l.find((x) => x.nom.toLowerCase().replace(/\.[^.]+$/, '') === low) ?? l.find((x) => x.nom.toLowerCase().includes(low));
  if (!d) throw new Error(`document « ${k.slice(0, 80)} » introuvable dans tes dossiers (${dossiers(ctx).join(', ') || 'aucun dossier'})`);
  return d;
}
const taille = (o: number) => (o >= 1024 ** 2 ? `${(o / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
const quand = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
/** Où écrire un nouveau document : le sous-dossier « Plume » du premier dossier (sans jamais écraser un fichier). */
function nouveauChemin(ctx: ModCtx, titre: string, ext: string): string {
  const base = dossiers(ctx)[0] ? join(dossiers(ctx)[0], 'Plume') : join(ctx.dir, 'documents'); mkdirSync(base, { recursive: true });
  const nom = (titre.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 80) || 'Document');
  let p = join(base, `${nom}.${ext}`); for (let k = 2; existsSync(p); k++) p = join(base, `${nom} (${k}).${ext}`);
  return p;
}
const FORMATS_DOC = ['docx', 'odt', 'html', 'md'];

export const snotra: Module & { similaires: string[] } = {
  id: 'snotra', name: 'Plume', family: 'Données',
  what: 'La bureautique : tes documents (Word, OpenDocument, Excel, PowerPoint, Markdown, texte) listés, lus et cherchés, et de nouveaux documents ou tableurs créés à partir d\'un texte simple, avec des modèles prêts.',
  does: ['tous tes documents au même endroit : textes, tableurs, présentations', 'lecture du texte d\'un document Word, OpenDocument, Excel ou PowerPoint (sans les ouvrir ailleurs)', 'recherche d\'un mot dans tous tes documents', 'mots, caractères et temps de lecture', 'créer un document (.docx, .odt, .html, .md) à partir d\'un texte simple : titres, listes, gras, tableaux', 'créer un tableur (.xlsx) avec nombres et formules', 'modèles : lettre, compte rendu, ordre du jour, note', 'ne lit que dans tes dossiers de documents ; la conversion en PDF se fait avec Alchimie'],
  from: ['ONLYOFFICE', 'LibreOffice', 'Collabora'], upstream: ['ONLYOFFICE/DocumentServer', 'LibreOffice/core'],
  similaires: ['ONLYOFFICE', 'LibreOffice', 'Collabora Online', 'Bento', 'LanguageTool', 'Excalidraw', 'FossFLOW', 'Penpot'],
  words: ['bureautique', 'mes documents', 'document word', 'documents word', 'fichier word', 'fichier excel', 'tableau excel', 'classeur excel', 'docx', 'xlsx', 'odt', 'plume', 'snotra', 'onlyoffice', 'libreoffice', 'tableau blanc', 'tableaux blancs', 'correcteur', 'corrige ce texte', 'corrige le texte', 'corriger un texte', 'languagetool', 'excalidraw', 'fossflow', 'penpot', 'schéma isométrique'],
  actions: [
    { id: 'documents', label: 'Documents', what: 'Tes documents, du plus récent au plus ancien', read: true, params: [{ key: 'genre', label: 'Genre', kind: 'select', options: ['', 'texte', 'tableur', 'présentation'], default: '' }], words: ['mes documents', 'liste de mes documents'], run: (ctx, i) => {
      const l = lister(dossiers(ctx)).filter((d) => !s(i.genre) || d.genre === s(i.genre));
      return { text: l.length ? `${l.length} document(s) :\n${l.slice(0, 50).map((d) => `- ${d.nom} · ${d.genre} · ${taille(d.octets)} · ${quand(d.mtime)}`).join('\n')}` : `Aucun document dans ${dossiers(ctx).join(', ') || 'tes dossiers (ajoute le tien)'}.`, data: l.slice(0, 500) };
    } },
    { id: 'lire', label: 'Lire un document', what: 'Le texte d\'un document, avec son nombre de mots', read: true, external: true, params: [{ key: 'fichier', label: 'Document (nom)', kind: 'text', required: true }], words: ['lis le document', 'que dit le document'], run: (ctx, i) => {
      const d = trouver(ctx, i.fichier); if (!dedans(d.chemin, dossiers(ctx))) throw new Error('ce document n\'est pas dans tes dossiers');
      const t = texteCache(d), c = compter(t);
      return { text: `${d.nom} · ${c.mots} mot(s), ${c.caracteres} caractère(s), ${c.minutes} min de lecture\n\n${t.slice(0, 6000)}${t.length > 6000 ? '\n… (suite coupée)' : ''}`, data: { ...c, chemin: d.chemin } };
    } },
    { id: 'chercher', label: 'Chercher dans les documents', what: 'Les documents qui contiennent ces mots, avec le passage', read: true, external: true, params: [{ key: 'q', label: 'Mots', kind: 'text', required: true }], words: ['cherche dans mes documents', 'quel document parle de'], run: (ctx, i) => {
      const mots = s(i.q).toLowerCase().split(/\s+/).filter(Boolean); if (!mots.length) throw new Error('quels mots ?');
      const hits: Array<{ d: Doc; extrait: string }> = [];
      for (const d of lister(dossiers(ctx), 600)) { const t = texteCache(d), low = `${d.nom}\n${t}`.toLowerCase(); if (!mots.every((m) => low.includes(m))) continue; const k = Math.max(0, t.toLowerCase().indexOf(mots[0]) - 60); hits.push({ d, extrait: t.slice(k, k + 180).replace(/\s+/g, ' ').trim() }); if (hits.length >= 40) break; }
      return { text: hits.length ? `${hits.length} document(s) :\n${hits.map((h) => `- ${h.d.nom} : « ${h.extrait} »`).join('\n')}` : 'Aucun document ne contient ces mots.', data: hits.map((h) => ({ chemin: h.d.chemin, extrait: h.extrait })) };
    } },
    { id: 'creer', label: 'Créer un document', what: 'Un document à partir d\'un texte simple (# titre, - liste, **gras**, | tableau |)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'texte', label: 'Texte', kind: 'textarea', required: true }, { key: 'format', label: 'Format', kind: 'select', options: FORMATS_DOC, default: 'docx' }], words: ['crée un document word', 'rédige un document word'], run: (ctx, i) => {
      const titre = s(i.titre).trim(), texte = s(i.texte), fmt = FORMATS_DOC.includes(s(i.format)) ? s(i.format) : 'docx'; if (!titre || !texte.trim()) throw new Error('il faut un titre et un texte');
      const p = nouveauChemin(ctx, titre, fmt);
      writeFileSync(p, fmt === 'docx' ? docx(titre, texte) : fmt === 'odt' ? odt(titre, texte) : fmt === 'html' ? html(titre, texte) : `# ${titre}\n\n${texte}\n`);
      const c = compter(texte); return { text: `📝 ${basename(p)} créé (${c.mots} mots) dans ${join(p, '..')}.`, data: { chemin: p } };
    } },
    { id: 'tableur', label: 'Créer un tableur', what: 'Un classeur Excel à partir de lignes séparées par « ; » (les nombres et les formules « =SUM(B2:B5) » sont gardés)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'lignes', label: 'Lignes (une par ligne, cases séparées par « ; »)', kind: 'textarea', required: true }], words: ['crée un classeur excel', 'crée un tableau excel'], run: (ctx, i) => {
      const titre = s(i.titre).trim(), rows = lignesCsv(s(i.lignes)); if (!titre || !rows.length) throw new Error('il faut un titre et au moins une ligne');
      if (rows.length > 50_000) throw new Error('trop de lignes (50 000 au plus)');
      const p = nouveauChemin(ctx, titre, 'xlsx'); writeFileSync(p, xlsx(rows, titre));
      return { text: `📊 ${basename(p)} créé (${rows.length} ligne(s), ${Math.max(...rows.map((r) => r.length))} colonne(s)) dans ${join(p, '..')}.`, data: { chemin: p } };
    } },
    { id: 'modele', label: 'Créer depuis un modèle', what: 'Crée un document à compléter : lettre, compte rendu, ordre du jour, note', words: ['crée un document depuis un modèle', 'modèle de document'], params: [{ key: 'modele', label: 'Modèle', kind: 'select', options: Object.keys(MODELES), default: 'lettre' }, { key: 'titre', label: 'Titre', kind: 'text', default: '' }, { key: 'format', label: 'Format', kind: 'select', options: FORMATS_DOC, default: 'docx' }], run: (ctx, i) => {
      const m = MODELES[s(i.modele)] ?? MODELES.lettre, titre = s(i.titre).trim() || m.nom, fmt = FORMATS_DOC.includes(s(i.format)) ? s(i.format) : 'docx', p = nouveauChemin(ctx, titre, fmt);
      writeFileSync(p, fmt === 'docx' ? docx(titre, m.texte) : fmt === 'odt' ? odt(titre, m.texte) : fmt === 'html' ? html(titre, m.texte) : `# ${titre}\n\n${m.texte}\n`);
      return { text: `📝 ${basename(p)} créé d'après le modèle « ${m.nom} » : remplace ce qui est entre crochets.`, data: { chemin: p } };
    } },
    { id: 'dossier', label: 'Ajouter un dossier de documents', what: 'Un dossier que Plume peut lire (jamais un dossier caché ni le dossier personnel entier)', words: ['ajoute un dossier à mes documents'], params: [{ key: 'chemin', label: 'Chemin du dossier', kind: 'text', required: true }], run: (ctx, i) => {
      const d = s(i.chemin).trim(); if (!d || !existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
      if (!dossierPermis(d, homedir(), ctx.home)) throw new Error('ce dossier est trop large ou sensible : choisis un dossier de documents précis (pas la racine, pas le dossier personnel entier, pas un dossier caché)');
      ctx.saveSettings({ dossiers: [...new Set([...dossiers(ctx), resolve(d)])] }); return { text: `📁 ${resolve(d)} ajouté.` };
    } },    ...ACTIONS_PLUME,
  ],
  view(ctx) {
    const l = lister(dossiers(ctx)), par = (g: Genre) => l.filter((d) => d.genre === g).length;
    const kpis: Kpi[] = [{ label: 'Documents', value: String(l.length) }, { label: 'Textes', value: String(par('texte')) }, { label: 'Tableurs', value: String(par('tableur')) }, { label: 'Présentations', value: String(par('présentation')) }];
    return {
      subtitle: dossiers(ctx).length ? `${l.length} document(s) dans ${dossiers(ctx).length} dossier(s)` : 'Aucun dossier de documents : ajoute le tien.', kpis,
      // Onglets : Documents (ce que Plume faisait déjà) · Correcteur · Tableaux · Schémas. La page dessinée
      // (src/web/pages/snotra.js) ajoute l'éditeur de tableaux blancs et de schémas.
      onglets: ['Documents', 'Correcteur', 'Tableaux', 'Schémas'],
      sections: [
        { kind: 'table', title: 'Documents récents', columns: ['Nom', 'Genre', 'Taille', 'Modifié'], empty: 'Aucun document pour l\'instant : crée le premier ci-dessous.', rows: l.slice(0, 60).map((d) => ({ cells: [d.nom, d.genre, taille(d.octets), quand(d.mtime)], actions: [{ action: 'lire', label: 'Lire', input: { fichier: d.chemin } }] })) },
        { kind: 'form', title: 'Créer un document', action: 'creer', submit: 'Créer', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'texte', label: 'Texte', kind: 'textarea', required: true, help: '# Titre · - liste · **gras** · *italique* · | case | case |' }, { key: 'format', label: 'Format', kind: 'select', options: FORMATS_DOC, default: 'docx' }] },
        { kind: 'form', title: 'Créer un tableur', action: 'tableur', submit: 'Créer', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'lignes', label: 'Lignes', kind: 'textarea', required: true, help: 'Produit;Prix;Quantité  puis  Total;=SUM(B2:B5)' }] },
        ...sectionsPlume(ctx),
      ],
      side: [
        { kind: 'form', title: 'Chercher dans les documents', action: 'chercher', submit: 'Chercher', params: [{ key: 'q', label: 'Mots', kind: 'text', required: true }] },
        { kind: 'list', title: 'Modèles', items: Object.entries(MODELES).map(([k, m]) => ({ title: m.nom, meta: k })) },
        { kind: 'list', title: 'Dossiers', empty: 'Aucun dossier.', items: dossiers(ctx).map((d) => ({ title: d })) },
      ],
    };
  },
  retrait: (ctx, ref) => retraitExport(ctx, ref),
  // Plume partout (le correcteur pendant qu'on écrit) : les routes /api/plume/* et l'IA lisent le réglage par ce contexte.
  start: (ctx) => brancherPlume(ctx),
  stop: () => brancherPlume(undefined),
};
