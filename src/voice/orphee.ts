// Orphée temps réel : la conversation à voix haute en direct. Le service (voix-temps-reel/orphee.py) n'est plus lancé :
// il reposait sur des modèles d'autrui (détection de la parole, fin de tour, Whisper). Décision du propriétaire du
// 17/11/2026 : aucun modèle qui ne soit pas celui d'Odin. Démarrer répond « pas encore », sans lancer de programme ni
// ouvrir de port ; la page garde l'écrit. `trouverPython` reste pour les essais des capsules et de
// Phénix (ils lancent leurs propres scripts, sans modèle) ; aucun fichier de src/ ne l'appelle plus.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pasEntraine } from '../langue/pas-entraine.ts';

export type EtatOrphee = 'arrêté' | 'démarrage' | 'prêt' | 'absent' | 'en panne';
export interface Moteurs { vad: string; tour: string; stt: string; remarques: string[] }
/** Les options d'autrefois (dossier d'Odin) ; plus aucune ne lance quoi que ce soit. */
export interface OptionsOrphee { home?: string }

/** Le script du service, à la racine du dépôt d'Odin. */
export const SCRIPT_ORPHEE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'voix-temps-reel', 'orphee.py');

/** Un Python 3.9 ou plus récent sur la machine (sa commande), ou rien. */
export function trouverPython(prefere?: string): { cmd: string; args: string[] } | undefined {
  const essais: Array<{ cmd: string; args: string[] }> = [];
  for (const c of [prefere, process.env.ODIN_PYTHON].filter(Boolean) as string[]) essais.push({ cmd: c, args: [] });
  if (process.platform === 'win32') essais.push({ cmd: 'python', args: [] }, { cmd: 'py', args: ['-3'] });
  else essais.push({ cmd: 'python3', args: [] }, { cmd: 'python', args: [] });
  for (const e of essais) {
    try {
      const r = spawnSync(e.cmd, [...e.args, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const m = /^(\d+)\.(\d+)/.exec(String(r.stdout ?? '').trim());
      if (r.status === 0 && m && Number(m[1]) === 3 && Number(m[2]) >= 9) return e;
    } catch { /* commande absente */ }
  }
  return undefined;
}

export class Orphee {
  etat: EtatOrphee = 'arrêté';
  raison = '';
  moteurs?: Moteurs;
  /** Toujours 0 : aucun service n'écoute. */
  readonly port = 0;
  readonly relances = 0;

  readonly o: OptionsOrphee;
  constructor(o: OptionsOrphee = {}) { this.o = o; }

  get pret(): boolean { return false; }
  /** Aucune ligne : aucun service n'a tourné. */
  dernieresLignes(): string[] { return []; }

  /** Ne lance plus rien : « pas encore » (le modèle d'écoute d'Odin n'est pas entraîné). */
  demarrer(): Promise<boolean> { this.etat = 'absent'; this.raison = pasEntraine('conversationDirect'); return Promise.resolve(false); }

  /** Rien à arrêter. */
  arreter(): void { if (this.etat !== 'absent') this.etat = 'arrêté'; }

  /** Rien à tuer. */
  tuer(): void { /* aucun service */ }

  /** Plus de service à appeler. */
  async appeler(_chemin: string, _init: RequestInit = {}): Promise<Response> { throw new Error(pasEntraine('conversationDirect')); }

  /** Ce qu'on peut montrer de l'état. */
  resume(): { etat: EtatOrphee; raison: string; moteurs?: Moteurs; relances: number } {
    return { etat: this.etat, raison: this.raison, ...(this.moteurs ? { moteurs: this.moteurs } : {}), relances: this.relances };
  }
}

let instance: Orphee | undefined;
/** Le service d'Odin (un seul par processus). */
export function orphee(o?: OptionsOrphee): Orphee { if (!instance) instance = new Orphee(o); return instance; }
/** Remplace le service (essais). */
export function fixerOrphee(o: Orphee | undefined): void { instance?.arreter(); instance = o; }
