// Orphée temps réel : Odin lance le service vocal en direct (voix-temps-reel/orphee.py), le surveille, le relance
// s'il tombe, et se rabat sur la voix habituelle (whisper.cpp + Piper, micro « maintenir pour parler ») s'il n'est
// pas là : pas de Python, script absent, ou service en panne. Rien de cela n'empêche Odin de parler ou d'écouter.
//
// Sécurité : le service n'écoute que sur 127.0.0.1, sur un port choisi par le système (ou ODIN_ORPHEE_PORT), et
// demande un jeton tiré au hasard à chaque lancement ; ce jeton passe par l'environnement (jamais en argument, donc
// jamais dans la liste des processus) et n'apparaît dans aucun journal. Le navigateur ne lui parle jamais
// directement : tout passe par Odin (orphee-api.ts), après la vérification de la session.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { localWhisper, voiceHome } from './local.ts';

export type EtatOrphee = 'arrêté' | 'démarrage' | 'prêt' | 'absent' | 'en panne';
export interface Moteurs { vad: string; tour: string; stt: string; remarques: string[] }
export interface OptionsOrphee {
  home?: string;
  /** commande Python (sinon ODIN_PYTHON, puis python3 / python / py) */
  python?: string;
  /** le script du service (sinon voix-temps-reel/orphee.py à la racine d'Odin) */
  script?: string;
  /** port fixe (sinon ODIN_ORPHEE_PORT, sinon un port libre choisi par le système) */
  port?: number;
  /** dossier des modèles Silero / Smart Turn (sinon ~/.odin/voice/orphee) */
  modeles?: string;
  /** whisper.cpp pour la transcription en direct (sinon celui qu'Odin a installé, s'il y en a un) */
  whisper?: { bin: string; model: string } | null;
  /** relance automatique après une panne (vrai par défaut) */
  relancer?: boolean;
  /** toutes les combien de millisecondes vérifier que le service répond (15 s par défaut) */
  surveillerMs?: number;
}

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

/** Retire le jeton d'un texte (message d'erreur, sortie du service) avant de l'afficher. */
const sansJeton = (t: string, jeton: string) => (jeton ? t.split(jeton).join('[jeton]') : t);

export class Orphee {
  etat: EtatOrphee = 'arrêté';
  raison = '';
  moteurs?: Moteurs;
  port = 0;
  relances = 0;
  private jeton = '';
  private proc?: ChildProcess;
  private voulu = false;
  private minuterie?: ReturnType<typeof setTimeout>;
  private surveillance?: ReturnType<typeof setInterval>;
  private echecs = 0;
  private lancement?: Promise<boolean>;
  private journal: string[] = [];

  readonly o: OptionsOrphee;
  constructor(o: OptionsOrphee = {}) { this.o = o; }

  get pret(): boolean { return this.etat === 'prêt'; }
  /** Les dernières lignes d'erreur du service (sans le jeton). */
  dernieresLignes(): string[] { return [...this.journal]; }

  /** Lance le service (une seule fois à la fois). Rend vrai s'il est prêt. */
  demarrer(): Promise<boolean> {
    this.voulu = true;
    if (this.pret) return Promise.resolve(true);
    if (this.lancement) return this.lancement;
    this.lancement = this.lancer().finally(() => { this.lancement = undefined; });
    return this.lancement;
  }

  private async lancer(): Promise<boolean> {
    const script = this.o.script ?? SCRIPT_ORPHEE;
    if (!existsSync(script)) return this.absent(`le service n'est pas là (${script})`);
    const py = trouverPython(this.o.python);
    if (!py) return this.absent('Python 3.9 ou plus récent n\'est pas installé : Odin garde la voix habituelle (maintenir pour parler)');
    this.etat = 'démarrage'; this.raison = '';
    this.jeton = randomBytes(24).toString('hex');
    const modeles = this.o.modeles ?? join(voiceHome(this.o.home), 'orphee');
    try { mkdirSync(modeles, { recursive: true }); } catch { /* lecture seule : tant pis */ }
    const w = this.o.whisper === undefined ? localWhisper(this.o.home) : this.o.whisper ?? undefined;
    const port = this.o.port ?? (Number(process.env.ODIN_ORPHEE_PORT) || 0);
    const args = [...py.args, script, '--hote', '127.0.0.1', '--port', String(port), '--modeles', modeles, ...(w ? ['--whisper-bin', w.bin, '--whisper-modele', w.model] : [])];
    const p = spawn(py.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ORPHEE_JETON: this.jeton, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
    this.proc = p;
    p.stderr?.setEncoding('utf8');
    p.stderr?.on('data', (d: string) => { for (const l of d.split(/\r?\n/).filter(Boolean)) { this.journal.push(sansJeton(l, this.jeton).slice(0, 300)); if (this.journal.length > 40) this.journal.shift(); } });
    const pret = await new Promise<boolean>((resolve) => {
      const fin = setTimeout(() => { resolve(false); }, 20_000);
      const rl = createInterface({ input: p.stdout! });
      rl.once('line', (l) => {
        clearTimeout(fin);
        try { const j = JSON.parse(l) as { pret?: boolean; port?: number } & Moteurs; if (!j.pret || !j.port) return resolve(false); this.port = j.port; this.moteurs = { vad: j.vad, tour: j.tour, stt: j.stt, remarques: j.remarques ?? [] }; resolve(true); } catch { resolve(false); }
      });
      p.once('exit', () => { clearTimeout(fin); resolve(false); });
      p.once('error', () => { clearTimeout(fin); resolve(false); });
    });
    p.once('exit', (code) => { if (this.proc === p) this.tombe(`le service s'est arrêté (code ${code ?? '?'})`); });
    if (!pret) { try { p.kill(); } catch { /* déjà parti */ } return this.tombe(`le service n'a pas démarré${this.journal.length ? ` : ${this.journal.at(-1)}` : ''}`), false; }
    this.etat = 'prêt'; this.echecs = 0;
    this.surveiller();
    return true;
  }

  private absent(pourquoi: string): boolean { this.etat = 'absent'; this.raison = pourquoi; return false; }

  /** Le service est tombé : on le dit, puis on le relance plus tard (1 s, 2 s, 4 s… jusqu'à une minute). */
  private tombe(pourquoi: string): void {
    if (this.surveillance) { clearInterval(this.surveillance); this.surveillance = undefined; }
    this.proc = undefined;
    if (!this.voulu) { this.etat = 'arrêté'; return; }
    this.etat = 'en panne'; this.raison = pourquoi;
    if (this.o.relancer === false || this.minuterie) return;
    const attente = Math.min(60_000, 1000 * 2 ** Math.min(6, this.relances));
    this.relances++;
    this.minuterie = setTimeout(() => { this.minuterie = undefined; if (this.voulu) void this.demarrer(); }, attente);
    this.minuterie.unref?.();
  }

  private surveiller(): void {
    if (this.surveillance) clearInterval(this.surveillance);
    this.surveillance = setInterval(async () => {
      try { const r = await this.appeler('/sante', { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(String(r.status)); this.moteurs = { ...(this.moteurs ?? { remarques: [] } as unknown as Moteurs), ...(await r.json() as Moteurs) }; this.echecs = 0; }
      catch { if (++this.echecs >= 3) { const p = this.proc; this.tombe('le service ne répond plus'); try { p?.kill(); } catch { /* déjà parti */ } } }
    }, this.o.surveillerMs ?? 15_000);
    this.surveillance.unref?.();
  }

  /** Arrête le service (et ne le relance plus). */
  arreter(): void {
    this.voulu = false;
    if (this.minuterie) { clearTimeout(this.minuterie); this.minuterie = undefined; }
    if (this.surveillance) { clearInterval(this.surveillance); this.surveillance = undefined; }
    const p = this.proc; this.proc = undefined;
    try { p?.kill(); } catch { /* déjà parti */ }
    if (this.etat !== 'absent') this.etat = 'arrêté';
  }

  /** Arrêt brutal (essais : simule une panne). */
  tuer(): void { try { this.proc?.kill('SIGKILL'); } catch { /* déjà parti */ } }

  /** Appelle le service (le jeton est ajouté ici, et seulement ici). */
  async appeler(chemin: string, init: RequestInit = {}): Promise<Response> {
    if (!this.port) throw new Error('Orphée temps réel n\'est pas lancé');
    try {
      return await fetch(`http://127.0.0.1:${this.port}${chemin}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'x-orphee-jeton': this.jeton } });
    } catch (e) { throw new Error(sansJeton(`Orphée temps réel ne répond pas (${(e as Error).message})`, this.jeton)); }
  }

  /** Ce qu'on peut montrer de l'état (jamais le jeton). */
  resume(): { etat: EtatOrphee; raison: string; moteurs?: Moteurs; relances: number } {
    return { etat: this.etat, raison: this.raison, ...(this.moteurs ? { moteurs: this.moteurs } : {}), relances: this.relances };
  }
}

let instance: Orphee | undefined;
/** Le service d'Odin (un seul par processus). */
export function orphee(o?: OptionsOrphee): Orphee { if (!instance) instance = new Orphee(o); return instance; }
/** Remplace le service (essais). */
export function fixerOrphee(o: Orphee | undefined): void { instance?.arreter(); instance = o; }
