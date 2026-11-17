// Vénus · envoyer des films, des séries ou de la musique depuis le téléphone ou le PC vers la bibliothèque.
// Le navigateur envoie le fichier en morceaux reprenables (route commune /api/valhalla/morceau : chaque morceau
// s'ajoute à « depots/.morceaux/<envoi>.part » de Vénus) ; ici, deux étapes :
//   - préparer : nom, taille, dossier déclaré choisi → identifiant d'envoi, octets déjà reçus, place ; tout ce qui
//     peut être refusé AVANT l'envoi l'est (aucun dossier déclaré, épisode sans numéro, pas une vidéo ou un son,
//     place insuffisante, plafond des envois en cours) ;
//   - importer : taille reçue = taille annoncée, antivirus (quarantaine d'abord), VRAIE nature lue dans les octets
//     (ni vidéo ni son → refusé, quel que soit le nom), ffprobe, déplacement sans jamais écraser, puis CE fichier
//     seul est rangé dans la bibliothèque.
// Choix prudents de la session (ses mots ne tranchent pas, il peut les changer) : dossier DÉCLARÉ choisi à l'envoi ;
// refus s'il resterait moins de 10 % du disque ; un envoi abandonné depuis 2 jours est effacé et la place des envois
// en cours est plafonnée à ce que laisse ce seuil ; lui seul envoie (actions « propriétaire seul »).
// Aucune conversion à l'arrivée : le fichier est gardé tel quel.
import { closeSync, constants, copyFileSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { idEnvoi } from '../ymir/bibliotheque.ts';
import { fichierEnvoi } from '../../web/morceaux.ts';
import { quarantaineDabord, type Arrivee, type Passage } from '../ullr/garde.ts';
import { reconnaitreOctets } from '../../medias/reconnaitre.ts';
import { analyserNom, bonGenrePour, dossiers, EXT_AUDIO, EXT_VIDEO, nettoyerChemin, raisonDossierRefuse, rangerFichier, RAISONS_IGNORE, type Categorie, type Outils, type Probe } from './bibliotheque.ts';
import type { MagasinVenus } from './base.ts';

/** Part du disque toujours gardée libre (choix prudent : 10 %). */
export const PART_LIBRE = 0.10;
/** Un envoi qui n'a pas bougé depuis ce temps est abandonné et effacé (choix prudent : 2 jours). */
export const DUREE_ABANDON_MS = 2 * 86_400_000;
/** La taille maximale d'un fichier (celle de la route des morceaux). */
export const TAILLE_MAX = 64 * 1024 ** 3;
const CATEGORIES: readonly Categorie[] = ['films', 'series', 'musique', 'livres_audio'];

/** La place d'un disque (octets). */
export interface Place { libre: number; total: number }
/** Les outils injectables (faux en essai) : place d'un disque, même disque ou non, l'heure, ffprobe. */
export interface OutilsEnvoi {
  place?(chemin: string): Place | undefined;
  memeDisque?(a: string, b: string): boolean;
  maintenant?(): number;
  ffprobe?: Outils['ffprobe'];
  vignette?: Outils['vignette'];
}
/** Le dossier qui reçoit les morceaux (celui du `depot` de Vénus). */
export const dossierMorceauxVenus = (depot: string): string => join(depot, '.morceaux');
const manifeste = (depot: string, id: string) => join(dossierMorceauxVenus(depot), `${id}.envoi.json`);
interface Manifeste { nom: string; taille: number; categorie: Categorie; dossier: string; debut: number }

const placeReelle = (chemin: string): Place | undefined => { try { const s = statfsSync(chemin); return { libre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { return undefined; } };
const memeDisqueReel = (a: string, b: string): boolean => { try { return statSync(a).dev === statSync(b).dev; } catch { return false; } };
const taillePart = (f: string | undefined): number => { try { return f && existsSync(f) ? statSync(f).size : 0; } catch { return 0; } };
const lireManifeste = (f: string): Manifeste | undefined => { try { const m = JSON.parse(readFileSync(f, 'utf8')) as Manifeste; return m && typeof m.nom === 'string' && Number.isFinite(m.taille) ? m : undefined; } catch { return undefined; } };

/** Une taille lisible (Go, Mo, Ko). Pur. */
export function enClair(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} Mo`;
  return `${Math.max(1, Math.round(n / 1024))} Ko`;
}

const RESERVES_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/**
 * Le nom d'un fichier envoyé, rendu sûr : seulement le dernier élément (aucun « ..\ » ni « / »), sans caractère de
 * contrôle ni caractère interdit par Windows, sans point de tête, sans nom réservé (CON, NUL…). Les lettres de toutes
 * les langues sont gardées (un titre en japonais, en arabe ou en shimaoré reste lisible). Pur.
 */
export function nomPropre(brut: string): string {
  const dernier = String(brut ?? '').split(/[\\/]/).pop() ?? '';
  let n = dernier.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  const k = n.lastIndexOf('.'), base = k > 0 ? n.slice(0, k) : n, ext = k > 0 ? n.slice(k) : '';
  const b = RESERVES_WINDOWS.test(base) ? `${base}_` : base;
  // 150 caractères au plus, l'extension gardée.
  const court = b.length + ext.length > 150 ? b.slice(0, Math.max(1, 150 - ext.length)) : b;
  return court ? `${court}${ext}` : '';
}

/**
 * Efface les envois abandonnés : tout ce qui, dans le dossier des morceaux, n'a pas bougé depuis 2 jours (un envoi en
 * cours et sa fiche, ou un reste). Rend le nombre de fichiers effacés et leur taille.
 */
export function purgerEnvois(depot: string, maintenant = Date.now()): { fichiers: number; octets: number } {
  const d = dossierMorceauxVenus(depot); let fichiers = 0, octets = 0;
  let noms: string[]; try { noms = readdirSync(d); } catch { return { fichiers, octets }; }
  // Un envoi = sa fiche et son .part : il est abandonné quand AUCUN des deux n'a bougé depuis 2 jours.
  const dernier = new Map<string, number>();
  const cle = (n: string) => n.replace(/\.envoi\.json$|\.part$/, '');
  for (const n of noms) { try { const st = statSync(join(d, n)); if (st.isFile()) dernier.set(cle(n), Math.max(dernier.get(cle(n)) ?? 0, st.mtimeMs)); } catch { /* disparu */ } }
  for (const n of noms) {
    const f = join(d, n), t = dernier.get(cle(n));
    if (t === undefined || maintenant - t < DUREE_ABANDON_MS) continue;
    try { const st = statSync(f); rmSync(f, { force: true }); fichiers++; octets += st.size; } catch { /* déjà parti */ }
  }
  return { fichiers, octets };
}

/** Ce qui reste à recevoir pour les AUTRES envois en cours (d'après leurs fiches). */
function resteDesAutres(depot: string, sauf: string): { nombre: number; octets: number } {
  const d = dossierMorceauxVenus(depot); let nombre = 0, octets = 0;
  let noms: string[]; try { noms = readdirSync(d); } catch { return { nombre, octets }; }
  for (const n of noms) {
    if (!n.endsWith('.envoi.json')) continue;
    const id = n.slice(0, -'.envoi.json'.length); if (id === sauf) continue;
    const m = lireManifeste(join(d, n)); if (!m) continue;
    const reste = Math.max(0, m.taille - taillePart(fichierEnvoi(depot, id)));
    if (reste > 0) { nombre++; octets += reste; }
  }
  return { nombre, octets };
}

/** La raison pour laquelle ce nom ne convient pas à la catégorie (rien = il convient). Pur. */
export function raisonNom(nom: string, categorie: Categorie): string | undefined {
  const ext = extname(nom).toLowerCase();
  const video = categorie === 'films' || categorie === 'series';
  if (!(video ? EXT_VIDEO : EXT_AUDIO).has(ext)) {
    const attendu = [...(video ? EXT_VIDEO : EXT_AUDIO)].join(', ');
    return `« ${nom} » n'est pas ${video ? 'une vidéo' : 'un son'} d'après son nom : ${video ? 'films et séries' : 'musique et livres audio'} acceptent ${attendu}.`;
  }
  if (!bonGenrePour(nom, categorie)) return `« ${nom} » : ${RAISONS_IGNORE.hors_categorie}.`;
  if (categorie === 'series' && analyserNom(nom).saison === undefined) return `« ${nom} » : ${RAISONS_IGNORE.episode_sans_numero}. Renomme-le, par exemple « Titre S01E02${ext} », puis renvoie-le.`;
  return undefined;
}

/** Le dossier déclaré choisi pour l'arrivée (et sa catégorie), ou la raison du refus. */
function dossierArrivee(mag: MagasinVenus, chemin: string, categorie: string): { dossier: string; categorie: Categorie } | { raison: string } {
  const declares = dossiers(mag).filter((d) => d.actif);
  if (!declares.length) return { raison: "Aucun dossier média déclaré : déclare d'abord un dossier (Vénus → Odéon → Dossiers média). Les fichiers envoyés y sont rangés." };
  const c = nettoyerChemin(chemin);
  if (!c) return { raison: "Choisis le dossier d'arrivée parmi tes dossiers média." };
  const d = declares.find((x) => x.chemin === c);
  if (!d) return { raison: `Ce dossier n'est pas un de tes dossiers média déclarés : ${c}. Choisis-en un dans la liste, ou déclare-le d'abord.` };
  if (categorie && categorie !== d.categorie) return { raison: `Ce dossier est rangé en « ${d.categorie} », pas en « ${categorie} » : choisis un dossier de la bonne catégorie.` };
  if (!CATEGORIES.includes(d.categorie)) return { raison: `Catégorie inconnue pour ce dossier : ${d.categorie}.` };
  const r = raisonDossierRefuse(d.chemin); if (r) return { raison: r };
  return { dossier: d.chemin, categorie: d.categorie };
}

/** Le résultat d'une préparation. */
export interface Preparation { envoi: string; recu: number; taille: number; nom: string; categorie: Categorie; dossier: string; place?: { libre: number; garde: number } }

/**
 * Prépare un envoi : refuse tout de suite ce qui ne peut pas aboutir, sinon rend l'identifiant et les octets déjà
 * reçus (reprise après une coupure : même fichier, même identifiant). Lève une erreur (la raison, en clair) si refusé.
 */
export function preparerEnvoi(mag: MagasinVenus, depot: string, i: { nom: unknown; taille: unknown; categorie?: unknown; dossier: unknown; modifie?: unknown }, o: OutilsEnvoi = {}): Preparation {
  const maintenant = o.maintenant?.() ?? Date.now(), place = o.place ?? placeReelle, meme = o.memeDisque ?? memeDisqueReel;
  purgerEnvois(depot, maintenant);
  const nom = nomPropre(String(i.nom ?? ''));
  if (!nom) throw new Error('nom de fichier manquant');
  const taille = Number(i.taille);
  if (!Number.isSafeInteger(taille) || taille <= 0) throw new Error('taille invalide');
  if (taille > TAILLE_MAX) throw new Error(`fichier trop lourd : ${enClair(taille)} (64 Go au plus)`);
  const a = dossierArrivee(mag, String(i.dossier ?? ''), String(i.categorie ?? '').trim());
  if ('raison' in a) throw new Error(a.raison);
  const rn = raisonNom(nom, a.categorie); if (rn) throw new Error(rn);
  // L'identifiant : nom + taille, et la date de modification du fichier quand l'appareil la donne. Deux fichiers
  // différents de même nom et même taille n'ont ainsi pas le même envoi (le second ne reprendrait pas sur le premier).
  const modifie = Number(i.modifie), id = Number.isSafeInteger(modifie) && modifie > 0 ? idEnvoi(`${nom}\n${modifie}`, taille) : idEnvoi(nom, taille);
  const part = fichierEnvoi(depot, id)!;
  const morceaux = dossierMorceauxVenus(depot); mkdirSync(morceaux, { recursive: true, mode: 0o700 });
  let recu = taillePart(part);
  if (recu > taille) { rmSync(part, { force: true }); recu = 0; }
  // La place : ce qui reste à recevoir doit tenir en gardant 10 % du disque libres, avec les autres envois en cours.
  const reste = taille - recu, pm = place(morceaux);
  let resume: Preparation['place'];
  if (pm && pm.total > 0) {
    const garde = Math.ceil(pm.total * PART_LIBRE), dispo = pm.libre - garde;
    resume = { libre: pm.libre, garde };
    if (reste > dispo) throw new Error(`Place insuffisante sur le disque d'Odin : il faut ${enClair(reste)}, il reste ${enClair(Math.max(0, dispo))} en gardant 10 % du disque libres. Libère de la place, puis renvoie.`);
    const autres = resteDesAutres(depot, id);
    if (reste + autres.octets > dispo) throw new Error(`Plafond des envois en cours atteint : ${autres.nombre} autre(s) envoi(s) en cours attendent encore ${enClair(autres.octets)}, et il ne reste que ${enClair(Math.max(0, dispo))} en gardant 10 % du disque libres. Termine-les d'abord (un envoi abandonné est effacé après 2 jours).`);
  }
  // Dossier d'arrivée sur un autre disque : le fichier y sera COPIÉ, il y faut toute sa taille.
  if (!meme(morceaux, a.dossier)) {
    const pa = place(a.dossier);
    if (pa && pa.total > 0 && taille > pa.libre - Math.ceil(pa.total * PART_LIBRE)) throw new Error(`Place insuffisante dans le dossier d'arrivée (${a.dossier}) : il faut ${enClair(taille)} en gardant 10 % de ce disque libres.`);
  }
  const m: Manifeste = { nom, taille, categorie: a.categorie, dossier: a.dossier, debut: maintenant };
  writeFileSync(manifeste(depot, id), JSON.stringify(m), { mode: 0o600 });
  return { envoi: id, recu, taille, nom, categorie: a.categorie, dossier: a.dossier, ...(resume ? { place: resume } : {}) };
}

/** Un nom libre dans un dossier : « Titre (2).mkv » si « Titre.mkv » existe déjà. Pur sauf la lecture du disque. */
export function nomLibre(dossier: string, nom: string, essai = 1): string {
  const k = nom.lastIndexOf('.'), base = k > 0 ? nom.slice(0, k) : nom, ext = k > 0 ? nom.slice(k) : '';
  for (let n = essai; n < 10_000; n++) { const c = n === 1 ? nom : `${base} (${n})${ext}`; if (!existsSync(join(dossier, c))) return c; }
  throw new Error('trop de fichiers du même nom dans ce dossier');
}
/**
 * Déplace le fichier reçu dans le dossier d'arrivée SANS JAMAIS écraser : lien puis effacement sur le même disque,
 * sinon copie exclusive, comparaison de taille, puis effacement de l'original. Rend le chemin final.
 * Une fois le fichier arrivé, un original qu'on ne peut pas effacer (encore ouvert sous Windows : EBUSY, EPERM) ne
 * change rien : le fichier est à sa place, l'original reste dans le dossier des morceaux et la purge l'efface.
 * `fs` : les opérations du disque (remplaçables en essai).
 */
export function deplacerSansEcraser(source: string, dossier: string, nom: string, taille: number, fs: { link?: typeof linkSync; unlink?: typeof unlinkSync; copy?: typeof copyFileSync } = {}): string {
  const lier = fs.link ?? linkSync, effacer = fs.unlink ?? unlinkSync, copier = fs.copy ?? copyFileSync;
  const effacerOriginal = () => { try { effacer(source); } catch { /* purgé après 2 jours */ } };
  for (let essai = 1; essai < 10_000; essai++) {
    const dest = join(dossier, nomLibre(dossier, nom, essai));
    try { lier(source, dest); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // Autre disque, ou système de fichiers sans lien : copie exclusive (échoue si le nom vient d'être pris).
      try { copier(source, dest, constants.COPYFILE_EXCL); }
      catch (e2) { if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e2; }
      if (statSync(dest).size !== taille) { rmSync(dest, { force: true }); throw new Error('la copie vers le dossier d\'arrivée est incomplète'); }
    }
    effacerOriginal(); return dest;
  }
  throw new Error('aucun nom libre dans le dossier d\'arrivée');
}

/** Le résultat d'un import : rangé (et quoi), ou refusé (et pourquoi). */
export type Import =
  | { ok: true; texte: string; titre: string; oeuvreId: string; cibleId: string; genre: 'film' | 'episode' | 'piste'; fichier: string; dossier: string; categorie: Categorie; nature: string; antivirus: string }
  | { ok: false; texte: string; bloque?: boolean; quarantaine?: string; garde?: boolean };

/** Reçoit le contexte d'une appli pour réveiller l'antivirus (Asclépios) avant l'analyse. */
type Reveil = Parameters<typeof quarantaineDabord>[1];

/**
 * Importe un envoi terminé : taille, antivirus, vraie nature, ffprobe, déplacement sans écraser, rangement de CE
 * fichier. Un refus dit pourquoi ; un fichier qui n'est ni une vidéo ni un son est effacé ; un fichier dangereux part
 * en quarantaine (Asclépios) avant toute lecture par FFmpeg.
 */
export async function importerEnvoi(mag: MagasinVenus, depot: string, envoi: unknown, o: OutilsEnvoi & { reveil?: Reveil } = {}): Promise<Import> {
  const maintenant = o.maintenant?.() ?? Date.now();
  purgerEnvois(depot, maintenant);
  const id = String(envoi ?? ''), part = fichierEnvoi(depot, id);
  if (!part) return { ok: false, texte: 'envoi inconnu' };
  const fm = manifeste(depot, id), m = lireManifeste(fm);
  if (!m) return { ok: false, texte: "envoi inconnu : prépare-le d'abord (ou il a été effacé après 2 jours sans reprise)" };
  const fige = join(dossierMorceauxVenus(depot), `${id}.import`);
  const oublier = () => { for (const f of [fm, part, fige]) rmSync(f, { force: true }); };
  if (!existsSync(part)) return { ok: false, texte: `rien n'est arrivé pour « ${m.nom} » : relance l'envoi` };
  const recu = statSync(part).size;
  if (recu < m.taille) return { ok: false, garde: true, texte: `envoi incomplet : ${enClair(recu)} reçus sur ${enClair(m.taille)}. Relance l'envoi du même fichier, il reprend où il s'est arrêté.` };
  if (recu !== m.taille) { oublier(); return { ok: false, texte: `Refusé : « ${m.nom} » — la taille reçue (${recu} octets) n'est pas la taille annoncée (${m.taille} octets). Le fichier reçu est effacé ; renvoie-le.` }; }
  // Le dossier choisi est-il toujours déclaré et là ? (retiré entre-temps, disque débranché)
  const a = dossierArrivee(mag, m.dossier, m.categorie);
  if ('raison' in a) return { ok: false, garde: true, texte: a.raison };
  // Le fichier est mis de côté sous un autre nom AVANT l'analyse : un morceau qui arriverait encore pour cet envoi
  // ne peut plus changer ce qui a été vérifié (il entamerait un nouveau .part).
  try { renameSync(part, fige); } catch { return { ok: false, garde: true, texte: `« ${m.nom} » est encore en cours d'écriture : réessaie dans un instant.` }; }
  const rendre = (): void => { try { if (!existsSync(part)) renameSync(fige, part); else rmSync(fige, { force: true }); } catch { /* le reste est purgé après 2 jours */ } };
  // 1. Quarantaine d'abord : tout ce qui arrive passe par l'antivirus, AVANT toute lecture par FFmpeg.
  const arrivee: Arrivee = { fichier: fige, nom: m.nom, origine: 'Vénus · média envoyé depuis un appareil', usage: 'le ranger dans la bibliothèque de Vénus' };
  const passage: Passage = await quarantaineDabord(arrivee, o.reveil);
  if (passage.bloque) { rmSync(fm, { force: true }); return { ok: false, bloque: true, quarantaine: passage.quarantaine, texte: `Refusé : ${passage.texte} Il est mis à l'écart et n'entre pas dans la bibliothèque.` }; }
  if (!passage.ok) { rendre(); return { ok: false, garde: true, texte: `Refusé pour l'instant : ${passage.texte}` }; }
  // 2. La VRAIE nature, lue dans les octets : ni vidéo ni son → refusé, quel que soit son nom.
  const tete = lireTete(fige, 64 * 1024), nature = reconnaitreOctets(tete, { taille: recu, nom: m.nom });
  const video = m.categorie === 'films' || m.categorie === 'series';
  if (nature.famille !== 'video' && nature.famille !== 'son') { oublier(); return { ok: false, texte: `Refusé : « ${m.nom} » n'est ni une vidéo ni un son — d'après son contenu, c'est : ${nature.nom}. Il n'est pas rangé, et le fichier reçu est effacé.` }; }
  if (video && nature.famille !== 'video') { oublier(); return { ok: false, texte: `Refusé : « ${m.nom} » est un son (${nature.nom}), pas une vidéo : envoie-le dans un dossier de musique ou de livres audio.` }; }
  // 3. ffprobe (le fichier est jugé sain) : illisible → refusé, le fichier reçu reste 2 jours pour un nouvel essai.
  const ffprobe = o.ffprobe;
  const probe: Probe | null = ffprobe ? await ffprobe(fige).catch(() => null) : null;
  if (!probe) { rendre(); return { ok: false, garde: true, texte: `Refusé pour l'instant : « ${m.nom} » est ${RAISONS_IGNORE.illisible}. S'il manque FFmpeg, installe-le puis renvoie le même fichier : il est gardé 2 jours et ne repart pas de zéro.` }; }
  if (video && !probe.codecs.length) { oublier(); return { ok: false, texte: `Refusé : « ${m.nom} » n'a aucune image (pas de piste vidéo) : envoie-le dans un dossier de musique ou de livres audio.` }; }
  // 4. Déplacé dans le dossier choisi, sans jamais écraser un fichier existant.
  const dest = deplacerSansEcraser(fige, a.dossier, m.nom, recu);
  rmSync(fm, { force: true });
  // 5. CE fichier seul est rangé (avec la lecture ffprobe déjà faite).
  const st = statSync(dest);
  const r = await rangerFichier(mag, { chemin: dest, taille: st.size, mtime: Math.trunc(st.mtimeMs) }, a.categorie, { ffprobe: async () => probe, ...(o.vignette ? { vignette: o.vignette } : {}) });
  if ('raison' in r) return { ok: false, texte: `« ${basename(dest)} » est dans ${dirname(dest)}, mais n'entre pas dans la bibliothèque : ${RAISONS_IGNORE[r.raison]}.` };
  return { ok: true, texte: `✅ « ${r.titre} » analysé et rangé (${basename(dest)}) : il est dans la bibliothèque, un clic le lit.`, titre: r.titre, oeuvreId: r.oeuvreId, cibleId: r.cibleId, genre: r.genre, fichier: basename(dest), dossier: a.dossier, categorie: a.categorie, nature: nature.nom, antivirus: passage.texte };
}

function lireTete(f: string, n: number): Buffer {
  const fd = openSync(f, 'r');
  try { const b = Buffer.alloc(n); return b.subarray(0, readSync(fd, b, 0, n, 0)); } finally { closeSync(fd); }
}
