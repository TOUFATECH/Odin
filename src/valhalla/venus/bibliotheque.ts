// Vénus · Odéon — la bibliothèque native (sans serveur extérieur). Parcourt les dossiers média déclarés, lit chaque
// fichier avec ffprobe (durée, résolution, codecs, pistes, sous-titres), fabrique une vignette, range les œuvres, les
// épisodes et les pistes dans la base VENUS_ODIN. Recherche, ma liste, reprise, historique (privé) et demandes.
//
// Rien n'est inventé : l'affiche vient de la vignette du fichier (ou d'une source libre SANS clé fournie par
// l'appelant), jamais d'un titre deviné. Les outils externes (ffprobe, FFmpeg) sont injectés : les essais passent un
// faux, aucun service réel n'est touché.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Collection, Enr, MagasinVenus } from './base.ts';

/** Un identifiant opaque pour les collections PRIVÉES : la clé (en clair dans le fichier) ne révèle rien. Pur. */
const idOpaque = (): string => randomBytes(12).toString('hex');

export type TypeOeuvre = 'film' | 'serie' | 'album' | 'livre_audio' | 'livre' | 'chaine';
export type Categorie = 'films' | 'series' | 'musique' | 'livres_audio';

export const EXT_VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv', '.flv']);
export const EXT_AUDIO = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma']);
const EXT_SOUS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

/**
 * Un caractère gardé par la recherche en plus de a-z et 0-9 : une lettre, un chiffre ou un signe qui fait partie d'une
 * lettre, d'une écriture autre que latine (japonais, arabe, cyrillique, grec, hindi…). Les caractères latins hors a-z
 * (ß, lettres pleine chasse, chiffres romains) et ceux communs à toutes les écritures (chiffres pleine chasse, exposants)
 * restent effacés comme avant : un titre latin se compare exactement comme avant. Aucune table propre à une langue.
 */
const AUTRE_ECRITURE = /[\p{L}\p{N}\p{M}]/u, LATIN_OU_COMMUN = /[\p{scx=Latin}\p{scx=Common}\p{scx=Inherited}]/u;
const garde = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (AUTRE_ECRITURE.test(c) && !LATIN_OU_COMMUN.test(c));
/** Le titre en minuscules, sans les accents (diacritiques combinants), recomposé (が, 한 restent entiers). Pur. */
const aPlat = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
/** La forme d'avant (a-z0-9 seulement) : elle fait encore l'identifiant d'un titre latin, qui ne change pas. Pur. */
const normLatin = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Normalise un titre pour comparer/chercher, dans toutes les écritures : minuscules là où la casse existe, sans accents
 * là où il y en a, sans signes entre les mots ; aucune lettre d'une autre écriture n'est effacée. Pour un titre latin, le
 * résultat est exactement celui d'avant. Pur.
 */
export function norm(t: string): string {
  let o = '', sep = false;
  for (const c of aPlat(t)) { if (garde(c)) { if (sep && o) o += ' '; o += c; sep = false; } else sep = true; }
  return o;
}
/**
 * Un identifiant court et stable à partir d'un texte (pour les clés d'œuvres), écrit seulement en a-z, 0-9 et « - ».
 * Tout titre dont l'ancienne forme (a-z0-9) donne un identifiant le garde EXACTEMENT, qu'il soit latin ou mêlé à une
 * autre écriture (« 霧 Brume » reste « brume ») : sa reprise, ses « vus » et le bouton « Lire » en dépendent. Deux titres
 * mêlés de même partie latine partagent donc un identifiant, comme avant.
 * Seul un titre que l'ancienne forme laissait vide (« sans-titre ») reçoit « u-- » et l'empreinte SHA-256 du titre
 * entier (minuscules, forme NFC, signes entre les mots réduits à une espace) — la même sur toute machine, différente
 * pour deux titres différents ; le « -- » n'apparaît jamais dans un identifiant latin, les deux ne se mêlent pas. « sans-titre » : seulement un titre sans aucune lettre, aucun chiffre ni symbole. Pur.
 */
export function slug(t: string): string {
  const latin = normLatin(t);
  if (latin) return latin.replace(/\s+/g, '-').slice(0, 80);
  const cle = t.normalize('NFC').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\p{S}]+/gu, ' ').trim();
  return cle ? `u--${createHash('sha256').update(cle, 'utf8').digest('hex').slice(0, 40)}` : 'sans-titre';
}
/** Un identifiant posé par l'ancienne forme pour un titre qu'elle ne savait pas lire : il a pu mêler plusieurs œuvres. */
const ANCIEN_SANS_TITRE = /:sans-titre(?:-\d{4})?$/;

/** Ce qu'un nom de fichier dit d'un média. Pur, testable. */
export interface NomLu { titre: string; annee?: number; saison?: number; episode?: number }
const NETTOYER = /\b(1080p|2160p|720p|480p|4k|uhd|bluray|blu-ray|web-?dl|webrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|multi|vostfr|vff?|truefrench|french|english|dvdrip)\b/gi;
/** Lit un nom de fichier média : titre, année, saison et épisode (SxxExx, 1x02, « Saison 2 »). Pur. */
export function analyserNom(nom: string): NomLu {
  const base = nom.replace(extname(nom), '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  let m = /^(.*?)[\s.\-]*[Ss](\d{1,2})[\s.\-]*[EeXx](\d{1,4})/.exec(base) ?? /^(.*?)[\s.\-]+(\d{1,2})x(\d{1,4})\b/.exec(base);
  if (m) return { titre: titrePropre(m[1]), saison: Number(m[2]), episode: Number(m[3]) };
  const an = /\b(19\d{2}|20\d{2})\b/.exec(base);
  const titre = titrePropre(an ? base.slice(0, an.index) : base);
  return { titre: titre || titrePropre(base), ...(an ? { annee: Number(an[1]) } : {}) };
}
// La parenthèse ou le crochet ouvert avant l'année (« Titre (2001) ») part aussi : sinon le titre finit par « ( ».
function titrePropre(t: string): string { return t.replace(NETTOYER, ' ').replace(/[\s.\-_([{]+$/, '').replace(/\s+/g, ' ').trim(); }

/**
 * Lit une DEMANDE (« lance-moi … ») : un titre et, s'il y est, l'épisode sous une forme chiffrée — S02E05, s2e5,
 * « S02 E05 » ou 2x05. Aucune liste de mots d'une langue ici : « saison », « épisode » et leurs équivalents sont
 * compris en amont et arrivent à part (réglages `saison` et `episode`). Pur.
 */
export function lireDemande(q: string): { titre: string; saison?: number; episode?: number } {
  const t = String(q ?? '').replace(/\s+/g, ' ').trim();
  // La forme chiffrée peut être entre parenthèses ou crochets (« Titre (S02E05) ») : les parenthèses vides qui restent partent.
  const m = /(^|[\s.\-_([])[Ss](\d{1,2})[\s.\-]*[Ee](\d{1,4})(?=$|[\s.\-_,;!?)\]])/.exec(t) ?? /(^|[\s.\-_([])(\d{1,2})[xX](\d{1,4})(?=$|[\s.\-_,;!?)\]])/.exec(t);
  if (!m) return { titre: t };
  const titre = (t.slice(0, m.index) + m[1] + t.slice(m.index + m[0].length)).replace(/[([]\s*[)\]]/g, ' ').replace(/[\s.\-_,;]+$/, '').replace(/\s+/g, ' ').trim();
  return { titre, saison: Number(m[2]), episode: Number(m[3]) };
}

/**
 * Un épisode rangé dans un dossier « Saison N » (ou « Season N ») dont le nom ne porte QUE le numéro d'épisode :
 * « E05 », « Ep 5 », « 05 », « Titre - 05 ». La série est le dossier au-dessus de celui de la saison ; si ce dossier
 * est la racine déclarée (aucun nom de série), rien. Ne sert qu'aux noms SANS SxxExx ni 1x02 (lus comme avant). Pur.
 */
export function episodeDeDossier(chemin: string, racine?: string): { serie: string; saison: number; episode: number } | undefined {
  const dossier = dirname(chemin), s = /^(?:saison|season)[\s._-]*(\d{1,3})$/i.exec(basename(dossier).trim());
  if (!s) return undefined;
  // Le nom du dossier de la série est lu comme un nom de fichier (points en espaces, année et qualité retirées) :
  // « Serie (2020) » et « Serie.2020.1080p » donnent la même série que « Serie S01E01.mkv ». Le « .d » ajouté évite
  // qu'un point du nom (« Serie.Lumen ») soit pris pour une extension.
  const dessus = dirname(dossier), brut = basename(dessus).trim(), serie = analyserNom(`${brut}.d`).titre || brut;
  const memeChemin = (a: string, b: string) => { const n = (x: string) => resolve(x).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b); };
  if (!serie || dessus === dossier || (racine && memeChemin(dessus, racine))) return undefined;
  const base = basename(chemin, extname(chemin)).replace(/[._]+/g, ' ').replace(NETTOYER, ' ').replace(/\s+/g, ' ').trim();
  // « Titre - 05 » : seulement si « Titre » est la série elle-même (« Bonus - 01 » n'est pas l'épisode 1).
  const tiret = /^(.*?)\s-\s*(\d{1,4})$/.exec(base), tiretOk = tiret && norm(tiret[1]) === norm(serie) ? [tiret[0], tiret[2]] : null;
  const e = /(?:^|[\s-])[Ee][Pp]?\s?(\d{1,4})(?=$|[\s-])/.exec(base) ?? /^(\d{1,4})$/.exec(base) ?? tiretOk;
  return e ? { serie, saison: Number(s[1]), episode: Number(e[1]) } : undefined;
}

/** Un fichier trouvé sur le disque. */
export interface FichierVu { chemin: string; taille: number; mtime: number }
/** Ce que ffprobe nous dit d'un fichier (forme simplifiée, injectable). */
export interface Probe { duree: number; largeur?: number; hauteur?: number; codecs: string[]; audio: string[]; sousTitres: Array<{ langue?: string; titre?: string; index: number }> }
/** Les outils externes, injectés (faux en essai). */
export interface Outils {
  ffprobe(chemin: string): Promise<Probe | null>;
  /** fabrique une vignette (rend le chemin produit, ou rien) */
  vignette?(chemin: string, duree: number): Promise<string | undefined>;
  /** affiche depuis une source LIBRE sans clé (rend une URL, ou rien) ; jamais inventée */
  affiche?(lu: NomLu, type: TypeOeuvre): Promise<string | undefined>;
  /** parcourt un dossier (réel par défaut) */
  parcourir?(dossier: string): FichierVu[];
}

/** Parcourt un dossier et rend les fichiers (récursif, réel). */
export function parcourirReel(dossier: string): FichierVu[] {
  const out: FichierVu[] = [];
  const pile = [dossier];
  // Les liens et jonctions sont suivis (un dossier de films peut en être un), mais chaque dossier réel n'est lu
  // qu'une fois : un lien vers un dossier parent ne fait plus tourner le parcours sans fin.
  const vus = new Set<string>();
  while (pile.length) {
    const d = pile.pop()!;
    let reel: string; try { reel = realpathSync.native(d); } catch { continue; }
    if (vus.has(reel)) continue; vus.add(reel);
    let noms: string[]; try { noms = readdirSync(d); } catch { continue; }
    for (const n of noms) {
      if (n.startsWith('.')) continue;
      const p = join(d, n); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) pile.push(p);
      else if (st.isFile()) out.push({ chemin: p, taille: st.size, mtime: Math.trunc(st.mtimeMs) });
    }
  }
  return out;
}

const resolution = (p: Probe): string => (p.hauteur ? `${p.hauteur}p` : '');
const estVideo = (c: string) => EXT_VIDEO.has(extname(c).toLowerCase());
const estAudio = (c: string) => EXT_AUDIO.has(extname(c).toLowerCase());

/** Les sous-titres à côté du fichier (même nom, extension .srt/.vtt…). Pur à partir de la liste. */
export function sousTitresVoisins(chemin: string, tous: FichierVu[]): Array<{ langue?: string; fichier: string }> {
  const sansExt = chemin.slice(0, chemin.length - extname(chemin).length);
  return tous.filter((f) => EXT_SOUS.has(extname(f.chemin).toLowerCase()) && f.chemin.startsWith(sansExt))
    .map((f) => { const reste = f.chemin.slice(sansExt.length, f.chemin.length - extname(f.chemin).length); const l = /([a-z]{2,3})$/i.exec(reste.replace(/[._-]+$/, '')); return { ...(l ? { langue: l[1].toLowerCase() } : {}), fichier: f.chemin }; });
}

/** Pourquoi un fichier (ou un dossier) n'est pas entré dans la bibliothèque : dit à l'écran, jamais tu. */
export type RaisonIgnore = 'dossier_introuvable' | 'pas_un_media' | 'illisible' | 'hors_categorie' | 'episode_sans_numero';
export const RAISONS_IGNORE: Record<RaisonIgnore, string> = {
  dossier_introuvable: "dossier introuvable sur la machine d'Odin",
  pas_un_media: 'pas une vidéo ni un son',
  illisible: 'illisible par ffprobe (fichier abîmé, ou FFmpeg absent)',
  hors_categorie: 'pas du bon genre pour la catégorie du dossier (un son dans « Films », une vidéo dans « Musique »…)',
  episode_sans_numero: 'épisode sans numéro dans son nom (il faut S01E02 ou 1x02)',
};
/** Bilan d'un scan : les comptes, et pour ce qui est laissé de côté, la raison (avec quelques noms de fichiers). */
export interface Bilan { oeuvres: number; episodes: number; pistes: number; fichiers: number; ignores: number;
  raisons: Partial<Record<RaisonIgnore, number>>; exemples: Array<{ fichier: string; raison: RaisonIgnore }>; dossiersIntrouvables: string[] }

/**
 * Scanne tous les dossiers actifs et range la bibliothèque dans le magasin. N'efface rien : met à jour.
 * Rien n'est inventé (l'affiche vient de la vignette du fichier, ou d'une source libre fournie).
 */
export async function scanner(mag: MagasinVenus, outils: Outils): Promise<Bilan> {
  const parcourir = outils.parcourir ?? parcourirReel;
  const b: Bilan = { oeuvres: 0, episodes: 0, pistes: 0, fichiers: 0, ignores: 0, raisons: {}, exemples: [], dossiersIntrouvables: [] };
  const ignorer = (fichier: string, raison: RaisonIgnore) => {
    b.ignores++; b.raisons[raison] = (b.raisons[raison] ?? 0) + 1;
    if (b.exemples.length < 12) b.exemples.push({ fichier: basename(fichier), raison });
  };
  const oeuvresVues = new Set<string>();
  for (const d of mag.liste('dossiers')) {
    const { chemin, categorie, actif } = d.data as { chemin: string; categorie: Categorie; actif?: boolean };
    if (actif === false || !chemin) continue;
    // Un dossier qui n'existe pas (débranché, mal tapé) est DIT, au lieu de rendre « 0 œuvre » sans raison.
    if (!outils.parcourir && !dossierExiste(chemin)) { b.dossiersIntrouvables.push(chemin); b.raisons.dossier_introuvable = (b.raisons.dossier_introuvable ?? 0) + 1; continue; }
    const tous = parcourir(chemin);
    for (const f of tous) {
      if (EXT_SOUS.has(extname(f.chemin).toLowerCase())) continue; // un sous-titre accompagne un média, il n'est pas rangé seul
      const r = await rangerFichier(mag, f, categorie, outils, tous, oeuvresVues, chemin);
      if ('raison' in r) { if (r.lu) b.fichiers++; ignorer(f.chemin, r.raison); continue; }
      b.fichiers++;
      if (r.nouvelleOeuvre) b.oeuvres++;
      if (r.genre === 'episode') b.episodes++; else if (r.genre === 'piste') b.pistes++;
    }
  }
  return b;
}

/** Ce que devient UN fichier : rangé (œuvre, et l'élément qui se lit), ou laissé de côté avec sa raison. */
export type Rangement = { genre: 'film' | 'episode' | 'piste'; oeuvreId: string; cibleId: string; titre: string; nouvelleOeuvre: boolean } | { raison: RaisonIgnore; /** lu par ffprobe et noté malgré tout (le scan le compte) */ lu?: true };
/**
 * Range UN fichier dans la bibliothèque (le scan, et l'import d'un média envoyé depuis un appareil). `voisins` : les
 * fichiers du même dossier (sous-titres à côté) ; `oeuvresVues` : les œuvres déjà posées pendant ce passage.
 */
export async function rangerFichier(mag: MagasinVenus, f: FichierVu, categorie: Categorie, outils: Outils, voisins: FichierVu[] = [], oeuvresVues: Set<string> = new Set(), /** le dossier déclaré (scan) : un dossier « Saison N » posé directement dedans n'a pas de nom de série */ racine?: string): Promise<Rangement> {
  const ext = extname(f.chemin).toLowerCase();
  if (!EXT_VIDEO.has(ext) && !EXT_AUDIO.has(ext)) return { raison: 'pas_un_media' };
  // Un fichier qui n'a rien à faire dans la catégorie du dossier est écarté AVANT d'appeler ffprobe.
  if (!bonGenrePour(f.chemin, categorie)) return { raison: 'hors_categorie' };
  // Un épisode sans SxxExx dans son nom, mais rangé dans « Saison N » avec son numéro (E05, 05…), est lu par son dossier.
  const parDossier = categorie === 'series' && analyserNom(basename(f.chemin)).saison === undefined ? episodeDeDossier(f.chemin, racine) : undefined;
  if (categorie === 'series' && analyserNom(basename(f.chemin)).saison === undefined && !parDossier) return { raison: 'episode_sans_numero' };
  const probe = await outils.ffprobe(f.chemin).catch(() => null);
  if (!probe) return { raison: 'illisible' };
  const lu: NomLu = parDossier ? { titre: parDossier.serie, saison: parDossier.saison, episode: parDossier.episode } : analyserNom(basename(f.chemin));
  const vignette = outils.vignette ? await outils.vignette(f.chemin, probe.duree).catch(() => undefined) : undefined;
  mag.poser('fichiers', cheminId(f.chemin), { chemin: f.chemin, taille: f.taille, mtime: f.mtime, probe });
  if (categorie === 'series' && estVideo(f.chemin) && lu.saison !== undefined) {
    const serie = lu.titre || basename(dirname(f.chemin));
    const oid = `serie:${slug(serie)}`, nouvelle = !oeuvresVues.has(oid);
    if (nouvelle) { poserOeuvre(mag, oid, { type: 'serie', titre: serie, titre_norm: norm(serie), slug: slug(serie), ...(await afficheOpt(outils, lu, 'serie', vignette)) }); oeuvresVues.add(oid); }
    const eid = `${oid}:s${lu.saison}e${lu.episode ?? 0}`;
    mag.poser('episodes', eid, { oeuvre_id: oid, saison: lu.saison, episode: lu.episode ?? 0, titre: lu.titre, fichier: f.chemin, duree: probe.duree, resolution: resolution(probe), codecs: probe.codecs, sous_titres: [...probe.sousTitres, ...sousTitresVoisins(f.chemin, voisins)], ...(vignette ? { vignette } : {}) });
    return { genre: 'episode', oeuvreId: oid, cibleId: eid, titre: serie, nouvelleOeuvre: nouvelle };
  }
  if (categorie === 'films' && estVideo(f.chemin)) {
    const oid = `film:${slug(lu.titre)}${lu.annee ? `-${lu.annee}` : ''}`;
    poserOeuvre(mag, oid, { type: 'film', titre: lu.titre, titre_norm: norm(lu.titre), slug: slug(lu.titre), annee: lu.annee, fichier: f.chemin, duree: probe.duree, resolution: resolution(probe), codecs: probe.codecs, sous_titres: [...probe.sousTitres, ...sousTitresVoisins(f.chemin, voisins)], ...(await afficheOpt(outils, lu, 'film', vignette)) });
    const nouvelle = !oeuvresVues.has(oid); if (nouvelle) oeuvresVues.add(oid);
    return { genre: 'film', oeuvreId: oid, cibleId: oid, titre: lu.titre, nouvelleOeuvre: nouvelle };
  }
  if ((categorie === 'musique' || categorie === 'livres_audio') && estAudio(f.chemin)) {
    const type: TypeOeuvre = categorie === 'musique' ? 'album' : 'livre_audio';
    const album = basename(dirname(f.chemin));
    const oid = `${type}:${slug(album)}`, nouvelle = !oeuvresVues.has(oid);
    if (nouvelle) { poserOeuvre(mag, oid, { type, titre: album, titre_norm: norm(album), slug: slug(album), ...(vignette ? { affiche: vignette } : {}) }); oeuvresVues.add(oid); }
    const num = numeroDePiste(basename(f.chemin)), pid = `${oid}:p${num}:${slug(basename(f.chemin))}`;
    mag.poser('pistes', pid, { oeuvre_id: oid, num, titre: lu.titre || basename(f.chemin, extname(f.chemin)), fichier: f.chemin, duree: probe.duree });
    return { genre: 'piste', oeuvreId: oid, cibleId: pid, titre: album, nouvelleOeuvre: nouvelle };
  }
  return { raison: 'hors_categorie', lu: true };
}
/** Le nom de ce fichier convient-il à la catégorie (vidéo pour films et séries, son pour musique et livres audio) ? Pur. */
export const bonGenrePour = (nom: string, categorie: Categorie): boolean => (categorie === 'films' || categorie === 'series' ? estVideo(nom) : estAudio(nom));
async function afficheOpt(o: Outils, lu: NomLu, type: TypeOeuvre, vignette?: string): Promise<Record<string, unknown>> {
  const url = o.affiche ? await o.affiche(lu, type).catch(() => undefined) : undefined;
  const a = url ?? vignette; return a ? { affiche: a } : {};
}
function poserOeuvre(mag: MagasinVenus, id: string, data: Record<string, unknown>): void {
  const avant = mag.get('oeuvres', id); mag.poser('oeuvres', id, { ...(avant?.data ?? {}), ...data });
}
const cheminId = (c: string) => c.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199);
const numeroDePiste = (nom: string): number => { const m = /^\s*(\d{1,3})\b/.exec(nom); return m ? Number(m[1]) : 0; };

// ---------------- Déclarer les dossiers média ----------------
const dossierExiste = (c: string): boolean => { try { return existsSync(c) && statSync(c).isDirectory(); } catch { return false; } };
/**
 * Le chemin tel que le propriétaire l'a collé, rendu propre : espaces autour retirés, et les guillemets qui l'entourent
 * (« Copier en tant que chemin » de l'Explorateur de Windows les ajoute) enlevés. Pur.
 */
export function nettoyerChemin(c: string): string {
  let t = String(c ?? '').trim();
  while (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) t = t.slice(1, -1).trim();
  return t;
}
/** Pourquoi ce dossier ne peut pas être déclaré (rien = il est bon). Lit le disque de la machine d'Odin. */
export function raisonDossierRefuse(chemin: string): string | undefined {
  if (!chemin) return "Donne le chemin d'un dossier.";
  if (!existsSync(chemin)) return `Ce dossier n'existe pas sur la machine d'Odin : ${chemin}. Vérifie le chemin (sous Windows, par exemple D:\\Films ; ailleurs, par exemple /mnt/films).`;
  try { if (!statSync(chemin).isDirectory()) return `C'est un fichier, pas un dossier : ${chemin}. Donne le dossier qui le contient.`; } catch { return `Odin ne peut pas lire ce dossier : ${chemin}.`; }
  return undefined;
}
export function ajouterDossier(mag: MagasinVenus, chemin: string, categorie: Categorie): Enr {
  return mag.poser('dossiers', cheminId(chemin), { chemin, categorie, actif: true });
}
export function retirerDossier(mag: MagasinVenus, chemin: string): boolean { return mag.retirer('dossiers', cheminId(chemin)); }
export const dossiers = (mag: MagasinVenus): Array<{ chemin: string; categorie: Categorie; actif: boolean }> =>
  mag.liste('dossiers').map((d) => ({ chemin: String(d.data.chemin), categorie: d.data.categorie as Categorie, actif: d.data.actif !== false }));

// ---------------- Recherche et lecture de la bibliothèque ----------------
export interface CarteOeuvre { id: string; type: TypeOeuvre; titre: string; annee?: number; affiche?: string; duree?: number; resolution?: string }
const carte = (e: Enr): CarteOeuvre => ({ id: e.id, type: e.data.type as TypeOeuvre, titre: String(e.data.titre ?? ''), annee: e.data.annee as number | undefined, affiche: e.data.affiche as string | undefined, duree: e.data.duree as number | undefined, resolution: e.data.resolution as string | undefined });

/** La bibliothèque, filtrée par type et/ou recherche. */
export function bibliotheque(mag: MagasinVenus, o: { type?: TypeOeuvre; q?: string } = {}): CarteOeuvre[] {
  const n = o.q ? norm(o.q) : '';
  return mag.liste('oeuvres').map(carte)
    .filter((c) => (!o.type || c.type === o.type) && (!n || n.split(' ').every((w) => norm(c.titre).includes(w))))
    .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
}
/** Les épisodes d'une série (triés). */
export const episodes = (mag: MagasinVenus, oeuvreId: string): Enr[] =>
  mag.liste('episodes').filter((e) => e.data.oeuvre_id === oeuvreId).sort((a, b) => (Number(a.data.saison) - Number(b.data.saison)) || (Number(a.data.episode) - Number(b.data.episode)));
/** Les pistes d'un album ou livre audio (triées). */
export const pistes = (mag: MagasinVenus, oeuvreId: string): Enr[] =>
  mag.liste('pistes').filter((p) => p.data.oeuvre_id === oeuvreId).sort((a, b) => Number(a.data.num) - Number(b.data.num));

/** Retrouve une œuvre par son identifiant, son titre exact ou ses mots. */
export function trouverOeuvre(mag: MagasinVenus, q: string): Enr | undefined {
  let l = mag.liste('oeuvres'); const direct = l.find((e) => e.id === q); if (direct) return direct;
  // Une requête vide (ou sans lettre ni chiffre) ne désigne rien : sinon chaque titre la « contient » et le plus court gagnait.
  const n = norm(q); if (!n) return undefined;
  // Une œuvre rangée sous « …:sans-titre » par l'ancienne forme (titre non latin) a pu mêler plusieurs œuvres : elle
  // n'est plus trouvée par son titre (le scan range l'œuvre sous son nouvel identifiant), seulement par son identifiant.
  // Un titre latin (« Sans titre », « Sans titre 2024 ») garde cet identifiant et reste trouvé par son titre, comme avant :
  // seule l'œuvre dont le titre reçoit maintenant « u-- » (titre sans partie latine) est écartée.
  l = l.filter((e) => !ANCIEN_SANS_TITRE.test(e.id) || !slug(String(e.data.titre ?? '')).startsWith('u--'));
  return l.find((e) => norm(String(e.data.titre)) === n) ?? l.filter((e) => n.split(' ').every((w) => norm(String(e.data.titre)).includes(w))).sort((a, b) => String(a.data.titre).length - String(b.data.titre).length)[0];
}
/** Le fichier qui joue une cible (œuvre film, épisode ou piste), par identifiant. */
export function fichierDeCible(mag: MagasinVenus, cibleId: string): { fichier: string; type: 'video' | 'audio'; sousTitres?: Array<{ langue?: string; fichier?: string; index?: number }>; duree?: number; probe?: Probe } | undefined {
  const ep = mag.get('episodes', cibleId), pi = mag.get('pistes', cibleId), oe = mag.get('oeuvres', cibleId);
  const src = ep ?? pi ?? oe; if (!src) return undefined;
  const fichier = String(src.data.fichier ?? ''); if (!fichier) return undefined;
  const probe = (mag.get('fichiers', cheminId(fichier))?.data.probe) as Probe | undefined;
  return { fichier, type: estAudio(fichier) ? 'audio' : 'video', sousTitres: (src.data.sous_titres as Array<{ langue?: string; fichier?: string; index?: number }> | undefined), duree: src.data.duree as number | undefined, probe };
}

// ---------------- Ma liste, reprise, historique (privé), demandes (privé) ----------------
export function ajouterMaListe(mag: MagasinVenus, profil: string, oeuvreId: string): void { mag.poser('ma_liste', `${profil}:${oeuvreId}`, { profil, oeuvre_id: oeuvreId, ajoute: Date.now() }); }
export function retirerMaListe(mag: MagasinVenus, profil: string, oeuvreId: string): boolean { return mag.retirer('ma_liste', `${profil}:${oeuvreId}`); }
export function maListe(mag: MagasinVenus, profil: string): CarteOeuvre[] {
  return mag.liste('ma_liste').filter((x) => x.data.profil === profil).sort((a, b) => Number(b.data.ajoute) - Number(a.data.ajoute))
    .flatMap((x) => { const o = mag.get('oeuvres', String(x.data.oeuvre_id)); return o ? [carte(o)] : []; });
}
/** Note où on en est dans une cible (reprise). */
export function noterReprise(mag: MagasinVenus, profil: string, cibleId: string, position_s: number, duree_s: number, type = 'video'): void {
  mag.poser('reprise', `${profil}:${cibleId}`, { profil, cible_id: cibleId, type, position_s: Math.max(0, Math.round(position_s)), duree_s: Math.round(duree_s), maj: Date.now() });
}
export function reprise(mag: MagasinVenus, profil: string, cibleId: string): { position_s: number; duree_s: number } | undefined {
  const r = mag.get('reprise', `${profil}:${cibleId}`); if (!r) return undefined;
  return { position_s: Number(r.data.position_s) || 0, duree_s: Number(r.data.duree_s) || 0 };
}

/** Ce qui se lit pour une demande : TOUJOURS un fichier (le film, l'épisode, la piste). */
export interface CibleJouee { cibleId: string; oeuvreId: string; type: TypeOeuvre; titre: string; saison?: number; episode?: number; num?: number; titrePiste?: string; reprise_s: number }
/** Pourquoi rien ne se lit (dit à l'écran, avec ce qu'il faut faire). */
export type Manque =
  | { manque: 'vide' }
  | { manque: 'saison_requise' }
  | { manque: 'episode'; saisons: number[]; episodesDeLaSaison: number[] }
  | { manque: 'tout_vu'; dernier: { saison: number; episode: number } };
/** Une lecture est-elle finie (même seuil que le lecteur : au-delà de 95 % de la durée) ? Pur. */
const fini = (position: number, duree: number): boolean => duree > 0 && position > duree * 0.95;
/**
 * La cible à jouer pour une œuvre. Film → le film. Série : saison + épisode → cet épisode ; saison seule → son premier
 * épisode ; rien → l'épisode en cours s'il n'est pas fini, sinon celui qui suit le dernier vu (table de reprise), sinon
 * le premier. Un numéro d'épisode SANS saison est refusé (numérotation absolue, non tranchée). Album / livre audio →
 * la piste en cours, sinon la suivante, sinon la première.
 */
export function cibleAJouer(mag: MagasinVenus, oeuvre: Enr, o: { profil: string; saison?: number; episode?: number }): CibleJouee | Manque {
  const type = oeuvre.data.type as TypeOeuvre, titre = String(oeuvre.data.titre ?? '');
  const avecReprise = (id: string) => reprise(mag, o.profil, id)?.position_s ?? 0;
  if (type !== 'serie' && type !== 'album' && type !== 'livre_audio') {
    return oeuvre.data.fichier ? { cibleId: oeuvre.id, oeuvreId: oeuvre.id, type, titre, reprise_s: avecReprise(oeuvre.id) } : { manque: 'vide' };
  }
  const liste = type === 'serie' ? episodes(mag, oeuvre.id) : pistes(mag, oeuvre.id);
  if (!liste.length) return { manque: 'vide' };
  const rendre = (e: Enr): CibleJouee => ({ cibleId: e.id, oeuvreId: oeuvre.id, type, titre, reprise_s: avecReprise(e.id),
    ...(type === 'serie' ? { saison: Number(e.data.saison), episode: Number(e.data.episode) } : { num: Number(e.data.num), titrePiste: String(e.data.titre ?? '') }) });
  if (type === 'serie' && o.episode !== undefined && o.saison === undefined) return { manque: 'saison_requise' };
  if (type === 'serie' && o.saison !== undefined) {
    const e = liste.find((x) => Number(x.data.saison) === o.saison && (o.episode === undefined || Number(x.data.episode) === o.episode));
    if (e) return rendre(e);
    return { manque: 'episode', saisons: [...new Set(liste.map((x) => Number(x.data.saison)))], episodesDeLaSaison: liste.filter((x) => Number(x.data.saison) === o.saison).map((x) => Number(x.data.episode)) };
  }
  // Le dernier élément touché de cette œuvre, d'après la table de reprise du profil.
  const ids = new Map(liste.map((e, i) => [e.id, i] as const));
  const dernier = mag.liste('reprise').filter((r) => r.data.profil === o.profil && ids.has(String(r.data.cible_id))).sort((a, b) => (Number(b.data.maj) - Number(a.data.maj)) || (ids.get(String(b.data.cible_id))! - ids.get(String(a.data.cible_id))!))[0]; // à égalité : le plus loin
  if (!dernier) return rendre(liste[0]);
  const i = ids.get(String(dernier.data.cible_id))!;
  if (!fini(Number(dernier.data.position_s) || 0, Number(dernier.data.duree_s) || Number(liste[i].data.duree) || 0)) return rendre(liste[i]);
  if (i + 1 < liste.length) return rendre(liste[i + 1]);
  return type === 'serie' ? { manque: 'tout_vu', dernier: { saison: Number(liste[i].data.saison), episode: Number(liste[i].data.episode) } } : rendre(liste[0]);
}

/**
 * Ajoute (ou rafraîchit) un passage à l'historique (privé, chiffré). L'identifiant est OPAQUE : le titre, la cible et
 * le profil ne vivent que dans le `chiffre`, jamais dans la clé en clair. Une seule ligne par cible et par profil
 * (« vu récemment »), remise à jour : le filtrage et le tri se font après déchiffrement en mémoire.
 */
export function ajouterHistorique(mag: MagasinVenus, profil: string, cibleId: string, type: string, titre: string): void {
  const dejaVu = mag.liste('historique').find((x) => x.data.profil === profil && x.data.cible_id === cibleId);
  mag.poser('historique', dejaVu?.id ?? idOpaque(), { profil, cible_id: cibleId, type, titre, quand: Date.now() });
}
export const historique = (mag: MagasinVenus, profil: string, n = 50): Array<{ cible_id: string; type: string; titre: string; quand: number }> =>
  mag.liste('historique').filter((x) => x.data.profil === profil).sort((a, b) => Number(b.data.quand) - Number(a.data.quand)).slice(0, n)
    .map((x) => ({ cible_id: String(x.data.cible_id), type: String(x.data.type), titre: String(x.data.titre), quand: Number(x.data.quand) }));
export const effacerHistorique = (mag: MagasinVenus, profil: string): number => {
  let n = 0; for (const x of mag.liste('historique')) if (x.data.profil === profil && mag.retirer('historique', x.id)) n++; return n;
};
/** Une demande de titre (privée). Identifiant OPAQUE (le titre ne vit que dans le `chiffre`) ; une seule par titre. */
export function demander(mag: MagasinVenus, profil: string, titre: string, type: string): Enr {
  const deja = mag.liste('demandes').find((x) => x.data.profil === profil && x.data.titre === titre);
  return mag.poser('demandes', deja?.id ?? idOpaque(), { profil, titre, type, etat: 'en attente', quand: Date.now() });
}
export const demandes = (mag: MagasinVenus, profil: string): Array<{ titre: string; type: string; etat: string; quand: number }> =>
  mag.liste('demandes').filter((x) => x.data.profil === profil).sort((a, b) => Number(b.data.quand) - Number(a.data.quand))
    .map((x) => ({ titre: String(x.data.titre), type: String(x.data.type), etat: String(x.data.etat), quand: Number(x.data.quand) }));

export const compter = (mag: MagasinVenus): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const c of ['oeuvres', 'episodes', 'pistes', 'fichiers'] as Collection[]) o[c] = mag.liste(c).length;
  return o;
};
