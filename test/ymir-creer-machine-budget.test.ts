// Hydre : l'ancienne action « creer_machine » (genre vm), appelée par Genèse et par la conversation, passe par les MÊMES
// garde-fous que « creer_vm » (lot M4) : le budget de ce PC (refus avec les chiffres), une seule création de VM à la fois,
// un dossier neuf dans le dossier des VM (jamais un dossier déjà là, aucun raccourci), ton accord au-delà de ton budget
// sans accord, réservé au propriétaire, refus propre hors Linux. Les LXC ne changent pas.
// AUCUNE vraie VM : QEMU et qemu-img simulés, un PC fictif (jamais la vraie machine), de petites ISO d'essai.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Module } from '../src/valhalla/types.ts';

const GO = 1024 ** 3;
const dossiers: string[] = [];
const origine = { sv: { ...systemeVm }, h: { ...hoteVm } };
after(() => { Object.assign(systemeVm, origine.sv); Object.assign(hoteVm, origine.h); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Un Odin d'essai sur un PC fictif (6 cœurs, 24 Go, 200 Go libres sur 500), une ISO Debian d'essai dans la bibliothèque. */
async function monde(o: { lenteImg?: Promise<void>; imgKo?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'hydre-cm-budget-')); dossiers.push(home);
  const lancees: string[][] = [];
  let imgKo = o.imgKo === true;
  let pid = 7000;
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = () => false;
  systemeVm.qmp = async () => { throw new Error('essai : pas de QMP ici'); };
  systemeVm.dossiersQmp = () => [join(home, 'qmp')];
  hoteVm.coeurs = () => 6; hoteVm.memoire = () => 24 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  const run = async (cmd: string, args: string[]) => {
    lancees.push([cmd, ...args]);
    if (cmd === 'sh') return { code: /qemu-system-x86_64|qemu-img|\bip$|lxc-/.test(args[1] ?? '') ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    if (cmd === 'qemu-img') { if (o.lenteImg) await o.lenteImg; if (imgKo) return { code: 1, out: '', err: 'qemu-img: essai : plus de place' }; writeFileSync(args[3], 'faux disque qcow2'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'qemu-system-x86_64') { writeFileSync(args[args.indexOf('-pidfile') + 1], String(++pid)); return { code: 0, out: '', err: '' }; }
    const P = args[args.indexOf('-P') + 1], name = args[args.indexOf('-n') + 1];
    if (cmd === 'lxc-create') { mkdirSync(join(P, name, 'rootfs'), { recursive: true }); writeFileSync(join(P, name, 'config'), `lxc.uts.name = ${name}\n`); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-info') return { code: 0, out: `Name: ${name}\nState: RUNNING\n`, err: '' };
    return { code: 0, out: '', err: '' };
  };
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never) as Module[];
  const v = new Valhalla(home, mods, { run: run as never, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  const espace = join(home, 'iso'); mkdirSync(espace, { recursive: true });
  writeFileSync(join(espace, 'debian-13.2.0-amd64-netinst.iso'), 'debian (essai)');
  await v.act('ymir', 'espace_iso', { dossier: espace });
  const d = join(home, 'valhalla', 'ymir', 'machines');
  return { v, home, d, lancees,
    liste: () => { try { return JSON.parse(readFileSync(join(d, 'machines.json'), 'utf8')) as Machine[]; } catch { return []; } },
    dossiersVm: () => { try { return readdirSync(join(d, 'vm')); } catch { return []; } },
    vm: (i: Record<string, unknown>, o2: Record<string, unknown> = {}) => v.act('ymir', 'creer_machine', { genre: 'vm', iso: 'debian-13.2.0-amd64-netinst', apps: '', ...i }, o2),
    imgOk: () => { imgKo = false; },
    fin: () => v.stop() };
}

test('creer_machine (genre vm) au-delà du budget de ce PC : refusée avec les chiffres, rien n\'est créé', async () => {
  const w = await monde();
  try {
    // 6 cœurs : 5 au plus ; 24 Go : 9 gardés pour Odin, 15 au plus ; 200 Go libres : 50 gardés, 150 au plus.
    const r = await w.vm({ nom: 'trop-grosse', coeurs: 6, memoire: 16, disque: 160 });
    assert.equal(r.ok, false, r.text);
    assert.match(r.text, /Refusé, rien n'est créé : ce PC ne peut pas le donner en gardant de quoi faire tourner Odin/);
    assert.match(r.text, /Processeurs : 6 demandés, 5 au plus \(ce PC en a 6 ; un reste à Odin\)/);
    assert.match(r.text, /Mémoire : 16 Go demandés, 15 Go au plus/);
    assert.match(r.text, /Disque : 160 Go demandés, 150 Go au plus/);
    assert.deepEqual(w.liste(), [], 'aucune machine notée');
    assert.deepEqual(w.dossiersVm(), [], 'aucun dossier de VM');
    assert.ok(!w.lancees.some((c) => c[0] === 'qemu-img' || c[0] === 'qemu-system-x86_64'), 'ni disque ni démarrage');
    // Les machines déjà données comptent : 2 VM de 8 Go, il ne reste que 15 − 16 → 0 Go pour une troisième.
    assert.equal((await w.vm({ nom: 'a', coeurs: 2, memoire: 8, disque: 20 })).ok, true);
    const r2 = await w.vm({ nom: 'b', coeurs: 2, memoire: 8, disque: 20 });
    assert.equal(r2.ok, false); assert.match(r2.text, /Mémoire : 8 Go demandés, 7 Go au plus \(ce PC a 24 Go ; 9 Go gardés pour Odin ; 8 Go déjà donnés à tes machines\)/);
    assert.deepEqual(w.liste().map((m) => m.nom), ['a']);
  } finally { w.fin(); }
});

test('creer_machine (genre vm) au-delà de ton budget sans accord : demande ton accord ; réservée au propriétaire ; un LXC sans question', async () => {
  const w = await monde();
  try {
    const a = w.v.action('ymir', 'creer_machine')!.a, ctx = w.v.ctx('ymir');
    // Ton budget sans accord : 4 Go de mémoire et 50 Go de disque pour toutes les machines créées par Odin.
    assert.match(a.grave!({ genre: 'vm', nom: 'grosse', coeurs: 2, memoire: 6, disque: 20 }, ctx)!, /^créer la VM grosse : avec elle, les machines créées par Odin prendraient 6 Go de mémoire : au-delà de ton budget sans accord \(4 Go de mémoire et 50 Go de disque\)$/);
    assert.match(a.grave!({ genre: 'vm', coeurs: 2, memoire: 2, disque: 60 }, ctx)!, /^créer la VM \(nom automatique\) : .*prendraient 60 Go de disque/, 'sans nom : le nom automatique');
    assert.equal(a.grave!({ genre: 'vm', nom: 'petite', coeurs: 2, memoire: 2, disque: 20 }, ctx), undefined, 'dans le budget sans accord : pas de question');
    assert.equal(a.grave!({ genre: 'lxc', modele: 'debian trixie', memoire: 64, disque: 900 }, ctx), undefined, 'un LXC : comme avant');
    assert.equal(typeof a.proprietaireSeul === 'function' && a.proprietaireSeul({ genre: 'vm' }), true);
    assert.equal(typeof a.proprietaireSeul === 'function' && a.proprietaireSeul({ genre: 'lxc' }), false);
    // Une automatisation : refusée, rien n'est créé.
    const r = await w.vm({ nom: 'grosse', coeurs: 2, memoire: 6, disque: 20 }, { auto: true });
    assert.equal(r.ok, false); assert.match(r.text, /seul le propriétaire/);
    assert.deepEqual(w.liste(), []); assert.deepEqual(w.dossiersVm(), []);
    // Le propriétaire lui-même (sa validation) : créée.
    const moi = await w.vm({ nom: 'grosse', coeurs: 2, memoire: 6, disque: 20 });
    assert.equal(moi.ok, true, moi.text); assert.deepEqual(w.liste().map((m) => m.nom), ['grosse']); assert.deepEqual(w.dossiersVm(), ['grosse']);
  } finally { w.fin(); }
});

test('creer_machine (genre vm) : une seule création de VM à la fois, partagée avec creer_vm', async () => {
  let lacher!: () => void; const lente = new Promise<void>((ok) => { lacher = ok; });
  const w = await monde({ lenteImg: lente });
  try {
    const p1 = w.vm({ nom: 'premiere', coeurs: 2, memoire: 2, disque: 20 });
    for (let k = 0; k < 50 && !w.lancees.some((c) => c[0] === 'qemu-img'); k++) await new Promise((ok) => setTimeout(ok, 10));
    // (Sans le verrou, la deuxième attendrait le même disque lent : elle est comptée « partie en même temps ».)
    const r2 = await Promise.race([w.vm({ nom: 'deuxieme', coeurs: 2, memoire: 2, disque: 20 }), new Promise<{ ok: boolean; text: string }>((ok) => setTimeout(() => ok({ ok: true, text: 'partie en même temps que la première' }), 1500))]);
    assert.equal(r2.ok, false); assert.match(r2.text, /une autre VM \(« premiere »\) est en train d'être créée/);
    const r3 = await w.v.act('ymir', 'creer_vm', { iso: 'debian-13.2.0-amd64-netinst.iso', nom: 'troisieme', coeurs: 2, memoire: 2, disque: 20, apps: '' });
    assert.equal(r3.ok, false); assert.match(r3.text, /une autre VM \(« premiere »\) est en train d'être créée/);
    lacher();
    assert.equal((await p1).ok, true);
    assert.deepEqual(w.liste().map((m) => m.nom), ['premiere']); assert.deepEqual(w.dossiersVm(), ['premiere']);
  } finally { lacher(); w.fin(); }
});

test('creer_machine (genre vm) : un dossier neuf seulement, jamais un dossier déjà là ni un raccourci', async () => {
  const w = await monde();
  try {
    // Un dossier « vieille » déjà là (restes d'autre chose) : jamais repris, rien n'est écrit dedans.
    mkdirSync(join(w.d, 'vm', 'vieille'), { recursive: true }); writeFileSync(join(w.d, 'vm', 'vieille', 'garde.txt'), 'à garder');
    const r = await w.vm({ nom: 'vieille', coeurs: 2, memoire: 2, disque: 20 });
    assert.equal(r.ok, false); assert.match(r.text, /un dossier « vieille » existe déjà dans le dossier des machines : il n'est jamais repris/);
    assert.deepEqual(readdirSync(join(w.d, 'vm', 'vieille')), ['garde.txt']); assert.deepEqual(w.liste(), []);
    // Le dossier des VM devenu un raccourci : refus, rien n'est créé de l'autre côté.
    const ailleurs = join(w.home, 'ailleurs'); mkdirSync(ailleurs);
    rmSync(join(w.d, 'vm'), { recursive: true, force: true });
    let lien = true; try { symlinkSync(ailleurs, join(w.d, 'vm'), 'junction'); } catch { lien = false; }
    if (lien) {
      const r2 = await w.vm({ nom: 'par-le-lien', coeurs: 2, memoire: 2, disque: 20 });
      assert.equal(r2.ok, false); assert.match(r2.text, /raccourci/); assert.deepEqual(readdirSync(ailleurs), []);
      try { rmSync(join(w.d, 'vm'), { force: true }); } catch { /* le dossier d'essai est effacé à la fin */ }
    }
  } finally { w.fin(); }
});

test('creer_machine (genre vm) : un disque qui ne se crée pas ne laisse aucun dossier ; un nom déjà pris est refusé avant tout dossier', async () => {
  const w = await monde({ imgKo: true });
  try {
    const ko = await w.vm({ nom: 'rate', coeurs: 2, memoire: 2, disque: 20 });
    assert.equal(ko.ok, false); assert.match(ko.text, /plus de place/);
    assert.deepEqual(w.dossiersVm(), [], 'le dossier neuf est retiré'); assert.deepEqual(w.liste(), []);
    w.imgOk();
    assert.equal((await w.vm({ nom: 'une', coeurs: 2, memoire: 2, disque: 20 })).ok, true);
    const r = await w.vm({ nom: 'une', coeurs: 2, memoire: 2, disque: 20 });
    assert.equal(r.ok, false); assert.match(r.text, /le nom « une » est déjà pris/);
    assert.deepEqual(w.dossiersVm(), ['une']); assert.equal(w.liste().length, 1);
  } finally { w.fin(); }
});

test('creer_machine hors Linux (genre vm) : refusée proprement ; les LXC ne changent pas', async () => {
  const w = await monde();
  try {
    systemeVm.plateforme = () => 'win32';
    const r = await w.vm({ nom: 'sous-windows', coeurs: 2, memoire: 2, disque: 20 });
    assert.equal(r.ok, false); assert.match(r.text, /^Refusé, rien n'est créé\./); assert.deepEqual(w.dossiersVm(), []);
    systemeVm.plateforme = () => 'linux';
    // Un LXC : ni budget, ni accord, ni réservé au propriétaire (comme avant) ; même gros, même depuis une automatisation.
    const l = await w.v.act('ymir', 'creer_machine', { genre: 'lxc', modele: 'debian trixie', nom: 'web', coeurs: 6, memoire: 64, disque: 900, apps: '' }, { auto: true });
    assert.equal(l.ok, true, l.text); assert.ok(existsSync(join(w.d, 'lxc', 'web', 'config')));
  } finally { w.fin(); }
});
