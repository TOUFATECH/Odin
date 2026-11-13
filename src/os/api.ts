// Odin OS — ce qu'Odin sert au bureau : les fichiers du bureau (/os/…), puis l'API /api/os/… (derrière la connexion).
// Le bureau est du JavaScript simple, sans dépendance : Odin l'envoie tel quel.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OdinPaths } from '../config.ts';
import { ecrireEtat, lireEtat } from './etat.ts';
import { lire, lister, operer, Refus } from './fichiers.ts';
import { paquets } from './paquets.ts';
import { cible, disquesInstallables, surOdinOS, systeme, terminalAutorise } from './systeme.ts';
import { VERSION_OS } from './version.ts';
import { admin, etatTache, lancerTache } from './taches.ts';
import { executer } from './terminal.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
const SHELL = join(ICI, 'shell'), WEB = join(ICI, '..', 'web');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
/** Le bureau ne charge que ses propres fichiers : aucun script venu d'ailleurs, aucun cadre externe. */
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
const cache = new Map<string, Buffer>();

/** Sert /os et /os/… (avant la connexion : ce ne sont que les fichiers du bureau, sans aucune donnée). */
export function osStatique(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (url.pathname !== '/os' && !url.pathname.startsWith('/os/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
  if (url.pathname === '/os') { res.writeHead(308, { location: `/os/${url.search}` }); res.end(); return true; }
  const nom = url.pathname.slice(4) || 'index.html', ext = extname(nom);
  // Avant même la création du compte, l'écran d'accueil a besoin de savoir où tourne Odin OS (PC, conteneur, téléphone…). Rien de sensible.
  if (nom === 'ici.json') { const ici = Buffer.from(JSON.stringify({ ok: true, os: VERSION_OS, cible: cible() })); res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': ici.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : ici); return true; }
  // Noms simples seulement : un fichier du bureau, ou une police (dossier fonts/).
  if (!/^(fonts\/)?[\w.-]+$/.test(nom) || nom.includes('..') || !TYPES[ext]) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('introuvable'); return true; }
  const sources = nom === 'face.js' ? [join(WEB, 'face.js')] : nom.startsWith('fonts/') ? [join(SHELL, nom), join(WEB, nom)] : [join(SHELL, nom)];
  let data = cache.get(nom);
  if (!data) { const f = sources.find((s) => existsSync(s)); if (f) { data = readFileSync(f); if (process.env.ODIN_OS_DEV !== '1') cache.set(nom, data); } }
  if (!data) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('introuvable'); return true; }
  res.writeHead(200, { 'content-type': TYPES[ext], 'content-length': data.length, 'cache-control': ext === '.woff2' ? 'max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...(ext === '.html' ? { 'content-security-policy': CSP } : {}) });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

export interface ContexteOS { paths: OdinPaths; demo?: boolean; prenom?: string }
const refus = (e: unknown) => ({ ok: false, error: e instanceof Refus ? e.message : `Erreur : ${(e as Error).message}` });

export async function osGet(o: ContexteOS, path: string, q: URLSearchParams): Promise<unknown> {
  switch (path) {
    case '/api/os/systeme': return systeme(o);
    case '/api/os/etat': return { ok: true, etat: lireEtat(o.paths) };
    case '/api/os/fichiers': try { return lister(q.get('chemin') ?? ''); } catch (e) { return refus(e); }
    case '/api/os/fichier': try { return lire(q.get('chemin') ?? ''); } catch (e) { return refus(e); }
    case '/api/os/tache': return etatTache(String(q.get('id') ?? ''));
    default: return undefined;
  }
}

const CLAVIERS = ['fr', 'us', 'be', 'ch', 'ca', 'de', 'es', 'it', 'gb', 'pt'];
export async function osPost(o: ContexteOS, path: string, b: Record<string, unknown>): Promise<unknown> {
  const s = (v: unknown) => String(v ?? '');
  switch (path) {
    case '/api/os/etat': return { ok: true, etat: ecrireEtat(o.paths, (b.patch && typeof b.patch === 'object' ? b.patch : {}) as Record<string, unknown>) };
    case '/api/os/fichiers': try { return operer(s(b.action), b); } catch (e) { return refus(e); }
    case '/api/os/terminal': {
      if (!terminalAutorise(o.paths)) return { ok: false, error: 'Les commandes système ne sont pas ouvertes ici : Odin tourne sur ta machine, pas dans une image Odin OS. Pour les ouvrir quand même : « odin os terminal on » (ligne de commande d\'Odin).' };
      return executer(s(b.commande), s(b.dossier), { confirm: b.confirm === true });
    }
    case '/api/os/paquets': return paquets(s(b.action), s(b.nom).slice(0, 1000));
    // Image PC : disposition du clavier de la session (appliquée tout de suite, gardée pour les prochains démarrages).
    case '/api/os/clavier': {
      const d = s(b.disposition); if (cible() !== 'pc' || !CLAVIERS.includes(d)) return { ok: false, error: 'Disposition inconnue, ou pas d\'écran ici.' };
      try {
        const f = join(homedir(), '.config', 'labwc', 'environment'); mkdirSync(dirname(f), { recursive: true });
        const reste = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith('XKB_DEFAULT_LAYOUT=')) : [];
        writeFileSync(f, `${[...reste, `XKB_DEFAULT_LAYOUT=${d}`].join('\n')}\n`);
        spawn(...admin('sh', ['-c', 'mkdir -p /etc/odin-os && printf "%s\\n" "$1" > /etc/odin-os/clavier; pkill -HUP -x labwc || true', 'odin-os', d]), { stdio: 'ignore' }).on('error', () => undefined);
        return { ok: true };
      } catch (e) { return refus(e); }
    }
    // Image PC, session d'essai : installer Odin OS sur un disque (tout le disque est effacé).
    case '/api/os/installer-disque': {
      const d = s(b.disque);
      if (b.confirm !== true) return { ok: false, confirm: `Effacer ${d} et y installer Odin OS ?` };
      if (!disquesInstallables().some((x) => x.nom === d)) return { ok: false, error: 'Ce disque n\'est pas proposé à l\'installation.' };
      return lancerTache(`Installation d'Odin OS sur ${d}`, ...admin('/usr/local/sbin/odin-os-installer', [d]));
    }
    case '/api/os/redemarrer': {
      if (b.confirm !== true || !surOdinOS() || cible() !== 'pc') return { ok: false, error: 'Redémarrage refusé ici.' };
      setTimeout(() => spawn(...admin('systemctl', ['reboot']), { stdio: 'ignore' }).on('error', () => undefined), 800);
      return { ok: true };
    }
    default: return undefined;
  }
}
