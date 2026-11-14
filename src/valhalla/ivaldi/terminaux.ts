// Dédale · les terminaux qui durent (l'idée de tmux, code maison) : une session vit côté Odin (un shell dans un
// pseudo-terminal, et les dernières sorties gardées), on la quitte et on la retrouve telle quelle, même depuis le
// téléphone. Sur la machine d'Odin, ou sur un poste du coffre par SSH.
// Le pseudo-terminal : un petit relais Python (module « pty » de la bibliothèque standard), choisi parce qu'il est
// présent sur toutes les machines Linux et Mac d'Odin et n'ajoute aucune dépendance npm ; à défaut, « script ».
// Sécurité : ouvrir un terminal est une action grave (accord) réservée au propriétaire ; chaque ligne tapée est
// regardée par les règles de Heimdall (commandes destructrices refusées, commandes qui peuvent couper l'accès à
// confirmer en la tapant deux fois) et notée dans un journal, sauf ce qui est tapé après une invite de mot de passe.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hardDenied, lockoutRisk } from '../../heimdall/policy.ts';

const RELAIS = `
import os, pty, sys, select, termios, struct, fcntl, signal
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
def taille(c, r):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0)); os.kill(pid, signal.SIGWINCH)
    except Exception: pass
reste = b''
entrees = [fd, 0, 3]
while True:
    try: r, _, _ = select.select(entrees, [], [])
    except InterruptedError: continue
    if fd in r:
        try: d = os.read(fd, 65536)
        except OSError: d = b''
        if not d: break
        os.write(1, d)
    if 0 in r:
        d = os.read(0, 65536)
        if not d:
            try: os.kill(pid, signal.SIGHUP)
            except Exception: pass
            entrees.remove(0)
        else: os.write(fd, d)
    if 3 in r:
        d = os.read(3, 256)
        if not d: entrees.remove(3); continue
        reste += d
        while b'\\n' in reste:
            l, reste = reste.split(b'\\n', 1)
            try: c, rr = l.split(); taille(int(c), int(rr))
            except Exception: pass
try: _, st = os.waitpid(pid, 0); sys.exit(os.waitstatus_to_exitcode(st) if hasattr(os, 'waitstatus_to_exitcode') else 0)
except Exception: sys.exit(0)
`;

/** Ce que garde une session de ses sorties : les 512 derniers Ko (assez pour retrouver l'écran et un peu d'historique). */
const GARDE = 512 * 1024;
export interface Session {
  id: string; nom: string; poste: string; nomPoste: string; cree: number; actif: number;
  /** octets sortis depuis le début ; le tampon garde [debut, fin) */
  debut: number; fin: number; ferme?: string; code?: number | null;
  cols: number; rows: number;
}
interface Interne extends Session { proc: ChildProcess; morceaux: Buffer[]; taille: number; attente: Set<() => void>; ligne: string; sure: boolean; aConfirmer?: { ligne: string; quand: number }; dernier: string; journal: string; maintenant: () => number }
const sessions = new Map<string, Interne>();
const publique = (x: Interne): Session => ({ id: x.id, nom: x.nom, poste: x.poste, nomPoste: x.nomPoste, cree: x.cree, actif: x.actif, debut: x.debut, fin: x.fin, cols: x.cols, rows: x.rows, ...(x.ferme ? { ferme: x.ferme, code: x.code } : {}) });
export const lister = (): Session[] => [...sessions.values()].map(publique).sort((a, b) => a.cree - b.cree);
export const trouver = (id: string): Session | undefined => { const x = sessions.get(id); return x && publique(x); };

export interface Ouverture {
  nom: string; dossier?: string; maintenant: () => number; journal: string;
  /** la commande à lancer (vide : le shell de l'utilisateur) */ commande?: string[];
  env?: NodeJS.ProcessEnv; poste?: { id: string; nom: string };
  cols?: number; rows?: number; max: number;
}
/** Le programme qui fournit le pseudo-terminal : Python (pty), sinon « script ». */
function relais(cmd: string[]): [string, string[]] {
  return [process.env.ODIN_PYTHON || 'python3', ['-c', RELAIS, ...cmd]];
}

/** Ouvre une session. Lève une erreur claire si la limite est atteinte. */
export function ouvrir(o: Ouverture): Session {
  const vivantes = [...sessions.values()].filter((x) => !x.ferme);
  if (vivantes.length >= o.max) throw new Error(`déjà ${vivantes.length} terminaux ouverts (limite : ${o.max}) : ferme-en un d'abord`);
  const cmd = o.commande?.length ? o.commande : [process.env.SHELL || '/bin/bash', '-l'];
  const [prog, args] = relais(cmd);
  const proc = spawn(prog, args, { cwd: o.dossier || homedir(), env: { ...process.env, ...o.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: false });
  const t = o.maintenant();
  const x: Interne = { id: `s${randomBytes(4).toString('hex')}`, nom: o.nom.slice(0, 40) || 'terminal', poste: o.poste?.id ?? '', nomPoste: o.poste?.nom ?? 'cette machine', cree: t, actif: t, debut: 0, fin: 0, cols: o.cols ?? 100, rows: o.rows ?? 30, proc, morceaux: [], taille: 0, attente: new Set(), ligne: '', sure: true, dernier: '', journal: o.journal, maintenant: o.maintenant };
  const recu = (d: Buffer) => {
    x.morceaux.push(d); x.taille += d.length; x.fin += d.length;
    while (x.taille - (x.morceaux[0]?.length ?? 0) >= GARDE && x.morceaux.length > 1) { const p = x.morceaux.shift()!; x.taille -= p.length; x.debut += p.length; }
    x.dernier = (x.dernier + d.toString('utf8')).slice(-300);
    for (const f of x.attente) f(); x.attente.clear();
  };
  proc.stdout!.on('data', recu); proc.stderr!.on('data', recu);
  proc.on('error', (e) => { x.ferme = `le terminal n'a pas pu démarrer (${e.message}${/ENOENT/.test(e.message) ? ' : installe python3' : ''})`; for (const f of x.attente) f(); x.attente.clear(); });
  proc.on('close', (code) => { x.ferme ??= code === 0 ? 'terminé' : `terminé (code ${code})`; x.code = code; for (const f of x.attente) f(); x.attente.clear(); });
  (proc.stdio[3] as NodeJS.WritableStream | null)?.on('error', () => undefined); proc.stdin!.on('error', () => undefined);
  sessions.set(x.id, x);
  taille(x.id, x.cols, x.rows);
  noter(x, `ouvert (${x.nomPoste})`);
  return publique(x);
}

function noter(x: Interne, quoi: string): void {
  try { mkdirSync(join(x.journal, '..'), { recursive: true }); appendFileSync(x.journal, `${new Date(x.maintenant()).toISOString()}\t${x.nom}\t${x.nomPoste}\t${quoi.replace(/[\r\n\t]/g, ' ').slice(0, 2000)}\n`); } catch { /* journal pas écrit : la session continue */ }
}
/** Une invite de mot de passe à la fin de ce qui est affiché : ce qui est tapé ensuite n'est jamais noté. */
const motDePasse = (t: string) => /(pass(word|phrase)?|mot de passe|pin|secret|token|jeton)[^\n]{0,40}[:?]\s*$/i.test(t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''));
/** Masque ce qui ressemble à un secret dans une ligne de commande (mot=…, --password …, jetons). Pur. */
export function masquer(l: string): string {
  return l.replace(/((?:pass(?:word)?|pwd|token|secret|key|cle|clé|apikey|api_key)\s*[=:]\s*)\S+/gi, '$1••••').replace(/(--?(?:password|pass|token|secret|key)\s+)\S+/gi, '$1••••').replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}|xox[abp]-[A-Za-z0-9-]{10,})\b/g, '••••').replace(/(\/\/[^:/\s]+:)[^@/\s]+@/g, '$1••••@');
}

/** Ce que la personne tape. Rend un message à afficher si une ligne est refusée par Heimdall. */
export function ecrire(id: string, data: string): { ok: boolean; message?: string } {
  const x = sessions.get(id); if (!x || x.ferme) return { ok: false, message: 'Ce terminal est fermé.' };
  x.actif = x.maintenant();
  let envoi = '';
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === '\r' || c === '\n') {
      const ligne = x.ligne.trim(), cache = motDePasse(x.dernier);
      if (ligne && x.sure && !cache) {
        const non = hardDenied(ligne);
        if (non) { x.proc.stdin!.write(`${envoi}\x15`); envoi = ''; recuInterne(x, `\r\n\x1b[31m[Odin] Commande refusée par Heimdall (règle de sécurité) : elle peut détruire le système. Rien n'a été lancé.\x1b[0m\r\n`); noter(x, `REFUSÉ ${masquer(ligne)}`); x.ligne = ''; x.proc.stdin!.write('\r'); continue; }
        const risque = lockoutRisk(ligne);
        if (risque && !(x.aConfirmer && x.aConfirmer.ligne === ligne && x.maintenant() - x.aConfirmer.quand < 60_000)) {
          x.aConfirmer = { ligne, quand: x.maintenant() }; x.proc.stdin!.write(`${envoi}\x15`); envoi = '';
          recuInterne(x, `\r\n\x1b[33m[Odin] Attention : ${risque}. Pour la lancer quand même, tape-la de nouveau (dans la minute).\x1b[0m\r\n`); noter(x, `À CONFIRMER ${masquer(ligne)}`); x.ligne = ''; x.proc.stdin!.write('\r'); continue;
        }
        x.aConfirmer = undefined;
      }
      noter(x, cache ? '(saisie masquée : mot de passe)' : ligne ? `${x.sure ? '' : '(ligne retouchée) '}${masquer(ligne)}` : '(entrée)');
      x.ligne = ''; x.sure = true; envoi += c; continue;
    }
    if (c === '\x7f' || c === '\b') { x.ligne = x.ligne.slice(0, -1); envoi += c; continue; }
    if (c === '\x15' || c === '\x03') { x.ligne = ''; x.sure = true; envoi += c; continue; }
    // Flèches, historique, complétion : la ligne réelle n'est plus celle qu'on suit (on le note, sans la bloquer).
    if (c === '\x1b' || c === '\t' || c < ' ') { x.sure = false; envoi += c; continue; }
    x.ligne += c; envoi += c;
  }
  if (envoi) x.proc.stdin!.write(envoi);
  return { ok: true };
}
function recuInterne(x: Interne, t: string): void { const b = Buffer.from(t); x.morceaux.push(b); x.taille += b.length; x.fin += b.length; for (const f of x.attente) f(); x.attente.clear(); }

/** Ce qui est sorti depuis `depuis` (ou depuis le plus ancien gardé). `attendre` : jusqu'à tant de ms s'il n'y a rien. */
export async function lire(id: string, depuis: number, attendre = 0): Promise<{ debut: number; fin: number; data: Buffer; ferme?: string; reprise: boolean } | undefined> {
  const x = sessions.get(id); if (!x) return undefined;
  if (attendre > 0 && depuis >= x.fin && !x.ferme) await new Promise<void>((r) => { const f = () => { clearTimeout(t); r(); }, t = setTimeout(() => { x.attente.delete(f); r(); }, attendre); x.attente.add(f); });
  const reprise = depuis < x.debut || depuis > x.fin, de = reprise ? x.debut : depuis;
  const tout = Buffer.concat(x.morceaux), data = tout.subarray(de - x.debut);
  return { debut: de, fin: x.fin, data, ...(x.ferme ? { ferme: x.ferme } : {}), reprise };
}
export function taille(id: string, cols: number, rows: number): boolean {
  const x = sessions.get(id); if (!x || x.ferme) return false;
  x.cols = Math.max(20, Math.min(400, Math.round(cols) || 100)); x.rows = Math.max(5, Math.min(200, Math.round(rows) || 30));
  try { (x.proc.stdio[3] as NodeJS.WritableStream).write(`${x.cols} ${x.rows}\n`); } catch { /* relais parti */ }
  return true;
}
export function fermer(id: string, pourquoi = 'fermé'): boolean {
  const x = sessions.get(id); if (!x) return false;
  if (!x.ferme) { x.ferme = pourquoi; noter(x, pourquoi); try { x.proc.kill('SIGHUP'); } catch { /* déjà parti */ } setTimeout(() => { try { x.proc.kill('SIGKILL'); } catch { /* déjà parti */ } }, 2000).unref(); }
  sessions.delete(id); for (const f of x.attente) f(); return true;
}
/** Ferme les sessions inactives depuis plus de `minutes` (horloge d'Odin) et oublie celles qui sont finies depuis longtemps. */
export function menage(minutes: number, maintenant: number): string[] {
  const out: string[] = [];
  for (const x of [...sessions.values()]) {
    if (!x.ferme && maintenant - x.actif > minutes * 60_000) { fermer(x.id, `fermé après ${minutes} min sans activité`); out.push(x.nom); }
    else if (x.ferme && maintenant - x.actif > 24 * 3600_000) sessions.delete(x.id);
  }
  return out;
}
/** Pour les essais et l'arrêt d'Odin. */
export function toutFermer(): void { for (const id of [...sessions.keys()]) fermer(id, 'Odin s\'arrête'); }
