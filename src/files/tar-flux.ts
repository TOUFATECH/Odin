// Lecteur de flux tar, fait maison (ustar, noms longs GNU, en-têtes PAX) : les fichiers arrivent un par un, en
// mémoire, sans rien écrire sur le disque. Sert à lire les fichiers d'un autre poste (par SSH ou par un partage
// Windows) pour les analyser chez Odin. Un fichier plus gros que `maxEach` n'est pas gardé en entier : on en rend
// le début (`tete`) et l'empreinte SHA-256 complète, calculée au passage.
import { createHash } from 'node:crypto';

export interface EntreeTar {
  nom: string; octets: number; fichier: boolean;
  /** le contenu entier (fichier de `maxEach` octets au plus) */
  data?: Buffer;
  /** fichier plus gros que `maxEach` : son début (`tete` octets au plus) et son empreinte complète */
  tete?: Buffer; sha256?: string;
}
export interface OptionsTar { /** taille au-delà de laquelle un fichier n'est plus gardé en entier (48 Mo) */ maxEach?: number; /** octets gardés du début d'un gros fichier (8 Mo) */ tete?: number }

/** Lit exactement ce qu'on lui demande dans un flux, morceau par morceau. */
class Lecteur {
  private file: Buffer[] = []; private len = 0; private fini = false; private it: AsyncIterator<Buffer | Uint8Array>;
  constructor(flux: AsyncIterable<Buffer | Uint8Array>) { this.it = flux[Symbol.asyncIterator](); }
  private async remplir(n: number): Promise<void> {
    while (this.len < n && !this.fini) { const r = await this.it.next(); if (r.done) this.fini = true; else if (r.value.length) { const b = Buffer.isBuffer(r.value) ? r.value : Buffer.from(r.value); this.file.push(b); this.len += b.length; } }
  }
  /** `n` octets exactement, ou rien si le flux s'arrête avant. */
  async lire(n: number): Promise<Buffer | undefined> {
    if (n === 0) return Buffer.alloc(0);
    await this.remplir(n); if (this.len < n) return undefined;
    const tout = this.file.length === 1 ? this.file[0] : Buffer.concat(this.file, this.len), out = tout.subarray(0, n), reste = tout.subarray(n);
    this.file = reste.length ? [reste] : []; this.len = reste.length; return out;
  }
  /** Passe `n` octets en les montrant à `voir` (sans les garder). Faux si le flux s'arrête avant. */
  async passer(n: number, voir?: (b: Buffer) => void): Promise<boolean> {
    let reste = n;
    while (reste > 0) {
      if (!this.len) { await this.remplir(1); if (!this.len) return false; }
      const b = this.file[0], pris = Math.min(b.length, reste);
      voir?.(b.subarray(0, pris)); reste -= pris; this.len -= pris;
      if (pris === b.length) this.file.shift(); else this.file[0] = b.subarray(pris);
    }
    return true;
  }
  /** Lit et jette ce qui reste (la fin d'une archive est suivie de blocs vides), `max` octets au plus. */
  async vider(max: number): Promise<void> {
    let vu = this.len; this.file = []; this.len = 0;
    while (!this.fini && vu < max) { const r = await this.it.next(); if (r.done) this.fini = true; else vu += r.value.length; }
  }
  /** Rend le flux : sans cela, un flux pas lu jusqu'au bout resterait ouvert pour toujours (et le programme qui l'écrit avec). */
  async fermer(): Promise<void> { if (!this.fini) { this.fini = true; try { await this.it.return?.(); } catch { /* déjà fermé */ } } }
}
const texte = (b: Buffer) => { const u = b.toString('utf8'); return u.includes('�') ? b.toString('latin1') : u; };
const chaine = (b: Buffer) => { const z = b.indexOf(0); return texte(z < 0 ? b : b.subarray(0, z)); };
/** Un nombre d'en-tête tar : octal, ou binaire (bit de poids fort) pour les très gros fichiers. Pur. */
export function nombreTar(b: Buffer): number {
  if (b[0] & 0x80) { let n = 0; for (let k = 0; k < b.length; k++) n = n * 256 + (k === 0 ? b[0] & 0x7f : b[k]); return n; }
  return parseInt(b.toString('latin1').replace(/[^0-7]/g, '') || '0', 8);
}
/** Les réglages d'un en-tête PAX (« 30 path=dossier/fichier.txt\n »). Pur. */
export function lirePax(b: Buffer): Record<string, string> {
  const out: Record<string, string> = {}; let p = 0;
  while (p < b.length) {
    const sp = b.indexOf(0x20, p); if (sp < 0) break;
    const n = Number(b.toString('latin1', p, sp)); if (!Number.isInteger(n) || n <= sp - p + 1 || p + n > b.length) break;
    const rec = b.subarray(sp + 1, p + n - 1), eq = rec.indexOf(0x3d);
    if (eq > 0) out[rec.toString('utf8', 0, eq)] = rec.toString('utf8', eq + 1);
    p += n;
  }
  return out;
}

/**
 * Les entrées d'un flux tar, une par une. Un flux coupé net (connexion perdue, lecture interrompue à la source)
 * s'arrête sans erreur : l'entrée en cours, incomplète, n'est pas rendue. Un flux qui n'est pas du tar lève une erreur.
 */
export async function* lireTar(flux: AsyncIterable<Buffer | Uint8Array>, o: OptionsTar = {}): AsyncGenerator<EntreeTar> {
  const maxEach = o.maxEach ?? 48 * 1024 * 1024, maxTete = o.tete ?? 8 * 1024 * 1024, r = new Lecteur(flux);
  let long: string | undefined, pax: Record<string, string> = {}, vides = 0;
  try {
  for (;;) {
    const h = await r.lire(512); if (!h) return;
    // Fin de l'archive : deux blocs vides, puis du remplissage qu'on laisse passer pour que l'émetteur finisse proprement.
    if (h.every((x) => x === 0)) { if (++vides >= 2) { await r.vider(64 * 1024 * 1024); return; } continue; }
    vides = 0;
    // Somme de contrôle : la zone de la somme compte comme des espaces.
    let somme = 0; for (let k = 0; k < 512; k++) somme += k >= 148 && k < 156 ? 32 : h[k];
    if (somme !== nombreTar(h.subarray(148, 156))) throw new Error('ce flux n\'est pas une archive tar lisible');
    const type = String.fromCharCode(h[156] || 48), ustar = h.toString('latin1', 257, 262) === 'ustar';
    let octets = nombreTar(h.subarray(124, 136));
    const bloc = (n: number) => Math.ceil(n / 512) * 512;
    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      // En-tête étendu : son contenu décrit l'entrée suivante (nom long, vraie taille).
      if (octets > 4 * 1024 * 1024) throw new Error('en-tête tar démesuré');
      const d = await r.lire(bloc(octets)); if (!d) return;
      if (type === 'x') pax = lirePax(d.subarray(0, octets)); else if (type === 'L') long = chaine(d.subarray(0, octets));
      continue;
    }
    const prefixe = ustar ? chaine(h.subarray(345, 500)) : '';
    const nom = (pax.path ?? long ?? `${prefixe ? `${prefixe}/` : ''}${chaine(h.subarray(0, 100))}`).replace(/^(\.\/)+/, '');
    if (pax.size !== undefined && /^\d+$/.test(pax.size)) octets = Number(pax.size);
    long = undefined; pax = {};
    const fichier = type === '0' || type === '\0' || type === '7';
    if (!fichier) { if (octets && !await r.passer(bloc(octets))) return; yield { nom, octets: 0, fichier: false }; continue; }
    if (octets <= maxEach) {
      const d = await r.lire(bloc(octets)); if (!d) return;
      yield { nom, octets, fichier: true, data: d.subarray(0, octets) };
    } else {
      // Gros fichier : on ne garde que le début, et on calcule l'empreinte de tout pendant qu'il passe.
      const sha = createHash('sha256'), tete: Buffer[] = []; let garde = 0, vu = 0;
      const ok = await r.passer(bloc(octets), (b) => {
        const utile = b.subarray(0, Math.max(0, Math.min(b.length, octets - vu))); vu += b.length;
        if (!utile.length) return; sha.update(utile);
        if (garde < maxTete) { const p = utile.subarray(0, maxTete - garde); tete.push(Buffer.from(p)); garde += p.length; }
      });
      if (!ok) return;
      yield { nom, octets, fichier: true, tete: Buffer.concat(tete, garde), sha256: sha.digest('hex') };
    }
  }
  } finally { await r.fermer(); }
}
