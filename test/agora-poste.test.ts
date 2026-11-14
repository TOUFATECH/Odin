// Le store d'Odin sur l'ordinateur (agora-poste, Electron), pour de vrai : un vrai Odin, le vrai store lancé sous un
// écran virtuel (xvfb), une vraie AppImage (construite ici avec mksquashfs et le « runtime » d'AppImage) installée,
// mise à jour puis désinstallée sans rien demander, et un installateur à l'empreinte fausse refusé par le store.
// Ignoré (avec la raison) hors Linux, sans xvfb, sans le store construit (cd agora-poste && npm ci && npm run build)
// ou sans les outils d'AppImage (ils arrivent avec la première construction d'agora-poste : npm run dist:linux).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { depotDe } from '../src/valhalla/agora/store.ts';

const RACINE = join(import.meta.dirname, '..'), POSTE = join(RACINE, 'agora-poste'), ELECTRON = join(POSTE, 'node_modules', 'electron', 'dist', 'electron');
const MDP = 'flamboyant-rouge-de-mamoudzou-4';
const quiManque = (): string | undefined => {
  if (process.platform !== 'linux') return 'essai Linux seulement (AppImage, xvfb)';
  if (!existsSync(join(POSTE, 'dist', 'main', 'main.js'))) return 'store pas construit (cd agora-poste && npm ci && npm run build)';
  if (!existsSync(ELECTRON)) return 'Electron absent (cd agora-poste && npm ci)';
  try { execFileSync('sh', ['-c', 'command -v xvfb-run'], { stdio: 'ignore' }); } catch { return 'xvfb-run absent'; }
  if (!outilsAppImage()) return 'outils d\'AppImage absents (cd agora-poste && npm run dist:linux une fois)';
  return undefined;
};
/** mksquashfs et le runtime d'AppImage, dans le cache d'electron-builder. */
function outilsAppImage(): { mksquashfs: string; runtime: string } | undefined {
  const c = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'electron-builder');
  for (const d of existsSync(c) ? readdirSync(c).filter((x) => x.startsWith('appimage-')) : []) for (const e of readdirSync(join(c, d))) {
    const b = join(c, d, e); if (existsSync(join(b, 'linux-x64', 'mksquashfs')) && existsSync(join(b, 'runtime-x64'))) return { mksquashfs: join(b, 'linux-x64', 'mksquashfs'), runtime: join(b, 'runtime-x64') };
  }
  return undefined;
}
/** Une vraie AppImage (type 2) : AppRun, raccourci, icône dans un squashfs, derrière le runtime d'AppImage. */
function fabriquerAppImage(dir: string, nom: string, version: string, message: string): string {
  const o = outilsAppImage()!, app = join(dir, `${nom}-${version}.AppDir`); mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'AppRun'), `#!/bin/sh\necho "${message}"\n`, { mode: 0o755 });
  writeFileSync(join(app, `${nom.toLowerCase()}.desktop`), `[Desktop Entry]\nType=Application\nName=${nom}\nExec=AppRun\nIcon=${nom.toLowerCase()}\nCategories=Utility;\n`);
  writeFileSync(join(app, `${nom.toLowerCase()}.png`), readFileSync(join(POSTE, 'build', 'icones', '64x64.png')));
  const sq = join(dir, `${nom}-${version}.sqfs`); execFileSync(o.mksquashfs, [app, sq, '-root-owned', '-noappend', '-comp', 'xz', '-quiet'], { stdio: 'ignore' });
  const f = join(dir, `${nom}-${version}.AppImage`); writeFileSync(f, Buffer.concat([readFileSync(o.runtime), readFileSync(sq)])); chmodSync(f, 0o755);
  return f;
}
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const attendre = async (f: () => unknown, ms: number) => { const fin = Date.now() + ms; for (;;) { try { const x = await f(); if (x) return x; } catch { /* pas encore */ } if (Date.now() > fin) return undefined; await new Promise((r) => setTimeout(r, 150)); } };

test('le store sur l\'ordinateur installe, met à jour et désinstalle VRAIMENT une AppImage ; empreinte fausse refusée', { timeout: 240_000, skip: quiManque() }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, logs: string[] = [];
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  let sortie = '';
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'brisingamen', 'agora', 'ullr', 'forseti'].includes(m.id)) }), va = valhallaOf()!;
    relierProprietaire(va.ctx('var'));
    assert.equal((await va.act('var', 'ajouter', { login: 'sami', nom: 'Sami', groupes: 'famille', mot_de_passe: MDP })).ok, true);
    const dir = tt.tmp('agora-poste-'), maison = join(dir, 'maison'), donnees = join(dir, 'donnees'), applis = join(maison, 'Applications'), raccourcis = join(maison, '.local', 'share', 'applications');
    mkdirSync(maison, { recursive: true });
    const v1 = fabriquerAppImage(dir, 'Bloc-notes', '1.0.0', 'Bloc-notes 1.0.0 : ok'), v2 = fabriquerAppImage(dir, 'Bloc-notes', '1.1.0', 'Bloc-notes 1.1.0 : ok');
    assert.match(execFileSync(v1, ['--appimage-extract-and-run'], { encoding: 'utf8', env: { ...process.env, TMPDIR: dir } }), /Bloc-notes 1\.0\.0 : ok/, 'une vraie AppImage, qui démarre');
    const ag = va.ctx('agora'), d = depotDe(ag.dir);
    assert.equal((await va.act('agora', 'ajouter', { nom: 'Bloc-notes', description: 'Prendre des notes', fichier: v1 })).ok, true);
    assert.equal((await va.act('agora', 'definir_mode', { element: 'bloc-notes', groupe: 'famille', mode: 'Installée d\'office' })).ok, true);

    // Le vrai store, sous un écran virtuel, dans une « maison » temporaire.
    const p = spawn('xvfb-run', ['-a', ELECTRON, '--no-sandbox', '--disable-gpu', POSTE], { detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: maison, XDG_DATA_HOME: join(maison, '.local', 'share'), XDG_CONFIG_HOME: join(maison, '.config'), AGORA_ESSAI: '1', AGORA_DOSSIER: donnees, AGORA_APPLIS: applis, AGORA_ODIN: v.url, AGORA_IDENTIFIANT: 'sami', AGORA_MOTDEPASSE: MDP, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NODE_OPTIONS: '' } });
    p.stdout.on('data', (x) => { sortie = (sortie + x).slice(-8000); }); p.stderr.on('data', (x) => { sortie = (sortie + x).slice(-8000); });
    tt.onEnd(() => { try { process.kill(-p.pid!, 'SIGTERM'); } catch { /* déjà fini */ } });
    const ap = () => d.appareils.find((a) => a.login === 'sami' && !a.retire);

    // 1. Installée d'office : le store s'inscrit, reçoit l'ordre, télécharge, vérifie l'empreinte, installe, rend compte.
    assert.ok(await attendre(() => ap()?.applis['bloc-notes']?.etat === 'installee', 90_000), `installée (sortie du store : ${sortie.slice(-1500)})`);
    const f = join(applis, 'Bloc-notes.AppImage');
    assert.ok(existsSync(f)); assert.equal(sha(f), sha(v1), 'le fichier installé est bien celui du store'); assert.ok(statSync(f).mode & 0o100, 'exécutable');
    const raccourci = readFileSync(join(raccourcis, 'agora-bloc-notes.desktop'), 'utf8'); assert.match(raccourci, /Name=Bloc-notes/); assert.ok(raccourci.includes(`Exec="${f}"`));
    assert.match(execFileSync(f, ['--appimage-extract-and-run'], { encoding: 'utf8', env: { ...process.env, TMPDIR: dir } }), /Bloc-notes 1\.0\.0 : ok/, 'l\'appli installée démarre');
    assert.equal(ap()!.plateforme, 'linux'); assert.equal(d.ordres.filter((o) => o.element === 'bloc-notes' && o.etat === 'fait').length, 1);

    // 2. Nouvelle version dans le store : mise à jour imposée.
    assert.equal((await va.act('agora', 'ajouter', { element: 'bloc-notes', fichier: v2 })).ok, true);
    assert.ok(await attendre(() => ap()?.applis['bloc-notes']?.version === '1.1.0', 60_000), `mise à jour (sortie : ${sortie.slice(-800)})`);
    assert.equal(sha(f), sha(v2)); assert.ok(await attendre(() => d.ordres.some((o) => o.action === 'mettre_a_jour' && o.etat === 'fait'), 5000), JSON.stringify(d.ordres.map((o) => [o.action, o.etat, o.version, o.erreur])));

    // 3. Empreinte fausse : le fichier rangé sur Odin est abîmé ; le store refuse d'installer et le dit à Odin.
    const v3 = fabriquerAppImage(dir, 'Calculette', '2.0.0', 'Calculette : ok');
    assert.equal((await va.act('agora', 'ajouter', { nom: 'Calculette', fichier: v3 })).ok, true);
    const pk = d.element('calculette')!.paquets[0]; writeFileSync(join(d.fichiers, pk.fichier!), Buffer.concat([readFileSync(v3), Buffer.from('octets ajoutés en route')]));
    assert.equal((await va.act('agora', 'definir_mode', { element: 'calculette', groupe: 'famille', mode: 'Installée d\'office' })).ok, true);
    assert.ok(await attendre(() => d.ordres.some((o) => o.element === 'calculette' && o.etat === 'echec'), 60_000), 'installation refusée par le store');
    assert.match(d.ordres.find((o) => o.element === 'calculette' && o.etat === 'echec')!.erreur ?? '', /Empreinte différente/);
    assert.ok(!existsSync(join(applis, 'Calculette.AppImage')), 'rien d\'installé');
    assert.ok(va.alerts({ module: 'agora' }).some((a) => /installation de Calculette échouée/.test(a.title)), 'alerte dans Forseti');

    // 4. Sami quitte la famille (dans Persona) : le store désinstalle tout seul.
    assert.equal((await va.act('var', 'modifier', { login: 'sami', groupes: 'invite' })).ok, true);
    assert.ok(await attendre(() => ap()?.applis['bloc-notes']?.etat === 'absente', 60_000), `désinstallée (sortie : ${sortie.slice(-800)})`);
    assert.ok(!existsSync(f), 'AppImage effacée'); assert.ok(!existsSync(join(raccourcis, 'agora-bloc-notes.desktop')), 'raccourci effacé');
    // Ce que l'écran du store montrait (état envoyé à l'interface).
    const e = JSON.parse(readFileSync(join(donnees, 'etat-essai.json'), 'utf8')) as { connexion: string; personne: { login: string }; historique: Array<{ texte: string; ok: boolean }> };
    assert.equal(e.connexion, 'ok'); assert.equal(e.personne.login, 'sami');
    assert.ok(e.historique.some((h) => /Bloc-notes désinstallée/.test(h.texte)) && e.historique.some((h) => !h.ok && /Empreinte différente/.test(h.texte)));
    // Aucun secret en clair dans le dossier du store.
    for (const x of readdirSync(donnees)) if (statSync(join(donnees, x)).isFile()) assert.ok(!readFileSync(join(donnees, x)).includes(Buffer.from(MDP)), `mot de passe absent de ${x}`);
  } finally { Object.assign(console, orig); await tt.end(); }
});
