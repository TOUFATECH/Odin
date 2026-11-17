// Alchimie (dvalinn) « convertir » demandé par quelqu'un d'autre que le propriétaire (décision du propriétaire, 17/11 :
// un membre convertit un document seul — « Odin crée un nouveau fichier à côté, l'original n'est pas touché »).
// Avant de convertir, Alchimie fait vérifier le fichier par l'antivirus ; sur une menace sûre, elle le mettait à l'écart
// d'elle-même. Pour un autre que le propriétaire : la conversion est refusée, l'original reste à sa place, rien n'est mis
// en quarantaine, et le propriétaire est prévenu (la mise à l'écart lui reste demandée). Pour lui : rien ne change.
// Sur le produit : une vraie Valhalla, les vraies applis (Alchimie, Asclépios), les commandes du système notées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';

const MENACE = 'KOBOLD-CHIFFRE-TOUT-9731';

async function monde() {
  const home = mkdtempSync(join(tmpdir(), 'odin-dvalinn-membre-')), messages: string[] = [];
  const paths = { home, workspace: join(home, 'workspace') };
  mkdirSync(paths.workspace, { recursive: true });
  const v = new Valhalla(home, allModules({ paths, cfg: {} } as never), {
    run: async () => ({ code: 0, out: '', err: '' }),
    fetch: (async () => new Response('')) as unknown as typeof fetch,
    notify: async (t) => { messages.push(t); }, autonomy: () => 'equilibre',
  });
  // Le propriétaire a une règle de détection : un fichier qui la contient est une menace sûre (critique).
  const r = await v.act('ullr', 'regle', { nom: 'Rançongiciel Kobold', chaines: MENACE, gravite: 'critique' });
  assert.equal(r.ok, true, r.text);
  const atelier = join(v.ctx('dvalinn').dir, 'atelier'); mkdirSync(atelier, { recursive: true });
  const quarantaine = () => (v.ctx('ullr').settings.quarantine as unknown[] | undefined) ?? [];
  return { v, messages, atelier, quarantaine, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

const AUTRES: Array<[string, Parameters<Valhalla['act']>[3]]> = [
  ['un membre', { qui: 'member' }],
  ['un invité', { qui: 'guest' }],
  ['une automatisation', { auto: true }],
  ['un réflexe', { by: 'réflexe' }],
  ['Odin seul', { by: 'odin' }],
  ['une conversation qui a lu un contenu extérieur', { marque: true }],
];

for (const [qui, o] of AUTRES) {
  test(`convertir un fichier dangereux, demandé par ${qui} : refusé, l'original reste à sa place, rien en quarantaine, le propriétaire est prévenu`, async () => {
    const w = await monde();
    try {
      const f = join(w.atelier, `outil-${qui.length}.bin`); writeFileSync(f, `Devis\n....${MENACE}....\n`);
      const r = await w.v.act('dvalinn', 'convertir', { fichier: `atelier:${f.slice(w.atelier.length + 1)}`, format: 'pdf' }, o);
      assert.equal(r.ok, false, r.text);
      assert.match(r.text, /suspect/);
      assert.ok(existsSync(f), 'l\'original est toujours là');
      assert.equal(readFileSync(f, 'utf8'), `Devis\n....${MENACE}....\n`, 'et intact');
      assert.deepEqual(w.quarantaine(), [], 'rien en quarantaine');
      assert.ok(w.messages.some((m) => m.includes(f.split(/[\\/]/).pop()!) && /quarantaine|écart/.test(m)), `le propriétaire est prévenu : ${JSON.stringify(w.messages)}`);
      assert.deepEqual(w.v.manips().filter((m) => m.module === 'ullr' && m.action === 'isoler'), [], 'aucune mise à l\'écart notée');
    } finally { w.fin(); }
  });
}

test('convertir un fichier sain, demandé par un membre : un nouveau fichier à côté, l\'original et l\'existant intacts', async () => {
  const w = await monde();
  try {
    const SRT = '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n';
    writeFileSync(join(w.atelier, 'essai.srt'), SRT); writeFileSync(join(w.atelier, 'essai.vtt'), 'DÉJÀ LÀ');
    const r = await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:essai.srt', format: 'vtt' }, { qui: 'member' });
    assert.equal(r.ok, true, r.text);
    assert.equal(readFileSync(join(w.atelier, 'essai.srt'), 'utf8'), SRT, 'l\'original n\'est pas touché');
    assert.equal(readFileSync(join(w.atelier, 'essai.vtt'), 'utf8'), 'DÉJÀ LÀ', 'un fichier existant n\'est pas écrasé');
    const nouveaux = readdirSync(w.atelier).filter((x) => x.endsWith('.vtt') && x !== 'essai.vtt');
    assert.equal(nouveaux.length, 1, `un nouveau fichier à côté : ${nouveaux.join(', ')}`);
    assert.match(readFileSync(join(w.atelier, nouveaux[0]), 'utf8'), /^WEBVTT/);
    assert.deepEqual(w.quarantaine(), []);
  } finally { w.fin(); }
});

test('convertir un fichier dangereux, demandé par le propriétaire : comme avant, mis en quarantaine (réversible)', async () => {
  const w = await monde();
  try {
    const f = join(w.atelier, 'outil.bin'); writeFileSync(f, `Devis\n....${MENACE}....\n`);
    const r = await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' });
    assert.equal(r.ok, false, r.text);
    assert.match(r.text, /Je l'ai mis en quarantaine/);
    assert.equal(existsSync(f), false, 'l\'original est à l\'écart');
    assert.equal(w.quarantaine().length, 1, 'un élément en quarantaine');
    // La mise à l'écart reste un réflexe noté au journal des manips, à garder ou annuler (comme avant).
    assert.ok(w.v.manips().some((m) => m.module === 'ullr' && m.action === 'isoler' && m.by === 'réflexe' && m.state === 'à décider'), JSON.stringify(w.v.manips()));
  } finally { w.fin(); }
});

test('refusé à un membre, puis converti par le propriétaire : le refus n\'est pas gardé, la quarantaine se fait comme avant', async () => {
  const w = await monde();
  try {
    const f = join(w.atelier, 'outil.bin'); writeFileSync(f, `Devis\n....${MENACE}....\n`);
    assert.equal((await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' }, { qui: 'member' })).ok, false);
    assert.ok(existsSync(f)); assert.deepEqual(w.quarantaine(), []);
    const r = await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' });
    assert.match(r.text, /Je l'ai mis en quarantaine/);
    assert.equal(existsSync(f), false); assert.equal(w.quarantaine().length, 1);
  } finally { w.fin(); }
});

test('le message au propriétaire ne prétend pas qu\'un autre a demandé : une automatisation ou une conversation marquée peut venir de lui', async () => {
  for (const o of [{ auto: true }, { marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
    const w = await monde();
    try {
      const f = join(w.atelier, 'outil.bin'); writeFileSync(f, `Devis\n....${MENACE}....\n`);
      assert.equal((await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' }, o)).ok, false);
      const m = w.messages.find((x) => x.includes('outil.bin')) ?? '';
      assert.ok(m, JSON.stringify(w.messages));
      assert.doesNotMatch(m, /quelqu'un d'autre que toi/);
      assert.match(m, /sans toi en direct/);
    } finally { w.fin(); }
  }
});

test('un membre qui relance la conversion du même fichier dangereux : le propriétaire n\'est prévenu qu\'une fois, et c\'est toujours refusé', async () => {
  const w = await monde();
  try {
    const f = join(w.atelier, 'outil.bin'); writeFileSync(f, `Devis\n....${MENACE}....\n`);
    for (let n = 0; n < 3; n++) {
      const r = await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' }, { qui: 'member' });
      assert.equal(r.ok, false, r.text); assert.match(r.text, /demandé au propriétaire/);
    }
    assert.equal(w.messages.filter((x) => x.includes('outil.bin')).length, 1, JSON.stringify(w.messages));
    assert.ok(existsSync(f)); assert.deepEqual(w.quarantaine(), []);
    // Le propriétaire convertit ensuite lui-même : la mise à l'écart se fait comme avant.
    assert.match((await w.v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.bin', format: 'pdf' })).text, /Je l'ai mis en quarantaine/);
    assert.equal(existsSync(f), false);
  } finally { w.fin(); }
});

test('l\'étape « mettre à l\'écart » d\'Alchimie est réservée au propriétaire, même demandée directement', async () => {
  const w = await monde();
  try {
    const f = join(w.atelier, 'outil.bin'); writeFileSync(f, `Devis\n....${MENACE}....\n`);
    for (const o of AUTRES.map((x) => x[1])) {
      const r = await w.v.act('dvalinn', 'isoler_avant_conversion', { fichier: f, menace: 'essai' }, o);
      assert.equal(r.ok, false, r.text); assert.match(r.text, /seul le propriétaire/);
    }
    assert.ok(existsSync(f)); assert.deepEqual(w.quarantaine(), []);
  } finally { w.fin(); }
});
