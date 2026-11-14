// Rangement local de Pégase : des fichiers JSON chiffrés (AES-256-GCM) dans le dossier du profil.
// La clé de chiffrement est tirée au hasard, puis gardée chiffrée par le système (Electron safeStorage :
// DPAPI sur Windows, Trousseau sur Mac, libsecret/kwallet sur Linux). Zéro SQLite.
import { safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Collection, Enregistrement } from '../commun/types';
import { COLLECTIONS } from '../commun/types';

const MAGIE = Buffer.from('PGS1');

/** Écrit un fichier sans jamais laisser un fichier à moitié écrit (fichier temporaire puis renommage). */
export function ecrireSur(chemin: string, contenu: Buffer | string): void {
  const tmp = `${chemin}.${process.pid}.tmp`;
  writeFileSync(tmp, contenu, { mode: 0o600 });
  renameSync(tmp, chemin);
}

/** La clé du profil : créée au premier lancement, protégée par le système. */
export function cleDuProfil(dossier: string): { cle: Buffer; protection: string } {
  mkdirSync(dossier, { recursive: true });
  const f = join(dossier, 'cle.bin');
  const dispo = safeStorage.isEncryptionAvailable();
  const protection = dispo ? (process.platform === 'linux' ? `système (${safeStorage.getSelectedStorageBackend?.() ?? 'linux'})` : 'système') : 'aucune (le système n’offre pas de coffre)';
  if (existsSync(f)) {
    const brut = readFileSync(f);
    if (brut.subarray(0, 4).equals(Buffer.from('CLE0'))) return { cle: brut.subarray(4), protection };
    return { cle: Buffer.from(safeStorage.decryptString(brut), 'base64'), protection };
  }
  const cle = randomBytes(32);
  ecrireSur(f, dispo ? safeStorage.encryptString(cle.toString('base64')) : Buffer.concat([Buffer.from('CLE0'), cle]));
  return { cle, protection };
}

export function chiffrer(cle: Buffer, clair: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle, iv);
  const corps = Buffer.concat([c.update(clair), c.final()]);
  return Buffer.concat([MAGIE, iv, c.getAuthTag(), corps]);
}

export function dechiffrer(cle: Buffer, brut: Buffer): Buffer {
  if (!brut.subarray(0, 4).equals(MAGIE)) throw new Error('fichier inconnu');
  const iv = brut.subarray(4, 16), tag = brut.subarray(16, 32);
  const d = createDecipheriv('aes-256-gcm', cle, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(brut.subarray(32)), d.final()]);
}

/** Un petit fichier JSON chiffré (réglages locaux, file d'attente de la synchro, session). */
export class FichierChiffre<T> {
  private minuterie: NodeJS.Timeout | null = null;
  constructor(private chemin: string, private cle: Buffer, public valeur: T) {
    if (existsSync(chemin)) {
      try { this.valeur = JSON.parse(dechiffrer(cle, readFileSync(chemin)).toString('utf8')); } catch { /* fichier abîmé : on repart des valeurs par défaut */ }
    }
  }
  sauver(tout = false): void {
    if (tout) { if (this.minuterie) clearTimeout(this.minuterie); this.minuterie = null; ecrireSur(this.chemin, chiffrer(this.cle, Buffer.from(JSON.stringify(this.valeur)))); return; }
    if (this.minuterie) return;
    this.minuterie = setTimeout(() => this.sauver(true), 400);
  }
}

type Ecouteur = (e: Enregistrement, local: boolean) => void;

/**
 * La base du profil : une collection = un fichier chiffré `<col>.json.pgs`.
 * Chaque enregistrement suit le format du contrat (id, col, data, maj, appareil, suppr?).
 */
export class Base {
  private cols = new Map<Collection, Map<string, Enregistrement>>();
  private sales = new Set<Collection>();
  private minuterie: NodeJS.Timeout | null = null;
  private ecouteurs: Ecouteur[] = [];
  private dernierMaj = 0;
  readonly protection: string;
  readonly cle: Buffer;

  constructor(readonly dossier: string, readonly appareil: string, readonly memoire = false) {
    if (memoire) { this.cle = randomBytes(32); this.protection = 'mémoire seulement'; }
    else { mkdirSync(dossier, { recursive: true }); const k = cleDuProfil(dossier); this.cle = k.cle; this.protection = k.protection; }
    for (const col of COLLECTIONS) {
      const m = new Map<string, Enregistrement>();
      const f = join(dossier, `${col}.json.pgs`);
      if (!memoire && existsSync(f)) {
        try { for (const e of JSON.parse(dechiffrer(this.cle, readFileSync(f)).toString('utf8')) as Enregistrement[]) m.set(e.id, e); } catch { /* collection abîmée : vide */ }
      }
      this.cols.set(col, m);
    }
  }

  surChangement(f: Ecouteur): void { this.ecouteurs.push(f); }

  /** Une heure qui monte toujours (deux changements dans la même milliseconde gardent leur ordre). */
  maintenant(): number { const t = Math.max(Date.now(), this.dernierMaj + 1); this.dernierMaj = t; return t; }

  tous<T>(col: Collection): T[] { const r: T[] = []; for (const e of this.cols.get(col)!.values()) if (!e.suppr) r.push(e.data as T); return r; }
  enregistrements(col: Collection): Enregistrement[] { return [...this.cols.get(col)!.values()]; }
  get<T>(col: Collection, id: string): T | undefined { const e = this.cols.get(col)!.get(id); return e && !e.suppr ? e.data as T : undefined; }
  brut(col: Collection, id: string): Enregistrement | undefined { return this.cols.get(col)!.get(id); }
  taille(col: Collection): number { let n = 0; for (const e of this.cols.get(col)!.values()) if (!e.suppr) n++; return n; }

  /** Change un enregistrement ici (il partira vers Odin). */
  mettre<T extends { id: string }>(col: Collection, data: T): T {
    const e: Enregistrement = { id: data.id, col, data, maj: this.maintenant(), appareil: this.appareil };
    this.cols.get(col)!.set(data.id, e); this.sale(col);
    for (const f of this.ecouteurs) f(e, true);
    return data;
  }
  suppr(col: Collection, id: string): void {
    const ancien = this.cols.get(col)!.get(id);
    if (!ancien || ancien.suppr) return;
    const e: Enregistrement = { id, col, data: null, maj: this.maintenant(), appareil: this.appareil, suppr: true };
    this.cols.get(col)!.set(id, e); this.sale(col);
    for (const f of this.ecouteurs) f(e, true);
  }

  /** Un changement venu d'ailleurs (Odin) : le `maj` le plus récent gagne, à égalité le plus petit appareil. */
  recevoir(e: Enregistrement): boolean {
    const m = this.cols.get(e.col); if (!m) return false;
    const ici = m.get(e.id);
    if (ici && (ici.maj > e.maj || (ici.maj === e.maj && ici.appareil <= e.appareil))) return false;
    m.set(e.id, e); this.sale(e.col);
    if (e.maj > this.dernierMaj) this.dernierMaj = e.maj;
    for (const f of this.ecouteurs) f(e, false);
    return true;
  }

  /** Empreinte d'une collection : SHA-256 des « id:maj » triés (contrat §3). */
  empreinte(col: Collection): { n: number; hash: string } {
    const l = [...this.cols.get(col)!.values()].map((e) => `${e.id}:${e.maj}`).sort();
    return { n: l.length, hash: createHash('sha256').update(l.join('\n')).digest('hex') };
  }

  private sale(col: Collection): void {
    this.sales.add(col);
    if (!this.minuterie) this.minuterie = setTimeout(() => this.sauver(), 500);
  }
  sauver(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    if (this.memoire) { this.sales.clear(); return; }
    for (const col of this.sales) ecrireSur(join(this.dossier, `${col}.json.pgs`), chiffrer(this.cle, Buffer.from(JSON.stringify([...this.cols.get(col)!.values()]))));
    this.sales.clear();
  }
}

/** Les profils rangés sur ce PC (un dossier chacun). */
export function listeProfils(racine: string): string[] {
  if (!existsSync(racine)) return [];
  return readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
export function effacerProfil(racine: string, nom: string): void { rmSync(join(racine, nom), { recursive: true, force: true }); }
