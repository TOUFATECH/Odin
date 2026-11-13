// Outils de documents et médias : PDF, Word, Excel, PowerPoint, CSV, images, vidéo, audio.
// Tous les chemins restent dans l'espace de travail. Un fichier reçu de l'extérieur (inbox/)
// est un contenu NON FIABLE : la session est marquée, ses consignes ne sont jamais suivies.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { toolPath } from '../heimdall/policy.ts';
import { hasCommand } from '../learn/environment.ts';
import { transcribe, sttReady } from '../voice/voice.ts';
import { convertMedia, IMAGE_MIME, mediaInfo, type ConvertOptions } from '../files/media.ts';
import { createDocx, createPptx, createXlsx, parseCsv, readDocx, readPptx, readXlsx, toCsv, type Slide } from '../files/office.ts';
import { createPdf, readPdf } from '../files/pdf.ts';
import { bool, num, obj, str, type Tool, type ToolContext, type ToolResult } from './registry.ts';
import { isExternal, safeEnv } from './builtin.ts';
import { ocrPdf, ocrReady, understanding } from '../valhalla/champollion/ocr.ts';

const s = (v: unknown) => String(v ?? '');
const clip = (t: string, n = 40_000) => (t.length > n ? `${t.slice(0, n)}\n… [${t.length - n} caractères tronqués]` : t);
const MAX_FILE = 100 * 1024 * 1024;

function result(ctx: ToolContext, rel: string, text: string): ToolResult {
  const outside = isExternal(rel);
  return outside ? { output: wrapUntrusted(`fichier ${rel}`, clip(text)), tainted: true } : { output: clip(text) };
}

export const docRead: Tool = {
  name: 'doc_read',
  description: 'Lit un document de l\'espace de travail et renvoie son texte : PDF, Word (.docx), Excel (.xlsx, chaque feuille en CSV), PowerPoint (.pptx), CSV, texte. Pour une image, utilise image_view ; pour un audio ou une vidéo, audio_transcribe ou media_info.',
  risk: 'read',
  schema: obj({ path: str('chemin du fichier'), sheet: str('Excel : nom de la feuille (toutes par défaut)') }, ['path']),
  async run(i, ctx) {
    const p = toolPath(ctx, s(i.path));
    const rel = relative(realpathSync(ctx.workspace), realpathSync(p)).split(sep).join('/');
    if (statSync(p).size > MAX_FILE) return 'Fichier trop volumineux (100 Mo au plus).';
    const buf = readFileSync(p);
    const ext = extname(p).toLowerCase();
    if (ext === '.pdf') {
      const r = readPdf(buf, p);
      // PDF scanné (pas de texte) : Champollion reconnaît le texte des pages
      if (r.text.replace(/\s+/g, '').length / Math.max(1, r.pages || 1) < 40 && ocrReady()) {
        const o = await ocrPdf(p);
        if (o.text.trim()) return result(ctx, rel, `PDF scanné, ${o.pages} page(s), texte reconnu par Champollion\n\n${o.text}${understanding(o.text, rel)}`);
      }
      const txt = r.text || '(aucun texte : PDF scanné, et la reconnaissance de caractères n\'est pas installée : paquets tesseract-ocr tesseract-ocr-fra poppler-utils.)';
      return result(ctx, rel, `PDF, ${r.pages || '?'} page(s), lecture ${r.via}\n\n${txt}${r.text ? understanding(r.text, rel) : ''}`);
    }
    if (ext === '.docx') { const d = readDocx(buf); return result(ctx, rel, `${d}${understanding(d, rel)}`); }
    if (ext === '.xlsx' || ext === '.xlsm') {
      const sheets = readXlsx(buf).filter((sh) => !i.sheet || sh.name === s(i.sheet));
      if (!sheets.length) return `Feuille « ${s(i.sheet)} » introuvable.`;
      return result(ctx, rel, sheets.map((sh) => `## Feuille « ${sh.name} » (${sh.rows.length} lignes)\n${toCsv(sh.rows)}`).join('\n\n'));
    }
    if (ext === '.pptx') return result(ctx, rel, readPptx(buf));
    if (['.doc', '.xls', '.ppt', '.odt', '.ods', '.odp', '.rtf'].includes(ext)) {
      if (!hasCommand('soffice')) return `Ancien format ${ext} : convertis-le en .docx/.xlsx/.pptx (LibreOffice « soffice --headless --convert-to docx », à installer).`;
      return 'Utilise shell avec « soffice --headless --convert-to docx|xlsx|pptx <fichier> » puis relis le résultat.';
    }
    if (IMAGE_MIME[ext.slice(1)]) return 'C\'est une image : utilise image_view pour la regarder.';
    return result(ctx, rel, buf.toString('utf8'));
  },
};

export const docCreate: Tool = {
  name: 'doc_create',
  description: 'Crée un document dans l\'espace de travail : PDF ou Word (.docx) à partir de markdown simple (# titres, - listes, **gras**), Excel (.xlsx, une ou plusieurs feuilles ; formules en anglais, ex. =SUM(A2:A9)), CSV, ou PowerPoint (.pptx, diapositives titre + puces). Pour modifier un document existant : lis-le avec doc_read, puis recrée-le.',
  risk: 'write',
  schema: obj({
    path: str('chemin du fichier à créer (.pdf, .docx, .xlsx, .csv)'),
    title: str('titre du document (facultatif)'),
    content: str('PDF/Word : texte en markdown'),
    sheets: { type: 'array', description: 'Excel/CSV : [{ "name": "Feuille1", "rows": [["Colonne A","Colonne B"],[1,2]] }]', items: { type: 'object' } },
    slides: { type: 'array', description: 'PowerPoint : [{ "title": "…", "bullets": ["…", "…"] }]', items: { type: 'object' } },
  }, ['path']),
  summarize: (i) => `créer ${s(i.path)}`,
  async run(i, ctx) {
    const p = toolPath(ctx, s(i.path));
    const ext = extname(p).toLowerCase();
    let data: Buffer;
    const sheets = (Array.isArray(i.sheets) ? i.sheets : []) as Array<{ name?: string; rows?: unknown[][] }>;
    const rowsOf = (sh: { rows?: unknown[][] }) => (sh.rows ?? []).map((r) => (Array.isArray(r) ? r : [r]).map((v) => (typeof v === 'number' || typeof v === 'boolean' ? v : v == null ? '' : String(v))));
    if (ext === '.pdf') data = createPdf(s(i.content), s(i.title));
    else if (ext === '.docx') data = createDocx(s(i.content), s(i.title));
    else if (ext === '.xlsx') {
      const list = sheets.length ? sheets : [{ name: 'Feuille1', rows: parseCsv(s(i.content)) }];
      data = createXlsx(list.map((sh, k) => ({ name: sh.name ?? `Feuille${k + 1}`, rows: rowsOf(sh) })));
    } else if (ext === '.pptx') {
      const slides = (Array.isArray(i.slides) ? i.slides : []) as Slide[];
      if (!slides.length) return 'PowerPoint : indique les diapositives dans « slides ».';
      data = createPptx(slides.map((x) => ({ title: String(x.title ?? ''), bullets: Array.isArray(x.bullets) ? x.bullets.map(String) : [] })), s(i.title));
    } else if (ext === '.csv') data = Buffer.from('﻿' + toCsv((sheets[0] ? rowsOf(sheets[0]) : parseCsv(s(i.content))).map((r) => r.map(String))), 'utf8');
    else return 'Format non pris en charge : .pdf, .docx, .xlsx, .pptx ou .csv (pour un autre format, écris un fichier texte avec fs_write).';
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return `Créé : ${relative(ctx.workspace, p)} (${Math.round(data.length / 1024)} Ko).`;
  },
};

export const imageView: Tool = {
  name: 'image_view',
  description: 'Regarde une photo ou une image (fichier reçu, capture, scan, schéma, ou lien http(s) vers une image) et répond : ce qu\'on voit (personnes, lieu, objets, actions), textes recopiés (factures, panneaux, écrans), défauts, ou une analyse détaillée si on la demande. Formats courants convertis tout seuls (HEIC, BMP, TIFF, grandes photos).',
  risk: 'read',
  taints: true,
  schema: obj({ path: str('chemin de l\'image, ou lien http(s) vers une image'), question: str('ce qu\'il faut regarder ou analyser (facultatif)') }, ['path']),
  async run(i, ctx) {
    let p = s(i.path).trim();
    // Lien vers une image : téléchargée dans inbox/ (8 Mo au plus, images seulement).
    if (/^https?:\/\//i.test(p)) {
      const r = await fetch(p, { signal: AbortSignal.timeout(30_000), redirect: 'follow' }).catch((e) => { throw new Error(`image injoignable : ${(e as Error).message}`); });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !/^image\//.test(type)) return `Ce lien ne donne pas une image (${r.status} ${type || 'type inconnu'}). Pour une vidéo ou une publication, utilise video_analyze.`;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > 20 * 1024 * 1024) return 'Image trop lourde (20 Mo au plus).';
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/bmp': 'bmp', 'image/tiff': 'tiff' } as Record<string, string>)[type.split(';')[0]] ?? 'jpg';
      const dir = join(ctx.workspace, 'inbox'); mkdirSync(dir, { recursive: true });
      p = join(dir, `image-${Date.now()}.${ext}`); writeFileSync(p, buf);
    } else p = toolPath(ctx, p);
    if (!ctx.vision) return 'Aucun modèle qui voit les images n\'est disponible pour l\'instant (ajoute Claude, GPT ou Kimi dans Réglages → Modèle).';
    let ext = extname(p).slice(1).toLowerCase(), mime = IMAGE_MIME[ext];
    // Format exotique ou photo trop lourde : convertie en JPEG 1600 px (FFmpeg).
    if (!mime || statSync(p).size > 4 * 1024 * 1024) {
      const out = join(ctx.workspace, '.odin-tmp', `vue-${Date.now()}.jpg`); mkdirSync(dirname(out), { recursive: true });
      const { convertMedia } = await import('../files/media.ts');
      try { await convertMedia(p, out, { width: 1600 }, undefined, 120_000); p = out; ext = 'jpg'; mime = 'image/jpeg'; } catch (e) { return `Je n'arrive pas à ouvrir cette image (${(e as Error).message.slice(0, 160)}).`; }
    }
    const answer = await ctx.vision(s(i.question) || 'Décris précisément cette image : ce qu\'on voit (personnes, lieu, objets, actions, ambiance), puis recopie exactement tout le texte lisible. N\'invente rien.', [{ mime, data: readFileSync(p).toString('base64') }]);
    return { output: wrapUntrusted(`image ${relative(ctx.workspace, p)}`, answer), tainted: true };
  },
};

export const mediaInfoTool: Tool = {
  name: 'media_info',
  description: 'Informations sur une vidéo, un audio ou une image : format, durée, résolution, pistes (ffprobe).',
  risk: 'read',
  schema: obj({ path: str('chemin du fichier') }, ['path']),
  async run(i, ctx) {
    const info = mediaInfo(toolPath(ctx, s(i.path)));
    const d = info.durationSec;
    return `${info.format} · ${d ? `${Math.floor(d / 60)} min ${Math.round(d % 60)} s · ` : ''}${info.sizeKo} Ko\n${info.streams.map((x) => `- ${x}`).join('\n')}`;
  },
};

export const mediaConvert: Tool = {
  name: 'media_convert',
  description: 'Convertit ou transforme une vidéo, un audio ou une image (ffmpeg) : changer de format (mp4, webm, mp3, wav, jpg, png, gif…), découper (start, duration), redimensionner (width), extraire le son (audio_only), couper le son (mute), miniature à un instant (frame_at).',
  risk: 'write',
  schema: obj({
    input: str('fichier source'), output: str('fichier à créer (l\'extension choisit le format)'),
    start: str('début, secondes ou HH:MM:SS'), duration: str('durée, secondes ou HH:MM:SS'), width: num('largeur en pixels'),
    audio_only: bool('garder seulement le son'), mute: bool('retirer le son'), frame_at: str('une image à cet instant'), quality: str('standard (défaut) ou haute'),
  }, ['input', 'output']),
  summarize: (i) => `convertir ${s(i.input)} → ${s(i.output)}`,
  async run(i, ctx) {
    const input = toolPath(ctx, s(i.input)), output = toolPath(ctx, s(i.output));
    if (!existsSync(input)) return `Fichier introuvable : ${s(i.input)}`;
    mkdirSync(dirname(output), { recursive: true });
    const o: ConvertOptions = {
      start: i.start ? s(i.start) : undefined, duration: i.duration ? s(i.duration) : undefined,
      width: i.width ? Number(i.width) : undefined, audioOnly: Boolean(i.audio_only), mute: Boolean(i.mute),
      frameAt: i.frame_at ? s(i.frame_at) : undefined, quality: s(i.quality) === 'haute' ? 'haute' : 'standard',
    };
    await convertMedia(input, output, o, ctx.signal);
    return `Créé : ${relative(ctx.workspace, output)} (${Math.round(statSync(output).size / 1024)} Ko).`;
  },
};

export const audioTranscribe: Tool = {
  name: 'audio_transcribe',
  description: 'Transcrit en texte un fichier audio ou vidéo (réunion, mémo vocal, interview) avec Whisper.',
  risk: 'network',
  taints: true,
  schema: obj({ path: str('fichier audio ou vidéo') }, ['path']),
  async run(i, ctx) {
    if (!ctx.voice || !sttReady(ctx.voice)) return 'Whisper n\'est pas configuré (Réglages → Voix).';
    let p = toolPath(ctx, s(i.path));
    const ext = extname(p).toLowerCase();
    // Vidéo ou fichier lourd : on extrait un son compact (mono 16 kHz) pour rester sous 25 Mo.
    if (!['.mp3', '.m4a', '.ogg', '.oga', '.wav', '.webm'].includes(ext) || statSync(p).size > 24 * 1024 * 1024) {
      const tmp = toolPath(ctx, `.odin-tmp/transcription-${Date.now()}.mp3`);
      mkdirSync(dirname(tmp), { recursive: true });
      await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', tmp], ctx.signal);
      p = tmp;
    }
    const mime = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm' }[extname(p).toLowerCase()] ?? 'audio/mpeg';
    let text: string;
    try { text = await transcribe(new Uint8Array(readFileSync(p)), mime, ctx.voice, ctx.signal); }
    finally { if (p.includes('.odin-tmp')) rmSync(p, { force: true }); }
    return { output: wrapUntrusted(`transcription de ${s(i.path)}`, clip(text || '(rien entendu)')), tainted: true };
  },
};

function runFfmpeg(args: string[], signal: AbortSignal): Promise<void> {
  if (!hasCommand('ffmpeg')) return Promise.reject(new Error('ffmpeg est nécessaire pour cette conversion (voir media_convert).'));
  return new Promise((res, rej) => {
    const pr = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], signal, windowsHide: true });
    let e = ''; pr.stderr.on('data', (d) => { e = (e + d).slice(-1500); });
    pr.on('error', rej); pr.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg : ${e.trim() || c}`))));
  });
}

export const codexRun: Tool = {
  name: 'codex_run',
  description: 'Confie une tâche de programmation à Codex, l\'agent de code d\'OpenAI (écrire, corriger, refactoriser, tester du code dans un dossier). Renvoie son compte rendu. Nécessite le programme « codex » et un compte OpenAI.',
  risk: 'exec',
  schema: obj({ task: str('la tâche de code, précise et autonome'), dir: str('dossier du projet dans l\'espace de travail (racine par défaut)') }, ['task']),
  summarize: (i) => `Codex : « ${s(i.task).slice(0, 120)} » dans ${s(i.dir) || '.'}`,
  command: (i) => `codex exec ${s(i.task)}`,
  async run(i, ctx) {
    if (!hasCommand('codex')) return 'Codex n\'est pas installé : « npm install -g @openai/codex », puis « codex login » (ou une clé OPENAI_API_KEY).';
    const dir = toolPath(ctx, s(i.dir) || '.');
    mkdirSync(dir, { recursive: true });
    // Pas de secrets d'Odin pour un agent tiers : seule la clé OpenAI (ou la session « codex login ») lui sert.
    const env = { ...safeEnv(), ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}) };
    return new Promise((resolve) => {
      // Mode non interactif, bac à sable « écriture dans le dossier » de Codex.
      const p = spawn('codex', ['exec', '--full-auto', '--skip-git-repo-check', '-C', dir, s(i.task)], { env, signal: ctx.signal, windowsHide: true, timeout: 30 * 60_000 });
      let out = '', err = '';
      p.stdout.on('data', (d) => { out = (out + d).slice(-60_000); });
      p.stderr.on('data', (d) => { err = (err + d).slice(-8_000); });
      p.on('error', (e) => resolve(`Codex n'a pas pu démarrer : ${e.message}`));
      p.on('close', (code) => resolve(ctx.redactor.redact(clip(`Codex (code ${code}) :\n${out.trim() || err.trim() || '(aucune sortie)'}`, 30_000))));
    });
  },
};

export const FILE_TOOLS: Tool[] = [docRead, docCreate, imageView, mediaInfoTool, mediaConvert, audioTranscribe, codexRun];
