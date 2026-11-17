// Décodage du son en flux : on rend des tranches de 10 s, en mono à 16 kHz, sans jamais tenir le fichier entier.
//  - WAV : lu par Odin seul (wav.ts), par lecture bornée du fichier, morceau par morceau (2 Go au plus).
//  - Autres formats : l'outil média local, lancé avec un TABLEAU d'arguments (jamais de shell), sortie flottante brute
//    en mono 16 kHz sur sa sortie standard, avec délai et plafond d'octets. Le nom du fichier n'entre jamais dans une
//    chaîne de commande. S'il manque : ErreurSon 'outil_absent'.

import { spawn } from 'node:child_process';
import { openSync, readSync, closeSync, statSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hasCommand } from '../learn/environment.ts';
import { ErreurSon, enErreurSon, maxSecEffectif, verifierArret } from './bornes.ts';
import { FS, MAX_OCTETS, MAX_SEC, TRANCHE_S, type Lanceur, type SourceSon } from './contrat.ts';
import { formatSon, lireEnteteWav, versMono, type EnteteWav, type LireA } from './wav.ts';
import { Reechantillonneur } from './reech.ts';

/** Ce qu'on sait de la source. */
export interface InfoSon { format: string; fs: number; canaux: number; via: 'natif' | 'outil-media' }

export interface OptionsLecture {
  signal?: AbortSignal;
  maxSec?: number;
  delaiMs?: number;
  dossierTemp?: string;
  lancer?: Lanceur;
}

/** Échantillons par tranche (10 s à 16 kHz). */
export const ECH_TRANCHE = TRANCHE_S * FS;

export const MESSAGE_OUTIL_ABSENT = 'format pas encore lu par Odin seul : installe l\'outil média local';

// La commande de l'outil média local : c'est le nom de l'exécutable à lancer, le seul endroit où il apparaît ici.
const OUTIL_MEDIA = 'ffmpeg';

/** Lanceur par défaut : tableau d'arguments, aucun shell, fenêtre cachée, délai. Rend undefined si l'outil manque. */
export const lanceurParDefaut: Lanceur = (cmd, args, o) => {
  if (!hasCommand(cmd)) return undefined;
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, signal: o.signal, timeout: o.timeoutMs });
  let err = '';
  p.stderr.on('data', (d: Buffer) => { err = (err + d.toString('utf8')).slice(-2000); });
  const fin = new Promise<{ code: number; err: string }>((resolve) => {
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code: code ?? -1, err }));
  });
  return { stdout: p.stdout as AsyncIterable<Uint8Array>, fin };
};

/** Arguments de l'outil média : mono, 16 kHz, flottants 32 bits petit-boutiens sur la sortie standard. Le fichier est
 *  donné en chemin ABSOLU préfixé de « file: » : un nom hostile (« pipe:… », « http:… », « -… ») ne peut être pris ni
 *  pour une option ni pour une autre source que ce fichier local. La lecture est bornée aux fichiers locaux
 *  (« -protocol_whitelist file,pipe ») : un fichier hostile déguisé en liste de lecture ne peut faire ouvrir aucune
 *  adresse du réseau à l'outil. */
export function argumentsOutil(fichier: string): string[] {
  return ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', `file:${resolve(fichier)}`, '-vn', '-ac', '1', '-ar', String(FS), '-f', 'f32le', 'pipe:1'];
}

/** Regroupe des morceaux en tranches de taille fixe. */
class Trancheur {
  private morceaux: Float32Array[] = [];
  private nb = 0;
  pousser(x: Float32Array): Float32Array[] {
    const prets: Float32Array[] = [];
    let i = 0;
    while (i < x.length) {
      const prendre = Math.min(ECH_TRANCHE - this.nb, x.length - i);
      this.morceaux.push(x.subarray(i, i + prendre));
      this.nb += prendre; i += prendre;
      if (this.nb === ECH_TRANCHE) prets.push(this.vider());
    }
    return prets;
  }
  vider(): Float32Array {
    const out = new Float32Array(this.nb);
    let p = 0;
    for (const m of this.morceaux) { out.set(m, p); p += m.length; }
    this.morceaux = []; this.nb = 0;
    return out;
  }
  get reste(): number { return this.nb; }
}

/** Lit la source et rend des tranches de 10 s en mono 16 kHz, chacune avec la fiche de la source. */
export async function* lireSon(source: SourceSon, o: OptionsLecture = {}): AsyncGenerator<{ tranche: Float32Array; info: InfoSon }> {
  const maxSec = maxSecEffectif(o.maxSec, MAX_SEC);
  if ('fichier' in source) {
    let taille: number;
    try {
      const st = statSync(source.fichier);
      if (!st.isFile()) throw new ErreurSon('introuvable', 'ce n\'est pas un fichier');
      taille = st.size;
    } catch (e) {
      if (e instanceof ErreurSon) throw e;
      throw new ErreurSon('introuvable', 'fichier son introuvable');
    }
    if (taille > MAX_OCTETS) throw new ErreurSon('refuse', 'fichier trop gros (2 Go au plus)');
    if (taille === 0) throw new ErreurSon('format', 'fichier vide');
    let fd: number;
    try { fd = openSync(source.fichier, 'r'); } catch { throw new ErreurSon('introuvable', 'fichier son illisible'); }
    try {
      const lire: LireA = (pos, n) => {
        const b = new Uint8Array(Math.max(0, Math.min(n, taille - pos)));
        const lu = b.length ? readSync(fd, b, 0, b.length, pos) : 0;
        return lu === b.length ? b : b.subarray(0, lu);
      };
      const format = formatSon(lire(0, 12));
      if (format === 'wav') {
        const e = lireEnteteWav(lire, taille, { maxSec });
        yield* tranchesWav(e, lire, o.signal);
        return;
      }
    } finally {
      closeSync(fd);
    }
    yield* parOutil(source.fichier, formatSon(lireDebut(source.fichier)), o, maxSec);
    return;
  }
  const octets = source.octets;
  if (octets.length > MAX_OCTETS) throw new ErreurSon('refuse', 'son trop gros (2 Go au plus)');
  if (octets.length === 0) throw new ErreurSon('format', 'son vide');
  const format = formatSon(octets.subarray(0, 12));
  if (format === 'wav') {
    const lire: LireA = (pos, n) => octets.subarray(pos, Math.min(octets.length, pos + n));
    const e = lireEnteteWav(lire, octets.length, { maxSec });
    yield* tranchesWav(e, lire, o.signal);
    return;
  }
  // Un son en octets dans un autre format : écrit d'abord dans le dossier de travail, puis effacé.
  if (!o.dossierTemp) throw new ErreurSon('format', `${MESSAGE_OUTIL_ABSENT} (et un dossier de travail est nécessaire)`);
  try { mkdirSync(o.dossierTemp, { recursive: true, mode: 0o700 }); } catch { /* déjà là */ }
  const temp = join(o.dossierTemp, `son-${randomBytes(8).toString('hex')}.bin`);
  try {
    writeFileSync(temp, octets, { mode: 0o600 });
    yield* parOutil(temp, format, o, maxSec);
  } finally {
    try { rmSync(temp, { force: true }); } catch { /* rien */ }
  }
}

function lireDebut(fichier: string): Uint8Array {
  const b = new Uint8Array(12);
  let fd: number | undefined;
  try { fd = openSync(fichier, 'r'); const n = readSync(fd, b, 0, 12, 0); return b.subarray(0, n); } catch { return b.subarray(0, 0); } finally { if (fd !== undefined) closeSync(fd); }
}

/** Les tranches d'un WAV, lu morceau par morceau. */
function* tranchesWav(e: EnteteWav, lire: LireA, signal: AbortSignal | undefined): Generator<{ tranche: Float32Array; info: InfoSon }> {
  const info: InfoSon = { format: 'wav', fs: e.fs, canaux: e.canaux, via: 'natif' };
  const reech = new Reechantillonneur(e.fs);
  const trancheur = new Trancheur();
  // Morceaux d'environ 10 s du son d'origine (au plus 8 Mo lus à la fois).
  const tramesMorceau = Math.max(1, Math.min(e.fs * TRANCHE_S, Math.floor((8 * 1024 * 1024) / e.bloc)));
  let lues = 0;
  while (lues < e.trames) {
    verifierArret(signal);
    const n = Math.min(tramesMorceau, e.trames - lues);
    const octets = lire(e.debutData + lues * e.bloc, n * e.bloc);
    if (octets.length < n * e.bloc) throw new ErreurSon('format', 'WAV tronqué pendant la lecture');
    lues += n;
    const mono = versMono(octets, e);
    for (const t of trancheur.pousser(reech.pousser(mono))) yield { tranche: t, info };
  }
  for (const t of trancheur.pousser(reech.finir())) yield { tranche: t, info };
  if (trancheur.reste > 0) yield { tranche: trancheur.vider(), info };
}

/** Les tranches rendues par l'outil média local. */
async function* parOutil(fichier: string, format: string, o: OptionsLecture, maxSec: number): AsyncGenerator<{ tranche: Float32Array; info: InfoSon }> {
  const info: InfoSon = { format, fs: FS, canaux: 1, via: 'outil-media' };
  const lancer = o.lancer ?? lanceurParDefaut;
  const local = new AbortController();
  const signal = o.signal ? AbortSignal.any([o.signal, local.signal]) : local.signal;
  const plafond = Math.ceil(maxSec * FS * 4);
  let proc: ReturnType<Lanceur>;
  try {
    proc = lancer(OUTIL_MEDIA, argumentsOutil(fichier), { signal, timeoutMs: Math.max(1000, o.delaiMs ?? 30 * 60_000) });
  } catch (e) {
    throw enErreurSon(e, 'outil_absent');
  }
  if (!proc) throw new ErreurSon('outil_absent', MESSAGE_OUTIL_ABSENT);
  const trancheur = new Trancheur();
  let total = 0;
  let reste = new Uint8Array(0);
  let fini = false;
  try {
    for await (const morceau of proc.stdout) {
      verifierArret(o.signal);
      total += morceau.length;
      if (total > plafond) throw new ErreurSon('trop_long', `son trop long (au plus ${Math.round(maxSec)} s)`);
      const tout = new Uint8Array(reste.length + morceau.length);
      tout.set(reste, 0); tout.set(morceau, reste.length);
      const utiles = tout.length - (tout.length % 4);
      const f = new Float32Array(utiles / 4);
      const dv = new DataView(tout.buffer, tout.byteOffset, utiles);
      for (let i = 0; i < f.length; i++) { const v = dv.getFloat32(i * 4, true); f[i] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }
      reste = tout.slice(utiles);
      for (const t of trancheur.pousser(f)) yield { tranche: t, info };
    }
    const r = await proc.fin;
    verifierArret(o.signal);
    if (r.code !== 0 && total === 0) throw new ErreurSon('format', `l'outil média local n'a pas pu lire ce son (${r.err.trim().split('\n').pop()?.slice(0, 200) || `code ${r.code}`})`);
    if (trancheur.reste > 0) yield { tranche: trancheur.vider(), info };
    fini = true;
  } finally {
    if (!fini) local.abort();
  }
}
