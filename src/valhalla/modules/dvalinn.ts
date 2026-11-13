// Alchimie · la conversion de fichiers et les PDF (idées de VERT, Frame, BentoPDF, Stirling-PDF, IT-Tools et Tdarr,
// réécrites pour Odin, aucun code copié). Tout se fait sur la machine d'Odin avec les outils libres installés
// (ffmpeg, ImageMagick, LibreOffice, pandoc, qpdf, Poppler, Ghostscript, OCRmyPDF, Calibre) : rien n'est envoyé dehors.
//   - convertir : vidéo, son, image, document, tableur, présentation, texte, PDF, livre ;
//   - PDF : fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger / retirer un mot de passe,
//     images → PDF, nettoyer les informations cachées ;
//   - vidéos par lot (comme Tdarr) : un dossier entier recompressé, une vidéo à la fois, en arrière-plan ;
//   - boîte à outils (comme IT-Tools) : empreintes, Base64, JWT, horodatage, JSON, sous-réseau, couleurs…
// Les fichiers sont pris dans les dossiers que tu donnes à Alchimie (l'atelier par défaut). Un résultat est
// toujours écrit à côté de l'original sous un nouveau nom : rien n'est jamais écrasé ni effacé.
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cleanRel, freeName, inside } from '../skidbladnir/store.ts';
import { extOf, familyOf, pdfPlan, plan, qpdfSecretArgs, TARGETS, type Opts, type PdfOp, type Step } from '../dvalinn/plan.ts';
import { OUTILS, outil } from '../dvalinn/outils.ts';
import type { ModCtx, Module, Section } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
export interface Folder { nom: string; chemin: string }
interface Job { id: string; src: string; codec: 'h264' | 'h265' | 'av1'; qualite: 'haute' | 'normale' | 'legere'; hauteur?: number; state: 'attente' | 'en cours' | 'fini' | 'erreur'; out?: string; err?: string; gain?: number; at: string }
interface Hist { at: string; what: string; ok: boolean; out?: string[]; err?: string }

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
export const folders = (ctx: ModCtx): Folder[] => [{ nom: 'atelier', chemin: atelier(ctx) }, ...(((ctx.settings.dossiers as Folder[] | undefined) ?? []).filter((f) => f.nom !== 'atelier'))];
/** « dossier:chemin/fichier » (ou « chemin » dans l'atelier) → chemin absolu vérifié. */
export function resolveFile(ctx: ModCtx, ref: string): { abs: string; folder: Folder; rel: string } {
  const m = /^([\w.-]{1,40}):(.*)$/.exec(s(ref)), name = m ? m[1] : 'atelier', rel = cleanRel(m ? m[2] : s(ref));
  const folder = folders(ctx).find((f) => f.nom === name); if (!folder) throw new Error(`dossier inconnu : ${name} (${folders(ctx).map((f) => f.nom).join(', ')})`);
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

const QUAL = ['normale', 'haute', 'legere'];
const optsOf = (i: Record<string, unknown>): Opts => ({
  qualite: (QUAL.includes(s(i.qualite)) ? s(i.qualite) : 'normale') as Opts['qualite'],
  ...(Number(i.largeur) > 0 ? { largeur: Math.min(8000, Number(i.largeur)) } : {}), ...(Number(i.hauteur) > 0 ? { hauteur: Math.min(8000, Number(i.hauteur)) } : {}),
  ...(['h264', 'h265', 'av1'].includes(s(i.codec)) ? { codec: s(i.codec) as Opts['codec'] } : {}),
  ...(i.sans_son === true || i.sans_son === 'true' ? { sansSon: true } : {}), ...(s(i.debut) ? { debut: s(i.debut) } : {}), ...(s(i.duree) ? { duree: s(i.duree) } : {}),
});

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
  does: ['convertir vidéo, son, image, document, tableur, présentation, texte, PDF, livre numérique', 'vidéo : MP4, MKV, WebM, GIF animé, extraire le son, couper un passage, réduire la taille', 'image : PNG, JPG, WebP, AVIF, HEIC, icône, redimensionner', 'documents : Word, Excel, PowerPoint, OpenDocument, Markdown, HTML ↔ PDF', 'PDF : fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger par mot de passe, retirer un mot de passe, images → PDF, effacer les informations cachées', 'PDF → texte, PDF → images, texte reconnu (OCR) en PDF/A', 'vidéos par lot : tout un dossier recompressé en H.265 ou AV1, en arrière-plan, gain affiché', 'boîte à outils : empreintes, Base64, URL, UUID, JWT, horodatage, JSON, mot de passe, sous-réseau, couleurs, texte', 'rien n\'est envoyé hors de la machine, rien n\'est écrasé : le résultat est écrit à côté'],
  from: ['VERT', 'Frame', 'BentoPDF', 'Stirling-PDF', 'IT-Tools', 'Tdarr'], upstream: ['VERT-sh/vert', 'alam00000/bentopdf', 'Stirling-Tools/Stirling-PDF', 'CorentinTh/it-tools', 'HaveAGitGat/Tdarr'],
  words: ['convertir', 'conversion', 'convertis', 'pdf', 'fusionner des pdf', 'compresser une video', 'compresser une vidéo', 'en mp4', 'en mp3', 'en pdf', 'en jpg', 'en png', 'dvalinn', 'boite a outils', 'boîte à outils'],
  actions: [
    { id: 'outils', label: 'Outils de conversion', what: 'Les outils libres présents sur la machine, ce que chacun permet, et ceux qui manquent', read: true, words: ['outils de conversion', 'que sais tu convertir'], run: async (ctx) => {
      const l = await Promise.all(TOOLS.map(async (t) => ({ ...t, ok: (await ctx.has(t.cmd)) || (t.alt ? await ctx.has(t.alt) : false) })));
      const miss = [...new Set(l.filter((t) => !t.ok).map((t) => t.pkg))];
      return { text: [...l.map((t) => `${t.ok ? '✅' : '⬜'} ${t.cmd} · ${t.does}`), miss.length ? `Pour tout avoir : sudo apt install ${miss.join(' ')}` : 'Tout est installé.'].join('\n'), data: l };
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
    { id: 'convertir', label: 'Convertir un fichier', what: 'Vers un autre format ; le résultat est écrit à côté de l\'original', words: ['convertis le fichier', 'convertir le fichier'], params: [
      { key: 'fichier', label: 'Fichier (dossier:chemin)', kind: 'text', required: true }, { key: 'format', label: 'Vers (mp4, mp3, pdf, jpg, webp, docx…)', kind: 'text', required: true },
      { key: 'qualite', label: 'Qualité', kind: 'select', options: QUAL, default: 'normale' }, { key: 'largeur', label: 'Largeur max (images, vidéos)', kind: 'number', default: 0 }, { key: 'hauteur', label: 'Hauteur max', kind: 'number', default: 0 },
      { key: 'codec', label: 'Codec vidéo', kind: 'select', options: ['h264', 'h265', 'av1'], default: 'h264' }, { key: 'sans_son', label: 'Sans le son', kind: 'boolean', default: false },
      { key: 'debut', label: 'Début (ex. 00:01:30)', kind: 'text', default: '' }, { key: 'duree', label: 'Durée (ex. 20)', kind: 'text', default: '' },
    ], run: async (ctx, i) => {
      const f = resolveFile(ctx, s(i.fichier)); if (!existsSync(f.abs) || !statSync(f.abs).isFile()) throw new Error(`fichier introuvable : ${s(i.fichier)}`);
      const to = s(i.format).toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg'), work = workDir(ctx), t0 = Date.now();
      try {
        const st = plan(f.abs, to, work, optsOf(i));
        const out = await runStep(ctx, st, work, dirname(f.abs));
        const size = out.reduce((a, o) => a + statSync(o).size, 0);
        remember(ctx, { at: ctx.now().toISOString(), what: `${basename(f.abs)} → ${to}`, ok: true, out: out.map((o) => relOf(f.folder, o)) });
        return { text: `✅ ${basename(f.abs)} → ${out.length > 1 ? `${out.length} fichiers` : basename(out[0])} (${human(size)}, ${Math.round((Date.now() - t0) / 100) / 10} s)\n${out.slice(0, 10).map((o) => relOf(f.folder, o)).join('\n')}`, data: out };
      } catch (e) { remember(ctx, { at: ctx.now().toISOString(), what: `${basename(f.abs)} → ${to}`, ok: false, err: (e as Error).message }); throw e; } finally { rmSync(work, { recursive: true, force: true }); }
    } },
    { id: 'pdf', label: 'Outils PDF', what: 'Fusionner, extraire des pages, découper, pivoter, alléger, compresser, protéger, retirer un mot de passe, images → PDF, nettoyer', words: ['fusionne les pdf', 'protege le pdf', 'protège le pdf', 'compresse le pdf', 'decoupe le pdf', 'découpe le pdf'], params: [
      { key: 'operation', label: 'Opération', kind: 'select', options: ['fusionner', 'extraire', 'decouper', 'pivoter', 'alleger', 'compresser', 'proteger', 'deproteger', 'images_en_pdf', 'nettoyer'], default: 'fusionner' },
      { key: 'fichiers', label: 'Fichier(s) (dossier:chemin, séparés par des virgules)', kind: 'textarea', required: true },
      { key: 'pages', label: 'Pages (ex. 1-3,5,8-fin)', kind: 'text', default: '' }, { key: 'angle', label: 'Angle', kind: 'select', options: ['90', '180', '270'], default: '90' },
      { key: 'mot_de_passe', label: 'Mot de passe (protéger / retirer)', kind: 'password', default: '' }, { key: 'nom', label: 'Nom du résultat', kind: 'text', default: '' },
    ], run: async (ctx, i) => {
      const op = s(i.operation) as PdfOp, refs = s(i.fichiers).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
      const files = refs.map((r) => resolveFile(ctx, r)); if (!files.length) throw new Error('aucun fichier');
      for (const f of files) { if (!existsSync(f.abs)) throw new Error(`fichier introuvable : ${relOf(f.folder, f.abs)}`); if (op !== 'images_en_pdf' && extOf(f.abs) !== 'pdf') throw new Error(`${basename(f.abs)} n'est pas un PDF`); if (op === 'images_en_pdf' && familyOf(f.abs) !== 'image') throw new Error(`${basename(f.abs)} n'est pas une image`); }
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
        const gain = op === 'alleger' || op === 'compresser' ? ` · ${human(before)} → ${human(after)} (${Math.round((1 - after / before) * 100)} % de moins)` : '';
        return { text: `✅ ${op.replace('_', ' ')} : ${made.length} fichier(s)${gain}\n${made.slice(0, 20).map((m) => relOf(first.folder, m)).join('\n')}`, data: made };
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
    const h = ((ctx.settings.historique as Hist[] | undefined) ?? []).slice(0, 15), l = jobs(ctx);
    const sections: Section[] = [
      { kind: 'form', title: 'Convertir un fichier', action: 'convertir', submit: 'Convertir', params: [{ key: 'fichier', label: 'Fichier (dossier:chemin)', kind: 'text', required: true }, { key: 'format', label: 'Vers', kind: 'text', required: true, help: Object.entries(TARGETS).map(([k, v]) => `${k} → ${v.join(', ')}`).join(' · ') }, { key: 'qualite', label: 'Qualité', kind: 'select', options: QUAL, default: 'normale' }] },
      { kind: 'form', title: 'Outils PDF', action: 'pdf', submit: 'Lancer', params: [{ key: 'operation', label: 'Opération', kind: 'select', options: ['fusionner', 'extraire', 'decouper', 'pivoter', 'alleger', 'compresser', 'proteger', 'deproteger', 'images_en_pdf', 'nettoyer'], default: 'fusionner' }, { key: 'fichiers', label: 'Fichier(s)', kind: 'textarea', required: true }, { key: 'pages', label: 'Pages', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe', kind: 'password', default: '' }] },
      { kind: 'table', title: 'Dernières conversions', columns: ['Quand', 'Quoi', 'Résultat'], rows: h.map((x) => ({ cells: [x.at.slice(0, 16).replace('T', ' '), x.what, x.ok ? (x.out ?? []).slice(0, 2).join(', ') : x.err ?? 'erreur'], tone: x.ok ? 'bon' as const : 'mauvais' as const })), empty: 'Rien encore. Dépose un fichier dans l\'atelier (ou donne un dossier) et convertis-le.' },
      ...(l.length ? [{ kind: 'list' as const, title: 'Vidéos par lot', items: l.slice(-12).map((j) => ({ title: basename(j.src), detail: j.err ?? (j.gain !== undefined ? `${j.gain} % de place gagnée` : `${j.codec}, qualité ${j.qualite}`), meta: j.state, tone: (j.state === 'fini' ? 'bon' : j.state === 'erreur' ? 'mauvais' : 'neutre') as 'bon' | 'mauvais' | 'neutre' })) }] : []),
    ];
    return { subtitle: `${folders(ctx).length} dossier(s) · ${l.filter((j) => j.state === 'attente').length} vidéo(s) en attente`, sections, side: [{ kind: 'form', title: 'Boîte à outils', action: 'outil', submit: 'Calculer', params: [{ key: 'nom', label: 'Outil', kind: 'select', options: Object.keys(OUTILS), default: 'empreinte' }, { key: 'entree', label: 'Entrée', kind: 'textarea', default: '' }] }] };
  },
  // La file des vidéos avance toute seule ; les dossiers de travail oubliés (arrêt brutal) sont nettoyés
  watch: { every: 30, run(ctx) {
    if (!busy) for (const j of jobs(ctx)) if (j.state === 'en cours') ctx.saveSettings({ lots: jobs(ctx).map((x) => (x.id === j.id ? { ...x, state: 'attente' as const } : x)) });
    const w = join(ctx.dir, 'travail'), old = ctx.now().getTime() - 864e5;
    try { for (const d of readdirSync(w)) if (statSync(join(w, d)).mtimeMs < old) rmSync(join(w, d), { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
    void nextJob(ctx);
  } },
};
