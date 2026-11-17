// Relecture du lot S 2 : constats 2 à 7, et l'épingle du modèle de départ protégée par l'intégrité.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { toolPath } from '../src/heimdall/policy.ts';
import { changementDe, commandeCode, estEnvoi, MONTRE_MAX } from '../src/heimdall/executer.ts';
import { commandeSurLeCode, ecrireReference, estNoyau, estSensible, verifierNoyau, RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { analyserCompose } from '../src/tools/apps.ts';
import { dossiersSpeciaux, mailMove, speciauxDeList } from '../src/tools/mail.ts';
import { call, makeOdin } from './helpers.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };

test('constat 2 : le fichier « dernière connue » est protégé ; ce qui se reconnaît dans une commande est vu', () => {
  assert.throws(() => toolPath({ workspace: tmpdir(), fullAccess: true }, join(tmpdir(), '.odin', 'noyau-reference-connue.txt'), { ecriture: true }), /Donnée des garde-fous/);
  assert.equal(commandeSurLeCode('echo x > ~/.odin/noyau-reference-connue.txt', []), 'reference');
  assert.equal(commandeSurLeCode('cd /tmp && sed -i s/a/b/ ../src/heimdall/policy.ts', []), 'code');
  assert.equal(commandeSurLeCode('import os; p = os.path.join(r, "heimdall", "policy.py")', []), 'code', 'Python qui assemble le chemin avec « heimdall »');
  const parent = join(RACINE_APPLI, '..');
  assert.equal(commandeCode('codex_run', { task: 'améliore le projet', dir: parent }, { workspace: tmpdir(), fullAccess: true }), 'code', 'Codex sur le dossier PARENT de la racine');
  assert.equal(commandeCode('shell', { command: 'ls', cwd: parent }, { workspace: tmpdir(), fullAccess: true }), undefined, 'une commande ordinaire lancée d\'un dossier parent n\'est pas du code');
  assert.equal(commandeSurLeCode('ls -la /tmp', [tmpdir()]), undefined, 'une commande ordinaire n\'est pas vue');
});

test('constat 3 : ce qui décide qui est le propriétaire est du code sensible ; aucun fichier qui en décide n\'est oublié', () => {
  for (const f of ['src/muninn/store.ts', 'src/web/access.ts', 'src/web/pairing.ts', 'src/valhalla/keryx/auth.ts', 'src/valhalla/keryx/canal.ts', 'src/web/maison-api.ts', 'src/valhalla/modules/midgard.ts', 'src/mimir/client.ts', 'src/valhalla/mcp.ts', 'src/types.ts', 'src/cli/main.ts']) assert.ok(estSensible(f), f);
  // Garde contre le retard : tout fichier qui dit qui est le propriétaire, qui répond aux validations, qui branche
  // Heimdall ou l'appelle doit être dans le noyau ou le code sensible.
  const motif = /isOwner\(|estMembre\(|speakerOf\(|setApprover\(|setValidationCode\(|verifierIntegrite\(|deciderPuisLancer\(|heimdall\.gate\(|\.gate\(\{|userFor\(|approvePairing\(|pairingStatus\(/;
  const oublies: string[] = [];
  const parcourir = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) parcourir(p); else if (/\.ts$/.test(n.name) && motif.test(readFileSync(p, 'utf8'))) { const rel = relative(RACINE_APPLI, p).replace(/\\/g, '/'); if (!estNoyau(rel) && !estSensible(rel)) oublies.push(rel); } } };
  parcourir(join(RACINE_APPLI, 'src'));
  assert.deepEqual(oublies, [], 'fichiers qui décident sans être protégés');
});

test('constat 4 : la demande montre le changement en entier quand il tient ; sinon les lignes retirées d\'abord, et où lire le reste', () => {
  const ancien = 'ligne ordinaire\n'.repeat(160) + 'if (lock) return refus; // LA LIGNE DANGEREUSE';
  const c = changementDe('self_edit', { path: 'src/heimdall/policy.ts', old: ancien, new: 'rien' })!;
  assert.match(c, /LA LIGNE DANGEREUSE/, 'la ligne retirée à la fin d\'un changement de 2 700 caractères est montrée');
  const home = tmp('chg-');
  const long = changementDe('self_edit', { path: 'x', old: 'a', new: 'b'.repeat(MONTRE_MAX * 2) }, home)!;
  assert.match(long, /caractères non montrés ici — le changement complet est dans .*changements/);
  assert.match(changementDe('python_run', { code: 'import os\nos.remove("x")\nprint(1)' })!, /os\.remove/, 'la commande Python entière');
});

test('constat 5 : les envois d\'un formulaire et d\'un curl -X POST comptent', () => {
  assert.equal(estEnvoi('browser_type', { element: 3, text: 'x', submit: true }), true);
  assert.equal(estEnvoi('browser_key', { key: 'Enter' }), true);
  assert.equal(estEnvoi('shell', { command: 'curl -X POST https://exemple.fr -d a=1' }), true);
  assert.equal(estEnvoi('shell', { command: 'curl https://exemple.fr' }), false);
  assert.equal(estEnvoi('browser_click', { element: 3 }), false);
});

test('constat 5 (de bout en bout) : une rafale répartie entre la conversation et son aide compte pour la demande d\'origine', async () => {
  // (un curl -X POST vers un port local fermé : un vrai envoi pour Heimdall, sans réseau ni contenu extérieur lu)
  const post = (n: number) => call('shell', { command: `curl -s -m 2 -X POST http://127.0.0.1:9/p${n} -d a=1` });
  const o = makeOdin([post(1), post(2), call('delegate', { tasks: [{ goal: 'poste encore' }] }), post(3), post(4), { text: 'aide finie' }, { text: 'fini' }]);
  o.heimdall.setBreaker({ ...o.heimdall.getBreaker(), schedule: 'always' }); o.heimdall.setAutonomy('breaker');
  await o.agent.run('envoie les formulaires', { sessionId: 'web:moi' });
  assert.ok(o.approvals.some((a) => /comportement inhabituel.*4e envoi/.test(a.reason)), JSON.stringify(o.approvals.map((a) => a.reason)));
  o.cleanup();
});

test('constat 6 : l\'analyse lit la configuration RÉSOLUE (chemin long, volume nommé avec device, lien dans le dépôt)', () => {
  const depot = tmp('depot-'), home = tmp('home-');
  const o = { dossierDepot: depot, interditsHote: [home, RACINE_APPLI] };
  const resolu = `services:\n  app:\n    volumes:\n      - type: bind\n        source: ${home}\n        target: /data\nvolumes:\n  donnees:\n    driver_opts:\n      type: none\n      o: bind\n      device: ${RACINE_APPLI}\n`;
  assert.equal(analyserCompose(resolu, o).interdits.length, 2);
  mkdirSync(join(home, 'cible'), { recursive: true });
  try { symlinkSync(home, join(depot, 'lien'), 'junction'); } catch { return; }
  assert.equal(analyserCompose('services:\n  app:\n    volumes:\n      - ./lien:/x\n', o).interdits.length, 1, 'un lien du dépôt vers le dossier d\'Odin');
});

test('constat 7 : la corbeille reconnue par son RÔLE sur le serveur (\\Trash, \\Junk), pas seulement par son nom', () => {
  const rep = '* LIST (\\HasNoChildren \\Trash) "/" "Poubelle"\r\n* LIST (\\HasNoChildren \\Junk) "/" "À supprimer"\r\n* LIST (\\HasNoChildren) "/" "Factures"\r\n';
  assert.deepEqual(speciauxDeList(rep), ['Poubelle', 'À supprimer']);
  assert.equal(mailMove.grave!({ uid: '1', folder: 'Poubelle' }), undefined, 'inconnu avant de demander au serveur');
  for (const d of speciauxDeList(rep)) dossiersSpeciaux.add(d.toLowerCase());
  assert.match(mailMove.grave!({ uid: '1', folder: 'Poubelle' }) ?? '', /supprimer 1 e-mail/);
  assert.equal(mailMove.grave!({ uid: '1', folder: 'Factures' }), undefined);
  assert.match(readFileSync(join(RACINE_APPLI, 'src', 'tools', 'mail.ts'), 'utf8'), /UID EXPUNGE \$\{uid\}/);
  assert.doesNotMatch(readFileSync(join(RACINE_APPLI, 'src', 'tools', 'mail.ts'), 'utf8'), /im\.cmd\('EXPUNGE'\)/, 'plus jamais un EXPUNGE général');
});

test('l\'épingle du modèle de départ est sous l\'intégrité : absente des deux côtés = pas d\'écart ; apparue ou modifiée = écart', () => {
  const racine = tmp('epingle-');
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true }); mkdirSync(join(racine, 'src', 'brain', 'nous'), { recursive: true });
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\n');
  ecrireReference(racine);
  assert.deepEqual(verifierNoyau(racine).ecarts, [], 'absente dans la référence et sur le disque');
  const ep = join(racine, 'src', 'brain', 'nous', 'modele-depart-epingle.json');
  writeFileSync(ep, '{"version":1,"manifeste":"aaa"}');
  assert.deepEqual(verifierNoyau(racine).ecarts, [{ fichier: 'src/brain/nous/modele-depart-epingle.json', etat: 'ajouté' }]);
  ecrireReference(racine);
  writeFileSync(ep, '{"version":1,"manifeste":"bbb"}');
  assert.deepEqual(verifierNoyau(racine).ecarts, [{ fichier: 'src/brain/nous/modele-depart-epingle.json', etat: 'modifié' }]);
});
