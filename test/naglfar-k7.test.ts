// Arche (identifiant interne naglfar), lot K7 « Par la parole » (maquette « Conteneurs et machines » validée le 23/11) :
// une phrase va à la bonne action d'Arche, avec le bon conteneur, la bonne pile ou la bonne appli du catalogue, en
// français et dans les langues que Logos comprend sans IA (anglais, espagnol, allemand ; japonais pour les lectures),
// sans prendre les phrases des autres applis. Sur le VRAI moteur rangé dans un dossier jetable — AUCUN conteneur lancé,
// AUCUN téléchargement (faux lanceur ; « récupérer » ne fait qu'inscrire une image), aucune sortie réseau.
//  - « lance le serveur de jeux », « arrête wiki », « déploie une galerie de photos », « où en est wiki »,
//    « mets à jour wiki » (Odin PROPOSE, avec la confirmation habituelle, jamais sans), « combien prennent mes conteneurs » ;
//  - un nom dit est relu contre la liste réelle : jamais deviné à moitié, deux proches → Odin demande lequel ;
//  - gestes au propriétaire seul, avec la même confirmation que la page ; lectures ouvertes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { forgetPending, understand } from '../src/valhalla/huginn.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('arche-k7-baux-');
let A: typeof import('../src/valhalla/modules/naglfar.ts');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let J: typeof import('../src/valhalla/hringhorni/majs.ts');
let origine: Record<string, unknown> = {}, sante0: Record<string, number> = {};
before(async () => {
  A = await import('../src/valhalla/modules/naglfar.ts'); H = await import('../src/valhalla/hringhorni/engine.ts'); J = await import('../src/valhalla/hringhorni/majs.ts');
  origine = { ...A.systemeArche }; sante0 = { ...J.SANTE }; Object.assign(J.SANTE, { secondes: 0.1, pasMs: 10 });
});
after(() => { setValhalla(undefined); Object.assign(A.systemeArche, origine); Object.assign(J.SANTE, sante0); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const img = (n: string, k: number): Image => { const id = String(k).repeat(64); return { id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() }; };
const LA = ['neosmemo/memos:0.22.5', 'neosmemo/memos:0.22.4', 'registre.maison/wiki:1.0', 'registre.example.org/serveur-jeu:1.21.4', 'registre.example.org/carte-web:3.0.2'];
const REGISTRE: Record<string, number> = { 'registre.maison/wiki:1.0': 7 };
const JEUX = (port: number, carte: number) => `services:\n  monde:\n    image: registre.example.org/serveur-jeu:1.21.4\n    ports: ["${port}:25565"]\n  carte:\n    image: registre.example.org/carte-web:3.0.2\n    ports: ["${carte}:80"]\n    depends_on: [monde]\n`;
function monde() {
  const home = neuf('arche-k7-'), dir = neuf('arche-k7-moteur-'), journal: string[] = [], sorties: string[] = [];
  class MoteurEssai extends H.Engine {
    override async start(n: string) { const c = this.find(n); journal.push(`start ${c.spec.name}`); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString(), restarts: 0 }); return this.find(n); }
    override async stop(n: string) { const c = this.find(n); journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
    override async pull(n: string) { journal.push(`pull ${n}`); const k = REGISTRE[n]; if (!k) throw new Error(`introuvable : ${n}`); const i = img(n, k); this.store.saveImages([...this.images().filter((x) => x.id !== i.id && !x.names.includes(n)), i]); return i; }
  }
  const aucuneSortie = (async (u: unknown) => { sorties.push(String(u)); throw new Error('essai : aucune sortie réseau'); }) as never;
  const e = new MoteurEssai(dir, { rootless: false, run: async () => ({ code: 0, out: '', err: '' }), fetch: aucuneSortie });
  e.store.saveImages(LA.map((n, k) => img(n, k + 1)));
  A.useEngine(() => e as never);
  Object.assign(A.systemeArche, { plateforme: () => 'linux', coeurs: () => 4, dossierMoteur: () => dir, maison: () => join(home, 'maison'), disque: () => ({ libre: 1024 ** 4, total: 2 * 1024 ** 4 }), memoireMachine: () => 16 * 1024 ** 3, stat: () => undefined });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd: string) => ({ code: 1, out: '', err: `essai : aucune commande (${cmd})` }), fetch: aucuneSortie, notify: async () => {}, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  const finJob = async (id: string) => { for (let k = 0; k < 400; k++) { const j = e.jobs().find((x) => x.id === id); if (j?.ended) return j; await new Promise((r) => setTimeout(r, 10)); } throw new Error('installation jamais finie'); };
  const geste = async (action: string, input: Record<string, unknown>) => { const r = await v.act('naglfar', action, input); assert.equal(r.ok, true, r.text); const job = (r.data as { job?: string } | undefined)?.job; if (job) { const j = await finJob(job); assert.equal(j.phase, 'fini', j.error); } return r; };
  /** La phrase comprise par Logos (« appli.action {réglages} »), et ce qui partirait sans IA quand une IA est là (strict). */
  const dit = async (t: string): Promise<{ compris: string; direct: string }> => {
    const u = await understand(v, t, `k7-${Math.random()}`);
    const compris = !u ? '—' : u.kind === 'action' ? `${u.module}.${u.action} ${JSON.stringify(u.input)}${u.doubt ? ' (doute)' : ''}` : u.kind;
    const calls: string[] = [];
    const d: DirectDeps = { sessionId: `k7d-${Math.random()}`, has: () => true, kv: { getKv: () => undefined, setKv: () => {} },
      run: async (name, input) => { calls.push(name === 'valhalla' ? `${String(input.appli)}.${String(input.quoi)} ${String(input.entree ?? '')}`.trim() : name); return { ok: true, content: 'fait' }; } };
    const r = await tryDirect(t, d); forgetPending(d.sessionId);
    return { compris, direct: r.done ? calls.at(-1) ?? '(réponse)' : `IA · ${r.why}` };
  };
  return { v, e, dir, journal, sorties, finJob, geste, dit, fin: () => { setValhalla(undefined); v.stop(); } };
}
/** Le monde de la maquette : wiki (en marche), web, cloud-app et cloud-db ; les piles « serveur-de-jeux », « jeux » et « notes » (catalogue). */
async function peuple(w: ReturnType<typeof monde>) {
  await w.e.create({ image: 'registre.maison/wiki:1.0', name: 'wiki', network: 'aucun', mounts: 'wiki-donnees:/donnees', memory: '1g' }); await w.e.start('wiki');
  for (const n of ['web', 'cloud-app', 'cloud-db']) await w.e.create({ image: 'registre.maison/wiki:1.0', name: n, network: 'aucun' });
  await w.geste('deployer_pile', { compose: JEUX(25565, 8123), nom: 'serveur-de-jeux' });
  await w.geste('deployer_pile', { compose: JEUX(25566, 8124), nom: 'jeux' });
  await w.geste('deployer_catalogue', { app: 'notes', nom: 'notes', ports: 'web:20300' });
  w.journal.length = 0;
}

test('par la parole : chaque phrase va à la bonne action d\'Arche, avec le bon nom, en français et dans les autres langues ; sans IA quand une IA est là aussi', async () => {
  const w = monde();
  try {
    await peuple(w);
    const attendu: Array<[string, string]> = [
      // français (la maquette)
      ['lance le serveur de jeux', 'naglfar.demarrer_dit {"conteneur":"serveur de jeux"}'],
      ['lance la pile jeux', 'naglfar.demarrer_dit {"conteneur":"pile jeux"}'],
      ['démarre wiki', 'naglfar.demarrer_dit {"conteneur":"wiki"}'],
      ['arrête wiki', 'naglfar.arreter {"conteneur":"wiki"}'],
      ['arrête le serveur de jeux', 'naglfar.arreter {"conteneur":"serveur de jeux"}'],
      ['déploie une galerie de photos', 'naglfar.deployer_photos {}'],
      ['installe le serveur de médias', 'naglfar.deployer_medias {}'],
      ['où en est wiki', 'naglfar.etat_dit {"conteneur":"wiki"}'],
      ['où en est le serveur de jeux ?', 'naglfar.etat_dit {"conteneur":"serveur de jeux"}'],
      ['mets à jour wiki', 'naglfar.mettre_a_jour_dit {"conteneur":"wiki"}'],
      ['mets à jour la pile jeux', 'naglfar.mettre_a_jour_dit {"conteneur":"pile jeux"}'],
      ['combien prennent mes conteneurs', 'naglfar.etat_ressources {}'],
      // anglais
      ['launch wiki', 'naglfar.demarrer_dit {"conteneur":"wiki"}'],
      ['stop the container wiki', 'naglfar.arreter {"conteneur":"wiki"}'],
      ['deploy a photo gallery', 'naglfar.deployer_photos {}'],
      ['status of wiki', 'naglfar.etat_dit {"conteneur":"wiki"}'],
      ['update wiki', 'naglfar.mettre_a_jour_dit {"conteneur":"wiki"}'],
      ['how much do my containers use', 'naglfar.etat_ressources {}'],
      // espagnol
      ['arranca wiki', 'naglfar.demarrer_dit {"conteneur":"wiki"}'],
      ['detén wiki', 'naglfar.arreter {"conteneur":"wiki"}'],
      ['despliega una galería de fotos', 'naglfar.deployer_photos {}'],
      ['estado de wiki', 'naglfar.etat_dit {"conteneur":"wiki"}'],
      ['actualiza wiki', 'naglfar.mettre_a_jour_dit {"conteneur":"wiki"}'],
      ['cuánto ocupan mis contenedores', 'naglfar.etat_ressources {}'],
      // allemand
      ['starte wiki', 'naglfar.demarrer_dit {"conteneur":"wiki"}'],
      ['stoppe wiki', 'naglfar.arreter {"conteneur":"wiki"}'],
      ['status von wiki', 'naglfar.etat_dit {"conteneur":"wiki"}'],
      ['aktualisiere wiki', 'naglfar.mettre_a_jour_dit {"conteneur":"wiki"}'],
      ['wie viel brauchen meine Container', 'naglfar.etat_ressources {}'],
      // japonais (les lectures : le verbe collé au nom n'est pas encore lu par Logos pour un geste)
      ['wikiの状態', 'naglfar.etat_dit {"conteneur":"wiki"}'],
      ['コンテナの使用量は？', 'naglfar.etat_ressources {}'],
    ];
    const faux: string[] = [];
    for (const [t, a] of attendu) {
      const r = await w.dit(t);
      if (r.compris !== a) faux.push(`« ${t} » compris ${r.compris} (attendu ${a})`);
      else if (r.direct !== a) faux.push(`« ${t} » sans IA : ${r.direct} (attendu ${a})`);
    }
    assert.deepEqual(faux, [], `${attendu.length - faux.length}/${attendu.length}`);
    // rien n'a été lancé pour de vrai (on regarde seulement ce qui partirait)
    assert.deepEqual(w.journal, []);
  } finally { w.fin(); }
});

test('par la parole : les phrases des autres applis restent à elles ; une pile d\'un seul mot ne fait pas prendre ce mot à Arche', async () => {
  const w = monde();
  try {
    await peuple(w);
    for (const [t, re] of [['déploie le site', /^idunn\.deployer/], ['redémarre le conteneur web', /^naglfar\.redemarrer .*web/], ['état de la machine', /^eir\.etat/]] as const) {
      const r = await w.dit(t); assert.match(r.compris, re, t); assert.match(r.direct, re, t);
    }
    // « jeux » et « notes » sont des piles, mais aussi des mots de tous les jours : Arche ne les prend pas pour elle
    for (const t of ['mes jeux', 'mes notes', 'cherche dans mes notes facture orange']) assert.doesNotMatch((await w.dit(t)).compris, /^naglfar\./, t);
    // ni une mise à jour, ni un déploiement, sans nom connu : jamais deviné (« déploie le serveur » n'est pas « Serveur de médias »)
    for (const t of ['Mets à jour le serveur', 'Déploie mon appli sur un serveur', 'déploie le serveur', 'Mets à jour mes applis']) {
      const r = await w.dit(t); assert.doesNotMatch(r.direct, /^naglfar\./, t); assert.doesNotMatch(r.compris, /^naglfar\.deployer_/, t);
    }
  } finally { w.fin(); }
});

test('un nom dit est relu contre la liste réelle : exact, au tiret près, dit en entier ; deux proches ou un morceau → Odin demande lequel', async () => {
  const w = monde();
  try {
    await peuple(w);
    const ok = (dit: string) => { const r = A.relireNom(dit); assert.ok(r.ok, `${dit} : ${r.ok ? '' : r.texte}`); return r.ok ? `${r.x.sorte}:${r.x.nom}` : ''; };
    assert.equal(ok('wiki'), 'conteneur:wiki'); assert.equal(ok('Wiki'), 'conteneur:wiki'); assert.equal(ok('le conteneur wiki'), 'conteneur:wiki');
    assert.equal(ok('cloud app'), 'conteneur:cloud-app'); assert.equal(ok('cloud-db'), 'conteneur:cloud-db');
    assert.equal(ok('serveur de jeux'), 'pile:serveur-de-jeux'); assert.equal(ok('le serveur-de-jeux'), 'pile:serveur-de-jeux');
    assert.equal(ok('pile jeux'), 'pile:jeux'); assert.equal(ok('la pile notes'), 'pile:notes'); assert.equal(ok('jeux monde'), 'conteneur:jeux-monde');
    assert.equal(ok(w.e.find('web').id.slice(0, 12)), 'conteneur:web');
    // le nom dit en entier dans une phrase plus longue
    assert.equal(ok('mon wiki de la maison'), 'conteneur:wiki');
    // un morceau de nom : jamais deviné, même s'il n'y en a qu'un ; deux proches : les deux sont proposés
    const cloud = A.relireNom('cloud');
    assert.equal(cloud.ok, false); assert.match(cloud.ok ? '' : cloud.texte, /Je ne connais pas « cloud » tel quel\. Tu parles de cloud-app ou cloud-db \?.*Rien n'est fait/);
    const monde1 = A.relireNom('le monde'); assert.equal(monde1.ok, false); assert.match(monde1.ok ? '' : monde1.texte, /jeux-monde ou serveur-de-jeux-monde/);
    // deux noms entiers dans la phrase : lequel ?
    const deux = A.relireNom('wiki et web'); assert.equal(deux.ok, false); assert.match(deux.ok ? '' : deux.texte, /Plusieurs noms conviennent pour « wiki et web » : (wiki ou web|web ou wiki)\. Lequel \?/);
    const inconnu = A.relireNom('minecraft'); assert.equal(inconnu.ok, false); assert.match(inconnu.ok ? '' : inconnu.texte, /Je ne connais pas « minecraft » dans Arche \(cloud-app, cloud-db, la pile jeux, jeux-carte, .*\)\. Rien n'est fait : redis-le avec son nom\./);
    assert.equal(A.relireNom('').ok, false); assert.equal(A.relireNom('la pile').ok, false);
    // un identifiant trop court n'est pas un nom (« cafe », « add » ne désignent jamais un conteneur au hasard)
    assert.equal(A.relireNom(w.e.find('web').id.slice(0, 6)).ok, false);
    // par les gestes : rien ne part, et la réponse demande lequel ; aucune confirmation demandée pour rien
    for (const id of ['arreter', 'demarrer_dit', 'mettre_a_jour_dit', 'etat_dit']) {
      const r = await w.v.act('naglfar', id, { conteneur: 'cloud' });
      assert.equal(r.ok, false, id); assert.match(r.text, /Tu parles de cloud-app ou cloud-db \?/, id);
      assert.equal(w.v.action('naglfar', id)!.a.grave?.({ conteneur: 'cloud' }, w.v.ctx('naglfar')), undefined, id);
    }
    assert.deepEqual(w.journal, []); assert.equal(w.e.find('wiki').state.status, 'en marche');
  } finally { w.fin(); }
});

test('gestes au propriétaire seul, avec la même confirmation que la page ; jamais sans elle', async () => {
  const w = monde();
  try {
    await peuple(w);
    const ctx = w.v.ctx('naglfar'), g = (id: string, input: Record<string, unknown>) => w.v.action('naglfar', id)!.a.grave?.(input, ctx);
    // arrêter : le texte de la fiche (conteneur) ou de l'onglet Piles (pile)
    assert.equal(g('arreter', { conteneur: 'wiki' }), g('geste_fiche', { conteneur: 'wiki', geste: 'arreter' }));
    assert.match(String(g('arreter', { conteneur: 'wiki' })), /^arrêter le conteneur wiki \(ce qu'il sert ne répond plus/);
    assert.equal(g('arreter', { conteneur: 'serveur de jeux' }), g('arreter_pile', { pile: 'serveur-de-jeux' }));
    // déployer : la confirmation du catalogue (images, ports, volumes, mémoire, qui peut l'ouvrir)
    assert.equal(g('deployer_photos', {}), g('deployer_catalogue', { app: 'photos' }));
    assert.match(String(g('deployer_photos', {})), /Galerie de photos/);
    // démarrer : comme la page, sans confirmation (rien ne s'arrête ni ne s'efface)
    assert.equal(g('demarrer_dit', { conteneur: 'web' }), undefined);
    // au propriétaire seul : ni un membre, ni une automatisation ; les lectures restent ouvertes
    for (const [id, input] of [['demarrer_dit', { conteneur: 'web' }], ['arreter', { conteneur: 'wiki' }], ['mettre_a_jour_dit', { conteneur: 'wiki' }], ['deployer_photos', {}], ['deployer_notes', {}]] as const) {
      assert.equal(w.v.action('naglfar', id)!.a.proprietaireSeul, true, id);
      for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }]) assert.match((await w.v.act('naglfar', id, input, o as never)).text, /seul le propriétaire/, `${id} ${JSON.stringify(o)}`);
    }
    for (const id of CATALOGUE_IDS()) assert.equal(w.v.action('naglfar', `deployer_${id.replace(/-/g, '_')}`)!.a.proprietaireSeul, true, id);
    assert.equal((await w.v.act('naglfar', 'etat_dit', { conteneur: 'wiki' }, { qui: 'member' })).ok, true);
    assert.equal((await w.v.act('naglfar', 'etat_ressources', {}, { qui: 'member' })).ok, true);
    assert.deepEqual(w.journal, []); assert.deepEqual(w.e.jobs().filter((j) => j.kind !== 'installer'), []);
    // par la discussion : sans confirmation, rien ne part ; avec, le geste de la page
    const q = await w.v.order('arrête wiki', 'k7-ordre');
    assert.equal(q.ok, false); assert.match(String(q.confirm), /arrêter le conteneur wiki/); assert.equal(w.e.find('wiki').state.status, 'en marche');
    const r = await w.v.order('arrête wiki', 'k7-ordre', { confirm: true });
    assert.match(r.text, /⏹ wiki arrêté/); assert.equal(w.e.find('wiki').state.status, 'arrêté');
    const p = await w.v.order('arrête le serveur de jeux', 'k7-ordre');
    assert.match(String(p.confirm), /^arrêter la pile serveur-de-jeux \(ce qu'elle sert ne répond plus/);
    assert.ok(!(w.journal as string[]).includes('stop serveur-de-jeux-monde'), 'rien n\'est arrêté sans confirmation');
    assert.match((await w.v.order('arrête le serveur de jeux', 'k7-ordre', { confirm: true })).text, /⏹ Pile « serveur-de-jeux » : serveur-de-jeux-carte, puis serveur-de-jeux-monde arrêté/);
    // la maquette : « lance le serveur de jeux » démarre la pile, le monde d'abord, puis la carte
    const s = await w.v.order('lance le serveur de jeux', 'k7-ordre');
    assert.equal(s.confirm, undefined); assert.match(s.text, /▶ Pile « serveur-de-jeux » : serveur-de-jeux-monde, puis serveur-de-jeux-carte démarré/);
    // un membre qui le dit : refusé (il n'est pas le propriétaire), rien ne part
    const m = await w.v.order('lance wiki', 'k7-membre', { qui: 'member' });
    assert.match(m.text, /seul le propriétaire/); assert.equal(w.e.find('wiki').state.status, 'arrêté');
    // « qui a fait quoi » : les gestes faits par la parole y sont notés
    const qa = (await w.v.act('naglfar', 'qui_a_fait', { n: 50 })).text;
    assert.match(qa, /propriétaire · Arrêter \(conteneur : wiki\) · fait/); assert.match(qa, /propriétaire · Lancer un conteneur ou une pile \(conteneur : serveur de jeux\) · fait/);
    assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('« mets à jour » : Odin propose ce qu\'il connaît, avec la confirmation habituelle de la mise à jour ; rien à proposer : rien ne change, et c\'est dit', async () => {
  const w = monde();
  try {
    await peuple(w);
    const ctx = w.v.ctx('naglfar'), g = (id: string, input: Record<string, unknown>) => w.v.action('naglfar', id)!.a.grave?.(input, ctx);
    // rien de connu pour wiki : aucune confirmation, et la réponse dit pourquoi
    assert.equal(g('mettre_a_jour_dit', { conteneur: 'wiki' }), undefined);
    // demandée sans ses réglages (une scène, un lien) : la proposition ne se lit pas, la confirmation est donc demandée
    assert.match(String(w.v.action('naglfar', 'mettre_a_jour_dit')!.a.grave!({ conteneur: 'wiki' })), /^mettre à jour wiki si Odin connaît une autre version/);
    const rien =await w.v.act('naglfar', 'mettre_a_jour_dit', { conteneur: 'wiki' });
    assert.equal(rien.ok, false); assert.match(rien.text, /Rien à proposer pour wiki : Odin ne connaît pas d'autre version de son image .*Rien n'est changé/);
    assert.match((await w.v.act('naglfar', 'mettre_a_jour_dit', { conteneur: 'pile jeux' })).text, /Rien à proposer pour la pile jeux : le catalogue d'Odin n'a pas d'autre version/);
    assert.deepEqual(w.e.jobs().filter((j) => j.kind === 'mettre à jour'), []);
    // une image plus récente sous la même étiquette (dite par la vérification des registres) : proposée, confirmation de K5
    ctx.saveSettings({ versions: [{ image: 'registre.maison/wiki:1.0', conteneurs: ['wiki'], locale: 'sha256:1', distante: 'sha256:7', nouvelle: true, quand: new Date().toISOString() }] });
    const c = String(g('mettre_a_jour_dit', { conteneur: 'wiki' }));
    assert.equal(c, g('mettre_a_jour', { conteneur: 'wiki' }));
    assert.match(c, /^mettre à jour wiki \(registre\.maison\/wiki:1\.0 → registre\.maison\/wiki:1\.0\) : d'abord une copie de ses volumes/);
    // par la discussion : jamais sans la confirmation
    const q = await w.v.order('mets à jour wiki', 'k7-maj');
    assert.equal(q.ok, false); assert.equal(q.confirm, c); assert.deepEqual(w.e.jobs().filter((j) => j.kind === 'mettre à jour'), []);
    const r = await w.v.order('mets à jour wiki', 'k7-maj', { confirm: true });
    assert.match(r.text, /⬆ Mise à jour de wiki lancée/);
    const job = w.e.jobs().find((j) => j.kind === 'mettre à jour')!; const j = await w.finJob(job.id); assert.equal(j.phase, 'fini', j.error);
    assert.ok(w.journal.includes('pull registre.maison/wiki:1.0'));
    // le catalogue d'Odin a une autre version pour la pile « notes » (passée à la main à une plus ancienne) : la pile est proposée
    await w.geste('mettre_a_jour_version', { conteneur: 'notes-serveur', image: 'neosmemo/memos:0.22.4' });
    for (const dit of ['pile notes', 'notes-serveur']) assert.equal(g('mettre_a_jour_dit', { conteneur: dit }), g('mettre_a_jour_pile', { pile: 'notes', versions: '' }), dit);
    const p = await w.v.act('naglfar', 'mettre_a_jour_dit', { conteneur: 'la pile notes' });
    assert.equal(p.ok, true, p.text); const jp = await w.finJob((p.data as { job: string }).job); assert.equal(jp.phase, 'fini', jp.error);
    assert.equal(w.e.find('notes-serveur').spec.image, 'neosmemo/memos:0.22.5');
    assert.deepEqual(w.sorties, []);
  } finally { w.fin(); }
});

test('« où en est » et « combien prennent mes conteneurs » : des lectures qui disent l\'essentiel ; sans moteur, Odin le dit', async () => {
  const w = monde();
  try {
    await peuple(w);
    const e = await w.v.act('naglfar', 'etat_dit', { conteneur: 'wiki' });
    assert.equal(e.ok, true, e.text); assert.match(e.text, /^wiki · en marche depuis le .* · registre\.maison\/wiki:1\.0/);
    const p = await w.v.act('naglfar', 'etat_dit', { conteneur: 'serveur de jeux' });
    assert.match(p.text, /^Pile serveur-de-jeux · (en marche|arrêtée|en partie) \(\d\/2 en marche\) : serveur-de-jeux-monde/);
    const t = await w.v.act('naglfar', 'etat_ressources');
    assert.equal(t.ok, true, t.text); assert.match(t.text, /^\d+ en marche sur 9 · mémoire .* utilisés \(limites additionnées .* sur 16 Go\) · disque /);
    Object.assign(A.systemeArche, { plateforme: () => 'win32' });
    assert.match((await w.v.act('naglfar', 'etat_ressources')).text, /moteur/i);
    assert.match((await w.v.act('naglfar', 'demarrer_dit', { conteneur: 'wiki' })).text, /moteur/i);
  } finally { Object.assign(A.systemeArche, { plateforme: () => 'linux' }); w.fin(); }
});

test('la vue range les noms des piles pour Logos (section « Conteneurs », cachée sur la page) : jamais un mot courant seul', async () => {
  const w = monde();
  try {
    await peuple(w);
    assert.deepEqual(A.nomsDitsPile('serveur-de-jeux'), { titre: 'pile serveur de jeux', noms: ['serveur-de-jeux', 'serveur de jeux'] });
    assert.deepEqual(A.nomsDitsPile('jeux'), { titre: 'pile jeux', noms: [] });
    // une appli du catalogue : son nom à tirets seulement (« livres audio » dit seul reste aux autres applis)
    assert.deepEqual(A.nomsDitsPile('livres-audio'), { titre: 'pile livres audio', noms: ['livres-audio'] });
    const vue = await w.v.module('naglfar')!.view(w.v.ctx('naglfar'), new URLSearchParams());
    const sec = vue.sections.find((x) => x.kind === 'cards' && x.title === 'Conteneurs') as { items: Array<{ title: string; actions?: Array<{ action: string; input: Record<string, unknown> }> }> };
    const titres = sec.items.map((x) => x.title);
    for (const t of ['wiki', 'pile serveur de jeux', 'pile jeux', 'pile notes']) assert.ok(titres.includes(t), t);
    assert.ok(!titres.includes('jeux') && !titres.includes('notes'));
    const valeurs = sec.items.flatMap((x) => (x.actions ?? []).map((a) => String(a.input.conteneur ?? '')));
    assert.ok(valeurs.includes('serveur de jeux')); assert.ok(!valeurs.includes('jeux') && !valeurs.includes('notes'));
  } finally { w.fin(); }
});

/** Les identifiants des applis du catalogue (lus dans Arche elle-même). */
function CATALOGUE_IDS(): string[] { return A.naglfar.actions.filter((a) => a.id.startsWith('deployer_') && a.id !== 'deployer_pile' && a.id !== 'deployer_catalogue').map((a) => a.id.slice(9)); }

// ---- relecture : aucun autre chemin (commande de la discussion, anciens « Démarrer » et « Redémarrer ») ne fait un
// geste que la page refuserait, ni sans la confirmation qu'elle demande ; aucun secret montré par ces chemins.
const PAS_LUI = [{ qui: 'member' }, { auto: true, by: 'automatisation' }, { de: 'midgard' }, { marque: true }];

test('relecture : « stop wiki » écrit dans la discussion part par la commande — au propriétaire seul, avec la confirmation de la page', async () => {
  const w = monde();
  try {
    await peuple(w);
    // la discussion, sans IA : « stop wiki », « start web » sont des commandes de terminal (pas « Arrêter »)
    assert.equal((await w.dit('stop wiki')).direct, 'naglfar.commande {"ligne":"stop wiki"}');
    const ctx = w.v.ctx('naglfar'), g = (input: Record<string, unknown>) => w.v.action('naglfar', 'commande')!.a.grave?.(input, ctx);
    // la même confirmation que l'arrêt de la fiche
    assert.equal(g({ ligne: 'stop wiki' }), w.v.action('naglfar', 'geste_fiche')!.a.grave!({ conteneur: 'wiki', geste: 'arreter' }, ctx));
    assert.match(String(g({ ligne: 'stop -t 5 wiki' })), /^arrêter le conteneur wiki \(/);
    // ni un membre, ni une automatisation, ni une autre appli, ni une conversation marquée : aucun geste, aucune lecture de la fiche
    await w.e.stop('web'); w.journal.length = 0;
    for (const o of PAS_LUI) for (const ligne of ['stop wiki', 'start web', 'restart wiki', 'rm -f cloud-db', 'resize wiki --memory 64m', 'pull registre.maison/wiki:1.0', 'inspect wiki', 'logs wiki', 'service start site']) {
      const r = await w.v.act('naglfar', 'commande', { ligne }, o as never);
      assert.equal(r.ok, false, `${ligne} ${JSON.stringify(o)}`); assert.match(r.text, /seul le propriétaire/, `${ligne} ${JSON.stringify(o)}`);
    }
    assert.deepEqual(w.journal, []); assert.equal(w.e.find('wiki').state.status, 'en marche'); assert.equal(w.e.find('web').state.status, 'arrêté'); assert.ok(w.e.find('cloud-db'));
    // les lectures sans secret restent ouvertes, comme la liste de la page
    for (const ligne of ['ps', 'images', 'service ls']) assert.equal((await w.v.act('naglfar', 'commande', { ligne }, { qui: 'member' })).ok, true, ligne);
    // le propriétaire, lui, garde sa commande ; « stop » attend sa confirmation par la discussion
    assert.match((await w.v.act('naglfar', 'commande', { ligne: 'stop wiki' })).text, /wiki/); assert.equal(w.e.find('wiki').state.status, 'arrêté');
  } finally { w.fin(); }
});

test('relecture : les secrets des variables ne sortent ni par « inspect » ni par les journaux (comme la fiche)', async () => {
  const w = monde();
  try {
    await peuple(w);
    await w.e.create({ image: 'registre.maison/wiki:1.0', name: 'base', network: 'aucun', env: { DB_PASSWORD: 'Tres-Secret-4271', MODE: 'prod' } });
    appendFileSync(w.e.store.log(w.e.find('base').id), `${new Date().toISOString()} o connexion avec Tres-Secret-4271\n`);
    const i = await w.v.act('naglfar', 'commande', { ligne: 'inspect base' });
    assert.equal(i.ok, true, i.text); assert.doesNotMatch(i.text, /Tres-Secret-4271/); assert.match(i.text, /DB_PASSWORD/);
    for (const r of [await w.v.act('naglfar', 'commande', { ligne: 'logs base' }), await w.v.act('naglfar', 'journaux', { conteneur: 'base' })]) {
      assert.match(r.text, /connexion avec/); assert.doesNotMatch(r.text, /Tres-Secret-4271/);
    }
  } finally { w.fin(); }
});

test('relecture : l\'ancien « Démarrer » ne relance sans le propriétaire qu\'un conteneur sorti tout seul ; « Redémarrer », « Grandir » et « Récupérer une image » au propriétaire seul', async () => {
  const w = monde();
  try {
    await peuple(w);
    // web arrêté exprès par le propriétaire : personne d'autre ne le relance (la fiche le refuse aussi)
    await w.e.stop('web'); w.journal.length = 0;
    for (const o of PAS_LUI) {
      for (const [id, input] of [['demarrer', { conteneur: 'web' }], ['redemarrer', { conteneur: 'web' }], ['redemarrer', { conteneur: 'wiki' }], ['grandir', { conteneur: 'wiki' }], ['tirer', { image: 'registre.maison/wiki:1.0' }]] as const) {
        const r = await w.v.act('naglfar', id, input, o as never);
        assert.equal(r.ok, false, `${id} ${JSON.stringify(o)}`); assert.match(r.text, /seul le propriétaire/, `${id} ${JSON.stringify(o)}`);
      }
    }
    assert.deepEqual(w.journal, []); assert.equal(w.e.find('web').state.status, 'arrêté'); assert.equal(w.e.find('wiki').spec.labels['odin.grandir'], undefined);
    // un membre qui le dit : refusé aussi
    assert.match((await w.v.order('redémarre wiki', 'k7-membre', { qui: 'member' })).text, /seul le propriétaire/);
    // sorti tout seul : le soin d'Odin (une automatisation) le relance, comme avant
    w.e.store.saveState(w.e.find('web').id, { status: 'sorti', finishedAt: new Date().toISOString(), exitCode: 1 } as never);
    const r = await w.v.act('naglfar', 'demarrer', { conteneur: 'web' }, { auto: true, by: 'odin', why: 'le conteneur web s\'est arrêté tout seul' });
    assert.equal(r.ok, true, r.text); assert.equal(w.e.find('web').state.status, 'en marche');
    // le propriétaire garde tous ses gestes
    for (const [id, input] of [['redemarrer', { conteneur: 'wiki' }], ['demarrer', { conteneur: 'cloud-app' }]] as const) assert.equal((await w.v.act('naglfar', id, input)).ok, true, id);
  } finally { w.fin(); }
});
