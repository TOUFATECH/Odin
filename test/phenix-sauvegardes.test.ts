// Phénix : sauvegardes complètes, incrémentielles et différentielles (chaîne, fichiers effacés), rotation qui garde
// la chaîne, compression, destinations (copie vérifiée, copie locale retirée puis rapatriée), commandes avant et
// après (graves), restauration par le navigateur (parcourir, télécharger, remettre), purge (grave).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aOublier, chunkRel, dossierDe, envoyerDepot, Repo, restore, sauvegarder, typeDuJour, verify, vue, type Snapshot } from '../src/valhalla/modules/sindri.ts';
import { enTeteTar, lignesDossiers, lireDestination, relOk, tarDe, transportDe } from '../src/valhalla/sindri/transport.ts';
import { entreeLs } from '../src/machines/smb.ts';
import { lireTar } from '../src/files/tar-flux.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const snap = (id: string, at: string, o: Partial<Snapshot> = {}): Snapshot => ({ id, at, plan: 'p', paths: [], files: [], bytes: 0, added: 0, ...o });

test('chaîne de sauvegardes, rotation qui garde les parents, sorte du jour, dossier d\'une version', () => {
  const f = (path: string, size = 1) => ({ path, size, mtime: 1, mode: 0o644, chunks: [] });
  const full = snap('a', '2026-11-01T02:00:00Z', { type: 'complète', files: [f('/d/x'), f('/d/y')] });
  const i1 = snap('b', '2026-11-02T02:00:00Z', { type: 'incrémentielle', parent: 'a', files: [f('/d/x', 2)], present: ['/d/x', '/d/y'] });
  const i2 = snap('c', '2026-11-03T02:00:00Z', { type: 'incrémentielle', parent: 'b', files: [f('/d/z')], present: ['/d/x', '/d/z'] });
  const v = vue([full, i1, i2], i2);
  assert.deepEqual([...v.keys()].sort(), ['/d/x', '/d/z'], '/d/y effacé entre-temps'); assert.equal(v.get('/d/x')!.size, 2);
  assert.throws(() => vue([i2], i2), /manque/);
  // Garder seulement la dernière : ses parents restent.
  assert.deepEqual(aOublier([full, i1, i2], { last: 1, daily: 0, weekly: 0, monthly: 0 }).map((x) => x.id), []);
  const full2 = snap('d', '2026-11-04T02:00:00Z', { type: 'complète' });
  assert.deepEqual(aOublier([full, i1, i2, full2], { last: 1, daily: 0, weekly: 0, monthly: 0 }).map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.equal(typeDuJour({ schema: 'incrémentielle', completeTous: 7 }, [], new Date()), 'complète');
  assert.equal(typeDuJour({ schema: 'incrémentielle', completeTous: 7 }, [full], new Date('2026-11-03T02:00:00Z')), 'incrémentielle');
  assert.equal(typeDuJour({ schema: 'différentielle', completeTous: 7 }, [full], new Date('2026-11-09T02:00:00Z')), 'complète');
  const d = dossierDe([f('/d/x'), f('/d/s/a', 5), f('/d/s/b', 5)], '/d');
  assert.deepEqual(d.dossiers, [{ nom: 's', chemin: '/d/s', fichiers: 2, octets: 10 }]); assert.deepEqual(d.fichiers.map((x) => x.nom), ['x']);
  assert.deepEqual(dossierDe([f('C:\\U\\a.txt')], 'C:/U').fichiers.map((x) => x.nom), ['a.txt'], 'chemins Windows');
});

test('destinations : chemins sûrs, formulaire, dossiers d\'un partage, archive tar relue, ligne « ls » datée', async () => {
  assert.ok(relOk('data/ab/abcd')); assert.ok(!relOk('../x')); assert.ok(!relOk('a/../b')); assert.ok(!relOk('a b'));
  assert.deepEqual(lireDestination({ genre: 'sftp', poste: 'nas', dossier: '/srv/sauv/' }), { genre: 'sftp', poste: 'nas', dossier: '/srv/sauv' });
  assert.throws(() => lireDestination({ genre: 'sftp', poste: 'nas', dossier: 'relatif' }), /chemin absolu/);
  assert.throws(() => lireDestination({ genre: 'partage', poste: 'pc' }), /nom du partage/);
  assert.throws(() => lireDestination({ genre: 'disque', dossier: 'pas/absolu' }), /chemin absolu/);
  assert.deepEqual(lignesDossiers(['data/ab/x', 'data/cd/y', 'config'], 'odin'), ['mkdir "odin"', 'mkdir "odin\\data"', 'mkdir "odin\\data\\ab"', 'mkdir "odin\\data\\cd"']);
  const h = mkdtempSync(join(tmpdir(), 'tar-'));
  try {
    writeFileSync(join(h, 'a'), 'bonjour'); writeFileSync(join(h, 'b'), Buffer.alloc(1300, 7));
    const lu: Array<[string, number]> = [];
    for await (const e of lireTar(tarDe([{ local: join(h, 'a'), rel: 'snapshots/x' }, { local: join(h, 'b'), rel: `data/${'f'.repeat(64)}` }]))) lu.push([e.nom, e.data?.length ?? -1]);
    assert.deepEqual(lu, [['snapshots/x', 7], [`data/${'f'.repeat(64)}`, 1300]]);
    assert.equal([...enTeteTar('x', 0)][0].length, 512);
  } finally { rmSync(h, { recursive: true, force: true }); }
  const e = entreeLs('  facture 2024.pdf                   A    12345  Mon Nov 10 08:30:00 2025');
  assert.equal(e?.nom, 'facture 2024.pdf'); assert.equal(e?.octets, 12345); assert.equal(e?.dossier, false); assert.equal(new Date(e!.quand!).getMonth(), 10);
});

test('dépôt : complète, incrémentielle, différentielle, restauration exacte, compression aucune, copie distante sans copie locale', async () => {
  const h = mkdtempSync(join(tmpdir(), 'phenix-')), src = join(h, 'src'); mkdirSync(src);
  try {
    const old = (f: string, t: number) => utimesSync(f, t, t);
    writeFileSync(join(src, 'a.txt'), 'a1'); writeFileSync(join(src, 'b.txt'), 'b1'); old(join(src, 'a.txt'), 1e9); old(join(src, 'b.txt'), 1e9);
    const repo = new Repo(join(h, 'depot'), 'mot-de-passe-long', { niveau: 0 }), plan = { name: 'p', paths: [src] };
    const f0 = sauvegarder(repo, plan, 'incrémentielle', new Date('2026-11-01T02:00:00Z'));
    assert.equal(f0.type, 'complète', 'sans sauvegarde avant : complète'); assert.equal(f0.files.length, 2);
    writeFileSync(join(src, 'a.txt'), 'a2'); writeFileSync(join(src, 'c.txt'), 'c1'); rmSync(join(src, 'b.txt'));
    const i1 = sauvegarder(repo, plan, 'incrémentielle', new Date('2026-11-02T02:00:00Z'));
    assert.equal(i1.type, 'incrémentielle'); assert.equal(i1.parent, f0.id); assert.deepEqual(i1.files.map((x) => x.path.split(/[\\/]/).pop()).sort(), ['a.txt', 'c.txt']);
    writeFileSync(join(src, 'd.txt'), 'd1');
    const i2 = sauvegarder(repo, plan, 'incrémentielle', new Date('2026-11-03T02:00:00Z'));
    assert.deepEqual(i2.files.map((x) => x.path.split(/[\\/]/).pop()), ['d.txt'], 'incrémentielle : seulement depuis la dernière');
    const d1 = sauvegarder(repo, plan, 'différentielle', new Date('2026-11-04T02:00:00Z'));
    assert.equal(d1.parent, f0.id); assert.deepEqual(d1.files.map((x) => x.path.split(/[\\/]/).pop()).sort(), ['a.txt', 'c.txt', 'd.txt'], 'différentielle : tout depuis la complète');
    const out = join(h, 'r'); assert.equal(restore(repo, i2, out), 3);
    const base = join(out, src.replace(/^([A-Za-z]):/, '$1').replace(/^[\\/]+/, ''));
    assert.equal(readFileSync(join(base, 'a.txt'), 'utf8'), 'a2'); assert.ok(!existsSync(join(base, 'b.txt')), 'effacé avant cette version'); assert.equal(readFileSync(join(base, 'd.txt'), 'utf8'), 'd1');
    assert.deepEqual(verify(repo, d1).bad, []);
    // Copie distante (ici un autre disque, même mécanique) : tout part, vérifié ; la copie locale des morceaux est retirée.
    const t = transportDe(h, { genre: 'disque', dossier: join(h, 'loin') });
    const e = await envoyerDepot(repo, t, false); assert.ok(e.envoyes >= 7);
    const l = await t.liste(); assert.ok(l.has('config') && l.has(`snapshots/${i2.id}`) && l.has(chunkRel(i2.files[0].chunks[0])));
    assert.throws(() => restore(repo, i2, join(h, 'r2')), /ENOENT|no such file/i, 'morceaux partis');
    const ids = [...vue(repo.snapshots(), i2).values()].flatMap((x) => x.chunks);
    await t.recuperer(ids.map((id) => ({ rel: chunkRel(id), local: repo.chunkPath(id) })));
    assert.equal(restore(repo, i2, join(h, 'r2')), 3);
    assert.equal((await envoyerDepot(repo, t, true)).envoyes, 0, 'rien de nouveau : rien ne repart');
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('Phénix dans Odin : plan, sauvegardes, parcourir, télécharger, restaurer, commandes et purge avec accord', async () => {
  const home = mkdtempSync(join(tmpdir(), 'phenix-m-')), src = join(home, 'docs'); mkdirSync(join(src, 'sous'), { recursive: true });
  writeFileSync(join(src, 'note.txt'), 'bonjour'); writeFileSync(join(src, 'sous', 'photo.jpg'), Buffer.alloc(3000, 1));
  const avant = process.env.SINDRI_PASSWORD; process.env.SINDRI_PASSWORD = 'mot-de-passe-de-test';
  const lances: string[][] = [];
  const run = async (cmd: string, args: string[]) => { lances.push([cmd, ...args]); return (cmd === 'sh' || cmd === 'cmd') && /echouer/.test(args.join(' ')) ? { code: 1, out: '', err: 'raté' } : { code: 0, out: '', err: '' }; };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: run as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    assert.match((await v.act('sindri', 'creer', { nom: 'Docs', dossiers: src, depot: join(home, 'depot'), sorte: 'incrémentielle', compression: 'forte' })).text, /🗓 Plan « Docs » : incrémentielle \(complète tous les 7 j\) · forte/);
    const s1 = await v.act('sindri', 'sauvegarder', { plan: 'Docs' }); assert.match(s1.text, /💾 Docs : 2 fichiers .* sauvegarde complète/);
    writeFileSync(join(src, 'note.txt'), 'bonjour, modifié');
    const s2 = await v.act('sindri', 'sauvegarder', { plan: 'Docs' }); assert.match(s2.text, /💾 Docs : 1 fichiers .* sauvegarde incrémentielle/);
    const l = (await v.act('sindri', 'instantanes', { plan: 'Docs' })).data as Array<{ id: string; type: string }>;
    assert.deepEqual(l.map((x) => x.type), ['incrémentielle', 'complète']);
    // Parcourir la dernière version : la racine, puis le dossier, avec un bouton de téléchargement par fichier.
    const racine = await v.act('sindri', 'parcourir', { instantane: l[0].id }); assert.match(racine.text, /📁 .*docs\/ · 2 fichier\(s\)/);
    const p = await v.act('sindri', 'parcourir', { instantane: l[0].id, dossier: src });
    assert.match(p.text, /📁 sous\/ · 1 fichier/); assert.match(p.text, /📄 note\.txt/);
    const dl = p.fichiers?.find((x) => x.nom === 'note.txt'); assert.ok(dl);
    const sindri = v.modules().find((m) => m.id === 'sindri')!, f = sindri.retrait!(v.ctx('sindri'), dl.ref);
    assert.ok(f && readFileSync(f, 'utf8') === 'bonjour, modifié', 'le navigateur reçoit la version de la sauvegarde');
    assert.equal(sindri.retrait!(v.ctx('sindri'), 'dl/../../secret'), undefined); assert.equal(sindri.retrait!(v.ctx('sindri'), `f/${l[0].id}/${Buffer.from('/etc/passwd').toString('base64url')}`), undefined);
    const t = await v.act('sindri', 'telecharger', { instantane: l[1].id, chemin: join(src, 'note.txt') });
    assert.equal(readFileSync(sindri.retrait!(v.ctx('sindri'), t.fichiers![0].ref)!, 'utf8'), 'bonjour', 'l\'ancienne version');
    // Restaurer à part (sans accord), à sa place (grave).
    assert.match((await v.act('sindri', 'restaurer', { instantane: l[1].id })).text, /↩ 2 fichier\(s\) restauré\(s\) dans/);
    assert.equal((await v.act('sindri', 'restaurer', { instantane: l[1].id, a_sa_place: true }, { auto: true })).ok, false);
    assert.match((await v.act('sindri', 'restaurer', { instantane: l[1].id, a_sa_place: true, filtre: 'note' })).text, /à leur place d'origine/);
    assert.equal(readFileSync(join(src, 'note.txt'), 'utf8'), 'bonjour');
    // Commandes avant / après : graves ; une commande d'avant en échec annule la sauvegarde.
    assert.equal((await v.act('sindri', 'commandes', { plan: 'Docs', avant: 'systemctl stop appli' }, { auto: true })).ok, false);
    await v.act('sindri', 'commandes', { plan: 'Docs', avant: 'echo pret', apres: 'echo fini' });
    assert.match((await v.act('sindri', 'sauvegarder', { plan: 'Docs', sorte: 'complète' })).text, /sauvegarde complète.*Commande d'après : faite/);
    assert.ok(lances.some((c) => c.join(' ').includes('echo pret')) && lances.some((c) => c.join(' ').includes('echo fini')));
    await v.act('sindri', 'commandes', { plan: 'Docs', avant: 'echouer' });
    assert.match((await v.act('sindri', 'sauvegarder', { plan: 'Docs' })).text, /commande d'avant a échoué/);
    // Purge : grave.
    assert.equal((await v.act('sindri', 'purger', { plan: 'Docs' }, { auto: true })).ok, false);
    assert.match((await v.act('sindri', 'purger', { plan: 'Docs' })).text, /🧹 Docs : 0 vieille\(s\) version\(s\)/);
    const vue2 = await v.modules().find((m) => m.id === 'sindri')!.view(v.ctx('sindri'), new URLSearchParams());
    assert.deepEqual(vue2.onglets, ['Plans', 'Restaurer', 'Nouveau']); assert.ok(vue2.sections.some((x) => x.title === 'Versions · Docs'));
  } finally { v.stop(); if (avant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = avant; rmSync(home, { recursive: true, force: true }); }
});
