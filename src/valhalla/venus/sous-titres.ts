// Vénus · les sous-titres du lecteur : ceux du fichier (pistes de texte) et ceux posés à côté (.srt, .vtt, .ass, .ssa),
// toujours rendus en WebVTT SÛR. Un sous-titre reste du TEXTE : le fichier est lu réplique par réplique (temps, lignes),
// ses balises et ses blocs de style sont retirés, les chevrons qui restent sont écrits en entités, et le WebVTT servi
// est RÉÉCRIT par Odin (jamais le fichier d'origine recopié). La page l'affiche ensuite en nœuds de texte.
//
// Bornes : un fichier de plus de 2 Mo n'est pas lu, 20 000 répliques au plus, 6 lignes et 600 caractères par réplique,
// et le WebVTT écrit ne dépasse pas 2 Mo. Les balises sont retirées en UN passage (jamais une expression qui repart du
// début à chaque « < » : un fichier de 2 Mo de « <a<a<a… » figerait tout Odin pendant des minutes). Un fichier à côté
// qui est un LIEN (vers un autre endroit de la machine) n'est pas lu.
// Une piste du fichier est extraite par FFmpeg (arguments fixes, une commande à la fois, coupée au bout du délai,
// sortie bornée), puis passe par la même réécriture. Les pistes en images (PGS, DVD) ne sont pas du texte : dites
// « illisibles ici », jamais devinées. Aucun chemin de la machine ne part vers la page : chaque sous-titre a un
// identifiant court.
//
// La recherche EN LIGNE : rien n'est lu sur Internet sans un service réglé par le propriétaire. Aucun service ne peut
// encore être réglé dans Odin : la recherche regarde donc à côté du film (un fichier posé depuis le dernier scan est
// trouvé tout de suite) et dit « aucun service réglé » pour le reste.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { MagasinVenus } from './base.ts';
import { fichierDeCible } from './bibliotheque.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';
import { codeLangue, lancerCourt, pistesDe, type Sonde } from './pistes.ts';
import { videoVerifiee } from './vignettes.ts';

export const TAILLE_MAX = 2 * 1024 * 1024, REPLIQUES_MAX = 20_000;
/** Les fichiers de sous-titres qu'Odin sait lire en texte. */
export const EXT_LISIBLES = new Set(['.srt', '.vtt', '.ass', '.ssa']);
export interface Replique { debut: number; fin: number; texte: string }

// ---------------------------------------------------------------- lire (tout format → répliques de texte)
/** Les octets d'un fichier de sous-titres → du texte : UTF-8 (avec ou sans marque), UTF-16, sinon l'ancien codage d'Europe de l'Ouest. Pur. */
export function decoder(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1))); c.swap16(); return new TextDecoder('utf-16le').decode(c); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* pas de l'UTF-8 */ }
  try { return new TextDecoder('windows-1252').decode(b); } catch { return b.toString('latin1'); }
}
/** « 00:01:02,500 », « 1:02.5 », « 0:00:01.50 » → secondes ; NaN si ce n'est pas un temps. Pur. */
export function temps(t: string): number {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(t.trim()); if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] || '0').padEnd(3, '0')) / 1000;
}
/**
 * Le texte d'une réplique, sûr : balises et blocs de style retirés, caractères de commande retirés, lignes vides
 * retirées, 6 lignes et 600 caractères au plus. Les entités écrites dans le fichier (« &lt; ») restent telles quelles :
 * elles s'afficheront comme le caractère, en texte. Pur.
 */
export function texteSur(t: string, ass = false): string {
  const sansStyle = sansBlocs(t.length > BRUT_MAX ? t.slice(0, BRUT_MAX) : t, ass ? '{' : '{\\', '}');
  return sansBlocs(sansBlocs(sansStyle, '<!--', '-->'), '<', '>', debutDeBalise)
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u2028\u2029\u0085]/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b\ufeff]/g, '')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6).join('\n').slice(0, 600);
}
/** Ce qu'une réplique peut porter de texte brut avant nettoyage (bien plus que les 600 caractères gardés). */
const BRUT_MAX = 8000;
/**
 * Retire chaque morceau « debut … fin » d'un texte, en UN passage : dès qu'il ne reste plus de « fin », plus rien n'est
 * cherché (le reste est gardé tel quel, ses chevrons deviendront des entités). `ouvre` : ce morceau est-il bien un
 * début (une balise commence par une lettre) ? Pur.
 */
function sansBlocs(t: string, debut: string, fin: string, ouvre?: (t: string, apres: number) => boolean): string {
  let out = '', i = 0;
  for (;;) {
    const a = t.indexOf(debut, i); if (a < 0) break;
    const apres = a + debut.length;
    if (ouvre && !ouvre(t, apres)) { out += t.slice(i, apres); i = apres; continue; }
    const b = t.indexOf(fin, apres); if (b < 0) break;
    out += t.slice(i, a); i = b + fin.length;
  }
  return i ? out + t.slice(i) : t;
}
const lettre = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** Après « < » : une lettre, ou « / » puis une lettre (« <i> », « </font> ») ; « 1 < 2 » n'est pas une balise. */
const debutDeBalise = (t: string, k: number) => lettre(t.charCodeAt(t.charCodeAt(k) === 47 ? k + 1 : k));
/** Un dessin ASS (« {\\p1} ») dans cette réplique ? En un passage. Pur. */
function estDessin(corps: string): boolean {
  for (let i = corps.indexOf('{'); i >= 0;) {
    const f = corps.indexOf('}', i + 1), bloc = corps.slice(i + 1, f < 0 ? Math.min(corps.length, i + 1 + BRUT_MAX) : f);
    if (/\\p[1-9]/.test(bloc)) return true;
    if (f < 0) return false;
    i = corps.indexOf('{', f + 1);
  }
  return false;
}
function blocs(texte: string): Replique[] {
  const out: Replique[] = [];
  for (const bloc of texte.split(/\n{2,}/)) {
    const lignes = bloc.split('\n'), i = lignes.findIndex((l) => l.includes('-->')); if (i < 0) continue;
    const [a, b] = lignes[i].split('-->'), debut = temps(a), fin = temps(String(b ?? '').trim().split(/\s+/)[0] ?? '');
    const t = texteSur(lignes.slice(i + 1).join('\n'));
    if (t && Number.isFinite(debut) && Number.isFinite(fin) && fin >= debut) out.push({ debut, fin, texte: t });
    if (out.length >= REPLIQUES_MAX) break;
  }
  return out;
}
const FORMAT_ASS = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
function ass(texte: string): Replique[] {
  const out: Replique[] = []; let format = FORMAT_ASS, dedans = false;
  for (const brute of texte.split('\n')) {
    const l = brute.trim();
    if (/^\[.*\]$/.test(l)) { dedans = /^\[events\]$/i.test(l); continue; }
    if (!dedans) continue;
    if (/^format\s*:/i.test(l)) { format = l.slice(l.indexOf(':') + 1).split(',').map((x) => x.trim().toLowerCase()); continue; }
    const m = /^dialogue\s*:\s*(.*)$/i.exec(l); if (!m) continue;
    const n = format.length, iD = format.indexOf('start'), iF = format.indexOf('end'), champs = m[1].split(',');
    if (format[n - 1] !== 'text' || iD < 0 || iF < 0 || champs.length < n) continue;
    const corps = champs.slice(n - 1).join(',');
    if (estDessin(corps)) continue; // un dessin, pas une réplique
    const debut = temps(champs[iD]), fin = temps(champs[iF]), t = texteSur(corps.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '), true);
    if (t && Number.isFinite(debut) && Number.isFinite(fin) && fin >= debut) out.push({ debut, fin, texte: t });
    if (out.length >= REPLIQUES_MAX) break;
  }
  return out;
}
/** Un fichier de sous-titres (son texte, son extension) → ses répliques, triées. Format inconnu : aucune. Pur. */
export function lireSousTitres(texte: string, ext: string): Replique[] {
  const t = texte.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, ''), e = ext.toLowerCase();
  const r = e === '.ass' || e === '.ssa' ? ass(t) : e === '.srt' || e === '.vtt' ? blocs(t) : [];
  return r.sort((a, b) => a.debut - b.debut);
}
const d2 = (n: number) => String(n).padStart(2, '0');
const horaire = (s: number) => { const ms = Math.max(0, Math.round(s * 1000)); return `${d2(Math.floor(ms / 3600000))}:${d2(Math.floor(ms / 60000) % 60)}:${d2(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`; };
/** Dans le WebVTT servi, tout chevron est une entité : aucune balise ne peut y être lue. Pur. */
const entites = (t: string) => t.replace(/&(?!(?:amp|lt|gt);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Les répliques → le WebVTT d'Odin (seulement des temps et du texte). Pur. */
export function ecrireVtt(r: Replique[]): string {
  const parts: string[] = []; let n = 0;
  for (const c of r) {
    const p = `${horaire(c.debut)} --> ${horaire(c.fin)}\n${entites(c.texte)}\n`;
    if ((n += p.length + 1) > TAILLE_MAX) break; // 2 Mo de « & » en feraient 10 : le texte écrit est borné lui aussi
    parts.push(p);
  }
  return `WEBVTT\n\n${parts.join('\n')}`;
}
/** Le contenu d'un fichier de sous-titres → WebVTT sûr (vide s'il est trop gros, illisible ou d'un format inconnu). Pur. */
export function versVttSur(octets: Buffer, ext: string): string {
  if (octets.length > TAILLE_MAX) return ecrireVtt([]);
  return ecrireVtt(lireSousTitres(decoder(octets), ext));
}

// ---------------------------------------------------------------- trouver (dans le fichier, à côté)
export interface SousTitreListe { /** identifiant court (jamais un chemin) */ id: string; lang: string; title: string; forced: boolean; /** du texte qu'Odin sait servir */ lisible: boolean; /** « fichier » : dans la vidéo ; « cote » : posé à côté */ source: 'fichier' | 'cote' }
interface ACote { id: string; fichier: string; langue: string; force: boolean; ext: string }
const idCote = (nom: string) => `c${createHash('sha256').update(nom.normalize('NFC').toLowerCase(), 'utf8').digest('hex').slice(0, 16)}`;
/**
 * Ce nom est-il un VRAI fichier de ce dossier ? Ni un lien (il mènerait ailleurs sur la machine : son contenu partirait
 * vers la page), ni un fichier dont le chemin réel sort du dossier réel. Le dossier lui-même peut être un lien ou une
 * jonction (une médiathèque peut en être une) : c'est son contenu réel qui compte.
 */
export function fichierDuDossier(dir: string, nom: string): boolean {
  try {
    const f = join(dir, nom); if (!lstatSync(f).isFile()) return false;
    const a = dirname(realpathSync.native(f)), b = realpathSync.native(dir);
    return a === b || (process.platform === 'win32' && a.toLowerCase() === b.toLowerCase());
  } catch { return false; }
}
/**
 * Les sous-titres posés à côté d'une vidéo, relus à l'instant : même dossier, même nom que la vidéo, puis rien ou un
 * suffixe (« Film.fr.srt », « Film.en.forced.ass »). La langue est le premier code de 2 ou 3 lettres du suffixe.
 */
export function sousTitresACote(chemin: string): ACote[] {
  const dir = dirname(chemin), base = basename(chemin, extname(chemin)).normalize('NFC').toLowerCase();
  let noms: string[]; try { noms = readdirSync(dir); } catch { return []; }
  const out: ACote[] = [];
  for (const nom of noms.sort((a, b) => a.localeCompare(b))) {
    const ext = extname(nom).toLowerCase(); if (!EXT_LISIBLES.has(ext)) continue;
    const sans = nom.slice(0, nom.length - ext.length).normalize('NFC').toLowerCase(); if (!sans.startsWith(base)) continue;
    const suffixe = sans.slice(base.length); if (suffixe && !/^[._ -]/.test(suffixe)) continue;
    if (!fichierDuDossier(dir, nom)) continue;
    try { const st = statSync(join(dir, nom)); if (!st.isFile() || st.size === 0 || st.size > TAILLE_MAX) continue; } catch { continue; }
    const mots = suffixe.split(/[._ -]+/).filter(Boolean);
    out.push({ id: idCote(nom), fichier: join(dir, nom), langue: mots.map((m) => (/^(sdh|cc)$/.test(m) ? '' : codeLangue(m))).find(Boolean) ?? '', force: mots.some((m) => /^forc/.test(m)), ext });
    if (out.length >= 60) break;
  }
  return out;
}
/** Tous les sous-titres d'une cible : les pistes de la vidéo (lues par ffprobe), puis les fichiers posés à côté. */
export function listeSousTitres(mag: MagasinVenus, cibleId: string, sonde: Sonde): SousTitreListe[] {
  const v = videoVerifiee(mag, cibleId);
  const dedans: SousTitreListe[] = sonde.sousTitres.map((s) => ({ id: `i${s.index}`, lang: s.langue, title: s.titre, forced: s.force, lisible: s.texte, source: 'fichier' }));
  const cote: SousTitreListe[] = (v ? sousTitresACote(v.chemin) : []).map((c) => ({ id: c.id, lang: c.langue, title: c.ext.slice(1).toUpperCase(), forced: c.force, lisible: true, source: 'cote' }));
  return [...dedans, ...cote].slice(0, 100);
}
/** Le sous-titre à servir pour une langue voulue (l'ancienne adresse « ?lang= ») : cette langue, sinon le français, sinon le premier lisible. Pur. */
export function idPourLangue(liste: SousTitreListe[], langue: string): string | undefined {
  const l = liste.filter((x) => x.lisible), v = langue.toLowerCase();
  return ((v && l.find((x) => x.lang.startsWith(v))) || l.find((x) => /^fr/.test(x.lang)) || l[0])?.id;
}

// ---------------------------------------------------------------- servir
/** Les arguments de FFmpeg pour écrire UNE piste de sous-titres en WebVTT vers le tuyau. Pur. */
export const argsExtraction = (chemin: string, index: number): string[] => ['-hide_banner', '-loglevel', 'error', '-nostdin', ...entreeFfmpeg('video'), '-i', chemin, '-map', `0:${Math.max(0, Math.trunc(index))}`, '-vn', '-an', '-dn', '-f', 'webvtt', 'pipe:1'];
export interface VttServi { vtt: string; /** l'extraction a été coupée avant la fin : le début seulement */ partiel?: boolean }
// Une extraction réussie est gardée (6 au plus). Une extraction coupée (début seulement) ou ratée est gardée cinq
// minutes : redemander la même piste en rafale ne relance pas FFmpeg (90 s de lecture du disque à chaque fois).
const extraits = new Map<string, VttServi & { quand?: number }>(), extraitsEnVol = new Map<string, Promise<VttServi>>();
const REESSAI_MS = 5 * 60_000;
/** (essais) oublier les sous-titres extraits. */
export function oublierSousTitres(): void { extraits.clear(); extraitsEnVol.clear(); }
/**
 * Le WebVTT sûr d'un sous-titre d'une cible, par son identifiant (« i<n> » : la piste n de la vidéo ; « c… » : un
 * fichier à côté). Rien si l'identifiant n'est pas dans la liste de CETTE cible (on ne sert jamais un autre fichier).
 */
export async function vttDe(mag: MagasinVenus, cibleId: string, id: string): Promise<VttServi | undefined> {
  const v = videoVerifiee(mag, cibleId); if (!v) return undefined;
  if (/^c[a-f0-9]{16}$/.test(id)) {
    const c = sousTitresACote(v.chemin).find((x) => x.id === id); if (!c) return undefined;
    try { return { vtt: versVttSur(readFileSync(c.fichier), c.ext) }; } catch { return undefined; }
  }
  const m = /^i(\d{1,3})$/.exec(id); if (!m) return undefined;
  const piste = (await pistesDe(mag, cibleId)).sousTitres.find((s) => s.index === Number(m[1])); if (!piste || !piste.texte) return undefined;
  const cle = `${v.chemin}|${v.taille}|${v.mtime}|${piste.index}`, garde = extraits.get(cle);
  if (garde && (garde.quand === undefined || Date.now() - garde.quand < REESSAI_MS)) return { vtt: garde.vtt, ...(garde.partiel ? { partiel: true } : {}) };
  // Deux demandes en même temps pour la même piste : une seule extraction.
  let p = extraitsEnVol.get(cle);
  if (!p) {
    // Une longue vidéo se lit en entier pour en sortir les sous-titres : 90 s au plus, puis ce qui a été lu est servi.
    p = lancerCourt('ffmpeg', argsExtraction(v.chemin, piste.index), { delaiMs: 90_000, maxOctets: TAILLE_MAX }, 'lourd').then((r) => {
      const out: VttServi = !r.ok && !r.coupe ? { vtt: ecrireVtt([]) } : { vtt: ecrireVtt(lireSousTitres(r.sortie.toString('utf8'), '.vtt')), ...(r.coupe ? { partiel: true } : {}) };
      // Refusée parce que trop de commandes attendent : rien n'est retenu, la prochaine demande réessaiera.
      if (!r.refuse) { extraits.delete(cle); extraits.set(cle, r.ok ? out : { ...out, quand: Date.now() }); while (extraits.size > 6) extraits.delete(extraits.keys().next().value as string); }
      return out;
    }).finally(() => extraitsEnVol.delete(cle));
    extraitsEnVol.set(cle, p);
  }
  return p;
}
/** Un fichier de sous-titres noté par le scan pour cette cible (l'ancienne adresse) : lu et réécrit, comme les autres. */
export function vttDuFichierNote(mag: MagasinVenus, cibleId: string, fichier: string): string | undefined {
  const c = fichierDeCible(mag, cibleId); if (!c?.sousTitres?.some((x) => x.fichier === fichier)) return undefined;
  if (!fichierDuDossier(dirname(fichier), basename(fichier))) return undefined; // un lien vers ailleurs n'est pas lu
  try { const st = statSync(fichier); if (!st.isFile() || st.size > TAILLE_MAX) return undefined; return versVttSur(readFileSync(fichier), extname(fichier)); } catch { return undefined; }
}

// ---------------------------------------------------------------- chercher
export interface RechercheSousTitres { subs: SousTitreListe[]; enLigne: { regle: boolean; texte: string } }
/** Ce qu'Odin dit de la recherche en ligne : aucun service n'est réglé (et aucun ne peut l'être encore). */
export const AUCUN_SERVICE = 'Aucun service de sous-titres n’est réglé dans Odin : rien n’est cherché sur Internet. Posez un fichier .srt, .vtt ou .ass à côté de la vidéo, avec le même nom (par exemple « Titre.fr.srt ») : Odin le trouve ici, sans nouveau scan.';
/** « Chercher des sous-titres » : relit ce qui est dans la vidéo et à côté. Rien n'est demandé à Internet. */
export async function chercherSousTitres(mag: MagasinVenus, cibleId: string): Promise<RechercheSousTitres> {
  return { subs: listeSousTitres(mag, cibleId, await pistesDe(mag, cibleId)), enLigne: { regle: false, texte: AUCUN_SERVICE } };
}
