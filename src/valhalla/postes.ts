// « Sur quel poste ? » : une appli qui lit la machine (disques, pare-feu, journaux…) peut lire à la place un
// autre poste Linux ou Mac enregistré dans le coffre des machines. Mêmes commandes, lancées là-bas par SSH ;
// rien n'est installé sur le poste, et son mot de passe ne quitte jamais le coffre.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { findMachine, listMachines, streamOnMachine, type Machine } from '../machines/access.ts';
import type { ModCtx } from './types.ts';

type Run = ModCtx['run'];
export interface Poste {
  /** vide pour la machine d'Odin, sinon l'identifiant du poste dans le coffre */
  id: string; nom: string; local: boolean;
  run: Run; has(cmd: string): Promise<boolean>;
  /** la fin d'un fichier texte (`max` octets au plus) ; vide s'il n'existe pas ou n'est pas lisible */
  lire(fichier: string, max?: number): Promise<string>;
  /** « linux », « mac » ou « autre » (demandé une fois au poste) */
  systeme(): Promise<'linux' | 'mac' | 'autre'>;
}
const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
/** Une commande et ses arguments écrits pour le shell du poste : chaque argument entre guillemets simples, jamais interprété. Pur. */
export function ligneDeCommande(cmd: string, args: string[]): string {
  if (!/^[A-Za-z0-9_./-]+$/.test(cmd)) throw new Error('commande invalide');
  return [cmd, ...args.map(q)].join(' ');
}
/** Les mots qui désignent la machine d'Odin elle-même. Pur. */
export const estIci = (qui: unknown) => { const k = String(qui ?? '').trim().toLowerCase(); return !k || /^(ici|local|localhost|cette machine|odin|la machine d'odin|ce poste|127\.0\.0\.1)$/.test(k); };

function finLocale(f: string, max: number): string {
  let fd: number | undefined;
  try { const st = statSync(f); if (!st.isFile()) return ''; const n = Math.min(st.size, max), b = Buffer.alloc(n); fd = openSync(f, 'r'); readSync(fd, b, 0, n, st.size - n); return b.toString('utf8'); }
  catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* déjà fermé */ } }
}
/** Lance une commande sur un poste du coffre et rend sa sortie et ses erreurs séparées (comme sur la machine d'Odin). */
export async function lancerSurPoste(home: string, m: Machine, cmd: string, args: string[], o: { timeoutMs?: number; sudo?: boolean; input?: string } = {}): Promise<{ code: number; out: string; err: string }> {
  if (o.input !== undefined) throw new Error('cette action ne se fait pas encore sur un autre poste');
  const ligne = ligneDeCommande(cmd, args), x = streamOnMachine(home, m, o.sudo && m.user !== 'root' ? `sudo ${ligne}` : ligne, { timeoutMs: o.timeoutMs ?? 30_000 });
  const morceaux: Buffer[] = []; let n = 0;
  for await (const d of x.sortie as AsyncIterable<Buffer>) { if (n < 32 * 1024 * 1024) { morceaux.push(d); n += d.length; } }
  const fin = await x.fin;
  return { code: fin.code ?? 1, out: Buffer.concat(morceaux).toString('utf8'), err: fin.err };
}
/**
 * Le poste demandé : la machine d'Odin (rien ou « ici »), ou un poste du coffre des machines (par son nom, son
 * adresse ou son identifiant). Lève une erreur claire si le poste est inconnu ou n'est pas joignable par SSH.
 */
export function posteDe(ctx: ModCtx, qui: unknown): Poste {
  if (estIci(qui)) return { id: '', nom: 'cette machine', local: true, run: ctx.run, has: ctx.has, lire: async (f, max = 2_000_000) => finLocale(f, max), systeme: async () => (process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'mac' : 'autre') };
  const nom = String(qui).trim(), m = findMachine(ctx.home, nom);
  if (!m) { const l = listMachines(ctx.home); throw new Error(`poste « ${nom.slice(0, 60)} » inconnu${l.length ? ` (postes enregistrés : ${l.map((x) => x.label).join(', ')})` : ''} : ajoute-le dans Réglages → Droits et machines (adresse, compte, mot de passe)`); }
  if (m.via === 'smb') throw new Error(`${m.label} est joint par son partage de fichiers (Windows) : cette appli lit les postes Linux et Mac, par SSH. Pour un Windows : l'antivirus (Asclépios) sait l'analyser.`);
  let sys: Promise<'linux' | 'mac' | 'autre'> | undefined;
  const run: Run = (cmd, args, o) => lancerSurPoste(ctx.home, m, cmd, args, o).catch((e) => ({ code: 1, out: '', err: (e as Error).message }));
  const explique = (err: string) => (/Permission denied/i.test(err) ? `${m.label} refuse ce compte (utilisateur ou mot de passe)` : /Connection refused/i.test(err) ? `SSH est fermé sur ${m.label}` : /timed out|No route|unreachable|Could not resolve/i.test(err) ? `${m.label} ne répond pas (éteint, en veille, ou sur un autre réseau)` : /Host key verification failed|IDENTIFICATION HAS CHANGED/i.test(err) ? `l'empreinte SSH de ${m.label} a changé : vérifie que c'est bien lui` : undefined);
  const poste: Poste = {
    id: m.id, nom: m.label, local: false,
    run: async (cmd, args, o) => { const r = await run(cmd, args, o); const why = r.code === 255 ? explique(r.err) : undefined; if (why) throw new Error(why); return r; },
    has: async (cmd) => /^[A-Za-z0-9_.+-]+$/.test(cmd) && (await poste.run('sh', ['-c', `command -v ${cmd} >/dev/null 2>&1`], { timeoutMs: 15_000 })).code === 0,
    lire: async (f, max = 2_000_000) => {
      if (!f.startsWith('/') || /[\0\n\r]/.test(f)) return '';
      const n = String(Math.max(1, Math.min(8_000_000, Math.floor(max)))); let r = await poste.run('tail', ['-c', n, '--', f], { timeoutMs: 20_000 });
      // Réservé à l'administrateur (journaux de connexion…) : on recommence avec ses droits.
      if (r.code !== 0 && /denied|not permitted/i.test(r.err)) r = await poste.run('tail', ['-c', n, '--', f], { timeoutMs: 20_000, sudo: true });
      return r.code === 0 ? r.out : '';
    },
    systeme: () => (sys ??= poste.run('uname', ['-s'], { timeoutMs: 15_000 }).then((r) => (/Linux/i.test(r.out) ? 'linux' as const : /Darwin/i.test(r.out) ? 'mac' as const : 'autre' as const))),
  };
  return poste;
}
/** Les postes proposés par une appli qui lit par SSH : la machine d'Odin d'abord, puis les postes Linux et Mac du coffre. */
export function postesLisibles(ctx: ModCtx): Array<{ id: string; nom: string }> {
  return [{ id: '', nom: 'Cette machine' }, ...listMachines(ctx.home).filter((m) => m.via !== 'smb').map((m) => ({ id: m.id, nom: m.label }))];
}
/** Le réglage « Poste » à ajouter aux actions qui savent lire un autre poste. */
export const PARAM_POSTE = { key: 'poste', label: 'Poste (vide : cette machine)', kind: 'text' as const, default: '', help: 'Le nom ou l\'adresse d\'un poste Linux ou Mac enregistré dans Réglages → Droits et machines.' };
