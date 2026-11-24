// Arche (identifiant interne naglfar), lot K4 (maquette « Conteneurs et machines » validée le 23/11) : le catalogue,
// par les VRAIES actions d'Arche, sur le VRAI moteur rangé dans un dossier jetable — mais AUCUN conteneur lancé,
// AUCUN téléchargement (les images sont déjà « là ») et AUCUNE commande (faux lanceur ; seul « ss » répond, simulé).
// - la liste : ports vérifiés libres (le suivant libre sinon, dit), copies déjà là, aucun secret ;
// - « en un geste » : une confirmation qui dit images, ports, volumes, mémoire ; puis une pile, dans l'ordre ;
// - les ports confirmés pris entre-temps : rien ne part ; une autre copie : un autre nom, un autre port, un autre secret ;
// - propriétaire seul et noté ; Windows : la liste se montre, rien ne se déploie ; supprimer : ses dossiers seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';
import { CATALOGUE } from '../src/valhalla/hringhorni/catalogue.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k4-baux-');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let origine: Record<string, unknown> = {};
before(async () => { A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); origine = { ...A.systemeArche }; });
after(() => { Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const DEJA_LA = ['ghcr.io/immich-app/immich-server:v1.123.0', 'redis:6.2.16-alpine', 'tensorchord/pgvecto-rs:pg14-v0.2.0', 'neosmemo/memos:0.22.5'];
function monde(plateforme = 'linux', rootless = false, ss = '') {
  const home = neuf('arche-k4-'), dir = neuf('arche-k4-moteur-'), cmds: string[] = [], journal: string[] = [], sorties: string[] = [];
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); journal.push(`start ${c.spec.name}`); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
  }
  const aucuneSortie = (async (u: unknown) => { sorties.push(String(u)); throw new Error('essai : aucune sortie réseau'); }) as never;
  const e = new MoteurEssai(dir, { rootless, run: async (cmd, args) => { cmds.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: '', err: '' }; }, fetch: aucuneSortie });
  const img = (n: string, k: number): Image => { const id = String(k).repeat(64); return { id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() }; };
  e.store.saveImages(DEJA_LA.map((n, k) => img(n, k + 1)));
  A.useEngine(() => e as unknown as import('../src/valhalla/modules/naglfar.ts').EngineLike);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison-de-test') });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd: string) => { cmds.push(cmd); return cmd === 'ss' && ss ? { code: 0, out: ss, err: '' } : { code: 1, out: '', err: 'essai : aucune commande' }; },
    fetch: aucuneSortie, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const finJob = async (id: string) => { for (let k = 0; k < 300; k++) { const j = e.jobs().find((x) => x.id === id); if (j?.ended) return j; await new Promise((r) => setTimeout(r, 10)); } throw new Error('installation jamais finie'); };
  return { v, e, home, cmds, journal, sorties, finJob, fin: () => v.stop() };
}
type Appli = { id: string; nom: string; pile: string; pret: boolean; refus: string[]; images: Array<{ nom: string; etiquette: string }>; ports: Array<{ cle: string; voulu: number; hote: number; dedans: number; deplace: boolean }>; deplaces: string[]; volumes: string[]; memoire: number; installees: string[]; alternativeA: string[]; enCours?: { pile: string; pct: number; fini: boolean; erreur?: string } };
type Cat = { moteur: boolean; applis: Appli[] };
const liste = async (w: ReturnType<typeof monde>, o?: Record<string, unknown>) => (await w.v.act('naglfar', 'catalogue', {}, o as never)).data as Cat;
const app = (c: Cat, id: string) => c.applis.find((a) => a.id === id)!;

test('la liste : toutes les applis, images épinglées, ports libres (le suivant libre sinon, et c\'est dit) ; aucun site consulté, aucun secret', async () => {
  // un programme de ce PC écoute déjà 20300 (le port proposé du bloc-notes)
  const w = monde('linux', false, 'LISTEN 0      128          0.0.0.0:20300         0.0.0.0:*\n');
  try {
    // un conteneur à part tient déjà 20100 (celui proposé pour les médias)
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'a-part', ports: '20100:80', network: 'pont' });
    const r = await w.v.act('naglfar', 'catalogue');
    assert.equal(r.ok, true, r.text);
    const c = r.data as Cat;
    assert.equal(c.moteur, true); assert.equal(c.applis.length, CATALOGUE.length);
    for (const a of c.applis) { assert.equal(a.pret, true, `${a.id} : ${a.refus.join(' | ')}`); assert.ok(a.images.every((i) => i.etiquette && i.etiquette !== 'latest'), a.id); }
    // le port qu'Odin garde POUR une appli connue lui reste permis (comme « Lancer une appli »)
    assert.deepEqual(app(c, 'photos').ports.map((p) => [p.hote, p.dedans, p.deplace]), [[20070, 2283, false]]);
    assert.deepEqual(app(c, 'notes').ports.map((p) => [p.voulu, p.hote, p.deplace]), [[20300, 20301, true]]);
    assert.match(app(c, 'notes').deplaces[0], /20300 déjà pris \(un programme de ce PC l'écoute déjà\) → 20301/);
    assert.ok(app(c, 'medias').ports[0].hote > 20100 && app(c, 'medias').ports[0].hote !== 20101 && app(c, 'medias').ports[0].hote !== 20102, 'ni pris, ni gardé pour une autre appli');
    assert.match(app(c, 'medias').deplaces[0], /20100 déjà pris \(a-part\)/);
    assert.deepEqual(app(c, 'photos').volumes, ['photos_bibliotheque', 'photos_base']);
    assert.equal(app(c, 'photos').memoire, (2048 + 256 + 1024) * 1024 ** 2);
    assert.match(r.text, /Galerie de photos · ghcr\.io\/immich-app\/immich-server:v1\.123\.0, redis:6\.2\.16-alpine, tensorchord\/pgvecto-rs:pg14-v0\.2\.0 · port 20070/);
    // aucune sortie réseau, aucune commande sauf « ss » (les ports écoutés de ce PC) ; aucun mot de passe dans la liste
    assert.deepEqual(w.sorties, []); assert.ok(w.cmds.every((x) => x === 'ss'), w.cmds.join(' | '));
    assert.doesNotMatch(JSON.stringify(r.data), /PASSWORD|\{\{secret|[A-Za-z0-9_-]{32}/);
    // une lecture ouverte : un membre la voit aussi
    assert.equal((await w.v.act('naglfar', 'catalogue', {}, { qui: 'member' })).ok, true);
    assert.equal(w.v.action('naglfar', 'catalogue')!.a.read, undefined, 'pas « read » (banc figé de Soul)');
  } finally { w.fin(); }
});

test('en un geste : la confirmation dit images, ports, volumes et mémoire ; puis la pile, dans l\'ordre ; un mot de passe interne masqué', async () => {
  const w = monde();
  try {
    const c = await liste(w), p = app(c, 'photos');
    const input = { app: 'photos', nom: p.pile, ports: p.ports.map((x) => `${x.cle}:${x.hote}`).join(',') };
    const g = String(w.v.action('naglfar', 'deployer_catalogue')!.a.grave!(input));
    assert.match(g, /^déployer « Galerie de photos » \(pile « photos »\) : images ghcr\.io\/immich-app\/immich-server:v1\.123\.0, redis:6\.2\.16-alpine, tensorchord\/pgvecto-rs:pg14-v0\.2\.0 \(tirées de leur registre officiel\)/);
    assert.match(g, /ports ouverts sur ce PC : 20070 \(la galerie\)/);
    assert.match(g, /volumes créés : photos_bibliotheque, photos_base \(gardés si tu la supprimes\)/);
    assert.match(g, /mémoire au plus 3,3 Go/);
    const r = await w.v.act('naglfar', 'deployer_catalogue', input);
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Galerie de photos : déploiement lancé \(pile « photos », base, puis cache, puis serveur\)\. Adresse prévue : port 20070\. Le premier compte créé devient l'administrateur/);
    const j = await w.finJob((r.data as { job: string }).job);
    assert.equal(j.phase, 'fini', j.error);
    assert.deepEqual(w.journal, ['start photos-base', 'start photos-cache', 'start photos-serveur']);
    const srv = w.e.find('photos-serveur'), db = w.e.find('photos-base');
    assert.deepEqual(srv.spec.ports, [{ host: 20070, inner: 2283, proto: 'tcp' }]);
    assert.equal(srv.spec.env.DB_PASSWORD, db.spec.env.POSTGRES_PASSWORD); assert.match(srv.spec.env.DB_PASSWORD, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(srv.spec.mounts.every((m) => m.volume) && db.spec.mounts.every((m) => m.volume));
    assert.equal(srv.spec.memory, '2g'); assert.equal(srv.spec.reseau, 'pile-photos');
    // le fichier de la pile : le mot de passe masqué, même pour le propriétaire
    const f = ((await w.v.act('naglfar', 'fichier_pile', { pile: 'photos' })).data as { fichier: string }).fichier;
    assert.ok(!f.includes(srv.spec.env.DB_PASSWORD)); assert.match(f, /POSTGRES_PASSWORD: ••••••/);
    // la liste dit « déjà installée » et le déploiement fini ; la prochaine copie a un autre nom et un autre port
    const c2 = await liste(w), p2 = app(c2, 'photos');
    assert.deepEqual(p2.installees, ['photos']); assert.equal(p2.enCours?.fini, true); assert.equal(p2.enCours?.pile, 'photos');
    assert.equal(p2.pile, 'photos-2'); assert.equal(p2.ports[0].hote, 20071);
    const r2 = await w.v.act('naglfar', 'deployer_catalogue', { app: 'photos', nom: p2.pile, ports: `web:${p2.ports[0].hote}` });
    assert.equal(r2.ok, true, r2.text); await w.finJob((r2.data as { job: string }).job);
    assert.notEqual(w.e.find('photos-2-serveur').spec.env.DB_PASSWORD, srv.spec.env.DB_PASSWORD, 'chaque copie a son mot de passe');
    assert.deepEqual(app(await liste(w), 'photos').installees, ['photos', 'photos-2']);
    // noté dans « qui a fait quoi », sans aucun secret
    const q = (await w.v.act('naglfar', 'qui_a_fait')).text;
    assert.match(q, /Déployer une appli du catalogue/); assert.ok(!q.includes(srv.spec.env.DB_PASSWORD));
    assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('les ports confirmés pris entre-temps, une appli inconnue, un nom déjà pris : rien ne part, et c\'est dit', async () => {
  const w = monde();
  try {
    const p = app(await liste(w), 'notes');
    assert.equal(p.ports[0].hote, 20300);
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'intrus', ports: '20300:80', network: 'pont' });
    const avant = w.e.ps(true).length;
    const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: p.pile, ports: 'web:20300' });
    assert.equal(r.ok, false); assert.match(r.text, /Les ports ont changé depuis l'affichage du catalogue.*rien n'a été déployé/s); assert.match(r.text, /20300 : déjà pris sur ce PC \(intrus\)/);
    assert.deepEqual([w.e.ps(true).length, w.e.jobs(), w.e.store.volumes(), w.e.store.reseaux(), w.journal], [avant, [], [], [], []]);
    assert.match((await w.v.act('naglfar', 'deployer_catalogue', { app: 'inconnue' })).text, /pas dans le catalogue/);
    assert.match((await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', ports: 'web:99999' })).text, /port invalide/);
    // sans ports confirmés : ceux proposés (ceux que la confirmation a dits), jamais « le suivant libre » choisi après
    // l'accord (relecture K4) : 20300 est pris, rien ne part ; les ports libres de la liste, eux, partent tels quels
    const sans = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes' });
    assert.equal(sans.ok, false); assert.match(sans.text, /Les ports ont changé/);
    const p2 = app(await liste(w), 'notes'); assert.equal(p2.ports[0].hote, 20301);
    const ok = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: p2.pile, ports: `web:${p2.ports[0].hote}` });
    assert.equal(ok.ok, true, ok.text); await w.finJob((ok.data as { job: string }).job);
    assert.deepEqual(w.e.find('notes-serveur').spec.ports, [{ host: 20301, inner: 5230, proto: 'tcp' }]);
    const deux = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: 'notes', ports: 'web:20302' });
    assert.equal(deux.ok, false); assert.match(deux.text, /une pile « notes » existe déjà/);
  } finally { w.fin(); }
});

test('supprimer une appli du catalogue, c\'est supprimer sa pile : volumes gardés par défaut, et seulement ses dossiers à elle', async () => {
  const w = monde();
  try {
    for (const nom of ['notes', 'notes-2']) {
      const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom, ports: `web:${app(await liste(w), 'notes').ports[0].hote}` });
      assert.equal(r.ok, true, r.text); await w.finJob((r.data as { job: string }).job);
    }
    const g = await w.v.act('naglfar', 'supprimer_pile', { pile: 'notes' });
    assert.equal(g.ok, true, g.text); assert.match(g.text, /Volumes gardés : notes_donnees/);
    assert.ok(existsSync(w.e.store.volumeDir('notes_donnees')));
    const x = await w.v.act('naglfar', 'supprimer_pile', { pile: 'notes-2', volumes: 'effacer', nom_tape: 'notes-2' });
    assert.equal(x.ok, true, x.text); assert.match(x.text, /Volumes effacés : notes-2_donnees/);
    assert.equal(existsSync(w.e.store.volumeDir('notes-2_donnees')), false);
    assert.ok(existsSync(w.e.store.volumeDir('notes_donnees')), 'les dossiers d\'une autre copie ne sont jamais touchés');
    assert.deepEqual(app(await liste(w), 'notes').installees, []);
  } finally { w.fin(); }
});

test('propriétaire seul pour déployer (membre, automatisation refusés) ; sans droits d\'administrateur : refusé ; rien n\'est touché', async () => {
  const w = monde();
  try {
    const a = w.v.action('naglfar', 'deployer_catalogue')!.a;
    assert.equal(a.proprietaireSeul, true); assert.ok(a.grave);
    assert.match((await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes' }, { qui: 'member' })).text, /seul le propriétaire/);
    assert.match((await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes' }, { auto: true, by: 'automatisation' })).text, /seul le propriétaire/);
    assert.deepEqual([w.e.ps(true), w.e.jobs(), w.e.store.volumes()], [[], [], []]);
  } finally { w.fin(); }
  const r = monde('linux', true);
  try {
    const x = await r.v.act('naglfar', 'deployer_catalogue', { app: 'notes' });
    assert.equal(x.ok, false); assert.match(x.text, /il faut Odin en administrateur/);
    assert.deepEqual([r.e.ps(true), r.e.jobs()], [[], []]);
  } finally { r.fin(); }
});

test('Windows (aucun moteur aujourd\'hui) : la liste se montre et le dit, rien ne se déploie, le moteur n\'est pas touché', async () => {
  const w = monde('win32');
  try {
    const touche: string[] = [];
    A.useEngine(() => new Proxy({}, { get: (_t, k) => { touche.push(String(k)); throw new Error('le moteur ne doit pas être appelé'); } }) as never);
    const l = await w.v.act('naglfar', 'catalogue');
    assert.equal(l.ok, true); assert.equal((l.data as Cat).moteur, false); assert.equal((l.data as Cat).applis.length, CATALOGUE.length);
    assert.match(l.text, /ne marche que sous Linux.*WSL2/s);
    const d = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes' });
    assert.equal(d.ok, false); assert.match(d.text, /ne marche que sous Linux/);
    assert.deepEqual(touche, []);
  } finally { w.fin(); }
});

// ---- relecture du lot K4 : ce qui part est EXACTEMENT ce que la confirmation a dit ----
test('relecture : sans ports ni nom donnés, la confirmation dit ce qui part (aucun port changé en silence)', async () => {
  // un programme de ce PC écoute déjà 20300 (le port proposé du bloc-notes)
  const w = monde('linux', false, 'LISTEN 0      128          0.0.0.0:20300         0.0.0.0:*\n');
  try {
    const g = String(w.v.action('naglfar', 'deployer_catalogue')!.a.grave!({ app: 'notes' }));
    const ports = [...g.matchAll(/(\d{5}) \(le bloc-notes\)/g)].map((m) => Number(m[1]));
    const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes' });
    if (r.ok !== false) {
      await w.finJob((r.data as { job: string }).job);
      assert.deepEqual(w.e.find('notes-serveur').spec.ports.map((p) => p.host), ports, `confirmé ${ports.join(',')}, déployé autrement`);
    } else assert.match(r.text, /ports ont changé/);
    assert.ok(!w.e.ps(true).some((c) => c.spec.ports.some((p) => !ports.includes(p.host))), 'aucun port qui n\'était pas dans la confirmation');
  } finally { w.fin(); }
});

test('relecture : les volumes laissés par une ancienne copie ne sont jamais repris en silence (mot de passe de la base neuf)', async () => {
  const w = monde();
  try {
    const p = app(await liste(w), 'photos');
    const r = await w.v.act('naglfar', 'deployer_catalogue', { app: 'photos', nom: p.pile, ports: `web:${p.ports[0].hote}` });
    assert.equal(r.ok, true, r.text); await w.finJob((r.data as { job: string }).job);
    assert.equal((await w.v.act('naglfar', 'supprimer_pile', { pile: 'photos' })).ok, true);
    assert.ok(w.e.store.volumes().some((v) => v.nom === 'photos_base'), 'volumes gardés');
    // la liste propose un autre nom (des volumes neufs), jamais « photos » dont la base garde l'ancien mot de passe
    const p2 = app(await liste(w), 'photos');
    assert.equal(p2.pile, 'photos-2');
    // et « photos » forcé : refusé, rien ne part
    const x = await w.v.act('naglfar', 'deployer_catalogue', { app: 'photos', nom: 'photos', ports: `web:${p2.ports[0].hote}` });
    assert.equal(x.ok, false, x.text); assert.match(x.text, /photos_base/);
    assert.equal(w.e.ps(true).length, 0);
  } finally { w.fin(); }
});

test('relecture : deux déploiements en même temps sur le même port, le second refusé', async () => {
  const w = monde();
  try {
    const [a, b] = await Promise.all([
      w.v.act('naglfar', 'deployer_catalogue', { app: 'photos', nom: 'photos', ports: 'web:20070' }),
      w.v.act('naglfar', 'deployer_catalogue', { app: 'photos', nom: 'photos-2', ports: 'web:20070' }),
    ]);
    for (const r of [a, b]) if (r.ok !== false) await w.finJob((r.data as { job: string }).job).catch(() => undefined);
    assert.equal([a, b].filter((r) => r.ok !== false).length, 1, `${a.text}\n---\n${b.text}`);
    assert.ok(w.e.ps(true).filter((c) => c.spec.ports.some((p) => p.host === 20070)).length <= 1);
  } finally { w.fin(); }
});

test('relecture : la mémoire au plus qui dépasse la machine est dite (liste et confirmation)', async () => {
  const w = monde(), memoire = A.systemeArche.memoireMachine;
  try {
    Object.assign(A.systemeArche, { memoireMachine: () => 4 * 1024 ** 3 });
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'gros', memory: '2g', network: 'pont' });
    await w.e.start('gros');
    const p = app(await liste(w), 'photos') as Appli & { avertissements?: string[] };
    assert.match((p.avertissements ?? []).join(' '), /mémoire/);
    assert.equal((app(await liste(w), 'site') as Appli & { avertissements?: string[] }).avertissements?.some((t) => /mémoire/.test(t)) ?? false, false);
    const g = String(w.v.action('naglfar', 'deployer_catalogue')!.a.grave!({ app: 'photos', nom: 'photos', ports: 'web:20070' }));
    assert.match(g, /plus que les 4 Go de cette machine/);
  } finally { Object.assign(A.systemeArche, { memoireMachine: memoire }); w.fin(); }
});

test('relecture : la confirmation dit qu\'une appli est ouverte à tout le réseau de la maison (premier compte, sans compte)', () => {
  const w = monde();
  try {
    const g = (app: string) => String(w.v.action('naglfar', 'deployer_catalogue')!.a.grave!({ app }));
    for (const id of ['photos', 'medias', 'musique', 'livres-audio', 'notes', 'flux', 'surveillance']) assert.match(g(id), /n'importe qui sur le réseau de la maison peut le créer avant toi/, id);
    for (const id of ['accueil', 'pdf', 'site']) assert.match(g(id), /sans mot de passe, ouverte à tout le réseau de la maison/, id);
  } finally { w.fin(); }
});
