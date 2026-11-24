// Hringhorni, lot K5 (maquette « Conteneurs et machines » validée le 23/11) : les mises à jour, sur le VRAI moteur rangé
// dans un dossier jetable — mais AUCUN conteneur lancé, AUCUN téléchargement (faux lanceur : démarrer et arrêter ne font
// qu'écrire l'état ; « récupérer une image » ne fait que l'inscrire). Ce qui est vérifié :
// - une version précise (jamais rien ni « latest »), la même appli ;
// - la place vérifiée AVANT (refus sinon, rien ne change), un volume partagé hors de la mise à jour refusé ;
// - la copie des volumes (sans suivre un lien), la mise à jour, la vérification ; si la nouvelle version ne démarre pas,
//   tombe ou se relance : RETOUR TOUT SEUL à l'ancien conteneur ET aux volumes copiés, et c'est écrit ;
// - la copie gardée jusqu'à ce qu'on la retire ; les versions du catalogue ; « grandit ».
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';
import * as M from '../src/valhalla/hringhorni/majs.ts';
import type { Pile } from '../src/valhalla/hringhorni/composition.ts';
import type { EntreeCatalogue } from '../src/valhalla/hringhorni/catalogue.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('hh-k5-baux-');
const SANTE0 = { ...M.SANTE };
after(() => { Object.assign(M.SANTE, SANTE0); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
Object.assign(M.SANTE, { secondes: 0.15, pasMs: 10 });

const img = (n: string, k: string, env: string[] = ['APP_VERSION=1']): Image => { const id = k.repeat(64).slice(0, 64); return { id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'], Env: env } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() }; };
/** Un moteur d'essai : démarrer et arrêter n'écrivent que l'état ; une image « casse » ne démarre pas, « tombe » tombe
 *  peu après, « relance » se relance ; une nouvelle version écrit dans ses volumes (une « migration »). */
function monde(o: { registre?: Record<string, Image> } = {}) {
  const dir = neuf('hh-k5-'), journal: string[] = [];
  class MoteurEssai extends Engine {
    override async start(n: string) {
      const c = this.find(n); journal.push(`start ${c.spec.name} ${c.spec.image}`);
      if (/casse/.test(c.spec.image)) { this.store.saveState(c.id, { status: 'sorti', exitCode: 1, error: 'erreur de configuration' }); throw new Error(`${c.spec.name} s'est arrêté au démarrage : erreur de configuration`); }
      this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString(), restarts: 0 });
      for (const m of c.spec.mounts.filter((x) => x.volume && /:2\./.test(c.spec.image))) writeFileSync(join(m.host, 'migre.txt'), `migré par ${c.spec.image}`);
      if (/tombe/.test(c.spec.image)) setTimeout(() => { if (existsSync(this.store.ctr(c.id))) this.store.saveState(c.id, { status: 'sorti', exitCode: 137, error: 'mémoire dépassée' }); }, 40);
      if (/relance/.test(c.spec.image)) setTimeout(() => { if (existsSync(this.store.ctr(c.id))) this.store.patchState(c.id, { restarts: 1 }); }, 40);
      return this.find(n);
    }
    override async stop(n: string) { const c = this.find(n); journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
    override async pull(n: string) {
      journal.push(`pull ${n}`); const i = o.registre?.[n]; if (!i) throw new Error(`registre : ${n} introuvable`);
      this.store.saveImages([...this.images().filter((x) => x.id !== i.id), i]); return i;
    }
  }
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('aucune sortie'); }) as never });
  e.store.saveImages([img('registre.maison/appli:1.0', 'a', ['APP_VERSION=1', 'PATH=/usr/bin']), img('registre.maison/base:15.1', 'b')]);
  return { e, dir, journal };
}
const plein = () => 1024 ** 4;
async function appli(w: ReturnType<typeof monde>, nom = 'appli', image = 'registre.maison/appli:1.0') {
  await w.e.create({ image, name: nom, network: 'aucun', mounts: `${nom}-donnees:/donnees`, env: { MOT: 'garde', APP_VERSION: '1' }, memory: '512m', restart: 'sauf-arret' });
  await w.e.start(nom);
  writeFileSync(join(w.e.store.volumeData(`${nom}-donnees`), 'notes.txt'), 'mes données');
  mkdirSync(join(w.e.store.volumeData(`${nom}-donnees`), 'sous'), { recursive: true });
  writeFileSync(join(w.e.store.volumeData(`${nom}-donnees`), 'sous', 'b.txt'), 'b');
}

test('la version : précise, jamais rien ni « latest », et la même appli', () => {
  for (const x of ['nginx', 'nginx:latest', 'ghcr.io/a/b:LATEST', 'ghcr.io/a/b']) assert.throws(() => M.verifierVersion(x), /version précise|latest/, x);
  assert.throws(() => M.verifierVersion('nginx:1;rm -rf /'), /illisible/);
  assert.equal(M.verifierVersion('nginx:1.27.4'), 'nginx:1.27.4');
  assert.equal(M.verifierVersion(`nginx@sha256:${'a'.repeat(64)}`), `nginx@sha256:${'a'.repeat(64)}`);
  assert.equal(M.appliDe('nginx:1.27.3'), M.appliDe('docker.io/library/nginx:1.27.4'));
  assert.notEqual(M.appliDe('nginx:1'), M.appliDe('httpd:1'));
});

test('copier un dossier : tout, droits gardés, sans jamais suivre un lien ; jamais par-dessus une copie', () => {
  const d = neuf('hh-k5-copie-'), src = join(d, 'src'), dst = join(d, 'dst'), dehors = join(d, 'dehors');
  mkdirSync(join(src, 'a', 'b'), { recursive: true }); mkdirSync(dehors);
  writeFileSync(join(src, 'a', 'b', 'f.txt'), 'contenu'); writeFileSync(join(dehors, 'secret.txt'), 'hors du volume');
  let lien = false; try { symlinkSync(dehors, join(src, 'lien'), 'junction'); lien = true; } catch { /* pas de droit de lien sur ce poste */ }
  const r = M.copierArbre(src, dst);
  assert.equal(readFileSync(join(dst, 'a', 'b', 'f.txt'), 'utf8'), 'contenu');
  assert.equal(r.fichiers, 1); assert.equal(r.octets, 7);
  if (lien) assert.ok(lstatSync(join(dst, 'lien')).isSymbolicLink(), 'le lien est recopié comme un lien, jamais suivi (le fichier de dehors n\'est pas compté)');
  assert.throws(() => M.copierArbre(src, dst), /existe déjà/);
});

test('préparer : la place vérifiée avant (refus, rien ne change), un volume partagé refusé, la même version refusée', async () => {
  const w = monde();
  await appli(w);
  const avant = JSON.stringify(w.e.ps(true).map((c) => [c.spec.name, c.state.status]));
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: () => 1000 }), /pas assez de place.*il reste.*Rien n'a été changé/);
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: () => undefined }), /place libre.*ne se lit pas/);
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:1.0' }], { libre: plein }), /déjà sur/);
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/autre:2.0' }], { libre: plein }), /pas la même appli/);
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:latest' }], { libre: plein }), /latest/);
  await w.e.create({ image: 'registre.maison/base:15.1', name: 'voisin', network: 'aucun', mounts: 'appli-donnees:/aussi' });
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein }), /sert aussi à voisin/);
  await w.e.rm('voisin', true);
  const cpt = { ...M.COMPTE_MAJ }; Object.assign(M.COMPTE_MAJ, { entrees: 1 });
  try { assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein }), /trop de fichiers/); } finally { Object.assign(M.COMPTE_MAJ, cpt); }
  const p = M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein });
  assert.deepEqual(p.volumes.map((v) => [v.nom, v.octets, v.fichiers]), [['appli-donnees', 13, 2]]);
  assert.equal(p.besoin, 2 * 13 + M.MARGE.octets);
  const t = M.confirmationMaj(p, 30);
  assert.match(t, /^mettre à jour appli \(registre\.maison\/appli:1\.0 → registre\.maison\/appli:2\.0\) : d'abord une copie de ses volumes \(appli-donnees, 0 Ko\) dans le dossier du moteur, gardée jusqu'à ce que tu la retires ; il est arrêté le temps de la mise à jour, puis doit tenir debout 30 secondes : sinon, retour tout seul à l'ancienne version et aux volumes copiés$/);
  assert.equal(JSON.stringify(w.e.ps(true).map((c) => [c.spec.name, c.state.status])), avant, 'rien n\'a changé');
  assert.deepEqual(M.copiesMaj(w.e), []);
  assert.ok(!w.journal.some((x) => /^(pull|stop)/.test(x)));
});

test('réussie : copie d\'abord, nouvelle image, mêmes réglages (sans imposer ce qui venait de l\'ancienne image), l\'ancien conteneur part, la copie reste', async () => {
  const w = monde({ registre: { 'registre.maison/appli:2.0': img('registre.maison/appli:2.0', 'c', ['APP_VERSION=2', 'PATH=/usr/bin']) } });
  await appli(w);
  const avant = w.e.find('appli');
  const p = M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein });
  const etapes: string[] = [];
  const fin = await M.mettreAJour(w.e, p, { libre: plein, etape: (t) => etapes.push(t) });
  assert.equal(fin.resultat, 'réussie', fin.texte);
  assert.match(fin.texte, /appli à jour \(registre\.maison\/appli:2\.0\), et il tient debout\. La copie de ses volumes est gardée/);
  const n = w.e.find('appli');
  assert.notEqual(n.id, avant.id); assert.equal(n.spec.image, 'registre.maison/appli:2.0'); assert.equal(n.state.status, 'en marche');
  assert.equal(n.spec.env.MOT, 'garde', 'ses variables restent');
  assert.equal(n.spec.env.APP_VERSION, '2', 'une variable qui venait de l\'ancienne image n\'est pas imposée à la nouvelle');
  assert.deepEqual([n.spec.memory, n.spec.restart, n.spec.mounts.map((m) => m.volume)], ['512m', 'sauf-arret', ['appli-donnees']]);
  assert.equal(w.e.ps(true).length, 1, 'l\'ancien conteneur est parti (son image reste)');
  assert.ok(w.e.findImage('registre.maison/appli:1.0'));
  // l'ordre : récupérer, PUIS arrêter, copier, créer, démarrer, vérifier
  assert.deepEqual(w.journal.slice(1), ['pull registre.maison/appli:2.0', 'stop appli', 'start appli registre.maison/appli:2.0']);
  assert.ok(etapes.indexOf('copier le volume appli-donnees') < etapes.findIndex((x) => /^créer appli/.test(x)));
  const c = M.copiesMaj(w.e);
  assert.equal(c.length, 1); assert.equal(c[0].resultat, 'réussie'); assert.equal(c[0].copiee, true);
  assert.equal(readFileSync(join(M.dossierCopies(w.e), c[0].id, 'volumes', 'appli-donnees', 'notes.txt'), 'utf8'), 'mes données');
  assert.equal(existsSync(join(M.dossierCopies(w.e), c[0].id, 'volumes', 'appli-donnees', 'migre.txt')), false, 'la copie est faite AVANT la nouvelle version');
  assert.ok(existsSync(join(w.e.store.volumeData('appli-donnees'), 'migre.txt')), 'la nouvelle version garde ce qu\'elle a écrit');
});

for (const [cas, image, raison] of [
  ['ne démarre pas', 'registre.maison/appli:2.0-casse', /n'a pas démarré/],
  ['tombe dans les premières secondes', 'registre.maison/appli:2.0-tombe', /est tombé au bout de \d+ s \(sorti, code 137 : mémoire dépassée\)/],
  ['se relance tout seul', 'registre.maison/appli:2.0-relance', /s'est relancé tout seul 1 fois/],
] as const) {
  test(`retour tout seul quand la nouvelle version ${cas} : ancien conteneur ET volumes copiés, et c'est dit`, async () => {
    const w = monde({ registre: { [image]: img(image, 'd') } });
    await appli(w);
    const avant = w.e.find('appli');
    const p = M.planifier(w.e, [{ conteneur: 'appli', image }], { libre: plein });
    const fin = await M.mettreAJour(w.e, p, { libre: plein });
    assert.equal(fin.resultat, 'revenue', fin.texte);
    assert.match(fin.texte, /La nouvelle version n'a pas tenu \(.*\) : retour tout seul à l'ancienne version et aux volumes copiés\. La copie est gardée\./);
    assert.match(String(fin.raison), raison);
    const r = w.e.find('appli');
    assert.equal(r.id, avant.id, 'le même conteneur qu\'avant (sa couche à lui comprise)');
    assert.deepEqual([r.spec.name, r.spec.image, r.state.status, r.spec.labels['odin.maj.ancien']], ['appli', 'registre.maison/appli:1.0', 'en marche', undefined]);
    assert.equal(w.e.ps(true).length, 1, 'la nouvelle version est retirée');
    const vol = w.e.store.volumeData('appli-donnees');
    assert.equal(readFileSync(join(vol, 'notes.txt'), 'utf8'), 'mes données');
    assert.equal(existsSync(join(vol, 'migre.txt')), false, 'ce que la nouvelle version avait écrit est parti avec le retour');
    assert.equal(readFileSync(join(vol, 'sous', 'b.txt'), 'utf8'), 'b');
    const c = M.copiesMaj(w.e)[0];
    assert.equal(c.resultat, 'revenue'); assert.match(String(c.raison), raison);
    assert.ok(existsSync(join(M.dossierCopies(w.e), c.id, 'volumes', 'appli-donnees', 'notes.txt')), 'la copie est gardée');
  });
}

test('pas faite : l\'image ne se récupère pas, ou c\'est la même ; rien n\'est arrêté', async () => {
  const w = monde({ registre: { 'registre.maison/appli:1.0': img('registre.maison/appli:1.0', 'a') } });
  await appli(w);
  const p = M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:3.0' }], { libre: plein });
  const f1 = await M.mettreAJour(w.e, p, { libre: plein });
  assert.equal(f1.resultat, 'pas faite'); assert.match(f1.texte, /^Rien n'a été changé : la nouvelle image registre\.maison\/appli:3\.0 n'a pas pu être récupérée/);
  const meme = M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:1.0' }], { libre: plein, memeEtiquette: true });
  const f2 = await M.mettreAJour(w.e, meme, { libre: plein });
  assert.equal(f2.resultat, 'pas faite'); assert.match(f2.texte, /celle qu'il a déjà/);
  assert.equal(w.e.find('appli').state.status, 'en marche'); assert.ok(!w.journal.includes('stop appli'));
  // la place a fondu pendant le téléchargement : revue avant d'arrêter quoi que ce soit
  const w2 = monde({ registre: { 'registre.maison/appli:2.0': img('registre.maison/appli:2.0', 'c') } });
  await appli(w2);
  let libre = plein(); const p2 = M.planifier(w2.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: () => libre });
  libre = 10;
  const f3 = await M.mettreAJour(w2.e, p2, { libre: () => libre });
  assert.equal(f3.resultat, 'pas faite'); assert.match(f3.texte, /pas assez de place/); assert.ok(!w2.journal.includes('stop appli'));
});

test('une pile : arrêtée à l\'envers, relancée dans l\'ordre ; un service qui tombe ramène TOUTE la pile', async () => {
  const image = 'registre.maison/appli:2.0-tombe';
  const w = monde({ registre: { [image]: img(image, 'e'), 'registre.maison/base:15.2': img('registre.maison/base:15.2', 'f') } });
  await w.e.create({ image: 'registre.maison/base:15.1', name: 'p-base', network: 'aucun', mounts: 'p_base:/var/lib/base', labels: { 'odin.pile': 'p', 'odin.pile.service': 'base' } });
  await w.e.create({ image: 'registre.maison/appli:1.0', name: 'p-serveur', network: 'aucun', mounts: 'p_donnees:/donnees', labels: { 'odin.pile': 'p', 'odin.pile.service': 'serveur' } });
  await w.e.start('p-base'); await w.e.start('p-serveur');
  writeFileSync(join(w.e.store.volumeData('p_base'), 'table'), 'v15');
  const ids = [w.e.find('p-base').id, w.e.find('p-serveur').id];
  const p = M.planifier(w.e, [{ conteneur: 'p-base', image: 'registre.maison/base:15.2' }, { conteneur: 'p-serveur', image }], { libre: plein, pile: 'p' });
  assert.match(M.confirmationMaj(p), /^mettre à jour la pile « p » \(p-base : registre\.maison\/base:15\.1 → registre\.maison\/base:15\.2 ; p-serveur : .*\) : d'abord une copie de ses volumes \(p_base, p_donnees, .*ses conteneurs sont arrêtés le temps de la mise à jour, puis doivent tenir debout/);
  w.journal.length = 0;
  const fin = await M.mettreAJour(w.e, p, { libre: plein });
  assert.equal(fin.resultat, 'revenue', fin.texte);
  assert.deepEqual(w.journal.filter((x) => /^(stop|start)/.test(x)).slice(0, 4), ['stop p-serveur', 'stop p-base', 'start p-base registre.maison/base:15.2', `start p-serveur ${image}`]);
  assert.deepEqual([w.e.find('p-base').id, w.e.find('p-serveur').id], ids);
  assert.deepEqual(w.e.ps(true).map((c) => [c.spec.name, c.spec.image, c.state.status]).sort(), [['p-base', 'registre.maison/base:15.1', 'en marche'], ['p-serveur', 'registre.maison/appli:1.0', 'en marche']]);
  assert.equal(readFileSync(join(w.e.store.volumeData('p_base'), 'table'), 'utf8'), 'v15');
});

test('la copie gardée : retirée seulement par le geste ; jamais un nom piégé, jamais une mise à jour en cours', async () => {
  const w = monde({ registre: { 'registre.maison/appli:2.0': img('registre.maison/appli:2.0', 'c') } });
  await appli(w);
  await M.mettreAJour(w.e, M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein }), { libre: plein });
  const [c] = M.copiesMaj(w.e);
  assert.throws(() => M.retirerCopie(w.e, '../../x'), /copie inconnue/);
  assert.throws(() => M.retirerCopie(w.e, 'abcdefabcdef'), /copie inconnue/);
  const r = M.retirerCopie(w.e, c.id);
  assert.equal(r.id, c.id); assert.equal(existsSync(join(M.dossierCopies(w.e), c.id)), false);
  assert.ok(existsSync(w.e.store.volumeData('appli-donnees')), 'le volume lui-même n\'est jamais touché');
  // une fiche « en cours » dont la mise à jour tourne : refusée
  const id = 'aaaaaaaaaaaa'; mkdirSync(join(M.dossierCopies(w.e), id), { recursive: true });
  writeFileSync(join(M.dossierCopies(w.e), id, 'fiche.json'), JSON.stringify({ id, quand: new Date().toISOString(), conteneurs: [], volumes: [], octets: 0, copiee: false, resultat: 'en cours', dossiersNonCopies: [] }));
  assert.throws(() => M.retirerCopie(w.e, id, () => true), /en cours/);
  assert.ok(statSync(join(M.dossierCopies(w.e), id)).isDirectory());
});

test('les réglages pour la nouvelle image : ce qui venait de l\'ancienne n\'est pas imposé (variables, commande, dossier)', () => {
  const sp = { id: 'x', name: 'a', image: 'i:1', imageId: 'x', cmd: ['/bin/appli'], env: { APP_VERSION: '1', MOT: 'garde', PATH: '/usr/bin' }, workdir: '/', user: '', ports: [], mounts: [], restart: 'non' as const, hostname: 'a', network: 'aucun' as const, autoRemove: false, created: '', labels: { 'odin.moteur': 'hringhorni', 'odin.pile': 'p', 'odin.maj.ancien': 'a' } };
  const r = M.reglagesPour(sp, { Env: ['APP_VERSION=1', 'PATH=/usr/bin'], Cmd: ['/bin/appli'] }, 'i:2');
  assert.deepEqual(r.env, { MOT: 'garde' }); assert.equal(r.entrypoint, undefined); assert.equal(r.workdir, undefined);
  assert.deepEqual(r.labels, { 'odin.pile': 'p' });
  const r2 = M.reglagesPour({ ...sp, cmd: ['/bin/appli', '--port', '9'], workdir: '/app' }, { Cmd: ['/bin/appli'] }, 'i:2');
  assert.deepEqual([r2.entrypoint, r2.cmd, r2.workdir], [['/bin/appli', '--port', '9'], [], '/app']);
});

test('le catalogue : une autre version vient du code d\'Odin (la même appli, les mêmes services) ; la pile la note', () => {
  const x: EntreeCatalogue = { id: 'notes', nom: 'Bloc-notes', categorie: 'Notes', quoi: '', alternativeA: [], ports: [{ cle: 'web', propose: 20300, quoi: 'le bloc' }], acces: 'premier-compte', premiere: '', composition: 'services:\n  serveur:\n    image: neosmemo/memos:0.22.6\n    ports: ["{{port:web}}:5230"]\n' };
  const pl = (nom: string, image: string, service = 'serveur'): Pile => ({ nom, cree: '', fichier: `services:\n  ${service}:\n    image: ${image}\n`, ordre: [service], services: [{ service, conteneur: `${nom}-${service}`, image }], volumesPropres: [], reseauxPropres: [], volumes: [], reseaux: [] });
  const l = M.propositionsCatalogue([pl('notes', 'neosmemo/memos:0.22.5'), pl('notes-2', 'neosmemo/memos:0.22.6'), pl('notes-3', 'autre/appli:1'), pl('photos', 'neosmemo/memos:0.22.5'), pl('notes-4', 'neosmemo/memos:0.22.5', 'web')], [x]);
  assert.deepEqual(l, [{ pile: 'notes', app: 'notes', appNom: 'Bloc-notes', changes: [{ service: 'serveur', conteneur: 'notes-serveur', avant: 'neosmemo/memos:0.22.5', apres: 'neosmemo/memos:0.22.6' }] }]);
  const w = monde();
  mkdirSync(join(w.dir, 'piles'), { recursive: true });
  const n = M.noterPile(w.e, pl('notes', 'neosmemo/memos:0.22.5'), [{ nom: 'notes-serveur', avant: 'neosmemo/memos:0.22.5', apres: 'neosmemo/memos:0.22.6' }]);
  assert.equal(n.services[0].image, 'neosmemo/memos:0.22.6'); assert.match(n.fichier, /image: neosmemo\/memos:0\.22\.6/);
  assert.equal((JSON.parse(readFileSync(join(w.dir, 'piles', 'notes.json'), 'utf8')) as Pile).services[0].image, 'neosmemo/memos:0.22.6');
});

test('« grandit » : un volume qui grossit vite, d\'après les mesures (au moins une heure de recul)', () => {
  const h = 3600_000, t = Date.UTC(2026, 10, 24, 12), G = 1024 ** 3;
  assert.equal(M.grandit([{ at: t - 30 * 60_000, o: 0 }, { at: t, o: 5 * G }], t).grandit, false, 'moins d\'une heure : on ne dit rien');
  const vite = M.grandit([{ at: t - 2 * h, o: G }, { at: t - h, o: 1.2 * G }, { at: t, o: 1.5 * G }], t, 24 * G);
  assert.equal(vite.grandit, true); assert.equal(vite.parJour, Math.round((0.5 * G / 2) * 24)); assert.equal(vite.joursAvantPlein, 4);
  assert.equal(M.grandit([{ at: t - 20 * h, o: G }, { at: t, o: G + 50 * 1024 ** 2 }], t).grandit, false, '50 Mo en 20 h : normal');
  assert.equal(M.grandit([{ at: t - 3 * h, o: 2 * G }, { at: t, o: G }], t).grandit, false, 'il rétrécit');
  assert.equal(M.grandit([{ at: t - 30 * h, o: 0 }, { at: t - 25 * h, o: 9 * G }, { at: t - 2 * h, o: 9 * G }, { at: t, o: 9 * G }], t).grandit, false, 'hors de la fenêtre de 24 h');
  let l: M.Mesure[] = []; for (let k = 0; k < 400; k++) l = M.ajouterMesure(l, t + k * 60_000, k);
  assert.equal(l.length, M.GRANDIT.garder); assert.equal(l.at(-1)!.o, 399);
});

test('aucun minuteur ne met à jour : le code des mises à jour ne lance rien tout seul', () => {
  const src = readFileSync(new URL('../src/valhalla/hringhorni/majs.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /setInterval|cron|toutes les \d+ (heures|minutes) (Odin|on) met/i);
  assert.equal((src.match(/setTimeout/g) ?? []).length, 1, 'un seul : l\'attente de la vérification');
});

// ---- relecture du lot : ce qui pouvait perdre ou abîmer des données ----
test('relecture : un conteneur qui monte le dossier du volume par son chemin compte aussi (refus, rien ne change)', async () => {
  const w = monde();
  await appli(w);
  const v = await w.e.create({ image: 'registre.maison/base:15.1', name: 'voisin', network: 'aucun' });
  w.e.store.saveSpec({ ...v, mounts: [{ host: w.e.store.volumeData('appli-donnees'), inner: '/aussi', ro: false }] });
  assert.throws(() => M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein }), /sert aussi à voisin/);
});

test('relecture : la copie échoue au milieu (disque plein) : copie partielle effacée, rien de changé, conteneurs relancés', async () => {
  const w = monde({ registre: { 'registre.maison/appli:2.0': img('registre.maison/appli:2.0', 'c') } });
  await appli(w);
  await w.e.create({ image: 'registre.maison/appli:1.0', name: 'appli2', network: 'aucun', mounts: 'appli-zz:/zz' });
  writeFileSync(join(w.e.store.volumeData('appli-zz'), 'z.txt'), 'z');
  const p = M.planifier(w.e, [{ conteneur: 'appli', image: 'registre.maison/appli:2.0' }], { libre: plein });
  p.volumes.push({ nom: 'appli-zz', octets: 1, fichiers: 1 });
  const verif = w.e.dossierVerifieVolume.bind(w.e);
  w.e.dossierVerifieVolume = (n: string) => { if (n === 'appli-zz') throw new Error('ENOSPC: plus de place sur le disque'); return verif(n); };
  const fin = await M.mettreAJour(w.e, p, { libre: plein });
  assert.equal(fin.resultat, 'revenue', fin.texte); assert.match(String(fin.raison), /la copie des volumes a échoué : ENOSPC/);
  const c = M.copiesMaj(w.e)[0];
  assert.equal(c.copiee, false);
  assert.equal(existsSync(join(M.dossierCopies(w.e), c.id, 'volumes')), false, 'la copie partielle ne garde pas le disque plein');
  assert.equal(w.e.find('appli').state.status, 'en marche'); assert.equal(w.e.find('appli').spec.image, 'registre.maison/appli:1.0');
  assert.equal(readFileSync(join(w.e.store.volumeData('appli-donnees'), 'notes.txt'), 'utf8'), 'mes données');
});

test('relecture : la nouvelle version ne se retire pas au retour : ses volumes ne sont pas remis sous elle, l\'ancien garde son nom de côté', async () => {
  const image = 'registre.maison/appli:2.0-casse';
  const w = monde({ registre: { [image]: img(image, 'd') } });
  await appli(w);
  const avant = w.e.find('appli');
  const p = M.planifier(w.e, [{ conteneur: 'appli', image }], { libre: plein });
  const rm = w.e.rm.bind(w.e);
  w.e.rm = async (n: string, f?: boolean) => { if (w.e.find(n).spec.image === image) throw new Error('occupé'); return rm(n, f); };
  const fin = await M.mettreAJour(w.e, p, { libre: plein });
  assert.equal(fin.resultat, 'retour incomplet', fin.texte);
  assert.equal(w.e.ps(true).filter((c) => c.spec.name === 'appli').length, 1, 'jamais deux conteneurs du même nom');
  assert.equal(w.e.find(avant.id).spec.labels['odin.maj.ancien'], 'appli', 'l\'ancien reste de côté, intact');
  assert.ok(existsSync(join(M.dossierCopies(w.e), fin.copie, 'volumes', 'appli-donnees', 'notes.txt')), 'la copie est gardée');
});

test('relecture : Odin coupé en pleine mise à jour : au retour, l\'ancien conteneur et ses volumes sont remis tout seuls', async () => {
  const image = 'registre.maison/appli:2.0-pend';
  const w = monde({ registre: { [image]: img(image, 'g') } });
  await appli(w);
  const avant = w.e.find('appli');
  const start = w.e.start.bind(w.e);
  w.e.start = async (n: string) => { const c = w.e.find(n); if (c.spec.image === image) { writeFileSync(join(w.e.store.volumeData('appli-donnees'), 'migre.txt'), 'à moitié'); return new Promise(() => {}); } return start(n); };
  const p = M.planifier(w.e, [{ conteneur: 'appli', image }], { libre: plein });
  void M.mettreAJour(w.e, p, { libre: plein, idCopie: 'bbbbbbbbbbbb' });
  for (let k = 0; k < 200 && !existsSync(join(w.e.store.volumeData('appli-donnees'), 'migre.txt')); k++) await new Promise((r) => setTimeout(r, 5));
  // (Odin s'arrête ici : la mise à jour ne finira jamais dans ce processus)
  assert.equal(M.copiesMaj(w.e)[0].resultat, 'en cours');
  const r = await M.reprendreInterrompues(w.e, () => false, () => false);
  assert.equal(r.length, 1); assert.equal(r[0].resultat, 'revenue', r[0].raison);
  const x = w.e.find('appli');
  assert.equal(x.id, avant.id); assert.equal(x.state.status, 'en marche'); assert.equal(x.spec.labels['odin.maj.ancien'], undefined);
  assert.equal(w.e.ps(true).length, 1, 'la nouvelle version à moitié lancée est retirée');
  assert.equal(existsSync(join(w.e.store.volumeData('appli-donnees'), 'migre.txt')), false, 'les volumes copiés sont remis');
  const c = M.copiesMaj(w.e)[0];
  assert.equal(c.resultat, 'revenue'); assert.match(String(c.raison), /arrêt d'Odin/);
  assert.deepEqual(await M.reprendreInterrompues(w.e, () => false, () => false), [], 'une seule fois');
});

test('relecture : Odin coupé pendant la copie : rien n\'était changé, le conteneur arrêté est relancé', async () => {
  const w = monde({ registre: { 'registre.maison/appli:2.0': img('registre.maison/appli:2.0', 'c') } });
  await appli(w);
  const id = 'cccccccccccc', dir = join(M.dossierCopies(w.e), id);
  mkdirSync(join(dir, 'volumes', 'appli-donnees'), { recursive: true });
  writeFileSync(join(dir, 'fiche.json'), JSON.stringify({ id, quand: new Date().toISOString(), pid: 1, etape: 'copie', conteneurs: [{ nom: 'appli', avant: 'registre.maison/appli:1.0', apres: 'registre.maison/appli:2.0', ancien: M.nomAncien('appli', id), enMarche: true }], volumes: [{ nom: 'appli-donnees', octets: 13, fichiers: 2 }], octets: 13, copiee: false, resultat: 'en cours', dossiersNonCopies: [] }));
  await w.e.stop('appli');
  // une mise à jour qui tourne ailleurs (son processus vit) : jamais touchée
  assert.deepEqual(await M.reprendreInterrompues(w.e, () => false, () => true), []);
  const r = await M.reprendreInterrompues(w.e, () => false, () => false);
  assert.equal(r[0].resultat, 'pas faite'); assert.match(String(r[0].raison), /arrêt d'Odin/);
  assert.equal(w.e.find('appli').state.status, 'en marche');
  assert.equal(existsSync(join(dir, 'volumes')), false, 'la copie partielle est effacée');
});
