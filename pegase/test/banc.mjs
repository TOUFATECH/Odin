// Banc d'essai de Pégase : lance le vrai Pégase (Electron) avec Playwright, dans un dossier de données temporaire,
// et un petit serveur web local pour les pages d'essai. À lancer sous un écran virtuel : xvfb-run -a node --test test/
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
export const ici = dirname(fileURLToPath(import.meta.url));
export const racine = join(ici, '..');

/** Lance Pégase ; rend l'appli Electron, la page de l'interface et de quoi tout fermer. */
export async function lancer(opts = {}) {
  const dossier = opts.dossier ?? mkdtempSync(join(process.env.PEGASE_TMP || tmpdir(), 'pegase-essai-'));
  const env = { ...process.env, PEGASE_DOSSIER: dossier, PEGASE_ESSAI: '1', ...(opts.premier ? {} : { PEGASE_PREMIER: 'non' }), ...(opts.env ?? {}) };
  delete env.NODE_OPTIONS;
  const app = await _electron.launch({ executablePath: require(join(racine, 'node_modules', 'electron')), args: ['--no-sandbox', ...(opts.args ?? []), racine], env, timeout: 60_000 });
  const ui = await interface_(app);
  await ui.waitForSelector('#haut .g', { timeout: 30_000 });
  return {
    app, ui, dossier,
    async fermer(garder = false) { await app.close().catch(() => 0); if (!garder && !opts.dossier) rmSync(dossier, { recursive: true, force: true }); },
  };
}

export async function interface_(app) {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find((w) => w.url().startsWith('pegase://app'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('interface de Pégase introuvable');
}

/** La page Playwright d'un onglet (sa vue web), trouvée par son adresse. */
export async function pageDe(app, motif, delai = 20_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    const p = app.windows().find((w) => motif.test(w.url()));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`aucune page ne correspond à ${motif}`);
}

/** Évalue dans le processus principal (l'objet Pégase est en globalThis.__pegase). */
export const principal = (app, f, arg) => app.evaluate(f, arg);

/** Un petit serveur web local : routes = { '/chemin': (req, res) => … } ou du texte HTML. */
export async function serveur(routes) {
  const vus = [];
  const s = http.createServer((req, res) => {
    vus.push({ url: req.url, hote: req.headers.host });
    const r = routes[req.url.split('?')[0]] ?? routes['*'];
    if (typeof r === 'function') return r(req, res);
    if (typeof r === 'string') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(r); }
    res.writeHead(404); res.end('introuvable');
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const port = s.address().port;
  return { port, url: `http://127.0.0.1:${port}`, vus, fermer: () => new Promise((ok) => { s.closeAllConnections?.(); s.close(ok); }) };
}

export const attendre = async (f, delai = 15_000, pas = 100) => {
  const fin = Date.now() + delai; let d;
  while (Date.now() < fin) { try { d = await f(); if (d) return d; } catch { /* encore */ } await new Promise((r) => setTimeout(r, pas)); }
  throw new Error(`attente trop longue (${f.toString().slice(0, 120)})`);
};

/** Un VRAI Odin dans un processus à part (pegase/test/outils/odin-reel.ts) ; `cmd('accord 123456 oui')`. */
export async function odinReel() {
  const { spawn } = await import('node:child_process');
  const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ici, 'outils', 'odin-reel.ts')], { cwd: join(racine, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
  let tampon = ''; const attentes = []; let journal = '';
  p.stderr.on('data', (d) => { journal = (journal + d).slice(-20000); });
  p.stdout.on('data', (d) => { tampon += d; let k; while ((k = tampon.indexOf('\n')) >= 0) { const l = tampon.slice(0, k); tampon = tampon.slice(k + 1); if (l.startsWith('{')) attentes.shift()?.(JSON.parse(l)); else journal += l + '\n'; } });
  const lire = () => new Promise((ok) => attentes.push(ok));
  const premier = await Promise.race([lire(), new Promise((_, ko) => setTimeout(() => ko(new Error(`Odin n'a pas démarré : ${journal}`)), 60_000))]);
  return {
    url: premier.url, port: premier.port, journal: () => journal,
    cmd: (c) => { const r = lire(); p.stdin.write(`${c}\n`); return r; },
    async fermer() { p.stdin.write('fin\n'); await new Promise((ok) => { p.once('exit', ok); setTimeout(() => { p.kill('SIGKILL'); ok(); }, 5000); }); },
  };
}

/** Un relais TCP entre Pégase et Odin, qu'on peut couper (« hors ligne ») et rebrancher. */
export async function relais(portCible) {
  const net = await import('node:net');
  const sockets = new Set(); let coupe = false;
  const s = net.createServer((c) => {
    if (coupe) { c.destroy(); return; }
    const d = net.connect(portCible, '127.0.0.1'); sockets.add(c); sockets.add(d);
    c.pipe(d); d.pipe(c);
    const fin = () => { c.destroy(); d.destroy(); sockets.delete(c); sockets.delete(d); };
    c.on('error', fin); d.on('error', fin); c.on('close', fin); d.on('close', fin);
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return {
    port: s.address().port,
    couper() { coupe = true; for (const x of sockets) x.destroy(); sockets.clear(); },
    rebrancher() { coupe = false; },
    fermer: () => new Promise((ok) => { for (const x of sockets) x.destroy(); s.close(ok); }),
  };
}
