// Vénus · la bande-annonce d'un film : SEULEMENT un fichier posé à côté du film, servi par Odin. Rien n'est lu sur
// Internet : la page de Vénus n'ouvre aucun lecteur extérieur (sa politique de contenu ne permet que ce qu'Odin sert),
// et aucun réglage du propriétaire ne l'autorise aujourd'hui. Sans fichier, la fiche garde le bouton, grisé, et dit
// pourquoi.
//
// Où Odin regarde, dans le dossier du film (noms comparés sans tenir compte des majuscules) :
//   - « <nom du film>-trailer.<ext> », « <nom du film>.trailer.<ext> », et les mêmes avec « bande-annonce » (après
//     un tiret, un point ou un tiret bas : « Le Parc Trailer.mkv » reste un film) ;
//   - « trailer.<ext> » ou « bande-annonce.<ext> », et le premier fichier d'un sous-dossier « Trailers », seulement si
//     le film est le SEUL film de son dossier (sinon on ne saurait pas à qui est la bande-annonce).
// Le scan de la bibliothèque laisse ces fichiers de côté quand leur film est bien à côté (bibliotheque.ts,
// accompagneUnFilm) : une bande-annonce rangée comme un film prendrait la place du film de même titre.
// Un fichier (ou un dossier « Trailers ») qui est un LIEN vers un autre endroit de la machine n'est pas servi : sans
// cela, un lien nommé « Titre-trailer.mp4 » ferait sortir n'importe quel fichier de la machine, tel quel.
// Le chemin ne part jamais vers la page : l'adresse ne porte que l'identifiant du titre.
import { createReadStream, lstatSync, readdirSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { basename, dirname, extname, join } from 'node:path';
import type { MagasinVenus } from './base.ts';
import { EXT_VIDEO } from './bibliotheque.ts';
import { lireRange, planLecture } from './lecture.ts';
import { argsConversion, diffuser, ffmpegLa } from './pistes.ts';
import { fichierDuDossier } from './sous-titres.ts';
import { videoVerifiee } from './vignettes.ts';

const MOT = '(?:trailer|bande[-_.]?annonce)';
const SEULE = new RegExp(`^${MOT}$`, 'i'), SUFFIXE = new RegExp(`[-_.]${MOT}$`, 'i');
const sansExt = (nom: string) => nom.slice(0, nom.length - extname(nom).length);
const estVideo = (nom: string) => EXT_VIDEO.has(extname(nom).toLowerCase());
/** Ce nom de fichier est-il celui d'une bande-annonce ? Pur. */
export const nomDeBandeAnnonce = (nom: string): boolean => estVideo(nom) && (SEULE.test(sansExt(nom)) || SUFFIXE.test(sansExt(nom)));
/** Un vrai fichier de ce dossier (pas un lien vers ailleurs), non vide. */
const fichierPlein = (dir: string, nom: string): boolean => { try { return fichierDuDossier(dir, nom) && statSync(join(dir, nom)).size > 0; } catch { return false; } };
/** Un vrai sous-dossier (ni lien, ni jonction). */
const vraiDossier = (d: string): boolean => { try { return lstatSync(d).isDirectory(); } catch { return false; } };
const lister = (dir: string): string[] => { try { return readdirSync(dir).sort((a, b) => a.localeCompare(b)); } catch { return []; } };
/** Le fichier de bande-annonce posé à côté d'un film (son chemin complet), ou rien. */
export function bandeAnnonceLocale(film: string): string | undefined {
  const dir = dirname(film), base = sansExt(basename(film)).normalize('NFC').toLowerCase(), noms = lister(dir);
  const videos = noms.filter(estVideo);
  const aLui = videos.find((n) => { const s = sansExt(n).normalize('NFC').toLowerCase(); return s.startsWith(base) && SUFFIXE.test(s) && s.replace(SUFFIXE, '') === base; });
  if (aLui && fichierPlein(dir, aLui)) return join(dir, aLui);
  // « trailer.mp4 » ou un dossier « Trailers » : seulement si ce film est le seul film du dossier.
  if (videos.filter((n) => !nomDeBandeAnnonce(n)).length !== 1) return undefined;
  const seule = videos.find((n) => SEULE.test(sansExt(n)));
  if (seule && fichierPlein(dir, seule)) return join(dir, seule);
  const sous = noms.find((n) => /^(trailers?|bandes?-annonces?)$/i.test(n));
  if (sous && vraiDossier(join(dir, sous))) { const d = join(dir, sous), premier = lister(d).find((n) => estVideo(n) && fichierPlein(d, n)); if (premier) return join(d, premier); }
  return undefined;
}
/** Le fichier de bande-annonce d'un titre de la bibliothèque (un film), ou rien. */
function fichierDe(mag: MagasinVenus, oeuvreId: string): string | undefined {
  const o = mag.get('oeuvres', oeuvreId); if (!o || o.data.type !== 'film') return undefined;
  const v = videoVerifiee(mag, oeuvreId); if (!v) return undefined;
  const f = bandeAnnonceLocale(v.chemin);
  return f && f !== v.chemin ? f : undefined;
}
export const SANS_BANDE_ANNONCE = 'Pas de bande-annonce : posez-en une à côté du film (même nom, puis « -trailer », par exemple « Titre-trailer.mp4 »). Odin n’en lit aucune sur Internet : aucun réglage ne le permet.';
export const SANS_BANDE_ANNONCE_SERIE = 'Pas de bande-annonce pour une série pour l’instant. Odin n’en lit aucune sur Internet : aucun réglage ne le permet.';
/** Ce que la fiche montre : la bande-annonce locale est là, ou pourquoi le bouton est grisé. Jamais un chemin. */
export function etatBandeAnnonce(mag: MagasinVenus, oeuvreId: string): { local: boolean; raison?: string } {
  if (mag.get('oeuvres', oeuvreId)?.data.type === 'serie') return { local: false, raison: SANS_BANDE_ANNONCE_SERIE };
  return fichierDe(mag, oeuvreId) ? { local: true } : { local: false, raison: SANS_BANDE_ANNONCE };
}
/** Sert la bande-annonce d'un titre : telle quelle si le navigateur la lit (avec l'en-tête Range), sinon convertie (une conversion à la fois). */
export async function servirBandeAnnonce(res: ServerResponse, mag: MagasinVenus, oeuvreId: string, o: { range?: string; cle: string }): Promise<boolean> {
  const json = (code: number, error: string) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify({ error })); return true; };
  const f = fichierDe(mag, oeuvreId); if (!f) return json(404, SANS_BANDE_ANNONCE);
  const plan = planLecture({ chemin: f, type: 'video' });
  if (plan.mode === 'direct') {
    let taille: number; try { taille = statSync(f).size; } catch { return json(404, SANS_BANDE_ANNONCE); }
    const { debut, fin, partiel } = lireRange(o.range, taille);
    res.writeHead(partiel ? 206 : 200, { 'content-type': plan.mime, 'accept-ranges': 'bytes', 'content-length': String(fin - debut + 1), ...(partiel ? { 'content-range': `bytes ${debut}-${fin}/${taille}` } : {}), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    // Un fichier retiré ou tenu pendant l'envoi : la réponse est fermée, l'erreur ne remonte pas dans Odin.
    createReadStream(f, { start: debut, end: fin }).on('error', () => { try { res.destroy(); } catch { /* déjà fermée */ } }).pipe(res); return true;
  }
  if (!(await ffmpegLa())) return json(503, 'Cette bande-annonce est dans un format que le navigateur ne lit pas, et FFmpeg est introuvable pour Odin.');
  const r = diffuser(res, o.cle, argsConversion(f));
  return r ? json(r.code, r.error) : true;
}
