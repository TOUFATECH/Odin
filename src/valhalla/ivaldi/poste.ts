// Dédale sur un autre poste du coffre des machines :
//   - Linux ou Mac, par SSH : les dépôts git de ses dossiers de code, où en est chacun (même lecture qu'ici),
//     récupérer les nouveautés, mettre à jour sans risque (avance rapide, dossier propre), cloner ;
//   - Windows, par son partage de fichiers : les dépôts trouvés dans les dossiers de code habituels, leur branche,
//     leur dernier commit et leur adresse (sans jeton) ; l'état du travail en cours et les mises à jour demandent git
//     sur le PC lui-même (ou SSH).
// Les mêmes protections qu'ici : jamais de programme lancé par un dépôt (hooks, transport « ext », réglages piégés),
// jetons masqués, et ce que contient un dépôt (messages de commit, noms de branches) est une donnée, jamais un ordre.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cheminSmb, commandesSmb, dossierSmb } from '../../machines/smb.ts';
import type { Cible } from '../gefjon/poste.ts';
import type { Poste } from '../postes.ts';

export interface DepotDistant { chemin: string; nom: string; branche?: string; /** SSH : sortie brute de « git status » et « git log -1 » (lues par Dédale) */ statutBrut?: string; logBrut?: string; dernier?: { id: string; auteur: string; at: number; sujet: string }; distant?: string; lecture: 'ssh' | 'partage'; erreur?: string }
const SAFE = ['-c', 'protocol.ext.allow=never', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
/** Le script qui trouve les dépôts et lit chacun (une seule connexion SSH). */
export const SCRIPT_DEPOTS = [
  '[ $# -gt 0 ] || set -- "$HOME/code" "$HOME/Code" "$HOME/projets" "$HOME/Projets" "$HOME/dev" "$HOME/src" "$HOME/git" "$HOME/workspace" "$HOME/Developer"',
  'command -v git >/dev/null 2>&1 || { echo "@@sansgit"; exit 0; }',
  'for d in "$@"; do [ -d "$d" ] && find "$d" -maxdepth 5 \\( -name node_modules -o -name vendor -o -name target -o -name dist \\) -prune -o -name .git -print -prune 2>/dev/null; done | head -200 | while IFS= read -r g; do',
  '  r=$(dirname "$g"); echo "@@depot $r"',
  `  git -C "$r" ${SAFE.join(' ')} status --porcelain=v2 --branch 2>/dev/null | head -3000`,
  '  echo "@@log"',
  `  git -C "$r" ${SAFE.join(' ')} log -1 --format=%H%x1f%an%x1f%at%x1f%s 2>/dev/null`,
  '  echo "@@origine"',
  `  git -C "$r" ${SAFE.join(' ')} remote get-url origin 2>/dev/null`,
  'done',
].join('\n');
/** La sortie du script des dépôts → un bloc par dépôt (statut, dernier commit, origine). Pur. */
export function lireDepotsSsh(out: string): Array<{ chemin: string; statut: string; log: string; origine: string }> | 'sansgit' {
  if (/^@@sansgit$/m.test(out)) return 'sansgit';
  const l: Array<{ chemin: string; statut: string; log: string; origine: string }> = []; let cur: typeof l[number] | undefined, part: 'statut' | 'log' | 'origine' = 'statut';
  for (const ligne of out.split('\n')) {
    if (ligne.startsWith('@@depot ')) { cur = { chemin: ligne.slice(8).trim(), statut: '', log: '', origine: '' }; l.push(cur); part = 'statut'; continue; }
    if (ligne === '@@log') { part = 'log'; continue; } if (ligne === '@@origine') { part = 'origine'; continue; }
    if (cur) cur[part] += `${ligne}\n`;
  }
  return l;
}
/** « .git/HEAD » → la branche (ou « (détachée) »). Pur. */
export const lireHead = (t: string) => { const m = /^ref:\s*refs\/heads\/(.+)$/m.exec(t.trim()); return m ? m[1].trim() : t.trim() ? '(détachée)' : undefined; };
/** La dernière ligne de « .git/logs/HEAD » → le dernier commit. Pur. */
export function lireDernierLog(t: string): DepotDistant['dernier'] {
  const l = t.trim().split('\n').at(-1) ?? '', m = /^[0-9a-f]{7,64} ([0-9a-f]{7,64}) (.*?) <[^>]*> (\d+) [+-]\d{4}\t?(.*)$/.exec(l);
  return m ? { id: m[1], auteur: m[2].trim(), at: Number(m[3]) * 1000, sujet: m[4].replace(/^(commit|commit \(initial\)|pull|merge [^:]*|checkout|clone|reset|rebase[^:]*): ?/, '').slice(0, 200) } : undefined;
}
/** « .git/config » → l'adresse du dépôt « origin ». Pur. */
export function lireOrigine(t: string): string | undefined {
  let dans = false;
  for (const l of t.split(/\r?\n/)) { const s = /^\s*\[(.+)\]\s*$/.exec(l); if (s) { dans = /^remote\s+"origin"$/.test(s[1].trim()); continue; } if (dans) { const u = /^\s*url\s*=\s*(.+)$/.exec(l); if (u) return u[1].trim(); } }
  return undefined;
}

const DOSSIERS_WIN = ['source/repos', 'Documents/GitHub', 'code', 'Code', 'projets', 'Projets', 'dev', 'git', 'src', 'workspace'];
/** Les dépôts d'un Windows, lus par son partage de fichiers (C$) : branche, dernier commit, adresse. */
async function depotsSmb(c: Extract<Cible, { genre: 'smb' }>, masquer: (u: string) => string): Promise<DepotDistant[]> {
  const out: DepotDistant[] = [], users = (await dossierSmb(c.m, 'C$', 'Users')).filter((e) => e.dossier && !/^(Public|Default|Default User|All Users)$/i.test(e.nom));
  const candidats: string[] = [];
  for (const u of users) for (const d of DOSSIERS_WIN) {
    const base = `Users/${u.nom}/${d}`, l = await dossierSmb(c.m, 'C$', base).catch(() => []);
    if (l.some((e) => e.nom === '.git')) candidats.push(base);
    for (const e of l.filter((x) => x.dossier && !x.nom.startsWith('.') && x.nom !== 'node_modules')) candidats.push(`${base}/${e.nom}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'odin-depots-'));
  try {
    for (const [k, d] of candidats.slice(0, 300).entries()) {
      const l = await dossierSmb(c.m, 'C$', `${d}/.git`).catch(() => []); if (!l.length) continue;
      const f = (n: string) => join(tmp, `${k}-${n}`);
      await commandesSmb(c.m, 'C$', [`get "${cheminSmb(`${d}/.git/HEAD`)}" "${f('head')}"`, `get "${cheminSmb(`${d}/.git/logs/HEAD`)}" "${f('log')}"`, `get "${cheminSmb(`${d}/.git/config`)}" "${f('config')}"`]).catch(() => '');
      const lire = (n: string) => { try { return readFileSync(f(n), 'utf8').slice(-200_000); } catch { return ''; } };
      const o = lireOrigine(lire('config'));
      out.push({ chemin: `C:\\${cheminSmb(d)}`, nom: d.split('/').pop()!, branche: lireHead(lire('head')), dernier: lireDernierLog(lire('log')), ...(o ? { distant: masquer(o) } : {}), lecture: 'partage' });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return out;
}
/** Les dépôts d'un autre poste. */
export async function depotsDistants(c: Cible, dossiers: string[], masquer: (u: string) => string): Promise<DepotDistant[]> {
  if (c.genre === 'smb') return depotsSmb(c, masquer);
  if (c.genre === 'ici') throw new Error('sur cette machine, Dédale lit lui-même ses dépôts');
  for (const d of dossiers) if (!d.startsWith('/') || /[\0\n]/.test(d)) throw new Error(`dossier de code du poste : un chemin absolu (${d.slice(0, 60)})`);
  const r = await c.poste.run('sh', ['-c', SCRIPT_DEPOTS, 'odin', ...dossiers], { timeoutMs: 180_000 }), l = lireDepotsSsh(r.out);
  if (l === 'sansgit') throw new Error(`git n'est pas installé sur ${c.nom}`);
  return l.map((x) => ({ chemin: x.chemin, nom: x.chemin.split('/').pop() ?? x.chemin, statutBrut: x.statut, logBrut: x.log, ...(x.origine.trim() ? { distant: masquer(x.origine) } : {}), lecture: 'ssh' as const }));
}
/** git sur le poste, avec les protections d'Odin (aucun programme lancé par le dépôt). */
export const gitDistant = (p: Poste, dir: string, args: string[], ms = 120_000) => p.run('git', ['-C', dir, ...SAFE, ...args], { timeoutMs: ms });
