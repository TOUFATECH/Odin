// Hydre, lot M4 (maquette « Conteneurs et machines » validée le 23/11, écrans 12 à 12e) : créer une VM, côté Odin.
// AUCUNE vraie VM ni vrai disque : QEMU et qemu-img sont simulés (le faux « qemu-img » écrit un petit fichier, le faux
// QEMU écrit un numéro de processus), les ISO sont les petites ISO d'essai de Genèse, aucun réseau, et le coffre est
// remplacé par un espion (on voit ce qui lui est confié, rien n'est écrit dans un vrai coffre).
// - seulement un système PRÊT de la bibliothèque (empreinte vérifiée, antivirus passé) ; la raison des autres ;
// - le budget de ce PC (des PC fictifs, de tailles variées : jamais une vraie machine) : refus avec les chiffres ; au-delà
//   du budget sans accord (4 Go, 50 Go), la création demande ton accord ; une seule création à la fois ;
// - le disque créé UNIQUEMENT dans le dossier des VM : nom sûr, dossier neuf, aucun raccourci ; un raté n'y laisse rien ;
// - l'installation toute seule (Ubuntu, Debian) : noyau et initrd de l'ISO, réponses, mot de passe au coffre, jamais
//   rendu ; ses réponses effacées et la VM relancée sur son disque à la fin ;
// - le compte rendu commun (§ 3.6) ; hors Linux (Windows), refus propre ; gestes réservés au propriétaire.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { argsInstallation, budgetVm, compteRendu, cpioNewc, essaisVm, etatSysteme, finInstallations, hoteVm, nomPropose, planAuto, reglagesLocaux, texteCompteRendu, verdictBudget } from '../src/valhalla/ymir/creation.ts';
import { noterFiche, type FicheIso } from '../src/valhalla/ymir/isos.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Module } from '../src/valhalla/types.ts';

const GO = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { sv: { ...systemeVm }, h: { ...hoteVm }, e: { ...essaisVm } };
after(() => { Object.assign(systemeVm, origine.sv); Object.assign(hoteVm, origine.h); Object.assign(essaisVm, origine.e); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');

/** Un Odin d'essai : un PC fictif (6 cœurs, 24 Go, 200 Go libres sur 500), les ISO d'essai dans l'espace ISO. */
async function monde(o: { coffre?: 'ok' | 'ko'; qemuImg?: 'ok' | 'ko'; qemu?: 'ok' | 'ko'; pendantTap?: () => Promise<void> } = {}) {
  const home = neuf('hydre-m4-'), vivants = new Set<number>(), lancees: string[][] = [], coffre: Array<Record<string, unknown>> = [];
  let pid = 4000;
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = (p: number) => vivants.has(p);
  systemeVm.qmp = async () => { throw new Error('essai : pas de QMP ici'); };
  systemeVm.dossiersQmp = () => [join(home, 'qmp')];
  hoteVm.coeurs = () => 6; hoteVm.memoire = () => 24 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  essaisVm.ping = async () => true; essaisVm.port = async () => true;
  const run = async (cmd: string, args: string[]) => {
    lancees.push([cmd, ...args]);
    if (cmd === 'sh') return { code: /qemu-system-x86_64|qemu-img|\bip$/.test(args[1] ?? '') ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    if (cmd === 'ip' && args[0] === 'tuntap' && o.pendantTap) await o.pendantTap();
    if (cmd === 'qemu-system-x86_64' && o.qemu === 'ko') return { code: 1, out: '', err: 'qemu-system-x86_64: essai : ne démarre pas' };
    if (cmd === 'qemu-img') { if (o.qemuImg === 'ko') return { code: 1, out: '', err: 'qemu-img: essai : plus de place' }; writeFileSync(args[3], 'faux disque qcow2'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'qemu-system-x86_64') { const p = ++pid; vivants.add(p); writeFileSync(args[args.indexOf('-pidfile') + 1], String(p)); return { code: 0, out: '', err: '' }; }
    return { code: 0, out: '', err: '' };
  };
  // Le coffre : un espion (rien n'est écrit dans un vrai coffre ; on voit ce qui lui est confié).
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never) as Module[];
  const bris = mods.find((m) => m.id === 'brisingamen')!, aj = bris.actions.find((a) => a.id === 'ajouter')!;
  aj.run = async (_c, i) => { coffre.push(i); return o.coffre === 'ko' ? { ok: false, text: 'coffre verrouillé (essai)' } : { text: 'ajouté' }; };
  const v = new Valhalla(home, mods, { run: run as never, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  const alertes: Array<{ level: string; title: string }> = []; v.events.on('alert', (a: { level: string; title: string }) => alertes.push(a));
  const ctx = v.ctx('ymir'), espace = join(home, 'iso'); mkdirSync(espace, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(espace, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  await v.act('ymir', 'espace_iso', { dossier: espace });
  const l = ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos;
  // Prêtes : Ubuntu, Debian, Windows (empreinte de l'éditeur, antivirus sain) ; Rocky : antivirus pas encore passé.
  for (const f of l) {
    const sha = createHash('sha256').update(readFileSync(f.chemin)).digest('hex');
    if (/rocky/i.test(f.nom)) noterFiche(ctx, { ...f, sha256: sha, editeur: true, antivirus: { at: 1, verdict: 'non analysé', texte: '' } });
    else if (/memtest/i.test(f.nom)) noterFiche(ctx, { ...f, sha256: sha, antivirus: { at: 1, verdict: 'sain', texte: '' } }); // empreinte jamais vérifiée
    else noterFiche(ctx, { ...f, sha256: sha, editeur: true, antivirus: { at: 1, verdict: 'sain', texte: 'rien trouvé' } });
  }
  const isos = ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos, id = (re: RegExp) => isos.find((f) => re.test(f.nom))!.id;
  const d = join(home, 'valhalla', 'ymir', 'machines');
  return { v, mods, ctx, home, d, vm: (n: string) => join(d, 'vm', n), vivants, lancees, coffre, alertes, id, isos,
    liste: () => { try { return JSON.parse(readFileSync(join(d, 'machines.json'), 'utf8')) as Machine[]; } catch { return []; } },
    creer: (i: Record<string, unknown>, o2: Record<string, unknown> = {}) => v.act('ymir', 'creer_vm', { coeurs: 2, memoire: 2, disque: 20, apps: '', ...i }, o2), fin: () => v.stop() };
}

test('un système prêt (pur) : empreinte vérifiée, antivirus sain ; sinon la raison', () => {
  const ok = { sha256: 'ab', editeur: true, antivirus: { at: 1, verdict: 'sain' as const, texte: '' }, systeme: 'Linux' };
  assert.equal(etatSysteme(ok), 'pret');
  assert.equal(etatSysteme({ ...ok, editeur: false }), 'empreinte', 'empreinte calculée mais jamais vérifiée');
  assert.equal(etatSysteme({ ...ok, editeur: false, verifiee: { at: 2, ok: true, texte: '' } }), 'pret', 'revérifiée par Odin');
  assert.equal(etatSysteme({ ...ok, verifiee: { at: 2, ok: false, texte: '' } }), 'bloque', 'empreinte changée');
  assert.equal(etatSysteme({ ...ok, antivirus: { at: 1, verdict: 'bloqué', texte: '' } }), 'bloque');
  assert.equal(etatSysteme({ ...ok, antivirus: { at: 1, verdict: 'à vérifier', texte: '' } }), 'verification');
  assert.equal(etatSysteme({ ...ok, antivirus: undefined }), 'verification');
  assert.equal(etatSysteme({ ...ok, ancienne: true }), 'ancienne'); assert.equal(etatSysteme({ ...ok, pilotes: true }), 'pilotes'); assert.equal(etatSysteme({ ...ok, systeme: 'macOS' }), 'mac');
  assert.equal(nomPropose({ distribution: 'Ubuntu' }, ['vm-ubuntu-1']), 'vm-ubuntu-2');
  assert.equal(nomPropose({ systeme: 'Windows', detail: 'Windows Server 2025' }, []), 'vm-windows-server-1');
});

test('le budget (pur) : un PC fictif garde de quoi faire tourner Odin ; les chiffres sont dits', () => {
  const h = { coeurs: 12, memoire: 64 * GO, disque: { total: 500 * GO, libre: 200 * GO } };
  const b = budgetVm(h, [{ ram: 2048, disque: 20 }, { ram: 4096, disque: 60, estModele: true }]);
  assert.deepEqual([b.coeursMax, b.memoireGo, b.reserveGo, b.machinesGo, b.memoireMaxGo, b.reserveDisqueGo, b.disqueMaxGo], [11, 64, 23, 2, 39, 50, 150], 'un modèle ne compte pas ; un gros PC garde plus du tiers');
  assert.deepEqual(verdictBudget(b, { cpu: 2, memoire: 2, disque: 20 }), { refus: [] }, 'dans le budget sans accord : 2 + 2 Go, 20 + 20 Go');
  let v = verdictBudget(b, { cpu: 12, memoire: 40, disque: 160 });
  assert.equal(v.refus.length, 3);
  assert.equal(v.refus[0], 'Processeurs : 12 demandés, 11 au plus (ce PC en a 12 ; un reste à Odin).');
  assert.equal(v.refus[1], 'Mémoire : 40 Go demandés, 39 Go au plus (ce PC a 64 Go ; 23 Go gardés pour Odin ; 2 Go déjà donnés à tes machines).');
  assert.equal(v.refus[2], 'Disque : 160 Go demandés, 150 Go au plus (200 Go libres ; 50 Go gardés pour Odin et tes fichiers).');
  v = verdictBudget(b, { cpu: 2, memoire: 4, disque: 40 });
  assert.deepEqual(v.refus, []); assert.match(v.accord!, /prendraient 6 Go de mémoire et 60 Go de disque : au-delà de ton budget sans accord \(4 Go de mémoire et 50 Go de disque\)/);
  assert.deepEqual(verdictBudget(budgetVm({ coeurs: 3, memoire: 12 * GO }, []), { cpu: 1, memoire: 1, disque: 10 }).refus, ['Disque : Odin ne sait pas lire la place libre du disque des machines ; rien n\'est créé.'], 'place inconnue : refus');
  assert.deepEqual(verdictBudget(b, { cpu: 0, memoire: 0, disque: 2 }).refus, ['Processeurs : au moins 1.', 'Mémoire : au moins 1 Go.', 'Disque : au moins 8 Go.']);
  // 8 Go de mémoire au total : Odin en garde 6 ; un seul cœur : la VM en a quand même un au plus.
  assert.equal(budgetVm({ coeurs: 2, memoire: 8 * GO }, []).memoireMaxGo, 2);
  assert.deepEqual([budgetVm({ coeurs: 1, memoire: 6 * GO }, []).coeursMax, budgetVm({ coeurs: 1, memoire: 6 * GO }, []).memoireMaxGo], [1, 0]);
  // Valeurs piégées : négatives, énormes, pas des nombres : refusées.
  for (const x of [{ cpu: -2, memoire: -4, disque: -20 }, { cpu: 1e9, memoire: 1e12, disque: Infinity }, { cpu: NaN, memoire: NaN, disque: NaN }]) assert.equal(verdictBudget(b, x).refus.length, 3, JSON.stringify(x));
});

test('l\'installation toute seule (pur) : archive initrd, réponses, options de QEMU, langue de ce PC', () => {
  const c = cpioNewc([{ nom: 'preseed.cfg', donnees: Buffer.from('d-i x') }]);
  assert.equal(c.subarray(0, 6).toString(), '070701'); assert.equal(c.length % 4, 0);
  assert.equal(c.subarray(110, 121).toString(), 'preseed.cfg'); assert.ok(c.includes(Buffer.from('d-i x'))); assert.ok(c.includes(Buffer.from('TRAILER!!!\0')));
  assert.throws(() => cpioNewc([{ nom: '../etc/passwd', donnees: Buffer.alloc(0) }]), /refusé/);
  const a = { host: 'vm-ubuntu-1', user: 'odin', password: 'Secret123abcDEF4', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://127.0.0.1:9/x' };
  const u = planAuto('ubuntu', a, 'abc');
  assert.match(u.reponses['user-data'], /autoinstall:/); assert.ok(!u.reponses['user-data'].includes(a.password), 'le mot de passe est chiffré'); assert.match(u.reponses['user-data'], /\$6\$/);
  assert.equal(u.noyau, 'casper/vmlinuz'); assert.equal(u.ajout, 'autoinstall ds=nocloud ---');
  const dd = planAuto('debian', a, 'abc'); assert.match(dd.preseed!, /user-password-crypted password \$6\$/); assert.ok(!dd.preseed!.includes(a.password));
  assert.throws(() => planAuto('windows', a, 'x'), /pas encore tout seul/);
  assert.deepEqual(argsInstallation({ kind: 'ubuntu', noyau: '/v/noyau', initrd: '/v/initrd', ajout: 'autoinstall ds=nocloud ---', reponses: '/v/reponses' }),
    ['-kernel', '/v/noyau', '-initrd', '/v/initrd', '-append', 'autoinstall ds=nocloud ---', '-no-reboot', '-drive', 'file.driver=vvfat,file.dir=/v/reponses,file.label=CIDATA,format=raw,if=none,id=reponses,readonly=on', '-device', 'virtio-blk-pci,drive=reponses']);
  assert.ok(argsInstallation({ kind: 'ubuntu', noyau: 'n', initrd: 'i', ajout: 'x', reponses: '/odin,essai/r' }).includes('file.driver=vvfat,file.dir=/odin,,essai/r,file.label=CIDATA,format=raw,if=none,id=reponses,readonly=on'), 'une virgule du chemin est doublée');
  assert.deepEqual(reglagesLocaux({ locale: 'fr-FR', timeZone: 'Indian/Mayotte' }), { langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' });
  assert.deepEqual(reglagesLocaux({ locale: 'sw', timeZone: 'bizarre; rm' }), { langue: 'sw_SW.UTF-8', clavier: 'us', fuseau: 'UTC' });
});

test('« Créer une VM » : ce qu\'il faut pour les étapes ; seulement les systèmes prêts ; au propriétaire seul', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('ymir', 'creation_vm');
    assert.equal(r.ok, true, r.text);
    const D = r.data as { systemes: Array<{ nom: string; etat: string; raison?: string; auto: boolean; proposition: { memoire: number } }>; budget: { coeursMax: number; memoireMaxGo: number }; refus: string; profilsLus: boolean };
    const de = (re: RegExp) => D.systemes.find((x) => re.test(x.nom))!;
    assert.deepEqual([de(/ubuntu/).etat, de(/debian/).etat, de(/Win11/).etat, de(/Rocky/).etat, de(/memtest/).etat], ['pret', 'pret', 'pret', 'verification', 'empreinte']);
    assert.match(de(/memtest/).raison!, /empreinte n'est pas encore vérifiée/);
    assert.deepEqual([de(/ubuntu/).auto, de(/debian/).auto, de(/Win11/).auto], [true, true, false], 'tout seul : Ubuntu et Debian');
    assert.deepEqual([D.budget.coeursMax, D.budget.memoireMaxGo], [5, 15]); assert.equal(D.refus, '');
    assert.match((await w.v.act('ymir', 'creation_vm', {}, { qui: 'member' })).text, /seul le propriétaire/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-a' }, { qui: 'member' })).text, /seul le propriétaire/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-a' }, { auto: true })).text, /seul le propriétaire/);
    assert.equal(w.liste().length, 0);
  } finally { w.fin(); }
});

test('refus propres, rien n\'est créé : système pas prêt, budget, nom, dossier qui existe, raccourci, Windows', async () => {
  const w = await monde();
  try {
    const rien = () => { assert.equal(w.liste().length, 0); assert.ok(!w.lancees.some((c) => c[0] === 'qemu-img' || c[0] === 'qemu-system-x86_64'), 'ni disque ni VM'); };
    assert.match((await w.creer({ iso: w.id(/Rocky/), nom: 'vm-r' })).text, /Refusé, rien n'est créé : Rocky.*antivirus/); rien();
    assert.match((await w.creer({ iso: w.id(/memtest/), nom: 'vm-m' })).text, /empreinte n'est pas encore vérifiée/); rien();
    assert.match((await w.creer({ iso: 'ubuntu', nom: 'vm-a' })).text, /choisis le système exact/, 'jamais un système « qui ressemble »'); rien();
    const b = await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-a', coeurs: 6, memoire: 16, disque: 300 });
    assert.match(b.text, /^Refusé, rien n'est créé : ce PC ne peut pas le donner en gardant de quoi faire tourner Odin/);
    assert.match(b.text, /Processeurs : 6 demandés, 5 au plus/); assert.match(b.text, /Mémoire : 16 Go demandés, 15 Go au plus \(ce PC a 24 Go ; 9 Go gardés pour Odin ; 0 Go déjà donnés/); assert.match(b.text, /Disque : 300 Go demandés, 150 Go au plus/); rien();
    for (const n of ['../evil', 'Ma VM', 'vm/x', '', '-vm']) assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: n })).text, /Refusé|Il manque/, n);
    rien();
    // Un dossier qui existe déjà (laissé par autre chose) : jamais repris, laissé intact.
    mkdirSync(w.vm('vm-deja'), { recursive: true }); writeFileSync(join(w.vm('vm-deja'), 'a-garder.txt'), 'précieux');
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-deja' })).text, /existe déjà dans le dossier des machines : il n'est jamais repris/);
    assert.equal(readFileSync(join(w.vm('vm-deja'), 'a-garder.txt'), 'utf8'), 'précieux'); rien();
    // Le dossier des VM remplacé par un raccourci vers ailleurs : refusé, rien n'est écrit là-bas.
    const ailleurs = neuf('hydre-m4-ailleurs-'); rmSync(join(w.d, 'vm'), { recursive: true, force: true });
    let lien = true; try { symlinkSync(ailleurs, join(w.d, 'vm'), 'junction'); } catch { lien = false; }
    if (lien) {
      assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-b' })).text, /raccourci vers un autre endroit : Odin ne suit aucun raccourci, rien n'est créé/);
      assert.deepEqual(readdirSync(ailleurs), [], 'rien d\'écrit ailleurs'); rien();
      rmSync(join(w.d, 'vm'), { recursive: true, force: true });
    }
    // Sous Windows : la page dit ce qui viendra, et rien n'est créé.
    systemeVm.plateforme = () => 'win32';
    const r = await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-c' });
    assert.match(r.text, /^Refusé, rien n'est créé\. Sous Windows, les VM de ce PC ne tournent pas encore/); assert.match(r.text, /hyperviseur livré avec Windows/); assert.match(r.text, /Windows Famille/);
    const D = (await w.v.act('ymir', 'creation_vm')).data as { refus: string; windows?: { avenir: string[] } };
    assert.match(D.refus, /Refusé/); assert.equal(D.windows!.avenir.length, 2);
    systemeVm.plateforme = () => 'linux'; rien();
  } finally { w.fin(); }
});

test('créer à la main (Windows) : le disque dans le dossier des VM, l\'ISO à l\'écran, le compte rendu commun', async () => {
  const w = await monde();
  try {
    const r = await w.creer({ iso: w.id(/Win11/), nom: 'vm-bureau', coeurs: 2, memoire: 4, disque: 64 });
    assert.equal(r.ok, true, r.text);
    const m = w.liste().find((x) => x.nom === 'vm-bureau')!;
    assert.equal(m.genre, 'vm'); assert.equal(m.creation?.installation, 'à la main'); assert.equal(m.creation?.auto, false); assert.equal(m.creation?.iso.editeur, true);
    assert.ok(statSync(join(w.vm('vm-bureau'), 'disque.qcow2')).isFile(), 'disque dans le dossier des VM');
    const img = w.lancees.find((c) => c[0] === 'qemu-img')!; assert.deepEqual(img.slice(0, 3), ['qemu-img', 'create', '-f']); assert.equal(img[4], join(w.vm('vm-bureau'), 'disque.qcow2')); assert.equal(img[5], '64G');
    const q = w.lancees.find((c) => c[0] === 'qemu-system-x86_64')!;
    assert.ok(q.includes('-cdrom') && !q.includes('-kernel') && !q.includes('-no-reboot'), 'l\'ISO à l\'écran, sans noyau ni arrêt au redémarrage');
    assert.equal(w.coffre.length, 0, 'aucun mot de passe : l\'installation se fait à la main');
    const t = r.text;
    for (const x of ['Où :', 'Comment entrer :', 'Fait :', 'Essayé :', 'Reste :', 'Mot de passe : celui que tu choisis pendant l\'installation', '✓ Démarre', '✓ Disque créé dans le dossier des VM', 'à la main, par son écran', 'Installer le système par son écran', '… Répond sur le réseau — pas encore : le système s\'installe par son écran']) assert.ok(t.includes(x), `${x}\n${t}`);
    assert.match(t, /Image : Win11_24H2_French_x64\.iso · empreinte [0-9a-f]{16}… \(celle de l'éditeur ✓\)/);
    // Le même nom une deuxième fois : refusé.
    assert.match((await w.creer({ iso: w.id(/Win11/), nom: 'vm-bureau' })).text, /déjà pris/);
    // Au-delà du budget sans accord (4 Go, 50 Go) : la création demande ton accord (le bouton « Créer » vaut accord).
    const a = w.mods.find((x) => x.id === 'ymir')!.actions.find((x) => x.id === 'creer_vm')!;
    assert.match(a.grave!({ iso: 'x', nom: 'vm-2', coeurs: 1, memoire: 2, disque: 20 }, w.ctx)!, /créer la VM vm-2 : avec elle, les machines créées par Odin prendraient 6 Go de mémoire et 84 Go de disque/);
  } finally { w.fin(); }
});

test('créer et installer tout seul (Ubuntu) : noyau de l\'ISO, réponses, mot de passe au coffre jamais rendu ; fin de l\'installation', async () => {
  const w = await monde();
  try {
    const r = await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-ubuntu-1', auto: true, compte: 'maman', langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte', apps: '' });
    assert.equal(r.ok, true, r.text);
    assert.equal(w.coffre.length, 1); const mdp = String(w.coffre[0].mot_de_passe);
    assert.match(mdp, /^[A-Za-z0-9]{16}$/); assert.equal(w.coffre[0].identifiant, 'maman'); assert.equal(w.coffre[0].nom, 'Machine vm-ubuntu-1 · compte maman');
    assert.ok(!JSON.stringify(r).includes(mdp), 'le mot de passe n\'est jamais rendu');
    const p = w.vm('vm-ubuntu-1'), m = w.liste().find((x) => x.nom === 'vm-ubuntu-1')!;
    assert.ok(!readFileSync(join(w.d, 'machines.json'), 'utf8').includes(mdp) && !readFileSync(join(p, 'vm.json'), 'utf8').includes(mdp), 'ni dans la liste ni dans la fiche de la VM');
    assert.deepEqual([m.creation?.auto, m.creation?.installation, m.creation?.compte, m.creation?.coffre], ['ubuntu', 'en cours', 'maman', 'Machine vm-ubuntu-1 · compte maman']);
    const ud = readFileSync(join(p, 'reponses', 'user-data'), 'utf8');
    assert.match(ud, /autoinstall:/); assert.match(ud, /username: maman/); assert.match(ud, /hostname: vm-ubuntu-1/); assert.match(ud, /keyboard: \{layout: fr\}/); assert.ok(!ud.includes(mdp), 'chiffré dans les réponses');
    assert.match(readFileSync(join(p, 'installation', 'noyau'), 'latin1'), /^NOYAU-UBUNTU/, 'le noyau lu dans l\'ISO');
    const q = w.lancees.find((c) => c[0] === 'qemu-system-x86_64')!, at = (k: string) => q[q.indexOf(k) + 1];
    assert.equal(at('-kernel'), join(p, 'installation', 'noyau')); assert.equal(at('-append'), 'autoinstall ds=nocloud ---'); assert.ok(q.includes('-no-reboot')); assert.ok(q.includes('-cdrom'));
    assert.ok(q.some((x) => x === `file.driver=vvfat,file.dir=${join(p, 'reponses')},file.label=CIDATA,format=raw,if=none,id=reponses,readonly=on`), 'réponses en lecture seule');
    assert.match(r.text, /Mot de passe : au coffre \(« Machine vm-ubuntu-1 · compte maman »\), jamais montré ici/); assert.match(r.text, /Commande : ssh maman@10\.0\.3\.\d+/);
    assert.match(r.text, /… Répond sur le réseau — pas encore : installation en cours/); assert.match(r.text, /Attendre la fin de l'installation/);
    // La veille : la VM tourne encore → rien. Puis son premier redémarrage l'arrête : réponses effacées, relancée sur son disque.
    await finInstallations(w.ctx); assert.ok(existsSync(join(p, 'reponses')));
    w.vivants.clear(); const avant = w.lancees.length;
    await finInstallations(w.ctx);
    assert.ok(!existsSync(join(p, 'reponses')) && !existsSync(join(p, 'installation')), 'réponses et noyau effacés');
    assert.ok(existsSync(join(p, 'disque.qcow2')), 'le disque reste');
    const m2 = w.liste().find((x) => x.nom === 'vm-ubuntu-1')!; assert.equal(m2.creation?.installation, 'finie');
    const q2 = w.lancees.slice(avant).find((c) => c[0] === 'qemu-system-x86_64')!;
    assert.ok(!q2.includes('-kernel') && !q2.includes('-cdrom') && !q2.includes('-no-reboot'), 'relancée sur son disque, sans ISO ni réponses');
    assert.ok(w.alertes.some((a) => a.title === 'vm-ubuntu-1 est installée'));
    // Le compte rendu, refait maintenant : réseau et accès à distance essayés (simulés).
    const c = await w.v.act('ymir', 'compte_rendu_machine', { machine: 'vm-ubuntu-1' });
    assert.match(c.text, /✓ Répond sur le réseau — ping 10\.0\.3\.\d+ : répond/); assert.match(c.text, /✓ Connexion à distance \(SSH\) — port 22/); assert.match(c.text, /toute seule \(installateur automatique d'Ubuntu\) · finie/);
    assert.ok(!JSON.stringify(c).includes(mdp));
    assert.match((await w.v.act('ymir', 'compte_rendu_machine', { machine: 'vm-ubuntu-1' }, { qui: 'member' })).text, /seul le propriétaire/);
  } finally { w.fin(); }
});

test('Debian tout seul : réponses ajoutées à son initrd ; arrêtée par toi pendant l\'installation : « interrompue », réponses effacées', async () => {
  const w = await monde();
  try {
    assert.match((await w.creer({ iso: w.id(/debian/), nom: 'vm-d', auto: true, reseau: 'aucun' })).text, /Debian s'installe par Internet/);
    const r = await w.creer({ iso: w.id(/debian/), nom: 'vm-debian-1', auto: true, compte: 'odin', langue: 'en_US.UTF-8', clavier: 'us', fuseau: 'UTC' });
    assert.equal(r.ok, true, r.text);
    const p = w.vm('vm-debian-1'), ini = readFileSync(join(p, 'installation', 'initrd'));
    const orig = readFileSync(w.isos.find((f) => /debian/.test(f.nom))!.chemin); assert.ok(orig.length > 0);
    // L'initrd de l'ISO (16 octets), puis l'archive des réponses.
    const cp = gunzipSync(ini.subarray(16)).toString('latin1');
    assert.match(cp, /^070701/); assert.match(cp, /preseed\.cfg/); assert.match(cp, /d-i passwd\/username string odin/); assert.match(cp, /d-i passwd\/user-password-crypted password \$6\$/);
    assert.ok(!existsSync(join(p, 'reponses')), 'Debian : pas de disque de réponses');
    const q = w.lancees.find((c) => c[0] === 'qemu-system-x86_64')!; assert.equal(q[q.indexOf('-append') + 1], 'auto=true priority=critical ---');
    await w.v.act('ymir', 'arreter_machine', { machine: 'vm-debian-1', forcer: true }); w.vivants.clear();
    await finInstallations(w.ctx);
    assert.equal(w.liste().find((x) => x.nom === 'vm-debian-1')!.creation?.installation, 'interrompue');
    assert.ok(!existsSync(join(p, 'installation')), 'réponses effacées'); assert.ok(!w.alertes.some((a) => /installée/.test(a.title)), 'pas relancée');
  } finally { w.fin(); }
});

test('tout seul : refus (Windows, compte, langue piégée, profil inconnu) ; coffre fermé ou disque raté : le dossier neuf est effacé', async () => {
  const w = await monde();
  try {
    assert.match((await w.creer({ iso: w.id(/Win11/), nom: 'vm-w', auto: true })).text, /Windows : à installer par son écran pour l'instant/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-u', auto: true, compte: 'root' })).text, /pas un compte du système/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-u', auto: true, langue: 'fr_FR\nd-i preseed/late_command string rm -rf /' })).text, /langue : par exemple/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-u', auto: true, fuseau: 'Europe/Paris; rm' })).text, /fuseau/);
    assert.match((await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-u', profil: 'inconnu' })).text, /profil de logiciels introuvable/);
    assert.equal(w.liste().length, 0); assert.ok(!existsSync(w.vm('vm-u')) && !existsSync(w.vm('vm-w')));
  } finally { w.fin(); }
  const k = await monde({ coffre: 'ko' });
  try {
    const r = await k.creer({ iso: k.id(/ubuntu/), nom: 'vm-u', auto: true });
    assert.match(r.text, /le coffre n'a pas pu ranger son mot de passe/); assert.equal(k.liste().length, 0); assert.ok(!existsSync(k.vm('vm-u')), 'dossier neuf effacé (et ses réponses avec)');
    assert.ok(!k.lancees.some((c) => c[0] === 'qemu-img'));
  } finally { k.fin(); }
  const z = await monde({ qemuImg: 'ko' });
  try {
    const r = await z.creer({ iso: z.id(/Win11/), nom: 'vm-w', disque: 64, memoire: 4 });
    assert.match(r.text, /disque de la VM : qemu-img: essai : plus de place/); assert.equal(z.liste().length, 0); assert.ok(!existsSync(z.vm('vm-w')));
  } finally { z.fin(); }
});

test('le compte rendu (pur) : jamais de mot de passe, sans réseau dit, Windows : bureau à distance', () => {
  const m: Machine = { id: 'x', nom: 'vm-x', genre: 'vm', systeme: 'Windows 11', version: '', famille: 'Windows', cpu: 2, ram: 4096, disque: 64, ip: '10.0.3.70', mac: '02:0d:1e:00:00:70', cree: 0, apps: ['vidarr'], paquets: [], sansReseau: true,
    creation: { at: 0, iso: { nom: 'w.iso', sha256: 'a'.repeat(64), editeur: false, taille: 1 }, auto: false, installation: 'à la main', profil: { id: 'bureau', nom: 'Bureau' } } };
  const r = compteRendu(m, { etat: 'éteinte', reseau: { pont: 'lxcbr0', prefixe: '10.0.3' } }), t = texteCompteRendu(r);
  assert.match(t, /Adresse : 10\.0\.3\.70 \(réservée ; aucun réseau\)/); assert.ok(!/\.maison/.test(t), 'pas de nom sur le réseau sans réseau');
  assert.match(t, /revérifiée par Odin ✓/); assert.match(t, /Profil de logiciels \(Genèse\) : Bureau/); assert.match(t, /Poser les logiciels du profil « Bureau » : Hydre ne le fait pas encore/);
  const r2 = compteRendu({ ...m, sansReseau: false }, { etat: 'en marche', reseau: { pont: 'br0', prefixe: '192.168.1' } });
  assert.deepEqual(r2.entrer.at(-1), ['Bureau à distance', '10.0.3.70 (une fois activé dans Windows)']); assert.ok(r2.ou.some(([k, v]) => k === 'Réseau' && /maison \(pont br0\)/.test(v)));
});

test('relecture : deux créations en même temps (le budget lu deux fois) : la deuxième est refusée, rien n\'est créé', async () => {
  // Chacune tient seule dans le budget de ce PC fictif (15 Go au plus), les deux ensemble non (2 × 9 Go).
  const w = await monde();
  try {
    const [a, b] = await Promise.all([w.creer({ iso: w.id(/Win11/), nom: 'vm-un', memoire: 9 }), w.creer({ iso: w.id(/Win11/), nom: 'vm-deux', memoire: 9 })]);
    assert.equal([a, b].filter((r) => r.ok !== false).length, 1, `${a.text}\n---\n${b.text}`);
    assert.match((a.ok === false ? a : b).text, /^Refusé, rien n'est créé : une autre VM \(« vm-un »\) est en train d'être créée/);
    const l = w.liste(); assert.equal(l.length, 1);
    assert.ok(!existsSync(w.vm('vm-deux')), 'aucun dossier pour la refusée');
    // Après la première : la suivante relit le budget (9 Go déjà donnés) et refuse ce qui ne tient plus.
    assert.match((await w.creer({ iso: w.id(/Win11/), nom: 'vm-deux', memoire: 9 })).text, /Mémoire : 9 Go demandés, 6 Go au plus .*9 Go déjà donnés/);
  } finally { w.fin(); }
});

test('relecture : la veille pendant une création ne touche pas la VM (ni réponses effacées, ni démarrage en double)', async () => {
  const veille: { ctx?: Parameters<typeof finInstallations>[0] } = {};
  const w = await monde({ pendantTap: async () => { if (veille.ctx) await finInstallations(veille.ctx); } });
  veille.ctx = w.ctx;
  try {
    const r = await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-ubuntu-1', auto: true });
    assert.equal(r.ok, true, r.text);
    const p = w.vm('vm-ubuntu-1');
    assert.ok(existsSync(join(p, 'reponses', 'user-data')), 'les réponses sont encore là pour l\'installation');
    assert.equal(w.lancees.filter((c) => c[0] === 'qemu-system-x86_64').length, 1, 'un seul QEMU sur ce disque');
    assert.equal(w.liste()[0].creation?.installation, 'en cours'); assert.ok(!w.alertes.some((a) => /installée/.test(a.title)));
  } finally { w.fin(); }
});

test('relecture : QEMU ne démarre pas pendant une installation toute seule : « interrompue », réponses effacées, jamais « installée »', async () => {
  const w = await monde({ qemu: 'ko' });
  try {
    const r = await w.creer({ iso: w.id(/ubuntu/), nom: 'vm-ubuntu-1', auto: true });
    assert.match(r.text, /⚠ Démarrage : .*ne démarre pas/);
    const p = w.vm('vm-ubuntu-1');
    assert.ok(!existsSync(join(p, 'reponses')) && !existsSync(join(p, 'installation')), 'réponses effacées tout de suite');
    assert.equal(w.liste()[0].creation?.installation, 'interrompue');
    const avant = w.lancees.length; await finInstallations(w.ctx);
    assert.ok(!w.alertes.some((a) => /installée/.test(a.title)), 'jamais dite installée'); assert.ok(!w.lancees.slice(avant).some((c) => c[0] === 'qemu-system-x86_64'), 'pas relancée sur un disque vide');
  } finally { w.fin(); }
});

test('relecture : sans Odin pour relire le budget, « Créer une VM » compte comme grave (liens, automatismes)', () => {
  const h = neuf('hydre-m4-g-'), mods = allModules({ paths: { home: h, workspace: h }, cfg: DEFAULT_CONFIG } as never) as Module[];
  const a = mods.find((x) => x.id === 'ymir')!.actions.find((x) => x.id === 'creer_vm')!;
  assert.match(a.grave!({ nom: 'vm-x' })!, /budget de ce PC est relu/);
});
