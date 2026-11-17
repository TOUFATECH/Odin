// La parole : la transcription locale est INJECTÉE (fonction `ecouter`), Odin n'en installe aucune. Ici :
//  - le son est remis en WAV 16 kHz (au-delà de 24 Mo, par un fichier de travail effacé ensuite) ;
//  - langue et confiance sont reprises du résultat ;
//  - les tours de parole sont séparés SANS nommer personne : « voix 1 », « voix 2 »… (estimation par les timbres,
//    MFCC moyens et écarts sur chaque segment d'au moins 0,5 s, regroupés par ressemblance ; aucun gabarit gardé) ;
//  - pour une chanson, le texte CHANTÉ n'est PAS gardé (œuvre protégée) : seulement son sujet en une phrase, refusé s'il
//    reprend 8 mots de suite des paroles ; la parole hors des zones de musique est gardée.

import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ErreurSon, MAX_WAV_MEMOIRE, ceder, verifierArret } from './bornes.ts';
import { FS, type Demander, type Ecouter, type Parole, type Tour } from './contrat.ts';
import { logMel, mfcc, NMFCC } from './spectre.ts';
import { ecrireWav16k } from './wav.ts';

/** Le son prêt pour la parole : le WAV (en mémoire ou en fichier), sa durée, et l'accès à un extrait. */
export interface SonPourParole {
  wav: Uint8Array | { file: string };
  duree: number;
  extrait(debut: number, fin: number): Float32Array;
  /** Le timbre d'un passage, s'il est déjà connu (sinon il est calculé sur l'extrait). */
  timbre?(debut: number, fin: number): number[] | undefined;
}

/** Son en mémoire → son prêt pour la parole. */
export function sonEnMemoire(mono16k: Float32Array): SonPourParole {
  return {
    wav: ecrireWav16k(mono16k),
    duree: mono16k.length / FS,
    extrait: (a, b) => mono16k.slice(Math.max(0, Math.floor(a * FS)), Math.min(mono16k.length, Math.ceil(b * FS))),
  };
}

export interface OptionsParole {
  ecouter?: Ecouter | null;
  demander?: Demander | null;
  sonsSeuls?: boolean;
  /** Une chanson est possible : le texte chanté n'est pas gardé. */
  musiqueProbable?: boolean;
  /** Où la musique a été entendue (par le modèle de sons) ; absent = sur tout le son. Seule la parole qui la recoupe est retirée. */
  zonesMusique?: Array<{ debut: number; fin: number }>;
  dossierTemp?: string;
  signal?: AbortSignal;
}

export const QUESTION_SUJET = 'De quoi parlent ces paroles ? Une phrase, sans citer aucun vers.';
// Ressemblance de timbre au-delà de laquelle deux segments sont dits « même voix » (estimation : sur les voix
// fabriquées des essais, même voix ≥ 0,99, voix différentes ≈ 0,5).
const SEUIL_VOIX = 0.85;
const MAX_VOIX = 8;

/** Mots d'un texte, en minuscules, sans accents ni ponctuation. */
export function mots(t: string): string[] {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Vrai si `sujet` reprend au moins `n` mots de suite de `texte`. */
export function reprendSuite(sujet: string, texte: string, n = 8): boolean {
  const a = mots(texte), b = mots(sujet);
  if (b.length < n || a.length < n) return false;
  const vus = new Set<string>();
  for (let i = 0; i + n <= a.length; i++) vus.add(a.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= b.length; i++) if (vus.has(b.slice(i, i + n).join(' '))) return true;
  return false;
}

/** Trait de timbre d'un extrait : moyenne et écart des MFCC 1 à 19 (le niveau sonore, coefficient 0, est laissé). */
function timbre(x: Float32Array): number[] | undefined {
  if (x.length < FS / 2) return undefined;
  const mel = logMel(x);
  const mf = mfcc(mel);
  const T = mel.trames;
  // Seules les trames qui portent du son comptent (au-dessus du 30e centile du niveau).
  const niveaux = Array.from({ length: T }, (_, t) => mf[t * NMFCC]);
  const tri = [...niveaux].sort((a, b) => a - b);
  const seuil = tri[Math.floor(0.3 * (T - 1))];
  const moy = new Array(NMFCC - 1).fill(0), car = new Array(NMFCC - 1).fill(0);
  let n = 0;
  for (let t = 0; t < T; t++) {
    if (niveaux[t] < seuil) continue;
    n++;
    for (let k = 1; k < NMFCC; k++) { const v = mf[t * NMFCC + k]; moy[k - 1] += v; car[k - 1] += v * v; }
  }
  if (!n) return undefined;
  const out: number[] = [];
  for (let k = 0; k < NMFCC - 1; k++) { const m = moy[k] / n; out.push(m); }
  for (let k = 0; k < NMFCC - 1; k++) { const m = moy[k] / n; out.push(Math.sqrt(Math.max(0, car[k] / n - m * m))); }
  return out;
}

const cosinus = (a: number[], b: number[]): number => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? s / Math.sqrt(na * nb) : 0;
};

/** Longueur d'extrait au plus pour le timbre d'un segment (le milieu du segment) : le coût reste borné. */
const EXTRAIT_MAX_S = 4;

/**
 * Tours de parole : chaque segment (dans l'ordre du temps) rejoint la voix la plus proche parmi 8 au plus, ou en ouvre une
 * nouvelle si aucune ne lui ressemble assez. Coût linéaire (8 comparaisons par segment, jamais toutes les paires) ; la
 * main est rendue au serveur tous les 10 segments et l'arrêt est vérifié. `timbreDe` (essais) remplace le calcul du timbre.
 */
export async function tours(
  segments: Array<{ debut: number; fin: number }>,
  extrait: (a: number, b: number) => Float32Array,
  o: { signal?: AbortSignal; timbreDe?: (debut: number, fin: number) => number[] | undefined } = {},
): Promise<Tour[]> {
  const timbreDe = o.timbreDe ?? ((a: number, b: number) => {
    const milieu = (a + b) / 2, demi = Math.min(b - a, EXTRAIT_MAX_S) / 2;
    return timbre(extrait(milieu - demi, milieu + demi));
  });
  const tries = [...segments].filter((x) => x.fin - x.debut >= 0.5).sort((x, y) => x.debut - y.debut);
  const voixDe: Array<{ debut: number; fin: number; g: number }> = [];
  const centres: Array<{ somme: number[]; n: number }> = [];
  for (let k = 0; k < tries.length; k++) {
    if (k % 10 === 9) { await ceder(); verifierArret(o.signal); }
    const s = tries[k];
    const t = timbreDe(s.debut, s.fin);
    if (!t) continue;
    let g = -1, best = -Infinity;
    for (let c = 0; c < centres.length; c++) {
      const v = cosinus(centres[c].somme, t);
      if (v > best) { best = v; g = c; }
    }
    if (g < 0 || (best < SEUIL_VOIX && centres.length < MAX_VOIX)) { centres.push({ somme: t.slice(), n: 1 }); g = centres.length - 1; }
    else { const c = centres[g]; for (let d = 0; d < t.length; d++) c.somme[d] += t[d]; c.n++; }
    voixDe.push({ debut: s.debut, fin: s.fin, g });
  }
  // Noms dans l'ordre d'apparition.
  const ordre = new Map<number, string>();
  const out: Tour[] = [];
  for (const it of voixDe) {
    if (!ordre.has(it.g)) ordre.set(it.g, `voix ${ordre.size + 1}`);
    const voix = ordre.get(it.g)!;
    const dernier = out[out.length - 1];
    if (dernier && dernier.voix === voix && it.debut - dernier.fin < 1) dernier.fin = Math.max(dernier.fin, it.fin);
    else out.push({ debut: it.debut, fin: it.fin, voix });
  }
  return out;
}

const borneTexte = (s: unknown, max: number): string => (typeof s === 'string' ? s : '').slice(0, max);

/** La parole d'un son. Ne lève que ErreurSon 'arrete' ; le reste devient un état lisible. */
export async function analyserParole(son: SonPourParole | null, o: OptionsParole): Promise<Parole> {
  if (o.sonsSeuls) return { etat: 'non_demandee', segments: [], tours: [], texteRetire: false };
  if (!o.ecouter) return { etat: 'pas_prete', raison: 'la transcription locale n\'est pas fournie', segments: [], tours: [], texteRetire: false };
  if (!son || son.duree <= 0) return { etat: 'echec', raison: 'son vide', segments: [], tours: [], texteRetire: false };
  let temp: string | undefined;
  try {
    let entree: Uint8Array | { file: string } = son.wav;
    if (entree instanceof Uint8Array && entree.length > MAX_WAV_MEMOIRE && o.dossierTemp) {
      mkdirSync(o.dossierTemp, { recursive: true, mode: 0o700 });
      temp = join(o.dossierTemp, `parole-${randomBytes(8).toString('hex')}.wav`);
      writeFileSync(temp, entree, { mode: 0o600 });
      entree = { file: temp };
    }
    let r;
    try {
      r = await o.ecouter(entree, 'audio/wav', o.signal);
    } catch (e) {
      verifierArret(o.signal);
      return { etat: 'echec', raison: `transcription locale : ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, segments: [], tours: [], texteRetire: false };
    }
    verifierArret(o.signal);
    const texte = borneTexte(r?.text, 200_000).trim();
    const langue = borneTexte(r?.language, 20).trim() || undefined;
    const conf = typeof r?.confiance === 'number' && r.confiance >= 0 && r.confiance <= 1 ? r.confiance : undefined;
    const segs = (Array.isArray(r?.segments) ? r.segments : []).slice(0, 20_000)
      .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
      .map((s) => ({ debut: Math.max(0, s.start), fin: Math.min(son.duree, s.end), texte: borneTexte(s.text, 2000) }));
    const lesTours = await tours(segs, son.extrait, { signal: o.signal, timbreDe: son.timbre });
    const p: Parole = {
      etat: 'faite', texte, ...(langue ? { langue } : {}), ...(conf !== undefined ? { confianceLangue: conf } : {}),
      segments: segs, tours: lesTours, texteRetire: false,
    };
    if (o.musiqueProbable && texte) {
      // Une chanson possible : le texte CHANTÉ n'est pas gardé (œuvre protégée) ; seulement son sujet, en une phrase.
      // Avec les zones de musique du modèle, seule la parole qui les recoupe est retirée ; le reste de la conversation reste.
      const z = o.zonesMusique;
      const chante = (sg: { debut: number; fin: number }) => !z || z.some((m) => sg.debut < m.fin && sg.fin > m.debut);
      const retires = segs.length ? segs.filter(chante) : [];
      if (!segs.length || retires.length) {
        const texteChante = segs.length ? retires.map((x) => x.texte).join(' ').trim() : texte;
        if (o.demander && texteChante) {
          try {
            const brut = await o.demander(QUESTION_SUJET, texteChante.slice(0, 4000));
            const sujet = borneTexte(brut, 600).replace(/\s+/g, ' ').trim().slice(0, 300);
            if (sujet && !reprendSuite(sujet, texteChante)) p.sujet = sujet;
          } catch { /* sujet non obtenu : on s'en passe */ }
          verifierArret(o.signal);
        }
        p.segments = segs.map((x) => (chante(x) ? { debut: x.debut, fin: x.fin } : x));
        const gardes = segs.filter((x) => !chante(x));
        if (gardes.length) p.texte = gardes.map((x) => x.texte).join(' ').trim(); else delete p.texte;
        p.texteRetire = true;
      }
    }
    return p;
  } catch (e) {
    if (e instanceof ErreurSon) throw e;
    return { etat: 'echec', raison: (e instanceof Error ? e.message : String(e)).slice(0, 200), segments: [], tours: [], texteRetire: false };
  } finally {
    if (temp) try { rmSync(temp, { force: true }); } catch { /* rien */ }
  }
}
