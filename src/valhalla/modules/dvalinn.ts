// Alchimie · la conversion de fichiers et les PDF (idées de VERT, Frame, BentoPDF, Stirling-PDF, IT-Tools et Tdarr,
// réécrites pour Odin, aucun code copié). Tout se fait sur la machine d'Odin avec les outils libres installés
// (ffmpeg, ImageMagick, LibreOffice, pandoc, qpdf, Poppler, Ghostscript, OCRmyPDF, Calibre) : rien n'est envoyé dehors.
//   - convertir : vidéo, son, image, document, tableur, présentation, texte, PDF, livre ;
//   - PDF : fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger / retirer un mot de passe,
//     images → PDF, nettoyer les informations cachées ;
//   - vidéos par lot (comme Tdarr) : un dossier entier recompressé, une vidéo à la fois, en arrière-plan ;
//   - boîte à outils (comme IT-Tools) : empreintes, Base64, JWT, horodatage, JSON, sous-réseau, couleurs…
//   - sans aucun outil (idées de Filee, réécrites) : sous-titres, données (JSON, CSV, YAML, TOML, XML, Excel), contacts,
//     agenda, cartes (GeoJSON, KML, GPX), archives (ZIP, TAR) ; dossiers surveillés ; conversion depuis un lien.
// Les fichiers sont pris dans les dossiers que tu donnes à Alchimie (l'atelier par défaut). Un résultat est
// toujours écrit à côté de l'original sous un nouveau nom : rien n'est jamais écrasé ni effacé.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cleanRel, freeName, inside } from '../skidbladnir/store.ts';
import { extOf, familyOf, pdfPlan, plan, qpdfSecretArgs, TARGETS, type Opts, type PdfOp, type Step } from '../dvalinn/plan.ts';
import { OUTILS, outil } from '../dvalinn/outils.ts';
import { CIBLES_MAISON, ciblesMaison, convertirMaison, familleMaison, peutMaison } from '../dvalinn/maison.ts';
import { lienDeMaison, lienPropre, nomDeLien, telecharger } from '../lien.ts';
import { heicVersPng, lireHeif } from '../dvalinn/heic.ts';
import { cadre, choixPour, dateExif, jpegAvecDate, nomRecette, qualiteDe, RAPPORTS, taillePropre } from '../dvalinn/rapide.ts';
import type { ChoixDepot, ModCtx, Module, Section } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
export interface Folder { nom: string; chemin: string }
interface Job { id: string; src: string; codec: 'h264' | 'h265' | 'av1'; qualite: 'haute' | 'normale' | 'legere'; hauteur?: number; state: 'attente' | 'en cours' | 'fini' | 'erreur'; out?: string; err?: string; gain?: number; at: string }
interface Hist { at: string; what: string; ok: boolean; out?: string[]; err?: string }
/** Une conversion récente, à refaire d'un geste (« Photos → JPG ») : le format visé et les réglages, jamais les fichiers. */
export interface Recette { id: string; titre: string; famille: string; vers: string; qualite?: number; garder_date?: boolean; rogner?: string; at: string }
/** Un dossier surveillé : tout fichier qui y arrive est converti vers `vers` (résultat dans son sous-dossier « convertis »). */
interface Veille { id: string; dossier: string; vers: string; at: string; faits: Record<string, number> }

/** Les outils libres que Alchimie sait utiliser (et le paquet qui les apporte). */
export const TOOLS: Array<{ cmd: string; alt?: string; pkg: string; does: string }> = [
  { cmd: 'ffmpeg', pkg: 'ffmpeg', does: 'vidéo et son, GIF, vidéos par lot' },
  { cmd: 'magick', alt: 'convert', pkg: 'imagemagick', does: 'images, images → PDF' },
  { cmd: 'soffice', pkg: 'libreoffice', does: 'Word, Excel, PowerPoint, OpenDocument ↔ PDF' },
  { cmd: 'pandoc', pkg: 'pandoc', does: 'Markdown, HTML ↔ documents' },
  { cmd: 'qpdf', pkg: 'qpdf', does: 'fusion, découpe, rotation, mot de passe, allègement des PDF' },
  { cmd: 'pdftotext', pkg: 'poppler-utils', does: 'PDF → texte' },
  { cmd: 'pdftoppm', pkg: 'poppler-utils', does: 'PDF → images' },
  { cmd: 'gs', pkg: 'ghostscript', does: 'compression forte des PDF' },
  { cmd: 'ocrmypdf', pkg: 'ocrmypdf', does: 'texte reconnu dans les PDF scannés (PDF/A)' },
  { cmd: 'ebook-convert', pkg: 'calibre', does: 'livres numériques (EPUB, MOBI, AZW3)' },
];
/** Des fichiers qu'on ne touche jamais, même dans un dossier donné (clés, comptes, coffres). */
const FORBIDDEN = /(^|\/)(\.ssh|\.gnupg|\.odin-corbeille)(\/|$)|(^|\/)(compte|sessions|secrets|signatures|cle-signatures|réglages|reglages)\.json$|-key\.pem$|acme-compte\.pem$|(^|\/)jeton-tunnel$/i;

const atelier = (ctx: ModCtx) => join(ctx.dir, 'atelier');
/** Les fichiers joints dans la Discussion : Alchimie peut les convertir (le résultat est écrit à côté). */
const recus = (ctx: ModCtx): Folder => ({ nom: 'inbox', chemin: join(ctx.home, 'workspace', 'inbox') });
export const folders = (ctx: ModCtx): Folder[] => [{ nom: 'atelier', chemin: atelier(ctx) }, ...(((ctx.settings.dossiers as Folder[] | undefined) ?? []).filter((f) => f.nom !== 'atelier'))];
/** « dossier:chemin/fichier » (ou « chemin » dans l'atelier) → chemin absolu vérifié. */
export function resolveFile(ctx: ModCtx, ref: string): { abs: string; folder: Folder; rel: string } {
  // « inbox/devis.docx » : un fichier joint dans la Discussion (« Odin, convertis ce fichier en PDF »).
  const brut = s(ref).replace(/^inbox\//, 'inbox:');
  const m = /^([\w.-]{1,40}):(.*)$/.exec(brut), name = m ? m[1] : 'atelier', rel = cleanRel(m ? m[2] : brut);
  const folder = name === 'inbox' ? recus(ctx) : folders(ctx).find((f) => f.nom === name); if (!folder) throw new Error(`dossier inconnu : ${name} (${folders(ctx).map((f) => f.nom).join(', ')})`);
  if (FORBIDDEN.test(rel)) throw new Error('fichier protégé : Odin n\'y touche pas');
  mkdirSync(folder.chemin, { recursive: true });
  return { abs: inside(folder.chemin, rel), folder, rel };
}
const human = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const relOf = (f: Folder, abs: string) => `${f.nom}:${abs.slice(f.chemin.length + 1)}`;

/** Lance une recette dans un dossier de travail à part, puis range les fichiers produits à côté de l'original. */
export async function runStep(ctx: ModCtx, st: Step, work: string, destDir: string, timeoutMs = 30 * 60e3): Promise<string[]> {
  let { cmd, args } = st;
  if (!(await ctx.has(cmd)) && st.alt && (await ctx.has(st.alt.cmd))) ({ cmd, args } = st.alt);
  if (!(await ctx.has(cmd))) { const t = TOOLS.find((x) => x.cmd === cmd || x.alt === cmd); throw new Error(`outil manquant : ${cmd}${t ? ` (paquet ${t.pkg} ; « outils de conversion » pour la liste)` : ''}`); }
  const env = cmd === 'soffice' ? ['-env:UserInstallation=file://' + join(work, '.lo')] : [];
  const r = await ctx.run(cmd, [...env, ...args], { timeoutMs });
  const made = readdirSync(work).filter((f) => !f.startsWith('.') && statSync(join(work, f)).isFile());
  if (!made.length) throw new Error((r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 300) || `${cmd} n'a rien produit (code ${r.code})`);
  mkdirSync(destDir, { recursive: true });
  return made.sort().map((f) => { const to = join(destDir, freeName(destDir, f)); renameSync(join(work, f), to); return to; });
}
export const workDir = (ctx: ModCtx) => { const d = join(ctx.dir, 'travail', randomBytes(6).toString('hex')); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
function remember(ctx: ModCtx, h: Hist) { ctx.saveSettings({ historique: [h, ...(((ctx.settings.historique as Hist[] | undefined) ?? []))].slice(0, 40) }); }

// ---------------------------------------------------------------- l'antivirus d'abord (Asclépios)
/** Verdicts déjà rendus (chemin, taille, date) : un fichier vérifié au dépôt n'est pas revérifié pour sa conversion. */
const verdicts = new Map<string, Verdict>();
export interface Verdict { sain: boolean; absent?: boolean; quoi?: string; suite?: string }
/**
 * Fait vérifier un fichier par l'antivirus d'Odin (Asclépios) avant de l'ouvrir. Dangereux : mis en quarantaine
 * (réversible) ; un simple doute ou le fichier d'essai des antivirus : laissé où il est, jamais ouvert.
 */
export async function asclepios(ctx: ModCtx, path: string): Promise<Verdict> {
  if (!ctx.modules().some((m) => m.id === 'ullr')) return { sain: true, absent: true };
  let cle = ''; try { const st = statSync(path); cle = `${path}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { return { sain: false, quoi: 'fichier introuvable' }; }
  const deja = verdicts.get(cle); if (deja) return deja;
  const v = await ctx.call('ullr', 'fichier', { chemin: path }, 'vérifier un fichier avant de le convertir', { interne: true }), d = v.data as { level?: string; findings?: Array<{ threat?: string; klass?: string }> } | undefined;
  let r: Verdict = { sain: true };
  if (d?.level && ['moyenne', 'haute', 'critique'].includes(d.level)) {
    const quoi = [...new Set((d.findings ?? []).map((x) => x.threat).filter(Boolean))].slice(0, 3).join(', ') || d.level, essai = (d.findings ?? []).length > 0 && (d.findings ?? []).every((x) => x.klass === 'test');
    let suite = 'Il est resté où il était, sans avoir été ouvert.';
    if (!essai && d.level !== 'moyenne') { const q = await ctx.call('ullr', 'isoler', { fichier: path, menace: quoi }, 'fichier reconnu dangereux avant conversion').catch(() => undefined); if (q && q.ok !== false) suite = 'Je l\'ai mis en quarantaine (antivirus) : il ne peut plus être ouvert, et tu peux l\'en ressortir si c\'est une erreur.'; }
    r = { sain: false, quoi, suite };
  }
  if (verdicts.size > 500) verdicts.clear();
  verdicts.set(cle, r); return r;
}

// ---------------------------------------------------------------- réglages des images (rognage, date de prise)
const identify = async (ctx: ModCtx, args: string[]) => {
  const im7 = await ctx.has('magick'), r = await ctx.run(im7 ? 'magick' : 'identify', [...(im7 ? ['identify'] : []), ...args], { timeoutMs: 60e3 });
  return r.code === 0 ? r.out.trim() : '';
};
/** Le cadre à garder au centre pour « Rogner avant » (selon le sens réel de la photo). */
async function cadreDe(ctx: ModCtx, abs: string, rapport: string): Promise<Opts['cadre']> {
  if (!RAPPORTS[rapport] || familyOf(abs) !== 'image') return undefined;
  const [w, h, o] = (await identify(ctx, ['-format', '%w %h %[orientation]\n', `${abs}[0]`])).split('\n')[0].split(' ');
  const tourne = /^(LeftTop|RightTop|RightBottom|LeftBottom)$/.test(o ?? '');
  return cadre(Number(tourne ? h : w), Number(tourne ? w : h), rapport);
}
/** « Garder la date de prise » : la date de la photo (ou du fichier) remise sur le résultat ; dans un JPEG, la date seule. */
async function garderDate(ctx: ModCtx, src: string, out: string[]): Promise<void> {
  let d: Date | undefined;
  if (familyOf(src) === 'image') d = dateExif(await identify(ctx, ['-format', '%[EXIF:DateTimeOriginal]', `${src}[0]`]).catch(() => ''));
  if (!d && /^(heic|heif)$/.test(extOf(src))) { try { d = dateExif(lireHeif(readFileSync(src)).date ?? ''); } catch { /* pas de date lisible */ } }
  d ??= statSync(src).mtime;
  for (const o of out) {
    try { if (/\.jpe?g$/i.test(o)) writeFileSync(o, jpegAvecDate(readFileSync(o), d)); utimesSync(o, d, d); } catch { /* la conversion reste bonne, seule la date manque */ }
  }
}
const recettes = (ctx: ModCtx): Recette[] => (ctx.settings.recettes as Recette[] | undefined) ?? [];
/** Retient une conversion pour « Refaire » (la même sorte de fichier vers le même format remonte en tête). */
function retenirRecette(ctx: ModCtx, nom: string, vers: string, i: Record<string, unknown>) {
  const famille = String(familyOf(nom) ?? familleMaison(nom) ?? extOf(nom)), titre = nomRecette(nom, vers, optsOf(i).qualite);
  const r: Recette = { id: randomBytes(4).toString('hex'), titre, famille, vers, ...(pctDe(i.qualite) ? { qualite: pctDe(i.qualite) } : {}), ...(i.garder_date === true || i.garder_date === 'true' ? { garder_date: true } : {}), ...(RAPPORTS[s(i.rogner)] ? { rogner: s(i.rogner) } : {}), at: ctx.now().toISOString() };
  ctx.saveSettings({ recettes: [r, ...recettes(ctx).filter((x) => x.titre !== titre)].slice(0, 8) });
}

const QUAL = ['normale', 'haute', 'legere'];
/** La qualité en pourcentage (« 85 », « 85 % »), ou undefined. */
const pctDe = (v: unknown) => { const n = Number(s(v).replace(/\s*%$/, '')); return s(v) !== '' && Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n) : undefined; };
const optsOf = (i: Record<string, unknown>): Opts => ({
  qualite: (QUAL.includes(s(i.qualite)) ? s(i.qualite) : pctDe(i.qualite) ? qualiteDe(pctDe(i.qualite)!) : 'normale') as Opts['qualite'],
  ...(pctDe(i.qualite) ? { pct: pctDe(i.qualite) } : {}), ...(i.gris === true || i.gris === 'true' ? { gris: true } : {}),
  ...(Number(i.largeur) > 0 ? { largeur: Math.min(8000, Number(i.largeur)) } : {}), ...(Number(i.hauteur) > 0 ? { hauteur: Math.min(8000, Number(i.hauteur)) } : {}),
  ...(['h264', 'h265', 'av1'].includes(s(i.codec)) ? { codec: s(i.codec) as Opts['codec'] } : {}),
  ...(i.sans_son === true || i.sans_son === 'true' ? { sansSon: true } : {}), ...(s(i.debut) ? { debut: s(i.debut) } : {}), ...(s(i.duree) ? { duree: s(i.duree) } : {}),
});

const propre = (x: string) => s(x).toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
/** Alchimie sait-elle (elle-même ou avec un outil) convertir ce fichier vers ce format ? */
export const convertible = (nom: string, vers: string) => { const to = propre(vers), f = familyOf(nom); return peutMaison(nom, to) || (Boolean(f) && TARGETS[f!].includes(to) && extOf(nom) !== to); };
/**
 * Convertit un fichier vers un format : par Alchimie elle-même quand elle sait (sous-titres, données, contacts,
 * agenda, cartes, archives), sinon par l'outil libre qu'il faut. Le résultat va dans `destDir`, sans rien écraser.
 */
export async function convertirFichier(ctx: ModCtx, abs: string, vers: string, destDir: string, o: Opts = {}): Promise<string[]> {
  const to = propre(vers);
  if (peutMaison(basename(abs), to)) {
    if (statSync(abs).size > 512 * 1024 * 1024) throw new Error('fichier trop gros pour cette conversion (512 Mo au plus)');
    const r = convertirMaison(basename(abs), readFileSync(abs), to);
    mkdirSync(destDir, { recursive: true }); const out = join(destDir, freeName(destDir, r.nom)); writeFileSync(out, r.data); return [out];
  }
  // Un fichier qu'Alchimie lit elle-même, mais pas vers ce format : on dit ce qu'il peut devenir.
  const fm = familleMaison(basename(abs));
  if (fm && !familyOf(abs)) throw new Error(`conversion pas possible : un fichier .${extOf(abs)} (${fm}) se convertit en ${ciblesMaison(basename(abs)).join(', ')}`);
  const work = workDir(ctx);
  try { return await runStep(ctx, plan(abs, to, work, o), work, destDir); }
  catch (e) {
    // Photo HEIC et ImageMagick sans décodeur HEVC : Alchimie lit la photo elle-même, ffmpeg la décode (sans perte), puis on reprend.
    if (!/^(heic|heif)$/.test(extOf(abs)) || !(await ctx.has('ffmpeg'))) throw e;
    const d = workDir(ctx), png = join(d, `${basename(abs, extname(abs))}.png`);
    try {
      await heicVersPng((c, a, x) => ctx.run(c, a, x), abs, png);
      if (to === 'png') { mkdirSync(destDir, { recursive: true }); const out = join(destDir, freeName(destDir, basename(png))); renameSync(png, out); return [out]; }
      for (const f of readdirSync(work)) rmSync(join(work, f), { recursive: true, force: true });
      return await runStep(ctx, plan(png, to, work, o), work, destDir);
    } finally { rmSync(d, { recursive: true, force: true }); }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
/** Le genre de chaque format de sortie (pour ranger les boutons) et son nom affiché quand le sigle ne suffit pas. */
const GENRES: Array<[string, string[]]> = [['Vidéo', ['mp4', 'mkv', 'webm', 'mov', 'avi']], ['Son', ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac']], ['Image', ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico']],
  ['Document', ['pdf', 'pdfa', 'docx', 'odt', 'rtf', 'txt', 'html', 'md', 'pptx', 'odp', 'epub', 'mobi', 'azw3']], ['Tableau et données', ['xlsx', 'ods', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'toml']],
  ['Sous-titres', ['srt', 'vtt', 'ass', 'lrc']], ['Contacts et agenda', ['vcf', 'ics']], ['Carte', ['geojson', 'kml', 'gpx']], ['Archive', ['zip', 'tar', 'tar.gz']]];
const NOMS: Record<string, string> = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', md: 'Markdown', txt: 'Texte', pdfa: 'PDF/A', webm: 'WebM', geojson: 'GeoJSON', html: 'Page web (HTML)' };
const FAMILLES: Record<string, string> = { video: 'vidéo', audio: 'son', image: 'image', document: 'document', tableur: 'tableau', presentation: 'présentation', texte: 'texte', pdf: 'PDF', livre: 'livre' };
/**
 * Ce qu'un fichier peut devenir, d'après son nom (ou le lien qui y mène), rangé par genre : sert à la zone de dépôt,
 * qui ne propose ainsi que les formats possibles. Pur.
 */
export function conversionsPossibles(nomOuLien: string): ChoixDepot {
  const brut = s(nomOuLien), nom = basename(/^https?:\/\//i.test(brut) ? (() => { try { return decodeURIComponent(new URL(brut).pathname); } catch { return brut; } })() : brut);
  const f = familyOf(nom), fm = familleMaison(nom), de = propre(extOf(nom));
  const cibles = [...new Set([...(fm ? ciblesMaison(nom) : []), ...(f ? TARGETS[f] : [])])].filter((x) => x !== de);
  if (!cibles.length) return { champ: 'format', groupes: [], refus: de ? `Je ne sais pas convertir un fichier .${de}. Dis « outils de conversion » pour voir ce que je sais faire.` : 'Ce fichier n\'a pas d\'extension : je ne sais pas ce que c\'est.' };
  const label = (x: string) => (x === 'gif' && f === 'video' ? 'GIF animé' : NOMS[x] ?? x.toUpperCase());
  const groupes = GENRES.map(([titre, exts]) => ({ titre: titre === 'Son' && f === 'video' ? 'Son seul' : titre, valeurs: cibles.filter((x) => exts.includes(x) && !(x === 'gif' && f === 'video' && titre === 'Image')).map((x) => ({ valeur: x, label: label(x) })) }));
  // Le GIF tiré d'une vidéo est une vidéo courte : il se range avec les vidéos.
  if (f === 'video' && cibles.includes('gif')) groupes[0].valeurs.push({ valeur: 'gif', label: label('gif') });
  const reste = cibles.filter((x) => !GENRES.some(([, exts]) => exts.includes(x)));
  if (reste.length) groupes.push({ titre: 'Autre', valeurs: reste.map((x) => ({ valeur: x, label: label(x) })) });
  // Le genre du premier choix (celui du fichier lui-même, le plus souvent) se montre en premier.
  const pleins = groupes.filter((g) => g.valeurs.length).sort((x, y) => Number(y.valeurs.some((v) => v.valeur === cibles[0])) - Number(x.valeurs.some((v) => v.valeur === cibles[0])));
  return { famille: f ? FAMILLES[f] : fm, champ: 'format', groupes: pleins.length === 1 ? [{ ...pleins[0], titre: '' }] : pleins, defaut: cibles[0],
    // La qualité ne compte que pour ce qui se compresse : vidéo, son, image.
    ...(f === 'video' || f === 'audio' || f === 'image' ? { options: [{ champ: 'qualite', titre: 'Qualité', defaut: 'normale', valeurs: [{ valeur: 'legere', label: 'Légère' }, { valeur: 'normale', label: 'Normale' }, { valeur: 'haute', label: 'Haute' }] }] } : {}) };
}
const veilles = (ctx: ModCtx): Veille[] => (ctx.settings.surveilles as Veille[] | undefined) ?? [];
let veilleEnCours = false;
/** Un tour des dossiers surveillés : les fichiers arrivés (et finis d'écrire) sont convertis, cinq au plus par tour. */
export async function tourDeVeille(ctx: ModCtx): Promise<number> {
  if (veilleEnCours) return 0; veilleEnCours = true; let n = 0;
  try {
    for (const v of veilles(ctx)) {
      let f: ReturnType<typeof resolveFile>; try { f = resolveFile(ctx, v.dossier); } catch { continue; }
      if (!existsSync(f.abs) || !statSync(f.abs).isDirectory()) continue;
      const now = ctx.now().getTime(), faits = { ...v.faits }; let change = false;
      for (const nom of readdirSync(f.abs).sort()) {
        if (n >= 5) break; if (nom.startsWith('.') || nom.startsWith('~$')) continue;
        const p = join(f.abs, nom); let st; try { st = statSync(p); } catch { continue; }
        // Un fichier encore en train d'arriver (modifié il y a moins de 5 s) attend le tour suivant.
        if (!st.isFile() || st.size === 0 || now - st.mtimeMs < 5000 || faits[nom] === Math.round(st.mtimeMs) || !convertible(nom, v.vers) || FORBIDDEN.test(nom)) continue;
        try { const out = await convertirFichier(ctx, p, v.vers, join(f.abs, 'convertis')); remember(ctx, { at: ctx.now().toISOString(), what: `${nom} → ${v.vers} (dossier surveillé)`, ok: true, out: out.map((x) => relOf(f.folder, x)) }); n++; }
        catch (e) { remember(ctx, { at: ctx.now().toISOString(), what: `${nom} → ${v.vers} (dossier surveillé)`, ok: false, err: (e as Error).message.slice(0, 300) }); }
        faits[nom] = Math.round(st.mtimeMs); change = true;
      }
      if (change) ctx.saveSettings({ surveilles: veilles(ctx).map((x) => (x.id === v.id ? { ...x, faits: Object.fromEntries(Object.entries(faits).slice(-3000)) } : x)) });
    }
  } finally { veilleEnCours = false; }
  return n;
}
// ---------------------------------------------------------------- vidéos par lot (comme Tdarr)
let busy = false;
const jobs = (ctx: ModCtx): Job[] => (ctx.settings.lots as Job[] | undefined) ?? [];
async function nextJob(ctx: ModCtx): Promise<void> {
  if (busy) return; const l = jobs(ctx), j = l.find((x) => x.state === 'attente'); if (!j) return;
  busy = true; const save = (p: Partial<Job>) => ctx.saveSettings({ lots: jobs(ctx).map((x) => (x.id === j.id ? { ...x, ...p } : x)) });
  save({ state: 'en cours' });
  const work = workDir(ctx);
  try {
    const st = plan(j.src, 'mkv', work, { codec: j.codec, qualite: j.qualite, ...(j.hauteur ? { hauteur: j.hauteur } : {}) });
    st.out = join(work, `${basename(j.src, extname(j.src))}.${j.codec}.mkv`); st.args[st.args.length - 1] = st.out;
    const [out] = await runStep(ctx, st, work, dirname(j.src), 12 * 3600e3);
    const before = statSync(j.src).size, after = statSync(out).size;
    save({ state: 'fini', out, gain: Math.round((1 - after / before) * 100) });
  } catch (e) { save({ state: 'erreur', err: (e as Error).message.slice(0, 300) }); } finally { rmSync(work, { recursive: true, force: true }); busy = false; }
}

export const dvalinn: Module = {
  id: 'dvalinn', name: 'Alchimie', family: 'Données',
  what: 'La conversion de tes fichiers et les PDF (comme VERT, BentoPDF, Stirling-PDF), les vidéos par lot (comme Tdarr) et une boîte à outils (comme IT-Tools), tout sur ta machine.',
  does: ['convertir vidéo, son, image, document, tableur, présentation, texte, PDF, livre numérique', 'vidéo : MP4, MKV, WebM, GIF animé, extraire le son, couper un passage, réduire la taille', 'image : PNG, JPG, WebP, AVIF, HEIC, icône, redimensionner', 'documents : Word, Excel, PowerPoint, OpenDocument, Markdown, HTML ↔ PDF', 'PDF : fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger par mot de passe, retirer un mot de passe, images → PDF, effacer les informations cachées', 'PDF → texte, PDF → images, texte reconnu (OCR) en PDF/A', 'vidéos par lot : tout un dossier recompressé en H.265 ou AV1, en arrière-plan, gain affiché', 'boîte à outils : empreintes, Base64, URL, UUID, JWT, horodatage, JSON, mot de passe, sous-réseau, couleurs, texte', 'sans aucun outil à installer : sous-titres (SRT, WebVTT, ASS, LRC, SAMI, TTML), données (JSON, CSV, YAML, TOML, XML, Excel), contacts (vCard) et agenda (iCalendar) ↔ tableau, cartes (GeoJSON, KML, GPX), archives (ZIP, TAR, TAR.GZ)', 'dossier surveillé : tout fichier qui y arrive est converti tout seul', 'conversion depuis un lien : le fichier est téléchargé, vérifié par l\'antivirus, puis converti', 'rien n\'est envoyé hors de la machine, rien n\'est écrasé : le résultat est écrit à côté'],
  // « Filee » écrit seul se réduirait à « fil » pour le mode sans IA (« mon fils… » ouvrirait Alchimie) : on l'écrit avec son auteur.
  from: ['VERT', 'Frame', 'BentoPDF', 'Stirling-PDF', 'IT-Tools', 'Tdarr', 'KnifeLemon/Filee'], upstream: ['VERT-sh/vert', 'alam00000/bentopdf', 'Stirling-Tools/Stirling-PDF', 'CorentinTh/it-tools', 'HaveAGitGat/Tdarr', 'KnifeLemon/Filee'],
  words: ['convertir', 'conversion', 'convertis', 'pdf', 'fusionner des pdf', 'compresser une video', 'compresser une vidéo', 'en mp4', 'en mp3', 'en pdf', 'en jpg', 'en png', 'dvalinn', 'boite a outils', 'boîte à outils'],
  // Un fichier envoyé depuis le navigateur arrive dans l'atelier (jamais ailleurs), et se désigne « atelier:nom ».
  depot: (ctx) => ({ dossier: atelier(ctx), ref: (nom) => `atelier:${nom}` }),
  // Un résultat peut être remis à l'appareil (« Télécharger ») s'il est dans l'atelier ou un dossier que tu as donné, et n'est pas un fichier protégé.
  retrait: (ctx, ref) => { const f = resolveFile(ctx, ref); return existsSync(f.abs) && statSync(f.abs).isFile() ? f.abs : undefined; },
  actions: [
    { id: 'outils', label: 'Outils de conversion', what: 'Les outils libres présents sur la machine, ce que chacun permet, et ceux qui manquent', read: true, words: ['outils de conversion', 'que sais tu convertir'], run: async (ctx) => {
      const l = await Promise.all(TOOLS.map(async (t) => ({ ...t, ok: (await ctx.has(t.cmd)) || (t.alt ? await ctx.has(t.alt) : false) })));
      const miss = [...new Set(l.filter((t) => !t.ok).map((t) => t.pkg))];
      return { text: ['✅ Alchimie elle-même (rien à installer) · ' + Object.entries(CIBLES_MAISON).map(([k, v]) => `${k} → ${v.join(', ')}`).join(' ; '), ...l.map((t) => `${t.ok ? '✅' : '⬜'} ${t.cmd} · ${t.does}`), miss.length ? `Pour tout avoir : sudo apt install ${miss.join(' ')}` : 'Tout est installé.'].join('\n'), data: l };
    } },
    { id: 'dossiers', label: 'Dossiers', what: 'Les dossiers où l\'appli prend et range les fichiers', read: true, run: (ctx) => ({ text: folders(ctx).map((f) => `${f.nom} → ${f.chemin}`).join('\n') + '\nÉcris « dossier:chemin/fichier » (sans dossier : l\'atelier).' }) },
    { id: 'ajouter_dossier', label: 'Donner un dossier', what: 'L\'appli pourra lire et écrire dans ce dossier (et ses sous-dossiers)', quick: false, grave: (i) => `ouvrir le dossier ${s(i.chemin)} à l'appli`, params: [{ key: 'nom', label: 'Nom court (ex. videos)', kind: 'text', required: true }, { key: 'chemin', label: 'Chemin complet', kind: 'text', required: true }], run: (ctx, i) => {
      const nom = s(i.nom).toLowerCase(), chemin = s(i.chemin).replace(/\/+$/, '');
      if (!/^[a-z0-9_-]{1,30}$/.test(nom) || nom === 'atelier') throw new Error('nom : lettres, chiffres, - ou _');
      if (!chemin.startsWith('/') || chemin === '/' || /\/(etc|proc|sys|dev|boot|root)(\/|$)|^\/(etc|proc|sys|dev|boot|root)$/.test(chemin) || FORBIDDEN.test(chemin)) throw new Error('dossier refusé (système ou protégé)');
      if (!existsSync(chemin) || !statSync(chemin).isDirectory()) throw new Error('dossier introuvable');
      ctx.saveSettings({ dossiers: [...((ctx.settings.dossiers as Folder[] | undefined) ?? []).filter((f) => f.nom !== nom), { nom, chemin }] });
      return { text: `Dossier « ${nom} » ouvert à l'appli : ${chemin}` };
    }, undo: (i) => ({ action: 'retirer_dossier', input: { nom: s(i.nom) }, label: 'Retirer le dossier' }) },
    { id: 'retirer_dossier', label: 'Retirer un dossier', what: 'L\'appli n\'y a plus accès (les fichiers restent)', quick: false, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }], run: (ctx, i) => {
      ctx.saveSettings({ dossiers: ((ctx.settings.dossiers as Folder[] | undefined) ?? []).filter((f) => f.nom !== s(i.nom)) }); return { text: `Dossier « ${s(i.nom)} » retiré (les fichiers restent).` };
    } },
    { id: 'possibles', label: 'Conversions possibles', what: 'Ce qu\'un fichier peut devenir, d\'après son nom ou son lien (rien n\'est téléchargé ni converti)', read: true, quiet: true, quick: false, params: [{ key: 'nom', label: 'Nom du fichier ou lien', kind: 'text', required: true }],
      run: (_ctx, i) => { const c = conversionsPossibles(s(i.nom)); return { text: c.refus ?? c.groupes.map((g) => `${g.titre ? `${g.titre} : ` : ''}${g.valeurs.map((x) => x.label).join(', ')}`).join('\n'), data: c }; } },
    // Le panneau d'Alchimie près d'Odin (4 clics sur lui, ou clic droit) : les fichiers déposés passent par l'antivirus,
    // puis le panneau montre les formats possibles en tuiles (taille estimée), les autres, et les réglages utiles.
    { id: 'preparer', label: 'Préparer une conversion', what: 'Vérifie les fichiers déposés avec l\'antivirus et dit en quoi les convertir (rien n\'est converti)', read: true, quiet: true, quick: false,
      params: [{ key: 'fichiers', label: 'Fichier(s) (dossier:chemin, séparés par des virgules)', kind: 'textarea', required: true, depot: { plusieurs: true } }, { key: 'qualite', label: 'Qualité (%)', kind: 'number', default: 85 }],
      run: async (ctx, i) => {
        const refs = s(i.fichiers).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
        if (!refs.length) return { ok: false, text: 'Aucun fichier : dépose-en un ou choisis-le sur ton appareil.' };
        const fichiers: Array<{ ref: string; nom: string; taille: number }> = [], possibles: string[][] = [];
        let absent = false;
        for (const ref of refs) {
          const f = resolveFile(ctx, ref); if (!existsSync(f.abs) || !statSync(f.abs).isFile()) return { ok: false, text: `Fichier introuvable : ${basename(f.abs)}. Dépose-le à nouveau.` };
          const av = await asclepios(ctx, f.abs); absent ||= Boolean(av.absent);
          if (!av.sain) return { ok: false, text: `${basename(f.abs)} : fichier suspect (${av.quoi}), je ne le convertis pas. ${av.suite ?? ''}`.trim(), data: { suspect: basename(f.abs) } };
          fichiers.push({ ref: relOf(f.folder, f.abs), nom: basename(f.abs), taille: statSync(f.abs).size });
          const c = conversionsPossibles(basename(f.abs)); possibles.push(c.groupes.flatMap((g) => g.valeurs.map((x) => x.valeur)));
        }
        const c = choixPour(fichiers, possibles, pctDe(i.qualite) ?? 85), total = fichiers.reduce((a, x) => a + x.taille, 0);
        if (!c.tuiles.length) return { ok: false, text: fichiers.length > 1 ? 'Ces fichiers ne se convertissent pas vers un même format : dépose-les par sorte (photos, documents…).' : conversionsPossibles(fichiers[0].nom).refus ?? 'Je ne sais pas convertir ce fichier.', data: { fichiers } };
        const exts = [...new Set(fichiers.map((x) => extOf(x.nom).toUpperCase() || '?'))].join(', ');
        return { text: `${fichiers.length} fichier(s) · ${exts} · ${taillePropre(total)} · ${absent ? 'antivirus absent' : 'vérifiés par Asclépios'}\nConvertir en : ${[...c.tuiles.map((t) => t.label), ...c.autres.map((x) => x.label)].join(', ')}`,
          data: { ...c, fichiers, total, totalTexte: taillePropre(total), exts, antivirus: absent ? 'absent' : 'sain' } };
      } },
    { id: 'recentes', label: 'Conversions récentes', what: 'Les dernières sortes de conversions, à refaire d\'un geste', read: true, quiet: true, quick: false, words: ['conversions récentes', 'conversions recentes', 'dernières conversions', 'dernieres conversions'],
      run: (ctx) => { const l = recettes(ctx); return { text: l.length ? l.map((r) => `${r.titre} (${r.at.slice(0, 10)})`).join('\n') : 'Aucune conversion récente.', data: l }; } },
    { id: 'convertir', label: 'Convertir un fichier', what: 'Vers un autre format ; le résultat est écrit à côté de l\'original', words: ['convertis le fichier', 'convertir le fichier'], params: [
      { key: 'fichier', label: 'Fichier (dossier:chemin, ou inbox/nom pour un fichier joint dans la Discussion)', kind: 'text', required: true, depot: {} }, { key: 'format', label: 'Vers (mp4, mp3, pdf, jpg, webp, docx…)', kind: 'text', required: true },
      { key: 'qualite', label: 'Qualité', kind: 'select', options: QUAL, default: 'normale' }, { key: 'largeur', label: 'Largeur max (images, vidéos)', kind: 'number', default: 0 }, { key: 'hauteur', label: 'Hauteur max', kind: 'number', default: 0 },
      { key: 'codec', label: 'Codec vidéo', kind: 'select', options: ['h264', 'h265', 'av1'], default: 'h264' }, { key: 'sans_son', label: 'Sans le son', kind: 'boolean', default: false },
      { key: 'debut', label: 'Début (ex. 00:01:30)', kind: 'text', default: '' }, { key: 'duree', label: 'Durée (ex. 20)', kind: 'text', default: '' },
      { key: 'garder_date', label: 'Garder la date de prise', kind: 'boolean', default: false, help: 'Photos : seule la date est gardée (ni lieu, ni appareil).' },
      { key: 'rogner', label: 'Rogner avant (images)', kind: 'select', options: ['', 'carre', '4:3', '3:2', '16:9'], default: '' }, { key: 'gris', label: 'Noir et blanc (images)', kind: 'boolean', default: false },
    ], run: async (ctx, i) => {
      const f = resolveFile(ctx, s(i.fichier)); if (!existsSync(f.abs) || !statSync(f.abs).isFile()) throw new Error(`fichier introuvable : ${s(i.fichier)}`);
      const to = propre(s(i.format)), t0 = Date.now(), avant = statSync(f.abs).size;
      // L'antivirus d'abord : un fichier n'est ouvert par les outils de conversion que s'il est sain.
      const av = await asclepios(ctx, f.abs);
      if (!av.sain) { remember(ctx, { at: ctx.now().toISOString(), what: `${basename(f.abs)} → ${to}`, ok: false, err: `fichier suspect (${av.quoi}), non converti` }); return { ok: false, text: `Fichier suspect (${av.quoi}) : je ne le convertis pas. ${av.suite ?? ''}`.trim() }; }
      try {
        const o = optsOf(i), rapport = s(i.rogner);
        if (RAPPORTS[rapport]) o.cadre = await cadreDe(ctx, f.abs, rapport);
        const out = await convertirFichier(ctx, f.abs, to, dirname(f.abs), o);
        if (i.garder_date === true || i.garder_date === 'true') await garderDate(ctx, f.abs, out);
        const size = out.reduce((a, x) => a + statSync(x).size, 0);
        remember(ctx, { at: ctx.now().toISOString(), what: `${basename(f.abs)} → ${to}`, ok: true, out: out.map((x) => relOf(f.folder, x)) });
        retenirRecette(ctx, basename(f.abs), to, i);
        return { text: `✅ ${basename(f.abs)} → ${out.length > 1 ? `${out.length} fichiers` : basename(out[0])} (${human(size)}, ${Math.round((Date.now() - t0) / 100) / 10} s)\n${out.slice(0, 10).map((x) => relOf(f.folder, x)).join('\n')}`, data: { sorties: out.map((x) => relOf(f.folder, x)), avant, apres: size, antivirus: av.absent ? 'absent' : 'sain' }, fichiers: out.map((x) => ({ nom: basename(x), ref: relOf(f.folder, x) })) };
      } catch (e) { remember(ctx, { at: ctx.now().toISOString(), what: `${basename(f.abs)} → ${to}`, ok: false, err: (e as Error).message }); throw e; }
    } },
    { id: 'depuis_lien', label: 'Convertir depuis un lien', what: 'Télécharge un fichier (http ou https), le fait vérifier par l\'antivirus, puis le convertit ; l\'original et le résultat vont dans l\'atelier (dossier « arrivees »)', words: ['convertis le lien', 'convertis ce lien'], external: true,
      params: [{ key: 'lien', label: 'Lien du fichier (https://…)', kind: 'text', required: true }, { key: 'format', label: 'Vers (mp3, pdf, srt, csv…)', kind: 'text', required: true }, { key: 'utilisateur', label: 'Identifiant (si le lien en demande un)', kind: 'text' }, { key: 'mot_de_passe', label: 'Mot de passe', kind: 'password' }],
      // Une adresse de la maison (NAS, autre poste) : Odin ne va y chercher un fichier qu'avec ton accord.
      grave: (i) => (lienDeMaison(i.lien) ? `ce lien pointe vers ton réseau (${(() => { try { return new URL(s(i.lien)).hostname; } catch { return 'adresse locale'; } })()}) : Odin va y télécharger un fichier` : undefined),
      run: async (ctx, i) => {
      const lien = lienPropre(i.lien), to = propre(s(i.format)), MAX = 512 * 1024 * 1024;
      if (!/^[a-z0-9.]{2,8}$/.test(to)) throw new Error('format invalide (exemples : mp3, pdf, srt, csv)');
      const t = await telecharger(ctx.fetch, lien.toString(), { max: MAX, maison: lienDeMaison(i.lien), ...(s(i.utilisateur) ? { compte: { utilisateur: s(i.utilisateur), motDePasse: s(i.mot_de_passe) } } : {}) });
      const nom = nomDeLien(t.url, t.disposition, t.type), n = t.data.length;
      if (FORBIDDEN.test(nom)) throw new Error('ce nom de fichier est protégé : je ne l\'enregistre pas');
      if (!convertible(nom, to)) throw new Error(`je ne sais pas convertir « ${nom} » en ${to} (dis « outils de conversion » pour la liste)`);
      const dest = join(atelier(ctx), 'arrivees'); mkdirSync(dest, { recursive: true });
      const path = join(dest, freeName(dest, nom)); writeFileSync(path, t.data);
      // L'antivirus d'abord : un fichier venu d'ailleurs n'est converti que s'il est sain.
      // Dangereux pour de bon : à l'écart tout de suite (quarantaine de l'antivirus, réversible). Un simple doute ou un fichier de test : laissé là, jamais ouvert.
      const av = await asclepios(ctx, path);
      if (!av.sain) {
        remember(ctx, { at: ctx.now().toISOString(), what: `${nom} (lien) → ${to}`, ok: false, err: `fichier suspect (${av.quoi}), non converti` });
        throw new Error(`fichier suspect (${av.quoi}) : je ne le convertis pas. ${av.suite === 'Il est resté où il était, sans avoir été ouvert.' ? `Il est resté dans atelier:arrivees/${basename(path)}, sans avoir été ouvert.` : av.suite}`);
      }
      try {
        const out = await convertirFichier(ctx, path, to, dest, optsOf(i));
        remember(ctx, { at: ctx.now().toISOString(), what: `${nom} (lien) → ${to}`, ok: true, out: out.map((o) => `atelier:arrivees/${basename(o)}`) });
        return { text: `✅ ${nom} (${human(n)}) téléchargé, vérifié, converti → ${out.map((o) => `atelier:arrivees/${basename(o)}`).join(', ')}`, data: out, fichiers: out.map((o) => ({ nom: basename(o), ref: `atelier:arrivees/${basename(o)}` })) };
      } catch (e) { remember(ctx, { at: ctx.now().toISOString(), what: `${nom} (lien) → ${to}`, ok: false, err: (e as Error).message }); throw e; }
    } },
    { id: 'surveiller', label: 'Surveiller un dossier', what: 'Tout fichier qui arrive dans ce dossier est converti tout seul vers le format choisi (résultats dans son sous-dossier « convertis » ; les originaux restent)', words: ['surveille le dossier de conversion'], params: [{ key: 'dossier', label: 'Dossier (dossier:chemin)', kind: 'text', required: true }, { key: 'format', label: 'Vers (mp4, pdf, vtt, csv…)', kind: 'text', required: true }], run: async (ctx, i) => {
      const f = resolveFile(ctx, s(i.dossier)), to = propre(s(i.format));
      if (!existsSync(f.abs) || !statSync(f.abs).isDirectory()) throw new Error('dossier introuvable');
      if (!/^[a-z0-9.]{2,8}$/.test(to) || !(Object.values(TARGETS).some((x) => x.includes(to)) || Object.values(CIBLES_MAISON).some((x) => x.includes(to)))) throw new Error(`format inconnu : ${to} (dis « outils de conversion » pour la liste)`);
      const ref = relOf(f.folder, f.abs) || `${f.folder.nom}:`, v: Veille = { id: randomBytes(4).toString('hex'), dossier: ref, vers: to, at: ctx.now().toISOString(), faits: {} };
      ctx.saveSettings({ surveilles: [...veilles(ctx).filter((x) => x.dossier !== ref), v] });
      const n = await tourDeVeille(ctx);
      return { text: `👁 Dossier ${ref} surveillé : ce qui y arrive est converti en ${to}, dans ${ref}${ref.endsWith(':') ? '' : '/'}convertis.${n ? ` ${n} fichier(s) déjà converti(s).` : ''}` };
    }, undo: (i) => ({ action: 'ne_plus_surveiller', input: { dossier: s(i.dossier) }, label: 'Ne plus surveiller ce dossier' }) },
    { id: 'ne_plus_surveiller', label: 'Ne plus surveiller un dossier', what: 'Les fichiers qui arrivent ne sont plus convertis (rien n\'est effacé)', quick: false, params: [{ key: 'dossier', label: 'Dossier (dossier:chemin)', kind: 'text', required: true }], run: (ctx, i) => {
      const k = s(i.dossier), l = veilles(ctx), reste = l.filter((x) => x.dossier !== k && x.id !== k && x.dossier.replace(/:$/, '') !== k);
      if (reste.length === l.length) throw new Error('ce dossier n\'est pas surveillé');
      ctx.saveSettings({ surveilles: reste }); return { text: `Dossier ${k} : plus surveillé (les fichiers restent).` };
    } },
    { id: 'pdf', label: 'Outils PDF', what: 'Fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger, retirer un mot de passe, images → PDF, nettoyer', words: ['fusionne les pdf', 'protege le pdf', 'protège le pdf', 'compresse le pdf', 'decoupe le pdf', 'découpe le pdf'], params: [
      { key: 'operation', label: 'Opération', kind: 'select', options: ['fusionner', 'extraire', 'decouper', 'pivoter', 'alleger', 'compresser', 'proteger', 'deproteger', 'images_en_pdf', 'nettoyer'], default: 'fusionner' },
      { key: 'fichiers', label: 'Fichier(s) (dossier:chemin, séparés par des virgules)', kind: 'textarea', required: true, depot: { plusieurs: true } },
      { key: 'pages', label: 'Pages (ex. 1-3,5,8-fin)', kind: 'text', default: '' }, { key: 'angle', label: 'Angle', kind: 'select', options: ['90', '180', '270'], default: '90' },
      { key: 'mot_de_passe', label: 'Mot de passe (protéger / retirer)', kind: 'password', default: '' }, { key: 'nom', label: 'Nom du résultat', kind: 'text', default: '' },
    ], run: async (ctx, i) => {
      const op = s(i.operation) as PdfOp, refs = s(i.fichiers).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
      const files = refs.map((r) => resolveFile(ctx, r)); if (!files.length) throw new Error('aucun fichier');
      for (const f of files) { if (!existsSync(f.abs)) throw new Error(`fichier introuvable : ${relOf(f.folder, f.abs)}`); if (op !== 'images_en_pdf' && extOf(f.abs) !== 'pdf') throw new Error(`${basename(f.abs)} n'est pas un PDF`); if (op === 'images_en_pdf' && familyOf(f.abs) !== 'image') throw new Error(`${basename(f.abs)} n'est pas une image`); }
      for (const f of files) { const av = await asclepios(ctx, f.abs); if (!av.sain) return { ok: false, text: `${basename(f.abs)} : fichier suspect (${av.quoi}), je n'y touche pas. ${av.suite ?? ''}`.trim() }; }
      const first = files[0], stem = s(i.nom).replace(/\.pdf$/i, '') || `${basename(first.abs, extname(first.abs))}.${op}`;
      if (/[/\\]/.test(stem)) throw new Error('nom invalide');
      const work = workDir(ctx), out = join(work, `${stem}.pdf`);
      try {
        let secret: string | undefined;
        if (op === 'proteger' || op === 'deproteger') { secret = join(work, '.args'); writeFileSync(secret, qpdfSecretArgs(op, first.abs, out, String(i.mot_de_passe ?? '')), { mode: 0o600 }); chmodSync(secret, 0o600); }
        const st = pdfPlan(op, files.map((f) => f.abs), out, { pages: s(i.pages) || undefined, angle: Number(i.angle) || 90, secretFile: secret });
        const made = await runStep(ctx, st, work, dirname(first.abs));
        const sz = (p: string) => statSync(p).size, before = files.reduce((a, f) => a + sz(f.abs), 0), after = made.reduce((a, p) => a + sz(p), 0);
        remember(ctx, { at: ctx.now().toISOString(), what: `PDF ${op} · ${files.map((f) => basename(f.abs)).join(', ')}`, ok: true, out: made.map((m) => relOf(first.folder, m)) });
        if (op === 'images_en_pdf') retenirRecette(ctx, basename(first.abs), 'pdf', {});
        const gain = op === 'alleger' || op === 'compresser' ? ` · ${human(before)} → ${human(after)} (${Math.round((1 - after / before) * 100)} % de moins)` : '';
        return { text: `✅ ${op.replace('_', ' ')} : ${made.length} fichier(s)${gain}\n${made.slice(0, 20).map((m) => relOf(first.folder, m)).join('\n')}`, data: made, fichiers: made.map((m) => ({ nom: basename(m), ref: relOf(first.folder, m) })) };
      } catch (e) { remember(ctx, { at: ctx.now().toISOString(), what: `PDF ${op}`, ok: false, err: (e as Error).message }); throw e; } finally { rmSync(work, { recursive: true, force: true }); }
    } },
    { id: 'lot_videos', label: 'Vidéos par lot', what: 'Recompresse toutes les vidéos d\'un dossier (comme Tdarr), une à la fois en arrière-plan ; l\'original reste', params: [
      { key: 'dossier', label: 'Dossier (dossier:chemin)', kind: 'text', required: true }, { key: 'codec', label: 'Codec', kind: 'select', options: ['h265', 'av1', 'h264'], default: 'h265' },
      { key: 'qualite', label: 'Qualité', kind: 'select', options: QUAL, default: 'normale' }, { key: 'hauteur', label: 'Hauteur max (ex. 1080, 0 = garder)', kind: 'number', default: 0 },
    ], run: (ctx, i) => {
      const d = resolveFile(ctx, s(i.dossier)); if (!existsSync(d.abs) || !statSync(d.abs).isDirectory()) throw new Error('dossier introuvable');
      const codec = (['h265', 'av1', 'h264'].includes(s(i.codec)) ? s(i.codec) : 'h265') as Job['codec'], qualite = (QUAL.includes(s(i.qualite)) ? s(i.qualite) : 'normale') as Job['qualite'];
      const known = new Set(jobs(ctx).map((j) => j.src)), add: Job[] = [];
      const walk = (dir: string, depth: number) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (n.startsWith('.')) continue; const st = statSync(p); if (st.isDirectory()) { if (depth < 4) walk(p, depth + 1); } else if (familyOf(p) === 'video' && !/\.(h264|h265|av1)\.mkv$/.test(n) && !known.has(p)) add.push({ id: randomBytes(4).toString('hex'), src: p, codec, qualite, ...(Number(i.hauteur) > 0 ? { hauteur: Number(i.hauteur) } : {}), state: 'attente', at: ctx.now().toISOString() }); } };
      walk(d.abs, 0);
      if (!add.length) return { text: 'Aucune nouvelle vidéo dans ce dossier.' };
      ctx.saveSettings({ lots: [...jobs(ctx), ...add.slice(0, 500)] }); void nextJob(ctx);
      return { text: `${add.length} vidéo(s) dans la file (${codec}, qualité ${qualite}). Une à la fois, en arrière-plan ; les originaux restent.` };
    } },
    { id: 'file', label: 'File des vidéos', what: 'Où en sont les vidéos par lot', read: true, run: (ctx) => {
      const l = jobs(ctx); if (!l.length) return { text: 'File vide.' };
      const c = (st: Job['state']) => l.filter((j) => j.state === st).length;
      return { text: [`${c('fini')} finie(s) · ${c('en cours')} en cours · ${c('attente')} en attente · ${c('erreur')} en erreur`, ...l.slice(-15).map((j) => `${j.state === 'fini' ? '✅' : j.state === 'erreur' ? '❌' : j.state === 'en cours' ? '⏳' : '•'} ${basename(j.src)}${j.gain !== undefined ? ` · ${j.gain} % de place gagnée` : ''}${j.err ? ` · ${j.err}` : ''}`)].join('\n') };
    } },
    { id: 'vider_file', label: 'Vider la file', what: 'Retire de la file ce qui n\'est pas en cours (les fichiers restent)', quick: false, run: (ctx) => { const keep = jobs(ctx).filter((j) => j.state === 'en cours'); ctx.saveSettings({ lots: keep }); return { text: 'File vidée.' }; } },
    { id: 'outil', label: 'Boîte à outils', what: 'Empreintes, Base64, URL, UUID, JWT, horodatage, JSON, mot de passe, sous-réseau, couleurs, texte', read: true, words: ['boite a outils', 'boîte à outils', 'calcule le sous reseau', 'décode le jwt', 'decode le jwt', 'genere un uuid', 'génère un uuid'], params: [{ key: 'nom', label: 'Outil', kind: 'select', options: Object.keys(OUTILS), default: 'empreinte' }, { key: 'entree', label: 'Entrée', kind: 'textarea', default: '' }], run: (ctx, i) => ({ text: outil(s(i.nom) || 'empreinte', String(i.entree ?? ''), ctx.now().getTime()) }) },
  ],
  view(ctx) {
    const hist = (ctx.settings.historique as Hist[] | undefined) ?? [], h = hist.slice(0, 15), l = jobs(ctx);
    const C = 'Convertir', P = 'PDF', A = 'Automatique', O = 'Outils';
    // Les derniers fichiers produits, à reprendre sur cet appareil (seulement ceux qui existent encore).
    const derniers = hist.filter((x) => x.ok).flatMap((x) => (x.out ?? []).slice(0, 3).map((ref) => ({ ref, depuis: x.what.split(' → ')[0] })))
      .filter((x) => { try { const f = resolveFile(ctx, x.ref); return existsSync(f.abs) && statSync(f.abs).isFile(); } catch { return false; } }).slice(0, 6);
    const sections: Section[] = [
      // ——— Convertir : déposer (ou donner un lien), choisir, convertir
      { kind: 'depot', onglet: C, title: 'Convertir un fichier', action: 'convertir', champ: 'fichier', texte: 'Dépose un fichier ici', bouton: 'ou choisis-le sur cet appareil', aide: 'Vidéo, son, image, document, PDF, sous-titres, tableau, contacts, carte, archive.',
        lien: { action: 'depuis_lien', champ: 'lien', label: 'Ou le lien d\'un fichier', aide: 'Téléchargé, vérifié par l\'antivirus, puis converti.' }, choix: { action: 'possibles', titre: 'Convertir en', envoyer: 'Convertir en {choix}' } },
      { kind: 'list', onglet: C, title: 'Derniers résultats', empty: 'Rien encore : dépose un fichier pour le convertir.', aide: 'Les originaux restent dans l\'atelier.', items: derniers.map((x) => ({ title: basename(x.ref.replace(/^[\w.-]{1,40}:/, '')), detail: `depuis ${x.depuis}`, fichier: { nom: basename(x.ref.replace(/^[\w.-]{1,40}:/, '')), ref: x.ref } })) },
      // ——— PDF
      { kind: 'form', onglet: P, title: 'Outils PDF', action: 'pdf', submit: 'Lancer', params: [{ key: 'operation', label: 'Opération', kind: 'select', options: ['fusionner', 'extraire', 'decouper', 'pivoter', 'alleger', 'compresser', 'proteger', 'deproteger', 'images_en_pdf', 'nettoyer'], default: 'fusionner' }, { key: 'fichiers', label: 'Fichier(s)', kind: 'textarea', required: true, depot: { plusieurs: true }, help: 'Chemins séparés par des virgules, ou fichiers de cet appareil (plusieurs possibles).' }, { key: 'pages', label: 'Pages', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe', kind: 'password', default: '' }] },
      // ——— Automatique : dossiers surveillés, vidéos par lot
      { kind: 'table', onglet: A, title: 'Dossiers surveillés', columns: ['Dossier', 'Converti en', 'Depuis', 'Fichiers traités'], empty: 'Aucun. Avec « Surveiller un dossier », tout fichier qui arrive est converti tout seul.', rows: veilles(ctx).map((v) => ({ cells: [v.dossier, v.vers, v.at.slice(0, 10), String(Object.keys(v.faits).length)], actions: [{ action: 'ne_plus_surveiller', label: 'Arrêter', input: { dossier: v.dossier } }] })) },
      { kind: 'form', onglet: A, title: 'Surveiller un dossier', action: 'surveiller', submit: 'Surveiller', params: [{ key: 'dossier', label: 'Dossier (dossier:chemin)', kind: 'text', required: true, help: `Tes dossiers : ${folders(ctx).map((f) => f.nom).join(', ')}` }, { key: 'format', label: 'Vers', kind: 'text', required: true }] },
      ...(l.length ? [{ kind: 'list' as const, onglet: A, title: 'Vidéos par lot', items: l.slice(-12).map((j) => ({ title: basename(j.src), detail: j.err ?? (j.gain !== undefined ? `${j.gain} % de place gagnée` : `${j.codec}, qualité ${j.qualite}`), meta: j.state, tone: (j.state === 'fini' ? 'bon' : j.state === 'erreur' ? 'mauvais' : 'neutre') as 'bon' | 'mauvais' | 'neutre' })) }] : []),
      // ——— Outils
      { kind: 'form', onglet: O, title: 'Boîte à outils', action: 'outil', submit: 'Calculer', params: [{ key: 'nom', label: 'Outil', kind: 'select', options: Object.keys(OUTILS), default: 'empreinte' }, { key: 'entree', label: 'Entrée', kind: 'textarea', default: '' }] },
      { kind: 'table', onglet: O, title: 'Dernières conversions', columns: ['Quand', 'Quoi', 'Résultat'], rows: h.map((x) => ({ cells: [x.at.slice(0, 16).replace('T', ' '), x.what, x.ok ? (x.out ?? []).slice(0, 2).join(', ') : x.err ?? 'erreur'], tone: x.ok ? 'bon' as const : 'mauvais' as const })), empty: 'Rien encore. Dépose un fichier dans l\'onglet Convertir.' },
    ];
    return { subtitle: `${folders(ctx).length} dossier(s) · ${veilles(ctx).length} surveillé(s) · ${l.filter((j) => j.state === 'attente').length} vidéo(s) en attente`, onglets: [C, P, A, O], sections };
  },
  // La file des vidéos avance toute seule ; les dossiers de travail oubliés (arrêt brutal) sont nettoyés
  watch: { every: 30, run(ctx) {
    if (!busy) for (const j of jobs(ctx)) if (j.state === 'en cours') ctx.saveSettings({ lots: jobs(ctx).map((x) => (x.id === j.id ? { ...x, state: 'attente' as const } : x)) });
    const w = join(ctx.dir, 'travail'), old = ctx.now().getTime() - 864e5;
    try { for (const d of readdirSync(w)) if (statSync(join(w, d)).mtimeMs < old) rmSync(join(w, d), { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
    void nextJob(ctx);
    if (veilles(ctx).length) void tourDeVeille(ctx).catch(() => undefined);
  } },
};
