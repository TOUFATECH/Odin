// Hydre, cloner et exporter une VM de ce PC (maquette « Conteneurs et machines » validée, écran 15), côté Odin.
// AUCUNE vraie VM, AUCUN vrai qemu-img ni qemu : les commandes des copies passent par un faux (systemeCopies), le canal
// QMP et les instantanés aussi ; seul l'outil d'archive du système (tar) est vraiment lancé, sur des dossiers d'essai.
// - cloner : complète (un disque à elle) ou liée (elle partage le disque d'un MODÈLE) ; nom pris refusé ; budget d'Hydre
//   (refus chiffré) ; une copie liée depuis une machine qui n'est pas un modèle : refusée ; le modèle d'une copie liée
//   ne se supprime pas, ne redevient pas une machine, ne change pas de disque, et le lien ne se retire pas à la main ;
// - exporter : éteinte, telle quelle ; allumée, par un instantané (elle continue de tourner), retiré ensuite ; l'empreinte
//   est revérifiée APRÈS la copie, et un fichier abîmé en route fait échouer l'export (rien n'est gardé) ;
// - importer : un .ody passe par l'antivirus ; sans antivirus, rien n'est importé ;
// - propriétaire seul (membre, tablette « maison », clé d'API refusés), noté dans « qui a fait quoi » ;
// - sous Windows : un état clair, rien n'est tenté.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer as serveurHttp } from 'node:http';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { systemeInstantanes } from '../src/valhalla/ymir/instantanes.ts';
import { besoinExportGo, systemeCopies } from '../src/valhalla/ymir/copies.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';

const GO = 1024 ** 3;
/** Cloner une VM au-delà du budget sans accord (celui de l'essai l'est) : le propriétaire confirme. */
const OUI = { confirm: true };
const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { sv: { ...systemeVm }, si: { ...systemeInstantanes }, sc: { ...systemeCopies }, h: { ...hoteVm } };
after(() => { Object.assign(systemeVm, origine.sv); Object.assign(systemeInstantanes, origine.si); Object.assign(systemeCopies, origine.sc); Object.assign(hoteVm, origine.h); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// Sous Windows, le tar de Git lit « C:\… » comme une machine distante ; celui du système (bsdtar) lit les lettres de lecteur.
const TAR = process.platform === 'win32' && existsSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')) ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const VM = (o: Partial<Machine> = {}): Machine => ({ id: 'e5c4b3a2f1d0', nom: 'vm-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.80', mac: '02:0d:1e:00:00:08', cree: 0, apps: [], paquets: [], ...o });

/**
 * Un Odin d'essai : vm-web allumée, vm-labo éteinte, vm-base (un modèle), vm-bureau (Windows, éteinte) ; 200 Go libres
 * sur un disque de 500 Go. Le faux QEMU : qemu-img « create » (copie liée), « convert » (copie complète, export), « info »
 * et les instantanés ; QMP « savevm » / « delvm ».
 */
function monde() {
  const home = neuf('hydre-copies-'), qdir = join(home, 'qmp'); mkdirSync(qdir, { recursive: true, mode: 0o700 });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const d = join(home, 'valhalla', 'ymir', 'machines');
  const l = [VM(), VM({ id: 'aa0000000002', nom: 'vm-labo', ip: '10.0.3.81' }), VM({ id: 'bb0000000003', nom: 'vm-base', ip: '10.0.3.82', estModele: true, arretVoulu: true }), VM({ id: 'cc0000000004', nom: 'vm-bureau', ip: '10.0.3.83', systeme: 'Windows', version: '11', famille: 'Windows' })];
  const pids: Record<string, number> = { 'vm-web': 4242, 'vm-labo': 4343, 'vm-base': 4444, 'vm-bureau': 4545 };
  for (const m of l) { mkdirSync(join(d, 'vm', m.nom), { recursive: true }); writeFileSync(join(d, 'vm', m.nom, 'pid'), String(pids[m.nom])); writeFileSync(join(d, 'vm', m.nom, 'disque.qcow2'), `disque de ${m.nom} `.repeat(200)); writeFileSync(join(d, 'vm', m.nom, 'vm.json'), JSON.stringify(m)); writeFileSync(join(qdir, `${m.id}.qmp`), ''); }
  writeFileSync(join(d, 'machines.json'), JSON.stringify(l));
  hoteVm.coeurs = () => 8; hoteVm.memoire = () => 32 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  const f = { vivants: new Set<number>([4242]), cmds: [] as string[][], qmp: [] as string[], abimer: false, backing: '', checkKo: false, snaps: new Map<string, Array<{ name: string; vmState: number }>>() };
  const lesSnaps = (file: string) => { if (!f.snaps.has(file)) f.snaps.set(file, []); return f.snaps.get(file)!; };
  const machines = () => JSON.parse(readFileSync(join(d, 'machines.json'), 'utf8')) as Machine[];
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = (pid: number) => f.vivants.has(pid);
  systemeVm.dossiersQmp = () => [qdir];
  systemeInstantanes.qemuImg = async (_c, args) => {
    f.cmds.push(['qemu-img', ...args]);
    if (args[0] === 'info') { const s = lesSnaps(args.at(-1)!); return { code: 0, err: '', out: JSON.stringify({ format: 'qcow2', 'actual-size': GO, snapshots: s.map((x, k) => ({ id: String(k + 1), name: x.name, 'date-sec': 1_800_000_000 + k, 'vm-state-size': x.vmState })) }) }; }
    return { code: 1, out: '', err: 'essai : commande inattendue' };
  };
  systemeVm.qmp = async (sock: string, execute: string, args?: Record<string, unknown>) => {
    const m = machines().find((x) => sock.endsWith(`${x.id}.qmp`))!, s = lesSnaps(join(d, 'vm', m.nom, 'disque.qcow2'));
    if (execute === 'human-monitor-command') {
      const [cmd, tag] = String(args?.['command-line']).split(' '); f.qmp.push(`${cmd} ${tag}`);
      if (cmd === 'savevm') { s.push({ name: tag, vmState: (m.ram / 1024) * GO }); return ''; }
      if (cmd === 'delvm') { const k = s.findIndex((x) => x.name === tag); if (k >= 0) s.splice(k, 1); return ''; }
      return `essai : ${cmd}`;
    }
    f.qmp.push(execute); throw new Error(`essai : ${execute}`);
  };
  systemeCopies.run = async (_ctx, cmd, args) => {
    f.cmds.push([cmd, ...args]);
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    // Le disque d'une VM importée : « info » dit s'il s'appuie sur un autre fichier (un .ody piégé) ; « check » relit une copie.
    if (cmd === 'qemu-img' && args[0] === 'info') return { code: 0, err: '', out: JSON.stringify({ format: 'qcow2', 'virtual-size': 32 * GO, ...(f.backing ? { 'backing-filename': f.backing, 'full-backing-filename': f.backing } : {}) }) };
    if (cmd === 'qemu-img' && args[0] === 'check') return f.checkKo ? { code: 2, out: '', err: 'essai : 3 errors were found on the image' } : { code: 0, out: 'No errors were found on the image.', err: '' };
    if (cmd === 'qemu-img' && args[0] === 'create') { writeFileSync(args.at(-1)!, `copie liée sur ${args[args.indexOf('-b') + 1]}`); return { code: 0, out: '', err: '' }; }
    if (cmd === 'qemu-img' && args[0] === 'convert') {
      const src = args.at(-2)!, l = args.indexOf('-l'), tag = l >= 0 ? args[l + 1].replace(/^snapshot\.name=/, '') : '';
      // Un instantané demandé doit exister dans le disque (sinon qemu-img refuse) ; la copie dit d'où elle vient.
      if (tag && !lesSnaps(src).some((x) => x.name === tag)) return { code: 1, out: '', err: 'snapshot not found' };
      copyFileSync(src, args.at(-1)!); if (tag) appendFileSync(args.at(-1)!, `(instantané ${tag})`);
      return { code: 0, out: '', err: '' };
    }
    if (cmd === 'tar') {
      // Abîmé en route : l'archive intérieure change entre son empreinte et le fichier écrit.
      if (f.abimer && args.includes('-cf')) appendFileSync(join(args[args.indexOf('-C') + 1], 'machine.tgz'), 'abîmé');
      return new Promise((ok) => execFile(TAR, args.filter((x) => x !== '--numeric-owner'), { maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? 1 : 0, out, err })));
    }
    return { code: 1, out: '', err: `essai : commande inattendue ${cmd}` };
  };
  return { v, home, d, f, machines, act: (action: string, input: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => v.act('ymir', action, input, o), fin: () => v.stop() };
}

test('cloner, complète : un disque à elle, nouvelle adresse et nouvelle carte réseau ; nom pris refusé ; machine allumée refusée', async () => {
  const w = monde();
  try {
    const r = await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-copie', sorte: 'complete' }, OUI);
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /vm-labo-copie : copie complète prête \(10\.0\.3\.\d+\), éteinte/);
    assert.match(r.text, /le nom d'ordinateur ne change pas tout seul/, 'ce qui ne change pas est dit');
    const conv = w.f.cmds.find((c) => c[0] === 'qemu-img' && c[1] === 'convert')!;
    assert.equal(conv.at(-2), join(w.d, 'vm', 'vm-labo', 'disque.qcow2')); assert.equal(conv.at(-1), join(w.d, 'vm', 'vm-labo-copie', 'disque.qcow2'));
    const c = w.machines().find((x) => x.nom === 'vm-labo-copie')!, o = w.machines().find((x) => x.nom === 'vm-labo')!;
    assert.notEqual(c.ip, o.ip); assert.notEqual(c.mac, o.mac); assert.equal(c.liee, undefined); assert.equal(c.arretVoulu, true);
    const pris = await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-copie' }, OUI);
    assert.equal(pris.ok, false); assert.match(pris.text, /le nom « vm-labo-copie » est déjà pris/);
    const on = await w.act('cloner_machine', { machine: 'vm-web', nom: 'vm-web-copie' }, OUI);
    assert.equal(on.ok, false); assert.match(on.text, /arrête d'abord vm-web/);
    assert.ok(!existsSync(join(w.d, 'vm', 'vm-web-copie')), 'refusée : aucun dossier laissé');
  } finally { w.fin(); }
});

test('cloner : le budget d\'Hydre (refus chiffré, rien n\'est créé)', async () => {
  const w = monde();
  try {
    hoteVm.disque = () => ({ total: 500 * GO, libre: 70 * GO }); // 70 - 50 gardés = 20 Go, le disque de la copie en demande 32
    const r = await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-2' }, OUI);
    assert.equal(r.ok, false); assert.match(r.text, /Refusé, rien n'est créé/); assert.match(r.text, /Disque : 32 Go demandés, 20 Go au plus \(70 Go libres ; 50 Go gardés pour Odin et tes fichiers\)/);
    assert.ok(!w.f.cmds.some((x) => x[0] === 'qemu-img'), 'aucune copie lancée'); assert.ok(!existsSync(join(w.d, 'vm', 'vm-labo-2')));
  } finally { w.fin(); }
});

test('cloner, liée : depuis un modèle seulement ; le modèle est protégé tant qu\'elle existe', async () => {
  const w = monde();
  try {
    const non = await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-liee', sorte: 'liee' }, OUI);
    assert.equal(non.ok, false); assert.match(non.text, /une copie liée se fait depuis un modèle/);
    const r = await w.act('cloner_machine', { machine: 'vm-base', nom: 'vm-base-copie', sorte: 'liee' }, OUI);
    assert.equal(r.ok, true, r.text); assert.match(r.text, /vm-base-copie : copie liée prête/);
    const cr = w.f.cmds.find((c) => c[0] === 'qemu-img' && c[1] === 'create')!;
    assert.deepEqual(cr.slice(1, 7), ['create', '-f', 'qcow2', '-F', 'qcow2', '-b']); assert.equal(cr[7], join(w.d, 'vm', 'vm-base', 'disque.qcow2'), 'le disque de départ, en chemin complet');
    const c = w.machines().find((x) => x.nom === 'vm-base-copie')!, base = w.machines().find((x) => x.nom === 'vm-base')!;
    assert.deepEqual(c.liee, { de: base.id }); assert.equal(c.estModele, undefined, 'la copie démarre, elle');
    // Le registre « qui dépend de qui » le dit ; la suppression du modèle est refusée.
    const dep = await w.act('dependants_machines', { machine: 'vm-base' });
    assert.match(dep.text, /La copie liée vm-base-copie utilise son disque/);
    const sup = await w.act('supprimer_machine', { machine: 'vm-base', nom: 'vm-base', disque: 'effacer' }, { confirm: true });
    assert.equal(sup.ok, false); assert.match(sup.text, /la copie liée vm-base-copie utilise son disque/);
    assert.ok(existsSync(join(w.d, 'vm', 'vm-base', 'disque.qcow2')));
    // Ni redevenir une machine (elle démarrerait et changerait le disque), ni agrandir son disque.
    const md = await w.act('modele_machine', { machine: 'vm-base', modele: false });
    assert.equal(md.ok, false); assert.match(md.text, /copies liées \(vm-base-copie\) utilisent le disque de vm-base/);
    assert.equal(w.machines().find((x) => x.nom === 'vm-base')!.estModele, true);
    const ag = await w.act('disque_machine', { machine: 'vm-base', disque: 64 }, { confirm: true });
    assert.equal(ag.ok, false); assert.match(ag.text, /copies liées utilisent le disque de vm-base/);
    // Le lien ne se retire pas à la main.
    const lien = ((w.v.ctx('ymir').settings.dependances ?? []) as Array<{ id: string; de: string; qui: string; liee?: boolean }>).find((x) => x.qui === c.id)!;
    assert.equal(lien.liee, true); assert.equal(lien.de, base.id);
    const ret = await w.act('dependance_retirer', { lien: lien.id });
    assert.equal(ret.ok, false); assert.match(ret.text, /vient d'une copie liée/);
    // La copie supprimée : le modèle redevient libre.
    const supC = await w.act('supprimer_machine', { machine: 'vm-base-copie', nom: 'vm-base-copie', disque: 'effacer' }, { confirm: true });
    assert.equal(supC.ok, true, supC.text);
    assert.equal(((w.v.ctx('ymir').settings.dependances ?? []) as unknown[]).length, 0, 'le lien part avec la copie');
    assert.equal((await w.act('modele_machine', { machine: 'vm-base', modele: false })).ok, true);
  } finally { w.fin(); }
});

test('exporter : éteinte telle quelle ; l\'empreinte revérifiée après la copie ; un fichier abîmé en route fait échouer', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const r = await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest });
    assert.equal(r.ok, true, r.text);
    const x = r.data as { fichier: string; sha256: string; verifie: boolean };
    assert.equal(x.verifie, true); assert.match(r.text, /📦 .*vm-labo\.ody .*empreinte [0-9a-f]{16}… vérifiée après la copie/);
    // La relecture vient APRÈS l'écriture du fichier (« -cf »), et lit le fichier écrit.
    const k = w.f.cmds.findIndex((c) => c[0] === 'tar' && c.includes('-cf')), relu = w.f.cmds.findIndex((c, j) => j > k && c[0] === 'tar' && c[1] === '-tf');
    assert.ok(k >= 0 && relu > k, 'le fichier écrit est relu');
    assert.ok(existsSync(x.fichier)); assert.deepEqual(readdirSync(dest), ['vm-labo.ody']);
    rmSync(x.fichier);
    w.f.abimer = true;
    const ko = await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest });
    assert.equal(ko.ok, false); assert.match(ko.text, /ne se relit pas à l'identique .*empreinte différente.*export annulé/);
    assert.deepEqual(readdirSync(dest), [], 'rien n\'est gardé, pas même le fichier entamé');
  } finally { w.fin(); }
});

test('exporter : allumée, par un instantané (elle continue de tourner), retiré ensuite ; noté « Odin seul »', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const r = await w.act('exporter_machine', { machine: 'vm-web', dossier: dest });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /vm-web a continué de tourner/);
    const sv = w.f.qmp.find((x) => x.startsWith('savevm '))!, tag = sv.split(' ')[1];
    assert.match(tag, /^odin-\d{8}-\d{6}-[0-9a-f]{4}$/);
    const conv = w.f.cmds.find((c) => c[0] === 'qemu-img' && c[1] === 'convert')!;
    assert.ok(conv.includes('-U'), 'lecture partagée : la machine tourne'); assert.ok(conv.includes(`snapshot.name=${tag}`), 'c\'est l\'instantané qui est copié');
    assert.ok(w.f.qmp.includes(`delvm ${tag}`), 'l\'instantané d\'export est retiré ensuite');
    assert.ok(!w.f.qmp.some((x) => ['stop', 'quit', 'system_powerdown'].includes(x)), 'la machine n\'est ni arrêtée ni figée');
    assert.deepEqual(readdirSync(join(w.d)).filter((x) => x.startsWith('.')), [], 'rien de temporaire ne reste');
    const j = (await w.act('qui_a_fait')).text;
    assert.match(j, /Odin seul · Instantané pour l'export \(machine : vm-web\) · fait/);
    assert.match(j, /propriétaire · Exporter en \.ody \(machine : vm-web/);
    // Le .ody s'importe, et le disque est bien celui de l'instantané.
    const im = await w.act('importer_machine', { fichier: (r.data as { fichier: string }).fichier, nom: 'vm-web-2' });
    assert.equal(im.ok, true, im.text); assert.match(im.text, /📥 vm-web-2 importée \(VM Debian 13\) · 10\.0\.3\.\d+ · empreinte vérifiée, antivirus : rien trouvé/);
    assert.match(readFileSync(join(w.d, 'vm', 'vm-web-2', 'disque.qcow2'), 'utf8'), new RegExp(`\\(instantané ${tag}\\)$`));
    // Sans place pour préparer la copie : refusé, chiffres à l'appui, aucun instantané pris.
    w.f.qmp.length = 0; hoteVm.disque = () => ({ total: 500 * GO, libre: 50 * GO });
    const ko = await w.act('exporter_machine', { machine: 'vm-web', dossier: dest });
    assert.equal(ko.ok, false); assert.match(ko.text, /pas assez de place pour exporter vm-web : il faut environ \d+ Go \(la copie du disque, son archive et le \.ody\) .*le budget d'Hydre en laisse 0 Go/);
    assert.deepEqual(w.f.qmp, []);
  } finally { w.fin(); }
});

test('lire l\'écran « Cloner et exporter » : taille mesurée, copie liée possible ou non (et pourquoi), serveur fermé, nom proposé libre', async () => {
  const w = monde();
  try {
    const a = await w.act('copies_machine', { machine: 'vm-labo' });
    assert.equal(a.ok, true, a.text);
    const d = a.data as { etat: string; taille: number; nomPropose: string; liee: { possible: boolean; raison?: string }; serveur: { possible: boolean; raison: string }; dossier: string };
    assert.equal(d.etat, 'ok'); assert.equal(d.taille, statSync(join(w.d, 'vm', 'vm-labo', 'disque.qcow2')).size, 'la taille est mesurée, jamais inventée');
    assert.equal(d.nomPropose, 'vm-labo-copie'); assert.equal(d.liee.possible, false); assert.match(d.liee.raison!, /depuis un modèle/);
    assert.equal(d.serveur.possible, false); assert.match(d.serveur.raison, /Aucun serveur de virtualisation relié/);
    // Vers une clé ODIN : Genèse ne sait pas encore copier le disque d'une VM sur une vraie clé (seulement en essai) :
    // l'option est fermée, la raison dite, rien n'est promis.
    const cle = (a.data as { cle: { possible: boolean; raison: string } }).cle;
    assert.equal(cle.possible, false); assert.match(cle.raison, /Genèse ne sait pas encore copier le disque d'une machine virtuelle sur une vraie clé/);
    assert.equal(d.dossier, join(w.home, 'Machines'));
    await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-copie' }, OUI);
    assert.equal(((await w.act('copies_machine', { machine: 'vm-labo' })).data as { nomPropose: string }).nomPropose, 'vm-labo-copie-2', 'le nom proposé est libre');
    assert.equal(((await w.act('copies_machine', { machine: 'vm-base' })).data as { liee: { possible: boolean } }).liee.possible, true);
  } finally { w.fin(); }
});

test('importer : sans antivirus, rien n\'est importé ; un .ody abîmé est refusé', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const ody = ((await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest })).data as { fichier: string }).fichier;
    assert.equal((await w.v.activer('ullr', false)).ok, true);
    const r = await w.act('importer_machine', { fichier: ody, nom: 'vm-importee' });
    assert.equal(r.ok, false); assert.match(r.text, /l'antivirus d'Odin .* n'a pas pu analyser ce \.ody .*import arrêté, rien n'est créé/);
    assert.ok(!w.machines().some((x) => x.nom === 'vm-importee')); assert.ok(!existsSync(join(w.d, 'vm', 'vm-importee')));
    assert.deepEqual(readdirSync(w.d).filter((x) => x.startsWith('.')), [], 'aucun dossier d\'import laissé');
    assert.equal((await w.v.activer('ullr', true)).ok, true);
    writeFileSync(join(w.home, 'pas-un.ody'), 'ceci n\'est pas une archive');
    assert.equal((await w.act('importer_machine', { fichier: join(w.home, 'pas-un.ody') })).ok, false);
    const ok = await w.act('importer_machine', { fichier: ody, nom: 'vm-importee' });
    assert.equal(ok.ok, true, ok.text);
  } finally { w.fin(); }
});

test('propriétaire seul : membre, automatisation, clé d\'API, tablette « maison » refusés ; noté dans « qui a fait quoi »', async () => {
  const w = monde();
  setValhalla(w.v); resetGladsheim();
  const srv = serveurHttp((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    for (const id of ['copies_machine', 'cloner_machine', 'modele_machine', 'exporter_machine', 'importer_machine']) { const a = w.v.action('ymir', id)?.a; assert.equal(a?.proprietaireSeul, true, id); assert.equal(a?.quick, false, id); }
    const refus = /seul le propriétaire/;
    for (const o of [{ qui: 'member' }, { auto: true, by: 'automatisation' }, { by: 'assistant', auto: true }]) {
      assert.match((await w.act('cloner_machine', { machine: 'vm-labo', nom: 'x-copie' }, o)).text, refus);
      assert.match((await w.act('exporter_machine', { machine: 'vm-labo', dossier: join(w.home, 'nas') }, o)).text, refus);
      assert.match((await w.act('importer_machine', { fichier: join(w.home, 'x.ody') }, o)).text, refus);
      assert.match((await w.act('modele_machine', { machine: 'vm-labo' }, o)).text, refus);
      assert.match((await w.act('copies_machine', { machine: 'vm-labo' }, o)).text, refus);
    }
    const cle = await valhallaPost('/api/valhalla/act', { module: 'ymir', action: 'exporter_machine', input: { machine: 'vm-labo' }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false); assert.match(cle.text, /pas avec la clé d'API/);
    // Une tablette « maison » : un bouton vers l'action, sur l'écran de la maison.
    assert.notEqual((await w.v.act('gladsheim', 'bouton', { appli: 'ymir', action: 'cloner_machine', reglages: 'machine=vm-labo\nnom=tab-copie', nom: 'Cloner' })).ok, false);
    const key = ((await w.v.act('gladsheim', 'cle_tablette', { nom: 'Tablette', droits: 'maison' })).data as { key: string }).key;
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const tuile = (w.v.ctx('gladsheim').settings.tiles as Array<{ id: string; module: string }>).find((t) => t.module === 'ymir')!;
    const tab = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: { 'x-odin-maison': key, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: tuile.id, confirm: true }) })).json() as { ok: boolean; text: string };
    assert.equal(tab.ok, false); assert.match(tab.text, /droits « maison »/);
    assert.ok(!w.f.cmds.some((x) => x[0] === 'qemu-img' || x[0] === 'tar'), 'aucun refusé n\'a rien copié');
    assert.equal(w.machines().length, 4);
    await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-copie' }, OUI);
    assert.match((await w.act('qui_a_fait')).text, /propriétaire · Cloner \(machine : vm-labo · nom : vm-labo-copie/);
  } finally { srv.close(); setValhalla(undefined); w.fin(); }
});

test('sous Windows : un état clair, rien n\'est tenté ; une machine Windows : sa note', async () => {
  const w = monde();
  try {
    systemeVm.plateforme = () => 'win32';
    const a = await w.act('copies_machine', { machine: 'vm-labo' });
    assert.equal((a.data as { etat: string }).etat, 'moteur'); assert.match(a.text, /Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre : les cloner et les exporter non plus/);
    assert.match((await w.act('cloner_machine', { machine: 'vm-labo', nom: 'vm-labo-copie' }, OUI)).text, /Sous Windows/);
    assert.match((await w.act('exporter_machine', { machine: 'vm-labo', dossier: join(w.home, 'nas') })).text, /Sous Windows/);
    assert.equal(w.f.cmds.length, 0);
    systemeVm.plateforme = () => 'linux';
    const win = (await w.act('copies_machine', { machine: 'vm-bureau' })).data as { machine: { famille: string } };
    assert.equal(win.machine.famille, 'Windows');
    const c = await w.act('cloner_machine', { machine: 'vm-bureau', nom: 'vm-bureau-copie' }, OUI);
    assert.match(c.text, /le nom d'ordinateur et l'identité de Windows ne changent pas tout seuls/);
  } finally { systemeVm.plateforme = () => 'linux'; w.fin(); }
});

test('exporter : toute VM passe par le budget d\'Hydre (éteinte aussi), chiffres à l\'appui ; la place comptée selon ce qui est écrit', async () => {
  // Éteinte : l\'archive puis le .ody (deux fois sa taille) ; allumée ou liée : la copie du disque en plus (trois fois).
  assert.equal(besoinExportGo(10 * GO, false), 21); assert.equal(besoinExportGo(10 * GO, true), 31);
  const w = monde(), dest = join(w.home, 'nas');
  try {
    hoteVm.disque = () => ({ total: 500 * GO, libre: 50 * GO }); // 50 - 50 gardés : 0 Go
    const ko = await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest });
    assert.equal(ko.ok, false); assert.match(ko.text, /pas assez de place pour exporter vm-labo : il faut environ \d+ Go .*le budget d\'Hydre en laisse 0 Go \(50 Go libres, 50 Go gardés/);
    assert.ok(!w.f.cmds.some((c) => c[0] === 'tar'), 'rien n\'est archivé'); assert.ok(!existsSync(dest));
    hoteVm.disque = () => { throw new Error('illisible'); };
    const k2 = await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest });
    assert.equal(k2.ok, false); assert.match(k2.text, /ne sait pas lire la place libre du disque des machines : rien n\'est exporté/);
  } finally { w.fin(); }
});

test('exporter : deux exports de la même machine en même temps, le second est refusé (il n\'efface rien du premier)', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const [a, b] = await Promise.all([w.act('exporter_machine', { machine: 'vm-web', dossier: dest }), w.act('exporter_machine', { machine: 'vm-web', dossier: join(w.home, 'nas2') })]);
    const oks = [a, b].filter((x) => x.ok !== false), kos = [a, b].filter((x) => x.ok === false);
    assert.equal(oks.length, 1, `${a.text} | ${b.text}`); assert.match(kos[0].text, /un export de vm-web est déjà en cours/);
    assert.equal((oks[0].data as { verifie: boolean }).verifie, true);
    assert.deepEqual(readdirSync(w.d).filter((x) => x.startsWith('.')), [], 'rien de temporaire ne reste');
  } finally { w.fin(); }
});

test('exporter depuis un instantané : la copie du disque est relue (qemu-img check) ; abîmée, l\'export échoue et l\'instantané est retiré', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const r = await w.act('exporter_machine', { machine: 'vm-web', dossier: dest });
    assert.equal(r.ok, true, r.text);
    const conv = w.f.cmds.findIndex((c) => c[0] === 'qemu-img' && c[1] === 'convert'), chk = w.f.cmds.findIndex((c) => c[0] === 'qemu-img' && c[1] === 'check');
    assert.ok(conv >= 0 && chk > conv, 'la copie est relue après la copie'); assert.equal(w.f.cmds[chk].at(-1), w.f.cmds[conv].at(-1), 'c\'est la copie qui est relue');
    rmSync((r.data as { fichier: string }).fichier); w.f.qmp.length = 0; w.f.checkKo = true;
    const ko = await w.act('exporter_machine', { machine: 'vm-web', dossier: dest });
    assert.equal(ko.ok, false); assert.match(ko.text, /la copie du disque de vm-web ne se relit pas sans erreur/);
    assert.ok(w.f.qmp.some((x) => x.startsWith('delvm ')), 'l\'instantané d\'export est retiré quand même');
    assert.deepEqual(readdirSync(dest), []); assert.deepEqual(readdirSync(w.d).filter((x) => x.startsWith('.')), []);
  } finally { w.fin(); }
});

test('importer : un disque qui s\'appuie sur un autre fichier (un .ody piégé) est refusé, rien n\'est créé', async () => {
  const w = monde(), dest = join(w.home, 'nas');
  try {
    const ody = ((await w.act('exporter_machine', { machine: 'vm-labo', dossier: dest })).data as { fichier: string }).fichier;
    w.f.backing = '/etc/shadow';
    const r = await w.act('importer_machine', { fichier: ody, nom: 'vm-piege' });
    assert.equal(r.ok, false); assert.match(r.text, /le disque de cette machine s\'appuie sur un autre fichier .*import refusé/);
    assert.ok(!w.machines().some((x) => x.nom === 'vm-piege')); assert.ok(!existsSync(join(w.d, 'vm', 'vm-piege')));
    assert.deepEqual(readdirSync(w.d).filter((x) => x.startsWith('.')), [], 'aucun dossier d\'import laissé');
    w.f.backing = '';
    assert.equal((await w.act('importer_machine', { fichier: ody, nom: 'vm-propre' })).ok, true);
    assert.ok(w.f.cmds.some((c) => c[0] === 'qemu-img' && c[1] === 'info' && c.at(-1)!.endsWith('disque.qcow2')));
  } finally { w.fin(); }
});

test('supprimer : un modèle reste protégé par ses copies liées, même si le registre a perdu le lien', async () => {
  const w = monde();
  try {
    assert.equal((await w.act('cloner_machine', { machine: 'vm-base', nom: 'vm-base-copie', sorte: 'liee' }, OUI)).ok, true);
    w.v.ctx('ymir').saveSettings({ dependances: [] });
    const sup = await w.act('supprimer_machine', { machine: 'vm-base', nom: 'vm-base', disque: 'effacer' }, { confirm: true });
    assert.equal(sup.ok, false); assert.match(sup.text, /la copie liée vm-base-copie utilise son disque/);
    assert.ok(existsSync(join(w.d, 'vm', 'vm-base', 'disque.qcow2')));
  } finally { w.fin(); }
});
