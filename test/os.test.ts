// Odin OS : le bureau servi par Odin (fichiers, API, garde-fous), l'appli Valaskjálf et les scripts de construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { DEFAULT_CONFIG, type OdinPaths } from '../src/config.ts';
import { osGet, osPost, osStatique } from '../src/os/api.ts';
import { FICHIER_CATALOGUE, modulesPourCatalogue, texteCatalogue } from '../src/os/catalogue.ts';
import { ecrireEtat, filtrer, lireEtat } from '../src/os/etat.ts';
import { lire, lister, operer, Refus, resoudre } from '../src/os/fichiers.ts';
import { adresseEssai, imagesConstruites, installerDocker, installerLxc, trouverImage } from '../src/os/installer.ts';
import { applisLinux, decouperExec, paquets } from '../src/os/paquets.ts';
import { cible, ponts, surOdinOS, systeme, terminalAutorise, fichierTerminal } from '../src/os/systeme.ts';
import { attendreTache, etatTache, lancerTache } from '../src/os/taches.ts';
import { executer, sensible } from '../src/os/terminal.ts';
import { VERSION_OS } from '../src/os/version.ts';
import { allModules } from '../src/valhalla/odin.ts';

const temp = (nom: string) => mkdtempSync(join(tmpdir(), `odin-os-${nom}-`));
const chemins = (home: string) => ({ home, workspace: join(home, 'ws') }) as OdinPaths;
const SHELL = join(import.meta.dirname, '..', 'src', 'os', 'shell');
const HORS = { ODIN_OS: '0' } as NodeJS.ProcessEnv, DANS = { ODIN_OS: '1', ODIN_OS_CIBLE: 'docker' } as NodeJS.ProcessEnv;

test('bureau : tous les fichiers appelés par index.html existent et se lisent', () => {
  const html = readFileSync(join(SHELL, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="\.\/([\w.-]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 9);
  for (const s of scripts) {
    const f = s === 'face.js' ? join(SHELL, '..', '..', 'web', 'face.js') : join(SHELL, s);
    assert.ok(existsSync(f), `${s} manque`);
    assert.doesNotThrow(() => new Script(readFileSync(f, 'utf8'), { filename: s }), `${s} : erreur de syntaxe`);
  }
  for (const css of [...html.matchAll(/href="\.\/([\w.-]+\.css)"/g)].map((m) => m[1])) assert.ok(existsSync(join(SHELL, css)), `${css} manque`);
});

test('bureau : aucune ressource externe (pas de CDN, pas de police ou script venu d\'ailleurs)', () => {
  for (const f of readdirSync(SHELL).filter((x) => /\.(js|css|html)$/.test(x))) {
    const t = readFileSync(join(SHELL, f), 'utf8').replace(/http:\/\/www\.w3\.org\/\S+/g, '');
    const externes = [...t.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+|url\(\s*["']?https?:|@import\s+["']https?:/g)].map((m) => m[0]);
    assert.deepEqual(externes, [], `${f} charge une ressource externe`);
  }
});

test('bureau : le catalogue du mode essai est celui du registre des applis', () => {
  assert.equal(readFileSync(FICHIER_CATALOGUE, 'utf8'), texteCatalogue(modulesPourCatalogue()), 'relance « npm run os:catalogue »');
});

test('Valaskjálf : l\'appli Odin OS est dans le registre, avec ses actions', () => {
  const m = allModules({ paths: chemins(temp('reg')), cfg: DEFAULT_CONFIG } as never).find((x) => x.id === 'valaskjalf');
  assert.ok(m); assert.equal(m.family, 'Machines');
  for (const a of ['etat', 'essayer', 'docker', 'lxc', 'images', 'terminal']) assert.ok(m.actions.some((x) => x.id === a), `action ${a}`);
  // Installer dans Docker ou LXC, ouvrir le terminal : toujours avec accord.
  for (const a of ['docker', 'lxc', 'retirer_docker']) assert.ok(m.actions.find((x) => x.id === a)!.grave!({ nom: 'odin-os' }), `${a} demande un accord`);
  assert.ok(m.actions.find((x) => x.id === 'terminal')!.grave!({ etat: 'ouvert' }));
  assert.equal(m.actions.find((x) => x.id === 'terminal')!.grave!({ etat: 'fermé' }), undefined);
});

test('état du bureau : seules les clés connues et valides sont gardées', () => {
  const p = chemins(temp('etat'));
  assert.deepEqual(lireEtat(p), {});
  ecrireEtat(p, { theme: 'verre', applis: ['ullr', 'saga'], accent: '#2563EB', pirate: 'x', apparence: 'rose', accueilFait: 'oui' });
  assert.deepEqual(lireEtat(p), { theme: 'verre', applis: ['ullr', 'saga'], accent: '#2563EB' });
  ecrireEtat(p, { accueilFait: true, accent: '' });
  assert.deepEqual(lireEtat(p), { theme: 'verre', applis: ['ullr', 'saga'], accent: '', accueilFait: true });
  assert.deepEqual(filtrer({ applis: ['a'.repeat(200)], theme: '<script>' }), {});
});

test('Fichiers : on ne sort pas du dossier personnel, les dossiers cachés sont hors d\'atteinte', () => {
  const m = temp('maison'), dehors = temp('dehors');
  writeFileSync(join(dehors, 'secret.txt'), 'secret'); mkdirSync(join(m, '.ssh')); writeFileSync(join(m, '.ssh', 'id'), 'clé');
  for (const c of ['../..', '/etc/passwd', '.ssh/id', '.odin/config.json', 'Documents/../../x']) assert.throws(() => resoudre(c, m), Refus, c);
  // Un lien qui mène hors du dossier personnel (quand le système permet d'en créer un ici).
  let lien = true; try { symlinkSync(dehors, join(m, 'lien')); } catch { lien = false; }
  if (lien) assert.throws(() => resoudre('lien/secret.txt', m), Refus);
  // Sous Windows et macOS, le dossier où le système cache réglages et données d'applis est protégé de la même façon.
  if (process.platform === 'win32') assert.throws(() => resoudre('AppData/Roaming', m), Refus);
  if (process.platform === 'darwin') assert.throws(() => resoudre('Library/Keychains', m), Refus);
  assert.equal(resoudre('', m), resoudre('~', m));
  assert.ok(resoudre('Documents/note.txt', m).endsWith(join('Documents', 'note.txt')));
  assert.ok(resoudre('.local/share/Trash/files', m).endsWith(join('Trash', 'files')));
});

test('Fichiers : lister, créer, écrire, lire, renommer, corbeille (réversible), vider (avec confirmation)', () => {
  const m = temp('fichiers');
  const racine = lister('', m);
  assert.equal(racine.parent, null);
  assert.deepEqual(racine.entrees.map((e) => e.nom).sort(), ['Bureau', 'Documents', 'Images', 'Musique', 'Téléchargements', 'Vidéos']);
  const f = operer('nouveau', { chemin: 'Documents', nom: 'note.txt' }, m).chemin!;
  assert.throws(() => operer('nouveau', { chemin: 'Documents', nom: 'note.txt' }, m), Refus);
  assert.throws(() => operer('nouveau', { chemin: 'Documents', nom: '../x' }, m), Refus);
  assert.throws(() => operer('dossier', { chemin: 'Documents', nom: '.cache' }, m), Refus);
  operer('ecrire', { chemin: f, texte: 'Bonjour' }, m);
  assert.deepEqual({ genre: lire(f, m).genre, texte: lire(f, m).texte }, { genre: 'texte', texte: 'Bonjour' });
  const g = operer('renommer', { chemin: f, nom: 'liste.txt' }, m).chemin!;
  assert.ok(g.endsWith(join('Documents', 'liste.txt')) && !existsSync(f));
  assert.throws(() => operer('corbeille', { chemin: 'Documents' }, m), Refus);
  operer('corbeille', { chemin: g }, m);
  assert.ok(!existsSync(g));
  assert.deepEqual(lister('.local/share/Trash/files', m).entrees.map((e) => e.nom), ['liste.txt']);
  assert.match(readFileSync(join(m, '.local/share/Trash/info/liste.txt.trashinfo'), 'utf8'), /^\[Trash Info\]\nPath=.*liste\.txt\nDeletionDate=/);
  assert.throws(() => operer('vider', { chemin: '' }, m), Refus);
  operer('vider', { chemin: '', confirm: true }, m);
  assert.deepEqual(lister('.local/share/Trash/files', m).entrees, []);
  // Une image devient une adresse « data: », un binaire n'est pas ouvert.
  writeFileSync(join(m, 'Images', 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); writeFileSync(join(m, 'Documents', 'b.bin'), Buffer.from([1, 0, 2, 0]));
  assert.match(lire('Images/p.png', m).image!, /^data:image\/png;base64,/);
  assert.equal(lire('Documents/b.bin', m).genre, 'autre');
});

test('Terminal : commandes sensibles repérées, « cd » suivi, sortie rendue', { skip: process.platform === 'win32' && 'le Terminal du bureau lance bash : test joué sous Linux et macOS' }, async () => {
  for (const c of ['rm -rf /tmp/x', 'sudo rm -fr ~', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'sudo reboot', 'apt-get remove -y nodejs', 'chmod -R 777 /']) assert.ok(sensible(c), c);
  for (const c of ['ls -la', 'cat notes.txt', 'apt list --installed', 'echo rm', 'df -h']) assert.equal(sensible(c), undefined, c);
  const d = realpathSync(temp('term')); mkdirSync(join(d, 'sous'));
  assert.deepEqual(await executer('rm -rf /tmp/nimporte', d), { ok: false, confirm: 'Cette commande peut effacer des fichiers sans passer par la corbeille. La lancer ?' });
  assert.equal((await executer('cd sous', d)).dossier, join(d, 'sous'));
  assert.equal((await executer('cd nulle-part', d)).code, 1);
  const r = await executer('echo bonjour && pwd', d);
  assert.deepEqual({ ok: r.ok, code: r.code, sortie: r.sortie }, { ok: true, code: 0, sortie: `bonjour\n${d}\n` });
  assert.equal((await executer('exit 3', d)).code, 3);
  assert.match((await executer('sleep 5', d, { delai: 150 })).sortie!, /commande arrêtée/);
});

test('système : cible, image Odin OS ou non, terminal ouvert seulement où il faut', () => {
  assert.equal(surOdinOS(DANS), true); assert.equal(surOdinOS(HORS), false);
  assert.equal(cible(DANS), 'docker'); assert.equal(cible({ ODIN_OS: '1', ODIN_OS_CIBLE: 'inconnue' }), 'hote');
  assert.equal(cible({ ODIN_OS: '0', ODIN_OS_CIBLE: 'pc' }), 'hote', 'une cible d\'image n\'a de sens que dans une image');
  const p = chemins(temp('sys'));
  assert.equal(terminalAutorise(p, HORS), false); assert.equal(terminalAutorise(p, DANS), true);
  mkdirSync(join(p.home, 'os'), { recursive: true }); writeFileSync(fichierTerminal(p), 'ouvert');
  assert.equal(terminalAutorise(p, HORS), true);
  // Hors d'une image : aucun pont installable (Odin ne touche pas aux paquets de la machine).
  for (const x of Object.values(ponts(HORS))) { assert.equal(x.possible, false); assert.ok(x.pourquoi); }
  assert.equal(ponts(DANS).android.possible, false, 'Waydroid : image PC seulement');
  const s = systeme({ paths: chemins(temp('sys2')), prenom: 'Djin' }, HORS);
  assert.equal(s.os.version, VERSION_OS); assert.equal(s.cible, 'hote'); assert.equal(s.capacites.apt, false); assert.equal(s.capacites.terminal, false);
  assert.ok(s.machine.memoire.total > 0 && s.machine.coeurs > 0); assert.deepEqual(s.compte, { prenom: 'Djin' });
});

test('applis Linux : lecture des fichiers .desktop, ligne Exec découpée sans interpréteur', async () => {
  const d = temp('desktop');
  writeFileSync(join(d, 'calc.desktop'), '[Desktop Entry]\nType=Application\nName=Calculator\nName[fr]=Calculatrice\nComment=Faire des calculs\nExec=/usr/bin/calc --mode "a b" %U\nIcon=calc\n\n[Desktop Action x]\nExec=rm -rf /\n');
  writeFileSync(join(d, 'cache.desktop'), '[Desktop Entry]\nType=Application\nName=Caché\nExec=x\nNoDisplay=true\n');
  writeFileSync(join(d, 'console.desktop'), '[Desktop Entry]\nType=Application\nName=Console\nExec=top\nTerminal=true\n');
  assert.deepEqual(applisLinux([d]), [{ id: 'calc', nom: 'Calculatrice', resume: 'Faire des calculs', exec: '/usr/bin/calc --mode "a b" %U' }]);
  assert.deepEqual(decouperExec('/usr/bin/calc --mode "a b" %U --fichier=%f'), ['/usr/bin/calc', '--mode', 'a b', '--fichier=']);
  assert.deepEqual(decouperExec('env A=1 app; rm -rf /'), ['env', 'A=1', 'app;', 'rm', '-rf', '/'], 'pas d\'interpréteur : « ; » reste un simple mot');
  if (!surOdinOS()) { const r = await paquets('installer', 'htop'); assert.equal(r.ok, false); assert.match(String(r.error), /image Odin OS/); assert.deepEqual(await paquets('applis', ''), { ok: true, applis: [] }); }
});

test('tâches : journal, fin, une seule installation à la fois', async () => {
  const a = lancerTache('essai', process.execPath, ['-e', 'console.log("[1/2] un"); setTimeout(() => console.log("[2/2] deux"), 300)']);
  assert.ok(a.ok && a.tache);
  const b = lancerTache('autre', process.execPath, ['-e', '']);
  assert.equal(b.ok, false, 'une tâche exclusive est déjà en cours');
  const fin = await attendreTache((a as { tache: string }).tache);
  assert.equal(fin?.etat, 'fini'); assert.match(fin!.journal, /\[1\/2\] un\n\[2\/2\] deux/);
  const c = lancerTache('échec', process.execPath, ['-e', 'process.exit(4)']);
  assert.equal((await attendreTache((c as { tache: string }).tache))?.code, 4);
  assert.equal(etatTache('inconnue').ok, false);
});

/** Fausse réponse HTTP, pour tester ce qu'Odin sert sans ouvrir de port. */
function reponse() { const r = { code: 0, entetes: {} as Record<string, unknown>, corps: Buffer.alloc(0), writeHead(c: number, h?: Record<string, unknown>) { r.code = c; r.entetes = h ?? {}; return r; }, end(d?: Buffer | string) { if (d) r.corps = Buffer.from(d); } }; return r; }
const servir = (chemin: string, method = 'GET') => { const r = reponse(); const pris = osStatique({ method } as IncomingMessage, r as unknown as ServerResponse, new URL(`http://x${chemin}`)); return { pris, ...r }; };

test('serveur : /os/ sert le bureau (politique de sécurité stricte), et rien d\'autre', () => {
  assert.equal(servir('/api/os/systeme').pris, false); assert.equal(servir('/').pris, false);
  assert.equal(servir('/os').code, 308);
  const page = servir('/os/');
  assert.equal(page.code, 200); assert.match(String(page.entetes['content-type']), /text\/html/); assert.match(page.corps.toString(), /<title>Odin OS<\/title>/);
  const csp = String(page.entetes['content-security-policy']);
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'(;|$)/); assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  assert.equal(servir('/os/noyau.js').code, 200); assert.equal(servir('/os/face.js').code, 200);
  assert.equal(servir('/os/fonts/ibm-plex-sans-latin-400-normal.woff2').entetes['content-type'], 'font/woff2');
  assert.equal(servir('/os/fonts/bricolage-grotesque-latin-800-normal.woff2').code, 200);
  // Un chemin qui tente de sortir du dossier du bureau : refusé (404), ou déjà ramené hors de /os/ par l'adresse elle-même.
  for (const c of ['/os/../package.json', '/os/..%2f..%2fpackage.json', '/os/fonts/../../config.ts', '/os/secret.env', '/os/inconnu.js', '/os/sous/dossier.js']) { const r = servir(c); assert.ok(!r.pris || r.code === 404, c); assert.equal(r.corps.includes('"version"'), false, c); }
  assert.equal(servir('/os/', 'POST').code, 405);
  // Avant la création du compte, l'accueil sait seulement où tourne Odin OS : la version et la cible, rien d'autre.
  const ici = servir('/os/ici.json'); assert.equal(ici.code, 200);
  assert.deepEqual(Object.keys(JSON.parse(ici.corps.toString())).sort(), ['cible', 'ok', 'os']);
});

test('API : état, fichiers et machine répondent ; terminal et paquets fermés hors d\'une image', async () => {
  const o = { paths: chemins(temp('api')), prenom: 'Djin' };
  assert.equal(((await osGet(o, '/api/os/systeme', new URLSearchParams())) as { ok: boolean }).ok, true);
  assert.deepEqual(await osPost(o, '/api/os/etat', { patch: { theme: 'neon', autre: 1 } }), { ok: true, etat: { theme: 'neon' } });
  assert.deepEqual(await osGet(o, '/api/os/etat', new URLSearchParams()), { ok: true, etat: { theme: 'neon' } });
  assert.deepEqual(await osGet(o, '/api/os/fichiers', new URLSearchParams({ chemin: '/etc' })), { ok: false, error: 'Ce dossier est hors de ton espace personnel.' });
  assert.equal(await osGet(o, '/api/os/inconnu', new URLSearchParams()), undefined);
  assert.equal(await osPost(o, '/api/os/inconnu', {}), undefined);
  if (!surOdinOS()) {
    const t = await osPost(o, '/api/os/terminal', { commande: 'id' }) as { ok: boolean; error: string };
    assert.equal(t.ok, false); assert.match(t.error, /odin os terminal on/);
    assert.equal((await osPost(o, '/api/os/paquets', { action: 'installer', nom: 'htop' }) as { ok: boolean }).ok, false);
    assert.equal((await osPost(o, '/api/os/redemarrer', { confirm: true }) as { ok: boolean }).ok, false);
    assert.equal((await osPost(o, '/api/os/installer-disque', { disque: '/dev/sda', confirm: true }) as { ok: boolean }).ok, false);
  }
});

test('images : tailles et empreintes relues depuis SHA256SUMS, adresse d\'essai', () => {
  const d = temp('images'); writeFileSync(join(d, 'odin-os-0.1.0-amd64.iso'), 'iso');
  writeFileSync(join(d, 'SHA256SUMS'), `${'a'.repeat(64)}  odin-os-0.1.0-amd64.iso\n${'b'.repeat(64)}  absente.img\n`);
  assert.deepEqual(imagesConstruites(d), [{ fichier: 'odin-os-0.1.0-amd64.iso', taille: 3, sha256: 'a'.repeat(64) }]);
  assert.deepEqual(imagesConstruites(join(d, 'nulle-part')), []);
  assert.equal(adresseEssai({ web: { port: 7777, tls: { enabled: false } } }), 'http://localhost:7777/os/');
  assert.equal(adresseEssai({ web: { port: 7777, publicUrl: 'https://odin.exemple.fr/' } }), 'https://odin.exemple.fr/os/');
  // L'image choisie est celle de l'architecture de la machine ; le fichier de réglages LXC n'est pas pris pour le modèle.
  for (const f of ['odin-os-0.1.0-amd64-lxc.tar.xz', 'odin-os-0.1.0-amd64-lxc-meta.tar.xz', 'odin-os-0.1.0-arm64-lxc.tar.xz']) writeFileSync(join(d, f), 'x');
  assert.equal(trouverImage('-lxc.tar.xz', d, 'amd64'), join(d, 'odin-os-0.1.0-amd64-lxc.tar.xz'));
  assert.equal(trouverImage('-lxc.tar.xz', d, 'arm64'), join(d, 'odin-os-0.1.0-arm64-lxc.tar.xz'));
  assert.equal(trouverImage('-docker.tar.gz', d, 'amd64'), undefined);
});

test('installation : Docker ouvert au réseau passe en HTTPS, LXC classique reçoit le modèle et ses réglages', async () => {
  const lances: string[][] = [];
  const outils = (presents: string[]) => ({ has: async (c: string) => presents.includes(c), run: async (cmd: string, args: string[]) => { lances.push([cmd, ...args]); return { code: cmd === 'docker' && args[0] === 'ps' ? 0 : 0, out: '', err: '' }; } });
  const r = await installerDocker(outils(['docker']), { nom: 'essai', port: 7790, lan: true });
  const run = lances.find((l) => l[0] === 'docker' && l[1] === 'run')!;
  assert.equal(r.ok, true); assert.ok(run.includes('ODIN_OS_HTTPS=1')); assert.ok(run.includes('7790:7777')); assert.match(r.text, /https:\/\//);
  lances.length = 0;
  const local = await installerDocker(outils(['docker']), { nom: 'essai', port: 7790 });
  const run2 = lances.find((l) => l[0] === 'docker' && l[1] === 'run')!;
  assert.equal(run2.includes('ODIN_OS_HTTPS=1'), false); assert.ok(run2.includes('127.0.0.1:7790:7777')); assert.match(local.text, /http:\/\/localhost:7790/);
  assert.equal((await installerDocker(outils([]), {})).ok, false);
  assert.equal((await installerDocker(outils(['docker']), { nom: 'Nom Invalide' })).ok, false);
  assert.equal((await installerLxc(outils(['lxc-create']), { nom: '../x' })).ok, false);
});

test('construction : les scripts des images et des systèmes sont du shell valide', { skip: process.platform !== 'linux' && 'les images se construisent sous Linux' }, () => {
  const racine = join(import.meta.dirname, '..', 'os');
  const scripts = [...readdirSync(join(racine, 'build')).map((f) => join(racine, 'build', f)), join(racine, 'rootfs/commun/usr/local/bin/odin-os-demarrer'), join(racine, 'rootfs/commun/usr/local/lib/odin-os/pont'), join(racine, 'rootfs/ecran/usr/local/bin/odin-os-session'), join(racine, 'rootfs/pc/usr/local/sbin/odin-os-installer'), join(racine, 'mobile/odin-os-termux.sh')];
  assert.ok(scripts.length >= 12);
  for (const s of scripts) { const r = spawnSync('bash', ['-n', s]); if (r.error) return; assert.equal(r.status, 0, `${s} : ${r.stderr}`); }
  // Les empreintes de Node.js sont épinglées : un téléchargement modifié est refusé.
  assert.match(readFileSync(join(racine, 'build', 'commun.sh'), 'utf8'), /NODE_SHA256_x64="[0-9a-f]{64}"[\s\S]*NODE_SHA256_arm64="[0-9a-f]{64}"/);
});
