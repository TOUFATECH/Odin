// Pygmalion — les tableurs (Excel .xlsx, OpenDocument .ods) et le CSV, écrits dans Odin, à cellules TYPÉES.
// Sécurité : un TEXTE reste un texte, même s'il commence par « = », « + », « - » ou « @ » (une donnée venue de dehors ne
// devient jamais une formule). Une formule n'existe que si elle est demandée comme telle ({ formule }) ET si elle ne
// contient que des références de cellules, des nombres, des opérateurs et des fonctions de calcul d'une liste blanche
// (SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, IF) : jamais de lien, d'appel externe, de commande ni de texte libre.
// Le CSV neutralise les débuts dangereux (« = + - @ », tabulation, retour) par une apostrophe, comme le recommandent les
// guides publics de sécurité des tableurs.
import { zip } from '../../files/zip.ts';
import { BORNES, type Cellule } from './types.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // caractères interdits en XML 1.0 (contrôles) : retirés
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** La limite publiée d'Excel : 32 767 caractères par cellule (au-delà, le fichier serait « réparé » ou refusé). */
export const MAX_CELLULE_XLSX = 32_767;

export const FONCTIONS_PERMISES = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ROUND', 'ABS', 'IF'] as const;

/** Une formule sûre (sans « = » initial), ou une erreur en clair. */
export function formuleSure(f: string): string {
  const x = String(f ?? '').trim().replace(/^=/, '').toUpperCase();
  if (!x || x.length > 500) throw new Error('formule vide ou trop longue');
  // Seulement : références (A1, $B$2), plages, nombres, opérateurs, parenthèses, séparateurs, comparaisons, fonctions.
  if (!/^[A-Z0-9$:.,;+\-*/^()<>= ]+$/.test(x)) throw new Error(`formule refusée (caractère non permis) : ${f}`);
  // Tout mot suivi de « ( » est un appel de fonction, même s'il a la forme d'une cellule (LOG10, A1) : liste blanche.
  for (const m of x.matchAll(/([A-Z][A-Z0-9.]*)\s*\(/g)) if (!(FONCTIONS_PERMISES as readonly string[]).includes(m[1])) throw new Error(`formule refusée (fonction non permise : ${m[1]})`);
  // Un mot qui n'est ni une fonction permise ni une référence de cellule : refusé (pas de nom défini, pas de lien).
  for (const m of x.replace(/\$/g, '').matchAll(/[A-Z]+[0-9]*/g)) {
    const w = m[0];
    if ((FONCTIONS_PERMISES as readonly string[]).includes(w)) continue;
    if (/^[A-Z]{1,3}[0-9]{1,7}$/.test(w)) continue;
    throw new Error(`formule refusée (mot inconnu : ${w})`);
  }
  if ((x.match(/\(/g)?.length ?? 0) !== (x.match(/\)/g)?.length ?? 0)) throw new Error('formule refusée (parenthèses)');
  return x.replace(/;/g, ',');
}

type Typee = { t: 'n'; v: number } | { t: 'b'; v: boolean } | { t: 's'; v: string } | { t: 'f'; v: string } | { t: 'vide' };
/** La cellule typée : un texte reste un texte, quoi qu'il contienne. */
export function typer(c: Cellule): Typee {
  if (c === null || c === undefined || c === '') return { t: 'vide' };
  if (typeof c === 'number') return Number.isFinite(c) ? { t: 'n', v: c } : { t: 's', v: String(c) };
  if (typeof c === 'boolean') return { t: 'b', v: c };
  if (typeof c === 'object' && 'formule' in c) return { t: 'f', v: formuleSure(c.formule) };
  if (typeof c === 'object' && 'texte' in c) return { t: 's', v: String(c.texte) };
  return { t: 's', v: String(c) };
}

const colonne = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const nomFeuille = (n: string, i: number) => (String(n ?? '').replace(/[\\/?*[\]:]/g, ' ').trim() || `Feuille${i + 1}`).slice(0, 31);

function verifierTaille(feuilles: Array<{ lignes: Cellule[][] }>): void {
  const n = feuilles.reduce((s, f) => s + f.lignes.reduce((t, l) => t + l.length, 0), 0);
  if (!feuilles.length) throw new Error('au moins une feuille');
  if (n > BORNES.cellules) throw new Error(`trop de cellules (${n} > ${BORNES.cellules})`);
}

/** Classeur Excel (.xlsx), cellules typées. La première ligne est en gras. */
export function ecrireXlsx(feuilles: Array<{ nom: string; lignes: Cellule[][] }>): Buffer {
  verifierTaille(feuilles);
  const noms = feuilles.map((f, i) => nomFeuille(f.nom, i));
  if (new Set(noms.map((n) => n.toLowerCase())).size !== noms.length) throw new Error('deux feuilles portent le même nom');
  const xmlFeuilles = feuilles.map((f) => {
    const lignes = f.lignes.map((l, li) => `<row r="${li + 1}">${l.map((c, ci) => {
      const ref = `${colonne(ci)}${li + 1}`, st = li === 0 ? ' s="1"' : '', x = typer(c);
      if (x.t === 'vide') return '';
      if (x.t === 'n') return `<c r="${ref}"${st}><v>${x.v}</v></c>`;
      if (x.t === 'b') return `<c r="${ref}" t="b"${st}><v>${x.v ? 1 : 0}</v></c>`;
      if (x.t === 'f') return `<c r="${ref}"${st}><f>${esc(x.v)}</f></c>`;
      if (x.v.length > MAX_CELLULE_XLSX) throw new Error(`cellule ${ref} trop longue pour Excel (${x.v.length} caractères ; Excel en accepte 32 767 au plus) : rien n'est écrit`);
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(x.v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes}</sheetData></worksheet>`;
  });
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${noms.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    // calcFullLoad : le tableur recalcule les formules à l'ouverture (aucune valeur précalculée n'est écrite).
    { name: 'xl/workbook.xml', data: Buffer.from(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${noms.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${noms.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${noms.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: Buffer.from(`${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...xmlFeuilles.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(x) })),
  ]);
}

/** Une formule Excel (A1:A3) en formule OpenDocument (of:=SUM([.A1:.A3])). */
export function formuleOdf(f: string): string {
  const x = f.replace(/\$?([A-Z]{1,3})\$?([0-9]{1,7})\s*:\s*\$?([A-Z]{1,3})\$?([0-9]{1,7})/g, '[.$1$2:.$3$4]').replace(/(?<![.\w[])\$?([A-Z]{1,3})\$?([0-9]{1,7})(?![\w\]])/g, '[.$1$2]');
  return `of:=${x.replace(/,/g, ';')}`;
}

/** Le corps (office:body) d'un tableur OpenDocument. */
export function corpsOds(feuilles: Array<{ nom: string; lignes: Cellule[][] }>): string {
  verifierTaille(feuilles);
  return `<office:spreadsheet>${feuilles.map((f, i) => `<table:table table:name="${esc(nomFeuille(f.nom, i))}">${f.lignes.map((l) => `<table:table-row>${l.map((c) => {
    const x = typer(c);
    if (x.t === 'vide') return '<table:table-cell/>';
    if (x.t === 'n') return `<table:table-cell office:value-type="float" office:value="${x.v}"><text:p>${x.v}</text:p></table:table-cell>`;
    if (x.t === 'b') return `<table:table-cell office:value-type="boolean" office:boolean-value="${x.v}"><text:p>${x.v ? 'VRAI' : 'FAUX'}</text:p></table:table-cell>`;
    if (x.t === 'f') return `<table:table-cell table:formula="${esc(formuleOdf(x.v))}" office:value-type="float"/>`;
    return `<table:table-cell office:value-type="string"><text:p>${esc(x.v)}</text:p></table:table-cell>`;
  }).join('')}</table:table-row>`).join('')}</table:table>`).join('')}</office:spreadsheet>`;
}

/** CSV (séparateur « ; », guillemets si besoin) ; un début dangereux reçoit une apostrophe (jamais une formule). */
export function ecrireCsv(lignes: Cellule[][], sep = ';'): string {
  const cell = (c: Cellule): string => {
    const x = typer(typeof c === 'object' && c && 'formule' in c ? { texte: `=${c.formule}` } : c);
    let v = x.t === 'vide' ? '' : x.t === 'b' ? (x.v ? 'VRAI' : 'FAUX') : String(x.v);
    if (x.t === 's' && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    return /["\n\r;,]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return `${lignes.map((l) => l.map(cell).join(sep)).join('\r\n')}\r\n`;
}
