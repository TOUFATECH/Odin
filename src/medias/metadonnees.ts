// Médias reçus : l'entrée publique des métadonnées. `lireMetadonnees` reconnaît le fichier, appelle le bon lecteur,
// règle doublons et priorités, et ne lève JAMAIS : un fichier piégé rend « illisible : raison » ou une fiche partielle.
// `ficheEnLignes` / `ficheEnTexte` mettent la fiche en mots (données sensibles masquées par défaut).
// `extraireImageJointe` rend les octets d'une pochette ou d'une vignette, format vérifié par les octets.

import type { Champ, Contexte, Fiche, ImageJointe, Nature } from './contrat.ts';
import { ArretBudget, BORNES, ErreurFormat, ORDRE_GROUPES, type Bornes } from './contrat.ts';
import { ajouterChamp, ajouterManque, finaliserChamps, formatImage, texteDate } from './champs.ts';
import { lireMetaDocument } from './documents.ts';
import { lireMkv } from './ebml.ts';
import { desynchroniser } from './id3.ts';
import { lireBmp, lireGif, lireHeif, lireIco, lireJpeg, lireJxl, lirePng, lireTiffFichier, lireWebp } from './images.ts';
import { nomLangue } from './langues-codes.ts';
import { lireMp4 } from './mp4.ts';
import { creerBudget, decimal, enOctets, pourAffichage, sourceFichier, sourceOctets, type Source } from './octets.ts';
import { creerNature, reconnaitreNature } from './reconnaitre.ts';
import { lireAvi, lireWav } from './riff.ts';
import { lireAdts, lireAiff, lireFlac, lireMidi, lireMp3, lireOgg, lireSonNonLu } from './sons.ts';
import { listerZip } from './zip.ts';

export type EntreeMedia = { chemin: string } | { octets: Uint8Array; nom?: string };
export interface OptionsMeta { bornes?: Partial<Bornes>; maintenant?: () => number; avecImages?: boolean }

function ficheVide(nature: Nature, nom?: string, taille = 0): Fiche {
  return { nature, nomFichier: nom, tailleOctets: taille, champs: [], dates: [], autresPositions: [], pistes: [], chapitres: [], images: [], languesDeclarees: [], textesInclus: [], remarques: [], manque: [], exterieur: true, tempsMs: 0 };
}
const nomDe = (e: EntreeMedia) => ('chemin' in e ? e.chemin.split('\\').join('/').split('/').pop() : e.nom);

const PHOTOS = new Set(['jpeg', 'heic', 'heif', 'avif', 'webp', 'tiff', 'dng', 'cr2', 'nef', 'arw', 'orf', 'rw2']);

/** Lit la fiche et, si demandé, garde les octets des images jointes. */
function lire(e: EntreeMedia, o: OptionsMeta): { fiche: Fiche; captures: Map<number, Buffer> } {
  const t0 = performance.now();
  const budget = creerBudget({ bornes: o.bornes, maintenant: o.maintenant });
  const nom = nomDe(e);
  const f = ficheVide(creerNature('inconnu', { nom }), nom);
  const ctx: Contexte = { budget, maintenant: Date.now(), avecImages: !!o.avecImages, travail: { rangs: new Map(), positions: [], datesPrise: [], droitsBruts: [], libres: 0, captures: new Map() } };
  let src: Source;
  try { src = 'chemin' in e ? sourceFichier(e.chemin, budget) : sourceOctets(e.octets, budget, e.nom); }
  catch (x) {
    const code = (x as { code?: string }).code;
    f.illisible = code === 'ENOENT' ? 'fichier introuvable' : code === 'EISDIR' ? 'c\'est un dossier' : `fichier illisible sur le disque (${code ?? (x as Error).name})`;
    f.tempsMs = Math.round(performance.now() - t0);
    return { fiche: f, captures: ctx.travail.captures };
  }
  f.tailleOctets = src.taille;
  const utile = () => f.champs.length > 0 || f.pistes.length > 0 || !!f.largeur || f.dureeSec !== undefined || f.dates.length > 0 || ctx.travail.positions.length > 0 || ctx.travail.datesPrise.length > 0;
  try {
    if (src.taille === 0) throw new ErreurFormat('fichier vide');
    f.nature = reconnaitreNature(src, nom);
    aiguiller(src, f, ctx);
  } catch (x) {
    if (x instanceof ArretBudget) f.partiel = `budget atteint : ${x.raison}`;
    else {
      const raison = x instanceof ErreurFormat ? x.raison : `structure invalide (${(x as Error)?.name ?? 'erreur'})`;
      if (utile()) f.partiel ??= raison; else f.illisible = raison;
    }
  } finally { src.fermer(); }
  try { finir(f, ctx); } catch (x) { if (!f.partiel && !f.illisible) f.partiel = `structure invalide (${(x as Error)?.name ?? 'erreur'})`; }
  if (!f.illisible && f.partiel && !f.partiel.startsWith('budget atteint') && !utile()) { f.illisible = f.partiel; delete f.partiel; }
  if (f.illisible) delete f.partiel;
  f.tempsMs = Math.round(performance.now() - t0);
  return { fiche: f, captures: ctx.travail.captures };
}

/** Ne lève JAMAIS. Fichier absent ou illisible sur le disque → fiche avec illisible. */
export function lireMetadonnees(e: EntreeMedia, o: OptionsMeta = {}): Fiche {
  try { return lire(e, o).fiche; }
  catch (x) {
    const f = ficheVide(creerNature('inconnu'), nomDe(e));
    f.illisible = `structure invalide (${(x as Error)?.name ?? 'erreur'})`;
    return f;
  }
}

function aiguiller(src: Source, f: Fiche, ctx: Contexte): void {
  const fmt = f.nature.format;
  switch (fmt) {
    case 'jpeg': return lireJpeg(src, f, ctx);
    case 'png': case 'apng': return lirePng(src, f, ctx);
    case 'gif': return lireGif(src, f, ctx);
    case 'webp': return lireWebp(src, f, ctx);
    case 'heic': case 'heif': case 'avif': return lireHeif(src, f, ctx);
    case 'tiff': case 'bigtiff': case 'cr2': case 'orf': case 'rw2': case 'dng': case 'nef': case 'arw': return lireTiffFichier(src, f, ctx);
    case 'bmp': return lireBmp(src, f, ctx);
    case 'ico': return lireIco(src, f, ctx);
    case 'jxl': return lireJxl(f);
    case 'cr3': ajouterManque(f, { quoi: 'les métadonnées du CR3', raison: 'format non lu', code: 'format-non-lu' }); return;
    case 'mp3': return lireMp3(src, f, ctx);
    case 'aac': return lireAdts(src, f, ctx);
    case 'flac': return lireFlac(src, f, ctx);
    case 'ogg-vorbis': case 'ogg-opus': case 'ogg-flac': case 'ogg-speex': case 'ogg-theora': return lireOgg(src, f, ctx);
    case 'wav': case 'wav64': return lireWav(src, f, ctx);
    case 'aiff': return lireAiff(src, f, ctx);
    case 'm4a': case 'm4b': case 'mp4': case 'mov': case '3gp': return lireMp4(src, f, ctx);
    case 'mkv': case 'webm': return lireMkv(src, f, ctx);
    case 'avi': return lireAvi(src, f, ctx);
    case 'midi': return lireMidi(src, f, ctx);
    case 'amr': case 'ape': case 'wavpack': return lireSonNonLu(src, f, ctx);
    case 'asf': case 'flv': case 'mpeg-ts': case 'mpeg-ps':
      ajouterManque(f, { quoi: 'les métadonnées', raison: 'métadonnées : format non lu (FFprobe peut compléter)', code: 'format-non-lu' }); return;
    default: break;
  }
  const fam = f.nature.famille;
  if (fam === 'archive' && fmt === 'zip') {
    const z = listerZip(src);
    ajouterChamp(f, ctx, 'x:contenu', `${z.entrees.length} fichier(s)${z.entrees.some((x) => x.chiffree) ? ', dont chiffrés' : ''}`, 'ZIP', { nom: 'Contenu', groupe: 'fichier' });
    if (z.partiel) f.partiel = z.partiel;
    return;
  }
  if (fam === 'texte' || fam === 'sous-titres') {
    const en = f.nature.encodage;
    if (en) ajouterChamp(f, ctx, 'x:encodage', `${en.nom}${en.bom ? ' avec BOM' : ''}${en.sur ? '' : ' (incertain)'}`, 'texte', { nom: 'Encodage', groupe: 'technique', fiabilite: en.sur ? 'sure' : 'douteuse' });
    return;
  }
  if (fam === 'document') { lireMetaDocument(src, f.nature, f, ctx); return; }
  if (fam === 'inconnu') { ajouterManque(f, { quoi: 'la nature du fichier', raison: 'format inconnu', code: 'format-non-lu' }); throw new ErreurFormat('format inconnu'); }
}

function finir(f: Fiche, ctx: Contexte): void {
  finaliserChamps(f, ctx);
  // Image : largeur et hauteur affichées (orientations 5 à 8 : échangées).
  if (f.nature.famille === 'image' && f.orientation && f.orientation.code >= 5 && f.orientation.code <= 8 && f.largeur && f.hauteur) [f.largeur, f.hauteur] = [f.hauteur, f.largeur];
  if (f.largeur && f.hauteur) ajouterChamp(f, ctx, 'dimensions', `${f.largeur} × ${f.hauteur} px`, 'calcul', { brut: `${f.largeur}x${f.hauteur}` });
  // Langues des pistes.
  for (const p of f.pistes) if (p.langueDeclaree && !f.languesDeclarees.some((l) => l.code === p.langueDeclaree)) f.languesDeclarees.push({ code: p.langueDeclaree, source: `piste ${p.index + 1}` });
  // Photos : ce qui manque.
  if (PHOTOS.has(f.nature.format) && !f.illisible) {
    const appareil = f.champs.some((c) => c.cle === 'appareil_marque' || c.cle === 'appareil_modele');
    const prise = f.champs.some((c) => c.cle === 'date_prise_de_vue');
    if (!appareil && !prise && !f.position) ajouterManque(f, { quoi: 'l\'appareil, la date et le lieu', raison: 'absent du fichier (les messageries le retirent souvent)', code: 'retire-probable' });
    else {
      if (!prise) ajouterManque(f, { quoi: 'la date de prise de vue', raison: 'absent du fichier', code: 'absent' });
      if (!f.position && !f.manque.some((m) => m.quoi.startsWith('la position'))) ajouterManque(f, { quoi: 'le lieu', raison: 'absent du fichier', code: 'absent' });
      if (!f.champs.some((c) => c.groupe === 'réglages')) ajouterManque(f, { quoi: 'Réglages de prise de vue', raison: 'absent du fichier', code: 'absent' });
    }
  }
}

// ─────────────────────────────── Mise en mots ───────────────────────────────

const NOMS_GROUPES: Record<string, string> = {
  fichier: 'Fichier', 'œuvre': 'Œuvre', personnes: 'Personnes', 'droits et diffusion': 'Droits et diffusion', 'prise de vue': 'Prise de vue', lieu: 'Lieu',
  appareil: 'Appareil', 'réglages': 'Réglages', technique: 'Technique', pistes: 'Étiquettes des pistes', chapitres: 'Chapitres', 'texte inclus': 'Textes inclus', document: 'Document', logiciel: 'Logiciel',
};
const COURT = new Set(['œuvre', 'personnes', 'droits et diffusion', 'prise de vue', 'lieu', 'appareil']);

/** « 3 min 25 s », « 1 h 02 min ». */
export function dureeEnClair(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '?';
  if (s < 60) return `${decimal(s, s < 10 ? 1 : 0)} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round(s % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${r} s`;
}
const hms = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(r).padStart(2, '0')}`; };

interface Ligne { groupe: string; texte: string; source?: string }

function lignesDe(f: Fiche, masquer: boolean): Ligne[] {
  const r: Ligne[] = [];
  const marque = f.champs.find((c) => c.cle === 'appareil_marque'), modele = f.champs.find((c) => c.cle === 'appareil_modele');
  const valeurChamp = (c: Champ): string => {
    if (c.sensible && masquer) {
      if (c.cle.startsWith('date_')) { const d = f.dates.find((x) => x.iso === c.brut); return d ? texteDate(d, true) : 'présent (masqué)'; }
      return 'présent (masqué)';
    }
    if (c.cle.startsWith('date_')) { const d = f.dates.find((x) => x.iso === c.brut); if (d) return texteDate(d, false); }
    return c.valeur;
  };
  const note = (c: Champ) => `${c.source}${c.fiabilite !== 'sure' ? ` · ${c.fiabilite}` : ''}${c.encodageDouteux ? ' · encodage incertain' : ''}`;
  for (const g of ORDRE_GROUPES) {
    if (g === 'lieu' && f.position) {
      const p = f.position;
      if (masquer) r.push({ groupe: g, texte: 'Lieu : présent dans le fichier (gardé sur la machine)' });
      else { r.push({ groupe: g, texte: `Position : ${p.enClair}`, source: `${p.source} · ${p.fiabilite}` }); r.push({ groupe: g, texte: `Carte : ${p.geo}` }); }
      if (!masquer) for (const a of f.autresPositions) r.push({ groupe: g, texte: `Autre position : ${a.enClair}`, source: `${a.source} · ${a.fiabilite}` });
    }
    if (g === 'appareil' && (marque || modele)) {
      const mq = marque?.valeur ?? '', md = modele?.valeur ?? '';
      const v = md && mq && md.toLowerCase().startsWith(mq.toLowerCase()) ? md : [mq, md].filter(Boolean).join(' ');
      const src = marque && modele ? `${marque.source} + ${modele.source.split(':').pop()}` : (marque ?? modele)!.source;
      r.push({ groupe: g, texte: `Appareil : ${pourAffichage(v)}`, source: src });
    }
    for (const c of f.champs) {
      if (c.groupe !== g || c.cle === 'appareil_marque' || c.cle === 'appareil_modele' || c.cle === 'dimensions') continue;
      const v = valeurChamp(c);
      r.push({ groupe: g, texte: `${pourAffichage(c.nom, 80)} : ${pourAffichage(v)}${c.langue && !(c.sensible && masquer) ? ` (${nomLangue(c.langue)})` : ''}`, source: note(c) });
    }
  }
  return r;
}

/** Une ligne par information (« Compositeur : Saïd Ali »), dans l'ordre des groupes. */
export function ficheEnLignes(f: Fiche, o: { sensibles?: 'masquer' | 'montrer'; detail?: 'court' | 'complet' } = {}): string[] {
  const masquer = (o.sensibles ?? 'masquer') === 'masquer', complet = (o.detail ?? 'complet') === 'complet';
  const r: string[] = [];
  if (f.illisible) r.push(`Illisible : ${f.illisible}`);
  if (f.largeur && f.hauteur) r.push(`Dimensions : ${f.largeur} × ${f.hauteur} px${f.orientation && f.orientation.code !== 1 ? ` (${f.orientation.texte})` : ''}`);
  if (f.dureeSec !== undefined) r.push(`Durée : ${dureeEnClair(f.dureeSec)}${f.dureeEstimee ? ' (estimée)' : ''}`);
  for (const l of lignesDe(f, masquer)) {
    if (!complet && !COURT.has(l.groupe)) continue;
    r.push(complet && l.source ? `${l.texte} [${l.source}]` : l.texte);
  }
  if (!complet) return r;
  if (f.languesDeclarees.length) r.push(`Langues déclarées : ${[...new Set(f.languesDeclarees.map((l) => nomLangue(l.code)))].join(', ')}`);
  for (const [i, c] of f.chapitres.slice(0, 50).entries()) r.push(`Chapitre ${i + 1} (${hms(c.debutSec)}) : ${pourAffichage(c.titre, 120)}`);
  if (f.chapitres.length > 50) r.push(`… et ${f.chapitres.length - 50} autres chapitres`);
  for (const i of f.images) r.push(`Image jointe : ${i.role}, ${i.format.toUpperCase()}${i.largeur && i.hauteur ? ` ${i.largeur} × ${i.hauteur}` : ''}, ${enOctets(i.taille)}${i.mimeDeclare && !i.mimeDeclare.includes(i.format) ? ` (annoncée ${i.mimeDeclare})` : ''}`);
  for (const t of f.textesInclus) r.push(`${t.genre[0].toUpperCase()}${t.genre.slice(1)}${t.langue ? ` (${nomLangue(t.langue)})` : ''} : ${pourAffichage(t.texte, 300)}`);
  for (const a of f.nature.alertes) r.push(`Alerte : ${pourAffichage(a, 200)}`);
  for (const x of f.remarques) r.push(`Remarque : ${pourAffichage(x, 200)}`);
  if (f.partiel) r.push(`Lecture partielle : ${f.partiel}`);
  for (const m of f.manque) r.push(`Manque : ${m.quoi} : ${m.raison}.`);
  return r;
}

/** Le texte complet : en-tête, groupes, pistes, chapitres, images jointes, remarques, « Ce qui manque ». */
export function ficheEnTexte(f: Fiche, o: { sensibles?: 'masquer' | 'montrer'; sources?: boolean } = {}): string {
  const masquer = (o.sensibles ?? 'masquer') === 'masquer';
  const tete = [f.nature.nom, enOctets(f.tailleOctets)];
  if (f.largeur && f.hauteur) tete.push(`${f.largeur} × ${f.hauteur} px`);
  if (f.dureeSec !== undefined) tete.push(`${dureeEnClair(f.dureeSec)}${f.dureeEstimee ? ' (estimée)' : ''}`);
  const r = [tete.join(' · ')];
  if (f.illisible) r.push(`Illisible : ${f.illisible}`);
  let groupe = '';
  for (const l of lignesDe(f, masquer)) {
    if (l.groupe !== groupe) { groupe = l.groupe; r.push(NOMS_GROUPES[groupe] ?? groupe); }
    r.push(`- ${l.texte}${o.sources && l.source ? `   [${l.source}]` : ''}`);
  }
  if (f.pistes.length) { r.push('Pistes'); for (const p of f.pistes) r.push(`- ${ligneDePiste(p)}`); }
  if (f.languesDeclarees.length) r.push(`Langues déclarées : ${[...new Set(f.languesDeclarees.map((l) => nomLangue(l.code)))].join(', ')}`);
  if (f.chapitres.length) { r.push('Chapitres'); for (const c of f.chapitres.slice(0, 50)) r.push(`- ${hms(c.debutSec)} ${pourAffichage(c.titre, 120)}`); }
  if (f.images.length) { r.push('Images jointes'); for (const i of f.images) r.push(`- ${i.role} : ${i.format.toUpperCase()}${i.largeur && i.hauteur ? ` ${i.largeur} × ${i.hauteur}` : ''}, ${enOctets(i.taille)}`); }
  if (f.textesInclus.length) { r.push('Textes inclus'); for (const t of f.textesInclus) r.push(`- ${t.genre} : ${pourAffichage(t.texte, 300)}`); }
  const rem = [...f.nature.alertes, ...f.remarques];
  if (f.partiel) rem.push(`lecture partielle : ${f.partiel}`);
  if (rem.length) { r.push('Remarques'); for (const x of rem) r.push(`- ${pourAffichage(x, 200)}`); }
  if (f.manque.length) { r.push('Ce qui manque'); for (const m of f.manque) r.push(`- ${m.quoi[0].toUpperCase()}${m.quoi.slice(1)} : ${m.raison}.${m.commentObtenir ? ` ${m.commentObtenir}` : ''}`); }
  return r.join('\n');
}

/** Nom court d'un codec, à la manière de FFmpeg (« h264 », « aac ») : la forme qu'avait media_info. */
const COURTS: Array<[string, string]> = [
  ['avc', 'h264'], ['V_MPEG4/ISO/AVC', 'h264'], ['hvc1', 'hevc'], ['hev1', 'hevc'], ['dvh', 'hevc'], ['V_MPEGH', 'hevc'], ['av01', 'av1'], ['V_AV1', 'av1'],
  ['vp09', 'vp9'], ['V_VP9', 'vp9'], ['vp08', 'vp8'], ['V_VP8', 'vp8'], ['mp4v', 'mpeg4'], ['V_MPEG4/ISO/ASP', 'mpeg4'], ['MJPG', 'mjpeg'], ['mjpg', 'mjpeg'], ['jpeg', 'mjpeg'],
  ['ap', 'prores'], ['theora', 'theora'], ['V_THEORA', 'theora'], ['mp4a', 'aac'], ['adts', 'aac'], ['A_AAC', 'aac'], ['Opus', 'opus'], ['opus', 'opus'], ['A_OPUS', 'opus'],
  ['fLaC', 'flac'], ['flac', 'flac'], ['A_FLAC', 'flac'], ['vorbis', 'vorbis'], ['A_VORBIS', 'vorbis'], ['mp3', 'mp3'], ['.mp3', 'mp3'], ['A_MPEG/L3', 'mp3'], ['alac', 'alac'],
  ['ac-3', 'ac3'], ['A_AC3', 'ac3'], ['ec-3', 'eac3'], ['A_EAC3', 'eac3'], ['wav:1', 'pcm'], ['wav:3', 'pcm_f32'], ['sowt', 'pcm'], ['twos', 'pcm'], ['lpcm', 'pcm'], ['aiff', 'pcm'],
  ['speex', 'speex'], ['samr', 'amr_nb'], ['sawb', 'amr_wb'], ['tx3g', 'mov_text'], ['wvtt', 'webvtt'], ['S_TEXT/UTF8', 'subrip'], ['S_TEXT/ASS', 'ass'], ['S_TEXT/WEBVTT', 'webvtt'],
  ['S_HDMV/PGS', 'hdmv_pgs_subtitle'], ['S_VOBSUB', 'dvd_subtitle'],
];
function codecCourt(p: Fiche['pistes'][number]): string | undefined {
  const b = p.codecBrut ?? '';
  for (const [k, v] of COURTS) if (b === k || (k.length >= 3 && b.startsWith(k))) return v;
  if (p.codec?.startsWith('MPEG-1 couche III') || p.codec?.startsWith('MPEG-2 couche III')) return 'mp3';
  return undefined;
}

/** « vidéo h264 854×480 à 25 i/s (H.264 (AVC) profil High 4.1) », « audio aac 44100 Hz, 2 canal(aux) (AAC-LC) ». */
export function ligneDePiste(p: Fiche['pistes'][number]): string {
  const langue = p.langueDeclaree ? `, ${nomLangue(p.langueDeclaree)}` : '';
  const nom = p.nom ? ` « ${pourAffichage(p.nom, 80)} »` : '';
  const court = codecCourt(p);
  const codec = court ?? p.codec ?? '?';
  const long = court && p.codec && p.codec.toLowerCase() !== court ? ` (${p.codec})` : '';
  if (p.genre === 'vidéo') {
    const L = p.largeurAffichee ?? p.largeur, H = p.hauteurAffichee ?? p.hauteur;
    return `vidéo ${codec}${L && H ? ` ${L}×${H}` : ''}${p.imagesParSeconde ? ` à ${decimal(p.imagesParSeconde, 2)} i/s${p.frequenceVariable ? ' (variable)' : ''}` : ''}${long}${p.rotationDeg ? `, tournée de ${p.rotationDeg}°` : ''}${p.debitKbps ? `, ${p.debitKbps} kb/s` : ''}${langue}${nom}`;
  }
  if (p.genre === 'son') return `audio ${codec}${p.frequenceHz ? ` ${p.frequenceHz} Hz` : ''}${p.canaux ? `, ${p.canaux} canal(aux)` : ''}${long}${p.bitsParEchantillon ? `, ${p.bitsParEchantillon} bits` : ''}${p.debitKbps ? `, ${p.debitKbps} kb/s` : ''}${langue}${nom}`;
  if (p.genre === 'sous-titres') return `sous-titres ${p.codec ?? codec}${langue}${p.texteEnImages ? ' (en images : il faudrait les lire par OCR)' : ''}${p.forcee ? ', forcés' : ''}${nom}`;
  return `${p.genre} ${p.codec ?? codec}${p.nonLue ? ` (${p.nonLue})` : ''}${nom}`;
}

/** Les octets d'une pochette ou d'une vignette (≤ 16 Mio), format vérifié par les octets ; undefined sinon. */
export function extraireImageJointe(e: EntreeMedia, i: ImageJointe): Buffer | undefined {
  try {
    if (i.taille <= 0 || i.taille > BORNES.imageJointe + 64 * 1024) return undefined;
    const verifier = (b: Buffer | undefined) => (b && formatImage(b) !== 'inconnu' && (i.format === 'inconnu' || formatImage(b) === i.format || (i.format === 'heif' && formatImage(b) === 'heif')) ? b : undefined);
    if ((i.codage === 'brut' || i.codage === 'désynchronisé') && i.decalage >= 0) {
      const budget = creerBudget();
      const src = 'chemin' in e ? sourceFichier(e.chemin, budget) : sourceOctets(e.octets, budget, e.nom);
      try {
        const b = Buffer.from(src.lire(i.decalage, i.taille));
        if (b.length !== i.taille) return undefined;
        return verifier(i.codage === 'désynchronisé' ? desynchroniser(b).out : b);
      } finally { src.fermer(); }
    }
    // Base64 ou position inconnue : relire en gardant les octets.
    const { fiche, captures } = lire(e, { avecImages: true });
    const k = fiche.images.findIndex((x) => x.decalage === i.decalage && x.taille === i.taille && x.role === i.role && x.format === i.format);
    return verifier(k >= 0 ? captures.get(k) : undefined);
  } catch { return undefined; }
}
