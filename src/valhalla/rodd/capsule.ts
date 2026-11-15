// Écho · la capsule de dictée sur les PC du parc. Satellites (l'agent du parc) l'installe par SSH dans
// ~/.odin-capsule/ du poste, la règle, la vérifie et la retire ; Écho reçoit ses dictées (POST /api/rodd/capsule).
//
// Chaque capsule a son jeton à elle, tiré au hasard à l'installation. Odin n'en garde que l'empreinte (SHA-256) :
// le jeton lui-même n'existe que sur le poste, dans un fichier lisible par son seul propriétaire (600). Retirer la
// capsule (ou la réinstaller) rend l'ancien jeton inutilisable. La capsule vérifie l'empreinte du certificat d'Odin :
// elle ne parle à aucun autre serveur.

import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VERSION_CAPSULE = '1.0.0';
export interface Inscrite { poste: string; empreinte: string; at: string; mode: string; version: string }

export const fichierCapsules = (home: string) => join(home, 'valhalla', 'rodd', 'capsules.json');
const hacher = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');
const propre = (poste: string) => poste.trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);

/** Les postes qui ont une capsule (sans aucun jeton). */
export function capsules(home: string): Inscrite[] {
  try { return (JSON.parse(readFileSync(fichierCapsules(home), 'utf8')) as Inscrite[]).filter((x) => x && typeof x.poste === 'string' && /^[a-f0-9]{64}$/.test(x.empreinte)); } catch { return []; }
}
function ecrire(home: string, l: Inscrite[]): void {
  const f = fichierCapsules(home); mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1), { mode: 0o600 }); renameSync(`${f}.tmp`, f);
}

/** Inscrit (ou réinscrit) la capsule d'un poste : rend son nouveau jeton, à remettre au poste seulement. */
export function inscrire(home: string, poste: string, mode = 'corrigé', now = new Date()): string {
  const p = propre(poste); if (!p) throw new Error('nom de poste invalide');
  const jeton = randomBytes(32).toString('hex');
  ecrire(home, [...capsules(home).filter((x) => x.poste !== p), { poste: p, empreinte: hacher(jeton), at: now.toISOString(), mode, version: VERSION_CAPSULE }]);
  return jeton;
}
/** Retire la capsule d'un poste (son jeton ne vaut plus rien). */
export function desinscrire(home: string, poste: string): boolean {
  const l = capsules(home), n = l.filter((x) => x.poste !== propre(poste));
  if (n.length === l.length) return false;
  ecrire(home, n); return true;
}
/** Le poste à qui appartient ce jeton (comparaison à temps constant), ou rien. */
export function posteDuJeton(home: string, jeton: string): Inscrite | undefined {
  if (!/^[a-f0-9]{64}$/.test(jeton)) return undefined;
  const h = Buffer.from(hacher(jeton), 'hex');
  let trouve: Inscrite | undefined;
  for (const x of capsules(home)) if (timingSafeEqual(Buffer.from(x.empreinte, 'hex'), h)) trouve = x;
  return trouve;
}

/** L'empreinte SHA-256 du certificat d'Odin (celle que la capsule vérifie), s'il en a un. */
export function empreinteOdin(home: string): string {
  const f = join(home, 'tls', 'cert.pem'); if (!existsSync(f)) return '';
  try { return createHash('sha256').update(new X509Certificate(readFileSync(f)).raw).digest('hex'); } catch { return ''; }
}

/** Le programme de la capsule (Python 3, bibliothèque standard seulement). */
export const programmeCapsule = (): string => readFileSync(new URL('./capsule.py', import.meta.url), 'utf8');

const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
/**
 * Le script (sh, Linux et macOS) que Satellites lance sur le poste : vérifie Python 3, écrit la capsule et sa
 * configuration (droits 700 / 600, le jeton n'est jamais affiché), puis rend l'état de la capsule en JSON.
 */
export function scriptInstallation(c: { odin: string; jeton: string; poste: string; mode: string; empreinte: string }): string {
  if (!/^https?:\/\/[^\s'"]+$/.test(c.odin)) throw new Error('adresse d\'Odin invalide (https://adresse:port)');
  const conf = JSON.stringify({ odin: c.odin.replace(/\/$/, ''), jeton: c.jeton, poste: propre(c.poste), mode: c.mode, empreinte: c.empreinte, version: VERSION_CAPSULE });
  return [
    'command -v python3 >/dev/null 2>&1 || { echo \'{"ok":false,"erreur":"python3 absent sur ce poste"}\'; exit 3; }',
    'umask 077',
    'python3 - <<\'ECHO_CAPSULE\'',
    'import base64, os',
    'd = os.path.join(os.environ.get("HOME") or os.path.expanduser("~"), ".odin-capsule")',
    'os.makedirs(d, mode=0o700, exist_ok=True)',
    'os.chmod(d, 0o700)',
    `for nom, contenu, droits in (("capsule.py", "${b64(programmeCapsule())}", 0o700), ("capsule.json", "${b64(conf)}", 0o600)):`,
    '    f = os.path.join(d, nom)',
    '    with open(f + ".tmp", "wb") as h:',
    '        h.write(base64.b64decode(contenu))',
    '    os.chmod(f + ".tmp", droits)',
    '    os.replace(f + ".tmp", f)',
    'ECHO_CAPSULE',
    'python3 "$HOME/.odin-capsule/capsule.py" etat',
  ].join('\n');
}
/** Retire la capsule du poste (dossier entier). */
export const scriptRetrait = () => 'rm -rf "$HOME/.odin-capsule" && echo \'{"ok":true}\'';
/** Demande son état à la capsule. */
export const scriptEtat = () => 'if [ -f "$HOME/.odin-capsule/capsule.py" ]; then python3 "$HOME/.odin-capsule/capsule.py" etat; else echo \'{"ok":false,"erreur":"pas de capsule sur ce poste"}\'; fi';
/** Change la mise en forme par défaut de la capsule. */
export function scriptReglage(mode: string): string {
  if (!/^[\p{L} ]{2,20}$/u.test(mode)) throw new Error('mise en forme invalide');
  return `python3 "$HOME/.odin-capsule/capsule.py" regler --mode '${mode}'`;
}
/** La dernière ligne JSON d'une sortie (l'état rendu par la capsule). */
export function lireEtat(out: string): Record<string, unknown> | undefined {
  for (const l of out.trim().split(/\r?\n/).reverse()) { try { const j = JSON.parse(l) as Record<string, unknown>; if (j && typeof j === 'object') return j; } catch { /* ligne suivante */ } }
  return undefined;
}
