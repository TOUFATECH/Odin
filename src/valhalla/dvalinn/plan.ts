// Alchimie · les recettes de conversion : quel outil libre de la machine, avec quels arguments (pur, testé).
// Idées reprises de VERT, Frame, BentoPDF, Stirling-PDF, IT-Tools et Tdarr ; aucun code copié.
//   - vidéo et son : ffmpeg ;  images : ImageMagick ;  bureautique : LibreOffice (sans écran) et pandoc ;
//   - PDF : qpdf (fusion, découpe, rotation, mot de passe, allègement), Ghostscript si présent (compression forte),
//     Poppler (texte, images), OCRmyPDF si présent (texte reconnu) ;  livres : Calibre si présent.
import { basename, dirname, extname, join } from 'node:path';

export type Family = 'video' | 'audio' | 'image' | 'document' | 'tableur' | 'presentation' | 'texte' | 'pdf' | 'livre';
const FAM: Record<string, Family> = {};
for (const e of ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv', 'flv', 'ts', 'mpg', 'mpeg', '3gp']) FAM[e] = 'video';
for (const e of ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'wma', 'aiff', 'alac']) FAM[e] = 'audio';
for (const e of ['png', 'jpg', 'jpeg', 'webp', 'avif', 'heic', 'heif', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'svg', 'jxl']) FAM[e] = 'image';
for (const e of ['docx', 'doc', 'odt', 'rtf']) FAM[e] = 'document';
for (const e of ['xlsx', 'xls', 'ods', 'csv']) FAM[e] = 'tableur';
for (const e of ['pptx', 'ppt', 'odp']) FAM[e] = 'presentation';
for (const e of ['md', 'html', 'htm', 'txt', 'tex']) FAM[e] = 'texte';
FAM.pdf = 'pdf';
for (const e of ['epub', 'mobi', 'azw3', 'fb2']) FAM[e] = 'livre';
export const extOf = (f: string) => extname(f).slice(1).toLowerCase();
export const familyOf = (f: string): Family | undefined => FAM[extOf(f)] ?? FAM[f.toLowerCase()];

/** Ce qu'on peut faire d'un type de fichier (pour l'aide et le formulaire). */
export const TARGETS: Record<Family, string[]> = {
  video: ['mp4', 'mkv', 'webm', 'mov', 'gif', 'mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus'],
  audio: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac'],
  image: ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico', 'pdf'],
  document: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'html', 'md'],
  tableur: ['pdf', 'xlsx', 'ods', 'csv'],
  presentation: ['pdf', 'pptx', 'odp'],
  texte: ['pdf', 'docx', 'odt', 'html', 'md', 'txt'],
  pdf: ['txt', 'png', 'jpg', 'docx', 'pdfa'],
  livre: ['epub', 'mobi', 'azw3', 'pdf'],
};

export interface Opts { qualite?: 'haute' | 'normale' | 'legere'; largeur?: number; hauteur?: number; codec?: 'h264' | 'h265' | 'av1'; sansSon?: boolean; debut?: string; duree?: string; fps?: number }
export interface Step { cmd: string; args: string[]; out: string; /** le fichier produit sous un autre nom (LibreOffice choisit le nom) */ produced?: string; alt?: { cmd: string; args: string[] } }

const CRF: Record<string, Record<string, number>> = { h264: { haute: 18, normale: 22, legere: 28 }, h265: { haute: 20, normale: 25, legere: 30 }, av1: { haute: 24, normale: 30, legere: 38 } };
const time = (t?: string) => (t && /^\d{1,2}(:\d{2}){0,2}(\.\d+)?$/.test(t) ? t : undefined);

/** La recette pour convertir `src` vers le format `to` ; `out` = fichier produit (dans `outDir`). Pur. */
export function plan(src: string, to: string, outDir: string, o: Opts = {}): Step {
  const from = familyOf(src); to = to.toLowerCase().replace(/^\./, '');
  if (!from) throw new Error(`type de fichier inconnu : ${extOf(src) || basename(src)}`);
  if (!TARGETS[from].includes(to)) throw new Error(`${extOf(src)} → ${to} : pas possible (${from} → ${TARGETS[from].join(', ')})`);
  const stem = basename(src, extname(src)), out = join(outDir, `${stem}.${to === 'pdfa' ? 'pdfa.pdf' : to}`);
  const q = o.qualite ?? 'normale';
  if (from === 'video' || from === 'audio') {
    const a = ['-hide_banner', '-nostdin', '-y'];
    if (time(o.debut)) a.push('-ss', time(o.debut)!);
    a.push('-i', src);
    if (time(o.duree)) a.push('-t', time(o.duree)!);
    const toFam = FAM[to];
    if (to === 'gif') {
      const w = o.largeur ?? 480, fps = o.fps ?? 12;
      a.push('-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-an', out);
    } else if (toFam === 'audio') {
      a.push('-vn');
      const br = { haute: '320k', normale: '192k', legere: '128k' }[q];
      if (to === 'mp3') a.push('-c:a', 'libmp3lame', '-b:a', br);
      else if (to === 'ogg') a.push('-c:a', 'libvorbis', '-q:a', q === 'haute' ? '8' : q === 'normale' ? '5' : '3');
      else if (to === 'opus') a.push('-c:a', 'libopus', '-b:a', q === 'haute' ? '192k' : q === 'normale' ? '128k' : '64k');
      else if (to === 'm4a' || to === 'aac') a.push('-c:a', 'aac', '-b:a', br);
      else if (to === 'flac') a.push('-c:a', 'flac');
      else a.push('-c:a', 'pcm_s16le');
      a.push(out);
    } else {
      const codec = to === 'webm' ? (o.codec === 'av1' ? 'av1' : 'vp9') : o.codec ?? 'h264';
      const scale = o.largeur || o.hauteur ? ['-vf', `scale=${o.largeur ? `'min(${o.largeur},iw)'` : -2}:${o.hauteur ? `'min(${o.hauteur},ih)'` : -2}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`] : [];
      if (codec === 'vp9') a.push('-c:v', 'libvpx-vp9', '-crf', String({ haute: 28, normale: 33, legere: 40 }[q]), '-b:v', '0', ...scale, ...(o.sansSon ? ['-an'] : ['-c:a', 'libopus', '-b:a', '128k']));
      else {
        const lib = codec === 'h265' ? 'libx265' : codec === 'av1' ? 'libsvtav1' : 'libx264';
        a.push('-c:v', lib, '-crf', String(CRF[codec][q]), '-preset', codec === 'av1' ? '8' : 'veryfast', '-pix_fmt', 'yuv420p', ...scale, ...(o.sansSon ? ['-an'] : ['-c:a', 'aac', '-b:a', '160k']));
        if (to === 'mp4' || to === 'mov') a.push('-movflags', '+faststart');
        if (codec === 'h265' && (to === 'mp4' || to === 'mov')) a.push('-tag:v', 'hvc1');
      }
      a.push(out);
    }
    return { cmd: 'ffmpeg', args: a, out };
  }
  if (from === 'image') {
    const a = [src + (extOf(src) === 'gif' && to !== 'gif' ? '[0]' : '')];
    if (o.largeur || o.hauteur) a.push('-resize', `${o.largeur ?? ''}x${o.hauteur ?? ''}>`);
    if (['jpg', 'webp', 'avif'].includes(to)) a.push('-quality', String({ haute: 92, normale: 82, legere: 65 }[q]));
    if (to === 'ico') a.push('-define', 'icon:auto-resize=256,128,64,48,32,16');
    a.push('-strip', out);
    return { cmd: 'magick', args: a, out, alt: { cmd: 'convert', args: a } };
  }
  if (from === 'pdf') {
    if (to === 'txt') return { cmd: 'pdftotext', args: ['-layout', src, out], out };
    if (to === 'png' || to === 'jpg') { const prefix = join(outDir, stem); return { cmd: 'pdftoppm', args: [to === 'png' ? '-png' : '-jpeg', '-r', q === 'haute' ? '200' : q === 'normale' ? '150' : '100', src, prefix], out: prefix, produced: `${prefix}-*.${to === 'png' ? 'png' : 'jpg'}` }; }
    if (to === 'pdfa') return { cmd: 'ocrmypdf', args: ['--output-type', 'pdfa', '--skip-text', '-l', 'fra+eng', src, out], out };
    // PDF → Word : LibreOffice (mise en page approximative)
    return { cmd: 'soffice', args: ['--headless', '--infilter=writer_pdf_import', '--convert-to', 'docx', '--outdir', outDir, src], out, produced: join(outDir, `${stem}.docx`) };
  }
  if (from === 'livre' || (to !== 'pdf' && FAM[to] === 'livre')) return { cmd: 'ebook-convert', args: [src, out], out };
  // Texte (md, html, txt) vers document : pandoc ; le reste : LibreOffice sans écran
  if (from === 'texte' && to !== 'pdf' && (extOf(src) === 'md' || ['md', 'html', 'docx', 'odt'].includes(to))) return { cmd: 'pandoc', args: [src, '-o', out, ...(to === 'html' ? ['--standalone', '--embed-resources'] : [])], out };
  if (from === 'document' && (to === 'md' || to === 'html' && extOf(src) === 'docx')) return { cmd: 'pandoc', args: [src, '-o', out, ...(to === 'html' ? ['--standalone', '--embed-resources'] : [])], out };
  const filter = to === 'txt' ? 'txt:Text (encoded):UTF8' : to;
  return { cmd: 'soffice', args: ['--headless', '--norestore', '--convert-to', filter, '--outdir', outDir, src], out, produced: join(outDir, `${stem}.${to}`) };
}

// ------------------------------------------------------------------ PDF (comme BentoPDF / Stirling-PDF)
export type PdfOp = 'fusionner' | 'extraire' | 'decouper' | 'pivoter' | 'alleger' | 'compresser' | 'proteger' | 'deproteger' | 'images_en_pdf' | 'nettoyer';
/** Une plage de pages valide pour qpdf (« 1-3,5,8-z »). Pur. */
export function pages(p: string): string {
  const x = String(p ?? '').replace(/\s+/g, '').replace(/fin|dernière|derniere/gi, 'z');
  if (!/^(r?\d+|z)(-(r?\d+|z))?(,(r?\d+|z)(-(r?\d+|z))?)*$/.test(x)) throw new Error(`pages invalides : « ${p} » (ex. 1-3,5,8-fin)`);
  return x;
}
/** Les recettes PDF. `secretFile` : fichier d'arguments (mots de passe hors de la ligne de commande). Pur. */
export function pdfPlan(op: PdfOp, files: string[], out: string, o: { pages?: string; angle?: number; secretFile?: string } = {}): Step {
  const f = files[0];
  if (!files.length) throw new Error('aucun fichier');
  switch (op) {
    case 'fusionner': if (files.length < 2) throw new Error('il faut au moins deux PDF'); return { cmd: 'qpdf', args: ['--empty', '--pages', ...files, '--', out], out };
    case 'extraire': return { cmd: 'qpdf', args: [f, '--pages', f, pages(o.pages ?? ''), '--', out], out };
    case 'decouper': { const d = join(dirname(out), basename(out, '.pdf')); return { cmd: 'qpdf', args: ['--split-pages=1', f, `${d}-page-%d.pdf`], out: d, produced: `${d}-page-*.pdf` }; }
    case 'pivoter': { const a = o.angle ?? 90; if (![90, 180, 270, -90].includes(a)) throw new Error('angle : 90, 180 ou 270'); return { cmd: 'qpdf', args: [f, `--rotate=${a > 0 ? '+' : ''}${a}:${o.pages ? pages(o.pages) : '1-z'}`, out], out }; }
    case 'alleger': return { cmd: 'qpdf', args: [f, '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', '--remove-unreferenced-resources=yes', out], out };
    case 'compresser': return { cmd: 'gs', args: ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${out}`, f], out, alt: { cmd: 'qpdf', args: [f, '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', out] } };
    case 'proteger': if (!o.secretFile) throw new Error('mot de passe manquant'); return { cmd: 'qpdf', args: [`@${o.secretFile}`], out };
    case 'deproteger': if (!o.secretFile) throw new Error('mot de passe manquant'); return { cmd: 'qpdf', args: [`@${o.secretFile}`], out };
    case 'images_en_pdf': return { cmd: 'magick', args: [...files, out], out, alt: { cmd: 'convert', args: [...files, out] } };
    case 'nettoyer': return { cmd: 'qpdf', args: [f, '--remove-metadata', '--remove-info', out], out, alt: { cmd: 'qpdf', args: [f, out] } };
  }
}
/** Le contenu du fichier d'arguments qpdf pour un mot de passe (une option par ligne). Pur. */
export function qpdfSecretArgs(op: 'proteger' | 'deproteger', src: string, out: string, pw: string): string {
  if (!pw || /[\r\n]/.test(pw)) throw new Error('mot de passe invalide');
  return (op === 'proteger' ? ['--encrypt', pw, pw, '256', '--', src, out] : [`--password=${pw}`, '--decrypt', src, out]).join('\n') + '\n';
}
