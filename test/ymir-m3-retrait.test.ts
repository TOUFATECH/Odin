// Hydre, lot M3 (maquette « Conteneurs et machines » validée le 23/11) : la liste et ses garde-fous, côté Odin.
// AUCUNE vraie VM : le processus des VM est simulé (comme au lot M1), aucune commande système n'est lancée, aucun réseau.
// - « qui dépend de qui » (cahier § 3.7) : le registre noté à la main (une autre machine, un conteneur d'Arche, des PC),
//   ce qu'Odin voit (Genèse par l'adresse MAC, Phénix par le nom du plan ou son dossier) ; ce qui bloque ;
// - supprimer : au propriétaire seul, son nom écrit, le choix dit du disque (garder à part ou effacer), refusé tant
//   qu'elle tourne ou qu'un dépendant vivant existe ; jamais un disque hors du dossier des VM (raccourci refusé, un
//   raccourci DANS le dossier retiré seul) ; mise de côté, relecture, puis effacement ; reprise après un arrêt brutal ;
// - la liste : « en erreur » (disque disparu, état illisible), et sous Windows ce qui viendra.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { bilanDependants, type Lien, type Sources } from '../src/valhalla/ymir/dependances.ts';
import { effacerArbre, nomEcritJuste } from '../src/valhalla/ymir/retrait.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { ...systemeVm };
after(() => { Object.assign(systemeVm, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const VM = (o: Partial<Machine> = {}): Machine => ({ id: 'a00000000001', nom: 'debian-13-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 20, ip: '10.0.3.61', mac: '02:0d:1e:00:00:61', cree: 0, apps: [], paquets: [], ...o });
const WEB = VM(), DC = VM({ id: 'a00000000002', nom: 'dc-labo', systeme: 'Windows Server 2025', famille: 'Windows', ip: '10.0.3.10', mac: '02:0d:1e:00:00:10', disque: 60 });
const BUREAU = VM({ id: 'a00000000003', nom: 'vm-bureau', systeme: 'Windows 11', famille: 'Windows', ip: '10.0.3.62', mac: '02:0d:1e:00:00:62', disque: 80 });
const LXC = VM({ id: 'c00000000001', nom: 'lxc-notes', genre: 'lxc', ip: '10.0.3.70', mac: '02:0d:1e:00:00:70' });

/** Un Odin d'essai : trois VM (web allumée, dc-labo allumée, vm-bureau éteinte) et un LXC ; aucune commande ne sort. */
function monde() {
  const home = neuf('hydre-m3-'), vivants = new Set<number>([101, 102]), calls: string[][] = [];
  /** une réponse simulée à une commande (sinon : « aucune commande ») */
  const reponses: { de?: (cmd: string, args: string[]) => { code: number; out: string; err: string } | undefined } = {};
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = (pid: number) => vivants.has(pid);
  systemeVm.qmp = async () => { throw new Error('essai : pas de QMP ici'); };
  systemeVm.dossiersQmp = () => [join(home, 'qmp')];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return reponses.de?.(cmd, args) ?? { code: 1, out: '', err: 'essai : aucune commande' }; },
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const d = join(home, 'valhalla', 'ymir', 'machines'), vm = (n: string) => join(d, 'vm', n);
  for (const m of [WEB, DC, BUREAU]) { mkdirSync(vm(m.nom), { recursive: true }); writeFileSync(join(vm(m.nom), 'disque.qcow2'), `disque de ${m.nom}`); writeFileSync(join(vm(m.nom), 'vm.json'), JSON.stringify(m)); }
  writeFileSync(join(vm(WEB.nom), 'pid'), '101'); writeFileSync(join(vm(DC.nom), 'pid'), '102');
  mkdirSync(join(d, 'lxc', LXC.nom), { recursive: true });
  writeFileSync(join(d, 'machines.json'), JSON.stringify([WEB, DC, BUREAU, LXC]));
  return { v, home, d, vm, vivants, calls, reponses, fin: () => v.stop() };
}
const noms = (w: ReturnType<typeof monde>) => (JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[]).map((m) => m.nom);
const lien = (o: Partial<Lien>): Lien => ({ id: 'l1', de: DC.id, genre: 'pc', qui: 'PC du domaine', at: 0, ...o });

test('dépendants (pur) : registre, Genèse par l\'adresse MAC, Phénix ; ce qui bloque et pourquoi', () => {
  const src: Sources = { machines: [{ id: WEB.id, nom: WEB.nom, etat: 'en marche' }, { id: BUREAU.id, nom: BUREAU.nom, etat: 'éteinte' }, { id: 'x', nom: 'perdue', etat: 'inconnue' }], genese: 'arretee', arche: [{ nom: 'wiki', enMarche: true }, { nom: 'vieux', enMarche: false }], phenix: [] };
  assert.deepEqual(bilanDependants(DC, [], src), { dependants: [], bloquants: [] }, 'rien n\'en dépend');
  // Une machine allumée bloque, éteinte non ; un lien vers une machine disparue se signale, sans bloquer ; état illisible : bloque.
  let b = bilanDependants(DC, [lien({ genre: 'machine', qui: WEB.id }), lien({ id: 'l2', genre: 'machine', qui: BUREAU.id }), lien({ id: 'l3', genre: 'machine', qui: 'partie' }), lien({ id: 'l4', genre: 'machine', qui: 'x' })], src);
  assert.deepEqual(b.dependants.map((x) => [x.nom, x.vivant, Boolean(x.inconnu)]), [[WEB.nom, true, false], [BUREAU.nom, false, false], ['partie', false, false], ['perdue', false, true]]);
  assert.equal(b.bloquants.length, 2); assert.match(b.bloquants[0], /debian-13-web en dépend et elle est allumée/); assert.match(b.bloquants[1], /ne sait pas si elle tourne/);
  // Arche : un conteneur en marche bloque, arrêté non ; Arche muette : bloque (Odin ne peut pas vérifier).
  b = bilanDependants(DC, [lien({ genre: 'arche', qui: 'wiki' }), lien({ id: 'l2', genre: 'arche', qui: 'vieux' })], src);
  assert.deepEqual(b.dependants.map((x) => x.vivant), [true, false]); assert.equal(b.bloquants.length, 1); assert.match(b.bloquants[0], /conteneur wiki en dépend et il tourne/);
  b = bilanDependants(DC, [lien({ genre: 'arche', qui: 'wiki' })], { ...src, arche: undefined });
  assert.match(b.bloquants[0], /Arche ne répond pas/);
  // Des PC notés à la main : bloquent (Odin ne peut pas savoir), avec leur nombre et comment lever le blocage.
  b = bilanDependants(DC, [lien({ nombre: 12 })], src);
  assert.equal(b.dependants[0].texte, '12 PC du domaine en dépendent (noté à la main).'); assert.match(b.bloquants[0], /retire ce lien du registre si ce n'est plus vrai/);
  // Genèse : muette → bloque ; une installation pas finie sur SA carte réseau (écrite autrement) → bloque ; finie, ou une autre carte → non.
  assert.match(bilanDependants(DC, [], { ...src, genese: undefined }).bloquants[0], /Genèse ne répond pas/);
  const g = (step: string, mac = '02-0D-1E-00-00-10') => ({ ...src, genese: { enCours: [{ mac, step, isoName: 'Windows Server 2025' }], lots: [] } });
  assert.match(bilanDependants(DC, [], g('installation')).bloquants[0], /Genèse installe Windows Server 2025 sur cette machine/);
  assert.deepEqual(bilanDependants(DC, [], g('fini')).bloquants, []);
  assert.deepEqual(bilanDependants(DC, [], g('installation', '02:0d:1e:00:00:99')).bloquants, []);
  const lot = { ...src, genese: { enCours: [], lots: [{ isoNom: 'Debian 13', pcs: [{ mac: DC.mac, nom: 'dc', etat: 'en cours' }] }] } };
  assert.match(bilanDependants(DC, [], lot).bloquants[0], /déploiement de Genèse \(Debian 13\) vise cette machine/);
  // Phénix : le plan créé avec elle, ou un plan qui lit son dossier ; jamais bloquant ; un autre plan : rien.
  const ph = { ...src, phenix: ['- Machine dc-labo : /srv/x → /nas · chaque nuit', '- Documents : /home/a, /srv/odin/vm/dc-labo → /nas', '- Photos : /home/photos → /nas', '- Machine dc-labo-2 : /y → /nas'] };
  b = bilanDependants(DC, [], ph, ['/srv/odin/vm/dc-labo']);
  assert.deepEqual(b.dependants.map((x) => [x.genre, x.nom, x.vivant]), [['phenix', 'Machine dc-labo', false], ['phenix', 'Documents', false]]); assert.deepEqual(b.bloquants, []);
  assert.ok(nomEcritJuste(' DC-Labo ', 'dc-labo')); assert.ok(!nomEcritJuste('dc-lab', 'dc-labo')); assert.ok(!nomEcritJuste('', ''));
});

test('le registre : noter, lire, retirer ; au propriétaire seul ; arrêter et mettre en pause disent qui en dépend', async () => {
  const w = monde();
  try {
    const refus = /seul le propriétaire/i;
    assert.match((await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'pc', qui: 'PC du domaine', nombre: 12 }, { qui: 'member' })).text, refus);
    assert.match((await w.v.act('ymir', 'dependants_machines', {}, { qui: 'member' })).text, refus);
    assert.match((await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'machine', qui: DC.nom })).text, /ne dépend pas d'elle-même/);
    assert.match((await w.v.act('ymir', 'dependance_ajouter', { machine: 'dc', genre: 'pc', qui: 'x' })).text, /machine introuvable/, 'jamais une machine « qui ressemble »');
    const a = await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'pc', qui: 'PC du domaine', nombre: 12 });
    assert.equal(a.ok, true, a.text); assert.match(a.text, /12 PC du domaine dépendent de dc-labo/);
    assert.equal((await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'machine', qui: WEB.nom })).ok, true);
    assert.equal((await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'pc', qui: 'PC du domaine', nombre: 12 })).ok, false, 'déjà noté');
    const l = await w.v.act('ymir', 'dependants_machines', { machine: DC.nom });
    const b = (l.data as { machines: Record<string, { dependants: Array<{ texte: string }>; bloquants: string[] }> }).machines[DC.id];
    assert.deepEqual(b.dependants.map((x) => x.texte), ['12 PC du domaine en dépendent (noté à la main).', 'La machine debian-13-web en dépend, et elle est allumée.']);
    assert.equal(b.bloquants.length, 2);
    // La confirmation d'un arrêt ou d'une pause dit qui en souffre (cahier § 3.7 : « éteindre DC01 coupe 12 PC »).
    const ctx = w.v.ctx('ymir');
    assert.match(String(w.v.action('ymir', 'arreter_machine')!.a.grave!({ machine: DC.nom }, ctx)), /éteindre la machine dc-labo — en dépendent : 12 PC du domaine, debian-13-web/);
    assert.match(String(w.v.action('ymir', 'pause_machine')!.a.grave!({ machine: DC.nom }, ctx)), /en dépendent : 12 PC du domaine, debian-13-web/);
    assert.doesNotMatch(String(w.v.action('ymir', 'arreter_machine')!.a.grave!({ machine: BUREAU.nom }, ctx)), /dépendent/);
    // Retirer une ligne ; les gestes sont notés dans « qui a fait quoi ».
    const id = (ctx.settings.dependances as Lien[])[0].id;
    assert.match((await w.v.act('ymir', 'dependance_retirer', { lien: id })).text, /Retiré du registre : PC du domaine → dc-labo/);
    assert.equal((ctx.settings.dependances as Lien[]).length, 1);
    const j = (await w.v.act('ymir', 'qui_a_fait')).text;
    assert.match(j, /propriétaire · Noter une dépendance/); assert.match(j, /propriétaire · Retirer une dépendance/);
  } finally { w.fin(); }
});

test('supprimer une VM : nom écrit, disque choisi, refus tant qu\'elle tourne ou qu\'un dépendant vivant existe ; disque gardé à part', async () => {
  const w = monde();
  try {
    const sup = (i: Record<string, unknown>, o?: Record<string, unknown>) => w.v.act('ymir', 'supprimer_machine', { machine: DC.nom, ...i }, o as never);
    assert.equal((await sup({ nom: DC.nom, disque: 'garder' }, { qui: 'member' })).ok, false, 'un membre');
    assert.equal((await sup({ nom: DC.nom, disque: 'garder' }, { auto: true })).ok, false, 'une automatisation');
    assert.match((await sup({ disque: 'garder' })).text, /écris exactement « dc-labo »/);
    assert.match((await sup({ nom: 'dc-lab', disque: 'garder' })).text, /écris exactement « dc-labo »/);
    assert.match((await sup({ nom: DC.nom })).text, /dis ce que devient son disque \(60 Go\)/);
    assert.match((await sup({ nom: DC.nom, disque: 'garder' })).text, /dc-labo est allumée : arrête-la d'abord/);
    // En pause : tourne encore.
    const ctx = w.v.ctx('ymir'), L = JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[];
    writeFileSync(join(w.d, 'machines.json'), JSON.stringify(L.map((m) => (m.id === DC.id ? { ...m, pause: { depuis: 1 } } : m))));
    assert.match((await sup({ nom: DC.nom, disque: 'garder' })).text, /dc-labo est en pause : arrête-la d'abord/);
    // Éteinte, mais des PC en dépendent (notés), et une VM allumée aussi : refusé, chacun dit.
    w.vivants.delete(102);
    await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'pc', qui: 'PC du domaine', nombre: 12 });
    await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'machine', qui: WEB.nom });
    const r = await sup({ nom: DC.nom, disque: 'garder' });
    assert.equal(r.ok, false); assert.match(r.text, /Refusé, rien n'est effacé : 12 PC du domaine en dépendent .*; la machine debian-13-web en dépend et elle est allumée/);
    assert.ok(existsSync(join(w.vm(DC.nom), 'disque.qcow2')) && noms(w).includes(DC.nom), 'rien n\'a bougé');
    // Les PC retirés du registre, la VM qui en dépend éteinte : la suppression passe ; le disque est gardé à part, intact.
    for (const x of ctx.settings.dependances as Lien[]) if (x.genre === 'pc') await w.v.act('ymir', 'dependance_retirer', { lien: x.id });
    w.vivants.delete(101);
    const ok = await sup({ nom: 'DC-LABO', disque: 'garder' });
    assert.equal(ok.ok, true, ok.text);
    const gardes = readdirSync(join(w.d, 'gardes')); assert.equal(gardes.length, 1); assert.match(gardes[0], /^dc-labo-\d{8}-\d{4}$/);
    assert.equal(readFileSync(join(w.d, 'gardes', gardes[0], 'disque.qcow2'), 'utf8'), 'disque de dc-labo', 'le disque gardé, intact');
    assert.match(ok.text, /🗑 dc-labo supprimée : son disque \(60 Go\) est gardé à part dans .*dc-labo-\d{8}-\d{4}\./);
    assert.ok(!existsSync(w.vm(DC.nom)) && !noms(w).includes(DC.nom));
    assert.deepEqual(ctx.settings.dependances, [], 'ses lignes du registre sont retirées');
    assert.match((await w.v.act('ymir', 'qui_a_fait')).text, /propriétaire · Supprimer \(.*dc-labo.*\) · fait/);
  } finally { w.fin(); }
});

test('effacer le disque : seulement le dossier de la VM ; un raccourci dedans est retiré seul ; un dossier-raccourci est refusé', async () => {
  const w = monde();
  try {
    // Un dossier « dehors » (comme le dossier personnel) que des raccourcis visent.
    const dehors = neuf('hydre-m3-dehors-'); writeFileSync(join(dehors, 'precieux.txt'), 'à garder');
    symlinkSync(dehors, join(w.vm(BUREAU.nom), 'lien-dossier'), 'junction');
    let lienFichier = true; try { symlinkSync(join(dehors, 'precieux.txt'), join(w.vm(BUREAU.nom), 'lien-fichier')); } catch { lienFichier = false; /* Windows sans droit de créer un lien de fichier */ }
    mkdirSync(join(w.vm(BUREAU.nom), 'tpm', 'etat'), { recursive: true }); writeFileSync(join(w.vm(BUREAU.nom), 'tpm', 'etat', 'x'), 'tpm');
    const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /vm-bureau supprimée : son disque \(80 Go\) est effacé/);
    assert.ok(!existsSync(w.vm(BUREAU.nom)), 'le dossier de la VM est effacé');
    assert.deepEqual(readdirSync(join(w.d, 'vm')).filter((x) => x.startsWith('.retrait-')), [], 'rien laissé de côté');
    assert.equal(readFileSync(join(dehors, 'precieux.txt'), 'utf8'), 'à garder', 'ce que visait le raccourci est intact');
    assert.ok(lienFichier || true);
    // Le dossier d'une VM qui EST un raccourci vers ailleurs : refusé, rien n'est touché, la machine reste.
    w.vivants.clear();
    rmSync(w.vm(WEB.nom), { recursive: true, force: true }); symlinkSync(dehors, w.vm(WEB.nom), 'junction');
    const k = await w.v.act('ymir', 'supprimer_machine', { machine: WEB.nom, nom: WEB.nom, disque: 'effacer' });
    assert.equal(k.ok, false); assert.match(k.text, /raccourci vers un autre endroit : Odin ne suit aucun raccourci, rien n'est effacé/);
    assert.equal(readFileSync(join(dehors, 'precieux.txt'), 'utf8'), 'à garder'); assert.ok(noms(w).includes(WEB.nom));
    // Un nom de machine qui sortirait du dossier (« .. ») : refusé.
    const L = JSON.parse(readFileSync(join(w.d, 'machines.json'), 'utf8')) as Machine[];
    writeFileSync(join(w.d, 'machines.json'), JSON.stringify([...L, VM({ id: 'a00000000009', nom: '..', ip: '10.0.3.99' })]));
    assert.match((await w.v.act('ymir', 'supprimer_machine', { machine: 'a00000000009', nom: '..', disque: 'effacer' })).text, /pas rangé dans le dossier des machines virtuelles/);
    assert.ok(existsSync(join(w.d, 'machines.json')) && existsSync(join(w.d, 'vm', DC.nom)), 'rien d\'autre n\'est touché');
  } finally { w.fin(); }
});

test('relu une fois le dossier mis de côté : une installation de Genèse arrivée entre-temps le remet à sa place ; Genèse muette refuse', async () => {
  const w = monde();
  const g = w.v.modules().find((m) => m.id === 'thjalfi')!, a = g.actions.find((x) => x.id === 'machines')!, avant = a.run;
  try {
    let appels = 0;
    // La première lecture : rien ; la seconde (après la mise de côté) : Genèse installe un système sur SA carte réseau.
    a.run = async () => { appels++; return { text: '', data: appels >= 2 ? [{ mac: BUREAU.mac.toUpperCase(), step: 'installation', isoName: 'Windows 11' }] : [] }; };
    const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /Genèse installe Windows 11 sur cette machine en ce moment/);
    assert.equal(readFileSync(join(w.vm(BUREAU.nom), 'disque.qcow2'), 'utf8'), 'disque de vm-bureau', 'remis à sa place, intact');
    assert.ok(noms(w).includes(BUREAU.nom) && appels >= 2);
    // La VM démarrée pendant le retrait (son numéro de processus apparaît dans le dossier mis de côté) : remise à sa place.
    a.run = async () => {
      const cote = readdirSync(join(w.d, 'vm')).find((x) => x.startsWith('.retrait-'));
      if (cote) { writeFileSync(join(w.d, 'vm', cote, 'pid'), '103'); w.vivants.add(103); }
      return { text: '', data: [] };
    };
    const d = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.equal(d.ok, false, d.text); assert.match(d.text, /vm-bureau vient de démarrer : arrête-la d'abord/);
    assert.equal(readFileSync(join(w.vm(BUREAU.nom), 'disque.qcow2'), 'utf8'), 'disque de vm-bureau', 'remis à sa place, intact');
    rmSync(join(w.vm(BUREAU.nom), 'pid')); w.vivants.delete(103);
    // Genèse ne répond pas : refusé (Odin ne peut pas vérifier).
    a.run = async () => { throw new Error('Genèse est occupée'); };
    assert.match((await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' })).text, /Genèse ne répond pas/);
    assert.ok(existsSync(join(w.vm(BUREAU.nom), 'disque.qcow2')));
  } finally { a.run = avant; w.fin(); }
});

test('un LXC : son disque part avec lui (« garder » refusé, avec la raison) ; son dossier-raccourci refusé', async () => {
  const w = monde();
  try {
    assert.match((await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: LXC.nom, disque: 'garder' })).text, /Exporte-le d'abord en \.ody/);
    assert.match((await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: 'autre', disque: 'effacer' })).text, /écris exactement « lxc-notes »/);
    const dehors = neuf('hydre-m3-lxc-');
    rmSync(join(w.d, 'lxc', LXC.nom), { recursive: true }); symlinkSync(dehors, join(w.d, 'lxc', LXC.nom), 'junction');
    // État illisible (l'outil LXC ne répond pas, comme ici) : refusé avant tout.
    assert.match((await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: LXC.nom, disque: 'effacer' })).text, /Odin ne sait pas si lxc-notes tourne|raccourci/);
    assert.ok(existsSync(dehors) && noms(w).includes(LXC.nom));
    assert.ok(!w.calls.some((c) => c.join(' ').includes('lxc-destroy')), 'l\'outil LXC n\'a pas été lancé');
  } finally { w.fin(); }
});

test('la liste : « en erreur » (disque disparu, état illisible), dossier mis de côté remis après un arrêt brutal, Windows dit ce qui viendra', async () => {
  const w = monde();
  try {
    // Un retrait coupé net : le dossier de vm-bureau est resté de côté ; la machine est toujours listée → remis.
    renameSync(w.vm(BUREAU.nom), join(w.d, 'vm', `.retrait-0123456789ab-${BUREAU.nom}`));
    mkdirSync(join(w.d, 'vm', '.retrait-0123456789ab-inconnue')); // une machine qui n'est plus listée : jamais touché
    const t = await w.v.act('ymir', 'tableau_machines');
    const D = t.data as { machines: Array<Machine & { erreur?: string; etat: { state: string } }>; plateforme: string; windows?: unknown };
    assert.ok(existsSync(join(w.vm(BUREAU.nom), 'disque.qcow2')), 'remis à sa place');
    assert.ok(existsSync(join(w.d, 'vm', '.retrait-0123456789ab-inconnue')), 'l\'autre est laissé tel quel');
    const de = (n: string) => D.machines.find((m) => m.nom === n)!;
    assert.equal(de(WEB.nom).etat.state, 'en marche'); assert.equal(de(WEB.nom).erreur, undefined);
    assert.equal(de(BUREAU.nom).etat.state, 'éteinte'); assert.equal(de(BUREAU.nom).erreur, undefined);
    assert.match(String(de(LXC.nom).erreur), /état illisible/, 'l\'outil LXC ne répond pas');
    assert.equal(D.plateforme, 'linux'); assert.equal(D.windows, undefined);
    // Le disque d'une VM éteinte a disparu : en erreur.
    rmSync(join(w.vm(BUREAU.nom), 'disque.qcow2'));
    assert.equal(((await w.v.act('ymir', 'tableau_machines')).data as typeof D).machines.find((m) => m.nom === BUREAU.nom)!.erreur, 'son disque est introuvable');
    // Une VM en erreur dont le disque a disparu se supprime quand même (rien à garder : dit).
    const s = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.equal(s.ok, true, s.text); assert.match(s.text, /est effacé|avait déjà disparu/);
    // Sous Windows : la raison, et ce qui viendra.
    systemeVm.plateforme = () => 'win32';
    const W = (await w.v.act('ymir', 'tableau_machines')).data as { windows: { maintenant: string; avenir: string[] } };
    assert.match(W.windows.maintenant, /Sous Windows, les VM de ce PC ne tournent pas encore/);
    assert.match(W.windows.avenir.join(' '), /hyperviseur livré avec Windows/); assert.match(W.windows.avenir.join(' '), /Windows Famille/);
  } finally { systemeVm.plateforme = () => 'linux'; w.fin(); }
});

test('effacerArbre : aucun raccourci suivi, même profond', () => {
  const d = neuf('hydre-m3-arbre-'), dehors = neuf('hydre-m3-arbre-dehors-');
  writeFileSync(join(dehors, 'a.txt'), 'a'); mkdirSync(join(d, 'x', 'y'), { recursive: true }); writeFileSync(join(d, 'x', 'y', 'f'), 'f');
  symlinkSync(dehors, join(d, 'x', 'y', 'lien'), 'junction');
  assert.equal(effacerArbre(d), 1); assert.deepEqual(readdirSync(d), []); assert.equal(readFileSync(join(dehors, 'a.txt'), 'utf8'), 'a');
});

// Relecture du lot M3 (en adversaire) : chaque essai ci-dessous échouait avant sa correction.
test('relecture : le dossier des VM remplacé par un raccourci : rien n\'est effacé ni déplacé ailleurs', async () => {
  const w = monde();
  try {
    // « Ailleurs » (comme le dossier personnel) contient un dossier qui porte le nom d'une VM.
    const dehors = neuf('hydre-m3-ailleurs-'); mkdirSync(join(dehors, BUREAU.nom)); writeFileSync(join(dehors, BUREAU.nom, 'precieux.txt'), 'à garder');
    renameSync(join(w.d, 'vm'), join(w.d, 'vm-vrai')); symlinkSync(dehors, join(w.d, 'vm'), 'junction');
    for (const disque of ['effacer', 'garder']) {
      const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque });
      assert.equal(r.ok, false, r.text); assert.match(r.text, /dossier des machines virtuelles est un raccourci/);
      assert.equal(readFileSync(join(dehors, BUREAU.nom, 'precieux.txt'), 'utf8'), 'à garder', 'ce qui est ailleurs est intact');
      assert.ok(noms(w).includes(BUREAU.nom));
    }
    assert.ok(!existsSync(join(w.d, 'gardes')) || readdirSync(join(w.d, 'gardes')).length === 0, 'rien n\'a été déplacé dans les gardes');
    // La reprise après un arrêt brutal ne passe pas non plus à travers le raccourci.
    mkdirSync(join(dehors, `.retrait-0123456789ab-${WEB.nom}`));
    await w.v.act('ymir', 'tableau_machines');
    assert.ok(existsSync(join(dehors, `.retrait-0123456789ab-${WEB.nom}`)) && !existsSync(join(dehors, WEB.nom)));
  } finally { w.fin(); }
});

test('relecture : un LXC dont la configuration met son disque hors de son dossier : l\'outil LXC n\'est pas lancé', async () => {
  const w = monde();
  try {
    const dehors = neuf('hydre-m3-rootfs-'); writeFileSync(join(dehors, 'precieux.txt'), 'à garder');
    const dossier = join(w.d, 'lxc', LXC.nom), cf = join(dossier, 'config');
    w.reponses.de = (cmd, args) => ([cmd, ...args].includes('lxc-info') ? { code: 0, out: 'State: STOPPED\n', err: '' } : undefined);
    for (const l of [`dir:${dehors}`, dehors, `loop:${join(dehors, 'precieux.txt')}`, `dir:${dossier}/../..`, `overlay:${dehors}:${join(dossier, 'delta0')}`]) {
      writeFileSync(cf, `lxc.uts.name = ${LXC.nom}\nlxc.rootfs.path = dir:${join(dossier, 'rootfs')}\nlxc.rootfs.path = ${l}\n`);
      const r = await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: LXC.nom, disque: 'effacer' });
      assert.equal(r.ok, false, `${l} : ${r.text}`); assert.match(r.text, /hors de son dossier|ne sait pas vérifier/);
    }
    assert.ok(!w.calls.some((c) => c.includes('lxc-destroy')), 'l\'outil LXC n\'a jamais été lancé');
    // Un raccourci à la place de son disque : refusé aussi.
    symlinkSync(dehors, join(dossier, 'rootfs'), 'junction');
    writeFileSync(cf, `lxc.rootfs.path = dir:${join(dossier, 'rootfs')}\n`);
    assert.equal((await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: LXC.nom, disque: 'effacer' })).ok, false);
    assert.ok(!w.calls.some((c) => c.includes('lxc-destroy')));
    rmSync(join(dossier, 'rootfs')); mkdirSync(join(dossier, 'rootfs'));
    // Son disque dans son dossier : la suppression passe.
    w.reponses.de = (cmd, args) => { const c = [cmd, ...args]; if (c.includes('lxc-info')) return { code: 0, out: 'State: STOPPED\n', err: '' }; if (c.includes('lxc-destroy')) { rmSync(dossier, { recursive: true }); return { code: 0, out: '', err: '' }; } return undefined; };
    const ok = await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: LXC.nom, disque: 'effacer' });
    assert.equal(ok.ok, true, ok.text); assert.ok(!noms(w).includes(LXC.nom));
    assert.equal(readFileSync(join(dehors, 'precieux.txt'), 'utf8'), 'à garder');
  } finally { w.fin(); }
});

test('relecture : après un arrêt brutal, supprimer reprend d\'abord le dossier mis de côté (gardé, pas laissé de côté)', async () => {
  const w = monde();
  try {
    renameSync(w.vm(BUREAU.nom), join(w.d, 'vm', `.retrait-0123456789ab-${BUREAU.nom}`));
    const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'garder' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /est gardé à part/);
    const g = readdirSync(join(w.d, 'gardes')); assert.equal(g.length, 1);
    assert.equal(readFileSync(join(w.d, 'gardes', g[0], 'disque.qcow2'), 'utf8'), 'disque de vm-bureau');
    assert.deepEqual(readdirSync(join(w.d, 'vm')).filter((x) => x.startsWith('.retrait-')), [], 'rien laissé de côté');
  } finally { w.fin(); }
});

test('relecture : la page relue pendant une suppression ne reprend pas son dossier mis de côté sous ses pieds', async () => {
  const w = monde();
  const g = w.v.modules().find((m) => m.id === 'thjalfi')!, a = g.actions.find((x) => x.id === 'machines')!, avant = a.run;
  try {
    let relue = false;
    // Pendant la relecture (le dossier est mis de côté), la page relit la liste (un autre onglet, un téléphone).
    a.run = async () => { if (readdirSync(join(w.d, 'vm')).some((x) => x.startsWith('.retrait-'))) { relue = true; await w.v.act('ymir', 'tableau_machines'); } return { text: '', data: [] }; };
    const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.ok(relue); assert.equal(r.ok, true, r.text); assert.ok(!existsSync(w.vm(BUREAU.nom)) && !noms(w).includes(BUREAU.nom));
  } finally { a.run = avant; w.fin(); }
});

test('relecture : une VM qui répond sur son canal de contrôle ne se supprime pas ; la confirmation d\'un membre ne nomme pas le registre', async () => {
  const w = monde();
  try {
    // Pas de numéro de processus lisible, mais elle répond : elle tourne.
    systemeVm.qmp = async () => ({ status: 'running' });
    const r = await w.v.act('ymir', 'supprimer_machine', { machine: BUREAU.nom, nom: BUREAU.nom, disque: 'effacer' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /répond encore/); assert.ok(existsSync(join(w.vm(BUREAU.nom), 'disque.qcow2')));
    systemeVm.qmp = async () => { throw new Error('essai : pas de QMP ici'); };
    await w.v.act('ymir', 'dependance_ajouter', { machine: DC.nom, genre: 'pc', qui: 'PC du domaine', nombre: 12 });
    const ctx = w.v.ctx('ymir'), f = w.v.action('ymir', 'arreter_machine')!.a.grave!;
    assert.match(String(f({ machine: DC.nom }, ctx)), /PC du domaine/, 'le propriétaire le voit');
    assert.doesNotMatch(String(auNomDe({ login: 'ami', name: 'Ami', groups: [] }, () => f({ machine: DC.nom }, ctx))), /PC du domaine/, 'un membre, non');
  } finally { w.fin(); }
});

test('relecture : un LXC ne se supprime pas sans son nom écrit, même hors de la page', async () => {
  const w = monde();
  try {
    const dossier = join(w.d, 'lxc', LXC.nom);
    w.reponses.de = (cmd, args) => { const c = [cmd, ...args]; if (c.includes('lxc-info')) return { code: 0, out: 'State: STOPPED\n', err: '' }; if (c.includes('lxc-destroy')) { rmSync(dossier, { recursive: true }); return { code: 0, out: '', err: '' }; } return undefined; };
    for (const i of [{}, { nom: '' }, { nom: 'lxc-note' }, { disque: 'effacer' }]) {
      const r = await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, ...i });
      assert.equal(r.ok, false, r.text); assert.match(r.text, /écris exactement « lxc-notes »/);
    }
    assert.ok(existsSync(dossier) && noms(w).includes(LXC.nom) && !w.calls.some((c) => c.includes('lxc-destroy')), 'rien n\'est effacé');
    const ok = await w.v.act('ymir', 'supprimer_machine', { machine: LXC.nom, nom: ' LXC-Notes ' });
    assert.equal(ok.ok, true, ok.text); assert.ok(!noms(w).includes(LXC.nom));
  } finally { w.fin(); }
});
