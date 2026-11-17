// Ce qu'Agora garde sur l'ordinateur, dans son dossier (Windows : %APPDATA%\Agora, Mac : ~/Library/Application Support/
// Agora, Linux : ~/.config/agora) :
//   reglages.json  l'adresse d'Odin, l'empreinte de son certificat (épinglée), l'identifiant de cet appareil — rien de secret ;
//   session.bin    le jeton de renouvellement de la connexion unique, chiffré par le système (Electron safeStorage :
//                  DPAPI sous Windows, Trousseau sur Mac, libsecret ou kwallet sous Linux) ;
//   installes.json ce que le store a installé ici (pour le désinstaller, le mettre à jour et le dire à Odin) ;
//   historique.json ce qui s'est passé (installé, retiré, refusé).
import { safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Installe } from './installeur';

export function ecrire(f: string, contenu: string | Buffer): void { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, contenu, { mode: 0o600 }); renameSync(tmp, f); }
const lire = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } };

export interface Reglages { adresse?: string; empreinte?: string | null; nomOdin?: string; appareil: string }
export interface Ligne { quand: number; texte: string; ok: boolean }

export class Rangement {
  readonly dossier: string; reglages: Reglages; installes: Record<string, Installe>; historique: Ligne[];
  constructor(dossier: string) {
    this.dossier = dossier; mkdirSync(dossier, { recursive: true, mode: 0o700 });
    this.reglages = lire(join(dossier, 'reglages.json'), { appareil: '' } as Reglages);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(this.reglages.appareil)) { this.reglages.appareil = randomBytes(18).toString('base64url'); this.sauverReglages(); }
    this.installes = lire(join(dossier, 'installes.json'), {} as Record<string, Installe>);
    this.historique = lire(join(dossier, 'historique.json'), [] as Ligne[]);
  }
  sauverReglages(): void { ecrire(join(this.dossier, 'reglages.json'), JSON.stringify(this.reglages, null, 1)); }
  sauverInstalles(): void { ecrire(join(this.dossier, 'installes.json'), JSON.stringify(this.installes, null, 1)); }
  noter(texte: string, ok = true): void { this.historique = [{ quand: Date.now(), texte: texte.slice(0, 300), ok }, ...this.historique].slice(0, 300); ecrire(join(this.dossier, 'historique.json'), JSON.stringify(this.historique)); }
  /** Le coffre du système est-il là ? (sinon la session n'est pas gardée : il faudra se reconnecter au prochain lancement) */
  coffreDispo(): boolean { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } }
  /** Garde la session de la connexion unique (texte JSON de la bibliothèque), chiffrée par le système. */
  garderSession(texte: string): void {
    const f = join(this.dossier, 'session.bin');
    if (!texte || texte === 'null') { rmSync(f, { force: true }); return; }
    if (!this.coffreDispo()) return; // jamais en clair
    ecrire(f, safeStorage.encryptString(texte));
  }
  relireSession(): string | undefined { const f = join(this.dossier, 'session.bin'); if (!existsSync(f) || !this.coffreDispo()) return undefined; try { return safeStorage.decryptString(readFileSync(f)); } catch { return undefined; } }
}
