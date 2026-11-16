// Vénus · Odéon — la bibliothèque native (sans serveur extérieur). Parcourt les dossiers média déclarés, lit chaque
// fichier avec ffprobe (durée, résolution, codecs, pistes, sous-titres), fabrique une vignette, range les œuvres, les
// épisodes et les pistes dans la base VENUS_ODIN. Recherche, ma liste, reprise, historique (privé) et demandes.
//
// Rien n'est inventé : l'affiche vient de la vignette du fichier (ou d'une source libre SANS clé fournie par
// l'appelant), jamais d'un titre deviné. Les outils externes (ffprobe, FFmpeg) sont injectés : les essais passent un
// faux, aucun service réel n'est touché.
import { randomBytes } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { Collection, Enr, MagasinVenus } from './base.ts';

/** Un identifiant opaque pour les collections PRIVÉES : la clé (en clair dans le fichier) ne révèle rien. Pur. */
const idOpaque = (): string => randomBytes(12).toString('hex');

export type TypeOeuvre = 'film' | 'serie' | 'album' | 'livre_audio' | 'livre' | 'chaine';
export type Categorie = 'films' | 'series' | 'musique' | 'livres_audio';

const EXT_VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv', '.flv']);
const EXT_AUDIO = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma']);
const EXT_SOUS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

/** Normalise un titre pour comparer/chercher (minuscules, sans accents ni signes). Pur. */
export function norm(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Un identifiant court et stable à partir d'un texte (pour les clés d'œuvres). Pur. */
export function slug(t: string): string { return norm(t).replace(/\s+/g, '-').slice(0, 80) || 'sans-titre'; }

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
function titrePropre(t: string): string { return t.replace(NETTOYER, ' ').replace(/[\s.\-_]+$/,'').replace(/\s+/g, ' ').trim(); }

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
  while (pile.length) {
    const d = pile.pop()!;
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

/** Bilan d'un scan. */
export interface Bilan { oeuvres: number; episodes: number; pistes: number; fichiers: number; ignores: number }

/**
 * Scanne tous les dossiers actifs et range la bibliothèque dans le magasin. N'efface rien : met à jour.
 * Rien n'est inventé (l'affiche vient de la vignette du fichier, ou d'une source libre fournie).
 */
export async function scanner(mag: MagasinVenus, outils: Outils): Promise<Bilan> {
  const parcourir = outils.parcourir ?? parcourirReel;
  const b: Bilan = { oeuvres: 0, episodes: 0, pistes: 0, fichiers: 0, ignores: 0 };
  const oeuvresVues = new Set<string>();
  for (const d of mag.liste('dossiers')) {
    const { chemin, categorie, actif } = d.data as { chemin: string; categorie: Categorie; actif?: boolean };
    if (actif === false || !chemin) continue;
    const tous = parcourir(chemin);
    for (const f of tous) {
      const ext = extname(f.chemin).toLowerCase();
      if (!EXT_VIDEO.has(ext) && !EXT_AUDIO.has(ext)) { if (!EXT_SOUS.has(ext)) b.ignores++; continue; }
      const probe = await outils.ffprobe(f.chemin).catch(() => null);
      if (!probe) { b.ignores++; continue; }
      const lu = analyserNom(basename(f.chemin));
      const vignette = outils.vignette ? await outils.vignette(f.chemin, probe.duree).catch(() => undefined) : undefined;
      mag.poser('fichiers', cheminId(f.chemin), { chemin: f.chemin, taille: f.taille, mtime: f.mtime, probe });
      b.fichiers++;
      if (categorie === 'series' && estVideo(f.chemin) && lu.saison !== undefined) {
        const serie = lu.titre || basename(dirname(f.chemin));
        const oid = `serie:${slug(serie)}`;
        if (!oeuvresVues.has(oid)) { poserOeuvre(mag, oid, { type: 'serie', titre: serie, titre_norm: norm(serie), slug: slug(serie), ...(await afficheOpt(outils, lu, 'serie', vignette)) }); oeuvresVues.add(oid); b.oeuvres++; }
        const eid = `${oid}:s${lu.saison}e${lu.episode ?? 0}`;
        mag.poser('episodes', eid, { oeuvre_id: oid, saison: lu.saison, episode: lu.episode ?? 0, titre: lu.titre, fichier: f.chemin, duree: probe.duree, resolution: resolution(probe), codecs: probe.codecs, sous_titres: [...probe.sousTitres, ...sousTitresVoisins(f.chemin, tous)], ...(vignette ? { vignette } : {}) });
        b.episodes++;
      } else if (categorie === 'films' && estVideo(f.chemin)) {
        const oid = `film:${slug(lu.titre)}${lu.annee ? `-${lu.annee}` : ''}`;
        poserOeuvre(mag, oid, { type: 'film', titre: lu.titre, titre_norm: norm(lu.titre), slug: slug(lu.titre), annee: lu.annee, fichier: f.chemin, duree: probe.duree, resolution: resolution(probe), codecs: probe.codecs, sous_titres: [...probe.sousTitres, ...sousTitresVoisins(f.chemin, tous)], ...(await afficheOpt(outils, lu, 'film', vignette)) });
        if (!oeuvresVues.has(oid)) { oeuvresVues.add(oid); b.oeuvres++; }
      } else if ((categorie === 'musique' || categorie === 'livres_audio') && estAudio(f.chemin)) {
        const type: TypeOeuvre = categorie === 'musique' ? 'album' : 'livre_audio';
        const album = basename(dirname(f.chemin));
        const oid = `${type}:${slug(album)}`;
        if (!oeuvresVues.has(oid)) { poserOeuvre(mag, oid, { type, titre: album, titre_norm: norm(album), slug: slug(album), ...(vignette ? { affiche: vignette } : {}) }); oeuvresVues.add(oid); b.oeuvres++; }
        const num = numeroDePiste(basename(f.chemin));
        mag.poser('pistes', `${oid}:p${num}:${slug(basename(f.chemin))}`, { oeuvre_id: oid, num, titre: lu.titre || basename(f.chemin, extname(f.chemin)), fichier: f.chemin, duree: probe.duree });
        b.pistes++;
      } else { b.ignores++; }
    }
  }
  return b;
}
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
  const l = mag.liste('oeuvres'); const direct = l.find((e) => e.id === q); if (direct) return direct;
  const n = norm(q);
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
