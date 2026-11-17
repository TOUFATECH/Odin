// Médias reçus : la fabrique des briques. Elle regarde ce qui existe RÉELLEMENT sur la machine (reconnaisseur de
// langue, Whisper local, oreille d'Odin, œil de Théia, Tesseract, FFmpeg, lecteurs de documents, détecteur de consignes)
// et fabrique les fonctions que « comprendre » recevra. Ne lève jamais ; ne télécharge rien ; n'installe rien ; n'appelle
// aucun réseau ; n'écrit que dans dossierTemp (fichiers temporaires supprimés après usage). Chaque brique absente est
// dite dans `absentes`, avec la raison et le moyen de l'obtenir. Les modules d'Odin sont chargés par import tardif,
// chacun dans son propre essai : si l'un manque, seules ses briques manquent.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import type { Briques, ImageAEnvoyer, Manque, Nature, Segment } from './contrat.ts';
import { BriqueIndisponible, COMMENT } from './contrat.ts';
import { ecritureDominante } from './ecritures.ts';
import { versBcp47, versIso3 } from './langues-codes.ts';
import { creerBudget, sourceOctets } from './octets.ts';
import { lireTexte } from './texte.ts';
import { avecDelai } from './sous-titres.ts';

export interface OptionsFabrique {
  /** ~/.odin réel en service, dossier jetable en essai. */
  home: string;
  /** OdinConfig['voice'] (passé tel quel à l'écouteur local). */
  voice?: unknown;
  dossierTemp: string;
  /** Donnée par l'appelant, jamais fabriquée ici. */
  traduire?: Briques['traduire'];
  /** Défaut vrai. */
  tesseract?: boolean;
  /** Ex. ['fr'] : seulement pour ORDONNER les langues de Tesseract. */
  languesPreferees?: string[];
}

/** Lance un programme (tableau d'arguments, jamais de shell), borné en temps et en sortie. */
function lancer(cmd: string, args: string[], o: { timeoutMs: number; signal?: AbortSignal; maxSortie?: number }): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    const max = o.maxSortie ?? 16 * 1024 * 1024;
    const morceaux: Buffer[] = [];
    let taille = 0, err = '', fini = false;
    const tuer = () => { try { p.kill('SIGKILL'); } catch { /* déjà fini */ } };
    const t = setTimeout(tuer, o.timeoutMs);
    const arret = () => tuer();
    o.signal?.addEventListener('abort', arret, { once: true });
    p.stdout.on('data', (b: Buffer) => { if (taille < max) { morceaux.push(b.subarray(0, max - taille)); taille += b.length; } if (taille >= max) tuer(); });
    p.stderr.on('data', (b: Buffer) => { if (err.length < 64 * 1024) err += b.toString('utf8'); });
    const finir = (code: number) => { if (fini) return; fini = true; clearTimeout(t); o.signal?.removeEventListener('abort', arret); resolve({ code, out: Buffer.concat(morceaux), err }); };
    p.on('error', (e) => { if (fini) return; fini = true; clearTimeout(t); o.signal?.removeEventListener('abort', arret); reject(e); });
    p.on('close', (code) => finir(code ?? -1));
  });
}

/** Un PNG fabriqué à partir d'un bitmap brut (gris ou RVB), pour les pages scannées d'un PDF. */
function pngDepuisBitmap(data: Buffer, largeur: number, hauteur: number, composantes: number): Buffer | undefined {
  if (!(largeur > 0 && hauteur > 0 && (composantes === 1 || composantes === 3)) || largeur * hauteur > 64 * 1024 * 1024) return undefined;
  const ligne = largeur * composantes;
  if (data.length < ligne * hauteur) return undefined;
  const brut = Buffer.alloc((ligne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) data.copy(brut, y * (ligne + 1) + 1, y * ligne, (y + 1) * ligne);
  const morceau = (type: string, d: Buffer) => { const t = Buffer.from(type, 'latin1'); const h = Buffer.alloc(4); h.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0); return Buffer.concat([h, t, d, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = composantes === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), morceau('IHDR', ihdr), morceau('IDAT', deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

/**
 * Options d'ENTRÉE de FFmpeg pour un fichier reçu (hostile) : seulement le protocole « file », et seulement des lecteurs
 * de conteneurs vidéo ou d'images. Sans elles, un faux « .mp4 » qui commence par « ffconcat version 1.0 » fait lire
 * n'importe quel fichier local (vérifié avec FFmpeg 9.0.2 : le fichier cité ressort en sous-titres).
 */
export const FFMPEG_ENTREE_VIDEO = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mpegts,avi,ogg,asf,flv'];
export const FFMPEG_ENTREE_IMAGE = ['-protocol_whitelist', 'file', '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe,tiff_pipe,bmp_pipe,gif,gif_pipe,jpegxl_pipe,qoi_pipe,psd_pipe,mov,mp4,m4a,3gp,3g2,mj2'];

const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', tiff: 'tif', heic: 'heic', heif: 'heif', avif: 'avif' };
/** Codes Tesseract d'une langue BCP 47 (« zh » a deux paquets). */
function codesTesseract(code: string): string[] {
  const b = (versBcp47(code) ?? code).split('-')[0];
  if (b === 'zh') return ['chi_sim', 'chi_tra'];
  if (b === 'az') return ['aze', 'aze_cyrl'];
  if (b === 'sr') return ['srp', 'srp_latn'];
  if (b === 'uz') return ['uzb', 'uzb_cyrl'];
  return [versIso3(b)];
}

/** Fabrique les briques d'après ce qui existe sur la machine. Ne lève jamais. */
export async function briquesDisponibles(o: OptionsFabrique): Promise<Briques> {
  const absentes: Manque[] = [];
  const b: Briques = { absentes };
  const temp = (): string => { mkdirSync(o.dossierTemp, { recursive: true }); return mkdtempSync(join(o.dossierTemp, 'brique-')); };

  // Les programmes : cherchés UNE fois.
  let hasCommand: (c: string) => boolean = () => false;
  try { hasCommand = (await import('../learn/environment.ts')).hasCommand; } catch { /* sans détecteur : aucun programme */ }
  const essai = (c: string) => { try { return hasCommand(c); } catch { return false; } };
  const ffmpeg = essai('ffmpeg');
  const tesseract = o.tesseract !== false && essai('tesseract');
  if (!ffmpeg) absentes.push({ quoi: 'le son et les images d\'une vidéo, la conversion d\'image', raison: 'FFmpeg n\'est pas installé', commentObtenir: COMMENT.ffmpeg, code: 'ffmpeg' });

  // Langue.
  try {
    const l = await import('../langue/reconnaitre.ts');
    b.reconnaitreLangue = (texte: string) => {
      const r = l.reconnaitre(texte);
      return { ...(r.langue ? { langue: r.langue } : {}), confiance: r.confiance, ecriture: ecritureDominante(texte), ...(r.hypothese ? { hypothese: r.hypothese } : {}) };
    };
  } catch { absentes.push({ quoi: 'la langue des textes', raison: 'reconnaisseur de langue non chargé', commentObtenir: COMMENT.langue, code: 'langue' }); }

  // Transcription locale (Whisper) : seulement si elle est déjà installée.
  try {
    const v = await import('../voice/local.ts');
    const w = v.localWhisper(o.home);
    if (w && ffmpeg) {
      b.transcrire = async (fichierAudio, x) => {
        const duree = x.dureeSec && Number.isFinite(x.dureeSec) ? x.dureeSec : 3600;
        const delai = Math.min(3 * 3600_000, (duree * 2 + 120) * 1000);
        const h = await avecDelai(v.hearLocal({ file: fichierAudio }, 'auto', o.home, delai), delai + 5000, x.signal, 'transcription');
        const segments: Segment[] = (h.segments ?? []).map((s) => ({ debut: s.start, fin: s.end, texte: s.text }));
        // La langue rendue par la transcription n'est pas sûre : sans ligne de détection, l'ancien code rend « fr »
        // par défaut (voir src/voice/local.ts l.108, recette 9.8). Quand ce défaut sera corrigé, langueSure deviendra
        // vraie si la langue rendue n'est pas vide.
        return { texte: h.text ?? '', ...(h.language ? { langue: h.language } : {}), langueSure: false, segments, via: `Whisper local (${basename(w.model)})` };
      };
    } else absentes.push({ quoi: 'la parole', raison: w ? 'FFmpeg manque pour préparer le son de la transcription locale' : 'transcription locale non installée', commentObtenir: w ? COMMENT.ffmpeg : COMMENT.transcription, code: 'transcription' });
  } catch { absentes.push({ quoi: 'la parole', raison: 'transcription locale non chargée', commentObtenir: COMMENT.transcription, code: 'transcription' }); }

  // L'oreille (musique, sons, parole par l'écouteur local).
  try {
    const s = await import('../valhalla/syrinx/bande-son.ts');
    const base = await import('../valhalla/syrinx/base.ts');
    const or = await s.oreille();
    if (or) {
      const dossierSons = base.dirPoidsSons(o.home);
      let modelePresent = false;
      try { modelePresent = or.etatModeleSons(dossierSons).present; } catch { /* état inconnu */ }
      if (!modelePresent) absentes.push({ quoi: 'les sons reconnus (hors parole et musique)', raison: 'modèle de sons non téléchargé', commentObtenir: COMMENT.modeleSons, code: 'modele-sons' });
      b.analyserSon = async (fichier, x) => {
        const ecouter = x.avecParole ? await s.ecouteurLocal(o.voice as Parameters<typeof s.ecouteurLocal>[0]) : null;
        const modele = modelePresent ? (await s.modeleSonsLocal(dossierSons)) ?? null : null;
        const r = await or.analyserSon({ fichier }, { ecouter, modele, demander: null, dossierTemp: o.dossierTemp, signal: x.signal });
        return r.analyse;
      };
    } else absentes.push({ quoi: 'l\'écoute du son', raison: 'l\'oreille d\'Odin n\'a pas pu être chargée', commentObtenir: COMMENT.oreille, code: 'oreille' });
  } catch { absentes.push({ quoi: 'l\'écoute du son', raison: 'l\'oreille d\'Odin n\'a pas pu être chargée', commentObtenir: COMMENT.oreille, code: 'oreille' }); }

  // Conversion d'image (FFmpeg) : vers JPEG, 2048 px de large au plus. Entrée bornée à des fichiers locaux et à des
  // lecteurs d'images (FFMPEG_ENTREE_IMAGE) : un faux fichier qui serait une liste « concat » ou HLS ne fait jamais lire
  // d'autres fichiers de la machine.
  if (ffmpeg) b.convertirImage = async (img, x) => {
    const d = temp();
    try {
      const entree = join(d, `entree.${EXT[img.format] ?? 'img'}`), sortie = join(d, 'sortie.jpg');
      writeFileSync(entree, img.octets);
      const r = await lancer('ffmpeg', ['-v', 'error', '-y', ...FFMPEG_ENTREE_IMAGE, '-i', entree, '-frames:v', '1', '-vf', 'scale=\'min(2048,iw)\':-2', sortie], { timeoutMs: 60_000, signal: x.signal });
      if (r.code !== 0) throw new Error(`conversion impossible : ${r.err.trim().split('\n').pop()?.slice(0, 120) ?? ''}`);
      return { octets: readFileSync(sortie), format: 'jpeg' };
    } finally { rmSync(d, { recursive: true, force: true }); }
  };

  // Lecture du texte d'une image : œil de Théia (si son poids de lecture répond), sinon Tesseract.
  let theia = false;
  try {
    const t = await import('../valhalla/theia/index.ts');
    const oeil = await t.ouvrirOeilLocal(o.home);
    const vi = await import('../vision/image.ts');
    if (oeil) {
      let lit = false;
      try { lit = (await oeil.lireTexte({ largeur: 8, hauteur: 8, rgba: new Uint8Array(8 * 8 * 4).fill(255) })).lue === true; } catch { lit = false; }
      const decoder = async (img: ImageAEnvoyer, signal?: AbortSignal) => {
        let x = img;
        if (!(x.format === 'jpeg' || x.format === 'png') && b.convertirImage) x = await b.convertirImage(x, { signal });
        return vi.decoderImage(x.octets, x.format);
      };
      if (lit) {
        theia = true;
        b.lireTexteImage = async (img, x) => {
          const r = await oeil.lireTexte(await decoder(img, x.signal), undefined, x.signal);
          if (!r.lue) throw new BriqueIndisponible({ quoi: 'le texte de l\'image', raison: 'la lecture de Théia n\'a pas pu lire cette image', code: 'ocr' });
          return { texte: r.texte, confiance: r.confiance, via: `Théia (${oeil.modele || 'lecture de texte'})`, lignes: r.lignes.map((l) => ({ texte: l.texte, boite: [...l.boite] })) };
        };
      }
      if (oeil.aVLM) {
        b.decrireImage = async (img, x) => {
          const r = await oeil.decrire(await decoder(img, x.signal), x.question ?? 'Décris précisément l\'image. N\'invente rien.', x.signal);
          if (r.essaye === false) throw new BriqueIndisponible({ quoi: 'la description de l\'image', raison: 'aucun modèle de vision local n\'a répondu', commentObtenir: COMMENT.vision, code: 'vision' });
          return { texte: r.texte, confiance: r.confiance, via: `Théia (${r.modele || 'vision locale'})` };
        };
      }
    }
  } catch { /* Théia absente : Tesseract seul, s'il existe */ }
  if (!b.decrireImage) absentes.push({ quoi: 'la description de l\'image', raison: 'aucun modèle de vision local', commentObtenir: COMMENT.vision, code: 'vision' });
  if (!theia && tesseract) {
    // Les langues installées, ordonnées : préférées, anglais, autres ; 6 au plus.
    let installees: string[] = [];
    try {
      const r = await lancer('tesseract', ['--list-langs'], { timeoutMs: 10_000, maxSortie: 256 * 1024 });
      installees = `${r.out.toString('utf8')}\n${r.err}`.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes(' ') && !l.includes(':') && l !== 'osd' && l !== 'equ');
    } catch { installees = []; }
    const pref = (o.languesPreferees ?? []).flatMap(codesTesseract);
    const ordre = [...new Set([...pref, 'eng', ...installees])].filter((l) => installees.includes(l));
    const six = ordre.slice(0, 6);
    const passe = async (img: ImageAEnvoyer, langues: string, signal?: AbortSignal) => {
      const d = temp();
      try {
        let x = img;
        if (!EXT[x.format] || x.format === 'heic' || x.format === 'heif' || x.format === 'avif') { if (b.convertirImage) x = await b.convertirImage(x, { signal }); }
        const f = join(d, `page.${EXT[x.format] ?? 'png'}`);
        writeFileSync(f, x.octets);
        const r = await lancer('tesseract', [f, 'stdout', ...(langues ? ['-l', langues] : []), '--psm', '3', 'tsv'], { timeoutMs: 60_000, signal, maxSortie: 8 * 1024 * 1024 });
        if (r.code !== 0) throw new Error(`Tesseract : ${r.err.trim().split('\n').pop()?.slice(0, 120) ?? 'échec'}`);
        // TSV : niveau page bloc paragraphe ligne mot gauche haut largeur hauteur confiance texte.
        const lignes = new Map<string, string[]>();
        let somme = 0, n = 0;
        for (const l of r.out.toString('utf8').split('\n').slice(1)) {
          const c = l.split('\t');
          if (c.length < 12 || c[0] !== '5') continue;
          const mot = c.slice(11).join('\t').trim();
          const conf = Number(c[10]);
          if (!mot) continue;
          const cle = `${c[2]}.${c[3]}.${c[4]}`;
          (lignes.get(cle) ?? lignes.set(cle, []).get(cle)!).push(mot);
          if (Number.isFinite(conf) && conf >= 0) { somme += conf; n++; }
        }
        const texte = [...lignes.values()].map((m) => m.join(' ')).join('\n');
        return { texte, confiance: n ? somme / n / 100 : 0, via: `Tesseract (${langues || 'langue par défaut'})`, lignes: [...lignes.values()].map((m) => ({ texte: m.join(' ') })) };
      } finally { rmSync(d, { recursive: true, force: true }); }
    };
    b.lireTexteImage = async (img, x) => {
      const indices = (x.languesIndice ?? []).flatMap(codesTesseract).filter((l) => installees.includes(l));
      const premiere = await passe(img, [...new Set([...indices, ...six])].slice(0, 6).join('+'), x.signal);
      // Deuxième passe avec la langue reconnue, si son paquet est installé et n'était pas dans les six.
      const rl = b.reconnaitreLangue && premiere.texte ? b.reconnaitreLangue(premiere.texte) : undefined;
      if (rl?.langue) {
        const cand = codesTesseract(rl.langue).filter((l) => installees.includes(l) && !six.includes(l));
        if (cand.length) {
          try { const deux = await passe(img, cand[0], x.signal); if (deux.confiance > premiere.confiance) return deux; } catch { /* on garde la première */ }
        }
      }
      return premiere;
    };
  }
  if (!b.lireTexteImage) absentes.push({ quoi: 'le texte des images', raison: o.tesseract === false ? 'Tesseract désactivé et aucun poids de lecture de Théia' : 'aucun poids de lecture de Théia et Tesseract n\'est pas installé', commentObtenir: COMMENT.ocr, code: 'ocr' });

  // Documents (toujours : lecteurs natifs d'Odin).
  b.lireDocument = async (octets: Buffer, nature: Nature) => {
    const fmt = nature.format;
    if (fmt === 'pdf') {
      const p = await import('../files/pdf.ts');
      const r = p.readPdf(octets);
      return { texte: r.text, via: `PDF (${r.via})`, pages: r.pages, scanne: !r.text.trim() && r.pages > 0 };
    }
    if (fmt === 'docx' || fmt === 'xlsx' || fmt === 'pptx') {
      const off = await import('../files/office.ts');
      if (fmt === 'docx') return { texte: off.readDocx(octets), via: 'Word (lecteur intégré)' };
      if (fmt === 'pptx') return { texte: off.readPptx(octets), via: 'PowerPoint (lecteur intégré)' };
      const feuilles = off.readXlsx(octets);
      return { texte: feuilles.map((f) => `# ${f.name}\n${off.toCsv(f.rows)}`).join('\n\n'), via: 'Excel (lecteur intégré)' };
    }
    if (['odt', 'ods', 'odp', 'rtf', 'html'].includes(fmt)) {
      const d = await import('../valhalla/theia/documents.ts');
      const r = d.lireDocument(octets, fmt);
      return { texte: r.texte, via: `Théia (${r.via})`, partiel: !!r.partiel };
    }
    if (fmt === 'epub') {
      const z = await import('./zip.ts');
      const d = await import('../valhalla/theia/documents.ts');
      const src = sourceOctets(octets, creerBudget());
      const entrees = z.listerZip(src).entrees.filter((e) => /\.x?html?$/i.test(e.nom.slice(-6))).sort((a, c) => (a.nom < c.nom ? -1 : 1)).slice(0, 400);
      const morceaux: string[] = [];
      let total = 0;
      for (const e of entrees) {
        try { const t = d.lireHtml(z.lireEntreeZip(src, e, 4 * 1024 * 1024)).texte; if (t.trim()) { morceaux.push(t); total += t.length; } } catch { /* chapitre illisible */ }
        if (total > 2 * 1024 * 1024) break;
      }
      return { texte: morceaux.join('\n\n'), via: 'EPUB (chapitres HTML)', partiel: total > 2 * 1024 * 1024 };
    }
    if (nature.famille === 'texte' || nature.famille === 'sous-titres') {
      const t = lireTexte(sourceOctets(octets, creerBudget()), nature);
      return { texte: t.texte, via: `texte (${t.encodage?.nom ?? '?'})`, partiel: !!t.partiel };
    }
    throw new BriqueIndisponible({ quoi: 'le texte du document', raison: fmt === 'ole' ? 'anciens fichiers Office : texte non lu' : `format ${fmt} : texte non lu`, code: 'document' });
  };
  b.pagesEnImages = async (octetsPdf: Buffer, max: number) => {
    const d = await import('../valhalla/theia/documents.ts');
    const r: ImageAEnvoyer[] = [];
    for (const im of d.imagesPagesPdf(octetsPdf, max)) {
      if (im.genre === 'jpeg') r.push({ octets: im.data, format: 'jpeg' });
      else if (im.largeur && im.hauteur) { const png = pngDepuisBitmap(im.data, im.largeur, im.hauteur, im.composantes ?? 3); if (png) r.push({ octets: png, format: 'png' }); }
      if (r.length >= max) break;
    }
    return r;
  };

  // Vidéo (FFmpeg) : son, images clés, sous-titres inclus.
  if (ffmpeg) {
    try {
      const v = await import('../video/video.ts');
      b.extraireSon = (video, dossier, x) => v.extractAudio(video, dossier, x.signal);
      b.imagesCles = async (video, dossier, dureeSec, max, x) => (await v.keyFrames(video, dossier, dureeSec, max, x.signal)).map((f) => ({ t: f.t, fichier: f.file }));
    } catch { absentes.push({ quoi: 'le son et les images d\'une vidéo', raison: 'le module vidéo d\'Odin n\'a pas pu être chargé', code: 'ffmpeg' }); }
    b.extraireSousTitresInclus = async (video, index, x) => {
      if (!Number.isInteger(index) || index < 0 || index > 1000) return undefined;
      // Rang parmi les pistes de sous-titres (« 0:s:N ») quand il est donné : le numéro de piste du socle n'est pas
      // forcément celui de FFmpeg (police jointe d'un MKV, piste « tmcd » d'un MP4).
      const rang = x.rangSousTitres;
      const carte = Number.isInteger(rang) && rang! >= 0 && rang! <= 1000 ? `0:s:${rang}` : `0:${index}`;
      const r = await lancer('ffmpeg', ['-v', 'error', ...FFMPEG_ENTREE_VIDEO, '-i', video, '-map', carte, '-f', 'srt', '-'], { timeoutMs: 120_000, signal: x.signal, maxSortie: 2 * 1024 * 1024 });
      if (r.code !== 0 && !r.out.length) throw new Error(`sous-titres non extraits : ${r.err.trim().split('\n').pop()?.slice(0, 120) ?? ''}`);
      return r.out.toString('utf8');
    };
  }

  if (o.traduire) b.traduire = o.traduire;
  else absentes.push({ quoi: 'la traduction', raison: 'aucune fonction de traduction donnée', commentObtenir: COMMENT.traduction, code: 'traduction' });

  try {
    const h = await import('../heimdall/injection.ts');
    b.detecterConsignes = (texte: string) => { const r = h.scanForInjection(texte); return { suspect: r.suspicious, motifs: r.matches }; };
  } catch { /* sans détecteur : rien n'est affirmé */ }
  return b;
}
