// Comète · partage de fichiers : où vont les morceaux reçus. Seul le fichier choisi (la vidéo) est écrit, dans le
// dossier de travail de ce téléchargement ; les morceaux « de bord » (à cheval sur un autre fichier du partage) sont
// gardés entiers à part, pour être vérifiés et servis. L'état (quels morceaux sont vérifiés) est gardé pour la reprise ;
// à la reprise, chaque morceau noté est RELU et revérifié (SHA-1) : rien n'est cru sur parole.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, readFile, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { morceauxDe, tailleDe, type Partage } from './metainfo.ts';

export interface Etat { empreinte: string; fichier: number; faits: string }

export class Stockage {
  readonly premier: number; readonly dernier: number;
  readonly fait: Buffer; private fh?: FileHandle;
  readonly debutFichier: number; readonly tailleFichier: number;
  private dernierEtat = 0; private resteN: number;
  readonly p: Partage; readonly k: number; readonly dossier: string; readonly nomFichier: string;
  constructor(p: Partage, k: number, dossier: string, nomFichier: string) {
    this.p = p; this.k = k; this.dossier = dossier; this.nomFichier = nomFichier;
    [this.premier, this.dernier] = morceauxDe(p, k);
    const f = p.fichiers[k]; this.debutFichier = f.debut; this.tailleFichier = f.taille;
    this.fait = Buffer.alloc(Math.ceil(p.morceaux.length / 8)); this.resteN = this.dernier - this.premier + 1;
    mkdirSync(join(dossier, 'bords'), { recursive: true, mode: 0o700 });
  }
  get chemin(): string { return join(this.dossier, this.nomFichier); }
  private get cheminEtat(): string { return join(this.dossier, 'etat.json'); }
  /** Le morceau i est-il entièrement dans le fichier choisi ? */
  private interieur(i: number): boolean { const d = i * this.p.tailleMorceau; return d >= this.debutFichier && d + tailleDe(this.p, i) <= this.debutFichier + this.tailleFichier; }
  /** La part du morceau i dans le fichier : [début dans le morceau, longueur, position dans le fichier]. */
  private part(i: number): [number, number, number] {
    const d = i * this.p.tailleMorceau, f = d + tailleDe(this.p, i), a = Math.max(d, this.debutFichier), b = Math.min(f, this.debutFichier + this.tailleFichier);
    return [a - d, Math.max(0, b - a), a - this.debutFichier];
  }
  utile(i: number): boolean { return i >= this.premier && i <= this.dernier; }
  aLe(i: number): boolean { return (this.fait[i >> 3] & (0x80 >> (i & 7))) !== 0; }
  get restants(): number[] { const l: number[] = []; for (let i = this.premier; i <= this.dernier; i++) if (!this.aLe(i)) l.push(i); return l; }
  /** Combien de morceaux du fichier manquent (sans parcourir tout le champ). */
  get nbRestants(): number { return this.resteN; }
  get fini(): boolean { return this.resteN === 0; }
  private marquer(i: number): void { if (!this.aLe(i)) { this.fait[i >> 3] |= 0x80 >> (i & 7); this.resteN--; } }
  /** Octets du fichier choisi déjà vérifiés. */
  get octetsFaits(): number { let n = 0; for (let i = this.premier; i <= this.dernier; i++) if (this.aLe(i)) n += this.part(i)[1]; return n; }

  async ouvrir(): Promise<void> {
    if (!existsSync(this.chemin)) writeFileSync(this.chemin, Buffer.alloc(0), { mode: 0o600 });
    this.fh = await open(this.chemin, 'r+');
  }
  async fermer(): Promise<void> { this.ecrireEtat(true); await this.fh?.close().catch(() => undefined); this.fh = undefined; }

  /** Reprise : l'état gardé est relu, chaque morceau noté est revérifié sur le disque. Rend le nombre gardé. */
  async reprendre(): Promise<number> {
    let e: Etat | undefined; try { e = JSON.parse(readFileSync(this.cheminEtat, 'utf8')) as Etat; } catch { return 0; }
    if (!e || e.empreinte !== this.p.empreinte.toString('hex') || e.fichier !== this.k) return 0;
    const champ = Buffer.from(String(e.faits), 'base64'); let n = 0;
    for (let i = this.premier; i <= this.dernier; i++) {
      if (!((champ[i >> 3] ?? 0) & (0x80 >> (i & 7)))) continue;
      const b = await this.lire(i).catch(() => undefined);
      if (!b || !createHash('sha1').update(b).digest().equals(this.p.morceaux[i])) continue;
      // Un morceau de bord est relu dans sa copie à part : sa part dans la vidéo est réécrite depuis cette copie vérifiée
      // (sinon une part abîmée dans la vidéo, par une coupure avant l'écriture sur le disque, serait gardée telle quelle).
      if (!this.interieur(i)) { const [d, l, pos] = this.part(i); if (l > 0 && this.fh) { const r = await this.fh.write(b, d, l, pos).catch(() => undefined); if (!r || r.bytesWritten !== l) continue; } }
      this.marquer(i); n++;
    }
    return n;
  }
  /** Écrit un morceau DÉJÀ vérifié. */
  async ecrire(i: number, data: Buffer): Promise<void> {
    if (!this.fh) throw new Error('stockage fermé');
    if (!this.interieur(i)) await writeFile(join(this.dossier, 'bords', `${i}.bin`), data, { mode: 0o600 });
    const [d, l, pos] = this.part(i);
    if (l > 0) await this.fh.write(data, d, l, pos);
    this.marquer(i);
    this.ecrireEtat(false);
  }
  /** Relit un morceau (pour le revérifier ou le servir à un autre pair). */
  async lire(i: number): Promise<Buffer> {
    if (!this.interieur(i)) return readFile(join(this.dossier, 'bords', `${i}.bin`));
    if (!this.fh) throw new Error('stockage fermé');
    const t = tailleDe(this.p, i), b = Buffer.alloc(t), [, , pos] = this.part(i);
    const { bytesRead } = await this.fh.read(b, 0, t, pos);
    if (bytesRead !== t) throw new Error('morceau incomplet sur le disque');
    return b;
  }
  /** Relit un bloc d'un morceau déjà vérifié (pour le servir à un autre pair). */
  async lireBloc(i: number, debut: number, longueur: number): Promise<Buffer> {
    if (!this.aLe(i) || debut < 0 || longueur <= 0 || debut + longueur > tailleDe(this.p, i)) throw new Error('bloc hors du morceau');
    const b = Buffer.alloc(longueur);
    if (!this.interieur(i)) {
      const fh = await open(join(this.dossier, 'bords', `${i}.bin`), 'r');
      try { const { bytesRead } = await fh.read(b, 0, longueur, debut); if (bytesRead !== longueur) throw new Error('morceau incomplet sur le disque'); } finally { await fh.close(); }
      return b;
    }
    if (!this.fh) throw new Error('stockage fermé');
    const { bytesRead } = await this.fh.read(b, 0, longueur, this.part(i)[2] + debut);
    if (bytesRead !== longueur) throw new Error('morceau incomplet sur le disque');
    return b;
  }
  /** Le champ de bits à envoyer aux pairs (ce qu'on a). */
  champ(): Buffer { return Buffer.from(this.fait); }
  ecrireEtat(forcer: boolean): void {
    const now = Date.now(); if (!forcer && now - this.dernierEtat < 2000) return; this.dernierEtat = now;
    const e: Etat = { empreinte: this.p.empreinte.toString('hex'), fichier: this.k, faits: this.fait.toString('base64') };
    const t = `${this.cheminEtat}.tmp`; try { writeFileSync(t, JSON.stringify(e), { mode: 0o600 }); renameSync(t, this.cheminEtat); } catch { /* le disque refuse : la reprise revérifiera */ }
  }
  /** Fin : les morceaux de bord et l'état ne servent plus. */
  nettoyerTravail(): void { rmSync(join(this.dossier, 'bords'), { recursive: true, force: true }); rmSync(this.cheminEtat, { force: true }); }
}
