// Arche (identifiant interne naglfar), lot K5 (maquette « Conteneurs et machines » validée le 23/11) : les mises à jour
// et les limites, par les VRAIES actions d'Arche, sur le VRAI moteur rangé dans un dossier jetable — AUCUN conteneur
// lancé, AUCUN téléchargement (faux lanceur ; « récupérer » ne fait qu'inscrire une image) et aucune sortie réseau.
// - ce qu'Odin propose : la version du catalogue d'Odin (son code), une image plus récente sous la même étiquette (déjà
//   dite par le registre) ; pour une image tirée à la main, seulement ce qui est connu ;
// - « Mettre à jour » : la confirmation dit tout (versions, copie des volumes, temps de vérification) ; une version
//   précise, jamais « latest » ; place vérifiée ; retour tout seul si elle ne tient pas, et c'est dit (alerte) ;
// - la copie gardée jusqu'au geste ; propriétaire seul, noté ; jamais de mise à jour par la surveillance ;
// - « Limites » : le total de tous les conteneurs (processeur, mémoire, disque) et « grandit ».
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k5-baux-');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let J: typeof import('../src/valhalla/hringhorni/majs.ts');
let origine: Record<string, unknown> = {}, sante0: Record<string, number> = {};
before(async () => {
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); J = await import('../src/valhalla/hringhorni/majs.ts');
  origine = { ...A.systemeArche }; sante0 = { ...J.SANTE }; Object.assign(J.SANTE, { secondes: 0.1, pasMs: 10 });
});
after(() => { Object.assign(A.systemeArche, origine); Object.assign(J.SANTE, sante0); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const img = (n: string, k: number): Image => { const id = String(k).repeat(64); return { id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() }; };
const LA = ['neosmemo/memos:0.22.5', 'neosmemo/memos:0.22.4', 'registre.maison/appli:1.0'];
const REGISTRE: Record<string, number> = { 'registre.maison/appli:2.0': 7, 'registre.maison/appli:2.0-casse': 8, 'registre.maison/appli:2.0-casse-fuite': 9 };
function monde(plateforme = 'linux', libre = 1024 ** 4) {
  const home = neuf('arche-k5-'), dir = neuf('arche-k5-moteur-'), journal: string[] = [], sorties: string[] = [];
  class MoteurEssai extends H.Engine {
    override async start(n: string) {
      const c = this.find(n); journal.push(`start ${c.spec.name} ${c.spec.image}`);
      if (/casse/.test(c.spec.image)) { this.store.saveState(c.id, { status: 'sorti', exitCode: 1, error: 'mauvais réglage' }); throw new Error(`${c.spec.name} s'est arrêté au démarrage : mauvais réglage${/fuite/.test(c.spec.image) ? ` — connexion refusée pour ${c.spec.env.DB_PASSWORD}` : ''}`); }
      this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString(), restarts: 0 }); return this.find(n);
    }
    override async stop(n: string) { const c = this.find(n); journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
    override async pull(n: string) { journal.push(`pull ${n}`); const k = REGISTRE[n]; if (!k) throw new Error(`introuvable : ${n}`); const i = img(n, k); this.store.saveImages([...this.images().filter((x) => x.id !== i.id), i]); return i; }
  }
  const aucuneSortie = (async (u: unknown) => { sorties.push(String(u)); throw new Error('essai : aucune sortie réseau'); }) as never;
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: aucuneSortie });
  e.store.saveImages(LA.map((n, k) => img(n, k + 1)));
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => plateforme, coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison'), disque: () => ({ libre, total: 2 * libre }), memoireMachine: () => 16 * 1024 ** 3, stat: () => undefined });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd: string) => ({ code: 1, out: '', err: `essai : aucune commande (${cmd})` }), fetch: aucuneSortie, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const finJob = async (id: string) => { for (let k = 0; k < 400; k++) { const j = e.jobs().find((x) => x.id === id); if (j?.ended) return j; await new Promise((r) => setTimeout(r, 10)); } throw new Error('mise à jour jamais finie'); };
  return { v, e, dir, journal, sorties, finJob, fin: () => v.stop() };
}
async function appli(w: ReturnType<typeof monde>) {
  await w.e.create({ image: 'registre.maison/appli:1.0', name: 'appli', network: 'aucun', mounts: 'appli-donnees:/donnees', memory: '1g' });
  await w.e.start('appli');
  writeFileSync(join(w.e.store.volumeData('appli-donnees'), 'notes.txt'), 'mes données');
}
type Maj = { moteur: boolean; regle: string; propositions: Array<Record<string, unknown>>; conteneurs: Array<{ nom: string; connu: string; etiquette: string }>; copies: Array<{ id: string; resultat: string; raison?: string; volumes: Array<{ nom: string }> }>; enCours: Array<{ pct: number; fini: boolean; erreur?: string }> };
const majs = async (w: ReturnType<typeof monde>, o?: Record<string, unknown>) => (await w.v.act('naglfar', 'mises_a_jour', {}, o as never)).data as Maj;

test('rien de proposé au hasard : pour une image tirée à la main, Odin dit seulement ce qui est connu ; aucune sortie réseau', async () => {
  const w = monde();
  try {
    await appli(w);
    const r = await w.v.act('naglfar', 'mises_a_jour');
    assert.equal(r.ok, true, r.text);
    const d = r.data as Maj;
    assert.equal(d.moteur, true); assert.deepEqual(d.propositions, []);
    assert.match(d.regle, /Jamais toute seule : Odin propose, tu décides/);
    assert.deepEqual(d.conteneurs.map((c) => [c.nom, c.etiquette]), [['appli', '1.0']]);
    assert.match(d.conteneurs[0].connu, /ne connaît pas d'autre version.*ne cherche pas les versions sur Internet/);
    assert.match(r.text, /Aucune mise à jour proposée\./);
    assert.deepEqual(w.sorties, []);
    // une lecture ouverte ; pas « read » (banc figé de Soul)
    assert.equal((await w.v.act('naglfar', 'mises_a_jour', {}, { qui: 'member' })).ok, true);
    assert.equal(w.v.action('naglfar', 'mises_a_jour')!.a.read, undefined);
  } finally { w.fin(); }
});

test('une version choisie : la confirmation dit tout ; réussie, la copie gardée, l\'alerte le dit ; noté dans « qui a fait quoi »', async () => {
  const w = monde();
  try {
    await appli(w);
    const a = w.v.action('naglfar', 'mettre_a_jour_version')!.a;
    assert.equal(a.proprietaireSeul, true);
    const g = String(a.grave!({ conteneur: 'appli', image: 'registre.maison/appli:2.0' }));
    assert.match(g, /^mettre à jour appli \(registre\.maison\/appli:1\.0 → registre\.maison\/appli:2\.0\) : d'abord une copie de ses volumes \(appli-donnees, 0 Ko\) dans le dossier du moteur, gardée jusqu'à ce que tu la retires ; il est arrêté le temps de la mise à jour, puis doit tenir debout 0,1 secondes : sinon/);
    assert.match(g, /sinon, retour tout seul à l'ancienne version et aux volumes copiés/);
    const r = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Mise à jour de appli lancée \(registre\.maison\/appli:1\.0 → registre\.maison\/appli:2\.0\) : copie des volumes d'abord/);
    const j = await w.finJob((r.data as { job: string }).job);
    assert.equal(j.phase, 'fini', j.error); assert.match(j.note, /appli à jour/);
    assert.equal(w.e.find('appli').spec.image, 'registre.maison/appli:2.0');
    const d = await majs(w);
    assert.equal(d.copies.length, 1); assert.equal(d.copies[0].resultat, 'réussie'); assert.deepEqual(d.copies[0].volumes.map((x) => x.nom), ['appli-donnees']);
    assert.ok(w.v.alerts().some((x) => /appli est à jour/.test(x.title)), 'c\'est dit');
    assert.match((await w.v.act('naglfar', 'qui_a_fait')).text, /Mettre à jour vers une version/);
    // retirer la copie : un geste confirmé
    const rc = w.v.action('naglfar', 'retirer_copie')!.a;
    assert.match(String(rc.grave!({ copie: d.copies[0].id })), /^retirer la copie du .* \(appli · 0 Ko\) : ses volumes copiés seront effacés, plus de retour possible vers elle$/);
    const x = await w.v.act('naglfar', 'retirer_copie', { copie: d.copies[0].id });
    assert.equal(x.ok, true, x.text); assert.deepEqual((await majs(w)).copies, []);
    assert.equal(readFileSync(join(w.e.store.volumeData('appli-donnees'), 'notes.txt'), 'utf8'), 'mes données');
    assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('la nouvelle version ne démarre pas : retour tout seul, et c\'est dit (sur la mise à jour, dans la liste et par une alerte)', async () => {
  const w = monde();
  try {
    await appli(w);
    const avant = w.e.find('appli').id;
    const r = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0-casse' });
    assert.equal(r.ok, true, r.text);
    const j = await w.finJob((r.data as { job: string }).job);
    assert.equal(j.phase, 'échec'); assert.match(String(j.error), /n'a pas tenu \(appli n'a pas démarré : .*mauvais réglage\) : retour tout seul à l'ancienne version et aux volumes copiés/);
    const c = w.e.find('appli');
    assert.deepEqual([c.id, c.spec.image, c.state.status], [avant, 'registre.maison/appli:1.0', 'en marche']);
    const d = await majs(w);
    assert.equal(d.copies[0].resultat, 'revenue'); assert.match(String(d.copies[0].raison), /mauvais réglage/);
    assert.equal(d.enCours[0].fini, true); assert.match(String(d.enCours[0].erreur), /retour tout seul/);
    assert.ok(w.v.alerts().some((x) => /retour à l'ancienne version/.test(x.title)));
  } finally { w.fin(); }
});

test('refusé avant de toucher à quoi que ce soit : « latest », sans version, autre appli, place qui manque ; propriétaire seul', async () => {
  const w = monde('linux', 1000);
  try {
    await appli(w);
    for (const [image, motif] of [['registre.maison/appli:latest', /latest/], ['registre.maison/appli', /version précise/], ['registre.maison/autre:2.0', /pas la même appli/], ['registre.maison/appli:2.0', /pas assez de place.*Rien n'a été changé/]] as const) {
      const r = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image });
      assert.equal(r.ok, false, image); assert.match(r.text, motif, image);
    }
    for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }]) assert.match((await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0' }, o as never)).text, /seul le propriétaire/);
    for (const id of ['mettre_a_jour_pile', 'retirer_copie', 'mettre_a_jour']) assert.equal(w.v.action('naglfar', id)!.a.proprietaireSeul, true, id);
    assert.deepEqual([w.e.jobs(), w.journal.filter((x) => /^(pull|stop)/.test(x))], [[], []]);
    assert.equal(w.e.find('appli').state.status, 'en marche');
  } finally { w.fin(); }
});

test('le catalogue d\'Odin a une autre version d\'une pile : proposée (rien ne part seul), puis mise à jour de la pile par le geste', async () => {
  const w = monde();
  try {
    const p = await w.v.act('naglfar', 'deployer_catalogue', { app: 'notes', nom: 'notes', ports: 'web:20300' });
    assert.equal(p.ok, true, p.text); await w.finJob((p.data as { job: string }).job);
    // le propriétaire était passé à une version plus ancienne, à la main
    const r1 = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'notes-serveur', image: 'neosmemo/memos:0.22.4' });
    assert.equal(r1.ok, true, r1.text); const j1 = await w.finJob((r1.data as { job: string }).job); assert.equal(j1.phase, 'fini', j1.error);
    const pileJson = JSON.parse(readFileSync(join(w.dir, 'piles', 'notes.json'), 'utf8')) as { services: Array<{ image: string }>; fichier: string };
    assert.equal(pileJson.services[0].image, 'neosmemo/memos:0.22.4'); assert.match(pileJson.fichier, /image: neosmemo\/memos:0\.22\.4/);
    // la surveillance tourne : elle ne met rien à jour, même avec une version proposée
    const avant = w.journal.length, ctx = w.v.ctx('naglfar');
    ctx.saveSettings({ versionsQuand: Date.now() });
    await w.v.module('naglfar')!.watch!.run(ctx);
    const d = await majs(w);
    assert.deepEqual(d.propositions, [{ genre: 'catalogue', pile: 'notes', app: 'notes', appNom: 'Bloc-notes', changes: [{ service: 'serveur', conteneur: 'notes-serveur', avant: 'neosmemo/memos:0.22.4', apres: 'neosmemo/memos:0.22.5' }] }]);
    assert.match(d.conteneurs.find((c) => c.nom === 'notes-serveur')!.connu, /le catalogue d'Odin propose neosmemo\/memos:0\.22\.5/);
    assert.ok(!w.journal.slice(avant).some((x) => /^(pull|stop|start)/.test(x)), 'rien n\'est parti tout seul');
    const g = String(w.v.action('naglfar', 'mettre_a_jour_pile')!.a.grave!({ pile: 'notes' }));
    assert.match(g, /^mettre à jour la pile « notes » \(notes-serveur : neosmemo\/memos:0\.22\.4 → neosmemo\/memos:0\.22\.5\) : d'abord une copie de ses volumes \(notes_donnees/);
    const r = await w.v.act('naglfar', 'mettre_a_jour_pile', { pile: 'notes' });
    assert.equal(r.ok, true, r.text); const j = await w.finJob((r.data as { job: string }).job); assert.equal(j.phase, 'fini', j.error);
    assert.equal(w.e.find('notes-serveur').spec.image, 'neosmemo/memos:0.22.5');
    assert.deepEqual((await majs(w)).propositions, []);
    assert.match((await w.v.act('naglfar', 'mettre_a_jour_pile', { pile: 'notes' })).text, /n'a pas d'autre version pour la pile « notes »/);
    assert.match((await w.v.act('naglfar', 'mettre_a_jour_pile', { pile: 'notes', versions: 'inconnu=neosmemo/memos:0.22.4' })).text, /pas de service « inconnu »/);
    assert.match((await w.v.act('naglfar', 'mettre_a_jour_pile', { pile: 'notes', versions: 'n\'importe quoi' })).text, /versions illisibles/);
    assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('l\'ancien « Mettre à jour » (même étiquette, depuis une alerte) passe par la copie et le retour tout seul', async () => {
  const w = monde();
  try {
    await appli(w);
    const a = w.v.action('naglfar', 'mettre_a_jour')!.a;
    assert.match(String(a.grave!({ conteneur: 'appli' })), /^mettre à jour appli \(registre\.maison\/appli:1\.0 → registre\.maison\/appli:1\.0\) : d'abord une copie de ses volumes/);
    const r = await w.v.act('naglfar', 'mettre_a_jour', { conteneur: 'appli' });
    assert.equal(r.ok, true, r.text);
    const j = await w.finJob((r.data as { job: string }).job);
    // le faux registre n'a pas cette étiquette : rien n'a été changé, et c'est dit
    assert.equal(j.phase, 'échec'); assert.match(String(j.error), /Rien n'a été changé : la nouvelle image registre\.maison\/appli:1\.0 n'a pas pu être récupérée/);
    assert.equal(w.e.find('appli').state.status, 'en marche'); assert.ok(!w.journal.includes('stop appli'));
  } finally { w.fin(); }
});

test('Limites : le total de tous les conteneurs (processeur, mémoire, disque), chacun, et « grandit »', async () => {
  const w = monde();
  try {
    await appli(w);
    await w.e.create({ image: 'neosmemo/memos:0.22.5', name: 'sans-limite', network: 'aucun', mounts: 'gros:/data' }); await w.e.start('sans-limite');
    Object.assign(A.systemeArche, { stat: (c: { spec: { name: string } }) => ({ at: Date.now(), usageUsec: 0, memCurrent: c.spec.name === 'appli' ? 300 * 1024 ** 2 : 100 * 1024 ** 2, memMax: 0 }) });
    // des mesures relevées : « gros » a pris 2 Go en 2 heures
    const now = Date.now(), G = 1024 ** 3;
    w.v.ctx('naglfar').saveSettings({ tailles: { gros: [{ at: now - 2 * 3600_000, o: 0 }, { at: now - 1000, o: 2 * G }], 'appli-donnees': [{ at: now - 3 * 3600_000, o: 10 }, { at: now - 1000, o: 13 }] } });
    const r = await w.v.act('naglfar', 'limites');
    assert.equal(r.ok, true, r.text);
    const d = r.data as { total: { memoire: number; limites: number; sansLimite: string[]; memoireMachine: number; disque: { images: number; volumes: number; copies: number; libre: number } }; conteneurs: Array<{ nom: string; memoire: number; limiteMemoire?: number }>; volumes: Array<{ nom: string; grandit: boolean; parJour?: number; joursAvantPlein?: number }> };
    assert.equal(d.total.memoire, 400 * 1024 ** 2); assert.equal(d.total.limites, G); assert.deepEqual(d.total.sansLimite, ['sans-limite']); assert.equal(d.total.memoireMachine, 16 * G);
    assert.equal(d.total.disque.images, 3000); assert.equal(d.total.disque.copies, 0);
    assert.deepEqual(d.conteneurs.map((c) => [c.nom, c.limiteMemoire ?? null]).sort(), [['appli', G], ['sans-limite', null]]);
    const gros = d.volumes.find((v) => v.nom === 'gros')!;
    assert.equal(gros.grandit, true); assert.ok((gros.parJour ?? 0) > 20 * G);
    assert.equal(d.volumes.find((v) => v.nom === 'appli-donnees')!.grandit, false);
    assert.match(r.text, /grandit vite : gros/);
    // une lecture ouverte
    assert.equal((await w.v.act('naglfar', 'limites', {}, { qui: 'member' })).ok, true);
  } finally { w.fin(); }
});

test('les mesures de « grandit » : relevées par la surveillance au plus toutes les 15 minutes, sans rien changer', async () => {
  const w = monde();
  try {
    await appli(w);
    const ctx = { now: () => new Date(), settings: {} as Record<string, unknown>, saveSettings(p: Record<string, unknown>) { Object.assign(this.settings, p); } };
    await A.mesurerVolumes(ctx as never);
    const t1 = (ctx.settings.tailles as Record<string, Array<{ o: number }>>)['appli-donnees'];
    assert.equal(t1.length, 1); assert.equal(t1[0].o, Buffer.byteLength('mes données'));
    await A.mesurerVolumes(ctx as never);
    assert.equal((ctx.settings.tailles as Record<string, unknown[]>)['appli-donnees'].length, 1, 'pas deux fois en 15 minutes');
    await A.mesurerVolumes(ctx as never, true);
    assert.equal((ctx.settings.tailles as Record<string, unknown[]>)['appli-donnees'].length, 2);
    assert.deepEqual(w.journal.filter((x) => /^(pull|stop)/.test(x)), []);
  } finally { w.fin(); }
});

test('pendant une mise à jour : aucun autre geste sur le conteneur ; un secret de ses variables ne sort jamais (alerte, suivi, copies)', async () => {
  const w = monde();
  try {
    const secret = 'motdepasse-tres-secret-42';
    await w.e.create({ image: 'registre.maison/appli:1.0', name: 'appli', network: 'aucun', mounts: 'appli-donnees:/donnees', env: { DB_PASSWORD: secret } });
    await w.e.start('appli');
    Object.assign(J.SANTE, { secondes: 0.4 });
    const r = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0' });
    assert.equal(r.ok, true, r.text);
    await new Promise((ok) => setTimeout(ok, 30));
    for (const [id, input] of [['geste_fiche', { conteneur: 'appli', geste: 'arreter' }], ['supprimer_fiche', { conteneur: 'appli' }], ['mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0-casse' }]] as const) {
      const x = await w.v.act('naglfar', id, input as never); assert.equal(x.ok, false, id); assert.match(x.text, /déjà en train de changer/, id);
    }
    await w.finJob((r.data as { job: string }).job);
    Object.assign(J.SANTE, { secondes: 0.1 });
    const f = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0-casse-fuite' });
    const j = await w.finJob((f.data as { job: string }).job);
    assert.equal(j.phase, 'échec'); assert.match(String(j.error), /connexion refusée pour ••••••/);
    const tout = JSON.stringify([j, w.v.alerts(), await majs(w), (await w.v.act('naglfar', 'qui_a_fait')).text]);
    assert.ok(!tout.includes(secret), 'le secret ne sort jamais');
    assert.equal(w.e.find('appli').spec.image, 'registre.maison/appli:2.0', 'revenue à la version d\'avant (celle de la mise à jour réussie)');
  } finally { Object.assign(J.SANTE, { secondes: 0.1 }); w.fin(); }
});

test('Windows (aucun moteur aujourd\'hui) : les lectures le disent, aucun geste ne part, le moteur n\'est pas touché', async () => {
  const w = monde('win32');
  try {
    const touche: string[] = [];
    A.useEngine(() => new Proxy({}, { get: (_t, k) => { touche.push(String(k)); throw new Error('le moteur ne doit pas être appelé'); } }) as never);
    for (const id of ['mises_a_jour', 'limites']) { const r = await w.v.act('naglfar', id); assert.equal(r.ok, true, id); assert.equal((r.data as { moteur: boolean }).moteur, false); assert.match(r.text, /ne marche que sous Linux/); }
    for (const [id, input] of [['mettre_a_jour_version', { conteneur: 'appli', image: 'a/b:2' }], ['mettre_a_jour_pile', { pile: 'notes' }], ['retirer_copie', { copie: 'aaaaaaaaaaaa' }], ['mettre_a_jour', { conteneur: 'appli' }]] as const) {
      const r = await w.v.act('naglfar', id, input as never); assert.equal(r.ok, false, id); assert.match(r.text, /ne marche que sous Linux/, id);
    }
    assert.deepEqual(touche, []);
    assert.equal(existsSync(join(w.dir, 'copies-maj')), false);
  } finally { w.fin(); }
});

test('relecture : pendant une mise à jour, aucun geste par les autres chemins (démarrer, arrêter, supprimer, commande), ni sur l\'ancien mis de côté', async () => {
  const w = monde();
  try {
    await appli(w);
    Object.assign(J.SANTE, { secondes: 0.5 });
    const r = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0' });
    assert.equal(r.ok, true, r.text);
    let ancien = ''; for (let k = 0; k < 200 && !ancien; k++) { ancien = w.e.ps(true).find((c) => c.spec.labels['odin.maj.ancien'])?.spec.name ?? ''; if (!ancien) await new Promise((ok) => setTimeout(ok, 5)); }
    assert.match(ancien, /^appli\.avant-maj-[a-f0-9]{6}$/);
    for (const [id, input] of [['arreter', { conteneur: 'appli' }], ['demarrer', { conteneur: ancien }], ['redemarrer', { conteneur: 'appli' }], ['supprimer', { conteneur: ancien }], ['supprimer_fiche', { conteneur: ancien }], ['geste_fiche', { conteneur: ancien, geste: 'demarrer' }], ['commande', { ligne: `rm ${ancien}` }], ['commande', { ligne: 'stop appli' }]] as const) {
      const x = await w.v.act('naglfar', id, input as never); assert.equal(x.ok, false, `${id} ${JSON.stringify(input)}`); assert.match(x.text, /déjà en train de changer/, id);
    }
    const j = await w.finJob((r.data as { job: string }).job);
    assert.equal(j.phase, 'fini', String(j.error));
    assert.equal(w.e.find('appli').spec.image, 'registre.maison/appli:2.0');
    const x = await w.v.act('naglfar', 'redemarrer', { conteneur: 'appli' }); assert.equal(x.ok, true, 'après la mise à jour, les gestes reviennent');
  } finally { Object.assign(J.SANTE, { secondes: 0.1 }); w.fin(); }
});

test('relecture : deux mises à jour en même temps se partagent la place du disque (la seconde est refusée s\'il en manque)', async () => {
  const w = monde('linux', 700 * 1024 ** 2);
  try {
    await appli(w);
    await w.e.create({ image: 'registre.maison/appli:1.0', name: 'autre', network: 'aucun', mounts: 'autre-donnees:/donnees' });
    await w.e.start('autre');
    Object.assign(J.SANTE, { secondes: 0.4 });
    const r1 = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'appli', image: 'registre.maison/appli:2.0' });
    assert.equal(r1.ok, true, r1.text);
    const r2 = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'autre', image: 'registre.maison/appli:2.0' });
    assert.equal(r2.ok, false, r2.text); assert.match(r2.text, /pas assez de place/);
    await w.finJob((r1.data as { job: string }).job);
    const r3 = await w.v.act('naglfar', 'mettre_a_jour_version', { conteneur: 'autre', image: 'registre.maison/appli:2.0' });
    assert.equal(r3.ok, true, `la place est rendue à la fin : ${r3.text}`);
    await w.finJob((r3.data as { job: string }).job);
  } finally { Object.assign(J.SANTE, { secondes: 0.1 }); w.fin(); }
});

test('relecture : retirer la copie d\'une mise à jour interrompue : la confirmation prévient que c\'est peut-être la seule version d\'avant', async () => {
  const w = monde();
  try {
    await appli(w);
    const id = 'dddddddddddd', dir = join(w.dir, 'copies-maj', id);
    J.copiesMaj(w.e as never);
    const { mkdirSync } = await import('node:fs'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'fiche.json'), JSON.stringify({ id, quand: new Date().toISOString(), conteneurs: [{ nom: 'appli', avant: 'a:1', apres: 'a:2' }], volumes: [], octets: 0, copiee: true, resultat: 'retour incomplet', dossiersNonCopies: [] }));
    const g = w.v.action('naglfar', 'retirer_copie')!.a.grave!({ copie: id });
    assert.match(String(g), /peut-être la seule/);
  } finally { w.fin(); }
});

test('relecture : la surveillance reprend une mise à jour coupée par un arrêt d\'Odin (le retour, jamais une mise à jour) et le dit', async () => {
  const w = monde();
  try {
    await appli(w);
    const id = 'eeeeeeeeeeee', dir = join(w.dir, 'copies-maj', id);
    const { mkdirSync } = await import('node:fs'); mkdirSync(join(dir, 'volumes'), { recursive: true });
    writeFileSync(join(dir, 'fiche.json'), JSON.stringify({ id, quand: new Date().toISOString(), pid: 2 ** 30, etape: 'copie', conteneurs: [{ nom: 'appli', avant: 'registre.maison/appli:1.0', apres: 'registre.maison/appli:2.0', ancien: J.nomAncien('appli', id), enMarche: true }], volumes: [], octets: 0, copiee: false, resultat: 'en cours', dossiersNonCopies: [] }));
    await w.e.stop('appli');
    const alertes: Array<{ title: string; detail: string }> = [];
    await A.reprendreMajs({ alert: (a: { title: string; detail: string }) => alertes.push(a) } as never);
    assert.equal(w.e.find('appli').state.status, 'en marche');
    assert.equal(alertes.length, 1); assert.match(alertes[0].title, /Mise à jour de appli interrompue/); assert.match(alertes[0].detail, /arrêt d'Odin.*remis comme avant/);
    assert.equal((await majs(w)).copies[0].resultat, 'pas faite');
    assert.ok(!w.journal.some((x) => /^pull/.test(x)), 'aucune mise à jour relancée');
  } finally { w.fin(); }
});
