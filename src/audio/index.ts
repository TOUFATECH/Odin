// L'oreille d'Odin : la barrière du calcul audio. Une seule passe en flux, par tranches de 10 s :
//   décodage → spectre → calculs sans modèle → empreinte → modèle de sons (s'il est prêt),
// puis la parole en fin de passe (transcription locale injectée). Chaque étape est chronométrée (temps MESURÉ).
// Une seule analyse à la fois, 4 en attente au plus (sinon ErreurSon 'occupe') : la mémoire et le processeur ne sont
// jamais saturés ; les clips courts de caméra (sons seuls) ont leur propre voie, pour qu'une alerte n'attende pas. Entre deux tranches, la main est rendue au serveur. Rien n'est écrit sur disque hors de dossierTemp.

import { openSync, writeSync, readSync, closeSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  FS, MAX_SEC, PAS_SONS_S,
  type AnalyseSon, type Etape, type Etiquette, type Mesure, type OptionsAnalyse, type ResultatEcoute, type SourceSon,
} from './contrat.ts';
import { ErreurSon, DELAI_DEFAUT_MS, MAX_PAROLE_MEMOIRE_S, ceder, enErreurSon, maxSecEffectif, signalAvecDelai, verifierArret } from './bornes.ts';
import { lireSon, type InfoSon } from './decoder.ts';
import { chroma, logMel, mfcc } from './spectre.ts';
import { EcouteSansModele } from './sansmodele.ts';
import { Empreinteur } from './empreinte.ts';
import { Momenteur, ficheEtiquette } from './modele-sons.ts';
import { analyserParole, type SonPourParole } from './parole.ts';
import { enteteWav16k, versS16 } from './wav.ts';

export * from './contrat.ts';
export { ErreurSon } from './bornes.ts';
export { ouvrirModeleSons } from './modele-sons.ts';
export { CATALOGUE_SONS, etatModeleSons } from './catalogue.ts';
export { voterEmpreinte } from './empreinte.ts';
export { formatSon, lireWav, ecrireWav16k, sonFabrique } from './wav.ts';

// ---------------------------------------------------------------------------------------------------------------
// La file : une analyse à la fois, 4 en attente au plus.
// ---------------------------------------------------------------------------------------------------------------

const MAX_ATTENTE = 4;
/** Une voie réservée aux clips courts de caméra (sons seuls) : une alerte n'attend jamais derrière un long son. */
const MAX_ATTENTE_CLIPS = 8;
const MAX_SEC_CLIP = 120;

interface Voie { enCours: number; attente: Array<() => void>; max: number }
const voies = { normale: { enCours: 0, attente: [], max: MAX_ATTENTE } as Voie, clips: { enCours: 0, attente: [], max: MAX_ATTENTE_CLIPS } as Voie };

/**
 * Un clip de caméra (`priorite: 'clip'`, sons seuls, 2 minutes au plus) passe par sa propre voie : une analyse à la fois
 * là aussi, mais à côté de la voie normale. Hors contrat : un champ en plus, ignoré par ceux qui ne le connaissent pas.
 */
export type OptionsAnalyseClip = OptionsAnalyse & { priorite?: 'clip' };
const estClip = (o: OptionsAnalyseClip): boolean => o.priorite === 'clip' && o.sonsSeuls === true && !o.ecouter;

/** Analyse un son : parole, musique, sons, avec les temps mesurés. Ne lève que des ErreurSon. */
export function analyserSon(source: SourceSon, o: OptionsAnalyseClip = {}): Promise<ResultatEcoute> {
  const clip = estClip(o);
  const v = clip ? voies.clips : voies.normale;
  const opts: OptionsAnalyse = clip ? { ...o, maxSec: Math.min(o.maxSec ?? MAX_SEC_CLIP, MAX_SEC_CLIP) } : o;
  if (v.enCours >= 1 && v.attente.length >= v.max) {
    return Promise.reject(new ErreurSon('occupe', 'Odin écoute déjà d\'autres sons : réessaie dans un moment'));
  }
  return new Promise<ResultatEcoute>((resolve, reject) => {
    const suivant = (): void => { v.enCours--; const s = v.attente.shift(); if (s) s(); };
    const lancer = (): void => {
      v.enCours++;
      analyser(source, opts).then(resolve, (e) => reject(enErreurSon(e))).finally(suivant);
    };
    if (v.enCours < 1) { lancer(); return; }
    // En attente : un arrêt demandé pendant l'attente retire la demande de la file.
    const enFile = (): void => { o.signal?.removeEventListener('abort', annuler); lancer(); };
    const annuler = (): void => {
      const i = v.attente.indexOf(enFile);
      if (i >= 0) v.attente.splice(i, 1);
      reject(new ErreurSon('arrete', 'analyse arrêtée avant de commencer'));
    };
    if (o.signal?.aborted) { reject(new ErreurSon('arrete', 'analyse arrêtée avant de commencer')); return; }
    o.signal?.addEventListener('abort', annuler, { once: true });
    v.attente.push(enFile);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Le son gardé pour la parole : en fichier de travail si on en a un, sinon en mémoire (30 minutes au plus).
// ---------------------------------------------------------------------------------------------------------------

class Collecteur {
  private morceaux: Int16Array[] = [];
  private n = 0;
  private fd: number | undefined;
  private chemin: string | undefined;
  coupe = false;

  constructor(dossierTemp?: string) {
    if (!dossierTemp) return;
    try {
      mkdirSync(dossierTemp, { recursive: true, mode: 0o700 });
      this.chemin = join(dossierTemp, `ecoute-${randomBytes(8).toString('hex')}.wav`);
      this.fd = openSync(this.chemin, 'w+', 0o600);
      writeSync(this.fd, enteteWav16k(0), 0, 44, 0);
    } catch {
      this.fermer();
      this.chemin = undefined;
    }
  }

  pousser(x: Float32Array): void {
    if (this.fd !== undefined) {
      const o = versS16(x);
      writeSync(this.fd, o, 0, o.length, 44 + this.n * 2);
      this.n += x.length;
      return;
    }
    const reste = MAX_PAROLE_MEMOIRE_S * FS - this.n;
    if (reste <= 0) { this.coupe = true; return; }
    const pris = x.length > reste ? x.subarray(0, reste) : x;
    if (pris.length < x.length) this.coupe = true;
    const s = new Int16Array(pris.length);
    for (let i = 0; i < pris.length; i++) { const v = pris[i]; s[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767); }
    this.morceaux.push(s);
    this.n += s.length;
  }

  finir(): SonPourParole | null {
    if (!this.n) return null;
    const duree = this.n / FS;
    if (this.fd !== undefined) {
      writeSync(this.fd, enteteWav16k(this.n), 0, 44, 0);
      const fd = this.fd, n = this.n;
      return {
        wav: { file: this.chemin! }, duree,
        extrait: (a, b) => {
          const i0 = Math.max(0, Math.floor(a * FS)), i1 = Math.min(n, Math.ceil(b * FS));
          const buf = Buffer.alloc(Math.max(0, i1 - i0) * 2);
          if (buf.length) readSync(fd, buf, 0, buf.length, 44 + i0 * 2);
          const out = new Float32Array(buf.length / 2);
          for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
          return out;
        },
      };
    }
    const tout = new Int16Array(this.n);
    let p = 0;
    for (const m of this.morceaux) { tout.set(m, p); p += m.length; }
    this.morceaux = [];
    const wav = new Uint8Array(44 + tout.length * 2);
    wav.set(enteteWav16k(tout.length), 0);
    wav.set(new Uint8Array(tout.buffer, tout.byteOffset, tout.byteLength), 44);
    return {
      wav, duree,
      extrait: (a, b) => {
        const i0 = Math.max(0, Math.floor(a * FS)), i1 = Math.min(tout.length, Math.ceil(b * FS));
        const out = new Float32Array(Math.max(0, i1 - i0));
        for (let i = 0; i < out.length; i++) out[i] = tout[i0 + i] / 32768;
        return out;
      },
    };
  }

  fermer(): void {
    if (this.fd !== undefined) { try { closeSync(this.fd); } catch { /* rien */ } this.fd = undefined; }
    if (this.chemin) { try { rmSync(this.chemin, { force: true }); } catch { /* rien */ } }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// L'analyse.
// ---------------------------------------------------------------------------------------------------------------

const ETAPES: Etape[] = ['decodage', 'spectre', 'sans_modele', 'empreinte', 'modele_sons', 'parole'];
const arr = (x: number, d = 1): number => { const p = 10 ** d; return Math.round(x * p) / p; };

async function analyser(source: SourceSon, o: OptionsAnalyse): Promise<ResultatEcoute> {
  const debut = performance.now();
  const signal = signalAvecDelai(o.signal, o.delaiMs ?? DELAI_DEFAUT_MS);
  const maxSec = maxSecEffectif(o.maxSec, MAX_SEC);
  const temps = new Map<Etape, number>(ETAPES.map((e) => [e, 0]));
  const chrono = (e: Etape, t0: number): void => { temps.set(e, (temps.get(e) ?? 0) + performance.now() - t0); };
  const manque: string[] = [];
  const sm = new EcouteSansModele();
  const emp = new Empreinteur(o.avecEmpreinte !== false);
  const modele = o.modele && o.modele.pret ? o.modele : undefined;
  let modeleEnPanne: string | undefined;
  const veutParole = !o.sonsSeuls && !!o.ecouter;
  const collecteur = veutParole ? new Collecteur(o.dossierTemp) : undefined;
  let info: InfoSon | undefined;
  let duree = 0, trame0 = 0, tranches = 0;
  // Agrégats du modèle de sons.
  let pMax: Float32Array | undefined, pSomme: Float64Array | undefined, plongSomme: Float64Array | undefined, nbModele = 0;
  const momenteur = modele ? new Momenteur(modele.libelles, PAS_SONS_S) : undefined;
  const iter = lireSon(source, { signal, maxSec, delaiMs: o.delaiMs, dossierTemp: o.dossierTemp, lancer: o.lancer })[Symbol.asyncIterator]();
  try {
    for (;;) {
      verifierArret(signal);
      let t0 = performance.now();
      const r = await iter.next();
      chrono('decodage', t0);
      if (r.done) break;
      const x = r.value.tranche;
      info = r.value.info;
      if (!x.length) continue;
      tranches++;
      t0 = performance.now();
      const mel = logMel(x);
      const mf = mfcc(mel);
      const ch = chroma(x);
      chrono('spectre', t0);
      const utiles = Math.min(mel.trames, Math.ceil(x.length / 160));
      t0 = performance.now();
      try { sm.ajouter(x, mel, mf, ch, duree); } catch (e) { manque.push(`calcul sans modèle incomplet : ${message(e)}`); }
      chrono('sans_modele', t0);
      t0 = performance.now();
      emp.ajouterPcm(x);
      try { emp.ajouterMel(mel, trame0, utiles); } catch (e) { manque.push(`empreinte incomplète : ${message(e)}`); }
      chrono('empreinte', t0);
      if (modele && !modeleEnPanne) {
        t0 = performance.now();
        try {
          const s = await modele.classer(mel.data, mel.trames, signal);
          const C = s.probas.length;
          pMax ??= new Float32Array(C); pSomme ??= new Float64Array(C); plongSomme ??= new Float64Array(s.plongement.length);
          for (let k = 0; k < C; k++) { if (s.probas[k] > pMax[k]) pMax[k] = s.probas[k]; pSomme[k] += s.probas[k]; }
          for (let d = 0; d < s.plongement.length; d++) plongSomme[d] += s.plongement[d];
          nbModele++;
          momenteur!.pousser(s.parPas, s.pas, duree);
        } catch (e) {
          verifierArret(signal);
          modeleEnPanne = message(e);
        }
        chrono('modele_sons', t0);
      }
      collecteur?.pousser(x);
      duree += x.length / FS;
      trame0 += utiles;
      await ceder();
    }
    if (!info || duree <= 0) manque.push('son vide : rien à entendre');

    // Agrégats sans modèle.
    let t0 = performance.now();
    const volume = sm.volume();
    const zones = sm.zones().map((z) => ({ ...z, fin: Math.min(z.fin, arr(duree, 2)) })).filter((z) => z.fin > z.debut);
    const changements = sm.changements().filter((c) => c < duree);
    const tempo = sm.tempo();
    const tonalite = sm.tonalite();
    const parties = duree >= 8 ? sm.parties().map((p) => ({ ...p, fin: Math.min(p.fin, arr(duree, 2)) })) : [];
    const sansModele = sm.musique();
    const onde = sm.onde(200);
    chrono('sans_modele', t0);

    // Le modèle de sons.
    const sons: AnalyseSon['sons'] = modele
      ? { etat: 'fait', etiquettes: [], moments: [] }
      : o.modele === null
        ? { etat: 'non_demande', etiquettes: [], moments: [] }
        : { etat: 'pas_pret', raison: o.modele?.raison ?? 'modèle de sons : pas téléchargé (22 Mo, Apache-2.0)', etiquettes: [], moments: [] };
    let musique: AnalyseSon['musique'] = { probable: sansModele.probable, par: 'sans-modele', confiance: sansModele.confiance, ...(tempo ? { tempo } : {}), ...(tonalite ? { tonalite } : {}), parties };
    if (modele && modeleEnPanne && !nbModele) {
      sons.etat = 'pas_pret';
      sons.raison = `modèle de sons en échec : ${modeleEnPanne}`;
    } else if (modele && pMax && pSomme && plongSomme) {
      if (modeleEnPanne) manque.push(`modèle de sons arrêté en cours de route : ${modeleEnPanne}`);
      sons.etiquettes = etiquettes(modele.libelles, pMax);
      sons.moments = momenteur!.finir(arr(duree, 3));
      sons.plongement = Array.from(plongSomme, (v) => arr(v / nbModele, 5));
      const iMusique = modele.libelles.indexOf('Music');
      if (iMusique >= 0) {
        const p = pMax[iMusique];
        musique = { ...musique, probable: p >= ficheEtiquette('Music').seuil, par: 'modele', confiance: arr(p, 3) };
      }
      if (tranches > 1) manque.push('modèle de sons : le niveau de référence (max − 120 dB) est pris par tranche de 10 s, pas sur le son entier');
      const notes = (modele as { notes?: unknown }).notes;
      if (Array.isArray(notes)) for (const n of notes) if (typeof n === 'string') manque.push(n);
    }
    if (!musique.probable) musique = { ...musique, parties: musique.parties.map((p) => ({ ...p, refrainProbable: false })) };
    // Une chanson est-elle possible ? Par le modèle : là où il entend de la musique. Sans modèle, par prudence (œuvres
    // protégées) : musique probable, ou un tempo stable avec une tonalité, sur tout le son.
    const parModele = musique.par === 'modele';
    const zonesMusique = parModele ? sons.moments.filter((m) => m.famille === 'musique').map((m) => ({ debut: m.debut, fin: m.fin })) : undefined;
    const chantPossible = parModele
      ? musique.probable
      : musique.probable || ((musique.tempo?.confiance ?? 0) >= 0.3 && (musique.tonalite?.confiance ?? 0) >= 0.05);

    // L'empreinte.
    t0 = performance.now();
    const empreinte = emp.finir();
    chrono('empreinte', t0);
    if (duree > 600 && o.avecEmpreinte !== false) manque.push('empreinte : seules les 10 premières minutes sont indexées');

    // La parole, en fin de passe.
    let parole: AnalyseSon['parole'];
    if (veutParole) {
      t0 = performance.now();
      const son = collecteur!.finir();
      if (collecteur!.coupe) manque.push(`parole : seules les ${MAX_PAROLE_MEMOIRE_S / 60} premières minutes sont transcrites (aucun dossier de travail)`);
      parole = await analyserParole(son, { ecouter: o.ecouter, demander: o.demander, musiqueProbable: chantPossible, zonesMusique: zonesMusique?.length ? zonesMusique : undefined, dossierTemp: o.dossierTemp, signal });
      chrono('parole', t0);
    } else {
      parole = await analyserParole(null, { ecouter: o.ecouter, sonsSeuls: o.sonsSeuls });
    }
    if (parole.etat === 'pas_prete') manque.push('parole : pas prête sur ce poste');

    // Les mesures (temps réels mesurés).
    const mesures: Mesure[] = [];
    for (const e of ETAPES) {
      const ms = temps.get(e) ?? 0;
      if (e === 'modele_sons' && !modele) continue;
      if (e === 'parole' && !veutParole) continue;
      mesures.push(mesure(e, ms, duree));
    }
    mesures.push(mesure('total', performance.now() - debut, duree));

    const analyse: AnalyseSon = {
      version: 1,
      duree: arr(duree, 3),
      source: info ? { format: info.format, fs: info.fs, canaux: info.canaux, via: info.via } : { format: 'inconnu', fs: FS, canaux: 1, via: 'natif' },
      sha: empreinte.sha,
      onde, volume, zones, changements, musique, sons, parole, mesures, manque,
    };
    return { analyse, empreinte };
  } finally {
    try { await iter.return?.(undefined); } catch { /* rien */ }
    collecteur?.fermer();
  }
}

function mesure(etape: Etape, ms: number, duree: number): Mesure {
  return { etape, ms: arr(ms, 1), xTempsReel: ms > 0 ? arr((duree / ms) * 1000, 1) : 0 };
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/** Les étiquettes retenues : celles au-dessus de leur seuil (famille connue), et toujours les 3 plus probables. */
function etiquettes(libelles: string[], p: Float32Array): Etiquette[] {
  const ordre = Array.from(p.keys()).sort((a, b) => p[b] - p[a]);
  const out: Etiquette[] = [];
  for (const [rang, i] of ordre.entries()) {
    const f = ficheEtiquette(libelles[i]);
    const garde = rang < 3 || (f.famille !== 'autre' && p[i] >= f.seuil);
    if (!garde) continue;
    out.push({ indice: i, cle: f.cle, libelle: f.fr, famille: f.famille, p: arr(p[i], 4), seuil: f.seuil });
    if (out.length >= 15) break;
  }
  return out;
}
