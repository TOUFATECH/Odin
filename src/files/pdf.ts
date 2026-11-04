// PDF : lecture du texte et création de documents, sans dépendance.
// - Lecture : pdftotext (Poppler) s'il est installé, le plus fiable ; sinon un extracteur intégré
//   qui décompresse les flux (FlateDecode) et lit les opérateurs de texte (Tj, TJ, ', ").
//   Les PDF scannés (images) n'ont pas de texte : il faut alors une reconnaissance de caractères.
// - Création : texte et titres en Helvetica (accents français pris en charge), pagination A4.

import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { hasCommand } from '../learn/environment.ts';

export function readPdf(buf: Buffer, path?: string): { text: string; via: 'pdftotext' | 'intégré'; pages: number } {
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (path && hasCommand('pdftotext')) {
    const r = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 60_000 });
    if (r.status === 0 && r.stdout.trim()) return { text: r.stdout.trim(), via: 'pdftotext', pages };
  }
  return { text: extractPdfText(buf), via: 'intégré', pages };
}

/** Extracteur intégré : flux décompressés, polices à table ToUnicode (Word, LibreOffice…). */
export function extractPdfText(buf: Buffer): string {
  if (buf.length > 20 * 1024 * 1024) throw new Error('PDF trop volumineux pour le lecteur intégré (20 Mo) : installe pdftotext (Poppler) pour celui-ci');
  const raw = buf.toString('latin1');
  // 1. Tous les flux (décompressés), et le texte des objets, y compris dans les flux d'objets (PDF 1.5+).
  const streams: Array<{ dict: string; data: Buffer; num?: number }> = [];
  // Dictionnaire d'un flux : jusqu'au mot « stream », sans traverser un autre objet.
  const re = /(\d+)\s+0\s+obj\s*(<<(?:(?!endobj|\bobj\b)[\s\S])*?>>)\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const lenMatch = /\/Length\s+(\d+)(?!\s+0\s+R)/.exec(m[2]);
    let end = lenMatch ? start + Number(lenMatch[1]) : raw.indexOf('endstream', start);
    if (end > raw.length || raw.slice(end, end + 30).indexOf('endstream') < 0) end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(m[2])) { try { data = inflateSync(data); } catch { try { data = inflateSync(data.subarray(0, data.length - 1)); } catch { re.lastIndex = end; continue; } } }
    else if (/\/Filter/.test(m[2])) { re.lastIndex = end; continue; } // images (DCT, JPX…)
    streams.push({ dict: m[2], data, num: Number(m[1]) });
    re.lastIndex = end;
  }
  const objects = new Map<number, string>();
  for (const o of raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) objects.set(Number(o[1]), o[2]);
  for (const st of streams) {
    if (!/\/Type\s*\/ObjStm/.test(st.dict)) continue;
    const n = Number(/\/N\s+(\d+)/.exec(st.dict)?.[1] ?? 0), first = Number(/\/First\s+(\d+)/.exec(st.dict)?.[1] ?? 0);
    const txt = st.data.toString('latin1'), head = txt.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) objects.set(head[2 * k], txt.slice(first + head[2 * k + 1], k + 1 < n ? first + head[2 * k + 3] : undefined));
  }
  const streamOf = new Map<number, Buffer>();
  for (const st of streams) if (st.num !== undefined) streamOf.set(st.num, st.data);
  // 2. Polices : nom de ressource (/F1) → table ToUnicode.
  const cmaps = new Map<string, CMap>();
  const fontDicts: string[] = [];
  for (const body of objects.values()) {
    for (const fm of body.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) fontDicts.push(fm[1]);
    // /Font 12 0 R : le dictionnaire de polices est un objet séparé.
    for (const fr of body.matchAll(/\/Font\s+(\d+)\s+0\s+R/g)) { const d = objects.get(Number(fr[1])); if (d) fontDicts.push(d); }
  }
  for (const dict of fontDicts) {
    {
      const fm = [null, dict] as unknown as RegExpMatchArray;
      for (const ref of fm[1].matchAll(/\/([^\s/<>]+)\s+(\d+)\s+0\s+R/g)) {
        const font = objects.get(Number(ref[2])) ?? '';
        const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font);
        const data = tu ? streamOf.get(Number(tu[1])) : undefined;
        if (data && !cmaps.has(ref[1])) cmaps.set(ref[1], parseCMap(data.toString('latin1')));
      }
    }
  }
  // 3. Contenus de page.
  const out: string[] = [];
  for (const st of streams) {
    if (/\/Type\s*\/(ObjStm|XRef|XObject|Metadata)|\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/CMapName/.test(st.dict)) continue;
    const content = st.data.toString('latin1');
    if (/\bBT\b[\s\S]*?\bET\b/.test(content)) out.push(textOps(content, cmaps));
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type CMap = { bytes: number; map: Map<number, string> };
function parseCMap(t: string): CMap {
  const map = new Map<number, string>();
  const u16 = (h: string) => { let r = ''; for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return r; };
  const bytes = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(t)?.[1].length === 2 ? 1 : 2;
  for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const e of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(e[1], 16), u16(e[2]));
  for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const e of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(e[1], 16), hi = parseInt(e[2], 16);
      if (e[3].startsWith('[')) [...e[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, k) => map.set(lo + k, u16(x[1])));
      else { const base = parseInt(e[3].slice(1, -1), 16), len = e[3].length - 2; for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, len <= 4 ? String.fromCharCode(base + c - lo) : u16(e[3].slice(1, -5)) + String.fromCharCode(parseInt(e[3].slice(-5, -1), 16) + c - lo)); }
    }
  }
  return { bytes, map };
}

function textOps(c: string, cmaps: Map<string, CMap>): string {
  let out = '';
  let cmap: CMap | undefined;
  const lit = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[e] ?? (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ''));
  const hex = (h: string) => { const s = h.replace(/\s/g, ''); let r = ''; for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt(s.slice(i, i + 2).padEnd(2, '0'), 16)); return r; };
  const decodeStr = (bytes: string) => {
    if (!cmap) return [...bytes].map((ch) => WIN_REVERSE[ch.charCodeAt(0)] ?? ch).join(''); // WinAnsi (polices standard)
    let r = '';
    for (let i = 0; i < bytes.length; i += cmap.bytes) {
      const code = cmap.bytes === 2 ? (bytes.charCodeAt(i) << 8) | (bytes.charCodeAt(i + 1) || 0) : bytes.charCodeAt(i);
      r += cmap.map.get(code) ?? '';
    }
    return r;
  };
  const tokens = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[(?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[^\]()<>])*\]|-?\d*\.?\d+|\/[^\s/\[\]()<>]+|[A-Za-z'"*]+/g;
  let stack: string[] = [];
  const strOf = (x: string) => decodeStr(x.startsWith('(') ? lit(x.slice(1, -1)) : x.startsWith('<') ? hex(x.slice(1, -1)) : '');
  for (const t of c.match(tokens) ?? []) {
    if (t.startsWith('(') || t.startsWith('<') || t.startsWith('[') || /^-?\d/.test(t) || t.startsWith('/')) { stack.push(t); continue; }
    if (t === 'Tf') { cmap = cmaps.get((stack.find((x) => x.startsWith('/')) ?? '').slice(1)); }
    else if (t === 'Tj' || t === "'" || t === '"') { if (t !== 'Tj') out += '\n'; out += strOf(stack.at(-1) ?? ''); }
    else if (t === 'TJ') {
      const arr = stack.at(-1) ?? '';
      for (const part of arr.match(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|-?\d*\.?\d+/g) ?? []) {
        if (/^-?\d/.test(part)) { if (Number(part) < -200) out += ' '; } else out += strOf(part);
      }
    } else if (t === 'Td' || t === 'TD') { const y = Number(stack.at(-1)); out += y !== 0 ? '\n' : ' '; }
    else if (t === 'T*' || t === 'ET' || t === 'Tm') out += '\n';
    stack = [];
  }
  return out;
}

// ------------------------------------------------------------------ Création

// Helvetica, largeurs en 1/1000 (WinAnsi) pour couper les lignes proprement.
const W: Record<string, number> = {};
' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'.split('').forEach((ch, i) => {
  W[ch] = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584][i];
});
const width = (s: string, size: number) => [...s].reduce((n, ch) => n + (W[ch] ?? W[ch.normalize('NFD')[0]] ?? 556), 0) * size / 1000;

/** WinAnsi : les accents français passent ; ce qui n'existe pas devient « ? ». */
const WIN: Record<string, number> = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, 'œ': 156, 'Œ': 140, 'Ÿ': 159 };
const WIN_REVERSE: Record<number, string> = Object.fromEntries(Object.entries(WIN).map(([ch, code]) => [code, ch]));
function winAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const b = WIN[ch] ?? (c < 256 ? c : 63);
    const x = String.fromCharCode(b);
    out += x === '(' || x === ')' || x === '\\' ? `\\${x}` : b < 32 ? ' ' : x;
  }
  return out;
}

/** Markdown simple → PDF A4 : # titres, listes, paragraphes. */
export function createPdf(markdown: string, title = ''): Buffer {
  const PW = 595.28, PH = 841.89, M = 56, maxW = PW - 2 * M;
  type Line = { text: string; size: number; bold: boolean; gap: number; indent: number };
  const lines: Line[] = [];
  const wrap = (text: string, size: number, bold: boolean, gap: number, indent = 0) => {
    const words = text.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (width(next, size) * (bold ? 1.05 : 1) > maxW - indent && cur) { lines.push({ text: cur, size, bold, gap, indent }); cur = w; gap = size * 0.35; }
      else cur = next;
    }
    lines.push({ text: cur, size, bold, gap, indent });
  };
  if (title) wrap(title, 22, true, 0);
  for (const raw of markdown.replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(raw), li = /^\s*[-*•]\s+(.*)$/.exec(raw);
    const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    if (h) wrap(plain(h[2]), [18, 15, 13][h[1].length - 1], true, 14);
    else if (li) wrap(`•  ${plain(li[1])}`, 11, false, 3, 12);
    else if (!raw.trim()) lines.push({ text: '', size: 11, bold: false, gap: 4, indent: 0 });
    else wrap(plain(raw), 11, false, 4);
  }
  // Pagination
  const pages: string[] = [];
  let y = PH - M, ops: string[] = [];
  for (const l of lines) {
    const lh = l.size * 1.35 + l.gap;
    if (y - lh < M) { pages.push(ops.join('\n')); ops = []; y = PH - M; }
    y -= lh;
    if (l.text) ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${(M + l.indent).toFixed(2)} ${y.toFixed(2)} Td (${winAnsi(l.text)}) Tj ET`);
  }
  pages.push(ops.join('\n'));
  const total = pages.length;
  pages.forEach((p, i) => { pages[i] = `${p}\nBT /F1 9 Tf ${(PW / 2 - 10).toFixed(2)} 30 Td (${i + 1} / ${total}) Tj ET`; });

  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const kids: string[] = [];
  pages.forEach((content, i) => {
    const pageId = 5 + i * 2, contentId = 6 + i * 2;
    kids.push(`${pageId} 0 R`);
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  const infoId = objs.length;
  objs[infoId] = `<< /Title (${winAnsi(title || 'Document Odin')}) /Producer (Odin) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`;
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = Buffer.byteLength(pdf, 'latin1'); pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
