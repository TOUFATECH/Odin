// Arche (identifiant interne naglfar), lot K2 (maquette « Arche et Hydre » validée le 23/11) : les volumes et les réseaux,
// par les VRAIES actions d'Arche, sur le VRAI moteur rangé dans un dossier jetable — mais AUCUN conteneur lancé et
// AUCUNE commande réseau : chaque commande passe par un faux lanceur. Phénix (la sauvegarde) est le vrai : son plan
// « Volumes d'Arche » est écrit dans l'Odin jetable de l'essai, ses sauvegardes dans un dossier jetable.
// - volumes : liste (taille, qui s'en sert, sans conteneur, sauvegardé) ; supprimer seulement avec le nom tapé, seulement
//   s'il ne sert plus, jamais un dossier du système, personnel ou d'Odin ;
// - sauvegarde par Phénix : cocher / décocher refait le plan ; le dernier ne se décoche pas (Phénix ne sait pas retirer un plan) ;
// - réseaux : liste (tous, à part, aucun), créer, retirer seulement sans conteneur ;
// - propriétaire seul pour tout ce qui agit, noté dans « qui a fait quoi » ; Windows : la page le dit, rien n'est touché.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Spec } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k2-baux-');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let origine: Record<string, unknown> = {};
// Phénix chiffre ses sauvegardes : un mot de passe d'essai, rendu à la fin.
const motAvant = process.env.SINDRI_PASSWORD;
process.env.SINDRI_PASSWORD = 'essai-k2-mot-de-passe-jetable';
before(async () => { A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); origine = { ...A.systemeArche }; });
after(() => { if (motAvant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = motAvant; Object.assign(A.systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

function monde(plateforme = 'linux') {
  const home = neuf('arche-k2-'), dir = neuf('arche-k2-moteur-'), cmds: string[] = [];
  const e = new H.Engine(dir, { rootless: false, run: async (cmd, args) => { cmds.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: '', err: '' }; }, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never });
  A.useEngine(() => e as unknown as import('../src/valhalla/modules/naglfar.ts').EngineLike);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison-de-test') });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  // Les sauvegardes des volumes vont dans un dossier jetable (jamais celui de l'Odin de la personne).
  v.ctx('naglfar').saveSettings({ depotVolumes: join(neuf('arche-k2-depot-'), 'volumes') });
  const poser = (nom: string, o: Partial<Spec> = {}) => { const id = `${nom.replace(/[^a-f0-9]/g, 'a').padEnd(12, 'b')}${'c'.repeat(52)}`.slice(0, 64); e.store.saveSpec({ id, name: nom, image: 'r.example.org/a:1', imageId: 'i', cmd: ['/a'], env: {}, workdir: '/', user: '', ports: [], mounts: [], restart: 'non', hostname: nom, network: 'pont', autoRemove: false, created: new Date().toISOString(), labels: {}, ...o }); e.store.saveState(id, { status: 'arrêté' }); };
  return { v, e, home, cmds, poser, fin: () => v.stop() };
}
type Vols = { moteur: boolean; plan: string; phenix: boolean; derniere?: string; volumes: Array<{ nom: string; octets: number; utilisePar: string[]; sansConteneur: boolean; sauvegarde: boolean; jamaisSauvegarde: boolean }> };
type Res = { moteur: boolean; reseaux: Array<{ nom: string; genre: string; sousReseau?: string; internet: boolean; isole: boolean; conteneurs: string[] }> };
const plansPhenix = (w: ReturnType<typeof monde>) => ((w.v.ctx('sindri').settings.plans as Array<{ name: string; paths: string[]; at: string }> | undefined) ?? []).filter((p) => p.name === 'Volumes d\'Arche');

test('volumes : taille, qui s\'en sert (même arrêté), sans conteneur, sauvegardé ou non', async () => {
  const w = monde();
  try {
    w.e.createVolume('photos-donnees'); w.e.createVolume('ancien-essai');
    writeFileSync(join(w.e.store.volumeData('photos-donnees'), 'p.jpg'), 'x'.repeat(2048));
    w.poser('galerie-photos', { mounts: [{ host: w.e.store.volumeData('photos-donnees'), inner: '/photos', ro: false, volume: 'photos-donnees' }] });
    const r = await w.v.act('naglfar', 'volumes');
    assert.equal(r.ok, true, r.text);
    const d = r.data as Vols;
    assert.equal(d.moteur, true); assert.equal(d.plan, 'Volumes d\'Arche'); assert.equal(d.phenix, true);
    assert.deepEqual(d.volumes.map((x) => [x.nom, x.octets, x.utilisePar, x.sansConteneur, x.sauvegarde, x.jamaisSauvegarde]),
      [['ancien-essai', 0, [], true, false, true], ['photos-donnees', 2048, ['galerie-photos'], false, false, true]]);
    // une lecture : ouverte à un membre aussi (rien n'y est secret)
    assert.equal((await w.v.act('naglfar', 'volumes', {}, { qui: 'member' })).ok, true);
  } finally { w.fin(); }
});

test('supprimer un volume : le nom tapé d\'abord ; jamais s\'il sert ; sinon il part avec ses données, et c\'est noté', async () => {
  const w = monde();
  try {
    w.e.createVolume('ancien-essai'); w.e.createVolume('jeu-monde');
    writeFileSync(join(w.e.store.volumeData('ancien-essai'), 'f'), 'données');
    w.poser('jeu', { mounts: [{ host: w.e.store.volumeData('jeu-monde'), inner: '/m', ro: false, volume: 'jeu-monde' }] });
    for (const nom_tape of ['', 'Ancien-essai', 'ancien', 'ancien-essai2']) {
      const r = await w.v.act('naglfar', 'supprimer_volume', { volume: 'ancien-essai', nom_tape });
      assert.equal(r.ok, false); assert.match(r.text, /écris son nom exact .*rien n'a été supprimé/, nom_tape);
    }
    assert.ok(existsSync(join(w.e.store.volumeData('ancien-essai'), 'f')), 'rien n\'est touché sans le nom');
    const u = await w.v.act('naglfar', 'supprimer_volume', { volume: 'jeu-monde', nom_tape: 'jeu-monde' });
    assert.equal(u.ok, false); assert.match(u.text, /sert encore à : jeu/);
    assert.ok(existsSync(w.e.store.volumeData('jeu-monde')));
    const ok = await w.v.act('naglfar', 'supprimer_volume', { volume: 'ancien-essai', nom_tape: 'ancien-essai' });
    assert.equal(ok.ok, true, ok.text);
    assert.equal(existsSync(w.e.store.volumeDir('ancien-essai')), false);
    const j = await w.v.act('naglfar', 'qui_a_fait');
    assert.match(j.text, /Supprimer un volume/);
    // la confirmation d'Odin dit bien que les données ne reviennent pas
    assert.match(String(w.v.action('naglfar', 'supprimer_volume')!.a.grave!({ volume: 'x' })), /ne pourront pas revenir/);
  } finally { w.fin(); }
});

test('supprimer un conteneur, même « avec ses données » : son volume reste (il se supprime dans Volumes)', async () => {
  const w = monde();
  try {
    w.e.createVolume('wiki-pages'); writeFileSync(join(w.e.store.volumeData('wiki-pages'), 'page'), 'à garder');
    w.poser('notes-wiki', { mounts: [{ host: w.e.store.volumeData('wiki-pages'), inner: '/pages', ro: false, volume: 'wiki-pages' }] });
    const f = (await w.v.act('naglfar', 'fiche', { conteneur: 'notes-wiki' })).data as { dossiers: Array<{ hote: string }>; donnees: Array<{ dossier: string; effacable: boolean }> };
    assert.deepEqual(f.dossiers.map((x) => x.hote), ['volume wiki-pages']);
    assert.deepEqual(f.donnees.map((x) => [x.dossier, x.effacable]), [['volume wiki-pages', false]]);
    const r = await w.v.act('naglfar', 'supprimer_fiche', { conteneur: 'notes-wiki', donnees: 'effacer', nom_tape: 'notes-wiki' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Données gardées : volume wiki-pages/);
    assert.ok(existsSync(join(w.e.store.volumeData('wiki-pages'), 'page')), 'le volume est intact');
    assert.deepEqual(((await w.v.act('naglfar', 'volumes')).data as Vols).volumes.map((x) => [x.nom, x.sansConteneur]), [['wiki-pages', true]]);
  } finally { w.fin(); }
});

test('la garde des volumes : jamais un dossier du système, personnel, d\'Odin, ni trop près de la racine', () => {
  const w = monde();
  try {
    const g = (p: string) => A.pourquoiGarderVolume(p, w.home);
    assert.equal(g(w.e.store.volumeDir('x')), undefined, 'un volume rangé par le moteur peut partir');
    assert.match(g('/etc/odin/x') ?? '', /système/);
    assert.match(g('/usr/lib/x') ?? '', /système/);
    assert.match(g('/srv/Windows/System32') ?? '', /système/);
    assert.match(g('/x') ?? '', /racine/);
    assert.match(g(join(w.home, 'maison-de-test', 'volumes')) ?? '', /personnel/);
    assert.match(g('/srv/moi/Documents/volumes/x') ?? '', /personnel/);
    assert.match(g(join(w.home, 'odin', 'x')) ?? '', /Odin/);
    // la fiche du volume compte aussi : ses données sont le dossier qu'on voit, rien d'autre
    assert.equal(g('/var/lib/odin/hringhorni/volumes/x'), undefined, 'le dossier du moteur en administrateur');
  } finally { w.fin(); }
});

test('sauvegarde par Phénix : cocher refait le plan « Volumes d\'Arche » ; décocher aussi ; le dernier ne se décoche pas', async () => {
  const w = monde();
  try {
    w.e.createVolume('photos-donnees'); w.e.createVolume('wiki-pages');
    const r1 = await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'photos-donnees', sauver: 'oui' });
    assert.equal(r1.ok, true, r1.text); assert.match(r1.text, /sauvegardé chaque nuit par Phénix/);
    assert.deepEqual(plansPhenix(w).map((p) => [p.paths, p.at]), [[[w.e.store.volumeData('photos-donnees')], '02:15']]);
    await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'wiki-pages', sauver: 'oui' });
    assert.deepEqual(plansPhenix(w)[0].paths.sort(), [w.e.store.volumeData('photos-donnees'), w.e.store.volumeData('wiki-pages')].sort());
    const v = (await w.v.act('naglfar', 'volumes')).data as Vols;
    assert.deepEqual(v.volumes.map((x) => [x.nom, x.sauvegarde]), [['photos-donnees', true], ['wiki-pages', true]]);
    assert.ok(v.volumes.every((x) => x.jamaisSauvegarde), 'aucune sauvegarde faite encore : « jamais »');
    const r2 = await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'photos-donnees', sauver: 'non' });
    assert.equal(r2.ok, true, r2.text);
    assert.deepEqual(plansPhenix(w)[0].paths, [w.e.store.volumeData('wiki-pages')]);
    const r3 = await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'wiki-pages', sauver: 'non' });
    assert.equal(r3.ok, false); assert.match(r3.text, /Phénix ne sait pas encore retirer un plan/);
    assert.deepEqual(plansPhenix(w)[0].paths, [w.e.store.volumeData('wiki-pages')], 'le plan est resté tel quel');
    assert.match((await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'inconnu', sauver: 'oui' })).text, /volume inconnu/);
    // Supprimer un volume sauvegardé avec d'autres : le plan est refait sans lui.
    await w.v.act('naglfar', 'sauvegarde_volume', { volume: 'photos-donnees', sauver: 'oui' });
    const s = await w.v.act('naglfar', 'supprimer_volume', { volume: 'photos-donnees', nom_tape: 'photos-donnees' });
    assert.equal(s.ok, true, s.text); assert.match(s.text, /Phénix ne le sauvegarde plus/);
    assert.deepEqual(plansPhenix(w)[0].paths, [w.e.store.volumeData('wiki-pages')]);
  } finally { w.fin(); }
});

test('réseaux : celui de tous, les réseaux à part, « aucun » ; créer ; retirer seulement sans conteneur', async () => {
  const w = monde();
  try {
    const c = await w.v.act('naglfar', 'creer_reseau', { nom: 'serveur-de-jeux', internet: 'oui' });
    assert.equal(c.ok, true, c.text); assert.match(c.text, /10\.89\.1\.0\/24/);
    await w.v.act('naglfar', 'creer_reseau', { nom: 'cage', internet: 'non' });
    assert.match((await w.v.act('naglfar', 'creer_reseau', { nom: 'aucun' })).text, /nom gardé/);
    w.poser('jeu-monde', { reseau: 'serveur-de-jeux' }); w.poser('web'); w.poser('isole', { network: 'aucun' });
    const r = (await w.v.act('naglfar', 'reseaux')).data as Res;
    assert.deepEqual(r.reseaux.map((x) => [x.nom, x.genre, x.sousReseau ?? '', x.internet, x.isole, x.conteneurs]), [
      ['conteneurs', 'tous', '10.89.0.0/24', true, false, ['web']],
      ['serveur-de-jeux', 'a-part', '10.89.1.0/24', true, true, ['jeu-monde']],
      ['cage', 'a-part', '10.89.2.0/24', false, true, []],
      ['aucun', 'aucun', '', false, true, ['isole']],
    ]);
    assert.match((await w.v.act('naglfar', 'supprimer_reseau', { reseau: 'serveur-de-jeux' })).text, /sert encore à : jeu-monde/);
    const s = await w.v.act('naglfar', 'supprimer_reseau', { reseau: 'cage' });
    assert.equal(s.ok, true, s.text);
    assert.ok(w.cmds.includes('ip link del odin2') && w.cmds.includes('nft delete table ip odin2'), w.cmds.join('\n'));
    assert.deepEqual(((await w.v.act('naglfar', 'reseaux')).data as Res).reseaux.map((x) => x.nom), ['conteneurs', 'serveur-de-jeux', 'aucun']);
  } finally { w.fin(); }
});

test('propriétaire seul : membre et automatisation refusés pour tout ce qui agit ; rien n\'est touché ; lectures ouvertes', async () => {
  const w = monde();
  try {
    w.e.createVolume('ancien-essai'); w.e.createReseau('cage');
    const gestes: Array<[string, Record<string, unknown>]> = [['creer_volume', { nom: 'nouveau' }], ['supprimer_volume', { volume: 'ancien-essai', nom_tape: 'ancien-essai' }], ['sauvegarde_volume', { volume: 'ancien-essai', sauver: 'oui' }], ['creer_reseau', { nom: 'autre' }], ['supprimer_reseau', { reseau: 'cage' }]];
    for (const [id] of gestes) assert.equal(w.v.action('naglfar', id)?.a.proprietaireSeul, true, id);
    for (const id of ['volumes', 'reseaux']) { const a = w.v.action('naglfar', id)!.a; assert.equal(a.proprietaireSeul, undefined, id); assert.equal(a.grave, undefined, id); assert.equal(a.read, undefined, `${id} : pas « read » (banc figé de Soul)`); }
    for (const [id, input] of gestes) {
      assert.match((await w.v.act('naglfar', id, input, { qui: 'member' })).text, /seul le propriétaire/, `${id} : un membre`);
      assert.match((await w.v.act('naglfar', id, input, { auto: true, by: 'automatisation' })).text, /seul le propriétaire/, `${id} : une automatisation`);
    }
    assert.deepEqual(w.e.store.volumes().map((x) => x.nom), ['ancien-essai']); assert.deepEqual(w.e.store.reseaux().map((x) => x.nom), ['cage']);
    assert.deepEqual(plansPhenix(w), []); assert.deepEqual(w.cmds, []);
    // le propriétaire, lui, crée : c'est noté
    assert.equal((await w.v.act('naglfar', 'creer_volume', { nom: 'nouveau' })).ok, true);
    assert.match((await w.v.act('naglfar', 'qui_a_fait')).text, /Créer un volume/);
  } finally { w.fin(); }
});

test('Windows (aucun moteur aujourd\'hui) : volumes et réseaux le disent ; les gestes refusent ; le moteur n\'est pas touché', async () => {
  const w = monde('win32');
  try {
    const touche: string[] = [];
    A.useEngine(() => new Proxy({}, { get: (_t, k) => { touche.push(String(k)); throw new Error('le moteur ne doit pas être appelé'); } }) as never);
    for (const id of ['volumes', 'reseaux']) { const r = await w.v.act('naglfar', id); assert.equal(r.ok, true, r.text); assert.equal((r.data as { moteur: boolean }).moteur, false); assert.match(r.text, /ne marche que sous Linux.*WSL2/s); }
    for (const [id, input] of [['creer_volume', { nom: 'a' }], ['supprimer_volume', { volume: 'a', nom_tape: 'a' }], ['sauvegarde_volume', { volume: 'a' }], ['creer_reseau', { nom: 'a' }], ['supprimer_reseau', { reseau: 'a' }]] as const) {
      const r = await w.v.act('naglfar', id, input as Record<string, unknown>); assert.equal(r.ok, false, id); assert.match(r.text, /ne marche que sous Linux/, id);
    }
    assert.deepEqual(touche, []);
  } finally { w.fin(); }
});

// ---- Relecture du lot K2 : chaque trou trouvé a son essai, qui échouait avant la correction ----
test('relecture : sans plan « Volumes d\'Arche », la date d\'un AUTRE plan de Phénix n\'est jamais montrée comme celle des volumes', async () => {
  const w = monde();
  try {
    const src = neuf('arche-k2-autre-'); writeFileSync(join(src, 'f.txt'), 'x');
    const c = await w.v.act('sindri', 'creer', { nom: 'Autre', dossiers: src, destination: 'disque', depot: join(neuf('arche-k2-depot2-'), 'd'), heure: '03:00' });
    assert.equal(c.ok, true, c.text);
    const s = await w.v.act('sindri', 'sauvegarder', { plan: 'Autre' });
    assert.equal(s.ok, true, s.text);
    assert.ok(((await w.v.act('sindri', 'instantanes', { plan: 'Volumes d\'Arche' })).data as unknown[] | undefined)?.length, 'Phénix rend bien un autre plan quand le nom manque');
    w.e.createVolume('vieux');
    const v = (await w.v.act('naglfar', 'volumes')).data as Vols;
    assert.equal(v.phenix, true); assert.equal(v.derniere, undefined, 'aucune sauvegarde des volumes : « jamais »');
    assert.equal(v.volumes[0].jamaisSauvegarde, true);
  } finally { w.fin(); }
});

test('relecture : un volume nommé « photos » ou « documents » peut être supprimé (la garde regarde où il est rangé, pas son nom)', () => {
  const w = monde();
  try {
    for (const n of ['photos', 'documents', 'music']) assert.equal(A.pourquoiGarderVolume(w.e.store.volumeDir(n), w.home), undefined, n);
    assert.match(A.pourquoiGarderVolume('/srv/moi/Documents/volumes/x', w.home) ?? '', /personnel/);
  } finally { w.fin(); }
});
