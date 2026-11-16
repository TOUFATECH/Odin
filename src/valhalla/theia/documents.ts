// Théia — lire tout document SANS serveur ni logiciel de bureautique lancé à côté. Les formats modernes de bureautique
// sont des archives zip + XML : lisibles nativement (comme src/files/office.ts pour .docx/.xlsx/.pptx). Ici on ajoute :
//   - OpenDocument : .odt (texte), .ods (tableur), .odp (présentation) ;
//   - RTF (texte enrichi) et HTML ;
//   - l'extraction de l'image pleine page d'un PDF scanné (DCTDecode = JPEG prêt, FlateDecode = bitmap brut), car
//     l'extracteur de texte (files/pdf.ts) saute les flux image : c'est Théia (l'œil) qui lit ensuite ces pages par OCR.
// Les vieux formats binaires (.doc/.xls/.ppt d'avant 2007) ne sont PAS décodés ici : honnêtement « lu en partie ».
// Entrée venue de l'extérieur = hostile : taille bornée avant toute allocation, analyse stricte, aucun chemin construit.
import { inflateSync } from 'node:zlib';
import { unzip } from '../../files/zip.ts';

/** Plafond d'un document passé au lecteur intégré (comme files/pdf.ts) : au-delà, « lu en partie ». */
const MAX_BUF = 40 * 1024 * 1024;
const MAX_IMAGES = 120;
/** Plafond dur de la sortie d'UN flux image décompressé (64 Mpx × 3 octets) : borne la décompression FlateDecode. */
const DUR_SORTIE = 64 * 1024 * 1024 * 3;

/** Un bloc de la structure d'un document : titre, paragraphe, liste, tableau ou image. */
export interface BlocDoc {
  type: 'titre' | 'paragraphe' | 'liste' | 'tableau' | 'image';
  niveau?: number;              // titre : 1..6
  texte?: string;               // titre, paragraphe
  items?: string[];            // liste
  lignes?: string[][];          // tableau
  source?: string;              // image : son nom dans l'archive
}

/** Le résultat d'une lecture : le texte, la structure, et — honnêtement — s'il a été lu en entier ou en partie. */
export interface Document {
  texte: string;
  blocs: BlocDoc[];
  via: string;
  lu: boolean;      // false => rien n'a pu être lu
  partiel: boolean; // true => format seulement en partie couvert (vieux binaire, PDF abîmé…)
  pages?: number;
}

// ------------------------------------------------------------------ Entités et XML
const cp = (n: number) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�');
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => cp(Number(d)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&');

/** Le texte brut d'un fragment XML OpenDocument (tabulations, espaces répétés et sauts de ligne rendus). */
function texteOdf(xml: string): string {
  return decode(xml
    .replace(/<text:tab\b[^>]*\/?>/g, '\t')
    .replace(/<text:line-break\b[^>]*\/?>/g, '\n')
    .replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/?>/g, (_, n: string) => ' '.repeat(Math.min(80, Number(n))))
    .replace(/<text:s\b[^>]*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trim();
}

// ------------------------------------------------------------------ OpenDocument (.odt .ods .odp)
/** Lecture native d'un OpenDocument : titres, paragraphes, listes, tableaux et images, dans l'ordre. */
export function lireOdf(buf: Buffer, ext: string): Document {
  if (buf.length > MAX_BUF) return { texte: '', blocs: [], via: 'OpenDocument', lu: false, partiel: true };
  // Document abîmé ou chiffré (conteneur protégé par mot de passe) : unzip lève « archive ZIP invalide ». On ne laisse
  // PAS l'exception remonter (contrat « signalé sans planter ») : « lu en partie » honnête, comme content.xml absent.
  let files: Map<string, Buffer>;
  try { files = unzip(buf); }
  catch { return { texte: '', blocs: [], via: 'OpenDocument (illisible ou chiffré)', lu: false, partiel: true }; }
  const content = files.get('content.xml')?.toString('utf8');
  if (!content) return { texte: '', blocs: [], via: 'OpenDocument', lu: false, partiel: true };
  const corps = /<office:body>([\s\S]*?)<\/office:body>/.exec(content)?.[1] ?? content;
  const blocs: BlocDoc[] = [];
  // On parcourt les éléments de bloc dans l'ordre : titres, paragraphes, listes, tableaux, cadres d'image.
  const re = /<text:h\b([^>]*)>([\s\S]*?)<\/text:h>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:list\b[^>]*>([\s\S]*?)<\/text:list>|<table:table\b[^>]*>([\s\S]*?)<\/table:table>|<draw:image\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corps))) {
    if (m[1] !== undefined) {
      const niveau = Math.min(6, Math.max(1, Number(/text:outline-level="(\d+)"/.exec(m[1])?.[1] ?? 1)));
      const t = texteOdf(m[2]); if (t) blocs.push({ type: 'titre', niveau, texte: t });
    } else if (m[3] !== undefined) {
      const t = texteOdf(m[3]); if (t) blocs.push({ type: 'paragraphe', texte: t });
    } else if (m[4] !== undefined) {
      const items = [...m[4].matchAll(/<text:list-item\b[^>]*>([\s\S]*?)<\/text:list-item>/g)].map((x) => texteOdf(x[1])).filter(Boolean);
      if (items.length) blocs.push({ type: 'liste', items });
    } else if (m[5] !== undefined) {
      const lignes = [...m[5].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)]
        .map((r) => [...r[1].matchAll(/<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b[^>]*\/>/g)]
          .flatMap((c) => { const rep = Number(/table:number-columns-repeated="(\d+)"/.exec(c[1] ?? '')?.[1] ?? 1); const v = texteOdf(c[2] ?? ''); return Array.from({ length: Math.min(50, rep) }, () => v); }));
      if (lignes.length) blocs.push({ type: 'tableau', lignes });
    } else if (m[6] !== undefined) {
      const src = /xlink:href="([^"]+)"/.exec(m[6])?.[1] ?? '';
      blocs.push({ type: 'image', source: src.replace(/^\.?\//, '') });
    }
  }
  const texte = blocsEnTexte(blocs);
  return { texte, blocs, via: `OpenDocument ${ext}`, lu: Boolean(texte) || blocs.some((b) => b.type === 'image'), partiel: false };
}

/** La structure rendue en texte simple (titres en #, listes en -, tableaux en lignes séparées par des tabulations). */
export function blocsEnTexte(blocs: BlocDoc[]): string {
  const out: string[] = [];
  for (const b of blocs) {
    if (b.type === 'titre') out.push(`${'#'.repeat(b.niveau ?? 1)} ${b.texte ?? ''}`);
    else if (b.type === 'paragraphe') out.push(b.texte ?? '');
    else if (b.type === 'liste') out.push((b.items ?? []).map((i) => `- ${i}`).join('\n'));
    else if (b.type === 'tableau') out.push((b.lignes ?? []).map((l) => l.join('\t')).join('\n'));
    else if (b.type === 'image') out.push(`[image : ${b.source ?? ''}]`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------ RTF
/** Lecture native d'un RTF : groupes ignorés (polices, couleurs, images…), \\uN et \\'hh décodés, \\par en saut. */
export function lireRtf(buf: Buffer): Document {
  if (buf.length > MAX_BUF) return { texte: '', blocs: [], via: 'RTF', lu: false, partiel: true };
  const rtf = buf.toString('latin1');
  let out = '', i = 0, ignorerProfondeur = 0;
  const pile: boolean[] = []; // à chaque groupe : est-on dans un groupe ignoré ?
  const ignore = () => ignorerProfondeur > 0;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') { pile.push(false); i++; continue; }
    if (ch === '}') { if (pile.pop()) ignorerProfondeur--; i++; continue; }
    if (ch === '\\') {
      // Séquence de contrôle.
      const litt = /^\\([{}\\])/.exec(rtf.slice(i));
      if (litt) { if (!ignore()) out += litt[1]; i += 2; continue; }
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i));
      if (hex) { if (!ignore()) out += cp1252(parseInt(hex[1], 16)); i += 4; continue; }
      const uni = /^\\u(-?\d+)\s?/.exec(rtf.slice(i));
      if (uni) { if (!ignore()) out += cp(((Number(uni[1]) % 65536) + 65536) % 65536); i += uni[0].length; const skip = /^\\'..|^[^\\{} ]/.exec(rtf.slice(i)); if (skip) i += skip[0].length; continue; }
      const mot = /^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(rtf.slice(i));
      if (mot) {
        const cw = mot[1];
        if (cw === 'par' || cw === 'line' || cw === 'sect') { if (!ignore()) out += '\n'; }
        else if (cw === 'tab') { if (!ignore()) out += '\t'; }
        else if (/^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|datastore|generator|rsid)$/.test(cw)) { if (pile.length) { pile[pile.length - 1] = true; ignorerProfondeur++; } }
        i += mot[0].length; continue;
      }
      i++; continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (!ignore()) out += ch;
    i++;
  }
  const texte = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texte, blocs: texte ? texte.split('\n').filter(Boolean).map((t) => ({ type: 'paragraphe', texte: t } as BlocDoc)) : [], via: 'RTF', lu: Boolean(texte), partiel: false };
}
const CP1252: Record<number, string> = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' };
const cp1252 = (b: number) => CP1252[b] ?? String.fromCharCode(b);

// ------------------------------------------------------------------ HTML
/** Lecture native d'un HTML : scripts/styles retirés, structure gardée (titres, listes, tableaux, paragraphes). */
export function lireHtml(buf: Buffer | string): Document {
  const html = (typeof buf === 'string' ? buf : buf.toString('utf8'));
  if (html.length > MAX_BUF) return { texte: '', blocs: [], via: 'HTML', lu: false, partiel: true };
  const titre = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
  const corps = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html)
    .replace(/<(script|style|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const blocs: BlocDoc[] = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<li\b[^>]*>([\s\S]*?)<\/li>|<tr\b[^>]*>([\s\S]*?)<\/tr>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const nettoyer = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;
  let liste: string[] = [];
  const viderListe = () => { if (liste.length) { blocs.push({ type: 'liste', items: liste }); liste = []; } };
  while ((m = re.exec(corps))) {
    if (m[1]) { viderListe(); const t = nettoyer(m[2]); if (t) blocs.push({ type: 'titre', niveau: Number(m[1]), texte: t }); }
    else if (m[3] !== undefined) { const t = nettoyer(m[3]); if (t) liste.push(t); }
    else if (m[4] !== undefined) { viderListe(); const cells = [...m[4].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => nettoyer(c[1])); if (cells.length) { const last = blocs[blocs.length - 1]; if (last?.type === 'tableau') last.lignes!.push(cells); else blocs.push({ type: 'tableau', lignes: [cells] }); } }
    else if (m[5] !== undefined) { viderListe(); const t = nettoyer(m[5]); if (t) blocs.push({ type: 'paragraphe', texte: t }); }
  }
  viderListe();
  let texte = blocsEnTexte(blocs);
  if (!texte) { texte = nettoyer(corps); if (texte) blocs.push({ type: 'paragraphe', texte }); } // HTML sans balises de bloc
  return { texte, blocs, via: 'HTML', lu: Boolean(texte), partiel: false };
}

// ------------------------------------------------------------------ Images d'un PDF scanné
/** Une image extraite d'un PDF : JPEG prêt (DCTDecode) ou bitmap brut (FlateDecode : échantillons RGB/gris). */
export interface ImagePdf {
  num: number;
  genre: 'jpeg' | 'brut';
  data: Buffer;
  largeur?: number;
  hauteur?: number;
  composantes?: number; // bitmap brut : 1 (gris), 3 (RGB)
}

/**
 * Les images d'un PDF (une par page sur un scan). files/pdf.ts saute ces flux image : on les récupère ici pour que
 * l'œil (OCR) lise la page. DCTDecode → le flux EST un fichier JPEG. FlateDecode seul → bitmap décompressé (brut).
 */
export function imagesPagesPdf(buf: Buffer, maxImages = MAX_IMAGES): ImagePdf[] {
  if (buf.length > 20 * 1024 * 1024) return [];
  const raw = buf.toString('latin1');
  const out: ImagePdf[] = [];
  const re = /(\d+)\s+0\s+obj\s*(<<(?:(?!endobj|\bobj\b)[\s\S])*?>>)\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && out.length < maxImages) {
    const dict = m[2];
    if (!/\/Subtype\s*\/Image/.test(dict)) { continue; }
    const start = m.index + m[0].length;
    const lenMatch = /\/Length\s+(\d+)(?!\s+0\s+R)/.exec(dict);
    let end = lenMatch ? start + Number(lenMatch[1]) : raw.indexOf('endstream', start);
    if (end < 0 || end > raw.length) { end = raw.indexOf('endstream', start); if (end < 0) break; }
    const data = buf.subarray(start, end);
    const largeur = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0) || undefined;
    const hauteur = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0) || undefined;
    const compo = /\/DeviceRGB|\/RGB/.test(dict) ? 3 : /\/DeviceGray|\/CalGray|\/Gray/.test(dict) ? 1 : undefined;
    if (/\/DCTDecode/.test(dict)) out.push({ num: out.length + 1, genre: 'jpeg', data: Buffer.from(data), largeur, hauteur });
    else if (/\/FlateDecode/.test(dict) && !/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/JBIG2Decode/.test(dict)) {
      // Sortie bornée AVANT décompression (comme png.ts et zip.ts) : un flux FlateDecode peut gonfler x1000 (bombe zlib).
      // Plafond = pixels attendus × composantes (lus dans le dict) + marge, sinon un plafond dur de 64 Mpx × 3 octets.
      const attendu = largeur && hauteur ? largeur * hauteur * (compo ?? 3) + 1024 : 0;
      const plafond = Math.min(attendu || DUR_SORTIE, DUR_SORTIE);
      try { out.push({ num: out.length + 1, genre: 'brut', data: inflateSync(data, { maxOutputLength: plafond }), largeur, hauteur, composantes: compo }); } catch { /* flux illisible ou démesuré : ignoré */ }
    }
    re.lastIndex = end;
  }
  return out;
}

// ------------------------------------------------------------------ Aiguillage
/** L'extension d'un nom ou d'une extension donnée (sans le point, en minuscules). */
export const extDe = (nomOuExt: string): string => (nomOuExt.includes('.') ? nomOuExt.split('.').pop()! : nomOuExt).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Les formats que documents.ts lit nativement ici (en plus de .docx/.xlsx/.pptx de files/office.ts et des PDF-texte). */
export const FORMATS_NATIFS = ['odt', 'ods', 'odp', 'rtf', 'html', 'htm', 'xhtml'] as const;
/** Les vieux formats binaires non décodés nativement : « lus en partie » honnêtement (repli bureautique). */
export const FORMATS_VIEUX = ['doc', 'xls', 'ppt'] as const;

/** Lit un document d'après son extension, pour les formats propres à Théia (ODF, RTF, HTML). */
export function lireDocument(buf: Buffer, nomOuExt: string): Document {
  const ext = extDe(nomOuExt);
  // Filet : un document abîmé ne doit JAMAIS faire planter l'appelant (page « Lire un document », champollion). On
  // renvoie « lu en partie » plutôt que de laisser une exception remonter, quel que soit le lecteur.
  try {
    if (ext === 'odt' || ext === 'ods' || ext === 'odp') return lireOdf(buf, ext);
    if (ext === 'rtf') return lireRtf(buf);
    if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return lireHtml(buf);
  } catch { return { texte: '', blocs: [], via: `${ext} (illisible)`, lu: false, partiel: true }; }
  if ((FORMATS_VIEUX as readonly string[]).includes(ext)) return { texte: '', blocs: [], via: `vieux format ${ext}`, lu: false, partiel: true };
  return { texte: '', blocs: [], via: ext || 'inconnu', lu: false, partiel: true };
}
