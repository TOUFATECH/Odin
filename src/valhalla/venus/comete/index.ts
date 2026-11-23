// Vénus · Comète : la file des téléchargements de Vénus. Elle RÉUTILISE Atalante (l'appli de téléchargement d'Odin) :
// la vérification du lien et du site (avant), la sonde qui suit les redirections une à une, le téléchargement en
// morceaux avec reprise, l'antivirus à l'arrivée (quarantaine d'abord). Ce que Comète ajoute : la file dans VENUS_ODIN
// (`telechargements`), la taille vérifiée, le renommage et le rangement DANS un dossier déclaré de la bibliothèque, puis
// le scan du fichier pour que le titre apparaisse dans Vénus.
//
// Deux temps (choix du propriétaire) : d'abord les liens directs (HTTP/HTTPS) ; ensuite un moteur de partage de fichiers
// écrit dans Odin (bt/, lien magnet ou .torrent). Chaque moteur s'inscrit (`inscrireMoteur`) pour un genre de lien ;
// le fichier qu'il rend passe ensuite par la même chaîne (vidéo seulement, antivirus, mise à part, rangement).
//
// Sûreté : seul le propriétaire ajoute un téléchargement (contrôlé par l'action) ; le chemin final est TOUJOURS sous le
// dossier déclaré (aucun « .. », aucun séparateur venu d'un nom) ; taille maximale ; seule une vidéo est acceptée (nom,
// premiers octets, puis lecture par ffprobe) ; rien n'est jamais lancé ; chaque téléchargement est noté au journal.
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { ModCtx } from '../../types.ts';
import { avant, avisSite, lienSansParametres, RESOUDRE_SYSTEME, type Resoudre } from '../../atalante/rangement.ts';
import { fichiersDeTravail, sonder, telechargerMorceaux } from '../../atalante/morceaux.ts';
import { hoteInterdit, lienDeMaison } from '../../lien.ts';
import { isPrivateHost } from '../../../heimdall/policy.ts';
import { quarantaineDabord } from '../../ullr/garde.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../../vault.ts';
import { magasinVenus, type MagasinVenus } from '../base.ts';
import { dossiers, EXT_VIDEO, rangerFichier, type Categorie, type Outils } from '../bibliotheque.ts';
import { accepterPartage, type Resultat } from '../delta/index.ts';
import { fetchBorne, fetchVerifie, type Fetch } from '../reseau.ts';
import { moteurPartage } from './bt/moteur.ts';

export type EtatTelechargement = 'attente' | 'en_cours' | 'pause' | 'annule' | 'termine' | 'echec' | 'a_part';
export const MOTS_ETAT: Record<EtatTelechargement, string> = { attente: 'en attente', en_cours: 'en cours', pause: 'en pause', annule: 'annulé', termine: 'terminé', echec: 'échec', a_part: 'mis à part (antivirus)' };
/** Ce que le fichier deviendra dans la bibliothèque. */
export interface Cible { genre: 'film' | 'episode'; titre: string; annee?: number; saison?: number; episode?: number }
export interface Telechargement {
  id: string; titre: string; cible: Cible; moteur: 'direct' | 'partage'; source: string;
  /** le dossier déclaré de la bibliothèque où il sera rangé */
  racine: string; categorie: Categorie; tailleAnnoncee?: number;
  etat: EtatTelechargement; fait: number; total?: number; vitesse: number; texte?: string; chemin?: string; bibliotheque?: string;
  suivi?: string; demande?: string; ajoute: number; fini?: number;
}
const s = (v: unknown) => String(v ?? '').trim();
const OUVERTS: EtatTelechargement[] = ['attente', 'en_cours', 'pause'];

// ---------------------------------------------------------------- Réglages et outils (injectables pour les essais)
export interface ReglagesComete { tailleMaxGo: number; simultanes: number; debitMo: number }
export function reglagesComete(mag: MagasinVenus): ReglagesComete {
  const d = mag.get('acq_reglages', 'comete')?.data ?? {};
  return { tailleMaxGo: Math.min(500, Math.max(0.001, Number(d.tailleMaxGo) || 60)), simultanes: Math.min(4, Math.max(1, Math.round(Number(d.simultanes) || 2))), debitMo: Math.max(0, Number(d.debitMo) || 0) };
}
export function reglerComete(mag: MagasinVenus, p: Partial<ReglagesComete>): ReglagesComete {
  const r = { ...reglagesComete(mag) };
  if (p.tailleMaxGo !== undefined) { const v = Number(p.tailleMaxGo); if (!(v > 0) || v > 500) throw new Error('taille maximale : entre 0 et 500 Go'); r.tailleMaxGo = v; }
  if (p.simultanes !== undefined) r.simultanes = Math.min(4, Math.max(1, Math.round(Number(p.simultanes) || 1)));
  if (p.debitMo !== undefined) r.debitMo = Math.max(0, Number(p.debitMo) || 0);
  mag.poser('acq_reglages', 'comete', { ...r }); return reglagesComete(mag);
}
let outils: Outils | undefined;
let resoudre: Resoudre = RESOUDRE_SYSTEME;
let reseauEssai: Fetch | undefined;
/**
 * Les outils de Comète : ffprobe (lecture du fichier reçu) et la résolution des noms. Défauts réels ; faux en essai.
 * `reseauEssai` : SEULEMENT pour les essais (un serveur local) — il remplace la connexion vérifiée. Jamais par défaut.
 */
export function reglerOutilsComete(o: { outils?: Outils; resoudre?: Resoudre; reseauEssai?: Fetch } = {}): void { outils = o.outils; resoudre = o.resoudre ?? RESOUDRE_SYSTEME; reseauEssai = o.reseauEssai; }
const outilsDe = async (): Promise<Outils> => outils ?? (await import('../routes.ts')).outilsReels();
export const resoudreComete = (h: string): Promise<string[]> => resoudre(h);
/** Le réseau de Comète : connexion à l'adresse vérifiée seulement — jamais la machine d'Odin, jamais la maison. */
export const reseauComete = (): Fetch => reseauEssai ?? fetchVerifie({ resoudre, refuser: (a) => (hoteInterdit(a) || isPrivateHost(a) ? "le lien mène à la machine d'Odin ou à ton réseau : refusé" : undefined) });
/** Le réseau du catalogue des sorties : celui de Comète (jamais la machine d'Odin ni la maison, aucune redirection),
 *  qui accepte en plus un POST d'un texte court (le programme des animés pose sa question en POST). */
export const reseauCatalogue = (): Fetch => reseauEssai ?? fetchVerifie({ resoudre, post: true, refuser: (a) => (hoteInterdit(a) || isPrivateHost(a) ? "le catalogue mène à la machine d'Odin ou à ton réseau : refusé" : undefined) });
/** Le réseau de Delta : la source peut être dans la maison (ton propre indexeur), jamais la machine d'Odin elle-même. */
export const reseauDelta = (): Fetch => reseauEssai ?? fetchVerifie({ resoudre, refuser: (a) => (hoteInterdit(a) ? "l'adresse de la source mène à la machine d'Odin elle-même : refusé" : undefined) });
/** La place libre (octets) du disque d'un dossier, ou rien si le système ne la donne pas. */
export const placeLibre = (dossier: string): number | undefined => { try { const f = statfsSync(dossier); return Number(f.bavail) * Number(f.bsize); } catch { return undefined; } };
/** La marge gardée libre sur un disque après un téléchargement (2 Go). */
export const MARGE_DISQUE = 2e9;

// ---------------------------------------------------------------- Les moteurs (direct aujourd'hui ; partage plus tard)
export interface Progression { (fait: number, total?: number): void }
/** Un moteur de téléchargement. Il dépose le fichier reçu dans `dossier` et rend son chemin et sa taille. */
export interface MoteurComete {
  id: 'direct' | 'partage'; nom: string;
  sait(r: Pick<Resultat, 'genre' | 'lien'>): boolean;
  telecharger(ctx: ModCtx, lien: string, o: { nom: string; dossier: string; signal: AbortSignal; progression: Progression; tailleMax: number; debitMo?: number; /** lève une erreur s'il n'y a pas la place pour `taille` octets */ place?: (taille: number) => void; /** ce que le fichier deviendra (le moteur de partage y lit l'épisode voulu) */ cible?: Cible }): Promise<{ chemin: string; taille: number }>;
  /** efface ce qu'un téléchargement arrêté a laissé */
  nettoyer(dossier: string, nom: string): void;
}
/** Le moteur des liens directs : les briques d'Atalante (lien et site vérifiés, redirections revérifiées, morceaux). */
export const MOTEUR_DIRECT: MoteurComete = {
  id: 'direct', nom: 'liens directs (Atalante)',
  sait: (r) => r.genre === 'direct',
  async telecharger(ctx, lien, o) {
    if (lienDeMaison(lien)) throw new Error('ce lien pointe vers ton réseau : Comète ne le prend pas');
    const u = await avant(ctx, lien, { resoudre }), f = reseauComete();
    const sonde = await sonder(f, u.toString(), { signal: o.signal, garde: async (x) => {
      const ad = await resoudre(x.hostname.replace(/^\[|\]$/g, '')).catch(() => [] as string[]);
      if (ad.some(hoteInterdit) || lienDeMaison(x.toString()) || ad.some((a) => isPrivateHost(a))) throw new Error('le lien renvoie vers la machine d\'Odin ou ton réseau : refusé');
      await avisSite(ctx, x.toString());
    } });
    if (!sonde.taille) throw new Error('taille du fichier inconnue (le site ne la donne pas) : refusé par prudence');
    if (sonde.taille > o.tailleMax) throw new Error(`fichier trop gros (${Math.round(sonde.taille / 1e6)} Mo) pour la taille maximale réglée`);
    o.place?.(sonde.taille);
    o.progression(0, sonde.taille);
    // Chaque réponse est bornée : le fichier à sa taille annoncée, les petits fichiers voisins (empreinte) à 300 ko.
    const taille = sonde.taille, fb: Fetch = (x, i) => fetchBorne(f, x === sonde.url ? taille : 300_000)(x, i);
    const r = await telechargerMorceaux(fb, { url: sonde.url, sonde, nom: o.nom, dossier: o.dossier, morceaux: 4, signal: o.signal, progression: o.progression, ...(o.debitMo ? { debitMo: o.debitMo } : {}) });
    const vraie = statSync(r.chemin).size;
    if (vraie !== sonde.taille) { rmSync(r.chemin, { force: true }); throw new Error(`taille reçue fausse (${vraie} octets au lieu de ${sonde.taille}) : fichier effacé`); }
    return { chemin: r.chemin, taille: vraie };
  },
  nettoyer: (dossier, nom) => { for (const p of fichiersDeTravail(dossier, nom)) rmSync(p, { force: true }); rmSync(join(dossier, nom), { force: true }); },
};
const moteurs = new Map<string, MoteurComete>([['direct', MOTEUR_DIRECT]]);
// Le moteur de partage de fichiers (bt/) : le réseau vérifié de Comète pour les trackers HTTP ; les pairs locaux ne
// sont permis qu'avec le réglage d'essai explicite (`reseauEssai`).
moteurs.set('partage', moteurPartage({ reseau: () => reseauComete(), resoudre: (h) => resoudre(h), essai: () => reseauEssai !== undefined }));
accepterPartage(true);
/** Inscrit un moteur (remplace celui du même genre). */
export function inscrireMoteur(m: MoteurComete): void { moteurs.set(m.id, m); }
/** Le moteur qui sait prendre ce résultat (aucun pour un lien de partage aujourd'hui). */
export const moteurPour = (r: Pick<Resultat, 'genre' | 'lien'>): MoteurComete | undefined => [...moteurs.values()].find((m) => m.sait(r));
export const moteursInscrits = (): string[] => [...moteurs.values()].map((m) => m.nom);

// ---------------------------------------------------------------- Noms et chemins (purs)
/** Un morceau de nom de fichier sûr : ni séparateur, ni caractère interdit, ni « . » ou « .. », ni contrôle. Pur. */
export function nomSur(t: string): string {
  let x = s(t).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]+/g, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120).replace(/[.\s]+$/, '');
  if (!x || /^\.+$/.test(x)) throw new Error('nom vide après nettoyage');
  // Les noms que Windows réserve à ses périphériques (CON, NUL, COM1…), même suivis d'une extension : jamais tels quels.
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\s*\..*)?$/i.test(x)) x = x.replace(/^([a-z]{3}[0-9¹²³]?)/i, '$1_');
  return x;
}
const deux = (n: number) => String(n).padStart(2, '0');
/** Où ranger le fichier, relatif au dossier déclaré : « Titre (2024)/Titre (2024).mkv », « Série/Saison 01/Série - S01E02.mkv ». Pur. */
export function cheminRelatif(c: Cible, ext: string): string[] {
  if (!EXT_VIDEO.has(ext.toLowerCase())) throw new Error(`« ${ext} » n'est pas une vidéo : refusé`);
  const t = nomSur(c.titre);
  if (c.genre === 'film') { const n = `${t}${c.annee ? ` (${c.annee})` : ''}`; return [n, `${n}${ext.toLowerCase()}`]; }
  if (c.saison === undefined || c.episode === undefined) throw new Error('épisode sans saison ni numéro');
  return [t, `Saison ${deux(c.saison)}`, `${t} - S${deux(c.saison)}E${deux(c.episode)}${ext.toLowerCase()}`];
}
/** Le chemin final, vérifié : sous la racine, jamais ailleurs. Lève une erreur sinon. Pur. */
export function cheminFinal(racine: string, morceaux: string[]): string {
  const r = resolve(racine), f = resolve(r, ...morceaux);
  if (!f.startsWith(r + sep) || morceaux.some((m) => m === '..' || m.includes('/') || m.includes('\\'))) throw new Error('chemin hors du dossier de la bibliothèque : refusé');
  return f;
}
/** L'extension d'une vidéo, lue dans le lien ou le titre du résultat (rien si ce n'en est pas une). Pur. */
export function extensionDe(lien: string, titre: string): string | undefined {
  let p = ''; try { p = decodeURIComponent(new URL(lien).pathname); } catch { /* pas une adresse */ }
  for (const x of [p, titre]) { const e = extname(x).toLowerCase(); if (EXT_VIDEO.has(e)) return e; }
  return undefined;
}
/** Les premiers octets disent-ils un programme (Windows, Linux, macOS, script) ou une archive ? Pur sur le tampon. */
export function signatureRefusee(b: Buffer): string | undefined {
  if (b.subarray(0, 2).toString('latin1') === 'MZ') return 'un programme Windows';
  if (b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'un programme Linux';
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0)) return 'un programme macOS';
  if (b.subarray(0, 2).toString('latin1') === '#!') return 'un script';
  if (b.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' || b.subarray(0, 4).toString('latin1') === 'Rar!' || b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return 'une archive';
  return undefined;
}
const debut = (f: string) => { const fd = openSync(f, 'r'); try { const b = Buffer.alloc(16); return b.subarray(0, readSync(fd, b, 0, 16, 0)); } finally { closeSync(fd); } };
const deplacer = (de: string, vers: string) => { try { renameSync(de, vers); } catch { copyFileSync(de, vers); rmSync(de, { force: true }); } };
const libre = (f: string) => { const e = extname(f), b = f.slice(0, f.length - e.length); let x = f; for (let k = 2; existsSync(x) && k < 100; k++) x = `${b} (${k})${e}`; if (existsSync(x)) throw new Error('trop de fichiers du même nom'); return x; };

// ---------------------------------------------------------------- La file (VENUS_ODIN, collection telechargements)
const versT = (e: { id: string; data: Record<string, unknown> }): Telechargement => { const { lien: _l, ...d } = e.data; return { id: e.id, ...(d as Omit<Telechargement, 'id'>) }; };
export const telechargement = (mag: MagasinVenus, id: string): Telechargement | undefined => { const e = mag.get('telechargements', id); return e ? versT(e) : undefined; };
export const fileComete = (mag: MagasinVenus): Telechargement[] => mag.liste('telechargements').map(versT).sort((a, b) => b.ajoute - a.ajoute);
const lienDe = (mag: MagasinVenus, id: string): string => dechiffrerChamp(mag.home, s(mag.get('telechargements', id)?.data.lien));
function maj(mag: MagasinVenus, id: string, p: Partial<Telechargement>): Telechargement | undefined {
  const e = mag.get('telechargements', id); if (!e) return undefined;
  mag.poser('telechargements', id, { ...e.data, ...p }); return telechargement(mag, id);
}
/** Le journal des téléchargements (chaque ajout, fin, échec, annulation), sans paramètres d'adresse. */
export function noter(mag: MagasinVenus, quoi: string, t: Pick<Telechargement, 'id' | 'titre'> & { lien?: string }, texte = ''): void {
  mag.poser('acq_journal', `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, { at: Date.now(), quoi, telechargement: t.id, titre: t.titre, ...(t.lien ? { lien: lienSansParametres(t.lien) } : {}), texte: texte.slice(0, 300) });
  const l = mag.liste('acq_journal'); if (l.length > 2000) for (const x of l.sort((a, b) => a.maj - b.maj).slice(0, l.length - 2000)) mag.retirer('acq_journal', x.id);
}
export const journalComete = (mag: MagasinVenus, n = 50): Array<{ at: number; quoi: string; titre: string; lien?: string; texte: string }> =>
  mag.liste('acq_journal').map((e) => e.data as { at: number; quoi: string; titre: string; lien?: string; texte: string }).sort((a, b) => b.at - a.at).slice(0, n);

/** Ce qui se passe quand un téléchargement change d'état (Hnoss et les suivis s'y abonnent). */
export type Ecouteur = (ctx: ModCtx, t: Telechargement) => void;
const ecouteurs = new Set<Ecouteur>();
export function quandFini(f: Ecouteur): () => void { ecouteurs.add(f); return () => ecouteurs.delete(f); }
const prevenir = (ctx: ModCtx, t: Telechargement | undefined) => { if (t) for (const f of ecouteurs) { try { f(ctx, t); } catch (e) { console.error(`[venus] comète : ${(e as Error).message}`); } } };

/** Met un résultat en file. La racine doit être un dossier DÉCLARÉ de la bibliothèque, de la bonne catégorie. */
export function ajouter(ctx: ModCtx, o: { resultat: Pick<Resultat, 'titre' | 'lien' | 'taille' | 'genre' | 'sourceNom'>; cible: Cible; racine: string; suivi?: string; demande?: string }): Telechargement {
  const mag = magasinVenus(ctx.home, ctx.dir), categorie: Categorie = o.cible.genre === 'film' ? 'films' : 'series';
  if (!dossiers(mag).some((d) => d.actif && d.categorie === categorie && d.chemin === o.racine)) throw new Error(`le dossier « ${o.racine} » n'est pas un dossier « ${categorie} » déclaré dans Vénus : refusé`);
  const moteur = moteurPour(o.resultat);
  if (!moteur) throw new Error(o.resultat.genre === 'partage' ? 'lien de partage de fichiers : le moteur de partage de Comète n\'est pas encore là' : 'pas un lien direct vers une vidéo : Comète ne sait pas le prendre');
  const r = reglagesComete(mag), max = r.tailleMaxGo * 1e9;
  if (o.resultat.taille && o.resultat.taille > max) throw new Error(`trop gros (${Math.round(o.resultat.taille / 1e9)} Go) pour la taille maximale (${r.tailleMaxGo} Go)`);
  // Un partage : l'extension n'est connue qu'avec sa description (le moteur ne garde qu'une vidéo) ; le chemin est
  // vérifié ici avec « .mkv », puis de nouveau avec la vraie extension au rangement.
  const ext = extensionDe(o.resultat.lien, o.resultat.titre) ?? (moteur.id === 'partage' ? '.mkv' : undefined); if (!ext) throw new Error('le lien ne mène pas à une vidéo : refusé');
  cheminFinal(o.racine, cheminRelatif(o.cible, ext)); // vérifié dès l'ajout : un titre piégé ne rentre pas dans la file
  const ouvert = fileComete(mag).find((t) => (OUVERTS.includes(t.etat) || t.etat === 'a_part') && t.cible.genre === o.cible.genre && t.cible.titre === o.cible.titre && t.cible.annee === o.cible.annee && t.cible.saison === o.cible.saison && t.cible.episode === o.cible.episode);
  if (ouvert) return ouvert;
  const id = `c-${randomBytes(8).toString('hex')}`;
  mag.poser('telechargements', id, {
    titre: o.resultat.titre.slice(0, 300), lien: chiffrerChamp(ctx.home, o.resultat.lien), cible: o.cible, moteur: moteur.id, source: o.resultat.sourceNom,
    racine: o.racine, categorie, ...(o.resultat.taille ? { tailleAnnoncee: o.resultat.taille } : {}), etat: 'attente', fait: 0, vitesse: 0,
    ...(o.suivi ? { suivi: o.suivi } : {}), ...(o.demande ? { demande: o.demande } : {}), ajoute: Date.now(),
  });
  const t = telechargement(mag, id)!; noter(mag, 'ajouté', { ...t, lien: o.resultat.lien }, `vers ${o.racine}`);
  pousser(ctx);
  return t;
}

// ---------------------------------------------------------------- Le moteur de la file
const actifs = new Map<string, { ac: AbortController; pourquoi?: 'pause' | 'annule' }>();
const enVol = new Set<Promise<void>>();
const enCours = (ctx: ModCtx) => join(ctx.dir, 'comete', 'en-cours');
/** (essais) attend la fin de ce qui tourne. */
export async function attendreComete(): Promise<void> { while (enVol.size) await Promise.allSettled([...enVol]); }
/** Lance ce qui attend, dans la limite des téléchargements simultanés. Rend le nombre lancé. */
export function pousser(ctx: ModCtx): number {
  const mag = magasinVenus(ctx.home, ctx.dir), places = reglagesComete(mag).simultanes - actifs.size;
  const l = fileComete(mag).filter((t) => t.etat === 'attente' && !actifs.has(t.id)).sort((a, b) => a.ajoute - b.ajoute).slice(0, Math.max(0, places));
  for (const t of l) { const p = lancer(ctx, t.id).finally(() => { enVol.delete(p); pousser(ctx); }); enVol.add(p); }
  return l.length;
}
async function lancer(ctx: ModCtx, id: string): Promise<void> {
  const mag = magasinVenus(ctx.home, ctx.dir), t0 = telechargement(mag, id); if (!t0) return;
  const moteur = moteurs.get(t0.moteur), slot: { ac: AbortController; pourquoi?: 'pause' | 'annule' } = { ac: new AbortController() }; actifs.set(id, slot);
  const nomTravail = `${id}${extensionDe(lienDe(mag, id), t0.titre) ?? '.bin'}`;
  maj(mag, id, { etat: 'en_cours', texte: 'téléchargement', vitesse: 0 });
  let dernier = { t: Date.now(), fait: t0.fait }, ecrit = 0;
  const progression: Progression = (fait, total) => {
    const now = Date.now(), dt = (now - dernier.t) / 1000;
    if (dt >= 0.5) { const v = Math.max(0, Math.round((fait - dernier.fait) / dt)); dernier = { t: now, fait }; if (now - ecrit > 1000) { ecrit = now; maj(mag, id, { fait, ...(total ? { total } : {}), vitesse: v }); } }
  };
  try {
    if (!moteur) throw new Error('moteur absent');
    const r = reglagesComete(mag);
    // La place : le fichier entier, plus une marge, sur le disque d'Odin (où il arrive) et sur celui de la bibliothèque.
    const place = (taille: number) => { for (const d of [enCours(ctx), t0.racine]) { const l = placeLibre(existsSync(d) ? d : resolve(d, '..')); if (l !== undefined && l < taille + MARGE_DISQUE) throw new Error(`pas assez de place sur le disque de ${d === t0.racine ? 'la bibliothèque' : 'Odin'} (${Math.round(l / 1e9)} Go libres, il en faut ${Math.ceil((taille + MARGE_DISQUE) / 1e9)}) : rien n'est téléchargé`); } };
    const recu = await moteur.telecharger(ctx, lienDe(mag, id), { nom: nomTravail, dossier: enCours(ctx), signal: slot.ac.signal, progression, tailleMax: r.tailleMaxGo * 1e9, place, cible: t0.cible, ...(r.debitMo ? { debitMo: r.debitMo } : {}) });
    const extRecue = EXT_VIDEO.has(extname(recu.chemin).toLowerCase()) ? extname(recu.chemin).toLowerCase() : extname(nomTravail);
    // Annulé pendant les vérifications d'après (antivirus, lecture) : il ne doit jamais finir rangé.
    const arrete = () => { if (slot.pourquoi === 'annule') { rmSync(recu.chemin, { force: true }); throw new Error('annulé'); } };
    arrete();
    const t = maj(mag, id, { fait: recu.taille, total: recu.taille, vitesse: 0, texte: 'vérification' })!;
    // (un partage annonce la taille de TOUT le partage ; seule la vidéo est prise, sa taille est garantie par l'empreinte)
    if (t.moteur === 'direct' && t.tailleAnnoncee && Math.abs(recu.taille - t.tailleAnnoncee) > Math.max(1024 * 1024, t.tailleAnnoncee * 0.02)) { rmSync(recu.chemin, { force: true }); throw new Error(`la taille reçue (${recu.taille} octets) ne correspond pas à l'annonce de la source (${t.tailleAnnoncee}) : fichier effacé`); }
    const sig = signatureRefusee(debut(recu.chemin)); if (sig) { rmSync(recu.chemin, { force: true }); throw new Error(`le fichier reçu est ${sig}, pas une vidéo : effacé, rien n'est lancé`); }
    const p = await quarantaineDabord({ origine: 'Vénus · Comète · téléchargement', fichier: recu.chemin, source: lienSansParametres(lienDe(mag, id)) }, ctx);
    if (p.bloque) throw new Error(`bloqué par l'antivirus : ${p.menace ?? 'menace'} (en quarantaine)`);
    arrete();
    const o = await outilsDe(), probe = await o.ffprobe(recu.chemin).catch(() => null);
    arrete();
    if (!probe || !(probe.duree > 0)) { rmSync(recu.chemin, { force: true }); throw new Error("le fichier reçu n'est pas une vidéo lisible : effacé"); }
    // L'antivirus a un doute (sans bloquer) : le fichier est MIS À PART, hors de la bibliothèque, jusqu'à l'accord du
    // propriétaire (comete_accepter ou comete_jeter).
    if (!p.ok) {
      mkdirSync(aPart(ctx), { recursive: true, mode: 0o700 }); const ici = join(aPart(ctx), basename(recu.chemin)); deplacer(recu.chemin, ici);
      const x = maj(mag, id, { etat: 'a_part', texte: `mis à part : l'antivirus a un doute (${s((p as { texte?: string }).texte).slice(0, 120) || 'douteux'}) — à accepter ou jeter`, chemin: ici, vitesse: 0 })!;
      noter(mag, 'mis à part', { ...x, lien: lienDe(mag, id) }, 'antivirus douteux : attend ton accord');
      return;
    }
    await rangerRecu(ctx, id, recu.chemin, extRecue, 'sain', o);
  } catch (err) {
    if (slot.pourquoi) {
      if (slot.pourquoi === 'annule') { moteur?.nettoyer(enCours(ctx), nomTravail); const x = maj(mag, id, { etat: 'annule', texte: 'annulé', vitesse: 0 }); if (x) { noter(mag, 'annulé', x); prevenir(ctx, x); } }
      else maj(mag, id, { etat: 'pause', texte: 'en pause', vitesse: 0 });
      return;
    }
    const m = (err as Error).message.replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300);
    const x = maj(mag, id, { etat: 'echec', texte: m, vitesse: 0, fini: Date.now() });
    if (x) { noter(mag, 'échec', { ...x, lien: lienDe(mag, id) }, m); prevenir(ctx, x); }
  } finally { actifs.delete(id); }
}

const aPart = (ctx: ModCtx) => join(ctx.dir, 'comete', 'a-part');
/** Range un fichier reçu et vérifié dans son dossier déclaré, sans rien écraser, puis le fait lire par le scan. */
async function rangerRecu(ctx: ModCtx, id: string, chemin: string, ext: string, avis: string, o: Outils): Promise<void> {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id)!;
    const final = libre(cheminFinal(t.racine, cheminRelatif(t.cible, ext)));
    if (!dossiers(mag).some((d) => d.actif && d.chemin === t.racine && d.categorie === t.categorie)) throw new Error('le dossier de la bibliothèque n\'est plus déclaré : fichier gardé à part');
    // Un dossier du chemin remplacé par un lien ou une jonction vers ailleurs : refusé, et rien n'est créé hors de la
    // bibliothèque (chaque niveau est vérifié AVANT d'y créer le suivant).
    const vraiR = realpathSync.native(t.racine), sous = (x: string) => { const v = realpathSync.native(x); if (v !== vraiR && !v.startsWith(vraiR + sep)) throw new Error('un dossier du chemin mène hors de la bibliothèque : refusé'); };
    let niveau = resolve(t.racine);
    for (const morceau of resolve(final, '..').slice(niveau.length + 1).split(sep).filter(Boolean)) { niveau = join(niveau, morceau); if (!existsSync(niveau)) mkdirSync(niveau); sous(niveau); }
    deplacer(chemin, final);
    const st = statSync(final), rg = await rangerFichier(mag, { chemin: final, taille: st.size, mtime: Math.trunc(st.mtimeMs) }, t.categorie, o, [], new Set(), t.racine);
    if ('raison' in rg) throw new Error(`rangé dans ${basename(final)}, mais le scan ne l'a pas pris (${rg.raison})`);
    const fin = maj(mag, id, { etat: 'termine', texte: `rangé : ${basename(final)}`, chemin: final, bibliotheque: rg.cibleId, fini: Date.now() })!;
    noter(mag, 'terminé', { ...fin, lien: lienDe(mag, id) }, `${st.size} octets · antivirus ${avis} · ${basename(final)}`);
    prevenir(ctx, fin);
}
/** Le propriétaire accepte un fichier mis à part (doute de l'antivirus) : il est rangé dans la bibliothèque. */
export async function accepter(ctx: ModCtx, id: string): Promise<Telechargement> {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) throw new Error(`téléchargement « ${id} » inconnu`);
  if (t.etat !== 'a_part' || !t.chemin || !existsSync(t.chemin)) throw new Error("ce téléchargement n'est pas mis à part");
  noter(mag, 'accepté', { ...t, lien: lienDe(mag, id) }, "accepté par le propriétaire malgré le doute de l'antivirus");
  try { await rangerRecu(ctx, id, t.chemin, extname(t.chemin), 'douteux, accepté par le propriétaire', await outilsDe()); }
  catch (e) { const m = (e as Error).message.slice(0, 300), x = maj(mag, id, { etat: 'echec', texte: m, fini: Date.now() }); if (x) { noter(mag, 'échec', x, m); prevenir(ctx, x); } }
  return telechargement(mag, id)!;
}
/** Le propriétaire jette un fichier mis à part : il est effacé, rien n'entre dans la bibliothèque. */
export function jeter(ctx: ModCtx, id: string): Telechargement {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) throw new Error(`téléchargement « ${id} » inconnu`);
  if (t.etat !== 'a_part') throw new Error("ce téléchargement n'est pas mis à part");
  if (t.chemin) rmSync(t.chemin, { force: true });
  const x = maj(mag, id, { etat: 'echec', texte: "jeté (doute de l'antivirus)", chemin: undefined, fini: Date.now() })!;
  noter(mag, 'jeté', x, 'jeté par le propriétaire'); prevenir(ctx, x);
  return x;
}

/** Pause : le téléchargement s'arrête et garde ce qui est reçu. */
export function pause(ctx: ModCtx, id: string): Telechargement {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) throw new Error(`téléchargement « ${id} » inconnu`);
  const a = actifs.get(id); if (a) { a.pourquoi = 'pause'; a.ac.abort(); } else if (t.etat === 'attente') maj(mag, id, { etat: 'pause', texte: 'en pause' });
  return telechargement(mag, id)!;
}
/** Reprendre : il repart où il s'était arrêté (ou de zéro après un échec). */
export function reprendre(ctx: ModCtx, id: string): Telechargement {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) throw new Error(`téléchargement « ${id} » inconnu`);
  if (t.etat === 'pause' || t.etat === 'echec') { maj(mag, id, { etat: 'attente', texte: 'reprise demandée' }); noter(mag, 'repris', t); pousser(ctx); }
  return telechargement(mag, id)!;
}
/** Annuler : il s'arrête et ce qui est reçu est effacé. */
export function annuler(ctx: ModCtx, id: string): Telechargement {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) throw new Error(`téléchargement « ${id} » inconnu`);
  const a = actifs.get(id);
  if (a) { a.pourquoi = 'annule'; maj(mag, id, { annulation: true } as Partial<Telechargement>); a.ac.abort(); }
  else if (OUVERTS.includes(t.etat)) { moteurs.get(t.moteur)?.nettoyer(enCours(ctx), `${id}${extensionDe(lienDe(mag, id), t.titre) ?? '.bin'}`); const x = maj(mag, id, { etat: 'annule', texte: 'annulé' }); if (x) { noter(mag, 'annulé', x); prevenir(ctx, x); } }
  return telechargement(mag, id)!;
}
/** Retire un téléchargement fini (ou annulé, ou en échec) de la file ; un fichier rangé reste à sa place. */
export function retirer(ctx: ModCtx, id: string): boolean {
  const mag = magasinVenus(ctx.home, ctx.dir), t = telechargement(mag, id); if (!t) return false;
  if (OUVERTS.includes(t.etat)) throw new Error('annule-le d\'abord');
  if (t.etat === 'a_part') throw new Error('accepte-le ou jette-le d\'abord');
  return mag.retirer('telechargements', id);
}
/** Arrête tout (arrêt d'Odin) : ce qui tourne passe en pause et reprendra. */
export function arreterTout(): void { for (const a of actifs.values()) { a.pourquoi ??= 'pause'; a.ac.abort(); } }
/** Au démarrage : ce qui était « en cours » quand Odin s'est arrêté repart en attente. */
export function relancer(ctx: ModCtx): void {
  const mag = magasinVenus(ctx.home, ctx.dir);
  for (const t of fileComete(mag)) {
    if (actifs.has(t.id) || !OUVERTS.includes(t.etat)) continue;
    // Annulé juste avant un arrêt brutal : jamais repris, ce qui est reçu est effacé.
    if ((t as Telechargement & { annulation?: boolean }).annulation) { moteurs.get(t.moteur)?.nettoyer(enCours(ctx), `${t.id}${extensionDe(lienDe(mag, t.id), t.titre) ?? '.bin'}`); const x = maj(mag, t.id, { etat: 'annule', texte: 'annulé', vitesse: 0 }); if (x) { noter(mag, 'annulé', x); prevenir(ctx, x); } continue; }
    if (t.etat === 'en_cours') maj(mag, t.id, { etat: 'attente', texte: 'reprise après redémarrage' });
  }
  pousser(ctx);
}
/** Une ligne lisible. Pur. */
export const ligneTelechargement = (t: Telechargement): string => {
  const pct = t.total ? Math.min(100, Math.round(t.fait / t.total * 100)) : 0, c = t.cible;
  return `${MOTS_ETAT[t.etat]} · ${c.titre}${c.genre === 'episode' ? ` S${deux(c.saison ?? 0)}E${deux(c.episode ?? 0)}` : c.annee ? ` (${c.annee})` : ''}${t.total ? ` · ${pct} %` : ''}${t.etat === 'en_cours' && t.vitesse ? ` · ${(t.vitesse / 1e6).toFixed(1)} Mo/s` : ''}${t.texte && t.etat !== 'en_cours' ? ` · ${t.texte}` : ''}`;
};
