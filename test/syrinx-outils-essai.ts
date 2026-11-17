// Fabriques pour les essais de l'oreille d'Odin : sons en mémoire, WAV de toutes sortes, et un MINI modèle de sons
// (mêmes noms de tenseurs que le vrai, petites tailles, poids à graine). Aucun son privé, aucun réseau.

import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AnalyseSon, MomentSon, OptionsAnalyse, SourceSon } from '../src/audio/contrat.ts';
import type { Oreille } from '../src/valhalla/syrinx/index.ts';

export const FS = 16_000;

/** Petit hasard à graine. */
export function hasard(graine: number): () => number {
  let s = graine >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Un sinus. */
export function sinus(f: number, sec: number, fs = FS, amp = 0.5, phase = 0): Float32Array {
  const n = Math.round(sec * fs);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * (i / fs) + phase);
  return x;
}

/** Une « voix » fabriquée : série harmonique sur f0, enveloppe d'un formant (gaussienne autour de `formant`). */
export function voix(f0: number, formant: number, sec: number, graine = 1): Float32Array {
  const n = Math.round(sec * FS);
  const x = new Float32Array(n);
  const h = hasard(graine);
  const harmoniques: Array<{ f: number; a: number; p: number }> = [];
  for (let k = 1; f0 * k < 7000; k++) {
    const f = f0 * k;
    const a = Math.exp(-((f - formant) ** 2) / (2 * 300 ** 2)) + 0.05 * Math.exp(-f / 2000);
    harmoniques.push({ f, a, p: h() * 2 * Math.PI });
  }
  const tot = harmoniques.reduce((s, x) => s + x.a, 0);
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    const vib = 1 + 0.01 * Math.sin(2 * Math.PI * 5 * t);
    let s = 0;
    for (const q of harmoniques) s += q.a * Math.sin(2 * Math.PI * q.f * vib * t + q.p);
    x[i] = (0.4 * s) / tot;
  }
  return x;
}

/** Une mélodie à graine (notes au hasard, avec un peu de bruit) : un son riche pour l'empreinte. */
export function melodie(sec: number, graine: number): Float32Array {
  const n = Math.round(sec * FS);
  const x = new Float32Array(n);
  const h = hasard(graine);
  let i = 0;
  while (i < n) {
    const duree = Math.round((0.15 + h() * 0.35) * FS);
    const f1 = 110 * 2 ** (Math.floor(h() * 36) / 12), f2 = 110 * 2 ** (Math.floor(h() * 36) / 12);
    for (let k = 0; k < duree && i + k < n; k++) {
      const t = k / FS, env = Math.min(1, k / 160) * Math.exp(-t * 3);
      x[i + k] = env * (0.3 * Math.sin(2 * Math.PI * f1 * t) + 0.2 * Math.sin(2 * Math.PI * f2 * t) + 0.1 * Math.sin(6 * Math.PI * f1 * t)) + (h() - 0.5) * 0.01;
    }
    i += duree;
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------------------
// Encodeurs de la téléphonie (norme publique), pour fabriquer des WAV A-law et µ-law.
// ---------------------------------------------------------------------------------------------------------------

export function versMulaw(s: number): number {
  const BIAIS = 0x84, PLAFOND = 32635;
  let signe = (s >> 8) & 0x80;
  if (signe) s = -s;
  if (s > PLAFOND) s = PLAFOND;
  s += BIAIS;
  let exp = 7;
  for (let masque = 0x4000; (s & masque) === 0 && exp > 0; exp--, masque >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  signe = signe ? 0x80 : 0;
  return ~(signe | (exp << 4) | mant) & 0xff;
}

export function versAlaw(s16: number): number {
  let v = s16 >> 3;
  let masque: number;
  if (v >= 0) masque = 0xd5; else { masque = 0x55; v = -v - 1; }
  const fins = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
  let seg = 0;
  while (seg < 8 && v > fins[seg]) seg++;
  if (seg >= 8) return 0x7f ^ masque;
  let a = seg << 4;
  a |= seg < 2 ? (v >> 1) & 0x0f : (v >> seg) & 0x0f;
  return a ^ masque;
}

export type Codage = 'u8' | 's16' | 's24' | 's32' | 'f32' | 'f64' | 'alaw' | 'mulaw';

/** Fabrique un WAV : canaux (même longueur), fréquence, codage, et la forme « extensible » si demandé. */
export function wavDe(canaux: Float32Array[], fs: number, codage: Codage, o: { extensible?: boolean } = {}): Uint8Array {
  const c = canaux.length, n = canaux[0].length;
  const bits = codage === 'u8' || codage === 'alaw' || codage === 'mulaw' ? 8 : codage === 's16' ? 16 : codage === 's24' ? 24 : codage === 'f64' ? 64 : 32;
  const code = codage === 'f32' || codage === 'f64' ? 3 : codage === 'alaw' ? 6 : codage === 'mulaw' ? 7 : 1;
  const oct = bits / 8, bloc = c * oct;
  const tailleFmt = o.extensible ? 40 : 16;
  const data = n * bloc;
  const out = new Uint8Array(12 + 8 + tailleFmt + 8 + data);
  const dv = new DataView(out.buffer);
  const ascii = (p: number, s: string) => { for (let i = 0; i < s.length; i++) out[p + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); dv.setUint32(4, out.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); dv.setUint32(16, tailleFmt, true);
  dv.setUint16(20, o.extensible ? 0xfffe : code, true); dv.setUint16(22, c, true); dv.setUint32(24, fs, true);
  dv.setUint32(28, fs * bloc, true); dv.setUint16(32, bloc, true); dv.setUint16(34, bits, true);
  if (o.extensible) {
    dv.setUint16(36, 22, true); dv.setUint16(38, bits, true); dv.setUint32(40, c === 1 ? 4 : 3, true);
    dv.setUint16(44, code, true);
    out.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 46);
  }
  const d0 = 12 + 8 + tailleFmt;
  ascii(d0, 'data'); dv.setUint32(d0 + 4, data, true);
  let p = d0 + 8;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    const v = Math.max(-1, Math.min(1, canaux[k][i]));
    switch (codage) {
      case 'u8': out[p] = Math.max(0, Math.min(255, Math.round(v * 127) + 128)); break;
      case 's16': dv.setInt16(p, Math.round(v * 32767), true); break;
      case 's24': { const s = Math.round(v * 8388607); out[p] = s & 0xff; out[p + 1] = (s >> 8) & 0xff; out[p + 2] = (s >> 16) & 0xff; break; }
      case 's32': dv.setInt32(p, Math.round(v * 2147483647), true); break;
      case 'f32': dv.setFloat32(p, v, true); break;
      case 'f64': dv.setFloat64(p, v, true); break;
      case 'alaw': out[p] = versAlaw(Math.round(v * 32767)); break;
      case 'mulaw': out[p] = versMulaw(Math.round(v * 32767)); break;
    }
    p += oct;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Mini modèle de sons (même nommage que le vrai) et modèle de la vraie forme à poids aléatoires.
// ---------------------------------------------------------------------------------------------------------------

export interface FormeModele { D: number; blocs: number; tetes: number; libelles: string[]; prefixe?: string }

export const LIBELLES_MINI = ['Speech', 'Music', 'Glass', 'Shatter', 'Doorbell'];

/** Écrit un fichier de poids (format public : longueur d'en-tête sur 8 octets, en-tête JSON, octets bruts F32). */
export async function ecrireModele(
  dossier: string,
  forme: FormeModele,
  o: { sans?: string; formeFausse?: { nom: string; dims: number[] }; graine?: number } = {},
): Promise<{ sha256: string }> {
  const { D, blocs, libelles } = forme;
  const pre = forme.prefixe ?? '';
  const h = hasard(o.graine ?? 1234);
  const al = (n: number, e: number) => Float32Array.from({ length: n }, () => (h() * 2 - 1) * e);
  const un = (n: number, e: number) => Float32Array.from({ length: n }, () => 1 + (h() * 2 - 1) * e);
  const tenseurs: Array<{ nom: string; dims: number[]; data: Float32Array }> = [];
  const ajouter = (nom: string, dims: number[], data: Float32Array) => tenseurs.push({ nom, dims, data });
  ajouter(`${pre}init_bn.running_mean`, [64], al(64, 5).map((v) => v - 40));
  ajouter(`${pre}init_bn.running_var`, [64], un(64, 0.5).map((v) => v * 100));
  ajouter(`${pre}init_bn.weight`, [64], un(64, 0.1));
  ajouter(`${pre}init_bn.bias`, [64], al(64, 0.1));
  ajouter(`${pre}init_bn.num_batches_tracked`, [], new Float32Array(1));
  ajouter(`${pre}patch_embed.proj.weight`, [D, 1, 16, 16], al(D * 256, 0.06));
  ajouter(`${pre}patch_embed.proj.bias`, [D], al(D, 0.02));
  ajouter(`${pre}freq_pos_embed`, [1, D, 4, 1], al(D * 4, 0.02));
  ajouter(`${pre}time_pos_embed`, [1, D, 1, 63], al(D * 63, 0.02));
  const H = 4 * D;
  const e = 1 / Math.sqrt(D);
  for (let b = 0; b < blocs; b++) {
    const p = `${pre}blocks.${b}`;
    ajouter(`${p}.norm1.weight`, [D], un(D, 0.1)); ajouter(`${p}.norm1.bias`, [D], al(D, 0.05));
    ajouter(`${p}.attn.qkv.weight`, [3 * D, D], al(3 * D * D, e)); ajouter(`${p}.attn.qkv.bias`, [3 * D], al(3 * D, 0.02));
    ajouter(`${p}.attn.proj.weight`, [D, D], al(D * D, e)); ajouter(`${p}.attn.proj.bias`, [D], al(D, 0.02));
    ajouter(`${p}.norm2.weight`, [D], un(D, 0.1)); ajouter(`${p}.norm2.bias`, [D], al(D, 0.05));
    ajouter(`${p}.mlp.fc1.weight`, [H, D], al(H * D, e)); ajouter(`${p}.mlp.fc1.bias`, [H], al(H, 0.02));
    ajouter(`${p}.mlp.fc2.weight`, [D, H], al(D * H, 1 / Math.sqrt(H))); ajouter(`${p}.mlp.fc2.bias`, [D], al(D, 0.02));
  }
  ajouter(`${pre}norm.weight`, [D], un(D, 0.1)); ajouter(`${pre}norm.bias`, [D], al(D, 0.05));
  ajouter('outputlayer.0.weight', [D], un(D, 0.1)); ajouter('outputlayer.0.bias', [D], al(D, 0.05));
  ajouter('outputlayer.1.weight', [libelles.length, D], al(libelles.length * D, e)); ajouter('outputlayer.1.bias', [libelles.length], al(libelles.length, 0.5));
  const gardes = tenseurs.filter((t) => t.nom !== o.sans).map((t) => (o.formeFausse && t.nom === o.formeFausse.nom ? { ...t, dims: o.formeFausse.dims, data: new Float32Array(o.formeFausse.dims.reduce((a, b) => a * b, 1)) } : t));
  const entete: Record<string, unknown> = { __metadata__: { format: 'pt' } };
  let off = 0;
  for (const t of gardes) {
    const n = t.data.length * 4;
    entete[t.nom] = { dtype: 'F32', shape: t.dims, data_offsets: [off, off + n] };
    off += n;
  }
  let json = JSON.stringify(entete);
  while ((8 + json.length) % 8) json += ' ';
  const jb = Buffer.from(json, 'utf8');
  const tout = Buffer.alloc(8 + jb.length + off);
  tout.writeBigUInt64LE(BigInt(jb.length), 0);
  jb.copy(tout, 8);
  let p = 8 + jb.length;
  for (const t of gardes) { Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength).copy(tout, p); p += t.data.byteLength; }
  await writeFile(join(dossier, 'sons-petit.safetensors'), tout);
  const id2label: Record<string, string> = {};
  libelles.forEach((l, i) => { id2label[String(i)] = l; });
  await writeFile(join(dossier, 'sons-petit.config.json'), JSON.stringify({ id2label, num_heads: forme.tetes }));
  return { sha256: createHash('sha256').update(tout).digest('hex') };
}

/** Le MINI modèle : D 8, 2 blocs, 2 têtes, 5 classes (Speech, Music, Glass, Shatter, Doorbell), poids à graine. */
export function ecrireMiniModele(dossier: string, o: { sans?: string; formeFausse?: { nom: string; dims: number[] } } = {}): Promise<{ sha256: string }> {
  return ecrireModele(dossier, { D: 8, blocs: 2, tetes: 2, libelles: LIBELLES_MINI }, o);
}

/** Un faux « fetch » qui sert des octets donnés pour chaque adresse. */
export function fauxFetch(reponses: Record<string, Uint8Array | string>, o: { annonce?: number } = {}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    const r = reponses[u];
    if (r === undefined) return new Response('absent', { status: 404 });
    const corps = typeof r === 'string' ? Buffer.from(r, 'utf8') : r;
    // Le corps est servi par morceaux de 64 Ko, comme sur le réseau.
    const flux = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < corps.length; i += 65536) c.enqueue(corps.slice(i, i + 65536)); c.close(); },
    });
    const entetes: Record<string, string> = {};
    if (o.annonce !== undefined) entetes['content-length'] = String(o.annonce);
    return new Response(flux, { status: 200, headers: entetes });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------------------------------------------
// Sons fabriqués pour le calibrage de « musique probable » et des zones (aucun son privé).
// ---------------------------------------------------------------------------------------------------------------

/** Une chanson fabriquée : une note de la gamme de do par temps, une basse tenue sur 4 accords, un battement grave. */
export function chanson(sec: number, graine: number, bpm = 120): Float32Array {
  const n = Math.round(sec * FS), x = new Float32Array(n), h = hasard(graine);
  const gamme = [0, 2, 4, 5, 7, 9, 11, 12], accords = [0, 5, 7, 9], temps = 60 / bpm;
  for (let b = 0; b * temps < sec; b++) {
    const d = Math.round(b * temps * FS), rac = 130.81 * 2 ** (accords[Math.floor(b / 4) % 4] / 12);
    const note = 261.63 * 2 ** (gamme[Math.floor(h() * gamme.length)] / 12);
    for (let k = 0; k < temps * FS && d + k < n; k++) {
      const t = k / FS, env = Math.min(1, k / 80) * Math.exp(-t * 2);
      x[d + k] += 0.25 * env * Math.sin(2 * Math.PI * note * t) + 0.2 * Math.sin(2 * Math.PI * (rac / 2) * ((d + k) / FS));
      if (k < 1200) x[d + k] += 0.4 * Math.exp(-k / 300) * Math.sin(2 * Math.PI * 60 * t);
    }
  }
  return x;
}

/** Une parole fabriquée : syllabes de 80 à 300 ms, hauteur qui glisse, petites pauses et quelques silences plus longs. */
export function parle(sec: number, graine: number, f0b = 120, formant = 700): Float32Array {
  const n = Math.round(sec * FS), x = new Float32Array(n), h = hasard(graine);
  let i = 0, f0 = f0b, ph = 0;
  while (i < n) {
    const syl = Math.round((0.08 + h() * 0.22) * FS), trou = Math.round((h() < 0.15 ? 0.4 + h() * 0.5 : 0.03 + h() * 0.12) * FS);
    const f2 = formant * (0.7 + h() * 0.8);
    for (let k = 0; k < syl && i + k < n; k++) {
      f0 = Math.max(f0b * 0.7, Math.min(f0b * 1.6, f0 + (h() - 0.5) * 0.4));
      ph += (2 * Math.PI * f0) / FS;
      const env = Math.sin((Math.PI * k) / syl);
      let s = 0; for (let q = 1; q * f0 < 4000; q++) s += Math.exp(-((q * f0 - f2) ** 2) / (2 * 250 ** 2)) * Math.sin(q * ph);
      x[i + k] = 0.3 * env * s + (h() - 0.5) * 0.02 * env;
    }
    i += syl + trou;
  }
  return x;
}

// ------------------------------------------------------------------ Une fausse oreille (essais des branchements et des liens)
/** Un moment de son reconnu, pour l'essai. */
export const momentEssai = (cle: string, famille: MomentSon['famille'], pas: number, pMax = 0.9): MomentSon => ({ debut: 1, fin: 1 + pas * 0.16, indice: 3, cle, libelle: cle === 'verre' ? 'verre cassé' : cle, famille, pMax, pas });

/** Une analyse complète fabriquée : de la musique (120 BPM, do majeur, deux parties), un verre cassé, une phrase. */
export function analyseEssai(o: Partial<AnalyseSon> = {}): AnalyseSon {
  return {
    version: 1, duree: 30, source: { format: 'wav', fs: 16000, canaux: 1, via: 'natif' }, sha: 'x', onde: [0.2], volume: { rmsDb: -18, creteDb: -2 },
    zones: [{ debut: 0, fin: 30, son: true }], changements: [15],
    musique: { probable: true, par: 'sans-modele', confiance: 0.71, tempo: { bpm: 120, second: 60, confiance: 0.8 }, tonalite: { nom: 'do majeur', tonique: 0, mode: 'majeur', confiance: 0.66, second: 'la mineur' }, parties: [{ debut: 0, fin: 15, groupe: 'A', refrainProbable: false }, { debut: 15, fin: 30, groupe: 'B', refrainProbable: true }] },
    sons: { etat: 'fait', etiquettes: [{ indice: 3, cle: 'verre', libelle: 'verre cassé', famille: 'alerte', p: 0.88, seuil: 0.4 }], moments: [momentEssai('verre', 'alerte', 3, 0.88)], plongement: [] },
    parole: { etat: 'faite', texte: 'bonjour à tous', langue: 'fr', confianceLangue: 0.93, segments: [{ debut: 2, fin: 4, texte: 'bonjour à tous' }], tours: [{ debut: 0, fin: 5, voix: 'voix 1' }], texteRetire: false },
    mesures: [{ etape: 'total', ms: 40, xTempsReel: 750 }], manque: ['instruments : modèle absent'], ...o,
  };
}

/** Une fausse oreille : elle rend l'analyse donnée et note chaque appel (source et options). Aucun calcul, aucun réseau. */
export function fausseOreille(rendu: (src: SourceSon, op: OptionsAnalyse) => AnalyseSon, pret = true) {
  const appels: Array<{ src: SourceSon; op: OptionsAnalyse }> = [];
  const o: Oreille = {
    CATALOGUE_SONS: { taille: 1, licence: 'Apache-2.0' },
    async analyserSon(src, op = {}) { appels.push({ src, op }); return { analyse: rendu(src, op), empreinte: { sha: 'x', codes: new Uint32Array(0), instants: new Uint32Array(0) } }; },
    async ouvrirModeleSons() { return { pret, classes: 1, libelles: ['verre cassé'], classer: async () => ({ probas: Float32Array.of(0.9), parPas: Float32Array.of(0.9), pas: 1, plongement: new Float32Array(192) }) }; },
    etatModeleSons: () => ({ present: pret, verifie: pret, aTourne: false }),
    voterEmpreinte: () => [],
    sonFabrique: () => new Uint8Array(8),
  };
  return { o, appels };
}
