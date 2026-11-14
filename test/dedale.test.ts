// Dédale (ivaldi) : terminaux qui durent (vrai shell dans un vrai pseudo-terminal, vrai serveur SSH d'essai),
// éditeur de projet et lancement d'un vrai petit projet Node et d'une page web, avec l'aperçu à travers Odin.
// Sur un VRAI Odin (interface web démarrée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { saveMachine } from '../src/machines/access.ts';
import { masquer } from '../src/valhalla/ivaldi/terminaux.ts';

type R = { ok?: boolean; text?: string; confirm?: string; data?: Record<string, unknown> };
const acte = async (v: VraiOdin, action: string, input: Record<string, unknown> = {}, confirm = false) => (await v.json('/api/valhalla/act', { module: 'ivaldi', action, input, ...(confirm ? { confirm: true } : {}) })).body as R;
const a = (c: string) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const libre = () => new Promise<number>((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
const ouvert = (port: number) => new Promise<boolean>((r) => { const c = connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });

/** Un client de terminal comme la page : écrire, lire ce qui sort (en attendant), jusqu'à voir un texte. */
function client(v: VraiOdin, id: string) {
  let depuis = 0, tout = '';
  const H = { cookie: v.session, 'content-type': 'application/json', 'x-odin': '1' };
  return {
    get texte() { return tout; },
    ecrire: async (data: string) => (await fetch(`${v.url}/api/terminal/ecrire`, { method: 'POST', headers: H, body: JSON.stringify({ id, data }) })).json() as Promise<{ ok: boolean }>,
    lireDepuis: async (d: number) => (await fetch(`${v.url}/api/terminal/lire?id=${id}&depuis=${d}`, { headers: { cookie: v.session } })).json() as Promise<{ ok: boolean; debut: number; fin: number; data: string; ferme?: string; reprise: boolean }>,
    attendre: async (re: RegExp, ms = 15_000) => {
      const fin = Date.now() + ms;
      while (Date.now() < fin) {
        if (re.test(tout)) return tout;
        const r = await (await fetch(`${v.url}/api/terminal/lire?id=${id}&depuis=${depuis}&attendre=1`, { headers: { cookie: v.session } })).json() as { ok: boolean; fin: number; data: string; ferme?: string };
        if (!r.ok) break; tout += Buffer.from(r.data, 'base64').toString('utf8'); depuis = r.fin; if (r.ferme && !re.test(tout)) break;
      }
      assert.match(tout, re); return tout;
    },
  };
}

test('masquer : les secrets d\'une ligne tapée ne vont jamais au journal (pur)', () => {
  assert.equal(masquer('export TOKEN=abc123 && curl -u bob:pw https://bob:secret@exemple.yt --password hunter2'), 'export TOKEN=•••• && curl -u bob:pw https://bob:••••@exemple.yt --password ••••');
  assert.equal(masquer('git push ghp_abcdefghijklmnopqrstuvwxyz123456'), 'git push ••••');
});

test('terminaux : une vraie session qui dure, retrouvée telle quelle, Heimdall sur chaque ligne, journal sans secret, limite et fermeture pour inactivité', { timeout: 120_000, skip: !a('python3') && 'python3 absent' }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!;
    // Sans connexion : rien.
    assert.equal((await fetch(`${v.url}/api/terminal/lire?id=x&depuis=0`)).status, 401);
    // Ouvrir : action grave, accord demandé.
    let r = await acte(v, 'ouvrir_terminal', { nom: 'serveur' }); assert.match(r.confirm ?? '', /ouvrir un terminal \(un shell avec les droits d'Odin\) sur cette machine/);
    r = await acte(v, 'ouvrir_terminal', { nom: 'serveur' }, true); assert.notEqual(r.ok, false, r.text);
    const id = String(r.data!.id), c = client(v, id);
    await c.ecrire('echo "bonjour $((6*7))"\r'); await c.attendre(/bonjour 42/);
    await c.ecrire('cd /tmp && pwd && sleep 1 && echo suite-$((1+1))\r');
    // On quitte la page (plus de lecture), on revient plus tard : tout ce qui est sorti entre-temps est là.
    await new Promise((x) => setTimeout(x, 1800));
    const repris = await c.lireDepuis(0), ecran = Buffer.from(repris.data, 'base64').toString('utf8');
    assert.equal(repris.debut, 0); assert.match(ecran, /bonjour 42[\s\S]*\/tmp[\s\S]*suite-2/, 'la sortie d\'avant est retrouvée à la reconnexion');
    // La session continue : le dossier courant est gardé (c'est le même shell).
    const c2 = client(v, id); await c2.lireDepuis(0); await c2.ecrire('pwd\r'); await c2.attendre(/\/tmp\s*\r?\n[\s\S]*\/tmp/);
    // Heimdall : une commande destructrice ne part pas ; une commande qui peut couper l'accès se confirme en la retapant.
    await c.ecrire('rm -rf / --no-preserve-root\r'); await c.attendre(/Commande refusée par Heimdall/);
    await c.ecrire('passwd nobody-odin-essai\r'); await c.attendre(/Attention : cela touche un compte ou un mot de passe\. Pour la lancer quand même, tape-la de nouveau/);
    // Les secrets ne vont pas au journal ; ce qui suit une invite de mot de passe non plus.
    await c.ecrire('export JETON_SECRET=xyz987\r'); await c.ecrire('read -p "Mot de passe : " -s MDP\r'); await c.attendre(/Mot de passe : $/m);
    await c.ecrire('tres-secret-123\r'); await c.ecrire('echo fini-$MDP\r'); await c.attendre(/fini-tres-secret-123/);
    const journal = readFileSync(join(va.ctx('ivaldi').dir, 'terminaux', 'journal.log'), 'utf8');
    assert.match(journal, /\tserveur\tcette machine\techo "bonjour \$\(\(6\*7\)\)"/); assert.match(journal, /REFUSÉ rm -rf \//); assert.match(journal, /À CONFIRMER passwd/);
    assert.match(journal, /export JETON_SECRET=••••/); assert.match(journal, /\(saisie masquée : mot de passe\)/);
    assert.doesNotMatch(journal, /xyz987|tres-secret-123\n/, 'aucun secret dans le journal');
    // Taille de l'écran.
    await fetch(`${v.url}/api/terminal/taille`, { method: 'POST', headers: { cookie: v.session, 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ id, cols: 132, rows: 40 }) });
    await c.ecrire('stty size\r'); await c.attendre(/40 132/);
    // Limite : 2 terminaux à la fois au plus.
    await acte(v, 'regler_terminaux', { max: 2, inactif: 30 });
    r = await acte(v, 'ouvrir_terminal', { nom: 'deux' }, true); assert.notEqual(r.ok, false, r.text);
    r = await acte(v, 'ouvrir_terminal', { nom: 'trois' }, true); assert.equal(r.ok, false); assert.match(r.text!, /déjà 2 terminaux ouverts \(limite : 2\)/);
    // Une personne invitée (même avec un droit sur Dédale) n'ouvre jamais de terminal.
    const m = va.module('ivaldi')!, ouvrir = m.actions.find((x) => x.id === 'ouvrir_terminal')!;
    const refus = await auNomDe({ login: 'nour', name: 'Nour', groups: ['famille'] }, () => ouvrir.run(va.ctx('ivaldi'), { nom: 'pirate' }));
    assert.equal(refus.ok, false); assert.match(refus.text, /réservés au propriétaire/);
    // Inactivité : l'horloge d'Odin avance de 31 minutes, les terminaux se ferment.
    const plusTard = Object.assign(Object.create(va.ctx('ivaldi')) as ReturnType<typeof va.ctx>, { now: () => new Date(Date.now() + 31 * 60_000) });
    await m.watch!.run(plusTard);
    r = await acte(v, 'terminaux'); assert.equal((r.data as unknown as unknown[]).length, 0, r.text);
    assert.equal((await c.lireDepuis(0)).ok, false, 'la session est partie');
    assert.match(readFileSync(join(va.ctx('ivaldi').dir, 'terminaux', 'journal.log'), 'utf8'), /fermé après 30 min sans activité/);
  } finally { await tt.end(); }
});

const peutSsh = process.getuid?.() === 0 && a('sshd') && a('ssh') && a('ssh-keygen') && a('python3');
test('terminal sur un autre poste : un vrai serveur SSH d\'essai', { timeout: 120_000, skip: !peutSsh && 'sshd absent (ou pas root)' }, async () => {
  const tt = new T(), dir = mkdtempSync(join(tmpdir(), 'banc-ssh-')), enfants: ChildProcess[] = [];
  try {
    mkdirSync(join(dir, 'ssh')); mkdirSync('/run/sshd', { recursive: true });
    for (const k of ['hote', 'client']) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'ssh', k)]);
    copyFileSync(join(dir, 'ssh', 'client.pub'), join(dir, 'ssh', 'autorises')); chmodSync(join(dir, 'ssh', 'autorises'), 0o600);
    const port = await libre();
    writeFileSync(join(dir, 'ssh', 'sshd_config'), `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${dir}/ssh/hote\nPidFile ${dir}/ssh/sshd.pid\nAuthorizedKeysFile ${dir}/ssh/autorises\nPermitRootLogin yes\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nLogLevel ERROR\n`);
    const sshd = spawnSync('sh', ['-c', 'command -v sshd || echo /usr/sbin/sshd'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    enfants.push(spawn(sshd, ['-D', '-e', '-f', join(dir, 'ssh', 'sshd_config')], { stdio: 'ignore' }));
    for (let i = 0; i < 80 && !(await ouvert(port)); i++) await new Promise((x) => setTimeout(x, 100));
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!, home = va.ctx('ivaldi').home;
    copyFileSync(join(dir, 'ssh', 'client'), join(home, 'id_ed25519')); chmodSync(join(home, 'id_ed25519'), 0o600);
    saveMachine(home, { label: 'serveur-essai', host: '127.0.0.1', port, user: 'root' });
    const r = await acte(v, 'ouvrir_terminal', { nom: 'distant', poste: 'serveur-essai' }, true); assert.notEqual(r.ok, false, r.text); assert.match(r.text!, /sur serveur-essai \(SSH\)/);
    const c = client(v, String(r.data!.id));
    await c.ecrire('echo distant-$((20+22)) && tty\r'); await c.attendre(/distant-42[\s\S]*\/dev\/pts\//);
    await c.ecrire('exit\r'); await c.attendre(/terminé|logout|Connection to/);
  } finally { for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* fini */ } } await tt.end(); rmSync(dir, { recursive: true, force: true }); }
});

test('projets : parcourir, modifier (accord, version d\'avant), lancer un vrai projet Node et une page web, aperçu isolé à travers Odin', { timeout: 120_000, skip: !a('python3') && 'python3 absent' }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!, code = tt.tmp('code-');
    const node = join(code, 'salut'), web = join(code, 'vitrine');
    mkdirSync(join(node, 'lib'), { recursive: true }); mkdirSync(join(node, 'node_modules', 'x'), { recursive: true }); mkdirSync(web);
    writeFileSync(join(node, 'package.json'), JSON.stringify({ name: 'salut', scripts: { start: 'node server.js' } }));
    writeFileSync(join(node, 'server.js'), 'const h = require("http"); h.createServer((q, r) => { r.setHeader("set-cookie", "piege=1"); r.end(`Bonjour du projet ${q.url}`); }).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("pret sur " + process.env.PORT));\n');
    writeFileSync(join(node, 'lib', 'util.js'), 'module.exports = 1;\n'); writeFileSync(join(node, '.env'), 'SECRET=1\n');
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>Vitrine</title><h1>Ma vitrine</h1>');
    await va.act('ivaldi', 'dossier', { chemin: code });
    let r = await acte(v, 'projets'); assert.match(r.text!, /salut \(node\) .* se lance par « npm start »/); assert.match(r.text!, /vitrine \(web\) .* se lance par « python3 -m http\.server/);
    r = await acte(v, 'fichiers', { projet: node }); assert.deepEqual((r.data!.fichiers as Array<{ chemin: string }>).map((f) => f.chemin).sort(), ['.env', 'lib', 'lib/util.js', 'package.json', 'server.js'], 'sans node_modules');
    r = await acte(v, 'lire_fichier', { fichier: join(node, 'lib', 'util.js') }); assert.equal(r.data!.contenu, 'module.exports = 1;\n');
    for (const f of ['/etc/passwd', join(node, '.env'), join(node, '..', '..', 'etc')]) { r = await acte(v, 'lire_fichier', { fichier: f }); assert.equal(r.ok, false, f); }
    // Enregistrer : accord, puis la version d'avant peut revenir.
    r = await acte(v, 'enregistrer_fichier', { fichier: join(node, 'lib', 'util.js'), contenu: 'module.exports = 2;\n' }); assert.match(r.confirm ?? '', /remplacer le fichier util\.js/);
    r = await acte(v, 'enregistrer_fichier', { fichier: join(node, 'lib', 'util.js'), contenu: 'module.exports = 2;\n' }, true); assert.equal(readFileSync(join(node, 'lib', 'util.js'), 'utf8'), 'module.exports = 2;\n');
    r = await acte(v, 'remettre_fichier', { fichier: join(node, 'lib', 'util.js'), version: String(r.data!.avant) }, true); assert.equal(readFileSync(join(node, 'lib', 'util.js'), 'utf8'), 'module.exports = 1;\n');
    // Lancer le projet Node : accord, terminal qui dure, aperçu à travers Odin (connexion exigée, page isolée).
    r = await acte(v, 'lancer_projet', { projet: node }); assert.match(r.confirm ?? '', /lancer le code du projet salut/);
    if (!a('npm')) return;
    r = await acte(v, 'lancer_projet', { projet: node }, true); assert.notEqual(r.ok, false, r.text);
    const ap = String(r.data!.apercu); await client(v, String(r.data!.session)).attendre(/pret sur \d+/, 30_000);
    const p = await fetch(`${v.url}${ap}page?x=1`, { headers: { cookie: v.session } });
    assert.equal(await p.text(), 'Bonjour du projet /page?x=1'); assert.match(p.headers.get('content-security-policy') ?? '', /^sandbox/); assert.equal(p.headers.get('set-cookie'), null, 'le projet ne pose pas de cookie sur Odin');
    assert.equal((await fetch(`${v.url}${ap}`)).status, 401, 'sans connexion, pas d\'aperçu');
    // La page web : servie par un petit serveur, aperçu pareil.
    r = await acte(v, 'lancer_projet', { projet: web }, true); assert.notEqual(r.ok, false, r.text);
    const ap2 = String(r.data!.apercu); let html = '';
    for (let i = 0; i < 50 && !/Ma vitrine/.test(html); i++) { html = await (await fetch(`${v.url}${ap2}`, { headers: { cookie: v.session } })).text(); if (!/Ma vitrine/.test(html)) await new Promise((x) => setTimeout(x, 200)); }
    assert.match(html, /<h1>Ma vitrine<\/h1>/);
    // Arrêter : le terminal du projet se ferme, l'aperçu aussi.
    await acte(v, 'fermer_terminal', { id: String(r.data!.session) });
    assert.equal((await fetch(`${v.url}${ap2}`, { headers: { cookie: v.session } })).status, 404);
    // L'IA d'Odin (ici le faux fournisseur du banc, qui répond « ok ») reçoit le fichier et la question.
    r = await acte(v, 'demander_ia', { fichier: join(node, 'server.js'), question: 'Que fait ce fichier ?' }); assert.equal(r.text, 'ok');
    assert.ok(existsSync(join(va.ctx('ivaldi').dir, 'versions')));
  } finally { await tt.end(); }
});
