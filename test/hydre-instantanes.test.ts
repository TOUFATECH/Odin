// Hydre, les instantanés d'une VM de ce PC (maquette « Conteneurs et machines » validée, écran 14), côté Odin.
// AUCUNE vraie VM et AUCUN vrai qemu-img : un faux qemu-img tient les instantanés de chaque disque (comme le ferait le
// fichier qcow2) et un faux canal QMP répond à « savevm », « loadvm », « delvm », « stop », « cont » ; le processus de
// la VM est simulé ; la place du disque aussi.
// - prendre : éteinte par qemu-img (-c), allumée par QMP « savevm » (mémoire comprise) ; la liste dit nom, date, taille,
//   automatique ou non ; la place du fichier est rendue ;
// - revenir : confirmation qui dit ce qui est perdu ; un instantané de maintenant d'abord ; allumée : mise en pause,
//   « loadvm », reprise ; un instantané sans mémoire refusé tant qu'elle est allumée ; éteinte : qemu-img (-a) ;
// - retirer : confirmation ; éteinte (-d) ou allumée (« delvm ») ;
// - automatiques : avant une mise à jour faite par Odin dans la machine (refusée sans lui), avant une sauvegarde de
//   Phénix qui lit le dossier de la machine ; ils sont gardés 7 jours (maquette validée) : celui de plus de 7 jours est
//   retiré quand Odin en prend un nouveau pour la même machine (noté « Odin seul » ; un retrait raté aussi), celui de
//   moins de 7 jours jamais, même nombreux ; jamais un instantané pris à la main, jamais celui pris juste avant un
//   retour ; le temps est celui d'Odin (« ctx.now ») ; un ancien réglage « combien en garder » se relit sans erreur (il
//   est ignoré) ; « avant une sauvegarde » n'est pas une action (ni la clé d'API, ni une automatisation, ni une
//   conversation marquée, ni un invité ne l'atteignent) ;
// - un nom d'instantané venu d'ailleurs qui commence par « - » n'est jamais passé à qemu-img ;
// - le budget d'Hydre borne la place (refus chiffré) ; Windows, LXC, modèle : un état clair, rien n'est tenté ;
// - propriétaire seul, noté dans « qui a fait quoi » (les automatiques : « Odin seul »).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { INSTANTANES, instantaneAuto, lireInfo, systemeInstantanes } from '../src/valhalla/ymir/instantanes.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';

const GO = 1024 ** 3, JOUR = 86_400_000;
/** Le jour 0 de l'horloge d'essai : les essais des « 7 jours » posent l'heure d'Odin à partir de là (monde().jour). */
const JOUR_0 = Date.UTC(2026, 9, 1, 3, 0, 0);
const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { sv: { ...systemeVm }, si: { ...systemeInstantanes }, h: { ...hoteVm } };
// Phénix chiffre ses sauvegardes : un mot de passe jetable, le temps de l'essai.
const motAvant = process.env.SINDRI_PASSWORD;
process.env.SINDRI_PASSWORD = 'essai-hydre-instantanes-jetable';
after(() => { if (motAvant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = motAvant; Object.assign(systemeVm, origine.sv); Object.assign(systemeInstantanes, origine.si); Object.assign(hoteVm, origine.h); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

interface Snap { name: string; dateSec: number; vmState: number }
/**
 * Le faux QEMU : par disque, ses instantanés ; par VM, en marche / figée / éteinte. qemu-img refuse d'écrire un disque
 * ouvert par une VM allumée (comme le vrai, qui le verrouille) ; « savevm » d'une VM allumée garde sa mémoire.
 */
function fauxQemu(w: { d: string; qdir: string }) {
  const f = {
    disques: new Map<string, Snap[]>(), vivants: new Set<number>([4242]), figee: false, horloge: 1_800_000_000,
    img: [] as string[][], qmp: [] as string[], loadvm: [] as string[],
  };
  const vmDe = (sock: string) => { const l = JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[]; return l.find((m) => sock.endsWith(`${m.id}.qmp`))!; };
  const disque = (nom: string) => join(w.d, 'vm', nom, 'disque.qcow2');
  const snaps = (file: string) => { if (!f.disques.has(file)) f.disques.set(file, []); return f.disques.get(file)!; };
  const allumeeFichier = (file: string) => { const l = JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[]; const m = l.find((x) => disque(x.nom) === file); if (!m) return false; try { return f.vivants.has(Number(readFileSync(join(w.d, 'vm', m.nom, 'pid'), 'utf8'))); } catch { return false; } };
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = (pid: number) => f.vivants.has(pid);
  systemeVm.dossiersQmp = () => [w.qdir];
  systemeInstantanes.qemuImg = async (_ctx, args) => {
    f.img.push(args);
    const file = args.at(-1)!, l = snaps(file);
    if (args[0] === 'info') { assert.ok(args.includes('-U'), 'lecture partagée (-U) : jamais de verrou sur un disque allumé'); return { code: 0, err: '', out: JSON.stringify({ format: 'qcow2', 'actual-size': 3 * GO + l.reduce((a, x) => a + x.vmState, 0), snapshots: l.map((x, k) => ({ id: String(k + 1), name: x.name, 'date-sec': x.dateSec, 'date-nsec': 0, 'vm-state-size': x.vmState })) }) }; }
    if (allumeeFichier(file)) return { code: 1, out: '', err: 'qemu-img: Could not open: Failed to get "write" lock' };
    const tag = args[2];
    if (args[1] === '-c') { l.push({ name: tag, dateSec: f.horloge++, vmState: 0 }); return { code: 0, out: '', err: '' }; }
    if (args[1] === '-a') return l.some((x) => x.name === tag) ? { code: 0, out: '', err: '' } : { code: 1, out: '', err: 'snapshot not found' };
    if (args[1] === '-d') { const k = l.findIndex((x) => x.name === tag); if (k < 0) return { code: 1, out: '', err: 'snapshot not found' }; l.splice(k, 1); return { code: 0, out: '', err: '' }; }
    return { code: 1, out: '', err: 'essai : commande inattendue' };
  };
  systemeVm.qmp = async (sock: string, execute: string, args?: Record<string, unknown>, timeoutMs?: number) => {
    const m = vmDe(sock), l = snaps(disque(m.nom));
    if (execute === 'human-monitor-command') {
      const [cmd, tag] = String(args?.['command-line']).split(' ');
      f.qmp.push(`${cmd} ${tag}`);
      assert.ok((timeoutMs ?? 0) >= 60_000, 'un instantané avec la mémoire a le temps de se faire');
      if (cmd === 'savevm') { l.push({ name: tag, dateSec: f.horloge++, vmState: (m.ram / 1024) * GO }); return ''; }
      if (cmd === 'loadvm') { const x = l.find((y) => y.name === tag); if (!x) return `Error: Snapshot '${tag}' does not exist`; if (!x.vmState) return 'Error: This is a disk-only snapshot. Revert to it offline using qemu-img'; f.loadvm.push(tag); return ''; }
      if (cmd === 'delvm') { const k = l.findIndex((y) => y.name === tag); if (k >= 0) l.splice(k, 1); return ''; }
      return `essai : ${cmd}`;
    }
    f.qmp.push(execute);
    if (execute === 'stop') { f.figee = true; return {}; }
    if (execute === 'cont') { f.figee = false; return {}; }
    if (execute === 'query-status') return { running: !f.figee, status: f.figee ? 'paused' : 'running' };
    throw new Error(`essai : ${execute}`);
  };
  return f;
}
const VM = (o: Partial<Machine> = {}): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });

/** Un Odin d'essai : vm-web allumée, vm-labo éteinte, un LXC, un modèle ; 200 Go libres sur un disque de 500 Go. */
function monde() {
  const home = neuf('hydre-instantanes-'), qdir = join(home, 'qmp'); mkdirSync(qdir, { recursive: true, mode: 0o700 });
  // L'heure d'Odin (« ctx.now ») : la vraie, tant qu'un essai ne la pose pas (w.jour).
  const horloge = { t: 0 };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
    now: () => new Date(horloge.t || Date.now()),
  });
  const d = join(home, 'valhalla', 'ymir', 'machines');
  const l = [VM(), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81', logiciels: [{ source: 'outil', nom: 'Outil', version: '1.0', at: 0 }] }), VM({ id: 'cc0000000003', nom: 'lxc-web', genre: 'lxc', ip: '10.0.3.82' }), VM({ id: 'dd0000000004', nom: 'vm-modele', ip: '10.0.3.83', estModele: true })];
  for (const [m, pid] of [[l[0], 4242], [l[1], 4343], [l[3], 4444]] as const) { mkdirSync(join(d, 'vm', m.nom), { recursive: true }); writeFileSync(join(d, 'vm', m.nom, 'pid'), String(pid)); writeFileSync(join(d, 'vm', m.nom, 'disque.qcow2'), 'faux disque'); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(d, 'machines.json'), JSON.stringify(l));
  hoteVm.coeurs = () => 8; hoteVm.memoire = () => 32 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  const w = {
    v, home, qdir, d, act: (action: string, input: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => v.act('ymir', action, input, o), fin: () => v.stop(),
    /** pose l'heure d'Odin au jour `n` de l'essai (elle ne bouge plus toute seule ensuite) */
    jour: (n: number) => { horloge.t = JOUR_0 + n * JOUR; },
  };
  return w;
}
type Liste = { instantanes: Array<{ tag: string; nom: string; at: number; memoire: number; auto?: string; detail?: string }>; place: number; machine: { etat: string }; budget: { disqueMaxGo: number }; reglages: { avantMaj: boolean; avantSauvegarde: boolean } };
const liste = async (w: ReturnType<typeof monde>, machine: string) => { const r = await w.act('instantanes_machine', { machine }); assert.equal(r.ok, true, r.text); return r.data as Liste; };
const machineDe = (w: ReturnType<typeof monde>, nom: string) => (JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[]).find((x) => x.nom === nom)!;

test('lire « qemu-img info » : format, place du fichier, instantanés (nom, date, mémoire)', () => {
  const i = lireInfo(JSON.stringify({ format: 'qcow2', 'actual-size': 123, snapshots: [{ id: '1', name: 'odin-a', 'date-sec': 1700000000, 'vm-state-size': 2048 }, { id: '2', name: 'b' }] }));
  assert.deepEqual(i, { format: 'qcow2', place: 123, instantanes: [{ tag: 'odin-a', at: 1700000000000, memoire: 2048 }, { tag: 'b', at: 0, memoire: 0 }] });
  assert.deepEqual(lireInfo('{"format":"qcow2"}').instantanes, []);
  assert.throws(() => lireInfo('pas du json'), /illisible/);
});

test('prendre : éteinte par qemu-img, allumée par QMP « savevm » (mémoire comprise) ; la liste dit nom, date, taille, à la main', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const a = await w.act('prendre_instantane', { machine: 'vm-labo', nom: 'Après l\'installation' });
    assert.equal(a.ok, true, a.text); assert.match(a.text, /vm-labo : instantané pris \(« Après l'installation »\)\./);
    const c = f.img.find((x) => x[0] === 'snapshot')!;
    assert.deepEqual(c.slice(0, 2), ['snapshot', '-c']); assert.match(c[2], /^odin-\d{8}-\d{6}-[0-9a-f]{4}$/, 'un nom sûr pour QEMU, pas le nom donné'); assert.equal(c[3], join(w.d, 'vm', 'vm-labo', 'disque.qcow2'));
    assert.deepEqual(f.qmp, [], 'éteinte : rien par QMP');
    const b = await w.act('prendre_instantane', { machine: 'vm-web' });
    assert.equal(b.ok, true, b.text); assert.match(b.text, /mémoire comprise/);
    assert.equal(f.qmp.length, 1); assert.match(f.qmp[0], /^savevm odin-\d{8}-\d{6}-[0-9a-f]{4}$/);
    assert.equal(f.img.filter((x) => x[0] === 'snapshot').length, 1, 'allumée : jamais qemu-img en écriture');
    const l = await liste(w, 'vm-web');
    assert.equal(l.machine.etat, 'en marche'); assert.equal(l.instantanes.length, 1);
    assert.deepEqual([l.instantanes[0].nom, l.instantanes[0].memoire, l.instantanes[0].auto], ['', 2 * GO, undefined]);
    assert.ok(l.instantanes[0].at > 0); assert.equal(l.place, 5 * GO, 'la place du disque et de ses instantanés');
    const lb = await liste(w, 'vm-labo');
    assert.equal(lb.instantanes[0].nom, 'Après l\'installation'); assert.equal(lb.instantanes[0].memoire, 0);
    assert.equal(lb.budget.disqueMaxGo, 150, 'le budget d\'Hydre : 200 Go libres moins 50 Go gardés');
  } finally { w.fin(); }
});

test('revenir : confirmation qui dit ce qui est perdu ; instantané de maintenant d\'abord ; allumée : pause, « loadvm », reprise', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const p = await w.act('prendre_instantane', { machine: 'vm-web', nom: 'Avant essai' }); assert.equal(p.ok, true, p.text);
    const tag = (await liste(w, 'vm-web')).instantanes[0].tag;
    const g = w.v.action('ymir', 'revenir_instantane')!.a.grave!({ machine: 'e5c4b3a2f1d0', instantane: 'Avant essai' }, w.v.ctx('ymir'));
    assert.match(String(g), /machine vm-web à l'instantané « Avant essai » : tout ce qui a changé dedans depuis \(fichiers, réglages\) est perdu ; Odin prend d'abord un instantané de maintenant/);
    f.qmp.length = 0;
    const r = await w.act('revenir_instantane', { machine: 'vm-web', instantane: 'Avant essai' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /vm-web est revenue à « Avant essai »/); assert.match(r.text, /Pour annuler, reviens à « Avant de revenir à « Avant essai » »/);
    assert.equal(f.qmp.length, 4, f.qmp.join(' | ')); assert.match(f.qmp[0], /^savevm odin-/); assert.deepEqual(f.qmp.slice(1), ['stop', `loadvm ${tag}`, 'cont']);
    assert.equal(f.figee, false, 'elle repart');
    const l = await liste(w, 'vm-web');
    assert.equal(l.instantanes.length, 2); assert.deepEqual([l.instantanes[1].auto, l.instantanes[1].detail], ['retour', 'Avant essai']);
    // En pause : elle reste en pause après le retour.
    const ms = JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[]; ms[0].pause = { depuis: 1 }; writeFileSync(join(w.d, 'machines.json'), JSON.stringify(ms)); f.figee = true; f.qmp.length = 0;
    assert.equal((await w.act('revenir_instantane', { machine: 'vm-web', instantane: tag })).ok, true);
    assert.deepEqual(f.qmp.slice(1), [`loadvm ${tag}`]); assert.equal(f.figee, true);
  } finally { w.fin(); }
});

test('revenir : un instantané pris éteinte est refusé tant qu\'elle est allumée ; éteinte, qemu-img -a ; introuvable refusé', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    f.vivants.delete(4242); // vm-web éteinte : son instantané est sans mémoire
    assert.equal((await w.act('prendre_instantane', { machine: 'vm-web', nom: 'Disque seul' })).ok, true);
    f.vivants.add(4242); f.qmp.length = 0; const avant = f.img.length;
    const r = await w.act('revenir_instantane', { machine: 'vm-web', instantane: 'Disque seul' });
    assert.equal(r.ok, false); assert.match(r.text, /pris machine éteinte : il ne garde pas la mémoire\. Éteins d'abord vm-web/);
    assert.deepEqual(f.qmp, [], 'rien n\'a été touché'); assert.equal(f.img.slice(avant).filter((x) => x[0] !== 'info').length, 0);
    f.vivants.delete(4242);
    const ok = await w.act('revenir_instantane', { machine: 'vm-web', instantane: 'Disque seul' });
    assert.equal(ok.ok, true, ok.text);
    const ecrits = f.img.filter((x) => x[0] === 'snapshot').map((x) => x[1]); assert.deepEqual(ecrits, ['-c', '-c', '-a'], 'instantané de maintenant (-c), puis retour (-a)');
    assert.match((await w.act('revenir_instantane', { machine: 'vm-web', instantane: 'inconnu' })).text, /instantané introuvable pour vm-web/);
  } finally { w.fin(); }
});

test('retirer : confirmation ; éteinte (qemu-img -d), allumée (« delvm »)', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    await w.act('prendre_instantane', { machine: 'vm-labo', nom: 'Un' }); await w.act('prendre_instantane', { machine: 'vm-web', nom: 'Deux' });
    assert.match(String(w.v.action('ymir', 'retirer_instantane')!.a.grave!({ machine: 'vm-labo', instantane: 'Un' }, w.v.ctx('ymir'))), /retirer l'instantané « Un » de la machine vm-labo : on ne pourra plus y revenir/);
    const a = await w.act('retirer_instantane', { machine: 'vm-labo', instantane: 'Un' });
    assert.equal(a.ok, true, a.text); assert.deepEqual(f.img.filter((x) => x[0] === 'snapshot').at(-1)!.slice(0, 2), ['snapshot', '-d']);
    assert.equal((await liste(w, 'vm-labo')).instantanes.length, 0);
    const b = await w.act('retirer_instantane', { machine: 'vm-web', instantane: 'Deux' });
    assert.equal(b.ok, true, b.text); assert.match(f.qmp.at(-1)!, /^delvm odin-/);
    assert.equal((await liste(w, 'vm-web')).instantanes.length, 0);
  } finally { w.fin(); }
});

test('budget d\'Hydre : un instantané qui ne tient pas est refusé, chiffres à l\'appui ; place illisible : refusé', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    hoteVm.disque = () => ({ total: 500 * GO, libre: 52 * GO }); // 52 - 50 gardés = 2 Go : la mémoire (2 Go) + 1 Go de marge ne tient pas
    const r = await w.act('prendre_instantane', { machine: 'vm-web' });
    assert.equal(r.ok, false); assert.match(r.text, /pas assez de place pour un instantané de vm-web : il faut environ 3 Go \(sa mémoire, 2 Go, plus 1 Go de marge\) et le budget d'Hydre en laisse 2 Go \(52 Go libres, 50 Go gardés pour Odin et tes fichiers\)/);
    assert.deepEqual(f.qmp, []);
    assert.equal((await w.act('prendre_instantane', { machine: 'vm-labo' })).ok, true, 'éteinte : sans mémoire, 1 Go suffit');
    hoteVm.disque = () => undefined;
    assert.match((await w.act('prendre_instantane', { machine: 'vm-labo' })).text, /ne sait pas lire la place libre/);
  } finally { w.fin(); }
});

test('automatiques : avant une mise à jour faite par Odin dans la machine ; sans instantané possible, pas de mise à jour', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    // Hermès a une version plus récente d'un logiciel de vm-labo.
    w.v.action('fjalar', 'bibliotheque_logiciels')!.a.run = async () => ({ text: '', data: { fichiers: [{ produit: 'Outil', nom: 'outil.deb', version: '2.0', chemin: join(w.home, 'outil.deb'), antivirus: { verdict: 'sain' } }] } });
    const r = await w.act('mettre_a_jour_logiciels', { machine: 'vm-labo' }, { by: 'toi' });
    const l = await liste(w, 'vm-labo');
    assert.equal(l.instantanes.length, 1, r.text); assert.equal(l.instantanes[0].auto, 'maj');
    assert.match(r.text, /vm-labo : instantané pris \(avant la mise à jour\)/);
    // Plus de place : la mise à jour n'est pas faite.
    hoteVm.disque = () => ({ total: 500 * GO, libre: 50 * GO });
    const n = await w.act('mettre_a_jour_logiciels', { machine: 'vm-labo' }, { by: 'toi' });
    assert.equal(n.ok, false); assert.match(n.text, /pas de mise à jour sans l'instantané d'avant/);
    // Réglage coupé : la mise à jour se fait sans instantané.
    assert.equal((await w.act('reglages_instantanes', { avant_maj: false })).ok, true);
    const avant = f.img.filter((x) => x[0] === 'snapshot').length;
    const s = await w.act('mettre_a_jour_logiciels', { machine: 'vm-labo' }, { by: 'toi' });
    assert.doesNotMatch(s.text, /pas de mise à jour sans/); assert.equal(f.img.filter((x) => x[0] === 'snapshot').length, avant);
  } finally { w.fin(); }
});

test('automatiques, gardés 7 jours : celui de 8 jours est retiré au prochain automatique de la machine, noté « Odin seul »', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const ctx = w.v.ctx('ymir'), labo = machineDe(w, 'vm-labo'), retraits = () => f.img.filter((x) => x[1] === '-d').length;
    const autos = async () => (await liste(w, 'vm-labo')).instantanes.map((x) => `${x.auto}:${x.detail ?? ''}`);
    w.jour(0); assert.equal((await instantaneAuto(ctx, labo, 'sauvegarde', 'Nuit')).ok, true);
    // 7 jours pile, ce n'est pas « plus de 7 jours » : il reste.
    w.jour(7); assert.equal((await instantaneAuto(ctx, labo, 'maj')).ok, true);
    assert.deepEqual(await autos(), ['sauvegarde:Nuit', 'maj:']); assert.equal(retraits(), 0);
    // 8 jours : le temps seul ne retire rien, un automatique pris pour une AUTRE machine non plus.
    w.jour(8); assert.equal((await instantaneAuto(ctx, machineDe(w, 'vm-web'), 'sauvegarde', 'Nuit')).ok, true);
    assert.deepEqual(await autos(), ['sauvegarde:Nuit', 'maj:']); assert.equal(retraits(), 0);
    // Le prochain automatique de vm-labo : celui de 8 jours part, celui d'un jour reste.
    assert.equal((await instantaneAuto(ctx, labo, 'sauvegarde', 'Semaine')).ok, true);
    assert.deepEqual(await autos(), ['maj:', 'sauvegarde:Semaine'], 'celui de 8 jours est retiré, les deux récents restent');
    assert.equal(retraits(), 1, 'un seul retrait dans le disque');
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /Odin seul · Retirer un instantané de plus de 7 jours \(machine : vm-labo\) · fait : .*vm-labo : instantané du \d\d\/\d\d\/\d{4} \d\d:\d\d retiré \(pris tout seul, gardé 7 jours\) : « Avant la sauvegarde « Nuit » »/);
    assert.equal(j.split('\n').filter((x) => /Retirer un instantané de plus de 7 jours/.test(x)).length, 1, 'un retrait, une ligne');
    assert.equal(INSTANTANES.garderAutoJours, 7, 'le nombre de la maquette validée');
  } finally { w.fin(); }
});

test('automatiques, gardés 7 jours : à 6 jours aucun n\'est retiré, même nombreux', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const ctx = w.v.ctx('ymir'), labo = machineDe(w, 'vm-labo');
    // Deux par jour pendant six jours (une mise à jour, une sauvegarde) : au treizième, le plus ancien a 6 jours.
    for (let k = 0; k <= 12; k++) { w.jour(k / 2); assert.equal((await instantaneAuto(ctx, labo, k % 2 ? 'sauvegarde' : 'maj', 'Nuit')).ok, true, `automatique ${k + 1}`); }
    assert.equal((await liste(w, 'vm-labo')).instantanes.length, 13, 'treize automatiques de 6 jours au plus : tous gardés');
    assert.equal(f.img.filter((x) => x[1] === '-d').length, 0, 'rien retiré dans le disque');
    assert.doesNotMatch((await w.act('qui_a_fait')).text, /Retirer un instantané/);
  } finally { w.fin(); }
});

test('automatiques, gardés 7 jours : un instantané pris à la main il y a 30 jours est gardé (et celui qu\'Odin n\'a pas pris)', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const ctx = w.v.ctx('ymir'), labo = machineDe(w, 'vm-labo');
    // Un instantané déjà dans le disque, qu'Odin n'a pas pris (disque importé), très ancien.
    f.disques.set(join(w.d, 'vm', 'vm-labo', 'disque.qcow2'), [{ name: 'ancien', dateSec: 1_600_000_000, vmState: 0 }]);
    w.jour(0); assert.equal((await w.act('prendre_instantane', { machine: 'vm-labo', nom: 'Manuel' })).ok, true);
    w.jour(1); assert.equal((await instantaneAuto(ctx, labo, 'maj')).ok, true);
    w.jour(30); assert.equal((await instantaneAuto(ctx, labo, 'sauvegarde', 'Nuit')).ok, true);
    const l = (await liste(w, 'vm-labo')).instantanes;
    assert.deepEqual(l.map((x) => x.auto ?? `main:${x.nom}`), ['main:ancien', 'main:Manuel', 'sauvegarde'], 'le manuel de 30 jours et l\'instantané venu d\'ailleurs restent ; l\'automatique de 29 jours est parti');
    assert.equal(f.img.filter((x) => x[1] === '-d').length, 1, 'un seul retrait : l\'automatique');
  } finally { w.fin(); }
});

test('automatiques, gardés 7 jours : un retrait raté est noté « pas fait », l\'instantané pris reste bon, et c\'est repris au prochain', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    const ctx = w.v.ctx('ymir'), labo = machineDe(w, 'vm-labo'), faux = systemeInstantanes.qemuImg;
    w.jour(0); assert.equal((await instantaneAuto(ctx, labo, 'maj')).ok, true);
    // qemu-img refuse de retirer (le disque est pris ailleurs).
    systemeInstantanes.qemuImg = async (c, args, t) => (args[1] === '-d' ? { code: 1, out: '', err: 'qemu-img: disque occupé' } : faux(c, args, t));
    w.jour(8); const r = await instantaneAuto(ctx, labo, 'sauvegarde', 'Nuit');
    assert.equal(r.ok, true, r.texte); assert.match(r.texte, /vm-labo : instantané pris/);
    assert.deepEqual((await liste(w, 'vm-labo')).instantanes.map((x) => x.auto), ['maj', 'sauvegarde'], 'rien n\'est parti');
    assert.match((await w.act('qui_a_fait')).text, /Odin seul · Retirer un instantané de plus de 7 jours \(machine : vm-labo\) · pas fait : .*disque occupé \(instantané du \d\d\/\d\d\/\d{4} \d\d:\d\d\)/);
    systemeInstantanes.qemuImg = faux;
    w.jour(9); assert.equal((await instantaneAuto(ctx, labo, 'sauvegarde', 'Nuit')).ok, true);
    assert.deepEqual((await liste(w, 'vm-labo')).instantanes.map((x) => x.auto), ['sauvegarde', 'sauvegarde'], 'repris : celui de 9 jours est parti');
    assert.equal(f.img.filter((x) => x[1] === '-d').length, 1);
  } finally { w.fin(); }
});

test('un ancien réglage « combien en garder » (garderAuto) se relit sans erreur : il est ignoré, et « garder » n\'est plus un réglage', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    // Rangé par la version d'avant dans le fichier des réglages d'Hydre, relu par Odin.
    writeFileSync(join(w.home, 'valhalla', 'ymir', 'réglages.json'), JSON.stringify({ instantanes: { avantMaj: false, avantSauvegarde: true, garderAuto: 1 } }));
    const ctx = w.v.ctx('ymir'), labo = machineDe(w, 'vm-labo');
    assert.deepEqual(ctx.settings.instantanes, { avantMaj: false, avantSauvegarde: true, garderAuto: 1 }, 'l\'ancien réglage est bien celui qu\'Odin relit');
    assert.deepEqual((await liste(w, 'vm-labo')).reglages, { avantMaj: false, avantSauvegarde: true }, 'relu sans erreur, « garderAuto » ignoré');
    // « Un seul gardé » ne vaut plus : trois automatiques en trois jours restent tous les trois.
    for (let k = 0; k < 3; k++) { w.jour(k); assert.equal((await instantaneAuto(ctx, labo, 'sauvegarde', `p${k}`)).ok, true); }
    assert.deepEqual((await liste(w, 'vm-labo')).instantanes.map((x) => x.detail), ['p0', 'p1', 'p2']);
    assert.equal(f.img.filter((x) => x[1] === '-d').length, 0);
    // Ce qui reste se règle comme avant ; « garder » n'est plus un paramètre, et n'est plus rangé.
    assert.deepEqual(w.v.action('ymir', 'reglages_instantanes')!.a.params!.map((p) => p.key), ['avant_maj', 'avant_sauvegarde']);
    const r = await w.act('reglages_instantanes', { avant_maj: true });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Instantanés automatiques : avant chaque mise à jour, avant chaque sauvegarde ; gardés 7 jours/);
    assert.deepEqual(ctx.settings.instantanes, { avantMaj: true, avantSauvegarde: true });
    assert.deepEqual(JSON.parse(readFileSync(join(w.home, 'valhalla', 'ymir', 'réglages.json'), 'utf8')).instantanes, { avantMaj: true, avantSauvegarde: true });
  } finally { w.fin(); }
});

test('automatiques : avant une sauvegarde de Phénix qui lit le dossier de la machine (et seulement celle-là)', async () => {
  const w = monde(), f = fauxQemu(w);
  setValhalla(w.v); // Phénix trouve Hydre dans l'Odin qui tourne (comme au démarrage d'Odin)
  try {
    f.vivants.delete(4242);
    const vmDir = join(w.d, 'vm', 'vm-web');
    assert.notEqual((await w.v.act('sindri', 'creer', { nom: 'Machines', dossiers: vmDir, destination: 'disque', depot: join(neuf('hydre-inst-depot-'), 'd') })).ok, false);
    const r = await w.v.act('sindri', 'sauvegarder', { plan: 'Machines' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /vm-web/);
    const l = (await liste(w, 'vm-web')).instantanes;
    assert.equal(l.length, 1); assert.deepEqual([l[0].auto, l[0].detail], ['sauvegarde', 'Machines']);
    assert.equal((await liste(w, 'vm-labo')).instantanes.length, 0, 'vm-labo n\'est pas dans ce plan');
    // Réglage coupé : plus d'instantané avant la sauvegarde.
    await w.act('reglages_instantanes', { avant_sauvegarde: false });
    await w.v.act('sindri', 'sauvegarder', { plan: 'Machines' });
    assert.equal((await liste(w, 'vm-web')).instantanes.length, 1);
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /Odin seul · Instantané avant la sauvegarde \(machine : vm-web\) · fait/);
  } finally { setValhalla(undefined); w.fin(); }
});

test('avant une sauvegarde : pas une action ; ni la clé d\'API, ni une automatisation, ni une conversation marquée, ni un invité n\'y arrivent', async () => {
  const w = monde(), f = fauxQemu(w);
  setValhalla(w.v);
  try {
    assert.equal(w.v.action('ymir', 'instantanes_avant_sauvegarde'), undefined, 'rien à appeler de l\'extérieur');
    const cle = await valhallaPost('/api/valhalla/act', { module: 'ymir', action: 'instantanes_avant_sauvegarde', input: { dossiers: w.home, plan: 'x' }, confirm: true }) as { ok: boolean };
    assert.equal(cle.ok, false, 'la clé d\'API');
    for (const o of [{ auto: true, by: 'automatisation' }, { marque: true }, { qui: 'guest' }, { by: 'réflexe' }]) assert.equal((await w.act('instantanes_avant_sauvegarde', { dossiers: w.home, plan: 'x' }, o)).ok, false, JSON.stringify(o));
    assert.deepEqual(f.qmp, []); assert.equal(f.img.length, 0, 'aucun disque touché');
    // Seule une vraie sauvegarde de Phénix y mène ; jamais pour un membre ; rien si Hydre est désactivée.
    const { instantanesAvantSauvegarde } = await import('../src/valhalla/ymir/instantanes.ts');
    const phenix = w.v.ctx('sindri'), dossier = join(w.d, 'vm', 'vm-web');
    assert.deepEqual(await auNomDe({ login: 'lea', name: 'Léa', groups: [] }, () => instantanesAvantSauvegarde(phenix, [dossier], 'Nuit')), []);
    assert.equal((await w.v.activer('ymir', false)).ok, true);
    assert.deepEqual(await instantanesAvantSauvegarde(phenix, [dossier], 'Nuit'), []);
    assert.deepEqual(f.qmp, []); assert.equal(f.img.length, 0, 'aucun disque touché');
    assert.equal((await w.v.activer('ymir', true)).ok, true);
    const l = await instantanesAvantSauvegarde(phenix, [dossier], 'Nuit');
    assert.deepEqual(l.map((x) => [x.nom, x.ok]), [['vm-web', true]], 'la sauvegarde du propriétaire, elle, le prend');
  } finally { setValhalla(undefined); w.fin(); }
});

test('revenir : l\'instantané pris juste avant n\'est jamais retiré seul, même après 30 jours (« pour annuler » reste possible)', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    f.vivants.delete(4242); // vm-web éteinte
    const ctx = w.v.ctx('ymir'), web = machineDe(w, 'vm-web');
    w.jour(0); assert.equal((await w.act('prendre_instantane', { machine: 'vm-web', nom: 'Manuel' })).ok, true);
    w.jour(1); const r = await w.act('revenir_instantane', { machine: 'vm-web', instantane: 'Manuel' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Pour annuler, reviens à « Avant de revenir à « Manuel » »/);
    w.jour(2); assert.equal((await instantaneAuto(ctx, web, 'sauvegarde', 'p0')).ok, true);
    // 30 jours après le retour : l'automatique d'alors part au prochain automatique ; ni le manuel, ni le point de retour.
    w.jour(31); assert.equal((await instantaneAuto(ctx, web, 'sauvegarde', 'p1')).ok, true);
    const l = (await liste(w, 'vm-web')).instantanes;
    assert.deepEqual(l.filter((x) => x.auto !== 'sauvegarde').map((x) => `${x.auto ?? 'main'}:${x.nom || x.detail}`), ['main:Manuel', 'retour:Manuel'], 'le manuel et le point de retour restent');
    assert.deepEqual(l.filter((x) => x.auto === 'sauvegarde').map((x) => x.detail), ['p1'], 'seul l\'automatique de plus de 7 jours est parti');
    assert.equal(f.img.filter((x) => x[1] === '-d').length, 1);
    // « Pour annuler » : on y revient encore.
    w.jour(32); const a = await w.act('revenir_instantane', { machine: 'vm-web', instantane: l.find((x) => x.auto === 'retour')!.tag });
    assert.equal(a.ok, true, a.text); assert.match(a.text, /vm-web est revenue à « Avant de revenir à « Manuel » »/);
    assert.match((await w.act('reglages_instantanes')).text, /gardés 7 jours \(ceux pris à la main et ceux d'avant un retour ne sont jamais retirés seuls\)/);
  } finally { w.fin(); }
});

test('un instantané venu d\'ailleurs dont le nom commence par « - » n\'est jamais passé à qemu-img (il y serait lu comme une option)', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    f.vivants.delete(4242);
    f.disques.set(join(w.d, 'vm', 'vm-web', 'disque.qcow2'), [{ name: '-U', dateSec: 1, vmState: 0 }, { name: '--force-share', dateSec: 2, vmState: 0 }]);
    for (const t of ['-U', '--force-share']) {
      assert.match((await w.act('revenir_instantane', { machine: 'vm-web', instantane: t })).text, /caractères qu'il ne passe pas à QEMU/, t);
      assert.match((await w.act('retirer_instantane', { machine: 'vm-web', instantane: t })).text, /caractères qu'il ne passe pas à QEMU/, t);
    }
    assert.deepEqual(f.img.filter((x) => x[0] === 'snapshot'), [], 'rien d\'écrit : ni retour, ni retrait, ni instantané de maintenant');
    assert.deepEqual(f.qmp, []);
  } finally { w.fin(); }
});

test('propriétaire seul, noté dans « qui a fait quoi » ; un membre ne déclenche pas l\'instantané d\'avant sauvegarde', async () => {
  const w = monde(), f = fauxQemu(w);
  setValhalla(w.v);
  try {
    for (const id of ['instantanes_machine', 'prendre_instantane', 'revenir_instantane', 'retirer_instantane', 'reglages_instantanes']) { const a = w.v.action('ymir', id)?.a; assert.equal(a?.proprietaireSeul, true, id); assert.notEqual(a?.read, true, id); assert.equal(a?.quick, false, id); }
    const refus = /seul le propriétaire/;
    for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }, { by: 'assistant', auto: true }, { marque: true }]) {
      assert.match((await w.act('prendre_instantane', { machine: 'vm-web' }, o)).text, refus);
      assert.match((await w.act('instantanes_machine', { machine: 'vm-web' }, o)).text, refus);
      assert.match((await w.act('reglages_instantanes', { avant_maj: false }, o)).text, refus);
    }
    assert.equal(w.v.ctx('ymir').settings.instantanes, undefined, 'aucun refusé n\'a changé le réglage');
    const cle = await valhallaPost('/api/valhalla/act', { module: 'ymir', action: 'prendre_instantane', input: { machine: 'vm-web' }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false); assert.match(cle.text, /pas avec la clé d'API/);
    // Un membre : l'instantané d'avant sauvegarde n'est pas pris (même par ce que Phénix appelle, droits de l'appli mis à part).
    const { instantanesAvantSauvegarde } = await import('../src/valhalla/ymir/instantanes.ts');
    const mb = await auNomDe({ login: 'lea', name: 'Léa', groups: [] }, () => instantanesAvantSauvegarde(w.v.ctx('sindri'), [join(w.d, 'vm', 'vm-web')], 'Nuit'));
    assert.deepEqual(mb, [], 'rien pris pour un membre');
    assert.deepEqual(f.qmp, []); assert.equal(f.img.length, 0, 'aucun refusé n\'a touché un disque');
    await w.act('prendre_instantane', { machine: 'vm-web', nom: 'Essai' });
    await w.act('retirer_instantane', { machine: 'vm-web', instantane: 'Essai' });
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /propriétaire · Prendre un instantané \(machine : vm-web · nom : Essai\) · fait/);
    assert.match(j, /propriétaire · Retirer l'instantané \(machine : vm-web · instantane : Essai\) · fait/);
  } finally { setValhalla(undefined); w.fin(); }
});

test('sous Windows, un LXC, un modèle : un état clair, rien n\'est tenté', async () => {
  const w = monde(), f = fauxQemu(w);
  try {
    systemeVm.plateforme = () => 'win32';
    const win = await w.act('instantanes_machine', { machine: 'vm-web' });
    assert.equal(win.ok, false); assert.match(win.text, /Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre : leurs instantanés non plus/); assert.equal((win.data as { etat: string }).etat, 'moteur');
    assert.match((await w.act('prendre_instantane', { machine: 'vm-web' })).text, /Sous Windows/);
    systemeVm.plateforme = () => 'linux';
    const lxc = await w.act('instantanes_machine', { machine: 'lxc-web' });
    assert.equal(lxc.ok, false); assert.equal((lxc.data as { etat: string }).etat, 'lxc'); assert.match(lxc.text, /seulement pour les VM/);
    assert.match((await w.act('prendre_instantane', { machine: 'vm-modele' })).text, /est un modèle/);
    assert.match((await w.act('prendre_instantane', { machine: 'aucune' })).text, /machine introuvable/);
    assert.equal(f.img.length, 0); assert.deepEqual(f.qmp, []);
  } finally { systemeVm.plateforme = () => 'linux'; w.fin(); }
});
