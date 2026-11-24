// Arche (identifiant interne naglfar), lot K3 (maquette « Conteneurs et machines » validée le 23/11) : les piles, par
// les VRAIES actions d'Arche, sur le VRAI moteur rangé dans un dossier jetable — mais AUCUN conteneur lancé et AUCUNE
// commande système : démarrer et arrêter ne font que noter l'état, chaque commande passe par un faux lanceur.
// - vérifier un fichier : accepté, changé, refusé ; rien n'est écrit ;
// - déployer : refusé tant qu'une ligne est refusée (rien n'est créé) ; sinon suivi dans « Installations » ;
// - la liste des piles (fichier aux secrets masqués), démarrer, arrêter, supprimer (volumes gardés par défaut ; les
//   effacer : son nom tapé, ses dossiers à elle seulement) ;
// - propriétaire seul pour tout ce qui agit, noté ; Windows : la page le dit, les gestes refusent, le moteur n'est pas touché.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';
import { reserved } from '../src/valhalla/ports.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k3-baux-');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let origine: Record<string, unknown> = {};
before(async () => { A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); origine = { ...A.systemeArche }; });
after(() => { Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const JEUX = `# Composition : plusieurs conteneurs ensemble (une pile)
services:
  monde:
    image: registre.example.org/serveur-jeu:1.21.4
    ports: ["25565:25565"]
    volumes: ["jeu-monde:/monde"]
    environment:
      MEMOIRE: 2G
      MOT_DE_PASSE: "tres-secret-42"
    restart: unless-stopped
  carte:
    image: registre.example.org/carte-web:3.0.2
    ports: ["8123:80"]
    volumes: ["jeu-monde:/monde:ro"]
    depends_on: [monde]
volumes:
  jeu-monde: {}
`;
const MAQUETTE = JEUX.replace('volumes: ["jeu-monde:/monde:ro"]', 'volumes: ["jeu-monde:/monde:ro", "/:/hote"]').replace('depends_on: [monde]', 'depends_on: [monde]\n    privileged: true');

function monde(plateforme = 'linux', rootless = false, ss = '') {
  const home = neuf('arche-k3-'), dir = neuf('arche-k3-moteur-'), cmds: string[] = [], journal: string[] = [];
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); journal.push(`start ${c.spec.name}`); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
  }
  const e = new MoteurEssai(dir, { rootless, run: async (cmd, args) => { cmds.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: '', err: '' }; }, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never });
  const img = (n: string, id: string): Image => ({ id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() });
  e.store.saveImages([img('registre.example.org/serveur-jeu:1.21.4', 'a'.repeat(64)), img('registre.example.org/carte-web:3.0.2', 'b'.repeat(64))]);
  A.useEngine(() => e as unknown as import('../src/valhalla/modules/naglfar.ts').EngineLike);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison-de-test') });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd: string) => (cmd === 'ss' && ss ? { code: 0, out: ss, err: '' } : { code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const finJob = async (id: string) => { for (let k = 0; k < 200; k++) { const j = e.jobs().find((x) => x.id === id); if (j?.ended) return j; await new Promise((r) => setTimeout(r, 10)); } throw new Error('installation jamais finie'); };
  return { v, e, home, cmds, journal, finJob, fin: () => v.stop() };
}
type Vue = { ok: boolean; nom: string; ordre: string[]; constats: Array<{ ton: string; quoi: string; texte: string }>; refus: string[]; services: Array<{ service: string; variables: string[] }> };
type Piles = { moteur: boolean; piles: Array<{ nom: string; etat: string; enMarche: number; total: number; ordre: string[]; services: Array<{ conteneur: string; etat: string }>; volumes: string[]; volumesPropres: string[]; fichier: string }> };

test('vérifier : le fichier de la maquette — accepté, changé, refusé (privileged, disque entier) ; rien n\'est écrit', async () => {
  const w = monde();
  try {
    const r = await w.v.act('naglfar', 'verifier_pile', { compose: MAQUETTE, nom: 'serveur-de-jeux' });
    assert.equal(r.ok, true, r.text);
    const d = r.data as Vue;
    assert.equal(d.ok, false); assert.deepEqual(d.ordre, ['monde', 'carte']);
    assert.match(r.text, /✓ 2 conteneurs : monde, puis carte \(attend monde\)/);
    assert.match(r.text, /✗ carte · volumes · « \/:\/hote » : le disque entier du PC n'est jamais monté/);
    assert.match(r.text, /✗ carte · privileged: true : un conteneur n'a jamais tous les droits sur le PC/);
    assert.match(r.text, /! carte · mémoire : pas de limite de mémoire : Odin met 512 Mo/);
    // jamais la valeur d'une variable, seulement son nom
    assert.deepEqual(d.services[0].variables, ['MEMOIRE', 'MOT_DE_PASSE']);
    assert.doesNotMatch(JSON.stringify(r.data), /tres-secret-42/);
    assert.deepEqual(w.e.store.volumes(), []); assert.deepEqual(w.e.store.reseaux(), []); assert.deepEqual(w.e.ps(true), []);
    // un port déjà pris par un conteneur, ou gardé par Odin : refusé
    await w.e.create({ image: 'registre.example.org/carte-web:3.0.2', name: 'galerie', ports: '8123:80', network: 'pont' });
    const r2 = (await w.v.act('naglfar', 'verifier_pile', { compose: JEUX, nom: 'jeux' })).data as Vue;
    assert.match(r2.refus.join('\n'), /8123 : déjà pris sur ce PC \(galerie\)/);
    const garde = [...reserved()].find((p) => p !== 8123 && p !== 25565)!;
    const r3 = (await w.v.act('naglfar', 'verifier_pile', { compose: JEUX.replace('"25565:25565"', `"${garde}:80"`), nom: 'jeux' })).data as Vue;
    assert.ok(r3.refus.some((x) => x.includes(`${garde} : déjà pris sur ce PC (gardé par Odin)`)), r3.refus.join('\n'));
    // le dossier d'Odin et la maison de la personne : refusés, même écrits en entier
    const r4 = (await w.v.act('naglfar', 'verifier_pile', { compose: JEUX.replace('"jeu-monde:/monde:ro"', `"${w.home.replace(/\\/g, '/')}/x:/o"`), nom: 'jeux' })).data as Vue;
    assert.equal(r4.ok, false);
  } finally { w.fin(); }
});

test('déployer : refusé tant qu\'une ligne est refusée — rien n\'est créé ni lancé', async () => {
  const w = monde();
  try {
    const r = await w.v.act('naglfar', 'deployer_pile', { compose: MAQUETTE, nom: 'serveur-de-jeux' });
    assert.equal(r.ok, false);
    assert.match(r.text, /Rien n'est déployé tant qu'une ligne est refusée : 2 ligne\(s\)/);
    assert.deepEqual([w.e.store.volumes(), w.e.store.reseaux(), w.e.ps(true), w.e.jobs(), w.journal], [[], [], [], [], []]);
    // un cycle, une bombe de YAML : pareil
    for (const f of ['services:\n  a:\n    image: x\n    depends_on: [b]\n  b:\n    image: y\n    depends_on: [a]\n', 'a: &a [x, x]\nb: [*a, *a]\n']) {
      const x = await w.v.act('naglfar', 'deployer_pile', { compose: f, nom: 'p' });
      assert.equal(x.ok, false, f);
    }
    assert.deepEqual(w.e.jobs(), []);
    // la confirmation d'Odin dit ce qui va partir et ce qui s'ouvre
    const g = String(w.v.action('naglfar', 'deployer_pile')!.a.grave!({ compose: JEUX, nom: 'jeux' }));
    assert.match(g, /déployer la pile « jeux » : 2 conteneur\(s\) \(registre\.example\.org\/serveur-jeu:1\.21\.4, registre\.example\.org\/carte-web:3\.0\.2\), ports ouverts : 25565, 8123/);
  } finally { w.fin(); }
});

test('déployer, lister, arrêter, démarrer : dans l\'ordre ; le fichier montré a ses secrets masqués ; tout est noté', async () => {
  const w = monde();
  try {
    const r = await w.v.act('naglfar', 'deployer_pile', { compose: JEUX, nom: 'serveur-de-jeux' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Déploiement de la pile « serveur-de-jeux » lancé : monde, puis carte/);
    const j = await w.finJob((r.data as { job: string }).job);
    assert.equal(j.phase, 'fini', j.error); assert.match(j.note, /pile serveur-de-jeux en marche \(monde, puis carte\)/);
    assert.deepEqual(w.journal, ['start serveur-de-jeux-monde', 'start serveur-de-jeux-carte']);
    const l = (await w.v.act('naglfar', 'piles')).data as Piles;
    assert.equal(l.moteur, true);
    const p = l.piles[0];
    assert.deepEqual([p.nom, p.etat, p.enMarche, p.total, p.ordre, p.volumes, p.volumesPropres], ['serveur-de-jeux', 'en marche', 2, 2, ['monde', 'carte'], ['serveur-de-jeux_jeu-monde'], ['serveur-de-jeux_jeu-monde']]);
    assert.deepEqual(p.services.map((x) => [x.conteneur, x.etat]), [['serveur-de-jeux-monde', 'en marche'], ['serveur-de-jeux-carte', 'en marche']]);
    // la liste est ouverte (un membre la voit) mais ne porte pas le fichier ; le fichier : au propriétaire seul, masqué
    assert.equal(p.fichier, undefined);
    const m = await w.v.act('naglfar', 'piles', {}, { qui: 'member' }); assert.equal(m.ok, true); assert.doesNotMatch(JSON.stringify(m), /tres-secret|MOT_DE_PASSE/);
    const f = ((await w.v.act('naglfar', 'fichier_pile', { pile: 'serveur-de-jeux' })).data as { fichier: string }).fichier;
    assert.doesNotMatch(f, /tres-secret-42/); assert.match(f, /MOT_DE_PASSE: ••••••/); assert.match(f, /MEMOIRE: 2G/);
    for (const o of [{ qui: 'member' as const }, { auto: true, by: 'automatisation' as never }]) assert.match((await w.v.act('naglfar', 'fichier_pile', { pile: 'serveur-de-jeux' }, o)).text, /seul le propriétaire/);
    // le tableau de bord : combien de piles, et la pile de chaque conteneur
    const t = (await w.v.act('naglfar', 'tableau')).data as { piles: number; conteneurs: Array<{ nom: string; pile?: string }> };
    assert.equal(t.piles, 1); assert.deepEqual(t.conteneurs.map((c) => c.pile).sort(), ['serveur-de-jeux', 'serveur-de-jeux']);
    w.journal.length = 0;
    const a = await w.v.act('naglfar', 'arreter_pile', { pile: 'serveur-de-jeux' });
    assert.equal(a.ok, true, a.text); assert.match(a.text, /serveur-de-jeux-carte, puis serveur-de-jeux-monde arrêté/);
    assert.equal(((await w.v.act('naglfar', 'piles')).data as Piles).piles[0].etat, 'arrêtée');
    const d = await w.v.act('naglfar', 'demarrer_pile', { pile: 'serveur-de-jeux' });
    assert.equal(d.ok, true, d.text);
    assert.deepEqual(w.journal, ['stop serveur-de-jeux-carte', 'stop serveur-de-jeux-monde', 'start serveur-de-jeux-monde', 'start serveur-de-jeux-carte']);
    const q = (await w.v.act('naglfar', 'qui_a_fait')).text;
    for (const x of ['Déployer une pile', 'Arrêter une pile', 'Démarrer une pile']) assert.match(q, new RegExp(x), x);
    // la confirmation d'un arrêt dit ce que ça coupe
    assert.match(String(w.v.action('naglfar', 'arreter_pile')!.a.grave!({ pile: 'serveur-de-jeux' })), /ne répond plus/);
  } finally { w.fin(); }
});

test('supprimer une pile : volumes gardés par défaut ; les effacer exige son nom tapé ; seuls ses dossiers à elle partent', async () => {
  const w = monde();
  try {
    w.e.createVolume('monde-partage'); writeFileSync(join(w.e.store.volumeData('monde-partage'), 'f'), 'à moi');
    const f = `${JEUX.replace('volumes: ["jeu-monde:/monde"]', 'volumes: ["jeu-monde:/monde", "partage:/partage"]')}  partage:\n    external: true\n    name: monde-partage\n`;
    for (const nom of ['jeux', 'jeux2']) {
      const r = await w.v.act('naglfar', 'deployer_pile', { compose: f, nom });
      assert.equal(r.ok, true, r.text); await w.finJob((r.data as { job: string }).job);
      writeFileSync(join(w.e.store.volumeData(`${nom}_jeu-monde`), 'monde.dat'), 'le monde');
      if (nom === 'jeux') {
        // un nom mal tapé : rien n'est touché
        for (const nom_tape of ['', 'Jeux', 'jeu']) {
          const x = await w.v.act('naglfar', 'supprimer_pile', { pile: nom, volumes: 'effacer', nom_tape });
          assert.equal(x.ok, false); assert.match(x.text, /écris le nom exact de la pile .*rien n'a été supprimé/);
        }
        assert.equal(w.e.ps(true).length, 2);
        const g = await w.v.act('naglfar', 'supprimer_pile', { pile: nom });
        assert.equal(g.ok, true, g.text); assert.match(g.text, /Pile « jeux » supprimée : jeux-carte, jeux-monde/); assert.match(g.text, /Volumes gardés : jeux_jeu-monde, monde-partage\./);
        assert.ok(existsSync(join(w.e.store.volumeData('jeux_jeu-monde'), 'monde.dat')));
      } else {
        const x = await w.v.act('naglfar', 'supprimer_pile', { pile: nom, volumes: 'effacer', nom_tape: nom });
        assert.equal(x.ok, true, x.text);
        assert.match(x.text, /Volumes effacés : jeux2_jeu-monde\./); assert.match(x.text, /Volumes gardés : monde-partage \(il était là avant la pile\)/);
        assert.equal(existsSync(w.e.store.volumeDir('jeux2_jeu-monde')), false);
      }
    }
    assert.ok(existsSync(join(w.e.store.volumeData('monde-partage'), 'f')));
    assert.deepEqual(w.e.ps(true), []); assert.deepEqual(((await w.v.act('naglfar', 'piles')).data as Piles).piles, []);
    assert.match(String(w.v.action('naglfar', 'supprimer_pile')!.a.grave!({ pile: 'jeux', volumes: 'effacer' })), /ne pourront pas revenir/);
  } finally { w.fin(); }
});

test('propriétaire seul : membre et automatisation refusés pour tout ce qui agit (et pour vérifier) ; rien n\'est touché', async () => {
  const w = monde();
  try {
    const gestes: Array<[string, Record<string, unknown>]> = [['fichier_pile', { pile: 'jeux' }], ['verifier_pile', { compose: JEUX, nom: 'jeux' }], ['deployer_pile', { compose: JEUX, nom: 'jeux' }], ['demarrer_pile', { pile: 'jeux' }], ['arreter_pile', { pile: 'jeux' }], ['supprimer_pile', { pile: 'jeux' }]];
    for (const [id] of gestes) assert.equal(w.v.action('naglfar', id)?.a.proprietaireSeul, true, id);
    const lecture = w.v.action('naglfar', 'piles')!.a; assert.equal(lecture.proprietaireSeul, undefined); assert.equal(lecture.read, undefined, 'pas « read » (banc figé de Soul)');
    for (const [id, input] of gestes) {
      assert.match((await w.v.act('naglfar', id, input, { qui: 'member' })).text, /seul le propriétaire/, `${id} : un membre`);
      assert.match((await w.v.act('naglfar', id, input, { auto: true, by: 'automatisation' })).text, /seul le propriétaire/, `${id} : une automatisation`);
    }
    assert.deepEqual([w.e.ps(true), w.e.jobs(), w.e.store.volumes(), w.e.store.reseaux(), w.cmds], [[], [], [], [], []]);
  } finally { w.fin(); }
});

test('Odin sans droits d\'administrateur : une pile est refusée (elle a besoin d\'un réseau à part)', async () => {
  const w = monde('linux', true);
  try {
    const r = await w.v.act('naglfar', 'deployer_pile', { compose: JEUX, nom: 'jeux' });
    assert.equal(r.ok, false); assert.match(r.text, /il faut Odin en administrateur/);
    assert.deepEqual([w.e.ps(true), w.e.jobs()], [[], []]);
  } finally { w.fin(); }
});

test('Windows (aucun moteur aujourd\'hui) : la liste le dit, les gestes refusent, le moteur n\'est pas touché', async () => {
  const w = monde('win32');
  try {
    const touche: string[] = [];
    A.useEngine(() => new Proxy({}, { get: (_t, k) => { touche.push(String(k)); throw new Error('le moteur ne doit pas être appelé'); } }) as never);
    const l = await w.v.act('naglfar', 'piles'); assert.equal(l.ok, true); assert.equal((l.data as Piles).moteur, false); assert.match(l.text, /ne marche que sous Linux.*WSL2/s);
    for (const [id, input] of [['deployer_pile', { compose: JEUX, nom: 'jeux' }], ['demarrer_pile', { pile: 'jeux' }], ['arreter_pile', { pile: 'jeux' }], ['supprimer_pile', { pile: 'jeux' }]] as const) {
      const r = await w.v.act('naglfar', id, input as Record<string, unknown>); assert.equal(r.ok, false, id); assert.match(r.text, /ne marche que sous Linux/, id);
    }
    // vérifier un fichier reste possible (rien n'est lancé) : la page pourra le montrer avec le moteur
    const v = await w.v.act('naglfar', 'verifier_pile', { compose: MAQUETTE, nom: 'jeux' });
    assert.equal(v.ok, true); assert.equal((v.data as { moteur: boolean }).moteur, false);
    assert.deepEqual(touche, []);
  } finally { w.fin(); }
});

// ------------------------------------------------------------------ relecture (contournements trouvés, corrigés)
test('relecture : un port qu\'un programme de ce PC écoute déjà (ssh…) est refusé, il n\'est plus dit « libre »', async () => {
  const w = monde('linux', false, 'LISTEN 0      128          0.0.0.0:22         0.0.0.0:*\nLISTEN 0      511        127.0.0.1:6379       0.0.0.0:*\n');
  try {
    const f = 'services:\n  a:\n    image: registre.example.org/carte-web:3.0.2\n    ports: ["22:22", "6379:6379", "8125:80"]\n';
    const r = (await w.v.act('naglfar', 'verifier_pile', { compose: f, nom: 'essai' })).data as Vue;
    assert.equal(r.ok, false);
    assert.match(r.refus.join('\n'), /ports · 22 : déjà pris sur ce PC \(un programme de ce PC l'écoute déjà\)/);
    assert.match(r.refus.join('\n'), /ports · 6379 : déjà pris/);
    assert.doesNotMatch(r.refus.join('\n'), /8125/);
  } finally { w.fin(); }
});

test('relecture : le fichier montré — une longue ligne ne bloque pas Odin ; mots de passe d\'une commande et « _PW » masqués', () => {
  const t0 = Date.now();
  A.masquerFichier(Array.from({ length: 16 }, (_x, k) => `x-a${k}: ${'pass.'.repeat(800)}`).join('\n'));
  assert.ok(Date.now() - t0 < 1500, `trop lent : ${Date.now() - t0} ms`);
  const f = A.masquerFichier('services:\n  a:\n    image: redis\n    command: redis-server --requirepass s3cretRedis --port 6379\n    entrypoint: ["app", "--password=autreSecret"]\n    environment:\n      JETON_BOT: abcd1234jeton\n      ADMIN_PW: hunter2hunter\n      MEMOIRE: 2G\n');
  // (« JETON_BOT », première variable sous « environment: », restait en clair : la ligne du dessus la prenait)
  for (const x of ['s3cretRedis', 'autreSecret', 'hunter2hunter', 'abcd1234jeton']) assert.doesNotMatch(f, new RegExp(x));
  assert.match(f, /--port 6379/); assert.match(f, /MEMOIRE: 2G/);
});
