// Export des pages d'applis · Word (.docx).
// Un vrai document Word : titres, chiffres clés en tuiles, vrais tableaux (ligne d'en-tête répétée à chaque page),
// listes, journaux en caractères à largeur fixe, numéro de page. Même fabrication que `src/files/office.ts`
// (une archive ZIP de fichiers XML, sans dépendance) ; ici on écrit les tableaux, qu'il ne sait pas faire.

import { zip } from '../../files/zip.ts';
import type { Tone } from '../types.ts';
import { colonnesCourbe, fiche, nombreFr, voisins } from './markdown.ts';
import { groupes, manques, provenance, vide, type PageExport, type SectionExport } from './page.ts';

const TETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** Largeur utile d'une page A4 avec 2 cm de marge, en vingtièmes de point. */
const LARGEUR = 11906 - 2 * 1134;
const GRIS = '5B6470', COULEUR: Record<string, string> = { bon: '1E7B3C', attention: 'B25E00', mauvais: 'B42318' };

/** Échappe un texte pour XML (les caractères interdits par XML 1.0 sont retirés). */
const x = (t: string) => t.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Style { gras?: boolean; italique?: boolean; couleur?: string; taille?: number; fixe?: boolean }
/** Un morceau de texte ; les retours à la ligne deviennent des sauts de ligne. */
function morceau(texte: string, s: Style = {}): string {
  if (!texte) return '';
  const pr = `${s.fixe ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Courier New"/>' : ''}${s.gras ? '<w:b/>' : ''}${s.italique ? '<w:i/>' : ''}${s.couleur ? `<w:color w:val="${s.couleur}"/>` : ''}${s.taille ? `<w:sz w:val="${s.taille}"/><w:szCs w:val="${s.taille}"/>` : ''}`;
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${texte.split('\n').map((l) => `<w:t xml:space="preserve">${x(l)}</w:t>`).join('<w:br/>')}</w:r>`;
}
interface Para { style?: string; avant?: number; apres?: number; retrait?: number; suspendu?: number; garde?: boolean; centre?: boolean }
function para(contenu: string, p: Para = {}): string {
  const pr = `${p.style ? `<w:pStyle w:val="${p.style}"/>` : ''}${p.garde ? '<w:keepNext/>' : ''}${p.avant !== undefined || p.apres !== undefined ? `<w:spacing${p.avant !== undefined ? ` w:before="${p.avant}"` : ''}${p.apres !== undefined ? ` w:after="${p.apres}"` : ''}/>` : ''}${p.retrait ? `<w:ind w:left="${p.retrait}"${p.suspendu ? ` w:hanging="${p.suspendu}"` : ''}/>` : ''}${p.centre ? '<w:jc w:val="center"/>' : ''}`;
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${contenu}</w:p>`;
}
const couleurDe = (t: Tone | undefined) => (t ? COULEUR[t] : undefined);

/** Largeurs des colonnes : selon la longueur de ce qu'elles contiennent, entre deux bornes, pour remplir la page. */
export function largeurs(colonnes: string[], lignes: string[][], total = LARGEUR): number[] {
  const n = Math.max(1, colonnes.length);
  const poids = Array.from({ length: n }, (_v, j) => Math.max(4, Math.min(42, Math.max((colonnes[j] ?? '').length, ...lignes.slice(0, 400).map((l) => Math.max(...String(l[j] ?? '').split(/\s+/).map((m) => m.length), Math.min(42, String(l[j] ?? '').length * 0.7)))))));
  const somme = poids.reduce((a, b) => a + b, 0), l = poids.map((p) => Math.floor((p / somme) * total));
  l[n - 1] += total - l.reduce((a, b) => a + b, 0);
  return l;
}
const BORD = (c: string) => `<w:top w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${c}"/>`;
const caseTab = (largeur: number, contenu: string, fond?: string) => `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : ''}</w:tcPr>${contenu}</w:tc>`;
/** Un tableau Word : en-tête grisé répété en haut de chaque page, une ligne ne se coupe pas entre deux pages. */
function tableau(colonnes: string[], lignes: Array<{ cells: string[]; tone?: Tone }>): string {
  const l = largeurs(colonnes, lignes.map((r) => r.cells)), petit = colonnes.length >= 7 ? 16 : 18;
  const tete = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${colonnes.map((c, j) => caseTab(l[j], para(morceau(c, { gras: true, taille: petit }), { avant: 20, apres: 20 }), 'EEF1F5')).join('')}</w:tr>`;
  const corps = lignes.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${colonnes.map((_c, j) => caseTab(l[j], para(morceau(r.cells[j] ?? '', { taille: petit, couleur: couleurDe(r.tone) }), { avant: 20, apres: 20 }))).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGEUR}" w:type="dxa"/><w:tblBorders>${BORD('BFC5CE')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${l.map((v) => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>${tete}${corps}</w:tbl>${para('', { apres: 60 })}`;
}
/** Les chiffres clés : des tuiles, quatre par ligne. */
function tuiles(p: PageExport): string {
  const par = Math.min(4, p.kpis.length), l = Math.floor(LARGEUR / par), rangs: string[] = [];
  for (let i = 0; i < p.kpis.length; i += par) {
    const rang = p.kpis.slice(i, i + par);
    rangs.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: par }, (_v, j) => { const k = rang[j]; return caseTab(l, k ? para(morceau(k.label, { taille: 16, couleur: GRIS }), { avant: 60, apres: 0 }) + para(morceau(k.value, { gras: true, taille: 24, couleur: couleurDe(k.tone) }), { avant: 0, apres: 60 }) : para(''), 'F4F6F9'); }).join('')}</w:tr>`);
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="${l * par}" w:type="dxa"/><w:tblBorders>${BORD('FFFFFF')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${Array.from({ length: par }, () => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${rangs.join('')}</w:tbl>${para('', { apres: 60 })}`;
}
const puce = (contenu: string) => para(`${morceau('•\t')}${contenu}`, { retrait: 400, suspendu: 240, apres: 60 });

function section(s: SectionExport, style: string): string {
  const titre = para(morceau(s.title || 'Sans titre'), { style, garde: true }), rien = vide(s);
  if (rien) return titre + para(morceau(rien, { italique: true, couleur: GRIS }));
  switch (s.kind) {
    case 'table': return titre + tableau(s.columns, s.rows);
    case 'list': return titre + s.items.map((i) => puce(`${morceau(i.title, { gras: true, couleur: couleurDe(i.tone) })}${i.detail ? morceau(` — ${i.detail}`, { couleur: couleurDe(i.tone) }) : ''}${i.meta ? morceau(` (${i.meta})`, { couleur: GRIS }) : ''}`)).join('');
    case 'cards': return titre + s.items.map((c) => puce(`${morceau(c.title, { gras: true, couleur: couleurDe(c.tone) })}${[c.sub, c.badge, c.meta].filter(Boolean).map((t) => morceau(` — ${t}`, { couleur: couleurDe(c.tone) })).join('')}${c.progress !== undefined ? morceau(` — ${Math.round(c.progress * 100)} %`, { couleur: GRIS }) : ''}`)).join('');
    case 'log': return titre + s.lines.map((l) => para(morceau(l || ' ', { fixe: true, taille: 15 }), { style: 'Journal' })).join('') + para('', { apres: 60 });
    case 'text': return titre + s.text.split(/\n{2,}/).map((t) => para(morceau(t, { couleur: couleurDe(s.tone) }))).join('');
    case 'bars': return titre + tableau(['Nom', 'Valeur'], s.items.map((i) => ({ cells: [i.label, i.display ?? nombreFr(i.value)] })));
    case 'courbe': return titre + tableau(colonnesCourbe(s), s.labels.map((l, i) => ({ cells: [l, ...s.series.map((v) => nombreFr(v.points[i] ?? 0))] })));
    case 'steps': return titre + s.items.map((i, n) => para(`${morceau(`${n + 1}.\t`)}${morceau(i.title, { gras: true })}${i.detail ? morceau(` — ${i.detail}`) : ''}${morceau(i.done ? '  (fait)' : '  (à faire)', { couleur: i.done ? COULEUR.bon : GRIS })}`, { retrait: 400, suspendu: 400, apres: 60 })).join('');
    case 'graph': return titre + para(morceau(`${s.nodes.length} point${s.nodes.length > 1 ? 's' : ''}, ${s.edges.length} lien${s.edges.length > 1 ? 's' : ''}${s.period ? ` · ${s.period}` : ''}`, { italique: true, couleur: GRIS })) + tableau(['Point', 'Détail', 'Fiche', 'Relié à'], s.nodes.map((n) => ({ cells: [n.label, n.sub ?? '', fiche(s, n.id), voisins(s, n.id)] })));
  }
}

const STYLES = (() => {
  const titre = (id: string, nom: string, taille: number, avant: number, niveau?: number) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nom}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${avant}" w:after="120"/>${niveau !== undefined ? `<w:outlineLvl w:val="${niveau}"/>` : ''}</w:pPr><w:rPr><w:b/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr></w:style>`;
  return `${TETE}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + titre('Title', 'Title', 44, 0) + titre('Heading1', 'heading 1', 30, 320, 0) + titre('Heading2', 'heading 2', 25, 240, 1)
    + '<w:style w:type="paragraph" w:styleId="Journal"><w:name w:val="Journal"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
    + '</w:styles>';
})();

/** La page en document Word. Pur. */
export function enDocx(p: PageExport): Buffer {
  const corps: string[] = [para(morceau(p.app.name), { style: 'Title' }), para(morceau(p.app.what, { italique: true })), para(morceau(provenance(p), { taille: 17, couleur: GRIS }))];
  if (p.subtitle) corps.push(para(morceau(p.subtitle, { gras: true })));
  if (p.kpis.length) corps.push(para(morceau('Chiffres clés'), { style: 'Heading1', garde: true }), tuiles(p));
  for (const g of groupes(p)) {
    if (g.onglet) corps.push(para(morceau(g.onglet), { style: 'Heading1', garde: true }));
    for (const s of g.sections) corps.push(section(s, g.onglet ? 'Heading2' : 'Heading1'));
  }
  if (!p.kpis.length && !p.sections.length) corps.push(para(morceau('Cette page n\'a rien à montrer pour l\'instant.', { italique: true, couleur: GRIS })));
  for (const [i, n] of manques(p).entries()) corps.push(para(morceau(n, { italique: true, taille: 17, couleur: GRIS }), { avant: i === 0 ? 360 : 0 }));
  const document = `${TETE}<w:document ${W} ${R}><w:body>${corps.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const pied = `${TETE}<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="${GRIS}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${GRIS}"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="${GRIS}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const quand = new Date(p.at).toISOString().replace(/\.\d+Z$/, 'Z');
  const fiche1 = `${TETE}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(p.app.name)}</dc:title><dc:creator>Odin</dc:creator><cp:lastModifiedBy>Odin</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${quand}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${quand}</dcterms:modified></cp:coreProperties>`;
  const rel = (l: Array<[string, string, string]>) => `${TETE}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${l.map(([id, type, cible]) => `<Relationship Id="${id}" Type="${type}" Target="${cible}"/>`).join('')}</Relationships>`;
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`${TETE}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(rel([['rId1', `${OD}/officeDocument`, 'word/document.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml']])) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(rel([['rId1', `${OD}/styles`, 'styles.xml'], ['rId2', `${OD}/footer`, 'footer1.xml']])) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/styles.xml', data: Buffer.from(STYLES) },
    { name: 'word/footer1.xml', data: Buffer.from(pied) },
    { name: 'docProps/core.xml', data: Buffer.from(fiche1) },
  ]);
}
