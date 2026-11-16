// Dodone · le coffre des variables secrètes (jetons, clés, mots de passe des environnements). Rangé dans coffre.json
// (0o600), chaque valeur chiffrée avec la clé de la machine (chiffrerChamp). Jamais en base, jamais renvoyé à la page
// (« ●●●● au coffre »). Les valeurs sont masquées dans les réponses affichées et dans l'historique.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

export const MASQUE = '●●●●';
type Fichier = Record<string, Record<string, string>>;

export class Coffre {
  private f: string;
  private home: string;
  constructor(dir: string, home: string) { this.f = join(dir, 'coffre.json'); this.home = home; }
  private lire(): Fichier { try { return JSON.parse(readFileSync(this.f, 'utf8')) as Fichier; } catch { return {}; } }
  private ecrire(x: Fichier): void {
    mkdirSync(join(this.f, '..'), { recursive: true, mode: 0o700 });
    const t = `${this.f}.tmp`; writeFileSync(t, JSON.stringify(x, null, 1), { mode: 0o600 }); renameSync(t, this.f);
  }
  /** Range une valeur secrète (chiffrée) pour un environnement. */
  ranger(env: string, nom: string, valeur: string): void {
    if (!/^[\w.-]{1,60}$/.test(nom)) throw new Error('nom de variable : lettres, chiffres, _ . -');
    const x = this.lire(); (x[env] ??= {})[nom] = chiffrerChamp(this.home, valeur); this.ecrire(x);
  }
  retirer(env: string, nom?: string): void { const x = this.lire(); if (!x[env]) return; if (nom) delete x[env][nom]; else delete x[env]; this.ecrire(x); }
  /** Les noms des secrets d'un environnement (jamais leurs valeurs). */
  noms(env: string): string[] { return Object.keys(this.lire()[env] ?? {}).sort(); }
  /** Les valeurs déchiffrées d'un environnement (pour l'envoi seulement, en mémoire). */
  valeurs(env: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.lire()[env] ?? {})) { try { out[k] = dechiffrerChamp(this.home, v); } catch { /* clé perdue : la variable manque */ } }
    return out;
  }
  /** Toutes les valeurs secrètes connues (pour les masquer partout). */
  toutes(): string[] { return [...new Set(Object.keys(this.lire()).flatMap((e) => Object.values(this.valeurs(e))))].filter((v) => v.length >= 3); }
}

/** Remplace chaque valeur secrète (telle quelle, encodée pour un lien, ou en base64) par ●●●●. Pur. */
export function masquerSecrets(t: string, secrets: string[]): string {
  let x = t;
  for (const v of [...secrets].sort((a, b) => b.length - a.length)) {
    for (const forme of new Set([v, encodeURIComponent(v), Buffer.from(v, 'utf8').toString('base64').replace(/=+$/, '')])) if (forme.length >= 3) x = x.split(forme).join(MASQUE);
  }
  return x;
}
