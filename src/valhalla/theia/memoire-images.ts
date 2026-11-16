// Théia — « retrouver une image par une phrase ». On garde l'empreinte vectorielle (plongement) de chaque image dans la
// base THEIA_ODIN (table plongements_images), avec un repli en fichier (JSONL, mode 0o600) tant que la base n'est pas là.
// Chercher une image par une phrase = calculer le plongement de la phrase avec l'encodeur de texte de l'œil, puis
// comparer aux vecteurs rangés (ils sont normalisés L2, donc le produit scalaire EST le cosinus). On NE touche PAS
// src/muninn/embed.ts : c'est la mémoire par le sens d'Odin pour le texte ; ici ce sont les images, propres à Théia.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

/** Une image rangée : un identifiant, d'où elle vient, quand, et son vecteur normalisé L2. */
export interface ImageRangee { id: string; source: string; at: number; vecteur: Float32Array }
/** Un résultat de recherche : l'image et son score de ressemblance (cosinus, -1..1). */
export interface Resultat { id: string; source: string; at: number; score: number }

/** L'encodeur de texte dont on a besoin (sous-ensemble de l'œil : pas d'import de la barrière ici). */
export interface EncodeurTexte { plongementTexte(phrase: string): Promise<Float32Array>; readonly dim: number }

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
/** Vecteur → octets (Float32 petit-boutien), pour le fichier (base64) et la base (BYTEA). */
export const vecteurEnOctets = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const octetsEnVecteur = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
/** Produit scalaire (= cosinus si les deux vecteurs sont normalisés L2). */
export function cosinus(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length); let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Le magasin des plongements d'images de Théia. Source de vérité en mémoire, écrite dans un fichier (repli) ; quand la
 * base THEIA_ODIN est là, l'appelant rejoue `pourBase()` dans la table plongements_images via les écritures de DEF_THEIA.
 */
export class MemoireImages {
  readonly dir: string;
  /** Le dossier d'Odin : s'il est donné, le vecteur d'une image (donnée privée) est CHIFFRÉ au repos (clé de la machine). */
  private readonly home?: string;
  private memo = new Map<string, ImageRangee>();
  /** Nombre de lignes PHYSIQUES dans le fichier (≥ memo.size à cause des ajouts en doublon) : pour le compactage. */
  private lignesPhysiques = 0;
  constructor(dir: string, home?: string) { this.dir = dir; this.home = home; this.memo = this.lireFichier(); }

  /** Le champ vecteur au repos : chiffré (clé de la machine) si on a le dossier d'Odin, sinon en clair (essais). */
  private chiffreV(b64: string): string { return this.home ? chiffrerChamp(this.home, b64) : b64; }
  /** L'inverse : une valeur en clair (ancien fichier) est rendue telle quelle (migration douce). */
  private clairV(v: string): string { return this.home ? dechiffrerChamp(this.home, v) : v; }

  /** Range (ou remplace) l'empreinte d'une image. */
  ajouter(id: string, source: string, vecteur: Float32Array, at = Date.now()): ImageRangee {
    if (!ID.test(id)) throw new Error(`identifiant d'image invalide : ${id}`);
    const e: ImageRangee = { id, source, at, vecteur: normaliser(vecteur) };
    this.memo.set(id, e);
    // Écriture en AJOUT (O(1)) et non réécriture complète (qui rendait l'indexation d'une photothèque quadratique) :
    // à la relecture, la DERNIÈRE ligne d'un id gagne. On compacte (réécriture complète) seulement de loin en loin.
    this.ajoutRapide(e); this.lignesPhysiques++;
    if (this.lignesPhysiques > this.memo.size * 2 + 64) this.ecrireFichier();
    return e;
  }
  /** Retire une image (rend vrai si elle existait). */
  retirer(id: string): boolean { const ok = this.memo.delete(id); if (ok) this.ecrireFichier(); return ok; }
  /** Toutes les images rangées. */
  liste(): ImageRangee[] { return [...this.memo.values()]; }
  get taille(): number { return this.memo.size; }

  /** Les k images les plus proches d'un vecteur (déjà normalisé L2 de préférence). */
  retrouver(vecteurRequete: Float32Array, k = 10): Resultat[] {
    const q = normaliser(vecteurRequete);
    return [...this.memo.values()]
      .map((e) => ({ id: e.id, source: e.source, at: e.at, score: cosinus(q, e.vecteur) }))
      .sort((a, b) => b.score - a.score).slice(0, Math.max(1, k));
  }
  /** Les k images les plus proches d'une PHRASE (calcule son plongement avec l'encodeur de texte de l'œil). */
  async retrouverParPhrase(oeil: EncodeurTexte, phrase: string, k = 10): Promise<Resultat[]> {
    const q = await oeil.plongementTexte(phrase);
    return this.retrouver(q, k);
  }

  /** Les lignes à (ré)écrire dans la base : [écriture, id, source, at, vecteur(BYTEA), dim]. */
  pourBase(): Array<[string, string, string, number, Buffer, number]> {
    return [...this.memo.values()].map((e) => ['image_pose', e.id, e.source, e.at, vecteurEnOctets(e.vecteur), e.vecteur.length]);
  }

  // ---------------- Repli fichier (une ligne JSON par image, vecteur en base64) ----------------
  private fichier(): string { return join(this.dir, 'plongements-images.jsonl'); }
  private lireFichier(): Map<string, ImageRangee> {
    const m = new Map<string, ImageRangee>();
    let lignes = 0;
    try {
      for (const l of readFileSync(this.fichier(), 'utf8').split('\n').filter(Boolean)) {
        lignes++;
        try {
          const x = JSON.parse(l) as { id: string; source: string; at: number; v: string };
          if (x.id) m.set(x.id, { id: x.id, source: x.source, at: Number(x.at) || 0, vecteur: octetsEnVecteur(Buffer.from(this.clairV(x.v), 'base64')) });
        } catch { /* ligne illisible : ignorée */ }
      }
    } catch { /* pas encore de fichier */ }
    this.lignesPhysiques = lignes;
    return m;
  }
  /** Compactage : réécriture complète du fichier (une ligne par image, sans doublon). Appelé de loin en loin. */
  private ecrireFichier(): void {
    if (!this.memo.size) { rmSync(this.fichier(), { force: true }); this.lignesPhysiques = 0; return; }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const lignes = [...this.memo.values()].map((e) => JSON.stringify({ id: e.id, source: e.source, at: e.at, v: this.chiffreV(vecteurEnOctets(e.vecteur).toString('base64')) }));
    const f = this.fichier(), t = `${f}.tmp`;
    writeFileSync(t, `${lignes.join('\n')}\n`, { mode: 0o600 }); renameSync(t, f);
    this.lignesPhysiques = this.memo.size;
  }
  /** (interne) ajout rapide d'UNE ligne (O(1)) : la relecture garde la dernière ligne d'un id. */
  private ajoutRapide(e: ImageRangee): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    appendFileSync(this.fichier(), `${JSON.stringify({ id: e.id, source: e.source, at: e.at, v: this.chiffreV(vecteurEnOctets(e.vecteur).toString('base64')) })}\n`, { mode: 0o600 });
  }
}

/** Normalise un vecteur en norme L2 (rend un vecteur de norme 1, ou le vecteur nul tel quel). */
export function normaliser(v: Float32Array): Float32Array {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s); if (n === 0) return v;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

const parDir = new Map<string, MemoireImages>();
/** Un magasin par dossier de Théia. */
export function memoireImages(dir: string, home?: string): MemoireImages {
  let m = parDir.get(dir);
  if (!m) { m = new MemoireImages(dir, home); parDir.set(dir, m); }
  return m;
}
/** (essais) oublie les magasins en mémoire. */
export function oublierMemoiresImages(): void { parDir.clear(); }
export const fichierImagesExiste = (dir: string): boolean => existsSync(join(dir, 'plongements-images.jsonl'));
