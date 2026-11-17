// Médias reçus : les étapes communes de « comprendre » (photo, son, vidéo, document). Appeler une brique sans jamais
// bloquer (délai, arrêt, exception rangée comme un manque), reconnaître la langue d'un texte (la langue reconnue
// l'emporte ; celle de la transcription n'est qu'un indice ; la langue déclarée n'est qu'un indice), écouter un son
// (oreille puis transcription), repérer les hésitations, écrire les sous-titres et les traduire. Rien n'est inventé :
// ce qui manque est dit avec sa raison et le moyen de l'obtenir.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalyseSon } from '../audio/contrat.ts';
import type { Compris, OptionsComprendre } from './comprendre.ts';
import { BORNES, BriqueIndisponible, COMMENT, type Briques, type CodeManque, type Manque, type Mot, type Segment } from './contrat.ts';
import { compterLettres, ecritureDominante } from './ecritures.ts';
import { reperer, type Hesitations } from './hesitations.ts';
import { memeLangue, nomLangue, versBcp47 } from './langues-codes.ts';
import { nettoyerTexte } from './octets.ts';
import { avecDelai, ecrireSrt, ecrireVtt, repliquesDepuisSegments, traduireRepliques, type Replique } from './sous-titres.ts';

/** L'état d'une compréhension en cours. */
export interface Etat { c: Compris; o: OptionsComprendre; arrete: boolean; remarques: string[] }

/** Délais par défaut des briques (ms). */
export const DELAIS = { son: 10 * 60_000, image: 60_000, document: 120_000, traduireReplique: 30_000, traduireTexte: 120_000, sousTitres: 120_000, extraire: 30 * 60_000 } as const;
export type CleDelai = keyof typeof DELAIS;
/** Le délai d'une sorte de brique (réglable par l'appelant : OptionsComprendre.delaisMs). */
export function delai(e: Etat, k: CleDelai): number {
  const v = e.o.delaisMs?.[k];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DELAIS[k];
}

/** Les manques par défaut quand la fabrique n'a rien dit d'une brique absente. */
const DEFAUTS: Partial<Record<CodeManque, Manque>> = {
  transcription: { quoi: 'la parole', raison: 'transcription locale non installée', commentObtenir: COMMENT.transcription, code: 'transcription' },
  ocr: { quoi: 'le texte de l\'image', raison: 'aucune lecture de texte d\'image sur la machine', commentObtenir: COMMENT.ocr, code: 'ocr' },
  vision: { quoi: 'la description de l\'image', raison: 'aucun modèle de vision local', commentObtenir: COMMENT.vision, code: 'vision' },
  ffmpeg: { quoi: 'le son et les images de la vidéo', raison: 'FFmpeg n\'est pas installé', commentObtenir: COMMENT.ffmpeg, code: 'ffmpeg' },
  'modele-sons': { quoi: 'les sons reconnus (hors parole et musique)', raison: 'modèle de sons non téléchargé', commentObtenir: COMMENT.modeleSons, code: 'modele-sons' },
  langue: { quoi: 'la langue du texte', raison: 'reconnaisseur de langue non chargé', commentObtenir: COMMENT.langue, code: 'langue' },
  traduction: { quoi: 'la traduction', raison: 'aucune fonction de traduction donnée', commentObtenir: COMMENT.traduction, code: 'traduction' },
  oreille: { quoi: 'l\'écoute du son (musique, sons, parole)', raison: 'l\'oreille d\'Odin n\'a pas pu être chargée', commentObtenir: COMMENT.oreille, code: 'oreille' },
};

export function ajouterManqueC(e: Etat, m: Manque): void {
  if (!e.c.manque.some((x) => x.code === m.code && x.quoi === m.quoi)) e.c.manque.push(m);
}
/** Une brique qu'il aurait fallu : son absence est dite (texte de la fabrique, sinon texte par défaut). */
export function besoin(e: Etat, code: CodeManque): void {
  const m = e.o.briques.absentes.find((x) => x.code === code) ?? DEFAUTS[code];
  if (m) ajouterManqueC(e, m);
}
export function remarqueC(e: Etat, r: string): void { if (!e.remarques.includes(r) && e.remarques.length < 100) e.remarques.push(r); }

/** Arrêt demandé : dit une fois. */
export function verifierArret(e: Etat): boolean {
  if (e.o.signal?.aborted && !e.arrete) { e.arrete = true; ajouterManqueC(e, { quoi: 'la suite de la lecture', raison: 'arrêt demandé', code: 'arrete' }); }
  return e.arrete;
}

const court = (x: unknown) => String((x as Error)?.message ?? x ?? 'erreur').split('\n')[0].slice(0, 160);

/** Appelle une brique : délai, arrêt, exception → manque. Rend undefined si elle n'a rien rendu. */
export async function appeler<T>(e: Etat, nom: string, fn: (signal: AbortSignal) => Promise<T>, delaiMs: number): Promise<T | undefined> {
  if (verifierArret(e)) return undefined;
  const ctl = new AbortController();
  const relais = () => ctl.abort();
  e.o.signal?.addEventListener('abort', relais, { once: true });
  try {
    return await avecDelai(Promise.resolve().then(() => fn(ctl.signal)), delaiMs, e.o.signal, `brique ${nom}`);
  } catch (x) {
    ctl.abort();
    if (e.o.signal?.aborted) { verifierArret(e); return undefined; }
    if (x instanceof BriqueIndisponible) { ajouterManqueC(e, x.manque); return undefined; }
    ajouterManqueC(e, { quoi: `le résultat de ${nom}`, raison: `brique ${nom} : ${court(x)}`, code: 'echec' });
    return undefined;
  } finally { e.o.signal?.removeEventListener('abort', relais); }
}

// ─────────────────────────────── Rebornage de ce que rend une brique ───────────────────────────────

/**
 * Le texte rendu par une brique (ou tiré du fichier), nettoyé et borné. Les contrôles bidi d'enchâssement (U+202A–U+202E,
 * U+2066–U+2069) sont retirés : ils pourraient retourner l'affichage et faire passer un texte du fichier pour une
 * section d'Odin. Les marques simples U+200E/U+200F (utiles à l'arabe, à l'hébreu) sont gardées.
 */
export function texteBorne(t: unknown): string {
  const brut = typeof t === 'string' ? t : '';
  // Classe de caractères seule (aucun recul possible) : le cas courant ne paie pas la copie.
  if (!/[‪-‮⁦-⁩]/u.test(brut)) return nettoyerTexte(brut, 'utf-8', { max: BORNES.texteLu }).texte;
  let r = '';
  for (const ch of brut.length > 4 * BORNES.texteLu ? brut.slice(0, 4 * BORNES.texteLu) : brut) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue;
    r += ch;
  }
  return nettoyerTexte(r, 'utf-8', { max: BORNES.texteLu }).texte;
}
export function segmentsBornes(s: unknown): Segment[] {
  if (!Array.isArray(s)) return [];
  const r: Segment[] = [];
  for (const x of s.slice(0, BORNES.sousTitresRepliques)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Partial<Segment>;
    let d = Number(o.debut), f = Number(o.fin);
    if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
    if (d > f) [d, f] = [f, d];
    const texte = nettoyerTexte(typeof o.texte === 'string' ? o.texte : '', 'utf-8', { max: 4096 }).texte;
    if (!texte) continue;
    const seg: Segment = { debut: Math.max(0, d), fin: Math.max(0, f), texte };
    if (Number.isFinite(o.confiance)) seg.confiance = o.confiance;
    if (typeof o.voix === 'string' && o.voix) seg.voix = o.voix.slice(0, 64);
    r.push(seg);
  }
  return r.sort((a, b) => a.debut - b.debut);
}
export function motsBornes(m: unknown): Mot[] | undefined {
  if (!Array.isArray(m) || !m.length) return undefined;
  return segmentsBornes(m).map(({ debut, fin, texte, confiance }) => (confiance !== undefined ? { debut, fin, texte, confiance } : { debut, fin, texte }));
}

// ─────────────────────────────── Langue ───────────────────────────────

export type Partie = Compris['langues'][number]['partie'];
const SOURCE_LANGUE: Record<Partie, NonNullable<Compris['langue']>['source']> = {
  texte: 'texte lu', parole: 'parole', 'texte à l\'image': 'texte à l\'image', 'paroles de chanson': 'parole', 'sous-titres inclus': 'texte lu',
};

/**
 * La langue d'un texte. Reconnue (au moins 20 lettres, reconnaisseur sûr) : elle l'emporte. Sinon la langue de la
 * transcription (confiance 0,5, « non vérifiée »). La langue déclarée n'est qu'un indice : un désaccord est écrit.
 */
export function langueDe(e: Etat, texte: string, partie: Partie, o: { declaree?: string; transcription?: string } = {}): { code?: string; confiance: number } {
  const ecriture = ecritureDominante(texte);
  const declaree = versBcp47(o.declaree);
  const tr = versBcp47(o.transcription);
  let code: string | undefined, confiance = 0, hypothese: string | undefined, sure = false;
  const r = e.o.briques.reconnaitreLangue;
  if (!r) { if (compterLettres(texte, 1)) besoin(e, 'langue'); }
  else if (compterLettres(texte, 20) >= 20) {
    try {
      const x = r(texte.slice(0, 20_000));
      const c = versBcp47(x.langue);
      if (c) { code = c; confiance = Math.max(0, Math.min(1, x.confiance)); sure = true; }
      else { confiance = Math.max(0, Math.min(1, x.confiance || 0)); hypothese = versBcp47(x.hypothese); }
    } catch (x) { ajouterManqueC(e, { quoi: 'la langue du texte', raison: `reconnaisseur de langue : ${court(x)}`, code: 'echec' }); }
  }
  let desaccord: string | undefined;
  if (!code && tr) { code = tr; confiance = 0.5; remarqueC(e, 'langue donnée par la transcription, non vérifiée'); }
  else if (code && tr && sure && !memeLangue(tr, code)) desaccord = `transcription : ${nomLangue(tr)} ; reconnue : ${nomLangue(code)}`;
  if (code && declaree && sure && !memeLangue(declaree, code)) desaccord = [desaccord, `déclarée : ${nomLangue(declaree)} ; reconnue : ${nomLangue(code)}`].filter(Boolean).join(' · ');
  const ligne: Compris['langues'][number] = { partie, confiance };
  if (code) { ligne.code = code; ligne.nom = nomLangue(code); }
  if (declaree) ligne.declaree = declaree;
  if (desaccord) ligne.desaccord = desaccord;
  if (e.c.langues.length < 64) e.c.langues.push(ligne);
  // Langue principale : la première partie qui a une langue, remplacée par une langue sûre si la première ne l'était pas.
  const actuelle = e.c.langue;
  if (code && (!actuelle?.code || (actuelle.confiance < 0.6 && confiance >= 0.6))) {
    e.c.langue = { code, nom: nomLangue(code), confiance, ecriture, source: SOURCE_LANGUE[partie] };
  } else if (!actuelle && (hypothese || ecriture !== 'inconnue')) {
    e.c.langue = { confiance, ecriture, source: SOURCE_LANGUE[partie], ...(hypothese ? { hypothese } : {}) };
  }
  return code ? { code, confiance } : { confiance };
}

// ─────────────────────────────── Consignes cachées ───────────────────────────────

export function chercherConsignes(e: Etat, textes: string[]): void {
  const d = e.o.briques.detecterConsignes;
  if (!d) return;
  const motifs = new Set<string>(e.c.consignesSuspectes ?? []);
  for (const t of textes) {
    if (!t) continue;
    try { const r = d(t.slice(0, 200_000)); if (r?.suspect) for (const m of (r.motifs ?? []).slice(0, 16)) motifs.add(String(m).slice(0, 120)); }
    catch { /* le détecteur a échoué sur ce texte : rien n'est affirmé */ }
  }
  if (motifs.size) e.c.consignesSuspectes = [...motifs].slice(0, 32);
}

// ─────────────────────────────── Écouter ───────────────────────────────

/** Seuil sous lequel un tempo ou une tonalité n'est pas affirmé (« incertain »). */
export const SEUIL_MUSIQUE = 0.5;
const part = (x: unknown): number => { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Ce qu'on entend d'une analyse de l'oreille (musique, sons) : des lignes vraies, rien de plus. Chaque valeur garde SA
 * confiance : un tempo ou une tonalité sous 0,5 est dit « incertain », jamais affirmé ; une musique estimée sans modèle
 * est dite « possible (estimation sans modèle) ».
 */
export function entenduDe(a: AnalyseSon): NonNullable<Compris['entendu']> {
  const lignes: string[] = [];
  const r: NonNullable<Compris['entendu']> = { lignes };
  if (a.musique?.probable) {
    const m = a.musique, t = m.tempo, k = m.tonalite;
    const parModele = m.par === 'modele';
    const cm = part(m.confiance);
    r.musique = { confiance: cm, parModele };
    const morceaux = [parModele ? `musique probable (confiance ${pct(cm)})` : `musique possible (estimation sans modèle, ${pct(cm)})`];
    if (t && Number.isFinite(t.bpm) && t.bpm > 0) {
      const ct = part(t.confiance);
      r.musique.confianceTempo = ct;
      if (ct >= SEUIL_MUSIQUE) { r.musique.tempo = Math.round(t.bpm); morceaux.push(`tempo ${r.musique.tempo} BPM (${pct(ct)})`); }
      else morceaux.push(`tempo incertain (${pct(ct)})`);
    }
    if (k?.nom) {
      const ck = part(k.confiance);
      r.musique.confianceTonalite = ck;
      if (ck >= SEUIL_MUSIQUE) { r.musique.tonalite = String(k.nom).slice(0, 40); morceaux.push(`${r.musique.tonalite} (${pct(ck)})`); }
      else morceaux.push(`tonalité incertaine (${pct(ck)})`);
    }
    lignes.push(morceaux.join(', '));
  }
  if (a.sons?.etat === 'fait' && a.sons.etiquettes?.length) {
    r.sons = a.sons.etiquettes.slice(0, 8).map((x) => x.libelle);
    lignes.push(`sons reconnus : ${r.sons.join(', ')}`);
  }
  if (Number.isFinite(a.duree)) lignes.push(`durée écoutée : ${Math.round(a.duree)} s`);
  return r;
}

/** Écoute un fichier son : oreille (musique, sons, parole) puis transcription si la parole n'est pas faite. */
export async function ecouter(e: Etat, fichier: string, o: { dureeSec?: number; avecSousTitres: boolean; base: string }): Promise<void> {
  const b = e.o.briques;
  let analyse: AnalyseSon | undefined;
  if (b.analyserSon) {
    analyse = await appeler(e, 'analyserSon', (signal) => b.analyserSon!(fichier, { avecParole: true, signal }), delai(e, 'son'));
    if (analyse) {
      e.c.entendu = entenduDe(analyse);
      if (analyse.sons?.etat === 'pas_pret' || (analyse.sons?.etat !== 'fait' && b.absentes.some((m) => m.code === 'modele-sons'))) besoin(e, 'modele-sons');
    }
  } else besoin(e, 'oreille');
  if (verifierArret(e)) return;
  let texte = '', segments: Segment[] = [], mots: Mot[] | undefined, via = '', langueTr: string | undefined, tours: number | undefined;
  const parole = analyse?.parole;
  if (parole?.etat === 'faite' && parole.texte) {
    texte = texteBorne(parole.texte);
    const voixDe = (d: number, f: number) => parole.tours?.find((t) => t.debut <= (d + f) / 2 && t.fin >= (d + f) / 2)?.voix;
    segments = segmentsBornes(parole.segments.map((s) => ({ debut: s.debut, fin: s.fin, texte: s.texte ?? '', voix: voixDe(s.debut, s.fin) })));
    via = 'oreille d\'Odin (transcription locale)';
    langueTr = parole.langue;
    tours = new Set((parole.tours ?? []).map((t) => t.voix)).size || undefined;
  } else if (b.transcrire) {
    const t = await appeler(e, 'transcrire', (signal) => b.transcrire!(fichier, { signal, dureeSec: o.dureeSec }), delai(e, 'son'));
    if (t) {
      texte = texteBorne(t.texte);
      segments = segmentsBornes(t.segments);
      mots = motsBornes(t.mots);
      via = String(t.via ?? 'transcription').slice(0, 120);
      langueTr = t.langue;
      if (!texte && segments.length) texte = texteBorne(segments.map((s) => s.texte).join(' '));
    }
  } else besoin(e, 'transcription');
  if (!texte) {
    if (via) ajouterManqueC(e, { quoi: 'la parole', raison: 'aucune parole reconnue dans le son', code: 'absent' });
    return;
  }
  // Paroles CHANTÉES seulement si c'est sûr : la fiche dit une musique (son avec artiste, album, genre…) ou l'oreille
  // l'affirme avec un modèle (confiance ≥ 0,8). Sinon c'est une parole, avec au plus une « musique de fond possible ».
  const m = e.c.entendu?.musique;
  const ficheMusique = e.c.fiche.nature.famille === 'son' && e.c.fiche.champs.some((x) => ['artiste', 'album', 'genre', 'compositeur', 'label', 'artiste_album'].includes(x.cle));
  const musique = ficheMusique || (!!m?.parModele && (m.confiance ?? 0) >= 0.8);
  if (m && !musique) remarqueC(e, 'musique de fond possible');
  const lg = langueDe(e, texte, musique ? 'paroles de chanson' : 'parole', { transcription: langueTr, declaree: e.c.fiche.languesDeclarees[0]?.code });
  // Langue reconnue avec certitude (≥ 0,8) : les mots de remplissage sans autre sens sont retirés même sans temps par mot.
  const langueSure = !!lg.code && lg.confiance >= 0.8;
  const hes: Hesitations = reperer(texte, { langue: lg.code, langueSure, mots });
  if (!mots) ajouterManqueC(e, { quoi: 'les temps par mot', raison: 'temps par mot non fournis : hésitations doubles laissées possibles', code: 'non-demande' });
  if (hes.retraits.length === 0) remarqueC(e, 'hésitations : la transcription a pu en effacer');
  e.c.dit = { texte, nettoye: hes.nettoye, segments, hesitations: hes, via };
  if (tours) e.c.dit.tours = tours;
  if (musique && e.c.fiche.textesInclus.some((t) => t.genre === 'paroles' || t.genre === 'paroles synchronisées')) remarqueC(e, 'le fichier contient aussi des paroles écrites (voir la fiche) : elles peuvent différer de ce qui est chanté');
  if (o.avecSousTitres && segments.length) await ecrireSousTitres(e, segments, mots, lg.code, o.base, langueSure);
}

/** Noms réservés de Windows (avec n'importe quelle extension : « CON.fr.srt » est interdit). */
const RESERVES_WINDOWS = new Set(['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

// ─────────────────────────────── Sous-titres ───────────────────────────────

/** Nom de base des fichiers écrits : lettres, chiffres, « . _ - » de toutes les écritures ; 80 caractères au plus. */
export function nomDeBase(nom: string): string {
  const sansExt = nom.includes('.') ? nom.slice(0, nom.lastIndexOf('.')) : nom;
  let r = '';
  for (const ch of sansExt) { r += /[\p{L}\p{N}._-]/u.test(ch) ? ch : '_'; if (r.length >= 80) break; }
  r = r.slice(0, 80);
  r = r.replace(/^[._]+/, '') || 'media';
  // « CON », « nul.x », « COM1 » : préfixés, sinon Windows refuse (ou détourne) le fichier écrit.
  const avantPoint = (r.includes('.') ? r.slice(0, r.indexOf('.')) : r).toUpperCase();
  return RESERVES_WINDOWS.has(avantPoint) ? `_${r}` : r;
}

/** Écrit les sous-titres d'origine (texte nettoyé des hésitations sûres) et, si demandé, leurs traductions. */
export async function ecrireSousTitres(e: Etat, segments: Segment[], mots: Mot[] | undefined, langue: string | undefined, base: string, langueSure = false): Promise<void> {
  const propres = segments.map((s) => ({ ...s, texte: reperer(s.texte, { langue, langueSure }).nettoye || s.texte }));
  const { repliques, horodatageApproximatif } = repliquesDepuisSegments(propres, { mots, langue });
  if (!repliques.length) return;
  const code = langue ?? 'und';
  try {
    mkdirSync(e.o.dossierSortie, { recursive: true });
    const srt = join(e.o.dossierSortie, `${base}.${code}.srt`), vtt = join(e.o.dossierSortie, `${base}.${code}.vtt`);
    writeFileSync(srt, ecrireSrt(repliques));
    writeFileSync(vtt, ecrireVtt(repliques, { langue }));
    (e.c.sousTitres ??= []).push({ langue: code, srt, vtt, traduit: false, horodatageApproximatif, source: 'parole' });
  } catch (x) { ajouterManqueC(e, { quoi: 'les fichiers de sous-titres', raison: `écriture impossible : ${court(x)}`, code: 'echec' }); return; }
  await traduireEtEcrire(e, repliques, langue, base, { horodatageApproximatif, source: 'parole' });
}

/**
 * Traduit des répliques (parole transcrite ou sous-titres INCLUS dans la vidéo) vers chaque langue demandée, réplique par
 * réplique avec les mêmes temps, et écrit `<base>.<cible>.srt`/`.vtt`. L'original n'est jamais remplacé.
 * `source: 'sous-titres inclus'` : le texte traduit est aussi rangé dans `traductions` (il n'y a pas d'autre texte à
 * traduire quand la vidéo n'a que ses sous-titres).
 */
export async function traduireEtEcrire(e: Etat, repliques: Replique[], langue: string | undefined, base: string, o: { horodatageApproximatif: boolean; source: 'parole' | 'sous-titres inclus' }): Promise<void> {
  for (const cible of e.o.versLangues ?? []) {
    const vers = versBcp47(cible);
    if (!vers || (langue && memeLangue(vers, langue))) continue;
    if (verifierArret(e)) return;
    const tr = e.o.briques.traduire;
    if (!tr) { besoin(e, 'traduction'); continue; }
    const t = await traduireRepliques(repliques, vers, tr, { deLangue: langue, signal: e.o.signal, delaiMs: delai(e, 'traduireReplique') });
    for (const m of t.manque.slice(0, 20)) ajouterManqueC(e, m);
    if (t.manque.length > 20) ajouterManqueC(e, { quoi: 'd\'autres répliques traduites', raison: `${t.manque.length - 20} autres échecs de traduction`, code: 'echec' });
    if (!t.repliques.some((r) => r.original !== undefined)) continue;   // aucune réplique traduite : rien à écrire
    try {
      mkdirSync(e.o.dossierSortie, { recursive: true });
      const srt = join(e.o.dossierSortie, `${base}.${vers}.srt`), vtt = join(e.o.dossierSortie, `${base}.${vers}.vtt`);
      writeFileSync(srt, ecrireSrt(t.repliques));
      writeFileSync(vtt, ecrireVtt(t.repliques, { langue: vers }));
      (e.c.sousTitres ??= []).push({ langue: vers, srt, vtt, traduit: true, horodatageApproximatif: o.horodatageApproximatif, source: o.source });
    } catch (x) { ajouterManqueC(e, { quoi: `les sous-titres traduits (${vers})`, raison: `écriture impossible : ${court(x)}`, code: 'echec' }); }
    if (o.source === 'sous-titres inclus') {
      const net = texteBorne(t.repliques.map((r) => r.texte.split('\n').join(' ')).join('\n'));
      if (net) (e.c.traductions ??= []).push({ langue: vers, texte: net, via: 'traduction (sous-titres inclus)' });
    }
  }
}

/** Traduit un texte entier (texte lu, parole) vers les langues demandées. */
export async function traduireTexte(e: Etat, texte: string, deLangue: string | undefined, quoi: string): Promise<void> {
  for (const cible of e.o.versLangues ?? []) {
    const vers = versBcp47(cible);
    if (!vers || (deLangue && memeLangue(vers, deLangue)) || !texte) continue;
    const tr = e.o.briques.traduire;
    if (!tr) { besoin(e, 'traduction'); continue; }
    const t = await appeler(e, 'traduire', (signal) => tr(texte.slice(0, 200_000), vers, { deLangue, signal }), delai(e, 'traduireTexte'));
    const net = texteBorne(t);
    if (net) (e.c.traductions ??= []).push({ langue: vers, texte: net, via: `traduction (${quoi})` });
  }
}

export type { Briques };
