// Word (.docx), Excel (.xlsx) et PowerPoint (.pptx) : lecture du texte et création de documents,
// sans dépendance (ce sont des archives ZIP de fichiers XML).

import { unzip, zip } from './zip.ts';

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => cp(Number(d)))
  .replace(/&amp;/g, '&');
const cp = (n: number) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0 refuse les caractères de contrôle : on les retire.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ------------------------------------------------------------------ Lecture

/** Word : paragraphes (titres, listes et tableaux rendus en texte simple). */
export function readDocx(buf: Buffer): string {
  const doc = unzip(buf).get('word/document.xml')?.toString('utf8');
  if (!doc) throw new Error('document Word invalide (word/document.xml absent)');
  const out: string[] = [];
  for (const p of doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    let text = '';
    for (const m of p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) text += m[1] !== undefined ? decode(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n';
    if (!text.trim()) { out.push(''); continue; }
    const h = /^(?:Heading|Titre)(\d)$/i.exec(style);
    const isList = /ListParagraph|List/i.test(style) || /<w:numPr>/.test(p);
    const item = text.replace(/^[•·▪-]\t?\s*/, '');
    out.push(h ? `${'#'.repeat(Math.min(6, Number(h[1])))} ${text}` : style === 'Title' ? `# ${text}` : isList ? (/^\d+[.)]\t/.test(text) ? text.replace('\t', ' ') : `- ${item}`) : text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Excel : chaque feuille en CSV (valeurs calculées, chaînes partagées résolues). */
export function readXlsx(buf: Buffer, maxRows = 2000): Array<{ name: string; rows: string[][] }> {
  const files = unzip(buf);
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) throw new Error('classeur Excel invalide (xl/workbook.xml absent)');
  const shared = (files.get('xl/sharedStrings.xml')?.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) ?? [])
    .map((si) => [...si.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join(''));
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const target = (rid: string) => {
    const id = rid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // identifiant issu du fichier : échappé
    const t = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${id}"`).exec(rels);
    const path = (t?.[1] ?? t?.[2] ?? '').replace(/^\/?xl\//, '').replace(/^\//, '');
    return `xl/${path}`;
  };
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  for (const s of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const xml = files.get(target(s[2]))?.toString('utf8') ?? '';
    const rows: string[][] = [];
    for (const r of xml.match(/<row[ >][\s\S]*?<\/row>/g) ?? []) {
      if (rows.length >= maxRows) break;
      const row: string[] = [];
      for (const c of r.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = Math.min(16_383, ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length);
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const f = /<f(?: [^>]*)?>([\s\S]*?)<\/f>/.exec(body)?.[1];
        let val = '';
        if (type === 's' && v !== undefined) val = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') val = [...body.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
        else if (type === 'b') val = v === '1' ? 'VRAI' : 'FAUX';
        else if (v !== undefined) val = decode(v);
        else if (f !== undefined) val = `=${decode(f)}`; // formule jamais calculée (fichier créé par un programme)
        while (row.length < col) row.push('');
        row[col] = val;
      }
      rows.push(row);
    }
    sheets.push({ name: decode(s[1]), rows });
  }
  return sheets;
}

export const toCsv = (rows: string[][], sep = ';') => rows.map((r) => r.map((v) => (/[";\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(sep)).join('\n');

/** PowerPoint : le texte de chaque diapositive, dans l'ordre. */
export function readPptx(buf: Buffer): string {
  const files = unzip(buf);
  const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  if (!slides.length) throw new Error('présentation PowerPoint invalide (aucune diapositive)');
  return slides.map((k, i) => {
    const xml = files.get(k)!.toString('utf8');
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('')).filter((t) => t.trim());
    return `## Diapositive ${i + 1}\n${paras.join('\n')}`;
  }).join('\n\n');
}

// ------------------------------------------------------------------ Création

const CT_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Markdown simple → Word : # titres, - listes, **gras**, *italique*, paragraphes. */
export function createDocx(markdown: string, title = ''): Buffer {
  const runs = (text: string) => text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).map((part) => {
    const bold = /^\*\*.*\*\*$/.test(part), ital = !bold && /^\*.*\*$/.test(part);
    const t = bold ? part.slice(2, -2) : ital ? part.slice(1, -1) : part;
    return `<w:r>${bold || ital ? `<w:rPr>${bold ? '<w:b/>' : ''}${ital ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }).join('');
  const body: string[] = [];
  if (title) body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runs(title)}</w:p>`);
  for (const line of markdown.replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line), li = /^\s*[-*•]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${h[1].length}"/></w:pPr>${runs(h[2])}</w:p>`);
    else if (li) body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">•\t</w:t></w:r>${runs(li[1])}</w:p>`);
    else if (ol) body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">${esc(line.trim().split(/\s/)[0])}\t</w:t></w:r>${runs(ol[1])}</w:p>`);
    else body.push(`<w:p>${runs(line)}</w:p>`);
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const style = (id: string, name: string, size: number, bold = true, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/>${extra}</w:pPr><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${CT_HEAD}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title', 'Title', 48)}${style('Heading1', 'heading 1', 32)}${style('Heading2', 'heading 2', 26)}${style('Heading3', 'heading 3', 24)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  const document = `${CT_HEAD}<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`${CT_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`${CT_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(`${CT_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
  ]);
}

const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/**
 * Classeur Excel : une ou plusieurs feuilles. Les nombres restent des nombres, les cellules
 * commençant par « = » deviennent des formules ; la première ligne est mise en gras.
 */
export function createXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>): Buffer {
  if (!sheets.length) throw new Error('au moins une feuille');
  const names = sheets.map((s, i) => (s.name || `Feuille${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const sheetXml = sheets.map((s) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`, st = ri === 0 ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"${st}><v>${v ? 1 : 0}</v></c>`;
      const str = String(v);
      if (str.startsWith('=') && str.length > 1) return `<c r="${ref}"${st}><f>${esc(str.slice(1))}</f></c>`;
      if (/^-?\d+(?:[.,]\d+)?$/.test(str) && !/^0\d/.test(str)) return `<c r="${ref}"${st}><v>${str.replace(',', '.')}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const width = Math.max(1, ...s.rows.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, ...s.rows.map((r) => String(r[i] ?? '').length + 2)))}" customWidth="1"/>`).join('');
    return `${CT_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(`${CT_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`${CT_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`${CT_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`${CT_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: Buffer.from(`${CT_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(x) })),
  ];
  return zip(entries);
}

/** CSV (séparateur ; ou ,) → lignes. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) >= (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ------------------------------------------------------------------ PowerPoint (création)

export interface Slide { title: string; bullets?: string[]; notes?: string }

/** Présentation 16:9 simple : une diapositive titre + une diapositive par élément (titre et puces). */
export function createPptx(slides: Slide[], deckTitle = ''): Buffer {
  if (!slides.length) throw new Error('au moins une diapositive');
  const all: Slide[] = deckTitle ? [{ title: deckTitle, bullets: [] }, ...slides] : slides;
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const CX = 12192000, CY = 6858000;
  const rel = (items: Array<[string, string, string]>) => `${CT_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const tx = (text: string, size: number, bold = false) => `<a:r><a:rPr lang="fr-FR" sz="${size}"${bold ? ' b="1"' : ''} dirty="0"/><a:t>${esc(text)}</a:t></a:r>`;
  const shape = (id: number, name: string, x: number, y: number, w: number, h: number, paras: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  const slideXml = (sl: Slide, first: boolean) => {
    const title = first && deckTitle
      ? shape(2, 'Titre', 838200, 2300000, CX - 1676400, 1500000, `<a:p><a:pPr algn="ctr"/>${tx(sl.title, 4400, true)}</a:p>`)
      : shape(2, 'Titre', 838200, 457200, CX - 1676400, 1100000, `<a:p>${tx(sl.title, 3200, true)}</a:p>`);
    const bullets = (sl.bullets ?? []).length
      ? shape(3, 'Contenu', 838200, 1700000, CX - 1676400, CY - 2300000, (sl.bullets ?? []).map((b) => `<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${tx(b, 2200)}</a:p>`).join(''))
      : '';
    return `${CT_HEAD}<p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${title}${bullets}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  };
  const theme = `${CT_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Odin"><a:themeElements><a:clrScheme name="Odin"><a:dk1><a:srgbClr val="1A1D24"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0B0E14"/></a:dk2><a:lt2><a:srgbClr val="F2F0EB"/></a:lt2><a:accent1><a:srgbClr val="E2A93B"/></a:accent1><a:accent2><a:srgbClr val="7FC8A9"/></a:accent2><a:accent3><a:srgbClr val="6FB3E0"/></a:accent3><a:accent4><a:srgbClr val="E88E7A"/></a:accent4><a:accent5><a:srgbClr val="A3ACBA"/></a:accent5><a:accent6><a:srgbClr val="5B6475"/></a:accent6><a:hlink><a:srgbClr val="2F6FB0"/></a:hlink><a:folHlink><a:srgbClr val="7A4FA0"/></a:folHlink></a:clrScheme><a:fontScheme name="Odin"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Odin"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const emptyTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
  const master = `${CT_HEAD}<p:sldMaster ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  const layout = `${CT_HEAD}<p:sldLayout ${P} type="blank" preserve="1">${emptyTree.replace('<p:cSld>', '<p:cSld name="Vide">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const pres = `${CT_HEAD}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${all.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presRels = rel([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...all.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`] as [string, string, string]), [`rId${all.length + 2}`, 'theme', 'theme/theme1.xml']]);
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`${CT_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${all.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(rel([['rId1', 'officeDocument', 'ppt/presentation.xml']])) },
    { name: 'ppt/presentation.xml', data: Buffer.from(pres) },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(presRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(rel([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])) },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(theme) },
    ...all.flatMap((sl, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: Buffer.from(slideXml(sl, i === 0)) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: Buffer.from(rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])) },
    ]),
  ]);
}
