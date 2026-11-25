// Vénus, la maison (lot V8, seconde part) : les versions légères à garder sur l'appareil, comme Downloads.js du dépôt
// Venus (« Version légère 720p », « Très légère 480p », la liste des téléchargements, « Enregistrer », supprimer).
//
//  - Odin les prépare lui-même avec FFmpeg, sur sa machine : jamais un service extérieur. Si FFmpeg manque, la ligne
//    passe en « Échec » et le dit (rien n'est lancé).
//  - Bornées : UNE version légère à la fois, qui ne démarre qu'après une lecture convertie en cours (pistes.ts) ; et
//    comme une lecture convertie peut démarrer pendant qu'elle tourne, FFmpeg n'a que deux fils et une priorité basse :
//    la lecture passe devant. 60 lignes au plus par profil (une saison entière tient) ; un plafond de durée ; la
//    place du disque vérifiée avant de commencer, et un plafond de taille (« -fs ») même quand elle est inconnue.
//  - La langue du profil (la piste audio qu'il a choisie dans le lecteur) et les sous-titres texte du fichier sont
//    gardés (l'appli d'origine ne gardait que la première piste audio, sans sous-titres).
//  - Rangées dans la table « hors_ligne » de VENUS_ODIN (repli fichiers) ; les vidéos dans le dossier de Vénus
//    (hors-ligne/), effacées avec leur ligne, et au plus tard 7 jours après être prêtes (comme l'appli d'origine).
//  - Ce ménage des 7 jours est un travail du registre des automatismes (dans Talos, sous Vénus : « Ménage des
//    versions légères ») : toutes les heures tant qu'Odin tourne, et aussi à chaque lecture de la liste et à chaque
//    passage de préparation. Mis en pause dans Talos, plus rien n'est effacé pour son âge (sauf « Lancer maintenant »).
//  - Les vidéos ne partent pas dans la sauvegarde d'Odin (backup.ts) : ce sont des copies qu'Odin sait refaire. Une
//    ligne « prête » dont la vidéo n'est plus sur le disque (sauvegarde restaurée) est retirée : le titre se redemande.
//  - Chaque profil ne voit, n'enregistre et ne supprime que les siennes. Un profil enfant ne télécharge pas.
//
// FFmpeg, ffprobe (les pistes), la place libre, l'attente et la cadence du ménage sont injectables (les essais passent
// des faux) : reglerOutilsHorsLigne().
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, statfsSync, unlinkSync } from 'node:fs';
import { constants as osConst, setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import type { Enr, MagasinVenus } from './base.ts';
import { episodes, fichierDeCible } from './bibliotheque.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';
import { conversionEnCours, ffmpegLa, langueCourte, pistesDe, type Sonde } from './pistes.ts';
import { catalogue, preferences } from './app/appli.ts';
import { tacheEnPause, type Automatismes } from '../automatismes.ts';
import { valhallaOf } from '../odin.ts';

export type QualiteLegere = '720p' | '480p';
/** Les deux versions de Downloads.js : hauteur, qualité de l'image, débit du son, et le poids annoncé (Go par heure). */
export const LEGERES: Record<QualiteLegere, { hauteur: number; crf: string; son: string; goParHeure: number }> = {
  '720p': { hauteur: 720, crf: '23', son: '128k', goParHeure: 0.9 },
  '480p': { hauteur: 480, crf: '26', son: '96k', goParHeure: 0.45 },
};
/** Gardées prêtes 7 jours sur le serveur (Downloads.js), puis effacées. */
export const GARDE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lignes au plus par profil (toutes, prêtes comprises) : une saison entière d'un animé y tient. */
export const MAX_PAR_PROFIL = 60;
/** Une conversion ne dure jamais plus que ça (un fichier très long ou une machine très lente) : elle est coupée. */
const DUREE_MAX_MS = 10 * 60 * 60 * 1000;
/** Ce qu'il faut garder libre sur le disque en plus de la version attendue. */
const MARGE_DISQUE = 2 * 1024 ** 3;
/** Les fils de FFmpeg (décodage et encodage) : la machine en garde pour une lecture convertie et pour Odin. */
const FILS = '2';
/** Le ménage des versions périmées dans le registre des automatismes : la ligne « tache:freyja:… » de Talos. */
export const MENAGE = 'menage_versions_legeres';
/** Sa cadence, tant qu'Odin tourne (en plus de chaque lecture de la liste et de chaque passage de préparation). */
const MENAGE_MS = 60 * 60 * 1000;
/** Les sous-titres qu'un MP4 garde en texte (mov_text) : ceux que FFmpeg sait lire ET écrire ainsi, rien de risqué. */
const SOUS_TITRES_MP4 = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export type EtatLegere = 'queued' | 'working' | 'ready' | 'error';
/** Pourquoi une ligne a échoué (la page l'écrit dans la langue de l'appareil). */
export type RaisonEchec = 'ffmpeg' | 'place' | 'fichier' | 'echec' | 'delai';
const ECHECS: Record<RaisonEchec, string> = {
  ffmpeg: 'FFmpeg est introuvable pour Odin : la version légère ne peut pas être préparée. Installez FFmpeg sur la machine d’Odin, puis redémarrez Odin.',
  place: 'Pas assez de place sur le disque d’Odin pour préparer cette version.',
  fichier: 'Le fichier de ce titre n’est plus à sa place (disque débranché, fichier déplacé).',
  echec: 'La conversion a échoué.',
  delai: 'La conversion a pris trop de temps : elle a été arrêtée.',
};
export const REFUS_ENFANT = 'Un profil enfant ne télécharge pas.';

/** Une ligne de la liste, telle que la page la reçoit (les noms de Downloads.js ; jamais un chemin de la machine). */
export interface TacheLegere { id: string; itemId: string; title: string; poster?: string; quality: QualiteLegere; state: EtatLegere; progress: number; size?: number; name?: string; reason?: RaisonEchec; error?: string; created: number; expires?: number }

// ---------------------------------------------------------------- les outils (injectables)
/** Une conversion lancée : sa fin (réussie ou non) et de quoi l'arrêter. `progres` reçoit les secondes déjà converties. */
export type Convertir = (args: string[], progres: (secondes: number) => void) => { fin: Promise<boolean>; tuer(): void };
/**
 * Lance la conversion (FFmpeg, sans interprète de commandes) avec une priorité basse : une lecture convertie lancée
 * pendant qu'elle tourne passe devant. Si le système refuse de changer la priorité, la conversion tourne quand même.
 * `cmd` ne sert qu'aux essais (un autre programme à la place de FFmpeg).
 */
export function lancerLegere(args: string[], progres: (secondes: number) => void, cmd = 'ffmpeg'): { fin: Promise<boolean>; tuer(): void; pid?: number } {
  let p: ReturnType<typeof spawn>;
  try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false }); } catch { return { fin: Promise.resolve(false), tuer() {} }; }
  try { if (p.pid) setPriority(p.pid, osConst.priority.PRIORITY_BELOW_NORMAL); } catch { /* laissée telle quelle */ }
  let reste = '';
  // « -progress pipe:1 » : des lignes « out_time_us=… » (microsecondes ; « out_time_ms » dit pareil, malgré son nom).
  p.stdout?.on('data', (b: Buffer) => {
    reste = (reste + b.toString('utf8')).slice(-4096);
    const l = reste.split('\n'); reste = l.pop() ?? '';
    for (const x of l) { const m = /^out_time_(?:us|ms)=(\d+)/.exec(x.trim()); if (m) progres(Number(m[1]) / 1e6); }
  });
  const fin = new Promise<boolean>((ok) => { p.on('close', (code) => ok(code === 0)); p.on('error', () => ok(false)); });
  return { fin, tuer() { try { p.kill('SIGKILL'); } catch { /* déjà fini */ } }, ...(p.pid ? { pid: p.pid } : {}) };
}
const convertirReel: Convertir = (args, progres) => lancerLegere(args, progres);
/** La place libre du disque ; Infinity si le système ne sait pas la dire (le plafond de taille borne alors la sortie). */
const placeReelle = (dossier: string): number => { try { const f = statfsSync(dossier); return Number(f.bavail) * Number(f.bsize); } catch { return Number.POSITIVE_INFINITY; } };
interface Outils { convertir: Convertir; ffmpegLa: () => Promise<boolean>; placeLibre: (dossier: string) => number; attenteMs: number; pistes: (mag: MagasinVenus, cibleId: string) => Promise<Sonde>; menageMs: number }
const REELS: Outils = { convertir: convertirReel, ffmpegLa, placeLibre: placeReelle, attenteMs: 5000, pistes: pistesDe, menageMs: MENAGE_MS };
let outils: Outils = { ...REELS };
/**
 * (essais) remplacer FFmpeg, la place libre, l'attente et la cadence du ménage ; sans argument, revenir aux vrais. Le
 * passage de l'heure du ménage est désarmé : il se réarme, à la cadence donnée, à la prochaine lecture de la liste.
 */
export function reglerOutilsHorsLigne(o: Partial<Outils> = {}): void { desarmerMenage(); outils = { ...REELS, ...o }; }

// ---------------------------------------------------------------- arguments de FFmpeg (purs)
/**
 * Les arguments de la conversion : l'entrée protégée (protocole « file », lecteurs vidéo seulement), deux fils, la
 * première image et UNE piste de son (son rang, la première par défaut), les sous-titres texte demandés (par leur
 * index dans le fichier, gardés en mov_text), jamais agrandie (la hauteur la plus petite des deux, paire), H.264 et AAC
 * en MP4 lisible partout (« faststart »), un plafond de taille (« -fs », en octets) s'il est donné, l'avancement sur la
 * sortie standard. Pur.
 */
export function argsLegere(chemin: string, q: QualiteLegere, sortie: string, o: { audio?: number; sousTitres?: number[]; plafond?: number } = {}): string[] {
  const v = LEGERES[q], a = Number.isInteger(o.audio) && (o.audio as number) > 0 ? (o.audio as number) : 0;
  const st = [...new Set((o.sousTitres ?? []).filter((i) => Number.isInteger(i) && i >= 0))].slice(0, 32);
  const plafond = Number.isFinite(o.plafond) && (o.plafond as number) > 0 ? Math.floor(o.plafond as number) : 0;
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', FILS, ...entreeFfmpeg('video'), '-i', chemin,
    '-map', '0:v:0', '-map', `0:a:${a}?`, ...st.flatMap((i) => ['-map', `0:${i}?`]), ...(st.length ? ['-c:s', 'mov_text'] : ['-sn']), '-dn',
    '-vf', `scale=-2:trunc(min(${v.hauteur}\\,ih)/2)*2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', v.crf, '-pix_fmt', 'yuv420p', '-threads', FILS, '-c:a', 'aac', '-b:a', v.son, '-ac', '2',
    ...(plafond ? ['-fs', String(plafond)] : []), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-f', 'mp4', sortie];
}
/**
 * Les pistes gardées dans une version légère : la piste audio de la langue choisie par le profil (comme le lecteur :
 * sinon la première), et les sous-titres texte qu'un MP4 sait garder. Des pistes seulement devinées (ffprobe absent)
 * n'apportent aucun sous-titre : leur format est inconnu, et un mauvais choix ferait échouer toute la conversion. Pur.
 */
export function pistesLegere(sonde: Sonde, langue: string): { audio: number; sousTitres: number[] } {
  const voulue = langueCourte(langue);
  const a = voulue ? sonde.audio.find((x) => x.langue && langueCourte(x.langue) === voulue) : undefined;
  return { audio: a?.ordre ?? 0, sousTitres: sonde.sure ? sonde.sousTitres.filter((x) => SOUS_TITRES_MP4.has(x.codec)).map((x) => x.index).slice(0, 32) : [] };
}
/** Le nom donné au fichier enregistré : le titre et la version, sans caractère gênant. Pur. */
export const nomLegere = (titre: string, q: QualiteLegere): string => `${titre.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'video'} (${q}).mp4`;

// ---------------------------------------------------------------- la liste
export const dossierHorsLigne = (mag: MagasinVenus): string => join(mag.dir, 'hors-ligne');
const fichierDe = (mag: MagasinVenus, id: string, partiel = false) => join(dossierHorsLigne(mag), `${id}${partiel ? '.part' : ''}.mp4`);
const effacer = (f: string) => { try { if (existsSync(f)) unlinkSync(f); } catch { /* déjà parti */ } };
const estQualite = (q: unknown): q is QualiteLegere => q === '720p' || q === '480p';
function vers(e: Enr): TacheLegere {
  const d = e.data, q = estQualite(d.quality) ? d.quality : '720p', etat = (['queued', 'working', 'ready', 'error'] as const).find((x) => x === d.etat) ?? 'error';
  const raison = (Object.keys(ECHECS) as RaisonEchec[]).find((x) => x === d.raison);
  return { id: e.id, itemId: s(d.cible), title: s(d.titre), ...(d.poster ? { poster: s(d.poster) } : {}), quality: q, state: etat, progress: Math.max(0, Math.min(100, Math.round(Number(d.progress) || 0))),
    ...(etat === 'ready' && Number(d.taille) > 0 ? { size: Number(d.taille), name: nomLegere(s(d.titre), q) } : {}),
    ...(etat === 'error' ? { reason: raison ?? 'echec', error: ECHECS[raison ?? 'echec'] } : {}), created: Number(d.cree) || 0, ...(Number(d.expire) > 0 ? { expires: Number(d.expire) } : {}) };
}
/**
 * Efface ce qui a passé ses 7 jours (prêt ou en échec) : la ligne et la vidéo. Rend le nombre de lignes effacées.
 * C'est le travail « Ménage des versions légères » du registre des automatismes : mis en pause dans Talos, rien n'est
 * effacé, ni à l'heure, ni à la lecture de la liste, ni au passage de préparation. `force` : le passage vient du
 * registre lui-même (celui de l'heure, qu'il saute tout seul en pause, ou « Lancer maintenant » par le propriétaire).
 */
function purger(mag: MagasinVenus, maintenant: number, force = false): number {
  if (!force && tacheEnPause('freyja', MENAGE)) return 0;
  let n = 0;
  for (const e of mag.liste('hors_ligne')) {
    const fin = Number(e.data.expire) || 0;
    if ((e.data.etat === 'ready' || e.data.etat === 'error') && fin > 0 && fin <= maintenant) { effacer(fichierDe(mag, e.id)); effacer(fichierDe(mag, e.id, true)); mag.retirer('hors_ligne', e.id); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- le ménage, un travail du registre (Talos)
/** Le registre des automatismes de l'Odin de ce magasin (ses applis tournent, Vénus en fait partie), ou rien. */
function registreDe(mag: MagasinVenus): Automatismes | undefined {
  const v = valhallaOf();
  return v && resolve(v.dir, 'freyja') === resolve(mag.dir) && v.modules().some((m) => m.id === 'freyja') ? v.automatismes : undefined;
}
let menage: { mag: MagasinVenus; registre: Automatismes; minuterie: ReturnType<typeof setInterval>; prochain: number } | undefined;
function desarmerMenage(): void { if (menage) clearInterval(menage.minuterie); menage = undefined; }
/**
 * Inscrit le ménage au registre des automatismes (sous Vénus : visible dans Talos, avec « Lancer maintenant » et la
 * pause) et arme son passage de l'heure. Sans registre pour ce magasin (applis d'Odin pas démarrées, essais), rien
 * n'est armé : aucune minuterie ne tourne hors du registre. Appelé à chaque lecture de la liste et à chaque passage de
 * préparation ; rend vrai si le ménage est inscrit.
 */
export function armerMenage(mag: MagasinVenus): boolean {
  const automatismes = registreDe(mag);
  if (!automatismes) return false;
  if (menage && menage.mag === mag && menage.registre === automatismes) return true;
  desarmerMenage();
  const pas = Math.max(10, Number(outils.menageMs) || MENAGE_MS);
  automatismes.inscrire('freyja', {
    id: MENAGE, nom: 'Ménage des versions légères',
    quoi: 'Efface les versions légères de Vénus (720p, 480p) prêtes ou en échec depuis plus de 7 jours : leur ligne dans les téléchargements et leur vidéo. Passe aussi quand la liste des téléchargements est lue.',
    rythme: () => ({ genre: 'heures', n: 1 }),
    lancer: { action: MENAGE },
    prochain: () => (menage ? new Date(menage.prochain) : undefined),
    faire: async () => { const n = purger(mag, Date.now(), true); return { text: n === 0 ? 'Aucune version légère périmée.' : n === 1 ? '1 version légère périmée effacée.' : `${n} versions légères périmées effacées.` }; },
  });
  // Le passage de l'heure passe par le registre : il le saute en pause ou si Vénus est désactivée, le mesure et le note.
  const minuterie = setInterval(() => {
    const m = menage; if (!m) return;
    // Les applis d'Odin arrêtées ou relancées : la minuterie s'arrête avec ce registre. Elle est réarmée, et le travail
    // réinscrit, à la prochaine lecture de la liste.
    if (registreDe(m.mag) !== m.registre) { desarmerMenage(); return; }
    m.prochain = Date.now() + pas;
    void m.registre.passageAuto(`tache:freyja:${MENAGE}`).catch(() => undefined);
  }, pas);
  minuterie.unref?.();
  menage = { mag, registre: automatismes, minuterie, prochain: Date.now() + pas };
  return true;
}

/**
 * Les lignes DU profil. Une ligne « prête » dont la vidéo n'est plus sur le disque est retirée au passage : après une
 * sauvegarde restaurée (les versions légères n'en font pas partie), le titre se redemande, au lieu d'un « Prêt » qui
 * n'enregistrerait rien.
 */
function lignesDe(mag: MagasinVenus, profil: string): Enr[] {
  return mag.liste('hors_ligne').filter((e) => {
    if (e.data.profil !== profil) return false;
    if (e.data.etat !== 'ready' || existsSync(fichierDe(mag, e.id))) return true;
    mag.retirer('hors_ligne', e.id); return false;
  });
}
/** Les téléchargements DU profil, les plus récents d'abord. */
export function taches(mag: MagasinVenus, profil: string, maintenant = Date.now()): TacheLegere[] {
  armerMenage(mag); purger(mag, maintenant);
  return lignesDe(mag, profil).sort((a, b) => (Number(b.data.cree) - Number(a.data.cree)) || (Number(a.data.rang ?? 0) - Number(b.data.rang ?? 0))).map(vers);
}

/** Le titre lisible et l'affiche d'une vidéo de la bibliothèque (un film, ou un épisode et sa série), ou rien. */
function cibleLegere(mag: MagasinVenus, profil: string, id: string): { titre: string; poster?: string; chemin: string; duree: number } | undefined {
  const ep = mag.get('episodes', id), oe = ep ? mag.get('oeuvres', s(ep.data.oeuvre_id)) : mag.get('oeuvres', id);
  if (!oe || (ep ? oe.data.type !== 'serie' : oe.data.type !== 'film')) return undefined;
  const c = fichierDeCible(mag, id); if (!c || c.type !== 'video') return undefined;
  const titre = ep ? `${s(oe.data.titre)} S${String(Number(ep.data.saison) || 0).padStart(2, '0')}E${String(Number(ep.data.episode) || 0).padStart(2, '0')}` : s(oe.data.titre);
  let poster: string | undefined; try { poster = catalogue(mag, profil).find((x) => x.id === oe.id)?.poster; } catch { poster = undefined; }
  return { titre: titre.slice(0, 200), ...(poster ? { poster } : {}), chemin: c.fichier, duree: Number(c.duree ?? c.probe?.duree) || 0 };
}

/** Demande une version légère d'un film ou d'un épisode. La même version déjà demandée (et pas en échec) est rendue telle quelle. */
export function demanderLegere(mag: MagasinVenus, o: { profil: string; enfant?: boolean; itemId: unknown; quality: unknown; maintenant?: number; rang?: number }): TacheLegere | { erreur: string; code: number } {
  if (o.enfant) return { erreur: REFUS_ENFANT, code: 403 };
  if (!estQualite(o.quality)) return { erreur: 'Version inconnue : 720p ou 480p.', code: 400 };
  const id = s(o.itemId), c = cibleLegere(mag, o.profil, id);
  if (!c) return { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.', code: 404 };
  const miennes = lignesDe(mag, o.profil);
  const deja = miennes.find((e) => e.data.cible === id && e.data.quality === o.quality && e.data.etat !== 'error'); if (deja) return vers(deja);
  if (miennes.length >= MAX_PAR_PROFIL) return { erreur: TROP, code: 409 };
  const cle = `dl-${randomBytes(6).toString('hex')}`;
  return vers(mag.poser('hors_ligne', cle, { profil: o.profil, cible: id, titre: c.titre, ...(c.poster ? { poster: c.poster } : {}), quality: o.quality, etat: 'queued', progress: 0, cree: o.maintenant ?? Date.now(), ...(o.rang ? { rang: o.rang } : {}) }));
}
const TROP = 'Trop de téléchargements : supprimez-en un avant d’en préparer un autre.';
/**
 * « Télécharger la saison » (Downloads.js) : une version légère de chaque épisode de la saison qui a son fichier,
 * dans l'ordre. Les épisodes déjà demandés dans cette version sont rendus tels quels. Tout ou rien : si la saison
 * dépasse la limite du profil, rien n'est ajouté (et c'est dit).
 */
export function demanderSaison(mag: MagasinVenus, o: { profil: string; enfant?: boolean; serieId: unknown; saison: unknown; quality: unknown; maintenant?: number }): TacheLegere[] | { erreur: string; code: number } {
  if (o.enfant) return { erreur: REFUS_ENFANT, code: 403 };
  if (!estQualite(o.quality)) return { erreur: 'Version inconnue : 720p ou 480p.', code: 400 };
  const serie = mag.get('oeuvres', s(o.serieId)), n = Number(o.saison);
  const eps = serie && serie.data.type === 'serie' && Number.isInteger(n) ? episodes(mag, serie.id).filter((e) => Number(e.data.saison) === n && fichierDeCible(mag, e.id)?.type === 'video') : [];
  if (!eps.length) return { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.', code: 404 };
  const miennes = lignesDe(mag, o.profil);
  const neufs = eps.filter((e) => !miennes.some((x) => x.data.cible === e.id && x.data.quality === o.quality && x.data.etat !== 'error'));
  if (miennes.length + neufs.length > MAX_PAR_PROFIL) return { erreur: TROP, code: 409 };
  const out: TacheLegere[] = [];
  // La même heure de demande pour toute la saison, et le rang de l'épisode : préparés et listés dans l'ordre de la saison.
  const quand = o.maintenant ?? Date.now();
  eps.forEach((e, k) => { const r = demanderLegere(mag, { profil: o.profil, itemId: e.id, quality: o.quality, maintenant: quand, rang: k }); if (!('erreur' in r)) out.push(r); });
  return out;
}
/** Le fichier prêt d'une ligne DU profil (pour « Enregistrer »), ou rien. */
export function fichierPret(mag: MagasinVenus, profil: string, id: string): { chemin: string; nom: string; taille: number } | undefined {
  const e = mag.get('hors_ligne', id); if (!e || e.data.profil !== profil || e.data.etat !== 'ready') return undefined;
  const f = fichierDe(mag, id); if (!existsSync(f)) return undefined;
  const q = estQualite(e.data.quality) ? e.data.quality : '720p';
  return { chemin: f, nom: nomLegere(s(e.data.titre), q), taille: statSync(f).size };
}
/** Supprime une ligne DU profil : la conversion en cours est arrêtée, la vidéo effacée. */
export function supprimerLegere(mag: MagasinVenus, profil: string, id: string): boolean {
  const e = mag.get('hors_ligne', id); if (!e || e.data.profil !== profil) return false;
  if (courant && courant.mag === mag && courant.id === id) courant.tuer();
  mag.retirer('hors_ligne', id); effacer(fichierDe(mag, id)); effacer(fichierDe(mag, id, true));
  return true;
}

// ---------------------------------------------------------------- la préparation (une à la fois)
let courant: { mag: MagasinVenus; id: string; tuer(): void } | null = null;
let boucle: Promise<void> | null = null;
const aServir = new Set<MagasinVenus>();
const dormir = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });
const vivante = (mag: MagasinVenus, id: string) => mag.get('hors_ligne', id);
const changer = (mag: MagasinVenus, id: string, ch: Record<string, unknown>) => { const e = vivante(mag, id); if (e) mag.poser('hors_ligne', id, { ...e.data, ...ch }); };

/** Prépare UNE ligne. Rend quand elle est prête, en échec, ou supprimée en route. */
async function preparer(mag: MagasinVenus, e: Enr): Promise<void> {
  const id = e.id, profil = s(e.data.profil), q = estQualite(e.data.quality) ? e.data.quality : '720p';
  const echec = (raison: RaisonEchec) => changer(mag, id, { etat: 'error', raison, progress: 0, expire: Date.now() + GARDE_MS });
  const c = cibleLegere(mag, profil, s(e.data.cible));
  if (!c || !existsSync(c.chemin)) { echec('fichier'); return; }
  if (!(await outils.ffmpegLa())) { echec('ffmpeg'); return; }
  const dossier = dossierHorsLigne(mag); mkdirSync(dossier, { recursive: true });
  const attendu = c.duree ? LEGERES[q].goParHeure * 1e9 * (c.duree / 3600) : 0;
  const libre = outils.placeLibre(dossier);
  if (libre < attendu * 1.5 + MARGE_DISQUE) { echec('place'); return; }
  // Une lecture convertie en cours (pistes.ts) passe d'abord ; celle qui démarrerait ensuite passe devant (priorité basse).
  while (conversionEnCours() && vivante(mag, id)) await dormir(outils.attenteMs);
  if (!vivante(mag, id)) return;
  // Le plafond de taille (« -fs ») : jamais plus du double de l'estimation (sans durée connue : le poids de la durée
  // maximale), ni plus que la place libre moins la marge — et posé même quand le système ne sait pas dire la place.
  const parDuree = Math.floor(attendu ? attendu * 2 : LEGERES[q].goParHeure * 1e9 * (DUREE_MAX_MS / 3_600_000) * 1.5);
  const parDisque = Number.isFinite(libre) ? Math.floor(libre - MARGE_DISQUE) : Number.POSITIVE_INFINITY;
  const plafond = Math.min(parDuree, parDisque);
  // Les pistes du fichier (ffprobe, une fois par fichier) : la langue choisie par le profil, et ses sous-titres texte.
  let pistes = { audio: 0, sousTitres: [] as number[] };
  try { pistes = pistesLegere(await outils.pistes(mag, s(e.data.cible)), s(preferences(mag, profil).audio)); } catch { /* la première piste, sans sous-titres */ }
  if (!vivante(mag, id)) return;
  const part = fichierDe(mag, id, true), fin = fichierDe(mag, id);
  changer(mag, id, { etat: 'working', progress: 0, raison: null });
  let dernier = 0, coupe = false;
  const run = outils.convertir(argsLegere(c.chemin, q, part, { ...pistes, plafond }), (sec) => {
    if (!c.duree) return;
    const pct = Math.min(99, Math.floor((sec / c.duree) * 100));
    if (pct >= dernier + 2) { dernier = pct; changer(mag, id, { progress: pct }); } // pas une écriture par ligne de FFmpeg
  });
  courant = { mag, id, tuer: () => { coupe = true; run.tuer(); } };
  const garde = setTimeout(() => { coupe = true; run.tuer(); changer(mag, id, { raison: 'delai' }); }, DUREE_MAX_MS); garde.unref?.();
  let ok = false; try { ok = await run.fin; } catch { ok = false; }
  clearTimeout(garde); courant = null;
  if (!vivante(mag, id)) { effacer(part); return; } // supprimée pendant la conversion
  let taille = 0; try { taille = existsSync(part) ? statSync(part).size : 0; } catch { taille = 0; }
  if (ok && !coupe && taille > 0 && taille < plafond) {
    effacer(fin); renameSync(part, fin);
    changer(mag, id, { etat: 'ready', progress: 100, taille: statSync(fin).size, fini: Date.now(), expire: Date.now() + GARDE_MS });
    return;
  }
  effacer(part);
  // Une sortie arrivée au plafond est coupée (jamais « prête ») : faute de place si c'est la place qui le fixait.
  const auPlafond = ok && !coupe && taille >= plafond;
  echec(vivante(mag, id)?.data.raison === 'delai' ? 'delai' : auPlafond && parDisque <= parDuree ? 'place' : 'echec');
}
async function tourner(): Promise<void> {
  for (;;) {
    let fait = false;
    for (const mag of [...aServir]) {
      const e = mag.liste('hors_ligne').filter((x) => x.data.etat === 'queued').sort((a, b) => (Number(a.data.cree) - Number(b.data.cree)) || (Number(a.data.rang ?? 0) - Number(b.data.rang ?? 0)))[0];
      if (!e) { aServir.delete(mag); continue; }
      try { await preparer(mag, e); } catch { changer(mag, e.id, { etat: 'error', raison: 'echec', expire: Date.now() + GARDE_MS }); courant = null; }
      fait = true;
    }
    if (!fait) return;
  }
}
/**
 * Lance la préparation de ce qui attend (si rien ne tourne déjà). Ce qui a passé ses 7 jours est d'abord effacé (sans
 * attendre qu'on ouvre la page ; sauf ménage mis en pause dans Talos). Une ligne restée « Préparation » sans conversion
 * vivante (Odin arrêté en route) repart en attente. Rend la fin de ce passage.
 */
export function planifier(mag: MagasinVenus): Promise<void> {
  armerMenage(mag); purger(mag, Date.now());
  for (const e of mag.liste('hors_ligne')) if (e.data.etat === 'working' && !(courant && courant.mag === mag && courant.id === e.id)) mag.poser('hors_ligne', e.id, { ...e.data, etat: 'queued', progress: 0 });
  if (!mag.liste('hors_ligne').some((e) => e.data.etat === 'queued')) return boucle ?? Promise.resolve();
  aServir.add(mag);
  if (!boucle) boucle = tourner().finally(() => { boucle = null; });
  return boucle;
}
/** (essais) la fin de la préparation en cours. */
export const attendreHorsLigne = (): Promise<void> => boucle ?? Promise.resolve();
